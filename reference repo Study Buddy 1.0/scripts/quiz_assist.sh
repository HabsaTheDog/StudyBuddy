#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: scripts/quiz_assist.sh <quiz-url> [--fill-safe (--answers <path>|--auto-answer) --max-pages <n> --respect-review-only]" >&2
  exit 2
fi

cd "$(dirname "$0")/.."
export PYTHONPATH="${PYTHONPATH:-}:$PWD/src"
PYTHON_BIN="${PYTHON:-python3}"

"$PYTHON_BIN" -m uni_agent.orchestrator quiz "$@"
