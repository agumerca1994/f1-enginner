package acc

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"net"
	"time"
)

// Broadcasting protocol (Kunos ACC broadcasting SDK, protocol version 4).
const (
	protocolVersion = 4

	cmdRegister         = 1
	cmdUnregister       = 9
	cmdRequestEntryList = 10
	cmdRequestTrackData = 11

	msgRegistrationResult = 1
	msgEntryList          = 4

	updateIntervalMs = 250 // realtime updates per car: 4 a second is plenty for relatives
	refreshEvery     = 10 * time.Second
	silenceLimit     = 15 * time.Second
	clientName       = "Ingeniero Bridge"
)

var errRegistration = errors.New("ACC rejected the broadcasting registration")

func writeString(b []byte, s string) []byte {
	b = binary.LittleEndian.AppendUint16(b, uint16(len(s)))
	return append(b, s...)
}

func registerCommand(password string) []byte {
	b := []byte{cmdRegister, protocolVersion}
	b = writeString(b, clientName)
	b = writeString(b, password)
	b = binary.LittleEndian.AppendUint32(b, updateIntervalMs)
	return writeString(b, "") // no command password: read only
}

func connCommand(cmd byte, connectionID int32) []byte {
	return binary.LittleEndian.AppendUint32([]byte{cmd}, uint32(connectionID))
}

// Broadcast registers with ACC's broadcasting API on 127.0.0.1 and passes every
// message to fn until ctx ends, ACC goes quiet or the registration fails. It
// asks for the entry list and track data again every few seconds, since cars
// join and leave and ACC only sends them on request.
func Broadcast(ctx context.Context, s BroadcastSettings, fn func(msg []byte)) error {
	if s.Port <= 0 {
		return errors.New("broadcasting is off in broadcasting.json (updListenerPort 0)")
	}
	conn, err := net.DialUDP("udp", nil, &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: s.Port})
	if err != nil {
		return err
	}
	defer conn.Close()
	if _, err := conn.Write(registerCommand(s.Password)); err != nil {
		return err
	}

	var connectionID int32 = -1
	defer func() {
		if connectionID >= 0 {
			conn.Write(connCommand(cmdUnregister, connectionID)) // free the slot in ACC
		}
	}()
	buf := make([]byte, 64<<10)
	lastHeard, lastRefresh := time.Now(), time.Time{}
	for ctx.Err() == nil {
		conn.SetReadDeadline(time.Now().Add(time.Second))
		n, err := conn.Read(buf)
		now := time.Now()
		if err != nil {
			var ne net.Error
			if !errors.As(err, &ne) || !ne.Timeout() {
				// Windows reports a refused UDP port (ACC closed) as a read error.
				return fmt.Errorf("broadcasting: %w", err)
			}
		} else if n > 0 {
			lastHeard = now
			msg := append([]byte(nil), buf[:n]...)
			if msg[0] == msgRegistrationResult && n >= 6 {
				if msg[5] == 0 {
					fn(msg)
					return errRegistration
				}
				connectionID = int32(binary.LittleEndian.Uint32(msg[1:5]))
			}
			fn(msg)
		}
		if now.Sub(lastHeard) > silenceLimit {
			return errors.New("ACC stopped answering on the broadcasting port")
		}
		if connectionID >= 0 && now.Sub(lastRefresh) > refreshEvery {
			lastRefresh = now
			conn.Write(connCommand(cmdRequestEntryList, connectionID))
			conn.Write(connCommand(cmdRequestTrackData, connectionID))
		}
	}
	return nil
}
