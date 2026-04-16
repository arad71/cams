import { useState, useRef, useEffect } from 'react';
import { T } from '../../styles/tokens';
import api from '../../services/api';

/**
 * Focused georeferencing tool.
 * Shows site plan image, lets user click lot corner points, then applies them to the map.
 * 3 or more points required. Plan points are saved to app.georef_overlay immediately
 * so the overlay persists even if user closes before pairing with map points.
 */
export default function SitePlanGeoref({ imgUrl, appRef, appDbId, docId, existingOverlay, onClose, onGeorefPoints, onSaved }) {
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
  const screenToImage = (e) => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    // Inverse of: translate(pan) * scale(zoom)
    return { x: (sx - pan.x) / zoom, y: (sy - pan.y) / zoom };
  };

  // Click to add point, or drag to pan
  const handleMouseDown = (e) => {
    if (!imgLoaded) return;
    if (e.button === 1 || e.shiftKey) {
      // Middle click or shift = pan
      setPanning(true);
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      return;
    }
  };
  const handleMouseMove = (e) => {
    if (!panning) return;
    setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
  };
  const handleMouseUp = () => setPanning(false);

  const handleClick = (e) => {
    if (panning || !imgLoaded) return;
    // Don't add point if shift held (pan mode)
    if (e.shiftKey) return;
    const pt = screenToImage(e);
    if (!pt) return;
    // Only add if within image bounds
    if (pt.x < 0 || pt.y < 0 || pt.x > imgSize.w || pt.y > imgSize.h) return;
    setPoints(prev => [...prev, pt]);
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

  const apply = async () => {
    if (points.length < 3) return;
    const img = imgRef.current;
    const imgW = img?.naturalWidth || imgSize.w;
    const imgH = img?.naturalHeight || imgSize.h;

    // Persist plan points to backend so they survive refresh (and gate the auto-popup)
    if (appDbId) {
      setSaving(true);
      setSaveError(null);
      try {
        const overlay = {
          planPts: points.map(p => ({ x: p.x, y: p.y })),
          mapPts: existingOverlay?.mapPts || [],
          bounds: existingOverlay?.bounds || null,
          docId: docId || existingOverlay?.docId || null,
          page: existingOverlay?.page || 1,
          imgW, imgH,
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

    // Continue with in-session pairing flow (so map-side alignment also works)
    if (onGeorefPoints) {
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
        <strong>How to use:</strong> Click <strong>at least 3 lot corners</strong> on the plan below (typically the 4 corners of the property).
        Then click <strong>"Apply to Map"</strong> — the plan will be overlaid on the map so measurements align with real coordinates.
        <div style={{ fontSize: 10, color: '#7f5090', marginTop: 3 }}>Shift+drag to pan · scroll to zoom</div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Left sidebar */}
        <div style={{ width: 210, borderRight: '1px solid #e4e9ec', background: '#fafbfc', display: 'flex', flexDirection: 'column', padding: 12, gap: 10 }}>
          <div style={{ fontSize: 11, color: '#7a8a94', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>Control Points</div>

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
          onClick={handleClick}
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
