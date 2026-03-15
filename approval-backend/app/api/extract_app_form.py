from pathlib import Path

from fastapi import APIRouter, UploadFile, File, Query, HTTPException
from app.models.extract_app_form import ExtractionAppResponse
from app.services.extractor_app_form import read_application, get_field_map_brief
from app.core.config import DEFAULT_OCR_MIN_CONFIDENCE, DEFAULT_DPI
from app.services.address_to_geo import find_lot_geometry_for_address
import json

router = APIRouter(prefix="", tags=["extract_app_form"])

@router.get("/field-map")
def field_map():
    return get_field_map_brief()

@router.post("/extract_app_form", response_model=ExtractionAppResponse)
async def extract(
    file: UploadFile = File(...),
    include_image_analysis: bool = Query(True),
    ocr_min_confidence: int = Query(DEFAULT_OCR_MIN_CONFIDENCE, ge=0, le=100),
    dpi: int = Query(DEFAULT_DPI, ge=72, le=600),
    include_debug: bool = Query(False),
):
    if file.content_type not in {"application/pdf", "application/octet-stream"}:
        raise HTTPException(status_code=415, detail="Unsupported content type; please upload a PDF.")

    try:
        pdf_bytes = await file.read()
        if not pdf_bytes:
            raise HTTPException(status_code=400, detail="Empty file.")
        result = read_application(
            pdf_bytes,
            include_image_analysis=include_image_analysis,
            ocr_min_conf=ocr_min_confidence,
            dpi=dpi,
            debug=include_debug,
        )
        result["source_file"] = file.filename
        print(f"Address extracted: {result['values']['property_address']}")
        
        # --- demo ------------------------------------------------------------------------

     
        path = Path("source_file/lot.geojson")

        # Example queries that should match your sample rows:
        # - "54 Stirling Cr High Wycombe"
        # - "54 Stirling Crescent, High Wycombe"
        # - "2 Maud Rd Maida Vale"

        geom = find_lot_geometry_for_address(path, addr)
        if geom:
                        print(f"Address: {addr}")
                        print("Lot geometry (GeoJSON):")
                        print(json.dumps(geom, indent=2))
                        print("-" * 60)
        else:
                        print(f"No match found for: {addr}")
                   
        return result
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except RuntimeError as re_err:
        raise HTTPException(status_code=500, detail=str(re_err))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")