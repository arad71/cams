# app/services/ai_analyser.py
from __future__ import annotations
import base64
import io
import json
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List

from app.core.config import settings

# --- Optional deps (degrade with explicit errors) ---
try:
    from PIL import Image
except Exception as e:
    raise RuntimeError("Pillow is required. Install with 'pip install Pillow'") from e

try:
    from pdf2image import convert_from_bytes
    PDF2IMAGE_AVAILABLE = True
except Exception:
    PDF2IMAGE_AVAILABLE = False

try:
    import anthropic
    ANTHROPIC_AVAILABLE = True
except Exception:
    ANTHROPIC_AVAILABLE = False


# ═════════════════════════════════════════════════════════════════════════════
# 1) GUIDELINE (unchanged from your script)
# ═════════════════════════════════════════════════════════════════════════════

GUIDELINE = {
    "name": "Council Crossover Guideline",
    "version": "3.1",
    "date": "23/06/2022",
    "rules": {
        "residential_min_width_m": 3.0,
        "residential_min_at_road_m": 6.0,
        "standard_wing_m": 1.5,
        "min_wing_special_m": 1.0,
        "max_width_frontage_under_12_5m": 3.0,
        "max_width_frontage_over_12_5m": 6.0,
        "max_width_double_garage_m": 4.5,
        "secondary_min_lot_frontage_m": 20.0,
        "secondary_min_from_intersection_m": 6.0,
        "max_combined_boundary_m": 9.0,
        "max_combined_kerb_m": 15.0,
        "concrete_min_thickness_mm": 100,
        "concrete_min_strength_mpa": 32,
        "commercial_min_thickness_mm": 150,
        "asphalt_min_thickness_mm": 25,
        "base_course_min_mm": 150,
        "compaction_pct": 95,
        "expansion_joints_min": 2,
        "tree_min_spacing_m": 3.0,
        "alignment_degrees": 90,
        "allowed_materials": [
            "Asphalt", "Concrete", "Brick/block paving", "Two-coat chip seal"
        ],
    },
}

# ═════════════════════════════════════════════════════════════════════════════
# 2) PROMPTS
# ═════════════════════════════════════════════════════════════════════════════

SYSTEM_PROMPT = """You are a crossover siteplan document analyser for the Council, Western Australia.

A "crossover" is the driveway from the edge of the road surface to the property boundary.

Examine ALL provided document pages (site plans, engineering drawings, photos, proposals) and
extract ONLY crossover-related information.

Return ONLY a raw JSON object — no markdown, no commentary, no code fences.

{
  "property": {
    "lot_number": "string or null",
    "street_address": "string or null",
    "suburb": "string or null",
    "project_number": "string or null",
    "client_name": "string or null",
    "date": "string or null",
    "drawing_title": "string or null",
    "prepared_by": "string or null",
    "is_corner_lot": "boolean or null — true if lot is on a corner of two roads",
    "is_battleaxe": "boolean or null — true if rear lot accessed via narrow driveway leg",
    "da_linked": "boolean or null — true if crossover is part of a Development Approval"
  },
  "crossover_dimensions": {
    "width_at_boundary_m": "number or null — width at property boundary (min 3.0m per R-083)",
    "splay_left_m": "number or null — left wing/flare (standard 1.5m per R-083)",
    "splay_right_m": "number or null — right wing/flare (standard 1.5m per R-083)",
    "total_width_at_road_m": "number or null — total where it meets road (max 6.0m per R-083)",
    "verge_depth_m": "number or null — property boundary to road edge",
    "crossover_length_m": "number or null",
    "alignment_degrees": "number or null — angle of crossover to road centreline (should be ~90° per R-081)",
    "driveway_centreline_point_2_5m": "string or null — position 2.5m back from verge on driveway centreline (for sight triangle Point A), describe location",
    "distance_to_left_boundary_m": "number or null — driveway edge to left side boundary (min 0.5m)",
    "distance_to_right_boundary_m": "number or null — driveway edge to right side boundary (min 0.5m)",
    "distance_to_nearest_lot_corner_m": "number or null — driveway edge to nearest lot corner",
    "nearest_lot_corner": "string or null — which corner (e.g. 'SW corner', 'front-left')",
    "distance_to_intersection_tangent_m": "number or null — distance from crossover to nearest intersection tangent point (min 6.0m per R-100)",
    "distance_to_building_corner_m": "number or null — driveway to nearest building corner",
    "nearest_building_corner": "string or null — which building corner"
  },
  "construction": {
    "material": "string or null — Concrete, Asphalt, Brick paving, etc. (per R-120 permitted list)",
    "thickness_mm": "number or null — surface thickness",
    "base_course_specified": "boolean or null — whether base course is shown/specified",
    "base_course_depth_mm": "number or null — base course depth (min 150mm per R-122)",
    "compaction_mdd_pct": "number or null — compaction specification (should be 95% MDD per R-121)",
    "expansion_joints": "boolean or null — concrete must have min 2 expansion joints (R-126)",
    "kerb_type": "string or null — Mountable, Semi-mountable, Barrier, Edge of seal (R-140)",
    "footpath_exists": "boolean or null — is there a footpath at crossover location",
    "footpath_flush_join": "boolean or null — does crossover meet flush with footpath (R-110)",
    "construction_standard": "string or null — Type 1 (urban, fully sealed) or Type 2 (rural, trafficable) per R-030"
  },
  "siteplan_measurements": {
    "property_boundary_to_road_m": "number or null",
    "existing_driveway_width_m": "number or null",
    "road_name": "string or null",
    "road_speed_zone_kmh": "number or null — speed limit on the road",
    "road_classification": "string or null — local, distributor, regional (red/blue), RAV route",
    "lot_frontage_m": "number or null — lot frontage width (affects max crossover width: ≤12.5m→3.0m, >12.5m→6.0m per R-084/R-086)",
    "lot_depth_m": "number or null",
    "lot_areas_m2": "object — e.g. {\"Lot 20\": 350}",
    "total_area_m2": "number or null",
    "building_setback_front_m": "number or null — building to front boundary",
    "building_setback_left_m": "number or null — building to left boundary",
    "building_setback_right_m": "number or null — building to right boundary",
    "building_setback_rear_m": "number or null — building to rear boundary",
    "number_of_crossovers": "number or null — how many crossovers on this lot (second requires >20m frontage per R-100)",
    "all_dimensions_found": "array of strings — every measurement on the drawings"
  },
  "utilities": {
    "power_line_shown": "boolean or null — overhead or underground power shown",
    "power_conflict": "boolean or null — power line/pole conflicts with crossover",
    "power_notes": "string or null",
    "water_main_shown": "boolean or null",
    "water_conflict": "boolean or null — water main/meter conflicts with crossover",
    "water_notes": "string or null",
    "gas_main_shown": "boolean or null",
    "gas_conflict": "boolean or null — gas pipe conflicts with crossover",
    "gas_notes": "string or null",
    "telco_shown": "boolean or null — phone/NBN/fibre shown",
    "telco_conflict": "boolean or null — telco conflicts with crossover",
    "telco_notes": "string or null",
    "sewer_shown": "boolean or null",
    "sewer_conflict": "boolean or null — sewer main/manhole conflicts",
    "sewer_notes": "string or null",
    "stormwater_drain_shown": "boolean or null",
    "stormwater_conflict": "boolean or null",
    "stormwater_notes": "string or null",
    "utility_summary": "string or null — overall assessment of utility conflicts"
  },
  "drainage": {
    "drainage_plan_included": "boolean",
    "soakwells_proposed": "boolean",
    "storage_tanks_proposed": "boolean",
    "connection_to_council_drain": "boolean",
    "pipe_diameter_mm": "number or null",
    "stormwater_notes": "string or null"
  },
  "additional_findings": {
    "proposals_found": "array of strings",
    "adjacent_lots": "array of strings",
    "is_subdivision": "boolean",
    "is_development_application": "boolean",
    "vegetation_on_verge": "boolean or null — vegetation within 3m of crossover (R-056)",
    "trees_on_verge": "boolean or null — specific trees visible on verge area",
    "street_light_near_crossover": "boolean or null",
    "fire_hydrant_near_crossover": "boolean or null",
    "letterbox_relocation_needed": "boolean or null",
    "notes": "string or null"
  }
}

RULES:
- Read ALL measurements from drawings, including rotated and vertical text.
- Use numeric values (not strings) for measurements.
- Verge depth = distance from property boundary line to road edge.
- Distinguish crossover width (at boundary) from total width (at road, includes splays).
- ALIGNMENT: Check if crossover is perpendicular (90°) to road. Estimate alignment_degrees if visible.
- WIDTH RULES: Lot frontage ≤ 12.5m → max 3.0m (or 4.5m if double garage). Frontage > 12.5m → max 6.0m.
- BATTLEAXE: If rear lot with narrow access leg, mark is_battleaxe=true. Single: min 3.0m + 0.5m garden bed. Adjoining: 6.0m combined.
- UTILITIES: Look for any utility symbols, labels, or lines (power poles, water meters, gas mains, telco pits, sewer manholes, stormwater drains). Report conflicts if any utility is within or crosses the proposed crossover area.
- SETBACKS: Measure distance from driveway edge to left boundary, right boundary, nearest lot corner, and nearest building corner.
- CORNER LOT: Identify if the lot is on a corner (two road frontages). Corner lots have extended sight triangle requirements per AS 2890.1 §3.2.4.
- INTERSECTION TANGENT: Measure distance from crossover to nearest intersection tangent point. Must be ≥ 6.0m per R-100.
- DRIVEWAY CENTRELINE POINT: The point 2.5m back from the verge/road edge along the driveway centreline is the standard Point A for sight triangle analysis.
- FOOTPATH: If a footpath crosses the crossover, check if flush join is shown (R-110). For concrete, check colour/jointing delineation (R-111).
- CONSTRUCTION: Identify material, base course depth (min 150mm, R-122), compaction spec (95% MDD, R-121), expansion joints for concrete (min 2, R-126).
- SPEED ZONE: Note speed limit if shown on plan or inferable from road classification.
- SECOND CROSSOVER: If multiple crossovers shown, count them. Second requires lot boundary >20m and ≥6.0m from intersection tangent.
- Return ONLY valid JSON. Nothing else."""

USER_PROMPT = "Analyse the attached document page(s). Extract all crossover dimensions, construction specs, site plan measurements, utility locations and conflicts, drainage details, setbacks, property info, alignment, footpath details, and intersection distances. Check for corner lot, battleaxe, and DA-linked indicators. Return structured JSON."


# ═════════════════════════════════════════════════════════════════════════════
# 3) BYTES → PAGE IMAGES (base64)
# ═════════════════════════════════════════════════════════════════════════════

def file_to_images_from_upload(file_bytes: bytes, filename: str, max_dim: int | None = None) -> List[Dict[str, Any]]:
    max_dim = max_dim or settings.MAX_IMAGE_DIM
    ext = (Path(filename).suffix or "").lower()
    results: List[Dict[str, Any]] = []

    if ext == ".pdf":
        if not PDF2IMAGE_AVAILABLE:
            raise RuntimeError("pdf2image not available; install 'pdf2image' and system poppler.")
        pil_imgs = convert_from_bytes(file_bytes, dpi=settings.PDF_RENDER_DPI)
        raw_images = [{"pil": img, "page": i + 1} for i, img in enumerate(pil_imgs)]
    else:
        # Try as image; allow unknown extension if bytes are image content
        try:
            pil = Image.open(io.BytesIO(file_bytes))
            raw_images = [{"pil": pil, "page": 1}]
        except Exception:
            raise ValueError(f"Unsupported file '{filename}'. Use .pdf, .jpg, .jpeg, or .png, or send valid image bytes.")

    for item in raw_images:
        img = item["pil"].convert("RGB")
        if max(img.size) > max_dim:
            ratio = max_dim / max(img.size)
            img = img.resize((int(img.size[0] * ratio), int(img.size[1] * ratio)), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        results.append({
            "base64": base64.standard_b64encode(buf.getvalue()).decode(),
            "media_type": "image/png",
            "page": item["page"],
        })
    return results


# ═════════════════════════════════════════════════════════════════════════════
# 4) CLAUDE CALL + JSON PARSE
# ═════════════════════════════════════════════════════════════════════════════

def call_claude(images: List[Dict[str, Any]], api_key: str, model: str) -> str:
    if not ANTHROPIC_AVAILABLE:
        raise RuntimeError("anthropic SDK not available. Install with 'pip install anthropic'.")

    client = anthropic.Anthropic(api_key=api_key)

    content = []
    for img in images:
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": img["media_type"],
                "data": img["base64"],
            },
        })
    content.append({"type": "text", "text": USER_PROMPT})

    resp = client.messages.create(
        model=model,
        max_tokens=settings.AI_MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": content}],
    )
    return resp.content[0].text  # first text block

def parse_json_response(raw: str) -> Dict[str, Any]:
    text = raw.strip()
    # Strip accidental code fences
    if text.startswith("```"):
        lines = text.split("\n")[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    # Best-effort JSON slice
    start, end = text.find("{"), text.rfind("}") + 1
    if start >= 0 and end > start:
        text = text[start:end]
    return json.loads(text)


# ═════════════════════════════════════════════════════════════════════════════
# 5) COMPLIANCE ENGINE (unchanged logic)
# ═════════════════════════════════════════════════════════════════════════════

def check_compliance(data: Dict[str, Any]) -> Dict[str, Any]:
    R = GUIDELINE["rules"]
    dims = data.get("crossover_dimensions", {})
    cons = data.get("construction", {})
    drain = data.get("drainage", {})
    site = data.get("siteplan_measurements", {})

    checks = []

    def add(item, rule, required, found, status, note=None):
        entry = {"item": item, "rule": rule, "required": required, "found": found, "status": status}
        if note:
            entry["note"] = note
        checks.append(entry)

    # Width at boundary
    w = dims.get("width_at_boundary_m")
    if w is not None:
        ok = R["residential_min_width_m"] <= w <= R["max_width_frontage_over_12_5m"]
        add("Crossover width at boundary", "Section 9",
            f"{R['residential_min_width_m']}m – {R['max_width_frontage_over_12_5m']}m",
            f"{w}m", "PASS" if ok else "FAIL")
    else:
        add("Crossover width at boundary", "Section 9",
            "Must be dimensioned", "Not found", "REQUIRES_VERIFICATION")

    # Splays
    sl, sr = dims.get("splay_left_m"), dims.get("splay_right_m")
    if sl is not None and sr is not None:
        ok = sl >= R["min_wing_special_m"] and sr >= R["min_wing_special_m"]
        add("Wing/splay dimensions", "Section 9",
            f"Standard {R['standard_wing_m']}m, min {R['min_wing_special_m']}m",
            f"{sl}m / {sr}m", "PASS" if ok else "FAIL")
    else:
        add("Wing/splay dimensions", "Section 9", "Must be shown", "Not found", "REQUIRES_VERIFICATION")

    # Total width at road
    tw = dims.get("total_width_at_road_m")
    if tw is not None:
        add("Total width at road edge", "Section 9",
            f"Min {R['residential_min_at_road_m']}m",
            f"{tw}m", "PASS" if tw >= R["residential_min_at_road_m"] else "FAIL")

    # Material
    mat = cons.get("material")
    approved_keywords = ["asphalt", "concrete", "brick", "paver", "block", "chip seal"]
    mat_ok = mat and any(k in mat.lower() for k in approved_keywords)
    add("Material is approved type", "Section 10",
        ", ".join(R["allowed_materials"]),
        mat or "Not specified", "PASS" if mat_ok else "REQUIRES_VERIFICATION")

    # Thickness
    th = cons.get("thickness_mm")
    if th is not None:
        ok = th >= R["concrete_min_thickness_mm"]
        add("Surface thickness", "Section 10", f"≥{R['concrete_min_thickness_mm']}mm",
            f"{th}mm", "PASS" if ok else "FAIL")
    else:
        add("Surface thickness", "Section 10", f"≥{R['concrete_min_thickness_mm']}mm",
            "Not specified", "REQUIRES_VERIFICATION")

    # Expansion joints
    ej = cons.get("expansion_joints")
    add("Expansion joints", "Section 10", f"Min {R['expansion_joints_min']} required",
        "Yes" if ej else ("No" if ej is False else "Not specified"),
        "PASS" if ej else "REQUIRES_VERIFICATION")

    # Kerb type
    kerb = cons.get("kerb_type")
    add("Kerb type identified", "Section 10 — Kerbing", "Required for correct treatment",
        kerb or "Not specified", "PASS" if kerb else "REQUIRES_VERIFICATION")

    # Footpath
    fp = cons.get("footpath_exists")
    add("Footpath identified", "Section 9 — Footpaths", "Must be noted (paths have priority)",
        "Yes" if fp else ("No" if fp is False else "Not specified"),
        "PASS" if fp is not None else "REQUIRES_VERIFICATION")

    # Drainage
    drain_ok = drain.get("soakwells_proposed") or drain.get("storage_tanks_proposed") or drain.get("connection_to_council_drain")
    add("Stormwater drainage managed", "Section 7",
        "Must be managed to 100yr ARI",
        "Drainage plan provided" if drain_ok else "Not demonstrated",
        "PASS" if drain_ok else "REQUIRES_VERIFICATION")

    # Vegetation
    veg = data.get("additional_findings", {}).get("vegetation_on_verge")
    add("Vegetation/tree impact", "Section 6",
        f"Min {R['tree_min_spacing_m']}m from trees, AS 4970 protection",
        "Vegetation noted" if veg else ("No vegetation" if veg is False else "Not assessed"),
        "PASS" if veg is not None else "REQUIRES_VERIFICATION")

    # Site plan present
    has_dims = bool(dims.get("width_at_boundary_m") or dims.get("verge_depth_m") or site.get("all_dimensions_found"))
    add("Scaled site plan with dimensions", "Section 1",
        "Required with application",
        "Dimensions found" if has_dims else "Limited info",
        "PASS" if has_dims else "REQUIRES_VERIFICATION")

    # ── NEW CHECKS aligned with R-001 to R-170 ──

    # Alignment at 90° (R-081)
    align = dims.get("alignment_degrees")
    if align is not None:
        ok = 85 <= align <= 95
        add("Crossover alignment to road", "R-081",
            "90° ± 5°", f"{align}°",
            "PASS" if ok else "FAIL")

    # Intersection tangent distance (R-100)
    tangent = dims.get("distance_to_intersection_tangent_m")
    if tangent is not None:
        ok = tangent >= 6.0
        add("Distance to intersection tangent", "R-100",
            "≥ 6.0m", f"{tangent}m",
            "PASS" if ok else "FAIL",
            "Second crossover requires ≥ 6.0m from intersection tangent point" if not ok else None)

    # Boundary setback (min 0.5m)
    for side, label in [("distance_to_left_boundary_m", "Left"), ("distance_to_right_boundary_m", "Right")]:
        d = dims.get(side)
        if d is not None:
            ok = d >= 0.5
            add(f"{label} boundary setback", "§4.4",
                "≥ 0.5m", f"{d}m",
                "PASS" if ok else "FAIL")

    # Footpath flush join (R-110)
    fp_flush = cons.get("footpath_flush_join")
    if cons.get("footpath_exists"):
        add("Footpath flush join", "R-110, R-111",
            "Must meet flush, delineated for concrete",
            "Yes" if fp_flush else ("No" if fp_flush is False else "Not assessed"),
            "PASS" if fp_flush else "REQUIRES_VERIFICATION")

    # Base course depth (R-122)
    bc_depth = cons.get("base_course_depth_mm")
    if bc_depth is not None:
        ok = bc_depth >= 150
        add("Base course depth", "R-122",
            "≥ 150mm", f"{bc_depth}mm",
            "PASS" if ok else "FAIL")

    # Compaction (R-121)
    mdd = cons.get("compaction_mdd_pct")
    if mdd is not None:
        ok = mdd >= 95
        add("Compaction to MDD", "R-121",
            "≥ 95%", f"{mdd}%",
            "PASS" if ok else "FAIL")

    # Corner lot sight triangle (AS 2890.1 §3.2.4)
    prop = data.get("property", {})
    if prop.get("is_corner_lot"):
        add("Corner lot sight triangle", "AS 2890.1 §3.2.4",
            "Extended sight triangle required",
            "Corner lot identified",
            "REQUIRES_VERIFICATION",
            "Corner lot: curve radius measurement and sight distance calculation needed")

    # Battleaxe lot checks (R-087, R-088)
    if prop.get("is_battleaxe"):
        add("Battleaxe lot driveway", "R-087, R-088",
            "Single: min 3.0m + 0.5m garden bed. Adjoining: 6.0m combined",
            "Battleaxe lot identified",
            "REQUIRES_VERIFICATION",
            "Verify driveway width meets battleaxe requirements")

    # Second crossover (R-100)
    num_cx = site.get("number_of_crossovers")
    frontage = site.get("lot_frontage_m")
    if num_cx is not None and num_cx > 1:
        if frontage is not None and frontage <= 20:
            add("Second crossover eligibility", "R-100",
                "Lot boundary > 20m required", f"Frontage {frontage}m",
                "FAIL", "Second crossover REFUSED — frontage ≤ 20m")
        else:
            add("Second crossover eligibility", "R-100",
                "All 4 conditions must be met",
                f"{num_cx} crossovers, frontage {'>' + str(frontage) + 'm' if frontage else 'unknown'}",
                "REQUIRES_VERIFICATION",
                "Check: >20m frontage, all specs met, ≥6.0m from tangent, no tree impact")

    # DA-linked contribution check (R-166)
    if prop.get("da_linked"):
        add("DA-linked contribution", "R-166",
            "DA crossovers not eligible for contribution",
            "DA-linked",
            "FAIL" if prop.get("da_linked") else "PASS",
            "DA crossovers cannot receive financial contribution")

    # Road speed zone
    speed = site.get("road_speed_zone_kmh")
    if speed is not None:
        add("Speed zone for sight distance", "§9.5",
            "Speed determines sight distance requirements",
            f"{speed} km/h",
            "PASS")

    statuses = [c["status"] for c in checks]
    p = statuses.count("PASS")
    f_ = statuses.count("FAIL")
    v = statuses.count("REQUIRES_VERIFICATION")

    if f_ >= 3:
        overall = "REFUSED"
    elif f_ >= 1:
        overall = "DOES_NOT_COMPLY"
    elif v >= 4:
        overall = "REQUIRES_FURTHER_INFORMATION"
    elif v >= 1:
        overall = "CONDITIONAL_APPROVAL"
    else:
        overall = "APPROVED"

    return {
        "checks": checks,
        "summary": {"passed": p, "failed": f_, "requires_verification": v, "total": len(checks)},
        "recommendation": overall,
    }


# ═════════════════════════════════════════════════════════════════════════════
# 6) PUBLIC SERVICE API (call from FastAPI route)
# ═════════════════════════════════════════════════════════════════════════════

def analyse_document(
    file_bytes: bytes,
    filename: str,
    api_key: str | None = None,
    model: str | None = None,
) -> Dict[str, Any]:
    """
    Full pipeline: bytes → images → Claude → compliance → findings JSON
    Returns either a findings dict OR an {error, raw_response, ...} dict.
    """
    api_key = api_key or settings.ANTHROPIC_API_KEY
    if not api_key:
        raise ValueError("Missing Anthropic API key. Provide in header, query, or ANTHROPIC_API_KEY env.")
    model = model or settings.AI_MODEL_DEFAULT

    images = file_to_images_from_upload(file_bytes, filename, max_dim=settings.MAX_IMAGE_DIM)
    raw = call_claude(images, api_key, model)

    try:
        extracted = parse_json_response(raw)
    except json.JSONDecodeError as e:
        return {
            "error": f"JSON parse error: {e}",
            "raw_response": raw[:3000],
            "analysed_at": datetime.now().isoformat(),
            "source_file": filename,
        }

    compliance = check_compliance(extracted)

    findings = {
        "schema_version": "1.0",
        "analyser_version": "3.0.0",
        "analysed_at": datetime.now().isoformat(),
        "source_file": filename,
        "source_pages": len(images),
        "ai_provider": "Anthropic Claude",
        "ai_model": model,
        "guideline": {
            "name": GUIDELINE["name"],
            "version": GUIDELINE["version"],
            "date": GUIDELINE["date"],
        },
        "extraction": extracted,
        "compliance": compliance,
        "_raw_response": raw[:5000],  # Keep for training data (trimmed)
        "_page_images": images,  # Pass through for training capture
    }
    return findings


def save_training_sample(
    application_id: int,
    document_id: int | None,
    findings: Dict[str, Any],
    file_bytes: bytes,
    filename: str,
):
    """
    Save AI analysis results + page images as training data.
    Called after successful analysis to build the training dataset.
    Each page becomes a separate training sample.
    """
    from app.core.database import SessionLocal
    from app.models.ai_training import AITrainingSample

    images = findings.get("_page_images", [])
    extraction = findings.get("extraction", {})
    compliance = findings.get("compliance", {})
    model_name = findings.get("ai_model", "unknown")
    raw = findings.get("_raw_response", "")

    # Extract key values for denormalised columns
    dims = extraction.get("crossover_dimensions", {}) or {}
    cons = extraction.get("construction", {}) or {}
    drain = extraction.get("drainage", {}) or {}
    additional = extraction.get("additional_findings", {}) or {}

    db = SessionLocal()
    try:
        training_dir = Path(settings.DOCUMENT_DIR).parent / "training_data" / str(application_id)
        training_dir.mkdir(parents=True, exist_ok=True)

        for img_info in images:
            page_num = img_info.get("page", 1)

            # Save page image to disk
            img_filename = f"{Path(filename).stem}_p{page_num}.png"
            img_path = training_dir / img_filename
            img_bytes = base64.standard_b64decode(img_info["base64"])
            with open(img_path, "wb") as f:
                f.write(img_bytes)

            sample = AITrainingSample(
                application_id=application_id,
                document_id=document_id,
                source_filename=filename,
                page_number=page_num,
                image_path=str(img_path),
                ai_model=model_name,
                ai_provider="anthropic",
                extraction_json=extraction,
                compliance_json=compliance,
                raw_response=raw,
                width_at_boundary=dims.get("width_at_boundary_m"),
                total_width_at_road=dims.get("total_width_at_road_m"),
                verge_depth=dims.get("verge_depth_m"),
                material=cons.get("material"),
                has_drainage=bool(drain.get("drainage_plan_included")),
                has_vegetation=additional.get("vegetation_on_verge"),
            )
            db.add(sample)

        db.commit()
        print(f"  ✓ Saved {len(images)} training sample(s) for application {application_id}")
    except Exception as e:
        print(f"  ⚠ Training data save failed: {e}")
        db.rollback()
    finally:
        db.close()