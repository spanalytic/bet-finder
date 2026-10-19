"""Validate detailed event records; a score-only JSON is not event coverage.

This checks the saved provider-neutral schema, not a claim of completeness of
the provider's historical fixture list. Zero is data; missing is not zero.
Weather, player market values and rolling-history warm-up are separate inputs.
"""

import math
import re
from collections import Counter, defaultdict
from datetime import date


EVENT_QUALITY_VERSION = 2
FULL_EVENT_REQUIREMENTS = [
    "Completed fixture identity and final score",
    "Both teams' shots, shots on target, possession, corners and fouls",
    "Both teams' expected goals (xG)",
    "Eleven identified starters and a formation for each team",
    "Timed event timeline with a reconciled final goal sequence",
    "Timed, attributed shot map with xG and locations, reconciled to shot totals",
]


def complete_event_pool(matches):
    """Gate unique, merged fixtures before any rolling features are computed."""
    counts = {}
    for match in matches:
        summary = counts.setdefault(match["league_code"], Counter())
        summary["sourceMatches"] += 1
        if match.get("_full_event_details") is True:
            summary["completeMatches"] += 1
        elif match.get("match_id"):
            summary["incompleteEventMatches"] += 1
        else:
            summary["missingEventMatches"] += 1
    return [match for match in matches if match.get("_full_event_details") is True], counts


def guard_history_gaps(source_matches):
    """Do not reinterpret 'last 5' as five older available games across a gap.

    Known excluded fixtures stay as chronology markers, never as selections or
    feature inputs. Unknown/missing fixtures outside the sources remain a limit.
    """
    histories = defaultdict(list)
    for match in sorted(source_matches, key=lambda row: (row["date"], row.get("_stable_id", ""))):
        for side in ("home", "away"):
            history = histories[(match["league_code"], match["season"], match[f"{side}_team"])]
            if match.get("_full_event_details") is True:
                prefix = f"{side}_"
                for window in (5, 10):
                    prior = history[-window:]
                    if len(prior) < window or not all(row.get("_full_event_details") is True for row in prior):
                        for key in list(match):
                            if key.endswith(f"_r{window}") and (key.startswith(prefix) or key.startswith(("combined_", "home_attack_vs_away_def", "away_attack_vs_home_def"))):
                                match[key] = None
                        if window == 5:
                            match[f"{prefix}win_streak"] = None
                            match[f"{prefix}loss_streak"] = None
                previous = history[-1] if history else None
                if previous is None or previous.get("_full_event_details") is not True:
                    for field in ("lineup_changes", "formation_changed", "back4_to_back3", "back3_to_back4", "red_prev"):
                        match[f"{prefix}{field}"] = None
                if previous is None or str(match.get(f"{prefix}xi_value_prev_match_id")) != str(previous.get("match_id")):
                    for key in list(match):
                        if key.startswith((f"{prefix}xi_value_change", f"{prefix}xi_value_prev_")):
                            match[key] = None
            history.append(match)


def finite(value, minimum=0, maximum=None, integer=False):
    if isinstance(value, bool) or value is None:
        return False
    try:
        value = float(value)
    except (ValueError, TypeError):
        return False
    return math.isfinite(value) and value >= minimum and (maximum is None or value <= maximum) and (not integer or value.is_integer())


def side_stats(data, side):
    stats = data.get("stats") or {}
    if not isinstance(stats, dict):
        return {}
    nested = stats.get(side)
    return nested if isinstance(nested, dict) else {key[len(side) + 1:]: value for key, value in stats.items() if key.startswith(f"{side}_")}


def event_quality(data):
    """Return independently auditable checks, and only pass their conjunction."""
    if not isinstance(data, dict):
        return {"complete": False, "checks": {name: False for name in ("identity", "statistics", "xg", "lineups", "timeline", "shotmap")}}
    score_match = re.fullmatch(r"\s*(\d+)\s*-\s*(\d+)\s*", str(data.get("score", "")))
    score = tuple(map(int, score_match.groups())) if score_match else None
    try:
        date.fromisoformat(str(data.get("date", ""))[:10])
        valid_date = True
    except ValueError:
        valid_date = False
    teams = [str(data.get(f"{side}_team_id") or "") for side in ("home", "away")]
    checks = {
        "identity": bool(valid_date and score is not None and data.get("match_id") and data.get("home_team") and data.get("away_team") and all(teams) and teams[0] != teams[1]),
        "statistics": True,
        "xg": True,
        "lineups": True,
        "timeline": isinstance(data.get("events"), list),
        "shotmap": isinstance(data.get("shots"), list),
    }
    stats = [side_stats(data, side) for side in ("home", "away")]
    lineups = data.get("lineups") or {}
    lineup_ids = []
    for side, values in zip(("home", "away"), stats):
        checks["statistics"] &= all(finite(values.get(key), integer=True) for key in ("shots", "shots_on_target", "corners", "fouls"))
        checks["statistics"] &= finite(values.get("possession"), maximum=100)
        if finite(values.get("shots")) and finite(values.get("shots_on_target")):
            checks["statistics"] &= float(values["shots_on_target"]) <= float(values["shots"])
        checks["xg"] &= finite(values.get("xg"))
        lineup = (lineups.get(side) or {}) if isinstance(lineups, dict) else {}
        if not isinstance(lineup, dict):
            lineup = {}
        players = lineup.get("starting_xi") or []
        identifiers = [str(player.get("player_id") or "") for player in players if isinstance(player, dict)] if isinstance(players, list) else []
        checks["lineups"] &= len(identifiers) == 11 and len(set(identifiers)) == 11 and all(identifiers) and bool(lineup.get("formation"))
        lineup_ids.append(set(identifiers))
    checks["lineups"] &= not bool(lineup_ids[0] & lineup_ids[1])
    if all(finite(values.get("possession"), maximum=100) for values in stats):
        checks["statistics"] &= abs(sum(float(values["possession"]) for values in stats) - 100) <= 1

    goals = []
    for event in data.get("events") or []:
        if not isinstance(event, dict):
            checks["timeline"] = False
            continue
        checks["timeline"] &= finite(event.get("minute"), maximum=130) and str(event.get("team_id") or "") in teams
        if event.get("type") == "Goal":
            goals.append(event)
    goals.sort(key=lambda event: (float(event["minute"]) if finite(event.get("minute")) else -1, float(event.get("added_time") or 0) if finite(event.get("added_time") or 0) else 0))
    previous = (0, 0)
    for event in goals:
        value = event.get("score_after")
        if not isinstance(value, (list, tuple)) or len(value) != 2 or not all(finite(goal, integer=True) for goal in value):
            checks["timeline"] = False
            continue
        current = tuple(map(int, value))
        checks["timeline"] &= tuple(current[index] - previous[index] for index in range(2)) in {(1, 0), (0, 1)}
        previous = current
    checks["timeline"] &= score is not None and previous == score
    # An absent event block in a carded 0-0 must not masquerade as a valid empty timeline.
    if not data.get("events") and any(finite(values.get(key)) and float(values[key]) > 0 for values in stats for key in ("yellow_cards", "red_cards")):
        checks["timeline"] = False

    # Older FotMob exports did not copy isOwnGoal onto the shot. An explicit
    # own-goal event with the same player and time is evidence, not imputation.
    own_goals = {(str(event.get("player_id")), event.get("minute"), event.get("added_time") or 0) for event in goals if event.get("is_own_goal") is True and event.get("player_id")}
    counts = {team: 0 for team in teams}
    for shot in data.get("shots") or []:
        if not isinstance(shot, dict):
            checks["shotmap"] = False
            continue
        team = str(shot.get("team_id") or "")
        checks["shotmap"] &= team in teams and finite(shot.get("minute"), maximum=130) and finite(shot.get("x"), maximum=110) and finite(shot.get("y"), maximum=110)
        own_goal = shot.get("is_own_goal") is True or (str(shot.get("player_id")), shot.get("minute"), shot.get("added_time") or 0) in own_goals
        checks["shotmap"] &= own_goal or finite(shot.get("expected_goals"), maximum=1)
        if team in counts and not own_goal:
            counts[team] += 1
    checks["shotmap"] &= all(finite(values.get("shots"), integer=True) and counts[team] == int(float(values["shots"])) for team, values in zip(teams, stats))
    return {"complete": all(checks.values()), "checks": {key: bool(value) for key, value in checks.items()}}
