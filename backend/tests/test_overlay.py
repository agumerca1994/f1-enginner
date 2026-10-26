"""Links de sólo lectura para paneles flotantes y OBS."""

import hashlib
import itertools

import pytest
from starlette.websockets import WebSocketDisconnect

_emails = (f"overlay{i}@example.test" for i in itertools.count())


def _create(client, email, name="OBS"):
    r = client.post("/api/overlay/tokens", json={"name": name}, headers={"X-Dev-User": email})
    assert r.status_code == 201
    return r.json()


def test_overlay_link_can_be_shown_again_but_is_not_stored(client):
    email, other = next(_emails), next(_emails)
    created = _create(client, email)
    assert created["token"].startswith("rbo_") and created["token_prefix"] == created["token"][:8]

    listed = client.get("/api/overlay/tokens", headers={"X-Dev-User": email}).json()
    assert [(t["id"], t["token"]) for t in listed] == [(created["id"], created["token"])]
    assert client.get("/api/overlay/tokens", headers={"X-Dev-User": other}).json() == []

    import asyncio

    from app.core.database import AsyncSessionLocal
    from app.models import OverlayToken

    async def stored():
        async with AsyncSessionLocal() as db:
            row = await db.get(OverlayToken, created["id"])
            return row.token_hash, row.nonce

    digest, nonce = asyncio.run(stored())
    assert digest == hashlib.sha256(created["token"].encode()).hexdigest()
    assert nonce and created["token"] not in (digest, nonce)  # the link itself is never in the database


def test_overlay_link_depends_on_the_server_secret():
    from app.core.security import overlay_token

    assert overlay_token("a", "n1") == overlay_token("a", "n1")
    assert overlay_token("a", "n1") != overlay_token("b", "n1") != overlay_token("a", "n2")


def test_overlay_link_opens_the_live_socket(client):
    email = next(_emails)
    token = _create(client, email)["token"]
    with client.websocket_connect("/live/v1") as ws:
        ws.send_json({"type": "auth", "overlay_token": token})
        assert ws.receive_json() == {"type": "ready"}


def test_revoked_or_foreign_links_are_rejected(client):
    email, other = next(_emails), next(_emails)
    created = _create(client, email)
    # Another player cannot revoke it.
    assert client.delete(f"/api/overlay/tokens/{created['id']}", headers={"X-Dev-User": other}).status_code == 404
    assert client.delete(f"/api/overlay/tokens/{created['id']}", headers={"X-Dev-User": email}).status_code == 204
    assert client.get("/api/overlay/tokens", headers={"X-Dev-User": email}).json() == []

    for bad in (created["token"], "rbo_made-up", "rbd_wrong-kind"):
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/live/v1") as ws:
                ws.send_json({"type": "auth", "overlay_token": bad})
                ws.receive_json()


def test_overlay_link_cannot_manage_anything(client):
    token = _create(client, next(_emails))["token"]
    auth = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/overlay/tokens", headers=auth).status_code == 401
    assert client.post("/api/engineer/live", json={"active": True}, headers=auth).status_code == 401


def test_bridge_token_opens_the_live_socket_for_its_floating_panels(client):
    from tests.test_ingest import pair_bridge

    token = pair_bridge(client, next(_emails))
    with client.websocket_connect("/live/v1") as ws:
        ws.send_json({"type": "auth", "device_token": token})
        assert ws.receive_json() == {"type": "ready"}
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/live/v1") as ws:
            ws.send_json({"type": "auth", "device_token": "rbd_made-up"})
            ws.receive_json()
