#!/usr/bin/env python3
"""Inspect persisted obligation search state without starting a source/model run."""
import argparse
import json
import os
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


def read(root, name, fallback):
    try:
        return json.loads((root / name).read_text())
    except (OSError, ValueError):
        return fallback


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_dir", type=Path)
    parser.add_argument("--details", action="store_true")
    args = parser.parse_args()
    root = args.run_dir.resolve()
    if not root.is_dir():
        parser.error("run_dir does not exist")
    inventory = read(root, "obligation-inventory.json", {})
    course_progress = read(root, "obligation-search-progress.json", {})
    catalog = read(root, "course-inventory.json", {})
    cards = read(root, "obligation-evidence.json", [])
    triage = read(root, "obligation-triage.json", [])
    proof_cache = read(root, "source-evidence-cache.json", {})
    progress = read(root, "run-progress.json", {})
    metrics = read(root, "run-metrics.json", {})
    process_info = read(root, "pid.json", {})
    pid = process_info.get("child_pid")
    group_id = process_info.get("process_group_id")
    group_members = []
    if isinstance(group_id, int) and group_id > 1:
        for stat_file in Path("/proc").glob("[0-9]*/stat"):
            try:
                member = int(stat_file.parent.name)
                if os.getpgid(member) == group_id and stat_file.read_text().split(") ", 1)[1].split()[0] != "Z":
                    group_members.append(member)
            except (OSError, ValueError, IndexError):
                pass
    alive = False
    if isinstance(pid, int) and pid > 1:
        try:
            os.kill(pid, 0)
            alive = True
            stat = Path(f"/proc/{pid}/stat")
            if stat.exists() and stat.read_text().split(") ", 1)[1].split()[0] == "Z":
                alive = False
        except (ProcessLookupError, FileNotFoundError):
            pass
        except PermissionError:
            alive = True
    duration = progress.get("elapsedMs")
    recorded_status = progress.get("status", "unknown")
    status = recorded_status
    duration_kind = "reported"
    if (alive or group_members) and progress.get("startedAt"):
        duration = int((datetime.now(timezone.utc) - datetime.fromisoformat(progress["startedAt"].replace("Z", "+00:00"))).total_seconds() * 1000)
        duration_kind = "live_elapsed"
    elif recorded_status == "running":
        status = "stopped_without_final_status"
        duration_kind = "observed_until_last_event"
        try:
            events = [json.loads(line) for line in (root / "run-events.jsonl").read_text().splitlines() if line.strip()]
            started = datetime.fromisoformat(progress["startedAt"].replace("Z", "+00:00"))
            last = max(datetime.fromisoformat(event["timestamp"].replace("Z", "+00:00")) for event in events)
            duration = int((last - started).total_seconds() * 1000)
        except (OSError, ValueError, KeyError):
            pass
    facts = {fact["id"]: fact for fact in triage}
    facts.update({fact["id"]: fact for fact in inventory.get("facts", [])})
    courses = inventory.get("courses") or course_progress.get("courses", [])
    unresolved = [f for f in facts.values() if f["disposition"] == "needs_read"]
    result = {
        "run": root.name,
        "status": status,
        "recordedStatus": recorded_status,
        "workerAlive": alive,
        "processGroupAlive": bool(group_members),
        "processGroupMembers": sorted(group_members),
        "complete": inventory.get("complete", False),
        "enrollmentComplete": catalog.get("complete", False),
        "enrolledCourses": len(catalog.get("courses", [])),
        "courses": dict(Counter(c["status"] for c in courses)),
        "candidateActivities": len(cards) or course_progress.get("discoveredTasks", 0),
        "accountedActivities": len(facts),
        "detailReads": {"succeeded": sum(bool(c.get("read")) for c in cards), "failed": sum(bool(c.get("failed")) for c in cards)},
        "dispositions": dict(Counter(f["disposition"] for f in facts.values())),
        "sourceProofCache": {"hits": len(proof_cache.get("hits", [])), "writes": proof_cache.get("writes", 0)},
        "sourceDateUncertainties": sum(bool(f.get("dateUncertain")) for f in facts.values()),
        "gaps": len(inventory.get("gaps", [])),
        "unresolvedActivities": len(unresolved),
        "durationMs": duration,
        "durationKind": duration_kind,
        "model": metrics.get("totals", {}),
    }
    if args.details:
        result["gapDetails"] = inventory.get("gaps", [])
        result["uncertainDates"] = [
            {key: f.get(key) for key in ("label", "course", "url", "evidence", "reason")}
            for f in facts.values() if f.get("dateUncertain")
        ]
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
