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


// ───────────────────────────────────────────────────────────
// Utility clearance — crossover edge to utility distance
// ───────────────────────────────────────────────────────────

const M_PER_DEG_LAT = 111320;
const mPerDegLng = (lat) => 111320 * Math.cos(lat * Math.PI / 180);

/**
 * Distance in metres from a point to a line segment (all in lat/lng).
 */
function pointToSegmentDist(pLat, pLng, aLat, aLng, bLat, bLng) {
  const mLng = mPerDegLng((aLat + bLat) / 2);
  const dx = (bLng - aLng) * mLng, dy = (bLat - aLat) * M_PER_DEG_LAT;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-10) {
    const ex = (pLng - aLng) * mLng, ey = (pLat - aLat) * M_PER_DEG_LAT;
    return Math.sqrt(ex * ex + ey * ey);
  }
  const px = (pLng - aLng) * mLng, py = (pLat - aLat) * M_PER_DEG_LAT;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq));
  const nx = px - t * dx, ny = py - t * dy;
  return Math.sqrt(nx * nx + ny * ny);
}

/**
 * Minimum distance in metres from a point to a polygon edge (rectangle).
 * polyPts = [{lat,lng}, ...] — the crossover rectangle corners.
 */
function pointToPolygonEdgeDist(pLat, pLng, polyPts) {
  let minD = Infinity;
  for (let i = 0; i < polyPts.length; i++) {
    const a = polyPts[i], b = polyPts[(i + 1) % polyPts.length];
    const d = pointToSegmentDist(pLat, pLng, a.lat, a.lng, b.lat, b.lng);
    if (d < minD) minD = d;
  }
  return minD;
}

/**
 * Minimum distance in metres from a line segment to a polygon edge.
 * Checks both endpoints AND closest approach between all segment pairs.
 */
function segmentToPolygonEdgeDist(aLat, aLng, bLat, bLng, polyPts) {
  let minD = Infinity;
  // Check segment endpoints to polygon edges
  minD = Math.min(minD, pointToPolygonEdgeDist(aLat, aLng, polyPts));
  minD = Math.min(minD, pointToPolygonEdgeDist(bLat, bLng, polyPts));
  // Check polygon corners to the segment
  for (const p of polyPts) {
    const d = pointToSegmentDist(p.lat, p.lng, aLat, aLng, bLat, bLng);
    if (d < minD) minD = d;
  }
  return minD;
}

/**
 * Build the crossover rectangle in lat/lng from known data.
 *
 * @param {Array<[lat,lng]>} lotPoly — lot boundary polygon
 * @param {string} crossoverRoad — road name the crossover is on
 * @param {number} offsetFromBoundary — distance from constrained boundary to crossover edge (m)
 * @param {number} crossoverWidth — width of crossover (m)
 * @param {number} vergeDepth — depth from road edge into lot (m)
 * @param {string} constrainedSide — "left" or "right"
 * @param {Object} roadData — speed roads / road network GeoJSON
 * @returns {{corners: [{lat,lng},...], centre: {lat,lng}}} or null
 */
export function buildCrossoverRect(lotPoly, crossoverRoad, offsetFromBoundary, crossoverWidth, vergeDepth, constrainedSide, ...roadDataSources) {
  if (!lotPoly || lotPoly.length < 4 || !crossoverRoad || !crossoverWidth) return null;

  const mLat = M_PER_DEG_LAT;
  const mLng = mPerDegLng(lotPoly[0][0]);

  // Find the road-facing edge (same logic as sight analysis auto-draw)
  let bestEdge = null, bestDist = Infinity;
  for (let i = 0; i < lotPoly.length - 1; i++) {
    const midLat = (lotPoly[i][0] + lotPoly[i + 1][0]) / 2;
    const midLng = (lotPoly[i][1] + lotPoly[i + 1][1]) / 2;
    const edgeLen = Math.sqrt(((lotPoly[i][0] - lotPoly[i + 1][0]) * mLat) ** 2 + ((lotPoly[i][1] - lotPoly[i + 1][1]) * mLng) ** 2);
    if (edgeLen < 3) continue;
    for (const src of roadDataSources.filter(s => s?.features)) {
      for (const feat of src.features) {
        const rn = (feat.properties?.rd || feat.properties?.road_name || feat.properties?.ROAD_NAME || "").toUpperCase();
        const crUpper = crossoverRoad.toUpperCase();
        if (!rn || !(crUpper.includes(rn.split(" ")[0]) || rn.includes(crUpper.split(" ")[0]))) continue;
        const g = feat.geometry;
        if (!g || g.type !== "LineString") continue;
        for (const pt of g.coordinates) {
          const d = Math.sqrt(((midLat - pt[1]) * mLat) ** 2 + ((midLng - pt[0]) * mLng) ** 2);
          if (d < bestDist) { bestDist = d; bestEdge = { i, from: lotPoly[i], to: lotPoly[i + 1], edgeLen }; }
        }
      }
    }
  }

  if (!bestEdge || bestDist >= 25) return null;

  // Edge direction and normals
  const edgeDx = (bestEdge.to[1] - bestEdge.from[1]) * mLng;
  const edgeDy = (bestEdge.to[0] - bestEdge.from[0]) * mLat;
  const edgeAngle = Math.atan2(edgeDx, edgeDy);
  const lotCLat = lotPoly.reduce((s, p) => s + p[0], 0) / lotPoly.length;
  const lotCLng = lotPoly.reduce((s, p) => s + p[1], 0) / lotPoly.length;
  const n1 = edgeAngle + Math.PI / 2, n2 = edgeAngle - Math.PI / 2;
  const t1Lat = bestEdge.from[0] + Math.cos(n1) * 5 / mLat;
  const t1Lng = bestEdge.from[1] + Math.sin(n1) * 5 / mLng;
  const d1 = Math.sqrt(((t1Lat - lotCLat) * mLat) ** 2 + ((t1Lng - lotCLng) * mLng) ** 2);
  const inward = d1 < Math.sqrt(((bestEdge.from[0] + Math.cos(n2) * 5 / mLat - lotCLat) * mLat) ** 2 + ((bestEdge.from[1] + Math.sin(n2) * 5 / mLng - lotCLng) * mLng) ** 2) ? n1 : n2;
  const outward = inward === n1 ? n2 : n1;

  // Position along edge: offset from constrained boundary
  const yOffset = (offsetFromBoundary || 0) + 0.5 * crossoverWidth;
  const edgeFrac = Math.min(0.9, Math.max(0.1, yOffset / bestEdge.edgeLen));

  // Edge unit vector
  const eUnitLat = (bestEdge.to[0] - bestEdge.from[0]) / bestEdge.edgeLen * mLat;
  const eUnitLng = (bestEdge.to[1] - bestEdge.from[1]) / bestEdge.edgeLen * mLng;

  // Crossover centre on the road edge
  const cLat = bestEdge.from[0] + (bestEdge.to[0] - bestEdge.from[0]) * edgeFrac;
  const cLng = bestEdge.from[1] + (bestEdge.to[1] - bestEdge.from[1]) * edgeFrac;

  // Half-width along edge direction
  const hw = crossoverWidth / 2;
  // Depth perpendicular (into lot = inward, or out to road = outward)
  const depth = vergeDepth || 4.0;

  // 4 corners: road-left, road-right, lot-right, lot-left
  const corners = [
    { lat: cLat - eUnitLat * hw / mLat + Math.cos(outward) * 0.1 / mLat, lng: cLng - eUnitLng * hw / mLng + Math.sin(outward) * 0.1 / mLng },
    { lat: cLat + eUnitLat * hw / mLat + Math.cos(outward) * 0.1 / mLat, lng: cLng + eUnitLng * hw / mLng + Math.sin(outward) * 0.1 / mLng },
    { lat: cLat + eUnitLat * hw / mLat + Math.cos(inward) * depth / mLat, lng: cLng + eUnitLng * hw / mLng + Math.sin(inward) * depth / mLng },
    { lat: cLat - eUnitLat * hw / mLat + Math.cos(inward) * depth / mLat, lng: cLng - eUnitLng * hw / mLng + Math.sin(inward) * depth / mLng },
  ];

  return { corners, centre: { lat: cLat, lng: cLng } };
}


/**
 * Check all utility features near a crossover and compute clearance distances.
 *
 * @param {Array<{lat,lng}>} crossoverCorners — 4 corners of the crossover rectangle
 * @param {Object} utilityData — GeoJSON FeatureCollection
 * @param {string} utilityType — "power_buried"|"power_overhead"|"gas"|"water"|"drainage"
 * @param {number} searchRadius — max distance to check (metres)
 * @returns {Array<{type, distance, feature, conflict, warning}>}
 */
export function checkUtilityClearance(crossoverCorners, utilityData, utilityType, searchRadius = 50) {
  if (!crossoverCorners || crossoverCorners.length < 3 || !utilityData?.features) return [];

  const MIN_CLEARANCES = {
    gas: 0.6,           // 600mm
    power_buried: 0.6,  // 600mm
    power_overhead: 1.0,// 1m (lateral from pole base)
    water: 0.5,         // 500mm
    drainage: 0.5,      // 500mm
    telco: 0.3,         // 300mm
  };

  const minClear = MIN_CLEARANCES[utilityType] || 0.5;
  const results = [];

  for (const feature of utilityData.features) {
    const geom = feature.geometry;
    if (!geom) continue;

    let minDist = Infinity;

    if (geom.type === "Point") {
      const [lng, lat] = geom.coordinates;
      minDist = pointToPolygonEdgeDist(lat, lng, crossoverCorners);
    } else if (geom.type === "LineString") {
      for (let i = 0; i < geom.coordinates.length - 1; i++) {
        const [aLng, aLat] = geom.coordinates[i];
        const [bLng, bLat] = geom.coordinates[i + 1];
        const d = segmentToPolygonEdgeDist(aLat, aLng, bLat, bLng, crossoverCorners);
        if (d < minDist) minDist = d;
      }
    } else if (geom.type === "MultiLineString") {
      for (const line of geom.coordinates) {
        for (let i = 0; i < line.length - 1; i++) {
          const [aLng, aLat] = line[i];
          const [bLng, bLat] = line[i + 1];
          const d = segmentToPolygonEdgeDist(aLat, aLng, bLat, bLng, crossoverCorners);
          if (d < minDist) minDist = d;
        }
      }
    }

    if (minDist <= searchRadius) {
      results.push({
        type: utilityType,
        distance: Math.round(minDist * 10) / 10,
        feature: feature.properties || {},
        conflict: minDist < minClear,
        warning: minDist < minClear * 2 && minDist >= minClear,
        minClearance: minClear,
      });
    }
  }

  // Sort by distance ascending
  results.sort((a, b) => a.distance - b.distance);
  return results;
}


// ───────────────────────────────────────────────────────────
// Find nearest road(s) to lot boundary from map data
// ───────────────────────────────────────────────────────────

/**
 * For each lot edge, find the nearest road feature and its distance.
 * Returns the roads adjacent to the lot, sorted by distance.
 *
 * @param {Array<[lat,lng]>} lotPoly — lot boundary polygon
 * @param {...Object} roadDataSources — GeoJSON FeatureCollections (speedRoads, roadNetwork)
 * @returns {Array<{road_name, distance, edgeIndex, edgeMidLat, edgeMidLng}>}
 */
export function findNearestRoadsToLot(lotPoly, ...roadDataSources) {
  if (!lotPoly || lotPoly.length < 4) return [];

  const mLat = M_PER_DEG_LAT;
  const mLng = mPerDegLng(lotPoly[0][0]);

  // For each lot edge, find the nearest road
  const edgeRoads = [];
  for (let i = 0; i < lotPoly.length - 1; i++) {
    const midLat = (lotPoly[i][0] + lotPoly[i + 1][0]) / 2;
    const midLng = (lotPoly[i][1] + lotPoly[i + 1][1]) / 2;
    const edgeLen = Math.sqrt(((lotPoly[i][0] - lotPoly[i + 1][0]) * mLat) ** 2 + ((lotPoly[i][1] - lotPoly[i + 1][1]) * mLng) ** 2);
    if (edgeLen < 3) continue; // skip tiny edges

    let bestDist = Infinity;
    let bestName = null;
    let bestNetworkType = null;
    let bestSpeed = null;

    for (const src of roadDataSources.filter(s => s?.features)) {
      for (const feat of src.features) {
        const g = feat.geometry;
        if (!g || g.type !== "LineString") continue;
        const rn = feat.properties?.rd || feat.properties?.road_name || feat.properties?.ROAD_NAME || feat.properties?.full_name || '';
        if (!rn) continue;
        const nt = feat.properties?.nt || feat.properties?.NETWORK_TYPE || feat.properties?.network_type || '';
        const sp = feat.properties?.sp || feat.properties?.GAZETTED_SPEED_LIMIT || null;

        for (let j = 0; j < g.coordinates.length - 1; j++) {
          const [aLng, aLat] = g.coordinates[j];
          const [bLng, bLat] = g.coordinates[j + 1];
          const d = pointToSegmentDist(midLat, midLng, aLat, aLng, bLat, bLng);
          if (d < bestDist) {
            bestDist = d;
            bestName = rn;
            bestNetworkType = nt;
            bestSpeed = sp;
          }
        }
      }
    }

    if (bestName && bestDist < 20) {
      // Classify road type from MRWA network type
      const ntUpper = (bestNetworkType || '').toUpperCase();
      let roadClass = 'local'; // default
      if (ntUpper.includes('STATE') || ntUpper.includes('HIGHWAY') || ntUpper.includes('MAIN ROAD') || ntUpper.includes('PRIMARY')) {
        roadClass = 'red'; // MRWA controlled
      } else if (ntUpper.includes('DISTRIBUTOR') || ntUpper.includes('REGIONAL') || ntUpper.includes('SECONDARY')) {
        roadClass = 'blue'; // DPLH controlled
      }

      edgeRoads.push({
        road_name: bestName,
        distance: Math.round(bestDist * 10) / 10,
        edgeIndex: i,
        edgeMidLat: midLat,
        edgeMidLng: midLng,
        edgeLen: Math.round(edgeLen * 10) / 10,
        network_type: bestNetworkType,
        road_class: roadClass,
        speed: bestSpeed,
      });
    }
  }

  // Deduplicate by road name (keep the closest edge per road)
  const seen = {};
  const unique = [];
  for (const er of edgeRoads.sort((a, b) => a.distance - b.distance)) {
    const key = er.road_name.toUpperCase();
    if (!seen[key]) {
      seen[key] = true;
      unique.push(er);
    }
  }

  return unique;
}


// ───────────────────────────────────────────────────────────
// Map-derived assessment measurements
// ───────────────────────────────────────────────────────────

/**
 * Compute lot dimensions and distances from cadastre + road data.
 * Returns all measurable values that can be compared against AI extraction.
 *
 * @param {Array<[lat,lng]>} lotPoly — lot boundary polygon
 * @param {string} crossoverRoad — road name the crossover is on
 * @param {number} offsetFromBoundary — distance from constrained boundary (m)
 * @param {number} crossoverWidth — crossover width (m)
 * @param {string} constrainedSide — "left" or "right"
 * @param {...Object} roadDataSources — GeoJSON FeatureCollections
 * @returns {Object} with lot_frontage_m, lot_depth_m, verge_depth_m,
 *   distance_to_nearest_lot_corner_m, distance_to_intersection_m
 */
export function computeMapMeasurements(lotPoly, crossoverRoad, offsetFromBoundary, crossoverWidth, constrainedSide, ...roadDataSources) {
  const result = {
    lot_frontage_m: null,
    lot_depth_m: null,
    verge_depth_m: null,
    distance_to_nearest_lot_corner_m: null,
    distance_to_intersection_m: null,
  };

  if (!lotPoly || lotPoly.length < 4) return result;

  const mLat = M_PER_DEG_LAT;
  const mLng = mPerDegLng(lotPoly[0][0]);

  // Close polygon if not closed
  let poly = lotPoly;
  if (poly[0][0] !== poly[poly.length - 1][0] || poly[0][1] !== poly[poly.length - 1][1]) {
    poly = [...poly, poly[0]];
  }

  // Compute all edge lengths and find road-facing edges
  const edges = [];
  for (let i = 0; i < poly.length - 1; i++) {
    const len = Math.sqrt(((poly[i][0] - poly[i + 1][0]) * mLat) ** 2 + ((poly[i][1] - poly[i + 1][1]) * mLng) ** 2);
    const midLat = (poly[i][0] + poly[i + 1][0]) / 2;
    const midLng = (poly[i][1] + poly[i + 1][1]) / 2;
    const angle = Math.atan2((poly[i + 1][1] - poly[i][1]) * mLng, (poly[i + 1][0] - poly[i][0]) * mLat);
    edges.push({ i, len, midLat, midLng, angle, from: poly[i], to: poly[i + 1] });
  }

  // Find the road-facing edge (nearest to crossover road)
  let roadEdge = null, roadEdgeDist = Infinity;
  let roadSegments = []; // collect matching road segments for intersection detection

  for (const edge of edges) {
    if (edge.len < 3) continue;
    for (const src of roadDataSources.filter(s => s?.features)) {
      for (const feat of src.features) {
        const rn = (feat.properties?.rd || feat.properties?.road_name || feat.properties?.ROAD_NAME || feat.properties?.full_name || '').toUpperCase();
        const g = feat.geometry;
        if (!g || g.type !== 'LineString') continue;

        // Match road name if provided
        const isMatchingRoad = crossoverRoad && rn && (
          crossoverRoad.toUpperCase().includes(rn.split(' ')[0]) ||
          rn.includes(crossoverRoad.toUpperCase().split(' ')[0])
        );

        for (let j = 0; j < g.coordinates.length - 1; j++) {
          const [aLng, aLat] = g.coordinates[j];
          const [bLng, bLat] = g.coordinates[j + 1];
          const d = pointToSegmentDist(edge.midLat, edge.midLng, aLat, aLng, bLat, bLng);

          if (isMatchingRoad && d < roadEdgeDist) {
            roadEdgeDist = d;
            roadEdge = edge;
          }
        }

        // Collect road segments for intersection detection
        if (rn) {
          for (let j = 0; j < g.coordinates.length - 1; j++) {
            roadSegments.push({
              road_name: rn,
              aLat: g.coordinates[j][1], aLng: g.coordinates[j][0],
              bLat: g.coordinates[j + 1][1], bLng: g.coordinates[j + 1][0],
            });
          }
        }
      }
    }
  }

  // If no road name match, use the edge closest to any road
  if (!roadEdge) {
    for (const edge of edges) {
      if (edge.len < 3) continue;
      for (const seg of roadSegments) {
        const d = pointToSegmentDist(edge.midLat, edge.midLng, seg.aLat, seg.aLng, seg.bLat, seg.bLng);
        if (d < roadEdgeDist) { roadEdgeDist = d; roadEdge = edge; }
      }
    }
  }

  if (!roadEdge) return result;

  // ── 1. Lot frontage = length of road-facing edge ──
  result.lot_frontage_m = Math.round(roadEdge.len * 10) / 10;

  // ── 2. Lot depth = max perpendicular distance from road edge to any other vertex ──
  const edgeDx = (roadEdge.to[1] - roadEdge.from[1]) * mLng;
  const edgeDy = (roadEdge.to[0] - roadEdge.from[0]) * mLat;
  const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
  // Normal vector (perpendicular to edge, pointing inward)
  const nxRaw = -edgeDy / edgeLen;
  const nyRaw = edgeDx / edgeLen;
  // Check which direction is inward (towards lot centroid)
  const cLat = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cLng = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  const toC = ((cLat - roadEdge.midLat) * mLat) * (nxRaw * mLat) + ((cLng - roadEdge.midLng) * mLng) * (nyRaw * mLng);
  const sign = toC >= 0 ? 1 : -1;

  let maxDepth = 0;
  for (const p of poly) {
    // Project vertex onto the perpendicular direction
    const vx = (p[0] - roadEdge.midLat) * mLat;
    const vy = (p[1] - roadEdge.midLng) * mLng;
    const proj = (vx * nxRaw * mLat + vy * nyRaw * mLng) * sign;
    // But simpler: just use perpendicular distance from the edge line
    const d = pointToSegmentDist(p[0], p[1], roadEdge.from[0], roadEdge.from[1], roadEdge.to[0], roadEdge.to[1]);
    if (d > maxDepth) maxDepth = d;
  }
  result.lot_depth_m = Math.round(maxDepth * 10) / 10;

  // ── 3. Verge depth = distance from lot boundary (road edge) to road centreline ──
  result.verge_depth_m = Math.round(roadEdgeDist * 10) / 10;

  // ── 4. Distance to nearest lot corner from crossover centre ──
  // Crossover centre position on the road edge
  const yOffset = (offsetFromBoundary || 0) + 0.5 * (crossoverWidth || 3);
  const edgeFrac = Math.min(0.9, Math.max(0.1, yOffset / roadEdge.len));
  const crossCLat = roadEdge.from[0] + (roadEdge.to[0] - roadEdge.from[0]) * edgeFrac;
  const crossCLng = roadEdge.from[1] + (roadEdge.to[1] - roadEdge.from[1]) * edgeFrac;

  // Distance to each end of the road-facing edge (lot corners on the road side)
  const dCorner1 = Math.sqrt(((crossCLat - roadEdge.from[0]) * mLat) ** 2 + ((crossCLng - roadEdge.from[1]) * mLng) ** 2);
  const dCorner2 = Math.sqrt(((crossCLat - roadEdge.to[0]) * mLat) ** 2 + ((crossCLng - roadEdge.to[1]) * mLng) ** 2);
  result.distance_to_nearest_lot_corner_m = Math.round(Math.min(dCorner1, dCorner2) * 10) / 10;

  // ── 5. Distance to nearest intersection from crossover position ──
  // An intersection is where two different-named roads meet (vertex shared between roads)
  // Find road vertices near the crossover road, then check which ones are shared with another road
  const crossoverRoadUpper = (crossoverRoad || '').toUpperCase();
  let minIntersectionDist = Infinity;

  // Collect endpoints of crossover road segments near the lot
  const nearbyVertices = [];
  for (const seg of roadSegments) {
    if (!crossoverRoadUpper || !seg.road_name.includes(crossoverRoadUpper.split(' ')[0])) continue;
    const dA = Math.sqrt(((crossCLat - seg.aLat) * mLat) ** 2 + ((crossCLng - seg.aLng) * mLng) ** 2);
    const dB = Math.sqrt(((crossCLat - seg.bLat) * mLat) ** 2 + ((crossCLng - seg.bLng) * mLng) ** 2);
    if (dA < 200) nearbyVertices.push({ lat: seg.aLat, lng: seg.aLng, dist: dA });
    if (dB < 200) nearbyVertices.push({ lat: seg.bLat, lng: seg.bLng, dist: dB });
  }

  // For each vertex, check if another road also has a vertex nearby (<5m)
  for (const v of nearbyVertices) {
    for (const seg of roadSegments) {
      if (crossoverRoadUpper && seg.road_name.includes(crossoverRoadUpper.split(' ')[0])) continue; // skip same road
      const dA = Math.sqrt(((v.lat - seg.aLat) * mLat) ** 2 + ((v.lng - seg.aLng) * mLng) ** 2);
      const dB = Math.sqrt(((v.lat - seg.bLat) * mLat) ** 2 + ((v.lng - seg.bLng) * mLng) ** 2);
      if (dA < 5 || dB < 5) {
        // This vertex is an intersection point
        const distFromCross = Math.sqrt(((crossCLat - v.lat) * mLat) ** 2 + ((crossCLng - v.lng) * mLng) ** 2);
        if (distFromCross < minIntersectionDist) minIntersectionDist = distFromCross;
      }
    }
  }

  if (minIntersectionDist < Infinity) {
    result.distance_to_intersection_m = Math.round(minIntersectionDist * 10) / 10;
  }

  return result;
}