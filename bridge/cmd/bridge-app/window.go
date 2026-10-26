package main

import (
	"fmt"
	"image/color"
	"sort"
	"strings"
	"time"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/dialog"
	"fyne.io/fyne/v2/layout"
	"fyne.io/fyne/v2/theme"
	"fyne.io/fyne/v2/widget"

	"github.com/agumerca1994/race-engineer/bridge/internal/autostart"
	"github.com/agumerca1994/race-engineer/bridge/internal/udp"
)

var levelColors = []color.Color{
	color.NRGBA{0x34, 0xd3, 0x99, 0xff}, // ok
	color.NRGBA{0xfb, 0xbf, 0x24, 0xff}, // attention
	color.NRGBA{0xf4, 0x3f, 0x5e, 0xff}, // problem
}

// statusWindow shows the state on one tab and the settings on another; the
// development tab only exists in development mode. Each tab scrolls, so the
// window never grows past the screen. Closing it only hides it: the app keeps
// running from the tray.
type statusWindow struct {
	c    *controller
	win  fyne.Window
	tabs *container.AppTabs

	// Always visible
	dot      *canvas.Circle
	headline *widget.Label
	subline  *widget.Label
	errLabel *widget.Label

	// Estado
	linkBox    *fyne.Container
	pairBox    *fyne.Container
	pairCode   *canvas.Text
	sendBox    *fyne.Container
	reception  *canvas.Text
	received   *canvas.Text
	sent       *canvas.Text
	lastPacket *canvas.Text
	console    *widget.Label
	startBtn   *widget.Button
	stopBtn    *widget.Button

	// Ajustes
	account   *widget.Label
	unlinkBtn *widget.Button
	devCheck  *widget.Check
	ipLabel   *widget.Label

	// Paneles (Windows only)
	panels *panelsTab

	// Desarrollo
	devTab     *container.TabItem
	note       *widget.Entry
	sampleInfo *widget.Label
	recordBtn  *widget.Button
	stopRecBtn *widget.Button
}

func newStatusWindow(c *controller) *statusWindow {
	w := &statusWindow{c: c, win: c.app.NewWindow("Ingeniero de carrera · Bridge")}

	w.dot = canvas.NewCircle(levelColors[1])
	w.headline = widget.NewLabelWithStyle("", fyne.TextAlignLeading, fyne.TextStyle{Bold: true})
	w.subline = widget.NewLabel("")
	w.subline.Importance = widget.LowImportance
	w.subline.Truncation = fyne.TextTruncateEllipsis
	w.errLabel = widget.NewLabel("")
	w.errLabel.Wrapping = fyne.TextWrapWord
	w.errLabel.Importance = widget.DangerImportance
	w.errLabel.Hide()
	header := container.NewVBox(
		container.NewHBox(container.NewCenter(container.NewGridWrap(fyne.NewSize(12, 12), w.dot)), w.headline),
		w.subline,
		w.errLabel,
	)

	w.tabs = container.NewAppTabs(
		container.NewTabItemWithIcon("Estado", theme.HomeIcon(), scroll(w.buildStatus())),
		container.NewTabItemWithIcon("Ajustes", theme.SettingsIcon(), scroll(w.buildSettings())),
	)
	if c.panels.Supported() {
		w.panels = newPanelsTab(c)
		w.tabs.Append(w.panels.item)
	}
	w.devTab = container.NewTabItemWithIcon("Desarrollo", theme.MediaRecordIcon(), scroll(w.buildDev()))

	w.win.SetContent(container.NewBorder(container.NewPadded(header), nil, nil, nil, w.tabs))
	w.win.Resize(fyne.NewSize(460, 520))
	w.win.SetCloseIntercept(func() { w.win.Hide() })
	w.refresh()
	return w
}

func scroll(content fyne.CanvasObject) fyne.CanvasObject {
	return container.NewVScroll(container.NewPadded(content))
}

// section is a bold title over its content.
func section(title string, objs ...fyne.CanvasObject) fyne.CanvasObject {
	head := widget.NewLabelWithStyle(title, fyne.TextAlignLeading, fyne.TextStyle{Bold: true})
	return container.NewVBox(append([]fyne.CanvasObject{head}, objs...)...)
}

func hint(text string) *widget.Label {
	l := widget.NewLabel(text)
	l.Wrapping = fyne.TextWrapWord
	l.Importance = widget.LowImportance
	return l
}

// tile is a number with its caption, on a rounded background.
func tile(caption string) (fyne.CanvasObject, *canvas.Text) {
	value := canvas.NewText("—", theme.Color(theme.ColorNameForeground))
	value.TextSize = 22
	value.TextStyle = fyne.TextStyle{Bold: true, Monospace: true}
	label := canvas.NewText(caption, theme.Color(theme.ColorNamePlaceHolder))
	label.TextSize = theme.CaptionTextSize()
	bg := canvas.NewRectangle(theme.Color(theme.ColorNameInputBackground))
	bg.CornerRadius = 8
	return container.NewStack(bg, container.NewPadded(container.NewVBox(label, value))), value
}

func (w *statusWindow) buildStatus() fyne.CanvasObject {
	c := w.c

	linkBtn := widget.NewButtonWithIcon("Vincular "+thisComputer(), theme.LoginIcon(), c.beginPairing)
	linkBtn.Importance = widget.HighImportance
	linkText := widget.NewLabel("Vinculá " + thisComputer() + " a tu cuenta para que tu telemetría llegue al dashboard y al ingeniero.")
	linkText.Wrapping = fyne.TextWrapWord
	w.linkBox = container.NewVBox(
		linkText,
		linkBtn,
	)

	w.pairCode = canvas.NewText("", theme.Color(theme.ColorNamePrimary))
	w.pairCode.TextSize = 40
	w.pairCode.TextStyle = fyne.TextStyle{Monospace: true, Bold: true}
	w.pairCode.Alignment = fyne.TextAlignCenter
	pairOpen := widget.NewButtonWithIcon("Abrir la página", theme.ComputerIcon(), func() {
		c.mu.Lock()
		p := c.pairing
		c.mu.Unlock()
		if p != nil {
			c.openURL(p.VerificationURLComplete)
		}
	})
	w.pairBox = container.NewVBox(
		widget.NewLabelWithStyle("Tu código", fyne.TextAlignCenter, fyne.TextStyle{}),
		w.pairCode,
		hint("Se abrió el navegador con el código cargado: iniciá sesión y tocá Vincular. Si usás otro navegador, entrá a f1.imanzanastore.com.ar/pair y escribí este código."),
		container.NewGridWithColumns(2, pairOpen, widget.NewButton("Cancelar", c.cancelPairing)),
	)

	recTile, rec := tile("Señal de la consola")
	lastTile, last := tile("Último dato")
	inTile, in := tile("Paquetes recibidos")
	outTile, out := tile("Paquetes enviados")
	w.reception, w.lastPacket, w.received, w.sent = rec, last, in, out
	w.console = widget.NewLabel("")
	w.console.Importance = widget.LowImportance
	w.startBtn = widget.NewButtonWithIcon("Empezar a enviar", theme.MediaPlayIcon(), c.start)
	w.startBtn.Importance = widget.HighImportance
	w.stopBtn = widget.NewButtonWithIcon("Detener", theme.MediaStopIcon(), func() { go c.stop() })
	dashboard := widget.NewButtonWithIcon("Abrir dashboard", theme.ComputerIcon(), func() { c.openURL(dashboardURL) })
	w.sendBox = container.NewVBox(
		container.NewGridWithColumns(2, recTile, lastTile, inTile, outTile),
		w.console,
		container.NewHBox(w.startBtn, w.stopBtn, layout.NewSpacer(), dashboard),
	)

	return container.NewVBox(w.linkBox, w.pairBox, w.sendBox)
}

func (w *statusWindow) buildSettings() fyne.CanvasObject {
	c := w.c

	w.account = widget.NewLabel("")
	w.account.Wrapping = fyne.TextWrapWord
	w.unlinkBtn = widget.NewButtonWithIcon("Desvincular", theme.LogoutIcon(), func() {
		dialog.ShowConfirm("Desvincular "+thisComputer(),
			"Va a dejar de enviar datos a tu cuenta. Podés volver a vincularla cuando quieras.",
			func(ok bool) {
				if ok {
					go c.unlink()
				}
			}, w.win)
	})
	w.unlinkBtn.Importance = widget.DangerImportance

	atLogin := widget.NewCheck("Abrir al iniciar sesión", func(on bool) {
		var err error
		if on {
			err = autostart.Enable()
		} else {
			err = autostart.Disable()
		}
		if err != nil {
			c.setError(fmt.Sprintf("No se pudo cambiar el inicio automático: %v", err))
		}
	})
	atLogin.SetChecked(autostart.Enabled())
	autoSend := widget.NewCheck("Empezar a enviar apenas se abre", func(on bool) {
		c.app.Preferences().SetBool(prefAutoSend, on)
	})
	autoSend.SetChecked(c.app.Preferences().BoolWithFallback(prefAutoSend, true))
	w.devCheck = widget.NewCheck("Modo desarrollo", func(on bool) {
		if on != c.devMode() {
			c.setDevMode(on)
		}
	})
	w.devCheck.Checked = c.devMode()

	w.ipLabel = widget.NewLabel("")
	w.ipLabel.Wrapping = fyne.TextWrapWord
	w.ipLabel.TextStyle = fyne.TextStyle{Monospace: true}

	return container.NewVBox(
		section("Cuenta", w.account, container.NewHBox(w.unlinkBtn)),
		widget.NewSeparator(),
		section("Comportamiento", atLogin, autoSend, w.devCheck,
			hint("El modo desarrollo agrega la pestaña Desarrollo, para grabar muestras de la telemetría.")),
		widget.NewSeparator(),
		section("Configurar el juego",
			hint("Telemetría UDP activada, broadcast desactivado, puerto 20777, formato 2024. En la IP poné la de esta computadora (o 127.0.0.1 si el juego corre acá mismo):"),
			w.ipLabel,
		),
		widget.NewSeparator(),
		section("Cerrar la app",
			hint("La X sólo oculta esta ventana: la app sigue enviando desde "+trayPlace()+". Para cerrarla del todo:"),
			container.NewHBox(widget.NewButtonWithIcon("Cerrar Ingeniero Bridge", theme.CancelIcon(), c.quit)),
		),
	)
}

func (w *statusWindow) buildDev() fyne.CanvasObject {
	c := w.c
	w.note = widget.NewEntry()
	w.note.SetPlaceHolder("Formato UDP del menú, pista, tipo de sesión")
	w.sampleInfo = widget.NewLabel("")
	w.sampleInfo.Wrapping = fyne.TextWrapWord
	w.recordBtn = widget.NewButtonWithIcon("Grabar muestra", theme.MediaRecordIcon(), func() { c.startSample(w.note.Text) })
	w.recordBtn.Importance = widget.HighImportance
	w.stopRecBtn = widget.NewButtonWithIcon("Detener grabación", theme.MediaStopIcon(), func() { go c.stopSample() })
	w.stopRecBtn.Importance = widget.DangerImportance
	openSamples := widget.NewButtonWithIcon("Abrir carpeta", theme.FolderOpenIcon(), c.openSamples)

	return container.NewVBox(
		section("Grabar muestra",
			hint("Graba todo lo que manda el juego, sin filtrar y en cualquier formato, en un archivo .f1cap.zst con un resumen .txt al lado. Funciona aunque no estés enviando."),
			widget.NewLabel("Nota"),
			w.note,
			w.sampleInfo,
			container.NewHBox(w.recordBtn, w.stopRecBtn, layout.NewSpacer(), openSamples),
		),
	)
}

func (w *statusWindow) Show() {
	fyne.Do(func() {
		w.ipLabel.SetText(lanText())
		w.win.Show()
		w.win.RequestFocus()
	})
}

// lanText lists this computer's IPv4 addresses, one per line.
func lanText() string {
	var lines []string
	for name, ips := range udp.LANAddresses() {
		lines = append(lines, fmt.Sprintf("%s  (%s)", strings.Join(ips, ", "), name))
	}
	sort.Strings(lines)
	if len(lines) == 0 {
		return "Sin red: conectá esta computadora a la misma red que la consola."
	}
	return strings.Join(lines, "\n")
}

// refresh copies the controller state into the widgets. Called on the UI thread.
func (w *statusWindow) refresh() {
	c := w.c
	if w.panels != nil {
		w.panels.refresh()
	}
	head, level := c.headline()
	w.headline.SetText(head)
	w.dot.FillColor = levelColors[level]
	w.dot.Refresh()

	c.mu.Lock()
	linked, email, pairingNow, lastErr := c.cfg.Token != "", c.email, c.pairing, c.lastErr
	c.mu.Unlock()
	if email == "" {
		email = "tu cuenta"
	}

	if lastErr != "" {
		w.errLabel.SetText(lastErr)
		w.errLabel.Show()
	} else {
		w.errLabel.Hide()
	}
	if w.ipLabel.Text == "" {
		w.ipLabel.SetText(lanText())
	}
	w.refreshDev()
	defer func() {
		if w.subline.Text == "" {
			w.subline.Hide()
		} else {
			w.subline.Show()
		}
	}()

	switch {
	case pairingNow != nil:
		w.subline.SetText("Confirmá este código en la web para vincular " + thisComputer() + ".")
		w.pairCode.Text = pairingNow.UserCode
		w.pairCode.Refresh()
		w.pairBox.Show()
		w.linkBox.Hide()
	case linked:
		w.subline.SetText("Vinculada a " + email)
		w.pairBox.Hide()
		w.linkBox.Hide()
	default:
		w.subline.SetText("")
		w.pairBox.Hide()
		w.linkBox.Show()
	}
	if linked {
		w.account.SetText("Vinculada a " + email + ".")
		w.unlinkBtn.Show()
	} else {
		w.account.SetText(strings.ToUpper(thisComputer()[:1]) + thisComputer()[1:] + " no está vinculada.")
		w.unlinkBtn.Hide()
	}

	st, running := c.status()
	if !linked {
		w.sendBox.Hide()
		return
	}
	w.sendBox.Show()
	if running {
		w.startBtn.Hide()
		w.stopBtn.Show()
	} else {
		w.startBtn.Show()
		w.stopBtn.Hide()
	}
	setText(w.received, fmt.Sprint(st.Received))
	setText(w.sent, fmt.Sprint(st.Sent))
	if st.HasReception {
		setText(w.reception, fmt.Sprintf("%.0f%%", st.Reception*100))
	} else {
		setText(w.reception, "—")
	}
	if st.LastPacket.IsZero() {
		setText(w.lastPacket, "—")
	} else {
		setText(w.lastPacket, "hace "+time.Since(st.LastPacket).Round(time.Second).String())
	}
	if st.Source != "" {
		w.console.SetText("Consola: " + st.Source)
	} else {
		w.console.SetText("Consola: todavía no llegaron datos")
	}
}

func setText(t *canvas.Text, s string) {
	if t.Text != s {
		t.Text = s
		t.Refresh()
	}
}

// refreshDev adds or removes the development tab and keeps the check in sync
// with the menu, without firing the check's callback.
func (w *statusWindow) refreshDev() {
	dev := w.c.devMode()
	if w.devCheck.Checked != dev {
		w.devCheck.Checked = dev
		w.devCheck.Refresh()
	}
	shown := false
	for _, t := range w.tabs.Items {
		shown = shown || t == w.devTab
	}
	switch {
	case dev && !shown:
		w.tabs.Append(w.devTab)
	case !dev && shown:
		w.tabs.Remove(w.devTab)
	}
	if !dev {
		return
	}
	w.sampleInfo.SetText(w.c.sampler.progress())
	if w.c.sampler.recording() {
		w.recordBtn.Hide()
		w.stopRecBtn.Show()
		w.note.Disable()
	} else {
		w.recordBtn.Show()
		w.stopRecBtn.Hide()
		w.note.Enable()
	}
}
