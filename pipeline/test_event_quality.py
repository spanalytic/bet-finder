import copy
import unittest

from event_quality import complete_event_pool, event_quality, guard_history_gaps
from source_data import merge_sources


def detailed_record():
    return {
        "match_id": "123", "date": "2026-09-30", "home_team": "Home", "away_team": "Away",
        "home_team_id": 1, "away_team_id": 2, "score": "1-0",
        "stats": {side: {"shots": int(side == "home"), "shots_on_target": int(side == "home"), "xg": 0.2 if side == "home" else 0,
                         "possession": 50, "corners": 0, "fouls": 0, "yellow_cards": 0, "red_cards": 0} for side in ("home", "away")},
        "lineups": {side: {"formation": "4-4-2", "starting_xi": [{"player_id": offset + player} for player in range(1, 12)]} for side, offset in (("home", 0), ("away", 20))},
        "events": [{"type": "Goal", "minute": 30, "team_id": 1, "score_after": [1, 0]}],
        "shots": [{"minute": 30, "team_id": 1, "expected_goals": 0.2, "x": 90, "y": 34}],
    }


class EventQualityTests(unittest.TestCase):
    def test_rolling_windows_and_previous_match_do_not_skip_known_gaps(self):
        rows = [{"league_code": "E0", "season": "2022-2023", "date": f"2022-08-{day:02d}", "home_team": "Home", "away_team": "Away", "match_id": str(day), "_full_event_details": day != 5} for day in range(1, 7)]
        current = rows[-1]
        current.update(home_xg_r5=2, away_xg_r5=2, combined_xg_r5=4, home_attack_vs_away_def_r5=1, home_lineup_changes=4, home_formation_changed=True, home_xi_value_prev_match_id="4", home_xi_value_change_pct=10)
        guard_history_gaps(rows)
        for key in ("home_xg_r5", "away_xg_r5", "combined_xg_r5", "home_attack_vs_away_def_r5", "home_lineup_changes", "home_formation_changed", "home_xi_value_change_pct"):
            self.assertIsNone(current[key], key)

    def test_contiguous_complete_history_is_preserved(self):
        rows = [{"league_code": "E0", "season": "2022-2023", "date": f"2022-08-{day:02d}", "home_team": "Home", "away_team": "Away", "match_id": str(day), "_full_event_details": True} for day in range(1, 7)]
        rows[-1].update(home_xg_r5=2, home_lineup_changes=4, home_xi_value_prev_match_id="5", home_xi_value_change_pct=10)
        guard_history_gaps(rows)
        self.assertEqual(rows[-1]["home_xg_r5"], 2)
        self.assertEqual(rows[-1]["home_lineup_changes"], 4)
        self.assertEqual(rows[-1]["home_xi_value_change_pct"], 10)

    def test_only_explicit_complete_records_enter_the_pool(self):
        rows = [{"league_code": "E0", "match_id": "1", "_full_event_details": True},
                {"league_code": "E0", "match_id": "2", "_full_event_details": False}, {"league_code": "E0"}]
        eligible, counts = complete_event_pool(rows)
        self.assertEqual(eligible, rows[:1])
        self.assertEqual(dict(counts["E0"]), {"sourceMatches": 3, "completeMatches": 1, "incompleteEventMatches": 1, "missingEventMatches": 1})

    def test_complete_duplicate_wins_and_keeps_valid_odds(self):
        complete = {"league_code": "E0", "date": "2026-09-30", "home_team": "Home", "away_team": "Away", "match_id": "full", "_full_event_details": True, "_betfair": {}}
        partial = {**complete, "match_id": "partial", "_full_event_details": False, "_betfair": {"home": (-1, 2.5)}}
        for events in ([complete, partial], [partial, complete]):
            merged = merge_sources([], events, {}, {})
            self.assertEqual(len(merged), 1)
            self.assertTrue(merged[0]["_full_event_details"])
            self.assertEqual(merged[0]["match_id"], "full")
            self.assertEqual(merged[0]["max_home"], 2.5)

    def test_csv_prices_do_not_replace_validated_event_stats(self):
        event = {"league_code": "E0", "date": "2026-09-30", "home_team": "Home", "away_team": "Away", "match_id": "full", "_full_event_details": True, "hs": 10}
        csv = {"league_code": "E0", "date": "2026-09-30", "home_team": "Home", "away_team": "Away", "hs": 8, "max_home": 2.5}
        merged = merge_sources([csv], [event], {}, {})[0]
        self.assertEqual(merged["hs"], 10)
        self.assertEqual(merged["max_home"], 2.5)

    def test_detailed_record_without_weather_or_values_passes(self):
        self.assertTrue(event_quality(detailed_record())["complete"])

    def test_score_only_shell_is_not_complete(self):
        data = {"match_id": "1", "date": "2026-01-01", "score": "0-0", "home_team": "Home", "away_team": "Away"}
        self.assertFalse(event_quality(data)["complete"])

    def test_missing_xg_is_not_zero(self):
        data = detailed_record()
        data["stats"]["away"]["xg"] = None
        self.assertFalse(event_quality(data)["checks"]["xg"])
        data["stats"]["away"]["xg"] = "0.00"
        self.assertTrue(event_quality(data)["complete"])

    def test_duplicate_or_ten_player_lineup_fails(self):
        for players in ([{"player_id": 1}] * 11, [{"player_id": number} for number in range(10)]):
            data = detailed_record()
            data["lineups"]["home"]["starting_xi"] = players
            self.assertFalse(event_quality(data)["checks"]["lineups"])

    def test_goal_sequence_must_reconcile_to_final_score(self):
        data = detailed_record()
        data["events"] = []
        self.assertFalse(event_quality(data)["checks"]["timeline"])
        data = detailed_record()
        data["events"][0]["score_after"] = [2, 0]
        self.assertFalse(event_quality(data)["checks"]["timeline"])

    def test_shotmap_must_be_detailed_and_reconciled(self):
        for mutate in (lambda d: d.update(shots=[]), lambda d: d["shots"][0].update(team_id=99),
                       lambda d: d["shots"][0].update(expected_goals=None), lambda d: d["shots"][0].update(x=None)):
            data = detailed_record()
            mutate(data)
            self.assertFalse(event_quality(data)["checks"]["shotmap"])

    def test_legacy_own_goal_uses_explicit_timeline_evidence(self):
        data = detailed_record()
        data["events"][0].update(is_own_goal=True, player_id=25)
        data["shots"][0].update(player_id=25, team_id=2, expected_goals=None)
        data["stats"]["home"].update(shots=0, shots_on_target=0, xg=0)
        self.assertTrue(event_quality(data)["complete"])
        data["events"][0]["is_own_goal"] = False
        self.assertFalse(event_quality(data)["checks"]["shotmap"])

    def test_same_player_cannot_start_for_both_teams(self):
        data = detailed_record()
        data["lineups"]["away"]["starting_xi"][0]["player_id"] = 1
        self.assertFalse(event_quality(data)["checks"]["lineups"])

    def test_real_zero_shot_goalless_record_can_pass(self):
        data = detailed_record()
        data.update(score="0-0", events=[], shots=[])
        data["stats"]["home"].update(shots=0, shots_on_target=0, xg=0)
        self.assertTrue(event_quality(data)["complete"])
        data["stats"]["home"]["yellow_cards"] = 1
        self.assertFalse(event_quality(data)["checks"]["timeline"])

    def test_invalid_numbers_and_flat_stats(self):
        data = detailed_record()
        data["stats"] = {f"{side}_{key}": value for side, values in data["stats"].items() for key, value in values.items()}
        self.assertTrue(event_quality(data)["complete"])
        for value in (True, "NaN", "Infinity", -1):
            invalid = copy.deepcopy(data)
            invalid["stats"]["home_shots"] = value
            self.assertFalse(event_quality(invalid)["complete"])


if __name__ == "__main__":
    unittest.main()
