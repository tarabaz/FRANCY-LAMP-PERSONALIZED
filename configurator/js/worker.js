// Worker di conversione: immagine (già ritagliata sul cerchio interno) -> mappa a max N colori
// pieni, pulita per la stampa 3D, poi vettorializzata per colore.
// Gira in un Web Worker così la pagina resta reattiva e la foto non lascia mai il browser.

importScripts('../vendor/imagetracer.js');

const NONE = 255; // pixel fuori dal cerchio

self.onmessage = (e) => {
  const { id, imageData, size, ppmm, opts } = e.data;
  try {
    const result = convert(imageData, size, ppmm, opts, (msg) => self.postMessage({ id, progress: msg }));
    self.postMessage({ id, result }, [result.labels.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack || err) });
  }
};

function convert(rgba, size, ppmm, opts, progress) {
  const n = size * size;
  const cx = (size - 1) / 2, r = size / 2;

  // Maschera del cerchio
  const inside = new Uint8Array(n);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x - cx, dy = y - cx;
    if (dx * dx + dy * dy <= r * r) inside[y * size + x] = 1;
  }

  // 1. Semplificazione: filtro Kuwahara, appiattisce texture e pennellate mantenendo i bordi netti
  progress('Semplificazione');
  let img = boxBlur(rgba, size, 1);
  // In "grafica pronta" il filtro è più leggero per non cancellare le linee nere sottili
  const radii = opts.mode === 'outline' ? [0, 2, 3, 5, 7] : [0, 1, 1, 2, 3];
  const kr = Math.round((radii[opts.smooth] || 0) * ppmm / 5);
  if (kr > 0) { img = kuwahara(img, size, kr); img = kuwahara(img, size, Math.max(1, kr >> 1)); }

  // 2. Lab + k-means
  progress('Riduzione colori');
  const lab = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const l = rgb2lab(img[i * 4], img[i * 4 + 1], img[i * 4 + 2]);
    lab[i * 3] = l[0]; lab[i * 3 + 1] = l[1]; lab[i * 3 + 2] = l[2];
  }
  const outlines = opts.mode === 'outline';
  // In modalità "contorni automatici" il nero è un colore in più, quindi k = N-1
  const k = Math.max(1, outlines ? opts.colors - 1 : opts.colors);
  let centers = kmeans(lab, inside, n, k, opts.seed || 1);

  let labels = new Uint8Array(n).fill(NONE);
  assign(lab, inside, labels, centers);

  // 3. Filtro di maggioranza: toglie i puntini isolati
  progress('Pulizia');
  for (let i = 0; i < 2; i++) labels = modeFilter(labels, size, k + 1);

  // Palette RGB (dalla media reale dei pixel di ogni cluster)
  let palette = centers.map((c) => lab2rgb(c[0], c[1], c[2]));
  let blackIdx = -1;

  const minAreaPx = Math.max(1, Math.round(opts.minAreaMm2 * ppmm * ppmm));

  if (outlines) {
    // Aree piccole -> assorbite dal vicino, poi linee nere tra le zone
    mergeSmallRegions(labels, size, minAreaPx, k);
    blackIdx = k;
    palette.push({ r: 20, g: 20, b: 20 });
    progress('Contorni neri');
    drawOutlines(labels, inside, size, blackIdx, (opts.lineMm * ppmm) / 2);
  } else {
    // Grafica con contorni già presenti: il cluster più scuro diventa il "nero"
    let darkest = 0;
    for (let i = 1; i < centers.length; i++) if (centers[i][0] < centers[darkest][0]) darkest = i;
    if (centers[darkest][0] < 30) {
      blackIdx = darkest;
      palette[darkest] = { r: 20, g: 20, b: 20 };
      // tutti i cluster quasi neri diventano lo stesso nero (niente filamenti sprecati)
      for (let i = 0; i < labels.length; i++) if (labels[i] !== NONE && centers[labels[i]][0] < 22) labels[i] = blackIdx;
      if (opts.thickenMm > 0) dilateLabel(labels, inside, size, blackIdx, opts.thickenMm * ppmm);
    }
    mergeSmallRegions(labels, size, minAreaPx, palette.length);
  }

  // Zone colorate troppo strette per essere stampate -> nere (se c'è un nero) o al vicino
  if (blackIdx >= 0) {
    progress('Spessori minimi');
    openColored(labels, inside, size, blackIdx, (opts.minFeatureMm * ppmm) / 2);
    killSmallColored(labels, size, minAreaPx, blackIdx);
  }

  // Compatta la palette togliendo colori spariti
  const counts = new Uint32Array(palette.length);
  for (let i = 0; i < n; i++) if (labels[i] !== NONE) counts[labels[i]]++;
  const remap = new Uint8Array(256).fill(NONE);
  const newPal = [];
  palette.forEach((p, i) => { if (counts[i] > 0) { remap[i] = newPal.length; newPal.push({ ...p, area: counts[i] / (ppmm * ppmm), black: i === blackIdx }); } });
  for (let i = 0; i < n; i++) labels[i] = remap[labels[i]];
  palette = newPal;

  // 4. Vettorializzazione
  progress('Vettorializzazione');
  const layers = trace(labels, size, palette.length, opts);

  return { labels, palette, layers, size, ppmm };
}

// ---------- colore ----------
function srgb2lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lin2srgb(c) { c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(c * 255))); }
function rgb2lab(r, g, b) {
  r = srgb2lin(r); g = srgb2lin(g); b = srgb2lin(b);
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  let y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
function lab2rgb(L, a, b) {
  let y = (L + 16) / 116, x = a / 500 + y, z = y - b / 200;
  const f = (t) => (t * t * t > 0.008856 ? t * t * t : (t - 16 / 116) / 7.787);
  x = f(x) * 0.95047; y = f(y); z = f(z) * 1.08883;
  return {
    r: lin2srgb(x * 3.2406 + y * -1.5372 + z * -0.4986),
    g: lin2srgb(x * -0.9689 + y * 1.8758 + z * 0.0415),
    b: lin2srgb(x * 0.0557 + y * -0.204 + z * 1.057),
  };
}

function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function kmeans(lab, inside, n, k, seed) {
  const rand = rng(seed);
  // campione
  const idx = [];
  for (let i = 0; i < n; i++) if (inside[i]) idx.push(i);
  const S = Math.min(30000, idx.length);
  const sample = new Float32Array(S * 3);
  for (let s = 0; s < S; s++) {
    const i = idx[Math.floor(rand() * idx.length)];
    sample[s * 3] = lab[i * 3]; sample[s * 3 + 1] = lab[i * 3 + 1]; sample[s * 3 + 2] = lab[i * 3 + 2];
  }
  // k-means++
  const centers = [];
  let s0 = Math.floor(rand() * S);
  centers.push([sample[s0 * 3], sample[s0 * 3 + 1], sample[s0 * 3 + 2]]);
  const d = new Float32Array(S).fill(Infinity);
  while (centers.length < k) {
    const c = centers[centers.length - 1];
    let sum = 0;
    for (let s = 0; s < S; s++) {
      const dd = dist2(sample, s, c);
      if (dd < d[s]) d[s] = dd;
      sum += d[s];
    }
    let t = rand() * sum, pick = 0;
    for (let s = 0; s < S; s++) { t -= d[s]; if (t <= 0) { pick = s; break; } }
    centers.push([sample[pick * 3], sample[pick * 3 + 1], sample[pick * 3 + 2]]);
  }
  // Lloyd
  const asg = new Uint8Array(S);
  for (let it = 0; it < 20; it++) {
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (let s = 0; s < S; s++) {
      let best = 0, bd = Infinity;
      for (let j = 0; j < k; j++) { const dd = dist2(sample, s, centers[j]); if (dd < bd) { bd = dd; best = j; } }
      asg[s] = best;
      const a = acc[best]; a[0] += sample[s * 3]; a[1] += sample[s * 3 + 1]; a[2] += sample[s * 3 + 2]; a[3]++;
    }
    let moved = 0;
    for (let j = 0; j < k; j++) {
      const a = acc[j];
      if (a[3] === 0) continue;
      const nc = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
      moved += Math.abs(nc[0] - centers[j][0]) + Math.abs(nc[1] - centers[j][1]) + Math.abs(nc[2] - centers[j][2]);
      centers[j] = nc;
    }
    if (moved < 0.5) break;
  }
  return centers;
}
function dist2(arr, s, c) { const a = arr[s * 3] - c[0], b = arr[s * 3 + 1] - c[1], d = arr[s * 3 + 2] - c[2]; return a * a + b * b + d * d; }

function assign(lab, inside, labels, centers) {
  const n = labels.length;
  for (let i = 0; i < n; i++) {
    if (!inside[i]) continue;
    let best = 0, bd = Infinity;
    for (let j = 0; j < centers.length; j++) {
      const a = lab[i * 3] - centers[j][0], b = lab[i * 3 + 1] - centers[j][1], d = lab[i * 3 + 2] - centers[j][2];
      const dd = a * a + b * b + d * d;
      if (dd < bd) { bd = dd; best = j; }
    }
    labels[i] = best;
  }
}

// ---------- filtri ----------
function boxBlur(src, size, rad) {
  const out = new Uint8ClampedArray(src.length);
  const tmp = new Float32Array(src.length);
  const w = 2 * rad + 1;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let k = -rad; k <= rad; k++) { const xx = Math.min(size - 1, Math.max(0, x + k)); s += src[(y * size + xx) * 4 + c]; }
    tmp[(y * size + x) * 4 + c] = s / w;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = -rad; k <= rad; k++) { const yy = Math.min(size - 1, Math.max(0, y + k)); s += tmp[(yy * size + x) * 4 + c]; }
      out[(y * size + x) * 4 + c] = s / w;
    }
    out[(y * size + x) * 4 + 3] = 255;
  }
  return out;
}

function kuwahara(src, size, r) {
  const W = size + 1;
  const I = [new Float64Array(W * W), new Float64Array(W * W), new Float64Array(W * W), new Float64Array(W * W), new Float64Array(W * W)];
  for (let y = 0; y < size; y++) {
    const rs = [0, 0, 0, 0, 0];
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const R = src[i], G = src[i + 1], B = src[i + 2], L = 0.299 * R + 0.587 * G + 0.114 * B;
      rs[0] += R; rs[1] += G; rs[2] += B; rs[3] += L; rs[4] += L * L;
      const o = (y + 1) * W + x + 1;
      for (let c = 0; c < 5; c++) I[c][o] = I[c][o - W] + rs[c];
    }
  }
  const box = (c, x0, y0, x1, y1) => I[c][y1 * W + x1] - I[c][y0 * W + x1] - I[c][y1 * W + x0] + I[c][y0 * W + x0];
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let best = Infinity, bx0 = 0, by0 = 0, bx1 = 0, by1 = 0;
    for (let q = 0; q < 4; q++) {
      const x0 = Math.max(0, q & 1 ? x : x - r), x1 = Math.min(size, (q & 1 ? x + r : x) + 1);
      const y0 = Math.max(0, q & 2 ? y : y - r), y1 = Math.min(size, (q & 2 ? y + r : y) + 1);
      const nn = (x1 - x0) * (y1 - y0);
      const m = box(3, x0, y0, x1, y1) / nn;
      const v = box(4, x0, y0, x1, y1) / nn - m * m;
      if (v < best) { best = v; bx0 = x0; by0 = y0; bx1 = x1; by1 = y1; }
    }
    const nn = (bx1 - bx0) * (by1 - by0), o = (y * size + x) * 4;
    out[o] = box(0, bx0, by0, bx1, by1) / nn;
    out[o + 1] = box(1, bx0, by0, bx1, by1) / nn;
    out[o + 2] = box(2, bx0, by0, bx1, by1) / nn;
    out[o + 3] = 255;
  }
  return out;
}

function modeFilter(labels, size, k) {
  const out = new Uint8Array(labels);
  const cnt = new Uint16Array(256);
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
    const i = y * size + x;
    if (labels[i] === NONE) continue;
    let best = labels[i], bc = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const l = labels[i + dy * size + dx];
      if (l === NONE) continue;
      const c = ++cnt[l];
      if (c > bc) { bc = c; best = l; }
    }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cnt[labels[i + dy * size + dx]] = 0;
    if (bc >= 5) out[i] = best;
  }
  return out;
}

// Componenti connesse (4-connettività). Ritorna array comp id e lista info.
function components(labels, size) {
  const n = labels.length;
  const comp = new Int32Array(n).fill(-1);
  const comps = [];
  const stack = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (comp[i] !== -1 || labels[i] === NONE) continue;
    const l = labels[i], id = comps.length;
    let sp = 0, area = 0;
    stack[sp++] = i; comp[i] = id;
    while (sp) {
      const p = stack[--sp]; area++;
      const x = p % size, y = (p / size) | 0;
      if (x > 0 && comp[p - 1] === -1 && labels[p - 1] === l) { comp[p - 1] = id; stack[sp++] = p - 1; }
      if (x < size - 1 && comp[p + 1] === -1 && labels[p + 1] === l) { comp[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0 && comp[p - size] === -1 && labels[p - size] === l) { comp[p - size] = id; stack[sp++] = p - size; }
      if (y < size - 1 && comp[p + size] === -1 && labels[p + size] === l) { comp[p + size] = id; stack[sp++] = p + size; }
    }
    comps.push({ label: l, area });
  }
  return { comp, comps };
}

// Le regioni sotto soglia prendono il colore del vicino con cui confinano di più
function mergeSmallRegions(labels, size, minArea, k) {
  for (let pass = 0; pass < 3; pass++) {
    const { comp, comps } = components(labels, size);
    const small = comps.map((c) => c.area < minArea);
    if (!small.some(Boolean)) return;
    const votes = new Map();
    const n = labels.length;
    for (let i = 0; i < n; i++) {
      const c = comp[i];
      if (c < 0 || !small[c]) continue;
      const x = i % size;
      const nb = [x > 0 ? i - 1 : -1, x < size - 1 ? i + 1 : -1, i - size, i + size];
      for (const j of nb) {
        if (j < 0 || j >= n || labels[j] === NONE || comp[j] === c) continue;
        let v = votes.get(c); if (!v) votes.set(c, (v = new Map()));
        // preferisci vicini grandi
        const w = small[comp[j]] ? 0.1 : 1;
        v.set(labels[j], (v.get(labels[j]) || 0) + w);
      }
    }
    const target = new Int16Array(comps.length).fill(-1);
    for (const [c, v] of votes) { let best = -1, bv = -1; for (const [l, w] of v) if (w > bv) { bv = w; best = l; } target[c] = best; }
    let changed = false;
    for (let i = 0; i < n; i++) { const c = comp[i]; if (c >= 0 && target[c] >= 0) { labels[i] = target[c]; changed = true; } }
    if (!changed) return;
  }
}

// Distanza (chamfer 3-4, in pixel) dai pixel "seed"
function distanceFrom(isSeed, size) {
  const n = size * size, INF = 1e9;
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = isSeed[i] ? 0 : INF;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x; let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 3);
    if (y > 0) {
      v = Math.min(v, d[i - size] + 3);
      if (x > 0) v = Math.min(v, d[i - size - 1] + 4);
      if (x < size - 1) v = Math.min(v, d[i - size + 1] + 4);
    }
    d[i] = v;
  }
  for (let y = size - 1; y >= 0; y--) for (let x = size - 1; x >= 0; x--) {
    const i = y * size + x; let v = d[i];
    if (x < size - 1) v = Math.min(v, d[i + 1] + 3);
    if (y < size - 1) {
      v = Math.min(v, d[i + size] + 3);
      if (x < size - 1) v = Math.min(v, d[i + size + 1] + 4);
      if (x > 0) v = Math.min(v, d[i + size - 1] + 4);
    }
    d[i] = v;
  }
  for (let i = 0; i < n; i++) d[i] /= 3;
  return d;
}

function drawOutlines(labels, inside, size, blackIdx, halfWidthPx) {
  const n = labels.length;
  const edge = new Uint8Array(n);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, l = labels[i];
    if (l === NONE) continue;
    if ((x < size - 1 && labels[i + 1] !== l && labels[i + 1] !== NONE) ||
        (y < size - 1 && labels[i + size] !== l && labels[i + size] !== NONE)) edge[i] = 1;
  }
  const d = distanceFrom(edge, size);
  const t = Math.max(0.5, halfWidthPx - 0.5);
  for (let i = 0; i < n; i++) if (inside[i] && d[i] <= t) labels[i] = blackIdx;
}

function dilateLabel(labels, inside, size, idx, px) {
  const seed = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i++) seed[i] = labels[i] === idx ? 1 : 0;
  const d = distanceFrom(seed, size);
  for (let i = 0; i < labels.length; i++) if (inside[i] && d[i] <= px) labels[i] = idx;
}

// Apertura morfologica delle zone colorate: tutto ciò che è più stretto di 2*r diventa nero
function openColored(labels, inside, size, blackIdx, r) {
  if (r < 0.75) return;
  const n = labels.length;
  const isBlack = new Uint8Array(n);
  for (let i = 0; i < n; i++) isBlack[i] = labels[i] === blackIdx || labels[i] === NONE ? 1 : 0;
  const d = distanceFrom(isBlack, size);
  const core = new Uint8Array(n);
  for (let i = 0; i < n; i++) core[i] = !isBlack[i] && d[i] >= r ? 1 : 0;
  const d2 = distanceFrom(core, size);
  for (let i = 0; i < n; i++) if (!isBlack[i] && d2[i] > r + 0.5 && inside[i]) labels[i] = blackIdx;
}

function killSmallColored(labels, size, minArea, blackIdx) {
  const { comp, comps } = components(labels, size);
  for (let i = 0; i < labels.length; i++) {
    const c = comp[i];
    if (c >= 0 && labels[i] !== blackIdx && comps[c].area < minArea) labels[i] = blackIdx;
  }
}

// ---------- vettorializzazione ----------
function trace(labels, size, ncolors, opts) {
  const IT = self.ImageTracer;
  const arr = [];
  for (let y = 0; y < size + 2; y++) {
    const row = new Array(size + 2).fill(-1);
    if (y > 0 && y <= size) for (let x = 0; x < size; x++) { const l = labels[(y - 1) * size + x]; row[x + 1] = l === NONE ? ncolors : l; }
    arr.push(row);
  }
  const palette = [];
  for (let i = 0; i <= ncolors; i++) palette.push({ r: 0, g: 0, b: 0, a: 255 });
  const options = IT.checkoptions({ ltres: opts.ltres ?? 1, qtres: opts.qtres ?? 1, pathomit: 4, rightangleenhance: false });
  const ls = IT.layering({ array: arr, palette });
  const bps = IT.batchpathscan(ls, options.pathomit);
  const bis = IT.batchinternodes(bps, options);
  const layers = IT.batchtracelayers(bis, options.ltres, options.qtres).slice(0, ncolors); // l'ultimo layer è il fuori-cerchio
  // Serializza in stringhe "d" (coordinate in pixel immagine)
  // Coordinate convertite direttamente in mm (centro disco = 0,0)
  const sc = opts.scale ?? 1, off = opts.offset ?? 0;
  const f = (v) => Math.round((v * sc + off) * 1000) / 1000;
  return layers.map((layer) => {
    let d = '';
    for (const smp of layer) {
      if (smp.isholepath) continue;
      d += segStr(smp.segments, false, f);
      for (const h of smp.holechildren) d += segStr(layer[h].segments, true, f);
    }
    return d;
  });
}

function segStr(segs, hole, f) {
  if (!segs.length) return '';
  let s = '';
  if (!hole) {
    s += `M${f(segs[0].x1)} ${f(segs[0].y1)}`;
    for (const g of segs) s += g.type === 'Q' ? `Q${f(g.x2)} ${f(g.y2)} ${f(g.x3)} ${f(g.y3)}` : `L${f(g.x2)} ${f(g.y2)}`;
  } else {
    const last = segs[segs.length - 1];
    s += last.type === 'Q' ? `M${f(last.x3)} ${f(last.y3)}` : `M${f(last.x2)} ${f(last.y2)}`;
    for (let i = segs.length - 1; i >= 0; i--) {
      const g = segs[i];
      s += g.type === 'Q' ? `Q${f(g.x2)} ${f(g.y2)} ${f(g.x1)} ${f(g.y1)}` : `L${f(g.x1)} ${f(g.y1)}`;
    }
  }
  return s + 'Z';
}
