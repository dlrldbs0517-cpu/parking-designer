import { calculateDemand, emptyDemand } from "./demand.js?v=226";
import {
  basementCount,
  clampCore,
  clampOpening,
  defaultCore,
  defaultRampLength,
  FLOOR_H,
  minStraightRampLength,
  rampTransitions,
  rampPositionCheck,
  generateVariants,
  intervalsOverlap,
  layoutParking,
  referenceCase,
  searchPlacement,
  snapCore,
} from "./layout.js?v=226";

export const state = {
  step: 1,
  households: 100,
  demand: emptyDemand(),
  floorView: "all",
  resultTab: "model",
  parkWidth: 48,
  parkDepth: 42,
  columnSpacing: 8.1,
  columnWidth: 0.5,
  columnDepth: 0.5,
  wallColumns: "back",   // 벽 쪽 줄 기둥: back = 외벽에 붙임, front = 안쪽(주차줄 앞·모듈선)으로 당김
  minClear: 0,   // 기둥 면과 주차칸 선 사이 여유. 법정 값 없음(칸 크기만 확보하면 됨).
  siteMargin: 20,
  siteMargins: { n: null, s: null, e: null, w: null },
  roadEdge: "w",   // 도로에 접한 변: 램프·출입구를 이 변에 둔다
  coreAuto: true,  // 평면 만들기 때 코어 자리를 자동 탐색(평면에서 코어를 직접 옮기면 끔)
  rampPos: "auto", // 그 변 안 램프 위치: auto(대수 최대) · start(서/남 끝) · mid · end(동/북 끝)   // 방향별 대지 여유(비우면 공통 값)
  // 장애인전용 주차구획. 적용 대상인지는 법정 대수(10대 이상)로 판단한다.
  stallRules: { disabled: true, disabledRate: 0.03, ecoMode: "auto", ecoRate: 0.05, parallel: true },
  rampPlacement: "internal",
  entranceMode: "separate",
  circulation: "ccw",
  entranceWidth: 6,
  rampWidth: 6,
  rampLength: minStraightRampLength(),
  // 도로와 접하는 부분부터 3m는 8.5% 이하 (주차장법 시행규칙 제6조①5바)
  // 층고(m). 유효높이 = 층고 − 슬래브 0.28m가 차로 기준 2.3m 이상이어야 한다.
  floorHeight: 3.2,
  noGroundAccess: true,   // 공동주택: 지상에 동별 차량 접근 없음(지상공원형) → 지하 차로 높이 2.7m
  // 기둥 간격을 가로·세로 따로 쓸 때 (예: "8.1,8.4,9"). 비우면 columnSpacing 하나로.
  spansX: "",
  spansY: "",
  // 막다른 차로 정리 + 진입 불가 칸 제외
  trimDeadEnds: true,
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
  return {
    width: round1(state.parkWidth),
    depth: round1(state.parkDepth),
    spacing: round1(state.columnSpacing),
    columnWidth: round1(state.columnWidth),
    columnDepth: round1(state.columnDepth),
    minClear: round1(state.minClear * 100) / 100,
    wallColumns: state.wallColumns || "back",
    siteMargin: round1(state.siteMargin),
    siteMargins: state.siteMargins,
    rampPlacement: state.rampPlacement,
    roadEdge: state.roadEdge,
    clearRequired: state.demand.active && state.demand.active.apartment && state.noGroundAccess ? 2.7 : 2.3,
    stallRules: currentStallRules(),
    spansX: parseSpans(state.spansX).values,
    spansY: parseSpans(state.spansY).values,
    trimDeadEnds: state.trimDeadEnds,
    floorHeight: state.floorHeight,
    // 경사로 완화구간 기준(별표 1)은 법정 주차대수로 판단한다
    legalStalls: calculateDemand(state.demand, null, state.columnSpacing).legalStalls,
  };
}

/**
 * "8.1, 8.4, 9" → { values: [8.1, 8.4, 9], error: "" }. 비어 있으면 values null(기둥 간격 하나 사용).
 * 각 값은 3~15m. 잘못되면 values null과 error 문구.
 */
export function parseSpans(text) {
  const raw = String(text || "").trim();
  if (!raw) return { values: null, error: "" };
  const values = [];
  for (const part of raw.split(/[,\s]+/).filter(Boolean)) {
    const value = Number(part);
    if (!Number.isFinite(value)) return { values: null, error: `숫자가 아닌 값 "${part}"` };
    if (value < 3 || value > 15) return { values: null, error: `${part}m는 3~15m 범위 밖` };
    values.push(value);
  }
  return { values, error: "" };
}

/** 화면 설정 + 법정 필요 대수·세대수 → 배치 엔진에 넘길 구획 규칙 */
export function currentStallRules() {
  const demand = calculateDemand(state.demand, null, state.columnSpacing);
  return { ...state.stallRules, legalStalls: demand.legalStalls, ecoAuto: demand.ecoAuto, ecoBasis: demand.ecoBasis };
}

function syncCore() {
  state.core = state.cores[state.coreIndex] || state.cores[0] || null;
  if (state.core && state.coreIndex >= state.cores.length) state.coreIndex = 0;
}

function adopt(result, keepObjects) {
  state.stalls = result.stalls;
  state.aisles = result.aisles;
  state.columns = result.columns;
  state.drives = result.drives;
  state.route = result.route;
  // 자동 생성(배치안 적용)에서는 코어가 자동으로 밀린 건 알릴 필요 없음 — 사용자가 끌어 옮긴 경우(rebuildLayout)만 알림
  state.issues = keepObjects ? result.issues : result.issues.filter((issue) => issue.type !== "notice");
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
    state.ramps = result.ramps;
    state.coreIndex = Math.min(state.coreIndex, Math.max(0, state.cores.length - 1));
    syncCore();
  }
}

export function refreshVariants(lockRamp = false) {
  if (!state.plate) return;
  state.variants = generateVariants({
    lockRamp,
    plate: state.plate,
    cores: state.cores,
    openings: state.openings,
    ramps: state.ramps,
    rampPlacement: state.rampPlacement,
    entranceMode: state.entranceMode,
    circulation: state.circulation,
  });
}

export function applyVariant(index) {
  const variant = state.variants[index];
  if (!variant) return;
  state.variantIndex = index;
  adopt(variant, false);
  emit();
}

export function rebuildLayout() {
  if (!state.plate) return;
  const result = layoutParking({
    plate: state.plate,
    cores: state.cores,
    openings: state.openings,
    ramps: state.ramps,
    rampPlacement: state.rampPlacement,
    entranceMode: state.entranceMode,
    circulation: state.circulation,
    lockRamp: true,
    spec: state.spec || {
      axis: "x",
      dir: state.circulation === "cw" ? "cw" : "ccw",
      packFrom: "start",
      bayMode: "max",
      rampShift: 0,
      rampPlacement: state.rampPlacement,
      entranceMode: "follow",
    },
  });
  adopt(result, true);
  // 레이아웃이 코어를 램프 밖으로 밀었으면 화면의 코어도 같은 자리로(3D와 평면이 어긋나지 않게).
  (result.cores || []).forEach((fixed, i) => {
    if (state.cores[i]) { state.cores[i].x = fixed.x; state.cores[i].y = fixed.y; }
  });
  syncCore();
  // 레이아웃이 램프 위치·폭을 보정했으면(벽에 붙이기, 곡선 6.5m) 화면의 램프도 맞춘다.
  (result.ramps || []).forEach((fixed) => {
    const mine = state.ramps.find((ramp) => ramp.id === fixed.id);
    if (mine) { mine.t = fixed.t; mine.width = fixed.width; }
  });
  state.openings = result.openings;
}

// 도로변에 내부 램프가 어느 위치에도 안 들어가면(예: 긴 변이 도로인데 깊이가 짧음) 옆 변의 도로 쪽 끝으로 옮긴다.
export function rampFallback(plate = state.plate) {
  if (state.rampPlacement !== "internal" || !plate) return null;
  const road = state.roadEdge || "w";
  const check = (edge) => {
    try { return rampPositionCheck({ ...plate, roadEdge: edge }, state.rampPlacement, state.floorHeight); } catch (error) { return {}; }
  };
  const here = check(road);
  if (["start", "mid", "end"].some((pos) => !here[pos])) return null;
  const options = {
    s: [["w", "start"], ["e", "start"]],
    n: [["w", "end"], ["e", "end"]],
    w: [["s", "start"], ["n", "start"]],
    e: [["s", "end"], ["n", "end"]],
  }[road];
  for (const [edge, pos] of options) {
    const c = check(edge);
    if (!c[pos]) return { edge, pos, reason: here.mid || here.start };
  }
  return null;
}

function seedAccess() {
  // 램프는 조건 단계에서 고른 도로 접한 변의 가운데에서 시작한다(배치안이 그 변 안에서 위치를 다듬음).
  // 도로변에 안 들어가면 옆 변의 도로 쪽 끝(rampFallback).
  const fallback = rampFallback();
  state.accessNote = fallback
    ? `${EDGE_NAME[state.roadEdge]}(도로변)은 ${fallback.reason || "길이 부족"}로 내부 램프가 들어가지 않아, ${EDGE_NAME[fallback.edge]} 변의 도로 쪽 끝에 램프를 두었습니다.`
    : null;
  const edge = fallback ? fallback.edge : (state.roadEdge || "w");
  const along = edge === "n" || edge === "s" ? state.plate.width : state.plate.depth;
  if (state.ramps.length && state.ramps[0].edge !== edge) state.ramps = [];
  const pos = fallback ? fallback.pos : (state.rampPos === "auto" ? "start" : state.rampPos);
  if (!state.ramps.length) {
    state.ramps = [{
      id: state.nextId++,
      edge,
      t: round1(along / 2),
      pos,
      width: state.rampWidth,
      length: defaultRampLength(state.plate, edge),
      placement: state.rampPlacement,
    }];
  } else {
    state.ramps = state.ramps.map((ramp) => ({ ...ramp, pos, placement: state.rampPlacement }));
  }
}
const EDGE_NAME = { n: "북측", s: "남측", e: "동측", w: "서측" };


// 코어 자리 자동 탐색: 기둥 격자 칸을 모두 돌려 보고, 지금 자리보다 추천안 대수가 많으면 옮긴다.
function searchCore() {
  state.coreSearch = null;
  if (state.coreAuto && state.cores.length === 1 && state.cores[0].grid !== false) {
    const pos = state.ramps[0]?.pos || null;
    const found = searchPlacement({
      plate: state.plate,
      cores: state.cores,
      openings: state.openings,
      ramps: state.ramps,
      rampPlacement: state.rampPlacement,
      entranceMode: state.entranceMode,
    }, pos ? [pos] : null);
    if (found && found.cores && found.cores[0]) {
      const recOf = (list) => list.find((v) => v.recommended) || list[0];
      const valueOf = (v) => (v ? (v.metrics.valid ? 100000 : 0) + v.metrics.stalls : -1);
      const before = recOf(state.variants);
      const keep = { cores: state.cores, variants: state.variants };
      state.cores = found.cores.map((core) => ({ ...core }));
      refreshVariants();
      const after = recOf(state.variants);
      if (valueOf(after) > valueOf(before)) {
        state.coreSearch = { before: before.metrics.stalls, after: after.metrics.stalls };
      } else {
        state.cores = keep.cores;
        state.variants = keep.variants;
      }
      syncCore();
    }
  }
}

export function autoPlaceCore() {
  if (!state.plate) return;
  state.coreAuto = true;
  refreshVariants();
  searchCore();
  const best = Math.max(0, state.variants.findIndex((variant) => variant.recommended));
  applyVariant(best);
}

export function generatePlate() {
  state.plate = plateFromState();
  // 램프 길이는 층고·법정 대수(완화구간)로 정한 최소 길이보다 짧으면 안 된다.
  const autoLength = minStraightRampLength(state.floorHeight, rampTransitions({ legalStalls: state.plate.legalStalls }));
  // 순서: 층고 → 법정 경사(직선 17%, 곡선 14%, 완화구간)로 램프 길이 고정 → 배치. 사용자가 길이를 바꾸지 않는다.
  state.rampLength = autoLength;
  state.ramps = state.ramps.map((ramp) => ({ ...ramp, length: autoLength }));
  if (!state.cores.length) state.cores = [defaultCore(state.plate)];
  // 격자 맞춤 코어는 기둥 간격이 바뀌었어도 같은 칸 수로 다시 맞춘다.
  state.cores = state.cores.map((core) => {
    if (core.grid === false) return clampCore(core, state.plate);
    const step = state.plate.spacing || 8.1;
    const nx = core.nx || 1;
    const ny = core.ny || 1;
    const sized = { ...core, nx, ny, w: nx * step, d: ny * step, grid: true };
    return clampCore(snapCore(clampCore(sized, state.plate), state.plate), state.plate);
  });
  syncCore();
  seedAccess();
  state.referenceNotes = [];
  refreshVariants();
  if (state.rampPos === "auto" && !state.accessNote) {
    // 도로변 안에서 끝·가운데·끝을 모두 돌려 보고 추천안 대수가 가장 많은 위치를 쓴다.
    const scoreOf = () => {
      const v = state.variants.find((item) => item.recommended) || state.variants[0];
      return v ? (v.metrics.valid ? 100000 : 0) + v.metrics.stalls : -1;
    };
    let bestPos = "start";
    let bestScore = scoreOf();
    let bestVariants = state.variants;
    ["mid", "end"].forEach((pos) => {
      state.ramps = state.ramps.map((ramp) => ({ ...ramp, pos }));
      refreshVariants();
      const score = scoreOf();
      if (score > bestScore) { bestScore = score; bestPos = pos; bestVariants = state.variants; }
    });
    state.ramps = state.ramps.map((ramp) => ({ ...ramp, pos: bestPos }));
    state.variants = bestVariants;
    state.autoRampPos = bestPos;
  } else {
    state.autoRampPos = null;
  }
  searchCore();
  const best = Math.max(0, state.variants.findIndex((variant) => variant.recommended));
  state.step = 2;
  state.revealStage = 6;
  state.tool = "core";
  applyVariant(best);
}

export function loadReference() {
  const sample = referenceCase;
  state.parkWidth = sample.width;
  state.parkDepth = sample.depth;
  state.columnSpacing = sample.spacing;
  state.columnWidth = sample.columnWidth;
  state.columnDepth = sample.columnDepth;
  state.minClear = sample.minClear;
  state.siteMargin = sample.siteMargin;
  state.rampPlacement = sample.rampPlacement;
  state.coreAuto = false;
  state.roadEdge = sample.ramp?.edge || "w";
  state.entranceMode = sample.entranceMode;
  state.circulation = "ccw";
  state.rampWidth = sample.ramp.width;
  // 기준 사례의 램프 길이도 층고와 도로변 완경사 규정으로 다시 계산한다.
  state.rampLength = minStraightRampLength(state.floorHeight, rampTransitions({ legalStalls: calculateDemand(state.demand, null, state.columnSpacing).legalStalls }));
  state.entranceWidth = sample.ramp.width;
  state.demand.projectName = sample.projectName;
  state.referenceNotes = sample.notes.slice();
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
  state.ramps = [{
    id: state.nextId++,
    ...sample.ramp,
    length: state.rampLength,
    placement: "external",
  }];
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

// 3D로 못 넘어가는 문제(배치 자체가 불가능)와, 넘어가되 알려 줄 주의 사항을 나눈다.
const BLOCKING = new Set(["opening", "ramp", "network", "column", "slope", "site", "overlap", "empty"]);
export function issueGroups() {
  const errors = [];
  const warnings = [];
  if (!state.plate) return { errors, warnings };
  if (!state.cores.length) errors.push("코어가 없습니다.");
  if (!state.ramps.length) errors.push("램프를 평면 외곽에 놓으세요.");
  if (!state.openings.length) errors.push("입구 또는 출구를 평면 외곽에 놓으세요.");
  (state.issues || []).forEach((issue) => {
    if (state.accessNote && issue.type === "road") return;   // 도로변에 램프가 안 들어가 옆 변으로 옮긴 경우는 아래 안내로 대신
    (BLOCKING.has(issue.type) ? errors : warnings).push(issue.label);
  });
  if (state.accessNote) warnings.push(state.accessNote);
  if (state.metrics && state.metrics.columnHits > 0 && !errors.some((e) => e.includes("기둥 충돌"))) errors.push(`주차칸-기둥 충돌 ${state.metrics.columnHits}건`);
  if (!errors.length && !state.connected && state.ramps.length && state.openings.length) errors.push("입구, 램프, 출구가 하나의 차로로 이어지지 않습니다.");
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

export function readyFor3d() {
  return Boolean(state.plate && state.cores.length && state.openings.length && state.ramps.length && state.connected && !issueGroups().errors.length);
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
    stallTypes: metrics ? metrics.stallTypes : null,
    stallTargets: metrics ? metrics.stallTargets : null,
    demand,
  };
}

export function updateCore(partial) {
  const current = state.cores[state.coreIndex];
  if (!current || !state.plate) return;
  state.coreAuto = false;   // 직접 손댄 코어는 다음 평면 만들기 때 자동으로 옮기지 않는다
  // 가로·세로를 m로 직접 넣으면 격자 맞춤을 끄고, 칸 수를 고르면 다시 켠다.
  const merged = { ...current, ...partial };
  if (partial.w != null || partial.d != null) { merged.grid = false; delete merged.nx; delete merged.ny; }
  if (partial.nx != null || partial.ny != null) {
    merged.grid = true;
    const step = state.plate.spacing || 8.1;
    merged.w = (merged.nx || 1) * step;
    merged.d = (merged.ny || 1) * step;
  }
  const next = clampCore(snapCore(clampCore(merged, state.plate), state.plate), state.plate);
  if (![next.x, next.y, next.w, next.d].every(Number.isFinite)) return;
  state.cores[state.coreIndex] = next;
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
  if (!state.plate) return;
  const core = defaultCore(state.plate);
  core.x = round1(core.x + state.cores.length * 2);
  state.cores.push(clampCore(core, state.plate));
  state.coreIndex = state.cores.length - 1;
  syncCore();
  rebuildLayout();
  emit();
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
  if (state.entranceMode === "integrated" || state.rampPlacement !== "external") return;
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
  // 램프는 2차로 양방향 하나만 둔다. 이미 있으면 새로 만들지 않고 그 램프를 옮긴다.
  const length = defaultRampLength(state.plate, edge);
  state.rampLength = length;
  const keepId = state.ramps.length ? state.ramps[0].id : state.nextId++;
  state.openings = state.openings.filter((opening) => !opening.linkedRamp || opening.linkedRamp === keepId);
  const ramp = clampOpening({
    id: keepId,
    edge,
    t,
    width: state.rampWidth,
    length,
    placement: state.rampPlacement,
  }, state.plate);
  ramp.placement = state.rampPlacement;
  state.ramps = [ramp];
  if (state.entranceMode === "integrated") syncIntegrated(ramp);
  state.selection = { type: "ramp", id: ramp.id };
  rebuildLayout();
  emit();
}

export function moveRamp(id, edge, t) {
  const index = state.ramps.findIndex((item) => item.id === id);
  if (index < 0) return;
  state.ramps[index] = clampOpening({
    ...state.ramps[index],
    edge,
    t,
    pos: null,   // 직접 끌어 놓은 위치를 그대로 쓴다
    placement: state.rampPlacement,
  }, state.plate);
  state.ramps[index].placement = state.rampPlacement;
  if (state.entranceMode === "integrated") syncIntegrated(state.ramps[index]);
  state.selection = { type: "ramp", id };
  rebuildLayout();
  emit();
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
  if (partial.length != null) {
    // 램프 길이는 층고로 고정(직선 17%·곡선 14%) — 입력값은 무시
    partial = { ...partial, length: minStraightRampLength(state.floorHeight, rampTransitions({ legalStalls: state.plate.legalStalls })) };
    state.rampLength = partial.length;
  }
  const selected = selectedRamp() || state.ramps[0];
  if (selected) {
    const index = state.ramps.findIndex((item) => item.id === selected.id);
    state.ramps[index] = clampOpening({ ...selected, ...partial, placement: state.rampPlacement }, state.plate);
    state.ramps[index].placement = state.rampPlacement;
    state.rampLength = state.ramps[index].length;
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
  if (state.selection.type === "core" && state.cores.length > 1) {
    state.cores.splice(state.coreIndex, 1);
    state.coreIndex = 0;
    syncCore();
  }
  state.selection = null;
  rebuildLayout();
  emit();
}

export function placeSplitExample() {
  if (!state.plate || state.rampPlacement !== "external") return;
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

/**
 * 코어·램프를 끌어 놓은 뒤: 놓은 자리는 그대로 두고 6가지 배치를 다시 짜서 가장 좋은 안으로 바꾼다.
 * (끄는 동안에는 현재 배치만 다시 계산하고, 손을 뗄 때 한 번만 전체를 다시 짠다)
 */
export function settleAfterDrag() {
  if (!state.plate) return;
  refreshVariants(true);
  const best = Math.max(0, state.variants.findIndex((variant) => variant.recommended));
  applyVariant(best);
}

// 대지 여유(공통·방향별)를 바꾸면 현재 평면에도 반영하고 램프 검사를 다시 한다.
export function updateSiteMargins(common, perDir) {
  if (common != null) state.siteMargin = common;
  if (perDir) state.siteMargins = { ...state.siteMargins, ...perDir };
  if (state.plate) {
    state.plate.siteMargin = round1(state.siteMargin);
    state.plate.siteMargins = state.siteMargins;
    rebuildLayout();
  }
  emit();
}
