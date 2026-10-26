// Package acc reads Assetto Corsa Competizione telemetry on the player's PC.
//
// ACC has no UDP telemetry stream like the F1 games. The player's own car is in
// three shared-memory pages (physics, graphics, static; Windows only), and every
// car on track comes over ACC's broadcasting protocol, a UDP API on localhost
// that has to be switched on in broadcasting.json. The bridge does not decode
// either: it wraps each page copy or broadcasting message in a record starting
// with "ACC" and a kind byte, and the server parses it (backend/app/telemetry/acc.py).
package acc

import (
	"context"
	"sync"
	"time"
)

// Record kinds, the fourth byte of every record.
const (
	KindPhysics   = 'P'
	KindGraphics  = 'G'
	KindStatic    = 'S'
	KindBroadcast = 'B'
)

// Record wraps a payload as the server expects it.
func Record(kind byte, payload []byte) []byte {
	out := make([]byte, 0, 4+len(payload))
	out = append(out, 'A', 'C', 'C', kind)
	return append(out, payload...)
}

// Stats counts what a recording got, for the window and the sample summary.
type Stats struct {
	mu         sync.Mutex
	Pages      map[byte]int
	Messages   int
	Registered bool
	LastError  string
}

func (s *Stats) page(kind byte) {
	s.mu.Lock()
	if s.Pages == nil {
		s.Pages = map[byte]int{}
	}
	s.Pages[kind]++
	s.mu.Unlock()
}

func (s *Stats) message(registered bool) {
	s.mu.Lock()
	s.Messages++
	s.Registered = s.Registered || registered
	s.mu.Unlock()
}

func (s *Stats) fail(err error) {
	s.mu.Lock()
	s.LastError = err.Error()
	s.mu.Unlock()
}

// Snapshot copies the counters.
func (s *Stats) Snapshot() (pages map[byte]int, messages int, registered bool, lastErr string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	pages = map[byte]int{}
	for k, v := range s.Pages {
		pages[k] = v
	}
	return pages, s.Messages, s.Registered, s.LastError
}

// Run records ACC until ctx ends: the shared-memory pages (where the system has
// them) and the broadcasting messages. Every record goes to write.
func Run(ctx context.Context, settings BroadcastSettings, write func(at time.Time, data []byte), stats *Stats) {
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		readPages(ctx, func(kind byte, page []byte) {
			stats.page(kind)
			write(time.Now(), Record(kind, page))
		}, stats)
	}()
	go func() {
		defer wg.Done()
		for ctx.Err() == nil {
			err := Broadcast(ctx, settings, func(msg []byte) {
				stats.message(len(msg) > 5 && msg[0] == msgRegistrationResult && msg[5] == 1)
				write(time.Now(), Record(KindBroadcast, msg))
			})
			if err != nil && ctx.Err() == nil {
				stats.fail(err)
			}
			select {
			case <-ctx.Done():
			case <-time.After(3 * time.Second): // ACC not running yet, or restarted
			}
		}
	}()
	wg.Wait()
}
