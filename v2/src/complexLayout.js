/**
 * 단지형 전용 "차로 먼저"(loop-first) 배치 엔진.
 * 외부 램프 + 직사각형 평면만 다룬다. 그 외는 null → 기존 layout.js 사용.
 * layout.js와 순환 import를 피하려고 상수·겹침 계산은 여기에 둔다.
 * 근거·목표: docs/redesign/redesign-plan.md
 */
import { assignStallTypes, stallRuleTargets, tallyStallTypes } from "./stallTypes.js?v=365";
import { polygonFromPlate, rectInsidePolygon, isRectangularPlate } from "./polygon.js?v=365";

const AISLE = 6;
const STALL_W = 2.5;
const STALL_D_GENERAL = 5;
const STALL_D_EXTENDED = 5.2;
const COLUMN = 0.5;
const MIN_PART = 2.5;
const ACCESS_LEN = 3;
const EPS = 0.05;

function overlapArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function rectGap(a, b) {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y);
  if (ox > 0 && oy > 0) return 0;
  const dx = ox > 0 ? 0 : -ox;
  const dy = oy > 0 ? 0 : -oy;
  return Math.hypot(dx, dy);
}

function round1(v) { return Math.round(v * 10) / 10; }
function round3(v) { return Math.round(v * 1000) / 1000; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function almost(a, b, e = EPS) { return Math.abs(a - b) <= e; }

function stallDepthOf(plate) {
  const legal = Number(plate.legalStalls) || Number(plate.stallRules?.legalStalls) || 0;
  return legal >= 50 ? STALL_D_EXTENDED : STALL_D_GENERAL;
}

function moduleSpan(Sd) {
  return AISLE + 2 * Sd;
}

function overlapsAny(rect, list, tol = 0.05) {
  return (list || []).some((b) => overlapArea(rect, b) > tol);
}

function uniqueSorted(vals, eps = 0.08) {
  const out = [];
  [...vals].filter((v) => Number.isFinite(v)).sort((a, b) => a - b).forEach((v) => {
    if (!out.length || Math.abs(out[out.length - 1] - v) > eps) out.push(round3(v));
  });
  return out;
}

function subtractRect(rect, block) {
  if (overlapArea(rect, block) <= 0) return [rect];
  const x1 = Math.max(rect.x, block.x);
  const x2 = Math.min(rect.x + rect.w, block.x + block.w);
  const y1 = Math.max(rect.y, block.y);
  const y2 = Math.min(rect.y + rect.d, block.y + block.d);
  const parts = [];
  if (y1 - rect.y > 0.05) parts.push({ x: rect.x, y: rect.y, w: rect.w, d: y1 - rect.y });
  if (rect.y + rect.d - y2 > 0.05) parts.push({ x: rect.x, y: y2, w: rect.w, d: rect.y + rect.d - y2 });
  if (x1 - rect.x > 0.05) parts.push({ x: rect.x, y: y1, w: x1 - rect.x, d: y2 - y1 });
  if (rect.x + rect.w - x2 > 0.05) parts.push({ x: x2, y: y1, w: rect.x + rect.w - x2, d: y2 - y1 });
  return parts;
}

function cutAisleByObstacle(aisle, block) {
  if (overlapArea(aisle, block) < 0.04) return [aisle];
  const along = aisle.along || (aisle.w + 0.01 >= aisle.d ? "x" : "y");
  const horiz = along === "x";
  const blk = horiz
    ? { x: block.x, y: aisle.y, w: block.w, d: aisle.d }
    : { x: aisle.x, y: block.y, w: aisle.w, d: block.d };
  return subtractRect(aisle, blk)
    .filter((p) => (along === "x" ? p.w : p.d) >= MIN_PART && (along === "x" ? p.d : p.w) >= AISLE - 0.05)
    .map((p) => ({ ...aisle, ...p, along, portals: aisle.portals ? aisle.portals.slice() : [] }));
}

function cutAll(aisles, obstacles) {
  let next = aisles.slice();
  for (const ob of obstacles) {
    next = next.flatMap((a) => cutAisleByObstacle(a, ob));
  }
  return next;
}

/** 같은 방향·같은 띠의 맞닿은 차로를 하나로 합친다. */
function mergeAisles(aisles) {
  const list = aisles.map((a) => ({ ...a, portals: a.portals ? a.portals.slice() : [] }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        const aH = (a.along || (a.w >= a.d ? "x" : "y")) === "x";
        const bH = (b.along || (b.w >= b.d ? "x" : "y")) === "x";
        if (aH !== bH) continue;
        if (aH) {
          if (!almost(a.y, b.y, 0.15) || !almost(a.d, b.d, 0.15)) continue;
          const a1 = a.x;
          const a2 = a.x + a.w;
          const b1 = b.x;
          const b2 = b.x + b.w;
          if (b1 > a2 + 0.2 || a1 > b2 + 0.2) continue;
          const x = Math.min(a1, b1);
          const w = Math.max(a2, b2) - x;
          list[i] = {
            ...a,
            x: round3(x),
            y: round3(Math.min(a.y, b.y)),
            w: round3(w),
            d: round3(Math.max(a.d, b.d)),
            along: "x",
            role: a.role === "entry" || b.role === "entry" ? "entry" : (a.role || b.role),
            portals: [...new Set([...(a.portals || []), ...(b.portals || [])])],
          };
        } else {
          if (!almost(a.x, b.x, 0.15) || !almost(a.w, b.w, 0.15)) continue;
          const a1 = a.y;
          const a2 = a.y + a.d;
          const b1 = b.y;
          const b2 = b.y + b.d;
          if (b1 > a2 + 0.2 || a1 > b2 + 0.2) continue;
          const y = Math.min(a1, b1);
          const d = Math.max(a2, b2) - y;
          list[i] = {
            ...a,
            x: round3(Math.min(a.x, b.x)),
            y: round3(y),
            w: round3(Math.max(a.w, b.w)),
            d: round3(d),
            along: "y",
            role: a.role === "entry" || b.role === "entry" ? "entry" : (a.role || b.role),
            portals: [...new Set([...(a.portals || []), ...(b.portals || [])])],
          };
        }
        list.splice(j, 1);
        changed = true;
        break;
      }
      if (changed) break;
    }
  }
  return list;
}

function towerAccessOk(tower, aisles) {
  return (aisles || []).some((a) => {
    const ox = Math.min(tower.x + tower.w, a.x + a.w) - Math.max(tower.x, a.x);
    const oy = Math.min(tower.y + tower.d, a.y + a.d) - Math.max(tower.y, a.y);
    if (ox >= ACCESS_LEN - 0.05 && oy >= -0.05 && oy < 0.35) return true;
    if (oy >= ACCESS_LEN - 0.05 && ox >= -0.05 && ox < 0.35) return true;
    return rectGap(tower, a) < 0.05 && Math.max(ox, oy) >= ACCESS_LEN - 0.05;
  });
}

function aisleComponentsFixed(aisles) {
  const n = aisles.length;
  const adj = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (rectGap(aisles[i], aisles[j]) < 0.2) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }
  const seen = new Set();
  const groups = [];
  for (let i = 0; i < n; i += 1) {
    if (seen.has(i)) continue;
    const q = [i];
    seen.add(i);
    const g = [];
    while (q.length) {
      const u = q.pop();
      g.push(u);
      adj[u].forEach((v) => {
        if (!seen.has(v)) { seen.add(v); q.push(v); }
      });
    }
    groups.push(g);
  }
  return groups.sort((a, b) => {
    const la = a.reduce((s, i) => s + aisles[i].w * aisles[i].d, 0);
    const lb = b.reduce((s, i) => s + aisles[i].w * aisles[i].d, 0);
    return lb - la;
  });
}

// note: both reducers correctly use their own index arrays a/b

/** 점이 기존 차로 안이면 true */
function pointOnAisle(x, y, aisles, pad = 0.2) {
  return aisles.some((a) => (
    x >= a.x - pad && x <= a.x + a.w + pad && y >= a.y - pad && y <= a.y + a.d + pad
  ));
}

/** 새 차로 사각형에서 기존 차로와 겹친 부분을 잘라 짧은 토막만 남긴다. */
function uncoverLink(box, aisles) {
  let parts = [box];
  for (const a of aisles) {
    parts = parts.flatMap((p) => {
      if (overlapArea(p, a) < 0.1) return [p];
      return subtractRect(p, a);
    });
  }
  const along = box.along || (box.w >= box.d ? "x" : "y");
  return parts
    .map((p) => ({ ...box, ...p, along, role: "link", phase: "bypass", portals: [] }))
    .filter((p) => (along === "x" ? p.d : p.w) >= AISLE - 0.2 && (along === "x" ? p.w : p.d) >= MIN_PART);
}

/** 6m 통로 Dijkstra — 직선 구간만 링크로 내보내고, 기존 차로와 겹친 부분은 뺀다. */
function linkPath(fromAisles, goalTest, aisles, towers, plate, spacing, Sd, forbidAisle = null) {
  const starts = Array.isArray(fromAisles) ? fromAisles : [fromAisles];
  const W = plate.width;
  const D = plate.depth;
  const step = spacing || 8.1;
  const xs = uniqueSorted([
    AISLE / 2,
    W - AISLE / 2,
    ...aisles.map((a) => a.x + a.w / 2),
    ...towers.flatMap((t) => [t.x - 3, t.x + t.w + 3]),
    ...Array.from({ length: Math.floor((W - 6) / step) + 1 }, (_, i) => AISLE / 2 + i * step),
  ].filter((x) => x >= AISLE / 2 - 0.01 && x <= W - AISLE / 2 + 0.01), 0.35);

  const ys = uniqueSorted([
    AISLE / 2,
    D - AISLE / 2,
    ...aisles.map((a) => a.y + a.d / 2),
    ...towers.flatMap((t) => [t.y - 3, t.y + t.d + 3]),
    ...Array.from({ length: Math.floor((D - 6) / step) + 1 }, (_, i) => AISLE / 2 + i * step),
  ].filter((y) => y >= AISLE / 2 - 0.01 && y <= D - AISLE / 2 + 0.01), 0.35);

  const key = (i, j) => `${i},${j}`;
  const cellOk = (cx, cy) => {
    const box = { x: cx - AISLE / 2, y: cy - AISLE / 2, w: AISLE, d: AISLE };
    if (box.x < -0.05 || box.y < -0.05 || box.x + box.w > W + 0.05 || box.y + box.d > D + 0.05) return false;
    if (forbidAisle && overlapArea(box, forbidAisle) > AISLE * AISLE * 0.4) return false;
    return !overlapsAny(box, towers, 0.25);
  };

  const startNodes = [];
  xs.forEach((x, i) => ys.forEach((y, j) => {
    if (!cellOk(x, y)) return;
    if (starts.some((a) => rectGap({ x: x - 0.5, y: y - 0.5, w: 1, d: 1 }, a) < 0.8)) {
      startNodes.push({ i, j, x, y });
    }
  }));
  if (!startNodes.length && starts[0]) {
    const cx = starts[0].x + starts[0].w / 2;
    const cy = starts[0].y + starts[0].d / 2;
    let bi = 0;
    let bj = 0;
    let bestD = Infinity;
    xs.forEach((x, i) => ys.forEach((y, j) => {
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < bestD && cellOk(x, y)) { bestD = d; bi = i; bj = j; }
    }));
    startNodes.push({ i: bi, j: bj, x: xs[bi], y: ys[bj] });
  }

  startNodes.sort((a, b) => {
    const ao = pointOnAisle(a.x, a.y, aisles) ? 0 : 1;
    const bo = pointOnAisle(b.x, b.y, aisles) ? 0 : 1;
    return ao - bo;
  });

  const stallCost = Math.max(1, 2.5 * Sd);
  let best = null;
  for (const start of startNodes.slice(0, 12)) {
    const dist = new Map();
    const prev = new Map();
    const pq = [{ k: key(start.i, start.j), i: start.i, j: start.j, x: start.x, y: start.y, c: 0, dir: null }];
    dist.set(pq[0].k, 0);
    let guard = 0;
    while (pq.length && guard++ < 8000) {
      pq.sort((a, b) => a.c - b.c);
      const cur = pq.shift();
      if (cur.c > (dist.get(cur.k) ?? Infinity) + 1e-9) continue;
      const here = { x: cur.x - 0.5, y: cur.y - 0.5, w: 1, d: 1 };
      if (goalTest(here, cur)) {
        const path = [];
        let p = cur;
        while (p) {
          path.push(p);
          p = prev.get(p.k);
        }
        path.reverse();
        if (!best || cur.c < best.cost) best = { cost: cur.c, path };
        break;
      }
      const neighbors = [];
      if (cur.i > 0) neighbors.push({ i: cur.i - 1, j: cur.j, dir: "h" });
      if (cur.i < xs.length - 1) neighbors.push({ i: cur.i + 1, j: cur.j, dir: "h" });
      if (cur.j > 0) neighbors.push({ i: cur.i, j: cur.j - 1, dir: "v" });
      if (cur.j < ys.length - 1) neighbors.push({ i: cur.i, j: cur.j + 1, dir: "v" });
      for (const nb of neighbors) {
        const nx = xs[nb.i];
        const ny = ys[nb.j];
        if (!cellOk(nx, ny)) continue;
        const nk = key(nb.i, nb.j);
        const onAisle = pointOnAisle(nx, ny, aisles) && pointOnAisle(cur.x, cur.y, aisles);
        const segLen = Math.abs(nx - cur.x) + Math.abs(ny - cur.y);
        const turn = cur.dir && cur.dir !== nb.dir ? 0.5 : 0;
        // 새 차로 면적 비용: 길이×6 / 칸면적
        const cost = cur.c + (onAisle ? 0.01 : (segLen * AISLE) / stallCost) + turn + 0.01;
        if (cost < (dist.get(nk) ?? Infinity)) {
          dist.set(nk, cost);
          prev.set(nk, cur);
          pq.push({ k: nk, i: nb.i, j: nb.j, x: nx, y: ny, c: cost, dir: nb.dir });
        }
      }
    }
  }
  if (!best || best.path.length < 2) return [];

  const runs = [];
  let run = [best.path[0]];
  let dir = null;
  for (let i = 1; i < best.path.length; i += 1) {
    const a = best.path[i - 1];
    const b = best.path[i];
    const d = almost(a.y, b.y, 0.2) ? "h" : "v";
    if (dir == null) dir = d;
    if (d !== dir) {
      runs.push(run);
      run = [a, b];
      dir = d;
    } else {
      run.push(b);
    }
  }
  runs.push(run);

  const links = [];
  for (const r of runs) {
    if (r.length < 2) continue;
    const first = r[0];
    const last = r[r.length - 1];
    const horiz = almost(first.y, last.y, 0.2);
    const box = horiz
      ? {
        x: Math.min(first.x, last.x) - AISLE / 2,
        y: first.y - AISLE / 2,
        w: Math.abs(last.x - first.x) + AISLE,
        d: AISLE,
        along: "x",
      }
      : {
        x: first.x - AISLE / 2,
        y: Math.min(first.y, last.y) - AISLE / 2,
        w: AISLE,
        d: Math.abs(last.y - first.y) + AISLE,
        along: "y",
      };
    box.x = clamp(round3(box.x), 0, plate.width - 0.5);
    box.y = clamp(round3(box.y), 0, plate.depth - 0.5);
    box.w = round3(Math.min(box.w, plate.width - box.x));
    box.d = round3(Math.min(box.d, plate.depth - box.y));
    if (box.w < AISLE - 0.15 || box.d < AISLE - 0.15) continue;
    if (overlapsAny(box, towers, 0.3)) continue;
    uncoverLink(box, aisles).forEach((p) => links.push(p));
  }
  return links;
}

/** 목표에 가장 가까운 주 동선 차로를 고른다. */
function nearestAisle(target, aisles) {
  let best = aisles[0];
  let bestD = Infinity;
  aisles.forEach((a) => {
    const d = rectGap(a, target);
    if (d < bestD) { bestD = d; best = a; }
  });
  return best;
}

function buildFrame(plate, Sd, spec) {
  const W = plate.width;
  const D = plate.depth;
  const mod = moduleSpan(Sd);
  let n = Math.floor(D / mod) + (spec.nDelta || 0);
  n = Math.max(1, n);
  const used = n * mod;
  const slack = Math.max(0, D - used);
  let y0 = 0;
  if (typeof spec.slack === "number") y0 = clamp(spec.slack, 0, slack);
  else if (spec.slack === "end") y0 = slack;
  else if (spec.slack === "mid") y0 = slack / 2;
  else y0 = 0; // start

  const aisles = [];
  for (let i = 0; i < n; i += 1) {
    const y = y0 + i * mod + Sd;
    if (y + AISLE > D + 0.05) break;
    aisles.push({
      x: Sd,
      y: round3(y),
      w: round3(W - 2 * Sd),
      d: AISLE,
      along: "x",
      role: "ring",
      phase: "loop",
      side: "inner",
      portals: [],
    });
  }
  aisles.push({
    x: 0, y: 0, w: AISLE, d: D, along: "y", role: "ring", phase: "loop", side: "w", portals: [],
  });
  aisles.push({
    x: W - AISLE, y: 0, w: AISLE, d: D, along: "y", role: "ring", phase: "loop", side: "e", portals: [],
  });
  return { aisles, y0, n, mod, slack };
}

function entryCorridor(ramp, plate, aisles) {
  if (!ramp) return null;
  const edge = ramp.edge || "w";
  const t = Number(ramp.t) || plate.depth / 2;
  const half = Math.max(AISLE / 2, (Number(ramp.width) || 6) / 2);
  const y = clamp(t - half, 0, plate.depth - AISLE);
  const x = clamp(t - half, 0, plate.width - AISLE);

  if (edge === "w") {
    // 서측 순환 차로가 이미 있으므로 출입 표시만 (짧은 토막)
    return {
      x: 0, y: round3(y), w: AISLE, d: AISLE,
      along: "y", role: "entry", phase: "loop", portals: ["entry"],
    };
  }
  if (edge === "e") {
    return {
      x: plate.width - AISLE, y: round3(y), w: AISLE, d: AISLE,
      along: "y", role: "entry", phase: "loop", portals: ["entry"],
    };
  }
  if (edge === "s") {
    const targets = aisles.filter((a) => (a.along || "x") === "x").sort((a, b) => a.y - b.y);
    const hit = targets[0];
    const d = hit ? Math.max(AISLE, hit.y + 0.1) : AISLE;
    return {
      x: round3(x), y: 0, w: AISLE, d: round3(Math.min(d, plate.depth)),
      along: "y", role: "entry", phase: "loop", portals: ["entry"],
    };
  }
  const targets = aisles.filter((a) => (a.along || "x") === "x").sort((a, b) => b.y - a.y);
  const hit = targets[0];
  const top = hit ? hit.y + hit.d : plate.depth - AISLE;
  return {
    x: round3(x),
    y: round3(Math.max(0, top - 0.1)),
    w: AISLE,
    d: round3(plate.depth - Math.max(0, top - 0.1)),
    along: "y",
    role: "entry",
    phase: "loop",
    portals: ["entry"],
  };
}

function flipPlate(plate) {
  return { ...plate, width: plate.depth, depth: plate.width };
}

function flipRect(r) {
  return { ...r, x: r.y, y: r.x, w: r.d, d: r.w };
}

function flipEdge(edge) {
  return { w: "s", e: "n", s: "w", n: "e" }[edge] || edge;
}

function transposeResult(res, origPlate) {
  if (!res) return null;
  const mapR = (r) => (r ? flipRect(r) : r);
  return {
    ...res,
    stalls: (res.stalls || []).map((s) => {
      const f = mapR(s);
      const face = { n: "e", s: "w", e: "n", w: "s" }[s.aisle || s.face] || s.aisle;
      return { ...f, aisle: face, face, along: s.along === "x" ? "y" : "x" };
    }),
    aisles: (res.aisles || []).map((a) => {
      const f = mapR(a);
      return { ...f, along: a.along === "x" ? "y" : a.along === "y" ? "x" : a.along };
    }),
    columns: (res.columns || []).map(mapR),
    towers: (res.towers || []).map(mapR),
    cores: (res.cores || []).map(mapR),
    plate: origPlate,
  };
}

function bayXs(plate, spacing, bayFrom, Sd) {
  const cw = plate.columnWidth || COLUMN;
  const step = spacing || 8.1;
  const x0 = bayFrom === "e" ? plate.width - Sd - cw / 2 : Sd + cw / 2;
  const dir = bayFrom === "e" ? -1 : 1;
  const xs = [];
  for (let k = 0; k < 60; k += 1) {
    const x = x0 + dir * k * step;
    if (x < cw / 2 - 0.01 || x > plate.width - cw / 2 + 0.01) break;
    xs.push(round3(x));
  }
  return xs.sort((a, b) => a - b);
}

function placeColumns(aisles, towers, plate, spacing, Sd, bayFrom) {
  const cols = [];
  const cw = plate.columnWidth || COLUMN;
  const cd = plate.columnDepth || COLUMN;
  const xs = bayXs(plate, spacing, bayFrom, Sd);
  const major = aisles.filter((a) => (a.along || (a.w >= a.d ? "x" : "y")) === "x" && a.w >= 12);
  const bandYs = [];
  major.forEach((a) => {
    bandYs.push(a.y - cd / 2);
    bandYs.push(a.y + a.d + cd / 2);
  });
  uniqueSorted(bandYs, 0.15).forEach((cy) => {
    xs.forEach((cx) => {
      const col = { x: round3(cx - cw / 2), y: round3(cy - cd / 2), w: cw, d: cd };
      if (col.x < -0.02 || col.y < -0.02 || col.x + col.w > plate.width + 0.02 || col.y + col.d > plate.depth + 0.02) return;
      if (overlapsAny(col, towers, 0.001) || towers.some((t) => rectGap(col, t) < 0.02)) return;
      if (overlapsAny(col, aisles, 0.001)) return;
      cols.push(col);
    });
  });

  // 12m 초과 간격에 받침 기둥
  const byY = new Map();
  cols.forEach((c) => {
    const y = round1(c.y);
    if (!byY.has(y)) byY.set(y, []);
    byY.get(y).push(c);
  });
  byY.forEach((list) => {
    list.sort((a, b) => a.x - b.x);
    for (let i = 0; i < list.length - 1; i += 1) {
      const gap = list[i + 1].x - (list[i].x + list[i].w);
      if (gap <= 12) continue;
      const mid = (list[i].x + list[i].w + list[i + 1].x) / 2;
      const col = { x: round3(mid - cw / 2), y: list[i].y, w: cw, d: cd };
      if (
        !overlapsAny(col, towers, 0.001)
        && !towers.some((t) => rectGap(col, t) < 0.02)
        && !overlapsAny(col, aisles, 0.001)
      ) cols.push(col);
    }
  });
  return cols;
}

function frontClear(stall, aisles) {
  const depth = AISLE;
  const face = stall.aisle || stall.face || "n";
  const front = face === "n" ? { x: stall.x, y: stall.y + stall.d, w: stall.w, d: depth }
    : face === "s" ? { x: stall.x, y: stall.y - depth, w: stall.w, d: depth }
      : face === "e" ? { x: stall.x + stall.w, y: stall.y, w: depth, d: stall.d }
        : { x: stall.x - depth, y: stall.y, w: depth, d: stall.d };
  for (let i = 0; i < 2; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      const px = front.x + front.w * (0.2 + 0.6 * (i / 1));
      const py = front.y + front.d * (0.15 + 0.7 * (j / 2));
      if (!aisles.some((a) => px >= a.x - 1e-6 && px <= a.x + a.w + 1e-6 && py >= a.y - 1e-6 && py <= a.y + a.d + 1e-6)) {
        return false;
      }
    }
  }
  return true;
}

function fillStalls(aisles, towers, cores, columns, plate, Sd, spacing, bayFrom, keepClear = []) {
  const stalls = [];
  // keepClear는 칸·코어 금지(차로는 허용) → 장애물로만 넣고 차로 절단에는 안 씀
  const blocks = [].concat(towers || [], cores || [], columns || [], aisles || [], keepClear || []);
  const minClear = plate.minClear == null ? 0 : plate.minClear;
  const xs = bayXs(plate, spacing, bayFrom, Sd);
  const cw = plate.columnWidth || COLUMN;

  // 4m 격자 색인
  const cell = 4;
  const grid = new Map();
  const gkey = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  const indexRect = (r) => {
    const x0 = Math.floor(r.x / cell);
    const x1 = Math.floor((r.x + r.w) / cell);
    const y0 = Math.floor(r.y / cell);
    const y1 = Math.floor((r.y + r.d) / cell);
    for (let ix = x0; ix <= x1; ix += 1) {
      for (let iy = y0; iy <= y1; iy += 1) {
        const k = `${ix},${iy}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(r);
      }
    }
  };
  blocks.forEach(indexRect);

  const nearBlocks = (r) => {
    const seen = new Set();
    const out = [];
    const x0 = Math.floor(r.x / cell) - 1;
    const x1 = Math.floor((r.x + r.w) / cell) + 1;
    const y0 = Math.floor(r.y / cell) - 1;
    const y1 = Math.floor((r.y + r.d) / cell) + 1;
    for (let ix = x0; ix <= x1; ix += 1) {
      for (let iy = y0; iy <= y1; iy += 1) {
        const list = grid.get(`${ix},${iy}`);
        if (!list) continue;
        list.forEach((b) => {
          if (seen.has(b)) return;
          seen.add(b);
          out.push(b);
        });
      }
    }
    return out;
  };

  const tryAdd = (stall) => {
    if (stall.x < -0.02 || stall.y < -0.02 || stall.x + stall.w > plate.width + 0.02 || stall.y + stall.d > plate.depth + 0.02) return false;
    const pad = {
      x: stall.x - minClear,
      y: stall.y - minClear,
      w: stall.w + 2 * minClear,
      d: stall.d + 2 * minClear,
    };
    const near = nearBlocks(pad);
    if (near.some((b) => overlapArea(stall, b) > 0.04)) return false;
    if (minClear > 0 && columns.some((c) => rectGap(stall, c) < minClear - 0.001 && overlapArea(stall, c) <= 0)) {
      // keep gap from columns
      if (near.some((b) => columns.includes(b) && rectGap(stall, b) < minClear - 0.001)) return false;
    }
    if (!frontClear(stall, aisles)) return false;
    stalls.push(stall);
    blocks.push(stall);
    indexRect(stall);
    return true;
  };

  const major = aisles.filter((a) => Math.max(a.w, a.d) >= 6);

  major.forEach((a) => {
    const horiz = (a.along || (a.w >= a.d ? "x" : "y")) === "x";
    if (horiz) {
      // 차로 위 칸은 남쪽(차로)을 보고, 아래 칸은 북쪽을 본다 (layout.js fillBands와 동일).
      [["s", a.y + a.d], ["n", a.y - Sd]].forEach(([face, y]) => {
        if (y < -0.02 || y + Sd > plate.depth + 0.02) return;
        for (let i = 0; i < xs.length - 1; i += 1) {
          const left = xs[i] + cw / 2;
          const right = xs[i + 1] - cw / 2;
          if (right - left < STALL_W * 3 - 0.05) continue;
          if (left < a.x - 0.05 || right > a.x + a.w + 0.05) continue;
          for (let k = 0; k < 3; k += 1) {
            tryAdd({
              x: round3(left + k * STALL_W),
              y: round3(y),
              w: STALL_W,
              d: Sd,
              aisle: face,
              face,
              along: "x",
              type: "general",
              phase: "fill",
            });
          }
        }
        for (let x = a.x; x + STALL_W <= a.x + a.w + 0.05; x = round3(x + 0.1)) {
          tryAdd({
            x: round3(x), y: round3(y), w: STALL_W, d: Sd,
            aisle: face, face, along: "x", type: "general", phase: "fill",
          });
        }
      });
    } else {
      // 차로 동쪽 칸은 서쪽을, 서쪽 칸은 동쪽을 본다.
      [["w", a.x + a.w], ["e", a.x - Sd]].forEach(([face, x]) => {
        if (x < -0.02 || x + Sd > plate.width + 0.02) return;
        for (let y = a.y; y + STALL_W <= a.y + a.d + 0.05; y = round3(y + STALL_W)) {
          tryAdd({
            x: round3(x), y: round3(y), w: Sd, d: STALL_W,
            aisle: face, face, along: "y", type: "general", phase: "fill",
          });
        }
        for (let y = a.y; y + STALL_W <= a.y + a.d + 0.05; y = round3(y + 0.1)) {
          tryAdd({
            x: round3(x), y: round3(y), w: Sd, d: STALL_W,
            aisle: face, face, along: "y", type: "general", phase: "fill",
          });
        }
      });
    }
  });
  return stalls;
}

function longSpanCount(columns, limit = 12) {
  let n = 0;
  const byY = new Map();
  columns.forEach((c) => {
    const y = round1(c.y + c.d / 2);
    if (!byY.has(y)) byY.set(y, []);
    byY.get(y).push(c);
  });
  byY.forEach((list) => {
    list.sort((a, b) => a.x - b.x);
    for (let i = 0; i < list.length - 1; i += 1) {
      const gap = list[i + 1].x - (list[i].x + list[i].w);
      if (gap > limit) n += 1;
    }
  });
  return n;
}

function deadEndTips(aisles) {
  let n = 0;
  aisles.forEach((a, i) => {
    const horiz = (a.along || (a.w >= a.d ? "x" : "y")) === "x";
    const tips = horiz
      ? [
        { x: a.x - 0.5, y: a.y, w: 0.5, d: a.d },
        { x: a.x + a.w, y: a.y, w: 0.5, d: a.d },
      ]
      : [
        { x: a.x, y: a.y - 0.5, w: a.w, d: 0.5 },
        { x: a.x, y: a.y + a.d, w: a.w, d: 0.5 },
      ];
    tips.forEach((tip) => {
      const ahead = horiz
        ? { x: tip.x < a.x ? a.x - 1 : a.x + a.w, y: a.y + a.d / 2 - 0.5, w: 1, d: 1 }
        : { x: a.x + a.w / 2 - 0.5, y: tip.y < a.y ? a.y - 1 : a.y + a.d, w: 1, d: 1 };
      const side1 = horiz
        ? { x: a.x + (tip.x < a.x ? 0 : a.w - 1), y: a.y - 1, w: 1, d: 1 }
        : { x: a.x - 1, y: a.y + (tip.y < a.y ? 0 : a.d - 1), w: 1, d: 1 };
      const side2 = horiz
        ? { x: a.x + (tip.x < a.x ? 0 : a.w - 1), y: a.y + a.d, w: 1, d: 1 }
        : { x: a.x + a.w, y: a.y + (tip.y < a.y ? 0 : a.d - 1), w: 1, d: 1 };
      const connected = aisles.some((b, j) => j !== i && (
        overlapArea(tip, b) > 0.05
        || overlapArea(ahead, b) > 0.05
        || overlapArea(side1, b) > 0.05
        || overlapArea(side2, b) > 0.05
      ));
      if (!connected) n += 1;
    });
  });
  return n;
}

function assignTypes(stalls, plate, cores, towers, ramp) {
  const ortho = stalls.filter((s) => !s.parallel);
  const rules = stallRuleTargets({
    ...(plate.stallRules || {}),
    legalStalls: plate.legalStalls || plate.stallRules?.legalStalls,
    placedStalls: ortho.length,
  });
  const typed = assignStallTypes(ortho.map((s) => ({ ...s, type: "general" })), rules, {
    plate,
    columns: [],
    blocks: towers,
    cores,
    ramp,
    openings: [],
    blockRects: towers,
  });
  return { stalls: typed.stalls, targets: typed.targets || rules, counts: typed.counts, shortages: typed.shortages };
}

function pruneUselessAisles(aisles, stalls, towers) {
  const used = new Set();
  stalls.forEach((s) => {
    aisles.forEach((a, i) => {
      if (frontClear(s, [a]) || rectGap(s, a) < 0.1) used.add(i);
    });
  });
  // 연결·동 접근에 필요한 조각은 유지 — 일단 주 덩어리만 남기고 재검사
  const comps = aisleComponentsFixed(aisles);
  if (!comps.length) return aisles;
  const keep = new Set(comps[0]);
  aisles.forEach((a, i) => {
    if (a.role === "entry" || a.role === "link") keep.add(i);
    if (towers.some((t) => towerAccessOk(t, [a]))) keep.add(i);
    if (used.has(i)) keep.add(i);
    if (Math.max(a.w, a.d) >= 20) keep.add(i);
  });
  // 입구 덩어리와 이어진 것만
  const main = new Set();
  const entryI = aisles.findIndex((a) => a.role === "entry");
  const seed = entryI >= 0 ? comps.find((g) => g.includes(entryI)) || comps[0] : comps[0];
  (seed || []).forEach((i) => main.add(i));
  // keep ∩ reachable from entry, or whole keep if no entry
  return aisles.filter((_, i) => keep.has(i));
}

/**
 * @param {object} input
 * @param {object} spec
 */
export function layoutLoopFirst(input, spec = {}) {
  const plate0 = input.plate;
  if (!plate0) return null;
  const ramp0 = (input.ramps || [])[0];
  if (!ramp0) return null;
  const allowInternal = Boolean(input.allowInternalModule);
  if ((ramp0.placement || "internal") !== "external" && !allowInternal) return null;

  const extraObs = (input.obstacles || []).slice();
  const keepClear0 = (input.keepClear || plate0.keepClear || []).slice();

  const axis = spec.axis || "x";
  const flipKeep = (zs) => (axis === "y" ? zs.map((z) => flipRect(z)) : zs.map((z) => ({ ...z })));
  const working = axis === "y"
    ? {
      plate: flipPlate(plate0),
      towers: (input.towers || input.plate.blockRects || []).map((t) => flipRect(t))
        .concat(extraObs.map((t) => flipRect(t))),
      cores: (input.cores || []).map((c) => flipRect(c)),
      ramp: { ...ramp0, edge: flipEdge(ramp0.edge), t: ramp0.t, placement: "external" },
      keepClear: flipKeep(keepClear0),
    }
    : {
      plate: plate0,
      towers: (input.towers || input.plate.blockRects || []).map((t) => ({ ...t }))
        .concat(extraObs.map((t) => ({ ...t }))),
      cores: (input.cores || []).map((c) => ({ ...c })),
      ramp: { ...ramp0, placement: "external" },
      keepClear: keepClear0.map((z) => ({ ...z })),
    };

  const plate = working.plate;
  const Sd = stallDepthOf(plate0);
  const spacing = plate0.spacing || 8.1;
  const towers = working.towers;
  let cores = working.cores;
  const ramp = working.ramp;
  const keepClear = working.keepClear;

  const frame = buildFrame(plate, Sd, spec);
  let aisles = frame.aisles.slice();
  const entry = entryCorridor(ramp, plate, aisles);
  if (entry) aisles.push(entry);
  // 내부·걸침 모듈만 keepClear를 차로로 넣어 도착·진입이 순환과 이어지게 한다.
  // 외부형은 entryCorridor만 쓰고(기존과 대수 맞춤), keepClear는 칸 금지로만 쓴다.
  if (allowInternal) {
    keepClear.forEach((z) => {
      if (!z || !(z.w > 0.5 && z.d > 0.5)) return;
      aisles.push({
        x: z.x, y: z.y, w: z.w, d: z.d,
        role: "approach", phase: "loop", portals: [],
        along: z.w >= z.d ? "x" : "y",
      });
    });
  }

  aisles = mergeAisles(cutAll(aisles, towers.concat(cores)));

  let groups = aisleComponentsFixed(aisles);
  const entryIdx = aisles.findIndex((a) => a.role === "entry");
  let mainSet = new Set(groups[0] || []);
  if (entryIdx >= 0) {
    const g = groups.find((gr) => gr.includes(entryIdx));
    if (g) mainSet = new Set(g);
  }

  let links = 0;
  for (let iter = 0; iter < 12; iter += 1) {
    aisles = mergeAisles(aisles);
    groups = aisleComponentsFixed(aisles);
    const main = groups.find((g) => g.some((i) => mainSet.has(i))) || groups[0] || [];
    mainSet = new Set(main);
    const mainAisles = main.map((i) => aisles[i]);
    if (!mainAisles.length) break;

    const needTower = towers.find((t) => !towerAccessOk(t, aisles));
    if (needTower) {
      const from = nearestAisle(needTower, mainAisles);
      const path = linkPath(
        from,
        (here) => rectGap(here, needTower) < 3.2,
        aisles,
        towers,
        plate,
        spacing,
        Sd,
      );
      if (path.length) {
        aisles = mergeAisles(aisles.concat(path));
        links += path.length;
        continue;
      }
    }

    const orphans = groups.slice(1).map((g) => {
      const len = g.reduce((s, i) => s + Math.max(aisles[i].w, aisles[i].d), 0);
      return { g, len };
    }).sort((a, b) => b.len - a.len);

    // 15m 이상 고립 조각만 잇고, 짧은 조각은 버린다(짧은 연결로 칸을 희생하지 않음).
    const longOrphan = orphans.find((o) => o.len >= 15);
    if (longOrphan) {
      const target = aisles[longOrphan.g[0]];
      const from = nearestAisle(target, mainAisles);
      const path = linkPath(
        from,
        (here) => rectGap(here, target) < 1.2,
        aisles,
        towers,
        plate,
        spacing,
        Sd,
      );
      if (path.length) {
        // 새 차로 면적이 너무 크면(대략 칸 8대 이상) 잇지 않고 버림
        const newArea = path.reduce((s, p) => s + p.w * p.d, 0);
        if (newArea <= 8 * 2.5 * Sd) {
          aisles = mergeAisles(aisles.concat(path));
          links += path.length;
          continue;
        }
      }
      const drop = new Set(longOrphan.g);
      aisles = aisles.filter((_, i) => !drop.has(i));
      continue;
    }
    if (orphans.length) {
      const drop = new Set(orphans.flatMap((o) => o.g));
      aisles = aisles.filter((_, i) => !drop.has(i));
      continue;
    }
    break;
  }

  aisles = mergeAisles(aisles);
  groups = aisleComponentsFixed(aisles);
  if (groups.length > 1) {
    const keep = new Set();
    const entryI = aisles.findIndex((a) => a.role === "entry");
    const main = (entryI >= 0 && groups.find((g) => g.includes(entryI))) || groups[0];
    (main || []).forEach((i) => keep.add(i));
    groups.forEach((g) => {
      const subset = g.map((i) => aisles[i]);
      const len = subset.reduce((s, a) => s + Math.max(a.w, a.d), 0);
      const touchesTower = towers.some((t) => towerAccessOk(t, subset));
      if (touchesTower || len >= 20) g.forEach((i) => keep.add(i));
    });
    aisles = mergeAisles(aisles.filter((_, i) => keep.has(i)));
  }

  let columns = placeColumns(aisles, towers, plate, spacing, Sd, spec.bayFrom || "w");
  let stalls = fillStalls(aisles, towers, cores, columns, plate, Sd, spacing, spec.bayFrom || "w", keepClear);

  // 쓸모없는 짧은 차로 정리 후 재채움
  const pruned = pruneUselessAisles(aisles, stalls, towers);
  if (pruned.length < aisles.length) {
    aisles = mergeAisles(pruned);
    columns = placeColumns(aisles, towers, plate, spacing, Sd, spec.bayFrom || "w");
    stalls = fillStalls(aisles, towers, cores, columns, plate, Sd, spacing, spec.bayFrom || "w", keepClear);
  }

  let loopsClosed = 0;
  if (spec.closeLoops) {
    const lossLimit = spec.loopLoss == null ? 3 : spec.loopLoss;
    for (let k = 0; k < 8; k += 1) {
      const tips = deadEndTips(aisles);
      if (tips <= 0) break;
      // 막다른 끝 차로 하나 골라 다른 차로로 잇기
      let closed = false;
      for (let i = 0; i < aisles.length && !closed; i += 1) {
        const a = aisles[i];
        if (Math.max(a.w, a.d) < 8) continue;
        const horiz = (a.along || (a.w >= a.d ? "x" : "y")) === "x";
        const tipBoxes = horiz
          ? [
            { x: a.x - 0.5, y: a.y, w: 0.5, d: a.d },
            { x: a.x + a.w, y: a.y, w: 0.5, d: a.d },
          ]
          : [
            { x: a.x, y: a.y - 0.5, w: a.w, d: 0.5 },
            { x: a.x, y: a.y + a.d, w: a.w, d: 0.5 },
          ];
        for (const tip of tipBoxes) {
          const connected = aisles.some((b, j) => j !== i && overlapArea(tip, b) > 0.05);
          if (connected) continue;
          const path = linkPath(
            a,
            (here, cur) => aisles.some((b, j) => j !== i && rectGap({ x: cur.x - 0.5, y: cur.y - 0.5, w: 1, d: 1 }, b) < 0.8),
            aisles,
            towers,
            plate,
            spacing,
            Sd,
            a,
          );
          if (!path.length) continue;
          const trial = mergeAisles(aisles.concat(path));
          const cols2 = placeColumns(trial, towers, plate, spacing, Sd, spec.bayFrom || "w");
          const stalls2 = fillStalls(trial, towers, cores, cols2, plate, Sd, spacing, spec.bayFrom || "w", keepClear);
          const lost = stalls.length - stalls2.length;
          const spans0 = longSpanCount(columns);
          const tips2 = deadEndTips(trial);
          if (lost <= lossLimit && tips2 < tips && longSpanCount(cols2) <= spans0) {
            aisles = trial;
            columns = cols2;
            stalls = stalls2;
            loopsClosed += 1;
            closed = true;
            break;
          }
        }
      }
      if (!closed) break;
    }
  }

  // keepClear와 겹치는 칸은 최종에서도 제거
  if (keepClear.length) {
    stalls = stalls.filter((s) => !keepClear.some((z) => overlapArea(s, z) > 0.05));
  }
  const platePoly = polygonFromPlate(plate0);
  const nonRect = !isRectangularPlate(platePoly, plate0.width, plate0.depth);
  if (nonRect) {
    stalls = stalls.filter((s) => rectInsidePolygon(s, platePoly));
    columns = columns.filter((c) => rectInsidePolygon(c, platePoly));
    aisles = aisles.filter((a) => rectInsidePolygon(a, platePoly));
    cores = cores.filter((c) => rectInsidePolygon(c, platePoly));
  }
  const typed = assignTypes(stalls, plate0, cores, towers, ramp);
  stalls = typed.stalls;
  if (keepClear.length) {
    stalls = stalls.filter((s) => !keepClear.some((z) => overlapArea(s, z) > 0.05));
  }
  if (nonRect) {
    stalls = stalls.filter((s) => rectInsidePolygon(s, platePoly));
  }
  const counts = typed.counts || tallyStallTypes(stalls, typed.targets).counts;
  const targets = typed.targets;
  const shortages = typed.shortages || [];

  const groupsFinal = aisleComponentsFixed(aisles);
  const connected = groupsFinal.length <= 1;
  // 타워 접근은 원래 동만(모듈 장애물 제외)
  const towerOnly = (input.towers || input.plate.blockRects || []).map((t) => (axis === "y" ? flipRect(t) : { ...t }));
  const coreAccess = towerOnly.map((t) => towerAccessOk(t, aisles));
  const accessOk = !towerOnly.length || coreAccess.every(Boolean);
  let overlapCount = 0;
  for (let i = 0; i < stalls.length; i += 1) {
    for (let j = i + 1; j < stalls.length; j += 1) {
      if (overlapArea(stalls[i], stalls[j]) > 0.05) overlapCount += 1;
    }
    if (overlapsAny(stalls[i], aisles, 0.05)) overlapCount += 1;
    if (overlapsAny(stalls[i], towers, 0.05)) overlapCount += 1;
    if (overlapsAny(stalls[i], columns, 0.05)) overlapCount += 1;
  }
  // keepClear 구역이 큰 차로 묶음과 닿는지
  const mainIdx = groupsFinal[0] || [];
  const mainAisles = mainIdx.map((i) => aisles[i]);
  const zoneTouch = keepClear.map((z) => ({
    role: z.role,
    ok: mainAisles.some((a) => overlapArea(a, z) > 0.4),
  }));
  const unreachable = stalls.filter((s) => !frontClear(s, aisles)).length;
  const extOk = (counts.extended || 0) >= (targets.extended || 0);
  const disOk = (counts.disabled || 0) >= (targets.disabled || 0);
  const longSpans = longSpanCount(columns);
  const deadEnds = deadEndTips(aisles);
  const valid = connected && overlapCount === 0 && unreachable === 0 && accessOk && extOk && disOk && stalls.length > 0;

  let result = {
    stalls,
    aisles,
    columns,
    towers: towerOnly,
    cores,
    plate,
    ramp,
    keepClear,
    links,
    loopsClosed,
    spec: { ...spec, engine: "loopFirst", axis },
    metrics: {
      stalls: stalls.length,
      areaPerStall: stalls.length ? round3((plate.width * plate.depth) / stalls.length) : 0,
      aisleRatio: round3(aisles.reduce((s, a) => s + a.w * a.d, 0) / (plate.width * plate.depth)),
      connected,
      isolatedAisles: Math.max(0, groupsFinal.length - 1),
      deadEnds,
      overlapCount,
      unreachable,
      coreAccess,
      links,
      loopsClosed,
      longSpans,
      stallTypes: counts,
      stallTargets: targets,
      zoneTouch,
      valid,
      rejected: valid ? null : [
        !connected ? "동선 끊김" : null,
        overlapCount ? "충돌" : null,
        !accessOk ? "동 접근 없음" : null,
        !extOk || !disOk ? "구획 부족" : null,
        stalls.length === 0 ? "구획 없음" : null,
      ].filter(Boolean).join(" · ") || "조건 미달",
      shortages,
    },
  };

  if (axis === "y") {
    result = transposeResult(result, plate0);
    result.keepClear = (result.keepClear || keepClear).map((z) => flipRect(z));
  }
  return result;
}

function alignOffsets(plate, towers, Sd) {
  const mod = moduleSpan(Sd);
  const offsets = new Set();
  towers.forEach((t) => {
    // 동 앞/뒷면에 차로 가장자리·줄 뒷선이 오도록 (가장자리 코어용 구획 모듈 위상)
    [t.y - Sd, t.y + t.d - Sd - AISLE, t.y - 2 * Sd - AISLE, t.y + t.d,
      t.y - AISLE, t.y + t.d - AISLE].forEach((v) => {
      const o = round3(((v % mod) + mod) % mod);
      if (o >= 0 && o < mod) offsets.add(o);
    });
  });
  return [...offsets].filter((v) => Number.isFinite(v));
}

/** 동이 어느 변에 몰려 있는지 — 가장자리 코어면 그 변과 나란한 줄(axis)을 우선. */
function edgeCorePreferAxis(plate, towers) {
  if (!towers.length || !plate) return null;
  const ring = AISLE + stallDepthOf(plate);
  let north = 0;
  let south = 0;
  let west = 0;
  let east = 0;
  towers.forEach((t) => {
    const area = Math.max(1, t.w * t.d);
    if (t.y + t.d >= plate.depth - ring - 0.5) north += area;
    if (t.y <= ring + 0.5) south += area;
    if (t.x <= ring + 0.5) west += area;
    if (t.x + t.w >= plate.width - ring - 0.5) east += area;
  });
  const ns = north + south;
  const ew = east + west;
  if (ns < 1 && ew < 1) return null;
  // 북·남에 동이 많으면 가로 줄(axis x), 동·서면 세로 줄(axis y)
  return ns >= ew ? "x" : "y";
}

export function complexCandidates(input, opts = {}) {
  if (!input?.plate) return [];
  const ramp = (input.ramps || [])[0];
  if (!ramp) return [];
  // 내부형은 complexInputOf가 외부 스텁으로 바꿔 넘긴다.
  if ((ramp.placement || "internal") !== "external" && !input.allowInternalModule) return [];
  const quick = Boolean(opts.quick);
  const Sd = stallDepthOf(input.plate);
  const towers = input.towers || input.plate.blockRects || [];
  const aligns = alignOffsets(input.plate, towers, Sd);
  const preferAxis = edgeCorePreferAxis(input.plate, towers);
  const slacks = quick
    ? ["start", "end", ...aligns.slice(0, 3)]
    : ["start", "end", "mid", ...aligns.slice(0, 5)];
  const bayFroms = quick ? ["w"] : ["w", "e"];
  const deltas = quick ? [0] : [0, -1];
  // 가장자리 코어면 선호 축을 먼저 탐색
  const axes = preferAxis
    ? (quick ? [preferAxis] : [preferAxis, preferAxis === "x" ? "y" : "x"])
    : ["x", "y"];
  const specs = [];
  for (const axis of axes) {
    for (const nDelta of deltas) {
      for (const slack of slacks) {
        for (const bayFrom of bayFroms) {
          specs.push({
            axis, nDelta, slack, bayFrom, closeLoops: false, goal: "count",
            edgeCore: preferAxis === axis,
          });
        }
      }
    }
  }
  const seen = new Set();
  const raw = [];
  for (const spec of specs) {
    const r = layoutLoopFirst(input, spec);
    if (!r || !r.metrics) continue;
    const key = `${r.metrics.stalls}|${r.metrics.deadEnds}|${r.spec.axis}|${(r.aisles || []).length}|${r.metrics.valid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    raw.push(r);
  }
  raw.sort((a, b) => {
    if (a.metrics.valid !== b.metrics.valid) return a.metrics.valid ? -1 : 1;
    // 가장자리 코어에 맞춘 축 우선
    const ae = a.spec?.edgeCore ? 1 : 0;
    const be = b.spec?.edgeCore ? 1 : 0;
    if (ae !== be) return be - ae;
    if ((a.metrics.longSpans || 0) !== (b.metrics.longSpans || 0)) {
      return (a.metrics.longSpans || 0) - (b.metrics.longSpans || 0);
    }
    if ((a.metrics.deadEnds || 0) !== (b.metrics.deadEnds || 0)) {
      return (a.metrics.deadEnds || 0) - (b.metrics.deadEnds || 0);
    }
    return b.metrics.stalls - a.metrics.stalls;
  });

  if (quick) return raw.slice(0, 6);

  const refined = [];
  raw.slice(0, 3).forEach((r) => {
    refined.push(layoutLoopFirst(input, { ...r.spec, closeLoops: true, loopLoss: 3, goal: "count" }));
  });
  raw.slice(0, 2).forEach((r) => {
    refined.push(layoutLoopFirst(input, { ...r.spec, closeLoops: true, loopLoss: 8, goal: "loop" }));
  });
  return refined.filter(Boolean).concat(raw).filter(Boolean);
}

export function layoutComplex(input, opts = {}) {
  const list = complexCandidates(input, opts);
  if (!list.length) return { best: null, loop: null, list: [] };
  const pass = list.filter((r) => r.metrics?.valid);
  const pool = pass.length ? pass : list;
  const noLong = pool.filter((r) => (r.metrics.longSpans || 0) === 0);
  const rank = noLong.length ? noLong : pool;
  const best = [...rank].sort((a, b) => b.metrics.stalls - a.metrics.stalls || a.metrics.deadEnds - b.metrics.deadEnds)[0];
  const loop = [...rank].sort((a, b) => a.metrics.deadEnds - b.metrics.deadEnds || b.metrics.stalls - a.metrics.stalls)[0];
  return { best, loop, list };
}
