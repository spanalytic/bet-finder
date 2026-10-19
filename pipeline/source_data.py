"""Strict dated CSV/event adapter with labelled pre-kickoff Betfair fallback.

Unpriced completed events still supply rolling history and appear in coverage.
No exchange or prediction-market values are silently substituted.
"""

import csv
import hashlib
import gzip
import inspect
import io
import json
import math
import re
import unicodedata
import zipfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path

from competitions import COMPETITIONS, UEFA_CODES


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def price(value):
    value = number(value)
    return value if value is not None and value > 1 else None


def first(row, *keys):
    return next((value for key in keys if (value := price(row.get(key))) is not None), None)


def last_prematch_price(series):
    """Closest valid snapshot in [-10, 0), never kickoff/in-play or stale odds."""
    candidates = [(minute, value) for raw_minute, raw_value in (series or {}).items()
                  if (minute := number(raw_minute)) is not None and -10 <= minute < 0
                  and (value := price(raw_value)) is not None]
    return max(candidates, default=(None, None))


def regulation_score(data):
    """Recover 90-minute UEFA settlement, excluding extra-time/shootout goals."""
    final = re.fullmatch(r"\s*(\d+)\s*-\s*(\d+)\s*", str(data.get("score", "")))
    if not final:
        return None
    final = tuple(map(int, final.groups()))
    goals = [event for event in (data.get("events") or []) if event.get("type") == "Goal"]
    if not any((number(event.get("minute")) or 0) > 90 for event in goals):
        return final
    # Both providers encode stoppage as minute=90, added_time=N. Only use
    # cumulative scores when the goal sequence agrees with the final score.
    goals.sort(key=lambda event: ((number(event.get("minute")) or 0), (number(event.get("added_time")) or 0)))
    if any("added_time" not in event for event in goals) or tuple(goals[-1].get("score_after") or []) != final:
        return None
    regular = [event for event in goals if (number(event.get("minute")) or 0) <= 90]
    value = regular[-1].get("score_after") if regular else [0, 0]
    if not isinstance(value, (list, tuple)) or len(value) != 2 or any(not isinstance(goal, int) for goal in value):
        return None
    return tuple(value)


def check_uefa_regulation(matches, all_paths):
    pending = {(row["league_code"], row["match_id"]): row for row in matches
               if row["league_code"] in UEFA_CODES and not row.get("_regulation_checked")}
    if not pending:
        return False

    def read(target):
        code, path = target
        data = json.loads(path.read_text(encoding="utf-8"))
        row = pending.get((code, str(data.get("match_id"))))
        if row is None:
            return
        score = regulation_score(data)
        if score is None:
            row["_betfair"] = {}  # Do not settle an uncertain regulation score.
        else:
            row["fthg"], row["ftag"] = score
            row["total_goals"] = sum(score)
            row["ftr"] = "H" if score[0] > score[1] else "A" if score[1] > score[0] else "D"
        row["_regulation_checked"] = True

    with ThreadPoolExecutor(max_workers=8) as executor:
        list(executor.map(read, [(code, path) for code in UEFA_CODES for path in all_paths.get(code, [])]))
    print("  Checked UEFA regulation-time settlement (extra time excluded)", flush=True)
    return True


def date_iso(value):
    value = str(value or "").strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(value[:10], fmt).date().isoformat()
        except ValueError:
            pass
    return None


def season_key(raw, date, code):
    raw = str(raw or "").replace("/", "-")
    if re.fullmatch(r"\d{4}-\d{4}", raw):
        return raw
    if re.fullmatch(r"\d{4}", raw):
        year = int(raw)
    else:
        year = int(date[:4])
        if not COMPETITIONS[code][3] and int(date[5:7]) < 7:
            year -= 1
    return f"{year}-{year + 1}"


def normalized(name):
    text = unicodedata.normalize("NFKD", str(name or "")).encode("ascii", "ignore").decode("ascii").casefold()
    return re.sub(r"[^a-z0-9]", "", text)


def csv_match(row, code, season, source, cutoff):
    date = date_iso(row.get("Date"))
    hg, ag = number(row.get("FTHG", row.get("HG"))), number(row.get("FTAG", row.get("AG")))
    result = row.get("FTR", row.get("Res", "")).strip()
    home, away = row.get("HomeTeam", row.get("Home", "")).strip(), row.get("AwayTeam", row.get("Away", "")).strip()
    if not date or date > cutoff or hg is None or ag is None or not hg.is_integer() or not ag.is_integer() or min(hg, ag) < 0 or not home or not away:
        return None
    expected = "H" if hg > ag else "A" if ag > hg else "D"
    if result != expected:
        return None
    match = {"league": COMPETITIONS[code][0], "league_code": code, "season": season_key(row.get("Season") or season, date, code), "date": date,
             "home_team": home, "away_team": away, "fthg": int(hg), "ftag": int(ag), "ftr": result, "total_goals": int(hg + ag), "odds_source": source}
    for key, columns in {
        "max_home": ("MaxCH", "MaxH"), "max_draw": ("MaxCD", "MaxD"), "max_away": ("MaxCA", "MaxA"),
        "max_over25": ("MaxC>2.5", "Max>2.5"), "max_under25": ("MaxC<2.5", "Max<2.5"),
        "avg_home": ("AvgCH", "AvgH"), "avg_draw": ("AvgCD", "AvgD"), "avg_away": ("AvgCA", "AvgA"),
        "avg_over25": ("AvgC>2.5", "Avg>2.5"), "avg_under25": ("AvgC<2.5", "Avg<2.5"),
    }.items():
        match[key] = first(row, *columns)
    for key, column in {"hs": "HS", "as": "AS", "hst": "HST", "ast": "AST", "hc": "HC", "ac": "AC", "hf": "HF", "af": "AF", "hy": "HY", "ay": "AY", "hr": "HR", "ar": "AR"}.items():
        match[key] = number(row.get(column))
    return match


def load_csv_matches(root, cache, cutoff):
    matches = []

    def read(text, code, season, source):
        for row in csv.DictReader(io.StringIO(text)):
            match = csv_match(row, code, season, source, cutoff)
            if match:
                matches.append(match)

    # Ascending precedence: archives, legacy loose files, current source CSVs,
    # refreshed workspace snapshots. Missing refreshed markets never erase odds.
    for path in sorted((root / "data" / "Odds").glob("*.zip")):
        if not re.fullmatch(r"\d{4}-\d{4}", path.stem):
            continue
        with zipfile.ZipFile(path) as archive:
            for name in archive.namelist():
                code = Path(name).stem
                if code in COMPETITIONS:
                    read(archive.read(name).decode("utf-8-sig", errors="replace"), code, path.stem, "historical CSV")
    for directory, source in [(root / "Odds", "legacy CSV"), (root / "data" / "Odds", "source CSV"), (cache, "refreshed CSV")]:
        for code in COMPETITIONS:
            path = directory / f"{code}.csv"
            if path.exists():
                # Legacy European loose CSVs are the 2025-26 snapshot. Other
                # loose CSVs explicitly supply Season (including UEFA).
                read(path.read_text(encoding="utf-8-sig"), code, "2025-2026", source)
        for path in sorted(directory.glob("????-????/*.csv")):
            if path.stem in COMPETITIONS:
                read(path.read_text(encoding="utf-8-sig"), path.stem, path.parent.name, source)
    print(f"  Read {len(matches):,} CSV rows before deduplication", flush=True)
    return matches


def event_match(data, code, season, cutoff, screener):
    date = date_iso(data.get("date"))
    score = re.fullmatch(r"\s*(\d+)\s*-\s*(\d+)\s*", str(data.get("score", "")))
    if not date or date > cutoff or not score or not data.get("home_team") or not data.get("away_team"):
        return None
    hg, ag = map(int, score.groups())
    match = {"league": COMPETITIONS[code][0], "league_code": code, "season": season_key(season, date, code), "date": date,
             "home_team": data["home_team"], "away_team": data["away_team"], "home_team_id": data.get("home_team_id"), "away_team_id": data.get("away_team_id"),
             "match_id": str(data.get("match_id")) if data.get("match_id") else None, "fthg": hg, "ftag": ag, "ftr": "H" if hg > ag else "A" if ag > hg else "D", "total_goals": hg + ag,
             "odds_source": "no maximum bookmaker odds"}
    stats = data.get("stats") or {}
    lineups = data.get("lineups") or {}
    for side, short in [("home", "h"), ("away", "a")]:
        side_stats = stats.get(side) or {key[len(side) + 1:]: value for key, value in stats.items() if key.startswith(f"{side}_")}
        for field in ("xg", "xgot", "big_chances", "possession", "duels_won", "shots_inside_box"):
            match[f"json_{side}_{field}"] = number(side_stats.get(field))
        for key, field in {"s": "shots", "st": "shots_on_target", "c": "corners", "f": "fouls", "y": "yellow_cards", "r": "red_cards"}.items():
            match[f"{short}{key}"] = number(side_stats.get(field))
        ground = screener._parse_pct_field(side_stats.get("ground_duels_won"))
        ground_total = screener._parse_pct_denominator(side_stats.get("ground_duels_won"))
        aerial = screener._parse_pct_field(side_stats.get("aerial_duels_won"))
        aerial_total = screener._parse_pct_denominator(side_stats.get("aerial_duels_won"))
        match[f"json_{side}_duels_won_pct"] = 100 * (ground + aerial) / (ground_total + aerial_total) if ground is not None and aerial is not None and ground_total and aerial_total else None
        lineup = lineups.get(side) or {}
        match[f"json_{side}_xi_ids"] = {p["player_id"] for p in (lineup.get("starting_xi") or []) if p.get("player_id")}
        match[f"json_{side}_formation"] = lineup.get("formation")
        match[f"json_{side}_reds"] = sum(ev.get("type") == "Card" and ev.get("card_type") == "Red" and ev.get("team_id") == data.get(f"{side}_team_id") for ev in (data.get("events") or []))
    weather = data.get("weather") or {}
    for key in ("temperature_c", "wind_speed_kmh", "precipitation_mm", "humidity_pct"):
        match[key] = number(weather.get(key))
    # Only fields explicitly identified as maximum bookmaker prices are safe.
    # Generic odds_home_win and betfair/polymarket series are NOT substituted.
    for side in ("home", "draw", "away"):
        match[f"max_{side}"] = None
    match["max_over25"] = price(data.get("odds_over_25_max"))
    match["max_under25"] = price(data.get("odds_under_25_max"))
    minute_odds = (data.get("betfair_odds") or {}).get("minute_odds") or {}
    match_odds, ou = minute_odds.get("match_odds") or {}, minute_odds.get("ou_2_5") or {}
    match["_betfair"] = {market: last_prematch_price(series) for market, series in {
        "home": match_odds.get("home_win"), "draw": match_odds.get("draw"), "away": match_odds.get("away_win"),
        "over25": ou.get("over"), "under25": ou.get("under"),
    }.items()}
    hscore = ascore = previous = close = 0
    goals = sorted((number(ev.get("minute")) or 0, ev.get("team_id") == data.get("home_team_id")) for ev in (data.get("events") or []) if ev.get("type") == "Goal")
    for minute, home_goal in goals:
        minute = min(max(minute, 0), 95)
        if abs(hscore - ascore) <= 1:
            close += max(0, minute - previous)
        hscore += int(home_goal)
        ascore += int(not home_goal)
        previous = minute
    if abs(hscore - ascore) <= 1:
        close += max(0, 95 - previous)
    match["_close_minutes"] = close
    return match


def load_events(root, cutoff, screener, cache=None):
    fingerprint = hashlib.sha256((str(root) + cutoff + inspect.getsource(event_match) + inspect.getsource(last_prematch_price)).encode())
    all_paths = {}
    for code, (_, _, directory, _) in COMPETITIONS.items():
        if directory:
            paths = sorted((root / "data" / directory).rglob("*.json"))
            all_paths[code] = paths
            for path in paths:
                stat = path.stat()
                fingerprint.update(f"{path}:{stat.st_size}:{stat.st_mtime_ns}".encode())
    cache_path = cache / f"events-{fingerprint.hexdigest()[:24]}.json.gz" if cache else None
    if cache_path and cache_path.exists():
        with gzip.open(cache_path, "rt", encoding="utf-8") as handle:
            matches = json.load(handle)
        for match in matches:
            for side in ("home", "away"):
                match[f"json_{side}_xi_ids"] = set(match[f"json_{side}_xi_ids"])
        print(f"  Reused {len(matches):,} event records from the validated local cache", flush=True)
        if check_uefa_regulation(matches, all_paths):
            with gzip.open(cache_path, "wt", encoding="utf-8") as handle:
                json.dump(matches, handle, default=lambda value: sorted(value) if isinstance(value, set) else value, separators=(",", ":"))
        return matches
    matches = []
    for code, (_, _, directory, _) in COMPETITIONS.items():
        if directory is None:
            continue
        paths = all_paths[code]

        def read(path):
            try:
                return event_match(json.loads(path.read_text(encoding="utf-8")), code, path.parent.name, cutoff, screener)
            except (OSError, ValueError, TypeError) as error:
                raise RuntimeError(f"Invalid event file: {path}") from error

        with ThreadPoolExecutor(max_workers=8) as executor:
            rows = [row for row in executor.map(read, paths) if row]
        matches.extend(rows)
        print(f"  {COMPETITIONS[code][0]}: {len(rows):,} completed events through {cutoff}", flush=True)
    check_uefa_regulation(matches, all_paths)
    if cache_path:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = cache_path.with_suffix(".tmp")
        with gzip.open(temporary, "wt", encoding="utf-8") as handle:
            json.dump(matches, handle, default=lambda value: sorted(value) if isinstance(value, set) else value, separators=(",", ":"))
        temporary.replace(cache_path)
    return matches


def merge_sources(csv_rows, events, fd_names, name_aliases):
    # The event archives mix FotMob and SofaScore IDs. Reconcile documented
    # name aliases rather than assuming the same numeric-ID namespace.
    parents = {}

    def find(name):
        name = normalized(name)
        parents.setdefault(name, name)
        if parents[name] != name:
            parents[name] = find(parents[name])
        return parents[name]

    def union(left, right):
        left, right = find(left), find(right)
        parents[max(left, right)] = min(left, right)

    for left, right in name_aliases.items():
        union(left, right)
    known_ids = defaultdict(list)
    for name, team_id in fd_names.items():
        known_ids[str(team_id)].append(name)
    for names in known_ids.values():
        for name in names[1:]:
            union(names[0], name)
    local_parents = {}

    def identity(code, name):
        key = (code, find(name))
        local_parents.setdefault(key, key)
        if local_parents[key] != key:
            local_parents[key] = local_find(local_parents[key])
        return local_parents[key]

    def local_find(key):
        if local_parents[key] != key:
            local_parents[key] = local_find(local_parents[key])
        return local_parents[key]

    # One exact known team + competition/date + identical full-time score must
    # identify exactly one event. This resolves missing aliases without fuzzy
    # matching. Calendar-league UTC/local drift may be at most one day.
    links = {}
    for _ in range(4):
        by_side = defaultdict(list)
        for event in events:
            for side in ("home", "away"):
                by_side[(event["league_code"], event["date"], side, identity(event["league_code"], event[f"{side}_team"]))].append(event)
        changed = False
        for match in csv_rows:
            code, date = match["league_code"], match["date"]
            dates = [date]
            if COMPETITIONS[code][3]:
                date_value = datetime.fromisoformat(date)
                dates += [(date_value + timedelta(days=delta)).date().isoformat() for delta in (-1, 1)]
            candidates = {}
            for candidate_date in dates:
                for side in ("home", "away"):
                    for event in by_side.get((code, candidate_date, side, identity(code, match[f"{side}_team"])), []):
                        if event.get("fthg") == match.get("fthg") and event.get("ftag") == match.get("ftag"):
                            candidates[id(event)] = event
                if candidates:
                    break  # Exact date always wins over an adjacent-date link.
            if len(candidates) != 1:
                continue
            event = next(iter(candidates.values()))
            links[id(match)] = event
            for side in ("home", "away"):
                left, right = identity(code, match[f"{side}_team"]), identity(code, event[f"{side}_team"])
                if left != right:
                    local_parents[max(left, right)] = min(left, right)
                    changed = True
        if not changed:
            break
    canonical = {}
    sofa_ids = {find(name): team_id for name, team_id in fd_names.items()}
    for match in events + csv_rows:
        for side in ("home", "away"):
            canonical.setdefault(identity(match["league_code"], match[f"{side}_team"]), match[f"{side}_team"])

    def team_key(match, side):
        code = match["league_code"]
        key = identity(code, match[f"{side}_team"])
        original = find(match[f"{side}_team"])
        match[f"{side}_team"] = canonical[key]
        match[f"_{side}_identity"] = key[1]
        # Schedule caches use SofaScore IDs; convert from documented names.
        if original in sofa_ids:
            match[f"{side}_team_id"] = sofa_ids[original]
        return key[1]

    merged = {}
    for match in events + csv_rows:
        home, away = team_key(match, "home"), team_key(match, "away")
        linked = links.get(id(match))
        key = (match["league_code"], linked["date"] if linked else match["date"], home, away)
        if key in merged:
            previous = merged[key]
            previous.update({k: v for k, v in match.items() if v is not None})
        else:
            merged[key] = dict(match)
        # Stable IDs for CSV-only matches; no position-dependent identifiers.
        merged[key]["_stable_id"] = hashlib.sha256("|".join(key).encode()).hexdigest()[:20]
    matches = sorted(merged.values(), key=lambda row: (row["date"], row["league_code"], row["_stable_id"]))
    for match in matches:
        match["_price_types"], match["_price_minutes"] = {}, {}
        for market in ("home", "draw", "away", "over25", "under25"):
            key = f"max_{market}"
            if match.get(key):
                match["_price_types"][market] = "bookmaker"
            else:
                minute, value = match.get("_betfair", {}).get(market, (None, None))
                match[key] = value
                match["_price_types"][market] = "betfair" if value else None
                if value:
                    match["_price_minutes"][market] = minute
        for side in ("home", "draw", "away"):
            value = match.get(f"max_{side}")
            match[f"{side}_implied_prob"] = 1 / value if value else None
    return matches
