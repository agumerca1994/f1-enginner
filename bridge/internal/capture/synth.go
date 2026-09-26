package capture

import (
	"encoding/binary"
	"math"
	"time"

	"github.com/agumerca1994/race-engineer/bridge/internal/header"
)

// Synthesize writes a capture with valid 2024 headers, spec-sized packets and
// the game's send cadence. Bodies are zero-filled (except Event codes), so it
// exercises transport and routing, not the parser's field decoding.
func Synthesize(w *Writer, duration time.Duration, rateHz int) error {
	if rateHz <= 0 {
		rateHz = 20
	}
	const sessionUID = 0x5EED5EED5EED5EED
	start := time.Now()
	frameDt := time.Second / time.Duration(rateHz)
	frames := int(duration / frameDt)

	write := func(frame int, at time.Duration, id uint8, fill func([]byte)) error {
		b := make([]byte, header.Sizes2024[id])
		le := binary.LittleEndian
		le.PutUint16(b[0:2], 2024)
		b[2], b[3], b[4], b[5], b[6] = 24, 1, 18, 1, id
		le.PutUint64(b[7:15], sessionUID)
		le.PutUint32(b[15:19], math.Float32bits(float32(at.Seconds())))
		le.PutUint32(b[19:23], uint32(frame))
		le.PutUint32(b[23:27], uint32(frame))
		b[27], b[28] = 0, 255
		if fill != nil {
			fill(b[header.Size:])
		}
		return w.Write(start.Add(at), b)
	}
	event := func(code string) func([]byte) {
		return func(body []byte) { copy(body, code) }
	}
	every := func(frame int, perSecond float64) bool {
		step := int(math.Round(float64(rateHz) / perSecond))
		return step <= 1 || frame%step == 0
	}

	if err := write(0, 0, 3, event("SSTA")); err != nil {
		return err
	}
	for f := 0; f < frames; f++ {
		at := time.Duration(f) * frameDt
		for _, id := range []uint8{0, 13, 2, 6, 7} { // sent every frame
			if err := write(f, at, id, nil); err != nil {
				return err
			}
		}
		sched := []struct {
			id uint8
			hz float64
		}{{1, 2}, {5, 2}, {10, 10}, {11, 20}, {12, 20}, {4, 0.2}}
		for _, s := range sched {
			if every(f, s.hz) {
				if err := write(f, at, s.id, nil); err != nil {
					return err
				}
			}
		}
	}
	return write(frames, time.Duration(frames)*frameDt, 3, event("SEND"))
}
