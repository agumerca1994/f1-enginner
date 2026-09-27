// Package autostart opens the bridge app when the user logs in, through a
// per-user LaunchAgent (no admin rights needed).
package autostart

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const label = "ar.com.imanzanastore.raceengineer.bridge"

func plistPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Library", "LaunchAgents", label+".plist"), nil
}

// Enabled reports whether the app opens at login.
func Enabled() bool {
	p, err := plistPath()
	if err != nil {
		return false
	}
	_, err = os.Stat(p)
	return err == nil
}

// Enable makes the app open at login. Inside an .app bundle it launches the
// bundle (so macOS treats it as the app); otherwise the executable itself.
func Enable() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	args := []string{exe, "--background"}
	if i := strings.Index(exe, ".app/Contents/MacOS/"); i >= 0 {
		args = []string{"/usr/bin/open", "-g", exe[:i+4], "--args", "--background"}
	}
	var b strings.Builder
	for _, a := range args {
		fmt.Fprintf(&b, "\t\t<string>%s</string>\n", xmlEscape(a))
	}
	plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>%s</string>
	<key>ProgramArguments</key>
	<array>
%s	</array>
	<key>RunAtLoad</key>
	<true/>
</dict>
</plist>
`, label, b.String())
	p, err := plistPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	return os.WriteFile(p, []byte(plist), 0o644)
}

// Disable stops the app from opening at login.
func Disable() error {
	p, err := plistPath()
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func xmlEscape(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(s)
}
