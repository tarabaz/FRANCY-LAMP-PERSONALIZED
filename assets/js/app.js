import { FRAME, geometry, loadFont, buildFrame } from './frame.js';
import { Preview3D } from './preview3d.js';

const $ = (s) => document.querySelector(s);
const root = $('#flc-root');
const BLACK = '#151515';
const WHITE = '#ffffff';
const MAX_FILAMENTS = 12;

const state = {
  img: null, zoom: 1, ox: 0, oy: 0,
  mode: 'outline', seed: 1, lit: false, view: '2d',
  result: null, colorOverrides: {}, font: null,
  bandColor: '#5b9bd5', textColor: BLACK,
};

const worker = new Worker(new URL('./worker.js', import.meta.url));
let jobId = 0;
let preview3d = null;
let dirty3d = true;

// ---------------- ritaglio ----------------
const crop = $('#crop');
const cctx = crop.getContext('2d');

function coverScale() {
  const { img } = state;
  return Math.max(crop.width / img.width, crop.height / img.height);
}

function drawImageTo(ctx, size) {
  const { img, zoom, ox, oy } = state;
  const k = size / crop.width;
  const s = coverScale() * zoom * k;
  const w = img.width * s, h = img.height * s;
  ctx.drawImage(img, size / 2 - w / 2 + ox * k, size / 2 - h / 2 + oy * k, w, h);
}

function drawCrop() {
  cctx.clearRect(0, 0, crop.width, crop.height);
  if (!state.img) return;
  drawImageTo(cctx, crop.width);
  // oscura fuori dal cerchio del disegno
  const rr = crop.width / 2; // il ritaglio copre esattamente il cerchio del disegno
  cctx.save();
  cctx.fillStyle = 'rgba(20,20,20,.55)';
  cctx.beginPath();
  cctx.rect(0, 0, crop.width, crop.height);
  cctx.arc(crop.width / 2, crop.height / 2, rr - 1, 0, Math.PI * 2, true);
  cctx.fill('evenodd');
  cctx.strokeStyle = '#fff';
  cctx.lineWidth = 2;
  cctx.beginPath();
  cctx.arc(crop.width / 2, crop.height / 2, rr - 1, 0, Math.PI * 2);
  cctx.stroke();
  cctx.restore();
}

let drag = null;
crop.addEventListener('pointerdown', (e) => { if (!state.img) return; crop.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, ox: state.ox, oy: state.oy }; });
crop.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const k = crop.width / crop.getBoundingClientRect().width;
  state.ox = drag.ox + (e.clientX - drag.x) * k;
  state.oy = drag.oy + (e.clientY - drag.y) * k;
  drawCrop();
});
crop.addEventListener('pointerup', () => { if (drag) { drag = null; schedule(); } });
crop.addEventListener('wheel', (e) => {
  if (!state.img) return;
  e.preventDefault();
  state.zoom = Math.min(4, Math.max(1, state.zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06)));
  $('#zoom').value = state.zoom;
  drawCrop(); schedule();
}, { passive: false });
$('#zoom').addEventListener('input', (e) => { state.zoom = +e.target.value; drawCrop(); schedule(); });

$('#file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) loadImage(URL.createObjectURL(file));
});

function loadImage(src, zoom = 1) {
  const img = new Image();
  img.onload = () => { originalImg = null; $('#aiUndo').hidden = true; setImage(img, zoom, 0, 0); };
  img.src = src;
}

function setImage(img, zoom, ox, oy) {
  state.img = img; state.zoom = zoom; state.ox = ox; state.oy = oy;
  $('#zoom').value = zoom;
  $('#aiBtn').disabled = false;
  drawCrop(); run();
}

// ---------------- ridisegno con IA (passa dal plugin WordPress) ----------------
// window.FRANCY_LAMP = { restUrl, nonce } viene stampato dallo shortcode del plugin.
const qpAi = new URLSearchParams(location.search).get('ai'); // solo per test in locale
const AI = window.FRANCY_LAMP || (qpAi ? { restUrl: qpAi, nonce: '' } : null);
let originalImg = null;
if (AI && AI.restUrl) $('#aiBox').hidden = false;

function selectMode(m) { document.querySelector(`#mode button[data-mode=${m}]`).click(); }

$('#aiBtn').addEventListener('click', async () => {
  if (!state.img || $('#aiBox').classList.contains('busy')) return;
  // Mando all'IA solo il ritaglio quadrato attuale, ridotto a 1024 px
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1024, 1024);
  drawImageTo(ctx, 1024);
  const image = c.toDataURL('image/jpeg', 0.9);

  $('#aiBox').classList.add('busy');
  setStatus("L'IA sta ridisegnando la tua immagine (di solito 10–30 secondi)…");
  try {
    const r = await fetch(AI.restUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(AI.nonce ? { 'X-WP-Nonce': AI.nonce } : {}) },
      body: JSON.stringify({ image }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.image) throw new Error(j.message || 'Il ridisegno non è riuscito, riprova tra poco.');
    const img = new Image();
    await new Promise((ok, ko) => { img.onload = ok; img.onerror = ko; img.src = j.image; });
    if (!originalImg) originalImg = { img: state.img, zoom: state.zoom, ox: state.ox, oy: state.oy, mode: state.mode };
    $('#aiUndo').hidden = false;
    if (typeof j.remaining === 'number') $('#aiHint').textContent = `Ridisegni rimasti oggi: ${j.remaining}`;
    selectMode('keep');
    setImage(img, 1, 0, 0);
  } catch (err) {
    console.error(err);
    setStatus(err.message);
  } finally {
    $('#aiBox').classList.remove('busy');
  }
});

$('#aiUndo').addEventListener('click', () => {
  if (!originalImg) return;
  const o = originalImg;
  originalImg = null;
  $('#aiUndo').hidden = true;
  selectMode(o.mode);
  setImage(o.img, o.zoom, o.ox, o.oy);
});

// ---------------- controlli ----------------
const sliders = { colors: 'colorsOut', line: 'lineOut', thick: 'thickOut', smooth: 'smoothOut', feat: 'featOut', area: 'areaOut', ppmm: 'ppmmOut' };
for (const [id, out] of Object.entries(sliders)) {
  $('#' + id).addEventListener('input', (e) => { $('#' + out).textContent = e.target.value; schedule(); });
}

document.querySelectorAll('#mode button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#mode button').forEach((x) => x.classList.toggle('active', x === b));
  state.mode = b.dataset.mode;
  $('#lineRow').hidden = state.mode !== 'outline';
  $('#thickRow').hidden = state.mode === 'outline';
  updateColorLimit();
  schedule();
}));
$('#reseed').addEventListener('click', () => { state.seed++; run(); });

document.querySelectorAll('.lit-toggle button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.lit-toggle button').forEach((x) => x.classList.toggle('active', x === b));
  state.lit = b.dataset.lit === '1';
  root.classList.toggle('lit', state.lit);
  if (preview3d) preview3d.setLit(state.lit);
}));

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
  state.view = b.dataset.view;
  $('#view2d').hidden = state.view !== '2d';
  $('#view3d').hidden = state.view !== '3d';
  if (state.view === '3d') {
    if (!preview3d) preview3d = new Preview3D($('#view3d'));
    preview3d.setLit(state.lit);
    if (dirty3d) update3d();
  }
}));

let textTimer;
for (const id of ['tTL', 'tTR', 'tBL', 'tBR']) $('#' + id).addEventListener('input', () => { clearTimeout(textTimer); textTimer = setTimeout(render, 150); });

// ---------------- regola dei 12 colori ----------------
// Il limite è "al massimo 12": bianco della base e nero dei contorni contano sempre.
// Fascia e scritte possono usare un colore già presente nel disegno (gratis) o uno nuovo se c'è posto.
function drawingColors() {
  if (!state.result) return [];
  return state.result.palette.map((_, i) => artColor(i));
}
function colorSet(exclude) {
  const set = new Set([WHITE, BLACK, ...drawingColors()]);
  if (exclude !== 'band') set.add(state.bandColor.toLowerCase());
  if (exclude !== 'text') set.add(state.textColor.toLowerCase());
  return set;
}
// Colori che servono oltre a quelli del disegno: bianco base, nero cornice, fascia, scritte
function frameExtraColors() {
  const drawing = new Set(drawingColors());
  const need = new Set([WHITE, BLACK, state.bandColor.toLowerCase(), state.textColor.toLowerCase()]);
  // prima della conversione: con i contorni automatici il nero è già uno dei colori del disegno
  if (!state.result && state.mode === 'outline') need.delete(BLACK);
  let extra = 0;
  for (const c of need) if (!drawing.has(c)) extra++;
  return extra;
}
function updateColorLimit() {
  // lo slider "Colori" conta i colori del disegno (nero compreso)
  const max = MAX_FILAMENTS - frameExtraColors();
  const el = $('#colors');
  el.max = Math.max(2, max);
  if (+el.value > max) { el.value = max; $('#colorsOut').textContent = max; schedule(); }
}

function renderPickers() {
  for (const [key, id] of [['band', '#bandPicker'], ['text', '#textPicker']]) {
    const host = $(id + ' .swatches');
    host.innerHTML = '';
    const current = (key === 'band' ? state.bandColor : state.textColor).toLowerCase();
    const choices = [...new Set([WHITE, BLACK, ...drawingColors(), current])];
    for (const c of choices) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (c === current ? ' active' : '');
      b.style.background = c;
      b.title = c;
      b.addEventListener('click', () => setFrameColor(key, c));
      host.append(b);
    }
    // colore nuovo: solo se aggiungerlo non supera i 12
    const free = colorSet(key).size < MAX_FILAMENTS;
    const add = document.createElement('label');
    add.className = 'swatch-add' + (free ? '' : ' disabled');
    add.title = free ? 'Scegli un colore nuovo' : 'Hai già 12 colori: scegli tra quelli del disegno';
    add.innerHTML = '+<input type="color">';
    const inp = add.querySelector('input');
    inp.value = current;
    inp.disabled = !free;
    inp.addEventListener('change', () => setFrameColor(key, inp.value));
    host.append(add);
  }
}

function setFrameColor(key, c) {
  c = c.toLowerCase();
  if (!colorSet(key).has(c) && colorSet(key).size >= MAX_FILAMENTS) return;
  if (key === 'band') state.bandColor = c; else state.textColor = c;
  updateColorLimit();
  render();
}

function isNearBlack(hex) { const { r, g, b } = hexToRgb(hex); return r + g + b < 90; }
function isNearWhite(hex) { const { r, g, b } = hexToRgb(hex); return Math.min(r, g, b) > 232; }

// ---------------- conversione ----------------
let timer;
function schedule() { clearTimeout(timer); timer = setTimeout(run, 350); }

function run() {
  if (!state.img) return;
  const g = geometry();
  const ppmm = +$('#ppmm').value;
  const size = Math.round(2 * g.rImgArt * ppmm);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
  drawImageTo(ctx, size);
  const imageData = ctx.getImageData(0, 0, size, size).data;
  const opts = {
    mode: state.mode,
    colors: +$('#colors').value,
    lineMm: +$('#line').value,
    thickenMm: +$('#thick').value,
    smooth: +$('#smooth').value,
    minFeatureMm: +$('#feat').value,
    minAreaMm2: +$('#area').value,
    seed: state.seed,
    scale: (2 * g.rImgArt) / size,
    offset: -g.rImgArt,
  };
  const id = ++jobId;
  setStatus('Elaborazione…');
  worker.postMessage({ id, imageData, size, ppmm, opts }, [imageData.buffer]);
}

worker.onmessage = (e) => {
  const { id, progress, result, error } = e.data;
  if (id !== jobId) return;
  if (progress) return setStatus(progress + '…');
  if (error) { console.error(error); return setStatus('Errore nella conversione'); }
  state.result = result;
  state.colorOverrides = {};
  renderPalette();
  updateColorLimit();
  render();
  setStatus('');
};

function setStatus(t) { $('#status').textContent = t || (state.result ? 'Pronto' : ''); }

// ---------------- palette ----------------
function artColor(i) {
  const p = state.result.palette[i];
  if (state.colorOverrides[i]) return state.colorOverrides[i].toLowerCase();
  if (p.black) return BLACK;
  const hex = rgbToHex(p);
  return isNearWhite(hex) ? WHITE : hex; // i bianchi del disegno usano lo stesso filamento della base

}

function renderPalette() {
  const ul = $('#palette');
  ul.innerHTML = '';
  if (!state.result) return;
  state.result.palette.forEach((p, i) => {
    const li = document.createElement('li');
    const inp = document.createElement('input');
    inp.type = 'color'; inp.value = artColor(i);
    inp.addEventListener('input', () => { state.colorOverrides[i] = inp.value; render(); });
    const name = document.createElement('span');
    name.textContent = p.black ? 'Nero contorni' : `Colore ${i + 1}`;
    const area = document.createElement('span');
    area.className = 'area';
    area.textContent = `${Math.round(p.area)} mm²`;
    li.append(inp, name, area);
    ul.append(li);
  });
}

// ---------------- composizione ----------------
function texts() {
  return { topLeft: $('#tTL').value, topRight: $('#tTR').value, bottomLeft: $('#tBL').value, bottomRight: $('#tBR').value };
}

function parts() {
  const frame = buildFrame(state.font, texts());
  const band = state.bandColor, txt = state.textColor;
  const zArt = FRAME.baseThickness, hArt = FRAME.artThickness;
  // Struttura reale: base bianca piena 0,52 mm + motivo colorato 0,48 mm sopra (disco totale 1 mm)
  const list = [{ id: 'base-bianca', d: frame.outline, color: WHITE, z: 0, depth: FRAME.baseThickness, layer: 'base' }];
  const art = (o) => list.push({ z: zArt, depth: hArt, layer: 'motivo', ...o });
  if (state.result) {
    const pal = state.result.palette;
    // prima i colori, poi il nero del disegno (in caso di sovrapposizione al bordo vince il nero)
    pal.forEach((p, i) => { if (!p.black) art({ id: `disegno-colore-${i + 1}`, d: state.result.layers[i], color: artColor(i) }); });
    pal.forEach((p, i) => { if (p.black) art({ id: 'disegno-nero', d: state.result.layers[i], color: artColor(i), black: true }); });
  }
  art({ id: 'cornice-linea-interna', d: frame.innerLine, color: BLACK, black: true });
  art({ id: 'cornice-fascia', d: frame.band, color: band });
  if (frame.text) art({ id: 'cornice-scritte', d: frame.text, color: txt, black: isNearBlack(txt) });
  art({ id: 'cornice-anello-nero', d: frame.blackRing, color: BLACK, black: true });
  return list;
}

function buildSvg(forExport) {
  const R = FRAME.diameter / 2;
  const ps = parts();
  const colors = new Set(ps.map((p) => p.color.toLowerCase()));
  const body = ps.map((p) =>
    `<g id="${p.id}" data-colore="${p.color}" data-strato="${p.layer}" data-z="${p.z}" data-spessore="${p.depth}"><path fill="${p.color}" fill-rule="evenodd" d="${p.d}"/></g>`).join('\n');
  const head = forExport
    ? `<?xml version="1.0" encoding="UTF-8"?>\n<!-- FrancyStore3D - disco lampada Ø${FRAME.diameter} mm - unità: mm - ${colors.size} colori.\n     Strati: base bianca piena ${FRAME.baseThickness} mm (gruppo base-bianca) + motivo ${FRAME.artThickness} mm sopra (tutti gli altri gruppi). -->\n`
    : '';
  return { svg: `${head}<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME.diameter}mm" height="${FRAME.diameter}mm" viewBox="${-R} ${-R} ${2 * R} ${2 * R}">\n${body}\n</svg>`, colors, parts: ps };
}

function render() {
  const { svg, colors, parts: ps } = buildSvg(false);
  $('#svgHost').innerHTML = svg;
  const n = colors.size;
  const over = n > MAX_FILAMENTS;
  $('#count').textContent = `Colori totali: ${n} / ${MAX_FILAMENTS}` + (over ? ' – troppi, riduci i colori del disegno' : '');
  $('#count').style.color = over ? '#c0392b' : '';
  $('#dlSvg').disabled = !state.result || over;
  $('#dlPng').disabled = !state.result;
  renderPickers();
  dirty3d = true;
  if (state.view === '3d' && preview3d) update3d(ps);
}

let t3d;
function update3d(ps) {
  clearTimeout(t3d);
  t3d = setTimeout(() => { preview3d.setParts(ps || parts()); dirty3d = false; }, 120);
}

// ---------------- export ----------------
function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$('#dlSvg').addEventListener('click', () => {
  download('disco-lampada-francy.svg', new Blob([buildSvg(true).svg], { type: 'image/svg+xml' }));
});
$('#dlPng').addEventListener('click', async () => {
  if (state.view === '3d' && preview3d) {
    const r = await fetch(preview3d.snapshot());
    return download('anteprima-lampada-3d.png', await r.blob());
  }
  const { svg } = buildSvg(false);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 1200;
    const ctx = c.getContext('2d');
    if (state.lit) ctx.filter = 'brightness(1.12) saturate(1.25)';
    ctx.drawImage(img, 0, 0, 1200, 1200);
    c.toBlob((b) => download('anteprima-lampada.png', b), 'image/png');
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
});

// ---------------- util ----------------
function rgbToHex({ r, g, b }) { return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join(''); }
function hexToRgb(h) { const v = parseInt(h.slice(1), 16); return { r: v >> 16, g: (v >> 8) & 255, b: v & 255 }; }

// ---------------- avvio ----------------
setStatus('Caricamento font…');
loadFont().then((f) => { state.font = f; render(); setStatus("Carica un'immagine per iniziare"); })
  .catch((err) => { console.error(err); render(); setStatus('Font non caricato: scritte disattivate'); });
updateColorLimit();
render();

// Per i test: ?img=percorso carica subito un'immagine
const qp = new URLSearchParams(location.search);
if (qp.get('img')) loadImage(qp.get('img'), +qp.get('zoom') || 1);
if (qp.get('mode') === 'keep') document.querySelector('#mode button[data-mode=keep]').click();
