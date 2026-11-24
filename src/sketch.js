// 주차장 외곽 스케치: CAD처럼 점을 찍고 선을 이어 다각형을 만든다.
// - 클릭 = 점, 직교(F8) 켜면 가로·세로로만, Shift = 잠깐 반대로
// - 점·대지 꼭짓점 근처에 붙음(끝점 스냅), 첫 점과 가로·세로가 맞으면 붙음
// - 숫자 입력 + Enter = 마우스 방향으로 그 길이만큼(직접 거리 입력)
//   "@dx,dy" = 마지막 점에서 상대 좌표, "@길이<각도" = 극좌표(동 0°, 반시계), "x,y" = 절대 좌표
//   "c" 또는 빈 Enter(점 3개 이상) = 닫기, "u" = 되돌리기
// - 그린 뒤에는 꼭짓점을 끌어서 고칠 수 있음
// 좌표: m, 동 +x, 북 +y. 대지가 있으면 대지 조회 지점 기준, 없으면 임의 원점.
import { localizer, outerRings } from "./zoning.js?v=264";
import { outlineProblem, polygonArea } from "./outline.js?v=264";

const $ = (id) => document.getElementById(id);
const S = {
  open: false, pts: [], closed: false, hover: null, ortho: true,
  view: { x: -40, y: -40, w: 80, h: 80 }, site: [], center: null, onDone: null, dragIdx: -1,
};

const r2 = (v) => Math.round(v * 100) / 100;
const snap01 = (v) => Math.round(v * 10) / 10;
const fmt = (v) => (Math.round(v * 100) / 100).toString();

function svgEl() { return $("sketch-svg"); }
function scaleOf() {
  const r = svgEl().getBoundingClientRect();
  return Math.min(r.width / S.view.w, r.height / S.view.h) || 1;
}
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
  const tol = 10 / scaleOf();
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

function polyPts(pts) { return pts.map(([x, y]) => `${x},${-y}`).join(" "); }

function render() {
  if (!S.open) return;
  const svg = svgEl();
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
  const px = 1 / s;   // 1화면 px의 m
  // 격자: 화면에서 12px 이상 되는 간격
  const steps = [0.5, 1, 2, 5, 10, 20, 50, 100];
  const minor = steps.find((g) => g * s >= 12) || 100;
  const major = steps.find((g) => g >= minor * 5) || minor * 5;
  let grid = "";
  const x0 = Math.floor(v.x / minor) * minor; const x1 = v.x + v.w;
  const y0 = Math.floor(v.y / minor) * minor; const y1 = v.y + v.h;
  for (let x = x0; x <= x1; x += minor) grid += `<line x1="${x}" y1="${v.y}" x2="${x}" y2="${y1}" class="${Math.abs(x / major - Math.round(x / major)) < 1e-6 ? "sk-major" : "sk-minor"}"/>`;
  for (let y = y0; y <= y1; y += minor) grid += `<line x1="${v.x}" y1="${y}" x2="${x1}" y2="${y}" class="${Math.abs(y / major - Math.round(y / major)) < 1e-6 ? "sk-major" : "sk-minor"}"/>`;
  let html = `<g style="stroke-width:${px}">${grid}</g>`;
  html += `<line x1="0" y1="${v.y}" x2="0" y2="${y1}" class="sk-axis" style="stroke-width:${px}"/><line x1="${v.x}" y1="0" x2="${x1}" y2="0" class="sk-axis" style="stroke-width:${px}"/>`;
  // 대지
  S.site.forEach((ring) => { html += `<polygon points="${polyPts(ring)}" class="sk-site" style="stroke-width:${2 * px}"/>`; });
  // 그린 것
  const live = S.pts.concat(!S.closed && S.hover && S.pts.length ? [S.hover.p] : []);
  if (S.closed && S.pts.length >= 3) html += `<polygon points="${polyPts(S.pts)}" class="sk-poly" style="stroke-width:${2.5 * px}"/>`;
  else if (live.length >= 2) html += `<polyline points="${polyPts(live)}" class="sk-line" style="stroke-width:${2.5 * px}"/>`;
  // 변 길이
  const segs = S.closed ? S.pts.map((p, i) => [p, S.pts[(i + 1) % S.pts.length]]) : live.slice(1).map((p, i) => [live[i], p]);
  const fs = 11 * px;
  segs.forEach(([a, b]) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.05) return;
    const mx = (a[0] + b[0]) / 2; const my = (a[1] + b[1]) / 2;
    const nx = -(b[1] - a[1]) / len; const ny = (b[0] - a[0]) / len;
    html += `<text x="${mx + nx * 9 * px}" y="${-(my + ny * 9 * px)}" class="sk-len" style="font-size:${fs}px" text-anchor="middle" dominant-baseline="middle">${len.toFixed(2).replace(/\.?0+$/, "")}</text>`;
  });
  S.pts.forEach(([x, y], i) => { html += `<rect x="${x - 3.5 * px}" y="${-y - 3.5 * px}" width="${7 * px}" height="${7 * px}" class="sk-pt${i === 0 ? " first" : ""}${i === S.dragIdx ? " drag" : ""}" style="stroke-width:${px}"/>`; });
  // 커서
  if (S.hover) {
    const [hx, hy] = S.hover.p;
    html += `<g class="sk-cross" style="stroke-width:${px}"><line x1="${hx - 12 * px}" y1="${-hy}" x2="${hx + 12 * px}" y2="${-hy}"/><line x1="${hx}" y1="${-hy - 12 * px}" x2="${hx}" y2="${-hy + 12 * px}"/></g>`;
    if (S.hover.kind) html += `<text x="${hx + 10 * px}" y="${-hy + 16 * px}" class="sk-snap" style="font-size:${fs}px">${S.hover.kind}</text>`;
  }
  svg.innerHTML = html;
  status();
}

function status() {
  const last = S.pts[S.pts.length - 1];
  let t;
  if (S.closed) {
    const prob = outlineProblem(S.pts);
    t = prob ? `⚠ ${prob}` : `닫힘 · 꼭짓점 ${S.pts.length}개 · 넓이 ${Math.round(polygonArea(S.pts)).toLocaleString("ko-KR")}㎡ — 꼭짓점을 끌어서 고치거나 '적용'`;
  } else if (!S.pts.length) t = "첫 점을 클릭하세요 (또는 x,y 입력 후 Enter)";
  else if (S.hover && last) {
    const dx = S.hover.p[0] - last[0]; const dy = S.hover.p[1] - last[1];
    const ang = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    t = `점 ${S.pts.length}개 · 길이 ${Math.hypot(dx, dy).toFixed(2)}m · 각도 ${ang.toFixed(1)}° — 숫자+Enter = 그 길이로, 첫 점 클릭 또는 C = 닫기`;
  } else t = `점 ${S.pts.length}개`;
  $("sketch-status").textContent = t;
  $("sketch-ortho").classList.toggle("on", S.ortho);
  $("sketch-ortho").textContent = `직교 ${S.ortho ? "켬" : "끔"} (F8)`;
  $("sketch-apply").disabled = !(S.closed && !outlineProblem(S.pts));
}

function addPoint(p) {
  if (S.closed) return;
  const first = S.pts[0];
  if (first && S.pts.length >= 3 && Math.hypot(p[0] - first[0], p[1] - first[1]) < 0.01) { close(); return; }
  const last = S.pts[S.pts.length - 1];
  if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.05) return;
  S.pts.push([r2(p[0]), r2(p[1])]);
  // 입력한 점이 화면 밖이면 전체가 보이게 맞춤
  const v = S.view; const m = v.w * 0.03;
  if (p[0] < v.x + m || p[0] > v.x + v.w - m || -p[1] < v.y + m || -p[1] > v.y + v.h - m) fit(S.pts.concat(S.site.flat()));
  render();
}
function close() {
  if (S.pts.length < 3) { flash("점이 3개 이상이어야 닫을 수 있습니다."); return; }
  S.closed = true;
  S.hover = null;
  render();
}
function undo() {
  if (S.closed) S.closed = false; else S.pts.pop();
  render();
}
function flash(msg) { $("sketch-status").textContent = `⚠ ${msg}`; }

// 명령 입력: 숫자 / @dx,dy / @L<각 / x,y / c / u
function command(text) {
  const t = text.trim().toLowerCase();
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
  const all = points.length ? points : [[-30, -30], [30, 30]];
  const xs = all.map((p) => p[0]); const ys = all.map((p) => p[1]);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const w = Math.max(20, maxX - minX) * 1.25; const h = Math.max(20, maxY - minY) * 1.25;
  S.view = { x: (minX + maxX) / 2 - w / 2, y: -(minY + maxY) / 2 - h / 2, w, h };
}

let bound = false;
function bind() {
  if (bound) return;
  bound = true;
  const svg = svgEl();
  let drag = null;
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const [wx, wy] = toWorld(e); const py = -wy;
    const f = e.deltaY > 0 ? 1.2 : 1 / 1.2;
    const w = Math.min(3000, Math.max(5, S.view.w * f)); const k = w / S.view.w;
    S.view = { x: wx - (wx - S.view.x) * k, y: py - (py - S.view.y) * k, w, h: S.view.h * k };
    render();
  }, { passive: false });
  svg.addEventListener("contextmenu", (e) => e.preventDefault());
  svg.addEventListener("mousedown", (e) => {
    const w = toWorld(e);
    const tol = 8 / scaleOf();
    const hit = e.button === 0 && S.closed ? S.pts.findIndex((p) => Math.hypot(p[0] - w[0], p[1] - w[1]) < tol) : -1;
    drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, button: e.button, vertex: hit };
    if (hit >= 0) S.dragIdx = hit;
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!S.open) return;
    const w = toWorld(e);
    S.lastMouse = w;
    if (drag) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 4) drag.moved = true;
      if (drag.vertex >= 0) {
        if (drag.moved) { S.pts[drag.vertex] = snapPoint(w, e.shiftKey, drag.vertex).p; render(); }
        return;
      }
      if (drag.moved) {
        const s = scaleOf();
        S.view = { ...S.view, x: S.view.x - (e.clientX - drag.x) / s, y: S.view.y - (e.clientY - drag.y) / s };
        drag.x = e.clientX; drag.y = e.clientY;
        svg.classList.add("panning");
        render();
        return;
      }
    }
    const inside = e.target === svg || svg.contains(e.target);
    S.hover = inside ? snapPoint(w, e.shiftKey) : null;
    render();
  });
  window.addEventListener("mouseup", (e) => {
    if (!drag || !S.open) { drag = null; return; }
    const d = drag; drag = null;
    S.dragIdx = -1;
    svg.classList.remove("panning");
    if (d.vertex >= 0) { render(); return; }
    if (!d.moved && d.button === 0 && !S.closed) {
      const p = snapPoint(toWorld(e), e.shiftKey).p;
      const first = S.pts[0];
      if (first && S.pts.length >= 3 && Math.hypot(p[0] - first[0], p[1] - first[1]) < 10 / scaleOf()) close();
      else addPoint(p);
    }
    if (!d.moved && d.button === 2 && !S.closed && S.pts.length >= 3) close();   // 오른쪽 클릭 = 닫기
  });
  svg.addEventListener("dblclick", () => { fit(S.pts.concat(S.site.flat())); render(); });
  const cmd = $("sketch-cmd");
  cmd.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { command(cmd.value); cmd.value = ""; e.preventDefault(); }
    else if (e.key === "Escape") { cmd.value = ""; }
    else if (e.key === "F8") { S.ortho = !S.ortho; render(); e.preventDefault(); }
    else if (e.key === "Backspace" && !cmd.value) { undo(); e.preventDefault(); }
  });
  // 그림 위에서 숫자를 치면 명령줄로
  window.addEventListener("keydown", (e) => {
    if (!S.open || document.activeElement === cmd) return;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement && document.activeElement.tagName)) return;
    if (e.key === "F8") { S.ortho = !S.ortho; render(); e.preventDefault(); return; }
    if (e.key === "Backspace") { undo(); e.preventDefault(); return; }
    if (e.key === "Enter") { command(""); e.preventDefault(); return; }
    if (e.key.length === 1 && /[\d.@,<\-cu]/i.test(e.key)) { cmd.focus(); }
  });
  $("sketch-ortho").addEventListener("click", () => { S.ortho = !S.ortho; render(); });
  $("sketch-undo").addEventListener("click", undo);
  $("sketch-close-poly").addEventListener("click", close);
  $("sketch-clear").addEventListener("click", () => { S.pts = []; S.closed = false; render(); });
  $("sketch-fit").addEventListener("click", () => { fit(S.pts.concat(S.site.flat())); render(); });
  $("sketch-cancel").addEventListener("click", () => closeSketch());
  $("sketch-apply").addEventListener("click", () => {
    if (!S.closed || outlineProblem(S.pts)) return;
    const pts = S.pts.map((p) => p.slice());
    const geo = S.center ? { center: S.center, pts } : null;
    const done = S.onDone;
    closeSketch();
    if (done) done(pts, geo);
  });
  window.addEventListener("resize", () => render());
}

// site: 대지 필지(GeoJSON feature 또는 {geometry}), center: 조회 지점 {x: 경도, y: 위도}
// start: 이미 있는 외곽 { pts, geo } — geo가 있으면 대지 위 그 자리에, 없으면 원점 기준
export function openSketch({ site = null, center = null, start = null, onDone }) {
  S.open = true;
  S.onDone = onDone;
  S.center = center && Number.isFinite(center.x) ? center : null;
  S.site = [];
  if (S.center && site && site.geometry) {
    const loc = localizer(S.center.x, S.center.y);
    S.site = outerRings(site.geometry).map((r) => r.map(loc).map(([x, y]) => [r2(x), r2(y)]));
  }
  S.pts = []; S.closed = false; S.hover = null; S.dragIdx = -1;
  if (start && start.pts && start.pts.length >= 3) {
    const sameCenter = start.geo && S.center && start.geo.center && Math.abs(start.geo.center.x - S.center.x) < 1e-9 && Math.abs(start.geo.center.y - S.center.y) < 1e-9;
    S.pts = (sameCenter ? start.geo.pts : start.pts).map((p) => [r2(p[0]), r2(p[1])]);
    S.closed = true;
  }
  $("sketch-view").hidden = false;
  bind();
  requestAnimationFrame(() => { fit(S.pts.concat(S.site.flat())); render(); $("sketch-cmd").focus(); });
}
export function closeSketch() {
  S.open = false;
  S.hover = null;
  $("sketch-view").hidden = true;
}
export function sketchOpen() { return S.open; }
