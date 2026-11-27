# AI race engineer (EA SPORTS F1® 24 telemetry)

The plan, the phase status and the decisions made so far are in `docs/plan.md`, in the "Estado actual" section. Read it before starting new work.

Current state:
- P0, P1 and P2 are in production.
- The Mac menu-bar app is built; the Windows build compiles but is untested on Windows.
- Session replays are in production.
- P4 (engineer like a real F1 radio) is in progress, see `docs/investigacion-radio-y-voz.md`: stage 1 ships corner-by-corner coaching (`app/engineer/corners.py`), worn-tyre calls, a quick radio lane on Claude Haiku 5.5 separate from the pit-wall call (`EngineerRunner` lanes) and an outbox that holds radio calls until the next straight. Stage 2 (2026-11-24) makes it conversational, from the driver's Las Vegas/Qatar reports: the driver asks from the dashboard ("Hablar", browser speech recognition, or typed) at `POST /api/engineer/ask` (`app/engineer/talk.py`, small tools, Sonnet 5.5 at low effort, `prompts/talk_es.md`); a weekend memory (`app/engineer/memory.py`, `engineer_memories`: driver reports, setup history vs what was agreed, race plan, last said) goes into every call as `memoria`; the radio name is `users.radio_name`, never the game's driver; silence rules in `EngineerRunner` (flying lap only urgent, one call per sector, no repeated `tema`, two unasked per lap, quiet on request); prioritised `alertas` in the facts. Natural voice (Supertonic 3, voice 3) comes next.
- Lusail review (2026-11-27): the engineer gets `incidentes` in its facts and the talk tool of the same name (contacts with the player by name, sanctions with their reason and stop-go/drive-through still to serve, passes, retirements, nearby rivals who stopped), `ajustes_en_carrera` under parc fermé (`app/engineer/adjust.py`: brake bias and differential on throttle from the wheel, front wing at the stop; never bars or rear wing in a race) and instantaneous tyre temperatures. Routine radio rotates angle and opening (`app/engineer/variety.py`; the rules radio picks among templates); lap moments fire once per lap across flashbacks, sector calls only when worse than the last laps, the radio summary only after the chequered flag or half the race. Spoken text goes through `frontend/lib/spoken.ts` / `app/engineer/spoken.py` ("3°" → "tercero", "0,3 s" → "segundos"). `TRACKS` are Spanish display names; `TRACKS_GAME` keeps the game's names for lookups.
- P3 is in production: the engineer runs in production on `claude (pro)` (Sonnet 5.5 per lap, Opus 5.5 on events) — the key is set in Easypanel, verified via `GET /internal/engineer`. Without a key it falls back to rules. The dashboard shows per-sector times, FIA flags, off-track surface and G-forces.
- BOX and Reglaje tabs are in production (see below and `docs/plan.md`).
- P5 is in production: a public, read-only MCP at `/mcp` (OAuth 2.1 plus personal tokens, ported from registrapp). The tools live in `backend/app/mcp_server/tools.py` (small live tools `get_live_status`, `get_corner_analysis`, `get_tyres`, `get_strategy`, `get_setup_status`, `get_engineer_memory` reuse `talk.py`; `save_driver_report` is the only one that writes); recorded sessions are analysed by `app/engineer/review.py`.
- The engineer lays out a pit-stop plan at race start (`race_start` trigger) and carries per-track pace/degradation across sessions via `track_knowledge` (`app/engineer/knowledge.py`), fed back as `conocimiento_previo`.
- 2026 regulations (2026 packet format) are surfaced end to end: active aero mode and zones, overtake mode (player and every car), ERS harvest vs the per-lap limit, tyre blisters (2025 format onwards) and livery colours. The snapshot carries them (`aero`, `status.ers_harvest_limit_mj`, `damage.tyre_blisters_percent`, `cars[].overtake_active`), the engineer gets `reglamento_2026` in its facts and calls `overtake_available`, `rival_overtake` and `blisters`, and the dashboard shows them; older formats leave these fields `None`.
- Live timing (`app/live/timing.py`), ideas taken from the ACC overlay Landelta: delta to the best complete clean lap at the same lap distance (`lap.delta_best_ms`), relatives by physical distance with lapped traffic (`relatives`), race catch forecasts from clean-lap pace (`pace`) and the last two laps by sector against the best clean lap (`sector_review`). Keyed on the game clock and lap distance, so it survives packet loss and works in replays. The engineer gets them as `sectores.vuelta_en_curso.delta_vs_mejor_vuelta_s` and `rivales.alcance`, and the rules tier calls a catch within 3 laps. Assetto Corsa Competizione on PC is planned (see `docs/plan.md`).
- The BOX tab (stage 1 of the practice "box", see `docs/plan.md`): speed/throttle/brake/gear traces by lap distance from the recordings (`app/engineer/traces.py`, 5 m bins, every car's best lap kept as a reference), the setup of each lap and a corner-by-corner comparison (`app/engineer/box.py`), served at `GET /api/sessions/{id}/box` and `/box/compare?a=car:lap&b=car:lap` and in the MCP as `compare_lap_telemetry`. The live session is served from memory (the live `EngineerRunner.traces`, via `review.review_for`), with the lap in progress at `/box/live`; recorded sessions replay the capture. Setup advice per run (`app/engineer/setup_advice.py`, rules only, every run of every recorded session) shows in BOX and in the MCP as `get_setup_advice`. A base setup per track (`app/engineer/base_setup.py`, `GET /api/setup/base`) and the player's best setup per track (`track_knowledge.summary.mejor_reglaje`, dry and wet) fill the Reglaje tab before there is a run. Each track's first corner map is stored in `track_layouts.corners` and seeds every session's `CornerCoach`, so corner N is the same corner everywhere; the track map draws the numbers.
- Phase 1 (community, 2026-11-26): closed beta with invite codes (`app/routers/access.py`, `scripts/access.sh`), a per-track leaderboard (`app/live/records.py`, `lap_records`, `/api/leaderboard`) and a shareable session card on the summary (`components/session/ShareCard.tsx`, canvas, backgrounds in `frontend/public/compartir/` rendered by `landing/render/blender/share_bg.py`). Groups and leagues (`app/routers/groups.py`, `/grupos`, `/api/leaderboard?grupo=`). Plans and payments (`app/billing/`; players see them as Debut, Temporada, Pase libre and Carreras Pro, `PLAN_NAMES` in `frontend/lib/billing.ts`: free = 3 trial Pro races and the rules "radio de avisos" for 5 races a month; subscription = unlimited alert radio and 3 Pro (AI) races a month; Pro race packs; courtesy. A race is a 45-minute block of a session, charged by `EngineerRunner._access` the first time the engineer speaks in it: Pro, else alert radio, else silent; talking is Pro only; the MCP and linked screens are gated too). Mercado Pago over plain HTTPS, notices always read back; `PLAN_LIMITS` is off in production until it is set up, see `docs/cobros-mercadopago.md` and `scripts/plans.sh`. Next: a venue's logo on the card, boards per period.
- Live telemetry surfaced to the engineer: per-sector times (`sector_completed`), FIA flags (`blue_flag`) and per-wheel surface/off-track, G-forces and orientation, marshal zones, and slip from `motion_ex` — in the snapshot, the facts and the recorded-session review.

## Layout
- **`bridge/`** (Go) runs on the player's computer. It reads only the 29-byte packet header; all body parsing happens on the server.
  - `cmd/bridge` is the CLI.
  - `cmd/bridge-app` is the tray app (Fyne) for macOS and Windows. Its "Modo desarrollo" records raw samples of any packet format to `<config>/race-engineer/muestras/`. On Windows it also shows floating panels over the game (`internal/overlay`): drawn in pure Go (testable on the Mac: `OVERLAY_PNG_DIR=… go test ./internal/overlay`) and shown in layered, topmost, click-through windows (`host_windows.go`). They read the live snapshot over `/live/v1` with the bridge's own token (`{"type": "auth", "device_token": ...}`) and the pedals straight from the local CarTelemetry packets (`agent.Config.OnPacket`). Settings also has "Carrera de demostración", which plays an embedded, trimmed Madrid race (`cmd/bridge-app/demo/`, git-lfs) into the app's own port, and "Generar diagnóstico", a zip in Downloads with a summary and the log tail, without the token and with the user name and host scrubbed.
  - Both drive `internal/agent`.
  - `internal/acc` reads Assetto Corsa Competizione on Windows (shared-memory pages plus the broadcasting UDP API on localhost, set up in `broadcasting.json`) and wraps each read in an `ACC<kind>` record. For now it only feeds the development-mode "Grabar muestra de ACC"; nothing is uploaded yet.
- **`backend/`** (FastAPI):
  - `app/telemetry/` is the parser. Each format has its own file and is registered in `registry.FORMATS`: `formats/f2024.py`, `formats/f2025.py`, which reuses the 2024 layouts and redefines only Participants, FinalClassification, LobbyInfo, CarDamage, MotionEx and the new LapPositions (id 15), and `formats/f2026.py` (2026 Season Pack): 24 car slots, 16-bit driver/network/team ids (teams 476–486), 8-bit engine temperature, a larger Session (active-aero and DRS zones) and the new CarTelemetry2 (id 16). A format can define `DECODE` to repack a record after parsing; 2026 uses it to turn the quantised int16 g-forces (thousandths of a g) back into floats. Code must not assume 22 cars: use `LiveSession.slots()` or the array length.
  - `app/telemetry/acc.py` decodes those ACC records (physics, graphics and static pages per Kunos' v1.8.12 documentation, and the broadcasting messages). Not checked against a real recording yet and not wired into the live state.
  - `app/ingest/` handles the uplink.
  - `app/live/` holds the in-memory state, the snapshot and the track-outline builder.
  - `app/replay/` plays stored captures back through the same live state.
  - `app/mcp_server/` is the MCP connector; its OAuth endpoints are in `routers/oauth.py`.
- **`frontend/`** (Next.js 15 + Tailwind 4 PWA). Built around where the car is (redesign of 2026-11-25, in production, mockups in the Claude canvas "Ingeniero de pista · nueva estructura"). One design system in `app/globals.css` (tokens plus `.card`, `.paper` for the light card, `.btn-primary`, `.btn-ink`, `.btn`, `.eyebrow`, `.display`, `.title`); three skins per device in Ajustes (`lib/theme.tsx`): Carbono (default), Clásico, Volante. `components/AppNav.tsx` has three tabs (Sesión · Circuitos · Ajustes) and wraps the signed-in app in `LiveProvider` (`lib/liveContext.tsx`: one live socket, the engineer's voice and always-on); an opt-in status bar per device (`components/ui/StatusBar.tsx`). The engineer is a dock at the foot of every screen (`components/ui/RadioDock.tsx`): talk in a session, elsewhere it only reads out text written by code. Routes: `/` is the session (`components/session/Session.tsx`): **Boxes** while the snapshot's `car_state` is `garage` (`Boxes.tsx`: last run and where its best lap lost time from `GET /api/sessions/{id}/report`, one setup change at a time, weather, `tyre_sets`, the plan) and **Pista** otherwise (the cockpit), switching by itself; no session shows the last summary and `ConnectGuide`. The cockpit is a grid of pieces (`lib/cockpit.ts`: `PIECES` with initial size, minimum, shape and what each size shows; `TEMPLATES`; layouts saved to the account at `/api/screens/cockpits`), drawn by `components/cockpit/` (`Pieces.tsx` adapts each piece to its size with container units and lights it when urgent), full screen at `/cockpit` (`/volante` redirects there) and built at `/cockpit/editar`. `/resumen/[id]` (session summary from `GET /api/sessions/{id}/summary`, written by `app/engineer/debrief.py`), `/circuitos` and `/circuitos/[id]` (`components/circuits/`: the tracks driven, the outline with numbered corners, the setup to load, notes from `track_knowledge`, the sessions there; `GET /api/setup/circuits`). Linked screens: a TV or tablet opens `/pantalla`, shows a QR and a code (`/api/screens/pair/start`), the signed-in phone confirms at `/vincular` with a role (`tabla`, `cockpit`, `muro`, `mapa`, `radio`, `panel`), which creates a read-only `rbo_` token with that role; listed and changed in Ajustes → Tus pantallas. Kept and restyled: `/box` (full telemetry charts), `/reglaje` (setup with the 3D car, `components/setup/CarViewer.tsx`, which now poses each part at the player's value and moves it towards the suggested one), `/sessions`, `/replay/[id]`, `/overlay/[panel]`, `/pair`, `/settings`.
- **`landing/`**: the public landing (static HTML + nginx), served as `f1eng-landing` at `web-f1.imanzanastore.com.ar`: the home (`index.html`) and `/instructivos` (`instructivos.html`, deep links `#consola`, `#pc`, `#claude`, `#chatgpt`). Shared styles and script are `assets/site.css` and `assets/site.js`; bump their `?v=` when they change, since `/assets/` is cached for 7 days. Its download buttons point to the latest GitHub release assets `ingeniero-bridge-windows.zip` and `ingeniero-bridge-mac.zip`; binaries never go in git.
- **`fixtures/captures/`**: real `.f1cap.zst` captures, stored in git-lfs. They are the golden test data; `baku-carrera-wifi` was recorded over a lossy link at ~19% reception, and three F1 25 + 2026 season pack races cover each packet format: `texas-carrera-temporada2026-formato2024` (team ids 220–230, 22 cars), `madrid-carrera-temporada2026-formato2025` and `suzuka-carrera-temporada2026-formato2026` (24 slots, team ids 476–486).

## Principles
- **Connection-agnostic.** The console's network is the player's problem.
  - Never assume consecutive packets or a fixed rate.
  - The state keeps the last value of each field, with its age.
  - Rules derive facts from state packets as well as from one-shot Event packets.
  - Fields that a restricted online player does not share are `None`, never `0`.
- **Nothing per packet touches the database.** Live state lives in memory; the DB is written only on session changes and in periodic flushes.
- **Bridge tokens (`rbd_`), pairing codes (`rbp_`), MCP tokens (`rbm_`) and overlay links (`rbo_`) are stored only as sha256 hashes.** An overlay link goes in a URL, so it only opens the live WebSocket read-only (`{"type": "auth", "overlay_token": ...}`); it is created and revoked in Settings (`/api/overlay/tokens`) and a revoked link drops within 30 s.
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
- Run `scripts/deploy.sh --yes` to deploy (without `--yes` it waits for an interactive confirmation). It checks git state, then calls the webhook; it does not report build status, so check the new route afterwards.
- Bridge downloads: build both apps, then `gh release create vX.Y.Z bridge/bin/ingeniero-bridge-mac.zip bridge/bin/ingeniero-bridge-windows.zip` (fixed asset names; the landing links to `releases/latest/download/...`).
- A new required env var must be added in Easypanel **before** deploying. The compose fails fast with `:?` when one is missing.

Production diagnostics use `GET /internal/{devices,sessions,live,logs,logs/summary}` with the header `x-internal-key` (the value is in `.env.production`).

## Conventions
- Commit messages: `type(scope): message`, written in Spanish.
- Code comments are in English.
- UI text is in Spanish (Argentina).
- Never use "F1", "Formula 1" or "EA" in product naming. Only the phrase "compatible with EA SPORTS F1® 24 telemetry" is allowed.
