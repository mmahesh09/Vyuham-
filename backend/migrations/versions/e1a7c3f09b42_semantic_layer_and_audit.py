"""semantic layer (metrics, versions, tests, dimensions, calculated columns) and audit trails

Revision ID: e1a7c3f09b42
Revises: c4d8e1f2a6b7
Create Date: 2026-11-19 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e1a7c3f09b42'
down_revision: Union[str, Sequence[str], None] = 'c4d8e1f2a6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_now = sa.DateTime(timezone=True)


def _workspace() -> sa.Column:
    return sa.Column('workspace_id', sa.String(length=32), sa.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False)


def _user(name: str) -> sa.Column:
    return sa.Column(name, sa.String(length=64), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True)


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'semantic_metrics',
        sa.Column('id', sa.String(length=32), primary_key=True),
        _workspace(),
        sa.Column('dataset_id', sa.String(length=32), sa.ForeignKey('datasets.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('description', sa.String(length=1000), nullable=True),
        sa.Column('format', sa.String(length=12), nullable=False),
        sa.Column('currency', sa.String(length=3), nullable=True),
        sa.Column('unit', sa.String(length=24), nullable=True),
        sa.Column('default_date_column', sa.String(length=255), nullable=True),
        sa.Column('synonyms', sa.JSON(), nullable=False),
        _user('owner_id'),
        sa.Column('approved_version', sa.Integer(), nullable=True),
        _user('created_by'),
        sa.Column('created_at', _now, nullable=False),
        sa.Column('updated_at', _now, nullable=False),
        sa.UniqueConstraint('workspace_id', 'name', name='uq_semantic_metrics_name'),
    )
    op.create_index('ix_semantic_metrics_workspace_id', 'semantic_metrics', ['workspace_id'])
    op.create_index('ix_semantic_metrics_dataset_id', 'semantic_metrics', ['dataset_id'])

    op.create_table(
        'metric_versions',
        sa.Column('id', sa.String(length=32), primary_key=True),
        sa.Column('metric_id', sa.String(length=32), sa.ForeignKey('semantic_metrics.id', ondelete='CASCADE'), nullable=False),
        _workspace(),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('formula', sa.Text(), nullable=False),
        sa.Column('effective_from', sa.Date(), nullable=False),
        sa.Column('note', sa.String(length=300), nullable=True),
        _user('created_by'),
        sa.Column('created_at', _now, nullable=False),
        sa.UniqueConstraint('metric_id', 'version', name='uq_metric_versions_number'),
    )
    op.create_index('ix_metric_versions_metric_id', 'metric_versions', ['metric_id'])
    op.create_index('ix_metric_versions_workspace_id', 'metric_versions', ['workspace_id'])

    op.create_table(
        'metric_tests',
        sa.Column('id', sa.String(length=32), primary_key=True),
        sa.Column('metric_id', sa.String(length=32), sa.ForeignKey('semantic_metrics.id', ondelete='CASCADE'), nullable=False),
        _workspace(),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('filters', sa.JSON(), nullable=False),
        sa.Column('expected', sa.Float(), nullable=True),
        sa.Column('tolerance', sa.Float(), nullable=False),
        sa.Column('created_at', _now, nullable=False),
    )
    op.create_index('ix_metric_tests_metric_id', 'metric_tests', ['metric_id'])
    op.create_index('ix_metric_tests_workspace_id', 'metric_tests', ['workspace_id'])

    op.create_table(
        'semantic_dimensions',
        sa.Column('id', sa.String(length=32), primary_key=True),
        _workspace(),
        sa.Column('dataset_id', sa.String(length=32), sa.ForeignKey('datasets.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('column', sa.String(length=255), nullable=False),
        sa.Column('description', sa.String(length=1000), nullable=True),
        sa.Column('synonyms', sa.JSON(), nullable=False),
        _user('created_by'),
        sa.Column('created_at', _now, nullable=False),
        sa.UniqueConstraint('workspace_id', 'name', name='uq_semantic_dimensions_name'),
    )
    op.create_index('ix_semantic_dimensions_workspace_id', 'semantic_dimensions', ['workspace_id'])

    op.create_table(
        'calculated_columns',
        sa.Column('id', sa.String(length=32), primary_key=True),
        _workspace(),
        sa.Column('dataset_id', sa.String(length=32), sa.ForeignKey('datasets.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('formula', sa.Text(), nullable=False),
        sa.Column('type', sa.String(length=12), nullable=True),
        sa.Column('error', sa.String(length=500), nullable=True),
        _user('created_by'),
        sa.Column('created_at', _now, nullable=False),
        sa.UniqueConstraint('dataset_id', 'name', name='uq_calculated_columns_name'),
    )
    op.create_index('ix_calculated_columns_workspace_id', 'calculated_columns', ['workspace_id'])
    op.create_index('ix_calculated_columns_dataset_id', 'calculated_columns', ['dataset_id'])

    op.create_table(
        'query_executions',
        sa.Column('id', sa.String(length=32), primary_key=True),
        _workspace(),
        _user('user_id'),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('status', sa.String(length=10), nullable=False),
        sa.Column('rows', sa.Integer(), nullable=True),
        sa.Column('duration_ms', sa.Integer(), nullable=False),
        sa.Column('created_at', _now, nullable=False),
    )
    op.create_index('ix_query_executions_workspace_id', 'query_executions', ['workspace_id'])
    op.create_index('ix_query_executions_created_at', 'query_executions', ['created_at'])

    op.create_table(
        'audit_logs',
        sa.Column('id', sa.String(length=32), primary_key=True),
        _workspace(),
        _user('user_id'),
        sa.Column('action', sa.String(length=40), nullable=False),
        sa.Column('target_type', sa.String(length=24), nullable=False),
        sa.Column('target_id', sa.String(length=64), nullable=True),
        sa.Column('detail', sa.JSON(), nullable=False),
        sa.Column('created_at', _now, nullable=False),
    )
    op.create_index('ix_audit_logs_workspace_id', 'audit_logs', ['workspace_id'])
    op.create_index('ix_audit_logs_created_at', 'audit_logs', ['created_at'])


def downgrade() -> None:
    """Downgrade schema."""
    for table in ('audit_logs', 'query_executions', 'calculated_columns', 'semantic_dimensions', 'metric_tests', 'metric_versions', 'semantic_metrics'):
        op.drop_table(table)
