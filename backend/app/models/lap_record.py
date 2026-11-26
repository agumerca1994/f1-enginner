"""Each player's best valid lap per track, game, assists category and weather: the leaderboards."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, SmallInteger, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class LapRecord(Base):
    __tablename__ = "lap_records"
    __table_args__ = (UniqueConstraint("tenant_id", "track_id", "packet_format", "category", "weather", name="uq_lap_record"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    track_id: Mapped[int] = mapped_column(SmallInteger, index=True)
    packet_format: Mapped[int] = mapped_column(SmallInteger)  # the game: 2024, 2025, 2026
    category: Mapped[str] = mapped_column(String(12))  # sin_ayudas | con_ayudas
    weather: Mapped[str] = mapped_column(String(8))  # seco | mojado
    lap_ms: Mapped[int] = mapped_column(Integer)
    s1_ms: Mapped[int] = mapped_column(Integer)
    s2_ms: Mapped[int] = mapped_column(Integer)
    s3_ms: Mapped[int] = mapped_column(Integer)
    session_type: Mapped[int | None] = mapped_column(SmallInteger)
    team: Mapped[str | None] = mapped_column(String(40))
    assists: Mapped[dict | None] = mapped_column(JSONB)
    game_session_id: Mapped[int | None] = mapped_column(ForeignKey("game_sessions.id"))
    set_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
