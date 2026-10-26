"""overlay tokens

Revision ID: b3f1e7a9c2d4
Revises: 92cc84e4b207
Create Date: 2026-10-26 16:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'b3f1e7a9c2d4'
down_revision: Union[str, None] = '92cc84e4b207'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('overlay_tokens',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('token_prefix', sa.String(length=24), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_overlay_tokens_tenant_id'), 'overlay_tokens', ['tenant_id'], unique=False)
    op.create_index(op.f('ix_overlay_tokens_user_id'), 'overlay_tokens', ['user_id'], unique=False)
    op.create_index(op.f('ix_overlay_tokens_token_hash'), 'overlay_tokens', ['token_hash'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_overlay_tokens_token_hash'), table_name='overlay_tokens')
    op.drop_index(op.f('ix_overlay_tokens_user_id'), table_name='overlay_tokens')
    op.drop_index(op.f('ix_overlay_tokens_tenant_id'), table_name='overlay_tokens')
    op.drop_table('overlay_tokens')
