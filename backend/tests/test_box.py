"""La pestaña BOX: trazas por vuelta, reglajes y comparación curva por curva."""

import asyncio
from datetime import datetime, timezone
from pathlib import Path

import pytest

TEXAS = Path(__file__).resolve().parents[2] / "fixtures/captures/texas-carrera-temporada2026-formato2024.f1cap.zst"
SUZUKA = Path(__file__).resolve().parents[2] / "fixtures/captures/suzuka-carrera-temporada2026-formato2026.f1cap.zst"
needs = lambda p: pytest.mark.skipif(not p.exists() or p.stat().st_size < 1000, reason="captura no disponible (git lfs)")  # noqa: E731


@needs(TEXAS)
def test_traces_of_every_lap_and_the_fastest_cars():
    from app.engineer import box
    from app.engineer.review import review

    r = review([str(TEXAS)])
    tr = r.traces
    assert tr.track_length == 5514 and tr.player == 21
    assert sorted(tr.player_laps) == [1, 2, 3]
    lap2 = tr.player_laps[2]
    assert lap2.time_ms == 116883 and lap2.valid and not lap2.pitted
    assert lap2.coverage > 0.95
    assert 300 < float(max(lap2.speed[~(lap2.speed != lap2.speed)])) < 340  # top speed, km/h
    assert lap2.time_at(0) == 0 and abs(lap2.time_at(5514) - 116.883) < 1e-6
    assert lap2.setup["aleron_delantero"] > 0

    refs = tr.references()
    assert refs[0].time_ms < lap2.time_ms and refs[0].car != 21
    assert [t.time_ms for t in refs] == sorted(t.time_ms for t in refs)

    ov = box.overview(r)
    assert [v["vuelta"] for v in ov["vueltas"]] == [1, 2, 3]
    assert [v["mejor"] for v in ov["vueltas"]] == [False, True, False]
    assert ov["reglajes"][0]["id"] == "A" and ov["reglajes"][0]["vueltas"] == [1, 2, 3]
    assert len(ov["curvas"]) >= 5

    cmp = box.comparison(r, (21, 2), (refs[0].car, refs[0].lap))
    assert cmp["diferencia_s"] < 0  # the reference is faster
    assert len(cmp["traza_a"]["speed"]) == len(cmp["traza_b"]["speed"]) == 1103
    first = cmp["curvas"][0]
    assert first["a"]["velocidad_minima_kmh"] and first["b"]["frena_en_m"]
    # The corner times add up to most of the lap difference.
    total = sum(c["diferencia_s"] for c in cmp["curvas"] if c["diferencia_s"] is not None)
    assert total < 0
    assert box.comparison(r, (21, 9), (21, 2)) is None


@needs(SUZUKA)
def test_corners_mapped_from_the_trace_when_the_session_is_short():
    from app.engineer import box
    from app.engineer.review import review

    r = review([str(SUZUKA)])
    assert r.corners.corners == []  # one lap is not enough for the engineer's corner map...
    assert len(box.corner_map(r)) >= 5  # ...but the best trace is


def _seed(email: str) -> int:
    """A recorded Texas race for this player."""
    from sqlalchemy import select

    from app.core.database import AsyncSessionLocal
    from app.models import GameSession, SessionCapture, User

    async def seed() -> int:
        async with AsyncSessionLocal() as db:
            user = await db.scalar(select(User).where(User.email == email))
            g = GameSession(tenant_id=user.tenant_id, session_uid=str(abs(hash(email)) % 10**12), packet_format=2024, session_type=15,
                            track_id=15, packets_received=59_000, started_at=datetime(2026, 10, 1, tzinfo=timezone.utc))
            db.add(g)
            await db.flush()
            db.add(SessionCapture(game_session_id=g.id, path=str(TEXAS)))
            await db.commit()
            return g.id

    return asyncio.run(seed())


@needs(TEXAS)
def test_box_api_is_scoped_to_the_player(client):
    email = "box@example.test"
    headers = {"X-Dev-User": email}
    client.get("/api/sessions", headers=headers)  # creates the player

    sid = _seed(email)
    ov = client.get(f"/api/sessions/{sid}/box", headers=headers).json()
    assert ov["sesion"]["pista"] and len(ov["vueltas"]) == 3
    ref = ov["referencias"][0]
    res = client.get(f"/api/sessions/{sid}/box/compare?a=21:2&b={ref['car']}:{ref['lap']}", headers=headers)
    assert res.status_code == 200 and res.json()["b"]["piloto"] == ref["piloto"]
    assert client.get(f"/api/sessions/{sid}/box/compare?a=21:2&b=x", headers=headers).status_code == 422
    assert client.get(f"/api/sessions/{sid}/box/compare?a=21:2&b=21:9", headers=headers).status_code == 404
    assert client.get(f"/api/sessions/{sid}/box", headers={"X-Dev-User": "otro@example.test"}).status_code == 404


@needs(TEXAS)
def test_mcp_corner_comparison_against_the_fastest_car(client):
    from tests.test_mcp import _tool

    email = "box-mcp@example.test"
    headers = {"X-Dev-User": email}
    client.get("/api/sessions", headers=headers)
    sid = _seed(email)
    pat = client.post("/oauth/tokens", json={"name": "t"}, headers=headers).json()["token"]

    out = _tool(client, pat, "compare_lap_telemetry", session_id=sid)
    assert out["b"]["es_el_jugador"] and out["b"]["lap"] == 2  # the player's best lap
    assert out["a"]["piloto"] == "LECLERC" and out["diferencia_s"] > 0
    assert "traza_a" not in out and out["curvas"][0]["b"]["problemas"] is not None
    assert _tool(client, pat, "compare_lap_telemetry", session_id=sid, lap=3, against_lap=2)["a"]["lap"] == 2
    assert _tool(client, pat, "compare_lap_telemetry", session_id=sid, against_driver="piastri")["a"]["piloto"] == "PIASTRI"
    assert "error" in _tool(client, pat, "compare_lap_telemetry", session_id=sid, lap=9)


@needs(TEXAS)
def test_stored_corner_map_keeps_the_numbering():
    from app.engineer import box
    from app.engineer.review import review

    stored = [{"curva": 1, "sector": 1, "entrada_m": 380, "apex_m": 650, "salida_m": 950},
              {"curva": 2, "sector": 2, "entrada_m": 2430, "apex_m": 2610, "salida_m": 2820}]
    r = review([str(TEXAS)], stored)
    assert [k.number for k in box.corner_map(r)] == [1, 2]
    assert [k.apex_m for k in r.corners.corners] == [650, 2610]
    assert r.corners.corner_list()[1]["apex_m"] == 2610
    assert len(review([str(TEXAS)]).corners.corners) > 2  # without a stored map, its own
