from typing import Optional, List, Dict, Any
from pydantic import BaseModel

class ExtractionAppResponse(BaseModel):
    form_title: str
    source_file: Optional[str]
    source_page: int
    extraction_methods: Dict[str, int]
    summary: Dict[str, int]
    fields: List[Dict[str, Any]]
    values: Dict[str, Any]
    debug_logs: Optional[List[str]] = None