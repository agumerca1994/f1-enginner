"""overlay token nonce

Revision ID: c8d2a4f6e1b9
Revises: b3f1e7a9c2d4
Create Date: 2026-10-26 20:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'c8d2a4f6e1b9'
down_revision: Union[str, None] = 'b3f1e7a9c2d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('overlay_tokens', sa.Column('nonce', sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column('overlay_tokens', 'nonce')
