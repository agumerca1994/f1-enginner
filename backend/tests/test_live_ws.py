import itertools
import json
import time

import pytest
from starlette.websockets import WebSocketDisconnect

from app.ingest.protocol import encode_batch
from app.telemetry import capture
from tests.test_ingest import pair_bridge
from tests.test_parser import BAKU_RACE, needs_baku

_emails = (f"viewer{i}@example.test" for i in itertools.count())


def test_live_ws_requires_auth(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/live/v1") as ws:
            ws.send_json({"type": "auth", "token": "not-a-firebase-token"})
            ws.receive_json()


def test_live_ws_idle_without_telemetry(client, monkeypatch):
    from app.routers import live_ws

    monkeypatch.setattr(live_ws, "IDLE_EVERY_S", 0.2)
    with client.websocket_connect("/live/v1") as ws:
        ws.send_json({"type": "auth", "dev_user": next(_emails)})
        assert ws.receive_json() == {"type": "ready"}
        assert ws.receive_json() == {"type": "engineer_state", "active": False, "provider": "reglas", "messages": []}
        assert ws.receive_json() == {"type": "idle", "seconds_since_last_packet": None}


@needs_baku
def test_live_ws_pushes_the_players_snapshot(client):
    email = next(_emails)
    token = pair_bridge(client, email)
    _, records = capture.read(BAKU_RACE)
    first = list(itertools.islice(records, 800))  # enough to include a Participants packet

    with client.websocket_connect("/live/v1") as viewer:
        viewer.send_json({"type": "auth", "dev_user": email})
        assert viewer.receive_json() == {"type": "ready"}

        with client.websocket_connect("/ingest/v1", headers={"Authorization": f"Bearer {token}"}) as bridge:
            bridge.receive_json()
            t0 = time.time_ns()
            bridge.send_bytes(encode_batch([(t0 + r.offset_ns, r.data) for r in first]))
            bridge.send_text(json.dumps({"type": "bye"}))
            assert bridge.receive_json() == {"type": "goodbye"}

        # Wait for the snapshot that reflects the whole batch.
        data = {}
        while data.get("link", {}).get("packets") != 800:
            msg = viewer.receive_json()
            if msg["type"] == "snapshot":
                data = msg["data"]
        assert data["session"]["track"] == "Baku (Azerbaijan)"
        assert data["driver"]["name"] == "GASLY"

    # Another player's dashboard never sees this race.
    with client.websocket_connect("/live/v1") as other:
        other.send_json({"type": "auth", "dev_user": next(_emails)})
        assert other.receive_json() == {"type": "ready"}
