import { outlineVoids, growRect, polygonArea, outlineProblem, insidePolygon } from "./outline.js?v=306";
import { assignStallTypes, tallyStallTypes, stallRuleTargets, walkField, entryOf } from "./stallTypes.js?v=306";

/**
 * 주차장법 시행규칙 제3조·제6조. 확인 2026-11-08. law.go.kr
 * 주차단위구획 2.5×5.0m, 직각 차로 6m, 직선 램프 17% 이하.
 * 기둥 기본 단면 0.5×0.5m. 중심 간격과 주차 간격(2.5m)은 따로 계산한다.
 */
export const STALL_W = 2.5;
// 주차칸 깊이. 확장형(2.6×5.2m)이 의무인 50대 이상이면 모든 줄을 5.2m로 짠다(layoutParking에서 정함).
export let STALL_D = 5;
export const STALL_D_GENERAL = 5;
export const STALL_D_EXTENDED = 5.2;
export const AISLE = 6;
// 차로가 이어지는 부분도 전 구간 6m 이상이어야 연결로 본다 (기존 5.5m 허용 → 6m, 수정 2026-11-10).
// 0.02m는 좌표 반올림 오차만 허용하는 값.
const AISLE_MIN = AISLE - 0.02;
export const COLUMN = 0.5;
export const FLOOR_H = 3.2;
// 층고는 화면에서 입력한다(plate.floorHeight). 입력이 없으면 FLOOR_H. (수정 2026-11-10)
// 유효높이 = 층고 − 슬래브 두께. 차로 유효높이는 2.3m 이상 (주차장법 시행규칙 제6조①5가·①7).
export const SLAB_T = 0.28;
export function floorHeightOf(plate) {
  const value = Number(plate && plate.floorHeight);
  return value > 0 ? value : FLOOR_H;
}
export function clearHeightOf(floorHeight) {
  return Math.round((floorHeight - SLAB_T) * 100) / 100;
}
export const CLEAR_HEIGHT = 2.3;
// 공동주택 지하주차장: 각 동으로 지상 차량 접근(지상주차장 차로·단지 안 도로)이 없으면 차로 높이 2.7m 이상
// (주택건설기준 등에 관한 규칙 제6조의2제2호. 지하가 여러 층이면 동 출입구로 이어지는 층 하나만 해당).
export const CLEAR_HEIGHT_PARK_APT = 2.7;
export function requiredClearHeight(opts) {
  return opts && opts.apartment && opts.noGroundAccess ? CLEAR_HEIGHT_PARK_APT : CLEAR_HEIGHT;
}
export const RAMP_SLOPE_STRAIGHT = 0.17;
export const RAMP_SLOPE_CURVE = 0.14;
export const CURB_H = 0.15;
export const CURB_W = 0.3;
export const LINE_W = 0.1;
export const WALL_T = 0.2;
export const CORE_GAP = 0.5;

/**
 * 첨부 지하 1층 도면에서 읽은 값과, 잘린 이미지라 확정하지 못한 값.
 * 확정: 기둥 중심 간격 8100(도면에 반복 표기).
 * 추정(불확실): 가로 9모듈=72.9m, 세로 7모듈=56.7m. 첨부 범위 밖으로 치수 합계가 잘려 있다.
 * 추정(불확실): 코어 2개, 각 기둥 격자 2×1칸(15.7×7.6m), 평면 안쪽 아래·위.
 * 추정(불확실): 서쪽 외부 램프 폭 6m. 길이 21.4m는 층고 3.2m를 윗부분 3m·아랫부분 2m(8.5%) + 나머지 17%로 역산(도면에 램프 길이 없음).
 * 추정(불확실): 대지 여유 24m. 도면에 대지경계 치수가 없어 램프가 대지 안에 남도록 둔 값.
 * 추정(불확실): 램프 중심 t=28m. 아래쪽 코어 옆으로 읽음.
 */
export const referenceCase = {
  projectName: "대학 건물 지하 1층",
  // 외곽 기둥을 대지 안에 넣으므로(기둥 0.5m) 기둥 중심 격자 72.9×56.7 + 양쪽 0.5m = 외벽선 73.9×57.7.
  width: 73.9,
  depth: 57.7,
  spacing: 8.1,
  columnWidth: 0.5,
  columnDepth: 0.5,
  minClear: 0,
  siteMargin: 24,
  rampPlacement: "external",
  entranceMode: "integrated",
  circulation: "ccw",
  // 길이 21.4m = 윗부분 3m(도로변 완경사·완화구간 8.5%) + 본 경사 16.4m(17% 이하) + 아랫부분 완화구간 2m(8.5%)로 층고 3.2m.
  // 법정 112대(100대 이상)라 별표 1의 오목형 2m가 붙는다. 이전 18.9m는 17% 단일 경사 역산값.
  ramp: { edge: "w", t: 28.5, width: 6, length: 21.4 },
  cores: [
    // 기둥 격자 맞춤 2×1칸(15.7×7.6m). 도면에 코어 치수가 없어 모듈에 맞춘 추정값.
    { x: 25.05, y: 16.95, w: 15.7, d: 7.6, grid: true, nx: 2, ny: 1 },
    { x: 25.05, y: 33.15, w: 15.7, d: 7.6, grid: true, nx: 2, ny: 1 },
  ],
  notes: [
    "기둥 중심 간격 8.1m는 도면의 8100 표기다.",
    "기둥 격자 72.9×56.7m는 8.1m 모듈 9×7로 읽은 추정값이고, 외곽 기둥 두께를 더해 평면은 73.9×57.7m로 둔다. 첨부 도면은 외곽 치수 합계가 잘려 있다.",
    "코어 크기·위치, 램프 길이 21.4m(도로변 3m·완화구간 포함), 대지 여유 24m, 램프 위치 28m는 도면에 수치가 없어 모듈에 맞춘 추정이다.",
    "램프는 도면의 왼쪽 램프처럼 건축선 밖 외부형이고, 출입구는 그 개구부에 붙인다.",
  ],
};

/**
 * 주차장법 시행규칙 제6조①5바: 오르막 경사로 중 도로와 접하는 부분부터 3m 이내는
 * 직선 8.5%·곡선 7% 이하. 이 구간을 지난 뒤부터 직선 17%를 쓴다. (추가 2026-11-10)
 */
export const GENTLE_LEN = 3;
export const GENTLE_SLOPE = 0.085;

/**
 * 경사로 완화구간 (주차장법 시행규칙 [별표 1], 개정 2024.9.20) — 법정 주차대수 기준
 * - 50대 이상: 볼록형 부분(램프 윗부분, 경사→평지) 1.7m
 * - 100대 이상: 볼록형 1.7m + 오목형 부분(램프 아랫부분, 평지→경사) 2m
 * - 완화구간 경사는 최대 경사의 1/2 이하: 직선 8.5%, 곡선 7%
 * 도로변 3m 8.5%(제6조①5 바목, 오르막 경사로가 도로와 접하는 부분)는 선택이 아니라 필수다.
 * - level "ground"(지상→B1, 도로와 이어지는 램프): 윗부분 = max(3m, 1.7m)
 * - level "lower"(B1→B2 등 지하층 사이): 도로와 안 닿으므로 별표 1 완화구간만
 * 모든 층의 램프는 같은 위치·같은 길이로 쌓이므로 길이는 가장 엄한 지상 램프 기준으로 정한다.
 */
export const CREST_LEN = 1.7;
export const SAG_LEN = 2;

/** 이번 조건에서 램프 윗부분·아랫부분에 둘 완경사(8.5% 이하) 길이 */
export function rampTransitions(plate, level = "ground") {
  const legal = Number(plate && plate.legalStalls) || 0;
  const gentle = level !== "lower";
  return {
    top: Math.max(gentle ? GENTLE_LEN : 0, legal >= 50 ? CREST_LEN : 0),
    bottom: legal >= 100 ? SAG_LEN : 0,
    gentle,
    legal,
  };
}

// 예전 호출(true/false = 도로변 3m 완경사 켬/끔)도 받는다.
function transOf(arg) {
  if (arg == null || typeof arg === "boolean") return { top: arg === false ? 0 : GENTLE_LEN, bottom: 0 };
  return { top: Number(arg.top) || 0, bottom: Number(arg.bottom) || 0 };
}

/** 층고를 내려가는 데 필요한 최소 직선 램프 길이. 윗부분·아랫부분 완경사(8.5%) + 나머지 17%. */
export function minStraightRampLength(floorHeight = FLOOR_H, trans = true) {
  const { top, bottom } = transOf(trans);
  const easeDrop = (top + bottom) * GENTLE_SLOPE;
  const length = floorHeight <= easeDrop
    ? floorHeight / GENTLE_SLOPE
    : top + bottom + (floorHeight - easeDrop) / RAMP_SLOPE_STRAIGHT;
  return Math.ceil(length * 10) / 10;
}

/** 길이 length인 직선 램프의 본 경사(윗부분·아랫부분 완경사를 뺀 나머지 구간의 경사) */
export function rampMainSlope(length, trans = true, floorHeight = FLOOR_H) {
  const { top, bottom } = transOf(trans);
  if (!(length > 0)) return Infinity;
  const main = length - top - bottom;
  if (main <= 0) return Infinity;
  return Math.max(0, floorHeight - (top + bottom) * GENTLE_SLOPE) / main;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function basementCount(required, stallsPerFloor) {
  if (stallsPerFloor <= 0) return 0;
  return Math.max(1, Math.ceil(required / stallsPerFloor));
}

/** 순간격 = 중심 간격 − 기둥 폭. 한 칸 대수 = floor((순간격 − 2×최소 이격) / 2.5). */
export function stallsPerBay(spacing, columnWidth = COLUMN, minClear = 0.05) {
  const module = Number(spacing) || 0;
  const width = Number(columnWidth) || 0;
  const clear = module - width;
  const count = Math.max(0, Math.floor((clear - 2 * minClear + 1e-9) / STALL_W));
  const gap = count > 0 ? (clear - count * STALL_W) / 2 : 0;
  return {
    count,
    gap: round3(gap),
    clear: round3(clear),
  };
}

/** 주차칸 사각형과 기둥 사각형이 겹치거나 간격이 최소 이격보다 작은 쌍의 수. */
export function stallColumnHits(stalls, columns, minClear = 0.05) {
  let hits = 0;
  (stalls || []).forEach((stall) => {
    (columns || []).forEach((column) => {
      if (tooClose(stall, column, minClear)) hits += 1;
    });
  });
  return hits;
}

export function ringInset() {
  return STALL_D + AISLE;
}

export function defaultCore(plate) {
  // 기둥 격자에 맞춘 추천 크기를 가운데에 둔다.
  if (plate.spacing > 0) {
    const rec = recommendCoreCells(plate);
    const core = snapCore({ x: plate.width / 2 - rec.w / 2, y: plate.depth / 2 - rec.d / 2, w: rec.w, d: rec.d, nx: rec.nx, ny: rec.ny, grid: true }, plate);
    if (core && core.w <= plate.width && core.d <= plate.depth) return clampCore(core, plate);
  }
  return freeCore(plate);
}

function freeCore(plate) {
  const inset = ringInset();
  const innerW = Math.max(4, plate.width - inset * 2);
  const innerD = Math.max(4, plate.depth - inset * 2);
  const area = Math.min(80, innerW * innerD * 0.16);
  const aspect = innerW / innerD;
  let w = Math.sqrt(Math.max(area, 16) * aspect);
  let d = Math.max(area, 16) / w;
  w = clamp(w, 4, innerW);
  d = clamp(d, 4, innerD);
  return clampCore({
    x: inset + (innerW - w) / 2,
    y: inset + (innerD - d) / 2,
    w,
    d,
  }, plate);
}

/**
 * 내부형 램프 모양 (추가 2026-11-10)
 * 도로변 변에서 직선으로 들어가다가, 층고를 다 내려가기 전에 반대쪽 순환 차로에 닿으면
 * 90° 곡선(내변 반경 6m, 14% 이하, 2차로 폭 6.5m)으로 꺾어 그 차로를 따라 직선으로 이어간다.
 * 근거: 주차장법 시행규칙 제6조①5 (가: 곡선 내변반경 6m, 다: 곡선 2차로 6.5m, 라: 직선 17%·곡선 14%, 바: 도로변 3m 8.5%)
 * 외부형 램프는 바꾸지 않는다(항상 직선).
 *
 * 반환: { kind: "straight" | "curved", ok, reason, pieces: [사각형], polygons: [[{x,y}...]],
 *        path: [{x,y,s}] (중심선, s=누적 길이), segments: [{name,length,drop}], total,
 *        approach: 사각형(도착 차로) | null, lip: 사각형(도착 경계) | null }
 */
export const RAMP_R_IN = 6;
export const RAMP_CURVE_W = 6.5;

export function rampShape(ramp, plate) {
  return withGap(ramp, plate, rampShapeRaw);
}
function rampShapeRaw(ramp, plate) {
  const box = rampFootprint(ramp, plate);
  const H = floorHeightOf(plate);
  const tr = rampTransitions(plate);
  const straight = {
    kind: "straight", ok: true, reason: "",
    pieces: [box],
    polygons: [rectPoly(box)],
    path: [],
    segments: [],
    total: ramp.length,
    approach: null,
    lip: null,
  };
  if ((ramp.placement || "internal") === "external") return straight;

  const vertical = ramp.edge === "n" || ramp.edge === "s";
  const across = vertical ? plate.depth : plate.width;
  const along = vertical ? plate.width : plate.depth;
  const need = minStraightRampLength(H, tr);
  const v0 = insetOf(ramp);                             // 경사 시작 (외벽에서 11m, 도로 쪽 벽 줄 없는 안은 6m)
  // 직선 램프는 반대쪽 벽 앞 6m(도착 후 꺾는 자리)까지 쓸 수 있다. 그 자리는 반대쪽 순환 차로와 이어지고,
  // 램프 줄에 걸린 반대쪽 주차칸 몇 칸만 빠진다. 곡선으로 꺾는 것보다 버리는 면적이 훨씬 적다.
  const maxStraight = across - v0 - AISLE;
  const toLocal = localFrame(ramp.edge, plate);
  if (Math.max(ramp.length, need) <= maxStraight + 1e-6) {
    // 직선으로 충분: 기존과 같은 사각형. 중심선만 추가.
    const L = ramp.length;
    straight.path = [toLocal.pt(ramp.t, v0, 0), toLocal.pt(ramp.t, v0 + L, L)];
    straight.segments = straightSegments(L, tr, H);
    return straight;
  }

  const W = Math.max(AISLE, ramp.width || AISLE, RAMP_CURVE_W);   // 곡선 포함 램프는 전 구간 6.5m
  const Wc = W;
  const Ri = RAMP_R_IN;
  const sgn = ramp.t <= along / 2 ? 1 : -1;           // 가운데 쪽으로 꺾는다
  const Rc = Ri + W / 2;                                // 직선 중심선 ~ 곡선 중심
  // 곡선 뒤 직선(도착 차선)을 반대쪽 벽에 붙인다 → 첫 직선이 세로 길이를 끝까지 쓰고 모서리를 버리지 않는다.
  const farCenter = across - Wc / 2;
  const s1 = round1(farCenter - Rc - v0);               // 첫 직선 길이
  const uc = ramp.t + sgn * Rc;
  const vc = v0 + s1;
  const arcR = Ri + Wc / 2;
  const arc = (Math.PI / 2) * arcR;
  const drop1Max = straightDrop(s1, tr.top);
  const dropArcMax = arc * RAMP_SLOPE_CURVE;
  const bottomDrop = Math.min(H, tr.bottom * GENTLE_SLOPE);     // 아랫부분 완화구간(오목형)에서 내려가는 높이
  const rest = Math.max(0, H - bottomDrop - drop1Max - dropArcMax);
  // 직선+곡선만으로 더 내려갈 수 있으면 그만큼 완만하게 만든다(경사를 같은 비율로 낮춤).
  const ease = rest > 0 ? 1 : Math.max(0, H - bottomDrop) / (drop1Max + dropArcMax);
  const dropArc = dropArcMax * ease;
  const s2main = rest > 0 ? Math.ceil((rest / RAMP_SLOPE_STRAIGHT) * 10) / 10 : 0;
  const s2 = round1(s2main + tr.bottom);                    // 곡선 뒤 직선 = 본 경사 + 아랫부분 완화구간
  const uEnd = uc + sgn * s2;
  const laneV0 = vc + Ri;
  const laneV1 = vc + Ri + W;

  let reason = "";
  if (s1 < tr.top + 1) reason = "주차장 깊이가 짧아 곡선 램프를 둘 수 없습니다";
  const exitFar = uEnd + sgn * AISLE;
  if (!reason && (exitFar < STALL_D - 1e-6 || exitFar > along - STALL_D + 1e-6)) reason = "곡선 뒤 직선 램프가 들어갈 길이가 부족합니다";

  const piecesLocal = [
    { u0: ramp.t - W / 2, u1: ramp.t + W / 2, v0, v1: v0 + s1 },
    ...arcSectors(uc, vc, Ri, Ri + Wc, sgn, 3),
  ];
  if (s2 > 0) piecesLocal.push({ u0: Math.min(uc, uEnd), u1: Math.max(uc, uEnd), v0: laneV0, v1: laneV1 });
  const pieces = piecesLocal.map(toLocal.rect);

  const arcPoly = [];
  const steps = 16;
  for (let i = 0; i <= steps; i += 1) {
    const th = Math.PI - (i / steps) * (Math.PI / 2);
    arcPoly.push(toLocal.pt(uc + sgn * (Ri + Wc) * Math.cos(th), vc + (Ri + Wc) * Math.sin(th)));
  }
  for (let i = steps; i >= 0; i -= 1) {
    const th = Math.PI - (i / steps) * (Math.PI / 2);
    arcPoly.push(toLocal.pt(uc + sgn * Ri * Math.cos(th), vc + Ri * Math.sin(th)));
  }
  const polygons = [rectPoly(pieces[0]), arcPoly];
  if (s2 > 0) polygons.push(rectPoly(pieces[pieces.length - 1]));

  // 중심선 (3D 경사면용). s = 출발점부터 누적 길이, h = 누적 하강 높이
  const at = (p, h) => ({ ...p, h: round3(h) });
  const path = [at(toLocal.pt(ramp.t, v0, 0), 0)];
  if (tr.top > 0 && s1 > tr.top) path.push(at(toLocal.pt(ramp.t, v0 + tr.top, tr.top), straightDrop(tr.top, tr.top) * ease));
  path.push(at(toLocal.pt(ramp.t, v0 + s1, s1), drop1Max * ease));
  for (let i = 1; i <= steps; i += 1) {
    const th = Math.PI - (i / steps) * (Math.PI / 2);
    path.push(at(toLocal.pt(uc + sgn * Rc * Math.cos(th), vc + Rc * Math.sin(th), s1 + arc * (i / steps)), (drop1Max + dropArcMax * (i / steps)) * ease));
  }
  if (s2main > 0) path.push(at(toLocal.pt(uc + sgn * s2main, vc + Rc, s1 + arc + s2main), H - bottomDrop));
  if (s2 > 0) path.push(at(toLocal.pt(uEnd, vc + Rc, s1 + arc + s2), H));

  // 도착 자리: 차선 끝에서 차로 폭만큼, 반대쪽 순환 차로부터 벽까지 터서 순환 차로로 이어 준다.
  const farStart = across - (STALL_D + AISLE);
  const approach = toLocal.rect({ u0: Math.min(uEnd, exitFar), u1: Math.max(uEnd, exitFar), v0: Math.min(farStart, laneV0), v1: Math.max(across, laneV1) });
  const lipU = sgn > 0 ? [uEnd - 0.2, uEnd + 1.0] : [uEnd - 1.0, uEnd + 0.2];
  const lip = toLocal.rect({ u0: lipU[0], u1: lipU[1], v0: laneV0, v1: laneV1 });
  const segments = straightSegments(s1, { ...tr, bottom: 0 }, H)
    .map((seg) => ({ ...seg, drop: round3(seg.drop * ease) }))
    .concat([{ name: "곡선", length: round1(arc), drop: round3(dropArc) }]);
  segments.forEach((seg) => { seg.slope = seg.length ? round3(seg.drop / seg.length) : 0; });
  if (s2main > 0) segments.push({ name: "곡선 뒤 직선", length: s2main, drop: round3(rest), slope: round3(rest / s2main) });
  if (tr.bottom > 0) segments.push({ name: "완화구간(오목형)", length: tr.bottom, drop: round3(bottomDrop), slope: round3(bottomDrop / tr.bottom) });

  return {
    kind: "curved", ok: !reason, reason,
    pieces, polygons, path, segments,
    total: round1(s1 + arc + s2),
    approach, lip, turn: sgn,
  };
}

/** 처음 top m는 8.5%, 나머지는 17%로 length m를 갈 때 내려가는 높이 */
function straightDrop(length, top) {
  const g = Math.min(length, top);
  return g * GENTLE_SLOPE + Math.max(0, length - top) * RAMP_SLOPE_STRAIGHT;
}

/** 직선 램프 구간: 윗부분 완화(8.5%) → 본 경사 → 아랫부분 완화(8.5%) */
function straightSegments(length, trans, H = FLOOR_H) {
  const { top, bottom } = transOf(trans);
  const gentle = trans && typeof trans === "object" ? trans.gentle !== false : trans !== false;
  length = Math.max(0, length);
  const t = Math.min(length, top);
  const b = Math.min(Math.max(0, length - t), bottom);
  const main = Math.max(0, length - t - b);
  const easeDrop = (t + b) * GENTLE_SLOPE;
  const out = [];
  if (t > 0) {
    const name = gentle && top >= GENTLE_LEN ? "도로변 완경사·완화(볼록형)" : "완화구간(볼록형)";
    out.push({ name, length: round1(t), drop: round3(t * GENTLE_SLOPE) });
  }
  if (main > 0) out.push({ name: "직선", length: round1(main), drop: round3(Math.min(Math.max(0, H - easeDrop), main * RAMP_SLOPE_STRAIGHT)) });
  if (b > 0) out.push({ name: "완화구간(오목형)", length: round1(b), drop: round3(b * GENTLE_SLOPE) });
  return out;
}

/** 1/4 원환을 각도 구간별 사각형 여러 개로 덮는다 (사각형 기반 충돌 검사용). */
function arcSectors(uc, vc, r0, r1, sgn, count) {
  const out = [];
  for (let k = 0; k < count; k += 1) {
    const a0 = Math.PI - (k / count) * (Math.PI / 2);
    const a1 = Math.PI - ((k + 1) / count) * (Math.PI / 2);
    const us = [];
    const vs = [];
    for (let i = 0; i <= 4; i += 1) {
      const th = a0 + (a1 - a0) * (i / 4);
      [r0, r1].forEach((r) => {
        us.push(uc + sgn * r * Math.cos(th));
        vs.push(vc + r * Math.sin(th));
      });
    }
    out.push({ u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) });
  }
  return out;
}

/** 램프 변 기준 좌표(u: 변을 따라, v: 변에서 안쪽으로) → 평면 좌표 */
function localFrame(edge, plate) {
  const pt = (u, v, s) => {
    const p = edge === "s" ? { x: u, y: v }
      : edge === "n" ? { x: u, y: plate.depth - v }
        : edge === "w" ? { x: v, y: u }
          : { x: plate.width - v, y: u };
    if (s != null) p.s = s;
    return p;
  };
  const rect = ({ u0, u1, v0, v1 }) => {
    const a = pt(u0, v0);
    const b = pt(u1, v1);
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x: round3(x), y: round3(y), w: round3(Math.abs(a.x - b.x)), d: round3(Math.abs(a.y - b.y)) };
  };
  return { pt, rect };
}

function rectPoly(r) {
  return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.d }, { x: r.x, y: r.y + r.d }];
}

/**
 * 내부형 램프의 경사는 외벽이 아니라 외곽 주차줄 + 순환 차로(11m) 안쪽에서 시작한다. (수정 2026-11-10)
 * 모든 지하층에서 램프가 같은 자리에 겹치므로, 아래층에 도착한 차가 순환 차로를 한 바퀴 돌아
 * 모서리에서 같은 위치의 램프 입구로 들어갈 수 있게 하기 위해서다. 지상에서는 도로에서 이 11m를 평지로 진입한다.
 */
export let RAMP_INSET = STALL_D + AISLE;
// 램프 경사 시작 위치(벽에서): 기본은 벽 쪽 줄 + 순환 차로 뒤. 도로 쪽 벽 줄을 뺀 안은 ramp.inset(= 차로 폭)으로 기록.
function insetOf(ramp) {
  if (ramp && ramp.inset != null) return ramp.inset;
  if (ramp && ramp.offset != null) return ramp.offset;   // 화면(바깥 좌표)에서 그릴 때: 사용자가 떨어뜨려 놓은 거리
  return RAMP_INSET;
}   // 줄 깊이(STALL_D)가 바뀌면 layoutParking에서 다시 맞춘다

export function rampFootprint(ramp, plate) {
  return withGap(ramp, plate, rampFootprintRaw);
}
function rampFootprintRaw(ramp, plate) {
  const { edge, t, width, length } = ramp;
  const external = (ramp.placement || "internal") === "external";
  const k = insetOf(ramp);
  if (edge === "s") return { x: t - width / 2, y: external ? -length : k, w: width, d: length };
  if (edge === "n") return { x: t - width / 2, y: external ? plate.depth : plate.depth - k - length, w: width, d: length };
  if (edge === "w") return { x: external ? -length : k, y: t - width / 2, w: length, d: width };
  return { x: external ? plate.width : plate.width - k - length, y: t - width / 2, w: length, d: width };
}

/** 내부형 램프 입구(경사 시작) 쪽 경계. 아래층에서 차가 들어오는 곳이다. */
export function rampTopLip(ramp, plate) {
  return withGap(ramp, plate, rampTopLipRaw);
}
function rampTopLipRaw(ramp, plate) {
  const k = insetOf(ramp);
  const half = ramp.width / 2;
  if (ramp.edge === "w") return { x: k - 1.0, y: ramp.t - half, w: 1.2, d: ramp.width };
  if (ramp.edge === "e") return { x: plate.width - k - 0.2, y: ramp.t - half, w: 1.2, d: ramp.width };
  if (ramp.edge === "s") return { x: ramp.t - half, y: k - 1.0, w: ramp.width, d: 1.2 };
  return { x: ramp.t - half, y: plate.depth - k - 0.2, w: ramp.width, d: 1.2 };
}

export function defaultRampLength(plate, edge) {
  const span = edge === "n" || edge === "s" ? plate.depth : plate.width;
  // 램프 길이는 층고와 법정 경사(직선 17%·완화구간)로 정한 최소 길이로 고정한다. 깊이가 모자라면 곡선(14%)으로 꺾는다.
  void span;
  return round1(Math.max(AISLE, minStraightRampLength(floorHeightOf(plate), rampTransitions(plate))));
}

/** 코어가 램프와 겹치면 가장 적게 움직이는 방향으로 램프 옆에 붙인다. */
function withArrivalZone(box, ramp, plate) {
  if (rampShape(ramp, plate).kind !== "straight") return box;
  const z = AISLE;
  const out = { ...box };
  if (ramp.edge === "w") out.w = Math.min(plate.width - box.x, box.w + z);
  else if (ramp.edge === "e") { out.x = Math.max(0, box.x - z); out.w = box.x + box.w - out.x; }
  else if (ramp.edge === "s") out.d = Math.min(plate.depth - box.y, box.d + z);
  else { out.y = Math.max(0, box.y - z); out.d = box.y + box.d - out.y; }
  return out;
}

function pushOutOf(core, box, plate, lines) {
  if (overlapArea(core, box) < 0.01) return core;
  // 사용자가 끌어다 놓은 코어(manual)는 격자 칸을 찾아 멀리 보내지 않고, 램프 면에 가장 적게 밀어 붙인다.
  if (core.manual) {
    const opts = [
      { x: box.x - core.w, y: core.y },
      { x: box.x + box.w, y: core.y },
      { x: core.x, y: box.y - core.d },
      { x: core.x, y: box.y + box.d },
    ].filter((m) => m.x >= -1e-6 && m.y >= -1e-6 && m.x + core.w <= plate.width + 1e-6 && m.y + core.d <= plate.depth + 1e-6)
      .sort((a, b) => Math.hypot(a.x - core.x, a.y - core.y) - Math.hypot(b.x - core.x, b.y - core.y));
    if (opts.length) return { ...core, x: round3(opts[0].x), y: round3(opts[0].y) };
  }
  // 실제 격자가 주어지면: 램프와 안 겹치고 순환 차로 안쪽에 들어가는 격자 칸 중 원래 자리에서 가장 가까운 칸
  if (lines && core.grid !== false && plate.spacing > 0) {
    const ring = STALL_D + AISLE;
    const nx = core.nx || 1;
    const ny = core.ny || 1;
    let best = null;
    for (let i = 0; i + nx < lines.gx.length; i += 1) for (let j = 0; j + ny < lines.gy.length; j += 1) {
      // 기둥 격자 먼저 방식은 칸 간격이 달라 코어 크기는 그대로 두고 자리만 격자선에 맞춘다
      const keepSize = plate.moduleGrid !== false && plate.gridFirst !== false;
      const c = keepSize ? { ...core, x: lines.gx[i], y: lines.gy[j] }
        : { ...core, x: lines.gx[i], y: lines.gy[j], w: round3(lines.gx[i + nx] - lines.gx[i]), d: round3(lines.gy[j + ny] - lines.gy[j]) };
      if (!keepSize && (c.w < nx * plate.spacing * 0.75 || c.d < ny * plate.spacing * 0.75)) continue;
      if (c.x + c.w > plate.width + 1e-6 || c.y + c.d > plate.depth + 1e-6) continue;
      if (overlapArea(c, box) > 0.01) continue;
      if ((plate.voids || []).some((v) => overlapArea(c, v) > 0.01)) continue;
      if (c.x < ring - 0.3 || c.y < ring - 0.3 || c.x + c.w > plate.width - ring + 0.3 || c.y + c.d > plate.depth - ring + 0.3) continue;
      const dist = Math.hypot(c.x - core.x, c.y - core.y);
      if (!best || dist < best.dist) best = { c, dist };
    }
    if (best) return best.c;
  }
  // 격자 맞춤 코어는 밀어낸 뒤에도 기둥 면에 맞춘다.
  const colW = plate.columnWidth || COLUMN;
  const colD = plate.columnDepth || colW;
  const { gx, gy } = lines || coreGridLines(plate);
  // 격자 맞춤 코어는 격자선(기둥 중심선)에 맞춘다(코어 1칸 = 기둥 간격).
  const facesX = gx;
  const facesY = gy;
  const snapUp = (faces, min) => faces.filter((f) => f >= min - 1e-6).sort((p, q) => p - q)[0];
  const snapDown = (faces, maxStart) => faces.filter((f) => f <= maxStart + 1e-6).sort((p, q) => q - p)[0];
  const grid = core.grid !== false && plate.spacing > 0;
  // 램프에 바로 붙인 자리(raw)와 기둥 면에 맞춘 자리(snap)를 둘 다 후보로 둔다. 격자 자리를 조금 더 선호.
  const raw = [
    { x: box.x - core.w, y: core.y },
    { x: box.x + box.w, y: core.y },
    { x: core.x, y: box.y - core.d },
    { x: core.x, y: box.y + box.d },
  ].map((m) => ({ ...m, off: grid ? 60 : 0 }));   // 격자 맞춤 코어는 격자 자리를 훨씬 우선
  const snapped = grid ? [
    { x: snapDown(facesX, box.x - core.w), y: core.y },
    { x: snapUp(facesX, box.x + box.w), y: core.y },
    { x: core.x, y: snapDown(facesY, box.y - core.d) },
    { x: core.x, y: snapUp(facesY, box.y + box.d) },
  ].map((m) => ({ ...m, off: 0 })) : [];
  const moves = raw.concat(snapped).filter((m) => Number.isFinite(m.x) && Number.isFinite(m.y)
    && m.x >= -1e-6 && m.y >= -1e-6 && m.x + core.w <= plate.width + 1e-6 && m.y + core.d <= plate.depth + 1e-6);
  if (!moves.length) return core;
  // 순환 차로(외벽에서 주차 줄 + 차로) 안쪽에 들어가는 자리를 먼저 고른다. 차로를 끊으면 바깥 줄이 통째로 빠진다.
  const ring = STALL_D + AISLE;
  const inside = (m) => m.x >= ring - 0.3 && m.y >= ring - 0.3 && m.x + core.w <= plate.width - ring + 0.3 && m.y + core.d <= plate.depth - ring + 0.3;
  const cost = (m) => (inside(m) ? 0 : 1000) + m.off + Math.abs(m.x - core.x) + Math.abs(m.y - core.y);
  moves.sort((a, b) => cost(a) - cost(b));
  const r2 = (v) => Math.round(v * 100) / 100;
  const best = moves[0];
  return { ...core, x: r2(best.x), y: r2(best.y) };
}

export function clampCore(core, plate) {
  // 코어는 평면 안 어디든(외벽·램프 옆에 붙여도) 둘 수 있다. 램프와 겹치면 레이아웃에서 램프 옆으로 밀어낸다.
  const inset = 0;
  const maxW = Math.max(3, plate.width - inset * 2);
  const maxD = Math.max(3, plate.depth - inset * 2);
  const w = clamp(core.w, 3, maxW);
  const d = clamp(core.d, 3, maxD);
  const r2 = (v) => Math.round(v * 100) / 100;   // 격자 맞춤(기둥 면 = 격자선 ± 0.25)이 깨지지 않게 0.01m 단위
  const out = {
    w: r2(w),
    d: r2(d),
    x: r2(clamp(core.x, inset, plate.width - inset - w)),
    y: r2(clamp(core.y, inset, plate.depth - inset - d)),
  };
  if (core.grid != null) out.grid = core.grid;
  if (core.nx) out.nx = core.nx;
  if (core.ny) out.ny = core.ny;
  if (core.manual) out.manual = true;
  if (core.door) out.door = core.door;
  return out;
}

// ── 코어 격자 맞춤 ───────────────────────────────────────────
// 코어 테두리를 기둥 면에 맞춘다: 가로 nx칸 × 세로 ny칸, 크기 = 칸 간격 합 − 기둥 단면.
// 그러면 코어 옆 주차 줄이 기둥 베이와 같은 선에서 끊겨 빈칸·짧은 줄이 덜 생긴다.
export function coreGridLines(plate) {
  const c = edgeGap(plate);
  const depth = plate.depth - 2 * c;
  // 기본 배치(가로 베이)의 모듈 격자와 같게: 세로 방향은 첫 안쪽 줄 앞선 + 기둥 반 두께에서 8.2m 간격
  const gy = plate.moduleGrid === false || plate.spansY
    ? gridLinesFrom(depth, plate.spansY, plate.spacing)
    : moduleLines(depth, moduleSpan(), STALL_D + AISLE + (plate.columnDepth || COLUMN) / 2);
  return {
    gx: gridLinesFrom(plate.width - 2 * c, plate.spansX, plate.spacing).map((v) => round3(v + c)),
    gy: gy.map((v) => round3(v + c)),
  };
}

// 코어는 격자선(기둥 중심선)에서 격자선까지 — 1칸 = 기둥 간격(8.1×8.1m). 코어 칸에는 기둥을 두지 않는다(코어 벽이 받음).
function snapAxis(lines, start, cells, colW) {
  const half = 0;
  let best = null;
  for (let i = 0; i + cells < lines.length; i += 1) {
    const a = lines[i] + half;
    const b = lines[i + cells] - half;
    const score = Math.abs(a - start);
    if (!best || score < best.score) best = { pos: a, size: b - a, score };
  }
  return best;
}

export function snapCore(core, plate) {
  if (!core || core.grid === false) return core;
  const { gx, gy } = coreGridLines(plate);
  const colW = plate.columnWidth || COLUMN;
  const colD = plate.columnDepth || colW;
  const step = plate.spacing || 8.1;
  const maxX = Math.max(1, gx.length - 1);
  const maxY = Math.max(1, gy.length - 1);
  const nx = clamp(core.nx || Math.max(1, Math.round(core.w / step)), 1, maxX);
  const ny = clamp(core.ny || Math.max(1, Math.round(core.d / step)), 1, maxY);
  const sx = snapAxis(gx, core.x, nx, colW);
  const sy = snapAxis(gy, core.y, ny, colD);
  if (!sx || !sy) return core;
  const r2 = (v) => Math.round(v * 100) / 100;
  return { ...core, x: r2(sx.pos), w: r2(sx.size), y: r2(sy.pos), d: r2(sy.size), nx, ny, grid: true };
}

/**
 * 기둥 간격으로 코어 칸 수 추천.
 * 기준: 아파트 1개 동 코어(계단 + 승강기 2대 + 전실) 대략 50㎡ 이상이 들어가는 가장 작은 칸 수.
 * 기둥 8.1m면 1칸 = 8.1×8.1m(66㎡, 격자선~격자선) → 1×1칸.
 */
export const CORE_TARGET_AREA = 50;
export function recommendCoreCells(plate) {
  const colW = plate.columnWidth || COLUMN;
  const colD = plate.columnDepth || colW;
  const step = plate.spacing || 8.1;
  const options = [[1, 1], [2, 1], [1, 2], [2, 2], [3, 1], [3, 2]];
  for (const [nx, ny] of options) {
    const w = nx * step;
    const d = ny * step;
    if (w * d >= CORE_TARGET_AREA && Math.min(w, d) >= 5) return { nx, ny, w, d };
  }
  return { nx: 2, ny: 2, w: 2 * step, d: 2 * step };
}

export function clampOpening(item, plate) {
  if (!item) return item;
  const along = item.edge === "n" || item.edge === "s" ? plate.width : plate.depth;
  const across = item.edge === "n" || item.edge === "s" ? plate.depth : plate.width;
  const width = clamp(item.width, 3, Math.max(3, along - 0.4));
  const t = clamp(item.t, width / 2, along - width / 2);
  const next = { ...item, width: round1(width), t: round1(t) };
  if (item.length != null) {
    const limit = (item.placement || "internal") === "external"
      ? 40
      : Math.max(AISLE, across * 0.85);
    next.length = round1(clamp(item.length, AISLE, limit));
  }
  return next;
}

export function edgePoint(edge, t, plate) {
  if (edge === "s") return { x: t, y: 0 };
  if (edge === "n") return { x: t, y: plate.depth };
  if (edge === "w") return { x: 0, y: t };
  return { x: plate.width, y: t };
}

export function pickEdge(point, plate) {
  const options = [
    { edge: "s", dist: Math.abs(point.y), t: point.x, len: plate.width },
    { edge: "n", dist: Math.abs(point.y - plate.depth), t: point.x, len: plate.width },
    { edge: "w", dist: Math.abs(point.x), t: point.y, len: plate.depth },
    { edge: "e", dist: Math.abs(point.x - plate.width), t: point.y, len: plate.depth },
  ];
  options.sort((a, b) => a.dist - b.dist);
  const nearest = options[0];
  const limit = Math.max(2.5, Math.min(plate.width, plate.depth) * 0.18);
  if (nearest.dist > limit) return null;
  return nearest;
}

export function intervalsOverlap(a, b) {
  if (!a || !b || a.edge !== b.edge) return false;
  return Math.abs(a.t - b.t) < (a.width + b.width) / 2 - 0.25;
}

// 배치안 4가지: 안쪽 줄 방향(가로/세로) · 채우는 시작 쪽 · 안쪽 줄 수. 램프 형식(내부/외부)과 위치는 조건 단계에서 고른 대로 둔다.
// (예전 V5 "램프 반대쪽 + 내부↔외부 바꾸기"는 고르지 않은 램프 형식이 나와 대지 밖 탈락이 잦아 뺐다. 2026-11-11)
export function variantSpecs(basePlacement = "external") {
  return [
    { axis: "x", dir: "ccw", packFrom: "start", bayMode: "max", rampShift: 0, rampPlacement: basePlacement, entranceMode: "follow" },
    { axis: "y", dir: "ccw", packFrom: "start", bayMode: "max", rampShift: 0, rampPlacement: basePlacement, entranceMode: "follow" },
    { axis: "x", dir: "ccw", packFrom: "end", bayMode: "max", rampShift: 0, rampPlacement: basePlacement, entranceMode: "follow" },
    { axis: "x", dir: "ccw", packFrom: "start", bayMode: "minus1", rampShift: 0, rampPlacement: basePlacement, entranceMode: "follow" },
  ];
}

/**
 * 램프 위치(도로변 안)와 코어 위치(기둥 격자 칸)를 함께 돌려 보고 대수가 가장 많은 조합을 고른다.
 * - 코어 후보: 코어가 들어가는 모든 격자 자리(기둥 면에 맞춤) 중 램프와 겹치지 않는 곳.
 * - 빠르게 거르기 위해 배치안 두 개(가로 베이·세로 베이)만 짜 보고 점수를 낸다.
 * - 코어가 하나이고 격자 맞춤일 때만 코어를 옮긴다.
 */
export function searchPlacement(input, positions) {
  const raw = input.plate;
  const plate = normalizePlate(raw);
  STALL_D = extendedRequired(raw) ? STALL_D_EXTENDED : STALL_D_GENERAL;
  RAMP_INSET = STALL_D + AISLE;
  const placement = input.rampPlacement || input.ramps?.[0]?.placement || "internal";
  const specs = (input.searchSpecs || [0]).map((k) => variantSpecs(placement)[k]);
  const allSpecs = variantSpecs(placement);
  let shallow = false;   // 얕은 평면(순환 차로 안쪽 칸 없음): 배치안 전부로 점수를 매긴다
  const cores = input.cores || [];
  const movable = cores.length === 1 && cores[0].grid !== false && plate.spacing > 0;
  const score = (inp) => (shallow ? allSpecs : specs).reduce((best, spec) => {
    const r = layoutParking({ ...inp, spec });
    return Math.max(best, (r.metrics.valid ? 100000 : 0) + r.metrics.stalls);
  }, -1);
  const coreCandidates = (ramp) => {
    if (!movable) return [cores];
    const core = cores[0];
    const { gx, gy } = coreGridLines(plate);
    const nx = core.nx || 1;
    const ny = core.ny || 1;
    const box = rampFootprint({ ...ramp, width: Math.max(AISLE, ramp.width || AISLE) }, plate);
    const collect = (roadRing) => {
      const list = [];
      for (let i = 0; i + nx < gx.length; i += 1) {
        for (let j = 0; j + ny < gy.length; j += 1) {
          const c = snapCore({ ...core, x: gx[i], y: gy[j], nx, ny, grid: true }, plate);
          if (Math.abs(c.w - core.w) > 0.3 || Math.abs(c.d - core.d) > 0.3) continue;   // 가장자리 짜투리 칸은 크기가 달라 제외(8.1/8.2 모듈 차이는 허용)
          if (overlapArea(c, box) > 0.01) continue;
          // 순환 차로를 물면 차로가 코어를 돌아 ㄷ자로 꺾인다 → 순환 차로 안쪽 칸만 후보
          const ring = edgeGap(plate) + STALL_D + AISLE;
          const r = (side) => (roadRing === -100 ? -100 : side === ramp.edge && roadRing != null ? roadRing : ring);
          if (c.x < r("w") - 0.3 || c.y < r("s") - 0.3 || c.x + c.w > plate.width - r("e") + 0.3 || c.y + c.d > plate.depth - r("n") + 0.3) continue;
          list.push([c]);
        }
      }
      return list;
    };
    let list = collect(null);
    // 깊이가 짧아 순환 차로 안쪽 칸이 없으면(도로 쪽 벽 줄 없는 안이 쓰일 평면) 모든 칸을 돌려 보고 대수로 고른다
    if (!list.length) { list = collect(-100); shallow = true; }
    return [cores].concat(list);   // 지금 자리도 후보
  };
  let best = null;
  (positions && positions.length ? positions : [null]).forEach((pos) => {
    const ramps = (input.ramps || []).map((r, k) => (k === 0 && pos ? { ...r, pos } : r));
    const ramp0 = ramps[0] || defaultRamp(plate, placement);
    // 1차: 막다른 차로 정리를 끄고(15배 빠름) 모든 후보를 거른다. 2차: 상위 3개만 정리까지 해서 비교.
    const quick = { ...raw, trimDeadEnds: false };
    const ranked = coreCandidates(ramp0)
      .map((cand) => ({ cand, value: score({ ...input, plate: quick, ramps, cores: cand }) }))
      .sort((p, q) => q.value - p.value)
      .slice(0, 3);
    ranked.forEach(({ cand }) => {
      const value = score({ ...input, ramps, cores: cand });
      if (!best || value > best.value) best = { value, pos, cores: cand };
    });
  });
  return best;
}

/**
 * 도로변 안 램프 위치(start/mid/end)마다 램프가 들어가는지 빠르게 확인한다(조건 단계 선택칸 표시용).
 * 막다른 차로 정리를 끄고 배치안 하나만 짜서 경사·대지 기준만 본다.
 */
const rampCheckMemo = new Map();
export function rampPositionCheck(plate, placement, floorHeight, positions = ["start", "mid", "end"], stopAtOk = false) {
  const memoKey = JSON.stringify([plate.width, plate.depth, plate.outline, plate.spacing, plate.spansX, plate.spansY, plate.columnWidth, plate.columnDepth, plate.roadEdge, plate.legalStalls, plate.siteMargin, plate.siteMargins, plate.floorHeight, plate.minClear, plate.stallRules, placement, floorHeight, positions, stopAtOk]);
  if (rampCheckMemo.has(memoKey)) return { ...rampCheckMemo.get(memoKey) };
  if (rampCheckMemo.size > 50) rampCheckMemo.clear();
  const out = rampPositionCheckRaw(plate, placement, floorHeight, positions, stopAtOk);
  rampCheckMemo.set(memoKey, out);
  return { ...out };
}
function rampPositionCheckRaw(plate, placement, floorHeight, positions, stopAtOk) {
  const legal = plate.legalStalls || 0;
  const length = minStraightRampLength(floorHeight || plate.floorHeight || 3.2, rampTransitions({ legalStalls: legal }));
  const quick = { ...plate, trimDeadEnds: false };
  const edge = plate.roadEdge || "w";
  const out = {};
  let found = false;
  positions.forEach((pos) => {
    if (stopAtOk && found) return;
    const r = layoutParking({
      plate: quick,
      cores: [defaultCore(quick)],
      ramps: [{ id: 1, edge, t: 0, pos, width: AISLE, length, placement }],
      openings: [],
      rampPlacement: placement,
      entranceMode: "integrated",
      spec: variantSpecs(placement)[0],
    });
    const m = r.metrics;
    out[pos] = m.slopeOk === false ? "경사 초과" : m.siteOk === false ? "대지 밖" : null;
    if (!out[pos]) found = true;
  });
  return out;
}

// 배치안(2026-11-21 정리): 사람이 고르는 기준 3가지만 보여 준다.
//  - 가로 배치: 주차줄이 좌우로. 안에서 '줄 정렬 시작점(루프 쪽/반대쪽)'·'안쪽 줄 최대/하나 줄임'을 모두 짜 보고 가장 좋은 것.
//  - 세로 배치: 주차줄이 위아래로. 같은 방식.
//  - 램프 위치: 위 둘 중 나은 배치로, 램프를 도로변의 다른 자리(처음·가운데·끝)에 놓아 본 것 중 가장 좋은 것.
//    (내부 램프이고 램프를 끌어 놓지 않았을 때만)
// 옵션(input.options): 장애인 칸 코어 옆(coreAisle) · 칸 방향 통일(uniform) · 코어 램프 옆(coreRamp) — 세 안 모두에 적용,
// 옵션 없이 짠 대수(baseStalls)와 차이를 같이 돌려준다.
const RAMP_POS_NAME = { start: "처음", mid: "가운데", end: "끝" };
function sameStalls(a, b) {
  const key = (r) => (r.stalls || []).map((st) => `${Math.round(st.x * 2)},${Math.round(st.y * 2)},${st.type}`).sort().join(";");
  return key(a) === key(b);
}

export function generateVariants(input) {
  const placement = input.rampPlacement || input.ramps?.[0]?.placement || "internal";
  const xSpecs = variantSpecs(placement).filter((spec) => spec.axis === "x");
  const ySpecs = xSpecs.map((spec) => ({ ...spec, axis: "y" }));
  const opts = input.options || {};
  // 속도용: 후보 spec은 코어 구조(rescueCore) 없이 비교하고, 1등이 불가일 때만 구조까지 다시
  const bestOf = (inp, specs) => {
    const top = specs
      .map((spec) => ({ ...layoutParking({ ...inp, spec, noCoreRescue: true }), spec }))
      .sort(compareVariants)[0];
    if (top.metrics.valid) return top;
    const rescued = { ...layoutParking({ ...inp, spec: top.spec }), spec: top.spec };
    return compareVariants(rescued, top) <= 0 ? rescued : top;
  };
  const withOptions = (inp, base) => {
    if (!opts.coreAisle && !opts.uniform && !opts.coreRamp) return base;
    const spec = { ...base.spec, coreAisle: Boolean(opts.coreAisle), uniform: Boolean(opts.uniform) };
    let r = opts.coreAisle || opts.uniform ? { ...layoutParking({ ...inp, spec }), spec } : base;
    const notes = [];
    // 옵션을 켰는데 바뀐 게 없으면 왜 그런지 알려 준다(클릭이 안 먹은 것처럼 보이지 않게)
    if (opts.coreAisle && !(r.metrics && r.metrics.coreAisle)) {
      const w = r.metrics && r.metrics.disabledWalk;
      notes.push(`장애인 칸 코어 옆: 코어 옆에 새 차로를 낼 자리가 없어 그대로${w != null ? ` (지금도 출입문까지 걸어서 ${w}m)` : ""}`);
    }
    if (opts.uniform && sameStalls(r, base) && !opts.coreAisle) notes.push("칸 방향 통일: 방향이 다른 칸이 없어 그대로");
    if (opts.coreRamp) {
      if ((inp.cores || []).length === 1 && (inp.ramps || []).length) {
        const near = coreBesideRamp(inp, { ...r, spec });
        if (near) r = { ...near, spec, coreRamp: true };
        else notes.push("코어 램프 옆: 램프 옆면에 코어를 붙일 수 있는 자리가 없어 그대로");
      } else notes.push("코어 램프 옆: 코어 1개·램프가 있을 때만 됨");
    }
    return { ...r, optionNotes: notes };
  };
  const detail = (spec) => [spec.packFrom === "end" ? "줄 반대쪽 정렬" : "", spec.bayMode === "minus1" ? "안쪽 줄 하나 줄임" : ""].filter(Boolean).join(" · ");
  const list = [];
  const push = (inp, base, name, extra = {}) => {
    const r = withOptions(inp, base);
    const d = detail(base.spec);
    list.push({ ...r, ...extra, name: d ? `${name} · ${d}` : name, spec: r.spec || base.spec, baseStalls: base.metrics.stalls });
  };
  const xBest = bestOf(input, xSpecs);
  const yBest = bestOf(input, ySpecs);
  push(input, xBest, "가로 배치 (주차줄 좌우)", { kind: "x" });
  push(input, yBest, "세로 배치 (주차줄 위아래)", { kind: "y" });
  // 램프 위치안
  const ramp0 = (input.ramps || [])[0];
  if (!input.lockRamp && !input.noRampAlt && ramp0 && placement === "internal" && ramp0.offset == null && !ramp0.fixed) {
    const here = ramp0.pos || "start";
    const lead = compareVariants(xBest, yBest) <= 0 ? xBest : yBest;
    let alt = null;
    ["start", "mid", "end"].filter((pos) => pos !== here).forEach((pos) => {
      const inp = { ...input, ramps: input.ramps.map((r, k) => (k === 0 ? { ...r, pos } : r)) };
      const r = { ...layoutParking({ ...inp, spec: lead.spec, noCoreRescue: true }), spec: lead.spec };
      if (!alt || compareVariants(r, alt.r) < 0) alt = { r, inp, pos };
    });
    // 고른 램프 자리가 불가일 때만 코어 구조까지(속도용)
    if (alt && !alt.r.metrics.valid) {
      const rr = { ...layoutParking({ ...alt.inp, spec: lead.spec }), spec: lead.spec };
      if (compareVariants(rr, alt.r) <= 0) alt.r = rr;
    }
    if (alt) push(alt.inp, alt.r, `램프 위치 바꿈 (도로변 ${RAMP_POS_NAME[alt.pos]}) · ${lead.spec.axis === "x" ? "가로" : "세로"} 배치`, { kind: "ramp", rampPos: alt.pos });
  }
  // 결과가 사실상 같은 안(칸 자리가 같음)은 하나만 남긴다(예: 세로 배치를 시켜도 평면 모양상 가로와 같게 나오는 경우)
  const sig = (v) => `${v.metrics.stalls}|${(v.stalls || []).map((st) => `${Math.round(st.x * 2)},${Math.round(st.y * 2)}`).sort().join(";")}`;
  const seen = new Map();
  for (let k = 0; k < list.length; k += 1) {
    const key = sig(list[k]);
    if (seen.has(key)) {
      const keep = seen.get(key);
      const label = { x: "가로 배치", y: "세로 배치", ramp: "램프 위치 바꾼 안" }[list[k].kind];
      keep.name += ` (${label}도 같은 평면)`;
      list.splice(k, 1); k -= 1;
    } else seen.set(key, list[k]);
  }
  list.forEach((v, k) => { v.id = `V${k + 1}`; v.optionDelta = v.metrics.stalls - v.baseStalls; });
  const ranked = list.map((variant, index) => ({ variant, index })).sort((a, b) => compareVariants(a.variant, b.variant));
  const best = ranked.find((item) => item.variant.metrics.valid);
  list.forEach((variant, index) => { variant.recommended = Boolean(best && best.index === index); variant.maxStalls = false; });
  const valid = list.filter((v) => v.metrics.valid);
  const top = Math.max(-1, ...valid.map((v) => v.metrics.stalls));
  valid.forEach((v) => { v.maxStalls = v.metrics.stalls === top; });
  return list;
}

// 램프(각 조각) 옆면에 코어가 맞닿는 자리를 몇 곳 만들어 보고, 정상 배치 중 대수가 가장 많은 안을 돌려준다.
function coreBesideRamp(input, base) {
  const ramp = base.ramps && base.ramps[0];
  const plate = base.plate || input.plate;
  if (!ramp || !plate) return null;
  if ((ramp.placement || input.rampPlacement || "internal") === "external") return null;
  let pieces;
  try { pieces = rampShape(ramp, plate).pieces || []; } catch (e) { return null; }
  if (!pieces.length) return null;
  const core = input.cores[0];
  const W = core.w;
  const D = core.d;
  const seen = new Set();
  const cands = [];
  const add = (x, y) => {
    const k = `${round1(x)},${round1(y)}`;
    if (seen.has(k)) return;
    seen.add(k);
    if (x < 0 || y < 0 || x + W > plate.width || y + D > plate.depth) return;
    cands.push({ x, y });
  };
  pieces.forEach((p) => {
    const xs = [p.x, p.x + p.w - W, p.x + (p.w - W) / 2];
    const ys = [p.y, p.y + p.d - D, p.y + (p.d - D) / 2];
    // 긴 변(램프 옆면)에만 붙인다. 짧은 변은 입구·도착 쪽이라 막으면 안 된다.
    if (p.w >= p.d) xs.forEach((x) => { add(x, p.y - D); add(x, p.y + p.d); });
    else ys.forEach((y) => { add(p.x - W, y); add(p.x + p.w, y); });
  });
  let best = null;
  for (const c of cands) {
    const r = layoutParking({ ...input, spec: base.spec, cores: [{ ...core, x: c.x, y: c.y, grid: false }], noCoreRescue: true });
    if (!r.metrics.valid) continue;
    const rc = r.cores && r.cores[0];
    if (!rc) continue;
    const touch = pieces.some((p) => rectGap(rc, p) < 0.3);
    if (!touch) continue;
    if (!best || compareVariants(r, best) < 0) best = r;   // 기둥 12m 지키는 자리 먼저, 그다음 대수
  }
  return best;
}

// 내부 직선 램프 자리 두 가지를 모두 짜 보고 대수가 많은 쪽을 고른다(자동 배치일 때만).
//  - 벽에 붙임: 벽 → 램프 → 주차칸 → 순환 차로 (wallStrip). 램프 폭만큼 나머지가 안쪽으로 밀린다.
//  - 순환 차로 줄: 램프가 순환 차로 자리를 쓰고 바깥 주차 줄은 램프를 보게 되어 빠진다.
//  어느 쪽이 나은지는 주차장 크기(안쪽 줄 수)에 따라 달라진다.
export function layoutParking(input) {
  // ramp.inset은 결과값(도로 쪽 벽 줄 없는 안의 램프 시작 위치)이다. 화면이 결과 램프를 다시 넣어도
  // 매번 처음부터 계산하도록 지운다(안 지우면 다시 그릴 때마다 5.2m씩 벽 쪽으로 밀려 대지 밖으로 나감).
  if (input.ramps && input.ramps.some((r) => r && (r.inset != null || r.offset != null))) {
    const gap = edgeGap(input.plate || input);
    input = { ...input, ramps: input.ramps.map((r) => {
      if (!r) return r;
      const { inset, ...rest } = r;
      // 사용자가 벽에서 떨어뜨려 놓은 램프(offset = 바깥 벽~램프 시작 거리)는 그 자리 그대로
      if (r.offset != null) return { ...rest, inset: Math.max(0, r.offset - gap) };
      return rest;
    }) };
  }
  const res = layoutWithGap(input);
  if (res.metrics.valid || input.noCoreRescue) return res;
  return rescueCore(input, res) || res;
}

// 코어를 끌어다 놓은 자리 때문에만 배치가 불가한 경우(예: 얕은 평면에서 코어가 곡선 램프 도착 자리를 막음),
// 가까운 격자 칸부터 코어를 옮겨 보고 정상 배치가 나오면 그 안을 쓴다(노란 안내).
function rescueCore(input, res) {
  const cores = input.cores || [];
  if (cores.length !== 1 || cores[0].grid === false || cores[0].manual || !input.plate) return null;
  if ((res.metrics.issues || res.issues || []).some((i) => i.type === "site")) return null;
  const raw = input.plate;
  STALL_D = extendedRequired(raw) ? STALL_D_EXTENDED : STALL_D_GENERAL;
  RAMP_INSET = STALL_D + AISLE;
  const plate = normalizePlate(raw);
  if (!(plate.spacing > 0)) return null;
  const core = cores[0];
  const { gx, gy } = coreGridLines(plate);
  const nx = core.nx || 1;
  const ny = core.ny || 1;
  const cx = core.x + core.w / 2;
  const cy = core.y + core.d / 2;
  const seen = new Set();
  const cands = [];
  for (let i = 0; i + nx < gx.length; i += 1) {
    for (let j = 0; j + ny < gy.length; j += 1) {
      const c = snapCore({ ...core, x: gx[i], y: gy[j], nx, ny, grid: true }, plate);
      if (Math.abs(c.w - core.w) > 0.3 || Math.abs(c.d - core.d) > 0.3) continue;
      const key = `${c.x},${c.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cands.push({ c, dist: Math.hypot(c.x + c.w / 2 - cx, c.y + c.d / 2 - cy) });
    }
  }
  cands.sort((a, b) => a.dist - b.dist);
  let best = null;
  for (const { c, dist } of cands.slice(0, 10)) {
    if (dist < 0.5) continue;
    const r = layoutWithGap({ ...input, cores: [c], noCoreRescue: true });
    if (!r.metrics.valid) continue;
    // 가까운 자리를 우선하되, 대수가 3대 이상 많으면 그쪽
    if (!best || r.metrics.stalls >= best.r.metrics.stalls + 3) best = { r, dist };
  }
  if (!best) return null;
  const r = best.r;
  const label = `코어 자리에서는 배치가 안 돼 코어를 가까운 칸으로 ${round1(best.dist)}m 옮겼습니다.`;
  if (r.metrics.issues) r.metrics.issues = r.metrics.issues.concat([{ type: "notice", label }]);
  else if (r.issues) r.issues = r.issues.concat([{ type: "notice", label }]);
  r.coreRescued = true;
  return r;
}

function layoutParkingInner(input) {
  // 주차장법 시행규칙 제11조④ → 제6조①14: 50대 이상 부설주차장은 확장형 30% 이상.
  // 확장형 깊이가 5.2m라서 이때는 모든 주차 줄 깊이를 5.2m로 짠다(일반형도 5.0m 이상이면 되므로 문제없음).
  const raw = input.plate || input;
  STALL_D = extendedRequired(raw) ? STALL_D_EXTENDED : STALL_D_GENERAL;
  RAMP_INSET = STALL_D + AISLE;
  // 모듈 격자(기둥선 정렬)를 기본으로 쓰되, 그 때문에 칸이 많이(5%·3대 이상) 줄면 예전 격자(벽에서 8.1m)를 쓴다.
  // 예) 세로 베이 안은 위·아래 벽 줄이 모듈 격자로 나뉘며 칸을 잃음.
  const normal = layoutGridChoice(input);
  // 도로 쪽 벽 줄 없는 안: 깊이가 짧아 램프가 안 들어가면(배치 불가), 도로 쪽 벽을 따라 순환 차로를 바로 붙이고
  // 램프를 차로 바로 뒤(벽에서 6m)에서 시작한다. 실제 설계에서 흔한 형태(입구 → 벽 따라 차로 → 램프).
  if (normal.metrics.valid || input.noRoadless) return normal;
  if ((input.ramps || []).some((r) => r && r.offset != null)) return normal;   // 직접 놓은 램프는 다른 안으로 바꾸지 않음
  const r0 = (input.ramps || [])[0];
  if (!r0 || (r0.placement || input.rampPlacement || "internal") === "external") return normal;
  const alt = layoutRoadless(input, r0.edge);
  if (!alt) return normal;
  const score = (r) => (r.metrics.valid ? 100000 : 0) + r.metrics.stalls;
  const sn = manualShift(normal, input);
  const sr = manualShift(alt, input);
  if (alt.metrics.valid && normal.metrics.valid && Math.abs(sn - sr) > 1) return sn < sr ? normal : alt;
  return score(alt) > score(normal) ? alt : normal;
}

// 끌어 놓은 코어(manual)가 결과에서 얼마나 옮겨졌는지(m). 대안끼리 고를 때 덜 옮긴 쪽을 우선한다.
function manualShift(result, input) {
  const ins = input.cores || [];
  if (!ins.some((c) => c && c.manual)) return 0;
  const outs = result.cores || [];
  return ins.reduce((sum, c, i) => (c && c.manual && outs[i] ? sum + Math.hypot(outs[i].x - c.x, outs[i].y - c.y) : sum), 0);
}

function layoutGridChoice(input) {
  const raw = input.plate || input;
  if (raw.moduleGrid === false) return layoutRampChoice(input);
  const aligned = layoutRampChoice(input);
  if (!aligned.moduleGrid) return aligned;
  const plain = layoutRampChoice({ ...input, plate: { ...raw, moduleGrid: false } });
  const score = (r) => (r.metrics.valid ? 100000 : 0) + r.metrics.stalls;
  // 끌어 놓은 코어를 덜 옮긴 안을 우선(둘 다 정상일 때, 1m 넘게 차이 나면)
  const sa = manualShift(aligned, input);
  const sp = manualShift(plain, input);
  if (plain.metrics.valid && aligned.metrics.valid && Math.abs(sa - sp) > 1) return sa < sp ? aligned : plain;
  // 기둥 격자 먼저(12m 이하) 방식이면 예전 고정 격자는 기둥 간격 조건을 못 지키므로, 격자 안이 통과 못 할 때만 씀
  if (raw.gridFirst !== false) return !aligned.metrics.valid && plain.metrics.valid ? plain : aligned;
  // 기둥선 정렬을 우선: 예전 격자가 5% 이상(최소 3대) 많을 때만 예전 격자
  const margin = Math.max(3, Math.ceil(aligned.metrics.stalls * 0.05));
  if (score(plain) >= score(aligned) + margin) return plain;
  return aligned;
}

// 도로 쪽 벽 바깥에 가상의 벽 줄(칸 깊이)을 붙인 큰 판에서 배치하고, 가상 부분을 잘라 낸다.
// → 순환 차로가 도로 쪽 벽에 바로 붙고, 램프는 벽에서 차로 폭(6m) 뒤에서 시작한다(엔진의 나머지 규칙은 그대로).
function layoutRoadless(input, edge) {
  const raw = input.plate || input;
  const ext = STALL_D;
  const vertical = edge === "n" || edge === "s";
  const dx = edge === "w" ? ext : 0;
  const dy = edge === "s" ? ext : 0;
  const vplate = { ...raw, width: vertical ? raw.width : raw.width + ext, depth: vertical ? raw.depth + ext : raw.depth };
  // 가상 벽 줄 자리에는 칸을 두지 않게 막는다(장애인·전기차 칸이 잘려 나가지 않도록)
  const vb = edge === "s" ? { x: 0, y: 0, w: vplate.width, d: ext } : edge === "n" ? { x: 0, y: raw.depth, w: vplate.width, d: ext }
    : edge === "w" ? { x: 0, y: 0, w: ext, d: vplate.depth } : { x: raw.width, y: 0, w: ext, d: vplate.depth };
  // 가상 줄은 순환 차로와 이어진 차로로 둔다(가로 방향은 양옆 순환 차로까지만)
  // 가상 줄 + 순환 차로를 한 차로(폭 칸 깊이 + 6m)로 묶어 폭 검사에 걸리지 않게
  const band = ext + AISLE;
  const inner = edge === "s" ? { x: STALL_D, y: 0, w: vplate.width - 2 * STALL_D, d: band }
    : edge === "n" ? { x: STALL_D, y: vplate.depth - band, w: vplate.width - 2 * STALL_D, d: band }
    : edge === "w" ? { x: 0, y: STALL_D, w: band, d: vplate.depth - 2 * STALL_D }
    : { x: vplate.width - band, y: STALL_D, w: band, d: vplate.depth - 2 * STALL_D };
  vplate.extraAisles = (raw.extraAisles || []).concat([inner]);
  const mv = (r, sx, sy) => (r ? { ...r, x: r.x + sx, y: r.y + sy } : r);
  const vin = {
    ...input,
    plate: vplate,
    cores: (input.cores || []).map((c) => mv(c, dx, dy)),
  };
  let res;
  try { res = layoutGridChoice(vin); } catch (error) { return null; }
  const W = raw.width;
  const D = raw.depth;
  const back = (r) => shiftDeep(r, -dx, -dy);
  const clip = (r) => {
    const x0 = Math.max(0, r.x);
    const y0 = Math.max(0, r.y);
    const x1 = Math.min(W, r.x + r.w);
    const y1 = Math.min(D, r.y + r.d);
    return x1 - x0 > 0.05 && y1 - y0 > 0.05 ? { ...r, x: round3(x0), y: round3(y0), w: round3(x1 - x0), d: round3(y1 - y0) } : null;
  };
  const inside = (r) => r.x >= -0.01 && r.y >= -0.01 && r.x + r.w <= W + 0.01 && r.y + r.d <= D + 0.01;
  const stalls = back(res.stalls).filter(inside);
  const columns = back(res.columns).filter((c) => c.x >= -0.6 && c.y >= -0.6 && c.x + c.w <= W + 0.6 && c.y + c.d <= D + 0.6);
  const aisles = back(res.aisles).map(clip).filter(Boolean);
  const dropped = res.stalls.length - stalls.length;
  const typed = tallyStallTypes(stalls, stallRuleTargets(raw.stallRules));
  stalls.forEach((stall, i) => { stall.no = i + 1; });
  const ramps = (res.ramps || []).map((r) => ({ ...r, inset: round3(insetOf(r) - ext) }));
  const f = (W * D) / (vplate.width * vplate.depth);
  const out = {
    ...res,
    plate: { ...res.plate, width: W, depth: D },
    stalls,
    columns,
    aisles,
    cores: back(res.cores),
    drives: back(res.drives || []),
    route: back(res.route || []),
    ramps,
    gridX: (res.gridX || []).map((v) => round3(v - dx)).filter((v) => v >= -0.01 && v <= W + 0.01),
    gridY: (res.gridY || []).map((v) => round3(v - dy)).filter((v) => v >= -0.01 && v <= D + 0.01),
    roadless: edge,
    metrics: {
      ...res.metrics,
      stalls: stalls.length,
      stallTypes: typed.counts,
      stallTargets: typed.targets,
      areaPerStall: stalls.length ? round2m((W * D) / stalls.length) : 0,
      aisleRatio: round3((res.metrics.aisleRatio || 0) / f),
    },
    issues: (res.issues || []).concat([{ type: "roadless", label: `${{ n: "북측", s: "남측", e: "동측", w: "서측" }[edge]} 벽 쪽 주차줄 없이 순환 차로를 벽에 붙여 램프를 넣었습니다(깊이 부족).` }]),
  };
  if (dropped) out.metrics.droppedVirtual = dropped;
  return out;
}

export function extendedRequired(plate) {
  const legal = Number(plate && plate.legalStalls) || Number(plate && plate.stallRules && plate.stallRules.legalStalls) || 0;
  return legal >= 50;
}

function layoutScore(res) {
  // 장애인 코어 인접 안은 코어 옆 차로를 낸 쪽을 대수보다 먼저 고른다.
  const coreSide = res.spec && res.spec.coreAisle && res.metrics.coreAisle ? 50000 : 0;
  return (res.metrics.valid ? 100000 : 0) + coreSide + res.stalls.length * 10 - (Number(res.spec && res.spec.offset) || 0) * 0.01;
}

function layoutRampChoice(input) {
  const pick = (a, b) => (layoutScore(b) > layoutScore(a) ? b : a);
  // 램프 줄 재배치(spec.strip)를 켠 것/끈 것 둘 다 짜 보고 나은 쪽 (코어 위치에 따라 달라진다).
  const withStrip = (inp) => {
    const on = layoutCore({ ...inp, spec: { ...(inp.spec || {}), strip: "auto" } });
    if (!on.strip) return on;
    return pick(on, layoutCore({ ...inp, spec: { ...(inp.spec || {}), strip: "off" } }));
  };
  const base = withStrip(input);
  if (input.lockRamp) return base;
  const r = base.ramps && base.ramps[0];
  if (!r || r.placement === "external" || r.pos === "mid" || r.offset != null || r.fixed) return base;   // 가운데로 정했으면 끝으로 옮기지 않는다
  const vertical = r.edge === "n" || r.edge === "s";
  const along = vertical ? base.plate.width : base.plate.depth;
  const half = r.width / 2;
  const low = r.t < along / 2;
  const wallT = low ? half : along - half;
  const ringT = low ? STALL_D + AISLE / 2 : along - STALL_D - AISLE / 2;
  const altT = Math.abs(r.t - wallT) < 0.01 ? ringT : wallT;
  const { strip, ...specRest } = base.spec || {};
  const alt = withStrip({ ...input, ramps: [{ ...r, t: altT }], lockRamp: true, spec: specRest });
  return pick(base, alt);
}

function layoutCore(input) {
  const plate = normalizePlate(input.plate || input);
  const typeRules = stallRuleTargets(plate.stallRules);
  const spec = {
    axis: "x",
    dir: "ccw",   // 순환 방향은 고르지 않는다: 외부 램프는 반시계(우측통행), 내부 램프는 buildArrows에서 램프 방향을 따른다.
    packFrom: "start",
    bayMode: "max",
    rampShift: 0,
    rampPlacement: input.rampPlacement || "internal",
    entranceMode: "follow",
    ...(input.spec || {}),
  };
  if (spec.dir === "both") spec.dir = "ccw";
  const baseRamps = (input.ramps || []).map((ramp) => ({ ...ramp }));
  const ramp0 = baseRamps[0] || defaultRamp(plate, spec.rampPlacement);
  const placed = { ...ramp0, placement: spec.rampPlacement || ramp0.placement || "internal" };
  const shifted = input.lockRamp || placed.fixed
    ? placed
    : placed.placement === "internal"
      ? snapRamp(placed, plate, spec)
      : snapRamp(shiftRamp(placed, spec, plate), plate, spec);
  // 내부형 램프는 지하에서 램프 자체가 유일한 출입구(2차로 양방향)다. 벽에 따로 입구·출구를 뚫지 않는다.
  const entranceMode = spec.rampPlacement === "external"
    ? resolveEntrance(spec.entranceMode, input.entranceMode || "separate")
    : "integrated";
  const ramp = clampOpening({
    ...shifted,
    placement: spec.rampPlacement,
    width: Math.max(AISLE, shifted.width || AISLE),
    length: shifted.length || defaultRampLength(plate, shifted.edge || "w"),
  }, plate);
  ramp.placement = spec.rampPlacement;
  // 입력한 램프 길이가 직선으로 쓸 수 있는 길이보다 길어도, 법정 최소 길이가 들어가면 직선으로 줄여 쓴다
  // (길게 입력했다는 이유로 곡선이 되어 모서리 공간을 버리지 않게).
  if (ramp.placement !== "external") {
    const vertical = ramp.edge === "n" || ramp.edge === "s";
    const across = vertical ? plate.depth : plate.width;
    const maxStraight = across - insetOf(ramp) - AISLE;
    const need = minStraightRampLength(floorHeightOf(plate), rampTransitions(plate));
    if (need <= maxStraight + 1e-6 && ramp.length > maxStraight) ramp.length = round1(Math.floor(maxStraight * 10) / 10);
  }
  // 곡선이 섞이면 곡선 2차로 6.5m에 맞춰 직선 부분도 6.5m로 통일한다(직선만이면 6m).
  if (ramp.placement !== "external") {
    const curved = rampShape({ ...ramp, width: AISLE }, plate).kind === "curved";
    ramp.width = curved ? Math.max(ramp.width, RAMP_CURVE_W) : (ramp.width === RAMP_CURVE_W ? AISLE : ramp.width);
  }
  // 벽 가까이 둔 직선 램프는 벽에 딱 붙인다(틈 없이 램프 줄을 만든다).
  // 사용자가 찍은 램프(fixed)는 벽에 이미 붙어 있을 때만 줄 재배치(벽으로 당기지 않음)
  let strip = spec.strip === "off" || (ramp.fixed && ramp.t - ramp.width / 2 > 0.5 && ramp.t + ramp.width / 2 < (ramp.edge === "n" || ramp.edge === "s" ? plate.width : plate.depth) - 0.5) ? null : wallStrip(ramp, plate);
  if (strip) {
    const vertical = ramp.edge === "n" || ramp.edge === "s";
    const along = vertical ? plate.width : plate.depth;
    const low = strip.side === "w" || strip.side === "s";
    ramp.t = low ? ramp.width / 2 : along - ramp.width / 2;
    strip = { ...strip, k: ramp.width };
  }
  const openings = buildOpenings(input, plate, ramp, entranceMode);
  // 램프 도착 쪽 끝 앞 6m(차로 폭)도 비워 둔다: 코어가 바로 앞을 막으면 도착한 차가 나갈 길이 없다(동선 끊김).
  const rampBox = (ramp.placement || "internal") === "internal" ? withArrivalZone(rampFootprint(ramp, plate), ramp, plate) : null;
  // 배치 틀(줄·차로)과 기둥 격자를 먼저 정하고, 격자 맞춤 코어를 실제 격자 칸에 맞춘다(코어가 기둥 격자 안에).
  const geo = layoutGeometry(plate, spec, strip);
  const bands = geo.bands;
  // 기둥 줄: 가로·세로 간격 목록을 따로 넣으면 그것을, 없으면 기둥 간격 하나로 (추가 2026-11-10)
  let gridX = gridLinesFrom(plate.width, plate.spansX, plate.spacing);
  let gridY = gridLinesFrom(plate.depth, plate.spansY, plate.spacing);
  // 모듈 격자(2026-11-12): 차로를 가로지르는 방향은 주차 모듈 반(칸 깊이 + 차로/2 = 8.2m)으로,
  // 안쪽 주차줄 앞선(차로 가장자리 안쪽 기둥 반 두께)에 맞춘다 → 기둥선이 차로 위에 오지 않고 8.1 × 8.2m로 일정.
  // 외벽 쪽은 첫 기둥선이 벽에서 떨어질 수 있음(외벽까지는 외벽·캔틸레버로 받음).
  let moduleUsed = false;
  // 기둥 격자 먼저(2026-11-21): 차로·램프 위로 기둥선이 지나가지 않고, 기둥 간격이 12m를 넘지 않게
  // 두 방향 격자선을 함께 정한다(간격은 주차칸이 가장 많이 들어가는 쪽으로). 간격을 직접 넣으면 그대로.
  if (plate.moduleGrid !== false && plate.gridFirst !== false) {
    const rampRects = (ramp.placement || "internal") === "internal" ? [withArrivalZone(rampFootprint(ramp, plate), ramp, plate)] : [];
    if (!plate.spansX) gridX = structuralGrid(plate, bands, geo.aisles, rampRects, true);
    if (!plate.spansY) gridY = structuralGrid(plate, bands, geo.aisles, rampRects, false);
    moduleUsed = true;
  } else {
    const cross = moduleCrossLines(bands, plate, spec);
    if (cross) {
      moduleUsed = true;
      if (cross.axis === "y") gridY = cross.lines;
      else gridX = cross.lines;
    }
  }
  const gridFirst = plate.moduleGrid !== false && plate.gridFirst !== false;
  const gridLines = { gx: gridX, gy: gridY };
  const coresIn = (input.cores || (input.core ? [input.core] : [])).filter(Boolean).map((core) => clampCore(core, plate));
  const cores = coresIn.map((core) => {
    const snapped = snapToLines(core, gridLines, plate);
    if (!rampBox) return snapped;
    // 끌어 놓은 코어가 램프에 겹치거나 3m 안으로 가까우면, 격자 칸으로 멀리 보내지 않고 램프 면에 붙인다
    // (램프에 붙인 축은 그대로, 다른 축만 격자에 맞춤). 격자 칸에 맞추면 램프와 겹쳐 엉뚱한 칸으로 튀기 때문.
    // 끌어 놓은 자리 자체가 램프와 겹치면 옮기지 않고 그대로 둔다(문제로 표시)
    if (core.manual && overlapArea(core, rampBox) > 0.01) return { ...core, rampOverlap: true };
    if (core.manual && rectGap(core, rampBox) < 3) {
      const near = overlapArea(core, rampBox) > 0.01 ? core : (() => {
        // 가까운 면 쪽으로 붙이기: 겹치게 살짝 밀어 넣은 뒤 pushOutOf로 가장 가까운 면에
        const cx = core.x + core.w / 2; const cy = core.y + core.d / 2;
        const bx = rampBox.x + rampBox.w / 2; const by = rampBox.y + rampBox.d / 2;
        const gapX = Math.max(rampBox.x - (core.x + core.w), core.x - (rampBox.x + rampBox.w));
        const gapY = Math.max(rampBox.y - (core.y + core.d), core.y - (rampBox.y + rampBox.d));
        if (gapY >= gapX) return { ...core, y: cy > by ? rampBox.y + rampBox.d : rampBox.y - core.d };
        return { ...core, x: cx > bx ? rampBox.x + rampBox.w : rampBox.x - core.w };
      })();
      const attached = overlapArea(near, rampBox) > 0.01 ? pushOutOf({ ...snapped, x: near.x, y: near.y }, rampBox, plate, gridLines) : { ...snapped, x: near.x, y: near.y };
      const ax = snapToLines(attached, gridLines, plate);
      const vertical = Math.abs(attached.y - core.y) >= Math.abs(attached.x - core.x)
        || attached.y === rampBox.y + rampBox.d || attached.y + attached.d === rampBox.y;
      const fixed = vertical ? { ...attached, x: ax.x } : { ...attached, y: ax.y };
      const ok = (c) => overlapArea(c, rampBox) < 0.01 && c.x >= -1e-6 && c.y >= -1e-6 && c.x + c.w <= plate.width + 1e-6 && c.y + c.d <= plate.depth + 1e-6;
      if (ok(fixed)) return fixed;
      if (ok(attached)) return attached;
    }
    const pushed = pushOutOf(snapped, rampBox, plate, gridLines);
    const again = snapToLines(pushed, gridLines, plate);
    return overlapArea(again, rampBox) < 0.01 ? again : pushed;
  });
  // 외곽 다각형 바깥(못 쓰는 곳)에 걸친 코어는 안쪽으로 민다
  (plate.voids || []).forEach((v) => {
    cores.forEach((core, i) => {
      if (overlapArea(core, v) > 0.01) cores[i] = pushOutOf(core, v, plate, gridLines);
    });
  });
  // 코어가 램프(도착 앞 6m 포함)와 겹쳐 옆으로 밀렸으면 알림으로 남긴다(배치는 정상 진행).
  const movedCores = cores.map((core, i) => (Math.abs(core.x - coresIn[i].x) > 0.05 || Math.abs(core.y - coresIn[i].y) > 0.05 ? i : -1)).filter((i) => i >= 0);

  const bay = stallsPerBay(plate.spacing, plate.columnWidth, plate.minClear);
  const bayStats = { total: 0, triple: 0 };
  const shape = rampShape(ramp, plate);
  const internal = (ramp.placement || "internal") === "internal";
  const rampPieces = internal ? shape.pieces : [];
  // 도로 쪽 벽 줄 없는 안(layoutRoadless): 가상 벽 줄 자리는 차로로 → 순환 차로가 실제 벽에 붙고 출입구와 이어짐
  let aisles = geo.aisles.concat((plate.extraAisles || []).map((a) => ({ ...a, role: "ring", phase: "loop", portals: [] })));
  if ((ramp.placement || "internal") === "internal") {
    aisles = aisles.flatMap((aisle) => rampPieces.reduce((parts, piece) => parts.flatMap((part) => cutBlock(part, piece, "internal")), [aisle]));
  }
  // 외곽 바깥(못 쓰는 곳)에 걸친 차로는 잘라 낸다(끊긴 동선은 뒤에서 우회 차로로 잇는다)
  (plate.blockRects || []).forEach((b) => {
    aisles = aisles.flatMap((aisle) => cutBlock(aisle, b, "void"));
  });
  const approaches = [].concat(approachAisle(ramp, plate), rampEntryAisle(ramp, plate) || []);
  // 도착 자리 안에 완전히 들어가는 차로 조각은 도착 자리와 같은 공간이므로 지운다.
  aisles = aisles.filter((aisle) => !approaches.some((approach) => aisle.x >= approach.x - 0.01 && aisle.y >= approach.y - 0.01
    && aisle.x + aisle.w <= approach.x + approach.w + 0.01 && aisle.y + aisle.d <= approach.y + approach.d + 0.01));
  aisles.push(...approaches);
  openings.forEach((opening) => {
    if (sharesRamp(opening, ramp)) return;
    aisles.push(entryAisle(opening, plate));
  });
  cores.forEach((core) => {
    aisles = applyCore(aisles, core, plate, internal ? rampPieces : [rampFootprint(ramp, plate)]);
  });
  const blockers = cores.slice();
  if (internal) blockers.push(...rampPieces);
  aisles = repairNetwork(aisles.filter((aisle) => aisle.w >= 1 && aisle.d >= 1), plate, blockers);
  aisles = extendDeadEnds(aisles, blockers, plate);
  stampPortals(aisles, openings, ramp, plate);
  // 코어·램프로 차로가 다시 짜였으면(우회 차로 등) 그 차로 위로 기둥선이 지나가지 않게 격자를 한 번 더 맞춘다.
  if (gridFirst) {
    const rampRects = internal ? rampPieces : [];
    const edgesX = cores.flatMap((c) => [c.x, c.x + c.w]);
    const edgesY = cores.flatMap((c) => [c.y, c.y + c.d]);
    if (!plate.spansX) gridX = structuralGrid(plate, bands, aisles, rampRects, true, gridX.concat(edgesX));
    if (!plate.spansY) gridY = structuralGrid(plate, bands, aisles, rampRects, false, gridY.concat(edgesY));
  }

  const fixedBlocks = cores.concat(internal ? rampPieces : [], plate.blockRects || []);
  let stallBlocks = [];
  const stalls = [];
  const offBands = new Set();   // 시험으로 끈 주차 줄(빈자리 채우기와 겹치는 짧은 줄)
  const fillStalls = () => {
    stallBlocks = aisles.concat(fixedBlocks);
    stalls.length = 0;
    bayStats.total = 0;
    bayStats.triple = 0;
    bands.forEach((band, bandIndex) => fillBand(band, bandIndex, plate, band.along === "x" ? gridX : gridY, plate.columnWidth, plate.minClear, stallBlocks, stalls, bayStats, offBands));
    // 빈자리 채우기: 코어·램프 때문에 정해진 줄이 끊겨 비는 곳에, 어느 차로든 바로 옆 5m가 비어 있으면
    // 그 차로를 보고 주차칸을 넣는다(기둥 간격 안에서만).
    // 정해진 줄에서 차로와 안 닿는 칸은 먼저 빼서, 빈자리 채우기가 그 자리를 쓸 수 있게 한다.
    // (판정은 최종과 같은 기준: 칸 앞 폭 대부분이 차로여야 함. 느슨하게 남기면 빈자리를 막고 마지막에 빠져 흰 땅이 된다)
    const servedNow = stalls.filter((stall) => stallReachable(stall, aisles));
    stalls.length = 0;
    stalls.push(...servedNow);
    const before = stalls.length;
    // 기둥 자리(정해진 줄 뒤쪽 기둥)를 먼저 잡아, 빈자리 칸이 기둥에 걸리지 않게 한다.
    const cols = placeColumns((moduleUsed ? crossSegments(bands, plate, gridX, gridY) : frontSegments(bands, plate)), gridX, gridY, plate, stallBlocks.concat(openings.map((opening) => mouthRect(opening, plate))))
      .map((c) => ({ x: c.x - plate.minClear, y: c.y - plate.minClear, w: c.w + 2 * plate.minClear, d: c.d + 2 * plate.minClear }));
    // 기둥 격자 먼저: 빈자리 칸도 격자 교점(앞으로 기둥이 설 자리)을 피해서 넣는다
    if (gridFirst) {
      const cw = plate.columnWidth;
      const cd = plate.columnDepth;
      const mouths = openings.map((opening) => mouthRect(opening, plate));
      gridX.forEach((gx) => gridY.forEach((gy) => {
        if (gx <= 0.01 || gy <= 0.01 || gx >= plate.width - 0.01 || gy >= plate.depth - 0.01) return;
        const r = { x: gx - cw / 2, y: gy - cd / 2, w: cw, d: cd };
        if (stallBlocks.concat(mouths).some((b) => overlapArea(r, b) > 0.001)) return;
        cols.push(r);
      }));
    }
    const gapObstacles = stallBlocks.concat(cols);
    gapBands(aisles).forEach((band, k) => fillBand(band, bands.length + k, plate, band.along === "x" ? gridX : gridY, plate.columnWidth, plate.minClear, gapObstacles, stalls, bayStats, offBands));
    // 빈자리 칸은 앞쪽 6m(차로 폭)가 실제로 차로로 덮여 있을 때만 인정한다.
    const added = harmonizeFill(stalls.splice(before).filter((stall) => frontIsAisle(stall, aisles)), stalls.slice(0, before), gapObstacles, aisles, plate);
    // 방향 통일: 정해진 줄(외벽·베이 줄)과 방향이 다른 빈자리 칸이 그 줄 연장선에 끼면 빼고,
    // 그 자리를 줄과 같은 방향으로 다시 채운다.
    // - 방향 통일 안(spec.uniform): 칸 수가 줄어도 통일.
    // - 다른 안: 칸 수가 같거나 늘 때만 통일(예: 외벽 줄 모서리 세로 2칸 → 가로 2칸).
    const regular = stalls.slice(0, before);
    const strips = uniformStrips(regular, plate);
    const kept = added.filter((stall) => !strips.some((strip) => strip.along !== stall.along
      && overlapArea(stall, strip) > 0.5 * stall.w * stall.d));
    const trial = regular.concat(kept);
    strips.forEach((strip, k) => fillGapBand(strip, 9000 + k, plate, gapObstacles, trial, null));
    const uniformAll = regular.concat(kept, trial.slice(regular.length + kept.length).filter((stall) => frontIsAisle(stall, aisles)));
    stalls.length = 0;
    if (spec.uniform || uniformAll.length >= before + added.length) stalls.push(...uniformAll);
    else stalls.push(...regular, ...added);
  };
  fillStalls();

  // 막다른 차로 정리 + 진입 불가 칸 제외 (추가 2026-11-10)
  // 1) 한쪽만 이어진 차로 중 출입구·램프가 없고, 그 차로를 앞에 둔 주차칸도 없는 것은 지운다.
  //    지운 자리에 주차칸이 들어갈 수 있으면 다시 채운다. 바뀌는 게 없을 때까지 반복.
  // 2) 앞에 차로가 없는 칸(예: 경사로 쪽을 보는 칸)은 차가 들어갈 수 없으므로 뺀다.
  let trimmedAisles = 0;
  let unreachable = 0;
  let coreAisleAdded = false;
  if (plate.trimDeadEnds) {
    for (let pass = 0; pass < 6; pass += 1) {
      const adjNow = buildGraph(aisles);
      const removable = aisles.filter((aisle, index) => !(aisle.portals || []).length
        && adjNow[index].length <= 1
        && !stalls.some((stall) => servedBy(stall, aisle)));
      if (!removable.length) break;
      aisles = aisles.filter((aisle) => !removable.includes(aisle));
      trimmedAisles += removable.length;
      fillStalls();
    }
    // 시험 삭제: 짧은 차로 조각을 하나씩 빼 보고, 동선이 끊기지 않으면서 주차 대수가 늘면 뺀다.
    // (예: 램프에 잘려 남은 모서리 차로 → 빼고 옆 주차 줄을 벽까지 이어 붙임)
    // 시험 판정용 대수: 차로와 닿고, 최종 기둥 위치와도 부딪히지 않는 칸만 센다(최종 결과와 같은 기준).
    const served = () => {
      const cols = placeColumns((moduleUsed ? crossSegments(bands, plate, gridX, gridY) : frontSegments(bands, plate)), gridX, gridY, plate, stallBlocks.concat(openings.map((opening) => mouthRect(opening, plate))));
      return stalls.filter((stall) => aisles.some((aisle) => servedBy(stall, aisle))
        && !cols.some((column) => tooClose(stall, column, plate.minClear))).length;
    };
    const parts = (list) => {
      const g = buildGraph(list);
      const seen = new Set();
      let n = 0;
      list.forEach((_, i) => {
        if (seen.has(i)) return;
        n += 1;
        const stack = [i];
        seen.add(i);
        while (stack.length) g[stack.pop()].forEach((j) => { if (!seen.has(j)) { seen.add(j); stack.push(j); } });
      });
      return n;
    };
    let best = served();
    const portalCount = () => portalIssues(aisles, openings, [ramp], plate).length;
    // 막다른 차로(연결 1곳 이하) 수: 시험 삭제로 새 막다른 차로가 생기면 안 된다(순환이 끊기므로).
    const deadEnds = (list) => {
      const g = buildGraph(list);
      return list.filter((a, i) => a.role !== "approach" && g[i].length <= 1).length;
    };
    for (let pass = 0; pass < 3; pass += 1) {
      let improved = false;
      const base = parts(aisles);
      const baseIssues = portalCount();
      const baseDead = deadEnds(aisles);
      const candidates = aisles.filter((a) => a.role !== "approach" && Math.max(a.w, a.d) <= 16);
      for (const cand of candidates) {
        const saved = aisles;
        aisles = aisles.filter((a) => a !== cand);
        stampPortals(aisles, openings, ramp, plate);
        if (aisles.length && parts(aisles) <= base && portalCount() <= baseIssues && deadEnds(aisles) <= baseDead) {
          fillStalls();
          const count = served();
          if (count > best) { best = count; trimmedAisles += 1; improved = true; continue; }
        }
        aisles = saved;
        stampPortals(aisles, openings, ramp, plate);
      }
      fillStalls();
      if (!improved) break;
    }
    // 시험 끄기: 칸이 1~2개뿐인 기둥 칸(bay)을 하나씩 꺼 보고, 그 자리를 다른 방향 칸으로 채워 대수가 늘면 끈다.
    // (예: 램프 아래 줄 끝의 가로 1칸 → 끄고 세로 2칸)
    for (let pass = 0; pass < 2; pass += 1) {
      const counts = {};
      stalls.forEach((stall) => { if (stall.bay) counts[stall.bay] = (counts[stall.bay] || 0) + 1; });
      const small = Object.keys(counts).filter((k) => counts[k] <= 2);
      let improved = false;
      for (const key of small) {
        offBands.add(key);
        fillStalls();
        const count = served();
        if (count > best) { best = count; improved = true; continue; }
        offBands.delete(key);
      }
      fillStalls();
      if (!improved) break;
    }
    // 시험 추가: 코어 바로 옆에 차로(6m)를 새로 뚫어 위·아래(또는 좌·우) 차로를 잇는다. 코어 옆에 칸 줄이
    // 생기고(장애인 칸을 코어에 붙일 자리), 가운데 비는 땅을 쓰게 된다.
    // - 보통 안: 대수가 같거나 늘 때만 둔다.
    // - 장애인 코어 인접 안(spec.coreAisle): 대수가 줄어도 후보 중 가장 많은 것을 둔다.
    {
      const solids = fixedBlocks;
      const candidates = [];
      cores.forEach((core) => {
        // 세로 차로(코어 동·서 면): 아래쪽 가장 가까운 차로 윗변 ~ 위쪽 가장 가까운 차로 아랫변
        [core.x + core.w, core.x - AISLE].forEach((x0) => {
          const spans = (a) => a.x <= x0 + 1e-6 && a.x + a.w >= x0 + AISLE - 1e-6;
          const below = aisles.filter((a) => spans(a) && a.y + a.d <= core.y + 1e-6).sort((p, q) => (q.y + q.d) - (p.y + p.d))[0];
          const above = aisles.filter((a) => spans(a) && a.y >= core.y + core.d - 1e-6).sort((p, q) => p.y - q.y)[0];
          if (below && above) candidates.push({ x: x0, y: below.y + below.d, w: AISLE, d: above.y - (below.y + below.d) });
        });
        // 가로 차로(코어 남·북 면)
        [core.y + core.d, core.y - AISLE].forEach((y0) => {
          const spans = (a) => a.y <= y0 + 1e-6 && a.y + a.d >= y0 + AISLE - 1e-6;
          const left = aisles.filter((a) => spans(a) && a.x + a.w <= core.x + 1e-6).sort((p, q) => (q.x + q.w) - (p.x + p.w))[0];
          const right = aisles.filter((a) => spans(a) && a.x >= core.x + core.w - 1e-6).sort((p, q) => p.x - q.x)[0];
          if (left && right) candidates.push({ x: left.x + left.w, y: y0, w: right.x - (left.x + left.w), d: AISLE });
        });
      });
      const usable = candidates.filter((cand) => cand.w >= AISLE - 1e-6 && cand.d >= AISLE - 1e-6
        && cand.x >= -1e-6 && cand.y >= -1e-6 && cand.x + cand.w <= plate.width + 1e-6 && cand.y + cand.d <= plate.depth + 1e-6
        && !solids.some((b) => overlapArea(cand, b) > 0.03)
        && !aisles.some((a) => overlapArea(cand, a) > 0.5 * cand.w * cand.d));
      const baseParts = parts(aisles);
      const baseIssuesAll = portalCount();
      const saved = aisles;
      let pick = null;
      usable.forEach((cand) => {
        aisles = saved.concat({ ...cand, role: "core-side", phase: "loop" });
        stampPortals(aisles, openings, ramp, plate);
        fillStalls();
        const count = served();
        if (parts(aisles) <= baseParts && portalCount() <= baseIssuesAll && (!pick || count > pick.count)) pick = { cand, count };
      });
      aisles = saved;
      if (pick && (spec.coreAisle || pick.count >= best)) {
        aisles = saved.concat({ ...pick.cand, role: "core-side", phase: "loop" });
        best = pick.count;
        coreAisleAdded = true;
      }
      stampPortals(aisles, openings, ramp, plate);
      fillStalls();
    }
    const reachable = stalls.filter((stall) => stallReachable(stall, aisles));
    unreachable = stalls.length - reachable.length;
    stalls.length = 0;
    stalls.push(...reachable);
    // 외톨이 칸 열 맞추기: 빈자리 채우기로 혼자 들어간 칸이 바로 옆 같은 방향 줄과 열이 어긋나 있으면
    // 그 줄의 열로 옮긴다. 옮긴 칸 앞이 차로가 아니면 앞쪽 빈 곳에 짧은 차로를 이어 준다.
    const cols = placeColumns((moduleUsed ? crossSegments(bands, plate, gridX, gridY) : frontSegments(bands, plate)), gridX, gridY, plate, stallBlocks.concat(openings.map((opening) => mouthRect(opening, plate))));
    aisles = alignLoneStalls(stalls, aisles, stallBlocks, cols, plate);
  }

  const backs = (moduleUsed ? crossSegments(bands, plate, gridX, gridY) : frontSegments(bands, plate));
  const columnObstacles = stallBlocks.concat(openings.map((opening) => mouthRect(opening, plate)));
  const columns = placeColumns(backs, gridX, gridY, plate, columnObstacles);
  // 칸 뒤에 벽·장애물까지 빈 띠가 남으면 칸을 뒤로 붙이고, 앞 차로를 그만큼 넓혀 칸 앞이 계속 차로에 닿게 한다.
  // 주 동선(램프·출입구가 붙은 차로 덩어리)과 끊긴 차로 조각은 지우고, 그 조각만 보고 있던 칸도 뺀다.
  // (코어·램프를 끌어 옮기면 차로가 섬처럼 끊기는 경우가 있음 → 그 칸은 실제로 들어갈 수 없는 칸)
  let prunedAisles = 0;
  let prunedStalls = 0;
  {
    const groups = componentGroups(aisles);
    if (groups.length > 1) {
      const portalsOf = (group) => group.reduce((sum, i) => sum + (aisles[i].portals || []).length, 0);
      groups.sort((a, b) => portalsOf(b) - portalsOf(a) || b.length - a.length);
      const keep = new Set(groups[0]);
      const before = aisles.length;
      aisles = aisles.filter((_, i) => keep.has(i));
      prunedAisles = before - aisles.length;
      const served = stalls.filter((stall) => stallReachable(stall, aisles));
      prunedStalls = stalls.length - served.length;
      stalls.length = 0;
      stalls.push(...served);
    }
  }
  pushStallsBack(stalls, aisles, columns.concat(fixedBlocks, openings.map((opening) => mouthRect(opening, plate))), plate);
  // 기둥 격자 채우기: 주차줄 뒤에만 서던 기둥에 더해, 격자선 교점 중 빈 곳(차로·칸·코어·램프·출입구 앞이 아닌 곳)에도 기둥을 세운다.
  // gridDropped = 칸에 걸려 못 세운 교점 수.
  let gridDropped = 0;
  if (plate.fullGrid !== false) {
    // 코어 모서리·변 위 교점의 기둥은 코어 벽에 반쯤 묻힌 기둥으로 세운다(코어를 기둥 반 두께만큼 줄여서 검사).
    const coreCore = cores.map((core) => shrinkRect(core, plate.columnWidth / 2 + 0.01, plate.columnDepth / 2 + 0.01));
    const blocks = aisles.concat(coreCore, internal ? rampPieces : [], openings.map((opening) => mouthRect(opening, plate)));
    const cw = plate.columnWidth;
    const cd = plate.columnDepth;
    gridX.forEach((gx) => gridY.forEach((gy) => {
      let x = gx - cw / 2;
      let y = gy - cd / 2;
      const onOuter = gx <= 0.01 || gx >= plate.width - 0.01 || gy <= 0.01 || gy >= plate.depth - 0.01;
      if (onOuter && plate.wallColumns === "front") return;   // 외곽 기둥을 안쪽으로 당긴 경우 외벽선 위 기둥은 두지 않음(외벽이 받음)
      if (gx <= 0.01) x = -cw; else if (gx >= plate.width - 0.01) x = plate.width;      // 외곽선 위는 벽 쪽 0.5m 띠 안에
      if (gy <= 0.01) y = -cd; else if (gy >= plate.depth - 0.01) y = plate.depth;
      let rect = { x: round3(x), y: round3(y), w: cw, d: cd, phase: "column" };
      const cx = rect.x + cw / 2;
      const cy = rect.y + cd / 2;
      if (columns.some((c) => Math.hypot(c.x + c.w / 2 - cx, c.y + c.d / 2 - cy) < 0.6)) return;
      if (blocks.some((b) => overlapArea(rect, b) > 0.001 || tooClose(rect, b, plate.minClear))) return;
      // 주차줄 구역(줄 뒤 선 포함) 안의 교점은 건너뜀 — 그 줄의 기둥은 앞선에 이미 섰다.
      // (같이 세우면 차로 가로 방향 기둥 간격이 4~6m로 들쭉날쭉해짐)
      // (기둥 격자 먼저 방식에서는 격자선이 칸 사이 틈으로 지나가므로 줄 안 교점에도 세운다)
      if (!gridFirst && bands.some((band) => cx > band.x - 0.3 && cx < band.x + band.w + 0.3 && cy > band.y - 0.3 && cy < band.y + band.d + 0.3)) return;
      // 코어 변 위 교점에서 옆 칸에 걸리면 기둥을 코어 안쪽(모서리)으로 넣어 본다.
      const hits = (r) => stalls.some((stall) => tooClose(stall, r, plate.minClear));
      if (hits(rect)) {
        const host = cores.find((core) => cx >= core.x - 0.01 && cx <= core.x + core.w + 0.01 && cy >= core.y - 0.01 && cy <= core.y + core.d + 0.01);
        if (host) {
          const inside = { ...rect, x: round3(clamp(rect.x, host.x, host.x + host.w - cw)), y: round3(clamp(rect.y, host.y, host.y + host.d - cd)) };
          if (!hits(inside)) rect = inside;
        }
      }
      // 칸과 겹치는 교점은 세우지 않는다(칸을 빼면 기준 사례 142→132대처럼 손해가 커서). 빈 교점만 채움.
      if (hits(rect)) { gridDropped += 1; return; }
      columns.push(rect);
    }));
  }
  // 코어에 붙거나 0.3m 안에 있는 기둥(코어 모서리·변 위 기둥 포함)은 뺀다 — 코어 벽이 하중을 받음.
  // 외곽 기둥을 안쪽으로 당긴 경우, 외벽에 붙은 기둥(줄 앞선 끝 등)도 뺀다 — 외벽이 받음.
  {
    const touchesWall = (col) => plate.wallColumns === "front"
      && (col.x <= 0.3 || col.y <= 0.3 || col.x + col.w >= plate.width - 0.3 || col.y + col.d >= plate.depth - 0.3);
    const keep = columns.filter((col) => !cores.some((core) => rectGap(col, core) < 0.3) && !touchesWall(col));
    columns.length = 0;
    columns.push(...keep);
  }
  // 기둥 최대 간격 12m: 격자선마다 받침(기둥·코어·램프·외벽) 사이가 12m를 넘으면 그 사이에 기둥을 더 세운다.
  // 빈 곳을 먼저 찾고, 없으면 칸을 빼고 세운다. 차로 위라 못 세우면 경고로 알린다.
  const span = enforceMaxSpan({
    plate, gridX, gridY, columns, stalls, aisles, cores,
    ramps: internal ? rampPieces : [],
    mouths: openings.map((opening) => mouthRect(opening, plate)),
  });
  const columnConflicts = [];
  const keptStalls = [];
  stalls.forEach((stall) => {
    if (columns.some((column) => tooClose(stall, column, plate.minClear))) columnConflicts.push({ ...stall, conflict: true });
    else keptStalls.push(stall);
  });
  // 직선 내부 램프의 도착 앞 6m(올라온 차가 빠져나가는 자리)를 앞에 두고 있는 낱개 칸은 두지 않는다.
  let facesArrival = () => false;
  if (internal && ramp && rampShape(ramp, plate).kind === "straight") {
    const fp = rampFootprint(ramp, plate);
    const arrivalRect = {
      w: { x: fp.x + fp.w, y: fp.y, w: AISLE, d: fp.d },
      e: { x: fp.x - AISLE, y: fp.y, w: AISLE, d: fp.d },
      s: { x: fp.x, y: fp.y + fp.d, w: fp.w, d: AISLE },
      n: { x: fp.x, y: fp.y - AISLE, w: fp.w, d: AISLE },
    }[ramp.edge];
    const frontStrip = (st) => ({
      s: { x: st.x, y: st.y - 1, w: st.w, d: 1 }, n: { x: st.x, y: st.y + st.d, w: st.w, d: 1 },
      w: { x: st.x - 1, y: st.y, w: 1, d: st.d }, e: { x: st.x + st.w, y: st.y, w: 1, d: st.d },
    }[st.aisle]);
    if (arrivalRect) {
      facesArrival = (st) => {
        const strip = frontStrip(st);
        return Boolean(strip) && overlapArea(strip, arrivalRect) > strip.w * strip.d * 0.5;
      };
      // 줄(띠)에 원래 있던 칸은 순환 차로를 따라 있는 정상 칸이라 두고, 빈 곳을 채운 낱개 칸(fill)만 본다
      for (let i = keptStalls.length - 1; i >= 0; i -= 1) {
        if (keptStalls[i].phase === "fill" && facesArrival(keptStalls[i])) keptStalls.splice(i, 1);
      }
    }
  }
  // 자투리 직각 칸: 차로 긴 변 바깥에 칸 깊이만큼 빈 띠가 남아 있으면(줄이 빠진 자리 등) 평행보다 먼저 직각 칸을 채운다.
  {
    const arrival = internal ? [withArrivalZone(rampFootprint(ramp, plate), ramp, plate)] : [];
    const blocks = keptStalls.concat(columns, aisles, fixedBlocks, arrival, openings.map((opening) => mouthRect(opening, plate)));
    const extra = parallelStalls(aisles, blocks, plate, { d: STALL_D, l: STALL_W, type: "general", phase: "filler", center: false, skip: facesArrival });
    extra.forEach((stall) => keptStalls.push(stall));
  }
  // 코어 출입문 면: 직접 정한 면(core.door) 또는 자동(차로와 가장 길게 맞닿은 면)
  cores.forEach((core) => { core.doorFace = coreDoorFace(core, aisles); });
  const typed = assignStallTypes(keptStalls, typeRules, {
    plate, columns, blocks: stallBlocks, cores, ramp, openings, gridX, gridY, aisles, spanLong: span.long,
    ecoAnchor: ecoAnchorOf(ramp, plate),
    reach: plate.trimDeadEnds ? (rect) => stallReachable(rect, aisles) : null,   // 넓히거나 다시 나눠도 앞이 차로여야 함
  });
  // 자투리 평행주차(2.0×6.0m): 직각 칸이 못 들어간 차로 옆 빈 띠에 차로와 나란히 넣는다.
  // 장애인·전기차 비율이 총 대수로 올라 모자라게 되면 평행 칸을 하나씩 뺀다(법 기준 우선).
  let typedStalls = typed.stalls;
  if (plate.stallRules && plate.stallRules.parallel !== false) {
    const arrival = internal ? [withArrivalZone(rampFootprint(ramp, plate), ramp, plate)] : [];
    const blocks = typedStalls.concat(columns, aisles, fixedBlocks, arrival, openings.map((opening) => mouthRect(opening, plate)));
    const lined = alignParallelRows(alignParallel(parallelStalls(aisles, blocks, plate), typedStalls, blocks, plate), blocks, plate, aisles);
    const extra = lined.stalls;
    aisles = aisles.concat(lined.aisles);   // 칸을 밀어 올린 자리만큼 차로를 넓혀 차로 가장자리도 곧게
    while (extra.length) {
      const check = tallyStallTypes(typedStalls.concat(extra), typeRules);
      if (check.counts.disabled >= check.targets.disabled && check.counts.eco >= check.targets.eco) break;
      extra.pop();
    }
    typedStalls = typedStalls.concat(extra);
    // 막다른 차로 꼬리 자르기: 칸·동선에 안 쓰이는 차로 끝을 잘라 직각 칸이 들어갈 깊이가 생기면 바꾼다(대수가 늘 때만)
    for (let round = 0; round < 4; round += 1) {
      // 대수가 늘어 장애인·친환경 비율이 모자라게 되면 그 안은 안 씀(법 기준 우선)
      const typesOk = (list) => { const c = tallyStallTypes(list, typeRules); return c.counts.disabled >= c.targets.disabled && c.counts.eco >= c.targets.eco; };
      const tail = tailCutFill(aisles, typedStalls, columns.concat(fixedBlocks, arrival, openings.map((opening) => mouthRect(opening, plate))), plate, typesOk);
      if (!tail) break;
      aisles = tail.aisles;
      typedStalls = tail.stalls;
    }
  }

  const tally = tallyStallTypes(typedStalls, typeRules);
  typed.counts = tally.counts;
  typed.targets = tally.targets;
  typed.shortages = tally.shortages;
  stalls.length = 0;
  typedStalls.forEach((stall, index) => {
    stall.no = index + 1;
    stalls.push(stall);
  });
  // 코어 옆 자투리 차로 정리(2026-11-21): 코어 옆에 붙은 차로 조각이 코어 면 선보다 3m 안쪽으로 삐져나와 있고
  // 그 띠가 동선·칸 출입에 안 쓰이면 띠를 차로에서 빼서 차로 가장자리를 코어 면에 맞춘다.
  if ((plate.voids || []).length) {
    aisles = aisles.flatMap((a) => plate.voids.reduce((parts, v) => parts.flatMap((part) => (overlapArea(part, v) > 0.04 ? subtractRect(part, v).filter((q) => q.w > 0.3 && q.d > 0.3).map((q) => ({ ...part, ...q })) : [part])), [a]));
  }
  aisles = trimCorePockets(aisles, cores, stalls, plate, columns.concat(internal ? rampPieces : [], openings.map((opening) => mouthRect(opening, plate))));
  // 차로 가장자리 한 줄로(2026-11-24): 이웃 차로 조각이나 코어 면이 0.6m 안 바깥에 있으면 그 선까지 차로를 넓혀
  // 계단·흰 틈을 없앤다. 그 띠에 칸이 걸리면 칸을 같이 밀어낸다(밀 자리가 없으면 그 조각은 그대로).
  {
    const solids = columns.concat(internal ? rampPieces : [], openings.map((opening) => mouthRect(opening, plate)));
    // 칸 줄 앞선 맞추기: 같은 차로를 보는 이웃 칸끼리 앞선이 0.6m 안으로 어긋나 있으면 차로에서 먼 쪽 선으로 물린다.
    const before = stalls.map((st) => ({ st, x: st.x, y: st.y }));
    const movedRows = alignStallRows(stalls, aisles, cores, solids, plate);
    const straight = straightenAisleEdges(aisles, stalls, cores, solids, plate);
    // 물린 칸 앞이 차로와 안 맞닿으면(차로를 못 넓힌 경우) 되돌린다
    if (movedRows.length && movedRows.some((st) => !stallReachable(st, straight))) {
      before.forEach((b) => { b.st.x = b.x; b.st.y = b.y; });
      aisles = straightenAisleEdges(aisles, stalls, cores, solids, plate);
    } else aisles = straight;
  }
  const adj = buildGraph(aisles);
  const issues = [];
  issues.push(...portalIssues(aisles, openings, [ramp], plate));
  // 모든 차로가 하나로 이어져야 한다: 주 동선(가장 큰 덩어리)과 끊긴 차로 조각이 있으면 오류.
  const aisleGroups = componentGroups(aisles).sort((a, b) => b.length - a.length);
  const isolatedAisles = aisleGroups.slice(1).reduce((sum, group) => sum + group.length, 0);
  if (isolatedAisles > 0) issues.push({ type: "network", label: `주 동선과 이어지지 않는 차로 ${isolatedAisles}곳이 있습니다.` });
  if (prunedAisles > 0) issues.push({ type: "notice", label: `주 동선과 끊긴 차로 ${prunedAisles}곳${prunedStalls ? `과 그 차로만 보던 주차칸 ${prunedStalls}대` : ""}를 뺐습니다(들어갈 수 없는 자리).` });
  issues.push(...slopeIssues([ramp], plate));
  issues.push(...siteIssues([ramp], plate));
  issues.push(...roadIssues([ramp], plate));
  const drives = buildArrows(plate, aisles, openings, ramp, "ccw", false);
  const route = drives.map((seg) => ({ x: seg.x1, y: seg.y1 })).concat(drives.length ? [{ x: drives[drives.length - 1].x2, y: drives[drives.length - 1].y2 }] : []);
  const columnHits = stallColumnHits(stalls, columns, plate.minClear);
  cores.forEach((core, i) => {
    if (!FACES.includes(core.door)) return;
    const auto = coreDoorFace({ ...core, door: null }, aisles);
    const t = 0.6;
    const f = core.door;
    const strip = f === "n" ? { x: core.x, y: core.y + core.d, w: core.w, d: t } : f === "s" ? { x: core.x, y: core.y - t, w: core.w, d: t }
      : f === "e" ? { x: core.x + core.w, y: core.y, w: t, d: core.d } : { x: core.x - t, y: core.y, w: t, d: core.d };
    if (!aisles.some((a) => overlapArea(strip, a) > 0.3) && auto !== f) issues.push({ type: "door", label: `코어${cores.length > 1 ? ` ${i + 1}` : ""} 출입문 앞에 차로가 없습니다(출입문 면을 바꾸거나 자동으로 두세요).` });
  });
  if (span.long.length) issues.push({ type: "span", label: `기둥 간격 ${MAX_SPAN}m 넘는 곳 ${span.long.length}군데(최대 ${Math.max(...span.long.map((g) => g.len)).toFixed(1)}m) — 차로 위라 기둥을 못 세움` });
  if (columnHits > 0) issues.push({ type: "column", label: `주차칸-기둥 충돌 ${columnHits}건` });
  typed.shortages.forEach((label) => issues.push({ type: "stallType", label }));
  // 평행 칸 줄 맞추기로 넓힌 차로 띠(trim)는 바로 옆 차로의 일부라 폭 검사에서 뺀다
  const widthAisles = aisles.filter((aisle) => aisle.role !== "trim");
  const minAisleWidth = widthAisles.length ? Math.min(...widthAisles.map((aisle) => Math.min(aisle.w, aisle.d))) : 0;
  if (aisles.length && minAisleWidth < AISLE_MIN) issues.push({ type: "network", label: `차로 폭 ${round1(minAisleWidth)}m 구간이 있습니다 (6m 이상 필요).` });
  const deadEnds = deadEndCount(aisles, adj);
  const overlapCount = countOverlaps({ stalls, aisles, columns }, cores, internal ? rampPieces : [], plate);
  if (overlapCount > 0) issues.push({ type: "overlap", label: `주차칸·차로·기둥·코어·램프가 겹치는 곳 ${overlapCount}곳` });
  if (!stalls.length) issues.push({ type: "empty", label: "주차칸이 하나도 들어가지 않습니다(평면이 너무 작거나 코어·램프가 자리를 다 차지함)." });
  cores.forEach((core, i) => {
    if (!core.rampOverlap) return;
    issues.push({ type: "overlap", label: `${cores.length > 1 ? `코어 ${i + 1}` : "코어"}가 램프(도착 앞 6m 포함)와 겹칩니다. 코어나 램프를 옮겨 주세요.` });
  });
  if (internal && ramp.offset != null && insetOf(ramp) > RAMP_INSET + 0.5) {
    issues.push({ type: "rampoffset", label: "램프가 외벽에서 떨어져 있어 지상 도로와 바로 이어지지 않습니다(층간 램프로 보고 배치)." });
  }
  movedCores.forEach((i) => issues.push({ type: "notice", label: `${cores.length > 1 ? `코어 ${i + 1}` : "코어"}가 램프(도착 앞 6m 포함)와 겹쳐 옆으로 옮겼습니다.` }));
  // 외곽 다각형: 램프·코어가 외곽 밖(못 쓰는 곳)에 걸치면 불가
  if ((plate.voids || []).length) {
    const rampOut = internal && rampPieces.some((piece) => plate.voids.some((v) => overlapArea(piece, v) > 0.05));
    if (rampOut) issues.push({ type: "site", label: "램프가 주차장 외곽 밖으로 나갑니다. 램프를 외곽 안으로 옮기거나 도로변·위치를 바꿔 주세요." });
    if (cores.some((c) => plate.voids.some((v) => overlapArea(c, v) > 0.05))) issues.push({ type: "site", label: "코어가 주차장 외곽 밖에 걸칩니다. 코어를 안쪽으로 옮겨 주세요." });
  }
  const connected = !issues.some((issue) => issue.type === "opening" || issue.type === "ramp" || issue.type === "network");
  const slopeOk = !issues.some((issue) => issue.type === "slope");
  const siteOk = !issues.some((issue) => issue.type === "site");
  const plateArea = plate.width * plate.depth;
  const aisleRatio = plateArea ? round3(aisleArea(aisles, plate) / plateArea) : 0;
  const perimeterRatio = stalls.length ? stalls.filter((stall) => stall.phase === "perimeter").length / stalls.length : 0;
  const tripleRatio = bayStats.total ? bayStats.triple / bayStats.total : 0;
  const hasLoop = ["s", "n", "w", "e"].every((side) => aisles.some((aisle) => aisle.role === "ring" && aisle.side === side));
  const similarity = Math.round(clamp(perimeterRatio, 0, 1) * 40 + (hasLoop ? 30 : 0) + clamp(tripleRatio, 0, 1) * 30);
  const valid = connected && columnHits === 0 && slopeOk && overlapCount === 0 && stalls.length > 0;
  const rejected = valid ? null : rejectReason({ connected, columnHits, slopeOk, siteOk, overlapCount });
  return {
    moduleGrid: moduleUsed,
    stalls,
    aisles,
    columns,
    drives,
    route,
    issues,
    connected,
    axis: spec.axis,
    fixedAlong: spec.axis === "x" ? "가로" : "세로",
    flexAlong: spec.axis === "x" ? "세로" : "가로",
    gridX,
    gridY,
    cores,
    openings,
    ramps: [ramp],
    plate,
    spec,
    strip,
    bay,
    columnConflicts,
    clearance: clearanceMark(stalls, columns),
    metrics: {
      stalls: stalls.length,
      areaPerStall: stalls.length ? round3(plateArea / stalls.length) : 0,
      aisleRatio,
      connected,
      columnHits,
      deadEnds,
      similarity,
      overlapCount,
      isolatedAisles,
      gridDropped,
      slopeOk,
      siteOk,
      valid: valid && siteOk,
      perimeterRatio: round3(perimeterRatio),
      tripleRatio: round3(tripleRatio),
      hasLoop,
      stallTypes: typed.counts,
      stallTargets: typed.targets,
      trimmedAisles,
      minAisleWidth: round3(minAisleWidth),
      unreachable,
      coreAisle: coreAisleAdded,
      disabledWalk: disabledWalkOf(stalls, { plate, aisles, columns, cores }),
      rampKind: shape.kind,
      rampTotal: shape.total,
      rampSegments: shape.segments,
      rampLowerSlope: shape.kind === "straight" && ramp ? rampMainSlope(ramp.length, rampTransitions(plate, "lower"), floorHeightOf(plate)) : null,
      rejected: valid && siteOk ? null : (rejected || (siteOk ? null : "램프가 대지 밖")),
    },
  };
}

function rejectReason(flags) {
  const reasons = [];
  if (!flags.connected) reasons.push("동선 끊김");
  if (flags.columnHits > 0 || flags.overlapCount > 0) reasons.push("충돌");
  if (!flags.slopeOk) reasons.push("경사 초과");
  if (!flags.siteOk) reasons.push("대지 밖");
  return reasons.join(" · ") || "조건 미달";
}

function variantName(spec, input) {
  const axis = spec.axis === "x" ? "가로 베이" : "세로 베이";
  const pack = spec.packFrom === "end" ? "루프 반대 정렬" : "루프 기준";
  const bay = spec.bayMode === "minus1" ? "내부 베이 -1" : "내부 최대";
  const placement = spec.rampPlacement === "external" ? "외부 램프" : "내부 램프";
  const entrance = spec.rampPlacement === "external" ? resolveEntrance(spec.entranceMode, input.entranceMode || "separate") : "integrated";
  const door = entrance === "integrated" ? "램프 출입(양방향)" : "분리 출입";
  return `${axis} · ${pack} · ${bay} · ${placement} · ${door}`;
}

function resolveEntrance(mode, current) {
  if (mode === "opposite") return current === "integrated" ? "separate" : "integrated";
  if (mode === "integrated" || mode === "separate") return mode;
  return current === "integrated" ? "integrated" : "separate";
}

function normalizePlate(plate) {
  return {
    inner: !!plate.inner,
    moduleGrid: plate.moduleGrid,
    blockRects: plate.blockRects,
    outline: plate.outline || null,
    voids: plate.voids || null,
    extraAisles: plate.extraAisles,
    wallColumns: plate.wallColumns,
    roadEdge: plate.roadEdge || null,
    clearRequired: plate.clearRequired || CLEAR_HEIGHT,
    width: plate.width,
    depth: plate.depth,
    spacing: plate.spacing || 8.1,
    columnWidth: plate.columnWidth || COLUMN,
    columnDepth: plate.columnDepth || plate.columnWidth || COLUMN,
    minClear: plate.minClear == null ? 0.05 : plate.minClear,
    siteMargin: plate.siteMargin == null ? 20 : plate.siteMargin,
    siteMargins: plate.siteMargins || null,
    stallRules: plate.stallRules || null,
    spansX: Array.isArray(plate.spansX) ? plate.spansX : null,
    spansY: Array.isArray(plate.spansY) ? plate.spansY : null,
    trimDeadEnds: plate.trimDeadEnds !== false,
    floorHeight: floorHeightOf(plate),
    legalStalls: Number(plate.legalStalls) || (plate.stallRules && Number(plate.stallRules.legalStalls)) || 0,
  };
}

function defaultRamp(plate, placement) {
  return {
    id: 1,
    edge: "w",
    t: round1(plate.depth / 2),
    width: 6,
    length: minStraightRampLength(floorHeightOf(plate), rampTransitions(plate)),
    placement,
  };
}

function shiftRamp(ramp, spec, plate) {
  if (ramp.pos) return ramp;   // 사용자가 도로변 위치를 정했으면 옮기지 않는다
  const along = ramp.edge === "n" || ramp.edge === "s" ? plate.width : plate.depth;
  const delta = spec.rampShift ? along * 0.22 : 0;
  return { ...ramp, t: ramp.t + delta };
}

function buildOpenings(input, plate, ramp, entranceMode) {
  if (entranceMode === "integrated") {
    const width = ramp.width;
    return ["in", "out"].map((kind, index) => clampOpening({
      id: 100 + index,
      kind,
      edge: ramp.edge,
      t: ramp.t,
      width,
      linkedRamp: ramp.id,
    }, plate));
  }
  const custom = (input.openings || []).filter((opening) => !opening.linkedRamp);
  if (custom.length) return custom.map((opening) => clampOpening(opening, plate));
  return autoSeparate(plate, ramp);
}

function snapRamp(ramp, plate, spec) {
  const width = Math.max(AISLE, ramp.width || AISLE);
  const next = { ...ramp, width };
  const alongLen = next.edge === "w" || next.edge === "e" ? plate.depth : plate.width;
  // 도로변 위치(pos): start = 서쪽/남쪽 끝, mid = 가운데, end = 동쪽/북쪽 끝
  if (next.pos === "mid") next.t = alongLen / 2;
  if ((next.placement || "internal") !== "internal") {
    if (next.pos === "start") next.t = width / 2;
    if (next.pos === "end") next.t = alongLen - width / 2;
    next.t = clampExternalT(next, plate);
    return next;
  }
  if (next.pos === "mid") return next;
  const along = next.edge === "w" || next.edge === "e" ? plate.depth : plate.width;
  // 직선으로 들어가면 벽에 붙인다(램프 → 주차칸 → 순환 차로, wallStrip 참고). 곡선이면 순환 차로 줄에 둔다.
  const half = next.width / 2;
  const straight = rampShape({ ...next, t: half }, plate).kind === "straight";
  const centers = straight
    ? [half, along - half]
    : [STALL_D + AISLE / 2, along - STALL_D - AISLE / 2];
  const ordered = centers.slice().sort((a, b) => Math.abs(a - next.t) - Math.abs(b - next.t));
  if (next.pos === "start" || next.pos === "end") {
    next.t = next.pos === "start" ? Math.min(...centers) : Math.max(...centers);
    return next;
  }
  next.t = spec.rampShift ? ordered[ordered.length - 1] : ordered[0];
  return next;
}

function clampExternalT(ramp, plate) {
  const half = Math.max(ramp.width, AISLE) / 2;
  const along = ramp.edge === "n" || ramp.edge === "s" ? plate.width : plate.depth;
  const rings = ramp.edge === "w" || ramp.edge === "e"
    ? [[STALL_D, STALL_D + AISLE], [plate.depth - STALL_D - AISLE, plate.depth - STALL_D]]
    : [[STALL_D, STALL_D + AISLE], [plate.width - STALL_D - AISLE, plate.width - STALL_D]];
  let t = clamp(ramp.t, half, along - half);
  rings.forEach(([start, end]) => {
    const overlap = Math.min(t + half, end) - Math.max(t - half, start);
    if (overlap > 0.2 && overlap < end - start - 0.2) {
      const mid = (start + end) / 2;
      t = t < mid ? start - half - 1 : end + half + 1;
    }
  });
  return clamp(t, half, along - half);
}

function autoSeparate(plate, ramp) {
  const horizontal = ramp.edge === "w" || ramp.edge === "e";
  const low = ramp.t < (horizontal ? plate.depth : plate.width) / 2;
  let edge = "s";
  if (horizontal) edge = low ? "n" : "s";
  else edge = ramp.edge === "s" ? "e" : "w";
  const along = edge === "n" || edge === "s" ? plate.width : plate.depth;
  return [0.28, 0.72].map((ratio, index) => clampOpening({
    id: 201 + index,
    kind: index === 0 ? "in" : "out",
    edge,
    t: along * ratio,
    width: AISLE,
  }, plate));
}

function sharesRamp(opening, ramp) {
  return opening.edge === ramp.edge && Math.abs(opening.t - ramp.t) < 0.4 && Math.abs(opening.width - ramp.width) < 0.4;
}

/**
 * 벽에 붙은 내부 직선 램프 → 그 벽 쪽을 "램프 줄"로 떼어 내고 나머지를 순환형으로 다시 짠다.
 *   벽 → 램프 → 주차칸 5m → 순환 차로 6m → …
 * 램프 옆에 차로를 두면 차로 한쪽이 놀기 때문에, 램프 옆에는 주차칸을 붙인다(칸은 안쪽 차로에서 진입).
 * 램프 시작·끝과 만나는 순환 차로(램프와 직각인 두 줄)는 벽까지 늘려 램프와 이어 준다.
 */
function wallStrip(ramp, plate) {
  if ((ramp.placement || "internal") === "external") return null;
  const vertical = ramp.edge === "n" || ramp.edge === "s";
  const along = vertical ? plate.width : plate.depth;
  const lo = ramp.t - ramp.width / 2;
  const hi = ramp.t + ramp.width / 2;
  if (lo < STALL_D - 0.5) return { side: vertical ? "w" : "s", k: hi };
  if (hi > along - STALL_D + 0.5) return { side: vertical ? "e" : "n", k: along - lo };
  return null;
}

function layoutGeometry(plate, spec, strip) {
  if (!strip) {
    return {
      aisles: loopAisles(plate).concat(innerAisles(plate, spec)),
      bands: perimeterBands(plate).concat(innerStallBands(plate, spec)),
    };
  }
  const { side, k } = strip;
  const horiz = side === "w" || side === "e";
  const sub = horiz ? { ...plate, width: plate.width - k } : { ...plate, depth: plate.depth - k };
  const dx = side === "w" ? k : 0;
  const dy = side === "s" ? k : 0;
  const mv = (r) => ({ ...r, x: r.x + dx, y: r.y + dy });
  const toWall = (r) => {
    if (horiz) {
      if (side === "w") return { ...r, w: r.x + r.w, x: 0 };
      return { ...r, w: plate.width - r.x };
    }
    if (side === "s") return { ...r, d: r.y + r.d, y: 0 };
    return { ...r, d: plate.depth - r.y };
  };
  const rings = loopAisles(sub).map(mv).map((r) => {
    const cross = horiz ? r.side === "s" || r.side === "n" : r.side === "w" || r.side === "e";
    return cross ? toWall(r) : r;
  });
  const perim = perimeterBands(sub).map(mv).map((b) => (horiz && b.along === "x" ? toWall(b) : b));
  return {
    aisles: rings.concat(innerAisles(sub, spec).map(mv)),
    bands: perim.concat(innerStallBands(sub, spec).map(mv)),
  };
}

function loopAisles(plate) {
  const o = STALL_D;
  const a = AISLE;
  return [
    { x: 0, y: o, w: plate.width, d: a, role: "ring", phase: "loop", side: "s" },
    { x: 0, y: plate.depth - o - a, w: plate.width, d: a, role: "ring", phase: "loop", side: "n" },
    { x: o, y: o, w: a, d: plate.depth - 2 * o, role: "ring", phase: "loop", side: "w" },
    { x: plate.width - o - a, y: o, w: a, d: plate.depth - 2 * o, role: "ring", phase: "loop", side: "e" },
  ];
}

function packSpan(span, bayMode) {
  if (span < STALL_D - 0.01) return [];
  const events = [{ kind: "stall", a: 0, b: STALL_D, face: "near" }];
  let cursor = STALL_D;
  while (cursor + STALL_D + AISLE <= span + 0.01) {
    const stallEnd = cursor + STALL_D;
    const aisleEnd = stallEnd + AISLE;
    events.push({ kind: "stall", a: cursor, b: stallEnd, face: "far" });
    events.push({ kind: "aisle", a: stallEnd, b: aisleEnd });
    cursor = aisleEnd;
    if (cursor + STALL_D <= span + 0.01) {
      events.push({ kind: "stall", a: cursor, b: cursor + STALL_D, face: "near" });
      cursor += STALL_D;
    } else break;
  }
  if (bayMode !== "minus1") return events;
  let last = -1;
  events.forEach((event, index) => {
    if (event.kind === "aisle") last = index;
  });
  if (last < 0) return events;
  const aisle = events[last];
  return events.filter((event) => {
    if (event === aisle) return false;
    if (event.kind === "stall" && event.face === "far" && Math.abs(event.b - aisle.a) < 0.05) return false;
    if (event.kind === "stall" && event.face === "near" && Math.abs(event.a - aisle.b) < 0.05) return false;
    return true;
  });
}

function worldBands(start, end, bayMode, packFrom) {
  const span = end - start;
  const local = packSpan(span, bayMode);
  if (packFrom !== "end") {
    return local.map((band) => ({ ...band, a: start + band.a, b: start + band.b }));
  }
  return local.map((band) => ({
    kind: band.kind,
    a: end - band.b,
    b: end - band.a,
    face: band.face === "near" ? "far" : band.face === "far" ? "near" : band.face,
  }));
}

function innerAisles(plate, spec) {
  return innerPieces(plate, spec).aisles;
}

function innerStallBands(plate, spec) {
  return innerPieces(plate, spec).bands;
}

function innerPieces(plate, spec) {
  const origin = STALL_D + AISLE;
  const x0 = origin;
  const y0 = origin;
  const x1 = plate.width - origin;
  const y1 = plate.depth - origin;
  if (x1 - x0 < STALL_W || y1 - y0 < STALL_D) return { bands: [], aisles: [] };
  // spec.offset: 안쪽 주차 줄 시작을 몇 m 밀지(코어 위치에 줄을 맞추기 위한 탐색값)
  const off = Number(spec.offset) || 0;
  const span = (a, b) => (spec.packFrom === "end" ? [a, b - off] : [a + off, b]);
  if (spec.axis === "x") {
    const packed = worldBands(...span(y0, y1), spec.bayMode, spec.packFrom);
    const bands = [];
    const aisles = [];
    packed.forEach((band) => {
      if (band.kind === "stall") {
        bands.push({
          x: x0,
          y: band.a,
          w: x1 - x0,
          d: band.b - band.a,
          along: "x",
          face: band.face === "near" ? "s" : "n",
          phase: "inner",
        });
      } else {
        aisles.push({
          x: STALL_D,
          y: band.a,
          w: plate.width - STALL_D * 2,
          d: band.b - band.a,
          role: "interior",
          phase: "inner",
        });
      }
    });
    return { bands, aisles };
  }
  const packed = worldBands(...span(x0, x1), spec.bayMode, spec.packFrom);
  const bands = [];
  const aisles = [];
  packed.forEach((band) => {
    if (band.kind === "stall") {
      bands.push({
        x: band.a,
        y: y0,
        w: band.b - band.a,
        d: y1 - y0,
        along: "y",
        face: band.face === "near" ? "w" : "e",
        phase: "inner",
      });
    } else {
      aisles.push({
        x: band.a,
        y: STALL_D,
        w: band.b - band.a,
        d: plate.depth - STALL_D * 2,
        role: "interior",
        phase: "inner",
      });
    }
  });
  return { bands, aisles };
}

function perimeterBands(plate) {
  const side = STALL_D + AISLE;
  const sideD = plate.depth - side * 2;
  const bands = [
    { x: 0, y: 0, w: plate.width, d: STALL_D, along: "x", face: "n", phase: "perimeter" },
    { x: 0, y: plate.depth - STALL_D, w: plate.width, d: STALL_D, along: "x", face: "s", phase: "perimeter" },
  ];
  if (sideD >= STALL_W) {
    bands.push({ x: 0, y: side, w: STALL_D, d: sideD, along: "y", face: "e", phase: "perimeter" });
    bands.push({ x: plate.width - STALL_D, y: side, w: STALL_D, d: sideD, along: "y", face: "w", phase: "perimeter" });
  }
  return bands;
}

/**
 * 내부 램프 입구 앞 진입 자리(차로 폭 6m). 아래층에서 한 바퀴 돈 차가 여기서 램프로 들어간다.
 * 이 자리에 주차칸이 들어가면 램프 입구가 막히므로 차로로 비워 둔다.
 */
function rampEntryAisle(ramp, plate) {
  if ((ramp.placement || "internal") === "external") return null;
  const local = localFrame(ramp.edge, plate);
  const half = Math.max(ramp.width, AISLE) / 2;
  return { role: "approach", phase: "loop", portals: [],
    ...local.rect({ u0: ramp.t - half, u1: ramp.t + half, v0: insetOf(ramp) - AISLE, v1: insetOf(ramp) }) };
}

function approachAisle(ramp, plate) {
  const span = Math.max(ramp.width, AISLE);
  const reach = STALL_D + AISLE;
  const aisle = { role: "approach", phase: "loop", portals: [] };
  if (ramp.placement === "external") {
    if (ramp.edge === "w") return { ...aisle, x: 0, y: ramp.t - span / 2, w: reach, d: span };
    if (ramp.edge === "e") return { ...aisle, x: plate.width - reach, y: ramp.t - span / 2, w: reach, d: span };
    if (ramp.edge === "s") return { ...aisle, x: ramp.t - span / 2, y: 0, w: span, d: reach };
    return { ...aisle, x: ramp.t - span / 2, y: plate.depth - reach, w: span, d: reach };
  }
  const shape = rampShape(ramp, plate);
  if (shape.kind === "curved") return { ...aisle, ...shape.approach };
  // 직선 램프 끝이 반대쪽 순환 차로에 걸치면(램프가 깊이를 끝까지 쓰는 경우):
  // 램프 줄은 벽까지 도착 자리로 두고, 가운데 쪽 옆 칸(차로 폭)을 벽까지 터서 순환 차로로 꺾어 나가게 한다.
  {
    const vertical = ramp.edge === "n" || ramp.edge === "s";
    const across = vertical ? plate.depth : plate.width;
    const along = vertical ? plate.width : plate.depth;
    const end = insetOf(ramp) + ramp.length;
    const farStart = across - (STALL_D + AISLE);
    if (end > farStart + 0.01) {
      const local = localFrame(ramp.edge, plate);
      const half = Math.max(ramp.width, AISLE) / 2;
      const sgn = ramp.t <= along / 2 ? 1 : -1;
      const sideU0 = sgn > 0 ? ramp.t + half : ramp.t - half - AISLE;
      return [
        { ...aisle, ...local.rect({ u0: ramp.t - half, u1: ramp.t + half, v0: end, v1: across }) },
        { ...aisle, role: "approach", ...local.rect({ u0: sideU0, u1: sideU0 + AISLE, v0: farStart, v1: across }) },
      ];
    }
  }
  const box = rampFootprint(ramp, plate);
  if (ramp.edge === "w") return { ...aisle, x: box.x + box.w, y: box.y + (box.d - span) / 2, w: AISLE, d: span };
  if (ramp.edge === "e") return { ...aisle, x: box.x - AISLE, y: box.y + (box.d - span) / 2, w: AISLE, d: span };
  if (ramp.edge === "s") return { ...aisle, x: box.x + (box.w - span) / 2, y: box.y + box.d, w: span, d: AISLE };
  return { ...aisle, x: box.x + (box.w - span) / 2, y: box.y - AISLE, w: span, d: AISLE };
}

function entryAisle(opening, plate) {
  const span = Math.max(opening.width, AISLE);
  const reach = STALL_D + AISLE;
  const aisle = { role: "entry", phase: "loop", portals: [] };
  if (opening.edge === "s") return { ...aisle, x: opening.t - span / 2, y: 0, w: span, d: reach };
  if (opening.edge === "n") return { ...aisle, x: opening.t - span / 2, y: plate.depth - reach, w: span, d: reach };
  if (opening.edge === "w") return { ...aisle, x: 0, y: opening.t - span / 2, w: reach, d: span };
  return { ...aisle, x: plate.width - reach, y: opening.t - span / 2, w: reach, d: span };
}

function cutBlock(aisle, block, role) {
  if (overlapArea(aisle, block) < 0.04) return [aisle];
  // 램프가 차로 폭의 일부만 먹으면, 옆에 남는 가는 띠는 쓸 수 없으므로 그 폭 전체를 끊는다.
  // (예: 직선 램프 끝이 반대쪽 순환 차로에 1~2m 걸칠 때 차로 전체가 사라지지 않고 램프 줄만 끊긴다)
  const horizontalAisle = aisle.w + 0.01 >= aisle.d;
  if (horizontalAisle) {
    const y0 = Math.max(aisle.y, block.y);
    const y1 = Math.min(aisle.y + aisle.d, block.y + block.d);
    if (y1 - y0 < aisle.d - 0.01) block = { x: block.x, w: block.w, y: aisle.y, d: aisle.d };
  } else {
    const x0 = Math.max(aisle.x, block.x);
    const x1 = Math.min(aisle.x + aisle.w, block.x + block.w);
    if (x1 - x0 < aisle.w - 0.01) block = { x: aisle.x, w: aisle.w, y: block.y, d: block.d };
  }
  return subtractRect(aisle, block)
    .filter((part) => durable(part, aisle) && (horizontalAisle ? part.w : part.d) >= 5.5)
    .map((part) => ({ ...aisle, ...part, portals: [], role: aisle.role || role }));
}

function durable(part, aisle) {
  const horizontal = aisle.w + 0.01 >= aisle.d;
  if (horizontal) return part.d >= AISLE_MIN && part.w >= 2;
  return part.w >= AISLE_MIN && part.d >= 2;
}

function applyCore(aisles, core, plate, rampBoxes) {
  const next = [];
  aisles.forEach((aisle) => {
    if (overlapArea(aisle, core) < 0.04) {
      next.push(aisle);
      return;
    }
    const parts = subtractRect(aisle, core).filter((part) => durable(part, aisle));
    parts.sort((a, b) => b.w * b.d - a.w * a.d);
    parts.forEach((part, index) => {
      next.push({ ...aisle, ...part, portals: index === 0 ? (aisle.portals || []) : [] });
    });
    detourFor(aisle, core, plate, rampBoxes).forEach((piece) => next.push(piece));
  });
  return next;
}

function detourFor(aisle, core, plate, rampBoxes) {
  const boxes = [].concat(rampBoxes || []);
  const horizontal = aisle.w + 0.01 >= aisle.d;
  const sides = horizontal ? ["n", "s"] : ["e", "w"];
  for (let index = 0; index < sides.length; index += 1) {
    const pieces = detourPieces(aisle, core, sides[index])
      .map((piece) => clipDrive(piece, plate))
      .filter(Boolean);
    if (pieces.length < 3) continue;
    if (pieces.some((piece) => overlapArea(piece, core) > 0.04)) continue;
    if (pieces.some((piece) => boxes.some((box) => overlapArea(piece, box) > 0.4))) continue;
    return pieces.map((piece) => ({ ...piece, role: "bypass", phase: "bypass", portals: [] }));
  }
  return [];
}

function detourPieces(aisle, core, side) {
  if (side === "n" || side === "s") {
    const y = side === "n" ? core.y + core.d : core.y - AISLE;
    const y0 = Math.min(aisle.y, y);
    const y1 = Math.max(aisle.y + aisle.d, y + AISLE);
    const westX = core.x - AISLE;
    const eastX = core.x + core.w;
    return [
      { x: westX, y: y0, w: AISLE, d: y1 - y0 },
      { x: eastX, y: y0, w: AISLE, d: y1 - y0 },
      { x: westX, y, w: eastX + AISLE - westX, d: AISLE },
    ];
  }
  const x = side === "e" ? core.x + core.w : core.x - AISLE;
  const x0 = Math.min(aisle.x, x);
  const x1 = Math.max(aisle.x + aisle.w, x + AISLE);
  const southY = core.y - AISLE;
  const northY = core.y + core.d;
  return [
    { x: x0, y: southY, w: x1 - x0, d: AISLE },
    { x: x0, y: northY, w: x1 - x0, d: AISLE },
    { x, y: southY, w: AISLE, d: northY + AISLE - southY },
  ];
}

function frontIsAisle(stall, aisles) {
  const depth = AISLE_MIN;
  const front = stall.aisle === "n" ? { x: stall.x, y: stall.y + stall.d, w: stall.w, d: depth }
    : stall.aisle === "s" ? { x: stall.x, y: stall.y - depth, w: stall.w, d: depth }
      : stall.aisle === "e" ? { x: stall.x + stall.w, y: stall.y, w: depth, d: stall.d }
        : { x: stall.x - depth, y: stall.y, w: depth, d: stall.d };
  for (let i = 0; i < 4; i += 1) {
    for (let j = 0; j < 7; j += 1) {
      const px = front.x + front.w * (0.1 + 0.8 * (i / 3));
      const py = front.y + front.d * (0.05 + 0.9 * (j / 6));
      if (!aisles.some((a) => px >= a.x - 1e-6 && px <= a.x + a.w + 1e-6 && py >= a.y - 1e-6 && py <= a.y + a.d + 1e-6)) return false;
    }
  }
  return true;
}

/**
 * 막다른 차로 잇기: 차로 끝이 아무 차로에도 닿지 않으면, 같은 방향으로 늘려(최대 6m) 다른 차로에 닿을 때 이어 준다.
 * 코어·램프를 지나가면 잇지 않는다. 막다른 차로를 줄여 순환을 만든다.
 * (예: 코어를 돌아가는 차로가 반대쪽 순환 차로 몇 m 앞에서 끊겨 있던 경우)
 */
function extendDeadEnds(aisles, blockers, plate) {
  const out = aisles.map((a) => ({ ...a }));
  const MAX = 6;
  out.forEach((a, i) => {
    if (a.role === "approach" || Math.max(a.w, a.d) < AISLE) return;
    const horizontal = a.w >= a.d;
    const tries = horizontal
      ? [{ dir: 1, from: a.x + a.w }, { dir: -1, from: a.x }]
      : [{ dir: 1, from: a.y + a.d }, { dir: -1, from: a.y }];
    for (const t of tries) {
      const probe = horizontal
        ? { x: t.dir > 0 ? t.from : t.from - 0.3, y: a.y, w: 0.3, d: a.d }
        : { x: a.x, y: t.dir > 0 ? t.from : t.from - 0.3, w: a.w, d: 0.3 };
      if (out.some((b, j) => j !== i && overlapArea(probe, b) > 0.2)) continue;
      let bestGap = Infinity;
      out.forEach((b, j) => {
        if (j === i) return;
        const cover = horizontal
          ? Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y)
          : Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        if (cover < AISLE_MIN) return;
        const gap = horizontal
          ? (t.dir > 0 ? b.x - t.from : t.from - (b.x + b.w))
          : (t.dir > 0 ? b.y - t.from : t.from - (b.y + b.d));
        if (gap > 0.01 && gap <= MAX && gap < bestGap) bestGap = gap;
      });
      if (!Number.isFinite(bestGap)) continue;
      const ext = horizontal
        ? { x: t.dir > 0 ? t.from : t.from - bestGap, y: a.y, w: bestGap, d: a.d }
        : { x: a.x, y: t.dir > 0 ? t.from : t.from - bestGap, w: a.w, d: bestGap };
      if (ext.x < -1e-6 || ext.y < -1e-6 || ext.x + ext.w > plate.width + 1e-6 || ext.y + ext.d > plate.depth + 1e-6) continue;
      if (blockers.some((blk) => overlapArea(ext, blk) > 0.01)) continue;
      if (horizontal) { a.x = Math.min(a.x, ext.x); a.w = round3(a.w + bestGap); }
      else { a.y = Math.min(a.y, ext.y); a.d = round3(a.d + bestGap); }
      break;
    }
  });
  return out;
}

/**
 * 빈자리 줄 채우기: 기둥 칸(bay)에 맞추지 않고, 장애물(차로·코어·램프·다른 칸) 사이 빈 구간마다
 * 구간 시작부터 2.5m씩 붙여 넣는다. 기둥과 너무 가까운 칸은 뒤에서 기둥 충돌 검사로 빠진다.
 */
function fillGapBand(band, bandIndex, plate, obstacles, stalls, offBays) {
  if (offBays && offBays.has(`${bandIndex}:0`)) return;
  const horizontal = band.along === "x";
  if (band.x < -1e-6 || band.y < -1e-6 || band.x + band.w > plate.width + 1e-6 || band.y + band.d > plate.depth + 1e-6) return;
  const a0 = horizontal ? band.x : band.y;
  const a1 = a0 + (horizontal ? band.w : band.d);
  const m = STALL_W + 0.1;
  const zoneOf = (o) => !(o.x > band.x + band.w + m || o.x + o.w < band.x - m || o.y > band.y + band.d + m || o.y + o.d < band.y - m);
  const nearObs = obstacles.filter(zoneOf);
  const nearStalls = stalls.filter(zoneOf);
  const blocks = nearObs.concat(nearStalls)
    .filter((o) => overlapArea(o, band) > 0.03)
    .map((o) => (horizontal ? [o.x, o.x + o.w] : [o.y, o.y + o.d]))
    .sort((p, q) => p[0] - q[0]);
  const free = [];
  let cur = a0;
  blocks.forEach(([b0, b1]) => {
    if (b0 > cur + 1e-6) free.push([cur, Math.min(b0, a1)]);
    cur = Math.max(cur, b1);
  });
  if (cur < a1 - 1e-6) free.push([cur, a1]);
  free.forEach(([f0, f1]) => {
    const count = Math.floor((f1 - f0 + 0.01) / STALL_W);
    for (let k = 0; k < count; k += 1) {
      const pos = f0 + k * STALL_W;
      const stall = horizontal
        ? { x: pos, y: band.y, w: STALL_W, d: band.d }
        : { x: band.x, y: pos, w: band.w, d: STALL_W };
      if (nearObs.some((o) => overlapArea(stall, o) > 0.03) || nearStalls.some((o) => overlapArea(stall, o) > 0.03)) continue;
      nearStalls.push(stall);
      stalls.push({
        x: round3(stall.x), y: round3(stall.y), w: round3(stall.w), d: round3(stall.d),
        aisle: band.face, phase: band.phase, type: "general",
        bay: `${bandIndex}:0`, along: horizontal ? "x" : "y",
        bayFrom: round3(f0), bayTo: round3(f1), bayCount: count,
      });
    }
  });
}

// 방향 통일용: 같은 방향·같은 줄에 놓인 정해진 칸들을 묶어, 줄 양 끝을 칸 깊이만큼 늘린 띠를 만든다.
function uniformStrips(regular, plate) {
  const groups = new Map();
  regular.forEach((stall) => {
    const along = stall.along || (stall.w <= stall.d ? "x" : "y");
    const key = along === "y"
      ? `y:${Math.round(stall.x * 20)}:${Math.round(stall.w * 20)}:${stall.aisle}`
      : `x:${Math.round(stall.y * 20)}:${Math.round(stall.d * 20)}:${stall.aisle}`;
    if (!groups.has(key)) groups.set(key, { along, face: stall.aisle, items: [] });
    groups.get(key).items.push(stall);
  });
  const reach = STALL_D + 0.4;
  return [...groups.values()].map(({ along, face, items }) => {
    if (along === "y") {
      const y0 = Math.max(0, Math.min(...items.map((s) => s.y)) - reach);
      const y1 = Math.min(plate.depth, Math.max(...items.map((s) => s.y + s.d)) + reach);
      return { x: items[0].x, y: y0, w: items[0].w, d: y1 - y0, along, face, phase: "fill" };
    }
    const x0 = Math.max(0, Math.min(...items.map((s) => s.x)) - reach);
    const x1 = Math.min(plate.width, Math.max(...items.map((s) => s.x + s.w)) + reach);
    return { x: x0, y: items[0].y, w: x1 - x0, d: items[0].d, along, face, phase: "fill" };
  });
}

function gapBands(aisles) {
  const out = [];
  aisles.forEach((a) => {
    if (Math.abs(a.w - a.d) < 0.5) {
      out.push({ x: a.x, y: a.y + a.d, w: a.w, d: STALL_D, along: "x", face: "s", phase: "fill" });
      out.push({ x: a.x, y: a.y - STALL_D, w: a.w, d: STALL_D, along: "x", face: "n", phase: "fill" });
      out.push({ x: a.x + a.w, y: a.y, w: STALL_D, d: a.d, along: "y", face: "w", phase: "fill" });
      out.push({ x: a.x - STALL_D, y: a.y, w: STALL_D, d: a.d, along: "y", face: "e", phase: "fill" });
      return;
    }
    if (a.w >= a.d) {
      if (a.w < STALL_W) return;
      out.push({ x: a.x, y: a.y + a.d, w: a.w, d: STALL_D, along: "x", face: "s", phase: "fill" });
      out.push({ x: a.x, y: a.y - STALL_D, w: a.w, d: STALL_D, along: "x", face: "n", phase: "fill" });
    } else {
      if (a.d < STALL_W) return;
      out.push({ x: a.x + a.w, y: a.y, w: STALL_D, d: a.d, along: "y", face: "w", phase: "fill" });
      out.push({ x: a.x - STALL_D, y: a.y, w: STALL_D, d: a.d, along: "y", face: "e", phase: "fill" });
    }
  });
  return out;
}

function fillBand(band, bandIndex, plate, lines, columnWidth, minClear, obstacles, stalls, bayStats, offBays) {
  if (band.phase === "fill") return fillGapBand(band, bandIndex, plate, obstacles, stalls, offBays);
  const horizontal = band.along === "x";
  const origin = horizontal ? band.x : band.y;
  const limit = origin + (horizontal ? band.w : band.d);
  // 띠 근처만 검사(속도용). 칸은 띠 ±칸 폭 안에만 놓인다.
  const m = STALL_W + 0.1;
  const zoneOf = (o) => !(o.x > band.x + band.w + m || o.x + o.w < band.x - m || o.y > band.y + band.d + m || o.y + o.d < band.y - m);
  const nearObs = obstacles.filter(zoneOf);
  const nearStalls = stalls.filter(zoneOf);
  for (let index = 0; index < lines.length - 1; index += 1) {
    const bay0 = lines[index];
    const bay1 = lines[index + 1];
    if (bay1 <= origin + 0.05 || bay0 >= limit - 0.05) continue;
    if (offBays && offBays.has(`${bandIndex}:${index}`)) continue;
    const pack = stallsPerBay(bay1 - bay0, columnWidth, minClear);
    const count = pack.count;
    if (!count) continue;
    const face0 = bay0 + columnWidth / 2;
    const gap = pack.gap;
    let placed = 0;
    for (let stallIndex = 0; stallIndex < count; stallIndex += 1) {
      const pos = face0 + gap + stallIndex * STALL_W;
      const stall = horizontal
        ? { x: pos, y: band.y, w: STALL_W, d: band.d, aisle: band.face, phase: band.phase }
        : { x: band.x, y: pos, w: band.w, d: STALL_W, aisle: band.face, phase: band.phase };
      if (stall.x < -1e-6 || stall.y < -1e-6 || stall.x + stall.w > plate.width + 1e-6 || stall.y + stall.d > plate.depth + 1e-6) continue;
      // 빈자리 채우기 줄은 길이 방향으로 줄 끝을 넘어도 된다(앞 6m 차로 여부는 frontIsAisle로 따로 확인).
      const loose = band.phase === "fill" ? STALL_W : 0.02;
      if (horizontal && (stall.x < band.x - loose || stall.x + stall.w > band.x + band.w + loose)) continue;
      if (!horizontal && (stall.y < band.y - loose || stall.y + stall.d > band.y + band.d + loose)) continue;
      if (Math.min(stall.w, stall.d) < STALL_W - 0.02 || Math.max(stall.w, stall.d) < STALL_D - 0.02) continue;
      if (nearObs.some((block) => overlapArea(stall, block) > 0.03)) continue;
      if (nearStalls.some((item) => overlapArea(stall, item) > 0.03)) continue;
      nearStalls.push(stall);
      stalls.push({
        x: round3(stall.x),
        y: round3(stall.y),
        w: round3(stall.w),
        d: round3(stall.d),
        aisle: stall.aisle,
        phase: stall.phase,
        type: "general",
        bay: `${bandIndex}:${index}`,
        along: horizontal ? "x" : "y",
        bayFrom: round3(face0),
        bayTo: round3(bay1 - columnWidth / 2),
        bayCount: count,
      });
      placed += 1;
    }
    if (placed) {
      bayStats.total += 1;
      if (placed >= 3) bayStats.triple += 1;
    }
  }
}

function backSegments(bands) {
  return bands.map((band) => {
    if (band.along === "x") {
      const rearSouth = band.face === "n";
      const y = rearSouth ? band.y : band.y + band.d;
      return { axis: "h", y, x0: band.x, x1: band.x + band.w, outward: rearSouth ? -1 : 1 };
    }
    const rearWest = band.face === "e";
    const x = rearWest ? band.x : band.x + band.w;
    return { axis: "v", x, y0: band.y, y1: band.y + band.d, outward: rearWest ? -1 : 1 };
  });
}

// 기둥선 = 주차줄 앞선(차로 쪽). 차로를 가로지르는 기둥 간격이 '차로 6m / 등 맞댄 두 줄 10.4m'로 반복돼
// RC 보로 넘기기 쉬운 12m 이하가 된다(뒤 선에 세우면 칸+차로+칸 ≈ 16.4m). 기둥은 줄 안쪽 0.5m, 기둥 간격 사이(칸 사이 틈)에 선다.
function frontSegments(bands, plate) {
  const backs = backSegments(bands);
  return bands.map((band, i) => {
    // 벽에 등을 댄 줄은 기둥을 벽 쪽(뒤)에 둔다 — 벽에서 건너편 줄 앞선까지 칸+차로 ≈ 11.2m라 12m 이하,
    // 벽 쪽 줄 [확 일 확]처럼 칸이 기둥 틈까지 쓸 수 있다.
    const back = backs[i];
    const onWall = plate && plate.wallColumns !== "front" && (back.axis === "h" ? (back.y <= 0.05 || back.y >= plate.depth - 0.05) : (back.x <= 0.05 || back.x >= plate.width - 0.05));
    if (onWall) return back;
    if (band.along === "x") {
      const frontNorth = band.face === "n";
      const y = frontNorth ? band.y + band.d : band.y;
      return { axis: "h", y, x0: band.x, x1: band.x + band.w, outward: frontNorth ? -1 : 1, front: true };
    }
    const frontEast = band.face === "e";
    const x = frontEast ? band.x + band.w : band.x;
    return { axis: "v", x, y0: band.y, y1: band.y + band.d, outward: frontEast ? -1 : 1, front: true };
  });
}

// 사각형 목록을 4m 칸 격자에 나눠 담아, 어떤 사각형 근처의 것만 빨리 찾는다(속도용).
function rectIndex(list, cell = 4) {
  const map = new Map();
  const key = (i, j) => i * 100003 + j;
  list.forEach((r, n) => {
    const i0 = Math.floor(r.x / cell); const i1 = Math.floor((r.x + r.w) / cell);
    const j0 = Math.floor(r.y / cell); const j1 = Math.floor((r.y + r.d) / cell);
    for (let i = i0; i <= i1; i += 1) for (let j = j0; j <= j1; j += 1) {
      const k = key(i, j);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(n);
    }
  });
  return {
    near(r, m = 0) {
      const seen = new Set();
      const out = [];
      const i0 = Math.floor((r.x - m) / cell); const i1 = Math.floor((r.x + r.w + m) / cell);
      const j0 = Math.floor((r.y - m) / cell); const j1 = Math.floor((r.y + r.d + m) / cell);
      for (let i = i0; i <= i1; i += 1) for (let j = j0; j <= j1; j += 1) {
        (map.get(key(i, j)) || []).forEach((n) => { if (!seen.has(n)) { seen.add(n); out.push(list[n]); } });
      }
      return out;
    },
  };
}

function placeColumns(segments, gridX, gridY, plate, obstacles) {
  const halfW = plate.columnWidth / 2;
  const halfD = plate.columnDepth / 2;
  const seen = new Set();
  const columns = [];
  const obsIndex = rectIndex(obstacles);
  const sharedLine = (segment, pos) => !segment.front && segments.some((other) => {
    if (other === segment || other.axis !== segment.axis) return false;
    const otherPos = other.axis === "h" ? other.y : other.x;
    return Math.abs(otherPos - pos) < 0.3;
  });
  const put = (cx, cy) => {
    const key = `${round1(cx)}:${round1(cy)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const rect = {
      x: cx - halfW,
      y: cy - halfD,
      w: plate.columnWidth,
      d: plate.columnDepth,
    };
    if (rect.x > plate.width + 0.02 || rect.y > plate.depth + 0.02 || rect.x + rect.w < -0.02 || rect.y + rect.d < -0.02) return;
    if (obsIndex.near(rect, (plate.minClear || 0) + 0.01).some((block) => tooClose(rect, block, plate.minClear))) return;
    columns.push({
      x: round3(rect.x),
      y: round3(rect.y),
      w: round3(rect.w),
      d: round3(rect.d),
      phase: "column",
    });
  };
  segments.forEach((segment) => {
    if (segment.axis === "h") {
      const cy = sharedLine(segment, segment.y) ? segment.y : segment.y + segment.outward * halfD;
      gridX.forEach((gx) => {
        if (gx < segment.x0 - 0.05 || gx > segment.x1 + 0.05) return;
        put(gx, cy);
      });
      return;
    }
    const cx = sharedLine(segment, segment.x) ? segment.x : segment.x + segment.outward * halfW;
    gridY.forEach((gy) => {
      if (gy < segment.y0 - 0.05 || gy > segment.y1 + 0.05) return;
      put(cx, gy);
    });
  });
  return columns;
}

function clearanceMark(stalls, columns) {
  for (let index = 0; index < stalls.length; index += 1) {
    const stall = stalls[index];
    const alongX = Math.abs(stall.w - STALL_W) < 0.08 && stall.d + 0.01 >= STALL_D;
    if (!alongX) continue;
    let best = null;
    columns.forEach((column) => {
      const midY = column.y + column.d / 2;
      if (midY < stall.y - column.d - 0.05 || midY > stall.y + stall.d + 0.05) return;
      const left = stall.x - (column.x + column.w);
      if (left < -0.001 || left > 0.45) return;
      if (!best || left < best.gap) best = { column, gap: left };
    });
    if (!best) continue;
    return {
      x1: round3(best.column.x + best.column.w),
      x2: round3(stall.x),
      y: round3(stall.y + 0.45),
      gap: round3(best.gap),
    };
  }
  return null;
}

function stampPortals(aisles, openings, ramp, plate) {
  aisles.forEach((aisle) => {
    aisle.portals = [];
  });
  openings.forEach((opening) => {
    const mouth = mouthRect(opening, plate);
    const host = bestPortalHost(aisles, mouth)
      || (sharesRamp(opening, ramp) ? bestPortalHost(aisles, innerLip(ramp, plate)) : null);
    if (host) host.portals.push({ type: "opening", id: opening.id, kind: opening.kind });
  });
  const lip = innerLip(ramp, plate);
  const host = bestPortalHost(aisles, lip);
  if (host) host.portals.push({ type: "ramp", id: ramp.id });
  if ((ramp.placement || "internal") === "internal") {
    const top = bestPortalHost(aisles, rampTopLip(ramp, plate));
    if (top) top.portals.push({ type: "rampTop", id: ramp.id });
  }
}

function bestPortalHost(aisles, mouth) {
  let best = null;
  let score = 0.4;
  aisles.forEach((aisle) => {
    const area = overlapArea(aisle, mouth);
    if (area > score) {
      score = area;
      best = aisle;
    }
  });
  return best;
}

function mouthRect(opening, plate) {
  const depth = 1.2;
  if (opening.edge === "s") return { x: opening.t - opening.width / 2, y: 0, w: opening.width, d: depth };
  if (opening.edge === "n") return { x: opening.t - opening.width / 2, y: plate.depth - depth, w: opening.width, d: depth };
  if (opening.edge === "w") return { x: 0, y: opening.t - opening.width / 2, w: depth, d: opening.width };
  return { x: plate.width - depth, y: opening.t - opening.width / 2, w: depth, d: opening.width };
}

function innerLip(ramp, plate) {
  const box = rampFootprint(ramp, plate);
  const thick = 1.2;
  if (ramp.placement === "external") {
    if (ramp.edge === "w") return { x: 0, y: box.y, w: thick, d: box.d };
    if (ramp.edge === "e") return { x: plate.width - thick, y: box.y, w: thick, d: box.d };
    if (ramp.edge === "s") return { x: box.x, y: 0, w: box.w, d: thick };
    return { x: box.x, y: plate.depth - thick, w: box.w, d: thick };
  }
  const shape = rampShape(ramp, plate);
  if (shape.kind === "curved") return shape.lip;
  if (ramp.edge === "w") return { x: box.x + box.w - 0.2, y: box.y, w: thick, d: box.d };
  if (ramp.edge === "e") return { x: box.x - thick + 0.2, y: box.y, w: thick, d: box.d };
  if (ramp.edge === "s") return { x: box.x, y: box.y + box.d - 0.2, w: box.w, d: thick };
  return { x: box.x, y: box.y - thick + 0.2, w: box.w, d: thick };
}

function portalIssues(aisles, openings, ramps, plate) {
  const groups = componentGroups(aisles);
  const main = groups.slice().sort((a, b) => b.length - a.length)[0] || [];
  const mainSet = new Set(main);
  const issues = [];
  const hostIndex = (type, id) => aisles.findIndex((aisle) => (aisle.portals || []).some((portal) => portal.type === type && portal.id === id));
  openings.forEach((opening) => {
    const index = hostIndex("opening", opening.id);
    if (index >= 0 && mainSet.has(index)) return;
    issues.push({
      type: "opening",
      id: opening.id,
      edge: opening.edge,
      label: `${edgeLabel(opening.edge)}측 ${opening.kind === "in" ? "입구" : "출구"}가 차로와 연결되지 않습니다.`,
    });
  });
  ramps.forEach((ramp) => {
    const index = hostIndex("ramp", ramp.id);
    const lip = innerLip(ramp, plate);
    const touches = index >= 0 && overlapArea(aisles[index], lip) > 0.4;
    if (index >= 0 && mainSet.has(index) && touches) return;
    issues.push({
      type: "ramp",
      id: ramp.id,
      edge: ramp.edge,
      label: `${edgeLabel(ramp.edge)}측 램프 안쪽 끝단이 차로와 연결되지 않습니다.`,
    });
  });
  // 내부형: 아래층에서 같은 위치의 램프 입구로 다시 들어갈 수 있어야 한다.
  ramps.filter((ramp) => (ramp.placement || "internal") === "internal").forEach((ramp) => {
    const index = hostIndex("rampTop", ramp.id);
    const touches = index >= 0 && overlapArea(aisles[index], rampTopLip(ramp, plate)) > 0.4;
    if (index >= 0 && mainSet.has(index) && touches) return;
    issues.push({
      type: "ramp",
      id: ramp.id,
      edge: ramp.edge,
      label: `${edgeLabel(ramp.edge)}측 램프 입구(아래층 진입)가 차로와 연결되지 않습니다.`,
    });
  });
  if (!openings.some((opening) => opening.kind === "in") || !openings.some((opening) => opening.kind === "out") || !ramps.length) {
    issues.push({ type: "network", label: "입구, 램프, 출구가 모두 있어야 동선이 이어집니다." });
  }
  return issues;
}

function slopeIssues(ramps, plate) {
  const curvedIssues = [];
  const straightRamps = ramps.filter((ramp) => {
    const shape = plate ? rampShape(ramp, plate) : null;
    if (!shape || shape.kind !== "curved") return true;
    if (!shape.ok) curvedIssues.push({ type: "slope", id: ramp.id, label: `${edgeLabel(ramp.edge)}측 곡선 램프: ${shape.reason}.` });
    return false;
  });
  const H = floorHeightOf(plate);
  const tr = plate ? rampTransitions(plate) : true;
  return curvedIssues.concat(straightRamps.filter((ramp) => ramp.length > 0 && rampMainSlope(ramp.length, tr, H) > RAMP_SLOPE_STRAIGHT + 1e-4).map((ramp) => {
    const slope = rampMainSlope(ramp.length, tr, H);
    const shown = Number.isFinite(slope) ? `${(slope * 100).toFixed(1)}%` : "계산 불가";
    const need = minStraightRampLength(H, tr);
    return {
      type: "slope",
      id: ramp.id,
      label: `${edgeLabel(ramp.edge)}측 램프 경사가 ${shown}로 직선 램프 17%를 넘습니다 (완화구간 윗부분 ${tr.top || 0}m·아랫부분 ${tr.bottom || 0}m 반영). 최소 ${need}m 필요.`,
    };
  }));
}

/** 방향별 대지 여유(주차장 외곽 → 대지 경계). 방향별 값이 없으면 공통 값. */
export function siteMarginsOf(plate) {
  const base = plate.siteMargin == null ? 20 : plate.siteMargin;
  const m = plate.siteMargins || {};
  const pick = (k) => (Number.isFinite(Number(m[k])) && m[k] !== null && m[k] !== "" ? Number(m[k]) : base);
  return { n: pick("n"), s: pick("s"), e: pick("e"), w: pick("w") };
}

// 램프가 도로에 접한 변이 아니면 알린다(배치는 유효, 경고만).
function roadIssues(ramps, plate) {
  if (!plate.roadEdge) return [];
  return ramps.filter((ramp) => ramp.edge !== plate.roadEdge).map((ramp) => ({
    type: "road",
    id: ramp.id,
    label: `램프가 ${edgeLabel(ramp.edge)}측에 있습니다. 도로는 ${edgeLabel(plate.roadEdge)}측입니다(조건 단계에서 바꿀 수 있음).`,
  }));
}

function siteIssues(ramps, plate) {
  const m = siteMarginsOf(plate);
  return ramps.filter((ramp) => rampOutside(ramp, plate, m)).map((ramp) => ({
    type: "site",
    id: ramp.id,
    label: `${edgeLabel(ramp.edge)}측 램프가 대지 여유 ${m[ramp.edge]}m 밖으로 나갑니다.`,
  }));
}

function rampOutside(ramp, plate, m) {
  const box = rampFootprint(ramp, plate);
  return box.x < -m.w - 0.05
    || box.y < -m.s - 0.05
    || box.x + box.w > plate.width + m.e + 0.05
    || box.y + box.d > plate.depth + m.n + 0.05;
}

function buildArrows(plate, aisles, openings, ramp, dir, both) {
  // 화살표는 꼭 필요한 것만: 순환 차로(루프) 각 변에 하나씩 + 출입 화살표.
  // 안쪽 차로는 6m 양방향이라 화살표를 그리지 않는다.
  // 내부 램프는 루프의 한 변이다 → 루프 방향을 램프 진행 방향에 맞추고, 램프가 있는 변에는 화살표를 그리지 않는다.
  let skipSide = null;
  if (ramp && (ramp.placement || "internal") === "internal") {
    const box = rampFootprint(ramp, plate);
    const c = centerOf(box);
    const v = { w: [1, 0], e: [-1, 0], s: [0, 1], n: [0, -1] }[ramp.edge] || [1, 0];
    const rx = c.x - plate.width / 2;
    const ry = c.y - plate.depth / 2;
    const cross = rx * v[1] - ry * v[0];
    if (Math.abs(cross) > 1e-6) dir = cross > 0 ? "ccw" : "cw";
    const near = { w: box.x, e: plate.width - (box.x + box.w), s: box.y, n: plate.depth - (box.y + box.d) };
    const vertical = ramp.edge === "n" || ramp.edge === "s";
    const sides = vertical ? ["w", "e"] : ["s", "n"];
    const side = near[sides[0]] <= near[sides[1]] ? sides[0] : sides[1];
    if (near[side] < STALL_D + AISLE) skipSide = side;
  }
  const segments = [];
  const longest = {};
  aisles.forEach((aisle) => {
    if (aisle.role !== "ring" || !aisle.side || aisle.side === skipSide) return;
    const len = Math.max(aisle.w, aisle.d);
    if (len < 8) return;
    if (!longest[aisle.side] || len > Math.max(longest[aisle.side].w, longest[aisle.side].d)) longest[aisle.side] = aisle;
  });
  Object.values(longest).forEach((aisle) => {
    const horizontal = aisle.w >= aisle.d;
    const forward = arrowSign(aisle, plate, dir);
    pushArrow(segments, aisle, horizontal, forward, true);
    if (both) pushArrow(segments, aisle, horizontal, -forward, true);
  });
  const internal = (ramp.placement || "internal") === "internal";
  openings.forEach((opening) => {
    // 내부 램프와 묶인 출입구는 램프 안쪽에 화살표를 그린다(아래 참고).
    if (internal && opening.linkedRamp) return;
    const gate = edgePoint(opening.edge, opening.t, plate);
    const into = inwardPoint(opening, plate);
    segments.push({ x1: gate.x, y1: gate.y, x2: into.x, y2: into.y, arrow: true, phase: "arrow" });
  });
  if (internal) {
    // 램프 중심선을 따라 입구 → 도착 방향 화살표 (양 끝 라벨과 겹치지 않게 1.5m씩 줄임)
    const shape = rampShape(ramp, plate);
    let pts = shape.path && shape.path.length >= 2 ? shape.path.map((p) => ({ x: p.x, y: p.y })) : [];
    if (pts.length < 2) {
      const box = rampFootprint(ramp, plate);
      const c = centerOf(box);
      const vertical = ramp.edge === "n" || ramp.edge === "s";
      const half = (vertical ? box.d : box.w) / 2;
      const sgn = ramp.edge === "s" || ramp.edge === "w" ? 1 : -1;
      pts = vertical
        ? [{ x: c.x, y: c.y - sgn * half }, { x: c.x, y: c.y + sgn * half }]
        : [{ x: c.x - sgn * half, y: c.y }, { x: c.x + sgn * half, y: c.y }];
    }
    const trim = (a, b, d) => {
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: a.x + ((b.x - a.x) / len) * d, y: a.y + ((b.y - a.y) / len) * d };
    };
    pts[0] = trim(pts[0], pts[1], 1.5);
    const n = pts.length;
    pts[n - 1] = trim(pts[n - 1], pts[n - 2], 1.5);
    for (let i = 1; i < n; i += 1) {
      segments.push({ x1: pts[i - 1].x, y1: pts[i - 1].y, x2: pts[i].x, y2: pts[i].y, arrow: true, phase: "arrow", onRamp: true, head: i === n - 1 });
    }
  }
  if (ramp.placement === "external") {
    const box = rampFootprint(ramp, plate);
    const outer = centerOf(box);
    const inner = edgePoint(ramp.edge, ramp.t, plate);
    segments.push({ x1: outer.x, y1: outer.y, x2: inner.x, y2: inner.y, arrow: true, phase: "arrow" });
  }
  return segments;
}

function arrowSign(aisle, plate, dir) {
  const center = centerOf(aisle);
  const horizontal = aisle.w >= aisle.d;
  let sign = horizontal ? (center.y < plate.depth / 2 ? 1 : -1) : (center.x > plate.width / 2 ? 1 : -1);
  if (dir === "cw") sign *= -1;
  return sign;
}

function pushArrow(segments, aisle, horizontal, sign, single = false) {
  const length = horizontal ? aisle.w : aisle.d;
  if (single) {
    // 가운데에 6m짜리 화살표 하나
    const half = Math.min(3, length * 0.3) / length;
    const t0 = 0.5 - half;
    const t1 = 0.5 + half;
    const a = sign < 0 ? 1 - t0 : t0;
    const b = sign < 0 ? 1 - t1 : t1;
    segments.push(horizontal
      ? { x1: aisle.x + aisle.w * a, y1: aisle.y + aisle.d / 2, x2: aisle.x + aisle.w * b, y2: aisle.y + aisle.d / 2, arrow: true, phase: "arrow" }
      : { x1: aisle.x + aisle.w / 2, y1: aisle.y + aisle.d * a, x2: aisle.x + aisle.w / 2, y2: aisle.y + aisle.d * b, arrow: true, phase: "arrow" });
    return;
  }
  const steps = Math.max(1, Math.round(length / 9));
  for (let step = 0; step < steps; step += 1) {
    const t0 = (step + 0.18) / steps;
    const t1 = (step + 0.82) / steps;
    if (sign < 0) {
      const a = 1 - t0;
      const b = 1 - t1;
      segments.push(horizontal
        ? { x1: aisle.x + aisle.w * a, y1: aisle.y + aisle.d / 2, x2: aisle.x + aisle.w * b, y2: aisle.y + aisle.d / 2, arrow: true, phase: "arrow" }
        : { x1: aisle.x + aisle.w / 2, y1: aisle.y + aisle.d * a, x2: aisle.x + aisle.w / 2, y2: aisle.y + aisle.d * b, arrow: true, phase: "arrow" });
    } else {
      segments.push(horizontal
        ? { x1: aisle.x + aisle.w * t0, y1: aisle.y + aisle.d / 2, x2: aisle.x + aisle.w * t1, y2: aisle.y + aisle.d / 2, arrow: true, phase: "arrow" }
        : { x1: aisle.x + aisle.w / 2, y1: aisle.y + aisle.d * t0, x2: aisle.x + aisle.w / 2, y2: aisle.y + aisle.d * t1, arrow: true, phase: "arrow" });
    }
  }
}

function inwardPoint(opening, plate) {
  const reach = STALL_D + AISLE / 2;
  if (opening.edge === "s") return { x: opening.t, y: reach };
  if (opening.edge === "n") return { x: opening.t, y: plate.depth - reach };
  if (opening.edge === "w") return { x: reach, y: opening.t };
  return { x: plate.width - reach, y: opening.t };
}

function compareVariants(a, b) {
  const av = a.metrics.valid ? 1 : 0;
  const bv = b.metrics.valid ? 1 : 0;
  if (av !== bv) return bv - av;
  // 기둥 간격 12m를 지키는 안을 먼저(구조가 안 되는 안은 대수가 많아도 뒤로)
  const as = (a.issues || []).some((i) => i.type === "span") ? 0 : 1;
  const bs = (b.issues || []).some((i) => i.type === "span") ? 0 : 1;
  if (as !== bs) return bs - as;
  if (a.metrics.stalls !== b.metrics.stalls) return b.metrics.stalls - a.metrics.stalls;
  if (a.metrics.areaPerStall !== b.metrics.areaPerStall) return a.metrics.areaPerStall - b.metrics.areaPerStall;
  if (a.metrics.similarity !== b.metrics.similarity) return b.metrics.similarity - a.metrics.similarity;
  return 0;
}

export function countOverlaps(result, cores, rampBoxes, plate) {
  const stalls = result.stalls || [];
  const aisles = (result.aisles || []).filter((aisle) => aisleInside(aisle, plate));
  const columns = result.columns || [];
  let count = 0;
  count += pairHits(stalls, stalls, true);
  count += pairHits(stalls, aisles);
  count += pairHits(stalls, cores);
  count += pairHits(stalls, rampBoxes);
  const minClear = plate.minClear == null ? 0.05 : plate.minClear;
  count += closeHits(columns, stalls, minClear);
  count += closeHits(columns, aisles, minClear);
  // 코어 변 위에 반쯤 묻힌 기둥(격자 교점)은 겹침으로 보지 않는다
  {
    // 코어 벽에 묻힌 기둥(중심이 코어 안 또는 코어 변 위)은 겹침으로 보지 않는다
    const embedded = (col) => cores.some((core) => {
      const cx = col.x + col.w / 2;
      const cy = col.y + col.d / 2;
      return cx >= core.x - 0.01 && cx <= core.x + core.w + 0.01 && cy >= core.y - 0.01 && cy <= core.y + core.d + 0.01;
    });
    count += closeHits(columns.filter((col) => !embedded(col)), cores, minClear);
  }
  count += closeHits(columns, rampBoxes, minClear);
  count += pairHits(aisles, cores);
  count += pairHits(aisles, rampBoxes);
  count += pairHits(cores, rampBoxes);
  return count;
}

function aisleInside(aisle, plate) {
  return aisle.x < plate.width - 0.05 && aisle.y < plate.depth - 0.05 && aisle.x + aisle.w > 0.05 && aisle.y + aisle.d > 0.05;
}

function closeHits(listA, listB, minClear) {
  let hits = 0;
  for (let i = 0; i < listA.length; i += 1) {
    for (let j = 0; j < listB.length; j += 1) {
      if (tooClose(listA[i], listB[j], minClear)) hits += 1;
    }
  }
  return hits;
}

function pairHits(listA, listB, unique) {
  let hits = 0;
  for (let i = 0; i < listA.length; i += 1) {
    const start = unique ? i + 1 : 0;
    for (let j = start; j < listB.length; j += 1) {
      if (overlapArea(listA[i], listB[j]) > 0.03) hits += 1;
    }
  }
  return hits;
}

function aisleArea(aisles, plate) {
  const step = 0.5;
  let cells = 0;
  for (let y = step / 2; y < plate.depth; y += step) {
    for (let x = step / 2; x < plate.width; x += step) {
      if (aisles.some((aisle) => x >= aisle.x && x < aisle.x + aisle.w && y >= aisle.y && y < aisle.y + aisle.d)) cells += 1;
    }
  }
  return cells * step * step;
}

function deadEndCount(aisles, adj) {
  return aisles.reduce((sum, aisle, index) => {
    if ((aisle.portals || []).length) return sum;
    return sum + (adj[index].length <= 1 ? 1 : 0);
  }, 0);
}

function repairNetwork(aisles, plate, blockers) {
  let current = aisles.slice();
  for (let pass = 0; pass < 4; pass += 1) {
    const groups = componentGroups(current);
    if (groups.length <= 1) return current;
    groups.sort((a, b) => b.length - a.length);
    let added = false;
    for (let group = 1; group < groups.length; group += 1) {
      const link = closestBridge(current, groups[group], groups[0], plate, blockers);
      if (!link) continue;
      current.push(...link);
      added = true;
    }
    if (!added) break;
  }
  return current;
}

function closestBridge(aisles, group, main, plate, blockers) {
  let best = null;
  let bestDist = Infinity;
  group.forEach((from) => {
    main.forEach((to) => {
      linkOptions(aisles[from], aisles[to]).forEach((option) => {
        const clipped = option.map((rect) => clipDrive({ ...rect, role: "repair", phase: "loop", portals: [] }, plate)).filter(Boolean);
        if (clipped.length !== option.length) return;
        if (clipped.some((rect) => blockers.some((block) => overlapArea(rect, block) > 0.4))) return;
        const dist = rectGap(aisles[from], aisles[to]);
        if (dist < bestDist) {
          bestDist = dist;
          best = clipped;
        }
      });
    });
  });
  return best;
}

function linkOptions(a, b) {
  const options = [];
  const straight = straightLink(a, b);
  if (straight) options.push([straight]);
  const ac = centerOf(a);
  const bc = centerOf(b);
  options.push([
    { x: Math.min(ac.x, bc.x) - AISLE / 2, y: ac.y - AISLE / 2, w: Math.abs(bc.x - ac.x) + AISLE, d: AISLE },
    { x: bc.x - AISLE / 2, y: Math.min(ac.y, bc.y) - AISLE / 2, w: AISLE, d: Math.abs(bc.y - ac.y) + AISLE },
  ]);
  return options;
}

function straightLink(a, b) {
  const ox = overlapAmount(a.x, a.x + a.w, b.x, b.x + b.w);
  const oy = overlapAmount(a.y, a.y + a.d, b.y, b.y + b.d);
  if (ox >= AISLE && oy < -0.05) {
    const x = Math.max(a.x, b.x);
    const span = Math.min(AISLE, ox);
    const y = Math.min(a.y + a.d, b.y + b.d);
    return { x: x + (ox - span) / 2, y, w: span, d: -oy };
  }
  if (oy >= AISLE && ox < -0.05) {
    const y = Math.max(a.y, b.y);
    const span = Math.min(AISLE, oy);
    const x = Math.min(a.x + a.w, b.x + b.w);
    return { x, y: y + (oy - span) / 2, w: -ox, d: span };
  }
  return null;
}

function buildGraph(aisles) {
  const adj = aisles.map(() => []);
  for (let i = 0; i < aisles.length; i += 1) {
    for (let j = i + 1; j < aisles.length; j += 1) {
      // 가장자리 맞춤 띠(trim)는 옆 차로의 일부라 조금만 닿아도 이어진 것으로 본다
      if (aisles[i].role === "trim" || aisles[j].role === "trim") {
        const a = aisles[i];
        const b = aisles[j];
        const ox = overlapAmount(a.x, a.x + a.w, b.x, b.x + b.w);
        const oy = overlapAmount(a.y, a.y + a.d, b.y, b.y + b.d);
        if (!((ox >= 0.3 && oy >= -0.02) || (oy >= 0.3 && ox >= -0.02))) continue;
      } else if (contactLength(aisles[i], aisles[j]) < AISLE_MIN) continue;
      adj[i].push(j);
      adj[j].push(i);
    }
  }
  return adj;
}

function componentGroups(aisles) {
  const adj = buildGraph(aisles);
  const seen = new Set();
  const groups = [];
  for (let index = 0; index < aisles.length; index += 1) {
    if (seen.has(index)) continue;
    const group = [];
    const queue = [index];
    seen.add(index);
    while (queue.length) {
      const current = queue.shift();
      group.push(current);
      adj[current].forEach((next) => {
        if (seen.has(next)) return;
        seen.add(next);
        queue.push(next);
      });
    }
    groups.push(group);
  }
  return groups;
}

function contactLength(a, b) {
  const ox = overlapAmount(a.x, a.x + a.w, b.x, b.x + b.w);
  const oy = overlapAmount(a.y, a.y + a.d, b.y, b.y + b.d);
  if (ox >= AISLE_MIN && oy >= AISLE_MIN) return Math.min(ox, oy);
  if (ox >= AISLE_MIN && oy >= -0.02) return ox;
  if (oy >= AISLE_MIN && ox >= -0.02) return oy;
  return 0;
}

function clipDrive(rect, plate) {
  const clipped = clipRect(rect, plate);
  if (!clipped || clipped.w < AISLE_MIN || clipped.d < AISLE_MIN) return null;
  return { ...rect, ...clipped };
}

function clipRect(rect, plate) {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const x2 = Math.min(plate.width, rect.x + rect.w);
  const y2 = Math.min(plate.depth, rect.y + rect.d);
  if (x2 - x < 0.05 || y2 - y < 0.05) return null;
  return { ...rect, x, y, w: x2 - x, d: y2 - y };
}

function centerOf(rect) {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.d / 2 };
}

function overlapAmount(a0, a1, b0, b1) {
  return Math.min(a1, b1) - Math.max(a0, b0);
}

function overlapArea(a, b) {
  if (!a || !b) return 0;
  const ox = overlapAmount(a.x, a.x + a.w, b.x, b.x + b.w);
  const oy = overlapAmount(a.y, a.y + a.d, b.y, b.y + b.d);
  if (ox <= 0 || oy <= 0) return 0;
  return ox * oy;
}

// 두 사각형이 실제로 겹치는지 (면적이 있는 겹침)
function rectsOverlap(a, b) {
  return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-4 &&
    Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y) > 1e-4;
}

// 겹치거나 최소 이격보다 가까우면 true.
// (수정 2026-11-10) rectGap은 겹쳐도 0을 돌려줘서, 최소 이격 0일 때 완전히 겹친 기둥도 통과됐다.
function tooClose(a, b, minClear) {
  // rectsOverlap || rectGap < minClear 를 한 번에(자주 불려서 속도용)
  const dx = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
  const dy = Math.max(a.y, b.y) - Math.min(a.y + a.d, b.y + b.d);
  if (dx < -1e-4 && dy < -1e-4) return true;
  const lim = (minClear || 0) - 1e-4;
  if (lim <= 0) return false;
  const gx = dx > 0 ? dx : 0;
  const gy = dy > 0 ? dy : 0;
  if (gx >= lim || gy >= lim) return false;
  return gx * gx + gy * gy < lim * lim;
}

function rectGap(a, b) {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.d, b.y + b.d));
  return Math.hypot(dx, dy);
}

function edgeLabel(edge) {
  if (edge === "s") return "남";
  if (edge === "n") return "북";
  if (edge === "w") return "서";
  return "동";
}

/** 간격 목록으로 기둥 줄을 만든다. 목록을 다 쓰면 마지막 값을 반복. 목록이 없으면 gridLines(). */
function gridLinesFrom(length, spans, spacing) {
  const list = (spans || []).map(Number).filter((value) => value > 0);
  if (!list.length) return gridLines(length, spacing);
  const lines = [0];
  let cursor = 0;
  for (let index = 0; ; index += 1) {
    cursor += list[Math.min(index, list.length - 1)];
    if (cursor >= length - 0.2) break;
    lines.push(round3(cursor));
  }
  return closeGrid(lines, length);
}

// 마지막 기둥 줄: 남는 길이가 2.5m(주차 한 칸)보다 짧으면 기둥 줄을 하나 더 세우지 않고 마지막 칸을 늘린다.
// 예) 41m를 8.1m로: 0 … 32.4, 40.5, 41(0.5m 간격 기둥 두 줄) → 0 … 32.4, 41(마지막 8.6m).
const MIN_LAST_SPAN = 2.5;
function closeGrid(lines, length) {
  const rest = length - lines[lines.length - 1];
  if (rest <= 0.2) return lines;
  if (rest < MIN_LAST_SPAN && lines.length > 1) lines[lines.length - 1] = round3(length);
  else lines.push(round3(length));
  return lines;
}

/** 주차칸 앞(차로 쪽) 0.5m 띠가 이 차로와 겹치면, 이 차로로 드나드는 칸이다. */
function servedBy(stall, aisle) {
  const strip = stall.aisle === "n" ? { x: stall.x, y: stall.y + stall.d, w: stall.w, d: 0.5 }
    : stall.aisle === "s" ? { x: stall.x, y: stall.y - 0.5, w: stall.w, d: 0.5 }
      : stall.aisle === "e" ? { x: stall.x + stall.w, y: stall.y, w: 0.5, d: stall.d }
        : { x: stall.x - 0.5, y: stall.y, w: 0.5, d: stall.d };
  return overlapArea(strip, aisle) > 0.2;
}

// 한 열 방향 맞추기: 빈자리 채우기 묶음이 위·아래(또는 좌·우)로 이어진 이웃 묶음과 열·입구 방향이 다르면
// 이웃과 같은 열·방향으로 다시 놓아 본다. 칸 수가 같거나 많고, 겹치지 않고, 앞이 차로일 때만 바꾼다.
// 예) 세로 열에서 [동쪽 보는 2칸] [서쪽 보는 3칸] [동쪽 보는 2칸] → 가운데도 동쪽 보는 3칸.
function harmonizeFill(added, regular, obstacles, aisles, plate) {
  let list = added.slice();
  const keyOf = (st) => `${st.bay}|${st.bayFrom}`;
  for (let pass = 0; pass < 2; pass += 1) {
    const groups = new Map();
    list.forEach((st) => { const k = keyOf(st); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(st); });
    let changed = false;
    for (const group of groups.values()) {
      const g0 = group[0];
      const vertical = g0.along === "y";
      const runStart = Math.min(...group.map((st) => (vertical ? st.y : st.x)));
      const runEnd = Math.max(...group.map((st) => (vertical ? st.y + st.d : st.x + st.w)));
      const cross = (st) => (vertical ? st.x : st.y);
      // 이웃 묶음: 같은 길이 방향, 길이 방향으로 1m 안에 붙어 있고, 열이나 입구 방향이 다른 것
      const mates = list.concat(regular).filter((st) => !group.includes(st) && st.along === g0.along
        && (Math.abs(cross(st) - cross(g0)) > 0.05 || st.aisle !== g0.aisle)
        && Math.abs(cross(st) - cross(g0)) < 6
        && ((vertical ? st.y + st.d : st.x + st.w) >= runStart - 1 && (vertical ? st.y : st.x) <= runEnd + 1)
        && ((vertical ? st.y + st.d : st.x + st.w) <= runStart + 0.05 || (vertical ? st.y : st.x) >= runEnd - 0.05));
      if (!mates.length) continue;
      // 위·아래 이웃이 모두 같은 열·방향이면 그쪽으로(한쪽만 있어도 시도)
      const target = mates[0];
      const sameTargets = mates.filter((st) => Math.abs(cross(st) - cross(target)) < 0.05 && st.aisle === target.aisle);
      if (sameTargets.length !== mates.length) continue;
      const others = list.filter((st) => !group.includes(st)).concat(regular);
      const sorted = group.slice().sort((p, q) => (vertical ? p.y - q.y : p.x - q.x));
      const moved = sorted.map((st) => (vertical
        ? { ...st, x: target.x, w: target.w, aisle: target.aisle }
        : { ...st, y: target.y, d: target.d, aisle: target.aisle }));
      const ok = moved.every((st) => st.x >= -1e-6 && st.y >= -1e-6 && st.x + st.w <= plate.width + 1e-6 && st.y + st.d <= plate.depth + 1e-6
        && !obstacles.some((o) => overlapArea(st, o) > 0.03)
        && !others.some((o) => overlapArea(st, o) > 0.03)
        && frontIsAisle(st, aisles));
      if (!ok) continue;
      list = others.filter((st) => !regular.includes(st)).concat(moved);
      changed = true;
    }
    if (!changed) break;
  }
  return list;
}

function alignLoneStalls(stalls, aisles, blocks, columns, plate) {
  const out = aisles.slice();
  const aisleSet = new Set(aisles);
  const solid = blocks.filter((b) => !aisleSet.has(b) && !b.role);
  const isFree = (rect, ignore, forAisle) => rect.x >= -1e-6 && rect.y >= -1e-6
    && rect.x + rect.w <= plate.width + 1e-6 && rect.y + rect.d <= plate.depth + 1e-6
    && !(forAisle ? solid : blocks.concat(out)).some((b) => overlapArea(rect, b) > 0.03)
    && !columns.some((c) => tooClose(rect, c, plate.minClear))
    && !stalls.some((o) => o !== ignore && overlapArea(rect, o) > 0.03);
  stalls.forEach((stall, index) => {
    if (stall.phase !== "fill") return;
    const vertical = stall.aisle === "e" || stall.aisle === "w";   // 세로로 쌓이는 줄(가로로 긴 칸)
    const key = (o) => (vertical ? o.x : o.y);
    const run = (o) => (vertical ? [o.y, o.y + o.d] : [o.x, o.x + o.w]);
    const [r0, r1] = run(stall);
    // 같은 방향·같은 입구 쪽 칸 중 길이 방향으로 6m 안에 있고, 열이 0.3~6m 어긋난 칸
    const mates = stalls.filter((o) => o !== stall && o.aisle === stall.aisle
      && Math.abs(key(o) - key(stall)) > 0.3 && Math.abs(key(o) - key(stall)) < 8
      && run(o)[0] < r1 + 6 && run(o)[1] > r0 - 6);
    // 혼자인 칸만: 같은 열에 붙은 칸이 없어야 한다
    const neighbors = stalls.filter((o) => o !== stall && o.aisle === stall.aisle && Math.abs(key(o) - key(stall)) < 0.05
      && run(o)[0] < r1 + 0.5 && run(o)[1] > r0 - 0.5);
    if (!mates.length || neighbors.length) return;
    mates.sort((p, q) => Math.abs(key(p) - key(stall)) - Math.abs(key(q) - key(stall)));
    const target = key(mates[0]);
    const moved = vertical ? { ...stall, x: round3(target) } : { ...stall, y: round3(target) };
    if (!isFree(moved, stall)) return;
    if (!stallReachable(moved, out)) {
      const depth = AISLE;
      const front = moved.aisle === "w" ? { x: moved.x - depth, y: moved.y, w: depth, d: moved.d }
        : moved.aisle === "e" ? { x: moved.x + moved.w, y: moved.y, w: depth, d: moved.d }
          : moved.aisle === "s" ? { x: moved.x, y: moved.y - depth, w: moved.w, d: depth }
            : { x: moved.x, y: moved.y + moved.d, w: moved.w, d: depth };
      // 칸 길이 방향으로 0.3m씩 늘려 옆 차로와 실제로 겹치게(그래야 차로가 이어진 것으로 본다)
      const ext = 0.3;
      const patch = vertical
        ? { ...front, y: Math.max(0, front.y - ext), d: Math.min(plate.depth, front.y + front.d + ext) - Math.max(0, front.y - ext), role: "approach" }
        : { ...front, x: Math.max(0, front.x - ext), w: Math.min(plate.width, front.x + front.w + ext) - Math.max(0, front.x - ext), role: "approach" };
      // 차로 그래프에서 이어진 것으로 보려면 맞닿는 길이가 차로 최소 폭 이상이어야 한다.
      // 옆 차로를 그대로 연장하는 경우만: 차로 폭 방향 범위가 그 차로 안에 들어가고, 길이 방향으로 맞닿아야 한다.
      const extendsAisle = (a) => (vertical
        ? a.x <= patch.x + 0.2 && a.x + a.w >= patch.x + patch.w - 0.2 && a.y <= patch.y + patch.d && a.y + a.d >= patch.y
        : a.y <= patch.y + 0.2 && a.y + a.d >= patch.y + patch.d - 0.2 && a.x <= patch.x + patch.w && a.x + a.w >= patch.x);
      const host = out.find(extendsAisle);
      if (!isFree(patch, stall, true) || !host) return;
      // 따로 짧은 차로를 붙이지 않고, 그 차로를 길이 방향으로 늘린다(차로 폭 검사에서 짧은 조각이 좁은 차로로 잡히지 않게).
      const grown = vertical
        ? { ...host, y: Math.min(host.y, patch.y), d: Math.max(host.y + host.d, patch.y + patch.d) - Math.min(host.y, patch.y) }
        : { ...host, x: Math.min(host.x, patch.x), w: Math.max(host.x + host.w, patch.x + patch.w) - Math.min(host.x, patch.x) };
      const trial = out.map((a) => (a === host ? grown : a));
      if (stalls.some((o) => o !== stall && overlapArea(o, grown) > 0.03)) return;
      if (stalls.some((o) => o !== stall && stallReachable(o, out) && !stallReachable(o, trial))) return;
      if (!stallReachable(moved, trial)) return;
      out.splice(out.indexOf(host), 1, grown);
    }
    stalls[index] = moved;
  });
  return out;
}

// 칸 앞(입구 쪽) 폭의 대부분(가운데 70%)이 차로에 닿아야 차가 들어갈 수 있다.
// 차로 모서리에 살짝 걸친 칸(앞이 다른 주차칸·빈 곳)은 진입 불가로 본다.
function stallReachable(stall, aisles) {
  const horizontal = stall.aisle === "n" || stall.aisle === "s";
  const len = horizontal ? stall.w : stall.d;
  const base = horizontal ? stall.x : stall.y;
  const depthAt = stall.aisle === "n" ? stall.y + stall.d + 0.25
    : stall.aisle === "s" ? stall.y - 0.25
      : stall.aisle === "e" ? stall.x + stall.w + 0.25
        : stall.x - 0.25;
  for (let k = 0; k < 5; k += 1) {
    const along = base + len * (0.15 + 0.7 * (k / 4));
    const px = horizontal ? along : depthAt;
    const py = horizontal ? depthAt : along;
    if (!aisles.some((a) => px >= a.x - 1e-6 && px <= a.x + a.w + 1e-6 && py >= a.y - 1e-6 && py <= a.y + a.d + 1e-6)) return false;
  }
  return true;
}

function gridLines(length, spacing) {
  const lines = [0];
  if (!(spacing > 0)) return [0, round3(length)];
  for (let cursor = spacing; cursor < length - 0.2; cursor += spacing) lines.push(round3(cursor));
  return closeGrid(lines, length);
}

function subtractRect(rect, block) {
  if (overlapArea(rect, block) <= 0) return [rect];
  const x1 = Math.max(rect.x, block.x);
  const x2 = Math.min(rect.x + rect.w, block.x + block.w);
  const y1 = Math.max(rect.y, block.y);
  const y2 = Math.min(rect.y + rect.d, block.y + block.d);
  const parts = [];
  if (y1 - rect.y > 0.05) parts.push({ x: rect.x, y: rect.y, w: rect.w, d: y1 - rect.y });
  if (rect.y + rect.d - y2 > 0.05) parts.push({ x: rect.x, y: y2, w: rect.w, d: rect.y + rect.d - y2 });
  if (x1 - rect.x > 0.05) parts.push({ x: rect.x, y: y1, w: x1 - rect.x, d: y2 - y1 });
  if (rect.x + rect.w - x2 > 0.05) parts.push({ x: x2, y: y1, w: rect.x + rect.w - x2, d: y2 - y1 });
  return parts;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}


// ── 외곽 기둥을 대지(지하 외벽선) 안에 넣기 (2026-11-11) ──
// 배치는 외곽에서 기둥 두께(c)만큼 들인 안쪽 판(inner)에서 짜고, 결과를 c만큼 옮긴다.
// 벽 쪽 줄의 기둥은 줄 뒤(벽 쪽)에 붙으므로 그 c 띠 안, 즉 대지 안에 들어간다.
export function edgeGap(plate) {
  if (!plate || plate.inner) return 0;
  const w = plate.columnWidth || COLUMN;
  return Math.max(w, plate.columnDepth || w);
}

function innerPlateOf(plate, c) {
  const shift = (v) => (Array.isArray(v) ? v : v);
  return { ...plate, inner: true, width: round3(plate.width - 2 * c), depth: round3(plate.depth - 2 * c), spansX: shift(plate.spansX), spansY: shift(plate.spansY) };
}

function withGap(ramp, plate, raw) {
  const c = edgeGap(plate);
  if (!c || !ramp) return raw(ramp, plate);
  const inner = innerPlateOf(plate, c);
  const external = (ramp.placement || "internal") === "external";
  const res = raw({ ...ramp, t: ramp.t - c }, inner);
  // 외부형 램프는 바깥에 붙으므로 변 방향으로만 옮기고, 수직 방향은 진짜 외벽에 붙인다.
  if (!external) return shiftDeep(res, c, c);
  const vertical = ramp.edge === "n" || ramp.edge === "s";
  const dx = vertical ? c : (ramp.edge === "e" ? 2 * c : 0);
  const dy = vertical ? (ramp.edge === "n" ? 2 * c : 0) : c;
  return shiftDeep(res, dx, dy);
}

const SHIFT_X = new Set(["x", "x1", "x2"]);
const SHIFT_Y = new Set(["y", "y1", "y2"]);
function shiftDeep(v, dx, dy, along) {
  if (Array.isArray(v)) return v.map((item) => shiftDeep(item, dx, dy));
  if (!v || typeof v !== "object") return v;
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === "number" && SHIFT_X.has(k)) out[k] = round3(val + dx);
    else if (typeof val === "number" && SHIFT_Y.has(k)) out[k] = round3(val + dy);
    else if (typeof val === "number" && (k === "bayFrom" || k === "bayTo")) out[k] = round3(val + (v.along === "y" ? dy : dx));
    else if (val && typeof val === "object") out[k] = shiftDeep(val, dx, dy);
    else out[k] = val;
  }
  return out;
}

// 외곽 다각형이 있으면 바깥 부분을 못 쓰는 곳(blockRects)으로. c = 외벽 여유 띠(그만큼 안쪽으로 더 막음)
function withOutlineBlocks(plate, raw, c) {
  if (!raw.outline || outlineProblem(raw.outline)) return plate;
  const voids = outlineVoids(raw.outline, raw.width, raw.depth)
    .map((r) => growRect(r, c, raw.width, raw.depth))
    .map((r) => ({ ...r, x: round3(r.x - c), y: round3(r.y - c) }))
    .map((r) => clipRect(r, plate))
    .filter((r) => r && r.w > 0.05 && r.d > 0.05)
    .map((r) => ({ ...r, void: true }));
  return { ...plate, blockRects: (plate.blockRects || []).concat(voids), voids };
}

function layoutWithGap(input) {
  const raw = input.plate || input;
  const c = edgeGap(raw);
  if (!c) return layoutParkingInner(raw.outline ? { ...input, plate: withOutlineBlocks(raw, raw, 0) } : input);
  const plate = withOutlineBlocks(innerPlateOf(raw, c), raw, c);
  const alongOf = (edge) => (edge === "n" || edge === "s" ? plate.width : plate.depth);
  const inEdge = (item) => (item && item.edge ? { ...item, t: round3(clamp(item.t - c, (item.width || 0) / 2, alongOf(item.edge) - (item.width || 0) / 2)) } : item);
  const inner = {
    ...input,
    plate,
    cores: (input.cores || []).map((core) => ({ ...core, x: round3(core.x - c), y: round3(core.y - c) })),
    ramps: input.ramps ? input.ramps.map(inEdge) : input.ramps,
    openings: input.openings ? input.openings.map(inEdge) : input.openings,
  };
  const res = layoutParkingInner(inner);
  const keep = new Set(["plate", "spec", "metrics", "bay", "ramps", "openings", "gridX", "gridY"]);
  const out = {};
  for (const [k, val] of Object.entries(res)) out[k] = keep.has(k) ? val : shiftDeep(val, c, c);
  out.gridX = (res.gridX || []).map((v) => round3(v + c));
  out.gridY = (res.gridY || []).map((v) => round3(v + c));
  const outEdge = (item) => (item && item.edge ? { ...item, t: round3(item.t + c) } : item);
  out.ramps = (res.ramps || []).map(outEdge);
  out.openings = (res.openings || []).map(outEdge);
  out.plate = { ...res.plate, inner: false, width: raw.width, depth: raw.depth, edgeGap: c, outline: raw.outline || null, voids: (plate.voids || []).map((r) => ({ ...r, x: round3(r.x + c), y: round3(r.y + c) })) };
  // ㎡/대·차로비는 진짜 평면 넓이 기준으로(외곽 다각형이면 그 넓이)
  const realArea = raw.outline && !outlineProblem(raw.outline) ? polygonArea(raw.outline) : raw.width * raw.depth;
  const f = realArea / (plate.width * plate.depth);
  if (res.metrics) out.metrics = { ...res.metrics, areaPerStall: round2m(res.metrics.areaPerStall * f), aisleRatio: round3(res.metrics.aisleRatio / f) };
  // 출입구(외부형 램프·지상 입구)에서 바깥 벽까지 c 띠를 차로로 잇는다.
  out.aisles = out.aisles.map((a) => extendToWall(a, out.openings, raw, c));
  // 출입구 앞에서 벽까지 이은 차로와 겹치는 외곽 띠 기둥은 뺀다(출입 통로를 막지 않게).
  out.columns = (out.columns || []).filter((col) => !out.aisles.some((a) => overlapArea(col, a) > 0.01));
  // 외곽 다각형 바깥에 선 기둥은 뺀다(꺾인 벽 위 기둥은 남김)
  if (raw.outline && !outlineProblem(raw.outline)) {
    out.columns = out.columns.filter((col) => {
      const cx = col.x + col.w / 2;
      const cy = col.y + col.d / 2;
      return insidePolygon(raw.outline, cx, cy) || [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]].some(([dx, dy]) => insidePolygon(raw.outline, cx + dx, cy + dy));
    });
  }
  return out;
}

function extendToWall(a, openings, plate, c) {
  let r = { ...a };
  for (const o of openings || []) {
    const lo = o.t - o.width / 2;
    const hi = o.t + o.width / 2;
    if (o.edge === "w" && Math.abs(r.x - c) < 0.05 && r.y < hi && r.y + r.d > lo) r = { ...r, x: 0, w: r.w + c };
    if (o.edge === "s" && Math.abs(r.y - c) < 0.05 && r.x < hi && r.x + r.w > lo) r = { ...r, y: 0, d: r.d + c };
    if (o.edge === "e" && Math.abs(r.x + r.w - (plate.width - c)) < 0.05 && r.y < hi && r.y + r.d > lo) r = { ...r, w: r.w + c };
    if (o.edge === "n" && Math.abs(r.y + r.d - (plate.depth - c)) < 0.05 && r.x < hi && r.x + r.w > lo) r = { ...r, d: r.d + c };
  }
  return r;
}

function round2m(v) { return typeof v === "number" ? Math.round(v * 100) / 100 : v; }

// 친환경차 구역 기준점: 내부형 램프는 아래층 도착 끝, 외부형·입구는 외벽 개구부.
function ecoAnchorOf(ramp, plate) {
  if (!ramp) return null;
  if ((ramp.placement || "internal") === "internal") {
    const shape = rampShape(ramp, plate);
    if (shape.path && shape.path.length) { const p = shape.path[shape.path.length - 1]; return { x: p.x, y: p.y }; }
    const b = rampFootprint(ramp, plate);
    return { x: b.x + b.w / 2, y: b.y + b.d / 2 };
  }
  return edgePoint(ramp.edge, ramp.t, plate);
}

// ── 자투리 평행주차 (주차장법 시행규칙 제3조①1: 평행주차형식 일반형 2.0×6.0m 이상) ──
// 차로 긴 변 바깥 2.0m 띠가 비어 있으면 6.0m마다 한 칸. 차로(직각 6m)는 평행주차 기준(3.3/5.0m)보다 넓어 그대로 쓴다.
export const PARALLEL_W = 2.0;
export const PARALLEL_L = 6.0;
// 평행 칸을 같은 줄의 직각 칸과 선을 맞춘다: 차로 방향으로 이웃한 직각 칸(4m 안)이 있으면
// 차로에 수직인 폭·위치를 그 칸과 같게(예: 확장형 2.6m 줄이면 2.6m 폭으로). 다른 것과 겹치거나 차로에서 0.6m 넘게 떨어지면 그대로.
function alignParallel(extra, stalls, blocks, plate) {
  return extra.map((p) => {
    const vertical = p.along === "y";   // 긴 변이 세로(차로가 동·서쪽)
    const lo = (r) => (vertical ? r.x : r.y);
    const size = (r) => (vertical ? r.w : r.d);
    const alo = (r) => (vertical ? r.y : r.x);
    const asize = (r) => (vertical ? r.d : r.w);
    let best = null;
    stalls.forEach((st) => {
      if (st.type === "parallel") return;
      const ov = Math.min(lo(p) + size(p), lo(st) + size(st)) - Math.max(lo(p), lo(st));
      if (ov < 0.5) return;
      const gap = Math.max(alo(st) - (alo(p) + asize(p)), alo(p) - (alo(st) + asize(st)));
      if (gap > 4 || gap < -0.01) return;
      if (!best || ov > best.ov) best = { st, ov };
    });
    if (!best) return p;
    const nlo = lo(best.st);
    const nsize = size(best.st);
    const rect = vertical ? { ...p, x: nlo, w: nsize } : { ...p, y: nlo, d: nsize };
    // 차로 쪽 변과의 거리(원래 평행 칸은 차로에 붙어 있음)
    const aisleSide = p.aisle;   // 칸에서 본 차로 방향
    const edge = { e: p.x + p.w, w: p.x, n: p.y + p.d, s: p.y }[aisleSide];
    const nedge = { e: rect.x + rect.w, w: rect.x, n: rect.y + rect.d, s: rect.y }[aisleSide];
    const away = aisleSide === "e" || aisleSide === "n" ? edge - nedge : nedge - edge;
    if (away < -0.01 || away > 0.6) return p;
    if (rect.x < -0.01 || rect.y < -0.01 || rect.x + rect.w > plate.width + 0.01 || rect.y + rect.d > plate.depth + 0.01) return p;
    if (blocks.some((b) => b !== p && overlapArea(rect, b) > 0.001)) return p;
    if (extra.some((q) => q !== p && overlapArea(rect, q) > 0.001)) return p;
    return rect;
  });
}

// 평행 칸 줄 맞추기(2026-11-21): 같은 쪽을 보는 평행 칸끼리 줄(차로에서 떨어진 위치)이 1.5m 안으로 어긋나 있으면
// 차로에서 더 먼 쪽 선에 맞춘다(옮길 자리가 비어 있을 때만). 칸이 차로에서 떨어진 만큼은 그 앞 차로를 넓혀
// 차로 가장자리가 삐뚤빼뚤하지 않게 한다.
function alignParallelRows(extra, blocks, plate, aisles) {
  const out = extra.slice();
  const added = [];
  const vertical = (p) => p.along === "y";
  const cross = (p) => (vertical(p) ? p.x : p.y);
  const alo = (p) => (vertical(p) ? p.y : p.x);
  const ahi = (p) => (vertical(p) ? p.y + p.d : p.x + p.w);
  // 차로에서 먼 쪽이 큰 값인지: 차로가 칸의 s(아래)·w(왼쪽)에 있으면 위·오른쪽이 먼 쪽
  const farUp = (p) => p.aisle === "s" || p.aisle === "w";
  const others = blocks.filter((b) => !aisles.includes(b));
  for (let pass = 0; pass < 3; pass += 1) {
    let moved = false;
    out.forEach((p, i) => {
      const mates = out.filter((q, k) => k !== i && q.along === p.along && q.aisle === p.aisle
        && Math.abs(cross(q) - cross(p)) > 0.05 && Math.abs(cross(q) - cross(p)) <= 1.5
        && Math.max(alo(q) - ahi(p), alo(p) - ahi(q)) <= 6);
      if (!mates.length) return;
      const target = farUp(p) ? Math.max(...mates.map(cross)) : Math.min(...mates.map(cross));
      const delta = target - cross(p);
      if (farUp(p) ? delta <= 0.05 : delta >= -0.05) return;   // 이미 먼 쪽 선
      const rect = vertical(p) ? { ...p, x: round3(target) } : { ...p, y: round3(target) };
      if (rect.x < -0.01 || rect.y < -0.01 || rect.x + rect.w > plate.width + 0.01 || rect.y + rect.d > plate.depth + 0.01) return;
      if (others.some((b) => b !== p && overlapArea(rect, b) > 0.001)) return;
      if (out.some((q, k) => k !== i && overlapArea(rect, q) > 0.001)) return;
      // 칸과 차로 사이 빈 띠 → 차로로(칸 앞 차로 조각 길이만큼, 막히면 칸 길이만큼)
      const gapOf = (lo, hi) => {
        const g = Math.abs(delta);
        if (vertical(p)) {
          const x = p.aisle === "w" ? p.x : rect.x + rect.w;
          return { x: round3(x), y: lo, w: round3(g), d: hi - lo, role: "trim", phase: "loop", portals: [] };
        }
        const y = p.aisle === "s" ? p.y : rect.y + rect.d;
        return { x: lo, y: round3(y), w: hi - lo, d: round3(g), role: "trim", phase: "loop", portals: [] };
      };
      const front = aisles.find((a) => overlapArea(gapOf(alo(p), ahi(p)), a) > 0.001
        || rectGap(a, vertical(p) ? { x: p.aisle === "w" ? p.x - 0.05 : p.x + p.w, y: p.y, w: 0.05, d: p.d } : { x: p.x, y: p.aisle === "s" ? p.y - 0.05 : p.y + p.d, w: p.w, d: 0.05 }) < 0.02);
      const free = (g) => !others.some((b) => overlapArea(g, b) > 0.001) && !out.some((q, k) => k !== i && overlapArea(g, q) > 0.001);
      let gap = front ? gapOf(Math.max(vertical(p) ? front.y : front.x, alo(p) - 6), Math.min(vertical(p) ? front.y + front.d : front.x + front.w, ahi(p) + 6)) : null;
      if (!gap || !free(gap)) gap = gapOf(alo(p), ahi(p));
      if (!free(gap)) return;
      out[i] = rect;
      added.push(gap);
      moved = true;
    });
    if (!moved) break;
  }
  return { stalls: out, aisles: added };
}

// 칸 줄 앞선 맞추기(2026-11-24). 같은 쪽 차로를 보는 직각 칸이 길이 방향으로 1m 안에 이웃해 있고 앞선이 0.05~0.6m 어긋나면
// 묶어서 차로에서 가장 먼 앞선에 맞춘다(튀어나온 칸을 뒤로 물림). 옮길 자리가 막혀 있으면 그 칸은 그대로. 옮긴 칸 목록을 돌려준다.
function alignStallRows(stalls, aisles, cores, solids, plate) {
  const perp = stalls.filter((st) => st.type !== "parallel" && st.aisle);
  const frontOf = (st) => (st.aisle === "n" ? st.y + st.d : st.aisle === "s" ? st.y : st.aisle === "e" ? st.x + st.w : st.x);
  const along = (st) => (st.aisle === "n" || st.aisle === "s" ? [st.x, st.x + st.w] : [st.y, st.y + st.d]);
  const away = (st) => (st.aisle === "n" || st.aisle === "e" ? -1 : 1);   // 차로에서 멀어지는 방향(앞선 좌표 기준)
  // 이웃 관계로 묶기
  const parent = perp.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  perp.forEach((p, i) => perp.forEach((q, j) => {
    if (j <= i || p.aisle !== q.aisle) return;
    const [a0, a1] = along(p);
    const [b0, b1] = along(q);
    const gap = Math.max(b0 - a1, a0 - b1);
    if (gap > 1.0) return;
    if (Math.abs(frontOf(p) - frontOf(q)) > 0.6) return;
    parent[find(i)] = find(j);
  }));
  const groups = new Map();
  perp.forEach((st, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(st); });
  const moved = [];
  groups.forEach((row) => {
    if (row.length < 2) return;
    const fronts = row.map(frontOf);
    const target = away(row[0]) > 0 ? Math.max(...fronts) : Math.min(...fronts);
    row.forEach((st) => {
      const shift = target - frontOf(st);
      if (Math.abs(shift) < 0.05) return;
      const vertical = st.aisle === "n" || st.aisle === "s";
      const r = { ...st, x: round3(st.x + (vertical ? 0 : shift)), y: round3(st.y + (vertical ? shift : 0)) };
      if (r.x < -0.01 || r.y < -0.01 || r.x + r.w > plate.width + 0.01 || r.y + r.d > plate.depth + 0.01) return;
      if (stalls.some((q) => q !== st && overlapArea(r, q) > 0.001)) return;
      if (solids.concat(cores, aisles).some((b) => overlapArea(r, b) > 0.001)) return;
      st.x = r.x;
      st.y = r.y;
      moved.push(st);
    });
  });
  return moved;
}

function straightenAisleEdges(aisles, stalls, cores, solids, plate) {
  let current = aisles.slice();
  const groups = componentGroups(current).length;
  const edgeOf = (r, side) => (side === "s" ? r.y : side === "n" ? r.y + r.d : side === "w" ? r.x : r.x + r.w);
  const spanOf = (r, side) => (side === "s" || side === "n" ? [r.x, r.x + r.w] : [r.y, r.y + r.d]);
  const out = (side) => (side === "s" || side === "w" ? -1 : 1);   // 바깥쪽 방향
  const opposite = { s: "n", n: "s", w: "e", e: "w" };
  const inPlate = (r) => r.x >= -0.01 && r.y >= -0.01 && r.x + r.w <= plate.width + 0.01 && r.y + r.d <= plate.depth + 0.01;
  const covered = (r) => current.some((b) => overlapArea(r, b) >= r.w * r.d - 0.001);
  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    const snapshot = current.slice();
    snapshot.forEach((a) => {
      if (a.role === "trim") return;
      const sides = a.w >= a.d ? ["s", "n"] : ["w", "e"];
      sides.forEach((side) => {
        const e = edgeOf(a, side);
        const [lo, hi] = spanOf(a, side);
        // 기준선: 바깥 0.05~0.6m 안의 이웃 차로 같은 쪽 가장자리, 또는 코어의 마주 보는 면. 그 기준이 있는 구간만 채운다.
        const sources = [];
        snapshot.forEach((b) => { if (b !== a) sources.push({ v: edgeOf(b, side), span: spanOf(b, side), from: "aisle" }); });
        cores.forEach((c) => sources.push({ v: edgeOf(c, opposite[side]), span: spanOf(c, side), from: "core" }));
        // 이 차로를 보는 칸의 앞선(칸 줄을 맞춘 뒤 차로와 사이가 뜬 경우)
        stalls.forEach((st) => { if (st.type !== "parallel" && st.aisle === opposite[side]) sources.push({ v: edgeOf(st, opposite[side]), span: spanOf(st, side), from: "stall" }); });
        // 기준선이 정해지면 이 차로의 나머지 구간(기둥·코어·램프로 끊긴 구간마다)도 같은 선까지 맞춰 본다 → 한 줄로
        const lineVals = [...new Set(sources.map((src) => round3(src.v)).filter((v) => { const d = (v - e) * out(side); return d > 0.05 && d <= 0.6; }))];
        lineVals.forEach((v) => {
          const gap = Math.abs(v - e);
          const band = side === "s" ? { x: lo, y: v, w: hi - lo, d: gap } : side === "n" ? { x: lo, y: e, w: hi - lo, d: gap }
            : side === "w" ? { x: v, y: lo, w: gap, d: hi - lo } : { x: e, y: lo, w: gap, d: hi - lo };
          const cuts = solids.concat(cores).filter((b) => overlapArea(band, b) > 0.001).map((b) => spanOf(b, side)).sort((p, q) => p[0] - q[0]);
          let at = lo;
          cuts.concat([[hi, hi]]).forEach(([c0, c1]) => {
            if (c0 - at >= 0.3) sources.push({ v, span: [at, Math.min(c0, hi)], from: "line" });
            at = Math.max(at, c1);
          });
        });
        sources.forEach((src) => {
          const d = (src.v - e) * out(side);
          if (d <= 0.05 || d > 0.6) return;
          const s0 = Math.max(lo, src.span[0]);
          const s1 = Math.min(hi, src.span[1]);
          if (s1 - s0 < 0.3) return;
          const gap = Math.abs(src.v - e);
          const strip = side === "s" ? { x: s0, y: src.v, w: s1 - s0, d: gap }
            : side === "n" ? { x: s0, y: e, w: s1 - s0, d: gap }
            : side === "w" ? { x: src.v, y: s0, w: gap, d: s1 - s0 }
            : { x: e, y: s0, w: gap, d: s1 - s0 };
          const r0 = { ...strip, x: round3(strip.x), y: round3(strip.y), w: round3(strip.w), d: round3(strip.d) };
          if (!inPlate(r0) || covered(r0)) return;
          if (solids.concat(cores).some((b) => overlapArea(r0, b) > 0.001)) return;
          // 띠에 걸린 칸은 바깥으로 밀어 본다
          const hit = stalls.filter((st) => overlapArea(r0, st) > 0.001);
          const moved = new Map();
          for (const st of hit) {
            const push = side === "s" ? st.y + st.d - r0.y : side === "n" ? r0.y + r0.d - st.y : side === "w" ? st.x + st.w - r0.x : r0.x + r0.w - st.x;
            const r = { ...st, x: round3(st.x + (side === "w" ? -push : side === "e" ? push : 0)), y: round3(st.y + (side === "s" ? -push : side === "n" ? push : 0)) };
            if (!inPlate(r)) return;
            if (stalls.some((q) => q !== st && !hit.includes(q) && overlapArea(r, q) > 0.001)) return;
            if (solids.concat(cores).some((b) => overlapArea(r, b) > 0.001) || current.some((b) => overlapArea(r, b) > 0.001)) return;
            moved.set(st, r);
          }
          const trial = current.concat([{ ...r0, role: "trim", phase: "loop", portals: [] }]);
          const trialStalls = stalls.map((st) => moved.get(st) || st);
          if (componentGroups(trial).length > groups || !trialStalls.every((st) => stallReachable(st, trial))) return;
          moved.forEach((r, st) => Object.assign(st, { x: r.x, y: r.y }));
          current = trial;
          changed = true;
        });
      });
    });
    if (!changed) break;
  }
  return current;
}

function trimCorePockets(aisles, cores, stalls, plate, solids = []) {
  let current = aisles.slice();
  const groupsOf = (list) => componentGroups(list).length;
  const reachOk = (list) => stalls.every((st) => stallReachable(st, list));
  const blocked = (r) => stalls.concat(cores, solids).some((b) => overlapArea(r, b) > 0.01);
  const inPlate = (r) => r.x >= -0.01 && r.y >= -0.01 && r.x + r.w <= plate.width + 0.01 && r.y + r.d <= plate.depth + 0.01;
  const base = groupsOf(current);
  // 코어 면 선(가로선 y·세로선 x) 근처에서 차로 가장자리가 3m 안으로 어긋나 있으면 그 선에 맞춘다.
  // 폭이 6m 넘게 남으면 잘라 내고, 6m짜리 차로면 폭 그대로 선까지 옮긴다.
  for (let pass = 0; pass < 2; pass += 1) {
    let changed = false;
    cores.forEach((c) => {
      const lines = [
        { axis: "y", v: c.y + c.d, lo: c.x - 8, hi: c.x + c.w + 8 },
        { axis: "y", v: c.y, lo: c.x - 8, hi: c.x + c.w + 8 },
        { axis: "x", v: c.x, lo: c.y - 8, hi: c.y + c.d + 8 },
        { axis: "x", v: c.x + c.w, lo: c.y - 8, hi: c.y + c.d + 8 },
      ];
      current.forEach((a, k) => {
        if (a.role === "trim") return;
        lines.forEach((ln) => {
          const y = ln.axis === "y";
          const a0 = y ? a.y : a.x;
          const len = y ? a.d : a.w;
          const s0 = y ? a.x : a.y;
          const s1 = s0 + (y ? a.w : a.d);
          if (s1 < ln.lo || s0 > ln.hi) return;   // 코어 옆(8m 안) 조각만
          // 코어 몸통과 겹치는 방향의 조각은 제외(코어 바로 옆에 붙은 조각만)
          const touches = y ? (a.x + a.w >= c.x - 0.05 && a.x <= c.x + c.w + 0.05) || Math.abs(a.x + a.w - c.x) < 0.05 || Math.abs(a.x - (c.x + c.w)) < 0.05
            : (a.y + a.d >= c.y - 0.05 && a.y <= c.y + c.d + 0.05);
          if (!touches) return;
          let next = null;
          const lowIn = a0 < ln.v - 0.05 && a0 > ln.v - 3 && a0 + len > ln.v + 0.05;      // 아래(왼)쪽 가장자리가 선 아래로 삐짐
          const highIn = a0 + len > ln.v + 0.05 && a0 + len < ln.v + 3 && a0 < ln.v - 0.05; // 위(오른)쪽 가장자리가 선 위로 삐짐
          if (lowIn) {
            const keep = a0 + len - ln.v;
            next = keep >= AISLE_MIN - 0.01 ? { start: ln.v, size: keep } : { start: ln.v, size: len };
          } else if (highIn) {
            const keep = ln.v - a0;
            next = keep >= AISLE_MIN - 0.01 ? { start: a0, size: keep } : { start: ln.v - len, size: len };
          }
          if (!next) return;
          const r = y ? { ...a, y: round3(next.start), d: round3(next.size) } : { ...a, x: round3(next.start), w: round3(next.size) };
          if (!inPlate(r)) return;
          // 새로 덮는 부분이 칸·코어·기둥·램프와 겹치면 안 됨
          if (blocked(r) && !blocked(a)) return;
          const trial = current.slice();
          trial[k] = r;
          if (groupsOf(trial) > base || !reachOk(trial)) return;
          current = trial;
          a = r;
          changed = true;
        });
      });
    });
    if (!changed) break;
  }
  return current;
}

// 막다른 차로 꼬리 자르기(2026-11-21). 차로 조각 끝 0.5m에 다른 차로가 안 닿으면(막다른 끝) 끝을 0.25m씩 최대 3m 잘라 보고,
// 그 자리 주변 평행 칸을 빼고 직각 칸(확장형 2.6m)·평행 칸을 다시 채워 대수가 늘면 그 안을 쓴다.
// 남은 칸은 모두 앞이 차로여야 하고, 차로가 끊기면 안 된다.
function tailCutFill(aisles, stalls, solids, plate, typesOk = () => true) {
  const groups = componentGroups(aisles).length;
  let best = null;
  aisles.forEach((a, k) => {
    if (a.role === "trim" || (a.portals || []).length) return;
    const alongX = a.w >= a.d;
    [1, -1].forEach((dir) => {
      const endRect = alongX
        ? { x: dir > 0 ? a.x + a.w - 0.5 : a.x, y: a.y, w: 0.5, d: a.d }
        : { x: a.x, y: dir > 0 ? a.y + a.d - 0.5 : a.y, w: a.w, d: 0.5 };
      const face = alongX
        ? { x: dir > 0 ? a.x + a.w : a.x - 0.05, y: a.y, w: 0.05, d: a.d }
        : { x: a.x, y: dir > 0 ? a.y + a.d : a.y - 0.05, w: a.w, d: 0.05 };
      if (aisles.some((o, j) => j !== k && (overlapArea(o, endRect) > 0.01 || overlapArea(o, face) > 0.01 || (rectGap(o, face) < 0.02 && contactLength(o, a) > 0)))) return;
      for (let cutLen = 0.25; cutLen <= 3.001; cutLen += 0.25) {
        const r = alongX
          ? { ...a, x: dir > 0 ? a.x : round3(a.x + cutLen), w: round3(a.w - cutLen) }
          : { ...a, y: dir > 0 ? a.y : round3(a.y + cutLen), d: round3(a.d - cutLen) };
        if (Math.max(r.w, r.d) < AISLE_MIN) break;
        const trialAisles = aisles.slice();
        trialAisles[k] = r;
        if (componentGroups(trialAisles).length > groups) break;
        const freed = alongX
          ? { x: dir > 0 ? r.x + r.w : a.x, y: a.y, w: cutLen, d: a.d }
          : { x: a.x, y: dir > 0 ? r.y + r.d : a.y, w: a.w, d: cutLen };
        // 비운 자리에서 직각 칸 깊이(5.2m) 안에 있는 평행 칸은 빼고 다시 채운다
        const zone = { x: freed.x - STALL_D, y: freed.y - STALL_D, w: freed.w + 2 * STALL_D, d: freed.d + 2 * STALL_D };
        const kept = stalls.filter((st) => !(st.type === "parallel" && overlapArea(st, zone) > 0.01));
        if (!kept.every((st) => stallReachable(st, trialAisles))) break;
        const blocks = kept.concat(solids, trialAisles);
        const reach = { x: zone.x - 8, y: zone.y - 8, w: zone.w + 16, d: zone.d + 16 };
        const nearAisles = trialAisles.filter((q) => overlapArea(q, reach) > 0);
        const perp = parallelStalls(nearAisles, blocks, plate, { d: STALL_D, l: 2.6, type: "extended", phase: "filler", center: false })
          .filter((st) => overlapArea(st, zone) > 0.01 && stallReachable(st, trialAisles));
        // 뺀 평행 칸 중 새 직각 칸과 안 겹치고 여전히 앞이 차로인 칸은 그대로 되살림
        const back = stalls.filter((st) => st.type === "parallel" && !kept.includes(st)
          && !perp.some((q) => overlapArea(q, st) > 0.001) && !trialAisles.some((q) => overlapArea(q, st) > 0.001) && stallReachable(st, trialAisles));
        const blocks2 = blocks.concat(perp, back);
        const par = parallelStalls(nearAisles, blocks2, plate).filter((st) => overlapArea(st, zone) > 0.01 && stallReachable(st, trialAisles));
        const total = kept.length + back.length + perp.length + par.length;
        if (total > stalls.length && (!best || total > best.total)) {
          const list = kept.concat(back, perp, par);
          if (typesOk(list)) best = { total, aisles: trialAisles, stalls: list };
        }
      }
    });
  });
  return best;
}

function parallelStalls(aisles, obstacles, plate, opt = {}) {
  const PW = opt.d || PARALLEL_W;
  const PL = opt.l || PARALLEL_L;
  const out = [];
  const blocks = obstacles.slice();
  const eps = 0.02;
  for (const a of aisles) {
    const alongX = a.w >= a.d;
    const len = alongX ? a.w : a.d;
    if (len < PL - eps || Math.min(a.w, a.d) < AISLE_MIN - 0.05) continue;
    for (const side of alongX ? ["s", "n"] : ["w", "e"]) {
      const strip = side === "s" ? { x: a.x, y: a.y - PW, w: a.w, d: PW }
        : side === "n" ? { x: a.x, y: a.y + a.d, w: a.w, d: PW }
        : side === "w" ? { x: a.x - PW, y: a.y, w: PW, d: a.d }
        : { x: a.x + a.w, y: a.y, w: PW, d: a.d };
      if (strip.x < -eps || strip.y < -eps || strip.x + strip.w > plate.width + eps || strip.y + strip.d > plate.depth + eps) continue;
      const lo = alongX ? strip.x : strip.y;
      const hi = lo + len;
      // 띠 근처 장애물만(멀리 있는 건 결과에 영향 없음 — 계산만 줄임)
      const mc = (plate.minClear || 0) + 0.01;
      const near = blocks.filter((b) => !(b.x > strip.x + strip.w + mc || b.x + b.w < strip.x - mc || b.y > strip.y + strip.d + mc || b.y + b.d < strip.y - mc));
      const cut = near
        .filter((b) => overlapArea(strip, b) > 0.001 || tooClose(strip, b, plate.minClear || 0))
        .map((b) => (alongX ? [b.x - (plate.minClear || 0), b.x + b.w + (plate.minClear || 0)] : [b.y - (plate.minClear || 0), b.y + b.d + (plate.minClear || 0)]))
        .map(([p, q]) => [Math.max(lo, p), Math.min(hi, q)])
        .filter(([p, q]) => q > p)
        .sort((u, v) => u[0] - v[0]);
      let cursor = lo;
      const free = [];
      cut.forEach(([p, q]) => { if (p > cursor) free.push([cursor, p]); cursor = Math.max(cursor, q); });
      if (hi > cursor) free.push([cursor, hi]);
      free.forEach(([p, q]) => {
        const n = Math.floor((q - p + eps) / PL);
        const start = opt.center === false ? p : p + (q - p - n * PL) / 2;   // 남는 길이는 양쪽으로 나눔
        for (let i = 0; i < n; i += 1) {
          const at = round3(start + i * PL);
          const rect = alongX ? { x: at, y: strip.y, w: PL, d: PW } : { x: strip.x, y: at, w: PW, d: PL };
          if (near.some((b) => overlapArea(rect, b) > 0.001)) continue;
          const stall = { ...rect, aisle: { s: "n", n: "s", w: "e", e: "w" }[side], phase: opt.phase || "parallel", type: opt.type || "parallel", along: alongX ? "x" : "y" };
          if (opt.skip && opt.skip(stall)) continue;
          if (opt.type) Object.assign(stall, { bay: `filler:${round3(strip.x)}:${round3(strip.y)}:${round3(p)}`, bayFrom: round3(p), bayTo: round3(q), bayCount: n });
          out.push(stall);
          blocks.push(stall);
          near.push(stall);
        }
      });
    }
  }
  return out;
}

// ── 칸 뒤 빈 띠 없애기 ──
// 예) 램프 도착 바로 옆 [확 확]이 벽에서 1m 떨어져 있으면 벽에 붙인다. 한 차로의 같은 쪽 칸들은 함께 움직이고
// (차로를 사각형으로 유지하려고), 그 차로를 같은 만큼 칸 쪽으로 넓힌다. 넓힌 띠가 다른 칸·기둥·코어·램프와
// 겹치면 하지 않는다. 0.05m 이하 틈이나 2.6m 넘는 틈(다른 줄이 들어갈 자리)은 그대로 둔다.
const BACK = { n: "s", s: "n", e: "w", w: "e" };
function pushStallsBack(stalls, aisles, obstacles, plate) {
  const touches = (stall, aisle) => {
    const span = (a1, a2, b1, b2) => Math.min(a2, b2) - Math.max(a1, b1);
    if (stall.aisle === "s") return Math.abs(stall.y - (aisle.y + aisle.d)) < 0.06 && span(stall.x, stall.x + stall.w, aisle.x, aisle.x + aisle.w) > stall.w * 0.7;
    if (stall.aisle === "n") return Math.abs(stall.y + stall.d - aisle.y) < 0.06 && span(stall.x, stall.x + stall.w, aisle.x, aisle.x + aisle.w) > stall.w * 0.7;
    if (stall.aisle === "w") return Math.abs(stall.x - (aisle.x + aisle.w)) < 0.06 && span(stall.y, stall.y + stall.d, aisle.y, aisle.y + aisle.d) > stall.d * 0.7;
    return Math.abs(stall.x + stall.w - aisle.x) < 0.06 && span(stall.y, stall.y + stall.d, aisle.y, aisle.y + aisle.d) > stall.d * 0.7;
  };
  const shift = (r, dir, g) => ({ ...r, x: r.x + (dir === "e" ? g : dir === "w" ? -g : 0), y: r.y + (dir === "n" ? g : dir === "s" ? -g : 0) });
  // 칸 뒤쪽 빈 거리(벽 또는 다른 것까지)
  const backGap = (stall, others) => {
    const dir = BACK[stall.aisle];
    let gap = dir === "e" ? plate.width - (stall.x + stall.w) : dir === "w" ? stall.x : dir === "n" ? plate.depth - (stall.y + stall.d) : stall.y;
    others.forEach((o) => {
      if (o === stall) return;
      const overlapAcross = dir === "e" || dir === "w"
        ? Math.min(stall.y + stall.d, o.y + o.d) - Math.max(stall.y, o.y)
        : Math.min(stall.x + stall.w, o.x + o.w) - Math.max(stall.x, o.x);
      if (overlapAcross <= 0.01) return;
      const d = dir === "e" ? o.x - (stall.x + stall.w) : dir === "w" ? stall.x - (o.x + o.w) : dir === "n" ? o.y - (stall.y + stall.d) : stall.y - (o.y + o.d);
      if (d > -0.01) gap = Math.min(gap, Math.max(0, d));
    });
    return gap;
  };
  aisles.forEach((aisle, index) => {
    ["n", "s", "e", "w"].forEach((side) => {
      // side: 차로 기준으로 칸이 있는 쪽. 칸의 aisle 방향은 그 반대.
      const group = stalls.filter((stall) => BACK[stall.aisle] === side && touches(stall, aisles[index]));
      if (!group.length) return;
      const others = stalls.filter((stall) => !group.includes(stall)).concat(obstacles, aisles.filter((_, i) => i !== index));
      const g = Math.min(...group.map((stall) => backGap(stall, others)));
      if (!(g > 0.05 && g <= 2.6)) return;
      const host = aisles[index];
      const grown = side === "e" ? { ...host, w: host.w + g } : side === "w" ? { ...host, x: host.x - g, w: host.w + g }
        : side === "n" ? { ...host, d: host.d + g } : { ...host, y: host.y - g, d: host.d + g };
      const strip = side === "e" ? { x: host.x + host.w, y: host.y, w: g, d: host.d } : side === "w" ? { x: host.x - g, y: host.y, w: g, d: host.d }
        : side === "n" ? { x: host.x, y: host.y + host.d, w: host.w, d: g } : { x: host.x, y: host.y - g, w: host.w, d: g };
      const moved = group.map((stall) => shift(stall, side, g));
      const blockers = stalls.filter((stall) => !group.includes(stall)).concat(obstacles);
      if (blockers.some((b) => overlapArea(strip, b) > 0.001)) return;
      if (moved.some((m) => blockers.some((b) => overlapArea(m, b) > 0.001))) return;
      if (strip.x < -0.01 || strip.y < -0.01 || strip.x + strip.w > plate.width + 0.01 || strip.y + strip.d > plate.depth + 0.01) return;
      group.forEach((stall, i) => {
        const m = moved[i];
        stall.x = round3(m.x);
        stall.y = round3(m.y);
      });
      aisles[index] = { ...grown, x: round3(grown.x), y: round3(grown.y), w: round3(grown.w), d: round3(grown.d) };
    });
  });
}

function shrinkRect(r, dx, dy) {
  return { ...r, x: r.x + dx, y: r.y + dy, w: Math.max(0, r.w - 2 * dx), d: Math.max(0, r.d - 2 * dy) };
}


// ── 기둥 격자 먼저 ──
// vertical=true → 세로 기둥선(x 위치들), false → 가로 기둥선(y 위치들).
// 외벽(0, 끝)에서 시작해 다음 선까지 간격 ≤ 12m. 선이 같은 방향으로 길게 뻗은 차로·램프 위에 오면 안 됨
// (그 선 위에 기둥을 못 세워 실제로는 긴 보가 됨). 그 안에서 칸이 가장 많이 들어가는(자투리 적은) 간격을 고른다.
function structuralGrid(plate, bands, aisles, ramps, vertical, prefer = []) {
  const L = vertical ? plate.width : plate.depth;
  const along = vertical ? plate.depth : plate.width;   // 선이 뻗는 방향 길이
  const half = (vertical ? plate.columnWidth : plate.columnDepth) / 2;
  const step = 0.05;
  const n = Math.max(1, Math.round(L / step));
  const pos = (i) => (i >= n ? L : round3(i * step));
  // 선 방향으로 길게 뻗은 막힘(차로·램프): 선 위에서 막히는 길이가 9m 이상이면 그 위치는 금지
  const blocks = aisles.concat(ramps).map((r) => ({
    lo: (vertical ? r.x : r.y) - half, hi: (vertical ? r.x + r.w : r.y + r.d) + half,
    ext: vertical ? r.d : r.w,
  })).filter((b) => b.ext >= 9 && b.hi - b.lo > 2 * half + 0.5);
  const lineCost = new Float64Array(n + 1);
  for (let i = 1; i < n; i += 1) {
    const v = pos(i);
    // 같은 자리를 지나는 막힘 길이 합
    let blocked = 0;
    blocks.forEach((b) => { if (v > b.lo + 0.01 && v < b.hi - 0.01) blocked += b.ext; });
    lineCost[i] = blocked >= 9 ? 1000 + blocked : 0.2;
    if (prefer.some((q) => Math.abs(q - v) < step / 2 + 1e-6)) lineCost[i] -= 0.5;   // 먼저 정한 선·코어 면은 되도록 유지
  }
  // 이 선들로 칸이 나뉘는 줄(줄 방향이 선과 직각)이 있으면 자투리를 줄이는 쪽으로
  const cutBands = bands.filter((b) => (vertical ? b.along === "x" : b.along === "y"));
  const wasteW = cutBands.length ? 1 : 0.1;
  const spanMemo = new Map();   // 같은 간격은 한 번만 계산(속도용)
  const spanCost = (sp) => {
    const key = sp;
    let c = spanMemo.get(key);
    if (c === undefined) {
      const k = stallsPerBay(sp, half * 2, plate.minClear).count;
      c = wasteW * (sp - k * STALL_W) + 0.1 * Math.abs(sp - (plate.spacing || 8.1));
      spanMemo.set(key, c);
    }
    return c;
  };
  const maxI = Math.round(MAX_SPAN / step);
  const minI = Math.round(2.5 / step);
  const best = new Float64Array(n + 1).fill(Infinity);
  const prev = new Int32Array(n + 1).fill(-1);
  best[0] = 0;
  // 속도용: 위치 표와, 칸 수 차이(d)별 마지막 간격·비용 캐시(간격 값이 정확히 같을 때만 재사용 → 결과 동일)
  const P = new Float64Array(n + 1);
  for (let i = 0; i <= n; i += 1) P[i] = pos(i);
  const dSp = new Float64Array(n + 1).fill(NaN);
  const dCost = new Float64Array(n + 1);
  const solve = (limit) => {
    for (let i = 1; i <= n; i += 1) {
      const lc = i === n ? 0 : lineCost[i];
      const pi = P[i];
      for (let j = Math.max(0, i - limit); j <= i - minI; j += 1) {
        const bj = best[j];
        if (bj === Infinity) continue;
        const sp = pi - P[j];
        const d = i - j;
        let sc;
        if (dSp[d] === sp) sc = dCost[d];
        else { sc = spanCost(sp); dSp[d] = sp; dCost[d] = sc; }
        const c = bj + sc + lc + (sp > MAX_SPAN + 1e-6 ? 1000 : 0);
        if (c < best[i]) { best[i] = c; prev[i] = j; }
      }
    }
  };
  solve(maxI);
  if (best[n] === Infinity) { best.fill(Infinity); best[0] = 0; solve(n); }
  const lines = [];
  for (let i = n; i >= 0 && i !== -1; i = prev[i]) { lines.push(pos(i)); if (i === 0) break; }
  void along;
  return lines.reverse();
}

// 코어 출입문 면(n=y 큰 쪽, s, e, w). core.door가 n/s/e/w면 그대로, 아니면 차로와 맞닿은 길이가 가장 긴 면.
const FACES = ["n", "s", "e", "w"];
export function coreDoorFace(core, aisles) {
  if (FACES.includes(core.door)) return core.door;
  const t = 0.6;
  const strip = {
    n: { x: core.x, y: core.y + core.d, w: core.w, d: t },
    s: { x: core.x, y: core.y - t, w: core.w, d: t },
    e: { x: core.x + core.w, y: core.y, w: t, d: core.d },
    w: { x: core.x - t, y: core.y, w: t, d: core.d },
  };
  let best = null;
  FACES.forEach((f) => {
    const len = (aisles || []).reduce((sum, a) => sum + overlapArea(strip[f], a), 0) / t;
    if (!best || len > best.len + 0.01) best = { f, len };
  });
  return best && best.len > 0.5 ? best.f : "s";
}

// 장애인 칸에서 코어 출입문까지 걷는 거리 중 가장 먼 값(m). 코어나 장애인 칸이 없거나 걸어서 못 가면 null.
function disabledWalkOf(stalls, ctx) {
  const dis = (stalls || []).filter((s) => s.type === "disabled");
  if (!dis.length || !(ctx.cores || []).length) return null;
  const walk = walkField(ctx);
  const d = Math.max(...dis.map((s) => walk(entryOf(s))));
  return Number.isFinite(d) ? Math.round(d) : null;
}

// ── 기둥 최대 간격 ──
// 구조선 = 안쪽 기둥(또는 코어·램프)이 하나라도 서는 격자선 + 외벽. 차로 한가운데를 지나 기둥이 하나도 없는 격자선은 구조선이 아님.
// 1) 이웃 구조선 사이가 12m를 넘으면, 그 사이에 기둥이 가장 많이 설 수 있는 위치(대개 주차줄 앞선의 칸 사이)에 새 구조선을 넣는다.
// 2) 구조선마다 기둥 사이가 12m를 넘으면 그 사이 빈 곳에 기둥을 더 세운다. (주차칸은 빼지 않음 — 배치는 그대로, 기둥만 추가)
// 그래도 안 되면 경고로 남긴다.
export const MAX_SPAN = 12;
function enforceMaxSpan({ plate, gridX, gridY, columns, stalls, aisles, cores, ramps, mouths }) {
  const cw = plate.columnWidth;
  const cd = plate.columnDepth;
  const W = plate.width;
  const D = plate.depth;
  const hard = aisles.concat(ramps, cores, mouths);
  const solid = cores.concat(ramps, plate.voids || []);   // 외곽 다각형의 꺾인 벽도 받침
  const long = [];
  let removed = 0;
  let added = 0;
  const lenOf = (vertical) => (vertical ? D : W);      // 선을 따라가는 길이
  const spanOf = (vertical) => (vertical ? W : D);     // 선들이 늘어선 방향 길이
  const center = (c) => ({ x: c.x + c.w / 2, y: c.y + c.d / 2 });
  // 세로선(vertical) x=g 위, 선을 따라 p 위치의 기둥 사각형. 외벽선 위(p=0/len)는 벽 쪽 0.5m 띠 안에.
  const rectAt = (vertical, g, p) => {
    const len = lenOf(vertical);
    let a = p - (vertical ? cd : cw) / 2;
    if (p <= 0.01) a = -(vertical ? cd : cw); else if (p >= len - 0.01) a = len;
    return vertical ? { x: round3(g - cw / 2), y: round3(a), w: cw, d: cd, phase: "column" }
      : { x: round3(a), y: round3(g - cd / 2), w: cw, d: cd, phase: "column" };
  };
  const nearCol = (rect) => columns.some((c) => Math.hypot(center(c).x - rect.x - rect.w / 2, center(c).y - rect.y - rect.d / 2) < 0.6);
  const free = (rect) => rect.x >= -cw - 0.01 && rect.y >= -cd - 0.01 && rect.x + rect.w <= W + cw + 0.01 && rect.y + rect.d <= D + cd + 0.01
    && !hard.some((b) => overlapArea(rect, b) > 0.001 || tooClose(rect, b, plate.minClear));
  const hitsOf = (rect) => stalls.filter((st) => tooClose(st, rect, plate.minClear));
  const place = (rect) => {
    hitsOf(rect).forEach((st) => { const k = stalls.indexOf(st); if (k >= 0) { stalls.splice(k, 1); removed += 1; } });
    columns.push(rect);
    added += 1;
  };
  // 선 위 받침 구간(선 따라 좌표): 외벽 양끝 + 기둥 + 코어·램프
  const supportsOn = (vertical, g) => {
    const len = lenOf(vertical);
    const list = [[0, 0], [len, len]];
    columns.forEach((c) => {
      const m = center(c);
      if (Math.abs((vertical ? m.x : m.y) - g) < 0.6) { const p = vertical ? m.y : m.x; list.push([p, p]); }
    });
    solid.forEach((r) => {
      const lo = vertical ? r.x : r.y;
      const hi = vertical ? r.x + r.w : r.y + r.d;
      if (g >= lo - 0.01 && g <= hi + 0.01) list.push(vertical ? [r.y, r.y + r.d] : [r.x, r.x + r.w]);
    });
    return list.sort((a, b) => a[0] - b[0]);
  };
  const interiorOn = (vertical, g) => {
    const len = lenOf(vertical);
    return supportsOn(vertical, g).some(([a, b]) => b > 1 && a < len - 1);
  };
  const maxGapOn = (vertical, g, extra = []) => {
    const list = supportsOn(vertical, g).concat(extra.map((p) => [p, p])).sort((a, b) => a[0] - b[0]);
    let reach = list[0][1];
    let worst = 0;
    list.forEach(([a, b]) => { worst = Math.max(worst, a - reach); reach = Math.max(reach, b); });
    return worst;
  };
  // 구조선(선 방향 좌표 목록): 외벽 + 안쪽 받침이 있는 격자선 + 코어·램프 폭
  const structural = (vertical, lines) => {
    const span = spanOf(vertical);
    const list = [[0, 0], [span, span]];
    lines.forEach((g) => { if (g > 0.3 && g < span - 0.3 && interiorOn(vertical, g)) list.push([g, g]); });
    solid.forEach((r) => list.push(vertical ? [r.x, r.x + r.w] : [r.y, r.y + r.d]));
    return list.sort((a, b) => a[0] - b[0]);
  };

  // 1) 구조선 사이 간격
  [[true, gridX, () => gridY], [false, gridY, () => gridX]].forEach(([vertical, lines, crossOf]) => {
    const span = spanOf(vertical);
    const skip = [];
    if (vertical ? plate.spansX : plate.spansY) return;   // 간격을 직접 넣은 방향은 선을 더하지 않음(경고만)
    for (let guard = 0; guard < 12; guard += 1) {
      const st = structural(vertical, lines);
      let gap = null;
      let reach = st[0][1];
      for (const [a, b] of st) {
        if (a - reach > MAX_SPAN + 0.01 && !skip.some((v) => Math.abs(v - reach) < 0.01)) { gap = [reach, a]; break; }
        reach = Math.max(reach, b);
      }
      if (!gap) break;
      const [a, b] = gap;
      // 가로지르는 구조선(외벽 포함)과 만나는 점에 기둥을 세워 본다
      const cross = [0, lenOf(vertical)].concat(crossOf().filter((q) => q > 0.3 && q < lenOf(vertical) - 0.3 && interiorOn(!vertical, q)));
      const lo = Math.max(a + 2, b - MAX_SPAN);
      const hi = Math.min(b - 2, a + MAX_SPAN);
      let best = null;
      for (let g = lo; g <= hi + 1e-6; g += 0.25) {
        const gg = round3(g);
        const rects = cross.map((q) => rectAt(vertical, gg, q)).filter((r) => !nearCol(r) && free(r) && hitsOf(r).length === 0);
        const inner = rects.filter((r) => { const m = center(r); const q = vertical ? m.y : m.x; return q > 1 && q < lenOf(vertical) - 1; });
        if (!inner.length) continue;
        const worst = maxGapOn(vertical, gg, rects.map((r) => (vertical ? center(r).y : center(r).x)));
        const score = inner.length * 10 - Math.max(0, worst - MAX_SPAN) - Math.abs(gg - (a + b) / 2) * 0.05;
        if (!best || score > best.score) best = { g: gg, rects, score };
      }
      if (!best) { skip.push(a); long.push({ vertical, g: null, a, b, len: round3(b - a) }); continue; }
      best.rects.forEach(place);
      lines.push(best.g);
      lines.sort((p, q) => p - q);
    }
    void span;
  });

  // 2) 구조선 위 기둥 사이 간격
  [[true, gridX, gridY], [false, gridY, gridX]].forEach(([vertical, lines, cross]) => {
    lines.forEach((g) => {
      if (g <= 0.3 || g >= spanOf(vertical) - 0.3) return;   // 외벽선은 외벽이 받음
      if (!interiorOn(vertical, g)) return;                    // 차로 위 빈 선은 구조선이 아님
      const skip = [];
      for (let guard = 0; guard < 20; guard += 1) {
        const sup = supportsOn(vertical, g);
        let gap = null;
        let reach = sup[0][1];
        for (const [a, b] of sup) {
          if (a - reach > MAX_SPAN + 0.01 && !skip.some((v) => Math.abs(v - reach) < 0.01)) { gap = [reach, a]; break; }
          reach = Math.max(reach, b);
        }
        if (!gap) break;
        const [a, b] = gap;
        const n = Math.ceil((b - a) / MAX_SPAN);
        const ideal = a + (b - a) / n;
        const lo = Math.max(a + 0.6, b - MAX_SPAN * (n - 1));
        const hi = a + MAX_SPAN;
        const cand = [];
        for (let p = lo; p <= hi + 1e-6; p += 0.25) cand.push(round3(p));
        cross.forEach((c) => { if (c >= lo && c <= hi) cand.push(c); });
        let best = null;
        cand.forEach((p) => {
          const rect = rectAt(vertical, g, p);
          if (nearCol(rect) || !free(rect)) return;
          const hits = hitsOf(rect);
          const onGrid = cross.some((c) => Math.abs(c - p) < 0.05);
          const score = hits.length * 10 + (onGrid ? 0 : 1.5) + Math.abs(p - ideal) * 0.1;
          if (!best || score < best.score) best = { rect, hits, score };
        });
        if (!best || best.hits.length > 2) { skip.push(a); long.push({ vertical, g, a, b, len: round3(b - a) }); continue; }
        place(best.rect);
      }
    });
  });
  return { long, removed, added };
}

// ── 모듈 격자 ──
export function moduleSpan() {
  return round3(STALL_D + AISLE / 2);
}

function moduleLines(length, step, offset) {
  const lines = [0];
  let v = ((offset % step) + step) % step;
  for (; v < length - 0.2; v += step) if (v > 0.2) lines.push(round3(v));
  return closeGrid(lines, length);
}

// 안쪽 주차줄 앞선(기둥 반 두께 안쪽)들이 가장 많이 걸리는 오프셋으로 8.2m 간격 선을 만든다.
function moduleCrossLines(bands, plate, spec) {
  if (plate.moduleGrid === false) return null;
  const axis = spec.axis === "y" ? "x" : "y";   // 차로를 가로지르는 방향
  if (axis === "y" ? plate.spansY : plate.spansX) return null;   // 직접 넣은 간격은 그대로
  const inner = bands.filter((b) => b.phase === "inner");
  if (!inner.length) return null;
  const half = (axis === "y" ? plate.columnDepth : plate.columnWidth) / 2;
  const fronts = inner.map((b) => {
    if (b.along === "x") return b.face === "s" ? b.y + half : b.y + b.d - half;
    return b.face === "w" ? b.x + half : b.x + b.w - half;
  });
  const step = moduleSpan();
  let best = null;
  fronts.forEach((o) => {
    const hits = fronts.filter((f) => { const r = (((f - o) % step) + step) % step; return r < 0.05 || r > step - 0.05; }).length;
    if (!best || hits > best.hits) best = { o, hits };
  });
  const length = axis === "y" ? plate.depth : plate.width;
  return { axis, lines: moduleLines(length, step, best.o) };
}

// 기둥 세울 선: 줄 안에(기둥 반 두께 이상 안쪽) 모듈 격자선이 지나가면 그 선, 없으면 앞선(벽 쪽 줄은 벽).
function crossSegments(bands, plate, gridX, gridY) {
  const fallback = frontSegments(bands, plate);
  const out = [];
  bands.forEach((band, i) => {
    const alongX = band.along === "x";
    const lines = alongX ? gridY : gridX;
    const half = (alongX ? plate.columnDepth : plate.columnWidth) / 2;
    const lo = (alongX ? band.y : band.x) + half - 0.01;
    const hi = (alongX ? band.y + band.d : band.x + band.w) - half + 0.01;
    const inside = lines.filter((v) => v >= lo && v <= hi);
    // 벽에 등을 댄 줄은 기둥을 벽 쪽에(칸이 기둥 틈까지 써서 [확 일 확]이 들어감)
    const back = fallback[i];
    const onWall = !back.front;
    if (onWall) { out.push(back); return; }   // 외벽에 붙임 모드의 벽 쪽 줄
    // 줄 안에 격자선이 없으면 기둥을 두지 않는다(앞선에 따로 세우면 격자에서 벗어나 기둥선이 어긋남).
    if (!inside.length) return;
    inside.forEach((v) => out.push(alongX
      ? { axis: "h", y: v, x0: band.x, x1: band.x + band.w, outward: 0, front: true }
      : { axis: "v", x: v, y0: band.y, y1: band.y + band.d, outward: 0, front: true }));
  });
  return out;
}

// 격자 맞춤 코어를 주어진 격자선에 맞춘다: 가장 가까운 칸에서 시작해 칸 수(nx, ny)만큼 — 크기 = 격자선 사이 거리.
function snapToLines(core, lines, plate) {
  if (!core || core.grid === false || !plate.spacing) return core;
  // 기둥 격자 먼저 방식: 격자 간격이 칸마다 달라(5~12m) 칸 수로 크기를 정하면 코어가 커지거나 작아진다.
  // → 크기는 그대로, 한쪽 면만 가장 가까운 기둥선에 붙인다(코어 벽이 기둥선 위에 오게).
  if (plate.moduleGrid !== false && plate.gridFirst !== false) {
    const snap1 = (ls, pos, size, length) => {
      let best = { pos, score: Infinity };
      ls.forEach((v) => {
        [v, v - size].forEach((p) => {
          if (p < -1e-6 || p + size > length + 1e-6) return;
          const score = Math.abs(p - pos);
          if (score < best.score) best = { pos: p, score };
        });
      });
      return best.score <= Math.max(4, size / 2) ? best.pos : pos;
    };
    return { ...core, x: round3(snap1(lines.gx, core.x, core.w, plate.width)), y: round3(snap1(lines.gy, core.y, core.d, plate.depth)), grid: true };
  }
  // 순환 차로(벽에서 칸 깊이 + 차로) 안쪽 칸을 우선 — 차로를 물면 차로가 코어를 돌아 ㄷ자로 꺾임
  const ring = STALL_D + AISLE;
  const fit = (ls, start, cells, size, length) => {
    let best = null;
    for (let i = 0; i + cells < ls.length; i += 1) {
      const span = ls[i + cells] - ls[i];
      if (span < size * 0.75) continue;   // 끝 자투리 칸은 제외
      const crosses = ls[i] < ring - 0.3 || ls[i + cells] > length - ring + 0.3;
      const score = Math.abs(ls[i] - start) + (crosses ? 1000 : 0);
      if (!best || score < best.score) best = { pos: ls[i], size: span, score };
    }
    return best;
  };
  const step = plate.spacing;
  const nx = core.nx || Math.max(1, Math.round(core.w / step));
  const ny = core.ny || Math.max(1, Math.round(core.d / step));
  const sx = fit(lines.gx, core.x, nx, nx * step, plate.width);
  const sy = fit(lines.gy, core.y, ny, ny * step, plate.depth);
  if (!sx || !sy) return core;
  return { ...core, x: round3(sx.pos), w: round3(sx.size), y: round3(sy.pos), d: round3(sy.size), nx, ny, grid: true };
}
