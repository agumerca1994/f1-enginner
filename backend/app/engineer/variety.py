"""Keeps the routine radio from sounding like a loop.

A real engineer talking every lap rotates what he talks about: where the time
goes, why the car does it, the pace trend, the car behind, the tyres, the stop,
a tool on the wheel, what happens around. The driver barely listens in the heat
of a race, but notices at once when every call has the same shape.

For each routine call this picks an angle (among those the facts can back up,
never one of the last two) and an opening (never the last one), at random. The
AI radio gets them as a brief; the rules radio picks among several templates.
"""

import random
from collections import deque
from typing import Any

ANGLES = {
    "curva": "dónde pierde tiempo: una curva, la fase y cuánto, contra su mejor paso",
    "causa": "por qué: lo que hace el auto (subviraje, bloqueo, patinaje o el daño) y una acción concreta",
    "ritmo": "la tendencia del ritmo: si mejora o cae vuelta a vuelta y cuánto contra su mejor vuelta",
    "rival_atras": "el de atrás: cuánto le descuenta por vuelta y en cuántas vueltas lo alcanza, o si se aleja",
    "rival_adelante": "el de adelante: cuánto le descuenta el piloto por vuelta y en cuántas vueltas lo alcanza",
    "gomas": "la goma más castigada: cuánto se gasta, cuántas vueltas le quedan y qué hacer para cuidarla",
    "estrategia": "la parada: ventana o vuelta objetivo, compuesto y dónde saldría",
    "ajuste": "un ajuste de `ajustes_en_carrera`: reparto de frenada o diferencial ahora, o alerón delantero en la parada",
    "entorno": "lo que pasa alrededor, de `incidentes`: quién paró, abandonos, toques adelante, quién lo pasó",
}
WEIGHTS = {"curva": 2, "causa": 2, "ritmo": 1, "rival_atras": 2, "rival_adelante": 2, "gomas": 1, "estrategia": 1,
           "ajuste": 2, "entorno": 2}

# Which angles fit each routine moment, best first.
BY_MOMENT = {
    "corner_coaching": ("curva", "causa", "ajuste"),
    "tyre_overuse": ("gomas", "causa", "ajuste", "estrategia"),
    "sector_completed": ("curva", "causa", "ritmo", "rival_atras", "rival_adelante"),
    "lap_completed": tuple(ANGLES),
}

OPENINGS = (
    "Arrancá por el dato: la cifra, la curva o el nombre.",
    "Arrancá por la acción: qué hacer.",
    "Arrancá por la tendencia contra lo que ya le dijiste: 'Seguís...', 'Otra vez...', 'Mejor que antes...'.",
    "Arrancá por el rival o por la situación de carrera.",
)


def available(f: dict[str, Any]) -> set[str]:
    """The angles the facts can back up right now."""
    out = set()
    worst = ((f.get("curvas") or {}).get("peores") or [])
    if any((r.get("perdida_media_s") or 0) >= 0.15 for r in worst):
        out.add("curva")
    adj = f.get("ajustes_en_carrera") or {}
    if adj.get("problemas_repetidos") or any(a.get("prioridad") in ("P0", "P1") and "daño" in a.get("tema", "")
                                             for a in f.get("alertas") or []):
        out.add("causa")
    if len([v for v in (f.get("ritmo") or {}).get("vueltas") or [] if v.get("tiempo_s")]) >= 3:
        out.add("ritmo")
    reach = (f.get("rivales") or {}).get("alcance") or {}
    if (reach.get("atras") or {}).get("piloto"):
        out.add("rival_atras")
    if (reach.get("adelante") or {}).get("piloto"):
        out.add("rival_adelante")
    if (f.get("neumaticos") or {}).get("desgaste_por_vuelta_max"):
        out.add("gomas")
    se = f.get("sesion") or {}
    rule = ((f.get("estrategia_calculos") or {}).get("regla_dos_compuestos") or {})
    if not se.get("por_tiempo") and (rule.get("aplica") and not rule.get("cumplida")
                                     or ((f.get("memoria") or {}).get("plan_carrera") or {}).get("vuelta_box")):
        out.add("estrategia")
    if adj.get("desde_el_volante") or adj.get("en_la_proxima_parada"):
        out.add("ajuste")
    inc = f.get("incidentes") or {}
    lap = se.get("vuelta_actual") or 0
    recent = lambda items: any((x.get("vuelta") or 0) >= lap - 1 for x in items or [])  # noqa: E731
    if inc.get("paradas_rivales_cerca") or recent(inc.get("abandonos")) or recent(inc.get("toques_entre_otros")) \
            or recent(inc.get("adelantamientos")):
        out.add("entorno")
    return out


class Variety:
    """Remembers the last angles and openings of one session."""

    def __init__(self, rng: random.Random | None = None) -> None:
        self.rng = rng or random.Random()
        self.angles: deque[str] = deque(maxlen=2)
        self.openings: deque[int] = deque(maxlen=1)

    def brief(self, kinds: list[str], facts: dict[str, Any]) -> str | None:
        """The brief for one routine radio call, or None when the moment is not routine."""
        fits = [a for k in kinds for a in BY_MOMENT.get(k, ())]
        if not fits:
            return None
        can = available(facts)
        pool = [a for a in dict.fromkeys(fits) if a in can]
        fresh = [a for a in pool if a not in self.angles] or [a for a in pool if a != (self.angles or [None])[-1]]
        if not fresh:
            return None
        angle = self.rng.choices(fresh, weights=[WEIGHTS[a] for a in fresh])[0]
        self.angles.append(angle)
        opening = self.rng.choice([i for i in range(len(OPENINGS)) if i not in self.openings])
        self.openings.append(opening)
        others = [a for a in pool if a != angle]
        return "\n".join([
            "## Enfoque de este mensaje",
            f"Hablá de {ANGLES[angle]}. {OPENINGS[opening]}",
            "Si en tus mensajes anteriores ya tocaste ese tema, contalo como continuación con lo que cambió "
            "(cuánto más, cuánto menos), nunca con la misma frase. No repitas la estructura de tus últimos mensajes.",
            (f"Si con ese enfoque no hay nada nuevo, usá otro de estos: {', '.join(others)}. " if others else "")
            + "Si no hay nada nuevo de verdad, radio null.",
        ])

    def pick(self, options: list[str], recent: list[str]) -> str:
        """One of several templates, avoiding the openings of the last calls."""
        heads = {" ".join(r.split()[:2]).lower() for r in recent[-3:] if r}
        fresh = [o for o in options if " ".join(o.split()[:2]).lower() not in heads] or options
        return self.rng.choice(fresh)
