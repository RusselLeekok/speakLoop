from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, load_only, selectinload

from ..database import get_db
from ..deps import get_current_user
from ..models import LearningProgress, Subtitle, Tag, User, Video, VideoTag
from ..schemas import (
    ProgressIn,
    ProgressOut,
    SubtitleOut,
    VideoDetailOut,
    VideoPublicOut,
)

router = APIRouter(prefix="/api", tags=["public"])


def _get_published_video(db: Session, video_id: int) -> Video:
    video = db.scalar(
        select(Video)
        .options(selectinload(Video.tag_links).selectinload(VideoTag.tag))
        .where(Video.id == video_id)
    )
    if video is None or video.status != "published":
        # 未发布 / 草稿 / 下架 / 失败视频对普通用户一律 404
        raise HTTPException(status_code=404, detail="视频不存在或未发布")
    return video


@router.get("/videos", response_model=list[VideoPublicOut])
def list_videos(
    keyword: str | None = Query(default=None),
    category: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    query = (
        select(Video)
        .options(
            load_only(
                Video.id,
                Video.title,
                Video.description,
                Video.category,
                Video.cover_url,
                Video.duration,
                Video.subtitle_count,
                Video.published_at,
                Video.status,
            ),
            selectinload(Video.tag_links).selectinload(VideoTag.tag),
        )
        .where(Video.status == "published")
    )
    if keyword:
        like = f"%{keyword}%"
        query = query.where(Video.title.like(like) | Video.description.like(like))
    if category:
        query = (
            query.outerjoin(VideoTag, VideoTag.video_id == Video.id)
            .outerjoin(Tag, Tag.id == VideoTag.tag_id)
            .where(or_(Video.category == category, Tag.name == category))
            .distinct()
        )
    videos = db.scalars(query.order_by(Video.published_at.desc())).all()
    return videos


@router.get("/videos/categories", response_model=list[str])
def list_categories(db: Session = Depends(get_db)):
    tag_rows = db.scalars(
        select(Tag.name)
        .join(VideoTag, VideoTag.tag_id == Tag.id)
        .join(Video, Video.id == VideoTag.video_id)
        .where(Video.status == "published")
        .distinct()
    ).all()
    legacy_rows = db.scalars(
        select(Video.category)
        .where(Video.status == "published", Video.category.is_not(None))
        .distinct()
    ).all()
    return sorted({name for name in [*tag_rows, *legacy_rows] if name})


@router.get("/videos/{video_id}", response_model=VideoDetailOut)
def get_video(video_id: int, db: Session = Depends(get_db)):
    return _get_published_video(db, video_id)


@router.get("/videos/{video_id}/subtitles", response_model=list[SubtitleOut])
def get_subtitles(video_id: int, db: Session = Depends(get_db)):
    _get_published_video(db, video_id)
    subtitles = db.scalars(
        select(Subtitle).where(Subtitle.video_id == video_id).order_by(Subtitle.sort_order)
    ).all()
    return subtitles


# ---------- 学习进度（需登录） ----------

@router.get("/progress", response_model=list[ProgressOut])
def list_my_progress(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.scalars(
        select(LearningProgress).where(LearningProgress.user_id == user.id)
    ).all()
    return rows


@router.get("/videos/{video_id}/progress", response_model=ProgressOut | None)
def get_progress(video_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _get_published_video(db, video_id)
    return db.scalar(
        select(LearningProgress).where(
            LearningProgress.user_id == user.id, LearningProgress.video_id == video_id
        )
    )


@router.put("/videos/{video_id}/progress", response_model=ProgressOut)
def save_progress(
    video_id: int,
    body: ProgressIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _get_published_video(db, video_id)
    progress = db.scalar(
        select(LearningProgress).where(
            LearningProgress.user_id == user.id, LearningProgress.video_id == video_id
        )
    )
    if progress is None:
        progress = LearningProgress(user_id=user.id, video_id=video_id)
        db.add(progress)
    progress.last_time_ms = body.last_time_ms
    progress.last_subtitle_id = body.last_subtitle_id
    db.commit()
    db.refresh(progress)
    return progress
