# AI race engineer (EA SPORTS F1® 24 telemetry)

The plan, the phase status and the decisions made so far are in `docs/plan.md`, in the "Estado actual" section. Read it before starting new work.

Current state:
- P0, P1 and P2 are in production.
- The Mac menu-bar app is built; the Windows build compiles but is untested on Windows.
- Session replays are in production.
- P3 is in production: the engineer runs in production on `claude (pro)` (Sonnet per lap, Opus on events) — the key is set in Easypanel, verified via `GET /internal/engineer`. Without a key it falls back to rules. The dashboard shows per-sector times, FIA flags, off-track surface and G-forces.
- P5 is in production: a public, read-only MCP at `/mcp` (OAuth 2.1 plus personal tokens, ported from registrapp). The tools live in `backend/app/mcp_server/tools.py`; recorded sessions are analysed by `app/engineer/review.py`.
- The engineer lays out a pit-stop plan at race start (`race_start` trigger) and carries per-track pace/degradation across sessions via `track_knowledge` (`app/engineer/knowledge.py`), fed back as `conocimiento_previo`.
- 2026 regulations (2026 packet format) are surfaced end to end: active aero mode and zones, overtake mode (player and every car), ERS harvest vs the per-lap limit, tyre blisters (2025 format onwards) and livery colours. The snapshot carries them (`aero`, `status.ers_harvest_limit_mj`, `damage.tyre_blisters_percent`, `cars[].overtake_active`), the engineer gets `reglamento_2026` in its facts and calls `overtake_available`, `rival_overtake` and `blisters`, and the dashboard shows them; older formats leave these fields `None`.
- Live timing (`app/live/timing.py`), ideas taken from the ACC overlay Landelta: delta to the best complete clean lap at the same lap distance (`lap.delta_best_ms`), relatives by physical distance with lapped traffic (`relatives`), race catch forecasts from clean-lap pace (`pace`) and the last two laps by sector against the best clean lap (`sector_review`). Keyed on the game clock and lap distance, so it survives packet loss and works in replays. Assetto Corsa Competizione on PC is planned (see `docs/plan.md`).
- Live telemetry surfaced to the engineer: per-sector times (`sector_completed`), FIA flags (`blue_flag`) and per-wheel surface/off-track, G-forces and orientation, marshal zones, and slip from `motion_ex` — in the snapshot, the facts and the recorded-session review.

## Layout
- **`bridge/`** (Go) runs on the player's computer. It reads only the 29-byte packet header; all body parsing happens on the server.
  - `cmd/bridge` is the CLI.
  - `cmd/bridge-app` is the tray app (Fyne) for macOS and Windows. Its "Modo desarrollo" records raw samples of any packet format to `<config>/race-engineer/muestras/`.
  - Both drive `internal/agent`.
- **`backend/`** (FastAPI):
  - `app/telemetry/` is the parser. Each format has its own file and is registered in `registry.FORMATS`: `formats/f2024.py`, `formats/f2025.py`, which reuses the 2024 layouts and redefines only Participants, FinalClassification, LobbyInfo, CarDamage, MotionEx and the new LapPositions (id 15), and `formats/f2026.py` (2026 Season Pack): 24 car slots, 16-bit driver/network/team ids (teams 476–486), 8-bit engine temperature, a larger Session (active-aero and DRS zones) and the new CarTelemetry2 (id 16). A format can define `DECODE` to repack a record after parsing; 2026 uses it to turn the quantised int16 g-forces (thousandths of a g) back into floats. Code must not assume 22 cars: use `LiveSession.slots()` or the array length.
  - `app/ingest/` handles the uplink.
  - `app/live/` holds the in-memory state, the snapshot and the track-outline builder.
  - `app/replay/` plays stored captures back through the same live state.
  - `app/mcp_server/` is the MCP connector; its OAuth endpoints are in `routers/oauth.py`.
- **`frontend/`** (Next.js 15 + Tailwind 4 PWA): `/`, `/sessions`, `/replay/[id]`, `/pair`, `/settings`.
- **`landing/`**: the public landing (static HTML + nginx), served as `f1eng-landing` at `web-f1.imanzanastore.com.ar`: the home (`index.html`) and `/instructivos` (`instructivos.html`, deep links `#consola`, `#pc`, `#claude`, `#chatgpt`). Shared styles and script are `assets/site.css` and `assets/site.js`; bump their `?v=` when they change, since `/assets/` is cached for 7 days. Its download buttons point to the latest GitHub release assets `ingeniero-bridge-windows.zip` and `ingeniero-bridge-mac.zip`; binaries never go in git.
- **`fixtures/captures/`**: real `.f1cap.zst` captures, stored in git-lfs. They are the golden test data; `baku-carrera-wifi` was recorded over a lossy link at ~19% reception, and three F1 25 + 2026 season pack races cover each packet format: `texas-carrera-temporada2026-formato2024` (team ids 220–230, 22 cars), `madrid-carrera-temporada2026-formato2025` and `suzuka-carrera-temporada2026-formato2026` (24 slots, team ids 476–486).

## Principles
- **Connection-agnostic.** The console's network is the player's problem.
  - Never assume consecutive packets or a fixed rate.
  - The state keeps the last value of each field, with its age.
  - Rules derive facts from state packets as well as from one-shot Event packets.
  - Fields that a restricted online player does not share are `None`, never `0`.
- **Nothing per packet touches the database.** Live state lives in memory; the DB is written only on session changes and in periodic flushes.
- **Bridge tokens (`rbd_`), pairing codes (`rbp_`) and MCP tokens (`rbm_`) are stored only as sha256 hashes.**
- **Track outlines are built from telemetry** and shared across all players, in the `track_layouts` table. Undriven stretches stay open rather than being drawn as a straight line.

## Commands
```sh
docker compose up -d db                                   # local Postgres on 127.0.0.1:5433
cd backend && .venv/bin/python -m pytest -q               # parser + integration tests (needs the db)
cd backend && AUTH_DEV_MODE=true INTERNAL_LOG_KEY=dev-key CAPTURE_DIR=/tmp/captures \
  ALLOWED_ORIGINS=http://localhost:3000 .venv/bin/uvicorn app.main:app --port 8000
cd frontend && npm run dev                                # uses .env.local; NEXT_PUBLIC_DEV_USER skips Google sign-in
cd bridge && go test ./... && go build -o bin/bridge ./cmd/bridge
BRIDGE_CONFIG=/tmp/bridge.json bridge/bin/bridge pair --server http://localhost:8000
bridge/bin/bridge replay --in fixtures/captures/baku-carrera-wifi.f1cap.zst --to 127.0.0.1:20777   # feed a running bridge
./scripts/build-mac-app.sh [version]                      # universal bridge/bin/Ingeniero Bridge.app + ingeniero-bridge-mac.zip
./scripts/build-windows-app.sh [version]                  # bridge/bin/windows/*.zip (needs brew mingw-w64)
```

`MCP_AUTH_DISABLED=true` opens `/mcp` without a token, acting as the first player (local only; forced off in production).

`AUTH_DEV_MODE` makes the API accept `X-Dev-User: <email>` in HTTP requests, or `dev_user` in the first message on a WebSocket. It is forced off in production.

The frontend ignores `NEXT_PUBLIC_DEV_USER` in production builds.

A bridge's config lives in `~/Library/Application Support/race-engineer/config.json`; set `BRIDGE_CONFIG` to use another file. The app logs to `~/Library/Logs/RaceEngineer/bridge-app.log` (macOS) or `%LocalAppData%\RaceEngineer\Logs\bridge-app.log` (Windows).

## Deploy
The repository is **public** (Easypanel could not read it as private), so secrets never go in git. They live in:
- `.env.production` and `.deploy.env`, both gitignored;
- `secret/`, which holds the Firebase service-account key and is gitignored;
- Easypanel → Entorno.

Before every commit, check the staged files for secrets.

Easypanel builds `docker-compose.prod.yml` from GitHub `main`: services `f1eng-db`, `f1eng-api` and `f1eng-web`. They carry the `f1eng-` prefix because the `easypanel` Docker network is shared with other projects.
- Run `scripts/deploy.sh` to deploy. It checks git state, then calls the webhook.
- Bridge downloads: build both apps, then `gh release create vX.Y.Z bridge/bin/ingeniero-bridge-mac.zip bridge/bin/ingeniero-bridge-windows.zip` (fixed asset names; the landing links to `releases/latest/download/...`).
- A new required env var must be added in Easypanel **before** deploying. The compose fails fast with `:?` when one is missing.

Production diagnostics use `GET /internal/{devices,sessions,live,logs,logs/summary}` with the header `x-internal-key` (the value is in `.env.production`).

## Conventions
- Commit messages: `type(scope): message`, written in Spanish.
- Code comments are in English.
- UI text is in Spanish (Argentina).
- Never use "F1", "Formula 1" or "EA" in product naming. Only the phrase "compatible with EA SPORTS F1® 24 telemetry" is allowed.
