"""Build the local Bet Finder index from the existing football data project.

This is an intentionally isolated migration adapter. The website never reads the
source project at runtime; it only reads the generated JSON index. As the MVP
settles, the remaining feature functions can be moved behind this same output
contract without changing the web application.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from competitions import COMPETITIONS, UEFA_CODES
from source_data import load_csv_matches, load_events, merge_sources


CURRENT_SEASON = "2026-2027"


def parse_args() -> argparse.Namespace:
    default_source = Path.home() / "PyCharmMiscProject"
    default_output = Path(__file__).resolve().parents[1] / "data" / "backtest-index.json"
    parser = argparse.ArgumentParser(description="Build the Bet Finder backtest index")
    parser.add_argument("--source-root", type=Path, default=default_source)
    parser.add_argument("--output", type=Path, default=default_output)
    parser.add_argument("--through", default="2026-10-01", help="Inclusive final match date (YYYY-MM-DD)")
    parser.add_argument("--odds-cache", type=Path, default=default_output.parent / "sources")
    return parser.parse_args()


def safe_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None




def extract_categories(source_file: Path) -> dict[str, str]:
    categories: dict[str, str] = {}
    current = "Other"
    inside_filters = False

    for line in source_file.read_text(encoding="utf-8").splitlines():
        if line.startswith("def get_filters"):
            inside_filters = True
            continue
        if inside_filters and line.strip() == "return filters":
            break
        if not inside_filters:
            continue
        category_match = re.match(r"\s*# --- (.+) ---", line)
        if category_match:
            current = category_match.group(1)
            continue
        filter_match = re.match(r'\s*_add\("([^"]+)"', line)
        if filter_match:
            categories[filter_match.group(1)] = current
    return categories


def public_filter_category(category: str) -> str:
    replacements = {
        "Odds-based filters": "Odds & market",
        "Internal Elo strength filters (leak-safe pre-match snapshots)": "Team strength (Elo)",
        "Starting XI market-value filters (strict pre-match Transfermarkt snapshots)": "Starting XI value",
        "Goals form filters (rolling 5)": "Goals form",
        "Over 2.5 rate filters": "Goals markets",
        "Shots/quality filters": "Shots & chance quality",
        "xG-based filters": "Expected goals",
        "xG dominance filters (team xG - opponent xG)": "xG dominance",
        "Form/momentum filters": "Form & momentum",
        "Contextual filters": "Match context",
        "Lineup filters": "Lineups & rotation",
        "Activity / congestion filters": "Schedule congestion",
        "Weather filters (exploratory only)": "Weather",
        "Duels won % filters (rolling 5)": "Duels",
        "Formation change filters": "Formation changes",
        "Formation vs formation matchup filters": "Formation matchups",
    }
    return replacements.get(category, category)


def filter_label(name: str) -> str:
    text = name.replace("_r5", " · last 5").replace("_r10", " · last 10")
    text = text.replace("_", " ").replace("xi", "XI").replace("xg", "xG").replace("elo", "Elo")
    return text[:1].upper() + text[1:]


def rounded(value: Any) -> float | None:
    number = safe_float(value)
    return round(number, 4) if number is not None else None


def build() -> None:
    args = parse_args()
    source_root = args.source_root.resolve()
    output = args.output.resolve()
    cutoff = datetime.strptime(args.through, "%Y-%m-%d").date().isoformat()
    cache = args.odds_cache.resolve()
    if not source_root.exists():
        raise SystemExit(f"Source root does not exist: {source_root}")

    os.chdir(source_root)
    sys.path.insert(0, str(source_root))
    sys.dont_write_bytecode = True
    from analysis import prematch_strategy_screener as screener
    from analysis.team_strength_elo import add_internal_elo_features_from_event_matches
    from config.team_mappings import FOOTBALL_DATA_TEAM_NAMES, SOFASCORE_TEAM_NAMES
    from scripts.add_ou25_odds import TEAM_NAME_MAP

    print(f"Step 1/7: loading all covered domestic/UEFA CSVs through {cutoff}", flush=True)
    csv_rows = load_csv_matches(source_root, cache, cutoff)
    print("Step 2/7: loading completed match events (read-only)", flush=True)
    events = load_events(source_root, cutoff, screener, cache)
    aliases = dict(TEAM_NAME_MAP)
    for mapping in SOFASCORE_TEAM_NAMES.values():
        if isinstance(mapping, dict):
            aliases.update({key: value for key, value in mapping.items() if isinstance(value, str)})
    matches = merge_sources(csv_rows, events, FOOTBALL_DATA_TEAM_NAMES, aliases)
    if not matches:
        raise SystemExit("No completed matches found; the previous index was preserved")
    print(f"  {len(matches):,} unique completed matches; early-season and unpriced events retained", flush=True)

    print("Step 3/7: attaching starting-XI market values", flush=True)
    screener.add_starting_xi_market_value_features(matches, source_root / screener.XI_VALUE_FEATURES_CSV)

    print("Step 4/7: computing leakage-safe pre-match rolling features")
    matches.sort(key=lambda match: match["date"])
    screener.compute_starting_xi_value_changes(matches)
    screener.compute_rolling_stats(matches)
    screener.compute_lineup_changes(matches)
    screener.compute_formation_changes(matches)

    print("Step 5/7: computing schedule congestion and Elo", flush=True)
    schedules = screener.load_team_schedules()
    close_mins_map = {event["match_id"]: event["_close_minutes"] for event in events if event.get("match_id")}
    screener.compute_activity_stats(matches, schedules, close_mins_map)
    # Stable team-name identities prevent FotMob/SofaScore ID collisions in Elo.
    elo_events = [{**match, "home_team_id": match["_home_identity"], "away_team_id": match["_away_identity"]} for match in events]
    add_internal_elo_features_from_event_matches(matches, elo_events)

    print("Step 6/7: evaluating the 125 atomic filters once per match")
    source_filters = screener.get_filters()
    filter_ids = json.loads((Path(__file__).parent / "filter_ids.json").read_text(encoding="utf-8"))
    all_filters = {name: source_filters[name] for name in filter_ids}
    source_categories = extract_categories(source_root / "analysis" / "prematch_strategy_screener.py")
    hit_counts: Counter[str] = Counter()
    records: list[dict[str, Any]] = []

    for match in matches:
        hits: list[int] = []
        for ordinal, (name, (function, _description, _requires_json)) in enumerate(all_filters.items()):
            try:
                passes = bool(function(match))
            except (KeyError, TypeError, ValueError, ZeroDivisionError):
                passes = False
            if passes:
                hits.append(ordinal)
                hit_counts[name] += 1

        records.append(
            {
                "id": f"{match['league_code']}-{match.get('match_id') or match['_stable_id']}",
                "league": match["league"],
                "leagueCode": match["league_code"],
                "season": match["season"],
                "date": match["date"],
                "home": match["home_team"],
                "away": match["away_team"],
                "homeGoals": match["fthg"],
                "awayGoals": match["ftag"],
                "result": match["ftr"],
                "odds": {
                    "home": rounded(match.get("max_home")),
                    "draw": rounded(match.get("max_draw")),
                    "away": rounded(match.get("max_away")),
                    "over25": rounded(match.get("max_over25")),
                    "under25": rounded(match.get("max_under25")),
                },
                "filterHits": hits,
                "oddsTypes": match["_price_types"],
                "betfairMinutes": match["_price_minutes"],
                "jsonAvailable": bool(match.get("match_id")),
                "oddsSource": match.get("odds_source", "historical archive"),
            }
        )

    filters = []
    for name, (_function, description, requires_json) in all_filters.items():
        filters.append(
            {
                "id": name,
                "label": filter_label(name),
                "description": description,
                "category": public_filter_category(source_categories.get(name, "Other")),
                "requiresJson": bool(requires_json),
                "matches": hit_counts[name],
            }
        )

    league_counts = Counter(record["league"] for record in records)
    season_counts = Counter(record["season"] for record in records)
    available_seasons = sorted(season_counts)
    competitions = []
    for code, (name, country, _directory, calendar) in COMPETITIONS.items():
        rows = [row for row in records if row["leagueCode"] == code]
        if not rows:
            continue
        priced = [row for row in rows if any(row["odds"].values())]
        competitions.append({
            "code": code, "name": name, "country": country,
            "kind": "uefa" if code in UEFA_CODES else "domestic",
            "calendarYear": calendar, "matches": len(rows),
            "eventMatches": sum(row["jsonAvailable"] for row in rows),
            "markets": {market: sum(row["odds"][market] is not None for row in rows) for market in ("home", "draw", "away", "over25", "under25")},
            "betfairMarkets": {market: sum(row["oddsTypes"][market] == "betfair" for row in rows) for market in ("home", "draw", "away", "over25", "under25")},
            "marketLastDates": {market: max((row["date"] for row in rows if row["odds"][market]), default=None) for market in ("home", "draw", "away", "over25", "under25")},
            "firstDate": rows[0]["date"], "lastDate": rows[-1]["date"],
            "lastOddsDate": priced[-1]["date"] if priced else None,
        })
    payload = {
        "meta": {
            "schemaVersion": 2,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "cutoffDate": cutoff,
            "firstMatchDate": records[0]["date"],
            "lastMatchDate": records[-1]["date"],
            "matchCount": len(records),
            "filterCount": len(filters),
            "defaultSeasons": [season for season in available_seasons if season != CURRENT_SEASON],
            "availableSeasons": available_seasons,
            "currentSeason": CURRENT_SEASON,
            "logic": "AND of OR groups",
            "maxFilters": 5,
            "leagueCounts": dict(sorted(league_counts.items())),
            "seasonCounts": dict(sorted(season_counts.items())),
            "competitions": competitions,
            "methodology": "Flat 1-unit stakes. Maximum closing bookmaker odds preferred, opening maximum fallback when closing is missing. Betfair exchange fallback uses the last recorded price strictly before kickoff, at most 10 minutes old; commission is applied to winning exchange profit at the selected rate. No kickoff/in-play or Polymarket prices. Rolling form is within competition and season; opening fixtures remain in the pool but cannot match filters requiring unavailable history. Calendar-year leagues use the season bucket starting in that year. Coverage varies by competition, season and market; missing odds are excluded from returns.",
        },
        "filters": filters,
        "matches": records,
    }

    print("Step 7/7: writing the web index")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    temporary.replace(output)
    size_mb = output.stat().st_size / 1_048_576
    print(f"  Wrote {output} ({size_mb:.1f} MB)")
    print(f"  {len(competitions)} competitions, {len(available_seasons)} season buckets; last match {records[-1]['date']}")
    for competition in competitions:
        print(f"    {competition['name']}: {competition['matches']:,} matches, {competition['eventMatches']:,} enriched; priced through {competition['lastOddsDate']}; O/U odds {competition['markets']['over25']:,}")


if __name__ == "__main__":
    build()
