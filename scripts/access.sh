#!/usr/bin/env bash
# Early access from the terminal: hand out invite codes and see who asked.
#   scripts/access.sh codes [cantidad] [etiqueta] [usos]   new codes (shown once)
#   scripts/access.sh requests                             access requests, newest first
#   scripts/access.sh grant <email>                        let someone in by hand
# Uses the internal key from .env.production; API=http://localhost:8000 KEY=dev-key for local.
set -euo pipefail
cd "$(dirname "$0")/.."
API="${API:-https://f1-api.imanzanastore.com.ar}"
KEY="${KEY:-$(grep '^INTERNAL_LOG_KEY=' .env.production | cut -d= -f2-)}"
call() { curl -fsS -H "x-internal-key: $KEY" -H "content-type: application/json" "$@"; }
case "${1:-}" in
  codes)
    body=$(python3 -c 'import json,sys; print(json.dumps({"cantidad": int(sys.argv[1]), "etiqueta": sys.argv[2] or None, "usos": int(sys.argv[3])}))' "${2:-1}" "${3:-}" "${4:-1}")
    call -X POST "$API/internal/access/codes" -d "$body" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("\n".join(d["codigos"]))'
    ;;
  requests)
    call "$API/internal/access/requests" | python3 -c '
import json, sys
for s in json.load(sys.stdin)["solicitudes"]:
    who = "%s (%s butacas)" % (s["local"], s["butacas"] or "?") if s["tipo"] == "local" else "piloto"
    print("%s %s  %-34s %-28s %s · %s · %s" % ("OK" if s["habilitado"] else "  ", s["fecha"][:10], s["email"], who, s["juego"] or "", s["plataforma"] or "", s["ciudad"] or ""))
'
    ;;
  grant)
    call -X POST "$API/internal/access/grant" -d "{\"email\": \"${2:?email}\"}" && echo
    ;;
  *) sed -n 2,6p "$0"; exit 1 ;;
esac
