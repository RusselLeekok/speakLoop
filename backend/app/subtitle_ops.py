from __future__ import annotations

from pathlib import Path

from sqlalchemy.orm import Session

from . import storage
from .models import Subtitle, SubtitleSource, SubtitleWarning, Video
from .subtitle_parser import Cue, SubtitleParseError, merge_zh_into_en, parse_subtitle


def clear_subtitle_data(db: Session, video: Video, clear_sources: bool = True) -> None:
    for sub in list(video.subtitles):
        db.delete(sub)
    for warning in list(video.warnings):
        db.delete(warning)
    if clear_sources:
        for source in list(video.subtitle_sources):
            storage.delete_file(source.file_path)
            db.delete(source)
    video.subtitle_count = 0


def parse_pair(
    en_data: bytes,
    en_name: str,
    zh_data: bytes | None,
    zh_name: str | None,
    video_duration: float | None,
) -> tuple[list[Cue], list[str | None], list[str]]:
    warnings: list[str] = []
    en_result = parse_subtitle(en_data, en_name)
    warnings.extend(f"English subtitle: {warning}" for warning in en_result.warnings)
    en_cues = en_result.cues

    zh_texts: list[str | None] = [None] * len(en_cues)
    if zh_data is not None:
        try:
            zh_result = parse_subtitle(zh_data, zh_name or "")
        except SubtitleParseError as exc:
            raise SubtitleParseError(f"Chinese subtitle parse failed: {exc}") from exc
        warnings.extend(f"Chinese subtitle: {warning}" for warning in zh_result.warnings)
        zh_texts, merge_warnings = merge_zh_into_en(en_cues, zh_result.cues)
        warnings.extend(merge_warnings)

    if video_duration and video_duration > 0 and en_cues:
        last_end = en_cues[-1].end_ms
        duration_ms = int(video_duration * 1000)
        if last_end > duration_ms + 3000:
            warnings.append(
                f"Subtitle ending ({last_end / 1000:.1f}s) is much longer than video duration ({video_duration:.1f}s)."
            )
    return en_cues, zh_texts, warnings


def save_subtitle_source(
    db: Session,
    video: Video,
    file_name: str,
    path: Path,
    data: bytes,
    language: str,
) -> None:
    db.add(
        SubtitleSource(
            video_id=video.id,
            language=language,
            file_name=file_name,
            file_path=str(path),
            raw_content=data.decode("utf-8", errors="replace"),
            format=path.suffix.lower().lstrip("."),
        )
    )


def apply_parsed_subtitles(
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
                zh_text=zh_texts[order] if order < len(zh_texts) else None,
                sort_order=order,
            )
        )
    for message in warnings:
        db.add(SubtitleWarning(video_id=video.id, warning_type="subtitle", message=message))
    video.subtitle_count = len(en_cues)


def replace_with_subtitle_files(
    db: Session,
    video: Video,
    en_path: Path,
    en_name: str,
    zh_path: Path | None = None,
    zh_name: str | None = None,
    keep_sources: bool = False,
) -> list[str]:
    en_data = en_path.read_bytes()
    zh_data = zh_path.read_bytes() if zh_path is not None else None
    en_cues, zh_texts, warnings = parse_pair(en_data, en_name, zh_data, zh_name, video.duration)
    clear_subtitle_data(db, video, clear_sources=not keep_sources)
    save_subtitle_source(db, video, en_name, en_path, en_data, "en")
    if zh_path is not None and zh_data is not None:
        save_subtitle_source(db, video, zh_name or zh_path.name, zh_path, zh_data, "zh")
    apply_parsed_subtitles(db, video, en_cues, zh_texts, warnings)
    return warnings


def replace_with_whisper_segments(db: Session, video: Video, source_path: Path, segments: list[dict]) -> None:
    clear_subtitle_data(db, video)
    data = source_path.read_bytes()
    save_subtitle_source(db, video, source_path.name, source_path, data, "en")
    for order, segment in enumerate(segments):
        db.add(
            Subtitle(
                video_id=video.id,
                start_ms=int(round(float(segment["start_seconds"]) * 1000)),
                end_ms=int(round(float(segment["end_seconds"]) * 1000)),
                en_text=str(segment.get("text") or "").strip(),
                zh_text=None,
                sort_order=order,
            )
        )
    video.subtitle_count = len(segments)
