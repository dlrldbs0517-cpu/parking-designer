// 장애인전용·확장형·친환경차 구획 배정 (업로드에 원본이 없어 API 맞춤 최소 구현).
// 전체 베이 재분할 로직은 원본 stallTypes.js가 필요합니다.

const STALL_W = 2.5;
const DISABLED_W = 3.3;

function ceilRate(total, rate) {
  if (!rate || total <= 0) return 0;
  return Math.max(1, Math.ceil(total * rate));
}

/**
 * 조건(stallRules) → 목표 칸 수.
 * placedStalls(한 층 배치 수)가 있으면 그걸 분모로 비율을 잡는다.
 * (법정 대수 300 × 30% = 90을 층당 75칸과 비교하던 "75/300" 오류 방지)
 * placed가 없을 때만 legalStalls로 추정한다.
 */
export function stallRuleTargets(rules = {}) {
  rules = rules || {};
  const legalDeclared = Math.max(0, Number(rules.legalStalls) || 0);
  const placed = Math.max(0, Number(rules.placedStalls) || 0);
  const base = placed > 0 ? placed : legalDeclared;
  // 적용 여부(50대 이상 등)는 층당이 아니라 전체 규모로 판단 — 층당 42대·법정 112대면 확장형·전기차 대상
  const scale = Math.max(base, legalDeclared);
  const disabledOn = rules.disabled !== false && scale >= 10;
  const disabledRate = disabledOn ? Math.min(0.04, Math.max(0.02, Number(rules.disabledRate) || 0.02)) : 0;
  const disabled = disabledOn ? ceilRate(base, disabledRate) : 0;

  const extendedRate = scale >= 50 ? 0.3 : 0;
  const extended = extendedRate ? Math.ceil(base * extendedRate) : 0;

  let ecoRate = 0;
  if (rules.ecoMode === "on") ecoRate = Math.min(0.2, Math.max(0.01, Number(rules.ecoRate) || 0.05));
  else if (rules.ecoMode === "off") ecoRate = 0;
  else if (rules.ecoAuto || (rules.ecoMode === "auto" && scale >= 50)) {
    ecoRate = Math.min(0.2, Math.max(0.01, Number(rules.ecoRate) || 0.05));
  }
  const eco = ecoRate && scale >= 50 ? ceilRate(base, ecoRate) : 0;

  return {
    disabled,
    extended,
    eco,
    disabledRate,
    extendedRate,
    ecoRate,
    legalStalls: legalDeclared || base,
    baseStalls: base,
  };
}

function emptyCounts() {
  return { general: 0, disabled: 0, extended: 0, eco: 0, parallel: 0, total: 0 };
}

/** 칸 목록을 세어 목표와 비교 */
export function tallyStallTypes(stalls = [], targets = stallRuleTargets()) {
  const counts = emptyCounts();
  for (const stall of stalls) {
    const type = stall.type || (stall.parallel ? "parallel" : "general");
    if (counts[type] == null) counts[type] = 0;
    counts[type] += 1;
    counts.total += 1;
  }
  const shortages = [];
  const need = (have, want, label) => {
    if (want > have) shortages.push(`${label} ${have}/${want}`);
  };
  need(counts.disabled || 0, targets.disabled || 0, "장애인전용");
  need(counts.extended || 0, targets.extended || 0, "확장형");
  need(counts.eco || 0, targets.eco || 0, "친환경차");
  return { counts, targets, shortages };
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** 동 코어(kind !== "stair")만. 없으면 전체 코어. */
function buildingCoreEntries(cores = [], blockRects = []) {
  const building = cores
    .map((c, index) => ({ core: c, index }))
    .filter((e) => (e.core.kind || "building") !== "stair");
  const use = building.length ? building : cores.map((c, index) => ({ core: c, index }));
  return use.map((e) => {
    const block = e.core.buildingId != null
      ? blockRects.find((b) => b.buildingId === e.core.buildingId)
      : null;
    // 장애인 칸은 코어 «출입문»에서 가까워야 함 → 문이 있으면 문 가운데를 기준점으로
    const door = !block && e.core.interior && e.core.interior.door;
    if (door && Number.isFinite(door.x)) {
      return { index: e.index, x: door.x + door.w / 2, y: door.y + door.d / 2 };
    }
    const anchor = block || e.core;
    return {
      index: e.index,
      x: anchor.x + anchor.w / 2,
      y: anchor.y + anchor.d / 2,
    };
  });
}

/**
 * 일반형으로 채워진 칸에 유형을 붙인다.
 * 동 코어가 2개 이상이고 장애인 목표가 동 수 이상이면 먼저 동마다 1대씩 배분.
 */
export function assignStallTypes(stalls = [], typeRules = stallRuleTargets(), opts = {}) {
  const targets = typeRules || stallRuleTargets();
  const list = stalls.map((s) => ({ ...s, type: s.type || (s.parallel ? "parallel" : "general") }));
  const anchors = buildingCoreEntries(opts.cores || [], (opts.plate && opts.plate.blockRects) || opts.blockRects || []);
  const scored = list
    .map((stall, index) => {
      const sx = stall.x + stall.w / 2;
      const sy = stall.y + stall.d / 2;
      let near = index;
      let nearCore = 0;
      if (anchors.length) {
        let best = Infinity;
        anchors.forEach((a) => {
          const d = dist2(sx, sy, a.x, a.y);
          if (d < best) {
            best = d;
            near = d;
            nearCore = a.index;
          }
        });
      }
      return { index, near, nearCore, stall };
    })
    .sort((a, b) => a.near - b.near);

  let disabledLeft = targets.disabled || 0;
  let ecoLeft = targets.eco || 0;
  let extendedLeft = targets.extended || 0;
  const used = new Set();

  const markDisabled = (item, { skipReach = false } = {}) => {
    const stall = list[item.index];
    if (stall.parallel || stall.type === "parallel") return false;
    if (!skipReach && opts.reach && !opts.reach(stall)) return false;
    if (stall.w + 0.01 < STALL_W) return false;
    stall.type = "disabled";
    // 폭을 3.3m로 키우면 옆 칸·기둥과 겹칠 수 있어, 여유가 있을 때만 넓힌다.
    if (stall.w + 0.01 >= DISABLED_W) stall.w = Math.max(stall.w, DISABLED_W);
    stall.nearCore = item.nearCore;
    used.add(item.index);
    return true;
  };

  // 동별 최소 1대(목표 ≥ 동 코어 수일 때): 각 동 코어에 가장 가까운 후보부터.
  // 동 아래 막기로 차로가 잘린 뒤 reach가 엄격하면 동별 1대가 빠질 수 있어, 1차 배분은 reach를 건너뛴다.
  const blocks = (opts.plate && opts.plate.blockRects) || opts.blockRects || [];
  const overlapsBlock = (stall) => blocks.some((b) => {
    const ox = Math.min(stall.x + stall.w, b.x + b.w) - Math.max(stall.x, b.x);
    const oy = Math.min(stall.y + stall.d, b.y + b.d) - Math.max(stall.y, b.y);
    return ox > 0.05 && oy > 0.05;
  });
  if (anchors.length >= 2 && disabledLeft >= anchors.length) {
    for (const anchor of anchors) {
      if (disabledLeft <= 0) break;
      const ranked = scored
        .filter((item) => !used.has(item.index) && !overlapsBlock(list[item.index]))
        .map((item) => {
          const stall = list[item.index];
          const sx = stall.x + stall.w / 2;
          const sy = stall.y + stall.d / 2;
          return { item, dist: dist2(sx, sy, anchor.x, anchor.y) };
        })
        .sort((a, b) => a.dist - b.dist);
      for (const { item } of ranked) {
        if (markDisabled({ ...item, nearCore: anchor.index }, { skipReach: true })) {
          disabledLeft -= 1;
          break;
        }
      }
    }
  }

  const eligible = (item) => {
    if (used.has(item.index)) return false;
    const stall = list[item.index];
    if (stall.parallel || stall.type === "parallel") return false;
    if (opts.reach && !opts.reach(stall)) return false;
    return true;
  };
  // 1) 장애인: 코어 출입문에서 가까운 순
  for (const item of scored) {
    if (disabledLeft <= 0) break;
    if (!eligible(item)) continue;
    const stall = list[item.index];
    if (stall.w + 0.01 < STALL_W) continue;
    stall.type = "disabled";
    if (stall.w + 0.01 >= DISABLED_W) stall.w = Math.max(stall.w, DISABLED_W);
    stall.nearCore = item.nearCore;
    used.add(item.index);
    disabledLeft -= 1;
  }
  // 2) 친환경차(전기차 충전): 한 구역에 몰아서 — 램프 도착점(없으면 코어)에 가장 가까운 칸을 시작으로,
  //    같은 줄(같은 방향) 옆 칸부터 붙여 나간다(충전기 배선·구획 표시가 한곳에 모이도록).
  if (ecoLeft > 0) {
    const pool = scored.filter(eligible);
    const ctr = (it) => { const st = list[it.index]; return { x: st.x + st.w / 2, y: st.y + st.d / 2, rowX: st.d > st.w }; };
    const gap = (a, b) => {   // 칸 사이 거리: 같은 방향이면 그대로, 다르면 조금 멀게
      const p = ctr(a); const q = ctr(b);
      return Math.hypot(p.x - q.x, p.y - q.y) + (p.rowX === q.rowX ? 0 : 3);
    };
    const clusterFrom = (seed) => pool
      .map((it) => ({ it, d: it === seed ? 0 : gap(seed, it) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, ecoLeft);
    // 시작 후보: 램프 도착점(opts.ecoAnchor)이 있으면 거기서, 없으면 코어에서 가까운 칸 몇 개 →
    // 그중 주변 칸이 가장 빽빽하게 모이는(이웃 거리 합이 작은) 칸으로
    const A = opts.ecoAnchor;
    const near = A && Number.isFinite(A.x)
      ? pool.slice().sort((a, b) => { const pa = ctr(a); const pb = ctr(b); return dist2(pa.x, pa.y, A.x, A.y) - dist2(pb.x, pb.y, A.x, A.y); })
      : pool.slice();
    let best = null;
    near.slice(0, 10).forEach((seed, rank) => {
      const cl = clusterFrom(seed);
      const spread = cl.reduce((sum, c) => sum + c.d, 0) + rank * 0.5;
      if (!best || spread < best.spread) best = { cl, spread };
    });
    if (best) {
      for (const { it } of best.cl) {
        if (ecoLeft <= 0) break;
        list[it.index].type = "eco";
        used.add(it.index);
        ecoLeft -= 1;
      }
    }
  }
  // 3) 확장형: 남은 칸 중 코어 가까운 순
  for (const item of scored) {
    if (!eligible(item)) continue;
    const stall = list[item.index];
    if (extendedLeft > 0) {
      stall.type = "extended";
      // 확장형도 겹침을 만들지 않도록 이미 2.6 이상일 때만 표시용으로 유지
      if (stall.w + 0.01 >= 2.6) stall.w = Math.max(stall.w, 2.6);
      extendedLeft -= 1;
    }
  }

  const tally = tallyStallTypes(list, targets);
  return { stalls: list, counts: tally.counts, targets: tally.targets, shortages: tally.shortages };
}
