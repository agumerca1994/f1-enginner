import itertools
import json
import os
import time
from pathlib import Path

import pytest
from starlette.websockets import WebSocketDisconnect

from app.ingest.protocol import encode_batch
from app.telemetry import capture
from tests.test_parser import BAKU_RACE, needs_baku

INTERNAL = {"x-internal-key": "test-internal-key"}
_emails = (f"player{i}@example.test" for i in itertools.count())


def pair_bridge(client, email: str) -> str:
    """Run the whole pairing flow and return the bridge's device token."""
    start = client.post("/api/devices/pair/start", json={"name": "Test Mac", "os": "darwin", "arch": "arm64"}).json()
    assert start["verification_url"] == "https://app.example.test/pair"
    assert len(start["user_code"]) == 9 and start["user_code"][4] == "-"

    assert client.post("/api/devices/pair/poll", json={"device_code": start["device_code"]}).json() == {
        "status": "pending", "token": None, "device_id": None,
    }
    r = client.post("/api/devices/pair/confirm", json={"user_code": start["user_code"].lower()},
                    headers={"X-Dev-User": email})
    assert r.status_code == 200, r.text

    done = client.post("/api/devices/pair/poll", json={"device_code": start["device_code"]}).json()
    assert done["status"] == "complete" and done["token"].startswith("rbd_")
    # The token is handed out exactly once.
    assert client.post("/api/devices/pair/poll", json={"device_code": start["device_code"]}).json()["status"] == "expired"
    return done["token"]


def test_pairing_flow_and_device_list(client):
    email = next(_emails)
    pair_bridge(client, email)
    devices = client.get("/api/devices", headers={"X-Dev-User": email}).json()
    assert [d["name"] for d in devices] == ["Test Mac"]
    assert devices[0]["token_prefix"].startswith("rbd_")
    # Another player cannot see it.
    assert client.get("/api/devices", headers={"X-Dev-User": next(_emails)}).json() == []


def test_confirm_rejects_unknown_code(client):
    r = client.post("/api/devices/pair/confirm", json={"user_code": "AAAA-AAAA"}, headers={"X-Dev-User": next(_emails)})
    assert r.status_code == 404


def test_internal_confirm_requires_key(client):
    start = client.post("/api/devices/pair/start", json={"name": "Mac"}).json()
    body = {"user_code": start["user_code"], "email": next(_emails)}
    assert client.post("/internal/devices/pair/confirm", json=body, headers={"x-internal-key": "wrong"}).status_code == 403
    assert client.post("/internal/devices/pair/confirm", json=body, headers=INTERNAL).status_code == 200
    assert client.post("/api/devices/pair/poll", json={"device_code": start["device_code"]}).json()["status"] == "complete"


def test_ingest_rejects_bad_and_revoked_tokens(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ingest/v1", headers={"Authorization": "Bearer rbd_nope"}) as ws:
            ws.receive_json()

    email = next(_emails)
    token = pair_bridge(client, email)
    device_id = client.get("/api/devices", headers={"X-Dev-User": email}).json()[0]["id"]
    assert client.delete(f"/api/devices/{device_id}", headers={"X-Dev-User": email}).status_code == 204
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ingest/v1", headers={"Authorization": f"Bearer {token}"}) as ws:
            ws.receive_json()


def test_malformed_batches_do_not_drop_the_connection(client):
    email = next(_emails)
    token = pair_bridge(client, email)
    with client.websocket_connect("/ingest/v1", headers={"Authorization": f"Bearer {token}"}) as ws:
        assert ws.receive_json()["type"] == "welcome"
        ws.send_bytes(b"not zstd at all")
        ws.send_bytes(encode_batch([(time.time_ns(), b"\x00" * 10)]))
        ws.send_text("not json")
        ws.send_text(json.dumps({"type": "heartbeat", "reception": 0.5}))
        ws.send_text(json.dumps({"type": "bye"}))
        assert ws.receive_json() == {"type": "goodbye"}  # still alive after all that
    # Nothing valid arrived, so there is no live state, but the server is fine.
    assert client.get("/api/live", headers={"X-Dev-User": email}).status_code == 404
    assert client.get("/health").json() == {"status": "ok"}


@needs_baku
def test_baku_race_through_the_uplink(client):
    email = next(_emails)
    token = pair_bridge(client, email)
    _, records = capture.read(BAKU_RACE)
    records = list(records)

    # Group into 100 ms batches, as the bridge does.
    t0 = time.time_ns()
    batches = [
        [(t0 + r.offset_ns, r.data) for r in group]
        for _, group in itertools.groupby(records, key=lambda r: r.offset_ns // 100_000_000)
    ]

    with client.websocket_connect("/ingest/v1", headers={"Authorization": f"Bearer {token}"}) as ws:
        assert ws.receive_json()["type"] == "welcome"
        ws.send_text(json.dumps({"type": "hello", "bridge_version": "test", "os": "darwin", "arch": "arm64"}))
        ws.send_text(json.dumps({"type": "heartbeat", "reception": 0.19, "source": "192.168.100.133"}))
        for batch in batches:
            ws.send_bytes(encode_batch(batch))
        ws.send_text(json.dumps({"type": "bye"}))
        assert ws.receive_json() == {"type": "goodbye"}  # everything is saved by now

    headers = {"X-Dev-User": email}
    live = client.get("/api/live", headers=headers).json()
    assert live["session"]["track"] == "Baku (Azerbaijan)"
    assert live["session"]["type"] == "Race"
    assert live["driver"]["name"] == "GASLY" and live["driver"]["team"] == "Alpine"
    assert 1 <= live["lap"]["position"] <= 20
    assert live["status"]["tyre"] == "Medium"
    assert live["damage"]["front_left_wing"] == 100
    assert live["link"] == {"reception": 0.19, "source": "192.168.100.133", "packets": 1715, "rejected": 0}
    assert {e["code"] for e in live["events"]} & {"OVTK", "COLL", "SCAR", "PENA"}
    assert live["car"]["suggested_gear"] in (None, *range(1, 9))

    # Every car, ordered, with the player marked and map coordinates.
    cars = live["cars"]
    assert len(cars) == 20 and [c["position"] for c in cars] == list(range(1, 21))
    assert [c["name"] for c in cars if c["is_player"]] == ["GASLY"]
    assert cars[0]["name"] == "VERSTAPPEN" and all(c["x"] is not None for c in cars)

    # The circuit outline is being built from those positions (Baku is 5994 m;
    # the capture ends before any car completes the first lap).
    assert live["track"]["id"] == 20 and not live["track"]["layout_ready"]
    layout = client.get("/api/tracks/20/layout", headers={"X-Dev-User": email}).json()
    assert 0.6 < layout["coverage"] < 0.8
    assert len(layout["segments"]) == 1 and len(layout["segments"][0]) > 350

    sessions = client.get("/api/sessions", headers=headers).json()
    assert len(sessions) == 1
    s = sessions[0]
    assert (s["track"], s["session_type"], s["total_laps"], s["game_version"]) == ("Baku (Azerbaijan)", "Race", 18, "24 v1.21")
    assert s["packets_received"] == 1715

    # The outline was saved for everyone: another player gets it from the database.
    saved = client.get("/api/tracks/20/layout", headers={"X-Dev-User": next(_emails)}).json()
    assert saved["coverage"] == layout["coverage"]

    # Operator diagnostics see the same session, and only with the internal key.
    assert client.get("/internal/sessions", headers={"x-internal-key": "wrong"}).status_code == 403
    assert s["session_uid"] in [x["session_uid"] for x in client.get("/internal/sessions", headers=INTERNAL).json()]
    live_rows = client.get("/internal/live", headers=INTERNAL).json()
    row = next(r for r in live_rows if r["session_uid"] == s["session_uid"])
    assert row["packets"] == 1715 and row["reception"] == 0.19
    full = client.get("/internal/live", params={"tenant_id": row["tenant_id"]}, headers=INTERNAL).json()
    assert full["driver"]["name"] == "GASLY"
    device = next(d for d in client.get("/internal/devices", headers=INTERNAL).json() if d["email"] == email)
    assert device["last_reception"] == 0.19 and device["bridge_version"] == "test"

    # The server kept a raw capture the bridge can replay, byte for byte.
    files = list(Path(os.environ["CAPTURE_DIR"]).rglob(f"{s['session_uid']}-*.f1cap.zst"))
    assert len(files) == 1
    _, stored = capture.read(files[0])
    assert [r.data for r in stored] == [r.data for r in records]


def test_bridge_sees_its_account_and_unlinks_itself(client):
    email = next(_emails)
    token = pair_bridge(client, email)
    auth = {"Authorization": f"Bearer {token}"}
    me = client.get("/api/devices/self", headers=auth).json()
    assert me["email"] == email and me["name"] == "Test Mac"

    assert client.delete("/api/devices/self", headers=auth).status_code == 204
    assert client.get("/api/devices/self", headers=auth).status_code == 401
    devices = client.get("/api/devices", headers={"X-Dev-User": email}).json()
    assert devices[0]["revoked_at"] is not None
    # The player-facing delete still works by id, and "self" is not mistaken for one.
    assert client.delete("/api/devices/self", headers={"X-Dev-User": email}).status_code == 401
