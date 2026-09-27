// Package agent is the bridge's main loop: receive the game's UDP telemetry,
// filter it and upload it. Both the command line (`bridge run`) and the Mac app
// drive it, so they behave the same.
package agent

import (
	"context"
	"errors"
	"fmt"
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/agumerca1994/race-engineer/bridge/internal/capture"
	"github.com/agumerca1994/race-engineer/bridge/internal/doctor"
	"github.com/agumerca1994/race-engineer/bridge/internal/header"
	"github.com/agumerca1994/race-engineer/bridge/internal/throttle"
	"github.com/agumerca1994/race-engineer/bridge/internal/udp"
	"github.com/agumerca1994/race-engineer/bridge/internal/uplink"
)

// Config says where to listen and where to send.
type Config struct {
	Listen   string // UDP address, for example ":20777"
	Server   string // API base URL
	Token    string // device token (rbd_...)
	RecordTo string // optional capture file for everything received
	Version  string
	Logf     func(format string, args ...any)
}

// Status is a snapshot of what the agent is doing, safe to read at any time.
type Status struct {
	Running      bool
	Connected    bool
	Received     int64
	Forwarded    int64
	Sent         int64
	Reception    float64
	HasReception bool
	Source       string
	LastPacket   time.Time
}

// Agent runs one listen-and-upload loop at a time.
type Agent struct {
	cfg Config

	mu        sync.Mutex
	running   bool
	received  int64
	forwarded int64
	source    string
	last      time.Time
	window    *doctor.ReceptionWindow
	client    *uplink.Client
}

// New returns an idle agent.
func New(cfg Config) *Agent {
	if cfg.Logf == nil {
		cfg.Logf = func(string, ...any) {}
	}
	return &Agent{cfg: cfg}
}

// Status reports the current counters.
func (a *Agent) Status() Status {
	a.mu.Lock()
	defer a.mu.Unlock()
	s := Status{
		Running:    a.running,
		Received:   a.received,
		Forwarded:  a.forwarded,
		Source:     a.source,
		LastPacket: a.last,
	}
	if a.client != nil {
		s.Connected = a.client.Counters.Connected.Load()
		s.Sent = a.client.Counters.Sent.Load()
	}
	if a.window != nil {
		s.Reception, s.HasReception = a.window.Estimate()
	}
	return s
}

// Run listens and uploads until ctx ends, then flushes the last data to the
// server and returns.
func (a *Agent) Run(ctx context.Context) error {
	cfg := a.cfg
	if cfg.Token == "" {
		return errors.New("this bridge is not linked to an account yet")
	}
	client, err := uplink.New(cfg.Server, cfg.Token)
	if err != nil {
		return err
	}
	client.Hello = map[string]string{"bridge_version": cfg.Version, "os": runtime.GOOS, "arch": runtime.GOARCH}
	client.Logf = cfg.Logf

	var rec *capture.Writer
	if cfg.RecordTo != "" {
		host, _ := os.Hostname()
		if rec, err = capture.Create(cfg.RecordTo, capture.Meta{
			BridgeVersion: cfg.Version, Host: host, ListenAddr: cfg.Listen, StartedAt: time.Now().UTC(), Note: "recorded by the bridge",
		}); err != nil {
			return err
		}
	}

	conn, err := udp.Listen(cfg.Listen)
	if err != nil {
		if rec != nil {
			rec.Close()
		}
		return fmt.Errorf("cannot listen on %s (is another telemetry app using the port?): %w", cfg.Listen, err)
	}

	filter := throttle.New()
	a.mu.Lock()
	a.running, a.client = true, client
	a.received, a.forwarded, a.source, a.last = 0, 0, "", time.Time{}
	a.window = doctor.NewReceptionWindow(200)
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		a.running = false
		a.mu.Unlock()
	}()

	client.Heartbeat = func() map[string]any {
		s := a.Status()
		hb := map[string]any{"received": s.Received, "forwarded": s.Forwarded, "source": s.Source,
			"dropped_batches": client.Counters.DroppedBatches.Load()}
		if s.HasReception {
			hb["reception"] = s.Reception
		}
		return hb
	}

	uploadDone := make(chan error, 1)
	uploadCtx, stopUpload := context.WithCancel(context.Background())
	go func() { uploadDone <- client.Run(uploadCtx) }()
	go func() { <-ctx.Done(); conn.Close() }()

	var recErr error
	recvErr := udp.Receive(conn, func(d udp.Datagram) {
		h, perr := header.Parse(d.Data)
		a.mu.Lock()
		a.received++
		a.source = d.From.IP.String()
		a.last = d.At
		if rec != nil && recErr == nil {
			recErr = rec.Write(d.At, d.Data)
		}
		allow := false
		if perr == nil {
			if h.PacketID == 6 {
				a.window.Add(h.FrameIdentifier)
			}
			if allow = filter.Allow(h, d.Data, d.At); allow {
				a.forwarded++
			}
		}
		a.mu.Unlock()
		if allow {
			client.Enqueue(d.At, d.Data)
		}
	})

	stopUpload()
	upErr := <-uploadDone
	var closeErr error
	if rec != nil {
		closeErr = rec.Close()
	}
	return errors.Join(recvErr, upErr, recErr, closeErr)
}
