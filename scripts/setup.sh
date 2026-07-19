#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Study Buddy — first-time setup
#
# Creates .env (and optionally .env.local) from the shipped
# .env.example template, prompting for credentials.
#
# Usage:
#   bash scripts/setup.sh          (from repo root)
#   npm run setup                  (via package.json script)
#
# Works on Linux, macOS, and Windows (Git Bash / WSL).
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

ENV_EXAMPLE="$ROOT_DIR/.env.example"
ENV_FILE="$ROOT_DIR/.env"
ENV_LOCAL="$ROOT_DIR/.env.local"

# ── colours (disabled if not a terminal) ──
if [ -t 1 ]; then
  BOLD="\033[1m"
  GREEN="\033[32m"
  YELLOW="\033[33m"
  CYAN="\033[36m"
  RED="\033[31m"
  RESET="\033[0m"
else
  BOLD="" GREEN="" YELLOW="" CYAN="" RED="" RESET=""
fi

info()  { echo -e "${CYAN}ℹ${RESET}  $*"; }
ok()    { echo -e "${GREEN}✔${RESET}  $*"; }
warn()  { echo -e "${YELLOW}⚠${RESET}  $*"; }
error() { echo -e "${RED}✖${RESET}  $*" >&2; }

dotenv_encode() {
  local value="$1"
  if [[ "$value" != *"#"* && "$value" != *$'\n'* && "$value" != *$'\r'* && "$value" != " "* && "$value" != *" " ]]; then
    printf '%s' "$value"
  elif [[ "$value" != *"'"* ]]; then
    printf "'%s'" "$value"
  elif [[ "$value" != *'`'* ]]; then
    printf '`%s`' "$value"
  elif [[ "$value" != *'"'* && "$value" != *'\n'* && "$value" != *'\r'* ]]; then
    printf '"%s"' "$value"
  else
    error "A credential contains a combination of quotes that .env files cannot represent safely. Configure it through the application settings instead."
    return 1
  fi
}

upsert_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local encoded
  local temporary
  local replaced=false
  encoded="$(dotenv_encode "$value")"
  temporary="$(mktemp "${file}.study-buddy.XXXXXX")"
  chmod 600 "$temporary"
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" == "$key="* ]]; then
      printf '%s=%s\n' "$key" "$encoded" >> "$temporary"
      replaced=true
    else
      printf '%s\n' "$line" >> "$temporary"
    fi
  done < "$file"
  if [ "$replaced" = false ]; then
    printf '%s=%s\n' "$key" "$encoded" >> "$temporary"
  fi
  mv "$temporary" "$file"
  chmod 600 "$file"
}

# ── guard: .env.example must exist ──
if [ ! -f "$ENV_EXAMPLE" ]; then
  error ".env.example not found at $ENV_EXAMPLE"
  error "Are you running this from the repository root?"
  exit 1
fi

echo ""
echo -e "${BOLD}╔══════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║       Study Buddy — Setup            ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════╝${RESET}"
echo ""

# ── step 1: create .env ──
if [ -f "$ENV_FILE" ]; then
  warn ".env already exists. Skipping copy from .env.example."
  warn "Delete it first if you want a fresh setup."
else
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  ok "Created .env from .env.example"
fi
chmod 600 "$ENV_FILE"

# ── step 2: prompt for credentials ──
echo ""
info "Enter your Moodle / CIS credentials."
info "These are stored in .env (gitignored — never committed)."
echo ""

read -rp "  Moodle username: " MOODLE_USER
read -rsp "  Moodle password: " MOODLE_PASS
echo ""

# write credentials into .env
if [ -n "$MOODLE_USER" ]; then
  upsert_env_value "$ENV_FILE" "MOODLE_USERNAME" "$MOODLE_USER"
fi

if [ -n "$MOODLE_PASS" ]; then
  upsert_env_value "$ENV_FILE" "MOODLE_PASSWORD" "$MOODLE_PASS"
fi

ok "Credentials written to .env"

# ── step 3: CIS credentials (optional) ──
echo ""
read -rp "  CIS username (Enter to reuse Moodle username): " CIS_USER
read -rsp "  CIS password (Enter to reuse Moodle password): " CIS_PASS
echo ""

# ── step 4: create .env.local ──
if [ -f "$ENV_LOCAL" ]; then
  warn ".env.local already exists. Skipping creation."
else
  cat > "$ENV_LOCAL" << 'ENVLOCAL'
# ──────────────────────────────────────────────────────────────
# Machine-specific overrides
# Values here take priority over .env
# ──────────────────────────────────────────────────────────────

# CIS credentials (leave empty to fall back to Moodle creds)
CIS_USERNAME=
CIS_PASSWORD=

# Browser behaviour
MOODLE_HEADLESS=
MOODLE_BROWSER_BACKEND=

# Quiz safety defaults
MOODLE_QUIZ_AUTO_ANSWER=true
MOODLE_QUIZ_REQUIRE_MANUAL_REVIEW=true
MOODLE_QUIZ_BLOCK_FINAL_SUBMIT=true
MOODLE_QUIZ_DRAFT_ONLY=true
MOODLE_QUIZ_ACCESS_MODE=quiz-assist

# CIS calendar URL (personal iCal feed)
CIS_CALENDAR_URL=
ENVLOCAL
  chmod 600 "$ENV_LOCAL"

  # fill in CIS credentials if provided
  if [ -n "$CIS_USER" ]; then
    upsert_env_value "$ENV_LOCAL" "CIS_USERNAME" "$CIS_USER"
  fi
  if [ -n "$CIS_PASS" ]; then
    upsert_env_value "$ENV_LOCAL" "CIS_PASSWORD" "$CIS_PASS"
  fi

  ok "Created .env.local with safe defaults"
fi
chmod 600 "$ENV_LOCAL"

# ── step 5: check system dependencies ──
echo ""
info "Checking system dependencies..."

ALL_OK=true

if command -v node &>/dev/null; then
  NODE_VER="$(node --version)"
  ok "Node.js $NODE_VER"
else
  error "Node.js not found — install v22+ from https://nodejs.org/"
  ALL_OK=false
fi

if command -v typst &>/dev/null; then
  TYPST_VER="$(typst --version 2>&1 | head -1)"
  ok "Typst: $TYPST_VER"
else
  warn "Typst not found — needed for PDF generation"
  warn "  Linux:   sudo snap install typst"
  warn "  macOS:   brew install typst"
  warn "  Windows: winget install --id Typst.Typst --exact"
fi

if command -v pdftotext &>/dev/null && command -v pdftoppm &>/dev/null; then
  ok "Poppler PDF tools available (pdftotext, pdftoppm)"
else
  warn "Poppler PDF tools are incomplete — PDF text extraction or selected-page rendering will be limited"
  warn "  Debian/Ubuntu: sudo apt install poppler-utils"
  warn "  Fedora:        sudo dnf install poppler-utils"
  warn "  macOS:         brew install poppler"
  warn "  Windows:       winget install --id oschwartz10612.Poppler --exact"
fi

if command -v npx &>/dev/null; then
  ok "npx available"
else
  error "npx not found — should be bundled with Node.js"
  ALL_OK=false
fi

# ── done ──
echo ""
if [ "$ALL_OK" = true ]; then
  echo -e "${GREEN}${BOLD}Setup complete!${RESET}"
else
  echo -e "${YELLOW}${BOLD}Setup complete with warnings — check above.${RESET}"
fi
echo ""
info "Next steps:"
info "  1. npm ci"
info "  2. npx playwright install chromium"
info "  3. npm run typecheck"
echo ""
