/**
 * 장애인전용 주차구획 배정
 *
 * 근거 (확인 2026-11-10)
 * - 장애인전용 3.3×5.0m 이상
 * - 부설주차장 주차대수 10대 이상 → 2~4% 범위에서 지자체 조례로 정한 비율 이상
 *   (주차장법 시행령 별표1 비고, 장애인등편의법 시행령 별표2)
 *
 * 방법
 * 1. 배치 엔진이 일반형(2.5m)으로 채운 기둥 구간(베이)을 단위로 다시 나눈다.
 * 2. 코어(엘리베이터)에서 가까운 베이부터 3.3m 칸으로 바꾸고, 남는 폭은 일반형으로 채운다.
 * 3. 다른 차로·기둥·코어와 부딪히면 그 베이는 바꾸지 않는다.
 * 비율은 이 층의 배치 대수 기준으로 계산한다(모든 층이 같은 평면이므로 전체 비율도 같다).
 *
 * 확장형 주차구획 (추가 2026-11-11)
 * - 확장형 2.6×5.2m 이상 (주차장법 시행규칙 제3조①2)
 * - 주차대수 50대 이상 부설주차장 → 확장형을 총수의 30% 이상 (제11조④ → 제6조①14 준용)
 * - 깊이 5.2m는 배치 엔진이 줄 깊이를 5.2m로 짜서 맞춘다(layout.js STALL_D).
 * - 1차: 칸 수를 줄이지 않고 베이 안 여유 폭으로 2.5m 칸을 2.6m로 넓힌다.
 * - 2차: 그래도 모자라면 베이를 전부 확장형으로 다시 나눈다(대수가 줄 수 있음). 법 기준이 대수보다 먼저다.
 */

export const DISABLED_W = 3.3;
export const EXTENDED_W = 2.6;
export const EXTENDED_RATE = 0.3;
const GENERAL_W = 2.5;
const WIDTH = { general: GENERAL_W, disabled: DISABLED_W, extended: EXTENDED_W };

/** 화면 설정 → 이번 배치에 적용할 비율. 적용 대상이 아니면 0. */
export function stallRuleTargets(rules) {
  rules = rules || {};
  const legal = Number(rules.legalStalls) || 0;
  const on = rules.disabled !== false;
  const rate = Number(rules.disabledRate);
  const disabledRate = on && legal >= 10 ? Math.max(0.02, Math.min(0.04, Number.isFinite(rate) && rate > 0 ? rate : 0.03)) : 0;
  const extendedRate = legal >= 50 ? EXTENDED_RATE : 0;
  return { disabledRate, extendedRate };
}

/**
 * stalls: 배치 엔진 결과 (type "general", bay/along/bayFrom/bayTo/bayCount 포함)
 * ctx: { plate, columns, blocks, cores, ramp, openings }
 */
export function assignStallTypes(stalls, t, ctx) {
  let list = stalls.map((stall) => ({ ...stall, type: stall.type || "general" }));
  if (t.disabledRate) assignDisabled(list, t, ctx);
  if (t.extendedRate) list = assignExtended(list, t, ctx);
  return finish(list, t);
}

function bayGroups(list) {
  const bays = new Map();
  list.forEach((stall) => {
    if (!stall.bay) return;
    // 빈자리 채우기 줄은 한 줄(bay 이름 같음)에 빈 구간이 여러 개일 수 있어 구간 시작점까지 묶음 기준으로 쓴다.
    const key = stall.phase === "fill" ? `${stall.bay}|${stall.bayFrom}` : stall.bay;
    if (!bays.has(key)) bays.set(key, []);
    bays.get(key).push(stall);
  });
  return [...bays.values()];
}

function assignExtended(list, t, ctx) {
  const minClear = ctx.plate.minClear || 0;
  const need = () => Math.ceil(list.length * t.extendedRate - 1e-9) - countType(list, "extended");
  // 기둥 사이 베이로 놓인 칸만 다룬다(빈자리 채우기 줄은 베이 정보가 베이와 다르다).
  // 기둥 베이와 빈자리 채우기 구간 모두(구간마다 칸 수 이하로 놓인 것만)
  const properBays = () => bayGroups(list).filter((items) => items.length <= (items[0].bayCount || 0));
  const usableOf = (bay) => bay[0].bayTo - bay[0].bayFrom - 2 * minClear;
  // 1차: 칸 수 그대로, 베이 안 남는 폭으로 일반형을 2.6m로 넓힌다(장애인 칸이 있는 베이도 포함).
  // 보기 좋게 규칙적으로: 30%를 채웠어도 여유 있는 베이는 모두 같은 패턴으로 넓히고,
  // 넓히는 칸은 기둥에 붙은 칸(베이 양 끝)부터 고른다. 기둥 옆은 문 열기 불편한 자리라 넓히는 의미도 있다.
  // 두 번 돈다: 앞 베이가 옆 구간(빈자리 채우기 줄)과 겹쳐 실패했다가, 그 구간이 다시 놓인 뒤엔 들어갈 수 있다.
  for (let round = 0; round < 2; round += 1) for (const bay of properBays()) {
    const types = [...bay].sort((a, b) => (a.along === "x" ? a.x - b.x : a.y - b.y)).map((s) => s.type);
    const used = types.reduce((sum, type) => sum + WIDTH[type], 0);
    const generals = types.filter((type) => type === "general").length;
    // 베이 폭 계산상 여유(기둥 면 기준)로 들어가는 수 k0. 실제로는 벽 쪽 줄처럼 기둥이 줄 밖에 있으면 더 들어갈 수 있어
    // 일반형 수까지 늘려 가며 실제로 놓아 본다(기둥·다른 칸과 안 겹치면 OK). 예) 외벽 줄 [확 일 확].
    const k0 = Math.max(0, Math.min(generals, Math.floor((usableOf(bay) - used + 1e-6) / (EXTENDED_W - GENERAL_W) + 1e-6)));
    const order = endsFirst(types.length).slice(0, types.length >= 2 ? 2 : 1);   // 양 끝 칸만 후보
    const planFor = (k) => {
      const plan = [...types];
      let left = k;
      order.forEach((i) => { if (left > 0 && plan[i] === "general") { plan[i] = "extended"; left -= 1; } });
      return plan;
    };
    let done = false;
    // 넓히는 칸은 양 끝(기둥 옆)만: 3칸이면 [확 일 확]이 최대. 가운데까지 넓혀 [확 확 확]이 되면 패턴이 깨진다.
    const ends = order.filter((i) => types[i] === "general").length;   // 아직 일반형인 끝 칸 수
    if (!ends) continue;
    for (let k = Math.min(ends, k0 + 1); k >= Math.max(1, Math.min(k0, ends)); k -= 1) {
      if (repack(list, bay, planFor(k), ctx, minClear)) { done = true; break; }
    }
    if (!done && k0 >= 1) {
      // 베이가 일부만 차 있으면(램프·코어에 걸려 빠진 칸) 다시 나누기 대신 제자리에서 넓힌다.
      bay.filter((s) => s.type === "general").slice(0, Math.min(k0, ends)).forEach((s) => widenInPlace(list, s, ctx, minClear));
    }
  }
  // 1-2차: 남은 일반형 칸을 제자리에서 0.1m 넓혀 본다(한쪽이 비어 있으면). 칸 수는 그대로.
  for (const stall of list.filter((s) => s.type === "general")) {
    if (need() <= 0) break;
    widenInPlace(list, stall, ctx, minClear);
  }
  // 2차: 그래도 모자라면 일반형만 있는 베이를 전부 확장형으로 다시 나눈다(잃는 칸이 적은 베이부터).
  let guard = 0;
  while (need() > 0 && guard < 200) {
    guard += 1;
    const options = properBays()
      .filter((bay) => bay.some((s) => s.type === "general") && bay.every((s) => s.type !== "disabled"))
      .map((bay) => {
        const m = Math.floor((usableOf(bay) + 1e-6) / EXTENDED_W);
        const gain = m - countType(bay, "extended");
        return { bay, m, loss: bay.length - m, gain };
      })
      .filter((o) => o.m >= 1 && o.gain > 0)
      .sort((a, b) => a.loss - b.loss || b.gain - a.gain);
    let done = false;
    for (const o of options) {
      if (repack(list, o.bay, Array(o.m).fill("extended"), ctx, minClear)) { done = true; break; }
    }
    if (!done) break;
  }
  return list;
}

// 베이 안 칸 순서: 양 끝(기둥 옆) → 안쪽. 예) 3칸: 0, 2, 1
function endsFirst(n) {
  const out = [];
  for (let lo = 0, hi = n - 1; lo <= hi; lo += 1, hi -= 1) {
    out.push(lo);
    if (hi !== lo) out.push(hi);
  }
  return out;
}

function widenInPlace(list, stall, ctx, minClear) {
  const extra = EXTENDED_W - GENERAL_W;
  const alongX = stall.along ? stall.along === "x" : stall.w <= stall.d;
  for (const shift of [0, -extra, -extra / 2]) {
    const rect = alongX
      ? { ...stall, x: r3(stall.x + shift), w: EXTENDED_W, type: "extended" }
      : { ...stall, y: r3(stall.y + shift), d: EXTENDED_W, type: "extended" };
    if (!fits(rect, list.filter((s) => s !== stall), ctx, minClear)) continue;
    list[list.indexOf(stall)] = rect;
    return true;
  }
  return false;
}

function fits(rect, others, ctx, minClear) {
  return inside(rect, ctx.plate)
    && !(ctx.blocks || []).some((block) => overlapArea(rect, block) > 0.03)
    && !(ctx.columns || []).some((column) => tooClose(rect, column, minClear))
    && !others.some((other) => overlapArea(rect, other) > 0.03)
    && (!ctx.reach || ctx.reach(rect));
}

function assignDisabled(list, t, ctx) {

  const minClear = ctx.plate.minClear || 0;
  const coreAnchors = (ctx.cores || []).map(centerOf);
  const entryAnchors = [ctx.ramp, ...(ctx.openings || [])].filter(Boolean).map((item) => anchorOf(item, ctx.plate));
  const anchors = coreAnchors.length ? coreAnchors : entryAnchors;

  // 베이(기둥 사이 구간) 단위로 묶는다. 칸이 빠지지 않은 온전한 베이만 다시 나눈다.
  const bays = new Map();
  list.forEach((stall) => {
    if (!stall.bay) return;
    if (!bays.has(stall.bay)) bays.set(stall.bay, []);
    bays.get(stall.bay).push(stall);
  });
  const fullBays = [...bays.values()]
    .filter((items) => items.length === items[0].bayCount)
    .sort((a, b) => distance(a, anchors) - distance(b, anchors));

  for (const bay of fullBays) {
    const need = Math.ceil(list.length * t.disabledRate - 1e-9) - countType(list, "disabled");
    if (need <= 0) break;
    const usable = bay[0].bayTo - bay[0].bayFrom - 2 * minClear;
    const k = Math.min(need, Math.floor((usable + 1e-9) / DISABLED_W));
    if (k < 1) continue;
    const rest = Math.floor((usable - k * DISABLED_W + 1e-9) / GENERAL_W);
    repack(list, bay, Array(k).fill("disabled").concat(Array(rest).fill("general")), ctx, minClear);
  }
}

function finish(list, t) {
  const total = list.length;
  const targets = {
    disabled: t.disabledRate ? Math.ceil(total * t.disabledRate - 1e-9) : 0,
    rate: t.disabledRate,
    extended: t.extendedRate ? Math.ceil(total * t.extendedRate - 1e-9) : 0,
    extendedRate: t.extendedRate || 0,
  };
  const counts = { total, general: countType(list, "general"), disabled: countType(list, "disabled"), extended: countType(list, "extended") };
  const shortages = [];
  if (counts.disabled < targets.disabled) shortages.push(`장애인전용 부족 ${counts.disabled}/${targets.disabled}칸`);
  if (counts.extended < targets.extended) shortages.push(`확장형 부족 ${counts.extended}/${targets.extended}칸 (30% 이상)`);
  return { stalls: list, counts, targets, shortages };
}

function countType(list, type) {
  return list.filter((s) => s.type === type).length;
}

/** 베이 안 칸들을 plan(유형 목록) 순서대로 다시 나눈다. 다른 것과 부딪히면 바꾸지 않는다. */
function repack(list, bay, plan, ctx, minClear) {
  const first = bay[0];
  const span = first.bayTo - first.bayFrom;
  const total = plan.reduce((sum, type) => sum + WIDTH[type], 0);
  const others = list.filter((s) => !bay.includes(s));
  // 같은 줄 바로 옆(1m 안)에 칸이 있으면 그 칸에 딱 붙여 본다(사이에 짜투리 틈이 안 생기게).
  // 그다음 가운데 정렬, 안 되면 한쪽 끝에 붙여 본다(구간보다 길게 넓힐 때 옆 칸과 0.05m 겹치는 경우 등).
  const alongX = first.along === "x";
  const sameRow = others.filter((o) => (alongX
    ? Math.abs(o.y - first.y) < 0.05 && Math.abs(o.d - first.d) < 0.05
    : Math.abs(o.x - first.x) < 0.05 && Math.abs(o.w - first.w) < 0.05));
  const startOf = (o) => (alongX ? o.x : o.y);
  const endOf = (o) => (alongX ? o.x + o.w : o.y + o.d);
  const touch = [];
  const after = sameRow.filter((o) => startOf(o) >= first.bayTo - 1 && startOf(o) <= first.bayTo + 1).sort((p, q) => startOf(p) - startOf(q))[0];
  if (after) touch.push(startOf(after) - total - first.bayFrom);
  const before = sameRow.filter((o) => endOf(o) >= first.bayFrom - 1 && endOf(o) <= first.bayFrom + 1).sort((p, q) => endOf(q) - endOf(p))[0];
  if (before) touch.push(endOf(before) - first.bayFrom);
  const offsets = touch.filter((off) => off >= -0.2 && off + total <= span + 0.2).concat([(span - total) / 2, 0, span - total]);
  let fresh = null;
  for (const off of offsets) {
    let pos = first.bayFrom + off;
    const trial = plan.map((type) => {
      const w = WIDTH[type];
      const rect = first.along === "x"
        ? { ...first, x: r3(pos), w, type }
        : { ...first, y: r3(pos), d: w, type };
      pos += w;
      return rect;
    });
    const ok = trial.every((rect) =>
      inside(rect, ctx.plate)
      && !(ctx.blocks || []).some((block) => overlapArea(rect, block) > 0.03)
      && !(ctx.columns || []).some((column) => tooClose(rect, column, minClear))
      && !others.some((other) => overlapArea(rect, other) > 0.03)
      && (!ctx.reach || ctx.reach(rect)));
    if (ok) { fresh = trial; break; }
  }
  if (!fresh) return false;
  const at = list.indexOf(first);
  for (let i = list.length - 1; i >= 0; i -= 1) if (bay.includes(list[i])) list.splice(i, 1);
  list.splice(at, 0, ...fresh);
  return true;
}

function inside(r, plate) {
  return r.x >= -1e-6 && r.y >= -1e-6 && r.x + r.w <= plate.width + 1e-6 && r.y + r.d <= plate.depth + 1e-6;
}

function centerOf(r) {
  return { x: r.x + r.w / 2, y: r.y + r.d / 2 };
}

function anchorOf(item, plate) {
  const t = Number(item.t) || 0;
  if (item.edge === "s") return { x: t, y: 0 };
  if (item.edge === "n") return { x: t, y: plate.depth };
  if (item.edge === "e") return { x: plate.width, y: t };
  return { x: 0, y: t };
}

function distance(items, anchors) {
  if (!anchors.length) return 0;
  const c = items.reduce((acc, s) => ({ x: acc.x + s.x + s.w / 2, y: acc.y + s.y + s.d / 2 }), { x: 0, y: 0 });
  const p = { x: c.x / items.length, y: c.y / items.length };
  return Math.min(...anchors.map((a) => Math.hypot(a.x - p.x, a.y - p.y)));
}

function overlapArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const d = Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y);
  return w > 0 && d > 0 ? w * d : 0;
}

function tooClose(a, b, minClear) {
  if (overlapArea(a, b) > 1e-8) return true;
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.d, b.y + b.d));
  return Math.hypot(dx, dy) < minClear - 1e-4;
}

function r3(v) {
  return Math.round(v * 1000) / 1000;
}
