"""Read-only audit of local event files; no network or source-project writes."""

import argparse
import json
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from competitions import COMPETITIONS
from event_quality import EVENT_QUALITY_VERSION, FULL_EVENT_REQUIREMENTS, event_quality
from filter_quality import FIRST_SEASON
from source_data import date_iso, event_paths, season_key


def audit(root, cutoff, output):
    competitions = []
    manifest = []
    for code, (name, _, directory, _) in COMPETITIONS.items():
        paths = event_paths(root, code, output.parent)

        def read(path):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                day = date_iso(data.get("date"))
                if not day or day > cutoff or season_key(path.parent.name, day, code) < FIRST_SEASON:
                    return None
                quality = event_quality(data)
                return {"leagueCode": code, "season": season_key(path.parent.name, day, code), "date": day, "matchId": str(data.get("match_id") or ""), "home": data.get("home_team"), "away": data.get("away_team"), "score": data.get("score"), "path": str(path), **quality}
            except (ValueError, TypeError, OSError) as error:
                return {"leagueCode": code, "path": str(path), "error": type(error).__name__, "complete": False, "checks": {}}

        with ThreadPoolExecutor(max_workers=8) as executor:
            rows = [row for row in executor.map(read, paths) if row]
        manifest.extend(rows)
        checks = Counter(key for row in rows for key, value in row["checks"].items() if value)
        failed = Counter(key for row in rows for key, value in row["checks"].items() if not value)
        summary = {"code": code, "name": name, "files": len(rows), "completeFiles": sum(row["complete"] for row in rows), "passedChecks": dict(checks), "failedChecks": dict(failed), "errors": sum("error" in row for row in rows)}
        competitions.append(summary)
        print(f"{name}: {summary['completeFiles']:,}/{len(rows):,} detailed files; failures {dict(failed)}", flush=True)
    report = {"generatedAt": datetime.now(timezone.utc).isoformat(), "qualityVersion": EVENT_QUALITY_VERSION, "firstSeason": FIRST_SEASON, "cutoffDate": cutoff, "requirements": FULL_EVENT_REQUIREMENTS, "note": "File counts, not independently reconciled fixture coverage. Alternate EPL FotMob files are included. No downloads attempted.", "competitions": competitions, "files": manifest}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Audit saved to {output}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=Path(r"C:\Users\thoma\PyCharmMiscProject"))
    parser.add_argument("--through", default="2026-10-01")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "sources" / "event-audit.json")
    args = parser.parse_args()
    audit(args.source_root.resolve(), args.through, args.output.resolve())
