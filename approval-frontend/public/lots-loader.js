// public/lots-loader.js
(() => {
  // Expose a Promise so the app can await if needed (optional)
  window.__KALAMUNDA_LOTS_READY__ = (async () => {
    try {
      // Adjust path if your geojson lives elsewhere
      const res = await fetch('/lot.geojson', {
        headers: { 'Accept': 'application/geo+json,application/json' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const geo = await res.json();

      if (!geo || geo.type !== 'FeatureCollection' || !Array.isArray(geo.features)) {
        throw new Error('Invalid GeoJSON: expected FeatureCollection');
      }

      window.__KALAMUNDA_LOTS__ = geo;
      return geo;
    } catch (err) {
      console.error('Failed to load lot.geojson:', err);
      window.__KALAMUNDA_LOTS__ = null; // explicit null to stop any polling loops
      throw err;
    }
  })();
})();
