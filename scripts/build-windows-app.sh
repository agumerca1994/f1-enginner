#!/usr/bin/env bash
# Builds the Windows bridge from a Mac: the tray app (Ingeniero Bridge.exe), the
# command line (bridge.exe) and the player's guide, zipped in bridge/bin/windows/.
# Needs Go and mingw-w64 (brew install mingw-w64) for the app's cgo parts.
#
#   ./scripts/build-windows-app.sh [version]
set -euo pipefail

VERSION="${1:-0.1.0}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/bridge/bin/windows"
FYNE="$(go env GOPATH)/bin/fyne"
export CC=x86_64-w64-mingw32-gcc

command -v "$CC" >/dev/null || { echo "Missing $CC: brew install mingw-w64" >&2; exit 1; }
[ -x "$FYNE" ] || go install fyne.io/tools/cmd/fyne@latest

rm -rf "$OUT" && mkdir -p "$OUT"

cd "$ROOT/bridge/cmd/bridge-app"
GOOS=windows GOARCH=amd64 CGO_ENABLED=1 "$FYNE" package --os windows --name "Ingeniero Bridge" \
  --app-id ar.com.imanzanastore.raceengineer.bridge \
  --icon Icon.png --app-version "$VERSION" --release
mv "Ingeniero Bridge.exe" "$OUT/"

cd "$ROOT/bridge"
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "-X main.version=$VERSION" -o "$OUT/bridge.exe" ./cmd/bridge

cp "$ROOT/bridge/cmd/bridge-app/LEEME-windows.txt" "$OUT/LEEME.txt"

cd "$OUT"
zip -q "ingeniero-bridge-windows-$VERSION.zip" "Ingeniero Bridge.exe" bridge.exe LEEME.txt
echo "Built: $OUT/ingeniero-bridge-windows-$VERSION.zip"
