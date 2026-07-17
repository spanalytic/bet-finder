"""Build the local Bet Finder index from the existing football data project.

This is an intentionally isolated migration adapter. The website never reads the
source project at runtime; it only reads the generated JSON index. As the MVP
settles, the remaining feature functions can be moved behind this same output
contract without changing the web application.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


TOP_FIVE = ["E0", "D1", "F1", "SP1", "I1"]
LATEST_FILES = {
    "E0": "E0.csv",
    "D1": "D1.csv",
    "F1": "F1.csv",
    "SP1": "SP1.csv",
    "I1": "I1.csv",
}
COMPLETED_SEASONS = ["2023-2024", "2024-2025", "2025-2026"]
CURRENT_SEASON = "2026-2027"


def parse_args() -> argparse.Namespace:
    default_source = Path.home() / "PyCharmMiscProject"
    default_output = Path(__file__).resolve().parents[1] / "data" / "backtest-index.json"
    parser = argparse.ArgumentParser(description="Build the Bet Finder backtest index")
    parser.add_argument("--source-root", type=Path, default=default_source)
    parser.add_argument("--output", type=Path, default=default_output)
    return parser.parse_args()


def safe_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None


def safe_int(value: Any) -> int | None:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def first_number(row: dict[str, str], *keys: str) -> float | None:
    for key in keys:
        value = safe_float(row.get(key))
        if value is not None:
            return value
    return None


def load_latest_top_five(source_root: Path, screener: Any) -> list[dict[str, Any]]:
    """Load the larger Odds directory as the authority for overlapping matches."""
    matches: list[dict[str, Any]] = []
    odds_dir = source_root / "Odds"

    for code, filename in LATEST_FILES.items():
        csv_path = odds_dir / filename
        if not csv_path.exists():
            print(f"  warning: latest odds file missing: {csv_path}")
            continue

        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                max_home = first_number(row, "MaxCH", "MaxH")
                max_draw = first_number(row, "MaxCD", "MaxD")
                max_away = first_number(row, "MaxCA", "MaxA")
                if not all(value and value > 1 for value in (max_home, max_draw, max_away)):
                    continue

                home_goals = safe_int(row.get("FTHG"))
                away_goals = safe_int(row.get("FTAG"))
                result = (row.get("FTR") or "").strip()
                if home_goals is None or away_goals is None or result not in {"H", "D", "A"}:
                    continue

                try:
                    match_date = datetime.strptime((row.get("Date") or "").strip(), "%d/%m/%Y")
                except ValueError:
                    continue

                matches.append(
                    {
                        "league": screener.LEAGUE_NAMES[code],
                        "league_code": code,
                        "season": "2025-2026",
                        "date": match_date.strftime("%Y-%m-%d"),
                        "home_team": (row.get("HomeTeam") or "").strip(),
                        "away_team": (row.get("AwayTeam") or "").strip(),
                        "fthg": home_goals,
                        "ftag": away_goals,
                        "ftr": result,
                        "total_goals": home_goals + away_goals,
                        "max_home": max_home,
                        "max_draw": max_draw,
                        "max_away": max_away,
                        "max_over25": first_number(row, "MaxC>2.5", "Max>2.5"),
                        "max_under25": first_number(row, "MaxC<2.5", "Max<2.5"),
                        "avg_home": first_number(row, "AvgCH", "AvgH"),
                        "avg_draw": first_number(row, "AvgCD", "AvgD"),
                        "avg_away": first_number(row, "AvgCA", "AvgA"),
                        "avg_over25": first_number(row, "AvgC>2.5", "Avg>2.5"),
                        "avg_under25": first_number(row, "AvgC<2.5", "Avg<2.5"),
                        "home_implied_prob": 1 / max_home,
                        "draw_implied_prob": 1 / max_draw,
                        "away_implied_prob": 1 / max_away,
                        "hs": safe_int(row.get("HS")),
                        "as": safe_int(row.get("AS")),
                        "hst": safe_int(row.get("HST")),
                        "ast": safe_int(row.get("AST")),
                        "hc": safe_int(row.get("HC")),
                        "ac": safe_int(row.get("AC")),
                        "hf": safe_int(row.get("HF")),
                        "af": safe_int(row.get("AF")),
                        "hy": safe_int(row.get("HY")),
                        "ay": safe_int(row.get("AY")),
                        "hr": safe_int(row.get("HR")),
                        "ar": safe_int(row.get("AR")),
                        "odds_source": "larger Odds directory",
                    }
                )

    print(f"  Loaded {len(matches)} completed matches from the larger Odds directory")
    return matches


def match_key(match: dict[str, Any]) -> tuple[str, str, str, str]:
    return (
        match["league_code"],
        match["date"],
        match["home_team"].strip().casefold(),
        match["away_team"].strip().casefold(),
    )


def merge_matches(historical: list[dict[str, Any]], latest: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged = {match_key(match): match for match in historical}
    for match in latest:
        merged[match_key(match)] = match
    return sorted(merged.values(), key=lambda item: (item["date"], item["league_code"]))


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
    if not source_root.exists():
        raise SystemExit(f"Source root does not exist: {source_root}")

    os.chdir(source_root)
    sys.path.insert(0, str(source_root))
    from analysis import prematch_strategy_screener as screener

    print("Step 1/7: loading historical top-five odds")
    screener.ODDS_DIR = source_root / "data" / "Odds"
    historical = screener.load_european_odds(COMPLETED_SEASONS, TOP_FIVE)
    for match in historical:
        match["odds_source"] = "historical archive"

    print("Step 2/7: applying the larger Odds directory as the latest authority")
    latest = load_latest_top_five(source_root, screener)
    matches = merge_matches(historical, latest)
    print(f"  {len(matches)} unique completed matches after deduplication")

    print("Step 3/7: attaching match-event enrichment")
    enrichment, close_mins_map = screener.load_match_jsons(TOP_FIVE)
    screener.join_datasets(matches, enrichment)
    screener.add_starting_xi_market_value_features(matches, source_root / screener.XI_VALUE_FEATURES_CSV)

    print("Step 4/7: computing leakage-safe pre-match rolling features")
    matches.sort(key=lambda match: match["date"])
    screener.compute_starting_xi_value_changes(matches)
    screener.compute_rolling_stats(matches)
    screener.compute_lineup_changes(matches)
    screener.compute_formation_changes(matches)

    print("Step 5/7: computing schedule congestion and Elo")
    schedules = screener.load_team_schedules()
    screener.compute_activity_stats(matches, schedules, close_mins_map)
    screener.add_internal_elo_features_from_event_dirs(matches, screener.event_dirs_for_codes(TOP_FIVE))

    eligible = [
        match
        for match in matches
        if match.get("home_goals_scored_r5") is not None
        and match.get("away_goals_scored_r5") is not None
    ]
    print(f"  {len(eligible)} matches have enough prior history for screening")

    print("Step 6/7: evaluating the 125 atomic filters once per match")
    all_filters = screener.get_filters()
    source_categories = extract_categories(source_root / "analysis" / "prematch_strategy_screener.py")
    hit_counts: Counter[str] = Counter()
    records: list[dict[str, Any]] = []

    for index, match in enumerate(eligible):
        hits: list[str] = []
        for name, (function, _description, _requires_json) in all_filters.items():
            try:
                passes = bool(function(match))
            except (KeyError, TypeError, ValueError, ZeroDivisionError):
                passes = False
            if passes:
                hits.append(name)
                hit_counts[name] += 1

        records.append(
            {
                "id": match.get("match_id") or f"{match['league_code']}-{match['date']}-{index}",
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
    payload = {
        "meta": {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "matchCount": len(records),
            "filterCount": len(filters),
            "defaultSeasons": COMPLETED_SEASONS,
            "availableSeasons": COMPLETED_SEASONS + [CURRENT_SEASON],
            "currentSeason": CURRENT_SEASON,
            "logic": "AND of OR groups",
            "maxFilters": 5,
            "leagueCounts": dict(sorted(league_counts.items())),
            "seasonCounts": dict(sorted(season_counts.items())),
            "methodology": "Flat 1-unit stakes using maximum closing odds; no commission.",
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


if __name__ == "__main__":
    build()
