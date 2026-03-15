#!/usr/bin/env python3
"""
Crossover Document AI Analyser → JSON Findings
================================================
Sends PDF/image pages to Claude API (vision), extracts crossover-related
data, checks compliance against Kalamunda Guideline v3.1, and writes
a structured JSON findings file.

Setup:
    pip install anthropic pdf2image Pillow

    # Also install system dependencies:
    # macOS:   brew install poppler
    # Ubuntu:  sudo apt-get install poppler-utils

Usage:
    python crossover_findings.py <document> --api-key <key> --output findings.json
    python crossover_findings.py plans.pdf -o findings.json
    python crossover_findings.py site.jpg --model claude-opus-4-20250514

Environment variable (alternative to --api-key):
    export ANTHROPIC_API_KEY="sk-ant-..."
"""

import argparse
import base64
import io
import json
import os
import sys
from datetime import datetime
from pathlib import Path

from PIL import Image
from pdf2image import convert_from_path


# ═════════════════════════════════════════════════════════════════════════════
# 1. KALAMUNDA GUIDELINE RULES (v3.1, 23/06/2022)
# ═════════════════════════════════════════════════════════════════════════════

GUIDELINE = {
    "name": "City of Kalamunda Crossover Guideline",
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
# 2. CLAUDE PROMPT — CROSSOVER EXTRACTION
# ═════════════════════════════════════════════════════════════════════════════

SYSTEM_PROMPT = """You are a crossover siteplan document analyser for the City of Kalamunda, Western Australia.

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
    "prepared_by": "string or null"
  },
  "crossover_dimensions": {
    "width_at_boundary_m": "number or null — width at property boundary",
    "splay_left_m": "number or null — left wing/flare",
    "splay_right_m": "number or null — right wing/flare",
    "total_width_at_road_m": "number or null — total where it meets road",
    "verge_depth_m": "number or null — property boundary to road edge",
    "crossover_length_m": "number or null"
  },
  "construction": {
    "material": "string or null — Concrete, Asphalt, Brick paving, etc.",
    "thickness_mm": "number or null",
    "expansion_joints": "boolean or null",
    "base_course_specified": "boolean or null",
    "kerb_type": "string or null — Mountable, Semi-mountable, Barrier, Edge of seal",
    "footpath_exists": "boolean or null"
  },
  "siteplan_measurements": {
    "property_boundary_to_road_m": "number or null",
    "existing_driveway_width_m": "number or null",
    "road_name": "string or null",
    "lot_frontage_m": "number or null",
    "lot_areas_m2": "object — e.g. {\"Lot 20\": 350}",
    "total_area_m2": "number or null",
    "all_dimensions_found": "array of strings — every measurement on the drawings"
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
    "vegetation_on_verge": "boolean or null",
    "notes": "string or null"
  }
}

RULES:
- Read ALL measurements from drawings, including rotated and vertical text.
- Use numeric values (not strings) for measurements.
- Verge depth = distance from property boundary line to road edge.
- Distinguish crossover width (at boundary) from total width (at road, includes splays).
- Return ONLY valid JSON. Nothing else."""

USER_PROMPT = "Analyse the attached document page(s). Extract all crossover dimensions, construction specs, site plan measurements, drainage details, and property info. Return structured JSON."


# ═════════════════════════════════════════════════════════════════════════════
# 3. IMAGE CONVERSION
# ═════════════════════════════════════════════════════════════════════════════

def file_to_images(filepath, max_dim=2048):
    """Convert PDF or image file to list of base64-encoded PNG images."""
    ext = Path(filepath).suffix.lower()
    raw_images = []

    if ext == ".pdf":
        pil_imgs = convert_from_path(filepath, dpi=200)
        for i, img in enumerate(pil_imgs):
            raw_images.append({"pil": img, "page": i + 1})
    elif ext in (".jpg", ".jpeg", ".png"):
        raw_images.append({"pil": Image.open(filepath), "page": 1})
    else:
        raise ValueError(f"Unsupported: {ext}. Use .pdf, .jpg, .jpeg, .png")

    results = []
    for item in raw_images:
        img = item["pil"]
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
# 4. CLAUDE API CALL
# ═════════════════════════════════════════════════════════════════════════════

def call_claude(images, api_key, model):
    """Send document images to Claude and return raw text response."""
    import anthropic
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
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": content}],
    )
    return resp.content[0].text


def parse_json_response(raw):
    """Parse Claude's response, stripping markdown fences if present."""
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    start, end = text.find("{"), text.rfind("}") + 1
    if start >= 0 and end > start:
        text = text[start:end]
    return json.loads(text)


# ═════════════════════════════════════════════════════════════════════════════
# 5. COMPLIANCE ENGINE
# ═════════════════════════════════════════════════════════════════════════════

def check_compliance(data):
    """Run extracted data against Kalamunda Guideline rules. Returns findings."""
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

    # ── Width ────────────────────────────────────────────────────────
    w = dims.get("width_at_boundary_m")
    if w is not None:
        ok = R["residential_min_width_m"] <= w <= R["max_width_frontage_over_12_5m"]
        add("Crossover width at boundary", "Section 9",
            f"{R['residential_min_width_m']}m – {R['max_width_frontage_over_12_5m']}m",
            f"{w}m", "PASS" if ok else "FAIL")
    else:
        add("Crossover width at boundary", "Section 9",
            "Must be dimensioned", "Not found", "REQUIRES_VERIFICATION")

    # ── Splays ───────────────────────────────────────────────────────
    sl, sr = dims.get("splay_left_m"), dims.get("splay_right_m")
    if sl is not None and sr is not None:
        ok = sl >= R["min_wing_special_m"] and sr >= R["min_wing_special_m"]
        add("Wing/splay dimensions", "Section 9",
            f"Standard {R['standard_wing_m']}m, min {R['min_wing_special_m']}m",
            f"{sl}m / {sr}m", "PASS" if ok else "FAIL")
    else:
        add("Wing/splay dimensions", "Section 9",
            "Must be shown", "Not found", "REQUIRES_VERIFICATION")

    # ── Total width at road ──────────────────────────────────────────
    tw = dims.get("total_width_at_road_m")
    if tw is not None:
        add("Total width at road edge", "Section 9",
            f"Min {R['residential_min_at_road_m']}m",
            f"{tw}m", "PASS" if tw >= R["residential_min_at_road_m"] else "FAIL")

    # ── Material ─────────────────────────────────────────────────────
    mat = cons.get("material")
    approved_keywords = ["asphalt", "concrete", "brick", "paver", "block", "chip seal"]
    mat_ok = mat and any(k in mat.lower() for k in approved_keywords)
    add("Material is approved type", "Section 10",
        ", ".join(R["allowed_materials"]),
        mat or "Not specified", "PASS" if mat_ok else "REQUIRES_VERIFICATION")

    # ── Thickness ────────────────────────────────────────────────────
    th = cons.get("thickness_mm")
    if th is not None:
        ok = th >= R["concrete_min_thickness_mm"]
        add("Surface thickness", "Section 10",
            f"≥{R['concrete_min_thickness_mm']}mm (residential)",
            f"{th}mm", "PASS" if ok else "FAIL")
    else:
        add("Surface thickness", "Section 10",
            f"≥{R['concrete_min_thickness_mm']}mm", "Not specified", "REQUIRES_VERIFICATION")

    # ── Expansion joints ─────────────────────────────────────────────
    ej = cons.get("expansion_joints")
    add("Expansion joints", "Section 10",
        f"Min {R['expansion_joints_min']} required",
        "Yes" if ej else ("No" if ej is False else "Not specified"),
        "PASS" if ej else "REQUIRES_VERIFICATION")

    # ── Kerb type ────────────────────────────────────────────────────
    kerb = cons.get("kerb_type")
    add("Kerb type identified", "Section 10 — Kerbing",
        "Required for correct treatment",
        kerb or "Not specified",
        "PASS" if kerb else "REQUIRES_VERIFICATION")

    # ── Footpath ─────────────────────────────────────────────────────
    fp = cons.get("footpath_exists")
    add("Footpath identified", "Section 9 — Footpaths",
        "Must be noted (paths have priority)",
        "Yes" if fp else ("No" if fp is False else "Not specified"),
        "PASS" if fp is not None else "REQUIRES_VERIFICATION")

    # ── Drainage ─────────────────────────────────────────────────────
    drain_ok = drain.get("soakwells_proposed") or drain.get("storage_tanks_proposed") or drain.get("connection_to_council_drain")
    add("Stormwater drainage managed", "Section 7",
        "Must be managed to 100yr ARI",
        "Drainage plan provided" if drain_ok else "Not demonstrated",
        "PASS" if drain_ok else "REQUIRES_VERIFICATION")

    # ── Vegetation ───────────────────────────────────────────────────
    veg = data.get("additional_findings", {}).get("vegetation_on_verge")
    add("Vegetation/tree impact", "Section 6",
        f"Min {R['tree_min_spacing_m']}m from trees, AS 4970 protection",
        "Vegetation noted" if veg else ("No vegetation" if veg is False else "Not assessed"),
        "PASS" if veg is not None else "REQUIRES_VERIFICATION")

    # ── Site plan ────────────────────────────────────────────────────
    has_dims = bool(dims.get("width_at_boundary_m") or dims.get("verge_depth_m") or site.get("all_dimensions_found"))
    add("Scaled site plan with dimensions", "Section 1",
        "Required with application",
        "Dimensions found" if has_dims else "Limited info",
        "PASS" if has_dims else "REQUIRES_VERIFICATION")

    # ── Summary ──────────────────────────────────────────────────────
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
# 6. FULL PIPELINE
# ═════════════════════════════════════════════════════════════════════════════

def analyse_and_generate(filepath, api_key, model):
    """Full pipeline: file → images → Claude → compliance → JSON findings."""

    log(f"Converting '{Path(filepath).name}' to images...")
    images = file_to_images(filepath)
    log(f"  {len(images)} page(s) prepared")

    log(f"Sending to Claude ({model})...")
    raw = call_claude(images, api_key, model)
    log(f"  Response: {len(raw)} chars")

    log("Parsing extraction...")
    try:
        extracted = parse_json_response(raw)
    except json.JSONDecodeError as e:
        log(f"  ERROR: Could not parse JSON — {e}")
        return {
            "error": str(e),
            "raw_response": raw[:3000],
            "analysed_at": datetime.now().isoformat(),
            "source_file": Path(filepath).name,
        }

    log("Running compliance checks...")
    compliance = check_compliance(extracted)
    log(f"  Result: {compliance['summary']['passed']}P / {compliance['summary']['failed']}F / {compliance['summary']['requires_verification']}V → {compliance['recommendation']}")

    # ── Build final findings JSON ────────────────────────────────────
    findings = {
        "schema_version": "1.0",
        "analyser_version": "3.0.0",
        "analysed_at": datetime.now().isoformat(),
        "source_file": Path(filepath).name,
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
    }

    return findings


def log(msg):
    print(msg, file=sys.stderr)


# ═════════════════════════════════════════════════════════════════════════════
# 7. CLI
# ═════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="Analyse crossover documents with Claude AI and generate JSON findings",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python crossover_findings.py plans.pdf --api-key sk-ant-... -o findings.json
  python crossover_findings.py drawing.jpg -o result.json
  python crossover_findings.py 218_Dawson_Ave.pdf --model claude-opus-4-20250514

Environment variable:
  export ANTHROPIC_API_KEY="sk-ant-..."
        """,
    )
    parser.add_argument("file", default="C:\\Projects_Self\\cams\\approval-backend\\scripts\\70 Berkshire Road Flooding and Crossover drawings.pdf", help="PDF or image file to analyse")
    parser.add_argument("--api-key", "-k", default=None, help="Anthropic API key (or set ANTHROPIC_API_KEY)")
    parser.add_argument("--model", "-m", default="claude-sonnet-4-20250514", help="Claude model (default: claude-sonnet-4-20250514)")
    parser.add_argument("--output", "-o", help="Output JSON file (default: stdout)")
    parser.add_argument("--compact", action="store_true", help="Compact JSON (no indentation)")

    args = parser.parse_args()

    # Validate
    if not os.path.exists(args.file):
        log(f"Error: File not found: {args.file}")
        sys.exit(1)

    ext = Path(args.file).suffix.lower()
    if ext not in (".pdf", ".jpg", ".jpeg", ".png"):
        log(f"Error: Unsupported format '{ext}'. Use .pdf .jpg .jpeg .png")
        sys.exit(1)

    api_key = args.api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        log("Error: No API key. Set ANTHROPIC_API_KEY or use --api-key")
        sys.exit(1)

    # Run
    log("")
    log("=" * 55)
    log("  Crossover Findings Generator v3.0")
    log("=" * 55)
    log(f"  File:  {args.file}")
    log(f"  Model: {args.model}")
    log("=" * 55)
    log("")

    findings = analyse_and_generate(args.file, api_key, args.model)

    # Output
    indent = None if args.compact else 2
    json_str = json.dumps(findings, indent=indent, ensure_ascii=False, default=str)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(json_str)
        log(f"\n✅ Findings saved to: {args.output}")
    else:
        print(json_str)

    # Print summary
    if "error" not in findings:
        comp = findings["compliance"]
        prop = findings["extraction"].get("property", {})
        dims = findings["extraction"].get("crossover_dimensions", {})
        s = comp["summary"]

        log("")
        log("=" * 55)
        log("  FINDINGS SUMMARY")
        log("=" * 55)
        log(f"  Property:       {prop.get('street_address', 'N/A')}, {prop.get('suburb', 'N/A')}")
        log(f"  Lot:            {prop.get('lot_number', 'N/A')}")
        log(f"  Client:         {prop.get('client_name', 'N/A')}")
        log(f"  Project:        {prop.get('project_number', 'N/A')}")
        log(f"  Width:          {dims.get('width_at_boundary_m', '—')}m")
        log(f"  Splays:         {dims.get('splay_left_m', '—')}m / {dims.get('splay_right_m', '—')}m")
        log(f"  Verge depth:    {dims.get('verge_depth_m', '—')}m")
        log(f"  Material:       {findings['extraction'].get('construction', {}).get('material', 'N/A')}")
        log("-" * 55)
        for c in comp["checks"]:
            icon = "✅" if c["status"] == "PASS" else "❌" if c["status"] == "FAIL" else "⚠️"
            log(f"  {icon} {c['item']}: {c['found']}")
        log("-" * 55)
        log(f"  Passed: {s['passed']} | Failed: {s['failed']} | Verify: {s['requires_verification']}")
        log(f"  RECOMMENDATION: {comp['recommendation']}")
        log("=" * 55)


if __name__ == "__main__":
    main()