package main

import (
	"io"
	"log"
	"testing"

	"fyne.io/fyne/v2/test"
	"fyne.io/fyne/v2/theme"

	"github.com/agumerca1994/race-engineer/bridge/internal/config"
)

// TestDevModeCheck turns development mode on and off by tapping the check,
// as a player would: the tab must come and go with it.
func TestDevModeCheck(t *testing.T) {
	a := test.NewTempApp(t)
	a.Settings().SetTheme(theme.DarkTheme()) // the test theme lacks the bold monospace font of the tiles
	c := &controller{app: a, log: log.New(io.Discard, "", 0), cfg: config.Config{Token: "rbd_x"}}
	c.window = newStatusWindow(c)
	w := c.window
	hasDevTab := func() bool {
		for _, it := range w.tabs.Items {
			if it == w.devTab {
				return true
			}
		}
		return false
	}

	if hasDevTab() {
		t.Fatal("development tab shown with development mode off")
	}
	test.Tap(w.devCheck)
	if !c.devMode() || !hasDevTab() || w.tabs.Selected() != w.devTab {
		t.Fatalf("after turning on: devMode=%v tab=%v", c.devMode(), hasDevTab())
	}
	test.Tap(w.devCheck)
	if c.devMode() || hasDevTab() || w.devCheck.Checked {
		t.Fatalf("after turning off: devMode=%v tab=%v checked=%v", c.devMode(), hasDevTab(), w.devCheck.Checked)
	}
	test.Tap(w.devCheck)
	if !c.devMode() || !hasDevTab() {
		t.Fatal("could not turn it on again")
	}
}
