#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
TEMPLATE_DIR="$PROJECT_ROOT/config/systemd"
USER_CONFIG_ROOT="${XDG_CONFIG_HOME:-$HOME/.config}"
UNIT_DIR="$USER_CONFIG_ROOT/systemd/user"

mkdir -p "$UNIT_DIR"
for unit in atlas-daily-maintenance.service atlas-fulltext-sync.service; do
  sed "s|@PROJECT_ROOT@|$PROJECT_ROOT|g" "$TEMPLATE_DIR/$unit.in" >"$UNIT_DIR/$unit"
done
install -m 0644 "$TEMPLATE_DIR/atlas-daily-maintenance.timer" "$UNIT_DIR/atlas-daily-maintenance.timer"
install -m 0644 "$TEMPLATE_DIR/atlas-fulltext-sync.timer" "$UNIT_DIR/atlas-fulltext-sync.timer"

systemctl --user daemon-reload
systemctl --user enable --now atlas-daily-maintenance.timer atlas-fulltext-sync.timer
systemctl --user list-timers --all --no-pager | grep -E 'atlas-(daily-maintenance|fulltext-sync)' || true
printf 'Atlas timers installed. Maintenance is fixed at 04:00 Asia/Shanghai; full-text sync resumes at 05:30 and shares the maintenance lock.\n'
