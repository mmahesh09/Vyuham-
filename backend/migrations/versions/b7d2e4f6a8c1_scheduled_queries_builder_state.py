"""scheduled saved queries (automations.saved_query_id, options) and the SQL Lab builder state

Revision ID: b7d2e4f6a8c1
Revises: a3f9c7e1b2d4
Create Date: 2026-11-18 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7d2e4f6a8c1'
down_revision: Union[str, None] = 'a3f9c7e1b2d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('automations', schema=None) as batch_op:
        batch_op.add_column(sa.Column('saved_query_id', sa.String(length=32), nullable=True))
        batch_op.add_column(sa.Column('options', sa.JSON(), nullable=True))
        batch_op.create_index(batch_op.f('ix_automations_saved_query_id'), ['saved_query_id'], unique=False)
        batch_op.create_foreign_key('fk_automations_saved_query_id', 'saved_queries', ['saved_query_id'], ['id'], ondelete='CASCADE')

    with op.batch_alter_table('saved_queries', schema=None) as batch_op:
        batch_op.add_column(sa.Column('builder_state', sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('saved_queries', schema=None) as batch_op:
        batch_op.drop_column('builder_state')

    with op.batch_alter_table('automations', schema=None) as batch_op:
        batch_op.drop_constraint('fk_automations_saved_query_id', type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_automations_saved_query_id'))
        batch_op.drop_column('options')
        batch_op.drop_column('saved_query_id')
