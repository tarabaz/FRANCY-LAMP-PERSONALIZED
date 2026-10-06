// Cornice fissa del disco (anello nero con tacche + fascia colorata con scritte).
// Tutte le misure sono in mm, centro del disco in (0,0), asse Y verso il basso (come SVG).
// Tacche e asola: quote reali fornite da Valerio. Spessori anello/fascia: stimati dalla grafica "Cubone".

import { parse as parseFont } from '../vendor/opentype.mjs';

export const FRAME = {
  diameter: 200,          // diametro totale disco
  blackRing: 11,          // spessore anello nero esterno
  band: 11.5,             // spessore fascia colorata
  innerLine: 1.6,         // spessore linea nera tra fascia e disegno
  overlap: 0.8,           // quanto il disegno va sotto la linea nera interna
  sideNotch: { diameter: 10, heightFromBottom: 200 * 2 / 3 }, // fori laterali: centro sul bordo a 2/3 dell'altezza
  bottomSlot: { diameter: 10, centerFromBottom: 12 },          // asola in basso a U: centro foro a 12 mm dal fondo
  textHeight: 0.62,       // altezza testo come frazione della fascia
  textMaxSpanDeg: 80,     // ampiezza massima di un testo sull'arco
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
export function buildFrame(font, texts, F = FRAME) {
  const g = geometry(F);
  const rMid = (g.rBandOut + g.rBandIn) / 2;
  const size = F.band * F.textHeight;
  const capOffset = size * 0.36; // baseline spostata per centrare verticalmente il testo nella fascia
  const textD =
    arcText(font, texts.topLeft, -135, rMid - capOffset, size, true, F.textMaxSpanDeg) +
    arcText(font, texts.topRight, -45, rMid - capOffset, size, true, F.textMaxSpanDeg) +
    arcText(font, texts.bottomLeft, 125, rMid + capOffset, size, false, F.textMaxSpanDeg * 0.5) +
    arcText(font, texts.bottomRight, 55, rMid + capOffset, size, false, F.textMaxSpanDeg * 0.5);

  return {
    geometry: g,
    // anello nero = contorno con tacche meno cerchio della fascia (evenodd)
    blackRing: notchedCircle(F, g.R, true) + notchedCircle(F, g.rBandOut, false),
    // fascia = corona circolare meno le lettere (evenodd: i "buchi" delle lettere tornano fascia)
    band: notchedCircle(F, g.rBandOut, false) + notchedCircle(F, g.rBandIn, false) + textD,
    text: textD,
    innerLine: notchedCircle(F, g.rBandIn, false) + circlePath(g.rImg),
  };
}
