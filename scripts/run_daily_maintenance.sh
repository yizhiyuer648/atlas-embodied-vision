#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
PROMPT_FILE="$PROJECT_ROOT/.codex/portable-automation-prompt.txt"
LOG_DIR="$PROJECT_ROOT/.codex/maintenance-logs"
LOCK_FILE="$PROJECT_ROOT/.codex/daily-maintenance.lock"
CODEX_BIN="${CODEX_BIN:-$(command -v codex)}"

mkdir -p "$LOG_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
log_file="$LOG_DIR/$timestamp.log"
result_file="$LOG_DIR/$timestamp-result.md"

sed "s|{{PROJECT_ROOT}}|$PROJECT_ROOT|g" "$PROMPT_FILE" |
  "$CODEX_BIN" -a never --search exec \
    --skip-git-repo-check \
    --sandbox workspace-write \
    --cd "$PROJECT_ROOT" \
    --output-last-message "$result_file" \
    - >"$log_file" 2>&1
