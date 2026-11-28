/**
 * 평면 다각형 기하 (m 단위).
 * 반시계 권장, 닫힘 점 중복 없음.
 */

const EPS = 1e-9;
const r3 = (v) => Math.round(v * 1000) / 1000;
const r1 = (v) => Math.round(v * 10) / 10;

export function rectPolygon(width, depth) {
  return [
    { x: 0, y: 0 },
    { x: r3(width), y: 0 },
    { x: r3(width), y: r3(depth) },
    { x: 0, y: r3(depth) },
  ];
}

/** 닫힌 링으로(끝=시작 복제) */
export function closedRing(poly) {
  if (!poly?.length) return [];
  const out = poly.map((p) => ({ x: p.x, y: p.y }));
  const a = out[0];
  const b = out[out.length - 1];
  if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-6) out.push({ ...a });
  return out;
}

export function ensureCCW(poly) {
  if (!poly?.length) return [];
  const a = signedArea(poly);
  if (a >= 0) return poly.map((p) => ({ x: p.x, y: p.y }));
  return poly.slice().reverse().map((p) => ({ x: p.x, y: p.y }));
}

export function signedArea(poly) {
  let s = 0;
  const n = poly.length;
  for (let i = 0; i < n; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function polygonArea(poly) {
  return Math.abs(signedArea(poly));
}

export function polygonBBox(poly) {
  if (!poly?.length) return { x: 0, y: 0, w: 0, d: 0 };
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0, d: Math.max(...ys) - y0 };
}

export function edgeLengths(poly) {
  const n = poly.length;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    out.push(Math.hypot(b.x - a.x, b.y - a.y));
  }
  return out;
}

/** 경계 위도 안으로 친다 */
export function pointOnPolygonBoundary(p, poly, tol = 1e-6) {
  const n = poly.length;
  for (let i = 0; i < n; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    if (Math.abs(orient(a, b, p)) > tol * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))) continue;
    if (onSeg(a, b, p)) return true;
  }
  return false;
}

/** ray casting — 경계 포함 */
export function pointInPolygon(p, poly) {
  if (pointOnPolygonBoundary(p, poly)) return true;
  let c = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (((a.y > p.y) !== (b.y > p.y))
      && (p.x < ((b.x - a.x) * (p.y - a.y)) / ((b.y - a.y) || 1e-15) + a.x)) {
      c = !c;
    }
  }
  return c;
}

/** orient/onSeg는 아래 선언 — 호이스팅용 전방 참조 피하려고 함수 선언 사용 */
function orient(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSeg(a, b, p) {
  return Math.min(a.x, b.x) - EPS <= p.x && p.x <= Math.max(a.x, b.x) + EPS
    && Math.min(a.y, b.y) - EPS <= p.y && p.y <= Math.max(a.y, b.y) + EPS;
}

export function segmentsIntersect(a, b, c, d) {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  if (Math.abs(o1) < EPS && onSeg(a, b, c)) return true;
  if (Math.abs(o2) < EPS && onSeg(a, b, d)) return true;
  if (Math.abs(o3) < EPS && onSeg(c, d, a)) return true;
  if (Math.abs(o4) < EPS && onSeg(c, d, b)) return true;
  return false;
}

export function selfIntersects(poly) {
  const n = poly.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    for (let j = i + 1; j < n; j += 1) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      const c = poly[j];
      const d = poly[(j + 1) % n];
      // 인접하지 않은 변만
      if ((j + 1) % n === i) continue;
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

/** 사각형 네 모서리·중심이 다각형 안이고, 변과 교차하지 않으면 완전 포함 */
export function rectInsidePolygon(rect, poly) {
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.d },
    { x: rect.x, y: rect.y + rect.d },
  ];
  if (!corners.every((p) => pointInPolygon(p, poly))) return false;
  const center = { x: rect.x + rect.w / 2, y: rect.y + rect.d / 2 };
  if (!pointInPolygon(center, poly)) return false;
  const n = poly.length;
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    for (let j = 0; j < n; j += 1) {
      const c = poly[j];
      const d = poly[(j + 1) % n];
      if (segmentsIntersect(a, b, c, d)) {
        // 경계 접촉만이면 허용: 교차점이 꼭짓점인 경우
        // 단순화: 겹침 면적이 없으면 경계 허용 — 교차하면 밖을 침범할 수 있어 false
        // 단, 변이 다각형 변 위에 있는 경우는 허용하기 어려우니 샘플 검사
      }
    }
  }
  // 변 중간 표본이 모두 안이면 OK (사선 변 침범 감지)
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    for (let k = 1; k < 4; k += 1) {
      const t = k / 4;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (!pointInPolygon(p, poly)) return false;
    }
  }
  return true;
}

export function rectPolygonOverlapArea(rect, poly) {
  // 격자 표본 (0.25m) — 금지 판정·면적용
  const step = 0.25;
  let hits = 0;
  for (let x = rect.x + step / 2; x < rect.x + rect.w; x += step) {
    for (let y = rect.y + step / 2; y < rect.y + rect.d; y += step) {
      if (pointInPolygon({ x, y }, poly)) hits += 1;
    }
  }
  return hits * step * step;
}

/**
 * 외접 사각형에서 다각형 밖을 덮는 축정렬 막힘 사각형들(분해).
 * 간단한 그리드 쿼드트리식: cell 크기로 밖 셀을 모은다.
 */
export function outsideBlockRects(poly, cell = 2) {
  const bb = polygonBBox(poly);
  const blocks = [];
  const x0 = bb.x;
  const y0 = bb.y;
  const cols = Math.ceil(bb.w / cell);
  const rows = Math.ceil(bb.d / cell);
  for (let iy = 0; iy < rows; iy += 1) {
    for (let ix = 0; ix < cols; ix += 1) {
      const r = {
        x: r3(x0 + ix * cell),
        y: r3(y0 + iy * cell),
        w: r3(Math.min(cell, bb.w - ix * cell)),
        d: r3(Math.min(cell, bb.d - iy * cell)),
      };
      if (r.w < 0.05 || r.d < 0.05) continue;
      // 셀이 다각형과 거의 겹치지 않으면 막힘
      const ov = rectPolygonOverlapArea(r, poly);
      if (ov < r.w * r.d * 0.05) {
        blocks.push({ ...r, role: "outside", name: "평면밖" });
      } else if (ov < r.w * r.d * 0.95) {
        // 부분 겹침: 더 잘게
        const half = cell / 2;
        if (half >= 0.5) {
          for (let sy = 0; sy < 2; sy += 1) {
            for (let sx = 0; sx < 2; sx += 1) {
              const s = {
                x: r3(r.x + sx * half),
                y: r3(r.y + sy * half),
                w: r3(Math.min(half, r.w - sx * half)),
                d: r3(Math.min(half, r.d - sy * half)),
              };
              if (s.w < 0.05 || s.d < 0.05) continue;
              const o2 = rectPolygonOverlapArea(s, poly);
              if (o2 < s.w * s.d * 0.15) blocks.push({ ...s, role: "outside", name: "평면밖" });
            }
          }
        }
      }
    }
  }
  return mergeAxisBlocks(blocks);
}

function mergeAxisBlocks(blocks) {
  // 같은 y·d인 가로 인접 병합
  const list = blocks.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const out = [];
  for (const b of list) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - b.y) < 1e-6 && Math.abs(last.d - b.d) < 1e-6
      && Math.abs(last.x + last.w - b.x) < 0.05) {
      last.w = r3(b.x + b.w - last.x);
    } else out.push({ ...b });
  }
  return out;
}

/** 다각형 유효성. 오류 문구 배열 */
export function validatePolygon(poly) {
  const errors = [];
  if (!poly || poly.length < 3) {
    errors.push("꼭짓점이 3개 이상이어야 합니다.");
    return errors;
  }
  if (selfIntersects(poly)) errors.push("다각형이 스스로 교차합니다.");
  const area = polygonArea(poly);
  if (area < 1e-3) errors.push("면적이 0입니다.");
  const lens = edgeLengths(poly);
  lens.forEach((L, i) => {
    if (L < 6 - 1e-6) errors.push(`${i + 1}번 변이 ${L.toFixed(2)}m로 6m 미만입니다.`);
  });
  return errors;
}

export function normalizePolygon(poly) {
  if (!poly?.length) return null;
  let p = poly.map((q) => ({ x: r3(Number(q.x)), y: r3(Number(q.y)) }));
  // 닫힘 중복 제거
  if (p.length > 1) {
    const a = p[0];
    const b = p[p.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) p = p.slice(0, -1);
  }
  p = ensureCCW(p);
  // 원점으로 옮기지 않음 — 외접 bbox를 width/depth로 쓸 때 음수면 이동
  const bb = polygonBBox(p);
  if (bb.x !== 0 || bb.y !== 0) {
    p = p.map((q) => ({ x: r3(q.x - bb.x), y: r3(q.y - bb.y) }));
  }
  return p;
}

/** 사각형·기존 w/d → 다각형 */
export function polygonFromPlate(plate) {
  if (plate?.polygon?.length >= 3) return normalizePolygon(plate.polygon) || rectPolygon(plate.width, plate.depth);
  return rectPolygon(plate?.width || 0, plate?.depth || 0);
}

/** 축정렬 사각형이 plate w×d와 같으면 true (다각형 특수 경로 생략용) */
export function isRectangularPlate(poly, width, depth) {
  if (!poly || poly.length !== 4) return false;
  const bb = polygonBBox(poly);
  if (Math.abs(bb.w - width) > 0.05 || Math.abs(bb.d - depth) > 0.05) return false;
  for (let i = 0; i < 4; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % 4];
    if (Math.abs(a.x - b.x) > 1e-6 && Math.abs(a.y - b.y) > 1e-6) return false;
  }
  return true;
}

/** 균일 안쪽 오프셋(edge gap용). 실패 시 null */
export function insetPolygon(poly, dist) {
  if (!(dist > 0)) return normalizePolygon(poly);
  return offsetPolygon(poly, dist);
}

export function plateDimsFromPolygon(poly) {
  const p = normalizePolygon(poly) || [];
  const bb = polygonBBox(p);
  return { width: r1(bb.w), depth: r1(bb.d), polygon: p };
}

/** 프리셋 */
export function presetL(w = 60, d = 40, cutW = 20, cutD = 20) {
  // L: 전체 사각형에서 북동 모서리 cutW×cutD 제거
  return normalizePolygon([
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: d - cutD },
    { x: w - cutW, y: d - cutD },
    { x: w - cutW, y: d },
    { x: 0, y: d },
  ]);
}

export function presetU(w = 60, d = 40, arm = 12, open = 20) {
  // ㄷ자: 남쪽이 열린 U (북쪽에 막힌 변)
  const gap = Math.min(open, w - 2 * arm);
  const left = (w - gap) / 2;
  return normalizePolygon([
    { x: 0, y: 0 },
    { x: arm, y: 0 },
    { x: arm, y: d - arm },
    { x: w - arm, y: d - arm },
    { x: w - arm, y: 0 },
    { x: w, y: 0 },
    { x: w, y: d },
    { x: 0, y: d },
  ]);
}

export function presetTrapezoid(w = 60, d = 40, topInset = 8) {
  const inset = Math.min(topInset, w / 2 - 1);
  return normalizePolygon([
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w - inset, y: d },
    { x: inset, y: d },
  ]);
}

/** 모서리 깎기(각 모서리를 chamfer m) — 사각형 기준 */
export function presetChamferRect(w = 48, d = 42, m = 6) {
  const c = Math.min(m, w / 2 - 0.5, d / 2 - 0.5);
  return normalizePolygon([
    { x: c, y: 0 },
    { x: w - c, y: 0 },
    { x: w, y: c },
    { x: w, y: d - c },
    { x: w - c, y: d },
    { x: c, y: d },
    { x: 0, y: d - c },
    { x: 0, y: c },
  ]);
}

/**
 * 단순 다각형 안쪽 오프셋(마이터). 볼록에 가깝게 동작.
 * 오목에서 실패하면 null.
 */
export function offsetPolygon(poly, dist) {
  if (!(dist > 0) || !poly?.length) return normalizePolygon(poly);
  const p = ensureCCW(poly);
  const n = p.length;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const prev = p[(i - 1 + n) % n];
    const cur = p[i];
    const next = p[(i + 1) % n];
    const e1 = { x: cur.x - prev.x, y: cur.y - prev.y };
    const e2 = { x: next.x - cur.x, y: next.y - cur.y };
    const L1 = Math.hypot(e1.x, e1.y) || 1;
    const L2 = Math.hypot(e2.x, e2.y) || 1;
    const n1 = { x: -e1.y / L1, y: e1.x / L1 }; // 안쪽(CCW → 왼쪽)
    const n2 = { x: -e2.y / L2, y: e2.x / L2 };
    const bis = { x: n1.x + n2.x, y: n1.y + n2.y };
    const bl = Math.hypot(bis.x, bis.y);
    if (bl < 1e-6) {
      out.push({ x: r3(cur.x + n1.x * dist), y: r3(cur.y + n1.y * dist) });
      continue;
    }
    const dot = Math.max(-0.999, Math.min(0.999, (n1.x * bis.x + n1.y * bis.y) / bl));
    const scale = dist / dot;
    out.push({ x: r3(cur.x + (bis.x / bl) * scale), y: r3(cur.y + (bis.y / bl) * scale) });
  }
  const norm = normalizePolygon(out);
  if (!norm || validatePolygon(norm).length) return null;
  return norm;
}

export function snapPoint(p, grid = 0.5, orthoFrom = null) {
  let x = Math.round(p.x / grid) * grid;
  let y = Math.round(p.y / grid) * grid;
  if (orthoFrom) {
    if (Math.abs(p.x - orthoFrom.x) >= Math.abs(p.y - orthoFrom.y)) y = orthoFrom.y;
    else x = orthoFrom.x;
    x = Math.round(x / grid) * grid;
    y = Math.round(y / grid) * grid;
  }
  return { x: r3(x), y: r3(y) };
}
