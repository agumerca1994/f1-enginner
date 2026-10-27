"""El ingeniero como en la F1: radio rápida, mensajes en la recta, coaching por curva y gomas."""

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from app.engineer.engine import EngineerRequest
from app.engineer.history import PlayerLap, SessionHistory, Trigger
from app.engineer.providers import Advice
from app.engineer.runner import RADIO_HOLD_S, EngineerRunner

TEXAS = Path(__file__).parents[2] / "fixtures/captures/texas-carrera-temporada2026-formato2024.f1cap.zst"
FULL = {"radio": None, "prioridad": "info",
        "estrategia": {"plan": "p", "vuelta_box": None, "ventana_box": None, "proximo_compuesto": None,
                       "alternativa": "a", "certeza": "media"},
        "manejo": [], "reglaje": [], "analisis": "muro"}


class TwoLaneAI:
    name = "claude (test)"

    def __init__(self):
        self.radio_calls, self.full_calls = [], []

    async def radio(self, request):
        self.radio_calls.append(request)
        return Advice({"radio": "Uno dos con Norris, viene tres décimas más rápido.", "prioridad": "info"},
                      "claude-haiku-5-5", 10)

    async def advise(self, request):
        self.full_calls.append(request)
        return Advice({**FULL, "radio": "Box esta vuelta."}, "claude-sonnet-5-5", 10)


def _telemetry(t, throttle, brake=0.0, steer=0.0, speed=280):
    car = {"throttle": throttle, "brake": brake, "steer": steer, "speed": speed}
    return SimpleNamespace(name="car_telemetry", session_time=t, player_car_index=0, session_uid=1,
                           body={"car_telemetry_data": [car]})


def _runner(ai):
    runner = EngineerRunner(tenant_id=1, mode="replay", provider=ai)
    runner.active = True
    runner.session_uid = 1
    runner._store = lambda *a: asyncio.sleep(0)
    runner.engineer.observe = lambda packet, live: None  # only the lanes and the outbox under test
    return runner


def _request(kind, lap, t=100.0):
    return EngineerRequest([Trigger(kind, t, lap)], t, lap, [kind], "Ninguno todavía.", "{}")


async def test_routine_moments_use_the_radio_lane_and_a_quiet_pit_wall_refresh():
    ai = TwoLaneAI()
    runner = _runner(ai)
    runner._queue(_request("lap_completed", 4))
    runner.dispatch()
    await asyncio.sleep(0.05)
    assert len(ai.radio_calls) == 1 and len(ai.full_calls) == 1  # first lap: the pit wall refreshes too
    assert ai.full_calls[0].quiet
    # The pit-wall refresh does not speak; the radio waits for a straight.
    assert [m["radio"] for m in runner.messages] == [None]
    assert len(runner._outbox) == 1

    runner._queue(_request("lap_completed", 5))  # within DEEP_EVERY_LAPS: radio only
    runner.dispatch()
    await asyncio.sleep(0.05)
    assert len(ai.radio_calls) == 2 and len(ai.full_calls) == 1


async def test_important_moments_get_the_full_call_and_may_speak():
    ai = TwoLaneAI()
    runner = _runner(ai)
    runner._queue(_request("pitted", 9))
    runner.dispatch()
    await asyncio.sleep(0.05)
    assert not ai.radio_calls and len(ai.full_calls) == 1 and not ai.full_calls[0].quiet
    assert runner._outbox[0][1]["radio"] == "Box esta vuelta."


def test_radio_waits_for_the_straight_unless_urgent_or_too_long():
    runner = _runner(TwoLaneAI())
    runner._game_time = 10.0
    runner._deliver({"id": 1, "radio": "info", "prioridad": "info"})
    runner._deliver({"id": 2, "radio": "¡Box, box!", "prioridad": "urgente"})
    assert [m["id"] for m in runner.messages] == [2]  # urgent: at once

    live = SimpleNamespace()
    runner.observe(_telemetry(10.1, throttle=0.4, brake=0.6, steer=0.3), live)  # braking into a corner
    runner.observe(_telemetry(10.5, throttle=1.0), live)  # straight begins
    assert [m["id"] for m in runner.messages] == [2]
    runner.observe(_telemetry(11.2, throttle=1.0), live)  # flat out for 0.7 s
    assert [m["id"] for m in runner.messages] == [2, 1]

    runner._deliver({"id": 3, "radio": "otra", "prioridad": "info"})
    runner.observe(_telemetry(11.3, throttle=0.2, brake=0.9, steer=0.4), live)
    runner.observe(_telemetry(11.3 + RADIO_HOLD_S, throttle=0.2, brake=0.9, steer=0.4), live)
    assert runner.messages[-1]["id"] == 3  # a twisty bit never blocks the radio for long


def _lap(n, wear):
    return PlayerLap(lap=n, time_ms=95_000, position=5, compound="Medium", tyre_age=n, wear=wear, fuel_kg=50.0,
                     fuel_margin_laps=1.0, ers_percent=50.0, ers_deployed_mj=1.0, safety_car=False, pitted=False,
                     invalid=False, track_temp=30, weather="Clear")


def test_a_tyre_wearing_faster_than_the_rest_is_called_once():
    h = SessionHistory()
    for i in range(4):  # RL wears 1.2 %/lap, the others 0.6
        h.player_laps.append(_lap(5 + i, [10 + 1.2 * i, 10 + 0.6 * i, 9 + 0.6 * i, 9 + 0.6 * i]))
    calls = h._tyre_overuse(500.0, 8)
    assert len(calls) == 1 and calls[0].detail["rueda"] == "trasera izquierda"
    assert calls[0].detail["pct_por_vuelta"] == 1.2 and calls[0].detail["resto_pct_por_vuelta"] == 0.6
    assert h._tyre_overuse(510.0, 9) == []  # not again right away

    even = SessionHistory()
    for i in range(4):
        even.player_laps.append(_lap(5 + i, [10 + 0.8 * i] * 4))
    assert even._tyre_overuse(500.0, 8) == []


@pytest.mark.skipif(not TEXAS.exists() or TEXAS.stat().st_size < 1000, reason="captura no disponible (git lfs)")
def test_a_real_race_produces_corner_coaching():
    from app.engineer.engine import RaceEngineer
    from app.engineer.providers import RulesProvider
    from app.live.state import LiveSession
    from app.replay.player import ReplaySource
    from app.telemetry import registry

    engineer, live, notes = RaceEngineer(), None, []
    for _, data in ReplaySource([str(TEXAS)]).records():
        packet = registry.parse(data)
        if packet is None:
            continue
        if live is None:
            live = LiveSession(0, 0, packet.session_uid, packet.packet_format, build_layout=False)
        live.update(packet)
        request = engineer.observe(packet, live)
        if request and any(t.kind == "corner_coaching" for t in request.triggers):
            notes.append(request)
    assert len(engineer.history.corners.corners) >= 6
    assert notes, "no corner coaching over a whole race"
    radio = asyncio.run(RulesProvider().advise(notes[-1])).response["radio"]
    assert radio and "la " in radio
    facts = json.loads(notes[-1].facts_json)
    assert facts["curvas"]["peores"] and np.isfinite(facts["curvas"]["curvas_detectadas"])
