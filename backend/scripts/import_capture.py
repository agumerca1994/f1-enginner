"""Registers a capture file as a game session in the local database, so it shows
up in the dashboard's Sessions page and can be replayed.

    .venv/bin/python scripts/import_capture.py FILE.f1cap.zst --email player@example.com
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.core.auth import get_or_create_user  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.models import GameSession, SessionCapture  # noqa: E402
from app.telemetry import capture, registry  # noqa: E402


def describe(path: Path) -> dict:
    info = {"records": 0}
    _, records = capture.read(path)
    for rec in records:
        info["records"] += 1
        if "session_uid" in info and "track_id" in info:
            continue
        try:
            p = registry.parse(rec.data)
        except registry.PacketError:
            continue
        if p.session_uid and "session_uid" not in info:
            h = p.header
            info.update(session_uid=f"{p.session_uid:016x}", packet_format=p.packet_format,
                        game_version=f"{int(h['game_year'])} v{int(h['game_major_version'])}.{int(h['game_minor_version']):02d}",
                        player_car_index=p.player_car_index)
        if p.name == "session":
            b = p.body
            info.update(track_id=int(b["track_id"]), session_type=int(b["session_type"]),
                        total_laps=int(b["total_laps"]), network_game=int(b["network_game"]))
    return info


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("capture")
    parser.add_argument("--email", required=True)
    args = parser.parse_args()
    path = Path(args.capture).resolve()
    info = describe(path)
    async with AsyncSessionLocal() as db:
        user = await get_or_create_user(db, email=args.email, firebase_uid=None, name=None)
        existing = await db.scalar(select(GameSession).where(
            GameSession.tenant_id == user.tenant_id, GameSession.session_uid == info["session_uid"]))
        if existing is not None:
            print(f"Already imported as session {existing.id}")
            return
        records = info.pop("records")
        session = GameSession(tenant_id=user.tenant_id, packets_received=records, **info)
        db.add(session)
        await db.flush()
        db.add(SessionCapture(game_session_id=session.id, path=str(path), records=records))
        await db.commit()
        print(f"Imported as session {session.id}: {records} records, track {info.get('track_id')}, {info.get('total_laps')} laps")


if __name__ == "__main__":
    asyncio.run(main())
