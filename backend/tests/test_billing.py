"""Plans: what the free plan leaves out, checkouts, Mercado Pago's notices read back, courtesy plans."""

import asyncio
import secrets

import pytest

KEY = {"x-internal-key": "test-internal-key"}


@pytest.fixture
def limits(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "PLAN_LIMITS", True)


def _tenant(email):
    from sqlalchemy import select

    from app.core.database import AsyncSessionLocal
    from app.models import User

    async def go():
        async with AsyncSessionLocal() as db:
            return (await db.scalar(select(User).where(User.email == email))).tenant_id

    return asyncio.run(go())


def _session(tenant_id):
    from app.core.database import AsyncSessionLocal
    from app.models import GameSession

    async def go():
        async with AsyncSessionLocal() as db:
            g = GameSession(tenant_id=tenant_id, session_uid=secrets.token_hex(8), packet_format=2024, track_id=32)
            db.add(g)
            await db.commit()
            return g.id

    return asyncio.run(go())


def _charge(tenant_id, gs, block=0):
    from app.billing import plans
    from app.core.database import AsyncSessionLocal

    async def go():
        async with AsyncSessionLocal() as db:
            return await plans.charge_race(db, tenant_id, gs, block)

    return asyncio.run(go())


def test_free_plan_then_a_pack_then_the_subscription(client, limits):
    h = {"X-Dev-User": "paga@planes.test"}
    p = client.get("/api/billing", headers=h).json()
    assert p["plan"] == "gratis" and p["puede"] == {"ingeniero_ia": False, "mcp": False, "pantallas": 1}
    assert p["pagos"] == "simulado" and [x["id"] for x in p["productos"]] == ["suscripcion", "paquete5", "paquete12"]
    t = _tenant("paga@planes.test")
    gs = _session(t)
    assert _charge(t, gs) is None  # no races: the engineer stays on rules

    # A pack, paid in the simulated checkout.
    c = client.post("/api/billing/checkout", json={"producto": "paquete5"}, headers=h).json()
    assert "simulado=1" in c["url"] and c["ars"] % 100 == 0
    assert client.post("/api/billing/simulate", params={"ref": c["ref"]}, headers=h).json()["estado"] == "aprobado"
    client.post("/api/billing/simulate", params={"ref": c["ref"]}, headers=h)  # twice is still one pack
    assert client.get("/api/billing", headers=h).json()["creditos"] == 5
    assert _charge(t, gs) == "paquete" and _charge(t, gs) == "paquete"  # the same block is charged once
    assert client.get("/api/billing", headers=h).json()["creditos"] == 4
    assert _charge(t, gs, 1) == "paquete"  # past 45 minutes, another race
    assert client.get("/api/billing", headers=h).json()["creditos"] == 3

    # The subscription: its monthly races go first, then the pack.
    s = client.post("/api/billing/checkout", json={"producto": "suscripcion"}, headers=h).json()
    client.post("/api/billing/simulate", params={"ref": s["ref"]}, headers=h)
    p = client.get("/api/billing", headers=h).json()
    assert p["plan"] == "suscripcion" and p["puede"]["mcp"] and p["puede"]["pantallas"] is None
    gs2 = _session(t)
    for block in range(3):
        assert _charge(t, gs2, block) == "suscripcion"
    assert _charge(t, gs2, 3) == "paquete"
    p = client.get("/api/billing", headers=h).json()
    assert p["carreras_mes"] == {"incluidas": 3, "usadas": 3} and p["creditos"] == 2


def test_courtesy_plan_and_the_reference_dollar(client, limits):
    h = {"X-Dev-User": "dueno@planes.test"}
    client.get("/api/billing", headers=h)
    r = client.post("/internal/billing/grant", json={"email": "dueno@planes.test", "cortesia": True, "nota": "el dueño"}, headers=KEY)
    assert r.status_code == 200 and r.json()["plan"] == "cortesia" and r.json()["hasta"] is None
    t = _tenant("dueno@planes.test")
    assert _charge(t, _session(t)) == "cortesia"
    assert client.get("/api/billing", headers=h).json()["creditos"] == 0
    assert client.post("/internal/billing/grant", json={"email": "dueno@planes.test", "quitar": True}, headers=KEY).json()["plan"] == "gratis"
    # Gifted races for a deal.
    assert client.post("/internal/billing/grant", json={"email": "dueno@planes.test", "carreras": 5}, headers=KEY).json()["creditos"] == 5
    assert client.post("/internal/billing/grant", json={"email": "x@y.test"}, headers=KEY).status_code == 404
    assert client.post("/internal/billing/grant", json={"email": "dueno@planes.test"}).status_code in (401, 403, 422)

    r = client.post("/internal/billing/rate", json={"usd_ars": 1450}, headers=KEY).json()
    assert r["precios"] == {"suscripcion": 5100, "paquete5": 7300, "paquete12": 14500}
    prices = {x["id"]: x["ars"] for x in client.get("/api/billing", headers=h).json()["productos"]}
    assert prices["paquete12"] == 14500


def test_mercado_pago_notices_are_read_back_and_never_trusted(client, limits, monkeypatch):
    from app.billing import mercadopago as mp
    from app.core.config import settings

    h = {"X-Dev-User": "mp@planes.test"}
    c = client.post("/api/billing/checkout", json={"producto": "paquete12"}, headers=h).json()
    monkeypatch.setattr(settings, "MP_ACCESS_TOKEN", "TEST-token")
    seen = {}

    async def fake_payment(pid):
        return seen[pid]

    monkeypatch.setattr(mp, "get_payment", fake_payment)
    # A notice for a payment with a lower amount than ours credits nothing.
    seen["111"] = {"id": 111, "status": "approved", "currency_id": "ARS", "transaction_amount": 10, "external_reference": c["ref"]}
    client.post("/api/billing/mp/webhook", json={"type": "payment", "data": {"id": "111"}})
    monkeypatch.setattr(settings, "MP_ACCESS_TOKEN", "")
    assert client.get("/api/billing", headers=h).json()["creditos"] == 0
    monkeypatch.setattr(settings, "MP_ACCESS_TOKEN", "TEST-token")
    # The real one, notified twice, credits once.
    seen["222"] = {"id": 222, "status": "approved", "currency_id": "ARS", "transaction_amount": c["ars"], "external_reference": c["ref"]}
    for _ in range(2):
        assert client.post("/api/billing/mp/webhook", json={"type": "payment", "data": {"id": "222"}}).status_code == 200
    # Junk is acknowledged and ignored.
    assert client.post("/api/billing/mp/webhook", content=b"nope").status_code == 200
    monkeypatch.setattr(settings, "MP_ACCESS_TOKEN", "")
    assert client.get("/api/billing", headers=h).json()["creditos"] == 12


def test_the_live_engineer_falls_back_to_rules_without_races(client, limits):
    from app.engineer.runner import EngineerRunner

    client.get("/api/billing", headers={"X-Dev-User": "reglas@planes.test"})
    t = _tenant("reglas@planes.test")
    gs = _session(t)

    class FakeAI:
        name = "claude (test)"

    runner = EngineerRunner(t, "live", game_session_id=gs, provider=FakeAI())
    assert asyncio.run(runner._ai_ok()) is False
    assert runner.provider_name.startswith("reglas")
    client.post("/internal/billing/grant", json={"email": "reglas@planes.test", "carreras": 1}, headers=KEY)
    runner._ai_denied_until = 0
    assert asyncio.run(runner._ai_ok()) is True and runner.provider_name == "claude (test)"
    assert client.get("/api/billing", headers={"X-Dev-User": "reglas@planes.test"}).json()["creditos"] == 0
