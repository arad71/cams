from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    APP_NAME: str = "Kalamunda Crossover Application Portal"
    DEBUG: bool = False

    DATABASE_URL: str = "postgresql://kalamunda_user:kalamunda_pass@localhost:5432/kalamunda_applicant_db"

    SECRET_KEY: str = "change-me-to-a-random-64-char-string"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours for applicants

    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:5173"
    UPLOAD_DIR: str = "./uploads"
    MAX_FILE_SIZE_MB: int = 25

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]

    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
