"""data platform wave 1: dataset layers and origin, lineage, quality rules

Revision ID: d4a8c2e6f1b9
Revises: c2f7a9d4e1b3
Create Date: 2026-11-23 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd4a8c2e6f1b9'
down_revision: Union[str, Sequence[str], None] = 'c2f7a9d4e1b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('datasets') as batch:
        batch.alter_column('source_kind', existing_type=sa.String(length=8), type_=sa.String(length=16), existing_nullable=False)
        batch.add_column(sa.Column('layer', sa.String(length=8), nullable=True))
        batch.add_column(sa.Column('description', sa.String(length=500), nullable=True))
        batch.add_column(sa.Column('origin', sa.JSON(), nullable=True))

    op.create_table(
        'lineage_edges',
        sa.Column('id', sa.String(length=32), nullable=False),
        sa.Column('workspace_id', sa.String(length=32), nullable=False),
        sa.Column('from_kind', sa.String(length=16), nullable=False),
        sa.Column('from_id', sa.String(length=32), nullable=False),
        sa.Column('to_kind', sa.String(length=16), nullable=False),
        sa.Column('to_id', sa.String(length=32), nullable=False),
        sa.Column('via', sa.String(length=16), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('from_kind', 'from_id', 'to_kind', 'to_id', name='uq_lineage_edge'),
    )
    op.create_index('ix_lineage_edges_workspace_id', 'lineage_edges', ['workspace_id'])
    op.create_index('ix_lineage_edges_from_id', 'lineage_edges', ['from_id'])
    op.create_index('ix_lineage_edges_to_id', 'lineage_edges', ['to_id'])

    op.create_table(
        'quality_rules',
        sa.Column('id', sa.String(length=32), nullable=False),
        sa.Column('workspace_id', sa.String(length=32), nullable=False),
        sa.Column('dataset_id', sa.String(length=32), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('column', sa.String(length=255), nullable=True),
        sa.Column('params', sa.JSON(), nullable=False),
        sa.Column('severity', sa.String(length=8), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False),
        sa.Column('created_by', sa.String(length=64), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['dataset_id'], ['datasets.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['user.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_quality_rules_workspace_id', 'quality_rules', ['workspace_id'])
    op.create_index('ix_quality_rules_dataset_id', 'quality_rules', ['dataset_id'])

    op.create_table(
        'quality_runs',
        sa.Column('id', sa.String(length=32), nullable=False),
        sa.Column('workspace_id', sa.String(length=32), nullable=False),
        sa.Column('dataset_id', sa.String(length=32), nullable=False),
        sa.Column('trigger', sa.String(length=10), nullable=False),
        sa.Column('status', sa.String(length=8), nullable=False),
        sa.Column('results', sa.JSON(), nullable=False),
        sa.Column('row_count', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['dataset_id'], ['datasets.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_quality_runs_workspace_id', 'quality_runs', ['workspace_id'])
    op.create_index('ix_quality_runs_dataset_id', 'quality_runs', ['dataset_id'])
    op.create_index('ix_quality_runs_created_at', 'quality_runs', ['created_at'])


def downgrade() -> None:
    for name in ('ix_quality_runs_created_at', 'ix_quality_runs_dataset_id', 'ix_quality_runs_workspace_id'):
        op.drop_index(name, table_name='quality_runs')
    op.drop_table('quality_runs')
    op.drop_index('ix_quality_rules_dataset_id', table_name='quality_rules')
    op.drop_index('ix_quality_rules_workspace_id', table_name='quality_rules')
    op.drop_table('quality_rules')
    for name in ('ix_lineage_edges_to_id', 'ix_lineage_edges_from_id', 'ix_lineage_edges_workspace_id'):
        op.drop_index(name, table_name='lineage_edges')
    op.drop_table('lineage_edges')
    with op.batch_alter_table('datasets') as batch:
        batch.drop_column('origin')
        batch.drop_column('description')
        batch.drop_column('layer')
        batch.alter_column('source_kind', existing_type=sa.String(length=16), type_=sa.String(length=8), existing_nullable=False)
