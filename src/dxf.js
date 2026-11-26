// CAD(DXF) 내보내기 — AutoCAD·ZWCAD 등에서 바로 열리는 R12(AC1009) ASCII DXF.
// 단위 mm, 실제 크기(1:1), 평면 좌표 그대로(원점 = 주차장 왼쪽 아래 모서리, y 위 = 북).
// 레이어로 나눠서 CAD에서 끄고 켜거나 색을 바꿀 수 있게 한다. 한글은 \U+XXXX로 적어 글꼴(맑은 고딕)로 표시.
import { rampShape } from "./layout.js?v=306";
import { chargerRect, boltPoints, stallTag } from "./stallMarks.js?v=306";

const MM = 1000;

// [이름, 색(ACI), 선 종류]
const LAYERS = [
  ["A-WALL", 7, "CONTINUOUS"],      // 외벽
  ["A-GRID", 8, "DASHED"],          // 기둥선
  ["A-GRID-TEXT", 8, "CONTINUOUS"], // 기둥선 번호·간격
  ["A-COLS", 7, "CONTINUOUS"],      // 기둥
  ["A-CORE", 5, "CONTINUOUS"],      // 코어
  ["A-CORE-DOOR", 1, "CONTINUOUS"], // 코어 출입문
  ["P-RAMP", 30, "CONTINUOUS"],     // 램프
  ["P-AISLE", 9, "CONTINUOUS"],     // 차로(외곽선만, 기본 꺼 두기 좋게 연한 색)
  ["P-STALL", 7, "CONTINUOUS"],     // 일반형
  ["P-STALL-EXT", 3, "CONTINUOUS"], // 확장형
  ["P-STALL-DIS", 4, "CONTINUOUS"], // 장애인
  ["P-STALL-EV", 2, "CONTINUOUS"],  // 전기차
  ["P-STALL-PAR", 6, "CONTINUOUS"], // 평행
  ["P-EV-CHARGER", 2, "CONTINUOUS"],// 충전기
  ["P-STOPPER", 8, "CONTINUOUS"],   // 차막이
  ["P-TEXT", 7, "CONTINUOUS"],      // 칸 문자·표제
];

function esc(text) {
  return String(text).replace(/[^\x20-\x7e]/g, (ch) => `\\U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
}
const n = (v) => (Math.round(v * MM * 10) / 10).toString();

export function stateDxf(state, info = {}) {
  const plate = state.plate;
  const out = [];
  const g = (code, value) => { out.push(String(code), String(value)); };

  // ── HEADER ──
  g(0, "SECTION"); g(2, "HEADER");
  g(9, "$ACADVER"); g(1, "AC1009");
  g(9, "$INSBASE"); g(10, 0); g(20, 0); g(30, 0);
  g(9, "$EXTMIN"); g(10, n(-12)); g(20, n(-12)); g(30, 0);
  g(9, "$EXTMAX"); g(10, n(plate.width + 12)); g(20, n(plate.depth + 12)); g(30, 0);
  g(9, "$LUNITS"); g(70, 2);
  g(9, "$DWGCODEPAGE"); g(3, "ANSI_949");
  g(0, "ENDSEC");

  // ── TABLES ──
  g(0, "SECTION"); g(2, "TABLES");
  g(0, "TABLE"); g(2, "LTYPE"); g(70, 2);
  g(0, "LTYPE"); g(2, "CONTINUOUS"); g(70, 0); g(3, "Solid line"); g(72, 65); g(73, 0); g(40, 0);
  g(0, "LTYPE"); g(2, "DASHED"); g(70, 0); g(3, "__ __ __"); g(72, 65); g(73, 2); g(40, 900); g(49, 600); g(49, -300);
  g(0, "ENDTAB");
  g(0, "TABLE"); g(2, "LAYER"); g(70, LAYERS.length);
  LAYERS.forEach(([name, color, lt]) => { g(0, "LAYER"); g(2, name); g(70, 0); g(62, color); g(6, lt); });
  g(0, "ENDTAB");
  g(0, "TABLE"); g(2, "STYLE"); g(70, 1);
  g(0, "STYLE"); g(2, "KOR"); g(70, 0); g(40, 0); g(41, 1); g(50, 0); g(71, 0); g(42, 250); g(3, "malgun.ttf"); g(4, "");
  g(0, "ENDTAB");
  g(0, "ENDSEC");

  // ── ENTITIES ──
  g(0, "SECTION"); g(2, "ENTITIES");
  const line = (layer, x1, y1, x2, y2) => { g(0, "LINE"); g(8, layer); g(10, n(x1)); g(20, n(y1)); g(30, 0); g(11, n(x2)); g(21, n(y2)); g(31, 0); };
  const poly = (layer, pts, closed = true) => {
    g(0, "POLYLINE"); g(8, layer); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, closed ? 1 : 0);
    pts.forEach(([x, y]) => { g(0, "VERTEX"); g(8, layer); g(10, n(x)); g(20, n(y)); g(30, 0); });
    g(0, "SEQEND"); g(8, layer);
  };
  const rect = (layer, r) => poly(layer, [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.d], [r.x, r.y + r.d]]);
  const solid = (layer, r) => {
    g(0, "SOLID"); g(8, layer);
    g(10, n(r.x)); g(20, n(r.y)); g(30, 0);
    g(11, n(r.x + r.w)); g(21, n(r.y)); g(31, 0);
    g(12, n(r.x)); g(22, n(r.y + r.d)); g(32, 0);
    g(13, n(r.x + r.w)); g(23, n(r.y + r.d)); g(33, 0);
  };
  // 글자: 가운데 맞춤(72=1, 73=2). 높이 m 단위로 받음.
  const text = (layer, x, y, h, str, rot = 0) => {
    g(0, "TEXT"); g(8, layer); g(10, n(x)); g(20, n(y)); g(30, 0); g(40, n(h)); g(1, esc(str));
    if (rot) g(50, rot);
    g(7, "KOR"); g(72, 1); g(11, n(x)); g(21, n(y)); g(31, 0); g(73, 2);
  };

  // 외벽
  if (plate.outline && plate.outline.length >= 3) poly("A-WALL", plate.outline);
  else rect("A-WALL", { x: 0, y: 0, w: plate.width, d: plate.depth });

  // 기둥선 + 번호 + 간격
  const xs = state.gridX?.length ? state.gridX : [0, plate.width];
  const ys = state.gridY?.length ? state.gridY : [0, plate.depth];
  xs.forEach((x, i) => {
    line("A-GRID", x, -4, x, plate.depth + 4);
    text("A-GRID-TEXT", x, plate.depth + 5, 0.8, `X${i + 1}`);
    if (i) text("A-GRID-TEXT", (x + xs[i - 1]) / 2, plate.depth + 2.6, 0.45, (x - xs[i - 1]).toFixed(2));
  });
  ys.forEach((y, i) => {
    line("A-GRID", -4, y, plate.width + 4, y);
    text("A-GRID-TEXT", -5, y, 0.8, `Y${i + 1}`);
    if (i) text("A-GRID-TEXT", -2.6, (y + ys[i - 1]) / 2, 0.45, (y - ys[i - 1]).toFixed(2), 90);
  });

  // 차로 외곽선
  (state.aisles || []).forEach((a) => rect("P-AISLE", a));

  // 주차칸
  (state.stalls || []).forEach((st) => {
    const layer = st.type === "parallel" ? "P-STALL-PAR" : st.type === "disabled" ? "P-STALL-DIS" : st.eco ? "P-STALL-EV" : st.type === "extended" ? "P-STALL-EXT" : "P-STALL";
    rect(layer, st);
    const tag = stallTag(st);
    if (tag) text("P-TEXT", st.x + st.w / 2, st.y + st.d / 2, 0.45, tag, st.w < st.d ? 0 : 0);
    if (st.type !== "parallel") {
      // 차막이: 차로 반대쪽에서 0.9m 안, 길이 1.6m
      const back = 0.9;
      if (st.aisle === "n" || st.aisle === "s") {
        const y = st.aisle === "n" ? st.y + back : st.y + st.d - back;
        line("P-STOPPER", st.x + st.w / 2 - 0.8, y, st.x + st.w / 2 + 0.8, y);
      } else {
        const x = st.aisle === "e" ? st.x + back : st.x + st.w - back;
        line("P-STOPPER", x, st.y + st.d / 2 - 0.8, x, st.y + st.d / 2 + 0.8);
      }
    }
    if (st.eco) {
      const r = chargerRect(st);
      rect("P-EV-CHARGER", r);
      poly("P-EV-CHARGER", boltPoints(r), true);
    }
  });

  // 기둥(속 채움)
  (state.columns || []).forEach((c) => { solid("A-COLS", { x: c.x, y: c.y, w: c.w || 0.5, d: c.d || c.w || 0.5 }); rect("A-COLS", { x: c.x, y: c.y, w: c.w || 0.5, d: c.d || c.w || 0.5 }); });

  // 코어 + 출입문
  (state.cores || []).forEach((c, i) => {
    rect("A-CORE", c);
    line("A-CORE", c.x + c.w * 0.34, c.y, c.x + c.w * 0.34, c.y + c.d);
    line("A-CORE", c.x + c.w * 0.67, c.y, c.x + c.w * 0.67, c.y + c.d);
    text("A-CORE", c.x + c.w / 2, c.y + c.d / 2, 0.8, state.cores.length > 1 ? `코어 ${i + 1}` : "코어");
    const f = c.doorFace;
    if (f) {
      const L = 1.2;
      const T = 0.3;
      const r = f === "n" ? { x: c.x + c.w / 2 - L / 2, y: c.y + c.d - T, w: L, d: T }
        : f === "s" ? { x: c.x + c.w / 2 - L / 2, y: c.y, w: L, d: T }
        : f === "e" ? { x: c.x + c.w - T, y: c.y + c.d / 2 - L / 2, w: T, d: L }
        : { x: c.x, y: c.y + c.d / 2 - L / 2, w: T, d: L };
      rect("A-CORE-DOOR", r);
    }
  });

  // 램프
  (state.ramps || []).forEach((ramp) => {
    const shape = rampShape(ramp, plate);
    shape.polygons.forEach((pts) => poly("P-RAMP", pts.map((p) => [p.x, p.y])));
    if (shape.path && shape.path.length > 1) poly("P-RAMP", shape.path.map((p) => [p.x, p.y]), false);
    const box = shape.pieces?.[0];
    if (box) text("P-RAMP", box.x + box.w / 2, box.y + box.d / 2, 0.8, "램프");
  });

  // 표제(도면 아래)
  const types = info.stallTypes || {};
  text("P-TEXT", plate.width / 2, -6, 1.0, `${state.demand?.projectName || "주차장"} 지하주차장 평면  ${plate.width}×${plate.depth}m  총 ${(state.stalls || []).length}대`);
  text("P-TEXT", plate.width / 2, -7.6, 0.6, `일반 ${types.general ?? "-"} · 확장형 ${types.extended ?? "-"} · 장애인 ${types.disabled ?? "-"} · 전기차 ${types.eco ?? "-"} · 평행 ${types.parallel ?? "-"}  (단위 mm, 1:1)`);

  g(0, "ENDSEC");
  g(0, "EOF");
  return out.join("\r\n") + "\r\n";
}
