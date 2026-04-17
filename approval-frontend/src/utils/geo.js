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
  if (n < 3 || n !== mapPts.length) return null;

  // Convert lat/lng to local metres around centroid
  const mapCLat = mapPts.reduce((s, p) => s + p.lat, 0) / n;
  const mapCLng = mapPts.reduce((s, p) => s + p.lng, 0) / n;
  const M_PER_DEG_LAT = 111320;
  const M_PER_DEG_LNG = 111320 * Math.cos(mapCLat * Math.PI / 180);

  // Map to metres: x=east (lng), y=south (lat goes down like pixels)
  const mapM = mapPts.map(p => ({
    x: (p.lng - mapCLng) * M_PER_DEG_LNG,
    y: -(p.lat - mapCLat) * M_PER_DEG_LAT,
  }));
  const mapMCx = mapM.reduce((s, p) => s + p.x, 0) / n;
  const mapMCy = mapM.reduce((s, p) => s + p.y, 0) / n;

  const planCx = planPts.reduce((s, p) => s + p.x, 0) / n;
  const planCy = planPts.reduce((s, p) => s + p.y, 0) / n;

  // Center both sets
  const cp = planPts.map(p => ({ x: p.x - planCx, y: p.y - planCy }));
  const cm = mapM.map(p => ({ x: p.x - mapMCx, y: p.y - mapMCy }));

  // Procrustes: rotation via cross/dot
  let dot = 0, cross = 0;
  for (let i = 0; i < n; i++) {
    dot += cp[i].x * cm[i].x + cp[i].y * cm[i].y;
    cross += cp[i].x * cm[i].y - cp[i].y * cm[i].x;
  }
  const rotation = Math.atan2(cross, dot);

  // Scale: pixels → metres
  const planRms = Math.sqrt(cp.reduce((s, p) => s + p.x * p.x + p.y * p.y, 0) / n);
  const mapRms = Math.sqrt(cm.reduce((s, p) => s + p.x * p.x + p.y * p.y, 0) / n);
  const scale = planRms > 0 ? mapRms / planRms : 1;

  const cosR = Math.cos(rotation), sinR = Math.sin(rotation);

  // Compute residual in metres
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const rx = (cp[i].x * cosR - cp[i].y * sinR) * scale;
    const ry = (cp[i].x * sinR + cp[i].y * cosR) * scale;
    const dx = rx + mapMCx - mapM[i].x;
    const dy = ry + mapMCy - mapM[i].y;
    sse += dx * dx + dy * dy;
  }

  // Transform: plan pixel → lat/lng
  const transform = (px, py) => {
    const cx = px - planCx;
    const cy = py - planCy;
    const mx = (cx * cosR - cy * sinR) * scale + mapMCx;
    const my = (cx * sinR + cy * cosR) * scale + mapMCy;
    return {
      lat: -(my / M_PER_DEG_LAT) + mapCLat,  // invert y back to lat
      lng: mx / M_PER_DEG_LNG + mapCLng,
    };
  };

  return {
    scale, rotation, planCx, planCy,
    mapCx: mapCLat, mapCy: mapCLng,
    rotationDeg: rotation * 180 / Math.PI,
    residual: sse,
    transform,
  };
}


/**
 * Compute a least-squares affine transform from plan pixels to lat/lng.
 * Model: lat = a*x + b*y + e,  lng = c*x + d*y + f
 */
function affineTransform(planPts, mapPts) {
  const n = planPts.length;
  if (n < 3 || n !== mapPts.length) return null;

  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  let sxLat = 0, syLat = 0, sLat = 0;
  let sxLng = 0, syLng = 0, sLng = 0;

  for (let i = 0; i < n; i++) {
    const x = planPts[i].x, y = planPts[i].y;
    const lat = mapPts[i].lat, lng = mapPts[i].lng;
    sx += x; sy += y;
    sxx += x * x; syy += y * y; sxy += x * y;
    sxLat += x * lat; syLat += y * lat; sLat += lat;
    sxLng += x * lng; syLng += y * lng; sLng += lng;
  }

  const det = sxx * (syy * n - sy * sy) - sxy * (sxy * n - sy * sx) + sx * (sxy * sy - syy * sx);
  if (Math.abs(det) < 1e-30) return null;

  const solve = (r1, r2, r3) => {
    const a = (r1 * (syy * n - sy * sy) - sxy * (r2 * n - sy * r3) + sx * (r2 * sy - syy * r3)) / det;
    const b = (sxx * (r2 * n - sy * r3) - r1 * (sxy * n - sy * sx) + sx * (sxy * r3 - r2 * sx)) / det;
    const e = (sxx * (syy * r3 - r2 * sy) - sxy * (sxy * r3 - r2 * sx) + r1 * (sxy * sy - syy * sx)) / det;
    return [a, b, e];
  };

  const [a, b, e] = solve(sxLat, syLat, sLat);
  const [c, d, f] = solve(sxLng, syLng, sLng);

  const transform = (px, py) => ({
    lat: a * px + b * py + e,
    lng: c * px + d * py + f,
  });

  return { transform, a, b, c, d, e, f };
}


/**
 * Compute the angle of each point relative to the centroid of the set.
 * Returns angles in radians, sorted order gives the winding.
 */
function angularOrder(pts, cx, cy) {
  return pts.map((p, i) => ({
    index: i,
    angle: Math.atan2(p.y - cy, p.x - cx),
  })).sort((a, b) => a.angle - b.angle);
}


/**
 * Find the best point pairing between plan clicks and map corners,
 * then compute an affine transform for the final pixel→lat/lng mapping.
 *
 * The user can click corners in ANY order. This function:
 *   1. Sorts both plan points and map corners by angle from their
 *      respective centroids (angular ordering)
 *   2. Tries K rotational offsets to find the best cyclic match
 *   3. Computes a least-squares affine transform from the best pairing
 *
 * Angular ordering handles any click order because corners of a convex
 * polygon always sort into the same cyclic sequence regardless of which
 * corner was clicked first or which direction.
 *
 * @param {Array<{x,y}>} planPts - pixel coords clicked on plan
 * @param {Array<{lat,lng}>} mapCornersOrdered - cadastre corners in polygon order
 * @returns {{ alignment, mapPts, residual, offset }} or null
 */
export function bestProcrustesAlign(planPts, mapCornersOrdered) {
  const n = planPts.length;
  if (n < 3 || mapCornersOrdered.length < n) return null;

  const mc = mapCornersOrdered.slice(0, n);

  // Sort plan points by angle from centroid
  const planCx = planPts.reduce((s, p) => s + p.x, 0) / n;
  const planCy = planPts.reduce((s, p) => s + p.y, 0) / n;
  const planOrder = angularOrder(
    planPts.map(p => ({ x: p.x, y: p.y })),
    planCx, planCy
  );
  const sortedPlan = planOrder.map(o => planPts[o.index]);

  // Sort map corners by angle from centroid (in a flat x=lng, y=-lat space)
  const mapCLat = mc.reduce((s, p) => s + p.lat, 0) / n;
  const mapCLng = mc.reduce((s, p) => s + p.lng, 0) / n;
  const mapFlat = mc.map(p => ({ x: p.lng - mapCLng, y: -(p.lat - mapCLat) }));
  const mapCx = 0, mapCyF = 0;
  const mapOrder = angularOrder(mapFlat, mapCx, mapCyF);
  const sortedMap = mapOrder.map(o => mc[o.index]);

  // Try K rotational offsets on the sorted map corners
  let bestAffine = null;
  let bestResidual = Infinity;
  let bestMapPts = null;
  let bestOffset = 0;

  for (let offset = 0; offset < n; offset++) {
    const rotated = sortedMap.map((_, i) => sortedMap[(i + offset) % n]);
    const affine = affineTransform(sortedPlan, rotated);
    if (!affine) continue;

    // Compute residual
    let sse = 0;
    for (let i = 0; i < n; i++) {
      const t = affine.transform(sortedPlan[i].x, sortedPlan[i].y);
      const dlat = t.lat - rotated[i].lat;
      const dlng = t.lng - rotated[i].lng;
      sse += dlat * dlat + dlng * dlng;
    }

    if (sse < bestResidual) {
      bestResidual = sse;
      bestAffine = affine;
      bestMapPts = rotated;
      bestOffset = offset;
    }
  }

  if (!bestAffine) return null;

  return {
    alignment: bestAffine,
    mapPts: bestMapPts,
    residual: bestResidual,
    reversed: false,
    offset: bestOffset,
  };
}