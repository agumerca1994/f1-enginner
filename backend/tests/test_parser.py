import os
from collections import Counter
from pathlib import Path

import numpy as np
import pytest

from app.telemetry import capture, registry
from app.telemetry.formats import f2024

CAPTURES = Path(__file__).resolve().parents[2] / "fixtures" / "captures"
BAKU_RACE = CAPTURES / "baku-carrera-wifi.f1cap.zst"


def _is_lfs_pointer(path: Path) -> bool:
    return path.stat().st_size < 200 and path.read_bytes().startswith(b"version https://git-lfs")


needs_baku = pytest.mark.skipif(
    not BAKU_RACE.exists() or _is_lfs_pointer(BAKU_RACE),
    reason="capture fixture not available (run git lfs pull)",
)


@pytest.mark.parametrize("packet_id", sorted(f2024.PACKETS))
def test_sizes_match_spec(packet_id):
    _, dtype = f2024.PACKETS[packet_id]
    assert f2024.HEADER.itemsize + dtype.itemsize == f2024.SIZES[packet_id]


def test_event_details_fit_union():
    assert all(d.itemsize <= 12 for d in f2024.EVENT_DETAILS.values())


def _datagram(packet_id: int, size: int | None = None, packet_format: int = 2024) -> bytes:
    size = f2024.SIZES.get(packet_id, 100) if size is None else size
    buf = bytearray(size)
    header = np.zeros(1, dtype=f2024.HEADER)
    header["packet_format"] = packet_format
    header["game_year"] = 24
    header["packet_id"] = packet_id
    header["session_uid"] = 42
    buf[: f2024.HEADER.itemsize] = header.tobytes()[: min(size, f2024.HEADER.itemsize)]
    return bytes(buf)


@pytest.mark.parametrize(
    "datagram, message",
    [
        (b"", "shorter than the header"),
        (_datagram(6)[:28], "shorter than the header"),
        (_datagram(6, packet_format=2025), "unsupported packet format"),
        (_datagram(99, size=50), "unknown packet id"),
        (_datagram(6, size=1351), "expected 1352 bytes"),
    ],
)
def test_rejects_malformed(datagram, message):
    with pytest.raises(registry.PacketError, match=message):
        registry.parse(datagram)


def test_random_bytes_never_crash():
    rng = np.random.default_rng(0)
    for _ in range(2000):
        data = rng.integers(0, 256, rng.integers(0, 1500), dtype=np.uint8).tobytes()
        try:
            registry.parse(data)
        except registry.PacketError:
            pass


def test_event_decoding():
    data = bytearray(_datagram(3))
    data[29:33] = b"OVTK"
    data[33:35] = bytes([4, 10])
    code, details = registry.event_details(registry.parse(bytes(data)))
    assert code == "OVTK"
    assert details == {"overtaking_vehicle_idx": 4, "being_overtaken_vehicle_idx": 10}


@needs_baku
def test_real_capture_baku_race():
    """Race at Baku recorded over a lossy Wi-Fi link (~19% received), player driving Gasly."""
    meta, records = capture.read(BAKU_RACE)
    assert meta["listen_addr"] == ":20777"

    counts = Counter()
    last = {}
    events = Counter()
    for rec in records:
        packet = registry.parse(rec.data)  # every datagram in a real capture must decode
        counts[packet.name] += 1
        last[packet.name] = packet
        if packet.name == "event":
            events[registry.event_details(packet)[0]] += 1

    assert sum(counts.values()) == 1715
    assert {p.packet_format for p in last.values()} == {2024}
    assert len({p.session_uid for p in last.values()}) == 1

    session = last["session"].body
    assert int(session["track_id"]) == 20  # Baku
    assert int(session["session_type"]) == 15  # race
    assert int(session["total_laps"]) == 18
    assert 5900 < int(session["track_length"]) < 6100

    player = last["car_telemetry"].player_car_index
    participant = last["participants"].body["participants"][player]
    assert participant["name"].decode() == "GASLY"
    assert int(participant["race_number"]) == 10

    telemetry = last["car_telemetry"].body["car_telemetry_data"][player]
    status = last["car_status"].body["car_status_data"][player]
    assert 0 <= int(telemetry["speed"]) <= 380
    assert -1 <= int(telemetry["gear"]) <= 8
    assert int(telemetry["engine_rpm"]) <= int(status["max_rpm"])
    assert 0 < float(status["fuel_in_tank"]) <= float(status["fuel_capacity"])
    assert int(status["visual_tyre_compound"]) in (7, 8, 16, 17, 18)

    assert {"OVTK", "COLL", "SCAR", "PENA"} <= set(events)
