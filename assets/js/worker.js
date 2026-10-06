// Worker di conversione: immagine (già ritagliata sul cerchio interno) -> mappa a max N colori
// pieni, pulita per la stampa 3D, poi vettorializzata per colore.
// Gira in un Web Worker così la pagina resta reattiva e la foto non lascia mai il browser.


const NONE = 255; // pixel fuori dal cerchio

let last = null; // ultima conversione, per riunire le zone senza rifare tutto

self.onmessage = (e) => {
  const { id, imageData, size, ppmm, opts, merge } = e.data;
  try {
    const result = merge ? mergeColors(merge) : convert(imageData, size, ppmm, opts, (msg) => self.postMessage({ id, progress: msg }));
    last = { labels: result.labels.slice(), palette: result.palette, size: result.size, ppmm: result.ppmm, opts: merge ? last.opts : opts };
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
  let k = Math.max(1, outlines ? opts.colors - 1 : opts.colors);
  let centers;
  // Modalità ritratto: la pelle ha una palette tutta sua (3 toni garantiti), il resto si divide gli altri colori
  let skinSet = new Set();
  const skin = opts.portrait ? skinMask(lab, inside, n, opts.seed || 1) : null;
  if (skin && k >= 4) {
    const other = new Uint8Array(n);
    for (let i = 0; i < n; i++) other[i] = inside[i] && !skin[i] ? 1 : 0;
    centers = kmeans(lab, other, n, k - 3, opts.seed || 1);
    const sc = kmeans(lab, skin, n, 3, (opts.seed || 1) + 7);
    for (const c of sc) { skinSet.add(centers.length); centers.push(c); }
  } else {
    centers = kmeans(lab, inside, n, k, opts.seed || 1);
  }

  // Bianco e nero sono le bobine fisse: si usano volentieri anche come colori del disegno.
  // Bianco: soglia larga (grigi chiarissimi, bianchi sporcati dai bordi o un po' rosati, denti, occhi).
  // Nero: tutti i colori quasi neri diventano IL nero delle linee, senza varianti.
  const chroma = (c) => Math.hypot(c[1], c[2]);
  const isWhiteC = (c) => c[0] > 74 && chroma(c) < 15;
  const isBlackC = (c) => c[0] < 18 || (c[0] < 27 && chroma(c) < 22);
  let whiteIdx = -1;
  const darkSet = new Set();
  centers.forEach((c, i) => {
    if (skinSet.has(i)) return; // i toni della pelle restano pelle anche se chiarissimi
    if (isWhiteC(c)) { if (whiteIdx < 0) whiteIdx = i; centers[i] = [98, 0, 0]; }
    else if (isBlackC(c)) { darkSet.add(i); centers[i] = [8, 0, 0]; }
  });
  if (whiteIdx < 0) {
    // nessun cluster bianco ma c'è del bianco (denti, occhi): aggiungo un bianco puro, è la bobina della base
    let tot = 0, wcount = 0;
    for (let i = 0; i < n; i++) {
      if (!inside[i]) continue;
      tot++;
      if (lab[i * 3] > 74 && Math.hypot(lab[i * 3 + 1], lab[i * 3 + 2]) < 15) wcount++;
    }
    if (wcount > tot * 0.0004) { centers.push([98, 0, 0]); whiteIdx = centers.length - 1; k = centers.length; }
  }

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
    blackIdx = k;
    palette.push({ r: 20, g: 20, b: 20 });
    // le zone quasi nere del disegno usano lo stesso nero delle linee
    if (darkSet.size) for (let i = 0; i < n; i++) if (darkSet.has(labels[i])) labels[i] = blackIdx;
    mergeSmallRegions(labels, size, minAreaPx, k, whiteIdx, skinSet);
    progress('Contorni neri');
    drawOutlines(labels, inside, size, blackIdx, (opts.lineMm * ppmm) / 2, false, skinSet);
  } else {
    // Grafica con contorni già presenti: il cluster più scuro diventa il "nero"
    let darkest = 0;
    for (let i = 1; i < centers.length; i++) if (centers[i][0] < centers[darkest][0]) darkest = i;
    if (centers[darkest][0] < 30) {
      blackIdx = darkest;
      palette[darkest] = { r: 20, g: 20, b: 20 };
      // tutti i cluster quasi neri diventano lo stesso nero (niente filamenti sprecati)
      for (let i = 0; i < labels.length; i++) if (labels[i] !== NONE && (centers[labels[i]][0] < 22 || darkSet.has(labels[i]))) labels[i] = blackIdx;
      if (opts.thickenMm > 0) dilateLabel(labels, inside, size, blackIdx, opts.thickenMm * ppmm);
    }
    mergeSmallRegions(labels, size, minAreaPx, palette.length, whiteIdx, skinSet);
    // Immagini senza contorni (o con contorni solo su una parte): aggiungo il nero tra le zone colorate
    // che non ne hanno già, senza toccare quelli esistenti
    if (opts.addOutlines) {
      if (blackIdx < 0) { blackIdx = palette.length; palette.push({ r: 20, g: 20, b: 20 }); }
      progress('Contorni mancanti');
      drawOutlines(labels, inside, size, blackIdx, (opts.lineMm * ppmm) / 2, true, skinSet);
    }
  }

  // Zone colorate troppo strette per essere stampate -> nere (se c'è un nero) o al vicino
  if (blackIdx >= 0) {
    progress('Spessori minimi');
    openColored(labels, inside, size, blackIdx, (opts.minFeatureMm * ppmm) / 2);
    killSmallColored(labels, size, minAreaPx, blackIdx, whiteIdx, skinSet);
  }

  // Volto riconosciuto (modalità ritratto): occhi e denti disegnati sempre, dopo tutti i filtri
  if (opts.face) {
    progress('Occhi e denti');
    if (whiteIdx < 0) { whiteIdx = palette.length; palette.push({ r: 250, g: 250, b: 250 }); }
    if (blackIdx < 0) { blackIdx = palette.length; palette.push({ r: 20, g: 20, b: 20 }); }
    drawFace(labels, lab, inside, size, ppmm, opts, whiteIdx, blackIdx, skinSet);
  }

  // Compatta la palette togliendo colori spariti
  const counts = new Uint32Array(palette.length);
  for (let i = 0; i < n; i++) if (labels[i] !== NONE) counts[labels[i]]++;
  const remap = new Uint8Array(256).fill(NONE);
  const newPal = [];
  palette.forEach((p, i) => { if (counts[i] > 0) { remap[i] = newPal.length; newPal.push({ ...p, area: counts[i] / (ppmm * ppmm), black: i === blackIdx, white: i === whiteIdx, skin: skinSet.has(i) }); } });
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

// Zone diverse finite sulla stessa bobina (es. due toni di pelle): diventano una zona sola e si ritraccia,
// così non restano bordi interni. merge[i] = indice della zona in cui confluisce la zona i.
function mergeColors(merge) {
  const { labels: src, palette: pal, size, ppmm, opts } = last;
  const labels = new Uint8Array(src);
  const remap = new Uint8Array(256).fill(NONE), newPal = [];
  pal.forEach((p, i) => { if (merge[i] === i) { remap[i] = newPal.length; newPal.push({ ...p }); } });
  pal.forEach((p, i) => {
    if (merge[i] === i) return;
    const t = newPal[remap[merge[i]]];
    remap[i] = remap[merge[i]];
    t.area += p.area; t.skin = t.skin || p.skin;
  });
  for (let i = 0; i < labels.length; i++) if (labels[i] !== NONE) labels[i] = remap[labels[i]];
  const layers = trace(labels, size, newPal.length, opts);
  return { labels, palette: newPal, layers, size, ppmm, merged: true };
}

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

// ---------- occhi e denti dal riconoscimento del volto ----------
// opts.face: { eyes: [{ poly, corners: [a, b], iris: { x, y, r } }], mouth: poly } in pixel dell'immagine di lavoro.
// Occhio: la palpebra viene un po' aperta (altezza minima stampabile), dentro bianco, iride nera, contorno nero.
// Bocca: dentro le labbra i pixel chiari diventano denti bianchi, quelli molto scuri nero.
function drawFace(labels, lab, inside, size, ppmm, opts, whiteIdx, blackIdx, skinSet) {
  const set = (i, l) => { if (inside[i]) labels[i] = l; };
  for (const eye of opts.face.eyes || []) {
    const [A, B] = eye.corners;
    const cx = (A[0] + B[0]) / 2, cy = (A[1] + B[1]) / 2;
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
    const u = [(B[0] - A[0]) / len, (B[1] - A[1]) / len];
    let up = [-u[1], u[0]];
    if (up[1] > 0) up = [-up[0], -up[1]];                          // "su" nell'immagine (y verso il basso)
    let bmin = 0, bmax = 0;
    for (const p of eye.poly) { const bb = (p[0] - cx) * up[0] + (p[1] - cy) * up[1]; bmin = Math.min(bmin, bb); bmax = Math.max(bmax, bb); }
    const h = bmax - bmin, minH = 1.5 * ppmm;                     // solo il minimo per poterlo stampare
    const fy = Math.max(1, minH / Math.max(h, 0.5));
    const poly = eye.poly.map((p) => {
      const a = (p[0] - cx) * u[0] + (p[1] - cy) * u[1], bb = (p[0] - cx) * up[0] + (p[1] - cy) * up[1];
      return [cx + u[0] * a + up[0] * bb * fy, cy + u[1] * a + up[1] * bb * fy];
    });
    const inEye = polyMask(poly, size);
    // iride: il suo colore vero (la zona più presente lì, escluse pelle e bianco), pupilla nera al centro
    const ir = eye.iris;
    const R = Math.max(ir ? ir.r : 0, 0.45 * ppmm);
    const ix = ir ? ir.x : cx, iy = ir ? ir.y : cy;
    const votes = new Map();
    const Ls = [];
    for (let i = 0; i < inEye.length; i++) {
      if (!inEye[i]) continue;
      Ls.push(lab[i * 3]);
      const x = (i % size) + 0.5, y = ((i / size) | 0) + 0.5;
      const l = labels[i];
      if ((x - ix) ** 2 + (y - iy) ** 2 <= R * R && l !== whiteIdx && l !== NONE && !(skinSet && skinSet.has(l))) votes.set(l, (votes.get(l) || 0) + 1);
    }
    let irisL = blackIdx, bestV = 0;
    for (const [l, v] of votes) if (v > bestV) { bestV = v; irisL = l; }
    const thr = Ls.length ? otsu(Ls) : 60;                         // chiaro = bianco dell'occhio
    const P = R * (irisL === blackIdx ? 1 : 0.42);
    const hl = R * 0.22, hx = ix + R * 0.3, hy = iy - R * 0.3;
    const showHl = hl >= 0.3 * ppmm;
    for (let i = 0; i < inEye.length; i++) {
      if (!inEye[i]) continue;
      const x = (i % size) + 0.5, y = ((i / size) | 0) + 0.5;
      const d2 = (x - ix) ** 2 + (y - iy) ** 2;
      if (showHl && (x - hx) ** 2 + (y - hy) ** 2 <= hl * hl) set(i, whiteIdx);
      else if (d2 <= P * P) set(i, blackIdx);
      else if (d2 <= R * R) set(i, irisL);
      else if (lab[i * 3] > thr - 4 || fy > 1.05) set(i, whiteIdx); // bianco solo dov'è chiaro (o dove ho dovuto aprire)
    }
    // linea delle ciglia: solo sopra, sottile
    const lw = Math.max(1, 0.35 * ppmm);
    const ring = distanceFrom(inEye, size);
    for (let i = 0; i < ring.length; i++) {
      if (inEye[i] || ring[i] > lw) continue;
      const x = (i % size) + 0.5, y = ((i / size) | 0) + 0.5;
      if ((x - cx) * up[0] + (y - cy) * up[1] > 0) set(i, blackIdx);
    }
  }
  const mouth = opts.face.mouth;
  if (mouth && mouth.length > 2) {
    const inM = polyMask(mouth, size);
    const Ls = [];
    for (let i = 0; i < inM.length; i++) if (inM[i]) Ls.push(lab[i * 3]);
    if (Ls.length > 2 * ppmm * ppmm) {                             // bocca aperta (almeno ~2 mm²)
      const thr = otsu(Ls);
      for (let i = 0; i < inM.length; i++) {
        if (!inM[i]) continue;
        const L = lab[i * 3];
        if (L > thr && L > 45) set(i, whiteIdx);
        else if (L < 35) set(i, blackIdx);
      }
    }
  }
}
function polyMask(poly, size) {
  const m = new Uint8Array(size * size);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of poly) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  x0 = Math.max(0, Math.floor(x0)); x1 = Math.min(size - 1, Math.ceil(x1)); y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(size - 1, Math.ceil(y1));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x + 0.5, py = y + 0.5;
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
    }
    if (c) m[y * size + x] = 1;
  }
  return m;
}
function otsu(vals) {
  const hist = new Float64Array(101);
  for (const v of vals) hist[Math.max(0, Math.min(100, Math.round(v)))]++;
  const tot = vals.length;
  let sum = 0; for (let t = 0; t <= 100; t++) sum += t * hist[t];
  let sB = 0, wB = 0, best = 0, thr = 50;
  for (let t = 0; t <= 100; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = tot - wB; if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (sum - sB) / wF, between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

// Soglia di area minima per ogni regione:
// - bianco (denti, occhi): un quarto
// - ritratto: macchie di pelle più grandi del normale vengono assorbite (niente chiazze sul viso),
//   mentre i dettagli circondati dalla pelle (occhi, sopracciglia, narici, bocca) restano anche se piccoli
function regionThresholds(labels, size, comp, comps, minArea, whiteIdx, skinSet) {
  const th = comps.map((c) => (c.label === whiteIdx ? minArea / 4 : minArea));
  if (!skinSet || !skinSet.size) return th;
  const border = new Float32Array(comps.length), touchSkin = new Float32Array(comps.length);
  const n = labels.length;
  for (let i = 0; i < n; i++) {
    const c = comp[i];
    if (c < 0) continue;
    const x = i % size;
    for (const j of [x > 0 ? i - 1 : -1, x < size - 1 ? i + 1 : -1, i - size, i + size]) {
      if (j < 0 || j >= n || comp[j] === c || labels[j] === NONE) continue;
      border[c]++;
      if (skinSet.has(labels[j])) touchSkin[c]++;
    }
  }
  comps.forEach((c, i) => {
    if (skinSet.has(c.label)) th[i] = minArea * 2.5;
    else if (border[i] && touchSkin[i] / border[i] > 0.6) th[i] = Math.min(th[i], minArea / 3);
  });
  return th;
}

// Pelle: pixel color pelle vicini al tono di pelle principale (che deve occupare almeno il 6% del disco).
// Ritorna la maschera oppure null se nell'immagine non c'è abbastanza pelle.
function skinMask(lab, inside, n, seed) {
  const like = new Uint8Array(n);
  let tot = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    if (!inside[i]) continue;
    tot++;
    const L = lab[i * 3], a = lab[i * 3 + 1], b = lab[i * 3 + 2];
    const ch = Math.hypot(a, b), h = Math.atan2(b, a) * 180 / Math.PI;
    if (L > 25 && L < 96 && ch > 7 && ch < 60 && h > 15 && h < 85) { like[i] = 1; cnt++; }
  }
  if (cnt < tot * 0.06) return null;
  // il tono principale: il gruppo più numeroso tra quelli abbastanza chiari (i capelli castani sono più scuri)
  const cs = kmeans(lab, like, n, 3, seed);
  const sizes = cs.map(() => 0);
  for (let i = 0; i < n; i++) {
    if (!like[i]) continue;
    let best = 0, bd = Infinity;
    cs.forEach((c, j) => { const d = dist2(lab, i, c); if (d < bd) { bd = d; best = j; } });
    sizes[best]++;
  }
  let main = -1;
  cs.forEach((c, j) => { if (c[0] > 40 && (main < 0 || sizes[j] > sizes[main])) main = j; });
  if (main < 0) return null;
  const m = cs[main], mask = new Uint8Array(n);
  let sk = 0;
  for (let i = 0; i < n; i++) {
    if (like[i] && dist2(lab, i, m) < 30 * 30 && lab[i * 3] > m[0] - 32) { mask[i] = 1; sk++; }
  }
  return sk >= tot * 0.06 ? mask : null;
}

// Le regioni sotto soglia prendono il colore del vicino con cui confinano di più
// (le zone bianche – denti, occhi – restano anche se piccole: soglia a un quarto)
function mergeSmallRegions(labels, size, minArea, k, whiteIdx = -1, skinSet = null) {
  for (let pass = 0; pass < 3; pass++) {
    const { comp, comps } = components(labels, size);
    const th = regionThresholds(labels, size, comp, comps, minArea, whiteIdx, skinSet);
    const small = comps.map((c, i) => c.area < th[i]);
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

// (in modalità ritratto niente linee tra due toni della pelle: sembrerebbero cicatrici)
function drawOutlines(labels, inside, size, blackIdx, halfWidthPx, skipBlack, skinSet = null) {
  const n = labels.length;
  const edge = new Uint8Array(n);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, l = labels[i];
    if (l === NONE || (skipBlack && l === blackIdx)) continue;
    const inSkin = skinSet && skinSet.has(l);
    const diff = (j) => labels[j] !== l && labels[j] !== NONE && !(skipBlack && labels[j] === blackIdx) && !(inSkin && skinSet.has(labels[j]));
    if ((x < size - 1 && diff(i + 1)) || (y < size - 1 && diff(i + size))) edge[i] = 1;
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

function killSmallColored(labels, size, minArea, blackIdx, whiteIdx = -1, skinSet = null) {
  const { comp, comps } = components(labels, size);
  const th = regionThresholds(labels, size, comp, comps, minArea, whiteIdx, skinSet);
  for (let i = 0; i < labels.length; i++) {
    const c = comp[i];
    if (c >= 0 && labels[i] !== blackIdx && comps[c].area < th[c]) labels[i] = blackIdx;
  }
}

// ---------- vettorializzazione ----------
// Vettorializzazione a contorni condivisi.
// Ogni confine tra due zone viene calcolato e smussato UNA volta sola e usato identico (al contrario) da
// entrambe le zone; gli incroci tra 3+ zone sono punti fissi comuni. Così tra i colori non restano né
// fessure né sovrapposizioni. Coordinate: angoli dei pixel (0..size), poi convertite in mm.
function trace(labels, size, ncolors, opts) {
  const W = size + 1;                                   // griglia degli angoli dei pixel
  const OUT = NONE;
  const lab = (x, y) => (x < 0 || y < 0 || x >= size || y >= size ? OUT : labels[y * size + x]);
  // direzioni sugli angoli (y in basso): 0=E 1=S 2=O 3=N, in senso orario
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  // etichetta a SINISTRA del semi-lato che parte dall'angolo (x,y) in direzione d, oppure -1 se lì non c'è confine
  const leftOf = (x, y, d) => {
    let a, b, left;
    if (d === 0) { a = lab(x, y - 1); b = lab(x, y); left = a; }            // E: sopra | sotto
    else if (d === 2) { a = lab(x - 1, y - 1); b = lab(x - 1, y); left = b; } // O
    else if (d === 1) { a = lab(x - 1, y); b = lab(x, y); left = b; }       // S: sinistra | destra
    else { a = lab(x - 1, y - 1); b = lab(x, y - 1); left = a; }            // N
    return a === b ? -1 : left;
  };
  // incrocio = angolo dove si toccano 3+ zone, o 2 zone "a scacchiera"
  const isJunction = (x, y) => {
    const a = lab(x - 1, y - 1), b = lab(x, y - 1), c = lab(x - 1, y), d = lab(x, y);
    const set = new Set([a, b, c, d]);
    return set.size >= 3 || (set.size === 2 && a === d && b === c);
  };

  const visited = new Uint8Array(W * W * 4);
  const ringsByLabel = Array.from({ length: ncolors }, () => []);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) for (let d = 0; d < 4; d++) {
    const L = leftOf(x, y, d);
    if (L < 0 || L === OUT || L >= ncolors || visited[(y * W + x) * 4 + d]) continue;
    // percorre l'anello della zona L tenendola a sinistra; agli incroci gira il più possibile a sinistra
    const ring = [];
    let cx = x, cy = y, cd = d, guard = 0;
    do {
      visited[(cy * W + cx) * 4 + cd] = 1;
      ring.push(cy * W + cx);
      cx += DX[cd]; cy += DY[cd];
      let nd = -1;
      for (const t of [3, 0, 1]) { const k = (cd + t) % 4; if (leftOf(cx, cy, k) === L) { nd = k; break; } }
      if (nd < 0) break; // non dovrebbe succedere
      cd = nd;
    } while (!(cx === x && cy === y && cd === d) && ++guard < 4 * W * W);
    ringsByLabel[L].push(ring);
  }

  // catene tra incroci, smussate una volta sola e riusate da entrambe le zone
  const cache = new Map();
  const jx = (id) => id % W, jy = (id) => (id / W) | 0;
  const junction = new Uint8Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) if (isJunction(x, y)) junction[y * W + x] = 1;

  const smoothOpen = (ids) => {
    let P = ids.map((id) => [jx(id), jy(id)]);
    for (let it = 0; it < 4; it++) {
      const Q = P.map((p) => p.slice());
      for (let i = 1; i < P.length - 1; i++) {
        Q[i][0] = 0.25 * P[i - 1][0] + 0.5 * P[i][0] + 0.25 * P[i + 1][0];
        Q[i][1] = 0.25 * P[i - 1][1] + 0.5 * P[i][1] + 0.25 * P[i + 1][1];
      }
      P = Q;
    }
    return simplify(P, 0.2);
  };
  const smoothClosed = (ids) => {
    let P = ids.map((id) => [jx(id), jy(id)]);
    const n = P.length;
    for (let it = 0; it < 4; it++) {
      const Q = P.map((p) => p.slice());
      for (let i = 0; i < n; i++) {
        const a = P[(i - 1 + n) % n], c = P[(i + 1) % n];
        Q[i][0] = 0.25 * a[0] + 0.5 * P[i][0] + 0.25 * c[0];
        Q[i][1] = 0.25 * a[1] + 0.5 * P[i][1] + 0.25 * c[1];
      }
      P = Q;
    }
    const s = simplify([...P, P[0]], 0.2);
    s.pop();
    return s.length >= 3 ? s : P;
  };
  // punti di una catena nel verso richiesto (calcolati una volta nel verso "canonico")
  const chainPoints = (seg) => {
    const n = seg.length;
    const fwd = seg[0] < seg[n - 1] || (seg[0] === seg[n - 1] && seg[1] <= seg[n - 2]);
    const key = fwd ? `${seg[0]},${seg[1]},${seg[n - 1]}` : `${seg[n - 1]},${seg[n - 2]},${seg[0]}`;
    let pts = cache.get(key);
    if (!pts) { pts = smoothOpen(fwd ? seg : seg.slice().reverse()); cache.set(key, pts); }
    return fwd ? pts : pts.slice().reverse();
  };
  const closedPoints = (ring) => {
    // anello senza incroci (isola): stesso inizio e verso canonico per le due zone che lo condividono
    let m = 0;
    for (let i = 1; i < ring.length; i++) if (ring[i] < ring[m]) m = i;
    const n = ring.length;
    const nxt = ring[(m + 1) % n], prv = ring[(m - 1 + n) % n];
    const fwd = nxt < prv;
    const canon = [];
    for (let i = 0; i < n; i++) canon.push(ring[(m + (fwd ? i : -i) + n * 2) % n]);
    const key = `c${canon[0]},${canon[1]}`;
    let pts = cache.get(key);
    if (!pts) { pts = smoothClosed(canon); cache.set(key, pts); }
    return fwd ? pts : [pts[0], ...pts.slice(1).reverse()];
  };

  const sc = opts.scale ?? 1, off = opts.offset ?? 0;
  const f = (v) => Math.round((v * sc + off) * 1000) / 1000;
  return ringsByLabel.map((rings) => {
    let d = '';
    for (const ring of rings) {
      if (ring.length < 3) continue;
      const n = ring.length;
      let start = -1;
      for (let i = 0; i < n; i++) if (junction[ring[i]]) { start = i; break; }
      let pts;
      if (start < 0) {
        pts = closedPoints(ring);
      } else {
        pts = [];
        const rot = [...ring.slice(start), ...ring.slice(0, start), ring[start]];
        let s0 = 0;
        for (let i = 1; i < rot.length; i++) {
          if (junction[rot[i]]) {
            const cp = chainPoints(rot.slice(s0, i + 1));
            for (let k = 0; k < cp.length - 1; k++) pts.push(cp[k]); // l'ultimo è l'inizio della catena dopo
            s0 = i;
          }
        }
      }
      if (pts.length < 3) continue;
      d += `M${f(pts[0][0])} ${f(pts[0][1])}`;
      for (let k = 1; k < pts.length; k++) d += `L${f(pts[k][0])} ${f(pts[k][1])}`;
      d += 'Z';
    }
    return d;
  });
}

// Douglas-Peucker: toglie i punti superflui mantenendo la forma entro tol (pixel); estremi fissi
function simplify(P, tol) {
  if (P.length <= 2) return P;
  const keep = new Uint8Array(P.length);
  keep[0] = keep[P.length - 1] = 1;
  const stack = [[0, P.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = P[a], [bx, by] = P[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let best = -1, bd = tol;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = P[i];
      const dist = len < 1e-9 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (dist > bd) { bd = dist; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return P.filter((_, i) => keep[i]);
}
