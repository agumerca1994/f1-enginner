package acc

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"unicode/utf16"
)

// BroadcastSettings is the part of ACC's broadcasting.json the bridge uses.
type BroadcastSettings struct {
	Port     int    `json:"updListenerPort"`
	Password string `json:"connectionPassword"`
	Command  string `json:"commandPassword"`
}

// DefaultBroadcastPort is what the bridge sets up when broadcasting is off.
const DefaultBroadcastPort = 9000

// SettingsPath is Documents\Assetto Corsa Competizione\Config\broadcasting.json.
func SettingsPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Documents", "Assetto Corsa Competizione", "Config", "broadcasting.json"), nil
}

// ReadSettings reads broadcasting.json. ACC writes it in UTF-16 with a byte
// order mark; plain UTF-8 is accepted too.
func ReadSettings(path string) (BroadcastSettings, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return BroadcastSettings{}, err
	}
	var s BroadcastSettings
	return s, json.Unmarshal(decodeText(raw), &s)
}

// PrepareSettings switches broadcasting on when it is off, keeping a password
// that is already set. ACC reads the file only when it starts, so it has to be
// closed while this runs (or restarted afterwards). It reports whether it changed anything.
func PrepareSettings(path string) (BroadcastSettings, bool, error) {
	s, err := ReadSettings(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return s, false, err
	}
	if err == nil && s.Port > 0 && s.Password != "" {
		return s, false, nil
	}
	if s.Port <= 0 {
		s.Port = DefaultBroadcastPort
	}
	if s.Password == "" {
		s.Password = "ingeniero"
	}
	body, err := json.MarshalIndent(s, "", "    ")
	if err != nil {
		return s, false, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return s, false, err
	}
	return s, true, os.WriteFile(path, encodeUTF16(body), 0o644)
}

func decodeText(raw []byte) []byte {
	switch {
	case bytes.HasPrefix(raw, []byte{0xFF, 0xFE}):
		return utf16Bytes(raw[2:], binary.LittleEndian)
	case bytes.HasPrefix(raw, []byte{0xFE, 0xFF}):
		return utf16Bytes(raw[2:], binary.BigEndian)
	case len(raw) >= 2 && raw[1] == 0 && raw[0] != 0: // UTF-16 LE without a mark
		return utf16Bytes(raw, binary.LittleEndian)
	}
	return bytes.TrimPrefix(raw, []byte{0xEF, 0xBB, 0xBF})
}

func utf16Bytes(raw []byte, order binary.ByteOrder) []byte {
	units := make([]uint16, len(raw)/2)
	for i := range units {
		units[i] = order.Uint16(raw[2*i:])
	}
	return []byte(string(utf16.Decode(units)))
}

func encodeUTF16(text []byte) []byte {
	out := []byte{0xFF, 0xFE}
	for _, u := range utf16.Encode([]rune(string(text))) {
		out = binary.LittleEndian.AppendUint16(out, u)
	}
	return out
}
