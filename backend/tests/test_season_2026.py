"""The 2026 regulations data (active aero, overtake mode, ERS harvest limit, blisters)
reaching the dashboard snapshot, the engineer's facts and its radio calls."""

import asyncio
import json

from app.engineer.engine import RaceEngineer
from app.engineer.history import Trigger
from app.engineer.providers import RulesProvider
from app.live import snapshot
from app.replay.player import ReplayPlayer, ReplaySource
from tests.test_parser import BAKU_RACE, SUZUKA_2026, needs_baku, needs_suzuka_2026


def _replay(path):
    """Replay a capture to the end with an engineer following the last session."""
    state = {"engineer": RaceEngineer(), "uid": None}

    def observe(packet, live):
        if state["uid"] != packet.session_uid:
            state["uid"], state["engineer"] = packet.session_uid, RaceEngineer()
        state["engineer"].observe(packet, live)

    player = ReplayPlayer(ReplaySource([str(path)]), on_packet=observe)
    player.seek(float("inf"))
    return player.live, state["engineer"]


@needs_suzuka_2026
def test_snapshot_carries_2026_data():
    live, _ = _replay(SUZUKA_2026)
    snap = snapshot.build(live)

    aero = snap["aero"]
    assert aero["regulations_2026"] is True
    assert aero["active_aero_mode"] in ("corner", "straight")
    assert isinstance(aero["overtake_available"], bool)

    zones = snap["session"]["active_aero_zones"]
    assert zones and all(0 <= z["inicio_pct"] <= 100 and z["tipo"] in ("total", "parcial") for z in zones)
    assert snap["session"]["drs_zones"]

    status = snap["status"]
    assert 7 <= status["ers_harvest_limit_mj"] <= 8
    assert status["ers_harvested_lap_mj"] is not None

    assert snap["damage"]["tyre_blisters_percent"] is not None
    assert snap["driver"]["livery_color"] == "#27f4d2"  # Antonelli's Mercedes, as the game paints it
    assert all(car["overtake_active"] is not None for car in snap["cars"])


@needs_baku
def test_older_formats_leave_2026_fields_empty():
    live, _ = _replay(BAKU_RACE)
    snap = snapshot.build(live)
    assert "aero" not in snap
    assert snap["status"]["ers_harvest_limit_mj"] is None
    assert snap["damage"]["tyre_blisters_percent"] is None  # unknown in 2024, not zero
    assert snap["driver"]["livery_color"] is None


@needs_suzuka_2026
def test_engineer_calls_overtake_mode_moments():
    live, engineer = _replay(SUZUKA_2026)
    kinds = [t.kind for t in engineer.history.triggers]
    assert "overtake_available" in kinds
    assert "rival_overtake" in kinds
    rival = next(t for t in engineer.history.triggers if t.kind == "rival_overtake")
    assert rival.detail["piloto"] == "VERSTAPPEN" and rival.detail["gap_s"] <= 1.5

    facts = json.loads(engineer.build_request(engineer.history.triggers[-1:], live).facts_json)
    regs = facts["reglamento_2026"]
    assert regs["reglamento_2026_activo"] is True
    assert regs["ers_vuelta_actual"]["limite_cosecha_mj"] > 0
    assert regs["modo_adelantamiento"]["uso_por_vuelta_pct"]


@needs_suzuka_2026
def test_rules_radio_speaks_plain_spanish():
    live, engineer = _replay(SUZUKA_2026)
    calls = [
        Trigger("overtake_available", 100.0, 2, {"gap_s": 0.3}),
        Trigger("rival_overtake", 100.0, 2, {"piloto": "VERSTAPPEN", "gap_s": 0.4}),
        Trigger("blisters", 100.0, 2, {"rueda": "delantera izquierda", "pct": 32}),
        Trigger("damage", 100.0, 2, {"parts": {"front_left_wing": 60, "floor": 20}}),
    ]
    radios = [asyncio.run(RulesProvider().advise(engineer.build_request([t], live))).response["radio"] for t in calls]
    assert radios[0] == "Tenés el modo adelantamiento, estás a 0,3 segundos del de adelante: usalo en la recta."
    assert radios[1].startswith("Verstappen activó el modo adelantamiento a 0,4 segundos atrás")
    assert "delantera izquierda" in radios[2]
    assert radios[3].startswith("Daño en alerón delantero izquierdo y piso")
    assert not any(word in " ".join(radios) for word in ("Overtake", "wing", "None"))
