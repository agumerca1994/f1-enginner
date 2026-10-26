package overlay

import (
	"context"
	"image"
	"testing"
	"time"
)

// fakeHost records what the manager asked the window system to do.
type fakeHost struct {
	presented map[Panel]int
	hidden    map[Panel]int
	locked    map[Panel]bool
	placed    map[Panel][2]int
}

func newFake() *fakeHost {
	return &fakeHost{presented: map[Panel]int{}, hidden: map[Panel]int{}, locked: map[Panel]bool{}, placed: map[Panel][2]int{}}
}

func (f *fakeHost) loop(context.Context, func(), func(int)) {}
func (f *fakeHost) present(p Panel, _ *image.RGBA, _, _ int, locked bool) {
	f.presented[p]++
	f.locked[p] = locked
}
func (f *fakeHost) hide(p Panel)            { f.hidden[p]++ }
func (f *fakeHost) place(p Panel, x, y int) { f.placed[p] = [2]int{x, y} }

func managerWith(t *testing.T, live *Live) (*Manager, *fakeHost, *[]Settings) {
	var saved []Settings
	m := NewManager(live, &Pedals{}, Settings{}, func(s Settings) { saved = append(saved, s) })
	f := newFake()
	m.host = f
	return m, f, &saved
}

func liveWithMadrid(t *testing.T, at time.Time) *Live {
	snap := madrid(t)
	l := &Live{}
	l.snap, l.snapAt = snap, at
	return l
}

func TestManagerShowsOnlyEnabledPanelsAndRedrawsOnChange(t *testing.T) {
	live := liveWithMadrid(t, time.Now())
	m, f, saved := managerWith(t, live)
	m.SetPanel(PanelDelta, true)
	m.SetPanel(PanelRelatives, true)
	if len(*saved) != 2 || !(*saved)[1].Panels[PanelRelatives].On {
		t.Fatal("turning panels on was not saved")
	}

	m.frame()
	m.frame() // nothing changed: no second paint
	if f.presented[PanelDelta] != 1 || f.presented[PanelRelatives] != 1 || f.presented[PanelTimes] != 0 {
		t.Fatalf("presented %v", f.presented)
	}
	if !f.locked[PanelDelta] {
		t.Fatal("panels start locked, letting clicks through to the game")
	}

	live.mu.Lock()
	live.snapAt = time.Now().Add(time.Millisecond) // a new snapshot arrived
	live.mu.Unlock()
	m.frame()
	if f.presented[PanelDelta] != 2 {
		t.Fatal("a new snapshot did not redraw the panel")
	}
}

func TestManagerHidesWhenTheSessionEndsAndWithTheHotkey(t *testing.T) {
	live := liveWithMadrid(t, time.Now().Add(-time.Minute))
	m, f, _ := managerWith(t, live)
	m.SetPanel(PanelDelta, true)
	m.frame()
	if f.presented[PanelDelta] != 0 {
		t.Fatal("a panel was shown for a session that ended a minute ago")
	}

	m.hotkey(HotkeyLock) // unlock: placing panels shows them even without data
	m.frame()
	if f.presented[PanelDelta] != 1 || f.locked[PanelDelta] {
		t.Fatal("an unlocked panel must show, clickable, so it can be dragged")
	}

	m.hotkey(HotkeyShow)
	m.frame()
	if f.hidden[PanelDelta] == 0 {
		t.Fatal("the show/hide hotkey did not hide the panels")
	}
}

func TestManagerSavesMovesScaleAndReset(t *testing.T) {
	m, f, saved := managerWith(t, &Live{})
	m.moved(PanelRadio, 300, 400)
	m.wheel(PanelRadio, true)
	m.wheel(PanelRadio, true)
	last := (*saved)[len(*saved)-1].Panels[PanelRadio]
	if last.X != 300 || last.Y != 400 || last.Scale != 1.2 {
		t.Fatalf("saved %+v", *last)
	}
	for i := 0; i < 30; i++ {
		m.wheel(PanelRadio, false)
	}
	if got := m.Settings().Panels[PanelRadio].Scale; got != 0.6 {
		t.Fatalf("scale went below the minimum: %v", got)
	}

	m.ResetPositions()
	m.frame()
	def := DefaultSettings().Panels[PanelRadio]
	if f.placed[PanelRadio] != [2]int{def.X, def.Y} || m.Settings().Panels[PanelRadio].Scale != 1 {
		t.Fatalf("reset placed %v", f.placed[PanelRadio])
	}
}
