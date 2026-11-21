// 여러 조건(크기 5 × 도로 변 4 × 램프 위치 3 × 층고 2 = 120가지)을 돌려 겹침·확장형 부족·통과안 없음을 찾는다.
// 실행: node scripts/sweep.mjs  (약 1~2분)
import { generateVariants, defaultCore, minStraightRampLength, rampTransitions } from "../src/layout.js?v=255";
const ov = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y));
let cases = 0, noValid = 0, bad = 0; const t0 = Date.now(); const rows = [];
for (const [w, d] of [[40, 36], [48, 42], [60, 50], [73.9, 57.7], [36, 60]]) for (const edge of ["s", "n", "w", "e"]) for (const pos of ["start", "mid", "end"]) for (const fh of [3.2, 3.8]) {
  const plate = { width: w, depth: d, spacing: 8.1, columnWidth: 0.5, columnDepth: 0.5, minClear: 0, siteMargin: 20, floorHeight: fh, legalStalls: 112, roadEdge: edge, stallRules: { disabled: true, disabledRate: 0.03, legalStalls: 112 } };
  const len = minStraightRampLength(fh, rampTransitions({ legalStalls: 112 }));
  const vs = generateVariants({ plate, cores: [defaultCore(plate)], ramps: [{ id: 1, edge, t: 10, pos, width: 6, length: len, placement: "internal" }], openings: [], rampPlacement: "internal", entranceMode: "integrated" });
  cases++;
  const rec = vs.find(v => v.recommended);
  if (!rec) { noValid++; rows.push(`통과없음 ${w}x${d} ${edge} ${pos} ${fh}: ${[...new Set(vs.map(v => v.metrics.rejected || (v.issues||[]).map(i=>i.type).join("+")))].join(" / ")}`); continue; }
  // 검사: 칸끼리 겹침, 칸-차로 겹침, 칸-코어 겹침, 확장형 30%, 장애인 수
  let issues = [];
  vs.filter(v => v.metrics.valid).forEach(v => {
    const s = v.stalls;
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) if (ov(s[i], s[j]) > 0.05) issues.push(`${v.id} 칸겹침`);
    s.forEach(st => { if (v.aisles.some(a => ov(st, a) > 0.05)) issues.push(`${v.id} 칸-차로`); if (v.cores.some(c => ov(st, c) > 0.05)) issues.push(`${v.id} 칸-코어`); });
    if (v.recommended && v.metrics.isolatedAisles > 0) issues.push(`${v.id} 끊긴차로${v.metrics.isolatedAisles}`);
    const out = (r) => r.x < -0.01 || r.y < -0.01 || r.x + r.w > w + 0.01 || r.y + r.d > d + 0.01;
    if ((v.columns || []).some(out)) issues.push(`${v.id} 기둥-대지밖`);
    if (s.some(out)) issues.push(`${v.id} 칸-대지밖`);
    if ((v.columns || []).some(col => v.aisles.some(a => ov(col, a) > 0.01))) issues.push(`${v.id} 기둥-차로`);
    const t = v.metrics.stallTargets || {}, c = v.metrics.stallTypes || {};
    if (t.eco && (c.eco || 0) < t.eco) issues.push(`${v.id} 친환경부족`);
    if (t.extended && c.extended < t.extended && !v.coreSide && !v.uniform) issues.push(`${v.id} 확장부족`);
  });
  issues = [...new Set(issues)];
  if (issues.length) { bad++; rows.push(`${w}x${d} ${edge} ${pos} ${fh}: ${issues.join(",")}`); }
}
console.log(`cases ${cases}, 통과안 없음 ${noValid}, 문제 ${bad}, ${((Date.now()-t0)/1000).toFixed(1)}s`);
console.log(rows.slice(0, 20).join("\n"));
