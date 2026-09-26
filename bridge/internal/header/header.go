// Package header decodes the 29-byte header that prefixes every F1 24 UDP packet.
// The bridge only reads the header; packet bodies are parsed on the server.
package header

import (
	"encoding/binary"
	"errors"
	"math"
)

// Size is the length in bytes of the packet header for packet format 2024.
const Size = 29

// ErrShort is returned when a datagram is smaller than the header.
var ErrShort = errors.New("datagram shorter than header")

// Header mirrors PacketHeader from the F1 24 UDP specification (little-endian, packed).
type Header struct {
	PacketFormat            uint16
	GameYear                uint8
	GameMajorVersion        uint8
	GameMinorVersion        uint8
	PacketVersion           uint8
	PacketID                uint8
	SessionUID              uint64
	SessionTime             float32
	FrameIdentifier         uint32
	OverallFrameIdentifier  uint32
	PlayerCarIndex          uint8
	SecondaryPlayerCarIndex uint8
}

// Parse decodes the header at the start of b.
func Parse(b []byte) (Header, error) {
	if len(b) < Size {
		return Header{}, ErrShort
	}
	le := binary.LittleEndian
	return Header{
		PacketFormat:            le.Uint16(b[0:2]),
		GameYear:                b[2],
		GameMajorVersion:        b[3],
		GameMinorVersion:        b[4],
		PacketVersion:           b[5],
		PacketID:                b[6],
		SessionUID:              le.Uint64(b[7:15]),
		SessionTime:             math.Float32frombits(le.Uint32(b[15:19])),
		FrameIdentifier:         le.Uint32(b[19:23]),
		OverallFrameIdentifier:  le.Uint32(b[23:27]),
		PlayerCarIndex:          b[27],
		SecondaryPlayerCarIndex: b[28],
	}, nil
}

// PacketNames maps packet IDs to their names in the 2024 format.
var PacketNames = map[uint8]string{
	0:  "Motion",
	1:  "Session",
	2:  "LapData",
	3:  "Event",
	4:  "Participants",
	5:  "CarSetups",
	6:  "CarTelemetry",
	7:  "CarStatus",
	8:  "FinalClassification",
	9:  "LobbyInfo",
	10: "CarDamage",
	11: "SessionHistory",
	12: "TyreSets",
	13: "MotionEx",
	14: "TimeTrial",
}

// Sizes2024 holds the expected datagram size of each packet ID for format 2024.
var Sizes2024 = map[uint8]int{
	0: 1349, 1: 753, 2: 1285, 3: 45, 4: 1350, 5: 1133, 6: 1352, 7: 1239,
	8: 1020, 9: 1306, 10: 953, 11: 1460, 12: 231, 13: 237, 14: 101,
}

// Name returns the packet name for id, or "Unknown".
func Name(id uint8) string {
	if n, ok := PacketNames[id]; ok {
		return n
	}
	return "Unknown"
}
