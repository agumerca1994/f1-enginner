package overlay

import (
	"encoding/binary"
	"math"
	"sync"
	"time"
)

const (
	headerSize       = 29
	carTelemetryID   = 6
	telemetryTrailer = 3 // MFD panel indices and suggested gear after the cars
	throttleOffset   = 2 // after speed (u16)
	brakeOffset      = 10
)

// Pedals reads throttle and brake straight from the game's CarTelemetry packets
// on this computer: they change faster than the server's snapshot is pushed.
type Pedals struct {
	mu       sync.Mutex
	throttle float64
	brake    float64
	at       time.Time
}

// Observe takes any datagram from the game and keeps the player's pedals from
// CarTelemetry. The car record is 60 bytes for 22 cars (2024 and 2025 formats)
// and 59 for 24 (2026: 8-bit engine temperature); anything else is ignored.
func (p *Pedals) Observe(at time.Time, b []byte) {
	if len(b) <= headerSize || b[6] != carTelemetryID {
		return
	}
	body := len(b) - headerSize - telemetryTrailer
	var record int
	switch {
	case body == 22*60:
		record = 60
	case body == 24*59:
		record = 59
	default:
		return
	}
	player := int(b[27])
	if player >= body/record {
		return // 255 in menus or spectating
	}
	off := headerSize + player*record
	throttle := math.Float32frombits(binary.LittleEndian.Uint32(b[off+throttleOffset:]))
	brake := math.Float32frombits(binary.LittleEndian.Uint32(b[off+brakeOffset:]))
	if !valid(throttle) || !valid(brake) {
		return
	}
	p.mu.Lock()
	p.throttle, p.brake, p.at = float64(throttle), float64(brake), at
	p.mu.Unlock()
}

func valid(v float32) bool { return v >= -0.01 && v <= 1.01 }

// Get returns the last pedals and when they arrived (zero time if never).
func (p *Pedals) Get() (throttle, brake float64, at time.Time) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return clamp01(p.throttle), clamp01(p.brake), p.at
}

func clamp01(v float64) float64 { return math.Max(0, math.Min(1, v)) }
