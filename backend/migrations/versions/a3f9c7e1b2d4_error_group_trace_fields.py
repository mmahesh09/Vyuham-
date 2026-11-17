"""error groups: release, module and last trace id (groundwork for error intelligence)

Revision ID: a3f9c7e1b2d4
Revises: 8d5f2b3c4e71
Create Date: 2026-11-18 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3f9c7e1b2d4'
down_revision: Union[str, None] = '8d5f2b3c4e71'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('error_groups', schema=None) as batch_op:
        batch_op.add_column(sa.Column('release', sa.String(length=100), nullable=True))
        batch_op.add_column(sa.Column('module', sa.String(length=200), nullable=True))
        batch_op.add_column(sa.Column('last_trace_id', sa.String(length=32), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('error_groups', schema=None) as batch_op:
        batch_op.drop_column('last_trace_id')
        batch_op.drop_column('module')
        batch_op.drop_column('release')
