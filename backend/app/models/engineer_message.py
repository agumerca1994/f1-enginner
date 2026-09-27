from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class EngineerMessage(Base):
    """Every answer of the race engineer: what it said, which model, and what it cost."""

    __tablename__ = "engineer_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    game_session_id: Mapped[int | None] = mapped_column(ForeignKey("game_sessions.id"), index=True)
    mode: Mapped[str] = mapped_column(String(10))  # live | replay
    lap: Mapped[int | None] = mapped_column(Integer)
    triggers: Mapped[list] = mapped_column(JSONB)
    response: Mapped[dict] = mapped_column(JSONB)
    provider: Mapped[str] = mapped_column(String(60))
    usage: Mapped[dict | None] = mapped_column(JSONB)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
