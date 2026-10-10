"""F.2 — track knowledge carried across sessions into the race-start brief."""

from app.engineer import analysis, knowledge
from app.engineer.history import PlayerLap, SessionHistory
from app.live.state import LiveSession


def _lap(n: int, time_ms: int, fuel: float, age: int, compound: str = "Medium") -> PlayerLap:
    return PlayerLap(
        lap=n, time_ms=time_ms, position=5, compound=compound, tyre_age=age,
        wear=[10.0, 10.0, 8.0, 8.0], fuel_kg=fuel, fuel_margin_laps=3.0,
        ers_percent=50.0, ers_deployed_mj=1.0, safety_car=False, pitted=False,
        invalid=False, track_temp=30, weather="Clear",
    )


def test_summary_captures_pace_degradation_and_fuel():
    h = SessionHistory()
    # Six clean laps on Medium: times creep up with tyre age, fuel drops each lap.
    for i in range(6):
        h.player_laps.append(_lap(n=2 + i, time_ms=95_000 + i * 120, fuel=90.0 - i * 2.3, age=3 + i))
    s = knowledge.summarize(h)
    assert s is not None
    med = s["compuestos"]["Medium"]
    assert med["vueltas_limpias"] == 6
    assert med["degradacion_s_por_vuelta"] > 0  # times rose with age
    assert abs(s["consumo_kg_por_vuelta"] - 2.3) < 0.05
    assert s["vueltas_limpias"] == 6


def test_summary_needs_enough_clean_laps():
    h = SessionHistory()
    for i in range(2):
        h.player_laps.append(_lap(n=2 + i, time_ms=95_000, fuel=90.0 - i, age=3 + i))
    assert knowledge.summarize(h) is None


def test_prior_knowledge_lands_in_facts():
    live = LiveSession(0, 0, 123, 2024, build_layout=False)
    prior = {"compuestos": {"Medium": {"ritmo_medio_s": 95.1}}, "vueltas_limpias": 6}
    facts = analysis.build(live, SessionHistory(), prior=prior)
    assert facts["conocimiento_previo"]["compuestos"]["Medium"]["ritmo_medio_s"] == 95.1
    assert "validá" in facts["conocimiento_previo"]["nota"]
    # Without prior the block is absent.
    assert "conocimiento_previo" not in analysis.build(live, SessionHistory())


async def test_save_and_load_roundtrip(database):
    from app.core.database import AsyncSessionLocal
    from app.models import Tenant

    async with AsyncSessionLocal() as db:
        t = Tenant(name="k-test")
        db.add(t)
        await db.flush()

        rich = SessionHistory()
        for i in range(6):
            rich.player_laps.append(_lap(2 + i, 95_000 + i * 120, 90.0 - i * 2.3, 3 + i))
        assert await knowledge.save(db, t.id, 20, rich) is True
        await db.commit()

        got = await knowledge.load(db, t.id, 20)
        assert got["compuestos"]["Medium"]["vueltas_limpias"] == 6 and got["actualizado"]

        # A poorer session must not clobber a richer stored one.
        poor = SessionHistory()
        for i in range(4):
            poor.player_laps.append(_lap(2 + i, 96_000, 90.0 - i, 3 + i))
        assert await knowledge.save(db, t.id, 20, poor) is False
