"""Groups: create, join by code, the group's own board, the round, leaving."""

import asyncio


def _lap(ms, track=29):
    return {"lap_ms": ms, "s1_ms": ms // 3, "s2_ms": ms // 3, "s3_ms": ms - 2 * (ms // 3), "lap_num": 3, "track_id": track,
            "packet_format": 2024, "category": "sin_ayudas", "weather": "seco", "session_type": 18, "team": None, "assists": {}}


def test_a_group_ranks_only_its_members_and_keeps_an_admin(client):
    from sqlalchemy import select

    from app.core.database import AsyncSessionLocal
    from app.live import records
    from app.models import User

    ana, beto, caro = ({"X-Dev-User": f"{n}@grupos.test"} for n in ("ana", "beto", "caro"))
    for h in (ana, beto, caro):
        client.get("/api/access", headers=h)

    async def seed():
        async with AsyncSessionLocal() as db:
            for email, name, ms in (("ana@grupos.test", "Ana", 90_500), ("beto@grupos.test", "Beto", 90_100), ("caro@grupos.test", "Caro", 89_000)):
                u = await db.scalar(select(User).where(User.email == email))
                u.radio_name = name
                await records.store(db, u.tenant_id, _lap(ms), None)
            await db.commit()

    asyncio.run(seed())

    g = client.post("/api/groups", json={"nombre": "Los del martes"}, headers=ana).json()
    code = g["codigo"]
    assert code.startswith("G-")
    # The code works typed loosely, and joining twice is harmless.
    assert client.get(f"/api/groups/code/{code.lower().replace('-', '')}", headers=beto).json()["ya_estas"] is False
    assert client.post("/api/groups/join", json={"codigo": code.lower()}, headers=beto).json()["id"] == g["id"]
    client.post("/api/groups/join", json={"codigo": code}, headers=beto)
    assert client.post("/api/groups/join", json={"codigo": "G-NOPE00"}, headers=caro).status_code == 400

    # Caro is the fastest overall but not in the group.
    board = client.get("/api/leaderboard", params={"track_id": 29, "grupo": g["id"]}, headers=ana).json()
    assert [f["nombre"] for f in board["filas"]] == ["Beto", "Ana"]
    everyone = client.get("/api/leaderboard", params={"track_id": 29}, headers=ana).json()
    assert everyone["filas"][0]["nombre"] == "Caro"
    # Outsiders cannot read the group or its board.
    assert client.get(f"/api/groups/{g['id']}", headers=caro).status_code == 404
    assert client.get("/api/leaderboard", params={"track_id": 29, "grupo": g["id"]}, headers=caro).status_code == 404

    d = client.get(f"/api/groups/{g['id']}", headers=beto).json()
    assert [m["nombre"] for m in d["miembros"]] == ["Ana", "Beto"] and d["admin"] is False
    assert d["pistas"][0]["lider"]["nombre"] == "Beto" and d["pistas"][0]["mi_pos"] == 1
    assert "grupos.test" not in str(d)

    # Only an admin sets the round.
    assert client.patch(f"/api/groups/{g['id']}", json={"pista_fecha": 29}, headers=beto).status_code == 403
    assert client.patch(f"/api/groups/{g['id']}", json={"pista_fecha": 29}, headers=ana).status_code == 200
    assert client.get("/api/groups", headers=beto).json()["grupos"][0]["fecha"]["track_id"] == 29

    # When the admin leaves, the oldest member left becomes admin; the last one out deletes the group.
    me = next(m for m in d["miembros"] if m["nombre"] == "Ana")
    assert client.delete(f"/api/groups/{g['id']}/members/{me['id']}", headers=ana).status_code == 200
    d2 = client.get(f"/api/groups/{g['id']}", headers=beto).json()
    assert d2["admin"] is True and len(d2["miembros"]) == 1
    client.delete(f"/api/groups/{g['id']}/members/{d2['miembros'][0]['id']}", headers=beto)
    assert client.get("/api/groups", headers=beto).json()["grupos"] == []
