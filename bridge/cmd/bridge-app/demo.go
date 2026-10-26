package main

import (
	"bytes"
	"context"
	_ "embed"
	"fmt"
	"net"
	"time"

	"github.com/agumerca1994/race-engineer/bridge/internal/capture"
)

// The Madrid race fixture, cut to what the bridge forwards and with the long
// silences shortened: about nine minutes, enough to see every panel fill.
//
//go:embed demo/madrid.f1cap.zst
var demoCapture []byte

// startDemo plays the demo race into this app's own port, as if the game were
// running: the dashboard, the OBS overlays and the floating panels fill with it.
// It needs the game closed (or not sending), or both streams would mix.
func (c *controller) startDemo() {
	c.mu.Lock()
	if c.demoStop != nil {
		c.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	c.demoStop = cancel
	c.mu.Unlock()
	if _, running := c.status(); !running {
		c.start()
	}
	c.log.Printf("demo race started")
	c.changed()

	go func() {
		err := playDemo(ctx)
		c.mu.Lock()
		c.demoStop = nil
		c.mu.Unlock()
		switch {
		case ctx.Err() != nil:
			c.log.Printf("demo race stopped")
		case err != nil:
			c.setError(fmt.Sprintf("La carrera de demostración se cortó: %v", err))
		default:
			c.log.Printf("demo race finished")
		}
		c.changed()
	}()
}

func playDemo(ctx context.Context) error {
	r, err := capture.NewReader(bytes.NewReader(demoCapture), true)
	if err != nil {
		return err
	}
	defer r.Close()
	conn, err := net.Dial("udp", "127.0.0.1"+listenAddr)
	if err != nil {
		return err
	}
	defer conn.Close()
	// Give the agent a moment to open its port when the demo started it.
	select {
	case <-ctx.Done():
		return nil
	case <-time.After(time.Second):
	}
	_, err = capture.Replay(ctx, r, 1, func(b []byte) error {
		_, err := conn.Write(b)
		return err
	})
	if ctx.Err() != nil {
		return nil
	}
	return err
}

func (c *controller) stopDemo() {
	c.mu.Lock()
	stop := c.demoStop
	c.mu.Unlock()
	if stop != nil {
		stop()
	}
}

func (c *controller) demoRunning() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.demoStop != nil
}
