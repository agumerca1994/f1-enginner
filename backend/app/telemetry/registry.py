"""Turns raw UDP datagrams into typed packets, routed by packet format.

Supporting a new game year means adding a module under `formats/` and an
entry in `FORMATS`; nothing else in the pipeline changes.
"""

from dataclasses import dataclass

import numpy as np

from app.telemetry.formats import f2024

FORMATS = {2024: f2024}

HEADER_SIZE = f2024.HEADER.itemsize


class PacketError(ValueError):
    """The datagram is not a packet this server can decode."""


@dataclass(frozen=True, slots=True)
class Packet:
    packet_format: int
    packet_id: int
    name: str
    header: np.void
    body: np.void

    @property
    def session_uid(self) -> int:
        return int(self.header["session_uid"])

    @property
    def session_time(self) -> float:
        return float(self.header["session_time"])

    @property
    def frame(self) -> int:
        return int(self.header["frame_identifier"])

    @property
    def player_car_index(self) -> int:
        return int(self.header["player_car_index"])


def parse(datagram: bytes) -> Packet:
    """Decode one datagram. Raises PacketError for anything malformed or unsupported."""
    if len(datagram) < HEADER_SIZE:
        raise PacketError(f"datagram of {len(datagram)} bytes is shorter than the header")
    packet_format = int.from_bytes(datagram[0:2], "little")
    fmt = FORMATS.get(packet_format)
    if fmt is None:
        raise PacketError(f"unsupported packet format {packet_format}")
    header = np.frombuffer(datagram, dtype=fmt.HEADER, count=1)[0]
    packet_id = int(header["packet_id"])
    entry = fmt.PACKETS.get(packet_id)
    if entry is None:
        raise PacketError(f"unknown packet id {packet_id} in format {packet_format}")
    name, dtype = entry
    expected = fmt.SIZES[packet_id]
    if len(datagram) != expected:
        raise PacketError(f"{name}: expected {expected} bytes, got {len(datagram)}")
    body = np.frombuffer(datagram, dtype=dtype, count=1, offset=HEADER_SIZE)[0]
    return Packet(packet_format, packet_id, name, header, body)


def event_details(packet: Packet) -> tuple[str, dict]:
    """Return the event code and its decoded details for an Event packet."""
    fmt = FORMATS[packet.packet_format]
    code = bytes(packet.body["event_string_code"]).decode("ascii", "replace")
    dtype = fmt.EVENT_DETAILS.get(code)
    if dtype is None:
        return code, {}
    raw = packet.body["event_details"].tobytes()[: dtype.itemsize]
    rec = np.frombuffer(raw, dtype=dtype, count=1)[0]
    return code, {name: rec[name].item() for name in dtype.names}
