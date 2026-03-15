#!/usr/bin/env python3
"""
Crossover Application Reader (Enhanced)
=========================================
Reads a filled-in City of Kalamunda Crossover Application PDF
and extracts the entered values as structured JSON.

Enhanced features:
  - Signature detection: analyses the signature field region for ink marks,
    returns signed=true/false
  - Handwriting / OCR: uses Tesseract OCR on each entry region to detect
    handwritten text (scanned forms, pen-filled PDFs)
  - Multi-method: annotations, fillable fields, embedded text, AND image OCR
  - Confidence scoring per field

Usage:
    python read_crossover_application.py <filled.pdf> [--output values.json]
"""

import json
import re
import sys
import os
from collections import OrderedDict

try:
    import pdfplumber
except ImportError:
    os.system("pip install pdfplumber --break-system-packages -q")
    import pdfplumber

from pypdf import PdfReader

try:
    from PIL import Image
    import numpy as np
    import pytesseract
    from pdf2image import convert_from_path
    IMAGE_ANALYSIS_AVAILABLE = True
except ImportError:
    IMAGE_ANALYSIS_AVAILABLE = False


# ─── Form field definitions ─────────────────────────────────────────────────
FIELD_MAP = OrderedDict([
    ("lot_owner_name", {
        "label": "Lot Owner's Name",
        "top_range": (215, 240),
        "entry_box": (190, 220, 540, 237),
        "label_pattern": r"Lot\s+Owner.s\s+Name",
        "is_signature": False,
    }),
    ("phone", {
        "label": "Phone",
        "top_range": (240, 268),
        "entry_box": (190, 246, 540, 263),
        "label_pattern": r"^Phone:",
        "is_signature": False,
    }),
    ("email", {
        "label": "Email",
        "top_range": (268, 295),
        "entry_box": (190, 273, 540, 290),
        "label_pattern": r"^Email:",
        "is_signature": False,
    }),
    ("postal_address", {
        "label": "Postal Address",
        "top_range": (295, 322),
        "entry_box": (190, 300, 540, 317),
        "label_pattern": r"Postal\s+Address",
        "is_signature": False,
    }),
    ("property_address", {
        "label": "Address of property requiring a crossover",
        "top_range": (322, 363),
        "entry_box": (190, 327, 540, 355),
        "label_pattern": r"Address\s+of\s+property",
        "is_signature": False,
    }),
    ("estimated_construction_date", {
        "label": "Estimated construction date",
        "top_range": (363, 388),
        "entry_box": (190, 368, 540, 385),
        "label_pattern": r"Estimated\s+construction",
        "is_signature": False,
    }),
    ("dev_application_number", {
        "label": "Development or building application number",
        "top_range": (388, 445),
        "entry_box": (190, 393, 540, 440),
        "label_pattern": r"Development\s+or\s+building",
        "is_signature": False,
    }),
    ("lot_owner_signature", {
        "label": "Lot Owner's Signature",
        "top_range": (495, 522),
        "entry_box": (190, 497, 540, 520),
        "label_pattern": r"Lot\s+Owner.s\s+Signature",
        "is_signature": True,
    }),
    ("date_signed", {
        "label": "Date",
        "top_range": (522, 550),
        "entry_box": (190, 527, 540, 544),
        "label_pattern": r"^Date:",
        "is_signature": False,
    }),
    ("num_attachments", {
        "label": "Number of attachments",
        "top_range": (583, 610),
        "entry_box": (190, 589, 540, 606),
        "label_pattern": r"Number\s+of\s+attachments",
        "is_signature": False,
    }),
])

ENTRY_X_MIN = 170
SIG_INK_THRESHOLD = 0.005
SIG_DARK_PIXEL_MAX = 150
SIG_BORDER_MARGIN = 4
OCR_UPSCALE = 3
OCR_MIN_CONFIDENCE = 30

TEMPLATE_WORDS = {
    "by", "signing", "this", "the", "declares", "that", "they", "will",
    "construct", "crossover", "in", "accordance", "with", "specification",
    "for", "construction", "and", "ensure", "protection", "of", "trees",
    "vegetation", "verge", "please", "attach", "a", "site", "plan",
    "clearly", "dimensioned", "showing", "all", "details", "required",
    "specifications", "office", "use", "only", "assessment", "notes",
    "sign", "date", "authorisation", "enquiries", "may", "be", "directed",
    "to", "asset", "services", "team", "calling", "city", "on", "or",
    "emailing", "allow", "three", "weeks", "processing", "application",
    "form", "is", "require", "d", "crossovers", "must", "completed",
    "lot", "owner", "owner's", "number", "attachments", "estimated",
    "construction", "development", "building", "if", "applicable",
    "applicable)", "postal", "address", "property", "requiring",
    "phone", "email", "signature", "name:", "phone:", "email:",
}

STATIC_PHRASES = [
    "OFFICE USE ONLY", "Assessment Notes", "Sign and Date for",
    "Authorisation of Crossover", "Construction",
    "Please attach a site plan", "clearly dimensioned",
    "showing all details required in the Specifications",
]


def find_application_page(pdf_path):
    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            if (re.search(r"Crossover\s+Application", text)
                    and "Lot Owner" in text
                    and ("Number of attachments" in text
                         or "Estimated construction date" in text)):
                return i
    return None


def read_annotations(pdf_path, page_index):
    reader = PdfReader(pdf_path)
    page = reader.pages[page_index]
    page_height = float(page.mediabox.height)
    annots = page.get("/Annots")
    if not annots:
        return {}
    values = {}
    for annot_ref in annots:
        annot = annot_ref.get_object()
        if str(annot.get("/Subtype", "")) != "/FreeText":
            continue
        contents = annot.get("/Contents")
        rect = annot.get("/Rect")
        if not contents or not rect:
            continue
        text = str(contents).strip()
        if not text:
            continue
        x0 = float(rect[0])
        y_top = page_height - float(rect[3])
        if x0 < ENTRY_X_MIN:
            continue
        matched = _match_y_to_field(y_top)
        if matched:
            values[matched] = text
    return values


def read_form_fields(pdf_path, page_index):
    reader = PdfReader(pdf_path)
    page_height = float(reader.pages[page_index].mediabox.height)
    fields = reader.get_fields()
    if not fields:
        return {}
    values = {}
    for field_name, field_obj in fields.items():
        val = field_obj.get("/V")
        if not val:
            continue
        text = str(val).strip().lstrip("/")
        widget = field_obj.get("/Rect") or field_obj.get("rect")
        if widget and float(widget[0]) >= ENTRY_X_MIN:
            y_top = page_height - float(widget[3])
            matched = _match_y_to_field(y_top)
            if matched:
                values[matched] = text
                continue
        name_lower = field_name.lower().replace("_", " ")
        for fid, fdef in FIELD_MAP.items():
            if fdef["label"].lower() in name_lower or fid.replace("_", " ") in name_lower:
                values[fid] = text
                break
    return values


def read_embedded_text(pdf_path, page_index):
    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[page_index]
        all_words = page.extract_words(keep_blank_chars=True)
    values = {}
    for field_id, field_def in FIELD_MAP.items():
        if field_def["is_signature"]:
            continue
        top_min, top_max = field_def["top_range"]
        entry_words = []
        for w in all_words:
            if (top_min <= float(w["top"]) <= top_max
                    and float(w["x0"]) >= ENTRY_X_MIN
                    and w["text"].lower().rstrip(":.,;") not in TEMPLATE_WORDS):
                entry_words.append(w)
        if entry_words:
            entry_words.sort(key=lambda w: (w["top"], w["x0"]))
            text = " ".join(w["text"] for w in entry_words).strip()
            for phrase in STATIC_PHRASES:
                text = text.replace(phrase, "").strip()
            if text:
                values[field_id] = text
    return values


def render_page_image(pdf_path, page_index):
    images = convert_from_path(
        pdf_path, first_page=page_index + 1, last_page=page_index + 1, dpi=200,
    )
    return images[0] if images else None


def detect_signature(page_image, page_w, page_h, entry_box):
    img_arr = np.array(page_image.convert("RGB"))
    img_h, img_w = img_arr.shape[:2]
    sx, sy = img_w / page_w, img_h / page_h

    x0, y0, x1, y1 = entry_box
    px0 = int(x0 * sx) + SIG_BORDER_MARGIN
    py0 = int(y0 * sy) + SIG_BORDER_MARGIN
    px1 = int(x1 * sx) - SIG_BORDER_MARGIN
    py1 = int(y1 * sy) - SIG_BORDER_MARGIN

    crop = img_arr[py0:py1, px0:px1]
    if crop.size == 0:
        return False, 0.0, "empty region"

    gray = np.mean(crop, axis=2)
    total = gray.size
    ink_pixels = np.sum((gray < SIG_DARK_PIXEL_MAX) & (gray > 5))
    ink_ratio = float(ink_pixels / total)
    signed = bool(ink_ratio > SIG_INK_THRESHOLD)

    detail = (f"ink detected ({ink_ratio:.1%} dark pixels)" if signed
              else f"no ink ({ink_ratio:.1%} dark pixels, need >{SIG_INK_THRESHOLD:.1%})")
    return signed, round(ink_ratio, 6), detail


def ocr_field_region(page_image, page_w, page_h, entry_box):
    img_arr = np.array(page_image.convert("RGB"))
    img_h, img_w = img_arr.shape[:2]
    sx, sy = img_w / page_w, img_h / page_h

    x0, y0, x1, y1 = entry_box
    m = 2
    px0 = max(0, int(x0 * sx) + m)
    py0 = max(0, int(y0 * sy) + m)
    px1 = min(img_w, int(x1 * sx) - m)
    py1 = min(img_h, int(y1 * sy) - m)

    crop = img_arr[py0:py1, px0:px1]
    if crop.size == 0:
        return "", 0, "empty"

    gray = np.mean(crop, axis=2)
    if np.sum(gray < 150) / gray.size < 0.003:
        return "", 0, "blank"

    crop_img = Image.fromarray(crop)
    upscaled = crop_img.resize(
        (crop_img.width * OCR_UPSCALE, crop_img.height * OCR_UPSCALE), Image.LANCZOS,
    )

    ocr_data = pytesseract.image_to_data(
        upscaled, config="--psm 7", output_type=pytesseract.Output.DICT
    )
    words, confs = [], []
    for i, t in enumerate(ocr_data["text"]):
        c = int(ocr_data["conf"][i])
        w = t.strip()
        if w and c >= OCR_MIN_CONFIDENCE:
            words.append(w)
            confs.append(c)

    if not words:
        fallback = pytesseract.image_to_string(upscaled, config="--psm 7").strip()
        fallback = re.sub(r'[|}{[\]\\]', '', fallback).strip()
        return (fallback, 50, "ocr_fallback") if fallback else ("", 0, "ocr_empty")

    return " ".join(words), round(sum(confs) / len(confs)), "ocr"


def run_image_analysis(pdf_path, page_index, page_w, page_h):
    print("  Rendering page at 200 DPI...")
    page_img = render_page_image(pdf_path, page_index)
    if not page_img:
        print("    → render failed")
        return {}, {}

    sig_results, ocr_results = {}, {}

    for fid, fdef in FIELD_MAP.items():
        box = fdef["entry_box"]
        if fdef["is_signature"]:
            signed, ink, detail = detect_signature(page_img, page_w, page_h, box)
            sig_results[fid] = {"signed": signed, "ink_ratio": ink, "detail": detail}
        else:
            text, conf, src = ocr_field_region(page_img, page_w, page_h, box)
            if text:
                ocr_results[fid] = {"text": text, "confidence": conf, "source": src}

    return sig_results, ocr_results


def _match_y_to_field(y_top):
    for fid, fdef in FIELD_MAP.items():
        lo, hi = fdef["top_range"]
        if lo <= y_top <= hi:
            return fid
    best, best_d = None, 999
    for fid, fdef in FIELD_MAP.items():
        mid = sum(fdef["top_range"]) / 2
        d = abs(y_top - mid)
        if d < best_d and d < 30:
            best_d, best = d, fid
    return best


def _text_similar(a, b):
    a_c = re.sub(r'[^a-zA-Z0-9]', '', a.lower())
    b_c = re.sub(r'[^a-zA-Z0-9]', '', b.lower())
    if not a_c or not b_c:
        return False
    short, long = sorted([a_c, b_c], key=len)
    return short in long


def read_application(pdf_path):
    print(f"\nReading: {pdf_path}")

    page_idx = find_application_page(pdf_path)
    if page_idx is None:
        print("ERROR: Crossover Application form not found.")
        return None

    page_num = page_idx + 1
    print(f"Found form on page {page_num}")

    reader = PdfReader(pdf_path)
    pg = reader.pages[page_idx]
    page_w, page_h = float(pg.mediabox.width), float(pg.mediabox.height)

    print("  [1/4] Annotations...")
    annot_values = read_annotations(pdf_path, page_idx)
    print(f"         → {len(annot_values)} field(s)")

    print("  [2/4] Form fields...")
    form_values = read_form_fields(pdf_path, page_idx)
    print(f"         → {len(form_values)} field(s)")

    print("  [3/4] Embedded text...")
    text_values = read_embedded_text(pdf_path, page_idx)
    print(f"         → {len(text_values)} field(s)")

    sig_results, ocr_results = {}, {}
    if IMAGE_ANALYSIS_AVAILABLE:
        print("  [4/4] Image analysis (signature + handwriting OCR)...")
        sig_results, ocr_results = run_image_analysis(pdf_path, page_idx, page_w, page_h)
        sig_n = sum(1 for v in sig_results.values() if v["signed"])
        print(f"         → {sig_n} signature(s), {len(ocr_results)} OCR field(s)")
    else:
        print("  [4/4] Skipped (install Pillow, numpy, pytesseract, pdf2image)")

    # ── Merge ──
    fields_output = []
    for fid, fdef in FIELD_MAP.items():

        if fdef["is_signature"]:
            si = sig_results.get(fid, {})
            signed = si.get("signed", False)
            fields_output.append({
                "field_id": fid,
                "label": fdef["label"],
                "value": None,
                "signed": signed,
                "filled": signed,
                "source": "image_analysis" if signed else None,
                "confidence": 95 if signed else None,
                "signature_detail": si.get("detail"),
                "ink_ratio": si.get("ink_ratio"),
            })
            continue

        value, source, confidence = None, None, None

        if fid in annot_values and annot_values[fid]:
            value, source, confidence = annot_values[fid], "annotation", 99
        elif fid in form_values and form_values[fid]:
            value, source, confidence = form_values[fid], "form_field", 99
        elif fid in text_values and text_values[fid]:
            value, source, confidence = text_values[fid], "embedded_text", 90
        elif fid in ocr_results:
            o = ocr_results[fid]
            # Only accept OCR results above a confidence threshold
            # to avoid false positives from cell borders / noise
            if o["confidence"] >= 60:
                value = o["text"]
                source = f"handwriting_ocr ({o['source']})"
                confidence = o["confidence"]

        # Cross-validate with OCR
        if value and fid in ocr_results and "handwriting" not in (source or ""):
            if _text_similar(value, ocr_results[fid]["text"]):
                confidence = min(99, (confidence or 90) + 5)
                source = f"{source} (confirmed by OCR)"

        fields_output.append({
            "field_id": fid,
            "label": fdef["label"],
            "value": value,
            "filled": value is not None,
            "source": source,
            "confidence": confidence,
        })

    filled_count = sum(1 for f in fields_output if f["filled"])

    result = {
        "form_title": "Crossover Application",
        "source_file": os.path.basename(pdf_path),
        "source_page": page_num,
        "extraction_methods": {
            "annotations": len(annot_values),
            "form_fields": len(form_values),
            "embedded_text": len(text_values),
            "ocr_fields": len(ocr_results),
            "signatures_detected": sum(1 for v in sig_results.values() if v["signed"]),
        },
        "summary": {
            "total_fields": len(fields_output),
            "filled_fields": filled_count,
            "empty_fields": len(fields_output) - filled_count,
        },
        "fields": fields_output,
        "values": {},
    }

    for f in fields_output:
        if f["field_id"] == "lot_owner_signature":
            result["values"][f["field_id"]] = f["signed"]
        elif f["filled"]:
            result["values"][f["field_id"]] = f["value"]

    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python read_crossover_application.py <filled.pdf> [--output values.json]")
        sys.exit(1)

    pdf_file = sys.argv[1]
    output_file = None
    if "--output" in sys.argv:
        i = sys.argv.index("--output")
        if i + 1 < len(sys.argv):
            output_file = sys.argv[i + 1]

    if not os.path.exists(pdf_file):
        print(f"Error: {pdf_file} not found")
        sys.exit(1)

    data = read_application(pdf_file)
    if not data:
        sys.exit(1)

    if not output_file:
        base = os.path.splitext(os.path.basename(pdf_file))[0]
        output_file = os.path.join(os.path.dirname(pdf_file) or ".", f"{base}_values.json")

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"\n{'━'*65}")
    print(f"  CROSSOVER APPLICATION — EXTRACTED VALUES")
    print(f"{'━'*65}")
    print(f"  File:    {data['source_file']}")
    print(f"  Page:    {data['source_page']}")
    print(f"  Filled:  {data['summary']['filled_fields']}/{data['summary']['total_fields']} fields")
    print(f"{'━'*65}")

    for field in data["fields"]:
        fid = field["field_id"]
        if fid == "lot_owner_signature":
            signed = field.get("signed", False)
            icon = "✓" if signed else "✗"
            ink = field.get("ink_ratio")
            ink_str = f" (ink: {ink:.2%})" if ink is not None else ""
            print(f"  {icon} {field['label']:50s} signed={signed}{ink_str}")
        else:
            icon = "✓" if field["filled"] else "✗"
            val = field["value"] or "(empty)"
            src = ""
            if field.get("source"):
                src = f" [{field['source']}"
                if field.get("confidence"):
                    src += f", {field['confidence']}%"
                src += "]"
            print(f"  {icon} {field['label']:50s} {val}{src}")

    print(f"{'━'*65}")
    print(f"  Output:  {output_file}")
    print(f"{'━'*65}")
    print(f"\n  === VALUES (JSON) ===")
    print(json.dumps(data["values"], indent=4))
    print()