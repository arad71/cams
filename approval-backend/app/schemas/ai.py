# app/schemas/ai.py
from typing import Optional, Dict, Any
from pydantic import BaseModel

class FindingsResponse(BaseModel):
    schema_version: str
    analyser_version: str
    analysed_at: str
    source_file: Optional[str]
    source_pages: int
    ai_provider: str
    ai_model: str
    guideline: Dict[str, str]
    extraction: Dict[str, Any]
    compliance: Dict[str, Any]

class ErrorResponse(BaseModel):
    error: str
    raw_response: Optional[str] = None
    analysed_at: str
    source_file: Optional[str]