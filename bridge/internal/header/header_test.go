package header

import (
	"encoding/binary"
	"math"
	"testing"
)

func TestParse(t *testing.T) {
	b := make([]byte, Size)
	le := binary.LittleEndian
	le.PutUint16(b[0:2], 2024)
	b[2], b[3], b[4], b[5], b[6] = 24, 1, 17, 1, 6
	le.PutUint64(b[7:15], 0xDEADBEEFCAFEBABE)
	le.PutUint32(b[15:19], math.Float32bits(12.5))
	le.PutUint32(b[19:23], 100)
	le.PutUint32(b[23:27], 105)
	b[27], b[28] = 3, 255

	h, err := Parse(b)
	if err != nil {
		t.Fatal(err)
	}
	want := Header{2024, 24, 1, 17, 1, 6, 0xDEADBEEFCAFEBABE, 12.5, 100, 105, 3, 255}
	if h != want {
		t.Fatalf("got %+v, want %+v", h, want)
	}
}

func TestParseShort(t *testing.T) {
	if _, err := Parse(make([]byte, Size-1)); err != ErrShort {
		t.Fatalf("expected ErrShort, got %v", err)
	}
}
