// Package capture reads and writes .f1cap files: raw UDP datagrams with their
// arrival time, so a session can be replayed without the console.
//
// Layout (the whole stream is zstd-compressed when the file name ends in .zst):
//
//	magic   "F1CAP" + version byte (1)
//	u32     length of the JSON metadata that follows
//	[]byte  JSON metadata (Meta)
//	records until EOF: u64 offset_ns since the first datagram | u16 len | datagram
//
// All integers are little-endian.
package capture

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/klauspost/compress/zstd"
)

const version = 1

var magic = []byte("F1CAP")

// Meta describes where and how a capture was recorded.
type Meta struct {
	BridgeVersion string    `json:"bridge_version"`
	Host          string    `json:"host"`
	ListenAddr    string    `json:"listen_addr"`
	StartedAt     time.Time `json:"started_at"`
	Note          string    `json:"note,omitempty"`
}

// Record is one captured datagram.
type Record struct {
	Offset time.Duration // time since the first datagram of the capture
	Data   []byte
}

// Writer appends records to a capture file.
type Writer struct {
	f     *os.File
	zw    *zstd.Encoder
	bw    *bufio.Writer
	first time.Time
	n     int
}

// Create opens path for writing and writes the file header.
func Create(path string, meta Meta) (*Writer, error) {
	f, err := os.Create(path)
	if err != nil {
		return nil, err
	}
	w := &Writer{f: f}
	var dst io.Writer = f
	if strings.HasSuffix(path, ".zst") {
		if w.zw, err = zstd.NewWriter(f); err != nil {
			f.Close()
			return nil, err
		}
		dst = w.zw
	}
	w.bw = bufio.NewWriterSize(dst, 64<<10)

	js, err := json.Marshal(meta)
	if err != nil {
		f.Close()
		return nil, err
	}
	w.bw.Write(magic)
	w.bw.WriteByte(version)
	binary.Write(w.bw, binary.LittleEndian, uint32(len(js)))
	w.bw.Write(js)
	return w, nil
}

// Write appends a datagram received at time at.
func (w *Writer) Write(at time.Time, data []byte) error {
	if len(data) > 0xFFFF {
		return fmt.Errorf("datagram too large: %d bytes", len(data))
	}
	if w.n == 0 {
		w.first = at
	}
	var hdr [10]byte
	binary.LittleEndian.PutUint64(hdr[0:8], uint64(at.Sub(w.first)))
	binary.LittleEndian.PutUint16(hdr[8:10], uint16(len(data)))
	if _, err := w.bw.Write(hdr[:]); err != nil {
		return err
	}
	_, err := w.bw.Write(data)
	w.n++
	return err
}

// Count returns how many records were written.
func (w *Writer) Count() int { return w.n }

// Close flushes and closes the file.
func (w *Writer) Close() error {
	err := w.bw.Flush()
	if w.zw != nil {
		if cerr := w.zw.Close(); err == nil {
			err = cerr
		}
	}
	if cerr := w.f.Close(); err == nil {
		err = cerr
	}
	return err
}

// Reader iterates over the records of a capture file.
type Reader struct {
	Meta Meta
	f    *os.File
	zr   *zstd.Decoder
	br   *bufio.Reader
}

// Open opens a capture file and reads its header.
func Open(path string) (*Reader, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	r := &Reader{f: f}
	var src io.Reader = f
	if strings.HasSuffix(path, ".zst") {
		if r.zr, err = zstd.NewReader(f); err != nil {
			f.Close()
			return nil, err
		}
		src = r.zr
	}
	r.br = bufio.NewReaderSize(src, 64<<10)

	head := make([]byte, len(magic)+1+4)
	if _, err := io.ReadFull(r.br, head); err != nil {
		r.Close()
		return nil, fmt.Errorf("reading capture header: %w", err)
	}
	if string(head[:len(magic)]) != string(magic) {
		r.Close()
		return nil, errors.New("not an .f1cap file")
	}
	if v := head[len(magic)]; v != version {
		r.Close()
		return nil, fmt.Errorf("unsupported capture version %d", v)
	}
	js := make([]byte, binary.LittleEndian.Uint32(head[len(magic)+1:]))
	if _, err := io.ReadFull(r.br, js); err != nil {
		r.Close()
		return nil, fmt.Errorf("reading capture metadata: %w", err)
	}
	if err := json.Unmarshal(js, &r.Meta); err != nil {
		r.Close()
		return nil, fmt.Errorf("decoding capture metadata: %w", err)
	}
	return r, nil
}

// Next returns the next record, or io.EOF when the capture ends.
func (r *Reader) Next() (Record, error) {
	var hdr [10]byte
	if _, err := io.ReadFull(r.br, hdr[:]); err != nil {
		if errors.Is(err, io.ErrUnexpectedEOF) {
			return Record{}, fmt.Errorf("truncated record: %w", err)
		}
		return Record{}, err
	}
	data := make([]byte, binary.LittleEndian.Uint16(hdr[8:10]))
	if _, err := io.ReadFull(r.br, data); err != nil {
		return Record{}, fmt.Errorf("truncated record: %w", err)
	}
	return Record{Offset: time.Duration(binary.LittleEndian.Uint64(hdr[0:8])), Data: data}, nil
}

// Close releases the file.
func (r *Reader) Close() error {
	if r.zr != nil {
		r.zr.Close()
	}
	return r.f.Close()
}
