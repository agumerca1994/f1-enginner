package acc

import (
	"bytes"
	"context"
	"encoding/binary"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// fakeACC answers like ACC's broadcasting API: a registration result, then a
// realtime update, and it records the commands it receives.
func fakeACC(t *testing.T, accept bool) (port int, commands chan []byte) {
	t.Helper()
	conn, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	commands = make(chan []byte, 32)
	go func() {
		buf := make([]byte, 2048)
		for {
			n, from, err := conn.ReadFromUDP(buf)
			if err != nil {
				return
			}
			cmd := append([]byte(nil), buf[:n]...)
			commands <- cmd
			if cmd[0] == cmdRegister {
				ok := byte(0)
				if accept {
					ok = 1
				}
				reply := binary.LittleEndian.AppendUint32([]byte{msgRegistrationResult}, 42)
				reply = append(reply, ok, 1, 0, 0) // success, readonly, empty error string
				conn.WriteToUDP(reply, from)
				if accept {
					conn.WriteToUDP([]byte{2, 1, 0, 0, 0}, from) // the start of a realtime update
				}
			}
		}
	}()
	return conn.LocalAddr().(*net.UDPAddr).Port, commands
}

func TestBroadcastRegistersAndPassesMessagesOn(t *testing.T) {
	port, commands := fakeACC(t, true)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	got := make(chan []byte, 8)
	go Broadcast(ctx, BroadcastSettings{Port: port, Password: "asd"}, func(m []byte) { got <- m })

	reg := <-commands
	if reg[0] != cmdRegister || reg[1] != protocolVersion || !bytes.Contains(reg, []byte("asd")) {
		t.Fatalf("registration command %v", reg)
	}
	if m := <-got; m[0] != msgRegistrationResult {
		t.Fatalf("first message %v", m)
	}
	if m := <-got; m[0] != 2 {
		t.Fatalf("second message %v", m)
	}
	// Right after registering it asks for the entry list and the track.
	want := map[byte]bool{cmdRequestEntryList: false, cmdRequestTrackData: false}
	for range 2 {
		c := <-commands
		if int32(binary.LittleEndian.Uint32(c[1:5])) != 42 {
			t.Fatalf("request without the connection id: %v", c)
		}
		want[c[0]] = true
	}
	if !want[cmdRequestEntryList] || !want[cmdRequestTrackData] {
		t.Fatalf("requests %v", want)
	}
	cancel()
	select {
	case c := <-commands:
		if c[0] != cmdUnregister {
			t.Fatalf("expected an unregister, got %v", c)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not unregister when stopping")
	}
}

func TestBroadcastStopsOnARejectedRegistration(t *testing.T) {
	port, _ := fakeACC(t, false)
	err := Broadcast(context.Background(), BroadcastSettings{Port: port, Password: "wrong"}, func([]byte) {})
	if err != errRegistration {
		t.Fatalf("got %v", err)
	}
	if err := Broadcast(context.Background(), BroadcastSettings{}, func([]byte) {}); err == nil {
		t.Fatal("port 0 means broadcasting is off: that must be an error")
	}
}

func TestSettingsReadUTF16AndPrepare(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "Config", "broadcasting.json")
	os.MkdirAll(filepath.Dir(path), 0o755)
	// As ACC ships it: UTF-16 LE with a byte order mark, broadcasting off.
	os.WriteFile(path, encodeUTF16([]byte(`{"updListenerPort": 0, "connectionPassword": "", "commandPassword": ""}`)), 0o644)

	s, changed, err := PrepareSettings(path)
	if err != nil || !changed || s.Port != DefaultBroadcastPort || s.Password == "" {
		t.Fatalf("prepare: %+v changed=%v err=%v", s, changed, err)
	}
	raw, _ := os.ReadFile(path)
	if !bytes.HasPrefix(raw, []byte{0xFF, 0xFE}) {
		t.Fatal("the file must stay UTF-16, as ACC writes it")
	}
	back, err := ReadSettings(path)
	if err != nil || back != s {
		t.Fatalf("read back %+v, %v", back, err)
	}
	if _, changed, _ := PrepareSettings(path); changed {
		t.Fatal("an already prepared file was rewritten")
	}

	// A player's own port and password are kept.
	os.WriteFile(path, []byte(`{"updListenerPort": 9232, "connectionPassword": "mine", "commandPassword": ""}`), 0o644)
	if s, changed, _ := PrepareSettings(path); changed || s.Port != 9232 || s.Password != "mine" {
		t.Fatalf("own settings touched: %+v", s)
	}
}

func TestRecordEnvelope(t *testing.T) {
	r := Record(KindPhysics, []byte{1, 2})
	if string(r[:4]) != "ACCP" || !bytes.Equal(r[4:], []byte{1, 2}) {
		t.Fatalf("record %v", r)
	}
}
