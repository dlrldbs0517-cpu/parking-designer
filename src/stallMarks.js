// 주차칸 표시 도우미: 전기차 충전기 자리 등. 평면(plan.js)·도면(sheet.js)·3D(scene.js)·CAD(dxf.js)가 같은 자리를 쓴다.
// 좌표는 평면 좌표(m, y 위 = 북). stall.aisle = 차로가 있는 쪽(n: y 큰 쪽, s, e, w).

// 충전기: 칸 뒤쪽(차로 반대편) 가운데, 폭 0.6m × 깊이 0.3m. 벽 쪽 칸이면 벽에 붙는 자리.
export function chargerRect(stall) {
  const W = 0.6;
  const D = 0.3;
  const a = stall.aisle;
  if (a === "n") return { x: stall.x + stall.w / 2 - W / 2, y: stall.y, w: W, d: D };
  if (a === "s") return { x: stall.x + stall.w / 2 - W / 2, y: stall.y + stall.d - D, w: W, d: D };
  if (a === "e") return { x: stall.x, y: stall.y + stall.d / 2 - W / 2, w: D, d: W };
  if (a === "w") return { x: stall.x + stall.w - D, y: stall.y + stall.d / 2 - W / 2, w: D, d: W };
  return { x: stall.x + stall.w / 2 - W / 2, y: stall.y + stall.d / 2 - D / 2, w: W, d: D };
}

// 번개 모양(충전기 기호) 꺾은선: 사각형 안에 맞춘 점 6개
export function boltPoints(r) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.d / 2;
  const s = Math.min(r.w, r.d) * 0.42;
  return [[cx + 0.15 * s, cy + s], [cx - 0.35 * s, cy - 0.05 * s], [cx + 0.05 * s, cy - 0.05 * s], [cx - 0.15 * s, cy - s], [cx + 0.35 * s, cy + 0.05 * s], [cx - 0.05 * s, cy + 0.05 * s]];
}

// 칸 종류 이름(도면 문자)
export function stallTag(stall) {
  if (stall.type === "disabled") return "장";
  if (stall.type === "parallel") return "평행";
  if (stall.eco) return stall.type === "extended" ? "확·전기" : "전기";
  if (stall.type === "extended") return "확";
  return "";
}
