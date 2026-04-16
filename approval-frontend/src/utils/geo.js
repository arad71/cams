// ───────────────────────────────────────────────────────────
// Geo utilities
// ───────────────────────────────────────────────────────────

// Haversine distance between two lat/lng (metres)
export function geoDistMetres(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Offset a point by metres at a given bearing (degrees)
// Returns a new lat/lng
export function geoOffset(lat, lng, distM, bearingDeg) {
  const R = 6371000, toRad = d => d * Math.PI / 180, toDeg = r => r * 180 / Math.PI;
  const lat1 = toRad(lat), lng1 = toRad(lng), brng = toRad(bearingDeg);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distM / R)
    + Math.cos(lat1) * Math.sin(distM / R) * Math.cos(brng)
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(brng) * Math.sin(distM / R) * Math.cos(lat1),
    Math.cos(distM / R) - Math.sin(lat1) * Math.sin(lat2)
  );
  return { lat: toDeg(lat2), lng: toDeg(lng2) };
}

// Initial bearing from point 1 to point 2 (degrees 0–360)
export function geoBearing(lat1, lng1, lat2, lng2) {
  const toRad = d => d * Math.PI / 180, toDeg = r => r * 180 / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
          - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Nearest point on segment AB to P, all in lat/lng (approx; small areas)
export function nearestPointOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { lat: ax, lng: ay };
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { lat: ax + t * dx, lng: ay + t * dy };
}


// ───────────────────────────────────────────────────────────
// Cadastre corner extraction
// ───────────────────────────────────────────────────────────

/**
 * Compute interior angle (degrees) at vertex B in the path A→B→C.
 * Returns 0–180. Straight line ≈ 180°. Sharp corner < 90°.
 */
function interiorAngleDeg(ax, ay, bx, by, cx, cy) {
  const v1x = ax - bx, v1y = ay - by;
  const v2x = cx - bx, v2y = cy - by;
  const dot = v1x * v2x + v1y * v2y;
  const m1 = Math.sqrt(v1x * v1x + v1y * v1y);
  const m2 = Math.sqrt(v2x * v2x + v2y * v2y);
  if (m1 === 0 || m2 === 0) return 180;
  const cosA = Math.max(-1, Math.min(1, dot / (m1 * m2)));
  return Math.acos(cosA) * 180 / Math.PI;
}

/**
 * Extract the K sharpest corners from a cadastre polygon.
 *
 * Cadastre lot polygons often have extra mid-side vertices where
 * neighbouring lot boundaries T-junction into a side. A rectangular
 * lot might have 5, 6, or more vertices in the GeoJSON. This function
 * identifies the K vertices with the most angular significance
 * (sharpest interior angles) — the "real corners" — regardless of
 * how many extra mid-side points exist.
 *
 * The user's click count on the plan determines K, so no fixed
 * threshold is needed: mid-side vertices (near 180°) always rank
 * lower than any real corner, however shallow.
 *
 * @param {Array<{lat,lng}>} polygon - closed polygon vertices (last ≠ first)
 * @param {number} k - how many corners to pick (typically = user's plan click count)
 * @returns {Array<{lat,lng,angle,index}>} k vertices sorted in original polygon order
 */
export function extractCorners(polygon, k) {
  if (!polygon || polygon.length === 0) return [];
  const n = polygon.length;
  if (k >= n) return polygon.map((p, i) => ({ ...p, angle: 0, index: i }));

  // Compute interior angle at each vertex
  const scored = polygon.map((p, i) => {
    const prev = polygon[(i - 1 + n) % n];
    const next = polygon[(i + 1) % n];
    const angle = interiorAngleDeg(prev.lat, prev.lng, p.lat, p.lng, next.lat, next.lng);
    return { ...p, angle, index: i };
  });

  // Sort by angle ascending (sharpest first = most "corner-like")
  const byAngle = [...scored].sort((a, b) => a.angle - b.angle);

  // Take the K sharpest
  const selected = byAngle.slice(0, k);

  // Return in original polygon order (preserves winding)
  selected.sort((a, b) => a.index - b.index);
  return selected;
}


// ───────────────────────────────────────────────────────────
// Procrustes alignment (plan pixels → map lat/lng)
// ───────────────────────────────────────────────────────────

/**
 * Find the best rigid transform (translate + rotate + uniform scale)
 * mapping plan pixel points to map lat/lng points.
 *
 * Uses Procrustes analysis:
 * 1. Center both point sets at their centroids
 * 2. Compute optimal rotation via the 2D equivalent of SVD
 * 3. Recover scale as ratio of RMS distances from centroid
 * 4. Compute translation from centroid offset
 *
 * @param {Array<{x,y}>} planPts - pixel coords clicked on plan (K points)
 * @param {Array<{lat,lng}>} mapPts - matching lat/lng coords (K points, same order)
 * @returns {{ scale, rotation, tx, ty, mapCx, mapCy, planCx, planCy, transform(x,y) }}
 *
 * The returned transform() function converts any plan pixel coord to lat/lng.
 */
export function procrustesAlign(planPts, mapPts) {
  const n = planPts.length;
  if (n < 2 || n !== mapPts.length) return null;

  // 1. Centroids
  const planCx = planPts.reduce((s, p) => s + p.x, 0) / n;
  const planCy = planPts.reduce((s, p) => s + p.y, 0) / n;
  const mapCx = mapPts.reduce((s, p) => s + p.lat, 0) / n;
  const mapCy = mapPts.reduce((s, p) => s + p.lng, 0) / n;

  // 2. Center
  const cp = planPts.map(p => ({ x: p.x - planCx, y: p.y - planCy }));
  const cm = mapPts.map(p => ({ x: p.lat - mapCx, y: p.lng - mapCy }));

  // 3. Compute rotation using atan2 of cross/dot products
  let dot = 0, cross = 0;
  for (let i = 0; i < n; i++) {
    dot += cp[i].x * cm[i].x + cp[i].y * cm[i].y;
    cross += cp[i].x * cm[i].y - cp[i].y * cm[i].x;
  }
  const rotation = Math.atan2(cross, dot); // radians

  // 4. Scale: ratio of RMS distances from centroid
  const planRms = Math.sqrt(cp.reduce((s, p) => s + p.x * p.x + p.y * p.y, 0) / n);
  const mapRms = Math.sqrt(cm.reduce((s, p) => s + p.x * p.x + p.y * p.y, 0) / n);
  const scale = planRms > 0 ? mapRms / planRms : 1;

  // 5. Transform function: plan pixel → map lat/lng
  const cosR = Math.cos(rotation), sinR = Math.sin(rotation);
  const transform = (px, py) => {
    const cx = px - planCx;
    const cy = py - planCy;
    const rx = cx * cosR - cy * sinR;
    const ry = cx * sinR + cy * cosR;
    return {
      lat: rx * scale + mapCx,
      lng: ry * scale + mapCy,
    };
  };

  return {
    scale, rotation, planCx, planCy, mapCx, mapCy,
    rotationDeg: rotation * 180 / Math.PI,
    transform,
  };
}