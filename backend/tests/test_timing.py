"""Delta en vivo, relativos, alcance y repaso de sectores."""

from pathlib import Path
from types import SimpleNamespace

import pytest

from app.live import snapshot
from app.live.state import LiveSession
from app.live.timing import LapDelta, LiveTiming, forecast

TRACK = 5000.0
MADRID = Path(__file__).parents[2] / "fixtures/captures/madrid-carrera-temporada2026-formato2025.f1cap.zst"


def _lap(number, distance, time_ms, last_ms=0, invalid=False, pit=0, total=None):
    return {
        "current_lap_num": number, "lap_distance": distance, "current_lap_time_in_ms": time_ms,
        "last_lap_time_in_ms": last_ms, "current_lap_invalid": int(invalid), "pit_status": pit,
        "total_distance": (number - 1) * TRACK + distance if total is None else total,
        "result_status": 2, "driver_status": 4,
    }


def _drive(delta: LapDelta, number: int, lap_ms: int, last_ms: int = 0, step: float = 100, **kw):
    """One full lap at constant speed, sampled every `step` metres."""
    d = 0.0
    while d < TRACK:
        delta.observe(_lap(number, d, round(d / TRACK * lap_ms), last_ms, **kw), TRACK, safety_car=False)
        d += step


def test_delta_compares_at_the_same_point_of_the_lap():
    delta = LapDelta()
    _drive(delta, 1, 100_000)
    assert delta.delta_ms(_lap(1, 2500, 50_000)) is None  # no reference until a lap is complete
    delta.observe(_lap(2, 10, 200, last_ms=100_000), TRACK, False)
    assert delta.reference_lap == 1 and delta.best_ms == 100_000
    assert delta.delta_ms(_lap(2, 2500, 50_400)) == 400  # slower at half lap
    assert delta.delta_ms(_lap(2, 2500, 49_700)) == -300


def test_only_a_quicker_complete_clean_lap_replaces_the_reference():
    delta = LapDelta()
    _drive(delta, 1, 100_000)
    _drive(delta, 2, 99_000, last_ms=100_000, invalid=True)  # quicker but invalid
    _drive(delta, 3, 98_000, last_ms=99_000, pit=1)  # quicker but through the pits
    _drive(delta, 4, 101_000, last_ms=98_000)  # clean but slower
    delta.observe(_lap(5, 10, 200, last_ms=101_000), TRACK, False)
    assert delta.reference_lap == 1


def test_a_lap_with_a_long_hole_in_the_trace_is_not_a_reference():
    delta = LapDelta()
    _drive(delta, 1, 100_000, step=400)  # lossy link: nothing for 400 m at a time
    delta.observe(_lap(2, 10, 200, last_ms=100_000), TRACK, False)
    assert delta.reference == []


def test_a_lap_joined_midway_is_not_a_reference():
    delta = LapDelta()
    for d in range(1500, 5000, 50):
        delta.observe(_lap(1, d, d * 20), TRACK, False)
    delta.observe(_lap(2, 10, 200, last_ms=100_000), TRACK, False)
    assert delta.reference == []


def test_flashback_keeps_the_lap_usable():
    delta = LapDelta()
    for d in range(0, 3000, 100):
        delta.observe(_lap(1, d, d * 20), TRACK, False)
    for d in range(2000, 5000, 100):  # rewound to 2000 m and driven again
        delta.observe(_lap(1, d, d * 20), TRACK, False)
    delta.observe(_lap(2, 10, 200, last_ms=100_000), TRACK, False)
    assert delta.reference_lap == 1


def test_forecast_states():
    assert forecast(None, 90, 91, 10)["state"] == "waiting"
    assert forecast(2.0, 90.0, 90.05, 10)["state"] == "stable"
    assert forecast(2.0, 91.0, 90.0, 10)["state"] == "opening"
    f = forecast(2.0, 90.0, 90.5, 10)
    assert f["state"] == "catching" and f["laps_to_catch"] == 4.0
    assert forecast(2.0, 90.0, 90.5, 3)["state"] == "after_finish"


def _packet(t, cars):
    return SimpleNamespace(session_time=t, body={"lap_data": cars})


def test_a_restart_or_looped_replay_drops_the_reference_but_a_flashback_keeps_it():
    timing = LiveTiming()
    timing.delta.reference, timing.delta.reference_lap, timing.delta.best_ms = [(0.0, 0), (TRACK, 100_000)], 3, 100_000
    timing.observe(_packet(500.0, [_lap(5, 100, 2_000)]), 0, TRACK, False)
    timing.observe(_packet(492.0, [_lap(5, 100, 2_000)]), 0, TRACK, False)  # flashback
    assert timing.delta.reference_lap == 3
    timing.observe(_packet(20.0, [_lap(1, 100, 2_000)]), 0, TRACK, False)  # back to the start
    assert timing.delta.reference_lap is None and not timing.delta.reference


def test_relatives_use_the_time_since_the_car_ahead_passed():
    timing = LiveTiming()
    # Car 1 drives 100 m ahead of the player at 50 m/s: 2 s apart on track.
    for step in range(20):
        t = step * 0.5
        me, other = 1000 + 50 * t, 1100 + 50 * t
        timing.observe(_packet(t, [_lap(1, me, 0), _lap(1, other, 0)]), 0, TRACK, False)
    laps = [_lap(1, 1000 + 50 * 9.5, 0), _lap(1, 1100 + 50 * 9.5, 0)]
    rows = timing.relatives(laps, 0, TRACK, 100_000, race=True)
    assert rows["ahead"][0]["index"] == 1 and rows["ahead"][0]["gap_s"] == 2.0
    assert not rows["ahead"][0]["estimated"] and rows["ahead"][0]["relation"] is None


def test_relatives_flag_lapped_cars_and_estimate_without_a_trace():
    timing = LiveTiming()
    timing.session_time = 1.0
    me = _lap(5, 1000, 0)
    lapped = _lap(4, 1250, 0)  # physically 250 m ahead but a lap down
    rows = timing.relatives([me, lapped], 0, TRACK, 100_000, race=True)
    row = rows["ahead"][0]
    assert row["relation"] == "lapped" and row["estimated"] and row["gap_s"] == 5.0


@pytest.mark.skipif(not MADRID.exists() or MADRID.stat().st_size < 1000, reason="captura no disponible (git lfs)")
def test_madrid_race_gets_delta_pace_and_sector_review():
    from app.replay.player import ReplaySource
    from app.telemetry import registry

    live, deltas, paces, relatives = None, 0, 0, 0
    for _, data in ReplaySource([str(MADRID)]).records():
        packet = registry.parse(data)
        if packet is None:
            continue
        if live is None:
            live = LiveSession(0, 0, packet.session_uid, packet.packet_format, build_layout=False)
        live.update(packet)
        if packet.name == "lap_data" and "session" in live.last:
            snap = snapshot.build(live)
            deltas += snap["lap"]["delta_best_ms"] is not None
            paces += bool(snap.get("pace") and snap["pace"]["my_pace_s"])
            relatives += bool(snap["relatives"]["ahead"] or snap["relatives"]["behind"])
    assert live.timing.delta.reference_lap is not None and deltas > 1000
    assert paces > 0
    review = snap["sector_review"]
    assert review and review[0]["reference_lap"] is not None and len(review[0]["sector_deltas_ms"]) == 3
    assert relatives > 1000


def test_engineer_reads_the_catch_forecast_and_rules_call_it():
    import json

    from app.engineer.analysis import REACH_STATES
    from app.engineer.providers import _catch_call

    facts = {"rivales": {"alcance": {"atras": {"piloto": "PIASTRI", "estado": REACH_STATES["catching"],
                                               "descuento_s_por_vuelta": 0.42, "vueltas_para_alcanzar": 2.3}}}}
    radio, priority = _catch_call(json.loads(json.dumps(facts)))
    assert "Piastri te descuenta 0.4" in radio and "3 vueltas" in radio and priority == "importante"
    facts["rivales"]["alcance"]["atras"]["vueltas_para_alcanzar"] = 8
    assert _catch_call(facts) is None  # too far off to say anything yet


@pytest.mark.skipif(not MADRID.exists() or MADRID.stat().st_size < 1000, reason="captura no disponible (git lfs)")
def test_madrid_facts_carry_reach_and_live_delta():
    from app.engineer import analysis
    from app.engineer.history import SessionHistory
    from app.replay.player import ReplaySource
    from app.telemetry import registry

    live, history, seen = None, SessionHistory(), set()
    for _, data in ReplaySource([str(MADRID)]).records():
        packet = registry.parse(data)
        if packet is None:
            continue
        if live is None:
            live = LiveSession(0, 0, packet.session_uid, packet.packet_format, build_layout=False)
        live.update(packet)
        history.observe(packet, live)
        if packet.name == "lap_data" and "session" in live.last and int(live.last["lap_data"].body["lap_data"][live.last["lap_data"].player_car_index]["current_lap_num"]) >= 5:
            facts = analysis.build(live, history)
            reach = facts["rivales"]["alcance"]
            if reach and reach["atras"] and reach["atras"]["estado"] != "faltan vueltas limpias":
                seen.add("alcance")
            if facts["sectores"]["vuelta_en_curso"]["delta_vs_mejor_vuelta_s"] is not None:
                seen.add("delta")
            if seen == {"alcance", "delta"}:
                break
    assert seen == {"alcance", "delta"}
