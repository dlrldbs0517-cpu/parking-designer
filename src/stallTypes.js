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
 *
 * 환경친화적 자동차 전용주차구역 (추가 2026-11-11)
 * - 친환경자동차법 제11조의2, 시행령 제18조의5(대상: 총주차대수 50대 이상인 100세대 이상 아파트·공중이용시설 등),
 *   제18조의6(신축: 총주차대수의 5% 이상 범위에서 시·도 조례). 충전시설도 같은 5%(제18조의7).
 * - 크기 기준이 따로 없어 기존 칸(일반형·확장형)에 표시만 한다(stall.eco = true). 칸 수·확장형 수는 그대로.
 * - 위치: 램프 도착 지점에서 가까운 곳에 한 덩어리로 모은다(소방 진입·충전설비 배선을 한곳에).
 */

export const DISABLED_W = 3.3;
export const EXTENDED_W = 2.6;
export const EXTENDED_RATE = 0.3;
export const ECO_RATE = 0.05;
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
  // ecoMode: auto(대상일 때만) · on(항상) · off. ecoAuto가 없으면(예전 호출) 50대 이상이면 적용.
  const mode = rules.ecoMode || "auto";
  const auto = rules.ecoAuto == null ? legal >= 50 : rules.ecoAuto;
  const rateIn = Number(rules.ecoRate);
  const ecoRate = mode === "off" || rules.eco === false ? 0 : (mode === "on" || auto) ? (Number.isFinite(rateIn) && rateIn > 0 ? rateIn : ECO_RATE) : 0;
  return { disabledRate, extendedRate, ecoRate };
}

/**
 * stalls: 배치 엔진 결과 (type "general", bay/along/bayFrom/bayTo/bayCount 포함)
 * ctx: { plate, columns, blocks, cores, ramp, openings }
 */
export function assignStallTypes(stalls, t, ctx) {
  let list = stalls.map((stall) => ({ ...stall, type: stall.type || "general" }));
  if (t.disabledRate) assignDisabled(list, t, ctx);
  if (t.extendedRate) list = assignExtended(list, t, ctx);
  if (t.ecoRate) {
    assignEco(list, t, ctx);
    // 전기차 칸 중 일반형은 자리가 남으면 확장형으로 넓힌다(충전기·케이블 여유, 한 덩어리 모양 통일).
    const minClear = ctx.plate.minClear || 0;
    list.filter((s) => s.eco && s.type === "general").forEach((stall) => {
      if (list.indexOf(stall) < 0) return;
      if (!widenInPlace(list, stall, ctx, minClear)) widenBySliding(list, stall, ctx, minClear);
    });
  }
  return finish(list, t);
}

function assignEco(list, t, ctx) {
  const need = Math.ceil(list.length * t.ecoRate - 1e-9);
  const pool = list.filter((s) => s.type !== "disabled" && s.type !== "parallel");
  if (!need || !pool.length) return;
  const anchor = ctx.ecoAnchor || (ctx.ramp ? anchorOf(ctx.ramp, ctx.plate) : { x: 0, y: 0 });
  const mid = (s) => ({ x: s.x + s.w / 2, y: s.y + s.d / 2 });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  // 1순위: 같은 줄에서 끊김 없이(장애인 칸·빈자리 없이, 기둥 0.6m 이하 틈만 허용) need칸 이어지는 구간 중 도착 지점에 가장 가까운 것
  const along = (st) => (st.along === "x" ? st.x : st.y);
  const len = (st) => (st.along === "x" ? st.w : st.d);
  const lineKey = (st) => `${st.along}|${st.along === "x" ? st.y.toFixed(1) : st.x.toFixed(1)}|${st.aisle}`;
  const lines = new Map();
  list.forEach((st) => { const k = lineKey(st); if (!lines.has(k)) lines.set(k, []); lines.get(k).push(st); });
  let best = null;
  const windows = [];
  for (const line of lines.values()) {
    line.sort((a, b) => along(a) - along(b));
    let run = [];
    const flush = () => {
      for (let i = 0; i + need <= run.length; i += 1) {
        const win = run.slice(i, i + need);
        const d = Math.min(...win.map((st) => dist(mid(st), anchor)));
        const avg = win.reduce((sum, st) => sum + dist(mid(st), anchor), 0) / win.length;
        windows.push({ d, avg, win, generals: win.filter((st) => st.type === "general").length });
      }
      run = [];
    };
    line.forEach((st) => {
      const prev = run[run.length - 1];
      if (st.type === "disabled" || st.type === "parallel") { flush(); return; }
      if (prev && along(st) - (along(prev) + len(prev)) > 0.6) flush();
      run.push(st);
    });
    flush();
  }
  // 가장 가까운 구간에서 칸 두 개 거리(5.5m) 안이면, 이미 확장형인 칸이 많은 구간을 고른다(전기차 칸을 모두 확장형으로).
  if (windows.length) {
    const nearest = Math.min(...windows.map((w) => w.d));
    // 가장 가까운 칸이 같으면(같은 줄에서 한 칸씩 밀린 구간) 칸들 평균 거리가 짧은 쪽 — 도착 지점 쪽 끝부터 [친 친 친 확 확]
    best = windows.filter((w) => w.d <= nearest + 5.5)
      .sort((a, b) => a.generals - b.generals || (Math.abs(a.d - b.d) > 0.01 ? a.d - b.d : a.avg - b.avg))[0];
  }
  if (best) {
    best.win.forEach((st) => { list[list.indexOf(st)] = { ...st, eco: true }; });
    return;
  }
  // 2순위(긴 구간이 없을 때): 도착 지점에서 가장 가까운 칸 중, 같은 줄에 need칸이 있는 곳을 우선
  const rowKey = (s) => `${s.along}|${s.along === "x" ? s.y.toFixed(1) : s.x.toFixed(1)}|${s.aisle}`;
  const rows = new Map();
  pool.forEach((s) => { const k = rowKey(s); if (!rows.has(k)) rows.set(k, []); rows.get(k).push(s); });
  const seeds = [...pool].sort((a, b) => dist(mid(a), anchor) - dist(mid(b), anchor));
  const longRow = seeds.find((s) => rows.get(rowKey(s)).length >= need) || seeds[0];
  const seed = longRow;
  const row = rows.get(rowKey(seed));
  // 같은 줄을 먼저, 다음으로 가까운 칸
  const ordered = [...pool].sort((a, b) => {
    const ra = row.includes(a) ? 0 : 1;
    const rb = row.includes(b) ? 0 : 1;
    return ra - rb || dist(mid(a), mid(seed)) - dist(mid(b), mid(seed));
  });
  ordered.slice(0, need).forEach((s) => { list[list.indexOf(s)] = { ...s, eco: true }; });
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
  const need = () => Math.ceil(list.filter((s) => s.type !== "parallel").length * t.extendedRate - 1e-9) - countType(list, "extended");
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
    // 넓힐 후보 칸: 기둥 베이는 양 끝(기둥 옆). 빈자리 채우기 구간은 안에 기둥이 없으니, 기둥선(그리드)에
    // 걸치거나 1.3m 안에 있는 칸 — 기둥선 양옆이 [확|확]으로 짝지어지도록(실제 도면처럼 기둥 옆 칸을 넓힘).
    const sortedBay = [...bay].sort((a, b) => (a.along === "x" ? a.x - b.x : a.y - b.y));
    let order = endsFirst(types.length).slice(0, types.length >= 2 ? 2 : 1);
    if (bay[0].phase === "fill") {
      // 빈자리 채우기 구간: 확장형을 흩뿌리지 않고 한 덩어리로 붙인다.
      // 같은 줄의 다른 구간과 맞닿는 쪽부터 채워, 두 구간의 확장형이 경계에서 이어지게 한다. 없으면 아래(좌)쪽부터.
      const alongX = bay[0].along === "x";
      const perp = (s) => (alongX ? s.y : s.x);
      const line = properBays().filter((b) => b !== bay && b[0].phase === "fill" && b[0].along === bay[0].along
        && Math.abs(perp(b[0]) - perp(bay[0])) < 0.05);
      const below = line.some((b) => Math.abs(b[0].bayTo - bay[0].bayFrom) < 1.5);
      const above = line.some((b) => Math.abs(b[0].bayFrom - bay[0].bayTo) < 1.5);
      const idx = sortedBay.map((_, i) => i);
      order = above && !below ? idx.reverse() : idx;
    }
    const planFor = (k) => {
      const plan = [...types];
      let left = k;
      order.forEach((i) => { if (left > 0 && plan[i] === "general") { plan[i] = "extended"; left -= 1; } });
      return plan;
    };
    let done = false;
    // 넓히는 칸은 양 끝(기둥 옆)만: 3칸이면 [확 일 확]이 최대. 가운데까지 넓혀 [확 확 확]이 되면 패턴이 깨진다.
    const ends = order.filter((i) => types[i] === "general").length;   // 아직 일반형인 후보 칸 수
    if (!ends) continue;
    for (let k = Math.min(ends, k0 + 1); k >= Math.max(1, Math.min(k0, ends)); k -= 1) {
      if (repack(list, bay, planFor(k), ctx, minClear)) { done = true; break; }
    }
    if (!done && k0 >= 1) {
      // 베이가 일부만 차 있으면(램프·코어에 걸려 빠진 칸) 다시 나누기 대신 제자리에서 넓힌다.
      bay.filter((s) => s.type === "general").slice(0, Math.min(k0, ends)).forEach((s) => widenInPlace(list, s, ctx, minClear));
    }
  }
  // 1-1차: 기둥 베이에 확장형이 한쪽 끝에 하나뿐이면, 옆 줄의 확장형과 맞닿는 쪽 끝으로 옮긴다(덩어리로 붙게).
  //  예) 위쪽 빈자리 구간 [… 확 확] | 베이 [일 일 확] → [확 일 일]
  for (const bay of properBays()) {
    if (bay[0].phase === "fill" || bay.length < 2) continue;
    const sorted = [...bay].sort((a, b) => (a.along === "x" ? a.x - b.x : a.y - b.y));
    const types = sorted.map((st) => st.type);
    const ext = types.filter((type) => type === "extended").length;
    if (ext !== 1 || types.includes("disabled")) continue;
    const at = types.indexOf("extended");
    if (at !== 0 && at !== types.length - 1) continue;
    const alongX = bay[0].along === "x";
    const lo = (st) => (alongX ? st.x : st.y);
    const hi = (st) => lo(st) + (alongX ? st.w : st.d);
    const sameRow = (o) => !bay.includes(o) && o.along === bay[0].along && Math.abs((alongX ? o.y : o.x) - (alongX ? bay[0].y : bay[0].x)) < 0.05;
    const extAt = (pos, side) => list.some((o) => sameRow(o) && o.type === "extended"
      && (side < 0 ? Math.abs(hi(o) - pos) < 1.2 : Math.abs(lo(o) - pos) < 1.2));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const touchLow = extAt(lo(first), -1);
    const touchHigh = extAt(hi(last), 1);
    const flip = (at === 0 && touchHigh && !touchLow) || (at === types.length - 1 && touchLow && !touchHigh);
    if (flip) repack(list, bay, [...types].reverse(), ctx, minClear);
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

// 제자리에서 못 넓히면, 같은 줄에 붙어 있는 칸들을 한쪽 끝으로 0.1m 밀어 자리를 만든다.
// 예) [친 확친 확친 확 확]에서 '친' 위가 차로라 막히면 아래 칸들을 0.1m씩 내려 '확친'으로.
function widenBySliding(list, stall, ctx, minClear) {
  const extra = EXTENDED_W - GENERAL_W;
  const alongX = stall.along ? stall.along === "x" : stall.w <= stall.d;
  const pos = (s) => (alongX ? s.x : s.y);
  const size = (s) => (alongX ? s.w : s.d);
  const perp = (s) => (alongX ? s.y : s.x);
  const line = list.filter((s) => s.aisle === stall.aisle && Math.abs(perp(s) - perp(stall)) < 0.02 && Math.abs((alongX ? s.d : s.w) - (alongX ? stall.d : stall.w)) < 0.02)
    .sort((a, b) => pos(a) - pos(b));
  const at = line.indexOf(stall);
  if (at < 0) return false;
  // 붙어 있는 칸만 (틈 0.02m 이하)
  let lo = at;
  while (lo > 0 && Math.abs(pos(line[lo - 1]) + size(line[lo - 1]) - pos(line[lo])) < 0.02) lo -= 1;
  let hi = at;
  while (hi < line.length - 1 && Math.abs(pos(line[hi]) + size(line[hi]) - pos(line[hi + 1])) < 0.02) hi += 1;
  const move = (s, d) => (alongX ? { ...s, x: r3(s.x + d) } : { ...s, y: r3(s.y + d) });
  const grow = (s, d) => (alongX ? { ...s, x: r3(s.x + d), w: EXTENDED_W, type: "extended" } : { ...s, y: r3(s.y + d), d: EXTENDED_W, type: "extended" });
  for (const dir of [-1, 1]) {
    const members = dir < 0 ? line.slice(lo, at) : line.slice(at + 1, hi + 1);
    const moved = members.map((s) => move(s, dir * extra));
    const widened = grow(stall, dir < 0 ? -extra : 0);
    const run = line.slice(lo, hi + 1);
    const others = list.filter((s) => !run.includes(s));
    if (![widened, ...moved].every((r) => fits(r, others, ctx, minClear))) continue;
    members.forEach((s, i) => { list[list.indexOf(s)] = moved[i]; });
    list[list.indexOf(stall)] = widened;
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
    // 같은 bay 이름이 여러 줄·구간에 겹칠 수 있어(빈자리 채우기) 구간 시작점·줄 위치까지 묶음 기준으로
    const key = `${stall.bay}|${stall.bayFrom}|${stall.along === "x" ? stall.y : stall.x}`;
    if (!bays.has(key)) bays.set(key, []);
    bays.get(key).push(stall);
  });
  // 순서(2026-11-21): ① 코어 출입문까지 가는 직선이 차로를 건너지 않는 묶음 먼저
  // ② 칸 앞에서 코어 출입문까지 실제로 걸어가는 거리(차로를 따라, 기둥·코어는 돌아서)가 짧은 순서
  const cores = ctx.cores || [];
  const walk = cores.length ? walkField(ctx) : null;
  const doorOf = (items) => {
    const p = bayCenter(items);
    const doors = cores.map(doorPoint);
    return doors.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
  };
  const crossing = (items) => (cores.length ? crossesAisleTo(items, doorOf(items), ctx.aisles || []) : false);
  const walkOf = (stall) => (walk ? walk(entryOf(stall)) : Infinity);
  const bayWalk = (items) => {
    const w = Math.min(...items.map(walkOf));
    if (Number.isFinite(w)) return w;
    const d = doorOf(items);
    const p = bayCenter(items);
    return 1000 + Math.hypot(d.x - p.x, d.y - p.y);   // 걸어서 못 가는 묶음은 뒤로
  };
  const fullBays = [...bays.values()]
    .filter((items) => items.length === items[0].bayCount)
    .map((items) => ({ items, key: (crossing(items) ? 1e6 : 0) + (cores.length ? bayWalk(items) : distance(items, anchors)) }))
    .sort((a, b) => a.key - b.key)
    .map((b) => b.items);

  for (const bay of fullBays) {
    const need = Math.ceil(list.length * t.disabledRate - 1e-9) - countType(list, "disabled");
    if (need <= 0) break;
    const usable = bay[0].bayTo - bay[0].bayFrom - 2 * minClear;
    const k = Math.min(need, Math.floor((usable + 1e-9) / DISABLED_W));
    if (k < 1) continue;
    const rest = Math.floor((usable - k * DISABLED_W + 1e-9) / GENERAL_W);
    // 묶음 안에서도 출입문까지 걸어서 가까운 쪽 끝에 장애인 칸이 오게
    let plan = Array(k).fill("disabled").concat(Array(rest).fill("general"));
    if (cores.length && doorAtEnd(bay, walkOf, cores)) plan = plan.reverse();
    repack(list, bay, plan, ctx, minClear);
  }
}

// 코어 출입문 위치: 출입문 면(doorFace: n=위(y 큰 쪽), s, e, w) 가운데. 면이 없으면 코어 가운데.
export function doorPoint(core) {
  const f = core.doorFace;
  if (f === "n") return { x: core.x + core.w / 2, y: core.y + core.d };
  if (f === "s") return { x: core.x + core.w / 2, y: core.y };
  if (f === "e") return { x: core.x + core.w, y: core.y + core.d / 2 };
  if (f === "w") return { x: core.x, y: core.y + core.d / 2 };
  return { x: core.x + core.w / 2, y: core.y + core.d / 2 };
}

// 칸에서 내려 걷기 시작하는 점: 칸 앞(차로 쪽) 가운데에서 0.6m 차로 안
export function entryOf(stall) {
  const a = stall.aisle;
  if (a === "n") return { x: stall.x + stall.w / 2, y: stall.y + stall.d + 0.6 };
  if (a === "s") return { x: stall.x + stall.w / 2, y: stall.y - 0.6 };
  if (a === "e") return { x: stall.x + stall.w + 0.6, y: stall.y + stall.d / 2 };
  if (a === "w") return { x: stall.x - 0.6, y: stall.y + stall.d / 2 };
  return { x: stall.x + stall.w / 2, y: stall.y + stall.d / 2 };
}

// 걷는 거리 지도: 0.5m 칸 격자, 차로 위만 걸을 수 있고 기둥·코어는 피한다. 출발점 = 모든 코어 출입문 앞.
// 돌려주는 함수: 점 → 가장 가까운 출입문까지 걷는 거리(m). 차로에서 2m 넘게 떨어진 점은 Infinity.
export function walkField(ctx) {
  const plate = ctx.plate;
  const h = 0.5;
  const nx = Math.max(1, Math.ceil(plate.width / h));
  const ny = Math.max(1, Math.ceil(plate.depth / h));
  const N = nx * ny;
  const ok = new Uint8Array(N);
  const inside = (r, x, y, pad = 0) => x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.d + pad;
  const aisles = ctx.aisles || [];
  const solids = (ctx.columns || []).map((c) => ({ ...c, pad: 0.1 })).concat((ctx.cores || []).map((c) => ({ ...c, pad: 0 })));
  // 사각형마다 덮는 칸만 칠함(칸 전체 × 사각형 전체를 다 보던 것보다 훨씬 빠름, 결과는 같음)
  const paint = (r, pad, val) => {
    const i0 = Math.max(0, Math.floor((r.x - pad) / h - 0.5) - 1);
    const i1 = Math.min(nx - 1, Math.ceil((r.x + r.w + pad) / h - 0.5) + 1);
    const j0 = Math.max(0, Math.floor((r.y - pad) / h - 0.5) - 1);
    const j1 = Math.min(ny - 1, Math.ceil((r.y + r.d + pad) / h - 0.5) + 1);
    for (let j = j0; j <= j1; j += 1) {
      const y = (j + 0.5) * h;
      for (let i = i0; i <= i1; i += 1) {
        if (inside(r, (i + 0.5) * h, y, pad)) ok[j * nx + i] = val;
      }
    }
  };
  aisles.forEach((a) => paint(a, 0, 1));
  solids.forEach((r) => paint(r, r.pad, 0));
  const cellOf = (p) => ({ i: Math.min(nx - 1, Math.max(0, Math.floor(p.x / h))), j: Math.min(ny - 1, Math.max(0, Math.floor(p.y / h))) });
  // 점에서 가장 가까운 걸을 수 있는 칸(반경 r m 안)
  const nearest = (p, r) => {
    const c = cellOf(p);
    const k = Math.ceil(r / h);
    let best = null;
    for (let dj = -k; dj <= k; dj += 1) {
      for (let di = -k; di <= k; di += 1) {
        const i = c.i + di;
        const j = c.j + dj;
        if (i < 0 || j < 0 || i >= nx || j >= ny || !ok[j * nx + i]) continue;
        const d = Math.hypot((i + 0.5) * h - p.x, (j + 0.5) * h - p.y);
        if (d <= r && (!best || d < best.d)) best = { idx: j * nx + i, d };
      }
    }
    return best;
  };
  const dist = new Float64Array(N).fill(Infinity);
  const heap = [];
  const push = (idx, d) => {
    heap.push([d, idx]);
    let k = heap.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1; const r = l + 1; let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
      }
    }
    return top;
  };
  (ctx.cores || []).forEach((core) => {
    const door = doorPoint(core);
    const start = nearest(door, 3);
    if (start && start.d < dist[start.idx]) { dist[start.idx] = start.d; push(start.idx, start.d); }
  });
  const steps = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.length) {
    const [d, idx] = pop();
    if (d > dist[idx]) continue;
    const i = idx % nx;
    const j = (idx - i) / nx;
    for (const [di, dj, c] of steps) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const n = b * nx + a;
      if (!ok[n]) continue;
      if (di && dj && (!ok[j * nx + a] || !ok[b * nx + i])) continue;   // 모서리 끼어 지나가기 금지
      const nd = d + c * h;
      if (nd < dist[n]) { dist[n] = nd; push(n, nd); }
    }
  }
  return (p) => {
    const c = nearest(p, 2);
    return c ? dist[c.idx] + c.d : Infinity;
  };
}

// 묶음의 뒤쪽 끝(bayTo 쪽) 칸이 앞쪽 끝 칸보다 출입문까지 걸어서 가까우면 true
function doorAtEnd(bay, walkOf, cores) {
  const along = bay[0].along === "x" ? "x" : "y";
  const sorted = bay.slice().sort((a, b) => a[along] - b[along]);
  const a = walkOf(sorted[0]);
  const b = walkOf(sorted[sorted.length - 1]);
  if (Number.isFinite(a) || Number.isFinite(b)) return b < a;
  return coreAtEnd(bay, cores);
}

// 칸 묶음 가운데 → 코어 출입문까지 직선이 차로(가장자리 0.3m 안쪽)를 지나면 '차로를 건넌다'
function crossesAisleTo(items, door, aisles) {
  const p = bayCenter(items);
  const q = door;
  const len = Math.hypot(q.x - p.x, q.y - p.y);
  const steps = Math.max(1, Math.ceil(len / 0.5));
  for (let i = 1; i < steps; i += 1) {
    const x = p.x + ((q.x - p.x) * i) / steps;
    const y = p.y + ((q.y - p.y) * i) / steps;
    if (Math.hypot(q.x - x, q.y - y) < 2.5) continue;   // 출입문 앞 2.5m(문 앞 차로 가장자리)는 건너는 것으로 보지 않음
    if (aisles.some((a) => x > a.x + 0.3 && x < a.x + a.w - 0.3 && y > a.y + 0.3 && y < a.y + a.d - 0.3)) return true;
  }
  return false;
}

export function tallyStallTypes(list, t) {
  return finish(list, t);
}

function finish(list, t) {
  const total = list.length;
  // 확장형 30%는 평행주차형식 외의 칸 기준(평행 칸은 크기 기준이 달라 넓힐 대상이 아님)
  const perpendicular = list.filter((s) => s.type !== "parallel").length;
  const targets = {
    disabled: t.disabledRate ? Math.ceil(total * t.disabledRate - 1e-9) : 0,
    rate: t.disabledRate,
    extended: t.extendedRate ? Math.ceil(perpendicular * t.extendedRate - 1e-9) : 0,
    extendedRate: t.extendedRate || 0,
    eco: t.ecoRate ? Math.ceil(total * t.ecoRate - 1e-9) : 0,
    ecoRate: t.ecoRate || 0,
  };
  const counts = { total, general: countType(list, "general"), disabled: countType(list, "disabled"), extended: countType(list, "extended"), parallel: countType(list, "parallel"), eco: list.filter((s) => s.eco).length };
  const shortages = [];
  if (counts.disabled < targets.disabled) shortages.push(`장애인전용 부족 ${counts.disabled}/${targets.disabled}칸`);
  if (counts.extended < targets.extended) shortages.push(`확장형 부족 ${counts.extended}/${targets.extended}칸 (30% 이상)`);
  if (counts.eco < targets.eco) shortages.push(`친환경차 부족 ${counts.eco}/${targets.eco}칸`);
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

function bayCenter(items) {
  const c = items.reduce((acc, s) => ({ x: acc.x + s.x + s.w / 2, y: acc.y + s.y + s.d / 2 }), { x: 0, y: 0 });
  return { x: c.x / items.length, y: c.y / items.length };
}

function nearestOnRect(p, r) {
  return { x: Math.max(r.x, Math.min(r.x + r.w, p.x)), y: Math.max(r.y, Math.min(r.y + r.d, p.y)) };
}

function nearestCore(p, cores) {
  return cores.map((c) => ({ c, q: nearestOnRect(p, c) })).sort((a, b) => Math.hypot(a.q.x - p.x, a.q.y - p.y) - Math.hypot(b.q.x - p.x, b.q.y - p.y))[0];
}

function distanceToRects(items, cores) {
  const p = bayCenter(items);
  const { q } = nearestCore(p, cores);
  return Math.hypot(q.x - p.x, q.y - p.y);
}

// 칸 묶음 가운데 → 가장 가까운 코어 벽까지 직선이 차로(가장자리 0.3m 안쪽)를 지나면 '차로를 건넌다'
function crossesAisle(items, cores, aisles) {
  const p = bayCenter(items);
  const { q } = nearestCore(p, cores);
  const len = Math.hypot(q.x - p.x, q.y - p.y);
  const steps = Math.max(1, Math.ceil(len / 0.5));
  for (let i = 1; i < steps; i += 1) {
    const x = p.x + ((q.x - p.x) * i) / steps;
    const y = p.y + ((q.y - p.y) * i) / steps;
    if (aisles.some((a) => x > a.x + 0.3 && x < a.x + a.w - 0.3 && y > a.y + 0.3 && y < a.y + a.d - 0.3)) return true;
  }
  return false;
}

// 코어가 묶음의 bayTo 쪽(뒤쪽 끝)에 있으면 true
function coreAtEnd(bay, cores) {
  const first = bay[0];
  const p = bayCenter(bay);
  const { c } = nearestCore(p, cores);
  const mid = (first.bayFrom + first.bayTo) / 2;
  const cc = first.along === "x" ? c.x + c.w / 2 : c.y + c.d / 2;
  return cc > mid;
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
