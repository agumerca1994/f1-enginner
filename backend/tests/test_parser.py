import os
from collections import Counter
from pathlib import Path

import numpy as np
import pytest

from app.telemetry import capture, registry
from app.telemetry.constants import TEAMS
from app.telemetry.formats import f2024, f2025, f2026

CAPTURES = Path(__file__).resolve().parents[2] / "fixtures" / "captures"
BAKU_RACE = CAPTURES / "baku-carrera-wifi.f1cap.zst"
TEXAS_2026 = CAPTURES / "texas-carrera-temporada2026-formato2024.f1cap.zst"
MADRID_2025 = CAPTURES / "madrid-carrera-temporada2026-formato2025.f1cap.zst"
SUZUKA_2026 = CAPTURES / "suzuka-carrera-temporada2026-formato2026.f1cap.zst"


def _is_lfs_pointer(path: Path) -> bool:
    return path.stat().st_size < 200 and path.read_bytes().startswith(b"version https://git-lfs")


def _needs(path: Path):
    return pytest.mark.skipif(
        not path.exists() or _is_lfs_pointer(path),
        reason="capture fixture not available (run git lfs pull)",
    )


needs_baku = _needs(BAKU_RACE)
needs_texas_2026 = _needs(TEXAS_2026)
needs_madrid_2025 = _needs(MADRID_2025)
needs_suzuka_2026 = _needs(SUZUKA_2026)


def _read_all(path: Path):
    """Parse every datagram of a capture; return counts, last packet per name and events."""
    counts, last, events, years = Counter(), {}, Counter(), set()
    _, records = capture.read(path)
    for rec in records:
        packet = registry.parse(rec.data)  # every datagram in a real capture must decode
        counts[packet.name] += 1
        if packet.session_uid:
            last[packet.name] = packet
        years.add(int(packet.header["game_year"]))
        if packet.name == "event":
            events[registry.event_details(packet)[0]] += 1
    return counts, last, events, years


@pytest.mark.parametrize(
    "fmt, packet_id", [(fmt, pid) for fmt in (f2024, f2025, f2026) for pid in sorted(fmt.PACKETS)]
)
def test_sizes_match_spec(fmt, packet_id):
    _, dtype = fmt.PACKETS[packet_id]
    assert fmt.HEADER.itemsize + dtype.itemsize == fmt.SIZES[packet_id]


def test_event_details_fit_union():
    assert all(d.itemsize <= 12 for d in f2024.EVENT_DETAILS.values())


def _datagram(packet_id: int, size: int | None = None, packet_format: int = 2024) -> bytes:
    sizes = registry.FORMATS.get(packet_format, f2024).SIZES
    size = sizes.get(packet_id, 100) if size is None else size
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
        (_datagram(6, packet_format=2027), "unsupported packet format"),
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


@needs_texas_2026
def test_real_capture_2026_season_in_2024_format():
    """F1 25 with the 2026 season pack, sent in the 2024 format: a 5-lap race at
    Texas on a Windows PC (game and bridge on the same machine), player driving Russell."""
    meta, records = capture.read(TEXAS_2026)
    assert meta["host"] == "EDG"

    counts = Counter()
    last = {}
    events = Counter()
    years = set()
    for rec in records:
        packet = registry.parse(rec.data)  # the 2024 layout holds every datagram
        counts[packet.name] += 1
        last[packet.name] = packet
        years.add(int(packet.header["game_year"]))
        if packet.name == "event":
            events[registry.event_details(packet)[0]] += 1

    assert sum(counts.values()) == 59490
    assert {p.packet_format for p in last.values()} == {2024}
    assert years == {25}

    session = last["session"].body
    assert int(session["track_id"]) == 15  # Texas
    assert int(session["session_type"]) == 15  # race
    assert int(session["total_laps"]) == 5

    # The 2026 grid (11 teams) fits the 22 slots, with team ids from 220.
    participants = last["participants"].body
    assert int(participants["num_active_cars"]) == 22
    teams = {int(p["team_id"]) for p in participants["participants"][:22]}
    assert teams == set(range(220, 231))
    assert all(t in TEAMS for t in teams)

    player = last["car_telemetry"].player_car_index
    me = participants["participants"][player]
    assert me["name"].decode() == "RUSSELL"
    assert TEAMS[int(me["team_id"])] == "Mercedes"

    assert {"OVTK", "COLL", "PENA", "FTLP"} <= set(events)


def test_2025_format_layouts():
    """2025 keeps the 2024 layouts except where the F1 25 spec changed them."""
    assert registry.parse(_datagram(6, packet_format=2025)).name == "car_telemetry"
    assert registry.parse(_datagram(15, packet_format=2025)).name == "lap_positions"
    with pytest.raises(registry.PacketError, match="expected 1284 bytes"):
        registry.parse(_datagram(4, size=1350, packet_format=2025))  # a 2024-sized Participants

    data = bytearray(_datagram(4, packet_format=2025))
    first = f2024.HEADER.itemsize + 1  # after num_active_cars
    data[first + 7 : first + 7 + 10] = b"VERSTAPPEN"  # name follows seven one-byte fields
    data[first + 44] = 1  # num_colours: name (32) + 5 bytes of settings after it
    data[first + 45 : first + 48] = bytes([54, 113, 198])
    me = registry.parse(bytes(data)).body["participants"][0]
    assert me["name"] == b"VERSTAPPEN"
    assert int(me["num_colours"]) == 1
    assert me["livery_colours"][0].tolist() == (54, 113, 198)

    # Blisters sit between brake damage and wing damage, not at the end.
    data = bytearray(_datagram(10, packet_format=2025))
    first = f2024.HEADER.itemsize
    data[first + 24 : first + 29] = bytes([1, 2, 3, 4, 77])
    car = registry.parse(bytes(data)).body["car_damage_data"][0]
    assert car["tyre_blisters"].tolist() == [1, 2, 3, 4]
    assert int(car["front_left_wing_damage"]) == 77


def test_2026_format_layouts():
    """2026: 24 car slots, 16-bit team ids, quantised g-forces and the new CarTelemetry2."""
    from app.live.state import LiveSession

    data = bytearray(_datagram(0, packet_format=2026))
    car = f2026.CAR_MOTION_RAW
    g = f2024.HEADER.itemsize + 23 * car.itemsize + car.fields["g_force_lateral"][1]  # the 24th slot
    data[g : g + 2] = (-2040).to_bytes(2, "little", signed=True)
    motion = registry.parse(bytes(data)).body["car_motion_data"]
    assert len(motion) == 24
    assert float(motion[23]["g_force_lateral"]) == pytest.approx(-2.04)  # thousandths of a g, as floats

    data = bytearray(_datagram(4, packet_format=2026))
    first = f2024.HEADER.itemsize + 1
    data[first + 5 : first + 7] = (476).to_bytes(2, "little")  # team_id after ai (1) + driver (2) + network (2)
    me = registry.parse(bytes(data)).body["participants"][0]
    assert int(me["team_id"]) == 476 and TEAMS[476] == "Mercedes"

    data = bytearray(_datagram(16, packet_format=2026))
    data[f2024.HEADER.itemsize + 4] = 1  # overtake_available of car 0
    assert int(registry.parse(bytes(data)).body["car_telemetry_2_data"][0]["overtake_available"]) == 1

    # The live state reads the slot count off the packets: slot 23 counts as a car.
    laps = bytearray(_datagram(2, packet_format=2026))
    lap = f2024.LAP_DATA
    laps[f2024.HEADER.itemsize + 23 * lap.itemsize + lap.fields["result_status"][1]] = 2
    live = LiveSession(tenant_id=1, device_id=1, session_uid=42, packet_format=2026)
    live.update(registry.parse(bytes(laps)))
    assert live.slots() == 24
    assert live.active_cars() == [23]


@needs_madrid_2025
def test_real_capture_2026_season_in_2025_format():
    """F1 25 with the 2026 season pack in the 2025 format: a 5-lap race at Madrid, player Verstappen."""
    counts, last, events, years = _read_all(MADRID_2025)
    assert sum(counts.values()) == 93396
    assert {p.packet_format for p in last.values()} == {2025} and years == {25}
    assert counts["lap_positions"] > 0

    session = last["session"].body
    assert int(session["track_id"]) == 42 and int(session["track_length"]) == 5411  # Madrid

    participants = last["participants"].body
    assert int(participants["num_active_cars"]) == 22
    player = last["car_telemetry"].player_car_index
    me = participants["participants"][player]
    assert me["name"] == b"VERSTAPPEN" and TEAMS[int(me["team_id"])] == "Red Bull Racing"
    assert me["livery_colours"][0].tolist() == (54, 113, 198)  # the game's Red Bull blue

    damage = last["car_damage"].body["car_damage_data"][player]
    assert all(0 <= int(b) <= 100 for b in damage["tyre_blisters"])
    assert 0 < float(damage["tyres_wear"][0]) < 100
    assert {"OVTK", "COLL", "CHQF"} <= set(events)


@needs_suzuka_2026
def test_real_capture_2026_format():
    """The 2026 format: a 5-lap race at Suzuka in 24-slot arrays, player Antonelli."""
    counts, last, events, years = _read_all(SUZUKA_2026)
    assert sum(counts.values()) == 39693
    assert {p.packet_format for p in last.values()} == {2026} and years == {25}
    assert counts["car_telemetry_2"] > 0

    session = last["session"].body
    assert int(session["track_id"]) == 13  # Suzuka
    assert int(session["num_active_aero_zones_full"]) > 0

    participants = last["participants"].body
    assert len(participants["participants"]) == 24
    teams = {int(p["team_id"]) for p in participants["participants"]}
    assert teams == set(range(476, 487)) | {65535}  # 65535 marks the two empty slots
    player = last["car_telemetry"].player_car_index
    assert participants["participants"][player]["name"] == b"ANTONELLI"

    g = float(last["motion"].body["car_motion_data"][player]["g_force_lateral"])
    assert -8 < g < 8  # decoded from thousandths of a g
    assert 60 < int(last["car_telemetry"].body["car_telemetry_data"][player]["engine_temperature"]) < 150
    assert float(last["car_status"].body["car_status_data"][player]["ers_harvest_limit_per_lap"]) > 0
    assert {"OVTK", "COLL"} <= set(events)

