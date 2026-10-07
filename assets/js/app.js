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
  painting: false, brush: -1, paints: [], // colora a mano: pennello = indice della palette, tocchi in mm
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
    $('#aiUndo').hidden = true;
    setImage(img, zoom, 0, 0);
  };
  img.src = src;
}

function setImage(img, zoom, ox, oy) {
  state.img = img; state.zoom = zoom; state.ox = ox; state.oy = oy;
  state.ovSeeds = []; // immagine nuova: le parti sopra la fascia si scelgono di nuovo
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
  // carta da gioco: si manda la carta intera e torna un quadrato con solo l'illustrazione (inquadratura nuova)
  const card = !!CFG.aiCard && $('#aiCard').checked;
  const [rw, rh] = card ? [1, 1] : AI_RATIOS.reduce((best, r) => (Math.abs(Math.log(ratio * r[1] / r[0])) < Math.abs(Math.log(ratio * best[1] / best[0])) ? r : best));
  let cw = o.width, ch = (cw * rh) / rw;
  if (ch > o.height) { ch = o.height; cw = (ch * rw) / rh; }
  const s0 = coverFor(o) * src.zoom;
  const vcx = o.width / 2 - src.ox / s0, vcy = o.height / 2 - src.oy / s0;    // centro inquadrato, in pixel della foto
  let cx0 = Math.min(Math.max(0, vcx - cw / 2), o.width - cw), cy0 = Math.min(Math.max(0, vcy - ch / 2), o.height - ch);
  if (card) { cx0 = 0; cy0 = 0; cw = o.width; ch = o.height; }
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
    if (card) {
      state.aiCrop = null; // illustrazione nuova, centrata: niente da riallineare con la foto
      setImage(img, 1, 0, 0);
    } else {
      const s1 = (s0 * cw) / img.width;
      state.aiCrop = { cx0, cy0, cw, ch };
      setImage(img, Math.min(4, Math.max(1, s1 / coverFor(img))), src.ox + s0 * (cx0 + cw / 2 - o.width / 2), src.oy + s0 * (cy0 + ch / 2 - o.height / 2));
    }
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
  // con "sopra la fascia" il raster arriva oltre la fascia; l'immagine resta inquadrata sul cerchio del disegno
  const rRaster = state.overflow ? g.rBandOut + 1 : g.rImgArt;
  const inner = Math.round(2 * g.rImgArt * ppmm);
  const size = state.overflow ? Math.round(2 * rRaster * ppmm) : inner;
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
    scale: (2 * rRaster) / size,
    offset: -rRaster,
    ov: state.overflow ? {
      rArt: g.rImgArt * size / (2 * rRaster), rImg: g.rImg * size / (2 * rRaster),
      rKeep: (g.rBandOut + 0.3) * size / (2 * rRaster),          // l'anello nero esterno ci va sopra
      slotHalf: (FRAME.bottomSlot.diameter / 2 + FRAME.slotBorder + 0.6) * size / (2 * rRaster),
      seeds: state.ovSeeds,
      imgRect: imgRect(inner, shift),
    } : null,
  };
  const id = ++jobId;
  state.pendingOv = state.overflow;
  state.paints = []; // nuova conversione: si ricolora da capo
  setStatus('Elaborazione…');
  worker.postMessage({ id, imageData, size, ppmm, opts }, [imageData.buffer]);
}

worker.onmessage = (e) => {
  const { id, progress, result, error } = e.data;
  if (id !== jobId) return;
  if (progress) return setStatus(progress + '…');
  if (error) { console.error(error); return setStatus('Errore nella conversione'); }
  state.result = result;
  if (!result.keep) { state.colorOverrides = {}; state.resultOv = !!state.pendingOv; state.baseLayers = result.layers; }
  state.ovSeeds = result.ovSeeds || [];
  state.ovNote = result.ovTooBig ? 'Quella zona è sfondo: riempirebbe tutta la fascia, quindi resta dentro il cerchio.'
    : result.ovNoOut ? 'Quella parte non arriva al bordo del cerchio: allarga un po\' lo zoom o sposta l\'immagine perché sporga.' : '';
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
      ctrl.addEventListener('click', (ev) => { if (state.painting) return; openFilamentPopover(ctrl, (hex) => { state.colorOverrides[i] = hex; renderPalette(); render(); },
        (hex) => !otherDrawingColors(i).has(hex) && (colorSet().has(hex) || colorSet().size < MAX_FILAMENTS)); });
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
    li.append(ctrl, name, area);
    ul.append(li);
  });
}

// ---------------- composizione ----------------
function texts() {
  // posizioni dagli slider: sopra il valore è già l'angolo (-180 sinistra … 0 destra);
  // sotto lo slider va da sinistra a destra, l'angolo da 180 (sinistra) a 0 (destra)
  return { topLeft: $('#tTL').value, topRight: $('#tTR').value, bottomLeft: $('#tBL').value, bottomRight: $('#tBR').value,
    pos: { topLeft: +$('#pTL').value, topRight: +$('#pTR').value, bottomLeft: 180 - +$('#pBL').value, bottomRight: 180 - +$('#pBR').value } };
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
  const fgPath = state.overflow && state.result ? state.result.framePath : '';
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
    ? `<g id="guida-zone" fill="none" stroke="#d0342c" stroke-opacity=".75" stroke-width="0.22" stroke-dasharray="0.8 0.5" pointer-events="none">${state.baseLayers.map((d) => (d ? `<path d="${d}"/>` : '')).join('')}</g>`
    : '';
  $('#svgHost').innerHTML = guide ? svg.replace('</svg>', guide + '</svg>') : svg;
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

// ---------------- colora a mano ----------------
function paintIndexFor(hex) {
  const pal = state.result.palette;
  hex = hex.toLowerCase();
  const found = pal.findIndex((p, i) => p.area > 0 && !(p.black && hex !== BLACK) && artColor(i) === hex);
  if (found >= 0) return found;
  // colore nuovo: voce in più (anche se ce n'è già una in attesa nei tocchi non ancora tornati)
  return Math.max(pal.length, ...state.paints.map((x) => x.to + 1));
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
function updatePaintUi() {
  $('#paintBar').hidden = !state.result || !!state.template || !state.filaments.length;
  $('#paintPanel').hidden = !state.painting;
  $('#paintOn').hidden = state.painting;
  $('#paintUndo').disabled = !state.paints.length;
  root.classList.toggle('paint-mode', state.painting);
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
  state.overflow = $('#ovOn').checked;
  state.ovSeeds = [];
  if (state.overflow && state.view === '3d') document.querySelector('.tabs button[data-view="2d"]').click(); // si sceglie sulla vista 2D
  updateOvUi();
  run();
});
$('#ovClear').addEventListener('click', () => {
  if (!state.resultOv) return;
  worker.postMessage({ id: ++jobId, ovSeeds: [] });
});
$('#svgHost').addEventListener('click', (e) => {
  if (!state.result || state.template) return;
  const svg = $('#svgHost svg');
  if (!svg) return;
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const m = pt.matrixTransform(svg.getScreenCTM().inverse());
  if (state.painting) { if (Math.hypot(m.x, m.y) <= geometry().rBandOut) paintAt(Math.round(m.x * 100) / 100, Math.round(m.y * 100) / 100); return; }
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
    4: ['Fascia ' + bandLabel(state.bandColor).toLowerCase() + (words.length ? ' · ' + words.join(', ') : ' · senza scritte') + (state.overflow && state.ovSeeds.length && !tpl ? ' · esce dal cerchio' : ''), img || tpl],
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
    if (!tpl && state.paints.length) rows.push(['Colorato a mano', `${state.paints.length} ${state.paints.length === 1 ? 'tocco' : 'tocchi'}`]);
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
    impostazioni: { modalita: state.mode, ritratto: $('#portrait').checked, colori: +$('#colors').value, luminosita: adjust.b, contrasto: adjust.c, saturazione: adjust.s, sopra_fascia: state.overflow ? state.ovSeeds.length : 0, ia: !!state.aiImageSrc, stile_ia: state.aiImageSrc ? aiStyle : null, sfondo_ia: state.aiImageSrc ? (state.aiBackground || 'originale') : null, fornitore_ia: state.aiProvider || null },
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
