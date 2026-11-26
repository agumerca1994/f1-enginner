"""Groups and leagues: players who compare their laps among themselves.

Anyone creates a group and shares its join code; the group's boards are the same lap records
as the public ones, filtered to its members. An admin can set the track of the round.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, SmallInteger, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Group(Base):
    __tablename__ = "groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60))
    # Shown to every member so they can invite others: it opens the group, not an account.
    join_code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    created_by_tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"))
    round_track_id: Mapped[int | None] = mapped_column(SmallInteger)  # the track of the round, if any
    round_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class GroupMember(Base):
    __tablename__ = "group_members"
    __table_args__ = (UniqueConstraint("group_id", "tenant_id", name="uq_group_member"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), index=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    admin: Mapped[bool] = mapped_column(default=False, server_default="false")
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
