#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: scripts/study_buddy.sh '<prompt>' [--answers <path>|--auto-answer] [--max-pages <n>]" >&2
  exit 2
fi

cd "$(dirname "$0")/.."
export PYTHONPATH="${PYTHONPATH:-}:$PWD/src"
PYTHON_BIN="${PYTHON:-python3}"

"$PYTHON_BIN" -m uni_agent.assistant "$@"
