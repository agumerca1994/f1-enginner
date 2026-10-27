"""Lap-by-lap memory of a session, and the moments the engineer should speak.

The live state only keeps the latest packet of each kind; the engineer needs
history: every car's lap times and gaps, and for the player also tyres, fuel,
ERS and damage at the end of each lap. On a lossy link a lap can be missed;
records then simply have gaps, and the analysis works with what exists.
"""

from dataclasses import dataclass, field

from app.engineer.corners import CornerCoach
from app.live.state import LiveSession
from app.telemetry import constants as c
from app.telemetry import registry
from app.telemetry.registry import Packet

# How much a part's damage must grow, in points, to call the engineer.
DAMAGE_STEP = 15
# Tyre blister levels (percent) worth a radio call, each once per tyre set.
BLISTER_LEVELS = (15, 30, 50)
# 2026 overtake mode: worth a call when the gap ahead (or behind) is at most this.
OVERTAKE_GAP_MS = 1500
# Players often undo a crash with a flashback a few seconds later: damage is
# reported only if no flashback follows within this many seconds.
DAMAGE_CONFIRM_S = 8.0
RAIN_ALERT_PERCENT = 40
# A sector is worth a radio call only on a personal best or a loss of at least this.
SECTOR_LOSS_MS = 300


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
    sectors_ms: list[int | None] | None = None  # [S1, S2, S3] of this lap
    off_track_pct: float | None = None  # share of the lap with a wheel off the track
    peak_lat_g: float | None = None  # peak cornering / braking load this lap
    peak_brake_g: float | None = None
    peak_slip_ratio: float | None = None  # traction/lockup indicator from motion_ex
    peak_front_slip: float | None = None  # front slip angle peak (understeer when high)
    peak_rear_slip: float | None = None   # rear slip angle peak (oversteer when high)
    overtake_pct: float | None = None  # 2026: share of the lap with the overtake mode on
    ers_harvested_mj: float | None = None  # energy recovered this lap (MGU-K + MGU-H)


@dataclass
class Trigger:
    kind: str  # session_start, lap_completed, safety_car, rain_forecast, damage, penalty, pitted, session_end
    session_time: float
    lap: int | None
    detail: dict = field(default_factory=dict)


WHEEL_ES = ("trasera izquierda", "trasera derecha", "delantera izquierda", "delantera derecha")
# Issues that wear each axle: rears from traction and slides, fronts from lock-ups and understeer.
AXLE_ISSUES = {
    "rear": ("patinaje_traccion", "sobreviraje", "bloqueo_trasero"),
    "front": ("bloqueo_delantero", "subviraje"),
}
OVERUSE_RATIO = 1.35  # one tyre wearing this much faster than the median of the others...
OVERUSE_MIN_PCT_LAP = 0.4  # ...and at least this fast, in % per lap
OVERUSE_LAPS = 4  # measured over the last laps of the stint
OVERUSE_CALL_GAP = 5


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
        self._offtrack_samples = 0  # telemetry samples with a wheel off track this lap
        self._track_samples = 0
        self._fia_flag: str | None = None
        self._peak_lat_g = 0.0  # peak cornering and braking load this lap
        self._peak_brake_g = 0.0
        self._peak_slip_ratio = 0.0  # from motion_ex: traction/lockup and slide indicators
        self._peak_front_slip = 0.0
        self._peak_rear_slip = 0.0
        self._lap_ers_harvested = 0.0
        # 2026 regulations: overtake-mode use this lap and what was already called out.
        self._aero_samples = 0
        self._overtake_samples = 0
        self._overtake_available = False
        self._overtake_called_lap: int | None = None
        self._rival_overtake_called_lap: int | None = None
        self._blister_level = 0  # highest BLISTER_LEVELS index already called on this tyre set
        # Sector tracking for the player.
        self._sector = 0
        self._cur_s1: int | None = None  # this lap's S1/S2 as they are crossed
        self._cur_s2: int | None = None
        self.best_sectors: dict[int, int] = {}  # best S1/S2/S3 of the session, ms
        self.last_lap_sectors: list[int | None] | None = None  # [S1, S2, S3] of the last completed lap
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
        self.corners = CornerCoach()
        self._overuse_called: dict[int, int] = {}

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
            self._lap_ers_harvested = max(
                self._lap_ers_harvested,
                float(st["ers_harvested_this_lap_mguk"]) + float(st["ers_harvested_this_lap_mguh"]))
            flag = c.FIA_FLAGS.get(int(st["vehicle_fia_flags"]))
            if flag == "blue" and self._fia_flag != "blue":
                new.append(Trigger("blue_flag", t, self._player_lap(live)))
            self._fia_flag = flag
        elif packet.name == "tyre_sets":
            if int(packet.body["car_idx"]) == packet.player_car_index:
                self.tyre_sets = packet.body
        elif packet.name == "car_telemetry":
            tel = packet.body["car_telemetry_data"][packet.player_car_index]
            self._temp_samples.append(([int(x) for x in tel["tyres_surface_temperature"]],
                                       [int(x) for x in tel["tyres_inner_temperature"]]))
            self._track_samples += 1
            if any(c.SURFACE_TYPES.get(int(x)) in c.OFF_TRACK_SURFACES for x in tel["surface_type"]):
                self._offtrack_samples += 1
        elif packet.name == "motion":
            m = packet.body["car_motion_data"][packet.player_car_index]
            self._peak_lat_g = max(self._peak_lat_g, abs(float(m["g_force_lateral"])))
            lon = float(m["g_force_longitudinal"])
            if lon < 0:  # negative is deceleration: the braking load
                self._peak_brake_g = max(self._peak_brake_g, -lon)
        elif packet.name == "motion_ex":
            mx = packet.body
            self._peak_slip_ratio = max(self._peak_slip_ratio, max(abs(float(x)) for x in mx["wheel_slip_ratio"]))
            sa = [abs(float(x)) for x in mx["wheel_slip_angle"]]  # order RL, RR, FL, FR
            self._peak_front_slip = max(self._peak_front_slip, sa[2], sa[3])
            self._peak_rear_slip = max(self._peak_rear_slip, sa[0], sa[1])
        elif packet.name == "car_damage":
            new += self._damage_changes(packet, live)
            new += self._blister_changes(packet, live)
        elif packet.name == "car_telemetry_2":
            new += self._overtake_changes(packet, live)
        elif packet.name == "lap_data":
            new += self._lap_changes(packet, live)
        note = self.corners.observe(packet, live)
        if note:
            new.append(Trigger("corner_coaching", t, self._player_lap(live), note))
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

    def _blister_changes(self, packet: Packet, live: LiveSession) -> list[Trigger]:
        """Blisters (2025 format onwards): one call per level crossed on the current tyre set."""
        d = packet.body["car_damage_data"][packet.player_car_index]
        if "tyre_blisters" not in d.dtype.names:
            return []
        worst = max(int(b) for b in d["tyre_blisters"])
        if worst < BLISTER_LEVELS[0]:
            self._blister_level = 0  # a fresh set
            return []
        level = sum(1 for lv in BLISTER_LEVELS if worst >= lv)
        if level <= self._blister_level:
            return []
        self._blister_level = level
        wheel = c.WHEEL_NAMES_ES[[int(b) for b in d["tyre_blisters"]].index(worst)]
        return [Trigger("blisters", packet.session_time, self._player_lap(live), {"rueda": wheel, "pct": worst})]

    def _overtake_changes(self, packet: Packet, live: LiveSession) -> list[Trigger]:
        """2026 overtake mode: track its use, and call it out once per lap when it is
        available for the player close behind someone, or a rival close behind turns it on."""
        me_idx = packet.player_car_index
        cars = packet.body["car_telemetry_2_data"]
        me = cars[me_idx]
        self._aero_samples += 1
        self._overtake_samples += int(me["overtake_active"])
        out: list[Trigger] = []
        laps = live.last.get("lap_data")
        session = live.last.get("session")
        race = session is not None and c.SESSION_TYPES.get(int(session.body["session_type"]), "").startswith("Race")
        if laps is None or not race:
            self._overtake_available = bool(me["overtake_available"])
            return out
        lap_data = laps.body["lap_data"]
        my_lap = lap_data[me_idx]
        lap_num = int(my_lap["current_lap_num"])
        available = bool(me["overtake_available"])
        gap_ahead = _ms(my_lap["delta_to_car_in_front_minutes_part"], my_lap["delta_to_car_in_front_ms_part"])
        if (available and not self._overtake_available and not int(me["overtake_active"])
                and 0 < gap_ahead <= OVERTAKE_GAP_MS and self._overtake_called_lap != lap_num):
            self._overtake_called_lap = lap_num
            out.append(Trigger("overtake_available", packet.session_time, lap_num, {"gap_s": round(gap_ahead / 1000, 1)}))
        self._overtake_available = available

        behind = next((i for i in live.active_cars()
                       if int(lap_data[i]["car_position"]) == int(my_lap["car_position"]) + 1), None)
        if behind is not None and self._rival_overtake_called_lap != lap_num and int(cars[behind]["overtake_active"]):
            gap_behind = _ms(lap_data[behind]["delta_to_car_in_front_minutes_part"],
                             lap_data[behind]["delta_to_car_in_front_ms_part"])
            if 0 < gap_behind <= OVERTAKE_GAP_MS:
                self._rival_overtake_called_lap = lap_num
                participants = live.last.get("participants")
                name = participants.body["participants"][behind]["name"].decode("utf-8", "replace") if participants else None
                out.append(Trigger("rival_overtake", packet.session_time, lap_num,
                                   {"piloto": name or "el de atrás", "gap_s": round(gap_behind / 1000, 1)}))
        return out

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
                sectors = self._finalize_sectors(int(lap["last_lap_time_in_ms"]) or None)
                self.player_laps.append(self._player_record(num - 1, lap, live, sectors))
                out.append(Trigger("lap_completed", packet.session_time, num - 1))
                out += self._tyre_overuse(packet.session_time, num - 1)

        me = laps[player]
        out += self._player_sector_triggers(me, packet.session_time, live)
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

    def _player_sector_triggers(self, me, t: float, live: LiveSession) -> list[Trigger]:
        """Capture S1/S2 as the player crosses them, and flag a notable sector."""
        cur = int(me["sector"])  # 0, 1 or 2
        invalid = bool(me["current_lap_invalid"])
        s1 = _ms(me["sector1_time_minutes_part"], me["sector1_time_ms_part"]) or None
        s2 = _ms(me["sector2_time_minutes_part"], me["sector2_time_ms_part"]) or None
        out = []
        if cur >= 1 and self._cur_s1 is None and s1:
            self._cur_s1 = s1
            out += self._sector_note(1, s1, invalid, t, live)
        if cur >= 2 and self._cur_s2 is None and s2:
            self._cur_s2 = s2
            out += self._sector_note(2, s2, invalid, t, live)
        self._sector = cur
        return out

    def _sector_note(self, idx: int, val: int, invalid: bool, t: float, live: LiveSession) -> list[Trigger]:
        best = self.best_sectors.get(idx)
        if invalid:
            return []  # an invalid sector is not a fair comparison
        is_pb = best is None or val < best
        loss = val - best if best is not None else 0
        if not (is_pb or loss >= SECTOR_LOSS_MS):
            return []
        return [Trigger("sector_completed", t, self._player_lap(live), {
            "sector": idx, "tiempo_s": round(val / 1000, 3),
            "mejor_personal": is_pb, "delta_s": round(loss / 1000, 3),
        })]

    def _finalize_sectors(self, total_ms: int | None) -> list[int | None]:
        """At lap completion: S3 = total − S1 − S2, record the lap and update the bests."""
        s1, s2 = self._cur_s1, self._cur_s2
        s3 = total_ms - s1 - s2 if (total_ms and s1 and s2 and total_ms > s1 + s2) else None
        sectors = [s1, s2, s3]
        self.last_lap_sectors = sectors
        if not (self._lap_invalid or self._lap_sc or self._lap_pit):
            for i, val in zip((1, 2, 3), sectors):
                if val and (self.best_sectors.get(i) is None or val < self.best_sectors[i]):
                    self.best_sectors[i] = val
        self._cur_s1 = self._cur_s2 = None
        self._sector = 0
        return sectors

    def _tyre_overuse(self, t: float, lap: int) -> list[Trigger]:
        """One tyre wearing clearly faster than the rest over the last laps of this stint."""
        stint: list[PlayerLap] = []
        for pl in reversed(self.player_laps):
            if pl.wear is None:
                break
            stint.insert(0, pl)
            if pl.pitted or len(stint) == OVERUSE_LAPS:
                break
        if len(stint) < 3 or stint[-1].lap - stint[0].lap != len(stint) - 1:
            return []
        laps = len(stint) - 1
        rates = [(stint[-1].wear[w] - stint[0].wear[w]) / laps for w in range(4)]
        worst = max(range(4), key=lambda w: rates[w])
        others = sorted(r for w, r in enumerate(rates) if w != worst)[1]  # the median of the other three
        if rates[worst] < OVERUSE_MIN_PCT_LAP or rates[worst] < OVERUSE_RATIO * max(others, 0.05):
            return []
        if lap - self._overuse_called.get(worst, -99) < OVERUSE_CALL_GAP:
            return []
        self._overuse_called[worst] = lap
        axle = "rear" if worst < 2 else "front"
        summary = self.corners.summary() or {}
        culprits = [
            {"curva": r["curva"], "sector": r["sector"],
             "problemas": [i for i in r["problemas_en_vueltas"] if i in AXLE_ISSUES[axle]]}
            for r in summary.get("peores", []) if any(i in AXLE_ISSUES[axle] for i in r["problemas_en_vueltas"])
        ][:2]
        return [Trigger("tyre_overuse", t, lap, {
            "rueda": WHEEL_ES[worst],
            "pct_por_vuelta": round(rates[worst], 2),
            "resto_pct_por_vuelta": round(others, 2),
            "desgaste_pct": round(stint[-1].wear[worst], 1),
            "curvas": culprits,
        })]

    def _player_record(self, lap_num: int, lap, live: LiveSession, sectors: list[int | None] | None = None) -> PlayerLap:
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
            sectors_ms=sectors,
            off_track_pct=round(100 * self._offtrack_samples / self._track_samples, 1) if self._track_samples else None,
            peak_lat_g=round(self._peak_lat_g, 2) or None,
            peak_brake_g=round(self._peak_brake_g, 2) or None,
            peak_slip_ratio=round(self._peak_slip_ratio, 3) or None,
            peak_front_slip=round(self._peak_front_slip, 3) or None,
            peak_rear_slip=round(self._peak_rear_slip, 3) or None,
            overtake_pct=round(100 * self._overtake_samples / self._aero_samples, 1) if self._aero_samples else None,
            ers_harvested_mj=round(self._lap_ers_harvested / 1e6, 2) if st is not None else None,
        )
        self._temp_samples = []
        self._offtrack_samples = self._track_samples = 0
        self._peak_lat_g = self._peak_brake_g = 0.0
        self._peak_slip_ratio = self._peak_front_slip = self._peak_rear_slip = 0.0
        self._lap_sc = self._sc_status in ("Full safety car", "Virtual safety car")
        self._lap_pit = self._lap_invalid = False
        self._lap_ers_deployed = self._lap_ers_harvested = 0.0
        self._aero_samples = self._overtake_samples = 0
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
