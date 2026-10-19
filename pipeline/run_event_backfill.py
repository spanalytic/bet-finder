"""Background collection and index rebuild; publication is verified separately."""

import json
import os
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

from backfill_events import save_json


ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "sources" / "fotmob"
STATE = CACHE / "job-state.json"


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    # Windows releases this OS-level lock even after an interrupted process.
    import msvcrt
    with (CACHE / "job.lock").open("a+b") as lock:
        if lock.tell() == 0:
            lock.write(b"0")
            lock.flush()
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            raise SystemExit("An event backfill worker is already running; no duplicate was started.")
        state = {"pid": os.getpid(), "status": "running", "stage": "collection", "startedAt": datetime.now(timezone.utc).isoformat()}

        def update(**values):
            state.update(values, updatedAt=datetime.now(timezone.utc).isoformat())
            save_json(STATE, state)

        def run(script, *arguments):
            subprocess.run([sys.executable, "-u", str(ROOT / "pipeline" / script), *arguments], cwd=ROOT, check=True,
                           env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})

        update()
        try:
            pilot_path = CACHE / "pilot-report.json"
            while pilot_path.exists():
                pilot = json.loads(pilot_path.read_text(encoding="utf-8"))
                if pilot.get("status") != "running":
                    if pilot.get("status") == "access_stopped":
                        update(status="needs_attention", error=pilot.get("error", "Coverage pass stopped on an access error"))
                        return 1
                    break
                update(stage="waiting_for_coverage_pass")
                time.sleep(15)
            update(stage="collection")
            run("backfill_events.py", "--approved-access", "--through", "2026-10-01")
            report = json.loads((CACHE / "backfill-report.json").read_text(encoding="utf-8"))
            if report["status"] != "completed":
                update(status="needs_attention", error=report.get("error", report["status"]))
                return 1
            update(stage="audit", savedThisRun=report["saved"], requestedDetails=report["requestedDetails"])
            run("audit_events.py", "--through", "2026-10-01")
            update(stage="index_rebuild")
            run("build_index.py", "--through", "2026-10-01")
            index = json.loads((ROOT / "data" / "backtest-index.json").read_text(encoding="utf-8"))
            update(status="ready_for_release", stage="verification", indexedMatches=index["meta"]["matchCount"],
                   availableCompetitions=sum(item["matches"] > 0 for item in index["meta"]["competitions"]),
                   generatedAt=index["meta"]["generatedAt"])
            return 0
        except Exception as error:
            update(status="needs_attention", error=f"{type(error).__name__}: {error}")
            traceback.print_exc()
            return 1
        finally:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


if __name__ == "__main__":
    raise SystemExit(main())
