"""uploads/ 目录下的文件保存与清理。"""

import shutil
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

from .config import get_settings

settings = get_settings()

VIDEO_EXTS = {".mp4", ".webm"}
SUBTITLE_EXTS = {".vtt", ".srt"}
COVER_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

VIDEO_MIME = {".mp4": "video/mp4", ".webm": "video/webm"}


def ensure_upload_dirs() -> None:
    for sub in ("videos", "subtitles", "covers", "recordings", "imports", "temp", "logs"):
        (settings.upload_root / sub).mkdir(parents=True, exist_ok=True)


def _ext_of(upload: UploadFile) -> str:
    return Path(upload.filename or "").suffix.lower()


def validate_ext(upload: UploadFile, allowed: set[str], label: str) -> str:
    ext = _ext_of(upload)
    if ext not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"{label}格式不支持：{ext or '未知'}，仅支持 {' / '.join(sorted(allowed))}",
        )
    return ext


def save_upload(upload: UploadFile, subdir: str, ext: str, max_mb: int, label: str) -> Path:
    """流式保存上传文件，返回磁盘路径。超过大小限制时抛错并清理。"""
    ensure_upload_dirs()
    dest = settings.upload_root / subdir / f"{uuid.uuid4().hex}{ext}"
    max_bytes = max_mb * 1024 * 1024
    written = 0
    try:
        with dest.open("wb") as f:
            while True:
                chunk = upload.file.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > max_bytes:
                    raise HTTPException(status_code=400, detail=f"{label}超过大小限制（{max_mb}MB）")
                f.write(chunk)
    except Exception:
        dest.unlink(missing_ok=True)
        raise
    if written == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"{label}是空文件")
    return dest


def unique_path(subdir: str, ext: str, stem: str = "file") -> Path:
    ensure_upload_dirs()
    clean_ext = ext if ext.startswith(".") else f".{ext}"
    safe_stem = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in stem).strip("_")
    if not safe_stem:
        safe_stem = "file"
    return settings.upload_root / subdir / f"{safe_stem}_{uuid.uuid4().hex[:10]}{clean_ext}"


def public_url(path: Path) -> str:
    rel = path.relative_to(settings.upload_root).as_posix()
    return f"{settings.base_url}/uploads/{rel}"


def delete_file(path_str: str | None) -> None:
    if not path_str:
        return
    try:
        p = Path(path_str)
        if p.is_file():
            p.unlink()
    except OSError:
        pass


def delete_dir_if_exists(path: Path) -> None:
    if path.is_dir():
        shutil.rmtree(path, ignore_errors=True)
