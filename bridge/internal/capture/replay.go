package capture

import (
	"context"
	"io"
	"time"
)

// Replay sends every record of r to send, keeping the original spacing between
// datagrams divided by speed. A speed of 0 or less sends as fast as possible.
// Each datagram is scheduled against the replay start, so small sleep errors do
// not accumulate over a long session.
func Replay(ctx context.Context, r *Reader, speed float64, send func([]byte) error) (int, error) {
	start := time.Now()
	n := 0
	for {
		rec, err := r.Next()
		if err == io.EOF {
			return n, nil
		}
		if err != nil {
			return n, err
		}
		if speed > 0 {
			target := start.Add(time.Duration(float64(rec.Offset) / speed))
			if err := sleepUntil(ctx, target); err != nil {
				return n, err
			}
		} else if ctx.Err() != nil {
			return n, ctx.Err()
		}
		if err := send(rec.Data); err != nil {
			return n, err
		}
		n++
	}
}

// sleepUntil sleeps most of the wait and spins the last millisecond, because
// timer resolution alone can overshoot by a few milliseconds.
func sleepUntil(ctx context.Context, target time.Time) error {
	if wait := time.Until(target) - time.Millisecond; wait > 0 {
		t := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			t.Stop()
			return ctx.Err()
		case <-t.C:
		}
	}
	for time.Now().Before(target) {
	}
	return nil
}
