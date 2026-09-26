"""Reader for .f1cap captures written by the bridge (see bridge/internal/capture)."""

import io
import json
import struct
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import zstandard

MAGIC = b"F1CAP"
VERSION = 1
_RECORD = struct.Struct("<QH")


@dataclass(frozen=True, slots=True)
class Record:
    offset_ns: int  # time since the first datagram of the capture
    data: bytes


def read(path: str | Path) -> tuple[dict, Iterator[Record]]:
    """Open a capture and return its metadata plus an iterator over its records."""
    path = Path(path)
    raw = path.read_bytes()
    if path.suffix == ".zst":
        raw = zstandard.ZstdDecompressor().stream_reader(io.BytesIO(raw)).read()
    buf = memoryview(raw)
    if bytes(buf[:5]) != MAGIC:
        raise ValueError(f"{path} is not an .f1cap file")
    if buf[5] != VERSION:
        raise ValueError(f"unsupported capture version {buf[5]}")
    (meta_len,) = struct.unpack_from("<I", buf, 6)
    meta = json.loads(bytes(buf[10 : 10 + meta_len]))
    return meta, _records(buf, 10 + meta_len)


def _records(buf: memoryview, pos: int) -> Iterator[Record]:
    end = len(buf)
    while pos < end:
        if pos + _RECORD.size > end:
            raise ValueError("truncated record header")
        offset_ns, length = _RECORD.unpack_from(buf, pos)
        pos += _RECORD.size
        if pos + length > end:
            raise ValueError("truncated record data")
        yield Record(offset_ns, bytes(buf[pos : pos + length]))
        pos += length
