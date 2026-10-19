import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from backfill_events import AccessStopped, Client, details_match_fixture, missing_fixtures, query_seasons


class BackfillTests(unittest.TestCase):
    def test_season_tokens(self):
        self.assertEqual(query_seasons("USA", "2022-2023"), ["2022"])
        self.assertEqual(query_seasons("E2", "2022-2023"), ["2022/2023"])
        self.assertEqual(query_seasons("MEX", "2022-2023"), ["2022/2023 - Apertura", "2022/2023 - Clausura"])

    def test_competition_and_season_metadata_are_required(self):
        client = Client(Path("unused-test-cache"), 1)
        for data in ({"details": {"id": 109, "selectedSeason": "2022/2023"}}, {"details": {"id": 108}}):
            with patch.object(client, "get", return_value=data):
                with self.assertRaises(ValueError):
                    client.get_league_data(108, "2022/2023")

    def test_returned_details_must_match_fixture(self):
        fixture = {"match_id": 123, "date": "2022-07-30", "home_id": 1, "away_id": 2}
        raw = {"general": {"matchId": "123", "matchTimeUTCDate": "2022-07-30T15:00:00Z", "homeTeam": {"id": 1}, "awayTeam": {"id": 2}}}
        self.assertTrue(details_match_fixture(raw, fixture))
        for key, value in (("matchId", "999"), ("matchTimeUTCDate", "2026-07-30T15:00:00Z"), ("homeTeam", {"id": 2})):
            changed = {"general": {**raw["general"], key: value}}
            self.assertFalse(details_match_fixture(changed, fixture))

    def test_already_complete_fixture_is_not_fetched_again(self):
        fixtures = [{"match_id": 123, "date": "2022-07-30", "home_team": "Home", "away_team": "Away", "score": "1 - 0"},
                    {"match_id": 124, "date": "2022-08-06", "home_team": "Home", "away_team": "Away", "score": "0 - 0"}]
        existing = {("E0", "2022-2023"): [{"league_code": "E0", "date": "2022-07-30", "home_team": "Home", "away_team": "Away", "fthg": 1, "ftag": 0, "match_id": "other-provider-id", "_full_event_details": True}]}
        self.assertEqual([row["match_id"] for row in missing_fixtures(fixtures, "E0", "2022-2023", existing, {}, {})], [124])

    def test_access_or_rate_limit_stops_without_bypass(self):
        client = Client(Path("unused-test-cache"), 1)
        for status in (401, 403, 429):
            with patch("backfill_events.urlopen", side_effect=HTTPError("https://www.fotmob.com", status, "Stop", {}, None)), patch("backfill_events.time.sleep"):
                with self.assertRaises(AccessStopped):
                    client.get_match_details(123)


if __name__ == "__main__":
    unittest.main()
