"""plans and payments

Revision ID: e7a2c4f6b8d1
Revises: d5f9b3c7e1a4
Create Date: 2026-11-26 21:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e7a2c4f6b8d1"
down_revision: Union[str, None] = "d5f9b3c7e1a4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "billing_accounts",
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), primary_key=True),
        sa.Column("race_credits", sa.Integer(), server_default="0", nullable=False),
        sa.Column("trial_races", sa.Integer(), server_default="3", nullable=False),
        sa.Column("plan_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("mp_preapproval_id", sa.String(64), nullable=True),
        sa.Column("mp_preapproval_status", sa.String(20), nullable=True),
        sa.Column("comp", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("comp_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("comp_note", sa.String(200), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "race_usages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("game_session_id", sa.Integer(), sa.ForeignKey("game_sessions.id"), nullable=False),
        sa.Column("block", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(12), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "game_session_id", "block", name="uq_race_usage"),
    )
    op.create_index("ix_race_usages_tenant_id", "race_usages", ["tenant_id"])
    op.create_index("ix_race_usages_created_at", "race_usages", ["created_at"])
    op.create_table(
        "payments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("ref", sa.String(40), nullable=False),
        sa.Column("product", sa.String(20), nullable=False),
        sa.Column("amount_ars", sa.Numeric(12, 2), nullable=False),
        sa.Column("usd", sa.Numeric(8, 2), nullable=False),
        sa.Column("status", sa.String(12), server_default="pendiente", nullable=False),
        sa.Column("mp_id", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_payments_tenant_id", "payments", ["tenant_id"])
    op.create_index("ix_payments_ref", "payments", ["ref"], unique=True)
    op.create_table(
        "billing_settings",
        sa.Column("key", sa.String(40), primary_key=True),
        sa.Column("value", sa.String(200), nullable=False),
    )


def downgrade() -> None:
    for t in ("billing_settings", "payments", "race_usages", "billing_accounts"):
        op.drop_table(t)
