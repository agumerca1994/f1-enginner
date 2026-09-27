#!/usr/bin/env bash
# Builds bridge/bin/Ingeniero Bridge.app: the menu bar app that links this Mac
# and sends the game's telemetry. Needs Go and the Xcode command line tools.
#
#   ./scripts/build-mac-app.sh [version]
set -euo pipefail

VERSION="${1:-0.1.0}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/bridge/bin/Ingeniero Bridge.app"
FYNE="$(go env GOPATH)/bin/fyne"

[ -x "$FYNE" ] || go install fyne.io/tools/cmd/fyne@latest

cd "$ROOT/bridge/cmd/bridge-app"
rm -rf "Ingeniero Bridge.app" "$APP"
"$FYNE" package --os darwin --name "Ingeniero Bridge" \
  --app-id ar.com.imanzanastore.raceengineer.bridge \
  --icon Icon.png --app-version "$VERSION" --release
mkdir -p "$ROOT/bridge/bin"
mv "Ingeniero Bridge.app" "$APP"

# Menu bar app: no Dock icon.
/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$APP/Contents/Info.plist" 2>/dev/null ||
  /usr/libexec/PlistBuddy -c "Set :LSUIElement true" "$APP/Contents/Info.plist"

# Ad-hoc signature (the plist changed after packaging). Distribution to other
# players needs a Developer ID signature and notarization (P7).
codesign --force --deep -s - "$APP"
echo "Built: $APP"
