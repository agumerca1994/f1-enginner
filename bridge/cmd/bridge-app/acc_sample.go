package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/layout"
	"fyne.io/fyne/v2/theme"
	"fyne.io/fyne/v2/widget"

	"github.com/agumerca1994/race-engineer/bridge/internal/acc"
	"github.com/agumerca1994/race-engineer/bridge/internal/capture"
)

// accSampler records an Assetto Corsa game into a sample, the raw material for
// supporting it: the shared memory always, and ACC's broadcasting API when
// broadcasting.json has it on.
type accSampler struct {
	mu        sync.Mutex
	w         *capture.Writer
	path      string
	note      string
	stats     *acc.Stats
	cancel    context.CancelFunc
	done      chan struct{}
	lastPath  string
	broadcast bool // ACC's broadcasting is part of this recording
}

func (s *accSampler) recording() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.w != nil
}

func (s *accSampler) start(note string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.w != nil {
		return nil
	}
	var settings acc.BroadcastSettings // Port 0: shared memory only
	if path, err := acc.SettingsPath(); err == nil {
		if read, err := acc.ReadSettings(path); err == nil {
			settings = read
		}
	}
	source := "assetto corsa shared memory"
	if settings.Port > 0 {
		source += fmt.Sprintf(" + acc broadcasting 127.0.0.1:%d", settings.Port)
	}
	dir, err := samplesDir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	file := filepath.Join(dir, "acc-"+time.Now().Format("2006-01-02-150405")+".f1cap.zst")
	w, err := capture.Create(file, capture.Meta{BridgeVersion: version, StartedAt: time.Now().UTC(),
		ListenAddr: source, Note: note})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.w, s.path, s.note, s.stats, s.cancel, s.done = w, file, note, &acc.Stats{}, cancel, make(chan struct{})
	s.broadcast = settings.Port > 0
	stats, done := s.stats, s.done
	go func() {
		defer close(done)
		acc.Run(ctx, settings, func(at time.Time, data []byte) {
			s.mu.Lock()
			if s.w != nil {
				s.w.Write(at, data)
			}
			s.mu.Unlock()
		}, stats)
	}()
	return nil
}

func (s *accSampler) stop() (string, error) {
	s.mu.Lock()
	cancel, done := s.cancel, s.done
	s.mu.Unlock()
	if cancel == nil {
		return "", nil
	}
	cancel()
	<-done
	s.mu.Lock()
	defer s.mu.Unlock()
	err := s.w.Close()
	var buf bytes.Buffer
	if s.note != "" {
		fmt.Fprintf(&buf, "Nota: %s\n\n", s.note)
	}
	buf.WriteString(s.describe())
	summary := strings.TrimSuffix(s.path, ".f1cap.zst") + ".txt"
	err = errors.Join(err, os.WriteFile(summary, buf.Bytes(), 0o644))
	s.lastPath, s.w, s.cancel = s.path, nil, nil
	return s.lastPath, err
}

// describe is one line per source: what arrived and what failed.
func (s *accSampler) describe() string {
	pages, messages, registered, lastErr := s.stats.Snapshot()
	text := fmt.Sprintf("Memoria compartida (ACC, original, Rally): física %d, gráficos %d, estática %d\n",
		pages[acc.KindPhysics], pages[acc.KindGraphics], pages[acc.KindStatic])
	text += fmt.Sprintf("Memoria compartida (EVO): física %d, gráficos %d, estática %d\n",
		pages[acc.KindEvoPhysics], pages[acc.KindEvoGraphics], pages[acc.KindEvoStatic])
	if s.broadcast {
		text += fmt.Sprintf("Broadcasting de ACC: %d mensajes (registrado: %v)\n", messages, registered)
	} else {
		text += "Broadcasting de ACC: no (sólo memoria compartida)\n"
	}
	if lastErr != "" {
		text += "Último error: " + lastErr + "\n"
	}
	return text
}

func (s *accSampler) progress() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.w == nil {
		if s.lastPath != "" {
			return "Última muestra de Assetto Corsa: " + filepath.Base(s.lastPath)
		}
		return "Sin grabar"
	}
	pages, messages, registered, _ := s.stats.Snapshot()
	physics := pages[acc.KindPhysics] + pages[acc.KindEvoPhysics]
	text := fmt.Sprintf("Grabando Assetto Corsa · física %d · gráficos %d", physics, pages[acc.KindGraphics]+pages[acc.KindEvoGraphics])
	if s.broadcast {
		text += fmt.Sprintf(" · autos (broadcasting) %d", messages)
		if !registered {
			text += " · esperando a ACC"
		}
	}
	if physics == 0 {
		text += " · esperando al juego: entrá a pista"
	}
	return text
}

// accDevSection is the ACC part of the development tab (Windows only).
type accDevSection struct {
	c       *controller
	info    *widget.Label
	record  *widget.Button
	stop    *widget.Button
	prepare *widget.Label
}

func newAccDevSection(c *controller, note *widget.Entry) (*accDevSection, fyne.CanvasObject) {
	s := &accDevSection{c: c, info: widget.NewLabel(""), prepare: hint("")}
	s.info.Wrapping = fyne.TextWrapWord
	s.prepare.Hide()
	s.record = widget.NewButtonWithIcon("Grabar muestra de Assetto Corsa", theme.MediaRecordIcon(), func() {
		if err := c.accSampler.start(note.Text); err != nil {
			c.setError(err.Error())
		}
		c.changed()
	})
	s.stop = widget.NewButtonWithIcon("Detener", theme.MediaStopIcon(), func() {
		go func() {
			if _, err := c.accSampler.stop(); err != nil {
				c.setError(fmt.Sprintf("La muestra de Assetto Corsa se guardó con errores: %v", err))
			}
			c.changed()
		}()
	})
	s.stop.Importance = widget.DangerImportance
	prepare := widget.NewButtonWithIcon("Preparar ACC", theme.SettingsIcon(), func() {
		path, err := acc.SettingsPath()
		var settings acc.BroadcastSettings
		changed := false
		if err == nil {
			settings, changed, err = acc.PrepareSettings(path)
		}
		switch {
		case err != nil:
			s.prepare.SetText("No se pudo preparar ACC: " + err.Error())
		case changed:
			s.prepare.SetText(fmt.Sprintf("Listo: broadcasting activado en el puerto %d. Abrí ACC ahora (si estaba abierto, reinicialo).", settings.Port))
		default:
			s.prepare.SetText(fmt.Sprintf("ACC ya estaba preparado (puerto %d).", settings.Port))
		}
		s.prepare.Show()
	})
	content := section("Assetto Corsa",
		hint("Graba la telemetría de Assetto Corsa Competizione, EVO, Rally o el original para sumarlos a la app. "+
			"Abrí el juego, entrá a pista y grabá unos minutos manejando; en la Nota de arriba poné qué juego es. "+
			"Sólo para Competizione: la primera vez, con el juego cerrado, tocá \"Preparar ACC\" para sumar la lista de autos."),
		container.NewHBox(prepare),
		s.prepare,
		s.info,
		container.NewHBox(s.record, s.stop, layout.NewSpacer()),
	)
	return s, content
}

func (s *accDevSection) refresh() {
	s.info.SetText(s.c.accSampler.progress())
	if s.c.accSampler.recording() {
		s.record.Hide()
		s.stop.Show()
	} else {
		s.record.Show()
		s.stop.Hide()
	}
}
