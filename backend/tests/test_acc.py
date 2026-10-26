"""Assetto Corsa Competizione: decodificación de lo que graba el bridge.

Sin una grabación real todavía: los registros se arman con la especificación
de Kunos y se verifican los offsets que asegura un overlay que ya funciona.
"""

import struct

import numpy as np
import pytest

from app.telemetry import acc


def _page(kind: bytes, dtype, **values) -> bytes:
    rec = np.zeros(1, dtype=dtype)
    for k, v in values.items():
        rec[k] = v
    return acc.MAGIC + kind + rec.tobytes()


def _w(text: str, n: int) -> np.ndarray:
    out = np.zeros(n, dtype="<u2")
    raw = np.frombuffer(text.encode("utf-16-le"), dtype="<u2")
    out[: len(raw)] = raw
    return out


def test_page_layouts_match_the_documentation():
    assert acc.PHYSICS.itemsize == 800 and acc.GRAPHICS.itemsize == 1588
    g = acc.GRAPHICS.fields
    assert (g["player_car_id"][1], g["penalty"][1], g["i_delta_lap_time"][1]) == (1216, 1228, 1360)
    assert acc.STATIC.fields["sector_count"][1] == 400


def test_pages_round_trip():
    phys = acc.parse(_page(acc.KIND_PHYSICS, acc.PHYSICS, packet_id=7, gas=0.8, brake=0.1, gear=4, speed_kmh=212.5,
                           tyre_core_temperature=[80, 81, 82, 83], wheels_pressure=[27.5, 27.6, 27.1, 27.2]))
    assert phys.kind == "physics" and phys.body["gear"] == 4
    assert phys.body["gas"] == pytest.approx(0.8) and list(phys.body["wheels_pressure"])[0] == pytest.approx(27.5)

    gfx = acc.parse(_page(acc.KIND_GRAPHICS, acc.GRAPHICS, status=2, session=2, completed_laps=3, position=5,
                          i_last_time=104_532, player_car_id=1012, i_delta_lap_time=-215, is_delta_positive=0,
                          tyre_compound=_w("dry_compound", 33), car_id=np.arange(60)))
    b = gfx.body
    assert acc.STATUS[int(b["status"])] == "live" and acc.SESSION_TYPES[int(b["session"])] == "race"
    assert int(b["player_car_id"]) == 1012 and int(b["i_delta_lap_time"]) == -215
    assert acc.wstr(b["tyre_compound"]) == "dry_compound" and int(b["car_id"][59]) == 59

    st = acc.parse(_page(acc.KIND_STATIC, acc.STATIC, track=_w("monza", 33), car_model=_w("ferrari_296_gt3", 33),
                         sector_count=3, max_fuel=120))
    assert acc.wstr(st.body["track"]) == "monza" and int(st.body["sector_count"]) == 3


def test_longer_and_shorter_pages():
    longer = _page(acc.KIND_PHYSICS, acc.PHYSICS, gear=3) + b"\x01" * 40  # a newer game appends fields
    assert acc.parse(longer).body["gear"] == 3
    short = _page(acc.KIND_STATIC, acc.STATIC, track=_w("spa", 33))[: 4 + 784]  # the other documented size
    rec = acc.parse(short)
    assert rec.short_by == 36 and acc.wstr(rec.body["track"]) == "spa"
    with pytest.raises(acc.AccError):
        acc.parse(acc.MAGIC + acc.KIND_GRAPHICS + b"\x00" * 100)
    with pytest.raises(acc.AccError):
        acc.parse(b"\x00" * 50)  # an F1 datagram is never mistaken for ACC


def _s(text: str) -> bytes:
    raw = text.encode()
    return struct.pack("<H", len(raw)) + raw


def _lap(ms: int, splits=(30_000, 40_000, 35_000), invalid=False) -> bytes:
    return (struct.pack("<iHHB", ms, 3, 0, len(splits)) + b"".join(struct.pack("<i", s) for s in splits)
            + struct.pack("<BBBB", invalid, not invalid, 0, 0))


def test_broadcasting_messages():
    car = (struct.pack("<BHHBbfffBHHHHfHi", acc.REALTIME_CAR_UPDATE, 3, 0, 1, 5, 120.5, -40.0, 1.2, 1, 231, 4, 2, 4,
                       0.42, 12, -350)
           + _lap(104_000) + _lap(105_100) + _lap(2**31 - 1, splits=(31_000,)))
    m = acc.parse(acc.MAGIC + acc.KIND_BROADCAST + car).body
    assert m["type"] == "car" and m["car_index"] == 3 and m["gear"] == 4 and m["location"] == "track"
    assert m["position"] == 4 and m["spline"] == pytest.approx(0.42) and m["laps"] == 12
    assert m["best_lap"]["ms"] == 104_000 and m["current_lap"]["ms"] is None  # INT32_MAX = no time
    assert m["last_lap"]["splits_ms"] == [30_000, 40_000, 35_000]

    realtime = (struct.pack("<BHHBBffi", acc.REALTIME_UPDATE, 1, 2, 10, 5, 600_000.0, 3_600_000.0, 3)
                + _s("set1") + _s("cam") + _s("Basic HUD") + b"\x00" + struct.pack("<f", 50_400.0)
                + bytes([22, 31, 2, 0, 0]) + _lap(103_900))
    r = acc.parse_broadcast(realtime)
    assert r["session_type"] == "race" and r["phase"] == "session" and r["track_temp_c"] == 31
    assert r["best_session_lap"]["ms"] == 103_900

    entry = (struct.pack("<BHB", acc.ENTRY_LIST_CAR, 3, 32) + _s("Emil Frey Racing") + struct.pack("<iBBH", 14, 0, 0, 5)
             + b"\x01" + _s("Ricardo") + _s("Zonta") + _s("ZON") + struct.pack("<BH", 3, 17))
    e = acc.parse_broadcast(entry)
    assert e["race_number"] == 14 and e["drivers"][0]["last_name"] == "Zonta"

    track = (struct.pack("<Bi", acc.TRACK_DATA, 77) + _s("Monza") + struct.pack("<ii", 5, 5793)
             + b"\x01" + _s("set1") + b"\x01" + _s("cam") + b"\x01" + _s("Basic HUD"))
    t = acc.parse_broadcast(track)
    assert t["track"] == "Monza" and t["track_meters"] == 5793

    event = struct.pack("<BB", acc.BROADCASTING_EVENT, 3) + _s("Drive through") + struct.pack("<ii", 61_000, 3)
    assert acc.parse_broadcast(event)["event"] == "penalty_message"

    with pytest.raises(acc.AccError):
        acc.parse_broadcast(car[:20])  # truncated datagrams are rejected, not half-read


def test_session_summary():
    s = acc.AccSession()
    s.add(acc.parse(_page(acc.KIND_STATIC, acc.STATIC, track=_w("monza", 33), car_model=_w("ferrari_296_gt3", 33))))
    s.add(acc.parse(_page(acc.KIND_PHYSICS, acc.PHYSICS)))
    entry = struct.pack("<BHB", acc.ENTRY_LIST_CAR, 9, 32) + _s("T") + struct.pack("<iBBH", 1, 0, 0, 0) + b"\x00"
    s.add(acc.parse(acc.MAGIC + acc.KIND_BROADCAST + entry))
    assert s.track == "monza" and s.car_model == "ferrari_296_gt3" and s.cars == {9}
    assert s.pages == {"static": 1, "physics": 1} and s.messages == {"entry": 1}
