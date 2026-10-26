package overlay

import (
	"encoding/binary"
	"math"
	"testing"
	"time"
)

func telemetryPacket(cars, record, player int, throttle, brake float32) []byte {
	b := make([]byte, headerSize+cars*record+telemetryTrailer)
	binary.LittleEndian.PutUint16(b, 2024)
	b[6], b[27] = carTelemetryID, byte(player)
	off := headerSize + player*record
	binary.LittleEndian.PutUint32(b[off+throttleOffset:], math.Float32bits(throttle))
	binary.LittleEndian.PutUint32(b[off+brakeOffset:], math.Float32bits(brake))
	return b
}

func TestPedalsReadThePlayersCarInEveryFormat(t *testing.T) {
	for _, tc := range []struct{ cars, record int }{{22, 60}, {24, 59}} {
		var p Pedals
		now := time.Now()
		p.Observe(now, telemetryPacket(tc.cars, tc.record, 19, 0.75, 0.2))
		th, br, at := p.Get()
		if math.Abs(th-0.75) > 1e-6 || math.Abs(br-0.2) > 1e-6 || !at.Equal(now) {
			t.Fatalf("%d cars: got throttle %v brake %v at %v", tc.cars, th, br, at)
		}
	}
}

func TestPedalsIgnoreOtherPacketsAndMenus(t *testing.T) {
	var p Pedals
	other := telemetryPacket(22, 60, 0, 1, 1)
	other[6] = 2 // LapData
	p.Observe(time.Now(), other)
	p.Observe(time.Now(), telemetryPacket(22, 60, 0, 1, 1)[:100]) // truncated
	menu := telemetryPacket(22, 60, 0, 1, 1)
	menu[27] = 255
	p.Observe(time.Now(), menu)
	if _, _, at := p.Get(); !at.IsZero() {
		t.Fatal("pedals were read from a packet that is not the player's CarTelemetry")
	}
}
