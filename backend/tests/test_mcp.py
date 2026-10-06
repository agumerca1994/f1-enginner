"""The MCP connector end to end: discovery, the OAuth flow, personal tokens and the tools."""

import base64
import hashlib
import itertools
import json
import secrets
from urllib.parse import parse_qs, urlparse

from tests.test_parser import needs_baku
from tests.test_replay import _ingest_baku

_emails = (f"mcp{i}@example.test" for i in itertools.count())
RESOURCE = "http://localhost:8000/mcp"
REDIRECT = "http://localhost:6274/oauth/callback"
MCP_HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}


def _pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def _oauth(client, email: str) -> dict:
    """Register a client and walk the authorization-code flow as `email`; return the token response."""
    reg = client.post("/oauth/register", json={
        "client_name": "Claude de prueba", "redirect_uris": [REDIRECT],
        "grant_types": ["authorization_code", "refresh_token"], "token_endpoint_auth_method": "none",
    })
    assert reg.status_code == 201, reg.text
    client_id = reg.json()["client_id"]

    verifier, challenge = _pkce()
    auth = client.get("/oauth/authorize", params={
        "response_type": "code", "client_id": client_id, "redirect_uri": REDIRECT, "state": "xyz",
        "code_challenge": challenge, "code_challenge_method": "S256", "resource": RESOURCE,
    }, follow_redirects=False)
    assert auth.status_code == 302, auth.text
    consent_url = urlparse(auth.headers["location"])
    assert consent_url.netloc == "app.example.test" and consent_url.path == "/oauth/authorize"
    txn = parse_qs(consent_url.query)["txn"][0]

    info = client.get(f"/oauth/authorize/txn/{txn}").json()
    assert info["client_name"] == "Claude de prueba" and info["scopes"] == ["telemetry:read"]

    approved = client.post("/oauth/authorize/consent", json={"txn": txn}, headers={"X-Dev-User": email})
    assert approved.status_code == 200, approved.text
    back = parse_qs(urlparse(approved.json()["redirect_uri"]).query)
    assert back["state"] == ["xyz"] and back["iss"] == ["http://localhost:8000"]
    # The consent screen cannot be replayed.
    assert client.post("/oauth/authorize/consent", json={"txn": txn}, headers={"X-Dev-User": email}).status_code == 404

    token = client.post("/oauth/token", data={
        "grant_type": "authorization_code", "code": back["code"][0], "redirect_uri": REDIRECT,
        "client_id": client_id, "code_verifier": verifier, "resource": RESOURCE,
    })
    assert token.status_code == 200, token.text
    return {**token.json(), "client_id": client_id}


def _call(client, token: str, method: str, params: dict | None = None):
    return client.post("/mcp", headers={**MCP_HEADERS, "Authorization": f"Bearer {token}"},
                       json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}})


def _tool(client, token: str, name: str, **arguments) -> dict:
    res = _call(client, token, "tools/call", {"name": name, "arguments": arguments})
    assert res.status_code == 200, res.text
    result = res.json()["result"]
    text = result["content"][0]["text"]
    return {"error": text} if result.get("isError") else json.loads(text)


def test_discovery_and_challenge(client):
    prm = client.get("/.well-known/oauth-protected-resource/mcp").json()
    assert prm["resource"] == RESOURCE and prm["scopes_supported"] == ["telemetry:read"]
    meta = client.get("/.well-known/oauth-authorization-server").json()
    assert meta["code_challenge_methods_supported"] == ["S256"]
    assert meta["authorization_response_iss_parameter_supported"] is True

    res = client.post("/mcp", headers=MCP_HEADERS, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert res.status_code == 401
    challenge = res.headers["www-authenticate"]
    assert 'scope="telemetry:read"' in challenge and "oauth-protected-resource/mcp" in challenge

    preflight = client.options("/mcp", headers={"Origin": "https://claude.ai", "Access-Control-Request-Method": "POST"})
    assert preflight.headers["access-control-allow-origin"] == "*"


def test_oauth_flow_tools_and_refresh_rotation(client):
    email = next(_emails)
    tokens = _oauth(client, email)
    assert tokens["access_token"].startswith("rbm_at_") and tokens["scope"] == "telemetry:read"

    names = {t["name"] for t in _call(client, tokens["access_token"], "tools/list").json()["result"]["tools"]}
    assert names == {"list_sessions", "get_session_review", "compare_laps", "get_engineer_radio", "get_live_session"}
    assert _tool(client, tokens["access_token"], "list_sessions")["sesiones"] == []
    assert _tool(client, tokens["access_token"], "get_live_session")["en_vivo"] is False

    # The connection shows up in Settings.
    conns = client.get("/oauth/connections", headers={"X-Dev-User": email}).json()["connections"]
    assert [c["client_name"] for c in conns] == ["Claude de prueba"]

    refresh = lambda rt: client.post("/oauth/token", data={  # noqa: E731
        "grant_type": "refresh_token", "refresh_token": rt, "client_id": tokens["client_id"]})
    rotated = refresh(tokens["refresh_token"])
    assert rotated.status_code == 200
    # Replaying the old refresh token is treated as theft: the whole grant dies.
    assert refresh(tokens["refresh_token"]).status_code == 400
    assert _call(client, rotated.json()["access_token"], "tools/list").status_code == 401


def test_personal_token_and_disconnect(client):
    email = next(_emails)
    created = client.post("/oauth/tokens", json={"name": "Claude Code", "expires_in_days": 30},
                          headers={"X-Dev-User": email})
    assert created.status_code == 201
    pat = created.json()["token"]
    assert pat.startswith("rbm_pat_") and created.json()["connector_url"] == RESOURCE
    assert _call(client, pat, "tools/list").status_code == 200

    listed = client.get("/oauth/tokens", headers={"X-Dev-User": email}).json()["tokens"]
    assert listed[0]["name"] == "Claude Code" and "token" not in listed[0]
    # Another player cannot revoke it.
    assert client.delete(f"/oauth/tokens/{listed[0]['id']}", headers={"X-Dev-User": next(_emails)}).status_code == 404
    assert client.delete(f"/oauth/tokens/{listed[0]['id']}", headers={"X-Dev-User": email}).status_code == 204
    assert _call(client, pat, "tools/list").status_code == 401


@needs_baku
def test_session_tools_on_a_recorded_race(client):
    email = next(_emails)
    session_id = _ingest_baku(client, email)
    pat = client.post("/oauth/tokens", json={"name": "t"}, headers={"X-Dev-User": email}).json()["token"]

    sessions = _tool(client, pat, "list_sessions", track="baku", kind="carrera")["sesiones"]
    assert [s["id"] for s in sessions] == [session_id] and sessions[0]["tiene_grabacion"]
    assert _tool(client, pat, "list_sessions", kind="clasificacion")["sesiones"] == []

    review = _tool(client, pat, "get_session_review", session_id=session_id)
    assert review["sesion"]["pista"] == "Baku (Azerbaijan)"
    assert review["analisis_al_cierre"]["piloto"]["piloto"] == "GASLY"
    assert 100 < review["grabacion_s"] < 120
    assert "error" in _tool(client, pat, "compare_laps", session_id=session_id, lap_a=3, lap_b=4)

    # Another player's token cannot read this session.
    other = client.post("/oauth/tokens", json={"name": "t"}, headers={"X-Dev-User": next(_emails)}).json()["token"]
    assert "No existe la sesión" in _tool(client, other, "get_session_review", session_id=session_id)["error"]
    assert _tool(client, other, "list_sessions")["sesiones"] == []
