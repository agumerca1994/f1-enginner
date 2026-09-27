from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, SmallInteger, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class GameSession(Base):
    """One session of the game (practice, qualifying, race...) identified by its sessionUID."""

    __tablename__ = "game_sessions"
    __table_args__ = (UniqueConstraint("tenant_id", "session_uid"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    device_id: Mapped[int | None] = mapped_column(ForeignKey("devices.id"))
    # The game's u64 does not fit a signed BIGINT, so it is stored as a hex string.
    session_uid: Mapped[str] = mapped_column(String(16))
    packet_format: Mapped[int] = mapped_column(Integer)
    game_version: Mapped[str | None] = mapped_column(String(16))
    track_id: Mapped[int | None] = mapped_column(SmallInteger)
    session_type: Mapped[int | None] = mapped_column(SmallInteger)
    total_laps: Mapped[int | None] = mapped_column(SmallInteger)
    player_car_index: Mapped[int | None] = mapped_column(SmallInteger)
    network_game: Mapped[int | None] = mapped_column(SmallInteger)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_packet_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    packets_received: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    packets_rejected: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")


class SessionCapture(Base):
    """A raw .f1cap.zst file holding what one bridge connection sent for a session."""

    __tablename__ = "session_captures"

    id: Mapped[int] = mapped_column(primary_key=True)
    game_session_id: Mapped[int] = mapped_column(ForeignKey("game_sessions.id"), index=True)
    path: Mapped[str] = mapped_column(String(500))
    records: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
