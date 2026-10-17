package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// thisComputer names the player's computer in the UI ("esta Mac", "esta PC").
func thisComputer() string {
	if runtime.GOOS == "darwin" {
		return "esta Mac"
	}
	return "esta PC"
}

// trayPlace is where the app lives while its window is closed.
func trayPlace() string {
	if runtime.GOOS == "darwin" {
		return "la barra de menú"
	}
	return "la bandeja del sistema, junto al reloj"
}

// logDir is ~/Library/Logs/RaceEngineer on macOS and
// %LocalAppData%\RaceEngineer\Logs on Windows.
func logDir() (string, error) {
	if runtime.GOOS == "darwin" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, "Library", "Logs", "RaceEngineer"), nil
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(cache, "RaceEngineer", "Logs"), nil
}

// openFolder shows dir in Finder or the Explorer.
func openFolder(dir string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", dir).Start()
	case "windows":
		return exec.Command("explorer", dir).Start()
	default:
		return exec.Command("xdg-open", dir).Start()
	}
}

// openBrowser starts the default browser on raw and returns without waiting.
func openBrowser(raw string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", raw)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", raw)
	default:
		cmd = exec.Command("xdg-open", raw)
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait() // reap it; never block the caller
	return nil
}
