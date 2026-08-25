#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
STUDY_BUDDY_ROOT="${STUDY_BUDDY_ROOT:-${STUDY_BUDDY_WORKFLOW_ROOT:-$REPOSITORY_ROOT}}"
export STUDY_BUDDY_ROOT
INVOCATION_CWD="$(pwd -P)"
STUDY_BUDDY_WORKSPACE="${STUDY_BUDDY_WORKSPACE:-${T3CODE_CWD:-$INVOCATION_CWD}}"
if [[ "$STUDY_BUDDY_WORKSPACE" != /* ]]; then
  STUDY_BUDDY_WORKSPACE="$INVOCATION_CWD/$STUDY_BUDDY_WORKSPACE"
fi
if [[ ! -d "$STUDY_BUDDY_WORKSPACE" ]]; then
  echo "Study Buddy workspace not found at: $STUDY_BUDDY_WORKSPACE" >&2
  exit 1
fi
STUDY_BUDDY_WORKSPACE="$(cd "$STUDY_BUDDY_WORKSPACE" && pwd -P)"
STUDY_BUDDY_DATA_ROOT="$STUDY_BUDDY_WORKSPACE/study-buddy-data"
STUDY_BUDDY_THREAD_ID="${STUDY_BUDDY_THREAD_ID:-}"
STUDY_BUDDY_WORKSPACE_KIND="${STUDY_BUDDY_WORKSPACE_KIND:-}"
workspace_basename="$(basename "$STUDY_BUDDY_WORKSPACE")"
workspace_parent_basename="$(basename "$(dirname "$STUDY_BUDDY_WORKSPACE")")"
if [[ -z "$STUDY_BUDDY_WORKSPACE_KIND" && "$workspace_parent_basename" == "quick-chats" ]]; then
  STUDY_BUDDY_WORKSPACE_KIND="quick-chat"
fi
if [[ "$STUDY_BUDDY_WORKSPACE_KIND" == "quick-chat" && -z "$STUDY_BUDDY_THREAD_ID" ]]; then
  STUDY_BUDDY_THREAD_ID="$workspace_basename"
elif [[ -z "$STUDY_BUDDY_THREAD_ID" && -n "${CODEX_THREAD_ID:-}" ]]; then
  STUDY_BUDDY_THREAD_ID="$CODEX_THREAD_ID"
fi
safe_thread_id="$(printf '%s' "$STUDY_BUDDY_THREAD_ID" | sed -E 's/[^a-zA-Z0-9._-]+/-/g; s/^-+|-+$//g' | cut -c1-120)"
if [[ "$STUDY_BUDDY_WORKSPACE_KIND" == "quick-chat" ]] || \
  [[ -z "$STUDY_BUDDY_WORKSPACE_KIND" && -n "$STUDY_BUDDY_THREAD_ID" && "$workspace_parent_basename" == "quick-chats" && "$workspace_basename" == "$STUDY_BUDDY_THREAD_ID" ]]; then
  STUDY_BUDDY_THREAD_DATA_ROOT="$STUDY_BUDDY_DATA_ROOT"
elif [[ -n "$safe_thread_id" ]]; then
  STUDY_BUDDY_THREAD_DATA_ROOT="$STUDY_BUDDY_DATA_ROOT/threads/$safe_thread_id"
else
  STUDY_BUDDY_THREAD_DATA_ROOT="$STUDY_BUDDY_DATA_ROOT"
fi
export STUDY_BUDDY_WORKSPACE STUDY_BUDDY_THREAD_ID STUDY_BUDDY_WORKSPACE_KIND
STUDY_BUDDY_OUTPUT_ROOT="$STUDY_BUDDY_THREAD_DATA_ROOT/runs"
DEFAULT_MOODLE_URL="${STUDY_BUDDY_MOODLE_URL:-https://moodle.technikum-wien.at/my/}"
DEFAULT_CIS_URL="${STUDY_BUDDY_CIS_URL:-https://cis.technikum-wien.at/cis.php/}"
ACTIVE_CHILD_PID=""
ACTIVE_PROCESS_GROUP_ID=""
ACTIVE_RUN_DIR=""
ACTIVE_WATCHDOG_PID=""
ARTIFACT_LOCK_DIR="$STUDY_BUDDY_THREAD_DATA_ROOT/locks/.artifact-workflow.lock"
ARTIFACT_LOCK_HELD="false"

usage() {
  cat >&2 <<'USAGE'
Usage:
  study_buddy_task.sh prompt "<natural language prompt>" [--original-user-prompt "<exact user prompt>"] [--language de|en] [extra args]
  study_buddy_task.sh combined "<natural language prompt>" [--original-user-prompt "<exact user prompt>"] [--language de|en] [extra args]
  study_buddy_task.sh doc "<prompt>" [--original-user-prompt "<exact user prompt>"] [--language de|en] [extra args]
  study_buddy_task.sh extract "<prompt>" [--original-user-prompt "<exact user prompt>"] [--language de|en] [extra args]
  study_buddy_task.sh render "<prompt>" "<successful-extraction-run>" [--original-user-prompt "<exact user prompt>"] [--language de|en] [extra args]
  study_buddy_task.sh interactive-study-guide "<prompt>" [--language de|en] [extra args]
  study_buddy_task.sh interactive-study-guide-resume "<prompt>" <workflow-dir> [extra args]
  study_buddy_task.sh cheat-sheet "<prompt>" [--original-user-prompt "<exact user prompt>"] [--language de|en] [extra args]
  study_buddy_task.sh assignment-brief "<prompt>" [--original-user-prompt "<exact user prompt>"] [--language de|en] [extra args]
  study_buddy_task.sh quiz-url "<moodle quiz url>" [--original-user-prompt "<exact user prompt>"] [--language de|en] [extra args]
  study_buddy_task.sh diagnose "<prompt>" [--original-user-prompt "<exact user prompt>"] [--language de|en] [extra args]
  study_buddy_task.sh cancel "<run-dir>"
  study_buddy_task.sh status "<run-dir>"
  study_buddy_task.sh checkpoint "<run-dir>"
  study_buddy_task.sh wait "<run-dir>" [timeout-seconds]
  study_buddy_task.sh root
  study_buddy_task.sh workspace
  study_buddy_task.sh data-root
  study_buddy_task.sh output-root

Set STUDY_BUDDY_ROOT if the Study Buddy 2.0 root moved.
Set STUDY_BUDDY_WORKSPACE to override the workspace that receives study-buddy-data/.
Study Buddy T3 sets STUDY_BUDDY_THREAD_ID; upstream T3 falls back to CODEX_THREAD_ID so regular project threads receive separate run histories.
USAGE
}

require_nonempty_prompt() {
  local prompt_text="${1:-}"
  if [[ -z "${prompt_text//[[:space:]]/}" ]]; then
    echo "Study Buddy prompt must be non-empty; pass the exact user message as the positional prompt." >&2
    exit 2
  fi
}

require_root() {
  if [[ ! -d "$STUDY_BUDDY_ROOT" || ! -f "$STUDY_BUDDY_ROOT/package.json" ]]; then
    echo "Study Buddy 2.0 workspace not found at: $STUDY_BUDDY_ROOT" >&2
    echo "Set STUDY_BUDDY_ROOT to the Study Buddy 2.0 root path." >&2
    exit 1
  fi
  cd "$STUDY_BUDDY_ROOT"
}

needs_combined_sources() {
  local prompt_text="$1"
  [[ "$prompt_text" =~ (morgen|heute|nächste|naechste|Termin|Termine|termin|termine|Stundenplan|stundenplan|Timetable|timetable|Schedule|schedule|Einheit|einheit|Unterricht|unterricht|Class|class|LV|Lehrveranstaltung|lehrveranstaltung|Fachlabor|fachlabor|Labor|labor|Prüfung|Pruefung|prüfung|pruefung|Exam|exam|Deadline|deadline|Abgabe|abgabe|Raum|raum|Gruppe|gruppe|Lektor|lektor|Lektorin|lektorin|Anwesenheit|anwesenheit) ]]
}

needs_detailed_cis() {
  local prompt_text="$1"
  [[ "$prompt_text" =~ (morgen|heute|nächste|naechste|Termin|Termine|termin|termine|Stundenplan|stundenplan|Timetable|timetable|Schedule|schedule|Prüfung|Pruefung|prüfung|pruefung|Exam|exam|Deadline|deadline|Abgabe|abgabe|Raum|raum|Gruppe|gruppe|Lektor|lektor|Lektorin|lektorin|Anwesenheit|anwesenheit) ]]
}

is_quiz_task() {
  local prompt_text="$1"
  [[ "$prompt_text" =~ (Quiz|quiz|Test|test|Minitest|minitest|Kurztest|kurztest|Testblock|testblock|Selbstcheck|selbstcheck|Selfcheck|selfcheck|Moodle[[:space:]]*Test|moodle[[:space:]]*test) ]] &&
    [[ "$prompt_text" =~ (mach|Mach|mache|Mache|bearbeit|Bearbeit|füll|Füll|fuell|Fuell|ausfüll|Ausfüll|ausfuell|Ausfuell|lös|Lös|loes|Loes|answer|Answer|solve|Solve|fill|Fill|complete|Complete|start|Start) ]]
}

request_slug() {
  local input="$1"
  printf '%s' "$input" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's#https?://[^ ]+##g; s/[^a-z0-9äöüß_-]+/-/g; s/^-+|-+$//g; s/-+/-/g' \
    | cut -c1-80
}

prepare_run_dir() {
  local prompt_text="$1"
  local slug
  slug="$(request_slug "$prompt_text")"
  if [[ -z "$slug" ]]; then
    slug="moodle-run"
  fi
  local timestamp
  timestamp="$(date -u +%Y-%m-%dT%H-%M-%S-%3NZ)"
  ACTIVE_RUN_DIR="$STUDY_BUDDY_OUTPUT_ROOT/$slug/$timestamp"
  mkdir -p "$ACTIVE_RUN_DIR"
  printf '%s\n' "$ACTIVE_RUN_DIR"
}

cleanup_child() {
  stop_external_watchdog
  if [[ -n "${ACTIVE_CHILD_PID:-}" ]] && kill -0 "$ACTIVE_CHILD_PID" 2>/dev/null; then
    local target_group="${ACTIVE_PROCESS_GROUP_ID:-$ACTIVE_CHILD_PID}"
    kill -- "-$target_group" 2>/dev/null || kill "$ACTIVE_CHILD_PID" 2>/dev/null || true
    wait "$ACTIVE_CHILD_PID" 2>/dev/null || true
  fi
  if [[ -n "${ACTIVE_RUN_DIR:-}" && -f "$ACTIVE_RUN_DIR/run-summary.md" ]]; then
    {
      echo
      echo "Run status: canceled"
      echo "Canceled at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } >> "$ACTIVE_RUN_DIR/run-summary.md"
  fi
  release_artifact_lock
}

start_external_watchdog() {
  local run_dir="$1"
  local idle_timeout_ms="${STUDY_BUDDY_EXTERNAL_IDLE_TIMEOUT_MS:-360000}"
  local max_runtime_ms="${STUDY_BUDDY_EXTERNAL_MAX_RUNTIME_MS:-5400000}"
  ./node_modules/.bin/tsx src/custom-skills/moodle/runWatchdogCli.ts \
    --run-dir "$run_dir" \
    --pid "$ACTIVE_CHILD_PID" \
    --process-group-id "$ACTIVE_PROCESS_GROUP_ID" \
    --idle-timeout-ms "$idle_timeout_ms" \
    --max-runtime-ms "$max_runtime_ms" \
    > "$run_dir/watchdog.log" 2>&1 &
  ACTIVE_WATCHDOG_PID="$!"
}

stop_external_watchdog() {
  if [[ -n "${ACTIVE_WATCHDOG_PID:-}" ]]; then
    if kill -0 "$ACTIVE_WATCHDOG_PID" 2>/dev/null; then
      kill "$ACTIVE_WATCHDOG_PID" 2>/dev/null || true
    fi
    wait "$ACTIVE_WATCHDOG_PID" 2>/dev/null || true
    ACTIVE_WATCHDOG_PID=""
  fi
}

acquire_artifact_lock() {
  local workflow_dir="$1"
  mkdir -p "$STUDY_BUDDY_OUTPUT_ROOT" "$(dirname "$ARTIFACT_LOCK_DIR")"
  if ! mkdir "$ARTIFACT_LOCK_DIR" 2>/dev/null; then
    local owner_pid=""
    if [[ -f "$ARTIFACT_LOCK_DIR/owner.json" ]]; then
      owner_pid="$(node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); console.log(p.wrapper_pid || '')" "$ARTIFACT_LOCK_DIR/owner.json" 2>/dev/null || true)"
    fi
    if [[ -n "$owner_pid" ]] && kill -0 "$owner_pid" 2>/dev/null; then
      echo "Another Study Buddy artifact workflow is active. Reuse or wait for it instead of starting a replacement." >&2
      cat "$ARTIFACT_LOCK_DIR/owner.json" >&2
      return 73
    fi
    rm -rf "$ARTIFACT_LOCK_DIR"
    mkdir "$ARTIFACT_LOCK_DIR"
  fi
  ARTIFACT_LOCK_HELD="true"
  printf '{"wrapper_pid":%s,"workflow_dir":"%s","started_at":"%s"}\n' \
    "$$" "$workflow_dir" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$ARTIFACT_LOCK_DIR/owner.json"
}

release_artifact_lock() {
  if [[ "$ARTIFACT_LOCK_HELD" == "true" ]]; then
    rm -rf "$ARTIFACT_LOCK_DIR"
    ARTIFACT_LOCK_HELD="false"
  fi
}

run_agent_in_dir() {
  local prompt_text="$1"
  local run_dir="$2"
  shift 2
  require_root
  mkdir -p "$run_dir"
  ACTIVE_RUN_DIR="$run_dir"
  echo "Run directory: $run_dir"
  setsid npm run moodle:agent -- "$prompt_text" --url "$DEFAULT_MOODLE_URL" --run-dir "$run_dir" "$@" &
  ACTIVE_CHILD_PID="$!"
  local process_group_id
  process_group_id="$(ps -o pgid= -p "$ACTIVE_CHILD_PID" | tr -d ' ')"
  ACTIVE_PROCESS_GROUP_ID="${process_group_id:-$ACTIVE_CHILD_PID}"
  cat > "$run_dir/pid.json" <<EOF
{
  "wrapper_pid": $$,
  "child_pid": $ACTIVE_CHILD_PID,
  "process_group_id": ${process_group_id:-$ACTIVE_CHILD_PID},
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "command": "npm run moodle:agent"
}
EOF
  start_external_watchdog "$run_dir"
  trap cleanup_child INT TERM
  local status=0
  wait "$ACTIVE_CHILD_PID" || status=$?
  stop_external_watchdog
  ACTIVE_CHILD_PID=""
  ACTIVE_PROCESS_GROUP_ID=""
  ACTIVE_RUN_DIR=""
  trap - INT TERM
  return "$status"
}

run_agent() {
  local prompt_text="$1"
  shift
  require_root
  local run_dir
  run_dir="$(prepare_run_dir "$prompt_text")"
  run_agent_in_dir "$prompt_text" "$run_dir" "$@"
}

run_interactive_study_guide() {
  local prompt_text="$1"
  shift
  require_root
  local workflow_dir
  workflow_dir="$(prepare_run_dir "$prompt_text")"
  acquire_artifact_lock "$workflow_dir"
  ACTIVE_RUN_DIR="$workflow_dir"
  echo "Workflow directory: $workflow_dir"
  setsid npm run interactive-study-guide -- \
    "$prompt_text" \
    --url "$DEFAULT_MOODLE_URL" \
    --run-dir "$workflow_dir" \
    "$@" &
  ACTIVE_CHILD_PID="$!"
  local process_group_id
  process_group_id="$(ps -o pgid= -p "$ACTIVE_CHILD_PID" | tr -d ' ')"
  ACTIVE_PROCESS_GROUP_ID="${process_group_id:-$ACTIVE_CHILD_PID}"
  cat > "$workflow_dir/pid.json" <<EOF
{
  "wrapper_pid": $$,
  "child_pid": $ACTIVE_CHILD_PID,
  "process_group_id": ${process_group_id:-$ACTIVE_CHILD_PID},
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "command": "npm run interactive-study-guide"
}
EOF
  start_external_watchdog "$workflow_dir"
  trap cleanup_child INT TERM
  local status=0
  wait "$ACTIVE_CHILD_PID" || status=$?
  stop_external_watchdog
  ACTIVE_CHILD_PID=""
  ACTIVE_PROCESS_GROUP_ID=""
  ACTIVE_RUN_DIR=""
  trap - INT TERM
  release_artifact_lock
  return "$status"
}

resume_interactive_study_guide() {
  local prompt_text="$1"
  local workflow_dir="$2"
  shift 2
  require_root
  workflow_dir="$(realpath "$workflow_dir")"
  [[ -d "$workflow_dir" ]] || { echo "Workflow directory not found: $workflow_dir" >&2; return 2; }
  acquire_artifact_lock "$workflow_dir"
  ACTIVE_RUN_DIR="$workflow_dir"
  echo "Resuming workflow directory: $workflow_dir"
  setsid npm run interactive-study-guide -- \
    "$prompt_text" \
    --resume-run-dir "$workflow_dir" \
    "$@" &
  ACTIVE_CHILD_PID="$!"
  local process_group_id
  process_group_id="$(ps -o pgid= -p "$ACTIVE_CHILD_PID" | tr -d ' ')"
  ACTIVE_PROCESS_GROUP_ID="${process_group_id:-$ACTIVE_CHILD_PID}"
  cat > "$workflow_dir/pid.json" <<EOF
{
  "wrapper_pid": $$,
  "child_pid": $ACTIVE_CHILD_PID,
  "process_group_id": ${process_group_id:-$ACTIVE_CHILD_PID},
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "command": "npm run interactive-study-guide -- --resume-run-dir"
}
EOF
  start_external_watchdog "$workflow_dir"
  trap cleanup_child INT TERM
  local status=0
  wait "$ACTIVE_CHILD_PID" || status=$?
  stop_external_watchdog
  ACTIVE_CHILD_PID=""
  ACTIVE_PROCESS_GROUP_ID=""
  ACTIVE_RUN_DIR=""
  trap - INT TERM
  release_artifact_lock
  return "$status"
}

is_resumable_extraction() {
  local run_dir="$1"
  [[ -s "$run_dir/error.log" ]] || return 1
  grep -Eq 'Study Buddy run timed out after|Extraction checkpoint required:|Extraction capacity checkpoint required:|content_analyzer model call timed out after|Student-first coverage blocked publication:|Semantic quality review failed:|Quality reviewer failed:|Analyzer failed:' "$run_dir/error.log" || return 1
  [[ -s "$run_dir/source-map.json" ]] || return 1
  [[ -s "$run_dir/evidence-package.json" ]] || return 1
  [[ -s "$run_dir/coverage-report.json" ]] || return 1
  if [[ -s "$run_dir/extracted-data.json" ]]; then
    return 0
  fi
  if grep -Eq 'Extraction capacity checkpoint required:|content_analyzer model call timed out after' "$run_dir/error.log"; then
    return 0
  fi
  if grep -Eq 'Extraction checkpoint required:' "$run_dir/error.log"; then
    return 0
  fi
  if grep -Eq 'Student-first coverage blocked publication:' "$run_dir/error.log"; then
    return 0
  fi
  compgen -G "$run_dir/chapter-handoffs/*.json" >/dev/null
}

is_valid_extraction_handoff() {
  local run_dir="$1"
  [[ -d "$run_dir" ]] || return 1
  [[ -s "$run_dir/extracted-data.json" ]] || return 1
  [[ ! -s "$run_dir/error.log" ]] || return 1
  [[ -s "$run_dir/run-summary.md" ]] || return 1
  grep -Eq '^Route: extraction$' "$run_dir/run-summary.md" || return 1
  grep -Eq '^Run status: (success|partial)$' "$run_dir/run-summary.md" || return 1
}

run_staged_document() {
  local prompt_text="$1"
  shift
  local workflow_args=("$@")
  local has_execution_profile="false"
  for argument in "${workflow_args[@]}"; do
    if [[ "$argument" == "--execution-profile" || "$argument" == --execution-profile=* ]]; then
      has_execution_profile="true"
      break
    fi
  done
  if [[ "$has_execution_profile" == "false" ]]; then
    workflow_args+=(--execution-profile quality)
  fi
  require_root
  local workflow_dir
  workflow_dir="$(prepare_run_dir "$prompt_text")"
  local extraction_dir="$workflow_dir/extraction"
  local render_dir="$workflow_dir/render"
  local workflow_started_ms
  workflow_started_ms="$(date +%s%3N)"
  acquire_artifact_lock "$workflow_dir"
  trap cleanup_child INT TERM
  echo "Workflow directory: $workflow_dir"
  echo "Extraction run directory: $extraction_dir"

  local source_args=()
  if needs_combined_sources "$prompt_text"; then
    source_args+=(--cis-url "$DEFAULT_CIS_URL")
    if ! needs_detailed_cis "$prompt_text"; then
      source_args+=(--max-cis-pages 1)
    fi
  else
    source_args+=(--no-cis)
  fi
  local successful_extraction_dir="$extraction_dir"
  local current_extraction_dir="$extraction_dir"
  if ! run_agent_in_dir "$prompt_text" "$extraction_dir" --stage extract "${source_args[@]}" "${workflow_args[@]}"; then
    local extraction_recovered="false"
    local workflow_budget_ms
    workflow_budget_ms="$(node -e '
      const fs = require("fs");
      try {
        const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const requested = Number(value.totalWorkflowBudgetMs);
        const bounded = Number.isFinite(requested)
          ? Math.max(900000, Math.min(2280000, Math.floor(requested)))
          : 1560000;
        process.stdout.write(String(bounded));
      } catch { process.stdout.write("1560000"); }
    ' "$extraction_dir/adaptive-budget.json")"
    local workflow_deadline_ms=$((workflow_started_ms + workflow_budget_ms))
    export STUDY_BUDDY_WORKFLOW_DEADLINE_MS="$workflow_deadline_ms"

    local recovery_attempt
    for recovery_attempt in 1 2; do
      if ! is_resumable_extraction "$current_extraction_dir"; then
        break
      fi
      local now_ms
      now_ms="$(date +%s%3N)"
      local remaining_ms=$((workflow_deadline_ms - now_ms))
      if (( remaining_ms <= 180000 )); then
        echo "Adaptive workflow budget is exhausted; no recovery is started." >&2
        break
      fi
      local recovery_dir="$workflow_dir/extraction-recovery"
      if (( recovery_attempt > 1 )); then
        recovery_dir="$workflow_dir/extraction-recovery-$recovery_attempt"
      fi
      echo "Extraction reached a recoverable checkpoint; resuming without crawling sources."
      echo "Extraction recovery run directory: $recovery_dir"
      if run_agent_in_dir \
        "$prompt_text" \
        "$recovery_dir" \
        --stage extract \
        --resume-extraction-run-dir "$current_extraction_dir" \
        --max-pages 0 \
        --max-cis-pages 0 \
        --no-downloads \
        --no-cis \
        "${workflow_args[@]}"; then
        successful_extraction_dir="$recovery_dir"
        extraction_recovered="true"
        break
      fi
      current_extraction_dir="$recovery_dir"
    done
    if [[ "$extraction_recovered" != "true" ]]; then
      release_artifact_lock
      return 1
    fi
  fi
  if ! is_valid_extraction_handoff "$successful_extraction_dir"; then
    echo "Extraction did not produce a valid handoff; render stage will not start." >&2
    release_artifact_lock
    return 1
  fi

  echo "Extraction handoff ready: $successful_extraction_dir/extracted-data.json"
  if [[ -n "${STUDY_BUDDY_WORKFLOW_DEADLINE_MS:-}" ]]; then
    local render_remaining_ms=$((STUDY_BUDDY_WORKFLOW_DEADLINE_MS - $(date +%s%3N)))
    if (( render_remaining_ms <= 60000 )); then
      echo "Adaptive workflow budget left no safe render window." >&2
      release_artifact_lock
      return 1
    fi
  fi
  echo "Render run directory: $render_dir"
  if ! run_agent_in_dir \
    "$prompt_text" \
    "$render_dir" \
    --stage render \
    --source-run-dir "$successful_extraction_dir" \
    --max-pages 0 \
    --max-cis-pages 0 \
    --no-downloads \
    --no-cis \
    "${workflow_args[@]}"; then
    release_artifact_lock
    return 1
  fi
  release_artifact_lock
  trap - INT TERM
  echo "PDF ready: $render_dir/document.pdf"
}

cancel_run() {
  local run_dir="$1"
  local pid_file="$run_dir/pid.json"
  if [[ ! -f "$pid_file" ]]; then
    echo "No pid.json found at: $pid_file" >&2
    exit 1
  fi
  local pgid
  pgid="$(node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); console.log(p.process_group_id || p.child_pid || '')" "$pid_file")"
  if [[ -z "$pgid" ]]; then
    echo "No process group id found in: $pid_file" >&2
    exit 1
  fi
  kill -- "-$pgid" 2>/dev/null || kill "$pgid" 2>/dev/null || true
  if [[ -f "$run_dir/run-summary.md" ]]; then
    {
      echo
      echo "Run status: canceled"
      echo "Canceled at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } >> "$run_dir/run-summary.md"
  fi
}

status_run() {
  local run_dir="$1"
  if [[ ! -d "$run_dir" ]]; then
    echo "Run directory not found: $run_dir" >&2
    exit 1
  fi
  local process_state="unknown"
  if [[ -f "$run_dir/pid.json" ]]; then
    local pid
    pid="$(node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); console.log(p.child_pid || '')" "$run_dir/pid.json")"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      process_state="running"
    else
      process_state="stopped"
    fi
  fi
  echo "Process: $process_state"
  if [[ -f "$run_dir/run-summary.md" ]]; then
    sed -n '1,220p' "$run_dir/run-summary.md"
    if [[ "$process_state" == "stopped" ]] && grep -q "Run status: running" "$run_dir/run-summary.md"; then
      echo "Status warning: process stopped but summary is stale and still marked running"
    fi
  else
    echo "Run summary: missing"
  fi
  for artifact in document.typ document.pdf error.log source_coverage.json run-events.jsonl; do
    if [[ -s "$run_dir/$artifact" ]]; then
      echo "$artifact: present"
    elif [[ -e "$run_dir/$artifact" ]]; then
      echo "$artifact: empty"
    else
      echo "$artifact: missing"
    fi
  done
  if [[ "$process_state" == "stopped" && -s "$run_dir/document.typ" && -s "$run_dir/document.pdf" && ! -s "$run_dir/error.log" ]]; then
    echo "PDF ready: $run_dir/document.pdf"
  fi
}

checkpoint_run() {
  local run_dir="$1"
  if [[ ! -d "$run_dir" ]]; then
    echo "Run directory not found: $run_dir" >&2
    return 1
  fi
  node - "$run_dir" <<'NODE'
const fs = require("fs");
const path = require("path");

const runDir = process.argv[2];
const read = (name) => {
  try {
    return fs.readFileSync(path.join(runDir, name), "utf8");
  } catch {
    return "";
  }
};
const existsNonEmpty = (name) => {
  try {
    return fs.statSync(path.join(runDir, name)).size > 0;
  } catch {
    return false;
  }
};

let pid = null;
try {
  pid = JSON.parse(read("pid.json")).child_pid || null;
} catch {}
let processAlive = false;
if (pid) {
  try {
    process.kill(pid, 0);
    processAlive = true;
  } catch {}
}

const events = read("run-events.jsonl")
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter(Boolean);
const lastEvent = events.at(-1) || null;
const lastSemanticEvent = [...events]
  .reverse()
  .find((event) => event.phase !== "diagnostic") || null;
const summary = read("run-summary.md");
const terminalStatus = [...summary.matchAll(/^Run status:\s*(\S+)/gm)].at(-1)?.[1] || "unknown";
const error = read("error.log").trim();
let coverage = {};
try {
  coverage = JSON.parse(read("source_coverage.json"));
} catch {}
let config = {};
try {
  config = JSON.parse(read("config.json"));
} catch {}
const stage = config.stage || "all";

const completed =
  terminalStatus === "success" &&
  (
    stage === "extract"
      ? existsNonEmpty("extracted-data.json")
      : existsNonEmpty("document.typ") && existsNonEmpty("document.pdf")
  ) &&
  !error;
const blocked =
  Boolean(error) ||
  ["failed", "timeout", "canceled"].includes(terminalStatus) ||
  (!processAlive && !completed);

console.log(JSON.stringify({
  report: completed ? "completed" : blocked ? "blocked" : "progress",
  process_alive: processAlive,
  terminal_status: terminalStatus,
  stage,
  phase: lastSemanticEvent?.phase || lastEvent?.phase || "starting",
  current_action: lastSemanticEvent?.message || lastEvent?.message || "Run initialized",
  heartbeat_at: lastEvent?.timestamp || null,
  semantic_progress_at: lastSemanticEvent?.timestamp || null,
  active_sources: coverage?.moodle?.urls || coverage?.moodle?.attemptedUrls || [],
  next_action: completed
    ? "Validate and deliver artifacts"
    : blocked
      ? "Inspect blocker before retrying"
      : "Continue the same worker lease",
  blocker: error || (blocked ? `Process stopped with status ${terminalStatus}` : null),
  artifacts: [
    existsNonEmpty("extracted-data.json") ? path.join(runDir, "extracted-data.json") : null,
    existsNonEmpty("document.typ") ? path.join(runDir, "document.typ") : null,
    existsNonEmpty("document.pdf") ? path.join(runDir, "document.pdf") : null,
    ...(coverage?.moodle?.artifacts || []),
  ].filter(Boolean),
}, null, 2));
NODE
}

wait_run() {
  local run_dir="$1"
  local timeout_seconds="${2:-900}"
  local started_at
  started_at="$(date +%s)"
  while true; do
    local pid=""
    if [[ -f "$run_dir/pid.json" ]]; then
      pid="$(node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); console.log(p.child_pid || '')" "$run_dir/pid.json")"
    fi
    if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    if (( $(date +%s) - started_at >= timeout_seconds )); then
      echo "Timed out waiting for Study Buddy run: $run_dir" >&2
      checkpoint_run "$run_dir"
      return 124
    fi
    sleep 5
  done
  status_run "$run_dir"
  local stage="all"
  if [[ -f "$run_dir/config.json" ]]; then
    stage="$(node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); console.log(p.stage || 'all')" "$run_dir/config.json")"
  fi
  if [[ "$stage" == "extract" ]]; then
    if [[ ! -s "$run_dir/extracted-data.json" || -s "$run_dir/error.log" ]]; then
      return 1
    fi
  elif [[ ! -s "$run_dir/document.typ" || ! -s "$run_dir/document.pdf" || -s "$run_dir/error.log" ]]; then
    return 1
  fi
}

if [[ $# -lt 1 ]]; then
  usage
  exit 2
fi

action="$1"
shift

case "$action" in
  root)
    printf '%s\n' "$STUDY_BUDDY_ROOT"
    ;;
  workspace)
    printf '%s\n' "$STUDY_BUDDY_WORKSPACE"
    ;;
  data-root)
    printf '%s\n' "$STUDY_BUDDY_DATA_ROOT"
    ;;
  output-root)
    printf '%s\n' "$STUDY_BUDDY_OUTPUT_ROOT"
    ;;
  prompt)
    [[ $# -ge 1 ]] || { usage; exit 2; }
    prompt_text="$1"
    require_nonempty_prompt "$prompt_text"
    if is_quiz_task "$prompt_text"; then
      run_agent "$prompt_text" --max-pages 24 --auto-answer "${@:2}"
      exit $?
    fi
    if needs_combined_sources "$prompt_text"; then
      if needs_detailed_cis "$prompt_text"; then
        run_agent "$prompt_text" --cis-url "$DEFAULT_CIS_URL" "${@:2}"
      else
        run_agent "$prompt_text" --cis-url "$DEFAULT_CIS_URL" --max-cis-pages 1 "${@:2}"
      fi
    else
      run_agent "$prompt_text" --no-cis "${@:2}"
    fi
    ;;
  combined)
    [[ $# -ge 1 ]] || { usage; exit 2; }
    prompt_text="$1"
    require_nonempty_prompt "$prompt_text"
    shift
    run_agent "$prompt_text" --cis-url "$DEFAULT_CIS_URL" "$@"
    ;;
  doc)
    [[ $# -ge 1 ]] || { usage; exit 2; }
    prompt="$1"
    require_nonempty_prompt "$prompt"
    shift
    run_staged_document "$prompt" "$@"
    ;;
  extract)
    [[ $# -ge 1 ]] || { usage; exit 2; }
    prompt="$1"
    require_nonempty_prompt "$prompt"
    shift
    if needs_combined_sources "$prompt"; then
      run_agent "$prompt" --stage extract --cis-url "$DEFAULT_CIS_URL" "$@"
    else
      run_agent "$prompt" --stage extract --no-cis "$@"
    fi
    ;;
  render)
    [[ $# -ge 2 ]] || { usage; exit 2; }
    prompt="$1"
    require_nonempty_prompt "$prompt"
    source_run_dir="$2"
    shift 2
    if ! is_valid_extraction_handoff "$source_run_dir"; then
      echo "Refusing to render: source run is not a terminal successful/partial extraction with an empty error.log." >&2
      exit 1
    fi
    run_agent "$prompt" --stage render --source-run-dir "$source_run_dir" --max-pages 0 --max-cis-pages 0 --no-downloads --no-cis "$@"
    ;;
  interactive-study-guide)
    [[ $# -ge 1 ]] || { usage; exit 2; }
    prompt="$1"
    require_nonempty_prompt "$prompt"
    shift
    run_interactive_study_guide "$prompt" "$@"
    ;;
  interactive-study-guide-resume)
    [[ $# -ge 2 ]] || { usage; exit 2; }
    prompt="$1"
    require_nonempty_prompt "$prompt"
    workflow_dir="$2"
    shift 2
    resume_interactive_study_guide "$prompt" "$workflow_dir" "$@"
    ;;
  cheat-sheet)
    [[ $# -ge 1 ]] || { usage; exit 2; }
    prompt="$1"
    require_nonempty_prompt "$prompt"
    shift
    run_agent "$prompt" --no-cis "$@"
    ;;
  assignment-brief)
    [[ $# -ge 1 ]] || { usage; exit 2; }
    prompt="$1"
    require_nonempty_prompt "$prompt"
    shift
    if needs_combined_sources "$prompt"; then
      run_agent "$prompt" --cis-url "$DEFAULT_CIS_URL" "$@"
    else
      run_agent "$prompt" --no-cis "$@"
    fi
    ;;
  quiz-url)
    [[ $# -ge 1 ]] || { usage; exit 2; }
    url="$1"
    shift
    run_agent "bearbeite das Moodle Quiz $url" --max-pages 24 --auto-answer --no-cis "$@"
    ;;
  diagnose)
    [[ $# -ge 1 ]] || { usage; exit 2; }
    prompt="$1"
    require_nonempty_prompt "$prompt"
    shift
    run_agent "$prompt" --cis-url "$DEFAULT_CIS_URL" --diagnostic-only "$@"
    ;;
  cancel)
    [[ $# -ge 1 ]] || { usage; exit 2; }
    cancel_run "$1"
    ;;
  status)
    [[ $# -ge 1 ]] || { usage; exit 2; }
    status_run "$1"
    ;;
  checkpoint)
    [[ $# -ge 1 ]] || { usage; exit 2; }
    checkpoint_run "$1"
    ;;
  wait)
    [[ $# -ge 1 ]] || { usage; exit 2; }
    wait_run "$1" "${2:-900}"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "Unknown action: $action" >&2
    usage
    exit 2
    ;;
esac
