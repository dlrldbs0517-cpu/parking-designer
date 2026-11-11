import { defaultCore, generateVariants, minStraightRampLength, referenceCase, stallsPerBay } from "../src/layout.js";

function line(cells) {
  console.log(`| ${cells.join(" | ")} |`);
}

function table(variants) {
  line(["안", "층당", "㎡/대", "차로비", "연결", "충돌", "막다른", "유사", "겹침", "판정"]);
  line(["---", "---:", "---:", "---:", "---", "---:", "---:", "---:", "---:", "---"]);
  variants.forEach((variant) => {
    const m = variant.metrics;
    line([
      `${variant.recommended ? "추천 " : ""}${variant.id} ${variant.name}`,
      m.stalls,
      m.areaPerStall.toFixed(2),
      `${Math.round(m.aisleRatio * 100)}%`,
      m.connected ? "연결" : "끊김",
      m.columnHits,
      m.deadEnds,
      m.similarity,
      m.overlapCount,
      m.valid ? "통과" : m.rejected,
    ]);
  });
}

function run(title, input) {
  console.log(`\n## ${title}`);
  const variants = generateVariants(input);
  table(variants);
  const best = variants.find((variant) => variant.recommended);
  if (best) {
    console.log(`최적 ${best.id}: ${best.metrics.stalls}대, ${best.metrics.areaPerStall.toFixed(2)}㎡/대, 유사 ${best.metrics.similarity}, 연결 ${best.connected}`);
  } else {
    console.log("통과한 안 없음");
    variants.forEach((variant) => {
      if (variant.issues.length) console.log(variant.id, variant.issues.map((issue) => issue.label).join(" / "));
    });
  }
  const bad = variants.filter((variant) => variant.metrics.overlapCount > 0);
  console.log(`겹침 0이 아닌 안: ${bad.length ? bad.map((variant) => variant.id).join(", ") : "없음"}`);
  return variants;
}

const pack = stallsPerBay(8.1, 0.5, 0.05);
console.log(`구간 8.1m, 기둥 0.5m → ${pack.count}대, 이격 ${pack.gap}m, 순간격 ${pack.clear}m`);
console.log(`직선 램프 최소 길이 ${minStraightRampLength()}m`);

const refPlate = {
  width: referenceCase.width,
  depth: referenceCase.depth,
  spacing: referenceCase.spacing,
  columnWidth: referenceCase.columnWidth,
  columnDepth: referenceCase.columnDepth,
  minClear: referenceCase.minClear,
  siteMargin: referenceCase.siteMargin,
};
run("기준 사례 (외부 램프 + 일체 출입)", {
  plate: refPlate,
  cores: referenceCase.cores,
  ramps: [{ id: 1, ...referenceCase.ramp, placement: "external" }],
  openings: [],
  rampPlacement: "external",
  entranceMode: "integrated",
  circulation: "ccw",
});

const basePlate = {
  width: 48,
  depth: 42,
  spacing: 8.1,
  columnWidth: 0.5,
  columnDepth: 0.5,
  minClear: 0.05,
  siteMargin: 20,
};
const core = defaultCore(basePlate);
run("기본 100세대 조건 48×42m 기둥 8.1m (내부 램프 + 분리 출입)", {
  plate: basePlate,
  cores: [core],
  ramps: [{ id: 1, edge: "e", t: 21, width: 6, length: minStraightRampLength(), placement: "internal" }],
  openings: [],
  rampPlacement: "internal",
  entranceMode: "separate",
  circulation: "ccw",
});

run("기준 평면에서 내부 램프 + 분리 출입", {
  plate: refPlate,
  cores: referenceCase.cores,
  ramps: [{ id: 1, edge: "w", t: 28, width: 6, length: minStraightRampLength(), placement: "internal" }],
  openings: [],
  rampPlacement: "internal",
  entranceMode: "separate",
  circulation: "ccw",
});

// 확장형 30% (법정 50대 이상) — 실제 화면과 같은 조건(법정 112대, 장애인 3%)
for (const clear of [0.05, 0]) {
  const legalPlate = { ...refPlate, minClear: clear, legalStalls: 112, stallRules: { disabled: true, disabledRate: 0.03, legalStalls: 112 } };
  const vs = generateVariants({
    plate: legalPlate,
    cores: referenceCase.cores,
    ramps: [{ id: 1, ...referenceCase.ramp, placement: "external" }],
    openings: [],
    rampPlacement: "external",
    entranceMode: "integrated",
    circulation: "ccw",
  });
  console.log(`\n## 확장형 적용 · 기준 사례 · 이격 ${clear}m`);
  table(vs);
  vs.forEach((v) => {
    const st = v.metrics.stallTypes || {};
    console.log(`${v.id}: 일반 ${st.general} · 확장 ${st.extended} · 장애인 ${st.disabled} / 총 ${st.total} · ${v.issues.filter((i) => i.type === "stallType").map((i) => i.label).join(", ")}`);
  });
}
