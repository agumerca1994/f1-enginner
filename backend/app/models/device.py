from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Device(Base):
    """A paired bridge. It authenticates with a bearer token stored here only as a hash."""

    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    os: Mapped[str | None] = mapped_column(String(40))
    arch: Mapped[str | None] = mapped_column(String(40))
    bridge_version: Mapped[str | None] = mapped_column(String(40))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    token_prefix: Mapped[str] = mapped_column(String(12))  # first characters, to tell tokens apart
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Share of the game's telemetry that reached the bridge in its last heartbeat.
    last_reception: Mapped[float | None] = mapped_column(Float)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PairingRequest(Base):
    """Device-code flow: the bridge shows `user_code`, a signed-in player confirms it,
    and the bridge, polling with `device_code`, receives its token once."""

    __tablename__ = "pairing_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    device_code_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_code: Mapped[str] = mapped_column(String(8), index=True)
    name: Mapped[str] = mapped_column(String(120))
    os: Mapped[str | None] = mapped_column(String(40))
    arch: Mapped[str | None] = mapped_column(String(40))
    bridge_version: Mapped[str | None] = mapped_column(String(40))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    confirmed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    device_id: Mapped[int | None] = mapped_column(ForeignKey("devices.id"))
    # Set when the token is handed to the bridge; the request cannot be used again.
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
