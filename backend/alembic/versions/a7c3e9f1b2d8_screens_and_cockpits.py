"""screens (overlay token role/config) and cockpit layouts

Revision ID: a7c3e9f1b2d8
Revises: f1a2b3c4d5e6
Create Date: 2026-11-25 00:30:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'a7c3e9f1b2d8'
down_revision: Union[str, None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('overlay_tokens', sa.Column('role', sa.String(length=20), nullable=True))
    op.add_column('overlay_tokens', sa.Column('config', postgresql.JSONB(), nullable=True))
    op.add_column('users', sa.Column('cockpits', postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'cockpits')
    op.drop_column('overlay_tokens', 'config')
    op.drop_column('overlay_tokens', 'role')
