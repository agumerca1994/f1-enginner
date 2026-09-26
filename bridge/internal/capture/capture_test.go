package capture

import (
	"bytes"
	"io"
	"path/filepath"
	"testing"
	"time"
)

func TestRoundTrip(t *testing.T) {
	for _, name := range []string{"a.f1cap", "a.f1cap.zst"} {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), name)
			w, err := Create(path, Meta{BridgeVersion: "test", Note: "rt"})
			if err != nil {
				t.Fatal(err)
			}
			start := time.Now()
			in := []Record{
				{0, []byte{1, 2, 3}},
				{15 * time.Millisecond, bytes.Repeat([]byte{7}, 1460)},
				{2 * time.Second, []byte{}},
			}
			for _, rec := range in {
				if err := w.Write(start.Add(rec.Offset), rec.Data); err != nil {
					t.Fatal(err)
				}
			}
			if err := w.Close(); err != nil {
				t.Fatal(err)
			}

			r, err := Open(path)
			if err != nil {
				t.Fatal(err)
			}
			defer r.Close()
			if r.Meta.Note != "rt" {
				t.Fatalf("meta not preserved: %+v", r.Meta)
			}
			for i, want := range in {
				got, err := r.Next()
				if err != nil {
					t.Fatalf("record %d: %v", i, err)
				}
				if got.Offset != want.Offset || !bytes.Equal(got.Data, want.Data) {
					t.Fatalf("record %d mismatch", i)
				}
			}
			if _, err := r.Next(); err != io.EOF {
				t.Fatalf("expected EOF, got %v", err)
			}
		})
	}
}
