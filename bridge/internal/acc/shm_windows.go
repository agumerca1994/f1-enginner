//go:build windows

package acc

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	pageTick      = 50 * time.Millisecond // physics at up to 20 Hz
	graphicsEvery = 2                     // graphics at up to 10 Hz
	staticEvery   = 100                   // the static page barely changes: look every 5 s
	reopenEvery   = 2 * time.Second
)

var (
	kernel32         = windows.NewLazySystemDLL("kernel32.dll")
	pOpenFileMapping = kernel32.NewProc("OpenFileMappingW")
)

// page is one mapped shared-memory page.
type page struct {
	name string
	kind byte
	view uintptr
	data unsafe.Pointer // view as a pointer: memory owned by Windows, not the Go heap
	size int
	last []byte // for the static page: the copy last sent
	id   uint32 // physics and graphics: the packetId last sent
}

func (p *page) open() error {
	name, _ := windows.UTF16PtrFromString(p.name)
	h, _, err := pOpenFileMapping.Call(windows.FILE_MAP_READ, 0, uintptr(unsafe.Pointer(name)))
	if h == 0 {
		return fmt.Errorf("%s: %w", p.name, err) // ACC not running
	}
	view, err := windows.MapViewOfFile(windows.Handle(h), windows.FILE_MAP_READ, 0, 0, 0)
	windows.CloseHandle(windows.Handle(h)) // the view keeps the mapping alive
	if err != nil {
		return fmt.Errorf("%s: %w", p.name, err)
	}
	var info windows.MemoryBasicInformation
	if err := windows.VirtualQuery(view, &info, unsafe.Sizeof(info)); err != nil {
		windows.UnmapViewOfFile(view)
		return err
	}
	// The region is rounded up to whole memory pages; the server cuts the struct it knows.
	p.view, p.size = view, int(min(info.RegionSize, 8192))
	p.data = *(*unsafe.Pointer)(unsafe.Pointer(&view))
	return nil
}

func (p *page) close() {
	if p.view != 0 {
		windows.UnmapViewOfFile(p.view)
		p.view, p.data = 0, nil
	}
}

// read copies the page when it changed since the last call.
func (p *page) read() []byte {
	src := unsafe.Slice((*byte)(p.data), p.size)
	if p.kind == KindStatic {
		if bytes.Equal(src, p.last) {
			return nil
		}
		p.last = append(p.last[:0], src...)
		return append([]byte(nil), src...)
	}
	id := binary.LittleEndian.Uint32(src)
	if id == p.id {
		return nil // ACC has not written a new frame (paused, menus, closed)
	}
	p.id = id
	return append([]byte(nil), src...)
}

func readPages(ctx context.Context, emit func(kind byte, page []byte), stats *Stats) {
	pages := []*page{
		{name: `Local\acpmf_physics`, kind: KindPhysics},
		{name: `Local\acpmf_graphics`, kind: KindGraphics},
		{name: `Local\acpmf_static`, kind: KindStatic},
	}
	defer func() {
		for _, p := range pages {
			p.close()
		}
	}()
	tick := time.NewTicker(pageTick)
	defer tick.Stop()
	var lastOpen time.Time
	for n := 0; ; n++ {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		retry := time.Since(lastOpen) >= reopenEvery
		for _, p := range pages {
			if p.view == 0 {
				if !retry {
					continue
				}
				lastOpen = time.Now()
				if err := p.open(); err != nil {
					stats.fail(err)
					continue
				}
			}
			switch {
			case p.kind == KindGraphics && n%graphicsEvery != 0:
				continue
			case p.kind == KindStatic && n%staticEvery != 0 && p.last != nil:
				continue
			}
			if b := p.read(); b != nil {
				emit(p.kind, b)
			}
		}
	}
}
