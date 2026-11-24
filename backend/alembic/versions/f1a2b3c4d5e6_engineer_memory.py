"""engineer memory per weekend and the player's radio name

Revision ID: f1a2b3c4d5e6
Revises: e4a7c1d9b2f3
Create Date: 2026-11-24 18:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, None] = 'e4a7c1d9b2f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'engineer_memories',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=False),
        sa.Column('track_id', sa.SmallInteger(), nullable=False),
        sa.Column('data', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_engineer_memories_tenant_id', 'engineer_memories', ['tenant_id'])
    op.add_column('users', sa.Column('radio_name', sa.String(length=40), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'radio_name')
    op.drop_index('ix_engineer_memories_tenant_id', table_name='engineer_memories')
    op.drop_table('engineer_memories')
