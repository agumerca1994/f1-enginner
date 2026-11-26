"""Early access: invite codes we hand out, and the requests of people who want one."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class InviteCode(Base):
    """A code that lets players in. Stored only as its sha256, like every other token."""

    __tablename__ = "invite_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    code_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    label: Mapped[str | None] = mapped_column(String(120))  # who it was sent to, or the batch
    max_uses: Mapped[int] = mapped_column(Integer, default=1)
    uses: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AccessRequest(Base):
    """Someone signed in without a code and asked to be let in: a player or a sim-racing venue."""

    __tablename__ = "access_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, index=True)
    kind: Mapped[str] = mapped_column(String(10))  # "jugador" | "local"
    game: Mapped[str | None] = mapped_column(String(60))
    platform: Mapped[str | None] = mapped_column(String(30))
    venue_name: Mapped[str | None] = mapped_column(String(120))
    city: Mapped[str | None] = mapped_column(String(80))
    rigs: Mapped[int | None] = mapped_column(Integer)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
