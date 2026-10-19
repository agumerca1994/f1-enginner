---
name: build-bridge-windows
description: Build the Windows bridge (Ingeniero Bridge.exe tray app + bridge.exe CLI) by cross-compiling from macOS, and optionally publish it as the GitHub release the landing page downloads. Use when asked to build, rebuild, package or release the bridge for Windows, make a new .exe, or ship a new bridge version.
---

# Build the Windows bridge from a Mac

The bridge is Go. The tray app (`bridge/cmd/bridge-app`) uses Fyne, which has cgo (OpenGL) parts,
so building it for Windows needs a C cross-compiler (mingw-w64) besides Go. The CLI
(`bridge/cmd/bridge`) is pure Go. Nobody builds on Windows: everything is cross-compiled on the Mac
by `scripts/build-windows-app.sh`.

## 1. Check the toolchain

```sh
go version                                    # Go from bridge/go.mod or newer
command -v x86_64-w64-mingw32-gcc || brew install mingw-w64
ls "$(go env GOPATH)/bin/fyne" || go install fyne.io/tools/cmd/fyne@latest
```

## 2. Test, then build

Pick the next version: look at `gh release list --limit 1` and bump it (patch for fixes).

```sh
cd bridge && go vet ./... && go test ./... && cd ..
./scripts/build-windows-app.sh <version>      # e.g. 0.2.4
```

The script runs, from `bridge/cmd/bridge-app`:

```sh
CC=x86_64-w64-mingw32-gcc GOOS=windows GOARCH=amd64 CGO_ENABLED=1 \
  fyne package --os windows --name "Ingeniero Bridge" \
  --app-id ar.com.imanzanastore.raceengineer.bridge \
  --icon Icon.png --app-version <version> --release
```

then builds `bridge.exe` with `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build ./cmd/bridge`,
copies `bridge/cmd/bridge-app/LEEME-windows.txt` as `LEEME.txt`, and zips the three files into
`bridge/bin/windows/ingeniero-bridge-windows-<version>.zip`. `bridge/bin/` is gitignored: binaries
never go in git.

## 3. Verify the output

```sh
file "bridge/bin/windows/Ingeniero Bridge.exe"   # must say: PE32+ executable (GUI) x86-64
unzip -l bridge/bin/windows/ingeniero-bridge-windows-<version>.zip   # exe, bridge.exe, LEEME.txt
```

"(GUI)" matters: without it Windows opens a console window next to the app. You cannot run the
.exe on the Mac; say so in your report, and that the real check is a Windows user opening it.

## 4. Publish (only when the user asks to release or ship)

The landing's download buttons point to
`https://github.com/agumerca1994/f1-enginner/releases/latest/download/ingeniero-bridge-windows.zip`,
so the asset name must be exactly `ingeniero-bridge-windows.zip`. Releases ship the Mac app too,
so build it as well (`./scripts/build-mac-app.sh <version>` leaves `bridge/bin/ingeniero-bridge-mac.zip`).

```sh
cp bridge/bin/windows/ingeniero-bridge-windows-<version>.zip bridge/bin/ingeniero-bridge-windows.zip
gh release create v<version> bridge/bin/ingeniero-bridge-windows.zip bridge/bin/ingeniero-bridge-mac.zip \
  --title "Ingeniero Bridge <version>" --notes "<what changed, in Spanish>

- Windows: antes de descomprimir, Propiedades del .zip → Desbloquear.
- Mac: si no abre, Ajustes del Sistema → Privacidad y seguridad → Abrir igualmente."
curl -sIL -o /dev/null -w "%{http_code}\n" \
  https://github.com/agumerca1994/f1-enginner/releases/latest/download/ingeniero-bridge-windows.zip   # 200
```

A release is public the moment it is created. Commit and push the code it was built from first.

## Troubleshooting

- `build constraints exclude all Go files in .../go-gl/gl`: cgo is off or `CC` is not the mingw
  compiler. Use the script; don't call `go build ./cmd/bridge-app` for Windows by hand.
- `x86_64-w64-mingw32-gcc: not found`: `brew install mingw-w64`.
- `fyne: command not found`: `go install fyne.io/tools/cmd/fyne@latest`.

## Known limits (tell the user when relevant)

- The .exe is **not code-signed**. SmartScreen can block it with no "Run anyway" button; unblocking
  the zip before extracting (Properties → Unblock, or `Get-ChildItem -Recurse | Unblock-File`)
  fixes it, and some antivirus products ask to create a rule. Signing is planned for P7.
- UI text in the Fyne app must avoid symbols the bundled font lacks on Windows (an arrow "→"
  rendered as "→�"). Use plain words or ">".
- Never call Fyne's `app.OpenURL` from a flow that must continue: on Windows it waits for
  `rundll32`, which can hang. Use `openBrowser` in `cmd/bridge-app/platform.go`.
- The app logs to `%LocalAppData%\RaceEngineer\Logs\bridge-app.log`; ask a Windows tester for it
  when something fails.
