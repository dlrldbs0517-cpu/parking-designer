/**
 * 법정 주차 산정표. 숫자만 고치면 계산식은 그대로다.
 * 확인 2026-11-08, 국가법령정보센터.
 * 주차장법 시행령 별표 1은 2026. 8. 25. 개정(대통령령 제36623호, 시행 2026. 8. 28.)이다.
 *
 * 공동주택: 주택건설기준 등에 관한 규정 제27조제1항제1호
 * (시행 2026. 11. 7., 대통령령 제36308호).
 * https://www.law.go.kr/lsLinkCommonInfo.do?lsJoLnkSeq=1026910127
 * 면적 비율표는 같은 조 본문 표. 찾기 쉬운 정리:
 * https://www.easylaw.go.kr/CSP/CnpClsMainBtr.laf?ccfNo=2&cciNo=1&cnpClsNo=2&csmSeq=895
 *
 * 그 밖의 용도: 주차장법 시행령 [별표 1] (개정 2026. 8. 25.)
 * https://www.law.go.kr/flDownload.do?bylClsCd=110201&flSeq=168270377&gubun=
 * 끝수: 별표 1 비고 4·6. 주택 끝수는 제27조 본문(소수점 끝수는 한 대).
 */

export const CHECKED_ON = "2026-11-08";

/** 전용면적 85㎡ 이하 / 초과의 ㎡당 1대. 제27조제1항제1호 표. */
export const housingAreaDivisor = {
  seoul: { le85: 75, gt85: 65, label: "서울특별시" },
  metro: { le85: 85, gt85: 70, label: "광역시·수도권 시" },
  city: { le85: 95, gt85: 75, label: "그 밖의 시·수도권 군" },
  other: { le85: 110, gt85: 85, label: "그 밖의 지역" },
};

/** 세대당 최소 대수. 전용 60㎡ 이하는 0.7. 제27조제1항제1호. */
export const housingMinimumPerUnit = { default: 1, le60: 0.7 };

/**
 * 용도지역은 법령 표의 열이 아니다. 조례 할증은 ordinance로 넣고,
 * 여기 배율은 지역별 가산이 필요할 때 표만 고친다. 기본 1.
 */
export const zoneFactors = {
  exclusive1: { label: "제1종 전용주거지역", factor: 1 },
  exclusive2: { label: "제2종 전용주거지역", factor: 1 },
  general1: { label: "제1종 일반주거지역", factor: 1 },
  general2: { label: "제2종 일반주거지역", factor: 1 },
  general3: { label: "제3종 일반주거지역", factor: 1 },
  semi: { label: "준주거지역", factor: 1 },
  central: { label: "중심상업지역", factor: 1 },
  commercial: { label: "일반상업지역", factor: 1 },
  neighborhood: { label: "근린상업지역", factor: 1 },
  distribution: { label: "유통상업지역", factor: 1 },
  industrialExclusive: { label: "전용공업지역", factor: 1 },
  industrialGeneral: { label: "일반공업지역", factor: 1 },
  industrialSemi: { label: "준공업지역", factor: 1 },
  greenConservation: { label: "보전녹지지역", factor: 1 },
  greenProduction: { label: "생산녹지지역", factor: 1 },
  greenNatural: { label: "자연녹지지역", factor: 1 },
  mgmtConservation: { label: "보전관리지역", factor: 1 },
  mgmtProduction: { label: "생산관리지역", factor: 1 },
  mgmtPlanned: { label: "계획관리지역", factor: 1 },
  agricultural: { label: "농림지역", factor: 1 },
  nature: { label: "자연환경보전지역", factor: 1 },
};

/**
 * kind
 * - housing: 세대수 × 전용면적 구간. 다가구·오피스텔도 같은 조.
 * - detached: 별표 1 제4호
 * - area: 시설면적 ÷ per
 */
export const uses = [
  { id: "apartment", label: "공동주택", kind: "housing", article: "주택건설기준 제27조제1항, 시행령 별표 1 제5호" },
  { id: "multifamily", label: "다가구주택", kind: "housing", article: "시행령 별표 1 제5호" },
  { id: "officetel", label: "오피스텔", kind: "housing", article: "시행령 별표 1 제5호" },
  { id: "detached", label: "단독주택", kind: "detached", article: "시행령 별표 1 제4호" },
  { id: "neighborhood1", label: "제1종 근린생활시설", kind: "area", per: 200, article: "시행령 별표 1 제3호" },
  { id: "neighborhood2", label: "제2종 근린생활시설", kind: "area", per: 200, article: "시행령 별표 1 제3호" },
  { id: "office", label: "업무시설", kind: "area", per: 150, article: "시행령 별표 1 제2호" },
  { id: "retail", label: "판매시설", kind: "area", per: 150, article: "시행령 별표 1 제2호" },
  { id: "lodging", label: "숙박시설", kind: "area", per: 200, article: "시행령 별표 1 제3호" },
  { id: "culture", label: "문화·집회시설", kind: "area", per: 150, article: "시행령 별표 1 제2호" },
  { id: "medical", label: "의료시설", kind: "area", per: 150, article: "시행령 별표 1 제2호" },
  { id: "amusement", label: "위락시설", kind: "area", per: 100, article: "시행령 별표 1 제1호" },
  { id: "warehouse", label: "창고시설", kind: "area", per: 400, article: "시행령 별표 1 제8호" },
  { id: "factory", label: "공장", kind: "area", per: 350, article: "시행령 별표 1 제7호" },
  // 별표 1 제1호~제10호에 교육연구시설은 없다. 비고 1은 시설물 종류를 건축법 시행령 별표 1에 따른다고 하므로
  // 학교·연구소 등 교육연구시설은 제11호 그 밖의 건축물, 시설면적 300㎡당 1대.
  // 확인 2026-11-08. https://www.law.go.kr/flDownload.do?bylClsCd=110201&flSeq=168270377&gubun=
  { id: "education", label: "교육연구시설", kind: "area", per: 300, article: "시행령 별표 1 제11호(그 밖의 건축물)" },
];

/** 개략 배치용 1대당 면적. 법정 면적이 아니라 검토 기본값. */
export const defaultAreaPerStall = 33;

/**
 * 용도지역별로 지을 수 있는 용도 (개략).
 * 근거: 국토의 계획 및 이용에 관한 법률 시행령 제71조, 별표 4(제1종일반주거)·5(제2종)·6(제3종)·7(준주거)·9(일반상업)·10(근린상업).
 * - ok  : 별표 제1호 "건축할 수 있는 건축물"
 * - ord : 도시·군계획조례로 허용되는 경우만 (지자체 조례 확인 필요)
 * - no  : 지을 수 없음
 * 세부 용도·바닥면적·층수 제한은 note에 줄여 적었다. 실제 인허가는 별표 원문과 해당 지자체 조례로 확인할 것.
 * (작성 2026-11-11, 개략 검토용. 팀 검토 필요)
 */
export const zoneUses = {
  general1: {
    apartment: { s: "ok", note: "아파트 제외 · 4층 이하 연립·다세대만" },
    multifamily: { s: "ok", note: "4층 이하" },
    officetel: { s: "no" },
    detached: { s: "ok" },
    neighborhood1: { s: "ok" },
    neighborhood2: { s: "ord", note: "단란주점·안마시술소 등 제외" },
    office: { s: "no" },
    retail: { s: "ord", note: "소규모만" },
    lodging: { s: "no" },
    culture: { s: "ord", note: "일부(공연장·집회장 등)" },
    medical: { s: "ord", note: "격리병원 제외" },
    amusement: { s: "no" },
    warehouse: { s: "ord" },
    factory: { s: "ord", note: "무공해 소규모 일부만" },
    education: { s: "ok", note: "유치원~고교는 허용, 그 밖은 조례" },
  },
  general2: {
    apartment: { s: "ok", note: "층수는 조례로 제한될 수 있음" },
    multifamily: { s: "ok" },
    officetel: { s: "ord", note: "업무시설 3,000㎡ 미만" },
    detached: { s: "ok" },
    neighborhood1: { s: "ok" },
    neighborhood2: { s: "ord", note: "단란주점·안마시술소 등 제외" },
    office: { s: "ord", note: "3,000㎡ 미만" },
    retail: { s: "ord", note: "소규모만" },
    lodging: { s: "no" },
    culture: { s: "ord", note: "관람장 제외" },
    medical: { s: "ord", note: "격리병원 제외" },
    amusement: { s: "no" },
    warehouse: { s: "ord" },
    factory: { s: "ord", note: "무공해 소규모 일부만" },
    education: { s: "ok", note: "유치원~고교는 허용, 그 밖은 조례" },
  },
  general3: {
    apartment: { s: "ok" },
    multifamily: { s: "ok" },
    officetel: { s: "ord", note: "업무시설 3,000㎡ 이하" },
    detached: { s: "ok" },
    neighborhood1: { s: "ok" },
    neighborhood2: { s: "ord", note: "단란주점·안마시술소 등 제외" },
    office: { s: "ord", note: "3,000㎡ 이하" },
    retail: { s: "ord", note: "소규모만" },
    lodging: { s: "no" },
    culture: { s: "ord", note: "관람장 제외" },
    medical: { s: "ord", note: "격리병원 제외" },
    amusement: { s: "no" },
    warehouse: { s: "ord" },
    factory: { s: "ord", note: "무공해 소규모 일부만" },
    education: { s: "ok", note: "유치원~고교는 허용, 그 밖은 조례" },
  },
  semi: {
    apartment: { s: "ok" },
    multifamily: { s: "ok" },
    officetel: { s: "ok" },
    detached: { s: "ok" },
    neighborhood1: { s: "ok" },
    neighborhood2: { s: "ok", note: "단란주점 등은 조례" },
    office: { s: "ok" },
    retail: { s: "ok", note: "대규모는 조례" },
    lodging: { s: "ord", note: "생활숙박 등 조례" },
    culture: { s: "ok", note: "관람장 제외" },
    medical: { s: "ok", note: "격리병원 제외" },
    amusement: { s: "no" },
    warehouse: { s: "ord" },
    factory: { s: "ord", note: "무공해 소규모 일부만" },
    education: { s: "ok" },
  },
  commercial: {
    apartment: { s: "ord", note: "주거복합 등 조례 확인" },
    multifamily: { s: "ord" },
    officetel: { s: "ok" },
    detached: { s: "ord" },
    neighborhood1: { s: "ok" },
    neighborhood2: { s: "ok" },
    office: { s: "ok" },
    retail: { s: "ok" },
    lodging: { s: "ord", note: "주거지역 인접 시 조례로 제한" },
    culture: { s: "ok" },
    medical: { s: "ok" },
    amusement: { s: "ord", note: "주거지역 인접 시 조례로 제한" },
    warehouse: { s: "ok" },
    factory: { s: "ord", note: "제조업소 소규모 일부만" },
    education: { s: "ok" },
  },
  neighborhood: {
    apartment: { s: "ord", note: "조례 확인" },
    multifamily: { s: "ord" },
    officetel: { s: "ok" },
    detached: { s: "ord" },
    neighborhood1: { s: "ok" },
    neighborhood2: { s: "ok" },
    office: { s: "ok" },
    retail: { s: "ok", note: "대규모 판매시설 제외" },
    lodging: { s: "ord", note: "조례 확인" },
    culture: { s: "ok", note: "관람장 제외" },
    medical: { s: "ok", note: "격리병원 제외" },
    amusement: { s: "ord", note: "조례 확인" },
    warehouse: { s: "ord" },
    factory: { s: "ord", note: "제조업소 소규모 일부만" },
    education: { s: "ok" },
  },
};

/**
 * 서울특별시 도시계획 조례로 확정되는 칸 (지역이 서울일 때 zoneUses 위에 덮어씀).
 * 원문: 서울특별시 도시계획 조례 [시행 2026. 7. 13.] 별표 4(제1종일반주거)·5(제2종)·6(제3종)·7(준주거 불가)·9(일반상업 불가)·10(근린상업 불가),
 * 상업지역 숙박·위락은 별표 8 제2호(주거지역 경계 50m 이내 불가). 국가법령정보센터에서 확인 2026-11-11.
 */
export const seoulZoneUses = {
  general1: {
    neighborhood2: { s: "ok", note: "일부 업종만 (서울 별표4)" },
    retail: { s: "no" },
    culture: { s: "ok", note: "전시장·동식물원만" },
    medical: { s: "ok", note: "요양병원만" },
    warehouse: { s: "no" },
    factory: { s: "no" },
    education: { s: "ok", note: "학원 제외" },
  },
  general2: {
    officetel: { s: "no", note: "서울 별표5는 공공업무·금융·사무소만 허용" },
    neighborhood2: { s: "ok", note: "일부 업종만 (서울 별표5)" },
    office: { s: "ok", note: "공공업무·금융·사무소, 3,000㎡ 미만" },
    retail: { s: "ok", note: "소매 2,000㎡ 미만 · 20m 도로" },
    culture: { s: "ok", note: "공연장·집회장 4,000㎡ 미만, 전시장" },
    medical: { s: "ok", note: "병원만" },
    warehouse: { s: "ok", note: "창고·하역장 1,000㎡ 미만" },
    factory: { s: "no" },
    education: { s: "ok" },
  },
  general3: {
    officetel: { s: "ok", note: "20m 이상 도로에 접할 때" },
    neighborhood2: { s: "ok", note: "단란주점·안마시술소 제외" },
    office: { s: "ok" },
    retail: { s: "ok", note: "소매 2,000㎡ 미만 · 20m 도로" },
    culture: { s: "ok", note: "공연장·집회장 5,000㎡ 미만, 전시장" },
    medical: { s: "ok", note: "병원만" },
    warehouse: { s: "ok", note: "창고·하역장 2,000㎡ 미만" },
    factory: { s: "ok", note: "인쇄·봉제 등 일부 업종 · 8m 도로" },
    education: { s: "ok" },
  },
  semi: {
    lodging: { s: "no", note: "서울 별표7: 생활숙박도 불가" },
    warehouse: { s: "ok", note: "물류터미널·집배송시설 제외" },
    factory: { s: "ok", note: "일부 업종만 (영 별표7)" },
  },
  commercial: {
    apartment: { s: "ok", note: "주거복합만 (서울 별표16 용도비율)" },
    multifamily: { s: "ok", note: "다른 용도와 복합만" },
    detached: { s: "ok", note: "다른 용도와 복합만" },
    lodging: { s: "ok", note: "주거지역 경계 50m 이내 불가" },
    amusement: { s: "ok", note: "주거지역 경계 50m 이내 불가" },
    factory: { s: "no", note: "출판·인쇄·금은세공·지식산업센터만" },
  },
  neighborhood: {
    apartment: { s: "ok", note: "주거복합만 (서울 별표16 용도비율)" },
    multifamily: { s: "ok" },
    detached: { s: "ok" },
    lodging: { s: "ok", note: "주거지역 경계 50m 이내 불가" },
    amusement: { s: "ok", note: "주거지역 경계 50m 이내 불가" },
    warehouse: { s: "ok" },
    factory: { s: "no", note: "출판·인쇄·금은세공·지식산업센터만" },
  },
};

export function zoneUseStatus(zone, useId, region) {
  const table = zoneUses[zone];
  const base = (table && table[useId]) || { s: "ok" };
  if (region === "seoul") {
    const seoul = seoulZoneUses[zone] && seoulZoneUses[zone][useId];
    if (seoul) return { ...seoul, seoul: true };
  }
  return base;
}
