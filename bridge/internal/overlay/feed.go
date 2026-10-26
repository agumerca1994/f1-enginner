// Package overlay draws the floating panels shown over the game on Windows:
// delta, relatives, times, standings, pedals and the engineer's radio.
//
// The numbers come from the server's live snapshot (the same one the dashboard
// shows), read over the live WebSocket with the bridge's own token. Pedals come
// from the game's packets on this computer, so they move at the game's rate.
package overlay

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Snapshot holds the parts of the server's live snapshot the panels draw.
// Pointers are fields the server may send as null ("unknown", never zero).
type Snapshot struct {
	Session *struct {
		Type   string `json:"type"`
		Paused bool   `json:"paused"`
	} `json:"session"`
	Lap *struct {
		Lap               int  `json:"lap"`
		Position          int  `json:"position"`
		CurrentLapMs      int  `json:"current_lap_ms"`
		LastLapMs         *int `json:"last_lap_ms"`
		Sector            int  `json:"sector"`
		Sector1Ms         *int `json:"sector1_ms"`
		Sector2Ms         *int `json:"sector2_ms"`
		DeltaBestMs       *int `json:"delta_best_ms"`
		DeltaReferenceLap *int `json:"delta_reference_lap"`
		LapInvalid        bool `json:"lap_invalid"`
	} `json:"lap"`
	Car *struct {
		Throttle float64 `json:"throttle"`
		Brake    float64 `json:"brake"`
	} `json:"car"`
	Relatives *struct {
		Ahead  []Relative `json:"ahead"`
		Behind []Relative `json:"behind"`
	} `json:"relatives"`
	Pace *struct {
		Ahead  *PaceSide `json:"ahead"`
		Behind *PaceSide `json:"behind"`
	} `json:"pace"`
	SectorReview []SectorReview `json:"sector_review"`
	Cars         []Car          `json:"cars"`
}

type Relative struct {
	Index     int      `json:"index"`
	GapS      *float64 `json:"gap_s"`
	Estimated bool     `json:"estimated"`
	Relation  *string  `json:"relation"` // "lapped", "lapping" or null
	Pit       bool     `json:"pit"`
}

type PaceSide struct {
	State          string   `json:"state"` // waiting, stable, opening, catching, after_finish
	ClosingSPerLap *float64 `json:"closing_s_per_lap"`
	LapsToCatch    *float64 `json:"laps_to_catch"`
}

type SectorReview struct {
	Lap          int    `json:"lap"`
	TimeMs       int    `json:"time_ms"`
	Valid        bool   `json:"valid"`
	SectorDeltas []*int `json:"sector_deltas_ms"`
}

type Car struct {
	Index      int     `json:"index"`
	IsPlayer   bool    `json:"is_player"`
	Position   int     `json:"position"`
	Lap        int     `json:"lap"`
	Name       *string `json:"name"`
	RaceNumber *int    `json:"race_number"`
	TeamID     *int    `json:"team_id"`
	Color      *string `json:"color"`
	Pit        string  `json:"pit"`
	GapAheadMs int     `json:"gap_ahead_ms"`
	BestLapMs  *int    `json:"best_lap_ms"`
}

// Radio is the engineer's last radio call.
type Radio struct {
	ID       int    `json:"id"`
	Lap      *int   `json:"lap"`
	Text     string `json:"radio"`
	Priority string `json:"prioridad"`
}

func (s *Snapshot) player() *Car {
	for i := range s.Cars {
		if s.Cars[i].IsPlayer {
			return &s.Cars[i]
		}
	}
	return nil
}

func (s *Snapshot) car(index int) *Car {
	for i := range s.Cars {
		if s.Cars[i].Index == index {
			return &s.Cars[i]
		}
	}
	return nil
}

// Live keeps the latest snapshot and radio call from the server.
type Live struct {
	mu        sync.Mutex
	snap      *Snapshot
	snapAt    time.Time
	radio     *Radio
	radioAt   time.Time
	connected bool
}

// State returns the latest snapshot (nil before the first), when it arrived, and
// the last radio call with its arrival time.
func (l *Live) State() (snap *Snapshot, at time.Time, radio *Radio, radioAt time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.snap, l.snapAt, l.radio, l.radioAt
}

func (l *Live) Connected() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.connected
}

// handle applies one message from the live WebSocket.
func (l *Live) handle(raw []byte, now time.Time) {
	var msg struct {
		Type     string          `json:"type"`
		Data     json.RawMessage `json:"data"`
		Message  json.RawMessage `json:"message"`
		Messages []Radio         `json:"messages"`
	}
	if json.Unmarshal(raw, &msg) != nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	switch msg.Type {
	case "snapshot":
		var s Snapshot
		if json.Unmarshal(msg.Data, &s) == nil {
			l.snap, l.snapAt = &s, now
		}
	case "engineer_message":
		var r Radio
		if json.Unmarshal(msg.Message, &r) == nil && r.Text != "" {
			l.radio, l.radioAt = &r, now
		}
	case "engineer_state":
		// Earlier calls arrive on connect: remember the last one without showing it.
		for i := len(msg.Messages) - 1; i >= 0; i-- {
			if msg.Messages[i].Text != "" && l.radio == nil {
				r := msg.Messages[i]
				l.radio = &r
				break
			}
		}
	}
}

// Run keeps a connection to the server's live WebSocket until ctx ends,
// reconnecting with backoff. server is the API base URL, token the bridge's.
func (l *Live) Run(ctx context.Context, server, token string, logf func(string, ...any)) {
	url := liveURL(server)
	backoff := time.Second
	for ctx.Err() == nil {
		err := l.session(ctx, url, token)
		l.mu.Lock()
		l.connected = false
		l.mu.Unlock()
		if ctx.Err() != nil {
			return
		}
		if err != nil && logf != nil {
			logf("overlay: live connection: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, 30*time.Second)
	}
}

func (l *Live) session(ctx context.Context, url, token string) error {
	dialCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	conn, _, err := websocket.Dial(dialCtx, url, nil)
	cancel()
	if err != nil {
		return err
	}
	defer conn.CloseNow()
	conn.SetReadLimit(4 << 20)
	auth, _ := json.Marshal(map[string]string{"type": "auth", "device_token": token})
	if err := conn.Write(ctx, websocket.MessageText, auth); err != nil {
		return err
	}
	l.mu.Lock()
	l.connected = true
	l.mu.Unlock()
	for {
		_, raw, err := conn.Read(ctx)
		if err != nil {
			return err
		}
		l.handle(raw, time.Now())
	}
}

func liveURL(server string) string {
	u := strings.TrimRight(server, "/")
	switch {
	case strings.HasPrefix(u, "https://"):
		u = "wss://" + strings.TrimPrefix(u, "https://")
	case strings.HasPrefix(u, "http://"):
		u = "ws://" + strings.TrimPrefix(u, "http://")
	}
	return u + "/live/v1"
}
