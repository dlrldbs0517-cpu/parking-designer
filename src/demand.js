import {
  CHECKED_ON,
  defaultAreaPerStall,
  housingAreaDivisor,
  housingMinimumPerUnit,
  uses,
  zoneFactors,
  zoneUseStatus,
} from "./parkingRules.js?v=222";

export function emptyDemand() {
  return {
    region: "seoul",
    zone: "general2",
    ordinance: 1,
    areaPerStall: defaultAreaPerStall,
    plannedFloors: 2,
    projectName: "주차장 개략 설계",
    active: { apartment: true },
    bands: {
      apartment: [{ count: 100, area: 84 }],
      multifamily: [{ count: 0, area: 59 }],
      officetel: [{ count: 0, area: 40 }],
    },
    areas: {
      detached: 0,
      neighborhood1: 0,
      neighborhood2: 0,
      office: 0,
      retail: 0,
      lodging: 0,
      culture: 0,
      medical: 0,
      amusement: 0,
      warehouse: 0,
      factory: 0,
    },
  };
}

const ECO_PUBLIC_USES = ["office", "retail", "lodging", "culture", "medical", "amusement"];

function round1(value) {
  return Math.round(value * 10) / 10;
}

function housingRaw(bands, region) {
  const rule = housingAreaDivisor[region] || housingAreaDivisor.seoul;
  let areaLe = 0;
  let areaGt = 0;
  let minimum = 0;
  let households = 0;
  for (const band of bands) {
    const count = Math.max(0, Number(band.count) || 0);
    const area = Math.max(0, Number(band.area) || 0);
    if (!count) continue;
    households += count;
    const sum = count * area;
    if (area <= 85) areaLe += sum;
    else areaGt += sum;
    minimum += count * (area <= 60 ? housingMinimumPerUnit.le60 : housingMinimumPerUnit.default);
  }
  const byArea = (rule.le85 ? areaLe / rule.le85 : 0) + (rule.gt85 ? areaGt / rule.gt85 : 0);
  return {
    households,
    raw: Math.max(byArea, minimum),
    basis: `${rule.label} · 85㎡ 이하 ${rule.le85}㎡당 1대, 초과 ${rule.gt85}㎡당 1대. 세대당 최소 ${housingMinimumPerUnit.default}대(60㎡ 이하 ${housingMinimumPerUnit.le60}대) 중 큰 값`,
    input: `${households}세대 · 전용 ${round1(areaLe + areaGt)}㎡`,
  };
}

function detachedRaw(area) {
  const value = Math.max(0, Number(area) || 0);
  let raw = 0;
  let basis = "50㎡ 이하: 면적/100. 50㎡ 초과 150㎡ 이하: 1대. 150㎡ 초과: 1+(면적-150)/100";
  if (value <= 50) raw = value / 100;
  else if (value <= 150) raw = 1;
  else raw = 1 + (value - 150) / 100;
  return { raw, basis, input: `시설면적 ${round1(value)}㎡` };
}

/** 별표 1 비고 6. 합이 1 미만이면 0, 아니면 0.5 이상은 올린다. */
// 주차장법 시행령 별표1 비고6: 총 1대 미만이면 0, 소수점 이하 0.5 이상이면 1대로 본다.
// (수정 2026-11-10) 전에는 소수 첫째 자리로 먼저 반올림해서 0.96→1대, 1.46→2대로 잘못 나왔다.
export function roundFacility(raw) {
  if (!(raw >= 1 - 1e-9)) return 0;
  const whole = Math.floor(raw + 1e-9);
  return raw - whole >= 0.5 - 1e-9 ? whole + 1 : whole;
}

export function calculateDemand(demand, plate, spacing = 8) {
  const source = demand || emptyDemand();
  const zone = zoneFactors[source.zone] || zoneFactors.general2;
  const typed = Number(source.ordinance);
  // 주차장법 시행령 제6조②: ½ 범위 → 0.5~1.5
  const ordinance = Number.isFinite(typed) ? Math.min(1.5, Math.max(0.5, typed)) : 1;
  const factor = ordinance * zone.factor;
  const rows = [];
  let households = 0;
  let housingSum = 0;
  let facilityRaw = 0;
  let aptHouseholds = 0;
  const publicUses = [];

  for (const use of uses) {
    if (!source.active?.[use.id]) continue;
    // 이 용도지역에 지을 수 없는 용도는 계산에서 뺀다(화면에서도 숨김).
    if (zoneUseStatus(source.zone, use.id, source.region).s === "no") continue;
    if (use.kind === "housing") {
      const result = housingRaw(source.bands?.[use.id] || [], source.region);
      const scaled = result.raw * factor;
      const stalls = scaled <= 0 ? 0 : Math.ceil(scaled - 1e-9);
      households += use.id === "officetel" ? 0 : result.households;
      if (use.id === "apartment") aptHouseholds += result.households;
      housingSum += stalls;
      rows.push({
        use: use.label,
        basis: result.basis,
        input: result.input,
        stalls,
        article: use.article,
      });
    } else if (use.kind === "detached") {
      const result = detachedRaw(source.areas?.detached);
      const scaled = result.raw * factor;
      facilityRaw += scaled;
      rows.push({
        use: use.label,
        basis: result.basis,
        input: result.input,
        stalls: round1(scaled),
        article: use.article,
      });
    } else {
      const area = Math.max(0, Number(source.areas?.[use.id]) || 0);
      if (area > 0 && ECO_PUBLIC_USES.includes(use.id)) publicUses.push(use.label);
      const raw = (area / use.per) * factor;
      facilityRaw += raw;
      rows.push({
        use: use.label,
        basis: `시설면적 ${use.per}㎡당 1대`,
        input: `시설면적 ${round1(area)}㎡`,
        stalls: round1(raw),
        article: use.article,
      });
    }
  }

  const facilityStalls = roundFacility(facilityRaw);

  const legalStalls = housingSum + facilityStalls;
  const areaPerStall = Math.max(1, Number(source.areaPerStall) || defaultAreaPerStall);
  const totalArea = legalStalls * areaPerStall;
  const plannedFloors = Math.max(1, Math.round(Number(source.plannedFloors) || 1));
  const floorArea = legalStalls ? totalArea / plannedFloors : 0;
  const actualArea = plate ? plate.width * plate.depth : 0;
  const neededFloors = actualArea > 0 && legalStalls ? Math.max(1, Math.ceil(totalArea / actualArea)) : plannedFloors;
  // 친환경차 전용주차구역 대상(친환경자동차법 시행령 제18조의5): 총주차대수 50대 이상 +
  // 100세대 이상 아파트 또는 공중이용시설(업무·판매·숙박·문화·의료·위락). 근생·오피스텔·연립·다세대만이면 대상 아님.
  const ecoBasis = aptHouseholds >= 100 ? `공동주택 ${aptHouseholds}세대` : publicUses.length ? publicUses.join("·") : "";
  const ecoAuto = legalStalls >= 50 && Boolean(ecoBasis);
  return {
    rows,
    legalStalls,
    households,
    aptHouseholds,
    ecoAuto,
    ecoBasis,
    areaPerStall,
    totalArea,
    plannedFloors,
    floorArea,
    recommended: recommendPlate(floorArea, spacing),
    actualArea,
    neededFloors,
    shortfall: actualArea > 0 && actualArea + 0.5 < floorArea,
    checkedOn: CHECKED_ON,
    zoneLabel: zone.label,
    factor,
  };
}

export function recommendPlate(floorArea, spacing) {
  const step = Math.max(4, Number(spacing) || 8);
  if (!floorArea) return { width: step * 4, depth: step * 3 };
  const long = Math.sqrt(floorArea * 1.2);
  const short = floorArea / long;
  const baysLong = Math.max(3, Math.ceil(long / step));
  const baysShort = Math.max(3, Math.ceil(short / step));
  return { width: Math.round(baysLong * step * 10) / 10, depth: Math.round(baysShort * step * 10) / 10 };
}
