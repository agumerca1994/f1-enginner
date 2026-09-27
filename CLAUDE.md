# AI race engineer (EA SPORTS F1® 24 telemetry)

The plan, the phase status and the decisions made so far are in `docs/plan.md`, in the "Estado actual" section. Read it before starting new work.

Current state:
- P0, P1 and P2 are in production.
- The Mac menu-bar app is built.
- Session replays are in production.
- P3 is in progress: the engineer engine exists in `backend/app/engineer/` and was dry-run tested on a real race (see "Estrategia de IA del ingeniero" in `docs/plan.md`). Next: connect it to an AI API and show it in the dashboard.

## Layout
- **`bridge/`** (Go) runs on the player's computer. It reads only the 29-byte packet header; all body parsing happens on the server.
  - `cmd/bridge` is the CLI.
  - `cmd/bridge-app` is the Mac menu-bar app (Fyne).
  - Both drive `internal/agent`.
- **`backend/`** (FastAPI):
  - `app/telemetry/` is the parser. Each format has its own file, e.g. `formats/f2024.py`, and is registered in `registry.FORMATS`.
  - `app/ingest/` handles the uplink.
  - `app/live/` holds the in-memory state, the snapshot and the track-outline builder.
  - `app/replay/` plays stored captures back through the same live state.
- **`frontend/`** (Next.js 15 + Tailwind 4 PWA): `/`, `/sessions`, `/replay/[id]`, `/pair`, `/settings`.
- **`fixtures/captures/`**: real `.f1cap.zst` captures, stored in git-lfs. They are the golden test data; `baku-carrera-wifi` was recorded over a lossy link at ~19% reception.

## Principles
- **Connection-agnostic.** The console's network is the player's problem.
  - Never assume consecutive packets or a fixed rate.
  - The state keeps the last value of each field, with its age.
  - Rules derive facts from state packets as well as from one-shot Event packets.
  - Fields that a restricted online player does not share are `None`, never `0`.
- **Nothing per packet touches the database.** Live state lives in memory; the DB is written only on session changes and in periodic flushes.
- **Bridge tokens (`rbd_`) and pairing codes (`rbp_`) are stored only as sha256 hashes.**
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
./scripts/build-mac-app.sh                                # builds bridge/bin/Ingeniero Bridge.app
```

`AUTH_DEV_MODE` makes the API accept `X-Dev-User: <email>` in HTTP requests, or `dev_user` in the first message on a WebSocket. It is forced off in production.

The frontend ignores `NEXT_PUBLIC_DEV_USER` in production builds.

A bridge's config lives in `~/Library/Application Support/race-engineer/config.json`; set `BRIDGE_CONFIG` to use another file. The Mac app logs to `~/Library/Logs/RaceEngineer/bridge-app.log`.

## Deploy
The repository is **public** (Easypanel could not read it as private), so secrets never go in git. They live in:
- `.env.production` and `.deploy.env`, both gitignored;
- `secret/`, which holds the Firebase service-account key and is gitignored;
- Easypanel → Entorno.

Before every commit, check the staged files for secrets.

Easypanel builds `docker-compose.prod.yml` from GitHub `main`: services `f1eng-db`, `f1eng-api` and `f1eng-web`. They carry the `f1eng-` prefix because the `easypanel` Docker network is shared with other projects.
- Run `scripts/deploy.sh` to deploy. It checks git state, then calls the webhook.
- A new required env var must be added in Easypanel **before** deploying. The compose fails fast with `:?` when one is missing.

Production diagnostics use `GET /internal/{devices,sessions,live,logs,logs/summary}` with the header `x-internal-key` (the value is in `.env.production`).

## Conventions
- Commit messages: `type(scope): message`, written in Spanish.
- Code comments are in English.
- UI text is in Spanish (Argentina).
- Never use "F1", "Formula 1" or "EA" in product naming. Only the phrase "compatible with EA SPORTS F1® 24 telemetry" is allowed.
