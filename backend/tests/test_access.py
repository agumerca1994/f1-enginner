"""Early access: signed-in players need an invite code; codes are single use and stored hashed."""

from app.core.config import settings

KEY = {"x-internal-key": "test-internal-key"}


def test_a_new_player_waits_until_they_redeem_an_invite_code(client, monkeypatch):
    monkeypatch.setattr(settings, "ACCESS_GATE", True)
    me = {"X-Dev-User": "nuevo@example.test"}
    assert client.get("/api/access", headers=me).json() == {"habilitado": False, "solicitud": None}
    # Everything else answers access_pending until then.
    r = client.get("/api/devices", headers=me)
    assert r.status_code == 403 and r.json()["detail"] == "access_pending"

    # Asking for access keeps what they said, for us to read.
    r = client.post("/api/access/request", headers=me, json={"tipo": "local", "local": "Box 44", "ciudad": "Rosario", "butacas": 6, "juego": "F1 24", "plataforma": "PC"})
    assert r.status_code == 200 and r.json()["solicitud"]["local"] == "Box 44"
    listed = client.get("/internal/access/requests", headers=KEY).json()["solicitudes"]
    assert any(s["email"] == "nuevo@example.test" and s["butacas"] == 6 and not s["habilitado"] for s in listed)
    assert client.get("/internal/access/requests").status_code == 422  # no key

    code = client.post("/internal/access/codes", headers=KEY, json={"cantidad": 1, "etiqueta": "beta 1"}).json()["codigos"][0]
    assert client.post("/api/access/redeem", headers=me, json={"code": "ING-XXXX-XXXX"}).status_code == 400
    # Typed in lowercase and without dashes still works.
    assert client.post("/api/access/redeem", headers=me, json={"code": code.lower().replace("-", "")}).status_code == 200
    assert client.get("/api/access", headers=me).json()["habilitado"] is True
    assert client.get("/api/devices", headers=me).status_code == 200

    # A single-use code does not let a second player in.
    other = {"X-Dev-User": "otro@example.test"}
    assert client.post("/api/access/redeem", headers=other, json={"code": code}).status_code == 400
    # We can still let someone in by hand.
    assert client.post("/internal/access/grant", headers=KEY, json={"email": "otro@example.test"}).status_code == 200
    assert client.get("/api/devices", headers=other).status_code == 200
