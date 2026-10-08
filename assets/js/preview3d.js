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

// Venatura del legno generata (niente immagini da scaricare): righe lunghe con nodi e variazioni di tono
function woodTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c99a6b'; ctx.fillRect(0, 0, c.width, c.height);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 140; i++) {
    const y = rnd() * c.height, a = 0.04 + rnd() * 0.1, w = 0.6 + rnd() * 2.2;
    ctx.strokeStyle = rnd() < 0.5 ? `rgba(92,58,30,${a})` : `rgba(240,205,160,${a})`;
    ctx.lineWidth = w;
    ctx.beginPath();
    for (let x = 0; x <= c.width; x += 16) ctx.lineTo(x, y + Math.sin(x / (60 + rnd() * 40) + i) * (1.5 + rnd() * 2.5));
    ctx.stroke();
  }
  for (let k = 0; k < 3; k++) { // qualche nodo
    const x = rnd() * c.width, y = rnd() * c.height;
    for (let r = 14; r > 2; r -= 2.5) { ctx.strokeStyle = `rgba(90,55,28,${0.12})`; ctx.beginPath(); ctx.ellipse(x, y, r * 2.6, r, 0, 0, Math.PI * 2); ctx.stroke(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
// Ombra morbida rotonda (pavimento sotto il tavolino)
function softShadowTexture(alpha = 0.35) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
  g.addColorStop(0, `rgba(0,0,0,${alpha})`); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Preview3D {
  // scene: ambientazione { on, wood: url texture legno, wall: url texture muro } (Impostazioni → Anteprima e watermark)
  constructor(container, bg = '#ffffff', lamp = null, scene = null) {
    this.sceneCfg = scene || {};
    this.roomOn = this.sceneCfg.on !== false;
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
    // con l'ambientazione l'inquadratura è un po' più larga (si vede il tavolino)
    if (this.roomOn) this.camera.position.set(230, 70, 780); else this.camera.position.set(190, 40, 620);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, this.roomOn ? -40 : -25, 0);
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
    this.controls.maxDistance = 1800;
    const loop = () => { this.controls.update(); this.updateWall(); this.renderer.render(this.scene, this.camera); this.raf = requestAnimationFrame(loop); };
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
      this.buildRoom(box);
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
          const mesh = new THREE.Mesh(geo, mat);
          mesh.userData.partName = String(p.name || '');
          this.lamp.add(mesh);
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

  // ---------- ambientazione: tavolino da muro, cavo, alimentatore 12 V nella presa, muro che sparisce da dietro ----------
  buildRoom(box) {
    if (this.room) { this.scene.remove(this.room); this.room.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    const room = new THREE.Group();
    const top = box.min.y;                         // il piano del tavolino è dove appoggia la lampada
    const lampBack = box.min.z, lampFront = box.max.z;
    const T = { w: 560, th: 22, legH: 700 };
    const zBack = lampBack - 70, zFront = Math.max(lampFront + 90, zBack + 200); // profondità ~ 25 cm
    const depth = zFront - zBack, zMid = (zBack + zFront) / 2;
    // texture dall'admin (Libreria media) oppure quella generata
    const loadTex = (url, onload) => {
      const t = new THREE.TextureLoader().load(url, onload, undefined, (e) => console.warn('Texture non caricata', url, e));
      t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
      return t;
    };
    // texture caricata: una ripetizione ogni ~60 cm in larghezza, altezza secondo le proporzioni dell'immagine
    // (le UV del piano valgono 1 ogni 420 x 140 mm)
    const wood = this.sceneCfg.wood
      ? loadTex(this.sceneCfg.wood, (t) => { const k = t.image.width / t.image.height || 1; t.repeat.set(420 / 600, 140 / (600 / k)); t.needsUpdate = true; })
      : woodTexture();
    const woodMat = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.62, metalness: 0 });
    // piano con bordi arrotondati
    const sh = new THREE.Shape();
    const r = 8, hw = T.w / 2, hd = depth / 2;
    sh.moveTo(-hw + r, -hd); sh.lineTo(hw - r, -hd); sh.quadraticCurveTo(hw, -hd, hw, -hd + r); sh.lineTo(hw, hd - r);
    sh.quadraticCurveTo(hw, hd, hw - r, hd); sh.lineTo(-hw + r, hd); sh.quadraticCurveTo(-hw, hd, -hw, hd - r); sh.lineTo(-hw, -hd + r); sh.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
    const topGeo = new THREE.ExtrudeGeometry(sh, { depth: T.th, bevelEnabled: true, bevelThickness: 2, bevelSize: 2, bevelSegments: 3, curveSegments: 6 });
    topGeo.rotateX(Math.PI / 2); // estrusione verso il basso
    const uv = topGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 420, uv.getY(i) / 140);
    const tabletop = new THREE.Mesh(topGeo, woodMat);
    tabletop.position.set(0, top - 2, zMid);
    room.add(tabletop);
    // gambe sottili leggermente inclinate, nere
    const legMat = new THREE.MeshStandardMaterial({ color: 0x232325, roughness: 0.5, metalness: 0.35 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(7, 5, T.legH, 16), legMat);
      leg.position.set(sx * (hw - 40), top - T.th - T.legH / 2, zMid + sz * (hd - 30));
      leg.rotation.z = sx * 0.04; leg.rotation.x = -sz * 0.03;
      room.add(leg);
    }
    const floorY = top - T.th - T.legH;
    const floorShadow = new THREE.Mesh(new THREE.PlaneGeometry(T.w * 1.5, depth * 2.6), new THREE.MeshBasicMaterial({ map: softShadowTexture(0.32), transparent: true, depthWrite: false }));
    floorShadow.rotation.x = -Math.PI / 2; floorShadow.position.set(0, floorY + 0.5, zMid);
    room.add(floorShadow);

    // muro dietro (sparisce girando la vista da dietro)
    const wallZ = zBack - 14;
    this.wallMat = new THREE.MeshStandardMaterial({ color: 0xe9e4dc, roughness: 0.95, transparent: true });
    if (this.sceneCfg.wall) { // texture ripetuta circa ogni 60 cm
      this.wallMat.color.set(0xffffff);
      this.wallMat.map = loadTex(this.sceneCfg.wall, (t) => { const k = t.image.width / t.image.height || 1; t.repeat.set(2400 / 600, 1900 / (600 / k)); t.needsUpdate = true; });
    }
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(2400, 1900), this.wallMat);
    wall.position.set(0, floorY + 950, wallZ);
    room.add(wall);
    this.wall = wall; this.wallZ = wallZ;

    // presa italiana a muro, in basso a destra dietro il tavolino, con l'alimentatore 12 V inserito
    const sock = new THREE.Group();
    const plateMat = new THREE.MeshStandardMaterial({ color: 0xf4f3ef, roughness: 0.45 });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(76, 76, 9), plateMat);
    sock.add(plate);
    const insert = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 3, 40), new THREE.MeshStandardMaterial({ color: 0xe6e5e0, roughness: 0.5 }));
    insert.rotation.x = Math.PI / 2; insert.position.z = 5.5; sock.add(insert);
    const adMat = new THREE.MeshStandardMaterial({ color: 0x161617, roughness: 0.42 });
    const adapter = new THREE.Mesh(new THREE.BoxGeometry(46, 62, 34, 2, 2, 2), adMat);
    adapter.position.set(0, -6, 7 + 17); sock.add(adapter);
    const ledMat = new THREE.MeshBasicMaterial({ color: 0x3dd6ff });
    const led = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 1, 12), ledMat);
    led.rotation.x = Math.PI / 2; led.position.set(14, 14, 7 + 34 + 0.5); sock.add(led);
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(18, 3), new THREE.MeshBasicMaterial({ color: 0x3a3a3c }));
    logo.position.set(0, -14, 7 + 34 + 0.3); sock.add(logo);
    const sx = hw - 70, sy = floorY + 360;
    sock.position.set(sx, sy, wallZ + 4.5);
    room.add(sock);

    // cavo: spinotto a 2 cm dal piano d'appoggio, al centro del retro della base (come la lampada vera), infilato 1,5 mm
    // (la superficie del retro si trova con un raggio sparato da dietro sul modello vero); poi sul piano, giù dal bordo
    // dietro e fino all'alimentatore
    const meshes = this.lamp.children.filter((m) => m.isMesh && m.geometry && m.geometry.boundingBox);
    const baseMesh = meshes.find((m) => /base/i.test(m.userData.partName))
      || meshes.reduce((a, m) => (!a || m.geometry.boundingBox.min.y < a.geometry.boundingBox.min.y ? m : a), null);
    let cy = top + Math.max(18, (box.max.y - top) * 0.32), backZ = lampBack;
    if (baseMesh) {
      const bb = baseMesh.geometry.boundingBox;
      cy = Math.min(bb.min.y + 20, (bb.min.y + bb.max.y) / 2 + 20);
      const ray = new THREE.Raycaster(new THREE.Vector3(0, cy, bb.min.z - 200), new THREE.Vector3(0, 0, 1));
      const hit = ray.intersectObject(baseMesh, false)[0];
      backZ = hit ? hit.point.z : bb.min.z;
    }
    const plugIn = backZ + 1.5; // l'estremità dello spinotto entra di 1,5 mm
    const plugLen = 16;
    const adBottom = new THREE.Vector3(sx, sy - 6 - 31, wallZ + 4.5 + 24);
    const pBack = plugIn - plugLen; // il cavo parte dal retro dello spinotto
    const pts = [
      new THREE.Vector3(0, cy, pBack + 2),
      new THREE.Vector3(0, cy, pBack - 14),
      new THREE.Vector3(4, Math.max(top + 8, cy - 14), pBack - 34),
      new THREE.Vector3(8, top + 3.2, Math.min(pBack - 55, lampBack - 40)),
      new THREE.Vector3(40, top + 3.2, zBack + 38),
      new THREE.Vector3(150, top + 3.2, zBack + 18),
      new THREE.Vector3(sx - 30, top + 2, zBack - 2),
      new THREE.Vector3(sx - 26, top - 40, zBack - 7),
      new THREE.Vector3(sx - 10, top - 180, wallZ + 12),
      new THREE.Vector3(sx + 30, sy - 120, wallZ + 18),
      new THREE.Vector3(sx + 8, sy - 75, adBottom.z),
      adBottom,
    ];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const cableMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.55 });
    room.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 360, 1.7, 10, false), cableMat));
    // spinotto jack 5,5 mm sul retro della lampada
    const plug = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 3.6, plugLen, 24), cableMat);
    plug.rotation.x = Math.PI / 2; plug.position.set(0, cy, plugIn - plugLen / 2); room.add(plug);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 3, 20), new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 0.3, metalness: 0.9 }));
    sleeve.rotation.x = Math.PI / 2; sleeve.position.set(0, cy, plugIn - 0.2); room.add(sleeve);
    // pressacavo dell'alimentatore
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 2.2, 10, 16), adMat);
    boot.position.set(adBottom.x, adBottom.y - 3, adBottom.z); room.add(boot);

    // luce calda della lampada accesa sul piano e sul muro
    this.glow = new THREE.PointLight(0xffc98a, 0, 650, 0);
    this.glow.position.set(0, top + 90, lampFront + 40);
    room.add(this.glow);
    this.backGlow = new THREE.PointLight(0xffd7a0, 0, 520, 0);
    this.backGlow.position.set(0, top + 120, lampBack - 30);
    room.add(this.backGlow);

    room.visible = this.roomOn !== false;
    this.room = room;
    this.scene.add(room);
    this.setLit(this.lit);
  }

  // muro: si dissolve quando la telecamera va verso il retro (da dietro si vede la lampada, non il muro)
  updateWall() {
    if (!this.wall || !this.room.visible) return;
    const dz = this.camera.position.z - this.wallZ;
    const dist = this.camera.position.distanceTo(this.controls.target);
    const k = THREE.MathUtils.clamp((dz / Math.max(1, dist) - 0.15) / 0.35, 0, 1); // 0 = di lato/dietro, 1 = davanti
    this.wallMat.opacity = k;
    this.wall.visible = k > 0.01;
    this.wallMat.depthWrite = k > 0.99;
  }

  setRoom(on) {
    this.roomOn = !!on;
    if (this.room) this.room.visible = this.roomOn;
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
      for (const path of data.paths) shapes.push(...cleanShapes(SVGLoader.createShapes(path), 1.2, 360));
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
    for (const path of data.paths) shapes.push(...cleanShapes(SVGLoader.createShapes(path), 1.2, 360));
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
    if (this.glow) { this.glow.intensity = lit ? 1.6 : 0; this.backGlow.intensity = lit ? 1.4 : 0; }
  }

  snapshot() { return this.renderer.domElement.toDataURL('image/png'); }
}
