package capture

import (
	"bytes"
	"fmt"
	"io"
	"time"
)

// Comparison is the result of checking a capture against another one, for
// example a replay recorded back against the original.
type Comparison struct {
	Records       int           // records compared
	MaxDrift      time.Duration // largest absolute timing difference
	FirstDiff     int           // index of the first byte mismatch, or -1
	CountA        int
	CountB        int
	OverTolerance int // records whose timing differs by more than the tolerance
}

// OK reports whether both captures hold the same datagrams, in order, within the tolerance.
func (c Comparison) OK() bool {
	return c.FirstDiff == -1 && c.CountA == c.CountB && c.OverTolerance == 0
}

func (c Comparison) String() string {
	s := fmt.Sprintf("records: %d vs %d, compared %d, max timing drift %s, over tolerance %d",
		c.CountA, c.CountB, c.Records, c.MaxDrift, c.OverTolerance)
	if c.FirstDiff >= 0 {
		s += fmt.Sprintf(", first content mismatch at record %d", c.FirstDiff)
	}
	return s
}

// Compare walks both captures record by record. Offsets are relative to each
// capture's first datagram, so the two recordings need not start at the same time.
func Compare(a, b *Reader, tolerance time.Duration) (Comparison, error) {
	c := Comparison{FirstDiff: -1}
	var doneA, doneB bool
	for !doneA || !doneB {
		var ra, rb Record
		var err error
		if !doneA {
			if ra, err = a.Next(); err == io.EOF {
				doneA = true
			} else if err != nil {
				return c, fmt.Errorf("first capture: %w", err)
			} else {
				c.CountA++
			}
		}
		if !doneB {
			if rb, err = b.Next(); err == io.EOF {
				doneB = true
			} else if err != nil {
				return c, fmt.Errorf("second capture: %w", err)
			} else {
				c.CountB++
			}
		}
		if doneA || doneB {
			continue
		}
		if c.FirstDiff == -1 && !bytes.Equal(ra.Data, rb.Data) {
			c.FirstDiff = c.Records
		}
		drift := ra.Offset - rb.Offset
		if drift < 0 {
			drift = -drift
		}
		if drift > c.MaxDrift {
			c.MaxDrift = drift
		}
		if drift > tolerance {
			c.OverTolerance++
		}
		c.Records++
	}
	return c, nil
}
