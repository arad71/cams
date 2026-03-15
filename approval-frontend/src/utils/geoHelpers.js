import { geoDistMetres } from './geo';
import { SPEED_ROADS_DATA, SIGHT_DISTANCE_TABLE } from '../data/constants';

// ─── Lot GeoJSON lookup helpers ─────────────────────────
// Match a lot feature from the GeoJSON by comparing app.property.address
// against the feature's properties (p.n = lot number, p.rd = road, uppercase).
export function findLotFeatureByAddress(lotsData, address) {
  if (!lotsData?.features || !address) return null;
  const addrUpper = address.toUpperCase();
  for (const f of lotsData.features) {
    const p = f.properties || {};
    if (p.rd && p.n && addrUpper.includes(p.rd) && address.includes(p.n)) {
      return f;
    }
  }
  return null;
}

// Return the outer ring of a GeoJSON Polygon or MultiPolygon
export function getFirstRing(feature) {
  const g = feature?.geometry;
  if (!g) return null;
  if (g.type === "Polygon") return g.coordinates?.[0] ?? null;
  if (g.type === "MultiPolygon") return g.coordinates?.[0]?.[0] ?? null;
  return null;
}

// Extract { lat, lng, lotPoly } from a matched GeoJSON feature
export function getLotCoordsFromFeature(feature) {
  if (!feature) return null;
  const ring = getFirstRing(feature);
  if (!ring || ring.length < 3) return null;
  // ring is [lng, lat] — convert to [lat, lng]
  const poly = ring.map(([lng, lat]) => [lat, lng]);
  // Compute centroid
  const lats = poly.map(p => p[0]), lngs = poly.map(p => p[1]);
  const lat = lats.reduce((a, b) => a + b, 0) / lats.length;
  const lng = lngs.reduce((a, b) => a + b, 0) / lngs.length;
  return { lat, lng, lotPoly: poly };
}

// Find nearby road intersections dynamically from SPEED_ROADS_DATA.
// An "intersection" is where two different named roads share an endpoint
// within a tolerance. Returns intersections sorted by distance from (lat, lng).
export function findNearbyIntersections(lat, lng, maxResults = 3, maxDistM = 500) {
  if (!SPEED_ROADS_DATA?.features) return [];
  // Collect all endpoints with their road name
  const endpoints = [];
  for (const f of SPEED_ROADS_DATA.features) {
    const coords = f.geometry.coordinates;
    if (!coords || coords.length < 2) continue;
    const rd = f.properties.rd;
    endpoints.push({ lng: coords[0][0], lat: coords[0][1], rd });
    endpoints.push({ lng: coords[coords.length - 1][0], lat: coords[coords.length - 1][1], rd });
  }
  // Group endpoints by approximate location (snap to ~5m grid)
  const snap = (v) => Math.round(v * 20000) / 20000; // ~5m precision
  const grid = {};
  for (const ep of endpoints) {
    const key = `${snap(ep.lat)},${snap(ep.lng)}`;
    if (!grid[key]) grid[key] = { lat: ep.lat, lng: ep.lng, roads: new Set() };
    grid[key].roads.add(ep.rd);
  }
  // Filter to points where 2+ distinct roads meet
  const intersections = [];
  for (const g of Object.values(grid)) {
    if (g.roads.size < 2) continue;
    const distM = geoDistMetres(lat, lng, g.lat, g.lng);
    if (distM > maxDistM) continue;
    const roadNames = [...g.roads];
    intersections.push({ lat: g.lat, lng: g.lng, name: roadNames.join(' / '), dist: distM });
  }
  intersections.sort((a, b) => a.dist - b.dist);
  return intersections.slice(0, maxResults);
}

// Normalize lot polygon to [[lat,lng], ...]. Accepts [[lat,lng], ...] or [[lng,lat], ...].
export function normalizeLotPolygon(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return null;
  const p0 = poly[0];
  if (!Array.isArray(p0) || p0.length < 2) return null;
  // If first looks like longitude (e.g., 115) and second like latitude (e.g., -31), flip:
  const looksLngLat = Math.abs(p0[0]) > 90 && Math.abs(p0[1]) < 90;
  return looksLngLat ? poly.map(([lng, lat]) => [lat, lng]) : poly;
}

// Build a PROPERTY_COORDS-equivalent object for an app from lotsData
export function getAppCoords(lotsData, app) {
  if (!app) return null;
  // 1) Try lot_polygon from API
  const apiPoly = normalizeLotPolygon(app.lot_polygon);
  if (apiPoly && apiPoly.length >= 3) {
    const lats = apiPoly.map(p => p[0]), lngs = apiPoly.map(p => p[1]);
    const lat = lats.reduce((a, b) => a + b, 0) / lats.length;
    const lng = lngs.reduce((a, b) => a + b, 0) / lngs.length;
    const intersections = findNearbyIntersections(lat, lng);
    return { lat, lng, lotPoly: apiPoly, intersections };
  }
  // 2) Try matching from lotsData via address
  const feature = findLotFeatureByAddress(lotsData, app.property?.address);
  const derived = getLotCoordsFromFeature(feature);
  if (derived) {
    derived.intersections = findNearbyIntersections(derived.lat, derived.lng);
    return derived;
  }
  return null;
}

// Find nearest road speed to a lat/lng point
export function findNearestRoadSpeed(lat, lng) {
  if (!SPEED_ROADS_DATA?.features) return { speed: 50, roadName: 'Unknown', dist: 999 };
  let best = { speed: 50, roadName: 'Unknown', dist: Infinity };
  for (const f of SPEED_ROADS_DATA.features) {
    const coords = f.geometry.coordinates;
    for (let i = 0; i < coords.length - 1; i++) {
      // nearest point on segment
      const ax = coords[i][0], ay = coords[i][1], bx = coords[i+1][0], by = coords[i+1][1];
      const dx = bx-ax, dy = by-ay, lenSq = dx*dx+dy*dy;
      let t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((lng-ax)*dx+(lat-ay)*dy)/lenSq));
      const px = ax+t*dx, py = ay+t*dy;
      const d = Math.sqrt((lng-px)**2+(lat-py)**2);
      if (d < best.dist) {
        best = { speed: f.properties.sp, roadName: f.properties.rd, networkType: f.properties.nt, dist: d };
      }
    }
  }
  // Convert degree distance to approx metres
  best.distM = best.dist * 111320;
  return best;
}

export function getSightDistances(speedKmh) {
  // Find matching or next higher speed bracket
  let entry = SIGHT_DISTANCE_TABLE.find(e => e.speed >= speedKmh) || SIGHT_DISTANCE_TABLE[SIGHT_DISTANCE_TABLE.length - 1];
  // If speed is lower than 40, use 40 bracket
  if (speedKmh < 40) entry = SIGHT_DISTANCE_TABLE[0];
  // abs_min/10 = one side, ssd_min/10 = other side
  return {
    leftM: entry.abs_min ,
    rightM: entry.ssd_min,
    absMin: entry.abs_min,
    ssdMin: entry.ssd_min,
    speed: entry.speed,
  };
}
