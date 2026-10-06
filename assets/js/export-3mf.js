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
