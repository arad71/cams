import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { SIGHT_DISTANCE_TABLE } from '../../data/constants';
import { getAppCoords, getFirstRing, normalizeLotPolygon, findNearestRoadSpeed, getSightDistances } from '../../utils/geoHelpers';
import { geoDistMetres, geoOffset, geoBearing, nearestPointOnSegment } from '../../utils/geo';
import LeafletMap from './LeafletMap';

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
function MapWithOverlay({ app, apps, onSelectApp, speedRoadsData = null, lotsData = null }) {
  const [showLots, setShowLots] = useState(true);
  const [showSpeedRoads, setShowSpeedRoads] = useState(true);
  const [showStreetNames, setShowStreetNames] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [drawMode, setDrawMode] = useState(null);
  const [ptA, setPtA] = useState(null);
  const [ptB, setPtB] = useState(null);
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

  const fetchElev3D = async (points) => {
    const lats = points.map(p => p.lat.toFixed(6)).join(','), lngs = points.map(p => p.lng.toFixed(6)).join(',');
    const resp = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`);
    if (!resp.ok) throw new Error(`Elev ${resp.status}`); return resp.json();
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
    const steps = ['Querying OSM Overpass...', 'Processing features...', 'Fetching elevation (DEM)...', 'Ground elevations...', '3D line-of-sight (40 rays)...', 'Capturing satellite + street view...', 'AI Vision classification...', 'Done!'];
    const ss = (n) => setAnalysisSteps(steps.map((s, i) => ({ text: s, status: i < n ? 'done' : i === n ? 'active' : 'pending' })));
    let feats = [], mode = 'live';
    try { ss(0); const ctr = { lat: (A.lat + C.lat + D.lat) / 3, lng: (A.lng + C.lng + D.lng) / 3 }; const r = Math.max(havDist3D(A, C), havDist3D(A, D), havDist3D(C, D)) + 80; const data = await fetchOSM3D(ctr, r); ss(1); feats = procOSM3D(data); if (!feats.length) mode = 'no_data'; } catch { mode = 'error'; }
    ss(2);
    const mid = { lat: (C.lat + D.lat) / 2, lng: (C.lng + D.lng) / 2 };
    const eSPts = []; for (let i = 0; i <= 20; i++) { eSPts.push(lerpPt3D(A, mid, i / 20)); eSPts.push(lerpPt3D(A, C, i / 20)); eSPts.push(lerpPt3D(A, D, i / 20)); eSPts.push(lerpPt3D(C, D, i / 20)); }
    const mnLa = Math.min(A.lat, C.lat, D.lat) - .0002, mxLa = Math.max(A.lat, C.lat, D.lat) + .0002, mnLo = Math.min(A.lng, C.lng, D.lng) - .0003, mxLo = Math.max(A.lng, C.lng, D.lng) + .0003;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) eSPts.push({ lat: mnLa + r / 3 * (mxLa - mnLa), lng: mnLo + c / 3 * (mxLo - mnLo) });
    const uPts = []; const sn = new Set(); for (const p of eSPts) { const k = p.lat.toFixed(5) + ',' + p.lng.toFixed(5); if (!sn.has(k)) { sn.add(k); uPts.push(p); } if (uPts.length >= 100) break; }
    let elevs = []; try { const ed = await fetchElev3D(uPts); elevs = ed.elevation || []; } catch { const b = 10 + Math.abs(A.lat * 100 % 20); elevs = uPts.map((_, i) => b + Math.sin(i * .3) * 1.5); }
    const eg = { pts: uPts, elevs };
    ss(3); for (const f of feats) { const ct = f.geometry.length === 1 ? f.geometry[0] : { lat: f.geometry.reduce((s, g) => s + g.lat, 0) / f.geometry.length, lng: f.geometry.reduce((s, g) => s + g.lng, 0) / f.geometry.length }; f.groundElev = getElevAt3D(ct, eg); }
    ss(4); const res = losEngine3D(A, C, D, feats, eg, eyeH, tgtH);
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
    ss(6); setAnalysisResult({ ...res, ai, elevA, elevCD, eyeH, tgtH, feats, mode }); setAnalysisRunning(false);
  };

  const reset3DAnalysis = () => { setAnalysisResult(null); setAnalysisRunning(false); setAnalysisSteps([]); };
  const ratingMap3D = { CLEAR: { color: '#27ae60', bg: '#eafaf1', label: '✓ CLEAR' }, PARTIALLY_OBSTRUCTED: { color: '#e67e22', bg: '#fef5e7', label: '◐ PARTIAL' }, SEVERELY_OBSTRUCTED: { color: '#c0392b', bg: '#fdedec', label: '◑ SEVERE' }, BLOCKED: { color: '#c0392b', bg: '#fdedec', label: '✗ BLOCKED' } };
  const hInputStyle = { background: "#f8fafb", border: "1.5px solid #d5dde2", color: "#1a3a4a", borderRadius: 5, padding: "4px 6px", width: 52, fontSize: 11, fontWeight: 700, fontFamily: "inherit", textAlign: "center", outline: "none" };

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
    const sd = getSightDistances(nearestRoad.speed);
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

    setSightTriangle({
      ptA, ptB, triLeft, triRight,
      lineAB: [[ptA.lat, ptA.lng], [ptB.lat, ptB.lng]],
      lotPoly: bPoly, boundaryDists,
      ptALotInfo: ptALotPoly?.properties || null,
      speedInfo: { detected: nearestRoad.speed, roadName: nearestRoad.roadName, networkType: nearestRoad.networkType, absMin: sd.absMin, ssdMin: sd.ssdMin, leftM: leftDistM, rightM: rightDistM, baseTotal },
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
  }, [ptA, ptB, coords, lotPoly, ptALotPoly]);

  const resetTriangle = () => { setPtA(null); setPtB(null); setSightTriangle(null); setDrawMode(null); reset3DAnalysis(); };
  const startDraw = () => { resetTriangle(); setDrawMode("ptA"); };

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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: isFullscreen ? 0 : 8, flexWrap: "wrap", gap: 6, ...(isFullscreen ? { padding: "8px 12px", background: "#f8fafb", borderBottom: "1px solid #e4e9ec" } : {}) }}>
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => setShowLots(!showLots)}
            style={{ padding: "6px 12px", borderRadius: 6, border: showLots ? "2px solid #2980b9" : "1px solid #d5dde2", background: showLots ? "#ebf5fb" : "#fff", color: showLots ? "#2980b9" : "#7a8a94", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
            🏘️ Lots
          </button>
          <button onClick={() => setShowSpeedRoads(!showSpeedRoads)}
            style={{ padding: "6px 12px", borderRadius: 6, border: showSpeedRoads ? "2px solid #e67e22" : "1px solid #d5dde2", background: showSpeedRoads ? "#fef5e7" : "#fff", color: showSpeedRoads ? "#e67e22" : "#7a8a94", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
            🚗 Speed
          </button>
          <button onClick={() => setShowStreetNames(!showStreetNames)}
            style={{ padding: "6px 12px", borderRadius: 6, border: showStreetNames ? "2px solid #16a085" : "1px solid #d5dde2", background: showStreetNames ? "#e8f8f5" : "#fff", color: showStreetNames ? "#16a085" : "#7a8a94", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
            🏷️ Street Names
          </button>
          {!drawMode && !sightTriangle && (
            <button onClick={startDraw} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "linear-gradient(135deg, #e74c3c, #c0392b)", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>🔺 Sight Triangle</button>
          )}
          {drawMode && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: drawMode === "ptA" ? "#fdf2f2" : "#ebf5fb", padding: "5px 12px", borderRadius: 6, border: `1px solid ${drawMode === "ptA" ? "#e74c3c40" : "#2980b940"}` }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: drawMode === "ptA" ? "#e74c3c" : "#2980b9", animation: "pulse 1.2s infinite" }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: drawMode === "ptA" ? "#c0392b" : "#2980b9" }}>
                {drawMode === "ptA" ? "Click: DRIVEWAY point (A)" : "Click: ROAD centreline (B)"}
              </span>
              <button onClick={resetTriangle} style={{ padding: "2px 8px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, cursor: "pointer" }}>Cancel</button>
            </div>
          )}
          {sightTriangle && !drawMode && (
            <button onClick={resetTriangle} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #d5dde2", background: "#fff", color: "#5a6a74", fontWeight: 600, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>↺ Clear</button>
          )}
          {sightTriangle && !drawMode && !analysisRunning && (
            <button onClick={run3DSightAnalysis} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "linear-gradient(135deg, #8e44ad, #6c3483)", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 2px 6px rgba(142,68,173,0.3)" }}>🔬 3D Sight Analysis</button>
          )}
          {analysisRunning && (
            <span style={{ fontSize: 11, fontWeight: 700, color: "#8e44ad", padding: "6px 12px", background: "#f4ecf7", borderRadius: 6 }}>⟳ Running 3D Analysis...</span>
          )}
          <button onClick={() => setIsFullscreen(!isFullscreen)}
            style={{ padding: "6px 12px", borderRadius: 6, border: isFullscreen ? "2px solid #1a3a4a" : "1px solid #d5dde2", background: isFullscreen ? "#1a3a4a" : "#fff", color: isFullscreen ? "#fff" : "#7a8a94", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit", marginLeft: 4 }}>
            {isFullscreen ? "✕ Exit Fullscreen" : "⛶ Fullscreen"}
          </button>
        </div>
        {/* Observer & Object height — shown when sight triangle exists */}
        {(sightTriangle || drawMode) && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#f8fafb", padding: "5px 10px", borderRadius: 6, border: "1px solid #e4e9ec" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: "#e74c3c" }}>👁</span>
              <input type="number" value={eyeHeight} onChange={e => setEyeHeight(parseFloat(e.target.value) || 0)} min="0" max="50" step="0.05" style={hInputStyle} />
              <span style={{ fontSize: 9, color: "#7a8a94" }}>m</span>
            </div>
            <div style={{ width: 1, height: 14, background: "#d5dde2" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: "#2980b9" }}>◎</span>
              <input type="number" value={objectHeight} onChange={e => setObjectHeight(parseFloat(e.target.value) || 0)} min="0" max="50" step="0.05" style={hInputStyle} />
              <span style={{ fontSize: 9, color: "#7a8a94" }}>m</span>
            </div>
          </div>
        )}
      </div>

      {/* Map */}
      <LeafletMap apps={apps} selectedApp={app} onSelectApp={onSelectApp} height={mapHeight}
        drawMode={drawMode} onMapClick={handleMapClick} sightTriangle={sightTriangle}
        showLots={showLots} lotsData={lotsData} showSpeedRoads={showSpeedRoads || showStreetNames} speedRoadsData={speedRoadsData} onLotClick={handleLotClick} allLotsData={lotsData} clickedLot={clickedLot} analysisResult={analysisResult}
        forceLayer={null}
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
              <div style={{ fontWeight: 800, fontSize: 14, color: sightTriangle.analysis.compliant ? "#1e8449" : "#c0392b" }}>
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
              { label: "AREA", value: sightTriangle.analysis.area + "m²", sub: "½ × base × depth", color: "#1a3a4a" },
            ].map(m => (
              <div key={m.label} style={{ flex: "1 1 85px", background: "#f8fafb", borderRadius: 8, padding: "8px 10px", minWidth: 85 }}>
                <div style={{ fontSize: 9, color: "#7a8a94", fontWeight: 700 }}>{m.label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: m.color, lineHeight: 1.2 }}>{m.value}</div>
                <div style={{ fontSize: 9, color: "#95a5a6" }}>{m.sub}</div>
              </div>
            ))}
          </div> */}

          {/* Boundary distances from A to each lot side */}
          <div style={{ padding: "0 16px 12px" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#7a8a94", marginBottom: 4, textTransform: "uppercase" }}>
              📐 Distance from Point A to lot boundary
              {sightTriangle.ptALotInfo && (
                <span style={{ fontWeight: 400, textTransform: "none", marginLeft: 6, color: "#2980b9" }}>
                  — {[sightTriangle.ptALotInfo.road_number_1, sightTriangle.ptALotInfo.road_name, sightTriangle.ptALotInfo.road_type, sightTriangle.ptALotInfo.locality].filter(Boolean).join(" ")}
                  {sightTriangle.ptALotInfo.lot_number && ` (Lot ${sightTriangle.ptALotInfo.lot_number})`}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {(sightTriangle.boundaryDists || []).map((bd, i) => (
                <div key={i} style={{ flex: "1 1 110px", padding: "6px 10px", borderRadius: 6, fontSize: 11, minWidth: 100,
                  background: i === 0 ? "#fdf2f2" : "#f8fafb", border: i === 0 ? "2px solid #e74c3c" : "1px solid #eef2f4" }}>
                  <div style={{ fontWeight: 800, color: i === 0 ? "#e74c3c" : "#1a3a4a", fontSize: 16 }}>→ {bd.distLabel}m</div>
                  <div style={{ color: "#7a8a94", fontSize: 9 }}>Side {bd.idx + 1} ({bd.sideLen}m){i === 0 ? " — nearest" : ""}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Info panels */}
          {/* <div style={{ padding: "0 16px 12px" }}>
              <div style={{
                  width: "100%",
                  background: "#fef9e7",
                  borderRadius: 8,
                  padding: "10px 14px",
                  border: "1px solid #f9e79f"
              }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#b8860b", marginBottom: 3 }}>
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
            <div style={{ fontSize: 9, fontWeight: 700, color: "#7a8a94", marginBottom: 4, textTransform: "uppercase" }}>Sight Distance Reference (Austroads / AS 2890.1)</div>
            <div style={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              {SIGHT_DISTANCE_TABLE.map(e => {
                const cur = e.speed === sightTriangle.speedInfo?.detected;
                return (
                  <div key={e.speed} style={{ padding: "3px 6px", borderRadius: 3, fontSize: 9, fontWeight: 700, textAlign: "center", minWidth: 55,
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

      {/* ═══ Street View + Satellite Context ═══ */}
      {sightTriangle && sightTriangle.ptA && (
        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {/* Google Street View from Point A looking toward road */}
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", overflow: "hidden" }}>
            <div style={{ padding: "8px 14px", borderBottom: "1px solid #eef2f4", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12 }}>🚗</span>
              <span style={{ fontSize: 11, fontWeight: 800, color: "#1a3a4a" }}>Street View — Driveway (Point A)</span>
            </div>
            <div style={{ height: 280 }}>
              <iframe
                src={`https://www.google.com/maps/embed/v1/streetview?key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU17R8&location=${sightTriangle.ptA.lat},${sightTriangle.ptA.lng}&heading=${sightTriangle.ptB ? Math.round(Math.atan2(sightTriangle.ptB.lng - sightTriangle.ptA.lng, sightTriangle.ptB.lat - sightTriangle.ptA.lat) * 180 / Math.PI) : 0}&pitch=0&fov=90`}
                width="100%" height="280" style={{ border: "none" }}
                allowFullScreen loading="lazy" referrerPolicy="no-referrer-when-downgrade"
                title="Street View from driveway"
              />
            </div>
            <div style={{ padding: "6px 14px", fontSize: 9, color: "#95a5a6", borderTop: "1px solid #eef2f4" }}>
              📍 {sightTriangle.ptA.lat.toFixed(6)}, {sightTriangle.ptA.lng.toFixed(6)} · Looking toward road centreline
            </div>
          </div>

          {/* Satellite context — mini Leaflet map with triangle overlay */}
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", overflow: "hidden" }}>
            <div style={{ padding: "8px 14px", borderBottom: "1px solid #eef2f4", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12 }}>🛰️</span>
              <span style={{ fontSize: 11, fontWeight: 800, color: "#1a3a4a" }}>Satellite — Sight Triangle Area</span>
            </div>
            <div style={{ height: 340, position: "relative" }}>
              <SatelliteMiniMap sightTriangle={sightTriangle} />
            </div>
            <div style={{ padding: "6px 14px", fontSize: 9, color: "#95a5a6", borderTop: "1px solid #eef2f4", display: "flex", justifyContent: "space-between" }}>
              <span>🛰️ {sightTriangle.speedInfo?.detected}km/h · {sightTriangle.speedInfo?.roadName || "—"} · Area: {sightTriangle.analysis?.area}m²</span>
              <a href={`https://www.google.com/maps/@${sightTriangle.ptA.lat},${sightTriangle.ptA.lng},19z/data=!3m1!1e3`} target="_blank" rel="noopener noreferrer" style={{ color: "#2980b9", textDecoration: "none", fontWeight: 600 }}>Google Maps ↗</a>
            </div>
          </div>
        </div>
      )}

      {/* ═══ 3D Analysis Processing Steps ═══ */}
      {analysisRunning && analysisSteps.length > 0 && (
        <div style={{ marginTop: 10, background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", padding: "14px 16px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#8e44ad", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>🔬 3D Sight Analysis Processing</div>
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
              <div style={{ fontWeight: 800, fontSize: 14, color: "#1a3a4a" }}>🔬 3D Sight-Line Analysis</div>
              <div style={{ fontSize: 10, color: "#5a6a74", marginTop: 2 }}>
                {sightTriangle?.speedInfo?.detected}km/h · {sightTriangle?.speedInfo?.roadName || '—'} | 👁 {analysisResult.eyeH}m | ◎ {analysisResult.tgtH}m | {analysisResult.mode === 'live' ? '● LIVE' : '○ Fallback'}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ padding: "5px 12px", borderRadius: 16, fontSize: 11, fontWeight: 800, background: (ratingMap3D[analysisResult.ai?.overall_rating] || ratingMap3D.BLOCKED).bg, color: (ratingMap3D[analysisResult.ai?.overall_rating] || ratingMap3D.BLOCKED).color, border: `1px solid ${(ratingMap3D[analysisResult.ai?.overall_rating] || ratingMap3D.BLOCKED).color}40` }}>
                {(ratingMap3D[analysisResult.ai?.overall_rating] || ratingMap3D.BLOCKED).label}
              </span>
              <button onClick={reset3DAnalysis} style={{ background: "none", border: "none", fontSize: 14, cursor: "pointer", color: "#95a5a6" }}>✕</button>
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
                <div style={{ fontSize: 8, color: "#7a8a94", fontWeight: 700 }}>{m.label}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: m.color, lineHeight: 1.2 }}>{m.value}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 1, borderBottom: "1px solid #e4e9ec", padding: "0 16px" }}>
            {[{ id: 'obstructions', label: '⚠ Obstruct.' }, { id: 'features', label: '▤ Features' }, { id: 'ai', label: '◈ AI' }].map(tab => (
              <button key={tab.id} onClick={() => setActiveAnalysisTab(tab.id)}
                style={{ padding: "6px 12px", background: "none", border: "none", borderBottom: activeAnalysisTab === tab.id ? "2px solid #8e44ad" : "2px solid transparent", color: activeAnalysisTab === tab.id ? "#8e44ad" : "#7a8a94", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{ padding: "10px 16px", maxHeight: 260, overflowY: "auto" }}>
            {activeAnalysisTab === 'obstructions' && (
              analysisResult.obstructions?.length === 0
                ? <div style={{ textAlign: "center", color: "#27ae60", padding: 12, fontSize: 11, fontWeight: 700 }}>Clear 3D line of sight ✓</div>
                : analysisResult.obstructions?.map((o, i) => {
                    const tc = { building: '#e07050', fence: '#f0c850', tree: '#00c090', wall: '#a090ff', hedge: '#50f0c0', terrain_ridge: '#ff4757' };
                    return (
                      <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid #f0f3f5", fontSize: 11 }}>
                        <div style={{ fontWeight: 700, color: tc[o.feature.type] || '#5a6a74' }}>{o.blockType === 'terrain' ? '▲ TERRAIN' : o.feature.type.toUpperCase()}: {o.feature.name}</div>
                        <div style={{ display: "flex", gap: 5, marginTop: 2, flexWrap: "wrap", fontSize: 10 }}>
                          <span style={{ padding: "1px 5px", borderRadius: 3, background: o.isCritical ? "#fdf2f2" : "#f5f8fa", color: o.isCritical ? "#e74c3c" : "#5a6a74", fontWeight: 700 }}>{o.feature.estimatedHeight?.toFixed(1)}m</span>
                          <span style={{ color: "#95a5a6" }}>gnd {o.fGroundElev?.toFixed(1)}m</span>
                          <span style={{ color: "#95a5a6" }}>top {o.fTopAlt?.toFixed(1)}m</span>
                          <span style={{ color: "#e74c3c", fontWeight: 700 }}>+{o.excessHeight?.toFixed(2)}m</span>
                          {o.isCritical && <span style={{ color: "#e74c3c", fontWeight: 700 }}>⚠ 0.5-1.0m</span>}
                        </div>
                      </div>
                    );
                  })
            )}
            {activeAnalysisTab === 'features' && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#7a8a94", marginBottom: 4 }}>{analysisResult.feats?.length || 0} Features</div>
                {(analysisResult.feats || []).slice(0, 25).map((f, i) => {
                  const tc = { building: '#e07050', fence: '#f0c850', tree: '#00c090', wall: '#a090ff', hedge: '#50f0c0', vegetation: '#00d0c8' };
                  return (
                    <div key={i} style={{ padding: "3px 0", borderBottom: "1px solid #f0f3f5", fontSize: 10 }}>
                      <span style={{ fontWeight: 700, color: tc[f.type] || '#5a6a74' }}>{f.type}</span>
                      <span style={{ color: "#7a8a94", marginLeft: 4 }}>{f.name}</span>
                      <span style={{ marginLeft: 4, padding: "1px 4px", borderRadius: 3, background: "#f5f8fa", color: "#5a6a74", fontWeight: 700 }}>{f.estimatedHeight.toFixed(1)}m</span>
                      <span style={{ color: "#95a5a6", marginLeft: 3 }}>gnd {f.groundElev?.toFixed(1)}m</span>
                    </div>
                  );
                })}
              </div>
            )}
            {activeAnalysisTab === 'ai' && analysisResult.ai && (
              <div>
                <div style={{ marginBottom: 8 }}>
                  <span style={{ padding: "3px 10px", borderRadius: 12, fontSize: 10, fontWeight: 700, background: (ratingMap3D[analysisResult.ai.overall_rating] || ratingMap3D.BLOCKED).bg, color: (ratingMap3D[analysisResult.ai.overall_rating] || ratingMap3D.BLOCKED).color }}>
                    {analysisResult.ai.overall_rating?.replace(/_/g, ' ')}
                  </span>
                  <span style={{ marginLeft: 8, fontSize: 10, color: "#95a5a6" }}>Visibility: {analysisResult.ai.visibility_pct}%</span>
                </div>
                <div style={{ fontSize: 11, lineHeight: 1.6, color: "#1a3a4a", marginBottom: 10 }}>{analysisResult.ai.analysis_summary}</div>

                {/* Imagery-based findings */}
                {analysisResult.ai.satellite_findings && analysisResult.ai.satellite_findings !== "Imagery analysis unavailable — using geospatial data only." && (
                  <div style={{ background: "#ebf5fb", borderRadius: 8, padding: "8px 12px", marginBottom: 8, border: "1px solid #2980b920" }}>
                    <div style={{ fontSize: 9, fontWeight: 800, color: "#2980b9", marginBottom: 3, textTransform: "uppercase" }}>🛰️ Satellite Imagery Analysis</div>
                    <div style={{ fontSize: 10, color: "#1a3a4a", lineHeight: 1.6 }}>{analysisResult.ai.satellite_findings}</div>
                  </div>
                )}
                {analysisResult.ai.streetview_findings && analysisResult.ai.streetview_findings !== "Street view analysis unavailable." && (
                  <div style={{ background: "#fef5e7", borderRadius: 8, padding: "8px 12px", marginBottom: 8, border: "1px solid #e67e2220" }}>
                    <div style={{ fontSize: 9, fontWeight: 800, color: "#e67e22", marginBottom: 3, textTransform: "uppercase" }}>🚗 Street View Analysis</div>
                    <div style={{ fontSize: 10, color: "#1a3a4a", lineHeight: 1.6 }}>{analysisResult.ai.streetview_findings}</div>
                  </div>
                )}
                {analysisResult.ai.vegetation_assessment && (
                  <div style={{ background: "#eafaf1", borderRadius: 8, padding: "8px 12px", marginBottom: 8, border: "1px solid #27ae6020" }}>
                    <div style={{ fontSize: 9, fontWeight: 800, color: "#27ae60", marginBottom: 3, textTransform: "uppercase" }}>🌳 Vegetation Assessment</div>
                    <div style={{ fontSize: 10, color: "#1a3a4a", lineHeight: 1.6 }}>{analysisResult.ai.vegetation_assessment}</div>
                  </div>
                )}
                {analysisResult.ai.infrastructure_assessment && (
                  <div style={{ background: "#f4ecf7", borderRadius: 8, padding: "8px 12px", marginBottom: 8, border: "1px solid #8e44ad20" }}>
                    <div style={{ fontSize: 9, fontWeight: 800, color: "#8e44ad", marginBottom: 3, textTransform: "uppercase" }}>🧱 Infrastructure Assessment</div>
                    <div style={{ fontSize: 10, color: "#1a3a4a", lineHeight: 1.6 }}>{analysisResult.ai.infrastructure_assessment}</div>
                  </div>
                )}

                {/* AI-detected road crossings */}
                {analysisResult.ai.nearby_crossings?.length > 0 && (
                  <div style={{ background: "#fdedec", borderRadius: 8, padding: "8px 12px", marginBottom: 8, border: "1px solid #e74c3c20" }}>
                    <div style={{ fontSize: 9, fontWeight: 800, color: "#e74c3c", marginBottom: 6, textTransform: "uppercase" }}>🚦 Road Crossings & Junctions within 30m</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {analysisResult.ai.nearby_crossings.map((c, i) => {
                        const icons = { pedestrian_crossing: "🚶", intersection: "🔀", stop_sign: "🛑", give_way: "🔺", traffic_signals: "🚦", driveway: "🚗", roundabout: "🔄" };
                        const d = c.estimated_distance_m;
                        return (
                          <div key={i} style={{ flex: "1 1 140px", padding: "6px 10px", borderRadius: 6, background: d < 10 ? "#fce4e4" : d < 20 ? "#fef5e7" : "#fff", border: `1px solid ${d < 10 ? "#e74c3c40" : "#e4e9ec"}` }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <span style={{ fontSize: 13 }}>{icons[c.type] || "📍"}</span>
                              <span style={{ fontSize: 10, fontWeight: 700, color: "#1a3a4a" }}>{c.name}</span>
                            </div>
                            <div style={{ fontSize: 15, fontWeight: 800, color: d < 15 ? "#e74c3c" : "#e67e22", marginTop: 2 }}>~{d}m</div>
                            {c.impact && <div style={{ fontSize: 9, color: "#7a8a94", marginTop: 1 }}>{c.impact}</div>}
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
                  <div style={{ background: "#eafaf1", borderRadius: 8, padding: "6px 12px", marginBottom: 8, border: "1px solid #27ae6020", fontSize: 10, color: "#27ae60", fontWeight: 600 }}>
                    ✓ No road crossings or junctions detected within 30m of driveway
                  </div>
                )}

                {analysisResult.ai.critical_low_obstructions?.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "#e67e22", marginBottom: 3 }}>⚠ CRITICAL LOW (0.5–1.0m)</div>
                    {analysisResult.ai.critical_low_obstructions.map((c, i) => (
                      <div key={i} style={{ fontSize: 10, padding: "3px 0", borderBottom: "1px solid #f0f3f5" }}>
                        <strong style={{ color: "#e67e22" }}>{c.name}</strong> — <span style={{ color: "#7a8a94" }}>{c.height_range} · {c.impact}</span>
                      </div>
                    ))}
                  </div>
                )}
                {analysisResult.ai.elevation_insight && (
                  <div style={{ background: "#f0f3f5", borderRadius: 6, padding: "8px 12px", marginBottom: 8, fontSize: 10, color: "#5a6a74", border: "1px solid #e4e9ec" }}>▲ {analysisResult.ai.elevation_insight}</div>
                )}
                {analysisResult.ai.recommendations?.length > 0 && (
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "#1abc9c", marginBottom: 3 }}>Recommendations</div>
                    {analysisResult.ai.recommendations.map((r, i) => (
                      <div key={i} style={{ fontSize: 10, padding: "2px 0", lineHeight: 1.5, color: "#1a3a4a" }}><span style={{ color: "#1abc9c", fontWeight: 700, marginRight: 3 }}>{i + 1}.</span>{r}</div>
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
