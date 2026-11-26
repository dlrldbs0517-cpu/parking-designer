// 주변 매스 보기: 주소 조회 뒤 오른쪽에 지도를 띄우고, 드래그로 고른 영역의 필지·건물을
// 2D(평면) 또는 3D(높이만큼 세운 매스)로 보여 준다. 지도는 Leaflet(전역 L) + 브이월드 WMTS 타일.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { MAX_FEATURES, WMTS, boxAround, boxSize, buildingHeight, heightEstimated, isRoadParcel, lineParts, realRoads, localizer, outerRings, storyHeight, surroundingsBox } from "./zoning.js?v=306";

const $ = (id) => document.getElementById(id);
const MAX_SIDE = 1000;   // 영역 한 변 최대(m). 브이월드가 레이어당 1,000개까지만 준다.

let ctx = null;        // { point, site, title, bbox }
let cache = null;      // { key, data }
let three = null;      // { renderer, controls, frame }
let map = null;        // Leaflet 지도
let rect = null;       // 선택 영역 사각형
let marker = null;

// ── 데이터 → 로컬 m 좌표 ──
function prepare(data, site) {
  const toLocal = localizer(data.center.x, data.center.y);
  const ring = (r) => r.map(toLocal);
  const roadFeats = realRoads(data.parcels.filter((f) => isRoadParcel(f.properties)), data.buildings);
  const parcels = data.parcels.filter((f) => !roadFeats.includes(f)).flatMap((f) => outerRings(f.geometry).map(ring));
  const roadParcels = roadFeats.flatMap((f) => outerRings(f.geometry).map(ring));
  const roadLines = (data.roads || []).flatMap((f) => lineParts(f.geometry).map((pts) => ({ name: (f.properties && f.properties.rn) || "", pts: pts.map(toLocal) })));
  const accessEdges = ((ctx && ctx.access && ctx.access.edges) || []).map((e) => [toLocal(e.a), toLocal(e.b)]);
  const buildings = data.buildings.flatMap((f) => {
    const p = f.properties || {};
    const h = buildingHeight(p);
    const name = [p.bld_nm, p.dong_nm].filter(Boolean).join(" ");
    const est = heightEstimated(p) ? ` (층수×${storyHeight(p)}m 추정)` : "";
    return outerRings(f.geometry).map((r) => ({ ring: ring(r), h, name, floors: p.grnd_flr, est }));
  });
  const siteRings = site && site.geometry ? outerRings(site.geometry).map(ring) : [];
  const size = boxSize(data.bbox);
  const hx = size.w / 2;
  const hy = size.d / 2;
  // 영역 경계에 걸친 건물은 잘라 내지 않고, 중심이 영역 안에 있는 건물만 통째로 보여 준다.
  const inside = (r) => {
    const cx = r.reduce((a, p) => a + p[0], 0) / r.length;
    const cy = r.reduce((a, p) => a + p[1], 0) / r.length;
    return Math.abs(cx) <= hx && Math.abs(cy) <= hy;
  };
  return { parcels, roadParcels, roadLines, accessEdges, buildings: buildings.filter((b) => inside(b.ring)), siteRings, hx, hy, bbox: data.bbox, toLocal, center: data.center };
}

// 2D 배경: 브이월드 일반지도 타일을 영역에 깔아 실제 도로 모양을 보여 준다(지적도 도로 필지는 끊기거나 틀린 곳이 많음).
function tileBackground(model, view, pxWidth) {
  if (!model.bbox) return "";
  const bb = model.bbox;
  const { x: cx, y: cy } = model.center;
  const kx = 111320 * Math.cos((cy * Math.PI) / 180);
  const ky = 110540;
  // 보이는 범위(svg 좌표, y 아래로 +) ∩ 영역 → 경위도
  const vx0 = Math.max(-model.hx, view.x); const vx1 = Math.min(model.hx, view.x + view.w);
  const vy0 = Math.max(-model.hy, view.y); const vy1 = Math.min(model.hy, view.y + view.h);
  if (vx1 <= vx0 || vy1 <= vy0) return "";
  const b = { w: Math.max(bb.w, cx + vx0 / kx), e: Math.min(bb.e, cx + vx1 / kx), n: Math.min(bb.n, cy - vy0 / ky), s: Math.max(bb.s, cy - vy1 / ky) };
  const toLocal = model.toLocal;
  const mpp = view.w / Math.max(300, pxWidth || 1100);   // 화면 1px당 m
  const z = Math.max(12, Math.min(19, Math.round(Math.log2((40075016 * Math.cos((cy * Math.PI) / 180)) / (256 * mpp)))));
  const n = 2 ** z;
  const lon2x = (lon) => Math.floor(((lon + 180) / 360) * n);
  const lat2y = (lat) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  const x2lon = (x) => (x / n) * 360 - 180;
  const y2lat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const x0 = lon2x(b.w); const x1 = lon2x(b.e);
  const y0 = lat2y(b.n); const y1 = lat2y(b.s);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 150) return "";
  const url = WMTS("Base");
  const out = [];
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      const [lx, ty] = toLocal([x2lon(x), y2lat(y)]);
      const [rx, by] = toLocal([x2lon(x + 1), y2lat(y + 1)]);
      const href = url.replace("{z}", z).replace("{y}", y).replace("{x}", x);
      out.push(`<image href="${href}" x="${lx.toFixed(2)}" y="${(-ty).toFixed(2)}" width="${(rx - lx).toFixed(2)}" height="${(ty - by).toFixed(2)}" preserveAspectRatio="none"/>`);
    }
  }
  return out.join("");
}

function pathOf(ring) {
  return ring.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${(-y).toFixed(2)}`).join("") + "Z";
}

function draw2d(model) {
  const { hx, hy } = model;
  draw.center = model.center;
  const maxH = Math.max(10, ...model.buildings.map((b) => b.h));
  const parcels = model.parcels.map((r) => `<path d="${pathOf(r)}" class="cx-parcel"/>`).join("");
  const site = model.siteRings.map((r) => `<path d="${pathOf(r)}" class="cx-site"/>`).join("");
  const roads = model.roadParcels.map((r) => `<path d="${pathOf(r)}" class="cx-road"/>`).join("");
  // 지적상 도로 필지가 끊긴 곳(교차로·다른 지목)을 도로 중심선으로 잇는다. 이름이 '…길'이면 6m, 그 밖(…로)은 12m 폭으로 칠함
  const lineD = (pts) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${(-y).toFixed(1)}`).join("");
  const centers = model.roadLines.map((l) => `<path d="${lineD(l.pts)}" class="cx-roadline" style="stroke-width:${/길$/.test(l.name) ? 6 : 12}"/>`).join("");

  // 도로 이름: 이름마다 가장 긴 직선 구간 가운데 한 번만, 긴 도로부터, 서로 겹치면 생략
  const span0 = Math.max(model.hx, model.hy);
  const fz = span0 / 50;
  const byName = new Map();
  model.roadLines.forEach((l) => {
    if (!l.name) return;
    for (let i = 0; i < l.pts.length - 1; i += 1) {
      const a = l.pts[i]; const b = l.pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const mx = (a[0] + b[0]) / 2; const my = (a[1] + b[1]) / 2;
      if (Math.abs(mx) > model.hx * 0.95 || Math.abs(my) > model.hy * 0.95) continue;
      const cur = byName.get(l.name);
      if (!cur || len > cur.len) byName.set(l.name, { name: l.name, a, b, len, mx, my });
    }
  });
  const placed = [];
  const names = [...byName.values()]
    .filter((c) => c.len >= c.name.length * fz * 0.7)
    .sort((p, q) => q.len - p.len)
    .filter((c) => {
      const w = c.name.length * fz;
      if (placed.some((p) => Math.hypot(p.mx - c.mx, p.my - c.my) < (p.w + w) / 2 + fz)) return false;
      placed.push({ mx: c.mx, my: c.my, w });
      return placed.length <= 30;
    })
    .map((c) => {
      let ang = (Math.atan2(-(c.b[1] - c.a[1]), c.b[0] - c.a[0]) * 180) / Math.PI;
      if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
      return `<text class="cx-roadname" style="font-size:${fz.toFixed(2)}px;stroke-width:${(fz / 4).toFixed(2)}px" transform="translate(${c.mx.toFixed(1)} ${(-c.my).toFixed(1)}) rotate(${ang.toFixed(1)})" text-anchor="middle" dy="${(fz / 3).toFixed(2)}">${c.name}</text>`;
    }).join("");
  const builds = model.buildings.map((b) => {
    const t = Math.min(1, b.h / maxH);
    const mix = (lo, hi) => Math.round(lo + (hi - lo) * t);
    const fill = `rgb(${mix(214, 95)},${mix(209, 90)},${mix(199, 80)})`;
    const tip = `${b.name || "건물"} · ${b.floors ? `지상 ${b.floors}층 · ` : ""}높이 ${b.h.toFixed(1)}m${b.est}`;
    return `<path d="${pathOf(b.ring)}" class="cx-bldg" style="fill:${fill}"><title>${tip}</title></path>`;
  }).join("");
  $("context-2d").innerHTML = `
    <svg class="cx-svg" preserveAspectRatio="xMidYMid meet">
      <defs><clipPath id="cx-clip"><rect x="${-hx}" y="${-hy}" width="${2 * hx}" height="${2 * hy}"/></clipPath></defs>
      <rect x="${-hx}" y="${-hy}" width="${2 * hx}" height="${2 * hy}" class="cx-bg"/>
      <g clip-path="url(#cx-clip)"><g class="cx-tiles"></g>${parcels}${site}</g>${builds}
      <g class="cx-outline"></g>
    </svg>
    <div class="cx-north2">▲<br>N</div>
    <div class="cx-bar2"><span></span><i></i></div>`;
  bind2dView(model);
}

// 2D 확대·이동: 휠 = 확대/축소(마우스 위치 기준), 드래그 = 이동, 더블클릭 = 처음 화면
function bind2dView(model) {
  const box = $("context-2d");
  const svg = box.querySelector("svg");
  const full = { x: -model.hx, y: -model.hy, w: 2 * model.hx, h: 2 * model.hy };
  let view = { ...full };
  let tileTimer = 0;
  const apply = () => {
    svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
    // 축척 막대: 화면 px당 m
    const r = svg.getBoundingClientRect();
    const scale = Math.min(r.width / view.w, r.height / view.h) || 1;   // px per m
    const target = 120 / scale;
    const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500].reduce((best, v) => (v <= target ? v : best), 1);
    const bar = box.querySelector(".cx-bar2");
    bar.querySelector("i").style.width = `${nice * scale}px`;
    bar.querySelector("span").textContent = `${nice}m`;
    clearTimeout(tileTimer);
    tileTimer = setTimeout(() => {
      const g = svg.querySelector(".cx-tiles");
      if (g) g.innerHTML = tileBackground(model, view, r.width);
    }, 150);
  };
  const toSvg = (e) => {
    const r = svg.getBoundingClientRect();
    const scale = Math.min(r.width / view.w, r.height / view.h);
    const ox = (r.width - view.w * scale) / 2;
    const oy = (r.height - view.h * scale) / 2;
    return [view.x + (e.clientX - r.left - ox) / scale, view.y + (e.clientY - r.top - oy) / scale, scale];
  };
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const [px, py] = toSvg(e);
    const f = e.deltaY > 0 ? 1.2 : 1 / 1.2;
    const w = Math.min(full.w * 1.5, Math.max(20, view.w * f));
    const k = w / view.w;
    view = { x: px - (px - view.x) * k, y: py - (py - view.y) * k, w, h: view.h * k };
    apply();
  }, { passive: false });
  let drag = null;
  svg.addEventListener("contextmenu", (e) => e.preventDefault());
  svg.addEventListener("mousedown", (e) => {
    const [, , scale] = toSvg(e);
    drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, scale, moved: false };
    svg.classList.add("panning");
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (draw.on && !drag) {
      const [px, py, scale] = toSvg(e);
      draw.hover = snapPoint([px, -py], e.shiftKey, scale);
      renderOutline();
    }
    if (!drag) return;
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 4) drag.moved = true;
    if (!drag.moved) return;
    view = { ...view, x: view.x - (e.clientX - drag.x) / drag.scale, y: view.y - (e.clientY - drag.y) / drag.scale };
    drag.x = e.clientX; drag.y = e.clientY;
    apply();
  });
  window.addEventListener("mouseup", (e) => {
    if (!drag) return;
    const click = !drag.moved && e.button === 0;
    drag = null;
    svg.classList.remove("panning");
    // 그리기 중: 왼쪽 클릭 = 꼭짓점 찍기(직각 스냅, Shift = 자유), 첫 점 근처 클릭 = 닫기
    if (click && draw.on) {
      const [px, py, scale] = toSvg(e);
      const p = snapPoint([px, -py], e.shiftKey, scale);
      const first = draw.pts[0];
      if (first && draw.pts.length >= 3 && Math.hypot(p[0] - first[0], p[1] - first[1]) < 12 / scale) { finishDraw(); return; }
      draw.pts.push(p);
      renderOutline();
    }
  });
  svg.addEventListener("dblclick", () => { if (draw.on) return; view = { ...full }; apply(); });
  apply();
  renderOutline();
}

// ── 주차장 외곽 그리기(2D) ──
// 좌표는 대지 중심 기준 m(동 +x, 북 +y). 끝나면 onDone(점 목록)을 부른다.
const draw = { on: false, pts: [], hover: null, onDone: null, shown: null, center: null };
function snapPoint([x, y], free, scale) {
  const r = (v) => Math.round(v * 10) / 10;
  let p = [r(x), r(y)];
  const last = draw.pts[draw.pts.length - 1];
  if (last && !free) {
    // 앞 점에서 가로 또는 세로로만(직각)
    if (Math.abs(p[0] - last[0]) >= Math.abs(p[1] - last[1])) p = [p[0], last[1]];
    else p = [last[0], p[1]];
    // 첫 점과 x 또는 y가 가까우면 맞춰서 닫기 쉽게
    const first = draw.pts[0];
    const tol = 8 / (scale || 1);
    if (first && draw.pts.length >= 2) {
      if (Math.abs(p[0] - first[0]) < tol && p[1] === last[1]) p[0] = first[0];
      if (Math.abs(p[1] - first[1]) < tol && p[0] === last[0]) p[1] = first[1];
    }
  }
  return p;
}
function renderOutline() {
  const g = document.querySelector("#context-2d .cx-outline");
  if (!g) return;
  const toSvgPts = (pts) => pts.map(([x, y]) => `${x.toFixed(2)},${(-y).toFixed(2)}`).join(" ");
  let html = "";
  if (draw.on) {
    const pts = draw.pts.concat(draw.hover ? [draw.hover] : []);
    if (pts.length >= 2) html += `<polyline points="${toSvgPts(pts)}" class="cx-draw"/>`;
    draw.pts.forEach(([x, y], i) => { html += `<circle cx="${x}" cy="${-y}" r="${i === 0 ? 1.6 : 1}" class="cx-draw-pt${i === 0 ? " first" : ""}"/>`; });
    if (draw.hover && draw.pts.length) {
      const last = draw.pts[draw.pts.length - 1];
      const len = Math.hypot(draw.hover[0] - last[0], draw.hover[1] - last[1]);
      html += `<text x="${draw.hover[0] + 1.5}" y="${-draw.hover[1] - 1.5}" class="cx-draw-len">${len.toFixed(1)}m</text>`;
    }
  } else if (draw.shown && draw.shown.pts && draw.shown.pts.length >= 3 && draw.center) {
    // 저장된 외곽(그릴 때 중심 기준) → 지금 화면 중심 기준으로 옮겨 그림
    const kx = 111320 * Math.cos((draw.center.y * Math.PI) / 180);
    const dx = (draw.shown.center.x - draw.center.x) * kx;
    const dy = (draw.shown.center.y - draw.center.y) * 110540;
    html += `<polygon points="${toSvgPts(draw.shown.pts.map(([x, y]) => [x + dx, y + dy]))}" class="cx-outline-poly"/>`;
    // 램프 시작점(빨간 원)
    if (draw.shown.ramp && draw.shown.rampTip) {
      const ax = draw.shown.ramp[0] + dx; const ay = draw.shown.ramp[1] + dy;
      const bx = draw.shown.rampTip[0] + dx; const by = draw.shown.rampTip[1] + dy;
      const len = Math.hypot(bx - ax, by - ay) || 1; const ux = (bx - ax) / len; const uy = (by - ay) / len; const h = Math.min(3, len * 0.35);
      const w1 = [bx - h * (ux * Math.cos(0.45) - uy * Math.sin(0.45)), by - h * (uy * Math.cos(0.45) + ux * Math.sin(0.45))];
      const w2 = [bx - h * (ux * Math.cos(0.45) + uy * Math.sin(0.45)), by - h * (uy * Math.cos(0.45) - ux * Math.sin(0.45))];
      html += `<line x1="${ax}" y1="${-ay}" x2="${bx}" y2="${-by}" class="cx-ramp-arrow"/><polygon points="${bx},${-by} ${w1[0]},${-w1[1]} ${w2[0]},${-w2[1]}" class="cx-ramp-head"/>`;
    }
    if (draw.shown.ramp) {
      const rx = draw.shown.ramp[0] + dx; const ry = draw.shown.ramp[1] + dy;
      html += `<circle cx="${rx}" cy="${-ry}" r="3" class="cx-ramp-dot"/><text x="${rx + 4}" y="${-ry - 3}" class="cx-ramp-label">램프 시작</text>`;
    }
  }
  g.innerHTML = html;
}
function finishDraw() {
  const pts = draw.pts.slice();
  draw.on = false;
  draw.pts = [];
  draw.hover = null;
  draw.shown = { center: draw.center, pts };
  $("context-status").textContent = "주차장 외곽을 넣었습니다. 왼쪽 '주차장 모양'에서 숫자로 고칠 수 있습니다.";
  renderOutline();
  if (draw.onDone) draw.onDone({ center: draw.center, pts });
}
// 그리기 시작: 2D로 바꾸고 클릭을 기다린다
export function startOutlineDraw(onDone) {
  draw.on = true;
  draw.pts = [];
  draw.hover = null;
  draw.onDone = onDone;
  setMode("2d").then(() => {
    $("context-status").textContent = "주차장 외곽 그리기: 왼쪽 클릭 = 꼭짓점(가로·세로로 맞춤, Shift = 비스듬히) · 첫 점 클릭 = 닫기 · Backspace = 한 점 취소 · Esc = 그만 · 드래그 = 이동";
    renderOutline();
  });
}
// 이미 정한 외곽 { center: 경위도, pts: 그 중심 기준 m }을 2D에 보여 준다
export function showOutline(geo) {
  draw.shown = geo && geo.pts && geo.pts.length >= 3 ? geo : null;
  renderOutline();
  showOutlineOnMap();
}
export function showContextMap() { if (ctx && !$("context-view").hidden) setMode("map"); }
export function contextCenter() {
  return ctx ? { x: ctx.point.x, y: ctx.point.y } : null;
}
window.addEventListener("keydown", (e) => {
  if (!draw.on) return;
  if (e.key === "Backspace") { draw.pts.pop(); renderOutline(); e.preventDefault(); }
  if (e.key === "Escape") { draw.on = false; draw.pts = []; draw.hover = null; renderOutline(); $("context-status").textContent = "외곽 그리기를 그만뒀습니다."; }
});

// 영역(model.bbox)을 덮는 지도 타일을 한 장의 캔버스로 붙여 3D 바닥 텍스처로 쓴다. 타일이 올 때마다 onUpdate.
function groundTexture(model, onUpdate) {
  const b = model.bbox;
  if (!b) return null;
  const cy = (b.s + b.n) / 2;
  const W = 2 * model.hx;
  const H = 2 * model.hy;
  // 캔버스 긴 변 최대 4096px, 타일 수 최대 144장
  let z = Math.max(12, Math.min(19, Math.round(Math.log2((40075016 * Math.cos((cy * Math.PI) / 180)) / (256 * (Math.max(W, H) / 3000))))));
  const n0 = (zz) => 2 ** zz;
  const lon2x = (lon, n) => Math.floor(((lon + 180) / 360) * n);
  const lat2y = (lat, n) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  while (z > 12) {
    const n = n0(z);
    if ((lon2x(b.e, n) - lon2x(b.w, n) + 1) * (lat2y(b.s, n) - lat2y(b.n, n) + 1) <= 144) break;
    z -= 1;
  }
  const n = n0(z);
  const x2lon = (x) => (x / n) * 360 - 180;
  const y2lat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const scale = Math.min(4096 / W, 4096 / H, 4);   // px per m
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.round(W * scale));
  canvas.height = Math.max(2, Math.round(H * scale));
  const g = canvas.getContext("2d");
  g.fillStyle = "#e9e2d4";
  g.fillRect(0, 0, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const toPx = ([lx, ly]) => [(lx + model.hx) * scale, (model.hy - ly) * scale];
  const url = WMTS("Base");
  for (let x = lon2x(b.w, n); x <= lon2x(b.e, n); x += 1) {
    for (let y = lat2y(b.n, n); y <= lat2y(b.s, n); y += 1) {
      const [px0, py0] = toPx(model.toLocal([x2lon(x), y2lat(y)]));
      const [px1, py1] = toPx(model.toLocal([x2lon(x + 1), y2lat(y + 1)]));
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.referrerPolicy = "no-referrer";
      img.onload = () => {
        try { g.drawImage(img, px0, py0, px1 - px0, py1 - py0); onUpdate(); } catch (e) { /* 무시 */ }
      };
      img.src = url.replace("{z}", z).replace("{y}", y).replace("{x}", x);
    }
  }
  return tex;
}

function stop3d() {
  if (!three) return;
  cancelAnimationFrame(three.frame);
  three.controls.dispose();
  three.renderer.dispose();
  three.renderer.domElement.remove();
  three = null;
}

function draw3d(model) {
  stop3d();
  const box = $("context-3d");
  const w = box.clientWidth || 800;
  const h = box.clientHeight || 520;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(w, h);
  renderer.localClippingEnabled = true;
  box.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf3efe7);
  const { hx, hy } = model;
  const R = Math.max(hx, hy);
  const camera = new THREE.PerspectiveCamera(40, w / h, 1, R * 20);
  camera.position.set(R * 1.3, R * 1.5, R * 1.8);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.maxPolarAngle = Math.PI / 2.05;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9ad98, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(R, R * 2, R * 0.5);
  scene.add(sun);

  // 영역 밖은 잘라 낸다(큰 필지가 바닥 밖으로 삐져나오지 않게)
  const clip = [
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), hx), new THREE.Plane(new THREE.Vector3(1, 0, 0), hx),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), hy), new THREE.Plane(new THREE.Vector3(0, 0, 1), hy),
  ];

  // 바닥: 브이월드 일반지도를 텍스처로(지적도 도로 필지는 끊기거나 틀린 곳이 많아 쓰지 않음)
  const groundMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const tex = groundTexture(model, () => { if (groundMat.map) groundMat.map.needsUpdate = true; });
  if (tex) { groundMat.map = tex; } else groundMat.color.set(0xe9e2d4);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2 * hx, 2 * hy), groundMat);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const shapeOf = (ring) => new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)));
  const lineMat = new THREE.LineBasicMaterial({ color: 0xb3a892, clippingPlanes: clip });
  model.parcels.forEach((ring) => {
    const pts = ring.map(([x, y]) => new THREE.Vector3(x, 0.05, -y));
    scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
  });
  // 대지: 연한 반투명 주황(아래 지도·위성 바닥이 비쳐 보이게) + 진한 주황 테두리
  const siteMat = new THREE.MeshBasicMaterial({ color: 0xe8a25c, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: clip });
  const siteEdge = new THREE.LineBasicMaterial({ color: 0xc2701f, clippingPlanes: clip });
  model.siteRings.forEach((ring) => {
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shapeOf(ring)), siteMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.08;
    scene.add(mesh);
    const pts = ring.map(([x, y]) => new THREE.Vector3(x, 0.12, -y));
    scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), siteEdge));
  });
  // 그린 주차장 외곽(파란 선) + 램프 시작점(빨간 공)
  const og = draw.shown;
  if (og && og.center && og.pts && og.pts.length >= 3) {
    const kx = 111320 * Math.cos((og.center.y * Math.PI) / 180);
    const ky = 110540;
    const loc = ([x, y]) => model.toLocal([og.center.x + x / kx, og.center.y + y / ky]);
    const pts = og.pts.map((q) => { const [x, y] = loc(q); return new THREE.Vector3(x, 0.4, -y); });
    scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x1f4e79, linewidth: 2 })));
    const fill = new THREE.Mesh(new THREE.ShapeGeometry(shapeOf(og.pts.map(loc))), new THREE.MeshBasicMaterial({ color: 0x1f4e79, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
    fill.rotation.x = -Math.PI / 2;
    fill.position.y = 0.3;
    scene.add(fill);
    if (og.ramp) {
      const [x, y] = loc(og.ramp);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(Math.max(1.5, R / 60), 20, 14), new THREE.MeshBasicMaterial({ color: 0xe0312a }));
      ball.position.set(x, Math.max(1.5, R / 60), -y);
      scene.add(ball);
      if (og.rampTip) {
        const [tx, ty] = loc(og.rampTip);
        const hgt = Math.max(1.5, R / 60);
        const dirV = new THREE.Vector3(tx - x, 0, -(ty - y));
        const len = dirV.length();
        if (len > 0.5) scene.add(new THREE.ArrowHelper(dirV.normalize(), new THREE.Vector3(x, hgt, -y), len, 0xe0312a, Math.min(4, len * 0.35), Math.min(2.5, len * 0.2)));
      }
    }
  }
  const mat = new THREE.MeshLambertMaterial({ color: 0xc9c4ba });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x8a8578 });
  model.buildings.forEach((b) => {
    const geo = new THREE.ExtrudeGeometry(shapeOf(b.ring), { depth: b.h, bevelEnabled: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    scene.add(mesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeMat);
    edges.rotation.x = -Math.PI / 2;
    scene.add(edges);
  });

  const loop = () => {
    controls.update();
    renderer.render(scene, camera);
    three.frame = requestAnimationFrame(loop);
  };
  three = { renderer, controls, frame: 0 };
  loop();
}

// ── 지도 ──
const toBox = (bounds) => ({ w: bounds.getWest(), s: bounds.getSouth(), e: bounds.getEast(), n: bounds.getNorth() });
const toBounds = (b) => [[b.s, b.w], [b.n, b.e]];

function clampBox(b) {
  const size = boxSize(b);
  if (size.w <= MAX_SIDE && size.d <= MAX_SIDE) return { box: b, clamped: false };
  const cx = (b.w + b.e) / 2;
  const cy = (b.s + b.n) / 2;
  const fx = Math.min(1, MAX_SIDE / size.w);
  const fy = Math.min(1, MAX_SIDE / size.d);
  const hw = ((b.e - b.w) / 2) * fx;
  const hh = ((b.n - b.s) / 2) * fy;
  return { box: { w: cx - hw, e: cx + hw, s: cy - hh, n: cy + hh }, clamped: true };
}

function areaText(b, extra = "") {
  const s = boxSize(b);
  return `선택 영역 ${Math.round(s.w)} × ${Math.round(s.d)}m${extra}`;
}

function setRect(b) {
  ctx.bbox = b;
  if (rect) rect.setBounds(toBounds(b));
  else rect = window.L.rectangle(toBounds(b), { color: "#c2701f", weight: 2, fillOpacity: 0.08, dashArray: "6 4" }).addTo(map);
  $("context-area").textContent = areaText(b);
}

function finishRect(raw) {
  const size = boxSize(raw);
  if (size.w < 30 || size.d < 30) {
    if (ctx.prevBox && ctx.userBox) setRect(ctx.prevBox);
    else if (rect) { rect.remove(); rect = null; }
    $("context-area").textContent = "영역이 너무 작습니다. 다시 그려 주세요.";
    return;
  }
  const { box, clamped } = clampBox(raw);
  setRect(box);
  if (clamped) $("context-area").textContent = areaText(box, ` (한 변 최대 ${MAX_SIDE}m로 줄임)`);
  ctx.prevBox = box;
  ctx.userBox = true;
  // 영역을 고르면 바로 2D로 넘어간다
  setMode("2d");
}

// 왼쪽 드래그 = 영역 그리기, 오른쪽 드래그 = 지도 이동, 휠 = 확대·축소
function ensureMap() {
  const L = window.L;
  if (!L) throw new Error("지도 라이브러리(Leaflet)를 불러오지 못했습니다");
  if (map) return map;
  map = L.map("context-map", { zoomControl: true, attributionControl: true, dragging: false, boxZoom: false, doubleClickZoom: false, maxZoom: 22, wheelPxPerZoomLevel: 90 });
  // 타일은 19단계까지, 그 위(외곽을 세밀하게 그릴 때)는 19단계 타일을 확대해서 22단계까지
  const opts = { maxZoom: 22, maxNativeZoom: 19, minZoom: 6, referrerPolicy: "no-referrer", attribution: "© 브이월드(국토교통부)" };
  const base = L.tileLayer(WMTS("Base"), opts).addTo(map);
  const sat = L.tileLayer(WMTS("Satellite"), opts);
  L.control.layers({ "일반지도": base, "위성사진": sat }, null, { position: "topright" }).addTo(map);

  const el = $("context-map");
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  let pan = null;
  let start = null;
  el.addEventListener("mousedown", (e) => {
    if (e.target.closest(".leaflet-control")) return;
    if (drawHook && drawHook.down(e)) { e.preventDefault(); return; }
    if (e.button === 2) {
      pan = { x: e.clientX, y: e.clientY };
      el.classList.add("panning");
      e.preventDefault();
    } else if (e.button === 0) {
      start = map.mouseEventToLatLng(e);
      setRect({ w: start.lng, e: start.lng, s: start.lat, n: start.lat });
      e.preventDefault();
    }
  });
  window.addEventListener("mousemove", (e) => {
    if (drawHook) drawHook.move(e);
    if (pan) {
      map.panBy([pan.x - e.clientX, pan.y - e.clientY], { animate: false });
      pan = { x: e.clientX, y: e.clientY };
    } else if (start) {
      setRect(toBox(L.latLngBounds(start, map.mouseEventToLatLng(e))));
    }
  });
  window.addEventListener("mouseup", (e) => {
    if (drawHook) drawHook.up(e);
    if (pan) { pan = null; el.classList.remove("panning"); }
    if (start) {
      const raw = toBox(L.latLngBounds(start, map.mouseEventToLatLng(e)));
      start = null;
      finishRect(raw);
    }
  });
  map.on("move zoom zoomend resize", () => { if (drawHook) drawHook.redraw(); });
  return map;
}

// ── 지도 위 외곽 그리기(sketch.js가 씀) ──
// 좌표: 조회 지점(ctx.point) 기준 m. 그림은 지도 위에 겹친 SVG(화면 픽셀)에 그린다.
let drawHook = null;
let outlineLayer = null;
export function mapDrawApi() {
  if (!ctx) return null;
  const m = ensureMap();
  const el = $("context-map");
  let svg = document.getElementById("cx-draw-svg");
  if (!svg) {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.id = "cx-draw-svg";
    svg.setAttribute("class", "cx-draw-svg");
    el.appendChild(svg);
  }
  const c = ctx.point;
  const kx = 111320 * Math.cos((c.y * Math.PI) / 180);
  const ky = 110540;
  const toMeters = (e) => { const ll = m.mouseEventToLatLng(e); return [(ll.lng - c.x) * kx, (ll.lat - c.y) * ky]; };
  const toLatLng = ([x, y]) => [c.y + y / ky, c.x + x / kx];
  return {
    center: { x: c.x, y: c.y },
    svg,
    size: () => ({ w: el.clientWidth, h: el.clientHeight }),
    toMeters,
    toScreen: (p) => { const q = m.latLngToContainerPoint(toLatLng(p)); return [q.x, q.y]; },
    metersPerPixel: () => {
      const a = m.containerPointToLatLng([0, 0]); const b = m.containerPointToLatLng([100, 0]);
      return Math.abs((b.lng - a.lng) * kx) / 100 || 0.1;
    },
    panBy: (dx, dy) => m.panBy([dx, dy], { animate: false }),
    fit: (pts) => { if (pts.length) m.fitBounds(window.L.latLngBounds(pts.map(toLatLng)), { padding: [60, 60], animate: false }); },
    setHook: (hook) => {
      drawHook = hook;
      svg.style.display = hook ? "" : "none";
      el.classList.toggle("drawing", !!hook);
      $("context-view").classList.toggle("drawing-outline", !!hook);
      // 그리는 동안 지도 키보드(클릭하면 지도에 초점) 끔 → 숫자 입력이 명령줄로 감
      if (m.keyboard) { if (hook) { m.keyboard.disable(); el.blur(); } else m.keyboard.enable(); }
      if (outlineLayer) { if (hook) outlineLayer.remove(); else outlineLayer.addTo(m); }
    },
  };
}
// 그린 외곽을 지도에 표시(그리기가 끝난 뒤)
function showOutlineOnMap() {
  const L = window.L;
  if (!map || !L) return;
  if (outlineLayer) { outlineLayer.remove(); outlineLayer = null; }
  const g = draw.shown;
  if (!g || !g.center) return;
  const kx = 111320 * Math.cos((g.center.y * Math.PI) / 180);
  const ky = 110540;
  const ll = ([x, y]) => [g.center.y + y / ky, g.center.x + x / kx];
  outlineLayer = L.layerGroup([L.polygon(g.pts.map(ll), { color: "#1f4e79", weight: 3, fillColor: "#1f4e79", fillOpacity: 0.12, interactive: false })]);
  // 램프 시작점(빨간 원)
  if (g.ramp && g.rampTip) {
    outlineLayer.addLayer(L.polyline([ll(g.ramp), ll(g.rampTip)], { color: "#e0312a", weight: 3, interactive: false }));
    // 화살촉: 끝점에서 뒤로 비스듬히 두 선
    const [ax, ay] = g.ramp; const [bx, by] = g.rampTip; const len = Math.hypot(bx - ax, by - ay) || 1;
    const ux = (bx - ax) / len; const uy = (by - ay) / len; const h = Math.min(3, len * 0.35);
    const wing = (sgn) => [bx - h * (ux * Math.cos(0.45) - sgn * uy * Math.sin(0.45)), by - h * (uy * Math.cos(0.45) + sgn * ux * Math.sin(0.45))];
    outlineLayer.addLayer(L.polygon([ll(g.rampTip), ll(wing(1)), ll(wing(-1))], { color: "#e0312a", weight: 1, fillColor: "#e0312a", fillOpacity: 1, interactive: false }));
  }
  if (g.ramp) {
    const dot = L.circleMarker(ll(g.ramp), { radius: 8, color: "#fff", weight: 2.5, fillColor: "#e0312a", fillOpacity: 1, interactive: false });
    dot.bindTooltip("램프 시작", { permanent: true, direction: "top", offset: [0, -8], className: "cx-tip cx-ramp-tip" });
    outlineLayer.addLayer(dot);
  }
  if (!drawHook) outlineLayer.addTo(map);
}

let siteLayer = null;
let accessLayer = null;
function showMap() {
  const m = ensureMap();
  const L = window.L;
  const p = ctx.point;
  if (marker) marker.setLatLng([p.y, p.x]);
  else marker = L.circleMarker([p.y, p.x], { radius: 6, color: "#7a3e0a", weight: 2, fillColor: "#e8a25c", fillOpacity: 1, interactive: false }).addTo(m);
  // 조회한 필지 경계를 주황으로 + 이름표
  if (siteLayer) { siteLayer.remove(); siteLayer = null; }
  if (ctx.site && ctx.site.geometry) {
    siteLayer = L.geoJSON(ctx.site.geometry, { style: { color: "#c2701f", weight: 3, fillColor: "#e8a25c", fillOpacity: 0.35 }, interactive: false }).addTo(m);
  }
  if (accessLayer) { accessLayer.remove(); accessLayer = null; }
  showOutlineOnMap();
  marker.unbindTooltip();
  marker.bindTooltip(`대지 · ${(ctx.site && ctx.site.address) || ctx.title || ""}`, { permanent: true, direction: "top", offset: [0, -8], className: "cx-tip" });
  setTimeout(() => {
    m.invalidateSize();
    if (!ctx.viewSet) {
      const fit = L.latLngBounds(toBounds(ctx.bbox));
      if (siteLayer) {
        const sb = siteLayer.getBounds();
        // 필지가 아주 크면(캠퍼스 등) 영역 기준으로만 맞춘다
        if (boxSize(toBox(sb)).w < 1500) fit.extend(sb);
      }
      m.fitBounds(fit, { padding: [40, 40] });
      ctx.viewSet = true;
    }
  }, 0);
  // 처음 주소 조회 때는 기본 영역(사각형)을 그리지 않는다. 직접 드래그해서 고른 뒤에만 표시.
  if (ctx.userBox) setRect(ctx.bbox);
  else {
    if (rect) { rect.remove(); rect = null; }
    $("context-area").textContent = "왼쪽 드래그로 볼 영역을 그리면 2D로 넘어갑니다 (안 그리면 대지 주변 기본 범위)";
  }
}

// ── 화면 전환 ──
async function setMode(mode) {
  ["map", "2d", "3d"].forEach((k) => {
    $(`context-${k}`).hidden = k !== mode;
    $(`context-mode-${k}`).classList.toggle("on", k === mode);
  });
  $("context-area").hidden = mode !== "map";
  if (mode !== "3d") stop3d();
  if (mode === "map") {
    $("context-status").textContent = "왼쪽 드래그 = 영역 선택 · 오른쪽 드래그 = 지도 이동 · 휠 = 확대/축소 → 2D·3D로 보기 (한 변 최대 1km)";
    showMap();
    return;
  }
  $("context-status").textContent = "선택 영역의 필지·건물을 불러오는 중…";
  try {
    const b = ctx.bbox;
    const key = [b.w, b.s, b.e, b.n].map((v) => v.toFixed(6)).join(",");
    if (!cache || cache.key !== key) cache = { key, data: await surroundingsBox(b) };
    const data = cache.data;
    const model = prepare(data, ctx.site);
    const size = boxSize(b);
    const full = (data.buildings.length >= MAX_FEATURES || data.parcels.length >= MAX_FEATURES) ? ` · 자료가 ${MAX_FEATURES}개를 넘어 일부만 표시(영역을 줄여 보세요)` : "";
    $("context-status").textContent = `영역 ${Math.round(size.w)} × ${Math.round(size.d)}m · 필지 ${data.parcels.length}개 · 건물 ${model.buildings.length}동${full} · 높이 자료가 없으면 지상층수 × 층고(주거 3.0m · 업무·상업·교육 4.0m · 그 밖 3.3m) · 출처: 브이월드`;
    if (mode === "2d") draw2d(model); else draw3d(model);
  } catch (e) {
    $("context-status").textContent = `불러오기 실패: ${e && e.message ? e.message : e}`;
  }
}

// point: {x, y} 경위도, site: parcelAt() 결과(없어도 됨), mode: "map" | "2d" | "3d"
export function openContext(point, site, mode = "map", title = "", access = null) {
  const same = ctx && ctx.point.x === point.x && ctx.point.y === point.y;
  if (!same) { ctx = { point, site, title, access, bbox: boxAround(point.x, point.y, 200), viewSet: false }; cache = null; }
  else { ctx.site = site || ctx.site; ctx.access = access || ctx.access; }
  $("context-title").textContent = title ? `주변 매스 · ${title}` : "주변 매스";
  $("context-view").hidden = false;
  setMode(mode);
}

export function closeContext() {
  stop3d();
  $("context-view").hidden = true;
}

export function bindContextDialog() {
  $("context-close").addEventListener("click", closeContext);
  $("context-mode-map").addEventListener("click", () => setMode("map"));
  $("context-mode-2d").addEventListener("click", () => setMode("2d"));
  $("context-mode-3d").addEventListener("click", () => setMode("3d"));
}
