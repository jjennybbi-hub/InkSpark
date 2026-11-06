#!/usr/bin/env bash
# Swaps the previous InkSpark version back in. Usage: scripts/rollback-app.sh
set -euo pipefail

APP_NAME="InkSpark"
APPS_DIR="$HOME/Applications"
INSTALLED="$APPS_DIR/$APP_NAME.app"
PREVIOUS="$APPS_DIR/$APP_NAME (previous).app"
SWAP="$APPS_DIR/.$APP_NAME-swap.app"

if [ ! -e "$PREVIOUS" ]; then
  echo "There is no previous version to go back to." >&2
  exit 1
fi

if pgrep -f "$INSTALLED/Contents/MacOS/inkspark" >/dev/null; then
  osascript -e "quit app \"$APP_NAME\""
  sleep 3
fi

rm -rf "$SWAP"
if [ -e "$INSTALLED" ]; then mv "$INSTALLED" "$SWAP"; fi
mv "$PREVIOUS" "$INSTALLED"
if [ -e "$SWAP" ]; then mv "$SWAP" "$PREVIOUS"; fi

open "$INSTALLED"
echo "INKSPARK_ROLLED_BACK"
