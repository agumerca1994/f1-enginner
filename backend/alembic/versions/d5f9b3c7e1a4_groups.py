"""groups and leagues

Revision ID: d5f9b3c7e1a4
Revises: c3e7a1d9f5b2
Create Date: 2026-11-26 18:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d5f9b3c7e1a4"
down_revision: Union[str, None] = "c3e7a1d9f5b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "groups",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("join_code", sa.String(16), nullable=False),
        sa.Column("created_by_tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("round_track_id", sa.SmallInteger(), nullable=True),
        sa.Column("round_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_groups_join_code", "groups", ["join_code"], unique=True)
    op.create_table(
        "group_members",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("admin", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("group_id", "tenant_id", name="uq_group_member"),
    )
    op.create_index("ix_group_members_group_id", "group_members", ["group_id"])
    op.create_index("ix_group_members_tenant_id", "group_members", ["tenant_id"])


def downgrade() -> None:
    op.drop_table("group_members")
    op.drop_table("groups")
