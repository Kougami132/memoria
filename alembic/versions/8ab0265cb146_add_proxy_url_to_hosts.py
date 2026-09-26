"""add proxy_url to hosts

Revision ID: 8ab0265cb146
Revises: 35250485c23c
Create Date: 2026-09-27 03:29:00.183031

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8ab0265cb146'
down_revision: Union[str, Sequence[str], None] = '35250485c23c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('hosts', sa.Column('proxy_url', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('hosts', 'proxy_url')
