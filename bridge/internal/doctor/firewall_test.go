package doctor

import (
	"strings"
	"testing"
)

func TestDescribeWindowsFirewall(t *testing.T) {
	cases := map[string]string{
		"profiles=\r\nrules=\r\n":                                 "desactivado",
		"profiles=Domain,Private,Public\r\nrules=Allow,Allow\r\n": "permiso de entrada",
		"profiles=Public\r\nrules=Allow,Block\r\n":                "BLOQUEA",
		"profiles=Private\r\nrules=\r\n":                          "no tiene regla",
	}
	for out, want := range cases {
		if got := describeWindowsFirewall(out); !strings.Contains(got, want) {
			t.Errorf("%q: got %q, want %q", out, got, want)
		}
	}
}
