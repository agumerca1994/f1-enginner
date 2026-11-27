"""The routine radio rotates its angle and opening; a flashback does not repeat a lap's calls."""

import random

from app.engineer.history import SessionHistory, Trigger
from app.engineer.variety import Variety

FACTS = {
    "curvas": {"peores": [{"curva": 6, "perdida_media_s": 0.4}]},
    "ajustes_en_carrera": {"problemas_repetidos": {"subviraje": [1, 6]},
                           "desde_el_volante": [{"ajuste": "diferencial al acelerar"}]},
    "ritmo": {"vueltas": [{"tiempo_s": 90.1}, {"tiempo_s": 90.4}, {"tiempo_s": 90.9}]},
    "rivales": {"alcance": {"atras": {"piloto": "RUSSELL"}, "adelante": None}},
    "neumaticos": {"desgaste_por_vuelta_max": {"rueda": "del_izq", "pct": 3.2}},
    "sesion": {"vuelta_actual": 10, "por_tiempo": False},
}


def test_angles_never_repeat_the_last_two():
    v = Variety(random.Random(7))
    seen = []
    for _ in range(30):
        brief = v.brief(["lap_completed"], FACTS)
        assert brief and brief.startswith("## Enfoque")
        seen.append(v.angles[-1])
    assert all(seen[i] not in seen[max(0, i - 2):i] for i in range(len(seen)))
    assert len(set(seen)) >= 5


def test_only_angles_the_facts_back_up():
    v = Variety(random.Random(1))
    for _ in range(10):
        v.brief(["corner_coaching"], FACTS)
        assert v.angles[-1] in ("curva", "causa", "ajuste")
    assert Variety().brief(["safety_car"], FACTS) is None


def test_templates_avoid_the_last_openings():
    v = Variety(random.Random(3))
    options = ["Perdés dos décimas en la 6.", "La 6 te cuesta dos décimas.", "Otra vez la 6, dos décimas."]
    for _ in range(20):
        assert v.pick(options, ["Perdés dos décimas en la 6."]) != options[0]


def test_a_flashback_does_not_repeat_the_lap_calls():
    h = SessionHistory()
    first = Trigger("lap_completed", 100.0, 9)
    assert h._first_time(first)
    assert not h._first_time(Trigger("lap_completed", 104.0, 9))
    assert h._first_time(Trigger("sector_completed", 105.0, 10, {"sector": 1}))
    assert h._first_time(Trigger("sector_completed", 106.0, 10, {"sector": 2}))
    assert not h._first_time(Trigger("sector_completed", 107.0, 10, {"sector": 1}))
    assert h._first_time(Trigger("damage", 108.0, 10))
