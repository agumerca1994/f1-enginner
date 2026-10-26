//go:build windows

package overlay

import (
	"context"
	"image"
	"runtime"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Each panel is a layered, topmost, tool window painted with UpdateLayeredWindow
// from a per-pixel-alpha bitmap: the empty parts are truly transparent and, when
// locked (WS_EX_TRANSPARENT), clicks fall through to the game. The game must
// run in borderless-window mode; exclusive fullscreen covers every other window.

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")

	pGetModuleHandleW = kernel32.NewProc("GetModuleHandleW")
	gdi32             = windows.NewLazySystemDLL("gdi32.dll")

	pRegisterClassExW          = user32.NewProc("RegisterClassExW")
	pCreateWindowExW           = user32.NewProc("CreateWindowExW")
	pDefWindowProcW            = user32.NewProc("DefWindowProcW")
	pDestroyWindow             = user32.NewProc("DestroyWindow")
	pShowWindow                = user32.NewProc("ShowWindow")
	pUpdateLayeredWindow       = user32.NewProc("UpdateLayeredWindow")
	pGetDC                     = user32.NewProc("GetDC")
	pReleaseDC                 = user32.NewProc("ReleaseDC")
	pSetWindowLongPtrW         = user32.NewProc("SetWindowLongPtrW")
	pGetWindowLongPtrW         = user32.NewProc("GetWindowLongPtrW")
	pSetWindowPos              = user32.NewProc("SetWindowPos")
	pGetWindowRect             = user32.NewProc("GetWindowRect")
	pPeekMessageW              = user32.NewProc("PeekMessageW")
	pTranslateMessage          = user32.NewProc("TranslateMessage")
	pDispatchMessageW          = user32.NewProc("DispatchMessageW")
	pMsgWaitForMultipleObjects = user32.NewProc("MsgWaitForMultipleObjects")
	pRegisterHotKey            = user32.NewProc("RegisterHotKey")
	pUnregisterHotKey          = user32.NewProc("UnregisterHotKey")

	pCreateCompatibleDC = gdi32.NewProc("CreateCompatibleDC")
	pCreateDIBSection   = gdi32.NewProc("CreateDIBSection")
	pSelectObject       = gdi32.NewProc("SelectObject")
	pDeleteObject       = gdi32.NewProc("DeleteObject")
	pDeleteDC           = gdi32.NewProc("DeleteDC")
)

const (
	wsPopup          = 0x80000000
	wsExLayered      = 0x00080000
	wsExTopmost      = 0x00000008
	wsExToolWindow   = 0x00000080
	wsExNoActivate   = 0x08000000
	wsExTransparent  = 0x00000020
	gwlExStyle       = ^uintptr(19) // -20
	swHide           = 0
	swShowNoActivate = 4
	swpNoSize        = 0x0001
	swpNoZOrder      = 0x0004
	swpNoActivate    = 0x0010
	swpNoMove        = 0x0002
	swpFrameChanged  = 0x0020
	wmNCHitTest      = 0x0084
	wmMouseActivate  = 0x0021
	wmMouseWheel     = 0x020A
	wmExitSizeMove   = 0x0232
	wmHotkey         = 0x0312
	htCaption        = 2
	htTransparent    = ^uintptr(0) // -1
	maNoActivate     = 3
	pmRemove         = 1
	qsAllInput       = 0x04FF
	ulwAlpha         = 2
	modAlt           = 0x0001
	modControl       = 0x0002
	modNoRepeat      = 0x4000
	vkF10            = 0x79
	vkF11            = 0x7A
	frameMillis      = 33
	className        = "IngenieroBridgePanel"
)

type wndClassEx struct {
	Size, Style                        uint32
	WndProc                            uintptr
	ClsExtra, WndExtra                 int32
	Instance, Icon, Cursor, Background windows.Handle
	MenuName, ClassName                *uint16
	IconSm                             windows.Handle
}

type msg struct {
	Hwnd    windows.HWND
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      struct{ X, Y int32 }
	Private uint32
}

type point struct{ X, Y int32 }
type size struct{ CX, CY int32 }
type rect struct{ Left, Top, Right, Bottom int32 }

type bitmapInfoHeader struct {
	Size                         uint32
	Width, Height                int32
	Planes, BitCount             uint16
	Compression, SizeImage       uint32
	XPelsPerMeter, YPelsPerMeter int32
	ClrUsed, ClrImportant        uint32
}

type blendFunction struct{ Op, Flags, SourceConstantAlpha, AlphaFormat byte }

type winHost struct {
	events   hostEvents
	mu       sync.Mutex // guards panels for the window procedure (same thread, but be safe)
	windows  map[Panel]windows.HWND
	panels   map[windows.HWND]Panel
	locked   map[Panel]bool
	shown    map[Panel]bool
	wndProc  uintptr
	instance uintptr
}

func newHost(ev hostEvents) host {
	h := &winHost{events: ev, windows: map[Panel]windows.HWND{}, panels: map[windows.HWND]Panel{},
		locked: map[Panel]bool{}, shown: map[Panel]bool{}}
	h.wndProc = windows.NewCallback(h.proc)
	return h
}

func (h *winHost) loop(ctx context.Context, frame func(), hotkey func(id int)) {
	runtime.LockOSThread() // windows and hotkeys belong to the thread that made them
	defer runtime.UnlockOSThread()

	name, _ := windows.UTF16PtrFromString(className)
	instance, _, _ := pGetModuleHandleW.Call(0)
	h.instance = instance
	wc := wndClassEx{WndProc: h.wndProc, ClassName: name, Instance: windows.Handle(instance)}
	wc.Size = uint32(unsafe.Sizeof(wc))
	pRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))

	mods := uintptr(modControl | modAlt | modNoRepeat)
	pRegisterHotKey.Call(0, HotkeyLock, mods, vkF10)
	pRegisterHotKey.Call(0, HotkeyShow, mods, vkF11)
	defer func() {
		pUnregisterHotKey.Call(0, HotkeyLock)
		pUnregisterHotKey.Call(0, HotkeyShow)
		for _, hwnd := range h.windows {
			pDestroyWindow.Call(uintptr(hwnd))
		}
	}()

	var m msg
	for ctx.Err() == nil {
		for {
			r, _, _ := pPeekMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0, pmRemove)
			if r == 0 {
				break
			}
			if m.Message == wmHotkey && m.Hwnd == 0 {
				hotkey(int(m.WParam))
				continue
			}
			pTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
			pDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
		}
		frame()
		pMsgWaitForMultipleObjects.Call(0, 0, 0, frameMillis, qsAllInput)
	}
}

func (h *winHost) window(p Panel, x, y int) windows.HWND {
	if hwnd, ok := h.windows[p]; ok {
		return hwnd
	}
	name, _ := windows.UTF16PtrFromString(className)
	title, _ := windows.UTF16PtrFromString("Ingeniero · " + string(p))
	ex := uintptr(wsExLayered | wsExTopmost | wsExToolWindow | wsExNoActivate)
	r, _, _ := pCreateWindowExW.Call(ex, uintptr(unsafe.Pointer(name)), uintptr(unsafe.Pointer(title)),
		wsPopup, uintptr(x), uintptr(y), 1, 1, 0, 0, h.instance, 0)
	hwnd := windows.HWND(r)
	h.mu.Lock()
	h.windows[p], h.panels[hwnd] = hwnd, p
	h.mu.Unlock()
	return hwnd
}

func (h *winHost) present(p Panel, img *image.RGBA, x, y int, locked bool) {
	hwnd := h.window(p, x, y)
	if hwnd == 0 {
		return
	}
	h.setLocked(p, hwnd, locked)
	h.paint(hwnd, img)
	if !h.shown[p] {
		pShowWindow.Call(uintptr(hwnd), swShowNoActivate)
		h.shown[p] = true
	}
}

func (h *winHost) hide(p Panel) {
	if hwnd, ok := h.windows[p]; ok && h.shown[p] {
		pShowWindow.Call(uintptr(hwnd), swHide)
		h.shown[p] = false
	}
}

func (h *winHost) place(p Panel, x, y int) {
	if hwnd, ok := h.windows[p]; ok {
		pSetWindowPos.Call(uintptr(hwnd), 0, uintptr(x), uintptr(y), 0, 0, swpNoSize|swpNoZOrder|swpNoActivate)
	}
}

// setLocked turns click-through on or off.
func (h *winHost) setLocked(p Panel, hwnd windows.HWND, locked bool) {
	if was, ok := h.locked[p]; ok && was == locked {
		return
	}
	h.locked[p] = locked
	style, _, _ := pGetWindowLongPtrW.Call(uintptr(hwnd), gwlExStyle)
	if locked {
		style |= wsExTransparent
	} else {
		style &^= wsExTransparent
	}
	pSetWindowLongPtrW.Call(uintptr(hwnd), gwlExStyle, style)
	pSetWindowPos.Call(uintptr(hwnd), 0, 0, 0, 0, 0, swpNoMove|swpNoSize|swpNoZOrder|swpNoActivate|swpFrameChanged)
}

// paint hands the image to the window as a premultiplied BGRA bitmap. Go's
// image.RGBA is already premultiplied, so only the channel order changes.
func (h *winHost) paint(hwnd windows.HWND, img *image.RGBA) {
	b := img.Bounds()
	w, ht := b.Dx(), b.Dy()
	screen, _, _ := pGetDC.Call(0)
	defer pReleaseDC.Call(0, screen)
	mem, _, _ := pCreateCompatibleDC.Call(screen)
	defer pDeleteDC.Call(mem)

	bi := bitmapInfoHeader{Width: int32(w), Height: -int32(ht), Planes: 1, BitCount: 32}
	bi.Size = uint32(unsafe.Sizeof(bi))
	var bits unsafe.Pointer
	bmp, _, _ := pCreateDIBSection.Call(screen, uintptr(unsafe.Pointer(&bi)), 0, uintptr(unsafe.Pointer(&bits)), 0, 0)
	if bmp == 0 || bits == nil {
		return
	}
	defer pDeleteObject.Call(bmp)
	dst := unsafe.Slice((*byte)(bits), w*ht*4)
	for y := 0; y < ht; y++ {
		row := img.Pix[y*img.Stride : y*img.Stride+w*4]
		out := dst[y*w*4 : (y+1)*w*4]
		for i := 0; i < len(row); i += 4 {
			out[i], out[i+1], out[i+2], out[i+3] = row[i+2], row[i+1], row[i], row[i+3]
		}
	}
	old, _, _ := pSelectObject.Call(mem, bmp)
	defer pSelectObject.Call(mem, old)

	sz := size{int32(w), int32(ht)}
	src := point{}
	blend := blendFunction{SourceConstantAlpha: 255, AlphaFormat: 1} // AC_SRC_ALPHA
	// No destination point: the window keeps wherever the player dragged it.
	pUpdateLayeredWindow.Call(uintptr(hwnd), screen, 0, uintptr(unsafe.Pointer(&sz)), mem,
		uintptr(unsafe.Pointer(&src)), 0, uintptr(unsafe.Pointer(&blend)), ulwAlpha)
}

func (h *winHost) proc(hwnd windows.HWND, message uint32, wParam, lParam uintptr) uintptr {
	h.mu.Lock()
	p, ok := h.panels[hwnd]
	locked := h.locked[p]
	h.mu.Unlock()
	if ok {
		switch message {
		case wmMouseActivate:
			return maNoActivate // never take focus from the game
		case wmNCHitTest:
			if locked {
				return htTransparent
			}
			return htCaption // drag the whole panel
		case wmExitSizeMove:
			var r rect
			pGetWindowRect.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&r)))
			h.events.moved(p, int(r.Left), int(r.Top))
			return 0
		case wmMouseWheel:
			if !locked {
				h.events.wheel(p, int16(wParam>>16) > 0)
			}
			return 0
		}
	}
	r, _, _ := pDefWindowProcW.Call(uintptr(hwnd), uintptr(message), wParam, lParam)
	return r
}
