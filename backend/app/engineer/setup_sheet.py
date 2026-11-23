"""The player's setup from a CarSetups packet, in the engineer's words."""

from typing import Any


def setup_values(packet) -> dict[str, Any] | None:
    """The player's setup from a CarSetups packet, in the engineer's words. None when it is all zeros."""
    s = packet.body["car_setups"][packet.player_car_index]
    if int(s["front_wing"]) == 0 and int(s["rear_wing"]) == 0 and int(s["brake_bias"]) == 0:
        return None  # not shared (restricted online telemetry) or not sent yet
    return {
        "aleron_delantero": int(s["front_wing"]), "aleron_trasero": int(s["rear_wing"]),
        "diferencial_acelerando_pct": int(s["on_throttle"]), "diferencial_soltando_pct": int(s["off_throttle"]),
        "camber_del": round(float(s["front_camber"]), 2), "camber_tras": round(float(s["rear_camber"]), 2),
        "convergencia_del": round(float(s["front_toe"]), 2), "convergencia_tras": round(float(s["rear_toe"]), 2),
        "suspension_del": int(s["front_suspension"]), "suspension_tras": int(s["rear_suspension"]),
        "barra_antivuelco_del": int(s["front_anti_roll_bar"]), "barra_antivuelco_tras": int(s["rear_anti_roll_bar"]),
        "altura_del": int(s["front_suspension_height"]), "altura_tras": int(s["rear_suspension_height"]),
        "presion_frenos_pct": int(s["brake_pressure"]), "reparto_frenada_pct": int(s["brake_bias"]),
        "freno_motor_pct": int(s["engine_braking"]),
        "presiones_psi": {"tras_izq": round(float(s["rear_left_tyre_pressure"]), 1),
                          "tras_der": round(float(s["rear_right_tyre_pressure"]), 1),
                          "del_izq": round(float(s["front_left_tyre_pressure"]), 1),
                          "del_der": round(float(s["front_right_tyre_pressure"]), 1)},
        "lastre": int(s["ballast"]),
    }
