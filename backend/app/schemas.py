from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

VIDEO_STATUSES = {"draft", "processing", "needs_subtitle", "ready", "published", "unpublished", "failed"}
MAX_VIDEO_TAGS = 4


# ---------- auth ----------

class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=255)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    role: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ---------- subtitles ----------

class SubtitleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    video_id: int
    start_ms: int
    end_ms: int
    en_text: str | None
    zh_text: str | None
    sort_order: int


class SubtitleEditIn(BaseModel):
    id: int | None = None
    start_ms: int = Field(ge=0)
    end_ms: int = Field(gt=0)
    en_text: str | None = None
    zh_text: str | None = None
    sort_order: int = Field(ge=0)


class SubtitleEditRequest(BaseModel):
    subtitles: list[SubtitleEditIn]


class WarningOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    warning_type: str | None
    message: str
    created_at: datetime


# ---------- videos ----------

class VideoPublicOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str | None
    category: str | None
    tags: list[str] = Field(default_factory=list)
    cover_url: str | None
    duration: float | None
    subtitle_count: int
    published_at: datetime | None


class VideoDetailOut(VideoPublicOut):
    file_url: str


class VideoAdminOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str | None
    category: str | None
    tags: list[str] = Field(default_factory=list)
    source_type: str
    source_url: str | None
    original_filename: str | None
    file_url: str
    cover_url: str | None
    duration: float | None
    container_format: str | None
    file_size: int | None
    mime_type: str | None
    status: str
    error_message: str | None
    subtitle_count: int
    created_at: datetime
    updated_at: datetime
    published_at: datetime | None


class VideoAdminListOut(BaseModel):
    items: list[VideoAdminOut]
    total: int
    page: int
    page_size: int


class VideoUpdateIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    category: str | None = Field(default=None, max_length=100)
    tags: list[str] | None = Field(default=None, max_length=MAX_VIDEO_TAGS)
    status: str | None = None


class UploadResultOut(BaseModel):
    video_id: int
    task_id: int | None = None
    title: str
    status: str
    file_url: str
    cover_url: str | None
    subtitle_count: int
    warnings: list[str]
    message: str | None = None


class ReuploadResultOut(BaseModel):
    video_id: int
    status: str
    subtitle_count: int
    warnings: list[str]
    message: str | None = None


class UrlImportRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2000)
    title: str | None = Field(default=None, max_length=255)
    description: str | None = None
    tags: list[str] | None = Field(default=None, max_length=MAX_VIDEO_TAGS)
    publish_now: bool = False


class TaskCreatedOut(BaseModel):
    task_id: int
    video_id: int | None = None


class ProcessingTaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    celery_id: str | None
    video_id: int | None
    task_type: str
    status: str
    progress: int
    error_message: str | None
    result_json: dict | None
    created_at: datetime
    updated_at: datetime


class VideoTrackOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    video_id: int
    track_type: str
    stream_index: int
    codec: str | None
    language: str | None
    duration: float | None
    width: int | None
    height: int | None
    bit_rate: int | None


class SubtitleExtractRequest(BaseModel):
    primary_track_id: int
    zh_track_id: int | None = None
    publish_now: bool = False


class SubtitleTranscribeRequest(BaseModel):
    audio_track_id: int | None = None
    language: str | None = Field(default=None, max_length=20)
    publish_now: bool = False
    split_enabled: bool = False
    max_chars: int = Field(default=42, ge=12, le=120)
    max_seconds: float = Field(default=5.0, ge=1.0, le=15.0)


class AdminSubtitlesOut(BaseModel):
    video_id: int
    subtitle_count: int
    subtitles: list[SubtitleOut]
    warnings: list[WarningOut]


class AdminStatsOut(BaseModel):
    total: int
    published: int
    draft: int
    ready: int
    unpublished: int
    failed: int
    recent: list[VideoAdminOut]


# ---------- progress ----------

class ProgressIn(BaseModel):
    last_time_ms: int = Field(ge=0)
    last_subtitle_id: int | None = None


class ProgressOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    video_id: int
    last_time_ms: int
    last_subtitle_id: int | None
    updated_at: datetime
