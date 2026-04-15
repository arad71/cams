"""
Lightweight local OCR extraction endpoint.

POST /extract-local-ocr
  Accepts: file upload + type (application_form | certificate_of_title)
  Returns: {fields, confidence}
  No application ID needed — used by create-application form.
"""
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
import tempfile
from pathlib import Path

router = APIRouter(prefix="", tags=["Local OCR"])


@router.post("/extract-local-ocr")
async def extract_local_ocr(
    file: UploadFile = File(...),
    type: str = Form("application_form"),
):
    """Run local OCR extraction on an uploaded file. No auth required — no data saved."""
    if type not in ("application_form", "certificate_of_title"):
        raise HTTPException(400, "type must be application_form or certificate_of_title")

    try:
        pdf_bytes = await file.read()
        if not pdf_bytes:
            raise HTTPException(400, "Empty file")

        # Write to temp file for the extractor
        suffix = ".pdf" if file.content_type == "application/pdf" else ".png"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(pdf_bytes)
            tmp_path = tmp.name

        from app.services.local_extractor import extract_local
        result = extract_local(tmp_path, type)

        # Cleanup
        Path(tmp_path).unlink(missing_ok=True)

        return {
            "fields": result.get("fields", {}),
            "confidence": result.get("confidence", {}),
            "method": "local_ocr",
        }
    except Exception as e:
        raise HTTPException(500, f"Extraction failed: {e}")
