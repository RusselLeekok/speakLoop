from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "mysql+pymysql://root:root@127.0.0.1:3306/speakloop?charset=utf8mb4"
    redis_url: str = "redis://127.0.0.1:6379/0"
    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440

    base_url: str = "http://localhost:8000"
    cors_origins: str = "http://localhost:3000"
    upload_dir: str = "uploads"

    auto_create_tables: bool = True
    seed_default_users: bool = True
    admin_username: str = "admin"
    admin_password: str = "admin123456"
    demo_username: str = "user"
    demo_password: str = "user123456"

    max_video_size_mb: int = 2048
    max_subtitle_size_mb: int = 5
    max_cover_size_mb: int = 10

    whisper_model_size: str = "small"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def upload_root(self) -> Path:
        root = Path(__file__).resolve().parent.parent / self.upload_dir
        return root


@lru_cache
def get_settings() -> Settings:
    return Settings()
