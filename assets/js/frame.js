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
  const size = F.band * F.textHeight;
  const capOffset = size * 0.36; // baseline spostata per centrare verticalmente il testo nella fascia
  const textD =
    arcText(font, texts.topLeft, -135, rMid - capOffset, size, true, F.textMaxSpanDeg) +
    arcText(font, texts.topRight, -45, rMid - capOffset, size, true, F.textMaxSpanDeg) +
    arcText(font, texts.bottomLeft, 125, rMid + capOffset, size, false, F.textMaxSpanDeg * 0.5) +
    arcText(font, texts.bottomRight, 55, rMid + capOffset, size, false, F.textMaxSpanDeg * 0.5);

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
    innerLine: notchedCircle(F, g.rBandIn, false) + circlePath(g.rImg),
  };
}
