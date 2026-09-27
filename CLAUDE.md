# AI race engineer (EA SPORTS F1® 24 telemetry)

The plan and its phases are in `docs/plan.md`; read it before starting a new phase.

## Layout
- `bridge/`: Go program that runs on the player's computer. It reads only the 29-byte packet header; all body parsing happens on the server.
- `backend/`: FastAPI app.
  - `app/telemetry/` is the parser. Each format has its own file, e.g. `formats/f2024.py`, and is registered in `registry.FORMATS`.
  - `app/ingest/` holds the uplink protocol and per-connection processing.
  - `app/live/` holds the in-memory state and the snapshot built from it.
- `fixtures/captures/`: real `.f1cap.zst` captures, stored in git-lfs. They are the golden test data.

## Principles
- **Connection-agnostic.** The console's network is the player's problem, and real captures arrive with about 19% reception over Wi-Fi.
  - Never assume consecutive packets or a fixed rate.
  - The state keeps the last value of each field, with its age.
  - Rules derive facts from state packets as well as from one-shot Event packets.
- **Nothing per packet touches the database.** Live state lives in memory; the DB is written only on session changes and in periodic flushes.
- **Bridge tokens (`rbd_`) and pairing codes (`rbp_`) are stored only as sha256 hashes.**

## Commands
```sh
docker compose up -d db                                   # local Postgres on 127.0.0.1:5433
cd backend && .venv/bin/python -m pytest -q               # parser + integration tests (needs the db)
cd backend && AUTH_DEV_MODE=true INTERNAL_LOG_KEY=dev-key CAPTURE_DIR=/tmp/captures .venv/bin/uvicorn app.main:app --port 8000
cd bridge && go test ./... && go build -o bin/bridge ./cmd/bridge
BRIDGE_CONFIG=/tmp/bridge.json bridge/bin/bridge pair --server http://localhost:8000
```

`AUTH_DEV_MODE` accepts an `X-Dev-User: <email>` header instead of a Firebase token. It is forced off in production.

Until the web app's `/pair` page exists (P2), a pairing code is confirmed with `POST /internal/devices/pair/confirm` and the `x-internal-key` header.

## Deploy
Easypanel builds `docker-compose.prod.yml` from GitHub `main`. Run `scripts/deploy.sh`: it checks git state, then calls the webhook stored in the gitignored `.deploy.env`.

Service names carry the `f1eng-` prefix because the `easypanel` Docker network is shared with other projects.

## Conventions
- Commit messages: `type(scope): message`, written in Spanish.
- Code comments are in English.
- Never use "F1", "Formula 1" or "EA" in product naming. Only the phrase "compatible with EA SPORTS F1® 24 telemetry" is allowed.
