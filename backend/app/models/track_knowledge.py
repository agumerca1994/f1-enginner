from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, SmallInteger, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class TrackKnowledge(Base):
    """What a player learned about a track across their sessions there.

    One compact row per (tenant, track): clean pace and degradation per compound,
    fuel use and measured pit loss. Written at session flush from the engineer's
    in-memory history, read when a race starts so the opening strategy brief is
    grounded in real practice data instead of generic defaults.
    """

    __tablename__ = "track_knowledge"
    __table_args__ = (UniqueConstraint("tenant_id", "track_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    track_id: Mapped[int] = mapped_column(SmallInteger)
    # Clean laps the current summary is based on, so a richer session wins over a poorer one.
    clean_laps: Mapped[int] = mapped_column(Integer, default=0)
    summary: Mapped[dict] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
