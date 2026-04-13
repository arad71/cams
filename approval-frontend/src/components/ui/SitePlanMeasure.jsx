import { useState, useRef, useEffect, useCallback } from 'react';
import { T, S, cx } from '../../styles/tokens';

const COLORS = ['#00e4c8','#ff5c72','#ffcf40','#5cacff','#4dff91','#a77dff','#ff8f4d','#ff6eb4'];

// AI extraction fields that can be overridden via correctSitePlan
const AI_FIELDS = [
  // ── Crossover ──
  { key: 'crossover_dimensions.width_at_boundary_m', label: 'Crossover Width', unit: 'm' },
  { key: 'crossover_dimensions.verge_depth_m', label: 'Verge Depth', unit: 'm' },
  { key: 'crossover_dimensions.distance_to_left_boundary_m', label: 'Left Boundary Dist', unit: 'm' },
  { key: 'crossover_dimensions.left_boundary_feature', label: 'Left Boundary Feature', unit: '' },
  { key: 'crossover_dimensions.distance_to_right_boundary_m', label: 'Right Boundary Dist', unit: 'm' },
  { key: 'crossover_dimensions.right_boundary_feature', label: 'Right Boundary Feature', unit: '' },
  { key: 'crossover_dimensions.constrained_side', label: 'Constrained Side', unit: '' },
  { key: 'crossover_dimensions.distance_to_nearest_lot_corner_m', label: 'Dist to Lot Corner', unit: 'm' },
  { key: 'crossover_dimensions.distance_to_intersection_tangent_m', label: 'Dist to Intersection', unit: 'm' },
  // ── Road ──
  { key: 'siteplan_measurements.crossover_on_road', label: 'Crossover Road', unit: '' },
  { key: 'siteplan_measurements.road_name', label: 'Primary Road', unit: '' },
  { key: 'siteplan_measurements.secondary_road_name', label: 'Secondary Road', unit: '' },
  { key: 'siteplan_measurements.road_speed_zone_kmh', label: 'Speed Zone', unit: 'km/h' },
  // ── Lot ──
  { key: 'siteplan_measurements.lot_frontage_m', label: 'Lot Frontage', unit: 'm' },
  { key: 'siteplan_measurements.lot_depth_m', label: 'Lot Depth', unit: 'm' },
  { key: 'siteplan_measurements.building_setback_front_m', label: 'Front Setback', unit: 'm' },
  { key: 'siteplan_measurements.garage_to_kerb_m', label: 'Garage to Kerb', unit: 'm' },
  // ── Construction ──
  { key: 'construction.material', label: 'Surface Material', unit: '' },
  { key: 'construction.kerb_type', label: 'Kerb Type', unit: '' },
];

export default function SitePlanMeasure({ imgUrl, onClose, onSaveField, onSaveMeasures, appRef, savedItems: initialItems, appData, onGeorefPoints }) {
  const wrapRef = useRef(null);
  const innerRef = useRef(null);
  const svgRef = useRef(null);
  const imgRef = useRef(null);

  // Window position/size
  const [winPos, setWinPos] = useState({ x: 40, y: 30 });
  const [winSize, setWinSize] = useState({ w: Math.min(window.innerWidth - 80, 1200), h: Math.min(window.innerHeight - 60, 800) });
  const [maximized, setMaximized] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const dragOff = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const prevState = useRef(null);

  // Drag header to move
  const onHeaderMouseDown = (e) => {
    if (maximized) return;
    e.preventDefault();
    setDragging(true);
    dragOff.current = { x: e.clientX - winPos.x, y: e.clientY - winPos.y };
  };
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => setWinPos({ x: e.clientX - dragOff.current.x, y: e.clientY - dragOff.current.y });
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragging]);

  // Resize from bottom-right corner
  const onResizeMouseDown = (e) => {
    if (maximized) return;
    e.preventDefault();
    e.stopPropagation();
    setResizing(true);
    resizeStart.current = { x: e.clientX, y: e.clientY, w: winSize.w, h: winSize.h };
  };
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e) => {
      const dw = e.clientX - resizeStart.current.x;
      const dh = e.clientY - resizeStart.current.y;
      setWinSize({ w: Math.max(600, resizeStart.current.w + dw), h: Math.max(400, resizeStart.current.h + dh) });
    };
    const onUp = () => setResizing(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [resizing]);

  // Maximize/restore
  const toggleMaximize = () => {
    if (maximized) {
      if (prevState.current) { setWinPos(prevState.current.pos); setWinSize(prevState.current.size); }
      setMaximized(false);
    } else {
      prevState.current = { pos: { ...winPos }, size: { ...winSize } };
      setWinPos({ x: 0, y: 0 });
      setWinSize({ w: window.innerWidth, h: window.innerHeight });
      setMaximized(true);
    }
  };

  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [tool, setTool] = useState('measure');
  const [color, setColor] = useState(COLORS[0]);
  const [items, setItems] = useState(initialItems || []);
  const [tempPt, setTempPt] = useState(null);
  const [areaPts, setAreaPts] = useState([]);
  const [calPx, setCalPx] = useState(null);
  const [calVal, setCalVal] = useState(1);
  const [calUnit, setCalUnit] = useState('m');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0); // degrees — any angle for north alignment
  const [northPt, setNorthPt] = useState(null); // first click of north arrow (base)
  const [mouse, setMouse] = useState(null);
  const [saveModal, setSaveModal] = useState(null); // { itemId, value }
  const [georefPts, setGeorefPts] = useState([]); // [{x, y}] — plan control points
  const idSeq = useRef(0);
  const panState = useRef({ panning: false, ox: 0, oy: 0 });
  const saveTimeout = useRef(null);

  // Restore calibration and idSeq from initial items
  useEffect(() => {
    if (initialItems?.length) {
      const maxId = Math.max(...initialItems.map(i => i.id || 0), 0);
      idSeq.current = maxId;
      const calItem = initialItems.find(i => i.type === 'cal');
      if (calItem) {
        setCalPx(calItem.pxDist / (calItem.calVal || 1));
        if (calItem.calVal) setCalVal(calItem.calVal);
        if (calItem.calUnit) setCalUnit(calItem.calUnit);
      }
    }
  }, []);

  // Auto-save measurements when items change (debounced)
  useEffect(() => {
    if (!onSaveMeasures) return;
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      // Include calibration state in cal items
      const toSave = items.map(it => it.type === 'cal' ? { ...it, calVal, calUnit } : it);
      onSaveMeasures(toSave);
    }, 1000);
    return () => { if (saveTimeout.current) clearTimeout(saveTimeout.current); };
  }, [items, calVal, calUnit]);

  // Screen to image coords
  const s2i = useCallback((e) => {
    const r = wrapRef.current.getBoundingClientRect();
    return { x: (e.clientX - r.left - pan.x) / zoom, y: (e.clientY - r.top - pan.y) / zoom };
  }, [zoom, pan]);

  const dist = (a, b) => Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);

  const fmtDist = useCallback((pxD) => {
    if (!calPx) return Math.round(pxD) + ' px';
    const real = pxD / calPx;
    if (calUnit === 'mm') return (real * 1000).toFixed(0) + ' mm';
    return real.toFixed(2) + ' ' + calUnit;
  }, [calPx, calUnit]);

  const fmtArea = useCallback((pxA) => {
    if (!calPx) return Math.round(pxA) + ' px²';
    const real = pxA / (calPx ** 2);
    return real.toFixed(2) + ' ' + calUnit + '²';
  }, [calPx, calUnit]);

  const polyArea = (pts) => {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return Math.abs(a) / 2;
  };

  // Fit view on load
  useEffect(() => {
    if (!imgLoaded || !wrapRef.current) return;
    const cw = wrapRef.current.clientWidth, ch = wrapRef.current.clientHeight;
    const z = Math.min(cw / imgSize.w, ch / imgSize.h) * 0.92;
    setZoom(z);
    setPan({ x: (cw - imgSize.w * z) / 2, y: (ch - imgSize.h * z) / 2 });
  }, [imgLoaded, imgSize]);

  // Mouse handlers
  const [ocrResult, setOcrResult] = useState(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrDrag, setOcrDrag] = useState(null); // {start: {x,y}, end: {x,y}}

  const handleMouseDown = (e) => {
    if (e.button === 1 || (e.button === 0 && tool === 'pan')) {
      panState.current = { panning: true, ox: e.clientX - pan.x, oy: e.clientY - pan.y };
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const pt = s2i(e);

    if (tool === 'north') {
      if (!northPt) {
        // First click — base of north arrow
        setNorthPt(pt);
      } else {
        // Second click — tip of north arrow. Calculate angle to rotate north up
        const dx = pt.x - northPt.x;
        const dy = pt.y - northPt.y;
        // Angle from base to tip in screen coords (Y down)
        // atan2 gives angle from positive X axis, we want angle from "up" (negative Y)
        const angleDeg = Math.atan2(dx, -dy) * 180 / Math.PI;
        // Rotate so this direction points up (subtract the angle)
        const newRotation = -angleDeg;
        setRotation(Math.round(newRotation * 10) / 10);
        setNorthPt(null);
        setTool('measure');
      }
      return;
    }

    if (tool === 'georef') {
      setGeorefPts(prev => [...prev, { x: pt.x, y: pt.y }]);
      return;
    }

    if (tool === 'grabtext') {
      // Start rectangle drag for OCR region
      setOcrDrag({ start: pt, end: pt });
      return;
    }

    if (tool === 'marker') {
      const label = prompt('Marker label:', 'Point ' + (idSeq.current + 1));
      if (label === null) return;
      idSeq.current++;
      setItems(prev => [...prev, { id: idSeq.current, type: 'marker', pt: { ...pt }, color, label: label || 'Point ' + idSeq.current }]);
    } else if (tool === 'measure' || tool === 'calibrate') {
      if (!tempPt) { setTempPt(pt); }
      else {
        const d = dist(tempPt, pt);
        idSeq.current++;
        if (tool === 'calibrate') {
          const realVal = calVal;
          if (!realVal || realVal <= 0) {
            alert('Enter the known distance in the Scale Calibration box first (bottom-left), then draw the line.');
            setTempPt(null);
            return;
          }
          const newCalPx = d / realVal;
          setCalPx(newCalPx);
          setItems(prev => [...prev, { id: idSeq.current, type: 'cal', p1: { ...tempPt }, p2: { ...pt }, pxDist: d, color: '#ffcf40', calVal: realVal }]);
          setTool('measure');
        } else {
          setItems(prev => [...prev, { id: idSeq.current, type: 'measure', p1: { ...tempPt }, p2: { ...pt }, pxDist: d, color, label: 'M' + idSeq.current }]);
        }
        setTempPt(null);
      }
    } else if (tool === 'area') {
      setAreaPts(prev => [...prev, pt]);
    }
  };

  const handleDblClick = () => {
    if (tool === 'area' && areaPts.length >= 3) {
      idSeq.current++;
      setItems(prev => [...prev, { id: idSeq.current, type: 'area', pts: [...areaPts], color, pxArea: polyArea(areaPts), label: 'A' + idSeq.current }]);
      setAreaPts([]);
    }
  };

  const handleMouseMove = (e) => {
    if (panState.current.panning) {
      setPan({ x: e.clientX - panState.current.ox, y: e.clientY - panState.current.oy });
      return;
    }
    const pt = s2i(e);
    setMouse(pt);
    // Update drag rectangle end point
    if (ocrDrag) {
      setOcrDrag(prev => prev ? { ...prev, end: pt } : null);
    }
  };

  const handleMouseUp = () => {
    panState.current.panning = false;
    // Complete OCR drag — send region to backend
    if (ocrDrag && ocrDrag.start && ocrDrag.end) {
      const x1 = Math.min(ocrDrag.start.x, ocrDrag.end.x);
      const y1 = Math.min(ocrDrag.start.y, ocrDrag.end.y);
      const x2 = Math.max(ocrDrag.start.x, ocrDrag.end.x);
      const y2 = Math.max(ocrDrag.start.y, ocrDrag.end.y);
      const w = x2 - x1, h = y2 - y1;
      if (w > 10 && h > 5) {
        setOcrLoading(true);
        setOcrResult(null);
        const imgEl = imgRef.current;
        const imgW = imgEl ? imgEl.naturalWidth : 1;
        const imgH = imgEl ? imgEl.naturalHeight : 1;
        const docId = appData?.documents?.find(d => (d.type || '').toLowerCase() === 'pdf' && (d.category || '').includes('Site'))?.id;
        const appDbId = appData?._dbId;
        if (docId && appDbId) {
          import('../../services/api').then(mod => {
            const api = mod.default;
            api.ocrRegion(appDbId, docId, { page: 1, x: x1, y: y1, width: w, height: h, img_width: imgW, img_height: imgH, rotation: rotation })
              .then(res => {
                setOcrResult({ text: res.text || '', x: (x1 + x2) / 2, y: (y1 + y2) / 2 });
                setOcrLoading(false);
              })
              .catch(err => { console.error('OCR failed:', err); setOcrResult({ text: '(OCR failed)', x: x1, y: y1 }); setOcrLoading(false); });
          });
        } else {
          setOcrResult({ text: '(no site plan document found)', x: x1, y: y1 });
          setOcrLoading(false);
        }
      }
      setOcrDrag(null);
    }
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const r = wrapRef.current.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const oldZ = zoom;
    const newZ = Math.max(0.08, Math.min(12, zoom * (e.deltaY < 0 ? 1.12 : 0.89)));
    setPan(p => ({ x: mx - (mx - p.x) * (newZ / oldZ), y: my - (my - p.y) * (newZ / oldZ) }));
    setZoom(newZ);
  };

  // Keyboard
  const prevToolRef = useRef('measure');
  useEffect(() => {
    const kd = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const switchTo = (t) => { if (tool !== 'pan') prevToolRef.current = tool; setTool(t); setTempPt(null); setOcrResult(null); setOcrLoading(false); };
      if (e.key === 'm') switchTo('measure');
      if (e.key === 'p') switchTo('marker');
      if (e.key === 'a') { setTool('area'); setTempPt(null); setOcrResult(null); }
      if (e.key === ' ') { if (tool !== 'pan') prevToolRef.current = tool; setTool('pan'); e.preventDefault(); }
      if (e.key === 'c') switchTo('calibrate');
      if (e.key === 't') switchTo('grabtext');
      if (e.key === 'g') switchTo('georef');
      if (e.key === 'n') { switchTo('north'); setNorthPt(null); }
      if (e.key === 'r') setRotation(r => (r + 90) % 360);
      if (e.key === 'R') setRotation(r => (r - 90 + 360) % 360);
      if (e.key === 'Escape') { setTempPt(null); setAreaPts([]); setOcrResult(null); setGeorefPts([]); if (onClose) onClose(); }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) setItems(prev => prev.slice(0, -1));
    };
    const ku = (e) => { if (e.key === ' ') setTool(prevToolRef.current || 'measure'); };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, [onClose, tool]);

  const deleteItem = (id) => setItems(prev => {
    const removed = prev.find(i => i.id === id);
    if (removed?.type === 'cal') setCalPx(null);
    return prev.filter(i => i.id !== id);
  });

  const getRealValue = (item) => {
    if (item.type === 'measure' && calPx) return (item.pxDist / calPx).toFixed(2);
    if (item.type === 'area' && calPx) return (item.pxArea / (calPx ** 2)).toFixed(2);
    return null;
  };

  // Render SVG overlay
  const renderSvg = () => {
    const esc = (t) => t?.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') || '';
    const labelBox = (x, y, angle, c, text) => {
      const w = text.length * 7.5 + 18;
      return `<rect x="${x - w / 2}" y="${y - 11}" width="${w}" height="21" rx="5" fill="rgba(12,14,20,0.92)" stroke="${c}" stroke-width="0.5" transform="rotate(${angle},${x},${y})"/>
        <text x="${x}" y="${y + 3.5}" text-anchor="middle" fill="${c}" font-family="monospace" font-size="11" font-weight="600" transform="rotate(${angle},${x},${y})">${esc(text)}</text>`;
    };

    let s = `<defs>
      <filter id="gl"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <marker id="aL" markerWidth="7" markerHeight="5" refX="0" refY="2.5" orient="auto"><path d="M7,0 L0,2.5 L7,5" fill="none" stroke="context-stroke" stroke-width="1"/></marker>
      <marker id="aR" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto"><path d="M0,0 L7,2.5 L0,5" fill="none" stroke="context-stroke" stroke-width="1"/></marker>
    </defs>`;

    // Temp line
    if (tempPt && mouse && (tool === 'measure' || tool === 'calibrate')) {
      const d = dist(tempPt, mouse);
      const mx = (tempPt.x + mouse.x) / 2, my = (tempPt.y + mouse.y) / 2;
      const ang = Math.atan2(mouse.y - tempPt.y, mouse.x - tempPt.x) * 180 / Math.PI;
      const ta = (ang > 90 || ang < -90) ? ang + 180 : ang;
      const c = tool === 'calibrate' ? '#ffcf40' : color;
      s += `<line x1="${tempPt.x}" y1="${tempPt.y}" x2="${mouse.x}" y2="${mouse.y}" stroke="${c}" stroke-width="2" stroke-dasharray="6,4" opacity="0.7"/>`;
      s += `<circle cx="${tempPt.x}" cy="${tempPt.y}" r="5" fill="${c}" opacity="0.8"/>`;
      s += labelBox(mx, my, ta, c, fmtDist(d));
    }
    if (tempPt && !mouse) {
      const c = tool === 'calibrate' ? '#ffcf40' : color;
      s += `<circle cx="${tempPt.x}" cy="${tempPt.y}" r="5" fill="${c}"/>`;
      s += `<circle cx="${tempPt.x}" cy="${tempPt.y}" r="5" fill="${c}"><animate attributeName="r" values="5;14;5" dur="1.4s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.5;0;0.5" dur="1.4s" repeatCount="indefinite"/></circle>`;
    }

    // Area in progress
    if (areaPts.length) {
      let pts = [...areaPts];
      if (mouse) pts.push(mouse);
      s += `<polygon points="${pts.map(p => p.x + ',' + p.y).join(' ')}" fill="${color}" fill-opacity="0.08" stroke="${color}" stroke-width="1.5" stroke-dasharray="6,3"/>`;
      pts.forEach(p => s += `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${color}"/>`);
      if (pts.length >= 3) {
        const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
        const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
        s += labelBox(cx, cy, 0, color, fmtArea(polyArea(pts)));
      }
    }

    // OCR drag rectangle
    if (ocrDrag && ocrDrag.start && ocrDrag.end) {
      const x1 = Math.min(ocrDrag.start.x, ocrDrag.end.x);
      const y1 = Math.min(ocrDrag.start.y, ocrDrag.end.y);
      const w = Math.abs(ocrDrag.end.x - ocrDrag.start.x);
      const h = Math.abs(ocrDrag.end.y - ocrDrag.start.y);
      s += `<rect x="${x1}" y="${y1}" width="${w}" height="${h}" fill="rgba(142,68,173,0.15)" stroke="#8e44ad" stroke-width="2" stroke-dasharray="6,3" rx="3"/>`;
    }

    // North arrow guide
    if (tool === 'north' && northPt) {
      const endPt = mouse || northPt;
      s += `<line x1="${northPt.x}" y1="${northPt.y}" x2="${endPt.x}" y2="${endPt.y}" stroke="#e67e22" stroke-width="3" stroke-dasharray="8,4" opacity="0.8"/>`;
      s += `<circle cx="${northPt.x}" cy="${northPt.y}" r="6" fill="#e67e22" stroke="#fff" stroke-width="2"/>`;
      s += `<circle cx="${endPt.x}" cy="${endPt.y}" r="5" fill="#e67e22" opacity="0.6"/>`;
      // Arrow head at endPt
      const dx = endPt.x - northPt.x, dy = endPt.y - northPt.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 10) {
        const nx = dx / len, ny = dy / len;
        const ax = endPt.x - nx * 12 - ny * 6, ay = endPt.y - ny * 12 + nx * 6;
        const bx = endPt.x - nx * 12 + ny * 6, by = endPt.y - ny * 12 - nx * 6;
        s += `<polygon points="${endPt.x},${endPt.y} ${ax},${ay} ${bx},${by}" fill="#e67e22" opacity="0.8"/>`;
      }
      s += `<text x="${northPt.x + 10}" y="${northPt.y - 8}" fill="#e67e22" font-size="11" font-weight="700">N ↑</text>`;
    }

    // Georef control points
    if (georefPts.length > 0) {
      // Draw polygon outline connecting points
      if (georefPts.length >= 2) {
        s += `<polyline points="${georefPts.map(p => p.x + ',' + p.y).join(' ')}" fill="none" stroke="#8e44ad" stroke-width="2" stroke-dasharray="8,4" opacity="0.7"/>`;
      }
      // Draw numbered circles
      georefPts.forEach((p, i) => {
        s += `<circle cx="${p.x}" cy="${p.y}" r="8" fill="#8e44ad" stroke="#fff" stroke-width="2"/>`;
        s += `<text x="${p.x}" y="${p.y + 4}" text-anchor="middle" fill="#fff" font-size="10" font-weight="bold">${i + 1}</text>`;
      });
    }

    // Saved items
    items.forEach(it => {
      if (it.type === 'measure' || it.type === 'cal') {
        const { p1, p2, color: c, pxDist } = it;
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
        const ta = (ang > 90 || ang < -90) ? ang + 180 : ang;
        const lbl = it.type === 'cal' ? calVal + ' ' + calUnit + ' (cal)' : fmtDist(pxDist);
        s += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${c}" stroke-width="2.5" marker-start="url(#aL)" marker-end="url(#aR)" filter="url(#gl)"/>`;
        s += `<circle cx="${p1.x}" cy="${p1.y}" r="4" fill="${c}"/><circle cx="${p2.x}" cy="${p2.y}" r="4" fill="${c}"/>`;
        s += labelBox(mx, my, ta, c, lbl);
      } else if (it.type === 'marker') {
        const { pt, color: c, label } = it;
        const tw = label.length * 7 + 16;
        s += `<circle cx="${pt.x}" cy="${pt.y}" r="11" fill="${c}" opacity="0.12"/><circle cx="${pt.x}" cy="${pt.y}" r="5.5" fill="${c}" stroke="rgba(12,14,20,0.7)" stroke-width="2"/>`;
        s += `<rect x="${pt.x + 10}" y="${pt.y - 10}" width="${tw}" height="20" rx="5" fill="rgba(12,14,20,0.92)" stroke="${c}" stroke-width="0.5"/>`;
        s += `<text x="${pt.x + 10 + tw / 2}" y="${pt.y + 3.5}" text-anchor="middle" fill="${c}" font-family="sans-serif" font-size="11" font-weight="600">${esc(label)}</text>`;
      } else if (it.type === 'area') {
        const { pts, color: c, pxArea } = it;
        const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
        const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
        s += `<polygon points="${pts.map(p => p.x + ',' + p.y).join(' ')}" fill="${c}" fill-opacity="0.1" stroke="${c}" stroke-width="2"/>`;
        pts.forEach(p => s += `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${c}"/>`);
        s += labelBox(cx, cy, 0, c, fmtArea(pxArea));
      }
    });

    return s;
  };

  const ToolBtn = ({ id, icon, label, active }) => (
    <button onClick={() => { setTool(id); setTempPt(null); if (id !== 'area') setAreaPts([]); setOcrResult(null); setOcrLoading(false); if (id !== 'north') setNorthPt(null); }}
      style={{ height: 32, padding: '0 12px', border: active ? '1px solid rgba(26,188,156,0.4)' : '1px solid transparent', background: active ? 'rgba(26,188,156,0.1)' : 'transparent', color: active ? '#16a085' : '#7a8a94', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: active ? 600 : 500, display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
      {icon} {label}
    </button>
  );

  const winStyle = maximized
    ? { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 10001 }
    : { position: 'fixed', top: winPos.y, left: winPos.x, width: winSize.w, height: winSize.h, zIndex: 10001 };

  return (
    <div style={{ ...winStyle, background: '#f5f7fa', display: 'flex', flexDirection: 'column', fontFamily: "'Outfit',sans-serif", color: '#1a3a4a', borderRadius: maximized ? 0 : 10, boxShadow: maximized ? 'none' : '0 12px 48px rgba(0,0,0,0.25)', border: maximized ? 'none' : '1px solid #d5dde2', overflow: 'hidden' }}>
      {/* Header — drag to move, double-click to maximize */}
      <div onMouseDown={onHeaderMouseDown} onDoubleClick={toggleMaximize}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', height: 48, background: '#fff', borderBottom: '1px solid #e4e9ec', flexShrink: 0, cursor: maximized ? 'default' : 'move', userSelect: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, background: 'linear-gradient(135deg, #1abc9c, #16a085)', borderRadius: 7, display: 'grid', placeItems: 'center', fontWeight: T.w.bold, fontSize: 11, color: '#fff' }}>SP</div>
          <span style={{ fontSize: 14, fontWeight: T.w.semi, color: '#1a3a4a' }}>Site Plan Measure</span>
          {appRef && <span style={{ fontSize: 11, color: '#95a5a6', marginLeft: 8 }}>{appRef}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <ToolBtn id="measure" icon="📏" label="Measure" active={tool === 'measure'} />
          <ToolBtn id="marker" icon="📍" label="Marker" active={tool === 'marker'} />
          <ToolBtn id="area" icon="⬜" label="Area" active={tool === 'area'} />
          <ToolBtn id="pan" icon="✋" label="Pan" active={tool === 'pan'} />
          <div style={{ width: 1, height: 20, background: '#e4e9ec', margin: '0 4px' }} />
          <ToolBtn id="calibrate" icon="📐" label="Calibrate" active={tool === 'calibrate'} />
          <ToolBtn id="grabtext" icon="📝" label="Grab Text" active={tool === 'grabtext'} />
          <ToolBtn id="north" icon="🧭" label="North" active={tool === 'north'} />
          <ToolBtn id="georef" icon="🗺️" label="Overlay" active={tool === 'georef'} />
          {tool === 'georef' && (
            <span style={{ fontSize: 10, color: '#8e44ad', fontWeight: T.w.bold, padding: '0 4px' }}>
              {georefPts.length} pts
              {georefPts.length >= 3 && (
                <button onClick={() => {
                  if (onGeorefPoints) {
                    const imgEl = imgRef.current;
                    onGeorefPoints(georefPts, imgUrl, imgEl?.naturalWidth || 1, imgEl?.naturalHeight || 1);
                  }
                  setTool('measure');
                }}
                  style={{ marginLeft: 6, padding: '2px 8px', borderRadius: T.r.sm, border: 'none', background: '#8e44ad', color: '#fff', fontWeight: T.w.bold, fontSize: 9, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Next: Mark on Map →
                </button>
              )}
              {georefPts.length > 0 && (
                <button onClick={() => setGeorefPts([])}
                  style={{ marginLeft: 4, padding: '2px 6px', borderRadius: T.r.sm, border: '1px solid #e4e9ec', background: '#fff', color: '#95a5a6', fontSize: 9, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Clear
                </button>
              )}
            </span>
          )}
          <div style={{ width: 1, height: 20, background: '#e4e9ec', margin: '0 4px' }} />
          <button onClick={() => setItems(prev => prev.slice(0, -1))} style={{ height: 32, padding: '0 12px', border: 'none', background: 'transparent', color: '#7a8a94', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 500 }}>↩ Undo</button>
          <button onClick={() => { setItems([]); setCalPx(null); setTempPt(null); setAreaPts([]); }} style={{ height: 32, padding: '0 12px', border: 'none', background: 'transparent', color: '#7a8a94', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 500 }}>🗑 Clear</button>
          <div style={{ width: 1, height: 20, background: '#e4e9ec', margin: '0 4px' }} />
          <button onClick={toggleMaximize} title={maximized ? "Restore" : "Maximize"}
            style={{ height: 32, padding: '0 8px', border: 'none', background: 'transparent', color: '#7a8a94', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}>{maximized ? '❐' : '□'}</button>
          <button onClick={onClose} style={{ height: 32, padding: '0 14px', border: '1px solid #e4e9ec', background: '#fff', color: '#1a3a4a', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: T.w.semi }}>✕ Close</button>
        </div>
      </div>

      {/* Workspace */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Canvas */}
        <div ref={wrapRef} style={{ flex: 1, overflow: 'hidden', position: 'relative', background: '#e8ecef', cursor: tool === 'pan' ? 'grab' : tool === 'grabtext' ? 'text' : tool === 'georef' ? 'crosshair' : 'crosshair' }}
          onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp} onDoubleClick={handleDblClick} onWheel={handleWheel}>
          <div ref={innerRef} style={{ position: 'absolute', transformOrigin: '0 0', transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom}) rotate(${rotation}deg)` }}>
            <img ref={imgRef} src={imgUrl} crossOrigin="anonymous" alt="Site Plan"
              onLoad={(e) => { setImgSize({ w: e.target.naturalWidth, h: e.target.naturalHeight }); setImgLoaded(true); }}
              style={{ display: 'block', userSelect: 'none' }} draggable={false} />
            <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" width={imgSize.w} height={imgSize.h}
              style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
              dangerouslySetInnerHTML={{ __html: renderSvg() }} />
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ width: 280, background: '#fff', borderLeft: '1px solid #e4e9ec', display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid #e4e9ec', display: 'flex', justifyContent: 'space-between', fontWeight: T.w.semi, fontSize: 13, color: '#1a3a4a' }}>
            <span>Measurements</span>
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#95a5a6' }}>{items.length} item{items.length !== 1 ? 's' : ''}</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
            {/* Calibration */}
            <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1.2, color: '#95a5a6', fontWeight: T.w.semi, marginBottom: 8 }}>Scale Calibration</div>
            <div style={{ background: '#f5f8fa', border: '1px solid #e4e9ec', borderRadius: T.r.lg, padding: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="number" value={calVal} onChange={e => { setCalVal(parseFloat(e.target.value) || 1); if (calPx) { const ci = items.find(i => i.type === 'cal'); if (ci) setCalPx(ci.pxDist / (parseFloat(e.target.value) || 1)); } }}
                  style={{ flex: 1, background: '#fff', border: '1px solid #d5dde2', borderRadius: T.r.md, padding: '6px 8px', color: '#1a3a4a', fontFamily: 'monospace', fontSize: 12, outline: 'none' }} />
                <select value={calUnit} onChange={e => setCalUnit(e.target.value)}
                  style={{ background: '#fff', border: '1px solid #d5dde2', borderRadius: T.r.md, padding: '6px 8px', color: '#1a3a4a', fontSize: 12, outline: 'none' }}>
                  <option value="m">m</option><option value="mm">mm</option><option value="ft">ft</option>
                </select>
              </div>
              <div style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 11, color: calPx ? '#1abc9c' : '#95a5a6' }}>
                {calPx ? `Scale: ${calPx.toFixed(1)} px/${calUnit}` : 'Draw a calibration line to set scale'}
              </div>
            </div>

            {/* Colors */}
            <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1.2, color: '#95a5a6', fontWeight: T.w.semi, marginBottom: 8 }}>Color</div>
            <div style={{ display: 'flex', gap: 5, marginBottom: 12 }}>
              {COLORS.map(c => (
                <div key={c} onClick={() => setColor(c)}
                  style={{ width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer', border: color === c ? '2.5px solid #1a3a4a' : '2.5px solid transparent', transform: color === c ? 'scale(1.15)' : 'none', transition: 'all 0.12s' }} />
              ))}
            </div>

            {/* Items */}
            <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1.2, color: '#95a5a6', fontWeight: T.w.semi, marginBottom: 8 }}>Items</div>
            {items.length === 0 && (
              <div style={{ textAlign: 'center', padding: '24px 14px', color: '#95a5a6', fontSize: 12, lineHeight: 1.7 }}>
                Click on the plan to measure distances or place markers.
              </div>
            )}
            {items.map(it => (
              <div key={it.id} style={{ background: '#f5f8fa', border: '1px solid #e4e9ec', borderRadius: 9, padding: '10px 11px', marginBottom: 5 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div style={{ width: 9, height: 9, borderRadius: '50%', background: it.color, flexShrink: 0 }} />
                  <div style={{ fontSize: 12, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#1a3a4a' }}>
                    {it.type === 'cal' ? 'Calibration' : it.label || it.type}
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: T.w.semi, color: it.type === 'cal' ? '#e67e22' : '#2980b9', whiteSpace: 'nowrap' }}>
                    {it.type === 'measure' ? fmtDist(it.pxDist) : it.type === 'area' ? fmtArea(it.pxArea) : it.type === 'cal' ? `${it.calVal || calVal} ${calUnit} (cal)` : 'Marker'}
                  </div>
                  {/* Save to AI field button — always visible */}
                  {(it.type === 'measure' || it.type === 'area') && onSaveField && (
                    <button onClick={() => setSaveModal({ itemId: it.id, value: calPx ? getRealValue(it) : (it.type === 'measure' ? it.pxDist.toFixed(1) : it.pxArea.toFixed(1)) })}
                      style={{ background: '#e8f8f5', border: '1px solid #1abc9c', color: '#1abc9c', cursor: 'pointer', fontSize: 9, padding: '1px 5px', borderRadius: T.r.sm, fontWeight: T.w.bold, fontFamily: 'inherit' }}
                      title="Save to AI field">💾 Save</button>
                  )}
                  <button onClick={() => deleteItem(it.id)}
                    style={{ background: 'none', border: 'none', color: '#bdc3c7', cursor: 'pointer', fontSize: 15, padding: '0 2px', lineHeight: 1 }}>×</button>
                </div>
                <div style={{ fontSize: 10, color: '#95a5a6', marginTop: 3, paddingLeft: 16, fontFamily: 'monospace' }}>
                  {it.type === 'measure' || it.type === 'cal' ? Math.round(it.pxDist) + ' px' : it.type === 'area' ? it.pts.length + ' vertices' : `${Math.round(it.pt.x)}, ${Math.round(it.pt.y)}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div style={{ height: 26, padding: '0 16px', background: '#fff', borderTop: '1px solid #e4e9ec', display: 'flex', alignItems: 'center', gap: 20, fontSize: 10, color: '#95a5a6', fontFamily: 'monospace', flexShrink: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#1abc9c' }} />
          {tool.charAt(0).toUpperCase() + tool.slice(1)}
        </span>
        {mouse && <span>X:{Math.round(mouse.x)} Y:{Math.round(mouse.y)}</span>}
        {onSaveField && (
          <button onClick={() => setSaveModal({ itemId: null, value: '', isManual: true })}
            style={{ background: '#E3F2FD', border: '1px solid #1565C0', color: '#1565C0', cursor: 'pointer', fontSize: 9, padding: '1px 8px', borderRadius: T.r.sm, fontWeight: T.w.bold, fontFamily: 'inherit' }}
            title="Manually set an AI field value">✏️ Set Field</button>
        )}
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setRotation(r => (r - 90 + 360) % 360)} title="Preview rotate left (visual only)"
          style={{ padding: '2px 6px', borderRadius: T.r.sm, border: '1px solid #d5dde2', background: '#fff', color: '#7a8a94', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>↺</button>
        <button onClick={() => setRotation(r => (r + 90) % 360)} title="Preview rotate right (visual only)"
          style={{ padding: '2px 6px', borderRadius: T.r.sm, border: '1px solid #d5dde2', background: '#fff', color: '#7a8a94', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>↻</button>
        {rotation !== 0 && (
          <>
            <span style={{ fontSize: 9, color: '#8e44ad', fontWeight: T.w.bold }}>{Math.round(rotation * 10) / 10}°</span>
            <button onClick={async () => {
              const docId = appData?.documents?.find(d => (d.type || '').toLowerCase() === 'pdf' && (d.category || '').includes('Site'))?.id;
              const appDbId = appData?._dbId;
              if (!docId || !appDbId) { alert('No PDF document found'); return; }
              try {
                const api = (await import('../../services/api')).default;
                await api.rotatePdf(appDbId, docId, rotation);
                setRotation(0);
                // Reload the image by appending cache-bust
                if (imgRef.current) {
                  const src = imgRef.current.src.split('?')[0];
                  imgRef.current.src = src + '?t=' + Date.now();
                }
              } catch (err) { alert('Rotate failed: ' + err.message); }
            }} title="Save rotation permanently to the PDF file"
              style={{ padding: '2px 8px', borderRadius: T.r.sm, border: 'none', background: '#e67e22', color: '#fff', fontSize: 9, fontWeight: T.w.bold, cursor: 'pointer', fontFamily: 'inherit' }}>
              Save Rotation
            </button>
          </>
        )}
        {ocrLoading && <span style={{ color: '#8e44ad', fontWeight: T.w.bold }}>🔍 Reading text...</span>}
        {tool === 'grabtext' && !ocrLoading && <span style={{ color: '#8e44ad', fontWeight: T.w.semi }}>Click on text in the plan to grab it</span>}
        {tool === 'north' && <span style={{ color: '#e67e22', fontWeight: T.w.semi }}>{northPt ? 'Click the TIP of the north arrow' : 'Click the BASE of the north arrow'}</span>}
        {tool === 'georef' && <span style={{ color: '#8e44ad', fontWeight: T.w.semi }}>Click lot corners in order (min 3). Then click "Next: Mark on Map"</span>}
        <span style={{ marginLeft: 'auto' }}>M P A Space C T N G r R</span>
      </div>

      {/* OCR Result — show detected text with save option */}
      {ocrResult && ocrResult.text && (
        <div style={{ position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)', zIndex: 10003,
          background: '#fff', border: '2px solid #8e44ad', borderRadius: 12, padding: '12px 16px', boxShadow: '0 8px 32px rgba(0,0,0,0.2)', minWidth: 280, maxWidth: 420 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: T.w.bold, color: '#8e44ad' }}>📝 Detected Text</span>
            <button onClick={() => setOcrResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#95a5a6', fontSize: 14 }}>✕</button>
          </div>
          <div style={{ fontSize: 16, fontWeight: T.w.black, color: T.c.text, fontFamily: 'monospace', background: '#f5f0ff', padding: '8px 12px', borderRadius: T.r.md, marginBottom: 8, wordBreak: 'break-all' }}>
            {ocrResult.text}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => { setSaveModal({ itemId: null, value: ocrResult.text, isManual: true }); setOcrResult(null); }}
              style={{ flex: 1, padding: '7px 12px', borderRadius: T.r.md, border: 'none', background: 'linear-gradient(135deg, #8e44ad, #9b59b6)', color: '#fff', fontWeight: T.w.bold, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
              Save to Field
            </button>
            <button onClick={() => { navigator.clipboard?.writeText(ocrResult.text); }}
              style={{ padding: '7px 12px', borderRadius: T.r.md, border: '1px solid #e4e9ec', background: '#fff', color: T.c.textSecondary, fontWeight: T.w.semi, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
              Copy
            </button>
          </div>
        </div>
      )}

      {/* Resize handle — bottom right corner */}
      {!maximized && (
        <div onMouseDown={onResizeMouseDown}
          style={{ position: 'absolute', bottom: 0, right: 0, width: 18, height: 18, cursor: 'nwse-resize', zIndex: 2 }}>
          <svg width="18" height="18" viewBox="0 0 18 18" style={{ opacity: 0.3 }}>
            <line x1="14" y1="4" x2="4" y2="14" stroke="#7a8a94" strokeWidth="1.5"/>
            <line x1="14" y1="8" x2="8" y2="14" stroke="#7a8a94" strokeWidth="1.5"/>
            <line x1="14" y1="12" x2="12" y2="14" stroke="#7a8a94" strokeWidth="1.5"/>
          </svg>
        </div>
      )}

      {/* Save to AI field modal */}
      {saveModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10002, display: 'grid', placeItems: 'center' }}
          onClick={(e) => { if (e.target === e.currentTarget) setSaveModal(null); }}>
          <div style={{ background: '#fff', border: '1px solid #e4e9ec', borderRadius: 14, padding: 24, width: 420, maxHeight: '70vh', overflow: 'auto', boxShadow: '0 12px 48px rgba(0,0,0,0.15)' }}>
            <div style={{ fontSize: 15, fontWeight: T.w.bold, color: '#1a3a4a', marginBottom: 4 }}>💾 {saveModal.isManual ? 'Set AI Field Value' : 'Save Measurement as Correction'}</div>
            <div style={{ fontSize: 12, color: '#7a8a94', marginBottom: 8 }}>
              {saveModal.isManual ? 'Enter a value and select the field to save it to.' : <>Measured: <span style={{ color: '#1abc9c', fontFamily: 'monospace', fontWeight: T.w.semi }}>{saveModal.value} {calUnit}</span></>}
              {!saveModal.isManual && ' — This will override the AI-extracted value and re-run assessment.'}
            </div>
            {/* Editable value input */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 11, fontWeight: T.w.semi, color: '#5a6a74' }}>Value:</span>
              <input type="text" value={saveModal.value} onChange={e => setSaveModal(m => ({...m, value: e.target.value}))}
                style={{ flex: 1, padding: '6px 10px', borderRadius: T.r.md, border: '1.5px solid #1abc9c', fontSize: 13, fontFamily: 'monospace', fontWeight: T.w.bold, color: '#1a3a4a', outline: 'none' }}
                autoFocus placeholder="Enter value..." />
            </div>
            <div style={{ fontSize: 10, color: '#7a8a94', marginBottom: 8, fontWeight: T.w.semi }}>Select field to save to:</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {AI_FIELDS.map(f => {
                const spd = appData?.cor_site_plan_data || appData?.site_plan_data;
                const extraction = spd?.extraction || spd || {};
                const parts = f.key.split('.');
                let current = extraction;
                for (const p of parts) { current = current?.[p]; }
                const currentStr = current != null ? String(current) : '—';
                const newVal = saveModal.value;
                return (
                  <button key={f.key} onClick={() => { if (onSaveField) { const v = isNaN(newVal) ? newVal : parseFloat(newVal); onSaveField(f.key, v, f.unit || calUnit); } setSaveModal(null); }}
                    disabled={!newVal && newVal !== 0}
                    style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', background: '#f5f8fa', border: '1px solid #e4e9ec', borderRadius: T.r.md, color: '#1a3a4a', cursor: newVal ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontSize: 12, transition: 'border-color 0.15s', gap: 8, opacity: newVal ? 1 : 0.5 }}
                    onMouseEnter={e => { if (newVal) e.currentTarget.style.borderColor = '#1abc9c'; }} onMouseLeave={e => e.currentTarget.style.borderColor = '#e4e9ec'}>
                    <span style={{ flex: 1, textAlign: 'left' }}>{f.label}</span>
                    <span style={{ fontSize: 10, color: '#e74c3c', fontFamily: 'monospace', minWidth: 60, textAlign: 'right' }}>{currentStr}</span>
                    <span style={{ fontSize: 10, color: '#95a5a6' }}>→</span>
                    <span style={{ fontSize: 10, color: '#1abc9c', fontFamily: 'monospace', fontWeight: T.w.semi, minWidth: 60, textAlign: 'right' }}>{newVal || '...'}</span>
                  </button>
                );
              })}
            </div>
            <button onClick={() => setSaveModal(null)} style={{ marginTop: 12, width: '100%', padding: '8px', background: '#fff', border: '1px solid #e4e9ec', borderRadius: T.r.md, color: '#7a8a94', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
