"""Sanctions, contacts and in-race adjustments, as the engineer receives them."""

from types import SimpleNamespace

from app.engineer import adjust
from app.engineer.engine import moment_text
from app.engineer.history import SessionHistory, Trigger, sanction_text


def test_sanction_text_names_the_penalty_the_reason_and_the_other_car():
    e = {"code": "PENA", "penalty_type": 1, "infringement_type": 3, "vehicle_idx": 19, "other_vehicle_idx": 5, "time": 10}
    assert sanction_text(e, {5: "PIASTRI"}) == "stop and go de 10 s por choque fuerte con PIASTRI"
    warning = {"code": "PENA", "penalty_type": 5, "infringement_type": 27, "vehicle_idx": 19}
    assert sanction_text(warning, {}) == "advertencia por pasarse de los límites de pista"


def test_a_pending_stop_go_reaches_the_engineer():
    t = Trigger("penalty", 286.4, 4, {"penalties_s": 0, "warnings": 0, "stop_go": 1, "drive_through": 0,
                                      "sancion": "stop and go de 10 s por choque fuerte con PIASTRI"})
    text = moment_text(t)
    assert "stop and go de 10 s" in text and "1 stop and go sin cumplir" in text


def test_last_sanction_is_the_players_newest_penalty_event():
    h = SessionHistory()
    h.names = {5: "PIASTRI"}
    h.events = [{"code": "PENA", "penalty_type": 5, "infringement_type": 4, "vehicle_idx": 3, "session_time": 1},
                {"code": "PENA", "penalty_type": 1, "infringement_type": 3, "vehicle_idx": 19, "other_vehicle_idx": 5,
                 "time": 10, "session_time": 2}]
    assert h.last_sanction(19) == "stop and go de 10 s por choque fuerte con PIASTRI"
    assert h.last_sanction(7) is None


class _Pass:
    def __init__(self, *issues):
        self._issues = list(issues)

    def issues(self):
        return self._issues


def _coach(per_corner: dict[int, tuple]) -> SimpleNamespace:
    corners = [SimpleNamespace(number=n) for n in per_corner]
    passes = {lap: {n: _Pass(*issues) for n, issues in per_corner.items()} for lap in (5, 6, 7)}
    return SimpleNamespace(corners=corners, passes=passes)


def test_front_locking_moves_the_brake_bias_back_one_point():
    out = adjust.in_session(_coach({1: ("bloqueo_delantero",), 4: ("bloqueo_delantero",)}),
                            {"diferencial_acelerando_pct": 50, "aleron_delantero": 30}, 56, set())
    assert out["desde_el_volante"] == [{"ajuste": "reparto de frenada", "actual": 56, "sugerido": 55,
                                        "por": "bloqueás adelante en la 1 y la 4: un punto hacia atrás"}]
    assert out["en_la_proxima_parada"] == []


def test_understeer_everywhere_asks_for_front_wing_at_the_stop_and_an_open_diff():
    coach = _coach({1: ("subviraje",), 3: ("subviraje",), 7: ("subviraje",)})
    out = adjust.in_session(coach, {"diferencial_acelerando_pct": 35, "aleron_delantero": 30}, 56, {1, 3})
    assert out["desde_el_volante"][0]["ajuste"] == "diferencial al acelerar"
    assert out["desde_el_volante"][0]["sugerido"] == 30
    assert out["en_la_proxima_parada"][0] == {"ajuste": "alerón delantero", "actual": 30, "sugerido": 32,
                                              "por": "subviraje repetido en la 1, la 3 y la 7: más carga adelante"}


def test_no_front_wing_suggestion_when_it_is_already_at_the_limit():
    coach = _coach({1: ("subviraje",), 3: ("subviraje",), 7: ("subviraje",)})
    out = adjust.in_session(coach, {"diferencial_acelerando_pct": 35, "aleron_delantero": 50}, 56, set())
    assert out["en_la_proxima_parada"] == []


def test_wheelspin_locks_the_diff_more():
    out = adjust.in_session(_coach({3: ("patinaje_traccion",), 8: ("patinaje_traccion",)}),
                            {"diferencial_acelerando_pct": 50, "aleron_delantero": 30}, 56, set())
    assert out["desde_el_volante"][0]["sugerido"] == 55
