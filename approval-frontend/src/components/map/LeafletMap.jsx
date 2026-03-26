import { useRef, useState, useEffect } from "react";
import { TILE_LAYERS, STATUS_CONFIG } from '../../data/constants';
import useLeaflet from '../../hooks/useLeaflet';
import { getAppCoords } from '../../utils/geoHelpers';

// ═══════════════════════════════════════════════════════════
//  LEAFLET MAP COMPONENT
// ═══════════════════════════════════════════════════════════
export default function LeafletMap({ apps, selectedApp, onSelectApp, height = 500, drawMode = null, onMapClick = null, sightTriangle = null, showLots = false, lotsData = null, showSpeedRoads = false, speedRoadsData = null, onLotClick = null, allLotsData = null, clickedLot = null, analysisResult = null, forceLayer = null, onSightPointDrag = null, showBoundaries = false, boundaryData = null, waLayers = {}, mapTool = null, setMapTool = null, measureDist = null, setMeasureDist = null, radiusResult = null, setRadiusResult = null, centrelineDist = null, setCentrelineDist = null, offsetState = null, setOffsetState = null, onOffsetSightTriangle = null }) {
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

  // Keep mapToolRef in sync
  const mapToolRef = useRef(mapTool);
  useEffect(() => { mapToolRef.current = mapTool; }, [mapTool]);

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

  // Add markers for applications — if selectedApp exists, show only that one
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    const L = window.L;
    markersRef.current.forEach(m => mapInstanceRef.current.removeLayer(m));
    markersRef.current = [];

    const appsToShow = selectedApp ? [selectedApp] : apps;

    appsToShow.forEach(app => {
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
        .on('click', () => { if (!mapToolRef.current) onSelectApp(app); })
        .addTo(mapInstanceRef.current);
      markersRef.current.push(marker);
    });
  }, [apps, selectedApp, leafletLoaded, onSelectApp, allLotsData]);

  // Fly to selected — zoom to property level
  useEffect(() => {
    if (!mapInstanceRef.current || !selectedApp) return;
    const c = getAppCoords(allLotsData, selectedApp, speedRoadsData);
    if (c) mapInstanceRef.current.flyTo([c.lat, c.lng], 19, { duration: 1 });
  }, [selectedApp, allLotsData]);

  // Map click for sight triangle draw mode — disabled when measure/draw tool active
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    if (mapTool === "measure" || mapTool === "draw") return; // Tools take priority
    const handler = (e) => { if (onMapClick && drawMode) onMapClick(e.latlng); };
    if (drawMode) {
      mapInstanceRef.current.getContainer().style.cursor = 'crosshair';
      mapInstanceRef.current.on('click', handler);
    } else {
      mapInstanceRef.current.getContainer().style.cursor = '';
      mapInstanceRef.current.off('click', handler);
    }
    return () => { mapInstanceRef.current?.off('click', handler); if (mapInstanceRef.current) mapInstanceRef.current.getContainer().style.cursor = ''; };
  }, [drawMode, onMapClick, leafletLoaded, mapTool]);

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
          // During draw mode or tool use, don't intercept — let tool handlers take it
          if (drawModeRef.current || mapToolRef.current) return;
          L.DomEvent.stopPropagation(e);
          const coords = feature.geometry.coordinates;
          const ring = coords[0] || coords;
          const poly = ring.map(c => [c[1], c[0]]);
          if (onLotClick) onLotClick({ properties: p, polygon: poly, address: addr });
        });
      },
    }).addTo(mapInstanceRef.current);
  }, [showLots, lotsData, selectedApp, leafletLoaded, onLotClick]);

  // (Selected app lot polygon highlight removed — use 📐 Boundaries toggle instead)

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
  const sightMarkerA = useRef(null);
  const sightMarkerB = useRef(null);
  const onDragRef = useRef(onSightPointDrag);
  onDragRef.current = onSightPointDrag;

  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    const L = window.L;

    // Remove non-marker layers (triangle, lines, labels)
    triLayersRef.current.forEach(l => mapInstanceRef.current.removeLayer(l));
    triLayersRef.current = [];

    if (!sightTriangle) {
      // Clear markers
      if (sightMarkerA.current) { mapInstanceRef.current.removeLayer(sightMarkerA.current); sightMarkerA.current = null; }
      if (sightMarkerB.current) { mapInstanceRef.current.removeLayer(sightMarkerB.current); sightMarkerB.current = null; }
      return;
    }

    const { ptA, ptB, triLeft, triRight, lineAB, propertyLine, intersections, analysis } = sightTriangle;

    const makeIcon = (label, color) => L.divIcon({
      className: '',
      html: `<div style="width:24px;height:24px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#fff;font-family:sans-serif;pointer-events:none">${label}</div>`,
      iconSize: [24, 24], iconAnchor: [12, 12]
    });

    // Point A — create once, then just update position
    if (ptA) {
      if (!sightMarkerA.current) {
        sightMarkerA.current = L.marker([ptA.lat, ptA.lng], { icon: makeIcon('A', '#e74c3c'), draggable: true, zIndexOffset: 2000, autoPan: true }).addTo(mapInstanceRef.current);
        sightMarkerA.current.bindTooltip('Drag to reposition (A)', { direction: 'top', offset: [0, -14] });
        sightMarkerA.current.on('dragend', () => {
          const ll = sightMarkerA.current.getLatLng();
          if (onDragRef.current) onDragRef.current('A', { lat: ll.lat, lng: ll.lng });
        });
      } else {
        sightMarkerA.current.setLatLng([ptA.lat, ptA.lng]);
      }
    }

    // Point B — create once, then just update position
    if (ptB) {
      if (!sightMarkerB.current) {
        sightMarkerB.current = L.marker([ptB.lat, ptB.lng], { icon: makeIcon('B', '#2980b9'), draggable: true, zIndexOffset: 2000, autoPan: true }).addTo(mapInstanceRef.current);
        sightMarkerB.current.bindTooltip('Drag to reposition (B)', { direction: 'top', offset: [0, -14] });
        sightMarkerB.current.on('dragend', () => {
          const ll = sightMarkerB.current.getLatLng();
          if (onDragRef.current) onDragRef.current('B', { lat: ll.lat, lng: ll.lng });
        });
      } else {
        sightMarkerB.current.setLatLng([ptB.lat, ptB.lng]);
      }
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

  // ── Render site boundaries (lot, building, crossover) from latlon data ──
  const boundaryLayerRef = useRef([]);
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    const L = window.L;
    boundaryLayerRef.current.forEach(m => mapInstanceRef.current.removeLayer(m));
    boundaryLayerRef.current = [];
    if (!showBoundaries || !boundaryData) return;

    // Auto-detect [lng, lat] vs [lat, lng] — Perth area: lat ~ -31 to -32, lng ~ 115 to 116
    // If first coord's absolute value is > 90, it's likely longitude in position 0
    const fixOrder = (poly) => {
      if (!poly || poly.length < 1) return poly;
      const first = poly[0];
      if (Math.abs(first[0]) > 90) {
        // [lng, lat] → swap to [lat, lng]
        return poly.map(p => [p[1], p[0]]);
      }
      return poly;
    };

    const layers = [
      { key: "lot", data: fixOrder(boundaryData.lot), color: "#38bdf8", dash: "5,3", fill: 0.04, weight: 1.5 },
      { key: "building", data: fixOrder(boundaryData.building), color: "#f97316", dash: null, fill: 0.10, weight: 1.2 },
      { key: "crossover", data: fixOrder(boundaryData.crossover), color: "#a3e635", dash: null, fill: 0.15, weight: 1.5 },
    ];

    layers.forEach(cfg => {
      if (!cfg.data || cfg.data.length < 3) return;
      const poly = L.polygon(cfg.data, {
        color: cfg.color, weight: cfg.weight, fillColor: cfg.color, fillOpacity: cfg.fill,
        dashArray: cfg.dash || null,
      }).addTo(mapInstanceRef.current);
      boundaryLayerRef.current.push(poly);
    });
  }, [showBoundaries, boundaryData, leafletLoaded]);

  // ── WA Government WMS overlay layers ──
  const waLayerRefs = useRef({});
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    const L = window.L;
    const WA_WMS = {
      contour: { url: "https://services.slip.wa.gov.au/public/services/SLIP_Public_Services/Topography/MapServer/WMSServer", layers: "0", label: "Contour Lines" },
      cadastral: { url: "https://services.slip.wa.gov.au/public/services/SLIP_Public_Services/Cadastre/MapServer/WMSServer", layers: "0", label: "Cadastral" },
      zoning: { url: "https://services.slip.wa.gov.au/public/services/SLIP_Public_Services/Planning/MapServer/WMSServer", layers: "0", label: "Zoning" },
      hazard: { url: "https://services.slip.wa.gov.au/public/services/SLIP_Public_Services/Bushfire_Prone_Areas/MapServer/WMSServer", layers: "0", label: "Bushfire" },
    };
    Object.entries(waLayers).forEach(([key, enabled]) => {
      if (enabled && !waLayerRefs.current[key] && WA_WMS[key]) {
        try {
          const wms = L.tileLayer.wms(WA_WMS[key].url, {
            layers: WA_WMS[key].layers, transparent: true, format: "image/png", opacity: 0.6, maxZoom: 20,
          }).addTo(mapInstanceRef.current);
          waLayerRefs.current[key] = wms;
        } catch (e) { console.warn(`WMS ${key} failed:`, e); }
      } else if (!enabled && waLayerRefs.current[key]) {
        mapInstanceRef.current.removeLayer(waLayerRefs.current[key]);
        delete waLayerRefs.current[key];
      }
    });
  }, [waLayers, leafletLoaded]);

  // ── Measure tool — multi-segment with running total ──
  const measureRef = useRef({ pts: [], layers: [], total: 0 });
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    const L = window.L;
    const map = mapInstanceRef.current;

    // Clean up previous measure layers
    measureRef.current.layers.forEach(l => map.removeLayer(l));
    measureRef.current = { pts: [], layers: [], total: 0 };

    if (mapTool !== "measure") return;

    map.getContainer().style.cursor = "crosshair";
    // Disable map dragging temporarily for better click handling
    const onClick = (e) => {
      L.DomEvent.stopPropagation(e);
      const pts = measureRef.current.pts;
      const latlng = e.latlng;
      pts.push(latlng);

      // Dot at click point
      const dot = L.circleMarker(latlng, { radius: 5, color: "#3498db", fillColor: "#fff", fillOpacity: 1, weight: 2.5, pane: "markerPane" }).addTo(map);
      measureRef.current.layers.push(dot);

      if (pts.length > 1) {
        const prev = pts[pts.length - 2];
        const segDist = prev.distanceTo(latlng);
        measureRef.current.total += segDist;

        // Line segment
        const line = L.polyline([prev, latlng], { color: "#3498db", weight: 2.5, dashArray: "8,4" }).addTo(map);
        measureRef.current.layers.push(line);

        // Segment distance label
        const mid = L.latLng((prev.lat + latlng.lat) / 2, (prev.lng + latlng.lng) / 2);
        const segLabel = L.marker(mid, { interactive: false, icon: L.divIcon({ className: "", html: `<div style="background:#3498db;color:#fff;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:700;white-space:nowrap;font-family:sans-serif;box-shadow:0 1px 3px rgba(0,0,0,0.2)">${segDist.toFixed(1)}m</div>`, iconAnchor: [20, 8] }) }).addTo(map);
        measureRef.current.layers.push(segLabel);

        // Running total at current point
        const totalLabel = L.marker(latlng, { interactive: false, icon: L.divIcon({ className: "", html: `<div style="background:#1a3a4a;color:#fff;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;white-space:nowrap;font-family:sans-serif;box-shadow:0 2px 4px rgba(0,0,0,0.3);margin-top:-20px">Σ ${measureRef.current.total.toFixed(1)}m</div>`, iconAnchor: [25, 30] }) }).addTo(map);
        measureRef.current.layers.push(totalLabel);

        if (setMeasureDist) setMeasureDist(`${measureRef.current.total.toFixed(1)}m (${pts.length - 1} segments)`);
      }
    };

    const onDblClick = (e) => {
      L.DomEvent.stopPropagation(e);
      // Double-click closes measurement — reset points for next one
      measureRef.current.pts = [];
      measureRef.current.total = 0;
    };

    map.on("click", onClick);
    map.on("dblclick", onDblClick);
    map.doubleClickZoom.disable();

    return () => {
      map.off("click", onClick);
      map.off("dblclick", onDblClick);
      map.doubleClickZoom.enable();
      map.getContainer().style.cursor = "";
    };
  }, [mapTool, leafletLoaded]);

  // ── Draw/annotate tool — markers, lines, text labels ──
  const drawToolRef = useRef({ layers: [], lastPt: null, mode: "line" });
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    const L = window.L;
    const map = mapInstanceRef.current;

    if (mapTool !== "draw") {
      // Don't clear draw layers when switching away — keep annotations visible
      return;
    }

    map.getContainer().style.cursor = "crosshair";

    const onClick = (e) => {
      L.DomEvent.stopPropagation(e);
      const latlng = e.latlng;

      // Place marker
      const marker = L.circleMarker(latlng, { radius: 6, color: "#e91e63", fillColor: "#e91e63", fillOpacity: 0.8, weight: 2, pane: "markerPane" }).addTo(map);
      drawToolRef.current.layers.push(marker);

      // Connect line to previous point
      if (drawToolRef.current.lastPt) {
        const line = L.polyline([drawToolRef.current.lastPt, latlng], { color: "#e91e63", weight: 2.5, opacity: 0.8 }).addTo(map);
        drawToolRef.current.layers.push(line);

        // Show distance on line
        const d = drawToolRef.current.lastPt.distanceTo(latlng);
        const mid = L.latLng((drawToolRef.current.lastPt.lat + latlng.lat) / 2, (drawToolRef.current.lastPt.lng + latlng.lng) / 2);
        const label = L.marker(mid, { interactive: false, icon: L.divIcon({ className: "", html: `<div style="background:#e91e63;color:#fff;padding:1px 5px;border-radius:3px;font-size:8px;font-weight:600;white-space:nowrap;font-family:sans-serif">${d.toFixed(1)}m</div>`, iconAnchor: [15, 8] }) }).addTo(map);
        drawToolRef.current.layers.push(label);
      }
      drawToolRef.current.lastPt = latlng;
    };

    const onDblClick = (e) => {
      L.DomEvent.stopPropagation(e);
      // Double-click breaks the line — next click starts a new line
      drawToolRef.current.lastPt = null;
    };

    const onRightClick = (e) => {
      L.DomEvent.stopPropagation(e);
      L.DomEvent.preventDefault(e);
      // Right-click places a text label
      const text = prompt("Enter label text:");
      if (text) {
        const label = L.marker(e.latlng, { icon: L.divIcon({ className: "", html: `<div style="background:#fff;color:#1a3a4a;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;white-space:nowrap;font-family:sans-serif;border:2px solid #e91e63;box-shadow:0 2px 4px rgba(0,0,0,0.2)">${text}</div>`, iconAnchor: [20, 12] }) }).addTo(map);
        drawToolRef.current.layers.push(label);
      }
    };

    map.on("click", onClick);
    map.on("dblclick", onDblClick);
    map.on("contextmenu", onRightClick);
    map.doubleClickZoom.disable();

    return () => {
      map.off("click", onClick);
      map.off("dblclick", onDblClick);
      map.off("contextmenu", onRightClick);
      map.doubleClickZoom.enable();
      map.getContainer().style.cursor = "";
    };
  }, [mapTool, leafletLoaded]);

  // ── Centreline tool — click near road to auto-draw its centreline ──
  const centrelineRef = useRef({ pts: [], layers: [], total: 0 });
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    const L = window.L;
    const map = mapInstanceRef.current;

    centrelineRef.current.layers.forEach(l => map.removeLayer(l));
    centrelineRef.current = { pts: [], layers: [], total: 0 };

    if (mapTool !== "centreline") return;

    map.getContainer().style.cursor = "crosshair";

    // Find nearest road from speedRoadsData
    const findNearestRoad = (latlng) => {
      if (!speedRoadsData?.features) return null;
      let best = null, bestDist = Infinity;
      for (const f of speedRoadsData.features) {
        const coords = f.geometry?.coordinates;
        if (!coords) continue;
        for (const c of coords) {
          // coords are [lng, lat]
          const d = Math.sqrt(Math.pow(c[1] - latlng.lat, 2) + Math.pow(c[0] - latlng.lng, 2));
          if (d < bestDist) { bestDist = d; best = f; }
        }
      }
      // ~50m threshold in degrees (~0.0005)
      return bestDist < 0.0005 ? best : null;
    };

    const drawRoadCentreline = (feature) => {
      // Clear previous
      centrelineRef.current.layers.filter(l => l._isCL).forEach(l => map.removeLayer(l));
      centrelineRef.current.layers = centrelineRef.current.layers.filter(l => !l._isCL);

      const coords = feature.geometry.coordinates; // [lng, lat]
      const latLngs = coords.map(c => L.latLng(c[1], c[0]));
      const props = feature.properties;

      // Main centreline
      const line = L.polyline(latLngs, { color: "#00bcd4", weight: 3.5, opacity: 0.9 });
      line._isCL = true; line.addTo(map);
      centrelineRef.current.layers.push(line);

      // Calculate total length
      let total = 0;
      for (let i = 1; i < latLngs.length; i++) {
        total += latLngs[i - 1].distanceTo(latLngs[i]);
      }

      // Perpendicular ticks at each vertex
      for (let i = 0; i < latLngs.length; i++) {
        const prev = i > 0 ? latLngs[i - 1] : latLngs[i];
        const next = i < latLngs.length - 1 ? latLngs[i + 1] : latLngs[i];
        const bearing = Math.atan2(next.lng - prev.lng, next.lat - prev.lat);
        const perp = bearing + Math.PI / 2;
        const tickLen = 0.00004;
        const tickA = L.latLng(latLngs[i].lat + Math.cos(perp) * tickLen, latLngs[i].lng + Math.sin(perp) * tickLen);
        const tickB = L.latLng(latLngs[i].lat - Math.cos(perp) * tickLen, latLngs[i].lng - Math.sin(perp) * tickLen);
        const tick = L.polyline([tickA, tickB], { color: "#00bcd4", weight: 1.5, opacity: 0.5 });
        tick._isCL = true; tick.addTo(map);
        centrelineRef.current.layers.push(tick);

        // Dot at vertex
        const dot = L.circleMarker(latLngs[i], { radius: 3, color: "#00bcd4", fillColor: "#fff", fillOpacity: 1, weight: 2 });
        dot._isCL = true; dot.addTo(map);
        centrelineRef.current.layers.push(dot);
      }

      // Road name + length label at midpoint
      const midIdx = Math.floor(latLngs.length / 2);
      const midPt = latLngs[midIdx];
      const label = L.marker(midPt, { interactive: false, icon: L.divIcon({ className: "", html: `<div style="background:#00838f;color:#fff;padding:3px 10px;border-radius:5px;font-size:10px;font-weight:700;white-space:nowrap;font-family:sans-serif;box-shadow:0 2px 6px rgba(0,0,0,0.3)">${props.rd || "Road"} · ${props.sp}km/h · ${total.toFixed(0)}m</div>`, iconAnchor: [60, -5] }) });
      label._isCL = true; label.addTo(map);
      centrelineRef.current.layers.push(label);

      centrelineRef.current.total = total;
      if (setCentrelineDist) setCentrelineDist(`${props.rd || "Road"} · ${props.sp}km/h · ${total.toFixed(1)}m`);
    };

    const onClick = (e) => {
      L.DomEvent.stopPropagation(e);

      // Try auto-snap to nearest road
      const road = findNearestRoad(e.latlng);
      if (road) {
        drawRoadCentreline(road);
        return;
      }

      // Manual mode — click points along road centre
      centrelineRef.current.pts.push(e.latlng);
      const dot = L.circleMarker(e.latlng, { radius: 4, color: "#00bcd4", fillColor: "#fff", fillOpacity: 1, weight: 2.5, pane: "markerPane" }).addTo(map);
      centrelineRef.current.layers.push(dot);

      const pts = centrelineRef.current.pts;
      if (pts.length >= 2) {
        // Remove old manual lines
        centrelineRef.current.layers.filter(l => l._isManualCL).forEach(l => map.removeLayer(l));
        centrelineRef.current.layers = centrelineRef.current.layers.filter(l => !l._isManualCL);

        let total = 0;
        for (let i = 1; i < pts.length; i++) {
          const seg = pts[i - 1].distanceTo(pts[i]);
          total += seg;
          const line = L.polyline([pts[i - 1], pts[i]], { color: "#00bcd4", weight: 3, opacity: 0.9 });
          line._isManualCL = true; line.addTo(map);
          centrelineRef.current.layers.push(line);

          const mid = L.latLng((pts[i - 1].lat + pts[i].lat) / 2, (pts[i - 1].lng + pts[i].lng) / 2);
          const segLabel = L.marker(mid, { interactive: false, icon: L.divIcon({ className: "", html: `<div style="background:#00838f;color:#fff;padding:1px 5px;border-radius:3px;font-size:8px;font-weight:600;white-space:nowrap;font-family:sans-serif">${seg.toFixed(1)}m</div>`, iconAnchor: [15, 8] }) });
          segLabel._isManualCL = true; segLabel.addTo(map);
          centrelineRef.current.layers.push(segLabel);
        }
        centrelineRef.current.total = total;
        if (setCentrelineDist) setCentrelineDist(`Manual · ${total.toFixed(1)}m (${pts.length - 1} segments)`);
      }
    };

    const onDblClick = (e) => {
      L.DomEvent.stopPropagation(e);
      centrelineRef.current.pts = [];
      centrelineRef.current.total = 0;
    };

    map.on("click", onClick);
    map.on("dblclick", onDblClick);
    map.doubleClickZoom.disable();

    return () => {
      map.off("click", onClick);
      map.off("dblclick", onDblClick);
      map.doubleClickZoom.enable();
      map.getContainer().style.cursor = "";
    };
  }, [mapTool, leafletLoaded, speedRoadsData]);

  // ── Offset Point tool — place point X m from road, Y m from boundary ──
  const offsetRef = useRef({ layers: [] });
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    const L = window.L;
    const map = mapInstanceRef.current;

    offsetRef.current.layers.forEach(l => map.removeLayer(l));
    offsetRef.current.layers = [];

    if (mapTool !== "offset" || !offsetState) return;

    map.getContainer().style.cursor = "crosshair";

    // Find nearest point on any road segment from speedRoadsData
    const snapToRoad = (latlng) => {
      if (!speedRoadsData?.features) return latlng;
      let best = null, bestDist = Infinity;
      for (const f of speedRoadsData.features) {
        const coords = f.geometry?.coordinates;
        if (!coords) continue;
        for (let i = 0; i < coords.length - 1; i++) {
          const a = L.latLng(coords[i][1], coords[i][0]);
          const b = L.latLng(coords[i+1][1], coords[i+1][0]);
          // Project latlng onto segment a-b
          const ax = a.lng, ay = a.lat, bx = b.lng, by = b.lat, px = latlng.lng, py = latlng.lat;
          const dx = bx-ax, dy = by-ay;
          const lenSq = dx*dx + dy*dy;
          if (lenSq < 1e-20) continue;
          const t = Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy) / lenSq));
          const snap = L.latLng(ay + t*dy, ax + t*dx);
          const d = latlng.distanceTo(snap);
          if (d < bestDist) { bestDist = d; best = { point: snap, road: f.properties }; }
        }
      }
      return bestDist < 100 ? best : null;
    };

    // Find nearest lot boundary segment
    const snapToBoundary = (latlng) => {
      if (!allLotsData?.features) return null;
      let best = null, bestDist = Infinity;
      for (const f of allLotsData.features) {
        const geom = f.geometry;
        if (!geom) continue;
        let rings = [];
        if (geom.type === "Polygon") rings = [geom.coordinates[0]];
        else if (geom.type === "MultiPolygon") rings = geom.coordinates.map(p => p[0]);
        for (const ring of rings) {
          for (let i = 0; i < ring.length - 1; i++) {
            const a = L.latLng(ring[i][1], ring[i][0]);
            const b = L.latLng(ring[i+1][1], ring[i+1][0]);
            const ax = a.lng, ay = a.lat, bx = b.lng, by = b.lat, px = latlng.lng, py = latlng.lat;
            const dx = bx-ax, dy = by-ay;
            const lenSq = dx*dx + dy*dy;
            if (lenSq < 1e-20) continue;
            const t = Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy) / lenSq));
            const snap = L.latLng(ay + t*dy, ax + t*dx);
            const d = latlng.distanceTo(snap);
            if (d < bestDist) {
              bestDist = d;
              // Compute bearing of this boundary segment
              const bearing = Math.atan2(b.lng - a.lng, b.lat - a.lat);
              best = { point: snap, a, b, bearing, properties: f.properties };
            }
          }
        }
      }
      return bestDist < 50 ? best : null;
    };

    const onClick = (e) => {
      L.DomEvent.stopPropagation(e);
      if (!setOffsetState) return;

      if (offsetState.step === 0) {
        // Step 1: snap to road
        const snap = snapToRoad(e.latlng);
        if (snap) {
          const dot = L.circleMarker(snap.point, { radius: 6, color: "#4caf50", fillColor: "#4caf50", fillOpacity: 0.8, weight: 2 })
            .bindTooltip(`Road: ${snap.road?.rd || "?"} · ${snap.road?.sp || "?"}km/h`, { permanent: true, direction: "top", offset: [0, -10] })
            .addTo(map);
          offsetRef.current.layers.push(dot);
          setOffsetState(s => ({ ...s, step: 1, road: snap }));
        }
      } else if (offsetState.step === 1) {
        // Step 2: snap to lot boundary
        const snap = snapToBoundary(e.latlng);
        if (snap) {
          const line = L.polyline([snap.a, snap.b], { color: "#4caf50", weight: 3, dashArray: "6,3" }).addTo(map);
          const dot = L.circleMarker(snap.point, { radius: 6, color: "#66bb6a", fillColor: "#66bb6a", fillOpacity: 0.8, weight: 2 })
            .bindTooltip("Boundary", { permanent: true, direction: "top", offset: [0, -10] })
            .addTo(map);
          offsetRef.current.layers.push(line, dot);
          setOffsetState(s => ({ ...s, step: 2, boundary: snap }));
        }
      }
    };

    // Step 3: when step changes to 3, compute and place the offset point
    if (offsetState.step === 3 && offsetState.road && offsetState.boundary) {
      const roadPt = offsetState.road.point;
      const bndSnap = offsetState.boundary;
      const bndA = bndSnap.a, bndB = bndSnap.b;
      const xM = offsetState.x; // metres from road (perpendicular inward)
      const yM = offsetState.y; // metres from boundary (perpendicular inward)

      const mPerLat = 111320;
      const mPerLng = 111320 * Math.cos(roadPt.lat * Math.PI / 180);

      // Find the road segment near the clicked road point
      let roadA = null, roadB = null;
      if (speedRoadsData?.features) {
        let bestDist = Infinity;
        for (const f of speedRoadsData.features) {
          const coords = f.geometry?.coordinates;
          if (!coords) continue;
          for (let i = 0; i < coords.length - 1; i++) {
            const a = L.latLng(coords[i][1], coords[i][0]);
            const b = L.latLng(coords[i+1][1], coords[i+1][0]);
            const mid = L.latLng((a.lat+b.lat)/2, (a.lng+b.lng)/2);
            const d = roadPt.distanceTo(mid);
            if (d < bestDist) { bestDist = d; roadA = a; roadB = b; }
          }
        }
      }
      if (!roadA) { roadA = roadPt; roadB = L.latLng(roadPt.lat + 0.0001, roadPt.lng); }

      // Road bearing and perpendicular
      const roadBearing = Math.atan2((roadB.lng - roadA.lng) * mPerLng, (roadB.lat - roadA.lat) * mPerLat);
      const roadPerp = roadBearing + Math.PI / 2;
      // Determine which perpendicular direction goes toward the boundary
      const testR1 = L.latLng(roadPt.lat + Math.cos(roadPerp) * 0.0001, roadPt.lng + Math.sin(roadPerp) * 0.0001);
      const testR2 = L.latLng(roadPt.lat - Math.cos(roadPerp) * 0.0001, roadPt.lng - Math.sin(roadPerp) * 0.0001);
      const roadPerpDir = bndSnap.point.distanceTo(testR1) < bndSnap.point.distanceTo(testR2) ? roadPerp : roadPerp + Math.PI;

      // Boundary bearing and perpendicular
      const bndBearing = Math.atan2((bndB.lng - bndA.lng) * mPerLng, (bndB.lat - bndA.lat) * mPerLat);
      const bndPerp = bndBearing + Math.PI / 2;
      const testB1 = L.latLng(bndSnap.point.lat + Math.cos(bndPerp) * 0.0001, bndSnap.point.lng + Math.sin(bndPerp) * 0.0001);
      const testB2 = L.latLng(bndSnap.point.lat - Math.cos(bndPerp) * 0.0001, bndSnap.point.lng - Math.sin(bndPerp) * 0.0001);
      const bndPerpDir = roadPt.distanceTo(testB1) > roadPt.distanceTo(testB2) ? bndPerp : bndPerp + Math.PI;

      // LINE 1: Parallel to road, offset X metres toward lot
      const l1Pt = L.latLng(
        roadPt.lat + (xM * Math.cos(roadPerpDir)) / mPerLat,
        roadPt.lng + (xM * Math.sin(roadPerpDir)) / mPerLng
      );
      const l1Dir = roadBearing;

      // LINE 2: Parallel to boundary, offset Y metres toward lot interior
      const l2Pt = L.latLng(
        bndSnap.point.lat + (yM * Math.cos(bndPerpDir)) / mPerLat,
        bndSnap.point.lng + (yM * Math.sin(bndPerpDir)) / mPerLng
      );
      const l2Dir = bndBearing;

      // Draw the two offset lines (long extensions for visibility)
      const extLen = 0.0005; // ~50m visual extension
      const line1A = L.latLng(l1Pt.lat - Math.cos(l1Dir) * extLen, l1Pt.lng - Math.sin(l1Dir) * extLen);
      const line1B = L.latLng(l1Pt.lat + Math.cos(l1Dir) * extLen, l1Pt.lng + Math.sin(l1Dir) * extLen);
      const line2A = L.latLng(l2Pt.lat - Math.cos(l2Dir) * extLen, l2Pt.lng - Math.sin(l2Dir) * extLen);
      const line2B = L.latLng(l2Pt.lat + Math.cos(l2Dir) * extLen, l2Pt.lng + Math.sin(l2Dir) * extLen);

      const offsetLine1 = L.polyline([line1A, line1B], { color: "#4caf50", weight: 1.5, dashArray: "8,4", opacity: 0.7 }).addTo(map);
      const offsetLine2 = L.polyline([line2A, line2B], { color: "#81c784", weight: 1.5, dashArray: "8,4", opacity: 0.7 }).addTo(map);
      offsetRef.current.layers.push(offsetLine1, offsetLine2);

      // Line 1 label
      const l1Label = L.marker(l1Pt, { interactive: false, icon: L.divIcon({ className: "", html: `<div style="background:#4caf50;color:#fff;padding:1px 6px;border-radius:3px;font-size:8px;font-weight:600;font-family:sans-serif">${xM}m from road</div>`, iconAnchor: [30, -5] }) }).addTo(map);
      const l2Label = L.marker(l2Pt, { interactive: false, icon: L.divIcon({ className: "", html: `<div style="background:#81c784;color:#fff;padding:1px 6px;border-radius:3px;font-size:8px;font-weight:600;font-family:sans-serif">${yM}m from boundary</div>`, iconAnchor: [35, -5] }) }).addTo(map);
      offsetRef.current.layers.push(l1Label, l2Label);

      // Intersect Line 1 and Line 2 to get Point A
      // Line 1: l1Pt + t * (cos(l1Dir), sin(l1Dir))
      // Line 2: l2Pt + s * (cos(l2Dir), sin(l2Dir))
      const d1x = Math.sin(l1Dir), d1y = Math.cos(l1Dir);
      const d2x = Math.sin(l2Dir), d2y = Math.cos(l2Dir);
      const det = d1x * d2y - d1y * d2x;

      let finalPt;
      if (Math.abs(det) > 1e-10) {
        // Lines intersect
        const dLat = (l2Pt.lat - l1Pt.lat) * mPerLat;
        const dLng = (l2Pt.lng - l1Pt.lng) * mPerLng;
        const t = (dLng * d2y - dLat * d2x) / (d1x * d2y - d1y * d2x);
        finalPt = L.latLng(
          l1Pt.lat + (t * d1y) / mPerLat,
          l1Pt.lng + (t * d1x) / mPerLng
        );
      } else {
        // Lines parallel — fallback to simple offset
        finalPt = L.latLng(
          roadPt.lat + (xM * Math.cos(roadPerpDir)) / mPerLat,
          roadPt.lng + (xM * Math.sin(roadPerpDir)) / mPerLng
        );
      }

      // Draw perpendicular connector lines from road and boundary to point
      const lineFromRoad = L.polyline([roadPt, finalPt], { color: "#4caf50", weight: 2, dashArray: "4,4" }).addTo(map);
      const lineFromBnd = L.polyline([bndSnap.point, finalPt], { color: "#81c784", weight: 2, dashArray: "4,4" }).addTo(map);
      offsetRef.current.layers.push(lineFromRoad, lineFromBnd);

      // Final point marker (Point A)
      const marker = L.marker(finalPt, { icon: L.divIcon({ className: "", html: '<div style="width:20px;height:20px;border-radius:50%;background:#e74c3c;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#fff;font-family:sans-serif">A</div>', iconSize: [20,20], iconAnchor: [10,10] }) })
        .bindTooltip(`Point A: ${xM}m from verge, ${yM}m from boundary<br/>${finalPt.lat.toFixed(6)}, ${finalPt.lng.toFixed(6)}`, { permanent: false, direction: "top", offset: [0, -12] })
        .addTo(map);
      offsetRef.current.layers.push(marker);

      // Compute Point B: project finalPt perpendicularly onto the road centreline
      // Find nearest point on road centreline from finalPt
      let bestB = roadPt, bestBDist = Infinity;
      if (speedRoadsData?.features) {
        for (const f of speedRoadsData.features) {
          const coords = f.geometry?.coordinates;
          if (!coords) continue;
          for (let i = 0; i < coords.length - 1; i++) {
            const a = L.latLng(coords[i][1], coords[i][0]);
            const b = L.latLng(coords[i+1][1], coords[i+1][0]);
            const ax = a.lng, ay = a.lat, bx = b.lng, by = b.lat;
            const px = finalPt.lng, py = finalPt.lat;
            const dx = bx-ax, dy = by-ay;
            const lenSq = dx*dx + dy*dy;
            if (lenSq < 1e-20) continue;
            const t = Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy) / lenSq));
            const snap = L.latLng(ay + t*dy, ax + t*dx);
            const d = finalPt.distanceTo(snap);
            if (d < bestBDist) { bestBDist = d; bestB = snap; }
          }
        }
      }

      // Draw A→B line (yellow)
      const lineAB = L.polyline([finalPt, bestB], { color: "#ffff00", weight: 2.5, dashArray: "6,4" }).addTo(map);
      offsetRef.current.layers.push(lineAB);

      // Point B marker on road centreline
      const markerB = L.marker(bestB, { icon: L.divIcon({ className: "", html: '<div style="width:20px;height:20px;border-radius:50%;background:#2980b9;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#fff;font-family:sans-serif">B</div>', iconSize: [20,20], iconAnchor: [10,10] }) })
        .bindTooltip(`Point B: Road centreline<br/>${bestB.lat.toFixed(6)}, ${bestB.lng.toFixed(6)}`, { permanent: false, direction: "top", offset: [0, -12] })
        .addTo(map);
      offsetRef.current.layers.push(markerB);

      // A→B distance label
      const abDist = finalPt.distanceTo(bestB);
      const midAB = L.latLng((finalPt.lat + bestB.lat)/2, (finalPt.lng + bestB.lng)/2);
      const abLabel = L.marker(midAB, { interactive: false, icon: L.divIcon({ className: "", html: `<div style="background:#1a3a4a;color:#ffff00;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;font-family:sans-serif">${abDist.toFixed(1)}m</div>`, iconAnchor: [20, 8] }) }).addTo(map);
      offsetRef.current.layers.push(abLabel);

      // Trigger sight triangle with A and B
      if (onOffsetSightTriangle) {
        onOffsetSightTriangle(
          { lat: finalPt.lat, lng: finalPt.lng },
          { lat: bestB.lat, lng: bestB.lng }
        );
      }
    }

    map.on("click", onClick);
    return () => { map.off("click", onClick); map.getContainer().style.cursor = ""; };
  }, [mapTool, offsetState, leafletLoaded, speedRoadsData, allLotsData]);

  // ── Clear draw annotations ──
  const clearDrawAnnotations = () => {
    if (!mapInstanceRef.current) return;
    drawToolRef.current.layers.forEach(l => mapInstanceRef.current.removeLayer(l));
    drawToolRef.current = { layers: [], lastPt: null, mode: "line" };
  };

  // ── Radius tool — draw freehand curve along road bend, compute best-fit circle ──
  const radiusRef = useRef({ pts: [], layers: [], drawing: false });
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    const L = window.L;
    const map = mapInstanceRef.current;

    radiusRef.current.layers.forEach(l => map.removeLayer(l));
    radiusRef.current = { pts: [], layers: [], drawing: false };

    if (mapTool !== "radius") return;

    map.getContainer().style.cursor = "crosshair";

    const fitCircle = (pts) => {
      if (pts.length < 3) return null;
      const n = pts.length;
      const cLat = pts.reduce((s, p) => s + p.lat, 0) / n;
      const cLng = pts.reduce((s, p) => s + p.lng, 0) / n;
      const mPerLat = 111320;
      const mPerLng = 111320 * Math.cos(cLat * Math.PI / 180);
      const mPts = pts.map(p => ({ x: (p.lng - cLng) * mPerLng, y: (p.lat - cLat) * mPerLat }));
      let sumX=0,sumY=0,sumX2=0,sumY2=0,sumXY=0,sumX3=0,sumY3=0,sumX2Y=0,sumXY2=0;
      for (const p of mPts) { sumX+=p.x; sumY+=p.y; sumX2+=p.x*p.x; sumY2+=p.y*p.y; sumXY+=p.x*p.y; sumX3+=p.x*p.x*p.x; sumY3+=p.y*p.y*p.y; sumX2Y+=p.x*p.x*p.y; sumXY2+=p.x*p.y*p.y; }
      const A=n*sumX2-sumX*sumX, B=n*sumXY-sumX*sumY, C=n*sumY2-sumY*sumY;
      const D=0.5*(n*sumX3+n*sumXY2-sumX*sumX2-sumX*sumY2);
      const E=0.5*(n*sumX2Y+n*sumY3-sumY*sumX2-sumY*sumY2);
      const denom=A*C-B*B;
      if (Math.abs(denom)<1e-10) return null;
      const cx=(D*C-B*E)/denom, cy=(A*E-B*D)/denom;
      const r=Math.sqrt(mPts.reduce((s,p)=>s+(p.x-cx)**2+(p.y-cy)**2,0)/n);
      return { lat: cLat+cy/mPerLat, lng: cLng+cx/mPerLng, radius: r };
    };

    const showResult = () => {
      // Remove old circle/labels/curve
      radiusRef.current.layers.filter(l => l._isCircle || l._isLabel || l._isCurve).forEach(l => map.removeLayer(l));
      radiusRef.current.layers = radiusRef.current.layers.filter(l => !l._isCircle && !l._isLabel && !l._isCurve);

      const pts = radiusRef.current.pts;
      if (pts.length < 5) return;

      const sample = pts.length > 30 ? pts.filter((_,i) => i % Math.floor(pts.length/30) === 0) : pts;
      const circle = fitCircle(sample);
      if (!circle || circle.radius <= 0 || circle.radius > 5000) return;

      const mPerLat = 111320;
      const mPerLng = 111320 * Math.cos(circle.lat * Math.PI / 180);

      // Compute start and end angles of the arc
      const startPt = pts[0];
      const endPt = pts[pts.length - 1];
      let startAngle = Math.atan2((startPt.lng - circle.lng) * mPerLng, (startPt.lat - circle.lat) * mPerLat);
      let endAngle = Math.atan2((endPt.lng - circle.lng) * mPerLng, (endPt.lat - circle.lat) * mPerLat);

      // Determine arc direction (CW vs CCW) from the drawn points
      const midPt = pts[Math.floor(pts.length / 2)];
      const midAngle = Math.atan2((midPt.lng - circle.lng) * mPerLng, (midPt.lat - circle.lat) * mPerLat);
      // Normalize angles
      const normAngle = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      let sa = normAngle(startAngle), ea = normAngle(endAngle), ma = normAngle(midAngle);
      // Check if mid angle is between start and end going CW
      const isBetweenCW = (sa <= ea) ? (ma >= sa && ma <= ea) : (ma >= sa || ma <= ea);
      if (!isBetweenCW) { const tmp = sa; sa = ea; ea = tmp; } // Swap to ensure arc goes through mid

      // Generate smooth arc points (64 segments)
      const arcPts = [];
      const steps = 64;
      let sweep = ea - sa;
      if (sweep <= 0) sweep += 2 * Math.PI;
      for (let i = 0; i <= steps; i++) {
        const angle = sa + (sweep * i / steps);
        const lat = circle.lat + (circle.radius * Math.cos(angle)) / mPerLat;
        const lng = circle.lng + (circle.radius * Math.sin(angle)) / mPerLng;
        arcPts.push([lat, lng]);
      }

      // Draw smooth arc (solid orange)
      const arcLine = L.polyline(arcPts, { color: "#ff9800", weight: 3, opacity: 0.9 });
      arcLine._isCurve = true; arcLine.addTo(map); radiusRef.current.layers.push(arcLine);

      // Best-fit circle (dashed, subtle)
      const c = L.circle([circle.lat, circle.lng], { radius: circle.radius, color: "#ff9800", weight: 1, fillColor: "#ff9800", fillOpacity: 0.03, dashArray: "6,6" });
      c._isCircle = true; c.addTo(map); radiusRef.current.layers.push(c);

      // Start and end dots
      const dotStart = L.circleMarker(arcPts[0], { radius: 5, color: "#ff9800", fillColor: "#fff", fillOpacity: 1, weight: 2.5 });
      dotStart._isCurve = true; dotStart.addTo(map); radiusRef.current.layers.push(dotStart);
      const dotEnd = L.circleMarker(arcPts[arcPts.length-1], { radius: 5, color: "#ff9800", fillColor: "#fff", fillOpacity: 1, weight: 2.5 });
      dotEnd._isCurve = true; dotEnd.addTo(map); radiusRef.current.layers.push(dotEnd);

      // Centre dot
      const cDot = L.circleMarker([circle.lat, circle.lng], { radius: 4, color: "#ff9800", fillColor: "#ff9800", fillOpacity: 1, weight: 1 });
      cDot._isCircle = true; cDot.addTo(map); radiusRef.current.layers.push(cDot);

      // Radius line from centre to arc midpoint
      const arcMid = arcPts[Math.floor(arcPts.length / 2)];
      const rLine = L.polyline([[circle.lat, circle.lng], arcMid], { color: "#ff9800", weight: 1.5, dashArray: "4,4" });
      rLine._isCircle = true; rLine.addTo(map); radiusRef.current.layers.push(rLine);

      // R label at centre
      const label = L.marker([circle.lat, circle.lng], { interactive: false, icon: L.divIcon({ className: "", html: `<div style="background:#ff9800;color:#fff;padding:3px 12px;border-radius:6px;font-size:12px;font-weight:700;white-space:nowrap;font-family:sans-serif;box-shadow:0 2px 6px rgba(0,0,0,0.3)">R = ${circle.radius.toFixed(1)}m</div>`, iconAnchor: [35, -12] }) });
      label._isLabel = true; label.addTo(map); radiusRef.current.layers.push(label);

      // Arc length
      const arcLen = circle.radius * sweep;
      const arcLabel = L.marker(arcMid, { interactive: false, icon: L.divIcon({ className: "", html: `<div style="background:#e65100;color:#fff;padding:2px 8px;border-radius:4px;font-size:9px;font-weight:600;white-space:nowrap;font-family:sans-serif">Arc: ${arcLen.toFixed(1)}m</div>`, iconAnchor: [25, 15] }) });
      arcLabel._isLabel = true; arcLabel.addTo(map); radiusRef.current.layers.push(arcLabel);

      if (setRadiusResult) setRadiusResult(`R = ${circle.radius.toFixed(1)}m · Arc = ${arcLen.toFixed(1)}m`);
    };

    // Freehand drawing — mousedown starts, mousemove collects, mouseup finishes + smooth
    let rawPolyline = null;

    const onMouseDown = (e) => {
      L.DomEvent.stopPropagation(e);
      radiusRef.current.drawing = true;
      radiusRef.current.pts = [e.latlng];
      map.dragging.disable();
      // Thin guide line while drawing
      rawPolyline = L.polyline([e.latlng], { color: "#ff980060", weight: 2, dashArray: "3,3" }).addTo(map);
      radiusRef.current.layers.push(rawPolyline);
    };

    const onMouseMove = (e) => {
      if (!radiusRef.current.drawing) return;
      radiusRef.current.pts.push(e.latlng);
      if (rawPolyline) rawPolyline.addLatLng(e.latlng);
    };

    const onMouseUp = (e) => {
      if (!radiusRef.current.drawing) return;
      radiusRef.current.drawing = false;
      map.dragging.enable();
      // Remove raw guide line
      if (rawPolyline) { map.removeLayer(rawPolyline); radiusRef.current.layers = radiusRef.current.layers.filter(l => l !== rawPolyline); rawPolyline = null; }
      showResult();
    };

    // Also support click mode for precise points
    const onClick = (e) => {
      if (radiusRef.current.drawing) return;
      L.DomEvent.stopPropagation(e);
      radiusRef.current.pts.push(e.latlng);
      const dot = L.circleMarker(e.latlng, { radius: 4, color: "#ff9800", fillColor: "#fff", fillOpacity: 1, weight: 2, pane: "markerPane" }).addTo(map);
      radiusRef.current.layers.push(dot);
      if (radiusRef.current.pts.length >= 3) showResult();
    };

    const onDblClick = (e) => {
      L.DomEvent.stopPropagation(e);
      radiusRef.current.pts = [];
    };

    map.on("mousedown", onMouseDown);
    map.on("mousemove", onMouseMove);
    map.on("mouseup", onMouseUp);
    map.on("click", onClick);
    map.on("dblclick", onDblClick);
    map.doubleClickZoom.disable();

    return () => {
      map.off("mousedown", onMouseDown);
      map.off("mousemove", onMouseMove);
      map.off("mouseup", onMouseUp);
      map.off("click", onClick);
      map.off("dblclick", onDblClick);
      map.doubleClickZoom.enable();
      map.dragging.enable();
      map.getContainer().style.cursor = "";
    };
  }, [mapTool, leafletLoaded]);

  // ── Zoom and Print commands ──
  useEffect(() => {
    if (!mapInstanceRef.current || !mapTool) return;
    if (mapTool === "zoomProperty" && selectedApp) {
      const c = getAppCoords(allLotsData, selectedApp);
      if (c) mapInstanceRef.current.flyTo([c.lat, c.lng], 19, { duration: 0.8 });
      if (setMapTool) setMapTool(null);
    }
    if (mapTool === "zoomKalamunda") {
      mapInstanceRef.current.flyTo([-31.97, 116.06], 13, { duration: 1 });
      if (setMapTool) setMapTool(null);
    }
    if (mapTool === "print") {
      try {
        const container = mapInstanceRef.current.getContainer();
        import("html2canvas").then(mod => {
          mod.default(container, { useCORS: true, allowTaint: true }).then(canvas => {
            const link = document.createElement("a");
            link.download = `map_${selectedApp?.id || "view"}_${new Date().toISOString().split("T")[0]}.png`;
            link.href = canvas.toDataURL();
            link.click();
          });
        }).catch(() => { window.print(); });
      } catch (e) { window.print(); }
      if (setMapTool) setMapTool(null);
    }
    if (mapTool === "clearDraw") {
      clearDrawAnnotations();
      if (setMapTool) setMapTool(null);
    }
  }, [mapTool, selectedApp, allLotsData, leafletLoaded]);


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
