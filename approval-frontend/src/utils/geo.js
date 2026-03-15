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