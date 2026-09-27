from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AppLog(Base):
    """WARNING+ log records, read by the logs MCP through /internal/logs."""

    __tablename__ = "app_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    level: Mapped[str] = mapped_column(String(10), index=True)
    logger_name: Mapped[str | None] = mapped_column(String(255))
    message: Mapped[str] = mapped_column(Text)
    module: Mapped[str | None] = mapped_column(String(255))
    request_path: Mapped[str | None] = mapped_column(String(500))
    request_method: Mapped[str | None] = mapped_column(String(10))
    status_code: Mapped[int | None] = mapped_column(Integer)
    user_id: Mapped[int | None] = mapped_column(Integer)
    tenant_id: Mapped[int | None] = mapped_column(Integer)
    traceback: Mapped[str | None] = mapped_column(Text)
    extra: Mapped[dict | None] = mapped_column(JSONB)
