// Package udp receives and sends raw telemetry datagrams.
package udp

import (
	"errors"
	"net"
	"time"
)

// MaxDatagram is larger than any F1 24 packet (the biggest is 1460 bytes).
const MaxDatagram = 2048

// Datagram is one received packet and when it arrived.
type Datagram struct {
	At   time.Time
	From *net.UDPAddr
	Data []byte
}

// Listen binds addr (for example ":20777"). Binding on all interfaces receives
// both broadcast and unicast telemetry.
func Listen(addr string) (*net.UDPConn, error) {
	ua, err := net.ResolveUDPAddr("udp4", addr)
	if err != nil {
		return nil, err
	}
	conn, err := net.ListenUDP("udp4", ua)
	if err != nil {
		return nil, err
	}
	// At 60 Hz the game sends bursts of several packets per frame.
	_ = conn.SetReadBuffer(4 << 20)
	return conn, nil
}

// Receive reads datagrams from conn and passes them to fn until conn is closed.
// It returns nil when the connection was closed on purpose.
func Receive(conn *net.UDPConn, fn func(Datagram)) error {
	buf := make([]byte, MaxDatagram)
	for {
		n, from, err := conn.ReadFromUDP(buf)
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				return nil
			}
			return err
		}
		at := time.Now()
		data := make([]byte, n)
		copy(data, buf[:n])
		fn(Datagram{At: at, From: from, Data: data})
	}
}

// Dial opens a UDP socket that sends to target (for example "127.0.0.1:20777").
func Dial(target string) (*net.UDPConn, error) {
	ua, err := net.ResolveUDPAddr("udp4", target)
	if err != nil {
		return nil, err
	}
	return net.DialUDP("udp4", nil, ua)
}

// LANAddresses returns the IPv4 addresses of the active, non-loopback interfaces.
func LANAddresses() map[string][]string {
	out := map[string][]string{}
	ifaces, err := net.Interfaces()
	if err != nil {
		return out
	}
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok && ipn.IP.To4() != nil {
				out[ifc.Name] = append(out[ifc.Name], ipn.IP.String())
			}
		}
	}
	return out
}
