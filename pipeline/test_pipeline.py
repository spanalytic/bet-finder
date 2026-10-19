import unittest

from source_data import csv_match, last_prematch_price, merge_sources, regulation_score, season_key
from filter_quality import prune_filters, restrict_seasons


class SourceTests(unittest.TestCase):
    def test_no_seasons_before_2022_2023(self):
        self.assertEqual(restrict_seasons([{"season": "2021-2022"}, {"season": "2022-2023"}, {"season": "2026-2027"}]), [{"season": "2022-2023"}, {"season": "2026-2027"}])

    def test_filter_gate_counts_matches_not_markets_and_remaps_ordinals(self):
        records = [{"odds": {"home": 2, "away": 3}, "filterHits": [0, 2]} for _ in range(100)]
        records += [{"odds": {"home": 2}, "filterHits": [1]} for _ in range(99)]
        records += [{"odds": {"home": None}, "filterHits": [1]}]
        active, removed = prune_filters(records, [{"id": "keep-a"}, {"id": "rare"}, {"id": "keep-b"}])
        self.assertEqual([f["id"] for f in active], ["keep-a", "keep-b"])
        self.assertEqual(removed[0]["matches"], 99)
        self.assertEqual(records[0]["filterHits"], [0, 1])
        self.assertEqual(records[-1]["filterHits"], [])

    def test_cutoff_is_inclusive_and_completed_only(self):
        row = {"Date": "01/10/2026", "HomeTeam": "Home", "AwayTeam": "Away", "FTHG": "2", "FTAG": "1", "FTR": "H", "MaxCH": "2.1"}
        self.assertIsNotNone(csv_match(row, "E0", "2026-2027", "test", "2026-10-01"))
        self.assertIsNone(csv_match({**row, "Date": "02/10/2026"}, "E0", "2026-2027", "test", "2026-10-01"))
        self.assertIsNone(csv_match({**row, "FTHG": ""}, "E0", "2026-2027", "test", "2026-10-01"))
        self.assertIsNone(csv_match({**row, "FTR": "A"}, "E0", "2026-2027", "test", "2026-10-01"))

    def test_calendar_and_split_seasons(self):
        self.assertEqual(season_key("2026", "2026-05-01", "USA"), "2026-2027")
        self.assertEqual(season_key("2026/2027", "2026-09-01", "MEX"), "2026-2027")
        self.assertEqual(season_key("", "2026-05-01", "E0"), "2025-2026")

    def test_no_live_stale_or_invalid_betfair_prices(self):
        self.assertEqual(last_prematch_price({"-12": 2.1, "-5": 2.2, "-1": 2.3, "0": 4, "1": 5}), (-1, 2.3))
        self.assertEqual(last_prematch_price({"-11": 2, "0": 2, "-1": 1, "-2": "NaN"}), (None, None))

    def test_mixed_provider_ids_do_not_duplicate_fixtures(self):
        event = {"league_code": "E0", "date": "2026-10-01", "home_team": "Manchester United", "away_team": "Everton", "home_team_id": 10260, "away_team_id": 8668, "match_id": "123", "max_home": None, "_betfair": {"home": (-1, 2.5)}}
        odds = {"league_code": "E0", "date": "2026-10-01", "home_team": "Man United", "away_team": "Everton", "max_home": 2.8}
        merged = merge_sources([odds], [event], {"Man United": 35, "Manchester United": 35, "Everton": 48}, {"Man United": "Manchester United"})
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["max_home"], 2.8)
        self.assertEqual(merged[0]["_price_types"]["home"], "bookmaker")
        self.assertEqual(merged[0]["match_id"], "123")
        self.assertEqual(merged[0]["home_team_id"], 35)

    def test_betfair_only_used_for_a_missing_market(self):
        event = {"league_code": "UECL", "date": "2026-10-01", "home_team": "Home", "away_team": "Away", "max_home": None, "_betfair": {"home": (-2, 3.0), "over25": (-1, 2.1)}}
        merged = merge_sources([], [event], {}, {})[0]
        self.assertEqual(merged["max_home"], 3.0)
        self.assertEqual(merged["max_over25"], 2.1)
        self.assertEqual(merged["_price_types"]["over25"], "betfair")

    def test_uefa_extra_time_is_not_a_90_minute_win(self):
        data = {"score": "1-3", "events": [
            {"type": "Goal", "minute": 35, "added_time": None, "score_after": [0, 1]},
            {"type": "Goal", "minute": 55, "added_time": None, "score_after": [1, 1]},
            {"type": "Goal", "minute": 72, "added_time": None, "score_after": [1, 2]},
            {"type": "Goal", "minute": 120, "added_time": 9, "score_after": [1, 3]},
        ]}
        self.assertEqual(regulation_score(data), (1, 2))
        self.assertEqual(regulation_score({"score": "0-1", "events": [{"type": "Goal", "minute": 90, "added_time": 6, "score_after": [0, 1]}]}), (0, 1))

    def test_unique_fixture_anchor_reconciles_missing_alias(self):
        event = {"league_code": "E0", "date": "2026-10-01", "home_team": "Everton", "away_team": "Luton Town", "fthg": 2, "ftag": 1}
        odds = {**event, "away_team": "Luton", "max_home": 2.0}
        self.assertEqual(len(merge_sources([odds], [event], {}, {})), 1)


if __name__ == "__main__":
    unittest.main()
