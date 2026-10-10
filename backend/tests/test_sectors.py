"""Fase A — tiempos por sector en vivo."""

from app.engineer import analysis
from app.engineer.history import SECTOR_LOSS_MS, SessionHistory
from app.live.state import LiveSession
from tests.test_parser import BAKU_RACE, needs_baku


def _live():
    return LiveSession(0, 0, 1, 2024, build_layout=False)


def test_finalize_sectors_computes_s3_and_tracks_bests():
    h = SessionHistory()
    h._cur_s1, h._cur_s2 = 28_000, 42_000
    assert h._finalize_sectors(105_000) == [28_000, 42_000, 35_000]
    assert h.best_sectors == {1: 28_000, 2: 42_000, 3: 35_000}
    assert h.last_lap_sectors == [28_000, 42_000, 35_000]
    assert h._cur_s1 is None and h._cur_s2 is None  # reset for the next lap

    # A slower lap keeps the bests; a quicker S1 lowers only that one.
    h._cur_s1, h._cur_s2 = 27_500, 43_000
    h._finalize_sectors(106_000)
    assert h.best_sectors[1] == 27_500 and h.best_sectors[2] == 42_000

    # An invalid lap must not pollute the bests.
    h._cur_s1, h._cur_s2 = 10_000, 10_000
    h._lap_invalid = True
    h._finalize_sectors(25_000)
    assert h.best_sectors[1] == 27_500


def test_sector_note_only_on_pb_or_big_loss():
    h = SessionHistory()
    h.best_sectors = {1: 28_000}
    live = _live()
    assert h._sector_note(1, 27_900, invalid=False, t=1.0, live=live)  # personal best
    assert not h._sector_note(1, 28_100, invalid=False, t=1.0, live=live)  # loss < 0.3s
    assert h._sector_note(1, 28_000 + SECTOR_LOSS_MS, invalid=False, t=1.0, live=live)  # loss >= threshold
    assert not h._sector_note(1, 20_000, invalid=True, t=1.0, live=live)  # invalid: never


def test_sectores_block_shape():
    h = SessionHistory()
    h.best_sectors = {1: 28_319, 2: 41_562, 3: 35_106}
    h.last_lap_sectors = [28_540, 41_780, 35_220]
    facts = analysis.build(_live(), h)
    s = facts["sectores"]
    assert s["mis_mejores_s"] == {"s1": 28.319, "s2": 41.562, "s3": 35.106}
    assert s["vuelta_teorica_s"] == round((28_319 + 41_562 + 35_106) / 1000, 3)
    assert s["ultima_vuelta"]["total_s"] == round((28_540 + 41_780 + 35_220) / 1000, 3)


def test_no_sector_block_before_anything_is_crossed():
    assert analysis.build(_live(), SessionHistory())["sectores"] is None


@needs_baku
def test_live_sector_captured_on_a_real_race():
    """Over a real race the engineer picks up S1 mid-lap, before the lap ends."""
    from app.engineer.engine import RaceEngineer
    from app.replay.player import ReplaySource
    from app.telemetry import registry

    engineer = RaceEngineer()
    live = None
    clock = {"t": 0.0}
    for t, data in ReplaySource([str(BAKU_RACE)]).records():
        clock["t"] = t
        packet = registry.parse(data)
        if live is None:
            live = LiveSession(0, 0, packet.session_uid, 2024, build_layout=False, clock=lambda: clock["t"])
        live.update(packet)
        engineer.observe(packet, live)
    facts = analysis.build(live, engineer.history)
    assert facts["sectores"]["vuelta_en_curso"]["s1_s"] is not None
