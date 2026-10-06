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
