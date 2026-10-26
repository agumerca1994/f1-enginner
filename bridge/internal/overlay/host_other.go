//go:build !windows

package overlay

// Floating panels over the game exist only on Windows; elsewhere the web
// overlays (OBS or a browser tab) cover the same need.
func newHost(hostEvents) host { return nil }
