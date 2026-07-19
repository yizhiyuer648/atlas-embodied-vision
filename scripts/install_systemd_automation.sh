#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
TEMPLATE_DIR="$PROJECT_ROOT/config/systemd"
USER_CONFIG_ROOT="${XDG_CONFIG_HOME:-$HOME/.config}"
UNIT_DIR="$USER_CONFIG_ROOT/systemd/user"
STAGING_DIR="$(mktemp -d /tmp/atlas-systemd.XXXXXX)"
trap 'rm -rf -- "$STAGING_DIR"' EXIT

mkdir -p "$UNIT_DIR"
for unit in atlas-daily-maintenance.service atlas-fulltext-sync.service; do
  python3 - "$TEMPLATE_DIR/$unit.in" "$STAGING_DIR/$unit" "$PROJECT_ROOT" <<'PY'
from pathlib import Path
import sys

source, destination, project_root = map(Path, sys.argv[1:])
text = source.read_text(encoding="utf-8")
destination.write_text(text.replace("@PROJECT_ROOT@", str(project_root)), encoding="utf-8")
PY
done
install -m 0644 "$TEMPLATE_DIR/atlas-daily-maintenance.timer" "$STAGING_DIR/atlas-daily-maintenance.timer"
install -m 0644 "$TEMPLATE_DIR/atlas-fulltext-sync.timer" "$STAGING_DIR/atlas-fulltext-sync.timer"

systemd-analyze --user verify \
  "$STAGING_DIR/atlas-daily-maintenance.service" \
  "$STAGING_DIR/atlas-daily-maintenance.timer" \
  "$STAGING_DIR/atlas-fulltext-sync.service" \
  "$STAGING_DIR/atlas-fulltext-sync.timer"
install -m 0644 "$STAGING_DIR/atlas-daily-maintenance.service" "$UNIT_DIR/atlas-daily-maintenance.service"
install -m 0644 "$STAGING_DIR/atlas-daily-maintenance.timer" "$UNIT_DIR/atlas-daily-maintenance.timer"
install -m 0644 "$STAGING_DIR/atlas-fulltext-sync.service" "$UNIT_DIR/atlas-fulltext-sync.service"
install -m 0644 "$STAGING_DIR/atlas-fulltext-sync.timer" "$UNIT_DIR/atlas-fulltext-sync.timer"

systemctl --user daemon-reload
systemctl --user reset-failed atlas-daily-maintenance.service atlas-fulltext-sync.service || true
systemctl --user enable --now atlas-daily-maintenance.timer atlas-fulltext-sync.timer
systemctl --user list-timers --all --no-pager | grep -E 'atlas-(daily-maintenance|fulltext-sync)' || true
systemctl --user show atlas-daily-maintenance.service atlas-fulltext-sync.service \
  -p Id -p Restart -p RestartForceExitStatus -p RestartUSec --no-pager
if [[ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || true)" != "yes" ]]; then
  printf 'WARNING: user lingering is disabled; run: loginctl enable-linger %q\n' "$(id -un)" >&2
fi
printf 'Atlas timers installed. Maintenance is fixed at 04:00 Asia/Shanghai; full-text sync resumes at 05:30 and shares the maintenance lock. Only explicit temporary-failure exit 75 is retried within bounded systemd start limits.\n'
