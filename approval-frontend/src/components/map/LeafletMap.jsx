import { useRef, useState, useEffect } from "react";
import { TILE_LAYERS, STATUS_CONFIG } from '../../data/constants';
import useLeaflet from '../../hooks/useLeaflet';
import { getAppCoords } from '../../utils/geoHelpers';

// ═══════════════════════════════════════════════════════════
//  LEAFLET MAP COMPONENT
// ═══════════════════════════════════════════════════════════
export default function LeafletMap({ apps, selectedApp, onSelectApp, height = 500, drawMode = null, onMapClick = null, sightTriangle = null, showLots = false, lotsData = null, showSpeedRoads = false, speedRoadsData = null, onLotClick = null, allLotsData = null, clickedLot = null, analysisResult = null, forceLayer = null }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const containerRef = useRef(null);
  const lotsLayerRef = useRef(null);
  const speedLayerRef = useRef(null);
  const drawModeRef = useRef(drawMode);
  const leafletLoaded = useLeaflet();
  const [activeLayer, setActiveLayer] = useState("street");
  const tileLayerRef = useRef(null);


  // Keep drawModeRef in sync so lot click handler can check without layer rebuild
  useEffect(() => { drawModeRef.current = drawMode; }, [drawMode]);

  // Invalidate map size when height changes (e.g. fullscreen toggle)
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    setTimeout(() => { mapInstanceRef.current.invalidateSize(); }, 100);
  }, [height]);


  // Initialize map
  useEffect(() => {
    if (!leafletLoaded || !mapRef.current || mapInstanceRef.current) return;
    const L = window.L;
    const map = L.map(mapRef.current, { zoomControl: true, attributionControl: true }).setView([-31.97, 116.06], 13);
    tileLayerRef.current = L.tileLayer(TILE_LAYERS.street.url, { attribution: TILE_LAYERS.street.attr, maxZoom: 19 }).addTo(map);
    mapInstanceRef.current = map;

    return () => { map.remove(); mapInstanceRef.current = null; };
  }, [leafletLoaded]);

  // Switch tile layer
  useEffect(() => {
    if (!mapInstanceRef.current || !tileLayerRef.current) return;
    const L = window.L;
    const layer = forceLayer || activeLayer;
    mapInstanceRef.current.removeLayer(tileLayerRef.current);
    tileLayerRef.current = L.tileLayer(TILE_LAYERS[layer].url, { attribution: TILE_LAYERS[layer].attr, maxZoom: 19 }).addTo(mapInstanceRef.current);
  }, [activeLayer, forceLayer]);

  // Add markers for applications
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    const L = window.L;
    markersRef.current.forEach(m => mapInstanceRef.current.removeLayer(m));
    markersRef.current = [];

    apps.forEach(app => {
      const coords = getAppCoords(allLotsData, app, speedRoadsData);
      if (!coords) return;
      const sc = STATUS_CONFIG[app.status];
      const isSelected = selectedApp?.id === app.id;

      const icon = L.divIcon({
        className: '',
        html: `<div style="position:relative;cursor:pointer;">
          <svg width="${isSelected?32:24}" height="${isSelected?38:30}" viewBox="0 0 36 44">
            <path d="M18,42 C18,42 2,26 2,16 C2,7.2 9.2,0 18,0 C26.8,0 34,7.2 34,16 C34,26 18,42 18,42Z" fill="${sc.mapColor}" stroke="#fff" stroke-width="2.5" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))"/>
            <circle cx="18" cy="16" r="7" fill="#fff"/>
            <text x="18" y="20" text-anchor="middle" font-size="11" font-weight="bold" fill="${sc.mapColor}">${sc.icon}</text>
          </svg>
          ${isSelected ? '<div style="position:absolute;top:-8px;left:50%;transform:translateX(-50%);background:#1a3a4a;color:#fff;padding:2px 6px;border-radius:4px;font-size:9px;font-weight:700;white-space:nowrap;font-family:sans-serif;">' + app.id + '</div>' : ''}
        </div>`,
        iconSize: [isSelected?32:24, isSelected?38:30],
        iconAnchor: [isSelected?16:12, isSelected?38:30],
      });

      const marker = L.marker([coords.lat, coords.lng], { icon })
        .bindPopup(`
          <div style="font-family:'DM Sans',sans-serif;min-width:200px;">
            <div style="font-weight:800;font-size:14px;color:#1a3a4a;margin-bottom:4px;">${app.id}</div>
            <div style="font-size:12px;color:#5a6a74;margin-bottom:6px;">${app.owner.name}</div>
            <div style="font-size:11px;color:#7a8a94;margin-bottom:4px;">📍 ${app.property.address}</div>
            <div style="font-size:11px;color:#7a8a94;margin-bottom:6px;">🛣 ${app.property.roadName} (${app.property.roadType})</div>
            <div style="font-size:11px;margin-bottom:6px;"><span style="background:${sc.bg};color:${sc.color};padding:2px 8px;border-radius:4px;font-weight:700;">${sc.icon} ${sc.label}</span></div>
            <div style="font-size:11px;color:#5a6a74;">Width: ${app.crossover.width}m | Frontage: ${app.property.frontage}m</div>
          </div>
        `, { maxWidth: 280 })
        .on('click', () => onSelectApp(app))
        .addTo(mapInstanceRef.current);
      markersRef.current.push(marker);
    });
  }, [apps, selectedApp, leafletLoaded, onSelectApp, allLotsData]);

  // Fly to selected
  useEffect(() => {
    if (!mapInstanceRef.current || !selectedApp) return;
    const c = getAppCoords(allLotsData, selectedApp, speedRoadsData);
    if (c) mapInstanceRef.current.flyTo([c.lat, c.lng], 18, { duration: 1.2 });
  }, [selectedApp, allLotsData]);

  // Map click for draw mode
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    const handler = (e) => { if (onMapClick && drawMode) onMapClick(e.latlng); };
    if (drawMode) {
      mapInstanceRef.current.getContainer().style.cursor = 'crosshair';
      mapInstanceRef.current.on('click', handler);
    } else {
      mapInstanceRef.current.getContainer().style.cursor = '';
      mapInstanceRef.current.off('click', handler);
    }
    return () => { mapInstanceRef.current?.off('click', handler); if (mapInstanceRef.current) mapInstanceRef.current.getContainer().style.cursor = ''; };
  }, [drawMode, onMapClick, leafletLoaded]);

  // Render GeoJSON lot boundaries layer
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    if (lotsLayerRef.current) { mapInstanceRef.current.removeLayer(lotsLayerRef.current); lotsLayerRef.current = null; }
    if (!showLots || !lotsData) return;
    const L = window.L;
    lotsLayerRef.current = L.geoJSON(lotsData, {
      style: (feature) => {
        const p = feature.properties;
        const selAddr = selectedApp?.property;
        const isMatch = selAddr && p.rd && p.n && (
          (selAddr.address.toUpperCase().includes(p.rd) && selAddr.address.includes(p.n))
        );
        return {
          color: isMatch ? '#e74c3c' : '#2980b9',
          weight: isMatch ? 3 : 1,
          fillColor: isMatch ? '#e74c3c' : '#3498db',
          fillOpacity: isMatch ? 0.25 : 0.06,
          opacity: isMatch ? 1 : 0.5,
        };
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        const addr = [p.n, p.rd, p.rt].filter(Boolean).join(' ');
        layer.bindTooltip(`<b>${addr}</b><br/>${p.loc}`, { sticky: true, className: 'lot-tooltip' });
        layer.on('click', (e) => {
          // During draw mode, don't intercept — let the map click handler take it
          if (drawModeRef.current) return;
          L.DomEvent.stopPropagation(e);
          const coords = feature.geometry.coordinates;
          const ring = coords[0] || coords;
          const poly = ring.map(c => [c[1], c[0]]);
          if (onLotClick) onLotClick({ properties: p, polygon: poly, address: addr });
        });
      },
    }).addTo(mapInstanceRef.current);
  }, [showLots, lotsData, selectedApp, leafletLoaded, onLotClick]);

  // Render selected app lot polygon (derived from lotsData)
  const appLotRef = useRef(null);
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    if (appLotRef.current) { mapInstanceRef.current.removeLayer(appLotRef.current); appLotRef.current = null; }
    if (!selectedApp) return;
    const coords = getAppCoords(allLotsData, selectedApp, speedRoadsData);
    if (!coords?.lotPoly) return;
    const L = window.L;
    appLotRef.current = L.polygon(coords.lotPoly, {
      color: '#e74c3c', weight: 3, fillColor: '#e74c3c', fillOpacity: 0.15, dashArray: '6,3',
    }).addTo(mapInstanceRef.current);
  }, [selectedApp, leafletLoaded, allLotsData]);

  // Highlight clicked lot boundary
  const clickedLotRef = useRef(null);
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    if (clickedLotRef.current) { mapInstanceRef.current.removeLayer(clickedLotRef.current); clickedLotRef.current = null; }
    if (!clickedLot?.polygon || clickedLot.polygon.length < 3) return;
    const L = window.L;
    clickedLotRef.current = L.polygon(clickedLot.polygon, {
      color: '#f39c12', weight: 3, fillColor: '#f39c12', fillOpacity: 0.2, dashArray: '5,4',
    }).addTo(mapInstanceRef.current);
  }, [clickedLot, leafletLoaded]);

  // Render speed limit road network
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    if (speedLayerRef.current) { mapInstanceRef.current.removeLayer(speedLayerRef.current); speedLayerRef.current = null; }
    if (!showSpeedRoads || !speedRoadsData?.features) return;
    const L = window.L;
    const speedColors = { 10: '#27ae60', 40: '#2ecc71', 50: '#f1c40f', 60: '#e67e22', 70: '#e74c3c', 80: '#c0392b', 90: '#8e44ad', 100: '#6c3483', 110: '#1a0530' };
    speedLayerRef.current = L.geoJSON(speedRoadsData, {
      style: (feature) => {
        const sp = feature.properties.sp || 50;
        return { color: speedColors[sp] || '#f1c40f', weight: 4, opacity: 0.8 };
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        layer.bindTooltip(`<b>${p.rd}</b><br/>${p.sp} km/h<br/><i>${p.nt}</i>`, { sticky: true, className: 'lot-tooltip' });
      },
    }).addTo(mapInstanceRef.current);
  }, [showSpeedRoads, leafletLoaded]);

  // Render sight triangle layers
  const triLayersRef = useRef([]);
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    triLayersRef.current.forEach(l => mapInstanceRef.current.removeLayer(l));
    triLayersRef.current = [];
    if (!sightTriangle) return;
    const L = window.L;
    const { ptA, ptB, triLeft, triRight, lineAB, propertyLine, intersections, analysis } = sightTriangle;
    // Point A marker (driveway)
    if (ptA) {
      const mA = L.circleMarker([ptA.lat, ptA.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#e74c3c', fillOpacity: 1, pane: 'markerPane' }).addTo(mapInstanceRef.current);
      triLayersRef.current.push(mA);
    }
    // Point B marker (road)
    if (ptB) {
      const mB = L.circleMarker([ptB.lat, ptB.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#2980b9', fillOpacity: 1, pane: 'markerPane' }).addTo(mapInstanceRef.current);
      triLayersRef.current.push(mB);
  }
    // Triangle polygon (A, triLeft, triRight)
    if (triLeft && triRight && ptA) {
      const compliant = analysis?.compliant !== false;
      const tri = L.polygon([[ptA.lat, ptA.lng], [triLeft.lat, triLeft.lng], [triRight.lat, triRight.lng]], {
        color: compliant ? '#27ae60' : '#e74c3c', weight: 2.5, fillColor: compliant ? '#27ae60' : '#e74c3c', fillOpacity: compliant ? 0.15 : 0.2, dashArray: compliant ? null : '6,4',
      }).addTo(mapInstanceRef.current);
      triLayersRef.current.push(tri);
  }
    // Arrow lines from ptA to nearest point on each lot boundary side
    const bdColors = ['#e74c3c', '#e67e22', '#f39c12', '#2ecc71', '#3498db', '#9b59b6', '#1abc9c'];
    if (sightTriangle.boundaryDists && ptA) {
      sightTriangle.boundaryDists.forEach((bd, i) => {
        const clr = bdColors[i % bdColors.length];
        // Dashed arrow line from ptA to nearest point on this side
        const al = L.polyline([[ptA.lat, ptA.lng], [bd.nearPt.lat, bd.nearPt.lng]], {
          color: clr, weight: i === 0 ? 3 : 1.5, dashArray: i === 0 ? '8,4' : '4,6', opacity: i === 0 ? 0.9 : 0.5
        }).addTo(mapInstanceRef.current);
        triLayersRef.current.push(al);
        // Distance label at midpoint
        const midLat = (ptA.lat + bd.nearPt.lat) / 2, midLng = (ptA.lng + bd.nearPt.lng) / 2;
        const lbl = L.marker([midLat, midLng], { icon: L.divIcon({ className:'', html:`<div style="background:${clr};color:#fff;padding:2px 6px;border-radius:3px;font-size:${i===0?11:9}px;font-weight:700;font-family:sans-serif;box-shadow:0 1px 3px rgba(0,0,0,0.2);white-space:nowrap;">→ ${bd.distLabel}m ${i===0?'(nearest)':''}</div>`, iconAnchor:[40,10]})}).addTo(mapInstanceRef.current);
        triLayersRef.current.push(lbl);
        // Small marker at the nearest point on boundary side
        const pm = L.circleMarker([bd.nearPt.lat, bd.nearPt.lng], { radius: i === 0 ? 5 : 3, color: clr, weight: 2, fillColor: '#fff', fillOpacity: 1 })
          .bindTooltip(`Side ${bd.idx+1}: ${bd.distLabel}m (${bd.sideLen}m long)`, { direction: 'bottom' }).addTo(mapInstanceRef.current);
        triLayersRef.current.push(pm);
      });
    }
  }, [sightTriangle, leafletLoaded]);

  // Render 3D analysis obstruction points as red dots on the map
  const obsLayerRef = useRef([]);
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    obsLayerRef.current.forEach(m => mapInstanceRef.current.removeLayer(m));
    obsLayerRef.current = [];
    if (!analysisResult?.obstructions?.length) return;
    const L = window.L;

    analysisResult.obstructions.forEach(obs => {
      const pt = obs.point;
      if (!pt?.lat || !pt?.lng) return;
      const isCritical = obs.isCritical;
      const color = isCritical ? '#ff0000' : '#e74c3c';
      const radius = isCritical ? 7 : 5;
      const name = obs.feature?.name || obs.feature?.type || 'Obstruction';
      const excess = obs.excessHeight != null ? obs.excessHeight.toFixed(2) : '?';
      const dist = obs.distFromA != null ? obs.distFromA.toFixed(0) : '?';
      const marker = L.circleMarker([pt.lat, pt.lng], {
        radius, color: '#fff', weight: 2, fillColor: color, fillOpacity: 0.9,
      }).bindTooltip(
        `<b style="color:${color}">${isCritical ? '⚠ ' : ''}${name}</b><br/>` +
        `Exceeds ray: <b>${excess}m</b><br/>` +
        `Distance: ${dist}m from observer`,
        { direction: 'top', className: 'obstruction-tooltip' }
      ).addTo(mapInstanceRef.current);
      obsLayerRef.current.push(marker);
    });
  }, [analysisResult, leafletLoaded]);


  return (
    <div ref={containerRef} style={{ position: "relative", borderRadius: 14, overflow: "hidden", border: "1px solid #e4e9ec" }}>
      {/* Layer switcher */}
      <div style={{ position: "absolute", top: 10, right: 10, zIndex: 1000, display: "flex", gap: 2, background: "#fff", borderRadius: 8, padding: 3, boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>
        {Object.entries(TILE_LAYERS).map(([key, layer]) => (
          <button key={key} onClick={() => setActiveLayer(key)}
            style={{ padding: "6px 12px", borderRadius: 6, border: "none", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              background: activeLayer === key ? "#1a3a4a" : "transparent", color: activeLayer === key ? "#fff" : "#5a6a74" }}>
            {layer.label}
          </button>
        ))}
      </div>
      <div ref={mapRef} style={{ height, width: "100%" }} />
    </div>
  );
}
