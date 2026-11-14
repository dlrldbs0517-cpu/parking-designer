// 장애인전용 구획·램프 완경사·끝수 처리 점검 (시험 결과표용)
// 실행: node scripts/stall-types.mjs
import { generateVariants, minStraightRampLength, rampTransitions, rampMainSlope, referenceCase, stallColumnHits } from "../src/layout.js";
import { roundFacility } from "../src/demand.js";

const ok = (pass) => (pass ? "일치" : "불일치");

console.log("## 1. 비주거 끝수 처리 (시행령 별표1 비고6)");
console.log("| 산정값 | 예상 | 결과 | 판정 |\n| ---: | ---: | ---: | --- |");
for (const [raw, expect] of [[0.96, 0], [1.46, 1], [1.5, 2], [2.49, 2]]) {
  const got = roundFacility(raw);
  console.log(`| ${raw} | ${expect} | ${got} | ${ok(got === expect)} |`);
}

console.log("\n## 2. 기둥 겹침 검사 (최소 이격 0)");
const stall = { x: 0, y: 0, w: 2.5, d: 5 };
const cases = [["완전히 겹침", { x: 1, y: 1, w: 0.5, d: 0.5 }, 0, 1], ["0.5m 떨어짐", { x: 3, y: 0, w: 0.5, d: 0.5 }, 0, 0]];
console.log("| 경우 | 예상 충돌 | 결과 | 판정 |\n| --- | ---: | ---: | --- |");
for (const [name, col, clear, expect] of cases) {
  const got = stallColumnHits([stall], [col], clear);
  console.log(`| ${name} | ${expect} | ${got} | ${ok(got === expect)} |`);
}

console.log("\n## 3. 램프 길이 (층고 3.2m)");
const plain = minStraightRampLength(3.2, false);
const gentle = minStraightRampLength(3.2, true);
console.log(`- 17% 단일: ${plain}m (손계산 3.2/0.17=18.82 → 18.9) ${ok(plain === 18.9)}`);
console.log(`- 도로변 3m 8.5% 반영: ${gentle}m (손계산 3+(3.2-0.255)/0.17=20.32 → 20.4) ${ok(gentle === 20.4)}`);
console.log(`- 20.4m 램프 본 경사 ${(rampMainSlope(20.4) * 100).toFixed(2)}% (17% 이하여야 함) ${ok(rampMainSlope(20.4) <= 0.17)}`);

console.log("\n## 4. 장애인전용 구획 (기준 사례 73.9×57.7m, 법정 112대)");
console.log("| 비율 | 일반형만 | 반영 후 | 장애인 칸 | 목표 | 충돌 | 겹침 | 판정 |");
console.log("| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
const plate = (rules) => ({
  width: referenceCase.width, depth: referenceCase.depth, spacing: referenceCase.spacing,
  columnWidth: 0.5, columnDepth: 0.5, minClear: 0.05, siteMargin: referenceCase.siteMargin, stallRules: rules,
});
const input = (pl) => ({
  plate: pl, cores: referenceCase.cores, openings: [],
  ramps: [{ id: 1, ...referenceCase.ramp, placement: referenceCase.rampPlacement }],
  rampPlacement: referenceCase.rampPlacement, entranceMode: referenceCase.entranceMode, circulation: referenceCase.circulation,
});
const best = (pl) => generateVariants(input(pl)).find((v) => v.recommended);
const base = best(plate(null));
for (const rate of [0.02, 0.03, 0.04]) {
  const b = best(plate({ legalStalls: 112, disabled: true, disabledRate: rate }));
  const c = b.metrics.stallTypes;
  const t = b.metrics.stallTargets;
  const pass = c.disabled >= t.disabled && b.metrics.valid;
  console.log(`| ${rate * 100}% | ${base.metrics.stalls}대 | ${b.metrics.stalls}대 | ${c.disabled} | ${t.disabled} | ${b.metrics.columnHits} | ${b.metrics.overlapCount} | ${pass ? "통과" : "확인 필요"} |`);
}

console.log("\n## 5. 내부 램프 직선/곡선 자동 전환 (층고 3.2m, 도로변 3m 8.5%, 경사 시작 = 외벽에서 11m)");
console.log("| 주차장 | 램프 | 모양 | 총 길이 | 구간 (길이·경사) | 하강 합 | 연결 | 판정 |");
console.log("| --- | --- | --- | ---: | --- | ---: | --- | --- |");
const { layoutParking, rampShape } = await import("../src/layout.js");
// 직선 램프는 반대쪽 벽 앞 6m(도착 후 꺾는 자리)까지 쓸 수 있다: 가능 길이 = 램프 방향 길이 − 11 − 6
const rampCases = [
  ["48×42m", 48, 42, "w", 8, "직선", 0],
  ["48×42m (112대)", 48, 42, "s", 8, "직선", 112],
  ["36×50m", 36, 50, "w", 8, "곡선", 0],
  ["60×34m", 60, 34, "s", 8, "곡선", 0],
  ["60×30m", 60, 30, "s", 8, "곡선", 0],  // 곡선 뒤 차선을 벽에 붙인 뒤로 가능
  ["60×24m", 60, 24, "s", 8, "불가", 0],
];
for (const [name, w, d, edge, t, expect, legal] of rampCases) {
  const plate = { width: w, depth: d, spacing: 8.1, columnWidth: 0.5, columnDepth: 0.5, minClear: 0.05, siteMargin: 20, legalStalls: legal };
  const ramp = { id: 1, edge, t, width: 6, length: minStraightRampLength(3.2, rampTransitions(plate)), placement: "internal" };
  const r = layoutParking({ plate, ramps: [ramp], openings: [], cores: [], rampPlacement: "internal", entranceMode: "integrated", circulation: "ccw", lockRamp: true });
  const sh = rampShape(r.ramps[0], r.plate);
  const segs = sh.segments.length
    ? sh.segments.map((s) => `${s.name} ${s.length}m·${((s.slope ?? s.drop / s.length) * 100).toFixed(1)}%`).join(", ")
    : "—";
  const drop = sh.segments.reduce((a, s) => a + s.drop, 0);
  const kind = sh.kind === "curved" ? (sh.ok ? "곡선" : "불가") : "직선";
  const slopesOk = sh.segments.every((s) => {
    const slope = s.slope ?? s.drop / s.length;
    const max = s.name === "곡선" ? 0.14 : s.name.includes("완") ? 0.085 : 0.17;
    return slope <= max + 1e-6;
  });
  const pass = kind === expect && (kind === "불가" || (slopesOk && Math.abs(drop - 3.2) < 0.01 && r.metrics.connected));
  console.log(`| ${name} | ${edge}측 | ${kind} | ${sh.total}m | ${segs} | ${drop.toFixed(2)}m | ${r.metrics.connected ? "연결" : "끊김"} · ${r.stalls.length}대 | ${pass ? "통과" : "확인 필요"} |`);
}

console.log("\n## 6. 기둥 간격 가로·세로 따로 입력 (외곽 기둥을 평면 안에 넣어 격자가 0.5m 안에서 시작)");
console.log("| 입력 | 기둥 줄 (가로) | 예상 | 판정 |\n| --- | --- | --- | --- |");
const gridCase = (spansX) => layoutParking({
  plate: { width: 48, depth: 42, spacing: 8.1, columnWidth: 0.5, columnDepth: 0.5, minClear: 0.05, siteMargin: 20, spansX },
  ramps: [{ id: 1, edge: "w", t: 8, width: 6, length: minStraightRampLength(), placement: "internal" }], openings: [], cores: [],
  rampPlacement: "internal", entranceMode: "integrated", circulation: "ccw", lockRamp: true,
}).gridX.join(", ");
for (const [label, spans, expect] of [["비움 (8.1m 하나)", null, "0.5, 8.6, 16.7, 24.8, 32.9, 41, 47.5"], ["4, 5, 6", [4, 5, 6], "0.5, 4.5, 9.5, 15.5, 21.5, 27.5, 33.5, 39.5, 47.5"], ["8.4", [8.4], "0.5, 8.9, 17.3, 25.7, 34.1, 42.5, 47.5"]]) {
  const got = gridCase(spans);
  console.log(`| ${label} | ${got} | ${expect} | ${ok(got === expect)} |`);
}

console.log("\n## 7. 막다른 차로 정리 · 진입 불가 칸 제외 (기본 48×42m, 내부 램프 서측)");
console.log("| 설정 | 배치 대수 | 진입 불가 제외 | 앞 차로 없는 칸 | 판정 |\n| --- | ---: | ---: | ---: | --- |");
const strip = (s) => (s.aisle === "n" ? { x: s.x, y: s.y + s.d, w: s.w, d: 0.5 } : s.aisle === "s" ? { x: s.x, y: s.y - 0.5, w: s.w, d: 0.5 } : s.aisle === "e" ? { x: s.x + s.w, y: s.y, w: 0.5, d: s.d } : { x: s.x - 0.5, y: s.y, w: 0.5, d: s.d });
const ov = (a, b) => { const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x); const d = Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y); return w > 0 && d > 0 ? w * d : 0; };
for (const trim of [false, true]) {
  const r = layoutParking({
    plate: { width: 48, depth: 42, spacing: 8.1, columnWidth: 0.5, columnDepth: 0.5, minClear: 0.05, siteMargin: 20, trimDeadEnds: trim },
    cores: [{ x: 20, y: 18, w: 8, d: 6 }],
    ramps: [{ id: 1, edge: "w", t: 8, width: 6, length: minStraightRampLength(), placement: "internal" }],
    openings: [{ id: 2, kind: "in", edge: "s", t: 24, width: 6 }, { id: 3, kind: "out", edge: "n", t: 24, width: 6 }],
    rampPlacement: "internal", entranceMode: "separate", circulation: "ccw", lockRamp: true,
  });
  const bad = r.stalls.filter((s) => !r.aisles.some((a) => ov(strip(s), a) > 0.2)).length;
  console.log(`| ${trim ? "켬" : "끔(기존)"} | ${r.metrics.stalls}대 | ${r.metrics.unreachable || 0}칸 | ${bad}칸 | ${trim ? ok(bad === 0) : "기존 동작"} |`);
}

console.log("\n## 8. 층고 입력 → 유효높이 · 램프 길이 (도로변 3m 8.5%)");
const { clearHeightOf } = await import("../src/layout.js");
console.log("| 층고 | 유효높이 (−0.28) | 2.3m 이상 | 램프 최소 길이 | 손계산 | 판정 |\n| ---: | ---: | --- | ---: | --- | --- |");
for (const [H, expectLen] of [[2.5, null], [3.2, 20.4], [3.8, 23.9]]) {
  const clear = clearHeightOf(H);
  const len = minStraightRampLength(H, true);
  const hand = `3+(${H}-0.255)/0.17=${(3 + (H - 0.255) / 0.17).toFixed(2)}`;
  const pass = expectLen == null ? clear < 2.3 : (clear >= 2.3 && len === expectLen);
  console.log(`| ${H}m | ${clear}m | ${clear >= 2.3 ? "가능" : "불가 (입력 막힘)"} | ${len}m | ${hand} | ${ok(pass)} |`);
}

console.log("\n## 9. 차로 폭 6m (연결 판정)");
const r9 = layoutParking({
  plate: { width: 48, depth: 42, spacing: 8.1, columnWidth: 0.5, columnDepth: 0.5, minClear: 0.05, siteMargin: 20 },
  cores: [{ x: 20, y: 18, w: 8, d: 6 }],
  ramps: [{ id: 1, edge: "w", t: 8, width: 6, length: minStraightRampLength(), placement: "internal" }],
  openings: [{ id: 2, kind: "in", edge: "s", t: 24, width: 6 }, { id: 3, kind: "out", edge: "n", t: 24, width: 6 }],
  rampPlacement: "internal", entranceMode: "separate", circulation: "ccw", lockRamp: true,
});
console.log(`- 가장 좁은 차로 폭 ${r9.metrics.minAisleWidth}m (6m 이상이어야 함) ${ok(r9.metrics.minAisleWidth >= 5.98)} · 동선 ${r9.metrics.connected ? "연결" : "끊김"}`);

console.log("\n## 10. 경사로 완화구간 (시행규칙 별표 1) — 층고 3.2m");
console.log("| 법정 대수 | 램프 위치 | 윗부분(볼록형) | 아랫부분(오목형) | 램프 최소 길이 | 손계산 | 판정 |\n| ---: | --- | ---: | ---: | ---: | --- | --- |");
for (const [legal, gentle, top, bottom, expect] of [[30, false, 0, 0, 18.9], [60, false, 1.7, 0, 19.7], [112, false, 1.7, 2, 20.7], [30, true, 3, 0, 20.4], [112, true, 3, 2, 21.4]]) {
  const tr = rampTransitions({ legalStalls: legal }, gentle ? "ground" : "lower");
  const len = minStraightRampLength(3.2, tr);
  const hand = `${+(top + bottom).toFixed(1)}+(3.2-${((top + bottom) * 0.085).toFixed(3)})/0.17=${(top + bottom + (3.2 - (top + bottom) * 0.085) / 0.17).toFixed(2)}`;
  console.log(`| ${legal}대 | ${gentle ? "지상(도로변 필수)" : "지하층 사이"} | ${tr.top}m | ${tr.bottom}m | ${len}m | ${hand} | ${ok(tr.top === top && tr.bottom === bottom && len === expect)} |`);
}
