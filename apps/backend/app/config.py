from __future__ import annotations

from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./mvp.db"
    SECRET_KEY: str = "change-me"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    CORS_ORIGINS: list[str] = ["*"]
    PLATFORM_COMMISSION_PERCENT: float = 10.0
    GOOGLE_MAPS_API_KEY: str = ""

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_origins(cls, value):
        if isinstance(value, str):
            value = value.strip()
            if value.startswith("["):
                import json

                return json.loads(value)
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    class Config:
        env_file = ".env"


settings = Settings()
