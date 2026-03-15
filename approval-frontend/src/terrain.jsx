import { useState, useCallback, useRef, useEffect } from "react";

/*
  SIGHT OBSTRUCTION DETECTOR v2
  ─────────────────────────────
  Fetches real terrain elevation along rays from A → BC line
  using Open-Meteo Elevation API (90m DEM) and Open-Elevation API (30m SRTM).
  Detects 0.5–1.0m terrain bumps that could block line-of-sight.
*/

// ── Geo Utilities ──

function toRad(d) { return d * Math.PI / 180; }

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toLocalXY(lat, lng, oLat, oLng) {
  const R = 6371000;
  return {
    x: R * toRad(lng - oLng) * Math.cos(toRad(oLat)),
    y: R * toRad(lat - oLat)
  };
}

function lerp(a, b, t) { return a + (b - a) * t; }

// Interpolate N points along a line from (lat1,lng1) to (lat2,lng2)
function interpolatePoints(lat1, lng1, lat2, lng2, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ lat: lerp(lat1, lat2, t), lng: lerp(lng1, lng2, t), t });
  }
  return pts;
}

// ── Elevation API Fetchers ──

async function fetchOpenMeteoElevation(points) {
  const lats = points.map(p => p.lat.toFixed(6)).join(",");
  const lngs = points.map(p => p.lng.toFixed(6)).join(",");
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo error: ${res.status}`);
  const data = await res.json();
  return data.elevation; // array of numbers
}

async function fetchOpenElevation(points) {
  const locations = points.map(p => ({ latitude: p.lat, longitude: p.lng }));
  const res = await fetch("https://api.open-elevation.com/api/v1/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locations })
  });
  if (!res.ok) throw new Error(`Open-Elevation error: ${res.status}`);
  const data = await res.json();
  return data.results.map(r => r.elevation);
}

async function fetchOpenTopoData(points) {
  const locations = points.map(p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join("|");
  const url = `https://api.opentopodata.org/v1/srtm90m?locations=${locations}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OpenTopoData error: ${res.status}`);
  const data = await res.json();
  return data.results.map(r => r.elevation);
}

async function fetchGoogleElevation(points, apiKey) {
  if (!apiKey) throw new Error("Google API key is required. Get one at console.cloud.google.com → Elevation API.");
  // Google allows up to 512 locations per request via path encoding
  // For larger batches, split into chunks
  const chunkSize = 256;
  const allElevations = [];

  for (let i = 0; i < points.length; i += chunkSize) {
    const chunk = points.slice(i, i + chunkSize);
    const locations = chunk.map(p => `${p.lat.toFixed(7)},${p.lng.toFixed(7)}`).join("|");
    const url = `https://maps.googleapis.com/maps/api/elevation/json?locations=${locations}&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Google Elevation API HTTP error: ${res.status}`);
    const data = await res.json();
    if (data.status !== "OK") {
      throw new Error(`Google Elevation API: ${data.status} — ${data.error_message || "Check API key & billing"}`);
    }
    allElevations.push(...data.results.map(r => r.elevation));
  }

  return allElevations;
}

// Google also supports path-based sampling which gives evenly-spaced elevation along a path
async function fetchGoogleElevationPath(startLat, startLng, endLat, endLng, samples, apiKey) {
  if (!apiKey) throw new Error("Google API key required");
  const path = `${startLat.toFixed(7)},${startLng.toFixed(7)}|${endLat.toFixed(7)},${endLng.toFixed(7)}`;
  const url = `https://maps.googleapis.com/maps/api/elevation/json?path=${path}&samples=${samples}&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google Path Elevation error: ${res.status}`);
  const data = await res.json();
  if (data.status !== "OK") {
    throw new Error(`Google Elevation: ${data.status} — ${data.error_message || "Check API key"}`);
  }
  return data.results.map(r => ({
    elevation: r.elevation,
    lat: r.location.lat,
    lng: r.location.lng,
    resolution: r.resolution,
  }));
}

// ── LOS Analysis ──

function analyzeLOS(profilePoints, observerHeight) {
  // profilePoints: [{ dist, elevation, lat, lng, t }]
  // observerHeight is added to the first point's elevation
  if (profilePoints.length < 2) return { obstructions: [], clear: true };

  const aElev = profilePoints[0].elevation + observerHeight;
  const tElev = profilePoints[profilePoints.length - 1].elevation;
  const totalDist = profilePoints[profilePoints.length - 1].dist;

  const obstructions = [];
  let maxBlockage = 0;

  for (let i = 1; i < profilePoints.length - 1; i++) {
    const p = profilePoints[i];
    const fraction = p.dist / totalDist;
    const losElevAtPoint = lerp(aElev, tElev, fraction);
    const diff = p.elevation - losElevAtPoint;

    if (diff > 0.3) { // threshold: anything 0.3m above LOS
      obstructions.push({
        index: i,
        dist: p.dist,
        elevation: p.elevation,
        losElevation: losElevAtPoint,
        blockage: diff,
        lat: p.lat,
        lng: p.lng,
      });
      if (diff > maxBlockage) maxBlockage = diff;
    }
  }

  return {
    obstructions,
    clear: obstructions.length === 0,
    maxBlockage,
    aElev,
    tElev,
    totalDist,
  };
}

// ── SVG Profile Chart ──

function ElevationProfile({ profileData, analysis, label, color }) {
  if (!profileData || profileData.length === 0) return null;

  const w = 680, h = 220, pad = { t: 30, r: 20, b: 40, l: 55 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;

  const maxDist = Math.max(...profileData.map(p => p.dist), 1);
  const elevs = profileData.map(p => p.elevation);
  const minE = Math.min(...elevs) - 1;
  const maxE = Math.max(...elevs, analysis?.aElev || 0) + 2;
  const rangeE = maxE - minE || 1;

  const sx = d => pad.l + (d / maxDist) * pw;
  const sy = e => pad.t + (1 - (e - minE) / rangeE) * ph;

  const pathD = profileData.map((p, i) =>
    `${i === 0 ? 'M' : 'L'}${sx(p.dist).toFixed(1)},${sy(p.elevation).toFixed(1)}`
  ).join(' ');

  const fillD = pathD +
    ` L${sx(maxDist).toFixed(1)},${sy(minE).toFixed(1)}` +
    ` L${sx(0).toFixed(1)},${sy(minE).toFixed(1)} Z`;

  // Grid lines
  const yTicks = [];
  const yStep = Math.max(1, Math.ceil(rangeE / 5));
  for (let e = Math.ceil(minE); e <= maxE; e += yStep) yTicks.push(e);

  const xTicks = [];
  const xStep = Math.max(1, Math.ceil(maxDist / 6));
  for (let d = 0; d <= maxDist; d += xStep) xTicks.push(d);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 11, color: color || "#00ffaa", marginBottom: 6,
        fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.06em"
      }}>
        {label}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{
        width: "100%", maxWidth: w, background: "#080d18", borderRadius: 10,
        border: "1px solid #1a2035"
      }}>
        {/* Grid */}
        {yTicks.map(e => (
          <g key={`y${e}`}>
            <line x1={pad.l} y1={sy(e)} x2={w - pad.r} y2={sy(e)}
              stroke="#1a2035" strokeWidth="0.5" />
            <text x={pad.l - 6} y={sy(e) + 3} textAnchor="end"
              fill="#3a4a6a" fontSize="9" fontFamily="'JetBrains Mono', monospace">
              {e.toFixed(0)}m
            </text>
          </g>
        ))}
        {xTicks.map(d => (
          <g key={`x${d}`}>
            <line x1={sx(d)} y1={pad.t} x2={sx(d)} y2={h - pad.b}
              stroke="#1a2035" strokeWidth="0.5" />
            <text x={sx(d)} y={h - pad.b + 14} textAnchor="middle"
              fill="#3a4a6a" fontSize="9" fontFamily="'JetBrains Mono', monospace">
              {d.toFixed(0)}m
            </text>
          </g>
        ))}

        {/* Terrain fill */}
        <path d={fillD} fill={color || "#00ffaa"} opacity="0.06" />

        {/* Terrain line */}
        <path d={pathD} fill="none" stroke={color || "#00ffaa"} strokeWidth="1.5" opacity="0.8" />

        {/* LOS line */}
        {analysis && (
          <line
            x1={sx(0)} y1={sy(analysis.aElev)}
            x2={sx(analysis.totalDist)} y2={sy(analysis.tElev)}
            stroke="#f59e0b" strokeWidth="1" strokeDasharray="5,3" opacity="0.7"
          />
        )}

        {/* Obstruction markers */}
        {analysis?.obstructions?.map((obs, i) => (
          <g key={i}>
            <line x1={sx(obs.dist)} y1={sy(obs.elevation)}
              x2={sx(obs.dist)} y2={sy(obs.losElevation)}
              stroke="#ff4444" strokeWidth="2" opacity="0.8" />
            <circle cx={sx(obs.dist)} cy={sy(obs.elevation)}
              r="3" fill="#ff4444" />
            <text x={sx(obs.dist)} y={sy(obs.elevation) - 8}
              textAnchor="middle" fill="#ff4444" fontSize="8"
              fontFamily="'JetBrains Mono', monospace">
              +{obs.blockage.toFixed(1)}m
            </text>
          </g>
        ))}

        {/* Observer marker */}
        {analysis && (
          <>
            <circle cx={sx(0)} cy={sy(analysis.aElev)} r="4" fill="#00ffaa" />
            <text x={sx(0) + 8} y={sy(analysis.aElev) - 6}
              fill="#00ffaa" fontSize="8" fontFamily="'JetBrains Mono', monospace">
              A ({analysis.aElev.toFixed(1)}m)
            </text>
          </>
        )}

        {/* Target marker */}
        {analysis && (
          <>
            <circle cx={sx(analysis.totalDist)} cy={sy(analysis.tElev)} r="4" fill="#a855f7" />
            <text x={sx(analysis.totalDist) - 8} y={sy(analysis.tElev) - 6}
              textAnchor="end" fill="#a855f7" fontSize="8"
              fontFamily="'JetBrains Mono', monospace">
              BC ({analysis.tElev.toFixed(1)}m)
            </text>
          </>
        )}

        {/* Axis labels */}
        <text x={w / 2} y={h - 4} textAnchor="middle"
          fill="#3a4a6a" fontSize="9" fontFamily="'JetBrains Mono', monospace">
          Distance (m)
        </text>
        <text x={12} y={h / 2} textAnchor="middle"
          fill="#3a4a6a" fontSize="9" fontFamily="'JetBrains Mono', monospace"
          transform={`rotate(-90, 12, ${h / 2})`}>
          Elevation (m)
        </text>

        {/* Status badge */}
        {analysis && (
          <g transform={`translate(${w - pad.r - 100}, ${pad.t + 5})`}>
            <rect x="0" y="0" width="95" height="22" rx="4"
              fill={analysis.clear ? "#14532d" : "#7f1d1d"} opacity="0.6"
              stroke={analysis.clear ? "#22c55e" : "#ff4444"} strokeWidth="0.5" />
            <text x="48" y="15" textAnchor="middle"
              fill={analysis.clear ? "#22c55e" : "#ff4444"}
              fontSize="10" fontWeight="700" fontFamily="'JetBrains Mono', monospace">
              {analysis.clear ? "✓ CLEAR LOS" : `⛔ BLOCKED`}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

// ── Top-down Map ──

function TopDownMap({ pointA, pointB, pointC, rayProfiles, observerHeight }) {
  const w = 680, h = 420, pad = 50;

  const origin = pointA;
  const aXY = toLocalXY(pointA.lat, pointA.lng, origin.lat, origin.lng);
  const bXY = toLocalXY(pointB.lat, pointB.lng, origin.lat, origin.lng);
  const cXY = toLocalXY(pointC.lat, pointC.lng, origin.lat, origin.lng);

  const allX = [aXY.x, bXY.x, cXY.x];
  const allY = [aXY.y, bXY.y, cXY.y];

  const minX = Math.min(...allX) - 10;
  const maxX = Math.max(...allX) + 10;
  const minY = Math.min(...allY) - 10;
  const maxY = Math.max(...allY) + 10;
  const scale = Math.min((w - 2*pad) / (maxX - minX || 1), (h - 2*pad) / (maxY - minY || 1));

  const toSVG = (xy) => ({
    x: pad + (xy.x - minX) * scale,
    y: h - pad - (xy.y - minY) * scale
  });

  const aS = toSVG(aXY);
  const bS = toSVG(bXY);
  const cS = toSVG(cXY);

  // Build ray lines
  const numRays = 10;
  const rayLines = [];
  for (let i = 0; i <= numRays; i++) {
    const t = i / numRays;
    const tx = bS.x + t * (cS.x - bS.x);
    const ty = bS.y + t * (cS.y - bS.y);
    // Determine if this ray has obstructions
    const matchingProfile = rayProfiles?.find(rp => Math.abs(rp.t - t) < 0.06);
    const blocked = matchingProfile && !matchingProfile.analysis.clear;
    rayLines.push({ tx, ty, blocked, t });
  }

  // Plot obstruction points from all profiles
  const obsPoints = [];
  rayProfiles?.forEach(rp => {
    rp.analysis?.obstructions?.forEach(obs => {
      const oXY = toLocalXY(obs.lat, obs.lng, origin.lat, origin.lng);
      obsPoints.push({ ...toSVG(oXY), blockage: obs.blockage });
    });
  });

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{
      width: "100%", maxWidth: w, background: "#080d18", borderRadius: 10,
      border: "1px solid #1a2035"
    }}>
      <defs>
        <radialGradient id="glow2" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#00ffaa" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#00ffaa" stopOpacity="0" />
        </radialGradient>
        <filter id="pGlow">
          <feGaussianBlur stdDeviation="2.5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <linearGradient id="bcG" x1="0%" y1="0%" x2="100%">
          <stop offset="0%" stopColor="#00d4ff" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>

      {/* Grid */}
      {Array.from({ length: 8 }).map((_, i) => (
        <g key={i} opacity="0.06">
          <line x1={pad + i*(w-2*pad)/7} y1={pad} x2={pad + i*(w-2*pad)/7} y2={h-pad} stroke="#00ffaa" strokeWidth="0.5"/>
          <line x1={pad} y1={pad + i*(h-2*pad)/7} x2={w-pad} y2={pad + i*(h-2*pad)/7} stroke="#00ffaa" strokeWidth="0.5"/>
        </g>
      ))}

      {/* Visibility triangle */}
      <polygon points={`${aS.x},${aS.y} ${bS.x},${bS.y} ${cS.x},${cS.y}`}
        fill="#00ffaa" opacity="0.03" stroke="#00ffaa" strokeWidth="0.5" strokeOpacity="0.1" />

      {/* Rays */}
      {rayLines.map((r, i) => (
        <line key={i} x1={aS.x} y1={aS.y} x2={r.tx} y2={r.ty}
          stroke={r.blocked ? "#ff4444" : "#00ffaa"}
          strokeWidth={r.blocked ? "1" : "0.4"}
          opacity={r.blocked ? "0.5" : "0.1"}
          strokeDasharray={r.blocked ? "none" : "3,4"} />
      ))}

      {/* BC line */}
      <line x1={bS.x} y1={bS.y} x2={cS.x} y2={cS.y}
        stroke="url(#bcG)" strokeWidth="2.5" strokeLinecap="round" />

      {/* Obstruction points */}
      {obsPoints.map((op, i) => (
        <g key={i}>
          <circle cx={op.x} cy={op.y} r={3 + op.blockage * 6} fill="#ff4444" opacity="0.15" />
          <circle cx={op.x} cy={op.y} r="3" fill="#ff4444" opacity="0.9" />
        </g>
      ))}

      {/* Points */}
      <circle cx={aS.x} cy={aS.y} r="22" fill="url(#glow2)" />
      <circle cx={aS.x} cy={aS.y} r="7" fill="#00ffaa" filter="url(#pGlow)" />
      <text x={aS.x} y={aS.y - 16} textAnchor="middle"
        fill="#00ffaa" fontSize="11" fontWeight="700" fontFamily="'JetBrains Mono', monospace">
        A (Observer)
      </text>

      <circle cx={bS.x} cy={bS.y} r="6" fill="#00d4ff" filter="url(#pGlow)" />
      <text x={bS.x} y={bS.y - 12} textAnchor="middle"
        fill="#00d4ff" fontSize="11" fontWeight="600" fontFamily="'JetBrains Mono', monospace">B</text>

      <circle cx={cS.x} cy={cS.y} r="6" fill="#a855f7" filter="url(#pGlow)" />
      <text x={cS.x} y={cS.y - 12} textAnchor="middle"
        fill="#a855f7" fontSize="11" fontWeight="600" fontFamily="'JetBrains Mono', monospace">C</text>
    </svg>
  );
}

// ── Main App ──

const API_OPTIONS = [
  { id: "google", label: "⭐ Google Elevation (~5m)", fn: null, needsKey: true },
  { id: "google-path", label: "⭐ Google Path Mode (~5m)", fn: null, needsKey: true },
  { id: "open-meteo", label: "Open-Meteo (90m DEM)", fn: fetchOpenMeteoElevation },
  { id: "open-elevation", label: "Open-Elevation (30m SRTM)", fn: fetchOpenElevation },
  { id: "open-topodata", label: "OpenTopoData (90m SRTM)", fn: fetchOpenTopoData },
];

export default function SightObstructionDetectorV2() {
  const [pointA, setPointA] = useState({ lat: -31.9505, lng: 115.8605 });
  const [pointB, setPointB] = useState({ lat: -31.9500, lng: 115.8615 });
  const [pointC, setPointC] = useState({ lat: -31.9510, lng: 115.8620 });
  const [observerHeight, setObserverHeight] = useState(1.5);
  const [numSamples, setNumSamples] = useState(25);
  const [numRays, setNumRays] = useState(5);
  const [apiChoice, setApiChoice] = useState("google");
  const [googleApiKey, setGoogleApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rayProfiles, setRayProfiles] = useState([]);
  const [selectedRay, setSelectedRay] = useState(0);
  const [progress, setProgress] = useState("");

  const selectedApi = API_OPTIONS.find(a => a.id === apiChoice);
  const needsKey = selectedApi?.needsKey;

  const getFetchFn = useCallback(() => {
    if (apiChoice === "google") return (pts) => fetchGoogleElevation(pts, googleApiKey);
    if (apiChoice === "google-path") return null; // handled separately
    return API_OPTIONS.find(a => a.id === apiChoice)?.fn;
  }, [apiChoice, googleApiKey]);

  const runScan = useCallback(async () => {
    if (needsKey && !googleApiKey.trim()) {
      setError("Please enter your Google Maps API key below. Enable Elevation API in Google Cloud Console.");
      return;
    }

    setLoading(true);
    setError(null);
    setRayProfiles([]);
    setProgress("Initializing scan...");

    try {
      const profiles = [];
      const fetchFn = getFetchFn();

      for (let r = 0; r < numRays; r++) {
        const t = numRays === 1 ? 0.5 : r / (numRays - 1);
        const targetLat = lerp(pointB.lat, pointC.lat, t);
        const targetLng = lerp(pointB.lng, pointC.lng, t);

        setProgress(`Fetching ray ${r + 1}/${numRays} (t=${t.toFixed(2)})...`);

        let profilePoints;

        if (apiChoice === "google-path") {
          // Use Google's path-based sampling — returns evenly spaced points with elevation
          const pathResults = await fetchGoogleElevationPath(
            pointA.lat, pointA.lng, targetLat, targetLng, numSamples + 1, googleApiKey
          );
          profilePoints = pathResults.map((pr, i) => ({
            lat: pr.lat,
            lng: pr.lng,
            t: i / numSamples,
            elevation: pr.elevation,
            resolution: pr.resolution,
            dist: haversine(pointA.lat, pointA.lng, pr.lat, pr.lng),
          }));
        } else {
          // Standard: interpolate points then batch-query elevation
          const samplePts = interpolatePoints(
            pointA.lat, pointA.lng, targetLat, targetLng, numSamples
          );

          let elevations;
          try {
            elevations = await fetchFn(samplePts);
          } catch (apiErr) {
            // Fallback: try Open-Meteo if primary fails (not for Google)
            if (!needsKey) {
              setProgress(`Ray ${r+1}: Primary API failed, trying fallback...`);
              try {
                elevations = await fetchOpenMeteoElevation(samplePts);
              } catch (e2) {
                throw new Error(`All APIs failed for ray ${r+1}: ${apiErr.message}`);
              }
            } else {
              throw apiErr;
            }
          }

          profilePoints = samplePts.map((pt, i) => ({
            lat: pt.lat,
            lng: pt.lng,
            t: pt.t,
            elevation: elevations[i] ?? 0,
            dist: haversine(pointA.lat, pointA.lng, pt.lat, pt.lng),
          }));
        }

        const analysis = analyzeLOS(profilePoints, observerHeight);

        // Add resolution info if available
        if (profilePoints[0]?.resolution) {
          analysis.avgResolution = (
            profilePoints.reduce((s, p) => s + (p.resolution || 0), 0) / profilePoints.length
          ).toFixed(1);
        }

        profiles.push({
          t,
          targetLat,
          targetLng,
          profilePoints,
          analysis,
        });

        // Small delay to avoid rate-limiting
        if (r < numRays - 1) {
          await new Promise(res => setTimeout(res, apiChoice.startsWith("google") ? 150 : 300));
        }
      }

      setRayProfiles(profiles);
      setProgress("");
    } catch (err) {
      setError(err.message);
      setProgress("");
    } finally {
      setLoading(false);
    }
  }, [pointA, pointB, pointC, observerHeight, numSamples, numRays, getFetchFn, apiChoice, googleApiKey, needsKey]);

  const totalObstructions = rayProfiles.reduce(
    (sum, rp) => sum + (rp.analysis?.obstructions?.length || 0), 0
  );
  const blockedRays = rayProfiles.filter(rp => !rp.analysis?.clear).length;

  const inputStyle = {
    background: "#0c1222",
    border: "1px solid #1e293b",
    borderRadius: 6,
    color: "#e2e8f0",
    padding: "7px 10px",
    fontSize: 13,
    width: "100%",
    fontFamily: "'JetBrains Mono', monospace",
    outline: "none",
    transition: "border-color 0.2s",
  };

  const labelStyle = {
    color: "#4a5c80",
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    fontFamily: "'JetBrains Mono', monospace",
    marginBottom: 3,
  };

  const cardStyle = {
    background: "#0b1120",
    borderRadius: 12,
    padding: 16,
    border: "1px solid #141d30",
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(175deg, #020611 0%, #081022 40%, #0a1428 100%)",
      color: "#d1d9e8",
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
      padding: "20px 12px",
    }}>
      <div style={{ maxWidth: 740, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <div style={{
              width: 6, height: 6, borderRadius: "50%",
              background: "#00ffaa", boxShadow: "0 0 10px #00ffaa77",
              animation: "pulse 2s infinite"
            }} />
            <span style={{ color: "#00ffaa", fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase" }}>
              Terrain-Based LOS Analysis
            </span>
          </div>
          <h1 style={{
            fontSize: 22, fontWeight: 800, margin: "4px 0",
            background: "linear-gradient(135deg, #e8edf5, #7a8ba8)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>
            Sight Obstruction Detector
          </h1>
          <p style={{ color: "#3a4a68", fontSize: 11, margin: 0 }}>
            Fetches real DEM elevation data along rays from A → BC to detect terrain obstructions
          </p>
        </div>

        {/* Point inputs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
          {[
            { label: "A – Observer", p: pointA, set: setPointA, color: "#00ffaa" },
            { label: "B – Start", p: pointB, set: setPointB, color: "#00d4ff" },
            { label: "C – End", p: pointC, set: setPointC, color: "#a855f7" },
          ].map(({ label, p, set, color }) => (
            <div key={label} style={{ ...cardStyle, borderColor: `${color}15` }}>
              <div style={{ ...labelStyle, color }}>{label}</div>
              <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                <div style={{ flex: 1 }}>
                  <div style={labelStyle}>Lat</div>
                  <input style={inputStyle} value={p.lat}
                    onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) set(prev => ({ ...prev, lat: v })); }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={labelStyle}>Lng</div>
                  <input style={inputStyle} value={p.lng}
                    onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) set(prev => ({ ...prev, lng: v })); }} />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Settings row */}
        <div style={{ ...cardStyle, marginBottom: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1.5fr", gap: 14, alignItems: "end" }}>
            <div>
              <div style={labelStyle}>Observer Height</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="range" min="0.5" max="5" step="0.1" value={observerHeight}
                  onChange={e => setObserverHeight(parseFloat(e.target.value))}
                  style={{ flex: 1, accentColor: "#00ffaa" }} />
                <span style={{ color: "#00ffaa", fontSize: 12, fontWeight: 600, minWidth: 35 }}>
                  {observerHeight}m
                </span>
              </div>
            </div>
            <div>
              <div style={labelStyle}>Samples/Ray</div>
              <input style={inputStyle} type="number" min="10" max="512" value={numSamples}
                onChange={e => setNumSamples(parseInt(e.target.value) || 25)} />
            </div>
            <div>
              <div style={labelStyle}>Num Rays</div>
              <input style={inputStyle} type="number" min="1" max="20" value={numRays}
                onChange={e => setNumRays(parseInt(e.target.value) || 5)} />
            </div>
            <div>
              <div style={labelStyle}>Elevation API</div>
              <select style={{ ...inputStyle, cursor: "pointer" }} value={apiChoice}
                onChange={e => setApiChoice(e.target.value)}>
                {API_OPTIONS.map(a => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Google API Key input — shown when Google is selected */}
          {needsKey && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ ...labelStyle, color: "#f59e0b" }}>Google Maps API Key</div>
                  <input
                    style={{ ...inputStyle, borderColor: googleApiKey ? "#14532d" : "#7f1d1d66" }}
                    type="password"
                    placeholder="AIzaSy... (Elevation API must be enabled)"
                    value={googleApiKey}
                    onChange={e => setGoogleApiKey(e.target.value)}
                  />
                </div>
                <div style={{ paddingTop: 14 }}>
                  {googleApiKey ? (
                    <span style={{ color: "#22c55e", fontSize: 11 }}>✓ Key set</span>
                  ) : (
                    <span style={{ color: "#f59e0b", fontSize: 11 }}>Required</span>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 9, color: "#3a4a68", marginTop: 6, lineHeight: 1.6 }}>
                <strong style={{ color: "#4a5c80" }}>Setup:</strong> Go to{" "}
                <span style={{ color: "#00d4ff" }}>console.cloud.google.com</span> → APIs & Services → Enable "Elevation API" →
                Create Credentials → API Key. Google offers $200/mo free credit (~40,000 elevation requests).
                {apiChoice === "google-path" && (
                  <span style={{ color: "#a855f7" }}> Path mode uses Google's built-in interpolation for smoother, more accurate profiles.</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Scan button */}
        <button onClick={runScan} disabled={loading} style={{
          width: "100%", padding: "14px 0", marginBottom: 18,
          background: loading
            ? "linear-gradient(135deg, #1a2740, #1e3050)"
            : (needsKey && !googleApiKey)
              ? "linear-gradient(135deg, #7f1d1d22, #1e305015)"
              : "linear-gradient(135deg, #00ffaa22, #00d4ff15)",
          border: `1px solid ${loading ? "#1e3050" : (needsKey && !googleApiKey) ? "#7f1d1d44" : "#00ffaa44"}`,
          borderRadius: 10,
          color: loading ? "#4a5c80" : (needsKey && !googleApiKey) ? "#f59e0b" : "#00ffaa",
          fontSize: 14, fontWeight: 700, cursor: loading ? "wait" : "pointer",
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: "0.08em",
          transition: "all 0.3s",
        }}>
          {loading
            ? progress || "Scanning..."
            : (needsKey && !googleApiKey)
              ? "⚠  ENTER GOOGLE API KEY ABOVE"
              : `▶  SCAN TERRAIN — ${selectedApi?.label || apiChoice}`
          }
        </button>

        {/* Error */}
        {error && (
          <div style={{
            ...cardStyle, marginBottom: 14, borderColor: "#7f1d1d",
            color: "#ff6b6b", fontSize: 12
          }}>
            <strong>Error:</strong> {error}
            <div style={{ color: "#4a5c80", marginTop: 4, fontSize: 10 }}>
              Tip: Open-Meteo is the most reliable free API. Open-Elevation and OpenTopoData may have rate limits.
            </div>
          </div>
        )}

        {/* Results Summary */}
        {rayProfiles.length > 0 && (
          <>
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr",
              gap: 10, marginBottom: 18,
            }}>
              <div style={{
                ...cardStyle, textAlign: "center",
                borderColor: blockedRays > 0 ? "#7f1d1d33" : "#14532d33"
              }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: blockedRays > 0 ? "#ff4444" : "#22c55e" }}>
                  {blockedRays}/{rayProfiles.length}
                </div>
                <div style={labelStyle}>Blocked Rays</div>
              </div>
              <div style={{ ...cardStyle, textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#f59e0b" }}>
                  {totalObstructions}
                </div>
                <div style={labelStyle}>Obstruction Points</div>
              </div>
              <div style={{ ...cardStyle, textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#00d4ff" }}>
                  {rayProfiles[0]?.analysis?.totalDist?.toFixed(0) || "—"}m
                </div>
                <div style={labelStyle}>Avg Distance</div>
              </div>
              <div style={{ ...cardStyle, textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#a855f7" }}>
                  {rayProfiles[0]?.analysis?.avgResolution
                    ? `${rayProfiles[0].analysis.avgResolution}m`
                    : selectedApi?.label?.match(/\d+m/)?.[0] || "—"}
                </div>
                <div style={labelStyle}>DEM Resolution</div>
              </div>
            </div>

            {/* Top-down map */}
            <div style={{ ...cardStyle, marginBottom: 18 }}>
              <div style={{ ...labelStyle, marginBottom: 10, color: "#6b82aa" }}>Top-Down View</div>
              <TopDownMap
                pointA={pointA} pointB={pointB} pointC={pointC}
                rayProfiles={rayProfiles} observerHeight={observerHeight}
              />
            </div>

            {/* Ray selector + profiles */}
            <div style={{ ...cardStyle, marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <div style={labelStyle}>Elevation Profile — Ray</div>
                <div style={{ display: "flex", gap: 4 }}>
                  {rayProfiles.map((rp, i) => (
                    <button key={i} onClick={() => setSelectedRay(i)} style={{
                      padding: "4px 10px", borderRadius: 6, fontSize: 10,
                      fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: selectedRay === i ? 700 : 400,
                      background: selectedRay === i
                        ? (rp.analysis.clear ? "#14532d44" : "#7f1d1d44")
                        : "#0c1222",
                      border: `1px solid ${selectedRay === i
                        ? (rp.analysis.clear ? "#22c55e55" : "#ff444455")
                        : "#1e293b"}`,
                      color: selectedRay === i
                        ? (rp.analysis.clear ? "#22c55e" : "#ff4444")
                        : "#4a5c80",
                      cursor: "pointer",
                    }}>
                      {(i+1)} {rp.analysis.clear ? "✓" : "⛔"}
                    </button>
                  ))}
                </div>
              </div>
              {rayProfiles[selectedRay] && (
                <ElevationProfile
                  profileData={rayProfiles[selectedRay].profilePoints}
                  analysis={rayProfiles[selectedRay].analysis}
                  label={`Ray ${selectedRay + 1}: A → BC(t=${rayProfiles[selectedRay].t.toFixed(2)}) — ${
                    rayProfiles[selectedRay].analysis.clear ? "CLEAR" : `${rayProfiles[selectedRay].analysis.obstructions.length} obstructions`
                  }`}
                  color={rayProfiles[selectedRay].analysis.clear ? "#00ffaa" : "#ff6b6b"}
                />
              )}

              {/* Obstruction table */}
              {rayProfiles[selectedRay]?.analysis?.obstructions?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ ...labelStyle, color: "#ff6b6b", marginBottom: 6 }}>Detected Obstructions</div>
                  <div style={{ fontSize: 11, lineHeight: 1.8 }}>
                    {rayProfiles[selectedRay].analysis.obstructions.map((obs, i) => (
                      <div key={i} style={{
                        display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr",
                        padding: "6px 8px", background: i % 2 === 0 ? "#0c122233" : "transparent",
                        borderRadius: 4,
                      }}>
                        <span style={{ color: "#4a5c80" }}>@ {obs.dist.toFixed(1)}m</span>
                        <span>Elev: {obs.elevation.toFixed(1)}m</span>
                        <span>LOS: {obs.losElevation.toFixed(1)}m</span>
                        <span style={{ color: "#ff4444", fontWeight: 600 }}>+{obs.blockage.toFixed(2)}m above</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Info box */}
        <div style={{ ...cardStyle, marginTop: 10 }}>
          <div style={{ ...labelStyle, color: "#4a5c80", marginBottom: 8 }}>How It Works</div>
          <div style={{ fontSize: 11, color: "#3a4a68", lineHeight: 1.8 }}>
            <strong style={{ color: "#6b82aa" }}>1.</strong> Casts N rays from point A to evenly-spaced targets along line BC.{" "}
            <strong style={{ color: "#6b82aa" }}>2.</strong> Samples terrain elevation at M points per ray using the selected DEM API.{" "}
            <strong style={{ color: "#6b82aa" }}>3.</strong> Draws a straight LOS line from A (+ observer height) to target on BC.{" "}
            <strong style={{ color: "#6b82aa" }}>4.</strong> Any terrain point whose elevation exceeds the LOS line by ≥0.3m is flagged as an obstruction.{" "}
          </div>

          <div style={{ fontSize: 10, color: "#2a3a55", marginTop: 10, lineHeight: 1.7 }}>
            <strong style={{ color: "#f59e0b" }}>API Comparison:</strong>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 6 }}>
            {[
              { name: "Google Elevation", res: "~5m urban, ~30m rural", cost: "Paid ($5/1000 req, $200 free/mo)", best: "Best for urban & small-area analysis" },
              { name: "Open-Meteo", res: "90m (Copernicus DEM)", cost: "Free, no key", best: "Best free option, very reliable" },
              { name: "Open-Elevation", res: "30m (SRTM)", cost: "Free (rate-limited)", best: "Finer free resolution, but slower" },
            ].map(api => (
              <div key={api.name} style={{
                background: "#080d18", borderRadius: 8, padding: 10,
                border: "1px solid #141d30", fontSize: 9, lineHeight: 1.6
              }}>
                <div style={{ color: "#6b82aa", fontWeight: 700, marginBottom: 3 }}>{api.name}</div>
                <div style={{ color: "#3a4a68" }}>Resolution: <span style={{ color: "#4a5c80" }}>{api.res}</span></div>
                <div style={{ color: "#3a4a68" }}>Cost: <span style={{ color: "#4a5c80" }}>{api.cost}</span></div>
                <div style={{ color: "#3a4a68", fontStyle: "italic" }}>{api.best}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 10, color: "#2a3a55", marginTop: 10, lineHeight: 1.7 }}>
            <strong style={{ color: "#4a5c80" }}>Note:</strong> Even Google's ~5m resolution detects terrain-scale features.
            For individual objects (fences, walls, vegetation ≤1m), you'd need LiDAR DSM (1m) or field survey.
            Google Path Mode uses server-side interpolation for smoother profiles than point-query mode.
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        input:focus, select:focus {
          border-color: #00ffaa55 !important;
        }
        input[type="range"] {
          height: 4px;
        }
        select option {
          background: #0c1222;
          color: #e2e8f0;
        }
      `}</style>
    </div>
  );
}
