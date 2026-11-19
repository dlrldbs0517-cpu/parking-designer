// 주변 매스 보기: 주소 조회 뒤 대지 주변 필지·건물을 2D(평면) 또는 3D(높이만큼 세운 매스)로 보여 준다.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildingHeight, localizer, outerRings, surroundings } from "./zoning.js?v=226";

const $ = (id) => document.getElementById(id);
let cache = null;      // { key, data, site }
let three = null;      // { renderer, controls, frame }

function prepare(data, site) {
  const toLocal = localizer(data.center.x, data.center.y);
  const ring = (r) => r.map(toLocal);
  const parcels = data.parcels.flatMap((f) => outerRings(f.geometry).map(ring));
  const buildings = data.buildings.flatMap((f) => {
    const p = f.properties || {};
    const h = buildingHeight(p);
    const name = [p.bld_nm, p.dong_nm].filter(Boolean).join(" ");
    return outerRings(f.geometry).map((r) => ({ ring: ring(r), h, name, floors: p.grnd_flr }));
  });
  const siteRings = site && site.geometry ? outerRings(site.geometry).map(ring) : [];
  return { parcels, buildings, siteRings, radius: data.radius };
}

function pathOf(ring) {
  return ring.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${(-y).toFixed(2)}`).join("") + "Z";
}

function draw2d(model) {
  const R = model.radius;
  const maxH = Math.max(10, ...model.buildings.map((b) => b.h));
  const parcels = model.parcels.map((r) => `<path d="${pathOf(r)}" class="cx-parcel"/>`).join("");
  const site = model.siteRings.map((r) => `<path d="${pathOf(r)}" class="cx-site"/>`).join("");
  const builds = model.buildings.map((b) => {
    const t = 0.25 + 0.6 * Math.min(1, b.h / maxH);
    const tip = `${b.name || "건물"} · ${b.floors ? `지상 ${b.floors}층 · ` : ""}높이 ${b.h.toFixed(1)}m`;
    return `<path d="${pathOf(b.ring)}" class="cx-bldg" style="fill-opacity:${t.toFixed(2)}"><title>${tip}</title></path>`;
  }).join("");
  const bar = 50;
  $("context-2d").innerHTML = `
    <svg viewBox="${-R} ${-R} ${2 * R} ${2 * R}" class="cx-svg">
      <rect x="${-R}" y="${-R}" width="${2 * R}" height="${2 * R}" class="cx-bg"/>
      ${parcels}${site}${builds}
      <g class="cx-north" transform="translate(${R - 18} ${-R + 22})"><path d="M0 -12 L6 6 L0 2 L-6 6 Z"/><text y="20" text-anchor="middle">N</text></g>
      <g class="cx-bar" transform="translate(${-R + 12} ${R - 14})"><rect width="${bar}" height="3"/><text y="-4">${bar}m</text></g>
    </svg>`;
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
  box.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf3efe7);
  const R = model.radius;
  const camera = new THREE.PerspectiveCamera(40, w / h, 1, R * 20);
  camera.position.set(R * 0.9, R * 1.1, R * 1.3);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.maxPolarAngle = Math.PI / 2.05;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9ad98, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(R, R * 2, R * 0.5);
  scene.add(sun);

  // 바닥
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2 * R, 2 * R), new THREE.MeshLambertMaterial({ color: 0xe9e2d4 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const shapeOf = (ring) => new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)));
  const flat = (ring, color, lift) => {
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shapeOf(ring)), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = lift;
    return mesh;
  };
  // 필지 경계선
  const lineMat = new THREE.LineBasicMaterial({ color: 0xb3a892 });
  model.parcels.forEach((ring) => {
    const pts = ring.map(([x, y]) => new THREE.Vector3(x, 0.05, -y));
    scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
  });
  // 대지
  model.siteRings.forEach((ring) => scene.add(flat(ring, 0xe8a25c, 0.08)));
  // 건물 매스
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

function setMode(mode, model) {
  $("context-2d").hidden = mode !== "2d";
  $("context-3d").hidden = mode !== "3d";
  $("context-mode-2d").classList.toggle("on", mode === "2d");
  $("context-mode-3d").classList.toggle("on", mode === "3d");
  if (mode === "2d") { stop3d(); draw2d(model); } else draw3d(model);
}

// point: {x, y} 경위도, site: parcelAt() 결과(없어도 됨), mode: "2d" | "3d"
export async function openContext(point, site, mode = "2d", title = "") {
  const panel = $("context-view");
  $("context-title").textContent = title ? `주변 매스 · ${title}` : "주변 매스";
  $("context-status").textContent = "주변 필지·건물을 불러오는 중…";
  $("context-2d").innerHTML = "";
  panel.hidden = false;
  try {
    const key = `${point.x},${point.y}`;
    if (!cache || cache.key !== key) cache = { key, data: await surroundings(point.x, point.y, 200) };
    const model = prepare(cache.data, site);
    $("context-status").textContent = `반경 약 200m · 필지 ${cache.data.parcels.length}개 · 건물 ${cache.data.buildings.length}동 (높이 자료가 없으면 지상층수 × 3.3m) · 출처: 브이월드`;
    $("context-mode-2d").onclick = () => setMode("2d", model);
    $("context-mode-3d").onclick = () => setMode("3d", model);
    setMode(mode, model);
  } catch (e) {
    $("context-status").textContent = `불러오기 실패: ${e && e.message ? e.message : e}`;
  }
}

export function closeContext() {
  stop3d();
  $("context-view").hidden = true;
}

export function bindContextDialog() {
  $("context-close").addEventListener("click", closeContext);
}
