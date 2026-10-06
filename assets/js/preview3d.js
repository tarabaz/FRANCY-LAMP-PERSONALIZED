// Anteprima 3D: disco estruso dalle parti SVG montato sul modello reale della lampada.
import * as THREE from '../vendor/three/three.module.js';
import { SVGLoader } from '../vendor/three/addons/SVGLoader.js';
import { OrbitControls } from '../vendor/three/addons/OrbitControls.js';
import { STLLoader } from '../vendor/three/addons/STLLoader.js';

// Quote ricavate da COMPOSIZIONE_COMPLETA.STL (coordinate originali del file, in mm)
const LAMP_MODEL = {
  url: new URL('../models/lampada.stl', import.meta.url).href,
  discCenter: [1055.48, 1173.26], // centro della scocca Ø204,4
  frontZ: 1056.74,                // faccia frontale della scocca
  discRecess: 2,                  // il disco sta 2 mm dietro il frontale (il tappo lo copre in alcuni punti)
  floorY: 1027.28 - 1173.26,      // fondo della base, rispetto al centro disco
};

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

    this.ambient = new THREE.AmbientLight(0xffffff, 0.9);
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

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.8 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = LAMP_MODEL.floorY - 0.2;
    this.scene.add(floor);
    this.floor = floor;
  }

  // parts: [{ d, color, z, depth, black }]
  setParts(parts) {
    this.disc.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.disc.clear();
    this.colorMats = [];
    this.discDepth = Math.max(0, ...parts.map((p) => p.depth || 0));
    const loader = new SVGLoader();
    for (const p of parts) {
      if (!p.d) continue;
      const data = loader.parse(`<svg xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="${p.d}"/></svg>`);
      const shapes = [];
      for (const path of data.paths) shapes.push(...SVGLoader.createShapes(path));
      if (!shapes.length) continue;
      const geo = new THREE.ExtrudeGeometry(shapes, { depth: p.depth, bevelEnabled: false, curveSegments: 6 });
      const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.55, side: THREE.DoubleSide });
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
    this.scene.background = new THREE.Color(lit ? 0x1c1f26 : 0xdfe3ea);
    this.ambient.intensity = lit ? 0.25 : 0.9;
    this.key.intensity = lit ? 0.35 : 1.6;
    for (const m of this.colorMats) {
      m.emissive.copy(m.userData.base);
      m.emissiveIntensity = lit ? 0.85 : 0;
    }
  }

  snapshot() { return this.renderer.domElement.toDataURL('image/png'); }
}
