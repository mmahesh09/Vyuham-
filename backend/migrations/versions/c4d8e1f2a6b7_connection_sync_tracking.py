"""merge the connections and SQL Lab branches; track sync attempts separately from successes

Revision ID: c4d8e1f2a6b7
Revises: 9e2a6c1d5b38, b7d2e4f6a8c1
Create Date: 2026-11-19 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4d8e1f2a6b7'
down_revision: Union[str, Sequence[str], None] = ('9e2a6c1d5b38', 'b7d2e4f6a8c1')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('datasets') as batch:
        batch.add_column(sa.Column('sync_started_at', sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column('sync_finished_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('datasets') as batch:
        batch.drop_column('sync_finished_at')
        batch.drop_column('sync_started_at')
