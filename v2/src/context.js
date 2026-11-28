// 주변 매스 보기: 주소 조회 뒤 오른쪽에 지도를 띄우고, 드래그로 고른 영역의 필지·건물을
// 2D(평면) 또는 3D(높이만큼 세운 매스)로 보여 준다. 지도는 Leaflet(전역 L) + 브이월드 WMTS 타일.
// Three.js·Leaflet은 필요할 때만 불러 초기 로딩을 줄인다.
import {
  MAX_FEATURES,
  OSM_URL,
  WMTS,
  WMS_URL,
  ZONE_COLOR_ZOOM,
  ESRI_IMAGERY_URL,
  boxAround,
  boxSize,
  buildingHeight,
  heightEstimated,
  isRoadParcel,
  lineParts,
  realRoads,
  localizer,
  outerRings,
  storyHeight,
  surroundingsBox,
  vworldDomain,
  vworldKey,
  zoneWmsLayers,
} from "./zoning.js?v=381";

const $ = (id) => document.getElementById(id);
const MAX_SIDE = 1000;   // 영역 한 변 최대(m). 브이월드가 레이어당 1,000개까지만 준다.

let ctx = null;        // { point, site, title, bbox, pickMode, onPick }
let cache = null;      // { key, data }
let three = null;      // { renderer, controls, frame }
let map = null;        // Leaflet 지도
let rect = null;       // 선택 영역 사각형
let marker = null;
let zoneOverlay = null;
let zoneLegendEl = null;
let THREE = null;
let OrbitControls = null;
let threePromise = null;
let leafletPromise = null;

function loadThree() {
  if (THREE && OrbitControls) return Promise.resolve();
  if (threePromise) return threePromise;
  threePromise = Promise.all([
    import("three"),
    import("three/addons/controls/OrbitControls.js"),
  ]).then(([threeMod, controlsMod]) => {
    THREE = threeMod;
    OrbitControls = controlsMod.OrbitControls;
  });
  return threePromise;
}

function loadLeaflet() {
  if (typeof window !== "undefined" && window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector("link[data-leaflet-css]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "vendor/leaflet/leaflet.css";
      link.dataset.leafletCss = "1";
      document.head.appendChild(link);
    }
    const existing = document.querySelector("script[data-leaflet-js]");
    if (existing) {
      if (window.L) { resolve(window.L); return; }
      existing.addEventListener("load", () => resolve(window.L));
      existing.addEventListener("error", () => reject(new Error("Leaflet load failed")));
      return;
    }
    const script = document.createElement("script");
    script.src = "vendor/leaflet/leaflet.js";
    script.dataset.leafletJs = "1";
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error("지도 라이브러리(Leaflet)를 불러오지 못했습니다"));
    document.head.appendChild(script);
  });
  return leafletPromise;
}

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
  // 브이월드 타일이 막히면 OSM.de로 2D 배경을 깐다
  const url = OSM_URL();
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
    drag = { x: e.clientX, y: e.clientY, scale };
    svg.classList.add("panning");
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    view = { ...view, x: view.x - (e.clientX - drag.x) / drag.scale, y: view.y - (e.clientY - drag.y) / drag.scale };
    drag.x = e.clientX; drag.y = e.clientY;
    apply();
  });
  window.addEventListener("mouseup", () => { if (drag) { drag = null; svg.classList.remove("panning"); } });
  svg.addEventListener("dblclick", () => { view = { ...full }; apply(); });
  apply();
}

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
  if (!THREE) return null;
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

async function draw3d(model) {
  stop3d();
  await loadThree();
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
  // 대지: 반투명 주황 + 진한 경계선(아래 지도가 비쳐 보이게)
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
    // 그냥 클릭(드래그 아님)이면 사각형을 안 남김
    if (ctx.prevBox && ctx.userBox) setRect(ctx.prevBox);
    else if (rect) { rect.remove(); rect = null; }
    $("context-area").textContent = "영역이 너무 작습니다. 다시 그려 주세요.";
    return;
  }
  const { box, clamped } = clampBox(raw);
  setRect(box);
  if (clamped) $("context-area").textContent = areaText(box, ` (한 변 최대 ${MAX_SIDE}m로 줄임)`);
  ctx.prevBox = box;
  ctx.bbox = box;
  ctx.userBox = true;
  // 영역을 고르면 바로 2D로 넘어간다
  setMode("2d");
}

function ensureZoneOverlay() {
  const L = window.L;
  if (!map || zoneOverlay) return zoneOverlay;
  const layers = {};
  zoneWmsLayers().forEach((z) => {
    layers[z.id] = L.tileLayer.wms(WMS_URL(), {
      version: "1.3.0",
      layers: z.layers,
      styles: z.styles,
      format: "image/png",
      transparent: true,
      opacity: 0.55,
      maxZoom: 21,
      minZoom: ZONE_COLOR_ZOOM,
      key: vworldKey(),
      domain: vworldDomain(),
      attribution: "용도지역 © 브이월드",
    });
  });
  zoneOverlay = L.layerGroup();
  Object.values(layers).forEach((ly) => zoneOverlay.addLayer(ly));
  return zoneOverlay;
}

function syncZoneOverlay() {
  if (!map) return;
  const group = ensureZoneOverlay();
  const show = map.getZoom() >= ZONE_COLOR_ZOOM;
  if (show) {
    if (!map.hasLayer(group)) group.addTo(map);
  } else if (map.hasLayer(group)) {
    map.removeLayer(group);
  }
  if (zoneLegendEl) zoneLegendEl.hidden = !show;
  const status = $("context-status");
  if (status && ctx && ctx.pickMode) {
    status.textContent = show
      ? `줌 ${map.getZoom()} · 용도지역 색 표시 중. 필지를 클릭하면 주소·용도지역을 채웁니다. (휠=확대/축소)`
      : `줌 ${map.getZoom()} · 휠로 ${ZONE_COLOR_ZOOM} 이상 확대하면 용도지역 색이 나타납니다. 클릭=위치 선택 · 우클릭 드래그=이동`;
  }
}

function ensureZoneLegend() {
  if (zoneLegendEl || !map) return;
  const L = window.L;
  const Control = L.Control.extend({
    onAdd() {
      const div = L.DomUtil.create("div", "cx-zone-legend");
      div.innerHTML = `
        <strong>용도지역</strong>
        <span class="z-res">주거</span>
        <span class="z-com">상업</span>
        <span class="z-ind">공업</span>
        <span class="z-grn">녹지·관리</span>
        <em>줌 ${ZONE_COLOR_ZOOM}+</em>`;
      div.hidden = true;
      zoneLegendEl = div;
      L.DomEvent.disableClickPropagation(div);
      return div;
    },
  });
  map.addControl(new Control({ position: "bottomleft" }));
}

// 왼쪽 드래그 = 영역 그리기(주변 매스) / 클릭 = 대지 선택(찾기 모드)
// 오른쪽 드래그 = 지도 이동, 휠 = 확대·축소
async function ensureMap() {
  const L = await loadLeaflet();
  if (!L) throw new Error("지도 라이브러리(Leaflet)를 불러오지 못했습니다");
  if (map) return map;
  map = L.map("context-map", {
    zoomControl: true,
    attributionControl: true,
    dragging: false,
    boxZoom: false,
    doubleClickZoom: false,
    scrollWheelZoom: true,
    minZoom: 6,
    maxZoom: 22,
  });
  const opts = { maxZoom: 22, maxNativeZoom: 19, minZoom: 6, referrerPolicy: "no-referrer", attribution: "© 브이월드(국토교통부)" };
  const base = L.tileLayer(WMTS("Base"), opts);
  const sat = L.tileLayer(WMTS("Satellite"), opts);
  // OSM.de: 브이월드·OSM.org 403·Carto 키요구 때도 키가 필요 없는 배경
  const osm = L.tileLayer(OSM_URL(), {
    maxZoom: 22, maxNativeZoom: 19,
    attribution: "© OpenStreetMap contributors",
  });
  const esriSat = L.tileLayer(ESRI_IMAGERY_URL(), {
    maxZoom: 22, maxNativeZoom: 19,
    attribution: "Tiles © Esri",
  });
  osm.addTo(map);
  let vworldBroken = false;
  base.on("tileerror", () => {
    if (vworldBroken) return;
    vworldBroken = true;
    if (map.hasLayer(base)) map.removeLayer(base);
    if (!map.hasLayer(osm)) osm.addTo(map);
  });
  sat.on("tileerror", () => {
    if (map.hasLayer(sat)) map.removeLayer(sat);
    if (!map.hasLayer(esriSat)) esriSat.addTo(map);
  });
  // 브이월드가 살아 있으면 위에 덮어 한국 지적 느낌 유지
  base.addTo(map);
  L.control.layers(
    { "일반지도": osm, "브이월드": base, "위성(ESRI)": esriSat, "위성(브이월드)": sat },
    null,
    { position: "topright" },
  ).addTo(map);

  ensureZoneOverlay();
  ensureZoneLegend();
  map.on("zoomend", syncZoneOverlay);
  map.on("zoom", syncZoneOverlay);

  const el = $("context-map");
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  // 휠 줌이 폼 스크롤로 새지 않게
  el.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

  let pan = null;
  let start = null;
  let moved = false;
  el.addEventListener("mousedown", (e) => {
    if (e.target.closest(".leaflet-control")) return;
    if (drawHook && drawHook.down(e)) { e.preventDefault(); return; }
    if (e.button === 2) {
      pan = { x: e.clientX, y: e.clientY };
      el.classList.add("panning");
      e.preventDefault();
    } else if (e.button === 0) {
      start = map.mouseEventToLatLng(e);
      moved = false;
      if (!ctx?.pickMode) {
        setRect({ w: start.lng, e: start.lng, s: start.lat, n: start.lat });
      }
      e.preventDefault();
    }
  });
  window.addEventListener("mousemove", (e) => {
    if (drawHook) drawHook.move(e);
    if (pan) {
      map.panBy([pan.x - e.clientX, pan.y - e.clientY], { animate: false });
      pan = { x: e.clientX, y: e.clientY };
    } else if (start && !ctx?.pickMode) {
      moved = true;
      setRect(toBox(L.latLngBounds(start, map.mouseEventToLatLng(e))));
    } else if (start && ctx?.pickMode) {
      const cur = map.mouseEventToLatLng(e);
      if (Math.hypot(cur.lat - start.lat, cur.lng - start.lng) > 0.00005) moved = true;
    }
  });
  window.addEventListener("mouseup", (e) => {
    if (drawHook) drawHook.up(e);
    if (pan) { pan = null; el.classList.remove("panning"); }
    if (!start) return;
    const end = map.mouseEventToLatLng(e);
    const from = start;
    start = null;
    if (ctx?.pickMode) {
      if (!moved && typeof ctx.onPick === "function") {
        ctx.onPick({ x: end.lng, y: end.lat });
      }
      return;
    }
    const raw = toBox(L.latLngBounds(from, end));
    finishRect(raw);
  });
  map.on("move zoom zoomend resize", () => { if (drawHook) drawHook.redraw(); });
  return map;
}

// ── 지도 위 외곽 그리기(sketch.js가 씀) ──
// 좌표: 조회 지점(ctx.point) 기준 m(동 +x, 북 +y). 그림은 지도 위에 겹친 SVG(화면 픽셀)에 그린다.
let drawHook = null;
let outlineLayer = null;
let outlineGeo = null;   // { center: {x,y} 경위도, pts: [[x,y]] m }
export async function mapDrawApi() {
  if (!ctx) return null;
  const m = await ensureMap();
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
      // 그리는 동안 지도 키보드 끔 → 숫자 입력이 명령줄로 감
      if (m.keyboard) { if (hook) { m.keyboard.disable(); el.blur(); } else m.keyboard.enable(); }
      if (rect) { if (hook) rect.remove(); else rect.addTo(m); }
      if (outlineLayer) { if (hook) outlineLayer.remove(); else outlineLayer.addTo(m); }
      // 그리기 창 크기(넓게 띄움)가 바뀌었으니 지도 크기 다시 맞춤
      setTimeout(() => m.invalidateSize(), 0);
    },
  };
}
// 그린 주차장 외곽을 지도에 파란 면으로 표시
export function setParkOutlineGeo(geo) {
  outlineGeo = geo && geo.center && geo.pts && geo.pts.length >= 3 ? geo : null;
  showOutlineOnMap();
}
function showOutlineOnMap() {
  const L = window.L;
  if (!map || !L) return;
  if (outlineLayer) { outlineLayer.remove(); outlineLayer = null; }
  const g = outlineGeo;
  if (!g) return;
  const kx = 111320 * Math.cos((g.center.y * Math.PI) / 180);
  const ky = 110540;
  const ll = ([x, y]) => [g.center.y + y / ky, g.center.x + x / kx];
  outlineLayer = L.polygon(g.pts.map(ll), { color: "#0f766e", weight: 3, fillColor: "#0f766e", fillOpacity: 0.12, interactive: false });
  outlineLayer.bindTooltip("주차장 외곽", { permanent: true, direction: "center", className: "cx-tip" });
  if (!drawHook) {
    outlineLayer.addTo(map);
    setTimeout(() => { map.invalidateSize(); map.fitBounds(outlineLayer.getBounds(), { padding: [30, 30], animate: false }); }, 60);
  }
}

let siteLayer = null;
let accessLayer = null;
async function showMap() {
  const m = await ensureMap();
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
  // 처음 주소 조회 때는 영역 사각형을 안 그림. 사용자가 드래그해서 고른 뒤에만 표시.
  if (ctx.userBox) setRect(ctx.bbox);
  else if (rect) { rect.remove(); rect = null; }
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
    $("context-status").textContent = ctx?.pickMode
      ? `클릭 = 대지 선택 · 우클릭 드래그 = 이동 · 휠 = 확대/축소 (줌 ${ZONE_COLOR_ZOOM}+ 에서 용도지역 색)`
      : "왼쪽 드래그 = 영역 선택 · 오른쪽 드래그 = 지도 이동 · 휠 = 확대/축소 → 2D·3D로 보기 (한 변 최대 1km)";
    try {
      await showMap();
      syncZoneOverlay();
    } catch (e) {
      $("context-status").textContent = `지도 불러오기 실패: ${e && e.message ? e.message : e}`;
    }
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
    const miss = (data.partialErrors || []).length ? ` · ⚠ 일부 자료를 못 받음(${data.partialErrors.map((t) => t.split(":")[0]).join("·")}) — 다시 누르면 재시도` : "";
    if (miss) cache = null;   // 다음에 다시 받아 보도록
    $("context-status").textContent = `영역 ${Math.round(size.w)} × ${Math.round(size.d)}m · 필지 ${data.parcels.length}개 · 건물 ${model.buildings.length}동${full}${miss} · 높이 자료가 없으면 지상층수 × 층고(주거 3.0m · 업무·상업·교육 4.0m · 그 밖 3.3m) · 출처: 브이월드`;
    if (mode === "2d") draw2d(model);
    else await draw3d(model);
  } catch (e) {
    cache = null;
    $("context-status").textContent = `불러오기 실패: ${e && e.message ? e.message : e} — 잠시 뒤 2D·3D를 다시 눌러 보세요`;
  }
}

// point: {x, y} 경위도, site: parcelAt() 결과(없어도 됨), mode: "map" | "2d" | "3d"
export function openContext(point, site, mode = "map", title = "", access = null) {
  const same = ctx && ctx.point && ctx.point.x === point.x && ctx.point.y === point.y && !ctx.pickMode;
  if (!same) {
    ctx = { point, site, title, access, bbox: boxAround(point.x, point.y, 200), viewSet: false, pickMode: false, onPick: null };
    cache = null;
  } else {
    ctx.site = site || ctx.site;
    ctx.access = access || ctx.access;
    ctx.pickMode = false;
    ctx.onPick = null;
  }
  $("context-title").textContent = title ? `주변 매스 · ${title}` : "주변 매스";
  $("context-view").hidden = false;
  setMode(mode);
}

/**
 * 주소 단계용: 지도를 열고 클릭한 지점을 onPick({x,y})로 돌려준다.
 * point가 없으면 서울 시청 근처를 기본으로 연다.
 */
export function openSitePicker(point, onPick, title = "지도에서 대지 찾기") {
  const p = point && Number.isFinite(point.x) && Number.isFinite(point.y)
    ? point
    : { x: 126.978, y: 37.5665 };
  ctx = {
    point: p,
    site: null,
    title,
    access: null,
    bbox: boxAround(p.x, p.y, 400),
    viewSet: false,
    pickMode: true,
    onPick: typeof onPick === "function" ? onPick : null,
  };
  cache = null;
  $("context-title").textContent = title;
  $("context-view").hidden = false;
  // 찾기 모드에서는 지도만
  ["map", "2d", "3d"].forEach((k) => {
    $(`context-${k}`).hidden = k !== "map";
    $(`context-mode-${k}`).classList.toggle("on", k === "map");
    if (k !== "map") $(`context-mode-${k}`).hidden = true;
  });
  $("context-area").hidden = true;
  setMode("map");
  // 모드 버튼 다시 보이기 위해 close 시 복구
}

export function closeContext() {
  stop3d();
  $("context-view").hidden = true;
  if (ctx) {
    ctx.pickMode = false;
    ctx.onPick = null;
  }
  ["2d", "3d"].forEach((k) => {
    const btn = $(`context-mode-${k}`);
    if (btn) btn.hidden = false;
  });
}

export function updatePickerMarker(point, label = "") {
  if (!point || !map) return;
  ctx = ctx || {};
  ctx.point = point;
  const L = window.L;
  if (marker) marker.setLatLng([point.y, point.x]);
  else marker = L.circleMarker([point.y, point.x], { radius: 6, color: "#7a3e0a", weight: 2, fillColor: "#e8a25c", fillOpacity: 1, interactive: false }).addTo(map);
  marker.unbindTooltip();
  marker.bindTooltip(label || "선택한 대지", { permanent: true, direction: "top", offset: [0, -8], className: "cx-tip" });
  map.panTo([point.y, point.x]);
  syncZoneOverlay();
}

export function bindContextDialog() {
  $("context-close").addEventListener("click", closeContext);
  $("context-mode-map").addEventListener("click", () => setMode("map"));
  $("context-mode-2d").addEventListener("click", () => {
    if (ctx?.pickMode) return;
    setMode("2d");
  });
  $("context-mode-3d").addEventListener("click", () => {
    if (ctx?.pickMode) return;
    setMode("3d");
  });
}
