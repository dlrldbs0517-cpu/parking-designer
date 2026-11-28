import { chargerRect } from "./stallMarks.js?v=365";
/**
 * AutoCAD DXF(AC1015) → DWG(R2000) 내보내기.
 * 단위: 평면 m. unitScale — mm면 ×1000.
 * 한글: \U+XXXX 이스케이프, 스타일 malgun.ttf.
 * 레이어별 ACI 색으로 기둥·코어·주차칸 종류를 구분한다.
 */
import { closedRing, polygonFromPlate } from "./polygon.js?v=365";
import { rampFootprint, rampShape, siteMarginsOf } from "./layout.js?v=365";
import { buildChain } from "./rampModules.js?v=365";

/** [name, ACI color, linetype] — 색은 모두 다르게 (주차 종류·기둥·코어 구분) */
const LAYERS = [
  ["PD-PLATE", 253, "CONTINUOUS"],     // 거의 검 — 외곽
  ["PD-SETBACK", 9, "DASHED"],         // 연회 — 이격
  ["PD-AISLE", 8, "CONTINUOUS"],       // 진회 — 차로
  ["PD-ARROW", 150, "CONTINUOUS"],     // 하늘 — 동선
  ["PD-STALL", 4, "CONTINUOUS"],       // 청록 — 일반 주차
  ["PD-STALL-EXT", 3, "CONTINUOUS"],   // 초록 — 확장형
  ["PD-STALL-ACC", 5, "CONTINUOUS"],   // 파랑 — 장애인
  ["PD-STALL-EV", 30, "CONTINUOUS"],   // 주황 — 친환경
  ["PD-STALL-PAR", 6, "CONTINUOUS"],   // 자홍 — 평행
  ["PD-EV-CHARGER", 30, "CONTINUOUS"], // 주황 — 전기차 충전기
  ["PD-COLUMN", 250, "CONTINUOUS"],    // 진회 — 기둥
  ["PD-CORE", 1, "CONTINUOUS"],        // 빨강 — 코어
  ["PD-TOWER", 211, "CONTINUOUS"],     // 분홍 — 타워
  ["PD-RAMP", 40, "CONTINUOUS"],       // 노랑 — 램프
  ["PD-DIM", 142, "CONTINUOUS"],       // 청회 — 치수
  ["PD-TEXT", 7, "CONTINUOUS"],        // 흰/검 — 문자
];

const LAYER_COLOR = Object.fromEntries(LAYERS.map(([n, c]) => [n, c]));

const STALL_LAYER = {
  general: "PD-STALL",
  extended: "PD-STALL-EXT",
  disabled: "PD-STALL-ACC",
  eco: "PD-STALL-EV",
  parallel: "PD-STALL-PAR",
};

function r3(v) { return Math.round(Number(v) * 1000) / 1000; }

function layerColor(layer) {
  return LAYER_COLOR[layer] ?? 7;
}

/** 한글·비ASCII → DXF \U+XXXX */
export function dxfText(str) {
  const s = String(str ?? "");
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp < 128 && ch !== "\\") out += ch;
    else if (ch === "\\") out += "\\\\";
    else out += `\\U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return out;
}

function pair(code, value) {
  return `${code}\n${value}\n`;
}

function lwpoly(layer, pts, closed = true, scale = 1) {
  const ring = closed ? closedRing(pts) : pts.slice();
  const verts = closed
    && Math.hypot(ring[0].x - ring[ring.length - 1].x, ring[0].y - ring[ring.length - 1].y) < 1e-6
    ? ring.slice(0, -1)
    : ring;
  let s = pair(0, "LWPOLYLINE") + pair(8, layer) + pair(62, layerColor(layer))
    + pair(90, verts.length) + pair(70, closed ? 1 : 0);
  verts.forEach((p) => {
    s += pair(10, r3(p.x * scale)) + pair(20, r3(p.y * scale));
  });
  return s;
}

function line(layer, x1, y1, x2, y2, scale = 1) {
  return pair(0, "LINE") + pair(8, layer) + pair(62, layerColor(layer))
    + pair(10, r3(x1 * scale)) + pair(20, r3(y1 * scale))
    + pair(11, r3(x2 * scale)) + pair(21, r3(y2 * scale));
}

function text(layer, x, y, h, str, scale = 1, align = 0) {
  let s = pair(0, "TEXT") + pair(8, layer) + pair(62, layerColor(layer))
    + pair(10, r3(x * scale)) + pair(20, r3(y * scale))
    + pair(40, r3(h * scale))
    + pair(1, dxfText(str))
    + pair(7, "MALGUN")
    + pair(72, align);
  if (align) s += pair(11, r3(x * scale)) + pair(21, r3(y * scale));
  return s;
}

/** 기둥 등은 닫힌 폴리라인만 쓴다(HATCH는 일부 CAD에서 로드 실패). */
function filledRect(layer, r, scale) {
  return lwpoly(layer, rectPts(r), true, scale);
}

function rectPts(r) {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.d },
    { x: r.x, y: r.y + r.d },
  ];
}

function expandOutwardManual(poly, m) {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const x0 = Math.min(...xs) - (m.w || 0);
  const y0 = Math.min(...ys) - (m.s || 0);
  const x1 = Math.max(...xs) + (m.e || 0);
  const y1 = Math.max(...ys) + (m.n || 0);
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

function arrow(layer, x1, y1, x2, y2, scale) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L;
  const uy = dy / L;
  const ah = Math.min(1.2, L * 0.25);
  const px = -uy;
  const py = ux;
  const left = { x: x2 - ux * ah + px * ah * 0.4, y: y2 - uy * ah + py * ah * 0.4 };
  const right = { x: x2 - ux * ah - px * ah * 0.4, y: y2 - uy * ah - py * ah * 0.4 };
  return line(layer, x1, y1, x2, y2, scale)
    + line(layer, x2, y2, left.x, left.y, scale)
    + line(layer, x2, y2, right.x, right.y, scale);
}

function dimSimple(layer, x1, y1, x2, y2, label, scale, textH = 0.5) {
  return line(layer, x1, y1, x2, y2, scale)
    + text(layer, (x1 + x2) / 2, (y1 + y2) / 2 + 0.3, textH, label, scale, 1);
}

function dxfHeader(unit) {
  return pair(0, "SECTION") + pair(2, "HEADER")
    + pair(9, "$ACADVER") + pair(1, "AC1015")
    + pair(9, "$DWGCODEPAGE") + pair(3, "ANSI_949")
    + pair(9, "$INSUNITS") + pair(70, unit === "mm" ? 4 : 6)
    + pair(9, "$MEASUREMENT") + pair(70, 1)
    + pair(0, "ENDSEC");
}

function dxfTables() {
  let s = pair(0, "SECTION") + pair(2, "TABLES");
  s += pair(0, "TABLE") + pair(2, "VPORT") + pair(70, 0) + pair(0, "ENDTAB");
  s += pair(0, "TABLE") + pair(2, "LTYPE") + pair(70, 2);
  s += pair(0, "LTYPE") + pair(2, "CONTINUOUS") + pair(70, 0) + pair(3, "Solid line") + pair(72, 65) + pair(73, 0) + pair(40, 0);
  s += pair(0, "LTYPE") + pair(2, "DASHED") + pair(70, 0) + pair(3, "Dashed") + pair(72, 65) + pair(73, 2) + pair(40, 0.75)
    + pair(49, 0.5) + pair(74, 0) + pair(49, -0.25) + pair(74, 0);
  s += pair(0, "ENDTAB");
  s += pair(0, "TABLE") + pair(2, "LAYER") + pair(70, LAYERS.length);
  LAYERS.forEach(([name, color, ltype]) => {
    s += pair(0, "LAYER") + pair(2, name) + pair(70, 0) + pair(62, color) + pair(6, ltype);
  });
  s += pair(0, "ENDTAB");
  s += pair(0, "TABLE") + pair(2, "STYLE") + pair(70, 1);
  s += pair(0, "STYLE") + pair(2, "MALGUN") + pair(70, 0) + pair(40, 0) + pair(41, 1) + pair(50, 0)
    + pair(71, 0) + pair(42, 1) + pair(3, "malgun.ttf") + pair(4, "");
  s += pair(0, "ENDTAB") + pair(0, "ENDSEC");
  return s;
}

function dxfBlocks() {
  // AC1015 호환: 빈 BLOCKS 섹션(일부 CAD가 ENTITIES만 있으면 거부)
  return pair(0, "SECTION") + pair(2, "BLOCKS") + pair(0, "ENDSEC");
}

/**
 * @param {object} state
 * @param {object} info summary-like
 * @param {object} opts { unit:'m'|'mm', floorIndex:number, allFloors:boolean, version:string }
 */
export function buildDxf(state, info = {}, opts = {}) {
  const unit = opts.unit === "m" ? "m" : "mm";
  const scale = unit === "mm" ? 1000 : 1;
  const floors = opts.allFloors
    ? Array.from({ length: Math.max(1, info.floors || state.metrics?.floors || 1) }, (_, i) => i)
    : [opts.floorIndex ?? 0];
  const plate = state.plate;
  if (!plate) throw new Error("평면이 없습니다.");
  const poly = polygonFromPlate(plate);
  const gap = Math.max(plate.width, plate.depth) * 0.25 + 8;

  let entities = "";
  let stallCount = 0;

  floors.forEach((fi, idx) => {
    const ox = idx * (plate.width + gap);
    const shift = (p) => ({ x: p.x + ox, y: p.y });
    const shiftR = (r) => ({ ...r, x: r.x + ox, y: r.y });

    entities += lwpoly("PD-PLATE", poly.map(shift), true, scale);

    const m = siteMarginsOf({
      ...plate,
      siteMargin: plate.siteMargin != null ? plate.siteMargin : state.siteMargin,
      siteMargins: plate.siteMargins || state.siteMargins,
    });
    entities += lwpoly("PD-SETBACK", expandOutwardManual(poly, m).map(shift), true, scale);

    (state.aisles || []).forEach((a) => {
      entities += lwpoly("PD-AISLE", rectPts(shiftR(a)), true, scale);
    });

    (state.drives || []).forEach((d) => {
      entities += arrow("PD-ARROW", d.x1 + ox, d.y1, d.x2 + ox, d.y2, scale);
    });

    (state.stalls || []).forEach((stall, i) => {
      const type = stall.parallel || stall.type === "parallel" ? "parallel" : (stall.type || "general");
      const layer = STALL_LAYER[type] || "PD-STALL";
      entities += lwpoly(layer, rectPts(shiftR(stall)), true, scale);
      if (type === "eco") entities += filledRect("PD-EV-CHARGER", shiftR(chargerRect(stall)), scale);
      entities += text("PD-TEXT", stall.x + stall.w / 2 + ox, stall.y + stall.d / 2, 0.4, String(stall.no || i + 1), scale, 1);
      stallCount += 1;
    });

    (state.columns || []).forEach((col) => {
      entities += filledRect("PD-COLUMN", shiftR(col), scale);
    });

    (state.cores || []).forEach((core) => {
      entities += lwpoly("PD-CORE", rectPts(shiftR(core)), true, scale);
    });

    (state.buildings || []).forEach((b) => {
      const core = (state.cores || []).find((c) => c.buildingId === b.id && (c.kind || "building") !== "stair");
      if (!core || !b.tower) return;
      const tw = b.tower;
      const r = { x: core.x + (tw.dx || 0) + ox, y: core.y + (tw.dy || 0), w: tw.w, d: tw.d };
      entities += lwpoly("PD-TOWER", rectPts(r), true, scale);
      entities += text("PD-TEXT", r.x + r.w / 2, r.y + r.d / 2, 0.8, b.name || "동", scale, 1);
    });

    (state.ramps || []).forEach((ramp) => {
      try {
        if (ramp.modules?.length) {
          buildChain(ramp).modules.forEach((mod) => {
            (mod.rects || []).forEach((r) => {
              entities += lwpoly("PD-RAMP", rectPts(shiftR(r)), true, scale);
            });
          });
        } else {
          const shape = rampShape(ramp, plate);
          const box = shape.footprint || rampFootprint(ramp, plate);
          entities += lwpoly("PD-RAMP", rectPts(shiftR(box)), true, scale);
          (shape.pieces || []).forEach((p) => {
            entities += lwpoly("PD-RAMP", rectPts(shiftR(p)), true, scale);
          });
        }
      } catch (e) {
        const box = rampFootprint(ramp, plate);
        entities += lwpoly("PD-RAMP", rectPts(shiftR(box)), true, scale);
      }
      const box = rampFootprint(ramp, plate);
      entities += text("PD-RAMP", box.x + box.w / 2 + ox, box.y + box.d / 2, 0.5, "램프", scale, 1);
    });

    entities += dimSimple("PD-DIM", ox, -2, ox + plate.width, -2, `${plate.width.toFixed(1)} m`, scale);
    entities += dimSimple("PD-DIM", ox + plate.width + 2, 0, ox + plate.width + 2, plate.depth, `${plate.depth.toFixed(1)} m`, scale);
    const gx = state.gridX || [];
    if (gx.length >= 2) {
      entities += dimSimple("PD-DIM", ox + gx[0], plate.depth + 2, ox + gx[1], plate.depth + 2, `${(gx[1] - gx[0]).toFixed(1)} m`, scale);
    }

    const title = [
      `프로젝트: ${info.demand?.projectName || state.demand?.projectName || "주차장"}`,
      `층: 지하 ${fi + 1}층` + (opts.allFloors ? ` (${idx + 1}/${floors.length})` : ""),
      `배치 대수: ${info.placed ?? state.stalls?.length ?? 0}대`,
      `법정 대수: ${info.required ?? plate.legalStalls ?? 0}대`,
      `날짜: ${info.checkedOn || new Date().toISOString().slice(0, 10)}`,
      `버전: ${opts.version || "r281"} · 단위 ${unit}`,
      "레이어: 기둥=PD-COLUMN · 코어=PD-CORE · 일반/확장/장애인/친환경/평행 주차칸 분리",
    ];
    title.forEach((t, i) => {
      entities += text("PD-TEXT", ox, -6 - i * 1.2, 0.6, t, scale, 0);
    });
  });

  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const meta = {
    layers: LAYERS.map((l) => l[0]),
    layerColors: Object.fromEntries(LAYERS.map(([n, c]) => [n, c])),
    stallEntities: stallCount,
    plateClosed: true,
    bounds: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
    poly,
  };

  const dxf = dxfHeader(unit) + dxfTables() + dxfBlocks()
    + pair(0, "SECTION") + pair(2, "ENTITIES") + entities + pair(0, "ENDSEC")
    + pair(0, "EOF");
  return { dxf, meta, stallCount, unit, scale };
}

export function cadFilename(state, floorIndex, allFloors, format = "dwg") {
  const v = state.variantIndex != null ? `V${state.variantIndex + 1}` : "plan";
  const floor = allFloors ? "all" : `B${(floorIndex ?? 0) + 1}`;
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const ext = format === "dxf" ? "dxf" : "dwg";
  return `parking_${v}_${floor}_${day}.${ext}`;
}

export function dxfFilename(state, floorIndex, allFloors) {
  return cadFilename(state, floorIndex, allFloors, "dxf");
}

export function downloadDxf(filename, dxfString) {
  const blob = new Blob([dxfString], { type: "application/dxf" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith(".dxf") ? filename : `${filename}.dxf`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function downloadBytes(filename, bytes, mime = "application/octet-stream") {
  const blob = new Blob([bytes], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** DXF 문자열을 AutoCAD R2000 DWG 바이트로 변환 (nasjidwg). */
export async function dxfToDwg(dxfString) {
  const { readDxf, writeDwg2000 } = await import("../vendor/nasjidwg/dist/index.js");
  const drawing = readDxf(dxfString);
  const { data, skipped = [], downgraded = [] } = writeDwg2000(drawing);
  if (!data?.byteLength) throw new Error("DWG 변환에 실패했습니다.");
  return { data, skipped, downgraded, layers: (drawing.layers || []).map((l) => l.name) };
}

/**
 * CAD 파일 다운로드. format: 'dwg'(기본) | 'dxf'
 */
export async function downloadCad(state, info = {}, opts = {}) {
  const format = opts.format === "dxf" ? "dxf" : "dwg";
  const built = buildDxf(state, info, opts);
  const name = cadFilename(state, opts.floorIndex ?? 0, Boolean(opts.allFloors), format);
  if (format === "dxf") {
    downloadDxf(name, built.dxf);
    return { ...built, filename: name, format };
  }
  const { data, skipped, downgraded } = await dxfToDwg(built.dxf);
  downloadBytes(name, data, "application/acad");
  return { ...built, filename: name, format, dwgBytes: data.byteLength, skipped, downgraded };
}

export { LAYERS, STALL_LAYER, LAYER_COLOR, expandOutwardManual };
