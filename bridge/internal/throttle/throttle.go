// Package throttle decides which datagrams are worth uploading.
//
// High-rate packets are capped per type; slow-changing packets are sent only
// when their content changes (plus a periodic keepalive). Everything else,
// including every Event, passes through. On a lossy console link the game's
// rate is already below these caps and nearly everything is forwarded.
package throttle

import (
	"hash/fnv"
	"time"

	"github.com/agumerca1994/race-engineer/bridge/internal/header"
)

// Packet IDs of format 2024.
const (
	motion         = 0
	lapData        = 2
	carSetups      = 5
	carTelemetry   = 6
	carStatus      = 7
	carDamage      = 10
	sessionHistory = 11
	tyreSets       = 12
	motionEx       = 13
)

// minInterval caps how often each high-rate packet type is forwarded.
var minInterval = map[uint8]time.Duration{
	lapData:      100 * time.Millisecond,
	carTelemetry: 100 * time.Millisecond,
	carStatus:    200 * time.Millisecond,
	motionEx:     200 * time.Millisecond,
	motion:       200 * time.Millisecond,
}

// onChange lists packets forwarded only when their body changes. The value
// tells whether the first body byte is a car index that splits the stream.
var onChange = map[uint8]bool{
	carSetups:      false,
	carDamage:      false,
	sessionHistory: true,
	tyreSets:       true,
}

// Keepalive re-sends unchanged packets this often so the server's view never goes stale.
const Keepalive = 5 * time.Second

type key struct {
	id  uint8
	car uint8
}

type seen struct {
	at   time.Time
	hash uint64
}

// Filter remembers what was forwarded. It is not safe for concurrent use.
type Filter struct {
	last map[key]seen
}

// New returns an empty Filter.
func New() *Filter { return &Filter{last: map[key]seen{}} }

// Allow reports whether a datagram received at now should be uploaded.
func (f *Filter) Allow(h header.Header, data []byte, now time.Time) bool {
	if gap, ok := minInterval[h.PacketID]; ok {
		k := key{id: h.PacketID}
		if prev, ok := f.last[k]; ok && now.Sub(prev.at) < gap {
			return false
		}
		f.last[k] = seen{at: now}
		return true
	}
	if perCar, ok := onChange[h.PacketID]; ok {
		body := data[header.Size:]
		k := key{id: h.PacketID}
		if perCar && len(body) > 0 {
			k.car = body[0]
		}
		hs := fnv.New64a()
		hs.Write(body)
		sum := hs.Sum64()
		if prev, ok := f.last[k]; ok && prev.hash == sum && now.Sub(prev.at) < Keepalive {
			return false
		}
		f.last[k] = seen{at: now, hash: sum}
		return true
	}
	return true
}
