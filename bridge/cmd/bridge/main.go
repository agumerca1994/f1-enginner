// Command bridge receives the F1 24 UDP telemetry on the local network.
//
// pair and run connect it to the server; record, replay, inspect, compare,
// synth and doctor are local tools for captures and troubleshooting.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/agumerca1994/race-engineer/bridge/internal/capture"
	"github.com/agumerca1994/race-engineer/bridge/internal/doctor"
	"github.com/agumerca1994/race-engineer/bridge/internal/udp"
)

var version = "dev"

const defaultListen = ":20777"

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cmds := map[string]func(context.Context, []string) error{
		"pair":    cmdPair,
		"run":     cmdRun,
		"record":  cmdRecord,
		"replay":  cmdReplay,
		"inspect": cmdInspect,
		"compare": cmdCompare,
		"synth":   cmdSynth,
		"doctor":  cmdDoctor,
		"version": func(context.Context, []string) error { fmt.Println(version); return nil },
	}
	cmd, ok := cmds[os.Args[1]]
	if !ok {
		usage()
		os.Exit(2)
	}
	if err := cmd(ctx, os.Args[2:]); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `bridge — F1 24 telemetry bridge

Usage:
  bridge pair    [--server URL]                        link this bridge to your account (once)
  bridge run     [--listen :20777] [--record FILE]     send the game's telemetry to the server
  bridge doctor  [--listen :20777] [--seconds 15]     check that telemetry reaches this computer
  bridge record  --out FILE [--listen :20777] [--duration 0] [--note TEXT]
  bridge replay  --in FILE [--to 127.0.0.1:20777] [--speed 1]
  bridge inspect --in FILE                             summarize a capture
  bridge compare A B [--tolerance 5ms]                 check two captures hold the same stream
  bridge synth   --out FILE [--seconds 60] [--rate 20] generate a synthetic capture
  bridge version

Captures ending in .zst are zstd-compressed (recommended: session.f1cap.zst).
`)
}

func cmdRecord(ctx context.Context, args []string) error {
	fs := flag.NewFlagSet("record", flag.ExitOnError)
	out := fs.String("out", "", "capture file to write (.f1cap or .f1cap.zst)")
	listen := fs.String("listen", defaultListen, "UDP address to listen on")
	duration := fs.Duration("duration", 0, "stop after this long (0 = until Ctrl+C)")
	note := fs.String("note", "", "free-text note stored in the capture")
	fs.Parse(args)
	if *out == "" {
		return errors.New("--out is required")
	}

	conn, err := udp.Listen(*listen)
	if err != nil {
		return err
	}
	host, _ := os.Hostname()
	w, err := capture.Create(*out, capture.Meta{
		BridgeVersion: version, Host: host, ListenAddr: *listen, StartedAt: time.Now().UTC(), Note: *note,
	})
	if err != nil {
		conn.Close()
		return err
	}

	if *duration > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, *duration)
		defer cancel()
	}
	go func() { <-ctx.Done(); conn.Close() }()

	stats := doctor.NewStats()
	var mu sync.Mutex
	var writeErr error
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	go func() {
		for range ticker.C {
			mu.Lock()
			fmt.Fprintf(os.Stderr, "\r%d datagrams recorded", w.Count())
			mu.Unlock()
		}
	}()

	fmt.Fprintf(os.Stderr, "Recording telemetry on %s into %s — press Ctrl+C to stop\n", *listen, *out)
	recvErr := udp.Receive(conn, func(d udp.Datagram) {
		mu.Lock()
		defer mu.Unlock()
		if writeErr != nil {
			return
		}
		if writeErr = w.Write(d.At, d.Data); writeErr != nil {
			conn.Close()
		}
		stats.Add(d.At, d.From.IP.String(), d.Data)
	})
	mu.Lock()
	defer mu.Unlock()
	closeErr := w.Close()
	fmt.Fprintln(os.Stderr)
	stats.Print(os.Stdout)
	return errors.Join(recvErr, writeErr, closeErr)
}

func cmdReplay(ctx context.Context, args []string) error {
	fs := flag.NewFlagSet("replay", flag.ExitOnError)
	in := fs.String("in", "", "capture file to replay")
	to := fs.String("to", "127.0.0.1:20777", "UDP address to send to")
	speed := fs.Float64("speed", 1, "playback speed (2 = twice as fast, 0 = as fast as possible)")
	fs.Parse(args)
	if *in == "" {
		return errors.New("--in is required")
	}
	r, err := capture.Open(*in)
	if err != nil {
		return err
	}
	defer r.Close()
	conn, err := udp.Dial(*to)
	if err != nil {
		return err
	}
	defer conn.Close()

	fmt.Fprintf(os.Stderr, "Replaying %s to %s at %gx\n", *in, *to, *speed)
	start := time.Now()
	n, err := capture.Replay(ctx, r, *speed, func(b []byte) error {
		_, err := conn.Write(b)
		return err
	})
	fmt.Fprintf(os.Stderr, "Sent %d datagrams in %s\n", n, time.Since(start).Round(time.Millisecond))
	if errors.Is(err, context.Canceled) {
		return nil
	}
	return err
}

func cmdInspect(_ context.Context, args []string) error {
	fs := flag.NewFlagSet("inspect", flag.ExitOnError)
	in := fs.String("in", "", "capture file to inspect")
	fs.Parse(args)
	if *in == "" {
		return errors.New("--in is required")
	}
	r, err := capture.Open(*in)
	if err != nil {
		return err
	}
	defer r.Close()
	fmt.Printf("Capture: %s\nRecorded: %s on %s (bridge %s)\n", *in, r.Meta.StartedAt.Format(time.RFC3339), r.Meta.Host, r.Meta.BridgeVersion)
	if r.Meta.Note != "" {
		fmt.Printf("Note: %s\n", r.Meta.Note)
	}
	stats := doctor.NewStats()
	base := time.Unix(0, 0)
	for {
		rec, err := r.Next()
		if err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			return err
		}
		stats.Add(base.Add(rec.Offset), "", rec.Data)
	}
	stats.Print(os.Stdout)
	return nil
}

func cmdCompare(_ context.Context, args []string) error {
	fs := flag.NewFlagSet("compare", flag.ExitOnError)
	tol := fs.Duration("tolerance", 5*time.Millisecond, "maximum allowed timing difference per datagram")
	fs.Parse(reorder(args))
	if fs.NArg() != 2 {
		return errors.New("compare needs two capture files")
	}
	a, err := capture.Open(fs.Arg(0))
	if err != nil {
		return err
	}
	defer a.Close()
	b, err := capture.Open(fs.Arg(1))
	if err != nil {
		return err
	}
	defer b.Close()
	c, err := capture.Compare(a, b, *tol)
	if err != nil {
		return err
	}
	fmt.Println(c)
	if !c.OK() {
		return errors.New("captures differ")
	}
	fmt.Println("OK: same datagrams, same order, timing within tolerance")
	return nil
}

func cmdSynth(_ context.Context, args []string) error {
	fs := flag.NewFlagSet("synth", flag.ExitOnError)
	out := fs.String("out", "", "capture file to write")
	seconds := fs.Int("seconds", 60, "length of the synthetic session")
	rate := fs.Int("rate", 20, "game send rate in Hz")
	fs.Parse(args)
	if *out == "" {
		return errors.New("--out is required")
	}
	w, err := capture.Create(*out, capture.Meta{
		BridgeVersion: version, Host: "synthetic", StartedAt: time.Now().UTC(),
		Note: fmt.Sprintf("synthetic %ds at %dHz, zero-filled bodies", *seconds, *rate),
	})
	if err != nil {
		return err
	}
	if err := capture.Synthesize(w, time.Duration(*seconds)*time.Second, *rate); err != nil {
		w.Close()
		return err
	}
	fmt.Printf("Wrote %d datagrams to %s\n", w.Count(), *out)
	return w.Close()
}

func cmdDoctor(ctx context.Context, args []string) error {
	fs := flag.NewFlagSet("doctor", flag.ExitOnError)
	listen := fs.String("listen", defaultListen, "UDP address to listen on")
	seconds := fs.Int("seconds", 15, "how long to wait for telemetry")
	fs.Parse(args)

	fmt.Println("Network addresses of this computer (set one of these as the UDP IP in the game, or use broadcast mode):")
	addrs := udp.LANAddresses()
	names := make([]string, 0, len(addrs))
	for n := range addrs {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		fmt.Printf("  %-8s %s\n", n, strings.Join(addrs[n], ", "))
	}
	fmt.Println("Firewall:", doctor.FirewallStatus())

	conn, err := udp.Listen(*listen)
	if err != nil {
		return fmt.Errorf("cannot listen on %s (is another telemetry app using the port?): %w", *listen, err)
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(*seconds)*time.Second)
	defer cancel()
	go func() { <-ctx.Done(); conn.Close() }()

	fmt.Printf("\nListening on %s for %ds — drive or sit in the garage so the game sends data...\n", *listen, *seconds)
	stats := doctor.NewStats()
	if err := udp.Receive(conn, func(d udp.Datagram) { stats.Add(d.At, d.From.IP.String(), d.Data) }); err != nil {
		return err
	}
	fmt.Println()
	if stats.Total == 0 {
		fmt.Print(`No telemetry received. Check, in F1 24 > Settings > Telemetry Settings:
  - UDP Telemetry: On
  - UDP Broadcast Mode: On, or UDP IP Address set to one of the addresses above
  - UDP Port: the one this program listens on (default 20777)
  - UDP Format: 2024
Also check that the console and this computer are on the same network (guest Wi-Fi often isolates devices)
and that the firewall allows incoming connections for this program.
`)
		return errors.New("no telemetry received")
	}
	stats.Print(os.Stdout)
	if _, ok := stats.Formats[2024]; !ok {
		fmt.Println("\nWarning: no packets in format 2024. Set UDP Format to 2024 in the game's telemetry settings.")
	}
	return nil
}

// reorder moves flags before positional arguments so "compare a b --tolerance 2ms" works.
func reorder(args []string) []string {
	var flags, pos []string
	for i := 0; i < len(args); i++ {
		if strings.HasPrefix(args[i], "-") {
			flags = append(flags, args[i])
			if !strings.Contains(args[i], "=") && i+1 < len(args) {
				flags = append(flags, args[i+1])
				i++
			}
		} else {
			pos = append(pos, args[i])
		}
	}
	return append(flags, pos...)
}
