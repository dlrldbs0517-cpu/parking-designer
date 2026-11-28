// 주차장 외곽 그리기: 점을 찍고 선을 이어 다각형을 만든다.
// - 클릭 = 점, 직교(F8) 켜면 가로·세로로만, Shift = 잠깐 반대로
// - 점·대지 꼭짓점 근처에 붙음(끝점 스냅), 첫 점과 가로·세로가 맞으면 붙음
// - 숫자 입력 + Enter = 마우스 방향으로 그 길이만큼(직접 거리 입력)
//   "@dx,dy" = 마지막 점에서 상대 좌표, "@길이<각도" = 극좌표(동 0°, 반시계), "x,y" = 절대 좌표
//   "c" 또는 빈 Enter(점 3개 이상) = 닫기, "u" = 되돌리기
// - 그린 뒤에는 꼭짓점을 끌어서 고칠 수 있음
// 좌표: m, 동 +x, 북 +y. 대지가 있으면 대지 조회 지점 기준, 없으면 임의 원점.
// 화면: 대지 주소를 조회했으면 지도 위에(api = context.mapDrawApi()), 아니면 격자 도면판에 그린다.
import { localizer, outerRings } from "./zoning.js?v=365";
import { outlineProblem as baseProblem, polygonArea } from "./outline.js?v=365";
// 외부 검사(예: 변 6m 이상)를 더할 수 있음 — openSketch({ validate })
const outlineProblem = (pts) => baseProblem(pts) || (S.validate ? S.validate(pts) || "" : "");

const $ = (id) => document.getElementById(id);
const S = {
  open: false, pts: [], closed: false, hover: null, ortho: false,
  view: { x: -40, y: -40, w: 80, h: 80 }, site: [], center: null, onDone: null, dragIdx: -1, api: null,
  mode: "draw", ramp: null, rampW: 6,   // 램프 시작점: { p: [x, y] } — 외곽 안 아무 데나
};

const r2 = (v) => Math.round(v * 100) / 100;
const snap01 = (v) => Math.round(v * 10) / 10;
const fmt = (v) => (Math.round(v * 100) / 100).toString();

function svgEl() { return $("sketch-svg"); }
function scaleOf() {
  const r = svgEl().getBoundingClientRect();
  return Math.min(r.width / S.view.w, r.height / S.view.h) || 1;
}
// 화면 좌표 ↔ m. 지도 위면 지도에서, 아니면 도면판 보기(S.view)에서.
function W(e) { return S.api ? S.api.toMeters(e) : toWorld(e); }
function scr(p) { return S.api ? S.api.toScreen(p) : [p[0], -p[1]]; }
function mpp() { return S.api ? S.api.metersPerPixel() : 1 / scaleOf(); }   // 화면 1px = 몇 m
function U() { return S.api ? 1 : 1 / scaleOf(); }                           // 화면 1px = SVG 몇 단위
function drawSvg() { return S.api ? S.api.svg : svgEl(); }
function toWorld(e) {
  const svg = svgEl();
  const r = svg.getBoundingClientRect();
  const s = scaleOf();
  const ox = (r.width - S.view.w * s) / 2;
  const oy = (r.height - S.view.h * s) / 2;
  const sx = S.view.x + (e.clientX - r.left - ox) / s;
  const sy = S.view.y + (e.clientY - r.top - oy) / s;
  return [sx, -sy];
}

// 스냅: 끝점(그린 점·대지 꼭짓점) → 직교 → 첫 점 정렬 → 0.1m
function snapPoint(raw, shift, exclude = -1) {
  const tol = 10 * mpp();
  const cands = S.pts.filter((_, i) => i !== exclude).concat(S.site.flat());
  let best = null; let bd = tol;
  cands.forEach((p) => { const d = Math.hypot(p[0] - raw[0], p[1] - raw[1]); if (d < bd) { bd = d; best = p; } });
  if (best) return { p: [r2(best[0]), r2(best[1])], kind: "끝점" };
  let [x, y] = raw;
  const ortho = S.ortho !== !!shift;
  const base = exclude >= 0 ? null : S.pts[S.pts.length - 1];
  if (ortho && base && !S.closed) {
    if (Math.abs(x - base[0]) > Math.abs(y - base[1])) y = base[1]; else x = base[0];
  }
  x = snap01(x); y = snap01(y);
  if (base) { x = base[0] + snap01(x - base[0]); y = base[1] + snap01(y - base[1]); if (ortho) { if (Math.abs(x - base[0]) > Math.abs(y - base[1])) y = base[1]; else x = base[0]; } }
  let kind = "";
  // 꼭짓점 끌기: 직교면 이웃 꼭짓점과 가로·세로를 맞춤
  if (exclude >= 0 && ortho) {
    const n = S.pts.length;
    [S.pts[(exclude + n - 1) % n], S.pts[(exclude + 1) % n]].forEach((nb) => {
      if (Math.abs(x - nb[0]) < tol) { x = nb[0]; kind = "세로 맞춤"; }
      if (Math.abs(y - nb[1]) < tol) { y = nb[1]; kind = "가로 맞춤"; }
    });
  }
  const first = S.pts[0];
  if (first && S.pts.length >= 2 && !S.closed) {
    if (Math.abs(x - first[0]) < tol && y !== base[1]) { x = first[0]; kind = "첫 점 세로 정렬"; }
    else if (Math.abs(y - first[1]) < tol && x !== base[0]) { y = first[1]; kind = "첫 점 가로 정렬"; }
  }
  return { p: [r2(x), r2(y)], kind };
}

// ── 램프 시작점 ──
// 엔진은 내부 램프를 감싸는 사각형 바깥 변의 양 끝·가운데에만 둔다 → 클릭한 자리에서 가장 가까운 변과 세 자리 중 가까운 곳으로.
function bboxPts(pts) {
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
function sideSegments() {
  const b = bboxPts(S.pts);
  const out = [];
  S.pts.forEach((p, i) => {
    const q = S.pts[(i + 1) % S.pts.length];
    const on = (v, w) => Math.abs(v - w) < 0.02;
    if (on(p[1], b.y0) && on(q[1], b.y0)) out.push({ edge: "s", lo: Math.min(p[0], q[0]), hi: Math.max(p[0], q[0]) });
    if (on(p[1], b.y1) && on(q[1], b.y1)) out.push({ edge: "n", lo: Math.min(p[0], q[0]), hi: Math.max(p[0], q[0]) });
    if (on(p[0], b.x0) && on(q[0], b.x0)) out.push({ edge: "w", lo: Math.min(p[1], q[1]), hi: Math.max(p[1], q[1]) });
    if (on(p[0], b.x1) && on(q[0], b.x1)) out.push({ edge: "e", lo: Math.min(p[1], q[1]), hi: Math.max(p[1], q[1]) });
  });
  return { b, segs: out };
}
// 램프 표시용 자리(변 방향 좌표 at = 램프 가운데)
function rampAt(r) {
  const { b } = sideSegments();
  const horiz = r.edge === "s" || r.edge === "n";
  const lo = horiz ? b.x0 : b.y0; const hi = horiz ? b.x1 : b.y1;
  const h = S.rampW / 2;
  return r.pos === "mid" ? (lo + hi) / 2 : r.pos === "end" ? hi - h : lo + h;
}
// 램프 시작점 p(외곽 안 아무 데나) → 가장 가까운 감싸는 사각형 변(edge), 그 변을 따른 위치 t(감싸는 사각형 왼쪽/아래 기준),
// 그 벽에서 떨어진 거리 offset(벽 가까이면 null = 기본 자리). 램프는 그 벽에서 안쪽으로 내려간다.
const RAMP_FREE = 12;
// dir = 램프가 내려가는 방향(n·s·e·w). 없으면 가장 가까운 벽에서 안쪽으로.
// 엔진은 램프를 '벽(edge)에서 안쪽으로' 두므로, 방향의 반대쪽 벽을 기준으로 t(벽을 따른 위치)와 offset(그 벽에서 떨어진 거리)을 계산.
const EDGE_OF_DIR = { n: "s", s: "n", e: "w", w: "e" };
const DIR_OF_EDGE = { s: "n", n: "s", w: "e", e: "w" };
function nearestEdge(p) {
  const { b } = sideSegments();
  return [["s", p[1] - b.y0], ["n", b.y1 - p[1]], ["w", p[0] - b.x0], ["e", b.x1 - p[0]]].sort((u, v) => u[1] - v[1])[0][0];
}
function rampSpec(p, dir = null) {
  const { b } = sideSegments();
  const edge = dir ? EDGE_OF_DIR[dir] : nearestEdge(p);
  const horiz = edge === "s" || edge === "n";
  const along = horiz ? p[0] - b.x0 : p[1] - b.y0;
  const dist = edge === "s" ? p[1] - b.y0 : edge === "n" ? b.y1 - p[1] : edge === "w" ? p[0] - b.x0 : b.x1 - p[0];
  const len = horiz ? b.x1 - b.x0 : b.y1 - b.y0;
  const t = Math.round(Math.min(len - S.rampW / 2, Math.max(S.rampW / 2, along)) * 10) / 10;
  const d = Math.round(Math.max(0, dist) * 10) / 10;
  // 벽에서 12m 안쪽(벽 줄 칸 + 순환 차로)까지는 '벽 쪽 기본 자리'로 — 그보다 안쪽이면 벽에서 떨어진 램프(층간 램프로 봄)
  return { edge, t, offset: d < RAMP_FREE ? null : d };
}
const DIR_KO = { n: "북쪽(↑)", s: "남쪽(↓)", e: "동쪽(→)", w: "서쪽(←)" };
function curSpec() { return S.ramp ? rampSpec(S.ramp.p, S.ramp.dir) : null; }
function setRampDir(dir) {
  if (!S.ramp) { flash("먼저 램프 시작점을 클릭하세요."); return; }
  S.ramp.dir = dir;
  S.ramp.aim = false;
  S.ramp.tip = null;
  render();
}
function rotateRampDir() {
  if (!S.ramp) { flash("먼저 램프 시작점을 클릭하세요."); return; }
  const order = ["n", "e", "s", "w"];
  const cur = S.ramp.dir || DIR_OF_EDGE[nearestEdge(S.ramp.p)];
  S.ramp.dir = order[(order.indexOf(cur) + 1) % 4];
  S.ramp.aim = false;
  S.ramp.tip = null;
  render();
}
// 램프 표시: 시작점에서 벽 반대쪽(안쪽)으로 화살표
function rampArrow(spec) {
  const { b } = sideSegments();
  const dir = { s: [0, 1], n: [0, -1], w: [1, 0], e: [-1, 0] }[spec.edge];
  const base = spec.edge === "s" ? [b.x0 + spec.t, b.y0] : spec.edge === "n" ? [b.x0 + spec.t, b.y1] : spec.edge === "w" ? [b.x0, b.y0 + spec.t] : [b.x1, b.y0 + spec.t];
  // 실제 램프 시작: 벽 쪽이면 벽 줄 칸·순환 차로 뒤(약 11.5m), 떨어뜨렸으면 그 거리
  const off = spec.offset != null ? spec.offset : WALL_START;
  const start = [base[0] + dir[0] * off, base[1] + dir[1] * off];
  const L = S.rampLen || 20;   // 길이는 층고·법정 경사로 자동 계산한 값
  return { start, end: [start[0] + dir[0] * L, start[1] + dir[1] * L], dir, L };
}
const WALL_START = 11.5;
// 램프가 차지하는 자리(폭 × 길이)
function rampFootprintPts(spec) {
  const ar = rampArrow(spec);
  const [ux, uy] = ar.dir; const nx = -uy; const ny = ux; const h = S.rampW / 2;
  const [sx, sy] = ar.start; const [ex, ey] = ar.end;
  return [[sx + nx * h, sy + ny * h], [ex + nx * h, ey + ny * h], [ex - nx * h, ey - ny * h], [sx - nx * h, sy - ny * h]];
}
function pickRamp(p) {
  // 외곽 선 위·바로 바깥(10px)까지는 받아 줌(방향 확정 클릭은 어디든)
  if (!(S.ramp && S.ramp.aim) && !insidePoly(p, S.pts) && distToPoly(p, S.pts) > 10 * mpp()) { flash("램프 시작점은 외곽 안을 클릭하세요.", 3000); render(); return; }
  if (S.ramp && S.ramp.aim) { S.ramp.aim = false; render(); return; }   // 두 번째 클릭 = 방향 확정
  S.ramp = { p: [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10], dir: null, aim: true };
  render();
}
function distToPoly(p, pts) {
  let best = Infinity;
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0]; const dy = b[1] - a[1]; const L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  });
  return best;
}
function insidePoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]; const [xj, yj] = pts[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// 넘겨줄 램프: 엔진용(edge·t·offset) + 화면용(찍은 점 p, 감싸는 사각형 왼쪽 아래 기준, 방향 dir)
function rampOut() {
  const { b } = sideSegments();
  const dir = S.ramp.dir || DIR_OF_EDGE[nearestEdge(S.ramp.p)];
  const rel = (q) => [Math.round((q[0] - b.x0) * 10) / 10, Math.round((q[1] - b.y0) * 10) / 10];
  return { ...rampSpec(S.ramp.p, dir), p: rel(S.ramp.p), tip: S.ramp.tip ? rel(S.ramp.tip) : null, dir };
}
function rampTextShort() {
  const dir = S.ramp.dir || DIR_OF_EDGE[nearestEdge(S.ramp.p)];
  return `시작점 찍음 · 방향 ${DIR_KO[dir]}`;
}
function rampText(spec) {
  const horiz = spec.edge === "s" || spec.edge === "n";
  return `${DIR_KO[DIR_OF_EDGE[spec.edge]]}으로 내려감(길이 ${(S.rampLen || 0).toFixed(1)}m 자동) · ${EDGE_KO[spec.edge]} 벽 · ${horiz ? "왼쪽" : "아래쪽"}에서 ${spec.t}m${spec.offset ? ` · 벽에서 ${spec.offset}m 안쪽(도로와 바로 안 이어져 층간 램프로 봄 — 배치가 끊길 수 있음)` : " · 벽 쪽(도로에서 바로 진입)"}`;
}
const EDGE_KO = { s: "남측", n: "북측", w: "서측", e: "동측" };
const POS_KO = (edge, pos) => ({ start: edge === "s" || edge === "n" ? "왼쪽 끝" : "아래쪽 끝", mid: "가운데", end: edge === "s" || edge === "n" ? "오른쪽 끝" : "위쪽 끝" })[pos];

// 지금 명령줄에 넣을 값이 무엇인지(마우스 옆 입력 상자 이름)
function dynLabel() {
  if (S.mode === "rect") return !S.rectA ? "첫 모서리 x,y" : S.rectW == null ? "가로(m)" : "세로(m)";
  if (S.mode === "ramp" || S.closed) return null;
  return S.pts.length ? "길이(m)" : "첫 점 x,y";
}
function polyPts(pts) { return pts.map((p) => scr(p).join(",")).join(" "); }

function render() {
  if (!S.open) return;
  const svg = drawSvg();
  let html = "";
  if (S.api) {
    const { w, h } = S.api.size();
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
  } else {
    // 보기 비율을 화면 비율에 맞춤(격자가 화면 전체에 깔리도록)
    const rr = svg.getBoundingClientRect();
    if (rr.width > 0 && rr.height > 0) {
      const want = S.view.w * (rr.height / rr.width);
      if (Math.abs(want - S.view.h) > 1e-6) {
        if (want >= S.view.h) { S.view.y -= (want - S.view.h) / 2; S.view.h = want; }
        else { const w2 = S.view.h * (rr.width / rr.height); S.view.x -= (w2 - S.view.w) / 2; S.view.w = w2; }
      }
    }
    const v = S.view;
    svg.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
    const s = scaleOf();
    const px = 1 / s;
    // 격자: 화면에서 12px 이상 되는 간격
    const steps = [0.5, 1, 2, 5, 10, 20, 50, 100];
    const minor = steps.find((g) => g * s >= 12) || 100;
    const major = steps.find((g) => g >= minor * 5) || minor * 5;
    let grid = "";
    const x0 = Math.floor(v.x / minor) * minor; const x1 = v.x + v.w;
    const y0 = Math.floor(v.y / minor) * minor; const y1 = v.y + v.h;
    for (let x = x0; x <= x1; x += minor) grid += `<line x1="${x}" y1="${v.y}" x2="${x}" y2="${y1}" class="${Math.abs(x / major - Math.round(x / major)) < 1e-6 ? "sk-major" : "sk-minor"}"/>`;
    for (let y = y0; y <= y1; y += minor) grid += `<line x1="${v.x}" y1="${y}" x2="${x1}" y2="${y}" class="${Math.abs(y / major - Math.round(y / major)) < 1e-6 ? "sk-major" : "sk-minor"}"/>`;
    html += `<g style="stroke-width:${px}">${grid}</g>`;
    html += `<line x1="0" y1="${v.y}" x2="0" y2="${y1}" class="sk-axis" style="stroke-width:${px}"/><line x1="${v.x}" y1="0" x2="${x1}" y2="0" class="sk-axis" style="stroke-width:${px}"/>`;
    // 대지(지도 위에서는 지도에 이미 있음)
    S.site.forEach((ring) => { html += `<polygon points="${polyPts(ring)}" class="sk-site" style="stroke-width:${2 * px}"/>`; });
  }
  const u = U();
  // 그린 것
  const live = S.pts.concat(!S.closed && S.hover && S.pts.length ? [S.hover.p] : []);
  if (S.closed && S.pts.length >= 3) html += `<polygon points="${polyPts(S.pts)}" class="sk-poly" style="stroke-width:${2.5 * u}"/>`;
  else if (live.length >= 2) {
    html += `<polyline points="${polyPts(live)}" class="sk-line" style="stroke-width:${2.5 * u}"/>`;
    // 지금 긋는 선(마지막 점 → 마우스)을 깜빡이게
    if (S.hover && S.pts.length && S.mode === "draw") html += `<polyline points="${polyPts([S.pts[S.pts.length - 1], S.hover.p])}" class="sk-active" style="stroke-width:${4 * u}"/>`;
  }
  // 변 길이(화면 좌표에서 바깥쪽으로 띄움)
  const segs = S.closed ? S.pts.map((p, i) => [p, S.pts[(i + 1) % S.pts.length]]) : live.slice(1).map((p, i) => [live[i], p]);
  const fs = 11 * u;
  segs.forEach(([a, b]) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.05) return;
    const A = scr(a); const B = scr(b);
    const sl = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
    const nx = (B[1] - A[1]) / sl; const ny = -(B[0] - A[0]) / sl;
    html += `<text x="${(A[0] + B[0]) / 2 + nx * 9 * u}" y="${(A[1] + B[1]) / 2 + ny * 9 * u}" class="sk-len" style="font-size:${fs}px" text-anchor="middle" dominant-baseline="middle">${len.toFixed(2).replace(/\.?0+$/, "")}</text>`;
  });
  S.pts.forEach((p, i) => { const [x, y] = scr(p); html += `<rect x="${x - 3.5 * u}" y="${y - 3.5 * u}" width="${7 * u}" height="${7 * u}" class="sk-pt${i === 0 ? " first" : ""}${i === S.dragIdx ? " drag" : ""}" style="stroke-width:${u}"/>`; });
  // 직사각형 미리보기
  if (S.mode === "rect" && S.rectA) {
    const a = S.rectA; let b = S.hover ? S.hover.p : a;
    if (S.rectW != null) b = [a[0] + (b[0] < a[0] ? -1 : 1) * S.rectW, b[1]];   // 가로를 넣었으면 고정
    const rp = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];
    html += `<polygon points="${polyPts(rp)}" class="sk-poly" style="stroke-width:${2.5 * u};stroke-dasharray:${6 * u} ${4 * u}"/>`;
    const wv = Math.abs(b[0] - a[0]); const hv = Math.abs(b[1] - a[1]);
    const [lx, ly] = scr([(a[0] + b[0]) / 2, Math.max(a[1], b[1])]);
    html += `<text x="${lx}" y="${ly - 8 * u}" class="sk-len" style="font-size:${fs}px" text-anchor="middle">${wv.toFixed(1)} × ${hv.toFixed(1)}m</text>`;
    const [ax, ay] = scr(a);
    html += `<rect x="${ax - 3.5 * u}" y="${ay - 3.5 * u}" width="${7 * u}" height="${7 * u}" class="sk-pt first" style="stroke-width:${u}"/>`;
    // 지금 입력하는 변(가로 → 세로)을 깜빡이는 굵은 선으로
    const edge = S.rectW == null ? [a, [b[0], a[1]]] : [[b[0], a[1]], b];
    html += `<polyline points="${polyPts(edge)}" class="sk-active" style="stroke-width:${5 * u}"/>`;
  }
  // 램프 시작점: 찍은 자리에 빨간 원 + 방향만 알려 주는 짧은 화살표(길이·실제 크기는 평면에서 계산)
  if (S.closed && S.ramp && S.pts.length >= 3) {
    const dir = S.ramp.dir || DIR_OF_EDGE[nearestEdge(S.ramp.p)];
    const v = { n: [0, 1], s: [0, -1], e: [1, 0], w: [-1, 0] }[dir];
    const [cx, cy] = scr(S.ramp.p);
    const [tx, ty] = scr([S.ramp.p[0] + v[0], S.ramp.p[1] + v[1]]);
    const sl = Math.hypot(tx - cx, ty - cy) || 1;
    // 화살표 끝: 방향을 찍은 자리(없으면 화면 42px). 램프 길이와는 상관없음
    let ex; let ey;
    const tip = S.ramp.tip && (S.ramp.dir || "") ? scr(S.ramp.tip) : null;
    if (tip && Math.hypot(tip[0] - cx, tip[1] - cy) > 14 * u && ((tip[0] - cx) * (tx - cx) + (tip[1] - cy) * (ty - cy)) > 0) { [ex, ey] = tip; }
    else { const A = 42 * u; ex = cx + ((tx - cx) / sl) * A; ey = cy + ((ty - cy) / sl) * A; }
    html += `<line x1="${cx}" y1="${cy}" x2="${ex}" y2="${ey}" class="sk-ramp-arrow" style="stroke-width:${3 * u}"/>`;
    const ang = Math.atan2(ey - cy, ex - cx);
    const hx = 10 * u; const ex1 = ex - hx * Math.cos(ang - 0.45); const ey1 = ey - hx * Math.sin(ang - 0.45); const ex2 = ex - hx * Math.cos(ang + 0.45); const ey2 = ey - hx * Math.sin(ang + 0.45);
    html += `<polygon points="${ex},${ey} ${ex1},${ey1} ${ex2},${ey2}" class="sk-ramp-head"/>`;
    html += `<circle cx="${cx}" cy="${cy}" r="${9 * u}" class="sk-ramp-dot" style="stroke-width:${2.5 * u}"/>`;
    html += `<text x="${cx + 14 * u}" y="${cy - 14 * u}" class="sk-ramp-t" style="font-size:${fs}px;stroke-width:${3 * u}px">램프 시작</text>`;
  }
  // 램프 모드: 마우스 자리에 빈 원(외곽 안이면)
  if (S.closed && S.mode === "ramp" && S.lastMouse && S.hoverIn && (insidePoly(S.lastMouse, S.pts) || distToPoly(S.lastMouse, S.pts) <= 10 * mpp())) {
    const [gx, gy] = scr(S.lastMouse);
    html += `<circle cx="${gx}" cy="${gy}" r="${11 * u}" class="sk-ramp-ghost" style="stroke-width:${2.5 * u}"/>`;
  }
  // 커서
  if (S.hover) {
    const [hx, hy] = scr(S.hover.p);
    html += `<g class="sk-cross" style="stroke-width:${u}"><line x1="${hx - 12 * u}" y1="${hy}" x2="${hx + 12 * u}" y2="${hy}"/><line x1="${hx}" y1="${hy - 12 * u}" x2="${hx}" y2="${hy + 12 * u}"/></g>`;
    if (S.hover.kind) html += `<text x="${hx + 10 * u}" y="${hy + 16 * u}" class="sk-snap" style="font-size:${fs}px">${S.hover.kind}</text>`;
  }
  // 입력 상자: 마우스 옆에 지금 넣는 값(가로·세로·길이·좌표)과 깜빡이는 커서
  const dyn = dynLabel();
  if (dyn && S.hover) {
    const [hx, hy] = scr(S.hover.p);
    const val = $("sketch-cmd").value;
    const dfs = fs * 1.25;
    const text = `${dyn}: ${val}`;
    const w = (text.length * 0.66 + 1.2) * dfs;
    const bx = hx + 16 * u; const by = hy + 14 * u;
    html += `<g class="sk-dyn"><rect x="${bx}" y="${by}" width="${w}" height="${dfs * 1.7}" rx="${3 * u}" style="stroke-width:${1.5 * u}"/>`
      + `<text x="${bx + 0.5 * dfs}" y="${by + dfs * 1.2}" style="font-size:${dfs}px">${text}<tspan class="sk-caret">▏</tspan></text></g>`;
  }
  svg.innerHTML = html;
  status();
}

function status() {
  const last = S.pts[S.pts.length - 1];
  let t;
  if (S.mode === "rect") {
    t = !S.rectA ? "직사각형: 첫 모서리를 클릭하세요 (또는 x,y Enter)"
      : S.rectW != null ? `직사각형: 가로 ${S.rectW}m — 세로(m)를 입력하고 Enter (마우스가 있는 쪽으로)`
        : "직사각형: 가로(m) 입력 Enter → 세로(m) 입력 Enter, 또는 맞은편 모서리 클릭 / @가로,세로";
  } else if (S.closed && S.mode === "ramp") {
    t = S.ramp && S.ramp.aim ? `방향 고르기: 마우스를 내려갈 쪽으로 움직이고 클릭 — 지금 ${DIR_KO[S.ramp.dir || DIR_OF_EDGE[nearestEdge(S.ramp.p)]]}`
      : S.ramp ? `램프 ${rampTextShort()} — 다른 자리 클릭 = 다시 찍기 · R·화살표 키 = 방향 바꾸기 · 다 됐으면 '적용'(길이·실제 자리는 평면에서 층고로 계산)`
      : "① 램프 시작점을 외곽 안에 클릭 → ② 마우스로 내려갈 방향을 가리키고 클릭. 길이는 평면에서 층고·법정 경사로 자동 계산.";
  } else if (S.closed) {
    const prob = outlineProblem(S.pts);
    t = prob ? `⚠ ${prob}` : `닫힘 · 꼭짓점 ${S.pts.length}개 · 넓이 ${Math.round(polygonArea(S.pts)).toLocaleString("ko-KR")}㎡${S.ramp ? ` · 램프 ${rampTextShort()}` : ""} — 다 됐으면 '적용'`;
  } else if (!S.pts.length) t = "첫 점을 클릭하세요 (또는 x,y 입력 후 Enter)";
  else if (S.hover && last) {
    const dx = S.hover.p[0] - last[0]; const dy = S.hover.p[1] - last[1];
    const ang = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    t = `점 ${S.pts.length}개 · 길이 ${Math.hypot(dx, dy).toFixed(2)}m · 각도 ${ang.toFixed(1)}° — 숫자+Enter = 그 길이로, 첫 점 클릭 또는 C = 닫기`;
  } else t = `점 ${S.pts.length}개`;
  $("sketch-status").textContent = performance.now() < flashUntil ? `⚠ ${flashMsg}` : t;
  $("sketch-ortho").classList.toggle("on", S.ortho);
  $("sketch-ortho").dataset.tip = `직교 ${S.ortho ? "켬" : "끔"} (F8) — 가로·세로로만 긋기`;
  $("sketch-apply").disabled = !(S.closed && !outlineProblem(S.pts));
  const rb = $("sketch-ramp"); if (rb) rb.disabled = !S.closed;
  $("sketch-rect").classList.toggle("on", S.mode === "rect");
  const rd = $("sketch-ramp-dir");
  if (rd) { rd.hidden = !(S.closed && S.mode === "ramp"); rd.disabled = !S.ramp; }
  if (rb) rb.classList.toggle("on", S.mode === "ramp");
}

function addPoint(p) {
  if (S.closed) return;
  const first = S.pts[0];
  if (first && S.pts.length >= 3 && Math.hypot(p[0] - first[0], p[1] - first[1]) < 0.01) { close(); return; }
  const last = S.pts[S.pts.length - 1];
  if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.05) return;
  S.pts.push([r2(p[0]), r2(p[1])]);
  // 입력한 점이 화면 밖이면 전체가 보이게 맞춤
  if (S.api) {
    const [x, y] = S.api.toScreen(p); const { w, h } = S.api.size();
    if (x < 10 || y < 10 || x > w - 10 || y > h - 10) S.api.fit(S.pts.concat(S.site.flat()));
  } else {
    const v = S.view; const m = v.w * 0.03;
    if (p[0] < v.x + m || p[0] > v.x + v.w - m || -p[1] < v.y + m || -p[1] > v.y + v.h - m) fit(S.pts.concat(S.site.flat()));
  }
  render();
}
function close() {
  if (S.pts.length < 3) { flash("점이 3개 이상이어야 닫을 수 있습니다."); return; }
  S.closed = true;
  S.hover = null;
  if (!S.ramp && $("sketch-ramp")) S.mode = "ramp";   // 닫으면 바로 램프 시작점 찍기
  render();
}
function undo() {
  if (S.mode === "rect") { if (S.rectW != null) S.rectW = null; else if (S.rectA) S.rectA = null; else S.mode = "draw"; render(); return; }
  if (S.mode === "ramp") { S.mode = "draw"; render(); return; }
  if (S.closed) S.closed = false; else S.pts.pop();
  render();
}
let flashMsg = ""; let flashUntil = 0;
function flash(msg, ms = 2500) { flashMsg = msg; flashUntil = performance.now() + ms; $("sketch-status").textContent = `⚠ ${msg}`; }

// 명령 입력: 숫자 / @dx,dy / @L<각 / x,y / c / u
// ── 직사각형(REC): 한 모서리 클릭 → 맞은편 모서리 클릭(또는 @가로,세로) ──
function startRect() {
  S.pts = []; S.closed = false; S.ramp = null;
  S.mode = "rect"; S.rectA = null; S.rectW = null;
  render();
}
function finishRect(b) {
  const a = S.rectA;
  const x0 = Math.min(a[0], b[0]); const x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]); const y1 = Math.max(a[1], b[1]);
  if (x1 - x0 < 0.5 || y1 - y0 < 0.5) { flash("직사각형이 너무 작습니다."); return; }
  S.pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => [r2(x), r2(y)]);
  S.rectA = null;
  S.mode = "draw";
  close();   // 닫으면 바로 램프 시작점 찍기로
}
function command(text) {
  const t = text.trim().toLowerCase();
  if (t === "rec" || t === "rect") { startRect(); return; }
  if (S.mode === "rect") {
    let m;
    if ((m = t.match(/^@\s*(-?[\d.]+)\s*[, ]\s*(-?[\d.]+)$/))) {
      if (!S.rectA) return flash("첫 모서리를 먼저 클릭하거나 x,y로 넣으세요.");
      finishRect([S.rectA[0] + +m[1], S.rectA[1] + +m[2]]);
    } else if ((m = t.match(/^(-?[\d.]+)\s*[, ]\s*(-?[\d.]+)$/))) {
      if (!S.rectA) { S.rectA = [+m[1], +m[2]]; render(); } else finishRect([+m[1], +m[2]]);
    } else if ((m = t.match(/^([\d.]+)$/))) {
      // CAD식: 가로 Enter → 세로 Enter (방향은 마우스가 있는 쪽, 없으면 오른쪽·위)
      if (!S.rectA) return flash("첫 모서리를 먼저 클릭하거나 x,y로 넣으세요.");
      const h = S.hover ? S.hover.p : null;
      const sx = h && h[0] < S.rectA[0] ? -1 : 1; const sy = h && h[1] < S.rectA[1] ? -1 : 1;
      if (S.rectW == null) {
        S.rectW = +m[1];
        // 가로가 화면 밖으로 나가면 다 보이게
        const a = S.rectA; const far = [a[0] + sx * S.rectW, a[1]];
        const [fx, fy] = scr(far); const r = drawSvg().getBoundingClientRect();
        if (S.api ? (fx < 20 || fx > S.api.size().w - 20) : (far[0] < S.view.x || far[0] > S.view.x + S.view.w)) fit([a, far, [a[0], a[1] + sy * S.rectW * 0.6]]);
        void fy; void r;
        render();
      }
      else { const wv = S.rectW; S.rectW = null; finishRect([S.rectA[0] + sx * wv, S.rectA[1] + sy * +m[1]]); }
    } else flash("직사각형: 모서리 클릭 → 가로 Enter → 세로 Enter (또는 @가로,세로)");
    return;
  }
  if (S.mode === "ramp") {
    if (t === "u" || t === "undo") undo();
    else if (t === "r") rotateRampDir();
    else if (["n", "s", "e", "w"].includes(t)) setRampDir(t);
    return;
  }
  const last = S.pts[S.pts.length - 1];
  if (!t) { if (!S.closed && S.pts.length >= 3) close(); return; }
  if (t === "c" || t === "close") { close(); return; }
  if (t === "u" || t === "undo") { undo(); return; }
  if (S.closed) { flash("이미 닫혔습니다. 되돌리기(U)나 새로 그리기를 쓰세요."); return; }
  let m;
  if ((m = t.match(/^@\s*(-?[\d.]+)\s*<\s*(-?[\d.]+)$/))) {
    if (!last) return flash("첫 점이 먼저 있어야 합니다.");
    const L = +m[1]; const a = (+m[2] * Math.PI) / 180;
    addPoint([last[0] + L * Math.cos(a), last[1] + L * Math.sin(a)]);
  } else if ((m = t.match(/^@\s*(-?[\d.]+)\s*[, ]\s*(-?[\d.]+)$/))) {
    if (!last) return flash("첫 점이 먼저 있어야 합니다.");
    addPoint([last[0] + +m[1], last[1] + +m[2]]);
  } else if ((m = t.match(/^(-?[\d.]+)\s*[, ]\s*(-?[\d.]+)$/))) {
    addPoint([+m[1], +m[2]]);
  } else if ((m = t.match(/^(-?[\d.]+)$/))) {
    if (!last) return flash("첫 점은 클릭하거나 x,y로 넣으세요.");
    const L = +m[1];
    let dx = 1; let dy = 0;
    if (S.hover) { dx = S.hover.p[0] - last[0]; dy = S.hover.p[1] - last[1]; }
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return flash("마우스로 방향을 먼저 가리키세요.");
    addPoint([last[0] + (L * dx) / d, last[1] + (L * dy) / d]);
  } else flash(`모르는 입력: ${text}`);
  // 다음 방향 미리보기 유지
  if (S.lastMouse) S.hover = snapPoint(S.lastMouse, false);
  render();
}

function fit(points) {
  if (S.api) { S.api.fit(points.length ? points : [[-30, -30], [30, 30]]); return; }
  const all = points.length ? points : [[-30, -30], [30, 30]];
  const xs = all.map((p) => p[0]); const ys = all.map((p) => p[1]);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const w = Math.max(20, maxX - minX) * 1.25; const h = Math.max(20, maxY - minY) * 1.25;
  S.view = { x: (minX + maxX) / 2 - w / 2, y: -(minY + maxY) / 2 - h / 2, w, h };
}

// 마우스: 누름/움직임/뗌. 도면판이면 SVG에서, 지도 위면 지도(context.js)가 넘겨줌.
let drag = null;
function onDown(e) {
  if (!S.open) return false;
  // 지도 위: 오른쪽 버튼은 지도 이동(지도가 처리)
  if (S.api && e.button !== 0) return false;
  const w = W(e);
  const tol = 8 * mpp();
  const hit = e.button === 0 && S.closed && S.mode !== "ramp" ? S.pts.findIndex((p) => Math.hypot(p[0] - w[0], p[1] - w[1]) < tol) : -1;
  drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, button: e.button, vertex: hit };
  if (hit >= 0) S.dragIdx = hit;
  return true;
}
function onMove(e) {
  if (!S.open) return;
  const w = W(e);
  S.lastMouse = w;
  if (drag) {
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 4) drag.moved = true;
    if (drag.vertex >= 0) {
      if (drag.moved) { S.pts[drag.vertex] = snapPoint(w, e.shiftKey, drag.vertex).p; render(); }
      return;
    }
    if (drag.moved) {
      // 끌기 = 화면 이동
      if (S.api) S.api.panBy(drag.x - e.clientX, drag.y - e.clientY);
      else {
        const s = scaleOf();
        S.view = { ...S.view, x: S.view.x - (e.clientX - drag.x) / s, y: S.view.y - (e.clientY - drag.y) / s };
        svgEl().classList.add("panning");
      }
      drag.x = e.clientX; drag.y = e.clientY;
      render();
      return;
    }
  }
  const area = S.api ? S.api.svg.parentElement : svgEl();
  const r = area.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  S.hoverIn = inside;
  // 램프 방향 고르는 중: 시작점에서 마우스 쪽(가로·세로 중 더 큰 쪽)으로
  if (S.mode === "ramp" && S.ramp && S.ramp.aim) {
    const dx = w[0] - S.ramp.p[0]; const dy = w[1] - S.ramp.p[1];
    if (Math.hypot(dx, dy) > 12 * mpp()) S.ramp.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "e" : "w") : (dy > 0 ? "n" : "s");
    // 화살표 끝 = 마우스를 그 방향 축에 맞춘 자리(표시용, 램프 길이와 무관)
    if (S.ramp.dir) S.ramp.tip = S.ramp.dir === "e" || S.ramp.dir === "w" ? [w[0], S.ramp.p[1]] : [S.ramp.p[0], w[1]];
  }
  S.hover = inside && S.mode !== "ramp" ? snapPoint(w, e.shiftKey) : (inside ? { p: w, kind: "" } : null);
  render();
}
function onUp(e) {
  if (!drag || !S.open) { drag = null; return; }
  const d = drag; drag = null;
  S.dragIdx = -1;
  svgEl().classList.remove("panning");
  if (d.vertex >= 0) { render(); return; }
  if (!d.moved && d.button === 0 && S.mode === "rect") {
    const p = snapPoint(W(e), e.shiftKey).p;
    if (!S.rectA) { S.rectA = p; render(); } else finishRect(p);
    return;
  }
  if (!d.moved && d.button === 0 && S.closed && S.mode === "ramp") { pickRamp(W(e)); return; }
  if (!d.moved && d.button === 0 && !S.closed) {
    const p = snapPoint(W(e), e.shiftKey).p;
    const first = S.pts[0];
    if (first && S.pts.length >= 3 && Math.hypot(p[0] - first[0], p[1] - first[1]) < 10 * mpp()) close();
    else addPoint(p);
  }
  if (!d.moved && d.button === 2 && !S.closed && S.pts.length >= 3) close();   // 오른쪽 클릭 = 닫기(도면판)
}

let bound = false;
function bind() {
  if (bound) return;
  bound = true;
  const svg = svgEl();
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const [wx, wy] = toWorld(e); const py = -wy;
    const f = e.deltaY > 0 ? 1.2 : 1 / 1.2;
    const w = Math.min(3000, Math.max(5, S.view.w * f)); const k = w / S.view.w;
    S.view = { x: wx - (wx - S.view.x) * k, y: py - (py - S.view.y) * k, w, h: S.view.h * k };
    render();
  }, { passive: false });
  svg.addEventListener("contextmenu", (e) => e.preventDefault());
  svg.addEventListener("mousedown", (e) => { if (!S.api && onDown(e)) e.preventDefault(); });
  window.addEventListener("mousemove", (e) => { if (!S.api) onMove(e); });
  window.addEventListener("mouseup", (e) => { if (!S.api) onUp(e); });
  svg.addEventListener("dblclick", () => { fit(S.pts.concat(S.site.flat())); render(); });
  const cmd = $("sketch-cmd");
  cmd.addEventListener("input", () => render());
  cmd.addEventListener("keydown", (e) => {
    if (S.mode === "ramp" && S.closed && !cmd.value) {
      const arrows = { ArrowUp: "n", ArrowDown: "s", ArrowRight: "e", ArrowLeft: "w" };
      if (arrows[e.key]) { setRampDir(arrows[e.key]); e.preventDefault(); return; }
      if (e.key === "r" || e.key === "R") { rotateRampDir(); e.preventDefault(); return; }
    }
    if (e.key === "Enter") { command(cmd.value); cmd.value = ""; e.preventDefault(); }
    else if (e.key === "Escape") { cmd.value = ""; }
    else if (e.key === "F8") { S.ortho = !S.ortho; render(); e.preventDefault(); }
    else if (e.key === "Backspace" && !cmd.value) { undo(); e.preventDefault(); }
  });
  // 그림 위에서 숫자를 치면 명령줄로
  window.addEventListener("keydown", (e) => {
    if (!S.open || document.activeElement === cmd) return;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement && document.activeElement.tagName)) return;
    if (e.key === "Escape" && cmd.value) { cmd.value = ""; return; }
    if (S.mode === "ramp" && S.closed) {
      const arrows = { ArrowUp: "n", ArrowDown: "s", ArrowRight: "e", ArrowLeft: "w" };
      if (arrows[e.key]) { setRampDir(arrows[e.key]); e.preventDefault(); return; }
      if (e.key === "r" || e.key === "R") { rotateRampDir(); e.preventDefault(); return; }
    }
    if (e.key === "F8") { S.ortho = !S.ortho; render(); e.preventDefault(); return; }
    if (e.key === "Backspace") { undo(); e.preventDefault(); return; }
    if (e.key === "Enter") { command(""); e.preventDefault(); return; }
    // 지도를 클릭하면 초점이 지도로 가므로, 친 글자를 명령줄에 직접 넣고 초점을 옮김
    if (e.key.length === 1 && /[\d.@,<\-cuer ]/i.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) { cmd.value += e.key; cmd.focus(); e.preventDefault(); render(); }
  });
  $("sketch-ortho").addEventListener("click", () => { S.ortho = !S.ortho; render(); });
  $("sketch-undo").addEventListener("click", undo);
  $("sketch-close-poly").addEventListener("click", close);
  $("sketch-rect").addEventListener("click", startRect);
  $("sketch-clear").addEventListener("click", () => { S.pts = []; S.closed = false; S.mode = "draw"; S.ramp = null; render(); });
  $("sketch-ramp-dir")?.addEventListener("click", rotateRampDir);
  $("sketch-ramp")?.addEventListener("click", () => { if (!S.closed) return; S.mode = S.mode === "ramp" ? "draw" : "ramp"; S.hover = null; render(); });
  $("sketch-fit").addEventListener("click", () => { fit(S.pts.concat(S.site.flat())); render(); });
  $("sketch-cancel").addEventListener("click", () => closeSketch());
  $("sketch-apply").addEventListener("click", () => {
    if (!S.closed || outlineProblem(S.pts)) return;
    const pts = S.pts.map((p) => p.slice());
    const geo = S.center ? { center: S.center, pts } : null;
    const done = S.onDone;
    // 배치 계산이 오래 걸릴 수 있으니 '적용 중' 표시를 먼저 그린 뒤 계산
    const btn = $("sketch-apply");
    btn.disabled = true;
    btn.textContent = "적용 중…";
    $("sketch-busy").hidden = false;
    const t0 = performance.now();
    requestAnimationFrame(() => setTimeout(() => {
      try { if (done) done(pts, geo, S.ramp ? rampOut() : null); } finally {
        // 너무 빨리 끝나도 잠깐(0.5초)은 보이게
        setTimeout(() => {
          $("sketch-busy").hidden = true;
          btn.textContent = "적용";
          closeSketch();
        }, Math.max(0, 500 - (performance.now() - t0)));
      }
    }, 30));
  });
  window.addEventListener("resize", () => render());
}

// site: 대지 필지(GeoJSON feature 또는 {geometry}), center: 조회 지점 {x: 경도, y: 위도}
// start: 이미 있는 외곽 { pts, geo } — geo가 있으면 대지 위 그 자리에, 없으면 원점 기준
export function openSketch({ site = null, center = null, start = null, onDone, validate = null, api = null, ramp = null, rampW = 6, rampLen = 20, rampMode = false }) {
  S.rampLen = rampLen;
  S.open = true;
  S.ramp = null;
  S.rampIn = ramp;   // {edge, t, offset} — 외곽을 놓은 뒤 점으로 바꿈
  S.rampW = rampW || 6;
  S.mode = "draw";
  S.onDone = onDone;
  S.validate = validate;
  S.api = api;
  if (api) center = api.center;
  S.center = center && Number.isFinite(center.x) ? center : null;
  S.site = [];
  if (S.center && site && site.geometry) {
    const loc = localizer(S.center.x, S.center.y);
    S.site = outerRings(site.geometry).map((r) => r.map(loc).map(([x, y]) => [r2(x), r2(y)]));
  }
  S.pts = []; S.closed = false; S.hover = null; S.dragIdx = -1;
  if (start && start.pts && start.pts.length >= 3) {
    const sameCenter = start.geo && S.center && start.geo.center && Math.abs(start.geo.center.x - S.center.x) < 1e-9 && Math.abs(start.geo.center.y - S.center.y) < 1e-9;
    let pts = (sameCenter ? start.geo.pts : start.pts).map((p) => [r2(p[0]), r2(p[1])]);
    if (!sameCenter && S.center) {
      // 대지와 상관없이 그린 외곽이면 조회 지점에 가운데를 맞춰 올려 둠
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length; const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      pts = pts.map(([x, y]) => [r2(x - cx), r2(y - cy)]);
    }
    S.pts = pts;
    S.closed = true;
    if (rampMode) S.mode = "ramp";
    if (S.rampIn && S.rampIn.edge) {
      const { b } = sideSegments(); const r = S.rampIn; const off = r.offset || 0;
      if (r.p) S.ramp = { dir: r.dir || DIR_OF_EDGE[r.edge], p: [b.x0 + r.p[0], b.y0 + r.p[1]], tip: r.tip ? [b.x0 + r.tip[0], b.y0 + r.tip[1]] : null };
      else S.ramp = { dir: DIR_OF_EDGE[r.edge], p: r.edge === "s" ? [b.x0 + r.t, b.y0 + off] : r.edge === "n" ? [b.x0 + r.t, b.y1 - off] : r.edge === "w" ? [b.x0 + off, b.y0 + r.t] : [b.x1 - off, b.y0 + r.t] };
    }
  }
  document.body.classList.add("sketch-open");
  $("sketch-view").hidden = false;
  $("sketch-view").classList.toggle("on-map", !!api);
  bind();
  if (api) api.setHook({ down: onDown, move: onMove, up: onUp, redraw: render });
  requestAnimationFrame(() => {
    // 지도 위: 대지(필지)와 그린 외곽이 보이게 확대
    const go = () => {
      if (!api || S.pts.length || S.site.length) fit(S.pts.concat(S.site.flat()));
      render();
      $("sketch-cmd").focus();
    };
    // 지도는 크기 맞춤(invalidateSize)·첫 화면 맞춤이 끝난 뒤에 확대
    if (api) setTimeout(go, 120); else go();
  });
}
export function closeSketch() {
  S.open = false;
  S.hover = null;
  if (S.api) { S.api.svg.innerHTML = ""; S.api.setHook(null); S.api = null; }
  $("sketch-view").hidden = true;
  $("sketch-view").classList.remove("on-map");
  document.body.classList.remove("sketch-open");
}
export function sketchOpen() { return S.open; }
