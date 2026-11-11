import { assignStallTypes, stallRuleTargets } from "./stallTypes.js?v=163";

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
  width: 72.9,
  depth: 56.7,
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
  ramp: { edge: "w", t: 28, width: 6, length: 21.4 },
  cores: [
    // 기둥 격자 맞춤 2×1칸(15.7×7.6m). 도면에 코어 치수가 없어 모듈에 맞춘 추정값.
    { x: 24.55, y: 16.45, w: 15.7, d: 7.6, grid: true, nx: 2, ny: 1 },
    { x: 24.55, y: 32.65, w: 15.7, d: 7.6, grid: true, nx: 2, ny: 1 },
  ],
  notes: [
    "기둥 중심 간격 8.1m는 도면의 8100 표기다.",
    "평면 72.9×56.7m는 8.1m 모듈 9×7로 읽은 추정값이다. 첨부 도면은 외곽 치수 합계가 잘려 있다.",
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
  const v0 = RAMP_INSET;                                 // 경사 시작 (외벽에서 11m)
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
export let RAMP_INSET = STALL_D + AISLE;   // 줄 깊이(STALL_D)가 바뀌면 layoutParking에서 다시 맞춘다

export function rampFootprint(ramp, plate) {
  const { edge, t, width, length } = ramp;
  const external = (ramp.placement || "internal") === "external";
  const k = RAMP_INSET;
  if (edge === "s") return { x: t - width / 2, y: external ? -length : k, w: width, d: length };
  if (edge === "n") return { x: t - width / 2, y: external ? plate.depth : plate.depth - k - length, w: width, d: length };
  if (edge === "w") return { x: external ? -length : k, y: t - width / 2, w: length, d: width };
  return { x: external ? plate.width : plate.width - k - length, y: t - width / 2, w: length, d: width };
}

/** 내부형 램프 입구(경사 시작) 쪽 경계. 아래층에서 차가 들어오는 곳이다. */
export function rampTopLip(ramp, plate) {
  const k = RAMP_INSET;
  const half = ramp.width / 2;
  if (ramp.edge === "w") return { x: k - 1.0, y: ramp.t - half, w: 1.2, d: ramp.width };
  if (ramp.edge === "e") return { x: plate.width - k - 0.2, y: ramp.t - half, w: 1.2, d: ramp.width };
  if (ramp.edge === "s") return { x: ramp.t - half, y: k - 1.0, w: ramp.width, d: 1.2 };
  return { x: ramp.t - half, y: plate.depth - k - 0.2, w: ramp.width, d: 1.2 };
}

export function defaultRampLength(plate, edge) {
  const span = edge === "n" || edge === "s" ? plate.depth : plate.width;
  return round1(clamp(minStraightRampLength(floorHeightOf(plate), rampTransitions(plate)), AISLE, Math.min(40, span * 0.8)));
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

function pushOutOf(core, box, plate) {
  if (overlapArea(core, box) < 0.01) return core;
  // 격자 맞춤 코어는 밀어낸 뒤에도 기둥 면에 맞춘다.
  const colW = plate.columnWidth || COLUMN;
  const colD = plate.columnDepth || colW;
  const { gx, gy } = coreGridLines(plate);
  const facesX = gx.map((g) => g + colW / 2);
  const facesY = gy.map((g) => g + colD / 2);
  const snapUp = (faces, min) => faces.filter((f) => f >= min - 1e-6).sort((p, q) => p - q)[0];
  const snapDown = (faces, maxStart) => faces.filter((f) => f <= maxStart + 1e-6).sort((p, q) => q - p)[0];
  const grid = core.grid !== false && plate.spacing > 0;
  // 램프에 바로 붙인 자리(raw)와 기둥 면에 맞춘 자리(snap)를 둘 다 후보로 둔다. 격자 자리를 조금 더 선호.
  const raw = [
    { x: box.x - core.w, y: core.y },
    { x: box.x + box.w, y: core.y },
    { x: core.x, y: box.y - core.d },
    { x: core.x, y: box.y + box.d },
  ].map((m) => ({ ...m, off: grid ? 2 : 0 }));
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
  return out;
}

// ── 코어 격자 맞춤 ───────────────────────────────────────────
// 코어 테두리를 기둥 면에 맞춘다: 가로 nx칸 × 세로 ny칸, 크기 = 칸 간격 합 − 기둥 단면.
// 그러면 코어 옆 주차 줄이 기둥 베이와 같은 선에서 끊겨 빈칸·짧은 줄이 덜 생긴다.
export function coreGridLines(plate) {
  return {
    gx: gridLinesFrom(plate.width, plate.spansX, plate.spacing),
    gy: gridLinesFrom(plate.depth, plate.spansY, plate.spacing),
  };
}

function snapAxis(lines, start, cells, colW) {
  const half = colW / 2;
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
  const nx = clamp(core.nx || Math.max(1, Math.round((core.w + colW) / step)), 1, maxX);
  const ny = clamp(core.ny || Math.max(1, Math.round((core.d + colD) / step)), 1, maxY);
  const sx = snapAxis(gx, core.x, nx, colW);
  const sy = snapAxis(gy, core.y, ny, colD);
  if (!sx || !sy) return core;
  const r2 = (v) => Math.round(v * 100) / 100;
  return { ...core, x: r2(sx.pos), w: r2(sx.size), y: r2(sy.pos), d: r2(sy.size), nx, ny, grid: true };
}

/**
 * 기둥 간격으로 코어 칸 수 추천.
 * 기준: 아파트 1개 동 코어(계단 + 승강기 2대 + 전실) 대략 50㎡ 이상이 들어가는 가장 작은 칸 수.
 * 기둥 8.1m·단면 0.5m면 1칸 = 7.6×7.6m(58㎡) → 1×1칸.
 */
export const CORE_TARGET_AREA = 50;
export function recommendCoreCells(plate) {
  const colW = plate.columnWidth || COLUMN;
  const colD = plate.columnDepth || colW;
  const step = plate.spacing || 8.1;
  const options = [[1, 1], [2, 1], [1, 2], [2, 2], [3, 1], [3, 2]];
  for (const [nx, ny] of options) {
    const w = nx * step - colW;
    const d = ny * step - colD;
    if (w * d >= CORE_TARGET_AREA && Math.min(w, d) >= 5) return { nx, ny, w, d };
  }
  return { nx: 2, ny: 2, w: 2 * step - colW, d: 2 * step - colD };
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
  const cores = input.cores || [];
  const movable = cores.length === 1 && cores[0].grid !== false && plate.spacing > 0;
  const score = (inp) => specs.reduce((best, spec) => {
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
    const out = [cores];   // 지금 자리도 후보
    for (let i = 0; i + nx < gx.length; i += 1) {
      for (let j = 0; j + ny < gy.length; j += 1) {
        const c = snapCore({ ...core, x: gx[i] + plate.columnWidth / 2, y: gy[j] + plate.columnDepth / 2, nx, ny, grid: true }, plate);
        if (Math.abs(c.w - core.w) > 0.1 || Math.abs(c.d - core.d) > 0.1) continue;   // 가장자리 짜투리 칸은 크기가 달라 제외
        if (overlapArea(c, box) > 0.01) continue;
        out.push([c]);
      }
    }
    return out;
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
export function rampPositionCheck(plate, placement, floorHeight) {
  const legal = plate.legalStalls || 0;
  const length = minStraightRampLength(floorHeight || plate.floorHeight || 3.2, rampTransitions({ legalStalls: legal }));
  const quick = { ...plate, trimDeadEnds: false };
  const edge = plate.roadEdge || "w";
  const out = {};
  ["start", "mid", "end"].forEach((pos) => {
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
  });
  return out;
}

export function generateVariants(input) {
  const specs = variantSpecs(input.rampPlacement || input.ramps?.[0]?.placement || "internal");
  const variants = specs.map((spec, index) => {
    const result = layoutParking({ ...input, spec });
    return {
      ...result,
      id: `V${index + 1}`,
      name: variantName(spec, input),
      spec,
    };
  });
  const ranked = variants.map((variant, index) => ({ variant, index }));
  ranked.sort((a, b) => compareVariants(a.variant, b.variant));
  const best = ranked.find((item) => item.variant.metrics.valid);
  variants.forEach((variant, index) => {
    variant.recommended = Boolean(best && best.index === index);
    variant.maxStalls = false;
  });
  // 최대 주차칸 표시: 통과한 안 중 대수가 가장 많은 안
  const valid = variants.filter((v) => v.metrics.valid);
  const top = Math.max(-1, ...valid.map((v) => v.metrics.stalls));
  valid.forEach((v) => { v.maxStalls = v.metrics.stalls === top; });
  // 장애인 코어 인접 안: 추천안과 같은 설정으로, 코어 옆에 차로를 뚫어 장애인 칸을 코어에 붙인다(대수가 줄 수 있음).
  if (!input.noUniform) {
    const baseIndex = best ? best.index : 0;
    const baseSpec = variants[baseIndex].spec;
    const side = layoutParking({ ...input, spec: { ...baseSpec, coreAisle: true } });
    const ok = side.metrics && side.metrics.coreAisle;
    variants.push({
      ...side,
      id: `V${variants.length + 1}`,
      name: ok ? `장애인 코어 인접 (${variants[baseIndex].id} 기준) · 코어 옆 차로` : `장애인 코어 인접 (${variants[baseIndex].id} 기준) · 코어 옆에 차로 낼 자리 없음`,
      spec: { ...baseSpec, coreAisle: true },
      recommended: false,
      maxStalls: side.metrics.valid && side.metrics.stalls === top,
      coreSide: true,
    });
  }
  // 방향 통일 안: 추천안과 같은 설정으로, 정해진 줄과 방향이 다른 빈자리 칸을 같은 방향으로 바꾼 안
  if (!input.noUniform) {
    const baseIndex = best ? best.index : 0;
    const baseSpec = variants[baseIndex].spec;
    const uniform = layoutParking({ ...input, spec: { ...baseSpec, uniform: true } });
    variants.push({
      ...uniform,
      id: `V${variants.length + 1}`,
      name: `방향 통일 (${variants[baseIndex].id} 기준) · 빈자리 칸을 줄 방향에 맞춤`,
      spec: { ...baseSpec, uniform: true },
      recommended: false,
      maxStalls: uniform.metrics.valid && uniform.metrics.stalls === top,
      uniform: true,
    });
  }
  return variants;
}

// 내부 직선 램프 자리 두 가지를 모두 짜 보고 대수가 많은 쪽을 고른다(자동 배치일 때만).
//  - 벽에 붙임: 벽 → 램프 → 주차칸 → 순환 차로 (wallStrip). 램프 폭만큼 나머지가 안쪽으로 밀린다.
//  - 순환 차로 줄: 램프가 순환 차로 자리를 쓰고 바깥 주차 줄은 램프를 보게 되어 빠진다.
//  어느 쪽이 나은지는 주차장 크기(안쪽 줄 수)에 따라 달라진다.
export function layoutParking(input) {
  // 주차장법 시행규칙 제11조④ → 제6조①14: 50대 이상 부설주차장은 확장형 30% 이상.
  // 확장형 깊이가 5.2m라서 이때는 모든 주차 줄 깊이를 5.2m로 짠다(일반형도 5.0m 이상이면 되므로 문제없음).
  const raw = input.plate || input;
  STALL_D = extendedRequired(raw) ? STALL_D_EXTENDED : STALL_D_GENERAL;
  RAMP_INSET = STALL_D + AISLE;
  return layoutRampChoice(input);
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
  if (!r || r.placement === "external" || r.pos === "mid") return base;   // 가운데로 정했으면 끝으로 옮기지 않는다
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
  const shifted = input.lockRamp
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
    const maxStraight = across - RAMP_INSET - AISLE;
    const need = minStraightRampLength(floorHeightOf(plate), rampTransitions(plate));
    if (need <= maxStraight + 1e-6 && ramp.length > maxStraight) ramp.length = round1(Math.floor(maxStraight * 10) / 10);
  }
  // 곡선이 섞이면 곡선 2차로 6.5m에 맞춰 직선 부분도 6.5m로 통일한다(직선만이면 6m).
  if (ramp.placement !== "external") {
    const curved = rampShape({ ...ramp, width: AISLE }, plate).kind === "curved";
    ramp.width = curved ? Math.max(ramp.width, RAMP_CURVE_W) : (ramp.width === RAMP_CURVE_W ? AISLE : ramp.width);
  }
  // 벽 가까이 둔 직선 램프는 벽에 딱 붙인다(틈 없이 램프 줄을 만든다).
  let strip = spec.strip === "off" ? null : wallStrip(ramp, plate);
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
  const cores = (input.cores || (input.core ? [input.core] : [])).filter(Boolean)
    .map((core) => clampCore(core, plate))
    .map((core) => (rampBox ? pushOutOf(core, rampBox, plate) : core));

  const bay = stallsPerBay(plate.spacing, plate.columnWidth, plate.minClear);
  const bayStats = { total: 0, triple: 0 };
  const shape = rampShape(ramp, plate);
  const internal = (ramp.placement || "internal") === "internal";
  const rampPieces = internal ? shape.pieces : [];
  const geo = layoutGeometry(plate, spec, strip);
  let aisles = geo.aisles;
  if ((ramp.placement || "internal") === "internal") {
    aisles = aisles.flatMap((aisle) => rampPieces.reduce((parts, piece) => parts.flatMap((part) => cutBlock(part, piece, "internal")), [aisle]));
  }
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

  const bands = geo.bands;
  // 기둥 줄: 가로·세로 간격 목록을 따로 넣으면 그것을, 없으면 기둥 간격 하나로 (추가 2026-11-10)
  const gridX = gridLinesFrom(plate.width, plate.spansX, plate.spacing);
  const gridY = gridLinesFrom(plate.depth, plate.spansY, plate.spacing);
  const fixedBlocks = cores.concat(internal ? rampPieces : []);
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
    const cols = placeColumns(backSegments(bands), gridX, gridY, plate, stallBlocks.concat(openings.map((opening) => mouthRect(opening, plate))))
      .map((c) => ({ x: c.x - plate.minClear, y: c.y - plate.minClear, w: c.w + 2 * plate.minClear, d: c.d + 2 * plate.minClear }));
    const gapObstacles = stallBlocks.concat(cols);
    gapBands(aisles).forEach((band, k) => fillBand(band, bands.length + k, plate, band.along === "x" ? gridX : gridY, plate.columnWidth, plate.minClear, gapObstacles, stalls, bayStats, offBands));
    // 빈자리 칸은 앞쪽 6m(차로 폭)가 실제로 차로로 덮여 있을 때만 인정한다.
    const added = stalls.splice(before).filter((stall) => frontIsAisle(stall, aisles));
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
      const cols = placeColumns(backSegments(bands), gridX, gridY, plate, stallBlocks.concat(openings.map((opening) => mouthRect(opening, plate))));
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
    const cols = placeColumns(backSegments(bands), gridX, gridY, plate, stallBlocks.concat(openings.map((opening) => mouthRect(opening, plate))));
    aisles = alignLoneStalls(stalls, aisles, stallBlocks, cols, plate);
  }

  const backs = backSegments(bands);
  const columnObstacles = stallBlocks.concat(openings.map((opening) => mouthRect(opening, plate)));
  const columns = placeColumns(backs, gridX, gridY, plate, columnObstacles);
  const columnConflicts = [];
  const keptStalls = [];
  stalls.forEach((stall) => {
    if (columns.some((column) => tooClose(stall, column, plate.minClear))) columnConflicts.push({ ...stall, conflict: true });
    else keptStalls.push(stall);
  });
  const typed = assignStallTypes(keptStalls, typeRules, {
    plate, columns, blocks: stallBlocks, cores, ramp, openings,
    reach: plate.trimDeadEnds ? (rect) => stallReachable(rect, aisles) : null,   // 넓히거나 다시 나눠도 앞이 차로여야 함
  });
  stalls.length = 0;
  typed.stalls.forEach((stall, index) => {
    stall.no = index + 1;
    stalls.push(stall);
  });
  const adj = buildGraph(aisles);
  const issues = [];
  issues.push(...portalIssues(aisles, openings, [ramp], plate));
  issues.push(...slopeIssues([ramp], plate));
  issues.push(...siteIssues([ramp], plate));
  issues.push(...roadIssues([ramp], plate));
  const drives = buildArrows(plate, aisles, openings, ramp, "ccw", false);
  const route = drives.map((seg) => ({ x: seg.x1, y: seg.y1 })).concat(drives.length ? [{ x: drives[drives.length - 1].x2, y: drives[drives.length - 1].y2 }] : []);
  const columnHits = stallColumnHits(stalls, columns, plate.minClear);
  if (columnHits > 0) issues.push({ type: "column", label: `주차칸-기둥 충돌 ${columnHits}건` });
  typed.shortages.forEach((label) => issues.push({ type: "stallType", label }));
  const minAisleWidth = aisles.length ? Math.min(...aisles.map((aisle) => Math.min(aisle.w, aisle.d))) : 0;
  if (aisles.length && minAisleWidth < AISLE_MIN) issues.push({ type: "network", label: `차로 폭 ${round1(minAisleWidth)}m 구간이 있습니다 (6m 이상 필요).` });
  const deadEnds = deadEndCount(aisles, adj);
  const overlapCount = countOverlaps({ stalls, aisles, columns }, cores, internal ? rampPieces : [], plate);
  const connected = !issues.some((issue) => issue.type === "opening" || issue.type === "ramp" || issue.type === "network");
  const slopeOk = !issues.some((issue) => issue.type === "slope");
  const siteOk = !issues.some((issue) => issue.type === "site");
  const plateArea = plate.width * plate.depth;
  const aisleRatio = plateArea ? round3(aisleArea(aisles, plate) / plateArea) : 0;
  const perimeterRatio = stalls.length ? stalls.filter((stall) => stall.phase === "perimeter").length / stalls.length : 0;
  const tripleRatio = bayStats.total ? bayStats.triple / bayStats.total : 0;
  const hasLoop = ["s", "n", "w", "e"].every((side) => aisles.some((aisle) => aisle.role === "ring" && aisle.side === side));
  const similarity = Math.round(clamp(perimeterRatio, 0, 1) * 40 + (hasLoop ? 30 : 0) + clamp(tripleRatio, 0, 1) * 30);
  const valid = connected && columnHits === 0 && slopeOk && overlapCount === 0;
  const rejected = valid ? null : rejectReason({ connected, columnHits, slopeOk, siteOk, overlapCount });
  return {
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
    roadEdge: plate.roadEdge || null,
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
    ...local.rect({ u0: ramp.t - half, u1: ramp.t + half, v0: RAMP_INSET - AISLE, v1: RAMP_INSET }) };
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
    const end = RAMP_INSET + ramp.length;
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
  const blocks = obstacles.concat(stalls)
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
      if (obstacles.some((o) => overlapArea(stall, o) > 0.03) || stalls.some((o) => overlapArea(stall, o) > 0.03)) continue;
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
      if (obstacles.some((block) => overlapArea(stall, block) > 0.03)) continue;
      if (stalls.some((item) => overlapArea(stall, item) > 0.03)) continue;
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

function placeColumns(segments, gridX, gridY, plate, obstacles) {
  const halfW = plate.columnWidth / 2;
  const halfD = plate.columnDepth / 2;
  const seen = new Set();
  const columns = [];
  const sharedLine = (segment, pos) => segments.some((other) => {
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
    if (obstacles.some((block) => tooClose(rect, block, plate.minClear))) return;
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
  count += closeHits(columns, cores, minClear);
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
      if (contactLength(aisles[i], aisles[j]) < AISLE_MIN) continue;
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
  return rectsOverlap(a, b) || rectGap(a, b) < minClear - 1e-4;
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
  if (length - lines[lines.length - 1] > 0.2) lines.push(round3(length));
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
  if (length - lines[lines.length - 1] > 0.2) lines.push(round3(length));
  return lines;
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
