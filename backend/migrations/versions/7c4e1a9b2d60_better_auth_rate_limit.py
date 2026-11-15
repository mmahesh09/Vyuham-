"""better auth rate limit table

Revision ID: 7c4e1a9b2d60
Revises: 6b3d9e2f4a51
Create Date: 2026-11-15 12:00:00.000000

Better Auth (1.7) keeps sign-in / sign-up / reset attempt counters here when
rateLimit.storage = "database" (frontend/src/lib/auth.ts). Column names are Better Auth's defaults.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7c4e1a9b2d60'
down_revision: Union[str, None] = '6b3d9e2f4a51'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'rateLimit',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('key', sa.String(length=255), nullable=False),
        sa.Column('count', sa.Integer(), nullable=False),
        sa.Column('lastRequest', sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('key'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('rateLimit')
