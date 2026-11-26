"""early access: invite codes, access requests, users.access_granted_at

Revision ID: b8d4f2a6c1e9
Revises: a7c3e9f1b2d8
Create Date: 2026-11-26 10:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b8d4f2a6c1e9"
down_revision: Union[str, None] = "a7c3e9f1b2d8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("access_granted_at", sa.DateTime(timezone=True), nullable=True))
    # Everyone who already has an account keeps it.
    op.execute("UPDATE users SET access_granted_at = now()")
    op.create_table(
        "invite_codes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=True),
        sa.Column("max_uses", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("uses", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_invite_codes_code_hash", "invite_codes", ["code_hash"], unique=True)
    op.create_table(
        "access_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("game", sa.String(length=60), nullable=True),
        sa.Column("platform", sa.String(length=30), nullable=True),
        sa.Column("venue_name", sa.String(length=120), nullable=True),
        sa.Column("city", sa.String(length=80), nullable=True),
        sa.Column("rigs", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_access_requests_user_id", "access_requests", ["user_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_access_requests_user_id", table_name="access_requests")
    op.drop_table("access_requests")
    op.drop_index("ix_invite_codes_code_hash", table_name="invite_codes")
    op.drop_table("invite_codes")
    op.drop_column("users", "access_granted_at")
