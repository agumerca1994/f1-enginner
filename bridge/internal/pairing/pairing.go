// Package pairing links a bridge to a player's account with a device-code flow:
// the bridge shows a short code, the player confirms it on the web app, and the
// bridge receives its token.
package pairing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Start is the server's answer to a pairing request.
type Start struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURL         string `json:"verification_url"`
	VerificationURLComplete string `json:"verification_url_complete"`
	ExpiresIn               int    `json:"expires_in"`
	Interval                int    `json:"interval"`
}

// Result is what the bridge keeps once the player confirmed the code.
type Result struct {
	Token    string
	DeviceID int
}

// ErrExpired means the code was not confirmed in time.
var ErrExpired = errors.New("the pairing code expired; run `bridge pair` again")

// Device describes this bridge to the server.
type Device struct {
	Name          string `json:"name"`
	OS            string `json:"os"`
	Arch          string `json:"arch"`
	BridgeVersion string `json:"bridge_version"`
}

var client = &http.Client{Timeout: 15 * time.Second}

// Begin asks the server for a pairing code.
func Begin(ctx context.Context, server string, dev Device) (Start, error) {
	var s Start
	err := post(ctx, server, "/api/devices/pair/start", dev, &s)
	return s, err
}

// Wait polls until the player confirms the code, the code expires or ctx ends.
func Wait(ctx context.Context, server string, s Start) (Result, error) {
	interval := time.Duration(s.Interval) * time.Second
	if interval <= 0 {
		interval = 3 * time.Second
	}
	for {
		var out struct {
			Status   string `json:"status"`
			Token    string `json:"token"`
			DeviceID int    `json:"device_id"`
		}
		if err := post(ctx, server, "/api/devices/pair/poll", map[string]string{"device_code": s.DeviceCode}, &out); err != nil {
			return Result{}, err
		}
		switch out.Status {
		case "complete":
			return Result{Token: out.Token, DeviceID: out.DeviceID}, nil
		case "expired":
			return Result{}, ErrExpired
		}
		select {
		case <-ctx.Done():
			return Result{}, ctx.Err()
		case <-time.After(interval):
		}
	}
}

func post(ctx context.Context, server, path string, in, out any) error {
	body, err := json.Marshal(in)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(server, "/")+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("cannot reach %s: %w", server, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("server answered %s to %s", resp.Status, path)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}
