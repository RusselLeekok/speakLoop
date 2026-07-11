from __future__ import annotations

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import storage
from .celery_app import celery_app
from .database import SessionLocal
from .media_tools import (
    CommandError,
    download_url,
    extract_audio_for_transcription,
    extract_cover,
    extract_subtitle_track,
    get_ytdlp_info,
    media_summary,
    normalize_tracks,
    probe_media,
    transcribe_audio,
)
from .models import ProcessingTask, Video, VideoTrack
from .subtitle_ops import replace_with_subtitle_files, replace_with_whisper_segments
from .task_logger import TaskLogger


def _set_task(
    db: Session,
    task: ProcessingTask,
    status: str,
    progress: int,
    error: str | None = None,
    result: dict | None = None,
) -> None:
    task.status = status
    task.progress = progress
    task.error_message = error
    if result is not None:
        task.result_json = result
    db.commit()


def _fail(db: Session, task: ProcessingTask, video: Video | None, logger: TaskLogger, exc: Exception) -> None:
    message = str(exc)
    if isinstance(exc, CommandError):
        message = "\n".join(part for part in [message, exc.stderr.strip()] if part)
    logger.write("ERROR: " + message)
    task.log_path = str(logger.path)
    task.status = "failed"
    task.progress = 100
    task.error_message = message
    if video:
        video.status = "failed"
        video.error_message = message
    db.commit()


def _replace_tracks(db: Session, video: Video, probe: dict) -> None:
    for track in list(video.tracks):
        db.delete(track)
    db.flush()
    for item in normalize_tracks(probe):
        db.add(VideoTrack(video_id=video.id, **item))
    db.flush()


def _analyze_media(db: Session, video: Video, logger: TaskLogger) -> None:
    if not video.file_path:
        raise RuntimeError("Video file path is missing")
    media_path = Path(video.file_path)
    probe = probe_media(media_path, logger)
    summary = media_summary(probe)
    video.duration = summary["duration"]
    video.container_format = summary["container_format"]
    video.metadata_json = summary["metadata_json"]
    video.file_size = media_path.stat().st_size if media_path.exists() else video.file_size
    video.mime_type = storage.VIDEO_MIME.get(media_path.suffix.lower()) or video.mime_type
    _replace_tracks(db, video, probe)
    if not video.cover_path:
        try:
            cover_path = extract_cover(media_path, video.id, logger)
            video.cover_path = str(cover_path)
            video.cover_url = storage.public_url(cover_path)
        except Exception as exc:
            logger.write(f"Cover extraction skipped: {exc}")
    video.error_message = None
    db.commit()


def _finish_after_analysis(
    db: Session,
    video: Video,
    task: ProcessingTask,
    logger: TaskLogger,
    publish_now: bool,
    en_path: str | None = None,
    en_name: str | None = None,
    zh_path: str | None = None,
    zh_name: str | None = None,
) -> None:
    if en_path:
        replace_with_subtitle_files(
            db,
            video,
            Path(en_path),
            en_name or Path(en_path).name,
            Path(zh_path) if zh_path else None,
            zh_name,
        )
        video.status = "published" if publish_now else "ready"
        video.error_message = None
        if video.status == "published" and video.published_at is None:
            from datetime import datetime

            video.published_at = datetime.now()
        db.commit()
        _set_task(db, task, "completed", 100, result={"video_id": video.id, "subtitle_count": video.subtitle_count})
        return

    subtitle_tracks = [track for track in video.tracks if track.track_type == "subtitle"]
    if len(subtitle_tracks) == 1:
        _set_task(db, task, "running", 80)
        extracted = extract_subtitle_track(Path(video.file_path), subtitle_tracks[0].stream_index, "srt", logger)
        replace_with_subtitle_files(db, video, extracted, extracted.name)
        video.status = "published" if publish_now else "ready"
        video.error_message = None
        if video.status == "published" and video.published_at is None:
            from datetime import datetime

            video.published_at = datetime.now()
        db.commit()
        _set_task(db, task, "completed", 100, result={"video_id": video.id, "subtitle_count": video.subtitle_count})
        return

    if len(subtitle_tracks) > 1:
        video.status = "needs_subtitle"
        db.commit()
        _set_task(db, task, "completed", 100, result={"video_id": video.id, "subtitle_tracks": len(subtitle_tracks)})
        return

    audio_track = next((track for track in video.tracks if track.track_type == "audio"), None)
    if not audio_track:
        video.status = "needs_subtitle"
        video.error_message = "No subtitle or audio track detected. Upload a subtitle file."
        db.commit()
        _set_task(db, task, "completed", 100, result={"video_id": video.id, "needs_subtitle": True})
        return

    _set_task(db, task, "running", 80)
    audio_path = extract_audio_for_transcription(Path(video.file_path), audio_track.stream_index, logger)
    subtitle_path, segments = transcribe_audio(audio_path, None, logger=logger, split_enabled=True)
    try:
        audio_path.unlink(missing_ok=True)
    except OSError:
        pass
    replace_with_whisper_segments(db, video, subtitle_path, segments)
    video.status = "published" if publish_now else "ready"
    video.error_message = None
    if video.status == "published" and video.published_at is None:
        from datetime import datetime

        video.published_at = datetime.now()
    db.commit()
    _set_task(db, task, "completed", 100, result={"video_id": video.id, "subtitle_count": video.subtitle_count, "source": "whisper"})


@celery_app.task(name="process_uploaded_video")
def process_uploaded_video_task(
    task_id: int,
    video_id: int,
    publish_now: bool,
    en_path: str | None = None,
    en_name: str | None = None,
    zh_path: str | None = None,
    zh_name: str | None = None,
) -> None:
    db = SessionLocal()
    logger = TaskLogger(task_id)
    try:
        task = db.get(ProcessingTask, task_id)
        video = db.get(Video, video_id)
        if not task or not video:
            raise RuntimeError("Task or video record not found")
        task.log_path = str(logger.path)
        _set_task(db, task, "running", 10)
        _analyze_media(db, video, logger)
        _set_task(db, task, "running", 70)
        _finish_after_analysis(db, video, task, logger, publish_now, en_path, en_name, zh_path, zh_name)
    except Exception as exc:
        task = db.get(ProcessingTask, task_id)
        video = db.get(Video, video_id)
        if task:
            _fail(db, task, video, logger, exc)
    finally:
        db.close()


@celery_app.task(name="import_url_video")
def import_url_video_task(task_id: int, video_id: int, url: str, publish_now: bool) -> None:
    db = SessionLocal()
    logger = TaskLogger(task_id)
    try:
        task = db.get(ProcessingTask, task_id)
        video = db.get(Video, video_id)
        if not task or not video:
            raise RuntimeError("Task or video record not found")
        task.log_path = str(logger.path)
        _set_task(db, task, "running", 5)
        info = get_ytdlp_info(url, logger)
        video.title = info.get("title") or video.title
        video.metadata_json = {"yt_dlp": info}
        _set_task(db, task, "running", 35)
        video_path = download_url(url, video.id, logger)
        video.file_path = str(video_path)
        video.file_url = storage.public_url(video_path)
        video.original_filename = video_path.name
        db.commit()
        _set_task(db, task, "running", 70)
        _analyze_media(db, video, logger)
        video.metadata_json = {"ffprobe": video.metadata_json, "yt_dlp": info}
        db.commit()
        _finish_after_analysis(db, video, task, logger, publish_now)
    except Exception as exc:
        task = db.get(ProcessingTask, task_id)
        video = db.get(Video, video_id)
        if task:
            _fail(db, task, video, logger, exc)
    finally:
        db.close()


@celery_app.task(name="extract_subtitle_for_video")
def extract_subtitle_for_video_task(task_id: int, video_id: int, primary_track_id: int, zh_track_id: int | None, publish_now: bool) -> None:
    db = SessionLocal()
    logger = TaskLogger(task_id)
    try:
        task = db.get(ProcessingTask, task_id)
        video = db.get(Video, video_id)
        primary = db.get(VideoTrack, primary_track_id)
        zh_track = db.get(VideoTrack, zh_track_id) if zh_track_id else None
        if not task or not video or not primary:
            raise RuntimeError("Task, video, or subtitle track not found")
        if primary.video_id != video.id or primary.track_type != "subtitle":
            raise RuntimeError("Primary track is not a subtitle track for this video")
        if zh_track and (zh_track.video_id != video.id or zh_track.track_type != "subtitle"):
            raise RuntimeError("Chinese track is not a subtitle track for this video")
        task.log_path = str(logger.path)
        _set_task(db, task, "running", 20)
        en_path = extract_subtitle_track(Path(video.file_path), primary.stream_index, "srt", logger)
        zh_path = None
        if zh_track:
            _set_task(db, task, "running", 55)
            zh_path = extract_subtitle_track(Path(video.file_path), zh_track.stream_index, "srt", logger)
        _set_task(db, task, "running", 80)
        replace_with_subtitle_files(db, video, en_path, en_path.name, zh_path, zh_path.name if zh_path else None)
        video.status = "published" if publish_now else "ready"
        video.error_message = None
        if video.status == "published" and video.published_at is None:
            from datetime import datetime

            video.published_at = datetime.now()
        db.commit()
        _set_task(db, task, "completed", 100, result={"video_id": video.id, "subtitle_count": video.subtitle_count})
    except Exception as exc:
        task = db.get(ProcessingTask, task_id)
        video = db.get(Video, video_id)
        if task:
            _fail(db, task, video, logger, exc)
    finally:
        db.close()


@celery_app.task(name="transcribe_video")
def transcribe_video_task(
    task_id: int,
    video_id: int,
    audio_track_id: int | None,
    language: str | None,
    publish_now: bool,
    split_enabled: bool,
    max_chars: int,
    max_seconds: float,
) -> None:
    db = SessionLocal()
    logger = TaskLogger(task_id)
    try:
        task = db.get(ProcessingTask, task_id)
        video = db.get(Video, video_id)
        if not task or not video:
            raise RuntimeError("Task or video record not found")
        track = db.get(VideoTrack, audio_track_id) if audio_track_id else None
        if track and (track.video_id != video.id or track.track_type != "audio"):
            raise RuntimeError("Selected track is not an audio track for this video")
        if not track:
            track = db.scalar(
                select(VideoTrack)
                .where(VideoTrack.video_id == video.id, VideoTrack.track_type == "audio")
                .order_by(VideoTrack.stream_index)
                .limit(1)
            )
        if not track:
            raise RuntimeError("No audio track detected")
        task.log_path = str(logger.path)
        _set_task(db, task, "running", 20)
        audio_path = extract_audio_for_transcription(Path(video.file_path), track.stream_index, logger)
        _set_task(db, task, "running", 50)
        subtitle_path, segments = transcribe_audio(audio_path, language, logger, split_enabled, max_chars, max_seconds)
        try:
            audio_path.unlink(missing_ok=True)
        except OSError:
            pass
        replace_with_whisper_segments(db, video, subtitle_path, segments)
        video.status = "published" if publish_now else "ready"
        video.error_message = None
        if video.status == "published" and video.published_at is None:
            from datetime import datetime

            video.published_at = datetime.now()
        db.commit()
        _set_task(db, task, "completed", 100, result={"video_id": video.id, "subtitle_count": video.subtitle_count})
    except Exception as exc:
        task = db.get(ProcessingTask, task_id)
        video = db.get(Video, video_id)
        if task:
            _fail(db, task, video, logger, exc)
    finally:
        db.close()
