package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/agumerca1994/race-engineer/bridge/internal/capture"
	"github.com/agumerca1994/race-engineer/bridge/internal/config"
	"github.com/agumerca1994/race-engineer/bridge/internal/doctor"
	"github.com/agumerca1994/race-engineer/bridge/internal/header"
	"github.com/agumerca1994/race-engineer/bridge/internal/pairing"
	"github.com/agumerca1994/race-engineer/bridge/internal/throttle"
	"github.com/agumerca1994/race-engineer/bridge/internal/udp"
	"github.com/agumerca1994/race-engineer/bridge/internal/uplink"
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

	client, err := uplink.New(*server, cfg.Token)
	if err != nil {
		return err
	}
	client.Hello = map[string]string{"bridge_version": version, "os": runtime.GOOS, "arch": runtime.GOARCH}
	client.Logf = func(format string, a ...any) {
		fmt.Fprintf(os.Stderr, "\n%s  %s\n", time.Now().Format("15:04:05"), fmt.Sprintf(format, a...))
	}

	var rec *capture.Writer
	if *recordTo != "" {
		host, _ := os.Hostname()
		if rec, err = capture.Create(*recordTo, capture.Meta{
			BridgeVersion: version, Host: host, ListenAddr: *listen, StartedAt: time.Now().UTC(), Note: "recorded by bridge run",
		}); err != nil {
			return err
		}
	}

	conn, err := udp.Listen(*listen)
	if err != nil {
		return fmt.Errorf("cannot listen on %s (is another telemetry app using the port?): %w", *listen, err)
	}

	// Shared between the UDP reader and the heartbeat.
	var mu sync.Mutex
	window := doctor.NewReceptionWindow(200)
	filter := throttle.New()
	var received, forwarded, rejected int64
	var source string

	client.Heartbeat = func() map[string]any {
		mu.Lock()
		defer mu.Unlock()
		hb := map[string]any{"received": received, "forwarded": forwarded, "source": source,
			"dropped_batches": client.Counters.DroppedBatches.Load()}
		if r, ok := window.Estimate(); ok {
			hb["reception"] = r
		}
		return hb
	}

	uploadDone := make(chan error, 1)
	uploadCtx, stopUpload := context.WithCancel(context.Background())
	go func() { uploadDone <- client.Run(uploadCtx) }()

	go func() { <-ctx.Done(); conn.Close() }()
	go statusLine(ctx, client, &mu, &received, &forwarded, window)

	fmt.Fprintf(os.Stderr, "Listening for telemetry on %s and sending it to %s — press Ctrl+C to stop\n", *listen, *server)
	var recErr error
	recvErr := udp.Receive(conn, func(d udp.Datagram) {
		h, err := header.Parse(d.Data)
		mu.Lock()
		received++
		source = d.From.IP.String()
		if rec != nil && recErr == nil {
			recErr = rec.Write(d.At, d.Data)
		}
		if err != nil {
			rejected++
			mu.Unlock()
			return
		}
		if h.PacketID == 6 {
			window.Add(h.FrameIdentifier)
		}
		allow := filter.Allow(h, d.Data, d.At)
		if allow {
			forwarded++
		}
		mu.Unlock()
		if allow {
			client.Enqueue(d.At, d.Data)
		}
	})

	fmt.Fprintln(os.Stderr, "\nStopping: sending the last data to the server...")
	stopUpload()
	upErr := <-uploadDone
	var closeErr error
	if rec != nil {
		closeErr = rec.Close()
	}
	fmt.Fprintf(os.Stderr, "Received %d datagrams, forwarded %d, sent %d.\n", received, forwarded, client.Counters.Sent.Load())
	return errors.Join(recvErr, upErr, recErr, closeErr)
}

func statusLine(ctx context.Context, c *uplink.Client, mu *sync.Mutex, received, forwarded *int64, w *doctor.ReceptionWindow) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			mu.Lock()
			state := "offline"
			if c.Counters.Connected.Load() {
				state = "online"
			}
			recep := "—"
			if r, ok := w.Estimate(); ok {
				recep = fmt.Sprintf("%.0f%%", r*100)
			}
			fmt.Fprintf(os.Stderr, "\r%s | received %d | forwarded %d | sent %d | reception %s   ",
				state, *received, *forwarded, c.Counters.Sent.Load(), recep)
			mu.Unlock()
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
