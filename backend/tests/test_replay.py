import itertools
import json
import time

import pytest
from starlette.websockets import WebSocketDisconnect

from app.ingest.protocol import encode_batch
from app.live import snapshot
from app.replay.player import ReplayPlayer, ReplaySource
from app.telemetry import capture
from tests.test_ingest import pair_bridge
from tests.test_parser import BAKU_RACE, needs_baku

_emails = (f"replayer{i}@example.test" for i in itertools.count())


@needs_baku
def test_seek_forward_and_back_give_the_same_state():
    source = ReplaySource([str(BAKU_RACE)])
    duration, count, builder = source.scan()
    assert count == 1715 and 105 < duration < 115
    assert builder is not None and builder.coverage > 0.6

    player = ReplayPlayer(source)
    player.seek(60)
    at_60 = snapshot.build(player.live)
    player.seek(90)
    assert snapshot.build(player.live)["lap"]["current_lap_ms"] > at_60["lap"]["current_lap_ms"]
    player.seek(60)  # backwards: rebuilt from the start
    again = snapshot.build(player.live)
    assert again["lap"] == at_60["lap"] and again["car"] == at_60["car"]
    player.seek(duration)
    assert player.finished


def _ingest_baku(client, email):
    token = pair_bridge(client, email)
    _, records = capture.read(BAKU_RACE)
    t0 = time.time_ns()
    with client.websocket_connect("/ingest/v1", headers={"Authorization": f"Bearer {token}"}) as ws:
        ws.receive_json()
        for _, group in itertools.groupby(records, key=lambda r: r.offset_ns // 100_000_000):
            ws.send_bytes(encode_batch([(t0 + r.offset_ns, r.data) for r in group]))
        ws.send_text(json.dumps({"type": "bye"}))
        assert ws.receive_json() == {"type": "goodbye"}
    sessions = client.get("/api/sessions", headers={"X-Dev-User": email}).json()
    assert sessions[0]["has_recording"]
    return sessions[0]["id"]


def _frame(ws):
    msg = ws.receive_json()
    while msg["type"] != "frame":
        msg = ws.receive_json()
    return msg


@needs_baku
def test_replay_over_websocket(client):
    email = next(_emails)
    session_id = _ingest_baku(client, email)

    with client.websocket_connect("/replay/v1") as ws:
        ws.send_json({"type": "auth", "dev_user": email, "session_id": session_id})
        ready = ws.receive_json()
        assert ready["type"] == "ready" and ready["records"] == 1715 and ready["duration_s"] > 100

        first = _frame(ws)
        assert first["t"] == 0 and not first["playing"]

        ws.send_json({"type": "seek", "t": 60})
        frame = _frame(ws)
        assert frame["t"] == 60
        assert frame["data"]["session"]["track"] == "Baku (Azerbaijan)"
        assert frame["data"]["driver"]["name"] == "GASLY"

        ws.send_json({"type": "speed", "value": 16})
        ws.send_json({"type": "play"})
        later = _frame(ws)
        while later["t"] <= 60:
            later = _frame(ws)
        assert later["playing"] and later["speed"] == 16

    # Opening the replay completed the shared track outline with the whole session.
    layout = client.get("/api/tracks/20/layout", headers={"X-Dev-User": email}).json()
    assert layout["coverage"] > 0.6


@needs_baku
def test_replay_is_private(client):
    owner = next(_emails)
    session_id = _ingest_baku(client, owner)
    for first in (
        {"type": "auth", "dev_user": next(_emails), "session_id": session_id},  # someone else's race
        {"type": "auth", "dev_user": owner, "session_id": 999999},  # no such session
        {"type": "auth", "token": "not-a-token", "session_id": session_id},
    ):
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/replay/v1") as ws:
                ws.send_json(first)
                ws.receive_json()


@needs_baku
def test_silence_between_recordings_is_collapsed(tmp_path):
    """Two recordings of a session an hour apart replay back to back."""
    from datetime import datetime, timezone

    _, records = capture.read(BAKU_RACE)
    records = list(records)
    paths = []
    for i, start in enumerate((datetime(2026, 9, 27, 1, tzinfo=timezone.utc), datetime(2026, 9, 27, 2, tzinfo=timezone.utc))):
        w = capture.Writer(tmp_path / f"part{i}.f1cap.zst", {"started_at": start.isoformat()})
        for r in records[:100]:
            w.write(int(start.timestamp() * 1e9) + r.offset_ns, r.data)
        w.close()
        paths.append(str(w.path))
    one_part = records[99].offset_ns / 1e9
    duration, count, _ = ReplaySource(paths).scan()
    assert count == 200
    assert duration < 2 * one_part + 2  # not an hour
