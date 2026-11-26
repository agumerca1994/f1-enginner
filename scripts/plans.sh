#!/usr/bin/env bash
# Plans from the terminal: courtesy plans, gifted AI races and the reference dollar.
#   scripts/plans.sh cortesia <email> [dias] [nota]   everything included, no charge (no días = no end)
#   scripts/plans.sh quitar <email>                    take a courtesy plan away
#   scripts/plans.sh carreras <email> <cantidad>       gift AI races
#   scripts/plans.sh dolar <pesos>                     the reference dollar for the prices in pesos
#   scripts/plans.sh cuentas                           every account with a plan or races
# Uses the internal key from .env.production; API=http://localhost:8000 KEY=dev-key for local.
set -euo pipefail
cd "$(dirname "$0")/.."
API="${API:-https://f1-api.imanzanastore.com.ar}"
KEY="${KEY:-$(grep '^INTERNAL_LOG_KEY=' .env.production | cut -d= -f2-)}"
call() { curl -fsS -H "x-internal-key: $KEY" -H "content-type: application/json" "$@"; }
show() { python3 -c '
import json, sys
d = json.load(sys.stdin)
print("%s: %s%s · %s carreras con IA%s" % (d["email"], d["plan"], (" hasta " + d["hasta"][:10]) if d.get("hasta") else "", d["creditos"], "" if d["limites"] else " · límites apagados"))'; }
case "${1:-}" in
  cortesia)
    body=$(python3 -c 'import json,sys; print(json.dumps({"email": sys.argv[1], "cortesia": True, "dias": int(sys.argv[2]) if sys.argv[2] else None, "nota": sys.argv[3] or None}))' "${2:?email}" "${3:-}" "${4:-}")
    call -X POST "$API/internal/billing/grant" -d "$body" | show
    ;;
  quitar)
    call -X POST "$API/internal/billing/grant" -d "{\"email\": \"${2:?email}\", \"quitar\": true}" | show
    ;;
  carreras)
    body=$(python3 -c 'import json,sys; print(json.dumps({"email": sys.argv[1], "carreras": int(sys.argv[2])}))' "${2:?email}" "${3:?cantidad}")
    call -X POST "$API/internal/billing/grant" -d "$body" | show
    ;;
  dolar)
    call -X POST "$API/internal/billing/rate" -d "{\"usd_ars\": ${2:?pesos}}" | python3 -c '
import json, sys
d = json.load(sys.stdin)
print("Dólar de referencia: $ %s" % d["usd_ars"])
for k, v in d["precios"].items(): print("  %-12s $ %s" % (k, format(v, ",").replace(",", ".")))'
    ;;
  cuentas)
    call "$API/internal/billing/accounts" | python3 -c '
import json, sys
d = json.load(sys.stdin)
print("Dólar de referencia: $ %s" % d["usd_ars"])
for c in d["cuentas"]:
    print("  %-34s %-11s %-10s %3s carreras  %s" % (c["email"], c["plan"], (c["hasta"] or "")[:10], c["creditos"], c["nota"] or ""))'
    ;;
  *) sed -n 2,8p "$0"; exit 1 ;;
esac
