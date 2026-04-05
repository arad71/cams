"""
CAMS — PDF Assessment Report Generator

Generates a professional PDF report for a crossover application including:
- Council header and application details
- 206-rule checklist results grouped by category
- Officer notes
- Recommendation and signature block
"""

import io
from datetime import datetime
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm, cm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable, KeepTogether,
)


# ── Colours ──
NAVY = colors.HexColor("#1a3a4a")
TEAL = colors.HexColor("#1abc9c")
GREEN = colors.HexColor("#27ae60")
RED = colors.HexColor("#e74c3c")
ORANGE = colors.HexColor("#e67e22")
AMBER = colors.HexColor("#f39c12")
GREY = colors.HexColor("#7a8a94")
LIGHT_BG = colors.HexColor("#f5f8fa")
WHITE = colors.white
PASS_BG = colors.HexColor("#eafaf1")
FAIL_BG = colors.HexColor("#fdedec")
REVIEW_BG = colors.HexColor("#fef9e7")


def _styles():
    ss = getSampleStyleSheet()
    ss.add(ParagraphStyle("ReportTitle", parent=ss["Title"], fontSize=18, textColor=NAVY, spaceAfter=4, alignment=TA_LEFT))
    ss.add(ParagraphStyle("ReportSubtitle", parent=ss["Normal"], fontSize=11, textColor=GREY, spaceAfter=12))
    ss.add(ParagraphStyle("SectionHead", parent=ss["Heading2"], fontSize=13, textColor=NAVY, spaceBefore=14, spaceAfter=6, borderPadding=(0, 0, 2, 0)))
    ss.add(ParagraphStyle("CatHead", parent=ss["Heading3"], fontSize=11, textColor=NAVY, spaceBefore=10, spaceAfter=4))
    ss.add(ParagraphStyle("Body", parent=ss["Normal"], fontSize=9, leading=12, textColor=colors.black))
    ss.add(ParagraphStyle("BodySmall", parent=ss["Normal"], fontSize=8, leading=10, textColor=GREY))
    ss.add(ParagraphStyle("NoteText", parent=ss["Normal"], fontSize=9, leading=12, textColor=colors.black, leftIndent=8))
    ss.add(ParagraphStyle("RecText", parent=ss["Normal"], fontSize=12, leading=16, textColor=colors.black, alignment=TA_CENTER))
    ss.add(ParagraphStyle("Footer", parent=ss["Normal"], fontSize=7, textColor=GREY, alignment=TA_CENTER))
    return ss


def _header_footer(canvas, doc, council_name, app_ref):
    """Draw header and footer on every page."""
    canvas.saveState()
    w, h = A4

    # Header line
    canvas.setStrokeColor(TEAL)
    canvas.setLineWidth(2)
    canvas.line(15 * mm, h - 18 * mm, w - 15 * mm, h - 18 * mm)

    # Header text
    canvas.setFont("Helvetica-Bold", 9)
    canvas.setFillColor(NAVY)
    canvas.drawString(15 * mm, h - 16 * mm, council_name)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(GREY)
    canvas.drawRightString(w - 15 * mm, h - 16 * mm, f"Crossover Assessment Report — {app_ref}")

    # Footer
    canvas.setStrokeColor(colors.HexColor("#e4e9ec"))
    canvas.setLineWidth(0.5)
    canvas.line(15 * mm, 14 * mm, w - 15 * mm, 14 * mm)
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(GREY)
    canvas.drawString(15 * mm, 10 * mm, f"Generated {datetime.now().strftime('%d %b %Y %H:%M')} — CAMS Crossover Assessment Management System")
    canvas.drawRightString(w - 15 * mm, 10 * mm, f"Page {doc.page}")

    canvas.restoreState()


def generate_assessment_pdf(report_data: dict, council_name: str = "City of Kalamunda") -> bytes:
    """
    Generate a PDF assessment report.

    report_data should contain:
        app_snapshot: {ref_number, owner_name, property_address, lot_number, ...}
        summary_data: {total, ai_pass, ai_fail, ai_review, score_pct, ...}
        checklist_snapshot: {code: {ai_result, officer_result, ai_reason, note, ...}}
        notes_snapshot: [{text, author, date}, ...]
        recommendation: "APPROVE" | "REJECT" | "REVIEW"
        categories: [{code, label, icon, items: [{code, label, reference}, ...]}]
        status_at_generation: str
        generated_by_name: str
        version: int
    """
    buf = io.BytesIO()
    styles = _styles()

    app = report_data.get("app_snapshot", {})
    summary = report_data.get("summary_data", {})
    checklist = report_data.get("checklist_snapshot", {})
    notes = report_data.get("notes_snapshot", [])
    recommendation = report_data.get("recommendation", "REVIEW")
    categories = report_data.get("categories", [])
    app_ref = app.get("ref_number", "—")

    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=15 * mm, rightMargin=15 * mm,
        topMargin=22 * mm, bottomMargin=18 * mm,
    )

    story = []

    # ══════════════════════════════════════════════════════════
    # TITLE
    # ══════════════════════════════════════════════════════════
    story.append(Paragraph(f"Crossover Assessment Report", styles["ReportTitle"]))
    story.append(Paragraph(
        f"{app_ref} — Version {report_data.get('version', 1)} — "
        f"{datetime.now().strftime('%d %B %Y')}",
        styles["ReportSubtitle"]
    ))

    # ══════════════════════════════════════════════════════════
    # APPLICATION DETAILS
    # ══════════════════════════════════════════════════════════
    story.append(Paragraph("Application Details", styles["SectionHead"]))

    details = [
        ["Reference", app.get("ref_number", "—"), "Status", report_data.get("status_at_generation", "—")],
        ["Owner", app.get("owner_name", "—"), "Officer", app.get("officer", "—")],
        ["Address", app.get("property_address", "—"), "Lot", app.get("lot_number", "—")],
        ["Road", app.get("road_name", "—"), "Frontage", f"{app.get('frontage', '—')}m"],
        ["Crossover Width", f"{app.get('crossover_width', '—')}m", "Surface", app.get("crossover_surface", "—")],
    ]

    detail_table = Table(details, colWidths=[25 * mm, 60 * mm, 25 * mm, 60 * mm])
    detail_table.setStyle(TableStyle([
        ("FONT", (0, 0), (0, -1), "Helvetica-Bold", 8),
        ("FONT", (2, 0), (2, -1), "Helvetica-Bold", 8),
        ("FONT", (1, 0), (1, -1), "Helvetica", 9),
        ("FONT", (3, 0), (3, -1), "Helvetica", 9),
        ("TEXTCOLOR", (0, 0), (0, -1), GREY),
        ("TEXTCOLOR", (2, 0), (2, -1), GREY),
        ("TEXTCOLOR", (1, 0), (1, -1), NAVY),
        ("TEXTCOLOR", (3, 0), (3, -1), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LINEBELOW", (0, -1), (-1, -1), 0.5, colors.HexColor("#e4e9ec")),
    ]))
    story.append(detail_table)
    story.append(Spacer(1, 8))

    # ══════════════════════════════════════════════════════════
    # ASSESSMENT SUMMARY
    # ══════════════════════════════════════════════════════════
    story.append(Paragraph("Assessment Summary", styles["SectionHead"]))

    total = summary.get("total", 0)
    ai_pass = summary.get("ai_pass", 0)
    ai_fail = summary.get("ai_fail", 0)
    ai_review = summary.get("ai_review", 0)
    score = summary.get("score_pct", 0)
    off_approved = summary.get("officer_approved", 0)
    off_rejected = summary.get("officer_rejected", 0)

    sum_data = [
        ["Total Rules", str(total), "AI Pass", str(ai_pass), "AI Fail", str(ai_fail), "Review", str(ai_review)],
        ["Score", f"{score}%", "Officer OK", str(off_approved), "Officer Reject", str(off_rejected), "", ""],
    ]
    sum_table = Table(sum_data, colWidths=[22 * mm] * 8)
    sum_table.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), "Helvetica", 8),
        ("FONT", (1, 0), (1, -1), "Helvetica-Bold", 9),
        ("FONT", (3, 0), (3, 0), "Helvetica-Bold", 9),
        ("FONT", (5, 0), (5, 0), "Helvetica-Bold", 9),
        ("FONT", (7, 0), (7, 0), "Helvetica-Bold", 9),
        ("TEXTCOLOR", (3, 0), (3, 0), GREEN),
        ("TEXTCOLOR", (5, 0), (5, 0), RED),
        ("TEXTCOLOR", (7, 0), (7, 0), AMBER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("BACKGROUND", (0, 0), (-1, 0), LIGHT_BG),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e4e9ec")),
    ]))
    story.append(sum_table)
    story.append(Spacer(1, 10))

    # ══════════════════════════════════════════════════════════
    # RECOMMENDATION BOX
    # ══════════════════════════════════════════════════════════
    rec_color = GREEN if recommendation == "APPROVE" else RED if recommendation == "REJECT" else ORANGE
    rec_bg = PASS_BG if recommendation == "APPROVE" else FAIL_BG if recommendation == "REJECT" else REVIEW_BG
    rec_label = recommendation.replace("_", " ")

    rec_table = Table(
        [[Paragraph(f"<b>RECOMMENDATION: {rec_label}</b>", styles["RecText"])]],
        colWidths=[170 * mm],
    )
    rec_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), rec_bg),
        ("TEXTCOLOR", (0, 0), (-1, -1), rec_color),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("BOX", (0, 0), (-1, -1), 1.5, rec_color),
        ("ROUNDEDCORNERS", [4, 4, 4, 4]),
    ]))
    story.append(rec_table)
    story.append(Spacer(1, 6))

    # ══════════════════════════════════════════════════════════
    # CHECKLIST RESULTS BY CATEGORY
    # ══════════════════════════════════════════════════════════
    story.append(Paragraph("Assessment Checklist", styles["SectionHead"]))

    for cat in categories:
        cat_code = cat.get("code", "")
        cat_label = cat.get("label", cat_code)
        cat_icon = cat.get("icon", "")
        items = cat.get("items", [])

        if not items:
            continue

        # Check if any items have results
        has_results = any(item.get("code", "") in checklist for item in items)
        if not has_results:
            continue

        story.append(Paragraph(f"{cat_icon} {cat_label}", styles["CatHead"]))

        rows = [["#", "Rule", "Ref", "AI", "Officer", "Note"]]
        for idx, item in enumerate(items, 1):
            code = item.get("code", "")
            result = checklist.get(code, {})
            if not result:
                continue

            ai_res = result.get("ai_result", "—")
            off_res = result.get("officer_result", "—")
            reason = result.get("ai_reason", "") or ""
            note = result.get("note", "") or ""

            # Format AI result
            if ai_res == "pass":
                ai_display = "PASS"
            elif ai_res == "fail":
                ai_display = "FAIL"
            else:
                ai_display = "REVIEW"

            # Format officer result
            if off_res == "approved":
                off_display = "OK"
            elif off_res == "rejected":
                off_display = "REJECT"
            elif off_res:
                off_display = off_res.upper()
            else:
                off_display = "—"

            # Combine reason and note
            detail = reason[:80] if reason else ""
            if note:
                detail = (detail + " | " if detail else "") + note[:60]

            rows.append([
                str(idx),
                Paragraph(item.get("label", code)[:90], styles["BodySmall"]),
                item.get("reference", ""),
                ai_display,
                off_display,
                Paragraph(detail, styles["BodySmall"]) if detail else "",
            ])

        if len(rows) > 1:
            t = Table(rows, colWidths=[8 * mm, 65 * mm, 14 * mm, 14 * mm, 16 * mm, 53 * mm])
            t_style = [
                # Header
                ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 7),
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
                # Body
                ("FONT", (0, 1), (-1, -1), "Helvetica", 7),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("LEFTPADDING", (0, 0), (-1, -1), 3),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#e4e9ec")),
                ("ALIGN", (0, 0), (0, -1), "CENTER"),
                ("ALIGN", (3, 0), (4, -1), "CENTER"),
            ]

            # Colour AI result cells
            for i, row in enumerate(rows[1:], 1):
                ai_val = row[3]
                if ai_val == "PASS":
                    t_style.append(("BACKGROUND", (3, i), (3, i), PASS_BG))
                    t_style.append(("TEXTCOLOR", (3, i), (3, i), GREEN))
                elif ai_val == "FAIL":
                    t_style.append(("BACKGROUND", (3, i), (3, i), FAIL_BG))
                    t_style.append(("TEXTCOLOR", (3, i), (3, i), RED))
                else:
                    t_style.append(("BACKGROUND", (3, i), (3, i), REVIEW_BG))
                    t_style.append(("TEXTCOLOR", (3, i), (3, i), AMBER))

                off_val = row[4]
                if off_val == "OK":
                    t_style.append(("TEXTCOLOR", (4, i), (4, i), GREEN))
                elif off_val == "REJECT":
                    t_style.append(("TEXTCOLOR", (4, i), (4, i), RED))

                # Alternate row background
                if i % 2 == 0:
                    t_style.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#fafbfc")))

            t.setStyle(TableStyle(t_style))
            story.append(t)
            story.append(Spacer(1, 4))

    # ══════════════════════════════════════════════════════════
    # CONDITIONS OF APPROVAL
    # ══════════════════════════════════════════════════════════
    conditions_list = app.get("conditions", []) or []
    decision_note = app.get("decision_note", "") or ""

    if conditions_list:
        story.append(Paragraph("Conditions of Approval", styles["SectionHead"]))

        cond_rows = [["#", "Condition"]]
        for i, cond in enumerate(conditions_list, 1):
            cond_rows.append([str(i), Paragraph(cond, styles["Body"])])

        cond_table = Table(cond_rows, colWidths=[10 * mm, 160 * mm])
        cond_table.setStyle(TableStyle([
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8),
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
            ("FONT", (0, 1), (0, -1), "Helvetica-Bold", 9),
            ("FONT", (1, 1), (1, -1), "Helvetica", 9),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#e4e9ec")),
            ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ]))
        story.append(cond_table)
        story.append(Spacer(1, 6))

    if decision_note:
        story.append(Paragraph("Decision Note", styles["SectionHead"]))
        story.append(Paragraph(decision_note, styles["Body"]))
        story.append(Spacer(1, 6))

    # ══════════════════════════════════════════════════════════
    # OFFICER NOTES
    # ══════════════════════════════════════════════════════════
    if notes:
        story.append(Paragraph("Officer Notes", styles["SectionHead"]))

        for n in notes:
            date_str = ""
            try:
                dt = datetime.fromisoformat(n.get("date", ""))
                date_str = dt.strftime("%d %b %Y %H:%M")
            except Exception:
                date_str = n.get("date", "")

            author = n.get("author", "—")
            text = n.get("text", "")

            story.append(Paragraph(
                f"<b>{author}</b> — <i>{date_str}</i>",
                styles["BodySmall"]
            ))
            story.append(Paragraph(text, styles["NoteText"]))
            story.append(Spacer(1, 6))

    # ══════════════════════════════════════════════════════════
    # SIGNATURE BLOCK
    # ══════════════════════════════════════════════════════════
    story.append(Spacer(1, 20))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#e4e9ec")))
    story.append(Spacer(1, 12))

    sig_data = [
        ["Assessed by:", report_data.get("generated_by_name", "—"), "Date:", datetime.now().strftime("%d / %m / %Y")],
        ["", "", "", ""],
        ["Signature:", "______________________________", "Approved by:", "______________________________"],
    ]
    sig_table = Table(sig_data, colWidths=[25 * mm, 60 * mm, 25 * mm, 60 * mm])
    sig_table.setStyle(TableStyle([
        ("FONT", (0, 0), (0, -1), "Helvetica-Bold", 8),
        ("FONT", (2, 0), (2, -1), "Helvetica-Bold", 8),
        ("FONT", (1, 0), (1, -1), "Helvetica", 9),
        ("FONT", (3, 0), (3, -1), "Helvetica", 9),
        ("TEXTCOLOR", (0, 0), (0, -1), GREY),
        ("TEXTCOLOR", (2, 0), (2, -1), GREY),
        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(sig_table)

    # ── Build ──
    doc.build(
        story,
        onFirstPage=lambda c, d: _header_footer(c, d, council_name, app_ref),
        onLaterPages=lambda c, d: _header_footer(c, d, council_name, app_ref),
    )
    return buf.getvalue()
