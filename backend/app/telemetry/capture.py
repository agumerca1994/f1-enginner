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


class Writer:
    """Streams records into a .f1cap.zst file the bridge's `inspect` and `replay` can read."""

    def __init__(self, path: str | Path, meta: dict):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._file = open(self.path, "wb")
        self._zw = zstandard.ZstdCompressor(level=3).stream_writer(self._file)
        js = json.dumps(meta).encode()
        self._zw.write(MAGIC + bytes([VERSION]) + struct.pack("<I", len(js)) + js)
        self._first_ns: int | None = None
        self.records = 0

    def write(self, received_ns: int, data: bytes) -> None:
        if self._first_ns is None:
            self._first_ns = received_ns
        self._zw.write(_RECORD.pack(max(0, received_ns - self._first_ns), len(data)) + data)
        self.records += 1

    def close(self) -> None:
        self._zw.close()  # also closes the underlying file


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
