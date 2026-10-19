"""Download public odds snapshots into this workspace, never the source project."""

import argparse
import csv
import io
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from competitions import EUROPEAN_CSV_CODES, EXTRA_CSV_CODES


def refresh(destination: Path, season: str):
    token = "".join(part[-2:] for part in season.split("-"))
    targets = [(f"{season}/{code}.csv", f"https://www.football-data.co.uk/mmz4281/{token}/{code}.csv") for code in EUROPEAN_CSV_CODES]
    targets += [(f"{code}.csv", f"https://www.football-data.co.uk/new/{code}.csv") for code in EXTRA_CSV_CODES]

    def fetch(target):
        relative, url = target
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 BetFinder-data-refresh"})
            with urllib.request.urlopen(request, timeout=40) as response:
                content = response.read()
            text = content.decode("utf-8-sig", errors="replace")
            reader = csv.DictReader(io.StringIO(text))
            if not reader.fieldnames or "Date" not in reader.fieldnames or not ({"HomeTeam", "Home"} & set(reader.fieldnames)):
                raise ValueError("Response is not a match CSV")
            rows = list(reader)
            if not rows:
                raise ValueError("CSV is empty")
            path = destination / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(".tmp")
            temporary.write_bytes(content)
            temporary.replace(path)
            print(f"  Refreshed {relative}: {len(rows)} rows", flush=True)
            return {"file": relative, "url": url, "rows": len(rows), "success": True}
        except Exception as error:
            print(f"  Refresh unavailable for {relative}: {error}", flush=True)
            return {"file": relative, "url": url, "success": False, "error": str(error)}

    with ThreadPoolExecutor(max_workers=5) as executor:
        results = list(executor.map(fetch, targets))
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "refresh-report.json").write_text(json.dumps({"retrievedAt": datetime.now(timezone.utc).isoformat(), "sources": results}, indent=2), encoding="utf-8")
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "sources")
    parser.add_argument("--season", default="2026-2027")
    args = parser.parse_args()
    refresh(args.output, args.season)
