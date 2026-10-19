"""Sample-size policy and field-level coverage for the public filter catalogue."""

from collections import Counter

FIRST_SEASON = "2022-2023"
MIN_FILTER_MATCHES = 100


def restrict_seasons(matches, first_season=FIRST_SEASON):
    return [match for match in matches if match["season"] >= first_season]


def prune_filters(records, definitions, minimum=MIN_FILTER_MATCHES):
    """Count distinct priced fixtures, not five markets as five selections.

    No profitability/performance ranking is used. Preserve retired definitions
    for audits and to prevent old saved rules from silently broadening.
    """
    counts = Counter()
    for record in records:
        if any(value is not None and value > 1 for value in record["odds"].values()):
            counts.update(set(record["filterHits"]))
    active, removed, ordinals = [], [], {}
    for ordinal, definition in enumerate(definitions):
        definition = {**definition, "matches": counts[ordinal]}
        if counts[ordinal] < minimum:
            removed.append({**definition, "reason": f"Fewer than {minimum} distinct matches with usable odds since 2022/23"})
        else:
            ordinals[ordinal] = len(active)
            active.append(definition)
    for record in records:
        record["filterHits"] = [ordinals[ordinal] for ordinal in record["filterHits"] if ordinal in ordinals]
    return active, removed


def feature_availability(match):
    """Conservative complete input sets, NOT filter pass counts or fixture totals."""
    def present(*fields):
        return all(match.get(field) is not None for field in fields)

    return {
        "Goals form · both teams, last 5": present("home_goals_scored_r5", "away_goals_scored_r5"),
        "Shots · both teams, last 5": present("home_shots_r5", "away_shots_r5", "home_shots_on_target_r5", "away_shots_on_target_r5"),
        "xG · both teams, last 5": present("home_xg_r5", "away_xg_r5"),
        "Elo · sufficient prior games": match.get("internal_elo_ready") is True,
        "Starting XI value · sufficient coverage": match.get("xi_value_coverage_ok") is True,
        "Lineup changes · both teams": present("home_lineup_changes", "away_lineup_changes"),
        "Formation matchup · both teams": present("home_formation_family", "away_formation_family"),
        "Duels · both teams, last 5": present("home_duels_won_pct_r5", "away_duels_won_pct_r5"),
        "Weather · temperature, rain and wind": present("temperature_c", "precipitation_mm", "wind_speed_kmh"),
        "Rest days · both teams": present("home_days_rest", "away_days_rest"),
    }
