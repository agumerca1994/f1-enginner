//go:build !darwin

package autostart

import "errors"

var errUnsupported = errors.New("opening at login is only supported on macOS for now")

func Enabled() bool  { return false }
func Enable() error  { return errUnsupported }
func Disable() error { return nil }
