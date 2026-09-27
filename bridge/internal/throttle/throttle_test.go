package throttle

import (
	"testing"
	"time"

	"github.com/agumerca1994/race-engineer/bridge/internal/header"
)

func packet(id uint8, body ...byte) (header.Header, []byte) {
	data := make([]byte, header.Size+len(body))
	copy(data[header.Size:], body)
	return header.Header{PacketID: id, PacketFormat: 2024}, data
}

func TestRateCap(t *testing.T) {
	f := New()
	t0 := time.Now()
	h, d := packet(carTelemetry)
	got := 0
	for i := 0; i < 60; i++ { // one second at 60 Hz
		if f.Allow(h, d, t0.Add(time.Duration(i)*time.Second/60)) {
			got++
		}
	}
	if got < 9 || got > 11 {
		t.Fatalf("forwarded %d CarTelemetry packets in 1s, want about 10", got)
	}
}

func TestOnChangeWithKeepalive(t *testing.T) {
	f := New()
	t0 := time.Now()
	h, same := packet(carDamage, 1, 2, 3)
	if !f.Allow(h, same, t0) {
		t.Fatal("first packet must pass")
	}
	if f.Allow(h, same, t0.Add(time.Second)) {
		t.Fatal("unchanged packet must be dropped")
	}
	_, changed := packet(carDamage, 1, 2, 4)
	if !f.Allow(h, changed, t0.Add(2*time.Second)) {
		t.Fatal("changed packet must pass")
	}
	if !f.Allow(h, changed, t0.Add(2*time.Second+Keepalive)) {
		t.Fatal("unchanged packet must pass after the keepalive")
	}
}

func TestPerCarStreams(t *testing.T) {
	f := New()
	t0 := time.Now()
	h, car0 := packet(sessionHistory, 0, 9)
	_, car1 := packet(sessionHistory, 1, 9)
	if !f.Allow(h, car0, t0) || !f.Allow(h, car1, t0) {
		t.Fatal("each car's history is its own stream")
	}
	if f.Allow(h, car0, t0.Add(time.Second)) {
		t.Fatal("unchanged history for car 0 must be dropped")
	}
}

func TestEventsAlwaysPass(t *testing.T) {
	f := New()
	h, d := packet(3, 'O', 'V', 'T', 'K')
	for i := 0; i < 5; i++ {
		if !f.Allow(h, d, time.Now()) {
			t.Fatal("events must never be throttled")
		}
	}
}
