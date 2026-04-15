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

    if extract_type == "site_plan":
        # Site plan returns nested structure — pass through directly
        result = fields  # already nested: {property: {...}, crossover_dimensions: {...}, ...}
        # Build flat confidence from nested
        for group_name, group_data in fields.items():
            if isinstance(group_data, dict):
                for k, v in group_data.items():
                    if v is not None:
                        confidence_scores[f"{group_name}.{k}"] = 0.65  # default local OCR confidence
    else:
        # Form/title returns flat dict with {value, confidence} per field
        for field_name, field_data in fields.items():
            if isinstance(field_data, dict) and "value" in field_data:
                result[field_name] = field_data["value"]
                confidence_scores[field_name] = field_data.get("confidence", 0.5)
            else:
                result[field_name] = field_data

    return {
        "fields": result,
        "confidence": confidence_scores,
        "raw_blocks": len(all_blocks),
        "raw_lines": len(full_text_lines),
        "extraction_method": "local_ocr",
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
    """Extract site plan fields using local OCR — same nested structure as AI analyser (74 fields)."""
    fields = {}

    # Helper: scan all numeric dimensions from the plan
    all_dims = []
    for m in re.finditer(r'(\d+(?:\.\d{1,3}))\s*(?:m\b|M\b)?', full_text):
        val = float(m.group(1))
        if 0.1 < val < 100:
            all_dims.append(val)

    # Scan all road names
    road_names = []
    for pattern in [r'([A-Z][a-zA-Z]+\s+(?:Street|Road|Avenue|Drive|Crescent|Way|Court|Place|Lane|Close|Terrace|Boulevard|Parade|Circuit|Loop|Rise|Grove|Walk|View|Mews))', r'([A-Z]{2,}\s+(?:ST|RD|AVE|DR|CRES|WAY|CT|PL|LN|CL|TCE|BLVD))']:
        for m in re.finditer(pattern, full_text):
            rn = m.group(1).strip()
            if rn not in road_names:
                road_names.append(rn)

    def _lv(label_pats):
        return _find_value_after_label(lines, label_pats)
    def _pt(pat, grp=0, ft="string"):
        return _find_pattern_in_text(full_text, pat, grp, ft)
    def _kw(pat):
        return bool(re.search(pat, full_text, re.IGNORECASE))
    def _fv(r):
        """Extract float from a result"""
        if not r: return None
        v = r.get("value") if isinstance(r, dict) else r
        if isinstance(v, (int, float)): return v
        m = re.search(r'(\d+(?:\.\d+)?)', str(v))
        return float(m.group(1)) if m else None

    # ═══ property ═══
    prop = {}
    r = _pt(r'(?:Lot|LOT)\s*(\d+)', 1); prop["lot_number"] = r["value"] if r else None
    r = _pt(r'(\d+\s+[A-Z][a-zA-Z]+\s+(?:Street|Road|Avenue|Drive|Crescent|Way|Court|Place|Lane|Close|Terrace|Boulevard|Parade|Circuit)[^,\n]{0,30})'); prop["street_address"] = r["value"] if r else None
    r = _lv([r"Suburb", r"Locality"]); prop["suburb"] = r["value"] if r else None
    r = _lv([r"Date", r"Drawn"]); prop["date"] = r["value"] if r else None
    prop["is_corner_lot"] = len(road_names) >= 2
    prop["corner_roads"] = road_names[:3] if len(road_names) >= 2 else None
    prop["is_battleaxe"] = _kw(r'battle.?axe|rear\s*lot|driveway\s*leg')
    prop["da_linked"] = _kw(r'DA\s*\d|development\s*approv')
    fields["property"] = prop

    # ═══ crossover_dimensions ═══
    cd = {}
    r = _lv([r"(?:Crossover|Cross.?over|Driveway)\s*(?:Width|width)", r"Width\s*(?:at\s*)?(?:boundary|property)"]) or _pt(r'(?:width|WIDTH)[:\s]*(\d+(?:\.\d+)?)\s*(?:m|M)?', 1, "float")
    cd["width_at_boundary_m"] = _fv(r)
    r = _lv([r"(?:Left|LHS)\s*(?:splay|wing|flare)"]); cd["splay_left_m"] = _fv(r)
    r = _lv([r"(?:Right|RHS)\s*(?:splay|wing|flare)"]); cd["splay_right_m"] = _fv(r)
    r = _lv([r"(?:Total|Road)\s*(?:Width|width)"]); cd["total_width_at_road_m"] = _fv(r)
    r = _lv([r"Verge\s*(?:Depth|Width|depth)"]); cd["verge_depth_m"] = _fv(r)
    r = _lv([r"(?:Crossover|Driveway)\s*(?:Length|length)"]); cd["crossover_length_m"] = _fv(r)
    cd["alignment_degrees"] = 90 if _kw(r'90\s*°|perpendicular|right\s*angle') else None
    cd["driveway_centreline_point_2_5m"] = None
    r = _lv([r"(?:Left|LHS)\s*(?:boundary|side)\s*(?:dist|offset|setback)?"]); cd["distance_to_left_boundary_m"] = _fv(r)
    r = _lv([r"(?:Left|LHS)\s*(?:boundary|side)\s*(?:feature|fence|wall)"]); cd["left_boundary_feature"] = r["value"] if r else (_pt(r'(?:left|LHS).{0,20}(fence|wall|hedge|open|vacant)', 1)["value"] if _pt(r'(?:left|LHS).{0,20}(fence|wall|hedge|open|vacant)', 1) else None)
    r = _lv([r"(?:Right|RHS)\s*(?:boundary|side)\s*(?:dist|offset|setback)?"]); cd["distance_to_right_boundary_m"] = _fv(r)
    r = _lv([r"(?:Right|RHS)\s*(?:boundary|side)\s*(?:feature|fence|wall)"]); cd["right_boundary_feature"] = r["value"] if r else None
    # Constrained side
    ld = cd.get("distance_to_left_boundary_m"); rd = cd.get("distance_to_right_boundary_m")
    if ld is not None and rd is not None: cd["constrained_side"] = "left" if ld <= rd else "right"
    elif ld is not None: cd["constrained_side"] = "left"
    elif rd is not None: cd["constrained_side"] = "right"
    else: cd["constrained_side"] = None
    r = _lv([r"(?:Dist|Distance)\s*(?:to\s*)?(?:nearest\s*)?(?:lot\s*)?corner"]); cd["distance_to_nearest_lot_corner_m"] = _fv(r)
    cd["nearest_lot_corner"] = None
    r = _lv([r"(?:Dist|Distance)\s*(?:to\s*)?intersection"]); cd["distance_to_intersection_tangent_m"] = _fv(r)
    r = _lv([r"(?:Dist|Distance)\s*(?:to\s*)?(?:building|house)\s*corner"]); cd["distance_to_building_corner_m"] = _fv(r)
    fields["crossover_dimensions"] = cd

    # ═══ construction ═══
    con = {}
    for mat, pat in [("Concrete", r'concrete'), ("Asphalt", r'asphalt'), ("Brick paving", r'brick\s*pav'), ("Exposed Aggregate", r'exposed\s*agg'), ("Paving", r'paving|pavers')]:
        if _kw(pat): con["material"] = mat; break
    else: con["material"] = None
    r = _lv([r"Thickness", r"Surface\s*Thickness"]); con["thickness_mm"] = _fv(r)
    con["base_course_specified"] = _kw(r'base\s*course|sub.?base')
    r = _lv([r"Base\s*(?:Course|course)\s*(?:Depth|depth|Thickness)"]); con["base_course_depth_mm"] = _fv(r)
    r = _pt(r'(\d+)\s*%\s*(?:MDD|mdd|compaction)', 1, "float"); con["compaction_mdd_pct"] = _fv(r)
    con["expansion_joints"] = _kw(r'expansion\s*joint')
    for kt, pat in [("Mountable", r'mountable'), ("Semi-mountable", r'semi.?mountable'), ("Barrier", r'barrier\s*kerb'), ("Edge of seal", r'edge\s*of\s*seal')]:
        if _kw(pat): con["kerb_type"] = kt; break
    else: con["kerb_type"] = None
    con["footpath_exists"] = _kw(r'footpath|foot\s*path')
    con["footpath_flush_join"] = _kw(r'flush\s*(?:join|with\s*footpath)')
    con["construction_standard"] = "Type 1" if _kw(r'type\s*1|urban|sealed') else ("Type 2" if _kw(r'type\s*2|rural') else None)
    fields["construction"] = con

    # ═══ siteplan_measurements ═══
    sm = {}
    sm["road_name"] = road_names[0] if road_names else None
    sm["secondary_road_name"] = road_names[1] if len(road_names) >= 2 else None
    sm["crossover_on_road"] = road_names[0] if road_names else None
    r = _pt(r'(\d+)\s*(?:km/?h|kmh|km/h)', 1, "float"); sm["road_speed_zone_kmh"] = _fv(r)
    sm["road_classification"] = "local" if _kw(r'local\s*road') else ("distributor" if _kw(r'distributor') else None)
    r = _lv([r"Frontage", r"Front\s*Boundary", r"Lot\s*Width"]); sm["lot_frontage_m"] = _fv(r)
    r = _lv([r"(?:Lot\s*)?Depth", r"Side\s*Boundary\s*(?:Length|length)"]); sm["lot_depth_m"] = _fv(r)
    r = _lv([r"Front\s*(?:Setback|S/?B)"]); sm["building_setback_front_m"] = _fv(r)
    r = _lv([r"Left\s*(?:Setback|S/?B)"]); sm["building_setback_left_m"] = _fv(r)
    r = _lv([r"Right\s*(?:Setback|S/?B)"]); sm["building_setback_right_m"] = _fv(r)
    r = _lv([r"Rear\s*(?:Setback|S/?B)"]); sm["building_setback_rear_m"] = _fv(r)
    r = _lv([r"Garage.{0,15}(?:setback|boundary|road)"]); sm["garage_setback_to_crossover_road_m"] = _fv(r)
    r = _lv([r"Garage.{0,15}(?:kerb|road|edge)"]); sm["garage_to_kerb_m"] = _fv(r)
    r = _lv([r"Garage.{0,15}(?:nearest|side)\s*boundary"]); sm["garage_nearest_boundary_m"] = _fv(r)
    sm["garage_nearest_boundary_side"] = None
    r = _lv([r"(?:Number|No)\s*(?:of\s*)?(?:Crossover|Driveway)"]); sm["number_of_crossovers"] = int(_fv(r)) if _fv(r) else None
    sm["all_dimensions_found"] = [str(d) for d in all_dims[:30]]
    fields["siteplan_measurements"] = sm

    # ═══ utilities ═══
    ut = {}
    ut["power_line_shown"] = _kw(r'(?:power|electric|overhead|underground)\s*(?:line|cable|pole)')
    ut["power_conflict"] = _kw(r'(?:power|electric).{0,20}(?:conflict|relocat|move)')
    ut["water_main_shown"] = _kw(r'water\s*(?:main|meter|pipe)')
    ut["water_conflict"] = _kw(r'water.{0,20}(?:conflict|relocat|move)')
    ut["gas_main_shown"] = _kw(r'gas\s*(?:main|pipe|meter)')
    ut["gas_conflict"] = _kw(r'gas.{0,20}(?:conflict|relocat|move)')
    ut["telco_shown"] = _kw(r'(?:telco|nbn|fibre|telephone)')
    ut["telco_conflict"] = _kw(r'(?:telco|nbn|fibre).{0,20}(?:conflict|relocat|move)')
    ut["sewer_conflict"] = _kw(r'sewer.{0,20}(?:conflict|manhole|relocat)')
    ut["stormwater_conflict"] = _kw(r'stormwater.{0,20}(?:conflict|pit|relocat)')
    ut["utility_summary"] = None
    fields["utilities"] = ut

    # ═══ drainage ═══
    dr = {}
    dr["drainage_plan_included"] = _kw(r'drainage\s*plan|stormwater\s*(?:plan|detail)')
    dr["soakwells_proposed"] = _kw(r'soakwell|soak\s*well')
    dr["storage_tanks_proposed"] = _kw(r'storage\s*tank|detention\s*tank|rain\s*tank')
    dr["connection_to_council_drain"] = _kw(r'council\s*drain|connection\s*to\s*(?:council|main)\s*drain')
    r = _pt(r'(\d+)\s*(?:mm|MM)\s*(?:pipe|diameter|dia)', 1, "float"); dr["pipe_diameter_mm"] = _fv(r)
    fields["drainage"] = dr

    # ═══ additional_findings ═══
    af = {}
    af["is_subdivision"] = _kw(r'subdivision|sub.?division')
    af["vegetation_on_verge"] = _kw(r'(?:tree|vegetation|plant).{0,15}(?:verge|footpath|road\s*reserve)')
    af["trees_on_verge"] = _kw(r'tree.{0,10}verge')
    af["street_light_near_crossover"] = _kw(r'street\s*light|light\s*pole|lamp\s*post')
    af["fire_hydrant_near_crossover"] = _kw(r'fire\s*hydrant|hydrant')
    # Fences
    for side, key in [("left", "fence_left_of_crossover"), ("right", "fence_right_of_crossover")]:
        fence_m = re.search(rf'(?:{side}).{{0,30}}((?:colorbond|timber|brick|retaining|hedge|picket)\s*(?:fence|wall)?)', full_text, re.IGNORECASE)
        if fence_m:
            ht_m = re.search(rf'{fence_m.group(1)}.{{0,15}}(\d+(?:\.\d+)?)\s*m', full_text, re.IGNORECASE)
            af[key] = {"exists": True, "type": fence_m.group(1).strip(), "height_m": float(ht_m.group(1)) if ht_m else None, "distance_from_crossover_m": None, "truncated": None}
        else:
            af[key] = None
    rw_m = re.search(r'retaining\s*wall', full_text, re.IGNORECASE)
    af["retaining_wall_near_crossover"] = {"exists": True, "side": None, "height_m": None, "distance_from_crossover_m": None} if rw_m else None
    af["sight_obstruction_notes"] = None
    af["notes"] = None
    fields["additional_findings"] = af

    return fields
