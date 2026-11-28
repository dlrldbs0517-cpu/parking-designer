import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  CLEAR_HEIGHT, CURB_H, CURB_W, FLOOR_H, LINE_W, WALL_T,
  coreInterior, coreInteriorOf, pickCoreDoorSide, rampFootprint, rampShape, rampsForLevel,
  siteMarginsOf, stairCoreInterior,
} from "./layout.js?v=381";
import { analyzeOnPlate, rampMesh, slopePlan } from "./rampModules.js?v=381";
import { isLegacyEquivalent, state, subscribe, summary } from "./state.js?v=381";
import { chargerRect } from "./stallMarks.js?v=381";

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
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
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

  let lastSizeOk = false;
  const paintOnce = () => {
    if (!renderer || !scene || !camera) return;
    controls.update();
    renderer.render(scene, camera);
  };
  const resize = () => {
    const rect = container.getBoundingClientRect();
    // flex 자식이 잠시 0이면 부모 scene-view 크기로 폴백
    const parent = container.parentElement;
    const pref = parent && parent.getBoundingClientRect();
    const w = Math.max(rect.width, pref?.width || 0, 2);
    const h = Math.max(rect.height, pref?.height || 0, 2);
    const ok = w > 4 && h > 4;
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
    // updateStyle=true: CSS 픽셀 크기도 맞춰 0×0 표시를 막는다
    renderer.setSize(w, h, true);
    renderer.domElement.style.width = `${w}px`;
    renderer.domElement.style.height = `${h}px`;
    renderer.domElement.style.display = "block";
    lastSizeOk = ok;
    return ok;
  };
  const tryBuild = (attempt = 0) => {
    if (state.resultTab !== "model") return;
    const ok = resize();
    if (!ok && attempt < 20) {
      requestAnimationFrame(() => tryBuild(attempt + 1));
      return;
    }
    try {
      rebuild(sun);
      paintOnce();
    } catch (err) {
      signature = ""; // 실패 시 재시도 가능하게
      console.error("3D rebuild failed", err);
      paintOnce();
      const box = document.getElementById("step2-error");
      if (box) {
        box.hidden = false;
        box.textContent = `3D 모델 생성 오류: ${err && err.message ? err.message : err}`;
      }
    }
  };
  new ResizeObserver(() => {
    const wasOk = lastSizeOk;
    const ok = resize();
    // 0×0 → 실제 크기로 바뀌면 카메라를 다시 잡는다
    if (ok && !wasOk && state.resultTab === "model") {
      signature = "";
      tryBuild(0);
    } else if (ok) {
      paintOnce();
    }
  }).observe(container);
  resize();
  // 마운트 직후 빈 씬이라도 배경색이 보이게 한 프레임 그림 (회색 scene-root만 보이는 상태 방지)
  renderer.setClearColor(0xddd6cb, 1);
  paintOnce();

  const sceneView = () => document.getElementById("scene-view");
  const sceneVisible = () => {
    const view = sceneView();
    return Boolean(view && !view.hidden && state.resultTab === "model");
  };

  subscribe(() => {
    if (state.resultTab !== "model") return;
    // 레이아웃 확정 후 빌드 (hidden→show 직후 0×0 방지)
    requestAnimationFrame(() => requestAnimationFrame(() => tryBuild(0)));
  });

  const loop = () => {
    frame = requestAnimationFrame(loop);
    if (sceneVisible()) {
      controls.update();
      renderer.render(scene, camera);
    }
  };
  loop();

  const resetBtn = document.getElementById("reset-camera");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      signature = "";
      tryBuild(0);
    });
  }

  // open3d에서 강제 재빌드할 때 사용
  return {
    forceRebuild: () => { signature = ""; tryBuild(0); },
    resize,
    hasCanvas: () => Boolean(renderer?.domElement?.parentElement),
    canvasSize: () => {
      const el = renderer?.domElement;
      if (!el) return { w: 0, h: 0 };
      return { w: el.width || 0, h: el.height || 0 };
    },
  };
}

const paint = makePaint();

function rebuild(sun) {
  if (!state.plate || !building || !camera || !controls) return;
  const info = summary();
  const floors = Math.max(1, info.floors);
  const drawn = Math.min(floors, DRAW_CAP);
  const single = state.floorView !== "all";
  const next = JSON.stringify({
    plate: state.plate,
    cores: state.cores,
    buildings: state.buildings,
    openings: state.openings,
    ramps: state.ramps,
    rampForm: state.rampForm,
    lowerRampForm: state.lowerRampForm,
    lowerRampMode: state.lowerRampMode,
    route: state.route,
    columns: state.columns.length,
    stalls: state.stalls.length,
    floors,
    floorView: state.floorView,
  });
  const keepCamera = signature === next;
  host = building;
  clearGroup(building);

  const plate = state.plate;
  const concrete = standard("#d5d0c8", 0.86, paint.concrete);
  const columnMat = standard("#8d887f", 0.78, paint.concrete);
  const hazard = standard("#111", 0.6, paint.hazard);
  const coreMat = standard("#cfc8be", 0.82, paint.concrete);
  const rampMat = standard("#8d8680", 0.7, paint.groove);
  rampMat.side = THREE.DoubleSide;
  const aisleMat = standard("#2f6b45", 0.42, paint.epoxy);
  const stallMats = {
    general: standard("#b7b4ae", 0.8),
    extended: standard("#86efac", 0.72),
    disabled: standard("#3b82f6", 0.62),
    eco: standard("#eab308", 0.7),
    parallel: standard("#94a3b8", 0.7),
  };
  const lineMat = standard("#f4f1ea", 0.4);
  const inMat = standard("#1f6b62", 0.45);
  const outMat = standard("#b5522a", 0.45);

  const levels = single ? [Math.max(0, Math.min(drawn - 1, state.floorView))] : [...Array(drawn).keys()];
  levels.forEach((level) => {
    const base = single ? 0 : -level * FLOOR_H;
    const floor = new THREE.Group();
    building.add(floor);
    host = floor;
    try {
      addSlab(plate, base, concrete);
      addAisles(base, aisleMat);
      addStallPads(base, stallMats);
      host.add(stallLines(base, lineMat));
      addArrows(base);
      state.columns.forEach((column, index) => addColumn(column, index, base, columnMat, hazard));
      addClearance(base);
      state.cores.forEach((core) => addCore(core, coreMat, base));
      // B1(level 0): 지상→지하 진입 램프. B2+(level≥1): 층간 다른 경로(기본 alternate).
      const levelRamps = rampsForLevel(
        state.ramps,
        plate,
        level,
        state.lowerRampMode || (plate && plate.lowerRampMode) || "alternate",
        state.lowerRampOverrides,
      );
      levelRamps.forEach((ramp) => {
        try {
          if (ramp.modules?.length && !isLegacyEquivalent(ramp, plate)) {
            addModuleRamp(ramp, rampMat, base, hazard, level);
          } else {
            addRamp(ramp, rampMat, base, hazard, level);
          }
        } catch (rampErr) {
          console.warn("3D ramp skip", level, rampErr);
        }
      });
      addSiteSetback(base);
      addWalls(concrete, base);
      // 입구·출구(부스·차단봉·문턱)는 지상에서 들어오는 맨 위층(B1)에만
      if (level === 0) {
        addGates(base);
        state.openings.forEach((opening) => {
          addThreshold(opening, opening.kind === "in" ? inMat : outMat, base);
        });
      }
      addLabel(`B${level + 1}`, plate.width / 2, base + 1.2, -2.2, 6.4);
    } catch (levelErr) {
      console.warn("3D floor skip", level, levelErr);
      addLabel(`B${level + 1}?`, plate.width / 2, base + 1.2, -2.2, 6.4);
    }
  });

  host = building;
  let towerH = 0;
  if (!single) {
    addGrade(plate);
    addLabel("지상", plate.width / 2, FLOOR_H + 1.2, -3);
    if (state.floorView === "all") towerH = addTowers();
  }
  if (floors > drawn) addLabel(`외 ${floors - drawn}개 층`, plate.width + 8, -drawn * FLOOR_H / 2, plate.depth / 2);

  const stack = single ? 1 : drawn;
  const rampReach = state.ramps.reduce((reach, ramp) => {
    let box;
    try {
      const shape = rampShape(ramp, plate);
      box = shape.footprint || rampFootprint(ramp, plate);
    } catch (e) {
      box = rampFootprint(ramp, plate);
    }
    if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y)) return reach;
    return Math.max(reach, Math.max(0, -box.x), Math.max(0, -box.y), Math.max(0, box.x + box.w - plate.width), Math.max(0, box.y + box.d - plate.depth));
  }, 0);
  const siteM = siteMarginsOf({
    ...plate,
    siteMargin: plate.siteMargin != null ? plate.siteMargin : state.siteMargin,
    siteMargins: plate.siteMargins || state.siteMargins,
  });
  const marginReach = Math.max(siteM.n || 0, siteM.s || 0, siteM.e || 0, siteM.w || 0, rampReach);
  let span = Math.max(plate.width + marginReach, plate.depth + marginReach, stack * FLOOR_H, towerH + FLOOR_H, 20);
  if (!Number.isFinite(span) || span < 1) span = Math.max(plate.width || 40, plate.depth || 40, 20);
  sun.position.set(-plate.width * 0.2, span, plate.depth * 0.2);
  sun.target.position.set(plate.width / 2, single ? 1 : -drawn * FLOOR_H / 2, plate.depth / 2);
  sun.shadow.camera.left = -span;
  sun.shadow.camera.right = span * 1.4;
  sun.shadow.camera.top = span;
  sun.shadow.camera.bottom = -span;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = span * 4;
  sun.shadow.camera.updateProjectionMatrix();

  // 대형 평면·다층에서 기본 far=800이면 모델이 잘려 빈 화면처럼 보인다
  const camFar = Math.max(800, span * 8, 2000);
  camera.near = 0.5;
  camera.far = camFar;
  camera.updateProjectionMatrix();

  if (!keepCamera) {
    const center = new THREE.Vector3(plate.width / 2, single ? 1.2 : -((drawn - 1) * FLOOR_H) / 2, plate.depth / 2);
    const dist = towerH > 0 ? 1.25 : 1;
    const cx = center.x + plate.width * 0.9 * dist;
    const cy = center.y + span * 0.42 * dist;
    const cz = center.z + plate.depth * 1.05 * dist;
    if (Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(cz)) {
      camera.position.set(cx, cy, cz);
      controls.target.copy(center);
      controls.update();
    }
  }
  // 성공한 뒤에만 signature 고정 — 중간에 throw 나면 재시도 가능
  signature = next;
}

/** 지상선 위 반투명 타워 매스. B1·전체 층 보기일 때만. 반환: 최고 타워 높이(m). */
function addTowers() {
  let maxH = 0;
  const mat = new THREE.MeshStandardMaterial({
    color: "#9aa7b5",
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    roughness: 0.9,
    metalness: 0.02,
  });
  (state.buildings || []).forEach((b) => {
    const core = (state.cores || []).find((c) => c.buildingId === b.id && (c.kind || "building") !== "stair");
    if (!core || !b.tower) return;
    const tw = b.tower;
    const h = (b.floors || 1) * (b.floorHeight || 2.9);
    maxH = Math.max(maxH, h);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(tw.w, h, tw.d), mat);
    mesh.position.set(core.x + (tw.dx || 0) + tw.w / 2, FLOOR_H + h / 2, core.y + (tw.dy || 0) + tw.d / 2);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    host.add(mesh);
    addLabel(`${b.name} ${b.floors}F`, core.x + (tw.dx || 0) + tw.w / 2, FLOOR_H + h + 1.4, core.y + (tw.dy || 0) + tw.d / 2, 5);
  });
  return maxH;
}

function standard(color, roughness, map) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02, map: map || null });
}

function addSlab(plate, base, material) {
  const shape = new THREE.Shape();
  let poly = (plate.polygon && plate.polygon.length >= 3)
    ? plate.polygon
    : [{ x: 0, y: 0 }, { x: plate.width, y: 0 }, { x: plate.width, y: plate.depth }, { x: 0, y: plate.depth }];
  // 닫힘 점 중복 제거(ExtrudeGeometry 퇴화 방지)
  if (poly.length > 1) {
    const a = poly[0];
    const b = poly[poly.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) poly = poly.slice(0, -1);
  }
  poly.forEach((p, i) => (i ? shape.lineTo(p.x, p.y) : shape.moveTo(p.x, p.y)));
  shape.closePath();
  rampHoles(plate).forEach((hole) => {
    const path = new THREE.Path();
    path.moveTo(hole.x, hole.y);
    path.lineTo(hole.x, hole.y + hole.d);
    path.lineTo(hole.x + hole.w, hole.y + hole.d);
    path.lineTo(hole.x + hole.w, hole.y);
    path.lineTo(hole.x, hole.y);
    shape.holes.push(path);
  });
  let geometry;
  try {
    geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.28, bevelEnabled: false });
  } catch (e) {
    // hole 퇴화 등으로 Extrude 실패 시 단순 박스 슬래브
    geometry = new THREE.BoxGeometry(plate.width, 0.28, plate.depth);
    const slab = new THREE.Mesh(geometry, material);
    slab.position.set(plate.width / 2, base - 0.14, plate.depth / 2);
    slab.receiveShadow = true;
    host.add(slab);
    return;
  }
  geometry.rotateX(Math.PI / 2);
  const slab = new THREE.Mesh(geometry, material);
  slab.position.set(0, base, 0);
  slab.receiveShadow = true;
  host.add(slab);
}

function rampHoles(plate) {
  const holes = [];
  state.ramps.forEach((ramp) => {
    if (ramp.modules?.length && !isLegacyEquivalent(ramp, plate)) {
      const legal = Number(plate.legalStalls) || 0;
      const site = analyzeOnPlate(ramp, plate, { legalStalls: legal, blocks: plate.blockRects || [] });
      (site.block || []).forEach((b) => {
        const x = Math.max(0.6, b.x);
        const y = Math.max(0.6, b.y);
        const x2 = Math.min(plate.width - 0.6, b.x + b.w);
        const y2 = Math.min(plate.depth - 0.6, b.y + b.d);
        if (x2 - x > 1.2 && y2 - y > 1.2) holes.push({ x, y, w: x2 - x, d: y2 - y });
      });
      if (!(site.block || []).length && site.openings?.[0]) {
        const op = site.openings[0];
        const mouth = 2.4;
        const half = (op.width || ramp.width) / 2;
        if (op.edge === "w") holes.push({ x: 0.6, y: op.t - half, w: mouth, d: op.width || ramp.width });
        if (op.edge === "e") holes.push({ x: plate.width - 0.6 - mouth, y: op.t - half, w: mouth, d: op.width || ramp.width });
        if (op.edge === "s") holes.push({ x: op.t - half, y: 0.6, w: op.width || ramp.width, d: mouth });
        if (op.edge === "n") holes.push({ x: op.t - half, y: plate.depth - 0.6 - mouth, w: op.width || ramp.width, d: mouth });
      }
      return;
    }
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
  const h = FLOOR_H - 0.05;
  const doorSide = core.doorSide || pickCoreDoorSide(core, state.aisles, state.plate?.blockRects);
  const interior = coreInteriorOf(core, state.aisles, state.plate?.blockRects);
  const doorW = interior?.door
    ? Math.max(interior.door.w, interior.door.d)
    : Math.min(1.2, Math.min(core.w, core.d) * 0.34);

  // 네 벽 — 출입문 면만 개구
  const walls = [
    { side: "n", x: core.x + core.w / 2, z: core.y + core.d - t / 2, sx: core.w, sz: t },
    { side: "s", x: core.x + core.w / 2, z: core.y + t / 2, sx: core.w, sz: t },
    { side: "w", x: core.x + t / 2, z: core.y + core.d / 2, sx: t, sz: core.d },
    { side: "e", x: core.x + core.w - t / 2, z: core.y + core.d / 2, sx: t, sz: core.d },
  ];
  walls.forEach((w) => {
    if (w.side !== doorSide) {
      wallBox(w.x, base, w.z, w.sx, w.sz, material, h);
      return;
    }
    // 출입문 개구: 좌우(또는 상하) 벽 조각
    if (doorSide === "n" || doorSide === "s") {
      const gap = Math.min(doorW, core.w * 0.4);
      const left = (core.w - gap) / 2;
      if (left > 0.15) {
        wallBox(core.x + left / 2, base, w.z, left, t, material, h);
        wallBox(core.x + core.w - left / 2, base, w.z, left, t, material, h);
      }
      const zDoor = doorSide === "s" ? core.y + 0.1 : core.y + core.d - 0.1;
      const frame = standard("#2b2a28", 0.5);
      const doorMat = standard("#3d4a43", 0.55);
      wallBox(core.x + core.w / 2, base, zDoor, gap + 0.16, 0.08, frame, 2.15);
      wallBox(core.x + core.w / 2 - gap * 0.22, base, zDoor + (doorSide === "s" ? 0.04 : -0.04), gap * 0.42, 0.04, doorMat, 2.05);
      wallBox(core.x + core.w / 2 + gap * 0.22, base, zDoor + (doorSide === "s" ? 0.04 : -0.04), gap * 0.42, 0.04, doorMat, 2.05);
    } else {
      const gap = Math.min(doorW, core.d * 0.4);
      const low = (core.d - gap) / 2;
      if (low > 0.15) {
        wallBox(w.x, base, core.y + low / 2, t, low, material, h);
        wallBox(w.x, base, core.y + core.d - low / 2, t, low, material, h);
      }
      const xDoor = doorSide === "w" ? core.x + 0.1 : core.x + core.w - 0.1;
      const frame = standard("#2b2a28", 0.5);
      const doorMat = standard("#3d4a43", 0.55);
      wallBox(xDoor, base, core.y + core.d / 2, 0.08, gap + 0.16, frame, 2.15);
      wallBox(xDoor + (doorSide === "w" ? 0.04 : -0.04), base, core.y + core.d / 2 - gap * 0.22, 0.04, gap * 0.42, doorMat, 2.05);
      wallBox(xDoor + (doorSide === "w" ? 0.04 : -0.04), base, core.y + core.d / 2 + gap * 0.22, 0.04, gap * 0.42, doorMat, 2.05);
    }
  });

  const cabin = standard("#1c1c1c", 0.45);
  const shaft = standard("#4b5563", 0.55);
  const stairMat = standard("#94a3b8", 0.5);
  (interior?.elevators || []).forEach((el) => {
    wallBox(el.x + el.w / 2, base, el.y + el.d / 2, el.w, el.d, shaft, h * 0.98);
    wallBox(el.x + el.w / 2, base, el.y + el.d / 2, Math.max(0.6, el.w - 0.35), Math.max(0.5, el.d - 0.35), cabin, 2.15);
    addLabel(el.label || "EL", el.x + el.w / 2, base + h + 0.1, el.y + el.d / 2, 1.8);
  });
  (interior?.stairs || (interior?.stair ? [interior.stair] : [])).forEach((st) => {
    wallBox(st.x + st.w / 2, base, st.y + st.d / 2, st.w, st.d, stairMat, 0.18);
    const steps = 6;
    for (let i = 0; i < steps; i += 1) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      if (st.w >= st.d) {
        wallBox(st.x + st.w * (t0 + t1) / 2, base + 0.12 + i * 0.22, st.y + st.d / 2, st.w / steps - 0.02, st.d * 0.9, stairMat, 0.2);
      } else {
        wallBox(st.x + st.w / 2, base + 0.12 + i * 0.22, st.y + st.d * (t0 + t1) / 2, st.w * 0.9, st.d / steps - 0.02, stairMat, 0.2);
      }
    }
    addLabel("계단", st.x + st.w / 2, base + h + 0.1, st.y + st.d / 2, 1.8);
  });
  const labelText = core.kind === "stair" ? "피난계단" : "코어";
  addLabel(labelText, core.x + core.w / 2, base + h + 0.2, core.y + core.d / 2, 2.2);
}

function addRamp(ramp, material, base, hazard, level = 0) {
  const plate = state.plate;
  const shape = rampShape(ramp, plate);
  const footprint = shape.footprint || rampFootprint(ramp, plate);
  const H = FLOOR_H;
  // path에 하강 h가 있으면 리본 메시로 그린다(곡선·원형·직선 공통).
  const curved = shape.path && shape.path.length >= 2 && shape.path.some((p) => p.h != null)
    && (shape.kind === "curved" || shape.kind === "spiral" || shape.outerKind || shape.externalCurve);
  const hasPath = shape.path && shape.path.length >= 2 && shape.path.some((p) => p.h != null);
  if (hasPath) {
    addRampRibbon(shape, ramp, material, base, H);
  } else {
    addRampQuad(ramp, footprint, material, base, H);
  }
  // 곡선·외곽 램프는 AABB 연석이 부채꼴/상자 벽을 만들므로 경로 리본 치마만 쓴다.
  if (!curved) addRampEdges(ramp, footprint, base, hazard);
}

/** 모듈 사슬 램프: rampMesh 삼각형을 BufferGeometry로. */
function addModuleRamp(ramp, material, base, hazard, level = 0) {
  const plate = state.plate;
  const H = FLOOR_H;
  // 외곽·곡선 형태는 legacy path 리본이 맞고, 직선 모듈 사슬로 그리면 팬/어긋난 메시가 된다.
  const form = ramp.form || plate?.rampForm || "";
  // 외곽·곡선 형태는 shape.path 리본이 정답. 직선 모듈 사슬로 그리면 어긋나거나 팬처럼 보인다.
  const preferShape = form === "spiral" || form === "outer180" || form === "outer9090" || form === "curve90";
  if (preferShape || isLegacyEquivalent(ramp, plate)) {
    addRamp(ramp, material, base, hazard);
    return;
  }
  const legal = Number(plate.legalStalls) || Number(plate.stallRules?.legalStalls) || 0;
  const plan = slopePlan(ramp, { floorHeight: H, legalStalls: legal });
  // groundY: 이 층 슬래브 위가 램프 시작 높이. rampMesh는 top - k*H.
  const groundY = base + H;
  const mesh = rampMesh(ramp, plan, { floorHeight: H, groundY });
  const mk = (coords, mat) => {
    if (!coords || coords.length < 9) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(coords, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    host.add(m);
  };
  mk(mesh.surface, material);
  mk(mesh.walls, standard("#6b6358", 0.75));
  if (mesh.curbs?.length) {
    // curbs는 사각형 링 좌표 — 간단히 연석 박스로 대체하지 않고 면으로
    mk(mesh.curbs, hazard || standard("#c4a035", 0.6));
  }
  // 외부 연결 개구부는 addWalls cuts가 edge/t를 씀(applyPlateMeta로 맞춤)
}

/**
 * 중심선 path(x,y,h)를 따라 폭·두께 있는 경사 리본.
 * 구간마다 독립 법선으로 삼각형을 붙이면 곡선에서 부채꼴 팬이 생기므로,
 * 접선 평균 오프셋 + 공유 정점 + 슬래브 두께로 통로처럼 그린다.
 */
function addRampRibbon(shape, ramp, material, base, H) {
  const raw = shape.path || [];
  // XY 중복·극소 구간 제거(수직으로만 떨어지는 끝점 포함)
  const path = [];
  raw.forEach((p) => {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const prev = path[path.length - 1];
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < 0.08) {
      // 같은 자리 높이만 갱신
      if (p.h != null) prev.h = p.h;
      return;
    }
    path.push({ x: p.x, y: p.y, h: p.h == null ? (prev ? prev.h : 0) : p.h });
  });
  if (path.length < 2) return;

  const laneW = Number(shape.width) || Number(ramp.width) || 6;
  const half = Math.min(Math.max(laneW, 6) / 2, 4.0); // 차로 폭의 절반, 곡선 안쪽이 접히지 않게 상한
  const thick = 0.22;
  const wallH = 0.55;

  // 각 점에서 접선→수평 법선 (끝점은 이웃 한쪽)
  const frames = path.map((p, i) => {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    let tx = b.x - a.x;
    let tz = b.y - a.y;
    let len = Math.hypot(tx, tz);
    if (len < 1e-6) {
      const j = Math.min(path.length - 1, i + 1);
      const k = Math.max(0, i - 1);
      tx = path[j].x - path[k].x;
      tz = path[j].y - path[k].y;
      len = Math.hypot(tx, tz) || 1;
    }
    tx /= len;
    tz /= len;
    const y = base + H - Math.max(0, Math.min(H, Number(p.h) || 0));
    return {
      cx: p.x,
      cz: p.y,
      y,
      nx: -tz,
      nz: tx,
    };
  });

  const positions = [];
  const pushTri = (a, b, c) => {
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  };
  const left = (f) => [f.cx + f.nx * half, f.y, f.cz + f.nz * half];
  const right = (f) => [f.cx - f.nx * half, f.y, f.cz - f.nz * half];
  const down = (v) => [v[0], v[1] - thick, v[2]];
  const up = (v, h) => [v[0], v[1] + h, v[2]];

  for (let i = 0; i < frames.length - 1; i += 1) {
    const f0 = frames[i];
    const f1 = frames[i + 1];
    const l0 = left(f0);
    const r0 = right(f0);
    const l1 = left(f1);
    const r1 = right(f1);
    // 윗면
    pushTri(l0, r0, r1);
    pushTri(l0, r1, l1);
    // 아랫면(두께)
    pushTri(down(r0), down(l0), down(l1));
    pushTri(down(r0), down(l1), down(r1));
    // 측면 치마(얇은 벽) — AABB 연석 대신 경로를 따라감
    pushTri(l0, l1, up(l1, wallH));
    pushTri(l0, up(l1, wallH), up(l0, wallH));
    pushTri(r1, r0, up(r0, wallH));
    pushTri(r1, up(r0, wallH), up(r1, wallH));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  host.add(mesh);
}

function addRampQuad(ramp, footprint, material, base, H) {
  const low = base + 0.12;
  const high = base + H;
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
}

/** 대지 이격 경계(점선) — 결과 3D에서도 이격이 보이게 */
function addSiteSetback(base) {
  const plate = state.plate;
  if (!plate) return;
  const m = siteMarginsOf({
    ...plate,
    siteMargin: plate.siteMargin != null ? plate.siteMargin : state.siteMargin,
    siteMargins: plate.siteMargins || state.siteMargins,
  });
  if (!(m.n > 0 || m.s > 0 || m.e > 0 || m.w > 0)) return;
  const y = base + 0.08;
  const pts = [
    new THREE.Vector3(-m.w, y, -m.s),
    new THREE.Vector3(plate.width + m.e, y, -m.s),
    new THREE.Vector3(plate.width + m.e, y, plate.depth + m.n),
    new THREE.Vector3(-m.w, y, plate.depth + m.n),
    new THREE.Vector3(-m.w, y, -m.s),
  ];
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineDashedMaterial({
    color: 0x64748b,
    dashSize: 1.6,
    gapSize: 1.0,
    linewidth: 1,
  });
  const line = new THREE.Line(geo, mat);
  line.computeLineDistances();
  host.add(line);
  const labelM = Math.max(m.n, m.s, m.e, m.w);
  addLabel(`대지 이격 ${labelM}m`, plate.width / 2, base + 0.55, -m.s - 1.2, 10);
}

function addWalls(material, base) {
  const plate = state.plate;
  const poly = (plate.polygon && plate.polygon.length >= 3)
    ? plate.polygon
    : null;
  const isRect = !poly || (poly.length === 4
    && Math.abs(poly[0].x) < 1e-6 && Math.abs(poly[0].y) < 1e-6
    && Math.abs(poly[2].x - plate.width) < 1e-6 && Math.abs(poly[2].y - plate.depth) < 1e-6);
  if (!isRect && poly) {
    // 다각형 외벽: 각 변을 얇은 박스로 근사(개구 절단은 사각형 평면에서만)
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.05) continue;
      const cx = (a.x + b.x) / 2;
      const cz = (a.y + b.y) / 2;
      const ang = Math.atan2(dy, dx);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(len, 1.15, 0.24),
        material,
      );
      mesh.position.set(cx, base + 1.15 / 2, cz);
      mesh.rotation.y = -ang;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      host.add(mesh);
    }
    return;
  }
  const cuts = { s: [], n: [], w: [], e: [] };
  state.openings.concat(state.ramps).forEach((item) => {
    cuts[item.edge].push({ start: item.t - item.width / 2, end: item.t + item.width / 2 });
  });
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
  const y = FLOOR_H;
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

function stallTypeOf(stall) {
  if (!stall) return "general";
  if (stall.parallel || stall.type === "parallel") return "parallel";
  return stall.type || "general";
}

function addStallPads(base, materials) {
  const fallback = materials.general || standard("#b7b4ae", 0.8);
  state.stalls.forEach((stall) => {
    const mat = materials[stallTypeOf(stall)] || fallback;
    const pad = new THREE.Mesh(new THREE.BoxGeometry(stall.w - 0.04, 0.02, stall.d - 0.04), mat);
    pad.position.set(stall.x + stall.w / 2, base + 0.03, stall.y + stall.d / 2);
    pad.receiveShadow = true;
    host.add(pad);
    if (stallTypeOf(stall) === "eco") {
      // 전기차 충전기(높이 1.4m)
      const r = chargerRect(stall);
      const box = new THREE.Mesh(new THREE.BoxGeometry(r.w, 1.4, r.d), standard("#1f2937", 0.5));
      box.position.set(r.x + r.w / 2, base + 0.7, r.y + r.d / 2);
      box.castShadow = true;
      host.add(box);
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
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(column.w, FLOOR_H - 1, column.d), concrete);
  mesh.position.set(column.x + column.w / 2, base + 1 + (FLOOR_H - 1) / 2, column.y + column.d / 2);
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
  state.openings.forEach((opening, index) => {
    if (used.has(index)) return;
    const twin = state.openings.findIndex((other, otherIndex) => otherIndex !== index && other.edge === opening.edge && Math.abs(other.t - opening.t) < 1.2);
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

function addRampEdges(ramp, footprint, base, hazard) {
  const curb = standard("#d8d4cc", 0.7);
  const wall = standard("#c8c2b8", 0.75);
  const low = base + 0.12;
  const high = base + FLOOR_H;
  const outerHigh = ramp.edge === "s" || ramp.edge === "w";
  const samples = 10;
  const alongX = ramp.edge === "n" || ramp.edge === "s";
  for (let index = 0; index < samples; index += 1) {
    const t = (index + 0.5) / samples;
    const height = (outerHigh ? high : low) + ((outerHigh ? low : high) - (outerHigh ? high : low)) * t;
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
  if (level > 0) return;   // 램프 입구 차단봉도 맨 위층만
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
