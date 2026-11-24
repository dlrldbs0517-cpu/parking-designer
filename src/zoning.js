// 주소 → 용도지역 조회 (브이월드 오픈API)
// 1) 지오코더: 주소 → 좌표(EPSG:4326)  2) 2D 데이터: 좌표가 속한 용도지역(LT_C_UQ111~114)
// 키는 등록한 서비스 URL(https://dlrldbs0517-cpu.github.io)로 발급. localhost에서도 같은 domain 값을 보내 조회된다.

const VWORLD_KEY = "A4ECF279-47FE-4E55-B8B2-4DFC233EABA2";
const API = "https://api.vworld.kr/req";
// 용도지역 레이어: 도시·관리·농림·자연환경보전
const ZONE_LAYERS = ["LT_C_UQ111", "LT_C_UQ112", "LT_C_UQ113", "LT_C_UQ114"];

// 국토의 계획 및 이용에 관한 법률 시행령 제84조(건폐율)·제85조(용적률) 상한. 실제 값은 시·군 조례로 더 낮을 수 있다.
export const ZONE_LIMITS = {
  "제1종전용주거지역": { bcr: 50, far: 100 },
  "제2종전용주거지역": { bcr: 50, far: 150 },
  "제1종일반주거지역": { bcr: 60, far: 200 },
  "제2종일반주거지역": { bcr: 60, far: 250 },
  "제3종일반주거지역": { bcr: 50, far: 300 },
  "준주거지역": { bcr: 70, far: 500 },
  "중심상업지역": { bcr: 90, far: 1500 },
  "일반상업지역": { bcr: 80, far: 1300 },
  "근린상업지역": { bcr: 70, far: 900 },
  "유통상업지역": { bcr: 80, far: 1100 },
  "전용공업지역": { bcr: 70, far: 300 },
  "일반공업지역": { bcr: 70, far: 350 },
  "준공업지역": { bcr: 70, far: 400 },
  "보전녹지지역": { bcr: 20, far: 80 },
  "생산녹지지역": { bcr: 20, far: 100 },
  "자연녹지지역": { bcr: 20, far: 100 },
  "보전관리지역": { bcr: 20, far: 80 },
  "생산관리지역": { bcr: 20, far: 80 },
  "계획관리지역": { bcr: 40, far: 100 },
  "농림지역": { bcr: 20, far: 80 },
  "자연환경보전지역": { bcr: 20, far: 80 },
};

const squash = (s) => String(s || "").replace(/\s+/g, "");

export function zoneLimits(name) {
  return ZONE_LIMITS[squash(name)] || null;
}

let seq = 0;
// 브라우저에서 다른 도메인 API를 부르므로 JSONP(스크립트 태그)를 먼저 쓰고, 안 되면 fetch로 한 번 더.
function jsonp(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const name = `__vw_cb_${Date.now()}_${seq++}`;
    const script = document.createElement("script");
    const done = (fn, value) => {
      clearTimeout(timer);
      try { delete window[name]; } catch (e) { window[name] = undefined; }
      script.remove();
      fn(value);
    };
    const timer = setTimeout(() => done(reject, new Error("timeout")), timeout);
    window[name] = (data) => done(resolve, data);
    script.onerror = () => done(reject, new Error("load"));
    script.referrerPolicy = "no-referrer";
    script.src = `${url}&callback=${name}`;
    document.head.appendChild(script);
  });
}

async function call(url) {
  try {
    return await jsonp(url);
  } catch (e) {
    const res = await fetch(url);
    return res.json();
  }
}

// 키에 등록한 서비스 URL. 브이월드는 domain 값으로 키를 확인하므로, 내 컴퓨터(localhost)에서 실행해도 이 값을 보낸다.
const SERVICE_URL = "https://dlrldbs0517-cpu.github.io";
function domain() {
  return SERVICE_URL;
}

// 주소 → 좌표. 도로명(…로/…길 + 번호)인지 지번(…동/…리/…가 + 번호)인지 보고 그 방식으로 먼저 찾는다.
// 주의: 지번 주소를 도로명으로 찾으면 브이월드가 '공릉동 172' → '공릉로 172'처럼 비슷한 도로명으로 고쳐서
// 전혀 다른 곳을 돌려준다. 그래서 고쳐진 주소(refined)에 입력한 도로명·동 이름이 그대로 있는지 확인한다.
export function addressKind(address) {
  const a = String(address || "");
  const road = a.match(/(\S+(?:로|길))\s*(\d+(?:-\d+)?)/);
  const parcel = a.match(/(\S+(?:동|리|가))\s*(?:산\s*)?(\d+(?:-\d+)?)/);
  if (road && (!parcel || road.index >= parcel.index)) return { first: "road", token: road[1] };
  if (parcel) return { first: "parcel", token: parcel[1] };
  return { first: "road", token: null };
}

// 도로명 주소 → 그 주소의 지번(검색 API) → 지번 좌표. 못 찾으면 null.
async function parcelOfRoad(roadText) {
  const query = String(roadText).replace(/\s*\(.*?\)\s*/g, " ").trim();
  const url = `${API}/search?service=search&request=search&version=2.0&size=1&type=address&category=road&format=json`
    + `&query=${encodeURIComponent(query)}&key=${VWORLD_KEY}&domain=${encodeURIComponent(domain())}`;
  const data = await call(url);
  const item = data && data.response && data.response.result && data.response.result.items && data.response.result.items[0];
  const parcel = item && item.address && item.address.parcel;
  if (!parcel) return null;
  // 지번에는 시·군·구가 없으니 도로명 주소 앞부분(시·도 시·군·구)을 붙인다
  const head = query.split(/\s+/).filter((w) => /(시|도|군|구)$/.test(w)).slice(0, 3).join(" ");
  const full = `${head} ${parcel}`.trim();
  const url2 = `${API}/address?service=address&request=getcoord&version=2.0&crs=epsg:4326&format=json&refine=true&simple=false`
    + `&type=parcel&address=${encodeURIComponent(full)}&key=${VWORLD_KEY}&domain=${encodeURIComponent(domain())}`;
  const d2 = await call(url2);
  const r2 = d2 && d2.response;
  if (!(r2 && r2.status === "OK" && r2.result && r2.result.point)) return null;
  return { x: Number(r2.result.point.x), y: Number(r2.result.point.y), parcel };
}

export async function geocode(address) {
  const kind = addressKind(address);
  const order = kind.first === "parcel" ? ["parcel", "road"] : ["road", "parcel"];
  for (const type of order) {
    const url = `${API}/address?service=address&request=getcoord&version=2.0&crs=epsg:4326&format=json&refine=true&simple=false`
      + `&type=${type}&address=${encodeURIComponent(address)}&key=${VWORLD_KEY}&domain=${encodeURIComponent(domain())}`;
    const data = await call(url);
    const r = data && data.response;
    if (r && r.status === "OK" && r.result && r.result.point) {
      const refined = r.refined && r.refined.text;
      // 입력한 도로명·동 이름이 고쳐진 주소에 없으면 다른 곳으로 잘못 고친 것 → 버리고 다음 방식으로
      if (kind.token && refined && !refined.includes(kind.token)) continue;
      // 도로명 좌표는 건물 출입구 쪽 점이라 옆 필지에 떨어질 수 있다(과기대: 공릉로 232 → 하계동 78-1).
      // 그 도로명 주소의 공식 지번을 찾아 지번 좌표로 바꾼다.
      if (type === "road") {
        const jibun = await parcelOfRoad(refined || address).catch(() => null);
        if (jibun) return { ...jibun, text: `${refined || address} · 지번 ${jibun.parcel}`, type: "road", roadPoint: { x: Number(r.result.point.x), y: Number(r.result.point.y) } };
      }
      return { x: Number(r.result.point.x), y: Number(r.result.point.y), text: refined || address, type };
    }
    if (r && r.status === "ERROR") throw new Error((r.error && r.error.text) || "지오코더 오류");
  }
  return null;
}

export async function zonesAt(x, y) {
  const results = await Promise.all(ZONE_LAYERS.map(async (layer) => {
    const url = `${API}/data?service=data&request=GetFeature&version=2.0&format=json&geometry=false&size=10`
      + `&data=${layer}&geomFilter=${encodeURIComponent(`POINT(${x} ${y})`)}&key=${VWORLD_KEY}&domain=${encodeURIComponent(domain())}`;
    const data = await call(url);
    const r = data && data.response;
    if (!r) return [];
    if (r.status === "ERROR") throw new Error((r.error && r.error.text) || "데이터 API 오류");
    const feats = (r.result && r.result.featureCollection && r.result.featureCollection.features) || [];
    return feats.map((f) => f.properties && f.properties.uname).filter(Boolean);
  }));
  return [...new Set(results.flat())];
}

// 주소 → { address, zones: [이름], limits: {이름: {bcr, far}} }
export async function lookupZoning(address) {
  const point = await geocode(address);
  if (!point) return { address, zones: [], notFound: true };
  const zones = await zonesAt(point.x, point.y);
  const limits = {};
  zones.forEach((z) => { limits[z] = zoneLimits(z); });
  return { address: point.text, point, zones, limits };
}

// 주소(시·도 + 시·군)로 주차장법 시행령 별표 1의 지역 구분을 정한다.
// 서울 / 광역시·특별자치시·수도권(경기) 시 / 그 밖의 시·수도권 군 / 그 밖의 지역(군)
export function regionFromAddress(address) {
  const parts = String(address || "").trim().split(/\s+/);
  const sido = parts[0] || "";
  const sigungu = parts[1] || "";
  if (/^서울/.test(sido)) return "seoul";
  if (/광역시$|^(부산|대구|인천|광주|대전|울산)$/.test(sido) || /^세종/.test(sido)) return "metro";
  const isSi = /시$/.test(sigungu);
  const isGun = /군$/.test(sigungu);
  if (/^경기/.test(sido)) return isGun ? "city" : isSi ? "metro" : null;
  if (isSi) return "city";
  if (isGun) return "other";
  return null;
}

// ── 대지 필지·주변 매스 ──────────────────────────────────────────
async function getFeatures(layer, geomFilter, size = 300, geometry = true) {
  const url = `${API}/data?service=data&request=GetFeature&version=2.0&format=json&geometry=${geometry}&size=${size}`
    + `&data=${layer}&geomFilter=${encodeURIComponent(geomFilter)}&key=${VWORLD_KEY}&domain=${encodeURIComponent(domain())}`;
  const data = await call(url);
  const r = data && data.response;
  if (!r || r.status === "NOT_FOUND") return [];
  if (r.status === "ERROR") throw new Error((r.error && r.error.text) || `${layer} 오류`);
  return (r.result && r.result.featureCollection && r.result.featureCollection.features) || [];
}

// 좌표(경위도)가 속한 필지 + 토지특성(공부상 면적·지목)
export async function parcelAt(x, y) {
  const feats = await getFeatures("LP_PA_CBND_BUBUN", `POINT(${x} ${y})`, 5, true);
  const f = feats[0];
  if (!f) return null;
  const pnu = f.properties && f.properties.pnu;
  let land = null;
  const year = new Date().getFullYear();
  for (const y0 of [year, year - 1, year - 2]) {
    try {
      const url = `https://api.vworld.kr/ned/data/getLandCharacteristics?pnu=${pnu}&stdrYear=${y0}&format=json&numOfRows=1&pageNo=1&key=${VWORLD_KEY}&domain=${encodeURIComponent(domain())}`;
      const data = await call(url);
      const field = data && data.landCharacteristicss && data.landCharacteristicss.field;
      if (field && field.length) { land = field[0]; break; }
    } catch (e) { /* 다음 해 */ }
  }
  return {
    pnu,
    address: f.properties && f.properties.addr,
    geometry: f.geometry,
    area: land ? Number(land.lndpclAr) : null,
    jimok: land ? land.lndcgrCodeNm : null,
  };
}

// 영역(경위도 상자 {w, s, e, n}) 안의 필지 경계와 건물(높이·층수). 레이어마다 한 번에 1,000개까지.
export const MAX_FEATURES = 1000;
export async function surroundingsBox(b) {
  const box = `BOX(${b.w},${b.s},${b.e},${b.n})`;
  const [parcels, buildings, roads] = await Promise.all([
    getFeatures("LP_PA_CBND_BUBUN", box, MAX_FEATURES, true).catch(() => []),
    getFeatures("LT_C_BLDGINFO", box, MAX_FEATURES, true),
    getFeatures("LT_L_SPRD", box, MAX_FEATURES, true).catch(() => []),
  ]);
  return { bbox: b, center: { x: (b.w + b.e) / 2, y: (b.s + b.n) / 2 }, parcels, buildings, roads };
}

// 점 중심 반경 radius m 상자
export function boxAround(x, y, radius = 200) {
  const dLat = radius / 110540;
  const dLon = radius / (111320 * Math.cos((y * Math.PI) / 180));
  return { w: x - dLon, s: y - dLat, e: x + dLon, n: y + dLat };
}

// 상자 가로·세로 길이(m)
export function boxSize(b) {
  const cy = (b.s + b.n) / 2;
  return { w: (b.e - b.w) * 111320 * Math.cos((cy * Math.PI) / 180), d: (b.n - b.s) * 110540 };
}

export const WMTS = (layer) => `https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/${layer}/{z}/{y}/{x}.${layer === "Satellite" ? "jpeg" : "png"}`;

// 경위도 → 대지 중심 기준 m 좌표(동쪽 +x, 북쪽 +y)
export function localizer(cx, cy) {
  const kx = 111320 * Math.cos((cy * Math.PI) / 180);
  const ky = 110540;
  return ([lon, lat]) => [(lon - cx) * kx, (lat - cy) * ky];
}

// GeoJSON Polygon/MultiPolygon → 바깥 고리 목록 [[ [x,y], ... ], ...]
export function outerRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates[0]];
  if (geometry.type === "MultiPolygon") return geometry.coordinates.map((poly) => poly[0]);
  return [];
}

// 높이 자료가 없을 때 쓰는 층고 어림값(우리가 정한 값, 법 기준 아님). 건축물 주용도 코드(usability) 앞 두 자리로 나눈다.
// 01 단독·02 공동주택 → 3.0m / 03·04 근린생활·05 문화집회·07 판매·09 의료·10 교육연구·14 업무·15 숙박 → 4.0m / 그 밖 3.3m
export function storyHeight(props) {
  const use = String((props && props.usability) || "").padStart(5, "0").slice(0, 2);
  if (use === "01" || use === "02") return 3.0;
  if (["03", "04", "05", "07", "09", "10", "14", "15"].includes(use)) return 4.0;
  return 3.3;
}

export function buildingHeight(props) {
  const h = Number(props && props.height);
  if (h > 0.5) return h;
  const f = Number(props && props.grnd_flr);
  return (f > 0 ? f : 1) * storyHeight(props);
}

export function heightEstimated(props) {
  return !(Number(props && props.height) > 0.5);
}

// 지적도 지번 끝 글자가 지목. "564도" → 도로
export function isRoadParcel(props) {
  return /도$/.test(String((props && props.jibun) || "").trim());
}

// 지목은 '도'인데 실제로 건물이 서 있는 필지(오래된 동네에 흔함)는 도로로 보지 않는다.
// 큰 도로 필지에도 지하철 출입구·버스정류장 같은 작은 건물이 있으므로, 건물 바닥이 필지 면적의 25% 이상일 때만 뺀다.
function ringArea(ring) {
  const cy = ring[0][1];
  const kx = 111320 * Math.cos((cy * Math.PI) / 180);
  const ky = 110540;
  let a = 0;
  for (let i = 0; i < ring.length - 1; i += 1) a += ring[i][0] * kx * ring[i + 1][1] * ky - ring[i + 1][0] * kx * ring[i][1] * ky;
  return Math.abs(a) / 2;
}
export function realRoads(roadFeats, buildingFeats) {
  const blds = buildingFeats.flatMap((f) => outerRings(f.geometry).map((r) => {
    const n = r.length;
    return { c: [r.reduce((a, p) => a + p[0], 0) / n, r.reduce((a, p) => a + p[1], 0) / n], area: ringArea(r) };
  }));
  return roadFeats.filter((f) => {
    const rings = outerRings(f.geometry);
    const area = rings.reduce((a, r) => a + ringArea(r), 0);
    if (!(area > 0)) return true;
    const covered = blds.filter((b) => rings.some((ring) => inRingLL(b.c, ring))).reduce((a, b) => a + b.area, 0);
    return covered / area < 0.25;
  });
}
function inRingLL(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// GeoJSON 선(LineString/MultiLineString) → 선 목록
export function lineParts(geometry) {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

function inRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

const DIR_NAME = { n: "북측", e: "동측", s: "남측", w: "서측" };

// 대지 필지의 어느 변이 도로(지목 '도' 필지)에 붙어 있는지. 변을 3m 간격으로 짚어 바깥 1.5m 지점이 도로 필지 안이면 접도.
export async function roadAccess(site) {
  if (!site || !site.geometry) return null;
  const rings = outerRings(site.geometry);
  if (!rings.length) return null;
  const all = rings.flat();
  const lons = all.map((p) => p[0]);
  const lats = all.map((p) => p[1]);
  const pad = 0.0004;   // 약 40m
  const box = { w: Math.min(...lons) - pad, e: Math.max(...lons) + pad, s: Math.min(...lats) - pad, n: Math.max(...lats) + pad };
  const bbox = `BOX(${box.w},${box.s},${box.e},${box.n})`;
  const [parcels, lines, blds] = await Promise.all([
    getFeatures("LP_PA_CBND_BUBUN", bbox, MAX_FEATURES, true),
    getFeatures("LT_L_SPRD", bbox, MAX_FEATURES, true).catch(() => []),
    getFeatures("LT_C_BLDGINFO", bbox, MAX_FEATURES, true).catch(() => []),
  ]);
  const cx = (box.w + box.e) / 2;
  const cy = (box.s + box.n) / 2;
  const L = localizer(cx, cy);
  // 도로 = 지목 '도' 필지(건물이 들어찬 것 제외)
  const roadRings = realRoads(parcels.filter((f) => isRoadParcel(f.properties)), blds)
    .flatMap((f) => outerRings(f.geometry).map((r) => r.map(L)));
  const roadLines = lines.flatMap((f) => lineParts(f.geometry).map((pts) => ({ name: (f.properties && f.properties.rn) || "", pts: pts.map(L) })));
  const sides = {};
  const edges = [];
  rings.forEach((ringLL) => {
    const ring = ringLL.map(L);
    let area = 0;
    for (let i = 0; i < ring.length - 1; i += 1) area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    const ccw = area > 0;
    for (let i = 0; i < ring.length - 1; i += 1) {
      const a = ring[i];
      const b = ring[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.5) continue;
      const ux = (b[0] - a[0]) / len;
      const uy = (b[1] - a[1]) / len;
      const nx = ccw ? uy : -uy;   // 바깥쪽 법선
      const ny = ccw ? -ux : ux;
      const steps = Math.max(1, Math.round(len / 3));
      let hit = 0;
      for (let k = 0; k < steps; k += 1) {
        const t = (k + 0.5) / steps;
        const pt = [a[0] + (b[0] - a[0]) * t + nx * 1.5, a[1] + (b[1] - a[1]) * t + ny * 1.5];
        if (roadRings.some((r) => inRing(pt, r))) hit += 1;
      }
      if (hit / steps < 0.5) continue;
      const dir = Math.abs(nx) > Math.abs(ny) ? (nx > 0 ? "e" : "w") : (ny > 0 ? "n" : "s");
      // 가까운 도로 중심선의 이름
      const mid = [(a[0] + b[0]) / 2 + nx * 6, (a[1] + b[1]) / 2 + ny * 6];
      let name = "";
      let best = 40;
      roadLines.forEach((l) => {
        for (let j = 0; j < l.pts.length - 1; j += 1) {
          const d = segDist(mid, l.pts[j], l.pts[j + 1]);
          if (d < best && l.name) { best = d; name = l.name; }
        }
      });
      const sd = sides[dir] || (sides[dir] = { dir, label: DIR_NAME[dir], len: 0, names: new Set() });
      sd.len += len;
      if (name) sd.names.add(name);
      // 원래 경위도 좌표로 보관(지도·2D에서 다시 그림)
      edges.push({ dir, a: ringLL[i], b: ringLL[i + 1] });
    }
  });
  const list = Object.values(sides).map((sd) => ({ ...sd, len: Math.round(sd.len), names: [...sd.names] })).sort((p, q) => q.len - p.len);
  return { sides: list, edges, main: list[0] ? list[0].dir : null };
}
