// Riconoscimento del volto nel browser (MediaPipe Face Landmarker, Apache 2.0, file in assets/vendor/mediapipe).
// Gira tutto sul dispositivo del cliente: la foto non viene inviata da nessuna parte.
// I file (~17 MB) vengono scaricati solo la prima volta che si accende "È un ritratto".

let ready = null;

function init() {
  const base = new URL('../vendor/mediapipe/', import.meta.url);
  return import(new URL('vision_bundle.mjs', base).href).then(({ FaceLandmarker }) =>
    FaceLandmarker.createFromOptions(
      {
        wasmLoaderPath: new URL('wasm/vision_wasm_internal.js', base).href,
        wasmBinaryPath: new URL('wasm/vision_wasm_internal.wasm', base).href,
      },
      {
        baseOptions: { modelAssetPath: new URL('face_landmarker.task', base).href, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numFaces: 1,
      },
    ));
}

// Punti del volto (478, coordinate 0..1 rispetto all'immagine) oppure null se non c'è un volto
export async function detectFace(img) {
  if (!ready) ready = init().catch((e) => { ready = null; throw e; });
  const lm = await ready;
  const r = lm.detect(img);
  const pts = r && r.faceLandmarks && r.faceLandmarks[0];
  return pts && pts.length >= 478 ? pts.map((p) => [p.x, p.y]) : null;
}

// Indici della mesh di MediaPipe
const EYE_A = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const EYE_B = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
const IRIS_1 = [468, 469, 470, 471, 472];
const IRIS_2 = [473, 474, 475, 476, 477];
const MOUTH_IN = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];

function iris(pts, idx) {
  const c = pts[idx[0]];
  const r = idx.slice(1).reduce((s, i) => s + Math.hypot(pts[i][0] - c[0], pts[i][1] - c[1]), 0) / 4;
  return { x: c[0], y: c[1], r };
}

// Converte i punti (già in pixel dell'immagine di lavoro) nella forma che usa il worker
export function faceFeatures(pts) {
  const irises = [iris(pts, IRIS_1), iris(pts, IRIS_2)];
  const eyes = [[EYE_A, 33, 133], [EYE_B, 263, 362]].map(([idx, a, b]) => {
    const poly = idx.map((i) => pts[i]);
    const cx = (pts[a][0] + pts[b][0]) / 2, cy = (pts[a][1] + pts[b][1]) / 2;
    // l'iride giusta è quella più vicina al centro di quest'occhio
    const ir = irises.slice().sort((p, q) => Math.hypot(p.x - cx, p.y - cy) - Math.hypot(q.x - cx, q.y - cy))[0];
    return { poly, corners: [pts[a], pts[b]], iris: ir };
  });
  return { eyes, mouth: MOUTH_IN.map((i) => pts[i]) };
}
