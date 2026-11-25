"""Telemetry traces by lap distance: speed, throttle, brake and gear, lap by lap.

The BOX tab draws them as the classic speed/throttle trace, one lap over another,
and the corner comparison says where one lap gains on the other and why
(brakes later, carries more speed, gets on the throttle earlier).

Every car is traced, since CarTelemetry and LapData carry all of them: the player
keeps every lap, the others only their best valid lap, to compare against the
fastest car of the session. Samples go into 5 m bins of lap distance, so a lossy
link leaves empty bins (None), never invented values. Time at distance comes
from LapData's exact distance and lap time, so deltas do not suffer the binning.
The state is a matrix per channel (car slot x bin) fed with numpy, because a
full session is hundreds of thousands of packets for 22 or 24 cars.
"""

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from app.live.laps import pit_mask

from app.engineer.setup_sheet import setup_values

BIN_M = 5.0
FLASHBACK_M = 50.0  # the car moving back this much within a lap is a flashback
MAX_EXTRAPOLATE_S = 0.5  # a telemetry sample is placed by speed from the last LapData up to this
MIN_COVERAGE_REFERENCE = 0.5  # another car's lap needs this share of bins to be kept as a reference
MAX_TIME_GAP_M = 120.0  # time at distance is not interpolated across bigger holes
ACTIVE = 2  # LapData result_status: active
BRAKE_ON = 0.1
THROTTLE_FULL = 0.9


@dataclass
class LapTrace:
    car: int
    lap: int
    time_ms: int | None
    valid: bool
    pitted: bool  # a pit lap: a stop in the box, or (outside races) the pit lane in the second half
    speed: np.ndarray  # km/h per bin, NaN where no sample arrived
    throttle: np.ndarray  # 0..1
    brake: np.ndarray  # 0..1
    gear: np.ndarray
    times: np.ndarray  # (n, 2): exact lap distance m, lap time ms, increasing
    setup: dict[str, Any] | None = None
    # Any time in the pit lane, even the exit at the start of a flying lap: only for telling runs apart.
    pit_lane: bool = False

    @property
    def coverage(self) -> float:
        return float(np.isfinite(self.speed).mean()) if len(self.speed) else 0.0

    def time_at(self, d: float) -> float | None:
        """Lap time in seconds when the car went through d metres, or None across a hole in the data."""
        ts = self.times
        if len(ts) < 2 or not ts[0, 0] <= d <= ts[-1, 0]:
            return None
        i = int(np.searchsorted(ts[:, 0], d))
        if i == 0:
            return float(ts[0, 1]) / 1000
        (d0, t0), (d1, t1) = ts[i - 1], ts[i]
        if d1 - d0 > MAX_TIME_GAP_M:
            return None
        return float(t0 + (t1 - t0) * (d - d0) / (d1 - d0)) / 1000 if d1 > d0 else float(t0) / 1000


@dataclass
class _Rows:
    """One channel matrix per measure, (slots, bins), for the lap each car is on."""
    n: int
    bins: int
    sums: dict[str, np.ndarray] = field(default_factory=dict)
    counts: np.ndarray | None = None
    # Exact (distance, time) samples from LapData, per car.
    times: list[list[tuple[float, int]]] = field(default_factory=list)

    def __post_init__(self) -> None:
        for k in ("speed", "throttle", "brake", "gear"):
            self.sums[k] = np.zeros((self.n, self.bins), np.float32)
        self.counts = np.zeros((self.n, self.bins), np.uint16)
        self.times = [[] for _ in range(self.n)]

    def clear(self, car: int, from_bin: int = 0) -> None:
        for m in self.sums.values():
            m[car, from_bin:] = 0
        self.counts[car, from_bin:] = 0

    def take(self, car: int) -> dict[str, np.ndarray]:
        c = self.counts[car].astype(np.float32)
        with np.errstate(invalid="ignore", divide="ignore"):
            out = {k: np.where(c > 0, m[car] / c, np.nan).astype(np.float32) for k, m in self.sums.items()}
        return out


class TraceCollector:
    """Fed with every packet of one session; keeps the traces of finished laps."""

    def __init__(self) -> None:
        self.track_length: float | None = None
        self.player: int | None = None
        self.player_laps: dict[int, LapTrace] = {}
        self.best: dict[int, LapTrace] = {}  # car -> its best valid lap (the player's too)
        self.names: dict[int, tuple[str | None, str | None]] = {}  # car -> (driver, team)
        self._rows: _Rows | None = None
        self._lap = self._dist = self._time_at = None  # per car: lap number, distance, session time
        self._invalid = self._pitted = self._pit_lane = None
        self._race = False
        self._setup: dict[str, Any] | None = None

    # --- feeding ----------------------------------------------------------------

    def observe(self, packet, live) -> None:
        if self.track_length is None:
            session = live.last.get("session")
            if session is None or int(session.body["track_length"]) <= 0:
                return
            self.track_length = float(session.body["track_length"])
        self.player = packet.player_car_index
        session = live.last.get("session")
        if session is not None:
            self._race = int(session.body["session_type"]) in (15, 16, 17)
        if packet.name == "lap_data":
            self._on_lap_data(packet)
        elif packet.name == "car_telemetry" and self._rows is not None:
            self._on_telemetry(packet)
        elif packet.name == "car_setups":
            values = setup_values(packet)
            if values is not None:
                self._setup = values
        elif packet.name == "participants":
            self._on_participants(packet)

    def _start(self, n: int) -> None:
        self._rows = _Rows(n, int(math.ceil(self.track_length / BIN_M)))
        self._lap = np.zeros(n, np.int32)
        self._dist = np.full(n, np.nan)
        self._time_at = np.full(n, np.nan)
        self._invalid = np.zeros(n, bool)
        self._pitted = np.zeros(n, bool)
        self._pit_lane = np.zeros(n, bool)

    def _on_lap_data(self, packet) -> None:
        laps = packet.body["lap_data"]
        n = len(laps)
        if self._rows is None or self._rows.n != n:
            self._start(n)
        rows = self._rows
        lap = laps["current_lap_num"].astype(np.int32)
        dist = laps["lap_distance"].astype(np.float64)
        ms = laps["current_lap_time_in_ms"].astype(np.int64)
        active = laps["result_status"] == ACTIVE

        for car in np.flatnonzero(active & (lap != self._lap)):
            car = int(car)
            if self._lap[car] and lap[car] == self._lap[car] + 1:
                self._finish(car, int(laps["last_lap_time_in_ms"][car]))
            rows.clear(car)
            rows.times[car] = []
            self._invalid[car] = self._pitted[car] = self._pit_lane[car] = False
            self._lap[car] = lap[car]

        back = active & np.isfinite(self._dist) & (dist < self._dist - FLASHBACK_M) & (lap == self._lap)
        for car in np.flatnonzero(back):  # a flashback: keep what is still behind the car
            car = int(car)
            rows.clear(car, max(0, int(dist[car] // BIN_M) + 1))
            rows.times[car] = [pt for pt in rows.times[car] if pt[0] <= dist[car]]

        self._invalid |= active & (laps["current_lap_invalid"] != 0)
        # Same rule as the radio and live timing (app.live.laps.pit_sample): in practice and qualifying
        # many pit exits sit after the line, so leaving the pits does not make a flying lap a pit lap.
        status = laps["pit_status"]
        self._pit_lane |= active & (status != 0)
        self._pitted |= active & pit_mask(status, dist, self.track_length, self._race)
        self._dist = np.where(active, dist, np.nan)
        self._time_at[:] = packet.session_time
        for car in np.flatnonzero(active & (dist >= 0) & (dist <= self.track_length)):
            car = int(car)
            ts = rows.times[car]
            d, t = float(dist[car]), int(ms[car])
            if not ts or (d > ts[-1][0] and t >= ts[-1][1]):
                ts.append((d, t))

    def _on_telemetry(self, packet) -> None:
        tel = packet.body["car_telemetry_data"]
        rows = self._rows
        if len(tel) != rows.n:
            return
        dt = packet.session_time - self._time_at
        speed = tel["speed"].astype(np.float64)
        # Place each sample where the car is now: the last LapData distance moved on by speed.
        d = self._dist + speed / 3.6 * np.where((dt >= 0) & (dt < MAX_EXTRAPOLATE_S), dt, 0)
        ok = np.isfinite(d) & (np.abs(dt) < MAX_EXTRAPOLATE_S) & (d >= 0) & (d < self.track_length)
        if not ok.any():
            return
        cars = np.flatnonzero(ok)
        bins = (d[cars] // BIN_M).astype(np.int64)
        rows.sums["speed"][cars, bins] += speed[cars]
        rows.sums["throttle"][cars, bins] += tel["throttle"][cars]
        rows.sums["brake"][cars, bins] += tel["brake"][cars]
        rows.sums["gear"][cars, bins] += tel["gear"][cars]
        rows.counts[cars, bins] += 1

    def _on_participants(self, packet) -> None:
        from app.telemetry import constants as c
        for i, pp in enumerate(packet.body["participants"]):
            name = pp["name"].decode("utf-8", "replace") or None
            self.names[i] = (name, c.TEAMS.get(int(pp["team_id"])))

    def _finish(self, car: int, lap_ms: int) -> None:
        rows = self._rows
        ts = list(rows.times[car])
        if lap_ms > 0:
            if ts and ts[0][0] <= 200:
                ts.insert(0, (0.0, 0))
            if not ts or ts[-1][1] <= lap_ms:
                ts.append((self.track_length, lap_ms))
        channels = rows.take(car)
        trace = LapTrace(
            car=car, lap=int(self._lap[car]), time_ms=lap_ms or None,
            valid=not self._invalid[car], pitted=bool(self._pitted[car]), pit_lane=bool(self._pit_lane[car]),
            times=np.array(ts, np.float64).reshape(-1, 2), **channels,
        )
        if car == self.player:
            trace.setup = self._setup
            self.player_laps[trace.lap] = trace
        clean = trace.valid and not trace.pitted and trace.time_ms
        if clean and trace.coverage >= (0 if car == self.player else MIN_COVERAGE_REFERENCE):
            best = self.best.get(car)
            if best is None or trace.time_ms < best.time_ms:
                self.best[car] = trace

    # --- reading ------------------------------------------------------------------

    def current(self, car: int | None = None) -> LapTrace | None:
        """The lap a car is on right now, as far as it has been driven (the player's by default)."""
        car = self.player if car is None else car
        rows = self._rows
        if rows is None or car is None or car >= rows.n or not self._lap[car]:
            return None
        ts = list(rows.times[car])
        if ts and ts[0][0] <= 200:
            ts.insert(0, (0.0, 0))
        return LapTrace(
            car=car, lap=int(self._lap[car]), time_ms=None, valid=not self._invalid[car], pitted=bool(self._pitted[car]),
            times=np.array(ts, np.float64).reshape(-1, 2), **rows.take(car),
        )

    def trace(self, car: int, lap: int) -> LapTrace | None:
        if car == self.player:
            return self.player_laps.get(lap)
        best = self.best.get(car)
        return best if best is not None and best.lap == lap else None

    def references(self, limit: int = 10) -> list[LapTrace]:
        """Other cars' best laps, fastest first."""
        others = [t for car, t in self.best.items() if car != self.player]
        return sorted(others, key=lambda t: t.time_ms)[:limit]


# --- output -----------------------------------------------------------------------


def trace_json(t: LapTrace) -> dict[str, Any]:
    """Arrays per bin for the chart; None where no sample arrived."""
    def arr(a: np.ndarray, scale: float = 1, digits: int = 0) -> list:
        return [None if not np.isfinite(v) else round(float(v) * scale, digits) if digits else round(float(v) * scale)
                for v in a]
    return {
        "car": t.car, "lap": t.lap, "time_s": t.time_ms / 1000 if t.time_ms else None,
        "valid": t.valid, "pitted": t.pitted, "coverage": round(t.coverage, 3),
        "bin_m": BIN_M,
        "speed": arr(t.speed, digits=1),
        "throttle": arr(t.throttle, 100),
        "brake": arr(t.brake, 100),
        "gear": arr(t.gear),
        "times": [[round(float(d), 1), int(ms)] for d, ms in t.times],
    }


def _first(a: np.ndarray, lo_m: float, hi_m: float, pred) -> float | None:
    """Distance of the first bin in [lo, hi] whose value meets pred, among bins with data."""
    lo, hi = max(0, int(lo_m // BIN_M)), min(len(a), int(hi_m // BIN_M) + 1)
    for i in range(lo, hi):
        if np.isfinite(a[i]) and pred(a[i]):
            return i * BIN_M
    return None


def _seen(a: np.ndarray, lo_m: float, hi_m: float) -> np.ndarray:
    seg = a[max(0, int(lo_m // BIN_M)):int(hi_m // BIN_M) + 1]
    return seg[np.isfinite(seg)]


def corner_figures(t: LapTrace, k) -> dict[str, Any]:
    """Braking point, minimum speed, throttle back on and time through one corner."""
    # The braking zone can start before the corner's entry point (fastest point before the apex).
    brake_at = _first(t.brake, k.entry_m - 100, k.apex_m, lambda v: v >= BRAKE_ON)
    throttle_at = _first(t.throttle, k.apex_m, k.exit_m + 100, lambda v: v >= THROTTLE_FULL)
    mid = _seen(t.speed, k.entry_m, k.exit_m)
    t_in, t_out = t.time_at(k.entry_m), t.time_at(k.exit_m)
    r = lambda v: None if v is None else round(v)  # noqa: E731
    return {
        "frena_en_m": r(brake_at),
        "velocidad_minima_kmh": round(float(mid.min())) if len(mid) else None,
        "acelera_a_fondo_en_m": r(throttle_at),
        "tiempo_s": round(t_out - t_in, 3) if t_in is not None and t_out is not None else None,
        "muestras": int(len(mid)),
    }


def compare(a: LapTrace, b: LapTrace, corners: list) -> list[dict[str, Any]]:
    """Corner by corner, lap B against lap A: positive time = B slower there."""
    rows = []
    for k in corners:
        fa, fb = corner_figures(a, k), corner_figures(b, k)
        diff = lambda key: None if fa[key] is None or fb[key] is None else fb[key] - fa[key]  # noqa: E731
        dt = diff("tiempo_s")
        rows.append({
            "curva": k.number, "sector": k.sector,
            "entrada_m": round(k.entry_m), "apex_m": round(k.apex_m), "salida_m": round(k.exit_m),
            "a": fa, "b": fb,
            "diferencia_s": None if dt is None else round(dt, 3),
            # Positive = B brakes that many metres later (further down the road).
            "b_frena_mas_tarde_m": diff("frena_en_m"),
            "b_velocidad_minima_kmh": diff("velocidad_minima_kmh"),
            # Positive = B gets on the throttle later.
            "b_acelera_mas_tarde_m": diff("acelera_a_fondo_en_m"),
        })
    return rows
