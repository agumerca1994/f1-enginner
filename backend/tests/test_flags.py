"""Fase B — banderas FIA y superficie / fuera de pista."""

from app.engineer import analysis
from app.engineer.history import PlayerLap, SessionHistory
from app.live.state import LiveSession
from app.telemetry import constants as c


def test_constants_cover_flags_and_surfaces():
    assert c.FIA_FLAGS[2] == "blue" and c.FIA_FLAGS[3] == "yellow" and c.FIA_FLAGS[-1] is None
    assert c.SURFACE_TYPES[0] == "tarmac" and c.SURFACE_TYPES[7] == "grass"
    assert "grass" in c.OFF_TRACK_SURFACES and "tarmac" not in c.OFF_TRACK_SURFACES


def test_player_facts_expose_flag_and_off_track():
    h = SessionHistory()
    h.player_laps.append(PlayerLap(
        lap=5, time_ms=95_000, position=4, compound="Medium", tyre_age=5,
        wear=[10.0, 10.0, 8.0, 8.0], fuel_kg=50.0, fuel_margin_laps=3.0,
        ers_percent=50.0, ers_deployed_mj=1.0, safety_car=False, pitted=False,
        invalid=False, track_temp=30, weather="Clear", off_track_pct=12.3,
    ))
    facts = analysis.build(LiveSession(0, 0, 1, 2024, build_layout=False), h)
    assert facts["piloto"]["fuera_de_pista_ult_vuelta_pct"] == 12.3
    assert facts["piloto"]["bandera_fia"] is None  # no status packet in this bare live state


def test_g_forces_and_slip_in_facts():
    h = SessionHistory()
    h.player_laps.append(PlayerLap(
        lap=6, time_ms=95_000, position=4, compound="Medium", tyre_age=6,
        wear=[10.0, 10.0, 8.0, 8.0], fuel_kg=48.0, fuel_margin_laps=3.0,
        ers_percent=50.0, ers_deployed_mj=1.0, safety_car=False, pitted=False,
        invalid=False, track_temp=30, weather="Clear",
        peak_lat_g=4.86, peak_brake_g=3.63,
        peak_slip_ratio=0.184, peak_front_slip=0.25, peak_rear_slip=0.149,
    ))
    p = analysis.build(LiveSession(0, 0, 1, 2024, build_layout=False), h)["piloto"]
    assert p["fuerzas_g_ult_vuelta"] == {"lateral_max": 4.86, "frenada_max": 3.63}
    d = p["deslizamiento_ult_vuelta"]
    assert d["angulo_delantero_max"] > d["angulo_trasero_max"]  # understeer tendency
