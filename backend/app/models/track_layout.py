from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Integer, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class TrackLayout(Base):
    """A circuit outline built from telemetry, shared by every player (the track is the same).

    `sums`/`counts` hold the raw per-bin samples so later sessions keep refining it;
    `points` is the derived outline the dashboard draws.
    """

    __tablename__ = "track_layouts"

    track_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    track_length_m: Mapped[float] = mapped_column(Float)
    bin_m: Mapped[float] = mapped_column(Float)
    sums: Mapped[list] = mapped_column(JSONB)
    counts: Mapped[list] = mapped_column(JSONB)
    points: Mapped[list] = mapped_column(JSONB)
    coverage: Mapped[float] = mapped_column(Float)
    ready: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
