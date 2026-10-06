// Anteprima 3D: disco estruso dalle parti SVG + base segnaposto (da sostituire con i modelli reali).
import * as THREE from '../vendor/three/three.module.js';
import { SVGLoader } from '../vendor/three/addons/SVGLoader.js';
import { OrbitControls } from '../vendor/three/addons/OrbitControls.js';

export class Preview3D {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
    this.camera.position.set(170, 60, 560);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, -15, 0);
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
    const dark = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 });
    // Retro / scocca dietro il disco
    const back = new THREE.Mesh(new THREE.CylinderGeometry(100, 100, 24, 96), dark);
    back.rotation.x = Math.PI / 2;
    back.position.z = -12.5;
    this.lamp.add(back);
    // Base segnaposto a "pagnotta" come nelle foto
    const w = 150, h = 34, depth = 60, r = 16;
    const s = new THREE.Shape();
    s.moveTo(-w / 2 + r, 0);
    s.lineTo(w / 2 - r, 0);
    s.quadraticCurveTo(w / 2, 0, w / 2, r);
    s.lineTo(w / 2, h - r);
    s.quadraticCurveTo(w / 2, h, w / 2 - r, h);
    s.quadraticCurveTo(0, h - 8, -w / 2 + r, h);
    s.quadraticCurveTo(-w / 2, h, -w / 2, h - r);
    s.lineTo(-w / 2, r);
    s.quadraticCurveTo(-w / 2, 0, -w / 2 + r, 0);
    const base = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: 1.5, bevelThickness: 1.5, curveSegments: 16 }), dark);
    base.position.set(0, -100 - 18, -depth / 2 - 6);
    this.lamp.add(base);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.8 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -119.6;
    this.scene.add(floor);
    this.floor = floor;
  }

  // parts: [{ d, color, z, depth, black }]
  setParts(parts) {
    this.disc.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.disc.clear();
    this.colorMats = [];
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
