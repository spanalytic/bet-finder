"""Resumable, rate-limited FotMob backfill using user-approved access only.

No browser automation, signed-header fabrication, endpoint probing or source
project writes. A 401/403/429 stops the run. Only validated detailed records
enter data/sources/events; incomplete responses are recorded, not promoted.
"""

import argparse
import copy
import hashlib
import json
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from competitions import COMPETITIONS
from event_quality import EVENT_QUALITY_VERSION, event_quality
from source_data import date_iso, merge_sources


# Existing source-project config plus official FotMob competition pages.
# English lower divisions 108/109/117; Scottish lower divisions 123/124/125;
# LaLiga2 140; Italian Serie B 86; Ligue 2 110; Belgian First Division A 40.
FOTMOB_IDS = {
    "E0": 47, "E1": 48, "E2": 108, "E3": 109, "EC": 117,
    "SC0": 64, "SC1": 123, "SC2": 124, "SC3": 125,
    "D1": 54, "D2": 146, "SP1": 87, "SP2": 140, "I1": 55,
    "I2": 86, "F1": 53, "F2": 110, "N1": 57, "B1": 40,
    "P1": 61, "T1": 71, "G1": 135, "USA": 130, "BRA": 268,
    "MEX": 230, "ARG": 112, "JPN": 223, "NOR": 59, "AUS": 113,
    "SAU": 536, "UCL": 42, "UEL": 73, "UECL": 10216,
}


class AccessStopped(RuntimeError):
    pass


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temporary.replace(path)


class Client:
    def __init__(self, cache, interval):
        self.cache, self.interval, self.last_request = cache, max(0.5, interval), 0

    def get(self, endpoint, parameters, cache_fixture=False):
        url = "https://www.fotmob.com/api/data/" + endpoint + "?" + urlencode(parameters)
        path = self.cache / "fotmob" / "fixtures" / (hashlib.sha256(url.encode()).hexdigest() + ".json")
        if cache_fixture and path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
        time.sleep(max(0, self.interval - (time.monotonic() - self.last_request)))
        self.last_request = time.monotonic()
        try:
            with urlopen(Request(url, headers={"Accept": "application/json", "User-Agent": "BetFinderDataQuality/1.0"}), timeout=35) as response:
                data = json.load(response)
        except HTTPError as error:
            if error.code in (401, 403, 429):
                raise AccessStopped(f"HTTP {error.code}: stopped; confirm access or wait for the provider's rate-limit reset. No bypass attempted.") from error
            raise
        if not isinstance(data, dict):
            raise ValueError("Provider returned an unexpected response shape")
        if cache_fixture:
            save_json(path, data)
        return data

    def get_league_data(self, league_id, season):
        data = self.get("leagues", {"id": league_id, "season": season}, cache_fixture=True)
        details = data.get("details") or {}
        if str(details.get("id")) != str(league_id):
            raise ValueError("Returned competition ID does not match the request")
        if not (details.get("selectedSeason") or (data.get("overview") or {}).get("selectedSeason")):
            raise ValueError("Provider did not identify the returned season; refusing an unverified season")
        return data

    def get_match_details(self, match_id):
        return self.get("matchDetails", {"matchId": match_id})


def query_seasons(code, season):
    token = season[:4] if COMPETITIONS[code][3] else season.replace("-", "/")
    return [f"{token} - Apertura", f"{token} - Clausura"] if code == "MEX" else [token]


def details_match_fixture(data, fixture):
    """Never relabel a current shell or mismatched response as historical data."""
    general = data.get("general") or {}
    status = (data.get("header") or {}).get("status") or {}
    if "finished" in status and status["finished"] is not True:
        return False
    return (str(general.get("matchId")) == str(fixture["match_id"])
            and date_iso(general.get("matchTimeUTCDate")) == fixture["date"]
            and str((general.get("homeTeam") or {}).get("id")) == str(fixture["home_id"])
            and str((general.get("awayTeam") or {}).get("id")) == str(fixture["away_id"]))


def existing_records(audit):
    records = defaultdict(list)
    for row in audit.get("files", []):
        score = re.fullmatch(r"\s*(\d+)\s*-\s*(\d+)\s*", str(row.get("score", "")))
        if not row.get("complete") or not score:
            continue
        records[(row["leagueCode"], row["season"])].append({
            "league_code": row["leagueCode"], "date": row["date"], "home_team": row["home"], "away_team": row["away"],
            "fthg": int(score[1]), "ftag": int(score[2]), "match_id": row["matchId"], "_full_event_details": True,
        })
    return records


def missing_fixtures(fixtures, code, season, existing, fd_names, aliases):
    rows = []
    for fixture in fixtures:
        score = re.fullmatch(r"\s*(\d+)\s*-\s*(\d+)\s*", fixture.get("score", ""))
        if score:
            rows.append({"league_code": code, "date": fixture["date"], "home_team": fixture["home_team"], "away_team": fixture["away_team"],
                         "fthg": int(score[1]), "ftag": int(score[2]), "_fotmob_id": fixture["match_id"]})
    merged = merge_sources(rows, copy.deepcopy(existing.get((code, season), [])), fd_names, aliases)
    missing = {row["_fotmob_id"] for row in merged if row.get("_fotmob_id") and not row.get("_full_event_details")}
    return [fixture for fixture in fixtures if fixture["match_id"] in missing]


def run(args):
    if not args.approved_access:
        raise SystemExit("Use only with provider-approved access. Confirm permission before passing --approved-access.")
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(args.source_root.resolve()))
    from fetchers.fotmob import extract_match_events, get_league_matches
    from config.team_mappings import FOOTBALL_DATA_TEAM_NAMES, SOFASCORE_TEAM_NAMES
    from scripts.add_ou25_odds import TEAM_NAME_MAP
    aliases = dict(TEAM_NAME_MAP)
    for mapping in SOFASCORE_TEAM_NAMES.values():
        if isinstance(mapping, dict):
            aliases.update({key: value for key, value in mapping.items() if isinstance(value, str)})
    cache = args.cache.resolve()
    audit_path = cache / "event-audit.json"
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    if audit.get("qualityVersion") != EVENT_QUALITY_VERSION:
        raise SystemExit("Re-run audit_events.py first; its quality version is out of date.")
    existing = existing_records(audit)
    attempt_path = cache / "fotmob" / f"attempts-v{EVENT_QUALITY_VERSION}.json"
    attempts = json.loads(attempt_path.read_text(encoding="utf-8")) if attempt_path.exists() else {}
    report_path = cache / "fotmob" / ("pilot-report.json" if args.pilot else "backfill-report.json")
    report = {"startedAt": datetime.now(timezone.utc).isoformat(), "status": "running", "qualityVersion": EVENT_QUALITY_VERSION,
              "cutoffDate": args.through, "firstSeason": "2022-2023", "pilot": args.pilot, "saved": 0, "requestedDetails": 0, "cells": []}
    client = Client(cache, args.interval)
    codes = args.competition or sorted(COMPETITIONS, key=lambda code: (COMPETITIONS[code][2] is not None, list(COMPETITIONS).index(code)))
    seasons = args.season or [f"{year}-{year + 1}" for year in range(2022, 2027)]
    try:
        for code in codes:
            for season in seasons:
                cell = {"code": code, "season": season, "fixtures": 0, "missingBefore": 0, "attempted": 0, "saved": 0, "cached": 0, "rejected": {}, "errors": []}
                report["cells"].append(cell)
                fixtures = {}
                try:
                    for token in query_seasons(code, season):
                        for fixture in get_league_matches(FOTMOB_IDS[code], token, client):
                            if fixture["date"] and fixture["date"] <= args.through and not fixture.get("cancelled"):
                                fixtures[fixture["match_id"]] = fixture
                    candidates = missing_fixtures(list(fixtures.values()), code, season, existing, FOOTBALL_DATA_TEAM_NAMES, aliases)
                    candidates.sort(key=lambda fixture: (fixture["date"], fixture["match_id"]))
                    cell.update(fixtures=len(fixtures), missingBefore=len(candidates))
                    if args.pilot and len(candidates) > args.pilot:
                        indexes = sorted({round(i * (len(candidates) - 1) / max(1, args.pilot - 1)) for i in range(args.pilot)})
                        candidates = [candidates[index] for index in indexes]
                    for fixture in candidates:
                        key = f"{code}/{season}/{fixture['match_id']}"
                        output = cache / "events" / code / season / f"{fixture['match_id']}.json"
                        if output.exists() and event_quality(json.loads(output.read_text(encoding="utf-8")))["complete"]:
                            cell["cached"] += 1
                            continue
                        if key in attempts and not attempts[key].get("complete") and not args.retry_rejected:
                            continue
                        if args.max_details and report["requestedDetails"] >= args.max_details:
                            report["status"] = "limit_reached"
                            return report
                        report["requestedDetails"] += 1
                        cell["attempted"] += 1
                        try:
                            raw = client.get_match_details(fixture["match_id"])
                            if not details_match_fixture(raw, fixture):
                                raise ValueError("Fixture identity mismatch; no metadata relabelling allowed")
                            record = extract_match_events(raw, season.replace("-", "/"))
                            if record["score"].replace(" ", "") != fixture["score"].replace(" ", ""):
                                raise ValueError("Final score mismatch with league fixture")
                            quality = event_quality(record)
                            failed = [name for name, passed in quality["checks"].items() if not passed]
                            if quality["complete"]:
                                record["source"] = {"provider": "FotMob", "downloadedAt": datetime.now(timezone.utc).isoformat(), "qualityVersion": EVENT_QUALITY_VERSION}
                                save_json(output, record)
                                report["saved"] += 1
                                cell["saved"] += 1
                            else:
                                for name in failed:
                                    cell["rejected"][name] = cell["rejected"].get(name, 0) + 1
                            attempts[key] = {"complete": quality["complete"], "failedChecks": failed}
                        except (ValueError, TypeError, KeyError, HTTPError, URLError, TimeoutError) as error:
                            cell["errors"].append(f"{fixture['match_id']}: {type(error).__name__}: {error}")
                        if cell["attempted"] % 25 == 0:
                            print(f"{code} {season}: {cell['saved']} complete saved / {cell['attempted']} attempted", flush=True)
                            save_json(attempt_path, attempts)
                            save_json(report_path, report)
                except AccessStopped:
                    raise
                except (ValueError, TypeError, KeyError, HTTPError, URLError, TimeoutError) as error:
                    cell["errors"].append(f"{type(error).__name__}: {error}")
                print(f"{COMPETITIONS[code][0]} {season}: {cell['fixtures']} fixtures; {cell['missingBefore']} gaps; saved {cell['saved']}; rejected {cell['rejected']}; errors {len(cell['errors'])}", flush=True)
                save_json(attempt_path, attempts)
                save_json(report_path, report)
        report["status"] = "completed"
    except AccessStopped as error:
        report.update(status="access_stopped", error=str(error))
        print(str(error), flush=True)
    finally:
        report["updatedAt"] = datetime.now(timezone.utc).isoformat()
        save_json(attempt_path, attempts)
        save_json(report_path, report)
        print(f"{report['status']}: {report['saved']} complete records saved from {report['requestedDetails']} new detail requests. Report: {report_path}", flush=True)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=Path(r"C:\Users\thoma\PyCharmMiscProject"))
    parser.add_argument("--cache", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "sources")
    parser.add_argument("--through", default="2026-10-01")
    parser.add_argument("--competition", action="append", choices=FOTMOB_IDS)
    parser.add_argument("--season", action="append", choices=[f"{year}-{year + 1}" for year in range(2022, 2027)])
    parser.add_argument("--approved-access", action="store_true")
    parser.add_argument("--interval", type=float, default=1.0)
    parser.add_argument("--pilot", type=int, default=0, help="Sample up to N missing fixtures per league/season, spread through time")
    parser.add_argument("--max-details", type=int, default=0, help="Stop after N detail requests; zero is unlimited")
    parser.add_argument("--retry-rejected", action="store_true")
    run(parser.parse_args())
