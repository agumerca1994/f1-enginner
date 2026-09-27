#!/usr/bin/env bash
#
# Dispara el rebuild de producción en Easypanel.
#
# El webhook por sí solo no mira lo que estás por deployar: Easypanel toma
# `main` de GitHub, así que si lo tirás con `main` local adelantado (o sucio, o
# desactualizado respecto del remoto) deployás algo distinto de lo que tenés en
# pantalla, y no hay nada en la respuesta que lo delate. Este script chequea eso
# antes, pide confirmación, y recién ahí llama al webhook.
#
#   ./scripts/deploy.sh          # chequeos + confirmación + deploy
#   ./scripts/deploy.sh --check  # solo los chequeos, no deploya (dry run)
#   ./scripts/deploy.sh --yes    # sin confirmación interactiva
#   ./scripts/deploy.sh --force  # deploya aunque los chequeos fallen
#
# La credencial vive en .deploy.env (gitignorado). Este archivo no la contiene
# ni debe contenerla.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

CHECK_ONLY=false
ASSUME_YES=false
FORCE=false

for arg in "$@"; do
  case "$arg" in
    --check|-n) CHECK_ONLY=true ;;
    --yes|-y)   ASSUME_YES=true ;;
    --force|-f) FORCE=true ;;
    --help|-h)
      sed -n '3,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Opción desconocida: $arg (probá --help)" >&2
      exit 2
      ;;
  esac
done

# ── Chequeos previos ─────────────────────────────────────────────────────────
problems=0
note()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn()  { printf '  \033[31m✗\033[0m %s\n' "$1"; problems=$((problems + 1)); }

echo "Chequeos previos"

branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" = "main" ]; then
  note "estás en main"
else
  warn "estás en '$branch', no en main — Easypanel deploya main"
fi

if [ -z "$(git status --porcelain)" ]; then
  note "working tree limpio"
else
  warn "hay cambios sin commitear (no se van a deployar)"
fi

git fetch --quiet origin main 2>/dev/null || true
ahead="$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)"
behind="$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)"
if [ "$ahead" = "0" ] && [ "$behind" = "0" ]; then
  note "main local == origin/main"
elif [ "$ahead" != "0" ]; then
  warn "tenés $ahead commit(s) sin pushear — no van a entrar en este deploy"
else
  warn "estás $behind commit(s) atrás de origin/main"
fi

if [ -f .deploy.env ]; then
  note ".deploy.env presente"
else
  warn "falta .deploy.env (ahí vive la URL del webhook)"
fi

echo
echo "Se va a deployar: $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"

if [ "$problems" -gt 0 ] && [ "$FORCE" != true ]; then
  echo
  echo "$problems chequeo(s) fallaron. Arreglalos, o corré con --force si sabés lo que hacés." >&2
  exit 1
fi

if [ "$CHECK_ONLY" = true ]; then
  echo
  echo "(--check: no se disparó nada)"
  exit 0
fi

# ── Confirmación ─────────────────────────────────────────────────────────────
# No hay dry run del lado de Easypanel: cualquier request a esa URL arranca el
# rebuild. Por eso se pregunta salvo que pidas --yes.
if [ "$ASSUME_YES" != true ]; then
  echo
  printf '¿Deployar a producción? [s/N] '
  read -r answer
  case "$answer" in
    s|S|si|Si|SI|y|Y|yes) ;;
    *) echo "Cancelado."; exit 0 ;;
  esac
fi

# ── Deploy ───────────────────────────────────────────────────────────────────
set -a
# shellcheck disable=SC1091
. ./.deploy.env
set +a

: "${EASYPANEL_DEPLOY_URL:?falta EASYPANEL_DEPLOY_URL en .deploy.env}"

echo
echo "Disparando el rebuild..."
body="$(mktemp)"
trap 'rm -f "$body"' EXIT

code="$(curl -sS -o "$body" -w '%{http_code}' -X POST "$EASYPANEL_DEPLOY_URL" --max-time 60 || echo 000)"

if [ "$code" = "200" ]; then
  printf '\033[32m✓\033[0m HTTP %s — %s\n' "$code" "$(cat "$body")"
  echo
  # El webhook no devuelve build id ni estado, y el rebuild es rolling: el sitio
  # sigue respondiendo 200 mientras tanto, así que un 200 no prueba que la
  # imagen nueva ya esté arriba.
  echo "El rebuild arrancó. No devuelve estado ni build id, así que para saber si"
  echo "la imagen nueva levantó, mirá la app o los logs de Easypanel:"
  echo "  https://f1-api.imanzanastore.com.ar/health"
elif [ "$code" = "000" ]; then
  echo "✗ Timeout o fallo de red." >&2
  echo "  Suele significar que EASYPANEL_DEPLOY_URL apunta al host interno" >&2
  echo "  (159.112.147.178:3000), que no está publicado. Tiene que ser el dominio" >&2
  echo "  del panel: imanzanastore.com.ar" >&2
  exit 1
else
  printf '✗ HTTP %s — %s\n' "$code" "$(cat "$body")" >&2
  exit 1
fi
