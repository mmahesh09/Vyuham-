"""Chatwoot webhook deliveries (de-duplication)

Revision ID: c4a7e2f19d30
Revises: 99e5cc0ebb87
Create Date: 2026-11-16 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4a7e2f19d30'
down_revision: Union[str, None] = '99e5cc0ebb87'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'chatwoot_webhook_deliveries',
        sa.Column('delivery_id', sa.String(length=100), nullable=False),
        sa.Column('event', sa.String(length=64), nullable=False),
        sa.Column('received_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('delivery_id'),
    )
    op.create_index('ix_chatwoot_webhook_deliveries_received_at', 'chatwoot_webhook_deliveries', ['received_at'])


def downgrade() -> None:
    op.drop_index('ix_chatwoot_webhook_deliveries_received_at', table_name='chatwoot_webhook_deliveries')
    op.drop_table('chatwoot_webhook_deliveries')
