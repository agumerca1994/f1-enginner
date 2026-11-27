"""Reglaje base por pista y el mejor reglaje propio guardado."""

import asyncio

from app.engineer import knowledge
from app.engineer.base_setup import TRAITS, base_setup
from app.engineer.history import PlayerLap, SessionHistory
from app.engineer.setup_advice import RANGES
from app.telemetry import constants as c


def test_base_setup_within_game_ranges_for_every_track():
    for track_id in list(c.TRACKS) + [None, 99]:
        for wet in (False, True):
            v = base_setup(track_id, wet)["valores"]
            for key, (lo, hi, _) in RANGES.items():
                if key in v:
                    assert lo <= v[key] <= hi, (track_id, wet, key, v[key])
            assert -3.5 <= v["camber_del"] <= -2.5 and -2.2 <= v["camber_tras"] <= -0.7


def test_base_setup_follows_the_track():
    monaco, monza = base_setup(5)["valores"], base_setup(11)["valores"]
    assert monaco["aleron_delantero"] > 40 and monza["aleron_trasero"] < 10
    assert base_setup(5, wet=True)["valores"]["aleron_trasero"] >= monaco["aleron_trasero"]
    assert base_setup(12)["valores"]["suspension_del"] < base_setup(18)["valores"]["suspension_del"]  # kerbs
    assert set(TRAITS) >= set(c.TRACKS)  # every track the game knows has traits


def _lap(n, ms, setup, compound="Medium"):
    return PlayerLap(lap=n, time_ms=ms, position=5, compound=compound, tyre_age=n, wear=None, fuel_kg=None,
                     fuel_margin_laps=None, ers_percent=None, ers_deployed_mj=None, safety_car=False, pitted=False,
                     invalid=False, track_temp=30, weather="Clear", setup=setup)


def test_best_setup_per_condition():
    h = SessionHistory()
    h.player_laps += [_lap(2, 95_000, {"aleron_delantero": 30}), _lap(3, 94_500, {"aleron_delantero": 32}),
                      _lap(4, 101_000, {"aleron_delantero": 40}, "Intermediate")]
    best = knowledge.best_setups(h)
    assert best["seco"]["valores"]["aleron_delantero"] == 32 and best["seco"]["vuelta_s"] == 94.5
    assert best["lluvia"]["valores"]["aleron_delantero"] == 40


def test_base_endpoint_offers_the_best_own_setup(client):
    from sqlalchemy import select

    from app.core.database import AsyncSessionLocal
    from app.models import User

    email = "base-setup@example.test"
    headers = {"X-Dev-User": email}
    client.get("/api/sessions", headers=headers)
    out = client.get("/api/setup/base?track_id=5", headers=headers).json()
    assert out["pista"] == "Mónaco" and out["tu_mejor"] is None and out["valores"]["aleron_delantero"] > 40

    async def seed():
        async with AsyncSessionLocal() as db:
            user = await db.scalar(select(User).where(User.email == email))
            h = SessionHistory()
            h.player_laps += [_lap(2, 72_000, {"aleron_delantero": 45})]
            await knowledge.save(db, user.tenant_id, 5, h)
            h2 = SessionHistory()  # a slower session later does not replace it
            h2.player_laps += [_lap(2, 73_000, {"aleron_delantero": 50})]
            await knowledge.save(db, user.tenant_id, 5, h2)
            await db.commit()

    asyncio.run(seed())
    out = client.get("/api/setup/base?track_id=5", headers=headers).json()
    assert out["tu_mejor"]["valores"]["aleron_delantero"] == 45 and out["tu_mejor"]["vuelta_s"] == 72.0
    assert client.get("/api/setup/base?track_id=5&lluvia=true", headers=headers).json()["tu_mejor"] is None
    assert any(t["pista"] == "Mónaco" for t in client.get("/api/setup/tracks", headers=headers).json())
