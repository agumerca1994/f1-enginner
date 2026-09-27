// Package doctor gathers statistics about a telemetry stream and checks the
// local setup, so a player can tell why the game's data is not arriving.
package doctor

import (
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	"github.com/agumerca1994/race-engineer/bridge/internal/header"
)

// Stats accumulates what was seen in a stream of datagrams.
type Stats struct {
	Total      int
	Invalid    int // shorter than the header
	First      time.Time
	Last       time.Time
	PerPacket  map[uint8]int
	WrongSize  map[uint8]int // datagrams whose size differs from the 2024 spec
	Formats    map[uint16]int
	Versions   map[string]int // "24 v1.17"
	Sessions   map[uint64]int
	Sources    map[string]int
	PlayerCars map[uint8]int

	// Diagnostics from CarTelemetry packets, to tell whether the game is
	// running and how often it sends compared with its own frame counter.
	telemetryFrames []uint32
	sessionTimeMin  float32
	sessionTimeMax  float32
	maxSpeedKmh     uint16
}

// NewStats returns an empty Stats.
func NewStats() *Stats {
	return &Stats{
		PerPacket:  map[uint8]int{},
		WrongSize:  map[uint8]int{},
		Formats:    map[uint16]int{},
		Versions:   map[string]int{},
		Sessions:   map[uint64]int{},
		Sources:    map[string]int{},
		PlayerCars: map[uint8]int{},
	}
}

// Add records one datagram. source may be empty (for example when reading a capture).
func (s *Stats) Add(at time.Time, source string, data []byte) {
	if s.Total == 0 {
		s.First = at
	}
	s.Last = at
	s.Total++
	if source != "" {
		s.Sources[source]++
	}
	h, err := header.Parse(data)
	if err != nil {
		s.Invalid++
		return
	}
	s.PerPacket[h.PacketID]++
	s.Formats[h.PacketFormat]++
	s.Versions[fmt.Sprintf("%d v%d.%02d", h.GameYear, h.GameMajorVersion, h.GameMinorVersion)]++
	s.Sessions[h.SessionUID]++
	s.PlayerCars[h.PlayerCarIndex]++
	if h.PacketFormat == 2024 {
		if want, ok := header.Sizes2024[h.PacketID]; !ok || want != len(data) {
			s.WrongSize[h.PacketID]++
		}
	}
	if h.PacketID == 6 {
		s.addTelemetry(h, data)
	}
}

// carTelemetrySize is the size of one CarTelemetryData entry in format 2024;
// its first field is the speed in km/h (uint16).
const carTelemetrySize = 60

func (s *Stats) addTelemetry(h header.Header, data []byte) {
	if len(s.telemetryFrames) == 0 || h.SessionTime < s.sessionTimeMin {
		s.sessionTimeMin = h.SessionTime
	}
	if h.SessionTime > s.sessionTimeMax {
		s.sessionTimeMax = h.SessionTime
	}
	s.telemetryFrames = append(s.telemetryFrames, h.FrameIdentifier)
	off := header.Size + int(h.PlayerCarIndex)*carTelemetrySize
	if h.PlayerCarIndex < 22 && off+2 <= len(data) {
		if v := uint16(data[off]) | uint16(data[off+1])<<8; v > s.maxSpeedKmh {
			s.maxSpeedKmh = v
		}
	}
}

// Duration is the time between the first and last datagram.
func (s *Stats) Duration() time.Duration { return s.Last.Sub(s.First) }

// Print writes a human-readable report.
func (s *Stats) Print(w io.Writer) {
	fmt.Fprintf(w, "Datagrams: %d", s.Total)
	if d := s.Duration(); d > 0 {
		fmt.Fprintf(w, " in %s (%.0f/s)", d.Round(time.Millisecond), float64(s.Total)/d.Seconds())
	}
	fmt.Fprintln(w)
	if s.Invalid > 0 {
		fmt.Fprintf(w, "Too short to be telemetry: %d\n", s.Invalid)
	}
	printMap(w, "Packet formats", s.Formats, func(k uint16) string { return fmt.Sprint(k) })
	printMap(w, "Game versions", s.Versions, func(k string) string { return k })
	printMap(w, "Sources", s.Sources, func(k string) string { return k })
	printMap(w, "Sessions", s.Sessions, func(k uint64) string { return fmt.Sprintf("%016x", k) })

	fmt.Fprintln(w, "Packets:")
	ids := make([]int, 0, len(s.PerPacket))
	for id := range s.PerPacket {
		ids = append(ids, int(id))
	}
	sort.Ints(ids)
	secs := s.Duration().Seconds()
	for _, i := range ids {
		id := uint8(i)
		line := fmt.Sprintf("  %2d %-20s %7d", id, header.Name(id), s.PerPacket[id])
		if secs > 0 {
			line += fmt.Sprintf("  %6.1f/s", float64(s.PerPacket[id])/secs)
		}
		if n := s.WrongSize[id]; n > 0 {
			line += fmt.Sprintf("  (%d with unexpected size)", n)
		}
		fmt.Fprintln(w, line)
	}
	s.printDiagnosis(w)
}

func (s *Stats) printDiagnosis(w io.Writer) {
	n := len(s.telemetryFrames)
	if n < 2 {
		return
	}
	wall := s.Duration().Seconds()
	game := float64(s.sessionTimeMax - s.sessionTimeMin)
	deltas := make([]int, 0, n-1)
	for i := 1; i < n; i++ {
		deltas = append(deltas, int(int64(s.telemetryFrames[i])-int64(s.telemetryFrames[i-1])))
	}
	sort.Ints(deltas)
	fmt.Fprintln(w, "Diagnosis (from CarTelemetry):")
	fmt.Fprintf(w, "  game session time advanced %.1fs during %.1fs of real time\n", game, wall)
	fmt.Fprintf(w, "  frames between packets: median %d, min %d, max %d\n", deltas[len(deltas)/2], deltas[0], deltas[len(deltas)-1])
	fmt.Fprintf(w, "  player's top speed: %d km/h\n", s.maxSpeedKmh)
	if game > 0 {
		fmt.Fprintf(w, "  CarTelemetry per second of game time: %.1f\n", float64(n)/game)
	}
	if r, ok := s.Reception(); ok {
		fmt.Fprintf(w, "  estimated telemetry received: %.0f%% (%s)\n", r*100, quality(r))
	}
}

// Reception estimates the share of CarTelemetry packets the game sent that
// arrived during the whole capture. ok is false when there is too little data.
func (s *Stats) Reception() (ratio float64, ok bool) {
	return EstimateReception(s.telemetryFrames)
}

// EstimateReception estimates which share of a packet stream arrived, from the
// frame identifiers of the packets that did. The smallest frame step between
// two received packets is taken as the game's send interval; a backwards step
// (flashback, restart) starts a new segment.
func EstimateReception(frames []uint32) (ratio float64, ok bool) {
	if len(frames) < 3 {
		return 0, false
	}
	step := int64(0)
	for i := 1; i < len(frames); i++ {
		if d := int64(frames[i]) - int64(frames[i-1]); d > 0 && (step == 0 || d < step) {
			step = d
		}
	}
	if step == 0 {
		return 0, false
	}
	expected := int64(1)
	for i := 1; i < len(frames); i++ {
		if d := int64(frames[i]) - int64(frames[i-1]); d > 0 {
			expected += (d + step/2) / step
		} else {
			expected++
		}
	}
	ratio = float64(len(frames)) / float64(expected)
	if ratio > 1 {
		ratio = 1
	}
	return ratio, true
}

// ReceptionWindow keeps the frame identifiers of the latest CarTelemetry
// packets, to estimate the current reception while the bridge runs for hours.
type ReceptionWindow struct {
	frames []uint32
	size   int
}

// NewReceptionWindow tracks the last size packets.
func NewReceptionWindow(size int) *ReceptionWindow {
	return &ReceptionWindow{size: size}
}

// Add records a received CarTelemetry frame identifier.
func (w *ReceptionWindow) Add(frame uint32) {
	w.frames = append(w.frames, frame)
	if len(w.frames) > w.size {
		w.frames = append(w.frames[:0], w.frames[len(w.frames)-w.size:]...)
	}
}

// Estimate returns the reception over the window.
func (w *ReceptionWindow) Estimate() (float64, bool) { return EstimateReception(w.frames) }

func quality(r float64) string {
	switch {
	case r >= 0.95:
		return "excellent"
	case r >= 0.75:
		return "good"
	case r >= 0.4:
		return "degraded: live traces will be coarse"
	default:
		return "poor: race state still works, fine traces will not; a wired console connection helps"
	}
}

func printMap[K comparable](w io.Writer, title string, m map[K]int, label func(K) string) {
	if len(m) == 0 {
		return
	}
	parts := make([]string, 0, len(m))
	for k, n := range m {
		parts = append(parts, fmt.Sprintf("%s (%d)", label(k), n))
	}
	sort.Strings(parts)
	fmt.Fprintf(w, "%s: %s\n", title, strings.Join(parts, ", "))
}
