"""Las sesiones de menú y los reinicios instantáneos no ensucian la lista."""

import asyncio
from datetime import datetime, timedelta, timezone


def test_short_and_trackless_sessions_are_hidden_but_kept(client):
    from app.core.database import AsyncSessionLocal
    from app.models import GameSession, User

    email = "lista@example.test"
    headers = {"X-Dev-User": email}
    client.get("/api/sessions", headers=headers)  # creates the player

    async def seed():
        async with AsyncSessionLocal() as db:
            from sqlalchemy import select

            user = await db.scalar(select(User).where(User.email == email))
            t0 = datetime(2026, 10, 1, tzinfo=timezone.utc)
            rows = [
                ("a", 10, None, 12, 30),          # menu: no track
                ("b", 15, 7, 300, 40),            # instant restart
                ("c", 15, 7, 300, 600),           # few packets but long (lossy link): kept
                ("d", 15, 7, 25_000, 1_200),      # a race
            ]
            for uid, stype, track, packets, secs in rows:
                db.add(GameSession(tenant_id=user.tenant_id, session_uid=uid, packet_format=2024, session_type=stype,
                                   track_id=track, packets_received=packets, started_at=t0,
                                   last_packet_at=t0 + timedelta(seconds=secs)))
            await db.commit()

    asyncio.run(seed())
    shown = {s["session_uid"] for s in client.get("/api/sessions", headers=headers).json()}
    assert shown == {"c", "d"}
    every = {s["session_uid"] for s in client.get("/api/sessions?all=true", headers=headers).json()}
    assert every == {"a", "b", "c", "d"}
