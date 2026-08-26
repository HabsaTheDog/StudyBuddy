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
ACTIVE_WORKFLOW_DIR=""
ACTIVE_WORKFLOW_EXTRACTION_DIR=""
ACTIVE_WORKFLOW_RENDER_DIR=""
ARTIFACT_LOCK_DIR="$STUDY_BUDDY_THREAD_DATA_ROOT/locks/.artifact-workflow.lock"
ARTIFACT_LOCK_HELD="false"
ARTIFACT_LOCK_TOKEN=""

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
  PROMPT_TEXT="$prompt_text" node <<'NODE'
const prompt = process.env.PROMPT_TEXT || "";
const quiz = String.raw`(?:moodle[ -]?)?(?:quiz(?:zes)?|tests?|minitests?|kurztests?|testblocks?|self[ -]?checks?|selbsttests?|selbstkontrollen?)`;
const action = String.raw`(?:mach(?:e)?|bearbeit\w*|füll\w*|fuell\w*|ausfüll\w*|ausfuell\w*|lös\w*|loes\w*|answer\w*|solve\w*|fill\w*|complete\w*|start\w*)`;
const documentArtifact = /\b(?:pdfs?|lernzettel|formelsammlung|skript|typst|dokument|document|study guide|worksheet|cheat sheet)\b/iu;
if (documentArtifact.test(prompt)) process.exit(1);
const explicitTarget = new RegExp(
  String.raw`(?:\b${action}\b.{0,48}\b${quiz}\b|\b${quiz}\b.{0,48}\b${action}\b)`,
  "iu",
);
process.exit(explicitTarget.test(prompt) ? 0 : 1);
NODE
}

classify_prompt_intent() {
  local prompt_text="$1"
  require_root
  ./node_modules/.bin/tsx src/custom-skills/moodle/taskIntentCli.ts "$prompt_text"
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
    if [[ ! -d "$ARTIFACT_LOCK_DIR" ]]; then
      echo "Could not create the Study Buddy artifact lock at: $ARTIFACT_LOCK_DIR" >&2
      return 1
    fi
    echo "Another Study Buddy artifact workflow is active, initializing, or left a stale lock." >&2
    echo "Reuse or wait for it; only remove a stale lock after verifying that its owner process is no longer running." >&2
    node -e '
      const fs = require("fs");
      try {
        const owner = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const pid = Number.isInteger(Number(owner.wrapper_pid)) ? Number(owner.wrapper_pid) : "unknown";
        const workflow = typeof owner.workflow_dir === "string" ? owner.workflow_dir : "unknown";
        const started = typeof owner.started_at === "string" ? owner.started_at : "unknown";
        console.error(`Lock owner: pid=${pid} workflow=${JSON.stringify(workflow)} started=${JSON.stringify(started)}`);
      } catch {}
    ' "$ARTIFACT_LOCK_DIR/owner.json" 2>/dev/null || true
    return 73
  fi
  ARTIFACT_LOCK_HELD="true"
  ARTIFACT_LOCK_TOKEN="$$-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM:-0}"
  local owner_tmp="$ARTIFACT_LOCK_DIR/owner.$ARTIFACT_LOCK_TOKEN.tmp"
  if ! node -e '
    const fs = require("fs");
    const payload = {
      wrapper_pid: Number(process.argv[2]),
      workflow_dir: process.argv[3],
      started_at: process.argv[4],
      lock_token: process.argv[5],
    };
    fs.writeFileSync(process.argv[1], `${JSON.stringify(payload)}\n`, { mode: 0o600 });
  ' "$owner_tmp" "$$" "$workflow_dir" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ARTIFACT_LOCK_TOKEN"; then
    rm -f "$owner_tmp"
    rmdir "$ARTIFACT_LOCK_DIR" 2>/dev/null || true
    ARTIFACT_LOCK_HELD="false"
    ARTIFACT_LOCK_TOKEN=""
    return 1
  fi
  if ! mv "$owner_tmp" "$ARTIFACT_LOCK_DIR/owner.json"; then
    rm -f "$owner_tmp"
    rmdir "$ARTIFACT_LOCK_DIR" 2>/dev/null || true
    ARTIFACT_LOCK_HELD="false"
    ARTIFACT_LOCK_TOKEN=""
    return 1
  fi
}

release_artifact_lock() {
  if [[ "$ARTIFACT_LOCK_HELD" == "true" ]]; then
    local owner_token=""
    if [[ -f "$ARTIFACT_LOCK_DIR/owner.json" ]]; then
      owner_token="$(node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); process.stdout.write(typeof p.lock_token === 'string' ? p.lock_token : '')" "$ARTIFACT_LOCK_DIR/owner.json" 2>/dev/null || true)"
    fi
    if [[ -n "$ARTIFACT_LOCK_TOKEN" && "$owner_token" == "$ARTIFACT_LOCK_TOKEN" ]]; then
      rm -f "$ARTIFACT_LOCK_DIR/owner.json"
      rmdir "$ARTIFACT_LOCK_DIR" 2>/dev/null || true
    fi
    ARTIFACT_LOCK_HELD="false"
    ARTIFACT_LOCK_TOKEN=""
  fi
}

trap release_artifact_lock EXIT

process_start_identity() {
  local pid="$1"
  node - "$pid" <<'NODE'
const fs = require("fs");
const { execFileSync } = require("child_process");
const pid = Number(process.argv[2]);
if (!Number.isInteger(pid) || pid <= 0) process.exit(2);
try {
  const value = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
  const afterCommand = value.slice(value.lastIndexOf(")") + 2).trim().split(/\s+/u);
  const startTicks = afterCommand[19];
  if (!/^[0-9]+$/u.test(startTicks ?? "")) process.exit(3);
  process.stdout.write(`proc:${startTicks}`);
} catch {
  try {
    const started = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
    }).trim().replace(/\s+/gu, " ");
    if (!started) process.exit(4);
    process.stdout.write(`ps:${started}`);
  } catch {
    process.exit(4);
  }
}
NODE
}

write_staged_document_summary() {
  local workflow_dir="$1"
  local status="$2"
  local error_message="${3:-}"
  local extraction_dir="$4"
  local render_dir="$5"
  node - "$workflow_dir" "$status" "$error_message" "$extraction_dir" "$render_dir" <<'NODE'
const fs = require("fs");
const path = require("path");
const [workflowDir, status, errorMessage, extractionDir, renderDir] = process.argv.slice(2);
const summary = {
  schemaVersion: 1,
  kind: "staged_document",
  status,
  ok: status === "success" ? true : status === "running" ? null : false,
  runDir: workflowDir,
  extractionRunDir: extractionDir,
  renderRunDir: renderDir,
  documentTypPath: path.join(renderDir, "document.typ"),
  documentPdfPath: path.join(renderDir, "document.pdf"),
  ...(errorMessage ? { error: errorMessage } : {}),
};
const jsonPath = path.join(workflowDir, "workflow-summary.json");
const markdownPath = path.join(workflowDir, "workflow-summary.md");
const suffix = `${process.pid}.${Date.now()}.tmp`;
const jsonTemp = `${jsonPath}.${suffix}`;
const markdownTemp = `${markdownPath}.${suffix}`;
fs.writeFileSync(jsonTemp, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
fs.writeFileSync(
  markdownTemp,
  [
    "Workflow: staged document",
    `Run status: ${status}`,
    ...(errorMessage ? [`Error: ${errorMessage}`] : []),
    "",
  ].join("\n"),
  { mode: 0o600 },
);
fs.renameSync(jsonTemp, jsonPath);
fs.renameSync(markdownTemp, markdownPath);
NODE
}

record_staged_workflow_pid() {
  local workflow_dir="$1"
  local wrapper_start_identity process_group_id
  wrapper_start_identity="$(process_start_identity "$$")"
  process_group_id="$(ps -o pgid= -p "$$" | tr -d ' ')"
  node - "$workflow_dir/pid.json" "$$" "${process_group_id:-$$}" "$wrapper_start_identity" <<'NODE'
const fs = require("fs");
const [output, pidRaw, processGroupRaw, startIdentity] = process.argv.slice(2);
const payload = {
  wrapper_pid: Number(pidRaw),
  child_pid: Number(pidRaw),
  process_group_id: Number(processGroupRaw),
  child_start_identity: startIdentity,
  started_at: new Date().toISOString(),
  command: "study_buddy_task.sh staged-document",
};
const temporary = `${output}.${process.pid}.${Date.now()}.tmp`;
fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
fs.renameSync(temporary, output);
NODE
}

cleanup_staged_document() {
  if [[ -n "${ACTIVE_WORKFLOW_DIR:-}" ]]; then
    write_staged_document_summary \
      "$ACTIVE_WORKFLOW_DIR" \
      "canceled" \
      "The staged document workflow was canceled." \
      "$ACTIVE_WORKFLOW_EXTRACTION_DIR" \
      "$ACTIVE_WORKFLOW_RENDER_DIR" || true
  fi
  cleanup_child
  exit 130
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
  local process_group_id child_start_identity
  process_group_id="$(ps -o pgid= -p "$ACTIVE_CHILD_PID" | tr -d ' ')"
  child_start_identity="$(process_start_identity "$ACTIVE_CHILD_PID")" || {
    kill "$ACTIVE_CHILD_PID" 2>/dev/null || true
    echo "Could not record a stable identity for Study Buddy child $ACTIVE_CHILD_PID." >&2
    return 1
  }
  ACTIVE_PROCESS_GROUP_ID="${process_group_id:-$ACTIVE_CHILD_PID}"
  cat > "$run_dir/pid.json" <<EOF
{
  "wrapper_pid": $$,
  "child_pid": $ACTIVE_CHILD_PID,
  "process_group_id": ${process_group_id:-$ACTIVE_CHILD_PID},
  "child_start_identity": "$child_start_identity",
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
  if [[ -n "${ACTIVE_WORKFLOW_DIR:-}" ]]; then
    trap cleanup_staged_document INT TERM
  else
    trap - INT TERM
  fi
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

run_locked_extraction() {
  local prompt_text="$1"
  shift
  require_root
  local run_dir
  run_dir="$(prepare_run_dir "$prompt_text")"
  acquire_artifact_lock "$run_dir"
  trap cleanup_child INT TERM
  local status=0
  run_agent_in_dir "$prompt_text" "$run_dir" "$@" || status=$?
  release_artifact_lock
  trap - INT TERM
  return "$status"
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
  local process_group_id child_start_identity
  process_group_id="$(ps -o pgid= -p "$ACTIVE_CHILD_PID" | tr -d ' ')"
  child_start_identity="$(process_start_identity "$ACTIVE_CHILD_PID")" || {
    kill "$ACTIVE_CHILD_PID" 2>/dev/null || true
    echo "Could not record a stable identity for Study Buddy child $ACTIVE_CHILD_PID." >&2
    release_artifact_lock
    return 1
  }
  ACTIVE_PROCESS_GROUP_ID="${process_group_id:-$ACTIVE_CHILD_PID}"
  cat > "$workflow_dir/pid.json" <<EOF
{
  "wrapper_pid": $$,
  "child_pid": $ACTIVE_CHILD_PID,
  "process_group_id": ${process_group_id:-$ACTIVE_CHILD_PID},
  "child_start_identity": "$child_start_identity",
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
  local process_group_id child_start_identity
  process_group_id="$(ps -o pgid= -p "$ACTIVE_CHILD_PID" | tr -d ' ')"
  child_start_identity="$(process_start_identity "$ACTIVE_CHILD_PID")" || {
    kill "$ACTIVE_CHILD_PID" 2>/dev/null || true
    echo "Could not record a stable identity for Study Buddy child $ACTIVE_CHILD_PID." >&2
    release_artifact_lock
    return 1
  }
  ACTIVE_PROCESS_GROUP_ID="${process_group_id:-$ACTIVE_CHILD_PID}"
  cat > "$workflow_dir/pid.json" <<EOF
{
  "wrapper_pid": $$,
  "child_pid": $ACTIVE_CHILD_PID,
  "process_group_id": ${process_group_id:-$ACTIVE_CHILD_PID},
  "child_start_identity": "$child_start_identity",
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
  local error_path summary_path raw_path source_map_path evidence_path coverage_path extracted_path
  validate_recovery_run_layout "$run_dir" || return 1
  error_path="$(resolve_run_control_file "$run_dir" "error.log")" || return 1
  summary_path="$(resolve_run_control_file "$run_dir" "run-summary.md")" || return 1
  raw_path="$(resolve_run_control_file "$run_dir" "moodle_raw.txt")" || return 1
  source_map_path="$(resolve_run_control_file "$run_dir" "source-map.json")" || return 1
  evidence_path="$(resolve_run_control_file "$run_dir" "evidence-package.json")" || return 1
  coverage_path="$(resolve_run_control_file "$run_dir" "coverage-report.json")" || return 1
  [[ -s "$error_path" && -s "$summary_path" && -s "$raw_path" && -s "$source_map_path" && -s "$evidence_path" && -s "$coverage_path" ]] || return 1
  grep -Eq 'Study Buddy run timed out after|Extraction checkpoint required:|Extraction capacity checkpoint required:|content_analyzer model call timed out after|Student-first coverage blocked publication:|Semantic quality review failed:|Quality reviewer failed:|Analyzer failed:' "$error_path" || return 1
  if ! grep -Eq '^Run status: (failed|timeout|partial|success)$' "$summary_path"; then
    grep -Eq '^Run status: running$' "$summary_path" || return 1
    grep -Eq 'Semantic quality review failed:|Quality reviewer failed:' "$error_path" || return 1
  fi
  if [[ -e "$run_dir/extracted-data.json" || -L "$run_dir/extracted-data.json" ]]; then
    extracted_path="$(resolve_run_control_file "$run_dir" "extracted-data.json")" || return 1
    if [[ -s "$extracted_path" ]]; then
      return 0
    fi
  fi
  if grep -Eq 'Extraction capacity checkpoint required:|content_analyzer model call timed out after' "$error_path"; then
    return 0
  fi
  if grep -Eq 'Extraction checkpoint required:' "$error_path"; then
    return 0
  fi
  if grep -Eq 'Student-first coverage blocked publication:' "$error_path"; then
    return 0
  fi
  local handoff_dir="$run_dir/chapter-handoffs"
  [[ -d "$handoff_dir" ]] || return 1
  find "$handoff_dir" -maxdepth 1 -type f -name '*.json' -size +0c -print -quit | grep -q .
}

is_valid_extraction_handoff() {
  local run_dir="$1"
  [[ -d "$run_dir" ]] || return 1
  local extracted_path summary_path error_path
  extracted_path="$(resolve_run_control_file "$run_dir" "extracted-data.json")" || return 1
  summary_path="$(resolve_run_control_file "$run_dir" "run-summary.md")" || return 1
  [[ -s "$extracted_path" && -s "$summary_path" ]] || return 1
  if [[ -e "$run_dir/error.log" || -L "$run_dir/error.log" ]]; then
    error_path="$(resolve_run_control_file "$run_dir" "error.log")" || return 1
    [[ ! -s "$error_path" ]] || return 1
  fi
  grep -Eq '^Route: extraction$' "$summary_path" || return 1
  grep -Eq '^Run status: (success|partial)$' "$summary_path" || return 1
}

workflow_budget_ms_for_run() {
  local run_dir="$1"
  node -e '
    const fs = require("fs");
    try {
      const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const requested = Number(value.totalWorkflowBudgetMs);
      const bounded = Number.isFinite(requested)
        ? Math.max(900000, Math.min(2280000, Math.floor(requested)))
        : 1560000;
      process.stdout.write(String(bounded));
    } catch { process.stdout.write("1560000"); }
  ' "$run_dir/adaptive-budget.json"
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
  ACTIVE_WORKFLOW_DIR="$workflow_dir"
  ACTIVE_WORKFLOW_EXTRACTION_DIR="$extraction_dir"
  ACTIVE_WORKFLOW_RENDER_DIR="$render_dir"
  write_staged_document_summary "$workflow_dir" "running" "" "$extraction_dir" "$render_dir"
  record_staged_workflow_pid "$workflow_dir"
  trap cleanup_staged_document INT TERM
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
    workflow_budget_ms="$(workflow_budget_ms_for_run "$extraction_dir")"
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
      write_staged_document_summary "$workflow_dir" "failed" "Extraction failed without a valid recoverable handoff." "$current_extraction_dir" "$render_dir"
      release_artifact_lock
      ACTIVE_WORKFLOW_DIR=""
      trap - INT TERM
      return 1
    fi
  fi
  if ! is_valid_extraction_handoff "$successful_extraction_dir"; then
    echo "Extraction did not produce a valid handoff; render stage will not start." >&2
    write_staged_document_summary "$workflow_dir" "failed" "Extraction did not produce a valid handoff." "$successful_extraction_dir" "$render_dir"
    release_artifact_lock
    ACTIVE_WORKFLOW_DIR=""
    trap - INT TERM
    return 1
  fi

  echo "Extraction handoff ready: $successful_extraction_dir/extracted-data.json"
  if [[ -z "${STUDY_BUDDY_WORKFLOW_DEADLINE_MS:-}" ]]; then
    local workflow_budget_ms
    workflow_budget_ms="$(workflow_budget_ms_for_run "$successful_extraction_dir")"
    export STUDY_BUDDY_WORKFLOW_DEADLINE_MS="$((workflow_started_ms + workflow_budget_ms))"
  fi
  if [[ -n "${STUDY_BUDDY_WORKFLOW_DEADLINE_MS:-}" ]]; then
    local render_remaining_ms=$((STUDY_BUDDY_WORKFLOW_DEADLINE_MS - $(date +%s%3N)))
    if (( render_remaining_ms <= 60000 )); then
      echo "Adaptive workflow budget left no safe render window." >&2
      write_staged_document_summary "$workflow_dir" "failed" "Adaptive workflow budget left no safe render window." "$successful_extraction_dir" "$render_dir"
      release_artifact_lock
      ACTIVE_WORKFLOW_DIR=""
      trap - INT TERM
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
    write_staged_document_summary "$workflow_dir" "failed" "Render stage failed." "$successful_extraction_dir" "$render_dir"
    release_artifact_lock
    ACTIVE_WORKFLOW_DIR=""
    trap - INT TERM
    return 1
  fi
  if [[ ! -s "$render_dir/document.typ" || ! -s "$render_dir/document.pdf" || -s "$render_dir/error.log" ]]; then
    echo "Render stage stopped without a complete, error-free PDF deliverable." >&2
    write_staged_document_summary "$workflow_dir" "failed" "Render stage did not produce a complete, error-free PDF deliverable." "$successful_extraction_dir" "$render_dir"
    release_artifact_lock
    ACTIVE_WORKFLOW_DIR=""
    trap - INT TERM
    return 1
  fi
  write_staged_document_summary "$workflow_dir" "success" "" "$successful_extraction_dir" "$render_dir"
  release_artifact_lock
  ACTIVE_WORKFLOW_DIR=""
  ACTIVE_WORKFLOW_EXTRACTION_DIR=""
  ACTIVE_WORKFLOW_RENDER_DIR=""
  trap - INT TERM
  echo "PDF ready: $render_dir/document.pdf"
}

resolve_run_control_file() {
  local run_dir="$1"
  local name="$2"
  node - "$run_dir" "$name" <<'NODE'
const fs = require("fs");
const path = require("path");
const root = fs.realpathSync(process.argv[2]);
const name = process.argv[3];
if (!/^[A-Za-z0-9._-]+$/.test(name)) process.exit(2);
const candidate = path.join(root, name);
if (!fs.existsSync(candidate)) process.exit(3);
const linkStats = fs.lstatSync(candidate);
const realCandidate = fs.realpathSync(candidate);
const relative = path.relative(root, realCandidate);
if (!linkStats.isFile() || relative.startsWith("..") || path.isAbsolute(relative)) process.exit(4);
console.log(realCandidate);
NODE
}

validate_recovery_run_layout() {
  local run_dir="$1"
  node - "$run_dir" <<'NODE'
const fs = require("fs");
const path = require("path");
const lexicalRoot = process.argv[2];
const rootStats = fs.lstatSync(lexicalRoot);
if (!rootStats.isDirectory()) process.exit(2);
const root = fs.realpathSync(lexicalRoot);
const contained = (candidateRoot, candidate) => {
  const relative = path.relative(candidateRoot, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};
const regular = (relativePath, required) => {
  const candidate = path.join(root, relativePath);
  try {
    const stats = fs.lstatSync(candidate);
    const realCandidate = fs.realpathSync(candidate);
    if (!stats.isFile() || !contained(root, realCandidate) || stats.size === 0) process.exit(3);
    return true;
  } catch (error) {
    if (!required && error?.code === "ENOENT") return false;
    process.exit(3);
  }
};
const directoryTree = (relativePath, jsonOnly = false) => {
  const directory = path.join(root, relativePath);
  let stats;
  try {
    stats = fs.lstatSync(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    process.exit(4);
  }
  const realDirectory = fs.realpathSync(directory);
  if (!stats.isDirectory() || !contained(root, realDirectory)) process.exit(4);
  for (const entry of fs.readdirSync(realDirectory, { withFileTypes: true })) {
    const childRelative = path.join(relativePath, entry.name);
    if (entry.isSymbolicLink()) process.exit(4);
    if (entry.isDirectory()) {
      if (jsonOnly) process.exit(4);
      directoryTree(childRelative, false);
      continue;
    }
    if (!entry.isFile() || (jsonOnly && !entry.name.endsWith(".json"))) process.exit(4);
    regular(childRelative, true);
  }
};
for (const requiredFile of [
  "run-summary.md",
  "error.log",
  "moodle_raw.txt",
  "source-map.json",
  "evidence-package.json",
  "coverage-report.json",
  "request-contract.json",
  "request-contract-integrity.json",
]) regular(requiredFile, true);
for (const optionalFile of [
  "extracted-data.json",
  "source_coverage.json",
  "state.json",
  "learning-architecture.json",
  "resource-catalog.json",
  "resource-plan.json",
  "visual-candidates.json",
  "visual-retrieval-plan.json",
  "visual-page-index.json",
  "pending-extraction-repairs.json",
]) regular(optionalFile, false);
directoryTree("chapter-handoffs", true);
directoryTree("assets/visuals", false);
NODE
}

read_run_pid_field() {
  local run_dir="$1"
  local field="$2"
  local pid_path
  pid_path="$(resolve_run_control_file "$run_dir" "pid.json")" || return 1
  node - "$pid_path" "$field" <<'NODE'
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))[process.argv[3]];
if (!Number.isInteger(Number(value)) || Number(value) <= 0) process.exit(2);
console.log(Number(value));
NODE
}

read_run_string_field() {
  local run_dir="$1"
  local field="$2"
  local pid_path
  pid_path="$(resolve_run_control_file "$run_dir" "pid.json")" || return 1
  node - "$pid_path" "$field" <<'NODE'
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))[process.argv[3]];
if (typeof value !== "string" || !value.trim()) process.exit(2);
process.stdout.write(value);
NODE
}

cancel_run() {
  local run_dir="$1"
  local pid_file="$run_dir/pid.json"
  local child_pid pgid recorded_identity current_identity current_pgid recorded_command
  if ! child_pid="$(read_run_pid_field "$run_dir" "child_pid")"; then
    echo "No valid contained child process id found in: $pid_file" >&2
    return 1
  fi
  if ! kill -0 "$child_pid" 2>/dev/null; then
    echo "Study Buddy process is already stopped: $child_pid"
    return 0
  fi
  if ! recorded_identity="$(read_run_string_field "$run_dir" "child_start_identity")"; then
    echo "Refusing to signal a live process without a recorded start identity: $pid_file" >&2
    return 1
  fi
  if ! current_identity="$(process_start_identity "$child_pid")" || [[ "$current_identity" != "$recorded_identity" ]]; then
    echo "Recorded Study Buddy PID has been reused; leaving process $child_pid untouched."
    return 0
  fi
  recorded_command="$(read_run_string_field "$run_dir" "command" 2>/dev/null || true)"
  if [[ "$recorded_command" == "study_buddy_task.sh staged-document" ]]; then
    kill "$child_pid" 2>/dev/null || true
    echo "Cancellation requested for staged Study Buddy workflow: $child_pid"
    return 0
  fi
  if ! pgid="$(read_run_pid_field "$run_dir" "process_group_id")"; then
    pgid="$child_pid"
  fi
  current_pgid="$(ps -o pgid= -p "$child_pid" | tr -d ' ')"
  if [[ -z "$current_pgid" || "$current_pgid" != "$pgid" ]]; then
    echo "Recorded Study Buddy process group no longer matches PID $child_pid; leaving it untouched."
    return 0
  fi
  kill -- "-$pgid" 2>/dev/null || kill "$child_pid" 2>/dev/null || true
  local summary_path
  if summary_path="$(resolve_run_control_file "$run_dir" "run-summary.md")"; then
    {
      echo
      echo "Run status: canceled"
      echo "Canceled at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } >> "$summary_path"
  fi
}

status_run() {
  local run_dir="$1"
  if [[ ! -d "$run_dir" ]]; then
    echo "Run directory not found: $run_dir" >&2
    exit 1
  fi
  local process_state="unknown"
  if [[ -e "$run_dir/pid.json" || -L "$run_dir/pid.json" ]]; then
    local pid
    if ! pid="$(read_run_pid_field "$run_dir" "child_pid")"; then
      process_state="invalid"
    elif kill -0 "$pid" 2>/dev/null; then
      process_state="running"
    else
      process_state="stopped"
    fi
  fi
  echo "Process: $process_state"
  local summary_path
  if summary_path="$(resolve_run_control_file "$run_dir" "run-summary.md")"; then
    sed -n '1,220p' "$summary_path"
    if [[ "$process_state" == "stopped" ]] && grep -q "Run status: running" "$summary_path"; then
      echo "Status warning: process stopped but summary is stale and still marked running"
    fi
  elif summary_path="$(resolve_run_control_file "$run_dir" "workflow-summary.md")"; then
    sed -n '1,220p' "$summary_path"
    echo "workflow-summary.json: $([[ -s "$run_dir/workflow-summary.json" ]] && echo present || echo missing)"
    return 0
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

inspect_run_contract() {
  local run_dir="$1"
  node - "$run_dir" <<'NODE'
const fs = require("fs");
const path = require("path");

const runDir = process.argv[2];
const realRunDir = fs.realpathSync(runDir);
const read = (name) => {
  try {
    const candidate = path.join(runDir, name);
    const linkStats = fs.lstatSync(candidate);
    const realCandidate = fs.realpathSync(candidate);
    const relative = path.relative(realRunDir, realCandidate);
    if (
      !linkStats.isFile() ||
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    ) {
      return "";
    }
    return fs.readFileSync(realCandidate, "utf8");
  } catch {
    return "";
  }
};
const readJson = (name) => {
  try {
    return JSON.parse(read(name));
  } catch {
    return {};
  }
};
const nonEmpty = (name) => {
  try {
    const candidate = path.join(runDir, name);
    const linkStats = fs.lstatSync(candidate);
    const realCandidate = fs.realpathSync(candidate);
    const relative = path.relative(realRunDir, realCandidate);
    const stats = fs.statSync(realCandidate);
    return (
      linkStats.isFile() &&
      stats.isFile() &&
      stats.size > 0 &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative)
    );
  } catch {
    return false;
  }
};
const lexicalExists = (name) => {
  try {
    fs.lstatSync(path.join(runDir, name));
    return true;
  } catch {
    return false;
  }
};
const isContainedRegularControl = (name) => {
  try {
    const candidate = path.join(runDir, name);
    const linkStats = fs.lstatSync(candidate);
    const realCandidate = fs.realpathSync(candidate);
    const relative = path.relative(realRunDir, realCandidate);
    return (
      linkStats.isFile() &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative)
    );
  } catch {
    return false;
  }
};

const summary = read("run-summary.md");
const summaryStatus = [...summary.matchAll(/^Run status:\s*(\S+)/gm)].at(-1)?.[1] || "unknown";
const route = [...summary.matchAll(/^Route:\s*(\S+)/gm)].at(-1)?.[1];
const config = readJson("config.json");
const progress = readJson("run-progress.json");
const hasProgress = nonEmpty("run-progress.json");
const terminalStatuses = new Set(["success", "partial"]);
const failureStatuses = new Set(["failed", "timeout", "canceled"]);
const liveStatuses = new Set(["unknown", "queued", "running"]);
const error = read("error.log").trim();
const interaction = readJson("interaction-result.json");
const hasInteractionResult = nonEmpty("interaction-result.json");
const workflow = readJson("workflow-summary.json");
const hasWorkflowSummary = nonEmpty("workflow-summary.json");
const workflowMarkdown = read("workflow-summary.md");
const workflowMarkdownStatus = [...workflowMarkdown.matchAll(/^Run status:\s*(\S+)/gm)].at(-1)?.[1] || "unknown";
const invalidControls = [
  "run-summary.md",
  "config.json",
  "run-progress.json",
  "interaction-result.json",
  "workflow-summary.json",
  "workflow-summary.md",
  "error.log",
].filter((name) => lexicalExists(name) && !isContainedRegularControl(name));

let terminalStatus = summaryStatus;
let contract = "document";
let expectedArtifacts = [];
let extraMissingArtifacts = [];
let contradiction = "";

if (hasWorkflowSummary) {
  terminalStatus = typeof workflow.status === "string" ? workflow.status : "unknown";
  const workflowKind = workflow.kind === "staged_document"
    ? "staged_document"
    : "interactive_study_guide";
  contract = workflowKind;
  expectedArtifacts = ["workflow-summary.json", "workflow-summary.md"];
  const root = path.resolve(runDir);
  const insideRoot = (raw, label, parentRaw, kind = "file") => {
    if (typeof raw !== "string" || !raw) {
      extraMissingArtifacts.push(label);
      return;
    }
    const resolved = path.resolve(path.isAbsolute(raw) ? raw : path.join(root, raw));
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      contradiction = `${label} is outside the workflow directory`;
      return;
    }
    if (parentRaw) {
      const parent = path.resolve(path.isAbsolute(parentRaw) ? parentRaw : path.join(root, parentRaw));
      const parentRelative = path.relative(parent, resolved);
      if (!parentRelative || parentRelative.startsWith("..") || path.isAbsolute(parentRelative)) {
        contradiction = `${label} is inconsistent with its workflow branch directory`;
        return;
      }
    }
    try {
      const linkStats = fs.lstatSync(resolved);
      const realResolved = fs.realpathSync(resolved);
      const realRelative = path.relative(realRunDir, realResolved);
      if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
        contradiction = `${label} resolves outside the workflow directory`;
        return;
      }
      if (parentRaw) {
        const parent = path.resolve(path.isAbsolute(parentRaw) ? parentRaw : path.join(root, parentRaw));
        const realParent = fs.realpathSync(parent);
        const realParentRelative = path.relative(realParent, realResolved);
        if (!realParentRelative || realParentRelative.startsWith("..") || path.isAbsolute(realParentRelative)) {
          contradiction = `${label} resolves outside its workflow branch directory`;
          return;
        }
      }
      if (kind === "directory") {
        if (!linkStats.isDirectory() || !fs.statSync(realResolved).isDirectory()) {
          extraMissingArtifacts.push(label);
        }
      } else {
        if (!linkStats.isFile() || !fs.statSync(realResolved).isFile()) {
          extraMissingArtifacts.push(label);
        } else {
          expectedArtifacts.push(relative);
        }
      }
    } catch {
      extraMissingArtifacts.push(label);
    }
  };
  if (workflow.schemaVersion !== 1) {
    contradiction = `Unsupported workflow summary schema (${workflow.schemaVersion || "unknown"})`;
  } else if (!["queued", "running", "success", "failed", "canceled"].includes(terminalStatus)) {
    contradiction = `Workflow summary has no recognized status (${terminalStatus})`;
  } else if (workflowMarkdownStatus !== terminalStatus) {
    contradiction = `Workflow summary JSON status ${terminalStatus} contradicts Markdown status ${workflowMarkdownStatus}`;
  } else if (path.resolve(workflow.runDir || "") !== root) {
    contradiction = "Workflow summary run directory does not match the inspected directory";
  } else if (terminalStatus === "success") {
    if (workflow.ok !== true || workflow.error) {
      contradiction = "Successful workflow summary has inconsistent ok/error fields";
    } else if (workflowKind === "staged_document") {
      insideRoot(workflow.extractionRunDir, "extractionRunDir", null, "directory");
      insideRoot(workflow.renderRunDir, "renderRunDir", null, "directory");
      insideRoot(workflow.documentTypPath, "documentTypPath", workflow.renderRunDir);
      insideRoot(workflow.documentPdfPath, "documentPdfPath", workflow.renderRunDir);
    } else if (typeof workflow.webLayoutRunDir !== "string" || !workflow.webLayoutRunDir) {
      extraMissingArtifacts.push("webLayoutRunDir");
    } else {
      insideRoot(workflow.webLayoutRunDir, "webLayoutRunDir", null, "directory");
      insideRoot(workflow.outputPath, "outputPath", workflow.webLayoutRunDir);
      if (workflow.pdfRenderRunDir) {
        insideRoot(workflow.pdfRenderRunDir, "pdfRenderRunDir", null, "directory");
        insideRoot(workflow.pdfPath, "pdfPath", workflow.pdfRenderRunDir);
      } else if (workflow.pdfPath) {
        contradiction = "Workflow summary has a PDF path without a PDF branch directory";
      }
    }
  } else if (
    (terminalStatus === "failed" || terminalStatus === "canceled") &&
    (workflow.ok !== false || typeof workflow.error !== "string" || !workflow.error.trim())
  ) {
    contradiction = "Unsuccessful workflow summary has inconsistent ok/error fields";
  }
} else if (hasInteractionResult) {
  const interactionStatus = interaction.ok === true ? "success" : "failed";
  terminalStatus = summaryStatus;
  contract = interaction.kind === "assignment" ? "interactive_assignment" : "interactive_quiz";
  expectedArtifacts = contract === "interactive_assignment"
    ? ["assignment-report.md", "assignment-report.json"]
    : ["quiz-review.typ", "quiz-review.json"];
  if (interaction.workflowStatus === "permission_required") {
    expectedArtifacts.push(
      contract === "interactive_assignment"
        ? "assignment-permission-request.json"
        : "quiz-permission-request.json",
    );
  }
  if (interaction.schemaVersion !== 1) {
    contradiction = `Unsupported interaction result schema (${interaction.schemaVersion || "unknown"})`;
  } else if (interaction.kind !== "quiz" && interaction.kind !== "assignment") {
    contradiction = `Unknown interaction kind (${interaction.kind || "unknown"})`;
  } else if (
    interaction.workflowStatus !== "completed" &&
    interaction.workflowStatus !== "permission_required"
  ) {
    contradiction = `Interactive workflow ended with ${interaction.workflowStatus || "unknown"}`;
  } else if (summaryStatus !== interactionStatus) {
    contradiction = `Interaction result status ${interactionStatus} contradicts run summary status ${summaryStatus}`;
  } else if (JSON.stringify(interaction.requiredArtifacts) !== JSON.stringify(expectedArtifacts)) {
    contradiction = "Interaction result required-artifact contract is invalid";
  }
} else {
  const progressStatus = typeof progress.status === "string" ? progress.status : "unknown";
  if (
    !terminalStatuses.has(summaryStatus) &&
    !failureStatuses.has(summaryStatus) &&
    !liveStatuses.has(summaryStatus)
  ) {
    contradiction = `Run summary has no recognized terminal status (${summaryStatus})`;
  } else if (
    hasProgress &&
    progressStatus !== summaryStatus &&
    !(liveStatuses.has(summaryStatus) && liveStatuses.has(progressStatus))
  ) {
    contradiction = `Run summary status ${summaryStatus} contradicts run-progress status ${progressStatus}`;
  }

  const stage = config.stage || "all";
  const intent = config.intentDecision?.intent || route;
  if (stage === "extract") {
    contract = "extract";
    expectedArtifacts = ["extracted-data.json"];
  } else if (config.diagnosticOnly === true || intent === "diagnostic") {
    contract = "diagnostic";
    expectedArtifacts = ["moodle_raw.txt", "source_coverage.json"];
  } else if (
    config.intentDecision?.wantsQuickAnswer === true ||
    intent === "quick_answer" ||
    intent === "schedule_answer"
  ) {
    contract = "answer";
    expectedArtifacts = ["answer.md", "answer.json"];
  } else {
    expectedArtifacts = ["document.typ", "document.pdf"];
  }

  if (hasProgress && progress.artifacts && typeof progress.artifacts === "object") {
    const root = path.resolve(runDir);
    for (const artifactPath of Object.values(progress.artifacts)) {
      if (typeof artifactPath !== "string" || !artifactPath) continue;
      const resolved = path.resolve(path.isAbsolute(artifactPath) ? artifactPath : path.join(root, artifactPath));
      const relative = path.relative(root, resolved);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        contradiction = `run-progress references an artifact outside the run directory: ${artifactPath}`;
        break;
      }
      try {
        const realArtifact = fs.realpathSync(resolved);
        const realRelative = path.relative(realRunDir, realArtifact);
        if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
          contradiction = `run-progress references an artifact resolving outside the run directory: ${artifactPath}`;
          break;
        }
      } catch {
        // Missing paths are handled by the route-specific artifact contract.
      }
    }
  }
}

if (invalidControls.length > 0) {
  contradiction = `Run control file is not a contained regular file: ${invalidControls[0]}`;
}

const missingArtifacts = [
  ...expectedArtifacts.filter((artifact) => !nonEmpty(artifact)),
  ...extraMissingArtifacts,
];
const completed =
  (terminalStatus === "success" ||
    (terminalStatus === "partial" && ["extract", "diagnostic"].includes(contract))) &&
  !error &&
  !contradiction &&
  missingArtifacts.length === 0;

console.log(JSON.stringify({
  completed,
  terminalStatus,
  stage: config.stage || (hasWorkflowSummary || hasInteractionResult ? "interactive" : "all"),
  route: hasWorkflowSummary
    ? workflow.kind === "staged_document" ? "staged_document" : "interactive_study_guide"
    : hasInteractionResult
      ? interaction.kind || "interactive"
      : route || config.intentDecision?.intent || "unknown",
  contract,
  workflowStatus: hasWorkflowSummary
    ? terminalStatus
    : hasInteractionResult
      ? interaction.workflowStatus || "unknown"
      : null,
  expectedArtifacts,
  missingArtifacts,
  error,
  contradiction,
}));
NODE
}

checkpoint_run() {
  local run_dir="$1"
  if [[ ! -d "$run_dir" ]]; then
    echo "Run directory not found: $run_dir" >&2
    return 1
  fi
  local contract_json
  contract_json="$(inspect_run_contract "$run_dir")"
  RUN_CONTRACT_JSON="$contract_json" node - "$run_dir" <<'NODE'
const fs = require("fs");
const path = require("path");

const runDir = process.argv[2];
const realRunDir = fs.realpathSync(runDir);
const read = (name) => {
  try {
    const candidate = path.join(runDir, name);
    const linkStats = fs.lstatSync(candidate);
    const realCandidate = fs.realpathSync(candidate);
    const relative = path.relative(realRunDir, realCandidate);
    if (
      !linkStats.isFile() ||
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    ) {
      return "";
    }
    return fs.readFileSync(realCandidate, "utf8");
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
let pidControlError = null;
try {
  const pidRaw = read("pid.json");
  let pidControlExists = false;
  try {
    fs.lstatSync(path.join(runDir, "pid.json"));
    pidControlExists = true;
  } catch {}
  if (pidControlExists && !pidRaw) {
    pidControlError = "pid.json is not a contained regular control file";
  } else if (pidRaw) {
    pid = JSON.parse(pidRaw).child_pid || null;
  }
} catch {
  pidControlError = "pid.json is invalid";
}
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
const contract = JSON.parse(process.env.RUN_CONTRACT_JSON);
let coverage = {};
try {
  coverage = JSON.parse(read("source_coverage.json"));
} catch {}
const transientWriteSkew =
  processAlive &&
  (/^Run summary status (?:success|partial) contradicts run-progress status (?:unknown|queued|running)$/.test(
    contract.contradiction,
  ) ||
    /^Interaction result status (?:success|failed) contradicts run summary status (?:unknown|queued|running)$/.test(
      contract.contradiction,
    ) ||
    /^Workflow summary JSON status (?:success|failed) contradicts Markdown status (?:queued|running)$/.test(
      contract.contradiction,
    ) ||
    /^Workflow summary JSON status (?:queued|running) contradicts Markdown status (?:success|failed)$/.test(
      contract.contradiction,
    ));
const completed = contract.completed && !processAlive && !pidControlError;
const blocked =
  Boolean(pidControlError || contract.error || (contract.contradiction && !transientWriteSkew)) ||
  ["failed", "timeout", "canceled"].includes(contract.terminalStatus) ||
  (!processAlive && !completed);

console.log(JSON.stringify({
  report: completed ? "completed" : blocked ? "blocked" : "progress",
  process_alive: processAlive,
  terminal_status: contract.terminalStatus,
  stage: contract.stage,
  route: contract.route,
  contract: contract.contract,
  workflow_status: contract.workflowStatus,
  phase: lastSemanticEvent?.phase || lastEvent?.phase || "starting",
  current_action: lastSemanticEvent?.message || lastEvent?.message || "Run initialized",
  heartbeat_at: lastEvent?.timestamp || null,
  semantic_progress_at: lastSemanticEvent?.timestamp || null,
  active_sources: coverage?.moodle?.urls || coverage?.moodle?.attemptedUrls || [],
  next_action: completed
    ? contract.workflowStatus === "permission_required"
      ? "Deliver the permission request and wait for explicit approval"
      : "Validate and deliver artifacts"
    : blocked
      ? "Inspect blocker before retrying"
      : transientWriteSkew || contract.completed
        ? "Wait for worker exit and final status flush"
        : "Continue the same worker lease",
  blocker: blocked
    ? pidControlError ||
      contract.error ||
      contract.contradiction ||
      (contract.missingArtifacts.length
        ? `Missing required artifacts: ${contract.missingArtifacts.join(", ")}`
        : `Process stopped with status ${contract.terminalStatus}`)
    : null,
  expected_artifacts: contract.expectedArtifacts,
  missing_artifacts: contract.missingArtifacts,
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
    if [[ -e "$run_dir/pid.json" || -L "$run_dir/pid.json" ]]; then
      if ! pid="$(read_run_pid_field "$run_dir" "child_pid")"; then
        echo "Invalid or non-contained pid.json in Study Buddy run: $run_dir" >&2
        return 1
      fi
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
  local contract_json
  contract_json="$(inspect_run_contract "$run_dir")"
  node -e 'const result = JSON.parse(process.argv[1]); process.exit(result.completed ? 0 : 1)' "$contract_json"
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
    prompt_intent="$(classify_prompt_intent "$prompt_text")"
    if [[ "$prompt_intent" == "study_pdf" ]]; then
      shift
      run_staged_document "$prompt_text" "$@"
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
      run_locked_extraction "$prompt" --stage extract --cis-url "$DEFAULT_CIS_URL" "$@"
    else
      run_locked_extraction "$prompt" --stage extract --no-cis "$@"
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
    run_staged_document "$prompt" "$@"
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
