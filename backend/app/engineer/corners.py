"""Corner-by-corner coaching: where the player loses time and why.

Real race engineers coach per corner and per phase ("losing two tenths on the
exit of Turn 6, rear wheelspin"), never with lap averages. This module finds the
corners of the track from the player's own speed trace, then measures every
corner on every lap: time through it, entry/minimum/exit speed, and how many
samples showed a front or rear lock-up, rear wheelspin, an oversteer slide,
understeer or a wheel off the track.

Corners are numbered in the order the car meets them from the line. The count
can differ from the circuit's official numbering (a fast kink that does not
slow the car is not a corner here), so the engineer says "la curva N" with the
sector, never an official name.

Everything is keyed on lap distance in 10 m bins, so a lossy link leaves gaps
rather than wrong numbers; a corner with too little data on a lap is skipped.
"""

import math
from dataclasses import dataclass, field

import numpy as np

from app.telemetry import constants as c

BIN_M = 10.0
APEX_WINDOW_BINS = 15  # an apex is the slowest point within ±150 m
LOOKBACK_BINS = 40  # the braking zone starts at the fastest point in the 400 m before
MIN_SPEED_DROP_KMH = 25.0  # slowing down less than this is a kink, not a corner
MAP_MIN_COVERAGE = 0.7  # share of bins with data needed to map the corners
CORNER_MIN_SAMPLES = 3

# Thresholds measured on real races (Madrid, PC at 100%): wheel slip ratio p99 ~0.28
# on the rears, -1 when a wheel locks; rear slip angle p99 ~0.13 rad.
SPIN_RATIO = 0.2
LOCK_RATIO = -0.3
OVERSTEER_RAD = 0.12
UNDERSTEER_RAD = 0.14
MIN_SPEED_FOR_SLIP_KMH = 60
ISSUE_SAMPLES = 2  # samples in one pass to count it as a real lock-up / slide

# When to coach.
LOSS_CALL_S = 0.15  # lost this much against the best pass of the session...
LOSS_REPEAT_S = 0.10  # ...and at least this much on the lap before too
ISSUE_LAPS = 2  # an issue in the same corner on 2 of the last 3 laps
CALL_GAP_LAPS = 3  # do not coach the same corner again within this many laps


@dataclass
class Corner:
    number: int
    entry_m: float
    apex_m: float
    exit_m: float
    sector: int


@dataclass
class CornerPass:
    """One corner on one lap."""
    time_s: float | None = None
    entry_kmh: float | None = None
    min_kmh: float | None = None
    exit_kmh: float | None = None
    entry_time_s: float | None = None  # entry to apex
    exit_time_s: float | None = None  # apex to exit
    lock_front: int = 0
    lock_rear: int = 0
    spin_rear: int = 0
    oversteer: int = 0
    understeer: int = 0
    off_track: int = 0
    samples: int = 0

    def issues(self) -> list[str]:
        """Problems seen in this pass, the most frequent first."""
        counts = {
            "fuera_de_pista": self.off_track * ISSUE_SAMPLES,  # one sample off track already counts
            "bloqueo_delantero": self.lock_front,
            "bloqueo_trasero": self.lock_rear,
            "patinaje_traccion": self.spin_rear,
            "sobreviraje": self.oversteer,
            "subviraje": self.understeer,
        }
        return [k for k, n in sorted(counts.items(), key=lambda kv: -kv[1]) if n >= ISSUE_SAMPLES]


@dataclass
class _Bin:
    speed_min: float = math.inf
    samples: int = 0
    lock_front: int = 0
    lock_rear: int = 0
    spin_rear: int = 0
    oversteer: int = 0
    understeer: int = 0
    off_track: int = 0


@dataclass
class _Lap:
    number: int
    bins: dict[int, _Bin] = field(default_factory=dict)
    times: list[tuple[float, int]] = field(default_factory=list)  # (lap distance, lap time ms)
    clean: bool = True


ISSUE_TEXT = {
    "bloqueo_delantero": "bloquea adelante en la frenada",
    "bloqueo_trasero": "bloquea atrás en la frenada",
    "patinaje_traccion": "patina atrás en la salida",
    "sobreviraje": "se le va la cola",
    "subviraje": "el auto no gira (subviraje)",
    "fuera_de_pista": "se va de pista",
}


class CornerCoach:
    def __init__(self) -> None:
        self.track_length: float | None = None
        self.sector2_m: float | None = None
        self.sector3_m: float | None = None
        self.corners: list[Corner] = []
        self.passes: dict[int, dict[int, CornerPass]] = {}  # lap -> corner -> pass
        self.best: dict[int, CornerPass] = {}  # corner -> best clean pass of the session
        self._lap: _Lap | None = None
        self._last_lap_packet = None
        self._last_call_lap: dict[int, int] = {}

    # --- feeding ----------------------------------------------------------------

    def observe(self, packet, live) -> dict | None:
        """Feed a packet; at the end of a lap, return a coaching note worth a radio call, if any."""
        session = live.last.get("session")
        if session is not None and self.track_length is None and int(session.body["track_length"]) > 0:
            b = session.body
            self.track_length = float(b["track_length"])
            self.sector2_m, self.sector3_m = float(b["sector2_lap_distance_start"]), float(b["sector3_lap_distance_start"])
        if self.track_length is None:
            return None
        player = packet.player_car_index
        if packet.name == "lap_data":
            if player >= len(packet.body["lap_data"]):
                return None
            self._last_lap_packet = packet
            return self._on_lap_data(packet.body["lap_data"][player])
        if self._lap is None or self._last_lap_packet is None or player >= live.slots():
            return None
        distance = self._distance(packet, live)
        if distance is None:
            return None
        b = self._lap.bins.setdefault(int(distance // BIN_M), _Bin())
        if packet.name == "car_telemetry":
            t = packet.body["car_telemetry_data"][player]
            b.speed_min = min(b.speed_min, float(t["speed"]))
            b.samples += 1
            if any(c.SURFACE_TYPES.get(int(x)) in c.OFF_TRACK_SURFACES for x in t["surface_type"]):
                b.off_track += 1
        elif packet.name == "motion_ex":
            self._slip(b, packet.body, live, player)
        return None

    def _distance(self, packet, live) -> float | None:
        """The player's lap distance at this packet, moved on by speed for the time since LapData."""
        lap = self._last_lap_packet.body["lap_data"][packet.player_car_index]
        d = float(lap["lap_distance"])
        tel = live.last.get("car_telemetry")
        if tel is not None:
            speed = float(tel.body["car_telemetry_data"][packet.player_car_index]["speed"]) / 3.6
            dt = packet.session_time - self._last_lap_packet.session_time
            if 0 <= dt < 0.5:
                d += speed * dt
        return d if 0 <= d < self.track_length else None

    def _slip(self, b: _Bin, mx, live, player: int) -> None:
        tel = live.last.get("car_telemetry")
        if tel is None:
            return
        t = tel.body["car_telemetry_data"][player]
        if float(t["speed"]) < MIN_SPEED_FOR_SLIP_KMH:
            return
        ratio = [float(x) for x in mx["wheel_slip_ratio"]]  # RL, RR, FL, FR
        angle = [abs(float(x)) for x in mx["wheel_slip_angle"]]
        braking, throttle = float(t["brake"]) > 0.2, float(t["throttle"]) > 0.3
        if braking and min(ratio[2], ratio[3]) < LOCK_RATIO:
            b.lock_front += 1
        if braking and min(ratio[0], ratio[1]) < LOCK_RATIO:
            b.lock_rear += 1
        if throttle and max(ratio[0], ratio[1]) > SPIN_RATIO:
            b.spin_rear += 1
        rear, front = max(angle[0], angle[1]), max(angle[2], angle[3])
        if rear > OVERSTEER_RAD and rear > front:
            b.oversteer += 1
        elif front > UNDERSTEER_RAD and front > rear + 0.04 and abs(float(t["steer"])) > 0.2:
            b.understeer += 1

    def _on_lap_data(self, lap) -> dict | None:
        number = int(lap["current_lap_num"])
        note = None
        if self._lap is None or number != self._lap.number:
            if self._lap is not None and number == self._lap.number + 1:
                note = self._finish(self._lap, int(lap["last_lap_time_in_ms"]))
            self._lap = _Lap(number)
        if int(lap["pit_status"]) != 0 or bool(lap["current_lap_invalid"]):
            self._lap.clean = False
        d, t = float(lap["lap_distance"]), int(lap["current_lap_time_in_ms"])
        if 0 <= d <= self.track_length and (not self._lap.times or d > self._lap.times[-1][0]):
            self._lap.times.append((d, t))
        return note

    # --- end of lap ---------------------------------------------------------------

    def _finish(self, lap: _Lap, lap_ms: int) -> dict | None:
        if lap_ms > 0 and self.track_length:
            lap.times.append((self.track_length, lap_ms))
        if not self.corners:
            self.corners = self._map(lap)
            if not self.corners:
                return None
        passes = {k.number: p for k in self.corners if (p := self._measure(lap, k)) is not None}
        self.passes[lap.number] = passes
        note = self._coach(lap.number)
        if lap.clean and lap.number > 1:
            for n, p in passes.items():
                if p.time_s is not None and (n not in self.best or p.time_s < self.best[n].time_s):
                    self.best[n] = p
        return note

    def _speeds(self, lap: _Lap) -> np.ndarray:
        n = int(math.ceil(self.track_length / BIN_M))
        v = np.full(n, np.nan)
        for i, b in lap.bins.items():
            if 0 <= i < n and b.samples:
                v[i] = b.speed_min
        return v

    def _map(self, lap: _Lap) -> list[Corner]:
        """Find the corners in a lap's speed trace; empty if the lap has too little data."""
        v = self._speeds(lap)
        if np.isfinite(v).mean() < MAP_MIN_COVERAGE:
            return []
        idx = np.arange(len(v))
        ok = np.isfinite(v)
        v = np.interp(idx, idx[ok], v[ok])  # bridge short gaps
        v = np.convolve(v, np.ones(3) / 3, mode="same")
        corners: list[Corner] = []
        for i in range(len(v)):
            lo, hi = max(0, i - APEX_WINDOW_BINS), min(len(v), i + APEX_WINDOW_BINS + 1)
            if v[i] > v[lo:hi].min() or (corners and i - corners[-1].apex_m / BIN_M < APEX_WINDOW_BINS):
                continue
            back = v[max(0, i - LOOKBACK_BINS):i + 1]
            if back.max() - v[i] < MIN_SPEED_DROP_KMH:
                continue
            entry = max(0, i - LOOKBACK_BINS) + int(np.argmax(back))
            if corners:  # a corner starts where the previous one ends, never inside it
                entry = max(entry, int(corners[-1].exit_m // BIN_M))
            target = v[i] + 0.75 * (v[entry] - v[i])
            exit_ = next((j for j in range(i + 1, min(len(v), i + 31)) if v[j] >= target), min(len(v) - 1, i + 30))
            apex_m = i * BIN_M
            sector = 1 if apex_m < self.sector2_m else 2 if apex_m < self.sector3_m else 3
            corners.append(Corner(len(corners) + 1, entry * BIN_M, apex_m, exit_ * BIN_M, sector))
        return corners

    def _time_at(self, lap: _Lap, d: float) -> float | None:
        ts = lap.times
        for (d0, t0), (d1, t1) in zip(ts, ts[1:]):
            if d0 <= d <= d1:
                if d1 - d0 > 120:  # too big a hole in the trace to interpolate
                    return None
                return (t0 + (t1 - t0) * (d - d0) / (d1 - d0)) / 1000 if d1 > d0 else t0 / 1000
        return None

    def _measure(self, lap: _Lap, k: Corner) -> CornerPass | None:
        p = CornerPass()
        speeds = []
        for i in range(int(k.entry_m // BIN_M), int(k.exit_m // BIN_M) + 1):
            b = lap.bins.get(i)
            if b is None or not b.samples:
                continue
            speeds.append((i, b.speed_min))
            p.samples += b.samples
            p.lock_front += b.lock_front
            p.lock_rear += b.lock_rear
            p.spin_rear += b.spin_rear
            p.oversteer += b.oversteer
            p.understeer += b.understeer
            p.off_track += b.off_track
        if p.samples < CORNER_MIN_SAMPLES or not speeds:
            return None
        p.entry_kmh = speeds[0][1]
        p.min_kmh = min(s for _, s in speeds)
        p.exit_kmh = speeds[-1][1]
        t_in, t_apex, t_out = (self._time_at(lap, d) for d in (k.entry_m, k.apex_m, k.exit_m))
        if None not in (t_in, t_apex, t_out):
            p.entry_time_s, p.exit_time_s, p.time_s = t_apex - t_in, t_out - t_apex, t_out - t_in
        return p

    # --- coaching -------------------------------------------------------------------

    def loss(self, lap: int, n: int) -> float | None:
        p, best = self.passes.get(lap, {}).get(n), self.best.get(n)
        if p is None or best is None or p.time_s is None or best.time_s is None:
            return None
        return p.time_s - best.time_s

    def _coach(self, lap: int) -> dict | None:
        candidates = []
        for k in self.corners:
            if lap - self._last_call_lap.get(k.number, -99) < CALL_GAP_LAPS:
                continue
            note = self._note(lap, k)
            if note:
                candidates.append(note)
        if not candidates:
            return None
        best = max(candidates, key=lambda n: (n["perdida_s"] or 0) + 0.1 * len(n["problemas"]))
        self._last_call_lap[best["curva"]] = lap
        return best

    def _note(self, lap: int, k: Corner) -> dict | None:
        p = self.passes.get(lap, {}).get(k.number)
        if p is None:
            return None
        loss, before = self.loss(lap, k.number), self.loss(lap - 1, k.number)
        recent = [self.passes.get(n, {}).get(k.number) for n in (lap - 2, lap - 1, lap)]
        repeated = [i for i in ISSUE_TEXT if sum(1 for r in recent if r and i in r.issues()) >= ISSUE_LAPS]
        losing = loss is not None and loss >= LOSS_CALL_S and before is not None and before >= LOSS_REPEAT_S
        if not losing and not repeated:
            return None
        return {**self.describe(lap, k), "problemas_repetidos": repeated}

    def describe(self, lap: int, k: Corner) -> dict:
        """What the data says about one corner on one lap, against the best pass of the session."""
        p, best = self.passes.get(lap, {}).get(k.number), self.best.get(k.number)
        loss = self.loss(lap, k.number)
        phase = None
        if loss is not None and loss > 0 and best and p and None not in (p.entry_time_s, best.entry_time_s,
                                                                         p.exit_time_s, best.exit_time_s):
            entry_loss, exit_loss = p.entry_time_s - best.entry_time_s, p.exit_time_s - best.exit_time_s
            phase = "frenada y entrada" if entry_loss >= exit_loss else "salida"
        r = lambda v: None if v is None else round(v)  # noqa: E731
        return {
            "curva": k.number,
            "sector": k.sector,
            "apex_m": round(k.apex_m),
            "perdida_s": None if loss is None else round(loss, 2),
            "donde_pierde": phase,
            "velocidad_kmh": {"entrada": r(p.entry_kmh if p else None), "minima": r(p.min_kmh if p else None),
                              "salida": r(p.exit_kmh if p else None)},
            "velocidad_mejor_paso_kmh": {"entrada": r(best.entry_kmh), "minima": r(best.min_kmh),
                                         "salida": r(best.exit_kmh)} if best else None,
            "problemas": p.issues() if p else [],
        }

    def summary(self, last_laps: int = 3) -> dict | None:
        """For the engineer's facts: the corners costing the most over the last laps, and recurring issues."""
        if not self.corners or not self.passes:
            return None
        laps = sorted(self.passes)[-last_laps:]
        rows = []
        for k in self.corners:
            losses = [x for lp in laps if (x := self.loss(lp, k.number)) is not None]
            issues: dict[str, int] = {}
            for lp in laps:
                p = self.passes[lp].get(k.number)
                for i in (p.issues() if p else []):
                    issues[i] = issues.get(i, 0) + 1
            if losses or issues:
                rows.append({**self.describe(laps[-1], k), "perdida_media_s": round(sum(losses) / len(losses), 2)
                             if losses else None, "problemas_en_vueltas": issues})
        rows.sort(key=lambda r: -(r["perdida_media_s"] or 0))
        return {
            "curvas_detectadas": len(self.corners),
            "peores": rows[:4],
            "nota": "Curvas numeradas por la app en orden desde la largada (puede no coincidir con la numeración "
                    "oficial): decí 'la curva N' y el sector. Pérdida contra su mejor paso por esa curva en la sesión.",
        }
