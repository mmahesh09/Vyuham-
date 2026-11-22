"""support ticket attachments

Revision ID: b8e3f1a4c9d2
Revises: a7c41e9d2b6f
Create Date: 2026-11-22 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b8e3f1a4c9d2'
down_revision: Union[str, Sequence[str], None] = 'a7c41e9d2b6f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'ticket_attachments',
        sa.Column('id', sa.String(length=32), nullable=False),
        sa.Column('workspace_id', sa.String(length=32), nullable=False),
        sa.Column('uploader_id', sa.String(length=64), nullable=True),
        sa.Column('ticket_id', sa.String(length=32), nullable=True),
        sa.Column('message_id', sa.String(length=32), nullable=True),
        sa.Column('filename', sa.String(length=200), nullable=False),
        sa.Column('content_type', sa.String(length=100), nullable=False),
        sa.Column('size', sa.Integer(), nullable=False),
        sa.Column('storage_key', sa.String(length=200), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['uploader_id'], ['user.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['ticket_id'], ['support_tickets.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['message_id'], ['ticket_messages.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_ticket_attachments_workspace_id', 'ticket_attachments', ['workspace_id'])
    op.create_index('ix_ticket_attachments_ticket_id', 'ticket_attachments', ['ticket_id'])
    op.create_index('ix_ticket_attachments_message_id', 'ticket_attachments', ['message_id'])
    op.create_index('ix_ticket_attachments_created_at', 'ticket_attachments', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_ticket_attachments_created_at', table_name='ticket_attachments')
    op.drop_index('ix_ticket_attachments_message_id', table_name='ticket_attachments')
    op.drop_index('ix_ticket_attachments_ticket_id', table_name='ticket_attachments')
    op.drop_index('ix_ticket_attachments_workspace_id', table_name='ticket_attachments')
    op.drop_table('ticket_attachments')
