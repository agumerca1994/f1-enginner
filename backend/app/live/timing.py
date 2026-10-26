"""Live timing derived from LapData: delta to the best lap, relatives and catch forecasts.

Everything is keyed on the game's own clock (`session_time` in the header) and on
lap distance, never on arrival times or packet counts, so a lossy link only makes
the traces sparser. Gaps in a trace are bridged by linear interpolation up to a
limit; past it the answer is None ("unknown"), never a made-up number.
"""

import bisect
import statistics
from collections import deque
from dataclasses import dataclass, field
from typing import Any

# A lap counts as a delta reference only if it was seen from start to finish:
# first and last samples close to the line, and no stretch without data longer than this.
MAX_TRACE_GAP_M = 300.0
LINE_MARGIN_M = 200.0
# Passages further apart than this (game seconds) are not interpolated.
MAX_PASSAGE_GAP_S = 3.0
PASSAGE_WINDOW_S = 600.0
FLASHBACK_M = 50.0  # the car moving back this much within a lap is a flashback
PACE_LAPS = 5  # pace = median of the clean laps among the last PACE_LAPS
PACE_MIN_LAPS = 3
STABLE_CLOSING_S = 0.1  # pace differences below this per lap read as "holding"


@dataclass
class _Lap:
    """A car's lap in progress: whether anything disqualifies it as representative."""
    number: int
    pitted: bool = False
    invalid: bool = False
    safety_car: bool = False


@dataclass
class _CarTiming:
    passages: deque = field(default_factory=deque)  # (total_distance_m, session_time)
    lap: _Lap | None = None
    clean_laps: deque = field(default_factory=lambda: deque(maxlen=PACE_LAPS))  # (lap number, ms)

    def passage_time(self, distance: float) -> float | None:
        """When the car went through this total distance, interpolated between samples."""
        p = self.passages
        if len(p) < 2 or not p[0][0] <= distance <= p[-1][0]:
            return None
        i = bisect.bisect_left(p, (distance, float("-inf")))
        if p[i][0] == distance:
            return p[i][1]
        (d0, t0), (d1, t1) = p[i - 1], p[i]
        if t1 - t0 > MAX_PASSAGE_GAP_S or d1 <= d0:
            return None
        return t0 + (t1 - t0) * (distance - d0) / (d1 - d0)

    def pace_ms(self, current_lap: int) -> float | None:
        recent = [ms for n, ms in self.clean_laps if current_lap - n <= PACE_LAPS]
        return statistics.median(recent) if len(recent) >= PACE_MIN_LAPS else None


class LapDelta:
    """The player's delta to their best complete clean lap, at the same point of the lap."""

    def __init__(self) -> None:
        self.reference: list[tuple[float, int]] = []  # (lap distance m, lap time ms)
        self.reference_lap: int | None = None
        self.best_ms: int | None = None
        self._current: list[tuple[float, int]] = []
        self._lap: _Lap | None = None

    def observe(self, lap, track_length: float, safety_car: bool) -> None:
        number = int(lap["current_lap_num"])
        distance, time_ms = float(lap["lap_distance"]), int(lap["current_lap_time_in_ms"])
        if self._lap is None or number != self._lap.number:
            if self._lap is not None and number == self._lap.number + 1:
                self._finish(int(lap["last_lap_time_in_ms"]), track_length)
            self._lap, self._current = _Lap(number), []
        self._lap.pitted |= int(lap["pit_status"]) != 0
        self._lap.invalid |= bool(lap["current_lap_invalid"])
        self._lap.safety_car |= safety_car
        if not 0 <= distance <= track_length:
            return  # behind the line before the start, or not on a lap yet
        if self._current and distance < self._current[-1][0] - FLASHBACK_M:
            # A flashback rewinds distance and lap time together: keep what is still behind the car.
            self._current = [pt for pt in self._current if pt[0] <= distance]
        if not self._current or (distance > self._current[-1][0] and time_ms >= self._current[-1][1]):
            self._current.append((distance, time_ms))

    def _finish(self, lap_ms: int, track_length: float) -> None:
        lap, trace = self._lap, self._current
        if lap.pitted or lap.invalid or lap.safety_car or lap_ms <= 0 or len(trace) < 10:
            return
        if self.best_ms is not None and lap_ms >= self.best_ms:
            return
        trace = [(0.0, 0), *trace] if trace[0][0] <= LINE_MARGIN_M else None
        if trace is None or trace[-1][0] < track_length - LINE_MARGIN_M or trace[-1][1] > lap_ms:
            return
        trace.append((track_length, lap_ms))
        if any(b[0] - a[0] > MAX_TRACE_GAP_M for a, b in zip(trace, trace[1:])):
            return
        self.reference, self.reference_lap, self.best_ms = trace, lap.number, lap_ms

    def delta_ms(self, lap) -> int | None:
        """Current lap time minus the reference's time at this distance; negative = faster."""
        ref = self.reference
        if not ref or self._lap is None or self._lap.pitted:
            return None
        distance, time_ms = float(lap["lap_distance"]), int(lap["current_lap_time_in_ms"])
        if not 0 < distance <= ref[-1][0] or time_ms <= 0:
            return None
        i = bisect.bisect_left(ref, (distance, -1))
        (d0, t0), (d1, t1) = ref[i - 1], ref[i]
        if d1 - d0 > MAX_TRACE_GAP_M or d1 <= d0:
            return None
        return round(time_ms - (t0 + (t1 - t0) * (distance - d0) / (d1 - d0)))


class LiveTiming:
    """Fed with every LapData packet; read by the snapshot."""

    def __init__(self) -> None:
        self.cars: dict[int, _CarTiming] = {}
        self.delta = LapDelta()
        self.session_time: float | None = None

    def observe(self, packet, player: int | None, track_length: float, safety_car: bool) -> None:
        t = float(packet.session_time)
        if self.session_time is not None and t < self.session_time:
            # A flashback or restart rewinds the clock: older passages no longer line up.
            for car in self.cars.values():
                car.passages.clear()
        self.session_time = t
        laps = packet.body["lap_data"]
        for i in range(len(laps)):
            lap = laps[i]
            if int(lap["result_status"]) < 2:
                continue
            car = self.cars.setdefault(i, _CarTiming())
            self._track_lap(car, lap, safety_car)
            total = float(lap["total_distance"])
            p = car.passages
            if int(lap["driver_status"]) == 0 or (p and total < p[-1][0]):
                p.clear()  # in the garage, or moved backwards: the trace restarts
            if not p or total > p[-1][0]:
                p.append((total, t))
            while p and t - p[0][1] > PASSAGE_WINDOW_S:
                p.popleft()
        if player is not None and 0 <= player < len(laps) and track_length > 0:
            self.delta.observe(laps[player], track_length, safety_car)

    @staticmethod
    def _track_lap(car: _CarTiming, lap, safety_car: bool) -> None:
        number = int(lap["current_lap_num"])
        if car.lap is not None and number == car.lap.number + 1:
            done, ms = car.lap, int(lap["last_lap_time_in_ms"])
            if ms > 0 and done.number > 1 and not (done.pitted or done.invalid or done.safety_car):
                car.clean_laps.append((done.number, ms))
        if car.lap is None or number != car.lap.number:
            car.lap = _Lap(number)
        car.lap.pitted |= int(lap["pit_status"]) != 0
        car.lap.invalid |= bool(lap["current_lap_invalid"])
        car.lap.safety_car |= safety_car

    # --- reading -----------------------------------------------------------------

    def relatives(self, laps, player: int, track_length: float, lap_ms: float | None,
                  race: bool, count: int = 3) -> dict[str, list[dict[str, Any]]]:
        """Nearest cars physically ahead and behind on track, lapped traffic included.

        The gap is the time since the car ahead went through the player's spot (or the
        player through the spot of the car behind). Without a usable trace it falls back
        to distance over the lap pace and is flagged as estimated.
        """
        me = laps[player]
        my_total, my_dist = float(me["total_distance"]), float(me["lap_distance"])
        mine = self.cars.get(player)
        rows: dict[str, list] = {"ahead": [], "behind": []}
        for i in range(len(laps)):
            lap = laps[i]
            if i == player or int(lap["result_status"]) != 2 or int(lap["driver_status"]) == 0:
                continue
            d = (float(lap["lap_distance"]) - my_dist) % track_length
            if d > track_length / 2:
                d -= track_length
            total = float(lap["total_distance"])
            gap = None
            if self.session_time is not None:
                car = self.cars.get(i)
                passed = (car.passage_time(total - d) if d > 0 and car else
                          mine.passage_time(my_total + d) if d < 0 and mine else None)
                gap = None if passed is None else self.session_time - passed
            estimated = gap is None
            if estimated and lap_ms:
                gap = abs(d) / track_length * lap_ms / 1000
            laps_apart = (total - my_total) / track_length
            rows["ahead" if d > 0 else "behind"].append({
                "index": i,
                "distance_m": round(abs(d)),
                "gap_s": None if gap is None else round(gap, 1),
                "estimated": estimated,
                # Blue: a lap or more behind the player; amber: a lap or more ahead.
                "relation": None if not race else "lapped" if laps_apart < -0.5 else "lapping" if laps_apart > 0.5 else None,
                "pit": int(lap["pit_status"]) != 0,
            })
        for side in rows.values():
            side.sort(key=lambda r: r["distance_m"])
            del side[count:]
        return rows

    def pace_s(self, idx: int, current_lap: int) -> float | None:
        car = self.cars.get(idx)
        ms = car.pace_ms(current_lap) if car else None
        return None if ms is None else round(ms / 1000, 3)


def forecast(gap_s: float | None, pursuer_pace_s: float | None, target_pace_s: float | None,
             laps_left: int | None) -> dict[str, Any]:
    """Whether the pursuer catches the target, from the gap and both clean-lap paces."""
    out: dict[str, Any] = {"state": "waiting", "closing_s_per_lap": None, "laps_to_catch": None}
    if gap_s is None or gap_s < 0 or not pursuer_pace_s or not target_pace_s:
        return out
    closing = target_pace_s - pursuer_pace_s
    out["closing_s_per_lap"] = round(closing, 2)
    if abs(closing) < STABLE_CLOSING_S:
        out["state"] = "stable"
    elif closing < 0:
        out["state"] = "opening"
    else:
        laps = gap_s / closing
        out["laps_to_catch"] = round(laps, 1)
        out["state"] = "after_finish" if laps_left is not None and laps > laps_left else "catching"
    return out
