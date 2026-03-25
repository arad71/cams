"""
Building Application Site Plan Extractor

When a Building Application PDF is uploaded:
1. Convert all pages to images
2. Send each page to Claude Vision: "Is this a site plan?"
3. Extract identified site plan pages as a separate PDF
4. Save as a "Site Plan" document on the application
5. Run AI site plan analysis on the extracted pages only
"""
import io
import base64
from pathlib import Path
from typing import List, Tuple

from app.core.config import get_settings

settings = get_settings()


def identify_site_plan_pages(file_bytes: bytes, filename: str, api_key: str, model: str) -> List[int]:
    """Use Claude Vision to identify which pages of a building application are site plans.
    Returns list of 1-based page numbers."""
    from app.services.ai_analyser import file_to_images_from_upload

    images = file_to_images_from_upload(file_bytes, filename, max_dim=1024)
    if not images:
        return []

    # For single-page docs, assume it's the site plan
    if len(images) == 1:
        return [1]

    # Send all page thumbnails to Claude in one request
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)

        content = []
        for img in images:
            content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": img["media_type"], "data": img["base64"]}
            })
            content.append({
                "type": "text",
                "text": f"[PAGE {img['page']}]"
            })

        content.append({
            "type": "text",
            "text": """Examine each page above. Identify which pages are SITE PLANS or SITE LAYOUT DRAWINGS.

A site plan typically shows:
- Property boundaries with dimensions
- Proposed crossover/driveway location and width
- Setback measurements
- North arrow, scale bar
- Road frontage
- Building footprint relative to boundaries

Respond with JSON only:
{"site_plan_pages": [1, 3], "reasoning": "Page 1 shows the site layout with dimensions. Page 3 shows the crossover detail."}

If NO pages are site plans, return: {"site_plan_pages": [], "reasoning": "No site plan pages found"}"""
        })

        resp = client.messages.create(
            model=model,
            max_tokens=500,
            messages=[{"role": "user", "content": content}]
        )

        import json
        text = resp.content[0].text.strip()
        # Strip markdown fences
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

        result = json.loads(text)
        pages = result.get("site_plan_pages", [])
        reasoning = result.get("reasoning", "")
        print(f"  ✓ Building app page classification: pages {pages} — {reasoning}")
        return [int(p) for p in pages if isinstance(p, (int, float)) and 1 <= p <= len(images)]

    except Exception as e:
        print(f"  ⚠ Page classification failed: {e}")
        # Fallback: return all pages
        return list(range(1, len(images) + 1))


def extract_pdf_pages(file_bytes: bytes, pages: List[int]) -> bytes:
    """Extract specific pages from a PDF and return as new PDF bytes."""
    # Try PyMuPDF
    try:
        import fitz
        src = fitz.open(stream=file_bytes, filetype="pdf")
        dst = fitz.open()
        for p in sorted(pages):
            if 1 <= p <= len(src):
                dst.insert_pdf(src, from_page=p - 1, to_page=p - 1)
        out = dst.tobytes(); dst.close(); src.close()
        return out
    except ImportError:
        pass
    # Try pikepdf
    try:
        import pikepdf
        src = pikepdf.Pdf.open(io.BytesIO(file_bytes))
        dst = pikepdf.Pdf.new()
        for p in sorted(pages):
            if 1 <= p <= len(src.pages):
                dst.pages.append(src.pages[p - 1])
        buf = io.BytesIO(); dst.save(buf)
        return buf.getvalue()
    except ImportError:
        pass
    # Try pypdf
    try:
        from pypdf import PdfReader, PdfWriter
        reader = PdfReader(io.BytesIO(file_bytes))
        writer = PdfWriter()
        for p in sorted(pages):
            if 1 <= p <= len(reader.pages):
                writer.add_page(reader.pages[p - 1])
        buf = io.BytesIO(); writer.write(buf)
        return buf.getvalue()
    except ImportError:
        pass
    # Fallback: pdf2image — render pages as images, save as PDF
    try:
        from pdf2image import convert_from_bytes
        all_imgs = convert_from_bytes(file_bytes, dpi=200)
        selected = [all_imgs[p - 1] for p in sorted(pages) if 1 <= p <= len(all_imgs)]
        if selected:
            buf = io.BytesIO()
            selected[0].save(buf, format="PDF", save_all=True, append_images=selected[1:])
            return buf.getvalue()
    except Exception as e:
        print(f"  ⚠ pdf2image extract fallback failed: {e}")
    return file_bytes


def process_building_application(
    app, doc, file_bytes: bytes, db, current_user_id: int
) -> dict:
    """
    Process a building application:
    1. Identify site plan pages
    2. Extract them as a new document
    3. Run AI analysis on extracted site plan
    Returns: {"site_plan_pages": [...], "site_plan_doc_id": ..., "analysis": ...}
    """
    from app.models.application import Document
    from app.core.config import get_settings

    settings = get_settings()
    if not settings.ANTHROPIC_API_KEY:
        return {"error": "No API key configured"}

    model = settings.AI_MODEL_DEFAULT

    # Step 1: Identify site plan pages
    print(f"  → Identifying site plan pages in {doc.name}...")
    pages = identify_site_plan_pages(file_bytes, doc.name, settings.ANTHROPIC_API_KEY, model)

    if not pages:
        print(f"  ℹ No site plan pages found in building application")
        return {"site_plan_pages": [], "message": "No site plan pages identified"}

    # Step 2: Extract site plan pages as separate PDF
    print(f"  → Extracting pages {pages} as site plan...")
    ext = (doc.name.rsplit(".", 1)[-1] if "." in doc.name else "pdf").lower()

    if ext == "pdf" and len(pages) < _count_pdf_pages(file_bytes):
        sp_bytes = extract_pdf_pages(file_bytes, pages)
        sp_filename = f"SitePlan_from_{doc.name}"
    else:
        # Single page or image — use the full file
        sp_bytes = file_bytes
        sp_filename = f"SitePlan_{doc.name}"

    # Step 3: Save extracted site plan as a new document
    app_dir = Path(settings.DOCUMENT_DIR) / app.ref_number
    app_dir.mkdir(parents=True, exist_ok=True)
    sp_path = app_dir / sp_filename
    counter = 1
    while sp_path.exists():
        sp_path = app_dir / f"SitePlan_{counter}_{doc.name}"
        counter += 1

    with open(sp_path, "wb") as f:
        f.write(sp_bytes)

    sp_size = len(sp_bytes)
    if sp_size < 1024:
        size_str = f"{sp_size} B"
    elif sp_size < 1048576:
        size_str = f"{sp_size / 1024:.1f} KB"
    else:
        size_str = f"{sp_size / 1048576:.1f} MB"

    sp_doc = Document(
        application_id=app.id,
        uploaded_by_id=current_user_id,
        name=sp_filename,
        file_type="pdf" if ext == "pdf" else ext,
        file_size=size_str,
        category="Site Plan",
        file_path=str(sp_path),
    )
    db.add(sp_doc)
    db.commit()
    db.refresh(sp_doc)
    print(f"  ✓ Created site plan document: {sp_filename} ({size_str})")

    # Step 4: Run AI analysis on the extracted site plan
    from app.api.applications import _run_site_plan_ai
    try:
        _run_site_plan_ai(app, sp_doc, sp_bytes, db)
    except Exception as e:
        print(f"  ⚠ Site plan analysis failed: {e}")

    return {
        "site_plan_pages": pages,
        "site_plan_doc_id": sp_doc.id,
        "site_plan_filename": sp_filename,
    }


def _count_pdf_pages(file_bytes: bytes) -> int:
    """Count pages in a PDF using whatever library is available."""
    try:
        import fitz
        doc = fitz.open(stream=file_bytes, filetype="pdf"); n = len(doc); doc.close()
        return n
    except ImportError:
        pass
    try:
        import pikepdf
        return len(pikepdf.Pdf.open(io.BytesIO(file_bytes)).pages)
    except ImportError:
        pass
    try:
        from pypdf import PdfReader
        return len(PdfReader(io.BytesIO(file_bytes)).pages)
    except ImportError:
        pass
    try:
        from pdf2image import convert_from_bytes
        return len(convert_from_bytes(file_bytes, dpi=72))
    except Exception:
        pass
    # Last resort: parse PDF for /Count
    try:
        import re as _re
        matches = _re.findall(rb"/Count\s+(\d+)", file_bytes)
        if matches:
            return max(int(m) for m in matches)
    except Exception:
        pass
    return 1
