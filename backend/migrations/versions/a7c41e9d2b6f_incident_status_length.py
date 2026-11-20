"""widen incident status columns: "investigating" (13 characters) didn't fit VARCHAR(12) on Postgres

Revision ID: a7c41e9d2b6f
Revises: f3b9d2c71e05
Create Date: 2026-11-21 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a7c41e9d2b6f'
down_revision: Union[str, Sequence[str], None] = 'f3b9d2c71e05'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # batch_alter_table so SQLite (which can't ALTER COLUMN) rebuilds the table; Postgres alters in place.
    with op.batch_alter_table('incidents') as batch:
        batch.alter_column('status', type_=sa.String(length=16), existing_type=sa.String(length=12), existing_nullable=False)
    with op.batch_alter_table('incident_updates') as batch:
        batch.alter_column('status', type_=sa.String(length=16), existing_type=sa.String(length=12), existing_nullable=False)


def downgrade() -> None:
    with op.batch_alter_table('incident_updates') as batch:
        batch.alter_column('status', type_=sa.String(length=12), existing_type=sa.String(length=16), existing_nullable=False)
    with op.batch_alter_table('incidents') as batch:
        batch.alter_column('status', type_=sa.String(length=12), existing_type=sa.String(length=16), existing_nullable=False)
