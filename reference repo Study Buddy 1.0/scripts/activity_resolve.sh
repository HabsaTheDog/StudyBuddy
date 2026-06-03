#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: scripts/activity_resolve.sh '<prompt>'" >&2
  exit 2
fi

cd "$(dirname "$0")/.."
export PYTHONPATH="${PYTHONPATH:-}:$PWD/src"
PYTHON_BIN="${PYTHON:-python3}"

"$PYTHON_BIN" -m uni_agent.orchestrator activity-resolve "$@"
