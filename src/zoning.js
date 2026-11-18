// 주소 → 용도지역 조회 (브이월드 오픈API)
// 1) 지오코더: 주소 → 좌표(EPSG:4326)  2) 2D 데이터: 좌표가 속한 용도지역(LT_C_UQ111~114)
// 키는 등록한 서비스 URL(https://dlrldbs0517-cpu.github.io)에서만 동작한다.

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

function domain() {
  return typeof location !== "undefined" ? location.origin : "";
}

export async function geocode(address) {
  for (const type of ["road", "parcel"]) {
    const url = `${API}/address?service=address&request=getcoord&version=2.0&crs=epsg:4326&format=json&refine=true&simple=false`
      + `&type=${type}&address=${encodeURIComponent(address)}&key=${VWORLD_KEY}&domain=${encodeURIComponent(domain())}`;
    const data = await call(url);
    const r = data && data.response;
    if (r && r.status === "OK" && r.result && r.result.point) {
      const refined = r.refined && r.refined.text;
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

// 주소 앞부분으로 주차장 조례 지역 구분 추정(서울 / 광역시). 그 밖은 사용자가 고른 값을 둔다.
export function regionFromAddress(address) {
  const a = squash(address);
  if (/^서울/.test(a)) return "seoul";
  if (/^(부산|대구|인천|광주|대전|울산)/.test(a) || /광역시/.test(a)) return "metro";
  return null;
}
