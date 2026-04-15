"""
Local AI Extraction Service — no external API calls.

Three-stage pipeline:
  1. Text + Layout Extraction — pytesseract with bounding boxes
  2. Field Extraction — pattern matching with spatial context
  3. Confidence Scoring — per-field confidence based on match quality

Supports: Application Form, Certificate of Title
"""
from pathlib import Path
from typing import Optional
import re
import logging

logger = logging.getLogger(__name__)


def extract_local(file_path: str, extract_type: str) -> dict:
    """
    Main entry point for local extraction.
    Returns: {fields: {name: {value, confidence, bbox, source}}, raw_text, layout_blocks}
    """
    from PIL import Image
    from pdf2image import convert_from_bytes
    import pytesseract

    file_path = Path(file_path)
    images = convert_from_bytes(file_path.read_bytes(), dpi=200, last_page=4)

    # ── Stage 1: Text + Layout Extraction ──
    all_blocks = []
    full_text_lines = []
    for page_idx, img in enumerate(images):
        grey = img.convert("L")
        # Get word-level bounding boxes with confidence
        tsv_data = pytesseract.image_to_data(grey, config="--psm 6", output_type=pytesseract.Output.DICT)
        page_blocks = []
        for i in range(len(tsv_data["text"])):
            word = tsv_data["text"][i].strip()
            conf = int(tsv_data["conf"][i]) if tsv_data["conf"][i] != "-1" else 0
            if not word or conf < 20:
                continue
            page_blocks.append({
                "text": word,
                "conf": conf,
                "x": tsv_data["left"][i],
                "y": tsv_data["top"][i],
                "w": tsv_data["width"][i],
                "h": tsv_data["height"][i],
                "page": page_idx,
                "block": tsv_data["block_num"][i],
                "line": tsv_data["line_num"][i],
            })
        all_blocks.extend(page_blocks)

        # Also get line-level text for regex matching
        line_text = pytesseract.image_to_string(grey, config="--psm 6")
        full_text_lines.extend(line_text.split("\n"))

    full_text = "\n".join(full_text_lines)

    # Group blocks into lines
    lines = _group_into_lines(all_blocks)

    # ── Stage 2: Field Extraction ──
    if extract_type == "certificate_of_title":
        fields = _extract_title_fields(full_text, lines, all_blocks)
    elif extract_type == "site_plan":
        fields = _extract_siteplan_fields(full_text, lines, all_blocks)
    else:
        fields = _extract_form_fields(full_text, lines, all_blocks)

    # ── Stage 3: Build result ──
    result = {}
    confidence_scores = {}
    for field_name, field_data in fields.items():
        result[field_name] = field_data["value"]
        confidence_scores[field_name] = field_data["confidence"]

    return {
        "fields": result,
        "confidence": confidence_scores,
        "raw_blocks": len(all_blocks),
        "raw_lines": len(full_text_lines),
        "extraction_method": "local_ocr",
        "detail": fields,  # includes bbox and source for each field
    }


def _group_into_lines(blocks):
    """Group word blocks into lines based on y-position proximity."""
    if not blocks:
        return []

    lines = {}
    for b in blocks:
        key = (b["page"], b["block"], b["line"])
        if key not in lines:
            lines[key] = {"words": [], "y": b["y"], "page": b["page"]}
        lines[key]["words"].append(b)

    result = []
    for key, line in sorted(lines.items()):
        words = sorted(line["words"], key=lambda w: w["x"])
        text = " ".join(w["text"] for w in words)
        avg_conf = sum(w["conf"] for w in words) / len(words) if words else 0
        result.append({
            "text": text,
            "words": words,
            "y": line["y"],
            "page": line["page"],
            "confidence": avg_conf,
        })

    return result


def _find_value_after_label(lines, label_patterns, max_distance=80):
    """Find the value that appears after/beside a label."""
    for line in lines:
        text = line["text"]
        for pattern in label_patterns:
            m = re.search(pattern, text, re.IGNORECASE)
            if m:
                # Value is the rest of the line after the match
                after = text[m.end():].strip().strip(":").strip()
                if after and len(after) > 1:
                    return {
                        "value": after,
                        "confidence": min(line["confidence"] / 100.0, 0.95),
                        "source": f"label_match:{pattern}",
                        "bbox": {"y": line["y"], "page": line["page"]},
                    }

                # Value might be on the next line (field below label)
                idx = lines.index(line)
                if idx + 1 < len(lines):
                    next_line = lines[idx + 1]
                    if abs(next_line["y"] - line["y"]) < max_distance and next_line["text"].strip():
                        return {
                            "value": next_line["text"].strip(),
                            "confidence": min(next_line["confidence"] / 100.0, 0.85),
                            "source": f"next_line_after:{pattern}",
                            "bbox": {"y": next_line["y"], "page": next_line["page"]},
                        }
    return None


def _find_pattern_in_text(text, pattern, group=0, field_type="string"):
    """Find a regex pattern in full text and return with confidence."""
    m = re.search(pattern, text, re.IGNORECASE)
    if m:
        val = m.group(group) if group else m.group(0)
        val = val.strip()
        if field_type == "float":
            try:
                val = float(val)
            except ValueError:
                return None
        conf = 0.7 if len(val) > 2 else 0.5
        return {"value": val, "confidence": conf, "source": f"regex:{pattern[:30]}", "bbox": {}}
    return None


def _extract_form_fields(full_text, lines, blocks):
    """Extract fields from a crossover application form."""
    fields = {}

    # Owner name
    r = _find_value_after_label(lines, [r"Owner['\s]*s?\s*Name", r"Applicant['\s]*s?\s*Name", r"Name\s*of\s*Owner", r"Full\s*Name"])
    if r:
        # Clean: remove trailing junk, limit to reasonable name length
        name = re.sub(r'[^A-Za-z\s\'-]', '', r["value"])[:80].strip()
        if len(name) > 2:
            r["value"] = name
            fields["owner_name"] = r

    # Phone
    r = _find_value_after_label(lines, [r"Phone", r"Tel(?:ephone)?", r"Mobile", r"Contact\s*(?:No|Number)"])
    if not r:
        r = _find_pattern_in_text(full_text, r'(?:0[2-9][\d\s]{7,10}|04[\d\s]{8,10})')
    if r:
        phone = re.sub(r'[^\d\s+]', '', r["value"]).strip()
        if len(phone) >= 8:
            r["value"] = phone
            fields["owner_phone"] = r

    # Email
    r = _find_value_after_label(lines, [r"Email", r"E-?mail"])
    if not r:
        r = _find_pattern_in_text(full_text, r'[\w.+-]+@[\w-]+\.[\w.]+')
    if r:
        fields["owner_email"] = r

    # Property address
    r = _find_value_after_label(lines, [r"Property\s*Address", r"Site\s*Address", r"Street\s*Address", r"Address\s*of\s*(?:Property|Works)"])
    if not r:
        r = _find_pattern_in_text(full_text, r'\d+\s+[A-Z][a-zA-Z]+\s+(?:Street|Road|Avenue|Drive|Crescent|Way|Court|Place|Lane|Close|Terrace|Boulevard|Parade|Circuit|Loop|Rise|Mews|Gardens?|Grove|Walk|View)[^,\n]{0,30}')
    if r:
        fields["property_address"] = r

    # Postal address
    r = _find_value_after_label(lines, [r"Postal\s*Address", r"Mailing\s*Address"])
    if r:
        fields["owner_postal_address"] = r

    # Lot number
    r = _find_value_after_label(lines, [r"Lot\s*(?:No|Number|#)", r"Lot\s*$"])
    if not r:
        r = _find_pattern_in_text(full_text, r'(?:Lot|LOT)\s*(\d+)', group=1)
    if r:
        fields["lot_number"] = r

    # Plan number
    r = _find_value_after_label(lines, [r"Plan\s*(?:No|Number|#)", r"Diagram\s*(?:No|Number)"])
    if not r:
        r = _find_pattern_in_text(full_text, r'(?:Plan|Diagram|Strata)\s*(?:No\.?\s*)?(\d+)', group=1)
    if r:
        fields["plan_number"] = r

    # Crossover width
    r = _find_value_after_label(lines, [r"Width\s*(?:of\s*)?(?:Crossover|Driveway|Cross-?over)", r"Proposed\s*Width", r"Width\s*\(?m"])
    if not r:
        r = _find_pattern_in_text(full_text, r'(?:width|WIDTH)[:\s]*(\d+(?:\.\d+)?)\s*(?:m|M|metres?)?', group=1, field_type="float")
    if r:
        if isinstance(r["value"], str):
            width_m = re.search(r'(\d+(?:\.\d+)?)', r["value"])
            if width_m:
                r["value"] = float(width_m.group(1))
        fields["crossover_width"] = r

    # Surface material
    r = _find_value_after_label(lines, [r"Surface\s*(?:Material|Type|Finish)", r"Material\s*(?:of\s*)?(?:Crossover|Surface)"])
    if not r:
        r = _find_pattern_in_text(full_text, r'(?:concrete|asphalt|brick\s*pav(?:ing|ers?)|paving|exposed\s*aggregate)', group=0)
    if r:
        fields["crossover_surface"] = r

    # DA number
    r = _find_value_after_label(lines, [r"DA\s*(?:No|Number|#|Ref)", r"Development\s*Approv", r"Planning\s*Approv"])
    if not r:
        r = _find_pattern_in_text(full_text, r'(?:DA|DEV)\s*[-#:]?\s*(\d+[/-]?\d*)', group=1)
    if r:
        fields["da_number"] = r

    # Date signed
    r = _find_value_after_label(lines, [r"Date\s*(?:Signed|signed)", r"Signature\s*Date"])
    if not r:
        r = _find_pattern_in_text(full_text, r'(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})')
    if r:
        fields["date_signed"] = r

    # Declaration signed — look for signature indicators
    sig_indicators = [r'(?:signed|SIGNED)', r'(?:✓|☑|✗|☒)\s*(?:I\s+)?(?:declare|agree|certif)', r'(?:applicant|owner)\s*(?:\'s?\s*)?signature']
    for pat in sig_indicators:
        if re.search(pat, full_text, re.IGNORECASE):
            fields["declaration_signed"] = {"value": True, "confidence": 0.6, "source": f"indicator:{pat[:20]}", "bbox": {}}
            break

    # Trees nearby
    if re.search(r'(?:tree|trees|vegetation).{0,30}(?:yes|✓|☑|within|nearby|adjacent)', full_text, re.IGNORECASE):
        fields["trees_nearby"] = {"value": True, "confidence": 0.6, "source": "keyword_match", "bbox": {}}
    elif re.search(r'(?:tree|trees|vegetation).{0,30}(?:no|✗|☐|none|N/?A)', full_text, re.IGNORECASE):
        fields["trees_nearby"] = {"value": False, "confidence": 0.6, "source": "keyword_match", "bbox": {}}

    # Drainage type
    r = _find_value_after_label(lines, [r"Drainage\s*(?:Type|Method|Proposal)", r"Stormwater"])
    if not r:
        r = _find_pattern_in_text(full_text, r'(?:soakwell|soak\s*well|pit|swale|retain|detention|connection\s*to\s*council)', group=0)
    if r:
        fields["drainage_type"] = r

    # Crossover count
    r = _find_value_after_label(lines, [r"Number\s*of\s*(?:Crossover|Driveway)", r"Crossover\s*Count"])
    if r:
        count_m = re.search(r'(\d+)', str(r["value"]))
        if count_m:
            r["value"] = int(count_m.group(1))
            fields["crossover_count"] = r

    return fields


def _extract_title_fields(full_text, lines, blocks):
    """Extract fields from a Certificate of Title."""
    fields = {}

    # Register number
    r = _find_value_after_label(lines, [r"Register\s*(?:No|Number|#)", r"Title\s*(?:Ref|Reference|No|Number)"])
    if not r:
        r = _find_pattern_in_text(full_text, r'(?:Register|Title)\s*(?:No\.?\s*)?([A-Z]?\d{4,10}[/-]?\d*)', group=1)
    if r:
        r["confidence"] = 0.8
        fields["register_number"] = r

    # Date issued
    r = _find_value_after_label(lines, [r"Date\s*(?:Issued|of\s*Issue|Created)", r"Issued"])
    if not r:
        r = _find_pattern_in_text(full_text, r'(?:Issued|Created)\s*[:.]?\s*(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})', group=1)
    if r:
        r["confidence"] = 0.75
        fields["date_issued"] = r

    # Volume
    r = _find_pattern_in_text(full_text, r'(?:Volume|VOL|Vol)\s*[:.]?\s*(\d+)', group=1)
    if r:
        r["confidence"] = 0.85
        fields["volume"] = r

    # Folio
    r = _find_pattern_in_text(full_text, r'(?:Folio|FOL|Fol)\s*[:.]?\s*(\d+)', group=1)
    if r:
        r["confidence"] = 0.85
        fields["folio"] = r

    # Land description — full legal description
    r = _find_value_after_label(lines, [r"Land\s*Description", r"Property\s*Description", r"Description\s*of\s*Land"])
    if not r:
        # Try to build from Lot + Plan
        lot_m = re.search(r'(Lot\s*\d+\s*(?:on\s*)?(?:Plan|Diagram|Strata\s*Plan)\s*\d+)', full_text, re.IGNORECASE)
        if lot_m:
            r = {"value": lot_m.group(1), "confidence": 0.8, "source": "pattern", "bbox": {}}
    if r:
        fields["land_description"] = r

    # Lot number
    r = _find_pattern_in_text(full_text, r'(?:Lot|LOT)\s*(\d+)', group=1)
    if r:
        r["confidence"] = 0.85
        fields["lot_number"] = r

    # Plan/Diagram number
    r = _find_pattern_in_text(full_text, r'(?:Plan|Diagram|PLAN|DIAGRAM|Strata\s*Plan)\s*(?:No\.?\s*)?(\d+)', group=1)
    if r:
        r["confidence"] = 0.85
        fields["plan_number"] = r

    # Lot area
    r = _find_pattern_in_text(full_text, r'(\d{2,6}(?:\.\d+)?)\s*(?:sq\.?\s*m|sqm|m²|m2|square\s*met)', group=1, field_type="float")
    if r:
        r["confidence"] = 0.75
        fields["lot_area_sqm"] = r

    # Property address
    r = _find_value_after_label(lines, [r"Property\s*Address", r"Street\s*Address", r"Address"])
    if not r:
        r = _find_pattern_in_text(full_text, r'(\d+\s+[A-Z][a-zA-Z]+\s+(?:Street|Road|Avenue|Drive|Crescent|Way|Court|Place|Lane|Close|Terrace|Boulevard|Parade|Circuit)[^,\n]{0,40})')
    if r:
        fields["property_address"] = r

    # Registered owners
    r = _find_value_after_label(lines, [r"Registered\s*Proprietor", r"PROPRIETOR", r"Registered\s*Owner"])
    if r:
        name = re.sub(r'[^A-Za-z\s,\'-]', '', r["value"])[:100].strip()
        if len(name) > 2:
            r["value"] = [n.strip() for n in name.split(",") if n.strip()] if "," in name else [name]
            r["confidence"] = 0.8
            fields["registered_owners"] = r

    # Mortgage
    r = _find_value_after_label(lines, [r"Mortgagee", r"Mortgage", r"MORTGAGE"])
    if not r:
        # Common bank names in WA
        r = _find_pattern_in_text(full_text, r'(?:Commonwealth\s*Bank|Westpac|ANZ|NAB|Bankwest|Bendigo|ING|Macquarie|Suncorp|CBA|St\.?\s*George)[^,\n]{0,40}')
    if r:
        r["confidence"] = 0.7
        fields["mortgage"] = r

    # Encumbrances
    enc_lines = []
    in_enc = False
    for line in lines:
        if re.search(r'(?:Encumbrance|Caveat|Easement|Restriction|ENCUMBRANCE|Notification)', line["text"], re.IGNORECASE):
            in_enc = True
        elif in_enc:
            if re.search(r'(?:Registered|Proprietor|WARNING|End of|Mortgage)', line["text"], re.IGNORECASE):
                in_enc = False
            elif line["text"].strip():
                enc_lines.append(line["text"].strip())
    if enc_lines:
        fields["encumbrances"] = {
            "value": enc_lines[:10],
            "confidence": 0.6,
            "source": "section_parse",
            "bbox": {},
        }

    return fields


def _extract_siteplan_fields(full_text, lines, blocks):
    """Extract site plan fields using local OCR — same schema as AI analyser."""
    fields = {}

    # ── Property ──
    r = _find_pattern_in_text(full_text, r'(?:Lot|LOT)\s*(\d+)', group=1)
    if r: fields["property.lot_number"] = r
    r = _find_pattern_in_text(full_text, r'(\d+\s+[A-Z][a-zA-Z]+\s+(?:Street|Road|Avenue|Drive|Crescent|Way|Court|Place|Lane|Close|Terrace|Boulevard|Parade|Circuit|Loop|Rise|Grove)[^,\n]{0,30})')
    if r: fields["property.street_address"] = r
    # Corner lot detection
    road_names = set()
    for pattern in [r'([A-Z][a-zA-Z]+\s+(?:Street|Road|Avenue|Drive|Crescent|Way|Court|Place|Lane|Close|Terrace|Boulevard|Parade|Circuit|Loop|Rise|Grove))', r'([A-Z][A-Z]+\s+(?:ST|RD|AVE|DR|CRES|WAY|CT|PL|LN|CL|TCE|BLVD))']:
        for m in re.finditer(pattern, full_text):
            road_names.add(m.group(1).strip())
    if len(road_names) >= 2:
        fields["property.is_corner_lot"] = {"value": True, "confidence": 0.7, "source": "multi_road_names", "bbox": {}}
        fields["property.corner_roads"] = {"value": list(road_names)[:3], "confidence": 0.65, "source": "road_name_scan", "bbox": {}}

    # ── Crossover Dimensions ──
    # Width
    r = _find_value_after_label(lines, [r"(?:Crossover|Cross-?over|Driveway)\s*(?:Width|width)"])
    if not r:
        # Look for width near "crossover" keyword
        for line in lines:
            if re.search(r'crossover|driveway|cross-?over', line["text"], re.IGNORECASE):
                width_m = re.search(r'(\d+(?:\.\d+)?)\s*(?:m\b|M\b|wide)', line["text"])
                if width_m:
                    r = {"value": float(width_m.group(1)), "confidence": 0.7, "source": "context_width", "bbox": {}}
                    break
    if r:
        if isinstance(r["value"], str):
            wm = re.search(r'(\d+(?:\.\d+)?)', r["value"])
            if wm: r["value"] = float(wm.group(1))
        fields["crossover_dimensions.width_at_boundary_m"] = r

    # All measurements — scan for dimension patterns (e.g. "3.450", "1.510")
    all_dims = []
    for m in re.finditer(r'(\d+(?:\.\d{1,3}))\s*(?:m\b|M\b)?', full_text):
        val = float(m.group(1))
        if 0.1 < val < 50:  # reasonable dimension range
            all_dims.append(val)
    if all_dims:
        fields["siteplan_measurements.all_dimensions_found"] = {"value": [str(d) for d in all_dims[:30]], "confidence": 0.6, "source": "dimension_scan", "bbox": {}}

    # Boundary distances
    r = _find_value_after_label(lines, [r"(?:Left|LHS)\s*(?:boundary|side)\s*(?:dist|offset|setback)?"])
    if r:
        dm = re.search(r'(\d+(?:\.\d+)?)', str(r["value"]))
        if dm: fields["crossover_dimensions.distance_to_left_boundary_m"] = {"value": float(dm.group(1)), "confidence": 0.7, "source": "label_match", "bbox": {}}
    r = _find_value_after_label(lines, [r"(?:Right|RHS)\s*(?:boundary|side)\s*(?:dist|offset|setback)?"])
    if r:
        dm = re.search(r'(\d+(?:\.\d+)?)', str(r["value"]))
        if dm: fields["crossover_dimensions.distance_to_right_boundary_m"] = {"value": float(dm.group(1)), "confidence": 0.7, "source": "label_match", "bbox": {}}

    # ── Construction ──
    for mat, pat in [("Concrete", r'concrete'), ("Asphalt", r'asphalt'), ("Brick Paving", r'brick\s*pav'), ("Exposed Aggregate", r'exposed\s*agg')]:
        if re.search(pat, full_text, re.IGNORECASE):
            fields["construction.material"] = {"value": mat, "confidence": 0.75, "source": "keyword", "bbox": {}}
            break
    # Kerb type
    for kt, pat in [("Mountable", r'mountable'), ("Semi-mountable", r'semi.?mountable'), ("Barrier", r'barrier\s*kerb'), ("Edge of seal", r'edge\s*of\s*seal')]:
        if re.search(pat, full_text, re.IGNORECASE):
            fields["construction.kerb_type"] = {"value": kt, "confidence": 0.7, "source": "keyword", "bbox": {}}
            break
    # Expansion joints
    if re.search(r'expansion\s*joint', full_text, re.IGNORECASE):
        fields["construction.expansion_joints"] = {"value": True, "confidence": 0.7, "source": "keyword", "bbox": {}}
    # Footpath
    if re.search(r'footpath|foot\s*path', full_text, re.IGNORECASE):
        fields["construction.footpath_exists"] = {"value": True, "confidence": 0.65, "source": "keyword", "bbox": {}}

    # ── Siteplan Measurements ──
    # Road names
    if road_names:
        rlist = list(road_names)
        fields["siteplan_measurements.road_name"] = {"value": rlist[0], "confidence": 0.7, "source": "road_scan", "bbox": {}}
        fields["siteplan_measurements.crossover_on_road"] = {"value": rlist[0], "confidence": 0.6, "source": "road_scan", "bbox": {}}
        if len(rlist) >= 2:
            fields["siteplan_measurements.secondary_road_name"] = {"value": rlist[1], "confidence": 0.65, "source": "road_scan", "bbox": {}}

    # Frontage
    r = _find_value_after_label(lines, [r"Frontage", r"Front\s*Boundary", r"Lot\s*Width"])
    if r:
        fm = re.search(r'(\d+(?:\.\d+)?)', str(r["value"]))
        if fm: fields["siteplan_measurements.lot_frontage_m"] = {"value": float(fm.group(1)), "confidence": 0.7, "source": "label_match", "bbox": {}}

    # Setbacks
    for label, key in [("Front\s*(?:Setback|S/B)", "building_setback_front_m"), ("Rear\s*(?:Setback|S/B)", "building_setback_rear_m"), ("Garage.*(?:kerb|road|boundary)", "garage_to_kerb_m")]:
        r = _find_value_after_label(lines, [label])
        if r:
            sm = re.search(r'(\d+(?:\.\d+)?)', str(r["value"]))
            if sm: fields[f"siteplan_measurements.{key}"] = {"value": float(sm.group(1)), "confidence": 0.65, "source": "label_match", "bbox": {}}

    # ── Utilities ──
    if re.search(r'(?:power|electric|overhead|underground)\s*(?:line|cable|pole)', full_text, re.IGNORECASE):
        fields["utilities.power_line_shown"] = {"value": True, "confidence": 0.6, "source": "keyword", "bbox": {}}
    if re.search(r'water\s*(?:main|meter|pipe)', full_text, re.IGNORECASE):
        fields["utilities.water_main_shown"] = {"value": True, "confidence": 0.6, "source": "keyword", "bbox": {}}
    if re.search(r'gas\s*(?:main|pipe|meter)', full_text, re.IGNORECASE):
        fields["utilities.gas_main_shown"] = {"value": True, "confidence": 0.6, "source": "keyword", "bbox": {}}
    if re.search(r'(?:telco|nbn|fibre|telephone)', full_text, re.IGNORECASE):
        fields["utilities.telco_shown"] = {"value": True, "confidence": 0.6, "source": "keyword", "bbox": {}}

    # ── Drainage ──
    if re.search(r'soakwell|soak\s*well', full_text, re.IGNORECASE):
        fields["drainage.soakwells_proposed"] = {"value": True, "confidence": 0.7, "source": "keyword", "bbox": {}}
        fields["drainage.drainage_plan_included"] = {"value": True, "confidence": 0.65, "source": "keyword", "bbox": {}}

    # ── Additional Findings ──
    if re.search(r'(?:tree|trees|vegetation)\s*(?:on\s*)?verge', full_text, re.IGNORECASE):
        fields["additional_findings.vegetation_on_verge"] = {"value": True, "confidence": 0.65, "source": "keyword", "bbox": {}}
    if re.search(r'fence|fenc', full_text, re.IGNORECASE):
        fence_m = re.search(r'(\w+\s+fence\s*(?:\d+(?:\.\d+)?\s*m)?)', full_text, re.IGNORECASE)
        if fence_m:
            fields["additional_findings.fence_left_of_crossover"] = {"value": {"exists": True, "type": fence_m.group(1)}, "confidence": 0.5, "source": "keyword", "bbox": {}}
    if re.search(r'retaining\s*wall', full_text, re.IGNORECASE):
        fields["additional_findings.retaining_wall_near_crossover"] = {"value": {"exists": True}, "confidence": 0.5, "source": "keyword", "bbox": {}}

    return fields
