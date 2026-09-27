package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"runtime"
	"time"

	"github.com/agumerca1994/race-engineer/bridge/internal/agent"
	"github.com/agumerca1994/race-engineer/bridge/internal/config"
	"github.com/agumerca1994/race-engineer/bridge/internal/pairing"
)

func cmdPair(ctx context.Context, args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	fs := flag.NewFlagSet("pair", flag.ExitOnError)
	server := fs.String("server", firstNonEmpty(cfg.Server, config.DefaultServer), "API base URL")
	fs.Parse(args)

	host, _ := os.Hostname()
	start, err := pairing.Begin(ctx, *server, pairing.Device{
		Name: host, OS: runtime.GOOS, Arch: runtime.GOARCH, BridgeVersion: version,
	})
	if err != nil {
		return err
	}
	fmt.Printf(`
To link this bridge to your account, open:

    %s

and enter the code:

    %s

(the code is valid for %d minutes)
Waiting for confirmation...
`, start.VerificationURL, start.UserCode, start.ExpiresIn/60)

	res, err := pairing.Wait(ctx, *server, start)
	if err != nil {
		return err
	}
	cfg.Server, cfg.Token, cfg.DeviceID = *server, res.Token, res.DeviceID
	if err := config.Save(cfg); err != nil {
		return fmt.Errorf("linked, but could not save the token: %w", err)
	}
	path, _ := config.Path()
	fmt.Printf("\nDone: this bridge is linked (device %d). Settings saved to %s\nNow run: bridge run\n", res.DeviceID, path)
	return nil
}

func cmdUnpair(ctx context.Context, args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if cfg.Token == "" {
		fmt.Println("This bridge is not linked to any account.")
		return nil
	}
	if err := pairing.Unlink(ctx, cfg.Server, cfg.Token); err != nil {
		fmt.Fprintf(os.Stderr, "Warning: could not tell the server (%v); unlinking locally anyway.\n", err)
	}
	cfg.Token, cfg.DeviceID = "", 0
	if err := config.Save(cfg); err != nil {
		return err
	}
	fmt.Println("Done: this bridge is no longer linked.")
	return nil
}

func cmdRun(ctx context.Context, args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	fs := flag.NewFlagSet("run", flag.ExitOnError)
	listen := fs.String("listen", defaultListen, "UDP address to listen on")
	server := fs.String("server", firstNonEmpty(cfg.Server, config.DefaultServer), "API base URL")
	recordTo := fs.String("record", "", "also record everything received to this capture file")
	fs.Parse(args)
	if cfg.Token == "" {
		return errors.New("this bridge is not linked to an account yet: run `bridge pair` first")
	}

	a := agent.New(agent.Config{
		Listen: *listen, Server: *server, Token: cfg.Token, RecordTo: *recordTo, Version: version,
		Logf: func(format string, args ...any) {
			fmt.Fprintf(os.Stderr, "\n%s  %s\n", time.Now().Format("15:04:05"), fmt.Sprintf(format, args...))
		},
	})
	go statusLine(ctx, a)

	fmt.Fprintf(os.Stderr, "Listening for telemetry on %s and sending it to %s — press Ctrl+C to stop\n", *listen, *server)
	err = a.Run(ctx)
	s := a.Status()
	fmt.Fprintf(os.Stderr, "\nStopped. Received %d datagrams, forwarded %d, sent %d.\n", s.Received, s.Forwarded, s.Sent)
	return err
}

func statusLine(ctx context.Context, a *agent.Agent) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s := a.Status()
			state := "offline"
			if s.Connected {
				state = "online"
			}
			recep := "—"
			if s.HasReception {
				recep = fmt.Sprintf("%.0f%%", s.Reception*100)
			}
			fmt.Fprintf(os.Stderr, "\r%s | received %d | forwarded %d | sent %d | reception %s   ",
				state, s.Received, s.Forwarded, s.Sent, recep)
		}
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
