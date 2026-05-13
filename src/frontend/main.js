import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { KioskEngine } from "./kioskEngine.js";

const SCREEN_W = 960;
const SCREEN_H = 540;

/** Fixed-pitch readout (DOS-era kiosk). */
const KFONT = '"Courier New", Courier, "Lucida Console", monospace';
const KFONT_TITLE = `bold 15px ${KFONT}`;
const KFONT_BTN = `bold 15px ${KFONT}`;
const KFONT_MSG = `15px ${KFONT}`;
const KFONT_DTL = `13px ${KFONT}`;
const KFONT_ACCENT = `bold 13px ${KFONT}`;
const K_LH_MSG = 18;
const K_LH_DTL = 15;
const K_LH_HINT = 15;

const canvas = document.getElementById("c");
const driveHintEl = document.getElementById("drive-hint");
const helpSettingsBtn = document.getElementById("help-settings");
const popoutEl = document.getElementById("kiosk-popout");
const popoutCanvasEl = /** @type {HTMLCanvasElement | null} */ (document.getElementById("kiosk-popout-canvas"));
/** @type {CanvasRenderingContext2D | null} */
const popoutCtx = popoutCanvasEl ? popoutCanvasEl.getContext("2d") : null;
const popoutHits = [];
/** @type {null | "entry" | "exit"} */
let popoutSource = null;
/** @type {'patron' | 'service'} */
let uiPage = "patron";

const parkCelebrationEl = document.getElementById("park-celebration");
const parkCelebrationOkEl = document.getElementById("park-celebration-ok");
/** One celebration per visit after first successful stall park (reset on exit / fault reset). */
let parkCelebrationShown = false;
/** After ENTRY_GATE_OPEN, slip hidden until next print cycle (3D + UI). */
let entryTicketPulled = false;

/** Patron help card: auto-hide after this; reopen via #help-settings. */
const DRIVE_HINT_AUTOCLOSE_MS = 11_000;
let driveHintHideTimerId = 0;

function clearDriveHintHideTimer() {
  if (driveHintHideTimerId !== 0) {
    clearTimeout(driveHintHideTimerId);
    driveHintHideTimerId = 0;
  }
}

function hideDriveHintPanel() {
  clearDriveHintHideTimer();
  if (!driveHintEl) return;
  driveHintEl.classList.add("drive-hint--hidden");
  driveHintEl.setAttribute("aria-hidden", "true");
}

function scheduleDriveHintAutoHide() {
  clearDriveHintHideTimer();
  if (!driveHintEl || uiPage !== "patron") return;
  driveHintHideTimerId = window.setTimeout(() => {
    driveHintHideTimerId = 0;
    hideDriveHintPanel();
  }, DRIVE_HINT_AUTOCLOSE_MS);
}

function showDriveHintPanelAndSchedule() {
  if (!driveHintEl || uiPage !== "patron") return;
  driveHintEl.classList.remove("drive-hint--hidden");
  driveHintEl.setAttribute("aria-hidden", "false");
  scheduleDriveHintAutoHide();
}

function hideParkCelebration() {
  if (!parkCelebrationEl) return;
  parkCelebrationEl.classList.add("park-celebration--hidden");
  parkCelebrationEl.setAttribute("aria-hidden", "true");
}

function showParkCelebration() {
  if (!parkCelebrationEl) return;
  parkCelebrationEl.classList.remove("park-celebration--hidden");
  parkCelebrationEl.setAttribute("aria-hidden", "false");
}

parkCelebrationOkEl?.addEventListener("click", () => hideParkCelebration());

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
screenTexEntry.minFilter = screenTexExit.minFilter = THREE.NearestFilter;
screenTexEntry.magFilter = screenTexExit.magFilter = THREE.NearestFilter;
for (const c of [screenCanvasEntry, screenCanvasExit]) {
  const xctx = c.getContext("2d");
  if (xctx) xctx.imageSmoothingEnabled = false;
}

/** Patron drive sim (must exist before KioskEngine — startup calls renderDisplay). */
/** Patron at entry kiosk zone (patron car only). */
let playerAtEntryBooth = false;
/** Currently selected vehicle for arrow-key driving. */
let selectedDriveGroup = /** @type {THREE.Group | null} */ (null);
const keyDrive = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };

const engine = new KioskEngine(() => renderDisplay());
engine.startup();

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0xbfe8ff, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
/** Softer distance fog — bright summer haze */
scene.fog = new THREE.Fog(0xd4ecff, 35, 155);

/** Gradient sky (canvas → texture) — bright sunny day */
const skyC = document.createElement("canvas");
skyC.width = 2;
skyC.height = 512;
const sctx = skyC.getContext("2d");
const sg = sctx.createLinearGradient(0, 0, 0, 512);
sg.addColorStop(0, "#38a8ff");
sg.addColorStop(0.22, "#7dd3fc");
sg.addColorStop(0.48, "#b8e8ff");
sg.addColorStop(0.72, "#fff4c8");
sg.addColorStop(0.88, "#fff8e6");
sg.addColorStop(1, "#fffef5");
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
/** Center lot drive width (∥ Z) — perimeter circulation inside the fence matches this */
const LOT_CENTER_DRIVE_W = aisleX1 - aisleX0;
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
const lotSlabBaseW = 18;
const lotSlabBaseD = 19;
/** Inner margin on each side inside fence = same width as center aisle (room to manoeuvre) */
const lotPerimeterBand = LOT_CENTER_DRIVE_W;
const lotPlaneW = lotSlabBaseW + 2 * lotPerimeterBand;
const lotPlaneD = lotSlabBaseD + 2 * lotPerimeterBand;
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
/** After EXIT_DONE, selected car past this +X leaves the lot (connector toward main road) — auto-finishes exit. */
const EXIT_COMPLETE_DRIVEOUT_X = connX2 + 2.8;
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

const camera = new THREE.PerspectiveCamera(48, 1, 0.04, 220);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(CAM_TARGET_X, 1.32, CAM_TARGET_Z);
controls.enableDamping = false;
controls.enableRotate = false;
controls.enablePan = false;
controls.enableZoom = false;
controls.enabled = false;
controls.minDistance = 0.09;
controls.maxDistance = 95;
/** Wide enough that chase → manual handoff is not clamped every frame (which killed drag). */
controls.minPolarAngle = Math.PI * 0.04;
controls.maxPolarAngle = Math.PI - 0.1;
controls.screenSpacePanning = true;
controls.panSpeed = 0.65;
controls.rotateSpeed = 0.62;

/** V = orbit / zoom / pan; V again = chase cam behind car (default). */
let manualCameraView = false;
/** Same focal point `applyChaseCamera` uses so orbit starts from the current chase view. */
function syncOrbitTargetToChaseLookAt() {
  const car = selectedDriveGroup;
  if (car) {
    const lookY = car.position.y + 0.92;
    controls.target.set(car.position.x, lookY, car.position.z);
  } else {
    controls.target.set(CAM_TARGET_X, 1.32, CAM_TARGET_Z);
  }
}
function setManualCameraView(on) {
  manualCameraView = !!on;
  controls.enabled = manualCameraView;
  controls.enableRotate = manualCameraView;
  controls.enablePan = manualCameraView;
  controls.enableZoom = manualCameraView;
  if (manualCameraView) {
    syncOrbitTargetToChaseLookAt();
    controls.update();
  }
}

function closeKioskPopout() {
  popoutSource = null;
  if (popoutEl) {
    popoutEl.classList.add("kiosk-popout--hidden");
    popoutEl.setAttribute("aria-hidden", "true");
  }
}

function openKioskPopout(which) {
  if (!popoutEl || !popoutCtx || uiPage !== "patron") return;
  popoutSource = which;
  popoutEl.classList.remove("kiosk-popout--hidden");
  popoutEl.setAttribute("aria-hidden", "false");
  renderDisplay();
}

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const t = /** @type {HTMLElement | null} */ (e.target);
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  if (e.key === "v" || e.key === "V") {
    e.preventDefault();
    setManualCameraView(!manualCameraView);
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "Escape") {
    e.preventDefault();
    if (parkCelebrationEl && !parkCelebrationEl.classList.contains("park-celebration--hidden")) {
      hideParkCelebration();
      return;
    }
    if (popoutSource) closeKioskPopout();
  }
});

/** East fence gap in Z for connector (west fence continuous) */
const entryGapZ0 = GATE_Z - connPavementZHalf - 0.14;
const entryGapZ1 = GATE_Z + connPavementZHalf + 0.14;

/** Lights — open-air lot */
const hemi = new THREE.HemisphereLight(0xd8f0ff, 0xa6d4a0, 1.05);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfffef5, 1.45);
key.position.set(22, 38, 14);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.bias = -0.0002;
scene.add(key);
const rim = new THREE.PointLight(0xffe8c8, 0.35, 28);
rim.position.set(8, 14, -6);
scene.add(rim);

/** Distant hills (simple scenic silhouettes) */
const hillMat = new THREE.MeshStandardMaterial({
  color: 0x7ec87a,
  metalness: 0,
  roughness: 0.9,
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
  new THREE.MeshStandardMaterial({ color: 0x6ab97a, metalness: 0, roughness: 0.9 })
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
  new THREE.MeshStandardMaterial({ color: 0x62b06e, metalness: 0, roughness: 0.92 })
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

/** Perimeter trees + shrubs outside the fence — bright summer lot edge */
const trunkMatTree = new THREE.MeshStandardMaterial({ color: 0x5c4030, roughness: 0.96, metalness: 0 });
const leafMatTree = new THREE.MeshStandardMaterial({
  color: 0x2a7a3e,
  roughness: 0.88,
  metalness: 0,
  flatShading: true,
});
const shrubMat = new THREE.MeshStandardMaterial({
  color: 0x4a9a55,
  roughness: 0.9,
  metalness: 0,
  flatShading: true,
});
function makeTreeInstance(scl) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.11 * scl, 0.15 * scl, 1.0 * scl, 8), trunkMatTree);
  trunk.position.y = 0.5 * scl;
  trunk.castShadow = true;
  g.add(trunk);
  for (let lyr = 0; lyr < 3; lyr++) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry((0.9 - lyr * 0.2) * scl, 1.15 * scl, 8), leafMatTree);
    cone.position.y = scl * (1.0 + 0.4 + lyr * 0.78);
    cone.castShadow = true;
    g.add(cone);
  }
  return g;
}
const treeOx = 3.2;
const treeOz = 3.2;
const treeStepN = 5;
for (let i = 0; i < treeStepN; i++) {
  const u = i / Math.max(1, treeStepN - 1);
  const x = xFenceL - treeOx + (xFenceR - xFenceL + treeOx * 2) * u + (Math.random() - 0.5) * 0.65;
  const tN = makeTreeInstance(0.92 + Math.random() * 0.28);
  tN.position.set(x, 0, zFenceN + treeOz + Math.random() * 1.2);
  tN.rotation.y = Math.random() * Math.PI * 2;
  scene.add(tN);
  const tS = makeTreeInstance(0.88 + Math.random() * 0.26);
  tS.position.set(x + 0.45, 0, zFenceS - treeOz - Math.random() * 1.1);
  tS.rotation.y = Math.random() * Math.PI * 2;
  scene.add(tS);
}
const treeStepW = 4;
for (let j = 0; j < treeStepW; j++) {
  const z = zFenceS + ((zFenceN - zFenceS) * j) / Math.max(1, treeStepW - 1);
  const tW = makeTreeInstance(0.85 + Math.random() * 0.32);
  tW.position.set(xFenceL - treeOx - Math.random(), 0, z + (Math.random() - 0.5) * 1.4);
  tW.rotation.y = Math.random() * Math.PI * 2;
  scene.add(tW);
}
const eastTreeX = xFenceR + treeOx;
for (let ei = 0; ei < treeStepW; ei++) {
  const z = zFenceS + 3 + ((zFenceN - 3) - (zFenceS + 3)) * (ei / Math.max(1, treeStepW - 1));
  if (z > entryGapZ0 - 1.2 && z < entryGapZ1 + 1.2) continue;
  const tE = makeTreeInstance(0.82 + Math.random() * 0.3);
  tE.position.set(eastTreeX + Math.random() * 1.5, 0, z + (Math.random() - 0.5) * 0.7);
  tE.rotation.y = Math.random() * Math.PI * 2;
  scene.add(tE);
}
for (let k = 0; k < 28; k++) {
  const bush = new THREE.Mesh(new THREE.SphereGeometry(0.35 + Math.random() * 0.2, 6, 5), shrubMat);
  const side = k % 4;
  let bx;
  let bz;
  if (side === 0) {
    bx = xFenceL - treeOx * 0.55 + Math.random() * 0.45;
    bz = zFenceS + Math.random() * (zFenceN - zFenceS);
  } else if (side === 1) {
    bx = xFenceR + treeOx * 0.55 + Math.random() * 0.55;
    bz = zFenceS + Math.random() * (zFenceN - zFenceS);
    if (bz > entryGapZ0 && bz < entryGapZ1) continue;
  } else if (side === 2) {
    bx = xFenceL + Math.random() * (xFenceR - xFenceL);
    bz = zFenceN + treeOz * 0.45 + Math.random() * 0.55;
  } else {
    bx = xFenceL + Math.random() * (xFenceR - xFenceL);
    bz = zFenceS - treeOz * 0.45 - Math.random() * 0.55;
  }
  bush.position.set(bx, 0.2 + Math.random() * 0.08, bz);
  bush.scale.setScalar(0.85 + Math.random() * 0.25);
  bush.castShadow = true;
  scene.add(bush);
}

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

/** Perimeter circulation (∥ fence), same width as center drive — darker asphalt ring */
const innerSpanX = lotPlaneW - 2 * lotPerimeterBand;
const innerSpanZ = lotPlaneD - 2 * lotPerimeterBand;
const periY = 0.0122;
const addPeriStrip = (w, d, cx, cz) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), driveLaneMat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(cx, periY, cz);
  m.receiveShadow = true;
  scene.add(m);
};
addPeriStrip(lotPerimeterBand, innerSpanZ, lotCenterX - lotPlaneW * 0.5 + lotPerimeterBand * 0.5, lotCenterZ);
addPeriStrip(lotPerimeterBand, innerSpanZ, lotCenterX + lotPlaneW * 0.5 - lotPerimeterBand * 0.5, lotCenterZ);
addPeriStrip(innerSpanX, lotPerimeterBand, lotCenterX, lotCenterZ - lotPlaneD * 0.5 + lotPerimeterBand * 0.5);
addPeriStrip(innerSpanX, lotPerimeterBand, lotCenterX, lotCenterZ + lotPlaneD * 0.5 - lotPerimeterBand * 0.5);

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

/** Patron car with side windows that can roll down (meshes move in cabin local −Y). */
function makePlayerCar() {
  const g = makeCar(0x2a5588);
  const cabin = /** @type {THREE.Mesh} */ (g.children[1]);
  const winMat = new THREE.MeshStandardMaterial({
    color: 0x6a9fd0,
    metalness: 0.35,
    roughness: 0.12,
    transparent: true,
    opacity: 0.42,
  });
  const winGeo = new THREE.PlaneGeometry(0.34, 0.2);
  const wL = new THREE.Mesh(winGeo, winMat);
  wL.position.set(0.445, 0.02, -0.08);
  wL.rotation.y = Math.PI / 2;
  const wR = new THREE.Mesh(winGeo, winMat.clone());
  wR.position.set(-0.445, 0.02, -0.08);
  wR.rotation.y = -Math.PI / 2;
  cabin.add(wL);
  cabin.add(wR);
  return { group: g, winL: wL, winR: wR };
}

/** One east-side stall left empty for the patron demo */
const FREE_STALL_INDEX = 2;

/** Body mesh nose points opposite travel direction; +π aligns model with drive + chase camera. */
const VEHICLE_MESH_YAW_OFFSET = Math.PI;

/** All vehicles the user can select and drive with the keyboard (patron car added below). */
const driveableCars = /** @type {THREE.Group[]} */ ([]);

const carColors = [0x8b2e3c, 0x1a5680, 0xc46028, 0x2f6b45, 0x5a4578, 0x6d6a2e, 0x444444, 0x9a8b7a];
for (let k = 0; k < stallCount; k++) {
  const z = z0 + k * stallPitch;
  const cA = makeCar(carColors[k % carColors.length]);
  cA.position.set(rowAX, 0, z);
  cA.rotation.y = -Math.PI / 2 + VEHICLE_MESH_YAW_OFFSET;
  cA.userData.driveable = true;
  scene.add(cA);
  driveableCars.push(cA);
  if (k !== FREE_STALL_INDEX) {
    const cB = makeCar(carColors[(k + 3) % carColors.length]);
    cB.position.set(rowBX, 0, z);
    cB.rotation.y = Math.PI / 2 + VEHICLE_MESH_YAW_OFFSET;
    cB.userData.driveable = true;
    scene.add(cB);
    driveableCars.push(cB);
  }
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
  new THREE.PointsMaterial({ color: 0xffffff, size: 0.035, transparent: true, opacity: 0.06, depthWrite: false })
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

/** Printed ticket + receipt slips (3D) */
const slipMat = new THREE.MeshStandardMaterial({ color: 0xf5f2e8, metalness: 0.05, roughness: 0.85 });
const entryTicketMesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.018, 0.075), slipMat);
entryTicketMesh.position.set(0, 0.62, 0.38);
entryTicketMesh.rotation.x = 0.12;
entryTicketMesh.visible = false;
entryTicketMesh.castShadow = true;
kioskEntryGroup.add(entryTicketMesh);

const exitReceiptMesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.018, 0.08), slipMat);
exitReceiptMesh.position.set(0, 0.62, -0.38);
exitReceiptMesh.rotation.x = -0.14;
exitReceiptMesh.visible = false;
exitReceiptMesh.castShadow = true;
kioskExitGroup.add(exitReceiptMesh);

const screenEntry = kioskEntryGroup.getObjectByName("kioskDisplayEntry");
const screenExit = kioskExitGroup.getObjectByName("kioskDisplayExit");

/** Patron + entry / exit drive zones (connSouthZc / connNorthZc from connector layout) */
const PATRON_ENTRY_Z = connSouthZc;
const PATRON_EXIT_Z = connNorthZc;
const ENTRY_ZONE = { x: GATE_POST_X + 2.35, z: PATRON_ENTRY_Z, rSq: 2.85 * 2.85 };
const wpPatronStart = { x: GATE_POST_X + 5.25, z: PATRON_ENTRY_Z, ry: Math.PI * 0.5 + VEHICLE_MESH_YAW_OFFSET };
/** Exit staging hubs — drive any car into one to open the exit kiosk pop-out */
const EXIT_STAGING = [
  { x: EXIT_KIOSK_X - 1.0, z: EXIT_KIOSK_Z - 0.55, rSq: 2.35 * 2.35 },
  { x: GATE_POST_X - 1.1, z: PATRON_EXIT_Z + 0.4, rSq: 2.15 * 2.15 },
  { x: rowBX - 0.9, z: EXIT_KIOSK_Z - 1.75, rSq: 2.35 * 2.35 },
];
const patronStallX = rowBX;
const patronStallZ = z0 + FREE_STALL_INDEX * stallPitch;
const patronStallHalfX = 2.45;
const patronStallHalfZ = 2.35;

const playerCar = makePlayerCar();
const playerCarGroup = playerCar.group;
playerCarGroup.userData.driveable = true;
playerCarGroup.userData.isPatronCar = true;
playerCarGroup.position.set(wpPatronStart.x, 0, wpPatronStart.z);
playerCarGroup.rotation.y = wpPatronStart.ry;
scene.add(playerCarGroup);
driveableCars.push(playerCarGroup);
selectedDriveGroup = playerCarGroup;

function xzDistSq(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

function patronInFreeStall() {
  for (let i = 0; i < driveableCars.length; i++) {
    const g = driveableCars[i];
    if (
      Math.abs(g.position.x - patronStallX) < patronStallHalfX &&
      Math.abs(g.position.z - patronStallZ) < patronStallHalfZ
    ) {
      return true;
    }
  }
  return false;
}

function carInEntryZone(g) {
  return !!(
    g &&
    g.userData?.driveable &&
    xzDistSq(g.position.x, g.position.z, ENTRY_ZONE.x, ENTRY_ZONE.z) <= ENTRY_ZONE.rSq
  );
}

function anyDriveableCarInEntryZone() {
  for (let i = 0; i < driveableCars.length; i++) {
    if (carInEntryZone(driveableCars[i])) return true;
  }
  return false;
}

function anyDriveablePastExitDriveOutLine() {
  for (let i = 0; i < driveableCars.length; i++) {
    if (driveableCars[i].position.x >= EXIT_COMPLETE_DRIVEOUT_X) return true;
  }
  return false;
}

function carInAnyExitStaging(g) {
  for (const z of EXIT_STAGING) {
    if (xzDistSq(g.position.x, g.position.z, z.x, z.z) <= z.rSq) return true;
  }
  return false;
}

function pickDriveableCar(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const cx = clientX - rect.left;
  const cy = clientY - rect.top;
  ndc.x = (cx / rect.width) * 2 - 1;
  ndc.y = -(cy / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(driveableCars, true);
  if (!hits.length) return null;
  let o = hits[0].object;
  while (o) {
    if (o.userData?.driveable) return /** @type {THREE.Group} */ (o);
    o = o.parent;
  }
  return null;
}

function clampCarToWorld(g) {
  const margin = 1.2;
  g.position.x = THREE.MathUtils.clamp(g.position.x, xFenceL - 8, roadCenterX + roadHalfW + 18);
  g.position.z = THREE.MathUtils.clamp(g.position.z, zFenceS - margin, zFenceN + margin);
}

function updateKeyboardDrive(dt) {
  const g = selectedDriveGroup;
  if (!g) return;
  const prevX = g.position.x;
  const prevZ = g.position.z;
  const move = 5.2 * dt;
  const turn = 2.35 * dt;
  const ry = g.rotation.y;
  const fx = Math.sin(ry);
  const fz = Math.cos(ry);
  /** Up = forward, Down = reverse (after mesh yaw +π) */
  if (keyDrive.ArrowUp) {
    g.position.x += fx * move;
    g.position.z += fz * move;
  }
  if (keyDrive.ArrowDown) {
    g.position.x -= fx * move;
    g.position.z -= fz * move;
  }
  /** Left / Right steer the nose (yaw); car stays forward-facing along its heading */
  if (keyDrive.ArrowLeft) g.rotation.y += turn;
  if (keyDrive.ArrowRight) g.rotation.y -= turn;
  clampCarToWorld(g);
  resolveCarBoomCollision(g, prevX, prevZ);
}

/** Third-person camera: slightly above and behind the selected car, follows every frame. */
function applyChaseCamera() {
  const car = selectedDriveGroup;
  if (!car) return;
  const ry = car.rotation.y;
  const fx = Math.sin(ry);
  const fz = Math.cos(ry);
  const behind = 6.75;
  const height = 2.65;
  const lookY = car.position.y + 0.92;
  const cx = car.position.x;
  const cz = car.position.z;
  camera.position.set(cx - fx * behind, car.position.y + height, cz - fz * behind);
  camera.lookAt(cx, lookY, cz);
}

let prevAtEntryZone = false;
let prevAtExitStaging = false;

function syncPopoutsToDriveZones() {
  if (uiPage !== "patron") return;
  const atEntry = anyDriveableCarInEntryZone();
  playerAtEntryBooth = atEntry;
  if (atEntry && popoutSource !== "entry") openKioskPopout("entry");
  const exitPick = selectedDriveGroup && carInAnyExitStaging(selectedDriveGroup);
  if (exitPick && popoutSource !== "exit") openKioskPopout("exit");
  if (atEntry !== prevAtEntryZone || exitPick !== prevAtExitStaging) {
    prevAtEntryZone = atEntry;
    prevAtExitStaging = !!exitPick;
    renderDisplay();
  }
}

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

/** Boom target angle (radians); collision disabled when current angle is at or past this fraction of “open”. */
const GATE_OPEN_ANGLE = -Math.PI * 0.48;
const GATE_BOOM_COLLISION_OFF = GATE_OPEN_ANGLE * 0.82;
/** XZ footprint: car length ~2 m — circle vs boom AABB */
const CAR_GATE_COLLISION_R = 1.05;
const _gateBarBox = new THREE.Box3();

function circleHitsAabbXZ(px, pz, r, minX, maxX, minZ, maxZ) {
  const qx = THREE.MathUtils.clamp(px, minX, maxX);
  const qz = THREE.MathUtils.clamp(pz, minZ, maxZ);
  const dx = px - qx;
  const dz = pz - qz;
  return dx * dx + dz * dz <= r * r;
}

/** Revert XZ move if the car would intersect a closed or partly lowered entry/exit boom. */
function resolveCarBoomCollision(g, prevX, prevZ) {
  gateGroup.updateMatrixWorld(true);
  exitGateGroup.updateMatrixWorld(true);
  const px = g.position.x;
  const pz = g.position.z;
  const r = CAR_GATE_COLLISION_R;

  if (gateAngleEntry > GATE_BOOM_COLLISION_OFF) {
    _gateBarBox.setFromObject(bar);
    if (circleHitsAabbXZ(px, pz, r, _gateBarBox.min.x, _gateBarBox.max.x, _gateBarBox.min.z, _gateBarBox.max.z)) {
      g.position.x = prevX;
      g.position.z = prevZ;
      return;
    }
  }
  if (gateAngleExit > GATE_BOOM_COLLISION_OFF) {
    _gateBarBox.setFromObject(exitBar);
    if (circleHitsAabbXZ(px, pz, r, _gateBarBox.min.x, _gateBarBox.max.x, _gateBarBox.min.z, _gateBarBox.max.z)) {
      g.position.x = prevX;
      g.position.z = prevZ;
    }
  }
}

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

/** Classic PC window on teal desktop (Win 9x look) */
function drawRetroShell(ctx, titleBar) {
  ctx.fillStyle = "#008080";
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  const bx = 10;
  const by = 10;
  const bw = SCREEN_W - 20;
  const bh = SCREEN_H - 20;
  ctx.fillStyle = "#c0c0c0";
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.strokeRect(bx, by, bw, bh);
  ctx.strokeStyle = "#404040";
  ctx.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
  ctx.fillStyle = "#000080";
  ctx.fillRect(bx + 4, by + 4, bw - 8, 26);
  ctx.fillStyle = "#ffffff";
  ctx.font = KFONT_TITLE;
  ctx.textBaseline = "middle";
  ctx.fillText(titleBar, bx + 10, by + 17);
  ctx.textBaseline = "alphabetic";
  const innerLeft = bx + 12;
  const innerTop = by + 38;
  const innerW = bw - 24;
  const innerH = bh - 50;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(innerLeft, innerTop, innerW, innerH);
  ctx.strokeStyle = "#808080";
  ctx.strokeRect(innerLeft, innerTop, innerW, innerH);
  ctx.strokeStyle = "#000000";
  ctx.strokeRect(innerLeft + 1, innerTop + 1, innerW - 2, innerH - 2);
  const innerBottom = innerTop + innerH;
  /** First body line baseline: below title bar + inner frame so glyphs do not clip the top border */
  const bodyTop = innerTop + 22;
  return { x: innerLeft + 8, y: bodyTop, w: innerW - 18, innerBottom };
}

function drawButton(hits, ctx, x, y, w, h, label, primary, action) {
  ctx.fillStyle = primary ? "#c0c0c0" : "#d8d4c8";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, w, 2);
  ctx.fillRect(x, y, 2, h);
  ctx.fillStyle = primary ? "#808080" : "#909090";
  ctx.fillRect(x, y + h - 2, w, 2);
  ctx.fillRect(x + w - 2, y, 2, h);
  ctx.fillStyle = "#000000";
  ctx.font = KFONT_BTN;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, y + h / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  hits.push({ x, y, w, h, action });
}

function drawSmallChip(hits, ctx, x, y, w, h, label, action) {
  ctx.fillStyle = "#c0c0c0";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillStyle = "#808080";
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x + w - 1, y, 1, h);
  ctx.fillStyle = "#000000";
  ctx.font = KFONT_DTL;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, y + h / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  hits.push({ x, y, w, h, action });
}

function drawPatronScreenEntry(s, ctx = screenCanvasEntry.getContext("2d"), hits = screenHitsEntry) {
  hits.length = 0;
  ctx.imageSmoothingEnabled = false;
  const box = drawRetroShell(ctx, "Entry - PARKING.EXE");
  const x0 = box.x;
  const maxW = box.w;
  const rowY = SCREEN_H - 72;
  const btnH = 44;
  const fullW = SCREEN_W - 52;
  const textMaxY = rowY - 52;

  let cy = box.y;
  ctx.fillStyle = "#000000";
  ctx.font = KFONT_MSG;
  cy = wrapTextBlock(ctx, s.message || "...", x0, cy, maxW, K_LH_MSG, textMaxY) + 6;

  ctx.font = KFONT_DTL;
  for (const para of (s.detail || "").split("\n")) {
    const t = para.trim();
    if (!t || cy >= textMaxY) continue;
    cy = wrapTextBlock(ctx, t, x0, cy, maxW, K_LH_DTL, textMaxY) + 4;
  }

  const hintTop = Math.min(cy + 10, rowY - btnH - 40);

  if (s.kioskStatus === "OUT_OF_SERVICE") {
    drawButton(hits, ctx, 26, rowY, fullW, btnH, "Reset", true, "reset");
    return;
  }

  if (s.flow === "EXIT_SCAN" || s.flow === "EXIT_PAYMENT" || s.flow === "EXIT_DONE") {
    ctx.fillStyle = "#000000";
    ctx.font = KFONT_DTL;
    wrapTextBlock(ctx, "USE EXIT KIOSK IN LOT.", x0, hintTop, maxW, K_LH_HINT, box.innerBottom - 24);
    return;
  }

  if (s.flow === "IDLE") {
    if (s.playerParkedInLot) {
      ctx.fillStyle = "#000000";
      ctx.font = KFONT_DTL;
      wrapTextBlock(ctx, "PARKED. CLICK CAR. ARROWS=DRIVE. EXIT=LOT.", x0, hintTop, maxW, K_LH_HINT, rowY - 6);
      return;
    }
    drawButton(hits, ctx, 26, rowY, fullW, btnH, "Get ticket", playerAtEntryBooth, "entry");
    drawSmallChip(hits, ctx, SCREEN_W - 128, 18, 96, 32, "Svc", "service");
    return;
  }

  if (s.flow === "ENTRY_PRINTING") {
    ctx.fillStyle = "#000000";
    ctx.font = KFONT_MSG;
    ctx.fillText("PRINTING...", x0, rowY - 8);
    return;
  }

  if (s.flow === "ENTRY_GATE_OPEN") {
    ctx.fillStyle = "#006000";
    ctx.font = KFONT_ACCENT;
    if (!entryTicketPulled) {
      wrapTextBlock(
        ctx,
        "TICKET OK. TAP TAKE OR CLICK SLIP.",
        x0,
        hintTop,
        maxW,
        K_LH_HINT,
        rowY - btnH - 14
      );
      drawButton(hits, ctx, 26, rowY, fullW, btnH, "Take ticket", true, "take_ticket");
    } else {
      wrapTextBlock(ctx, "GO. DRIVE IN.", x0, hintTop, maxW, K_LH_HINT, rowY - 6);
    }
  }
}

function drawPatronScreenExit(s, ctx = screenCanvasExit.getContext("2d"), hits = screenHitsExit) {
  hits.length = 0;
  ctx.imageSmoothingEnabled = false;
  const box = drawRetroShell(ctx, "Exit - PARKING.EXE");
  const x0 = box.x;
  const maxW = box.w;
  const rowY = SCREEN_H - 72;
  const btnH = 44;
  const gap = 12;
  const fullW = SCREEN_W - 52;
  const halfW = (fullW - gap) / 2;
  const textMaxY = rowY - 52;

  let cy = box.y;
  ctx.fillStyle = "#000000";
  ctx.font = KFONT_MSG;
  cy = wrapTextBlock(ctx, s.message || "...", x0, cy, maxW, K_LH_MSG, textMaxY) + 6;

  ctx.font = KFONT_DTL;
  for (const para of (s.detail || "").split("\n")) {
    const t = para.trim();
    if (!t || cy >= textMaxY) continue;
    cy = wrapTextBlock(ctx, t, x0, cy, maxW, K_LH_DTL, textMaxY) + 4;
  }

  const hintTop = Math.min(cy + 10, rowY - btnH - 40);

  if (s.kioskStatus === "OUT_OF_SERVICE") {
    drawButton(hits, ctx, 26, rowY, fullW, btnH, "Reset", true, "reset");
    return;
  }

  if (s.flow === "ENTRY_PRINTING" || s.flow === "ENTRY_GATE_OPEN") {
    ctx.fillStyle = "#000000";
    ctx.font = KFONT_DTL;
    wrapTextBlock(ctx, "NEED ENTRY TICKET FIRST.", x0, hintTop, maxW, K_LH_HINT, box.innerBottom - 24);
    return;
  }

  if (s.flow === "EXIT_SUMMARY") {
    ctx.fillStyle = "#000000";
    ctx.font = KFONT_MSG;
    wrapTextBlock(ctx, s.message || "WAIT...", x0, hintTop, maxW, K_LH_MSG, rowY - 6);
    return;
  }

  if (s.flow === "IDLE") {
    drawButton(hits, ctx, 26, rowY, fullW, btnH, "Exit / pay", true, "exit");
    drawSmallChip(hits, ctx, SCREEN_W - 128, 18, 96, 32, "Svc", "service");
    return;
  }

  if (s.flow === "EXIT_SCAN") {
    drawButton(hits, ctx, 26, rowY, halfW, btnH, "Scan ticket", true, "scan");
    drawButton(hits, ctx, 26 + halfW + gap, rowY, halfW, btnH, "Back", false, "back_exit");
    return;
  }

  if (s.flow === "EXIT_PAYMENT") {
    const w3 = (fullW - gap * 2) / 3;
    drawButton(hits, ctx, 26, rowY, w3, btnH, "Card", true, "pay_ok");
    drawButton(hits, ctx, 26 + w3 + gap, rowY, w3, btnH, "Cash", true, "pay_cash");
    drawButton(hits, ctx, 26 + 2 * (w3 + gap), rowY, w3, btnH, "Decline", false, "pay_bad");
    return;
  }

  if (s.flow === "EXIT_DONE") {
    ctx.fillStyle = "#000000";
    ctx.font = KFONT_DTL;
    wrapTextBlock(
      ctx,
      "GATE OPEN. DRIVE OUT ONTO THE ROAD — SESSION ENDS WHEN YOU LEAVE.",
      x0,
      hintTop,
      maxW,
      K_LH_HINT,
      box.innerBottom - 24
    );
    return;
  }
}

/**
 * Word-wrap text; stops before maxY. Returns baseline after last line + lineH.
 */
function wrapTextBlock(ctx, text, x, y, maxW, lineH, maxY) {
  const words = String(text || "")
    .split(/\s+/)
    .filter((w) => w.length);
  let line = "";
  let cy = y;
  let lineCount = 0;
  const maxLines = 16;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      if (cy > maxY - lineH) return cy;
      ctx.fillText(line, x, cy);
      line = words[i];
      cy += lineH;
      lineCount++;
      if (lineCount >= maxLines) return cy;
    } else {
      line = test;
    }
  }
  if (line && cy <= maxY - lineH) {
    ctx.fillText(line, x, cy);
    cy += lineH;
  }
  return cy;
}

function drawServiceScreen() {
  const paint = (canvas, hits) => {
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    hits.length = 0;
    const box = drawRetroShell(ctx, "Service - SIM.EXE");
    const x0 = box.x;
    let y = box.y + 8;
    const rowH = 44;
    const rowW = SCREEN_W - 52;
    const rowsReserved = 7 * (rowH + 6) + 24;
    const instructMaxY = box.innerBottom - rowsReserved;

    ctx.fillStyle = "#000000";
    ctx.font = KFONT_DTL;
    y =
      wrapTextBlock(
        ctx,
        "ROW=TOGGLE. RANDOM FAULTS=DEMO ERRS.",
        x0,
        y,
        rowW - 4,
        K_LH_DTL,
        instructMaxY
      ) + 10;

    const s = engine.snapshot;
    const row = (label, on, action) => {
      ctx.fillStyle = on ? "#e8ffe8" : "#ffe8e8";
      ctx.fillRect(26, y, rowW, rowH);
      ctx.strokeStyle = "#808080";
      ctx.strokeRect(26, y, rowW, rowH);
      ctx.fillStyle = "#000000";
      ctx.font = KFONT_MSG;
      ctx.textBaseline = "middle";
      ctx.fillText(`${label}  ${on ? "ON" : "OFF"}`, 38, y + rowH / 2);
      ctx.textBaseline = "alphabetic";
      hits.push({ x: 26, y, w: rowW, h: rowH, action });
      y += rowH + 6;
    };

    row("Database", s.dbOnline, "toggle_db");
    row("Payments", s.paymentGatewayOnline, "toggle_pay");
    row("Ticket paper", s.ticketPaperOk, "toggle_paper");
    row("Receipt paper", s.receiptPaperOk, "toggle_receipt");
    row("Random faults (demo)", s.simulateRandomFaults, "toggle_fault_demo");

    drawButton(hits, ctx, 26, y, rowW, rowH, "Simulate fault", false, "fault_sim");
    y += rowH + 8;
    drawButton(hits, ctx, 26, y, rowW, rowH, "Close", true, "close_service");
  };

  paint(screenCanvasEntry, screenHitsEntry);
  paint(screenCanvasExit, screenHitsExit);
}

function renderDisplay() {
  if (popoutCtx) popoutCtx.imageSmoothingEnabled = false;
  if (uiPage === "service") drawServiceScreen();
  else {
    const s = engine.snapshot;
    drawPatronScreenEntry(s);
    drawPatronScreenExit(s);
    if (popoutSource === "entry" && popoutCtx) {
      popoutHits.length = 0;
      drawPatronScreenEntry(s, popoutCtx, popoutHits);
    } else if (popoutSource === "exit" && popoutCtx) {
      popoutHits.length = 0;
      drawPatronScreenExit(s, popoutCtx, popoutHits);
    }
  }
  screenTexEntry.needsUpdate = true;
  screenTexExit.needsUpdate = true;
  if (driveHintEl && uiPage !== "patron") {
    clearDriveHintHideTimer();
    driveHintEl.classList.add("drive-hint--hidden");
    driveHintEl.setAttribute("aria-hidden", "true");
  }
  if (helpSettingsBtn) {
    helpSettingsBtn.classList.toggle("help-settings--hidden", uiPage !== "patron");
  }
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

function raycastKioskScreen(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const cx = clientX - rect.left;
  const cy = clientY - rect.top;
  ndc.x = (cx / rect.width) * 2 - 1;
  ndc.y = -(cy / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects([screenEntry, screenExit], false);
  return hits.length ? hits[0] : null;
}

/** Printed slip in the entry kiosk slot (only while gate open and slip not yet “taken”). */
function raycastEntryTicketSlip(clientX, clientY) {
  if (engine.snapshot.flow !== "ENTRY_GATE_OPEN" || entryTicketPulled || !entryTicketMesh.visible)
    return null;
  const rect = canvas.getBoundingClientRect();
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(entryTicketMesh, false);
  return hits.length ? hits[0] : null;
}

function pickScreenPixel(clientX, clientY) {
  const hit = raycastKioskScreen(clientX, clientY);
  if (!hit) return null;
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

function pickPopoutPixel(clientX, clientY) {
  if (!popoutCanvasEl || !popoutSource) return null;
  const rect = popoutCanvasEl.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  const sx = ((clientX - rect.left) / rect.width) * SCREEN_W;
  const sy = ((clientY - rect.top) / rect.height) * SCREEN_H;
  for (const b of popoutHits) {
    if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) return b.action;
  }
  return null;
}

function runAction(action) {
  if (uiPage === "service") {
    if (action === "close_service") {
      uiPage = "patron";
      renderDisplay();
      showDriveHintPanelAndSchedule();
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
    } else if (action === "toggle_fault_demo") {
      engine.setSimulateRandomFaults(!engine.simulateRandomFaults);
    } else if (action === "fault_sim") {
      engine.triggerCriticalFault();
      closeKioskPopout();
      uiPage = "patron";
      showDriveHintPanelAndSchedule();
    }
    renderDisplay();
    return;
  }

  const s = engine.snapshot;
  switch (action) {
    case "service":
      if (s.flow === "IDLE" && s.kioskStatus !== "OUT_OF_SERVICE") {
        closeKioskPopout();
        uiPage = "service";
        renderDisplay();
      }
      break;
    case "entry":
      if (!playerAtEntryBooth) break;
      void engine.pressEntryButton();
      renderDisplay();
      break;
    case "take_ticket":
      if (s.flow === "ENTRY_GATE_OPEN" && engine.patronTakeTicketFromSlot()) {
        entryTicketPulled = true;
        renderDisplay();
      }
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
      void engine.pay({ method: "card", approve: true });
      break;
    case "pay_cash":
      void engine.pay({ method: "cash", approve: true });
      break;
    case "pay_bad":
      void engine.pay({ method: "card", approve: false });
      break;
    case "reset":
      engine.resetAfterFault();
      resetPatronSimVisual();
      break;
    default:
      break;
  }
}

let ptrDown = null;
/** After tapping a kiosk mesh, the same gesture still fires `click` on `#c`; ignore one dismiss so the pop-out can stay open. */
let skipNextPopoutDismissClick = false;
canvas.addEventListener("contextmenu", (e) => {
  if (manualCameraView) e.preventDefault();
});
canvas.addEventListener("pointerdown", (e) => {
  ptrDown = { x: e.clientX, y: e.clientY, t: performance.now() };
  skipNextPopoutDismissClick = false;
  canvas.focus();
});
canvas.addEventListener("pointerup", (e) => {
  if (!ptrDown) return;
  const dx = e.clientX - ptrDown.x;
  const dy = e.clientY - ptrDown.y;
  const dt = performance.now() - ptrDown.t;
  ptrDown = null;
  if (dx * dx + dy * dy > 100) return;
  if (dt > 1100) return;
  const picked = pickDriveableCar(e.clientX, e.clientY);
  if (picked) {
    selectedDriveGroup = picked;
    canvas.focus();
    skipNextPopoutDismissClick = true;
    return;
  }
  if (raycastEntryTicketSlip(e.clientX, e.clientY)) {
    if (engine.snapshot.flow === "ENTRY_GATE_OPEN" && !entryTicketPulled && engine.patronTakeTicketFromSlot()) {
      entryTicketPulled = true;
      renderDisplay();
    }
    skipNextPopoutDismissClick = true;
    return;
  }
  const hit3d = raycastKioskScreen(e.clientX, e.clientY);
  if (hit3d && uiPage === "patron") {
    const mesh = /** @type {THREE.Mesh} */ (hit3d.object);
    if (mesh === screenEntry || mesh === screenExit) {
      skipNextPopoutDismissClick = true;
      if (mesh === screenEntry) {
        if (popoutSource !== "entry") openKioskPopout("entry");
      } else {
        if (popoutSource !== "exit") openKioskPopout("exit");
      }
    }
  }
  const action = pickScreenPixel(e.clientX, e.clientY);
  if (action) runAction(action);
});

renderDisplay();

helpSettingsBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (uiPage !== "patron" || !driveHintEl) return;
  if (driveHintEl.classList.contains("drive-hint--hidden")) {
    showDriveHintPanelAndSchedule();
  } else {
    hideDriveHintPanel();
  }
});

scheduleDriveHintAutoHide();

if (popoutCanvasEl) {
  popoutCanvasEl.addEventListener("pointerup", (e) => {
    if (e.button !== 0 && e.button !== undefined) return;
    const action = pickPopoutPixel(e.clientX, e.clientY);
    if (action) {
      runAction(action);
      renderDisplay();
    }
  });
}

document.addEventListener("click", (e) => {
  if (skipNextPopoutDismissClick) {
    skipNextPopoutDismissClick = false;
    return;
  }
  const t = /** @type {Node | null} */ (e.target);
  if (helpSettingsBtn && t && helpSettingsBtn.contains(t)) return;
  if (!popoutSource || !popoutEl || popoutEl.classList.contains("kiosk-popout--hidden")) return;
  if (t && popoutEl.contains(t)) return;
  closeKioskPopout();
});

window.addEventListener(
  "keydown",
  (e) => {
    if (!(e.key in keyDrive)) return;
    e.preventDefault();
    keyDrive[/** @type {keyof typeof keyDrive} */ (e.key)] = true;
  },
  { passive: false }
);
window.addEventListener("keyup", (e) => {
  if (e.key in keyDrive) keyDrive[/** @type {keyof typeof keyDrive} */ (e.key)] = false;
});

/** After exit drive-out: clear UI / pop-outs only — cars stay where they are so another vehicle can exit or the patron can re-enter. */
function resetPatronUiAfterExitDone() {
  entryTicketPulled = false;
  parkCelebrationShown = false;
  hideParkCelebration();
  closeKioskPopout();
  setManualCameraView(false);
  /** Match current zones so we do not treat “still in exit staging” as a new arrival and reopen the exit pop-out. */
  prevAtEntryZone = anyDriveableCarInEntryZone();
  prevAtExitStaging = !!(selectedDriveGroup && carInAnyExitStaging(selectedDriveGroup));
  playerAtEntryBooth = prevAtEntryZone;
}

/** Full demo reset (fault / staff reset): patron car back to spawn, selection = patron car. */
function resetPatronSimVisual() {
  playerAtEntryBooth = false;
  prevAtEntryZone = false;
  prevAtExitStaging = false;
  entryTicketPulled = false;
  parkCelebrationShown = false;
  hideParkCelebration();
  selectedDriveGroup = playerCarGroup;
  playerCarGroup.position.set(wpPatronStart.x, 0, wpPatronStart.z);
  playerCarGroup.rotation.y = wpPatronStart.ry;
  playerCar.winL.position.y = playerCar.winR.position.y = 0.04;
  closeKioskPopout();
  setManualCameraView(false);
}

function updateSim() {
  const s = engine.snapshot;
  if (s.flow !== "ENTRY_GATE_OPEN") entryTicketPulled = false;
  entryTicketMesh.visible = s.flow === "ENTRY_GATE_OPEN" && !entryTicketPulled;
  exitReceiptMesh.visible = s.flow === "EXIT_DONE" && s.lastPaymentMethod != null;

  if (s.flow === "ENTRY_GATE_OPEN" && !s.playerParkedInLot && patronInFreeStall()) {
    engine.markPlayerParkedInLot();
    engine.patronFinishedEntryDrive();
    if (!parkCelebrationShown) {
      parkCelebrationShown = true;
      showParkCelebration();
    }
    renderDisplay();
  }

  if (s.flow === "EXIT_DONE" && anyDriveablePastExitDriveOutLine()) {
    engine.acknowledgeExit();
    resetPatronUiAfterExitDone();
    renderDisplay();
  }
}

let lastSimFrameT = performance.now();
function tick(t) {
  const dt = Math.min(0.055, Math.max(0.001, (t - lastSimFrameT) / 1000));
  lastSimFrameT = t;
  gateAngleEntry += (gateTargetAngleEntry() - gateAngleEntry) * 0.09;
  gateAngleExit += (gateTargetAngleExit() - gateAngleExit) * 0.09;
  barPivot.rotation.x = gateAngleEntry;
  /** Exit bar mesh extends −Z from pivot vs entry +Z — negate so both booms lift the same way */
  exitBarPivot.rotation.x = -gateAngleExit;
  updateKeyboardDrive(dt);
  updateSim();
  syncPopoutsToDriveZones();
  if (manualCameraView) {
    controls.update();
  } else {
    applyChaseCamera();
  }
  stars.rotation.y = t * 0.000012;
  kioskEntryGroup.rotation.y = ENTR_YAW + Math.sin(t * 0.00022) * 0.012;
  kioskExitGroup.rotation.y = EXIT_YAW + Math.sin(t * 0.00019 + 0.4) * 0.012;
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
