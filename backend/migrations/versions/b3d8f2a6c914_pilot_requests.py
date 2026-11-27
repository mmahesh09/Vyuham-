"""pilot requests from the website

Revision ID: b3d8f2a6c914
Revises: a9e4c1d7b350
Create Date: 2026-11-24 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b3d8f2a6c914'
down_revision: Union[str, Sequence[str], None] = 'a9e4c1d7b350'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'pilot_requests',
        sa.Column('id', sa.String(length=32), primary_key=True),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('email', sa.String(length=254), nullable=False),
        sa.Column('company', sa.String(length=160), nullable=False),
        sa.Column('database', sa.String(length=10), nullable=False),
        sa.Column('team_size', sa.String(length=10), nullable=False),
        sa.Column('need', sa.Text(), nullable=False),
        sa.Column('status', sa.String(length=10), nullable=False),
        sa.Column('note', sa.String(length=1000), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_pilot_requests_email', 'pilot_requests', ['email'])
    op.create_index('ix_pilot_requests_status', 'pilot_requests', ['status'])
    op.create_index('ix_pilot_requests_created_at', 'pilot_requests', ['created_at'])


def downgrade() -> None:
    op.drop_table('pilot_requests')
