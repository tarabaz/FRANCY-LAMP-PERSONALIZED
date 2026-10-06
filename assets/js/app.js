import { FRAME, geometry, loadFont, buildFrame } from './frame.js';
import { Preview3D } from './preview3d.js';
import { stlFiles, stlReadme, zipAsync } from './export-stl.js';
import { buildEps } from './export-eps.js';
import { build3mf } from './export-3mf.js';
import { detectFace, faceFeatures } from './face.js';

const $ = (s) => document.querySelector(s);
const root = $('#flc-root');
const qp = new URLSearchParams(location.search);
// Configurazione stampata dallo shortcode del plugin. Senza plugin (pagina di prova) i parametri arrivano dall'URL.
const CFG = window.FRANCY_LAMP || {
  restUrl: qp.get('ai') || '', statusUrl: qp.get('aistato') || '', submitUrl: qp.get('convalida') || '',
  nonce: '', isAdmin: true, filaments: [], templates: [], standalone: true,
};
const MAX_FILAMENTS = 13; // H2C: 1 bobina fissa sull'ugello 1 (bianco) + 3 AMS da 4 sull'ugello 2
// Nero e bianco "di riferimento": con il catalogo diventano le bobine più vicine
let BLACK = '#151515';
let WHITE = '#ffffff';

const state = {
  img: null, zoom: 1, ox: 0, oy: 0,
  mode: 'outline', seed: 1, lit: false, view: '2d',
  result: null, colorOverrides: {}, font: null,
  bandColor: '#5b9bd5', textColor: BLACK,
  filaments: [], originalFile: null, originalSrc: null, aiImageSrc: null, aiProvider: '',
  templates: [], template: null, // disegno pronto scelto: { id, name, url, dataUrl }
};

// stessa versione di app.js (?ver=...) così anche il worker non resta vecchio in cache
const worker = new Worker(new URL('./worker.js' + new URL(import.meta.url).search, import.meta.url));
let jobId = 0;
let preview3d = null;
let dirty3d = true;

// ---------------- catalogo filamenti ----------------
function setFilaments(list) {
  state.filaments = (list || [])
    .filter((f) => f && /^#[0-9a-f]{6}$/i.test(f.hex))
    .map((f) => ({ name: String(f.name || f.hex), hex: f.hex.toLowerCase(), lab: hexToLab(f.hex) }));
  if (state.filaments.length) {
    const oldBlack = BLACK;
    BLACK = nearestFilament('#151515').hex;
    WHITE = nearestFilament('#ffffff').hex;
    if (state.textColor === oldBlack) state.textColor = BLACK;
    state.bandColor = nearestFilament(state.bandColor).hex;
  }
  renderPalette();
  updateColorLimit();
  render();
}
function nearestFilament(hex) {
  const lab = hexToLab(hex);
  let best = null, bd = Infinity;
  for (const f of state.filaments) {
    const d = (f.lab[0] - lab[0]) ** 2 + (f.lab[1] - lab[1]) ** 2 + (f.lab[2] - lab[2]) ** 2;
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}
// Nome della bobina per un colore (esatto se è un colore del catalogo, altrimenti la più vicina)
function filamentName(hex) {
  if (!state.filaments.length) return '';
  const f = nearestFilament(hex);
  return f ? (f.hex === hex.toLowerCase() ? f.name : `${f.name} (≈)`) : '';
}

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
  applyAdjust(ctx, size);
}

// ---------------- luminosità / contrasto / saturazione ----------------
// Si applicano all'immagine PRIMA della riduzione dei colori (anteprima del ritaglio, conversione,
// immagine mandata all'IA e "ritaglio usato" nello zip). Valori da -100 a +100, 0 = immagine originale.
const adjust = { b: 0, c: 0, s: 0 };
function applyAdjust(ctx, size) {
  const { b, c, s } = adjust;
  if (!b && !c && !s) return;
  const lut = new Uint8ClampedArray(256);
  const cc = c * 1.28, f = (259 * (cc + 255)) / (255 * (259 - cc));
  for (let v = 0; v < 256; v++) lut[v] = f * (v + b * 1.28 - 128) + 128;
  const sat = 1 + s / 100;
  const id = ctx.getImageData(0, 0, size, size), d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = lut[d[i]], g = lut[d[i + 1]], bl = lut[d[i + 2]];
    if (s) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * bl;
      r = gray + (r - gray) * sat; g = gray + (g - gray) * sat; bl = gray + (bl - gray) * sat;
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = bl;
  }
  ctx.putImageData(id, 0, 0);
}
function setAdjust(vals) {
  Object.assign(adjust, vals);
  for (const key of ['b', 'c', 's']) {
    const id = 'adj' + key.toUpperCase();
    $('#' + id).value = adjust[key];
    $('#' + id + 'Out').textContent = (adjust[key] > 0 ? '+' : '') + adjust[key];
  }
  $('#adjBadge').hidden = !(adjust.b || adjust.c || adjust.s);
}
for (const key of ['b', 'c', 's']) {
  $('#adj' + key.toUpperCase()).addEventListener('input', (e) => { setAdjust({ [key]: +e.target.value }); drawCrop(); schedule(); });
}
$('#adjReset').addEventListener('click', () => { setAdjust({ b: 0, c: 0, s: 0 }); drawCrop(); schedule(); });

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
  if (!file) return;
  state.originalFile = file;
  loadImage(URL.createObjectURL(file));
});

function loadImage(src, zoom = 1) {
  const img = new Image();
  img.onload = () => {
    originalImg = null; state.aiImageSrc = null; state.originalSrc = src;
    $('#aiUndo').hidden = true;
    setImage(img, zoom, 0, 0);
  };
  img.src = src;
}

function setImage(img, zoom, ox, oy) {
  state.img = img; state.zoom = zoom; state.ox = ox; state.oy = oy;
  setAdjust({ b: 0, c: 0, s: 0 }); // immagine nuova (o risultato IA, che ha già le regolazioni): si riparte da zero
  $('#zoom').value = zoom;
  $('#aiBtn').disabled = !!state.aiExhausted;
  drawCrop(); run();
}

// ---------------- ridisegno con IA (passa dal plugin WordPress) ----------------
let originalImg = null;
if (CFG.restUrl) { $('#aiBox').hidden = false; loadQuota(); }

// Contatori del giorno: quanti ridisegni restano a te e a tutto il sito
function showQuota(q) {
  if (!q || !q.user || !q.global) return;
  const fmt = (x) => (x.remaining === null ? 'illimitati' : String(x.remaining));
  const el = $('#aiQuota');
  el.hidden = false;
  el.textContent = `Ridisegni disponibili oggi: per te ${fmt(q.user)} · sul sito ${fmt(q.global)}`;
  const none = q.user.remaining === 0 || q.global.remaining === 0;
  el.classList.toggle('empty', none);
  state.aiExhausted = none;
  $('#aiBtn').disabled = none || !state.img;
}
async function loadQuota() {
  if (!CFG.statusUrl) return;
  try {
    const r = await fetch(CFG.statusUrl, { credentials: 'same-origin', headers: CFG.nonce ? { 'X-WP-Nonce': CFG.nonce } : {} });
    if (r.ok) showQuota(await r.json());
  } catch (e) { /* il contatore è solo informativo */ }
}

function aiMessage(text, kind) {
  const el = $('#aiMsg');
  el.hidden = !text;
  el.textContent = text || '';
  el.className = 'ai-msg' + (kind ? ' ' + kind : '');
}

let aiStyle = 'fedele';
// esempi dei 3 stili generati dall'admin: il cliente vede la differenza senza spendere ridisegni
function showExample() {
  const ex = state.examples;
  const box = $('#aiExample');
  const pair = ex && ex[aiStyle];
  if (!pair || !pair.orig || !pair.res) { box.hidden = true; return; }
  box.hidden = false;
  $('#exOrig').src = pair.orig;
  $('#exStyle').src = pair.res;
  $('#exLabel').textContent = { fedele: 'Fedele', ritratto: 'Ritratto', anime: 'Anime' }[aiStyle] || aiStyle;
}
// stili disponibili decisi dall'admin (l'anime si può spegnere)
if (Array.isArray(CFG.aiStyles)) document.querySelectorAll('#aiStyle button').forEach((b) => { b.hidden = !CFG.aiStyles.includes(b.dataset.style); });
document.querySelectorAll('#aiStyle button').forEach((b) => b.addEventListener('click', () => {
  aiStyle = b.dataset.style;
  document.querySelectorAll('#aiStyle button').forEach((x) => x.classList.toggle('active', x === b));
  showExample();
}));

// Rimuovi lo sfondo: l'IA toglie lo sfondo della foto e lo sostituisce con quello scelto nel menu
const aiBackgrounds = Array.isArray(CFG.aiBackgrounds) ? CFG.aiBackgrounds : [];
if (aiBackgrounds.length) {
  $('#aiBgRow').hidden = false;
  aiBackgrounds.forEach((label, i) => $('#aiBg').append(new Option(label, String(i))));
  $('#aiBgRemove').addEventListener('change', () => { $('#aiBgPick').hidden = !$('#aiBgRemove').checked; });
}
function aiBackground() {
  return aiBackgrounds.length && $('#aiBgRemove').checked ? +$('#aiBg').value : -1;
}

// Modalità ritratto (convertitore): pelle a parte, niente linee dentro il viso
function setPortrait(on) {
  $('#portrait').checked = on;
  $('#portraitHint').hidden = !on;
}
$('#portrait').addEventListener('change', () => { setPortrait($('#portrait').checked); schedule(); });

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
  const btnLabel = $('#aiBtn').textContent;
  $('#aiBtn').textContent = '⏳ Ridisegno in corso… (10–30 s)';
  aiMessage('');
  setStatus("L'IA sta ridisegnando la tua immagine (di solito 10–30 secondi)…");
  try {
    const r = await fetch(CFG.restUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(CFG.nonce ? { 'X-WP-Nonce': CFG.nonce } : {}) },
      body: JSON.stringify({ image, style: aiStyle, bg: aiBackground() }),
    });
    const raw = await r.text();
    let j = {};
    try { j = JSON.parse(raw); } catch (e) { /* risposta non JSON: errore del server o timeout dell'hosting */ }
    showQuota(j.quota || (j.data && j.data.quota));
    if (!r.ok || !j.image) {
      throw new Error(j.message || `Il ridisegno non è riuscito (risposta del server: HTTP ${r.status}${raw && !j.message ? ' – ' + raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) : ''}).`);
    }
    const img = new Image();
    await new Promise((ok, ko) => { img.onload = ok; img.onerror = ko; img.src = j.image; });
    if (!originalImg) originalImg = { img: state.img, zoom: state.zoom, ox: state.ox, oy: state.oy, mode: state.mode };
    state.aiImageSrc = j.image;
    state.aiProvider = j.provider || '';
    state.aiBackground = aiBackground() >= 0 ? aiBackgrounds[aiBackground()] : null;
    $('#aiUndo').hidden = false;
    selectMode('keep');
    if (aiStyle === 'ritratto') setPortrait(true); // il ritratto IA ha già la pelle in 3 toni
    setImage(img, 1, 0, 0);
    aiMessage(`Ridisegno fatto${j.provider ? ' con ' + j.provider : ''}: ora il disco parte dall'immagine dell'IA.`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus(err.message);
    aiMessage(err.message, 'error');
  } finally {
    $('#aiBox').classList.remove('busy');
    $('#aiBtn').textContent = btnLabel;
  }
});

$('#aiUndo').addEventListener('click', () => {
  if (!originalImg) return;
  const o = originalImg;
  originalImg = null;
  state.aiImageSrc = null;
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
  $('#addRow').hidden = state.mode !== 'keep';
  $('#lineRow').hidden = state.mode === 'keep' && !$('#addOutlines').checked;
  $('#thickRow').hidden = state.mode === 'outline';
  updateColorLimit();
  schedule();
}));
$('#addOutlines').addEventListener('change', () => { $('#lineRow').hidden = !$('#addOutlines').checked; schedule(); });
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

// ---------------- disegni pronti ----------------
// PNG del disco completo caricati dall'admin: si applicano al modello solo per l'anteprima, niente modifiche.
function setTemplates(list) {
  state.templates = (list || []).filter((t) => t && t.url);
  $('#tplBox').hidden = !state.templates.length;
  const grid = $('#tplGrid');
  grid.innerHTML = '';
  for (const t of state.templates) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tpl-card';
    const img = document.createElement('img');
    img.src = t.thumb || t.url; img.alt = ''; img.loading = 'lazy';
    b.append(img, document.createTextNode(t.name));
    b.addEventListener('click', () => selectTemplate(t));
    grid.append(b);
  }
}
$('#tplOpen').addEventListener('click', () => { $('#tplModal').hidden = false; });
$('#tplClose').addEventListener('click', () => { $('#tplModal').hidden = true; });
$('#tplModal').addEventListener('click', (e) => { if (e.target.id === 'tplModal') $('#tplModal').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#tplModal').hidden = true; });

async function selectTemplate(t) {
  $('#tplModal').hidden = true;
  setStatus('Carico il disegno…');
  try {
    // data URL: serve per l'anteprima PNG e per lo zip (un SVG-immagine non carica file esterni)
    const blob = await (await fetch(t.url, { credentials: 'same-origin' })).blob();
    const dataUrl = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });
    state.template = { ...t, dataUrl, blob };
  } catch (err) {
    console.error(err);
    return setStatus('Disegno non disponibile');
  }
  root.classList.add('template-mode');
  document.querySelectorAll('.lockable').forEach((el) => { el.inert = true; });
  $('#tplActive').hidden = false; $('#tplExit').hidden = false;
  $('#tplActiveImg').src = t.thumb || t.url;
  $('#tplActiveName').textContent = t.name;
  setStatus('');
  render();
}
$('#tplExit').addEventListener('click', () => {
  state.template = null;
  root.classList.remove('template-mode');
  document.querySelectorAll('.lockable').forEach((el) => { el.inert = false; });
  $('#tplActive').hidden = true; $('#tplExit').hidden = true;
  render();
  setStatus('');
});

function templateSvg() {
  const R = FRAME.diameter / 2;
  const outline = buildFrame(null, {}).outline;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${FRAME.diameter}mm" height="${FRAME.diameter}mm" viewBox="${-R} ${-R} ${2 * R} ${2 * R}">` +
    `<defs><clipPath id="flcTplClip"><path d="${outline}" clip-rule="evenodd"/></clipPath></defs>` +
    `<path d="${outline}" fill="#ffffff" fill-rule="evenodd"/>` +
    `<image href="${state.template.dataUrl}" xlink:href="${state.template.dataUrl}" x="${-R}" y="${-R}" width="${2 * R}" height="${2 * R}" preserveAspectRatio="xMidYMid slice" clip-path="url(#flcTplClip)"/></svg>`;
}

// ---------------- regola dei 13 colori ----------------
// Il limite è "al massimo 13" (H2C: bianco fisso su ugello 1 + 12 AMS): bianco della base e nero dei contorni contano sempre.
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

// Riquadro con i colori del catalogo filamenti (per scegliere una bobina)
let popover = null;
function closePopover() { if (popover) { popover.remove(); popover = null; } }
document.addEventListener('pointerdown', (e) => { if (popover && !popover.contains(e.target) && !e.target.closest('[data-popover]')) closePopover(); });
function openFilamentPopover(anchor, onPick, allowed) {
  closePopover();
  popover = document.createElement('div');
  popover.className = 'fil-popover';
  for (const f of state.filaments) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.background = f.hex;
    b.title = CFG.isAdmin ? f.name : '';
    b.disabled = !allowed(f.hex);
    b.addEventListener('click', () => { onPick(f.hex); closePopover(); });
    popover.append(b);
  }
  const r = anchor.getBoundingClientRect(), rr = root.getBoundingClientRect();
  popover.style.left = Math.max(8, Math.min(r.left - rr.left, rr.width - 268)) + 'px';
  popover.style.top = (r.bottom - rr.top + root.scrollTop + 6) + 'px';
  root.append(popover);
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
      b.title = (CFG.isAdmin && filamentName(c)) || c;
      // scritte e fascia mai dello stesso colore: le scritte sparirebbero
      const other = (key === 'band' ? state.textColor : state.bandColor).toLowerCase();
      if (c === other && c !== current) { b.disabled = true; b.title = key === 'band' ? 'È il colore delle scritte' : 'È il colore della fascia'; }
      b.addEventListener('click', () => setFrameColor(key, c));
      host.append(b);
    }
    // colore nuovo: solo se aggiungerlo non supera il limite
    const free = colorSet(key).size < MAX_FILAMENTS;
    const add = document.createElement('label');
    add.className = 'swatch-add' + (free ? '' : ' disabled');
    add.title = free ? 'Scegli un colore nuovo' : `Hai già ${MAX_FILAMENTS} colori: scegli tra quelli del disegno`;
    if (state.filaments.length) {
      add.textContent = '+';
      add.dataset.popover = '1';
      if (free) add.addEventListener('click', () => openFilamentPopover(add, (hex) => setFrameColor(key, hex), (hex) => hex !== (key === 'band' ? state.textColor : state.bandColor).toLowerCase()));
    } else {
      add.innerHTML = '+<input type="color">';
      const inp = add.querySelector('input');
      inp.value = current;
      inp.disabled = !free;
      inp.addEventListener('change', () => setFrameColor(key, inp.value));
    }
    host.append(add);
  }
}

function setFrameColor(key, c) {
  c = c.toLowerCase();
  if (!colorSet(key).has(c) && colorSet(key).size >= MAX_FILAMENTS) return;
  if (c === (key === 'band' ? state.textColor : state.bandColor).toLowerCase()) return;
  if (key === 'band') state.bandColor = c; else state.textColor = c;
  updateColorLimit();
  render();
}

function isNearBlack(hex) { const { r, g, b } = hexToRgb(hex); return r + g + b < 90; }
function isNearWhite(hex) { const { r, g, b } = hexToRgb(hex); return Math.min(r, g, b) > 232; }

// ---------------- conversione ----------------
let timer;
function schedule() { clearTimeout(timer); timer = setTimeout(run, 350); }

// ---------------- riconoscimento del volto (modalità ritratto) ----------------
// Punti del volto per ogni immagine (in coordinate 0..1 dell'immagine), calcolati una volta sola
const faceCache = new WeakMap();
let faceJob = null;
function coverFor(img) { return Math.max(crop.width / img.width, crop.height / img.height); }
// punto 0..1 dell'immagine -> pixel del quadrato di lavoro (stesso calcolo di drawImageTo)
function toCanvas(p, img, zoom, ox, oy, size) {
  const k = size / crop.width, s = coverFor(img) * zoom * k;
  const w = img.width * s, h = img.height * s;
  return [size / 2 - w / 2 + ox * k + p[0] * w, size / 2 - h / 2 + oy * k + p[1] * h];
}
async function findFace(img) {
  let pts = await detectFace(img);
  // sul ridisegno IA a volte non trova il volto: lo cerco sulla foto originale e riporto i punti
  // (l'IA ha ricevuto proprio quel ritaglio a 1024 px, e Fedele/Ritratto mantengono la composizione)
  if (!pts && originalImg && img === state.img && state.aiImageSrc) {
    const o = originalImg;
    const op = await detectFace(o.img);
    if (op) pts = op.map((p) => toCanvas(p, o.img, o.zoom, o.ox, o.oy, 1024).map((v) => v / 1024));
  }
  return pts;
}
function faceStatus(text) { const el = $('#portraitHint'); el.hidden = false; el.textContent = text; }

function run() {
  if (!state.img) return;
  const g = geometry();
  const ppmm = +$('#ppmm').value;
  const size = Math.round(2 * g.rImgArt * ppmm);
  // ritratto: prima cerco il volto (la prima volta scarica il riconoscimento, ~17 MB), poi converto
  let face = null;
  if ($('#portrait').checked) {
    const img = state.img;
    if (!faceCache.has(img)) {
      if (faceJob !== img) {
        faceJob = img;
        setStatus('Cerco il volto…');
        faceStatus('Cerco il volto (la prima volta può volerci qualche secondo)…');
        findFace(img).then((pts) => faceCache.set(img, pts)).catch((e) => { console.error(e); faceCache.set(img, null); })
          .finally(() => { if (faceJob === img) faceJob = null; if (state.img === img) run(); });
      }
      return;
    }
    const pts = faceCache.get(img);
    if (pts) {
      face = faceFeatures(pts.map((p) => toCanvas(p, img, state.zoom, state.ox, state.oy, size)));
      faceStatus('Volto trovato: pelle con 3 toni dedicati, niente linee dentro il viso, occhi (bianco + iride) e denti disegnati in automatico.');
    } else {
      faceStatus('Volto non trovato: pelle con 3 toni dedicati e niente linee dentro il viso, ma occhi e denti non vengono ridisegnati.');
    }
  }
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
    addOutlines: state.mode === 'keep' && $('#addOutlines').checked,
    portrait: $('#portrait').checked,
    face,
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
  // zone finite sulla stessa bobina: le faccio unire dal worker (niente bordi interni nel disegno)
  if (!result.merged) {
    const first = new Map(), merge = result.palette.map((_, i) => i);
    let any = false;
    result.palette.forEach((p, i) => {
      const c = artColor(i);
      if (!first.has(c)) { first.set(c, i); return; }
      const j = first.get(c);
      // confluisce nella zona più grande
      if (p.area > result.palette[j].area) { merge[j] = i; first.set(c, i); for (let q = 0; q < merge.length; q++) if (merge[q] === j) merge[q] = i; }
      else merge[i] = j;
      any = true;
    });
    if (any) worker.postMessage({ id, merge });
  }
  renderPalette();
  updateColorLimit();
  render();
  setStatus('');
};

function setStatus(t) { $('#status').textContent = t || (state.result ? 'Pronto' : ''); }

// ---------------- palette ----------------
function artColor(i) {
  if (state.result.palette[i].black) return BLACK; // il nero delle linee non si cambia
  if (state.colorOverrides[i]) return state.colorOverrides[i].toLowerCase();
  return autoColors()[i];
}

// Colori automatici del disegno. Due colori diversi trovati nell'immagine non diventano mai la stessa
// bobina (altrimenti le zone attaccate si fondono e lo stacco sparisce): ogni colore prende la bobina
// più vicina ancora libera. Il nero resta dei contorni, il bianco al solo colore più chiaro del disegno.
let autoCache = null;
function autoColors() {
  const r = state.result, ov = JSON.stringify(state.colorOverrides);
  if (autoCache && autoCache.r === r && autoCache.f === state.filaments && autoCache.ov === ov && autoCache.k === BLACK + WHITE) return autoCache.list;
  const pal = r.palette, out = new Array(pal.length).fill(null);
  const used = new Set([BLACK, WHITE]);
  for (const k in state.colorOverrides) used.add(state.colorOverrides[k].toLowerCase());
  pal.forEach((p, i) => { if (p.black) out[i] = BLACK; }); // linee sempre nere, nessun adattamento
  // il bianco protetto (denti, occhi) usa sempre la bobina della base
  let wi = pal.findIndex((p, i) => p.white && !state.colorOverrides[i]), wl = wi >= 0 ? Infinity : -1;
  pal.forEach((p, i) => {
    if (out[i] || state.colorOverrides[i]) return;
    const hex = rgbToHex(p), L = hexToLab(hex)[0];
    if (isNearWhite(hex) && L > wl) { wl = L; wi = i; }
  });
  if (wi >= 0) out[wi] = WHITE;
  const todo = pal.map((p, i) => i).filter((i) => !out[i] && !state.colorOverrides[i]);
  if (!state.filaments.length) {
    for (const i of todo) out[i] = rgbToHex(pal[i]);
  } else {
    // pelle: ogni tono prende la bobina color pelle più vicina (anche la stessa di un altro tono della pelle:
    // tra i toni della pelle non ci sono linee, al massimo due toni si uniscono). Le altre zone non la usano.
    const skinFils = state.filaments.filter(isSkinFilament);
    if (skinFils.length) {
      for (const i of todo) {
        if (!pal[i].skin) continue;
        out[i] = nearestIn(skinFils, rgbToHex(pal[i])).hex;
        used.add(out[i]);
      }
    }
    // abbinamento colore → bobina: prima le coppie più vicine, ogni bobina una sola volta
    const pairs = [];
    for (const i of todo) {
      if (out[i]) continue;
      const lab = hexToLab(rgbToHex(pal[i]));
      for (const f of state.filaments) {
        pairs.push([(f.lab[0] - lab[0]) ** 2 + (f.lab[1] - lab[1]) ** 2 + (f.lab[2] - lab[2]) ** 2, i, f.hex]);
      }
    }
    pairs.sort((a, b) => a[0] - b[0]);
    for (const [, i, hex] of pairs) {
      if (out[i] || used.has(hex)) continue;
      out[i] = hex; used.add(hex);
    }
    // catalogo troppo piccolo: per i colori rimasti si torna alla bobina più vicina
    for (const i of todo) if (!out[i]) out[i] = nearestFilament(rgbToHex(pal[i])).hex;
  }
  autoCache = { r, f: state.filaments, ov, k: BLACK + WHITE, list: out };
  return out;
}
// Bobine "da pelle": tinte calde tra il pesca e il marrone (niente grigi, rosa, gialli o colori freddi)
function isSkinFilament(f) {
  const [L, A, B] = f.lab, h = (Math.atan2(B, A) * 180) / Math.PI;
  return L > 25 && L < 92 && Math.hypot(A, B) > 8 && Math.hypot(A, B) < 55 && h > 28 && h < 86;
}
function nearestIn(list, hex) {
  const lab = hexToLab(hex);
  let best = list[0], bd = Infinity;
  for (const f of list) {
    const d = (f.lab[0] - lab[0]) ** 2 + 1.5 * ((f.lab[1] - lab[1]) ** 2 + (f.lab[2] - lab[2]) ** 2);
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}
// colori già usati dalle altre zone del disegno (per non sceglierne uno uguale)
function otherDrawingColors(i) {
  return new Set(state.result.palette.map((_, j) => (j === i ? null : artColor(j))).filter(Boolean));
}

function renderPalette() {
  const ul = $('#palette');
  ul.innerHTML = '';
  if (!state.result) return;
  state.result.palette.forEach((p, i) => {
    const li = document.createElement('li');
    let ctrl;
    if (state.filaments.length) {
      ctrl = document.createElement('button');
      ctrl.type = 'button';
      ctrl.className = 'swatch-btn';
      ctrl.dataset.popover = '1';
      ctrl.style.background = artColor(i);
      ctrl.addEventListener('click', () => openFilamentPopover(ctrl, (hex) => { state.colorOverrides[i] = hex; renderPalette(); render(); },
        (hex) => !otherDrawingColors(i).has(hex) && (colorSet().has(hex) || colorSet().size < MAX_FILAMENTS)));
    } else {
      ctrl = document.createElement('input');
      ctrl.type = 'color'; ctrl.value = artColor(i);
      ctrl.addEventListener('input', () => { state.colorOverrides[i] = ctrl.value; render(); });
    }
    if (p.black) { ctrl.disabled = true; ctrl.title = 'Le linee sono sempre nere'; }
    const name = document.createElement('span');
    const fil = CFG.isAdmin ? filamentName(artColor(i)) : ''; // il nome delle bobine lo vede solo l'admin
    name.textContent = (p.black ? 'Nero contorni' : p.white && artColor(i) === WHITE ? 'Bianco' : `Colore ${i + 1}`) + (fil ? ` · ${fil}` : '');
    const area = document.createElement('span');
    area.className = 'area';
    area.textContent = `${Math.round(p.area)} mm²`;
    li.append(ctrl, name, area);
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
    pal.forEach((p, i) => { if (!p.black) art({ id: `disegno-colore-${i + 1}`, d: state.result.layers[i], color: artColor(i), area: p.area }); });
    pal.forEach((p, i) => { if (p.black) art({ id: 'disegno-nero', d: state.result.layers[i], color: artColor(i), black: true, area: p.area }); });
  }
  art({ id: 'cornice-linea-interna', d: frame.innerLine, color: BLACK, black: true });
  art({ id: 'cornice-fascia', d: frame.band, color: band });
  if (frame.slotBorder) art({ id: 'cornice-contorno-asola', d: frame.slotBorder, color: BLACK, black: true });
  if (frame.text) art({ id: 'cornice-scritte', d: frame.text, color: txt, black: isNearBlack(txt) });
  art({ id: 'cornice-anello-nero', d: frame.blackRing, color: BLACK, black: true });
  return list;
}

function buildSvg(forExport) {
  const R = FRAME.diameter / 2;
  const ps = parts();
  const colors = new Set(ps.map((p) => p.color.toLowerCase()));
  const body = ps.map((p) =>
    `<g id="${p.id}" data-colore="${p.color}" data-strato="${p.layer}" data-z="${p.z}" data-spessore="${p.depth}"${filamentName(p.color) ? ` data-filamento="${escapeAttr(filamentName(p.color))}"` : ''}><path fill="${p.color}" fill-rule="evenodd" d="${p.d}"/></g>`).join('\n');
  const head = forExport
    ? `<?xml version="1.0" encoding="UTF-8"?>\n<!-- FrancyStore3D - disco lampada Ø${FRAME.diameter} mm - unità: mm - ${colors.size} colori.\n     Strati: base bianca piena ${FRAME.baseThickness} mm (gruppo base-bianca) + motivo ${FRAME.artThickness} mm sopra (tutti gli altri gruppi). -->\n`
    : '';
  return { svg: `${head}<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME.diameter}mm" height="${FRAME.diameter}mm" viewBox="${-R} ${-R} ${2 * R} ${2 * R}">\n${body}\n</svg>`, colors, parts: ps };
}

function render() {
  if (state.template) {
    $('#svgHost').innerHTML = templateSvg();
    $('#count').textContent = `Disegno pronto: ${state.template.name}`;
    $('#count').style.color = '';
    $('#dlSvg').disabled = $('#dlStl').disabled = true;
    $('#dlPng').disabled = false;
    $('#submitBtn').disabled = !CFG.submitUrl;
    dirty3d = true;
    if (state.view === '3d' && preview3d) update3d();
    return;
  }
  const { svg, colors, parts: ps } = buildSvg(false);
  $('#svgHost').innerHTML = svg;
  const n = colors.size;
  const over = n > MAX_FILAMENTS;
  $('#count').textContent = `Colori totali: ${n} / ${MAX_FILAMENTS}` + (over ? ' – troppi, riduci i colori del disegno' : '');
  $('#count').style.color = over ? '#c0392b' : '';
  $('#dlSvg').disabled = $('#dlStl').disabled = !state.result || over;
  $('#dlPng').disabled = !state.result;
  $('#submitBtn').disabled = !state.result || over || !CFG.submitUrl;
  renderPickers();
  dirty3d = true;
  if (state.view === '3d' && preview3d) update3d(ps);
}

let t3d;
function update3d(ps) {
  clearTimeout(t3d);
  t3d = setTimeout(() => {
    try {
      if (state.template) preview3d.setTemplate(state.template.dataUrl, buildFrame(null, {}).outline);
      else preview3d.setParts(ps || parts());
      dirty3d = false;
    } catch (err) {
      console.error(err);
      setStatus('Anteprima 3D non aggiornata: ricarica la pagina (Ctrl+F5)');
    }
  }, 120);
}

// ---------------- file (anteprime, pacchetto completo) ----------------
function svgToPng(lit, size = 1200) {
  const svg = state.template ? templateSvg() : buildSvg(false).svg;
  return new Promise((ok, ko) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      if (lit) { ctx.fillStyle = '#15171c'; ctx.fillRect(0, 0, size, size); ctx.filter = 'brightness(1.12) saturate(1.25)'; }
      ctx.drawImage(img, 0, 0, size, size);
      c.toBlob((b) => (b ? ok(b) : ko(new Error('PNG non creato'))), 'image/png');
    };
    img.onerror = () => ko(new Error('Anteprima non creata'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}
const bytes = async (blob) => new Uint8Array(await blob.arrayBuffer());
async function resizePng(blob, size) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d').drawImage(bmp, 0, 0, size, size);
  return bytes(await new Promise((ok) => c.toBlob(ok, 'image/png')));
}
const enc = (s) => new TextEncoder().encode(s);

// Elenco colori usati con ruolo, bobina e area: va nel riepilogo per l'admin
function colorSummary(ps) {
  const roleOf = (p) => (p.layer === 'base' ? 'Base' : p.id.startsWith('disegno') ? 'Disegno' : p.id === 'cornice-fascia' ? 'Banda' : p.id === 'cornice-scritte' ? 'Scritte' : 'Cornice');
  const byHex = new Map();
  for (const p of ps) {
    const hex = p.color.toLowerCase();
    if (!byHex.has(hex)) byHex.set(hex, { hex, filament: filamentName(hex), roles: new Set(), area: 0 });
    const e = byHex.get(hex);
    e.roles.add(roleOf(p));
    if (p.area) e.area += p.area;
  }
  return [...byHex.values()].map((e) => ({ ...e, roles: [...e.roles], area: Math.round(e.area) }));
}

// Disegno pronto: anteprime, PNG del disegno e riepilogo (gli STL di quel disegno li ha già l'admin)
async function buildTemplatePackage(customer) {
  const t = state.template;
  const previewOff = await svgToPng(false), previewLit = await svgToPng(true);
  const slugName = t.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'disegno';
  const summary = { creato: new Date().toISOString(), cliente: customer, template: { id: t.id, name: t.name }, colori: [] };
  const lines = [
    'FrancyStore3D - disco lampada (disegno pronto dalla galleria)', '',
    `Cliente: ${customer.name} <${customer.email}>${customer.phone ? ' tel. ' + customer.phone : ''}`,
    customer.note ? `Note: ${customer.note}` : '',
    `Disegno pronto: ${t.name} (ID ${t.id})`, '',
    'Il cliente non ha modificato il disegno: usa i tuoi file di stampa di questo disegno.',
  ];
  const files = [
    { name: '01_anteprime/anteprima-spenta.png', data: await bytes(previewOff) },
    { name: '01_anteprime/anteprima-accesa.png', data: await bytes(previewLit) },
    { name: `02_disegno/${slugName}.png`, data: await bytes(t.blob) },
    { name: 'LEGGIMI.txt', data: enc(lines.join('\r\n') + '\r\n') },
    { name: 'riepilogo.json', data: enc(JSON.stringify(summary, null, 2)) },
  ];
  return { zip: await zipAsync(files), previewOff, previewLit, summary };
}

async function buildPackage(customer) {
  if (state.template) return buildTemplatePackage(customer);
  const ps = parts();
  const svgText = buildSvg(true).svg;
  const files = [];
  const previewOff = await svgToPng(false), previewLit = await svgToPng(true);
  files.push({ name: '01_anteprime/anteprima-spenta.png', data: await bytes(previewOff) });
  files.push({ name: '01_anteprime/anteprima-accesa.png', data: await bytes(previewLit) });
  // immagine originale così com'è stata caricata
  if (state.originalFile) {
    const ext = (state.originalFile.name.match(/\.[a-z0-9]+$/i) || ['.jpg'])[0].toLowerCase();
    files.push({ name: `02_immagini/originale${ext}`, data: await bytes(state.originalFile) });
  } else if (state.originalSrc) {
    try { files.push({ name: '02_immagini/originale' + (state.originalSrc.match(/\.(png|jpe?g|webp)(\?|$)/i)?.[0].replace('?', '') || '.jpg'), data: await bytes(await (await fetch(state.originalSrc)).blob()) }); } catch (e) { /* facoltativo */ }
  }
  if (state.aiImageSrc) files.push({ name: '02_immagini/ridisegno-ia.png', data: await bytes(await (await fetch(state.aiImageSrc)).blob()) });
  // il ritaglio esatto usato per la conversione
  const c = document.createElement('canvas');
  c.width = c.height = 1500;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1500, 1500);
  drawImageTo(ctx, 1500);
  files.push({ name: '02_immagini/ritaglio-usato.jpg', data: await bytes(await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.92))) });
  files.push({ name: '03_vettoriale/disco.svg', data: enc(svgText) });
  files.push({ name: '03_vettoriale/disco.eps', data: enc(buildEps(ps, FRAME.diameter)) });
  const stl = stlFiles(ps, { black: BLACK, white: WHITE, filamentName: (h) => (state.filaments.length ? nearestFilament(h).name : '') }, '04_stl/');
  files.push(...stl.files);

  // progetto Bambu Studio con parti e filamenti già assegnati (profili dal progetto modello H2C)
  let bambu = null;
  try {
    const tplUrl = CFG.bambuTemplateUrl || new URL('../bambu/h2c-template.json', import.meta.url).href;
    const template = await (await fetch(tplUrl, { credentials: 'same-origin' })).json();
    const thumb = await resizePng(previewOff, 512), thumbSmall = await resizePng(previewOff, 128);
    bambu = await build3mf(ps, {
      template, white: WHITE, black: BLACK, title: 'Disco lampada FrancyStore3D',
      filamentName: (h) => (state.filaments.length ? nearestFilament(h).name : ''),
      baseThickness: FRAME.baseThickness, artThickness: FRAME.artThickness, thumb, thumbSmall,
    });
    files.push({ name: '05_bambu/disco-lampada.3mf', data: await bytes(bambu.blob) });
  } catch (err) {
    console.error('3MF non creato', err); // lo zip resta valido anche senza
  }

  const colors = colorSummary(ps);
  const summary = {
    creato: new Date().toISOString(),
    cliente: customer,
    disco: { diametro: FRAME.diameter, base: FRAME.baseThickness, motivo: FRAME.artThickness },
    colori: colors,
    stl: stl.list.map((l) => ({ file: l.file, colore: l.color, filamento: l.filament })),
    scritte: texts(),
    fascia: state.bandColor, colore_scritte: state.textColor,
    impostazioni: { modalita: state.mode, ritratto: $('#portrait').checked, colori: +$('#colors').value, luminosita: adjust.b, contrasto: adjust.c, saturazione: adjust.s, ia: !!state.aiImageSrc, stile_ia: state.aiImageSrc ? aiStyle : null, sfondo_ia: state.aiImageSrc ? (state.aiBackground || 'originale') : null, fornitore_ia: state.aiProvider || null },
  };
  const lines = [
    'FrancyStore3D - disco lampada personalizzato', '',
    `Cliente: ${customer.name} <${customer.email}>${customer.phone ? ' tel. ' + customer.phone : ''}`,
    customer.note ? `Note: ${customer.note}` : '', '',
    'FILAMENTI DA USARE', ...colors.map((e) => `- ${e.hex}  ${e.filament || '(nessun catalogo)'}  →  ${e.roles.join(', ')}${e.area ? `  (${e.area} mm² nel disegno)` : ''}`), '',
    ...stlReadme({ baseThickness: FRAME.baseThickness, artThickness: FRAME.artThickness }),
    ...stl.list.map((l) => `  ${l.file}  ${l.color}${l.filament ? '  ' + l.filament : ''}`), '',
    ...(bambu ? ['PROGETTO BAMBU STUDIO (05_bambu/disco-lampada.3mf)', 'Apri il file con Bambu Studio: parti, colori degli slot e ugelli sono già assegnati.', ...bambu.list.map((l) => `  filamento ${l.filament}${l.filament === 1 ? ' (ugello 1, bobina fissa)' : ' (ugello 2, AMS)'}: ${l.part}`), ''] : []),
    'Cartelle: 01_anteprime, 02_immagini (originale, eventuale ridisegno IA, ritaglio usato), 03_vettoriale (SVG, EPS), 04_stl, 05_bambu (progetto .3mf).',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '');
  files.push({ name: 'LEGGIMI-filamenti.txt', data: enc(lines.join('\r\n') + '\r\n') });
  files.push({ name: 'riepilogo.json', data: enc(JSON.stringify(summary, null, 2)) });
  return { zip: await zipAsync(files), previewOff, previewLit, summary };
}

// ---------------- convalida (il cliente approva, i file vanno all'admin) ----------------
if (!CFG.isAdmin) $('#adminFiles').hidden = true;
$('#submitBox').hidden = !CFG.submitUrl;

function submitMessage(text, kind) {
  const el = $('#submitMsg');
  el.hidden = !text;
  el.textContent = text || '';
  el.className = 'ai-msg' + (kind ? ' ' + kind : '');
}

$('#submitForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if ((!state.result && !state.template) || !CFG.submitUrl) return;
  const f = e.target;
  const customer = { name: f.name.value.trim(), email: f.email.value.trim(), phone: f.phone.value.trim(), note: f.note.value.trim() };
  if (!customer.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customer.email)) return submitMessage('Inserisci nome ed email validi.', 'error');
  if (!f.privacy.checked) return submitMessage('Per inviare il disco serve il consenso al trattamento della foto.', 'error');
  const btn = $('#submitBtn'), label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Preparo i file…';
  submitMessage('');
  try {
    const pkg = await buildPackage(customer);
    btn.textContent = 'Invio in corso…';
    const fd = new FormData();
    fd.append('package', pkg.zip, 'progetto.zip');
    fd.append('preview', pkg.previewOff, 'anteprima.png');
    fd.append('preview_lit', pkg.previewLit, 'anteprima-accesa.png');
    fd.append('meta', JSON.stringify(pkg.summary));
    fd.append('website', f.website.value); // campo esca anti-spam: deve restare vuoto
    const r = await fetch(CFG.submitUrl, { method: 'POST', credentials: 'same-origin', headers: CFG.nonce ? { 'X-WP-Nonce': CFG.nonce } : {}, body: fd });
    const raw = await r.text();
    let j = {};
    try { j = JSON.parse(raw); } catch (err) { /* non JSON */ }
    if (!r.ok || !j.ok) {
      if (r.status === 413) throw new Error('I file sono troppo pesanti per il server (limite di upload). Avvisa il negozio.');
      throw new Error(j.message || `Invio non riuscito (HTTP ${r.status}).`);
    }
    submitMessage(`Grazie! Il tuo disco è stato inviato con il codice ${j.code}. Ti contatteremo a ${customer.email}.`, 'ok');
    f.reset();
  } catch (err) {
    console.error(err);
    submitMessage(err.message, 'error');
  } finally {
    btn.textContent = label; btn.disabled = false;
  }
});

// ---------------- download diretti (solo admin / pagina di prova) ----------------
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
$('#dlStl').addEventListener('click', async () => {
  const btn = $('#dlStl'), label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Preparo i file…';
  try {
    const pkg = await buildPackage({ name: 'prova admin', email: '-', phone: '', note: '' });
    download('disco-lampada-francy.zip', pkg.zip);
  } catch (err) {
    console.error(err);
    setStatus('Errore nella creazione dei file');
  } finally {
    btn.textContent = label; btn.disabled = false;
  }
});
$('#dlPng').addEventListener('click', async () => {
  if (state.view === '3d' && preview3d) {
    const r = await fetch(preview3d.snapshot());
    return download('anteprima-lampada-3d.png', await r.blob());
  }
  download('anteprima-lampada.png', await svgToPng(state.lit));
});

// ---------------- util ----------------
function rgbToHex({ r, g, b }) { return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join(''); }
function hexToRgb(h) { const v = parseInt(h.slice(1), 16); return { r: v >> 16, g: (v >> 8) & 255, b: v & 255 }; }
function escapeAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function hexToLab(hex) {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047), y = f(R * 0.2126 + G * 0.7152 + B * 0.0722), z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

// ---------------- avvio ----------------
setStatus('Caricamento font…');
loadFont().then((f) => { state.font = f; render(); setStatus("Carica un'immagine per iniziare"); })
  .catch((err) => { console.error(err); render(); setStatus('Font non caricato: scritte disattivate'); });
// intestazione: logo del sito (se c'è) e "Torna al sito"
if (CFG.homeUrl) {
  const back = $('#backSite');
  back.href = CFG.homeUrl; back.hidden = false;
  const brand = $('.brand');
  const a = document.createElement('a');
  a.href = CFG.homeUrl; a.className = 'brand'; a.title = 'Torna al sito';
  a.append(...brand.childNodes);
  brand.replaceWith(a);
}
// disco predefinito scelto nelle impostazioni (colori e testi con cui si apre la pagina)
if (CFG.defaults) {
  const d = CFG.defaults;
  if (/^#[0-9a-f]{6}$/i.test(d.band || '')) state.bandColor = d.band.toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(d.textColor || '')) state.textColor = d.textColor.toLowerCase();
  const sl = d.sliders || {};
  for (const k of ['colors', 'line', 'thick', 'smooth', 'feat', 'area', 'ppmm']) {
    if (sl[k] === undefined || sl[k] === null) continue;
    $('#' + k).value = sl[k];
    $('#' + sliders[k]).textContent = $('#' + k).value;
  }
  if (typeof sl.addOutlines === 'boolean') $('#addOutlines').checked = sl.addOutlines;
  if (sl.mode === 'keep') selectMode('keep');
  const t = d.texts || {};
  for (const [id, k] of [['tTL', 'tl'], ['tTR', 'tr'], ['tBL', 'bl'], ['tBR', 'br']]) if (typeof t[k] === 'string') $('#' + id).value = t[k];
}

// footer: anno sempre aggiornato e link alle policy dalle impostazioni
$('#footYear').textContent = new Date().getFullYear();
if (CFG.copyrightName) $('#footName').textContent = CFG.copyrightName;
if (CFG.privacyUrl) { $('#footPrivacy').href = CFG.privacyUrl; $('#consentPrivacy').href = CFG.privacyUrl; }
if (CFG.cookieUrl) $('#footCookie').href = CFG.cookieUrl;
if (CFG.logoUrl) {
  const logo = $('#brandLogo');
  logo.src = CFG.logoUrl; logo.alt = CFG.siteName || 'FrancyStore3D'; logo.hidden = false;
  document.querySelector('.brand-name').hidden = true; // il logo sostituisce la scritta
}
setFilaments(CFG.filaments);
setTemplates(CFG.templates);
state.examples = CFG.examples || null;
showExample();
if (qp.get('esempi')) fetch(qp.get('esempi')).then((r) => r.json()).then((ex) => { state.examples = ex; showExample(); }).catch(console.error); // solo per le prove
if (qp.get('tpl')) fetch(qp.get('tpl')).then((r) => r.json()).then(setTemplates).catch(console.error); // solo per le prove
if (qp.get('cat')) fetch(qp.get('cat')).then((r) => r.json()).then(setFilaments).catch(console.error); // solo per le prove
updateColorLimit();
render();

// Per i test: ?img=percorso carica subito un'immagine
if (qp.get('img')) loadImage(qp.get('img'), +qp.get('zoom') || 1);
if (qp.get('mode') === 'keep') document.querySelector('#mode button[data-mode=keep]').click();
