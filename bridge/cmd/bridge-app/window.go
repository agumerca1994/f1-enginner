package main

import (
	"fmt"
	"image/color"
	"time"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/dialog"
	"fyne.io/fyne/v2/layout"
	"fyne.io/fyne/v2/theme"
	"fyne.io/fyne/v2/widget"

	"github.com/agumerca1994/race-engineer/bridge/internal/autostart"
)

var levelColors = []color.Color{
	color.NRGBA{0x34, 0xd3, 0x99, 0xff}, // ok
	color.NRGBA{0xfb, 0xbf, 0x24, 0xff}, // attention
	color.NRGBA{0xf4, 0x3f, 0x5e, 0xff}, // problem
}

// statusWindow shows the link, the sending state and the options. Closing it
// only hides it: the app keeps sending from the menu bar.
type statusWindow struct {
	c   *controller
	win fyne.Window

	dot      *canvas.Circle
	headline *widget.Label
	errLabel *widget.Label

	account    *widget.Label
	linkBtn    *widget.Button
	unlinkBtn  *widget.Button
	pairBox    *fyne.Container
	pairCode   *canvas.Text
	pairOpen   *widget.Button
	sendBox    *fyne.Container
	received   *widget.Label
	sent       *widget.Label
	reception  *widget.Label
	console    *widget.Label
	lastPacket *widget.Label
	startBtn   *widget.Button
	stopBtn    *widget.Button
}

func newStatusWindow(c *controller) *statusWindow {
	w := &statusWindow{c: c, win: c.app.NewWindow("Ingeniero de carrera · Bridge")}

	w.dot = canvas.NewCircle(levelColors[1])
	w.dot.Resize(fyne.NewSize(12, 12))
	w.headline = widget.NewLabelWithStyle("", fyne.TextAlignLeading, fyne.TextStyle{Bold: true})
	w.errLabel = widget.NewLabel("")
	w.errLabel.Wrapping = fyne.TextWrapWord
	w.errLabel.Importance = widget.DangerImportance
	w.errLabel.Hide()

	// Account
	w.account = widget.NewLabel("")
	w.account.Wrapping = fyne.TextWrapWord
	w.linkBtn = widget.NewButtonWithIcon("Vincular esta Mac", theme.LoginIcon(), c.beginPairing)
	w.linkBtn.Importance = widget.HighImportance
	w.unlinkBtn = widget.NewButtonWithIcon("Desvincular", theme.LogoutIcon(), func() {
		dialog.ShowConfirm("Desvincular esta Mac",
			"Va a dejar de enviar datos a tu cuenta. Podés volver a vincularla cuando quieras.",
			func(ok bool) {
				if ok {
					go c.unlink()
				}
			}, w.win)
	})

	w.pairCode = canvas.NewText("", theme.Color(theme.ColorNamePrimary))
	w.pairCode.TextSize = 40
	w.pairCode.TextStyle = fyne.TextStyle{Monospace: true, Bold: true}
	w.pairCode.Alignment = fyne.TextAlignCenter
	w.pairOpen = widget.NewButtonWithIcon("Abrir la página de vinculación", theme.ComputerIcon(), func() {
		c.mu.Lock()
		p := c.pairing
		c.mu.Unlock()
		if p != nil {
			c.openURL(p.VerificationURLComplete)
		}
	})
	pairHint := widget.NewLabel("Se abrió el navegador con el código cargado: iniciá sesión y tocá Vincular. También podés escribirlo a mano en la web, en Ajustes → Vincular otro.")
	pairHint.Wrapping = fyne.TextWrapWord
	w.pairBox = container.NewVBox(
		widget.NewLabelWithStyle("Tu código", fyne.TextAlignCenter, fyne.TextStyle{}),
		w.pairCode,
		pairHint,
		container.NewGridWithColumns(2, w.pairOpen, widget.NewButton("Cancelar", c.cancelPairing)),
	)
	w.pairBox.Hide()

	accountCard := widget.NewCard("Cuenta", "", container.NewVBox(
		w.account,
		w.pairBox,
		container.NewHBox(w.linkBtn, w.unlinkBtn),
	))

	// Sending
	w.received, w.sent, w.reception, w.console, w.lastPacket =
		widget.NewLabel("—"), widget.NewLabel("—"), widget.NewLabel("—"), widget.NewLabel("—"), widget.NewLabel("—")
	stat := func(name string, value *widget.Label) fyne.CanvasObject {
		value.TextStyle = fyne.TextStyle{Monospace: true}
		return container.NewHBox(widget.NewLabel(name), layout.NewSpacer(), value)
	}
	w.startBtn = widget.NewButtonWithIcon("Empezar a enviar", theme.MediaPlayIcon(), c.start)
	w.startBtn.Importance = widget.HighImportance
	w.stopBtn = widget.NewButtonWithIcon("Detener", theme.MediaStopIcon(), func() { go c.stop() })
	dashboard := widget.NewButtonWithIcon("Abrir dashboard", theme.ComputerIcon(), func() { c.openURL(dashboardURL) })
	w.sendBox = container.NewVBox(
		stat("Señal de la consola", w.reception),
		stat("Consola", w.console),
		stat("Último dato", w.lastPacket),
		stat("Paquetes recibidos", w.received),
		stat("Paquetes enviados", w.sent),
		container.NewHBox(w.startBtn, w.stopBtn, layout.NewSpacer(), dashboard),
	)
	sendCard := widget.NewCard("Envío de telemetría", "", w.sendBox)

	// Options
	atLogin := widget.NewCheck("Abrir al iniciar sesión en la Mac", func(on bool) {
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
	optionsCard := widget.NewCard("Opciones", "", container.NewVBox(atLogin, autoSend))

	footer := widget.NewLabel("Cerrar esta ventana no detiene el envío: la app sigue en la barra de menú. En el juego: Telemetría UDP activada, formato 2024, puerto 20777.")
	footer.Wrapping = fyne.TextWrapWord
	footer.Importance = widget.LowImportance

	header := container.NewHBox(container.NewCenter(container.NewGridWrap(fyne.NewSize(12, 12), w.dot)), w.headline)
	w.win.SetContent(container.NewPadded(container.NewVBox(
		header, w.errLabel, accountCard, sendCard, optionsCard, footer,
	)))
	w.win.Resize(fyne.NewSize(440, 0))
	w.win.SetFixedSize(false)
	w.win.SetCloseIntercept(func() { w.win.Hide() })
	w.refresh()
	return w
}

func (w *statusWindow) Show() {
	fyne.Do(func() {
		w.win.Show()
		w.win.RequestFocus()
	})
}

// refresh copies the controller state into the widgets. Called on the UI thread.
func (w *statusWindow) refresh() {
	c := w.c
	head, level := c.headline()
	w.headline.SetText(head)
	w.dot.FillColor = levelColors[level]
	w.dot.Refresh()

	c.mu.Lock()
	linked, email, pairingNow, lastErr := c.cfg.Token != "", c.email, c.pairing, c.lastErr
	c.mu.Unlock()

	if lastErr != "" {
		w.errLabel.SetText(lastErr)
		w.errLabel.Show()
	} else {
		w.errLabel.Hide()
	}

	switch {
	case pairingNow != nil:
		w.account.SetText("Confirmá este código en la web para vincular esta Mac a tu cuenta.")
		w.pairCode.Text = pairingNow.UserCode
		w.pairCode.Refresh()
		w.pairBox.Show()
		w.linkBtn.Hide()
		w.unlinkBtn.Hide()
	case linked:
		who := email
		if who == "" {
			who = "tu cuenta"
		}
		w.account.SetText("Vinculada a " + who + ".")
		w.pairBox.Hide()
		w.linkBtn.Hide()
		w.unlinkBtn.Show()
	default:
		w.account.SetText("Vinculá esta Mac a tu cuenta para que tu telemetría llegue al dashboard y al ingeniero.")
		w.pairBox.Hide()
		w.linkBtn.Show()
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
	w.received.SetText(fmt.Sprint(st.Received))
	w.sent.SetText(fmt.Sprint(st.Sent))
	if st.HasReception {
		w.reception.SetText(fmt.Sprintf("%.0f%%", st.Reception*100))
	} else {
		w.reception.SetText("—")
	}
	if st.Source != "" {
		w.console.SetText(st.Source)
	} else {
		w.console.SetText("—")
	}
	if st.LastPacket.IsZero() {
		w.lastPacket.SetText("—")
	} else {
		w.lastPacket.SetText(fmt.Sprintf("hace %s", time.Since(st.LastPacket).Round(time.Second)))
	}
}
