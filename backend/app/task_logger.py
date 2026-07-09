from __future__ import annotations

from datetime import datetime
from pathlib import Path

from .storage import settings


class TaskLogger:
    def __init__(self, task_id: int):
        log_dir = settings.upload_root / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        self.path = log_dir / f"task_{task_id}.log"

    def write(self, message: str) -> None:
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with self.path.open("a", encoding="utf-8", errors="replace") as handle:
            handle.write(f"[{timestamp}] {message.rstrip()}\n")

    def command(self, args: list[str]) -> None:
        self.write("$ " + " ".join(args))


def read_log(path: str | None) -> str:
    if not path:
        return ""
    log_path = Path(path)
    if not log_path.exists():
        return ""
    return log_path.read_text(encoding="utf-8", errors="replace")
