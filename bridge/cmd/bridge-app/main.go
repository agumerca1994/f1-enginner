// Command bridge-app is the bridge with a user interface: an icon in the menu
// bar plus a status window. It links and unlinks the computer and sends the
// game's telemetry, with no terminal involved.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/app"
	"fyne.io/fyne/v2/driver/desktop"

	"github.com/agumerca1994/race-engineer/bridge/internal/agent"
	"github.com/agumerca1994/race-engineer/bridge/internal/config"
	"github.com/agumerca1994/race-engineer/bridge/internal/overlay"
	"github.com/agumerca1994/race-engineer/bridge/internal/pairing"
)

var version = "dev"

const (
	appID        = "ar.com.imanzanastore.raceengineer.bridge"
	listenAddr   = ":20777"
	dashboardURL = "https://f1.imanzanastore.com.ar"
	prefAutoSend = "autoSend"
	prefDevMode  = "devMode"
	prefPanels   = "overlayPanels"
)

func main() {
	background := len(os.Args) > 1 && os.Args[1] == "--background"
	logger := openLog()

	a := app.NewWithID(appID)
	a.SetIcon(appIcon)
	c := newController(a, logger)

	if desk, ok := a.(desktop.App); ok {
		c.tray = desk
		if runtime.GOOS == "darwin" {
			desk.SetSystemTrayIcon(trayIcon)
		} else {
			desk.SetSystemTrayIcon(appIcon) // the monochrome template would be unreadable on a dark taskbar
		}
		c.refreshMenu()
	}

	c.setupPanels()
	c.window = newStatusWindow(c)
	if !background {
		c.window.Show()
	}

	c.loadAccount()
	go c.ticker()
	a.Run()
	c.accSampler.stop()
	c.stopDemo()
	c.stopPanels()
	c.stop()
	if _, err := c.sampler.stop(); err != nil {
		logger.Printf("closing the sample: %v", err)
	}
}

// controller owns the agent, the saved link and the UI state.
type controller struct {
	app    fyne.App
	tray   desktop.App
	window *statusWindow
	log    *log.Logger

	mu       sync.Mutex
	cfg      config.Config
	email    string
	running  *agent.Agent
	cancel   context.CancelFunc
	done     chan struct{}
	lastErr  string
	pairing  *pairing.Start
	pairStop context.CancelFunc
	sampler  sampler
	// Assetto Corsa Competizione samples (Windows, development mode).
	accSampler accSampler

	menu       *fyne.Menu
	menuStatus *fyne.MenuItem
	menuShape  string

	// Floating panels over the game (Windows only).
	live       *overlay.Live
	pedals     *overlay.Pedals
	panels     *overlay.Manager
	panelsStop context.CancelFunc
	liveStop   context.CancelFunc
	demoStop   context.CancelFunc
}

func newController(a fyne.App, logger *log.Logger) *controller {
	cfg, err := config.Load()
	if err != nil {
		logger.Printf("reading config: %v", err)
	}
	if cfg.Server == "" {
		cfg.Server = config.DefaultServer
	}
	return &controller{app: a, log: logger, cfg: cfg}
}

func (c *controller) linked() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.cfg.Token != ""
}

// loadAccount asks the server which account this computer is linked to and,
// if the user wants, starts sending right away.
func (c *controller) loadAccount() {
	if !c.linked() {
		c.changed()
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		c.mu.Lock()
		server, token := c.cfg.Server, c.cfg.Token
		c.mu.Unlock()
		acc, err := pairing.Self(ctx, server, token)
		switch {
		case err == pairing.ErrUnlinked:
			c.log.Printf("the server revoked this device; clearing the local link")
			c.clearLink()
		case err != nil:
			c.log.Printf("checking the account: %v", err)
		default:
			c.mu.Lock()
			c.email = acc.Email
			c.mu.Unlock()
		}
		if c.linked() {
			c.startLive()
		}
		if c.linked() && c.app.Preferences().BoolWithFallback(prefAutoSend, true) {
			c.start()
		}
		c.changed()
	}()
}

func (c *controller) start() {
	c.mu.Lock()
	if c.running != nil || c.cfg.Token == "" {
		c.mu.Unlock()
		return
	}
	cfg := agent.Config{
		Listen: listenAddr, Server: c.cfg.Server, Token: c.cfg.Token, Version: version,
		Logf: func(format string, args ...any) { c.log.Printf(format, args...) },
	}
	if c.panels.Supported() {
		cfg.OnPacket = c.pedals.Observe
	}
	ag := agent.New(cfg)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	c.running, c.cancel, c.done, c.lastErr = ag, cancel, done, ""
	c.mu.Unlock()
	c.sampler.handOver(ag) // free the port for the agent, keep recording

	c.log.Printf("sending started")
	go func() {
		defer close(done)
		err := ag.Run(ctx)
		c.sampler.release(ag)
		c.mu.Lock()
		if err != nil {
			c.lastErr = err.Error()
			c.log.Printf("agent stopped: %v", err)
		}
		c.running, c.cancel = nil, nil
		c.mu.Unlock()
		c.changed()
	}()
	c.changed()
}

// stop ends sending and waits until the last data reached the server.
func (c *controller) stop() {
	c.mu.Lock()
	cancel, done := c.cancel, c.done
	c.mu.Unlock()
	if cancel == nil {
		return
	}
	cancel()
	select {
	case <-done:
	case <-time.After(8 * time.Second):
	}
	c.log.Printf("sending stopped")
	c.changed()
}

func (c *controller) status() (agent.Status, bool) {
	c.mu.Lock()
	ag := c.running
	c.mu.Unlock()
	if ag == nil {
		return agent.Status{}, false
	}
	return ag.Status(), true
}

// beginPairing asks for a code, opens the pairing page with it filled in and
// waits for the player to confirm.
func (c *controller) beginPairing() {
	host, _ := os.Hostname()
	ctx, cancel := context.WithTimeout(context.Background(), 11*time.Minute)
	c.mu.Lock()
	server := c.cfg.Server
	c.pairStop = cancel
	c.mu.Unlock()

	go func() {
		defer cancel()
		start, err := pairing.Begin(ctx, server, pairing.Device{
			Name: host, OS: runtime.GOOS, Arch: runtime.GOARCH, BridgeVersion: version,
		})
		if err != nil {
			c.setError(fmt.Sprintf("No se pudo pedir un código: %v", err))
			return
		}
		c.mu.Lock()
		c.pairing = &start
		c.mu.Unlock()
		c.changed()
		c.log.Printf("pairing: showing code %s, waiting for confirmation", start.UserCode)
		c.openURL(start.VerificationURLComplete)

		last := ""
		res, err := pairing.WaitWith(ctx, server, start, func(status string, err error) {
			switch {
			case err != nil:
				c.log.Printf("pairing: poll failed: %v", err)
			case status != last:
				c.log.Printf("pairing: status %s", status)
				last = status
			}
		})
		c.mu.Lock()
		c.pairing = nil
		c.mu.Unlock()
		if err != nil {
			if ctx.Err() == nil {
				c.setError(fmt.Sprintf("La vinculación no se completó: %v", err))
			}
			c.changed()
			return
		}
		c.mu.Lock()
		c.cfg.Token, c.cfg.DeviceID = res.Token, res.DeviceID
		cfg := c.cfg
		c.mu.Unlock()
		if err := config.Save(cfg); err != nil {
			c.setError(fmt.Sprintf("Vinculada, pero no se pudo guardar: %v", err))
		}
		c.log.Printf("linked as device %d", res.DeviceID)
		c.loadAccount()
	}()
}

func (c *controller) cancelPairing() {
	c.mu.Lock()
	stop := c.pairStop
	c.pairing = nil
	c.mu.Unlock()
	if stop != nil {
		stop()
	}
	c.changed()
}

func (c *controller) unlink() {
	c.stopDemo()
	c.stop()
	c.mu.Lock()
	server, token := c.cfg.Server, c.cfg.Token
	c.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := pairing.Unlink(ctx, server, token); err != nil {
		c.log.Printf("unlinking on the server: %v (unlinking locally anyway)", err)
	}
	c.clearLink()
	c.changed()
}

func (c *controller) clearLink() {
	c.stopLive()
	c.mu.Lock()
	c.cfg.Token, c.cfg.DeviceID, c.email = "", 0, ""
	cfg := c.cfg
	c.mu.Unlock()
	if err := config.Save(cfg); err != nil {
		c.log.Printf("saving config: %v", err)
	}
}

// quit ends the app; main then stops sending and closes any sample.
func (c *controller) quit() {
	c.log.Printf("quit requested")
	c.app.Quit()
}

func (c *controller) devMode() bool {
	return c.app.Preferences().BoolWithFallback(prefDevMode, false)
}

// setDevMode turns development mode on (showing its tab) or off (finishing
// any recording, since its controls disappear). Called on the UI thread.
func (c *controller) setDevMode(on bool) {
	c.app.Preferences().SetBool(prefDevMode, on)
	if !on && c.sampler.recording() {
		go c.stopSample()
	}
	if c.window != nil {
		c.window.refreshDev()
		if on {
			c.window.tabs.Select(c.window.devTab)
			c.window.Show()
		}
	}
	c.changed()
}

// startSample records everything the game sends into a new sample file.
func (c *controller) startSample(note string) {
	c.mu.Lock()
	ag := c.running
	c.mu.Unlock()
	if err := c.sampler.start(ag, note); err != nil {
		c.setError(fmt.Sprintf("No se pudo empezar la grabación: %v", err))
		return
	}
	c.log.Printf("sample recording started")
	c.changed()
}

func (c *controller) stopSample() {
	path, err := c.sampler.stop()
	if err != nil {
		c.setError(fmt.Sprintf("La muestra se guardó con errores: %v", err))
	}
	if path != "" {
		c.log.Printf("sample saved to %s", path)
	}
	c.changed()
}

func (c *controller) openSamples() {
	dir, err := samplesDir()
	if err == nil {
		err = os.MkdirAll(dir, 0o755)
	}
	if err == nil {
		err = openFolder(dir)
	}
	if err != nil {
		c.setError(fmt.Sprintf("No se pudo abrir la carpeta de muestras: %v", err))
	}
}

func (c *controller) setError(msg string) {
	c.mu.Lock()
	c.lastErr = msg
	c.mu.Unlock()
	c.log.Print(msg)
	c.changed()
}

// openURL opens raw in the default browser without waiting for it: Fyne's
// OpenURL waits for rundll32 on Windows, which can hang and used to block
// pairing before it started polling.
func (c *controller) openURL(raw string) {
	u, err := url.Parse(raw)
	if err == nil && u.Scheme != "https" && u.Scheme != "http" {
		err = fmt.Errorf("not a web address")
	}
	if err == nil {
		err = openBrowser(u.String())
	}
	if err != nil {
		c.log.Printf("opening %s: %v", raw, err)
	}
}

// ticker refreshes the counters shown in the window and the menu.
func (c *controller) ticker() {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for range t.C {
		c.changed()
	}
}

// changed redraws the menu and the window on the UI thread.
func (c *controller) changed() {
	fyne.Do(func() {
		c.refreshMenu()
		if c.window != nil {
			c.window.refresh()
		}
	})
}

// headline is the one-line state shown in the menu and at the top of the window.
func (c *controller) headline() (text string, level int) {
	c.mu.Lock()
	linked, pairingNow, lastErr := c.cfg.Token != "", c.pairing != nil, c.lastErr
	c.mu.Unlock()
	st, running := c.status()
	switch {
	case pairingNow:
		return "Esperando que confirmes el código", 1
	case !linked:
		return strings.ToUpper(thisComputer()[:1]) + thisComputer()[1:] + " no está vinculada", 1
	case !running && lastErr != "":
		return "Detenido por un error", 2
	case !running:
		return "Envío detenido", 1
	case !st.Connected:
		return "Sin conexión con el servidor", 2
	case st.LastPacket.IsZero() || time.Since(st.LastPacket) > 5*time.Second:
		return "Conectado · esperando datos del juego", 1
	case st.HasReception:
		return fmt.Sprintf("Enviando · señal %.0f%%", st.Reception*100), 0
	default:
		return "Enviando", 0
	}
}

func (c *controller) refreshMenu() {
	if c.tray == nil {
		return
	}
	head, _ := c.headline()
	_, running := c.status()
	linked := c.linked()

	// Rebuilding the menu while it is open makes it flicker, so only rebuild
	// when its items change; otherwise just update the status line.
	dev, recording := c.devMode(), c.sampler.recording()
	shape := fmt.Sprintf("%v/%v/%v/%v/%v/%s", linked, running, dev, recording, c.demoRunning(), c.panelsShape())
	if shape == c.menuShape && c.menu != nil {
		if c.menuStatus.Label != head {
			c.menuStatus.Label = head
			c.menu.Refresh()
		}
		return
	}
	c.menuShape = shape
	c.menuStatus = fyne.NewMenuItem(head, nil)
	c.menuStatus.Disabled = true

	items := []*fyne.MenuItem{c.menuStatus, fyne.NewMenuItemSeparator()}
	switch {
	case linked && running:
		items = append(items, fyne.NewMenuItem("Detener envío", func() { go c.stop() }))
	case linked:
		items = append(items, fyne.NewMenuItem("Empezar a enviar", c.start))
	default:
		items = append(items, fyne.NewMenuItem("Vincular "+thisComputer()+"…", func() {
			c.window.Show()
			c.beginPairing()
		}))
	}
	items = append(items,
		fyne.NewMenuItem("Abrir dashboard", func() { c.openURL(dashboardURL) }),
		fyne.NewMenuItem("Mostrar ventana", func() { c.window.Show() }),
	)
	if item := c.panelsMenu(); item != nil {
		items = append(items, item)
	}
	if linked {
		if c.demoRunning() {
			items = append(items, fyne.NewMenuItem("Detener carrera de demostración", c.stopDemo))
		} else {
			items = append(items, fyne.NewMenuItem("Carrera de demostración", c.startDemo))
		}
	}
	items = append(items, fyne.NewMenuItem("Generar diagnóstico", c.diagnoseAndShow))
	items = append(items, fyne.NewMenuItemSeparator())
	devItem := fyne.NewMenuItem("Modo desarrollo", func() { c.setDevMode(!c.devMode()) })
	devItem.Checked = dev
	items = append(items, devItem)
	if dev {
		if recording {
			items = append(items, fyne.NewMenuItem("Detener grabación", func() { go c.stopSample() }))
		} else {
			items = append(items, fyne.NewMenuItem("Grabar muestra", func() { c.startSample(c.window.note.Text) }))
		}
		items = append(items, fyne.NewMenuItem("Abrir carpeta de muestras", c.openSamples))
	}
	quit := fyne.NewMenuItem("Cerrar Ingeniero Bridge", c.quit)
	quit.IsQuit = true // replaces the "Quit" item Fyne would add
	items = append(items, fyne.NewMenuItemSeparator(), quit)
	c.menu = fyne.NewMenu("Ingeniero", items...)
	c.tray.SetSystemTrayMenu(c.menu)
}

// openLog writes bridge-app.log in logDir() (and to stderr).
func openLog() *log.Logger {
	var w io.Writer = os.Stderr
	if dir, err := logDir(); err == nil {
		if os.MkdirAll(dir, 0o755) == nil {
			if f, err := os.OpenFile(filepath.Join(dir, "bridge-app.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
				w = io.MultiWriter(os.Stderr, f)
			}
		}
	}
	return log.New(w, "", log.LstdFlags)
}

// --- floating panels ----------------------------------------------------------

// setupPanels prepares the floating panels; on Windows they run for the app's life.
func (c *controller) setupPanels() {
	c.live, c.pedals = &overlay.Live{}, &overlay.Pedals{}
	var saved overlay.Settings
	if raw := c.app.Preferences().String(prefPanels); raw != "" {
		if err := json.Unmarshal([]byte(raw), &saved); err != nil {
			c.log.Printf("reading panel settings: %v", err)
		}
	}
	c.panels = overlay.NewManager(c.live, c.pedals, saved, func(s overlay.Settings) {
		if b, err := json.Marshal(s); err == nil {
			c.app.Preferences().SetString(prefPanels, string(b))
		}
		c.changed()
	})
	if !c.panels.Supported() {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	c.panelsStop = cancel
	go c.panels.Run(ctx)
}

func (c *controller) stopPanels() {
	c.stopLive()
	if c.panelsStop != nil {
		c.panelsStop()
	}
}

// startLive follows the account's live session for the panels.
func (c *controller) startLive() {
	if !c.panels.Supported() {
		return
	}
	c.mu.Lock()
	if c.liveStop != nil || c.cfg.Token == "" {
		c.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	c.liveStop = cancel
	server, token := c.cfg.Server, c.cfg.Token
	c.mu.Unlock()
	go c.live.Run(ctx, server, token, c.log.Printf)
}

func (c *controller) stopLive() {
	c.mu.Lock()
	stop := c.liveStop
	c.liveStop = nil
	c.mu.Unlock()
	if stop != nil {
		stop()
	}
}

// panelsShape changes whenever the panels submenu must be rebuilt.
func (c *controller) panelsShape() string {
	if !c.panels.Supported() {
		return ""
	}
	s := c.panels.Settings()
	out := fmt.Sprint(s.Locked)
	for _, p := range overlay.Panels {
		out += fmt.Sprint(s.Panels[p.ID].On)
	}
	return out
}

func (c *controller) panelsMenu() *fyne.MenuItem {
	if !c.panels.Supported() {
		return nil
	}
	s := c.panels.Settings()
	var items []*fyne.MenuItem
	for _, p := range overlay.Panels {
		id, on := p.ID, s.Panels[p.ID].On
		it := fyne.NewMenuItem(p.Label, func() { c.panels.SetPanel(id, !on) })
		it.Checked = on
		items = append(items, it)
	}
	lock := fyne.NewMenuItem("Bloquear para conducir (Ctrl+Alt+F10)", func() { c.panels.SetLocked(!s.Locked) })
	lock.Checked = s.Locked
	items = append(items, fyne.NewMenuItemSeparator(), lock,
		fyne.NewMenuItem("Restablecer posiciones", c.panels.ResetPositions))
	menu := fyne.NewMenuItem("Paneles flotantes", nil)
	menu.ChildMenu = fyne.NewMenu("", items...)
	return menu
}

// diagnoseAndShow writes the diagnostics zip and opens the folder that holds it.
func (c *controller) diagnoseAndShow() {
	path, err := c.diagnose()
	if err != nil {
		c.setError(fmt.Sprintf("No se pudo generar el diagnóstico: %v", err))
		return
	}
	if err := openFolder(filepath.Dir(path)); err != nil {
		c.log.Printf("opening %s: %v", filepath.Dir(path), err)
	}
	if c.window != nil {
		fyne.Do(func() { c.window.showDiagnosis(path) })
	}
}
