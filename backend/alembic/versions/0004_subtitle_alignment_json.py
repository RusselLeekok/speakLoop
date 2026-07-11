"""add subtitle alignment json

Revision ID: 0004_subtitle_alignment_json
Revises: 0003_processing_tasks_tracks
Create Date: 2026-07-11

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0004_subtitle_alignment_json"
down_revision = "0003_processing_tasks_tracks"
branch_labels = None
depends_on = None


def _has_column(inspector: sa.Inspector, table: str, column: str) -> bool:
    return any(item["name"] == column for item in inspector.get_columns(table))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("subtitles") and not _has_column(inspector, "subtitles", "alignment_json"):
        op.add_column("subtitles", sa.Column("alignment_json", sa.JSON(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("subtitles") and _has_column(inspector, "subtitles", "alignment_json"):
        op.drop_column("subtitles", "alignment_json")
