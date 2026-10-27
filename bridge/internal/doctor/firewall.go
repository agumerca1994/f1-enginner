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
			return "desconocido (no se pudo consultar el firewall de macOS)"
		}
		s := strings.TrimSpace(string(out))
		if strings.Contains(strings.ToLower(s), "enabled") {
			return "activado: si no llegan datos, permití las conexiones entrantes de esta app en Ajustes del Sistema > Red > Firewall"
		}
		return "desactivado"
	case "windows":
		return windowsFirewall()
	default:
		return "no se revisa en " + runtime.GOOS
	}
}

// describeWindowsFirewall turns the output of firewallScript into a line.
func describeWindowsFirewall(out string) string {
	var profiles, rules string
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if v, ok := strings.CutPrefix(line, "profiles="); ok {
			profiles = v
		} else if v, ok := strings.CutPrefix(line, "rules="); ok {
			rules = v
		}
	}
	if profiles == "" {
		return "desactivado"
	}
	text := "activado (" + profiles + ")"
	switch {
	case strings.Contains(rules, "Block"):
		return text + " · hay una regla que BLOQUEA esta app: borrala en Firewall de Windows > Configuración avanzada > Reglas de entrada"
	case strings.Contains(rules, "Allow"):
		return text + " · esta app tiene permiso de entrada"
	default:
		return text + " · esta app no tiene regla de entrada: si no llegan datos, permitila en Firewall de Windows"
	}
}
