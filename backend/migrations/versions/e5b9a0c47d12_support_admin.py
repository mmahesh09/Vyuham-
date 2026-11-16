"""Support admin: error triage fields, app version on events, audit log

Revision ID: e5b9a0c47d12
Revises: d81f3c5a2b67
Create Date: 2026-11-16 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5b9a0c47d12'
down_revision: Union[str, None] = 'd81f3c5a2b67'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('support_error_groups') as b:
        b.add_column(sa.Column('status', sa.String(10), nullable=False, server_default='open'))
        b.add_column(sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True))
        b.add_column(sa.Column('resolved_by', sa.String(64), nullable=True))
        b.add_column(sa.Column('resolution_note', sa.String(1000), nullable=True))
        b.add_column(sa.Column('regressed_at', sa.DateTime(timezone=True), nullable=True))
        b.add_column(sa.Column('chatwoot_conversation_id', sa.Integer(), nullable=True))
        b.create_index('ix_support_error_groups_status', ['status'])
    with op.batch_alter_table('support_error_events') as b:
        b.add_column(sa.Column('app_version', sa.String(80), nullable=True))
        b.create_index('ix_support_error_events_app_version', ['app_version'])

    op.create_table(
        'support_audit_log',
        sa.Column('id', sa.String(32), primary_key=True),
        sa.Column('actor_id', sa.String(64), nullable=False),
        sa.Column('actor_email', sa.String(320), nullable=False),
        sa.Column('actor_role', sa.String(10), nullable=False),
        sa.Column('action', sa.String(40), nullable=False),
        sa.Column('target_type', sa.String(20), nullable=False),
        sa.Column('target_id', sa.String(32), nullable=False),
        sa.Column('workspace_id', sa.String(32), nullable=True),
        sa.Column('changes', sa.JSON(), nullable=False),
        sa.Column('note', sa.String(1000), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_support_audit_log_action', 'support_audit_log', ['action'])
    op.create_index('ix_support_audit_log_target_id', 'support_audit_log', ['target_id'])
    op.create_index('ix_support_audit_log_created_at', 'support_audit_log', ['created_at'])


def downgrade() -> None:
    op.drop_table('support_audit_log')
    with op.batch_alter_table('support_error_events') as b:
        b.drop_index('ix_support_error_events_app_version')
        b.drop_column('app_version')
    with op.batch_alter_table('support_error_groups') as b:
        b.drop_index('ix_support_error_groups_status')
        for col in ('chatwoot_conversation_id', 'regressed_at', 'resolution_note', 'resolved_by', 'resolved_at', 'status'):
            b.drop_column(col)
