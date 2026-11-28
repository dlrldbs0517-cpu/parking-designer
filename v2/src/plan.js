import { chargerRect, boltPoints } from "./stallMarks.js?v=365";
import {
  coreInterior, edgePoint, pickCoreDoorSide, pickEdge, rampFootprint, rampShape,
  rampsForLevel, siteMarginsOf, stairCoreInterior, coreInteriorOf, rampOutsidePlate, coreGridLines, rampKeepOut,
} from "./layout.js?v=365";
import {
  analyzeOnPlate, buildChain, slopePlan, usesModuleLayout,
} from "./rampModules.js?v=365";
import {
  polygonFromPlate, snapPoint, edgeLengths, polygonArea,
} from "./polygon.js?v=365";
import {
  emit, moveLowerRamp, moveOpening, moveRamp, moveRampFree, placeOpening, placeRamp,
  selectCore, selectItem, setParkPolygon, state, subscribe, updateCore,
} from "./state.js?v=365";

const camera = { x: 0, y: 0, scale: 12 };
let fittedKey = "";
let drag = null;
let itemSel = null;   // 코어 안에서 한 번 클릭해 고른 승강기·계단 {index, label}
const overlayCache = new Map();
let requestDraw = () => {};

const PHASE = { perimeter: 1, loop: 2, inner: 3, column: 4, bypass: 5, arrow: 6 };

function shown(phase) {
  return (PHASE[phase] || 1) <= (state.revealStage ?? 6);
}

export function mountPlan(canvas) {
  const ctx = canvas.getContext("2d");

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    draw();
  };

  requestDraw = () => draw();

  const draw = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(0, 0, rect.width, rect.height);
    if (!state.plate) {
      drawPreviewShell(ctx, rect);
      return;
    }
    const key = `${state.plate.width}x${state.plate.depth}:${state.overlay.mode}:${Math.round(rect.width)}x${Math.round(rect.height)}`;
    if (key !== fittedKey) {
      fit(rect);
      fittedKey = key;
    }
    const side = state.overlay.mode === "side" && overlayImage();
    ctx.save();
    if (side) ctx.beginPath();
    ctx.translate(side ? rect.width * 0.25 : rect.width / 2, rect.height / 2);
    ctx.scale(camera.scale, -camera.scale);
    ctx.translate(-camera.x, -camera.y);
    paint(ctx);
    ctx.restore();
    if (side) {
      ctx.save();
      ctx.fillStyle = "#f7f4ee";
      ctx.fillRect(rect.width / 2, 0, rect.width / 2, rect.height);
      const image = side;
      const boundsW = rect.width / 2 - 24;
      const boundsH = rect.height - 24;
      const ratio = image.width / image.height;
      let w = boundsW;
      let h = w / ratio;
      if (h > boundsH) {
        h = boundsH;
        w = h * ratio;
      }
      ctx.globalAlpha = 0.95;
      ctx.drawImage(image, rect.width / 2 + (boundsW - w) / 2 + 12, (rect.height - h) / 2, w, h);
      ctx.restore();
    }
    paintNorth(ctx, rect);
  };

  const paint = (ctx) => {
    const plate = state.plate;
    const poly = polygonFromPlate(plate);
    ctx.fillStyle = "#fbfaf7";
    ctx.beginPath();
    poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();

    drawOverlay(ctx, plate);
    drawSite(ctx, plate);

    ctx.fillStyle = "#eadcc4";
    state.aisles.forEach((aisle) => {
      const phase = aisle.role === "bypass" ? "bypass" : aisle.phase;
      if (!shown(phase)) return;
      ctx.fillRect(aisle.x, aisle.y, aisle.w, aisle.d);
    });

    // 층별 보기: 그 층 램프 자리에 걸린 칸은 그 층에서 빼고 그림(B2↓ 층간 램프가 다른 쪽일 때)
    const floorBlocks = floorRampBlocks(plate);
    const onRamp = (st) => floorBlocks.some((b) => st.x < b.x + b.w - 0.05 && st.x + st.w > b.x + 0.05 && st.y < b.y + b.d - 0.05 && st.y + st.d > b.y + 0.05);
    state.floorHidden = 0;
    state.stalls.forEach((stall) => {
      if (!shown(stall.phase)) return;
      if (floorBlocks.length && onRamp(stall)) { state.floorHidden += 1; return; }
      const type = stall.parallel || stall.type === "parallel" ? "parallel" : (stall.type || "general");
      ctx.fillStyle = type === "disabled" ? "rgba(59, 130, 246, 0.38)"
        : type === "extended" ? "rgba(134, 239, 172, 0.45)"
          : type === "eco" ? "rgba(234, 179, 8, 0.4)"
            : type === "parallel" ? "rgba(148, 163, 184, 0.4)"
              : "#f7f4ee";
      ctx.strokeStyle = type === "disabled" ? "#1d4ed8"
        : type === "extended" ? "#15803d"
          : type === "eco" ? "#a16207"
            : type === "parallel" ? "#475569"
              : "#8a8478";
      // 확장형은 폭 차이(0.1m)가 안 보여서 굵은 테두리로
      ctx.lineWidth = (type === "extended" ? 2.6 : 1) / camera.scale;
      ctx.fillRect(stall.x, stall.y, stall.w, stall.d);
      ctx.strokeRect(stall.x, stall.y, stall.w, stall.d);
      if (type === "extended" && camera.scale > 9) {
        ctx.save(); ctx.fillStyle = "#15803d"; ctx.font = `${0.55}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        const cx = stall.x + stall.w / 2; const cy = stall.y + stall.d / 2;
        ctx.translate(cx, cy); ctx.scale(1, -1); ctx.fillText("2.6m", 0, 0); ctx.restore();
      }
      if (type === "eco") {
        // 전기차 충전기: 칸 뒤쪽(차로 반대편) 짙은 상자 + 노란 번개
        const r = chargerRect(stall);
        ctx.fillStyle = "#1f2937"; ctx.fillRect(r.x, r.y, r.w, r.d);
        const bp = boltPoints({ x: r.x, y: r.y, w: Math.max(r.w, r.d), d: Math.max(r.w, r.d) });
        const cx = r.x + r.w / 2; const cy = r.y + r.d / 2; const bx = r.x + Math.max(r.w, r.d) / 2; const by = r.y + Math.max(r.w, r.d) / 2;
        ctx.beginPath(); bp.forEach(([x, y], i) => { const px = x - bx + cx; const py = (y - by) * 0.5 + cy; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
        ctx.closePath(); ctx.fillStyle = "#facc15"; ctx.fill();
      }
      ctx.strokeStyle = "#3e6b4e";
      ctx.lineWidth = 1.6 / camera.scale;
      aisleMark(ctx, stall);
    });
    {
      const note = typeof document !== "undefined" && document.getElementById("floor-note");
      if (note) {
        const v = rampViewNow();
        const total = state.stalls.length;
        note.hidden = !(v === "entry" || v === "lower") || !total || document.body.dataset.wizard === "5";
        note.textContent = v === "lower"
          ? `B2 이하 한 층: ${total - state.floorHidden}대${state.floorHidden ? ` (층간 램프 자리 ${state.floorHidden}칸 빠짐)` : ""}`
          : `B1: ${total}대`;
      }
    }
    if (state.debugColumns) {
      (state.columnConflicts || []).forEach((stall) => {
        ctx.fillStyle = "rgba(180, 36, 24, 0.55)";
        ctx.strokeStyle = "#b42318";
        ctx.lineWidth = 1.8 / camera.scale;
        ctx.fillRect(stall.x, stall.y, stall.w, stall.d);
        ctx.strokeRect(stall.x, stall.y, stall.w, stall.d);
      });
    }

    const blockedRamps = new Set(state.issues.filter((issue) => issue.type === "ramp").map((issue) => issue.id));
    const groundDraw = rampsForLevel(state.ramps, plate, 0, "same", state.lowerRampOverrides);
    const lowerMode = state.lowerRampMode || (plate && plate.lowerRampMode) || "alternate";
    const lowers = rampsForLevel(state.ramps, plate, 1, lowerMode, state.lowerRampOverrides)
      .map((r) => ({ ...r, _lower: true }));
    // 램프·코어 단계에서는 고른 램프만(출입·층간이 한 평면에 겹치지 않게)
    const view = rampViewNow();
    const drawList = (view === "lower" || view === "none" ? [] : groundDraw).concat(view === "entry" || view === "none" ? [] : lowers);
    drawList.forEach((ramp) => {
      const selected = ramp._lower
        ? state.selection?.type === "lowerRamp" && state.selection.id === (ramp.groundId ?? ramp.id - 1000)
        : state.selection?.type === "ramp" && state.selection.id === ramp.id;
      const selMod = selected ? state.selection?.module : null;
      const blocked = blockedRamps.has(ramp.id);
      const lower = ramp._lower;
      const useMod = !lower && ramp.modules?.length && usesModuleLayout(ramp, plate, null);
      if (useMod || (ramp.modules?.length && !lower)) {
        drawModuleRamp(ctx, ramp, plate, { selected, selMod, blocked, lower, camera });
        return;
      }
      const shape = rampShape(ramp, plate);
      const footprint = shape.footprint || rampFootprint(ramp, plate);
      ctx.fillStyle = blocked ? "rgba(180, 40, 32, 0.35)" : (lower ? "rgba(61, 107, 79, 0.28)" : "rgba(168, 116, 42, 0.34)");
      ctx.strokeStyle = blocked ? "#b42318" : selected ? "#1e1a16" : (lower ? "#3d6b4f" : "#a8742a");
      ctx.lineWidth = (blocked || selected ? 2.6 : 1.5) / camera.scale;
      ctx.setLineDash(lower ? [0.6, 0.4] : []);
      if (shape.polygons && shape.polygons.length) {
        shape.polygons.forEach((poly) => {
          if (!poly || poly.length < 3) return;
          ctx.beginPath();
          poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        });
      } else {
        ctx.fillRect(footprint.x, footprint.y, footprint.w, footprint.d);
        ctx.strokeRect(footprint.x, footprint.y, footprint.w, footprint.d);
      }
      ctx.setLineDash([]);
      label(ctx, lower ? "층간 램프" : "램프", footprint.x + footprint.w / 2, footprint.y + footprint.d / 2, lower ? "#3d6b4f" : "#7a5418");
    });

    let stairNo = 0;
    // 램프 단계(4)에서는 코어를 아직 안 보여 줌 — 코어는 다음 단계에서 놓음
    const hideCores = typeof document !== "undefined" && document.body.dataset.wizard === "5";
    (hideCores ? [] : state.cores).forEach((core, index) => {
      const selected = state.selection?.type === "core" && state.coreIndex === index;
      const building = core.buildingId != null
        ? (state.buildings || []).find((b) => b.id === core.buildingId)
        : null;
      if (building && building.tower) {
        const tw = building.tower;
        const tx = core.x + (tw.dx || 0);
        const ty = core.y + (tw.dy || 0);
        ctx.save();
        ctx.setLineDash([0.9, 0.55]);
        ctx.strokeStyle = "#6b5a45";
        ctx.lineWidth = 1.2 / camera.scale;
        if (building.blockUnder) {
          hatchRect(ctx, tx, ty, tw.w, tw.d, "rgba(107, 90, 69, 0.12)");
        }
        ctx.strokeRect(tx, ty, tw.w, tw.d);
        ctx.restore();
        label(ctx, building.name, tx + tw.w / 2, ty + 1.2, "#6b5a45");
      }
      const stair = core.kind === "stair";
      if (stair) stairNo += 1;
      ctx.fillStyle = stair ? "rgba(90, 90, 90, 0.18)" : "rgba(44, 74, 110, 0.16)";
      ctx.strokeStyle = selected ? "#1e1a16" : (stair ? "#555" : "#2c4a6e");
      ctx.lineWidth = (selected ? 2.6 : 1.8) / camera.scale;
      ctx.fillRect(core.x, core.y, core.w, core.d);
      ctx.strokeRect(core.x, core.y, core.w, core.d);
      // 저장된 interior는 코어를 옮기기 전 자리일 수 있어 지금 코어 기준으로 다시 계산(사용자 편집 반영)
      const interior = coreInteriorOf(core, state.aisles, state.plate?.blockRects);
      if (interior) drawCoreInterior(ctx, interior, camera.scale);
      if (interior && selected && itemSel && itemSel.index === index) {
        const items = (interior.elevators || []).concat(interior.stair ? [interior.stair] : []);
        const item = items.find((r) => r.label === itemSel.label);
        if (item) {
          ctx.save();
          ctx.strokeStyle = "#0f766e";
          ctx.lineWidth = 2 / camera.scale;
          ctx.strokeRect(item.x, item.y, item.w, item.d);
          const h = rotHandleOf(item);
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          label(ctx, "↻", h.x, h.y, "#0f766e");
        }
      }
      if (interior && selected && state.tool === "core" && interior.door) {
        // 선택한 코어: 끌 수 있는 문 손잡이
        const d = interior.door;
        ctx.fillStyle = "#0f766e";
        ctx.beginPath();
        ctx.arc(d.x + d.w / 2, d.y + d.d / 2, 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
      const name = stair
        ? `계단 ${stairNo}`
        : (building ? building.name : `코어 ${index + 1}`);
      label(ctx, name, core.x + core.w / 2, core.y + core.d / 2, stair ? "#444" : "#2c4a6e");
    });

    // 코어 단계: 고른 기둥 격자(1점쇄선) + 교점 기둥 미리보기 — 코어를 칸에 맞춰 놓을 수 있게
    if (typeof document !== "undefined" && document.body.dataset.wizard === "6" && !(state.stalls && state.stalls.length)) {
      try {
        const { gx, gy } = coreGridLines(plate);
        ctx.save();
        ctx.strokeStyle = "rgba(100,116,139,0.55)";
        ctx.lineWidth = 1 / camera.scale;
        ctx.setLineDash([12 / camera.scale, 3 / camera.scale, 2 / camera.scale, 3 / camera.scale]);
        gx.forEach((x) => { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, plate.depth); ctx.stroke(); });
        gy.forEach((y) => { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plate.width, y); ctx.stroke(); });
        ctx.setLineDash([]);
        const cw = plate.columnWidth || 0.5; const cd = plate.columnDepth || cw;
        ctx.fillStyle = "rgba(44,40,36,0.75)";
        // 엔진과 같게: 외벽 줄 위(외벽이 받음)·램프와 진입·도착 6m 안에는 기둥을 세우지 않는다
        const keep = rampKeepOut(state.ramps, plate);
        gx.forEach((x) => gy.forEach((y) => {
          if (x <= 0.7 || y <= 0.7 || x >= plate.width - 0.7 || y >= plate.depth - 0.7) return;
          const col = { x: x - cw / 2, y: y - cd / 2, w: cw, d: cd };
          if (keep.some((b) => col.x < b.x + b.w && col.x + col.w > b.x && col.y < b.y + b.d && col.y + col.d > b.y)) return;
          const inCore = state.cores.some((c) => x > c.x + 0.05 && x < c.x + c.w - 0.05 && y > c.y + 0.05 && y < c.y + c.d - 0.05);
          if (!inCore) ctx.fillRect(col.x, col.y, cw, cd);
        }));
        ctx.restore();
      } catch (e) { /* 격자 없음 */ }
    }

    if (shown("column")) {
      state.columns.forEach((column) => {
        ctx.fillStyle = "#2c2824";
        ctx.fillRect(column.x, column.y, column.w, column.d);
      });
    }

    const external = state.ramps.some((ramp) => ramp.placement === "external");
    ctx.save();
    ctx.strokeStyle = "#1e1a16";
    ctx.lineWidth = 2 / camera.scale;
    if (external) ctx.setLineDash([0.6, 0.45]);
    ctx.beginPath();
    poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    // 편집 중 꼭짓점·변 길이
    if (plateEditStep() && (state.plateShapeMode === "draw" || state.tool === "platePoly") && (state.parkPolygon || poly)) {
      const edit = state.parkPolygon || poly;
      const lens = edgeLengths(edit);
      edit.forEach((p, i) => {
        ctx.fillStyle = state.selection?.type === "plateVertex" && state.selection.index === i ? "#b42318" : "#1e1a16";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 0.35, 0, Math.PI * 2);
        ctx.fill();
        const b = edit[(i + 1) % edit.length];
        const mx = (p.x + b.x) / 2;
        const my = (p.y + b.y) / 2;
        label(ctx, `${lens[i].toFixed(1)}m`, mx, my, "#475569");
      });
      if (edit.length >= 3) {
        label(ctx, `${polygonArea(edit).toFixed(0)}㎡`, edit.reduce((s, p) => s + p.x, 0) / edit.length,
          edit.reduce((s, p) => s + p.y, 0) / edit.length, "#1e1a16");
      }
    }

    const blockedOpenings = new Set(state.issues.filter((issue) => issue.type === "opening").map((issue) => issue.id));
    state.openings.forEach((opening) => {
      const blocked = blockedOpenings.has(opening.id);
      const color = blocked ? "#b42318" : opening.kind === "in" ? "#2f7a72" : "#b5522a";
      const text = opening.kind === "in" ? "입구" : "출구";
      drawOpening(ctx, opening, color, text);
    });
    dimension(ctx, plate);
    drawClearance(ctx);
    drawRoute(ctx);
  };

  canvas.addEventListener("pointerdown", (event) => {
    if (!state.plate) return;
    if (!Number.isFinite(camera.scale) || camera.scale <= 0) {
      fittedKey = "";
      fit(canvas.getBoundingClientRect());
    }
    const world = screenToWorld(canvas, event.clientX, event.clientY);
    if (!world) return;
    const prevItemSel = itemSel;
    itemSel = null;   // 다른 곳을 누르면 회전 버튼 숨김(아래에서 다시 고르면 유지)
    if (event.button === 1 || event.button === 2 || state.tool === "pan") {
      drag = { mode: "pan", x: event.clientX, y: event.clientY, cx: camera.x, cy: camera.y };
      canvas.setPointerCapture(event.pointerId);
      return;
    }

    // 추천·결과 단계: 램프·코어·출입구는 못 끔(바꾸려면 「이전」으로 램프·코어 단계에서). 화면 이동만.
    if (document.body.dataset.wizard === "7" || document.body.dataset.wizard === "8") {
      const grabbed = hitGate(world, state.openings) || hitRampDetail(world) || state.cores.some((core) => hit(world, core));
      if (grabbed) planToast("추천·결과에서는 램프·코어를 옮길 수 없어요. 바꾸려면 「이전」으로 램프·코어 단계에 돌아가세요.");
      drag = { mode: "pan", x: event.clientX, y: event.clientY, cx: camera.x, cy: camera.y };
      canvas.setPointerCapture(event.pointerId);
      return;
    }
    // 코어 단계: 코어(안쪽 문·승강기·계단 포함)를 램프·출입구보다 먼저 잡는다. 램프는 램프 단계에서만 옮김.
    const coreStep = document.body.dataset.wizard === "6";
    const coreFirst = coreStep && state.tool === "core" && state.cores.some((core) => hit(world, core)
      || (core.interior && core.interior.door && Math.abs(world.x - (core.interior.door.x + core.interior.door.w / 2)) < 1 && Math.abs(world.y - (core.interior.door.y + core.interior.door.d / 2)) < 1));
    const opening = coreFirst ? null : hitGate(world, state.openings);
    if (opening && (state.tool === "entrance" || state.tool === "exit" || state.tool === "core")) {
      selectItem({ type: "opening", id: opening.id });
      drag = { mode: "opening", id: opening.id };
      canvas.setPointerCapture(event.pointerId);
      return;
    }

    // 다각형 편집 — 크기 단계(3)에서만. 램프 단계 클릭이 외곽 꼭짓점으로 찍히던 문제
    if (plateEditStep() && (state.tool === "platePoly" || state.plateShapeMode === "draw")) {
      const poly = (state.parkPolygon || []).slice();
      const hitV = poly.findIndex((p) => Math.hypot(p.x - world.x, p.y - world.y) < 0.6);
      if (event.button === 2 && hitV >= 0) {
        if (poly.length > 3) {
          poly.splice(hitV, 1);
          setParkPolygon(poly);
        }
        return;
      }
      if (hitV >= 0) {
        selectItem({ type: "plateVertex", index: hitV });
        drag = { mode: "plateVertex", index: hitV };
        canvas.setPointerCapture(event.pointerId);
        return;
      }
      // 변 길이 라벨(중점) 클릭 → 숫자 수정
      for (let i = 0; i < poly.length; i += 1) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        if (Math.hypot(world.x - mx, world.y - my) < 0.75) {
          const curL = Math.hypot(b.x - a.x, b.y - a.y);
          const raw = window.prompt(`변 ${i + 1} 길이 (m)`, curL.toFixed(1));
          const nextL = Number(raw);
          if (Number.isFinite(nextL) && nextL >= 6) {
            const ux = (b.x - a.x) / (curL || 1);
            const uy = (b.y - a.y) / (curL || 1);
            const j = (i + 1) % poly.length;
            poly[j] = { x: a.x + ux * nextL, y: a.y + uy * nextL };
            setParkPolygon(poly);
          }
          return;
        }
      }
      // 변 중간 → 점 추가
      let insertAt = -1;
      for (let i = 0; i < poly.length; i += 1) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const t = nearestOnSeg(world, a, b);
        if (t.dist < 0.45 && t.u > 0.15 && t.u < 0.85) { insertAt = i + 1; break; }
      }
      if (insertAt >= 0) {
        const pt = snapPoint(world, 0.5, event.shiftKey && poly[insertAt - 1] ? poly[insertAt - 1] : null);
        poly.splice(insertAt, 0, pt);
        setParkPolygon(poly);
        selectItem({ type: "plateVertex", index: insertAt });
        return;
      }
      // 새 점 추가(미닫힘 편집)
      if (event.detail >= 2 && poly.length >= 3) {
        setParkPolygon(poly);
        return;
      }
      const pt = snapPoint(world, 0.5, event.shiftKey && poly.length ? poly[poly.length - 1] : null);
      if (poly.length >= 3 && Math.hypot(pt.x - poly[0].x, pt.y - poly[0].y) < 0.6) {
        setParkPolygon(poly);
        return;
      }
      poly.push(pt);
      state.parkPolygon = poly;
      state.platePolyError = "";
      selectItem({ type: "plateVertex", index: poly.length - 1 });
      emit();
      return;
    }

    const rampHit = coreStep ? null : hitRampDetail(world);
    if (rampHit && state.tool !== "entrance" && state.tool !== "exit") {
      if (rampHit.lower) {
        selectItem({ type: "lowerRamp", id: rampHit.groundId });
        drag = { mode: "lowerRamp", groundId: rampHit.groundId, edge: rampHit.ramp.edge };
        canvas.setPointerCapture(event.pointerId);
        return;
      }
      selectItem({ type: "ramp", id: rampHit.id, module: rampHit.module });
      const r = rampHit.ramp;
      // 외부·모듈·외곽 진입은 이격 띠까지 자유 이동
      // 내부형 출입 램프는 벽을 따라서만(평면 밖으로 못 나감)
      const internalEntry = (state.rampPlacement || "internal") !== "external" && !["outer9090", "outer180", "spiral"].includes(state.rampForm);
      const free = !internalEntry && Boolean(
        r?.modules?.length
        || r?.form === "spiral"
        || r?.form === "outer9090"
        || r?.form === "outer180"
        || state.rampForm === "spiral"
        || state.rampForm === "outer9090"
        || state.rampForm === "outer180"
        || (r?.placement || state.rampPlacement) === "external",
      );
      if (free) {
        const ax = Number.isFinite(r.x) ? r.x : (rampFootprint(r, state.plate)?.x || 0);
        const ay = Number.isFinite(r.y) ? r.y : (rampFootprint(r, state.plate)?.y || 0);
        drag = { mode: "rampFree", id: rampHit.id, ox: world.x - ax, oy: world.y - ay };
      } else {
        drag = { mode: "ramp", id: rampHit.id, edge: r.edge ?? r.legacy?.edge, internal: internalEntry, sx: event.clientX, sy: event.clientY, click: world };
      }
      canvas.setPointerCapture(event.pointerId);
      return;
    }

    const coreHit = document.body.dataset.wizard === "5" ? -1 : state.cores.findIndex((core) => hit(world, core));
    // 선택된 코어 안의 문·승강기·계단을 끌어 옮기기
    if (state.tool === "core" && document.body.dataset.wizard !== "5" && state.selection?.type === "core") {
      const ci = state.coreIndex;
      const core = state.cores[ci];
      const it = core && coreInteriorOf(core, state.aisles, state.plate?.blockRects);
      if (it && prevItemSel && prevItemSel.index === ci) {
        const items0 = (it.elevators || []).concat(it.stair ? [it.stair] : []);
        const sel = items0.find((r) => r.label === prevItemSel.label);
        if (sel) {
          const h = rotHandleOf(sel);
          if (Math.hypot(world.x - h.x, world.y - h.y) <= h.r + 0.15) {
            itemSel = prevItemSel;
            rotateCoreItem(ci, sel.label);
            return;
          }
        }
      }
      if (it) {
        const near = (r, pad) => world.x >= r.x - pad && world.x <= r.x + r.w + pad && world.y >= r.y - pad && world.y <= r.y + r.d + pad;
        if (it.door && near(it.door, 0.6)) {
          drag = { mode: "coreDoor", index: ci };
          canvas.setPointerCapture(event.pointerId);
          return;
        }
        const items = (it.elevators || []).concat(it.stair ? [it.stair] : []);
        const item = items.find((r) => near(r, 0));
        // 승강기·계단은 «한 번 눌러 고른 뒤» 끌어야 따로 움직임. 안 고른 상태로 끌면 코어 전체가 움직임(코어 잡기 쉽게)
        if (item && !(prevItemSel && prevItemSel.index === ci && prevItemSel.label === item.label)) {
          const core0 = state.cores[ci];
          drag = { mode: "core", dx: world.x - core0.x, dy: world.y - core0.y, itemClick: { index: ci, label: item.label }, sx: event.clientX, sy: event.clientY };
          canvas.setPointerCapture(event.pointerId);
          return;
        }
        if (item) {
          itemSel = prevItemSel;
          drag = { mode: "coreItem", index: ci, label: item.label, ox: world.x - item.x, oy: world.y - item.y, w: item.w, d: item.d, sx: event.clientX, sy: event.clientY, moved: false };
          canvas.setPointerCapture(event.pointerId);
          return;
        }
      }
    }
    if (state.tool === "core" && coreHit >= 0) {
      selectCore(coreHit);
      selectItem({ type: "core", index: coreHit });
      const core = state.cores[coreHit];
      drag = { mode: "core", dx: world.x - core.x, dy: world.y - core.y };
      canvas.setPointerCapture(event.pointerId);
      return;
    }

    const edge = pickEdge(world, state.plate);
    if (edge && state.tool === "entrance") {
      placeOpening("in", edge.edge, edge.t);
      return;
    }
    if (edge && state.tool === "exit") {
      placeOpening("out", edge.edge, edge.t);
      return;
    }
    if (edge && state.tool === "ramp") {
      placeRamp(edge.edge, edge.t);
      return;
    }
    // 빈 곳 왼쪽 드래그 → 화면 이동 (안내문과 동일). 램프 단계에서 그냥 클릭하면 → 출입 램프 위치 찍기
    drag = { mode: "pan", x: event.clientX, y: event.clientY, cx: camera.x, cy: camera.y, click: world, button: event.button };
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    const world = state.plate ? screenToWorld(canvas, event.clientX, event.clientY) : null;
    const readout = document.getElementById("readout");
    if (world && Number.isFinite(world.x) && Number.isFinite(world.y)) {
      readout.textContent = `X ${world.x.toFixed(1)}  Y ${world.y.toFixed(1)} m`;
    } else if (readout) {
      readout.textContent = "";
    }
    if (!drag || !world) return;
    if (drag.mode === "pan") {
      const s = Number.isFinite(camera.scale) && camera.scale > 0 ? camera.scale : 12;
      camera.x = drag.cx - (event.clientX - drag.x) / s;
      camera.y = drag.cy + (event.clientY - drag.y) / s;
      draw();
      return;
    }
    if (drag.mode === "core") {
      if (drag.itemClick && !drag.moved) {
        if (Math.hypot(event.clientX - drag.sx, event.clientY - drag.sy) < 4) return;
        drag.moved = true;
      }
      updateCore({ x: world.x - drag.dx, y: world.y - drag.dy });
      return;
    }
    if (drag.mode === "coreDoor" || drag.mode === "coreItem") {
      const core = state.cores[drag.index];
      if (!core) return;
      const ed = { door: core.interiorEdit?.door ? { ...core.interiorEdit.door } : null, items: { ...(core.interiorEdit?.items || {}) } };
      if (drag.mode === "coreDoor") {
        // 가장 가까운 벽 + 그 벽 위 위치
        const dl = world.x - core.x; const dr = core.x + core.w - world.x;
        const db = world.y - core.y; const dt = core.y + core.d - world.y;
        const m = Math.min(Math.abs(dl), Math.abs(dr), Math.abs(db), Math.abs(dt));
        const side = m === Math.abs(db) ? "s" : m === Math.abs(dt) ? "n" : m === Math.abs(dl) ? "w" : "e";
        const u = side === "s" || side === "n" ? (world.x - core.x) / core.w : (world.y - core.y) / core.d;
        if (ed.door?.side && ed.door.side !== side) ed.items = {};   // 문 면이 바뀌면 안쪽 배치는 새 면 기준 기본값으로
        if (!ed.door && side !== (core.doorSide || side)) ed.items = {};
        ed.door = { side, u: Math.max(0, Math.min(1, u)) };
      } else {
        if (!drag.moved && Math.hypot(event.clientX - drag.sx, event.clientY - drag.sy) < 4) return;
        drag.moved = true;
        const rx = world.x - drag.ox - core.x;
        const ry = world.y - drag.oy - core.y;
        // 다른 승강기·계단과 겹치면 안 옮김
        const trial = { ...core, interiorEdit: { ...ed, items: { ...ed.items, [drag.label]: { ...(ed.items[drag.label] || {}), rx, ry } } } };
        const it = coreInteriorOf(trial, state.aisles, state.plate?.blockRects);
        const all = (it?.elevators || []).concat(it?.stair ? [it.stair] : []);
        const me = all.find((r) => r.label === drag.label);
        const clash = me && all.some((r) => r !== me && Math.min(me.x + me.w, r.x + r.w) - Math.max(me.x, r.x) > 0.02 && Math.min(me.y + me.d, r.y + r.d) - Math.max(me.y, r.y) > 0.02);
        if (clash) return;
        ed.items[drag.label] = { ...(ed.items[drag.label] || {}), rx: me ? me.x - core.x : rx, ry: me ? me.y - core.y : ry };
      }
      state.coreIndex = drag.index;
      updateCore({ interiorEdit: ed });
      return;
    }
    const edge = pickEdge(world, state.plate);
    if (drag.mode === "opening") {
      const current = state.openings.find((item) => item.id === drag.id);
      if (!current) return;
      moveOpening(drag.id, edge ? edge.edge : current.edge, edge ? edge.t : projectAlong(current.edge, world));
    }
    if (drag.mode === "plateVertex") {
      const poly = (state.parkPolygon || []).slice();
      if (!poly[drag.index]) return;
      const prev = poly[(drag.index - 1 + poly.length) % poly.length];
      poly[drag.index] = snapPoint(world, 0.5, event.shiftKey ? prev : null);
      state.parkPolygon = poly;
      emit();
      return;
    }
    if (drag.mode === "rampFree") {
      moveRampFree(drag.id, world.x - drag.ox, world.y - drag.oy, { live: true });
      return;
    }
    if (drag.mode === "ramp") {
      const current = state.ramps.find((item) => item.id === drag.id);
      if (!current) return;
      if (drag.internal) {
        // 평면 안으로 가둔 뒤 가장 가까운 벽·자리로
        const P = state.plate;
        const e = nearestWall({ x: Math.max(0, Math.min(P.width, world.x)), y: Math.max(0, Math.min(P.depth, world.y)) }, P);
        const ce = current.edge ?? current.legacy?.edge; const ct = current.t ?? current.legacy?.t;
        if (e.edge !== ce || Math.abs(e.t - ct) >= 0.5) { const prevSet = state.rampStartSet; const prevEdge = state.roadEdge; state.rampStartSet = true; state.roadEdge = e.edge; if (!tryMoveRamp(drag.id, e.edge, e.t)) { state.rampStartSet = prevSet; state.roadEdge = prevEdge; } }
      } else {
        moveRamp(drag.id, edge ? edge.edge : current.edge, edge ? edge.t : projectAlong(current.edge, world));
      }
    }
    if (drag.mode === "lowerRamp") {
      const hit = pickEdge(world, state.plate) || { edge: drag.edge, t: projectAlong(drag.edge, world) };
      moveLowerRamp(drag.groundId, hit.edge || drag.edge, hit.t, { live: true });
    }
  });

  canvas.addEventListener("pointerup", (event) => {
    if (drag?.mode === "core" && drag.itemClick && Math.hypot(event.clientX - drag.sx, event.clientY - drag.sy) < 4) {
      itemSel = drag.itemClick;   // 그냥 클릭 → 그 승강기·계단 선택(↻ 회전 버튼)
      drag = null;
      draw();
      return;
    }
    if (drag?.mode === "coreItem") {
      itemSel = { index: drag.index, label: drag.label };   // 클릭(또는 끈 뒤)한 승강기·계단 옆에 회전 버튼
      drag = null;
      draw();
      return;
    }
    // 램프 단계 + 내부형: 빈 곳을 '클릭'(끌지 않음) → 가장 가까운 벽에서 출입 램프 시작
    if (drag?.mode === "pan" && drag.click && drag.button === 0 && event
      && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4 && internalEntryEditable()) {
      const p = drag.click;
      const P = state.plate;
      const ext = (state.rampPlacement || "internal") === "external";
      // 내부: 평면 안 클릭 / 외부: 평면 밖(이격 띠)도 클릭 가능
      const tol = 3;   // 벽 바로 밖(3m)을 눌러도 그 벽으로
      const inside = p.x >= -tol && p.y >= -tol && p.x <= P.width + tol && p.y <= P.depth + tol;
      if (inside || ext) {
        const e = nearestWall({ x: Math.max(0, Math.min(P.width, p.x)), y: Math.max(0, Math.min(P.depth, p.y)) }, P);
        const prevSet = state.rampStartSet; const prevEdge = state.roadEdge;
        state.rampStartSet = true;
        state.roadEdge = e.edge;   // 출입 램프가 붙은 변 = 차가 들어오는 쪽
        if (!tryMoveRamp(state.ramps[0].id, e.edge, e.t)) { state.rampStartSet = prevSet; state.roadEdge = prevEdge; emit(); }
      }
    }
    // 램프 단계: 램프 위를 그냥 클릭(안 끌고)해도 그 자리에서 가장 가까운 벽으로 시작점 찍기
    if (drag?.mode === "ramp" && drag.internal && drag.click && event && Math.hypot(event.clientX - drag.sx, event.clientY - drag.sy) < 4
      && internalEntryEditable() && !state.rampStartSet) {
      const P = state.plate;
      const p = drag.click;
      const e = nearestWall({ x: Math.max(0, Math.min(P.width, p.x)), y: Math.max(0, Math.min(P.depth, p.y)) }, P);
      const prevEdge = state.roadEdge;
      state.rampStartSet = true;
      state.roadEdge = e.edge;
      if (!tryMoveRamp(drag.id, e.edge, e.t)) { state.rampStartSet = false; state.roadEdge = prevEdge; emit(); }
    }
    if (drag?.mode === "rampFree") {
      const cur = state.ramps.find((item) => item.id === drag.id);
      if (cur) state.rampStartSet = true;
      if (cur && internalEntryEditable() && (state.rampPlacement || "internal") !== "external" && cur.id === state.ramps[0]?.id && !(cur.modules?.length > 1 && !cur.legacy)) {
        // 내부 출입 램프를 끌어 놓으면: 시작점에 가까운 벽·자리로 다시 짜서 직선/90°를 새로 고름
        const e = nearestWall({ x: cur.x, y: cur.y }, state.plate);
        tryMoveRamp(cur.id, e.edge, e.t);
      } else if (cur) moveRampFree(drag.id, cur.x, cur.y, { live: false });
    }
    if (drag?.mode === "lowerRamp" && drag.groundId != null) {
      const ov = state.lowerRampOverrides?.[drag.groundId];
      if (ov) moveLowerRamp(drag.groundId, ov.edge || drag.edge, ov.t, { live: false });
    }
    if (drag?.mode === "plateVertex" && state.parkPolygon?.length >= 3) {
      setParkPolygon(state.parkPolygon);
    }
    drag = null;
  });

  function nearestOnSeg(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L2 = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
    const x = a.x + u * dx;
    const y = a.y + u * dy;
    return { u, dist: Math.hypot(p.x - x, p.y - y), x, y };
  }

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    if (state.selection?.type !== "plateVertex") return;
    const poly = (state.parkPolygon || []).slice();
    const idx = state.selection.index;
    if (poly.length > 3 && idx >= 0 && idx < poly.length) {
      event.preventDefault();
      poly.splice(idx, 1);
      setParkPolygon(poly);
      selectItem(null);
    }
  });

  canvas.addEventListener("wheel", (event) => {
    if (!state.plate) return;
    event.preventDefault();
    if (!Number.isFinite(camera.scale) || camera.scale <= 0) {
      fittedKey = "";
      fit(canvas.getBoundingClientRect());
    }
    const before = screenToWorld(canvas, event.clientX, event.clientY);
    if (!before) return;
    const next = Math.max(4, Math.min(90, camera.scale * (event.deltaY > 0 ? 0.92 : 1.08)));
    if (!Number.isFinite(next)) return;
    camera.scale = next;
    const after = screenToWorld(canvas, event.clientX, event.clientY);
    if (!after) return;
    camera.x += before.x - after.x;
    camera.y += before.y - after.y;
    draw();
  }, { passive: false });

  // 터치 핀치 확대·축소
  let pinch = null;
  canvas.addEventListener("touchstart", (event) => {
    if (!state.plate || event.touches.length !== 2) return;
    event.preventDefault();
    const a = event.touches[0];
    const b = event.touches[1];
    pinch = {
      dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      scale: camera.scale,
      midX: (a.clientX + b.clientX) / 2,
      midY: (a.clientY + b.clientY) / 2,
      cx: camera.x,
      cy: camera.y,
    };
    drag = null;
  }, { passive: false });
  canvas.addEventListener("touchmove", (event) => {
    if (!pinch || event.touches.length !== 2) return;
    event.preventDefault();
    const a = event.touches[0];
    const b = event.touches[1];
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (!(pinch.dist > 0) || !Number.isFinite(dist)) return;
    const before = screenToWorld(canvas, pinch.midX, pinch.midY);
    const next = Math.max(4, Math.min(90, pinch.scale * (dist / pinch.dist)));
    if (!Number.isFinite(next)) return;
    camera.scale = next;
    const midX = (a.clientX + b.clientX) / 2;
    const midY = (a.clientY + b.clientY) / 2;
    const after = screenToWorld(canvas, midX, midY);
    if (before && after) {
      camera.x += before.x - after.x;
      camera.y += before.y - after.y;
    }
    draw();
  }, { passive: false });
  canvas.addEventListener("touchend", () => { pinch = null; });
  canvas.addEventListener("touchcancel", () => { pinch = null; });

  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  document.getElementById("fit").addEventListener("click", () => {
    fittedKey = "";
    draw();
  });

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  // 스테이지(plan-view) 크기 변화도 잡아 램프 단계 확장 직후 맞춤이 빠지지 않게 한다.
  const host = canvas.parentElement;
  if (host) observer.observe(host);
  subscribe(draw);
  resize();
}

/** 다음 그리기에서 카메라 맞춤을 다시 계산한다(마법사 확장·탭 전환 후). */
export function invalidatePlanFit() {
  fittedKey = "";
  requestDraw();
}

function viewBounds() {
  const plate = state.plate;
  const m = siteMarginsOf({
    ...plate,
    siteMargin: plate.siteMargin != null ? plate.siteMargin : state.siteMargin,
    siteMargins: plate.siteMargins || state.siteMargins,
  });
  let minX = -Math.max(1, Number(m.w) || 1);
  let minY = -Math.max(1, Number(m.s) || 1);
  let maxX = Number(plate.width) + Math.max(1, Number(m.e) || 1);
  let maxY = Number(plate.depth) + Math.max(1, Number(m.n) || 1);
  (state.ramps || []).forEach((ramp) => {
    const box = rampFootprint(ramp, plate);
    if (!box) return;
    const x = Number(box.x);
    const y = Number(box.y);
    const w = Number(box.w);
    const d = Number(box.d);
    if (![x, y, w, d].every(Number.isFinite) || w <= 0 || d <= 0) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + d);
  });
  const width = Math.max(8, maxX - minX);
  const height = Math.max(8, maxY - minY);
  if (state.overlay.mode === "side") {
    return {
      width: width * 2,
      height,
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
    };
  }
  return { width, height, x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

function drawPreviewShell(ctx, rect) {
  const w = Math.max(18, Number(state.parkWidth) || 48);
  const d = Math.max(18, Number(state.parkDepth) || 42);
  const pad = 28;
  const scale = Math.min((rect.width - pad * 2) / w, (rect.height - pad * 2) / d);
  const ox = (rect.width - w * scale) / 2;
  const oy = (rect.height - d * scale) / 2;
  ctx.save();
  ctx.translate(ox, oy + d * scale);
  ctx.scale(scale, -scale);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 1.5 / scale;
  ctx.fillRect(0, 0, w, d);
  ctx.strokeRect(0, 0, w, d);
  // light bay hints
  const spacing = Math.max(5, Number(state.columnSpacing) || 8.1);
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1 / scale;
  for (let x = spacing; x < w - 0.1; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, d);
    ctx.stroke();
  }
  for (let y = spacing; y < d - 0.1; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  // road edge accent
  const edge = state.roadEdge || "s";
  ctx.strokeStyle = "#0f766e";
  ctx.lineWidth = 4 / scale;
  ctx.beginPath();
  if (edge === "s") { ctx.moveTo(0, 0); ctx.lineTo(w, 0); }
  else if (edge === "n") { ctx.moveTo(0, d); ctx.lineTo(w, d); }
  else if (edge === "w") { ctx.moveTo(0, 0); ctx.lineTo(0, d); }
  else { ctx.moveTo(w, 0); ctx.lineTo(w, d); }
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = "#64748b";
  ctx.font = "12px Pretendard, Noto Sans KR, sans-serif";
  ctx.fillText(`${w} × ${d} m`, 14, rect.height - 14);
}

function fit(rect) {
  const bounds = viewBounds();
  const width = state.overlay.mode === "side" ? rect.width / 2 : rect.width;
  const bw = Math.max(8, Number(bounds.width) || 8);
  const bh = Math.max(8, Number(bounds.height) || 8);
  let scale = Math.min(width / (bw + 8), rect.height / (bh + 8));
  if (!Number.isFinite(scale) || scale <= 0) scale = 12;
  camera.scale = Math.max(0.5, Math.min(90, scale));
  camera.x = Number.isFinite(bounds.x) ? bounds.x : 0;
  camera.y = Number.isFinite(bounds.y) ? bounds.y : 0;
}

function screenToWorld(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const s = Number.isFinite(camera.scale) && camera.scale > 0 ? camera.scale : 12;
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const wx = (x - rect.width / 2) / s + camera.x;
  const wy = (rect.height / 2 - y) / s + camera.y;
  if (!Number.isFinite(wx) || !Number.isFinite(wy)) return null;
  return { x: wx, y: wy };
}

function hit(point, rect) {
  return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.d;
}

function hitGate(point, gates) {
  let best = null;
  let score = 1.6;
  gates.forEach((gate) => {
    const along = gate.edge === "n" || gate.edge === "s" ? point.x : point.y;
    let cross = 0;
    if (gate.edge === "s") cross = point.y;
    if (gate.edge === "n") cross = state.plate.depth - point.y;
    if (gate.edge === "w") cross = point.x;
    if (gate.edge === "e") cross = state.plate.width - point.x;
    if (cross < -0.3 || cross > 1.5) return;
    if (Math.abs(along - gate.t) > gate.width / 2 + 0.5) return;
    const dist = Math.abs(cross);
    if (dist < score) {
      score = dist;
      best = gate;
    }
  });
  return best;
}

// 램프 단계(5) · 내부형 · 출입 램프를 보고 있을 때만 '클릭으로 위치 찍기'
function internalEntryEditable() {
  const w = typeof document !== "undefined" ? document.body.dataset.wizard : "";
  return w === "5" && state.plate && state.ramps?.length && (state.rampView || "entry") !== "lower";
}
function nearestWall(p, P) {
  const o = [
    { edge: "s", d: p.y, t: p.x }, { edge: "n", d: P.depth - p.y, t: p.x },
    { edge: "w", d: p.x, t: p.y }, { edge: "e", d: P.width - p.x, t: p.y },
  ].sort((a, b) => a.d - b.d)[0];
  return { edge: o.edge, t: Math.round(o.t * 10) / 10 };
}

// 램프(5)·코어(6) 단계에서만 보기 선택을 따름. 그 밖에는 둘 다.
function floorRampBlocks(plate) {
  const view = rampViewNow();
  if (view !== "lower" || !plate) return [];
  const lowerMode = state.lowerRampMode || (plate && plate.lowerRampMode) || "alternate";
  if (lowerMode === "same" && !Object.keys(state.lowerRampOverrides || {}).length) return [];
  const out = [];
  rampsForLevel(state.ramps, plate, 1, lowerMode, state.lowerRampOverrides).forEach((r) => {
    try {
      const sh = rampShape(r, plate);
      const pieces = (sh.pieces && sh.pieces.length) ? sh.pieces : [sh.footprint || rampFootprint(r, plate)];
      pieces.forEach((p) => { if (p && p.w > 0 && p.d > 0) out.push(p); });
    } catch (e) { /* 무시 */ }
  });
  return out;
}

function plateEditStep() {
  return typeof document !== "undefined" && document.body.dataset.wizard === "3";
}

function rampViewNow() {
  const w = typeof document !== "undefined" ? document.body.dataset.wizard : "";
  // 램프 단계에서 시작점을 아직 안 찍었으면 램프를 안 그림
  if (w === "5" && !state.rampStartSet) return "none";
  // 램프·코어·추천·결과: 층별(B1 출입 / B2↓ 층간)로 한 층씩
  return ["5", "6", "7", "8"].includes(w) ? (state.rampView || "entry") : "both";
}

function hitRamp(point) {
  const detail = hitRampDetail(point);
  return detail ? detail.ramp : null;
}

function hitRampDetail(point) {
  if (!state.plate) return null;
  // 층간 램프(초록 점선) 먼저 — 출입과 독립 선택
  const view = rampViewNow();
  const lowerMode = state.lowerRampMode || "alternate";
  const lowers = view === "entry" || view === "none" ? [] : rampsForLevel(state.ramps, state.plate, 1, lowerMode, state.lowerRampOverrides);
  for (const ramp of lowers) {
    const shape = rampShape(ramp, state.plate);
    const box = shape.footprint || rampFootprint(ramp, state.plate);
    if (box && hit(point, box)) {
      return {
        id: ramp.id,
        ramp,
        module: null,
        lower: true,
        groundId: ramp.groundId ?? (Number(ramp.id) - 1000),
      };
    }
  }
  for (const ramp of (view === "lower" || view === "none" ? [] : state.ramps)) {
    if (ramp.modules?.length) {
      const chain = buildChain(ramp);
      for (let i = chain.modules.length - 1; i >= 0; i -= 1) {
        const m = chain.modules[i];
        if (m.rects?.some((r) => hit(point, r)) || (m.polygon && pointInPoly(point, m.polygon))) {
          return { id: ramp.id, ramp, module: i };
        }
      }
    }
    if (hit(point, rampFootprint(ramp, state.plate))) {
      return { id: ramp.id, ramp, module: null };
    }
  }
  const gate = hitGate(point, state.ramps);
  return gate ? { id: gate.id, ramp: gate, module: null } : null;
}

function pointInPoly(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i]; const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

function slopeColor(slope) {
  const s = Math.max(0, Math.min(0.17, Number(slope) || 0));
  const t = s / 0.17;
  // 0% 초록 → 8.5% 노랑 → 17% 빨강
  const r = t < 0.5 ? Math.round(60 + t * 2 * 180) : Math.round(240 + (t - 0.5) * 2 * 15);
  const g = t < 0.5 ? Math.round(160 + t * 2 * 40) : Math.round(200 - (t - 0.5) * 2 * 160);
  const b = t < 0.5 ? Math.round(80 - t * 2 * 40) : Math.round(40 - (t - 0.5) * 2 * 20);
  return `rgba(${r},${g},${b},0.45)`;
}

function drawModuleRamp(ctx, ramp, plate, { selected, selMod, blocked, lower, camera }) {
  const legal = Number(plate.legalStalls) || Number(plate.stallRules?.legalStalls) || 0;
  const plan = slopePlan(ramp, { floorHeight: plate.floorHeight || 3.2, legalStalls: legal });
  const site = analyzeOnPlate(ramp, plate, { legalStalls: legal, blocks: plate.blockRects || [] });
  const chain = plan.chain || buildChain(ramp);
  // keepClear
  (site.keepClear || []).forEach((z) => {
    ctx.fillStyle = "rgba(60, 120, 200, 0.18)";
    ctx.strokeStyle = "rgba(60, 120, 200, 0.55)";
    ctx.lineWidth = 1 / camera.scale;
    ctx.fillRect(z.x, z.y, z.w, z.d);
    ctx.strokeRect(z.x, z.y, z.w, z.d);
    const name = z.role === "arrival" ? "도착 6m" : z.role === "top" ? "진입 6m" : z.role === "landing" ? "착지 6m" : "6m";
    label(ctx, name, z.x + z.w / 2, z.y + z.d / 2, "#2c5a8e");
  });
  (site.openings || []).forEach((op) => {
    ctx.strokeStyle = "#2f7a3e";
    ctx.lineWidth = 3.5 / camera.scale;
    const thick = 0.4;
    if (op.edge === "w") ctx.strokeRect(0, op.t - op.width / 2, thick, op.width);
    else if (op.edge === "e") ctx.strokeRect(plate.width - thick, op.t - op.width / 2, thick, op.width);
    else if (op.edge === "s") ctx.strokeRect(op.t - op.width / 2, 0, op.width, thick);
    else ctx.strokeRect(op.t - op.width / 2, plate.depth - thick, op.width, thick);
  });
  const err = blocked || (site.issues || []).some((i) => i.level === "error");
  chain.modules.forEach((m, i) => {
    const pm = (plan.perModule || [])[i] || {};
    const slope = pm.slope != null ? pm.slope : (plan.levels?.[0]?.pieces?.find((p) => p.module === i)?.slope);
    const fill = err ? "rgba(180, 40, 32, 0.35)" : slopeColor(slope);
    ctx.fillStyle = fill;
    ctx.strokeStyle = err ? "#b42318" : (selected && selMod === i ? "#1e1a16" : selected ? "#5a4a2a" : "#a8742a");
    ctx.lineWidth = (selected && selMod === i ? 3.2 : selected || err ? 2.4 : 1.5) / camera.scale;
    if (m.polygon && m.polygon.length >= 3) {
      ctx.beginPath();
      m.polygon.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (m.rects?.[0]) {
      const r = m.rects[0];
      ctx.fillRect(r.x, r.y, r.w, r.d);
      ctx.strokeRect(r.x, r.y, r.w, r.d);
    }
    const pct = slope != null ? `${(slope * 100).toFixed(1)}%` : "";
    const mid = m.polygon?.[0] && m.polygon[Math.floor(m.polygon.length / 2)]
      ? { x: (m.start.x + m.end.x) / 2, y: (m.start.y + m.end.y) / 2 }
      : (m.rects?.[0] ? { x: m.rects[0].x + m.rects[0].w / 2, y: m.rects[0].y + m.rects[0].d / 2 } : m.start);
    if (mid && pct) label(ctx, pct, mid.x, mid.y, "#5a3d10");
  });
  // 시작점·방향
  if (chain.modules[0]) {
    const s = chain.modules[0].start;
    ctx.fillStyle = "#1e1a16";
    ctx.beginPath();
    ctx.arc(s.x, s.y, 0.45, 0, Math.PI * 2);
    ctx.fill();
    const rad = (s.h * Math.PI) / 180;
    ctx.strokeStyle = "#1e1a16";
    ctx.lineWidth = 2 / camera.scale;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + Math.cos(rad) * 2.5, s.y + Math.sin(rad) * 2.5);
    ctx.stroke();
  }
}

function projectAlong(edge, point) {
  return edge === "n" || edge === "s" ? point.x : point.y;
}

function aisleMark(ctx, stall) {
  ctx.beginPath();
  if (stall.aisle === "n") line(ctx, stall.x + 0.35, stall.y + stall.d - 0.25, stall.x + stall.w - 0.35, stall.y + stall.d - 0.25);
  if (stall.aisle === "s") line(ctx, stall.x + 0.35, stall.y + 0.25, stall.x + stall.w - 0.35, stall.y + 0.25);
  if (stall.aisle === "e") line(ctx, stall.x + stall.w - 0.25, stall.y + 0.35, stall.x + stall.w - 0.25, stall.y + stall.d - 0.35);
  if (stall.aisle === "w") line(ctx, stall.x + 0.25, stall.y + 0.35, stall.x + 0.25, stall.y + stall.d - 0.35);
}

function drawRoute(ctx) {
  if (!shown("arrow")) return;
  const drives = state.drives || [];
  if (drives.length) {
    ctx.save();
    ctx.strokeStyle = "#8a4b12";
    ctx.fillStyle = "#8a4b12";
    ctx.lineWidth = 1.2 / camera.scale;
    drives.forEach((segment) => {
      ctx.beginPath();
      ctx.moveTo(segment.x1, segment.y1);
      ctx.lineTo(segment.x2, segment.y2);
      ctx.stroke();
      const angle = Math.atan2(segment.y2 - segment.y1, segment.x2 - segment.x1);
      const size = 0.85;
      ctx.beginPath();
      ctx.moveTo(segment.x2, segment.y2);
      ctx.lineTo(segment.x2 - size * Math.cos(angle - 0.45), segment.y2 - size * Math.sin(angle - 0.45));
      ctx.lineTo(segment.x2 - size * Math.cos(angle + 0.45), segment.y2 - size * Math.sin(angle + 0.45));
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();
    return;
  }
  const points = state.route || [];
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = "#8a4b12";
  ctx.fillStyle = "#8a4b12";
  ctx.lineWidth = 1.4 / camera.scale;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const size = 1.15;
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - size * Math.cos(angle - 0.45), to.y - size * Math.sin(angle - 0.45));
    ctx.lineTo(to.x - size * Math.cos(angle + 0.45), to.y - size * Math.sin(angle + 0.45));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawOpening(ctx, opening, color, text) {
  const point = edgePoint(opening.edge, opening.t, state.plate);
  const selected = state.selection?.type === "opening" && state.selection.id === opening.id;
  ctx.save();
  ctx.translate(point.x, point.y);
  if (opening.edge === "n") ctx.rotate(Math.PI);
  if (opening.edge === "w") ctx.rotate(-Math.PI / 2);
  if (opening.edge === "e") ctx.rotate(Math.PI / 2);
  ctx.fillStyle = color;
  ctx.fillRect(-opening.width / 2, -0.85, opening.width, 0.85);
  if (selected) {
    ctx.strokeStyle = "#1e1a16";
    ctx.lineWidth = 1.6 / camera.scale;
    ctx.strokeRect(-opening.width / 2, -0.85, opening.width, 0.85);
  }
  const lift = opening.kind === "in" ? -1.5 : -2.7;
  label(ctx, text, 0, lift, color);
  ctx.restore();
}

function hatchRect(ctx, x, y, w, d, fill) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, d);
  ctx.clip();
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, d);
  ctx.strokeStyle = "rgba(107, 90, 69, 0.35)";
  ctx.lineWidth = 0.8 / (ctx.getTransform?.().a || 1);
  const step = 1.2;
  for (let t = -d; t < w + d; t += step) {
    ctx.beginPath();
    ctx.moveTo(x + t, y);
    ctx.lineTo(x + t + d, y + d);
    ctx.stroke();
  }
  ctx.restore();
}

/** 코어 안 승강기·계단 90° 회전(중심 유지). 돌리면 다른 것과 겹치면 안 돌림. */
function rotateCoreItem(ci, labelKey) {
  const core = state.cores[ci];
  if (!core) return;
  const it = coreInteriorOf(core, state.aisles, state.plate?.blockRects);
  const items = (it?.elevators || []).concat(it?.stair ? [it.stair] : []);
  const item = items.find((r) => r.label === labelKey);
  if (!item) return;
  const ed = { door: core.interiorEdit?.door ? { ...core.interiorEdit.door } : null, items: { ...(core.interiorEdit?.items || {}) } };
  const cur = ed.items[item.label] || {};
  const cx = item.x + item.w / 2; const cy = item.y + item.d / 2;
  ed.items[item.label] = { ...cur, rot: !cur.rot, rx: cx - item.d / 2 - core.x, ry: cy - item.w / 2 - core.y };
  const t = coreInteriorOf({ ...core, interiorEdit: ed }, state.aisles, state.plate?.blockRects);
  const all = (t?.elevators || []).concat(t?.stair ? [t.stair] : []);
  const me = all.find((r) => r.label === item.label);
  const clash = me && all.some((r) => r !== me && Math.min(me.x + me.w, r.x + r.w) - Math.max(me.x, r.x) > 0.02 && Math.min(me.y + me.d, r.y + r.d) - Math.max(me.y, r.y) > 0.02);
  if (clash) return;
  state.coreIndex = ci;
  updateCore({ interiorEdit: ed });
}
function rotHandleOf(item) {
  const r = Math.max(0.45, 11 / (camera.scale || 12));   // 화면에서 약 11px — 줌아웃해도 누를 수 있게
  return { x: item.x + item.w + r, y: item.y + item.d + r, r };
}

/** 내부 출입 램프 옮기기 — 평면 밖으로 튀어나오면 되돌리고 알림 */
const RAMP_SNAP_KEYS = ["ramps", "cores", "lowerRampOverrides", "rampStartSet", "roadEdge", "stalls", "aisles", "columns", "drives", "route", "issues", "metrics", "spec", "openings"];
function tryMoveRamp(id, edge, t) {
  const internal = (state.rampPlacement || "internal") !== "external";
  let snap = null;
  if (internal) {
    snap = {};
    RAMP_SNAP_KEYS.forEach((k) => { try { snap[k] = structuredClone(state[k]); } catch (e) { snap[k] = state[k]; } });
  }
  moveRamp(id, edge, t);
  if (!internal) return true;
  const r = state.ramps.find((item) => item.id === id);
  if (r && rampOutsidePlate(r, state.plate)) {
    Object.assign(state, snap);
    emit();
    planToast("램프가 평면 밖으로 튀어나와서 이 자리엔 둘 수 없어요. 다른 위치를 찍거나 평면을 키워 주세요.");
    return false;
  }
  return true;
}
let toastTimer = null;
function planToast(msg) {
  if (typeof document === "undefined") return;
  let el = document.getElementById("plan-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "plan-toast";
    el.className = "plan-toast";
    const host = document.getElementById("plan")?.parentElement || document.body;
    host.appendChild(el);
  }
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

function label(ctx, text, x, y, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, -1);
  ctx.fillStyle = color;
  ctx.font = `${13 / camera.scale}px Segoe UI, Malgun Gothic, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawClearance(ctx) {
  const mark = state.clearance;
  if (!mark || !(mark.gap > 0)) return;
  ctx.save();
  ctx.strokeStyle = "#9a3412";
  ctx.fillStyle = "#9a3412";
  ctx.lineWidth = 1.2 / camera.scale;
  line(ctx, mark.x1, mark.y, mark.x2, mark.y);
  line(ctx, mark.x1, mark.y - 0.18, mark.x1, mark.y + 0.18);
  line(ctx, mark.x2, mark.y - 0.18, mark.x2, mark.y + 0.18);
  label(ctx, `${mark.gap.toFixed(2)}m`, (mark.x1 + mark.x2) / 2, mark.y - 0.35, "#9a3412");
  ctx.restore();
}

function dimension(ctx, plate) {
  let minX = 0;
  let minY = 0;
  state.ramps.forEach((ramp) => {
    const box = rampFootprint(ramp, plate);
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
  });
  const y = minY - 2.4;
  const x = minX - 2.4;
  ctx.save();
  ctx.fillStyle = "#6f675f";
  ctx.strokeStyle = "#6f675f";
  ctx.lineWidth = 1 / camera.scale;
  line(ctx, 0, y, plate.width, y);
  line(ctx, x, 0, x, plate.depth);
  label(ctx, `${plate.width.toLocaleString("ko-KR")} m`, plate.width / 2, y - 1.2, "#6f675f");
  label(ctx, `${plate.depth.toLocaleString("ko-KR")} m`, x - 1.6, plate.depth / 2, "#6f675f");
  ctx.restore();
}

function drawSite(ctx, plate) {
  // 대지 이격: 외부 램프 여부와 무관하게 점선으로 표시 (공통·방향별)
  const m = siteMarginsOf({
    ...plate,
    siteMargin: plate.siteMargin != null ? plate.siteMargin : state.siteMargin,
    siteMargins: plate.siteMargins || state.siteMargins,
  });
  if (!(m.n > 0 || m.s > 0 || m.e > 0 || m.w > 0)) return;
  const poly = polygonFromPlate(plate);
  const maxM = Math.max(m.n, m.s, m.e, m.w);
  ctx.save();
  ctx.strokeStyle = "#64748b";
  ctx.fillStyle = "#64748b";
  ctx.lineWidth = 1.4 / camera.scale;
  ctx.setLineDash([1.8, 1.2]);
  ctx.beginPath();
  // 다각형 외곽 오프셋(균일 max). 방향별 이격은 라벨로 표기.
  const outward = offsetOutwardApprox(poly, maxM);
  outward.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  // 이격 치수 라벨
  const fs = 12 / camera.scale;
  ctx.font = `${fs}px "Pretendard", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (m.s > 0.05) ctx.fillText(`이격 ${fmtM(m.s)}`, plate.width / 2, -m.s / 2);
  if (m.n > 0.05) ctx.fillText(`이격 ${fmtM(m.n)}`, plate.width / 2, plate.depth + m.n / 2);
  if (m.w > 0.05) {
    ctx.save();
    ctx.translate(-m.w / 2, plate.depth / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`이격 ${fmtM(m.w)}`, 0, 0);
    ctx.restore();
  }
  if (m.e > 0.05) {
    ctx.save();
    ctx.translate(plate.width + m.e / 2, plate.depth / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`이격 ${fmtM(m.e)}`, 0, 0);
    ctx.restore();
  }
  // 주차장 외벽(실선)과 구분 — 다각형
  ctx.strokeStyle = "#1e293b";
  ctx.lineWidth = 2 / camera.scale;
  ctx.beginPath();
  poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/** 균일 바깥 오프셋(마이터). 실패 시 bbox 확장. */
function offsetOutwardApprox(poly, dist) {
  if (!(dist > 0) || !poly?.length) return poly || [];
  const n = poly.length;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const prev = poly[(i - 1 + n) % n];
    const cur = poly[i];
    const next = poly[(i + 1) % n];
    const e1 = { x: cur.x - prev.x, y: cur.y - prev.y };
    const e2 = { x: next.x - cur.x, y: next.y - cur.y };
    const L1 = Math.hypot(e1.x, e1.y) || 1;
    const L2 = Math.hypot(e2.x, e2.y) || 1;
    // CCW 오른쪽 = 바깥
    const n1 = { x: e1.y / L1, y: -e1.x / L1 };
    const n2 = { x: e2.y / L2, y: -e2.x / L2 };
    const bis = { x: n1.x + n2.x, y: n1.y + n2.y };
    const bl = Math.hypot(bis.x, bis.y);
    if (bl < 1e-6) {
      out.push({ x: cur.x + n1.x * dist, y: cur.y + n1.y * dist });
      continue;
    }
    const dot = Math.max(-0.999, Math.min(0.999, (n1.x * bis.x + n1.y * bis.y) / bl));
    const scale = dist / Math.max(0.2, dot);
    out.push({ x: cur.x + (bis.x / bl) * scale, y: cur.y + (bis.y / bl) * scale });
  }
  return out;
}

function fmtM(v) {
  const n = Number(v);
  return `${Number.isInteger(n) ? n : n.toFixed(1)}m`;
}

/** 코어 내부 승강기·계단·전실·출입문 표시. */
function drawCoreInterior(ctx, interior, scale) {
  if (!interior) return;
  const lw = 1.1 / (scale || 12);
  if (interior.lobby) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
    ctx.fillRect(interior.lobby.x, interior.lobby.y, interior.lobby.w, interior.lobby.d);
  }
  (interior.elevators || []).forEach((el) => {
    ctx.fillStyle = "rgba(30, 30, 30, 0.55)";
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = lw;
    ctx.fillRect(el.x, el.y, el.w, el.d);
    ctx.strokeRect(el.x, el.y, el.w, el.d);
    // 카 문 힌트
    ctx.strokeStyle = "#94a3b8";
    ctx.beginPath();
    ctx.moveTo(el.x + el.w * 0.15, el.y + el.d * 0.08);
    ctx.lineTo(el.x + el.w * 0.85, el.y + el.d * 0.08);
    ctx.stroke();
    label(ctx, el.label || "EL", el.x + el.w / 2, el.y + el.d / 2, "#f8fafc");
  });
  if (interior.stair) {
    const st = interior.stair;
    ctx.fillStyle = "rgba(100, 116, 139, 0.25)";
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = lw;
    ctx.fillRect(st.x, st.y, st.w, st.d);
    ctx.strokeRect(st.x, st.y, st.w, st.d);
    const steps = 5;
    ctx.strokeStyle = "#64748b";
    for (let i = 1; i < steps; i += 1) {
      const t = i / steps;
      ctx.beginPath();
      if (st.w >= st.d) {
        ctx.moveTo(st.x + st.w * t, st.y);
        ctx.lineTo(st.x + st.w * t, st.y + st.d);
      } else {
        ctx.moveTo(st.x, st.y + st.d * t);
        ctx.lineTo(st.x + st.w, st.y + st.d * t);
      }
      ctx.stroke();
    }
    label(ctx, "계단", st.x + st.w / 2, st.y + st.d / 2, "#334155");
  }
  if (interior.door) {
    const d = interior.door;
    ctx.strokeStyle = "#0f766e";
    ctx.lineWidth = 2.4 / (scale || 12);
    ctx.beginPath();
    if (d.w >= d.d) {
      ctx.moveTo(d.x, d.y + d.d / 2);
      ctx.lineTo(d.x + d.w, d.y + d.d / 2);
    } else {
      ctx.moveTo(d.x + d.w / 2, d.y);
      ctx.lineTo(d.x + d.w / 2, d.y + d.d);
    }
    ctx.stroke();
  }
}

function overlayImage() {
  const url = state.overlay?.url;
  if (!url) return null;
  if (!overlayCache.has(url)) {
    const image = new Image();
    image.src = url;
    image.onload = () => requestDraw();
    overlayCache.set(url, image);
  }
  const image = overlayCache.get(url);
  return image.complete && image.width ? image : null;
}

function drawOverlay(ctx, plate) {
  if (state.overlay.mode !== "overlay") return;
  const image = overlayImage();
  if (!image) return;
  const width = plate.width * (state.overlay.scale || 1);
  const height = width * (image.height / image.width);
  ctx.save();
  ctx.globalAlpha = state.overlay.opacity || 0.4;
  ctx.translate(state.overlay.x || 0, (state.overlay.y || 0) + height);
  ctx.scale(1, -1);
  ctx.drawImage(image, 0, 0, width, height);
  ctx.restore();
}

export function drawThumb(canvas, model) {
  const ctx = canvas.getContext("2d");
  const width = 154;
  const height = 96;
  const ratio = 2;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = "#f6f1e8";
  ctx.fillRect(0, 0, width, height);
  const plate = model.plate;
  if (!plate) return;
  const boxes = (model.ramps || []).map((ramp) => rampFootprint(ramp, plate));
  const minX = Math.min(0, ...boxes.map((box) => box.x));
  const minY = Math.min(0, ...boxes.map((box) => box.y));
  const maxX = Math.max(plate.width, ...boxes.map((box) => box.x + box.w));
  const maxY = Math.max(plate.depth, ...boxes.map((box) => box.y + box.d));
  const scale = Math.min((width - 10) / (maxX - minX), (height - 10) / (maxY - minY));
  ctx.translate(5 - minX * scale, height - 5 + minY * scale);
  ctx.scale(scale, -scale);
  ctx.fillStyle = "#fbfaf7";
  ctx.fillRect(0, 0, plate.width, plate.depth);
  ctx.fillStyle = "#eadcc4";
  (model.aisles || []).forEach((aisle) => ctx.fillRect(aisle.x, aisle.y, aisle.w, aisle.d));
  ctx.strokeStyle = "#8d877c";
  ctx.lineWidth = 1 / scale;
  (model.stalls || []).forEach((stall) => ctx.strokeRect(stall.x, stall.y, stall.w, stall.d));
  ctx.fillStyle = "rgba(44, 74, 110, 0.35)";
  (model.cores || []).forEach((core) => ctx.fillRect(core.x, core.y, core.w, core.d));
  ctx.fillStyle = "rgba(168, 116, 42, 0.45)";
  boxes.forEach((box) => ctx.fillRect(box.x, box.y, box.w, box.d));
  ctx.strokeStyle = "#1e1a16";
  ctx.setLineDash(model.ramps?.some((ramp) => ramp.placement === "external") ? [0.8, 0.5] : []);
  ctx.strokeRect(0, 0, plate.width, plate.depth);
}

function paintNorth(ctx, rect) {
  ctx.save();
  ctx.translate(rect.width - 42, 46);
  ctx.strokeStyle = "#1e1a16";
  ctx.fillStyle = "#1e1a16";
  ctx.beginPath();
  ctx.moveTo(0, 16);
  ctx.lineTo(0, -14);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -16);
  ctx.lineTo(5, -6);
  ctx.lineTo(-5, -6);
  ctx.fill();
  ctx.font = "12px Segoe UI, Malgun Gothic, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("N", 0, -26);
  ctx.restore();
}
