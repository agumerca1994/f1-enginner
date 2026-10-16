package main

import (
	"encoding/binary"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/agumerca1994/race-engineer/bridge/internal/capture"
	"github.com/agumerca1994/race-engineer/bridge/internal/udp"
)

// TestSamplerRecordsUnknownFormats records datagrams of a format the server
// does not know yet, and checks the capture and its summary.
func TestSamplerRecordsUnknownFormats(t *testing.T) {
	t.Setenv("HOME", t.TempDir())    // macOS config dir
	t.Setenv("APPDATA", t.TempDir()) // Windows config dir
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	s := sampler{addr: ":20799"} // the real app may hold :20777
	if err := s.start(nil, "formato 2026, Monza"); err != nil {
		t.Fatal(err)
	}
	out, err := udp.Dial("127.0.0.1" + s.addr)
	if err != nil {
		t.Fatal(err)
	}
	defer out.Close()
	pkt := make([]byte, 1600) // larger than any 2024 packet
	binary.LittleEndian.PutUint16(pkt[0:2], 2026)
	pkt[2] = 25 // game year
	pkt[6] = 16 // packet id
	for i := 0; i < 5; i++ {
		if _, err := out.Write(pkt); err != nil {
			t.Fatal(err)
		}
	}
	deadline := time.Now().Add(2 * time.Second)
	for !strings.Contains(s.progress(), "5 paquetes") && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if p := s.progress(); !strings.Contains(p, "formato 2026") {
		t.Fatalf("progress = %q", p)
	}

	path, err := s.stop()
	if err != nil {
		t.Fatal(err)
	}
	r, err := capture.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if r.Meta.Note != "formato 2026, Monza" {
		t.Fatalf("note = %q", r.Meta.Note)
	}
	n := 0
	for {
		rec, err := r.Next()
		if err != nil {
			break
		}
		if len(rec.Data) != len(pkt) {
			t.Fatalf("record of %d bytes, want %d", len(rec.Data), len(pkt))
		}
		n++
	}
	if n != 5 {
		t.Fatalf("recorded %d datagrams, want 5", n)
	}
	summary, err := os.ReadFile(strings.TrimSuffix(path, ".f1cap.zst") + ".txt")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(summary), "2026") || !strings.Contains(string(summary), "1600B") {
		t.Fatalf("summary:\n%s", summary)
	}
}
