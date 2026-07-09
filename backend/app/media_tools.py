from __future__ import annotations

import json
import subprocess
from pathlib import Path
from uuid import uuid4

from .config import get_settings
from .storage import settings, unique_path
from .task_logger import TaskLogger


class CommandError(RuntimeError):
    def __init__(self, message: str, stdout: str = "", stderr: str = ""):
        super().__init__(message)
        self.stdout = stdout
        self.stderr = stderr


YOUTUBE_EXTRACTOR_ARG_ATTEMPTS: tuple[str | None, ...] = (
    None,
    "youtube:player_client=default,-android_vr",
    "youtube:player_client=web_embedded,web,ios,mweb",
    "youtube:player_client=tv,web_embedded,ios",
)


def run_command(args: list[str], logger: TaskLogger | None = None, timeout: int | None = None) -> subprocess.CompletedProcess:
    if logger:
        logger.command(args)
    try:
        completed = subprocess.run(
            args,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except FileNotFoundError as exc:
        tool = Path(args[0]).name
        if tool in {"ffmpeg", "ffprobe"}:
            raise CommandError(
                f"找不到 {tool}。请安装 FFmpeg 并把 ffmpeg/ffprobe 加入系统 PATH，"
                "或者使用项目的 docker compose 启动后端和 worker。"
            ) from exc
        if tool == "yt-dlp":
            raise CommandError("找不到 yt-dlp。请安装后端依赖，或使用 docker compose 启动。") from exc
        raise CommandError(f"找不到外部命令：{tool}") from exc
    if logger and completed.stdout:
        logger.write(completed.stdout)
    if logger and completed.stderr:
        logger.write(completed.stderr)
    if completed.returncode != 0:
        raise CommandError(f"Command failed with exit code {completed.returncode}", completed.stdout, completed.stderr)
    return completed


def run_ytdlp_with_fallbacks(base_args: list[str], logger: TaskLogger | None, timeout: int | None) -> subprocess.CompletedProcess:
    errors: list[str] = []
    for extractor_args in YOUTUBE_EXTRACTOR_ARG_ATTEMPTS:
        args = ["yt-dlp", "--js-runtimes", "node"]
        if extractor_args:
            args += ["--extractor-args", extractor_args]
        args += base_args
        try:
            return run_command(args, logger=logger, timeout=timeout)
        except CommandError as exc:
            errors.append("\n".join(part for part in [str(exc), exc.stderr.strip()] if part))
            if logger:
                logger.write("yt-dlp attempt failed; trying next extractor client set")
    raise CommandError("All yt-dlp extractor client attempts failed", stderr="\n\n".join(errors))


def probe_media(path: Path, logger: TaskLogger | None = None) -> dict:
    completed = run_command(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        logger=logger,
    )
    return json.loads(completed.stdout)


def media_summary(probe: dict) -> dict:
    fmt = probe.get("format") or {}
    duration = fmt.get("duration")
    return {
        "duration": float(duration) if duration else None,
        "container_format": fmt.get("format_name"),
        "metadata_json": probe,
    }


def normalize_tracks(probe: dict) -> list[dict]:
    tracks: list[dict] = []
    for stream in probe.get("streams", []):
        codec_type = stream.get("codec_type")
        if codec_type not in {"video", "audio", "subtitle"}:
            continue
        tags = stream.get("tags") or {}
        duration = stream.get("duration") or (probe.get("format") or {}).get("duration")
        bit_rate = stream.get("bit_rate")
        tracks.append(
            {
                "track_type": codec_type,
                "stream_index": int(stream["index"]),
                "codec": stream.get("codec_name"),
                "language": tags.get("language"),
                "duration": float(duration) if duration else None,
                "width": stream.get("width"),
                "height": stream.get("height"),
                "bit_rate": int(bit_rate) if bit_rate and str(bit_rate).isdigit() else None,
                "raw_json": stream,
            }
        )
    return tracks


def get_ytdlp_info(url: str, logger: TaskLogger | None = None) -> dict:
    completed = run_ytdlp_with_fallbacks(["--dump-single-json", "--no-playlist", url], logger=logger, timeout=180)
    return json.loads(completed.stdout)


def download_url(url: str, video_id: int, logger: TaskLogger | None = None) -> Path:
    imports_dir = settings.upload_root / "imports"
    imports_dir.mkdir(parents=True, exist_ok=True)
    prefix = f"url_{video_id}_{uuid4().hex[:8]}"
    template = imports_dir / f"{prefix}.%(ext)s"
    run_ytdlp_with_fallbacks(
        [
            "--no-playlist",
            "-f",
            "bv*[ext=mp4][vcodec^=avc1]+ba[ext=m4a]/bv*[vcodec^=avc1]+ba[acodec^=mp4a]/b[ext=mp4]/bv*+ba/best",
            "--merge-output-format",
            "mp4",
            "-o",
            str(template),
            url,
        ],
        logger=logger,
        timeout=None,
    )
    candidates = sorted(imports_dir.glob(f"{prefix}.*"), key=lambda item: item.stat().st_mtime, reverse=True)
    if not candidates:
        raise CommandError("yt-dlp finished but no output file was created")
    return candidates[0]


def extract_cover(media_path: Path, video_id: int, logger: TaskLogger | None = None) -> Path:
    cover_path = unique_path("covers", "jpg", f"video_{video_id}")
    run_command(
        ["ffmpeg", "-y", "-ss", "00:00:01", "-i", str(media_path), "-frames:v", "1", str(cover_path)],
        logger=logger,
    )
    return cover_path


def extract_subtitle_track(media_path: Path, stream_index: int, output_format: str, logger: TaskLogger | None = None) -> Path:
    output_path = unique_path("subtitles", output_format, f"stream_{stream_index}")
    codec = "srt" if output_format == "srt" else "webvtt"
    run_command(
        ["ffmpeg", "-y", "-i", str(media_path), "-map", f"0:{stream_index}", "-c:s", codec, str(output_path)],
        logger=logger,
    )
    return output_path


def extract_audio_for_transcription(media_path: Path, stream_index: int, logger: TaskLogger | None = None) -> Path:
    output_path = unique_path("temp", "wav", f"audio_{stream_index}")
    run_command(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(media_path),
            "-map",
            f"0:{stream_index}",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(output_path),
        ],
        logger=logger,
    )
    return output_path


def seconds_to_srt_time(seconds: float) -> str:
    total_ms = max(0, int(round(seconds * 1000)))
    ms = total_ms % 1000
    total_seconds = total_ms // 1000
    s = total_seconds % 60
    total_minutes = total_seconds // 60
    m = total_minutes % 60
    h = total_minutes // 60
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def write_srt(path: Path, segments: list[dict]) -> None:
    lines: list[str] = []
    for index, segment in enumerate(segments, start=1):
        lines.append(str(index))
        lines.append(f"{seconds_to_srt_time(segment['start_seconds'])} --> {seconds_to_srt_time(segment['end_seconds'])}")
        lines.append(str(segment["text"]).strip())
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def clean_subtitle_text(text: str) -> str:
    return " ".join(text.replace("\n", " ").split()).strip()


def subtitle_text_len(text: str) -> int:
    return len(clean_subtitle_text(text).replace(" ", ""))


def split_whisper_segment_words(segment: object, sequence: int, max_chars: int, max_seconds: float) -> tuple[list[dict], int]:
    words = [
        {
            "text": str(getattr(word, "word", "") or ""),
            "start": float(getattr(word, "start", 0.0) or 0.0),
            "end": float(getattr(word, "end", 0.0) or 0.0),
        }
        for word in (getattr(segment, "words", None) or [])
    ]
    if not words:
        return [
            {
                "sequence": sequence,
                "start_seconds": float(getattr(segment, "start", 0.0)),
                "end_seconds": float(getattr(segment, "end", 0.0)),
                "text": clean_subtitle_text(getattr(segment, "text", "")),
            }
        ], sequence + 1

    rows: list[dict] = []
    chunk: list[dict] = []
    hard_breaks = set(".!?;:")
    soft_breaks = set(",")

    def flush() -> None:
        nonlocal sequence, chunk
        text = clean_subtitle_text("".join(item["text"] for item in chunk))
        if text:
            rows.append(
                {
                    "sequence": sequence,
                    "start_seconds": chunk[0]["start"],
                    "end_seconds": max(chunk[-1]["end"], chunk[0]["start"] + 0.15),
                    "text": text,
                }
            )
            sequence += 1
        chunk = []

    for word in words:
        if not word["text"]:
            continue
        projected = chunk + [word]
        projected_text = clean_subtitle_text("".join(item["text"] for item in projected))
        projected_duration = projected[-1]["end"] - projected[0]["start"]
        if chunk and (subtitle_text_len(projected_text) > max_chars or projected_duration > max_seconds):
            flush()
        chunk.append(word)
        current_text = clean_subtitle_text("".join(item["text"] for item in chunk))
        last_char = clean_subtitle_text(word["text"])[-1:] if clean_subtitle_text(word["text"]) else ""
        current_duration = chunk[-1]["end"] - chunk[0]["start"]
        if last_char in hard_breaks or (
            last_char in soft_breaks and (subtitle_text_len(current_text) >= max_chars * 0.75 or current_duration >= max_seconds * 0.75)
        ):
            flush()
    if chunk:
        flush()
    return rows, sequence


def transcribe_audio(
    audio_path: Path,
    language: str | None,
    logger: TaskLogger | None = None,
    split_enabled: bool = False,
    max_chars: int = 42,
    max_seconds: float = 5.0,
) -> tuple[Path, list[dict]]:
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise CommandError(f"faster-whisper import failed: {exc}") from exc

    whisper_settings = get_settings()
    if logger:
        logger.write(
            f"Loading faster-whisper model={whisper_settings.whisper_model_size} "
            f"device={whisper_settings.whisper_device} compute={whisper_settings.whisper_compute_type}"
        )
    model = WhisperModel(
        whisper_settings.whisper_model_size,
        device=whisper_settings.whisper_device,
        compute_type=whisper_settings.whisper_compute_type,
    )
    segments_iter, info = model.transcribe(str(audio_path), language=language, vad_filter=True, word_timestamps=split_enabled)
    if logger:
        logger.write(f"Detected language={info.language} probability={info.language_probability}")
    segments: list[dict] = []
    sequence = 1
    for index, segment in enumerate(segments_iter, start=1):
        if split_enabled:
            rows, sequence = split_whisper_segment_words(segment, sequence, max_chars, max_seconds)
            segments.extend(rows)
        else:
            segments.append(
                {
                    "sequence": index,
                    "start_seconds": float(segment.start),
                    "end_seconds": float(segment.end),
                    "text": str(segment.text).strip(),
                }
            )
    subtitle_path = unique_path("subtitles", "srt", "whisper_subtitle")
    write_srt(subtitle_path, segments)
    return subtitle_path, segments
