package doctor

import (
	"context"
	"os"
	"os/exec"
	"syscall"
	"time"
)

// firewallScript prints the enabled profiles and how this program's inbound
// rules act, one per line. Cmdlet output is not localized, unlike netsh.
const firewallScript = `$ErrorActionPreference='SilentlyContinue'
"profiles=" + ((Get-NetFirewallProfile | Where-Object Enabled -eq True | ForEach-Object Name) -join ',')
"rules=" + ((Get-NetFirewallApplicationFilter -Program $env:BRIDGE_EXE | Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Enabled -eq 'True' } | ForEach-Object { [string]$_.Action }) -join ',')`

func windowsFirewall() string {
	exe, _ := os.Executable()
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive", "-Command", firewallScript)
	cmd.Env = append(os.Environ(), "BRIDGE_EXE="+exe)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	out, err := cmd.Output()
	if err != nil {
		return "no se pudo consultar el Firewall de Windows"
	}
	return describeWindowsFirewall(string(out))
}
