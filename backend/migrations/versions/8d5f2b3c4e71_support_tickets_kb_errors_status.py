"""support tickets, help center, error groups and status page

Revision ID: 8d5f2b3c4e71
Revises: 7c4e1a9b2d60
Create Date: 2026-11-17 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8d5f2b3c4e71'
down_revision: Union[str, None] = '7c4e1a9b2d60'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Same expression as app/kb_search.py PG_DOC, so Postgres full-text search can use the index.
PG_DOC = "to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(body,''))"


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('kb_articles',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('slug', sa.String(length=120), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('summary', sa.String(length=300), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('tags', sa.JSON(), nullable=False),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('source_ticket_id', sa.String(length=32), nullable=True),
    sa.Column('views', sa.Integer(), nullable=False),
    sa.Column('helpful_yes', sa.Integer(), nullable=False),
    sa.Column('helpful_no', sa.Integer(), nullable=False),
    sa.Column('created_by', sa.String(length=64), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['created_by'], ['user.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('slug')
    )
    with op.batch_alter_table('kb_articles', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_kb_articles_status'), ['status'], unique=False)

    op.create_table('error_groups',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('glitchtip_issue_id', sa.String(length=64), nullable=False),
    sa.Column('title', sa.String(length=300), nullable=False),
    sa.Column('culprit', sa.String(length=300), nullable=True),
    sa.Column('level', sa.String(length=16), nullable=False),
    sa.Column('url', sa.String(length=500), nullable=True),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('count', sa.Integer(), nullable=False),
    sa.Column('kb_article_id', sa.String(length=32), nullable=True),
    sa.Column('first_seen', sa.DateTime(timezone=True), nullable=False),
    sa.Column('last_seen', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['kb_article_id'], ['kb_articles.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('glitchtip_issue_id')
    )
    with op.batch_alter_table('error_groups', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_error_groups_status'), ['status'], unique=False)

    op.create_table('support_tickets',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('workspace_id', sa.String(length=32), nullable=False),
    sa.Column('user_id', sa.String(length=64), nullable=True),
    sa.Column('subject', sa.String(length=200), nullable=False),
    sa.Column('category', sa.String(length=16), nullable=False),
    sa.Column('priority', sa.String(length=8), nullable=False),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('error_event_id', sa.String(length=64), nullable=True),
    sa.Column('error_group_id', sa.String(length=32), nullable=True),
    sa.Column('kb_article_id', sa.String(length=32), nullable=True),
    sa.Column('page_url', sa.String(length=500), nullable=True),
    sa.Column('user_agent', sa.String(length=300), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('first_response_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['error_group_id'], ['error_groups.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['kb_article_id'], ['kb_articles.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('support_tickets', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_support_tickets_workspace_id'), ['workspace_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_support_tickets_user_id'), ['user_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_support_tickets_status'), ['status'], unique=False)
        batch_op.create_index(batch_op.f('ix_support_tickets_created_at'), ['created_at'], unique=False)

    op.create_table('ticket_messages',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('ticket_id', sa.String(length=32), nullable=False),
    sa.Column('author_id', sa.String(length=64), nullable=True),
    sa.Column('author_name', sa.String(length=200), nullable=False),
    sa.Column('is_staff', sa.Boolean(), nullable=False),
    sa.Column('internal', sa.Boolean(), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['author_id'], ['user.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['ticket_id'], ['support_tickets.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('ticket_messages', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_ticket_messages_ticket_id'), ['ticket_id'], unique=False)

    op.create_table('kb_deflections',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('article_id', sa.String(length=32), nullable=False),
    sa.Column('user_id', sa.String(length=64), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['article_id'], ['kb_articles.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('kb_deflections', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_kb_deflections_created_at'), ['created_at'], unique=False)

    op.create_table('status_checks',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('component', sa.String(length=32), nullable=False),
    sa.Column('ok', sa.Boolean(), nullable=False),
    sa.Column('latency_ms', sa.Integer(), nullable=True),
    sa.Column('checked_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('status_checks', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_status_checks_checked_at'), ['checked_at'], unique=False)

    op.create_table('incidents',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('impact', sa.String(length=12), nullable=False),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('components', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('incidents', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_incidents_created_at'), ['created_at'], unique=False)

    op.create_table('incident_updates',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('incident_id', sa.String(length=32), nullable=False),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('message', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['incident_id'], ['incidents.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('incident_updates', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_incident_updates_incident_id'), ['incident_id'], unique=False)

    if op.get_bind().dialect.name == 'postgresql':
        op.execute(f"CREATE INDEX ix_kb_articles_fts ON kb_articles USING gin ({PG_DOC})")


def downgrade() -> None:
    """Downgrade schema."""
    if op.get_bind().dialect.name == 'postgresql':
        op.execute("DROP INDEX IF EXISTS ix_kb_articles_fts")
    for table, indexes in [
        ('incident_updates', ['ix_incident_updates_incident_id']),
        ('incidents', ['ix_incidents_created_at']),
        ('status_checks', ['ix_status_checks_checked_at']),
        ('kb_deflections', ['ix_kb_deflections_created_at']),
        ('ticket_messages', ['ix_ticket_messages_ticket_id']),
        ('support_tickets', ['ix_support_tickets_created_at', 'ix_support_tickets_status', 'ix_support_tickets_user_id', 'ix_support_tickets_workspace_id']),
        ('error_groups', ['ix_error_groups_status']),
        ('kb_articles', ['ix_kb_articles_status']),
    ]:
        with op.batch_alter_table(table, schema=None) as batch_op:
            for ix in indexes:
                batch_op.drop_index(ix)
        op.drop_table(table)
