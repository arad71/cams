"""
Site plan ↔ cadastre geometry.

1. find_lot()          – find the cadastre lot for an application, by lot number first, address second
2. plan_cadastre_check – compare the plan's lot dimensions with the cadastre lot
3. auto_georef()       – align the site plan image to the lot without manual clicks
                          (vector PDF geometry first, Claude-located corners for scans)

All geometry is done in metres on a local tangent plane centred on the lot
(east/north metres from the lot centroid). Over a 100 m site the error of this
approximation is well under a millimetre, so it is equivalent to working in
MGA2020 for these purposes and needs no projection library.
"""
from __future__ import annotations

import itertools
import json
import math
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

PDF_RENDER_DPI = 150          # must match documents.render_document_as_image
PT_TO_M_AT_1 = 0.0254 / 72    # one PDF point, in metres, at 1:1

# ─────────────────────────────────────────────────────────────────────────────
# Local metric frame
# ─────────────────────────────────────────────────────────────────────────────


class LocalFrame:
    """Equirectangular projection about a reference point (metres east/north)."""

    def __init__(self, lat0: float, lng0: float):
        self.lat0, self.lng0 = lat0, lng0
        self.my = 111_320.0
        self.mx = 111_320.0 * math.cos(math.radians(lat0))

    def to_xy(self, lat: float, lng: float) -> tuple[float, float]:
        return ((lng - self.lng0) * self.mx, (lat - self.lat0) * self.my)

    def to_ll(self, x: float, y: float) -> tuple[float, float]:
        return (self.lat0 + y / self.my, self.lng0 + x / self.mx)


def normalise_latlng_ring(poly) -> list[tuple[float, float]]:
    """Accept [[lat,lng]], [[lng,lat]] or GeoJSON-ish input, return open ring of (lat, lng)."""
    if not poly:
        return []
    if isinstance(poly, dict):  # GeoJSON geometry
        coords = poly.get("coordinates") or []
        if poly.get("type") == "MultiPolygon":
            coords = coords[0] if coords else []
        ring = coords[0] if coords else []
        pts = [(p[1], p[0]) for p in ring]
    else:
        pts = [(float(p[0]), float(p[1])) for p in poly]
        if pts and abs(pts[0][0]) > 90:  # given as [lng, lat]
            pts = [(b, a) for a, b in pts]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    return pts


def polygon_area(pts) -> float:
    return abs(sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
                   for i in range(len(pts)))) / 2


def corners(pts, min_turn_deg: float = 10.0, min_edge: float = 0.0) -> list[tuple[float, float]]:
    """Drop near-collinear vertices so only real corners remain."""
    p = [q for i, q in enumerate(pts) if i == 0 or math.dist(q, pts[i - 1]) > 1e-9]
    changed = True
    while changed and len(p) > 3:
        changed = False
        for i in range(len(p)):
            a, b, c = p[i - 1], p[i], p[(i + 1) % len(p)]
            v1 = (b[0] - a[0], b[1] - a[1]); v2 = (c[0] - b[0], c[1] - b[1])
            n1, n2 = math.hypot(*v1), math.hypot(*v2)
            if n1 <= min_edge or n2 <= min_edge or n1 * n2 == 0:
                p.pop(i); changed = True; break
            turn = math.degrees(math.acos(max(-1, min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)))))
            if turn < min_turn_deg:
                p.pop(i); changed = True; break
    return p


def min_area_rect(pts) -> tuple[float, float]:
    """Side lengths (short, long) of the minimum-area bounding rectangle."""
    best = None
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        ang = math.atan2(b[1] - a[1], b[0] - a[0])
        c, s = math.cos(-ang), math.sin(-ang)
        xs = [x * c - y * s for x, y in pts]; ys = [x * s + y * c for x, y in pts]
        w, h = max(xs) - min(xs), max(ys) - min(ys)
        if best is None or w * h < best[0] * best[1]:
            best = (w, h)
    return tuple(sorted(best)) if best else (0.0, 0.0)


# ─────────────────────────────────────────────────────────────────────────────
# Similarity fit (scale + rotation + translation, no reflection)
# ─────────────────────────────────────────────────────────────────────────────


def similarity_fit(src, dst) -> dict:
    n = len(src)
    sx = sum(p[0] for p in src) / n; sy = sum(p[1] for p in src) / n
    dx = sum(p[0] for p in dst) / n; dy = sum(p[1] for p in dst) / n
    a = b = ss = 0.0
    for (x, y), (u, v) in zip(src, dst):
        x -= sx; y -= sy; u -= dx; v -= dy
        a += x * u + y * v
        b += x * v - y * u
        ss += x * x + y * y
    theta = math.atan2(b, a)
    scale = math.hypot(a, b) / ss if ss else 1.0
    c, s = math.cos(theta) * scale, math.sin(theta) * scale

    def f(x, y):
        x -= sx; y -= sy
        return (c * x - s * y + dx, s * x + c * y + dy)

    resid = [math.dist(f(*p), q) for p, q in zip(src, dst)]
    return {"scale": scale, "rotation_deg": math.degrees(theta), "f": f,
            "rms": math.sqrt(sum(r * r for r in resid) / n), "max": max(resid)}


def best_polygon_fit(src_corners, dst_corners, expected_scale: float | None = None) -> dict | None:
    """Try every cyclic pairing (and choice of corners if counts differ). Returns the best fit."""
    if len(src_corners) < 3 or len(dst_corners) < 3:
        return None
    best = None
    small, large, swapped = (src_corners, dst_corners, False) if len(src_corners) <= len(dst_corners) \
        else (dst_corners, src_corners, True)
    k = len(small)
    for subset in itertools.combinations(range(len(large)), k):
        if len(large) > 8 and k < len(large) - 2:
            break  # keep it bounded for unusual shapes
        sub0 = [large[i] for i in subset]
        for sub, shift in ((seq, sh) for seq in (sub0, sub0[::-1]) for sh in range(k)):
            pairing = sub[shift:] + sub[:shift]
            s_pts, d_pts = (pairing, small) if swapped else (small, pairing)
            fit = similarity_fit(s_pts, d_pts)
            score = fit["rms"]
            if expected_scale:
                score += abs(fit["scale"] / expected_scale - 1) * 50  # 1 % scale error ≈ 0.5 m penalty
            if best is None or score < best["score"]:
                best = {**fit, "score": score, "src": s_pts, "dst": d_pts}
    return best


# ─────────────────────────────────────────────────────────────────────────────
# 1. Find the lot
# ─────────────────────────────────────────────────────────────────────────────

GEOJSON_DIR = Path(os.getenv("GEOJSON_OUTPUT_DIR", "/app/geojson"))


@lru_cache(maxsize=2)
def _load_lots(path: str, mtime: float) -> list[dict]:
    with open(path) as fh:
        return json.load(fh).get("features", [])


def _lots() -> list[dict]:
    p = GEOJSON_DIR / "lot.geojson"
    if not p.exists():
        return []
    return _load_lots(str(p), p.stat().st_mtime)


ROAD_TYPES = {"ROAD": "RD", "RD": "RD", "STREET": "ST", "ST": "ST", "AVENUE": "AV", "AVE": "AV", "AV": "AV",
              "CRESCENT": "CR", "CRES": "CR", "CR": "CR", "DRIVE": "DR", "DR": "DR", "COURT": "CT", "CT": "CT",
              "PLACE": "PL", "PL": "PL", "WAY": "WY", "WY": "WY", "HIGHWAY": "HWY", "HWY": "HWY",
              "CLOSE": "CL", "CL": "CL", "LANE": "LANE", "TERRACE": "TCE", "TCE": "TCE", "PARADE": "PDE", "PDE": "PDE"}


def parse_address(addr: str) -> dict:
    a = re.sub(r"\b\d{4}\b", " ", (addr or "").upper().replace(",", " "))
    a = re.sub(r"\bWA\b", " ", a)
    toks = a.split()
    out = {"number": None, "name": None, "type": None, "locality": None}
    if not toks:
        return out
    m = re.match(r"^(\d+)[A-Z]?(?:-\d+)?$", toks[0])
    if m:
        out["number"] = m.group(1); toks = toks[1:]
    for i, t in enumerate(toks):
        if t in ROAD_TYPES:
            out["name"] = " ".join(toks[:i]) or None
            out["type"] = ROAD_TYPES[t]
            out["locality"] = " ".join(toks[i + 1:]) or None
            break
    else:
        out["name"] = " ".join(toks) or None
    return out


def _lot_no(s) -> str | None:
    m = re.search(r"(\d+)", str(s or ""))
    return m.group(1) if m else None


def find_lot(address: str, lot_number: str | None, features: list[dict] | None = None) -> dict:
    """
    Returns {"status": "matched"|"ambiguous"|"not_found", "method", "confidence", "feature", "candidates"}.
    Lot number + street + suburb is preferred; the street address is the fallback.
    House numbers are compared exactly (10 never matches 107).
    """
    feats = features if features is not None else _lots()
    q = parse_address(address)
    lot = _lot_no(lot_number)
    if not feats:
        return {"status": "not_found", "method": None, "confidence": None, "feature": None,
                "reason": "No cadastre data loaded (refresh Data WA layers in Administration)", "candidates": 0}

    def props(f):
        return f.get("properties") or {}

    def street_ok(p):
        return q["name"] and (p.get("road_name") or "").upper().strip() == q["name"] and \
            (not q["type"] or ROAD_TYPES.get((p.get("road_type") or "").upper(), (p.get("road_type") or "").upper()) == q["type"])

    def suburb_ok(p):
        return not q["locality"] or (p.get("locality") or "").upper().replace(" ", "") == q["locality"].replace(" ", "")

    tiers = []
    if lot:
        tiers.append(("lot number + street + suburb", "high",
                      lambda p: _lot_no(p.get("lot_number")) == lot and street_ok(p) and suburb_ok(p)))
    if q["number"]:
        tiers.append(("street address", "medium",
                      lambda p: str(p.get("road_number_1") or "").strip() == q["number"] and street_ok(p) and suburb_ok(p)))
    if lot:
        tiers.append(("lot number + suburb", "low", lambda p: _lot_no(p.get("lot_number")) == lot and suburb_ok(p)))

    for method, conf, pred in tiers:
        hits = [f for f in feats if pred(props(f))]
        # one lot can appear once per address point; de-duplicate by land_id
        uniq = {str(props(f).get("land_id") or id(f)): f for f in hits}
        hits = list(uniq.values())
        if len(hits) == 1:
            f = hits[0]
            # Cross-check: a lot found by lot number should sit at the stated house number
            if method.startswith("lot number") and q["number"] and str(props(f).get("road_number_1") or "") not in ("", q["number"]):
                s = feature_summary(f)
                return {"status": "ambiguous", "method": method, "confidence": "low", "feature": f,
                        "reason": f"Lot {lot} is at {s['address']}, but the application says {address}",
                        "candidates": 1}
            # Cross-check: lot found by address should carry the expected lot number
            if method == "street address" and lot and _lot_no(props(f).get("lot_number")) not in (None, lot):
                return {"status": "ambiguous", "method": method, "confidence": "low", "feature": f,
                        "reason": f"Address matches Lot {props(f).get('lot_number')}, but the application says Lot {lot}",
                        "candidates": 1}
            return {"status": "matched", "method": method, "confidence": conf, "feature": f, "candidates": 1}
        if len(hits) > 1:
            return {"status": "ambiguous", "method": method, "confidence": "low", "feature": None,
                    "reason": f"{len(hits)} lots match by {method}", "candidates": len(hits)}
    return {"status": "not_found", "method": None, "confidence": None, "feature": None,
            "reason": "No lot matches the lot number or street address", "candidates": 0}


def feature_summary(f: dict) -> dict:
    p = f.get("properties") or {}
    addr = " ".join(str(x) for x in [p.get("road_number_1"), (p.get("road_name") or "").title(),
                                     (p.get("road_type") or "").title(), (p.get("locality") or "").title()] if x)
    return {"land_id": p.get("land_id"), "lot_number": p.get("lot_number"), "address": addr}


# ─────────────────────────────────────────────────────────────────────────────
# 2. Plan vs cadastre
# ─────────────────────────────────────────────────────────────────────────────


def lot_metrics(lot_latlng) -> dict:
    ring = normalise_latlng_ring(lot_latlng)
    if len(ring) < 3:
        return {}
    lat0 = sum(p[0] for p in ring) / len(ring); lng0 = sum(p[1] for p in ring) / len(ring)
    fr = LocalFrame(lat0, lng0)
    xy = [fr.to_xy(*p) for p in ring]
    cs = corners(xy)
    edges = [math.dist(cs[i], cs[(i + 1) % len(cs)]) for i in range(len(cs))]
    short, long_ = min_area_rect(cs)
    return {"area": polygon_area(xy), "edges": edges, "corners": len(cs), "width": short, "length": long_,
            "frame": fr, "xy_corners": cs}


def plan_cadastre_check(extraction: dict | None, lot_latlng, vector_area: float | None = None) -> dict:
    """Compare frontage / depth / area on the plan with the cadastre lot."""
    m = lot_metrics(lot_latlng)
    ex = (extraction or {}).get("extraction", extraction or {})
    sm = ex.get("siteplan_measurements") or {}
    frontage, depth = sm.get("lot_frontage_m"), sm.get("lot_depth_m")
    if not m:
        return {"status": "unknown", "summary": "No cadastre lot for this application", "checks": []}
    if frontage is None and depth is None and vector_area is None:
        return {"status": "unknown", "summary": "The site plan hasn't been read yet", "checks": [],
                "cadastre": {"area_m2": round(m["area"], 1), "edges_m": [round(e, 2) for e in m["edges"]]}}

    def near_edge(v):
        return min(m["edges"], key=lambda e: abs(e - v)) if m["edges"] else None

    def ok(v, ref, abs_tol=0.3, rel_tol=0.02):
        return abs(v - ref) <= max(abs_tol, rel_tol * ref)

    checks = []
    for label, v in (("Frontage", frontage), ("Depth", depth)):
        if v is None:
            continue
        e = near_edge(float(v))
        checks.append({"item": label, "plan": round(float(v), 2), "cadastre": round(e, 2),
                       "ok": ok(float(v), e), "unit": "m"})
    plan_area = vector_area
    if plan_area is None and frontage and depth:
        plan_area = float(frontage) * float(depth)
    if plan_area:
        checks.append({"item": "Area", "plan": round(plan_area, 1), "cadastre": round(m["area"], 1),
                       "ok": abs(plan_area - m["area"]) <= max(5.0, 0.03 * m["area"]), "unit": "m²"})
    bad = [c for c in checks if not c["ok"]]
    status = "match" if checks and not bad else ("mismatch" if bad else "unknown")
    summary = ("The plan matches the cadastre lot" if status == "match"
               else "The plan doesn't match the cadastre lot: " + ", ".join(
                   f"{c['item'].lower()} {c['plan']} vs {c['cadastre']} {c['unit']}" for c in bad)
               if status == "mismatch" else "Not enough dimensions to compare")
    return {"status": status, "summary": summary, "checks": checks,
            "cadastre": {"area_m2": round(m["area"], 1), "edges_m": [round(e, 2) for e in m["edges"]]}}


# ─────────────────────────────────────────────────────────────────────────────
# 3. Automatic georeferencing
# ─────────────────────────────────────────────────────────────────────────────


def find_drawing_scale(text: str) -> int | None:
    m = re.search(r"\b1\s*:\s*(\d{2,4})\b", text or "")
    return int(m.group(1)) if m else None


def vector_polygons(pdf_bytes: bytes, page_index: int = 0) -> tuple[list[dict], dict]:
    """Closed shapes drawn in a vector PDF page, in PDF points (origin top-left, y down)."""
    import pymupdf  # PyMuPDF
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    page = doc[page_index]
    info = {"width_pt": page.rect.width, "height_pt": page.rect.height,
            "scale": find_drawing_scale(page.get_text())}
    shapes = []
    for d in page.get_drawings():
        lw = d.get("width") or 0
        items = d.get("items") or []
        # rectangles and quads
        for it in items:
            if it[0] == "re":
                r = it[1]
                shapes.append({"pts": [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)], "lw": lw})
            elif it[0] == "qu":
                q = it[1]
                shapes.append({"pts": [(q.ul.x, q.ul.y), (q.ur.x, q.ur.y), (q.lr.x, q.lr.y), (q.ll.x, q.ll.y)], "lw": lw})
        # polylines made of consecutive line segments
        segs = [it for it in items if it[0] == "l"]
        if len(segs) >= 3:
            pts = [(segs[0][1].x, segs[0][1].y)] + [(s[2].x, s[2].y) for s in segs]
            closed = d.get("closePath") or math.dist(pts[0], pts[-1]) < 1.0
            if closed:
                if math.dist(pts[0], pts[-1]) < 1.0:
                    pts = pts[:-1]
                shapes.append({"pts": pts, "lw": lw})
    doc.close()
    for s in shapes:
        s["area"] = polygon_area(s["pts"])
    return shapes, info


def _overlay_from_fit(fit, lot_ring_latlng, img_w, img_h, px_per_unit, method, extra) -> dict:
    """Build the georef_overlay record from a fit (plan units → local metres)."""
    lat0 = sum(p[0] for p in lot_ring_latlng) / len(lot_ring_latlng)
    lng0 = sum(p[1] for p in lot_ring_latlng) / len(lot_ring_latlng)
    fr = LocalFrame(lat0, lng0)
    f = fit["f"]

    # plan units are (x, -y) so that the plan is right-handed like east/north
    def img_to_ll(px, py):
        x, y = f(px / px_per_unit, -py / px_per_unit)
        return fr.to_ll(x, y)

    plan_pts = [{"x": round(p[0] * px_per_unit, 2), "y": round(-p[1] * px_per_unit, 2)} for p in fit["src"]]
    map_pts = [dict(zip(("lat", "lng"), fr.to_ll(*q))) for q in fit["dst"]]
    cornersll = [img_to_ll(0, 0), img_to_ll(img_w, 0), img_to_ll(0, img_h), img_to_ll(img_w, img_h)]
    lats = [c[0] for c in cornersll]; lngs = [c[1] for c in cornersll]
    return {
        "planPts": plan_pts, "mapPts": map_pts,
        "bounds": [[min(lats), min(lngs)], [max(lats), max(lngs)]],
        "imgW": img_w, "imgH": img_h, "page": 1,
        "autoMatched": True, "method": method,
        "fit_rms_m": round(fit["rms"], 3), "fit_max_m": round(fit["max"], 3),
        "rotation_deg": round(fit["rotation_deg"], 2),
        **extra,
    }


def georef_from_vector(pdf_bytes: bytes, lot_latlng) -> dict | None:
    m = lot_metrics(lot_latlng)
    if not m:
        return None
    shapes, info = vector_polygons(pdf_bytes)
    if not shapes:
        return None
    exp_scale = info["scale"] * PT_TO_M_AT_1 if info["scale"] else None
    lot_xy = m["xy_corners"]
    best = None
    # Largest, heaviest shapes first; ignore tiny details and the page border
    page_area = info["width_pt"] * info["height_pt"]
    cands = sorted((s for s in shapes if 2_000 < s["area"] < 0.9 * page_area),
                   key=lambda s: (-(s["lw"] or 0), -s["area"]))[:40]
    for s in cands:
        cs = corners([(x, -y) for x, y in s["pts"]])
        if not 3 <= len(cs) <= 12:
            continue
        fit = best_polygon_fit(cs, lot_xy, exp_scale)
        if not fit:
            continue
        # plausible drawing scale: 1:50 … 1:2000
        if not (50 * PT_TO_M_AT_1 <= fit["scale"] <= 2000 * PT_TO_M_AT_1):
            continue
        if best is None or fit["score"] < best["score"]:
            best = {**fit, "shape_area_m2": s["area"] * fit["scale"] ** 2}
    if not best:
        return None
    px_per_pt = PDF_RENDER_DPI / 72
    img_w = round(info["width_pt"] * px_per_pt); img_h = round(info["height_pt"] * px_per_pt)
    implied = best["scale"] / PT_TO_M_AT_1
    extra = {"drawing_scale": f"1:{info['scale']}" if info["scale"] else None,
             "implied_scale": f"1:{implied:.0f}",
             "scale_error_pct": round((implied / info["scale"] - 1) * 100, 2) if info["scale"] else None,
             "plan_lot_area_m2": round(best["shape_area_m2"], 1)}
    return _overlay_from_fit(best, normalise_latlng_ring(lot_latlng), img_w, img_h, px_per_pt, "vector", extra)


CORNER_PROMPT = """This image is a residential site plan. Find the corners of the LOT BOUNDARY (the property
boundary line, usually the heaviest outline, not the house, fences or the crossover).
Return ONLY JSON: {"image_width": <int>, "image_height": <int>,
 "lot_corners_px": [[x, y], ...] in order around the boundary, pixel coordinates of THIS image,
 "drawing_scale": "1:200" or null, "north_arrow_bearing_deg": number or null}"""


def georef_from_image(png_bytes: bytes, lot_latlng, api_key: str, model: str,
                      drawing_scale: int | None = None, dpi: int = PDF_RENDER_DPI) -> dict | None:
    """Scanned/raster plans: ask Claude where the lot corners are, then fit them to the cadastre."""
    import base64, io
    import anthropic
    from PIL import Image
    from app.services.ai_analyser import response_text, model_or_current
    m = lot_metrics(lot_latlng)
    if not m:
        return None
    im = Image.open(io.BytesIO(png_bytes))
    w, h = im.size
    scale_f = min(1.0, 1568 / max(w, h))  # keep within the vision model's native resolution
    if scale_f < 1:
        im = im.resize((round(w * scale_f), round(h * scale_f)))
    buf = io.BytesIO(); im.convert("RGB").save(buf, format="PNG")
    client = anthropic.Anthropic(api_key=api_key)
    resp = client.messages.create(
        model=model_or_current(model), max_tokens=2000,
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/png",
                                         "data": base64.b64encode(buf.getvalue()).decode()}},
            {"type": "text", "text": CORNER_PROMPT + f"\nThe image is {im.size[0]} x {im.size[1]} pixels."}]}])
    txt = response_text(resp)
    data = json.loads(txt[txt.find("{"): txt.rfind("}") + 1])
    pts = [(float(x) / scale_f, float(y) / scale_f) for x, y in data.get("lot_corners_px") or []]
    if len(pts) < 3:
        return None
    if not drawing_scale and data.get("drawing_scale"):
        drawing_scale = find_drawing_scale(data["drawing_scale"])
    exp = drawing_scale * 0.0254 / dpi if drawing_scale else None  # metres per pixel
    fit = best_polygon_fit(corners([(x, -y) for x, y in pts]), m["xy_corners"], exp)
    if not fit:
        return None
    implied = fit["scale"] * dpi / 0.0254
    extra = {"drawing_scale": f"1:{drawing_scale}" if drawing_scale else None,
             "implied_scale": f"1:{implied:.0f}",
             "scale_error_pct": round((implied / drawing_scale - 1) * 100, 2) if drawing_scale else None,
             "north_arrow_bearing_deg": data.get("north_arrow_bearing_deg")}
    return _overlay_from_fit(fit, normalise_latlng_ring(lot_latlng), w, h, 1.0, "ai-corners", extra)


def alignment_quality(overlay: dict | None) -> dict:
    if not overlay or not overlay.get("mapPts"):
        return {"status": "none", "summary": "The plan isn't aligned to the map yet"}
    rms = overlay.get("fit_rms_m")
    se = overlay.get("scale_error_pct")
    warn = []
    if rms is not None and rms > 0.5:
        warn.append(f"corners fit within ±{rms:.2f} m (more than 0.5 m)")
    if se is not None and abs(se) > 3:
        warn.append(f"implied scale {overlay.get('implied_scale')} differs from the drawn {overlay.get('drawing_scale')} by {se:+.1f}%")
    method = {"vector": "automatically from the PDF drawing", "ai-corners": "automatically from corners found by AI",
              "manual": "by an officer"}.get(overlay.get("method") or ("manual" if not overlay.get("autoMatched") else ""),
                                              "from clicked corners")
    if rms is None:
        return {"status": "ok", "summary": f"Aligned {method}", "warnings": warn}
    return {"status": "warn" if warn else "ok",
            "summary": f"Aligned {method}, corners within ±{rms:.2f} m", "warnings": warn}
