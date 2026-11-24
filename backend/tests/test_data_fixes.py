"""Data fixes from the Las Vegas and Qatar reports: flashbacks, qualifying laps, retirements,
events with "no value", slow damage, the radio of another session and more."""

from dataclasses import replace
from types import SimpleNamespace

from app.engineer import analysis
from app.engineer.history import CarLap, PlayerLap, SessionHistory
from app.engineer.runner import EngineerRunner
from app.engineer.providers import RulesProvider
from app.live.laps import pit_sample
from app.live.state import LiveSession
from app.engineer.review import classification
from app.telemetry import capture, registry
from tests.test_damage import _base_damage_packet, _damage, _feed
from tests.test_parser import BAKU_RACE, needs_baku

NO_LIVE = SimpleNamespace(last={})


def test_a_qualifying_lap_that_starts_in_the_pit_lane_is_not_a_pit_lap():
    track = 5400.0
    leaving = {"pit_status": 1, "lap_distance": 120.0}  # pit exit after the line
    in_lap = {"pit_status": 1, "lap_distance": 5300.0}
    stopped = {"pit_status": 2, "lap_distance": 50.0}
    assert not pit_sample(leaving, track, race=False)
    assert pit_sample(in_lap, track, race=False)
    assert pit_sample(stopped, track, race=False)
    assert pit_sample(leaving, track, race=True)  # in a race every pit lane visit counts


def test_a_flashback_drops_the_events_after_the_restored_moment():
    h = SessionHistory()
    h._race = True
    h._record_event("OVTK", {"overtaking_vehicle_idx": 3, "being_overtaken_vehicle_idx": 0}, 100.0, NO_LIVE)
    h._record_event("OVTK", {"overtaking_vehicle_idx": 4, "being_overtaken_vehicle_idx": 0}, 110.0, NO_LIVE)
    h._rewind(105.0)
    assert [e["overtaking_vehicle_idx"] for e in h.events] == [3]
    # Replayed after the flashback, the same overtake inside a few seconds is kept once.
    h._record_event("OVTK", {"overtaking_vehicle_idx": 3, "being_overtaken_vehicle_idx": 0}, 102.0, NO_LIVE)
    assert len(h.events) == 1


def test_no_value_fields_and_qualifying_overtakes_are_dropped():
    h = SessionHistory()
    h._race = True
    h._record_event("PENA", {"penalty_type": 5, "other_vehicle_idx": 255, "time": 255, "places_gained": 255,
                             "vehicle_idx": 2}, 50.0, NO_LIVE)
    assert h.events[0] == {"code": "PENA", "session_time": 50.0, "lap": None, "penalty_type": 5, "vehicle_idx": 2}
    h._race = False
    h._record_event("OVTK", {"overtaking_vehicle_idx": 0, "being_overtaken_vehicle_idx": 7}, 60.0, NO_LIVE)
    assert [e["code"] for e in h.events] == ["PENA"]


@needs_baku
def test_damage_that_creeps_up_is_reported_at_each_level():
    base = _base_damage_packet()
    # The floor wears on the kerbs a point every few seconds up to 52%.
    packets = [_damage(base, 100 + i * 3, floor=min(i, 52)) for i in range(70)]
    triggers = _feed(packets)
    floors = [t.detail["parts"]["floor"] for t in triggers if "floor" in t.detail["parts"]]
    assert floors and max(floors) >= 50


def _snap(cars):
    return {"cars": [{"index": i, "is_player": i == 0, "position": pos, "result": result, "name": f"P{i}",
                      "best_lap_ms": best} for i, pos, result, best in cars]}


def test_a_retired_car_leaves_the_running_order():
    history = SessionHistory()
    history.retired.add(2)  # RTMT arrived, the game still lists it ahead
    snap = _snap([(1, 1, "active", None), (2, 2, "active", None), (0, 3, "active", None), (3, 4, "dnf", None)])
    assert [car["index"] for car in analysis.running(snap, history)] == [1, 0]


def test_qualifying_gaps_are_best_lap_differences():
    snap = _snap([(1, 1, "active", 85_011), (0, 2, "active", 85_139), (2, 3, "active", 86_397)])
    cars = analysis.running(snap, SessionHistory())
    me = next(car for car in cars if car["is_player"])
    assert analysis._best_lap_gaps(cars, me) == (0.128, 0.128)


def _lap(n, fuel, pitted=False):
    return PlayerLap(lap=n, time_ms=90_000, position=5, compound="Medium", tyre_age=n, wear=None, fuel_kg=fuel,
                     fuel_margin_laps=1.0, ers_percent=50, ers_deployed_mj=1.0, safety_car=False, pitted=pitted,
                     invalid=False, track_temp=30, weather="Clear")


def test_fuel_consumption_ignores_a_flashback_that_gives_fuel_back():
    laps = [_lap(2, 50.0), _lap(3, 48.2), _lap(4, 48.6), _lap(5, 46.8)]
    fuel = analysis._fuel({"status": {}}, laps, 20, 6)
    assert fuel["consumo_kg_por_vuelta_verde"] == 1.8


def test_gap_trend_skips_the_lap_of_a_stop():
    history = SessionHistory()
    for n in range(2, 8):
        history.car_laps.setdefault(0, []).append(CarLap(n, 90_000, 5, 1000, 10_000, 0, "Medium", n))
        stops = 1 if n >= 6 else 0
        # The rival stopped on lap 6: 20 s more to the leader from then on, steady before and after.
        history.car_laps.setdefault(1, []).append(
            CarLap(n, 90_000, 6, 1000, 12_000 + 20_000 * stops, stops, "Medium", n))
    trend = analysis._gap_trend(history, {"index": 0}, {"index": 1})
    assert trend is not None and trend.startswith("se ") and " 0.00 s/vuelta" in trend


def test_a_new_session_never_shows_the_radio_of_the_previous_one():
    runner = EngineerRunner(1, "live", provider=RulesProvider())
    runner.messages.append({"id": 1, "radio": "Terminó la sesión en Bakú"})
    runner.reset()
    assert list(runner.messages) == []


@needs_baku
def test_final_classification_falls_back_to_the_running_order():
    _, records = capture.read(BAKU_RACE)
    live = None
    last_lap = None
    for rec in records:
        p = registry.parse(rec.data)
        if p is None or p.name == "final_classification":
            continue
        if live is None:
            live = LiveSession(0, 0, p.session_uid, 2024, build_layout=False)
        live.update(p)
        if p.name == "lap_data":
            last_lap = p
    live.last.pop("final_classification", None)
    assert classification(live) is None  # the player has not finished in this packet
    body = last_lap.body.copy()
    body["lap_data"][last_lap.player_car_index]["result_status"] = 3
    live.last["lap_data"] = replace(last_lap, body=body)
    rows = classification(live)
    assert rows and any(r["es_el_jugador"] for r in rows) and "orden en pista" in rows[0]["fuente"]
