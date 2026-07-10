from datetime import datetime
import hashlib
import json
from pathlib import Path
import re

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, load_only, selectinload

from .. import storage
from ..database import get_db
from ..deps import require_admin
from ..models import ProcessingTask, Subtitle, SubtitleSource, SubtitleWarning, Tag, User, Video, VideoTag, VideoTrack
from ..schemas import (
    MAX_VIDEO_TAGS,
    VIDEO_STATUSES,
    AdminStatsOut,
    AdminSubtitlesOut,
    ProcessingTaskOut,
    ReuploadResultOut,
    SubtitleEditRequest,
    SubtitleExtractRequest,
    SubtitleOut,
    SubtitleTranscribeRequest,
    TagOut,
    TaskCreatedOut,
    UploadResultOut,
    UrlImportRequest,
    VideoAdminListOut,
    VideoAdminOut,
    VideoTrackOut,
    VideoUpdateIn,
    WarningOut,
)
from ..subtitle_parser import Cue, SubtitleParseError, merge_zh_into_en, parse_subtitle
from ..subtitle_ops import replace_with_subtitle_files
from ..task_logger import read_log
from ..tasks import (
    extract_subtitle_for_video_task,
    import_url_video_task,
    process_uploaded_video_task,
    transcribe_video_task,
)

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])

VIDEO_ADMIN_LOAD_FIELDS = (
    Video.id,
    Video.title,
    Video.description,
    Video.category,
    Video.source_type,
    Video.source_url,
    Video.original_filename,
    Video.file_url,
    Video.cover_url,
    Video.duration,
    Video.container_format,
    Video.file_size,
    Video.mime_type,
    Video.status,
    Video.error_message,
    Video.subtitle_count,
    Video.created_at,
    Video.updated_at,
    Video.published_at,
)


def _normalize_tags(values: list[str] | None) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for raw in values or []:
        name = re.sub(r"\s+", " ", raw.strip())
        if not name:
            continue
        if len(name) > 50:
            raise HTTPException(status_code=400, detail="单个标签最多 50 个字符")
        key = name.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(name)
    if len(result) > MAX_VIDEO_TAGS:
        raise HTTPException(status_code=400, detail=f"一个视频最多只能设置 {MAX_VIDEO_TAGS} 个标签")
    return result


def _parse_form_tags(tags: str | None, category: str | None = None) -> list[str]:
    values: list[str] = []
    if tags:
        try:
            decoded = json.loads(tags)
            if isinstance(decoded, list):
                values.extend(str(item) for item in decoded)
            else:
                values.append(str(decoded))
        except json.JSONDecodeError:
            values.extend(part for part in re.split(r"[,，\n]", tags))
    if not values and category:
        values.append(category)
    return _normalize_tags(values)


def _slug_for_tag(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    if not base:
        base = "tag"
    suffix = hashlib.sha1(name.encode("utf-8")).hexdigest()[:8]
    return f"{base[:64]}-{suffix}"


def _get_or_create_tag(db: Session, name: str) -> Tag:
    tag = db.scalar(select(Tag).where(func.lower(Tag.name) == name.lower()))
    if tag:
        return tag
    tag = Tag(name=name, slug=_slug_for_tag(name))
    db.add(tag)
    db.flush()
    return tag


def _set_video_tags(db: Session, video: Video, tag_names: list[str]) -> None:
    normalized = _normalize_tags(tag_names)
    for link in list(video.tag_links):
        db.delete(link)
    db.flush()
    for order, name in enumerate(normalized):
        tag = _get_or_create_tag(db, name)
        db.add(VideoTag(video_id=video.id, tag_id=tag.id, sort_order=order))
    video.category = normalized[0] if normalized else None


def _get_video_or_404(db: Session, video_id: int) -> Video:
    video = db.get(Video, video_id)
    if video is None:
        raise HTTPException(status_code=404, detail="视频不存在")
    return video


def _create_processing_task(db: Session, video_id: int | None, task_type: str) -> ProcessingTask:
    task = ProcessingTask(video_id=video_id, task_type=task_type, status="queued", progress=0)
    db.add(task)
    db.flush()
    return task


def _get_active_processing_task(db: Session, video_id: int, task_type: str) -> ProcessingTask | None:
    return db.scalar(
        select(ProcessingTask)
        .where(
            ProcessingTask.video_id == video_id,
            ProcessingTask.task_type == task_type,
            ProcessingTask.status.in_(("queued", "running")),
        )
        .order_by(ProcessingTask.id.desc())
        .limit(1)
    )


def _attach_celery_id(db: Session, task_id: int, celery_id: str) -> None:
    task = db.get(ProcessingTask, task_id)
    if task:
        task.celery_id = celery_id
        db.commit()


def _clear_subtitle_data(db: Session, video: Video, clear_sources: bool = True) -> None:
    for sub in list(video.subtitles):
        db.delete(sub)
    for w in list(video.warnings):
        db.delete(w)
    if clear_sources:
        for src in list(video.subtitle_sources):
            storage.delete_file(src.file_path)
            db.delete(src)
    video.subtitle_count = 0


def _save_subtitle_source(
    db: Session, video: Video, upload: UploadFile, data: bytes, language: str
) -> None:
    ext = Path(upload.filename or "").suffix.lower()
    path = storage.settings.upload_root / "subtitles" / f"{video.id}_{language}_{datetime.now().strftime('%Y%m%d%H%M%S')}{ext}"
    storage.ensure_upload_dirs()
    path.write_bytes(data)
    db.add(
        SubtitleSource(
            video_id=video.id,
            language=language,
            file_name=upload.filename,
            file_path=str(path),
            raw_content=data.decode("utf-8", errors="replace"),
            format=ext.lstrip("."),
        )
    )


def _apply_parsed_subtitles(
    db: Session,
    video: Video,
    en_cues: list[Cue],
    zh_texts: list[str | None],
    warnings: list[str],
) -> None:
    for order, cue in enumerate(en_cues):
        db.add(
            Subtitle(
                video_id=video.id,
                start_ms=cue.start_ms,
                end_ms=cue.end_ms,
                en_text=cue.text,
                zh_text=zh_texts[order],
                sort_order=order,
            )
        )
    for msg in warnings:
        db.add(SubtitleWarning(video_id=video.id, warning_type="subtitle", message=msg))
    video.subtitle_count = len(en_cues)


def _parse_pair(
    en_data: bytes,
    en_name: str,
    zh_data: bytes | None,
    zh_name: str | None,
    video_duration: float | None,
) -> tuple[list[Cue], list[str | None], list[str]]:
    """解析英文（必填）与中文（可选）字幕，返回 (英文cues, 对齐后的中文文本, warnings)。"""
    warnings: list[str] = []

    en_result = parse_subtitle(en_data, en_name)
    warnings.extend(f"英文字幕：{w}" for w in en_result.warnings)
    en_cues = en_result.cues

    zh_texts: list[str | None] = [None] * len(en_cues)
    if zh_data is not None:
        try:
            zh_result = parse_subtitle(zh_data, zh_name or "")
        except SubtitleParseError as e:
            raise SubtitleParseError(f"中文字幕解析失败：{e}") from e
        warnings.extend(f"中文字幕：{w}" for w in zh_result.warnings)
        zh_texts, merge_warnings = merge_zh_into_en(en_cues, zh_result.cues)
        warnings.extend(merge_warnings)

    if video_duration and video_duration > 0:
        last_end = en_cues[-1].end_ms
        duration_ms = int(video_duration * 1000)
        if last_end > duration_ms + 3000:
            warnings.append(
                f"字幕最后时间（{last_end / 1000:.1f}s）明显超过视频总时长（{video_duration:.1f}s），请检查字幕是否匹配该视频"
            )
    return en_cues, zh_texts, warnings


# ---------- 统计 ----------


@router.get("/tags", response_model=list[TagOut])
def list_tags(db: Session = Depends(get_db)):
    tags = db.scalars(select(Tag).order_by(Tag.sort_order, Tag.name)).all()
    return [TagOut(id=tag.id, name=tag.name) for tag in tags]


@router.get("/stats", response_model=AdminStatsOut)
def stats(db: Session = Depends(get_db)):
    rows = db.execute(select(Video.status, func.count()).group_by(Video.status)).all()
    counts = {status: count for status, count in rows}
    recent = db.scalars(
        select(Video)
        .options(load_only(*VIDEO_ADMIN_LOAD_FIELDS), selectinload(Video.tag_links).selectinload(VideoTag.tag))
        .order_by(Video.created_at.desc())
        .limit(5)
    ).all()
    return AdminStatsOut(
        total=sum(counts.values()),
        published=counts.get("published", 0),
        draft=counts.get("draft", 0) + counts.get("processing", 0),
        ready=counts.get("ready", 0),
        unpublished=counts.get("unpublished", 0),
        failed=counts.get("failed", 0),
        recent=[VideoAdminOut.model_validate(v) for v in recent],
    )


# ---------- 视频列表 / 详情 ----------

@router.get("/videos", response_model=VideoAdminListOut)
def list_videos(
    keyword: str | None = Query(default=None),
    status: str | None = Query(default=None),
    category: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    query = select(Video).options(load_only(*VIDEO_ADMIN_LOAD_FIELDS), selectinload(Video.tag_links).selectinload(VideoTag.tag))
    if keyword:
        like = f"%{keyword}%"
        query = query.where(Video.title.like(like) | Video.description.like(like))
    if status:
        if status not in VIDEO_STATUSES:
            raise HTTPException(status_code=400, detail=f"未知状态：{status}")
        query = query.where(Video.status == status)
    if category:
        query = (
            query.outerjoin(VideoTag, VideoTag.video_id == Video.id)
            .outerjoin(Tag, Tag.id == VideoTag.tag_id)
            .where(or_(Video.category == category, Tag.name == category))
            .distinct()
        )

    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    videos = db.scalars(
        query.order_by(Video.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return VideoAdminListOut(
        items=[VideoAdminOut.model_validate(v) for v in videos],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/videos/import-url", response_model=TaskCreatedOut)
def import_video_from_url(
    body: UrlImportRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    url = body.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL 不能为空")
    tag_names = _normalize_tags(body.tags)
    video = Video(
        title=(body.title or url).strip()[:255],
        description=body.description,
        category=tag_names[0] if tag_names else None,
        source_type="url",
        source_url=url,
        original_filename=None,
        file_path="",
        file_url="",
        status="processing",
        created_by=admin.id,
    )
    db.add(video)
    db.flush()
    _set_video_tags(db, video, tag_names)
    task = _create_processing_task(db, video.id, "import_url")
    db.commit()
    result = import_url_video_task.delay(task.id, video.id, url, body.publish_now)
    _attach_celery_id(db, task.id, result.id)
    return TaskCreatedOut(task_id=task.id, video_id=video.id)


@router.get("/videos/{video_id}", response_model=VideoAdminOut)
def get_video(video_id: int, db: Session = Depends(get_db)):
    video = db.scalar(
        select(Video)
        .options(selectinload(Video.tag_links).selectinload(VideoTag.tag))
        .where(Video.id == video_id)
    )
    if video is None:
        raise HTTPException(status_code=404, detail="视频不存在")
    return video


@router.get("/videos/{video_id}/tracks", response_model=list[VideoTrackOut])
def get_video_tracks(video_id: int, db: Session = Depends(get_db)):
    _get_video_or_404(db, video_id)
    return db.scalars(
        select(VideoTrack).where(VideoTrack.video_id == video_id).order_by(VideoTrack.stream_index)
    ).all()


# ---------- 新增视频（multipart 上传） ----------

@router.post("/videos", response_model=UploadResultOut)
def create_video(
    title: str = Form(...),
    description: str | None = Form(default=None),
    category: str | None = Form(default=None),
    tags: str | None = Form(default=None),
    publish_now: bool = Form(default=False),
    duration: float | None = Form(default=None),
    video_file: UploadFile = File(...),
    en_subtitle_file: UploadFile | None = File(default=None),
    zh_subtitle_file: UploadFile | None = File(default=None),
    cover_file: UploadFile | None = File(default=None),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    title = title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="视频标题不能为空")
    tag_names = _parse_form_tags(tags, category)

    video_ext = storage.validate_ext(video_file, storage.VIDEO_EXTS, "视频")
    if en_subtitle_file is not None and en_subtitle_file.filename:
        en_ext = storage.validate_ext(en_subtitle_file, storage.SUBTITLE_EXTS, "英文字幕")
    else:
        en_subtitle_file = None
        en_ext = None
    if zh_subtitle_file is not None and zh_subtitle_file.filename:
        if en_subtitle_file is None:
            raise HTTPException(status_code=400, detail="上传中文字幕时也需要上传英文字幕")
        zh_ext = storage.validate_ext(zh_subtitle_file, storage.SUBTITLE_EXTS, "中文字幕")
    else:
        zh_subtitle_file = None
        zh_ext = None
    if cover_file is not None and cover_file.filename:
        cover_ext = storage.validate_ext(cover_file, storage.COVER_EXTS, "封面")
    else:
        cover_file = None
        cover_ext = None

    settings = storage.settings
    saved_files: list[Path] = []
    try:
        video_path = storage.save_upload(
            video_file, "videos", video_ext, settings.max_video_size_mb, "视频文件"
        )
        saved_files.append(video_path)
        cover_path: Path | None = None
        if cover_file is not None:
            cover_path = storage.save_upload(
                cover_file, "covers", cover_ext or ".jpg", settings.max_cover_size_mb, "封面图片"
            )
            saved_files.append(cover_path)

        en_path: Path | None = None
        zh_path: Path | None = None
        if en_subtitle_file is not None:
            en_path = storage.save_upload(
                en_subtitle_file, "subtitles", en_ext or ".srt", settings.max_subtitle_size_mb, "英文字幕"
            )
            saved_files.append(en_path)
        if zh_subtitle_file is not None:
            zh_path = storage.save_upload(
                zh_subtitle_file, "subtitles", zh_ext or ".srt", settings.max_subtitle_size_mb, "中文字幕"
            )
            saved_files.append(zh_path)

        video = Video(
            title=title,
            description=description,
            category=tag_names[0] if tag_names else ((category or "").strip() or None),
            source_type="upload",
            original_filename=video_file.filename,
            file_path=str(video_path),
            file_url=storage.public_url(video_path),
            cover_path=str(cover_path) if cover_path else None,
            cover_url=storage.public_url(cover_path) if cover_path else None,
            duration=duration,
            file_size=video_path.stat().st_size,
            mime_type=storage.VIDEO_MIME.get(video_ext),
            status="processing",
            created_by=admin.id,
        )
        db.add(video)
        db.flush()  # 拿到 video.id
        _set_video_tags(db, video, tag_names)
        task = _create_processing_task(db, video.id, "analyze_upload")
        db.commit()
        result = process_uploaded_video_task.delay(
            task.id,
            video.id,
            publish_now,
            str(en_path) if en_path else None,
            en_subtitle_file.filename if en_subtitle_file else None,
            str(zh_path) if zh_path else None,
            zh_subtitle_file.filename if zh_subtitle_file else None,
        )
        _attach_celery_id(db, task.id, result.id)
        return UploadResultOut(
            video_id=video.id, task_id=task.id, title=video.title, status=video.status,
            file_url=video.file_url, cover_url=video.cover_url,
            subtitle_count=video.subtitle_count, warnings=[],
            message="视频已上传，正在后台分析和处理字幕",
        )
    except HTTPException:
        db.rollback()
        for p in saved_files:
            storage.delete_file(str(p))
        raise
    except Exception:
        db.rollback()
        for p in saved_files:
            storage.delete_file(str(p))
        raise HTTPException(status_code=500, detail="上传失败，已清理未完成的数据")


@router.get("/tasks/{task_id}", response_model=ProcessingTaskOut)
def get_task(task_id: int, db: Session = Depends(get_db)):
    task = db.get(ProcessingTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return task


@router.get("/tasks/{task_id}/logs", response_class=PlainTextResponse)
def get_task_logs(task_id: int, db: Session = Depends(get_db)) -> str:
    task = db.get(ProcessingTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return read_log(task.log_path)


# ---------- 编辑 / 发布 / 下架 ----------

@router.put("/videos/{video_id}", response_model=VideoAdminOut)
def update_video(video_id: int, body: VideoUpdateIn, db: Session = Depends(get_db)):
    video = _get_video_or_404(db, video_id)
    if body.title is not None:
        video.title = body.title.strip()
    if body.description is not None:
        video.description = body.description
    if body.tags is not None:
        _set_video_tags(db, video, body.tags)
    elif body.category is not None:
        video.category = body.category.strip() or None
    if body.status is not None:
        _change_status(video, body.status)
    db.commit()
    return video


def _change_status(video: Video, new_status: str) -> None:
    if new_status not in VIDEO_STATUSES:
        raise HTTPException(status_code=400, detail=f"未知状态：{new_status}")
    if new_status == "published":
        if video.status not in ("ready", "unpublished", "published"):
            raise HTTPException(status_code=400, detail=f"当前状态（{video.status}）不能发布，请先处理字幕")
        if video.subtitle_count <= 0:
            raise HTTPException(status_code=400, detail="没有可用字幕，不能发布")
        if video.published_at is None:
            video.published_at = datetime.now()
    video.status = new_status


# ---------- 修改封面 ----------

@router.post("/videos/{video_id}/cover", response_model=VideoAdminOut)
def update_cover(video_id: int, cover_file: UploadFile = File(...), db: Session = Depends(get_db)):
    video = _get_video_or_404(db, video_id)
    ext = storage.validate_ext(cover_file, storage.COVER_EXTS, "封面")
    new_path = storage.save_upload(cover_file, "covers", ext, storage.settings.max_cover_size_mb, "封面图片")
    storage.delete_file(video.cover_path)
    video.cover_path = str(new_path)
    video.cover_url = storage.public_url(new_path)
    db.commit()
    return video


# ---------- 删除 ----------

@router.delete("/videos/{video_id}")
def delete_video(video_id: int, db: Session = Depends(get_db)):
    video = _get_video_or_404(db, video_id)
    file_paths = (
        [video.file_path, video.cover_path]
        + [s.file_path for s in video.subtitle_sources]
        + [task.log_path for task in video.tasks]
    )
    db.delete(video)  # 级联删除字幕、字幕源、warning、学习进度（外键 CASCADE）
    db.commit()
    for p in file_paths:
        storage.delete_file(p)
    return {"ok": True, "message": "视频及关联数据已删除"}


# ---------- 重新上传字幕 ----------

@router.post("/videos/{video_id}/subtitles/reupload", response_model=ReuploadResultOut)
def reupload_subtitles(
    video_id: int,
    en_subtitle_file: UploadFile = File(...),
    zh_subtitle_file: UploadFile | None = File(default=None),
    db: Session = Depends(get_db),
):
    video = _get_video_or_404(db, video_id)
    storage.validate_ext(en_subtitle_file, storage.SUBTITLE_EXTS, "英文字幕")
    if zh_subtitle_file is not None and zh_subtitle_file.filename:
        storage.validate_ext(zh_subtitle_file, storage.SUBTITLE_EXTS, "中文字幕")
    else:
        zh_subtitle_file = None

    en_data = en_subtitle_file.file.read()
    zh_data = zh_subtitle_file.file.read() if zh_subtitle_file is not None else None

    try:
        en_cues, zh_texts, warnings = _parse_pair(
            en_data, en_subtitle_file.filename or "", zh_data,
            zh_subtitle_file.filename if zh_subtitle_file else None, video.duration,
        )
    except SubtitleParseError as e:
        # 解析失败：不动旧字幕数据，只记录失败信息
        video.status = "failed" if video.subtitle_count == 0 else video.status
        db.add(SubtitleWarning(video_id=video.id, warning_type="error", message=str(e)))
        db.commit()
        return ReuploadResultOut(
            video_id=video.id, status=video.status, subtitle_count=video.subtitle_count,
            warnings=[], message=f"字幕解析失败：{e}",
        )

    was_published = video.status == "published"
    _clear_subtitle_data(db, video)
    _save_subtitle_source(db, video, en_subtitle_file, en_data, "en")
    if zh_subtitle_file is not None and zh_data is not None:
        _save_subtitle_source(db, video, zh_subtitle_file, zh_data, "zh")
    _apply_parsed_subtitles(db, video, en_cues, zh_texts, warnings)
    video.status = "published" if was_published else "ready"
    video.error_message = None
    db.commit()
    return ReuploadResultOut(
        video_id=video.id, status=video.status,
        subtitle_count=video.subtitle_count, warnings=warnings,
    )


@router.post("/videos/{video_id}/subtitles/extract", response_model=TaskCreatedOut)
def extract_subtitles(
    video_id: int,
    body: SubtitleExtractRequest,
    db: Session = Depends(get_db),
):
    video = _get_video_or_404(db, video_id)
    active_task = _get_active_processing_task(db, video.id, "extract_subtitle")
    if active_task is not None:
        return TaskCreatedOut(task_id=active_task.id, video_id=video.id)
    primary = db.get(VideoTrack, body.primary_track_id)
    if primary is None or primary.video_id != video.id or primary.track_type != "subtitle":
        raise HTTPException(status_code=404, detail="字幕轨不存在")
    if body.zh_track_id is not None:
        zh_track = db.get(VideoTrack, body.zh_track_id)
        if zh_track is None or zh_track.video_id != video.id or zh_track.track_type != "subtitle":
            raise HTTPException(status_code=404, detail="中文字幕轨不存在")
    task = _create_processing_task(db, video.id, "extract_subtitle")
    db.commit()
    result = extract_subtitle_for_video_task.delay(
        task.id, video.id, body.primary_track_id, body.zh_track_id, body.publish_now
    )
    _attach_celery_id(db, task.id, result.id)
    return TaskCreatedOut(task_id=task.id, video_id=video.id)


@router.post("/videos/{video_id}/subtitles/transcribe", response_model=TaskCreatedOut)
def transcribe_subtitles(
    video_id: int,
    body: SubtitleTranscribeRequest,
    db: Session = Depends(get_db),
):
    video = _get_video_or_404(db, video_id)
    active_task = _get_active_processing_task(db, video.id, "transcribe")
    if active_task is not None:
        return TaskCreatedOut(task_id=active_task.id, video_id=video.id)
    if video.subtitle_count > 0 and video.status in ("ready", "published", "unpublished"):
        return TaskCreatedOut(task_id=0, video_id=video.id)
    if body.audio_track_id is not None:
        track = db.get(VideoTrack, body.audio_track_id)
        if track is None or track.video_id != video.id or track.track_type != "audio":
            raise HTTPException(status_code=404, detail="音频轨不存在")
    task = _create_processing_task(db, video.id, "transcribe")
    db.commit()
    result = transcribe_video_task.delay(
        task.id,
        video.id,
        body.audio_track_id,
        body.language,
        body.publish_now,
        body.split_enabled,
        body.max_chars,
        body.max_seconds,
    )
    _attach_celery_id(db, task.id, result.id)
    return TaskCreatedOut(task_id=task.id, video_id=video.id)


# ---------- 查看字幕 ----------

@router.put("/videos/{video_id}/subtitles", response_model=AdminSubtitlesOut)
def save_subtitles(video_id: int, body: SubtitleEditRequest, db: Session = Depends(get_db)):
    video = _get_video_or_404(db, video_id)
    rows = sorted(body.subtitles, key=lambda item: item.sort_order)
    previous_end = 0
    for index, item in enumerate(rows):
        if item.end_ms <= item.start_ms:
            raise HTTPException(status_code=400, detail=f"第 {index + 1} 条字幕结束时间必须晚于开始时间")
        if item.start_ms < previous_end:
            raise HTTPException(status_code=400, detail=f"第 {index + 1} 条字幕与上一条重叠")
        if not (item.en_text or item.zh_text):
            raise HTTPException(status_code=400, detail=f"第 {index + 1} 条字幕内容不能为空")
        previous_end = item.end_ms

    _clear_subtitle_data(db, video, clear_sources=False)
    for order, item in enumerate(rows):
        db.add(
            Subtitle(
                video_id=video.id,
                start_ms=item.start_ms,
                end_ms=item.end_ms,
                en_text=item.en_text.strip() if item.en_text else None,
                zh_text=item.zh_text.strip() if item.zh_text else None,
                sort_order=order,
            )
        )
    video.subtitle_count = len(rows)
    if video.status in ("failed", "needs_subtitle"):
        video.status = "ready"
    if rows:
        video.error_message = None
    db.commit()
    return get_subtitles(video_id, db)


@router.get("/videos/{video_id}/subtitles", response_model=AdminSubtitlesOut)
def get_subtitles(video_id: int, db: Session = Depends(get_db)):
    video = _get_video_or_404(db, video_id)
    subtitles = db.scalars(
        select(Subtitle).where(Subtitle.video_id == video_id).order_by(Subtitle.sort_order)
    ).all()
    warnings = db.scalars(
        select(SubtitleWarning).where(SubtitleWarning.video_id == video_id).order_by(SubtitleWarning.id)
    ).all()
    return AdminSubtitlesOut(
        video_id=video.id,
        subtitle_count=video.subtitle_count,
        subtitles=[SubtitleOut.model_validate(s) for s in subtitles],
        warnings=[WarningOut.model_validate(w) for w in warnings],
    )
