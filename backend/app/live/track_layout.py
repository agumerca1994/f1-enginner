"""Builds a circuit outline from the telemetry itself.

The game sends every car's world position (Motion) and distance into the lap
(LapData). Binning positions by lap distance gives an ordered outline of the
track. Using all cars, not just the player, fills the outline within one lap
even on a lossy link where only a fifth of the packets arrive.

Positions and lap distances come from different packets, possibly from
different frames; each car's lap distance is moved forward by its speed times
the time between the two packets.
"""

import math

import numpy as np

BIN_M = 10.0
READY_COVERAGE = 0.95  # share of bins with data before the outline counts as complete
READY_MAX_GAP_BINS = 5  # and no stretch longer than this (50 m) without data
MAX_PAIR_GAP_S = 0.35  # ignore Motion/LapData pairs further apart than this
MIN_SAMPLES_PER_BIN = 1


class LayoutBuilder:
    def __init__(self, track_length_m: float):
        self.track_length = float(track_length_m)
        self.bins = max(1, int(math.ceil(self.track_length / BIN_M)))
        self._sum = np.zeros((self.bins, 2))
        self._count = np.zeros(self.bins, dtype=np.int64)
        self.added_since_save = 0

    def merge(self, sums: list[list[float]], counts: list[int]) -> None:
        """Add samples saved by earlier sessions (any player: the track is the same)."""
        if len(counts) != self.bins:
            return  # saved with another track length or bin size; start over
        self._sum += np.asarray(sums, dtype=float)
        self._count += np.asarray(counts, dtype=np.int64)

    def arrays(self) -> tuple[list[list[float]], list[int]]:
        return self._sum.round(1).tolist(), self._count.tolist()

    def add(self, lap_distance: float, x: float, z: float) -> None:
        if not (0 <= lap_distance < self.track_length) or not (math.isfinite(x) and math.isfinite(z)):
            return
        i = int(lap_distance / BIN_M) % self.bins
        self._sum[i] += (x, z)
        self._count[i] += 1
        self.added_since_save += 1

    def add_frame(self, motion_body, lap_body, motion_time: float, lap_time: float, active: list[int]) -> int:
        """Add every car on track from a Motion packet and a nearby LapData packet."""
        dt = motion_time - lap_time
        if abs(dt) > MAX_PAIR_GAP_S:
            return 0
        added = 0
        cars = motion_body["car_motion_data"]
        laps = lap_body["lap_data"]
        for i in active:
            lap = laps[i]
            # On track (not in pit lane or garage) and actually racing.
            if int(lap["pit_status"]) != 0 or int(lap["driver_status"]) == 0 or int(lap["result_status"]) != 2:
                continue
            m = cars[i]
            speed = math.hypot(float(m["world_velocity_x"]), float(m["world_velocity_z"]))
            dist = float(lap["lap_distance"]) + speed * dt
            if dist < 0:
                dist += self.track_length
            self.add(dist % self.track_length, float(m["world_position_x"]), float(m["world_position_z"]))
            added += 1
        return added

    @property
    def coverage(self) -> float:
        return float(np.count_nonzero(self._count >= MIN_SAMPLES_PER_BIN)) / self.bins

    @property
    def max_gap_bins(self) -> int:
        filled = np.nonzero(self._count >= MIN_SAMPLES_PER_BIN)[0]
        if len(filled) == 0:
            return self.bins
        return int(np.diff(np.r_[filled, filled[0] + self.bins]).max()) - 1

    @property
    def ready(self) -> bool:
        return self.coverage >= READY_COVERAGE and self.max_gap_bins <= READY_MAX_GAP_BINS

    def segments(self) -> list[list[list[float]]]:
        """The outline as polylines of [x, z] points every BIN_M metres.

        Gaps up to READY_MAX_GAP_BINS are interpolated; longer ones (stretches no
        car has driven yet) split the outline instead of drawing a false straight
        line. A complete track is a single closed segment whose last point meets
        its first. Points are lightly smoothed to remove racing-line jitter.
        """
        filled = np.nonzero(self._count >= MIN_SAMPLES_PER_BIN)[0]
        if len(filled) < 3:
            return []
        means = self._sum[filled] / self._count[filled, None]
        all_i = np.arange(self.bins)
        xs = np.interp(all_i, filled, means[:, 0], period=self.bins)
        zs = np.interp(all_i, filled, means[:, 1], period=self.bins)

        # Bins that are known or inside a short, interpolated gap.
        usable = np.zeros(self.bins, dtype=bool)
        usable[filled] = True
        gaps = np.diff(np.r_[filled, filled[0] + self.bins]) - 1
        for start, gap in zip(filled, gaps):
            if 0 < gap <= READY_MAX_GAP_BINS:
                usable[(start + 1 + np.arange(gap)) % self.bins] = True

        # Circular 5-bin (50 m) moving average, only where the whole window is
        # usable: next to a long gap it would pull points towards the false chord.
        k = np.ones(5) / 5
        pad = lambda a: np.r_[a[-2:], a, a[:2]]  # noqa: E731
        sx = np.convolve(pad(xs), k, mode="valid")
        sz = np.convolve(pad(zs), k, mode="valid")
        whole = np.convolve(pad(usable.astype(float)), k, mode="valid") > 0.999
        xs, zs = np.where(whole, sx, xs), np.where(whole, sz, zs)

        if usable.all():
            loop = [[round(float(x), 1), round(float(z), 1)] for x, z in zip(xs, zs)]
            return [loop + [loop[0]]]
        # Walk the ring from the first unusable bin so no segment wraps around.
        first_hole = int(np.argmin(usable))
        order = (first_hole + np.arange(self.bins)) % self.bins
        segs: list[list[list[float]]] = []
        current: list[list[float]] = []
        for i in order:
            if usable[i]:
                current.append([round(float(xs[i]), 1), round(float(zs[i]), 1)])
            elif current:
                segs.append(current)
                current = []
        if current:
            segs.append(current)
        return [seg for seg in segs if len(seg) >= 2]
