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


def test_overlay_link_is_shown_once_and_stored_hashed(client):
    email = next(_emails)
    created = _create(client, email)
    assert created["token"].startswith("rbo_") and created["token_prefix"] == created["token"][:8]

    listed = client.get("/api/overlay/tokens", headers={"X-Dev-User": email}).json()
    assert [t["id"] for t in listed] == [created["id"]]
    assert "token" not in listed[0]

    import asyncio

    from app.core.database import AsyncSessionLocal
    from app.models import OverlayToken

    async def stored():
        async with AsyncSessionLocal() as db:
            return (await db.get(OverlayToken, created["id"])).token_hash

    assert asyncio.run(stored()) == hashlib.sha256(created["token"].encode()).hexdigest()


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
