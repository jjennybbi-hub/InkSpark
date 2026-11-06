#!/usr/bin/env bash
# Builds InkSpark and safely replaces the app the owner opens from the Dock.
# Nothing is touched until checks and the build pass, the app quits on its own,
# and the old version is kept for rollback. Usage: scripts/install-app.sh
set -euo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"
cd "$(dirname "$0")/.."

APP_NAME="InkSpark"
BUNDLE_ID="io.github.jjennybbi.inkspark"
APPS_DIR="$HOME/Applications"
INSTALLED="$APPS_DIR/$APP_NAME.app"
PREVIOUS="$APPS_DIR/$APP_NAME (previous).app"
STAGED="$APPS_DIR/.$APP_NAME-new.app"
BUILT="target/release/bundle/macos/$APP_NAME.app"
EXECUTABLE="$INSTALLED/Contents/MacOS/inkspark"

is_running() { pgrep -f "$EXECUTABLE" >/dev/null; }

echo "Running checks..."
npm run typecheck
npm test

echo "Building (this can take several minutes)..."
npm run tauri build -- --bundles app

echo "Preparing the new version..."
mkdir -p "$APPS_DIR"
rm -rf "$STAGED"
cp -R "$BUILT" "$STAGED"
codesign --force --deep -s - --identifier "$BUNDLE_ID" "$STAGED"
codesign --verify --deep "$STAGED"

if is_running; then
  echo "Closing $APP_NAME so it can save..."
  osascript -e "quit app \"$APP_NAME\""
  for _ in $(seq 1 20); do
    is_running || break
    sleep 1
  done
  if is_running; then
    rm -rf "$STAGED"
    echo "$APP_NAME did not close. Nothing was changed. Close it and try again." >&2
    exit 1
  fi
fi

if [ -e "$INSTALLED" ]; then
  rm -rf "$PREVIOUS"
  mv "$INSTALLED" "$PREVIOUS"
fi
mv "$STAGED" "$INSTALLED"

echo "Opening the new version..."
open "$INSTALLED"
sleep 6
if ! is_running; then
  echo "The new version did not stay open. Putting the previous version back." >&2
  "$(dirname "$0")/rollback-app.sh"
  exit 1
fi

echo "INKSPARK_INSTALLED"
