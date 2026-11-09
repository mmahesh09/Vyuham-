"""job runs (background job claims and history)

Revision ID: 4f1c2a7d9e30
Revises: 99e5cc0ebb87
Create Date: 2026-11-09 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4f1c2a7d9e30'
down_revision: Union[str, None] = '99e5cc0ebb87'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('job_runs',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('target_id', sa.String(length=32), nullable=False),
    sa.Column('scheduled_for', sa.DateTime(timezone=True), nullable=False),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('error', sa.String(length=500), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('kind', 'target_id', 'scheduled_for', name='uq_job_runs_slot')
    )
    with op.batch_alter_table('job_runs', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_job_runs_target_id'), ['target_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_job_runs_created_at'), ['created_at'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('job_runs', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_job_runs_created_at'))
        batch_op.drop_index(batch_op.f('ix_job_runs_target_id'))
    op.drop_table('job_runs')
