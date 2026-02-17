import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const scene = new THREE.Scene();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.domElement.style.touchAction = "none";
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(6, 6, 8);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Prevent the browser context menu on right-click
renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());

let isRightDragging = false;
let cubeDragPointerId = null;
let prev = { x: 0, y: 0 };

function startCubeDrag(e) {
  if (isRightDragging) return;
  isRightDragging = true;
  cubeDragPointerId = e.pointerId;
  prev.x = e.clientX;
  prev.y = e.clientY;
  controls.enabled = false;

  try {
    renderer.domElement.setPointerCapture(e.pointerId);
  } catch { }
}

function stopCubeDrag(e) {
  if (!isRightDragging) return;
  if (e && e.pointerId !== undefined && cubeDragPointerId !== e.pointerId) return;

  isRightDragging = false;
  cubeDragPointerId = null;
  controls.enabled = !leftDragState;

  if (e && e.pointerId !== undefined) {
    try {
      renderer.domElement.releasePointerCapture(e.pointerId);
    } catch { }
  }
}

renderer.domElement.addEventListener("pointerdown", (e) => {
  // Right mouse button = 2
  if (e.button !== 2) return;
  startCubeDrag(e);
});

renderer.domElement.addEventListener("pointerup", (e) => {
  stopCubeDrag(e);
});

renderer.domElement.addEventListener("pointermove", (e) => {
  if (!isRightDragging) return;
  if (cubeDragPointerId !== e.pointerId) return;

  const dx = e.clientX - prev.x;
  const dy = e.clientY - prev.y;

  const speed = 0.005;
  rubiks.rotation.y += dx * speed;
  rubiks.rotation.x += dy * speed;

  prev.x = e.clientX;
  prev.y = e.clientY;
});


// Lights
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(10, 12, 8);
scene.add(dir);

// === Rubik's cube group ===
const rubiks = new THREE.Group();
scene.add(rubiks);

// Cubie sizing
const cubieSize = 0.95; // slightly smaller so gaps show
const gap = 0.08;
const step = cubieSize + gap;

// Materials (classic colors)
const COLORS = {
  black: 0x111111,
  white: 0xffffff,
  yellow: 0xffd500,
  red: 0xb71234,
  orange: 0xff5800,
  blue: 0x0051ba,
  green: 0x009e60,
};

const cubies = []; // keep references for raycasting + layer selection

// Helper: create one cubie with face colors depending on its position
function createCubie(x, y, z) {
  const geom = new THREE.BoxGeometry(cubieSize, cubieSize, cubieSize);

  // Order of BoxGeometry materials: +X, -X, +Y, -Y, +Z, -Z
  const mats = [
    new THREE.MeshStandardMaterial({ color: x === 1 ? COLORS.red : COLORS.black }),     // +X
    new THREE.MeshStandardMaterial({ color: x === -1 ? COLORS.orange : COLORS.black }), // -X
    new THREE.MeshStandardMaterial({ color: y === 1 ? COLORS.yellow : COLORS.black }), // +Y
    new THREE.MeshStandardMaterial({ color: y === -1 ? COLORS.white : COLORS.black }),   // -Y
    new THREE.MeshStandardMaterial({ color: z === 1 ? COLORS.blue : COLORS.black }),    // +Z
    new THREE.MeshStandardMaterial({ color: z === -1 ? COLORS.green : COLORS.black }),  // -Z
  ];

  // Give every material an emissive channel so we can "highlight" selection
  for (const m of mats) {
    m.emissive = new THREE.Color(0x000000);
    m.emissiveIntensity = 0.6;
  }

  const mesh = new THREE.Mesh(geom, mats);

  // store logical coords (for future rotations)
  mesh.userData.coord = new THREE.Vector3(x, y, z);

  // position in world
  mesh.position.set(x * step, y * step, z * step);

  return mesh;
}

// Build 3×3×3 cubies
for (let x = -1; x <= 1; x++) {
  for (let y = -1; y <= 1; y++) {
    for (let z = -1; z <= 1; z++) {
      const c = createCubie(x, y, z);
      cubies.push(c);
      rubiks.add(c);
    }
  }
}

// Nice centering
rubiks.position.set(0, 0, 0);

// ---------------------------------------------------------
// Selection (click a cubie)
// ---------------------------------------------------------
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let selectedCubie = null;
let pickedFace = null;
let leftDragState = null;

const DRAG_TURN_THRESHOLD_PX = 14;

function clearHighlight() {
  if (!selectedCubie) return;
  for (const mat of selectedCubie.material) {
    mat.emissive.setHex(0x000000);
  }
}

function setHighlight(cubie) {
  for (const mat of cubie.material) {
    // soft highlight
    mat.emissive.setHex(0x222222);
  }
}

function dominantAxisFromVector(v) {
  const absX = Math.abs(v.x);
  const absY = Math.abs(v.y);
  const absZ = Math.abs(v.z);

  if (absX >= absY && absX >= absZ) return "x";
  if (absY >= absX && absY >= absZ) return "y";
  return "z";
}

function pickedFaceToNotation(face) {
  if (!face) return null;
  const key = `${face.axis}:${face.sign}`;
  const faceMap = {
    "x:1": "R",
    "x:-1": "L",
    "y:1": "U",
    "y:-1": "D",
    "z:1": "F",
    "z:-1": "B",
  };
  return faceMap[key] ?? null;
}

function extractPickedFaceFromHit(hit) {
  const cubie = hit.object;
  if (!hit.face || !cubie) return null;

  // 1) Cubie local face normal.
  const normalLocal = hit.face.normal.clone().normalize();
  // 2) Cubie local -> world.
  const normalWorld = normalLocal.transformDirection(cubie.matrixWorld).normalize();
  // 3) World -> rubiks local.
  const cubeWorldQ = rubiks.getWorldQuaternion(new THREE.Quaternion());
  const normalCube = normalWorld.applyQuaternion(cubeWorldQ.invert()).normalize();

  const axis = dominantAxisFromVector(normalCube);
  const sign = normalCube[axis] >= 0 ? 1 : -1;
  const layer = roundToLayer(cubie.userData.coord[axis]);

  // Only allow true outer faces.
  if (Math.abs(layer) !== 1) return null;

  return { axis, sign, layer };
}

function axisVectorCube(axis) {
  if (axis === "x") return new THREE.Vector3(1, 0, 0);
  if (axis === "y") return new THREE.Vector3(0, 1, 0);
  return new THREE.Vector3(0, 0, 1);
}

function otherAxes(axis) {
  if (axis === "x") return ["y", "z"];
  if (axis === "y") return ["x", "z"];
  return ["x", "y"];
}

function worldToScreenDirection(originWorld, dirWorld) {
  const rect = renderer.domElement.getBoundingClientRect();
  const p0 = originWorld.clone().project(camera);
  const p1 = originWorld.clone().add(dirWorld).project(camera);

  const x0 = (p0.x * 0.5 + 0.5) * rect.width;
  const y0 = (-p0.y * 0.5 + 0.5) * rect.height;
  const x1 = (p1.x * 0.5 + 0.5) * rect.width;
  const y1 = (-p1.y * 0.5 + 0.5) * rect.height;

  return new THREE.Vector2(x1 - x0, y1 - y0);
}

function inferDragTurn(startHitWorld, dragVec2, picked) {
  const dragLen = dragVec2.length();
  if (!picked || dragLen < DRAG_TURN_THRESHOLD_PX) return null;

  const dragN = dragVec2.clone().normalize();
  const cubeWorldQ = rubiks.getWorldQuaternion(new THREE.Quaternion());
  const pointCube = rubiks.worldToLocal(startHitWorld.clone());
  const candidates = otherAxes(picked.axis);

  let best = null;

  for (const axis of candidates) {
    const axisDirCube = axisVectorCube(axis);
    const axisPointCube = axisDirCube.clone().multiplyScalar(roundToLayer(selectedCubie.userData.coord[axis]) * step);
    const rCube = pointCube.clone().sub(axisPointCube);

    // Tangential direction for +90 around this slice axis.
    const velocityCube = axisDirCube.clone().cross(rCube);
    if (velocityCube.lengthSq() < 1e-8) continue;

    const velocityWorld = velocityCube.normalize().applyQuaternion(cubeWorldQ);
    const velocityScreen = worldToScreenDirection(startHitWorld, velocityWorld);
    if (velocityScreen.lengthSq() < 1e-8) continue;

    const score = dragN.dot(velocityScreen.clone().normalize());
    const absScore = Math.abs(score);
    if (!best || absScore > best.absScore) {
      best = {
        axis,
        layer: roundToLayer(selectedCubie.userData.coord[axis]),
        dir: score >= 0 ? 1 : -1,
        absScore,
      };
    }
  }

  return best;
}

renderer.domElement.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" && e.button !== 0) return; // left click only for mouse
  
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(cubies, false);

  if (!hits.length) {
    // Touch fallback: drag empty space to rotate the whole cube.
    if (e.pointerType === "touch") {
      startCubeDrag(e);
    }
    return;
  }

  clearHighlight();
  const hit = hits[0];
  selectedCubie = hit.object;
  setHighlight(selectedCubie);
  pickedFace = extractPickedFaceFromHit(hit);
  if (!pickedFace && e.pointerType === "touch") {
    startCubeDrag(e);
    return;
  }
  leftDragState = {
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    hitPointWorld: hit.point.clone(),
    turned: false,
  };

  // Prevent OrbitControls from stealing drag gestures while picking/turning slices.
  controls.enabled = false;
  renderer.domElement.setPointerCapture(e.pointerId);
  updateSelectionLabel();
});

renderer.domElement.addEventListener("pointermove", (e) => {
  if (!leftDragState) return;
  if (leftDragState.pointerId !== e.pointerId) return;
  if (leftDragState.turned || !pickedFace || !selectedCubie || isTurning) return;

  const dragVec = new THREE.Vector2(
    e.clientX - leftDragState.startX,
    e.clientY - leftDragState.startY
  );

  const turn = inferDragTurn(leftDragState.hitPointWorld, dragVec, pickedFace);
  if (!turn) return;

  leftDragState.turned = true;
  enqueueMove(() => queueTurns(turn.axis, turn.layer, turn.dir));
});

renderer.domElement.addEventListener("pointerup", (e) => {
  if (!leftDragState) return;
  if (leftDragState.pointerId !== e.pointerId) return;

  try {
    renderer.domElement.releasePointerCapture(e.pointerId);
  } catch { }

  leftDragState = null;
  controls.enabled = !isRightDragging;
});

renderer.domElement.addEventListener("pointercancel", (e) => {
  if (leftDragState && leftDragState.pointerId === e.pointerId) {
    leftDragState = null;
  }
  stopCubeDrag(e);
  controls.enabled = !isRightDragging && !leftDragState;
});


// ---------------------------------------------------------
// Layer rotation engine (animated 90° turns)
// ---------------------------------------------------------
let isTurning = false;
let isCubeTurning = false;

function roundToLayer(n) {
  // keep coords at exactly -1, 0, 1
  return Math.round(n);
}

function getLayerCubies(axis, layerIndex) {
  return cubies.filter((c) => roundToLayer(c.userData.coord[axis]) === layerIndex);
}

function applyTurnToCoord(v, axis, dir) {
  // Rotate logical coord around axis by 90°
  // dir: +1 or -1
  const x = v.x, y = v.y, z = v.z;

  if (axis === "x") {
    // rotate around X: (y,z) plane
    // +90: y -> -z, z -> y
    // -90: y -> z,  z -> -y
    return new THREE.Vector3(
      x,
      dir === 1 ? -z : z,
      dir === 1 ? y : -y
    );
  }

  if (axis === "y") {
    // rotate around Y: (x,z) plane
    // +90: x -> z,  z -> -x
    // -90: x -> -z, z -> x
    return new THREE.Vector3(
      dir === 1 ? z : -z,
      y,
      dir === 1 ? -x : x
    );
  }

  // axis === "z"
  // rotate around Z: (x,y) plane
  // +90: x -> -y, y -> x
  // -90: x -> y,  y -> -x
  return new THREE.Vector3(
    dir === 1 ? -y : y,
    dir === 1 ? x : -x,
    z
  );
}

function rotateSlice(axis, layerIndex, dir, durationMs = 180) {
  if (isTurning) return;
  isTurning = true;

  const sliceCubies = getLayerCubies(axis, layerIndex);

  // Temporary group to rotate them together
  const pivot = new THREE.Group();
  rubiks.add(pivot);

  // Re-parent slice cubies into pivot while keeping world transforms
  for (const c of sliceCubies) {
    pivot.attach(c);
  }

  const start = performance.now();
  const from = 0;
  const to = dir * (Math.PI / 2);

  function tick(now) {
    const t = Math.min(1, (now - start) / durationMs);
    const eased = t * (2 - t); // easeOutQuad

    // set pivot rotation per frame (reset then apply)
    pivot.rotation.set(0, 0, 0);
    if (axis === "x") pivot.rotation.x = from + (to - from) * eased;
    if (axis === "y") pivot.rotation.y = from + (to - from) * eased;
    if (axis === "z") pivot.rotation.z = from + (to - from) * eased;

    if (t < 1) {
      requestAnimationFrame(tick);
      return;
    }

    // Snap pivot to exact final angle to avoid float drift
    pivot.rotation.set(0, 0, 0);
    if (axis === "x") pivot.rotation.x = to;
    if (axis === "y") pivot.rotation.y = to;
    if (axis === "z") pivot.rotation.z = to;

    // Bake transforms back into each cubie by reattaching to rubiks
    for (const c of sliceCubies) {
      rubiks.attach(c);

      // Update logical coordinates
      const next = applyTurnToCoord(c.userData.coord, axis, dir);
      c.userData.coord.set(roundToLayer(next.x), roundToLayer(next.y), roundToLayer(next.z));

      // Snap positions exactly onto grid
      c.position.set(
        c.userData.coord.x * step,
        c.userData.coord.y * step,
        c.userData.coord.z * step
      );

      // Reset any tiny rotation error from numerical drift
      c.rotation.x = Math.round(c.rotation.x / (Math.PI / 2)) * (Math.PI / 2);
      c.rotation.y = Math.round(c.rotation.y / (Math.PI / 2)) * (Math.PI / 2);
      c.rotation.z = Math.round(c.rotation.z / (Math.PI / 2)) * (Math.PI / 2);
    }

    rubiks.remove(pivot);
    isTurning = false;
  }

  requestAnimationFrame(tick);
}

function rotateWholeCube(axis, dir, quarterTurns = 1, durationMs = 200) {
  if (isCubeTurning || isRightDragging) return Promise.resolve(false);
  isCubeTurning = true;

  const fromX = rubiks.rotation.x;
  const fromY = rubiks.rotation.y;
  const fromZ = rubiks.rotation.z;
  const turnAngle = quarterTurns * (Math.PI / 2);
  const to = dir * turnAngle;

  const toX = axis === "x" ? fromX + to : fromX;
  const toY = axis === "y" ? fromY + to : fromY;
  const toZ = axis === "z" ? fromZ + to : fromZ;

  const start = performance.now();

  return new Promise((resolve) => {
    function tick(now) {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = t * (2 - t); // easeOutQuad

      rubiks.rotation.x = fromX + (toX - fromX) * eased;
      rubiks.rotation.y = fromY + (toY - fromY) * eased;
      rubiks.rotation.z = fromZ + (toZ - fromZ) * eased;

      if (t < 1) {
        requestAnimationFrame(tick);
        return;
      }

      // snap to exact quarter turns to avoid drift
      rubiks.rotation.x = Math.round(toX / (Math.PI / 2)) * (Math.PI / 2);
      rubiks.rotation.y = Math.round(toY / (Math.PI / 2)) * (Math.PI / 2);
      rubiks.rotation.z = Math.round(toZ / (Math.PI / 2)) * (Math.PI / 2);

      isCubeTurning = false;
      resolve(true);
    }

    requestAnimationFrame(tick);
  });
}

function waitForTurnDone() {
  return new Promise((resolve) => {
    function check() {
      if (!isTurning) {
        resolve();
        return;
      }
      requestAnimationFrame(check);
    }
    check();
  });
}

async function queueTurns(axis, layerIndex, dir, turns = 1) {
  for (let i = 0; i < turns; i++) {
    rotateSlice(axis, layerIndex, dir);
    await waitForTurnDone();
  }
  updateSelectionLabel();
}

let moveQueue = Promise.resolve();

function enqueueMove(task) {
  moveQueue = moveQueue.then(task).catch((err) => {
    console.error("Move queue error:", err);
  });
}

function enqueueCubeNav(axis, dir, quarterTurns = 1) {
  enqueueMove(() => rotateWholeCube(axis, dir, quarterTurns));
}

// Standard notation mapping in this cube-local coordinate system.
// "Clockwise" means when looking directly at the face from outside.
const MOVE_SPECS = {
  R: { axis: "x", layer: 1, dir: -1 },
  "R'": { axis: "x", layer: 1, dir: 1 },
  L: { axis: "x", layer: -1, dir: 1 },
  "L'": { axis: "x", layer: -1, dir: -1 },
  U: { axis: "y", layer: 1, dir: 1 },
  "U'": { axis: "y", layer: 1, dir: -1 },
  D: { axis: "y", layer: -1, dir: -1 },
  "D'": { axis: "y", layer: -1, dir: 1 },
  F: { axis: "z", layer: 1, dir: -1 },
  "F'": { axis: "z", layer: 1, dir: 1 },
  B: { axis: "z", layer: -1, dir: 1 },
  "B'": { axis: "z", layer: -1, dir: -1 },
};

function normalizeMove(move) {
  return move.trim().replace("’", "'");
}

function doMove(move) {
  const spec = MOVE_SPECS[normalizeMove(move)];
  if (!spec) return false;

  enqueueMove(() => queueTurns(spec.axis, spec.layer, spec.dir));
  return true;
}

function rotatePickedFace(isPrime = false) {
  if (!pickedFace) return false;
  const base = pickedFaceToNotation(pickedFace);
  if (!base) return false;
  return doMove(isPrime ? `${base}'` : base);
}

// ---------------------------------------------------------
// Keyboard controls
// ---------------------------------------------------------
window.addEventListener("keydown", (e) => {
  if (["ArrowLeft", "ArrowRight", "w", "a", "s", "d", "W", "A", "S", "D"].includes(e.key)) {
    e.preventDefault();
  }

  if (e.key === "r" || e.key === "R") doMove(e.shiftKey ? "R'" : "R");
  if (e.key === "l" || e.key === "L") doMove(e.shiftKey ? "L'" : "L");
  if (e.key === "ArrowRight") rotatePickedFace(false);
  if (e.key === "ArrowLeft") rotatePickedFace(true);

  // Whole-cube navigation
  if (e.key === "a" || e.key === "A") enqueueCubeNav("y", -1); // spin left
  if (e.key === "d" || e.key === "D") enqueueCubeNav("y", +1); // spin right
  if (e.key === "w" || e.key === "W") enqueueCubeNav("x", -1); // flip over
  if (e.key === "s" || e.key === "S") enqueueCubeNav("x", +1); // flip back
});


// ---------------------------------------------------------
// UI controls
// ---------------------------------------------------------
const controlsPanel = document.createElement("div");
Object.assign(controlsPanel.style, {
  position: "fixed",
  top: "12px",
  right: "12px",
  padding: "10px",
  borderRadius: "10px",
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(20,26,34,0.9)",
  color: "white",
  fontFamily: "system-ui, sans-serif",
  minWidth: "230px",
  zIndex: "10",
});
document.body.appendChild(controlsPanel);

const uiButtons = [];

function makeBtn(text, onClick) {
  const btn = document.createElement("button");
  btn.textContent = text;
  Object.assign(btn.style, {
    display: "block",
    width: "100%",
    marginTop: "6px",
    padding: "8px 10px",
    borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(255,255,255,0.08)",
    color: "white",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "system-ui, sans-serif",
  });
  btn.addEventListener("click", onClick);
  controlsPanel.appendChild(btn);
  uiButtons.push(btn);
  return btn;
}

function makeHeader(text) {
  const header = document.createElement("div");
  header.textContent = text;
  Object.assign(header.style, {
    marginTop: "10px",
    paddingTop: "8px",
    borderTop: "1px solid rgba(255,255,255,0.15)",
    fontSize: "12px",
    fontWeight: "700",
    letterSpacing: "0.4px",
    textTransform: "uppercase",
    opacity: "0.9",
  });
  controlsPanel.appendChild(header);
  return header;
}

const selectionLabel = document.createElement("div");
selectionLabel.style.fontSize = "12px";
selectionLabel.style.opacity = "0.9";
selectionLabel.style.marginBottom = "6px";
controlsPanel.appendChild(selectionLabel);

const dragHint = document.createElement("div");
dragHint.textContent = "Touch/drag a face to turn slices; drag empty space to rotate the whole cube.";
Object.assign(dragHint.style, {
  fontSize: "12px",
  opacity: "0.75",
  marginBottom: "6px",
});
controlsPanel.appendChild(dragHint);

function updateSelectionLabel() {
  if (!selectedCubie) {
    selectionLabel.textContent = "Select a cubie first";
    return;
  }
  const c = selectedCubie.userData.coord;
  const faceName = pickedFaceToNotation(pickedFace);
  if (!pickedFace || !faceName) {
    selectionLabel.textContent = `Selected cubie: (${c.x}, ${c.y}, ${c.z})`;
    return;
  }
  selectionLabel.textContent = `Selected cubie: (${c.x}, ${c.y}, ${c.z}) | Face: ${faceName}`;
}

// makeHeader("Upper Layer (U)");
// makeBtn("U", () => doMove("U"));
// makeBtn("U'", () => doMove("U'"));

// makeHeader("Right Hand (R)");
// makeBtn("R", () => doMove("R"));
// makeBtn("R'", () => doMove("R'"));

// makeHeader("Left Hand (L)");
// makeBtn("L", () => doMove("L"));
// makeBtn("L'", () => doMove("L'"));

// makeHeader("Picked Face");
// makeBtn("Rotate Picked Face (Arrow Right)", () => rotatePickedFace(false));
// makeBtn("Rotate Picked Face Prime (Arrow Left)", () => rotatePickedFace(true));

// makeHeader("Cube Navigation");
makeBtn("Spin Left (A)", () => enqueueCubeNav("y", -1));
makeBtn("Spin Right (D)", () => enqueueCubeNav("y", +1));
makeBtn("Flip Over (W)", () => enqueueCubeNav("x", -1));
makeBtn("Flip Back (S)", () => enqueueCubeNav("x", +1));

const scrambleBtn = document.createElement("button");
scrambleBtn.textContent = "Scramble";
Object.assign(scrambleBtn.style, {
  position: "fixed",
  top: "12px",
  left: "12px",
  padding: "10px 14px",
  borderRadius: "10px",
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(20,26,34,0.85)",
  color: "white",
  cursor: "pointer",
  fontFamily: "system-ui, sans-serif",
});
document.body.appendChild(scrambleBtn);
updateSelectionLabel();

function applyResponsiveUi() {
  const isMobile = window.innerWidth <= 768;

  if (isMobile) {
    Object.assign(controlsPanel.style, {
      top: "auto",
      right: "8px",
      left: "8px",
      bottom: "calc(10px + env(safe-area-inset-bottom, 0px))",
      minWidth: "0",
      width: "auto",
      maxHeight: "44vh",
      overflowY: "auto",
      padding: "10px",
      borderRadius: "12px",
    });

    Object.assign(scrambleBtn.style, {
      top: "calc(10px + env(safe-area-inset-top, 0px))",
      left: "8px",
      right: "auto",
      padding: "10px 12px",
      fontSize: "14px",
    });

    selectionLabel.style.fontSize = "13px";
    dragHint.style.fontSize = "12px";
  } else {
    Object.assign(controlsPanel.style, {
      top: "12px",
      right: "12px",
      left: "auto",
      bottom: "auto",
      minWidth: "230px",
      width: "auto",
      maxHeight: "calc(100vh - 24px)",
      overflowY: "auto",
      padding: "10px",
      borderRadius: "10px",
    });

    Object.assign(scrambleBtn.style, {
      top: "12px",
      left: "12px",
      right: "auto",
      padding: "10px 14px",
      fontSize: "14px",
    });

    selectionLabel.style.fontSize = "12px";
    dragHint.style.fontSize = "12px";
  }

  for (const btn of uiButtons) {
    Object.assign(btn.style, {
      minHeight: isMobile ? "44px" : "36px",
      fontSize: isMobile ? "15px" : "14px",
      padding: isMobile ? "10px 12px" : "8px 10px",
    });
  }
}

applyResponsiveUi();

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function scramble(moves = 20) {
  if (isTurning) return;

  const axes = ["x", "y", "z"];
  for (let i = 0; i < moves; i++) {
    const axis = axes[randInt(0, 2)];
    const layer = randInt(-1, 1);
    const dir = Math.random() < 0.5 ? -1 : 1;

    rotateSlice(axis, layer, dir, 90);
    // wait for the move to finish
    while (isTurning) {
      await sleep(10);
    }
  }
}

scrambleBtn.addEventListener("click", () => scramble(25));

// Animate
function animate() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

// Resize handler
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  applyResponsiveUi();
});
