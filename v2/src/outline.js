// 주차장 외곽(다각형) 도우미 — 직사각형이 아닌 주차장.
// 외곽 = 꼭짓점 목록 [[x,y], ...] (m, 원점 = 외곽을 감싸는 직사각형의 왼쪽 아래, y 위 = 북).
// 엔진은 감싸는 직사각형으로 계산하고, 외곽 바깥 부분은 '못 쓰는 곳(void)' 직사각형들로 막는다.

const EPS = 1e-6;

export function polygonArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

// 점이 다각형 안(경계 포함)인지
export function insidePolygon(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    // 경계 위
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if (Math.abs(cross) < 1e-6 && x >= Math.min(xi, xj) - EPS && x <= Math.max(xi, xj) + EPS && y >= Math.min(yi, yj) - EPS && y <= Math.max(yi, yj) + EPS) return true;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function bboxOf(pts) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys) };
}

// 외곽을 원점(왼쪽 아래 = 0,0)으로 옮기고, 0.05m 단위로 반올림
export function normalizeOutline(pts) {
  const b = bboxOf(pts);
  return pts.map(([x, y]) => [Math.round((x - b.x) * 20) / 20, Math.round((y - b.y) * 20) / 20]);
}

export function isOrthogonal(pts) {
  return pts.every((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return Math.abs(p[0] - q[0]) < 0.01 || Math.abs(p[1] - q[1]) < 0.01;
  });
}

// 외곽 검사: 점 3개 이상, 변이 서로 꼬이지 않음, 넓이 > 0
export function outlineProblem(pts) {
  if (!pts || pts.length < 3) return "꼭짓점이 3개 이상 있어야 합니다.";
  if (polygonArea(pts) < 1) return "넓이가 0입니다.";
  const n = pts.length;
  const segX = (a, b, c, d) => {
    const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;
      if (segX(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return "변이 서로 꼬여 있습니다.";
    }
  }
  return "";
}

// 감싸는 직사각형(0..W, 0..D) 안에서 외곽 바깥 부분을 직사각형들로 나눈다.
// 직각 다각형이면 정확히, 사선이 있으면 0.5m 칸으로 잘라 '칸이 통째로 안에 있지 않으면 못 씀'으로(안전하게) 본다.
export function outlineVoids(pts, W, D) {
  if (!pts || pts.length < 3) return [];
  const xs = new Set([0, W]);
  const ys = new Set([0, D]);
  pts.forEach(([x, y]) => { xs.add(x); ys.add(y); });
  const step = 0.5;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    if (Math.abs(p[0] - q[0]) > 0.01 && Math.abs(p[1] - q[1]) > 0.01) {
      for (let x = Math.min(p[0], q[0]); x < Math.max(p[0], q[0]); x += step) xs.add(Math.round(x * 100) / 100);
      for (let y = Math.min(p[1], q[1]); y < Math.max(p[1], q[1]); y += step) ys.add(Math.round(y * 100) / 100);
    }
  });
  const X = [...xs].filter((v) => v >= -EPS && v <= W + EPS).sort((a, b) => a - b);
  const Y = [...ys].filter((v) => v >= -EPS && v <= D + EPS).sort((a, b) => a - b);
  // 칸마다 안/밖
  const outside = [];
  for (let j = 0; j + 1 < Y.length; j += 1) {
    const row = [];
    for (let i = 0; i + 1 < X.length; i += 1) {
      const x0 = X[i]; const x1 = X[i + 1]; const y0 = Y[j]; const y1 = Y[j + 1];
      if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4) { row.push(false); continue; }
      const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1], [(x0 + x1) / 2, (y0 + y1) / 2]];
      row.push(!corners.every(([x, y]) => insidePolygon(pts, x, y)));
    }
    outside.push(row);
  }
  // 가로로 이어 붙인 띠 → 위아래로 같은 띠면 합침
  const strips = [];
  outside.forEach((row, j) => {
    let i = 0;
    while (i < row.length) {
      if (!row[i]) { i += 1; continue; }
      let k = i;
      while (k + 1 < row.length && row[k + 1]) k += 1;
      strips.push({ x: X[i], w: X[k + 1] - X[i], y: Y[j], d: Y[j + 1] - Y[j] });
      i = k + 1;
    }
  });
  const merged = [];
  strips.sort((a, b) => a.x - b.x || a.w - b.w || a.y - b.y).forEach((s) => {
    const last = merged.find((m) => Math.abs(m.x - s.x) < 1e-6 && Math.abs(m.w - s.w) < 1e-6 && Math.abs(m.y + m.d - s.y) < 1e-6);
    if (last) last.d += s.d;
    else merged.push({ ...s });
  });
  return merged.map((r) => ({ x: round3(r.x), y: round3(r.y), w: round3(r.w), d: round3(r.d), void: true }));
}

// 사각형을 안쪽으로 c만큼 넓혀(감싸는 직사각형 안으로 잘라) — 외곽 벽 두께·여유를 못 쓰는 곳에 더할 때
export function growRect(r, c, W, D) {
  const x0 = Math.max(0, r.x - c);
  const y0 = Math.max(0, r.y - c);
  const x1 = Math.min(W, r.x + r.w + c);
  const y1 = Math.min(D, r.y + r.d + c);
  return { ...r, x: round3(x0), y: round3(y0), w: round3(x1 - x0), d: round3(y1 - y0) };
}

function round3(v) { return Math.round(v * 1000) / 1000; }
