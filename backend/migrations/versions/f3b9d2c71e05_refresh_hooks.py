"""refresh hooks: secret URLs customers' pipelines call to refresh connected datasets

Revision ID: f3b9d2c71e05
Revises: e1a7c3f09b42
Create Date: 2026-11-20 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f3b9d2c71e05'
down_revision: Union[str, Sequence[str], None] = 'e1a7c3f09b42'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'refresh_hooks',
        sa.Column('id', sa.String(length=32), primary_key=True),
        sa.Column('workspace_id', sa.String(length=32), sa.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('dataset_ids', sa.JSON(), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('token_hint', sa.String(length=8), nullable=False),
        sa.Column('created_by', sa.String(length=64), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_called_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('token_hash', name='uq_refresh_hooks_token_hash'),
    )
    op.create_index('ix_refresh_hooks_workspace_id', 'refresh_hooks', ['workspace_id'])


def downgrade() -> None:
    op.drop_index('ix_refresh_hooks_workspace_id', table_name='refresh_hooks')
    op.drop_table('refresh_hooks')
