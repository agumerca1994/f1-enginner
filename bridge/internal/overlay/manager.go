package overlay

import (
	"context"
	"image"
	"math"
	"sync"
	"time"
)

// PanelSettings is one floating panel's saved placement.
type PanelSettings struct {
	On      bool    `json:"on"`
	X       int     `json:"x"`
	Y       int     `json:"y"`
	Scale   float64 `json:"scale"`
	Rows    int     `json:"rows,omitempty"`
	Opacity float64 `json:"opacity,omitempty"`
}

// Settings is what the app saves between runs.
type Settings struct {
	Panels map[Panel]*PanelSettings `json:"panels"`
	Locked bool                     `json:"locked"`
}

// DefaultSettings stacks the panels down the left edge of the screen, all off.
func DefaultSettings() Settings {
	s := Settings{Panels: map[Panel]*PanelSettings{}, Locked: true}
	y := 80
	for _, p := range Panels {
		s.Panels[p.ID] = &PanelSettings{X: 40, Y: y, Scale: 1}
		y += int(emptySize[p.ID][1]) + 20
	}
	return s
}

// Hotkeys registered while the panels run (Ctrl+Alt+F10 / F11).
const (
	HotkeyLock = 1 // lock / unlock the panels
	HotkeyShow = 2 // show / hide them all
)

// host is the platform's window system; only Windows has one.
type host interface {
	// loop blocks until ctx ends, calling frame about 30 times a second and
	// hotkey when one of the registered hotkeys is pressed, all on one thread.
	loop(ctx context.Context, frame func(), hotkey func(id int))
	// present shows the panel's window with img; the first time at (x, y).
	present(p Panel, img *image.RGBA, x, y int, locked bool)
	hide(p Panel)
	// place moves a window that exists (after "reset positions").
	place(p Panel, x, y int)
}

// hostEvents are the user's actions on unlocked windows.
type hostEvents interface {
	moved(p Panel, x, y int)
	wheel(p Panel, up bool)
}

// Manager runs the floating panels: it decides which to show and redraws a
// panel only when what it shows changed.
type Manager struct {
	live   *Live
	pedals *Pedals
	save   func(Settings)
	host   host

	mu       sync.Mutex
	settings Settings
	hidden   bool // hidden with the hotkey, until it is pressed again
	drawn    map[Panel]drawKey
	moves    map[Panel][2]int // pending window moves, applied on the host's thread
}

type drawKey struct {
	snapAt          time.Time
	radioID         int
	radioShown      bool
	live            bool
	unlocked        bool
	scale           float64
	rows            int
	opacity         float64
	throttle, brake int
	pedals, visible bool
}

// NewManager prepares the panels; Supported reports whether this system can show them.
func NewManager(live *Live, pedals *Pedals, settings Settings, save func(Settings)) *Manager {
	if settings.Panels == nil {
		settings = DefaultSettings()
	}
	for _, p := range Panels { // panels added in a later version
		if settings.Panels[p.ID] == nil {
			settings.Panels[p.ID] = DefaultSettings().Panels[p.ID]
		}
	}
	m := &Manager{live: live, pedals: pedals, save: save, settings: settings,
		drawn: map[Panel]drawKey{}, moves: map[Panel][2]int{}}
	m.host = newHost(m)
	return m
}

func (m *Manager) Supported() bool { return m != nil && m.host != nil }

// Run shows the panels until ctx ends.
func (m *Manager) Run(ctx context.Context) {
	if m.host == nil {
		return
	}
	m.host.loop(ctx, m.frame, m.hotkey)
}

// Settings returns a copy of the current placement.
func (m *Manager) Settings() Settings {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.copySettings()
}

func (m *Manager) copySettings() Settings {
	out := Settings{Panels: map[Panel]*PanelSettings{}, Locked: m.settings.Locked}
	for k, v := range m.settings.Panels {
		c := *v
		out.Panels[k] = &c
	}
	return out
}

func (m *Manager) update(fn func(s *Settings)) {
	m.mu.Lock()
	fn(&m.settings)
	s := m.copySettings()
	m.mu.Unlock()
	if m.save != nil {
		m.save(s)
	}
}

func (m *Manager) SetPanel(p Panel, on bool) {
	m.update(func(s *Settings) { s.Panels[p].On = on })
}

func (m *Manager) SetLocked(locked bool) {
	m.update(func(s *Settings) { s.Locked = locked })
}

func (m *Manager) Locked() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.settings.Locked
}

// ResetPositions puts every panel back in the default stack, at normal size.
func (m *Manager) ResetPositions() {
	def := DefaultSettings()
	m.update(func(s *Settings) {
		for id, p := range s.Panels {
			p.X, p.Y, p.Scale = def.Panels[id].X, def.Panels[id].Y, 1
			m.moves[id] = [2]int{p.X, p.Y}
		}
	})
}

func (m *Manager) hotkey(id int) {
	switch id {
	case HotkeyLock:
		m.SetLocked(!m.Locked())
	case HotkeyShow:
		m.mu.Lock()
		m.hidden = !m.hidden
		m.mu.Unlock()
	}
}

func (m *Manager) moved(p Panel, x, y int) {
	m.update(func(s *Settings) { s.Panels[p].X, s.Panels[p].Y = x, y })
}

func (m *Manager) wheel(p Panel, up bool) {
	m.update(func(s *Settings) {
		step := -0.1
		if up {
			step = 0.1
		}
		s.Panels[p].Scale = math.Round(math.Max(0.6, math.Min(2.5, s.Panels[p].Scale+step))*10) / 10
	})
}

// frame runs on the host's thread: it draws whatever changed.
func (m *Manager) frame() {
	now := time.Now()
	snap, snapAt, radio, radioAt := m.live.State()
	throttle, brake, pedalsAt := m.pedals.Get()
	m.mu.Lock()
	s := m.copySettings()
	hidden := m.hidden
	moves := m.moves
	m.moves = map[Panel][2]int{}
	m.mu.Unlock()

	for p, xy := range moves {
		m.host.place(p, xy[0], xy[1])
	}
	for _, info := range Panels {
		ps := s.Panels[info.ID]
		if !ps.On || hidden {
			m.hidePanel(info.ID)
			continue
		}
		v := View{
			Snap: snap, SnapAge: now.Sub(snapAt), Radio: radio, RadioAge: now.Sub(radioAt),
			Throttle: throttle, Brake: brake, Pedals: !pedalsAt.IsZero() && now.Sub(pedalsAt) < pedalsLive,
			Rows: ps.Rows, Opacity: ps.Opacity, Unlocked: !s.Locked,
		}
		key := drawKey{snapAt: snapAt, live: v.Live(), unlocked: v.Unlocked, scale: ps.Scale, rows: ps.Rows,
			opacity: ps.Opacity, pedals: v.Pedals, visible: true}
		switch info.ID {
		case PanelRadio:
			key.snapAt = time.Time{} // the radio does not depend on the snapshot
			if radio != nil {
				key.radioID, key.radioShown = radio.ID, v.RadioAge <= RadioShown
			}
		case PanelPedals:
			key.throttle, key.brake = int(throttle*200), int(brake*200)
			if v.Pedals {
				key.snapAt = time.Time{} // local pedals: redraw only when they move
			}
		}
		if m.drawn[info.ID] == key {
			continue
		}
		m.drawn[info.ID] = key
		img := Render(info.ID, v, ps.Scale)
		if img == nil {
			m.hidePanel(info.ID)
			m.drawn[info.ID] = key // stay hidden until something changes
			continue
		}
		m.host.present(info.ID, img, ps.X, ps.Y, s.Locked)
	}
}

func (m *Manager) hidePanel(p Panel) {
	if k, ok := m.drawn[p]; ok && !k.visible {
		return
	}
	m.host.hide(p)
	m.drawn[p] = drawKey{}
}
