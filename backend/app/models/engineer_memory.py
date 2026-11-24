from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, SmallInteger, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class EngineerMemory(Base):
    """What the engineer remembers about one race weekend (practice to race at one track).

    The driver's reports ("se va de cola en la 1"), the setup changes read from the
    game and the ones agreed with the engineer, the race plan and what was said last.
    Written when it changes (never per packet), read when a session at that track opens.
    """

    __tablename__ = "engineer_memories"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    track_id: Mapped[int] = mapped_column(SmallInteger)
    data: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
