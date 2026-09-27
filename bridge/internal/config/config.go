// Package config stores the bridge's server address and device token.
package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

// DefaultServer is the production API.
const DefaultServer = "https://f1-api.imanzanastore.com.ar"

// Config is what `bridge pair` saves and `bridge run` reads.
type Config struct {
	Server   string `json:"server"`
	Token    string `json:"token"`
	DeviceID int    `json:"device_id"`
}

// Path returns where the config lives, for example
// ~/Library/Application Support/race-engineer/config.json on macOS.
// BRIDGE_CONFIG overrides it (tests, several accounts on one machine).
func Path() (string, error) {
	if p := os.Getenv("BRIDGE_CONFIG"); p != "" {
		return p, nil
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "race-engineer", "config.json"), nil
}

// Load reads the config. A missing file returns an empty config, not an error.
func Load() (Config, error) {
	path, err := Path()
	if err != nil {
		return Config{}, err
	}
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return Config{}, nil
	}
	if err != nil {
		return Config{}, err
	}
	var c Config
	return c, json.Unmarshal(b, &c)
}

// Save writes the config readable only by the current user: it holds a credential.
func Save(c Config) error {
	path, err := Path()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}
