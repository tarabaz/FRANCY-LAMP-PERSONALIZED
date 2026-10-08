
// ======================================================================
// FILE: assets/js/app.js
// ======================================================================
import { FRAME, geometry, loadFont, buildFrame } from './frame.js';
import { Preview3D } from './preview3d.js';
import { stlFiles, stlReadme, zipAsync } from './export-stl.js';
import { buildEps } from './export-eps.js';
import { build3mf } from './export-3mf.js';
import { detectFace, faceFeatures } from './face.js';
import { SVGLoader } from '../vendor/three/addons/SVGLoader.js';
import polygonClipping from '../vendor/polygon-clipping/polygon-clipping.mjs';

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
  mode: 'outline', seed: 1, lit: false, view: '2d',
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
  const layersOn = state.layers.length > 0;
  const ovActive = state.overflow || layersOn;
  const inner = Math.round(2 * g.rImgArt * ppmm);
  // stessa scala e margine di pixel interi: il disegno dentro il cerchio resta identico con o senza raster grande
  // (altrimenti mezzo pixel di spostamento cambia la scelta automatica dei colori)
  const pxmm = inner / (2 * g.rImgArt);
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
    // ciò che decide i colori dell'immagine: se non cambia, il worker riusa gli stessi colori
    paletteKey: JSON.stringify([state.imgId, state.mode, +$('#colors').value, $('#portrait').checked, state.seed, +$('#smooth').value, adjust, Math.round(state.zoom * 1000), Math.round(state.ox), Math.round(state.oy), ppmm, +$('#line').value, $('#addOutlines').checked]),
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
  state.result.palette.forEach((p, i) => {
    if (p.area <= 0) return; // non più nel disegno
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
      ctrl.addEventListener('click', (ev) => { if (state.painting || !feature('feat_replace')) return; openFilamentPopover(ctrl, (hex) => replaceColor(artColor(i), hex),
        (hex) => colorSet().has(hex) || colorSet().size < MAX_FILAMENTS); });
    } else {
      ctrl = document.createElement('input');
      ctrl.type = 'color'; ctrl.value = artColor(i);
      ctrl.addEventListener('input', () => { state.colorOverrides[i] = ctrl.value; render(); });
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
    if (isLocked(i) && !state.painting) {
      const lk = document.createElement('button');
      lk.type = 'button'; lk.className = 'lock-btn'; lk.textContent = '🔒';
      lk.title = 'Bobina scelta da te: resta anche se aggiorni il disegno. Tocca per tornare automatico.';
      lk.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const hex = state.colorOverrides[i];
        state.locks = state.locks.filter((l) => l.hex !== hex);
        delete state.colorOverrides[i];
        renderPalette(); render();
      });
      name.append(' ', lk);
    }
    li.append(ctrl, name, area);
    ul.append(li);
  });
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
    updateSteps();
    return;
  }
  const { svg, colors, parts: ps } = buildSvg(false);
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
  $('#textWarn').hidden = !state.textOverlap;
  $('#textWarn').textContent = state.textOverlap ? `Le due scritte di ${state.textOverlap} si sovrappongono: spostane una con il suo slider.` : '';
  updateSteps();
}

// ---------------- sostituisci un colore ----------------
function replaceColor(oldHex, newHex) {
  oldHex = oldHex.toLowerCase(); newHex = newHex.toLowerCase();
  if (!state.result || oldHex === newHex) return;
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
function svgToPng(lit, size = 1200) {
  const svg = state.template ? templateSvg() : buildSvg(false).svg;
  return new Promise((ok, ko) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      ctx.fillStyle = STAGE_BG; ctx.fillRect(0, 0, size, size);
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
    lampada: lampSummary(),
    impostazioni: { modalita: state.mode, ritratto: $('#portrait').checked, colori: +$('#colors').value, luminosita: adjust.b, contrasto: adjust.c, saturazione: adjust.s, sopra_fascia: state.overflow ? state.ovSeeds.length : 0, grafiche: state.layers.map((x) => ({ id: x.id, nome: x.name, x: x.x, y: x.y, larghezza_mm: x.size, rotazione: x.rot })), ia: !!state.aiImageSrc, stile_ia: state.aiImageSrc ? aiStyle : null, sfondo_ia: state.aiImageSrc ? (state.aiBackground || 'originale') : null, fornitore_ia: state.aiProvider || null },
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

// ======================================================================
// FILE: assets/js/export-3mf.js
// ======================================================================
// Progetto Bambu Studio (.3mf) pronto da aprire: un oggetto con una parte per colore, ogni parte già
// assegnata al suo filamento, colori degli slot impostati, profili di stampante/processo copiati dal
// progetto modello (assets/bambu/h2c-template.json, ricavato da un progetto vero dell'admin).
// Struttura ricalcata su quella che salva Bambu Studio (3D/3dmodel.model + 3D/Objects/object_1.model +
// Metadata/model_settings.config + Metadata/project_settings.config + plate_1.json).

import { partsToTriangles, zipAsync } from './export-stl.js';

const CENTER = [100, 100]; // centro del disco nelle coordinate di partsToTriangles

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (v) => {
  const s = (Math.round(v * 100000) / 100000).toString();
  return s === '-0' ? '0' : s;
};
let uuidN = 0;
const uuid = (prefix) => {
  uuidN++;
  const h = (n, l) => n.toString(16).padStart(l, '0').slice(-l);
  return `${h(prefix, 8)}-${h(uuidN, 4)}-4${h(Math.floor(Math.random() * 4096), 3)}-8${h(Math.floor(Math.random() * 4096), 3)}-${h(Date.now(), 12)}`;
};

function hexToLab(hex) {
  const v = parseInt(hex.slice(1), 16);
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = lin(v >> 16), G = lin((v >> 8) & 255), B = lin(v & 255);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047), y = f(R * 0.2126 + G * 0.7152 + B * 0.0722), z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const dist = (a, b) => { const p = hexToLab(a), q = hexToLab(b); return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2; };

// Ridimensiona tutte le liste "per filamento" del progetto modello al nuovo elenco di filamenti.
// src[j] = indice del filamento del modello da cui copiare i profili per il nuovo filamento j.
function resizeSettings(settings, src, colors) {
  const Nt = settings.filament_colour.length;
  const out = {};
  for (const [k, v] of Object.entries(settings)) {
    if (!Array.isArray(v)) { out[k] = v; continue; }
    const L = v.length;
    if (k === 'flush_volumes_matrix' && L % (Nt * Nt) === 0) {
      const noz = L / (Nt * Nt), m = [];
      for (let n = 0; n < noz; n++) {
        const at = (a, b) => +v[n * Nt * Nt + a * Nt + b];
        for (let a = 0; a < src.length; a++) for (let b = 0; b < src.length; b++) {
          let val;
          if (a === b) val = 0;
          else if (src[a] !== src[b]) val = at(src[a], src[b]);
          else { // stesso profilo di partenza: media dello spurgo da quel filamento
            let s = 0, c = 0;
            for (let t = 0; t < Nt; t++) if (t !== src[a]) { s += at(src[a], t); c++; }
            val = Math.round(s / c);
          }
          m.push(String(val));
        }
      }
      out[k] = m;
    } else if (L === Nt) out[k] = src.map((s) => v[s]);
    else if (L === 2 * Nt) out[k] = k === 'filament_self_index' ? src.flatMap((_, j) => [String(j + 1), String(j + 1)]) : src.flatMap((s) => [v[2 * s], v[2 * s + 1]]);
    else if (L === 4 * Nt) out[k] = src.flatMap((s) => v.slice(4 * s, 4 * s + 4));
    else if (L === Nt + 1) out[k] = [v[0], ...src.map((s) => v[s + 1])];
    else if (L === Nt + 2) out[k] = [v[0], ...src.map((s) => v[s + 1]), v[L - 1]];
    else out[k] = v;
  }
  const up = colors.map((c) => c.toUpperCase());
  out.filament_colour = up;
  out.filament_multi_colour = up.slice();
  out.default_filament_colour = up.map(() => '');
  out.filament_colour_type = up.map(() => '0');
  return out;
}

// parts: come per gli STL. opts: { template, white, black, filamentName(hex), title, baseThickness, artThickness, thumb, thumbSmall }
export async function build3mf(parts, opts) {
  const { template, white, black } = opts;
  const groups = partsToTriangles(parts);
  const T = template.settings;
  const tColors = T.filament_colour.map((c) => c.toLowerCase());
  const tSilk = (T.filament_ids || []).map((id) => /GFL96|silk/i.test(id));

  // elenco filamenti: bianco (ugello fisso), nero, poi gli altri colori nell'ordine in cui compaiono
  const colors = [];
  const add = (c) => { c = c.toLowerCase(); if (!colors.includes(c)) colors.push(c); };
  add(white);
  for (const [key, g] of groups) if (key !== 'base' && g.color === black.toLowerCase()) add(black);
  for (const [key, g] of groups) add(key === 'base' ? white : g.color);
  if (colors.length > 13) throw new Error('Troppi colori per la stampante (massimo 13)');
  const fIdx = (c) => colors.indexOf(c.toLowerCase()) + 1;

  // profilo di partenza per ogni filamento: il bianco e il nero del modello, per gli altri il colore più vicino
  const iWhite = tColors.indexOf('#ffffff') >= 0 ? tColors.indexOf('#ffffff') : 0;
  const iBlack = tColors.indexOf('#000000') >= 0 ? tColors.indexOf('#000000') : 0;
  const src = colors.map((c, j) => {
    if (j === 0) return iWhite;
    if (c === black.toLowerCase()) return iBlack;
    let best = 0, bd = Infinity;
    tColors.forEach((tc, t) => { if (t === iWhite || t === iBlack || tSilk[t]) return; const d = dist(c, tc); if (d < bd) { bd = d; best = t; } });
    return best;
  });
  const settings = resizeSettings(T, src, colors);

  // mesh: una parte per gruppo di colore, vertici in coordinate locali centrate (come Bambu Studio)
  const total = opts.baseThickness + opts.artThickness;
  const itemZ = total / 2;
  const meshParts = [];
  for (const [key, g] of groups) {
    const isBase = key === 'base';
    const color = isBase ? white.toLowerCase() : g.color;
    const zmid = isBase ? opts.baseThickness / 2 : opts.baseThickness + opts.artThickness / 2;
    const tris = g.chunks;
    const vmap = new Map(), verts = [], idx = [];
    for (const ch of tris) for (let t = 0; t < ch.length; t += 3) {
      const x = ch[t] - CENTER[0], y = ch[t + 1] - CENTER[1], z = ch[t + 2] - zmid;
      const k = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
      let id = vmap.get(k);
      if (id === undefined) { id = verts.length / 3; vmap.set(k, id); verts.push(x, y, z); }
      idx.push(id);
    }
    // via i triangoli degeneri (due vertici coincidenti dopo l'arrotondamento)
    const faces = [];
    for (let t = 0; t < idx.length; t += 3) if (idx[t] !== idx[t + 1] && idx[t + 1] !== idx[t + 2] && idx[t] !== idx[t + 2]) faces.push(idx[t], idx[t + 1], idx[t + 2]);
    const fil = opts.filamentName ? opts.filamentName(color) : '';
    const label = isBase ? 'BASE' : color === black.toLowerCase() ? 'NERO' : color === white.toLowerCase() ? 'BIANCO' : `COLORE ${color.toUpperCase()}`;
    meshParts.push({ name: fil ? `${label} - ${fil}` : label, color, filament: fIdx(color), verts, faces, z: zmid - itemZ, zmid });
  }

  // ---- 3D/Objects/object_1.model ----
  let obj = '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n <resources>\n';
  const chunks = [];
  meshParts.forEach((mp, i) => {
    mp.id = i + 1;
    let s = `  <object id="${mp.id}" p:UUID="${uuid(0x00010000 + i)}" type="model">\n   <mesh>\n    <vertices>\n`;
    for (let v = 0; v < mp.verts.length; v += 3) s += `     <vertex x="${num(mp.verts[v])}" y="${num(mp.verts[v + 1])}" z="${num(mp.verts[v + 2])}"/>\n`;
    s += '    </vertices>\n    <triangles>\n';
    for (let f = 0; f < mp.faces.length; f += 3) s += `     <triangle v1="${mp.faces[f]}" v2="${mp.faces[f + 1]}" v3="${mp.faces[f + 2]}"/>\n`;
    s += '    </triangles>\n   </mesh>\n  </object>\n';
    chunks.push(s);
  });
  const objectModel = obj + chunks.join('') + ' </resources>\n <build/>\n</model>\n';

  // ---- 3D/3dmodel.model ----
  const objId = meshParts.length + 1;
  const today = new Date().toISOString().slice(0, 10);
  const bt = template.build_transform.split(/\s+/);
  bt[11] = num(itemZ);
  let model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">\n`;
  for (const [k, v] of [['Application', template.application], ['BambuStudio:3mfVersion', '1'], ['Copyright', ''], ['CreationDate', today], ['Description', ''], ['Designer', ''], ['DesignerCover', ''], ['DesignerUserId', ''], ['License', ''], ['ModificationDate', today], ['Origin', ''], ['ProfileCover', ''], ['ProfileDescription', ''], ['ProfileTitle', ''], ['Thumbnail_Middle', '/Metadata/plate_1.png'], ['Thumbnail_Small', '/Metadata/plate_1_small.png'], ['Title', opts.title || '']]) {
    model += ` <metadata name="${k}">${esc(v)}</metadata>\n`;
  }
  model += ` <resources>\n  <object id="${objId}" p:UUID="${uuid(0x000a0000)}" type="model">\n   <components>\n`;
  for (const mp of meshParts) model += `    <component p:path="/3D/Objects/object_1.model" objectid="${mp.id}" p:UUID="${uuid(0x000b0000 + mp.id)}" transform="1 0 0 0 1 0 0 0 1 0 0 ${num(mp.z)}"/>\n`;
  model += `   </components>\n  </object>\n </resources>\n <build p:UUID="${uuid(0x000c0000)}">\n  <item objectid="${objId}" p:UUID="${uuid(0x000d0000)}" transform="${bt.join(' ')}" printable="1"/>\n </build>\n</model>\n`;

  // ---- Metadata/model_settings.config ----
  const faceCount = meshParts.reduce((a, m) => a + m.faces.length / 3, 0);
  let ms = `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <object id="${objId}">\n    <metadata key="name" value="${esc(opts.title || 'Disco lampada')}"/>\n    <metadata key="extruder" value="${fIdx(white)}"/>\n    <metadata face_count="${faceCount}"/>\n`;
  for (const mp of meshParts) {
    ms += `    <part id="${mp.id}" subtype="normal_part">\n      <metadata key="name" value="${esc(mp.name)}"/>\n      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 ${num(mp.z)} 0 0 0 1"/>\n      <metadata key="source_file" value="${esc(mp.name)}.stl"/>\n      <metadata key="source_object_id" value="0"/>\n      <metadata key="source_volume_id" value="0"/>\n      <metadata key="source_offset_x" value="${CENTER[0]}"/>\n      <metadata key="source_offset_y" value="${CENTER[1]}"/>\n      <metadata key="source_offset_z" value="${num(mp.zmid)}"/>\n      <metadata key="extruder" value="${mp.filament}"/>\n      <mesh_stat face_count="${mp.faces.length / 3}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>\n    </part>\n`;
  }
  // bianco sull'ugello 1 (bobina fissa), tutti gli altri sull'ugello 2 (AMS)
  const maps = colors.map((c, j) => String(j === 0 ? template.white_nozzle || 1 : template.other_nozzle || 2)).join(' ');
  ms += `  </object>\n  <plate>\n    <metadata key="plater_id" value="1"/>\n    <metadata key="plater_name" value=""/>\n    <metadata key="locked" value="false"/>\n    <metadata key="filament_map_mode" value="Manual"/>\n    <metadata key="filament_maps" value="${maps}"/>\n    <metadata key="filament_volume_maps" value="${colors.map(() => '0').join(' ')}"/>\n    <metadata key="thumbnail_file" value="Metadata/plate_1.png"/>\n    <model_instance>\n      <metadata key="object_id" value="${objId}"/>\n      <metadata key="instance_id" value="0"/>\n      <metadata key="identify_id" value="1100"/>\n    </model_instance>\n  </plate>\n  <assemble>\n   <assemble_item object_id="${objId}" instance_id="0" transform="${template.assemble_transform}" offset="0 0 0" />\n  </assemble>\n</config>\n`;

  // ---- Metadata/plate_1.json ----
  const cx = +bt[9], cy = +bt[10], R = 100;
  const plate = {
    bbox_all: [cx - R, cy - R, cx + R, cy + R],
    bbox_objects: [{ area: Math.round(Math.PI * R * R), bbox: [cx - R, cy - R, cx + R, cy + R], id: 1100, layer_height: +(T.layer_height || 0.16), name: opts.title || 'Disco lampada' }],
    bed_type: template.bed_type || 'textured_plate',
    filament_colors: colors.map((c) => c.toUpperCase()),
    filament_ids: colors.map((_, j) => j),
    first_extruder: 2,
    is_seq_print: false,
    nozzle_diameter: template.nozzle_diameter || 0.4,
    version: 2,
  };

  const enc = (s) => new TextEncoder().encode(s);
  const files = [
    { name: '[Content_Types].xml', data: enc('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n <Default Extension="png" ContentType="image/png"/>\n <Default Extension="gcode" ContentType="text/x.gcode"/>\n</Types>\n') },
    { name: '_rels/.rels', data: enc('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n' + (opts.thumb ? ' <Relationship Target="/Metadata/plate_1.png" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>\n <Relationship Target="/Metadata/plate_1.png" Id="rel-4" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-middle"/>\n <Relationship Target="/Metadata/plate_1_small.png" Id="rel-5" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-small"/>\n' : '') + '</Relationships>\n') },
    { name: '3D/3dmodel.model', data: enc(model) },
    { name: '3D/_rels/3dmodel.model.rels', data: enc('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/Objects/object_1.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>\n') },
    { name: '3D/Objects/object_1.model', data: enc(objectModel) },
    { name: 'Metadata/model_settings.config', data: enc(ms) },
    { name: 'Metadata/project_settings.config', data: enc(JSON.stringify(settings, null, 4)) },
    { name: 'Metadata/plate_1.json', data: enc(JSON.stringify(plate)) },
    { name: 'Metadata/slice_info.config', data: enc(`<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <header>\n    <header_item key="X-BBL-Client-Type" value="slicer"/>\n    <header_item key="X-BBL-Client-Version" value="${esc(template.client_version || '')}"/>\n  </header>\n</config>\n`) },
    { name: 'Metadata/filament_sequence.json', data: enc('{"plate_1":{"nozzle_sequence":[],"optimal_assignment":[],"sequence":[]}}') },
  ];
  if (opts.thumb) files.push({ name: 'Metadata/plate_1.png', data: opts.thumb }, { name: 'Metadata/plate_1_small.png', data: opts.thumbSmall || opts.thumb });

  const list = meshParts.map((mp) => ({ part: mp.name, filament: mp.filament, color: mp.color }));
  return { blob: await zipAsync(files), colors, list };
}

// ======================================================================
// FILE: assets/js/export-eps.js
// ======================================================================
// Export EPS (PostScript vettoriale) dalle stesse parti dell'SVG.
// Converte i comandi SVG usati dal configuratore (M L Q C A Z assoluti) in moveto/lineto/curveto.
// Unità: punti tipografici, disco Ø200 mm = 566,93 pt, origine in basso a sinistra.

const PT = 72 / 25.4;

function tokenize(d) {
  const out = [];
  const re = /([MLQCAZmlqcaz])|(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/g;
  let m;
  while ((m = re.exec(d))) out.push(m[1] || parseFloat(m[2]));
  return out;
}

// Arco SVG (forma "endpoint") -> curve di Bézier cubiche, segmenti di max 90°
function arcToCubics(x1, y1, rx, ry, phiDeg, large, sweep, x2, y2) {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [[x1, y1, x2, y2, x2, y2]];
  const phi = (phiDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) co = -co;
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  let t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
  const step = dt / segs, k = (4 / 3) * Math.tan(step / 4);
  const pt = (t) => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const der = (t) => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  const out = [];
  for (let i = 0; i < segs; i++) {
    const a = t1 + i * step, b = a + step;
    const [ax, ay] = pt(a), [bx, by] = pt(b), [dax, day] = der(a), [dbx, dby] = der(b);
    out.push([ax + k * dax, ay + k * day, bx - k * dbx, by - k * dby, bx, by]);
  }
  return out;
}

// path d (mm, centro 0,0, y in basso) -> operatori PostScript
function pathToPs(d, R) {
  const X = (x) => ((x + R) * PT).toFixed(3);
  const Y = (y) => ((R - y) * PT).toFixed(3);
  const t = tokenize(d);
  let i = 0, cmd = null, cx = 0, cy = 0, sx = 0, sy = 0, ps = '';
  const num = () => t[i++];
  while (i < t.length) {
    if (typeof t[i] === 'string') cmd = t[i++];
    if (cmd === 'Z' || cmd === 'z') { ps += 'closepath\n'; cx = sx; cy = sy; continue; }
    if (cmd === 'M') { cx = sx = num(); cy = sy = num(); ps += `${X(cx)} ${Y(cy)} moveto\n`; cmd = 'L'; continue; }
    if (cmd === 'L') { cx = num(); cy = num(); ps += `${X(cx)} ${Y(cy)} lineto\n`; continue; }
    if (cmd === 'Q') {
      const qx = num(), qy = num(), x = num(), y = num();
      const c1x = cx + (2 / 3) * (qx - cx), c1y = cy + (2 / 3) * (qy - cy);
      const c2x = x + (2 / 3) * (qx - x), c2y = y + (2 / 3) * (qy - y);
      ps += `${X(c1x)} ${Y(c1y)} ${X(c2x)} ${Y(c2y)} ${X(x)} ${Y(y)} curveto\n`;
      cx = x; cy = y; continue;
    }
    if (cmd === 'C') {
      const a = [num(), num(), num(), num(), num(), num()];
      ps += `${X(a[0])} ${Y(a[1])} ${X(a[2])} ${Y(a[3])} ${X(a[4])} ${Y(a[5])} curveto\n`;
      cx = a[4]; cy = a[5]; continue;
    }
    if (cmd === 'A') {
      const rx = num(), ry = num(), rot = num(), large = num(), sweep = num(), x = num(), y = num();
      for (const c of arcToCubics(cx, cy, rx, ry, rot, large, sweep, x, y)) {
        ps += `${X(c[0])} ${Y(c[1])} ${X(c[2])} ${Y(c[3])} ${X(c[4])} ${Y(c[5])} curveto\n`;
      }
      cx = x; cy = y; continue;
    }
    throw new Error('Comando SVG non gestito: ' + cmd);
  }
  return ps;
}

// parts: [{ id, d, color }] nell'ordine di disegno
export function buildEps(parts, diameter) {
  const R = diameter / 2, size = Math.ceil(diameter * PT);
  let ps = '%!PS-Adobe-3.0 EPSF-3.0\n' +
    `%%BoundingBox: 0 0 ${size} ${size}\n` +
    `%%HiResBoundingBox: 0 0 ${(diameter * PT).toFixed(3)} ${(diameter * PT).toFixed(3)}\n` +
    '%%Title: FrancyStore3D disco lampada\n%%Creator: Francy Lamp Factory\n%%DocumentData: Clean7Bit\n%%EndComments\n';
  for (const p of parts) {
    if (!p.d) continue;
    const v = parseInt(p.color.slice(1), 16);
    const rgb = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => (c / 255).toFixed(4)).join(' ');
    ps += `%%Parte: ${p.id} ${p.color}\ngsave\n${rgb} setrgbcolor\nnewpath\n${pathToPs(p.d, R)}eofill\ngrestore\n`;
  }
  return ps + 'showpage\n%%EOF\n';
}

// ======================================================================
// FILE: assets/js/export-stl.js
// ======================================================================
// Export per Bambu Studio: un STL per colore, tutti con la stessa origine (si importano come
// "oggetto con più parti" e si posizionano da soli). mm, Y in alto, Z da 0 (piano di stampa).
import * as THREE from '../vendor/three/three.module.js';
import { SVGLoader } from '../vendor/three/addons/SVGLoader.js';

// Centro del disco nel file: così tutte le coordinate sono positive (disco da 0 a 200)
const CENTER = [100, 100];

// Rifà le forme togliendo i punti doppi consecutivi (es. fine di una linea = inizio di un arco):
// il triangolatore ci inciampa e crea triangoli che riempiono i buchi.
export function cleanShapes(shapes, divisions = 16) {
  const clean = (pts) => {
    const out = [];
    for (const p of pts) {
      const last = out[out.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-4) out.push(p);
    }
    while (out.length > 2 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= 1e-4) out.pop();
    return out;
  };
  const res = [];
  for (const sh of shapes) {
    const { shape, holes } = sh.extractPoints(divisions);
    const outer = clean(shape);
    if (outer.length < 3) continue;
    const ns = new THREE.Shape(outer);
    for (const h of holes) { const hp = clean(h); if (hp.length >= 3) ns.holes.push(new THREE.Path(hp)); }
    res.push(ns);
  }
  return res;
}

// parts: [{ id, d, color, z, depth, black, layer }] -> Map colore -> Float32Array triangoli
export function partsToTriangles(parts) {
  const loader = new SVGLoader();
  const byColor = new Map();
  for (const p of parts) {
    if (!p.d) continue;
    const data = loader.parse(`<svg xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="${p.d}"/></svg>`);
    const shapes = [];
    for (const path of data.paths) shapes.push(...cleanShapes(SVGLoader.createShapes(path)));
    if (!shapes.length) continue;
    const geo = new THREE.ExtrudeGeometry(shapes, { depth: p.depth, bevelEnabled: false }).toNonIndexed();
    const pos = geo.attributes.position.array;
    const out = new Float32Array(pos.length);
    // SVG ha Y in basso: ribalto Y e inverto l'ordine dei vertici per tenere le normali verso fuori
    for (let t = 0; t < pos.length; t += 9) {
      for (const [dst, src] of [[0, 0], [3, 6], [6, 3]]) {
        out[t + dst] = pos[t + src] + CENTER[0];
        out[t + dst + 1] = CENTER[1] - pos[t + src + 1];
        out[t + dst + 2] = pos[t + src + 2] + p.z;
      }
    }
    geo.dispose();
    const key = p.layer === 'base' ? 'base' : p.color.toLowerCase();
    if (!byColor.has(key)) byColor.set(key, { color: p.color.toLowerCase(), chunks: [], ids: [] });
    byColor.get(key).chunks.push(out);
    byColor.get(key).ids.push(p.id);
  }
  return byColor;
}

function stlBinary(name, tris) {
  const n = tris.length / 9;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  const head = `FrancyStore3D ${name}`.slice(0, 79);
  for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i) & 0x7f);
  dv.setUint32(80, n, true);
  let o = 84;
  for (let t = 0; t < tris.length; t += 9) {
    const ax = tris[t], ay = tris[t + 1], az = tris[t + 2];
    const ux = tris[t + 3] - ax, uy = tris[t + 4] - ay, uz = tris[t + 5] - az;
    const vx = tris[t + 6] - ax, vy = tris[t + 7] - ay, vz = tris[t + 8] - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
    for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, tris[t + k], true);
    dv.setUint16(o + 48, 0, true);
    o += 50;
  }
  return new Uint8Array(buf);
}

function concat(chunks) {
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Float32Array(len);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// ---- zip minimale (senza compressione) ----
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; }
  return t;
})();
function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// Zip: ogni file { name, data(Uint8Array), method 0 = memorizzato / 8 = deflate, raw (dati compressi) }
function zipEntries(entries) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const f of entries) {
    const name = enc.encode(f.name), stored = f.raw || f.data, method = f.raw ? 8 : 0;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint16(8, method, true); local.setUint16(10, 0, true); local.setUint16(12, 0x21, true);
    local.setUint32(14, f.crc, true); local.setUint32(18, stored.length, true); local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, stored);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, method, true); cen.setUint16(12, 0, true); cen.setUint16(14, 0x21, true);
    cen.setUint32(16, f.crc, true); cen.setUint32(20, stored.length, true); cen.setUint32(24, f.data.length, true);
    cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + stored.length;
  }
  const cenSize = central.reduce((a, c) => a + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

export function zip(files) {
  return zipEntries(files.map((f) => ({ ...f, crc: crc32(f.data) })));
}

// Zip compresso (deflate) con CompressionStream del browser; se non c'è, file memorizzati senza compressione
export async function zipAsync(files) {
  const canDeflate = typeof CompressionStream !== 'undefined';
  const entries = [];
  for (const f of files) {
    const e = { ...f, crc: crc32(f.data) };
    if (canDeflate && f.data.length > 256 && !/\.(jpe?g|png|zip)$/i.test(f.name)) {
      try {
        const stream = new Blob([f.data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        const raw = new Uint8Array(await new Response(stream).arrayBuffer());
        if (raw.length < f.data.length) e.raw = raw;
      } catch (err) { /* deflate-raw non supportato: resta memorizzato */ }
    }
    entries.push(e);
  }
  return zipEntries(entries);
}

const slug = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

// STL per colore: nomi BASE, NERO, BIANCO, COLORE_hex (+ nome del filamento se c'è il catalogo)
export function stlFiles(parts, { black, white, filamentName }, prefix = '') {
  const groups = partsToTriangles(parts);
  const files = [], list = [];
  let i = 1;
  const order = [...groups.entries()].sort(([a], [b]) => {
    const rank = (k) => (k === 'base' ? 0 : k === black ? 1 : k === white ? 2 : 3);
    return rank(a) - rank(b);
  });
  for (const [key, g] of order) {
    const tris = concat(g.chunks);
    let label = key === 'base' ? 'BASE_bianco' : key === black ? 'NERO' : key === white ? 'BIANCO' : `COLORE_${g.color.slice(1)}`;
    const fil = filamentName ? filamentName(key === 'base' ? white : g.color) : '';
    if (fil) label += '__' + slug(fil);
    const name = `${prefix}${String(i).padStart(2, '0')}_${label}.stl`;
    files.push({ name, data: stlBinary(label, tris) });
    list.push({ file: name, color: key === 'base' ? white : g.color, filament: fil, parts: g.ids });
    i++;
  }
  return { files, list };
}

export function stlReadme({ baseThickness, artThickness }) {
  return [
    'FrancyStore3D - disco lampada, un STL per colore',
    `Base bianca ${baseThickness} mm + motivo ${artThickness} mm. Origine comune: centro disco in X ${CENTER[0]} / Y ${CENTER[1]}.`,
    'Bambu Studio: seleziona tutti i file insieme e rispondi "Sì" a "caricare come un singolo oggetto con più parti?".',
  ];
}

// Zip veloce per le prove dell'admin: STL + file extra
export async function buildStlZip(parts, opts, extraFiles = []) {
  const { files, list } = stlFiles(parts, opts);
  const lines = [...stlReadme(opts), ''];
  for (const l of list) lines.push(`${l.file}  colore ${l.color}${l.filament ? '  filamento ' + l.filament : ''}  (${l.parts.join(', ')})`);
  for (const f of extraFiles) { files.push(f); lines.push(`${f.name}  ${f.note || ''}`); }
  files.push({ name: 'LEGGIMI.txt', data: new TextEncoder().encode(lines.join('\r\n') + '\r\n') });
  return { blob: await zipAsync(files), count: list.length };
}

// ======================================================================
// FILE: assets/js/face.js
// ======================================================================
// Riconoscimento del volto nel browser (MediaPipe Face Landmarker, Apache 2.0, file in assets/vendor/mediapipe).
// Gira tutto sul dispositivo del cliente: la foto non viene inviata da nessuna parte.
// I file (~17 MB) vengono scaricati solo la prima volta che si accende "È un ritratto".

let ready = null;

function init() {
  const base = new URL('../vendor/mediapipe/', import.meta.url);
  return import(new URL('vision_bundle.mjs', base).href).then(({ FaceLandmarker }) =>
    FaceLandmarker.createFromOptions(
      {
        wasmLoaderPath: new URL('wasm/vision_wasm_internal.js', base).href,
        wasmBinaryPath: new URL('wasm/vision_wasm_internal.wasm', base).href,
      },
      {
        baseOptions: { modelAssetPath: new URL('face_landmarker.task', base).href, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numFaces: 1,
      },
    ));
}

// Punti del volto (478, coordinate 0..1 rispetto all'immagine) oppure null se non c'è un volto
export async function detectFace(img) {
  if (!ready) ready = init().catch((e) => { ready = null; throw e; });
  const lm = await ready;
  const r = lm.detect(img);
  const pts = r && r.faceLandmarks && r.faceLandmarks[0];
  return pts && pts.length >= 478 ? pts.map((p) => [p.x, p.y]) : null;
}

// Indici della mesh di MediaPipe
const EYE_A = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const EYE_B = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
const IRIS_1 = [468, 469, 470, 471, 472];
const IRIS_2 = [473, 474, 475, 476, 477];
const MOUTH_IN = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];

function iris(pts, idx) {
  const c = pts[idx[0]];
  const r = idx.slice(1).reduce((s, i) => s + Math.hypot(pts[i][0] - c[0], pts[i][1] - c[1]), 0) / 4;
  return { x: c[0], y: c[1], r };
}

// Converte i punti (già in pixel dell'immagine di lavoro) nella forma che usa il worker
export function faceFeatures(pts) {
  const irises = [iris(pts, IRIS_1), iris(pts, IRIS_2)];
  const eyes = [[EYE_A, 33, 133], [EYE_B, 263, 362]].map(([idx, a, b]) => {
    const poly = idx.map((i) => pts[i]);
    const cx = (pts[a][0] + pts[b][0]) / 2, cy = (pts[a][1] + pts[b][1]) / 2;
    // l'iride giusta è quella più vicina al centro di quest'occhio
    const ir = irises.slice().sort((p, q) => Math.hypot(p.x - cx, p.y - cy) - Math.hypot(q.x - cx, q.y - cy))[0];
    return { poly, corners: [pts[a], pts[b]], iris: ir };
  });
  return { eyes, mouth: MOUTH_IN.map((i) => pts[i]) };
}

// ======================================================================
// FILE: assets/js/frame.js
// ======================================================================
// Cornice fissa del disco (anello nero con tacche + fascia colorata con scritte).
// Tutte le misure sono in mm, centro del disco in (0,0), asse Y verso il basso (come SVG).
// Quote reali fornite da Valerio: bordo nero 9,25, banda 12, bordino interno 3, contorno asola 4, fori e asola Ø10.

import { parse as parseFont } from '../vendor/opentype.mjs';

export const FRAME = {
  diameter: 200,          // diametro totale disco
  blackRing: 9.25,        // spessore anello nero esterno
  band: 12,               // spessore fascia colorata
  innerLine: 3,           // spessore bordino nero che delimita l'artwork
  slotBorder: 4,          // contorno nero attorno all'asola, attraversa la banda fino al bordino interno
  overlap: 0.2,           // quanto il disegno va sotto il bordino interno (minimo, per non creare parti sovrapposte negli STL)
  sideNotch: { diameter: 10, heightFromBottom: 200 * 2 / 3 }, // fori laterali: centro sul bordo a 2/3 dell'altezza
  bottomSlot: { diameter: 10, centerFromBottom: 12 },          // asola in basso a U: centro foro a 12 mm dal fondo
  textHeight: 0.62,       // altezza testo come frazione della fascia
  textMaxSpanDeg: 80,     // ampiezza massima di un testo sull'arco
  baseThickness: 0.52,    // base bianca piena, sempre presente
  artThickness: 0.48,     // motivo colorato sopra la base (totale disco 1 mm)
};

export function geometry(F = FRAME) {
  const R = F.diameter / 2;
  const rBandOut = R - F.blackRing;
  const rBandIn = rBandOut - F.band;
  const rImg = rBandIn - F.innerLine;
  return { R, rBandOut, rBandIn, rImg, rImgArt: rImg + F.overlap };
}

let fontPromise = null;
export function loadFont(url = new URL('../fonts/mplus-rounded-800.woff', import.meta.url)) {
  if (!fontPromise) fontPromise = fetch(url).then((r) => r.arrayBuffer()).then((b) => parseFont(b));
  return fontPromise;
}

const n = (v) => Math.round(v * 1000) / 1000;
const pt = (r, a) => [n(r * Math.cos(a)), n(r * Math.sin(a))];

function circlePath(r, ccw = false) {
  // due archi; ccw inverte il verso (per i fori con regola nonzero)
  const s = ccw ? 0 : 1;
  return `M${n(r)} 0A${n(r)} ${n(r)} 0 1 ${s} ${n(-r)} 0A${n(r)} ${n(r)} 0 1 ${s} ${n(r)} 0Z`;
}

// Cerchio di raggio r con l'asola in basso (e opzionalmente i fori laterali), senso orario.
// L'asola è un taglio passante: va tolta da tutte le parti che attraversa.
function notchedCircle(F, r, withSideNotches) {
  const { R } = geometry(F);
  const hw = F.bottomSlot.diameter / 2;
  const yC = R - F.bottomSlot.centerFromBottom;          // centro del semicerchio dell'asola
  const yTop = Math.sqrt(r * r - hw * hw);               // dove l'asola incontra questo cerchio
  const arcTo = (a) => { const [x, y] = pt(r, a); return `A${n(r)} ${n(r)} 0 0 1 ${x} ${y}`; };
  const slotHits = yTop > yC;
  const aB = Math.asin(hw / r);

  if (!withSideNotches) {
    if (!slotHits) return circlePath(r);
    let d = `M${n(-hw)} ${n(yTop)}`;
    d += arcTo(1.5 * Math.PI);            // fino in cima, passando da sinistra
    d += arcTo(2.5 * Math.PI - aB);       // e giù fino al bordo destro dell'asola
    d += `L${n(hw)} ${n(yC)}A${n(hw)} ${n(hw)} 0 0 0 ${n(-hw)} ${n(yC)}Z`;
    return d;
  }

  const rn = F.sideNotch.diameter / 2;
  const yN = R - F.sideNotch.heightFromBottom;           // y del centro foro (negativo = sopra il centro)
  const aR = Math.atan2(yN, Math.sqrt(R * R - yN * yN)); // foro destro, centro sul bordo
  const aL = Math.PI - aR;                               // foro sinistro (simmetrico)
  const da = 2 * Math.asin(rn / (2 * R));                // semi-ampiezza angolare del foro sul bordo
  const notch = (a) => { const [x, y] = pt(r, a + da); return `A${rn} ${rn} 0 0 0 ${x} ${y}`; };
  const [x0, y0] = pt(r, aR + da);
  let d = `M${x0} ${y0}`;
  d += arcTo(Math.PI / 2 - aB);
  d += `L${n(hw)} ${n(yC)}A${n(hw)} ${n(hw)} 0 0 0 ${n(-hw)} ${n(yC)}L${n(-hw)} ${n(yTop)}`;
  d += arcTo(aL - da);
  d += notch(aL);
  d += arcTo(-Math.PI / 2 + 2 * Math.PI); // passa dal punto più alto
  d += arcTo(aR + 2 * Math.PI - da);
  d += notch(aR + 2 * Math.PI);
  return d + 'Z';
}

// Testo lungo un arco -> path. top=true: si legge in alto in senso orario; false: in basso, dritto.
// Ampiezza (gradi) che occupa un testo sull'arco, già ristretto se più lungo di maxSpanDeg
function textSpanDeg(font, text, rBaseline, size, maxSpanDeg) {
  if (!text || !font) return 0;
  const sc = size / font.unitsPerEm;
  const total = font.stringToGlyphs(text).reduce((a, g) => a + (g.advanceWidth || 0) * sc, 0);
  return Math.min(maxSpanDeg, (total / rBaseline) * 180 / Math.PI);
}

// Posizione delle scritte (centro, in gradi; 0 = destra, -90 = in alto, 90 = in basso). Le due di sopra scorrono
// nella metà superiore, le due di sotto nella metà inferiore saltando l'asola (non ci finiscono mai sopra).
export const TEXT_DEFAULT_POS = { topLeft: -135, topRight: -45, bottomLeft: 125, bottomRight: 55 };
export function clampTextPos(key, deg, spanDeg, slotGapDeg = 8) {
  const half = spanDeg / 2 + 1;
  if (key === 'topLeft' || key === 'topRight') return Math.min(-half, Math.max(-180 + half, deg));
  // sotto: da un lato o dall'altro dell'asola (in basso al centro, 90°)
  const right = deg < 90;
  return right ? Math.min(90 - slotGapDeg - half, Math.max(half, deg)) : Math.min(180 - half, Math.max(90 + slotGapDeg + half, deg));
}

function arcText(font, text, centerDeg, rBaseline, size, top, maxSpanDeg) {
  if (!text || !font) return '';
  const glyphs = font.stringToGlyphs(text);
  const scale = size / font.unitsPerEm;
  let adv = glyphs.map((g) => (g.advanceWidth || 0) * scale);
  let total = adv.reduce((a, b) => a + b, 0);
  // restringi se troppo lungo
  const maxLen = (maxSpanDeg * Math.PI / 180) * rBaseline;
  let s = size;
  if (total > maxLen) { const k = maxLen / total; s *= k; adv = adv.map((a) => a * k); total = maxLen; }
  const sc = s / font.unitsPerEm;
  const dir = top ? 1 : -1;
  let a = centerDeg * Math.PI / 180 - dir * (total / 2) / rBaseline;
  let out = '';
  glyphs.forEach((g, i) => {
    const mid = a + dir * (adv[i] / 2) / rBaseline;
    const rot = mid + dir * Math.PI / 2;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const bx = rBaseline * Math.cos(mid), by = rBaseline * Math.sin(mid);
    const tf = (x, y) => {
      const lx = x - adv[i] / 2, ly = y;
      return [n(bx + lx * cr - ly * sr), n(by + lx * sr + ly * cr)];
    };
    const p = g.getPath(0, 0, s);
    for (const c of p.commands) {
      if (c.type === 'M' || c.type === 'L') { const [x, y] = tf(c.x, c.y); out += `${c.type}${x} ${y}`; }
      else if (c.type === 'Q') { const [x1, y1] = tf(c.x1, c.y1); const [x, y] = tf(c.x, c.y); out += `Q${x1} ${y1} ${x} ${y}`; }
      else if (c.type === 'C') { const [x1, y1] = tf(c.x1, c.y1); const [x2, y2] = tf(c.x2, c.y2); const [x, y] = tf(c.x, c.y); out += `C${x1} ${y1} ${x2} ${y2} ${x} ${y}`; }
      else if (c.type === 'Z') out += 'Z';
    }
    a += dir * adv[i] / rBaseline;
  });
  return out;
}

// Ritorna gli elementi della cornice come path separati per colore/parte
// Anello nero esterno come forma unica a "C": bordo esterno con fori laterali, poi l'asola come
// rettangolo tra cerchio esterno e banda, e ritorno lungo il cerchio della banda.
// (Fatto come "cerchio meno cerchio" i due contorni coinciderebbero sui lati dell'asola e la triangolazione sbaglia.)
function ringPath(F, g) {
  const R = g.R, rO = g.rBandOut;
  const hw = F.bottomSlot.diameter / 2;
  const rn = F.sideNotch.diameter / 2;
  const yN = R - F.sideNotch.heightFromBottom;
  const aR = Math.atan2(yN, Math.sqrt(R * R - yN * yN));
  const aL = Math.PI - aR;
  const da = 2 * Math.asin(rn / (2 * R));
  const aB = Math.asin(hw / R);
  const yTopR = Math.sqrt(R * R - hw * hw), yB = Math.sqrt(rO * rO - hw * hw);
  const arcR = (a) => { const [x, y] = pt(R, a); return `A${R} ${R} 0 0 1 ${x} ${y}`; };
  const notch = (a) => { const [x, y] = pt(R, a + da); return `A${rn} ${rn} 0 0 0 ${x} ${y}`; };
  const [x0, y0] = pt(R, aR + da);
  let d = `M${x0} ${y0}`;
  d += arcR(Math.PI / 2 - aB);                                            // fino al lato destro dell'asola
  d += `L${n(hw)} ${n(yB)}`;                                              // su lungo l'asola fino alla banda
  d += `A${n(rO)} ${n(rO)} 0 0 0 0 ${n(-rO)}A${n(rO)} ${n(rO)} 0 0 0 ${n(-hw)} ${n(yB)}`; // giro interno
  d += `L${n(-hw)} ${n(yTopR)}`;                                          // giù lungo l'asola
  d += arcR(aL - da) + notch(aL);
  d += arcR(-Math.PI / 2 + 2 * Math.PI);
  d += arcR(aR + 2 * Math.PI - da) + notch(aR + 2 * Math.PI);
  return d + 'Z';
}

// Banda colorata interrotta in basso dal contorno nero dell'asola (forma a "C") e contorno stesso.
// Forme esatte e non sovrapposte: banda, contorno, anello e bordino si toccano solo sui bordi.
function slotBorderShapes(F, g) {
  const W = F.bottomSlot.diameter / 2 + F.slotBorder;        // semi-larghezza del contorno (9)
  const hw = F.bottomSlot.diameter / 2;                       // semi-larghezza asola (5)
  const yC = g.R - F.bottomSlot.centerFromBottom;             // centro asola (88)
  // L'arco del contorno sale fino a fondersi col bordino interno (niente striscia sottile di banda in mezzo)
  const yCc = Math.min(yC, g.rBandIn - 0.5 + W);
  const rI = g.rBandIn, rO = g.rBandOut;
  const yi = (rI * rI - W * W + yCc * yCc) / (2 * yCc);       // intersezione arco contorno / cerchio interno
  if (yi >= rI || yi * yi > rI * rI) return null;
  const xi = Math.sqrt(rI * rI - yi * yi);
  const yA = Math.sqrt(rO * rO - W * W), yB = Math.sqrt(rO * rO - hw * hw);
  const a = (r) => `${n(r)} ${n(r)} 0 0`;
  const band =
    `M${n(-W)} ${n(yA)}A${a(rO)} 1 0 ${n(-rO)}A${a(rO)} 1 ${n(W)} ${n(yA)}` +     // giro esterno passando dall'alto
    `L${n(W)} ${n(yCc)}A${a(W)} 0 ${n(xi)} ${n(yi)}` +                              // lato destro del contorno
    `A${a(rI)} 0 0 ${n(-rI)}A${a(rI)} 0 ${n(-xi)} ${n(yi)}` +                     // giro interno passando dall'alto
    `A${a(W)} 0 ${n(-W)} ${n(yCc)}Z`;                                              // lato sinistro del contorno
  const border =
    `M${n(-xi)} ${n(yi)}A${a(W)} 0 ${n(-W)} ${n(yCc)}L${n(-W)} ${n(yA)}` +
    `A${a(rO)} 0 ${n(-hw)} ${n(yB)}L${n(-hw)} ${n(yC)}A${a(hw)} 1 ${n(hw)} ${n(yC)}L${n(hw)} ${n(yB)}` +
    `A${a(rO)} 0 ${n(W)} ${n(yA)}L${n(W)} ${n(yCc)}A${a(W)} 0 ${n(xi)} ${n(yi)}` +
    `A${a(rI)} 1 ${n(-xi)} ${n(yi)}Z`;
  return { band, border };
}

export function buildFrame(font, texts, F = FRAME) {
  const g = geometry(F);
  const rMid = (g.rBandOut + g.rBandIn) / 2;
  // altezza delle lettere: frazione della fascia (una per tutte le scritte), regolabile dal configuratore
  const size = F.band * Math.min(0.85, Math.max(0.35, texts.height || F.textHeight));
  const capOffset = size * 0.36; // baseline spostata per centrare verticalmente il testo nella fascia
  // ampiezza massima: sopra quasi mezzo cerchio, sotto un quarto meno l'asola
  const slotGap = Math.asin(Math.min(1, (F.bottomSlot.diameter / 2 + F.slotBorder) / rMid)) * 180 / Math.PI + 2;
  const maxTop = 176, maxBottom = 90 - slotGap - 2;
  const pos = texts.pos || {};
  const boxes = {};
  let textD = '';
  for (const key of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight']) {
    const top = key.startsWith('top');
    const rB = top ? rMid - capOffset : rMid + capOffset, maxS = top ? maxTop : maxBottom;
    const span = textSpanDeg(font, texts[key], rB, size, maxS);
    if (!span) continue;
    const c = clampTextPos(key, pos[key] ?? TEXT_DEFAULT_POS[key], span, slotGap);
    boxes[key] = { from: c - span / 2, to: c + span / 2, center: c };
    textD += arcText(font, texts[key], c, rB, size, top, maxS);
  }

  const sb = F.slotBorder > 0 ? slotBorderShapes(F, g) : null;
  return {
    geometry: g,
    // sagoma completa del disco (per la base bianca)
    outline: notchedCircle(F, g.R, true),
    // anello nero esterno con fori laterali e asola
    blackRing: ringPath(F, g),
    // fascia = corona circolare (interrotta dal contorno dell'asola) meno le lettere
    // (evenodd: i "buchi" delle lettere tornano fascia)
    band: (sb ? sb.band : notchedCircle(F, g.rBandOut, false) + notchedCircle(F, g.rBandIn, false)) + textD,
    slotBorder: sb ? sb.border : '',
    text: textD,
    textBoxes: boxes, // dove sono finite le scritte (gradi), per avvisare se due si sovrappongono
    innerLine: notchedCircle(F, g.rBandIn, false) + circlePath(g.rImg),
  };
}

// ======================================================================
// FILE: assets/js/preview3d.js
// ======================================================================
// Anteprima 3D: disco estruso dalle parti SVG montato sul modello reale della lampada.
import * as THREE from '../vendor/three/three.module.js';
import { SVGLoader } from '../vendor/three/addons/SVGLoader.js';
import { OrbitControls } from '../vendor/three/addons/OrbitControls.js';
import { cleanShapes } from './export-stl.js';

// I pezzi della lampada arrivano dal sito (Impostazioni → Lampada 3D) nel formato compatto FLM1:
// "FLM1", n triangoli, minimo xyz, passo, coordinate a 16 bit. Coordinate del file originale in mm (Y in alto,
// fronte verso +Z); ref dice dove sono il centro del disco e la faccia frontale.
const DEFAULT_REF = { cx: 1055.48, cy: 1173.26, front: 1056.74, recess: 2 };
const MATERIALS = {
  opaco: { roughness: 0.75, metalness: 0.02 },
  lucido: { roughness: 0.3, metalness: 0.02 },
  silk: { roughness: 0.28, metalness: 0.45 },
  metallico: { roughness: 0.3, metalness: 0.85 },
};
function decodeFlm(buf) {
  const dv = new DataView(buf);
  if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'FLM1') throw new Error('formato non valido');
  const n = dv.getUint32(4, true), min = [dv.getFloat32(8, true), dv.getFloat32(12, true), dv.getFloat32(16, true)], step = dv.getFloat32(20, true);
  const pos = new Float32Array(n * 9);
  for (let i = 0; i < pos.length; i++) pos[i] = min[i % 3] + dv.getUint16(24 + i * 2, true) * step;
  return pos;
}

// Ombra di contatto: impronta della base sfocata, più scura al centro
function contactShadowTexture([w, d]) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = Math.round(512 * (d * 2.2) / (w * 1.35));
  const ctx = c.getContext('2d');
  const fw = c.width / 1.35, fh = c.height / 2.2;
  ctx.filter = `blur(${Math.round(c.height * 0.08)}px)`;
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.beginPath();
  ctx.roundRect((c.width - fw) / 2, (c.height - fh) / 2, fw, fh, fh * 0.35);
  ctx.fill();
  ctx.filter = `blur(${Math.round(c.height * 0.03)}px)`;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.roundRect((c.width - fw * 0.96) / 2, (c.height - fh * 0.85) / 2, fw * 0.96, fh * 0.85, fh * 0.3);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Preview3D {
  constructor(container, bg = '#ffffff', lamp = null) {
    this.lampCfg = lamp && Array.isArray(lamp.parts) ? lamp : { parts: [] };
    this.ref = { ...DEFAULT_REF, ...(this.lampCfg.ref || {}) };
    this.partMats = {};
    this.container = container;
    this.bg = bg; // sfondo fisso: uguale da spenta e da accesa (colore scelto nelle impostazioni)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
    this.camera.position.set(190, 40, 620);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, -25, 0);
    this.controls.enableDamping = true;

    this.ambient = new THREE.HemisphereLight(0xffffff, 0xd8d8d8, 1.1);
    this.key = new THREE.DirectionalLight(0xffffff, 1.6);
    this.key.position.set(200, 300, 400);
    this.scene.add(this.ambient, this.key);

    this.lamp = new THREE.Group();
    this.scene.add(this.lamp);
    this.disc = new THREE.Group();
    this.lamp.add(this.disc);
    this.colorMats = [];
    this.buildStatic();
    this.setLit(false);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const loop = () => { this.controls.update(); this.renderer.render(this.scene, this.camera); this.raf = requestAnimationFrame(loop); };
    loop();
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  buildStatic() {
    // Ambiente riflesso per i pezzi metallici/silk (stanza chiara con un paio di "finestre" luminose)
    const pm = new THREE.PMREMGenerator(this.renderer), env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial({ color: 0x6c6f75, side: THREE.BackSide })));
    for (const [x, y, z, w] of [[0, 4.9, 0, 6], [4.9, 1, 2, 3], [-4.9, 2, -1, 3]]) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.6), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
      l.position.set(x, y, z); l.lookAt(0, 0, 0); env.add(l);
    }
    this.envMap = pm.fromScene(env, 0.04).texture;

    // Pezzi della lampada: centro del disco in (0,0), faccia frontale della scocca in z=0
    const { cx, cy, front } = this.ref;
    const parts = this.lampCfg.parts || [];
    const box = new THREE.Box3();
    let pending = parts.length;
    const placeShadow = () => {
      if (box.isEmpty()) box.set(new THREE.Vector3(-102, -146, -30), new THREE.Vector3(102, 100, 0));
      const size = new THREE.Vector3(), c = new THREE.Vector3();
      box.getSize(size); box.getCenter(c);
      this.placeShadow([Math.max(60, size.x), Math.max(30, size.z)], box.min.y, c.z);
    };
    if (!pending) placeShadow();
    for (const p of parts) {
      const cfg = MATERIALS[p.material] || MATERIALS.opaco;
      const mat = new THREE.MeshStandardMaterial({ color: p.color, ...cfg, envMap: cfg.metalness > 0.2 ? this.envMap : null, envMapIntensity: 1.1 });
      this.partMats[p.id] = mat;
      fetch(this.lampCfg.url + p.id, { credentials: 'same-origin', headers: this.lampCfg.nonce ? { 'X-WP-Nonce': this.lampCfg.nonce } : {} })
        .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
        .then((buf) => {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(decodeFlm(buf), 3));
          geo.translate(-cx, -cy, -front);
          geo.computeVertexNormals();
          geo.computeBoundingBox();
          box.union(geo.boundingBox);
          this.lamp.add(new THREE.Mesh(geo, mat));
        })
        .catch((e) => console.error('Pezzo della lampada non caricato: ' + p.name, e))
        .finally(() => { if (--pending === 0) placeShadow(); });
    }
  }

  // Ombra morbida dove la base tocca terra (niente pavimento)
  placeShadow(size, floorY, centerZ) {
    if (this.shadow) { this.scene.remove(this.shadow); this.shadow.geometry.dispose(); }
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(size[0] * 1.35, size[1] * 2.2),
      new THREE.MeshBasicMaterial({ map: contactShadowTexture(size), transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, floorY + 0.05, centerZ);
    this.scene.add(shadow);
    this.shadow = shadow;
    this.setLit(this.lit);
  }

  // colori scelti dal cliente per i pezzi: { id: '#rrggbb' }
  setLampColors(map) {
    for (const [id, hex] of Object.entries(map || {})) if (this.partMats[id]) this.partMats[id].color.set(hex);
  }

  // parts: [{ d, color, z, depth, black }]
  setParts(parts) {
    this.disc.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.disc.clear();
    this.colorMats = [];
    this.discDepth = Math.max(0, ...parts.map((p) => (p.z || 0) + (p.depth || 0))); // spessore totale (1 mm)
    const loader = new SVGLoader();
    for (const p of parts) {
      if (!p.d) continue;
      const data = loader.parse(`<svg xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="${p.d}"/></svg>`);
      const shapes = [];
      for (const path of data.paths) shapes.push(...cleanShapes(SVGLoader.createShapes(path), 6));
      if (!shapes.length) continue;
      const geo = new THREE.ExtrudeGeometry(shapes, { depth: p.depth, bevelEnabled: false });
      const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.55, side: THREE.DoubleSide });
      // le parti dopo vincono dove si sovrappongono sullo stesso piano (es. disegno sotto la linea nera)
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -this.disc.children.length * 0.2;
      mat.polygonOffsetUnits = -this.disc.children.length * 2;
      mat.userData.base = new THREE.Color(p.color);
      mat.userData.black = !!p.black;
      if (!p.black) this.colorMats.push(mat);
      const m = new THREE.Mesh(geo, mat);
      m.position.z = p.z;
      this.disc.add(m);
    }
    this.disc.scale.set(1, -1, 1); // SVG ha Y verso il basso
    // Il disco sta tra cover e tappo frontale: faccia anteriore 2 mm dietro il frontale della scocca
    this.disc.position.z = -this.ref.recess - this.discDepth;
    this.setLit(this.lit);
  }

  // Disegno pronto: PNG applicato come texture sulla faccia del disco (stesso spessore e posizione del disco generato)
  setTemplate(url, outlineD) {
    this.disc.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.disc.clear();
    this.colorMats = [];
    const data = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="${outlineD}"/></svg>`);
    const shapes = [];
    for (const path of data.paths) shapes.push(...cleanShapes(SVGLoader.createShapes(path), 24));
    const depth = 1;
    const geo = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false });
    const tex = new THREE.TextureLoader().load(url, () => this.setLit(this.lit), undefined, (e) => console.error('Texture del disegno non caricata', e));
    tex.colorSpace = THREE.SRGBColorSpace;
    // le UV delle facce sono le coordinate in mm (centro 0,0, y in basso): le porto in 0..1 sull'immagine
    tex.repeat.set(1 / 200, -1 / 200);
    tex.offset.set(0.5, 0.5);
    tex.anisotropy = 8;
    const face = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, roughness: 0.55 });
    face.userData.base = new THREE.Color(0xffffff);
    const side = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 });
    this.colorMats.push(face);
    this.disc.add(new THREE.Mesh(geo, [face, side]));
    this.disc.scale.set(1, -1, 1);
    this.disc.position.z = -this.ref.recess - depth;
    this.setLit(this.lit);
  }

  setLit(lit) {
    this.lit = lit;
    this.scene.background = new THREE.Color(this.bg);
    if (this.shadow) this.shadow.material.opacity = lit ? 0.6 : 1;
    this.ambient.intensity = lit ? 0.25 : 0.9;
    this.key.intensity = lit ? 0.35 : 1.6;
    for (const m of this.colorMats) {
      m.emissive.copy(m.userData.base);
      m.emissiveIntensity = lit ? 0.85 : 0;
    }
  }

  snapshot() { return this.renderer.domElement.toDataURL('image/png'); }
}

// ======================================================================
// FILE: assets/js/worker.js
// ======================================================================
// Worker di conversione: immagine (già ritagliata sul cerchio interno) -> mappa a max N colori
// pieni, pulita per la stampa 3D, poi vettorializzata per colore.
// Gira in un Web Worker così la pagina resta reattiva e la foto non lascia mai il browser.


const NONE = 255; // pixel fuori dal cerchio

let last = null; // ultima conversione, per riunire le zone senza rifare tutto
let lastFull = null; // "sopra la fascia": etichette PRIMA del taglio al cerchio (anche fuori dal cerchio)
let paintBase = null; // etichette appena convertite, prima delle colorazioni a mano (per rifarle / annullarle)
let lastCenters = null; // { key, centers, skin }: colori scelti per l'immagine, riusati se cambiano solo grafiche/"sopra la fascia"

self.onmessage = (e) => {
  const { id, imageData, size, ppmm, opts, merge, ovToggle, ovSeeds, paints } = e.data;
  try {
    let result;
    if (merge) result = mergeColors(merge);
    else if (paints) result = repaint(paints);
    else if (ovToggle || ovSeeds) result = overflowAgain(ovToggle, ovSeeds);
    else result = convert(imageData, size, ppmm, opts, (msg) => self.postMessage({ id, progress: msg }));
    last = { labels: result.labels.slice(), palette: result.palette, size: result.size, ppmm: result.ppmm, opts: merge || ovToggle || ovSeeds || paints ? last.opts : opts, framePath: result.framePath, ovSeeds: result.ovSeeds };
    self.postMessage({ id, result }, [result.labels.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack || err) });
  }
};

function convert(rgba, size, ppmm, opts, progress) {
  const n = size * size;
  const cx = (size - 1) / 2, r = size / 2;

  // Maschera del cerchio. Con "sopra la fascia" (opts.ov) il raster arriva fino alla fascia: si elabora tutto,
  // ma i colori si scelgono solo dal cerchio del disegno (kin), poi fuori resta solo ciò che il cliente tocca.
  const inside = new Uint8Array(n);
  const rIn = opts.ov ? opts.ov.rArt : r;
  const kin = opts.ov ? new Uint8Array(n) : inside;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x - cx, dy = y - cx, d2 = dx * dx + dy * dy;
    if (d2 <= r * r) inside[y * size + x] = 1;
    if (opts.ov && d2 <= rIn * rIn) kin[y * size + x] = 1;
    // fuori dal cerchio del disegno conta solo dove c'è davvero l'immagine (oltre il bordo della foto non esce niente)
    const ir = opts.ov && opts.ov.imgRect;
    if (ir && d2 > rIn * rIn && (x < ir[0] || y < ir[1] || x >= ir[2] || y >= ir[3])) inside[y * size + x] = 0;
    // grafiche aggiuntive: contano sempre (anche fuori dalla foto) e i loro colori entrano nella scelta della palette
    if (opts.ov && opts.ov.mask && opts.ov.mask[y * size + x]) { inside[y * size + x] = 1; kin[y * size + x] = 0; }
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
  // stessi colori se cambiano solo cose che non riguardano l'immagine (grafiche aggiuntive, "sopra la fascia"…):
  // il campionamento casuale del k-means darebbe colori diversi solo perché cambia il numero di pixel
  const reuse = opts.paletteKey && lastCenters && lastCenters.key === opts.paletteKey;
  const skin = !reuse && opts.portrait ? skinMask(lab, kin, n, opts.seed || 1) : null;
  if (reuse) {
    centers = lastCenters.centers.map((c) => c.slice());
    skinSet = new Set(lastCenters.skin);
  } else if (skin && k >= 4) {
    const other = new Uint8Array(n);
    for (let i = 0; i < n; i++) other[i] = kin[i] && !skin[i] ? 1 : 0;
    centers = kmeans(lab, other, n, k - 3, opts.seed || 1);
    const sc = kmeans(lab, skin, n, 3, (opts.seed || 1) + 7);
    for (const c of sc) { skinSet.add(centers.length); centers.push(c); }
  } else {
    centers = kmeans(lab, kin, n, k, opts.seed || 1);
  }
  if (!reuse) lastCenters = { key: opts.paletteKey, centers: centers.map((c) => c.slice()), skin: [...skinSet] };
  // grafiche aggiuntive: i colori del disegno restano quelli dell'immagine; quelli della grafica si aggiungono
  // solo se nel disco non c'è già un colore simile (es. Poké Ball: rosso, bianco e nero di solito ci sono già)
  if (opts.ov && opts.ov.mask) {
    let cnt = 0;
    for (let i = 0; i < n; i++) if (opts.ov.mask[i]) cnt++;
    if (cnt > 50) {
      const extra = kmeans(lab, opts.ov.mask, n, Math.min(4, Math.max(1, Math.round(cnt / 2000))), (opts.seed || 1) + 13);
      for (const c of extra) {
        const near = centers.some((d) => (d[0] - c[0]) ** 2 + (d[1] - c[1]) ** 2 + (d[2] - c[2]) ** 2 < 15 * 15);
        if (!near) centers.push(c); // (un nero o un bianco aggiunto qui diventa poi IL nero / IL bianco del disco)
      }
      k = centers.length;
    }
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
      if (!kin[i]) continue;
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
    // linee nere più sottili di una passata dell'ugello (~0,45 mm): non si stamperebbero bene -> colore vicino
    openBlack(labels, inside, size, blackIdx, 0.22 * ppmm);
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

  // 4. Sopra la fascia: fuori dal cerchio restano solo le zone toccate dal cliente (con il loro contorno nero)
  // colorazioni a mano (se la conversione è rifatta con le stesse impostazioni, es. "sopra la fascia")
  paintBase = labels.slice();
  if (opts.paints && opts.paints.length) applyPaints(labels, palette, size, ppmm, opts, opts.paints);

  let framePath = '', seedsOut = [], frameLabels = null;
  lastFull = null;
  if (opts.ov) {
    if (!palette.some((p) => p.black)) palette.push({ r: 20, g: 20, b: 20, area: 0, black: true, white: false, skin: false });
    lastFull = labels.slice();
    const o = applyOverflow(lastFull, palette, size, ppmm, opts, opts.ov.seeds || []);
    labels = o.labels; frameLabels = o.frameLabels; seedsOut = o.seeds;
  }

  // 5. Vettorializzazione
  progress('Vettorializzazione');
  const tr = traceWithFrame(labels, frameLabels, size, palette.length, opts);
  const layers = tr.layers;
  framePath = tr.framePath;

  return { labels, palette, layers, size, ppmm, framePath, ovSeeds: seedsOut };
}

// ---------- sopra la fascia ----------
// full: etichette su tutto il raster. Dentro il cerchio del disegno resta tutto; fuori (fino all'anello nero)
// restano solo le zone toccate (seeds, in mm) e un contorno nero di spessore pari alle linee del disegno,
// tranne la zona dell'asola in basso. Ritorna anche le etichette con la "zona cornice" (vedi frameLabelsOf).
function applyOverflow(full, palette, size, ppmm, opts, seedsMm) {
  const ov = opts.ov, n = size * size, cx = (size - 1) / 2;
  const sc = opts.scale ?? 1, off = opts.offset ?? 0;
  const blackIdx = palette.findIndex((p) => p.black);
  const { comp } = components(full, size);
  const toPx = (v) => (v - off) / sc;
  const sel = new Set(), seeds = [];
  // zone troppo grandi fuori dal cerchio = sfondo: riempirebbero la fascia, non le faccio uscire
  const ringPx = Math.PI * (ov.rKeep * ov.rKeep - ov.rArt * ov.rArt);
  const outerCount = new Map();
  {
    const rA2 = ov.rArt * ov.rArt, rK2 = ov.rKeep * ov.rKeep;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (full[i] === NONE) continue;
      const dx = x - cx, dy = y - cx, d2 = dx * dx + dy * dy;
      if (d2 > rA2 && d2 <= rK2) outerCount.set(comp[i], (outerCount.get(comp[i]) || 0) + 1);
    }
  }
  let tooBig = false;
  for (const [mx, my] of seedsMm) {
    const x = Math.round(toPx(mx)), y = Math.round(toPx(my));
    if (x < 0 || y < 0 || x >= size || y >= size) continue;
    // tocco su una linea nera: prendo la zona colorata più vicina (entro ~1,5 mm)
    let i = -1;
    const R = Math.ceil(1.5 * ppmm);
    for (let rr = 0; rr <= R && i < 0; rr++) {
      for (let yy = y - rr; yy <= y + rr && i < 0; yy++) for (let xx = x - rr; xx <= x + rr; xx++) {
        if (Math.max(Math.abs(xx - x), Math.abs(yy - y)) !== rr || xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const j = yy * size + xx;
        if (full[j] !== NONE && full[j] !== blackIdx) { i = j; break; }
      }
    }
    if (i < 0 || sel.has(comp[i])) continue;
    if ((outerCount.get(comp[i]) || 0) > ringPx * 0.3) { tooBig = true; continue; }
    sel.add(comp[i]); seeds.push([mx, my]);
  }
  const isSel = new Uint8Array(n);
  if (sel.size) for (let i = 0; i < n; i++) if (full[i] !== NONE && sel.has(comp[i])) isSel[i] = 1;
  // grafiche aggiuntive: la loro sagoma esce sempre dal cerchio (fino all'anello nero), con il contorno nero
  let anySel = sel.size > 0;
  if (ov.mask) for (let i = 0; i < n; i++) if (ov.mask[i] && full[i] !== NONE) { isSel[i] = 1; anySel = true; }
  const dist = anySel ? distanceFrom(isSel, size) : null;
  const lineW = Math.max(1, opts.lineMm * ppmm);
  const labels = new Uint8Array(full);
  const rArt2 = ov.rArt * ov.rArt, rKeep2 = ov.rKeep * ov.rKeep;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    if (full[i] === NONE) continue;
    const dx = x - cx, dy = y - cx, d2 = dx * dx + dy * dy;
    if (d2 <= rArt2) continue;
    const slot = dy > 0 && Math.abs(dx) < ov.slotHalf;
    if (d2 > rKeep2 || slot || !anySel) { labels[i] = NONE; continue; }
    if (isSel[i]) continue;
    if (dist[i] <= lineW) { labels[i] = blackIdx; continue; }
    labels[i] = NONE;
  }
  // aree aggiornate (contano solo i pixel stampati)
  const counts = new Uint32Array(palette.length);
  for (let i = 0; i < n; i++) if (labels[i] !== NONE) counts[labels[i]]++;
  palette.forEach((p, i) => { p.area = counts[i] / (ppmm * ppmm); });
  return { labels, fgPath: '', seeds, tooBig, frameLabels: anySel ? frameLabelsOf(labels, size, ov, palette.length) : null };
}

// Etichette con la "zona cornice" (tutto ciò che fuori dal cerchio del disegno NON è disegno) come colore in più:
// vettorializzata insieme al disegno, il suo bordo coincide al millesimo con quello delle parti che escono.
// L'app usa questa zona per ritagliare fascia, linea interna, scritte e asola (niente fessure, niente sovrapposizioni).
function frameLabelsOf(labels, size, ov, frameIdx) {
  const cx = (size - 1) / 2, rA2 = ov.rArt * ov.rArt;
  const out = new Uint8Array(labels);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, dx = x - cx, dy = y - cx;
    if (out[i] === NONE && dx * dx + dy * dy > rA2) out[i] = frameIdx;
  }
  return out;
}
// layers + percorso della zona cornice, in una sola vettorializzazione (stessi bordi)
function traceWithFrame(labels, frameLabels, size, ncolors, opts) {
  if (!frameLabels) return { layers: trace(labels, size, ncolors, opts), framePath: '' };
  const all = trace(frameLabels, size, ncolors + 1, opts);
  const framePath = all.pop();
  return { layers: all, framePath };
}

// ---------- colora a mano ----------
// paints: [{ x, y (mm), to (indice della palette) }]: la zona toccata (tocco su una linea nera = zona colorata più
// vicina) prende il colore "to". Zone vicine dello stesso colore senza linea in mezzo diventano una zona sola.
// Le zone sono quelle della conversione di partenza (base): anche dopo "svuota i colori" il pennello riempie
// la zona come era disegnata, non tutto il bianco unito.
function applyPaints(labs, palette, size, ppmm, opts, paints, base = labs.slice()) {
  const sc = opts.scale ?? 1, off = opts.offset ?? 0, toPx = (v) => Math.round((v - off) / sc);
  const blackIdx = palette.findIndex((p) => p.black);
  let comp = null;
  for (const pt of paints) {
    if (!(pt.to >= 0 && pt.to < 250)) continue;
    // colore nuovo preso dal catalogo: voce in più nella palette (il colore vero lo decide l'app)
    while (palette.length <= pt.to) {
      const h = /^#[0-9a-f]{6}$/i.test(pt.hex || '') ? parseInt(pt.hex.slice(1), 16) : 0x808080;
      palette.push({ r: h >> 16, g: (h >> 8) & 255, b: h & 255, area: 0, black: false, white: !!pt.clear, skin: false });
    }
    // "svuota i colori": tutto ciò che non è nero diventa il colore "to" (il bianco)
    if (pt.clear) { for (let i = 0; i < labs.length; i++) if (labs[i] !== NONE && labs[i] !== blackIdx) labs[i] = pt.to; continue; }
    // penna: tratto a mano libera (punti in mm, spessore w in mm) disegnato direttamente nelle zone
    if (pt.pen) { penStroke(labs, size, pt, sc, off); continue; }
    const x = toPx(pt.x), y = toPx(pt.y), R = Math.ceil(1.5 * ppmm);
    let at = -1;
    for (let rr = 0; rr <= R && at < 0; rr++) for (let yy = y - rr; yy <= y + rr && at < 0; yy++) for (let xx = x - rr; xx <= x + rr; xx++) {
      if (Math.max(Math.abs(xx - x), Math.abs(yy - y)) !== rr || xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
      const j = yy * size + xx;
      if (base[j] !== NONE && base[j] !== blackIdx) { at = j; break; }
    }
    if (at < 0) continue;
    if (!comp) comp = components(base, size).comp;
    const c = comp[at];
    for (let i = 0; i < labs.length; i++) if (comp[i] === c && labs[i] !== NONE) labs[i] = pt.to;
  }
}
function penStroke(labs, size, pt, sc, off) {
  const pxPerMm = 1 / sc;
  const r = Math.max(0.5, (pt.w / 2) * pxPerMm);
  const R = Math.ceil(r), r2 = r * r;
  const disk = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= r2) disk.push(dy * size + dx, dx, dy);
  const stamp = (fx, fy) => {
    const x = Math.round(fx), y = Math.round(fy);
    for (let k = 0; k < disk.length; k += 3) {
      const xx = x + disk[k + 1], yy = y + disk[k + 2];
      if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
      const j = yy * size + xx;
      if (labs[j] !== NONE) labs[j] = pt.to;
    }
  };
  const P = (pt.pts || []).map(([x, y]) => [(x - off) / sc, (y - off) / sc]);
  if (!P.length) return;
  stamp(P[0][0], P[0][1]);
  const step = Math.max(0.5, r / 2);
  for (let i = 1; i < P.length; i++) {
    const [ax, ay] = P[i - 1], [bx, by] = P[i], L = Math.hypot(bx - ax, by - ay), n = Math.ceil(L / step);
    for (let s = 1; s <= n; s++) stamp(ax + (bx - ax) * s / n, ay + (by - ay) * s / n);
  }
}

// Rifà tutte le colorazioni a mano dalla conversione di partenza (serve anche per "Annulla")
function repaint(paints) {
  if (!paintBase) throw new Error('colora a mano: manca la conversione');
  const { palette: pal, size, ppmm, opts } = last;
  const palette = pal.map((p) => ({ ...p }));
  const labs = new Uint8Array(paintBase);
  applyPaints(labs, palette, size, ppmm, opts, paints, paintBase);
  last.opts = { ...opts, paints };
  if (opts.ov) {
    lastFull = labs;
    const seeds = opts.ov.seeds || [];
    const o = applyOverflow(lastFull, palette, size, ppmm, last.opts, seeds);
    const tr = traceWithFrame(o.labels, o.frameLabels, size, palette.length, last.opts);
    return { labels: o.labels, palette, layers: tr.layers, size, ppmm, framePath: tr.framePath, ovSeeds: seeds, merged: true, keep: true };
  }
  const counts = new Uint32Array(palette.length);
  for (let i = 0; i < labs.length; i++) if (labs[i] !== NONE) counts[labs[i]]++;
  palette.forEach((p, i) => { p.area = counts[i] / (ppmm * ppmm); });
  return { labels: labs, palette, layers: trace(labs, size, palette.length, opts), size, ppmm, framePath: '', ovSeeds: [], merged: true, keep: true };
}

// Tocco sull'anteprima: aggiunge la zona toccata, o la toglie se era già fuori. Rifà solo il taglio.
function overflowAgain(toggle, seedsIn) {
  if (!lastFull || !last.opts.ov) throw new Error('sopra la fascia: manca la conversione');
  const { palette: pal, size, ppmm, opts } = last;
  const palette = pal.map((p) => ({ ...p }));
  let seeds = (seedsIn || last.opts.ov.seeds || []).slice();
  if (toggle) {
    const sc = opts.scale ?? 1, off = opts.offset ?? 0, toPx = (v) => Math.round((v - off) / sc);
    const { comp } = components(lastFull, size);
    const blackIdx = palette.findIndex((p) => p.black);
    const at = (m) => {
      const x = toPx(m[0]), y = toPx(m[1]), R = Math.ceil(1.5 * ppmm);
      for (let rr = 0; rr <= R; rr++) for (let yy = y - rr; yy <= y + rr; yy++) for (let xx = x - rr; xx <= x + rr; xx++) {
        if (Math.max(Math.abs(xx - x), Math.abs(yy - y)) !== rr || xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const j = yy * size + xx;
        if (lastFull[j] !== NONE && lastFull[j] !== blackIdx) return j;
      }
      return -1;
    };
    const ti = at(toggle);
    if (ti >= 0) {
      const c = comp[ti], before = seeds.length;
      seeds = seeds.filter((m) => { const i = at(m); return i < 0 || comp[i] !== c; });
      if (seeds.length === before) seeds.push(toggle);
    }
  }
  last.opts = { ...opts, ov: { ...opts.ov, seeds } };
  const o = applyOverflow(lastFull, palette, size, ppmm, last.opts, seeds);
  const tr = traceWithFrame(o.labels, o.frameLabels, size, palette.length, last.opts);
  // la zona toccata non arriva fuori dal cerchio? (nessun pixel tenuto oltre il cerchio del disegno)
  let out = 0;
  if (o.frameLabels) { const cx = (size - 1) / 2, rA2 = last.opts.ov.rArt ** 2; for (let i = 0; i < o.labels.length && !out; i++) { if (o.labels[i] === NONE) continue; const x = i % size, y = (i / size) | 0; if ((x - cx) ** 2 + (y - cx) ** 2 > rA2) out = 1; } }
  return { labels: o.labels, palette, layers: tr.layers, size, ppmm, framePath: tr.framePath, ovSeeds: o.seeds, ovTooBig: o.tooBig, ovNoOut: !!toggle && o.seeds.length > (seedsIn || []).length && !out, merged: true, keep: true };
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
  if (lastFull) for (let i = 0; i < lastFull.length; i++) if (lastFull[i] !== NONE) lastFull[i] = remap[lastFull[i]];
  if (paintBase) for (let i = 0; i < paintBase.length; i++) if (paintBase[i] !== NONE) paintBase[i] = remap[paintBase[i]];
  const frameLabels = opts.ov && last.framePath ? frameLabelsOf(labels, size, opts.ov, newPal.length) : null;
  const tr = traceWithFrame(labels, frameLabels, size, newPal.length, opts);
  return { labels, palette: newPal, layers: tr.layers, size, ppmm, merged: true, framePath: tr.framePath, ovSeeds: last.ovSeeds || [] };
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

// Nero più stretto di 2r (punte sottilissime, linee d'ombra sfumate): diventa il colore della zona accanto
function openBlack(labels, inside, size, blackIdx, r) {
  if (r < 0.75) return;
  const n = labels.length;
  const notBlack = new Uint8Array(n);
  for (let i = 0; i < n; i++) notBlack[i] = labels[i] !== blackIdx ? 1 : 0;
  const d = distanceFrom(notBlack, size);
  const core = new Uint8Array(n);
  for (let i = 0; i < n; i++) core[i] = !notBlack[i] && d[i] >= r ? 1 : 0;
  const d2 = distanceFrom(core, size);
  const thin = [];
  for (let i = 0; i < n; i++) if (!notBlack[i] && inside[i] && d2[i] > r + 0.5) thin.push(i);
  // riempio dal bordo verso l'interno con il colore vicino (mai NONE)
  let todo = thin;
  for (let pass = 0; pass < 2 * r + 4 && todo.length; pass++) {
    const next = [], set = [];
    for (const i of todo) {
      const x = i % size;
      let v = -1;
      for (const j of [i - 1, i + 1, i - size, i + size]) {
        if (j < 0 || j >= n || (j === i - 1 && x === 0) || (j === i + 1 && x === size - 1)) continue;
        const L = labels[j];
        if (L !== blackIdx && L !== NONE) { v = L; break; }
      }
      if (v >= 0) set.push(i, v); else next.push(i);
    }
    for (let k = 0; k < set.length; k += 2) labels[set[k]] = set[k + 1];
    todo = next;
  }
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
