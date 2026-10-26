package main

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"os/user"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/agumerca1994/race-engineer/bridge/internal/doctor"
	"github.com/agumerca1994/race-engineer/bridge/internal/udp"
)

const diagnoseLogBytes = 2 << 20 // the end of the log is what explains a recent problem

// diagnose writes a zip with a summary and the end of the log to the Downloads
// folder, for the player to send. The token never goes in it, and the user's
// name and home folder are replaced so paths do not identify them.
func (c *controller) diagnose() (string, error) {
	dir, err := downloadsDir()
	if err != nil {
		return "", err
	}
	path := filepath.Join(dir, "diagnostico-ingeniero-"+time.Now().Format("2006-01-02-1504")+".zip")
	f, err := os.Create(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	z := zip.NewWriter(f)

	w, err := z.Create("resumen.txt")
	if err != nil {
		return "", err
	}
	io.WriteString(w, scrub(c.summary()))

	if logs, err := logDir(); err == nil {
		if tail, err := readTail(filepath.Join(logs, "bridge-app.log"), diagnoseLogBytes); err == nil {
			if w, err := z.Create("bridge-app.log"); err == nil {
				io.WriteString(w, scrub(tail))
			}
		}
	}
	if err := z.Close(); err != nil {
		return "", err
	}
	c.log.Printf("diagnostics written")
	return path, nil
}

func (c *controller) summary() string {
	var b strings.Builder
	line := func(format string, args ...any) { fmt.Fprintf(&b, format+"\n", args...) }
	head, _ := c.headline()
	c.mu.Lock()
	cfg, lastErr := c.cfg, c.lastErr
	c.mu.Unlock()

	line("Ingeniero Bridge %s · %s/%s · %s", version, runtime.GOOS, runtime.GOARCH, time.Now().Format(time.RFC3339))
	line("Estado: %s", head)
	if lastErr != "" {
		line("Último error: %s", lastErr)
	}
	line("Servidor: %s", cfg.Server)
	line("Vinculada: %v (dispositivo %d)", cfg.Token != "", cfg.DeviceID)
	line("Envío automático: %v · modo desarrollo: %v", c.app.Preferences().BoolWithFallback(prefAutoSend, true), c.devMode())
	if st, running := c.status(); running {
		line("Escuchando en %s · conectado al servidor: %v", listenAddr, st.Connected)
		line("Recibidos %d · reenviados %d · enviados %d", st.Received, st.Forwarded, st.Sent)
		if st.HasReception {
			line("Señal: %.0f%%", st.Reception*100)
		}
		if !st.LastPacket.IsZero() {
			line("Último paquete hace %s desde %s", time.Since(st.LastPacket).Round(time.Second), st.Source)
		}
	} else {
		line("Envío detenido")
	}
	var lan []string
	for name, ips := range udp.LANAddresses() {
		lan = append(lan, fmt.Sprintf("%s (%s)", strings.Join(ips, ", "), name))
	}
	sort.Strings(lan)
	line("IPs de esta computadora: %s", strings.Join(lan, "; "))
	line("Firewall: %s", doctor.FirewallStatus())
	if c.panels.Supported() {
		s := c.panels.Settings()
		var on []string
		for id, p := range s.Panels {
			if p.On {
				on = append(on, string(id))
			}
		}
		sort.Strings(on)
		line("Paneles flotantes: %s · bloqueados: %v · conectados al vivo: %v", strings.Join(on, ", "), s.Locked, c.live.Connected())
	}
	return b.String()
}

// scrub hides the user's name and home folder.
func scrub(s string) string {
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		s = strings.ReplaceAll(s, home, "~")
	}
	if u, err := user.Current(); err == nil {
		name := u.Username
		if i := strings.LastIndexAny(name, `\/`); i >= 0 {
			name = name[i+1:] // DOMAIN\user on Windows
		}
		if len(name) >= 3 {
			s = strings.ReplaceAll(s, name, "<usuario>")
		}
	}
	if host, err := os.Hostname(); err == nil && len(host) >= 3 {
		s = strings.ReplaceAll(s, host, "<equipo>")
	}
	return s
}

func readTail(path string, n int64) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return "", err
	}
	if info.Size() > n {
		if _, err := f.Seek(-n, io.SeekEnd); err != nil {
			return "", err
		}
	}
	b, err := io.ReadAll(f)
	return string(b), err
}

func downloadsDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, "Downloads")
	if _, err := os.Stat(dir); err != nil {
		return home, nil
	}
	return dir, nil
}
