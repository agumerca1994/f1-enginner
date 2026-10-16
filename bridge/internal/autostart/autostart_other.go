//go:build !darwin && !windows

package autostart

import "errors"

var errUnsupported = errors.New("opening at login is not supported on this system yet")

func Enabled() bool  { return false }
func Enable() error  { return errUnsupported }
func Disable() error { return nil }
