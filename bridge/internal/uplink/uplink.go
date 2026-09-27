// Package uplink sends telemetry to the server over a WebSocket.
//
// Datagrams are grouped into 100 ms batches, zstd-compressed and sent as binary
// messages (see backend/app/ingest/protocol.py for the format). The client
// reconnects on its own with backoff and keeps up to MaxQueuedBatches while
// offline, dropping the oldest first: live data loses value quickly.
package uplink

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/klauspost/compress/zstd"
)

const (
	BatchInterval     = 100 * time.Millisecond
	HeartbeatInterval = 5 * time.Second
	MaxQueuedBatches  = 300 // about 30 s of telemetry while offline
	maxBackoff        = 30 * time.Second
)

// Counters are safe to read while the client runs.
type Counters struct {
	Queued         atomic.Int64 // datagrams handed to the client
	Sent           atomic.Int64 // datagrams sent to the server
	DroppedBatches atomic.Int64 // batches discarded while offline
	Connected      atomic.Bool
}

type record struct {
	at   time.Time
	data []byte
}

// Client uploads telemetry for one paired device.
type Client struct {
	URL       string            // wss://host/ingest/v1
	Token     string            // rbd_...
	Hello     map[string]string // bridge_version, os, arch
	Heartbeat func() map[string]any
	Logf      func(format string, args ...any)
	Counters  Counters

	in     chan record
	mu     sync.Mutex
	queue  [][]byte // compressed batches waiting to be sent
	counts []int    // datagrams in each queued batch
	wake   chan struct{}
	enc    *zstd.Encoder
}

// New returns a client for server (an http(s) base URL) and a device token.
func New(server, token string) (*Client, error) {
	enc, err := zstd.NewWriter(nil, zstd.WithEncoderLevel(zstd.SpeedDefault))
	if err != nil {
		return nil, err
	}
	u := strings.TrimRight(server, "/")
	switch {
	case strings.HasPrefix(u, "https://"):
		u = "wss://" + strings.TrimPrefix(u, "https://")
	case strings.HasPrefix(u, "http://"):
		u = "ws://" + strings.TrimPrefix(u, "http://")
	}
	return &Client{
		URL:   u + "/ingest/v1",
		Token: token,
		Logf:  func(string, ...any) {},
		in:    make(chan record, 4096),
		wake:  make(chan struct{}, 1),
		enc:   enc,
	}, nil
}

// Enqueue hands a datagram to the client without blocking.
func (c *Client) Enqueue(at time.Time, data []byte) {
	select {
	case c.in <- record{at, data}:
		c.Counters.Queued.Add(1)
	default: // the batcher is far behind; losing a datagram beats blocking the UDP reader
	}
}

// Run batches and sends until ctx ends, then flushes, says goodbye and returns.
func (c *Client) Run(ctx context.Context) error {
	batcherDone := make(chan struct{})
	go func() {
		c.batch(ctx)
		close(batcherDone)
	}()

	backoff := time.Second
	for {
		err := c.session(ctx, batcherDone)
		if err == nil {
			return nil // clean shutdown
		}
		c.Counters.Connected.Store(false)
		if ctx.Err() != nil {
			return nil
		}
		c.Logf("disconnected from the server (%v); retrying in %s", err, backoff)
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, maxBackoff)
	}
}

// batch groups incoming datagrams into compressed batches.
func (c *Client) batch(ctx context.Context) {
	ticker := time.NewTicker(BatchInterval)
	defer ticker.Stop()
	var pending []record
	flush := func() {
		if len(pending) == 0 {
			return
		}
		c.push(c.encode(pending), len(pending))
		pending = pending[:0]
	}
	for {
		select {
		case r := <-c.in:
			pending = append(pending, r)
		case <-ticker.C:
			flush()
		case <-ctx.Done():
			for { // drain what is already queued
				select {
				case r := <-c.in:
					pending = append(pending, r)
				default:
					flush()
					return
				}
			}
		}
	}
}

func (c *Client) encode(recs []record) []byte {
	size := 0
	for _, r := range recs {
		size += 10 + len(r.data)
	}
	raw := make([]byte, 0, size)
	var hdr [10]byte
	for _, r := range recs {
		binary.LittleEndian.PutUint64(hdr[0:8], uint64(r.at.UnixNano()))
		binary.LittleEndian.PutUint16(hdr[8:10], uint16(len(r.data)))
		raw = append(raw, hdr[:]...)
		raw = append(raw, r.data...)
	}
	return c.enc.EncodeAll(raw, nil)
}

func (c *Client) push(batch []byte, n int) {
	c.mu.Lock()
	if len(c.queue) >= MaxQueuedBatches {
		c.queue, c.counts = c.queue[1:], c.counts[1:]
		c.Counters.DroppedBatches.Add(1)
	}
	c.queue = append(c.queue, batch)
	c.counts = append(c.counts, n)
	c.mu.Unlock()
	select {
	case c.wake <- struct{}{}:
	default:
	}
}

func (c *Client) pop() ([]byte, int, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.queue) == 0 {
		return nil, 0, false
	}
	b, n := c.queue[0], c.counts[0]
	c.queue, c.counts = c.queue[1:], c.counts[1:]
	return b, n, true
}

func (c *Client) unpop(b []byte, n int) {
	c.mu.Lock()
	c.queue = append([][]byte{b}, c.queue...)
	c.counts = append([]int{n}, c.counts...)
	c.mu.Unlock()
}

// session runs one WebSocket connection. It returns nil only after a clean goodbye.
func (c *Client) session(ctx context.Context, batcherDone <-chan struct{}) error {
	dialCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	conn, resp, err := websocket.Dial(dialCtx, c.URL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": {"Bearer " + c.Token}},
	})
	if err != nil {
		if resp != nil && resp.StatusCode == http.StatusForbidden {
			return fmt.Errorf("the server rejected this bridge's token; run `bridge pair` again")
		}
		return err
	}
	defer conn.CloseNow()
	conn.SetReadLimit(1 << 20)

	// Messages from the server arrive on a channel so writes never block on reads.
	texts := make(chan map[string]any, 8)
	readErr := make(chan error, 1)
	go func() {
		for {
			_, b, err := conn.Read(context.Background())
			if err != nil {
				readErr <- err
				return
			}
			var m map[string]any
			if json.Unmarshal(b, &m) == nil {
				select {
				case texts <- m:
				default: // nobody is listening any more
				}
			}
		}
	}()

	select {
	case m := <-texts:
		if m["type"] != "welcome" {
			return fmt.Errorf("unexpected greeting %v", m)
		}
	case err := <-readErr:
		var ce websocket.CloseError
		if errors.As(err, &ce) && ce.Code == websocket.StatusPolicyViolation {
			return fmt.Errorf("the server rejected this bridge's token (%s); run `bridge pair` again", ce.Reason)
		}
		return err
	case <-time.After(10 * time.Second):
		return errors.New("the server did not greet the bridge")
	}
	c.Counters.Connected.Store(true)
	c.Logf("connected to %s", c.URL)

	hello := map[string]any{"type": "hello"}
	for k, v := range c.Hello {
		hello[k] = v
	}
	if err := c.writeJSON(ctx, conn, hello); err != nil {
		return err
	}

	heartbeat := time.NewTicker(HeartbeatInterval)
	defer heartbeat.Stop()
	for {
		if err := c.drain(ctx, conn); err != nil {
			return err
		}
		select {
		case <-c.wake:
		case <-heartbeat.C:
			if c.Heartbeat != nil {
				hb := c.Heartbeat()
				hb["type"] = "heartbeat"
				if err := c.writeJSON(ctx, conn, hb); err != nil {
					return err
				}
			}
		case err := <-readErr:
			return err
		case <-ctx.Done():
			return c.goodbye(conn, batcherDone, texts, readErr)
		}
	}
}

// drain sends every queued batch.
func (c *Client) drain(ctx context.Context, conn *websocket.Conn) error {
	for {
		b, n, ok := c.pop()
		if !ok {
			return nil
		}
		wctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		err := conn.Write(wctx, websocket.MessageBinary, b)
		cancel()
		if err != nil {
			c.unpop(b, n)
			return err
		}
		c.Counters.Sent.Add(int64(n))
	}
}

// goodbye flushes the last batches and waits for the server to confirm it saved them.
func (c *Client) goodbye(conn *websocket.Conn, batcherDone <-chan struct{}, texts <-chan map[string]any, readErr <-chan error) error {
	select {
	case <-batcherDone:
	case <-time.After(time.Second):
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := c.drain(ctx, conn); err != nil {
		return nil // shutting down anyway
	}
	if err := c.writeJSON(ctx, conn, map[string]any{"type": "bye"}); err != nil {
		return nil
	}
	for {
		select {
		case m := <-texts:
			if m["type"] == "goodbye" {
				conn.Close(websocket.StatusNormalClosure, "bye")
				return nil
			}
		case <-readErr:
			return nil
		case <-ctx.Done():
			return nil
		}
	}
}

func (c *Client) writeJSON(ctx context.Context, conn *websocket.Conn, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	wctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	return conn.Write(wctx, websocket.MessageText, b)
}
