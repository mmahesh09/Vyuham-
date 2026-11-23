"""data platform wave 2: projects, pipelines, dynamic tables, AI actions, cost settings, governance

Revision ID: a9e4c1d7b350
Revises: d4a8c2e6f1b9
Create Date: 2026-11-23 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a9e4c1d7b350'
down_revision: Union[str, Sequence[str], None] = 'd4a8c2e6f1b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _ws():
    return sa.Column('workspace_id', sa.String(length=32), sa.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False)


def _user(name: str):
    return sa.Column(name, sa.String(length=64), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True)


def _ts(name: str, nullable: bool = True):
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def upgrade() -> None:
    op.create_table(
        'projects',
        sa.Column('id', sa.String(length=32), primary_key=True),
        _ws(),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('description', sa.String(length=500), nullable=True),
        _user('created_by'),
        _ts('created_at', False),
    )
    op.create_index('ix_projects_workspace_id', 'projects', ['workspace_id'])

    with op.batch_alter_table('saved_queries') as batch:
        batch.add_column(sa.Column('project_id', sa.String(length=32), nullable=True))
        batch.add_column(sa.Column('folder', sa.String(length=200), nullable=True))
        batch.create_foreign_key('fk_saved_queries_project', 'projects', ['project_id'], ['id'], ondelete='SET NULL')
        batch.create_index('ix_saved_queries_project_id', ['project_id'])

    with op.batch_alter_table('query_executions') as batch:
        batch.add_column(sa.Column('fingerprint', sa.String(length=16), nullable=True))
        batch.add_column(sa.Column('scanned_bytes', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('dataset_ids', sa.JSON(), nullable=True))
        batch.add_column(sa.Column('ref_kind', sa.String(length=16), nullable=True))
        batch.add_column(sa.Column('ref_id', sa.String(length=32), nullable=True))
        batch.create_index('ix_query_executions_fingerprint', ['fingerprint'])

    op.create_table(
        'pipelines',
        sa.Column('id', sa.String(length=32), primary_key=True),
        _ws(),
        sa.Column('project_id', sa.String(length=32), sa.ForeignKey('projects.id', ondelete='SET NULL'), nullable=True),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('graph', sa.JSON(), nullable=False),
        sa.Column('schedule', sa.String(length=8), nullable=False),
        sa.Column('hour', sa.Integer(), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False),
        sa.Column('generated_by_ai', sa.Boolean(), nullable=False),
        _ts('approved_at'),
        _user('approved_by'),
        _ts('last_run_at'),
        sa.Column('last_status', sa.String(length=10), nullable=True),
        _user('created_by'),
        _ts('created_at', False),
        _ts('updated_at', False),
    )
    op.create_index('ix_pipelines_workspace_id', 'pipelines', ['workspace_id'])
    op.create_index('ix_pipelines_project_id', 'pipelines', ['project_id'])

    op.create_table(
        'pipeline_runs',
        sa.Column('id', sa.String(length=32), primary_key=True),
        _ws(),
        sa.Column('pipeline_id', sa.String(length=32), sa.ForeignKey('pipelines.id', ondelete='CASCADE'), nullable=False),
        sa.Column('trigger', sa.String(length=10), nullable=False),
        sa.Column('status', sa.String(length=10), nullable=False),
        sa.Column('steps', sa.JSON(), nullable=False),
        sa.Column('only_steps', sa.JSON(), nullable=True),
        sa.Column('options', sa.JSON(), nullable=True),
        sa.Column('retry_of', sa.String(length=32), nullable=True),
        sa.Column('error', sa.String(length=1000), nullable=True),
        sa.Column('rows_written', sa.Integer(), nullable=True),
        sa.Column('duration_ms', sa.Integer(), nullable=True),
        sa.Column('graph', sa.JSON(), nullable=True),
        _user('created_by'),
        _ts('created_at', False),
        _ts('started_at'),
        _ts('finished_at'),
    )
    op.create_index('ix_pipeline_runs_workspace_id', 'pipeline_runs', ['workspace_id'])
    op.create_index('ix_pipeline_runs_pipeline_id', 'pipeline_runs', ['pipeline_id'])
    op.create_index('ix_pipeline_runs_created_at', 'pipeline_runs', ['created_at'])

    op.create_table(
        'dynamic_tables',
        sa.Column('id', sa.String(length=32), primary_key=True),
        _ws(),
        sa.Column('project_id', sa.String(length=32), sa.ForeignKey('projects.id', ondelete='SET NULL'), nullable=True),
        sa.Column('dataset_id', sa.String(length=32), sa.ForeignKey('datasets.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('sql', sa.Text(), nullable=False),
        sa.Column('params', sa.JSON(), nullable=False),
        sa.Column('upstream_ids', sa.JSON(), nullable=False),
        sa.Column('interval_minutes', sa.Integer(), nullable=True),
        sa.Column('on_upstream_change', sa.Boolean(), nullable=False),
        sa.Column('refresh_mode', sa.String(length=12), nullable=False),
        sa.Column('watermark_column', sa.String(length=200), nullable=True),
        sa.Column('watermark_value', sa.String(length=64), nullable=True),
        sa.Column('paused', sa.Boolean(), nullable=False),
        sa.Column('status', sa.String(length=12), nullable=False),
        _ts('last_refresh_at'),
        _ts('next_refresh_at'),
        sa.Column('last_error', sa.String(length=1000), nullable=True),
        sa.Column('failures', sa.Integer(), nullable=False),
        sa.Column('schema_hash', sa.String(length=16), nullable=True),
        _user('created_by'),
        _ts('created_at', False),
        _ts('updated_at', False),
    )
    op.create_index('ix_dynamic_tables_workspace_id', 'dynamic_tables', ['workspace_id'])
    op.create_index('ix_dynamic_tables_project_id', 'dynamic_tables', ['project_id'])

    op.create_table(
        'dynamic_refreshes',
        sa.Column('id', sa.String(length=32), primary_key=True),
        _ws(),
        sa.Column('table_id', sa.String(length=32), sa.ForeignKey('dynamic_tables.id', ondelete='CASCADE'), nullable=False),
        sa.Column('trigger', sa.String(length=12), nullable=False),
        sa.Column('mode', sa.String(length=12), nullable=False),
        sa.Column('status', sa.String(length=10), nullable=False),
        sa.Column('attempt', sa.Integer(), nullable=False),
        sa.Column('rows', sa.Integer(), nullable=True),
        sa.Column('rows_added', sa.Integer(), nullable=True),
        sa.Column('duration_ms', sa.Integer(), nullable=True),
        sa.Column('error', sa.String(length=1000), nullable=True),
        sa.Column('schema_change', sa.JSON(), nullable=True),
        _ts('created_at', False),
        _ts('started_at'),
        _ts('finished_at'),
    )
    op.create_index('ix_dynamic_refreshes_workspace_id', 'dynamic_refreshes', ['workspace_id'])
    op.create_index('ix_dynamic_refreshes_table_id', 'dynamic_refreshes', ['table_id'])
    op.create_index('ix_dynamic_refreshes_created_at', 'dynamic_refreshes', ['created_at'])

    op.create_table(
        'ai_actions',
        sa.Column('id', sa.String(length=32), primary_key=True),
        _ws(),
        _user('user_id'),
        sa.Column('kind', sa.String(length=24), nullable=False),
        sa.Column('model', sa.String(length=48), nullable=True),
        sa.Column('status', sa.String(length=12), nullable=False),
        sa.Column('input_tokens', sa.Integer(), nullable=True),
        sa.Column('output_tokens', sa.Integer(), nullable=True),
        sa.Column('duration_ms', sa.Integer(), nullable=True),
        sa.Column('output', sa.JSON(), nullable=True),
        sa.Column('outcome', sa.String(length=16), nullable=True),
        sa.Column('ref_kind', sa.String(length=16), nullable=True),
        sa.Column('ref_id', sa.String(length=32), nullable=True),
        _ts('created_at', False),
    )
    op.create_index('ix_ai_actions_workspace_id', 'ai_actions', ['workspace_id'])
    op.create_index('ix_ai_actions_created_at', 'ai_actions', ['created_at'])

    op.create_table(
        'cost_settings',
        sa.Column('workspace_id', sa.String(length=32), sa.ForeignKey('workspaces.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('currency', sa.String(length=3), nullable=False),
        sa.Column('compute_per_hour', sa.Float(), nullable=False),
        sa.Column('storage_per_gb_month', sa.Float(), nullable=False),
        sa.Column('scan_per_gb', sa.Float(), nullable=False),
        sa.Column('ai_input_per_mtok', sa.Float(), nullable=False),
        sa.Column('ai_output_per_mtok', sa.Float(), nullable=False),
        sa.Column('monthly_budget', sa.Float(), nullable=True),
        sa.Column('alert_threshold_pct', sa.Integer(), nullable=False),
        _ts('updated_at', False),
    )

    op.create_table(
        'column_classifications',
        sa.Column('id', sa.String(length=32), primary_key=True),
        _ws(),
        sa.Column('dataset_id', sa.String(length=32), sa.ForeignKey('datasets.id', ondelete='CASCADE'), nullable=False),
        sa.Column('column', sa.String(length=200), nullable=False),
        sa.Column('label', sa.String(length=14), nullable=False),
        sa.Column('pii_type', sa.String(length=24), nullable=True),
        sa.Column('source', sa.String(length=8), nullable=False),
        sa.Column('confidence', sa.Float(), nullable=True),
        sa.Column('matched', sa.Integer(), nullable=True),
        sa.Column('sampled', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=10), nullable=False),
        _user('updated_by'),
        _ts('updated_at', False),
        sa.UniqueConstraint('dataset_id', 'column', name='uq_column_classification'),
    )
    op.create_index('ix_column_classifications_workspace_id', 'column_classifications', ['workspace_id'])
    op.create_index('ix_column_classifications_dataset_id', 'column_classifications', ['dataset_id'])

    op.create_table(
        'governance_policies',
        sa.Column('id', sa.String(length=32), primary_key=True),
        _ws(),
        sa.Column('kind', sa.String(length=14), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('rules', sa.JSON(), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False),
        _user('created_by'),
        _ts('created_at', False),
        _ts('updated_at', False),
    )
    op.create_index('ix_governance_policies_workspace_id', 'governance_policies', ['workspace_id'])

    op.create_table(
        'access_grants',
        sa.Column('id', sa.String(length=32), primary_key=True),
        _ws(),
        sa.Column('dataset_id', sa.String(length=32), sa.ForeignKey('datasets.id', ondelete='CASCADE'), nullable=False),
        sa.Column('column', sa.String(length=200), nullable=False),
        sa.Column('role', sa.String(length=10), nullable=False),
        sa.Column('access', sa.String(length=8), nullable=False),
        _user('created_by'),
        _ts('created_at', False),
        sa.UniqueConstraint('dataset_id', 'column', 'role', name='uq_access_grant'),
    )
    op.create_index('ix_access_grants_workspace_id', 'access_grants', ['workspace_id'])
    op.create_index('ix_access_grants_dataset_id', 'access_grants', ['dataset_id'])


def downgrade() -> None:
    for t in ('access_grants', 'governance_policies', 'column_classifications', 'cost_settings', 'ai_actions',
              'dynamic_refreshes', 'dynamic_tables', 'pipeline_runs', 'pipelines'):
        op.drop_table(t)
    with op.batch_alter_table('query_executions') as batch:
        batch.drop_index('ix_query_executions_fingerprint')
        for c in ('ref_id', 'ref_kind', 'dataset_ids', 'scanned_bytes', 'fingerprint'):
            batch.drop_column(c)
    with op.batch_alter_table('saved_queries') as batch:
        batch.drop_index('ix_saved_queries_project_id')
        batch.drop_constraint('fk_saved_queries_project', type_='foreignkey')
        batch.drop_column('folder')
        batch.drop_column('project_id')
    op.drop_index('ix_projects_workspace_id', 'projects')
    op.drop_table('projects')
