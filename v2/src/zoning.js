// 용도지역·필지·주변 매스 조회 (브이월드).
// 키는 github.io 도메인으로 등록되어 있어, 실행 위치와 무관하게 그 domain을 보냄(CORS 회피: JSONP).

export const MAX_FEATURES = 1000;

// 서비스 URL(dlrldbs0517-cpu.github.io)에 등록된 키
const VWORLD_KEY = "A4ECF279-47FE-4E55-B8B2-4DFC233EABA2";
const SERVICE_DOMAIN = "https://dlrldbs0517-cpu.github.io";

/** 국토계획법 시행령 제84·85조 상한(조례로 더 낮을 수 있음). */
const ZONE_LIMITS = {
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

const ZONE_LAYERS = ["LT_C_UQ111", "LT_C_UQ112", "LT_C_UQ113", "LT_C_UQ114"];

function serviceDomain() {
  return SERVICE_DOMAIN;
}

function jsonp(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const cb = `_vworld_cb_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    let settled = false;
    const script = document.createElement("script");
    script.referrerPolicy = "no-referrer";
    const timer = window.setTimeout(() => finish(new Error("응답 시간 초과")), timeoutMs);
    function finish(err, data) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try { delete window[cb]; } catch (_) { window[cb] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
      if (err) reject(err);
      else resolve(data);
    }
    window[cb] = (data) => finish(null, data);
    script.onerror = () => finish(new Error("네트워크 연결 실패"));
    const join = url.includes("?") ? "&" : "?";
    script.src = `${url}${join}callback=${cb}`;
    document.head.appendChild(script);
  });
}

async function fetchJson(url) {
  const res = await fetch(url, { referrerPolicy: "no-referrer" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function vworldGet(url) {
  // 브라우저: JSONP(CORS 회피). Node/테스트: fetch.
  if (typeof document !== "undefined") {
    try {
      return await jsonp(url);
    } catch (err) {
      // JSONP 실패 시 fetch 한 번 더(일부 환경)
      try { return await fetchJson(url); } catch (_) { throw err; }
    }
  }
  return fetchJson(url);
}

export function WMTS(layer = "Base") {
  const map = layer === "Satellite" ? "Satellite" : "Base";
  return `https://xdworld.vworld.kr/2d/${map}/service/{z}/{x}/{y}.png`;
}

/**
 * 배경 지도 타일 (브이월드 장애·차단 시).
 * - tile.openstreetmap.org 는 데이터센터에서 403
 * - Carto 무료 타일은 API KEY REQUIRED 워터마크
 * → OSM Germany 미러 사용 (키 없음)
 */
export function OSM_URL() {
  return "https://tile.openstreetmap.de/{z}/{x}/{y}.png";
}

/** ESRI 월드 이미지(위성) — 브이월드 위성 장애 시 */
export function ESRI_IMAGERY_URL() {
  return "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
}

/** 용도지역 WMS가 보이기 시작하는 줌 (부동산·토지이음 앱과 비슷하게 필지 스케일) */
export const ZONE_COLOR_ZOOM = 15;

export function vworldKey() {
  return VWORLD_KEY;
}

export function vworldDomain() {
  return SERVICE_DOMAIN;
}

/** Leaflet WMS용 용도지역 레이어(도시·관리·농림·자연환경) — 색으로 구역 구분 */
export function zoneWmsLayers() {
  return ZONE_LAYERS.map((layer) => ({
    id: layer,
    layers: layer,
    styles: layer,
  }));
}

export function WMS_URL() {
  return "https://api.vworld.kr/req/wms";
}

/** 경위도 점 기준 ±halfMeters 상자 (지도용 w/s/e/n) */
export function boxAround(x, y, halfMeters = 200) {
  const lat = Number(y) || 0;
  const lon = Number(x) || 0;
  const dLat = halfMeters / 111320;
  const dLon = halfMeters / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return { w: lon - dLon, e: lon + dLon, s: lat - dLat, n: lat + dLat };
}

/** bbox → 대략 m 단위 가로·세로 (경위도 w/e/s/n 또는 min/max) */
export function boxSize(bbox) {
  if (!bbox) return { w: 0, d: 0 };
  if (bbox.w != null && bbox.e != null) {
    const cy = ((Number(bbox.s) || 0) + (Number(bbox.n) || 0)) / 2;
    const kx = 111320 * Math.cos((cy * Math.PI) / 180);
    const ky = 111320;
    return {
      w: Math.max(0, (Number(bbox.e) - Number(bbox.w)) * kx),
      d: Math.max(0, (Number(bbox.n) - Number(bbox.s)) * ky),
    };
  }
  return {
    w: Math.max(0, (bbox.maxX ?? bbox[2] ?? 0) - (bbox.minX ?? bbox[0] ?? 0)),
    d: Math.max(0, (bbox.maxY ?? bbox[3] ?? 0) - (bbox.minY ?? bbox[1] ?? 0)),
  };
}

/** 토지이음(부동산·토지이용 열람)에서 같은 위치를 확인하는 링크 */
export function eumLandUrl(x, y) {
  if (x == null || y == null) return "https://www.eum.go.kr/web/ms/mz/map.jsp";
  return `https://www.eum.go.kr/web/ms/mz/map.jsp?x=${encodeURIComponent(x)}&y=${encodeURIComponent(y)}`;
}

export function storyHeight(props = {}) {
  const use = String(props.bdtyp_nm || props.mainPurpsCdNm || "");
  if (/주택|아파트|다세대|연립|기숙/.test(use)) return 3.0;
  if (/근린|문화|집회|판매|의료|교육|연구|업무|숙박/.test(use)) return 4.0;
  return 3.3;
}

export function buildingHeight(props = {}) {
  const h = Number(props.height || props.hei || 0);
  if (h > 0) return h;
  const floors = Number(props.grnd_flr || props.floor || 0);
  return floors > 0 ? floors * storyHeight(props) : storyHeight(props);
}

export function heightEstimated(props = {}) {
  const h = Number(props.height || props.hei || 0);
  return !(h > 0) && Number(props.grnd_flr || props.floor || 0) > 0;
}

export function isRoadParcel(props = {}) {
  const jibun = String(props.jibun || props.addr || props.lndcgrCodeNm || "");
  return /도$/.test(jibun.trim()) || String(props.lndcgrCodeNm || "") === "도로";
}

export function outerRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates[0] || []];
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.map((poly) => poly[0] || []).filter((r) => r.length);
  }
  return [];
}

export function lineParts(geometry) {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

export function localizer(originX, originY) {
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((originY * Math.PI) / 180);
  return ([x, y]) => [(x - originX) * mPerDegLon, (y - originY) * mPerDegLat];
}

export function realRoads(roadParcels = [], buildings = []) {
  const buildingPts = buildings.flatMap((f) => {
    const rings = outerRings(f.geometry);
    return rings.map((ring) => {
      const xs = ring.map((p) => p[0]);
      const ys = ring.map((p) => p[1]);
      return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    });
  });
  return roadParcels.filter((f) => {
    const rings = outerRings(f.geometry);
    return !rings.some((ring) => {
      const xs = ring.map((p) => p[0]);
      const ys = ring.map((p) => p[1]);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      return buildingPts.some((p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY);
    });
  });
}

/** 서울/광역시 등 주소 문자열로 주차장법 지역 키 추정 */
export function regionFromAddress(address = "") {
  const a = String(address);
  if (/서울/.test(a)) return "seoul";
  if (/과밀|성남|수원|고양|용인|창원|부산|대구|인천|광주|대전|울산/.test(a)) return "overcrowded";
  if (/특별시|광역시/.test(a)) return "metro";
  return "other";
}

function normalizeZoneName(name) {
  return String(name || "").replace(/\s+/g, "");
}

function limitsFor(name) {
  const key = normalizeZoneName(name);
  if (ZONE_LIMITS[key]) return ZONE_LIMITS[key];
  const hit = Object.entries(ZONE_LIMITS).find(([k]) => key.includes(k) || k.includes(key));
  return hit ? hit[1] : null;
}

async function nominatimFetch(url) {
  // 브라우저에서는 User-Agent를 바꿀 수 없음(금지 헤더). Accept만 지정.
  const headers = { Accept: "application/json" };
  if (typeof document === "undefined") {
    headers["User-Agent"] = "parking-designer/1.0 (local parking layout tool)";
  }
  const res = await fetch(url, { headers, referrerPolicy: "no-referrer" });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  return res.json();
}

function notFoundError(msg = "주소를 찾지 못했습니다") {
  const err = new Error(msg);
  err.notFound = true;
  return err;
}

/** Photon(Komoot) — 브라우저 CORS 허용, 브이월드·Nominatim 장애 시 좌표 폴백 */
async function photonSearch(address) {
  const q = encodeURIComponent(String(address || "").trim());
  // Photon은 한국어 locale 미지원(default|de|en|fr만). 잘못된 locale이면 400 → 주소 조회 전부 실패.
  const url = `https://photon.komoot.io/api/?q=${q}&limit=1&lang=default`;
  const data = await fetchJson(url);
  const hit = Array.isArray(data?.features) ? data.features[0] : null;
  if (!hit || !hit.geometry || !hit.geometry.coordinates) throw notFoundError();
  const [lon, lat] = hit.geometry.coordinates;
  const p = hit.properties || {};
  const label = [p.name, p.housenumber, p.street, p.district, p.city || p.county, p.state, p.country]
    .filter(Boolean)
    .join(" ")
    || address;
  return {
    address: label,
    point: { x: Number(lon), y: Number(lat) },
    source: "photon",
  };
}

async function photonReverse(x, y) {
  const url = `https://photon.komoot.io/reverse?lon=${encodeURIComponent(x)}&lat=${encodeURIComponent(y)}&lang=default`;
  const data = await fetchJson(url);
  const hit = Array.isArray(data?.features) ? data.features[0] : null;
  const p = hit?.properties || {};
  const label = [p.name, p.housenumber, p.street, p.district, p.city || p.county, p.state, p.country]
    .filter(Boolean)
    .join(" ");
  return label || null;
}

async function nominatimSearch(address) {
  const q = encodeURIComponent(String(address || "").trim());
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&addressdetails=1&countrycodes=kr`;
  const list = await nominatimFetch(url);
  const hit = Array.isArray(list) ? list[0] : null;
  if (!hit) throw notFoundError();
  return {
    address: hit.display_name || address,
    point: { x: Number(hit.lon), y: Number(hit.lat) },
    source: "nominatim",
  };
}

export async function reverseGeocode(x, y) {
  const fallback = `${Number(y).toFixed(5)}, ${Number(x).toFixed(5)}`;
  try {
    const photon = await photonReverse(x, y);
    if (photon) return photon;
  } catch (_) { /* continue */ }
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(y)}&lon=${encodeURIComponent(x)}&format=json&addressdetails=1&zoom=18`;
    const data = await nominatimFetch(url);
    return data?.display_name || fallback;
  } catch (_) {
    return fallback;
  }
}

async function geocodeFallbacks(address) {
  // 브라우저: Photon(CORS *) 우선. Node: Nominatim도 가능.
  const order = typeof document !== "undefined"
    ? [photonSearch, nominatimSearch]
    : [nominatimSearch, photonSearch];
  let lastNotFound = null;
  let lastErr = null;
  for (const fn of order) {
    try {
      return await fn(address);
    } catch (err) {
      if (err && err.notFound) lastNotFound = err;
      else lastErr = err;
    }
  }
  if (lastNotFound) throw lastNotFound;
  throw lastErr || notFoundError();
}

// 주소 → 좌표 (이식). 도로명(…로/…길 + 번호)인지 지번(…동/…리/…가 + 번호)인지 보고 그 방식으로 먼저 찾는다.
// 지번을 도로명으로 찾으면 브이월드가 '공릉동 172' → '공릉로 172'처럼 비슷한 도로명으로 고쳐 다른 곳을 줌
// → 고쳐진 주소(refined)에 입력한 도로명·동 이름이 그대로 있는지 확인한다.
export function addressKind(address) {
  const a = String(address || "");
  const road = a.match(/(\S+(?:로|길))\s*(\d+(?:-\d+)?)/);
  const parcel = a.match(/(\S+(?:동|리|가))\s*(?:산\s*)?(\d+(?:-\d+)?)/);
  if (road && (!parcel || road.index >= parcel.index)) return { first: "road", token: road[1] };
  if (parcel) return { first: "parcel", token: parcel[1] };
  return { first: "road", token: null };
}

// 도로명 주소 → 그 주소의 공식 지번 → 지번 좌표(도로명 좌표는 출입구 쪽이라 옆 필지에 떨어질 수 있음)
async function parcelOfRoad(roadText) {
  const domain = encodeURIComponent(serviceDomain());
  const query = String(roadText).replace(/\s*\(.*?\)\s*/g, " ").trim();
  const url = `https://api.vworld.kr/req/search?service=search&request=search&version=2.0&size=1&type=address&category=road&format=json&query=${encodeURIComponent(query)}&key=${VWORLD_KEY}&domain=${domain}`;
  const data = await vworldGet(url);
  const item = data?.response?.result?.items?.[0];
  const parcel = item?.address?.parcel;
  if (!parcel) return null;
  const head = query.split(/\s+/).filter((w) => /(시|도|군|구)$/.test(w)).slice(0, 3).join(" ");
  const full = `${head} ${parcel}`.trim();
  const url2 = `https://api.vworld.kr/req/address?service=address&request=getcoord&version=2.0&crs=epsg:4326&format=json&refine=true&simple=false&type=parcel&address=${encodeURIComponent(full)}&key=${VWORLD_KEY}&domain=${domain}`;
  const r2 = (await vworldGet(url2))?.response;
  if (!(r2 && r2.status === "OK" && r2.result?.point)) return null;
  return { x: Number(r2.result.point.x), y: Number(r2.result.point.y), parcel };
}

async function geocodeAddress(address) {
  const text = String(address || "").trim();
  const q = encodeURIComponent(text);
  const domain = encodeURIComponent(serviceDomain());
  const kind = addressKind(text);
  const tries = kind.first === "parcel" ? ["parcel", "road"] : ["road", "parcel"];
  let last = null;
  for (const type of tries) {
    const url = `https://api.vworld.kr/req/address?service=address&request=getcoord&version=2.0&crs=epsg:4326&address=${q}&refine=true&simple=false&format=json&type=${type}&key=${VWORLD_KEY}&domain=${domain}`;
    try {
      const data = await vworldGet(url);
      last = data;
      const status = data?.response?.status;
      const point = data?.response?.result?.point;
      if (status === "OK" && point) {
        const refined = data?.response?.refined?.text;
        // 입력한 도로명·동 이름이 고쳐진 주소에 없으면 엉뚱한 곳 → 버리고 다음 방식
        if (kind.token && refined && !refined.includes(kind.token)) continue;
        if (type === "road") {
          const jibun = await parcelOfRoad(refined || text).catch(() => null);
          if (jibun) return { address: `${refined || text} · 지번 ${jibun.parcel}`, point: { x: jibun.x, y: jibun.y }, source: "vworld" };
        }
        return { address: refined || text, point: { x: Number(point.x), y: Number(point.y) }, source: "vworld" };
      }
    } catch (err) {
      last = err;
    }
  }
  // 브이월드 장애·키 문제 시 Photon/Nominatim으로 좌표만 확보
  try {
    return await geocodeFallbacks(address);
  } catch (nomErr) {
    if (nomErr && nomErr.notFound) throw nomErr;
    if (last && last.response) {
      const msg = last.response?.error?.text || last.response?.status || "주소를 찾지 못했습니다";
      throw notFoundError(msg);
    }
    throw last instanceof Error ? last : nomErr;
  }
}

async function zonesAtPoint(x, y) {
  const domain = encodeURIComponent(serviceDomain());
  const geom = encodeURIComponent(`POINT(${x} ${y})`);
  const names = [];
  for (const layer of ZONE_LAYERS) {
    const url = `https://api.vworld.kr/req/data?service=data&request=GetFeature&data=${layer}&key=${VWORLD_KEY}&domain=${domain}&size=20&page=1&geometry=false&attribute=true&crs=EPSG:4326&geomFilter=${geom}`;
    try {
      const data = await vworldGet(url);
      const features = data?.response?.result?.featureCollection?.features
        || data?.response?.result?.featureCollection?.feature
        || [];
      const list = Array.isArray(features) ? features : [features];
      list.forEach((f) => {
        const props = f?.properties || f?.attribute || {};
        const uname = props.uname || props.UNAME || props.zonename || props.zone_nm;
        if (uname && !names.includes(uname)) names.push(uname);
      });
    } catch (_) {
      // 레이어별 실패는 무시하고 다음 레이어
    }
  }
  return names;
}

function packZones(zones) {
  const limits = {};
  (zones || []).forEach((z) => {
    const lim = limitsFor(z);
    if (lim) limits[z] = lim;
  });
  return limits;
}

/** 좌표로 용도지역·주소 조회 (지도 클릭용) */
export async function lookupZoningAt(x, y, hintAddress = "") {
  const address = hintAddress || (await reverseGeocode(x, y));
  let zones = [];
  try {
    zones = await zonesAtPoint(x, y);
  } catch (_) {
    zones = [];
  }
  return {
    address,
    point: { x: Number(x), y: Number(y) },
    zones,
    limits: packZones(zones),
    notFound: false,
    offline: zones.length === 0,
    eumUrl: eumLandUrl(x, y),
    source: "map",
  };
}

export async function lookupZoning(address) {
  const text = String(address || "").trim();
  if (!text) throw new Error("주소가 비어 있습니다");

  try {
    const geo = await geocodeAddress(text);
    let zones = [];
    try {
      zones = await zonesAtPoint(geo.point.x, geo.point.y);
    } catch (_) {
      zones = [];
    }
    return {
      address: geo.address,
      point: geo.point,
      zones,
      limits: packZones(zones),
      notFound: false,
      offline: zones.length === 0 && geo.source !== "vworld",
      eumUrl: eumLandUrl(geo.point.x, geo.point.y),
      source: geo.source || "vworld",
    };
  } catch (err) {
    if (err && err.notFound) {
      return { address: text, zones: [], limits: {}, notFound: true, point: null };
    }
    const region = regionFromAddress(text);
    const soft = new Error(
      `${err && err.message ? err.message : "조회 실패"}. 브이월드·지도 검색에 연결하지 못해 주소로 지역만 추정했습니다. «지도에서 찾기»로 위치를 고르거나 상세 입력에서 용도지역을 직접 고르세요.`,
    );
    soft.offline = true;
    soft.fallback = {
      address: text,
      point: null,
      zones: [],
      limits: {},
      notFound: false,
      offline: true,
      region,
      note: soft.message,
      eumUrl: eumLandUrl(),
    };
    throw soft;
  }
}

export async function parcelAt(x, y) {
  if (x == null || y == null) return null;
  const domain = encodeURIComponent(serviceDomain());
  const geom = encodeURIComponent(`POINT(${x} ${y})`);
  const url = `https://api.vworld.kr/req/data?service=data&request=GetFeature&data=LP_PA_CBND_BUBUN&key=${VWORLD_KEY}&domain=${domain}&size=5&page=1&geometry=true&attribute=true&crs=EPSG:4326&geomFilter=${geom}`;
  try {
    const data = await vworldGet(url);
    const features = data?.response?.result?.featureCollection?.features || [];
    const f = features[0];
    if (!f) return null;
    const props = f.properties || {};
    const area = Number(props.area || props.larea || props.pnucnt || 0);
    return {
      address: props.addr || props.jibun || props.pnu || "",
      jimok: props.jimok || props.lndcgrCodeNm || "",
      area: area > 0 ? area : null,
      geometry: f.geometry || null,
      props,
    };
  } catch (_) {
    return null;
  }
}

// ── 주변 매스·접도 (이식) ──
async function getFeatures(layer, geomFilter, size = 300, geometry = true) {
  const url = `https://api.vworld.kr/req/data?service=data&request=GetFeature&version=2.0&format=json&geometry=${geometry}&size=${size}`
    + `&data=${layer}&geomFilter=${encodeURIComponent(geomFilter)}&key=${VWORLD_KEY}&domain=${encodeURIComponent(serviceDomain())}`;
  const data = await vworldGetSlow(url);
  const r = data && data.response;
  if (!r || r.status === "NOT_FOUND") return [];
  if (r.status === "ERROR") throw new Error((r.error && r.error.text) || `${layer} 오류`);
  return (r.result && r.result.featureCollection && r.result.featureCollection.features) || [];
}

// 영역(경위도 상자 {w, s, e, n}) 안의 필지 경계·건물(높이·층수)·도로 중심선
// 주변 자료는 양이 많아(건물 1,000동) 느릴 때가 있어 기다리는 시간을 늘리고, 한 번 더 시도한다.
async function vworldGetSlow(url) {
  if (typeof document === "undefined") return fetchJson(url);
  try { return await jsonp(url, 20000); } catch (e1) {
    try { return await jsonp(url, 25000); } catch (e2) { throw e2; }
  }
}
export async function surroundingsBox(b) {
  const box = `BOX(${b.w},${b.s},${b.e},${b.n})`;
  const errs = [];
  const safe = (p, name) => p.catch((e) => { errs.push(`${name}: ${e && e.message ? e.message : e}`); return []; });
  const [parcels, buildings, roads] = await Promise.all([
    safe(getFeatures("LP_PA_CBND_BUBUN", box, MAX_FEATURES, true), "필지"),
    safe(getFeatures("LT_C_BLDGINFO", box, MAX_FEATURES, true), "건물"),
    safe(getFeatures("LT_L_SPRD", box, MAX_FEATURES, true), "도로"),
  ]);
  // 셋 다 실패면 오류, 일부만 실패면 받은 것만 그림
  if (errs.length === 3) throw new Error(`브이월드 응답 없음 (${errs.join(" · ")})`);
  return { bbox: b, center: { x: (b.w + b.e) / 2, y: (b.s + b.n) / 2 }, parcels, buildings, roads, partialErrors: errs };
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

