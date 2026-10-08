// Export per Bambu Studio: un STL per colore, tutti con la stessa origine (si importano come
// "oggetto con più parti" e si posizionano da soli). mm, Y in alto, Z da 0 (piano di stampa).
import * as THREE from '../vendor/three/three.module.js';
import { SVGLoader } from '../vendor/three/addons/SVGLoader.js';

// Centro del disco nel file: così tutte le coordinate sono positive (disco da 0 a 200)
const CENTER = [100, 100];

// Punti di un contorno con le curve divise in base alla lunghezza (segLen mm per tratto): gli archi grandi (bordo del
// disco, fascia) vengono lisci, le curve piccole (lettere, contorni del disegno) restano leggere.
function curvePoints(path, segLen, cap) {
  const out = [];
  for (const c of path.curves) {
    const n = c.isLineCurve ? 1 : Math.max(2, Math.min(cap, Math.ceil(c.getLength() / segLen)));
    const pts = c.getPoints(n);
    out.push(...(out.length ? pts.slice(1) : pts));
  }
  return out;
}

// Rifà le forme togliendo i punti doppi consecutivi (es. fine di una linea = inizio di un arco):
// il triangolatore ci inciampa e crea triangoli che riempiono i buchi.
// segLen: lunghezza massima di un tratto di curva in mm (anteprima 3D più grossa, file di stampa più fine).
export function cleanShapes(shapes, segLen = 0.4, cap = 720) {
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
    const shape = curvePoints(sh, segLen, cap), holes = sh.holes.map((h) => curvePoints(h, segLen, cap));
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
