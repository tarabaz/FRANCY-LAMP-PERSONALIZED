// Anteprima 3D: disco estruso dalle parti SVG montato sul modello reale della lampada.
import * as THREE from '../vendor/three/three.module.js';
import { SVGLoader } from '../vendor/three/addons/SVGLoader.js';
import { OrbitControls } from '../vendor/three/addons/OrbitControls.js';
import { STLLoader } from '../vendor/three/addons/STLLoader.js';
import { cleanShapes } from './export-stl.js';

// Quote ricavate da COMPOSIZIONE_COMPLETA.STL (coordinate originali del file, in mm)
const LAMP_MODEL = {
  url: new URL('../models/lampada.stl', import.meta.url).href,
  discCenter: [1055.48, 1173.26], // centro della scocca Ø204,4
  frontZ: 1056.74,                // faccia frontale della scocca
  discRecess: 2,                  // il disco sta 2 mm dietro il frontale (il tappo lo copre in alcuni punti)
  floorY: 1027.28 - 1173.26,      // fondo della base, rispetto al centro disco
  baseSize: [204.4, 60],          // ingombro a terra della base (larghezza, profondità)
  baseCenterZ: 1041.74 - 1056.74, // centro della base in profondità
};

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
  constructor(container) {
    this.container = container;
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
    // Modello reale della lampada (base + scocca), STL in mm, Y in alto, fronte verso +Z.
    // Lo sposto in modo che il centro del disco sia in (0,0) e la faccia frontale della scocca in z=0.
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7, metalness: 0.05 });
    new STLLoader().load(LAMP_MODEL.url, (geo) => {
      geo.translate(-LAMP_MODEL.discCenter[0], -LAMP_MODEL.discCenter[1], -LAMP_MODEL.frontZ);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, dark);
      this.lamp.add(mesh);
    }, undefined, (err) => console.error('Modello lampada non caricato', err));

    // Niente pavimento: sfondo bianco e solo un'ombra morbida dove la base tocca terra
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(LAMP_MODEL.baseSize[0] * 1.35, LAMP_MODEL.baseSize[1] * 2.2),
      new THREE.MeshBasicMaterial({ map: contactShadowTexture(LAMP_MODEL.baseSize), transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, LAMP_MODEL.floorY + 0.05, LAMP_MODEL.baseCenterZ);
    this.scene.add(shadow);
    this.shadow = shadow;
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
    this.disc.position.z = -LAMP_MODEL.discRecess - this.discDepth;
    this.setLit(this.lit);
  }

  setLit(lit) {
    this.lit = lit;
    this.scene.background = new THREE.Color(lit ? 0x1c1f26 : 0xffffff);
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
