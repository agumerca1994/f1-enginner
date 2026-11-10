"""Damage calls: punctures, flashbacks and damage that builds up over a few packets."""

from dataclasses import replace

from app.engineer.engine import moment_text
from app.engineer.history import DAMAGE_CONFIRM_S, SessionHistory
from app.live.state import LiveSession
from app.telemetry import capture, registry
from tests.test_parser import BAKU_RACE, needs_baku


def _base_damage_packet():
    _, records = capture.read(BAKU_RACE)
    for rec in records:
        packet = registry.parse(rec.data)
        if packet.name == "car_damage":
            return packet
    raise AssertionError("no CarDamage packet in the capture")


def _damage(base, t: float, wings: int = 0, floor: int = 0, tyres=(2, 2, 2, 2)):
    header, body = base.header.copy(), base.body.copy()
    header["session_time"] = t
    d = body["car_damage_data"][base.player_car_index]
    d["front_left_wing_damage"] = d["front_right_wing_damage"] = wings
    d["floor_damage"] = floor
    d["tyres_damage"] = tyres
    d["rear_wing_damage"] = d["diffuser_damage"] = d["sidepod_damage"] = 0
    d["gear_box_damage"] = d["engine_damage"] = 0
    return replace(base, header=header, body=body)


def _feed(packets):
    clock = {"t": 0.0}
    history = SessionHistory()
    live = LiveSession(0, 0, packets[0].session_uid, 2024, build_layout=False, clock=lambda: clock["t"])
    triggers = []
    for p in packets:
        clock["t"] += 0.1
        live.update(p)
        triggers += [t for t in history.observe(p, live) if t.kind == "damage"]
    return triggers


@needs_baku
def test_a_puncture_is_called_and_worn_tyres_are_not():
    base = _base_damage_packet()
    packets = [_damage(base, 100 + i * 0.5) for i in range(4)]
    # Worn tyres: damage climbs with wear past 50, a point at a time.
    packets += [_damage(base, 102 + i * 0.5, tyres=(2 + i, 2 + i, 2 + i, 2 + i)) for i in range(60)]
    assert _feed(packets) == []

    packets = [_damage(base, 100 + i * 0.5) for i in range(4)]
    packets += [_damage(base, 102 + i * 0.5, tyres=(2, 100, 2, 2)) for i in range(30)]
    (trigger,) = _feed(packets)
    assert trigger.detail["parts"] == {"puncture_rear_right": 100}
    assert "Pinchazo en la goma trasera derecha" in moment_text(trigger)


@needs_baku
def test_damage_waits_out_the_flashback_menu_in_game_time():
    base = _base_damage_packet()
    clean = [_damage(base, 200 + i * 0.5) for i in range(4)]
    crash = [_damage(base, 202.0, wings=100)]
    # The game sits paused in the flashback menu: game time stands still, wall time runs.
    paused = [_damage(base, 202.0, wings=100) for _ in range(300)]
    # The flashback event was lost on the link; the game clock going back gives it away.
    rewound = [_damage(base, 195 + i * 0.5) for i in range(40)]
    assert _feed(clean + crash + paused + rewound) == []

    # Without a flashback, the damage is called once the game has run DAMAGE_CONFIRM_S.
    drove_on = [_damage(base, 202 + i * 0.5, wings=100) for i in range(int(DAMAGE_CONFIRM_S * 2) + 2)]
    (trigger,) = _feed(clean + crash + paused + drove_on)
    assert trigger.detail["parts"] == {"front_left_wing": 100, "front_right_wing": 100}


@needs_baku
def test_damage_that_builds_up_over_a_few_packets_adds_up():
    base = _base_damage_packet()
    packets = [_damage(base, 300 + i * 0.5) for i in range(4)]
    packets += [_damage(base, 302 + i * 0.1, floor=v) for i, v in enumerate((5, 10, 14, 18, 25))]
    packets += [_damage(base, 303 + i * 0.5, floor=25) for i in range(20)]
    (trigger,) = _feed(packets)
    assert trigger.detail["parts"] == {"floor": 25}  # the whole crash, not where it crossed the step
