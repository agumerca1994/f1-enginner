"""Uplink protocol between the bridge and the server (version 1).

Transport: a WebSocket at /ingest/v1 authenticated with `Authorization: Bearer rbd_...`.

Binary messages carry batches of datagrams, zstd-compressed:

    repeated: u64 received_at_unix_ns | u16 length | datagram   (little-endian)

Text messages are JSON objects with a `type`:

    {"type": "hello", "bridge_version": "...", "os": "darwin", "arch": "arm64"}
    {"type": "heartbeat", "received": 1234, "forwarded": 456, "reception": 0.19,
     "source": "192.168.100.133"}
    {"type": "bye"}        clean shutdown; the server saves everything and answers
                           {"type": "goodbye"} before closing

The server greets with {"type": "welcome", "device_id": N}.
"""

import struct

import zstandard

RECORD = struct.Struct("<QH")
# A 100 ms batch at 60 Hz is well under 100 KB; anything this large is not a bridge.
MAX_BATCH_BYTES = 4 << 20

_decompressor = zstandard.ZstdDecompressor()


class ProtocolError(ValueError):
    pass


def encode_batch(records: list[tuple[int, bytes]]) -> bytes:
    """Used by tests and tools; the production encoder is the Go bridge."""
    raw = b"".join(RECORD.pack(ts, len(data)) + data for ts, data in records)
    return zstandard.ZstdCompressor().compress(raw)


def decode_batch(payload: bytes) -> list[tuple[int, bytes]]:
    try:
        raw = _decompressor.decompress(payload, max_output_size=MAX_BATCH_BYTES)
    except zstandard.ZstdError as e:
        raise ProtocolError(f"cannot decompress batch: {e}") from e
    records = []
    pos, end = 0, len(raw)
    while pos < end:
        if pos + RECORD.size > end:
            raise ProtocolError("truncated record header")
        ts, length = RECORD.unpack_from(raw, pos)
        pos += RECORD.size
        if pos + length > end:
            raise ProtocolError("truncated record data")
        records.append((ts, raw[pos : pos + length]))
        pos += length
    return records
