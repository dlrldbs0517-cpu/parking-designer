/**
 * 모듈형 램프 (프로토타입, 2026-11-23)
 * 램프 = 직선 모듈과 90° 회전 모듈을 순서대로 이은 사슬.
 * 경사 자동 배분은 정해진 규칙으로 계산한다(학습형 AI 아님).
 *
 * 근거: 주차장법 시행규칙 제6조①5 나·다·라·바·사, [별표 1] (law.go.kr, 시행 2026.7.27 국토교통부령 제1604호, 확인 2026-11-23)
 *  - 직선 17% 이하, 곡선 14% 이하 (라목)
 *  - 도로와 접하는 부분부터 3m: 직선 8.5%·곡선 7% 이하 (바목, 오르막 경사로)
 *  - 곡선 내변반경 6m 이상 (50대 이하 5m) (나목)
 *  - 폭: 직선 3.3m(2차로 6m), 곡선 3.6m(2차로 6.5m) (다목)
 *  - 50대 이상: 2차로 6m 또는 진입·진출 분리, 완화구간(최대 경사의 1/2 이하) (사목)
 *  - 별표 1: 50~99대 볼록형 1.7m / 100대 이상 볼록형 1.7m + 오목형 2m
 * 부설주차장도 제11조①으로 제6조 기준을 준용한다.
 */

export const SLOPE_MAX = { straight: 0.17, turn: 0.14 };
export const SLOPE_EASE = { straight: 0.085, turn: 0.07 };   // 완화구간·도로변 3m: 최대 경사의 1/2
export const ROAD_GENTLE_LEN = 3;
export const CREST_LEN = 1.7;   // 볼록형(램프 윗부분)
export const SAG_LEN = 2;       // 오목형(램프 아랫부분)
export const ZONE = 6;          // 램프 양끝 도착·진입 구역(차로 폭)
export const SNAP = 0.5;

const r3 = (v) => Math.round(v * 1000) / 1000;
const r1 = (v) => Math.round(v * 10) / 10;
const snap = (v, s = SNAP) => Math.round(v / s) * s;
const rad = (deg) => (deg * Math.PI) / 180;
const dirOf = (h) => ({ x: r3(Math.cos(rad(h))), y: r3(Math.sin(rad(h))) });
const norm360 = (h) => ((h % 360) + 360) % 360;

/** 법정 대수에 따른 폭·반경 최소값 */
export function minimums(legalStalls = 0) {
  const twoLane = legalStalls >= 50;
  return {
    straightWidth: twoLane ? 6 : 3.3,
    turnWidth: twoLane ? 6.5 : 3.6,
    innerRadius: legalStalls > 50 ? 6 : 5,
  };
}

/** 모듈 하나의 중심선 길이 */
export function moduleLength(m, ramp) {
  if (m.type === "straight") return Math.max(0, Number(m.length) || 0);
  const Rc = (m.radius ?? ramp.innerRadius ?? 6) + ramp.width / 2;
  return (Math.PI / 2) * Rc;
}

/**
 * 사슬 → 평면 형상. 시작점(x,y)은 램프 윗부분(지상 쪽) 중심선, heading은 내려가는 방향(도, 0=동, 90=북).
 * 반환 modules[i] = { type, start, end, length, s0, s1, center?, polygon, rects, samples }
 */
export function buildChain(ramp) {
  let pose = { x: ramp.x, y: ramp.y, h: norm360(ramp.heading || 0) };
  let s = 0;
  const half = ramp.width / 2;
  const out = [];
  (ramp.modules || []).forEach((m, index) => {
    const L = moduleLength(m, ramp);
    const d = dirOf(pose.h);
    const n = { x: -d.y, y: d.x };   // 진행 방향 왼쪽
    if (m.type === "straight") {
      const end = { x: r3(pose.x + d.x * L), y: r3(pose.y + d.y * L), h: pose.h };
      const polygon = [
        { x: pose.x + n.x * half, y: pose.y + n.y * half },
        { x: end.x + n.x * half, y: end.y + n.y * half },
        { x: end.x - n.x * half, y: end.y - n.y * half },
        { x: pose.x - n.x * half, y: pose.y - n.y * half },
      ].map((p) => ({ x: r3(p.x), y: r3(p.y) }));
      const samples = [];
      const k = Math.max(2, Math.ceil(L / 1));
      for (let i = 0; i <= k; i += 1) samples.push({ x: r3(pose.x + d.x * L * i / k), y: r3(pose.y + d.y * L * i / k), s: r3(s + L * i / k), tx: d.x, ty: d.y });
      out.push({ index, type: "straight", start: pose, end, length: r3(L), s0: r3(s), s1: r3(s + L), polygon, rects: [bbox(polygon)], samples });
      pose = end;
    } else {
      const sgn = m.dir === "R" ? -1 : 1;           // L = 반시계(+90°)
      const Ri = m.radius ?? ramp.innerRadius ?? 6;
      const Rc = Ri + half;
      const c = { x: pose.x + n.x * Rc * sgn, y: pose.y + n.y * Rc * sgn };
      const a0 = Math.atan2(pose.y - c.y, pose.x - c.x);
      const steps = 24;
      const ring = (R) => {
        const pts = [];
        for (let i = 0; i <= steps; i += 1) { const a = a0 + sgn * (Math.PI / 2) * (i / steps); pts.push({ x: r3(c.x + R * Math.cos(a)), y: r3(c.y + R * Math.sin(a)), a }); }
        return pts;
      };
      const mid = ring(Rc);
      const inner = ring(Ri);
      const outer = ring(Ri + ramp.width);
      const polygon = outer.map(({ x, y }) => ({ x, y })).concat(inner.slice().reverse().map(({ x, y }) => ({ x, y })));
      const samples = mid.map((p, i) => ({ x: p.x, y: p.y, s: r3(s + L * i / steps), tx: -Math.sin(p.a) * sgn, ty: Math.cos(p.a) * sgn }));
      const rects = [];
      for (let k = 0; k < 3; k += 1) {
        const pts = outer.slice(k * 8, k * 8 + 9).concat(inner.slice(k * 8, k * 8 + 9));
        rects.push(bbox(pts));
      }
      const endH = norm360(pose.h + 90 * sgn);
      const e = mid[steps];
      const end = { x: r3(e.x), y: r3(e.y), h: endH };
      out.push({ index, type: "turn", dir: sgn > 0 ? "L" : "R", radius: Ri, start: pose, end, length: r3(L), s0: r3(s), s1: r3(s + L), center: { x: r3(c.x), y: r3(c.y) }, polygon, rects, samples });
      pose = end;
    }
    s += L;
  });
  return { modules: out, end: pose, total: r3(s) };
}

function bbox(pts) {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x: r3(x), y: r3(y), w: r3(Math.max(...xs) - x), d: r3(Math.max(...ys) - y) };
}

/** 이 층의 완화구간 길이. level 0 = 지상→B1 */
export function transitionsFor(legalStalls, level, roadAtTop) {
  const road = level === 0 && roadAtTop !== false;
  return {
    top: Math.max(road ? ROAD_GENTLE_LEN : 0, legalStalls >= 50 ? CREST_LEN : 0),
    bottom: legalStalls >= 100 ? SAG_LEN : 0,
    road,
  };
}

/**
 * 한 층 분량(sFrom~sTo 구간)을 내려가는 경사 배분.
 * 구간을 [윗부분 완화][본 경사][아랫부분 완화]로 나누고 모듈 경계와 겹쳐 조각을 만든다.
 * 조각마다 한도(직선 17%·곡선 14%, 완화 구간은 1/2)를 정하고, 한도 × 길이의 합(내려갈 수 있는 최대 높이)이
 * 층고 이상이면 모든 조각을 같은 비율(k = 층고 / 최대 높이)로 낮춘다 → 가장 완만하고 연속적인 경사.
 */
export function distributeLevel(chain, H, trans, sFrom = 0, sTo = chain.total) {
  const cuts = new Set([sFrom, sTo, sFrom + trans.top, sTo - trans.bottom]);
  chain.modules.forEach((m) => { if (m.s0 > sFrom && m.s0 < sTo) cuts.add(m.s0); });
  const xs = [...cuts].filter((v) => v >= sFrom - 1e-9 && v <= sTo + 1e-9).sort((a, b) => a - b);
  const pieces = [];
  for (let i = 0; i + 1 < xs.length; i += 1) {
    const a = xs[i];
    const b = xs[i + 1];
    if (b - a < 1e-6) continue;
    const mid = (a + b) / 2;
    const m = chain.modules.find((mm) => mid >= mm.s0 - 1e-9 && mid <= mm.s1 + 1e-9);
    const zone = mid < sFrom + trans.top ? "top" : mid > sTo - trans.bottom ? "bottom" : "main";
    const kind = m.type === "turn" ? "turn" : "straight";
    const limit = zone === "main" ? SLOPE_MAX[kind] : SLOPE_EASE[kind];
    pieces.push({ module: m.index, kind, zone, s0: r3(a), s1: r3(b), length: r3(b - a), limit });
  }
  const capacity = pieces.reduce((t, p) => t + p.length * p.limit, 0);
  const tooShort = sTo - sFrom < trans.top + trans.bottom;
  const ok = !tooShort && capacity >= H - 1e-6;
  const k = capacity > 0 ? Math.min(1, H / capacity) : Infinity;
  let h = 0;
  pieces.forEach((p) => {
    p.slope = ok ? p.limit * k : p.limit;   // 계산은 그대로, 표시할 때만 반올림
    p.pct = r1(p.slope * 100);
    p.h0 = r3(h);
    h += p.length * (ok ? p.limit * k : p.limit);
    p.h1 = r3(Math.min(h, H));
  });
  return { ok, capacity: r3(capacity), shortfall: ok ? 0 : r3(H - capacity), k: r3(k), pieces };
}

/** 모자란 높이를 채우는 제안: 직선을 늘리거나, 90° 회전을 더한다 */
export function suggestFix(ramp, shortfall) {
  if (!(shortfall > 0)) return null;
  const meters = Math.ceil((shortfall / SLOPE_MAX.straight) / SNAP) * SNAP;
  const arc = (Math.PI / 2) * ((ramp.innerRadius ?? 6) + ramp.width / 2);
  const turns = Math.ceil(shortfall / (arc * SLOPE_MAX.turn));
  return { addStraight: meters, addTurns: turns, text: `${meters}m 직선을 더하거나(본 경사 17%) 90° 회전 ${turns}개(14%)를 더하세요.` };
}

/**
 * 경사 계획 전체. 반환 levels[k] = 층별 경사 조각. 각 조각 slope/h0/h1(그 층 꼭대기에서 내려간 높이).
 * mode "repeat": 같은 사슬이 층마다 같은 자리에 겹친다(층마다 사슬 전체로 층고 하나).
 * mode "spiral": 사슬 첫 모듈(직선)은 층 착지부(평지, 옆으로 층에 연결), 나머지로 층고 하나. 층마다 한 바퀴.
 */
export function slopePlan(ramp, opts) {
  const H = opts.floorHeight;
  const legal = opts.legalStalls || 0;
  const chain = buildChain(ramp);
  const levels = [];
  const n = Math.max(1, ramp.levels || 1);
  const spiral = ramp.mode === "spiral";
  const landing = spiral ? chain.modules[0] : null;
  for (let k = 0; k < n; k += 1) {
    const trans = transitionsFor(legal, k, opts.roadAtTop);
    const from = spiral ? landing.s1 : 0;
    const res = distributeLevel(chain, H, trans, from, chain.total);
    levels.push({ level: k, name: k === 0 ? "지상→B1" : `B${k}→B${k + 1}`, trans, ...res, fix: suggestFix(ramp, res.shortfall) });
  }
  // 모듈별 최대 경사(1층 기준) — 평면 표시용
  const perModule = chain.modules.map((m) => {
    if (spiral && m.index === 0) return { module: 0, slope: 0, label: "착지 0%" };
    const ps = levels[levels.length > 1 ? 1 : 0].pieces.filter((p) => p.module === m.index);
    const ps0 = levels[0].pieces.filter((p) => p.module === m.index);
    const main = Math.max(0, ...ps0.map((p) => p.slope));
    // 회전 모듈은 안쪽 가장자리 경사도 같이 보여 준다(중심선 기준으로 판정, 안쪽은 Rc/Ri배 가파름)
    return { module: m.index, slope: main, slopeLower: Math.max(0, ...ps.map((p) => p.slope)), label: `${(main * 100).toFixed(1)}%` };
  });
  const closed = spiral ? Math.hypot(chain.end.x - ramp.x, chain.end.y - ramp.y) < 0.05 && Math.abs(norm360(chain.end.h - (ramp.heading || 0))) < 1e-3 : null;
  return { chain, levels, perModule, closed, ok: levels.every((l) => l.ok) && closed !== false };
}

// ── 평면과의 관계 ──

/** 다각형을 사각형으로 잘라 남은 넓이 (Sutherland–Hodgman, 사각형은 볼록이라 오목 다각형도 넓이는 맞다) */
export function clipArea(poly, r) {
  let pts = poly;
  const edges = [
    (p) => p.x >= r.x, (p) => p.x <= r.x + r.w, (p) => p.y >= r.y, (p) => p.y <= r.y + r.d,
  ];
  const cross = [
    (a, b) => { const t = (r.x - a.x) / (b.x - a.x); return { x: r.x, y: a.y + t * (b.y - a.y) }; },
    (a, b) => { const t = (r.x + r.w - a.x) / (b.x - a.x); return { x: r.x + r.w, y: a.y + t * (b.y - a.y) }; },
    (a, b) => { const t = (r.y - a.y) / (b.y - a.y); return { x: a.x + t * (b.x - a.x), y: r.y }; },
    (a, b) => { const t = (r.y + r.d - a.y) / (b.y - a.y); return { x: a.x + t * (b.x - a.x), y: r.y + r.d }; },
  ];
  for (let e = 0; e < 4 && pts.length; e += 1) {
    const next = [];
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ia = edges[e](a);
      const ib = edges[e](b);
      if (ia) next.push(a);
      if (ia !== ib) next.push(cross[e](a, b));
    }
    pts = next;
  }
  return Math.abs(polyArea(pts));
}
export function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i += 1) { const p = pts[i]; const q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
  return a / 2;
}
function clipRect(a, b) {
  const x = Math.max(a.x, b.x); const y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w); const y2 = Math.min(a.y + a.d, b.y + b.d);
  return x2 - x > 0.01 && y2 - y > 0.01 ? { x: r3(x), y: r3(y), w: r3(x2 - x), d: r3(y2 - y) } : null;
}
const plateRect = (p) => ({ x: 0, y: 0, w: p.width, d: p.depth });

/** 점이 평면 안인가 */
const inside = (p, plate, eps = 1e-6) => p.x > eps && p.y > eps && p.x < plate.width - eps && p.y < plate.depth - eps;

/** 평면 외벽 위의 점 → {edge, t} */
function edgeOfPoint(p, plate) {
  const d = { w: Math.abs(p.x), e: Math.abs(plate.width - p.x), s: Math.abs(p.y), n: Math.abs(plate.depth - p.y) };
  const edge = Object.keys(d).sort((a, b) => d[a] - d[b])[0];
  return { edge, t: r3(edge === "w" || edge === "e" ? p.y : p.x), dist: r3(d[edge]) };
}

/** 램프 양끝 6m 구역(진입·도착) */
function endZone(pose, width, forward) {
  const d = dirOf(pose.h);
  const sgn = forward ? 1 : -1;
  const a = { x: pose.x, y: pose.y };
  const b = { x: pose.x + d.x * ZONE * sgn, y: pose.y + d.y * ZONE * sgn };
  const n = { x: -d.y, y: d.x };
  const h = width / 2;
  return bbox([{ x: a.x + n.x * h, y: a.y + n.y * h }, { x: a.x - n.x * h, y: a.y - n.y * h }, { x: b.x + n.x * h, y: b.y + n.y * h }, { x: b.x - n.x * h, y: b.y - n.y * h }]);
}

/** 나선 착지부 옆 6m 구역: 평면 바닥 쪽(중심 반대편 또는 외벽 쪽) */
function sideZone(m, width, plate) {
  const d = dirOf(m.start.h);
  const n = { x: -d.y, y: d.x };
  const h = width / 2;
  const make = (sgn) => bbox([
    { x: m.start.x + n.x * h * sgn, y: m.start.y + n.y * h * sgn }, { x: m.end.x + n.x * h * sgn, y: m.end.y + n.y * h * sgn },
    { x: m.start.x + n.x * (h + ZONE) * sgn, y: m.start.y + n.y * (h + ZONE) * sgn }, { x: m.end.x + n.x * (h + ZONE) * sgn, y: m.end.y + n.y * (h + ZONE) * sgn },
  ]);
  const both = [make(1), make(-1)].map((z) => ({ z, a: (clipRect(z, plateRect(plate)) || { w: 0, d: 0 }).w * (clipRect(z, plateRect(plate)) || { w: 0, d: 0 }).d }));
  both.sort((a, b) => b.a - a.a);
  return both[0].z;
}

/**
 * 평면 분석: 안/밖/걸침, 외벽 연결점, 배치 엔진에 넘길 장애물(평면 안 부분) + 비워 둘 구역(양끝 6m).
 */
export function analyzeOnPlate(ramp, plate, opts = {}) {
  const chain = buildChain(ramp);
  const P = plateRect(plate);
  const total = chain.modules.reduce((t, m) => t + Math.abs(polyArea(m.polygon)), 0);
  const inArea = chain.modules.reduce((t, m) => t + clipArea(m.polygon, P), 0);
  const placement = inArea < 0.05 ? "external" : inArea > total - 0.05 ? "internal" : "mixed";
  // 중심선이 외벽을 지나는 점
  const crossings = [];
  const pts = chain.modules.flatMap((m) => m.samples);
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const a = pts[i]; const b = pts[i + 1];
    const ia = inside(a, plate); const ib = inside(b, plate);
    if (ia === ib) continue;
    let lo = 0; let hi = 1;
    for (let it = 0; it < 30; it += 1) { const t = (lo + hi) / 2; const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; if (inside(p, plate) === ia) lo = t; else hi = t; }
    const p = { x: a.x + (b.x - a.x) * lo, y: a.y + (b.y - a.y) * lo };
    crossings.push({ ...edgeOfPoint(p, plate), s: r3(a.s + (b.s - a.s) * lo), entering: !ia && ib, x: r3(p.x), y: r3(p.y) });
  }
  const block = [];
  chain.modules.forEach((m) => m.rects.forEach((r) => { const c = clipRect(r, P); if (c) block.push({ ...c, module: m.index }); }));
  const keepClear = [];
  const issues = [];
  const openings = [];
  const spiral = ramp.mode === "spiral";
  const start = chain.modules[0]?.start;
  const end = chain.end;
  if (spiral) {
    const landing = chain.modules[0];
    const z = sideZone(landing, ramp.width, plate);
    const c = clipRect(z, P);
    if (c) keepClear.push({ ...c, role: "landing" });
    if (placement !== "internal") {
      // 외부 나선: 착지부가 외벽에 붙어 있어야 층마다 연결된다
      const e = edgeOfPoint({ x: (landing.start.x + landing.end.x) / 2, y: (landing.start.y + landing.end.y) / 2 }, plate);
      const gap = r3(e.dist - ramp.width / 2);
      if (Math.abs(gap) > 0.6) issues.push({ level: "error", text: `나선 착지부가 외벽에서 ${gap}m 떨어져 있습니다. 외벽에 붙이세요.` });
      else openings.push({ edge: e.edge, t: e.t, width: r3(landing.length), role: "landing" });
    }
  } else {
    // 윗부분(진입): 평면 안이면 뒤쪽 6m, 아래층 진입용
    if (inside(start, plate)) {
      const z = clipRect(endZone(start, ramp.width, false), P);
      if (z) keepClear.push({ ...z, role: "top" });
      if (!z || z.w * z.d < ramp.width * ZONE * 0.9) issues.push({ level: "error", text: "램프 시작점 뒤 6m(아래층에서 램프로 들어가는 자리)가 평면 밖으로 나갑니다." });
    }
    if (inside(end, plate, 0.3)) {
      const z = clipRect(endZone(end, ramp.width, true), P);
      if (z) keepClear.push({ ...z, role: "arrival" });
      if (!z || z.w * z.d < ramp.width * ZONE * 0.9) issues.push({ level: "error", text: "램프 끝 앞 6m(도착 구역)가 평면 밖으로 나갑니다." });
    } else {
      const e = edgeOfPoint(end, plate);
      const inward = { w: 0, e: 180, s: 90, n: 270 }[e.edge];
      if (e.dist > 0.6) issues.push({ level: "error", text: `램프 끝이 평면 외벽에서 ${e.dist}m 떨어져 있습니다. 외벽에 닿게 하세요.` });
      else if (Math.abs(norm360(end.h - inward)) > 1e-3) issues.push({ level: "error", text: "램프 끝이 외벽을 향하지 않습니다(외벽에 직각으로 들어와야 합니다)." });
      const z = clipRect(endZone({ ...end, x: e.edge === "w" ? 0 : e.edge === "e" ? plate.width : end.x, y: e.edge === "s" ? 0 : e.edge === "n" ? plate.depth : end.y }, ramp.width, true), P);
      if (z) keepClear.push({ ...z, role: "arrival" });
    }
    crossings.filter((c) => c.entering).forEach((c) => openings.push({ edge: c.edge, t: c.t, width: ramp.width, s: c.s, role: "wall" }));
    if (!crossings.length && placement === "external") {
      const e = edgeOfPoint(end, plate);
      openings.push({ edge: e.edge, t: e.t, width: ramp.width, role: "wall" });
    }
  }
  // 폭·반경
  const min = minimums(opts.legalStalls || 0);
  const hasTurn = chain.modules.some((m) => m.type === "turn");
  if (ramp.width < min.straightWidth - 1e-6) issues.push({ level: "error", text: `램프 폭 ${ramp.width}m < 직선 최소 ${min.straightWidth}m.` });
  if (hasTurn && ramp.width < min.turnWidth - 1e-6) issues.push({ level: "error", text: `회전 모듈이 있어 폭 ${min.turnWidth}m 이상이어야 합니다(지금 ${ramp.width}m).` });
  chain.modules.filter((m) => m.type === "turn" && m.radius < min.innerRadius - 1e-6).forEach((m) => issues.push({ level: "error", module: m.index, text: `${m.index + 1}번 회전 모듈 내변반경 ${m.radius}m < ${min.innerRadius}m.` }));
  // 같은 층 안 자기 겹침(이웃 모듈 제외)
  for (let i = 0; i < chain.modules.length; i += 1) for (let j = i + 2; j < chain.modules.length; j += 1) {
    const a = chain.modules[i]; const b = chain.modules[j];
    if (spiral && i === 0 && j === chain.modules.length - 1) continue;
    const ov = polyOverlap(a.polygon, b.polygon);
    if (ov > 0.2) issues.push({ level: "error", text: `${i + 1}번과 ${j + 1}번 모듈이 같은 층에서 겹칩니다(${r1(ov)}㎡).` });
  }
  // 코어·동과 겹침
  (opts.blocks || []).forEach((b, bi) => {
    const ov = chain.modules.reduce((t, m) => t + clipArea(m.polygon, b), 0);
    if (ov > 0.05) issues.push({ level: "error", text: `${josa(b.name || `코어 ${bi + 1}`, "과", "와")} 램프가 ${r1(ov)}㎡ 겹칩니다.` });
    keepClear.forEach((z) => { const c = clipRect(z, b); if (c) issues.push({ level: "error", text: `${josa(b.name || `코어 ${bi + 1}`, "이", "가")} 램프 ${z.role === "arrival" ? "도착" : z.role === "top" ? "진입" : "착지"} 구역(6m)을 막습니다.` }); });
  });
  return { chain, placement, insideArea: r1(inArea), totalArea: r1(total), crossings, openings, block, keepClear, issues };
}

/** 두 다각형 겹침 넓이(격자 표본, 0.25m) — 프로토타입 검사용 */
function polyOverlap(a, b) {
  const A = bbox(a); const B = bbox(b);
  const box = clipRect(A, B);
  if (!box) return 0;
  const step = 0.25;
  let hits = 0;
  for (let x = box.x + step / 2; x < box.x + box.w; x += step) for (let y = box.y + step / 2; y < box.y + box.d; y += step) {
    if (pip({ x, y }, a) && pip({ x, y }, b)) hits += 1;
  }
  return hits * step * step;
}
function pip(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i]; const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** 받침 있으면 a, 없으면 b (동·코어 이름 뒤 조사) */
function josa(word, a, b) {
  const ch = String(word).trim().slice(-1).charCodeAt(0);
  if (ch >= 0xac00 && ch <= 0xd7a3) return word + (((ch - 0xac00) % 28) ? a : b);
  return word + (/[013678]$/.test(String(word)) ? a : b);
}

// ── 편집 ──
/** type: "straight"|"turn". dir: "L"|"R"(회전). afterIndex: 이 모듈 뒤에 삽입(없으면 끝). */
export function addModule(ramp, type, dir, afterIndex = null) {
  const m = type === "straight"
    ? { type: "straight", length: 6 }
    : { type: "turn", dir: dir || "L", radius: ramp.innerRadius ?? 6 };
  const list = [...(ramp.modules || [])];
  const at = afterIndex == null || afterIndex < 0 || afterIndex >= list.length
    ? list.length
    : afterIndex + 1;
  list.splice(at, 0, m);
  return { ...ramp, modules: list };
}
export function removeModule(ramp, index) {
  const list = ramp.modules || [];
  if (list.length <= 1) return ramp; // 마지막 모듈은 지우지 않음
  return { ...ramp, modules: list.filter((_, i) => i !== index) };
}
export function setLength(ramp, index, length) {
  return { ...ramp, modules: ramp.modules.map((m, i) => (i === index && m.type === "straight" ? { ...m, length: Math.max(SNAP, snap(length)) } : m)) };
}
export function moveRamp(ramp, x, y) { return { ...ramp, x: snap(x), y: snap(y) }; }
export function rotateRamp(ramp, quarter = 1) { return { ...ramp, heading: norm360((ramp.heading || 0) + 90 * quarter) }; }

/** 자동 맞춤: 모자라면 가장 긴 직선(나선이면 착지부 제외)을 늘린다 */
export function autoFit(ramp, opts) {
  const plan = slopePlan(ramp, opts);
  const worst = Math.max(...plan.levels.map((l) => l.shortfall));
  if (!(worst > 0)) return { ramp, changed: false, plan };
  const fix = suggestFix(ramp, worst);
  const start = ramp.mode === "spiral" ? 1 : 0;
  let best = -1;
  ramp.modules.forEach((m, i) => { if (i >= start && m.type === "straight" && (best < 0 || m.length > ramp.modules[best].length)) best = i; });
  const next = best >= 0 ? setLength(ramp, best, ramp.modules[best].length + fix.addStraight)
    : { ...ramp, modules: [...ramp.modules, { type: "straight", length: fix.addStraight }] };
  return { ramp: next, changed: true, fix, plan: slopePlan(next, opts) };
}

/** 사각형이 eps 안에서 같은지 */
export function rectsClose(a, b, eps = 0.05) {
  if (!a || !b) return false;
  return Math.abs(a.x - b.x) <= eps
    && Math.abs(a.y - b.y) <= eps
    && Math.abs(a.w - b.w) <= eps
    && Math.abs(a.d - b.d) <= eps;
}

/**
 * 사슬이 legacy를 다시 migrate한 결과와 같으면 true.
 * shape는 곡선 옮기기용(없으면 직선으로만 비교).
 */
export function isLegacyEquivalent(ramp, plate, shape = null) {
  if (!ramp?.legacy || !plate) return false;
  if (!Array.isArray(ramp.modules) || !ramp.modules.length) return false;
  try {
    const fresh = migrateLegacy(ramp.legacy, plate, shape);
    const a = buildChain(ramp);
    const b = buildChain(fresh);
    if (a.modules.length !== b.modules.length) return false;
    if (Math.abs(a.total - b.total) > 0.1) return false;
    return a.modules.every((m, i) => {
      const o = b.modules[i];
      if (m.type !== o.type) return false;
      return (m.rects || []).every((r, j) => rectsClose(r, o.rects[j], 0.05));
    });
  } catch (e) {
    return false;
  }
}

/** 모듈 사슬 경로를 엔진·3D에 쓸지(예전과 다르거나 legacy가 없을 때). */
export function usesModuleLayout(ramp, plate, shape = null) {
  if (!ramp || !Array.isArray(ramp.modules) || !ramp.modules.length) return false;
  if (!ramp.legacy) return true;
  return !isLegacyEquivalent(ramp, plate, shape);
}

/** analyzeOnPlate 결과로 edge/t/placement를 맞춘다. mixed는 엔진용 internal + mixed 표시. */
export function applyPlateMeta(ramp, plate, opts = {}) {
  const site = analyzeOnPlate(ramp, plate, opts);
  let placement = site.placement;
  let mixed = false;
  if (placement === "mixed") {
    mixed = true;
    placement = "internal";
  }
  const open = site.openings && site.openings[0];
  const next = {
    ...ramp,
    placement,
    mixed: mixed || undefined,
    edge: open?.edge != null ? open.edge : (ramp.edge ?? ramp.legacy?.edge),
    t: open?.t != null ? open.t : (ramp.t ?? ramp.legacy?.t),
  };
  if (next.t != null) next.t = r3(next.t);
  return { ramp: next, site };
}

/**
 * 예전 램프({edge,t,width,length,placement})를 모듈 사슬로 바꾼다.
 * 외부형: 외벽 밖에서 시작해 외벽으로 들어오는 직선 하나. 내부형 직선: 외벽에서 inset 안쪽에서 시작.
 * 내부형 곡선(rampShape kind=curved)은 shape.segments·turn을 받아 [직선, 회전, 직선]으로.
 */
export function migrateLegacy(old, plate, shape) {
  const inward = { w: 0, e: 180, s: 90, n: 270 }[old.edge];
  const external = (old.placement || "internal") === "external";
  const k = external ? -old.length : (old.inset ?? old.offset ?? 11.2);
  const at = (v) => (old.edge === "w" ? { x: v, y: old.t } : old.edge === "e" ? { x: plate.width - v, y: old.t } : old.edge === "s" ? { x: old.t, y: v } : { x: old.t, y: plate.depth - v });
  const p = at(k);
  const base = { id: old.id, x: r3(p.x), y: r3(p.y), heading: inward, width: old.width, innerRadius: 6, levels: 1, mode: "repeat", legacy: { ...old } };
  if (shape && shape.kind === "curved" && shape.path && shape.path.length > 2) {
    // 첫 직선 = 곡선 시작 전까지, 곡선 뒤 직선 = 나머지
    const s1 = shape.segments.filter((g) => g.name !== "곡선" && g.name !== "곡선 뒤 직선" && !(g.name.includes("오목"))).reduce((t, g) => t + g.length, 0);
    const after = shape.segments.filter((g) => g.name === "곡선 뒤 직선" || g.name.includes("오목")).reduce((t, g) => t + g.length, 0);
    // 회전 방향: turn(sgn) > 0 이면 변 좌표 u 증가 쪽 → 진행 방향 기준 좌/우는 변마다 다르다
    const leftIsUp = { s: false, w: true, n: true, e: false }[old.edge];
    const dir = (shape.turn > 0) === leftIsUp ? "L" : "R";
    return { ...base, width: Math.max(old.width, 6.5), modules: [{ type: "straight", length: r1(s1) }, { type: "turn", dir, radius: 6 }, { type: "straight", length: r1(after) }] };
  }
  return { ...base, modules: [{ type: "straight", length: old.length }] };
}

/**
 * 3D 메시 자료(three.js BufferGeometry에 그대로 넣을 수 있는 삼각형 좌표). y=높이.
 * level k 꼭대기 높이 = top - k*H. 조각 경사 h0/h1을 따라 표본점마다 높이를 준다.
 * 반환 { surface: Float32 좌표 배열, walls: [...], curbs: [...] }
 */
export function rampMesh(ramp, plan, opts) {
  const H = opts.floorHeight;
  const top = opts.groundY ?? 0;
  const half = ramp.width / 2;
  const surface = []; const walls = []; const curbs = [];
  const spiral = ramp.mode === "spiral";
  plan.levels.forEach((lv, k) => {
    const base = top - k * H;
    const hAt = (s) => {
      if (spiral && s <= plan.chain.modules[0].s1 + 1e-9) return 0;
      const p = lv.pieces.find((pp) => s >= pp.s0 - 1e-9 && s <= pp.s1 + 1e-9) || lv.pieces[lv.pieces.length - 1];
      return p.h0 + (p.slope * (s - p.s0));
    };
    const pts = plan.chain.modules.flatMap((m, i) => (i ? m.samples.slice(1) : m.samples));
    // 착지부(나선)는 그 층 바닥 높이
    const rows = pts.map((p) => {
      const nx = -p.ty; const ny = p.tx;
      const y = base - Math.min(H, hAt(p.s));
      return { l: [p.x + nx * half, y, p.y + ny * half], r: [p.x - nx * half, y, p.y - ny * half], y };
    });
    for (let i = 0; i + 1 < rows.length; i += 1) {
      const a = rows[i]; const b = rows[i + 1];
      surface.push(...a.l, ...a.r, ...b.r, ...a.l, ...b.r, ...b.l);
      const up = (v, d) => [v[0], v[1] + d, v[2]];
      // 나선 착지부는 옆으로 층에 이어지므로 벽을 세우지 않는다
      if (spiral && pts[i + 1].s <= plan.chain.modules[0].s1 + 1e-9) continue;
      walls.push(...a.l, ...b.l, ...up(b.l, 0.9), ...a.l, ...up(b.l, 0.9), ...up(a.l, 0.9));
      walls.push(...a.r, ...b.r, ...up(b.r, 0.9), ...a.r, ...up(b.r, 0.9), ...up(a.r, 0.9));
      curbs.push(...up(a.l, 0.15), ...up(b.l, 0.15), ...up(b.r, 0.15), ...up(a.r, 0.15));
    }
  });
  return { surface, walls, curbs };
}
