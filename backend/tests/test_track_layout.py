import math

from app.live.track_layout import BIN_M, LayoutBuilder

LENGTH = 1000.0
RADIUS = LENGTH / (2 * math.pi)


def drive(builder: LayoutBuilder, start_m: float, end_m: float, step_m: float = 3.0) -> None:
    d = start_m
    while d < end_m:
        a = 2 * math.pi * d / LENGTH
        builder.add(d, RADIUS * math.cos(a), RADIUS * math.sin(a))
        d += step_m


def test_full_lap_is_one_closed_loop():
    b = LayoutBuilder(LENGTH)
    drive(b, 0, LENGTH)
    assert b.ready
    (loop,) = b.segments()
    assert loop[0] == loop[-1]
    assert len(loop) == LENGTH / BIN_M + 1
    # Every point sits on the circle (smoothing pulls it in only slightly).
    for x, z in loop:
        assert abs(math.hypot(x, z) - RADIUS) < 2


def test_unvisited_stretch_splits_instead_of_drawing_a_chord():
    b = LayoutBuilder(LENGTH)
    drive(b, 100, 700)
    assert not b.ready
    (seg,) = b.segments()
    # No point cuts across the circle through the missing 400 m.
    for x, z in seg:
        assert abs(math.hypot(x, z) - RADIUS) < 2


def test_small_gaps_are_bridged():
    b = LayoutBuilder(LENGTH)
    drive(b, 0, 480)
    drive(b, 520, LENGTH)  # a 40 m hole, below the 50 m limit
    assert b.ready
    assert len(b.segments()) == 1


def test_merge_combines_sessions():
    first, second = LayoutBuilder(LENGTH), LayoutBuilder(LENGTH)
    drive(first, 0, 500)
    drive(second, 500, LENGTH)
    sums, counts = first.arrays()
    second.merge(sums, counts)
    assert second.ready
    # Saved with another track length: ignored rather than misaligned.
    other = LayoutBuilder(2000)
    other.merge(sums, counts)
    assert other.coverage == 0
