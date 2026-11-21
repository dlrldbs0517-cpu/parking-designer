import { AISLE, RAMP_SLOPE_STRAIGHT, clearHeightOf, rampFootprint, siteMarginsOf, rampMainSlope, rampShape, rampTransitions } from "./layout.js?v=255";

const EDGE = { n: "북", e: "동", s: "남", w: "서" };

// 도로변 3m 완경사를 뺀 본 경사(%)
function slopePercent(ramp, plate) {
  if (!ramp.length) return 0;
  const slope = rampMainSlope(ramp.length, plate ? rampTransitions(plate) : true, (plate && plate.floorHeight) || undefined);
  return Number.isFinite(slope) ? slope * 100 : 999;
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
  const sm = siteMarginsOf(plate);
  const minX = Math.min(0, ...rampBoxes.map((box) => box.x), -(sm.w || 0));
  const minY = Math.min(0, ...rampBoxes.map((box) => box.y));
  const maxX = Math.max(plate.width, ...rampBoxes.map((box) => box.x + box.w));
  const maxY = Math.max(plate.depth, ...rampBoxes.map((box) => box.y + box.d));
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const margin = { l: 110, t: 78, r: 360, b: 170 };
  const drawW = width - margin.l - margin.r;
  const drawH = height - margin.t - margin.b;
  const scale = Math.min(drawW / spanX, drawH / spanY);
  const ox = margin.l + (drawW - spanX * scale) / 2 - minX * scale;
  const oy = margin.t + (drawH - spanY * scale) / 2 + minY * scale;
  const xOf = (x) => ox + x * scale;
  const yOf = (y) => oy + (plate.depth - y) * scale;

  paint.text(margin.l, 48, `${state.demand?.projectName || "주차장"}  지하 ${floorIndex + 1}층 평면도`, 20, "#111");

  const external = state.ramps.some((ramp) => ramp.placement === "external");
  if (external) {
    paint.strokeRect(xOf(-sm.w), yOf(plate.depth + sm.n), (plate.width + sm.w + sm.e) * scale, (plate.depth + sm.s + sm.n) * scale, "#9aa3ad", 1);
  }
  paint.strokeRect(xOf(0), yOf(plate.depth), plate.width * scale, plate.depth * scale, "#111", external ? 1.2 : 2.2, external);

  const xs = state.gridX?.length ? state.gridX : uniqueSorted([0, plate.width]);
  const ys = state.gridY?.length ? state.gridY : uniqueSorted([0, plate.depth]);
  // 기둥선(그리드)은 주차장 밖까지 빼서 치수선·기호를 바깥에 둔다: 외벽 → 치수선(28) → 기호(52)
  xs.forEach((x, index) => {
    paint.line(xOf(x), yOf(plate.depth) - 40, xOf(x), yOf(0) + 8, "#9aa3ad", 0.6);
    paint.text(xOf(x) - 10, yOf(plate.depth) - 46, `X${index + 1}`, 12, "#333");
  });
  ys.forEach((y, index) => {
    paint.line(xOf(0) - 40, yOf(y), xOf(plate.width) + 8, yOf(y), "#9aa3ad", 0.6);
    paint.text(xOf(0) - 66, yOf(y) + 4, `Y${index + 1}`, 12, "#333");
  });

  state.stalls.forEach((stall, index) => {
    paint.strokeRect(xOf(stall.x), yOf(stall.y + stall.d), stall.w * scale, stall.d * scale, "#222", 1);
    // 칸 번호는 빼고 종류만 표시(장애인 '장', 확장형 '확')
    const tag = stall.type === "parallel" ? "평" : stall.type === "disabled" ? "장" : stall.eco ? (stall.type === "extended" ? "확친" : "친") : stall.type === "extended" ? "확" : "";
    if (tag) paint.text(xOf(stall.x + stall.w / 2) - 6, yOf(stall.y + stall.d / 2) + 4, tag, 11, "#222");
  });
  state.columns.forEach((column, index) => {
    const sizeW = column.w || 0.5;
    const sizeD = column.d || sizeW;
    paint.fill(xOf(column.x), yOf(column.y + sizeD), sizeW * scale, sizeD * scale, "#222");
    if (index < 80) paint.text(xOf(column.x) - 4, yOf(column.y) - 4, `C${index + 1}`, 9, "#111");
  });
  (state.cores || (state.core ? [state.core] : [])).forEach((core, index) => {
    paint.strokeRect(xOf(core.x), yOf(core.y + core.d), core.w * scale, core.d * scale, "#111", 2.4);
    paint.line(xOf(core.x + core.w * 0.34), yOf(core.y + core.d), xOf(core.x + core.w * 0.34), yOf(core.y), "#111", 1);
    paint.line(xOf(core.x + core.w * 0.67), yOf(core.y + core.d), xOf(core.x + core.w * 0.67), yOf(core.y), "#111", 1);
    const name = state.cores.length > 1 ? `코어 ${index + 1}` : "코어";
    paint.text(xOf(core.x + core.w / 2) - (name.length > 2 ? 18 : 12), yOf(core.y + core.d / 2), name, 12, "#111");
  });
  for (const ramp of state.ramps) {
    const shape = rampShape(ramp, plate);
    let box = rampFootprint(ramp, plate);
    let percent = slopePercent(ramp, plate);
    let over = percent > RAMP_SLOPE_STRAIGHT * 100 + 0.05;
    if (shape.kind === "curved") {
      // 곡선 램프: 실제 모양을 그리고, 구간 중 가장 급한 경사를 적는다.
      shape.polygons.forEach((poly) => paint.poly(poly.map((p) => [xOf(p.x), yOf(p.y)]), "#111", 1.6));
      box = shape.pieces[0];
      percent = Math.max(...shape.segments.map((seg) => (seg.slope || 0) * 100));
      over = !shape.ok;
    } else {
      paint.strokeRect(xOf(box.x), yOf(box.y + box.d), box.w * scale, box.d * scale, "#111", 1.6);
    }
    const midX = xOf(box.x + box.w / 2);
    const midY = yOf(box.y + box.d / 2);
    paint.text(midX - 28, midY - 8, `${EDGE[ramp.edge]}측 ${shape.kind === "curved" ? "곡선 " : ""}램프`, 12, "#111");
    paint.text(midX - 24, midY + 12, shape.kind === "curved" ? `최대 ${percent.toFixed(1)}%${over ? " 불가" : ""}` : `${percent.toFixed(1)}%${over ? " 초과" : ""}`, 13, over ? "#9a3412" : "#111");
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
  for (const opening of visibleOpenings(state)) {
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
    const color = state.connected ? "#1d4e89" : "#9a3412";
    if (segment.head === false) paint.line(xOf(segment.x1), yOf(segment.y1), xOf(segment.x2), yOf(segment.y2), color, 1.4);
    else paint.arrow(xOf(segment.x1), yOf(segment.y1), xOf(segment.x2), yOf(segment.y2), color);
  });

  dimension(paint, xOf(0), yOf(0) + 28, xOf(plate.width), yOf(0) + 28, `${plate.width.toFixed(1)} m`);
  dimension(paint, xOf(plate.width) + 28, yOf(0), xOf(plate.width) + 28, yOf(plate.depth), `${plate.depth.toFixed(1)} m`);
  // 기둥 간격 치수: 주차장 밖(위쪽·왼쪽)에 한 줄로
  {
    const y = yOf(plate.depth) - 28;
    for (let index = 1; index < xs.length; index += 1) {
      dimension(paint, xOf(xs[index - 1]), y, xOf(xs[index]), y, `${(xs[index] - xs[index - 1]).toFixed(1)}`);
    }
    // 외벽 ~ 첫/마지막 기둥선 (외곽 기둥을 평면 안에 넣어 생긴 0.5m)
    if (xs[0] > 0.05) dimension(paint, xOf(0), y, xOf(xs[0]), y, "");
    if (plate.width - xs[xs.length - 1] > 0.05) dimension(paint, xOf(xs[xs.length - 1]), y, xOf(plate.width), y, "");
    xs.forEach((x) => paint.line(xOf(x) - 3, y + 3, xOf(x) + 3, y - 3, "#333", 1));
    const x = xOf(0) - 28;
    for (let index = 1; index < ys.length; index += 1) {
      const y1 = yOf(ys[index - 1]);
      const y2 = yOf(ys[index]);
      paint.line(x, y1, x, y2, "#333", 1);
      paint.text(x - 26, (y1 + y2) / 2 + 4, `${(ys[index] - ys[index - 1]).toFixed(1)}`, 11, "#111");
    }
    if (ys[0] > 0.05) paint.line(x, yOf(0), x, yOf(ys[0]), "#333", 1);
    if (plate.depth - ys[ys.length - 1] > 0.05) paint.line(x, yOf(ys[ys.length - 1]), x, yOf(plate.depth), "#333", 1);
    ys.forEach((yy) => paint.line(x - 3, yOf(yy) + 3, x + 3, yOf(yy) - 3, "#333", 1));
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
  const boxY = height - 338;
  paint.strokeRect(boxX, boxY, 290, 268, "#111", 1.2);
  const lines = [
    ["도면명", `지하 ${floorIndex + 1}층 주차장 평면도`],
    ["프로젝트", state.demand?.projectName || "주차장"],
    ["법정 대수", `${info.required}대`],
    ["배치 대수", `${info.placed}대`],
    ["지하층", `${info.floors}층`],
    ["층고", plate.floorHeight ? `${plate.floorHeight}m (유효 ${clearHeightOf(plate.floorHeight)}m ≥ ${plate.clearRequired || 2.3}m)` : "—"],
    ["장애인", info.stallTypes ? `${info.stallTypes.disabled}칸 (칸 안 '장')` : "—"],
    ["확장형", info.stallTypes && info.stallTypes.extended ? `${info.stallTypes.extended}칸 2.6×5.2m (칸 안 '확')` : "—"],
    ["친환경차", info.stallTypes && info.stallTypes.eco ? `${info.stallTypes.eco}칸 (칸 안 '친')` : "—"],
    ["평행주차", info.stallTypes && info.stallTypes.parallel ? `${info.stallTypes.parallel}칸 2.0×6.0m (칸 안 '평')` : "—"],
    ["축척", `1:${Math.round((1 / scale) * 1000)}`],
    ["날짜", info.checkedOn || ""],
  ];
  lines.forEach((line, index) => {
    const y = boxY + 24 + index * 22;
    paint.line(boxX, y + 6, boxX + 290, y + 6, "#ddd", 1);
    paint.text(boxX + 10, y, line[0], 12, "#555");
    paint.text(boxX + 78, y, line[1], 13, "#111");
  });
  if (!state.connected) paint.text(margin.l, height - 28, "동선이 끊겨 있어 이 도면은 검토용으로만 표시합니다.", 13, "#9a3412");
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
    poly(points, color, width) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.stroke();
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
    poly(points, color, lineWidth) {
      parts.push(`<polygon points="${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}" fill="none" stroke="${color}" stroke-width="${lineWidth}"/>`);
    },
    line(x1, y1, x2, y2, color, lineWidth) {
      parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${lineWidth}"/>`);
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

export function drawSheet(canvas, state, info, floorIndex) {
  const ctx = canvas.getContext("2d");
  renderSheet(canvasPainter(ctx), state, info, floorIndex);
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

// 내부 램프와 묶인 출입구는 벽에 표시하지 않는다(차는 벽이 아니라 램프로 드나든다).
function visibleOpenings(state) {
  return state.openings.filter((opening) => !(opening.linkedRamp && state.ramps.some((ramp) => ramp.id === opening.linkedRamp && (ramp.placement || "internal") !== "external")));
}
