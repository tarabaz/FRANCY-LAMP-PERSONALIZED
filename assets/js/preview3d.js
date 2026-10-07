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
