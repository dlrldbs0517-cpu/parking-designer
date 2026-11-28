import { chargerRect } from "./stallMarks.js?v=362";
import {
  AISLE, FLOOR_H, RAMP_SLOPE_STRAIGHT, coreInterior, coreInteriorOf, pickCoreDoorSide,
  rampFootprint, siteMarginsOf, stairCoreInterior,
} from "./layout.js?v=362";
import { buildChain, slopePlan } from "./rampModules.js?v=362";
import { polygonFromPlate } from "./polygon.js?v=362";

const EDGE = { n: "북", e: "동", s: "남", w: "서" };

function slopePercent(ramp) {
  if (!ramp.length) return 0;
  return (FLOOR_H / ramp.length) * 100;
}

function moduleSlopeLabel(ramp, plate) {
  if (!ramp?.modules?.length) return null;
  const legal = Number(plate?.legalStalls) || Number(plate?.stallRules?.legalStalls) || 0;
  const plan = slopePlan(ramp, { floorHeight: FLOOR_H, legalStalls: legal });
  const parts = plan.chain.modules.map((m, i) => {
    const pm = plan.perModule[i];
    const pct = pm ? `${(pm.slope * 100).toFixed(1)}%` : "";
    if (m.type === "straight") return `직선 ${m.length.toFixed(1)}m ${pct}`;
    return `90° ${m.dir === "L" ? "좌" : "우"} R${m.radius} ${pct}`;
  });
  const trans = plan.levels[0]?.trans;
  const ease = trans ? ` (완화 ${trans.top || 0}m/${trans.bottom || 0}m)` : "";
  return parts.join(" · ") + ease;
}

function uniqueSorted(values) {
  return [...new Set(values.map((value) => Math.round(value * 10) / 10))].sort((a, b) => a - b);
}

export function renderSheet(paint, state, info, floorIndex) {
  const plate = state.plate;
  const width = 1580;
  const height = 1040;
  paint.size(width, height);
  paint.fill(0, 0, width, height, "#ffffff");
  paint.strokeRect(18, 18, width - 36, height - 36, "#111", 1.5);
  if (!plate) {
    paint.text(80, 80, "평면을 먼저 확정하세요.", 22, "#111");
    return;
  }

  const rampBoxes = state.ramps.map((ramp) => rampFootprint(ramp, plate));
  const siteM = siteMarginsOf({
    ...plate,
    siteMargin: plate.siteMargin != null ? plate.siteMargin : state.siteMargin,
    siteMargins: plate.siteMargins || state.siteMargins,
  });
  const minX = Math.min(0, ...rampBoxes.map((box) => box.x), -siteM.w);
  const minY = Math.min(0, ...rampBoxes.map((box) => box.y), -siteM.s);
  const maxX = Math.max(plate.width, ...rampBoxes.map((box) => box.x + box.w), plate.width + siteM.e);
  const maxY = Math.max(plate.depth, ...rampBoxes.map((box) => box.y + box.d), plate.depth + siteM.n);
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const margin = { l: 110, t: 120, r: 150, b: 175 };   // 제목란은 아래쪽 여백(b)에 들어가므로 좌우를 비슷하게 → 가운데 정렬
  const drawW = width - margin.l - margin.r;
  const drawH = height - margin.t - margin.b;
  const scale = Math.min(drawW / spanX, drawH / spanY);
  const ox = margin.l + (drawW - spanX * scale) / 2 - minX * scale;
  // 위쪽(가장 북쪽 maxY)이 그림 칸 위 여백에 오도록 — 예전엔 minY를 더해 대지 이격만큼 위로 치우쳤음
  const oy = margin.t + (drawH - spanY * scale) / 2 + (maxY - plate.depth) * scale;
  const xOf = (x) => ox + x * scale;
  const yOf = (y) => oy + (plate.depth - y) * scale;

  paint.text(margin.l, 48, `${state.demand?.projectName || "주차장"}  지하 ${floorIndex + 1}층 평면도`, 20, "#111");

  // 대지 이격 점선 (방향별)
  if (siteM.n > 0 || siteM.s > 0 || siteM.e > 0 || siteM.w > 0) {
    paint.strokeRect(
      xOf(-siteM.w),
      yOf(plate.depth + siteM.n),
      (plate.width + siteM.w + siteM.e) * scale,
      (plate.depth + siteM.n + siteM.s) * scale,
      "#64748b",
      1.2,
      true,
    );
    paint.text(xOf(plate.width / 2) - 28, yOf(-siteM.s / 2) + 4, `이격 남 ${siteM.s}m`, 11, "#475569");
    paint.text(xOf(plate.width / 2) - 28, yOf(plate.depth + siteM.n / 2) + 4, `이격 북 ${siteM.n}m`, 11, "#475569");
  }
  {
    const poly = polygonFromPlate(plate);
    // sheet yOf flips Y — stroke polygon manually
    const pts = poly.map((p) => ({ x: xOf(p.x), y: yOf(p.y) }));
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      paint.line(a.x, a.y, b.x, b.y, "#111", 2.2);
    }
  }

  const xs = state.gridX?.length ? state.gridX : uniqueSorted([0, plate.width]);
  const ys = state.gridY?.length ? state.gridY : uniqueSorted([0, plate.depth]);
  // 기둥 중심선(그리드): 1점쇄선 + 끝에 원 안 번호(도면 표기)
  const GRID_DASH = [14, 3, 2, 3];
  const GRID_C = "#8a94a0";
  const BR = 11;   // 번호 원 반지름(px)
  const ext = 26;  // 평면 밖으로 내미는 길이
  xs.forEach((x, index) => {
    const px = xOf(x);
    paint.dashLine(px, yOf(plate.depth) - ext, px, yOf(0) + 10, GRID_C, 0.7, GRID_DASH);
    paint.bubble(px, yOf(plate.depth) - ext - BR, BR, `X${index + 1}`, 10, "#333");
  });
  ys.forEach((y, index) => {
    const py = yOf(y);
    paint.dashLine(xOf(0) - ext, py, xOf(plate.width) + 10, py, GRID_C, 0.7, GRID_DASH);
    paint.bubble(xOf(0) - ext - BR, py, BR, `Y${index + 1}`, 10, "#333");
  });

  state.stalls.forEach((stall, index) => {
    const type = stall.parallel || stall.type === "parallel" ? "parallel" : (stall.type || "general");
    const fill = type === "disabled" ? "rgba(59,130,246,0.28)"
      : type === "extended" ? "rgba(134,239,172,0.35)"
        : type === "eco" ? "rgba(234,179,8,0.32)"
          : type === "parallel" ? "rgba(148,163,184,0.3)"
            : "rgba(247,244,238,0.9)";
    paint.fill(xOf(stall.x), yOf(stall.y + stall.d), stall.w * scale, stall.d * scale, fill);
    paint.strokeRect(xOf(stall.x), yOf(stall.y + stall.d), stall.w * scale, stall.d * scale, type === "extended" ? "#15803d" : "#222", type === "extended" ? 2.4 : 1);
    paint.text(xOf(stall.x + stall.w / 2) - 8, yOf(stall.y + stall.d / 2) + 4, String(index + 1), 11, "#222");
    if (type === "eco") { const r = chargerRect(stall); paint.fill(xOf(r.x), yOf(r.y + r.d), r.w * scale, r.d * scale, "#111"); }
  });
  state.columns.forEach((column, index) => {
    const sizeW = column.w || 0.5;
    const sizeD = column.d || sizeW;
    paint.fill(xOf(column.x), yOf(column.y + sizeD), sizeW * scale, sizeD * scale, "#222");
    if (index < 80) paint.text(xOf(column.x) - 4, yOf(column.y) - 4, `C${index + 1}`, 9, "#111");
  });
  let stairNo = 0;
  (state.cores || (state.core ? [state.core] : [])).forEach((core, index) => {
    const building = core.buildingId != null
      ? (state.buildings || []).find((b) => b.id === core.buildingId)
      : null;
    if (building && building.tower) {
      const tw = building.tower;
      const tx = core.x + (tw.dx || 0);
      const ty = core.y + (tw.dy || 0);
      const clip = clipRect({ x: tx, y: ty, w: tw.w, d: tw.d }, plate);
      if (clip) {
        if (building.blockUnder) {
          hatchOnPaint(paint, xOf, yOf, scale, clip);
        }
        paint.strokeRect(xOf(clip.x), yOf(clip.y + clip.d), clip.w * scale, clip.d * scale, "#555", 1, true);
      }
    }
    paint.strokeRect(xOf(core.x), yOf(core.y + core.d), core.w * scale, core.d * scale, "#111", 2.4);
    const interior = coreInteriorOf(core, state.aisles, state.plate?.blockRects);
    if (interior) {
      (interior.elevators || []).forEach((el) => {
        paint.strokeRect(xOf(el.x), yOf(el.y + el.d), el.w * scale, el.d * scale, "#111", 1.2);
        paint.text(xOf(el.x + el.w / 2) - 8, yOf(el.y + el.d / 2), el.label || "EL", 9, "#111");
      });
      if (interior.stair) {
        const st = interior.stair;
        paint.strokeRect(xOf(st.x), yOf(st.y + st.d), st.w * scale, st.d * scale, "#333", 1.2);
        paint.text(xOf(st.x + st.w / 2) - 10, yOf(st.y + st.d / 2), "계단", 9, "#333");
      }
      if (interior.door) {
        const d = interior.door;
        paint.line(
          xOf(d.x), yOf(d.y + d.d / 2),
          xOf(d.x + d.w), yOf(d.y + d.d / 2),
          "#0f766e", 2.2,
        );
      }
    } else {
      paint.line(xOf(core.x + core.w * 0.34), yOf(core.y + core.d), xOf(core.x + core.w * 0.34), yOf(core.y), "#111", 1);
      paint.line(xOf(core.x + core.w * 0.67), yOf(core.y + core.d), xOf(core.x + core.w * 0.67), yOf(core.y), "#111", 1);
    }
    let name = `코어 ${index + 1}`;
    if (core.kind === "stair") {
      stairNo += 1;
      name = `계단 ${stairNo}`;
    } else if (building) {
      name = `${building.name} 코어`;
    }
    paint.text(xOf(core.x + core.w / 2) - 22, yOf(core.y + core.d / 2), name, 12, "#111");
  });
  for (const ramp of state.ramps) {
    if (ramp.modules?.length) {
      const chain = buildChain(ramp);
      chain.modules.forEach((m) => {
        (m.rects || []).forEach((r) => {
          paint.strokeRect(xOf(r.x), yOf(r.y + r.d), r.w * scale, r.d * scale, "#111", 1.4);
        });
      });
      const label = moduleSlopeLabel(ramp, plate) || "";
      const mid = chain.modules[0]?.start || { x: ramp.x, y: ramp.y };
      paint.text(xOf(mid.x) - 40, yOf(mid.y) - 8, "모듈 램프", 11, "#111");
      paint.text(xOf(mid.x) - 80, yOf(mid.y) + 10, label.slice(0, 56), 10, "#111");
      if (label.length > 56) paint.text(xOf(mid.x) - 80, yOf(mid.y) + 24, label.slice(56, 112), 10, "#111");
      continue;
    }
    const box = rampFootprint(ramp, plate);
    paint.strokeRect(xOf(box.x), yOf(box.y + box.d), box.w * scale, box.d * scale, "#111", 1.6);
    const percent = slopePercent(ramp);
    const over = percent > RAMP_SLOPE_STRAIGHT * 100 + 0.05;
    const midX = xOf(box.x + box.w / 2);
    const midY = yOf(box.y + box.d / 2);
    paint.text(midX - 28, midY - 8, `${EDGE[ramp.edge]}측 램프`, 12, "#111");
    paint.text(midX - 24, midY + 12, `${percent.toFixed(1)}%${over ? " 초과" : ""}`, 13, over ? "#9a3412" : "#111");
    const inward = ramp.edge === "s" || ramp.edge === "w" ? -1 : 1;
    const vertical = ramp.edge === "n" || ramp.edge === "s";
    paint.arrow(
      vertical ? midX : midX - inward * 18,
      vertical ? midY + inward * 18 : midY,
      vertical ? midX : midX + inward * 18,
      vertical ? midY - inward * 18 : midY,
      "#111",
    );
  }
  for (const opening of state.openings) {
    const at = Number.isFinite(opening.t) ? opening.t : opening.at;
    if (!Number.isFinite(at)) continue;
    const label = opening.kind === "out" ? "출구" : opening.kind === "in" ? "입구" : (opening.label || "출입구");
    const along = opening.edge === "n" || opening.edge === "s" ? xOf(at) : yOf(at);
    const side = opening.edge === "n" ? yOf(plate.depth) : opening.edge === "s" ? yOf(0) : opening.edge === "w" ? xOf(0) : xOf(plate.width);
    paint.text(opening.edge === "w" || opening.edge === "e" ? side - 18 : along - 16, opening.edge === "n" || opening.edge === "s" ? side + (opening.edge === "s" ? 18 : -8) : along, label, 13, "#111");
  }

  const drives = state.drives?.length ? state.drives : (state.route || []).slice(1).map((point, index) => ({
    x1: state.route[index].x,
    y1: state.route[index].y,
    x2: point.x,
    y2: point.y,
  }));
  drives.forEach((segment) => {
    paint.arrow(xOf(segment.x1), yOf(segment.y1), xOf(segment.x2), yOf(segment.y2), state.connected ? "#1d4e89" : "#9a3412");
  });

  dimension(paint, xOf(0), yOf(0) + 28, xOf(plate.width), yOf(0) + 28, `${plate.width.toFixed(1)} m`);
  dimension(paint, xOf(plate.width) + 28, yOf(0), xOf(plate.width) + 28, yOf(plate.depth), `${plate.depth.toFixed(1)} m`);
  // 기둥 간격 치수: 평면 밖, X1·X2… 번호 원 위쪽에 한 줄로(눈금 + 가운데 숫자)
  {
    const yDim = yOf(plate.depth) - 26 - 22 - 16;   // 그리드 연장(26) + 번호 원 지름(22) + 여유
    if (xs.length >= 2) {
      paint.line(xOf(xs[0]), yDim, xOf(xs[xs.length - 1]), yDim, "#333", 0.9);
      xs.forEach((x) => paint.line(xOf(x) - 4, yDim + 4, xOf(x) + 4, yDim - 4, "#333", 1.1));   // 치수 눈금(사선)
      for (let index = 1; index < xs.length; index += 1) {
        const span = xs[index] - xs[index - 1];
        const label = span.toFixed(1);
        const mid = (xOf(xs[index - 1]) + xOf(xs[index])) / 2;
        paint.text(mid - label.length * 3.4, yDim - 5, label, 12, "#111");
      }
    }
  }

  paint.line(width - 300, 70, width - 300, 118, "#111", 1.4);
  paint.line(width - 300, 70, width - 292, 86, "#111", 1.4);
  paint.line(width - 300, 70, width - 308, 86, "#111", 1.4);
  paint.text(width - 292, 78, "N", 14, "#111");

  const bar = 10 * scale;
  paint.line(margin.l, height - 70, margin.l + bar, height - 70, "#111", 3);
  paint.text(margin.l, height - 52, "0        10 m", 12, "#111");
  const metersPerPx = 1 / scale;
  paint.text(margin.l + 90, height - 52, `축척 1:${Math.round(metersPerPx * 1000)}`, 12, "#111");

  const boxX = width - 330;
  const buildingRows = (state.buildings || []).map((b) => {
    const core = (state.cores || []).find((c) => c.buildingId === b.id && (c.kind || "building") !== "stair");
    if (!core) return null;
    const cx = core.x + core.w / 2;
    const cy = core.y + core.d / 2;
    const near30 = state.stalls.filter((s) => Math.hypot(s.x + s.w / 2 - cx, s.y + s.d / 2 - cy) <= 30).length;
    const disabled = state.stalls.filter((s) => s.type === "disabled");
    let dist = "—";
    if (disabled.length) {
      const best = Math.min(...disabled.map((s) => Math.hypot(s.x + s.w / 2 - cx, s.y + s.d / 2 - cy)));
      dist = `${best.toFixed(1)}m`;
    }
    return [b.name, `${b.floors}F`, `${core.w.toFixed(1)}×${core.d.toFixed(1)}`, `${near30}`, dist];
  }).filter(Boolean);
  const boxH = 180 + (buildingRows.length ? 28 + buildingRows.length * 18 : 0);
  const boxY = height - (boxH + 70);
  paint.strokeRect(boxX, boxY, 290, boxH, "#111", 1.2);
  const lines = [
    ["도면명", `지하 ${floorIndex + 1}층 주차장 평면도`],
    ["프로젝트", state.demand?.projectName || "주차장"],
    ["법정 대수", `${info.required}대`],
    ["배치 대수", `${info.placed}대`],
    ["지하층", `${info.floors}층`],
    ["축척", `1:${Math.round((1 / scale) * 1000)}`],
    ["날짜", info.checkedOn || ""],
  ];
  lines.forEach((line, index) => {
    const y = boxY + 24 + index * 22;
    paint.line(boxX, y + 6, boxX + 290, y + 6, "#ddd", 1);
    paint.text(boxX + 10, y, line[0], 12, "#555");
    paint.text(boxX + 78, y, line[1], 13, "#111");
  });
  if (buildingRows.length) {
    let y = boxY + 24 + lines.length * 22 + 8;
    paint.text(boxX + 10, y, "동별 (직선거리 기준)", 12, "#555");
    y += 16;
    paint.text(boxX + 10, y, "동", 11, "#777");
    paint.text(boxX + 55, y, "층", 11, "#777");
    paint.text(boxX + 90, y, "코어", 11, "#777");
    paint.text(boxX + 160, y, "30m칸", 11, "#777");
    paint.text(boxX + 215, y, "장애인", 11, "#777");
    buildingRows.forEach((row) => {
      y += 18;
      paint.text(boxX + 10, y, row[0], 11, "#111");
      paint.text(boxX + 55, y, row[1], 11, "#111");
      paint.text(boxX + 90, y, row[2], 11, "#111");
      paint.text(boxX + 160, y, row[3], 11, "#111");
      paint.text(boxX + 215, y, row[4], 11, "#111");
    });
    const stairs = (state.cores || []).filter((c) => c.kind === "stair").length;
    if (stairs) paint.text(boxX + 10, y + 18, `계단 코어 ${stairs}개`, 11, "#555");
  }
  if (!state.connected) paint.text(margin.l, height - 28, "동선이 끊겨 있어 이 도면은 검토용으로만 표시합니다.", 13, "#9a3412");
}

function clipRect(rect, plate) {
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(plate.width, rect.x + rect.w);
  const y1 = Math.min(plate.depth, rect.y + rect.d);
  if (x1 - x0 < 0.05 || y1 - y0 < 0.05) return null;
  return { x: x0, y: y0, w: x1 - x0, d: y1 - y0 };
}

function hatchOnPaint(paint, xOf, yOf, _scale, rect) {
  const step = 1.4;
  for (let t = -rect.d; t < rect.w + rect.d; t += step) {
    const clipped = clipLineToRect(rect.x + t, rect.y, rect.x + t + rect.d, rect.y + rect.d, rect);
    if (!clipped) continue;
    paint.line(xOf(clipped.x1), yOf(clipped.y1), xOf(clipped.x2), yOf(clipped.y2), "#999", 0.7);
  }
}

function clipLineToRect(x1, y1, x2, y2, r) {
  // Liang-Barsky 간단 클립
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (!clip(-dx, x1 - r.x) || !clip(dx, r.x + r.w - x1) || !clip(-dy, y1 - r.y) || !clip(dy, r.y + r.d - y1)) return null;
  return {
    x1: x1 + t0 * dx,
    y1: y1 + t0 * dy,
    x2: x1 + t1 * dx,
    y2: y1 + t1 * dy,
  };
}

function dimension(paint, x1, y1, x2, y2, label) {
  paint.line(x1, y1, x2, y2, "#333", 1);
  paint.text((x1 + x2) / 2 - 18, (y1 + y2) / 2 - 6, label, 12, "#111");
}

function canvasPainter(ctx) {
  return {
    size(w, h) {
      ctx.canvas.width = w;
      ctx.canvas.height = h;
    },
    fill(x, y, w, h, color) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
    },
    strokeRect(x, y, w, h, color, width, dashed) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      if (dashed) ctx.setLineDash([6, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    },
    dashLine(x1, y1, x2, y2, color, width, pattern) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(pattern || [6, 4]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
    },
    bubble(cx, cy, r, label, size, color) {
      ctx.save();
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = `${size}px "Malgun Gothic", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, cx, cy + 0.5);
      ctx.restore();
    },
    line(x1, y1, x2, y2, color, width) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    },
    text(x, y, value, size, color) {
      ctx.fillStyle = color;
      ctx.font = `${size}px "Malgun Gothic", sans-serif`;
      ctx.fillText(value, x, y);
    },
    arrow(x1, y1, x2, y2, color) {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      const angle = Math.atan2(y2 - y1, x2 - x1);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - 10 * Math.cos(angle - 0.4), y2 - 10 * Math.sin(angle - 0.4));
      ctx.lineTo(x2 - 10 * Math.cos(angle + 0.4), y2 - 10 * Math.sin(angle + 0.4));
      ctx.fill();
    },
  };
}

function svgPainter() {
  const parts = [];
  let width = 1580;
  let height = 1040;
  return {
    size(w, h) {
      width = w;
      height = h;
    },
    fill(x, y, w, h, color) {
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}"/>`);
    },
    strokeRect(x, y, w, h, color, lineWidth, dashed) {
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="${lineWidth}"${dashed ? ' stroke-dasharray="6 4"' : ""}/>`);
    },
    line(x1, y1, x2, y2, color, lineWidth) {
      parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${lineWidth}"/>`);
    },
    dashLine(x1, y1, x2, y2, color, lineWidth, pattern) {
      parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${lineWidth}" stroke-dasharray="${(pattern || [6, 4]).join(" ")}"/>`);
    },
    bubble(cx, cy, r, label, size, color) {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" stroke="${color}" stroke-width="0.9"/>`);
      parts.push(`<text x="${cx}" y="${cy}" font-size="${size}" fill="${color}" font-family="Malgun Gothic, sans-serif" text-anchor="middle" dominant-baseline="central">${label}</text>`);
    },
    text(x, y, value, size, color) {
      const safe = String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;");
      parts.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-family="Malgun Gothic, sans-serif">${safe}</text>`);
    },
    arrow(x1, y1, x2, y2, color) {
      parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.4" marker-end="url(#arrow)"/>`);
    },
    markup() {
      return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#1d4e89"/></marker></defs>
${parts.join("\n")}
</svg>`;
    },
  };
}

/** 뷰포트 안에 A3 비율로 맞춰 표시 크기만 조정(비트맵은 1580×1040 유지). */
export function fitSheetCanvas(canvas) {
  if (!canvas) return;
  const parent = canvas.parentElement;
  if (!parent) return;
  const pad = 24;
  const availW = Math.max(80, parent.clientWidth - pad);
  const availH = Math.max(80, parent.clientHeight - pad);
  const scale = Math.min(availW / 1580, availH / 1040, 1);
  const w = Math.max(1, Math.round(1580 * scale));
  const h = Math.max(1, Math.round(1040 * scale));
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.style.maxWidth = "100%";
  canvas.style.maxHeight = "100%";
}

export function drawSheet(canvas, state, info, floorIndex) {
  const ctx = canvas.getContext("2d");
  renderSheet(canvasPainter(ctx), state, info, floorIndex);
  fitSheetCanvas(canvas);
}

export function sheetSvg(state, info, floorIndex) {
  const paint = svgPainter();
  renderSheet(paint, state, info, floorIndex);
  return paint.markup();
}

export function downloadBlob(filename, blob) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function printSheet(canvas) {
  const popup = window.open("", "sheet-print");
  if (!popup) return;
  popup.document.write(`<!DOCTYPE html><title>평면도</title>
<style>@page{size:A3 landscape;margin:8mm} body{margin:0} img{width:100%;height:auto}</style>
<img src="${canvas.toDataURL("image/png")}" onload="print();">`);
  popup.document.close();
}
