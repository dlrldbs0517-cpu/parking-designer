import { calculateDemand, emptyDemand } from "./demand.js?v=381";
import { stallRuleTargets } from "./stallTypes.js?v=381";
import {
  basementCount,
  bestLayoutFor,
  clampCore,
  clampOpening,
  defaultCore,
  defaultCores,
  defaultRampLength,
  defaultTower,
  externalRampClearance,
  generateVariants,
  intervalsOverlap,
  layoutParking,
  lowerFloorRamp,
  rampShape,
  referenceCase,
  siteMarginsOf,
  coreInterior,
  nudgeCoresClearOfRamps,
  snapCoreToCells,
  rampKeepOut,
  pickCoreDoorSide,
  spaceCoresForTowers,
  stairCore,
  stairCoreInterior,
  towerBlockRects,
  towerTransferNotes,
} from "./layout.js?v=381";
import {
  addModule as chainAddModule,
  applyPlateMeta,
  autoFit as chainAutoFit,
  isLegacyEquivalent as modulesLegacyEq,
  migrateLegacy,
  moveRamp as chainMoveRamp,
  removeModule as chainRemoveModule,
  rotateRamp as chainRotateRamp,
  setLength as chainSetLength,
  slopePlan,
  analyzeOnPlate,
  buildChain,
} from "./rampModules.js?v=381";
import {
  normalizePolygon,
  outsideBlockRects,
  isRectangularPlate,
  plateDimsFromPolygon,
  polygonFromPlate,
  rectPolygon,
  validatePolygon,
} from "./polygon.js?v=381";

export const state = {
  step: 1,
  households: 100,
  demand: emptyDemand(),
  floorView: "all",
  resultTab: "plan",
  siteType: "single",
  buildings: [],
  parkWidth: 48,
  parkDepth: 42,
  /** "rect" | "draw" | "coords" */
  plateShapeMode: "rect",
  /** 반시계 다각형(m). null이면 사각형 parkWidth×parkDepth */
  parkPolygon: null,
  platePolyError: "",
  columnSpacing: 8.1,
  columnWidth: 0.5,
  columnDepth: 0.5,
  minClear: 0,
  siteMargin: 20,
  siteMargins: { n: null, s: null, e: null, w: null },
  floorHeight: 3.2,
  spansX: "",
  columnAuto: true,
  coreSnap: true,     // 코어를 기둥 격자 칸에 맞춤
  pruneFragments: true,  // 줄에서 떨어진 1~2대 조각 칸 빼기
  corePlaced: false,
  corePreview: null,  // 코어 단계: 고른 크기가 놓일 자리 미리보기(깜빡임)
  coreFlash: null,    // 코어 단계: 목록에서 고른 코어 잠깐 깜빡임 {index, until}  // 코어 단계: 사용자가 크기 정하고 「코어 놓기」를 눌러야 코어가 생김
  gridOptions: null,  // 코어 단계에서 계산한 기둥 격자 후보 [{cx, cy, stalls, score}]
  gridChosen: -1,
  gridKey: "",   // 기둥 간격 자동: 추천 단계에서 여러 가로·세로 간격(2·3·4대, 섞은 간격)을 돌려 고름
  spansY: "",
  trimDeadEnds: true,
  wallColumns: "front",
  noGroundAccess: false,
  roadEdge: "w",
  coreSet: false,   // 사용자가 코어를 직접 놓았으면 엔진이 코어를 옮기지 않음
  rampPos: "auto",
  stallRules: {
    disabled: true,
    disabledRate: 0.04,
    parallel: true,
    ecoMode: "auto",
    ecoRate: 0.05,
  },
  coreAuto: true,
  coreSearch: null,
  rampPlacement: "internal",
  rampForm: "auto",
  lowerRampForm: "auto",
  lowerRampMode: "same",   // 기본: 출입 램프와 같은 자리
  /** 층간 램프 위치 덮어쓰기 { [groundId]: { edge, t, x?, y? } } */
  lowerRampOverrides: {},
  entranceMode: "integrated",
  circulation: "ccw",
  entranceWidth: 6,
  rampWidth: 6,
  rampLength: null,   // 비우면 층고·법정 경사로 자동(법정 최소)
  plate: null,
  columns: [],
  stalls: [],
  aisles: [],
  drives: [],
  route: [],
  connected: false,
  issues: [],
  columnConflicts: [],
  clearance: null,
  debugColumns: false,
  metrics: null,
  gridX: [],
  gridY: [],
  axis: "x",
  fixedAlong: "가로",
  flexAlong: "세로",
  cores: [],
  coreIndex: 0,
  core: null,
  openings: [],
  ramps: [],
  variants: [],
  variantIndex: 0,
  spec: null,
  revealStage: 6,
  referenceNotes: [],
  overlay: { url: "", mode: "off", opacity: 0.4, scale: 1, x: 0, y: 0 },
  tool: "core",
  selection: null,
  nextId: 1,
};

const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emit() {
  listeners.forEach((listener) => listener());
}

export function plateFromState() {
  const rules = currentStallRules();
  const spansX = parseSpans(state.spansX);
  const spansY = parseSpans(state.spansY);
  let width = round1(state.parkWidth);
  let depth = round1(state.parkDepth);
  let polygon = null;
  state.platePolyError = "";
  if (state.parkPolygon && state.parkPolygon.length >= 3) {
    const errs = validatePolygon(state.parkPolygon);
    if (errs.length) {
      state.platePolyError = errs.join(" ");
      polygon = normalizePolygon(state.parkPolygon);
    } else {
      const dims = plateDimsFromPolygon(state.parkPolygon);
      polygon = dims.polygon;
      width = dims.width;
      depth = dims.depth;
      state.parkWidth = width;
      state.parkDepth = depth;
    }
  } else {
    polygon = rectPolygon(width, depth);
  }
  const plate = {
    width,
    depth,
    polygon,
    spacing: round1(state.columnSpacing),
    columnWidth: round1(state.columnWidth),
    columnDepth: round1(state.columnDepth),
    minClear: round1(state.minClear * 100) / 100,
    siteMargin: round1(state.siteMargin),
    siteMargins: { ...(state.siteMargins || {}) },
    floorHeight: round1(state.floorHeight),
    // 코어를 격자 칸에 맞추는 동안은 간격을 비워 두지 않는다(엔진이 배치마다 기둥 줄을 따로 잡으면 코어와 어긋남)
    spansX: spansX.values && spansX.values.length ? spansX.values : (state.coreSnap !== false && state.siteType !== "complex" ? [round1(state.columnSpacing)] : spansX.values),
    spansY: spansY.values && spansY.values.length ? spansY.values : (state.coreSnap !== false && state.siteType !== "complex" ? [round1(state.columnSpacing)] : spansY.values),
    trimDeadEnds: Boolean(state.trimDeadEnds),
    wallColumns: state.wallColumns || "front",
    noGroundAccess: Boolean(state.noGroundAccess),
    roadEdge: state.roadEdge || "w",
    rampPos: state.rampPos || "auto",
    pruneFragments: state.pruneFragments !== false,
    rampPlacement: state.rampPlacement,
    rampForm: state.rampForm || "auto",
    lowerRampForm: state.lowerRampForm || "auto",
    lowerRampMode: state.lowerRampMode || "alternate",
    lowerRampOverrides: { ...(state.lowerRampOverrides || {}) },
    legalStalls: rules.legalStalls,
    stallRules: rules,
  };
  // 비사각형 다각형만 밖 막힘 영역 추가 (사각형은 기존과 동일)
  let blocks = [];
  if (polygon && polygon.length >= 3 && !isRectangularPlate(polygon, width, depth)) {
    blocks = outsideBlockRects(polygon, 2);
  }
  if (state.siteType === "complex" && state.buildings.length) {
    plate.buildings = state.buildings;
    blocks = blocks.concat(towerBlockRects(state.buildings, state.cores, plate));
  }
  if (blocks.length) plate.blockRects = blocks;
  return plate;
}

export function setParkPolygon(poly, { silent = false } = {}) {
  const norm = normalizePolygon(poly);
  if (!norm) {
    state.parkPolygon = null;
    state.platePolyError = "다각형이 비어 있습니다.";
    if (!silent) emit();
    return false;
  }
  const errs = validatePolygon(norm);
  state.platePolyError = errs.join(" ");
  if (errs.length) {
    state.parkPolygon = norm; // 편집 중 표시는 유지
    if (!silent) emit();
    return false;
  }
  const dims = plateDimsFromPolygon(norm);
  state.parkPolygon = dims.polygon;
  state.parkWidth = dims.width;
  state.parkDepth = dims.depth;
  if (!silent) emit();
  return true;
}

export function clearParkPolygon() {
  state.parkPolygon = null;
  state.platePolyError = "";
  state.plateShapeMode = "rect";
  emit();
}

/** "4, 5, 6" → 숫자 배열. 비우면 null(기존 단일 간격). 3~15m 밖이면 error */
export function parseSpans(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return { values: null, error: null };
  const parts = raw.split(/[,，\s]+/).filter(Boolean);
  const values = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const n = Number(part);
    if (!Number.isFinite(n)) return { values: null, error: `"${part}"는 숫자가 아닙니다` };
    // 첫 간격은 벽에서 띄운 거리(캔틸레버)로 1~6m도 허용 — 뒤에 반복 간격이 있을 때만
    if (i === 0 && parts.length > 1 && n >= 1 && n <= 6) { values.push(n); continue; }
    if (n < 3 || n > 15) return { values: null, error: `${n}m는 3~15m 범위 밖입니다` };
    values.push(n);
  }
  return { values, error: null };
}

export function currentStallRules() {
  const demand = demandResult();
  const base = { ...(state.stallRules || {}) };
  const legalStalls = demand.legalStalls || 0;
  const ecoAuto = Boolean(demand.ecoAuto);
  return {
    ...base,
    legalStalls,
    ecoAuto,
    ecoBasis: demand.ecoBasis || "",
    disabledRate: Number(base.disabledRate) || 0.04,
    ecoRate: Number(base.ecoRate) || 0.05,
    parallel: base.parallel !== false,
  };
}

export function updateSiteMargins(all, partial) {
  if (all != null && Number.isFinite(Number(all))) {
    state.siteMargin = Math.max(0, Number(all));
  }
  if (partial && typeof partial === "object") {
    state.siteMargins = { ...(state.siteMargins || {}), ...partial };
  }
  syncPlateMeta();
  emit();
}

/** 이격·램프 형태 등 UI 상태를 plate에 동기화(도면 점선·재배치에 필요). */
export function syncPlateMeta() {
  if (!state.plate) return;
  state.plate = {
    ...state.plate,
    siteMargin: round1(state.siteMargin),
    siteMargins: { ...(state.siteMargins || {}) },
    rampForm: state.rampForm || "auto",
    lowerRampForm: state.lowerRampForm || "auto",
    lowerRampMode: state.lowerRampMode || "alternate",
    lowerRampOverrides: { ...(state.lowerRampOverrides || {}) },
    roadEdge: state.roadEdge || "w",
    rampPos: state.rampPos || "auto",
    pruneFragments: state.pruneFragments !== false,
  };
}

/** 법정 구획 부족을 전체 층(층당 × 층수) 기준으로 계산. 예: ["확장형 20/27 (층당 4/6)"] */
export function totalStallShortages(metrics) {
  const per = metrics && metrics.stallTypes;
  if (!per || !per.total) return [];
  const required = demandResult().legalStalls || 0;
  const floors = Math.max(1, basementCount(required, per.total) || 1);
  const total = per.total * floors;
  const t = stallRuleTargets({ ...currentStallRules(), placedStalls: total });
  const pt = metrics.stallTargets || {};
  const out = [];
  const chk = (key, label) => {
    const have = (per[key] || 0) * floors;
    const need = t[key] || 0;
    if (need > have) out.push(`${label} ${have}/${need}${floors > 1 ? ` (층당 ${per[key] || 0}/${pt[key] ?? "?"})` : ""}`);
  };
  chk("disabled", "장애인전용");
  chk("extended", "확장형");
  chk("eco", "친환경차");
  return out;
}

export function issueGroups() {
  const errors = [];
  const warnings = [];
  let hasColumnIssue = false;
  let hasNetworkIssue = false;
  let stallTypeDone = false;
  for (const issue of state.issues || []) {
    // 법정 구획(장애인·확장형·친환경)은 층당이 아니라 전체 층 기준으로 다시 판단해 한 줄로
    if (issue.type === "stallType") {
      if (!stallTypeDone) {
        stallTypeDone = true;
        const tot = totalStallShortages(state.metrics);
        if (tot.length) errors.push(`법정 구획 부족(전체 층): ${tot.join(" · ")}`);
      }
      continue;
    }
    const label = issue.label || issue.message || String(issue.type || issue);
    // 대지·겹침·안내: 3D 보기는 가능 — 경고로만 표시
    if (
      issue.type === "notice"
      || issue.type === "warn"
      || issue.type === "roadless"
      || issue.type === "site"
      || issue.type === "overlap"
      || issue.type === "slope"
    ) {
      warnings.push(label);
      continue;
    }
    if (issue.type === "column") hasColumnIssue = true;
    // 동선·램프·출입 이슈는 3D를 막지 않음 — 경고로만
    if (issue.type === "opening" || issue.type === "ramp" || issue.type === "network" || issue.type === "road") {
      hasNetworkIssue = true;
      warnings.push(label);
      continue;
    }
    errors.push(label);
  }
  // metrics.columnHits는 이미 type:"column" 이슈로 들어가므로 중복 문구를 넣지 않는다.
  if (!hasColumnIssue && state.metrics && state.metrics.columnHits > 0) {
    warnings.push(`기둥이 주차칸과 ${state.metrics.columnHits}곳 겹칩니다.`);
  }
  // 동선 끊김은 3D 보기를 막지 않고 경고로 둔다(readyFor3d는 칸·램프·코어만 본다).
  if (hasNetworkIssue || (state.metrics && state.metrics.connected === false)) {
    warnings.push("차로가 하나로 이어지지 않거나 배치에 주의가 필요합니다.");
  }
  return { errors, warnings };
}

export function rampFallback(plate) {
  // 도로변 내부 램프가 전부 불가일 때 옆 변 끝 후보(원본 휴리스틱의 축소판)
  if (!plate) return null;
  const edge = plate.roadEdge || state.roadEdge || "w";
  const side = edge === "n" || edge === "s" ? "w" : "s";
  return { edge: side, t: 8, note: "도로 쪽 끝" };
}

export function autoPlaceCore() {
  if (!state.plate) return;
  const core = defaultCore(state.plate);
  state.cores = [clampCore(core, state.plate)];
  state.coreIndex = 0;
  syncCore();
  state.coreAuto = true;
  state.coreSet = false;   // 자동 자리: 추천 때 엔진이 다듬어도 됨
  rebuildLayout();
  emit();
}

function syncCore() {
  state.core = state.cores[state.coreIndex] || state.cores[0] || null;
  if (state.core && state.coreIndex >= state.cores.length) state.coreIndex = 0;
}

/**
 * 램프에 모듈 사슬이 없으면 migrateLegacy로 채운다. 원래 값은 ramp.legacy에 남긴다.
 * 사슬이 바뀌면 analyzeOnPlate로 edge/t/placement를 맞춘다.
 */
export function ensureModules(ramp, plate) {
  if (!ramp || !plate) return ramp;
  const legal = Number(plate.legalStalls) || Number(plate.stallRules?.legalStalls) || 0;
  const floors = Math.max(1, basementCount(
    Number(state.demand?.required) || legal || 0,
    Math.max(1, Number(state.metrics?.stalls) || 50),
  ));
  let next = ramp;
  if (!Array.isArray(ramp.modules) || !ramp.modules.length) {
    let shape = null;
    try { shape = rampShape(ramp, plate); } catch (e) { shape = null; }
    next = migrateLegacy(ramp, plate, shape);
    if (!next.levels) next.levels = floors;
  }
  const { ramp: synced } = applyPlateMeta(next, plate, { legalStalls: legal });
  return synced;
}

/** 사슬이 legacy를 다시 migrate한 결과와 같으면 true → 엔진·3D는 예전 경로 사용. */
export function isLegacyEquivalent(ramp, plate) {
  if (!ramp?.legacy || !plate) return false;
  let shape = null;
  try { shape = rampShape(ramp.legacy, plate); } catch (e) { shape = null; }
  return modulesLegacyEq(ramp, plate, shape);
}

function ensureStateRamps() {
  if (!state.plate || !state.ramps?.length) return;
  state.ramps = state.ramps.map((r) => ensureModules(r, state.plate));
}

function adopt(result, keepObjects) {
  state.stalls = result.stalls;
  state.aisles = result.aisles;
  state.columns = result.columns;
  state.drives = result.drives;
  state.route = result.route;
  state.issues = result.issues || [];
  state.columnConflicts = result.columnConflicts || [];
  state.clearance = result.clearance || null;
  state.metrics = result.metrics;
  state.connected = Boolean(result.metrics.valid);
  state.gridX = result.gridX;
  state.gridY = result.gridY;
  state.axis = result.axis;
  state.fixedAlong = result.fixedAlong;
  state.flexAlong = result.flexAlong;
  state.spec = result.spec;
  if (!keepObjects) {
    state.cores = result.cores;
    state.openings = result.openings;
    state.ramps = (result.ramps || []).map((r) => ensureModules(r, result.plate || state.plate));
    state.coreIndex = Math.min(state.coreIndex, Math.max(0, state.cores.length - 1));
    syncCore();
  }
  appendTransferNotes();
}

function appendTransferNotes() {
  if (state.siteType !== "complex" || !state.buildings.length) return;
  const notes = towerTransferNotes(state.buildings, state.cores, state.columns);
  notes.forEach((note) => {
    state.issues.push({ type: "notice", label: note.label });
  });
}

export function refreshVariants(quick = false) {
  if (!state.plate) return;
  ensureStateRamps();
  state.variants = generateVariants({
    plate: state.plate,
    cores: state.cores,
    openings: state.openings,
    ramps: state.ramps,
    rampPlacement: state.rampPlacement,
    entranceMode: state.entranceMode,
    circulation: state.circulation,
    quick: Boolean(quick),
    // 사용자가 찍은 램프 시작점은 엔진이 옮기지 않음
    lockRamp: Boolean(state.rampStartSet),
    lockCores: Boolean(state.coreSet),
  });
}

export function applyVariant(index) {
  const variant = state.variants[index];
  if (!variant) return;
  state.variantIndex = index;
  // 기둥 간격 자동으로 고른 안이면 그 격자를 상태에도 반영(이후 평면·도면·3D가 같은 격자)
  if (variant.grid) {
    state.spansX = variant.grid.sx.join(", ");
    state.spansY = variant.grid.sy.join(", ");
    state.plate = { ...state.plate, spansX: variant.grid.sx.slice(), spansY: variant.grid.sy.slice() };
  }
  adopt(variant, false);
  emit();
}

/**
 * 램프·코어 위치를 유지한 채 배치안을 다시 돌려 최적 주차 배치를 고른다.
 * (베이 방향·packFrom 등 variantSpecs를 모두 비교)
 * @param {{ refresh?: boolean }} [opts] refresh=false면 후보 목록(generateVariants)을 다시 돌리지 않는다.
 */
export function optimizeLayout({ refresh = true } = {}) {
  if (!state.plate) return;
  syncPlateMeta();
  if (state.siteType === "complex" && state.buildings.length) {
    state.plate = {
      ...state.plate,
      buildings: state.buildings,
      blockRects: towerBlockRects(state.buildings, state.cores, state.plate),
    };
  }
  // 램프 form을 현재 설정에 맞춤
  state.ramps = (state.ramps || []).map((r) => ({
    ...r,
    placement: state.rampPlacement,
    form: state.rampForm || r.form || "auto",
  }));
  const best = bestLayoutFor({
    plate: state.plate,
    cores: state.cores,
    openings: state.openings,
    ramps: state.ramps,
    rampPlacement: state.rampPlacement,
    entranceMode: state.entranceMode,
    circulation: state.circulation,
    lockRamp: true,
    lockCores: Boolean(state.coreSet),
    noCoreRescue: true,
    spec: state.spec && state.spec.engine === "loopFirst" ? state.spec : undefined,
  });
  if (best) {
    adopt(best, true);
    state.spec = best.spec || state.spec;
  }
  // UI 후보 목록도 갱신(램프 형태만 바꿀 때는 생략해 응답을 빠르게)
  if (refresh) refreshVariants();
}

/** 셸에서도 코어 내부(승강기·계단) 미리보기를 붙인다. */
function attachCoreInteriorsPreview() {
  const aisles = state.aisles || [];
  const blocks = state.plate?.blockRects || [];
  state.cores = (state.cores || []).map((core) => {
    const doorSide = pickCoreDoorSide(core, aisles, blocks);
    const interior = core.kind === "stair"
      ? stairCoreInterior(core, doorSide)
      : coreInterior(core, doorSide);
    return { ...core, doorSide, interior };
  });
}

/** 셸 단계에서 코어가 램프 점유·동선을 막지 않게 밀어, 사면 차로 자리를 남긴다. */
function clearCoresFromRamps() {
  if (!state.plate || !(state.ramps && state.ramps.length) || !(state.cores && state.cores.length)) return;
  const buildings = state.siteType === "complex" ? state.buildings : null;
  state.cores = nudgeCoresClearOfRamps(state.cores, state.ramps, state.plate, buildings, { free: true, keepGrid: state.coreSnap !== false && state.siteType !== "complex" });
  if (state.siteType === "complex" && state.buildings.length) {
    const stairs = state.cores.filter((c) => c.kind === "stair");
    const spaced = spaceCoresForTowers(state.cores, state.buildings, state.plate);
    state.cores = spaced.filter((c) => (c.kind || "building") !== "stair").concat(stairs);
    state.cores = nudgeCoresClearOfRamps(state.cores, state.ramps, state.plate, state.buildings, { free: true });
    state.plate.blockRects = towerBlockRects(state.buildings, state.cores, state.plate);
  }
  attachCoreInteriorsPreview();
  syncCore();
}

export function rebuildLayout() {
  // 5·6 셸(주차 미생성)에서는 배치는 돌리지 않고, 코어·램프 겹침만 정리
  if (!(state.stalls && state.stalls.length) && !(state.variants && state.variants.length)) {
    clearCoresFromRamps();
    return;
  }
  // 추천을 한 번 돌린 뒤 코어 단계로 돌아와 끌 때도 램프 면에 붙이고 겹침 정리(전엔 이 경우 안 붙었음)
  clearCoresFromRamps();
  // 호환: 단일 배치 대신 최적 재탐색
  optimizeLayout();
}

function seedAccess() {
  const edge = state.roadEdge || "w";
  const along = edge === "n" || edge === "s" ? state.plate.width : state.plate.depth;
  const pos = state.rampPos && state.rampPos !== "auto" ? state.rampPos : undefined;
  if (!state.ramps.length) {
    state.ramps = [{
      id: state.nextId++,
      edge,
      t: round1(along / 2),
      width: state.rampWidth,
      length: defaultRampLength(state.plate, edge),
      placement: state.rampPlacement,
      form: state.rampForm || "auto",
      ...(pos ? { pos } : {}),
    }];
  } else {
    state.ramps = state.ramps.map((ramp) => {
      const next = {
        ...ramp,
        edge: edge || ramp.edge,
        placement: state.rampPlacement,
        form: state.rampForm || ramp.form || "auto",
      };
      if (pos) next.pos = pos;
      else delete next.pos;
      // edge/placement가 바뀌면 사슬을 legacy에서 다시 맞춤
      if (next.modules && (next.edge !== ramp.edge || next.placement !== ramp.placement)) {
        delete next.modules;
        delete next.x;
        delete next.y;
        delete next.heading;
        delete next.legacy;
      }
      return next;
    });
  }
  if (state.plate) state.ramps = state.ramps.map((r) => ensureModules(r, state.plate));
}

function clearParkingGeometry() {
  state.stalls = [];
  state.aisles = [];
  state.columns = [];
  state.drives = [];
  state.route = null;
  state.issues = [];
  state.columnConflicts = [];
  state.clearance = null;
  state.metrics = null;
  state.connected = false;
  state.variants = [];
  state.variantIndex = 0;
  state.gridX = null;
  state.gridY = null;
  state.axis = null;
  state.fixedAlong = null;
  state.flexAlong = null;
  state.spec = null;
}

/**
 * 평면·코어·램프만 준비한다(주차 칸·후보는 만들지 않음).
 * 5·6단계에서 사용자가 램프·코어를 지정할 때 쓴다.
 * @param {{ replaceCores?: boolean }} [opts] replaceCores=false면 기존 코어 위치를 유지한다.
 */
export function preparePlateShell(opts = {}) {
  const replaceCores = opts.replaceCores !== false;
  const notes = [];
  state.plate = plateFromState();
  if (state.siteType === "complex") {
    // 동 외곽(blockUnder)까지 넣으면 80×58로는 타워가 겹쳐 배치가 망가진다 → 동 수·타워에 맞게 키운다.
    const n = Math.max(1, state.buildings.length || state.cores.filter((c) => (c.kind || "building") !== "stair").length || 3);
    const tw = Math.max(DEFAULT_TOWER_W, ...state.buildings.map((b) => Number(b.tower?.w) || DEFAULT_TOWER_W));
    const td = Math.max(DEFAULT_TOWER_D, ...state.buildings.map((b) => Number(b.tower?.d) || DEFAULT_TOWER_D));
    const minW = n >= 3 ? Math.max(98, Math.ceil(tw * 2 + 40)) : n >= 2 ? Math.max(70, Math.ceil(tw + 40)) : 48;
    const minD = n >= 3 ? Math.max(66, Math.ceil(td * 2 + 28)) : n >= 2 ? Math.max(54, Math.ceil(td + 36)) : 42;
    if (state.parkWidth < minW || state.parkDepth < minD) {
      state.parkWidth = Math.max(state.parkWidth, minW);
      state.parkDepth = Math.max(state.parkDepth, minD);
      state.plate = plateFromState();
      notes.push(`단지형 동 ${n}개·동 외곽에 맞춰 평면을 ${state.parkWidth}×${state.parkDepth}m로 키웠습니다.`);
    }
  }
  const complexPlate = () => ({
    ...state.plate,
    expectTowerW: Math.max(DEFAULT_TOWER_W, ...state.buildings.map((b) => Number(b.tower?.w) || 0)),
    expectTowerD: Math.max(DEFAULT_TOWER_D, ...state.buildings.map((b) => Number(b.tower?.d) || 0)),
  });
  if (replaceCores && state.siteType !== "complex") state.corePlaced = false;
  if (!state.cores.length) {
    if (state.siteType === "complex" && state.buildings.length) {
      linkBuildingsToCores(defaultCores(complexPlate(), state.buildings.length));
    } else {
      state.cores = [defaultCore(state.plate)];
    }
  } else if (replaceCores && state.siteType === "complex" && state.buildings.length) {
    // 평면 만들기 때 동 코어를 타워 footprint 간격으로 다시 고르게 둔다(계단 코어는 유지).
    const stairs = state.cores.filter((c) => c.kind === "stair").map((c) => clampCore(c, state.plate));
    linkBuildingsToCores(defaultCores(complexPlate(), state.buildings.length));
    state.cores = state.cores.concat(stairs);
  }
  state.cores = state.cores.map((core) => clampCore(core, state.plate));
  if (state.siteType === "complex" && state.buildings.length) {
    // 기존 코어가 타워끼리 겹치면 밀어 간격을 확보한 뒤 다시 clamp.
    const stairs = state.cores.filter((c) => c.kind === "stair");
    const spaced = spaceCoresForTowers(state.cores, state.buildings, state.plate);
    state.cores = spaced.filter((c) => (c.kind || "building") !== "stair").concat(stairs);
    // 타워 dx/dy를 현재 코어 크기에 맞게 재정렬(옛 30m 타워 잔존 방지).
    state.buildings.forEach((b) => {
      const core = state.cores.find((c) => c.buildingId === b.id && (c.kind || "building") !== "stair");
      if (!core || !b.tower) return;
      if (b.tower.w >= 28) {
        b.tower = defaultTower(core.w, core.d, DEFAULT_TOWER_W, DEFAULT_TOWER_D);
      } else {
        b.tower.dx = -(b.tower.w - core.w) / 2;
        b.tower.dy = -(b.tower.d - core.d) / 2;
      }
    });
  }
  syncCore();
  if (state.siteType === "complex") {
    state.plate.blockRects = towerBlockRects(state.buildings, state.cores, state.plate);
    state.plate.buildings = state.buildings;
    const rampNote = ensureComplexRampFits();
    if (rampNote) notes.push(rampNote);
  }
  seedAccess();
  // 램프 점유와 겹치는 코어를 밀어 동선이 막히지 않게 한다(면에 접하도록).
  clearCoresFromRamps();
  state.referenceNotes = notes;
  state.step = 2;
  state.revealStage = 6;
  state.tool = "core";
  clearParkingGeometry();
  emit();
}

/**
 * 주차장 평면을 만든다.
 * @param {{ recommend?: boolean }} [opts] recommend=false면 후보 목록 없이 초안만(램프·코어 편집용).
 */
export function generatePlate(opts = {}) {
  preparePlateShell({ replaceCores: true });
  // recommend=false: 단일 초안 배치(호환). 마법사는 5·6에 shell만, 7에서 recommendLayouts.
  if (opts.recommend === false) {
    optimizeLayout({ refresh: false });
    if (!(state.stalls && state.stalls.length)) {
      const one = layoutParking({
        plate: state.plate,
        cores: state.cores,
        openings: state.openings,
        ramps: state.ramps,
        rampPlacement: state.rampPlacement,
        entranceMode: state.entranceMode,
        circulation: state.circulation,
        lockRamp: true,
        noCoreRescue: true,
      });
      if (one) adopt(one, true);
    }
    emit();
    return;
  }
  refreshVariants();
  const best = Math.max(0, state.variants.findIndex((variant) => variant.recommended));
  applyVariant(best);
  // 마법사 슬라이드는 main.js가 유지한다(생성 후 램프 단계에 머묾).
}

/** 7단계: 램프·코어를 고정한 채 추천 후보를 다시 찾는다. */
export function recommendLayouts() {
  if (!state.plate) preparePlateShell();
  else syncPlateMeta();
  // 기둥 격자는 코어 단계에서 이미 골랐음 → 여기선 그 격자로 주차 배치만
  refreshVariants();
  const best = Math.max(0, state.variants.findIndex((variant) => variant.recommended));
  applyVariant(best >= 0 ? best : 0);
}

// ── 기둥 간격 자동 ──
// 칸 폭 방향: 2대 5.5 · 3대 8.1 · 4대 10.5 / 칸 깊이 방향: 칸 5.2 + 차로 절반 3 = 8.2
const GRID_SPANS = [5.5, 8.1, 10.5];
function spanText(seq) {
  if (!seq || !seq.length) return "기본 8.1";
  const counts = [];
  seq.forEach((v) => {
    const last = counts[counts.length - 1];
    if (last && last.v === v) last.n += 1; else counts.push({ v, n: 1 });
  });
  return counts.map((c) => (c.n > 1 ? `${c.v}×${c.n}` : `${c.v}`)).join("·");
}
/** 간격 줄 → 실제 칸 길이들(마지막 자투리 합치기 포함, 엔진 gridLinesFrom과 같은 규칙) */
function spansOver(seq, L, base = 8.1) {
  const list = seq && seq.length ? seq : [base];
  const lines = [0];
  let cur = 0;
  for (let i = 0; ; i += 1) {
    cur += list[Math.min(i, list.length - 1)];
    if (cur >= L - 0.2) break;
    lines.push(cur);
  }
  const rest = L - lines[lines.length - 1];
  if (rest > 0.2) { if (rest < 2.5 && lines.length > 1) lines[lines.length - 1] = L; else lines.push(L); }
  const out = [];
  for (let i = 1; i < lines.length; i += 1) out.push(lines[i] - lines[i - 1]);
  return out;
}
/** 한 방향에 칸 폭 2.5m 칸이 몇 개 들어가는지 어림(기둥 0.5m + 여유 0.1m 빼고) */
function slotEstimate(seq, L) {
  return spansOver(seq, L).reduce((n, sp) => n + Math.max(0, Math.floor((sp - 0.6) / 2.5)), 0);
}
/** 한 방향 길이 L의 후보: 일정 간격 3개 + 섞은 간격(어림 칸 수 많은 순) */
export function axisGridCandidates(L) {
  // 간격은 항상 명시(빈 값이면 엔진이 배치마다 기둥 줄을 달리 잡아 코어와 어긋남)
  const uni = [{ seq: [8.1], label: "8.1 반복", kind: "u" }, { seq: [10.5], label: "10.5 반복", kind: "u" }, { seq: [8.2], label: "8.2 반복", kind: "u" }];
  const mixes = [];
  for (let a = 0; a <= 3; a += 1) {
    for (let d = 0; d <= 5; d += 1) {
      for (let b = 0; b <= 10; b += 1) {
        const S = a * GRID_SPANS[0] + b * GRID_SPANS[1] + d * GRID_SPANS[2];
        if (S <= 0 || S > L - 0.2 || L - S > 1.6 || a + d === 0) continue;
        const mid = Array(b).fill(GRID_SPANS[1]);
        const odd = Array(d).fill(GRID_SPANS[2]).concat(Array(a).fill(GRID_SPANS[0]));
        [mid.concat(odd), odd.slice().reverse().concat(mid)].forEach((seq, k) => {
          if (k === 1 && !b) return;
          mixes.push({ seq, label: spanText(seq), kind: "m", slots: slotEstimate(seq, L), odd: a + d, rest: L - S });
        });
      }
    }
  }
  mixes.sort((p, q) => q.slots - p.slots || p.odd - q.odd || p.rest - q.rest);
  const seen = new Set();
  const top = [];
  for (const m of mixes) {
    if (seen.has(m.label)) continue;
    seen.add(m.label);
    top.push(m);
    if (top.length >= 5) break;
  }
  return uni.concat(top);
}
/**
 * 벽에서 띄운 일정 간격: 첫·끝 기둥 줄을 벽에서 o만큼 안쪽으로(그 사이는 외벽·캔틸레버로 받음, 6m 이하).
 * 기둥 줄이 평면 가운데에 오게 양쪽 띄움을 같게 한다.
 */
export function centeredGrid(s, L) {
  // L: 기둥 격자를 까는 안쪽 길이(벽 두께 뺀 길이). 끝 띄움이 2.5m 미만이면 마지막 줄이 벽으로 합쳐지므로 2.5m 이상만
  if (!(s > 0) || !(L > s)) return null;
  for (let k = Math.floor(L / s); k >= 1; k -= 1) {
    const o = Math.round(((L - k * s) / 2) * 10) / 10;
    if (o > 6) break;          // 캔틸레버 6m 넘으면 안 됨
    if (o < 2.5) continue;
    return { seq: [o, s], label: `${s} 반복 (벽에서 ${o}m 띄움)` };
  }
  return null;
}

/** 돌려 볼 가로×세로 조합(어림으로 미리 걸러냄) */
export function gridCombos(plate = state.plate) {
  const xs = axisGridCandidates(plate.width);
  const ys = axisGridCandidates(plate.depth);
  const out = [];
  xs.forEach((cx, i) => ys.forEach((cy, j) => {
    // 섞음×섞음은 각 방향 상위 2개끼리만
    if (cx.kind === "m" && cy.kind === "m" && (i > 4 || j > 4)) return;
    out.push({ cx: { seq: cx.seq, label: cx.label }, cy: { seq: cy.seq, label: cy.label } });
  }));
  return out;
}
let gridBasePlate = null;
function plateWithSpans(sx, sy) {
  return { ...(gridBasePlate || state.plate), spansX: sx.slice(), spansY: sy.slice() };
}
function bestValid(variants) {
  let best = null;
  (variants || []).forEach((v) => {
    const m = v.metrics || {};
    const score = (m.valid ? 100000 : 0) + (m.stalls || 0) * 100 - (Number(m.areaPerStall) || 99);
    if (!best || score > best.score) best = { v, score };
  });
  return best;
}
/** 새 코어 후보 자리들을 빠르게 계산해 점수(작업자 여러 개가 나눠서 부름). state.cores = 이미 놓은 코어들 */
export function scoreCoreSpots(cands) {
  const others = (state.cores || []).slice();
  const out = [];
  (cands || []).forEach((c) => {
    state.cores = others.concat([{ ...c, kind: "building", grid: true }]);
    state.coreSet = true;
    try {
      refreshVariants(true);
      const b = bestValid(state.variants);
      if (b) out.push({ x: c.x, y: c.y, score: b.score, stalls: b.v.metrics.stalls || 0, valid: Boolean(b.v.metrics.valid) });
    } catch (e) { /* 이 자리는 건너뜀 */ }
  });
  state.cores = others;
  state.gridResults = out;
}
/** 조합들을 빠르게 계산해 점수(작업자 여러 개가 나눠서 부름) */
export function scoreGridBatch(combos) {
  const base = state.plate;
  gridBasePlate = base;
  const out = [];
  (combos || []).forEach((c) => {
    try {
      state.plate = plateWithSpans(c.cx.seq, c.cy.seq);
      refreshVariants(true);
      const b = bestValid(state.variants);
      // 화면으로 돌려보내는 건 점수·코어 자리만(배치 전체를 보내면 큰 평면에서 화면이 멈춤)
      if (b) out.push({ cx: c.cx, cy: c.cy, score: b.score, stalls: b.v.metrics.stalls || 0, valid: Boolean(b.v.metrics.valid), cores: (b.v.cores || []).map((k) => { const { interior, ...rest } = k; return rest; }) });
    } catch (e) { /* 이 조합 건너뜀 */ }
  });
  state.plate = base;
  gridBasePlate = null;
  state.gridResults = out;
  return out;
}
/** 확인 단계: 엔진이 고른 코어를 격자 칸에 맞춘 뒤(코어 고정) 다시 계산 → 실제로 놓일 모양의 대수 */
export function verifyGridBatch(items) {
  const base = state.plate;
  const baseCores = state.cores;
  gridBasePlate = base;
  const out = [];
  (items || []).forEach((c) => {
    try {
      state.plate = plateWithSpans(c.cx.seq, c.cy.seq);
      const start = (c.cores && c.cores.length === baseCores.length)
        ? c.cores.map((k, i) => ({ ...baseCores[i], x: k.x, y: k.y, w: k.w, d: k.d }))
        : baseCores.map((k) => ({ ...k }));
      // 첫 코어는 가까운 격자 자리 3곳까지 시도(검사 통과하는 자리 우선), 나머지 코어는 가장 가까운 칸
      const keep = rampKeepOut(state.ramps, state.plate);
      const firstOpts = start.length ? snapCoreToCells(start[0], state.plate, keep, [], { all: 3 }) : [];
      let pick = null;
      for (const first of (firstOpts.length ? firstOpts : [start[0]])) {
        state.cores = start.map((k, i) => (i === 0 ? first : k));
        if (state.cores.length > 1) {
          const placed = [state.cores[0]];
          state.cores = [state.cores[0]].concat(state.cores.slice(1).map((k) => { const n = clampCore(snapCoreToCells(k, state.plate, keep, placed), state.plate); placed.push(n); return n; }));
        }
        state.cores = state.cores.map((k) => clampCore(k, state.plate));
        state.coreSet = true;
        refreshVariants(true);
        const b = bestValid(state.variants);
        if (b && (!pick || b.score > pick.score)) pick = { score: b.score, stalls: b.v.metrics.stalls || 0, valid: Boolean(b.v.metrics.valid), cores: state.cores.map((k) => { const { interior, ...rest } = k; return rest; }) };
        if (b && b.v.metrics && b.v.metrics.valid) break;
      }
      if (pick) out.push({ cx: c.cx, cy: c.cy, ...pick });
    } catch (e) { /* 건너뜀 */ }
  });
  state.plate = base;
  state.cores = baseCores;
  gridBasePlate = null;
  state.gridResults = out;
  return out;
}
/** 한 격자를 전체 후보(부가 안 포함)로 */
export function fullGridVariants(combo) {
  const base = state.plate;
  gridBasePlate = base;
  try {
    state.plate = plateWithSpans(combo.cx.seq, combo.cy.seq);
    refreshVariants(false);
    state.gridResults = [{ cx: combo.cx, cy: combo.cy, variants: state.variants, score: (bestValid(state.variants) || {}).score || 0 }];
  } finally {
    state.plate = base;
    gridBasePlate = null;
  }
  return state.gridResults;
}
/** 점수 결과 → 서로 다른 격자 상위 3개로 추천 목록 만들고 1등 적용 */
export function adoptGridResults(scored, fullByKey = {}) {
  const key = (r) => `${r.cx.label}|${r.cy.label}`;
  const sorted = (scored || []).slice().sort((p, q) => q.score - p.score);
  const top = sorted.slice(0, 3);
  const all = [];
  top.forEach((t, gi) => {
    const full = fullByKey[key(t)];
    const vs = full && full.length ? full : (t.variants || []);
    vs.forEach((v) => {
      all.push({
        ...v,
        recommended: false,
        id: `${"ABC"[gi] || ""}-${v.id}`,
        grid: { sx: t.cx.seq, sy: t.cy.seq, label: `가로 ${t.cx.label} × 세로 ${t.cy.label}`, rank: gi },
      });
    });
  });
  state.gridResults = null;
  if (!all.length) return false;
  const bestAll = bestValid(all);
  const bi = all.indexOf(bestAll.v);
  all[bi] = { ...all[bi], recommended: true };
  state.variants = all;
  applyVariant(bi);
  return true;
}
/** 모든 코어를 지금 격자 칸에 맞춤 */
export function snapAllCores() {
  if (!state.plate || state.siteType === "complex") return;
  const keep = rampKeepOut(state.ramps, state.plate);
  const placed = [];
  state.cores = state.cores.map((c) => {
    const n = clampCore(snapCoreToCells(c, state.plate, keep, placed), state.plate);
    placed.push(n);
    return n;
  });
  syncCore();
}
/** 코어 단계에서 기둥 격자 후보 i번을 고름 → 평면 격자 바꾸고 코어를 새 격자 칸에 맞춤 */
export function applyGridChoice(i) {
  const opt = state.gridOptions && state.gridOptions[i];
  if (!opt) return;
  state.gridChosen = i;
  state.spansX = opt.cx.seq.join(", ");
  state.spansY = opt.cy.seq.join(", ");
  state.plate = { ...state.plate, spansX: opt.cx.seq.slice(), spansY: opt.cy.seq.slice() };
  // 그 격자에서 대수가 잘 나온 코어 자리로 옮겨 놓고(코어 수가 같을 때) 격자 칸에 맞춤 — 그다음 사용자가 옮길 수 있음
  const sameSize = opt.cores && opt.cores.length === state.cores.length
    && opt.cores.every((c, k) => Math.abs(c.w - state.cores[k].w) < 0.05 && Math.abs(c.d - state.cores[k].d) < 0.05);
  if (sameSize) {
    state.cores = opt.cores.map((c, i) => ({ ...state.cores[i], x: c.x, y: c.y, w: c.w, d: c.d }));
    syncCore();   // 엔진이 이미 격자에 맞춘 자리
  } else snapAllCores();
  if (state.corePlaced) state.coreSet = true;
  rebuildLayout();
  emit();
}
/** 코어 단계: 코어 크기(m)만 바꿈 — 아직 안 놓았으면 위치 계산 없이 크기만 */
export function setCoreSize(w, d) {
  const core = state.cores[state.coreIndex];
  if (!core) return;
  const W = Number(w); const D = Number(d);
  if (!(W >= 3 && W <= 30 && D >= 3 && D <= 30)) return;
  if (state.corePlaced) { updateCore({ w: W, d: D }); return; }
  state.cores[state.coreIndex] = { ...core, w: W, d: D };
  syncCore();
  emit();
}
/** 코어 단계: 정한 크기(m)로 코어 하나 추가 — 크기 그대로 기둥 줄에 맞춰, 다른 코어·램프와 안 겹치는 가까운 자리 */
function coreSpotFor(W, D) {
  const fresh = !state.corePlaced;
  const keep = rampKeepOut(state.ramps, state.plate);
  const others = fresh ? [] : state.cores.slice();
  let seed = { x: state.plate.width / 2 - W / 2, y: state.plate.depth / 2 - D / 2 };
  const opt = state.gridOptions && state.gridOptions[state.gridChosen];
  if (fresh && opt && opt.cores && opt.cores[0]) {
    const o = opt.cores[0];
    seed = { x: o.x + o.w / 2 - W / 2, y: o.y + o.d / 2 - D / 2 };
  }
  const core = clampCore({ ...seed, w: W, d: D, kind: "building", grid: true }, state.plate);
  return clampCore(snapCoreToCells(core, state.plate, keep, others), state.plate);
}
/** 「코어 추가」를 누르면 놓일 자리 미리보기(상태는 안 바꿈) */
export function previewCoreSized(w, d) {
  if (!state.plate) return null;
  const W = Number(w); const D = Number(d);
  if (!(W >= 3 && W <= 30 && D >= 3 && D <= 30)) return null;
  try { const c = coreSpotFor(W, D); return { x: c.x, y: c.y, w: c.w, d: c.d }; } catch (e) { return null; }
}
export function addCoreSized(w, d, spec = null, at = null) {
  if (!state.plate) return false;
  const W = Number(w); const D = Number(d);
  if (!(W >= 3 && W <= 30 && D >= 3 && D <= 30)) return false;
  const fresh = !state.corePlaced;
  const core = at ? clampCore({ x: at.x, y: at.y, w: W, d: D, kind: "building", grid: true }, state.plate) : coreSpotFor(W, D);
  if (spec) core.spec = { ...spec };
  state.corePreview = null;
  state.cores = fresh ? [core] : state.cores.concat([core]);
  state.coreIndex = state.cores.length - 1;
  state.corePlaced = true;
  state.coreSet = true;
  syncCore();
  state.selection = { type: "core", index: state.coreIndex };
  rebuildLayout();
  emit();
  return true;
}
/** 고른 코어 안 승강기·계단 크기 정하기 (spec=null이면 자동으로) */
export function setCoreSpec(index, spec) {
  const core = state.cores[index];
  if (!core) return;
  const next = { ...core };
  if (spec) next.spec = { ...spec }; else delete next.spec;
  // 크기가 바뀌면 끌어 옮긴 승강기·계단 자리는 초기화(문 자리는 유지)
  if (next.interiorEdit) next.interiorEdit = { door: next.interiorEdit.door, items: {} };
  delete next.interior;
  state.cores[index] = next;
  state.coreIndex = index;
  syncCore();
  rebuildLayout();
  emit();
}
/** 고른 코어 출입문을 한 면(n·s·e·w) 가운데로 — 승강기·계단은 그 반대쪽 벽에 다시 붙음 */
export function setCoreDoor(index, side) {
  const core = state.cores[index];
  if (!core || !["n", "s", "e", "w"].includes(side)) return;
  const next = { ...core, interiorEdit: { door: { side, u: 0.5 }, items: {} } };
  delete next.interior;
  delete next.doorSide;
  state.cores[index] = next;
  state.coreIndex = index;
  syncCore();
  rebuildLayout();
  emit();
}
/** 코어 단계: 코어 하나 지우기 — 마지막 하나면 «아직 안 놓음»으로 */
export function deleteCoreAt(index) {
  if (!state.cores[index]) return;
  if (state.cores.length <= 1) {
    state.corePlaced = false;
    state.coreSet = false;
    emit();
    return;
  }
  state.cores.splice(index, 1);
  state.coreIndex = Math.max(0, Math.min(state.coreIndex, state.cores.length - 1));
  syncCore();
  state.selection = { type: "core", index: state.coreIndex };
  rebuildLayout();
  emit();
}
/** 코어 단계: 「코어 놓기」 — 정한 크기 그대로, 고른 격자에서 대수가 잘 나온 자리 근처 기둥 줄에 맞춰 둠 */
export function placeCoreNow() {
  if (!state.plate || !state.cores.length) return;
  const opt = state.gridOptions && state.gridOptions[state.gridChosen];
  if (opt && opt.cores && opt.cores.length === state.cores.length) {
    // 크기는 그대로, 중심만 그 자리로
    state.cores = state.cores.map((c, k) => {
      const o = opt.cores[k];
      return { ...c, x: o.x + o.w / 2 - c.w / 2, y: o.y + o.d / 2 - c.d / 2 };
    });
  }
  snapAllCores();
  state.corePlaced = true;
  state.coreSet = true;
  state.selection = { type: "core", index: state.coreIndex };
  rebuildLayout();
  emit();
}
/** 격자 후보를 다시 계산해야 하는지(평면·램프가 바뀌었는지) */
export function gridKeyNow() {
  const p = state.plate;
  if (!p) return "";
  const r = (state.ramps || []).map((x) => `${x.edge}:${x.t}:${x.placement}:${x.x}:${x.y}`).join(",");
  return `${p.width}x${p.depth}|${(p.polygon || []).length}|${state.floorHeight}|${state.rampPlacement}|${r}|${state.lowerRampMode}`;
}
/** 점수 결과 → 서로 다른 격자 상위 3개 후보로 저장 */
export function setGridOptions(scored) {
  const sorted = (scored || []).slice().sort((p, q) => q.score - p.score);
  const seen = new Set();
  const opts = [];
  sorted.forEach((r) => {
    const k = `${r.cx.label}|${r.cy.label}`;
    if (seen.has(k) || opts.length >= 3) return;
    seen.add(k);
    const b = r.variants ? bestValid(r.variants) : null;
    opts.push({
      cx: r.cx, cy: r.cy, score: r.score,
      stalls: r.stalls != null ? r.stalls : (b ? (b.v.metrics.stalls || 0) : 0),
      valid: r.valid != null ? r.valid : Boolean(b && b.v.metrics.valid),
      cores: r.cores || (b && b.v.cores ? b.v.cores.map((c) => { const { interior, ...rest } = c; return rest; }) : null),   // 격자 칸에 맞춘 코어 자리
    });
  });
  state.gridOptions = opts;
  state.gridResults = null;
  state.gridKey = gridKeyNow();
}

/** 작업자 없이 한 번에(대체 경로) */
function recommendWithGrids() {
  const base = state.plate;
  const combos = gridCombos(base);
  const scored = scoreGridBatch(combos);
  const top = scored.slice().sort((p, q) => q.score - p.score)[0];
  const full = {};
  if (top) full[`${top.cx.label}|${top.cy.label}`] = fullGridVariants(top)[0].variants;
  state.plate = base;
  if (!adoptGridResults(scored, full)) {
    refreshVariants();
    const best0 = Math.max(0, state.variants.findIndex((variant) => variant.recommended));
    applyVariant(best0 >= 0 ? best0 : 0);
  }
}

export function loadReference() {
  const sample = referenceCase;
  state.siteType = "single";
  state.buildings = [];
  state.parkWidth = sample.width;
  state.parkDepth = sample.depth;
  state.columnSpacing = sample.spacing;
  state.columnWidth = sample.columnWidth;
  state.columnDepth = sample.columnDepth;
  state.minClear = sample.minClear;
  state.siteMargin = sample.siteMargin;
  state.rampPlacement = sample.rampPlacement;
  state.entranceMode = sample.entranceMode;
  state.circulation = sample.circulation;
  state.rampWidth = sample.ramp.width;
  state.rampLength = sample.ramp.length;
  state.entranceWidth = sample.ramp.width;
  state.demand.projectName = sample.projectName;
  state.referenceNotes = sample.notes.slice();
  state.sizeSet = true;
  state.rampStartSet = true;
  state.overlay = {
    url: "assets/reference-basement.png",
    mode: "off",
    opacity: 0.42,
    scale: 1,
    x: 0,
    y: 0,
  };
  state.plate = plateFromState();
  state.cores = sample.cores.map((core) => clampCore({ ...core }, state.plate));
  state.coreIndex = 0;
  syncCore();
  state.openings = [];
  state.ramps = [ensureModules({
    id: state.nextId++,
    ...sample.ramp,
    placement: "external",
  }, state.plate)];
  state.selection = null;
  refreshVariants();
  const best = Math.max(0, state.variants.findIndex((variant) => variant.recommended));
  state.step = 2;
  state.revealStage = 6;
  state.tool = "core";
  applyVariant(best);
}

export function setReveal(stage) {
  state.revealStage = stage;
  emit();
}

export function setStep(step) {
  if (step === 2 && !state.plate) return;
  if (step === 3 && !readyFor3d()) return;
  state.step = step;
  emit();
}

export function readyFor3d() {
  // 동선·램프 경고가 있어도 평면·칸·램프만 있으면 3D를 볼 수 있게 한다(경고는 UI에 남김).
  const hasAccess = (state.openings && state.openings.length > 0) || (state.ramps && state.ramps.length > 0);
  return Boolean(
    state.plate
    && state.cores.length
    && hasAccess
    && state.ramps.length
    && (state.stalls?.length > 0),
  );
}

export function demandResult() {
  return calculateDemand(state.demand, state.plate, state.columnSpacing);
}

export function summary() {
  const plate = state.plate;
  const placed = state.stalls.length;
  const demand = demandResult();
  state.households = demand.households;
  const required = demand.legalStalls;
  const floors = basementCount(required, placed);
  const totalStalls = placed * floors;
  const metrics = state.metrics;
  const buildingFloors = state.buildings.reduce((sum, b) => sum + (b.floors || 0), 0);
  const stairCores = state.cores.filter((c) => c.kind === "stair").length;
  return {
    width: plate ? plate.width : 0,
    depth: plate ? plate.depth : 0,
    plateArea: plate ? plate.width * plate.depth : 0,
    columns: state.columns.length,
    placed,
    required,
    floors,
    totalStalls,
    areaPerStall: placed ? (plate ? (plate.width * plate.depth) / placed : 0) : 0,
    coreArea: state.cores.reduce((sum, core) => sum + core.w * core.d, 0),
    access: accessLabel(),
    fixedAlong: state.fixedAlong,
    flexAlong: state.flexAlong,
    connected: state.connected,
    similarity: metrics ? metrics.similarity : 0,
    aisleRatio: metrics ? metrics.aisleRatio : 0,
    demand,
    siteType: state.siteType,
    buildingCount: state.buildings.length,
    buildingFloors,
    maxBuildingFloors: state.buildings.reduce((m, b) => Math.max(m, b.floors || 0), 0),
    stairCores,
    stallTypes: metrics ? metrics.stallTypes : null,
    stallTargets: metrics ? metrics.stallTargets : null,
    // 법정 구획 비율은 «전체 주차대수» 기준 → 층당 개수 × 층수, 목표도 전체 대수로 다시 계산
    stallTypesTotal: metrics && metrics.stallTypes ? Object.fromEntries(Object.entries(metrics.stallTypes).map(([k, v]) => [k, Number(v) * floors || 0])) : null,
    stallTargetsTotal: metrics && metrics.stallTypes ? stallRuleTargets({ ...currentStallRules(), placedStalls: totalStalls }) : null,
  };
}

export function updateCore(partial) {
  const current = state.cores[state.coreIndex];
  if (!current || !state.plate) return;
  let next = clampCore({ ...current, ...partial }, state.plate);
  if (![next.x, next.y, next.w, next.d].every(Number.isFinite)) return;
  // 코어는 기둥 격자 칸에 맞춰 놓는다(안쪽 배치만 바꿀 때는 그대로)
  if (state.coreSnap !== false && !(partial && partial.interiorEdit) && state.siteType !== "complex") {
    const others = state.cores.filter((c, i) => i !== state.coreIndex);
    next = clampCore(snapCoreToCells(next, state.plate, rampKeepOut(state.ramps, state.plate), others), state.plate);
  }
  state.cores[state.coreIndex] = next;
  state.coreSet = true;
  syncCore();
  state.selection = { type: "core", index: state.coreIndex };
  rebuildLayout();
  emit();
}

export function selectCore(index) {
  if (!state.cores[index]) return;
  state.coreIndex = index;
  syncCore();
  state.selection = { type: "core", index };
  emit();
}

export function addCore() {
  if (state.siteType === "complex") {
    addBuilding();
    return;
  }
  if (!state.plate) return;
  // 겹치지 않게 빈 자리에 둔다(기존 +2m 스택 버그 수정).
  const placed = defaultCores(state.plate, state.cores.length + 1);
  const next = placed[placed.length - 1];
  next.kind = "building";
  state.cores.push(clampCore(next, state.plate));
  state.corePlaced = true;
  state.coreIndex = state.cores.length - 1;
  syncCore();
  rebuildLayout();
  emit();
}

const DEFAULT_TOWER_W = 22;
const DEFAULT_TOWER_D = 14;

function makeBuilding(index, core) {
  const name = `${101 + index}동`;
  const tower = defaultTower(core.w, core.d, DEFAULT_TOWER_W, DEFAULT_TOWER_D);
  return {
    id: state.nextId++,
    name,
    floors: 15,
    floorHeight: 2.9,
    tower,
    blockUnder: true,
  };
}

function linkBuildingsToCores(cores) {
  const list = cores.map((c) => ({ ...c, kind: c.kind || "building" }));
  while (state.buildings.length < list.length) {
    state.buildings.push(makeBuilding(state.buildings.length, list[state.buildings.length]));
  }
  list.forEach((core, i) => {
    const b = state.buildings[i];
    if (!b) return;
    core.buildingId = b.id;
    core.kind = "building";
    b.tower = b.tower || defaultTower(core.w, core.d);
  });
  state.cores = list;
  state.coreIndex = 0;
  syncCore();
}

export function setSiteType(type) {
  if (type !== "single" && type !== "complex") return;
  if (state.siteType === type) return;
  state.siteType = type;
  if (type === "complex") {
    if (!state.buildings.length) {
      // 평면이 아직 없으면 임시 크기로 코어를 잡고, generatePlate 때 다시 맞춤.
      const probe = {
        ...(state.plate || plateFromState()),
        expectTowerW: DEFAULT_TOWER_W,
        expectTowerD: DEFAULT_TOWER_D,
      };
      const cores = defaultCores(probe, 3);
      state.buildings = [];
      cores.forEach((core, i) => {
        const b = makeBuilding(i, core);
        core.buildingId = b.id;
        core.kind = "building";
        state.buildings.push(b);
      });
      state.cores = cores.map((c) => (state.plate ? clampCore(c, state.plate) : c));
      syncCore();
    }
    state.demand.active = { ...(state.demand.active || {}), apartment: true };
    state.noGroundAccess = true;
    // 단지형은 동·코어가 많아 외부 램프+짧은 대지 여유가 자주 깨진다 → 내부 램프를 기본으로.
    preferInternalRampForComplex("단지형으로 바꿔 내부 램프를 기본으로 썼습니다.");
  } else {
    state.buildings = [];
    if (state.plate) {
      state.cores = [clampCore({ ...defaultCore(state.plate), kind: "building" }, state.plate)];
    } else {
      state.cores = [];
    }
    state.coreIndex = 0;
    syncCore();
    if (state.plate) {
      state.plate.blockRects = [];
      state.plate.buildings = [];
    }
  }
  if (state.plate) rebuildLayout();
  emit();
}

/** 단지형은 내부 램프를 기본으로 쓴다(외부+짧은 대지 여유가 자주 깨짐). */
function preferInternalRampForComplex(notice) {
  if (state.rampPlacement === "internal"
    && (state.ramps || []).every((r) => (r.placement || "internal") === "internal")) {
    return;
  }
  state.rampPlacement = "internal";
  state.ramps = (state.ramps || []).map((r) => ({ ...r, placement: "internal" }));
  if (notice) state.referenceNotes = (state.referenceNotes || []).concat([notice]);
}

/** @returns {string|null} 사용자 안내 문장(바꿨을 때만). */
function ensureComplexRampFits() {
  if (state.siteType !== "complex") return null;
  const edge = state.roadEdge || (state.ramps[0] && state.ramps[0].edge) || "w";
  const length = defaultRampLength(state.plate || plateFromState(), edge);
  const external = state.rampPlacement === "external"
    || (state.ramps[0] && state.ramps[0].placement === "external");
  if (!external) return null;
  const ramp = {
    ...(state.ramps[0] || {}),
    edge,
    width: state.rampWidth || 6,
    length: state.rampLength || length,
    placement: "external",
  };
  const plate = {
    ...(state.plate || plateFromState()),
    buildings: state.buildings,
    siteMargin: state.siteMargin,
    siteMargins: state.siteMargins,
  };
  const clear = externalRampClearance(ramp, plate);
  if (clear.fits) return null;
  state.rampPlacement = "internal";
  state.ramps = (state.ramps || []).map((r) => ({ ...r, placement: "internal", length: r.length || length }));
  return `외부 램프(${clear.need}m)가 대지 여유 ${clear.have}m를 넘어 내부 램프로 바꿨습니다.`;
}

export function addBuilding() {
  if (state.siteType !== "complex") return;
  const probe = state.plate || plateFromState();
  const buildingCores = state.cores.filter((c) => (c.kind || "building") !== "stair");
  const stairs = state.cores.filter((c) => c.kind === "stair");
  const next = defaultCores(probe, buildingCores.length + 1);
  const core = next[next.length - 1];
  const building = makeBuilding(state.buildings.length, core);
  core.buildingId = building.id;
  core.kind = "building";
  state.buildings.push(building);
  state.cores = buildingCores.concat(
    [state.plate ? clampCore(core, state.plate) : core],
    stairs,
  );
  state.coreIndex = buildingCores.length;
  syncCore();
  if (state.plate) rebuildLayout();
  emit();
}

export function removeBuilding(id) {
  if (state.siteType !== "complex") return;
  if (state.buildings.length <= 1) return;
  state.buildings = state.buildings.filter((b) => b.id !== id);
  state.cores = state.cores.filter((c) => c.buildingId !== id);
  state.coreIndex = Math.min(state.coreIndex, Math.max(0, state.cores.length - 1));
  syncCore();
  if (state.plate) rebuildLayout();
  emit();
}

export function updateBuilding(id, partial) {
  const building = state.buildings.find((b) => b.id === id);
  if (!building) return;
  if (partial.name != null) building.name = String(partial.name);
  if (partial.floors != null) building.floors = Math.max(1, Number(partial.floors) || 1);
  if (partial.floorHeight != null) building.floorHeight = Math.max(2.5, Number(partial.floorHeight) || 2.9);
  if (partial.blockUnder != null) building.blockUnder = Boolean(partial.blockUnder);
  if (partial.tower) {
    building.tower = { ...building.tower, ...partial.tower };
  }
  if (state.plate) rebuildLayout();
  emit();
}

export function addStairCore(point) {
  const probe = state.plate || plateFromState();
  let near = point;
  if (!near) {
    // 빈 자리: 기존 코어와 겹치지 않는 후보
    const cx = probe.width / 2;
    const cy = probe.depth * 0.25;
    near = { x: cx, y: cy };
  }
  const core = stairCore(probe, near);
  // 다른 코어와 겹치면 x를 밀어 본다.
  const others = state.cores.slice();
  for (let k = 0; k < 8; k += 1) {
    const hit = others.some((o) => {
      const ox = Math.min(core.x + core.w, o.x + o.w) - Math.max(core.x, o.x);
      const oy = Math.min(core.y + core.d, o.y + o.d) - Math.max(core.y, o.y);
      return ox > 0.01 && oy > 0.01;
    });
    if (!hit) break;
    core.x = round1(core.x + 8);
    if (state.plate) Object.assign(core, clampCore(core, state.plate));
  }
  state.cores.push(state.plate ? clampCore(core, state.plate) : core);
  state.coreIndex = state.cores.length - 1;
  syncCore();
  state.selection = { type: "core", index: state.coreIndex };
  if (state.plate) rebuildLayout();
  emit();
}

export function buildingOfCore(core) {
  if (!core || core.buildingId == null) return null;
  return state.buildings.find((b) => b.id === core.buildingId) || null;
}

export function coreLabel(core, index) {
  if (!core) return `코어 ${index + 1}`;
  if (core.kind === "stair") {
    const stairIndex = state.cores.filter((c, i) => i <= index && c.kind === "stair").length;
    return `계단 ${stairIndex}`;
  }
  const building = buildingOfCore(core);
  if (building) return `${building.name} 코어`;
  return `코어 ${index + 1}`;
}

export function updateCoreArea(area) {
  const core = state.cores[state.coreIndex];
  if (!core || !Number.isFinite(area) || area <= 0) return;
  const current = core.w * core.d;
  if (current <= 0) return;
  const scale = Math.sqrt(area / current);
  updateCore({ w: core.w * scale, d: core.d * scale });
}

export function placeOpening(kind, edge, t) {
  if (state.entranceMode === "integrated") return;
  const opening = clampOpening({
    id: state.nextId++,
    kind,
    edge,
    t,
    width: state.entranceWidth,
  }, state.plate);
  state.openings.push(opening);
  state.selection = { type: "opening", id: opening.id };
  rebuildLayout();
  emit();
}

export function moveOpening(id, edge, t) {
  const index = state.openings.findIndex((item) => item.id === id);
  if (index < 0) return;
  const current = state.openings[index];
  if (current.linkedRamp) return;
  state.openings[index] = clampOpening({ ...current, edge, t }, state.plate);
  state.selection = { type: "opening", id };
  rebuildLayout();
  emit();
}

export function placeRamp(edge, t) {
  const length = defaultRampLength(state.plate, edge);
  state.rampLength = length;
  const ramp = clampOpening({
    id: state.nextId++,
    edge,
    t,
    width: state.rampWidth,
    length,
    placement: state.rampPlacement,
  }, state.plate);
  ramp.placement = state.rampPlacement;
  state.ramps.push(ensureModules(ramp, state.plate));
  if (state.entranceMode === "integrated") syncIntegrated(state.ramps[state.ramps.length - 1]);
  state.selection = { type: "ramp", id: ramp.id };
  rebuildLayout();
  emit();
}

export function moveRamp(id, edge, t) {
  pinLowerRampOverrides();
  const index = state.ramps.findIndex((item) => item.id === id);
  if (index < 0) return;
  // 사슬 램프(이미 모듈 편집됨)는 예전 edge 끌기가 아니라 시작점 평행 이동으로 바꾼다(프롬프트 4).
  const cur = state.ramps[index];
  if (cur.modules && cur.legacy && !isLegacyEquivalent(cur, state.plate)) {
    // 변 끌기는 아직 legacy 동기화만: edge/t를 바꾼 뒤 다시 migrate
    const base = { ...cur.legacy, edge, t, width: cur.width, length: cur.length, placement: state.rampPlacement };
    state.ramps[index] = ensureModules(base, state.plate);
  } else {
    const next = clampOpening({
      ...(cur.legacy || {}),
      ...cur,
      edge,
      t,
      // 사슬로 바뀐 램프는 길이·형태가 legacy에만 있음 → 살려야 '자동'(직선/90°)이 다시 고름
      length: Math.max(Number(cur.length ?? cur.legacy?.length) || 0, defaultRampLength(state.plate, edge)),
      form: cur.form ?? cur.legacy?.form ?? state.rampForm ?? "auto",
      placement: state.rampPlacement,
    }, state.plate);
    next.placement = state.rampPlacement;
    // edge/t가 바뀌면 사슬을 legacy에서 다시 만든다
    if (next.modules) {
      delete next.modules;
      delete next.x;
      delete next.y;
      delete next.heading;
    }
    delete next.legacy;
    // 내부 직선+90°(자동 포함)가 이 자리에서 안 들어가면 가까운 옆벽 쪽으로 당겨 들어가는 자리를 찾음
    if (next.placement !== "external") {
      try {
        if (rampShape(next, state.plate).ok === false) {
          const along = edge === "n" || edge === "s" ? state.plate.width : state.plate.depth;
          const half = Math.max(6.5, next.width || 6) / 2;
          const cands = [half, along - half].sort((a, b) => Math.abs(a - t) - Math.abs(b - t));
          for (const c of cands) if (rampShape({ ...next, t: c }, state.plate).ok !== false) { next.t = c; break; }
        }
      } catch (e) { /* 그대로 */ }
    }
    state.ramps[index] = ensureModules(next, state.plate);
  }
  if (state.entranceMode === "integrated") syncIntegrated(state.ramps[index]);
  state.selection = { type: "ramp", id };
  rebuildLayout();
  emit();
}

/**
 * 출입 램프를 바꾸기 전에 현재 층간 위치를 고정한다.
 * (덮어쓰기가 없으면 파생 위치를 스냅샷 → 이후 출입 변경에 끌려가지 않음)
 */
export function pinLowerRampOverrides() {
  if (!state.plate || !(state.ramps && state.ramps.length)) return;
  const mode = state.lowerRampMode || "alternate";
  // 같은 자리: 층간은 출입을 따라감(고정하지 않음)
  if (mode === "same") return;
  const form = state.lowerRampForm || "auto";
  const plate = {
    ...state.plate,
    lowerRampForm: form,
    lowerRampMode: mode,
    lowerRampOverrides: state.lowerRampOverrides || {},
  };
  const next = { ...(state.lowerRampOverrides || {}) };
  for (const g of state.ramps) {
    if (next[g.id] || next[String(g.id)]) continue;
    const low = lowerFloorRamp(g, plate, mode, form, null);
    if (!low) continue;
    next[g.id] = {
      edge: low.edge,
      t: low.t,
      placement: low.placement || "internal",
    };
  }
  state.lowerRampOverrides = next;
}

/** 층간 램프(B2↓) 위치 덮어쓰기 — 출입과 독립 조정. */
export function moveLowerRamp(groundId, edge, t, { live = false } = {}) {
  if (!state.plate) return;
  const along = edge === "n" || edge === "s" ? state.plate.width : state.plate.depth;
  const nextT = Math.max(3, Math.min(along - 3, Number(t) || along / 2));
  state.lowerRampOverrides = {
    ...(state.lowerRampOverrides || {}),
    [groundId]: {
      ...(state.lowerRampOverrides?.[groundId] || {}),
      edge,
      t: round1(nextT),
    },
  };
  state.selection = { type: "lowerRamp", id: groundId };
  syncPlateMeta();
  if (live) emit();
  else {
    rebuildLayout();
    emit();
  }
}

/** 사슬 시작점 평행 이동(0.5m 맞춤). live면 배치 엔진은 돌리지 않고 화면만 갱신.
 *  건축선~이격 사이(대지 여유)까지 허용. 외곽 회전이 밖으로 나가면 외부형으로 맞춘다.
 */
export function moveRampFree(id, x, y, { live = false } = {}) {
  if (!live) pinLowerRampOverrides();
  else if (!(state.lowerRampOverrides && Object.keys(state.lowerRampOverrides).length)) {
    pinLowerRampOverrides();
  }
  const index = state.ramps.findIndex((item) => item.id === id);
  if (index < 0 || !state.plate) return;
  let cur = ensureModules(state.ramps[index], state.plate);
  const m = siteMarginsOf(state.plate);
  const W = state.plate.width;
  const D = state.plate.depth;
  const nx = Math.max(-m.w, Math.min(W + m.e, x));
  const ny = Math.max(-m.s, Math.min(D + m.n, y));
  cur = chainMoveRamp(cur, nx, ny);
  // 외곽 회전·시작점이 건축선 밖이면 외부형으로 — 이격 띠에 램프가 남게
  const form = cur.form || state.rampForm || "auto";
  const outsidePlate = nx < -0.05 || ny < -0.05 || nx > W + 0.05 || ny > D + 0.05;
  if (outsidePlate || form === "spiral") {
    if (outsidePlate) {
      cur = { ...cur, placement: "external" };
      state.rampPlacement = "external";
    }
  }
  const legal = Number(state.plate.legalStalls) || Number(state.demand?.required) || 0;
  const { ramp: synced } = applyPlateMeta(cur, state.plate, { legalStalls: legal });
  state.ramps[index] = synced;
  if (state.entranceMode === "integrated") syncIntegrated(synced);
  state.selection = { type: "ramp", id, module: state.selection?.module };
  if (live) emit();
  else {
    rebuildLayout();
    emit();
  }
}

export function rotateSelectedRamp(quarter = 1) {
  const selected = selectedRamp();
  if (!selected || !state.plate) return;
  const index = state.ramps.findIndex((item) => item.id === selected.id);
  let cur = ensureModules(selected, state.plate);
  cur = chainRotateRamp(cur, quarter);
  const legal = Number(state.plate.legalStalls) || 0;
  const { ramp: synced } = applyPlateMeta(cur, state.plate, { legalStalls: legal });
  state.ramps[index] = synced;
  if (state.entranceMode === "integrated") syncIntegrated(synced);
  rebuildLayout();
  emit();
}

export function editRampModules(action, payload = {}) {
  const selected = selectedRamp();
  if (!selected || !state.plate) return;
  const index = state.ramps.findIndex((item) => item.id === selected.id);
  let cur = ensureModules(selected, state.plate);
  const after = state.selection?.module != null ? state.selection.module : null;
  if (action === "addStraight") cur = chainAddModule(cur, "straight", null, after);
  else if (action === "addTurnL") cur = chainAddModule(cur, "turn", "L", after);
  else if (action === "addTurnR") cur = chainAddModule(cur, "turn", "R", after);
  else if (action === "remove") {
    const mi = after != null ? after : (cur.modules.length - 1);
    cur = chainRemoveModule(cur, mi);
    if (state.selection) state.selection = { ...state.selection, module: null };
  } else if (action === "setLength" && after != null) {
    cur = chainSetLength(cur, after, payload.length);
  } else if (action === "autoFit") {
    const legal = Number(state.plate.legalStalls) || Number(state.demand?.required) || 0;
    const fit = chainAutoFit(cur, { floorHeight: state.floorHeight || state.plate.floorHeight || 3.2, legalStalls: legal });
    cur = fit.ramp;
  } else if (action === "setWidth") {
    cur = { ...cur, width: Number(payload.width) || cur.width };
  } else if (action === "setRadius") {
    cur = {
      ...cur,
      innerRadius: Number(payload.radius) || cur.innerRadius || 6,
      modules: (cur.modules || []).map((m) => (m.type === "turn" ? { ...m, radius: Number(payload.radius) || m.radius } : m)),
    };
  } else if (action === "setLevels") {
    cur = { ...cur, levels: Math.max(1, Number(payload.levels) || 1) };
  } else if (action === "setMode") {
    cur = { ...cur, mode: payload.mode === "spiral" ? "spiral" : "repeat" };
  } else return;
  const legal = Number(state.plate.legalStalls) || Number(state.demand?.required) || 0;
  const { ramp: synced } = applyPlateMeta(cur, state.plate, { legalStalls: legal });
  state.ramps[index] = synced;
  if (state.entranceMode === "integrated") syncIntegrated(synced);
  rebuildLayout();
  emit();
}

export function rampModuleInfo(ramp = selectedRamp()) {
  if (!ramp || !state.plate) return null;
  const cur = ensureModules(ramp, state.plate);
  const legal = Number(state.plate.legalStalls) || Number(state.demand?.required) || 0;
  const opts = { floorHeight: state.floorHeight || state.plate.floorHeight || 3.2, legalStalls: legal };
  const plan = slopePlan(cur, opts);
  const site = analyzeOnPlate(cur, state.plate, { ...opts, blocks: state.plate.blockRects || [] });
  const chain = buildChain(cur);
  return { ramp: cur, plan, site, chain, legacyEq: isLegacyEquivalent(cur, state.plate) };
}

function syncIntegrated(ramp) {
  const width = ramp.width;
  const existing = state.openings.filter((opening) => opening.linkedRamp === ramp.id);
  if (existing.length >= 2) {
    existing.forEach((opening) => {
      opening.edge = ramp.edge;
      opening.t = ramp.t;
      opening.width = width;
    });
    return;
  }
  state.openings = state.openings.filter((opening) => !opening.linkedRamp);
  state.openings.push(
    clampOpening({ id: state.nextId++, kind: "in", edge: ramp.edge, t: ramp.t, width, linkedRamp: ramp.id }, state.plate),
    clampOpening({ id: state.nextId++, kind: "out", edge: ramp.edge, t: ramp.t, width, linkedRamp: ramp.id }, state.plate),
  );
}

export function updateEntranceWidth(width) {
  state.entranceWidth = width;
  const selected = selectedOpening();
  if (selected && !selected.linkedRamp) {
    const index = state.openings.findIndex((item) => item.id === selected.id);
    state.openings[index] = clampOpening({ ...selected, width }, state.plate);
    rebuildLayout();
  }
  if (state.entranceMode === "integrated" && state.ramps[0]) {
    updateRampSize({ width });
    return;
  }
  emit();
}

export function updateRampSize(partial) {
  if (partial.width != null) state.rampWidth = partial.width;
  if (partial.length != null) state.rampLength = partial.length;
  const selected = selectedRamp() || state.ramps[0];
  if (selected) {
    const index = state.ramps.findIndex((item) => item.id === selected.id);
    const merged = clampOpening({ ...selected, ...partial, placement: state.rampPlacement }, state.plate);
    merged.placement = state.rampPlacement;
    if (partial.length != null || partial.width != null) {
      // 길이·폭 변경 시 legacy 기준으로 사슬을 다시 맞춘다
      const base = { ...(merged.legacy || merged), ...partial, edge: merged.edge, t: merged.t, placement: merged.placement };
      delete base.modules;
      state.ramps[index] = ensureModules(base, state.plate);
    } else {
      state.ramps[index] = ensureModules(merged, state.plate);
    }
    state.rampLength = state.ramps[index].length || state.ramps[index].modules?.[0]?.length || state.rampLength;
    if (state.entranceMode === "integrated") syncIntegrated(state.ramps[index]);
    rebuildLayout();
  }
  emit();
}

export function selectItem(selection) {
  state.selection = selection;
  if (selection?.type === "core" && Number.isInteger(selection.index)) {
    state.coreIndex = selection.index;
    syncCore();
  }
  emit();
}

export function removeSelection() {
  if (!state.selection) return;
  if (state.selection.type === "opening") {
    const opening = state.openings.find((item) => item.id === state.selection.id);
    if (opening?.linkedRamp) return;
    state.openings = state.openings.filter((item) => item.id !== state.selection.id);
  }
  if (state.selection.type === "ramp") {
    const id = state.selection.id;
    state.ramps = state.ramps.filter((item) => item.id !== id);
    state.openings = state.openings.filter((item) => item.linkedRamp !== id);
  }
  if (state.selection.type === "core") {
    const core = state.cores[state.coreIndex];
    if (core && core.kind === "stair") {
      state.cores.splice(state.coreIndex, 1);
      state.coreIndex = 0;
      syncCore();
    } else {
      const buildingCores = state.cores.filter((c) => (c.kind || "building") !== "stair");
      if (buildingCores.length > 1) {
        if (core && core.buildingId != null) {
          state.buildings = state.buildings.filter((b) => b.id !== core.buildingId);
        }
        state.cores.splice(state.coreIndex, 1);
        state.coreIndex = 0;
        syncCore();
      }
    }
  }
  state.selection = null;
  rebuildLayout();
  emit();
}

export function placeSplitExample() {
  if (!state.plate) return;
  state.entranceMode = "separate";
  state.openings = [];
  const width = state.plate.width;
  state.openings.push(
    clampOpening({ id: state.nextId++, kind: "in", edge: "s", t: width * 0.32, width: state.entranceWidth }, state.plate),
    clampOpening({ id: state.nextId++, kind: "out", edge: "s", t: width * 0.68, width: state.entranceWidth }, state.plate),
  );
  state.selection = null;
  rebuildLayout();
  emit();
}

export function placeOverlapExample() {
  if (!state.plate || !state.ramps.length) return;
  state.entranceMode = "integrated";
  syncIntegrated(state.ramps[0]);
  state.selection = null;
  rebuildLayout();
  emit();
}

export function setTool(tool) {
  state.tool = tool;
  emit();
}

export function selectedOpening() {
  if (!state.selection || state.selection.type !== "opening") return null;
  return state.openings.find((item) => item.id === state.selection.id) || null;
}

export function selectedRamp() {
  if (!state.selection || state.selection.type !== "ramp") return null;
  return state.ramps.find((item) => item.id === state.selection.id) || null;
}

function accessLabel() {
  const ins = state.openings.filter((item) => item.kind === "in");
  const outs = state.openings.filter((item) => item.kind === "out");
  if (!ins.length && !outs.length) return "미지정";
  if (state.entranceMode === "integrated") return "램프 일체";
  if (!ins.length || !outs.length) return "겸용";
  const overlapped = ins.some((entry) => outs.some((exit) => intervalsOverlap(entry, exit)));
  return overlapped ? "겹침" : "분리";
}

function round1(value) {
  return Math.round(value * 10) / 10;
}
