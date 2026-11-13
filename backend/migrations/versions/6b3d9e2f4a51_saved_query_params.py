"""saved query params

Revision ID: 6b3d9e2f4a51
Revises: 5a2b8c1d3e40
Create Date: 2026-11-13 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6b3d9e2f4a51'
down_revision: Union[str, None] = '5a2b8c1d3e40'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('saved_queries') as batch:
        batch.add_column(sa.Column('params', sa.JSON(), server_default='[]', nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('saved_queries') as batch:
        batch.drop_column('params')
