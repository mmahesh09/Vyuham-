"""database connections: Postgres/MySQL sources that datasets sync from

Revision ID: 9e2a6c1d5b38
Revises: 8d5f2b3c4e71
Create Date: 2026-11-17 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9e2a6c1d5b38'
down_revision: Union[str, None] = '8d5f2b3c4e71'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('connections',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('workspace_id', sa.String(length=32), nullable=False),
    sa.Column('created_by', sa.String(length=64), nullable=True),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('host', sa.String(length=255), nullable=False),
    sa.Column('port', sa.Integer(), nullable=False),
    sa.Column('database', sa.String(length=255), nullable=False),
    sa.Column('username', sa.String(length=255), nullable=False),
    sa.Column('secret_enc', sa.Text(), nullable=False),
    sa.Column('ssl_mode', sa.String(length=16), nullable=False),
    sa.Column('status', sa.String(length=8), nullable=False),
    sa.Column('last_error', sa.String(length=500), nullable=True),
    sa.Column('last_checked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['user.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('workspace_id', 'name')
    )
    with op.batch_alter_table('connections', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_connections_workspace_id'), ['workspace_id'], unique=False)

    with op.batch_alter_table('datasets', schema=None) as batch_op:
        batch_op.add_column(sa.Column('connection_id', sa.String(length=32), nullable=True))
        batch_op.add_column(sa.Column('source_table', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('source_query', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('refresh', sa.String(length=8), nullable=True))
        batch_op.add_column(sa.Column('last_synced_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column('sync_error', sa.String(length=500), nullable=True))
        batch_op.create_index(batch_op.f('ix_datasets_connection_id'), ['connection_id'], unique=False)
        batch_op.create_foreign_key('fk_datasets_connection_id', 'connections', ['connection_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('datasets', schema=None) as batch_op:
        batch_op.drop_constraint('fk_datasets_connection_id', type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_datasets_connection_id'))
        batch_op.drop_column('sync_error')
        batch_op.drop_column('last_synced_at')
        batch_op.drop_column('refresh')
        batch_op.drop_column('source_query')
        batch_op.drop_column('source_table')
        batch_op.drop_column('connection_id')

    with op.batch_alter_table('connections', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_connections_workspace_id'))
    op.drop_table('connections')
