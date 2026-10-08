import { FRAME, geometry, loadFont, buildFrame } from './frame.js';
import { Preview3D } from './preview3d.js';
import { stlFiles, stlReadme, zipAsync } from './export-stl.js';
import { buildEps } from './export-eps.js';
import { build3mf } from './export-3mf.js';
import { detectFace, faceFeatures } from './face.js';
import { SVGLoader } from '../vendor/three/addons/SVGLoader.js';
import polygonClipping from '../vendor/polygon-clipping/polygon-clipping.mjs';
import { GUIDE } from './guide.js';

const $ = (s) => document.querySelector(s);
const root = $('#flc-root');
const qp = new URLSearchParams(location.search);
// Configurazione stampata dallo shortcode del plugin. Senza plugin (pagina di prova) i parametri arrivano dall'URL.
const CFG = window.FRANCY_LAMP || {
  restUrl: qp.get('ai') || '', statusUrl: qp.get('aistato') || '', submitUrl: qp.get('convalida') || '',
  nonce: '', isAdmin: true, filaments: [], templates: [], standalone: true,
};
// funzioni accese/spente dall'admin (Impostazioni → Funzioni): feature('feat_xxx') === false = non offrirla.
// Per una funzione nuova: una riga in flc_features() (settings.php) + questo controllo dove serve.
const feature = (k) => !CFG.features || CFG.features[k] !== false;
const MAX_FILAMENTS = 13; // H2C: 1 bobina fissa sull'ugello 1 (bianco) + 3 AMS da 4 sull'ugello 2
// Nero e bianco "di riferimento": con il catalogo diventano le bobine più vicine
let BLACK = '#151515';
let WHITE = '#ffffff';

const state = {
  img: null, zoom: 1, ox: 0, oy: 0,
  mode: 'keep', seed: 1, lit: false, view: '2d',
  result: null, colorOverrides: {}, font: null,
  bandColor: '#5b9bd5', textColor: BLACK,
  filaments: [], originalFile: null, originalSrc: null, aiImageSrc: null, aiProvider: '',
  templates: [], template: null, // disegno pronto scelto: { id, name, url, dataUrl }
  overflow: false, ovSeeds: [], // "sopra la fascia": zone toccate (punti in mm) che escono dal cerchio
  layers: [], layerSel: null, // grafiche aggiuntive: { uid, id, name, url, thumb, x, y (centro, mm), size (larghezza mm), rot (gradi), img }
  painting: false, brush: -1, paints: [], // colora a mano: pennello = indice della palette, tocchi in mm
  locks: [], // bobine scelte a mano: [{ lab (colore originale della zona), hex }], restano anche se si riconverte
};

// stessa versione di app.js (?ver=...) così anche il worker non resta vecchio in cache
const worker = new Worker(new URL('./worker.js' + new URL(import.meta.url).search, import.meta.url));
let jobId = 0;
let preview3d = null;

// Sfondo dell'anteprima: fisso (non cambia tra spenta e accesa), colore scelto in Impostazioni
const STAGE_BG = /^#[0-9a-f]{6}$/i.test(CFG.stageBg || '') ? CFG.stageBg : '#3a3d44';
root.style.setProperty('--stage', STAGE_BG);
root.style.setProperty('--stage-lit', STAGE_BG);
{
  const n = parseInt(STAGE_BG.slice(1), 16), lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  root.classList.toggle('stage-dark', lum < 140); // testi chiari sopra uno sfondo scuro
}
let dirty3d = true;

// ---------------- catalogo filamenti ----------------
function setFilaments(list) {
  state.filaments = (list || [])
    .filter((f) => f && /^#[0-9a-f]{6}$/i.test(f.hex))
    // name: nome vero (solo admin) oppure il codice neutro che il server rimette a posto alla convalida
    .map((f) => ({ name: String(f.name || f.tok || f.hex), label: String(f.label || ''), hex: f.hex.toLowerCase(), lab: hexToLab(f.hex) }));
  if (state.filaments.length) {
    const oldBlack = BLACK;
    // bobine fisse scelte nel catalogo (bianco della base, nero delle linee); altrimenti le più vicine
    const fx = CFG.fixedFilaments || {}, has = (h) => h && state.filaments.some((f) => f.hex === h.toLowerCase());
    BLACK = has(fx.black) ? fx.black.toLowerCase() : nearestFilament('#151515').hex;
    WHITE = has(fx.white) ? fx.white.toLowerCase() : nearestFilament('#ffffff').hex;
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
// Nome pubblico della bobina (quello che vede il cliente), vuoto se non impostato
function filamentLabel(hex) {
  if (!state.filaments.length) return '';
  const f = nearestFilament(hex);
  return f ? f.label : '';
}
// Nome generico in italiano di un colore (se la bobina non ha un nome pubblico)
function colorNameIt(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (sat < 0.12 || d < 0.06) return l > 0.85 ? 'Bianco' : l > 0.6 ? 'Grigio chiaro' : l > 0.3 ? 'Grigio' : l > 0.12 ? 'Grigio scuro' : 'Nero';
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  let name = h < 12 || h >= 345 ? 'Rosso' : h < 40 ? (l < 0.35 ? 'Marrone' : 'Arancio') : h < 55 ? (l < 0.4 ? 'Marrone' : 'Ocra') : h < 70 ? 'Giallo'
    : h < 95 ? 'Verde lime' : h < 165 ? 'Verde' : h < 195 ? 'Turchese' : h < 215 ? 'Azzurro' : h < 250 ? 'Blu' : h < 285 ? 'Viola' : h < 320 ? 'Magenta' : 'Rosa';
  if (name === 'Rosso' && l > 0.7) name = 'Rosa';
  if (name === 'Azzurro' && l < 0.4) name = 'Blu';
  if (name === 'Arancio' && sat < 0.45 && l > 0.6) name = 'Pesca';
  const tone = l > 0.72 ? ' chiaro' : l < 0.3 ? ' scuro' : '';
  return name + tone;
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

// rettangolo occupato dall'immagine nel raster di lavoro (inner = lato del cerchio del disegno, shift = margine)
function imgRect(inner, shift) {
  const { img, zoom, ox, oy } = state;
  const k = inner / crop.width, s = coverScale() * zoom * k, w = img.width * s, h = img.height * s;
  const x0 = shift + inner / 2 - w / 2 + ox * k, y0 = shift + inner / 2 - h / 2 + oy * k;
  return [Math.ceil(x0), Math.ceil(y0), Math.floor(x0 + w), Math.floor(y0 + h)];
}
function drawImageTo(ctx, size, withAdjust = true) {
  const { img, zoom, ox, oy } = state;
  const k = size / crop.width;
  const s = coverScale() * zoom * k;
  const w = img.width * s, h = img.height * s;
  ctx.drawImage(img, size / 2 - w / 2 + ox * k, size / 2 - h / 2 + oy * k, w, h);
  if (withAdjust) applyAdjust(ctx, size);
}

// ---------------- luminosità / contrasto / saturazione ----------------
// Si applicano all'immagine PRIMA della riduzione dei colori (anteprima del ritaglio, conversione,
// immagine mandata all'IA e "ritaglio usato" nello zip). Valori da -100 a +100, 0 = immagine originale.
const adjust = { b: 0, c: 0, s: 0 };
function applyAdjust(ctx, size, height = size, a = adjust) {
  const { b, c, s } = a;
  if (!b && !c && !s) return;
  const lut = new Uint8ClampedArray(256);
  const cc = c * 1.28, f = (259 * (cc + 255)) / (255 * (259 - cc));
  for (let v = 0; v < 256; v++) lut[v] = f * (v + b * 1.28 - 128) + 128;
  const sat = 1 + s / 100;
  const id = ctx.getImageData(0, 0, size, height), d = id.data;
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
    originalImg = null; state.aiImageSrc = null; state.aiCrop = null; state.originalSrc = src;
    state.locks = []; // immagine nuova: le bobine bloccate ripartono da zero
    if (state.fullDisc) { state.fullDisc = null; root.classList.remove('full-disc'); }
    $('#aiUndo').hidden = true;
    setImage(img, zoom, 0, 0);
  };
  img.src = src;
}

function setImage(img, zoom, ox, oy) {
  state.img = img; state.zoom = zoom; state.ox = ox; state.oy = oy;
  state.imgId = (state.imgId || 0) + 1;
  state.ovSeeds = []; state.paints = []; // immagine nuova: parti sopra la fascia e colorazioni a mano da capo
  setAdjust({ b: 0, c: 0, s: 0 }); // immagine nuova (o risultato IA, che ha già le regolazioni): si riparte da zero
  $('#zoom').value = zoom;
  $('#aiBtn').disabled = !!state.aiExhausted;
  drawCrop(); run();
}

// ---------------- ridisegno con IA (passa dal plugin WordPress) ----------------
let originalImg = null;
// Formati che l'IA sa restituire (Gemini): si sceglie il più vicino a quello della foto
const AI_RATIOS = [[1, 1], [2, 3], [3, 2], [3, 4], [4, 3], [4, 5], [5, 4], [9, 16], [16, 9], [21, 9]];
// Immagine da mandare all'IA: sempre la foto originale, con l'inquadratura attuale riportata su di essa
// (se adesso c'è un ridisegno, zoom e spostamento vengono convertiti dalle coordinate del ridisegno)
function aiSource() {
  if (originalImg && state.aiCrop && state.aiImageSrc) {
    const o = originalImg.img, a = state.img, c = state.aiCrop;
    const s0 = (coverFor(a) * state.zoom * a.width) / c.cw;
    return { img: o, zoom: s0 / coverFor(o), ox: state.ox - s0 * (c.cx0 + c.cw / 2 - o.width / 2), oy: state.oy - s0 * (c.cy0 + c.ch / 2 - o.height / 2) };
  }
  // ridisegno di una carta (inquadratura nuova): si riparte dalla foto come era prima del ridisegno
  if (originalImg) return { img: originalImg.img, zoom: originalImg.zoom, ox: originalImg.ox, oy: originalImg.oy };
  return { img: state.img, zoom: state.zoom, ox: state.ox, oy: state.oy };
}
if (CFG.restUrl) { $('#stepAi').hidden = false; loadQuota(); }
if (CFG.aiCard) $('#aiCardRow').hidden = false;

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
  $('#exLabel').textContent = { fedele: 'Fedele', ritratto: 'Ritratto', tombino: 'Tombino', anime: 'Anime' }[aiStyle] || aiStyle;
}
// stili disponibili decisi dall'admin (l'anime si può spegnere)
if (Array.isArray(CFG.aiStyles)) document.querySelectorAll('#aiStyle button').forEach((b) => { b.hidden = !CFG.aiStyles.includes(b.dataset.style); });
const AI_STYLE_NAMES = { fedele: 'Fedele', ritratto: 'Ritratto', tombino: 'Tombino', anime: 'Anime' };
function updateAiBtn() {
  if (!$('#aiBox').classList.contains('busy')) $('#aiBtn').textContent = `✨ ${state.aiImageSrc ? 'Ridisegna di nuovo' : 'Ridisegna'} in stile ${AI_STYLE_NAMES[aiStyle] || aiStyle}`;
}
document.querySelectorAll('#aiStyle button').forEach((b) => b.addEventListener('click', () => {
  aiStyle = b.dataset.style;
  updateAiBtn();
  document.querySelectorAll('#aiStyle button').forEach((x) => x.classList.toggle('active', x === b));
  // stile Ritratto: la modalità ritratto si accende da sola (si può sempre spegnere a mano)
  if (aiStyle === 'ritratto' && !$('#portrait').checked) { setPortrait(true); schedule(); }
  showExample();
}));

// Rimuovi lo sfondo: l'IA toglie lo sfondo della foto e lo sostituisce con quello scelto nel menu
const aiBackgrounds = Array.isArray(CFG.aiBackgrounds) ? CFG.aiBackgrounds : [];
// "Personalizza…": il cliente scrive lui lo sfondo (max 160 caratteri)
const aiBgCustom = CFG.aiBgCustom || '';
if (aiBackgrounds.length || aiBgCustom) {
  $('#aiBgRow').hidden = false;
  aiBackgrounds.forEach((label, i) => $('#aiBg').append(new Option(label, String(i))));
  if (aiBgCustom) $('#aiBg').append(new Option(aiBgCustom, 'custom'));
  const bgEx = Array.isArray(CFG.aiBgExamples) ? CFG.aiBgExamples : [];
  const syncBg = () => {
    const on = $('#aiBgRemove').checked, v = $('#aiBg').value;
    $('#aiBgPick').hidden = !on;
    $('#aiBgText').hidden = !on || v !== 'custom';
    // anteprima salvata in Impostazioni (la "prova" dello sfondo), mostrata come esempio
    const ex = on && v !== 'custom' ? bgEx[+v] : '';
    $('#aiBgEx').hidden = !ex;
    if (ex && $('#aiBgExImg').getAttribute('src') !== ex) $('#aiBgExImg').src = ex;
  };
  $('#aiBgRemove').addEventListener('change', syncBg);
  $('#aiBg').addEventListener('change', () => { syncBg(); if (!$('#aiBgText').hidden) $('#aiBgText').focus(); });
}
// indice dello sfondo scelto, 'custom' per quello scritto dal cliente, -1 = tieni lo sfondo della foto
function aiBackground() {
  if (!$('#aiBgRemove').checked) return -1;
  const v = $('#aiBg').value;
  if (v === 'custom') return $('#aiBgText').value.trim() ? 'custom' : -1;
  return v === '' ? -1 : +v;
}
function aiBackgroundLabel() {
  const b = aiBackground();
  if (b === 'custom') return 'Personalizzato: ' + $('#aiBgText').value.trim();
  return b >= 0 ? aiBackgrounds[b] : null;
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
  if ($('#aiBgRemove').checked && $('#aiBg').value === 'custom' && !$('#aiBgText').value.trim()) {
    aiMessage('Scrivi lo sfondo che vuoi (es. "cielo stellato con la luna") oppure scegline uno dal menu.');
    $('#aiBgText').focus();
    return;
  }
  // Mando all'IA la FOTO ORIGINALE intera (non il ritaglio), nel formato più vicino tra quelli che l'IA
  // sa restituire: così il risultato si rimette con lo stesso zoom e spostamento e si può ancora spostare.
  const src = aiSource(), o = src.img;
  const ratio = o.width / o.height;
  // Si manda SEMPRE l'immagine intera con le sue proporzioni (anche la carta completa: così l'IA capisce bene cosa
  // è testo da togliere); il formato chiesto all'IA è il più vicino tra quelli che sa restituire. Il risultato
  // copre tutta l'immagine e viene rimesso con la stessa inquadratura che c'era.
  const card = !!CFG.aiCard && $('#aiCard').checked;
  const [rw, rh] = AI_RATIOS.reduce((best, r) => (Math.abs(Math.log(ratio * r[1] / r[0])) < Math.abs(Math.log(ratio * best[1] / best[0])) ? r : best));
  const cx0 = 0, cy0 = 0, cw = o.width, ch = o.height;
  const s0 = coverFor(o) * src.zoom;
  const k = Math.min(1, 1536 / Math.max(cw, ch));
  const c = document.createElement('canvas');
  c.width = Math.round(cw * k); c.height = Math.round(ch * k);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(o, cx0, cy0, cw, ch, 0, 0, c.width, c.height);
  // con un ridisegno già fatto riparto dalla foto originale con le SUE regolazioni (quelle di adesso valgono per il ridisegno)
  const adj = originalImg ? originalImg.adj : { ...adjust };
  applyAdjust(ctx, c.width, c.height, adj);
  const image = c.toDataURL('image/jpeg', 0.9);

  $('#aiBox').classList.add('busy');
  $('#aiBtn').textContent = '⏳ Ridisegno in corso… (10–30 s)';
  aiMessage('');
  setStatus("L'IA sta ridisegnando la tua immagine (di solito 10–30 secondi)…");
  try {
    const r = await fetch(CFG.restUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(CFG.nonce ? { 'X-WP-Nonce': CFG.nonce } : {}) },
      body: JSON.stringify({ image, style: aiStyle, bg: aiBackground(), bg_text: aiBackground() === 'custom' ? $('#aiBgText').value.trim().slice(0, 160) : '', card: card ? 1 : 0, aspect: `${rw}:${rh}` }),
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
    if (!originalImg) originalImg = { img: o, zoom: src.zoom, ox: src.ox, oy: src.oy, mode: state.mode, adj };
    state.aiImageSrc = j.image;
    state.aiProvider = j.provider || '';
    state.aiBackground = aiBackgroundLabel();
    $('#aiUndo').hidden = false;
    selectMode('keep');
    if (aiStyle === 'ritratto') setPortrait(true); // il ritratto IA ha già la pelle in 3 toni
    // stessa inquadratura di prima: il ridisegno copre la zona [cx0, cy0, cw, ch] della foto originale
    // il ridisegno copre tutta l'immagine originale: stessa scala e stesso spostamento di prima
    const s1 = (s0 * cw) / img.width;
    state.aiCrop = { cx0, cy0, cw, ch };
    setImage(img, Math.min(4, Math.max(1, s1 / coverFor(img))), src.ox + s0 * (cx0 + cw / 2 - o.width / 2), src.oy + s0 * (cy0 + ch / 2 - o.height / 2));
    aiMessage(`Ridisegno fatto${j.provider ? ' con ' + j.provider : ''}: ora il disco parte dall'immagine dell'IA.`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus(err.message);
    aiMessage(err.message, 'error');
  } finally {
    $('#aiBox').classList.remove('busy');
    updateAiBtn(); updateSteps();
  }
});

$('#aiUndo').addEventListener('click', () => {
  if (!originalImg) return;
  const o = originalImg, v = aiSource(); // la foto torna con l'inquadratura che hai adesso
  originalImg = null;
  state.aiImageSrc = null; state.aiCrop = null;
  $('#aiUndo').hidden = true;
  selectMode(o.mode);
  setImage(v.img, Math.min(4, Math.max(1, v.zoom)), v.ox, v.oy);
  if (o.adj) { setAdjust(o.adj); schedule(); } // la foto torna con le regolazioni che aveva
});

// ---------------- pannello sinistro allargabile (desktop) ----------------
(function () {
  const bar = $('#panelResizer'), layout = document.querySelector('.flc .layout'), root = document.querySelector('.flc');
  if (!bar || !layout) return;
  const KEY = 'flcLeftWidth', MIN = 280, DEF = 330;
  const max = () => Math.max(MIN, Math.min(640, layout.clientWidth - 280 - 360)); // lascia almeno 360 px al disco
  const apply = (w) => { w = Math.round(Math.min(max(), Math.max(MIN, w))); layout.style.setProperty('--flc-left', w + 'px'); return w; };
  let saved = 0;
  try { saved = +localStorage.getItem(KEY) || 0; } catch (e) { /* storage non disponibile */ }
  if (saved) apply(saved);
  let start = null;
  bar.addEventListener('pointerdown', (e) => {
    start = { x: e.clientX, w: layout.querySelector('.panel.left').getBoundingClientRect().width };
    bar.setPointerCapture(e.pointerId); bar.classList.add('drag'); root.classList.add('resizing');
    e.preventDefault();
  });
  bar.addEventListener('pointermove', (e) => { if (start) apply(start.w + e.clientX - start.x); });
  const end = () => {
    if (!start) return;
    start = null; bar.classList.remove('drag'); root.classList.remove('resizing');
    const w = parseInt(layout.style.getPropertyValue('--flc-left'), 10);
    try { localStorage.setItem(KEY, String(w)); } catch (e) { /* ok */ }
    window.dispatchEvent(new Event('resize'));
  };
  bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', end);
  bar.addEventListener('dblclick', () => { apply(DEF); try { localStorage.removeItem(KEY); } catch (e) { /* ok */ } window.dispatchEvent(new Event('resize')); });
  // se la finestra si stringe, il pannello non deve mangiarsi il disco
  window.addEventListener('resize', () => { const cur = parseInt(layout.style.getPropertyValue('--flc-left'), 10); if (cur && cur > max()) apply(cur); });
})();

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
  if (!/…$/.test($('#status').textContent)) setStatus('');
}));

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
  state.view = b.dataset.view;
  $('#view2d').hidden = state.view !== '2d';
  $('#view3d').hidden = state.view !== '3d';
  if (state.view === '3d') {
    if (!preview3d) {
      preview3d = new Preview3D($('#view3d'), STAGE_BG, lampConfig());
      preview3d.setLampColors(state.lampColors);
    }
    preview3d.setLit(state.lit);
    if (dirty3d) update3d();
  }
}));

let textTimer;
for (const id of ['tTL', 'tTR', 'tBL', 'tBR']) $('#' + id).addEventListener('input', () => { clearTimeout(textTimer); textTimer = setTimeout(render, 150); });
// dimensione di tutte le scritte (in % della fascia; mostrata in mm)
const showTextSize = () => { $('#textSizeOut').textContent = (FRAME.band * $('#textSize').value / 100).toFixed(1).replace('.', ',') + ' mm'; };
$('#textSize').addEventListener('input', () => { showTextSize(); clearTimeout(textTimer); textTimer = setTimeout(render, 40); });
showTextSize();
// slider di posizione: aggiornamento leggero mentre si trascina
for (const id of ['pTL', 'pTR', 'pBL', 'pBR']) $('#' + id).addEventListener('input', () => { clearTimeout(textTimer); textTimer = setTimeout(render, 40); });

// ---------------- disegni pronti ----------------
// PNG del disco completo caricati dall'admin: si applicano al modello solo per l'anteprima, niente modifiche.
// Galleria dei disegni pronti: anche centinaia, quindi ricerca per nome, categorie, grandezza anteprime regolabile
// (ricordata nel browser) e, per l'admin, filtro pronti da stampare / da elaborare.
const tplUi = { q: '', cat: '', ready: '' };
const norm = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function setTemplates(list) {
  state.templates = (list || []).filter((t) => t && t.url);
  $('#tplBox').hidden = !state.templates.length;
  // categorie con il numero di disegni
  const cats = new Map();
  for (const t of state.templates) for (const c of t.cats || []) cats.set(c, (cats.get(c) || 0) + 1);
  if (tplUi.cat && !cats.has(tplUi.cat)) tplUi.cat = '';
  const box = $('#tplCats');
  box.innerHTML = '';
  box.hidden = !cats.size;
  const chip = (label, val, n) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = tplUi.cat === val ? 'active' : '';
    b.append(label);
    const sm = document.createElement('small'); sm.textContent = n; b.append(sm);
    b.addEventListener('click', () => { tplUi.cat = val; box.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b)); renderTplGrid(); });
    box.append(b);
  };
  chip('Tutti', '', state.templates.length);
  [...cats.entries()].sort((a, b) => a[0].localeCompare(b[0], 'it')).forEach(([c, n]) => chip(c, c, n));
  $('#tplReady').hidden = !CFG.isAdmin;
  renderTplGrid();
}
function renderTplGrid() {
  const words = norm(tplUi.q).split(/\s+/).filter(Boolean);
  const list = state.templates.filter((t) => {
    if (tplUi.cat && !(t.cats || []).includes(tplUi.cat)) return false;
    if (tplUi.ready !== '' && !!t.ready !== (tplUi.ready === '1')) return false;
    const hay = norm(t.name + ' ' + (t.cats || []).join(' '));
    return words.every((w) => hay.includes(w));
  });
  const grid = $('#tplGrid'), frag = document.createDocumentFragment();
  for (const t of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tpl-card';
    b.title = t.name;
    const img = document.createElement('img');
    img.src = t.thumb || t.url; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
    const name = document.createElement('span'); name.textContent = t.name;
    b.append(img, name);
    if (CFG.isAdmin && t.ready) { const r = document.createElement('i'); r.className = 'tpl-ready'; r.textContent = '✓ 3MF'; r.title = 'Pronto da stampare (EPS e 3MF salvati)'; b.append(r); }
    b.addEventListener('click', () => selectTemplate(t));
    frag.append(b);
  }
  grid.replaceChildren(frag);
  $('#tplEmpty').hidden = list.length > 0;
  $('#tplCount').textContent = list.length === state.templates.length ? `${list.length}` : `${list.length} di ${state.templates.length}`;
}
function setTplSize(v) {
  $('#tplGrid').style.setProperty('--tpl-size', v + 'px');
  $('#tplSize').value = v;
}
try { const v = +localStorage.getItem('flcTplSize'); if (v >= 90 && v <= 320) setTplSize(v); } catch (e) { /* niente memoria nel browser */ }
$('#tplSize').addEventListener('input', (e) => { setTplSize(+e.target.value); try { localStorage.setItem('flcTplSize', e.target.value); } catch (err) { /* facoltativo */ } });
let tplSearchTimer;
$('#tplSearch').addEventListener('input', (e) => { clearTimeout(tplSearchTimer); tplSearchTimer = setTimeout(() => { tplUi.q = e.target.value; renderTplGrid(); }, 120); });
$('#tplReady').addEventListener('change', (e) => { tplUi.ready = e.target.value; renderTplGrid(); });
$('#tplOpen').addEventListener('click', () => {
  $('#tplModal').hidden = false;
  if (matchMedia('(pointer: fine)').matches) $('#tplSearch').focus(); // su telefono niente tastiera che copre la griglia
});
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
  // le voci rimaste senza area (colorazioni a mano annullate o svuotate) non contano
  return state.result.palette.map((p, i) => (p.area > 0 ? artColor(i) : null)).filter(Boolean);
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
    b.title = CFG.isAdmin ? f.name : f.label;
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
      b.title = (CFG.isAdmin ? filamentName(c) : filamentLabel(c)) || c;
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
  // (l'IA ha ricevuto la zona state.aiCrop della foto originale, e Fedele/Ritratto mantengono la composizione)
  if (!pts && originalImg && img === state.img && state.aiImageSrc) {
    const o = originalImg;
    const op = await detectFace(o.img);
    const c = state.aiCrop;
    if (op && c) pts = op.map((p) => [(p[0] * o.img.width - c.cx0) / c.cw, (p[1] * o.img.height - c.cy0) / c.ch]);
  }
  return pts;
}
function faceStatus(text) { const el = $('#portraitHint'); el.hidden = false; el.textContent = text; }

function run() {
  if (!state.img) return;
  const g = geometry();
  const ppmm = +$('#ppmm').value;
  // con "sopra la fascia" (o con grafiche aggiuntive, che possono andare sulla fascia) il raster arriva oltre la
  // fascia; l'immagine resta inquadrata sul cerchio del disegno
  // disegno pronto elaborato (solo admin): l'immagine copre TUTTO il disco (Ø200) e non si aggiunge la cornice
  const fullDisc = !!state.fullDisc;
  const rArtEff = fullDisc ? g.R : g.rImgArt;
  const layersOn = !fullDisc && state.layers.length > 0;
  const ovActive = !fullDisc && (state.overflow || layersOn);
  const inner = Math.round(2 * rArtEff * ppmm);
  // stessa scala e margine di pixel interi: il disegno dentro il cerchio resta identico con o senza raster grande
  // (altrimenti mezzo pixel di spostamento cambia la scelta automatica dei colori)
  const pxmm = inner / (2 * rArtEff);
  const margin = ovActive ? Math.ceil((g.rBandOut + 1 - g.rImgArt) * pxmm) : 0;
  const size = inner + 2 * margin;
  const rRaster = size / (2 * pxmm);
  const shift = (size - inner) / 2;
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
      face = faceFeatures(pts.map((p) => toCanvas(p, img, state.zoom, state.ox, state.oy, inner).map((v) => v + shift)));
      faceStatus('Volto trovato: pelle con 3 toni dedicati, niente linee dentro il viso, occhi (bianco + iride) e denti disegnati in automatico.');
    } else {
      faceStatus('Volto non trovato: pelle con 3 toni dedicati e niente linee dentro il viso, ma occhi e denti non vengono ridisegnati.');
    }
  }
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
  ctx.save(); ctx.translate(shift, shift); drawImageTo(ctx, inner, false); ctx.restore();
  applyAdjust(ctx, size); // le regolazioni (luminosità…) su tutto il raster
  // grafiche aggiuntive: disegnate sopra l'immagine (dopo le regolazioni), poi convertite insieme al disegno;
  // la loro sagoma (mask) può uscire dal cerchio come le parti di "sopra la fascia"
  let mask = null;
  if (layersOn) {
    const k = size / (2 * rRaster), px = (v) => (v + rRaster) * k;
    const m = document.createElement('canvas'); m.width = m.height = size;
    const mctx = m.getContext('2d');
    for (const L of state.layers) {
      if (!L.img || !L.img.naturalWidth) continue;
      for (const cx of [ctx, mctx]) {
        cx.save(); cx.translate(px(L.x), px(L.y)); cx.rotate(L.rot * Math.PI / 180);
        const w = L.size * k, h = w * L.img.naturalHeight / L.img.naturalWidth;
        cx.drawImage(L.img, -w / 2, -h / 2, w, h); cx.restore();
      }
    }
    const md = mctx.getImageData(0, 0, size, size).data;
    mask = new Uint8Array(size * size);
    for (let i = 0; i < mask.length; i++) mask[i] = md[i * 4 + 3] > 110 ? 1 : 0;
  }
  const imageData = ctx.getImageData(0, 0, size, size).data;
  // disco intero: si lavora solo dentro la sagoma vera del disco (fori laterali e asola esclusi)
  let discMask = null;
  if (fullDisc) {
    const m = document.createElement('canvas'); m.width = m.height = size;
    const mc = m.getContext('2d');
    mc.setTransform(pxmm, 0, 0, pxmm, size / 2, size / 2);
    mc.fill(new Path2D(buildFrame(null, {}).outline), 'evenodd');
    const md = mc.getImageData(0, 0, size, size).data;
    discMask = new Uint8Array(size * size);
    for (let i = 0; i < discMask.length; i++) discMask[i] = md[i * 4 + 3] > 127 ? 1 : 0;
  }
  const opts = {
    discMask,
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
    centers: state.restoreCenters || null,
    // ciò che decide i colori dell'immagine: se non cambia, il worker riusa gli stessi colori
    paletteKey: JSON.stringify([fullDisc, state.imgId, state.mode, +$('#colors').value, $('#portrait').checked, state.seed, +$('#smooth').value, adjust, Math.round(state.zoom * 1000), Math.round(state.ox), Math.round(state.oy), ppmm, +$('#line').value, $('#addOutlines').checked]),
    scale: (2 * rRaster) / size,
    offset: -rRaster,
    ov: ovActive ? {
      rArt: g.rImgArt * size / (2 * rRaster), rImg: g.rImg * size / (2 * rRaster),
      rKeep: (g.rBandOut + 0.3) * size / (2 * rRaster),          // l'anello nero esterno ci va sopra
      slotHalf: (FRAME.bottomSlot.diameter / 2 + FRAME.slotBorder + 0.6) * size / (2 * rRaster),
      seeds: state.overflow ? state.ovSeeds : [],
      imgRect: imgRect(inner, shift),
      mask,
    } : null,
  };
  const id = ++jobId;
  state.pendingOv = ovActive;
  setStatus('Elaborazione…');
  worker.postMessage({ id, imageData, size, ppmm, opts }, [imageData.buffer]);
}

worker.onmessage = (e) => {
  const { id, progress, result, error } = e.data;
  if (id !== jobId) return;
  if (progress) return setStatus(progress + '…');
  if (error) { console.error(error); return setStatus('Errore nella conversione'); }
  state.result = result;
  if (!result.keep) {
    if (result.centers) state.centers = result.centers;
    state.restoreCenters = null;
    state.colorOverrides = {}; state.resultOv = !!state.pendingOv; state.baseLayers = result.layers; applyLocks(result.palette);
    state.autoFrozen = null;
    state.autoFrozen = { r: result, list: autoColors().slice() }; // da qui in poi le bobine automatiche restano queste
  }
  // le parti sopra la fascia scelte dal cliente restano sue: cambiano solo con i suoi tocchi o "Togli tutte"
  if (result.keep && result.ovSeeds && state.overflow) state.ovSeeds = result.ovSeeds;
  state.ovNote = result.ovTooBig ? 'Quella zona è sfondo: riempirebbe tutta la fascia, quindi resta dentro il cerchio.'
    : result.ovNoOut ? 'Quella parte non arriva al bordo del cerchio: allarga un po\' lo zoom o sposta l\'immagine perché sporga.' : '';
  // zone finite sulla stessa bobina: le faccio unire dal worker (niente bordi interni nel disegno)
  let mergeSent = false;
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
    if (any) { worker.postMessage({ id, merge }); mergeSent = true; }
  }
  // colorazioni a mano: dopo ogni nuova conversione si rifanno da sole (stessi punti, stesse bobine)
  if (!result.keep && !mergeSent && state.paints.length) {
    resolvePaints();
    worker.postMessage({ id, paints: state.paints });
    setTimeout(() => setStatus('Coloro…'), 0);
  }
  renderPalette();
  updateColorLimit();
  render();
  setStatus('');
};

function setStatus(t) {
  $('#status').textContent = t || (state.result || state.template ? (state.lit ? 'Ecco la tua lampada accesa' : 'Ecco il tuo disco · prova ad accenderlo con 💡 Accesa') : '');
}

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
  // abbinamento congelato dall'ultima conversione: toccare parti, colorare a mano o annullare non rimescola le bobine
  const frozen = state.autoFrozen && r !== state.autoFrozen.r ? state.autoFrozen.list : null;
  if (frozen) pal.forEach((p, i) => { if (frozen[i] && !state.colorOverrides[i] && !p.black) { out[i] = frozen[i]; used.add(frozen[i]); } });
  pal.forEach((p, i) => { if (p.black) out[i] = BLACK; }); // linee sempre nere, nessun adattamento
  // il bianco protetto (denti, occhi) usa sempre la bobina della base
  let wi = pal.findIndex((p, i) => p.white && !state.colorOverrides[i]), wl = wi >= 0 ? Infinity : -1;
  pal.forEach((p, i) => {
    if (out[i] || state.colorOverrides[i] || p.area <= 0) return;
    const hex = rgbToHex(p), L = hexToLab(hex)[0];
    if (isNearWhite(hex) && L > wl) { wl = L; wi = i; }
  });
  if (wi >= 0) out[wi] = WHITE;
  const todo = pal.map((p, i) => i).filter((i) => !out[i] && !state.colorOverrides[i] && pal[i].area > 0);
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
  // voci senza area (non stampate): colore qualsiasi, non occupano bobine
  pal.forEach((p, i) => { if (!out[i] && !state.colorOverrides[i]) out[i] = rgbToHex(p); });
  autoCache = { r, f: state.filaments, ov, k: BLACK + WHITE, list: out };
  return out;
}
// Bobine "da pelle": tinte calde tra il pesca e il marrone (niente grigi, rosa, gialli o colori freddi)
function isSkinFilament(f) {
  const [L, A, B] = f.lab, h = (Math.atan2(B, A) * 180) / Math.PI;
  return L > 25 && L < 92 && Math.hypot(A, B) > 8 && Math.hypot(A, B) < 44 && h > 28 && h < 86;
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
  $('#paletteEmpty').hidden = !!(state.result || state.template);
  $('#paletteHint').hidden = !state.result;
  if (!state.result) return;
  // una riga per bobina: zone diverse finite sullo stesso colore (sostituzione, 🗑, toni della pelle) si sommano
  const groups = new Map();
  state.result.palette.forEach((p, i) => {
    if (p.area <= 0) return; // non più nel disegno
    const hex = artColor(i);
    const g = groups.get(hex);
    if (!g) { groups.set(hex, { i, idx: [i], area: p.area, black: !!p.black }); return; }
    g.idx.push(i); g.area += p.area; g.black = g.black || !!p.black;
    if (p.area > state.result.palette[g.i].area && !p.black) g.i = i; // rappresentante: la zona più grande
  });
  for (const g of groups.values()) {
    const i = g.i, p = { ...state.result.palette[i], black: g.black, area: g.area };
    const li = document.createElement('li');
    if (state.painting) {
      li.classList.toggle('brush', state.brush === artColor(i));
      li.addEventListener('click', () => { state.brush = artColor(i); renderPalette(); renderPaintSwatches(); });
    }
    let ctrl;
    if (state.filaments.length) {
      ctrl = document.createElement('button');
      ctrl.type = 'button';
      ctrl.className = 'swatch-btn';
      ctrl.dataset.popover = '1';
      ctrl.style.background = artColor(i);
      // sostituzione: il colore scelto prende il posto del vecchio OVUNQUE (zone, fascia, scritte), anche se è una
      // bobina già usata (in quel caso le zone diventano dello stesso colore e nei file si uniscono)
      // è una sostituzione, non un'aggiunta: il vecchio colore sparisce (tranne bianco base e nero, che restano sempre),
      // quindi con 13 colori su 13 si può comunque scegliere una bobina nuova
      ctrl.addEventListener('click', (ev) => { if (state.painting || !feature('feat_replace')) return; openFilamentPopover(ctrl, (hex) => replaceColor(artColor(i), hex),
        (hex) => { const set = colorSet(), old = artColor(i); return set.has(hex) || set.size - (old !== WHITE && old !== BLACK ? 1 : 0) < MAX_FILAMENTS; }); });
    } else {
      ctrl = document.createElement('input');
      ctrl.type = 'color'; ctrl.value = artColor(i);
      ctrl.addEventListener('input', () => { for (const k of g.idx) state.colorOverrides[k] = ctrl.value; render(); });
    }
    if (p.black) { ctrl.disabled = true; ctrl.title = 'Le linee sono sempre nere'; }
    const name = document.createElement('span');
    // il cliente vede il nome pubblico della bobina (es. "Arancio Mandarino"); il nome vero lo vede solo l'admin
    const fil = CFG.isAdmin ? filamentName(artColor(i)) : '';
    const label = p.black ? 'Nero contorni' : p.white && artColor(i) === WHITE ? 'Bianco' : filamentLabel(artColor(i)) || colorNameIt(artColor(i));
    name.textContent = label + (fil ? ` · ${fil}` : '');
    const area = document.createElement('span');
    area.className = 'area';
    area.textContent = `${Math.round(p.area)} mm²`;
    if (g.idx.some(isLocked) && !state.painting) {
      const lk = document.createElement('button');
      lk.type = 'button'; lk.className = 'lock-btn'; lk.textContent = '🔒';
      lk.title = 'Bobina scelta da te: resta anche se aggiorni il disegno. Tocca per tornare automatico.';
      lk.addEventListener('click', (ev) => {
        ev.stopPropagation();
        for (const k of g.idx) {
          const hex = state.colorOverrides[k];
          if (!hex) continue;
          state.locks = state.locks.filter((l) => l.hex !== hex);
          delete state.colorOverrides[k];
        }
        renderPalette(); render();
      });
      name.append(' ', lk);
    }
    // 🗑 togli il colore: le sue zone (e fascia, scritte, pennellate di quel colore) diventano bianche
    let del = null;
    if (!p.black && artColor(i) !== WHITE && !state.painting && feature('feat_remove_color')) {
      del = document.createElement('button');
      del.type = 'button'; del.className = 'del-color'; del.textContent = '🗑';
      del.title = 'Togli questo colore: le sue zone diventano bianche (Annulla non serve: puoi ricolorarle quando vuoi)';
      del.setAttribute('aria-label', 'Togli il colore ' + label);
      del.addEventListener('click', (ev) => { ev.stopPropagation(); replaceColor(artColor(i), WHITE); setStatus(`${label} tolto: le sue zone ora sono bianche`); });
    }
    li.append(ctrl, name, area);
    if (del) { li.append(del); li.classList.add('has-del'); }
    if (g.idx.length > 1) li.title = `${g.idx.length} zone del disegno con questa bobina`;
    ul.append(li);
  }
}

// ---------------- composizione ----------------
function texts() {
  // posizioni dagli slider: sopra il valore è già l'angolo (-180 sinistra … 0 destra);
  // sotto lo slider va da sinistra a destra, l'angolo da 180 (sinistra) a 0 (destra)
  return { topLeft: $('#tTL').value, topRight: $('#tTR').value, bottomLeft: $('#tBL').value, bottomRight: $('#tBR').value,
    pos: { topLeft: +$('#pTL').value, topRight: +$('#pTR').value, bottomLeft: 180 - +$('#pBL').value, bottomRight: 180 - +$('#pBR').value },
    height: +$('#textSize').value / 100 };
}

// ---------------- sopra la fascia: forme ----------------
const areaCache = new Map();
function svgArea(d) {
  if (areaCache.has(d)) return areaCache.get(d);
  let a = 0;
  for (const poly of svgToPolys(d)) poly.forEach((r, k) => {
    let s = 0;
    for (let i = 0; i + 1 < r.length; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
    a += (k ? -1 : 1) * Math.abs(s / 2);
  });
  if (areaCache.size > 40) areaCache.clear();
  areaCache.set(d, a);
  return a;
}
// Le parti del disegno che escono dal cerchio vanno SOPRA la fascia: a fascia, linea interna, scritte e
// contorno dell'asola si toglie esattamente la loro sagoma (negli STL niente parti sovrapposte).
// L'anello nero esterno non si tocca: resta sempre sopra a tutto.
const svgLoader = new SVGLoader();
function svgToPolys(d) {
  const data = svgLoader.parse(`<svg xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="${d}"/></svg>`);
  const out = [];
  // archi di cerchio campionati fitti (mezzo grado): con pochi punti i lati dritti rientrano rispetto al cerchio
  // vero e tra fascia e anello nero spunta la base bianca. Curve delle lettere: 8 punti bastano.
  const pathPts = (path) => {
    const pts = [];
    for (const c of path.curves) {
      const n = c.isEllipseCurve ? Math.max(8, Math.ceil(Math.abs(c.aEndAngle - c.aStartAngle) / (Math.PI / 360))) : c.isLineCurve ? 1 : 8;
      for (const q of c.getPoints(n)) {
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(q.x - last[0], q.y - last[1]) > 1e-6) pts.push([q.x, q.y]);
      }
    }
    if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6) pts.pop();
    if (pts.length) pts.push(pts[0]);
    return pts;
  };
  for (const path of data.paths) for (const sh of SVGLoader.createShapes(path)) {
    const shape = pathPts(sh), holes = sh.holes.map(pathPts).filter((h) => h.length >= 4);
    if (shape.length >= 4) out.push([shape, ...holes]);
  }
  return out;
}
// percorso a soli segmenti (M/L/Z) del convertitore -> poligoni (pari/dispari come nel disegno)
function tracedToPolys(d) {
  const rings = [];
  for (const part of d.split('Z')) {
    const nums = part.match(/-?\d+(?:\.\d+)?/g);
    if (!nums || nums.length < 6) continue;
    const r = [];
    for (let i = 0; i + 1 < nums.length; i += 2) r.push([+nums[i], +nums[i + 1]]);
    r.push(r[0]);
    rings.push([r]);
  }
  return rings.length ? polygonClipping.xor(...rings) : [];
}
const polysToPath = (mp) => mp.map((poly) => poly.map((r) => 'M' + r.map((p) => `${Math.round(p[0] * 1000) / 1000} ${Math.round(p[1] * 1000) / 1000}`).join('L') + 'Z').join('')).join('');
// framePath: la "zona cornice" vettorializzata dal convertitore insieme al disegno (fuori dal cerchio, tutto ciò
// che non è disegno). Fascia & co. vengono ristrette a questa zona: i bordi coincidono con quelli delle parti
// che escono, quindi niente fessure bianche e niente sovrapposizioni.
const clipCache = new Map();
function minusOverflow(d, framePath) {
  if (!d || !framePath) return d;
  const key = framePath.length + ':' + framePath.slice(0, 40) + '|' + d;
  if (clipCache.has(key)) return clipCache.get(key);
  let out = d;
  try {
    if (!clipCache.has('fr:' + framePath)) { clipCache.clear(); clipCache.set('fr:' + framePath, tracedToPolys(framePath)); }
    const fr = clipCache.get('fr:' + framePath);
    if (fr.length) out = polysToPath(polygonClipping.intersection(svgToPolys(d), fr));
  } catch (err) { console.error('sopra la fascia:', err); }
  if (clipCache.size > 40) { const fr = clipCache.get('fr:' + framePath); clipCache.clear(); clipCache.set('fr:' + framePath, fr); }
  clipCache.set(key, out);
  return out;
}

function parts() {
  let frame = buildFrame(state.font, texts());
  // due scritte che si accavallano (stessa metà)?
  const bx = frame.textBoxes || {};
  const hit = (a, b) => bx[a] && bx[b] && bx[a].from < bx[b].to + 1 && bx[b].from < bx[a].to + 1;
  state.textOverlap = hit('topLeft', 'topRight') ? 'sopra' : hit('bottomLeft', 'bottomRight') ? 'sotto' : '';
  const fgPath = state.result ? state.result.framePath || '' : '';
  state.ovTextHit = false;
  if (fgPath) {
    const text = minusOverflow(frame.text, fgPath);
    // la sagoma copre una scritta? (il testo "bucato" diventa più corto)
    state.ovTextHit = !!frame.text && (!text || Math.abs(svgArea(text) - svgArea(frame.text)) > 0.5);
    frame = { ...frame, band: minusOverflow(frame.band, fgPath), innerLine: minusOverflow(frame.innerLine, fgPath), text,
      slotBorder: minusOverflow(frame.slotBorder, fgPath) };
  }
  const band = state.bandColor, txt = state.textColor;
  const zArt = FRAME.baseThickness, hArt = FRAME.artThickness;
  // Struttura reale: base bianca piena 0,52 mm + motivo colorato 0,48 mm sopra (disco totale 1 mm)
  const list = [{ id: 'base-bianca', d: frame.outline, color: WHITE, z: 0, depth: FRAME.baseThickness, layer: 'base' }];
  const art = (o) => list.push({ z: zArt, depth: hArt, layer: 'motivo', ...o });
  if (state.result) {
    const pal = state.result.palette;
    // prima i colori, poi il nero del disegno (in caso di sovrapposizione al bordo vince il nero)
    pal.forEach((p, i) => { if (!p.black && p.area > 0) art({ id: `disegno-colore-${i + 1}`, d: state.result.layers[i], color: artColor(i), area: p.area }); });
    pal.forEach((p, i) => { if (p.black && p.area > 0) art({ id: 'disegno-nero', d: state.result.layers[i], color: artColor(i), black: true, area: p.area }); });
  }
  if (state.fullDisc && !state.template) return list; // disegno pronto elaborato: la cornice è già nel disegno
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
    setDisabled({ dlSvg: true, dlStl: true, dlPng: false, dlPreview: false });
    $('#submitBtn').disabled = !CFG.submitUrl;
    dirty3d = true;
    if (state.view === '3d' && preview3d) update3d();
    $('#textWarn').hidden = true;
    updateFullDiscBtn();
    $('#projSave').hidden = false;
    updateSteps();
    return;
  }
  const { svg, colors, parts: ps } = buildSvg(false);
  if (state.fullDisc) state.fullDisc.cur = svg;
  // colora a mano: i confini di tutte le zone (anche tra due bianchi) tratteggiati, solo a schermo
  const guide = state.painting && state.baseLayers
    ? `<g id="guida-zone" fill="none" stroke="#d0342c" stroke-opacity=".75" stroke-width="${0.22 * zoomUnit()}" stroke-dasharray="${0.8 * zoomUnit()} ${0.5 * zoomUnit()}" pointer-events="none">${state.baseLayers.map((d) => (d ? `<path d="${d}"/>` : '')).join('')}</g>`
    : '';
  $('#svgHost').innerHTML = guide ? svg.replace('</svg>', guide + '</svg>') : svg;
  applyZoom();
  renderOverlay();
  const n = colors.size;
  const over = n > MAX_FILAMENTS;
  $('#count').textContent = `Colori totali: ${n} / ${MAX_FILAMENTS}` + (over ? ' – troppi, riduci i colori del disegno' : '');
  $('#count').style.color = over ? '#c0392b' : '';
  setDisabled({ dlSvg: !state.result || over, dlStl: !state.result || over, dlPng: !state.result, dlPreview: !state.result });
  $('#submitBtn').disabled = !state.result || over || !CFG.submitUrl;
  renderPickers();
  dirty3d = true;
  if (state.view === '3d' && preview3d) update3d(ps);
  updateOvUi();
  updatePaintUi();
  updateFullDiscBtn();
  $('#projSave').hidden = !state.result && !state.template;
  $('#textWarn').hidden = !state.textOverlap;
  $('#textWarn').textContent = state.textOverlap ? `Le due scritte di ${state.textOverlap} si sovrappongono: spostane una con il suo slider.` : '';
  updateSteps();
}

// ---------------- sostituisci un colore ----------------
function replaceColor(oldHex, newHex) {
  oldHex = oldHex.toLowerCase(); newHex = newHex.toLowerCase();
  if (!state.result || oldHex === newHex) return;
  // bobina già usata da altre zone: quelle la tengono (bloccata), altrimenti l'automatico le sposterebbe su
  // un'altra bobina per lasciarla libera e i due colori non si unirebbero
  if (newHex !== WHITE && newHex !== BLACK) state.result.palette.forEach((p, i) => {
    if (p.black || p.area <= 0 || state.colorOverrides[i] || artColor(i) !== newHex) return;
    state.colorOverrides[i] = newHex;
    lockColor(i, newHex);
  });
  state.result.palette.forEach((p, i) => {
    if (p.black || p.area <= 0 || artColor(i) !== oldHex) return;
    state.colorOverrides[i] = newHex;
    lockColor(i, newHex);
  });
  if (state.bandColor.toLowerCase() === oldHex) state.bandColor = newHex;
  if (state.textColor.toLowerCase() === oldHex) state.textColor = newHex;
  // i tocchi del pennello con il vecchio colore seguono la sostituzione
  state.paints = state.paints.map((pt) => (pt.hex.toLowerCase() === oldHex ? { ...pt, hex: newHex } : pt));
  renderPalette(); render();
}

// ---------------- colori bloccati ----------------
// Una bobina scelta a mano per una zona resta sua anche quando la conversione si rifà (altri colori, contorni,
// zoom…): nella nuova palette si ritrova la zona con il colore originale più simile e le si rimette la bobina.
const palLab = (p) => hexToLab(rgbToHex(p));
function lockColor(i, hex) {
  const lab = palLab(state.result.palette[i]);
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  state.locks = state.locks.filter((l) => d(l.lab, lab) > 6); // la stessa zona scelta di nuovo: vale l'ultima
  state.locks.push({ lab, hex });
}
function applyLocks(pal) {
  if (!state.locks.length) return;
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const pairs = [];
  pal.forEach((p, i) => { if (p.black || p.area <= 0) return; const lab = palLab(p); state.locks.forEach((l, k) => pairs.push([d(l.lab, lab), i, k])); });
  pairs.sort((a, b) => a[0] - b[0]);
  const zoneDone = new Set(), lockDone = new Set();
  for (const [dist, i, k] of pairs) {
    if (dist > 22 || zoneDone.has(i) || lockDone.has(k)) continue; // troppo diversa: quella zona non c'è più
    state.colorOverrides[i] = state.locks[k].hex;
    zoneDone.add(i); lockDone.add(k);
  }
}
function isLocked(i) {
  const o = state.colorOverrides[i];
  return !!o && state.locks.some((l) => l.hex === o);
}

// ---------------- colora a mano ----------------
function paintIndexFor(hex) {
  const pal = state.result.palette;
  hex = hex.toLowerCase();
  const found = pal.findIndex((p, i) => p.area > 0 && !(p.black && hex !== BLACK) && artColor(i) === hex);
  if (found >= 0) return found;
  // colore nuovo: voce in più (anche se ce n'è già una in attesa nei tocchi non ancora tornati)
  return Math.max(pal.length, ...state.paints.map((x) => x.to + 1));
}
// dopo una nuova conversione gli indici della palette cambiano: ogni tocco ritrova l'indice dalla sua bobina
function resolvePaints() {
  const pal = state.result.palette, fresh = new Map();
  let next = pal.length;
  state.paints = state.paints.map((pt) => {
    const hex = pt.hex.toLowerCase();
    let to = pal.findIndex((p, i) => p.area > 0 && !(p.black && hex !== BLACK) && artColor(i) === hex);
    if (to < 0) { if (!fresh.has(hex)) fresh.set(hex, next++); to = fresh.get(hex); state.colorOverrides[to] = hex; }
    return { ...pt, to };
  });
}
function renderPaintSwatches() {
  const host = $('#paintSwatches');
  host.innerHTML = '';
  const set = colorSet();
  for (const hex of [BLACK, ...state.filaments.map((f) => f.hex)]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.background = hex;
    const f = state.filaments.find((x) => x.hex === hex);
    b.title = hex === BLACK ? 'Nero' : (CFG.isAdmin ? f && f.name : f && f.label) || hex;
    b.className = state.brush === hex ? 'on' : '';
    b.disabled = !set.has(hex) && set.size >= MAX_FILAMENTS; // oltre i 13 colori non si va
    b.addEventListener('click', () => { state.brush = hex; renderPaintSwatches(); renderPalette(); });
    host.append(b);
  }
}
// ---------------- penna (ritocchi a mano libera) ----------------
state.tool = 'fill';
const penOn = () => state.painting && state.tool === 'pen' && feature('feat_pen');
document.querySelectorAll('#paintTools button').forEach((b) => b.addEventListener('click', () => {
  state.tool = b.dataset.tool;
  document.querySelectorAll('#paintTools button').forEach((x) => x.classList.toggle('on', x === b));
  updatePaintUi();
}));
const showPenSize = () => { $('#penSizeOut').textContent = (+$('#penSize').value).toFixed(1).replace('.', ',') + ' mm'; };
$('#penSize').addEventListener('input', showPenSize); showPenSize();
let penStroke = null;
function penLive() {
  const svg = $('#svgHost svg');
  if (!svg) return;
  let el = svg.querySelector('#penLive');
  if (!penStroke) { if (el) el.remove(); return; }
  if (!el) { svg.insertAdjacentHTML('beforeend', '<polyline id="penLive" fill="none" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>'); el = svg.querySelector('#penLive'); }
  el.setAttribute('stroke', penStroke.hex); el.setAttribute('stroke-width', penStroke.w);
  const pts = penStroke.pts.length === 1 ? [penStroke.pts[0], [penStroke.pts[0][0] + 0.01, penStroke.pts[0][1]]] : penStroke.pts;
  el.setAttribute('points', pts.map((p) => p.join(',')).join(' '));
}
$('#svgHost').addEventListener('pointerdown', (e) => {
  if (!penOn() || !state.result || !$('#svgHost svg') || e.button === 1 || e.shiftKey) return;
  if (!state.brush) { setStatus('Scegli prima il colore della penna'); return; }
  if (touches.size > 1) return;
  e.preventDefault();
  $('#svgHost').setPointerCapture(e.pointerId);
  const m = svgPoint(e);
  penStroke = { pts: [[Math.round(m.x * 100) / 100, Math.round(m.y * 100) / 100]], w: +$('#penSize').value, hex: state.brush, id: e.pointerId };
  penLive();
});
$('#svgHost').addEventListener('pointermove', (e) => {
  if (!penStroke || e.pointerId !== penStroke.id) return;
  if (touches.size > 1) { penStroke = null; penLive(); return; } // due dita = zoom, non disegno
  const m = svgPoint(e), last = penStroke.pts[penStroke.pts.length - 1];
  if (Math.hypot(m.x - last[0], m.y - last[1]) < Math.max(0.08, penStroke.w * 0.2)) return;
  penStroke.pts.push([Math.round(m.x * 100) / 100, Math.round(m.y * 100) / 100]);
  penLive();
});
const penEnd = (e) => {
  if (!penStroke || e.pointerId !== penStroke.id) return;
  const st = penStroke;
  penStroke = null;
  swallowClick = true; setTimeout(() => { swallowClick = false; }, 0);
  const to = paintIndexFor(st.hex);
  if (to >= state.result.palette.length) state.colorOverrides[to] = st.hex;
  state.paints = [...state.paints, { pen: true, pts: st.pts, w: st.w, to, hex: st.hex }];
  sendPaints(); // il tratto disegnato resta visibile finché arriva il disegno aggiornato
};
$('#svgHost').addEventListener('pointerup', penEnd);
$('#svgHost').addEventListener('pointercancel', penEnd);

function updatePaintUi() {
  $('#paintBar').hidden = !state.result || !!state.template || !state.filaments.length;
  $('#paintPanel').hidden = !state.painting;
  $('#paintOn').hidden = state.painting;
  $('#paintUndo').disabled = !state.paints.length;
  $('#penOpts').hidden = state.tool !== 'pen';
  $('#hintFill').hidden = state.tool === 'pen';
  root.classList.toggle('paint-mode', state.painting);
  root.classList.toggle('pen-mode', penOn());
  if (state.painting) renderPaintSwatches();
}
function sendPaints() {
  setStatus('Coloro…');
  worker.postMessage({ id: ++jobId, paints: state.paints });
}
$('#paintOn').addEventListener('click', () => {
  state.painting = true; state.brush = state.brush || null;
  if (state.view === '3d') document.querySelector('.tabs button[data-view="2d"]').click();
  updatePaintUi(); renderPalette(); render();
});
$('#paintOff').addEventListener('click', () => { state.painting = false; updatePaintUi(); renderPalette(); render(); });
$('#paintUndo').addEventListener('click', () => { if (!state.paints.length) return; state.paints = state.paints.slice(0, -1); sendPaints(); });
$('#paintClear').addEventListener('click', () => {
  if (!state.result) return;
  const to = paintIndexFor(WHITE);
  if (to >= state.result.palette.length) state.colorOverrides[to] = WHITE;
  state.paints = [...state.paints, { clear: true, to, hex: WHITE }];
  state.brush = state.brush || null;
  sendPaints();
});
function paintAt(x, y) {
  if (!state.brush) { setStatus('Scegli prima il colore del pennello'); return; }
  const to = paintIndexFor(state.brush);
  if (to >= state.result.palette.length) state.colorOverrides[to] = state.brush;
  state.paints = [...state.paints, { x, y, to, hex: state.brush }];
  sendPaints();
}

// ---------------- elabora un disegno pronto (solo admin) ----------------
function updateFullDiscBtn() {
  const b = $('#fullDiscBtn');
  b.hidden = !CFG.isAdmin || !feature('feat_full_disc') || !(state.template || state.fullDisc);
  b.textContent = state.fullDisc && !state.template ? '✕ Esci dall\'elaborazione' : '⚙️ Elabora questo disegno';
  // salva nel disegno pronto: compare quando il disco è diverso da quello salvato
  const s = $('#tplSaveBtn'), fd = state.fullDisc;
  s.hidden = !CFG.isAdmin || !CFG.tplSaveUrl || !fd || !fd.id || !!state.template || !state.result;
  if (!s.hidden && !s.dataset.busy) {
    const saved = fd.saved && fd.saved === fd.cur;
    s.disabled = saved;
    s.textContent = saved ? '✓ Salvato nel disegno pronto' : '💾 Salva nel disegno pronto';
  }
}
// PNG (quello che vedranno i clienti), SVG, EPS, 3MF e progetto .francy dentro il disegno pronto
async function saveToTemplate() {
  const fd = state.fullDisc, btn = $('#tplSaveBtn');
  if (!CFG.isAdmin || !CFG.tplSaveUrl || !fd || !fd.id || !state.result) return;
  const svgNow = fd.cur;
  btn.dataset.busy = '1'; btn.disabled = true; btn.textContent = 'Salvo…';
  setStatus('Preparo PNG, EPS e 3MF del disegno…');
  try {
    const ps = parts();
    const { colors } = buildSvg(false);
    if (colors.size > MAX_FILAMENTS) throw new Error(`troppi colori (${colors.size} / ${MAX_FILAMENTS})`);
    const previewOff = await svgToPng(false);
    const mf = await make3mf(ps, previewOff, fd.name);
    const form = new FormData();
    form.append('png', await svgToPng(false, 1600, true), 'disegno.png');
    form.append('svg', new Blob([buildSvg(true).svg], { type: 'image/svg+xml' }), 'disco.svg');
    form.append('eps', new Blob([buildEps(ps, FRAME.diameter)], { type: 'application/postscript' }), 'disco.eps');
    form.append('3mf', mf.blob, 'disco-lampada.3mf');
    form.append('francy', await projectBlob(), 'progetto.francy');
    form.append('colors', JSON.stringify([...colors]));
    const r = await fetch(CFG.tplSaveUrl.replace(/\/?$/, '/') + fd.id + '/elaborato', { method: 'POST', credentials: 'same-origin', headers: CFG.nonce ? { 'X-WP-Nonce': CFG.nonce } : {}, body: form });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.message || 'errore ' + r.status);
    fd.saved = svgNow;
    // la galleria mostra subito la versione nuova
    const t = (state.templates || []).find((x) => x.id === fd.id);
    if (t && j.url) { t.url = j.url; t.thumb = j.url; t.ready = true; if (j.project) t.project = j.project; setTemplates(state.templates); }
    setStatus('Salvato nel disegno pronto: i clienti vedono questa versione, 3MF ed EPS sono in Disegni pronti');
  } catch (err) {
    console.error(err);
    setStatus('Non riesco a salvare nel disegno pronto: ' + err.message);
  } finally {
    delete btn.dataset.busy;
    updateFullDiscBtn();
  }
}
$('#tplSaveBtn').addEventListener('click', saveToTemplate);
async function enterFullDisc() {
  const t = state.template;
  if (!t) return;
  // già elaborato e salvato: riparte dal suo progetto (colori, pennello, penna…) invece che dal PNG
  if (t.project) {
    try {
      const r = await fetch(t.project, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(r.status);
      await openProject(new File([await r.blob()], 'progetto.francy'));
      if (state.fullDisc) { state.fullDisc.id = t.id; state.fullDisc.name = t.name; openStep(3); updateFullDiscBtn(); return; }
    } catch (e) { console.warn('progetto del disegno non disponibile, riparto dall\'immagine', e); }
  }
  let img;
  try { img = await loadLayerImg(t.dataUrl); } catch (e) { setStatus('Disegno non disponibile'); return; }
  $('#tplExit').click(); // esce dalla vetrina del disegno pronto
  state.fullDisc = { name: t.name, id: t.id };
  root.classList.add('full-disc');
  state.layers = []; state.layerSel = null; renderLayers();
  state.overflow = false; $('#ovOn').checked = false; updateOvUi();
  state.originalSrc = t.dataUrl; state.originalFile = null; // nello zip va come "originale" (dal data URL)
  originalImg = null; state.aiImageSrc = null; state.aiCrop = null;
  selectMode('keep'); // il disegno ha già i contorni neri
  setImage(img, 1, 0, 0);
  openStep(3);
  setStatus('Disegno pronto in elaborazione: colori, contorni, pennello e penna funzionano come sempre');
}
function exitFullDisc() {
  state.fullDisc = null;
  root.classList.remove('full-disc');
  updateFullDiscBtn();
  run();
}
$('#fullDiscBtn').addEventListener('click', () => { if (state.fullDisc && !state.template) exitFullDisc(); else enterFullDisc(); });

// ---------------- zoom dell'anteprima 2D ----------------
// viewBox in mm: x, y = angolo in alto a sinistra, w = lato (200 = tutto il disco)
state.vb = { x: -100, y: -100, w: 200 };
const ZMIN = 10, ZMAX = 200;
function zoomUnit() { return state.vb.w / 200; }
function applyZoom() {
  const svg = $('#svgHost svg');
  if (svg) svg.setAttribute('viewBox', `${state.vb.x} ${state.vb.y} ${state.vb.w} ${state.vb.w}`);
  $('#zoomLbl').textContent = Math.round(200 / state.vb.w * 100) + '%';
  root.classList.toggle('zoomed', state.vb.w < 199.9);
}
// zoom tenendo fermo il punto (cx, cy) in mm
function zoomAt(f, cx, cy) {
  const vb = state.vb, w = Math.min(ZMAX, Math.max(ZMIN, vb.w / f));
  const k = w / vb.w;
  vb.x = cx - (cx - vb.x) * k; vb.y = cy - (cy - vb.y) * k; vb.w = w;
  clampZoom();
  const old = state.vb.w;
  applyZoom();
  // maniglie e guida hanno spessori legati allo zoom: si ridisegnano
  if (state.painting) render(); else renderOverlay();
  return old;
}
function clampZoom() {
  const vb = state.vb;
  if (vb.w >= ZMAX - 0.01) { vb.x = -100; vb.y = -100; vb.w = 200; return; }
  vb.x = Math.min(100 - vb.w * 0.25, Math.max(-100 - vb.w * 0.75, vb.x));
  vb.y = Math.min(100 - vb.w * 0.25, Math.max(-100 - vb.w * 0.75, vb.y));
}
$('#zoomCtl').addEventListener('click', (e) => {
  const z = e.target.dataset && e.target.dataset.z;
  if (!z) return;
  const c = { x: state.vb.x + state.vb.w / 2, y: state.vb.y + state.vb.w / 2 };
  if (z === 'fit') { state.vb = { x: -100, y: -100, w: 200 }; applyZoom(); if (state.painting) render(); else renderOverlay(); }
  else zoomAt(z === 'in' ? 1.6 : 1 / 1.6, c.x, c.y);
});
$('#svgHost').addEventListener('wheel', (e) => {
  if (!$('#svgHost svg') || !feature('feat_zoom')) return;
  e.preventDefault();
  const m = svgPoint(e);
  zoomAt(Math.exp(-e.deltaY * 0.0018), m.x, m.y);
}, { passive: false });
// spostamento (trascinando quando si è ingranditi) e pizzico a due dita
const touches = new Map();
let pan = null, pinch = null, panSwallow = false;
$('#svgHost').addEventListener('pointerdown', (e) => {
  if (!feature('feat_zoom')) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2) {
    // due dita: zoom (annulla un eventuale spostamento di grafica in corso)
    const [a, b] = [...touches.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), w: state.vb.w };
    pan = null;
    if (stkDrag) { stkDrag = null; state.dragging = null; renderOverlay(); }
    return;
  }
  if (stkDrag || state.vb.w >= 199.9) return; // grafica afferrata, oppure non ingranditi: niente spostamento
  if (penOn() && e.button !== 1 && !e.shiftKey) return; // con la penna si disegna (spostarsi: due dita o Maiusc)
  pan = { x: e.clientX, y: e.clientY, vx: state.vb.x, vy: state.vb.y, moved: false };
});
$('#svgHost').addEventListener('pointermove', (e) => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && touches.size === 2) {
    const [a, b] = [...touches.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const svg = $('#svgHost svg'), mid = svgPoint({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
    zoomAt(state.vb.w / (pinch.w * pinch.d / d), mid.x, mid.y);
    panSwallow = true;
    return;
  }
  if (!pan) return;
  const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
  if (!pan.moved && Math.hypot(dx, dy) < 5) return;
  pan.moved = true;
  $('#svgHost').classList.add('panning');
  const svg = $('#svgHost svg'), r = svg.getBoundingClientRect(), mmpx = state.vb.w / r.width;
  state.vb.x = pan.vx - dx * mmpx; state.vb.y = pan.vy - dy * mmpx;
  clampZoom(); applyZoom();
});
const endPan = (e) => {
  touches.delete(e.pointerId);
  if (touches.size < 2) pinch = null;
  if (pan && pan.moved) panSwallow = true;
  pan = null;
  $('#svgHost').classList.remove('panning');
  if (panSwallow) setTimeout(() => { panSwallow = false; }, 0);
};
$('#svgHost').addEventListener('pointerup', endPan);
$('#svgHost').addEventListener('pointercancel', endPan);

// ---------------- grafiche aggiuntive (livelli) ----------------
const STK = Array.isArray(CFG.stickers) ? CFG.stickers : [];
if (STK.length) {
  $('#stkBox').hidden = false;
  for (const s of STK) {
    const b = document.createElement('button');
    b.type = 'button'; b.title = 'Aggiungi: ' + s.name; b.style.backgroundImage = `url("${s.thumb}")`;
    b.addEventListener('click', () => addLayer(s));
    $('#stkPick').append(b);
  }
}
let layerUid = 0;
function loadLayerImg(url) {
  return new Promise((ok, ko) => {
    const img = new Image();
    if (new URL(url, location.href).origin !== location.origin) img.crossOrigin = 'anonymous';
    img.onload = () => ok(img); img.onerror = ko; img.src = url;
  });
}
async function addLayer(s) {
  if (!state.img) { setStatus('Carica prima un\'immagine'); return; }
  let img;
  try { img = await loadLayerImg(s.url); } catch (e) { setStatus('Grafica non disponibile'); return; }
  const L = { uid: ++layerUid, id: s.id, name: s.name, url: s.url, thumb: s.thumb, x: 0, y: 0, size: 30, rot: 0, img };
  state.layers.push(L); state.layerSel = L.uid;
  if (state.view === '3d') document.querySelector('.tabs button[data-view="2d"]').click();
  renderLayers(); run();
}
const layerH = (L) => L.size * (L.img && L.img.naturalWidth ? L.img.naturalHeight / L.img.naturalWidth : 1);
function selLayer() { return state.layers.find((x) => x.uid === state.layerSel) || null; }
function renderLayers() {
  const ul = $('#stkLayers');
  ul.innerHTML = '';
  $('#stkHint').hidden = !state.layers.length;
  [...state.layers].reverse().forEach((L) => { // in alto nella lista = sopra nel disegno
    const li = document.createElement('li');
    li.className = L.uid === state.layerSel ? 'sel' : '';
    li.innerHTML = `<img alt=""><span class="nm"></span><span class="ops"><button type="button" data-a="up" title="Sopra">▲</button><button type="button" data-a="dn" title="Sotto">▼</button><button type="button" data-a="del" title="Elimina">✕</button></span>
      <span class="sl">Dim.<input type="range" min="5" max="150" step="1" data-k="size">Rot.<input type="range" min="-180" max="180" step="1" data-k="rot"></span>`;
    li.querySelector('img').src = L.thumb;
    li.querySelector('.nm').textContent = L.name;
    li.querySelector('[data-k=size]').value = L.size;
    li.querySelector('[data-k=rot]').value = L.rot;
    li.addEventListener('click', (e) => {
      const act = e.target.dataset && e.target.dataset.a;
      if (act) {
        const i = state.layers.indexOf(L);
        if (act === 'del') { state.layers.splice(i, 1); if (state.layerSel === L.uid) state.layerSel = null; }
        else if (act === 'up' && i < state.layers.length - 1) [state.layers[i], state.layers[i + 1]] = [state.layers[i + 1], state.layers[i]];
        else if (act === 'dn' && i > 0) [state.layers[i], state.layers[i - 1]] = [state.layers[i - 1], state.layers[i]];
        else return;
        renderLayers(); run(); return;
      }
      if (e.target.tagName === 'INPUT') return;
      state.layerSel = L.uid; renderLayers(); renderOverlay();
    });
    li.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('input', () => { L[inp.dataset.k] = +inp.value; state.layerSel = L.uid; state.dragging = L.uid; renderOverlay(); });
      inp.addEventListener('change', () => { state.dragging = null; run(); });
    });
    ul.append(li);
  });
}
// riquadro con maniglie sulla grafica selezionata (e l'immagine vera mentre la si sposta): solo a schermo
function overlaySvg() {
  const L = selLayer();
  if (!L || state.template) return '';
  const w = L.size, h = layerH(L), u = zoomUnit(); // u: maniglie della stessa grandezza a schermo con qualsiasi zoom
  const img = state.dragging === L.uid ? `<image href="${escapeAttr(L.url)}" x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" opacity="0.9" preserveAspectRatio="none"/>` : '';
  return `<g id="stkOverlay" transform="translate(${L.x} ${L.y}) rotate(${L.rot})">${img}
    <rect class="stk-ui" x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" fill="transparent" stroke="#f2b705" stroke-width="${0.5 * u}" stroke-dasharray="${1.5 * u} ${u}"/>
    <line x1="0" y1="${-h / 2}" x2="0" y2="${-h / 2 - 7 * u}" stroke="#f2b705" stroke-width="${0.5 * u}"/>
    <circle class="stk-rot" cx="0" cy="${-h / 2 - 7 * u}" r="${2.4 * u}" fill="#fff" stroke="#1d1b19" stroke-width="${0.5 * u}"/>
    <circle class="stk-handle" cx="${w / 2}" cy="${h / 2}" r="${2.4 * u}" fill="#f2b705" stroke="#1d1b19" stroke-width="${0.5 * u}"/></g>`;
}
function renderOverlay() {
  const svg = $('#svgHost svg');
  if (!svg) return;
  const old = svg.querySelector('#stkOverlay');
  if (old) old.remove();
  const html = overlaySvg();
  if (html) svg.insertAdjacentHTML('beforeend', html);
}
function svgPoint(e) {
  const svg = $('#svgHost svg');
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}
function hitLayer(m) {
  for (let k = state.layers.length - 1; k >= 0; k--) {
    const L = state.layers[k], a = -L.rot * Math.PI / 180;
    const dx = m.x - L.x, dy = m.y - L.y, lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= L.size / 2 && Math.abs(ly) <= layerH(L) / 2) return L;
  }
  return null;
}
let stkDrag = null, swallowClick = false;
$('#svgHost').addEventListener('pointerdown', (e) => {
  if (!state.layers.length || state.template || state.painting || state.view !== '2d' || !$('#svgHost svg')) return; // col pennello si colora
  const m = svgPoint(e), L0 = selLayer();
  let mode = null, L = null;
  if (L0) {
    const a = L0.rot * Math.PI / 180, h = layerH(L0);
    const loc = (x, y) => [L0.x + x * Math.cos(a) - y * Math.sin(a), L0.y + x * Math.sin(a) + y * Math.cos(a)];
    const u = zoomUnit();
    const [rx, ry] = loc(0, -h / 2 - 7 * u), [sx, sy] = loc(L0.size / 2, h / 2);
    if (Math.hypot(m.x - rx, m.y - ry) < 4 * u) { mode = 'rot'; L = L0; }
    else if (Math.hypot(m.x - sx, m.y - sy) < 4 * u) { mode = 'size'; L = L0; }
  }
  if (!mode) { L = hitLayer(m); if (L) mode = 'move'; }
  if (!mode) return;
  e.preventDefault();
  $('#svgHost').setPointerCapture(e.pointerId);
  state.layerSel = L.uid; state.dragging = L.uid;
  stkDrag = { mode, L, m0: m, x0: L.x, y0: L.y, s0: L.size, d0: Math.hypot(m.x - L.x, m.y - L.y) || 1, moved: false };
  renderLayers(); renderOverlay();
});
$('#svgHost').addEventListener('pointermove', (e) => {
  if (!stkDrag) return;
  const m = svgPoint(e), d = stkDrag, L = d.L, g = geometry();
  if (d.mode === 'move') {
    let x = d.x0 + m.x - d.m0.x, y = d.y0 + m.y - d.m0.y;
    const r = Math.hypot(x, y);
    if (r > g.rBandOut) { x *= g.rBandOut / r; y *= g.rBandOut / r; } // il centro resta dentro la fascia
    L.x = Math.round(x * 10) / 10; L.y = Math.round(y * 10) / 10;
  } else if (d.mode === 'size') {
    L.size = Math.round(Math.min(150, Math.max(5, d.s0 * Math.hypot(m.x - L.x, m.y - L.y) / d.d0)));
  } else {
    L.rot = Math.round(Math.atan2(m.y - L.y, m.x - L.x) * 180 / Math.PI + 90);
    if (L.rot > 180) L.rot -= 360;
  }
  d.moved = true;
  renderOverlay();
});
const endDrag = () => {
  if (!stkDrag) return;
  const moved = stkDrag.moved;
  stkDrag = null; state.dragging = null;
  swallowClick = true; setTimeout(() => { swallowClick = false; }, 0);
  renderLayers();
  if (moved) run(); else renderOverlay();
};
$('#svgHost').addEventListener('pointerup', endDrag);
$('#svgHost').addEventListener('pointercancel', endDrag);

// ---------------- sopra la fascia: interfaccia ----------------
if (CFG.overflow) $('#ovBox').hidden = false;
function updateOvUi() {
  const n = state.overflow ? state.ovSeeds.length : 0;
  $('#ovPanel').hidden = !state.overflow;
  root.classList.toggle('ov-pick', state.overflow && !state.template);
  $('#ovCount').textContent = n ? `${n} ${n === 1 ? 'parte' : 'parti'} sopra la fascia` : 'Nessuna parte scelta: tocca il disegno';
  $('#ovClear').hidden = !n;
  $('#ovWarn').hidden = !(n && state.ovTextHit) && !state.ovNote;
  $('#ovWarn').textContent = state.ovNote || "Una parte copre una scritta: sposta l'immagine, accorcia il testo o togli quella parte.";
}
$('#ovOn').addEventListener('change', () => {
  state.overflow = $('#ovOn').checked; // le parti già scelte restano (si rivedono riaccendendo)
  if (state.overflow && state.view === '3d') document.querySelector('.tabs button[data-view="2d"]').click(); // si sceglie sulla vista 2D
  updateOvUi();
  run();
});
$('#ovClear').addEventListener('click', () => {
  if (!state.resultOv) return;
  worker.postMessage({ id: ++jobId, ovSeeds: [] });
});
$('#svgHost').addEventListener('click', (e) => {
  if (swallowClick || panSwallow) return;
  if (state.layerSel && !stkDrag) { state.layerSel = null; renderLayers(); renderOverlay(); }
  if (!state.result || state.template) return;
  const svg = $('#svgHost svg');
  if (!svg) return;
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const m = pt.matrixTransform(svg.getScreenCTM().inverse());
  if (state.painting) { if (state.tool === 'pen') return; if (Math.hypot(m.x, m.y) <= geometry().rBandOut) paintAt(Math.round(m.x * 100) / 100, Math.round(m.y * 100) / 100); return; }
  if (!state.overflow || !state.resultOv) return;
  if (Math.hypot(m.x, m.y) > geometry().rBandOut) return;
  setStatus('Aggiorno…');
  worker.postMessage({ id: ++jobId, ovToggle: [Math.round(m.x * 100) / 100, Math.round(m.y * 100) / 100] });
});

// ---------------- passi (pannello sinistro a fisarmonica) ----------------
// Un passo aperto alla volta; quelli chiusi mostrano un riassunto di una riga. Il cliente può aprire
// qualsiasi passo toccandone il titolo, oppure andare avanti con "Avanti →".
const steps = () => [...document.querySelectorAll('.flc .step')].filter((x) => !x.hidden);
function openStep(n, scroll = true) {
  steps().forEach((st) => {
    const on = st.dataset.step === String(n);
    st.classList.toggle('open', on);
    st.querySelector('.step-head').setAttribute('aria-expanded', on ? 'true' : 'false');
  });
  updateSteps();
  const st = document.querySelector(`.flc .step[data-step="${n}"]`);
  if (scroll && st) {
    const panel = st.closest('.panel');
    if (panel && panel.scrollHeight > panel.clientHeight + 4 && getComputedStyle(panel).overflowY !== 'visible') panel.scrollTo({ top: st.offsetTop - panel.offsetTop - 50, behavior: 'smooth' });
    else st.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
document.querySelectorAll('.flc .step-head').forEach((h) => h.addEventListener('click', () => {
  const st = h.closest('.step');
  if (st.classList.contains('open')) { st.classList.remove('open'); h.setAttribute('aria-expanded', 'false'); updateSteps(); }
  else openStep(st.dataset.step, false);
}));
document.querySelectorAll('.flc .step-next').forEach((b) => b.addEventListener('click', () => {
  const list = steps(), i = list.indexOf(b.closest('.step'));
  if (list[i + 1]) openStep(list[i + 1].dataset.step);
}));
function bandLabel(hex) { return filamentLabel(hex) || colorNameIt(hex); }
function updateSteps() {
  const list = steps();
  const tpl = !!state.template, img = !!state.img, res = !!state.result;
  const t = texts(), words = [t.topLeft, t.topRight, t.bottomLeft, t.bottomRight].map((x) => x.trim()).filter(Boolean);
  const nColors = res ? new Set(drawingColors()).size : 0;
  const sum = {
    1: tpl ? ['✓ Disegno pronto: ' + state.template.name, true] : img ? ['✓ Immagine caricata' + ($('#portrait').checked ? ' · volto' : ''), true] : ['Carica una foto o un disegno', false],
    2: tpl ? ['Non serve con un disegno pronto', false] : state.aiImageSrc ? ['✓ Ridisegnata in stile ' + (AI_STYLE_NAMES[aiStyle] || aiStyle), true] : ['Facoltativo: fai ridisegnare la foto', false],
    3: tpl ? ['Già scelti nel disegno pronto', false] : res ? [`✓ ${nColors} colori · ${state.mode === 'keep' ? 'grafica con contorni' : 'foto o disegno'}`, true] : ['Si sistemano dopo il caricamento', false],
    4: ['Fascia ' + bandLabel(state.bandColor).toLowerCase() + (words.length ? ' · ' + words.join(', ') : ' · senza scritte') + (state.overflow && state.ovSeeds.length && !tpl ? ' · esce dal cerchio' : '') + (state.layers.length && !tpl ? ` · ${state.layers.length} ${state.layers.length === 1 ? 'grafica' : 'grafiche'}` : ''), img || tpl],
    5: [state.submitted ? '✓ Inviato' : 'Invia il disco: lo controlliamo noi', !!state.submitted],
  };
  list.forEach((st, i) => {
    st.querySelector('.step-n').textContent = String(i + 1);
    const [txt, done] = sum[st.dataset.step] || ['', false];
    st.querySelector('.step-sum').textContent = txt;
    st.classList.toggle('done', done);
  });
  // indicatore in alto
  $('#stepper').innerHTML = list.map((st, i) => `<button type="button" data-go="${st.dataset.step}" class="${st.classList.contains('open') ? 'on' : ''}${st.classList.contains('done') ? ' done' : ''}" title="${escapeAttr(st.querySelector('.step-t strong').firstChild.textContent.trim())}">${st.classList.contains('done') && !st.classList.contains('open') ? '✓' : i + 1}</button>`).join('<span></span>');
  // riepilogo nel passo Conferma
  const rows = [];
  if (tpl) rows.push(['Disegno', state.template.name]);
  else if (img) {
    rows.push(['Immagine', state.aiImageSrc ? 'ridisegnata con IA, stile ' + (AI_STYLE_NAMES[aiStyle] || aiStyle) : 'la tua foto' + ($('#portrait').checked ? ' (ritratto)' : '')]);
    if (state.aiImageSrc && state.aiBackground) rows.push(['Sfondo', state.aiBackground]);
    if (res) rows.push(['Colori', `${colorSet().size} su ${MAX_FILAMENTS} (cornice compresa)`]);
  }
  if (img || tpl) {
    rows.push(['Fascia', bandLabel(state.bandColor)]);
    rows.push(['Scritte', words.length ? words.join(' · ') : 'nessuna']);
    if (!tpl && state.layers.length) rows.push(['Grafiche', state.layers.map((x) => x.name).join(', ')]);
    if (!tpl && state.paints.length) rows.push(['Ritocchi a mano', `${state.paints.length}`]);
    if (!tpl && state.overflow && state.ovSeeds.length) rows.push(['Sopra la fascia', `${state.ovSeeds.length} ${state.ovSeeds.length === 1 ? 'parte' : 'parti'}`]);
  }
  $('#recap').innerHTML = rows.length ? rows.map(([k, v]) => `<li><span>${escapeAttr(k)}</span><strong>${escapeAttr(v)}</strong></li>`).join('') : '<li class="empty">Carica prima un\'immagine (passo 1).</li>';
}
$('#stepper').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) openStep(b.dataset.go); });
// su telefono i colori del disco stanno nel passo "Colori e contorni" (sotto l'anteprima fissa)
{
  const mq = window.matchMedia('(max-width: 980px)'), sec = $('#paletteSection'), home = sec.parentNode, next = sec.nextSibling;
  const place = () => { if (mq.matches) $('#paletteSlot').append(sec); else home.insertBefore(sec, next); };
  (mq.addEventListener ? mq.addEventListener('change', place) : mq.addListener(place));
  place();
}
openStep(1, false);

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
function svgToPng(lit, size = 1200, transparent = false) {
  const svg = state.template ? templateSvg() : buildSvg(false).svg;
  return new Promise((ok, ko) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      if (!transparent) { ctx.fillStyle = STAGE_BG; ctx.fillRect(0, 0, size, size); }
      if (lit) ctx.filter = 'brightness(1.12) saturate(1.25)';
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

// progetto Bambu Studio con parti e filamenti già assegnati (profili dal progetto modello H2C)
async function make3mf(ps, previewOff, title = 'Disco lampada FrancyStore3D') {
  const tplUrl = CFG.bambuTemplateUrl || new URL('../bambu/h2c-template.json', import.meta.url).href;
  const template = await (await fetch(tplUrl, { credentials: 'same-origin' })).json();
  const thumb = await resizePng(previewOff, 512), thumbSmall = await resizePng(previewOff, 128);
  return build3mf(ps, {
    template, white: WHITE, black: BLACK, title,
    filamentName: (h) => (state.filaments.length ? nearestFilament(h).name : ''),
    baseThickness: FRAME.baseThickness, artThickness: FRAME.artThickness, thumb, thumbSmall,
  });
}

// Disegno pronto: anteprime, PNG del disegno e riepilogo (gli STL di quel disegno li ha già l'admin)
async function buildTemplatePackage(customer) {
  const t = state.template;
  const previewOff = await svgToPng(false), previewLit = await svgToPng(true);
  const slugName = t.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'disegno';
  const summary = { creato: new Date().toISOString(), cliente: customer, template: { id: t.id, name: t.name }, colori: [], lampada: lampSummary() };
  const lines = [
    'FrancyStore3D - disco lampada (disegno pronto dalla galleria)', '',
    `Cliente: ${customer.name} <${customer.email}>${customer.phone ? ' tel. ' + customer.phone : ''}`,
    customer.note ? `Note: ${customer.note}` : '',
    `Disegno pronto: ${t.name} (ID ${t.id})`, '',
    t.ready ? 'Il cliente non ha modificato il disegno: i file di stampa (3MF, EPS) sono in Disegni pronti → ' + t.name + '.'
      : 'Il cliente non ha modificato il disegno: usa i tuoi file di stampa di questo disegno.',
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
    bambu = await make3mf(ps, previewOff);
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
    lampada: lampSummary(),
    impostazioni: { modalita: state.mode, ritratto: $('#portrait').checked, colori: +$('#colors').value, luminosita: adjust.b, contrasto: adjust.c, saturazione: adjust.s, disegno_pronto_elaborato: state.fullDisc ? state.fullDisc.name : null, sopra_fascia: state.overflow ? state.ovSeeds.length : 0, grafiche: state.layers.map((x) => ({ id: x.id, nome: x.name, x: x.x, y: x.y, larghezza_mm: x.size, rotazione: x.rot })), ia: !!state.aiImageSrc, stile_ia: state.aiImageSrc ? aiStyle : null, sfondo_ia: state.aiImageSrc ? (state.aiBackground || 'originale') : null, fornitore_ia: state.aiProvider || null },
  };
  const lines = [
    'FrancyStore3D - disco lampada personalizzato', '',
    `Cliente: ${customer.name} <${customer.email}>${customer.phone ? ' tel. ' + customer.phone : ''}`,
    customer.note ? `Note: ${customer.note}` : '', '',
    'FILAMENTI DA USARE', ...colors.map((e) => `- ${e.hex}  ${e.filament || '(nessun catalogo)'}  →  ${e.roles.join(', ')}${e.area ? `  (${e.area} mm² nel disegno)` : ''}`), '',
    ...stlReadme({ baseThickness: FRAME.baseThickness, artThickness: FRAME.artThickness }),
    ...stl.list.map((l) => `  ${l.file}  ${l.color}${l.filament ? '  ' + l.filament : ''}`), '',
    ...(bambu ? ['PROGETTO BAMBU STUDIO (05_bambu/disco-lampada.3mf)', 'Apri il file con Bambu Studio: parti, colori degli slot e ugelli sono già assegnati.', ...bambu.list.map((l) => `  filamento ${l.filament}${l.filament === 1 ? ' (ugello 1, bobina fissa)' : ' (ugello 2, AMS)'}: ${l.part}`), ''] : []),
    ...(lampSummary().length ? ['PEZZI DELLA LAMPADA', ...lampSummary().map((l) => `- ${l.parte}: ${l.colore}${l.filamento ? '  ' + l.filamento : ''}${l.scelto_dal_cliente ? '  (scelto dal cliente)' : ''}`), ''] : []),
    'Cartelle: 01_anteprime, 02_immagini (originale, eventuale ridisegno IA, ritaglio usato), 03_vettoriale (SVG, EPS), 04_stl, 05_bambu (progetto .3mf).',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '');
  files.push({ name: 'LEGGIMI-filamenti.txt', data: enc(lines.join('\r\n') + '\r\n') });
  files.push({ name: 'riepilogo.json', data: enc(JSON.stringify(summary, null, 2)) });
  return { zip: await zipAsync(files), previewOff, previewLit, summary };
}

// ---------------- convalida (il cliente approva, i file vanno all'admin) ----------------
// file e download diretti: solo admin (per gli altri il blocco non arriva nemmeno dal server)
if (!CFG.isAdmin && $('#adminFiles')) $('#adminFiles').remove();
// anteprima da scaricare per tutti (con watermark), se permesso nelle impostazioni
$('#shareBox').hidden = !(CFG.watermark && CFG.watermark.download);
function setDisabled(map) { for (const [id, v] of Object.entries(map)) { const el = document.getElementById(id); if (el) el.disabled = v; } }
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
    state.submitted = true; updateSteps();
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
// --- download riservati all'admin (anche se qualcuno riattiva i pulsanti, senza permesso non fanno nulla) ---
function onAdmin(id, fn) { const el = document.getElementById(id); if (el) el.addEventListener('click', () => { if (CFG.isAdmin) fn(el); }); }
onAdmin('dlSvg', () => {
  download('disco-lampada-francy.svg', new Blob([buildSvg(true).svg], { type: 'image/svg+xml' }));
});
onAdmin('dlStl', async (btn) => {
  const label = btn.textContent;
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
onAdmin('dlPng', async () => {
  download(state.view === '3d' && preview3d ? 'anteprima-lampada-3d.png' : 'anteprima-lampada.png', await previewPng(false));
});
// --- anteprima per il cliente: sempre con watermark ---
$('#dlPreview').addEventListener('click', async () => {
  download('lampada-francystore3d.png', await previewPng(true));
});

// PNG dell'anteprima attuale (2D o 3D), con o senza watermark
async function previewPng(withWatermark) {
  let blob;
  if (state.view === '3d' && preview3d) blob = await (await fetch(preview3d.snapshot())).blob();
  else blob = await svgToPng(state.lit);
  if (!withWatermark || !CFG.watermark) return blob;
  // versione per il cliente: ridotta (lato lungo massimo dalle impostazioni) e con watermark
  const img = await createImageBitmap(blob);
  const k = Math.min(1, (+CFG.watermark.max || 640) / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  await paintWatermark(ctx, c.width, c.height);
  return new Promise((ok) => c.toBlob(ok, 'image/png'));
}

// ---------------- watermark ----------------
// Tessera ripetuta: immagine (logo) oppure testo, ruotata; trasparenza e dimensione dalle impostazioni
let wmTileCache = null;
async function watermarkTile() {
  if (wmTileCache) return wmTileCache;
  const wm = CFG.watermark, px = 320;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d');
  ctx.translate(px / 2, px / 2);
  ctx.rotate(((+wm.angle || 0) * Math.PI) / 180);
  let drawn = false;
  if (wm.image) {
    try {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      await new Promise((ok, ko) => { im.onload = ok; im.onerror = ko; im.src = wm.image; });
      const k = (px * 0.62) / Math.max(im.width, im.height), w = im.width * k, h = im.height * k;
      if (wm.tint) {
        const t = document.createElement('canvas');
        t.width = Math.ceil(w); t.height = Math.ceil(h);
        const tc = t.getContext('2d');
        tc.drawImage(im, 0, 0, w, h);
        tc.globalCompositeOperation = 'source-in';
        tc.fillStyle = wm.color; tc.fillRect(0, 0, t.width, t.height);
        ctx.drawImage(t, -w / 2, -h / 2);
      } else {
        ctx.drawImage(im, -w / 2, -h / 2, w, h);
      }
      drawn = true;
    } catch (e) { console.error('Watermark: immagine non caricata', e); }
  }
  if (!drawn) {
    const text = wm.text || 'FrancyStore3D';
    let fs = px * 0.16;
    ctx.font = `800 ${fs}px system-ui, sans-serif`;
    const tw = ctx.measureText(text).width;
    if (tw > px * 0.92) { fs *= (px * 0.92) / tw; ctx.font = `800 ${fs}px system-ui, sans-serif`; }
    ctx.fillStyle = wm.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
  }
  wmTileCache = c;
  return c;
}
async function paintWatermark(ctx, w, h) {
  const tile = await watermarkTile(), wm = CFG.watermark;
  const size = Math.max(40, w * (+wm.size || 0.22));
  ctx.save();
  ctx.globalAlpha = +wm.opacity || 0.18;
  for (let y = 0; y < h; y += size) for (let x = (Math.floor(y / size) % 2) * size / 2 - size / 2; x < w; x += size) ctx.drawImage(tile, x, y, size, size);
  ctx.restore();
}
// sopra l'anteprima a schermo (2D e 3D): strato trasparente che non blocca i clic
async function showScreenWatermark() {
  const wm = CFG.watermark, el = $('#wmOverlay');
  if (!wm || !wm.screen) return;
  const tile = await watermarkTile();
  el.style.backgroundImage = `url(${tile.toDataURL('image/png')})`;
  el.style.backgroundSize = `${(+wm.size || 0.22) * 100}% auto`;
  el.style.opacity = +wm.opacity || 0.18;
  el.hidden = false;
}
showScreenWatermark();

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
  if (+t.size >= 35 && +t.size <= 85) { $('#textSize').value = +t.size; showTextSize(); }
}

// footer: anno sempre aggiornato e link alle policy dalle impostazioni
$('#footYear').textContent = new Date().getFullYear();
if (CFG.copyrightName) $('#footName').textContent = CFG.copyrightName;
$('#footVer').textContent = 'Powered by FrancyStore3D' + (CFG.version ? ' v' + CFG.version : '');
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
// pezzi della lampada (Impostazioni → Lampada 3D); ?lampada=manifest.json solo per le prove
function lampConfig() { return CFG.lamp ? { ...CFG.lamp, nonce: CFG.nonce } : null; }
state.lampColors = {};
// colori dei pezzi che il cliente può cambiare (solo tra quelli ammessi nelle impostazioni)
function renderLampPickers() {
  const host = $('#lampPickers');
  host.innerHTML = '';
  for (const p of (CFG.lamp && CFG.lamp.parts) || []) {
    if (!p.choice || !p.choices.length) continue;
    const current = (state.lampColors[p.id] || p.color).toLowerCase();
    const box = document.createElement('div');
    box.className = 'picker';
    box.innerHTML = `<span class="picker-label">Colore ${escapeAttr(p.name.toLowerCase())}</span><div class="swatches"></div>`;
    for (const c of p.choices) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (c.toLowerCase() === current ? ' active' : '');
      b.style.background = c;
      b.title = (CFG.isAdmin ? lampFilamentName(c.toLowerCase()) : lampFilamentLabel(c.toLowerCase())) || c;
      b.addEventListener('click', () => {
        state.lampColors[p.id] = c.toLowerCase();
        if (preview3d) preview3d.setLampColors(state.lampColors);
        renderLampPickers();
      });
      box.querySelector('.swatches').append(b);
    }
    host.append(box);
  }
}
// nome della bobina di un pezzo: prima le bobine speciali (silk, metal), poi il catalogo del disco
function lampFilamentName(hex) {
  const sp = (CFG.filamentsSpecial || []).find((f) => f.hex.toLowerCase() === hex);
  if (sp) return sp.name || sp.tok;
  return state.filaments.length ? nearestFilament(hex).name : '';
}
function lampFilamentLabel(hex) {
  const sp = (CFG.filamentsSpecial || []).find((f) => f.hex.toLowerCase() === hex);
  return sp ? sp.label || '' : filamentLabel(hex);
}
// riepilogo dei pezzi della lampada con il colore da stampare
function lampSummary() {
  return ((CFG.lamp && CFG.lamp.parts) || []).map((p) => {
    const c = (state.lampColors[p.id] || p.color).toLowerCase();
    return { parte: p.name, colore: c, filamento: lampFilamentName(c), materiale: p.material, scelto_dal_cliente: !!state.lampColors[p.id] };
  });
}
if (qp.get('lampada')) fetch(qp.get('lampada')).then((r) => r.json()).then((l) => { CFG.lamp = l; renderLampPickers(); }).catch(console.error);
renderLampPickers();

if (qp.get('esempi')) fetch(qp.get('esempi')).then((r) => r.json()).then((ex) => { state.examples = ex; showExample(); }).catch(console.error); // solo per le prove
if (qp.get('tpl')) fetch(qp.get('tpl')).then((r) => r.json()).then(setTemplates).catch(console.error); // solo per le prove
if (qp.get('cat')) fetch(qp.get('cat')).then((r) => r.json()).then(setFilaments).catch(console.error); // solo per le prove
updateColorLimit();
render();

// Per i test: ?img=percorso carica subito un'immagine
if (qp.get('img')) loadImage(qp.get('img'), +qp.get('zoom') || 1);
if (qp.get('mode') === 'keep') document.querySelector('#mode button[data-mode=keep]').click();

// solo per i test automatici (window.FRANCY_LAMP.debug): accesso allo stato interno
if (CFG.debug) window.__flc = { state, parts, svgToPolys, tracedToPolys, minusOverflow, polygonClipping, geometry };

// ---------------- funzioni spente dall'admin ----------------
{
  const off = (sel, k) => { if (feature(k)) return; document.querySelectorAll(sel).forEach((el) => el.setAttribute('data-feat-off', '')); };
  off('#adjustBox', 'feat_upload_adjust');
  off('.portrait-row', 'feat_portrait');
  off('#mode', 'feat_mode');
  if (!feature('feat_convert')) [$('#colors'), $('#line')].forEach((el) => el.closest('label').setAttribute('data-feat-off', ''));
  if (!feature('feat_convert')) ['#addRow', '#thickRow'].forEach((id) => $(id).setAttribute('data-feat-off', ''));
  if (!feature('feat_advanced')) $('#smooth').closest('details').setAttribute('data-feat-off', '');
  off('#paintBar', 'feat_paint');
  off('#toolPen', 'feat_pen');
  off('#paintClear', 'feat_clear');
  off('#bandPicker', 'feat_band_color');
  off('#textPicker', 'feat_text_color');
  off('#lampPickers', 'feat_lamp_colors');
  if (!feature('feat_texts')) { $('.texts').setAttribute('data-feat-off', ''); $('.texts').previousElementSibling.setAttribute('data-feat-off', ''); }
  off('.text-pos', 'feat_text_pos');
  if (!feature('feat_text_size')) $('#textSize').closest('label').setAttribute('data-feat-off', '');
  off('#stkBox', 'feat_stickers');
  off('#zoomCtl', 'feat_zoom');
  off('.tabs', 'feat_3d');
  off('.lit-toggle', 'feat_lit');
  off('#submitBox', 'feat_submit');
}

// ---------------- progetto .francy: salva e riapri tutto il lavoro ----------------
// Un file JSON compresso (gzip) con dentro le immagini (originale, ridisegno IA, grafiche) e tutte le scelte.
// Riaprendolo il configuratore riparte da dove si era rimasti. Indipendente dal sito (niente dati sul server).
const blobToDataUrl = (blob) => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r.readAsDataURL(blob); });
async function srcToDataUrl(src) {
  if (!src) return null;
  if (src.startsWith('data:')) return src;
  return blobToDataUrl(await (await fetch(src, { credentials: 'same-origin' })).blob());
}
const loadImg = (src) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });
const ctrlIds = ['colors', 'line', 'thick', 'smooth', 'feat', 'area', 'ppmm'];
function projectName() {
  const t = texts();
  const base = (state.template && state.template.name) || (state.fullDisc && state.fullDisc.name) || [t.topLeft, t.topRight, t.bottomLeft, t.bottomRight].find((x) => x.trim()) || 'progetto';
  const d = new Date(), pad = (n) => String(n).padStart(2, '0');
  return base.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40)
    + `-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.francy`;
}
async function projectBlob() {
  const P = { app: 'francy-lamp', v: 1, saved: new Date().toISOString() };
  if (state.template) P.template = { id: state.template.id, name: state.template.name, dataUrl: state.template.dataUrl };
  else {
    P.image = state.originalFile ? await blobToDataUrl(state.originalFile) : await srcToDataUrl(state.originalSrc);
    P.imageName = state.originalFile ? state.originalFile.name : 'originale';
    if (state.aiImageSrc && originalImg) P.ai = { image: await srcToDataUrl(state.aiImageSrc), style: aiStyle, background: state.aiBackground || null, provider: state.aiProvider || '', crop: state.aiCrop, orig: { zoom: originalImg.zoom, ox: originalImg.ox, oy: originalImg.oy, mode: originalImg.mode, adj: originalImg.adj } };
    P.view = { zoom: state.zoom, ox: state.ox, oy: state.oy };
    P.adjust = { ...adjust };
    P.mode = state.mode; P.seed = state.seed; P.portrait = $('#portrait').checked;
    P.controls = Object.fromEntries(ctrlIds.map((id) => [id, +$('#' + id).value]));
    P.addOutlines = $('#addOutlines').checked;
    P.fullDisc = state.fullDisc ? { name: state.fullDisc.name, id: state.fullDisc.id || null } : null;
    P.overflow = state.overflow; P.ovSeeds = state.ovSeeds;
    P.paints = state.paints; P.locks = state.locks; P.centers = state.centers || null;
    P.layers = await Promise.all(state.layers.map(async (L) => ({ id: L.id, name: L.name, image: await srcToDataUrl(L.url), x: L.x, y: L.y, size: L.size, rot: L.rot })));
  }
  P.band = state.bandColor; P.textColor = state.textColor;
  P.texts = { tl: $('#tTL').value, tr: $('#tTR').value, bl: $('#tBL').value, br: $('#tBR').value, pTL: +$('#pTL').value, pTR: +$('#pTR').value, pBL: +$('#pBL').value, pBR: +$('#pBR').value, size: +$('#textSize').value };
  P.lampColors = state.lampColors || {};
  P.lit = state.lit;
  let blob = new Blob([JSON.stringify(P)], { type: 'application/json' });
  if (typeof CompressionStream !== 'undefined') blob = await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
  return blob;
}
async function saveProject() {
  if (!state.img && !state.template) return;
  setStatus('Preparo il file del progetto…');
  try {
    download(projectName(), await projectBlob());
    setStatus('Progetto salvato: riaprilo con 📂 Apri per riprendere da qui');
  } catch (err) { console.error(err); setStatus('Non riesco a salvare il progetto'); }
}
async function openProject(file) {
  setStatus('Apro il progetto…');
  let P;
  try {
    let buf = new Uint8Array(await file.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    P = JSON.parse(new TextDecoder().decode(buf));
    if (P.app !== 'francy-lamp') throw new Error('non è un progetto Francy');
  } catch (err) { setStatus('File non valido: ' + err.message); return; }
  try {
    // scritte, fascia e lampada valgono anche per i disegni pronti
    const applyFrame = () => {
      const t = P.texts || {};
      for (const [id, k] of [['tTL', 'tl'], ['tTR', 'tr'], ['tBL', 'bl'], ['tBR', 'br']]) if (typeof t[k] === 'string') $('#' + id).value = t[k];
      for (const id of ['pTL', 'pTR', 'pBL', 'pBR']) if (t[id] !== undefined) $('#' + id).value = t[id];
      if (t.size) { $('#textSize').value = t.size; showTextSize(); }
      if (P.band) state.bandColor = P.band;
      if (P.textColor) state.textColor = P.textColor;
      state.lampColors = P.lampColors || {};
      if (typeof renderLampPickers === 'function') renderLampPickers();
      if (preview3d) preview3d.setLampColors(state.lampColors);
      if (!!P.lit !== state.lit) document.querySelector(`.lit-toggle button[data-lit="${P.lit ? 1 : 0}"]`).click();
    };
    if (P.template) {
      if (state.template) $('#tplExit').click();
      await selectTemplate({ id: P.template.id, name: P.template.name, url: P.template.dataUrl, thumb: P.template.dataUrl });
      applyFrame(); render(); openStep(5);
      setStatus('Progetto riaperto');
      return;
    }
    if (state.template) $('#tplExit').click();
    const orig = await loadImg(P.image);
    const blob = await (await fetch(P.image)).blob();
    state.originalFile = new File([blob], P.imageName || 'originale.jpg', { type: blob.type });
    state.originalSrc = P.image;
    state.locks = P.locks || [];
    state.paints = P.paints || [];
    state.restoreCenters = P.centers || null;
    state.fullDisc = P.fullDisc || null;
    root.classList.toggle('full-disc', !!state.fullDisc);
    state.overflow = !!P.overflow; $('#ovOn').checked = state.overflow; state.ovSeeds = P.ovSeeds || [];
    // ridisegno IA: la foto originale resta per "Torna all'immagine originale" e per i nuovi ridisegni
    if (P.ai) {
      const aiImg = await loadImg(P.ai.image);
      originalImg = { img: orig, zoom: P.ai.orig.zoom, ox: P.ai.orig.ox, oy: P.ai.orig.oy, mode: P.ai.orig.mode, adj: P.ai.orig.adj };
      state.aiImageSrc = P.ai.image; state.aiCrop = P.ai.crop; state.aiProvider = P.ai.provider || ''; state.aiBackground = P.ai.background || null;
      const sb = document.querySelector(`#aiStyle button[data-style="${P.ai.style}"]`);
      if (sb) { aiStyle = P.ai.style; document.querySelectorAll('#aiStyle button').forEach((x) => x.classList.toggle('active', x === sb)); }
      state.img = aiImg;
      $('#aiUndo').hidden = false;
    } else {
      originalImg = null; state.aiImageSrc = null; state.aiCrop = null;
      state.img = orig;
      $('#aiUndo').hidden = true;
    }
    state.zoom = P.view.zoom; state.ox = P.view.ox; state.oy = P.view.oy; $('#zoom').value = state.zoom;
    state.imgId = (state.imgId || 0) + 1;
    state.seed = P.seed || 1;
    setAdjust(P.adjust || { b: 0, c: 0, s: 0 });
    setPortrait(!!P.portrait);
    for (const id of ctrlIds) if (P.controls && P.controls[id] !== undefined) { $('#' + id).value = P.controls[id]; if (sliders[id]) $('#' + sliders[id]).textContent = P.controls[id]; }
    $('#addOutlines').checked = P.addOutlines !== false;
    // grafiche aggiuntive
    state.layers = [];
    for (const L of P.layers || []) {
      try { const img = await loadImg(L.image); state.layers.push({ uid: ++layerUid, id: L.id, name: L.name, url: L.image, thumb: L.image, x: L.x, y: L.y, size: L.size, rot: L.rot, img }); } catch (e) { /* grafica illeggibile: si salta */ }
    }
    state.layerSel = null; renderLayers();
    applyFrame();
    updateOvUi(); updateAiBtn();
    document.querySelectorAll('#mode button').forEach((x) => x.classList.toggle('active', x.dataset.mode === P.mode));
    state.mode = P.mode;
    $('#addRow').hidden = state.mode !== 'keep';
    $('#lineRow').hidden = state.mode === 'keep' && !$('#addOutlines').checked;
    $('#thickRow').hidden = state.mode === 'outline';
    $('#aiBtn').disabled = !!state.aiExhausted;
    drawCrop(); run();
    openStep(5);
    setStatus('Progetto riaperto: riprendi da dove eri rimasto');
  } catch (err) { console.error(err); setStatus('Non riesco ad aprire il progetto'); }
}
if (feature('feat_project')) {
  $('#projSave').addEventListener('click', saveProject);
  $('#projOpen').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openProject(f); });
} else $('#projBtns').setAttribute('data-feat-off', '');

// ---------------- guida: ❓ Guida in alto e i "?" accanto ai comandi ----------------
// [selettore, titolo, spiegazione, dove mettere il ? ('end' = in fondo all'elemento, 'after' = subito dopo)]
const HELP = [
  ['.upload > span', 'Carica un\'immagine', 'Foto o disegno dal tuo dispositivo. Vengono meglio i disegni a colori pieni con contorni neri; le foto conviene ridisegnarle con l\'IA (passo 2).', 'end', 'img'],
  ['#adjustBox > summary', 'Regola immagine', 'Luminosità, contrasto e saturazione della tua immagine prima della conversione. Più contrasto e saturazione = colori più separati.', 'end', 'img'],
  ['.portrait-switch', 'È un volto', 'Accendilo per i ritratti: la pelle ha 3 toni dedicati e occhi, sopracciglia e bocca vengono protetti anche se piccoli.', 'end', 'img'],
  ['#aiStyle button[data-style="fedele"]', 'Fedele', 'Ridisegna la foto mantenendo posa, espressione e colori, con contorni neri e colori pieni.', 'end', 'ai'],
  ['#aiStyle button[data-style="ritratto"]', 'Ritratto', 'Per le persone: un ritratto pop-art con pochi colori decisi.', 'end', 'ai'],
  ['#aiStyle button[data-style="tombino"]', 'Tombino', 'Lo stile dei tombini decorati giapponesi (Poké Lids): disegno piatto e pulito, perfetto per il disco.', 'end', 'ai'],
  ['#aiStyle button[data-style="anime"]', 'Anime', 'Ridisegna la foto come un personaggio di un cartone animato giapponese.', 'end', 'ai'],
  ['#aiCardRow .switch', 'Carta da gioco', 'Se hai fotografato una carta (es. Pokémon), l\'IA tiene solo l\'illustrazione e toglie cornice e scritte.', 'end', 'ai'],
  ['#aiBgRow .switch', 'Sfondo', 'Toglie lo sfondo della foto e ne mette uno nuovo a scelta (o descritto da te).', 'end', 'ai'],
  ['#mode button[data-mode="outline"]', 'Foto o disegno', 'Per immagini senza contorni neri: il configuratore li crea da solo tra un colore e l\'altro.', 'end', 'colors'],
  ['#mode button[data-mode="keep"]', 'Grafica con contorni', 'Per disegni che hanno già le linee nere (anche quelli dell\'IA): le tiene e colora le zone tra le linee. È la scelta migliore nella maggior parte dei casi.', 'end', 'colors'],
  ['#colorsOut', 'Colori', 'Quanti colori usare per il disegno. Più colori = più dettagli, ma servono più bobine (massimo 13 in tutto, compresi bianco e nero).', 'label', 'colors'],
  ['#addRow', 'Contorni dove mancano', 'Aggiunge le linee nere tra i colori che non le hanno già.', 'end', 'colors'],
  ['#lineOut', 'Spessore contorni', 'Quanto sono spesse le linee nere, in millimetri. Sotto 1 mm i dettagli piccoli rischiano di sparire in stampa.', 'label', 'colors'],
  ['#thickOut', 'Ingrossa il nero', 'Rende un po\' più spesse le linee nere già presenti nel disegno, così si stampano bene.', 'label', 'colors'],
  ['#advSummary', 'Regolazioni avanzate', 'Controlli fini della conversione: quanto semplificare il disegno, quanto piccoli possono essere dettagli e zone, la precisione del calcolo.', 'end', 'colors'],
  ['#smoothOut', 'Semplificazione', 'Quanto vengono ammorbiditi i bordi e unite le macchioline. Più alta = disegno più pulito e meno dettagliato.', 'label', 'colors'],
  ['#featOut', 'Dettaglio minimo', 'La larghezza minima (mm) di una parte colorata: le parti più strette spariscono nel colore vicino.', 'label', 'colors'],
  ['#areaOut', 'Area minima zona', 'Le zone più piccole di questa superficie (mm²) vengono assorbite da quelle vicine.', 'label', 'colors'],
  ['#ppmmOut', 'Risoluzione', 'Pixel per millimetro usati nella conversione: più alta = bordi più precisi, calcolo più lento.', 'label', 'colors'],
  ['#reseed', 'Altra combinazione', 'Ricalcola la scelta dei colori in un altro modo: utile se due colori importanti sono finiti insieme.', 'after', 'colors'],
  ['#ovBox .switch', 'Sopra la fascia', 'Fai uscire dal cerchio alcune parti del disegno (un orecchio, una coda…) come nei tombini veri: tocca le parti sull\'anteprima.', 'end', 'frame'],
  ['#stkBox .picker-label', 'Grafiche aggiuntive', 'Aggiungi un elemento (es. una Poké Ball) da spostare, ingrandire e ruotare sul disegno.', 'end', 'frame'],
  ['#bandPicker .picker-label', 'Colore fascia', 'Il colore dell\'anello dove stanno le scritte. Usare un colore già presente nel disegno non aggiunge bobine.', 'end', 'frame'],
  ['#textPicker .picker-label', 'Colore scritte', 'Il colore delle lettere sulla fascia.', 'end', 'frame'],
  ['#textsLabel', 'Scritte', 'Fino a 4 scritte: 2 sopra e 2 sotto. Lo slider sotto ogni scritta la fa scorrere lungo la fascia; lascia vuoto per non metterla.', 'text', 'frame'],
  ['#textSizeOut', 'Dimensione scritte', 'L\'altezza di tutte le lettere. Un testo troppo lungo si rimpicciolisce da solo.', 'label', 'frame'],
  ['#paletteSection > h2', 'Colori del disco', 'Tutte le bobine del tuo disco con la superficie di ognuna. Tocca un colore per sostituirlo, 🗑 per toglierlo (diventa bianco), 🔒 indica una scelta tua.', 'end', 'palette'],
  ['#paintOn', 'Colora a mano', 'Scegli un colore e tocca le zone dell\'anteprima per ricolorarle (🪣 secchiello) oppure disegna piccoli dettagli (✏️ penna).', 'after', 'paint'],
  ['.lit-toggle', 'Spenta / Accesa', 'Guarda come appare la lampada con la luce spenta o accesa.', 'after', 'preview'],
  ['.tabs', 'Anteprima 2D / 3D', '2D: il disco piatto, dove tocchi e colori. 3D: la lampada intera da girare con il mouse.', 'end', 'preview'],
  ['#projBtns', 'Salva / Apri', 'Salva scarica un file .francy con tutto il lavoro; Apri lo ricarica e riprendi da dove eri rimasto.', 'end', 'project'],
];
function initHelp() {
  const pop = $('#helpPop');
  let openBtn = null;
  const close = () => { pop.hidden = true; if (openBtn) openBtn.classList.remove('open'); openBtn = null; };
  const show = (btn, title, text, sec) => {
    if (openBtn === btn) return close();
    close();
    pop.replaceChildren(Object.assign(document.createElement('strong'), { textContent: title }), document.createTextNode(text));
    if (sec && document.getElementById('guida-' + sec)) {
      const more = document.createElement('button');
      more.type = 'button'; more.className = 'help-more'; more.textContent = 'Approfondisci nella guida →';
      more.addEventListener('click', () => { close(); openWiki(sec); });
      pop.append(more);
    }
    pop.hidden = false;
    const r = btn.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8));
    const top = r.bottom + 8 + h < innerHeight ? r.bottom + 8 : Math.max(8, r.top - h - 8);
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
    btn.classList.add('open'); openBtn = btn;
  };
  for (const [sel, title, text, where, sec] of HELP) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const q = document.createElement('button');
    q.type = 'button'; q.className = 'help-q'; q.textContent = '?';
    q.setAttribute('aria-label', 'Cos\'è: ' + title);
    // dentro label e pulsanti il ? non deve attivare l'interruttore o il pulsante
    q.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); show(q, title, text, sec); });
    q.addEventListener('pointerdown', (e) => e.stopPropagation());
    if (where === 'label') {
      // slider: il ? va subito dopo il nome (es. "Colori ?"), non in una riga a sé
      const row = el.closest('.row'), t = row && [...row.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      if (!t) { el.after(q); continue; }
      const span = document.createElement('span');
      span.className = 'row-t'; span.textContent = t.textContent.trim();
      t.replaceWith(span); span.append(q);
    } else if (where === 'text') {
      // subito dopo il primo testo dell'elemento (es. "Scritte sulla fascia ?" prima della nota piccola)
      const t = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      if (t) { t.textContent = t.textContent.replace(/\s+$/, ''); t.after(q, document.createTextNode(' ')); } else el.append(q);
    } else if (where === 'after') el.after(q);
    else if (where === 'before') el.before(q);
    else el.append(q);
  }
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); if (!$('#wiki').hidden && $('#tplModal').hidden) closeWiki(); } });
  document.addEventListener('scroll', close, true);
  // guida completa (al posto dell'anteprima); il pulsante pulsa alla prima visita
  buildWiki();
  const btn = $('#helpBtn');
  btn.addEventListener('click', () => {
    if ($('#wiki').hidden) openWiki(); else closeWiki();
    btn.classList.remove('pulse');
    try { localStorage.setItem('flcHelpSeen', '1'); } catch (e) { /* facoltativo */ }
  });
  let seen = false;
  try { seen = localStorage.getItem('flcHelpSeen') === '1'; } catch (e) { /* facoltativo */ }
  if (!seen) btn.classList.add('pulse');
}

// ---------------- guida stile wiki: indice a sinistra, sezioni a destra, ricerca ----------------
function buildWiki() {
  const ctx = {
    ai: !$('#stepAi').hidden || !!CFG.restUrl, admin: !!CFG.isAdmin, feature,
  };
  const has = {
    tpl: () => (state.templates || []).length > 0, overflow: () => !!CFG.overflow, stickers: () => (CFG.stickers || []).length > 0,
    lamp: () => !!(CFG.lamp && (CFG.lamp.parts || []).some((p) => p.choice && p.choices && p.choices.length)),
  };
  const nav = $('#wikiNav'), body = $('#wikiBody');
  nav.innerHTML = ''; body.innerHTML = '';
  for (const g of GUIDE) {
    if (g.show && !g.show(ctx)) continue;
    const sec = document.createElement('section');
    sec.id = 'guida-' + g.id; sec.className = 'wiki-sec';
    // titoli con elementi propri (non h3/h4): il CSS del tema del sito non li tocca
    sec.innerHTML = `<div class="w-title" role="heading" aria-level="3"><span aria-hidden="true">${g.icon}</span> ${g.title}</div>`
      + g.html.replace(/<h4(\s[^>]*)?>/g, (m, at) => `<div class="w-sub" role="heading" aria-level="4"${at || ''}>`).replace(/<\/h4>/g, '</div>');
    sec.querySelectorAll('[data-feat]').forEach((el) => { if (!feature(el.dataset.feat)) el.remove(); });
    sec.querySelectorAll('[data-show]').forEach((el) => { if (el.isConnected && has[el.dataset.show] && !has[el.dataset.show]()) el.remove(); });
    body.append(sec);
    const a = document.createElement('button');
    a.type = 'button'; a.dataset.sec = g.id;
    a.innerHTML = `<span aria-hidden="true">${g.icon}</span> ${g.title}`;
    a.addEventListener('click', () => goWiki(g.id));
    nav.append(a);
  }
  // link interni (#guida-…) dentro il testo
  body.addEventListener('click', (e) => {
    const l = e.target.closest('a[href^="#guida-"]');
    if (l) { e.preventDefault(); goWiki(l.getAttribute('href').slice(7)); }
  });
  // sezione attiva nell'indice mentre si scorre
  body.addEventListener('scroll', () => {
    const top = body.getBoundingClientRect().top + 40;
    let cur = null;
    for (const s of body.querySelectorAll('.wiki-sec:not([hidden])')) if (s.getBoundingClientRect().top <= top) cur = s.id.slice(6);
    if (!cur) { const f = body.querySelector('.wiki-sec:not([hidden])'); cur = f && f.id.slice(6); }
    nav.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.sec === cur));
  }, { passive: true });
  // ricerca: mostra solo le sezioni che contengono tutte le parole
  let t;
  $('#wikiSearch').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      const words = norm(e.target.value).split(/\s+/).filter(Boolean);
      let any = false;
      body.querySelectorAll('.wiki-sec').forEach((s) => {
        const ok = words.every((w) => norm(s.textContent).includes(w));
        s.hidden = !ok; any = any || ok;
        const b = nav.querySelector(`[data-sec="${s.id.slice(6)}"]`); if (b) b.hidden = !ok;
      });
      let none = body.querySelector('.wiki-none');
      if (!any && !none) { none = document.createElement('p'); none.className = 'wiki-none hint'; none.textContent = 'Nessun risultato: prova con un\'altra parola.'; body.prepend(none); }
      if (none) none.hidden = any;
      body.scrollTop = 0;
      body.dispatchEvent(new Event('scroll'));
    }, 120);
  });
  $('#wikiClose').addEventListener('click', closeWiki);
}
function goWiki(id) {
  const body = $('#wikiBody'), s = document.getElementById('guida-' + id);
  if (!s) return;
  if (s.hidden) { $('#wikiSearch').value = ''; $('#wikiSearch').dispatchEvent(new Event('input')); s.hidden = false; }
  body.scrollTo({ top: s.offsetTop - body.offsetTop - 8, behavior: 'smooth' });
  $('#wikiNav').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.sec === id));
}
function openWiki(id) {
  $('#wiki').hidden = false;
  $('#helpBtn').classList.add('on');
  $('#helpBtn').textContent = '✕ Chiudi guida';
  if (id) requestAnimationFrame(() => goWiki(id));
  else { $('#wikiBody').scrollTop = 0; $('#wikiBody').dispatchEvent(new Event('scroll')); }
}
function closeWiki() {
  $('#wiki').hidden = true;
  $('#helpBtn').classList.remove('on');
  $('#helpBtn').textContent = '❓ Guida';
}
if (feature('feat_help')) initHelp();
else { $('#helpBtn').hidden = true; }

// Avviso solo da telefono (touch e lato corto piccolo; i tablet e i PC non lo vedono); si chiude con un tocco
(function phoneNote() {
  const note = $('#devNote');
  const phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
  let dismissed = false;
  try { dismissed = sessionStorage.getItem('flcDevNote') === '1'; } catch (e) { /* facoltativo */ }
  if (!phone || dismissed) return;
  note.hidden = false;
  const hide = () => { note.hidden = true; try { sessionStorage.setItem('flcDevNote', '1'); } catch (e) { /* facoltativo */ } };
  note.addEventListener('click', hide);
  note.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hide(); } });
})();
