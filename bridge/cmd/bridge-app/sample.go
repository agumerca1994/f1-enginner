package main

import (
	"bytes"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/agumerca1994/race-engineer/bridge/internal/agent"
	"github.com/agumerca1994/race-engineer/bridge/internal/capture"
	"github.com/agumerca1994/race-engineer/bridge/internal/doctor"
	"github.com/agumerca1994/race-engineer/bridge/internal/udp"
)

// sampler records everything the game sends, unfiltered and in any packet
// format, into a capture file: the raw material for supporting a new game
// version. While the app is sending it taps the agent's receiver (the port can
// only be bound once); otherwise it listens on its own.
type sampler struct {
	addr string // UDP address of the own listener; listenAddr when empty

	mu    sync.Mutex
	w     *capture.Writer
	path  string
	note  string
	stats *doctor.Stats
	err   error

	agent *agent.Agent  // tapped agent, when sending
	conn  *net.UDPConn  // own listener, when not sending
	done  chan struct{} // closed when the own listener's loop ends

	lastPath string // the last finished sample
}

// samplesDir is ~/Library/Application Support/race-engineer/muestras on macOS
// and %AppData%\race-engineer\muestras on Windows.
func samplesDir() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "race-engineer", "muestras"), nil
}

func (s *sampler) recording() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.w != nil
}

// start opens a new sample and begins recording through ag, or through its
// own listener when ag is nil.
func (s *sampler) start(ag *agent.Agent, note string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.w != nil {
		return nil
	}
	dir, err := samplesDir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(dir, "muestra-"+time.Now().Format("20060102-150405")+".f1cap.zst")
	host, _ := os.Hostname()
	w, err := capture.Create(path, capture.Meta{
		BridgeVersion: version, Host: host, ListenAddr: listenAddr, StartedAt: time.Now().UTC(),
		Note: strings.TrimSpace(note),
	})
	if err != nil {
		return err
	}
	s.w, s.path, s.note, s.stats, s.err = w, path, strings.TrimSpace(note), doctor.NewStats(), nil
	if ag != nil {
		s.agent = ag
		ag.SetTap(s.write)
		return nil
	}
	if err := s.listenLocked(); err != nil {
		w.Close()
		os.Remove(path)
		s.w = nil
		return fmt.Errorf("no se pudo escuchar en el puerto %s (¿otra app de telemetría lo está usando?): %w", listenAddr, err)
	}
	return nil
}

// listenLocked starts the own listener. Called with s.mu held.
func (s *sampler) listenLocked() error {
	addr := s.addr
	if addr == "" {
		addr = listenAddr
	}
	conn, err := udp.Listen(addr)
	if err != nil {
		return err
	}
	done := make(chan struct{})
	s.conn, s.done = conn, done
	go func() {
		defer close(done)
		udp.Receive(conn, func(d udp.Datagram) { s.write(d.At, d.Data) })
	}()
	return nil
}

// closeListener stops the own listener, if any, and waits for its loop.
func (s *sampler) closeListener() {
	s.mu.Lock()
	conn, done := s.conn, s.done
	s.conn, s.done = nil, nil
	s.mu.Unlock()
	if conn != nil {
		conn.Close()
		<-done
	}
}

func (s *sampler) write(at time.Time, data []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.w == nil || s.err != nil {
		return
	}
	s.err = s.w.Write(at, data)
	s.stats.Add(at, "", data)
}

// handOver moves an ongoing recording from the own listener to ag, which is
// about to start listening on the same port.
func (s *sampler) handOver(ag *agent.Agent) {
	if !s.recording() {
		return
	}
	s.closeListener()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.w != nil {
		s.agent = ag
		ag.SetTap(s.write)
	}
}

// release takes an ongoing recording back from ag, which stopped listening.
func (s *sampler) release(ag *agent.Agent) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.w == nil || s.agent != ag {
		return
	}
	ag.SetTap(nil)
	s.agent = nil
	if err := s.listenLocked(); err != nil && s.err == nil {
		s.err = fmt.Errorf("la grabación dejó de recibir datos: %w", err)
	}
}

// stop finishes the sample and writes a text summary next to it.
func (s *sampler) stop() (string, error) {
	s.closeListener()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.w == nil {
		return "", nil
	}
	if s.agent != nil {
		s.agent.SetTap(nil)
		s.agent = nil
	}
	err := errors.Join(s.err, s.w.Close())
	var buf bytes.Buffer
	if s.note != "" {
		fmt.Fprintf(&buf, "Nota: %s\n\n", s.note)
	}
	s.stats.Print(&buf)
	summary := strings.TrimSuffix(s.path, ".f1cap.zst") + ".txt"
	err = errors.Join(err, os.WriteFile(summary, buf.Bytes(), 0o644))
	s.lastPath, s.w = s.path, nil
	return s.path, err
}

// progress describes the recording in one line, for the window.
func (s *sampler) progress() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.w == nil {
		if s.lastPath != "" {
			return "Última muestra: " + filepath.Base(s.lastPath)
		}
		return "Sin grabar"
	}
	text := fmt.Sprintf("Grabando · %d paquetes", s.w.Count())
	if f := keysText(s.stats.Formats); f != "" {
		text += " · formato " + f
	}
	if v := keysText(s.stats.Versions); v != "" {
		text += " · juego " + v
	}
	if s.err != nil {
		text += " · error: " + s.err.Error()
	}
	return text
}

func keysText[K comparable](m map[K]int) string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, fmt.Sprint(k))
	}
	sort.Strings(keys)
	return strings.Join(keys, ", ")
}
