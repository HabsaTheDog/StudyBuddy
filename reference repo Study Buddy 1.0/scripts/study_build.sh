#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: scripts/study_build.sh '<prompt>' [--format markdown+pdf|markdown|typst|pdf] [--quiz-access ask|none|authorized] [--template auto|math_worked_solutions|study_guide|formula_sheet|theory_summary|assignment_brief|quiz_safe_review] [--sync-policy require-current|no-sync] [--max-repair-cycles N]" >&2
  exit 2
fi

cd "$(dirname "$0")/.."
export PYTHONPATH="${PYTHONPATH:-}:$PWD/src"
PYTHON_BIN="${PYTHON:-python3}"

"$PYTHON_BIN" -m uni_agent.orchestrator study-build "$@"
