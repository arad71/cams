import { useState, useRef, useEffect } from 'react';
import { T } from '../../styles/tokens';
import api from '../../services/api';
import { extractCorners, bestProcrustesAlign } from '../../utils/geo';

/**
 * Focused georeferencing tool.
 * Shows site plan image, lets user click lot corner points, then auto-matches
 * them to the cadastre lot polygon and computes alignment via Procrustes.
 * 3 or more points required. Plan points + matched map points are saved to
 * app.georef_overlay immediately.
 */
export default function SitePlanGeoref({ imgUrl, appRef, appDbId, docId, existingOverlay, lotPolygon, onClose, onGeorefPoints, onSaved }) {
  const imgRef = useRef(null);
  const wrapRef = useRef(null);

  // Window state
  const [winPos, setWinPos] = useState({ x: 40, y: 30 });
  const [winSize, setWinSize] = useState({
    w: Math.min(window.innerWidth - 80, 1100),
    h: Math.min(window.innerHeight - 60, 780),
  });
  const [maximized, setMaximized] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragOff = useRef({ x: 0, y: 0 });

  // Plan image
  const [imgSize, setImgSize] = useState({ w: 1, h: 1 });
  const [imgLoaded, setImgLoaded] = useState(false);

  // View transforms
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });

  // Georef points (plan image pixel coords)
  const [points, setPoints] = useState(() => {
    // Restore previously saved plan points so user can see what they had
    const saved = existingOverlay?.planPts;
    if (Array.isArray(saved) && saved.length > 0) return saved.map(p => ({ x: p.x, y: p.y }));
    return [];
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Window drag
  const onHeaderMouseDown = (e) => {
    if (maximized) return;
    e.preventDefault();
    dragOff.current = { x: e.clientX - winPos.x, y: e.clientY - winPos.y };
    setDragging(true);
  };
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => setWinPos({ x: e.clientX - dragOff.current.x, y: e.clientY - dragOff.current.y });
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragging]);

  const toggleMax = () => setMaximized(m => !m);

  // Convert screen click to image pixel coords
  // Mousedown: remember position; if mouseup close to same spot, treat as click
  const mouseDownPos = useRef(null);
  const mouseDownPanning = useRef(false);

  const handleMouseDown = (e) => {
    if (!imgLoaded) return;
    e.preventDefault();
    // Shift, right button, or middle button = pan
    if (e.button === 1 || e.button === 2 || e.shiftKey) {
      setPanning(true);
      mouseDownPanning.current = true;
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      return;
    }
    // Record mousedown for click detection
    mouseDownPos.current = { x: e.clientX, y: e.clientY };
    mouseDownPanning.current = false;
  };

  const handleMouseMove = (e) => {
    if (mouseDownPanning.current && panning) {
      setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
    }
  };

  const handleMouseUp = (e) => {
    const wasPanning = mouseDownPanning.current;
    setPanning(false);
    mouseDownPanning.current = false;

    if (wasPanning) {
      mouseDownPos.current = null;
      return;
    }
    // Check if this was a click (mouse didn't move much)
    const down = mouseDownPos.current;
    mouseDownPos.current = null;
    if (!down) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5) return; // treat as drag, not click

    // It's a click — add point
    if (!imgLoaded) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const imgX = (sx - pan.x) / zoom;
    const imgY = (sy - pan.y) / zoom;
    // Only add if within image bounds
    if (imgX < 0 || imgY < 0 || imgX > imgSize.w || imgY > imgSize.h) return;
    setPoints(prev => [...prev, { x: imgX, y: imgY }]);
  };

  // Zoom with wheel
  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setZoom(z => Math.max(0.1, Math.min(8, z * delta)));
  };

  // Fit image on load
  useEffect(() => {
    if (!imgLoaded || !wrapRef.current) return;
    const wrap = wrapRef.current;
    const zx = wrap.clientWidth / imgSize.w;
    const zy = wrap.clientHeight / imgSize.h;
    const z = Math.min(zx, zy) * 0.9;
    setZoom(z);
    setPan({ x: (wrap.clientWidth - imgSize.w * z) / 2, y: (wrap.clientHeight - imgSize.h * z) / 2 });
  }, [imgLoaded, imgSize.w, imgSize.h]);

  const removeLastPoint = () => setPoints(prev => prev.slice(0, -1));
  const clearPoints = () => setPoints([]);

  // Normalize lot polygon to [{lat,lng},...] format
  const lotCorners = (() => {
    if (!lotPolygon || !Array.isArray(lotPolygon) || lotPolygon.length < 3) return null;
    // lot_polygon is [[lat,lng],...] after normalizeLotPolygon
    return lotPolygon.map(p => Array.isArray(p) ? { lat: p[0], lng: p[1] } : p);
  })();

  const hasLot = lotCorners && lotCorners.length >= 3;

  const apply = async () => {
    if (points.length < 3) return;
    const img = imgRef.current;
    const imgW = img?.naturalWidth || imgSize.w;
    const imgH = img?.naturalHeight || imgSize.h;

    let matchedMapPts = existingOverlay?.mapPts || [];
    let bounds = existingOverlay?.bounds || null;
    let autoMatched = false;

    // Auto-match plan corners to cadastre lot corners
    if (hasLot) {
      // Extract K sharpest corners from cadastre (K = user's click count)
      const cadastreCorners = extractCorners(lotCorners, points.length);

      if (cadastreCorners.length === points.length) {
        // Try all rotational offsets × 2 winding directions to find best match.
        // User can click corners in ANY order — system finds the right pairing.
        const best = bestProcrustesAlign(
          points,
          cadastreCorners.map(c => ({ lat: c.lat, lng: c.lng }))
        );

        if (best && best.alignment) {
          matchedMapPts = best.mapPts;

          // Compute map bounds: transform image corners to lat/lng
          const t = best.alignment.transform;
          const tl = t(0, 0);
          const tr = t(imgW, 0);
          const bl = t(0, imgH);
          const br = t(imgW, imgH);
          const lats = [tl.lat, tr.lat, bl.lat, br.lat];
          const lngs = [tl.lng, tr.lng, bl.lng, br.lng];
          bounds = [
            [Math.min(...lats), Math.min(...lngs)],
            [Math.max(...lats), Math.max(...lngs)],
          ];
          autoMatched = true;
        }
      }
    }

    // Persist to backend
    if (appDbId) {
      setSaving(true);
      setSaveError(null);
      try {
        const overlay = {
          planPts: points.map(p => ({ x: p.x, y: p.y })),
          mapPts: matchedMapPts,
          bounds,
          docId: docId || existingOverlay?.docId || null,
          page: existingOverlay?.page || 1,
          imgW, imgH,
          autoMatched,
        };
        await api.updateApp(appDbId, { georef_overlay: overlay });
        if (onSaved) onSaved(overlay);
      } catch (e) {
        setSaveError(e?.message || 'Save failed');
        setSaving(false);
        return;
      }
      setSaving(false);
    }

    // Only trigger manual map-pairing flow if auto-match was NOT available
    // (when auto-matched, the saved overlay already has planPts + mapPts + bounds
    // and MapWithOverlay will render it directly from app.georef_overlay on reload)
    if (!autoMatched && onGeorefPoints) {
      onGeorefPoints(points, imgUrl, imgW, imgH);
    }
    if (onClose) onClose();
  };

  const wStyle = maximized
    ? { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh', zIndex: 9999 }
    : { position: 'fixed', top: winPos.y, left: winPos.x, width: winSize.w, height: winSize.h, zIndex: 9999 };

  return (
    <div style={{ ...wStyle, background: '#fff', borderRadius: maximized ? 0 : T.r.lg, boxShadow: '0 12px 48px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div onMouseDown={onHeaderMouseDown} style={{ padding: '8px 14px', background: 'linear-gradient(135deg,#8e44ad,#6c3a83)', color: '#fff', display: 'flex', alignItems: 'center', gap: 10, cursor: maximized ? 'default' : 'move', userSelect: 'none' }}>
        <div style={{ fontSize: 16 }}>🗺️</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Site Plan Georeferencing</div>
          <div style={{ fontSize: 10, opacity: 0.85 }}>{appRef || 'Align the plan to the map'}</div>
        </div>
        <button onClick={toggleMax} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', width: 24, height: 24, borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>{maximized ? '❐' : '□'}</button>
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', width: 24, height: 24, borderRadius: 4, cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>×</button>
      </div>

      {/* Instructions bar */}
      <div style={{ padding: '10px 16px', background: '#f7f0fa', borderBottom: '1px solid #e4d3ee', fontSize: 12, color: '#5e3075', lineHeight: 1.5 }}>
        <strong>How to use:</strong> Click <strong>at least 3 lot corners</strong> on the plan below (typically the 4 corners of the property boundary).
        {hasLot
          ? <> The system will <strong>auto-match</strong> your clicks to the cadastre lot boundary and compute the map alignment.</>
          : <> No lot boundary found — map alignment will use your clicked points only (manual pairing needed on the map).</>
        }
        <div style={{ fontSize: 10, color: '#7f5090', marginTop: 3 }}>Shift+drag or right-drag to pan · scroll to zoom · click corners in order (clockwise or anticlockwise)</div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Left sidebar */}
        <div style={{ width: 210, borderRight: '1px solid #e4e9ec', background: '#fafbfc', display: 'flex', flexDirection: 'column', padding: 12, gap: 10 }}>
          <div style={{ fontSize: 11, color: '#7a8a94', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>Control Points</div>

          {/* Lot boundary status */}
          <div style={{ background: hasLot ? '#eafaf1' : '#fef9e7', borderRadius: T.r.sm, padding: '6px 8px', fontSize: 10, lineHeight: 1.4, border: `1px solid ${hasLot ? '#d4efdf' : '#fce8b2'}` }}>
            {hasLot
              ? <><span style={{ color: '#27ae60', fontWeight: 700 }}>✓ Lot boundary available</span><br/><span style={{ color: '#7a8a94' }}>{lotCorners.length} cadastre vertices · will auto-match {points.length >= 3 ? points.length : '3+'} corners</span></>
              : <><span style={{ color: '#b7950b', fontWeight: 700 }}>⚠ No lot boundary</span><br/><span style={{ color: '#7a8a94' }}>Manual map pairing needed after save</span></>
            }
          </div>

          <div style={{ background: '#fff', borderRadius: T.r.md, border: '1px solid #e4e9ec', padding: 10, textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: points.length >= 3 ? '#27ae60' : '#8e44ad' }}>{points.length}</div>
            <div style={{ fontSize: 10, color: '#7a8a94' }}>placed</div>
            {points.length < 3 && <div style={{ fontSize: 10, color: '#c0392b', marginTop: 4 }}>Need {3 - points.length} more</div>}
            {points.length >= 3 && <div style={{ fontSize: 10, color: '#27ae60', marginTop: 4 }}>✓ Ready to apply</div>}
          </div>

          <button onClick={apply} disabled={points.length < 3 || saving}
            style={{ padding: '10px 0', borderRadius: T.r.md, border: 'none', background: saving ? '#aaa' : points.length >= 3 ? '#8e44ad' : '#cbd4d8', color: '#fff', fontWeight: 700, fontSize: 12, cursor: (points.length >= 3 && !saving) ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
            {saving ? 'Saving…' : 'Apply & Save →'}
          </button>
          {saveError && (
            <div style={{ fontSize: 10, color: '#c0392b', textAlign: 'center', padding: 4 }}>{saveError}</div>
          )}
          {existingOverlay?.planPts?.length >= 3 && (
            <div style={{ fontSize: 10, color: '#7a8a94', textAlign: 'center', fontStyle: 'italic' }}>
              ✓ Previously saved — editing will replace
            </div>
          )}

          <button onClick={removeLastPoint} disabled={points.length === 0}
            style={{ padding: '7px 0', borderRadius: T.r.md, border: '1px solid #e4e9ec', background: '#fff', color: points.length ? '#1a3a4a' : '#b8c1c5', fontSize: 11, cursor: points.length ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
            ↶ Undo Last
          </button>
          <button onClick={clearPoints} disabled={points.length === 0}
            style={{ padding: '7px 0', borderRadius: T.r.md, border: '1px solid #e4e9ec', background: '#fff', color: points.length ? '#c0392b' : '#b8c1c5', fontSize: 11, cursor: points.length ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
            Clear All
          </button>

          <div style={{ marginTop: 'auto', fontSize: 10, color: '#95a5a6', lineHeight: 1.5, padding: 8, background: '#fff', borderRadius: T.r.sm }}>
            <strong>Tip:</strong> Click the exact lot corners shown on the plan — not the house or fence. The more accurate your clicks, the better the map alignment.
          </div>
        </div>

        {/* Canvas */}
        <div ref={wrapRef}
          style={{ flex: 1, overflow: 'hidden', position: 'relative', background: '#e8ecef', cursor: panning ? 'grabbing' : 'crosshair' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onContextMenu={(e) => e.preventDefault()}
          onWheel={handleWheel}>
          <div style={{ position: 'absolute', transformOrigin: '0 0', transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}>
            <img ref={imgRef} src={imgUrl} crossOrigin="anonymous" alt="Site Plan"
              onLoad={(e) => { setImgSize({ w: e.target.naturalWidth, h: e.target.naturalHeight }); setImgLoaded(true); }}
              style={{ display: 'block', userSelect: 'none' }} draggable={false} />
            {/* Overlay SVG with control points */}
            <svg xmlns="http://www.w3.org/2000/svg" width={imgSize.w} height={imgSize.h}
              style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
              {/* Polygon outline if 3+ points */}
              {points.length >= 3 && (
                <polygon
                  points={points.map(p => `${p.x},${p.y}`).join(' ')}
                  fill="rgba(142,68,173,0.12)"
                  stroke="#8e44ad"
                  strokeWidth={Math.max(2, 2 / zoom)}
                  strokeDasharray={`${10 / zoom},${5 / zoom}`}
                />
              )}
              {/* Lines between points if 2 */}
              {points.length === 2 && (
                <line
                  x1={points[0].x} y1={points[0].y} x2={points[1].x} y2={points[1].y}
                  stroke="#8e44ad" strokeWidth={Math.max(2, 2 / zoom)} strokeDasharray={`${10 / zoom},${5 / zoom}`}
                />
              )}
              {/* Numbered control points */}
              {points.map((p, i) => (
                <g key={i}>
                  <circle cx={p.x} cy={p.y} r={Math.max(8, 8 / zoom)} fill="#8e44ad" stroke="#fff" strokeWidth={Math.max(2, 2 / zoom)} />
                  <text x={p.x} y={p.y + Math.max(4, 4 / zoom)} textAnchor="middle" fontSize={Math.max(11, 11 / zoom)} fontWeight="700" fill="#fff">{i + 1}</text>
                </g>
              ))}
            </svg>
          </div>
          {!imgLoaded && (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', color: '#7a8a94', fontSize: 13 }}>
              Loading site plan…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
