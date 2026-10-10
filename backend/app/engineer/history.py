"""Lap-by-lap memory of a session, and the moments the engineer should speak.

The live state only keeps the latest packet of each kind; the engineer needs
history: every car's lap times and gaps, and for the player also tyres, fuel,
ERS and damage at the end of each lap. On a lossy link a lap can be missed;
records then simply have gaps, and the analysis works with what exists.
"""

from dataclasses import dataclass, field

from app.live.state import LiveSession
from app.telemetry import constants as c
from app.telemetry import registry
from app.telemetry.registry import Packet

# How much a part's damage must grow, in points, to call the engineer.
DAMAGE_STEP = 15
# Players often undo a crash with a flashback a few seconds later: damage is
# reported only if no flashback follows within this many seconds.
DAMAGE_CONFIRM_S = 8.0
RAIN_ALERT_PERCENT = 40


@dataclass
class CarLap:
    lap: int
    time_ms: int | None
    position: int
    gap_ahead_ms: int
    gap_leader_ms: int
    pit_stops: int
    compound: str | None
    tyre_age: int | None
    safety_car: bool = False  # the safety car was out at some point of this lap


@dataclass
class PlayerLap:
    lap: int
    time_ms: int | None
    position: int
    compound: str | None
    tyre_age: int | None
    wear: list[float] | None  # RL, RR, FL, FR
    fuel_kg: float | None
    fuel_margin_laps: float | None
    ers_percent: float | None
    ers_deployed_mj: float | None
    safety_car: bool
    pitted: bool
    invalid: bool
    track_temp: int | None
    weather: str | None
    surface_temp_avg: list[float] | None = None  # RL, RR, FL, FR, averaged over the lap
    inner_temp_avg: list[float] | None = None


@dataclass
class Trigger:
    kind: str  # session_start, lap_completed, safety_car, rain_forecast, damage, penalty, pitted, session_end
    session_time: float
    lap: int | None
    detail: dict = field(default_factory=dict)


class SessionHistory:
    def __init__(self) -> None:
        self.car_laps: dict[int, list[CarLap]] = {}
        self.player_laps: list[PlayerLap] = []
        self.events: list[dict] = []
        self.triggers: list[Trigger] = []
        self.compounds_used: list[str] = []
        self.tyre_sets = None  # the player's last TyreSets packet body
        self._last_lap: dict[int, int] = {}
        # Per-lap accumulators for the player, reset when a lap completes.
        self._lap_sc = False
        self._lap_pit = False
        self._lap_invalid = False
        self._lap_ers_deployed = 0.0
        self._temp_samples: list[tuple[list[int], list[int]]] = []
        # Previous values, to detect changes.
        self._sc_status = "None"
        self._rain_alerted = False
        self._damage: dict[str, int] = {}
        self._pending_damage: tuple[float, float, dict] | None = None  # (clock, session_time, parts)
        self._rebaseline_damage = False
        self._penalties = 0
        self._warnings = 0
        self._pit_stops = 0
        self._started = False

    # --- feeding ------------------------------------------------------------

    def observe(self, packet: Packet, live: LiveSession) -> list[Trigger]:
        """Update the history with one packet; return the moments worth an engineer call."""
        new: list[Trigger] = []
        t = packet.session_time
        if self._pending_damage and live.clock() - self._pending_damage[0] >= DAMAGE_CONFIRM_S:
            _, when, parts = self._pending_damage
            self._pending_damage = None
            new.append(Trigger("damage", when, self._player_lap(live), {"parts": parts}))
        if packet.name == "event":
            code, details = registry.event_details(packet)
            if code not in ("BUTN", "SPTP"):
                self.events.append({"code": code, "session_time": round(t, 1), "lap": self._player_lap(live), **details})
            if code == "FLBK":
                # The game rewound: whatever damage just happened may be undone.
                self._pending_damage = None
                self._rebaseline_damage = True
            if code in ("SEND", "CHQF"):
                new.append(Trigger("session_end", t, self._player_lap(live), {"code": code}))
        elif packet.name == "session":
            new += self._session_changes(packet, live)
        elif packet.name == "car_status":
            self._note_compound(live)
            st = packet.body["car_status_data"][packet.player_car_index]
            self._lap_ers_deployed = max(self._lap_ers_deployed, float(st["ers_deployed_this_lap"]))
        elif packet.name == "tyre_sets":
            if int(packet.body["car_idx"]) == packet.player_car_index:
                self.tyre_sets = packet.body
        elif packet.name == "car_telemetry":
            tel = packet.body["car_telemetry_data"][packet.player_car_index]
            self._temp_samples.append(([int(x) for x in tel["tyres_surface_temperature"]],
                                       [int(x) for x in tel["tyres_inner_temperature"]]))
        elif packet.name == "car_damage":
            new += self._damage_changes(packet, live)
        elif packet.name == "lap_data":
            new += self._lap_changes(packet, live)
        self.triggers += new
        return new

    def _player_lap(self, live: LiveSession) -> int | None:
        lap = live.last.get("lap_data")
        return None if lap is None else int(lap.body["lap_data"][lap.player_car_index]["current_lap_num"])

    def _session_changes(self, packet: Packet, live: LiveSession) -> list[Trigger]:
        out = []
        b = packet.body
        t = packet.session_time
        if not self._started and live.last.get("lap_data") is not None:
            is_race = int(b["session_type"]) in (15, 16, 17)
            # For a race, wait until the compound is known so the opening brief
            # can lay out a real pit-stop plan, not a blank one.
            if not is_race or live.last.get("car_status") is not None:
                self._started = True
                out.append(Trigger("race_start" if is_race else "session_start", t, self._player_lap(live)))
        sc = c.SAFETY_CAR_STATUS.get(int(b["safety_car_status"]), "None")
        if sc != self._sc_status:
            if sc in ("Full safety car", "Virtual safety car") or self._sc_status in ("Full safety car", "Virtual safety car"):
                out.append(Trigger("safety_car", t, self._player_lap(live), {"from": self._sc_status, "to": sc}))
            self._sc_status = sc
        if sc in ("Full safety car", "Virtual safety car"):
            self._lap_sc = True
        samples = b["weather_forecast_samples"][: int(b["num_weather_forecast_samples"])]
        rain = max((int(s["rain_percentage"]) for s in samples if int(s["time_offset"]) <= 15), default=0)
        if rain >= RAIN_ALERT_PERCENT and not self._rain_alerted:
            self._rain_alerted = True
            out.append(Trigger("rain_forecast", t, self._player_lap(live), {"rain_percent": rain}))
        elif rain < RAIN_ALERT_PERCENT // 2:
            self._rain_alerted = False
        return out

    def _damage_changes(self, packet: Packet, live: LiveSession) -> list[Trigger]:
        d = packet.body["car_damage_data"][packet.player_car_index]
        parts = {
            "front_left_wing": int(d["front_left_wing_damage"]), "front_right_wing": int(d["front_right_wing_damage"]),
            "rear_wing": int(d["rear_wing_damage"]), "floor": int(d["floor_damage"]), "diffuser": int(d["diffuser_damage"]),
            "sidepod": int(d["sidepod_damage"]), "gearbox": int(d["gear_box_damage"]), "engine": int(d["engine_damage"]),
        }
        if not self._damage or self._rebaseline_damage:
            self._damage, self._rebaseline_damage = parts, False
            return []
        grown = {k: v for k, v in parts.items() if v - self._damage.get(k, 0) >= DAMAGE_STEP}
        self._damage = parts
        if grown:
            # Wait to see whether a flashback undoes it before calling the engineer.
            self._pending_damage = (live.clock(), packet.session_time, grown)
        return []

    def _note_compound(self, live: LiveSession) -> None:
        st = live.last["car_status"].body["car_status_data"][live.last["car_status"].player_car_index]
        compound = c.VISUAL_COMPOUNDS.get(int(st["visual_tyre_compound"]))
        if compound and (not self.compounds_used or self.compounds_used[-1] != compound):
            self.compounds_used.append(compound)

    def _lap_changes(self, packet: Packet, live: LiveSession) -> list[Trigger]:
        out = []
        player = packet.player_car_index
        laps = packet.body["lap_data"]
        status = live.last.get("car_status")
        for i in live.active_cars():
            lap = laps[i]
            num = int(lap["current_lap_num"])
            prev = self._last_lap.get(i)
            self._last_lap[i] = num
            if prev is None or num <= prev:
                continue
            compound = age = None
            if status is not None:
                st = status.body["car_status_data"][i]
                compound = c.VISUAL_COMPOUNDS.get(int(st["visual_tyre_compound"]))
                age = int(st["tyres_age_laps"]) if compound else None
            self.car_laps.setdefault(i, []).append(CarLap(
                lap=num - 1,
                time_ms=int(lap["last_lap_time_in_ms"]) or None,
                position=int(lap["car_position"]),
                gap_ahead_ms=_ms(lap["delta_to_car_in_front_minutes_part"], lap["delta_to_car_in_front_ms_part"]),
                gap_leader_ms=_ms(lap["delta_to_race_leader_minutes_part"], lap["delta_to_race_leader_ms_part"]),
                pit_stops=int(lap["num_pit_stops"]),
                compound=compound,
                tyre_age=age,
                safety_car=self._lap_sc or self._sc_status in ("Full safety car", "Virtual safety car"),
            ))
            if i == player:
                self.player_laps.append(self._player_record(num - 1, lap, live))
                out.append(Trigger("lap_completed", packet.session_time, num - 1))

        me = laps[player]
        if int(me["pit_status"]) != 0:
            self._lap_pit = True
        if int(me["current_lap_invalid"]):
            self._lap_invalid = True
        stops = int(me["num_pit_stops"])
        if stops > self._pit_stops:
            out.append(Trigger("pitted", packet.session_time, int(me["current_lap_num"]), {"stops": stops}))
        self._pit_stops = stops
        pen, warn = int(me["penalties"]), int(me["total_warnings"])
        if pen > self._penalties or warn > self._warnings:
            out.append(Trigger("penalty", packet.session_time, int(me["current_lap_num"]),
                               {"penalties_s": pen, "warnings": warn}))
        self._penalties, self._warnings = pen, warn
        return out

    def _player_record(self, lap_num: int, lap, live: LiveSession) -> PlayerLap:
        status = live.last.get("car_status")
        damage = live.last.get("car_damage")
        session = live.last.get("session")
        st = status.body["car_status_data"][status.player_car_index] if status else None
        dm = damage.body["car_damage_data"][damage.player_car_index] if damage else None
        compound = c.VISUAL_COMPOUNDS.get(int(st["visual_tyre_compound"])) if st is not None else None
        record = PlayerLap(
            lap=lap_num,
            time_ms=int(lap["last_lap_time_in_ms"]) or None,
            position=int(lap["car_position"]),
            compound=compound,
            tyre_age=int(st["tyres_age_laps"]) if st is not None else None,
            wear=[round(float(w), 1) for w in dm["tyres_wear"]] if dm is not None else None,
            fuel_kg=round(float(st["fuel_in_tank"]), 2) if st is not None else None,
            fuel_margin_laps=round(float(st["fuel_remaining_laps"]), 2) if st is not None else None,
            ers_percent=round(100 * float(st["ers_store_energy"]) / c.ERS_MAX_ENERGY, 1) if st is not None else None,
            ers_deployed_mj=round(self._lap_ers_deployed / 1e6, 2),
            safety_car=self._lap_sc,
            pitted=self._lap_pit,
            invalid=self._lap_invalid,
            track_temp=int(session.body["track_temperature"]) if session else None,
            weather=c.WEATHER.get(int(session.body["weather"])) if session else None,
            surface_temp_avg=_average([sample[0] for sample in self._temp_samples]),
            inner_temp_avg=_average([sample[1] for sample in self._temp_samples]),
        )
        self._temp_samples = []
        self._lap_sc = self._sc_status in ("Full safety car", "Virtual safety car")
        self._lap_pit = self._lap_invalid = False
        self._lap_ers_deployed = 0.0
        return record


def pit_loss_samples(car_laps: dict[int, list[CarLap]]) -> list[float]:
    """Time lost by each green-flag pit stop, in seconds, from every car's laps.

    A stop costs time over its in-lap and out-lap; the loss is the sum of those
    two laps minus two of that car's normal laps. Stops near a safety car, or
    with a missing lap around them, are skipped.
    """
    samples = []
    for laps in car_laps.values():
        by_lap = {cl.lap: cl for cl in laps}
        normal = sorted(cl.time_ms for cl in laps if cl.time_ms and not cl.safety_car and cl.lap > 1)
        if len(normal) < 3:
            continue
        reference = normal[len(normal) // 2]
        for cl in laps:
            before = by_lap.get(cl.lap - 1)
            if before is None or cl.pit_stops <= before.pit_stops:
                continue
            # The stop is counted on this lap; it cost time on this lap and the
            # one before or after, whichever pair is slower.
            pairs = [(before, cl), (cl, by_lap.get(cl.lap + 1))]
            valid = [(a, b) for a, b in pairs if b is not None and b.lap == a.lap + 1
                     and a.time_ms and b.time_ms and not a.safety_car and not b.safety_car]
            if not valid:
                continue
            slowest = max(a.time_ms + b.time_ms for a, b in valid)
            loss = (slowest - 2 * reference) / 1000
            if 10 < loss < 45:  # outside this range it was not a normal stop
                samples.append(round(loss, 1))
    return samples


def _average(samples: list[list[int]]) -> list[float] | None:
    if not samples:
        return None
    return [round(sum(values) / len(values), 1) for values in zip(*samples)]


def _ms(minutes, ms) -> int:
    return int(minutes) * 60_000 + int(ms)
