"""add processing tasks and media tracks

Revision ID: 0003_processing_tasks_tracks
Revises: 0002_video_tags
Create Date: 2026-07-08

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0003_processing_tasks_tracks"
down_revision = "0002_video_tags"
branch_labels = None
depends_on = None


def _has_column(inspector: sa.Inspector, table: str, column: str) -> bool:
    return any(item["name"] == column for item in inspector.get_columns(table))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("videos"):
        if not _has_column(inspector, "videos", "source_type"):
            op.add_column("videos", sa.Column("source_type", sa.String(length=20), nullable=False, server_default="upload"))
        if not _has_column(inspector, "videos", "source_url"):
            op.add_column("videos", sa.Column("source_url", sa.Text(), nullable=True))
        if not _has_column(inspector, "videos", "container_format"):
            op.add_column("videos", sa.Column("container_format", sa.String(length=120), nullable=True))
        if not _has_column(inspector, "videos", "error_message"):
            op.add_column("videos", sa.Column("error_message", sa.Text(), nullable=True))
        if not _has_column(inspector, "videos", "metadata_json"):
            op.add_column("videos", sa.Column("metadata_json", sa.JSON(), nullable=True))

    inspector = sa.inspect(bind)
    if not inspector.has_table("video_tracks"):
        op.create_table(
            "video_tracks",
            sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), autoincrement=True, nullable=False),
            sa.Column("video_id", sa.BigInteger(), nullable=False),
            sa.Column("track_type", sa.String(length=20), nullable=False),
            sa.Column("stream_index", sa.Integer(), nullable=False),
            sa.Column("codec", sa.String(length=80), nullable=True),
            sa.Column("language", sa.String(length=40), nullable=True),
            sa.Column("duration", sa.Double(), nullable=True),
            sa.Column("width", sa.Integer(), nullable=True),
            sa.Column("height", sa.Integer(), nullable=True),
            sa.Column("bit_rate", sa.BigInteger(), nullable=True),
            sa.Column("raw_json", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
            sa.ForeignKeyConstraint(["video_id"], ["videos.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            mysql_charset="utf8mb4",
            mysql_collate="utf8mb4_unicode_ci",
        )
        op.create_index("ix_video_tracks_video", "video_tracks", ["video_id"])
        op.create_index("ix_video_tracks_type", "video_tracks", ["track_type"])

    inspector = sa.inspect(bind)
    if not inspector.has_table("processing_tasks"):
        op.create_table(
            "processing_tasks",
            sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), autoincrement=True, nullable=False),
            sa.Column("celery_id", sa.String(length=255), nullable=True),
            sa.Column("video_id", sa.BigInteger(), nullable=True),
            sa.Column("task_type", sa.String(length=40), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="queued"),
            sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("log_path", sa.Text(), nullable=True),
            sa.Column("result_json", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
            sa.ForeignKeyConstraint(["video_id"], ["videos.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            mysql_charset="utf8mb4",
            mysql_collate="utf8mb4_unicode_ci",
        )
        op.create_index("ix_processing_tasks_video", "processing_tasks", ["video_id"])
        op.create_index("ix_processing_tasks_status", "processing_tasks", ["status"])
        op.create_index("ix_processing_tasks_celery_id", "processing_tasks", ["celery_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("processing_tasks"):
        op.drop_index("ix_processing_tasks_celery_id", table_name="processing_tasks")
        op.drop_index("ix_processing_tasks_status", table_name="processing_tasks")
        op.drop_index("ix_processing_tasks_video", table_name="processing_tasks")
        op.drop_table("processing_tasks")
    inspector = sa.inspect(bind)
    if inspector.has_table("video_tracks"):
        op.drop_index("ix_video_tracks_type", table_name="video_tracks")
        op.drop_index("ix_video_tracks_video", table_name="video_tracks")
        op.drop_table("video_tracks")
    inspector = sa.inspect(bind)
    for column in ("metadata_json", "error_message", "container_format", "source_url", "source_type"):
        if inspector.has_table("videos") and _has_column(inspector, "videos", column):
            op.drop_column("videos", column)
