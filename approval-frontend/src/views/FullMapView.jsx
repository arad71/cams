import { useState } from "react";
import LeafletMap from '../components/map/LeafletMap';
import MapWithOverlay from '../components/map/MapWithOverlay';

// ─── Full Map View (Property Map) ─────────────────────
export default function FullMapView({ apps, onSelectApp, globalLotsData }) {
  const [selectedOnMap, setSelectedOnMap] = useState(null);
  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: "#1a3a4a", margin: "0 0 16px" }}>Property Map</h2>
      {selectedOnMap ? (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div><span style={{ fontWeight: 800, fontSize: 15, color: "#1a3a4a" }}>{selectedOnMap.id}</span> <span style={{ color: "#7a8a94", fontSize: 12 }}>— {selectedOnMap.property.address}</span></div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => onSelectApp(selectedOnMap)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#1abc9c", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>Full Detail →</button>
              <button onClick={() => setSelectedOnMap(null)} style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #d5dde2", background: "#fff", color: "#7a8a94", fontWeight: 600, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>✕ Close</button>
            </div>
          </div>
          <MapWithOverlay app={selectedOnMap} apps={apps} onSelectApp={onSelectApp} />
        </div>
      ) : (
        <LeafletMap apps={apps} onSelectApp={a => setSelectedOnMap(a)} height={600} allLotsData={globalLotsData} />
      )}
    </div>
  );
}
