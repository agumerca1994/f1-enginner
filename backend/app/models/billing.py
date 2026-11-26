"""Plans and payments: what each account has paid for, and the AI races it has used."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class BillingAccount(Base):
    """One per player (tenant), created the first time it is needed."""

    __tablename__ = "billing_accounts"

    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), primary_key=True)
    race_credits: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # The paid subscription: active while plan_until is ahead (Mercado Pago's next charge plus a grace).
    plan_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    mp_preapproval_id: Mapped[str | None] = mapped_column(String(64))
    mp_preapproval_status: Mapped[str | None] = mapped_column(String(20))
    # A courtesy plan (the owner, deals): everything included, no charge. comp_until empty = no end.
    comp: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    comp_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    comp_note: Mapped[str | None] = mapped_column(String(200))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class RaceUsage(Base):
    """One AI race used: a game session's block of up to 45 minutes with the AI engineer."""

    __tablename__ = "race_usages"
    __table_args__ = (UniqueConstraint("tenant_id", "game_session_id", "block", name="uq_race_usage"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    game_session_id: Mapped[int] = mapped_column(ForeignKey("game_sessions.id"))
    block: Mapped[int] = mapped_column(Integer, default=0)
    source: Mapped[str] = mapped_column(String(12))  # suscripcion | paquete | cortesia
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class Payment(Base):
    """A checkout started from the app. Applied once, when Mercado Pago confirms it."""

    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    ref: Mapped[str] = mapped_column(String(40), unique=True, index=True)  # our external_reference
    product: Mapped[str] = mapped_column(String(20))  # suscripcion | paquete5 | paquete12
    amount_ars: Mapped[float] = mapped_column(Numeric(12, 2))
    usd: Mapped[float] = mapped_column(Numeric(8, 2))
    status: Mapped[str] = mapped_column(String(12), default="pendiente", server_default="pendiente")
    mp_id: Mapped[str | None] = mapped_column(String(64))  # payment or preapproval id
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BillingSetting(Base):
    """Values the owner changes without a deploy, such as the reference dollar."""

    __tablename__ = "billing_settings"

    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    value: Mapped[str] = mapped_column(String(200))
