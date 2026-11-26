import { outlineProblem } from "./outline.js?v=306";
import { chargerRect } from "./stallMarks.js?v=306";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CLEAR_HEIGHT, CURB_H, CURB_W, FLOOR_H, LINE_W, RAMP_INSET, WALL_T, rampFootprint, rampShape, minStraightRampLength, rampTransitions } from "./layout.js?v=306";
// 층고는 입력값(state.plate.floorHeight)을 쓴다
// 층별 층고: 지금 그리는 층의 층고(curH). 층마다 다르면 rebuild가 층마다 바꿔 넣는다.
let curH = null;
const floorH = () => curH || (state.plate && state.plate.floorHeight) || FLOOR_H;
// 램프 높은 끝(도로 쪽)에서 평평하게 두는 비율 — 층고가 낮은 층은 도착 끝을 맞추고 위쪽을 평평하게
let rampFlatFrac = 0;
import { state, subscribe, summary, floorHeightList } from "./state.js?v=306";

const DRAW_CAP = 12;
let renderer;
let camera;
let controls;
let scene;
let building;
let host;
let signature = "";
let frame = 0;

export function mountScene(container) {
  scene = new THREE.Scene();
  scene.background = new THREE.Color("#ddd6cb");
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 800);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.55;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };

  const hemi = new THREE.HemisphereLight("#fff7ee", "#c8b8a4", 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight("#fff5ea", 1.15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun, sun.target);

  building = new THREE.Group();
  scene.add(building);

  const resize = () => {
    const rect = container.getBoundingClientRect();
    camera.aspect = rect.width / Math.max(rect.height, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(rect.width, rect.height, false);
  };
  new ResizeObserver(resize).observe(container);
  resize();

  subscribe(() => {
    if (state.step !== 3) return;
    requestAnimationFrame(() => {
      resize();
      rebuild(sun);
    });
  });

  const loop = () => {
    frame = requestAnimationFrame(loop);
    if (!container.hidden && state.step === 3) {
      controls.update();
      renderer.render(scene, camera);
    }
  };
  loop();

  document.getElementById("reset-camera").addEventListener("click", () => {
    signature = "";
    if (state.step === 3) rebuild(sun);
  });
}

const paint = makePaint();

function rebuild(sun) {
  if (!state.plate) return;
  const info = summary();
  const floors = Math.max(1, info.floors);
  const drawn = Math.min(floors, DRAW_CAP);
  const single = state.floorView !== "all";
  const next = JSON.stringify({
    plate: state.plate,
    cores: state.cores,
    openings: state.openings,
    ramps: state.ramps,
    route: state.route,
    columns: state.columns.length,
    stalls: state.stalls.length,
    floors,
    floorView: state.floorView,
  });
  const keepCamera = signature === next;
  signature = next;
  host = building;
  clearGroup(building);

  const plate = state.plate;
  // 평면 좌표(x 동쪽, y 북쪽)를 3D(x, z)로 옮길 때 z = y로 두면 위에서 본 모습이 평면과 좌우(남북) 뒤집힌 거울상이 된다.
  // 건물 전체를 z 방향으로 뒤집어(z = 깊이 - y) 평면과 같은 방향으로 맞춘다. (three.js는 음수 배율의 면 방향을 자동 처리)
  building.scale.set(1, 1, -1);
  building.position.set(0, 0, plate.depth);
  const concrete = standard("#d5d0c8", 0.86, paint.concrete);
  const columnMat = standard("#8d887f", 0.78, paint.concrete);
  const hazard = standard("#111", 0.6, paint.hazard);
  const coreMat = standard("#cfc8be", 0.82, paint.concrete);
  const rampMat = standard("#8d8680", 0.7, paint.groove);
  rampMat.side = THREE.DoubleSide;
  const aisleMat = standard("#2f6b45", 0.42, paint.epoxy);
  const stallMat = standard("#b7b4ae", 0.8);
  const lineMat = standard("#f4f1ea", 0.4);
  const inMat = standard("#1f6b62", 0.45);
  const outMat = standard("#b5522a", 0.45);

  const levels = single ? [Math.max(0, Math.min(drawn - 1, state.floorView))] : [...Array(drawn).keys()];
  const heights = floorHeightList(drawn, plate);
  const perFloor = !!(plate.floorHeights && plate.floorHeights.length);
  const bases = heights.map((_, k) => -heights.slice(1, k + 1).reduce((a, b) => a + b, 0));
  const total = heights.slice(1).reduce((a, b) => a + b, 0);
  levels.forEach((level) => {
    const base = single ? 0 : bases[level];
    curH = heights[level];
    // 이 층 램프에 필요한 길이 vs 실제(가장 높은 층고 기준) 길이 → 남는 만큼 위쪽 평탄
    const need = minStraightRampLength(curH, rampTransitions(plate));
    rampFlatFrac = perFloor ? Math.max(0, 1 - need / Math.max(need, (state.ramps[0] && state.ramps[0].length) || need)) : 0;
    const floor = new THREE.Group();
    building.add(floor);
    host = floor;
    addSlab(plate, base, concrete);
    addAisles(base, aisleMat);
    addStallPads(base, stallMat);
    host.add(stallLines(base, lineMat));
    addArrows(base);
    state.columns.forEach((column, index) => addColumn(column, index, base, columnMat, hazard));
    addClearance(base);
    state.cores.forEach((core) => addCore(core, coreMat, base));
    state.ramps.forEach((ramp) => addRamp(ramp, rampMat, base, hazard));
    if (level === 0) state.ramps.forEach((ramp) => addGroundApproach(ramp, base, rampMat));
    addWalls(concrete, base);
    addGates(base);
    visibleOpenings().forEach((opening) => {
      addThreshold(opening, opening.kind === "in" ? inMat : outMat, base);
    });
    addLabel(`B${level + 1}`, plate.width / 2, base + 1.2, -2.2, 6.4);
  });

  host = building;
  curH = heights[0];
  rampFlatFrac = 0;
  if (!single) {
    addGrade(plate);
    addLabel("지상", plate.width / 2, floorH() + 1.2, -3);
  }
  if (floors > drawn) addLabel(`외 ${floors - drawn}개 층`, plate.width + 8, -(total + heights[0]) / 2, plate.depth / 2);
  curH = null;

  const stack = single ? 1 : drawn;
  const rampReach = state.ramps.reduce((reach, ramp) => {
    const box = rampFootprint(ramp, plate);
    return Math.max(reach, Math.max(0, -box.x), Math.max(0, -box.y), Math.max(0, box.x + box.w - plate.width), Math.max(0, box.y + box.d - plate.depth));
  }, 0);
  const span = Math.max(plate.width + rampReach, plate.depth + rampReach, stack * floorH());
  sun.position.set(-plate.width * 0.2, span, plate.depth * 0.2);
  sun.target.position.set(plate.width / 2, single ? 1 : -drawn * floorH() / 2, plate.depth / 2);
  sun.shadow.camera.left = -span;
  sun.shadow.camera.right = span * 1.4;
  sun.shadow.camera.top = span;
  sun.shadow.camera.bottom = -span;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = span * 4;
  sun.shadow.camera.updateProjectionMatrix();

  if (!keepCamera) {
    const center = new THREE.Vector3(plate.width / 2, single ? 1.2 : -((drawn - 1) * floorH()) / 2, plate.depth / 2);
    camera.position.set(center.x + plate.width * 0.9, center.y + span * 0.42, center.z + plate.depth * 1.05);
    controls.target.copy(center);
    controls.update();
  }
}

function standard(color, roughness, map) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02, map: map || null });
}

function addSlab(plate, base, material) {
  const shape = new THREE.Shape();
  const outline = plate.outline && !outlineProblem(plate.outline) ? plate.outline : [[0, 0], [plate.width, 0], [plate.width, plate.depth], [0, plate.depth]];
  outline.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.lineTo(outline[0][0], outline[0][1]);
  curvedRampHoles(plate).forEach((poly) => {
    const path = new THREE.Path();
    poly.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)));
    path.lineTo(poly[0].x, poly[0].y);
    shape.holes.push(path);
  });
  rampHoles(plate).forEach((hole) => {
    const path = new THREE.Path();
    path.moveTo(hole.x, hole.y);
    path.lineTo(hole.x, hole.y + hole.d);
    path.lineTo(hole.x + hole.w, hole.y + hole.d);
    path.lineTo(hole.x + hole.w, hole.y);
    path.lineTo(hole.x, hole.y);
    shape.holes.push(path);
  });
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.28, bevelEnabled: false });
  geometry.rotateX(Math.PI / 2);
  const slab = new THREE.Mesh(geometry, material);
  slab.position.set(0, base, 0);
  slab.receiveShadow = true;
  host.add(slab);
}

// 곡선 램프 자리의 슬래브 구멍. 조각끼리 변이 맞닿지 않게 살짝 줄인다.
function curvedRampHoles(plate) {
  const polys = [];
  state.ramps.forEach((ramp) => {
    const shape = rampShape(ramp, plate);
    if (shape.kind !== "curved") return;
    shape.polygons.forEach((poly) => {
      const cx = poly.reduce((sum, p) => sum + p.x, 0) / poly.length;
      const cy = poly.reduce((sum, p) => sum + p.y, 0) / poly.length;
      const inner = poly.map((p) => {
        const dx = p.x - cx;
        const dy = p.y - cy;
        const len = Math.hypot(dx, dy) || 1;
        return { x: p.x - (dx / len) * 0.05, y: p.y - (dy / len) * 0.05 };
      });
      if (inner.every((p) => p.x > 0.2 && p.y > 0.2 && p.x < plate.width - 0.2 && p.y < plate.depth - 0.2)) polys.push(inner);
    });
  });
  return polys;
}

function rampHoles(plate) {
  const holes = [];
  state.ramps.forEach((ramp) => {
    if (rampShape(ramp, plate).kind === "curved") return;
    const box = rampFootprint(ramp, plate);
    const x = Math.max(0.6, box.x);
    const y = Math.max(0.6, box.y);
    const x2 = Math.min(plate.width - 0.6, box.x + box.w);
    const y2 = Math.min(plate.depth - 0.6, box.y + box.d);
    if (x2 - x > 1.2 && y2 - y > 1.2) {
      holes.push({ x, y, w: x2 - x, d: y2 - y });
      return;
    }
    const mouth = 2.4;
    const half = ramp.width / 2;
    if (ramp.edge === "w") holes.push({ x: 0.6, y: ramp.t - half, w: mouth, d: ramp.width });
    if (ramp.edge === "e") holes.push({ x: plate.width - 0.6 - mouth, y: ramp.t - half, w: mouth, d: ramp.width });
    if (ramp.edge === "s") holes.push({ x: ramp.t - half, y: 0.6, w: ramp.width, d: mouth });
    if (ramp.edge === "n") holes.push({ x: ramp.t - half, y: plate.depth - 0.6 - mouth, w: ramp.width, d: mouth });
  });
  return holes.filter((hole) => hole.w > 0.8 && hole.d > 0.8 && hole.x > 0.2 && hole.y > 0.2);
}

function addAisles(base, material) {
  state.aisles.forEach((aisle) => {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(Math.max(aisle.w, 0.05), 0.02, Math.max(aisle.d, 0.05)), material);
    pad.position.set(aisle.x + aisle.w / 2, base + 0.02, aisle.y + aisle.d / 2);
    pad.receiveShadow = true;
    host.add(pad);
  });
}

function stallLines(base, material) {
  const group = new THREE.Group();
  const across = new THREE.BoxGeometry(1, 0.012, LINE_W);
  const along = new THREE.BoxGeometry(LINE_W, 0.012, 1);
  state.stalls.forEach((stall) => {
    const y = base + 0.045;
    strip(group, across, material, stall.x + stall.w / 2, y, stall.y, stall.w, 1);
    strip(group, across, material, stall.x + stall.w / 2, y, stall.y + stall.d, stall.w, 1);
    strip(group, along, material, stall.x, y, stall.y + stall.d / 2, 1, stall.d);
    strip(group, along, material, stall.x + stall.w, y, stall.y + stall.d / 2, 1, stall.d);
  });
  return group;
}

function strip(group, geometry, material, x, y, z, sx, sz) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, 1, sz);
  group.add(mesh);
}

function addCore(core, material, base) {
  const t = WALL_T;
  const h = floorH() - 0.05;
  const face = core.doorFace || "s";
  const gap = Math.min(1.1, (face === "n" || face === "s" ? core.w : core.d) * 0.34);
  const frame = standard("#2b2a28", 0.5);
  const doorMat = standard("#3d4a43", 0.55);
  // 네 면 벽. 출입문 면은 가운데를 문 폭만큼 비우고 문틀·문짝을 단다.
  const wall = (f) => {
    const horizontal = f === "n" || f === "s";
    const len = horizontal ? core.w : core.d;
    const fixed = f === "n" ? core.y + core.d - t / 2 : f === "s" ? core.y + t / 2 : f === "e" ? core.x + core.w - t / 2 : core.x + t / 2;
    const start = horizontal ? core.x : core.y;
    const put = (a, l, thick, mat, height, inset = 0) => {
      const inward = f === "n" || f === "e" ? -inset : inset;
      if (horizontal) wallBox(start + a + l / 2, base, fixed + inward, l, thick, mat, height);
      else wallBox(fixed + inward, base, start + a + l / 2, thick, l, mat, height);
    };
    if (f !== face) { put(0, len, t, material, h); return; }
    const side = (len - gap) / 2;
    if (side > 0.2) { put(0, side, t, material, h); put(len - side, side, t, material, h); }
    put(side - 0.08, gap + 0.16, 0.08, frame, 2.15, 0.04);
    put(side, gap * 0.46, 0.04, doorMat, 2.05, 0.08);
    put(side + gap * 0.54, gap * 0.42, 0.04, doorMat, 2.05, 0.12);
  };
  ["n", "s", "e", "w"].forEach(wall);
  wallBox(core.x + core.w * 0.34, base, core.y + core.d / 2, t, core.d - t * 2, material, h);
  wallBox(core.x + core.w * 0.67, base, core.y + core.d / 2, t, core.d - t * 2, material, h);
  const cabin = standard("#1c1c1c", 0.4);
  wallBox(core.x + core.w * 0.17, base, core.y + core.d * 0.55, 0.9, 0.08, cabin, 2.1);
  wallBox(core.x + core.w * 0.5, base, core.y + core.d * 0.55, 0.9, 0.08, cabin, 2.1);
  addLabel("비상구", core.x + core.w / 2, base + h + 0.15, core.y + core.d / 2, 2.4);
}

function addRamp(ramp, material, base, hazard) {
  const shape = rampShape(ramp, state.plate);
  if (shape.kind === "curved") {
    addCurvedRamp(ramp, shape, material, base, hazard);
    return;
  }
  const footprint = rampFootprint(ramp, state.plate);
  const low = base + 0.12;
  const high = base + floorH();
  if (rampFlatFrac > 0.001) {
    // 층고가 낮은 층: 높은 끝(도로 쪽)부터 평탄 → 경사, 아래층 도착 끝은 모든 층이 같은 자리
    const f = rampFlatFrac;
    const P = (u, v, h) => {
      if (ramp.edge === "s") return [footprint.x + v * footprint.w, h, footprint.y + u * footprint.d];
      if (ramp.edge === "n") return [footprint.x + v * footprint.w, h, footprint.y + footprint.d - u * footprint.d];
      if (ramp.edge === "w") return [footprint.x + u * footprint.w, h, footprint.y + v * footprint.d];
      return [footprint.x + footprint.w - u * footprint.w, h, footprint.y + v * footprint.d];
    };
    const quads = [[0, f, high, high], [f, 1, high, low]];
    const arr = [];
    quads.forEach(([u0, u1, h0, h1]) => {
      const a = P(u0, 0, h0); const b = P(u0, 1, h0); const c = P(u1, 1, h1); const d = P(u1, 0, h1);
      arr.push(...a, ...b, ...c, ...a, ...c, ...d);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(arr), 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    host.add(mesh);
    addRampEdges(ramp, footprint, base, hazard);
    return;
  }
  let corners;
  if (ramp.edge === "s") {
    corners = [
      [footprint.x, high, footprint.y],
      [footprint.x + footprint.w, high, footprint.y],
      [footprint.x + footprint.w, low, footprint.y + footprint.d],
      [footprint.x, low, footprint.y + footprint.d],
    ];
  } else if (ramp.edge === "n") {
    corners = [
      [footprint.x, low, footprint.y],
      [footprint.x + footprint.w, low, footprint.y],
      [footprint.x + footprint.w, high, footprint.y + footprint.d],
      [footprint.x, high, footprint.y + footprint.d],
    ];
  } else if (ramp.edge === "w") {
    corners = [
      [footprint.x, high, footprint.y],
      [footprint.x, high, footprint.y + footprint.d],
      [footprint.x + footprint.w, low, footprint.y + footprint.d],
      [footprint.x + footprint.w, low, footprint.y],
    ];
  } else {
    corners = [
      [footprint.x, low, footprint.y],
      [footprint.x, low, footprint.y + footprint.d],
      [footprint.x + footprint.w, high, footprint.y + footprint.d],
      [footprint.x + footprint.w, high, footprint.y],
    ];
  }
  const positions = new Float32Array([
    ...corners[0], ...corners[1], ...corners[2],
    ...corners[0], ...corners[2], ...corners[3],
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  host.add(mesh);
  addRampEdges(ramp, footprint, base, hazard);
}

function addWalls(material, base) {
  const plate = state.plate;
  const cuts = { s: [], n: [], w: [], e: [] };
  state.openings.concat(state.ramps).forEach((item) => {
    cuts[item.edge].push({ start: item.t - item.width / 2, end: item.t + item.width / 2 });
  });
  if (plate.outline && !outlineProblem(plate.outline)) {
    // 외곽 다각형: 변마다 벽. 감싸는 직사각형 변 위에 놓인 변은 출입구·램프 자리를 비운다.
    const pts = plate.outline;
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 0.05) return;
      const onEdge = Math.abs(p[1]) < 0.01 && Math.abs(q[1]) < 0.01 ? "s" : Math.abs(p[1] - plate.depth) < 0.01 && Math.abs(q[1] - plate.depth) < 0.01 ? "n"
        : Math.abs(p[0]) < 0.01 && Math.abs(q[0]) < 0.01 ? "w" : Math.abs(p[0] - plate.width) < 0.01 && Math.abs(q[0] - plate.width) < 0.01 ? "e" : null;
      if (onEdge) {
        const horizontal = onEdge === "s" || onEdge === "n";
        const a0 = horizontal ? Math.min(p[0], q[0]) : Math.min(p[1], q[1]);
        const a1 = horizontal ? Math.max(p[0], q[0]) : Math.max(p[1], q[1]);
        segments(a1 - a0, cuts[onEdge].map((c) => ({ start: c.start - a0, end: c.end - a0 }))).forEach(([a, b]) => {
          const m = a0 + (a + b) / 2;
          if (onEdge === "s") wallBox(m, base, 0.12, b - a, 0.24, material, 1.15);
          if (onEdge === "n") wallBox(m, base, plate.depth - 0.12, b - a, 0.24, material, 1.15);
          if (onEdge === "w") wallBox(0.12, base, m, 0.24, b - a, material, 1.15);
          if (onEdge === "e") wallBox(plate.width - 0.12, base, m, 0.24, b - a, material, 1.15);
        });
        return;
      }
      const wall = new THREE.Mesh(new THREE.BoxGeometry(len, 1.15, 0.24), material);
      wall.position.set((p[0] + q[0]) / 2, base + 0.575, (p[1] + q[1]) / 2);
      wall.rotation.y = -Math.atan2(q[1] - p[1], q[0] - p[0]);
      wall.castShadow = true;
      host.add(wall);
    });
    return;
  }
  segments(plate.width, cuts.s).forEach(([a, b]) => wallBox((a + b) / 2, base, 0.12, b - a, 0.24, material, 1.15));
  segments(plate.width, cuts.n).forEach(([a, b]) => wallBox((a + b) / 2, base, plate.depth - 0.12, b - a, 0.24, material, 1.15));
  segments(plate.depth, cuts.w).forEach(([a, b]) => wallBox(0.12, base, (a + b) / 2, 0.24, b - a, material, 1.15));
  segments(plate.depth, cuts.e).forEach(([a, b]) => wallBox(plate.width - 0.12, base, (a + b) / 2, 0.24, b - a, material, 1.15));
}

function addThreshold(opening, material, base) {
  const plate = state.plate;
  const width = opening.width;
  const depth = 0.7;
  if (opening.edge === "s") boxAt(opening.t, base + 0.05, depth / 2, width, depth, material);
  if (opening.edge === "n") boxAt(opening.t, base + 0.05, plate.depth - depth / 2, width, depth, material);
  if (opening.edge === "w") boxAt(depth / 2, base + 0.05, opening.t, depth, width, material);
  if (opening.edge === "e") boxAt(plate.width - depth / 2, base + 0.05, opening.t, depth, width, material);
}

function addGrade(plate) {
  const y = floorH();
  const points = [
    new THREE.Vector3(0, y, 0),
    new THREE.Vector3(plate.width, y, 0),
    new THREE.Vector3(plate.width, y, plate.depth),
    new THREE.Vector3(0, y, plate.depth),
    new THREE.Vector3(0, y, 0),
  ];
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  host.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: "#8d4030" })));
}

function addLabel(text, x, y, z, width = 12) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = text === "비상구" ? "#16824a" : "#1e1a16";
  context.font = "600 54px Segoe UI, Malgun Gothic, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 256, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.position.set(x, y, z);
  sprite.scale.set(width, width / 4, 1);
  host.add(sprite);
}

function boxAt(x, y, z, w, d, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), material);
  mesh.position.set(x, y, z);
  host.add(mesh);
}

function wallBox(x, base, z, w, d, material, height) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, height, d), material);
  mesh.position.set(x, base + height / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  host.add(mesh);
}

function segments(length, cuts) {
  let spans = [[0, length]];
  cuts.forEach((cut) => {
    const next = [];
    spans.forEach(([start, end]) => {
      if (cut.end <= start || cut.start >= end) {
        next.push([start, end]);
        return;
      }
      if (cut.start > start) next.push([start, cut.start]);
      if (cut.end < end) next.push([cut.end, end]);
    });
    spans = next.filter(([start, end]) => end - start > 0.2);
  });
  return spans;
}

let disabledMat = null;
let extendedMat = null;
let ecoMat = null;
let parallelMat = null;
function stallMaterial(stall, fallback) {
  // 장애인전용은 파란 바닥, 확장형은 연한 초록 바닥(평면도 색과 맞춤)
  if (stall.type === "disabled") {
    if (!disabledMat) disabledMat = standard("#3d6fb6", 0.8);
    return disabledMat;
  }
  if (stall.type === "parallel") {
    if (!parallelMat) parallelMat = standard("#a99bc4", 0.8);
    return parallelMat;
  }
  if (stall.eco) {
    if (!ecoMat) ecoMat = standard("#d8bf4f", 0.8);
    return ecoMat;
  }
  if (stall.type === "extended") {
    if (!extendedMat) extendedMat = standard("#9cc39a", 0.8);
    return extendedMat;
  }
  return fallback;
}

let chargerBody = null;
let chargerPanel = null;
function chargerMat() { if (!chargerBody) chargerBody = standard("#2b2a28", 0.5); return chargerBody; }
function chargerPanelMat() { if (!chargerPanel) chargerPanel = standard("#f2c230", 0.4); return chargerPanel; }

function addStallPads(base, material) {
  state.stalls.forEach((stall) => {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(stall.w - 0.04, 0.02, stall.d - 0.04), stallMaterial(stall, material));
    pad.position.set(stall.x + stall.w / 2, base + 0.03, stall.y + stall.d / 2);
    pad.receiveShadow = true;
    host.add(pad);
    if (stall.eco) {
      // 전기차 충전기: 칸 뒤쪽 가운데, 높이 1.4m 기둥형(짙은 몸체 + 노란 화면)
      const r = chargerRect(stall);
      const body = new THREE.Mesh(new THREE.BoxGeometry(r.w, 1.4, r.d), chargerMat());
      body.position.set(r.x + r.w / 2, base + 0.7, r.y + r.d / 2);
      body.castShadow = true;
      host.add(body);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(r.w * 0.7 + 0.02, 0.35, r.d * 0.7 + 0.02), chargerPanelMat());
      panel.position.set(r.x + r.w / 2, base + 1.1, r.y + r.d / 2);
      host.add(panel);
    }
  });
  if (!state.debugColumns) return;
  const alert = standard("#b42318", 0.35);
  (state.columnConflicts || []).forEach((stall) => {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(stall.w - 0.04, 0.05, stall.d - 0.04), alert);
    pad.position.set(stall.x + stall.w / 2, base + 0.06, stall.y + stall.d / 2);
    host.add(pad);
  });
}

function addClearance(base) {
  const mark = state.clearance;
  if (!mark || !(mark.gap > 0)) return;
  const length = Math.max(0.02, mark.x2 - mark.x1);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(length, 0.04, 0.06), standard("#9a3412", 0.2));
  bar.position.set((mark.x1 + mark.x2) / 2, base + 0.12, mark.y);
  host.add(bar);
  addLabel(`${mark.gap.toFixed(2)}m`, (mark.x1 + mark.x2) / 2, base + 0.45, mark.y - 0.15, 1.6);
}

function addColumn(column, index, base, concrete, hazard) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(column.w, floorH() - 1, column.d), concrete);
  mesh.position.set(column.x + column.w / 2, base + 1 + (floorH() - 1) / 2, column.y + column.d / 2);
  mesh.castShadow = true;
  host.add(mesh);
  const band = new THREE.Mesh(new THREE.BoxGeometry(column.w + 0.02, 1, column.d + 0.02), hazard);
  band.position.set(column.x + column.w / 2, base + 0.5, column.y + column.d / 2);
  band.castShadow = true;
  host.add(band);
  addLabel(`C${index + 1}`, column.x + column.w / 2, base + 2.2, column.y + column.d / 2, 1.3);
}

function addArrows(base) {
  const drives = state.drives || [];
  const material = standard("#f7f4ee", 0.35);
  drives.forEach((segment) => {
    if (segment.onRamp) return; // 경사면 위라 3D에서는 생략(램프 자체가 방향을 보여 줌)
    const dx = segment.x2 - segment.x1;
    const dy = segment.y2 - segment.y1;
    const length = Math.hypot(dx, dy);
    if (length < 0.8) return;
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.4, length - 0.7), 0.02, 0.38), material);
    shaft.position.set((segment.x1 + segment.x2) / 2, base + 0.07, (segment.y1 + segment.y2) / 2);
    shaft.rotation.y = -Math.atan2(dy, dx);
    host.add(shaft);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.9, 6), material);
    head.position.set(segment.x2, base + 0.08, segment.y2);
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, 0, dy).normalize());
    host.add(head);
  });
}

function addGates(base) {
  const used = new Set();
  const shown = visibleOpenings();
  shown.forEach((opening, index) => {
    if (used.has(index)) return;
    const twin = shown.findIndex((other, otherIndex) => otherIndex !== index && other.edge === opening.edge && Math.abs(other.t - opening.t) < 1.2);
    if (twin >= 0) used.add(twin);
    const label = twin >= 0 ? "입구·출구" : opening.kind === "in" ? "입구" : "출구";
    const spot = gatePoint(opening);
    const booth = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 1.1), standard("#ece7df", 0.6));
    booth.position.set(spot.boothX, base + 1.1, spot.boothZ);
    booth.castShadow = true;
    host.add(booth);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(opening.width * 0.7, 0.08, 0.12), standard("#f2f2f2", 0.3, paint.hazard));
    arm.position.set(spot.x, base + 1.15, spot.z);
    if (opening.edge === "w" || opening.edge === "e") arm.rotation.y = Math.PI / 2;
    host.add(arm);
    addLabel(label, spot.x, base + CLEAR_HEIGHT + 0.35, spot.z, 3.2);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(opening.edge === "w" || opening.edge === "e" ? 0.12 : opening.width, 0.12, opening.edge === "w" || opening.edge === "e" ? opening.width : 0.12), standard("#111", 0.4, paint.hazard));
    bar.position.set(spot.x, base + CLEAR_HEIGHT, spot.z);
    host.add(bar);
  });
}

function gatePoint(opening) {
  const plate = state.plate;
  if (opening.edge === "s") return { x: opening.t, z: 1.2, boothX: opening.t + opening.width / 2 - 0.8, boothZ: 1.6 };
  if (opening.edge === "n") return { x: opening.t, z: plate.depth - 1.2, boothX: opening.t - opening.width / 2 + 0.8, boothZ: plate.depth - 1.6 };
  if (opening.edge === "w") return { x: 1.2, z: opening.t, boothX: 1.6, boothZ: opening.t + opening.width / 2 - 0.8 };
  return { x: plate.width - 1.2, z: opening.t, boothX: plate.width - 1.6, boothZ: opening.t - opening.width / 2 + 0.8 };
}

/** 내부형 램프: 지상에서 도로 → 경사 시작(외벽에서 11m)까지 평지 진입로. 맨 위층에만 그린다. */
function addGroundApproach(ramp, base, material) {
  if ((ramp.placement || "internal") !== "internal") return;
  const plate = state.plate;
  const fp = rampFootprint(ramp, plate);
  const k = ramp.edge === "w" ? fp.x : ramp.edge === "e" ? plate.width - fp.x - fp.w : ramp.edge === "s" ? fp.y : plate.depth - fp.y - fp.d;
  const y = base + floorH() + 0.02;
  const w = ramp.width;
  let box;
  if (ramp.edge === "w") box = { x: 0, z: ramp.t - w / 2, sx: k, sz: w };
  else if (ramp.edge === "e") box = { x: plate.width - k, z: ramp.t - w / 2, sx: k, sz: w };
  else if (ramp.edge === "s") box = { x: ramp.t - w / 2, z: 0, sx: w, sz: k };
  else box = { x: ramp.t - w / 2, z: plate.depth - k, sx: w, sz: k };
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(box.sx, 0.06, box.sz), material);
  mesh.position.set(box.x + box.sx / 2, y, box.z + box.sz / 2);
  mesh.receiveShadow = true;
  host.add(mesh);
}

/** 곡선 램프: 중심선을 따라 폭만큼 펼친 경사면 + 양쪽 벽. 높이는 구간별 경사로 계산한 값(h)을 쓴다. */
function addCurvedRamp(ramp, shape, material, base, hazard) {
  const high = base + floorH();
  const low = base + 0.12;
  const half = ramp.width / 2;
  const path = shape.path;
  const heightAt = (p) => high - (high - low) * Math.min(1, (p.h || 0) / floorH());
  const sides = path.map((p, i) => {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const y = heightAt(p);
    return { l: [p.x + nx * half, y, p.y + ny * half], r: [p.x - nx * half, y, p.y - ny * half] };
  });
  const surface = [];
  const wallL = [];
  const wallR = [];
  for (let i = 0; i < sides.length - 1; i += 1) {
    const s0 = sides[i];
    const s1 = sides[i + 1];
    surface.push(...s0.l, ...s0.r, ...s1.r, ...s0.l, ...s1.r, ...s1.l);
    const up = (v) => [v[0], v[1] + 0.9, v[2]];
    wallL.push(...s0.l, ...s1.l, ...up(s1.l), ...s0.l, ...up(s1.l), ...up(s0.l));
    wallR.push(...s0.r, ...s1.r, ...up(s1.r), ...s0.r, ...up(s1.r), ...up(s0.r));
  }
  const mesh = (positions, mat) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.computeVertexNormals();
    const item = new THREE.Mesh(geometry, mat);
    item.castShadow = true;
    item.receiveShadow = true;
    host.add(item);
  };
  const wall = standard("#c8c2b8", 0.75);
  wall.side = THREE.DoubleSide;
  const surfaceMat = material.clone();
  surfaceMat.side = THREE.DoubleSide;
  mesh(surface, surfaceMat);
  mesh(wallL, wall);
  mesh(wallR, wall);
  if (state.openings.some((opening) => opening.edge === ramp.edge && Math.abs(opening.t - ramp.t) < 1)) return;
  const footprint = shape.pieces[0];
  const alongX = ramp.edge === "n" || ramp.edge === "s";
  const outer = gatePoint({ ...ramp });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(alongX ? footprint.w : 0.12, 0.16, alongX ? 0.12 : footprint.d), hazard);
  bar.position.set(outer.x, base + CLEAR_HEIGHT, outer.z);
  host.add(bar);
}

function addRampEdges(ramp, footprint, base, hazard) {
  const curb = standard("#d8d4cc", 0.7);
  const wall = standard("#c8c2b8", 0.75);
  const low = base + 0.12;
  const high = base + floorH();
  const outerHigh = ramp.edge === "s" || ramp.edge === "w";
  const samples = 10;
  const alongX = ramp.edge === "n" || ramp.edge === "s";
  for (let index = 0; index < samples; index += 1) {
    const t = (index + 0.5) / samples;
    const u = outerHigh ? t : 1 - t;   // 높은 끝에서 0
    const f = rampFlatFrac;
    const height = u <= f ? high : high - (high - low) * ((u - f) / Math.max(1e-6, 1 - f));
    if (alongX) {
      const z = footprint.y + footprint.d * t;
      slopedPiece(footprint.x + CURB_W / 2, height, z, CURB_W, footprint.d / samples, CURB_H, curb);
      slopedPiece(footprint.x + footprint.w - CURB_W / 2, height, z, CURB_W, footprint.d / samples, CURB_H, curb);
      slopedPiece(footprint.x + 0.18, height, z, 0.16, footprint.d / samples, 0.9, wall);
      slopedPiece(footprint.x + footprint.w - 0.18, height, z, 0.16, footprint.d / samples, 0.9, wall);
    } else {
      const x = footprint.x + footprint.w * t;
      slopedPiece(x, height, footprint.y + CURB_W / 2, footprint.w / samples, CURB_W, CURB_H, curb);
      slopedPiece(x, height, footprint.y + footprint.d - CURB_W / 2, footprint.w / samples, CURB_W, CURB_H, curb);
      slopedPiece(x, height, footprint.y + 0.18, footprint.w / samples, 0.16, 0.9, wall);
      slopedPiece(x, height, footprint.y + footprint.d - 0.18, footprint.w / samples, 0.16, 0.9, wall);
    }
  }
  if (state.openings.some((opening) => opening.edge === ramp.edge && Math.abs(opening.t - ramp.t) < 1)) return;
  const outer = gatePoint({ ...ramp, width: ramp.width, t: ramp.t, edge: ramp.edge });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(alongX ? footprint.w : 0.12, 0.16, alongX ? 0.12 : footprint.d), hazard);
  bar.position.set(outer.x, base + CLEAR_HEIGHT, outer.z);
  host.add(bar);
}

function slopedPiece(x, surface, z, w, d, height, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.05), height, Math.max(d, 0.05)), material);
  mesh.position.set(x, surface + height / 2, z);
  host.add(mesh);
}

function curbBox(x, base, z, w, d, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, CURB_H, d), material);
  mesh.position.set(x, base + CURB_H / 2, z);
  host.add(mesh);
}

function makePaint() {
  return { concrete: speckle(), hazard: stripes(), groove: grooves(), epoxy: speckle("#1d4d32", "#3e8a5a") };
}

function canvasTexture(draw) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  draw(canvas.getContext("2d"), canvas);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function speckle(a = "#c8c2b8", b = "#8f8a82") {
  return canvasTexture((ctx) => {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 80; i += 1) {
      ctx.fillStyle = b;
      ctx.globalAlpha = 0.25;
      ctx.fillRect(Math.random() * 128, Math.random() * 128, 3, 3);
    }
  });
}

function stripes() {
  return canvasTexture((ctx) => {
    ctx.fillStyle = "#161616";
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = "#f0c400";
    ctx.lineWidth = 14;
    for (let i = -128; i < 256; i += 28) {
      ctx.beginPath();
      ctx.moveTo(i, 128);
      ctx.lineTo(i + 128, 0);
      ctx.stroke();
    }
  });
}

function grooves() {
  return canvasTexture((ctx) => {
    ctx.fillStyle = "#9a938c";
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = "#6e675f";
    for (let y = 0; y < 128; y += 10) ctx.fillRect(0, y, 128, 3);
  });
}

function clearGroup(group) {
  const geometries = new Set();
  const materials = new Set();
  group.traverse((child) => {
    if (child.geometry) geometries.add(child.geometry);
    if (child.material) {
      const list = Array.isArray(child.material) ? child.material : [child.material];
      list.forEach((item) => materials.add(item));
    }
  });
  geometries.forEach((item) => item.dispose());
  materials.forEach((item) => item.dispose());
  group.clear();
}

// 내부 램프와 묶인 출입구는 벽에 표시하지 않는다(차는 벽이 아니라 램프로 드나든다).
function visibleOpenings() {
  return state.openings.filter((opening) => !(opening.linkedRamp && state.ramps.some((ramp) => ramp.id === opening.linkedRamp && (ramp.placement || "internal") !== "external")));
}
