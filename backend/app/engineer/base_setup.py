"""Base setups: a starting point for every track before the player has run there.

Each track is described by what it asks of the car: how much downforce it pays
to run, how aggressive the kerbs and bumps are, how much it leans on traction
out of slow corners and how hard the braking zones are. A setup follows from
those traits with the same rules a race engineer would start from (more wing
where corners matter more than straights, softer suspension where the kerbs
bite, a more open differential where traction is scarce). It is the app's own
starting point, not a copy of anyone's setup: the runs then tune it.

The ride height is left out: the game's scale for it is not documented and a
wrong number risks a car that bottoms out. The player keeps the game's default.
"""

from dataclasses import dataclass
from typing import Any

from app.telemetry import constants as c


@dataclass(frozen=True)
class Traits:
    downforce: float  # 0 (Monza) .. 5 (Monaco)
    kerbs: int  # 0 smooth .. 2 aggressive kerbs and bumps
    traction: int  # 0 .. 2 slow-corner exits
    braking: int  # 0 .. 2 heavy braking zones
    note: str


TRAITS: dict[int, Traits] = {
    0: Traits(3, 1, 1, 1, "Mixta, con curvas medias y rápidas y algunos pianos."),
    1: Traits(2.5, 0, 1, 1, "Lisa y rápida, con la recta larga del Mistral."),
    2: Traits(3, 0, 1, 1, "Equilibrada: curvas largas que castigan la goma delantera y una recta muy larga."),
    3: Traits(3, 1, 2, 2, "Frenadas fuertes y salidas lentas: pide tracción y cuida las traseras."),
    4: Traits(3.5, 1, 1, 1, "Mucha curva media y rápida: premia la carga aerodinámica."),
    5: Traits(5, 1, 2, 1, "Todo carga y tracción: la velocidad punta casi no importa."),
    6: Traits(1.5, 2, 2, 2, "Rectas, chicanes y pianos altos: poca carga y suspensión que copie los pianos."),
    7: Traits(3, 1, 0, 1, "Curvas rápidas encadenadas: estabilidad a alta velocidad."),
    8: Traits(2, 1, 1, 2, "Rectas largas y frenadas fuertes en horquillas."),
    9: Traits(4.5, 1, 1, 1, "Lenta y revirada, casi sin rectas: mucha carga."),
    10: Traits(1.5, 1, 1, 1, "Rectas larguísimas en el primer y último sector: poca carga."),
    11: Traits(0, 2, 1, 2, "El templo de la velocidad: alerones al mínimo y pianos en las chicanes."),
    12: Traits(5, 2, 2, 2, "Callejero, lento y con baches: carga máxima y suspensión blanda."),
    13: Traits(3.5, 1, 1, 1, "Curvas rápidas en ese: estabilidad y buena respuesta."),
    14: Traits(3, 1, 1, 1, "Mixta: una parte rápida y un sector final lento."),
    15: Traits(3, 2, 1, 1, "Mixta, con la subida a la curva 1 y pianos agresivos."),
    16: Traits(3, 2, 1, 1, "Corta, con desniveles y baches: suspensión que copie el piso."),
    17: Traits(2.5, 2, 2, 2, "Corta, con rectas y frenadas fuertes y pianos altos."),
    18: Traits(2.5, 0, 1, 1, "Lisa, con muchas curvas de 90 grados."),
    19: Traits(4, 1, 1, 1, "Aire fino por la altura: hace falta mucho alerón para tener carga."),
    20: Traits(1, 1, 2, 2, "Recta interminable y curvas lentas de 90 grados en la ciudad."),
    25: Traits(2, 1, 1, 2, "Rectas largas con frenadas fuertes."),
    26: Traits(4.5, 1, 1, 1, "Peraltes y curvas rápidas, casi sin rectas."),
    27: Traits(3.5, 2, 1, 1, "Clásica, con chicanes y pianos que hay que atacar."),
    28: Traits(3, 1, 1, 1, "Con desniveles y curvas ciegas."),
    29: Traits(1.5, 1, 1, 1, "Callejero muy rápido: poca carga."),
    30: Traits(2.5, 1, 2, 1, "Rectas largas y un sector lento y revirado."),
    31: Traits(0.5, 0, 1, 2, "Rectas larguísimas y pista fría: alerones al mínimo."),
    32: Traits(3.5, 2, 0, 1, "Curvas rápidas y medias y pianos altos."),
    42: Traits(3, 1, 1, 1, "Semiurbana y mixta, con un sector peraltado."),
}
# Short and reverse layouts behave like the full circuit.
for alias, base in {21: 3, 22: 7, 23: 15, 24: 13, 39: 7, 40: 17, 41: 26}.items():
    TRAITS[alias] = TRAITS[base]

DEFAULT = Traits(3, 1, 1, 1, "Pista sin datos: se usa un reglaje equilibrado.")


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def base_setup(track_id: int | None, wet: bool = False) -> dict[str, Any]:
    """The starting setup for a track, in the same keys the game's setup arrives in."""
    t = TRAITS.get(track_id, DEFAULT) if track_id is not None else DEFAULT
    df = t.downforce + (1.5 if wet else 0)  # rain: more wing for grip
    values: dict[str, Any] = {
        "aleron_delantero": int(_clamp(round(8 + 8 * df), 0, 50)),
        "aleron_trasero": int(_clamp(round(5 + 8 * df), 0, 50)),
        "diferencial_acelerando_pct": int(_clamp(60 - 5 * t.traction - (10 if wet else 0), 10, 100)),
        "diferencial_soltando_pct": 55,
        "camber_del": round(_clamp(-3.0 - 0.1 * t.downforce + (0.2 if wet else 0), -3.5, -2.5), 2),
        "camber_tras": round(_clamp(-1.5 - 0.1 * t.downforce + (0.2 if wet else 0), -2.2, -0.7), 2),
        "convergencia_del": 0.05,
        "convergencia_tras": 0.2,
        "suspension_del": int(_clamp(38 - 6 * t.kerbs - (8 if wet else 0), 1, 41)),
        "suspension_tras": int(_clamp(10 - 2 * t.kerbs - (3 if wet else 0), 1, 41)),
        "barra_antivuelco_del": int(_clamp(18 - 2 * t.kerbs - (4 if wet else 0), 1, 21)),
        "barra_antivuelco_tras": int(_clamp(8 - t.kerbs - (2 if wet else 0), 1, 21)),
        "presion_frenos_pct": 100 if t.braking < 2 else 98,
        "reparto_frenada_pct": 56 + (1 if t.braking == 2 else 0) + (1 if wet else 0),
        "freno_motor_pct": 50,
        "presiones_psi": {"del_izq": 23.0, "del_der": 23.0, "tras_izq": 21.0, "tras_der": 21.0},
    }
    return {
        "pista": c.TRACKS.get(track_id) if track_id is not None else None,
        "lluvia": wet,
        "caracteristicas": {
            "carga": t.downforce, "pianos": t.kerbs, "traccion": t.traction, "frenada": t.braking, "nota": t.note,
        },
        "valores": values,
        "nota": "Punto de partida armado por la app según el tipo de pista; la altura queda en el valor del juego. "
                "Dá dos o tres vueltas y ajustá con las sugerencias de la tanda.",
    }
