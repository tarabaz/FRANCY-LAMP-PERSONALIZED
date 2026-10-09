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
    // profondità logaritmica: niente sfarfallio (z-fighting) tra disco e lampada guardando da lontano
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 5, 6000);
    // con l'ambientazione l'inquadratura è un po' più larga (si vede il tavolino)
    const wide = this.roomOn && this.sceneCfg.box && this.sceneCfg.box.on !== false; // console larga con la scatola
    if (wide) this.camera.position.set(240, 190, 1260); else if (this.roomOn) this.camera.position.set(230, 70, 780); else this.camera.position.set(190, 40, 620);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(wide ? 75 : 0, wide ? -75 : this.roomOn ? -40 : -25, 0);
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
      this.findSeat();
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

  // Dove appoggia il disco: la superficie della lampada subito dietro (cover/diffusore), trovata con raggi sparati dal
  // davanti dentro l'area del disco. Il disco si mette 0,5 mm davanti a quella superficie: mai coincidenti (sfarfallio).
  findSeat() {
    const meshes = this.lamp.children.filter((m) => m.isMesh && m.geometry && !this.disc.children.includes(m));
    this.seatZ = null;
    if (!meshes.length) return;
    const ray = new THREE.Raycaster();
    let best = -Infinity;
    for (const [x, y] of [[0, 40], [30, 10], [-30, 10], [0, -30], [40, 45], [-40, 45]]) {
      ray.set(new THREE.Vector3(x, y, 200), new THREE.Vector3(0, 0, -1));
      // la prima superficie dietro il frontale (z < -0.5): salta il tappo frontale che sta davanti
      const hit = ray.intersectObjects(meshes, false).find((h) => h.point.z < -0.5);
      if (hit) best = Math.max(best, hit.point.z);
    }
    if (best > -Infinity && best > -40) this.seatZ = best;
    if (this.disc.children.length) this.disc.position.z = this.discZ(this.discDepth || 1);
  }
  discZ(depth) {
    // senza modello della lampada (o superficie non trovata): incasso dalle impostazioni
    return this.seatZ != null ? this.seatZ + 0.5 : -this.ref.recess - depth;
  }

  // ---------- ambientazione: tavolino da muro, cavo, alimentatore 12 V nella presa, muro che sparisce da dietro ----------
  buildRoom(box) {
    if (this.room) { this.scene.remove(this.room); this.room.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    const room = new THREE.Group();
    const top = box.min.y;                         // il piano del tavolino è dove appoggia la lampada
    const lampBack = box.min.z, lampFront = box.max.z;
    // con la scatola (30 × 23 cm) il tavolino diventa una console da ~1 m, profonda 36 cm
    const boxCfg = this.sceneCfg.box, boxOn = !!(boxCfg && boxCfg.on !== false);
    const T = { w: boxOn ? 980 : 560, th: 22, legH: 700 };
    const zBack = lampBack - 70, zFront = Math.max(lampFront + 90, zBack + (boxOn ? 360 : 200));
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

    // insegna sul tavolino, a sinistra, girata verso il centro
    const sign = this.sceneCfg.sign;
    if (sign && sign.on !== false) this.buildSign(room, { x: boxOn ? -230 : -hw + 95, y: top, z: zMid + 12 }, sign);
    // scatola di spedizione a destra, davanti al cavo, girata un po' verso il centro
    if (boxOn) this.buildBox(room, { x: 300, y: top, z: zMid + 20 }, boxCfg);

    room.visible = this.roomOn !== false;
    this.room = room;
    this.scene.add(room);
    this.setLit(this.lit);
  }

  // Insegna (modello assets/models/insegna.flm, in mm): faccia grande con texture di sfondo e sopra un secondo strato
  // oro metallizzato solo dove la seconda texture ha il disegno (PNG trasparente: tutto ciò che non è trasparente;
  // senza trasparenza: il tono meno presente, quindi va bene sia nero su bianco sia bianco su nero; il colore non conta)
  buildSign(room, at, cfg) {
    const url = new URL('../models/insegna.flm', import.meta.url).href;
    fetch(url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }).then((buf) => {
      const pos = decodeFlm(buf);
      // nel file: faccia grande verso +X (inclinata all'indietro), base su y = 0, larghezza lungo Z
      const bb = new THREE.Box3().setFromArray(pos);
      const fn = new THREE.Vector3(0.97, 0.26, 0).normalize();
      const front = [], rest = [], uv = [];
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
      for (let i = 0; i < pos.length; i += 9) {
        a.fromArray(pos, i); b.fromArray(pos, i + 3); c.fromArray(pos, i + 6);
        n.subVectors(c, b).cross(a.clone().sub(b)).normalize(); // normale (verso dei vertici del file)
        const tri = Array.from(pos.subarray(i, i + 9));
        if (Math.abs(n.dot(fn)) > 0.985 && (a.x + b.x + c.x) / 3 > bb.min.x + (bb.max.x - bb.min.x) * 0.15) front.push(...tri);
        else rest.push(...tri);
      }
      // la faccia grande è la più avanti (+X) tra le due parallele: il resto (retro, bordi) prende il materiale dell'insegna
      let maxD = -Infinity;
      for (let i = 0; i < front.length; i += 3) maxD = Math.max(maxD, front[i] * fn.x + front[i + 1] * fn.y + front[i + 2] * fn.z);
      const out = [], back = [...rest];
      for (let i = 0; i < front.length; i += 9) {
        a.fromArray(front, i); b.fromArray(front, i + 3); c.fromArray(front, i + 6);
        const d = (a.dot(fn) + b.dot(fn) + c.dot(fn)) / 3;
        (d > maxD - 0.6 ? out : back).push(...front.slice(i, i + 9));
      }
      // UV della faccia: guardandola da davanti, destra = -Z, alto = Y
      let ymin = Infinity, ymax = -Infinity;
      for (let i = 1; i < out.length; i += 3) { ymin = Math.min(ymin, out[i]); ymax = Math.max(ymax, out[i]); }
      for (let i = 0; i < out.length; i += 3) uv.push((bb.max.z - out[i + 2]) / (bb.max.z - bb.min.z), (out[i + 1] - ymin) / (ymax - ymin || 1));
      const geo = (arr, withUv) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
        if (withUv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.computeVertexNormals();
        return g;
      };
      const preset = MATERIALS[cfg.material] || MATERIALS.opaco;
      const bodyMat = new THREE.MeshStandardMaterial({ color: cfg.color || '#2f2e30', ...preset, envMap: preset.metalness > 0.2 ? this.envMap : null, side: THREE.DoubleSide });
      const group = new THREE.Group();
      group.add(new THREE.Mesh(geo(back, false), bodyMat));
      const loadTex = (u, cb) => { const t = new THREE.TextureLoader().load(u, cb, undefined, (e) => console.warn('Texture insegna non caricata', u, e)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
      // sfondo della faccia
      const faceMat = cfg.tex ? new THREE.MeshStandardMaterial({ map: loadTex(cfg.tex), roughness: preset.roughness, metalness: 0, side: THREE.DoubleSide }) : bodyMat;
      group.add(new THREE.Mesh(geo(out, true), faceMat));
      // strato oro: stessa faccia spostata di 0,15 mm in avanti
      if (cfg.gold) {
        const goldMat = new THREE.MeshStandardMaterial({ color: cfg.goldColor || '#d4af37', metalness: 1, roughness: 0.22, envMap: this.envMap, envMapIntensity: 1.9, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            // maschera: trasparenza dell'immagine, oppure luminosità se non è trasparente (bianco = oro)
            const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
            const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0);
            const d = ctx.getImageData(0, 0, cv.width, cv.height), px = d.data;
            let transparent = false;
            for (let i = 3; i < px.length; i += 16) if (px[i] < 250) { transparent = true; break; }
            // senza trasparenza: lo sfondo è il tono che occupa più spazio, l'oro va sull'altro (nero su bianco o viceversa)
            let invert = false;
            if (!transparent) {
              let sum = 0, cnt = 0;
              for (let i = 0; i < px.length; i += 16) { sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; cnt++; }
              invert = sum / cnt > 128; // per lo più chiaro: il disegno è quello scuro
            }
            for (let i = 0; i < px.length; i += 4) {
              let m = transparent ? px[i + 3] : Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
              if (invert) m = 255 - m;
              px[i] = px[i + 1] = px[i + 2] = m; px[i + 3] = 255;
            }
            ctx.putImageData(d, 0, 0);
            goldMat.alphaMap = new THREE.CanvasTexture(cv);
          } catch (e) { goldMat.alphaMap = loadTex(cfg.gold); } // immagine da un altro dominio: maschera diretta
          goldMat.needsUpdate = true;
        };
        img.src = cfg.gold;
        const gGeo = geo(out, true);
        gGeo.translate(fn.x * 0.15, fn.y * 0.15, fn.z * 0.15);
        group.add(new THREE.Mesh(gGeo, goldMat));
      }
      // base centrata sull'origine, faccia verso il davanti (+Z) e girata di 25° verso il centro del tavolo
      group.children.forEach((m) => m.geometry.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2));
      group.rotation.y = -Math.PI / 2 + THREE.MathUtils.degToRad(25);
      group.position.set(at.x, at.y, at.z);
      room.add(group);
      this.sign = group;
    }).catch((e) => console.warn('Insegna non caricata', e));
  }

  // Scatola postale 302 × 233 × 88 mm con la grafica dello sviluppo (immagine dello sviluppo intero, ritagliata
  // al contorno esterno). Ogni faccia prende il suo rettangolo dello sviluppo; le linguette interne non servono.
  buildBox(room, at, cfg) {
    const L = 302, D = 233, Hh = 88;
    // rettangoli nello sviluppo (frazioni della larghezza/altezza dell'immagine, misurati sulla fustella 585 × 641)
    const NW = 585, NH = 641;
    const X0 = 159 / NW, X1 = 426 / NW, SL = 81 / NW, SR = 504 / NW;          // colonna centrale, pareti laterali
    const A0 = 1 / NH, A1 = 75 / NH, B0 = 77 / NH, B1 = 282 / NH, C1 = 357 / NH, Dl = 565 / NH; // fronte, fondo, retro, coperchio
    const lerp = (a, b, t) => a + (b - a) * t;
    const geo = new THREE.BoxGeometry(L, Hh, D);
    geo.translate(0, Hh / 2, 0);
    const P = geo.attributes.position, N = geo.attributes.normal, UV = geo.attributes.uv;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i) / L + 0.5, y = P.getY(i) / Hh, z = P.getZ(i) / D + 0.5; // 0..1
      const nx = N.getX(i), ny = N.getY(i), nz = N.getZ(i);
      let u, v; // coordinate nello sviluppo (0..1, v dall'alto)
      if (ny > 0.5) { u = lerp(X0, X1, x); v = lerp(C1, Dl, z); }            // coperchio: cerniera dietro
      else if (ny < -0.5) { u = lerp(X0, X1, x); v = lerp(B1, B0, z); }      // fondo
      else if (nz > 0.5) { u = lerp(X0, X1, x); v = lerp(A1, A0, y); }       // fronte (piega in basso)
      else if (nz < -0.5) { u = lerp(X0, X1, x); v = lerp(B1, C1, y); }      // retro
      else if (nx < -0.5) { u = lerp(X0, SL, y); v = lerp(B1, B0, z); }      // fianco sinistro
      else { u = lerp(X1, SR, y); v = lerp(B1, B0, z); }                     // fianco destro
      UV.setXY(i, u, 1 - v);
    }
    const tex = new THREE.TextureLoader().load(cfg.tex || new URL('../img/scatola.webp', import.meta.url).href, undefined, undefined, (e) => console.warn('Grafica della scatola non caricata', e));
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0 });
    const box = new THREE.Mesh(geo, mat);
    // spigoli: una linea sottile di cartone sui bordi verticali e sul perimetro del coperchio
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xbfae94, transparent: true, opacity: 0.55 }));
    const g = new THREE.Group();
    g.add(box, edges);
    g.rotation.y = THREE.MathUtils.degToRad(-12);
    g.position.set(at.x, at.y, at.z);
    room.add(g);
    this.box = g;
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
    this.disc.position.z = this.discZ(this.discDepth);
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
    this.disc.position.z = this.discZ(depth);
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
