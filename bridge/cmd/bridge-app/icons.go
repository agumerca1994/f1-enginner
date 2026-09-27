package main

import (
	_ "embed"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/theme"
)

//go:embed Icon.png
var iconPNG []byte

//go:embed tray.svg
var traySVG []byte

var appIcon = fyne.NewStaticResource("Icon.png", iconPNG)

// A themed (monochrome) resource: macOS draws it as a template image that
// follows the menu bar's light or dark appearance.
var trayIcon = theme.NewThemedResource(fyne.NewStaticResource("tray.svg", traySVG))
