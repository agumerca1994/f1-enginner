package main

import (
	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/theme"
	"fyne.io/fyne/v2/widget"

	"github.com/agumerca1994/race-engineer/bridge/internal/overlay"
)

// panelsTab turns the floating panels on and off. Windows only: elsewhere the
// web overlays (OBS or a browser tab) do the same job.
type panelsTab struct {
	c      *controller
	checks map[overlay.Panel]*widget.Check
	lock   *widget.Check
	item   *container.TabItem
}

func newPanelsTab(c *controller) *panelsTab {
	t := &panelsTab{c: c, checks: map[overlay.Panel]*widget.Check{}}
	var boxes []fyne.CanvasObject
	for _, p := range overlay.Panels {
		id := p.ID
		check := widget.NewCheck(p.Label, func(on bool) { c.panels.SetPanel(id, on) })
		t.checks[id] = check
		boxes = append(boxes, check)
	}
	t.lock = widget.NewCheck("Bloquear para conducir", func(on bool) { c.panels.SetLocked(on) })
	reset := widget.NewButtonWithIcon("Restablecer posiciones", theme.ViewRefreshIcon(), c.panels.ResetPositions)

	content := container.NewVBox(
		hint("Paneles sobre el juego con los datos del dashboard: aparecen solos cuando corrés y se ocultan en los menús. "+
			"El juego tiene que estar en modo ventana sin bordes; en pantalla completa los tapa."),
		section("Paneles", boxes...),
		section("Acomodarlos",
			hint("Desbloqueados se ven con un borde: arrastralos con el mouse y cambiá el tamaño con la rueda. "+
				"Bloqueados, los clics pasan al juego."),
			t.lock,
			hint("Ctrl+Alt+F10 bloquea y desbloquea · Ctrl+Alt+F11 los muestra u oculta"),
			reset,
		),
	)
	t.item = container.NewTabItemWithIcon("Paneles", theme.GridIcon(), scroll(content))
	t.refresh()
	return t
}

// refresh mirrors changes made from the tray menu or the hotkeys.
func (t *panelsTab) refresh() {
	s := t.c.panels.Settings()
	for id, check := range t.checks {
		check.SetChecked(s.Panels[id].On)
	}
	t.lock.SetChecked(s.Locked)
}
