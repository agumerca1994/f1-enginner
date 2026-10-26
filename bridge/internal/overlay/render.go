package overlay

import (
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"math"
	"strings"
	"sync"
	"time"

	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/gofont/gomedium"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
	"golang.org/x/image/vector"
)

// Panel names match the web overlays (/overlay/<panel>).
type Panel string

const (
	PanelDelta     Panel = "delta"
	PanelRelatives Panel = "relativos"
	PanelTimes     Panel = "tiempos"
	PanelStandings Panel = "posiciones"
	PanelPedals    Panel = "pedales"
	PanelRadio     Panel = "radio"
)

// Panels in the order the app lists them, with their names in the UI.
var Panels = []struct {
	ID    Panel
	Label string
}{
	{PanelDelta, "Delta"},
	{PanelRelatives, "Relativos"},
	{PanelTimes, "Tiempos y sectores"},
	{PanelStandings, "Posiciones"},
	{PanelPedals, "Pedales"},
	{PanelRadio, "Radio del ingeniero"},
}

const (
	RadioShown = 20 * time.Second // a radio call stays on screen this long
	staleAfter = 10 * time.Second // older snapshots mean no session: hide the panels
	pedalsLive = time.Second
)

// View is everything a panel can draw at one instant.
type View struct {
	Snap     *Snapshot
	SnapAge  time.Duration
	Radio    *Radio
	RadioAge time.Duration
	Throttle float64
	Brake    float64
	Pedals   bool // the local pedals are fresh
	Rows     int  // cars per side (relatives) or in total (standings); 0 = default
	Opacity  float64
	// Unlocked panels are being placed: they always show, with a frame and their name.
	Unlocked bool
}

// Live reports whether there is a session to show: a recent snapshot with a player lap.
func (v View) Live() bool {
	return v.Snap != nil && v.Snap.Lap != nil && v.SnapAge < staleAfter
}

var (
	colFg     = rgb(0xe9eef3)
	colMuted  = rgb(0x7d8996)
	colLine   = rgb(0x1d2530)
	colPanel2 = rgb(0x131922)
	colAccent = rgb(0x22d3ee)
	colOk     = rgb(0x34d399)
	colWarn   = rgb(0xfbbf24)
	colDanger = rgb(0xf43f5e)
	colBlue   = rgb(0x60a5fa)
	colPurple = rgb(0xc084fc)
)

var teamColors = map[int]color.RGBA{
	0: rgb(0x27f4d2), 1: rgb(0xe8002d), 2: rgb(0x3671c6), 3: rgb(0x64c4ff), 4: rgb(0x229971),
	5: rgb(0xff87bc), 6: rgb(0x6692ff), 7: rgb(0xb6babd), 8: rgb(0xff8000), 9: rgb(0x52e252),
	// 2026 season: the same teams from 220 (2024/2025 formats) or 476 (2026 format).
	220: rgb(0x27f4d2), 221: rgb(0xe8002d), 222: rgb(0x3671c6), 223: rgb(0x64c4ff), 224: rgb(0x229971),
	225: rgb(0xff87bc), 226: rgb(0x6692ff), 227: rgb(0xb6babd), 228: rgb(0xff8000), 229: rgb(0xf50537),
	230: rgb(0xc9a54a),
}

func init() {
	for i := 0; i <= 10; i++ {
		teamColors[476+i] = teamColors[220+i]
	}
}

func rgb(v uint32) color.RGBA {
	return color.RGBA{uint8(v >> 16), uint8(v >> 8), uint8(v), 0xff}
}

func carColor(c *Car) color.RGBA {
	if c != nil && c.Color != nil && len(*c.Color) == 7 {
		var v uint32
		if _, err := fmt.Sscanf((*c.Color)[1:], "%06x", &v); err == nil {
			return rgb(v)
		}
	}
	if c != nil && c.TeamID != nil {
		if col, ok := teamColors[*c.TeamID]; ok {
			return col
		}
	}
	return colMuted
}

// --- fonts ---------------------------------------------------------------------

type weight int

const (
	regular weight = iota
	medium
	bold
)

var (
	fontsOnce sync.Once
	fonts     [3]*opentype.Font
	facesMu   sync.Mutex
	faces     = map[[2]int]font.Face{}
)

func face(w weight, px float64) font.Face {
	fontsOnce.Do(func() {
		for i, data := range [][]byte{goregular.TTF, gomedium.TTF, gobold.TTF} {
			f, err := opentype.Parse(data)
			if err != nil {
				panic(err) // embedded fonts: cannot fail
			}
			fonts[i] = f
		}
	})
	key := [2]int{int(w), int(math.Round(px * 4))}
	facesMu.Lock()
	defer facesMu.Unlock()
	if f, ok := faces[key]; ok {
		return f
	}
	f, err := opentype.NewFace(fonts[w], &opentype.FaceOptions{Size: px, DPI: 72, Hinting: font.HintingFull})
	if err != nil {
		panic(err)
	}
	faces[key] = f
	return f
}

// --- canvas --------------------------------------------------------------------

// canvas draws in panel units (scale 1 = the base size) onto a scaled image.
type canvas struct {
	img   *image.RGBA
	scale float64
}

func newCanvas(w, h, scale float64) *canvas {
	return &canvas{img: image.NewRGBA(image.Rect(0, 0, int(math.Ceil(w*scale)), int(math.Ceil(h*scale)))), scale: scale}
}

// path outlines a rounded rectangle given in panel units.
func (c *canvas) path(x, y, w, h, r float64) *vector.Rasterizer {
	s := c.scale
	b := c.img.Bounds()
	z := vector.NewRasterizer(b.Dx(), b.Dy())
	fx, fy, fw, fh := float32(x*s), float32(y*s), float32(w*s), float32(h*s)
	fr := float32(math.Min(r, math.Min(w, h)/2) * s)
	k := fr * 0.4477 // control-point inset: a quarter circle as one cubic
	z.MoveTo(fx+fr, fy)
	z.LineTo(fx+fw-fr, fy)
	z.CubeTo(fx+fw-k, fy, fx+fw, fy+k, fx+fw, fy+fr)
	z.LineTo(fx+fw, fy+fh-fr)
	z.CubeTo(fx+fw, fy+fh-k, fx+fw-k, fy+fh, fx+fw-fr, fy+fh)
	z.LineTo(fx+fr, fy+fh)
	z.CubeTo(fx+k, fy+fh, fx, fy+fh-k, fx, fy+fh-fr)
	z.LineTo(fx, fy+fr)
	z.CubeTo(fx, fy+k, fx+k, fy, fx+fr, fy)
	z.ClosePath()
	return z
}

func (c *canvas) roundRect(x, y, w, h, r float64, col color.Color) {
	c.path(x, y, w, h, r).Draw(c.img, c.img.Bounds(), image.NewUniform(col), image.Point{})
}

func (c *canvas) rect(x, y, w, h float64, col color.Color) { c.roundRect(x, y, w, h, 0, col) }

// frame strokes a rounded outline of thickness t: the outer shape minus the inner one.
func (c *canvas) frame(x, y, w, h, r, t float64, col color.Color) {
	b := c.img.Bounds()
	outer, inner := image.NewAlpha(b), image.NewAlpha(b)
	c.path(x, y, w, h, r).Draw(outer, b, image.Opaque, image.Point{})
	c.path(x+t, y+t, w-2*t, h-2*t, math.Max(0, r-t)).Draw(inner, b, image.Opaque, image.Point{})
	for i := range outer.Pix {
		outer.Pix[i] = uint8(max(0, int(outer.Pix[i])-int(inner.Pix[i])))
	}
	draw.DrawMask(c.img, b, image.NewUniform(col), image.Point{}, outer, image.Point{}, draw.Over)
}

type align int

const (
	left align = iota
	right
	center
)

// text draws s with its baseline at y; x is the left edge, right edge or centre.
func (c *canvas) text(s string, x, y float64, w weight, px float64, col color.Color, a align) float64 {
	f := face(w, px*c.scale)
	width := font.MeasureString(f, s)
	dx := x * c.scale
	switch a {
	case right:
		dx -= float64(width) / 64
	case center:
		dx -= float64(width) / 128
	}
	d := font.Drawer{Dst: c.img, Src: image.NewUniform(col), Face: f,
		Dot: fixed.Point26_6{X: fixed.Int26_6(dx * 64), Y: fixed.Int26_6(y * c.scale * 64)}}
	d.DrawString(s)
	return float64(width) / 64 / c.scale
}

// fit shortens s with "…" until it fits in maxW panel units.
func (c *canvas) fit(s string, maxW float64, w weight, px float64) string {
	f := face(w, px*c.scale)
	limit := fixed.Int26_6(maxW * c.scale * 64)
	if font.MeasureString(f, s) <= limit {
		return s
	}
	r := []rune(s)
	for len(r) > 1 {
		r = r[:len(r)-1]
		if font.MeasureString(f, string(r)+"…") <= limit {
			break
		}
	}
	return string(r) + "…"
}

// wrap splits s into lines no wider than maxW panel units.
func (c *canvas) wrap(s string, maxW float64, w weight, px float64) []string {
	f := face(w, px*c.scale)
	limit := fixed.Int26_6(maxW * c.scale * 64)
	var lines []string
	line := ""
	for _, word := range strings.Fields(s) {
		try := strings.TrimSpace(line + " " + word)
		if line != "" && font.MeasureString(f, try) > limit {
			lines = append(lines, line)
			line = word
		} else {
			line = try
		}
	}
	if line != "" {
		lines = append(lines, line)
	}
	return lines
}

// --- formatting ----------------------------------------------------------------

func lapTime(ms int) string {
	if ms <= 0 {
		return "--:--.---"
	}
	return fmt.Sprintf("%d:%02d.%03d", ms/60000, ms/1000%60, ms%1000)
}

func optLapTime(ms *int) string {
	if ms == nil {
		return "--:--.---"
	}
	return lapTime(*ms)
}

// signed formats a delta in seconds with a real minus sign.
func signed(ms int) string {
	sign := "±"
	if ms > 0 {
		sign = "+"
	} else if ms < 0 {
		sign = "−"
	}
	return fmt.Sprintf("%s%.3f", sign, math.Abs(float64(ms))/1000)
}

func deltaColor(ms int) color.Color {
	switch {
	case ms < 0:
		return colOk
	case ms > 0:
		return colDanger
	}
	return colFg
}

func shortName(c *Car) string {
	if c == nil {
		return "—"
	}
	if c.Name == nil || strings.TrimSpace(*c.Name) == "" {
		if c.RaceNumber != nil {
			return fmt.Sprintf("#%d", *c.RaceNumber)
		}
		return fmt.Sprintf("Auto %d", c.Index+1)
	}
	n := []rune(strings.TrimSpace(*c.Name))
	return string(n[0]) + strings.ToLower(string(n[1:]))
}

// --- panels --------------------------------------------------------------------

const pad = 12.0

// Render draws one panel. It returns nil when there is nothing to show, so the
// window can stay hidden instead of covering the game with an empty box.
func Render(p Panel, v View, scale float64) *image.RGBA {
	if scale <= 0 {
		scale = 1
	}
	var c *canvas
	switch p {
	case PanelDelta:
		c = renderDelta(v, scale)
	case PanelRelatives:
		c = renderRelatives(v, scale)
	case PanelTimes:
		c = renderTimes(v, scale)
	case PanelStandings:
		c = renderStandings(v, scale)
	case PanelPedals:
		c = renderPedals(v, scale)
	case PanelRadio:
		c = renderRadio(v, scale)
	}
	if c == nil && v.Unlocked {
		c = placeholder(p, scale)
	}
	if c == nil {
		return nil
	}
	if v.Unlocked {
		b := c.img.Bounds()
		c.frame(0, 0, float64(b.Dx())/scale, float64(b.Dy())/scale, 12, 1.5, colAccent)
		c.text(label(p)+" · arrastrá para mover, rueda para el tamaño", pad, float64(b.Dy())/scale-4, regular, 9, colAccent, left)
	}
	return c.img
}

func label(p Panel) string {
	for _, x := range Panels {
		if x.ID == p {
			return x.Label
		}
	}
	return string(p)
}

// base starts a panel with its translucent dark background.
func base(w, h float64, v View, scale float64) *canvas {
	c := newCanvas(w, h, scale)
	op := v.Opacity
	if op <= 0 || op > 1 {
		op = 0.8
	}
	c.roundRect(0, 0, w, h, 12, color.NRGBA{7, 9, 12, uint8(op * 255)})
	return c
}

// emptySize is each panel's size while it has nothing to show (only seen unlocked).
var emptySize = map[Panel][2]float64{
	PanelDelta: {300, 84}, PanelRelatives: {320, 200}, PanelTimes: {340, 150},
	PanelStandings: {260, 240}, PanelPedals: {84, 150}, PanelRadio: {480, 96},
}

func placeholder(p Panel, scale float64) *canvas {
	size := emptySize[p]
	c := base(size[0], size[1], View{Opacity: 0.6}, scale)
	c.text("Sin datos todavía", pad, 26, medium, 13, colMuted, left)
	return c
}

func renderDelta(v View, scale float64) *canvas {
	if !v.Live() {
		return nil
	}
	lap := v.Snap.Lap
	c := base(300, 84, v, scale)
	c.text(fmt.Sprintf("VUELTA %d", lap.Lap), pad, 22, medium, 10, colMuted, left)
	c.text(lapTime(lap.CurrentLapMs), pad, 58, bold, 28, colFg, left)
	if lap.DeltaBestMs == nil {
		c.text("Δ MEJOR", 300-pad, 22, medium, 10, colMuted, right)
		c.text("SIN REF.", 300-pad, 56, bold, 15, colMuted, right)
		return c
	}
	head := "Δ MEJOR"
	if lap.DeltaReferenceLap != nil {
		head += fmt.Sprintf(" · V%d", *lap.DeltaReferenceLap)
	}
	c.text(head, 300-pad, 22, medium, 10, colMuted, right)
	c.text(signed(*lap.DeltaBestMs), 300-pad, 58, bold, 28, deltaColor(*lap.DeltaBestMs), right)
	return c
}

func renderRelatives(v View, scale float64) *canvas {
	if !v.Live() || v.Snap.Relatives == nil || v.Snap.player() == nil {
		return nil
	}
	rows := v.Rows
	if rows <= 0 {
		rows = 3
	}
	s := v.Snap
	ahead, behind := s.Relatives.Ahead, s.Relatives.Behind
	if len(ahead) > rows {
		ahead = ahead[:rows]
	}
	if len(behind) > rows {
		behind = behind[:rows]
	}
	const rowH = 24.0
	n := len(ahead) + 1 + len(behind)
	paceLines := 0
	if s.Pace != nil {
		for _, p := range []*PaceSide{s.Pace.Ahead, s.Pace.Behind} {
			if p != nil {
				paceLines++
			}
		}
	}
	h := pad*2 + float64(n)*rowH
	if paceLines > 0 {
		h += 10 + float64(paceLines)*18
	}
	w := 320.0
	c := base(w, h, v, scale)
	y := pad
	row := func(car *Car, r *Relative, me bool) {
		if me {
			c.roundRect(pad-4, y, w-2*pad+8, rowH, 6, color.NRGBA{34, 211, 238, 40})
		}
		pos := "—"
		if car != nil {
			pos = fmt.Sprint(car.Position)
		}
		c.text(pos, pad+18, y+17, regular, 13, colMuted, right)
		c.roundRect(pad+26, y+5, 4, 14, 2, carColor(car))
		nameCol := colFg
		tag := ""
		if r != nil && r.Relation != nil {
			if *r.Relation == "lapped" {
				nameCol, tag = colBlue, " doblado"
			} else {
				nameCol, tag = colWarn, " te dobla"
			}
		}
		wt := regular
		if me {
			wt = bold
		}
		name := c.fit(shortName(car), 170, wt, 14)
		nw := c.text(name, pad+38, y+17, wt, 14, nameCol, left)
		if r != nil && r.Pit {
			c.roundRect(pad+42+nw, y+6, 28, 13, 3, colWarn)
			c.text("BOX", pad+56+nw, y+16, bold, 9, color.Black, center)
		} else if tag != "" {
			c.text(tag, pad+40+nw, y+17, regular, 10, nameCol, left)
		}
		if r != nil && r.GapS != nil {
			sign := "+"
			if r.GapS != nil && containsRel(s.Relatives.Ahead, r.Index) {
				sign = "−"
			}
			prefix := ""
			if r.Estimated {
				prefix = "~"
			}
			c.text(fmt.Sprintf("%s%s%.1f", prefix, sign, *r.GapS), w-pad, y+17, medium, 13, colFg, right)
		}
		y += rowH
	}
	for i := len(ahead) - 1; i >= 0; i-- {
		row(s.car(ahead[i].Index), &ahead[i], false)
	}
	row(s.player(), nil, true)
	for i := range behind {
		row(s.car(behind[i].Index), &behind[i], false)
	}
	if paceLines > 0 {
		y += 6
		c.rect(pad, y, w-2*pad, 1, colLine)
		y += 16
		for _, side := range []struct {
			label   string
			p       *PaceSide
			chasing bool
		}{{"Adelante", s.Pace.Ahead, true}, {"Atrás", s.Pace.Behind, false}} {
			if side.p == nil {
				continue
			}
			text, col := paceText(side.p, side.chasing)
			c.text(side.label, pad, y, regular, 11, colMuted, left)
			c.text(c.fit(text, w-2*pad-70, regular, 11), w-pad, y, regular, 11, col, right)
			y += 18
		}
	}
	return c
}

func containsRel(rows []Relative, index int) bool {
	for _, r := range rows {
		if r.Index == index {
			return true
		}
	}
	return false
}

func paceText(p *PaceSide, chasing bool) (string, color.Color) {
	closing := 0.0
	if p.ClosingSPerLap != nil {
		closing = math.Abs(*p.ClosingSPerLap)
	}
	laps := 0
	if p.LapsToCatch != nil {
		laps = int(math.Ceil(*p.LapsToCatch))
	}
	switch p.State {
	case "stable":
		return "Ritmo parejo", colMuted
	case "opening":
		if chasing {
			return fmt.Sprintf("Se escapa %.1f s por vuelta", closing), colMuted
		}
		return fmt.Sprintf("Le sacás %.1f s por vuelta", closing), colMuted
	case "catching":
		if chasing {
			return fmt.Sprintf("Lo alcanzás en ~%d vueltas", laps), colOk
		}
		return fmt.Sprintf("Te alcanza en ~%d vueltas", laps), colWarn
	case "after_finish":
		if chasing {
			return "Descontás, pero no llegás antes del final", colMuted
		}
		return "Descuenta, pero no llega antes del final", colMuted
	}
	return "Faltan vueltas limpias para medir el ritmo", colMuted
}

func renderTimes(v View, scale float64) *canvas {
	if !v.Live() {
		return nil
	}
	s := v.Snap
	lap := s.Lap
	var review []SectorReview
	for _, r := range s.SectorReview {
		if r.SectorDeltas != nil {
			review = append(review, r)
		}
	}
	w := 340.0
	h := 128.0
	if len(review) > 0 {
		h += 22 + float64(len(review))*18
	}
	c := base(w, h, v, scale)
	timeCol := colFg
	if lap.LapInvalid {
		timeCol = colDanger
	}
	c.text(lapTime(lap.CurrentLapMs), pad, 40, bold, 26, timeCol, left)
	best := (*int)(nil)
	if me := s.player(); me != nil {
		best = me.BestLapMs
	}
	c.text("Última "+optLapTime(lap.LastLapMs), w-pad, 22, regular, 11, colMuted, right)
	c.text("Mejor "+optLapTime(best), w-pad, 38, regular, 11, colMuted, right)

	var s3 *int
	if lap.Sector == 3 && lap.Sector1Ms != nil && lap.Sector2Ms != nil {
		v := lap.CurrentLapMs - *lap.Sector1Ms - *lap.Sector2Ms
		s3 = &v
	}
	boxW := (w - 2*pad - 12) / 3
	for i, ms := range []*int{lap.Sector1Ms, lap.Sector2Ms, s3} {
		x := pad + float64(i)*(boxW+6)
		border := colLine
		if lap.Sector == i+1 {
			border = colAccent
		}
		c.frame(x, 54, boxW, 52, 6, 1, border)
		c.text(fmt.Sprintf("S%d", i+1), x+boxW/2, 72, medium, 10, colMuted, center)
		val := "—"
		if ms != nil && lap.Sector > i+1 {
			val = fmt.Sprintf("%.3f", float64(*ms)/1000)
		}
		c.text(val, x+boxW/2, 94, medium, 14, colFg, center)
	}
	if len(review) > 0 {
		y := 134.0
		c.text("ÚLTIMAS VUELTAS VS. MEJOR LIMPIA", pad, y, medium, 9, colMuted, left)
		for _, r := range review {
			y += 18
			c.text(fmt.Sprintf("V%d", r.Lap), pad, y, regular, 11, colMuted, left)
			lt := colFg
			if !r.Valid {
				lt = colDanger
			}
			c.text(lapTime(r.TimeMs), pad+30, y, regular, 11, lt, left)
			for i, d := range r.SectorDeltas {
				x := pad + 150 + float64(i+1)*((w-2*pad-150)/3)
				if d == nil {
					c.text("—", x, y, regular, 11, colMuted, right)
				} else {
					c.text(signed(*d), x, y, medium, 11, deltaColor(*d), right)
				}
			}
		}
	}
	return c
}

func renderStandings(v View, scale float64) *canvas {
	if !v.Live() || len(v.Snap.Cars) == 0 {
		return nil
	}
	rows := v.Rows
	if rows <= 0 {
		rows = 10
	}
	cars := v.Snap.Cars
	at := 0
	for i := range cars {
		if cars[i].IsPlayer {
			at = i
		}
	}
	start := max(0, min(at-rows/2, len(cars)-rows))
	end := min(len(cars), start+rows)
	const rowH = 22.0
	w := 260.0
	c := base(w, pad*2+float64(end-start)*rowH, v, scale)
	fastest := 0
	for _, car := range cars {
		if car.BestLapMs != nil && (fastest == 0 || *car.BestLapMs < fastest) {
			fastest = *car.BestLapMs
		}
	}
	y := pad
	for i := start; i < end; i++ {
		car := &cars[i]
		if car.IsPlayer {
			c.roundRect(pad-4, y, w-2*pad+8, rowH, 5, color.NRGBA{34, 211, 238, 40})
		}
		c.text(fmt.Sprint(car.Position), pad+18, y+16, regular, 12, colMuted, right)
		c.roundRect(pad+26, y+4, 4, 14, 2, carColor(car))
		wt := regular
		if car.IsPlayer {
			wt = bold
		}
		nw := c.text(c.fit(shortName(car), 130, wt, 13), pad+38, y+16, wt, 13, colFg, left)
		if car.Pit != "On track" && car.Pit != "" {
			c.roundRect(pad+42+nw, y+5, 28, 13, 3, colWarn)
			c.text("BOX", pad+56+nw, y+15, bold, 9, color.Black, center)
		} else if car.BestLapMs != nil && *car.BestLapMs == fastest {
			c.roundRect(pad+44+nw, y+9, 5, 5, 2.5, colPurple)
		}
		right_ := "—"
		if car.Position == 1 {
			right_ = fmt.Sprintf("V%d", car.Lap)
		} else if car.GapAheadMs > 0 {
			right_ = fmt.Sprintf("+%.3f", float64(car.GapAheadMs)/1000)
		}
		c.text(right_, w-pad, y+16, regular, 11, colMuted, right)
		y += rowH
	}
	return c
}

func renderPedals(v View, scale float64) *canvas {
	throttle, brake, ok := v.Throttle, v.Brake, v.Pedals
	if !ok && v.Live() && v.Snap.Car != nil {
		throttle, brake, ok = v.Snap.Car.Throttle, v.Snap.Car.Brake, true
	}
	if !ok {
		return nil
	}
	w, h := 84.0, 150.0
	c := base(w, h, v, scale)
	barH := h - 2*pad
	for i, b := range []struct {
		v   float64
		col color.Color
	}{{brake, colDanger}, {throttle, colOk}} {
		x := pad + float64(i)*(24+12)
		c.roundRect(x, pad, 24, barH, 5, colPanel2)
		if fill := barH * clamp01(b.v); fill > 0.5 {
			c.roundRect(x, pad+barH-fill, 24, fill, 5, b.col)
		}
	}
	return c
}

func renderRadio(v View, scale float64) *canvas {
	if v.Radio == nil || v.RadioAge > RadioShown {
		return nil
	}
	w := 480.0
	probe := newCanvas(w, 10, scale)
	lines := probe.wrap("“"+v.Radio.Text+"”", w-2*pad-12, medium, 16)
	h := pad*2 + 18 + float64(len(lines))*22
	c := base(w, h, v, scale)
	urgent := v.Radio.Priority == "urgente"
	bar := colAccent
	if urgent {
		bar = colDanger
	}
	c.roundRect(pad, pad, 3, h-2*pad, 1.5, bar)
	head := "RADIO"
	if v.Radio.Lap != nil {
		head += fmt.Sprintf(" · VUELTA %d", *v.Radio.Lap)
	}
	headCol := colMuted
	if urgent {
		headCol = colDanger
	}
	c.text(head, pad+12, pad+10, medium, 10, headCol, left)
	y := pad + 32
	for _, l := range lines {
		c.text(l, pad+12, y, medium, 16, colFg, left)
		y += 22
	}
	return c
}
