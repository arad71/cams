import { useRef, useState, useEffect } from "react";
import { TILE_LAYERS, STATUS_CONFIG } from '../../data/constants';
import useLeaflet from '../../hooks/useLeaflet';
import { getAppCoords } from '../../utils/geoHelpers';

// ═══════════════════════════════════════════════════════════
//  LEAFLET MAP COMPONENT
// ═══════════════════════════════════════════════════════════
export default function LeafletMap({ apps, selectedApp, onSelectApp, height = 500, drawMode = null, onMapClick = null, sightTriangle = null, showLots = false, lotsData = null, showSpeedRoads = false, speedRoadsData = null, showStreetNames = false, roadNetworkData = null, onLotClick = null, allLotsData = null, clickedLot = null, analysisResult = null, forceLayer = null, onSightPointDrag = null, showBoundaries = false, boundaryData = null, waLayers = {}, mapTool = null, setMapTool = null, measureDist = null, setMeasureDist = null, radiusResult = null, setRadiusResult = null, centrelineDist = null, setCentrelineDist = null, offsetState = null, setOffsetState = null, onOffsetComplete = null, onRadiusComplete = null }) {
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
    tileLayerRef.current = L.tileLayer(TILE_LAYERS.street.url, { attribution: TILE_LAYERS.street.attr, maxZoom: 22 }).addTo(map);
    mapInstanceRef.current = map;

    // Inject clean tooltip style
    if (!document.getElementById('lot-tip-style')) {
      const style = document.createElement('style');
      style.id = 'lot-tip-style';
      style.textContent = `.lot-tip-clean{background:none!important;border:none!important;box-shadow:none!important;padding:0!important;font-size:11px;font-weight:600;color:#1a3a4a;font-family:sans-serif;text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 5px #fff;}.lot-tip-clean::before{display:none!important;}`;
      document.head.appendChild(style);
    }

    return () => { map.remove(); mapInstanceRef.current = null; };
  }, [leafletLoaded]);

  // Switch tile layer
  useEffect(() => {
    if (!mapInstanceRef.current || !tileLayerRef.current) return;
    const L = window.L;
    const layer = forceLayer || activeLayer;
    mapInstanceRef.current.removeLayer(tileLayerRef.current);
    tileLayerRef.current = L.tileLayer(TILE_LAYERS[layer].url, { attribution: TILE_LAYERS[layer].attr, maxZoom: 22 }).addTo(mapInstanceRef.current);
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
          <svg width="${isSelected?28:24}" height="${isSelected?34:30}" viewBox="0 0 36 44">
            <path d="M18,42 C18,42 2,26 2,16 C2,7.2 9.2,0 18,0 C26.8,0 34,7.2 34,16 C34,26 18,42 18,42Z" fill="${sc.mapColor}" stroke="#fff" stroke-width="2.5" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))"/>
            <circle cx="18" cy="16" r="7" fill="#fff"/>
            <text x="18" y="20" text-anchor="middle" font-size="11" font-weight="bold" fill="${sc.mapColor}">${sc.icon}</text>
          </svg>
        </div>`,
        iconSize: [isSelected?28:24, isSelected?34:30],
        iconAnchor: [isSelected?14:12, isSelected?34:30],
      });

      const marker = L.marker([coords.lat, coords.lng], { icon });
      // Only show popup on dashboard (not assessment page)
      if (!isSelected) {
        marker.bindPopup(`
          <div style="font-family:'DM Sans',sans-serif;min-width:200px;">
            <div style="font-weight:800;font-size:14px;color:#1a3a4a;margin-bottom:4px;">${app.id || ""}</div>
            ${app.owner?.name ? `<div style="font-size:12px;color:#5a6a74;margin-bottom:6px;">${app.owner.name}</div>` : ""}
            ${app.property?.address ? `<div style="font-size:11px;color:#7a8a94;margin-bottom:4px;">📍 ${app.property.address}</div>` : ""}
            ${app.property?.roadName ? `<div style="font-size:11px;color:#7a8a94;margin-bottom:6px;">🛣 ${app.property.roadName}${app.property.roadType ? ' (' + app.property.roadType + ')' : ''}</div>` : ""}
            <div style="font-size:11px;margin-bottom:6px;"><span style="background:${sc.bg};color:${sc.color};padding:2px 8px;border-radius:4px;font-weight:700;">${sc.icon} ${sc.label}</span></div>
            ${app.crossover?.width ? `<div style="font-size:11px;color:#5a6a74;">Width: ${app.crossover.width}m${app.property?.frontage ? ' | Frontage: ' + app.property.frontage + 'm' : ''}</div>` : ""}
          </div>
        `, { maxWidth: 280 });
      }
      marker.on('click', () => { if (!mapToolRef.current) onSelectApp(app); })
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
        const p = feature.properties || {};
        const num = p.road_number_1 || p.n || p.ROAD_NUMBER || "";
        const road = p.road_name || p.rd || p.ROAD_NAME || "";
        const type = p.road_type || p.rt || p.ROAD_TYPE || "";
        const loc = p.locality || p.loc || p.LOCALITY || "";
        const lotNum = p.lot_number || p.LOT_NUMBER || "";
        const addr = [num, road, type].filter(Boolean).join(' ').trim();
        const fullLabel = [addr, loc, lotNum ? `Lot ${lotNum}` : ""].filter(Boolean).join(' · ');

        if (fullLabel) {
          layer.bindTooltip(fullLabel, { sticky: true, direction: "top", offset: [0, -8], className: "lot-tip-clean" });
        }
        layer.on('click', (e) => {
          if (drawModeRef.current || mapToolRef.current) return;
          L.DomEvent.stopPropagation(e);
          const coords = feature.geometry.coordinates;
          const ring = coords[0] || coords;
          const poly = ring.map(c => [c[1], c[0]]);
          if (onLotClick) onLotClick({ properties: p, polygon: poly, address: fullLabel || "Lot" });
        });
      },
    }).addTo(mapInstanceRef.current);
  }, [showLots, lotsData, selectedApp, leafletLoaded, onLotClick]);

  // (Selected app lot polygon highlight removed — use 📐 Boundaries toggle instead)

  // Highlight clicked lot — just style change, no extra polygon
  const clickedLotRef = useRef(null);
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    if (clickedLotRef.current) {
      mapInstanceRef.current.removeLayer(clickedLotRef.current);
      clickedLotRef.current = null;
    }
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

  // Render road network with street names from Road_Network.geojson
  const streetLayerRef = useRef(null);
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    if (streetLayerRef.current) { mapInstanceRef.current.removeLayer(streetLayerRef.current); streetLayerRef.current = null; }
    if (!showStreetNames || !roadNetworkData?.features) return;
    const L = window.L;
    streetLayerRef.current = L.geoJSON(roadNetworkData, {
      style: (feature) => {
        const rt = (feature.properties.rt || "").toLowerCase();
        const isMain = rt.includes("highway") || rt.includes("arterial") || rt.includes("distributor") || rt.includes("primary");
        return {
          color: isMain ? "#2c3e50" : "#7f8c8d",
          weight: isMain ? 2.5 : 1.5,
          opacity: isMain ? 0.7 : 0.4,
        };
      },
    }).addTo(mapInstanceRef.current);
  }, [showStreetNames, roadNetworkData, leafletLoaded]);

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
      html: `<div style="width:18px;height:18px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;color:#fff;font-family:sans-serif;pointer-events:none">${label}</div>`,
      iconSize: [18, 18], iconAnchor: [9, 9]
    });

    // Point A
    if (ptA) {
      if (!sightMarkerA.current) {
        sightMarkerA.current = L.marker([ptA.lat, ptA.lng], { icon: makeIcon('A', '#e74c3c'), draggable: true, zIndexOffset: 2000, autoPan: true }).addTo(mapInstanceRef.current);
        sightMarkerA.current.on('dragend', () => {
          const ll = sightMarkerA.current.getLatLng();
          if (onDragRef.current) onDragRef.current('A', { lat: ll.lat, lng: ll.lng });
        });
      } else {
        sightMarkerA.current.setLatLng([ptA.lat, ptA.lng]);
      }
    }

    // Point B
    if (ptB) {
      if (!sightMarkerB.current) {
        sightMarkerB.current = L.marker([ptB.lat, ptB.lng], { icon: makeIcon('B', '#2980b9'), draggable: true, zIndexOffset: 2000, autoPan: true }).addTo(mapInstanceRef.current);
        sightMarkerB.current.on('dragend', () => {
          const ll = sightMarkerB.current.getLatLng();
          if (onDragRef.current) onDragRef.current('B', { lat: ll.lat, lng: ll.lng });
        });
      } else {
        sightMarkerB.current.setLatLng([ptB.lat, ptB.lng]);
      }
    }

    // Triangle polygon only — thin lines, no labels
    if (triLeft && triRight && ptA) {
      const compliant = analysis?.compliant !== false;
      const tri = L.polygon([[ptA.lat, ptA.lng], [triLeft.lat, triLeft.lng], [triRight.lat, triRight.lng]], {
        color: compliant ? '#27ae60' : '#e74c3c', weight: 1.5, fillColor: compliant ? '#27ae60' : '#e74c3c', fillOpacity: compliant ? 0.08 : 0.12, dashArray: compliant ? null : '5,3',
      }).addTo(mapInstanceRef.current);
      triLayersRef.current.push(tri);
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

    map.on("preclick", onClick);
    map.on("dblclick", onDblClick);
    map.doubleClickZoom.disable();

    return () => {
      map.off("preclick", onClick);
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

    map.on("preclick", onClick);
    map.on("dblclick", onDblClick);
    map.on("contextmenu", onRightClick);
    map.doubleClickZoom.disable();

    return () => {
      map.off("preclick", onClick);
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

    // Find nearest road from speed data OR road network
    const findNearestRoad = (latlng) => {
      let best = null, bestDist = Infinity;
      const sources = [speedRoadsData, roadNetworkData].filter(s => s?.features);
      for (const src of sources) {
        for (const f of src.features) {
          const coords = f.geometry?.coordinates;
          if (!coords || f.geometry?.type !== "LineString") continue;
          for (const c of coords) {
            const d = Math.sqrt(Math.pow(c[1] - latlng.lat, 2) + Math.pow(c[0] - latlng.lng, 2));
            if (d < bestDist) { bestDist = d; best = f; }
          }
        }
      }
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

    map.on("preclick", onClick);
    map.on("dblclick", onDblClick);
    map.doubleClickZoom.disable();

    return () => {
      map.off("preclick", onClick);
      map.off("dblclick", onDblClick);
      map.doubleClickZoom.enable();
      map.getContainer().style.cursor = "";
    };
  }, [mapTool, leafletLoaded, speedRoadsData, roadNetworkData]);

  // ── Offset Point tool — place point X m from road, Y m from boundary ──
  const offsetRef = useRef({ layers: [] });
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    const L = window.L;
    const map = mapInstanceRef.current;

    offsetRef.current.layers.forEach(l => map.removeLayer(l));
    offsetRef.current.layers = [];

    if (mapTool !== "offset" && !(offsetState?.step >= 2 && offsetState?.road && offsetState?.boundary)) {
      if (!offsetState) return;
      return;
    }

    if (mapTool === "offset") map.getContainer().style.cursor = "crosshair";

    // Find nearest point on road segment — searches BOTH speed data and road network
    const snapToRoad = (latlng) => {
      let best = null, bestDist = Infinity;
      const sources = [speedRoadsData, roadNetworkData].filter(s => s?.features);
      if (sources.length === 0) return null;
      for (const src of sources) {
        for (const f of src.features) {
          const coords = f.geometry?.coordinates;
          if (!coords || f.geometry?.type !== "LineString") continue;
          for (let i = 0; i < coords.length - 1; i++) {
            const a = L.latLng(coords[i][1], coords[i][0]);
            const b = L.latLng(coords[i+1][1], coords[i+1][0]);
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
      }
      return bestDist < 30 ? best : null;
    };

    // Find nearest boundary segment of SELECTED APP's lot polygon (within 30m)
    const snapToBoundary = (latlng) => {
      let lotPoly = selectedApp?.lot_polygon;
      if (!lotPoly || lotPoly.length < 3) return null;
      // Auto-detect [lng,lat] vs [lat,lng]
      if (Math.abs(lotPoly[0][0]) > 90) lotPoly = lotPoly.map(p => [p[1], p[0]]);
      // Ensure closed
      const last = lotPoly[lotPoly.length - 1], first = lotPoly[0];
      if (last[0] !== first[0] || last[1] !== first[1]) lotPoly = [...lotPoly, first];

      let best = null, bestDist = Infinity;
      for (let i = 0; i < lotPoly.length - 1; i++) {
        const a = L.latLng(lotPoly[i][0], lotPoly[i][1]);
        const b = L.latLng(lotPoly[i + 1][0], lotPoly[i + 1][1]);
        const ax = a.lng, ay = a.lat, bx = b.lng, by = b.lat, px = latlng.lng, py = latlng.lat;
        const dx = bx - ax, dy = by - ay;
        const lenSq = dx * dx + dy * dy;
        if (lenSq < 1e-20) continue;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
        const snap = L.latLng(ay + t * dy, ax + t * dx);
        const d = latlng.distanceTo(snap);
        if (d < bestDist) {
          bestDist = d;
          const bearing = Math.atan2(b.lng - a.lng, b.lat - a.lat);
          best = { point: snap, a, b, bearing };
        }
      }
      return bestDist < 30 ? best : null;
    };

    // Corner lot radius collection ref
    if (!offsetRef.current.cornerPts) offsetRef.current.cornerPts = [];

    const fitCircle3 = (pts) => {
      if (pts.length < 3) return null;
      const n = pts.length;
      const cLat = pts.reduce((s, p) => s + p.lat, 0) / n;
      const cLng = pts.reduce((s, p) => s + p.lng, 0) / n;
      const mPts = pts.map(p => ({ x: (p.lng - cLng) * mPerLng, y: (p.lat - cLat) * mPerLat }));
      let sX=0,sY=0,sX2=0,sY2=0,sXY=0,sX3=0,sY3=0,sX2Y=0,sXY2=0;
      for (const p of mPts) { sX+=p.x; sY+=p.y; sX2+=p.x*p.x; sY2+=p.y*p.y; sXY+=p.x*p.y; sX3+=p.x**3; sY3+=p.y**3; sX2Y+=p.x*p.x*p.y; sXY2+=p.x*p.y*p.y; }
      const A=n*sX2-sX*sX, B=n*sXY-sX*sY, C=n*sY2-sY*sY;
      const D=0.5*(n*sX3+n*sXY2-sX*sX2-sX*sY2);
      const E=0.5*(n*sX2Y+n*sY3-sY*sX2-sY*sY2);
      const det=A*C-B*B;
      if (Math.abs(det)<1e-10) return null;
      const cx=(D*C-B*E)/det, cy=(A*E-B*D)/det;
      const r=Math.sqrt(mPts.reduce((s,p)=>s+(p.x-cx)**2+(p.y-cy)**2,0)/n);
      return { lat: cLat+cy/mPerLat, lng: cLng+cx/mPerLng, radius: r };
    };

    const mPerLng2 = 111320 * Math.cos(-31.97 * Math.PI / 180);
    const mPerLat2 = 111320;

    const onClick = (e) => {
      L.DomEvent.stopPropagation(e);
      if (!setOffsetState) return;

      // Corner lot: radius collection phase
      if (offsetState.isCorner && !offsetState.cornerR && offsetState.step === 0) {
        offsetRef.current.cornerPts.push(e.latlng);
        const dot = L.circleMarker(e.latlng, { radius: 4, color: "#ff9800", fillColor: "#fff", fillOpacity: 1, weight: 2, pane: "markerPane" }).addTo(map);
        offsetRef.current.layers.push(dot);

        // After 3+ points, show preview arc
        if (offsetRef.current.cornerPts.length >= 3) {
          // Remove old preview
          offsetRef.current.layers.filter(l => l._isCornerPreview).forEach(l => map.removeLayer(l));
          offsetRef.current.layers = offsetRef.current.layers.filter(l => !l._isCornerPreview);

          const circle = fitCircle3(offsetRef.current.cornerPts);
          if (circle && circle.radius > 0 && circle.radius < 5000) {
            const pts = offsetRef.current.cornerPts;
            const sa = Math.atan2((pts[0].lng-circle.lng)*mPerLng2, (pts[0].lat-circle.lat)*mPerLat2);
            const ea = Math.atan2((pts[pts.length-1].lng-circle.lng)*mPerLng2, (pts[pts.length-1].lat-circle.lat)*mPerLat2);
            const ma = Math.atan2((pts[Math.floor(pts.length/2)].lng-circle.lng)*mPerLng2, (pts[Math.floor(pts.length/2)].lat-circle.lat)*mPerLat2);
            const norm = (a) => ((a%(2*Math.PI))+2*Math.PI)%(2*Math.PI);
            let s=norm(sa), end=norm(ea), m=norm(ma);
            const btw = (s<=end)?(m>=s&&m<=end):(m>=s||m<=end);
            if (!btw) { const t=s; s=end; end=t; }
            let sw = end-s; if (sw<=0) sw += 2*Math.PI;
            const arcPts = [];
            for (let i=0; i<=32; i++) {
              const a = s + (sw*i/32);
              arcPts.push([circle.lat + (circle.radius*Math.cos(a))/mPerLat2, circle.lng + (circle.radius*Math.sin(a))/mPerLng2]);
            }
            const preview = L.polyline(arcPts, { color: "#ff9800", weight: 2, opacity: 0.6, dashArray: "4,3" });
            preview._isCornerPreview = true; preview.addTo(map); offsetRef.current.layers.push(preview);
          }
        }
        return;
      }

      // Normal offset flow: step 0 = road, step 1 = boundary
      if (offsetState.step === 0) {
        const snap = snapToRoad(e.latlng);
        if (snap) {
          const dot = L.circleMarker(snap.point, { radius: 5, color: "#4caf50", fillColor: "#4caf50", fillOpacity: 0.9, weight: 1.5, pane: "markerPane" }).addTo(map);
          offsetRef.current.layers.push(dot);
          setOffsetState(s => ({ ...s, step: 1, road: snap }));
        }
      } else if (offsetState.step === 1) {
        const snap = snapToBoundary(e.latlng);
        if (snap) {
          const dot = L.circleMarker(snap.point, { radius: 5, color: "#66bb6a", fillColor: "#66bb6a", fillOpacity: 0.9, weight: 1.5, pane: "markerPane" }).addTo(map);
          offsetRef.current.layers.push(dot);
          setOffsetState(s => ({ ...s, step: 3, boundary: snap }));
        }
      }
    };

    // Double-click: finish corner radius collection → compute R and V
    const onDblClick = (e) => {
      L.DomEvent.stopPropagation(e);
      if (offsetState.isCorner && !offsetState.cornerR && offsetRef.current.cornerPts.length >= 3) {
        const circle = fitCircle3(offsetRef.current.cornerPts);
        if (circle && circle.radius > 0 && circle.radius < 5000) {
          const R = circle.radius;
          const V = 6.67 * Math.sqrt(R);

          // Draw final arc (solid)
          const pts = offsetRef.current.cornerPts;
          const sa = Math.atan2((pts[0].lng-circle.lng)*mPerLng2, (pts[0].lat-circle.lat)*mPerLat2);
          const ea = Math.atan2((pts[pts.length-1].lng-circle.lng)*mPerLng2, (pts[pts.length-1].lat-circle.lat)*mPerLat2);
          const ma = Math.atan2((pts[Math.floor(pts.length/2)].lng-circle.lng)*mPerLng2, (pts[Math.floor(pts.length/2)].lat-circle.lat)*mPerLat2);
          const norm = (a) => ((a%(2*Math.PI))+2*Math.PI)%(2*Math.PI);
          let s=norm(sa), end=norm(ea), m=norm(ma);
          const btw = (s<=end)?(m>=s&&m<=end):(m>=s||m<=end);
          if (!btw) { const t=s; s=end; end=t; }
          let sw = end-s; if (sw<=0) sw += 2*Math.PI;
          // Remove preview
          offsetRef.current.layers.filter(l => l._isCornerPreview).forEach(l => map.removeLayer(l));
          offsetRef.current.layers = offsetRef.current.layers.filter(l => !l._isCornerPreview);
          const arcPts = [];
          for (let i=0; i<=48; i++) {
            const a = s + (sw*i/48);
            arcPts.push([circle.lat + (R*Math.cos(a))/mPerLat2, circle.lng + (R*Math.sin(a))/mPerLng2]);
          }
          const finalArc = L.polyline(arcPts, { color: "#ff9800", weight: 2, opacity: 0.8 });
          offsetRef.current.layers.push(finalArc); finalArc.addTo(map);

          // Sight distance dot on arc
          let walked = 0; let sightPt = arcPts[arcPts.length-1];
          for (let i=1; i<arcPts.length; i++) {
            const d = L.latLng(arcPts[i-1]).distanceTo(L.latLng(arcPts[i]));
            if (walked+d >= V) { const f=(V-walked)/d; sightPt=[arcPts[i-1][0]+f*(arcPts[i][0]-arcPts[i-1][0]), arcPts[i-1][1]+f*(arcPts[i][1]-arcPts[i-1][1])]; break; }
            walked += d;
          }
          const sDot = L.circleMarker(sightPt, { radius: 5, color: "#e74c3c", fillColor: "#e74c3c", fillOpacity: 1, weight: 1.5, pane: "markerPane" });
          offsetRef.current.layers.push(sDot); sDot.addTo(map);

          // Turn start/end dots
          const dStart = L.circleMarker(arcPts[0], { radius: 4, color: "#27ae60", fillColor: "#27ae60", fillOpacity: 1, weight: 1, pane: "markerPane" });
          const dEnd = L.circleMarker(arcPts[arcPts.length-1], { radius: 4, color: "#27ae60", fillColor: "#27ae60", fillOpacity: 1, weight: 1, pane: "markerPane" });
          offsetRef.current.layers.push(dStart, dEnd); dStart.addTo(map); dEnd.addTo(map);

          setOffsetState(s => ({ ...s, cornerR: R, cornerV: V }));
          offsetRef.current.cornerPts = [];
        }
      }
    };

    // Point A = intersection of:
    //   Line parallel to road, xM (2.5m) from verge toward lot
    //   Line parallel to boundary/fence, yM (4m) inside lot
    // Point B = perpendicular foot from A onto road centreline
    if (offsetState.step >= 2 && offsetState.road && offsetState.boundary) {
      const roadPt = offsetState.road.point;
      const bndPt = offsetState.boundary.point;
      const xM = offsetState.x; // from verge
      const yM = offsetState.y; // from fence

      const mPerLat = 111320;
      const mPerLng = 111320 * Math.cos(roadPt.lat * Math.PI / 180);

      // Find road segment nearest to roadPt using projection
      let rA = roadPt, rB = L.latLng(roadPt.lat, roadPt.lng + 0.0001);
      let bestD = Infinity;
      for (const src of [speedRoadsData, roadNetworkData].filter(s => s?.features)) {
        for (const f of src.features) {
          const c = f.geometry?.coordinates;
          if (!c || f.geometry?.type !== "LineString") continue;
          for (let i = 0; i < c.length - 1; i++) {
            const a = L.latLng(c[i][1], c[i][0]), b = L.latLng(c[i+1][1], c[i+1][0]);
            // Project roadPt onto segment a-b
            const ax2 = a.lng, ay2 = a.lat, bx2 = b.lng, by2 = b.lat;
            const dx2 = bx2-ax2, dy2 = by2-ay2, lenSq2 = dx2*dx2+dy2*dy2;
            if (lenSq2 < 1e-20) continue;
            const t2 = Math.max(0, Math.min(1, ((roadPt.lng-ax2)*dx2 + (roadPt.lat-ay2)*dy2) / lenSq2));
            const proj = L.latLng(ay2+t2*dy2, ax2+t2*dx2);
            const d = roadPt.distanceTo(proj);
            if (d < bestD) { bestD = d; rA = a; rB = b; }
          }
        }
      }

      // Road unit vectors (metres)
      const rdx = (rB.lng-rA.lng)*mPerLng, rdy = (rB.lat-rA.lat)*mPerLat;
      const rdL = Math.sqrt(rdx*rdx+rdy*rdy);
      if (rdL > 0.01) {
        const rux = rdx/rdL, ruy = rdy/rdL; // along road
        const rpx = -ruy, rpy = rux;         // perp to road

        // Which perp side is toward lot?
        const d2b = (bndPt.lng-roadPt.lng)*mPerLng*rpx + (bndPt.lat-roadPt.lat)*mPerLat*rpy;
        const ls = d2b >= 0 ? 1 : -1;

        // Boundary unit vectors
        const ba = offsetState.boundary.a, bb = offsetState.boundary.b;
        const bx = (bb.lng-ba.lng)*mPerLng, by = (bb.lat-ba.lat)*mPerLat;
        const bL = Math.sqrt(bx*bx+by*by);
        const bux = bL>0.01?bx/bL:0, buy = bL>0.01?by/bL:1;
        const bpx = -buy, bpy = bux; // perp to boundary

        // Which perp of boundary goes toward the road (into lot from fence)?
        const d2r = (roadPt.lng-bndPt.lng)*mPerLng*bpx + (roadPt.lat-bndPt.lat)*mPerLat*bpy;
        const fs = d2r >= 0 ? 1 : -1;

        // Line 1: parallel to road, xM from road toward lot
        // Origin (metres from rA): roadPt projected + offset perp
        const r0x = (roadPt.lng-rA.lng)*mPerLng + ls*xM*rpx;
        const r0y = (roadPt.lat-rA.lat)*mPerLat + ls*xM*rpy;

        // Line 2: parallel to boundary, yM from fence into lot
        const b0x = (bndPt.lng-rA.lng)*mPerLng + fs*yM*bpx;
        const b0y = (bndPt.lat-rA.lat)*mPerLat + fs*yM*bpy;

        // Intersect two parallel offset lines:
        // Line 1: point r0, direction along road (rux, ruy)
        // Line 2: point b0, direction along boundary (bux, buy)
        // r0 + t*(rux,ruy) = b0 + s*(bux,buy)
        const det = rux*buy - ruy*bux;
        let ptA;
        if (Math.abs(det) > 1e-8) {
          const dx = b0x-r0x, dy = b0y-r0y;
          const t = (dx*buy - dy*bux) / det;
          ptA = L.latLng(rA.lat + (r0y + t*ruy)/mPerLat, rA.lng + (r0x + t*rux)/mPerLng);
        } else {
          // Lines parallel — just use road offset point
          ptA = L.latLng(rA.lat + r0y/mPerLat, rA.lng + r0x/mPerLng);
        }

        // Point B: perpendicular foot from A onto road centreline (rA→rB)
        // Vector from rA to ptA in metres
        const pax = (ptA.lng-rA.lng)*mPerLng, pay = (ptA.lat-rA.lat)*mPerLat;
        // Project onto road direction to get distance along road from rA
        const projAlongRoad = pax*rux + pay*ruy;
        // Point B = rA + projection along road direction (this is the foot of perpendicular)
        const ptB = L.latLng(rA.lat + (projAlongRoad*ruy)/mPerLat, rA.lng + (projAlongRoad*rux)/mPerLng);

        // Verify: A→B should be perpendicular to road (dot product ≈ 0)
        // const abx = (ptB.lng-ptA.lng)*mPerLng, aby = (ptB.lat-ptA.lat)*mPerLat;
        // const dotCheck = abx*rux + aby*ruy; // should be ~0

        // Show dots + thin line
        const dotA = L.circleMarker(ptA, { radius: 5, color: "#e74c3c", fillColor: "#e74c3c", fillOpacity: 1, weight: 1.5, pane: "markerPane" }).addTo(map);
        const dotB = L.circleMarker(ptB, { radius: 5, color: "#2980b9", fillColor: "#2980b9", fillOpacity: 1, weight: 1.5, pane: "markerPane" }).addTo(map);
        const lineAB = L.polyline([ptA, ptB], { color: "#95a5a6", weight: 1, dashArray: "3,3", opacity: 0.5 }).addTo(map);
        offsetRef.current.layers.push(dotA, dotB, lineAB);

        // ── Corner lot detection: find if lot has a curved corner near a road ──
        let lotPoly = selectedApp?.lot_polygon;
        if (lotPoly && lotPoly.length >= 4) {
          if (Math.abs(lotPoly[0][0]) > 90) lotPoly = lotPoly.map(p => [p[1], p[0]]);
          // Ensure closed
          const lf = lotPoly[0], ll = lotPoly[lotPoly.length-1];
          if (lf[0] !== ll[0] || lf[1] !== ll[1]) lotPoly = [...lotPoly, lf];

          // Find lot vertices near roads (within 8m of any road segment)
          const nearRoad = (pt) => {
            for (const src of [speedRoadsData, roadNetworkData].filter(s => s?.features)) {
              for (const f of src.features) {
                const c = f.geometry?.coordinates;
                if (!c || f.geometry?.type !== "LineString") continue;
                for (let j = 0; j < c.length - 1; j++) {
                  const a = L.latLng(c[j][1], c[j][0]), b = L.latLng(c[j+1][1], c[j+1][0]);
                  const dx = b.lng-a.lng, dy = b.lat-a.lat, len = dx*dx+dy*dy;
                  if (len < 1e-20) continue;
                  const t = Math.max(0, Math.min(1, ((pt.lng-a.lng)*dx + (pt.lat-a.lat)*dy) / len));
                  const snap = L.latLng(a.lat + t*dy, a.lng + t*dx);
                  if (pt.distanceTo(snap) < 8) return true;
                }
              }
            }
            return false;
          };

          // Find corner: vertex where BOTH adjacent sides are near roads
          for (let i = 1; i < lotPoly.length - 1; i++) {
            const prev = L.latLng(lotPoly[i-1][0], lotPoly[i-1][1]);
            const curr = L.latLng(lotPoly[i][0], lotPoly[i][1]);
            const next = L.latLng(lotPoly[i+1][0], lotPoly[i+1][1]);
            const midPrev = L.latLng((prev.lat+curr.lat)/2, (prev.lng+curr.lng)/2);
            const midNext = L.latLng((curr.lat+next.lat)/2, (curr.lng+next.lng)/2);

            if (nearRoad(midPrev) && nearRoad(midNext)) {
              // This is a corner lot vertex — compute radius of the corner
              // Use the three points: prev, curr, next to fit a circle
              const cLat = (prev.lat+curr.lat+next.lat)/3;
              const cLng = (prev.lng+curr.lng+next.lng)/3;
              const pts3 = [prev, curr, next].map(p => ({
                x: (p.lng - cLng) * mPerLng,
                y: (p.lat - cLat) * mPerLat
              }));
              // Circumscribed circle of 3 points
              const ax2 = pts3[0].x, ay2 = pts3[0].y;
              const bx2 = pts3[1].x, by2 = pts3[1].y;
              const cx2 = pts3[2].x, cy2 = pts3[2].y;
              const D2 = 2 * (ax2*(by2-cy2) + bx2*(cy2-ay2) + cx2*(ay2-by2));
              if (Math.abs(D2) > 1e-6) {
                const ux = ((ax2*ax2+ay2*ay2)*(by2-cy2) + (bx2*bx2+by2*by2)*(cy2-ay2) + (cx2*cx2+cy2*cy2)*(ay2-by2)) / D2;
                const uy = ((ax2*ax2+ay2*ay2)*(cx2-bx2) + (bx2*bx2+by2*by2)*(ax2-cx2) + (cx2*cx2+cy2*cy2)*(bx2-ax2)) / D2;
                const R = Math.sqrt((ax2-ux)**2 + (ay2-uy)**2);

                if (R > 1 && R < 200) {
                  const centerLat = cLat + uy / mPerLat;
                  const centerLng = cLng + ux / mPerLng;
                  const V = 6.67 * Math.sqrt(R);

                  // Draw arc from prev to next through curr
                  const sa = Math.atan2((prev.lng-centerLng)*mPerLng, (prev.lat-centerLat)*mPerLat);
                  const ea = Math.atan2((next.lng-centerLng)*mPerLng, (next.lat-centerLat)*mPerLat);
                  const ma = Math.atan2((curr.lng-centerLng)*mPerLng, (curr.lat-centerLat)*mPerLat);
                  const nm = (a) => ((a%(2*Math.PI))+2*Math.PI)%(2*Math.PI);
                  let s = nm(sa), e = nm(ea), m = nm(ma);
                  const btw = (s<=e) ? (m>=s && m<=e) : (m>=s || m<=e);
                  if (!btw) { const tmp = s; s = e; e = tmp; }
                  let sw = e - s; if (sw <= 0) sw += 2*Math.PI;

                  const arcPts = [];
                  for (let k = 0; k <= 32; k++) {
                    const a = s + (sw * k / 32);
                    arcPts.push([centerLat + (R*Math.cos(a))/mPerLat, centerLng + (R*Math.sin(a))/mPerLng]);
                  }
                  const cornerArc = L.polyline(arcPts, { color: "#ff9800", weight: 1.5, opacity: 0.8 });
                  offsetRef.current.layers.push(cornerArc);
                  cornerArc.addTo(map);

                  // Sight distance marker on arc
                  let walked2 = 0;
                  let sPt = arcPts[arcPts.length-1];
                  for (let k = 1; k < arcPts.length; k++) {
                    const sd = L.latLng(arcPts[k-1]).distanceTo(L.latLng(arcPts[k]));
                    if (walked2 + sd >= V) {
                      const fr = (V - walked2) / sd;
                      sPt = [arcPts[k-1][0]+fr*(arcPts[k][0]-arcPts[k-1][0]), arcPts[k-1][1]+fr*(arcPts[k][1]-arcPts[k-1][1])];
                      break;
                    }
                    walked2 += sd;
                  }
                  const sDot = L.circleMarker(sPt, { radius: 5, color: "#ff9800", fillColor: "#ff9800", fillOpacity: 1, weight: 1, pane: "markerPane" });
                  offsetRef.current.layers.push(sDot);
                  sDot.addTo(map);
                }
              }
              break; // Only process first corner found
            }
          }
        }

        // Feed A and B into sight triangle (with corner speed if available)
        if (onOffsetComplete) {
          onOffsetComplete({ lat: ptA.lat, lng: ptA.lng }, { lat: ptB.lat, lng: ptB.lng }, offsetState.cornerV || null);
        }
      }
    }

    if (mapTool === "offset") {
      map.on("preclick", onClick);
      map.on("dblclick", onDblClick);
      map.doubleClickZoom.disable();
    }
    return () => { map.off("preclick", onClick); map.off("dblclick", onDblClick); map.doubleClickZoom.enable(); map.getContainer().style.cursor = ""; };
  }, [mapTool, offsetState, leafletLoaded, speedRoadsData, roadNetworkData, allLotsData]);

  // ── Clear draw annotations ──
  const clearDrawAnnotations = () => {
    if (!mapInstanceRef.current) return;
    drawToolRef.current.layers.forEach(l => mapInstanceRef.current.removeLayer(l));
    drawToolRef.current = { layers: [], lastPt: null, mode: "line" };
  };

  // ── Radius tool — click points on curve, compute R, V=6.67√R, draw sight line ──
  const radiusRef = useRef({ pts: [], layers: [] });
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    const L = window.L;
    const map = mapInstanceRef.current;

    // Don't clear radius layers if corner curve was completed (keep arc + sight dot visible)
    if (!(offsetState?.cornerR > 0)) {
      radiusRef.current.layers.forEach(l => map.removeLayer(l));
      radiusRef.current = { pts: [], layers: [] };
    }

    if (mapTool !== "radius") return;
    map.getContainer().style.cursor = "crosshair";

    const mPerLat = 111320;
    const mPerLng = 111320 * Math.cos(-31.97 * Math.PI / 180);

    const fitCircle = (pts) => {
      if (pts.length < 3) return null;
      const n = pts.length;
      const cLat = pts.reduce((s, p) => s + p.lat, 0) / n;
      const cLng = pts.reduce((s, p) => s + p.lng, 0) / n;
      const mPts = pts.map(p => ({ x: (p.lng - cLng) * mPerLng, y: (p.lat - cLat) * mPerLat }));
      let sX=0,sY=0,sX2=0,sY2=0,sXY=0,sX3=0,sY3=0,sX2Y=0,sXY2=0;
      for (const p of mPts) { sX+=p.x; sY+=p.y; sX2+=p.x*p.x; sY2+=p.y*p.y; sXY+=p.x*p.y; sX3+=p.x**3; sY3+=p.y**3; sX2Y+=p.x*p.x*p.y; sXY2+=p.x*p.y*p.y; }
      const A=n*sX2-sX*sX, B=n*sXY-sX*sY, C=n*sY2-sY*sY;
      const D=0.5*(n*sX3+n*sXY2-sX*sX2-sX*sY2);
      const E=0.5*(n*sX2Y+n*sY3-sY*sX2-sY*sY2);
      const det=A*C-B*B;
      if (Math.abs(det)<1e-10) return null;
      const cx=(D*C-B*E)/det, cy=(A*E-B*D)/det;
      const r=Math.sqrt(mPts.reduce((s,p)=>s+(p.x-cx)**2+(p.y-cy)**2,0)/n);
      return { lat: cLat+cy/mPerLat, lng: cLng+cx/mPerLng, radius: r };
    };

    const redraw = () => {
      radiusRef.current.layers.filter(l => l._isResult).forEach(l => map.removeLayer(l));
      radiusRef.current.layers = radiusRef.current.layers.filter(l => !l._isResult);

      const pts = radiusRef.current.pts;
      if (pts.length < 3) return;

      const circle = fitCircle(pts);
      if (!circle || circle.radius <= 0 || circle.radius > 5000) return;

      const R = circle.radius;
      const V = 6.67 * Math.sqrt(R);

      // Find ALL nearby road segments (within 30m) — handles intersections where two roads meet
      const nearbyRoadPts = [];
      const midClickPt = pts[Math.floor(pts.length / 2)];
      for (const src of [speedRoadsData, roadNetworkData].filter(s => s?.features)) {
        for (const f of src.features) {
          const c = f.geometry?.coordinates;
          if (!c || f.geometry?.type !== "LineString") continue;
          let isNear = false;
          for (const coord of c) {
            if (midClickPt.distanceTo(L.latLng(coord[1], coord[0])) < 50) { isNear = true; break; }
          }
          if (!isNear) continue;
          // Add all vertices from this road
          for (const coord of c) {
            const p = { lat: coord[1], lng: coord[0], road: f.properties?.rd || "" };
            if (L.latLng(p.lat, p.lng).distanceTo(L.latLng(circle.lat, circle.lng)) < R * 3) {
              nearbyRoadPts.push(p);
            }
          }
        }
      }

      let turnStart = null, turnEnd = null;
      let arcPts = [];

      if (nearbyRoadPts.length >= 3) {
        // For each road point, compute distance from best-fit circle
        const withDist = nearbyRoadPts.map(p => {
          const dx = (p.lng - circle.lng) * mPerLng;
          const dy = (p.lat - circle.lat) * mPerLat;
          const distFromCircle = Math.abs(Math.sqrt(dx*dx + dy*dy) - R);
          const angle = Math.atan2(dx, dy);
          return { ...p, distFromCircle, angle };
        });

        // Points on the curve: within 20% of R
        const threshold = R * 0.25;
        const onCurve = withDist.filter(p => p.distFromCircle < threshold);

        if (onCurve.length >= 2) {
          // Sort by angle to get ordered arc
          onCurve.sort((a, b) => a.angle - b.angle);

          // Find the angular gap to determine start/end
          let maxGap = 0, gapIdx = 0;
          for (let i = 0; i < onCurve.length; i++) {
            const next = (i + 1) % onCurve.length;
            let gap = onCurve[next].angle - onCurve[i].angle;
            if (gap < 0) gap += 2 * Math.PI;
            if (gap > maxGap) { maxGap = gap; gapIdx = next; }
          }

          // Reorder so arc starts after the biggest gap
          const ordered = [...onCurve.slice(gapIdx), ...onCurve.slice(0, gapIdx)];
          turnStart = L.latLng(ordered[0].lat, ordered[0].lng);
          turnEnd = L.latLng(ordered[ordered.length-1].lat, ordered[ordered.length-1].lng);
          arcPts = ordered.map(p => [p.lat, p.lng]);
        }
      }

      // Fallback: use fitted arc if no road geometry found
      if (arcPts.length < 3) {
        const startAngle = Math.atan2((pts[0].lng - circle.lng) * mPerLng, (pts[0].lat - circle.lat) * mPerLat);
        const endAngle = Math.atan2((pts[pts.length-1].lng - circle.lng) * mPerLng, (pts[pts.length-1].lat - circle.lat) * mPerLat);
        const midAngle = Math.atan2((midClickPt.lng - circle.lng) * mPerLng, (midClickPt.lat - circle.lat) * mPerLat);
        const norm = (a) => ((a % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI);
        let sa = norm(startAngle), ea = norm(endAngle), ma = norm(midAngle);
        const between = (sa <= ea) ? (ma >= sa && ma <= ea) : (ma >= sa || ma <= ea);
        if (!between) { const t = sa; sa = ea; ea = t; }
        let sweep = ea - sa; if (sweep <= 0) sweep += 2 * Math.PI;
        arcPts = [];
        for (let i = 0; i <= 64; i++) {
          const a = sa + (sweep * i / 64);
          arcPts.push([circle.lat + (R * Math.cos(a)) / mPerLat, circle.lng + (R * Math.sin(a)) / mPerLng]);
        }
        turnStart = L.latLng(arcPts[0]);
        turnEnd = L.latLng(arcPts[arcPts.length - 1]);
      }

      // Draw smooth arc
      const arc = L.polyline(arcPts, { color: "#ff9800", weight: 2, opacity: 0.8 });
      arc._isResult = true; arc.addTo(map); radiusRef.current.layers.push(arc);

      // Turn start dot (green)
      if (turnStart) {
        const dStart = L.circleMarker(turnStart, { radius: 5, color: "#27ae60", fillColor: "#27ae60", fillOpacity: 1, weight: 1.5, pane: "markerPane" });
        dStart._isResult = true; dStart.addTo(map); radiusRef.current.layers.push(dStart);
      }

      // Turn end dot (green)
      if (turnEnd) {
        const dEnd = L.circleMarker(turnEnd, { radius: 5, color: "#27ae60", fillColor: "#27ae60", fillOpacity: 1, weight: 1.5, pane: "markerPane" });
        dEnd._isResult = true; dEnd.addTo(map); radiusRef.current.layers.push(dEnd);
      }

      // Sight distance marker: walk V metres along arc from turn start
      let walked = 0;
      let sightPt = arcPts[arcPts.length - 1];
      for (let i = 1; i < arcPts.length; i++) {
        const segD = L.latLng(arcPts[i-1]).distanceTo(L.latLng(arcPts[i]));
        if (walked + segD >= V) {
          const frac = (V - walked) / segD;
          sightPt = [arcPts[i-1][0] + frac*(arcPts[i][0]-arcPts[i-1][0]), arcPts[i-1][1] + frac*(arcPts[i][1]-arcPts[i-1][1])];
          break;
        }
        walked += segD;
      }

      const sightDot = L.circleMarker(sightPt, { radius: 6, color: "#e74c3c", fillColor: "#e74c3c", fillOpacity: 1, weight: 1.5, pane: "markerPane" });
      sightDot._isResult = true; sightDot.addTo(map); radiusRef.current.layers.push(sightDot);

      // Arc length for info
      let arcLen = 0;
      for (let i = 1; i < arcPts.length; i++) arcLen += L.latLng(arcPts[i-1]).distanceTo(L.latLng(arcPts[i]));

      if (setRadiusResult) setRadiusResult(`R=${R.toFixed(1)}m · V=${V.toFixed(0)}km/h · Arc=${arcLen.toFixed(0)}m`);
      // Store last computed R/V for dblclick confirmation
      radiusRef.current.lastR = R;
      radiusRef.current.lastV = V;
    };

    const onClick = (e) => {
      L.DomEvent.stopPropagation(e);
      radiusRef.current.pts.push(e.latlng);
      const dot = L.circleMarker(e.latlng, { radius: 4, color: "#ff9800", fillColor: "#fff", fillOpacity: 1, weight: 2, pane: "markerPane" }).addTo(map);
      radiusRef.current.layers.push(dot);
      if (radiusRef.current.pts.length >= 3) redraw();
    };

    const onDblClick = (e) => {
      L.DomEvent.stopPropagation(e);
      // Reset points to start fresh
      radiusRef.current.pts = [];
      radiusRef.current.lastR = null;
      radiusRef.current.lastV = null;
      // Clear drawn layers
      radiusRef.current.layers.filter(l => l._isResult).forEach(l => map.removeLayer(l));
      radiusRef.current.layers = radiusRef.current.layers.filter(l => !l._isResult);
      if (setRadiusResult) setRadiusResult(null);
    };

    map.on("preclick", onClick);
    map.on("dblclick", onDblClick);
    map.doubleClickZoom.disable();

    return () => {
      map.off("preclick", onClick);
      map.off("dblclick", onDblClick);
      map.doubleClickZoom.enable();
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
