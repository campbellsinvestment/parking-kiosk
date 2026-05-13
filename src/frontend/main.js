import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { KioskEngine } from "./kioskEngine.js";

const SCREEN_W = 960;
const SCREEN_H = 540;

const canvas = document.getElementById("c");
/** @type {'patron' | 'service'} */
let uiPage = "patron";

const screenHitsEntry = [];
const screenHitsExit = [];

const screenCanvasEntry = document.createElement("canvas");
const screenCanvasExit = document.createElement("canvas");
screenCanvasEntry.width = SCREEN_W;
screenCanvasEntry.height = SCREEN_H;
screenCanvasExit.width = SCREEN_W;
screenCanvasExit.height = SCREEN_H;
const screenTexEntry = new THREE.CanvasTexture(screenCanvasEntry);
const screenTexExit = new THREE.CanvasTexture(screenCanvasExit);
screenTexEntry.colorSpace = THREE.SRGBColorSpace;
screenTexExit.colorSpace = THREE.SRGBColorSpace;
screenTexEntry.minFilter = screenTexExit.minFilter = THREE.LinearFilter;
screenTexEntry.magFilter = screenTexExit.magFilter = THREE.LinearFilter;

const engine = new KioskEngine(() => renderDisplay());
engine.startup();

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0xd8e8f4, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
/** Softer distance fog — pairs with gradient sky */
scene.fog = new THREE.Fog(0xc5dae8, 22, 130);

/** Gradient sky (canvas → texture) */
const skyC = document.createElement("canvas");
skyC.width = 2;
skyC.height = 512;
const sctx = skyC.getContext("2d");
const sg = sctx.createLinearGradient(0, 0, 0, 512);
sg.addColorStop(0, "#7ec0ff");
sg.addColorStop(0.35, "#b8daf5");
sg.addColorStop(0.72, "#ddeef8");
sg.addColorStop(1, "#f2f6f9");
sctx.fillStyle = sg;
sctx.fillRect(0, 0, 2, 512);
const skyTex = new THREE.CanvasTexture(skyC);
skyTex.colorSpace = THREE.SRGBColorSpace;
skyTex.magFilter = THREE.LinearFilter;
skyTex.minFilter = THREE.LinearFilter;
scene.background = skyTex;

/**
 * Stall / lot layout scalars (before road + camera) so the main road can sit east of the slab
 * with no X overlap. Lot mesh still added below with these same values.
 */
const stallPitch = 2.62;
const stallDepth = 4.65;
const aisleCenterX = -6.15;
const aisleHalfW = 2.35;
const aisleX0 = aisleCenterX - aisleHalfW;
const aisleX1 = aisleCenterX + aisleHalfW;
const rowAX = aisleCenterX - aisleHalfW - stallDepth * 0.5;
const rowBX = aisleCenterX + aisleHalfW + stallDepth * 0.5;
const z0 = -5.55;
const stallCount = 5;
const zBack = z0 - stallPitch * 0.5;
const zFront = z0 + (stallCount - 1) * stallPitch + stallPitch * 0.5;
const xLotLeft = rowAX - stallDepth * 0.5 - 0.08;
const xLotRight = rowBX + stallDepth * 0.5 + 0.08;
const zMid = (z0 + z0 + (stallCount - 1) * stallPitch) * 0.5;

/** Lot slab AABB (+X / +Z edges) — road + booth sit outside this footprint */
const lotCenterX = -5.85;
const lotCenterZ = 0.25;
const lotPlaneW = 18;
const lotPlaneD = 19;
const xLotSlabRight = lotCenterX + lotPlaneW * 0.5;

/** Perimeter fence bounds (east X = lot edge + inset; used for gate posts on same vertical line) */
const fenceInset = 0.12;
const xFenceL = lotCenterX - lotPlaneW * 0.5 - fenceInset;
const xFenceR = lotCenterX + lotPlaneW * 0.5 + fenceInset;
const zFenceS = lotCenterZ - lotPlaneD * 0.5 - fenceInset;
const zFenceN = lotCenterZ + lotPlaneD * 0.5 + fenceInset;

/** Entry road ∥ +Z: east of slab in X; aligned in Z with the lot so it runs alongside (no X overlap) */
const roadLen = 82;
const roadHalfW = 8.2 * 0.5;
const MAIN_ROAD_W = roadHalfW * 2;
const roadPaintTrim = 1.2;
const roadPaintLen = roadLen - roadPaintTrim;
const roadClearX = 1.85;
const roadCenterX = xLotSlabRight + roadHalfW + roadClearX;
/** Same Z as lot slab — parallel shoulder beside the parking area */
const roadZCenter = lotCenterZ;

/** Connector centerline Z + lateral offsets (−Z = right when driving into lot along −X) */
const GATE_Z = lotCenterZ - 0.55;
const laneOff = 0.98;
/** Entrance (right / −Z): farther onto grass — +X toward main road, −Z off the connector */
const kioskEntrGrassX = -0.2;
const kioskEntrGrassZ = 4;
const ENTR_KIOSK_Z = GATE_Z - laneOff - kioskEntrGrassZ;
/** Connector total width in Z matches main road; used for fence gap + gate posts */
const connPavementZHalf = MAIN_ROAD_W * 0.5;

/** Connector: two asphalt strips (±Z) with grass median — no through drive across center */
const connectorMedianZ = 0.48;
const zConnS0 = GATE_Z - MAIN_ROAD_W * 0.5;
const zConnS1 = GATE_Z - connectorMedianZ * 0.5;
const zConnN0 = GATE_Z + connectorMedianZ * 0.5;
const zConnN1 = GATE_Z + MAIN_ROAD_W * 0.5;
const connSouthZc = (zConnS0 + zConnS1) * 0.5;
const connNorthZc = (zConnN0 + zConnN1) * 0.5;
const connX1 = xLotSlabRight + 0.12;
const connX2 = roadCenterX - roadHalfW - 0.06;
const connXC = (connX1 + connX2) * 0.5;
const connLenX = Math.max(0.45, connX2 - connX1);
/** Each boom spans from its lane edge to the connector center (Z = GATE_Z); tips meet in the middle */
const BOOM_HALF_LEN = Math.max(1.05, connPavementZHalf - 0.1);
/** Shorten each boom slightly from the lane center so tips do not quite touch */
const boomTipGap = 0.14;
const BOOM_BAR_LEN = BOOM_HALF_LEN - boomTipGap * 0.5;
/** Nudge entrance post + boom toward lane center (+Z); shorten bar so inner tip stays aligned */
const entrBarInsetZ = 0.32;
const entryBarLen = Math.max(0.72, BOOM_BAR_LEN - entrBarInsetZ);
/** Shared X for both booms — same X as east fence (horizontal alignment with perimeter) */
const GATE_POST_X = xFenceR;
const ENTRY_POST_X = GATE_POST_X;
const EXIT_POST_X = GATE_POST_X;
/** Exit kiosk: inside fenced lot (west of east fence), north of connector — faces connector (−Z) */
const EXIT_KIOSK_X = xFenceR - 1.12;
const ENTRY_POST_Z = GATE_Z - connPavementZHalf + 0.1 + entrBarInsetZ;
const EXIT_POST_Z = GATE_Z + connPavementZHalf - 0.1;
/** Entrance: grass beside connector throat (unchanged placement) */
const ENTR_KIOSK_X = connX2 - 0.52 + kioskEntrGrassX;
const EXIT_KIOSK_Z = GATE_Z + 5;
/** Entrance faces +Z (into connector); exit faces −Z (into connector). Side road runs ±X. */
const ENTR_YAW = 0;
const EXIT_YAW = Math.PI;

const CAM_TARGET_X = connXC;
const CAM_TARGET_Z = GATE_Z;

const camera = new THREE.PerspectiveCamera(48, 1, 0.08, 200);
camera.position.set(connXC + 5.8, 2.35, GATE_Z + 4.1);

const controls = new OrbitControls(camera, canvas);
controls.target.set(CAM_TARGET_X, 1.32, CAM_TARGET_Z);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 2.2;
controls.maxDistance = 11;
controls.minPolarAngle = Math.PI * 0.22;
controls.maxPolarAngle = Math.PI * 0.5;
controls.enablePan = false;
controls.rotateSpeed = 0.62;

/** East fence gap in Z for connector (west fence continuous) */
const entryGapZ0 = GATE_Z - connPavementZHalf - 0.14;
const entryGapZ1 = GATE_Z + connPavementZHalf + 0.14;

/** Lights — open-air lot */
const hemi = new THREE.HemisphereLight(0xe8f4ff, 0x8faa90, 0.95);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfffaf0, 1.25);
key.position.set(5, 12, 6);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.bias = -0.0002;
scene.add(key);
const rim = new THREE.PointLight(0x9ec0ff, 0.45, 18);
rim.position.set(-3, 3, 2);
scene.add(rim);

/** Distant hills (simple scenic silhouettes) */
const hillMat = new THREE.MeshStandardMaterial({
  color: 0x6d9d78,
  metalness: 0,
  roughness: 0.92,
  flatShading: true,
});
for (let i = 0; i < 9; i++) {
  const hill = new THREE.Mesh(new THREE.SphereGeometry(9 + Math.random() * 6, 7, 6), hillMat);
  hill.scale.set(1, 0.32 + Math.random() * 0.12, 1.1);
  hill.position.set(-55 + i * 13 + Math.random() * 4, 2.2, -58 - Math.random() * 12);
  hill.castShadow = false;
  hill.receiveShadow = false;
  scene.add(hill);
}

/** Grass — base ground (sits slightly low so asphalt reads on top) */
const grass = new THREE.Mesh(
  new THREE.PlaneGeometry(260, 260),
  new THREE.MeshStandardMaterial({ color: 0x5c8f66, metalness: 0, roughness: 0.94 })
);
grass.rotation.x = -Math.PI / 2;
grass.position.y = -0.04;
grass.receiveShadow = true;
scene.add(grass);

/** Road: thin box ∥ +Z — explicit X/Z extents (avoids any plane-rotation ambiguity) */
const asphaltRoad = new THREE.MeshStandardMaterial({ color: 0x4a515c, metalness: 0.12, roughness: 0.9 });
const road = new THREE.Mesh(new THREE.BoxGeometry(MAIN_ROAD_W, 0.08, roadLen), asphaltRoad);
road.position.set(roadCenterX, 0.04, roadZCenter);
road.receiveShadow = true;
scene.add(road);

const roadLineMat = new THREE.MeshStandardMaterial({ color: 0xe8d060, roughness: 0.85, metalness: 0 });
const roadLine = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, roadPaintLen), roadLineMat);
roadLine.position.set(roadCenterX, 0.092, roadZCenter);
scene.add(roadLine);

/** Entry road: white edge stripes (∥ Z) */
const roadEdgeMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.9, metalness: 0 });
const roadBorderW = 0.11;
const roadEdgeXInset = roadHalfW - roadBorderW * 0.5 - 0.04;
for (const sgn of [-1, 1]) {
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(roadBorderW, 0.05, roadPaintLen), roadEdgeMat);
  stripe.position.set(roadCenterX + sgn * roadEdgeXInset, 0.078, roadZCenter);
  scene.add(stripe);
}

/** Connector strip (main road ↔ lot east edge) */
const sideAsphaltMat = new THREE.MeshStandardMaterial({ color: 0x4e5560, metalness: 0.11, roughness: 0.9 });
const sideRoadSouth = new THREE.Mesh(new THREE.BoxGeometry(connLenX, 0.08, zConnS1 - zConnS0), sideAsphaltMat);
sideRoadSouth.position.set(connXC, 0.042, connSouthZc);
sideRoadSouth.receiveShadow = true;
scene.add(sideRoadSouth);
const sideRoadNorth = new THREE.Mesh(new THREE.BoxGeometry(connLenX, 0.08, zConnN1 - zConnN0), sideAsphaltMat);
sideRoadNorth.position.set(connXC, 0.042, connNorthZc);
sideRoadNorth.receiveShadow = true;
scene.add(sideRoadNorth);
const medianGrass = new THREE.Mesh(
  new THREE.BoxGeometry(connLenX, 0.07, connectorMedianZ),
  new THREE.MeshStandardMaterial({ color: 0x548a5e, metalness: 0, roughness: 0.94 })
);
medianGrass.position.set(connXC, 0.038, GATE_Z);
medianGrass.receiveShadow = true;
scene.add(medianGrass);

function makeChainLinkTexture() {
  const w = 128;
  const h = 128;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(c);
  ctx.fillStyle = "#2a3038";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(195, 205, 218, 0.62)";
  ctx.lineWidth = 1.1;
  const step = 14;
  for (let o = -h; o < w + h; o += step) {
    ctx.beginPath();
    ctx.moveTo(o, 0);
    ctx.lineTo(o + h, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(o + h, 0);
    ctx.lineTo(o, h);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.5, 1.2);
  return tex;
}

const chainTex = makeChainLinkTexture();
const chainMat = new THREE.MeshStandardMaterial({
  map: chainTex,
  color: 0xffffff,
  metalness: 0.42,
  roughness: 0.48,
  transparent: true,
  opacity: 0.92,
  alphaTest: 0.15,
  side: THREE.DoubleSide,
});
const fenceH = 1.08;
const fenceY = fenceH * 0.5 + 0.01;

function addFenceRunZ(x, z0, z1) {
  const len = Math.max(0.05, z1 - z0);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(len, fenceH), chainMat);
  m.position.set(x, fenceY, (z0 + z1) * 0.5);
  m.rotation.y = Math.PI / 2;
  scene.add(m);
}

function addFenceRunX(z, x0, x1) {
  const len = Math.max(0.05, x1 - x0);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(len, fenceH), chainMat);
  m.position.set((x0 + x1) * 0.5, fenceY, z);
  m.rotation.y = 0;
  scene.add(m);
}

/** East: two runs with entry gap (aligned with connector + boom) */
addFenceRunZ(xFenceR, zFenceS, entryGapZ0);
addFenceRunZ(xFenceR, entryGapZ1, zFenceN);
/** West: continuous (no second lot exit) */
addFenceRunZ(xFenceL, zFenceS, zFenceN);
/** South + north continuous */
addFenceRunX(zFenceS, xFenceL, xFenceR);
addFenceRunX(zFenceN, xFenceL, xFenceR);

/** Parking lot slab — west + east stall areas + room for center drive */
const lotAsphalt = new THREE.MeshStandardMaterial({ color: 0x565c66, metalness: 0.1, roughness: 0.88 });
const lot = new THREE.Mesh(new THREE.PlaneGeometry(lotPlaneW, lotPlaneD), lotAsphalt);
lot.rotation.x = -Math.PI / 2;
lot.position.set(lotCenterX, 0.009, lotCenterZ);
lot.receiveShadow = true;
scene.add(lot);

/** Two stall rows with a center drive lane (∥ Z) for through traffic */
const lineMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.92, metalness: 0 });
const lineY = 0.011;

/** Center drive (same family as entry road, slightly darker) */
const driveLaneMat = new THREE.MeshStandardMaterial({ color: 0x4a5058, metalness: 0.1, roughness: 0.9 });
const lotDrive = new THREE.Mesh(
  new THREE.PlaneGeometry(aisleX1 - aisleX0, zFront - zBack + 0.45),
  driveLaneMat
);
lotDrive.rotation.x = -Math.PI / 2;
lotDrive.position.set(aisleCenterX, 0.012, zMid);
lotDrive.receiveShadow = true;
scene.add(lotDrive);

const driveLen = zFront - zBack + 0.45;
const driveHalfW = (aisleX1 - aisleX0) * 0.5;
/** Lot center aisle: white borders along the drive edges, one unbroken yellow center line */
const driveBorderW = 0.09;
const driveBorderInset = driveHalfW - driveBorderW * 0.5 - 0.02;
for (const sgn of [-1, 1]) {
  const dStripe = new THREE.Mesh(new THREE.PlaneGeometry(driveBorderW, driveLen), lineMat);
  dStripe.rotation.x = -Math.PI / 2;
  dStripe.position.set(aisleCenterX + sgn * driveBorderInset, 0.0135, zMid);
  scene.add(dStripe);
}
const driveCenterLine = new THREE.Mesh(
  new THREE.PlaneGeometry(0.2, driveLen),
  new THREE.MeshStandardMaterial({ color: 0xe8d060, roughness: 0.88, metalness: 0 })
);
driveCenterLine.rotation.x = -Math.PI / 2;
driveCenterLine.position.set(aisleCenterX, 0.0145, zMid);
scene.add(driveCenterLine);

for (let k = 0; k <= stallCount; k++) {
  const z = zBack + k * stallPitch;
  const westW = aisleX0 - xLotLeft;
  const westDiv = new THREE.Mesh(new THREE.PlaneGeometry(westW, 0.045), lineMat);
  westDiv.rotation.x = -Math.PI / 2;
  westDiv.position.set((xLotLeft + aisleX0) * 0.5, lineY, z);
  scene.add(westDiv);
  const eastW = xLotRight - aisleX1;
  const eastDiv = new THREE.Mesh(new THREE.PlaneGeometry(eastW, 0.045), lineMat);
  eastDiv.rotation.x = -Math.PI / 2;
  eastDiv.position.set((aisleX1 + xLotRight) * 0.5, lineY, z);
  scene.add(eastDiv);
}

const curbLen = zFront - zBack + 0.12;
const curbL = new THREE.Mesh(new THREE.PlaneGeometry(0.055, curbLen), lineMat);
curbL.rotation.x = -Math.PI / 2;
curbL.position.set(xLotLeft, lineY, zMid);
scene.add(curbL);
const curbR = new THREE.Mesh(new THREE.PlaneGeometry(0.055, curbLen), lineMat);
curbR.rotation.x = -Math.PI / 2;
curbR.position.set(xLotRight, lineY, zMid);
scene.add(curbR);

/** Cars centered in stalls; nose toward center drive */
function makeCar(bodyColor) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.4, roughness: 0.4 });
  const lower = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.4, 2.02), bodyMat);
  lower.position.y = 0.34;
  lower.castShadow = true;
  lower.receiveShadow = true;
  g.add(lower);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(0.88, 0.32, 0.92),
    new THREE.MeshStandardMaterial({ color: 0x2a3038, metalness: 0.25, roughness: 0.45 })
  );
  cabin.position.set(0, 0.68, -0.12);
  cabin.castShadow = true;
  g.add(cabin);
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 0.28, 0.38),
    new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.35, roughness: 0.42 })
  );
  nose.position.set(0, 0.42, 0.92);
  nose.castShadow = true;
  g.add(nose);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.98 });
  const wGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.07, 10);
  for (const [wx, wz] of [
    [0.46, 0.62],
    [-0.46, 0.62],
    [0.46, -0.62],
    [-0.46, -0.62],
  ]) {
    const w = new THREE.Mesh(wGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.13, wz);
    w.castShadow = true;
    g.add(w);
  }
  return g;
}

const carColors = [0x8b2e3c, 0x1a5680, 0xc46028, 0x2f6b45, 0x5a4578, 0x6d6a2e, 0x444444, 0x9a8b7a];
for (let k = 0; k < stallCount; k++) {
  const z = z0 + k * stallPitch;
  const cA = makeCar(carColors[k % carColors.length]);
  cA.position.set(rowAX, 0, z);
  cA.rotation.y = -Math.PI / 2;
  scene.add(cA);
  const cB = makeCar(carColors[(k + 3) % carColors.length]);
  cB.position.set(rowBX, 0, z);
  cB.rotation.y = Math.PI / 2;
  scene.add(cB);
}

/** Starfield — very subtle in daylight sky */
const starGeo = new THREE.BufferGeometry();
const starCount = 500;
const sp = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
  const r = 42 + Math.random() * 75;
  const th = Math.random() * Math.PI * 2;
  const ph = Math.acos(2 * Math.random() - 1);
  sp[i * 3] = r * Math.sin(ph) * Math.cos(th);
  sp[i * 3 + 1] = r * Math.cos(ph) * 0.55 + 10;
  sp[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
}
starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
const stars = new THREE.Points(
  starGeo,
  new THREE.PointsMaterial({ color: 0xffffff, size: 0.04, transparent: true, opacity: 0.22, depthWrite: false })
);
scene.add(stars);

/** Entrance kiosk (−Z / “right” when entering on −X) + exit kiosk (+Z / “left”) */
const screenAspect = SCREEN_W / SCREEN_H;
const kioskScreenH = 0.76;
const kioskScreenW = kioskScreenH * screenAspect;

function buildKioskGroup(screenTexMap, bodyColor, name) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.12, 2.28, 0.66),
    new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.38, roughness: 0.34 })
  );
  body.position.y = 1.14;
  body.castShadow = true;
  g.add(body);
  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(kioskScreenW + 0.08, kioskScreenH + 0.08, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x3a4452, metalness: 0.32, roughness: 0.48 })
  );
  bezel.position.set(0, 1.48, 0.32);
  g.add(bezel);
  const scr = new THREE.Mesh(
    new THREE.PlaneGeometry(kioskScreenW, kioskScreenH),
    new THREE.MeshBasicMaterial({ map: screenTexMap })
  );
  scr.position.set(0, 1.48, 0.342);
  scr.name = name;
  g.add(scr);
  const slot = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.055, 0.11),
    new THREE.MeshStandardMaterial({ color: 0x2a323c, metalness: 0.4, roughness: 0.42 })
  );
  slot.position.set(0, 0.6, 0.35);
  g.add(slot);
  return g;
}

const kioskEntryGroup = buildKioskGroup(screenTexEntry, 0x5c6a82, "kioskDisplayEntry");
kioskEntryGroup.position.set(ENTR_KIOSK_X, 0, ENTR_KIOSK_Z);
kioskEntryGroup.rotation.y = ENTR_YAW;
scene.add(kioskEntryGroup);

const kioskExitGroup = buildKioskGroup(screenTexExit, 0x5a6678, "kioskDisplayExit");
kioskExitGroup.position.set(EXIT_KIOSK_X, 0, EXIT_KIOSK_Z);
kioskExitGroup.rotation.y = EXIT_YAW;
scene.add(kioskExitGroup);

const screenEntry = kioskEntryGroup.getObjectByName("kioskDisplayEntry");
const screenExit = kioskExitGroup.getObjectByName("kioskDisplayExit");

/**
 * Entry / exit booms: ribbon across the connector in Z (blocks along −X / +X), hinge at lane edge, lift on +X rotation.
 */
const POST_H = 1.32;

const gateGroup = new THREE.Group();
gateGroup.position.set(ENTRY_POST_X, 0.04, ENTRY_POST_Z);
scene.add(gateGroup);

const post = new THREE.Mesh(
  new THREE.CylinderGeometry(0.085, 0.1, POST_H, 18),
  new THREE.MeshStandardMaterial({ color: 0x7a8494, metalness: 0.28, roughness: 0.38 })
);
post.position.y = POST_H * 0.5;
post.castShadow = true;
gateGroup.add(post);

const barPivot = new THREE.Group();
barPivot.position.set(0, POST_H + 0.02, 0);
gateGroup.add(barPivot);

const barMat = new THREE.MeshStandardMaterial({
  color: 0xf5c84a,
  metalness: 0.18,
  roughness: 0.38,
  emissive: 0x332200,
  emissiveIntensity: 0.08,
});
const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, entryBarLen), barMat);
bar.position.set(0, 0, entryBarLen * 0.5);
bar.castShadow = true;
barPivot.add(bar);

const exitGateGroup = new THREE.Group();
exitGateGroup.position.set(EXIT_POST_X, 0.04, EXIT_POST_Z);
scene.add(exitGateGroup);

const exitPost = new THREE.Mesh(
  new THREE.CylinderGeometry(0.085, 0.1, POST_H, 18),
  new THREE.MeshStandardMaterial({ color: 0x6d7888, metalness: 0.28, roughness: 0.38 })
);
exitPost.position.y = POST_H * 0.5;
exitPost.castShadow = true;
exitGateGroup.add(exitPost);

const exitBarPivot = new THREE.Group();
exitBarPivot.position.set(0, POST_H + 0.02, 0);
exitGateGroup.add(exitBarPivot);

const exitBar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, BOOM_BAR_LEN), barMat);
exitBar.position.set(0, 0, -BOOM_BAR_LEN * 0.5);
exitBar.castShadow = true;
exitBarPivot.add(exitBar);

let gateAngleEntry = 0;
let gateAngleExit = 0;
/** Negative X-rotation lifts the boom (closed = 0, flat across the lane in XZ) */
const gateTargetAngleEntry = () => {
  const s = engine.snapshot;
  return s.gateOpen && s.gateMode === "entry" ? -Math.PI * 0.48 : 0;
};
const gateTargetAngleExit = () => {
  const s = engine.snapshot;
  return s.gateOpen && s.gateMode === "exit" ? -Math.PI * 0.48 : 0;
};

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawButton(hits, ctx, x, y, w, h, label, primary, action) {
  roundRectPath(ctx, x, y, w, h, 14);
  ctx.fillStyle = primary ? "#2e7bd6" : "#e8eef5";
  ctx.fill();
  ctx.strokeStyle = primary ? "rgba(255,255,255,0.5)" : "rgba(60, 100, 150, 0.4)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = primary ? "#ffffff" : "#1a2a40";
  ctx.font = '600 26px system-ui, "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, y + h / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  hits.push({ x, y, w, h, action });
}

function drawSmallChip(hits, ctx, x, y, w, h, label, action) {
  roundRectPath(ctx, x, y, w, h, 10);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fill();
  ctx.strokeStyle = "rgba(70, 120, 180, 0.35)";
  ctx.stroke();
  ctx.fillStyle = "#2a4a68";
  ctx.font = '500 18px system-ui, "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, y + h / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  hits.push({ x, y, w, h, action });
}

function drawPatronScreenEntry(s) {
  const ctx = screenCanvasEntry.getContext("2d");
  screenHitsEntry.length = 0;

  const g = ctx.createLinearGradient(0, 0, SCREEN_W, SCREEN_H);
  g.addColorStop(0, "#eef4fb");
  g.addColorStop(0.5, "#e2ecf6");
  g.addColorStop(1, "#d6e4f2");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  ctx.strokeStyle = "rgba(60, 110, 170, 0.3)";
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, SCREEN_W - 20, SCREEN_H - 20);

  ctx.fillStyle = "#1a4a78";
  ctx.font = '700 30px system-ui, "Segoe UI", sans-serif';
  ctx.fillText("ENTRANCE", 36, 48);
  ctx.fillStyle = "rgba(35, 75, 115, 0.78)";
  ctx.font = '20px system-ui, "Segoe UI", sans-serif';
  ctx.fillText("Facing the connector · take a ticket here", 36, 78);

  ctx.fillStyle = "rgba(35, 75, 115, 0.78)";
  ctx.font = '22px system-ui, "Segoe UI", sans-serif';
  const sub =
    s.kioskStatus === "OUT_OF_SERVICE"
      ? "Out of service"
      : s.kioskStatus === "LIMITED"
        ? "Limited operation"
        : "Self-service";
  ctx.fillText(sub, 36, 108);

  ctx.fillStyle = "#1e3a58";
  ctx.font = '26px system-ui, "Segoe UI", sans-serif';
  wrapText(ctx, s.message || "—", 36, 142, SCREEN_W - 72, 32);

  ctx.fillStyle = "rgba(25, 65, 105, 0.88)";
  ctx.font = '20px ui-monospace, SFMono-Regular, Menlo, monospace';
  const lines = (s.detail || "").split("\n").slice(0, 6);
  let ly = 214;
  for (const ln of lines) {
    ctx.fillText(ln.slice(0, 52), 36, ly);
    ly += 26;
  }

  ctx.fillStyle = "#a65c10";
  ctx.font = '18px system-ui, sans-serif';
  const entryOpen = s.gateOpen && s.gateMode === "entry";
  ctx.fillText(entryOpen ? "Entry gate OPEN" : "Entry gate closed", 36, SCREEN_H - 118);

  const rowY = SCREEN_H - 82;
  const btnH = 56;
  const fullW = SCREEN_W - 72;

  if (s.kioskStatus === "OUT_OF_SERVICE") {
    drawButton(screenHitsEntry, ctx, 36, rowY, fullW, btnH, "STAFF RESET", true, "reset");
    return;
  }

  if (s.flow === "EXIT_SCAN" || s.flow === "EXIT_PAYMENT" || s.flow === "EXIT_DONE") {
    ctx.fillStyle = "rgba(30, 85, 135, 0.9)";
    ctx.font = '22px system-ui, sans-serif';
    wrapText(ctx, "Ticket time and payment are handled at the EXIT kiosk on the other side of this lane.", 36, rowY - 8, SCREEN_W - 72, 28);
    return;
  }

  if (s.flow === "IDLE") {
    drawButton(screenHitsEntry, ctx, 36, rowY, fullW, btnH, "GET TICKET", true, "entry");
    drawSmallChip(screenHitsEntry, ctx, SCREEN_W - 150, 24, 114, 40, "Service", "service");
    return;
  }

  if (s.flow === "ENTRY_PRINTING") {
    ctx.fillStyle = "rgba(30, 85, 135, 0.9)";
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText("Please wait…", 36, rowY + 18);
    return;
  }

  if (s.flow === "ENTRY_GATE_OPEN") {
    ctx.fillStyle = "rgba(30, 85, 135, 0.9)";
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText("Remove ticket · entry gate is open", 36, rowY + 18);
  }
}

function drawPatronScreenExit(s) {
  const ctx = screenCanvasExit.getContext("2d");
  screenHitsExit.length = 0;

  const g = ctx.createLinearGradient(0, 0, SCREEN_W, SCREEN_H);
  g.addColorStop(0, "#eef6f4");
  g.addColorStop(0.5, "#e2f0ec");
  g.addColorStop(1, "#d6eae4");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  ctx.strokeStyle = "rgba(50, 120, 90, 0.35)";
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, SCREEN_W - 20, SCREEN_H - 20);

  ctx.fillStyle = "#1a5a48";
  ctx.font = '700 30px system-ui, "Segoe UI", sans-serif';
  ctx.fillText("EXIT", 36, 48);
  ctx.fillStyle = "rgba(35, 95, 75, 0.82)";
  ctx.font = '20px system-ui, "Segoe UI", sans-serif';
  ctx.fillText("Verify ticket & time · pay if required", 36, 78);

  ctx.fillStyle = "rgba(35, 75, 115, 0.78)";
  ctx.font = '22px system-ui, "Segoe UI", sans-serif';
  const sub =
    s.kioskStatus === "OUT_OF_SERVICE"
      ? "Out of service"
      : s.kioskStatus === "LIMITED"
        ? "Limited operation"
        : "Self-service";
  ctx.fillText(sub, 36, 108);

  ctx.fillStyle = "#1e3a58";
  ctx.font = '26px system-ui, "Segoe UI", sans-serif';
  wrapText(ctx, s.message || "—", 36, 142, SCREEN_W - 72, 32);

  ctx.fillStyle = "rgba(25, 65, 105, 0.88)";
  ctx.font = '20px ui-monospace, SFMono-Regular, Menlo, monospace';
  const lines = (s.detail || "").split("\n").slice(0, 6);
  let ly = 214;
  for (const ln of lines) {
    ctx.fillText(ln.slice(0, 52), 36, ly);
    ly += 26;
  }

  ctx.fillStyle = "#a65c10";
  ctx.font = '18px system-ui, sans-serif';
  const exitOpen = s.gateOpen && s.gateMode === "exit";
  ctx.fillText(exitOpen ? "Exit gate OPEN" : "Exit gate closed", 36, SCREEN_H - 118);

  const rowY = SCREEN_H - 82;
  const btnH = 56;
  const gap = 18;
  const fullW = SCREEN_W - 72;
  const halfW = (fullW - gap) / 2;

  if (s.kioskStatus === "OUT_OF_SERVICE") {
    drawButton(screenHitsExit, ctx, 36, rowY, fullW, btnH, "STAFF RESET", true, "reset");
    return;
  }

  if (s.flow === "ENTRY_PRINTING" || s.flow === "ENTRY_GATE_OPEN") {
    ctx.fillStyle = "rgba(30, 85, 135, 0.9)";
    ctx.font = '22px system-ui, sans-serif';
    wrapText(ctx, "Tickets are issued at the ENTRANCE kiosk on the other side of this lane.", 36, rowY - 8, SCREEN_W - 72, 28);
    return;
  }

  if (s.flow === "EXIT_SUMMARY") {
    ctx.fillStyle = "rgba(30, 85, 135, 0.9)";
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText(s.message || "Verifying ticket…", 36, rowY + 8);
    return;
  }

  if (s.flow === "IDLE") {
    drawButton(screenHitsExit, ctx, 36, rowY, fullW, btnH, "EXIT (SCAN / PAY)", true, "exit");
    drawSmallChip(screenHitsExit, ctx, SCREEN_W - 150, 24, 114, 40, "Service", "service");
    return;
  }

  if (s.flow === "EXIT_SCAN") {
    drawButton(screenHitsExit, ctx, 36, rowY, halfW, btnH, "SCAN TICKET", true, "scan");
    drawButton(screenHitsExit, ctx, 36 + halfW + gap, rowY, halfW, btnH, "BACK", false, "back_exit");
    return;
  }

  if (s.flow === "EXIT_PAYMENT") {
    drawButton(screenHitsExit, ctx, 36, rowY, halfW, btnH, "PAY (CARD)", true, "pay_ok");
    drawButton(screenHitsExit, ctx, 36 + halfW + gap, rowY, halfW, btnH, "DECLINED (TEST)", false, "pay_bad");
    return;
  }

  if (s.flow === "EXIT_DONE") {
    drawButton(screenHitsExit, ctx, 36, rowY, fullW, btnH, "CONTINUE", true, "done");
  }
}

function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = text.split(/\s+/);
  let line = "";
  let cy = y;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, cy);
      line = words[i];
      cy += lineH;
      if (cy > y + lineH * 3) break;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, cy);
}

function drawServiceScreen() {
  const paint = (canvas, hits) => {
    const ctx = canvas.getContext("2d");
    hits.length = 0;
    ctx.fillStyle = "#f2efe8";
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    ctx.strokeStyle = "rgba(180, 110, 60, 0.4)";
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 10, SCREEN_W - 20, SCREEN_H - 20);

    ctx.fillStyle = "#5a3018";
    ctx.font = '700 30px system-ui, sans-serif';
    ctx.fillText("SERVICE (simulation)", 36, 54);
    ctx.fillStyle = "rgba(70, 45, 28, 0.75)";
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText("Tap a row to toggle hardware / connectivity.", 36, 92);

    const s = engine.snapshot;
    let y = 120;
    const rowH = 52;
    const rowW = SCREEN_W - 72;
    const row = (label, on, action) => {
      ctx.fillStyle = on ? "rgba(170, 220, 190, 0.95)" : "rgba(255, 205, 205, 0.95)";
      roundRectPath(ctx, 36, y, rowW, rowH, 12);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.1)";
      ctx.stroke();
      ctx.fillStyle = "#1a2530";
      ctx.font = '22px system-ui, sans-serif';
      ctx.textBaseline = "middle";
      ctx.fillText(`${label}: ${on ? "ON" : "OFF"}`, 52, y + rowH / 2);
      ctx.textBaseline = "alphabetic";
      hits.push({ x: 36, y, w: rowW, h: rowH, action });
      y += rowH + 10;
    };

    row("Database", s.dbOnline, "toggle_db");
    row("Payment gateway", s.paymentGatewayOnline, "toggle_pay");
    row("Ticket paper", s.ticketPaperOk, "toggle_paper");
    row("Receipt paper", s.receiptPaperOk, "toggle_receipt");

    drawButton(hits, ctx, 36, y, rowW, rowH, "SIMULATE CRITICAL FAULT (ERR-007)", false, "fault_sim");
    y += rowH + 14;
    drawButton(hits, ctx, 36, y, rowW, rowH, "CLOSE", true, "close_service");
  };

  paint(screenCanvasEntry, screenHitsEntry);
  paint(screenCanvasExit, screenHitsExit);
}

function renderDisplay() {
  if (uiPage === "service") drawServiceScreen();
  else {
    const s = engine.snapshot;
    drawPatronScreenEntry(s);
    drawPatronScreenExit(s);
  }
  screenTexEntry.needsUpdate = true;
  screenTexExit.needsUpdate = true;
}

function resize() {
  const w = Math.max(2, window.innerWidth);
  const h = Math.max(2, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h, false);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

window.addEventListener("resize", resize);
resize();

function pickScreenPixel(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const cx = clientX - rect.left;
  const cy = clientY - rect.top;
  ndc.x = (cx / rect.width) * 2 - 1;
  ndc.y = -(cy / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects([screenEntry, screenExit], false);
  if (!hits.length) return null;
  const hit = hits[0];
  const mesh = /** @type {THREE.Mesh} */ (hit.object);
  const uv = hit.uv;
  if (!uv) return null;
  const px = uv.x * SCREEN_W;
  const py = (1 - uv.y) * SCREEN_H;
  const list = mesh === screenExit ? screenHitsExit : screenHitsEntry;
  for (const b of list) {
    if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b.action;
  }
  return null;
}

function runAction(action) {
  if (uiPage === "service") {
    if (action === "close_service") {
      uiPage = "patron";
      renderDisplay();
      return;
    }
    if (action === "toggle_db") {
      engine.setDbOnline(!engine.dbOnline);
      engine.startup();
    } else if (action === "toggle_pay") {
      engine.setPaymentGatewayOnline(!engine.paymentGatewayOnline);
      engine.startup();
    } else if (action === "toggle_paper") {
      engine.setTicketPaperOk(!engine.ticketPaperOk);
      engine.startup();
    } else if (action === "toggle_receipt") {
      engine.setReceiptPaperOk(!engine.receiptPaperOk);
      engine.startup();
    } else if (action === "fault_sim") {
      engine.triggerCriticalFault();
      uiPage = "patron";
    }
    renderDisplay();
    return;
  }

  const s = engine.snapshot;
  switch (action) {
    case "service":
      if (s.flow === "IDLE" && s.kioskStatus !== "OUT_OF_SERVICE") {
        uiPage = "service";
        renderDisplay();
      }
      break;
    case "entry":
      if (s.flow === "IDLE") void engine.pressEntryButton();
      break;
    case "exit":
      if (s.flow === "IDLE") engine.beginExit();
      break;
    case "scan":
      engine.scanFromReader();
      break;
    case "back_exit":
      engine.cancelExitFlow();
      break;
    case "pay_ok":
      void engine.pay({ approve: true });
      break;
    case "pay_bad":
      void engine.pay({ approve: false });
      break;
    case "done":
      engine.acknowledgeExit();
      break;
    case "reset":
      engine.resetAfterFault();
      break;
    default:
      break;
  }
}

let ptrDown = null;
canvas.addEventListener("pointerdown", (e) => {
  ptrDown = { x: e.clientX, y: e.clientY, t: performance.now() };
});
canvas.addEventListener("pointerup", (e) => {
  if (!ptrDown) return;
  const dx = e.clientX - ptrDown.x;
  const dy = e.clientY - ptrDown.y;
  const dt = performance.now() - ptrDown.t;
  ptrDown = null;
  if (dx * dx + dy * dy > 100) return;
  if (dt > 1100) return;
  const action = pickScreenPixel(e.clientX, e.clientY);
  if (action) runAction(action);
});

renderDisplay();

function tick(t) {
  gateAngleEntry += (gateTargetAngleEntry() - gateAngleEntry) * 0.09;
  gateAngleExit += (gateTargetAngleExit() - gateAngleExit) * 0.09;
  barPivot.rotation.x = gateAngleEntry;
  exitBarPivot.rotation.x = gateAngleExit;
  stars.rotation.y = t * 0.000012;
  kioskEntryGroup.rotation.y = ENTR_YAW + Math.sin(t * 0.00022) * 0.012;
  kioskExitGroup.rotation.y = EXIT_YAW + Math.sin(t * 0.00019 + 0.4) * 0.012;
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
