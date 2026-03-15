import { useState, useEffect } from "react";
import { LEAFLET_CSS, LEAFLET_JS } from '../data/constants';

// ─── Load Leaflet dynamically ───────────────────────────
export default function useLeaflet() {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (window.L) { setLoaded(true); return; }
    const link = document.createElement("link"); link.rel = "stylesheet"; link.href = LEAFLET_CSS; document.head.appendChild(link);
    const script = document.createElement("script"); script.src = LEAFLET_JS;
    script.onload = () => setLoaded(true); document.head.appendChild(script);
  }, []);
  return loaded;
}
