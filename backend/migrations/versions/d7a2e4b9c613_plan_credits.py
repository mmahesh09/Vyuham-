"""plan credits: AI credits on each AI action, and the growth plan renamed pro

Revision ID: d7a2e4b9c613
Revises: c5e9a1f3b7d2
Create Date: 2026-11-28 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd7a2e4b9c613'
down_revision: Union[str, Sequence[str], None] = 'c5e9a1f3b7d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('ai_actions') as batch:
        batch.add_column(sa.Column('credits', sa.Integer(), nullable=False, server_default='0'))
    # Past actions predate credits and stay at 0: nobody is charged retroactively.
    op.execute("UPDATE organizations SET plan = 'pro' WHERE plan = 'growth'")


def downgrade() -> None:
    op.execute("UPDATE organizations SET plan = 'growth' WHERE plan = 'pro'")
    op.execute("UPDATE organizations SET plan = 'free' WHERE plan = 'business'")
    with op.batch_alter_table('ai_actions') as batch:
        batch.drop_column('credits')
