# from pydantic_settings import BaseSettings
# from functools import lru_cache
# import os

# class Settings(BaseSettings):
#     APP_NAME: str = "Kalamunda Crossover Approval System"
#     DEBUG: bool = False

#     # Database
#     DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/cams_approval"

#     # JWT
#     SECRET_KEY: str = "change-me-to-a-random-64-char-string"
#     ALGORITHM: str = "HS256"
#     ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

#     # CORS
#     CORS_ORIGINS: str = "http://localhost:3000,http://localhost:5173"


#     # === AI / Claude analyser settings ===
#     # ANTHROPIC_API_KEY: str =os.getenv("ANTHROPIC_API_KEY","")
#     # AI_MODEL_DEFAULT: str =os.getenv("AI_MODEL_DEFAULT", "claude-sonnet-4-20250514")
#     # PDF_RENDER_DPI: int = int(os.getenv("PDF_RENDER_DPI", "200"))
#     # MAX_IMAGE_DIM: int = int(os.getenv("MAX_IMAGE_DIM", "2048"))
#     # AI_MAX_TOKENS: int = int(os.getenv("AI_MAX_TOKENS", "4096"))
#     ANTHROPIC_API_KEY: str =""
#     AI_MODEL_DEFAULT: str ="claude-sonnet-4-20250514"
#     PDF_RENDER_DPI: int = 200
#     MAX_IMAGE_DIM: int = 2048
#     AI_MAX_TOKENS: int = 4096

#     @property
#     def cors_origins_list(self) -> list[str]:
#         return [o.strip() for o in self.CORS_ORIGINS.split(",")]

#     class Config:
#         env_file = ".env"
#         case_sensitive = True


# @lru_cache
# def get_settings() -> Settings:
#     return Settings()



# # Configurable flags/defaults
# DEFAULT_DPI = int(os.getenv("OCR_RENDER_DPI", "200"))
# DEFAULT_OCR_MIN_CONFIDENCE = int(os.getenv("OCR_MIN_CONFIDENCE", "60"))

# # Constants ported from your script
# ENTRY_X_MIN = 170
# SIG_INK_THRESHOLD = 0.005
# SIG_DARK_PIXEL_MAX = 150
# SIG_BORDER_MARGIN = 4
# OCR_UPSCALE = 3

# TEMPLATE_WORDS = {
#     "by","signing","this","the","declares","that","they","will","construct","crossover",
#     "in","accordance","with","specification","for","construction","and","ensure","protection",
#     "of","trees","vegetation","verge","please","attach","a","site","plan","clearly",
#     "dimensioned","showing","all","details","required","specifications","office","use","only",
#     "assessment","notes","sign","date","authorisation","enquiries","may","be","directed","to",
#     "asset","services","team","calling","city","on","or","emailing","allow","three","weeks",
#     "processing","application","form","is","require","d","crossovers","must","completed","lot",
#     "owner","owner's","number","attachments","estimated","construction","development","building",
#     "if","applicable","applicable)","postal","address","property","requiring","phone","email",
#     "signature","name:","phone:","email:",
# }

# STATIC_PHRASES = [
#     "OFFICE USE ONLY","Assessment Notes","Sign and Date for","Authorisation of Crossover",
#     "Construction","Please attach a site plan","clearly dimensioned",
#     "showing all details required in the Specifications",
# ]


from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from functools import lru_cache
import os


class Settings(BaseSettings):
    APP_NAME: str = "Kalamunda Crossover Approval System"
    DEBUG: bool = False

    # Database
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/cams_approval"

    # JWT
    SECRET_KEY: str = "change-me-to-a-random-64-char-string"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    # CORS
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:5173"

    # === AI / Claude analyser settings ===
    # IMPORTANT: do not cast with int(os.getenv(...)) here; let Pydantic parse and
    # ignore empty env values so defaults apply.
    ANTHROPIC_API_KEY: str | None = Field(default=None)
    AI_MODEL_DEFAULT: str = Field(default="claude-sonnet-4-20250514")
    PDF_RENDER_DPI: int = Field(default=200)
    MAX_IMAGE_DIM: int = Field(default=2048)
    AI_MAX_TOKENS: int = Field(default=4096)

    # Document storage
    DOCUMENT_DIR: str = Field(default="./uploads/documents")

    # Pydantic v2 settings config
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="",          # if you want APP_ prefix, set to "APP_" and rename env vars
        extra="ignore",         # ignore unknown env vars (Docker sets many like HOSTNAME, PATH, etc)
        populate_by_name=True,
        env_ignore_empty=True,  # <-- CRITICAL: empty strings ('') won't override defaults
    )

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

@lru_cache
def get_settings() -> Settings:
    return Settings()


# ─────────────────────────────────────────────────────────────────────────────
# Robust helpers for raw env fallbacks below the Settings class
# (if OCR_* vars are blank, fall back to defaults instead of crashing)
def _int_env(name: str, default: int) -> int:
    v = os.getenv(name)
    if v is None or v.strip() == "":
        return default
    try:
        return int(v)
    except ValueError:
        return default

# Configurable flags/defaults
DEFAULT_DPI = _int_env("OCR_RENDER_DPI", 200)
DEFAULT_OCR_MIN_CONFIDENCE = _int_env("OCR_MIN_CONFIDENCE", 60)

# Constants ported from your script
ENTRY_X_MIN = 170
SIG_INK_THRESHOLD = 0.005
SIG_DARK_PIXEL_MAX = 150
SIG_BORDER_MARGIN = 4
OCR_UPSCALE = 3

TEMPLATE_WORDS = {
    "by","signing","this","the","declares","that","they","will","construct","crossover",
    "in","accordance","with","specification","for","construction","and","ensure","protection",
    "of","trees","vegetation","verge","please","attach","a","site","plan","clearly",
    "dimensioned","showing","all","details","required","specifications","office","use","only",
    "assessment","notes","sign","date","authorisation","enquiries","may","be","directed","to",
    "asset","services","team","calling","city","on","or","emailing","allow","three","weeks",
    "processing","application","form","is","require","d","crossovers","must","completed","lot",
    "owner","owner's","number","attachments","estimated","construction","development","building",
    "if","applicable","applicable)","postal","address","property","requiring","phone","email",
    "signature","name:","phone:","email:",
}

STATIC_PHRASES = [
    "OFFICE USE ONLY","Assessment Notes","Sign and Date for","Authorisation of Crossover",
    "Construction","Please attach a site plan","clearly dimensioned",
    "showing all details required in the Specifications",
]

settings = get_settings()
