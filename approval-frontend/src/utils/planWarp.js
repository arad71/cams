// Draw a whole site plan onto the map using one transform for the entire image.
// (The previous approach cut the image into triangles between the clicked lot
// corners, which removed the verge, crossover and kerb outside the lot.)

// Least-squares affine fit: image px (x, y) -> { lat, lng }. Needs 3+ points.
export function fitAffine(planPts, mapPts) {
  const n = Math.min(planPts.length, mapPts.length);
  if (n < 3) return null;
  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0;
  const r = { lat: [0, 0, 0], lng: [0, 0, 0] };
  for (let i = 0; i < n; i++) {
    const { x, y } = planPts[i];
    sxx += x * x; sxy += x * y; sx += x; syy += y * y; sy += y;
    for (const k of ["lat", "lng"]) { const v = mapPts[i][k]; r[k][0] += x * v; r[k][1] += y * v; r[k][2] += v; }
  }
  const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const det3 = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det3(M);
  if (Math.abs(D) < 1e-12) return null;
  const solve = b => [0, 1, 2].map(c => det3(M.map((row, i) => row.map((v, j) => (j === c ? b[i] : v)))) / D);
  const [pa, pb, pc] = solve(r.lat), [qa, qb, qc] = solve(r.lng);
  const f = (x, y) => ({ lat: pa * x + pb * y + pc, lng: qa * x + qb * y + qc });
  f.coeffs = { pa, pb, pc, qa, qb, qc };
  return f;
}

// Returns { url, bounds } for an L.imageOverlay, at roughly the plan's own resolution.
export function warpWholePlan(img, planPts, mapPts, maxSide = 3072) {
  const A = fitAffine(planPts, mapPts);
  if (!A) return null;
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const cs = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => A(x, y));
  const minLat = Math.min(...cs.map(c => c.lat)), maxLat = Math.max(...cs.map(c => c.lat));
  const minLng = Math.min(...cs.map(c => c.lng)), maxLng = Math.max(...cs.map(c => c.lng));
  const cosLat = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const wM = (maxLng - minLng) * 111320 * cosLat, hM = (maxLat - minLat) * 111320;
  // keep the plan's pixel density: plan diagonal (px) over its ground diagonal (m)
  const c0 = A(0, 0), c1 = A(W, H);
  const groundDiag = Math.hypot((c1.lng - c0.lng) * 111320 * cosLat, (c1.lat - c0.lat) * 111320) || 1;
  let k = Math.hypot(W, H) / groundDiag; // px per metre
  k = Math.min(k, maxSide / Math.max(wM, hM));
  const outW = Math.max(1, Math.round(wM * k)), outH = Math.max(1, Math.round(hM * k));
  const canvas = document.createElement("canvas");
  canvas.width = outW; canvas.height = outH;
  const ctx = canvas.getContext("2d");
  const sx = outW / (maxLng - minLng), sy = outH / (maxLat - minLat);
  const { pa, pb, pc, qa, qb, qc } = A.coeffs;
  // canvas X = (lng - minLng) * sx,  Y = (maxLat - lat) * sy
  ctx.setTransform(qa * sx, -pa * sy, qb * sx, -pb * sy, (qc - minLng) * sx, (maxLat - pc) * sy);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0);
  return { url: canvas.toDataURL("image/png"), bounds: [[minLat, minLng], [maxLat, maxLng]] };
}
