"""lap records for the leaderboards

Revision ID: c3e7a1d9f5b2
Revises: b8d4f2a6c1e9
Create Date: 2026-11-26 14:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c3e7a1d9f5b2"
down_revision: Union[str, None] = "b8d4f2a6c1e9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "lap_records",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("track_id", sa.SmallInteger(), nullable=False),
        sa.Column("packet_format", sa.SmallInteger(), nullable=False),
        sa.Column("category", sa.String(length=12), nullable=False),
        sa.Column("weather", sa.String(length=8), nullable=False),
        sa.Column("lap_ms", sa.Integer(), nullable=False),
        sa.Column("s1_ms", sa.Integer(), nullable=False),
        sa.Column("s2_ms", sa.Integer(), nullable=False),
        sa.Column("s3_ms", sa.Integer(), nullable=False),
        sa.Column("session_type", sa.SmallInteger(), nullable=True),
        sa.Column("team", sa.String(length=40), nullable=True),
        sa.Column("assists", postgresql.JSONB(), nullable=True),
        sa.Column("game_session_id", sa.Integer(), sa.ForeignKey("game_sessions.id"), nullable=True),
        sa.Column("set_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "track_id", "packet_format", "category", "weather", name="uq_lap_record"),
    )
    op.create_index("ix_lap_records_tenant_id", "lap_records", ["tenant_id"])
    op.create_index("ix_lap_records_track_id", "lap_records", ["track_id"])


def downgrade() -> None:
    op.drop_index("ix_lap_records_track_id", table_name="lap_records")
    op.drop_index("ix_lap_records_tenant_id", table_name="lap_records")
    op.drop_table("lap_records")
