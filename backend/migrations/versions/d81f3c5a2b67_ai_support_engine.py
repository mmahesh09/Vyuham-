"""AI support engine: errors, knowledge, embeddings (pgvector), sessions, jobs

Revision ID: d81f3c5a2b67
Revises: c4a7e2f19d30
Create Date: 2026-11-16 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.support_ai.models import EMBEDDING_DIM, Vector


# revision identifiers, used by Alembic.
revision: str = 'd81f3c5a2b67'
down_revision: Union[str, None] = 'c4a7e2f19d30'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _ts(name: str, nullable: bool = False) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def upgrade() -> None:
    is_pg = op.get_bind().dialect.name == "postgresql"
    if is_pg:
        # Needs the pgvector extension installed on the server (e.g. the pgvector/pgvector image,
        # or Supabase/most managed Postgres, where it is available to enable).
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        'support_error_groups',
        sa.Column('id', sa.String(32), primary_key=True),
        sa.Column('workspace_id', sa.String(32), sa.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False),
        sa.Column('fingerprint', sa.String(64), nullable=False),
        sa.Column('module', sa.String(32), nullable=False),
        sa.Column('category', sa.String(48), nullable=False),
        sa.Column('error_type', sa.String(120), nullable=False),
        sa.Column('normalized_message', sa.String(500), nullable=False),
        sa.Column('sample_message', sa.String(2000), nullable=False),
        sa.Column('count', sa.Integer(), nullable=False),
        _ts('first_seen'), _ts('last_seen'),
        sa.UniqueConstraint('workspace_id', 'fingerprint', name='uq_support_error_group'),
    )
    op.create_index('ix_support_error_groups_workspace_id', 'support_error_groups', ['workspace_id'])
    op.create_index('ix_support_error_groups_fingerprint', 'support_error_groups', ['fingerprint'])

    op.create_table(
        'support_error_events',
        sa.Column('id', sa.String(32), primary_key=True),
        sa.Column('workspace_id', sa.String(32), sa.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False),
        sa.Column('group_id', sa.String(32), sa.ForeignKey('support_error_groups.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.String(64), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
        sa.Column('message', sa.String(2000), nullable=False),
        sa.Column('details', sa.JSON(), nullable=False),
        _ts('created_at'),
    )
    for col in ('workspace_id', 'group_id', 'user_id', 'created_at'):
        op.create_index(f'ix_support_error_events_{col}', 'support_error_events', [col])

    op.create_table(
        'knowledge_articles',
        sa.Column('id', sa.String(32), primary_key=True),
        sa.Column('scope', sa.String(8), nullable=False),
        sa.Column('workspace_id', sa.String(32), sa.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=True),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('symptoms', sa.Text(), nullable=False),
        sa.Column('root_cause', sa.Text(), nullable=False),
        sa.Column('resolution', sa.Text(), nullable=False),
        sa.Column('modules', sa.JSON(), nullable=False),
        sa.Column('categories', sa.JSON(), nullable=False),
        sa.Column('fingerprints', sa.JSON(), nullable=False),
        sa.Column('status', sa.String(10), nullable=False),
        sa.Column('tested', sa.Boolean(), nullable=False),
        sa.Column('test_notes', sa.Text(), nullable=True),
        sa.Column('source', sa.String(24), nullable=False),
        sa.Column('source_ref', sa.String(32), nullable=True),
        sa.Column('helpful_count', sa.Integer(), nullable=False),
        sa.Column('unhelpful_count', sa.Integer(), nullable=False),
        sa.Column('created_by', sa.String(64), nullable=True),
        sa.Column('reviewed_by', sa.String(64), nullable=True),
        _ts('reviewed_at', nullable=True),
        sa.Column('review_note', sa.String(1000), nullable=True),
        _ts('created_at'), _ts('updated_at'),
        sa.CheckConstraint("(scope = 'global' AND workspace_id IS NULL) OR (scope = 'tenant' AND workspace_id IS NOT NULL)", name='ck_knowledge_scope_workspace'),
        sa.CheckConstraint("status IN ('pending', 'approved', 'rejected', 'archived')", name='ck_knowledge_status'),
        sa.CheckConstraint("status <> 'approved' OR tested", name='ck_knowledge_approved_is_tested'),
    )
    op.create_index('ix_knowledge_articles_workspace_id', 'knowledge_articles', ['workspace_id'])
    op.create_index('ix_knowledge_articles_status', 'knowledge_articles', ['status'])

    op.create_table(
        'knowledge_embeddings',
        sa.Column('article_id', sa.String(32), sa.ForeignKey('knowledge_articles.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('model', sa.String(64), nullable=False),
        sa.Column('content_hash', sa.String(64), nullable=False),
        sa.Column('embedding', Vector(EMBEDDING_DIM), nullable=False),
        _ts('created_at'),
    )
    if is_pg:
        op.execute("CREATE INDEX ix_knowledge_embeddings_hnsw ON knowledge_embeddings USING hnsw (embedding vector_cosine_ops)")
    else:  # SQLite (development): no vector index; a plain one keeps the schema in step with the models
        op.create_index('ix_knowledge_embeddings_hnsw', 'knowledge_embeddings', ['embedding'])

    op.create_table(
        'support_ai_sessions',
        sa.Column('id', sa.String(32), primary_key=True),
        sa.Column('thread_id', sa.String(32), nullable=False),
        sa.Column('workspace_id', sa.String(32), sa.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.String(64), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
        sa.Column('module', sa.String(32), nullable=False),
        sa.Column('question', sa.String(2000), nullable=False),
        sa.Column('error_group_id', sa.String(32), sa.ForeignKey('support_error_groups.id', ondelete='SET NULL'), nullable=True),
        sa.Column('context', sa.JSON(), nullable=False),
        sa.Column('status', sa.String(10), nullable=False),
        sa.Column('answer', sa.JSON(), nullable=True),
        sa.Column('model', sa.String(64), nullable=True),
        sa.Column('usage', sa.JSON(), nullable=False),
        sa.Column('failure', sa.String(300), nullable=True),
        sa.Column('feedback', sa.String(10), nullable=True),
        sa.Column('feedback_comment', sa.String(1000), nullable=True),
        _ts('feedback_at', nullable=True),
        sa.Column('escalated_conversation_id', sa.Integer(), nullable=True),
        _ts('escalated_at', nullable=True),
        _ts('created_at'),
        _ts('answered_at', nullable=True),
    )
    for col in ('thread_id', 'workspace_id', 'user_id', 'created_at'):
        op.create_index(f'ix_support_ai_sessions_{col}', 'support_ai_sessions', [col])

    op.create_table(
        'support_ai_references',
        sa.Column('session_id', sa.String(32), sa.ForeignKey('support_ai_sessions.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('article_id', sa.String(32), sa.ForeignKey('knowledge_articles.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('rank', sa.Integer(), nullable=False),
        sa.Column('score', sa.Float(), nullable=False),
        sa.Column('scope', sa.String(8), nullable=False),
        sa.Column('cited', sa.Boolean(), nullable=False),
    )

    op.create_table(
        'support_jobs',
        sa.Column('id', sa.String(32), primary_key=True),
        sa.Column('kind', sa.String(24), nullable=False),
        sa.Column('ref_id', sa.String(32), nullable=False),
        sa.Column('status', sa.String(10), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False),
        _ts('run_after'),
        sa.Column('last_error', sa.String(500), nullable=True),
        _ts('created_at'), _ts('updated_at'),
    )
    op.create_index('ix_support_jobs_status', 'support_jobs', ['status'])
    op.create_index('ix_support_jobs_run_after', 'support_jobs', ['run_after'])


def downgrade() -> None:
    for table in ('support_jobs', 'support_ai_references', 'support_ai_sessions', 'knowledge_embeddings', 'knowledge_articles', 'support_error_events', 'support_error_groups'):
        op.drop_table(table)
