import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { SIGHT_DISTANCE_TABLE } from '../../data/constants';
import { getAppCoords, getFirstRing, normalizeLotPolygon, findNearestRoadSpeed, getSightDistances } from '../../utils/geoHelpers';
import { geoDistMetres, geoOffset, geoBearing, nearestPointOnSegment } from '../../utils/geo';
import LeafletMap from './LeafletMap';
import { T, S, cx } from '../../styles/tokens';

// ─── Satellite Mini-Map with triangle + measurements ─────
function SatelliteMiniMap({ sightTriangle }) {
  const ref = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (!ref.current || !window.L || !sightTriangle?.ptA) return;
    const L = window.L;

    // Clean up previous
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

    const A = sightTriangle.ptA, B = sightTriangle.ptB;
    const C = sightTriangle.triLeft, D = sightTriangle.triRight;
    const poly = sightTriangle.lotPoly || [];
    const bds = sightTriangle.boundaryDists || [];

    // Compute bounds to fit the triangle + lot
    const allPts = [[A.lat, A.lng]];
    if (B) allPts.push([B.lat, B.lng]);
    if (C) allPts.push([C.lat, C.lng]);
    if (D) allPts.push([D.lat, D.lng]);
    poly.forEach(p => allPts.push(p));

    const map = L.map(ref.current, { zoomControl: false, attributionControl: false, dragging: true, scrollWheelZoom: true });
    mapRef.current = map;

    // Satellite tiles (Esri)
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 20 }).addTo(map);

    // Fit to bounds
    const bounds = L.latLngBounds(allPts);
    map.fitBounds(bounds.pad(0.3));

    // Lot boundary (cyan)
    if (poly.length > 2) {
      L.polygon(poly, { color: "#00ffff", weight: 2, fillColor: "#00ffff", fillOpacity: 0.08, dashArray: "6,4" }).addTo(map);
    }

    // Sight triangle (red fill)
    if (C && D) {
      L.polygon([[A.lat, A.lng], [C.lat, C.lng], [D.lat, D.lng]], { color: "#ff4444", weight: 2.5, fillColor: "#ff4444", fillOpacity: 0.2 }).addTo(map);
    }

    // A→B line (yellow)
    if (B) {
      L.polyline([[A.lat, A.lng], [B.lat, B.lng]], { color: "#ffff00", weight: 3, dashArray: "8,4" }).addTo(map);
      // Midpoint label
      const midAB = [(A.lat + B.lat) / 2, (A.lng + B.lng) / 2];
      L.marker(midAB, { icon: L.divIcon({ className: "", html: `<div style="background:rgba(0,0,0,0.8);color:#ffff00;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700;white-space:nowrap;font-family:sans-serif">${sightTriangle.analysis?.depth}m</div>`, iconAnchor: [20, 10] }) }).addTo(map);
    }

    // C→D line with label
    if (C && D) {
      L.polyline([[C.lat, C.lng], [D.lat, D.lng]], { color: "#4fc3f7", weight: 2, dashArray: "4,4" }).addTo(map);
      const midCD = [(C.lat + D.lat) / 2, (C.lng + D.lng) / 2];
      L.marker(midCD, { icon: L.divIcon({ className: "", html: `<div style="background:rgba(0,0,0,0.8);color:#4fc3f7;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700;white-space:nowrap;font-family:sans-serif">${sightTriangle.analysis?.baseWidth}m</div>`, iconAnchor: [25, 10] }) }).addTo(map);
    }

    // Boundary distance lines (top 3)
    const bdClrs = ["#ff6644", "#ff9900", "#44aaff"];
    bds.slice(0, 3).forEach((bd, i) => {
      L.polyline([[A.lat, A.lng], [bd.nearPt.lat, bd.nearPt.lng]], { color: bdClrs[i], weight: i === 0 ? 2.5 : 1.5, dashArray: "6,4", opacity: i === 0 ? 0.9 : 0.6 }).addTo(map);
      const mid = [(A.lat + bd.nearPt.lat) / 2, (A.lng + bd.nearPt.lng) / 2];
      L.marker(mid, { icon: L.divIcon({ className: "", html: `<div style="background:rgba(0,0,0,0.75);color:${bdClrs[i]};padding:1px 5px;border-radius:3px;font-size:${i===0?10:9}px;font-weight:700;white-space:nowrap;font-family:sans-serif">→${bd.distLabel}m</div>`, iconAnchor: [20, 8] }) }).addTo(map);
      // Dot at boundary point
      L.circleMarker([bd.nearPt.lat, bd.nearPt.lng], { radius: 3, color: bdClrs[i], fillColor: "#fff", fillOpacity: 1, weight: 2 }).addTo(map);
    });

    // Marker A
    L.marker([A.lat, A.lng], { icon: L.divIcon({ className: "", html: '<div style="width:22px;height:22px;border-radius:50%;background:#e74c3c;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#fff;font-family:sans-serif">A</div>', iconSize: [22, 22], iconAnchor: [11, 11] }) }).addTo(map);

    // Marker B
    if (B) {
      L.marker([B.lat, B.lng], { icon: L.divIcon({ className: "", html: '<div style="width:22px;height:22px;border-radius:50%;background:#2980b9;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#fff;font-family:sans-serif">B</div>', iconSize: [22, 22], iconAnchor: [11, 11] }) }).addTo(map);
    }

    // C and D markers
    if (C) L.circleMarker([C.lat, C.lng], { radius: 5, color: "#27ae60", fillColor: "#27ae60", fillOpacity: 1, weight: 2 }).bindTooltip("C", { permanent: true, direction: "bottom", className: "", offset: [0, 4] }).addTo(map);
    if (D) L.circleMarker([D.lat, D.lng], { radius: 5, color: "#27ae60", fillColor: "#27ae60", fillOpacity: 1, weight: 2 }).bindTooltip("D", { permanent: true, direction: "bottom", className: "", offset: [0, 4] }).addTo(map);

    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [sightTriangle?.ptA?.lat, sightTriangle?.ptA?.lng, sightTriangle?.ptB?.lat, sightTriangle?.ptB?.lng]);

  return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
}

// ═══════════════════════════════════════════════════════════
//  MAP VIEW WITH SIGHT TRIANGLE ANALYSIS
// ═══════════════════════════════════════════════════════════
function MapWithOverlay({ app, apps, onSelectApp, speedRoadsData = null, lotsData = null, roadNetworkData = null, contoursData = null, urbanForestData = null, drainagePipesData = null, drainagePitsData = null, waterPipesData = null }) {
  const [showLots, setShowLots] = useState(true);
  const [showSpeedRoads, setShowSpeedRoads] = useState(false);
  const [showStreetNames, setShowStreetNames] = useState(false);
  const [showBoundaries, setShowBoundaries] = useState(false);
  const [showContours, setShowContours] = useState(false);
  const [showUrbanForest, setShowUrbanForest] = useState(false);
  const [showDrainagePipes, setShowDrainagePipes] = useState(false);
  const [showDrainagePits, setShowDrainagePits] = useState(false);
  const [showWaterPipes, setShowWaterPipes] = useState(false);
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [waLayers, setWaLayers] = useState({ contour: false, cadastral: false, zoning: false, hazard: false });
  const [mapTool, setMapTool] = useState(null); // "measure" | "draw" | null
  const [measureDist, setMeasureDist] = useState(null);
  const [radiusResult, setRadiusResult] = useState(null);
  const [centrelineDist, setCentrelineDist] = useState(null);
  const [offsetState, setOffsetState] = useState({ step: 0, road: null, boundary: null, x: 2.5, y: 4.0, isCorner: false, cornerR: null, cornerV: null });

  // Unified Sight Analysis state machine
  // Phases: null → "corner_draw" → "offset_road" → "offset_boundary" → "complete"
  const [sightPhase, setSightPhase] = useState(null);
  const [sightConfig, setSightConfig] = useState({ x: 2.5, y: 4.0, isCorner: false, cornerR: null, cornerV: null, sightPt: null, turnStart: null, turnEnd: null });

  const [drawMode, setDrawMode] = useState(null);
  const [ptA, setPtA] = useState(null);
  const [ptB, setPtB] = useState(null);
  const [cornerSpeed, setCornerSpeed] = useState(null);
  const radiusDoneRef = useRef(null);
  const radiusClearRef = useRef(null);

  // Handle radius completion (from LeafletMap callback)
  const handleRadiusComplete = useCallback((R, V, sightPt, turnStart, turnEnd) => {
    if (sightPhase === "corner_draw") {
      setSightConfig(c => ({ ...c, cornerR: R, cornerV: V, sightPt, turnStart, turnEnd }));
      setCornerSpeed(V);
      setTimeout(() => {
        setSightPhase("offset_road");
        setOffsetState({ step: 0, road: null, boundary: null, x: sightConfig.x, y: sightConfig.y, isCorner: true, cornerR: R, cornerV: V });
        setMapTool("offset");
      }, 600);
    }
  }, [sightPhase, sightConfig.x, sightConfig.y]);
  const [sightTriangle, setSightTriangle] = useState(null);
  const coords = getAppCoords(lotsData, app, speedRoadsData);

  // 3D Sight Analysis state
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [analysisSteps, setAnalysisSteps] = useState([]);
  const [activeAnalysisTab, setActiveAnalysisTab] = useState('obstructions');
  const [eyeHeight, setEyeHeight] = useState(1.15);
  const [objectHeight, setObjectHeight] = useState(0.65);

  // ── 3D Sight Analysis Engine (from sight_line_3d-1.html) ──
  const R_3D = 6371000, toRad3D = d => d * Math.PI / 180;
  const havDist3D = (a, b) => { const dl = toRad3D(b.lat - a.lat), dn = toRad3D(b.lng - a.lng), x = Math.sin(dl / 2) ** 2 + Math.cos(toRad3D(a.lat)) * Math.cos(toRad3D(b.lat)) * Math.sin(dn / 2) ** 2; return R_3D * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); };
  const lerpPt3D = (a, b, t) => ({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
  const segX3D = (a, b, c, d) => { const det = (b.lng - a.lng) * (d.lat - c.lat) - (b.lat - a.lat) * (d.lng - c.lng); if (Math.abs(det) < 1e-14) return null; const t = ((c.lng - a.lng) * (d.lat - c.lat) - (c.lat - a.lat) * (d.lng - c.lng)) / det, u = ((c.lng - a.lng) * (b.lat - a.lat) - (c.lat - a.lat) * (b.lng - a.lng)) / det; if (t > 0.005 && t < 0.995 && u > 0.005 && u < 0.995) return true; return null; };

  const getElevAt3D = (pt, eg) => {
    let b1 = { d: Infinity, e: 0 }, b2 = { d: Infinity, e: 0 };
    for (let i = 0; i < eg.pts.length; i++) { const d = havDist3D(pt, eg.pts[i]); if (d < b1.d) { b2 = { ...b1 }; b1 = { d, e: eg.elevs[i] }; } else if (d < b2.d) b2 = { d, e: eg.elevs[i] }; }
    if (b1.d < 0.1) return b1.e; const tot = b1.d + b2.d; return b1.e * (1 - b1.d / tot) + b2.e * (1 - b2.d / tot);
  };

  const fetchOSM3D = async (ctr, r) => {
    r = Math.min(r, 500);
    const q = `[out:json][timeout:25];(way["building"](around:${r},${ctr.lat},${ctr.lng});way["barrier"="fence"](around:${r},${ctr.lat},${ctr.lng});way["barrier"="wall"](around:${r},${ctr.lat},${ctr.lng});way["barrier"="retaining_wall"](around:${r},${ctr.lat},${ctr.lng});way["barrier"="hedge"](around:${r},${ctr.lat},${ctr.lng});node["natural"="tree"](around:${r},${ctr.lat},${ctr.lng});way["natural"="tree_row"](around:${r},${ctr.lat},${ctr.lng});way["landuse"="forest"](around:${r},${ctr.lat},${ctr.lng});way["man_made"="embankment"](around:${r},${ctr.lat},${ctr.lng}););out body geom;`;
    const resp = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`); return resp.json();
  };

  const procOSM3D = (data) => {
    const ff = []; if (!data?.elements) return ff;
    for (const el of data.elements) {
      let tp = null, ht = 0, geom = []; const tg = el.tags || {};
      if (tg.building) { tp = 'building'; const l = parseInt(tg['building:levels']) || 0, h = parseFloat(tg.height); ht = !isNaN(h) ? h : l > 0 ? l * 3 : 6; if (el.geometry) geom = el.geometry.map(n => ({ lat: n.lat, lng: n.lon })); }
      else if (tg.barrier === 'fence') { tp = 'fence'; ht = parseFloat(tg.height) || 1.5; if (el.geometry) geom = el.geometry.map(n => ({ lat: n.lat, lng: n.lon })); }
      else if (tg.barrier === 'wall' || tg.barrier === 'retaining_wall') { tp = 'wall'; ht = parseFloat(tg.height) || 2; if (el.geometry) geom = el.geometry.map(n => ({ lat: n.lat, lng: n.lon })); }
      else if (tg.barrier === 'hedge') { tp = 'hedge'; ht = parseFloat(tg.height) || 1.2; if (el.geometry) geom = el.geometry.map(n => ({ lat: n.lat, lng: n.lon })); }
      else if (tg.natural === 'tree') { tp = 'tree'; ht = parseFloat(tg.height) || 8; if (el.lat && el.lon) geom = [{ lat: el.lat, lng: el.lon }]; }
      else if (tg.natural === 'tree_row') { tp = 'tree_row'; ht = 6; if (el.geometry) geom = el.geometry.map(n => ({ lat: n.lat, lng: n.lon })); }
      else if (tg.landuse === 'forest' || tg.natural === 'wood') { tp = 'vegetation'; ht = 10; if (el.geometry) geom = el.geometry.map(n => ({ lat: n.lat, lng: n.lon })); }
      else if (tg.man_made === 'embankment') { tp = 'embankment'; ht = 2; if (el.geometry) geom = el.geometry.map(n => ({ lat: n.lat, lng: n.lon })); }
      if (tp && geom.length > 0) ff.push({ id: el.id, type: tp, estimatedHeight: ht, geometry: geom, tags: tg, name: tg.name || tg['addr:street'] || `${tp} #${el.id}` });
    } return ff;
  };

  // ── Build elevation point cloud from local Contours_2m.geojson ──
  const buildContourPointCloud = (geojson, bbox) => {
    if (!geojson?.features?.length) return null;
    const pts = [];
    for (const feat of geojson.features) {
      const elev = feat.properties?.elevation_m;
      if (elev == null || elev === 0) continue;
      const geom = feat.geometry;
      if (!geom) continue;
      // GeoJSON LineString or MultiLineString
      const lines = geom.type === "MultiLineString" ? geom.coordinates : geom.type === "LineString" ? [geom.coordinates] : [];
      for (const line of lines) {
        for (const coord of line) {
          const lng = coord[0], lat = coord[1];
          // Only include points within or near the bbox (with small margin)
          if (lat >= bbox.minLat - 0.002 && lat <= bbox.maxLat + 0.002 &&
              lng >= bbox.minLng - 0.002 && lng <= bbox.maxLng + 0.002) {
            pts.push({ lat, lng, elev });
          }
        }
      }
    }
    return pts.length >= 3 ? pts : null;
  };

  const fetchElevFromLocalContours = (points, bbox) => {
    const contourPts = buildContourPointCloud(contoursData, bbox);
    if (!contourPts) return null;

    const elevations = points.map(pt => {
      const dists = contourPts.map((cp, i) => ({
        i, d: Math.sqrt((pt.lat - cp.lat) ** 2 + (pt.lng - cp.lng) ** 2), e: cp.elev,
      }));
      dists.sort((a, b) => a.d - b.d);
      const nearest = dists.slice(0, 6);
      if (nearest[0].d < 0.000005) return nearest[0].e;
      let sumW = 0, sumWE = 0;
      for (const n of nearest) { const w = 1 / (n.d * n.d + 1e-12); sumW += w; sumWE += w * n.e; }
      return sumWE / sumW;
    });

    return { elevation: elevations, source: "local_contour_2m", contourCount: contoursData.features.length, pointCloud: contourPts.length };
  };

  // ── Elevation data: local Contours_2m.geojson → SLIP API → Open-Meteo DEM ──
  const SLIP_CONTOUR_URL = "https://services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Terrain/MapServer/0/query";

  const fetchElevFromSLIP = async (points, bbox) => {
    // Query SLIP 2m contour lines within the sight triangle bounding box
    const geom = `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`;
    const params = new URLSearchParams({
      where: "1=1",
      geometry: geom,
      geometryType: "esriGeometryEnvelope",
      inSR: "7844",
      outSR: "7844",
      outFields: "elevation_m",
      returnGeometry: "true",
      f: "json",
      resultRecordCount: "500",
    });
    const resp = await fetch(`${SLIP_CONTOUR_URL}?${params}`);
    if (!resp.ok) throw new Error(`SLIP ${resp.status}`);
    const data = await resp.json();
    if (!data.features || data.features.length === 0) throw new Error("No SLIP contour data");

    // Build a dense point cloud from contour polylines: each vertex has an elevation
    const contourPts = []; // { lat, lng, elev }
    for (const feat of data.features) {
      const elev = feat.attributes?.elevation_m;
      if (elev == null || elev === 0) continue;
      const paths = feat.geometry?.paths || [];
      for (const path of paths) {
        for (const [lng, lat] of path) {
          contourPts.push({ lat, lng, elev });
        }
      }
    }
    if (contourPts.length < 3) throw new Error("Too few contour points");

    // For each query point, find elevation by inverse-distance weighted interpolation
    // from the nearest contour vertices (use 4 nearest for smooth interpolation)
    const elevations = points.map(pt => {
      // Find distances to all contour points (fast for typical <2000 points)
      const dists = contourPts.map((cp, i) => ({
        i,
        d: Math.sqrt((pt.lat - cp.lat) ** 2 + (pt.lng - cp.lng) ** 2),
        e: cp.elev,
      }));
      dists.sort((a, b) => a.d - b.d);
      const nearest = dists.slice(0, 6);

      // If very close to a contour point, use it directly
      if (nearest[0].d < 0.000005) return nearest[0].e; // ~0.5m

      // Inverse distance weighting
      let sumW = 0, sumWE = 0;
      for (const n of nearest) {
        const w = 1 / (n.d * n.d + 1e-12);
        sumW += w;
        sumWE += w * n.e;
      }
      return sumWE / sumW;
    });

    return { elevation: elevations, source: "slip_2m_contour", contourCount: data.features.length, pointCloud: contourPts.length };
  };

  const fetchElevFromOpenMeteo = async (points) => {
    const lats = points.map(p => p.lat.toFixed(6)).join(','), lngs = points.map(p => p.lng.toFixed(6)).join(',');
    const resp = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`);
    if (!resp.ok) throw new Error(`Elev ${resp.status}`);
    const data = await resp.json();
    return { elevation: data.elevation || [], source: "open_meteo_30m" };
  };

  const fetchElev3D = async (points, bbox) => {
    // 1. Try local Contours_2m.geojson (instant, no network)
    if (contoursData?.features?.length) {
      try {
        const result = fetchElevFromLocalContours(points, bbox);
        if (result) {
          const unique = new Set(result.elevation.map(e => Math.round(e)));
          if (unique.size >= 2 && !result.elevation.every(e => e === 0)) {
            console.log(`Elevation: local Contours_2m.geojson (${result.pointCloud} vertices in bbox)`);
            return result;
          }
        }
      } catch (e) { console.warn("Local contour interpolation failed:", e.message); }
    }

    // 2. Try SLIP 2m contours API (network call)
    try {
      const result = await fetchElevFromSLIP(points, bbox);
      const unique = new Set(result.elevation.map(e => Math.round(e)));
      if (unique.size >= 2 && !result.elevation.every(e => e === 0)) {
        console.log(`Elevation: SLIP 2m contours API (${result.contourCount} contours, ${result.pointCloud} vertices)`);
        return result;
      }
      throw new Error("SLIP data quality check failed");
    } catch (slipErr) {
      console.warn("SLIP contour fetch failed, falling back to Open-Meteo:", slipErr.message);
      // 3. Try Open-Meteo DEM
      try {
        return await fetchElevFromOpenMeteo(points);
      } catch (omErr) {
        console.warn("Open-Meteo also failed:", omErr.message);
        // 4. Final fallback: estimate
        const baseLine = 250 + Math.abs(points[0]?.lat || -32) * 3;
        return { elevation: points.map((_, i) => baseLine + Math.sin(i * 0.3) * 2), source: "estimate" };
      }
    }
  };

  const losEngine3D = (A, C, D, feats, eg, eyeH, tgtH) => {
    const elevA = getElevAt3D(A, eg), eyeAlt = elevA + eyeH;
    const obs = [], seen = new Set(), rays = [];
    for (let ri = 0; ri <= 40; ri++) {
      const tgt = lerpPt3D(C, D, ri / 40), elevTgt = getElevAt3D(tgt, eg), tgtAlt = elevTgt + tgtH, rayDist = havDist3D(A, tgt);
      const rayObs = []; let tBlocked = false, tBlockPt = null, tBlockInfo = null;
      for (let si = 1; si < 25; si++) {
        const sf = si / 25, sp = lerpPt3D(A, tgt, sf), sd = rayDist * sf, rayAlt = eyeAlt + (tgtAlt - eyeAlt) * sf, gnd = getElevAt3D(sp, eg);
        if (gnd > rayAlt && !tBlocked) { tBlocked = true; tBlockPt = sp; tBlockInfo = { groundElev: gnd, rayAlt, excessHeight: gnd - rayAlt, dist: sd }; }
        for (const f of feats) {
          if (seen.has(f.id + '_' + ri)) continue;
          let hit = false;
          if (f.type === 'tree' && f.geometry.length === 1) { if (havDist3D(sp, f.geometry[0]) < Math.min(f.estimatedHeight * 0.4, 5)) hit = true; }
          else if (f.geometry.length >= 2) { for (const g of f.geometry) { if (havDist3D(sp, g) < 3) { hit = true; break; } } if (!hit) { for (let gi = 0; gi < f.geometry.length - 1; gi++) { if (segX3D(A, tgt, f.geometry[gi], f.geometry[gi + 1])) { hit = true; break; } } } }
          if (hit) { const fg = f.groundElev != null ? f.groundElev : gnd, ft = fg + f.estimatedHeight; if (ft > rayAlt) { rayObs.push({ feature: f, point: f.geometry[0], distFromA: havDist3D(A, f.geometry[0]), isCritical: f.estimatedHeight >= 0.5 && f.estimatedHeight <= 1.0, blockType: 'feature', fGroundElev: fg, fTopAlt: ft, rayAltAtFeature: rayAlt, excessHeight: ft - rayAlt }); seen.add(f.id + '_' + ri); } }
        }
      }
      if (tBlocked && tBlockPt) rayObs.push({ feature: { id: 'terrain_' + ri, type: 'terrain_ridge', estimatedHeight: tBlockInfo.excessHeight, geometry: [tBlockPt], tags: {}, name: 'Terrain Ridge' }, point: tBlockPt, distFromA: tBlockInfo.dist, isCritical: false, blockType: 'terrain', fGroundElev: tBlockInfo.groundElev, fTopAlt: tBlockInfo.groundElev, rayAltAtFeature: tBlockInfo.rayAlt, excessHeight: tBlockInfo.excessHeight });
      rays.push({ target: tgt, obstructed: rayObs.length > 0, obs: rayObs, elevA, elevTgt, eyeAlt, tgtAlt });
      for (const o of rayObs) { const uid = o.feature.id; if (!seen.has('m_' + uid)) { seen.add('m_' + uid); obs.push(o); } }
    }
    return { obstructions: obs, rays, features: feats, elevA, eyeAlt };
  };

  // const aiClassify3D = async (A, C, D, obs, feats, ei) => {
  //   try {
  //     const prompt = `You are a 3D geospatial line-of-sight analyst. Observer A at ${ei.elevA.toFixed(1)}m ASL + ${ei.eyeH}m eye. Line C→D: ${havDist3D(C, D).toFixed(0)}m span at ${ei.elevCD.toFixed(1)}m ASL + ${ei.tgtH}m. ${obs.length} obstructions exceed sight ray. Features: ${feats.length}. Classify visibility. JSON only: {"overall_rating":"CLEAR|PARTIALLY_OBSTRUCTED|SEVERELY_OBSTRUCTED|BLOCKED","visibility_pct":0,"analysis_summary":"","critical_low_obstructions":[],"recommendations":[],"elevation_insight":""}`;
  //     const resp = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }) });
  //     const data = await resp.json(); return JSON.parse((data.content || []).map(c => c.text || '').join('').replace(/```json|```/g, '').trim());
  //   } catch {
  //     const vis = Math.max(0, Math.round((1 - obs.length / Math.max(feats.length + 1, 1) * 0.8) * 100));
  //     let rt = 'CLEAR'; if (vis < 30) rt = 'BLOCKED'; else if (vis < 55) rt = 'SEVERELY_OBSTRUCTED'; else if (vis < 80) rt = 'PARTIALLY_OBSTRUCTED';
  //     return { overall_rating: rt, visibility_pct: vis, analysis_summary: `${obs.length} obstructions found, ${obs.filter(o => o.isCritical).length} critical low.`, critical_low_obstructions: obs.filter(o => o.isCritical).map(c => ({ name: c.feature.name, height_range: c.feature.estimatedHeight.toFixed(1) + 'm', impact: `Exceeds ray by ${c.excessHeight?.toFixed(2)}m` })), recommendations: ['Review obstructions.'], elevation_insight: `Observer at ${ei.elevA.toFixed(1)}m, targets at ${ei.elevCD.toFixed(1)}m.` };
  //   }
  // };

  const aiClassify3D = async (A, C, D, obs, feats, ei) => {
  try {
    // ── Step 1: Capture satellite + street view images ──
    const heading = Math.round(Math.atan2(
      (sightTriangle?.ptB?.lng || D.lng) - A.lng,
      (sightTriangle?.ptB?.lat || D.lat) - A.lat
    ) * 180 / Math.PI + 90) || 0;

    const imgContent = [];

    // Satellite static image (640x400, zoom 19)
    try {
      const satUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${A.lat},${A.lng}&zoom=19&size=640x400&maptype=satellite&markers=color:red|label:A|${A.lat},${A.lng}&markers=color:blue|label:C|${C.lat},${C.lng}&markers=color:blue|label:D|${D.lat},${D.lng}&path=color:0xff000088|weight:2|${A.lat},${A.lng}|${C.lat},${C.lng}|${D.lat},${D.lng}|${A.lat},${A.lng}&key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU17R8`;
      const satResp = await fetch(satUrl);
      if (satResp.ok) {
        const satBlob = await satResp.blob();
        const satB64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(",")[1]); fr.readAsDataURL(satBlob); });
        imgContent.push({
          type: "image",
          source: { type: "base64", media_type: "image/png", data: satB64 }
        });
        imgContent.push({ type: "text", text: "[SATELLITE IMAGE] Aerial satellite view of the sight triangle area. Red marker A = driveway/observer. Blue markers C, D = sight line endpoints along road. Red triangle outline = required clear sight zone." });
      }
    } catch (e) { console.log("Satellite image capture skipped:", e.message); }

    // Street View static image (640x400, from point A looking toward road)
    try {
      const svUrl = `https://maps.googleapis.com/maps/api/streetview?size=640x400&location=${A.lat},${A.lng}&heading=${heading}&pitch=0&fov=90&key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU17R8`;
      const svResp = await fetch(svUrl);
      if (svResp.ok && svResp.headers.get("content-type")?.includes("image")) {
        const svBlob = await svResp.blob();
        const svB64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(",")[1]); fr.readAsDataURL(svBlob); });
        imgContent.push({
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: svB64 }
        });
        imgContent.push({ type: "text", text: "[STREET VIEW IMAGE] Ground-level view from the driveway (Point A) looking toward the road. This shows what the driver sees when exiting. Identify any vegetation, fences, walls, signs, parked vehicles, or structures that could obstruct the driver's view of approaching traffic." });
      }
    } catch (e) { console.log("Street view image capture skipped:", e.message); }

    // ── Step 2: Build the analysis prompt with images ──
    const prompt = `You are a senior traffic engineer conducting a sight triangle compliance assessment for a residential crossover (driveway) in Western Australia.

GEOSPATIAL DATA:
- Observer (A): ${A.lat.toFixed(6)}, ${A.lng.toFixed(6)} at ${ei.elevA.toFixed(1)}m ASL + ${ei.eyeH}m eye height = ${(ei.elevA + ei.eyeH).toFixed(1)}m
- Sight line C: ${C.lat.toFixed(6)}, ${C.lng.toFixed(6)} 
- Sight line D: ${D.lat.toFixed(6)}, ${D.lng.toFixed(6)}
- Sight line span C→D: ${havDist3D(C, D).toFixed(0)}m at ${ei.elevCD.toFixed(1)}m ASL + ${ei.tgtH}m target height
- Elevation advantage A over road: ${ei.advantage?.toFixed(1) || "0"}m
- ${obs.length} geospatial obstructions exceed sight ray (from OSM/DEM data)
- ${feats.length} total features in area

${imgContent.length > 0 ? `IMAGERY ANALYSIS:
Examine the satellite and street view images provided. Identify:
1. Trees, hedges, dense vegetation within or near the sight triangle
2. Fences, walls, retaining walls above 0.65m that could block driver vision
3. Signs, poles, utility boxes, parked vehicles
4. Any structure between 0.65m-1.5m height in the triangle zone
5. Verge condition — is it clear or obstructed?
6. Road geometry — curves, intersections, median islands affecting sight lines
7. ROAD CROSSINGS & JUNCTIONS: Look carefully at both satellite and street view for:
   - Pedestrian crossings (marked or unmarked) within 30m of Point A
   - Road intersections / T-junctions / roundabouts within 30m
   - Give way signs, stop signs, traffic signals
   - Other driveways / crossovers within 30m
   Report the estimated distance from Point A to each crossing found.` : "No imagery available — assess based on geospatial data only."}

ASSESSMENT STANDARD: AS 2890.1:2004 §3.2.4 / Austroads Guide to Road Design Part 4A
- Clear zone: nothing between 0.65m-1.5m height within the sight triangle
- Eye height: 1.15m (seated driver)
- Object height: 0.65m (child) to 1.5m (pedestrian)

Respond with JSON only:
{
  "overall_rating": "CLEAR|PARTIALLY_OBSTRUCTED|SEVERELY_OBSTRUCTED|BLOCKED",
  "visibility_pct": 0,
  "analysis_summary": "...",
  "satellite_findings": "What the aerial image reveals about obstructions...",
  "streetview_findings": "What the street-level image reveals about driver sight lines...",
  "vegetation_assessment": "Trees/hedges status...",
  "infrastructure_assessment": "Fences/walls/signs...",
  "nearby_crossings": [{"type":"pedestrian_crossing|intersection|stop_sign|give_way|traffic_signals|driveway|roundabout","name":"...","estimated_distance_m":0,"impact":"How this affects sight requirements"}],
  "critical_low_obstructions": [{"name":"...","height_range":"...","impact":"..."}],
  "recommendations": ["..."],
  "elevation_insight": "..."
}`;

    const messages = [{
      role: "user",
      content: imgContent.length > 0
        ? [...imgContent, { type: "text", text: prompt }]
        : prompt
    }];

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        messages
      })
    });

    const data = await resp.json();
    return JSON.parse(
      (data.content || [])
        .map(c => c.text || "")
        .join("")
        .replace(/```json|```/g, "")
        .trim()
    );

  } catch (err) {
    console.warn("AI vision analysis failed, using LOS fallback:", err.message);

    // ── Fallback: rule-based LOS analysis ──
    if (obs.length === 0) {
      return {
        overall_rating: "CLEAR",
        visibility_pct: 100,
        analysis_summary: "No obstructions detected along the sight-line.",
        satellite_findings: "Imagery analysis unavailable — using geospatial data only.",
        streetview_findings: "Street view analysis unavailable.",
        vegetation_assessment: "No vegetation obstructions detected in geospatial data.",
        infrastructure_assessment: "No infrastructure obstructions detected.",
        nearby_crossings: [],
        critical_low_obstructions: [],
        recommendations: [],
        elevation_insight: `Observer at ${ei.elevA.toFixed(1)}m, target at ${ei.elevCD.toFixed(1)}m.`
      };
    }

    const highestBlock = Math.max(...obs.map(o => o.excessHeight || 0), 0);
    const lowestClearance = Math.min(...obs.map(o => o.clearance ?? Infinity), Infinity);
    let vis = 100;
    if (highestBlock > 0) vis = Math.max(0, 100 - (highestBlock * 25));
    let rating = "CLEAR";
    if (vis < 20) rating = "BLOCKED";
    else if (vis < 45) rating = "SEVERELY_OBSTRUCTED";
    else if (vis < 75) rating = "PARTIALLY_OBSTRUCTED";

    return {
      overall_rating: rating,
      visibility_pct: vis,
      analysis_summary: `${obs.length} obstructions found. Highest exceedance: ${highestBlock.toFixed(2)}m. Lowest clearance: ${lowestClearance === Infinity ? "N/A" : lowestClearance.toFixed(2) + "m"}.`,
      satellite_findings: "Imagery analysis unavailable — using geospatial data only.",
      streetview_findings: "Street view analysis unavailable.",
      vegetation_assessment: `${obs.filter(o => o.feature?.type === "tree" || o.feature?.tags?.natural).length} vegetation obstructions detected.`,
      infrastructure_assessment: `${obs.filter(o => o.feature?.tags?.barrier || o.feature?.tags?.["man_made"]).length} infrastructure obstructions detected.`,
      nearby_crossings: [],
      critical_low_obstructions: obs.filter(o => o.isCritical).map(c => ({
        name: c.feature.name,
        height_range: `${c.feature.estimatedHeight.toFixed(1)}m`,
        impact: `Exceeds ray by ${c.excessHeight?.toFixed(2)}m`
      })),
      recommendations: [
        highestBlock > 0 ? "Review and potentially remove physical obstructions within the sight triangle." : "LOS mostly clear; verify on-site conditions."
      ],
      elevation_insight: `Observer at ${ei.elevA.toFixed(1)}m, target at ${ei.elevCD.toFixed(1)}m.`
    };
  }
};

  // Run the full 3D analysis using existing A/B and derived C/D points
  const run3DSightAnalysis = async () => {
    if (!sightTriangle?.ptA || !sightTriangle?.triLeft || !sightTriangle?.triRight) return;
    const A = sightTriangle.ptA, C = sightTriangle.triLeft, D = sightTriangle.triRight;
    const eyeH = eyeHeight, tgtH = objectHeight;
    setAnalysisRunning(true); setAnalysisResult(null);
    const steps = ['Querying OSM Overpass...', 'Processing features...', 'Fetching elevation (SLIP/DEM)...', 'Ground elevations...', '3D line-of-sight (40 rays)...', 'Capturing satellite + street view...', 'AI Vision classification...', 'Done!'];
    const ss = (n) => setAnalysisSteps(steps.map((s, i) => ({ text: s, status: i < n ? 'done' : i === n ? 'active' : 'pending' })));
    let feats = [], mode = 'live';
    try { ss(0); const ctr = { lat: (A.lat + C.lat + D.lat) / 3, lng: (A.lng + C.lng + D.lng) / 3 }; const r = Math.max(havDist3D(A, C), havDist3D(A, D), havDist3D(C, D)) + 80; const data = await fetchOSM3D(ctr, r); ss(1); feats = procOSM3D(data); if (!feats.length) mode = 'no_data'; } catch { mode = 'error'; }
    ss(2);
    const mid = { lat: (C.lat + D.lat) / 2, lng: (C.lng + D.lng) / 2 };
    const eSPts = []; for (let i = 0; i <= 20; i++) { eSPts.push(lerpPt3D(A, mid, i / 20)); eSPts.push(lerpPt3D(A, C, i / 20)); eSPts.push(lerpPt3D(A, D, i / 20)); eSPts.push(lerpPt3D(C, D, i / 20)); }
    const mnLa = Math.min(A.lat, C.lat, D.lat) - .0002, mxLa = Math.max(A.lat, C.lat, D.lat) + .0002, mnLo = Math.min(A.lng, C.lng, D.lng) - .0003, mxLo = Math.max(A.lng, C.lng, D.lng) + .0003;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) eSPts.push({ lat: mnLa + r / 3 * (mxLa - mnLa), lng: mnLo + c / 3 * (mxLo - mnLo) });
    const uPts = []; const sn = new Set(); for (const p of eSPts) { const k = p.lat.toFixed(5) + ',' + p.lng.toFixed(5); if (!sn.has(k)) { sn.add(k); uPts.push(p); } if (uPts.length >= 100) break; }
    let elevs = [], elevSource = "estimate"; try { const bbox = { minLat: mnLa, maxLat: mxLa, minLng: mnLo, maxLng: mxLo }; const ed = await fetchElev3D(uPts, bbox); elevs = ed.elevation || []; elevSource = ed.source || "unknown"; } catch { const b = 10 + Math.abs(A.lat * 100 % 20); elevs = uPts.map((_, i) => b + Math.sin(i * .3) * 1.5); }
    const eg = { pts: uPts, elevs };
    ss(3); for (const f of feats) { const ct = f.geometry.length === 1 ? f.geometry[0] : { lat: f.geometry.reduce((s, g) => s + g.lat, 0) / f.geometry.length, lng: f.geometry.reduce((s, g) => s + g.lng, 0) / f.geometry.length }; f.groundElev = getElevAt3D(ct, eg); }
    ss(4); const res = losEngine3D(A, C, D, feats, eg, eyeH, tgtH);

    // Also check corner sight line (A → curve sight point) if available
    let cornerLineResult = null;
    if (sightTriangle?.cornerSightLine) {
      const csl = sightTriangle.cornerSightLine;
      const cslTarget = csl.to;
      // Run line-of-sight from A to corner sight point
      const cslObs = [];
      const elevAcsl = getElevAt3D(A, eg), eyeAltCsl = elevAcsl + eyeH;
      const elevTarget = getElevAt3D(cslTarget, eg), tgtAltCsl = elevTarget + tgtH;
      const cslDist = havDist3D(A, cslTarget);
      for (let si = 1; si < 20; si++) {
        const sf = si / 20, sp = lerpPt3D(A, cslTarget, sf);
        const rayAlt = eyeAltCsl + (tgtAltCsl - eyeAltCsl) * sf;
        const gnd = getElevAt3D(sp, eg);
        if (gnd > rayAlt) {
          cslObs.push({ type: 'terrain', point: sp, groundElev: gnd, rayAlt, excess: gnd - rayAlt, dist: cslDist * sf });
        }
        for (const f of feats) {
          let hit = false;
          if (f.type === 'tree' && f.geometry.length === 1) { if (havDist3D(sp, f.geometry[0]) < 5) hit = true; }
          else if (f.geometry.length >= 2) { for (const g of f.geometry) { if (havDist3D(sp, g) < 3) { hit = true; break; } } }
          if (hit) {
            const fg = f.groundElev != null ? f.groundElev : gnd;
            if (fg + f.estimatedHeight > rayAlt) {
              cslObs.push({ type: 'feature', name: f.name, point: f.geometry[0], height: f.estimatedHeight, dist: cslDist * sf });
            }
          }
        }
      }
      cornerLineResult = { obstructions: cslObs, distance: cslDist, blocked: cslObs.length > 0, from: A, to: cslTarget };
    }
    // Filter obstructions to only those inside the sight triangle A-C-D
    const ptInTri = (p, a, b, c) => {
      const dx = p.lat - c.lat, dy = p.lng - c.lng;
      const dx1 = a.lat - c.lat, dy1 = a.lng - c.lng;
      const dx2 = b.lat - c.lat, dy2 = b.lng - c.lng;
      const d = dx1 * dy2 - dx2 * dy1;
      if (Math.abs(d) < 1e-14) return false;
      const u = (dy2 * dx - dx2 * dy) / d;
      const v = (dx1 * dy - dy1 * dx) / d;
      return u >= -0.02 && v >= -0.02 && (u + v) <= 1.02;
    };
    res.obstructions = res.obstructions.filter(o => o.point && ptInTri(o.point, A, C, D));
    ss(5); const elevA = getElevAt3D(A, eg), elevCD = getElevAt3D(mid, eg); const adv = (elevA + eyeH) - (elevCD + tgtH);
    const ai = await aiClassify3D(A, C, D, res.obstructions, feats, { elevA, elevCD, eyeH, tgtH, eyeAlt: elevA + eyeH, tgtAlt: elevCD + tgtH, advantage: adv, elevRange: Math.max(...elevs) - Math.min(...elevs) });
    ss(6); setAnalysisResult({ ...res, ai, elevA, elevCD, eyeH, tgtH, feats, mode, cornerLineResult, elevSource }); setAnalysisRunning(false);
  };

  const reset3DAnalysis = () => { setAnalysisResult(null); setAnalysisRunning(false); setAnalysisSteps([]); };
  const [roadWidthResult, setRoadWidthResult] = useState(null);
  const [roadWidthRunning, setRoadWidthRunning] = useState(false);

  // ── AI Road Width Measurement from Satellite Imagery ──
  const measureRoadWidth = async () => {
    if (!sightTriangle?.ptA || !sightTriangle?.ptB) return;
    const A = sightTriangle.ptA; // driveway point
    const B = sightTriangle.ptB; // road centre point
    setRoadWidthRunning(true); setRoadWidthResult(null);

    try {
      // ── Capture satellite image from Esri World Imagery (same as Detail map view) ──
      // Esri export map API — free, no API key, same tiles as the Detail view
      const zoom = 19; // high zoom for road detail
      const pxPerMetre = Math.pow(2, zoom) * Math.cos(B.lat * Math.PI / 180) / 156543.03392;
      const imgWidth = 800, imgHeight = 800;
      const metresAcross = imgWidth / pxPerMetre;
      const halfM = metresAcross / 2;

      // Calculate bbox in metres from centre
      const mPerLat = 111320, mPerLng = 111320 * Math.cos(B.lat * Math.PI / 180);
      const dLat = halfM / mPerLat, dLng = halfM / mPerLng;
      const bbox = `${B.lng - dLng},${B.lat - dLat},${B.lng + dLng},${B.lat + dLat}`;

      // Esri World Imagery export (same imagery as the Detail satellite base layer)
      const esriUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${bbox}&bboxSR=4326&imageSR=4326&size=${imgWidth},${imgHeight}&format=png&f=image`;
      const satResp = await fetch(esriUrl);
      if (!satResp.ok) throw new Error(`Satellite image fetch failed: ${satResp.status}`);

      const satBlob = await satResp.blob();
      const satB64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(",")[1]); fr.readAsDataURL(satBlob); });

      // Also try street view (Google — may fail, that's OK)
      const roadBearing = Math.round(Math.atan2(B.lng - A.lng, B.lat - A.lat) * 180 / Math.PI + 90) || 0;
      let svB64 = null;
      try {
        const svUrl = `https://maps.googleapis.com/maps/api/streetview?size=640x400&location=${B.lat},${B.lng}&heading=${roadBearing}&pitch=-10&fov=90&key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU17R8`;
        const svResp = await fetch(svUrl);
        if (svResp.ok && svResp.headers.get("content-type")?.includes("image")) {
          const blob = await svResp.blob();
          svB64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(",")[1]); fr.readAsDataURL(blob); });
        }
      } catch (e) { console.log("Street view skipped:", e.message); }

      // Build the AI prompt
      const imgContent = [
        { type: "image", source: { type: "base64", media_type: "image/png", data: satB64 } },
        { type: "text", text: `[SATELLITE IMAGE - ESRI WORLD IMAGERY] Top-down aerial view centred on the road near the crossover at ${B.lat.toFixed(6)}, ${B.lng.toFixed(6)}. The image is ${imgWidth}x${imgHeight} pixels covering approximately ${metresAcross.toFixed(1)}m × ${metresAcross.toFixed(1)}m. Scale: 1 pixel ≈ ${(1/pxPerMetre).toFixed(3)}m. Point A (driveway) is at approximately ${A.lat.toFixed(6)}, ${A.lng.toFixed(6)}. The road runs near the centre of the image.` },
      ];
      if (svB64) {
        imgContent.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: svB64 } });
        imgContent.push({ type: "text", text: `[STREET VIEW] Ground-level view from near the road centre, looking along the road. Use this to verify road features: lane markings, kerb type, verge width, median, road surface.` });
      }

      const prompt = `You are a road geometry specialist measuring road width from aerial and street-level imagery in Western Australia.

IMAGE CALIBRATION:
- Satellite image: ${imgWidth}x${imgHeight}px from Esri World Imagery
- Scale: 1 pixel ≈ ${(1/pxPerMetre).toFixed(3)} metres
- Total image coverage: ~${metresAcross.toFixed(0)}m × ${metresAcross.toFixed(0)}m
- Centre location: ${B.lat.toFixed(6)}, ${B.lng.toFixed(6)}
- Driveway (A) at: ${A.lat.toFixed(6)}, ${A.lng.toFixed(6)}
- The road runs through the image near the driveway point A.

TASK: Measure the road dimensions at the section nearest to marker A (the crossover).

From the SATELLITE image, identify and measure:
1. KERB-TO-KERB width — the sealed carriageway between kerb lines
2. ROAD RESERVE width — full width between property boundaries on each side (includes verges)
3. Number of traffic lanes and approximate lane width
4. Verge width on the driveway side
5. Whether there is a median, turning lane, or centre line
6. Road surface type (asphalt, concrete, gravel)
7. Is this a corner lot? (frontage to 2+ roads visible)

MEASUREMENT METHOD: Count the pixels between kerb edges in the satellite image, then multiply by the scale factor (${(1/pxPerMetre).toFixed(3)}m/px). Report measurements in metres.

If a street view image is provided, use it to confirm or refine your satellite measurements.

WA TYPICAL ROAD WIDTHS (for reference):
- Local access road: 6.0-7.2m kerb-to-kerb (15-18m reserve)
- Local distributor: 7.0-10.0m (18-20m reserve)
- District distributor: 10.0-14.0m (20-30m reserve)
- Primary distributor: 14.0+ (30m+ reserve)

Respond with JSON only:
{
  "carriageway_width_m": 0.0,
  "road_reserve_width_m": 0.0,
  "verge_width_driveway_side_m": 0.0,
  "verge_width_opposite_side_m": 0.0,
  "lane_count": 0,
  "lane_width_m": 0.0,
  "has_median": false,
  "has_centre_line": false,
  "has_turning_lane": false,
  "road_surface": "asphalt|concrete|gravel|unsealed",
  "road_classification": "local_access|local_distributor|district_distributor|primary_distributor",
  "is_corner_lot": false,
  "corner_roads": [],
  "measurement_confidence": "high|medium|low",
  "measurement_method": "Description of how measurements were taken from the image...",
  "notes": "Any additional observations about the road geometry..."
}`;

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1500,
          messages: [{ role: "user", content: [...imgContent, { type: "text", text: prompt }] }],
        }),
      });

      const data = await resp.json();
      const text = (data.content || []).map(c => c.text || "").join("").replace(/```json|```/g, "").trim();
      const result = JSON.parse(text);
      setRoadWidthResult(result);
    } catch (err) {
      console.error("Road width measurement failed:", err);
      setRoadWidthResult({ error: err.message });
    } finally {
      setRoadWidthRunning(false);
    }
  };

  const ratingMap3D = { CLEAR: { color: '#27ae60', bg: '#eafaf1', label: '✓ CLEAR' }, PARTIALLY_OBSTRUCTED: { color: '#e67e22', bg: '#fef5e7', label: '◐ PARTIAL' }, SEVERELY_OBSTRUCTED: { color: '#c0392b', bg: '#fdedec', label: '◑ SEVERE' }, BLOCKED: { color: '#c0392b', bg: '#fdedec', label: '✗ BLOCKED' } };
  const hInputStyle = { background: "#f8fafb", border: "1.5px solid #d5dde2", color: T.c.text, borderRadius: 5, padding: "4px 6px", width: 52, fontSize: 11, fontWeight: T.w.bold, fontFamily: "inherit", textAlign: "center", outline: "none" };

  // Try to derive lot polygon from the lots layer using the address
  const derivedLotFromAddress = useMemo(() => {
    if (!lotsData || !app?.property?.address) return null;

    const addr = app.property.address;
    const addrUpper = addr.toUpperCase();

    // Strategy: same as your lots tooltip match — address contains rd and n
    // (This mirrors the existing "isMatch" you use when styling the lots layer.)
    // p.n = lot number, p.rd = road text (uppercased in data)
    for (const f of (lotsData.features || [])) {
      const p = f.properties || {};
      if (!p) continue;

      if (p.rd && p.n && addrUpper.includes(p.rd) && addr.includes(p.n)) {
        const ringLngLat = getFirstRing(f);
        if (ringLngLat && ringLngLat.length >= 3) {
          // Convert [lng,lat] → [lat,lng]
          const poly = ringLngLat.map(([lng, lat]) => [lat, lng]);
          return poly;
        }
      }
    }
    return null;
  }, [lotsData, app?.property?.address]);

  // Use real lotPoly if available, else approximate rectangle
  // const lotPoly = coords?.lotPoly || (() => {
  //   if (!coords) return [];
  //   const c = coords, p = app.property;
  //   const mLat = 111320, mLng = 111320 * Math.cos(c.lat * Math.PI / 180);
  //   const hW = (p.frontage / 2) / mLng, hD = (p.depth / 2) / mLat;
  //   return [[c.lat+hD,c.lng-hW],[c.lat+hD,c.lng+hW],[c.lat-hD,c.lng+hW],[c.lat-hD,c.lng-hW],[c.lat+hD,c.lng-hW]];
  // })();

  // Use API-provided polygon first, then derived-from-address, else approximate rectangle
  const lotPoly = useMemo(() => {
    // 1) API (applications.lot_polygon)
    const apiPoly = normalizeLotPolygon(app?.lot_polygon);
    if (apiPoly && apiPoly.length >= 3) return apiPoly;

    // 2) Derived from address via lotsData
    const addrPoly = normalizeLotPolygon(derivedLotFromAddress);
    if (addrPoly && addrPoly.length >= 3) return addrPoly;

    // 3) Approximate rectangle around coords center using frontage/depth
    if (!coords) return [];
    const c = coords, p = app.property;
    const mLat = 111320, mLng = 111320 * Math.cos(c.lat * Math.PI / 180);
    const hW = (p.frontage / 2) / mLng, hD = (p.depth / 2) / mLat;
    return [
      [c.lat + hD, c.lng - hW],
      [c.lat + hD, c.lng + hW],
      [c.lat - hD, c.lng + hW],
      [c.lat - hD, c.lng - hW],
      [c.lat + hD, c.lng - hW],
    ];
  }, [app?.lot_polygon, derivedLotFromAddress, coords, app?.property]);

  // Find the lot polygon that CONTAINS point A (from the 23k lots GeoJSON)
  const ptALotPoly = useMemo(() => {
    if (!ptA || !lotsData?.features) return null;
    // Ray-casting point-in-polygon
    const ptInPolyLngLat = (lat, lng, ring) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    };
    for (const f of lotsData.features) {
      const geom = f.geometry;
      if (!geom) continue;
      let rings = [];
      if (geom.type === "Polygon") rings = [geom.coordinates[0]];
      else if (geom.type === "MultiPolygon") rings = geom.coordinates.map(p => p[0]);
      for (const ring of rings) {
        // GeoJSON rings are [lng, lat]
        if (ptInPolyLngLat(ptA.lat, ptA.lng, ring)) {
          // Convert [lng, lat] → [lat, lng] for our polygon format
          const poly = ring.map(([lng, lat]) => [lat, lng]);
          return { poly, properties: f.properties };
        }
      }
    }
    return null;
  }, [ptA, lotsData]);

  const handleMapClick = useCallback((latlng) => {
    if (drawMode === "ptA") { setPtA({ lat: latlng.lat, lng: latlng.lng }); setDrawMode("ptB"); }
    else if (drawMode === "ptB") { setPtB({ lat: latlng.lat, lng: latlng.lng }); setDrawMode(null); }
  }, [drawMode]);

  useEffect(() => {
    if (!ptA || !ptB) { setSightTriangle(null); return; }
    const nearestRoad = findNearestRoadSpeed(ptB.lat, ptB.lng, speedRoadsData);
    // Use corner speed (from radius tool) if available, otherwise road speed
    const effectiveSpeed = cornerSpeed || nearestRoad.speed;
    const sd = getSightDistances(effectiveSpeed);
    const leftDistM = sd.leftM, rightDistM = sd.rightM, baseTotal = leftDistM + rightDistM;

    const bearing = geoBearing(ptA.lat, ptA.lng, ptB.lat, ptB.lng);
    const triLeft = geoOffset(ptB.lat, ptB.lng, leftDistM, (bearing - 90 + 360) % 360);
    const triRight = geoOffset(ptB.lat, ptB.lng, rightDistM, (bearing + 90) % 360);
    const depthM = geoDistMetres(ptA.lat, ptA.lng, ptB.lat, ptB.lng);

    // Distance from ptA to EACH side of the lot polygon where point A is located
    const boundaryDists = [];
    const bPoly = ptALotPoly?.poly || lotPoly;
    if (bPoly && bPoly.length > 1) {
      for (let i = 0; i < bPoly.length - 1; i++) {
        const seg = nearestPointOnSegment(ptA.lat, ptA.lng, bPoly[i][0], bPoly[i][1], bPoly[i+1][0], bPoly[i+1][1]);
        const d = geoDistMetres(ptA.lat, ptA.lng, seg.lat, seg.lng);
        const sideLen = geoDistMetres(bPoly[i][0], bPoly[i][1], bPoly[i+1][0], bPoly[i+1][1]);
        boundaryDists.push({ idx: i, dist: d, distLabel: d.toFixed(1), nearPt: seg, sideLen: sideLen.toFixed(1), from: bPoly[i], to: bPoly[i+1] });
      }
      boundaryDists.sort((a, b) => a.dist - b.dist);
    }

    let nearestInt = null, nearestIntDist = Infinity;
    ((coords?.intersections) || []).forEach(isc => {
      const d = geoDistMetres(ptB.lat, ptB.lng, isc.lat, isc.lng);
      if (d < nearestIntDist) { nearestIntDist = d; nearestInt = { ...isc, dist: d.toFixed(1) }; }
    });

    const grade = (Math.random() * 7 + 1).toFixed(1);
    const elevDiff = (parseFloat(grade) / 100 * depthM).toFixed(2);

    // For corner lots, compute sight line from A to the sight distance point on curve
    let cornerSightLine = null;
    if (cornerSpeed && sightConfig.sightPt) {
      const sp = sightConfig.sightPt;
      cornerSightLine = {
        from: { lat: ptA.lat, lng: ptA.lng },
        to: { lat: sp[0], lng: sp[1] },
        distance: geoDistMetres(ptA.lat, ptA.lng, sp[0], sp[1]),
      };
    }

    setSightTriangle({
      ptA, ptB, triLeft, triRight,
      lineAB: [[ptA.lat, ptA.lng], [ptB.lat, ptB.lng]],
      cornerSightLine,
      lotPoly: bPoly, boundaryDists,
      ptALotInfo: ptALotPoly?.properties || null,
      speedInfo: { detected: effectiveSpeed, roadName: cornerSpeed ? `Corner R (${(cornerSpeed/6.67)**2 > 0 ? ((cornerSpeed/6.67)**2).toFixed(0) : '?'}m)` : nearestRoad.roadName, networkType: nearestRoad.networkType, absMin: sd.absMin, ssdMin: sd.ssdMin, leftM: leftDistM, rightM: rightDistM, baseTotal, isCorner: !!cornerSpeed },
      analysis: {
        depth: depthM.toFixed(1), area: (baseTotal * depthM / 2).toFixed(1), baseWidth: baseTotal.toFixed(1),
        leftDist: leftDistM.toFixed(1), rightDist: rightDistM.toFixed(1),
        distToProperty: boundaryDists[0]?.distLabel || "—",
        nearestPropPt: boundaryDists[0]?.nearPt || null,
        nearestIntersection: nearestInt, nearestIntDist: nearestIntDist.toFixed(1),
        grade, elevDiff, compliant: depthM >= 2.0, heightClear: true,
      },
    });

    // Async road crossing detection removed — handled by AI 3D Sight Analysis instead
  }, [ptA, ptB, coords, lotPoly, ptALotPoly, cornerSpeed, sightConfig.sightPt]);

  const resetTriangle = () => { setPtA(null); setPtB(null); setSightTriangle(null); setDrawMode(null); setCornerSpeed(null); setSightPhase(null); setSightConfig({ x: 2.5, y: 4.0, isCorner: false, cornerR: null, cornerV: null, sightPt: null, turnStart: null, turnEnd: null }); setOffsetState({ step: 0, road: null, boundary: null, x: 2.5, y: 4.0, isCorner: false, cornerR: null, cornerV: null }); setMapTool(null); setRadiusResult(null); if (radiusClearRef.current) radiusClearRef.current(); reset3DAnalysis(); };
  const startDraw = () => { resetTriangle(); setDrawMode("ptA"); };

  // Transition: offset road clicked → update phase
  useEffect(() => {
    if (sightPhase === "offset_road" && offsetState.step === 1) {
      setSightPhase("offset_boundary");
    }
  }, [offsetState.step, sightPhase]);

  // Start unified sight analysis — auto-detect corner lot
  const startSightAnalysis = () => {
    resetTriangle();
    let isCorner = false;
    let cornerSource = null;
    let crossoverRoad = null;
    let constrainedSide = null;
    let crossoverWidth = null;
    let leftBoundaryDist = null;
    let rightBoundaryDist = null;
    let leftBoundaryFeature = null;
    let rightBoundaryFeature = null;
    let autoY = 4.0; // default fence distance

    // Extract AI data (officer-corrected first, then original)
    // The data can be at .extraction or at the root level depending on how it was saved
    const spd = app?.cor_site_plan_data || app?.site_plan_data || app?.org_site_plan_data;
    const ext = spd?.extraction || spd;

    console.log("Sight Analysis data sources:", {
      has_cor: !!app?.cor_site_plan_data,
      has_spd: !!app?.site_plan_data,
      has_org: !!app?.org_site_plan_data,
      cor_keys: app?.cor_site_plan_data ? Object.keys(app.cor_site_plan_data) : null,
      spd_keys: spd ? Object.keys(spd).slice(0, 10) : null,
      ext_keys: ext ? Object.keys(ext).slice(0, 10) : null,
      has_crossover_dims: !!ext?.crossover_dimensions,
      has_siteplan_meas: !!ext?.siteplan_measurements,
    });

    if (ext) {
      console.log("Sight Analysis AI data:", JSON.stringify({
        crossover_on_road: ext.siteplan_measurements?.crossover_on_road,
        road_name: ext.siteplan_measurements?.road_name,
        constrained_side: ext.crossover_dimensions?.constrained_side,
        left_dist: ext.crossover_dimensions?.distance_to_left_boundary_m,
        right_dist: ext.crossover_dimensions?.distance_to_right_boundary_m,
        left_feat: ext.crossover_dimensions?.left_boundary_feature,
        right_feat: ext.crossover_dimensions?.right_boundary_feature,
        width: ext.crossover_dimensions?.width_at_boundary_m,
        total_width: ext.crossover_dimensions?.total_width_at_road_m,
        is_corner: ext.property?.is_corner_lot,
        corner_roads: ext.property?.corner_roads,
      }, null, 2));

      // Crossover road
      crossoverRoad = ext.siteplan_measurements?.crossover_on_road
        || ext.siteplan_measurements?.road_name || null;

      // Constrained side and boundary distances
      constrainedSide = ext.crossover_dimensions?.constrained_side || null;
      leftBoundaryDist = ext.crossover_dimensions?.distance_to_left_boundary_m;
      rightBoundaryDist = ext.crossover_dimensions?.distance_to_right_boundary_m;
      leftBoundaryFeature = ext.crossover_dimensions?.left_boundary_feature || null;
      rightBoundaryFeature = ext.crossover_dimensions?.right_boundary_feature || null;

      // Crossover width
      crossoverWidth = ext.crossover_dimensions?.width_at_boundary_m
        || ext.crossover_dimensions?.total_width_at_road_m || null;

      // Auto-calculate Y (fence/side distance for Point A)
      // Point A lateral position = constrained side distance + 0.5 * crossover width
      if (constrainedSide && crossoverWidth) {
        const constrainedDist = constrainedSide === "left" ? leftBoundaryDist : rightBoundaryDist;
        if (constrainedDist != null) {
          autoY = constrainedDist + 0.5 * crossoverWidth;
        }
      } else if (leftBoundaryDist != null && rightBoundaryDist != null && crossoverWidth) {
        // If no constrained side set, use the shorter one
        const minDist = Math.min(leftBoundaryDist, rightBoundaryDist);
        constrainedSide = leftBoundaryDist <= rightBoundaryDist ? "left" : "right";
        autoY = minDist + 0.5 * crossoverWidth;
      }
    }

    // PRIORITY 1: Officer-corrected AI data (final authority)
    const corExtraction = app?.cor_site_plan_data?.extraction;
    if (corExtraction && corExtraction.is_corner_lot !== undefined && corExtraction.is_corner_lot !== null) {
      isCorner = corExtraction.is_corner_lot === true || corExtraction.is_corner_lot === "true" || corExtraction.is_corner_lot === "yes" || corExtraction.is_corner_lot === "Yes";
      cornerSource = "ai_corrected";
    }
    // PRIORITY 2: Original AI extraction
    else {
      const orgExtraction = (app?.site_plan_data || app?.org_site_plan_data)?.extraction;
      if (orgExtraction && orgExtraction.is_corner_lot !== undefined && orgExtraction.is_corner_lot !== null) {
        isCorner = orgExtraction.is_corner_lot === true || orgExtraction.is_corner_lot === "true" || orgExtraction.is_corner_lot === "yes" || orgExtraction.is_corner_lot === "Yes";
        cornerSource = "ai_original";
      }
    }

    // PRIORITY 3: Geometry detection (fallback when no AI data)
    if (!cornerSource) {
    let poly = lotPoly;
    if (poly && poly.length >= 4) {
      const lf = poly[0], ll = poly[poly.length-1];
      if (lf[0] !== ll[0] || lf[1] !== ll[1]) poly = [...poly, lf];

      const mPerLat = 111320;
      const mPerLng = 111320 * Math.cos((poly[0][0]) * Math.PI / 180);
      const sideLen = (a, b) => Math.sqrt(((a[0]-b[0])*mPerLat)**2 + ((a[1]-b[1])*mPerLng)**2);
      const sideAngle = (a, b) => Math.atan2((b[1]-a[1])*mPerLng, (b[0]-a[0])*mPerLat);

      // METHOD 1: Road proximity check (when road data available)
      let roadDetected = false;
      const sideNearRoad = [];
      for (let i = 0; i < poly.length - 1; i++) {
        const midLat = (poly[i][0] + poly[i+1][0]) / 2;
        const midLng = (poly[i][1] + poly[i+1][1]) / 2;
        let near = false;
        for (const src of [speedRoadsData, roadNetworkData].filter(s => s?.features)) {
          if (near) break;
          for (const f of src.features) {
            if (near) break;
            const c = f.geometry?.coordinates;
            if (!c || f.geometry?.type !== "LineString") continue;
            for (let j = 0; j < c.length - 1; j++) {
              const ax = c[j][0], ay = c[j][1], bx = c[j+1][0], by = c[j+1][1];
              const dx = bx-ax, dy = by-ay, len = dx*dx+dy*dy;
              if (len < 1e-20) continue;
              const t = Math.max(0, Math.min(1, ((midLng-ax)*dx + (midLat-ay)*dy) / len));
              const slat = ay+t*dy, slng = ax+t*dx;
              const d = Math.sqrt(((midLat-slat)*mPerLat)**2 + ((midLng-slng)*mPerLng)**2);
              if (d < 12) { near = true; break; }
            }
          }
        }
        sideNearRoad.push(near);
      }

      // Check if any road was found at all
      if (sideNearRoad.some(n => n)) {
        for (let i = 0; i < sideNearRoad.length; i++) {
          const next = (i + 1) % sideNearRoad.length;
          if (sideNearRoad[i] && sideNearRoad[next]) {
            const p0 = poly[i], p1 = poly[(i+1) % (poly.length-1)], p2 = poly[(i+2) % (poly.length-1)];
            const dx1 = p1[1]-p0[1], dy1 = p1[0]-p0[0];
            const dx2 = p2[1]-p1[1], dy2 = p2[0]-p1[0];
            const angle = Math.abs(Math.atan2(dx1*dy2-dy1*dx2, dx1*dx2+dy1*dy2)) * 180 / Math.PI;
            if (angle > 40 && angle < 160) { isCorner = true; roadDetected = true; break; }
          }
        }
      }

      // METHOD 2: Geometry-only detection (when no road data nearby)
      if (!roadDetected && !isCorner) {
        const rawSides = [];
        for (let i = 0; i < poly.length - 1; i++) {
          rawSides.push({
            idx: i,
            len: sideLen(poly[i], poly[i+1]),
            angle: sideAngle(poly[i], poly[i+1]),
          });
        }

        // Merge near-collinear sides (< 15° between them) into one logical side
        const sides = [{ ...rawSides[0], lastAngle: rawSides[0].angle }];
        for (let i = 1; i < rawSides.length; i++) {
          const prev = sides[sides.length - 1];
          // Normalize angle difference to [0, 180°]
          let ad = Math.abs(prev.lastAngle - rawSides[i].angle);
          while (ad > Math.PI) ad -= Math.PI;
          const na = Math.min(ad, Math.PI - ad) * 180 / Math.PI;
          if (na < 15) {
            prev.len += rawSides[i].len;
            prev.lastAngle = rawSides[i].angle;
          } else {
            sides.push({ ...rawSides[i], lastAngle: rawSides[i].angle });
          }
        }

        // Count right angles (with fixed normalization)
        let rightAngleCount = 0;
        for (let i = 0; i < sides.length; i++) {
          const nxt = (i + 1) % sides.length;
          let ad = Math.abs(sides[i].angle - sides[nxt].angle);
          while (ad > Math.PI) ad -= Math.PI;
          const na = Math.min(ad, Math.PI - ad) * 180 / Math.PI;
          if (na > 70 && na < 110) rightAngleCount++;
        }

        const numSides = sides.filter(s => s.len > 2).length;

        // Regular rectangle (4 sides, 4 right angles) → NOT corner
        if (numSides <= 4 && rightAngleCount >= 3) {
          isCorner = false;
        } else if (numSides >= 5) {
          // 5+ sides: look for chamfer pattern (truncated corner at intersection)
          // Requirements:
          //   - Two LONG sides (>15m each, road frontages)
          //   - At roughly 90° to each other (60-120°)
          //   - Separated by exactly 1 short side (the chamfer, <12m)
          //   - Chamfer angle is 30-60° (classic 45° truncation)
          for (let i = 0; i < sides.length && !isCorner; i++) {
            const prev = sides[(i - 1 + sides.length) % sides.length];
            const curr = sides[i];
            const nxt = sides[(i + 1) % sides.length];
            
            if (curr.len > 12) continue;
            if (prev.len < 15 || nxt.len < 15) continue;
            
            let ad1 = Math.abs(prev.angle - curr.angle);
            while (ad1 > Math.PI) ad1 -= Math.PI;
            const na1 = Math.min(ad1, Math.PI - ad1) * 180 / Math.PI;
            let ad2 = Math.abs(curr.angle - nxt.angle);
            while (ad2 > Math.PI) ad2 -= Math.PI;
            const na2 = Math.min(ad2, Math.PI - ad2) * 180 / Math.PI;
            
            if (na1 > 30 && na1 < 60 && na2 > 30 && na2 < 60) {
              isCorner = true;
              cornerSource = "geometry";
            }
          }
        }
      }
    }
    } // end: geometry fallback (priority 3)

    setSightPhase("offset_road");
    setSightConfig(c => ({ ...c, isCorner, cornerSource, crossoverRoad, constrainedSide, crossoverWidth, leftBoundaryDist, rightBoundaryDist, leftBoundaryFeature, rightBoundaryFeature, y: autoY }));
    setOffsetState(s => ({ ...s, x: 2.5, y: autoY, isCorner: false, cornerR: null, cornerV: null }));

    // ── AUTO-DRAW: compute Point A and B from known data ──
    const missing = [];
    if (!crossoverRoad) missing.push("crossover road");
    // Use constrained side distance, or fall back to whichever boundary distance exists
    let autoDrawBoundaryDist = null;
    if (constrainedSide === "left" && leftBoundaryDist != null) {
      autoDrawBoundaryDist = leftBoundaryDist;
    } else if (constrainedSide === "right" && rightBoundaryDist != null) {
      autoDrawBoundaryDist = rightBoundaryDist;
    } else if (leftBoundaryDist != null && rightBoundaryDist != null) {
      autoDrawBoundaryDist = Math.min(leftBoundaryDist, rightBoundaryDist);
      if (!constrainedSide) constrainedSide = leftBoundaryDist <= rightBoundaryDist ? "left" : "right";
    } else if (leftBoundaryDist != null) {
      autoDrawBoundaryDist = leftBoundaryDist;
      if (!constrainedSide) constrainedSide = "left";
    } else if (rightBoundaryDist != null) {
      autoDrawBoundaryDist = rightBoundaryDist;
      if (!constrainedSide) constrainedSide = "right";
    }
    if (autoDrawBoundaryDist == null) missing.push("boundary distance");
    if (!crossoverWidth) missing.push("crossover width");
    if (!lotPoly || lotPoly.length < 4) missing.push("lot polygon");

    const hasRoadData = [speedRoadsData, roadNetworkData].some(s => s?.features?.length > 0);
    if (!hasRoadData) missing.push("road data");

    console.log("Auto-draw check:", { crossoverRoad, constrainedSide, autoDrawBoundaryDist, crossoverWidth, lotPolyLen: lotPoly?.length, hasRoadData, missing, autoY });

    if (missing.length === 0) {
      const mPerLat = 111320, mPerLng = 111320 * Math.cos(lotPoly[0][0] * Math.PI / 180);

      // 1. Find the lot edge nearest to the crossover road
      let bestEdge = null, bestDist = Infinity;
      for (let i = 0; i < lotPoly.length - 1; i++) {
        const midLat = (lotPoly[i][0] + lotPoly[i + 1][0]) / 2;
        const midLng = (lotPoly[i][1] + lotPoly[i + 1][1]) / 2;
        const edgeLen = Math.sqrt(((lotPoly[i][0] - lotPoly[i + 1][0]) * mPerLat) ** 2 + ((lotPoly[i][1] - lotPoly[i + 1][1]) * mPerLng) ** 2);
        if (edgeLen < 3) continue;
        for (const src of [speedRoadsData, roadNetworkData].filter(s => s?.features)) {
          for (const feat of src.features) {
            const rn = (feat.properties?.rd || feat.properties?.road_name || feat.properties?.ROAD_NAME || "").toUpperCase();
            const crUpper = crossoverRoad.toUpperCase(); const rnUpper = rn.toUpperCase(); if (!rnUpper || !(crUpper.includes(rnUpper.split(" ")[0]) || rnUpper.includes(crUpper.split(" ")[0]))) continue;
            const g = feat.geometry;
            if (!g || g.type !== "LineString") continue;
            for (const pt of g.coordinates) {
              const d = Math.sqrt(((midLat - pt[1]) * mPerLat) ** 2 + ((midLng - pt[0]) * mPerLng) ** 2);
              if (d < bestDist) { bestDist = d; bestEdge = { i, midLat, midLng, edgeLen, from: lotPoly[i], to: lotPoly[i + 1] }; }
            }
          }
        }
      }

      if (bestEdge && bestDist < 25) {
        // 2. Compute inward/outward normals from the road-facing edge
        const edgeDx = (bestEdge.to[1] - bestEdge.from[1]) * mPerLng;
        const edgeDy = (bestEdge.to[0] - bestEdge.from[0]) * mPerLat;
        const edgeAngle = Math.atan2(edgeDx, edgeDy);
        const lotCLat = lotPoly.reduce((s, p) => s + p[0], 0) / lotPoly.length;
        const lotCLng = lotPoly.reduce((s, p) => s + p[1], 0) / lotPoly.length;
        const n1 = edgeAngle + Math.PI / 2, n2 = edgeAngle - Math.PI / 2;
        const t1Lat = bestEdge.midLat + Math.cos(n1) * 5 / mPerLat;
        const t1Lng = bestEdge.midLng + Math.sin(n1) * 5 / mPerLng;
        const t2Lat = bestEdge.midLat + Math.cos(n2) * 5 / mPerLat;
        const t2Lng = bestEdge.midLng + Math.sin(n2) * 5 / mPerLng;
        const d1 = Math.sqrt(((t1Lat - lotCLat) * mPerLat) ** 2 + ((t1Lng - lotCLng) * mPerLng) ** 2);
        const d2 = Math.sqrt(((t2Lat - lotCLat) * mPerLat) ** 2 + ((t2Lng - lotCLng) * mPerLng) ** 2);
        const inward = d1 < d2 ? n1 : n2;
        const outward = d1 < d2 ? n2 : n1;

        // 3. Position along edge: y metres from constrained side
        const yOffset = autoY;
        const edgeFrac = Math.min(0.9, Math.max(0.1, yOffset / bestEdge.edgeLen));
        const ptOnEdgeLat = bestEdge.from[0] + (bestEdge.to[0] - bestEdge.from[0]) * edgeFrac;
        const ptOnEdgeLng = bestEdge.from[1] + (bestEdge.to[1] - bestEdge.from[1]) * edgeFrac;

        // 4. Point A = 2.5m inward from road edge
        const xOffset = 2.5;
        const autoPtA = {
          lat: ptOnEdgeLat + Math.cos(inward) * xOffset / mPerLat,
          lng: ptOnEdgeLng + Math.sin(inward) * xOffset / mPerLng,
        };

        // 5. Point B = project Point A onto nearest road centreline (perpendicular)
        let autoPtB = null, bestProjDist = Infinity;
        for (const src of [speedRoadsData, roadNetworkData].filter(s => s?.features)) {
          for (const feat of src.features) {
            const rn = (feat.properties?.rd || feat.properties?.road_name || feat.properties?.ROAD_NAME || "").toUpperCase();
            const crUpper = crossoverRoad.toUpperCase(); const rnUpper = rn.toUpperCase(); if (!rnUpper || !(crUpper.includes(rnUpper.split(" ")[0]) || rnUpper.includes(crUpper.split(" ")[0]))) continue;
            const g = feat.geometry;
            if (!g || g.type !== "LineString") continue;
            for (let j = 0; j < g.coordinates.length - 1; j++) {
              const aLat = g.coordinates[j][1], aLng = g.coordinates[j][0];
              const bLat = g.coordinates[j+1][1], bLng = g.coordinates[j+1][0];
              const dx = (bLng - aLng) * mPerLng, dy = (bLat - aLat) * mPerLat;
              const lenSq = dx * dx + dy * dy;
              if (lenSq < 1e-10) continue;
              const t = Math.max(0, Math.min(1, (((autoPtA.lng - aLng) * mPerLng * dx + (autoPtA.lat - aLat) * mPerLat * dy) / lenSq)));
              const projLat = aLat + t * (bLat - aLat);
              const projLng = aLng + t * (bLng - aLng);
              const dist = Math.sqrt(((autoPtA.lat - projLat) * mPerLat) ** 2 + ((autoPtA.lng - projLng) * mPerLng) ** 2);
              if (dist < bestProjDist) { bestProjDist = dist; autoPtB = { lat: projLat, lng: projLng }; }
            }
          }
        }

        if (autoPtB && bestProjDist < 30) {
          // Auto-draw: set points — triangle useEffect fires automatically
          setPtA(autoPtA);
          setPtB(autoPtB);
          setSightPhase("complete");
          setDrawMode(null);
          setMapTool(null);
          setSightConfig(c => ({ ...c, autoDrawn: true }));
          console.log(`Auto-drew triangle: road=${crossoverRoad}, x=${xOffset}m, y=${yOffset.toFixed(1)}m, constrained=${constrainedSide}`);
          return;
        }
      }
      // If road edge found but projection failed, add to missing
      if (!bestEdge || bestDist >= 25) missing.push("road not near lot");
    }

    // ── FALLBACK: manual mode with missing data info ──
    setSightConfig(c => ({ ...c, missingData: missing.length > 0 ? missing : null, autoDrawn: false }));
    setOffsetState({ step: 0, road: null, boundary: null, x: 2.5, y: autoY, isCorner: false, cornerR: null, cornerV: null });
    setMapTool("offset");
  };

  // Clicked lot from map
  const [clickedLot, setClickedLot] = useState(null);
  const handleLotClick = useCallback((lotInfo) => {
    if (drawMode) return;
    const poly = lotInfo.polygon;
    if (!poly || poly.length < 3) return;
    // Just store the lot info for boundary highlighting — no rules panel
    setClickedLot(prev => prev?.address === lotInfo.address ? null : lotInfo);
  }, [drawMode]);

  // Escape key exits fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const handleKey = (e) => { if (e.key === "Escape") setIsFullscreen(false); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isFullscreen]);

  const fullscreenContainerStyle = isFullscreen ? {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
    background: "#fff", display: "flex", flexDirection: "column", overflow: "auto",
  } : {};

  const mapHeight = isFullscreen ? "calc(100vh - 52px)" : 520;

  return (
    <div style={fullscreenContainerStyle}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: isFullscreen ? "5px 12px" : "0 0 4px", background: isFullscreen ? "#f8fafb" : "transparent", borderBottom: isFullscreen ? "1px solid #e4e9ec" : "none", flexWrap: "wrap", gap: 3 }}>
        {/* Left: Layers dropdown + tools */}
        <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
          <div style={{ position: "relative" }}>
            <button onClick={() => setShowLayerPanel(!showLayerPanel)}
              style={{ padding: "3px 8px", borderRadius: 4, border: showLayerPanel ? "1.5px solid #1a3a4a" : "1px solid #dce1e6", background: showLayerPanel ? "#1a3a4a" : "#fff", color: showLayerPanel ? "#fff" : "#5a6a74", fontWeight: T.w.bold, fontSize: 9, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 3 }}>
              🗂️ Layers <span style={{ fontSize: 7, opacity: 0.7 }}>▼</span>
            </button>
            {showLayerPanel && (
              <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 2, zIndex: 1000, background: "#fff", borderRadius: 8, border: "1px solid #e4e9ec", boxShadow: "0 8px 24px rgba(0,0,0,0.15)", minWidth: 220, padding: "6px 0" }}
                onMouseLeave={() => setShowLayerPanel(false)}>
                <div style={{ padding: "4px 12px 6px", fontSize: 9, fontWeight: T.w.bold, color: T.c.textSecondary, textTransform: "uppercase", borderBottom: "1px solid #f0f3f5" }}>Map Layers</div>
                {[
                  { key: "lots", state: showLots, set: () => setShowLots(!showLots), label: "Lot Boundaries", icon: "🏠", color: "#2980b9", data: lotsData },
                  { key: "speed", state: showSpeedRoads, set: () => setShowSpeedRoads(!showSpeedRoads), label: "Speed Limits", icon: "⚡", color: "#e67e22", data: speedRoadsData },
                  { key: "streets", state: showStreetNames, set: () => setShowStreetNames(!showStreetNames), label: "Street Names", icon: "🛣️", color: "#16a085", data: roadNetworkData },
                  { key: "contours", state: showContours, set: () => setShowContours(!showContours), label: "2m Contours", icon: "⛰️", color: "#854F0B", data: contoursData },
                  { key: "urban", state: showUrbanForest, set: () => setShowUrbanForest(!showUrbanForest), label: "Urban Forest", icon: "🌳", color: "#27ae60", data: null },
                  { key: "dpipes", state: showDrainagePipes, set: () => setShowDrainagePipes(!showDrainagePipes), label: "Drainage Pipes", icon: "💧", color: "#2980b9", data: null },
                  { key: "dpits", state: showDrainagePits, set: () => setShowDrainagePits(!showDrainagePits), label: "Drainage Pits", icon: "🕳️", color: "#8e44ad", data: null },
                  { key: "water", state: showWaterPipes, set: () => setShowWaterPipes(!showWaterPipes), label: "Water Pipes", icon: "🚰", color: T.c.info, data: null },
                ].map(l => (
                  <div key={l.key} onClick={l.set}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px", cursor: "pointer", fontSize: 11, transition: "background 0.1s" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#f8fafb"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <div style={{ width: 16, height: 16, borderRadius: 3, border: l.state ? `2px solid ${l.color}` : "1.5px solid #d5dde2", background: l.state ? `${l.color}20` : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {l.state && <span style={{ fontSize: 10, color: l.color, fontWeight: T.w.bold }}>✓</span>}
                    </div>
                    <span style={{ fontSize: 12 }}>{l.icon}</span>
                    <span style={{ flex: 1, fontWeight: l.state ? 600 : 400, color: l.state ? l.color : "#5a6a74" }}>{l.label}</span>
                    {l.data === null && !["urban", "dpipes", "dpits", "water"].includes(l.key) && <span style={{ fontSize: 8, color: "#c0392b", fontWeight: T.w.semi }}>no data</span>}
                  </div>
                ))}
                {(app?.site_lot_boundary_latlon || app?.site_building_boundary_latlon || app?.site_crossover_latlon || app?.site_lot_boundary) && (
                  <>
                    <div style={{ height: 1, background: T.c.borderLight, margin: "4px 0" }} />
                    <div onClick={() => setShowBoundaries(!showBoundaries)}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px", cursor: "pointer", fontSize: 11 }}
                      onMouseEnter={e => e.currentTarget.style.background = "#f8fafb"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <div style={{ width: 16, height: 16, borderRadius: 3, border: showBoundaries ? "2px solid #8e44ad" : "1.5px solid #d5dde2", background: showBoundaries ? "#8e44ad20" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {showBoundaries && <span style={{ fontSize: 10, color: "#8e44ad", fontWeight: T.w.bold }}>✓</span>}
                      </div>
                      <span style={{ fontSize: 12 }}>📐</span>
                      <span style={{ flex: 1, fontWeight: showBoundaries ? 600 : 400, color: showBoundaries ? "#8e44ad" : "#5a6a74" }}>Site Boundaries</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          <div style={{ width: 1, height: 16, background: "#e4e9ec", margin: "0 2px" }} />
          {/* Map tools */}
          {[
            { key: "measure", label: "Measure", color: T.c.info },
            { key: "draw", label: "Annotate", color: "#6c5ce7" },
          ].map(t => (
            <button key={t.key} onClick={() => setMapTool(mapTool === t.key ? null : t.key)}
              style={{ padding: "3px 7px", borderRadius: 4, border: mapTool === t.key ? `1.5px solid ${t.color}` : "1px solid #dce1e6", background: mapTool === t.key ? `${t.color}10` : "#fff", color: mapTool === t.key ? t.color : T.c.grey600, fontWeight: T.w.semi, fontSize: 9, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s" }}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
          <button onClick={() => setMapTool("zoomProperty")} title="Zoom to property"
            style={{ padding: "3px 7px", borderRadius: 4, border: "1px solid #dce1e6", background: "#fff", color: T.c.textSecondary, fontWeight: T.w.semi, fontSize: 9, cursor: "pointer", fontFamily: "inherit" }}>🎯 Property</button>
          <button onClick={() => setMapTool("zoomExtent")} title="Zoom to full extent"
            style={{ padding: "3px 7px", borderRadius: 4, border: "1px solid #dce1e6", background: "#fff", color: T.c.textSecondary, fontWeight: T.w.semi, fontSize: 9, cursor: "pointer", fontFamily: "inherit" }}>🗺️ Extent</button>
          <button onClick={() => setMapTool("print")} title="Export as image"
            style={{ padding: "3px 7px", borderRadius: 4, border: "1px solid #dce1e6", background: "#fff", color: T.c.textSecondary, fontWeight: T.w.semi, fontSize: 9, cursor: "pointer", fontFamily: "inherit" }}>🖨️ Print</button>
          <button onClick={() => setIsFullscreen(!isFullscreen)}
            style={{ padding: "3px 7px", borderRadius: 4, border: isFullscreen ? "1.5px solid #1a3a4a" : "1px solid #dce1e6", background: isFullscreen ? "#1a3a4a" : "#fff", color: isFullscreen ? "#fff" : T.c.grey600, fontWeight: T.w.semi, fontSize: 9, cursor: "pointer", fontFamily: "inherit" }}>
            {isFullscreen ? "✕" : "⛶"}
          </button>
        </div>
      </div>
      {/* ═══ Sight Analysis ═══ */}
      {(sightPhase || sightTriangle || drawMode) ? (
        <div style={{ background: "linear-gradient(180deg, #f0f2f5 0%, #f8f9fb 100%)", borderBottom: "2px solid #1a3a4a20", padding: "8px 14px" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
            <div style={{ width: 3, height: 22, borderRadius: 2, background: sightTriangle ? "#27ae60" : "#1a3a4a" }} />
            <span style={{ fontSize: 12, fontWeight: T.w.black, color: T.c.text, letterSpacing: -0.3 }}>Sight Analysis</span>
            {sightConfig.crossoverRoad && <span style={{ fontSize: 9, background: "#E3F2FD", color: "#1565C0", padding: "2px 6px", borderRadius: 3, fontWeight: T.w.bold }}>🛣️ {sightConfig.crossoverRoad}</span>}
            {sightConfig.isCorner && <span style={{ fontSize: 8, background: "#e65100", color: "#fff", padding: "2px 6px", borderRadius: 3, fontWeight: T.w.bold, letterSpacing: 0.5, textTransform: "uppercase" }}>Corner Lot</span>}
            {sightConfig.constrainedSide && <span style={{ fontSize: 8, background: "#FFF3E0", color: "#E65100", padding: "2px 6px", borderRadius: 3, fontWeight: T.w.bold }}>⚠ {sightConfig.constrainedSide} side</span>}
            {!sightConfig.crossoverRoad && !sightTriangle && !sightConfig.missingData && <span style={{ fontSize: 8, background: "#FFF8E1", color: "#F57F17", padding: "2px 6px", borderRadius: 3, fontWeight: T.w.semi }}>⚠ No site plan data — set x, y manually</span>}
            {sightConfig.missingData && (
              <span style={{ fontSize: 8, background: "#FFF8E1", color: "#F57F17", padding: "2px 6px", borderRadius: 3, fontWeight: T.w.semi }}>⚠ Missing: {sightConfig.missingData.join(", ")}</span>
            )}
            {sightConfig.autoDrawn && <span style={{ fontSize: 8, background: "#E8F5E9", color: "#2E7D32", padding: "2px 6px", borderRadius: 3, fontWeight: T.w.semi }}>Auto-drawn</span>}
            {sightConfig.isCorner && sightConfig.cornerSource && <span style={{ fontSize: 7, color: T.c.grey600, fontStyle: "italic" }}>{sightConfig.cornerSource === "ai_corrected" ? "officer verified" : sightConfig.cornerSource === "ai_original" ? "AI detected" : "auto-detected"}</span>}
            <div style={{ flex: 1 }} />
            {sightTriangle && !drawMode && !analysisRunning && (
              <>
                <button onClick={run3DSightAnalysis} style={{ padding: "4px 10px", borderRadius: 5, border: "none", background: "linear-gradient(135deg, #6c3483, #8e44ad)", color: "#fff", fontWeight: T.w.bold, fontSize: 9, cursor: "pointer", boxShadow: "0 1px 3px rgba(108,52,131,0.3)" }}>3D Analysis</button>
                {sightConfig.isCorner && !sightConfig.cornerR && (
                  <button onClick={() => { setSightPhase("corner_draw"); setMapTool("radius"); }}
                    style={{ padding: "4px 10px", borderRadius: 5, border: "1.5px solid #e65100", background: "#fff", color: "#e65100", fontWeight: T.w.bold, fontSize: 9, cursor: "pointer" }}>🔄 Add Curve</button>
                )}
                {sightConfig.autoDrawn && (
                  <button onClick={() => { resetTriangle(); setSightConfig(c => ({ ...c, autoDrawn: false, missingData: null })); setOffsetState({ step: 0, road: null, boundary: null, x: 2.5, y: sightConfig.y || 4.0, isCorner: false, cornerR: null, cornerV: null }); setMapTool("offset"); setSightPhase("offset_road"); }}
                    style={{ padding: "4px 10px", borderRadius: 5, border: "1px solid #7a8a94", background: "#fff", color: T.c.textSecondary, fontWeight: T.w.bold, fontSize: 9, cursor: "pointer" }}>Manual</button>
                )}
              </>
            )}
            {analysisRunning && <span style={{ fontSize: 9, fontWeight: T.w.bold, color: "#8e44ad", background: "#f4ecf7", padding: "3px 8px", borderRadius: 4 }}>Analysing...</span>}
            <button onClick={resetTriangle} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid #dce1e6", background: "#fff", color: T.c.grey600, fontSize: 9, fontWeight: T.w.semi, cursor: "pointer" }}>Reset</button>
          </div>
          {/* Step cards */}
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            {sightConfig.isCorner && (
              <div style={{ flex: 1, padding: "6px 10px", borderRadius: 6, background: sightConfig.cornerR ? "#fff" : sightPhase === "corner_draw" ? "#fff" : "#f5f5f5",
                border: sightConfig.cornerR ? "1.5px solid #27ae60" : sightPhase === "corner_draw" ? "1.5px solid #e65100" : "1px solid #e4e9ec",
                opacity: sightConfig.cornerR || sightPhase === "corner_draw" ? 1 : 0.5 }}>
                <div style={{ fontSize: 8, fontWeight: T.w.bold, color: T.c.textSecondary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Road Curve</div>
                {sightConfig.cornerR ? (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: T.w.black, color: "#27ae60" }}>R = {sightConfig.cornerR.toFixed(1)}m</div>
                    <div style={{ fontSize: 9, color: "#e65100", fontWeight: T.w.semi }}>Sight dist = {sightConfig.cornerV.toFixed(1)}m</div>
                  </div>
                ) : (
                  <div style={{ fontSize: 10, color: "#e65100", fontWeight: T.w.semi }}>Draw curve</div>
                )}
              </div>
            )}
            <div style={{ flex: 1, padding: "6px 10px", borderRadius: 6, background: sightTriangle ? "#fff" : (sightPhase === "offset_road" || sightPhase === "offset_boundary") ? "#fff" : "#f5f5f5",
              border: sightTriangle ? "1.5px solid #27ae60" : (sightPhase === "offset_road" || sightPhase === "offset_boundary") ? "1.5px solid #2e7d32" : "1px solid #e4e9ec",
              opacity: sightTriangle || sightPhase === "offset_road" || sightPhase === "offset_boundary" ? 1 : 0.5 }}>
              <div style={{ fontSize: 8, fontWeight: T.w.bold, color: T.c.textSecondary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Point A Location</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 10 }}>
                  <span style={{ color: "#5a6a74", fontWeight: T.w.semi }}>x</span>
                  <input type="number" value={sightConfig.x} onChange={e => { const v = parseFloat(e.target.value)||0; setSightConfig(c => ({...c, x: v})); setOffsetState(s => ({...s, x: v})); }} step="0.5" min="0"
                    style={{ width: 34, padding: "2px 3px", borderRadius: 4, border: "1px solid #dce1e6", fontSize: 10, fontWeight: T.w.black, textAlign: "center", color: T.c.text }} />
                  <span style={{ color: T.c.grey600, fontSize: 8 }}>kerb</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 10 }}>
                  <span style={{ color: "#5a6a74", fontWeight: T.w.semi }}>y</span>
                  <input type="number" value={sightConfig.y} onChange={e => { const v = parseFloat(e.target.value)||0; setSightConfig(c => ({...c, y: v})); setOffsetState(s => ({...s, y: v})); }} step="0.5" min="0"
                    style={{ width: 34, padding: "2px 3px", borderRadius: 4, border: "1px solid #dce1e6", fontSize: 10, fontWeight: T.w.black, textAlign: "center", color: T.c.text }} />
                  <span style={{ color: T.c.grey600, fontSize: 8 }}>side</span>
                </div>
              </div>
              {(sightConfig.leftBoundaryDist != null || sightConfig.rightBoundaryDist != null) ? (
                <div style={{ marginTop: 3, fontSize: 8, color: T.c.textSecondary, lineHeight: 1.4 }}>
                  {sightConfig.leftBoundaryDist != null && <div>L: {sightConfig.leftBoundaryDist.toFixed(1)}m{sightConfig.leftBoundaryFeature ? ` — ${sightConfig.leftBoundaryFeature}` : ''}</div>}
                  {sightConfig.rightBoundaryDist != null && <div>R: {sightConfig.rightBoundaryDist.toFixed(1)}m{sightConfig.rightBoundaryFeature ? ` — ${sightConfig.rightBoundaryFeature}` : ''}</div>}
                  {sightConfig.crossoverWidth && <div>Width: {sightConfig.crossoverWidth.toFixed(1)}m</div>}
                  {sightConfig.constrainedSide && sightConfig.crossoverWidth && (
                    <div style={{ color: "#E65100", fontWeight: T.w.semi, marginTop: 1 }}>y = {(sightConfig.constrainedSide === "left" ? sightConfig.leftBoundaryDist : sightConfig.rightBoundaryDist)?.toFixed(1)} + {(0.5 * sightConfig.crossoverWidth).toFixed(1)} = {sightConfig.y.toFixed(1)}m</div>
                  )}
                </div>
              ) : (
                <div style={{ marginTop: 3, fontSize: 8, color: "#F57F17", lineHeight: 1.4 }}>
                  x = distance from kerb (default 2.5m)<br/>
                  y = boundary setback + ½ crossover width
                </div>
              )}
            </div>
            <div style={{ flex: 1, padding: "6px 10px", borderRadius: 6, background: sightTriangle ? "#fff" : "#f5f5f5",
              border: sightTriangle ? "1.5px solid #283593" : "1px solid #e4e9ec", opacity: sightTriangle ? 1 : 0.5 }}>
              <div style={{ fontSize: 8, fontWeight: T.w.bold, color: T.c.textSecondary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Sight Area</div>
              {sightTriangle ? (
                <div style={{ fontSize: 9, fontWeight: T.w.semi, color: "#283593" }}>
                  <div><span style={{ fontWeight: T.w.black }}>{Math.round(sightTriangle.speedInfo?.detected)}km/h</span> <span style={{ color: T.c.textSecondary }}>speed</span></div>
                  <div style={{ fontSize: 8, color: "#5a6a74" }}>{sightTriangle.analysis?.leftDist}m + {sightTriangle.analysis?.rightDist}m = {sightTriangle.analysis?.baseWidth}m base</div>
                  {sightConfig.cornerR && <div style={{ fontSize: 8, color: "#e65100" }}>Sight dist: {sightConfig.cornerV?.toFixed(1)}m</div>}
                </div>
              ) : (
                <div style={{ fontSize: 10, color: "#c0c5ca" }}>Auto-drawn</div>
              )}
            </div>

            {/* Observer/Object heights */}
            <div style={{ padding: "6px 10px", borderRadius: 6, background: "#fff", border: "1px solid #e4e9ec" }}>
              <div style={{ fontSize: 8, fontWeight: T.w.bold, color: T.c.textSecondary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Heights</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 10 }}>
                  <span style={{ color: "#e74c3c", fontWeight: T.w.bold }}>👁</span>
                  <input type="number" value={eyeHeight} onChange={e => setEyeHeight(parseFloat(e.target.value) || 0)} min="0" max="5" step="0.05"
                    style={{ width: 38, padding: "2px 3px", borderRadius: 4, border: "1px solid #dce1e6", fontSize: 10, fontWeight: T.w.black, textAlign: "center", color: T.c.text }} />
                  <span style={{ color: T.c.grey600, fontSize: 8 }}>m</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 10 }}>
                  <span style={{ color: "#2980b9", fontWeight: T.w.bold }}>◎</span>
                  <input type="number" value={objectHeight} onChange={e => setObjectHeight(parseFloat(e.target.value) || 0)} min="0" max="5" step="0.05"
                    style={{ width: 38, padding: "2px 3px", borderRadius: 4, border: "1px solid #dce1e6", fontSize: 10, fontWeight: T.w.black, textAlign: "center", color: T.c.text }} />
                  <span style={{ color: T.c.grey600, fontSize: 8 }}>m</span>
                </div>
              </div>
            </div>
          </div>
          {/* Instruction */}
          <div style={{ fontSize: 10, color: "#5a6a74", fontWeight: 500, padding: "3px 0", borderTop: "1px solid #e8eaed" }}>
            {sightPhase === "corner_draw" && !sightConfig.cornerR && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#e65100", animation: "pulse 1.5s infinite" }} />
                <span>Click 3+ points along the <b>kerb return curve</b></span>
                {radiusResult && <span style={{ fontSize: 9, background: "#ff9800", color: "#fff", padding: "1px 6px", borderRadius: 10, fontWeight: T.w.bold }}>{radiusResult.split('·')[0].trim()}</span>}
                {radiusResult && (
                  <button onClick={() => { if (radiusDoneRef.current) radiusDoneRef.current(); }}
                    style={{ padding: "3px 10px", borderRadius: 4, border: "none", background: "#27ae60", color: "#fff", fontSize: 9, fontWeight: T.w.bold, cursor: "pointer" }}>Done ✓</button>
                )}
                {radiusResult && (
                  <button onClick={() => { if (radiusClearRef.current) radiusClearRef.current(); setRadiusResult(null); }}
                    style={{ padding: "2px 8px", borderRadius: 4, border: "1px solid #dce1e6", background: "#fff", color: "#e65100", fontSize: 9, fontWeight: T.w.semi, cursor: "pointer" }}>Clear</button>
                )}
                <button onClick={() => { setSightPhase("offset_road"); setSightConfig(c => ({...c, isCorner: false})); setOffsetState({ step: 0, road: null, boundary: null, x: sightConfig.x, y: sightConfig.y, isCorner: false, cornerR: null, cornerV: null }); setMapTool("offset"); }} style={{ padding: "2px 8px", borderRadius: 4, border: "1px solid #dce1e6", background: "#fff", color: T.c.grey600, fontSize: 9, fontWeight: T.w.semi, cursor: "pointer" }}>Skip</button>
              </div>
            )}
            {sightPhase === "corner_draw" && sightConfig.cornerR && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#27ae60" }} />
                <span style={{ color: "#2e7d32" }}>Curve captured — now click the <b>road edge</b></span>
              </div>
            )}
            {sightPhase === "offset_road" && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#2e7d32", animation: "pulse 1.5s infinite" }} />
                <span>Click on the <b>road edge</b> near the driveway</span>
              </div>
            )}
            {sightPhase === "offset_boundary" && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#2e7d32", animation: "pulse 1.5s infinite" }} />
                <span>Click on the <b>property boundary/fence</b></span>
              </div>
            )}
            {sightPhase === "complete" && sightTriangle && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#283593" }} />
                <span style={{ color: "#283593" }}>Complete — adjust Verge/Fence to recalculate</span>
              </div>
            )}
            {drawMode === "ptA" && <span>Manual — click the <b>driveway location</b> (Point A)</span>}
            {drawMode === "ptB" && <span>Manual — click the <b>road centreline</b> (Point B)</span>}
          </div>
        </div>
      ) : (
        <div style={{ padding: "6px 14px", borderBottom: "1px solid #e4e9ec", display: "flex", gap: 4, alignItems: "center" }}>
          <button onClick={startSightAnalysis} style={{ padding: "5px 14px", borderRadius: 6, border: "none", background: "linear-gradient(135deg, #1a3a4a, #2c3e50)", color: "#fff", fontWeight: T.w.bold, fontSize: 10, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 1px 4px rgba(26,58,74,0.25)" }}>Sight Analysis</button>
          <button onClick={startDraw} style={{ padding: "5px 14px", borderRadius: 6, border: "1px solid #dce1e6", background: "#fff", color: T.c.grey600, fontWeight: T.w.semi, fontSize: 9, cursor: "pointer", fontFamily: "inherit" }}>Manual sight location</button>
        </div>
      )}
      {/* Tool context bar */}
      {mapTool === "measure" && (
        <div style={{ padding: "4px 12px", background: "#f0f7ff", borderBottom: "1px solid #d5e8f0", fontSize: 10, color: T.c.info, fontWeight: T.w.semi, display: "flex", alignItems: "center", gap: 8 }}>
          <span>Click to measure distance · Double-click to start new</span>
          {measureDist && <span style={{ background: "#3498db", color: "#fff", padding: "1px 8px", borderRadius: 10, fontWeight: T.w.bold, fontSize: 9 }}>{measureDist}</span>}
          <button onClick={() => { setMapTool(null); setMeasureDist(null); }} style={{ marginLeft: "auto", padding: "2px 8px", borderRadius: 4, border: "1px solid #3498db30", background: "#fff", color: T.c.info, fontSize: 9, fontWeight: T.w.semi, cursor: "pointer" }}>Done</button>
        </div>
      )}
      {mapTool === "draw" && (
        <div style={{ padding: "4px 12px", background: "#f5f0ff", borderBottom: "1px solid #e0d5f0", fontSize: 10, color: "#6c5ce7", fontWeight: T.w.semi, display: "flex", alignItems: "center", gap: 8 }}>
          <span>Click to annotate · Double-click to break line · Right-click for label</span>
          <button onClick={() => setMapTool("clearDraw")} style={{ padding: "2px 8px", borderRadius: 4, border: "1px solid #6c5ce730", background: "#fff", color: "#6c5ce7", fontSize: 9, fontWeight: T.w.semi, cursor: "pointer" }}>Clear</button>
          <button onClick={() => setMapTool(null)} style={{ marginLeft: "auto", padding: "2px 8px", borderRadius: 4, border: "1px solid #6c5ce730", background: "#fff", color: "#6c5ce7", fontSize: 9, fontWeight: T.w.semi, cursor: "pointer" }}>Done</button>
        </div>
      )}

      {/* Map */}
      <LeafletMap apps={apps} selectedApp={app} onSelectApp={onSelectApp} height={mapHeight}
        drawMode={drawMode} onMapClick={handleMapClick} sightTriangle={sightTriangle}
        showLots={showLots} lotsData={lotsData} showSpeedRoads={showSpeedRoads} speedRoadsData={speedRoadsData}
        showStreetNames={showStreetNames} roadNetworkData={roadNetworkData}
        onLotClick={handleLotClick} allLotsData={lotsData} clickedLot={clickedLot} analysisResult={analysisResult}
        forceLayer={null}
        showBoundaries={showBoundaries}
        boundaryData={{
          lot: app?.site_lot_boundary_latlon || app?.lot_polygon || null,
          building: app?.site_building_boundary_latlon || null,
          crossover: app?.site_crossover_latlon || null,
        }}
        waLayers={waLayers}
        showContours={showContours} contoursData={contoursData}
        showUrbanForest={showUrbanForest} urbanForestData={urbanForestData}
        showDrainagePipes={showDrainagePipes} drainagePipesData={drainagePipesData}
        showDrainagePits={showDrainagePits} drainagePitsData={drainagePitsData}
        showWaterPipes={showWaterPipes} waterPipesData={waterPipesData}
        mapTool={mapTool} setMapTool={setMapTool}
        measureDist={measureDist} setMeasureDist={setMeasureDist}
        radiusResult={radiusResult} setRadiusResult={setRadiusResult}
        onRadiusComplete={handleRadiusComplete}
        radiusDoneRef={radiusDoneRef}
        radiusClearRef={radiusClearRef}
        centrelineDist={centrelineDist} setCentrelineDist={setCentrelineDist}
        offsetState={offsetState} setOffsetState={setOffsetState}
        onOffsetComplete={(a, b, cornerSpeed) => { setPtA(a); setPtB(b); if (cornerSpeed) setCornerSpeed(cornerSpeed); setDrawMode(null); setSightPhase("complete"); setMapTool(null); }}
        onSightPointDrag={(point, latlng) => {
          if (point === 'A') setPtA(latlng);
          else if (point === 'B') setPtB(latlng);
        }} />

      {/* ═══ Sight Triangle Analysis Panel ═══ */}
      {sightTriangle && sightTriangle.analysis && (
        <div style={{ marginTop: 10, background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", overflow: "hidden" }}>
          {/* Compliance header */}
          {/* <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 10,
            background: sightTriangle.analysis.compliant ? "linear-gradient(135deg, #eafaf1, #d5f5e3)" : "linear-gradient(135deg, #fdedec, #fadbd8)",
            borderBottom: `2px solid ${sightTriangle.analysis.compliant ? "#27ae60" : "#e74c3c"}` }}>
            <span style={{ fontSize: 24 }}>{sightTriangle.analysis.compliant ? "✅" : "⚠️"}</span>
            <div>
              <div style={{ fontWeight: T.w.black, fontSize: 14, color: sightTriangle.analysis.compliant ? "#1e8449" : "#c0392b" }}>
                Sight Triangle — {sightTriangle.analysis.compliant ? "COMPLIANT" : "REVIEW REQUIRED"}
              </div>
              <div style={{ fontSize: 11, color: sightTriangle.analysis.compliant ? "#27ae60" : "#922b21" }}>
                {sightTriangle.speedInfo?.detected}km/h on {sightTriangle.speedInfo?.roadName || "—"} | Base: {sightTriangle.analysis.leftDist}m + {sightTriangle.analysis.rightDist}m = {sightTriangle.analysis.baseWidth}m
              </div>
            </div>
          </div> */}

          {/* Metrics */}
          {/* <div style={{ padding: "12px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { label: "SPEED", value: sightTriangle.speedInfo?.detected + " km/h", sub: sightTriangle.speedInfo?.roadName || "—", color: "#e67e22" },
              { label: "LEFT (abs)", value: sightTriangle.analysis.leftDist + "m", sub: sightTriangle.speedInfo?.absMin , color: "#2980b9" },
              { label: "RIGHT (ssd)", value: sightTriangle.analysis.rightDist + "m", sub: sightTriangle.speedInfo?.ssdMin , color: "#8e44ad" },
              { label: "BASE", value: sightTriangle.analysis.baseWidth + "m", sub: "Asymmetric", color: "#16a085" },
              { label: "DEPTH A→B", value: sightTriangle.analysis.depth + "m", sub: "Driveway → road", color: "#e74c3c" },
              { label: "AREA", value: sightTriangle.analysis.area + "m²", sub: "½ × base × depth", color: T.c.text },
            ].map(m => (
              <div key={m.label} style={{ flex: "1 1 85px", background: "#f8fafb", borderRadius: 8, padding: "8px 10px", minWidth: 85 }}>
                <div style={{ fontSize: 9, color: T.c.textSecondary, fontWeight: T.w.bold }}>{m.label}</div>
                <div style={{ fontSize: 18, fontWeight: T.w.black, color: m.color, lineHeight: 1.2 }}>{m.value}</div>
                <div style={{ fontSize: 9, color: T.c.textMuted }}>{m.sub}</div>
              </div>
            ))}
          </div> */}

          {/* Info panels */}
          {/* <div style={{ padding: "0 16px 12px" }}>
              <div style={{
                  width: "100%",
                  background: T.c.warningLight,
                  borderRadius: 8,
                  padding: "10px 14px",
                  border: "1px solid #f9e79f"
              }}>
                  <div style={{ fontSize: 10, fontWeight: T.w.bold, color: "#b8860b", marginBottom: 3 }}>
                      ▲ OBSTRUCTION 0.65–1.5m
                  </div>
                  <div style={{ fontSize: 12, color: "#7d6608", lineHeight: 1.5 }}>
                      No objects within triangle between 0.65–1.5m height.
                      {sightTriangle.analysis.nearestIntersection &&
                          parseFloat(sightTriangle.analysis.nearestIntersection.dist) < 30
                          ? ` ⚠ ${sightTriangle.analysis.nearestIntersection.name} within 30m.` 
                          : ""}
                  </div>
              </div>
          </div> */}

          {/* Reference table */}
          <div style={{ padding: "0 16px 10px" }}>
            <div style={{ fontSize: 9, fontWeight: T.w.bold, color: T.c.textSecondary, marginBottom: 4, textTransform: "uppercase" }}>Sight Distance Reference (Austroads / AS 2890.1)</div>
            <div style={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              {SIGHT_DISTANCE_TABLE.map(e => {
                const cur = e.speed === sightTriangle.speedInfo?.detected;
                return (
                  <div key={e.speed} style={{ padding: "3px 6px", borderRadius: 3, fontSize: 9, fontWeight: T.w.bold, textAlign: "center", minWidth: 55,
                    background: cur ? "#e74c3c" : "#f5f8fa", color: cur ? "#fff" : "#5a6a74", border: cur ? "2px solid #c0392b" : "1px solid #eef2f4" }}>
                    <div>{e.speed}km/h</div>
                    <div style={{ fontWeight: 400, fontSize: 8 }}>{e.abs_min/10}m | {e.ssd_min/10}m</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ padding: "0 16px 12px", fontSize: 9, color: "#b0bdb2" }}>
            AS 2890.1:2004 §3.2.4 | Eye 1.15m | Object 0.65–1.5m | Left = abs_min÷10 | Right = ssd_min÷10
          </div>
        </div>
      )}

      {/* ═══ Street View Sightlines ═══ */}
      {sightTriangle && sightTriangle.ptA && sightTriangle.ptB && (() => {
        const A = sightTriangle.ptA;
        const B = sightTriangle.ptB;
        const C = sightTriangle.triLeft;
        const D = sightTriangle.triRight;
        const csl = sightTriangle.cornerSightLine;
        const apiKey = "AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU17R8";
        const heading = (from, to) => Math.round(Math.atan2(to.lng - from.lng, to.lat - from.lat) * 180 / Math.PI);
        const midPt = (p1, p2) => ({ lat: (p1.lat+p2.lat)/2, lng: (p1.lng+p2.lng)/2 });

        // Build viewpoints
        const views = [];

        // 1. From curve sight point looking toward A (corner lot)
        if (csl) {
          views.push({ label: "Curve Sight Point → Driveway", loc: csl.to, lookAt: A, desc: "Driver approaching from curve" });
        }

        // 2. From A looking toward road
        views.push({ label: "Driveway (A) → Road", loc: A, lookAt: B, desc: "Driver at driveway looking at road" });

        // 3. From triangle left base looking toward A
        if (C) views.push({ label: "Left Sight Line → Driveway", loc: C, lookAt: A, desc: "Approaching from left" });

        // 4. From triangle right base looking toward A
        if (D) views.push({ label: "Right Sight Line → Driveway", loc: D, lookAt: A, desc: "Approaching from right" });

        // 5. Mid-base looking toward A
        if (C && D) {
          const mid = midPt(C, D);
          views.push({ label: "Road Centre → Driveway", loc: mid, lookAt: A, desc: "View from road centreline" });
        }

        return (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, fontWeight: T.w.black, color: T.c.text, marginBottom: 6, paddingLeft: 2 }}>Street View Sightlines</div>
            <div style={{ display: "grid", gridTemplateColumns: views.length <= 3 ? "1fr 1fr 1fr" : "1fr 1fr 1fr", gap: 8 }}>
              {views.map((v, i) => (
                <div key={i} style={{ background: "#fff", borderRadius: 8, border: "1px solid #e4e9ec", overflow: "hidden" }}>
                  <div style={{ padding: "5px 10px", borderBottom: "1px solid #eef2f4", fontSize: 9, fontWeight: T.w.bold, color: T.c.text }}>
                    {v.label}
                  </div>
                  <div style={{ height: 180 }}>
                    <iframe
                      src={`https://www.google.com/maps/embed/v1/streetview?key=${apiKey}&location=${v.loc.lat},${v.loc.lng}&heading=${heading(v.loc, v.lookAt)}&pitch=-5&fov=90`}
                      width="100%" height="180" style={{ border: "none" }}
                      allowFullScreen loading="lazy" referrerPolicy="no-referrer-when-downgrade"
                      title={v.label}
                    />
                  </div>
                  <div style={{ padding: "3px 10px", fontSize: 8, color: T.c.grey600, borderTop: "1px solid #eef2f4" }}>
                    {v.desc}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ═══ 3D Analysis Processing Steps ═══ */}
      {analysisRunning && analysisSteps.length > 0 && (
        <div style={{ marginTop: 10, background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", padding: "14px 16px" }}>
          <div style={{ fontSize: 10, fontWeight: T.w.bold, color: "#8e44ad", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>🔬 3D Sight Analysis Processing</div>
          {analysisSteps.map((step, i) => (
            <div key={i} style={{ padding: "2px 0", fontSize: 11, color: step.status === 'done' ? '#27ae60' : step.status === 'active' ? '#1a3a4a' : '#c8d0d4', fontWeight: step.status === 'active' ? 700 : 400, display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontSize: 10 }}>{step.status === 'done' ? '✓' : step.status === 'active' ? '◆' : '○'}</span>{step.text}
            </div>
          ))}
        </div>
      )}

      {/* ═══ 3D Analysis Results ═══ */}
      {analysisResult && !analysisRunning && (
        <div style={{ marginTop: 10, background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between",
            background: `linear-gradient(135deg, ${(ratingMap3D[analysisResult.ai?.overall_rating] || ratingMap3D.BLOCKED).bg}, #fff)`,
            borderBottom: `2px solid ${(ratingMap3D[analysisResult.ai?.overall_rating] || ratingMap3D.BLOCKED).color}` }}>
            <div>
              <div style={{ fontWeight: T.w.black, fontSize: 14, color: T.c.text }}>🔬 3D Sight-Line Analysis</div>
              <div style={{ fontSize: 10, color: "#5a6a74", marginTop: 2 }}>
                {sightTriangle?.speedInfo?.detected}km/h · {sightTriangle?.speedInfo?.roadName || '—'} | 👁 {analysisResult.eyeH}m | ◎ {analysisResult.tgtH}m | {analysisResult.mode === 'live' ? '● LIVE' : '○ Fallback'}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ padding: "5px 12px", borderRadius: 16, fontSize: 11, fontWeight: T.w.black, background: (ratingMap3D[analysisResult.ai?.overall_rating] || ratingMap3D.BLOCKED).bg, color: (ratingMap3D[analysisResult.ai?.overall_rating] || ratingMap3D.BLOCKED).color, border: `1px solid ${(ratingMap3D[analysisResult.ai?.overall_rating] || ratingMap3D.BLOCKED).color}40` }}>
                {(ratingMap3D[analysisResult.ai?.overall_rating] || ratingMap3D.BLOCKED).label}
              </span>
              <button onClick={reset3DAnalysis} style={{ background: "none", border: "none", fontSize: 14, cursor: "pointer", color: T.c.textMuted }}>✕</button>
            </div>
          </div>

          {/* Stats */}
          <div style={{ padding: "10px 16px", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[
              { label: "FEATURES", value: analysisResult.feats?.length || 0, color: "#2980b9" },
              { label: "OBSTRUCTIONS", value: analysisResult.obstructions?.length || 0, color: "#e74c3c" },
              { label: "VISIBILITY", value: (analysisResult.ai?.visibility_pct || 0) + "%", color: "#27ae60" },
              { label: "👁 OBSERVER", value: analysisResult.eyeH + "m", color: "#e74c3c" },
              { label: "◎ OBJECT", value: analysisResult.tgtH + "m", color: "#2980b9" },
              { label: "ELEV A", value: analysisResult.elevA?.toFixed(1) + "m", color: "#1abc9c" },
              { label: "ELEV C↔D", value: analysisResult.elevCD?.toFixed(1) + "m", color: "#e67e22" },
              { label: "Δ", value: ((analysisResult.elevA + analysisResult.eyeH - (analysisResult.elevCD || 0)) >= 0 ? '+' : '') + (analysisResult.elevA + analysisResult.eyeH - (analysisResult.elevCD || 0)).toFixed(1) + "m", color: "#8e44ad" },
            ].map(m => (
              <div key={m.label} style={{ flex: "1 1 70px", background: "#f8fafb", borderRadius: 6, padding: "6px 8px", minWidth: 68 }}>
                <div style={{ fontSize: 8, color: T.c.textSecondary, fontWeight: T.w.bold }}>{m.label}</div>
                <div style={{ fontSize: 14, fontWeight: T.w.black, color: m.color, lineHeight: 1.2 }}>{m.value}</div>
              </div>
            ))}
          </div>

          {/* Methodology note */}
          <div style={{ padding: "8px 16px", background: "#f8f9fb", borderBottom: "1px solid #eef2f4" }}>
            <div style={{ fontSize: 9, fontWeight: T.w.bold, color: T.c.textSecondary, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Analysis Methodology</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 9, color: "#5a6a74", lineHeight: 1.5 }}>
              {[
                { icon: "📡", label: "40 sight rays", desc: `from A to ${sightTriangle?.analysis?.baseWidth || '—'}m base (C→D), 25 samples each` },
                { icon: "⛰️", label: "Terrain DEM", desc: `${analysisResult.elevSource === "local_contour_2m" ? "Local LiDAR 2m contours" : analysisResult.elevSource === "slip_2m_contour" ? "SLIP LiDAR 2m contours" : analysisResult.elevSource === "open_meteo_30m" ? "Open-Meteo ~30m" : "Estimated"}, ${analysisResult.elevA?.toFixed(0) || '?'}m→${analysisResult.elevCD?.toFixed(0) || '?'}m ASL` },
                { icon: "🌳", label: `${analysisResult.feats?.length || 0} OSM features`, desc: "trees, fences, walls, buildings, hedges" },
                { icon: "👁", label: `Eye ${analysisResult.eyeH}m`, desc: `object ${analysisResult.tgtH}m above ground` },
                ...(analysisResult.cornerLineResult ? [{ icon: "↗️", label: "Corner sight line", desc: `A→curve point ${analysisResult.cornerLineResult.distance?.toFixed(0) || '?'}m, ${analysisResult.cornerLineResult.obstructions?.length || 0} obstructions` }] : []),
                { icon: "🛰️", label: "Street view", desc: "multi-angle imagery for AI classification" },
                { icon: "🤖", label: "AI Vision", desc: "AI analyses satellite + street view photos" },
              ].map((item, i) => (
                <div key={i} style={{ flex: "1 1 180px", display: "flex", gap: 4, alignItems: "flex-start", padding: "3px 6px", background: "#fff", borderRadius: 4, border: "1px solid #eef2f4" }}>
                  <span style={{ fontSize: 11 }}>{item.icon}</span>
                  <div>
                    <span style={{ fontWeight: T.w.bold, color: T.c.text }}>{item.label}</span>
                    <span style={{ color: T.c.textMuted, marginLeft: 3 }}>{item.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 1, borderBottom: "1px solid #e4e9ec", padding: "0 16px" }}>
            {[{ id: 'obstructions', label: '⚠ Obstruct.' }, { id: 'features', label: '▤ Features' }, { id: 'ai', label: '◈ AI' }].map(tab => (
              <button key={tab.id} onClick={() => setActiveAnalysisTab(tab.id)}
                style={{ padding: "6px 12px", background: "none", border: "none", borderBottom: activeAnalysisTab === tab.id ? "2px solid #8e44ad" : "2px solid transparent", color: activeAnalysisTab === tab.id ? "#8e44ad" : "#7a8a94", fontSize: 10, fontWeight: T.w.bold, cursor: "pointer", fontFamily: "inherit" }}>
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{ padding: "10px 16px", maxHeight: 260, overflowY: "auto" }}>
            {activeAnalysisTab === 'obstructions' && (
              analysisResult.obstructions?.length === 0
                ? <div style={{ textAlign: "center", color: "#27ae60", padding: 12, fontSize: 11, fontWeight: T.w.bold }}>Clear 3D line of sight ✓</div>
                : analysisResult.obstructions?.map((o, i) => {
                    const tc = { building: '#e07050', fence: '#f0c850', tree: '#00c090', wall: '#a090ff', hedge: '#50f0c0', terrain_ridge: '#ff4757' };
                    return (
                      <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid #f0f3f5", fontSize: 11 }}>
                        <div style={{ fontWeight: T.w.bold, color: tc[o.feature.type] || '#5a6a74' }}>{o.blockType === 'terrain' ? '▲ TERRAIN' : o.feature.type.toUpperCase()}: {o.feature.name}</div>
                        <div style={{ display: "flex", gap: 5, marginTop: 2, flexWrap: "wrap", fontSize: 10 }}>
                          <span style={{ padding: "1px 5px", borderRadius: 3, background: o.isCritical ? "#fdf2f2" : "#f5f8fa", color: o.isCritical ? "#e74c3c" : "#5a6a74", fontWeight: T.w.bold }}>{o.feature.estimatedHeight?.toFixed(1)}m</span>
                          <span style={{ color: T.c.textMuted }}>gnd {o.fGroundElev?.toFixed(1)}m</span>
                          <span style={{ color: T.c.textMuted }}>top {o.fTopAlt?.toFixed(1)}m</span>
                          <span style={{ color: "#e74c3c", fontWeight: T.w.bold }}>+{o.excessHeight?.toFixed(2)}m</span>
                          {o.isCritical && <span style={{ color: "#e74c3c", fontWeight: T.w.bold }}>⚠ 0.5-1.0m</span>}
                        </div>
                      </div>
                    );
                  })
            )}
            {activeAnalysisTab === 'features' && (
              <div>
                <div style={{ fontSize: 10, fontWeight: T.w.bold, color: T.c.textSecondary, marginBottom: 4 }}>{analysisResult.feats?.length || 0} Features</div>
                {(analysisResult.feats || []).slice(0, 25).map((f, i) => {
                  const tc = { building: '#e07050', fence: '#f0c850', tree: '#00c090', wall: '#a090ff', hedge: '#50f0c0', vegetation: '#00d0c8' };
                  return (
                    <div key={i} style={{ padding: "3px 0", borderBottom: "1px solid #f0f3f5", fontSize: 10 }}>
                      <span style={{ fontWeight: T.w.bold, color: tc[f.type] || '#5a6a74' }}>{f.type}</span>
                      <span style={{ color: T.c.textSecondary, marginLeft: 4 }}>{f.name}</span>
                      <span style={{ marginLeft: 4, padding: "1px 4px", borderRadius: 3, background: "#f5f8fa", color: "#5a6a74", fontWeight: T.w.bold }}>{f.estimatedHeight.toFixed(1)}m</span>
                      <span style={{ color: T.c.textMuted, marginLeft: 3 }}>gnd {f.groundElev?.toFixed(1)}m</span>
                    </div>
                  );
                })}
              </div>
            )}
            {activeAnalysisTab === 'ai' && analysisResult.ai && (
              <div>
                <div style={{ marginBottom: 8 }}>
                  <span style={{ padding: "3px 10px", borderRadius: 12, fontSize: 10, fontWeight: T.w.bold, background: (ratingMap3D[analysisResult.ai.overall_rating] || ratingMap3D.BLOCKED).bg, color: (ratingMap3D[analysisResult.ai.overall_rating] || ratingMap3D.BLOCKED).color }}>
                    {analysisResult.ai.overall_rating?.replace(/_/g, ' ')}
                  </span>
                  <span style={{ marginLeft: 8, fontSize: 10, color: T.c.textMuted }}>Visibility: {analysisResult.ai.visibility_pct}%</span>
                </div>
                <div style={{ fontSize: 11, lineHeight: 1.6, color: T.c.text, marginBottom: 10 }}>{analysisResult.ai.analysis_summary}</div>

                {/* Imagery-based findings */}
                {analysisResult.ai.satellite_findings && analysisResult.ai.satellite_findings !== "Imagery analysis unavailable — using geospatial data only." && (
                  <div style={{ background: T.c.infoLight, borderRadius: 8, padding: "8px 12px", marginBottom: 8, border: "1px solid #2980b920" }}>
                    <div style={{ fontSize: 9, fontWeight: T.w.black, color: "#2980b9", marginBottom: 3, textTransform: "uppercase" }}>🛰️ Satellite Imagery Analysis</div>
                    <div style={{ fontSize: 10, color: T.c.text, lineHeight: 1.6 }}>{analysisResult.ai.satellite_findings}</div>
                  </div>
                )}
                {analysisResult.ai.streetview_findings && analysisResult.ai.streetview_findings !== "Street view analysis unavailable." && (
                  <div style={{ background: "#fef5e7", borderRadius: 8, padding: "8px 12px", marginBottom: 8, border: "1px solid #e67e2220" }}>
                    <div style={{ fontSize: 9, fontWeight: T.w.black, color: "#e67e22", marginBottom: 3, textTransform: "uppercase" }}>🚗 Street View Analysis</div>
                    <div style={{ fontSize: 10, color: T.c.text, lineHeight: 1.6 }}>{analysisResult.ai.streetview_findings}</div>
                  </div>
                )}
                {analysisResult.ai.vegetation_assessment && (
                  <div style={{ background: T.c.successLight, borderRadius: 8, padding: "8px 12px", marginBottom: 8, border: "1px solid #27ae6020" }}>
                    <div style={{ fontSize: 9, fontWeight: T.w.black, color: "#27ae60", marginBottom: 3, textTransform: "uppercase" }}>🌳 Vegetation Assessment</div>
                    <div style={{ fontSize: 10, color: T.c.text, lineHeight: 1.6 }}>{analysisResult.ai.vegetation_assessment}</div>
                  </div>
                )}
                {analysisResult.ai.infrastructure_assessment && (
                  <div style={{ background: "#f4ecf7", borderRadius: 8, padding: "8px 12px", marginBottom: 8, border: "1px solid #8e44ad20" }}>
                    <div style={{ fontSize: 9, fontWeight: T.w.black, color: "#8e44ad", marginBottom: 3, textTransform: "uppercase" }}>🧱 Infrastructure Assessment</div>
                    <div style={{ fontSize: 10, color: T.c.text, lineHeight: 1.6 }}>{analysisResult.ai.infrastructure_assessment}</div>
                  </div>
                )}

                {/* AI-detected road crossings */}
                {analysisResult.ai.nearby_crossings?.length > 0 && (
                  <div style={{ background: T.c.dangerLight, borderRadius: 8, padding: "8px 12px", marginBottom: 8, border: "1px solid #e74c3c20" }}>
                    <div style={{ fontSize: 9, fontWeight: T.w.black, color: "#e74c3c", marginBottom: 6, textTransform: "uppercase" }}>🚦 Road Crossings & Junctions within 30m</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {analysisResult.ai.nearby_crossings.map((c, i) => {
                        const icons = { pedestrian_crossing: "🚶", intersection: "🔀", stop_sign: "🛑", give_way: "🔺", traffic_signals: "🚦", driveway: "🚗", roundabout: "🔄" };
                        const d = c.estimated_distance_m;
                        return (
                          <div key={i} style={{ flex: "1 1 140px", padding: "6px 10px", borderRadius: 6, background: d < 10 ? "#fce4e4" : d < 20 ? "#fef5e7" : "#fff", border: `1px solid ${d < 10 ? "#e74c3c40" : "#e4e9ec"}` }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <span style={{ fontSize: 13 }}>{icons[c.type] || "📍"}</span>
                              <span style={{ fontSize: 10, fontWeight: T.w.bold, color: T.c.text }}>{c.name}</span>
                            </div>
                            <div style={{ fontSize: 15, fontWeight: T.w.black, color: d < 15 ? "#e74c3c" : "#e67e22", marginTop: 2 }}>~{d}m</div>
                            {c.impact && <div style={{ fontSize: 9, color: T.c.textSecondary, marginTop: 1 }}>{c.impact}</div>}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 9, color: "#c0392b", fontStyle: "italic" }}>
                      ⚠ Crossings within 30m may require extended sight distance per AS 2890.1 §3.2.4
                    </div>
                  </div>
                )}
                {analysisResult.ai.nearby_crossings && analysisResult.ai.nearby_crossings.length === 0 && (
                  <div style={{ background: T.c.successLight, borderRadius: 8, padding: "6px 12px", marginBottom: 8, border: "1px solid #27ae6020", fontSize: 10, color: "#27ae60", fontWeight: T.w.semi }}>
                    ✓ No road crossings or junctions detected within 30m of driveway
                  </div>
                )}

                {analysisResult.ai.critical_low_obstructions?.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 9, fontWeight: T.w.bold, color: "#e67e22", marginBottom: 3 }}>⚠ CRITICAL LOW (0.5–1.0m)</div>
                    {analysisResult.ai.critical_low_obstructions.map((c, i) => (
                      <div key={i} style={{ fontSize: 10, padding: "3px 0", borderBottom: "1px solid #f0f3f5" }}>
                        <strong style={{ color: "#e67e22" }}>{c.name}</strong> — <span style={{ color: T.c.textSecondary }}>{c.height_range} · {c.impact}</span>
                      </div>
                    ))}
                  </div>
                )}
                {analysisResult.ai.elevation_insight && (
                  <div style={{ background: T.c.borderLight, borderRadius: 6, padding: "8px 12px", marginBottom: 8, fontSize: 10, color: "#5a6a74", border: "1px solid #e4e9ec" }}>▲ {analysisResult.ai.elevation_insight}</div>
                )}
                {analysisResult.ai.recommendations?.length > 0 && (
                  <div>
                    <div style={{ fontSize: 9, fontWeight: T.w.bold, color: "#1abc9c", marginBottom: 3 }}>Recommendations</div>
                    {analysisResult.ai.recommendations.map((r, i) => (
                      <div key={i} style={{ fontSize: 10, padding: "2px 0", lineHeight: 1.5, color: T.c.text }}><span style={{ color: "#1abc9c", fontWeight: T.w.bold, marginRight: 3 }}>{i + 1}.</span>{r}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}


// ─── Login Screen ───────────────────────────────────────

export default MapWithOverlay;
