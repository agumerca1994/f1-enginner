package doctor

import "testing"

func TestReception(t *testing.T) {
	cases := []struct {
		name   string
		frames []uint32
		want   float64
	}{
		{"all received", []uint32{0, 2, 4, 6, 8, 10}, 1},
		{"half lost", []uint32{0, 2, 6, 10, 14, 18}, 0.6}, // 6 of 10
		{"flashback", []uint32{100, 102, 104, 50, 52, 54}, 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := NewStats()
			s.telemetryFrames = c.frames
			got, ok := s.Reception()
			if !ok {
				t.Fatal("expected an estimate")
			}
			if got < c.want-0.01 || got > c.want+0.01 {
				t.Fatalf("got %.2f, want %.2f", got, c.want)
			}
		})
	}
}
