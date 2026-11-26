"""Leaderboards: the best valid lap per player, ranked only against the same game, assists and weather."""

import asyncio
import glob


def test_a_recorded_race_yields_the_players_best_valid_lap():
    from app.routers.leaderboard import _scan

    found = _scan(sorted(glob.glob("../fixtures/captures/texas*.zst"))[0])
    assert found, "the race has valid laps"
    cand = max((c for _uid, c in found), key=lambda c: c["lap_num"])
    assert 60_000 < cand["lap_ms"] < 150_000
    assert abs(cand["s1_ms"] + cand["s2_ms"] + cand["s3_ms"] - cand["lap_ms"]) < 5
    assert cand["category"] in ("sin_ayudas", "con_ayudas") and cand["weather"] in ("seco", "mojado")
    assert cand["packet_format"] == 2024 and cand["track_id"] >= 0


def test_the_board_ranks_players_and_never_shows_their_mail(client):
    from sqlalchemy import select

    from app.core.database import AsyncSessionLocal
    from app.live import records
    from app.models import User

    a, b = {"X-Dev-User": "rapido@example.test"}, {"X-Dev-User": "lento@example.test"}
    client.get("/api/access", headers=a)
    client.get("/api/access", headers=b)

    def lap(ms, cat="sin_ayudas"):
        return {"lap_ms": ms, "s1_ms": ms // 3, "s2_ms": ms // 3, "s3_ms": ms - 2 * (ms // 3), "lap_num": 3, "track_id": 31,
                "packet_format": 2024, "category": cat, "weather": "seco", "session_type": 18, "team": "McLaren", "assists": {}}

    async def seed():
        async with AsyncSessionLocal() as db:
            fast = await db.scalar(select(User).where(User.email == "rapido@example.test"))
            slow = await db.scalar(select(User).where(User.email == "lento@example.test"))
            fast.display_name, slow.radio_name = "Martina Rossi", "Lucho"
            await records.store(db, fast.tenant_id, lap(83_418), None)
            await records.store(db, slow.tenant_id, lap(84_100), None)
            await db.commit()
            # A slower lap never replaces a record; a faster one does.
            assert await records.store(db, slow.tenant_id, lap(85_000), None) is None
            assert await records.store(db, slow.tenant_id, lap(83_955), None) is not None
            await records.store(db, slow.tenant_id, lap(80_000, "con_ayudas"), None)
            await db.commit()

    asyncio.run(seed())
    r = client.get("/api/leaderboard", params={"track_id": 31}, headers=b).json()
    assert [f["nombre"] for f in r["filas"]] == ["Martina R.", "Lucho"]
    assert r["filas"][1]["dif_ms"] == 537 and r["yo"]["pos"] == 2 and r["juego"] == 2024
    assert "example.test" not in str(r)
    # The assisted lap is on its own board.
    r2 = client.get("/api/leaderboard", params={"track_id": 31, "categoria": "con_ayudas"}, headers=b).json()
    assert [f["nombre"] for f in r2["filas"]] == ["Lucho"]
    mine = client.get("/api/leaderboard/mine", headers=b).json()["pistas"]["31"]
    assert mine["pos"] == 2 and mine["pilotos"] == 2
