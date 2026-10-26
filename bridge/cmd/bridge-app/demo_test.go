package main

import (
	"archive/zip"
	"bytes"
	"io"
	"log"
	"os"
	"os/user"
	"strings"
	"testing"

	"fyne.io/fyne/v2/test"

	"github.com/agumerca1994/race-engineer/bridge/internal/capture"
	"github.com/agumerca1994/race-engineer/bridge/internal/config"
	"github.com/agumerca1994/race-engineer/bridge/internal/header"
)

func TestDemoRaceIsEmbeddedAndReadable(t *testing.T) {
	r, err := capture.NewReader(bytes.NewReader(demoCapture), true)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	n, laps := 0, 0
	for {
		rec, err := r.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		h, err := header.Parse(rec.Data)
		if err != nil {
			t.Fatal(err)
		}
		if h.PacketID == 2 {
			laps++
		}
		n++
	}
	if n < 10000 || laps < 1000 {
		t.Fatalf("the demo race is too short: %d datagrams, %d LapData", n, laps)
	}
}

func TestDiagnosisHasNoTokenNorUserName(t *testing.T) {
	home := t.TempDir()
	os.MkdirAll(home+"/Downloads", 0o755)
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	a := test.NewTempApp(t)
	c := &controller{app: a, log: log.New(io.Discard, "", 0),
		cfg: config.Config{Server: "https://example.test", Token: "rbd_secret-token", DeviceID: 7}}

	path, err := c.diagnose()
	if err != nil {
		t.Fatal(err)
	}
	z, err := zip.OpenReader(path)
	if err != nil {
		t.Fatal(err)
	}
	defer z.Close()
	var all strings.Builder
	for _, f := range z.File {
		rc, _ := f.Open()
		io.Copy(&all, rc)
		rc.Close()
	}
	text := all.String()
	if !strings.Contains(text, "dispositivo 7") || !strings.Contains(text, "example.test") {
		t.Fatalf("summary missing the basics:\n%s", text)
	}
	if strings.Contains(text, "rbd_secret-token") {
		t.Fatal("the device token leaked into the diagnostics")
	}
	if u, err := user.Current(); err == nil && len(u.Username) >= 3 && strings.Contains(text, u.Username) {
		t.Fatal("the user name leaked into the diagnostics")
	}
}
