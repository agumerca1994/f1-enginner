"""track layout corners

Revision ID: e4a7c1d9b2f3
Revises: c8d2a4f6e1b9
Create Date: 2026-11-23 20:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'e4a7c1d9b2f3'
down_revision: Union[str, None] = 'c8d2a4f6e1b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('track_layouts', sa.Column('corners', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('track_layouts', 'corners')
