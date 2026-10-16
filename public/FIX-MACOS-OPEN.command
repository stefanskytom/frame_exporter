#!/bin/bash
# Double-click this file (or run in Terminal) if Frame Exporter won't open
# after download / AirDrop / email. Clears Gatekeeper quarantine flags.
set -euo pipefail
cd "$(dirname "$0")"

APP="Frame Exporter.app"
if [[ ! -d "$APP" ]]; then
  # Also try next to a zip extract
  if [[ -d "../Frame Exporter.app" ]]; then
    APP="../Frame Exporter.app"
  else
    echo "Could not find Frame Exporter.app next to this script."
    read -r -p "Press Enter to close…"
    exit 1
  fi
fi

echo "Clearing quarantine from: $APP"
xattr -cr "$APP" || true
# Re-apply ad-hoc signature if codesign is available (helps on Apple Silicon)
if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "$APP" 2>/dev/null || true
fi

echo
echo "Done. Opening Frame Exporter…"
open "$APP"
echo
read -r -p "Press Enter to close…"
