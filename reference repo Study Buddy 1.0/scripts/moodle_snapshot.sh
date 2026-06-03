#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
export PYTHONPATH="${PYTHONPATH:-}:$PWD/src"
PYTHON_BIN="${PYTHON:-python3}"

if [[ $# -gt 0 ]]; then
  "$PYTHON_BIN" -m uni_agent.orchestrator snapshot "$1"
else
  "$PYTHON_BIN" -m uni_agent.orchestrator snapshot
fi
