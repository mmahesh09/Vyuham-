"""dashboard report pages

Revision ID: c2f7a9d4e1b3
Revises: b8e3f1a4c9d2
Create Date: 2026-11-23 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c2f7a9d4e1b3'
down_revision: Union[str, Sequence[str], None] = 'b8e3f1a4c9d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Both nullable: existing dashboards have one implicit page and every chart sits on it.
    with op.batch_alter_table('dashboards') as batch:
        batch.add_column(sa.Column('pages', sa.JSON(), nullable=True))
    with op.batch_alter_table('charts') as batch:
        batch.add_column(sa.Column('page_id', sa.String(length=32), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('charts') as batch:
        batch.drop_column('page_id')
    with op.batch_alter_table('dashboards') as batch:
        batch.drop_column('pages')
