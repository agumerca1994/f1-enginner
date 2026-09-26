package doctor

import (
	"os/exec"
	"runtime"
	"strings"
)

// FirewallStatus describes the operating system firewall, when it can be read.
func FirewallStatus() string {
	switch runtime.GOOS {
	case "darwin":
		out, err := exec.Command("/usr/libexec/ApplicationFirewall/socketfilterfw", "--getglobalstate").Output()
		if err != nil {
			return "unknown (could not query the macOS firewall)"
		}
		s := strings.TrimSpace(string(out))
		if strings.Contains(strings.ToLower(s), "enabled") {
			return s + " — if no packets arrive, allow incoming connections for this program in System Settings > Network > Firewall"
		}
		return s
	case "windows":
		return "check that Windows Defender Firewall allows inbound UDP for this program"
	default:
		return "not checked on " + runtime.GOOS
	}
}
