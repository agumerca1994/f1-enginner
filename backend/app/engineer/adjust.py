"""What the driver can still change once the setup is locked (qualifying and race).

Under parc fermé only three things move: from the wheel, the brake bias and the
differential on throttle (the multi-function display); at a pit stop, the front
wing angle. Bars, rear wing, suspension and ride height wait for the next
session. Code reads the recurring corner issues and turns them into one-step
suggestions with the current value, so the engineer never invents a direction.
"""

from typing import Any

from app.engineer.corners import CornerCoach

LAST_LAPS = 3
MIN_LAPS = 2  # an issue counts at a corner when it shows on this many of the last laps
MIN_CORNERS = 2  # and at this many corners, so one bad pass is not a setup problem
BRAKE_BIAS_RANGE = (50, 70)
DIFF_RANGE = (10, 100)
DIFF_STEP = 5
FRONT_WING_RANGE = (0, 50)


def recurring_issues(coach: CornerCoach) -> dict[str, list[int]]:
    """Issue -> the corners where it showed on at least MIN_LAPS of the last laps."""
    laps = sorted(coach.passes)[-LAST_LAPS:]
    out: dict[str, list[int]] = {}
    for k in coach.corners:
        counts: dict[str, int] = {}
        for lap in laps:
            p = coach.passes[lap].get(k.number)
            for issue in (p.issues() if p else []):
                counts[issue] = counts.get(issue, 0) + 1
        for issue, n in counts.items():
            if n >= MIN_LAPS:
                out.setdefault(issue, []).append(k.number)
    return out


def _clamp(value: int, bounds: tuple[int, int]) -> int:
    return max(bounds[0], min(bounds[1], value))


def _where(corners: list[int]) -> str:
    names = [str(n) for n in corners[:3]]
    return "la " + (names[0] if len(names) == 1 else ", la ".join(names[:-1]) + " y la " + names[-1])


def in_session(coach: CornerCoach, setup: dict | None, brake_bias: int | None, exit_losses: set[int]) -> dict[str, Any]:
    """Suggestions for the wheel now and for the next stop, each with the current value and why."""
    issues = recurring_issues(coach)
    many = {k: v for k, v in issues.items() if len(v) >= MIN_CORNERS}
    wheel: list[dict[str, Any]] = []
    stop: list[dict[str, Any]] = []

    front, rear = many.get("bloqueo_delantero"), many.get("bloqueo_trasero")
    if brake_bias is not None and front and not rear and brake_bias > BRAKE_BIAS_RANGE[0]:
        wheel.append({"ajuste": "reparto de frenada", "actual": brake_bias,
                      "sugerido": _clamp(brake_bias - 1, BRAKE_BIAS_RANGE),
                      "por": f"bloqueás adelante en {_where(front)}: un punto hacia atrás"})
    elif brake_bias is not None and rear and not front and brake_bias < BRAKE_BIAS_RANGE[1]:
        wheel.append({"ajuste": "reparto de frenada", "actual": brake_bias,
                      "sugerido": _clamp(brake_bias + 1, BRAKE_BIAS_RANGE),
                      "por": f"bloqueás atrás en {_where(rear)}: un punto hacia adelante"})

    diff = (setup or {}).get("diferencial_acelerando_pct")
    spin = many.get("patinaje_traccion")
    exit_under = [n for n in many.get("subviraje", []) if n in exit_losses]
    if diff is not None and spin and diff < DIFF_RANGE[1]:
        wheel.append({"ajuste": "diferencial al acelerar", "actual": diff,
                      "sugerido": _clamp(diff + DIFF_STEP, DIFF_RANGE),
                      "por": f"patinás atrás al salir de {_where(spin)}: más bloqueo da más tracción"})
    elif diff is not None and len(exit_under) >= MIN_CORNERS and diff > DIFF_RANGE[0]:
        wheel.append({"ajuste": "diferencial al acelerar", "actual": diff,
                      "sugerido": _clamp(diff - DIFF_STEP, DIFF_RANGE),
                      "por": f"el auto no gira al salir de {_where(exit_under)}: menos bloqueo deja rotar más"})

    wing = (setup or {}).get("aleron_delantero")
    under, over = many.get("subviraje", []), many.get("sobreviraje", [])
    if wing is not None and len(under) >= 3 and len(under) > len(over) and wing < FRONT_WING_RANGE[1]:
        stop.append({"ajuste": "alerón delantero", "actual": wing, "sugerido": _clamp(wing + 2, FRONT_WING_RANGE),
                     "por": f"subviraje repetido en {_where(under)}: más carga adelante"})
    elif wing is not None and len(over) >= 3 and len(over) > len(under) and wing > FRONT_WING_RANGE[0]:
        stop.append({"ajuste": "alerón delantero", "actual": wing, "sugerido": _clamp(wing - 1, FRONT_WING_RANGE),
                     "por": f"sobreviraje repetido en {_where(over)}: menos carga adelante equilibra el auto"})

    return {
        "desde_el_volante": wheel,
        "en_la_proxima_parada": stop,
        "problemas_repetidos": issues,
        "nota": ("Con el reglaje bloqueado, desde el volante (pantalla multifunción) se cambian el reparto de frenada y "
                 "el diferencial al acelerar; en una parada, el ángulo del alerón delantero (y las gomas). Barras, "
                 "alerón trasero, suspensión y alturas quedan para la próxima sesión: no los sugieras en carrera."),
    }
