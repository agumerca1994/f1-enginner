package overlay

import (
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// A real snapshot from the Madrid race fixture, late in the race.
func madrid(t *testing.T) *Snapshot {
	t.Helper()
	raw, err := os.ReadFile("testdata/madrid.json")
	if err != nil {
		t.Fatal(err)
	}
	var l Live
	l.handle(append(append([]byte(`{"type":"snapshot","data":`), raw...), '}'), time.Now())
	snap, _, _, _ := l.State()
	if snap == nil || snap.Lap == nil {
		t.Fatal("the fixture did not decode into a snapshot with a lap")
	}
	return snap
}

// Set OVERLAY_PNG_DIR to look at the panels: go test ./internal/overlay -run Render
func TestRenderEveryPanelFromARealSnapshot(t *testing.T) {
	snap := madrid(t)
	lap := 5
	v := View{
		Snap: snap, SnapAge: time.Second, Throttle: 0.82, Brake: 0.1, Pedals: true,
		Radio: &Radio{ID: 1, Lap: &lap, Text: "Hadjar viene a medio segundo, cuidá la salida de la 12.", Priority: "importante"},
	}
	dir := os.Getenv("OVERLAY_PNG_DIR")
	for _, p := range Panels {
		for _, scale := range []float64{1, 1.5} {
			img := Render(p.ID, v, scale)
			if img == nil {
				t.Fatalf("%s: nothing drawn with a live snapshot", p.ID)
			}
			if b := img.Bounds(); b.Dx() < 60 || b.Dy() < 60 {
				t.Fatalf("%s: suspiciously small panel %v", p.ID, b)
			}
			if dir != "" && scale == 1 {
				// Over a grass-green backdrop, as it would sit over the game.
				b := img.Bounds()
				bg := image.NewRGBA(image.Rect(0, 0, b.Dx()+40, b.Dy()+40))
				draw.Draw(bg, bg.Bounds(), image.NewUniform(color.RGBA{90, 107, 74, 255}), image.Point{}, draw.Src)
				draw.Draw(bg, b.Add(image.Pt(20, 20)), img, image.Point{}, draw.Over)
				f, err := os.Create(filepath.Join(dir, string(p.ID)+".png"))
				if err != nil {
					t.Fatal(err)
				}
				png.Encode(f, bg)
				f.Close()
			}
		}
	}
}

func TestPanelsHideWithoutASession(t *testing.T) {
	stale := View{Snap: madrid(t), SnapAge: time.Minute}
	for _, p := range Panels {
		if img := Render(p.ID, stale, 1); img != nil {
			t.Errorf("%s: drawn for a session that ended a minute ago", p.ID)
		}
		stale.Unlocked = true
		if img := Render(p.ID, stale, 1); img == nil {
			t.Errorf("%s: an unlocked panel must stay visible to be placed", p.ID)
		}
		stale.Unlocked = false
	}
	old := View{Radio: &Radio{Text: "hola"}, RadioAge: RadioShown + time.Second}
	if Render(PanelRadio, old, 1) != nil {
		t.Error("an old radio call is still on screen")
	}
}
