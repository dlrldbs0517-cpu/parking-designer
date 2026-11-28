import { CLEAR_HEIGHT, SLAB_T, clearHeightOf, requiredClearHeight, minStraightRampLength, rampPositionCheck, rampShape, rampTransitions, recommendCoreCells, stallsPerBay, edgeGap } from "./layout.js?v=365";
import { housingAreaDivisor, uses, zoneFactors, zoneUseStatus } from "./parkingRules.js?v=365";
import { drawThumb, invalidatePlanFit, mountPlan } from "./plan.js?v=365";
import { stallRuleTargets } from "./stallTypes.js?v=365";
import {
  plateDimsFromPolygon, presetChamferRect, presetL, presetTrapezoid, presetU,
  rectPolygon, validatePolygon, normalizePolygon, offsetPolygon, polygonArea, edgeLengths,
} from "./polygon.js?v=365";
import { eumLandUrl, localizer, lookupZoning, lookupZoningAt, outerRings, parcelAt, regionFromAddress, roadAccess } from "./zoning.js?v=365";
import { openSketch, closeSketch, sketchOpen } from "./sketch.js?v=365";
import { addBuilding, addCore, addStairCore, applyVariant, autoPlaceCore, buildingOfCore, clearParkPolygon, coreLabel, currentStallRules, demandResult, editRampModules, emit, generatePlate, loadReference, optimizeLayout, parseSpans, placeOverlapExample, placeSplitExample, pinLowerRampOverrides, preparePlateShell, readyFor3d, issueGroups, rampFallback, rampModuleInfo, recommendLayouts, removeBuilding, removeSelection, rotateSelectedRamp, totalStallShortages, gridCombos, adoptGridResults, axisGridCandidates, applyGridChoice, setGridOptions, gridKeyNow, snapAllCores, centeredGrid, selectCore, selectItem, selectedOpening, selectedRamp, setParkPolygon, setReveal, setSiteType, setStep, setTool, state, subscribe, summary, syncPlateMeta, updateBuilding, updateCore, updateCoreArea, updateEntranceWidth, updateRampSize, updateSiteMargins, plateFromState, rebuildLayout } from "./state.js?v=365";
let lastFitSlide = 0;   // 평면 카메라 맞춤을 마지막으로 한 단계

// 시트·DXF·주변지도는 클릭 시에만 불러 초기 로딩을 줄인다.
let sheetMod = null;
let dxfMod = null;
let contextMod = null;
const loadSheet = () => (sheetMod ||= import("./sheet.js?v=365"));
const loadDxf = () => (dxfMod ||= import("./dxfExport.js?v=365"));
const loadContext = () => (contextMod ||= import("./context.js?v=365"));
async function closeContext() {
  const m = await loadContext();
  return m.closeContext();
}

const $ = (id) => document.getElementById(id);
const edgeName = { s: "남", n: "북", w: "서", e: "동" };
let wizardSlide = 1;
let wizardAnimating = false;
const WIZARD_MAX = 8;
const WIZARD_LABELS = {
  1: "주소를 입력한 뒤 다음으로 진행하세요.",
  2: "용도와 건물 형태를 고른 뒤 다음으로 진행하세요.",
  3: "주차장 크기·기둥 간격·층고를 정하세요.",
  4: "도로가 접한 변과 대지 이격을 고르세요.",
  5: "램프를 배치하고 왼쪽 평면에서 위치를 조정하세요.",
  6: "코어를 배치하고 왼쪽 평면에서 위치를 조정하세요.",
  7: "추천 주차 배치 3안을 고르세요.",
  8: "선택한 배치의 평면·3D·평면도를 확인하세요.",
};

const fields = {
  width: $("park-width"),
  depth: $("park-depth"),
  spacing: $("column-spacing"),
  coreArea: $("core-area"),
  coreW: $("core-w"),
  coreD: $("core-d"),
  coreX: $("core-x"),
  coreY: $("core-y"),
  entranceWidth: $("entrance-width"),
  rampWidth: $("ramp-width"),
  rampLength: $("ramp-length"),
};

buildDemandForm();
fields.width.addEventListener("input", () => {
  state.sizeSet = true;
  state.parkWidth = numberOr(fields.width.value, state.parkWidth);
  render();
});
fields.depth.addEventListener("input", () => {
  state.sizeSet = true;
  state.parkDepth = numberOr(fields.depth.value, state.parkDepth);
  render();
});
fields.spacing.addEventListener("input", () => {
  if (document.activeElement === fields.spacing && Number(fields.spacing.value) !== state.columnSpacing) state.columnAuto = false;
  state.columnSpacing = numberOr(fields.spacing.value, state.columnSpacing);
  render();
});
$("column-size").addEventListener("input", () => {
  const size = numberOr($("column-size").value, state.columnWidth);
  state.columnWidth = size;
  state.columnDepth = size;
  render();
});
$("wall-columns").addEventListener("change", () => {
  state.wallColumns = $("wall-columns").value;
  render();
});
$("min-clear").addEventListener("input", () => {
  state.minClear = numberOr($("min-clear").value, state.minClear);
  render();
});
$("no-ground-access").addEventListener("change", () => {
  state.noGroundAccess = $("no-ground-access").checked;
  render();
});
$("floor-height").addEventListener("input", () => {
  state.floorHeight = numberOr($("floor-height").value, state.floorHeight);
  render();
});
$("spans-x").addEventListener("input", () => {
  state.spansX = $("spans-x").value;
  render();
});
$("spans-y").addEventListener("input", () => {
  state.spansY = $("spans-y").value;
  render();
});
$("trim-dead").addEventListener("change", () => {
  state.trimDeadEnds = $("trim-dead").checked;
  render();
});
$("stall-types").addEventListener("change", () => {
  state.stallRules = { ...state.stallRules, disabled: $("stall-types").checked };
  render();
});
$("disabled-rate").addEventListener("change", () => {
  state.stallRules = { ...state.stallRules, disabledRate: Number($("disabled-rate").value) };
  render();
});
$("parallel-fill").addEventListener("change", () => {
  state.stallRules = { ...state.stallRules, parallel: $("parallel-fill").checked };
  render();
});
$("eco-mode").addEventListener("change", () => {
  state.stallRules = { ...state.stallRules, ecoMode: $("eco-mode").value };
  render();
});
$("eco-rate").addEventListener("change", () => {
  const pct = Math.min(20, Math.max(1, Number($("eco-rate").value) || 5));
  $("eco-rate").value = pct;
  state.stallRules = { ...state.stallRules, ecoRate: pct / 100 };
  render();
});
function bindMarginInput(id, key) {
  const el = $(id);
  if (!el) return;
  el.addEventListener("input", () => {
    if (key) {
      const v = el.value.trim();
      updateSiteMargins(null, { [key]: v === "" ? null : Math.max(0, numberOr(v, 0)) });
    } else {
      updateSiteMargins(numberOr(el.value, state.siteMargin));
    }
  });
}
bindMarginInput("site-margin", null);
bindMarginInput("site-margin-step4", null);
["n", "s", "e", "w"].forEach((k) => {
  bindMarginInput(`margin-${k}`, k);
  bindMarginInput(`margin-${k}-step4`, k);
});
$("open-margin-dialog")?.addEventListener("click", () => $("margin-dialog").showModal());
$("close-margin-dialog")?.addEventListener("click", () => { $("margin-dialog").close(); render(); });
/** 5·6단계는 셸만, 주차 칸이 있으면 재배치. */
function refreshPlateAfterOption() {
  if (!state.plate) {
    render();
    return;
  }
  if (state.variants?.length || (state.stalls && state.stalls.length)) {
    optimizeLayout({ refresh: false });
    emit();
    return;
  }
  preparePlateShell({ replaceCores: false });
}
$("road-edge").addEventListener("change", () => {
  state.roadEdge = $("road-edge").value;
  if (state.plate) {
    state.plate = { ...state.plate, roadEdge: state.roadEdge };
    refreshPlateAfterOption();
  } else {
    render();
  }
});
$("ramp-pos").addEventListener("change", () => {
  state.rampPos = $("ramp-pos").value;
  if (state.plate) {
    state.plate = { ...state.plate, rampPos: state.rampPos };
    refreshPlateAfterOption();
  } else {
    render();
  }
});

// 도로 변에 따라 램프 위치 이름을 바꾼다: 남·북 변 → 왼쪽/가운데/오른쪽, 서·동 변 → 아래쪽/가운데/위쪽
function rampPosOptions(edge) {
  const horizontal = edge === "n" || edge === "s";
  return [
    ["auto", "자동"],
    ["start", horizontal ? "왼쪽" : "아래쪽"],
    ["mid", "가운데"],
    ["end", horizontal ? "오른쪽" : "위쪽"],
  ];
}

// 위치마다 램프가 들어가는지 미리 확인해 선택칸·칩에 "(불가)"처럼 표시한다.
let rampCheckKey = "";
let rampCheck = {};
function renderRampPos() {
  const select = $("ramp-pos");
  const chips = $("ramp-pos-choice");
  if (!select) return;
  const plate = plateFromState();
  const key = [state.roadEdge, plate.width, plate.depth, plate.spacing, state.floorHeight, state.rampPlacement, plate.legalStalls].join("|");
  if (key !== rampCheckKey) {
    rampCheckKey = key;
    // 도로변 위치(시작·가운데·끝) 미리 검사는 위치마다 주차 배치를 통째로 돌려 큰 평면에서 10초 넘게 걸림.
    // 지금은 사용자가 시작점을 직접 찍으므로(이 선택칸은 숨김) 검사하지 않는다.
    rampCheck = {};
    const opts = rampPosOptions(state.roadEdge);
    select.innerHTML = opts.map(([value, label]) => {
      const why = rampCheck[value];
      return `<option value="${value}">${label}${why ? ` (불가: ${why})` : ""}</option>`;
    }).join("");
    if (chips) {
      chips.innerHTML = opts.map(([value, label]) => {
        const why = rampCheck[value];
        const blocked = Boolean(why);
        return `<button type="button" data-value="${value}"${blocked ? ` title="불가: ${why}"` : ""}>${label}${blocked ? " ·불가" : ""}</button>`;
      }).join("");
      chips.querySelectorAll("button[data-value]").forEach((button) => {
        button.addEventListener("click", () => {
          select.value = button.dataset.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        });
      });
    }
  }
  if (document.activeElement !== select) select.value = state.rampPos;
  if (chips) {
    chips.querySelectorAll("button[data-value]").forEach((button) => {
      button.classList.toggle("on", button.dataset.value === state.rampPos);
    });
  }
  const why = rampCheck[state.rampPos];
  const allBlocked = state.rampPlacement === "internal" && ["start", "mid", "end"].every((pos) => rampCheck[pos]);
  const fb = allBlocked ? rampFallback(plate) : null;
  $("ramp-pos-note").textContent = allBlocked
    ? (fb
      ? `도로변 어디에도 내부 램프가 들어가지 않습니다(${why}). 평면을 만들면 옆 변의 도로 쪽 끝에 램프를 둡니다.`
      : `도로변 어디에도 내부 램프가 들어가지 않습니다(${why}). 외부 램프를 고르거나 평면 크기를 바꾸세요.`)
    : why
      ? `이 크기에서는 이 위치에 램프가 들어가지 않습니다(${why}). 자동이나 다른 위치를 고르세요.`
      : "";
}
/** 출입/층간 형태만 바꿀 때 — 셸 재생성 없이 화면만 갱신(층간 위치 유지). */
function refreshRampFormsOnly() {
  syncPlateMeta();
  if (state.stalls?.length || state.variants?.length) {
    optimizeLayout({ refresh: false });
  } else {
    // 셸: 코어가 새 램프 경로를 막지 않게 정리
    rebuildLayout();
  }
  emit();
  requestAnimationFrame(() => invalidatePlanFit());
}
$("ramp-form").addEventListener("change", () => {
  // 출입 형태를 바꿔도 층간 위치가 따라가지 않도록 먼저 고정
  pinLowerRampOverrides();
  state.rampForm = $("ramp-form").value;
  const outerForms = ["outer9090", "outer180", "spiral"];
  if (outerForms.includes(state.rampForm) && state.rampPlacement !== "external") {
    const margin = Math.max(
      Number(state.siteMargin) || 0,
      Number(state.siteMargins?.w) || 0,
      Number(state.siteMargins?.e) || 0,
      Number(state.siteMargins?.n) || 0,
      Number(state.siteMargins?.s) || 0,
    );
    if (margin >= 6.5) {
      state.rampPlacement = "external";
      if ($("ramp-placement")) $("ramp-placement").value = "external";
    }
  }
  state.ramps = (state.ramps || []).map((r) => {
    const next = {
      ...r,
      form: state.rampForm,
      placement: state.rampPlacement,
      // 모듈 사슬을 지워도 길이는 남김(없으면 '자동'이 직선/곡선을 못 고름) — 법정 최소 이상
      length: Math.max(Number(r.length || r.legacy?.length) || 0, autoRampLength()),
    };
    delete next.modules;
    delete next.x;
    delete next.y;
    delete next.heading;
    delete next.legacy;
    // 내부 직선+90°가 지금 자리(t)에서 안 들어가면(꺾은 뒤 직선이 짧음) 옆벽 쪽으로 붙여 들어가는 자리를 찾음
    if (state.plate && next.placement !== "external" && next.form === "curve90") {
      try {
        if (rampShape(next, state.plate).ok === false) {
          const along = next.edge === "n" || next.edge === "s" ? state.plate.width : state.plate.depth;
          const half = Math.max(6.5, next.width || 6) / 2;
          for (const t of [half, along - half]) {
            if (rampShape({ ...next, t }, state.plate).ok !== false) { next.t = t; break; }
          }
        }
      } catch (_) { /* 그대로 */ }
    }
    return next;
  });
  refreshRampFormsOnly();
});
state.lowerRampForm = "auto";   // 층간 형태 선택칸 없앰 → 항상 자동
$("grid-recalc")?.addEventListener("click", () => {
  state.gridKey = "";
  state.columnAuto = true;
  busy("램프 위치에 맞는 기둥 격자를 찾는 중…", () => {}, searchGridsParallel, null);
});
$("grid-manual")?.addEventListener("click", () => {
  state.columnAuto = false;
  if ($("column-auto")) $("column-auto").checked = false;
  // 지금 쓰는 격자를 입력칸에 채워 두고 연다
  if ($("spans-x")) $("spans-x").value = state.spansX || "";
  if ($("spans-y")) $("spans-y").value = state.spansY || "";
  $("column-dialog").showModal();
});
/** 코어 단계에서 직접 입력한 간격을 평면 격자에 반영하고 코어를 새 격자 칸에 맞춤 */
function applyManualSpans() {
  if (!state.plate) return;
  const sx = parseSpans(state.spansX);
  const sy = parseSpans(state.spansY);
  if (sx.error || sy.error) return;
  const def = [Number(state.columnSpacing) || 8.1];
  state.plate = { ...state.plate, spansX: sx.values || def, spansY: sy.values || def };
  state.gridChosen = -1;
  snapAllCores();
}
function renderGridChoices() {
  const box = $("grid-choices");
  if (!box) return;
  const opts = state.gridOptions || [];
  if (!state.columnAuto || !opts.length) {
    box.innerHTML = "";
    $("grid-note").textContent = state.columnAuto
      ? "코어 단계에 들어오면 램프 위치에 맞는 격자를 계산해요."
      : `직접 입력한 간격: 가로 ${state.spansX || state.columnSpacing} / 세로 ${state.spansY || state.columnSpacing}`;
    return;
  }
  const best = Math.max(...opts.map((o) => o.stalls || 0));
  box.innerHTML = opts.map((o, i) => `<button type="button" data-i="${i}" class="grid-chip${i === state.gridChosen ? " on" : ""}">
    <div><b>가로 ${o.cx.label}</b> × <b>세로 ${o.cy.label}</b></div><span>층당 약 ${o.stalls}대${o.stalls === best ? " · 최다" : ""}${o.valid ? "" : " · 검사 미통과"}</span></button>`).join("");
  box.querySelectorAll("button[data-i]").forEach((b) => b.addEventListener("click", () => applyGridChoice(Number(b.dataset.i))));
  $("grid-note").textContent = "대수는 코어를 그 격자 칸에 맞춰 놓았을 때 예상치예요. 격자를 고르면 코어도 그 자리로 옮겨지고, 그다음 끌어서 다른 칸으로 옮길 수 있어요.";
}
$("column-auto")?.addEventListener("change", () => {
  state.columnAuto = $("column-auto").checked;
  if (!state.columnAuto) { state.spansX = ""; state.spansY = ""; }   // 직접 입력으로 돌아가면 자동이 고른 격자는 지움
  if (state.plate) { state.plate = plateFromState(); syncPlateMeta(); }
  emit();
});
$("lower-ramp-form").addEventListener("change", () => {
  // 층간 형태만 변경 — 출입·층간 위치 유지
  pinLowerRampOverrides();
  state.lowerRampForm = $("lower-ramp-form").value;
  const outerForms = ["outer9090", "outer180", "spiral"];
  if (outerForms.includes(state.lowerRampForm)) {
    Object.keys(state.lowerRampOverrides || {}).forEach((id) => {
      state.lowerRampOverrides[id] = {
        ...state.lowerRampOverrides[id],
        placement: "external",
      };
    });
    // 덮어쓰기가 아직 없으면 지금 고정본에 external 반영
    pinLowerRampOverrides();
    Object.keys(state.lowerRampOverrides || {}).forEach((id) => {
      if (!state.lowerRampOverrides[id].placement) {
        state.lowerRampOverrides[id].placement = "external";
      }
    });
  }
  refreshRampFormsOnly();
});
// 평면에 출입·층간 램프 중 무엇을 보일지(겹쳐 보이지 않게). 고치는 쪽으로 자동 전환.
function setRampView(v) {
  if (v === "both") v = "entry";
  state.rampView = v;
  if ($("entry-ramp-fields")) $("entry-ramp-fields").hidden = v === "lower";
  if ($("lower-ramp-fields")) $("lower-ramp-fields").hidden = v !== "lower";
  if ($("ramp-view")) $("ramp-view").value = v;
  document.querySelectorAll('.choice[data-for="ramp-view"] button').forEach((b) => b.classList.toggle("on", b.dataset.value === v));
}
$("ramp-view")?.addEventListener("change", () => { setRampView($("ramp-view").value); render(); });
$("ramp-form").addEventListener("change", () => { if (state.rampView !== "both") setRampView("entry"); });
$("lower-ramp-form").addEventListener("change", () => { if (state.rampView !== "both") setRampView("lower"); });
$("lower-ramp-mode").addEventListener("change", () => { if (state.rampView !== "both") setRampView("lower"); });
$("lower-ramp-mode").addEventListener("change", () => {
  // 층간 위치 모드를 바꾸면 덮어쓰기 초기화 후 새 파생 위치 적용
  state.lowerRampMode = $("lower-ramp-mode").value;
  state.lowerRampOverrides = {};
  refreshRampFormsOnly();
});
const OUTER_ONLY = ["outer9090", "outer180", "spiral"];
$("ramp-placement").addEventListener("change", () => {
  pinLowerRampOverrides();
  state.rampPlacement = $("ramp-placement").value;
  // 내부로 바꾸면 외부 전용 형태(90·직선·90, 180°)는 자동으로
  if (state.rampPlacement !== "external") {
    if (OUTER_ONLY.includes(state.rampForm)) { $("ramp-form").value = "auto"; $("ramp-form").dispatchEvent(new Event("change")); }
    if (OUTER_ONLY.includes(state.lowerRampForm)) { $("lower-ramp-form").value = "auto"; $("lower-ramp-form").dispatchEvent(new Event("change")); }
  }
  state.ramps = (state.ramps || []).map((r) => ({
    ...r,
    placement: state.rampPlacement,
  }));
  if (state.plate) state.plate = { ...state.plate, rampPlacement: state.rampPlacement };
  refreshRampFormsOnly();
});
$("entrance-mode").addEventListener("change", () => {
  state.entranceMode = $("entrance-mode").value;
  render();
});
$("circulation").addEventListener("change", () => {
  state.circulation = $("circulation").value;
  render();
});
// 무거운 계산(배치안 여러 개 생성) 동안 "만드는 중" 표시. 화면이 먼저 그려지도록 한 프레임 쉰 뒤 계산한다.
let busyNow = false;
// 계산은 작업자 스레드(worker.js)에서 — 화면이 안 멈추고 걸린 시간·취소가 보임.
// op가 없거나 작업자가 실패하면 예전처럼 화면에서 계산.
let worker = null;
let workerSeq = 0;
function runInWorker(op, args = []) {
  return new Promise((resolve, reject) => {
    try {
      if (!worker) worker = new Worker(new URL("./worker.js?v=365", import.meta.url), { type: "module" });
    } catch (error) { reject(error); return; }
    const id = ++workerSeq;
    let snap;
    try { snap = structuredClone(state); } catch (error) { reject(error); return; }
    const off = () => { worker.removeEventListener("message", onMsg); worker.removeEventListener("error", onErr); };
    const onMsg = (e) => {
      if (e.data.id !== id) return;
      off();
      if (e.data.ok) resolve(e.data.snap); else reject(new Error(e.data.error));
    };
    const onErr = (e) => { off(); worker.terminate(); worker = null; reject(e.message || e); };
    worker.addEventListener("message", onMsg);
    worker.addEventListener("error", onErr);
    worker.postMessage({ id, op, snap, args });
  });
}
// 기둥 간격 자동 추천: 조합을 작업자 여러 개에 나눠 동시에 계산
let gridPool = [];
function stopGridPool() { gridPool.forEach((w) => { try { w.terminate(); } catch (e) { /* 무시 */ } }); gridPool = []; }
function callGridWorker(w, op, snap, args) {
  return new Promise((resolve, reject) => {
    const id = ++workerSeq;
    const onMsg = (e) => {
      if (e.data.id !== id) return;
      w.removeEventListener("message", onMsg);
      if (e.data.ok) resolve((e.data.snap && e.data.snap.gridResults) || []); else reject(new Error(e.data.error));
    };
    w.addEventListener("message", onMsg);
    w.addEventListener("error", (e) => reject(e.message || e), { once: true });
    w.postMessage({ id, op, snap, args });
  });
}
async function searchGridsParallel() {
  if (!state.plate) preparePlateShell();
  else syncPlateMeta();
  const snap0 = structuredClone(state);
  snap0.coreSet = false;   // 후보 비교 땐 엔진이 코어 자리를 잡게(코어는 격자를 고른 뒤 놓음)
  snap0.variants = []; snap0.stalls = [];
  const n = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
  stopGridPool();
  gridPool = Array.from({ length: n }, () => new Worker(new URL("./worker.js?v=365", import.meta.url), { type: "module" }));
  const runBatch = async (combos) => {
    const chunks = Array.from({ length: n }, () => []);
    combos.forEach((c, i) => chunks[i % n].push(c));
    const parts = await Promise.all(chunks.map((c, i) => (c.length ? callGridWorker(gridPool[i], "gridBatch", snap0, [c]) : [])));
    return parts.flat();
  };
  const strip = (c) => ({ seq: c.seq, label: c.label });
  const xs = axisGridCandidates(state.plate.width);
  const ys = axisGridCandidates(state.plate.depth);
  const ux = xs.filter((c) => c.kind === "u"); const mx = xs.filter((c) => c.kind === "m");
  const uy = ys.filter((c) => c.kind === "u"); const my = ys.filter((c) => c.kind === "m");
  // 아주 큰 평면(2,500㎡ 넘음)은 한 번 계산이 오래 걸려 후보 수를 줄인다
  const huge = state.plate.width * state.plate.depth > 2500;
  const stage1 = [];
  ux.forEach((cx, i) => uy.forEach((cy, j) => {
    if (huge && (i === 2 || j === 2)) return;   // 큰 평면: 8.2 반복은 빼고 기본·10.5만(4가지)
    stage1.push({ cx: strip(cx), cy: strip(cy) });
  }));
  const tStart = Date.now();
  const LIMIT = 20000;   // 큰 평면에서 너무 오래 걸리면 다음 단계를 줄인다
  busyLabel = `기둥 격자 찾는 중… (1/3 일정 간격 ${stage1.length}가지)`;
  const s1 = await runBatch(stage1);
  const best1 = s1.slice().sort((p, q) => q.score - p.score)[0];
  const stage2 = [];
  const bx = best1 ? best1.cx : strip(ux[0]); const by = best1 ? best1.cy : strip(uy[0]);
  mx.forEach((cx) => stage2.push({ cx: strip(cx), cy: by }));
  my.forEach((cy) => stage2.push({ cx: bx, cy: strip(cy) }));
  mx.slice(0, 2).forEach((cx) => my.slice(0, 2).forEach((cy) => stage2.push({ cx: strip(cx), cy: strip(cy) })));
  // 벽에서 띄운 격자(첫 기둥 줄을 벽에서 1.2~6m 안쪽 — 외벽·캔틸레버로 받음): 1단계 1등 간격 기준
  {
    const one = (c) => (c && c.seq && c.seq.length === 1 ? c.seq[0] : null);
    const ox = one(bx) ? centeredGrid(one(bx), state.plate.width - 2 * edgeGap(state.plate)) : null;
    const oy = one(by) ? centeredGrid(one(by), state.plate.depth - 2 * edgeGap(state.plate)) : null;
    const extra = [];
    if (ox) extra.push({ cx: ox, cy: by });
    if (oy) extra.push({ cx: bx, cy: oy });
    if (ox && oy) extra.push({ cx: ox, cy: oy });
    stage2.unshift(...extra);   // 앞에 둬서 큰 평면에서 줄여도 남게
  }
  // 1단계가 오래 걸린 큰 평면은 섞은 간격을 줄여서
  const took = Date.now() - tStart;
  const nExtra = stage2.filter((c) => /띄움/.test(c.cx.label) || /띄움/.test(c.cy.label)).length;
  const stage2b = (huge || took > LIMIT) ? stage2.slice(0, nExtra) : (took > LIMIT / 2 ? stage2.slice(0, Math.max(nExtra + 2, Math.ceil(stage2.length / 3))) : stage2);
  busyLabel = `기둥 격자 찾는 중… (2/3 섞은 간격 ${stage2b.length}가지)`;
  const s2 = stage2b.length ? await runBatch(stage2b) : [];
  // 3단계(확인): 상위 6개 격자는 코어를 격자 칸에 맞춰 고정한 채 다시 계산 → 실제 놓일 모양 기준으로 순위
  const all12 = s1.concat(s2).sort((p, q) => q.score - p.score);
  const seenK = new Set();
  const top6 = all12.filter((r) => { const k = `${r.cx.label}|${r.cy.label}`; if (seenK.has(k)) return false; seenK.add(k); return true; })
    .slice(0, huge ? 2 : (Date.now() - tStart > LIMIT ? 3 : 6)).map((r) => ({ cx: r.cx, cy: r.cy, cores: r.cores }));
  busyLabel = `기둥 격자 찾는 중… (3/3 코어를 칸에 맞춰 확인 ${top6.length}가지)`;
  const chunks3 = Array.from({ length: n }, () => []);
  top6.forEach((c, i) => chunks3[i % n].push(c));
  const v3 = (await Promise.all(chunks3.map((c, i) => (c.length ? callGridWorker(gridPool[i], "gridVerify", snap0, [c]) : [])))).flat();
  stopGridPool();
  setGridOptions(v3.length ? v3 : s1.concat(s2));
  if (state.gridOptions && state.gridOptions.length) applyGridChoice(0);
}

async function recommendParallel() {
  if (!state.plate) preparePlateShell();
  else syncPlateMeta();
  const n = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
  const snap = structuredClone(state);
  stopGridPool();
  gridPool = Array.from({ length: n }, () => new Worker(new URL("./worker.js?v=365", import.meta.url), { type: "module" }));
  const runBatch = async (combos) => {
    const chunks = Array.from({ length: n }, () => []);
    combos.forEach((c, i) => chunks[i % n].push(c));
    const parts = await Promise.all(chunks.map((c, i) => (c.length ? callGridWorker(gridPool[i], "gridBatch", snap, [c]) : [])));
    return parts.flat();
  };
  const strip = (c) => ({ seq: c.seq, label: c.label });
  const xs = axisGridCandidates(state.plate.width);
  const ys = axisGridCandidates(state.plate.depth);
  const ux = xs.filter((c) => c.kind === "u"); const mx = xs.filter((c) => c.kind === "m");
  const uy = ys.filter((c) => c.kind === "u"); const my = ys.filter((c) => c.kind === "m");
  // 1단계: 일정 간격끼리(3×3)
  const stage1 = [];
  ux.forEach((cx) => uy.forEach((cy) => stage1.push({ cx: strip(cx), cy: strip(cy) })));
  const s1 = await runBatch(stage1);
  const best1 = s1.slice().sort((p, q) => q.score - p.score)[0];
  // 2단계: 섞은 간격 — 반대 방향은 1단계 최고 격자 것과 짝지음 + 섞음끼리 상위 2×2
  const stage2 = [];
  const bx = best1 ? best1.cx : strip(ux[0]); const by = best1 ? best1.cy : strip(uy[0]);
  mx.forEach((cx) => stage2.push({ cx: strip(cx), cy: by }));
  my.forEach((cy) => stage2.push({ cx: bx, cy: strip(cy) }));
  mx.slice(0, 2).forEach((cx) => my.slice(0, 2).forEach((cy) => stage2.push({ cx: strip(cx), cy: strip(cy) })));
  const s2 = await runBatch(stage2);
  const scored = s1.concat(s2);
  const top = scored.slice().sort((p, q) => q.score - p.score).slice(0, 3);
  // 상위 3 격자는 부가 안(코어 인접·방향 통일 등)까지 전체로 다시 — 이것도 동시에
  const fulls = await Promise.all(top.map((t, i) => callGridWorker(gridPool[i % gridPool.length], "gridFull", snap, [{ cx: t.cx, cy: t.cy }])
    .catch(() => [])));
  stopGridPool();
  const fullByKey = {};
  fulls.forEach((r) => { const f = r && r[0]; if (f) fullByKey[`${f.cx.label}|${f.cy.label}`] = f.variants; });
  // 전체 계산 점수로 순위 갱신
  fulls.forEach((r) => { const f = r && r[0]; if (!f) return; const s = scored.find((x) => x.cx.label === f.cx.label && x.cy.label === f.cy.label); if (s && f.score > s.score) s.score = f.score; });
  if (!adoptGridResults(scored, fullByKey)) recommendLayouts();
}

let busyLabel = "";
function busy(label, work, op = null, after = null) {
  if (busyNow) return;
  busyNow = true;
  const overlay = $("busy");
  const t0 = Date.now();
  busyLabel = label;
  $("busy-text").textContent = label;
  overlay.hidden = false;
  document.body.classList.add("is-busy");
  const tick = setInterval(() => {
    const sec = Math.round((Date.now() - t0) / 1000);
    $("busy-text").textContent = sec >= 2 ? `${busyLabel} ${sec}초` : busyLabel;
  }, 500);
  const done = () => {
    clearInterval(tick);
    overlay.hidden = true;
    document.body.classList.remove("is-busy");
    busyNow = false;
  };
  const runHere = () => requestAnimationFrame(() => setTimeout(() => {
    try { work(); if (after) after(); } finally { done(); }
  }, 30));
  const cancel = $("busy-cancel");
  if (cancel) cancel.hidden = !op;
  if (!op) { runHere(); return; }
  let cancelled = false;
  if (cancel) cancel.onclick = () => {
    cancelled = true;
    if (worker) { worker.terminate(); worker = null; }
    stopGridPool();
    done();
  };
  if (typeof op === "function") {
    op().then(() => {
      if (cancelled) return;
      done();
      emit();
      if (after) after();
    }).catch((error) => {
      if (cancelled) return;
      stopGridPool();
      console.warn("동시 계산 실패 → 그대로 진행", error);
      done();
      emit();
      if (after) after();
    });
    return;
  }
  runInWorker(op).then((snap) => {
    if (cancelled) return;
    Object.assign(state, snap);
    done();
    emit();
    if (after) after();
  }).catch((error) => {
    if (cancelled) return;
    console.warn("작업자 계산 실패 → 화면에서 계산", error);
    runHere();
  });
}

$("load-reference").addEventListener("click", () => {
  busy("기준 사례 불러오는 중…", () => {
    loadReference();
    setWizard(5, { silent: true });
  });
});

$("generate").addEventListener("click", () => {
  if (!inputsValid()) return;
  busy("평면 준비 중…", () => {
    preparePlateShell();
    setWizard(5, { silent: true });
  });
});

function wizardStepFromSlide(slide) {
  if (slide <= 4) return 1;
  if (slide <= 6) return 2;
  if (slide === 7) return 2; // 추천 선택
  return 3; // 결과 슬라이드(8)
}

function canLeaveWizard(slide) {
  // 외곽을 그리지도, 크기를 정하지도 않았으면 3단계에서 못 넘어감
  if (slide === 3 && !(state.parkPolygon?.length >= 3 || state.sizeSet)) {
    $("input-error").textContent = "주차장 외곽을 먼저 그려 주세요 (또는 '법정 대수로 크기 추천' · '다른 방법으로 정하기').";
    $("input-error").hidden = false;
    return false;
  }
  if (slide === 5 && !state.rampStartSet && !state.referenceNotes?.length) {
    setRampView("entry");
    render();
    const h = $("ramp-start-hint");
    if (h) { h.textContent = "⚠ 먼저 왼쪽 평면을 클릭해 램프 시작점을 찍어 주세요"; h.classList.add("bad"); }
    return false;
  }
  if (slide === 3 && !inputsValid()) {
    $("input-error").hidden = false;
    return false;
  }
  return true;
}

function setWizard(next, { silent = false } = {}) {
  next = Math.max(1, Math.min(WIZARD_MAX, Number(next) || 1));
  // 4단계(도로·이격)는 램프 단계로 합쳐서 건너뜀
  if (next === 4) next = wizardSlide > 4 ? 3 : 5;
  if (wizardAnimating) return;
  if (next === wizardSlide && !silent) {
    render();
    return;
  }
  if (next > wizardSlide && !canLeaveWizard(wizardSlide)) return;
  // 외곽 그리기 창은 다른 단계로 가면 닫음
  if (sketchOpen()) { closeSketch(); closeContext(); }
  // 외곽 꼭짓점 편집 도구는 크기 단계에서만
  if (next !== 3 && state.tool === "platePoly") state.tool = "core";
  // 추천·결과에서 램프·코어 단계 이하로 돌아오면 주차 결과를 비움 → 거기서 끌 때마다 전체 재계산(버벅임) 안 함.
  // 다시 「다음」을 누르면 그때 새로 계산.
  if (next <= 6 && wizardSlide >= 7) {
    state.stalls = [];
    state.aisles = [];
    state.columns = [];
    state.drives = [];
    state.route = [];
    state.variants = [];
  }

  const enter = () => {
    const prev = wizardSlide;
    const curEl = document.querySelector(`.slide[data-slide="${prev}"]`);
    const nextEl = document.querySelector(`.slide[data-slide="${next}"]`);
    if (!nextEl) return;
    if (next === 8 && state.resultTab !== "sheet" && state.resultTab !== "model") {
      state.resultTab = "plan";
    }
    wizardAnimating = true;
    nextEl.hidden = false;
    if (curEl && prev !== next) {
      curEl.classList.add("leaving");
      curEl.classList.remove("on");
    }
    requestAnimationFrame(() => {
      nextEl.classList.add("on");
    });
    window.setTimeout(() => {
      if (curEl && prev !== next) {
        curEl.classList.remove("leaving", "on");
        curEl.hidden = true;
      }
      wizardSlide = next;
      state.step = wizardStepFromSlide(next);
      wizardAnimating = false;
      document.body.dataset.wizard = String(next);
      render();
      if (next === 3) showSiteMapForSize();
      if (next >= 4 && !$("context-view").hidden) closeContext();   // 3단계 지도가 램프 단계 평면을 가리지 않게
      if (next >= 5) {
        requestAnimationFrame(() => { const fit = $("fit"); if (fit) fit.click(); });
      }
    }, 360);
  };

  // 7단계: 램프·코어 설정이 끝난 뒤 주차장을 생성하고 추천 3안 탐색
  if (next === 7) {
    if (!inputsValid()) {
      setWizard(3, { silent: true });
      return;
    }
    busy("추천 주차 배치 3안을 고르는 중…", recommendLayouts, "recommend", enter);
    return;
  }

  // 6단계(코어): 들어갈 때 기둥 격자 후보를 계산(평면·램프가 바뀌었을 때만) → 1등 격자를 깔고 코어를 그 칸에 맞춤
  if (next === 6 && state.plate && wizardSlide < 6) {
    if (state.columnAuto && state.siteType !== "complex" && typeof Worker !== "undefined" && state.gridKey !== gridKeyNow()) {
      busy("램프 위치에 맞는 기둥 격자를 찾는 중…", () => {}, searchGridsParallel, enter);
      return;
    }
    snapAllCores();
  }

  // 5·6단계: 주차 칸 없이 평면·램프·코어 셸만 (생성은 6→7)
  if (next >= 5 && next <= 6 && !state.plate) {
    if (!inputsValid()) {
      setWizard(3, { silent: true });
      return;
    }
    busy("평면 준비 중…", () => {
      preparePlateShell();
      state.rampStartSet = false;
      enter();
    });
    return;
  }
  enter();
}

$("wizard-next").addEventListener("click", () => {
  if (wizardSlide >= WIZARD_MAX) {
    if (readyFor3d()) open3d();
    return;
  }
  setWizard(wizardSlide + 1);
});
$("wizard-back").addEventListener("click", () => setWizard(wizardSlide - 1));
document.querySelectorAll("#wizard-steps li").forEach((item) => {
  item.addEventListener("click", () => {
    const slide = Number(item.dataset.slide);
    if (slide < wizardSlide || (slide <= wizardSlide + 1) || (slide <= 4) || state.plate) {
      setWizard(slide);
    }
  });
});
if ($("plan-expand-hit")) $("plan-expand-hit").addEventListener("click", () => setWizard(Math.max(5, wizardSlide)));
if ($("collapse-plan")) $("collapse-plan").addEventListener("click", () => setWizard(Math.min(4, wizardSlide)));

document.querySelectorAll(".choice[data-for]").forEach((group) => {
  const select = $(group.dataset.for);
  if (!select) return;
  group.querySelectorAll("button[data-value]").forEach((button) => {
    button.addEventListener("click", () => {
      if (select.disabled) return;
      select.value = button.dataset.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      syncChoiceGroup(group, select.value);
    });
  });
});

$("size-presets")?.querySelectorAll("button[data-w]").forEach((button) => {
  button.addEventListener("click", () => {
    state.sizeSet = true;
    state.parkWidth = Number(button.dataset.w);
    state.parkDepth = Number(button.dataset.d);
    state.parkPolygon = null;
    state.plateShapeMode = "rect";
    render();
  });
});

function syncPlateShapeTabs() {
  const mode = state.plateShapeMode || "rect";
  $("plate-shape-tabs")?.querySelectorAll("button[data-shape]").forEach((b) => {
    b.classList.toggle("on", b.dataset.shape === mode);
  });
  if ($("plate-rect-fields")) $("plate-rect-fields").hidden = mode !== "rect";
  if ($("plate-draw-fields")) $("plate-draw-fields").hidden = mode !== "draw";
  if ($("plate-coords-fields")) $("plate-coords-fields").hidden = mode !== "coords";
  const err = $("plate-poly-error");
  if (err) {
    err.hidden = !state.platePolyError;
    err.textContent = state.platePolyError || "";
  }
  const stats = $("plate-draw-stats");
  if (stats && state.parkPolygon?.length) {
    const lens = edgeLengths(state.parkPolygon).map((L) => L.toFixed(1)).join(" · ");
    stats.textContent = `꼭짓점 ${state.parkPolygon.length} · 면적 ${polygonArea(state.parkPolygon).toFixed(1)}㎡ · 변 ${lens}m`;
  } else if (stats) stats.textContent = "";
  if (mode === "coords" && $("plate-coords") && document.activeElement !== $("plate-coords")) {
    const poly = state.parkPolygon || rectPolygon(state.parkWidth, state.parkDepth);
    $("plate-coords").value = poly.map((p) => `${p.x},${p.y}`).join("\n");
  }
}

$("plate-shape-tabs")?.querySelectorAll("button[data-shape]").forEach((button) => {
  button.addEventListener("click", () => {
    state.plateShapeMode = button.dataset.shape;
    if (state.plateShapeMode === "rect") {
      state.parkPolygon = null;
      state.platePolyError = "";
    } else if (!state.parkPolygon?.length) {
      state.parkPolygon = rectPolygon(state.parkWidth, state.parkDepth);
    }
    if (state.plateShapeMode === "draw") state.tool = "platePoly";
    render();
  });
});
$("plate-preset-l")?.addEventListener("click", () => {
  setParkPolygon(presetL(60, 40, 20, 20));
  state.plateShapeMode = "draw";
  render();
});
$("plate-preset-u")?.addEventListener("click", () => {
  setParkPolygon(presetU(60, 40, 12, 20));
  state.plateShapeMode = "draw";
  render();
});
$("plate-preset-trap")?.addEventListener("click", () => {
  setParkPolygon(presetTrapezoid(60, 40, 8));
  state.plateShapeMode = "draw";
  render();
});
$("plate-preset-chamfer")?.addEventListener("click", () => {
  const m = Number($("plate-chamfer-m")?.value) || 6;
  setParkPolygon(presetChamferRect(state.parkWidth || 48, state.parkDepth || 42, m));
  state.plateShapeMode = "draw";
  render();
});
// ── 지도·CAD식 외곽 그리기 (sketch.js) ──
// 대지 필지(경위도) → 조회 지점 기준 m 다각형 {x,y} (가장 큰 바깥 고리)
function parcelMeters(site, point) {
  if (!site || !site.geometry || !point) return null;
  const loc = localizer(point.x, point.y);
  const rings = outerRings(site.geometry).map((r) => r.map(loc));
  if (!rings.length) return null;
  const area = (r) => Math.abs(r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
  const ring = rings.sort((a, b) => area(b) - area(a))[0];
  const pts = ring.map(([x, y]) => ({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }));
  const a = pts[0]; const b = pts[pts.length - 1];
  if (pts.length > 1 && Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) pts.pop();
  return pts.length >= 3 ? pts : null;
}
const polyKey = (poly) => (poly || []).map((p) => `${(+p.x).toFixed(2)},${(+p.y).toFixed(2)}`).join(";");
async function openCadSketch() {
  const center = state.demand.sitePoint || null;
  let api = null;
  document.body.classList.add("sketch-open");
  if (center) {
    const cx = await loadContext();
    cx.openContext(center, state.demand.siteParcel || null, "map", state.demand.siteAddress || "", state.demand.siteAccess || null);
    try { api = await cx.mapDrawApi(); } catch (_) { api = null; }
  }
  // 이미 그린 외곽이 있으면 그 모양에서 시작(지도에 놓았던 자리 그대로)
  // (그리기 탭을 누르면 자동으로 깔리는 기본 사각형이면 빈 판에서 시작)
  const plain = (q) => q && q.length === 4 && q.every((a, i) => { const b = q[(i + 1) % 4]; return Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6; });
  const drawn = state.parkPolygonGeo && state.parkPolygon && state.parkPolygonGeo.key === polyKey(state.parkPolygon);
  const poly = state.parkPolygon?.length >= 3 && (drawn || !plain(state.parkPolygon)) ? state.parkPolygon : null;
  const geo = poly && state.parkPolygonGeo && state.parkPolygonGeo.key === polyKey(poly) ? state.parkPolygonGeo : null;
  openSketch({
    site: center ? state.demand.siteParcel : null,
    center,
    api,
    start: poly ? { pts: poly.map((p) => [p.x, p.y]), geo: geo ? { center: geo.center, pts: geo.pts } : null } : null,
    validate: (pts) => validatePolygon(normalizePolygon(pts.map(([x, y]) => ({ x, y }))) || []).join(" "),
    onDone: async (pts, g) => {
      const ok = setParkPolygon(pts.map(([x, y]) => ({ x, y })));
      state.plateShapeMode = "draw";
      if (ok && g) {
        state.parkPolygonGeo = { center: g.center, pts: g.pts, key: polyKey(state.parkPolygon) };
      } else if (ok) state.parkPolygonGeo = null;
      if (g) {
        const cx = await loadContext();
        cx.setParkOutlineGeo(state.parkPolygonGeo);
      } else await closeContext();
      render();
    },
  });
}
$("plate-cad-draw")?.addEventListener("click", () => { openCadSketch(); });
$("plate-map-draw")?.addEventListener("click", () => { openCadSketch(); });
$("ramp-map-peek")?.addEventListener("click", async () => {
  const c = state.demand.sitePoint;
  if (!c) return;
  const cx = await loadContext();
  cx.openContext(c, state.demand.siteParcel || null, "map", state.demand.siteAddress || "", state.demand.siteAccess || null);
  cx.setParkOutlineGeo(state.parkPolygonGeo && state.parkPolygon && state.parkPolygonGeo.key === polyKey(state.parkPolygon) ? state.parkPolygonGeo : null);
});
// 3단계에 들어오면 대지 지도(그린 외곽 포함)를 왼쪽에 띄움
async function showSiteMapForSize() {
  const c = state.demand.sitePoint;
  if (!c || sketchOpen()) return;
  const cx = await loadContext();
  cx.openContext(c, state.demand.siteParcel || null, "map", state.demand.siteAddress || "", state.demand.siteAccess || null);
  cx.setParkOutlineGeo(state.parkPolygonGeo && state.parkPolygon && state.parkPolygonGeo.key === polyKey(state.parkPolygon) ? state.parkPolygonGeo : null);
}
function syncMapDrawBox() {
  const btn = $("plate-map-draw");
  if (!btn) return;
  const onMap = Boolean(state.demand.sitePoint);
  const poly = state.parkPolygon;
  const plain = (q) => q && q.length === 4 && q.every((a, i) => { const b = q[(i + 1) % 4]; return Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6; });
  const drawn = (state.parkPolygonGeo && poly && state.parkPolygonGeo.key === polyKey(poly)) || (poly?.length >= 3 && !plain(poly));
  btn.textContent = `${onMap ? "대지 위에 " : ""}외곽 ${drawn ? "고치기" : "그리기"}`;
  const stats = $("plate-draw-stats");
  if (stats && !(poly?.length >= 3)) stats.textContent = `지금은 ${state.parkWidth} × ${state.parkDepth}m 직사각형입니다. 모양이 다르면 외곽을 그리세요.`;
}

$("plate-clear-poly")?.addEventListener("click", () => {
  clearParkPolygon();
  render();
});
$("plate-coords-apply")?.addEventListener("click", () => {
  const raw = $("plate-coords")?.value || "";
  const pts = raw.trim().split(/\n+/).map((line) => {
    const parts = line.trim().split(/[\s,，\t]+/).filter(Boolean);
    return { x: Number(parts[0]), y: Number(parts[1]) };
  }).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  setParkPolygon(pts);
  render();
});
$("plate-from-parcel")?.addEventListener("click", () => {
  const parcel = state.siteParcel || state.parcelPolygon;
  if (!parcel?.length) {
    state.platePolyError = "지도에서 대지 경계가 없습니다. 주소·필지를 먼저 조회하세요.";
    render();
    return;
  }
  const m = Math.max(
    Number(state.siteMargins?.n) || state.siteMargin || 0,
    Number(state.siteMargins?.s) || state.siteMargin || 0,
    Number(state.siteMargins?.e) || state.siteMargin || 0,
    Number(state.siteMargins?.w) || state.siteMargin || 0,
  ) || 3;
  const inset = offsetPolygon(parcel, m);
  if (!inset) {
    state.platePolyError = "이격 오프셋에 실패했습니다. 대지 형태가 너무 오목이거나 이격이 큽니다.";
    render();
    return;
  }
  setParkPolygon(inset);
  state.plateShapeMode = "draw";
  render();
});

$("floor-height-choice")?.querySelectorAll("button[data-value]").forEach((button) => {
  button.addEventListener("click", () => {
    state.floorHeight = Number(button.dataset.value);
    render();
  });
});

$("site-type-choice")?.querySelectorAll("button[data-value]").forEach((button) => {
  button.addEventListener("click", () => {
    const radio = document.querySelector(`input[name="site-type"][value="${button.dataset.value}"]`);
    if (!radio) return;
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
  });
});

document.querySelectorAll("#tools button").forEach((button) => {
  // 입구·출구 추가는 켜고 끄는 버튼. 끄면 기본(끌어 옮기기) 상태로 돌아간다.
  button.addEventListener("click", () => setTool(state.tool === button.dataset.tool ? "core" : button.dataset.tool));
});

fields.coreArea.addEventListener("change", () => updateCoreArea(Number(fields.coreArea.value)));
$("core-nx").addEventListener("change", () => updateCore({ nx: Number($("core-nx").value), ny: Number($("core-ny").value) }));
$("core-ny").addEventListener("change", () => updateCore({ nx: Number($("core-nx").value), ny: Number($("core-ny").value) }));
$("open-core-dialog").addEventListener("click", () => $("core-dialog").showModal());
$("auto-core").addEventListener("click", () => busy("코어 자리 찾는 중…", autoPlaceCore, "autoCore"));
$("close-core-dialog").addEventListener("click", () => $("core-dialog").close());
fields.coreW.addEventListener("change", () => updateCore({ w: Number(fields.coreW.value) }));
fields.coreD.addEventListener("change", () => updateCore({ d: Number(fields.coreD.value) }));
fields.coreX.addEventListener("change", () => updateCore({ x: Number(fields.coreX.value) }));
fields.coreY.addEventListener("change", () => updateCore({ y: Number(fields.coreY.value) }));
fields.entranceWidth.addEventListener("change", () => updateEntranceWidth(Number(fields.entranceWidth.value)));
fields.rampWidth.addEventListener("change", () => updateRampSize({ width: Number(fields.rampWidth.value) }));
$("open-ramp-dialog").addEventListener("click", () => $("ramp-dialog").showModal());
$("close-ramp-dialog").addEventListener("click", () => $("ramp-dialog").close());
$("ramp-auto").addEventListener("click", () => {
  const auto = autoRampLength();
  updateRampSize({ length: auto, width: autoRampWidth() });
});
$("ramp-add-straight")?.addEventListener("click", () => editRampModules("addStraight"));
$("ramp-add-turn-l")?.addEventListener("click", () => editRampModules("addTurnL"));
$("ramp-add-turn-r")?.addEventListener("click", () => editRampModules("addTurnR"));
$("ramp-del-module")?.addEventListener("click", () => editRampModules("remove"));
$("ramp-rotate")?.addEventListener("click", () => rotateSelectedRamp(1));
$("ramp-autofit")?.addEventListener("click", () => editRampModules("autoFit"));
$("ramp-mod-length")?.addEventListener("change", () => {
  const v = Number($("ramp-mod-length").value);
  if (Number.isFinite(v)) editRampModules("setLength", { length: v });
});
$("ramp-mod-radius")?.addEventListener("change", () => {
  const v = Number($("ramp-mod-radius").value);
  if (Number.isFinite(v)) editRampModules("setRadius", { radius: v });
});
$("ramp-mod-levels")?.addEventListener("change", () => {
  const v = Number($("ramp-mod-levels").value);
  if (Number.isFinite(v)) editRampModules("setLevels", { levels: v });
});
$("ramp-mod-mode")?.addEventListener("change", () => {
  editRampModules("setMode", { mode: $("ramp-mod-mode").value });
});
document.addEventListener("keydown", (event) => {
  const tag = (event.target && event.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if (event.key === "r" || event.key === "R") {
    if (selectedRamp()) { event.preventDefault(); rotateSelectedRamp(1); }
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    if (selectedRamp() && state.selection?.module != null) {
      event.preventDefault();
      editRampModules("remove");
    }
  }
});
// 램프 길이는 층고로 자동 고정(읽기 전용)

$("place-split").addEventListener("click", placeSplitExample);
$("place-overlap").addEventListener("click", placeOverlapExample);
$("add-core").addEventListener("click", addCore);
$("add-stair").addEventListener("click", () => addStairCore());
// 코어 삭제: 위 '선택'에서 고른 코어(또는 평면에서 누른 코어). 승강기 코어는 최소 1개 남김.
$("remove-core").addEventListener("click", () => {
  const i = state.coreIndex ?? 0;
  if (!state.cores?.[i]) return;
  selectItem({ type: "core", index: i });
  state.selection = { type: "core", index: i };
  removeSelection();
});
$("rotate-core")?.addEventListener("click", () => {
  const i = state.coreIndex ?? 0;
  const c = state.cores?.[i];
  if (!c) return;
  // 가로·세로를 바꾸고 중심은 그대로. 안쪽 배치는 새 모양 기준으로(문 면은 90° 돌림)
  const rotSide = { s: "e", e: "n", n: "w", w: "s" };
  const door = c.interiorEdit?.door?.side ? { side: rotSide[c.interiorEdit.door.side], u: c.interiorEdit.door.u } : null;
  const { interiorEdit, interior, doorSide, ...rest } = c;
  state.cores[i] = { ...rest, ...(door ? { interiorEdit: { door, items: {} } } : {}) };
  updateCore({ x: c.x + c.w / 2 - c.d / 2, y: c.y + c.d / 2 - c.w / 2, w: c.d, d: c.w, nx: c.ny, ny: c.nx });
});
$("reset-core-interior")?.addEventListener("click", () => {
  const i = state.coreIndex ?? 0;
  if (!state.cores?.[i]) return;
  const { interiorEdit, ...rest } = state.cores[i];
  state.cores[i] = rest;
  updateCore({});
});
$("add-building").addEventListener("click", addBuilding);
document.querySelectorAll('input[name="site-type"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    setSiteType(radio.value);
    const apt = document.querySelector('[data-fields="apartment"]');
    if (apt) apt.innerHTML = "";
    syncUseFields();
  });
});
$("building-rows").addEventListener("change", (event) => {
  const row = event.target.closest("tr[data-id]");
  if (!row) return;
  const id = Number(row.dataset.id);
  const key = event.target.dataset.key;
  if (!key) return;
  if (key === "blockUnder") updateBuilding(id, { blockUnder: event.target.checked });
  else if (key === "name") updateBuilding(id, { name: event.target.value });
  else if (key === "floors") updateBuilding(id, { floors: Number(event.target.value) });
  else if (key === "towerW") updateBuilding(id, { tower: { w: Number(event.target.value) } });
  else if (key === "towerD") updateBuilding(id, { tower: { d: Number(event.target.value) } });
});
$("building-rows").addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-remove]");
  if (!btn) return;
  removeBuilding(Number(btn.dataset.remove));
});
["building-floors", "building-tower-w", "building-tower-d", "building-block-under"].forEach((id) => {
  const el = $(id);
  if (!el) return;
  el.addEventListener("change", () => {
    const building = buildingOfCore(state.core);
    if (!building) return;
    if (id === "building-floors") updateBuilding(building.id, { floors: Number(el.value) });
    else if (id === "building-tower-w") updateBuilding(building.id, { tower: { w: Number(el.value) } });
    else if (id === "building-tower-d") updateBuilding(building.id, { tower: { d: Number(el.value) } });
    else if (id === "building-block-under") updateBuilding(building.id, { blockUnder: el.checked });
  });
});
$("core-pick").addEventListener("change", () => selectCore(Number($("core-pick").value)));
$("play-build").addEventListener("click", playBuild);
$("show-conflicts").addEventListener("click", () => {
  state.debugColumns = !state.debugColumns;
  emit();
});
$("overlay-file").addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.overlay.url = String(reader.result);
    state.overlay.mode = "overlay";
    emit();
  };
  reader.readAsDataURL(file);
});
["overlay-opacity", "overlay-scale", "overlay-x", "overlay-y"].forEach((id) => {
  $(id).addEventListener("input", () => {
    state.overlay.opacity = numberOr($("overlay-opacity").value, 0.4);
    state.overlay.scale = numberOr($("overlay-scale").value, 1);
    state.overlay.x = numberOr($("overlay-x").value, 0);
    state.overlay.y = numberOr($("overlay-y").value, 0);
    emit();
  });
});
$("overlay-on").addEventListener("click", () => {
  state.overlay.mode = state.overlay.mode === "overlay" ? "off" : "overlay";
  emit();
});
$("overlay-side").addEventListener("click", () => {
  state.overlay.mode = state.overlay.mode === "side" ? "off" : "side";
  emit();
});
$("remove-selected").addEventListener("click", removeSelection);
$("to-3d").addEventListener("click", open3d);
$("back-plan").addEventListener("click", () => { state.resultTab = "plan"; setWizard(7); });
$("tab-model").addEventListener("click", async () => {
  if (wizardSlide !== 8) {
    wizardSlide = 8;
    document.body.dataset.wizard = "8";
    document.querySelectorAll(".slide").forEach((slide) => {
      const on = Number(slide.dataset.slide) === 8;
      slide.hidden = !on;
      slide.classList.toggle("on", on);
    });
    state.step = 3;
  }
  if (!readyFor3d()) {
    state.resultTab = "plan";
    const { errors } = issueGroups();
    $("step2-error").hidden = false;
    $("step2-error").textContent = errors.length
      ? `3D를 만들 수 없습니다: ${errors.join(" / ")}`
      : "3D를 만들 수 없습니다. 램프·코어·동선을 확인하세요.";
    emit();
    return;
  }
  await open3d();
});
$("tab-sheet").addEventListener("click", () => {
  state.resultTab = "sheet";
  const show = async () => {
    state.resultTab = "sheet";
    state.step = 3;
    emit();
    const { drawSheet } = await loadSheet();
    // 레이아웃이 잡힌 뒤 맞춰야 중앙·비율이 맞는다
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const info = summary();
      const canvas = $("sheet");
      if (canvas && state.plate) {
        drawSheet(canvas, state, { ...info, checkedOn: info.demand.checkedOn }, sheetFloor());
      }
    }));
  };
  if (wizardSlide !== 8) {
    setWizard(8);
    window.setTimeout(() => { show(); }, 420);
  } else {
    show();
  }
});
window.addEventListener("resize", () => {
  if ($("sheet-view")?.hidden || state.resultTab !== "sheet") return;
  loadSheet().then(({ fitSheetCanvas }) => fitSheetCanvas($("sheet")));
});
if ($("tab-plan")) {
  $("tab-plan").addEventListener("click", () => {
    state.resultTab = "plan";
    state.step = 2;
    if (wizardSlide !== 8) setWizard(8);
    else emit();
  });
}
$("sheet-png").addEventListener("click", async () => {
  const { downloadBlob } = await loadSheet();
  const canvas = $("sheet");
  canvas.toBlob((blob) => downloadBlob("parking-plan.png", blob));
});
$("sheet-svg").addEventListener("click", async () => {
  const { downloadBlob, sheetSvg } = await loadSheet();
  const info = summary();
  const svg = sheetSvg(state, { ...info, checkedOn: info.demand.checkedOn }, sheetFloor());
  downloadBlob("parking-plan.svg", new Blob([svg], { type: "image/svg+xml" }));
});
$("sheet-print").addEventListener("click", async () => {
  const { printSheet } = await loadSheet();
  printSheet($("sheet"));
});
$("sheet-dxf")?.addEventListener("click", async () => {
  if (!state.plate) return;
  const btn = $("sheet-dxf");
  const prev = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = "내보내는 중…"; }
  try {
    const { downloadCad } = await loadDxf();
    const info = summary();
    const unit = $("dxf-unit")?.value === "m" ? "m" : "mm";
    const format = $("dxf-format")?.value === "dxf" ? "dxf" : "dwg";
    const allFloors = Boolean($("dxf-all-floors")?.checked);
    await downloadCad(state, { ...info, checkedOn: info.demand?.checkedOn || info.checkedOn }, {
      unit,
      format,
      floorIndex: sheetFloor(),
      allFloors,
      version: "r281",
    });
  } catch (e) {
    alert(`CAD 내보내기 실패: ${e && e.message ? e.message : e}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = prev || "CAD 파일로 내보내기 (DWG)"; }
  }
});
$("dxf-format")?.addEventListener("change", () => {
  const fmt = $("dxf-format")?.value === "dxf" ? "DXF" : "DWG";
  const btn = $("sheet-dxf");
  if (btn && !btn.disabled) btn.textContent = `CAD 파일로 내보내기 (${fmt})`;
});
$("floor-picker").addEventListener("click", (event) => {
  const floor = event.target.dataset.floor;
  if (!floor) return;
  state.floorView = floor === "all" ? "all" : Number(floor);
  emit();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Delete" && event.key !== "Backspace") return;
  if (document.activeElement && ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
  if (!state.selection || state.selection.type === "core") return;
  event.preventDefault();
  removeSelection();
});

document.querySelectorAll("#steps li").forEach((item) => {
  item.addEventListener("click", () => {
    const step = Number(item.dataset.step);
    if (step === 3) open3d();
    else setStep(step);
  });
});

mountPlan($("plan"));
subscribe(render);
// 주변 매스는 조건 단계에서만 오른쪽에 띄운다. 평면·결과로 넘어가면 닫는다.
subscribe(() => { if (wizardSlide > 4 && !$("context-view").hidden) closeContext(); });
render();

let sceneMount = null;
let sceneApi = null;
let playTimer = 0;
let compareKey = "";

function playBuild() {
  window.clearInterval(playTimer);
  const stages = [1, 2, 3, 4, 5, 6];
  let cursor = 0;
  setReveal(stages[0]);
  playTimer = window.setInterval(() => {
    cursor += 1;
    if (cursor >= stages.length) {
      window.clearInterval(playTimer);
      return;
    }
    setReveal(stages[cursor]);
  }, 700);
}

async function ensureScene() {
  if (!sceneMount) {
    sceneMount = import("./scene.js?v=365")
      .then((module) => {
        const root = $("scene-root");
        if (!root) throw new Error("scene-root 없음");
        sceneApi = module.mountScene(root);
        return sceneApi;
      })
      .catch((error) => {
        sceneMount = null;
        sceneApi = null;
        throw error;
      });
  }
  return sceneMount;
}

function waitFrames(n = 1) {
  return new Promise((resolve) => {
    const step = () => {
      n -= 1;
      if (n <= 0) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

async function open3d() {
  if (!readyFor3d()) {
    const { errors } = issueGroups();
    $("step2-error").hidden = false;
    $("step2-error").textContent = errors.length
      ? `3D를 만들 수 없습니다: ${errors.join(" / ")}`
      : "3D를 만들 수 없습니다. 평면에서 주차 생성을 먼저 하세요(추천→결과).";
    return;
  }
  // 이미 캔버스가 있으면 가볍게 리사이즈·재빌드만 (busy 오버레이 반복 방지)
  const existing = sceneApi?.canvasSize?.() || { w: 0, h: 0 };
  if (state.resultTab === "model" && sceneApi?.hasCanvas?.() && existing.w > 10 && existing.h > 10) {
    $("scene-view").hidden = false;
    $("plan-view").hidden = true;
    $("sheet-view").hidden = true;
    document.body.classList.add("step-result");
    sceneApi.resize?.();
    sceneApi.forceRebuild?.();
    emit();
    return;
  }
  const overlay = $("busy");
  const busyText = $("busy-text");
  try {
    state.resultTab = "model";
    state.step = 3;
    // 다층 「전체」는 첫 페인트가 오래 걸려 회색만 보이므로, 5층 이상은 B1부터
    const floors = summary().floors || 1;
    if (floors > 4 && state.floorView === "all") {
      state.floorView = 0;
    }
    if (wizardSlide !== 8) {
      wizardSlide = 8;
      document.body.dataset.wizard = "8";
      document.querySelectorAll(".slide").forEach((slide) => {
        const on = Number(slide.dataset.slide) === 8;
        slide.hidden = !on;
        slide.classList.toggle("on", on);
      });
    }
    // 뷰를 먼저 보이게 한 뒤 마운트·리사이즈 (hidden 0×0 캔버스 방지)
    $("scene-view").hidden = false;
    $("plan-view").hidden = true;
    $("sheet-view").hidden = true;
    document.body.classList.add("step-result");
    const root = $("scene-root");
    if (root) {
      root.style.flex = "1 1 auto";
      root.style.width = "100%";
      root.style.minHeight = "320px";
      root.style.height = "100%";
      root.style.position = "relative";
    }
    if (overlay && busyText) {
      busyText.textContent = "3D 모델 준비 중…";
      overlay.hidden = false;
      document.body.classList.add("is-busy");
    }
    // 레이아웃(절대 inset + flex)이 잡힐 때까지 몇 프레임 대기
    await waitFrames(2);
    await ensureScene();
    // 캔버스가 없으면 재마운트
    if (!sceneApi?.hasCanvas?.()) {
      sceneMount = null;
      sceneApi = null;
      await ensureScene();
    }
    emit();
    await waitFrames(2);
    sceneApi?.resize?.();
    if (sceneApi?.forceRebuild) sceneApi.forceRebuild();
    else $("reset-camera")?.click();
    await waitFrames(2);
    const size = sceneApi?.canvasSize?.() || { w: 0, h: 0 };
    if (!(size.w > 10 && size.h > 10)) {
      // 최종 폴백: 강제 재마운트
      sceneMount = null;
      sceneApi = null;
      if (root) root.innerHTML = "";
      await ensureScene();
      sceneApi?.forceRebuild?.();
      await waitFrames(2);
    }
  } catch (error) {
    state.resultTab = "plan";
    $("step2-error").hidden = false;
    $("step2-error").textContent = `3D 모델을 불러오지 못했습니다: ${error && error.message ? error.message : error}`;
    emit();
  } finally {
    if (overlay) overlay.hidden = true;
    document.body.classList.remove("is-busy");
  }
}

function syncChoiceGroup(group, value) {
  group.querySelectorAll("button[data-value]").forEach((button) => {
    button.classList.toggle("on", button.dataset.value === String(value));
  });
}

function syncChoiceButtons() {
  document.querySelectorAll(".choice[data-for]").forEach((group) => {
    const select = $(group.dataset.for);
    if (!select) return;
    syncChoiceGroup(group, select.value);
    group.querySelectorAll("button[data-value]").forEach((button) => {
      button.disabled = select.disabled;
    });
  });
  const sizeGroup = $("size-presets");
  if (sizeGroup) {
    sizeGroup.querySelectorAll("button[data-w]").forEach((button) => {
      const on = Number(button.dataset.w) === Number(state.parkWidth)
        && Number(button.dataset.d) === Number(state.parkDepth);
      button.classList.toggle("on", on);
    });
  }
  const floorGroup = $("floor-height-choice");
  if (floorGroup) {
    const fh = Number(state.floorHeight);
    floorGroup.querySelectorAll("button[data-value]").forEach((button) => {
      button.classList.toggle("on", Math.abs(Number(button.dataset.value) - fh) < 1e-6);
    });
  }
  const siteGroup = $("site-type-choice");
  if (siteGroup) syncChoiceGroup(siteGroup, state.siteType);
}

function rankTopRecommendations(variants, limit = 3) {
  const priorities = [
    "동선 연결·충돌 없음 (배치 유효성)",
    "주차대수 최대",
    "1대당 면적 효율 (작을수록 유리)",
    "차로 비율·배치 균형",
  ];
  const scored = variants.map((variant, index) => {
    const m = variant.metrics || {};
    const reasons = [];
    let total = 0;
    if (m.valid) {
      total += 100000;
      reasons.push("동선·법규 통과");
    } else {
      reasons.push(`탈락 요인 있음${m.rejected ? ` (${m.rejected})` : ""}`);
    }
    total += (m.stalls || 0) * 120;
    reasons.push(`주차 ${m.stalls || 0}대`);
    const aps = Number(m.areaPerStall) || 99;
    // 1대당 면적이 크면(비효율·조각 배치) 강하게 감점
    total += Math.max(-8000, (48 - aps) * 80);
    reasons.push(`1대당 ${Number(aps).toFixed(1)}㎡`);
    if (aps > 60) reasons.push("면적 효율 낮음");
    const aisle = Number(m.aisleRatio) || 0;
    total += Math.max(0, 40 - aisle * 40);
    if (m.connected) total += 25;
    if ((m.deadEnds || 0) > 3) total -= (m.deadEnds - 3) * 40;
    if (variant.recommended) {
      total += 15;
      reasons.push("엔진 추천안");
    }
    if (variant.maxStalls) reasons.push("최대 주차칸");
    return { index, variant, total, reasons, priorities };
  });
  scored.sort((a, b) => b.total - a.total || a.index - b.index);
  // 기둥 격자가 여러 개면 격자마다 가장 좋은 안을 먼저 하나씩(서로 다른 격자를 비교할 수 있게), 남는 자리는 점수순
  if (variants.some((v) => v.grid)) {
    const picks = [];
    const seenGrid = new Set();
    scored.forEach((p) => {
      const key = p.variant.grid ? p.variant.grid.label : "";
      if (picks.length < limit && !seenGrid.has(key)) { seenGrid.add(key); picks.push(p); }
    });
    scored.forEach((p) => { if (picks.length < limit && !picks.includes(p)) picks.push(p); });
    picks.sort((a, b) => b.total - a.total || a.index - b.index);
    return { priorities, picks };
  }
  return { priorities, picks: scored.slice(0, limit) };
}

function renderRecommendations() {
  const list = $("recommend-list");
  const legend = $("priority-legend");
  if (!list || !legend) return;
  if (wizardSlide !== 7 || !state.variants.length) {
    list.innerHTML = "";
    legend.innerHTML = "";
    return;
  }
  const { priorities, picks } = rankTopRecommendations(state.variants, 3);
  legend.innerHTML = `<strong>선정 우선순위</strong><ol>${priorities.map((p) => `<li>${p}</li>`).join("")}</ol>`;
  list.innerHTML = "";
  // 3안 비교 기준
  const ms = picks.map((p) => p.variant.metrics || {});
  const maxStalls = Math.max(...ms.map((m) => m.stalls || 0));
  const minAps = Math.min(...ms.map((m) => Number(m.areaPerStall) || 99));
  const best = picks[0];
  const prosCons = (pick, rank) => {
    const m = pick.variant.metrics || {};
    const pros = [];
    const cons = [];
    if (m.valid) pros.push("동선·법규 검사 통과");
    if ((m.stalls || 0) === maxStalls) pros.push(`3안 중 주차가 가장 많음 (${m.stalls}대)`);
    if ((Number(m.areaPerStall) || 99) <= minAps + 0.05) pros.push(`1대당 면적이 가장 효율적 (${Number(m.areaPerStall).toFixed(1)}㎡)`);
    if (m.connected && !(m.deadEnds > 0)) pros.push("막다른 차로 없이 한 바퀴 연결");
    if (!(m.columnHits > 0)) pros.push("기둥과 칸 충돌 없음");
    if (!m.valid) {
      const why = (pick.variant.issues || []).filter((i) => i && i.label && i.type !== "info").map((i) => i.label);
      cons.push(why.length ? `배치 불가: ${[...new Set(why)].slice(0, 2).join(" · ")}` : `배치 불가${m.rejected ? `: ${m.rejected}` : ""}`);
    } else {
      const short = totalStallShortages(pick.variant.metrics);   // 전체 층 기준
      if (short.length) cons.push(`법정 구획 부족(전체 층): ${short.slice(0, 3).join(" · ")}`);
    }
    if (rank > 0) {
      const bm = best.variant.metrics || {};
      const diff = (bm.stalls || 0) - (m.stalls || 0);
      if (diff > 0) cons.push(`1안보다 ${diff}대 적음`);
      const da = (Number(m.areaPerStall) || 0) - (Number(bm.areaPerStall) || 0);
      if (da > 0.2) cons.push(`1대당 면적이 1안보다 ${da.toFixed(1)}㎡ 큼`);
    }
    if (m.deadEnds > 0) cons.push(`막다른 차로 ${m.deadEnds}곳`);
    if (m.connected === false) cons.push("차로가 끊긴 곳 있음");
    if (m.columnHits > 0) cons.push(`기둥 충돌 ${m.columnHits}곳`);
    let head;
    if (rank === 0) {
      head = "추천 1순위 — 위 우선순위로 매긴 점수가 가장 높음";
    } else {
      const bm = best.variant.metrics || {};
      const same = (bm.stalls || 0) === (m.stalls || 0) && Math.abs((Number(bm.areaPerStall) || 0) - (Number(m.areaPerStall) || 0)) <= 0.2 && Boolean(bm.valid) === Boolean(m.valid);
      if (same) {
        head = `${rank + 1}순위 — 대수·효율은 1안과 같고 배치 모양만 달라요`;
        const tie = [];
        if (best.variant.recommended && !pick.variant.recommended) tie.push("1안이 엔진 추천안이라 동점에서 앞섬");
        if ((m.deadEnds || 0) > (bm.deadEnds || 0)) tie.push("막다른 차로가 더 많음");
        if ((Number(m.aisleRatio) || 0) > (Number(bm.aisleRatio) || 0) + 0.005) tie.push("차로 비율이 조금 높음");
        tie.forEach((t) => cons.push(t));
      } else {
        head = `${rank + 1}순위 — 1안보다 뒤인 이유는 아래 «!» 항목`;
      }
    }
    return { pros, cons, head };
  };
  picks.forEach((pick, rank) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `recommend-card${pick.index === state.variantIndex ? " on" : ""}`;
    const canvas = document.createElement("canvas");
    const m = pick.variant.metrics;
    const title = pick.variant.recommended ? `${pick.variant.id} · 엔진 추천` : pick.variant.id;
    const pc = prosCons(pick, rank);
    const li = (arr, cls) => arr.length ? `<ul class="${cls}">${arr.map((t) => `<li>${t}</li>`).join("")}</ul>` : "";
    const gridLine = pick.variant.grid ? `<b class="rc-grid">기둥 ${pick.variant.grid.label}</b><br>` : "";
    button.innerHTML = `<div></div><div><h3><span class="rank">${rank + 1}</span>${title}</h3><p>${gridLine}${pick.variant.name}<br>${m.stalls}대 · ${m.areaPerStall.toFixed(1)}㎡/대 · ${m.connected ? "연결" : "끊김"} · 충돌 ${m.columnHits}</p><p class="why">${pc.head}</p>${li(pc.pros, "rc-pros")}${li(pc.cons, "rc-cons")}</div>`;
    button.children[0].replaceWith(canvas);
    button.addEventListener("click", () => {
      // 고르면 왼쪽 평면에서 그 안을 먼저 본다(결과로 바로 안 넘어감). 결과는 «다음»으로.
      applyVariant(pick.index);
      state.resultTab = "plan";
      emit();
    });
    list.appendChild(button);
    drawThumb(canvas, pick.variant);
  });
}

function render() {
  try { renderGridChoices(); } catch (e) { /* 무시 */ }
  const step = wizardStepFromSlide(wizardSlide);
  state.step = step;
  document.body.dataset.wizard = String(wizardSlide);
  document.body.classList.toggle("plan-expanded", wizardSlide >= 5);
  document.body.classList.toggle("step-result", step === 3);
  // 좌측 스테이지가 넓어진 뒤 평면도 카메라를 다시 가운데로
  // (단계가 바뀔 때만 — 매번 하면 코어를 옮기거나 돌릴 때마다 줌이 풀림)
  if (wizardSlide >= 5 && lastFitSlide !== wizardSlide) {
    lastFitSlide = wizardSlide;
    requestAnimationFrame(() => requestAnimationFrame(() => invalidatePlanFit()));
  } else if (wizardSlide < 5) lastFitSlide = 0;
  document.querySelectorAll("#wizard-steps li").forEach((item) => {
    const value = Number(item.dataset.slide);
    item.classList.toggle("on", value === wizardSlide);
    item.classList.toggle("done", value < wizardSlide);
  });
  const back = $("wizard-back");
  const next = $("wizard-next");
  if (back) back.disabled = wizardSlide <= 1 || wizardAnimating;
  if (next) {
    next.textContent = wizardSlide === 7
      ? "결과로"
      : wizardSlide >= WIZARD_MAX
        ? (readyFor3d() ? "3D 보기" : "완료")
        : "다음";
    next.disabled = wizardAnimating;
  }
  document.querySelectorAll("#steps li").forEach((item) => {
    const value = Number(item.dataset.step);
    item.classList.toggle("on", value === step);
    item.classList.toggle("done", value < step);
  });
  const showSheet = step === 3 && state.resultTab === "sheet";
  const showModel = step === 3 && state.resultTab === "model";
  $("plan-view").hidden = showSheet || showModel;
  $("scene-view").hidden = !showModel;
  $("sheet-view").hidden = !showSheet;
  $("sheet-tools").hidden = !showSheet;
  if ($("dxf-tools")) $("dxf-tools").hidden = !showSheet;
  $("reset-camera").hidden = showSheet || !showModel;
  if ($("tab-plan")) $("tab-plan").classList.toggle("on", !showSheet && !showModel);
  if ($("tab-model")) $("tab-model").classList.toggle("on", showModel);
  if ($("tab-sheet")) $("tab-sheet").classList.toggle("on", showSheet);
  syncPlateShapeTabs();
  syncMapDrawBox();

  const valid = inputsValid();
  $("generate").disabled = !valid;
  $("input-error").hidden = valid;
  if (!valid) {
    const sx = parseSpans(state.spansX).error;
    const sy = parseSpans(state.spansY).error;
    $("input-error").textContent = !floorHeightOk()
      ? `층고 ${state.floorHeight}m는 사용할 수 없습니다. 유효높이(층고 − 슬래브 ${SLAB_T}m)가 차로 기준 ${needClear()}m 이상이 되도록 ${(needClear() + SLAB_T).toFixed(2)}–6m로 입력하세요.`
      : sx ? `기둥 간격 가로: ${sx}. 쉼표로 구분한 3–15m 숫자로 입력하세요.`
      : sy ? `기둥 간격 세로: ${sy}. 쉼표로 구분한 3–15m 숫자로 입력하세요.`
        : "가로·세로는 18–300m, 기둥 간격은 5–12m로 입력하세요.";
  }
  $("spans-x").classList.toggle("bad", Boolean(parseSpans(state.spansX).error));
  $("floor-height").classList.toggle("bad", !floorHeightOk());
  {
    const clear = clearHeightOf(Number(state.floorHeight) || 0);
    const need = needClear();
    const okText = clear >= need - 1e-9 ? "✓" : `✗ ${need}m 미만`;
    const tr = rampTransitions({ legalStalls: currentStallRules().legalStalls });
    const ease = [tr.top ? `윗부분 ${tr.top}m` : "", tr.bottom ? `아랫부분 ${tr.bottom}m` : ""].filter(Boolean).join("·");
    const apt = Boolean(state.demand.active && state.demand.active.apartment);
    $("ground-access-row").hidden = !apt;
    if (document.activeElement !== $("no-ground-access")) $("no-ground-access").checked = state.noGroundAccess;
    $("clear-readout").textContent = `유효 ${clear.toFixed(2)}m ${clear >= need - 1e-9 ? "✓" : "✗"} (기준 ${need}m)`;
  }
  $("spans-y").classList.toggle("bad", Boolean(parseSpans(state.spansY).error));

  const area = (state.parkWidth > 0 ? state.parkWidth : 0) * (state.parkDepth > 0 ? state.parkDepth : 0);
  const bay = stallsPerBay(state.columnSpacing, state.columnWidth, state.minClear);
  const bayText = `구간당 ${bay.count}대`;
  $("plate-preview").innerHTML = statList([
    ["주차장 크기", `${formatMeters(state.parkWidth)} × ${formatMeters(state.parkDepth)}`],
    ["주차장 면적", formatArea(area)],
    ["기둥 중심 간격", (state.spansX || state.spansY)
      ? `가로 ${state.spansX || formatMeters(state.columnSpacing)} / 세로 ${state.spansY || formatMeters(state.columnSpacing)}`
      : (state.columnAuto ? "코어 단계에서 고름" : formatMeters(state.columnSpacing))],
  ]);
  $("type-readout").textContent = typeReadout();
  {
    const spanText = (v) => (v && String(v).trim() ? String(v).trim() : "기본");
    $("demand-summary").textContent = `조례 배율 ${state.demand.ordinance} · 크기 추천: 1대당 ${state.demand.areaPerStall}㎡, 지하 ${state.demand.plannedFloors}층`;
    {
      const sx = spanText($("spans-x").value);
      const sy = spanText($("spans-y").value);
      const custom = $("spans-x").value.trim() || $("spans-y").value.trim() ? ` · 가로 ${sx} · 세로 ${sy}` : "";
      void custom; void bayText;
      $("column-summary").textContent = `기둥 단면 ${$("column-size").value}m${Number($("min-clear").value) ? ` · 이격 ${$("min-clear").value}m` : ""} · 기둥 간격은 코어 단계에서 고름`;
    }
  }
  setIfIdle(fields.width, state.parkWidth);
  setIfIdle(fields.depth, state.parkDepth);
  setIfIdle(fields.spacing, state.columnSpacing);
  if ($("column-auto")) { $("column-auto").checked = Boolean(state.columnAuto); fields.spacing.disabled = Boolean(state.columnAuto); }
  setIfIdle($("floor-height"), state.floorHeight);
  setIfIdle($("column-size"), state.columnWidth);
  if (document.activeElement !== $("min-clear")) $("min-clear").value = Number(state.minClear).toFixed(2);
  setIfIdle($("site-margin"), state.siteMargin);
  setIfIdle($("site-margin-step4"), state.siteMargin);
  {
    const sm = state.siteMargins || {};
    ["n", "s", "e", "w"].forEach((k) => {
      const a = $(`margin-${k}`);
      const b = $(`margin-${k}-step4`);
      const val = sm[k] == null ? "" : String(sm[k]);
      if (a && document.activeElement !== a) a.value = val;
      if (b && document.activeElement !== b) b.value = val;
    });
    const show = (k) => (sm[k] == null ? `${state.siteMargin}` : `${sm[k]}*`);
    if ($("setback-summary")) {
      $("setback-summary").textContent = `북 ${show("n")} · 남 ${show("s")} · 서 ${show("w")} · 동 ${show("e")} m${["n", "s", "e", "w"].some((k) => sm[k] != null) ? " (*방향별)" : ""}`;
    }
  }
  if (document.activeElement !== $("ramp-placement")) $("ramp-placement").value = state.rampPlacement;
  {
    const need = wizardSlide === 5 && !state.rampStartSet;
    if ($("ramp-map-peek-row")) $("ramp-map-peek-row").hidden = !(wizardSlide === 5 && state.demand.sitePoint);
    if ($("ramp-click-hint")) $("ramp-click-hint").hidden = !(need && (state.rampView || "entry") !== "lower");
    if ($("ramp-view-dock")) {
      const dock = $("ramp-view-dock");
      dock.hidden = !(wizardSlide >= 5 && wizardSlide <= 8) || (wizardSlide === 8 && state.resultTab !== "plan");
      const [b1, b2] = dock.querySelectorAll("button");
      if (b1 && b2) {
        if (wizardSlide === 5) { b1.innerHTML = "출입 램프<small>지상→B1</small>"; b2.innerHTML = "층간 램프<small>B1→B2↓</small>"; }
        else { b1.innerHTML = "B1<small>출입 램프 층</small>"; b2.innerHTML = "B2 이하<small>층간 램프 층</small>"; }
      }
    }
    // 3단계: 외곽을 그렸을 때만 왼쪽 평면 미리보기(기본 사각형 격자는 안 보임)
    document.body.classList.toggle("plate-drawn", state.parkPolygon?.length >= 3 && state.plateShapeMode !== "rect");
    const h = $("ramp-start-hint");
    if (h) {
      h.hidden = !need;
      if (need && !h.classList.contains("bad")) h.textContent = "① 내부·외부를 고르고 ② 왼쪽 평면을 클릭해 램프 시작점을 찍으세요";
      if (!need) h.classList.remove("bad");
    }
    if (wizardSlide >= 5 && wizardSlide <= 8) setRampView(state.rampView || "entry");
  }
  {
    // 외부 전용 형태는 외부일 때만 목록에
    const ext = state.rampPlacement === "external";
    ["ramp-form", "lower-ramp-form"].forEach((id) => {
      const sel = $(id);
      if (!sel) return;
      [...sel.options].forEach((o) => { const hide = o.value === "spiral" || (!ext && OUTER_ONLY.includes(o.value)); o.hidden = hide; o.disabled = hide; });
    });
    // 내부형은 형태를 고르지 않음: 직선으로, 모자라면 90° 꺾음(자동). 외부형만 목록.
    if ($("ramp-form-field")) {
      const sel = $("ramp-form");
      sel.hidden = !ext;
      const lab = $("ramp-form-field").querySelector(".field-label");
      if (lab) lab.hidden = !ext;
      if (!ext && state.rampForm !== "auto" && document.activeElement !== sel) {
        sel.value = "auto";
        sel.dispatchEvent(new Event("change"));
      }
    }
    // 고른 형태가 이 평면에 안 들어가면 이유 표시
    const warn = $("ramp-form-warn");
    if (warn) {
      let msg = "";
      try {
        const rr = state.ramps?.[0];
        const r0 = rr ? { ...(rr.legacy || {}), ...rr, length: rr.length ?? rr.legacy?.length, form: rr.form ?? rr.legacy?.form ?? state.rampForm } : null;   // 모듈 사슬이면 원래 램프 값으로
        if (r0 && state.plate) {
          const sh = rampShape(r0, state.plate);
          if (sh && sh.ok === false && sh.reason) msg = `⚠ ${sh.reason}`;
          else if (r0.form === "auto" || !r0.form) msg = `출입 램프: ${sh?.kind === "straight" ? "직선" : "직선 후 90° 꺾음 (직선이 모자람)"}`;
        }
      } catch (_) { msg = ""; }
      if (state.rampPlacement !== "external" && !msg.startsWith("⚠")) msg = `${msg ? `${msg} · ` : ""}평면을 클릭하면 가까운 벽에서 램프가 시작해요(끌어 옮겨도 됨)`;
      warn.textContent = msg;
      warn.className = msg.startsWith("⚠") ? "hint warn" : "hint";
    }
  }
  if (document.activeElement !== $("ramp-form")) $("ramp-form").value = state.rampForm || "auto";
  if ($("lower-ramp-form") && document.activeElement !== $("lower-ramp-form")) {
    $("lower-ramp-form").value = state.lowerRampForm || "auto";
  }
  if (document.activeElement !== $("lower-ramp-mode")) $("lower-ramp-mode").value = state.lowerRampMode || "alternate";
  if (document.activeElement !== $("road-edge")) $("road-edge").value = state.roadEdge;
  renderRampPos();
  // 이격은 4단계에서만 — 램프 단계 중복 입력 숨김 유지
  if ($("site-margin-row")) $("site-margin-row").hidden = true;
  // 4단계(도로·이격)를 없애고 램프 단계로: 이격은 외부 램프일 때만, 도로 변은 주소로 자동(없을 때만 직접)
  if ($("site-setback-block")) $("site-setback-block").hidden = state.rampPlacement !== "external";
  // 도로 접한 변 칸 없앰: 사용자가 지도 보고 램프 시작점을 찍은 변 = 도로변
  if ($("road-edge-field")) $("road-edge-field").hidden = true;
  if ($("road-edge-auto")) $("road-edge-auto").hidden = true;
  {
    const sm = state.siteMargins || {};
    const show = (k) => (sm[k] == null ? `${state.siteMargin}` : `${sm[k]}*`);
    if ($("margin-summary")) {
      $("margin-summary").textContent = `북 ${show("n")} · 남 ${show("s")} · 서 ${show("w")} · 동 ${show("e")} m${["n", "s", "e", "w"].some((k) => sm[k] != null) ? " (*방향별)" : ""}`;
    }
  }
  if (state.rampPlacement !== "external") state.entranceMode = "integrated";
  $("entrance-mode").disabled = state.rampPlacement !== "external";
  if (document.activeElement !== $("entrance-mode")) $("entrance-mode").value = state.entranceMode;
  if (document.activeElement !== $("circulation")) $("circulation").value = state.circulation;
  if (document.activeElement !== $("project-name")) $("project-name").value = state.demand.projectName;
  syncChoiceButtons();

  const info = summary();
  renderDemand(info);
  const rows = [
    ["법정 필요 대수", `${info.required}대`],
    ["실제 배치 대수", `${info.placed}대`],
    ["필요 지하층", info.floors ? `${info.floors}층` : "—"],
    ["총 주차대수", `${info.totalStalls}대`],
    ["1대당 면적", info.placed ? formatArea(info.areaPerStall) : "—"],
    ...(isReference() ? [["예시 도면 유사도", state.metrics ? `${info.similarity}점` : "—"]] : []),
    ["차로 면적 비율", state.metrics ? `${Math.round(info.aisleRatio * 100)}%` : "—"],
    ["동선 연결", state.plate ? (info.connected ? "연결" : "끊김") : "—"],
  ];
  if (state.siteType === "complex" && info.buildingCount) {
    rows.splice(1, 0, ["단지 구성", `동 ${info.buildingCount}개 · 최고 ${info.maxBuildingFloors}층 · 계단 코어 ${info.stairCores}개`]);
  }
  renderBuildingList();
  document.querySelectorAll('input[name="site-type"]').forEach((radio) => {
    radio.checked = radio.value === state.siteType;
  });
  $("complex-hint").hidden = state.siteType !== "complex";
  $("building-list-wrap").hidden = state.siteType !== "complex";
  $("add-core").textContent = state.siteType === "complex" ? "동 추가" : "코어 추가";
  {
    const cur = state.cores?.[state.coreIndex ?? 0];
    const bCount = (state.cores || []).filter((c) => (c.kind || "building") !== "stair").length;
    const blocked = !cur || ((cur.kind || "building") !== "stair" && bCount <= 1);
    $("remove-core").disabled = blocked;
    $("remove-core-note").textContent = blocked && cur ? "승강기·계단 코어는 최소 1개 있어야 해서 지울 수 없어요(계단 코어는 지울 수 있음)." : "";
  }
  if (state.metrics && state.metrics.rampKind) {
    const ramp = state.ramps[0];
    const kind = state.metrics.rampKind;
    const formName = (f) => (
      f === "outer9090" || f === "spiral" ? "90·직선·90"
        : f === "outer180" ? "180° 나선"
          : f === "curve90" ? "직선+90°"
            : f === "straight" ? "직선"
              : f === "same" ? "출입과 같음"
                : "자동"
    );
    const formLabel = ["outer9090", "spiral"].includes(state.rampForm) || ["outer9090", "spiral"].includes(kind)
      ? "90·직선·90"
      : state.rampForm === "outer180" || kind === "outer180" ? "180° 나선"
        : state.rampForm === "curve90" || kind === "curved" ? "직선+90°"
          : "직선";
    rows.push(["지상→B1 램프", `${state.rampPlacement === "external" ? "외부" : "내부"} · ${formLabel} ${state.metrics.rampTotal || (ramp && ramp.length) || "—"}m`]);
    const lowerMode = state.lowerRampMode || "alternate";
    const lowerForm = state.lowerRampForm || "auto";
    rows.push(["지하2층↓ 형태", formName(lowerForm)]);
    rows.push(["지하 2층+ 경로", lowerMode === "same" ? "전 층 동일 XY" : (kind === "spiral" && lowerForm === "spiral" ? "같은 외곽 경로" : "반대쪽 변 층간 램프")]);
    if (kind === "straight" && Number.isFinite(state.metrics.rampLowerSlope)) {
      rows.push(["층간 본 경사", `${(state.metrics.rampLowerSlope * 100).toFixed(1)}% (도로변 3m 없음)`]);
    }
  }
  if (state.metrics && state.trimDeadEnds) {
    rows.push(["진입 불가 제외", `${state.metrics.unreachable || 0}칸`]);
    rows.push(["정리한 막다른 차로", `${state.metrics.trimmedAisles || 0}곳`]);
  }
  if (info.stallTypes && info.stallTargets && info.stallTypes.total) {
    // 전체(층당 × 층수) 기준으로 표시하고, 괄호에 층당 개수
    const c = info.stallTypesTotal || info.stallTypes;
    const t = info.stallTargetsTotal || info.stallTargets;
    const per = info.stallTypes;
    const n = info.floors || 1;
    const mark = (have, need, one) => `${need ? `${have}/${need}${have >= need ? "" : " ⚠"}` : `${have}`}${n > 1 ? ` (층당 ${one})` : ""}`;
    rows.push([n > 1 ? `장애인전용 (전체 ${n}개 층)` : "장애인전용", mark(c.disabled, t.disabled, per.disabled)]);
    if (t.extended) rows.push(["확장형 (30%)", mark(c.extended, t.extended, per.extended)]);
    if (t.eco) rows.push([`친환경차 (${Math.round((t.ecoRate || 0.05) * 100)}%)`, mark(c.eco || 0, t.eco, per.eco || 0)]);
    if (per.parallel) rows.push(["평행주차 (자투리)", `${c.parallel}칸${n > 1 ? ` (층당 ${per.parallel})` : ""}`]);
  }
  $("plan-stats").innerHTML = statList(rows, 3);
  $("scene-stats").innerHTML = statList(rows, 3);
  $("floor-stack").innerHTML = floorStack(info.floors);
  $("floor-picker").innerHTML = floorPicker(info.floors);
  if (showSheet) {
    loadSheet().then(({ drawSheet }) => {
      drawSheet($("sheet"), state, { ...info, checkedOn: info.demand.checkedOn }, sheetFloor());
    });
  }

  if (state.core && document.activeElement !== fields.coreArea) fields.coreArea.value = String(Math.round(state.core.w * state.core.d));
  if (state.core) {
    const rec = state.plate ? recommendCoreCells(state.plate) : null;
    const recText = rec ? ` · 추천 ${rec.nx}×${rec.ny}칸` : "";
    if (state.core.grid === false) {
      $("core-size-note").textContent = `직접 입력 ${state.core.w}×${state.core.d}m (${Math.round(state.core.w * state.core.d)}㎡) · 격자 맞춤 꺼짐${recText}`;
    } else {
      if (document.activeElement !== $("core-nx")) $("core-nx").value = String(state.core.nx || 1);
      if (document.activeElement !== $("core-ny")) $("core-ny").value = String(state.core.ny || 1);
      $("core-size-note").textContent = `${state.core.w}×${state.core.d}m (${Math.round(state.core.w * state.core.d)}㎡)${recText}`;
    }
    $("core-search-note").textContent = state.cores.length !== 1
      ? "코어가 여러 개면 자동 찾기를 하지 않습니다."
      : state.coreSearch
        ? `자동 탐색: 가운데 ${state.coreSearch.before}대 → ${state.coreSearch.after}대`
        : state.coreAuto ? "자동 탐색: 지금 자리가 가장 많음" : "직접 둔 자리";
    setIfIdle(fields.coreW, state.core.w);
    setIfIdle(fields.coreD, state.core.d);
    setIfIdle(fields.coreX, state.core.x);
    setIfIdle(fields.coreY, state.core.y);
  }
  const opening = selectedOpening();
  const ramp = selectedRamp();
  setIfIdle(fields.entranceWidth, opening ? opening.width : state.entranceWidth);
  setIfIdle(fields.rampWidth, ramp ? ramp.width : state.rampWidth);
  {
    const auto = autoRampLength();
    const len = (ramp ? ramp.length : state.rampLength) || auto;
    const wid = ramp ? ramp.width : state.rampWidth;
    const custom = Math.abs(len - auto) > 0.05 || Math.abs(wid - autoRampWidth()) > 0.05;
    const info = rampModuleInfo(ramp);
    if (info?.chain) {
      const total = info.chain.total;
      const mode = info.ramp.mode === "spiral" ? "나선" : "반복";
      const maxSlope = Math.max(0, ...(info.plan.perModule || []).map((p) => p.slope || 0));
      const fix = info.plan.ok ? "" : ` · ${info.plan.levels.find((l) => !l.ok)?.fix?.text || "길이 부족"}`;
      $("ramp-summary").textContent = `사슬 ${total.toFixed(1)}m · ${mode} · 최대 ${(maxSlope * 100).toFixed(1)}% · 폭 ${wid}m${fix}`;
      if ($("ramp-module-note")) {
        const issues = (info.site.issues || []).map((i) => i.text).slice(0, 3);
        $("ramp-module-note").textContent = issues.join(" · ") || (info.legacyEq ? "예전 램프와 같은 모양(엔진·3D는 기존 경로)" : "모듈 사슬 경로");
      }
      if ($("ramp-mod-levels") && document.activeElement !== $("ramp-mod-levels")) $("ramp-mod-levels").value = info.ramp.levels || 1;
      if ($("ramp-mod-mode") && document.activeElement !== $("ramp-mod-mode")) $("ramp-mod-mode").value = info.ramp.mode || "repeat";
      if ($("ramp-mod-radius") && document.activeElement !== $("ramp-mod-radius")) $("ramp-mod-radius").value = info.ramp.innerRadius || 6;
      const mi = state.selection?.module;
      const mod = mi != null ? info.ramp.modules?.[mi] : null;
      if (mod?.type === "straight" && $("ramp-mod-length") && document.activeElement !== $("ramp-mod-length")) {
        $("ramp-mod-length").value = mod.length;
      }
    } else {
      $("ramp-summary").textContent = `램프 폭 ${wid}m · 길이 ${len}m ${custom ? `(직접 입력 · 자동 ${autoRampWidth()}m · ${auto}m)` : `(층고 ${state.floorHeight}m 기준 자동)`}`;
    }
  }
  setIfIdle(fields.rampLength, ramp ? (ramp.length || ramp.modules?.[0]?.length || state.rampLength || autoRampLength()) : (state.rampLength || autoRampLength()));
  renderPicks();

  // 입구·출구를 따로 찍는 건 외부 램프 + 분리 출입구일 때만. 내부 램프·램프 일체형은 램프 입구가 곧 입출구다.
  const separateDoors = state.rampPlacement === "external" && state.entranceMode !== "integrated";
  if (!separateDoors && (state.tool === "entrance" || state.tool === "exit")) state.tool = "core";
  $("door-mode-row").hidden = state.rampPlacement !== "external";   // 내부 램프는 램프 입구가 곧 입출구
  $("tools").hidden = !separateDoors;
  document.querySelectorAll("#tools button").forEach((button) => {
    button.classList.toggle("on", button.dataset.tool === state.tool);
  });

  $("reference-notes").textContent = state.referenceNotes.join(" ");
  // 추천 후보는 7단계 목록으로만 — 5·6에서는 비교 독 숨김
  $("compare-dock").hidden = true;
  renderCompare();
  renderCorePick();

  // 평면·칸·램프만 있으면 3D 가능. 동선·대지 문제는 경고로만 표시.
  // 5·6은 주차 생성 전 셸이라 이슈를 숨긴다(6→7에서 생성 후 표시).
  const { errors, warnings } = issueGroups();
  const listHtml = (items) => `<ul>${items.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`;
  const hasParking = Boolean(state.stalls && state.stalls.length);
  const showIssues = wizardSlide >= 7 && wizardSlide <= 8 && state.plate && hasParking;
  const ready = readyFor3d();
  // ready면 빨간「3D 불가」를 쓰지 않음 — 경고로만
  const hardBlock = !ready && errors.length > 0;
  $("step2-error").hidden = !showIssues || !hardBlock;
  $("step2-error").innerHTML = hardBlock ? `<strong>3D를 만들 수 없습니다 — 원인</strong>${listHtml(errors)}` : "";
  const warnItems = hardBlock ? warnings : errors.concat(warnings);
  $("step2-warn").hidden = !showIssues || warnItems.length === 0;
  $("step2-warn").innerHTML = warnItems.length
    ? `<strong>${ready ? "주의 (3D 보기는 가능)" : "주의"}</strong>${listHtml(warnItems)}`
    : "";
  const alert = $("plan-alert");
  const boxes = [];
  if (showIssues && hardBlock) boxes.push(`<div class="issue-box error"><strong>3D 불가 — 원인</strong>${listHtml(errors)}</div>`);
  if (showIssues && warnItems.length) boxes.push(`<div class="issue-box warn"><strong>주의</strong>${listHtml(warnItems)}</div>`);
  alert.hidden = boxes.length === 0;
  alert.innerHTML = boxes.join("");
  if ($("to-3d")) {
    $("to-3d").disabled = !ready;
    $("to-3d").title = ready
      ? "이 배치로 3D 모델을 만듭니다."
      : `3D 불가: ${(errors.length ? errors : ["평면·주차칸·램프·코어를 확인하세요."]).join(" / ")}`;
  }
  $("show-conflicts").classList.toggle("on", state.debugColumns);

  const stageText = ["", "외곽 주차칸", "순환 차로", "내부 베이", "기둥", "코어 우회", "동선 화살표"];
  let statusText = WIZARD_LABELS[wizardSlide] || "";
  if (wizardSlide >= 5 && wizardSlide <= 6 && state.revealStage < 6) {
    statusText = `생성 과정: ${stageText[state.revealStage]}`;
  } else if (wizardSlide >= 5 && wizardSlide <= 6 && state.plate) {
    statusText = toolStatus();
  } else if (wizardSlide === 7) {
    statusText = state.variants.length
      ? `추천 ${Math.min(3, state.variants.length)}안 · 고른 뒤 다음(결과)으로 진행하세요.`
      : WIZARD_LABELS[7];
  } else if (wizardSlide === 8) {
    statusText = info.floors
      ? `법정 ${info.required}대 · 층당 ${info.placed}대 → 지하 ${info.floors}층 규모`
      : WIZARD_LABELS[8];
  }
  $("status").textContent = statusText;
  renderRecommendations();
}

function renderCorePick() {
  const select = $("core-pick");
  const markup = state.cores.map((core, index) => {
    const name = coreLabel(core, index);
    return `<option value="${index}">${name} · ${core.w.toFixed(1)}×${core.d.toFixed(1)}m</option>`;
  }).join("");
  if (select.innerHTML !== markup) select.innerHTML = markup;
  if (state.cores.length) select.value = String(state.coreIndex);
  const building = buildingOfCore(state.core);
  const fields = $("building-core-fields");
  if (fields) {
    fields.hidden = !building;
    if (building) {
      setIfIdle($("building-floors"), building.floors);
      setIfIdle($("building-tower-w"), building.tower.w);
      setIfIdle($("building-tower-d"), building.tower.d);
      if (document.activeElement !== $("building-block-under")) $("building-block-under").checked = Boolean(building.blockUnder);
    }
  }
}

function renderBuildingList() {
  const body = $("building-rows");
  if (!body) return;
  const focus = document.activeElement;
  const focusKey = focus && focus.dataset && focus.closest("tr[data-id]")
    ? `${focus.closest("tr[data-id]").dataset.id}:${focus.dataset.key}`
    : null;
  body.innerHTML = state.buildings.map((b) => `
    <tr data-id="${b.id}">
      <td><input data-key="name" type="text" value="${escapeAttr(b.name)}" /></td>
      <td><input data-key="floors" type="number" min="1" step="1" value="${b.floors}" /></td>
      <td><input data-key="towerW" type="number" min="5" step="0.1" value="${b.tower.w}" /></td>
      <td><input data-key="towerD" type="number" min="5" step="0.1" value="${b.tower.d}" /></td>
      <td><input data-key="blockUnder" type="checkbox" ${b.blockUnder ? "checked" : ""} /></td>
      <td><button type="button" class="ghost tiny" data-remove="${b.id}" ${state.buildings.length <= 1 ? "disabled" : ""}>삭제</button></td>
    </tr>
  `).join("");
  if (focusKey) {
    const [id, key] = focusKey.split(":");
    const input = body.querySelector(`tr[data-id="${id}"] [data-key="${key}"]`);
    if (input) input.focus();
  }
}

function escapeAttr(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function renderCompare() {
  const dock = $("compare-dock");
  if (dock.hidden) return;
  const key = state.variants.map((variant) => `${variant.id}:${variant.metrics.stalls}:${variant.metrics.valid}:${variant.recommended}:${variant.maxStalls}`).join("|") + `#${state.variantIndex}#${isReference()}`;
  if (key === compareKey && dock.childElementCount) {
    dock.querySelectorAll(".compare-card").forEach((card, index) => {
      card.classList.toggle("on", index === state.variantIndex);
    });
    return;
  }
  compareKey = key;
  dock.innerHTML = "";
  state.variants.forEach((variant, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `compare-card${index === state.variantIndex ? " on" : ""}${variant.recommended ? " best" : ""}`;
    const canvas = document.createElement("canvas");
    const metrics = variant.metrics;
    const tags = [
      variant.recommended ? '<span class="tag">추천</span>' : "",
      variant.maxStalls ? '<span class="tag max">최대 주차칸</span>' : "",
      variant.complex || variant.loopFirst ? '<span class="tag">단지형</span>' : "",
      variant.uniform ? '<span class="tag uniform">방향 통일</span>' : "",
      variant.coreSide ? '<span class="tag uniform">장애인 코어 인접</span>' : "",
      variant.coreRamp ? '<span class="tag uniform">코어 램프 인접</span>' : "",
    ].filter(Boolean).join(" ");
    const access = Array.isArray(metrics.coreAccess)
      ? ` · 동 접근 ${metrics.coreAccess.map((ok, i) => `${i + 1}${ok ? "✓" : "✗"}`).join(" ")}`
      : "";
    const links = metrics.links ? ` · 연결 ${metrics.links}` : "";
    button.innerHTML = `<p>${tags ? `${tags} ` : ""}${variant.id} ${variant.name}<br>${metrics.stalls}대 · ${metrics.areaPerStall.toFixed(1)}㎡/대${isReference() ? ` · 유사 ${metrics.similarity}` : ""}<br>${metrics.connected ? "연결" : "끊김"} · 충돌 ${metrics.columnHits} · 막다른 ${metrics.deadEnds}${access}${links}${metrics.valid ? "" : ` · 탈락 ${metrics.rejected}`}</p>`;
    button.prepend(canvas);
    button.addEventListener("click", () => applyVariant(index));
    dock.appendChild(button);
    drawThumb(canvas, variant);
  });
}

function renderPicks() {
  const list = $("opening-list");
  const items = [
    ...state.openings.filter((opening) => !opening.linkedRamp).map((opening) => ({
      type: "opening",
      id: opening.id,
      text: `${opening.kind === "in" ? "입구" : "출구"} · ${edgeName[opening.edge]}측 ${opening.t.toFixed(1)}m`,
    })),
    ...state.ramps.map((ramp, index) => ({
      type: "ramp",
      id: ramp.id,
      text: `램프 ${index + 1} · ${edgeName[ramp.edge]}측 ${ramp.t.toFixed(1)}m · 폭 ${ramp.width}m${state.openings.some((o) => o.linkedRamp === ramp.id) ? " · 출입구 겸용(양방향)" : ""}`,
    })),
  ];
  list.innerHTML = items.map((item) => {
    const on = state.selection && state.selection.type === item.type && state.selection.id === item.id;
    return `<li><button type="button" data-type="${item.type}" data-id="${item.id}" class="${on ? "on" : ""}">${item.text}</button></li>`;
  }).join("");
  list.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      selectItem({ type: button.dataset.type, id: Number(button.dataset.id) });
    });
  });
}

function toolStatus() {
  if (state.tool === "core" || state.tool === "pan" || state.tool === "ramp") return "코어·램프·출입구는 끌어 옮기고, 빈 곳을 끌면 화면 이동, 휠로 확대합니다.";
  if (state.tool === "entrance") return "외곽을 클릭해 입구를 추가하세요. 다 했으면 '입구 추가'를 다시 눌러 끄세요.";
  if (state.tool === "exit") return "외곽을 클릭해 출구를 추가하세요. 다 했으면 '출구 추가'를 다시 눌러 끄세요.";
  if (state.tool === "ramp") return "외곽을 클릭하면 램프를 그 자리로 옮깁니다(램프는 2차로 양방향 1개). 점선 차로를 따라 램프까지 회차할 수 있습니다.";
  return "드래그해서 화면을 이동하세요.";
}

function inputsValid() {
  return state.parkWidth >= 18 && state.parkWidth <= 300
    && state.parkDepth >= 18 && state.parkDepth <= 300
    && state.columnSpacing >= 5 && state.columnSpacing <= 12
    && !parseSpans(state.spansX).error && !parseSpans(state.spansY).error
    && floorHeightOk();
}

/** 유효높이(층고 − 슬래브)가 차로 기준 2.3m 이상이고, 층고가 6m 이하인지 */
function floorHeightOk() {
  const h = Number(state.floorHeight);
  return h > 0 && h <= 6 && clearHeightOf(h) >= needClear() - 1e-9;
}

// 차로 유효높이 기준: 공동주택 + 지상공원형이면 2.7m, 아니면 2.3m
function needClear() {
  return requiredClearHeight({ apartment: Boolean(state.demand.active && state.demand.active.apartment), noGroundAccess: state.noGroundAccess });
}

function showZoneCurrent() {
  const el = $("zone-current");
  if (!el) return;
  const zone = (zoneFactors[$("zone").value] || {}).label || "";
  const region = (housingAreaDivisor[$("region").value] || {}).label || "";
  const auto = !$("zone-auto").hidden ? " (주소로 자동)" : "";
  el.textContent = `용도지역 ${zone} · 지역 ${region}${auto}`;
}

function buildDemandForm() {
  $("zone").innerHTML = Object.entries(zoneFactors).map(([id, zone]) => `<option value="${id}">${zone.label}</option>`).join("");
  $("region").innerHTML = Object.entries(housingAreaDivisor).map(([id, region]) => `<option value="${id}">${region.label}</option>`).join("");
  $("zone").value = state.demand.zone;
  $("region").value = state.demand.region;
  $("project-name").value = state.demand.projectName;
  $("ordinance").value = String(state.demand.ordinance);
  $("area-per-stall").value = String(state.demand.areaPerStall);
  $("planned-floors").value = String(state.demand.plannedFloors);
  renderUseList();
  showZoneCurrent();
  const read = () => {
    const zoneChanged = state.demand.zone !== $("zone").value || state.demand.region !== $("region").value;
    state.demand.zone = $("zone").value;
    state.demand.region = $("region").value;
    if (zoneChanged) renderUseList();
    showZoneCurrent();
    state.demand.projectName = $("project-name").value;
    const ordinance = numberOr($("ordinance").value, 1);
    state.demand.ordinance = Math.min(1.5, Math.max(0.5, ordinance));
    $("ordinance").classList.toggle("bad", ordinance < 0.5 || ordinance > 1.5);
    state.demand.areaPerStall = numberOr($("area-per-stall").value, 33);
    state.demand.plannedFloors = Math.max(1, Math.round(numberOr($("planned-floors").value, 1)));
    emit();
  };
  // 주차대수 산정 고급 설정 창
  $("open-demand-dialog").addEventListener("click", () => $("demand-dialog").showModal());
  $("close-demand-dialog").addEventListener("click", () => { $("demand-dialog").close(); render(); });
  // 기둥 고급 설정 창
  $("open-column-dialog").addEventListener("click", () => $("column-dialog").showModal());
  $("open-disabled-dialog").addEventListener("click", () => $("disabled-dialog").showModal());
  $("close-disabled-dialog").addEventListener("click", () => { $("disabled-dialog").close(); render(); });
  $("close-column-dialog").addEventListener("click", () => {
    $("column-dialog").close();
    if (wizardSlide === 6 && !state.columnAuto) { applyManualSpans(); emit(); }
    render();
  });
  // 설정 창은 3단계 슬라이드 안에 있어서, 다른 단계에서 열면 안 보임 → body 바로 아래로 옮김
  ["column-dialog", "disabled-dialog", "demand-dialog"].forEach((id) => { const d = $(id); if (d && d.parentElement !== document.body) document.body.appendChild(d); });
  // 크기 추천: 법정 대수 × 1대당 면적 ÷ 계획 지하층 수 → 기둥 간격 배수로 맞춘 가로·세로를 칸에 채움
  $("suggest-size").addEventListener("click", () => {
    state.sizeSet = true;
    const demand = demandResult();
    if (!demand.legalStalls) {
      $("suggest-note").textContent = "용도와 세대수(또는 시설면적)를 먼저 넣어 주세요.";
      return;
    }
    const rec = demand.recommended;
    state.parkWidth = rec.width;
    state.parkDepth = rec.depth;
    $("park-width").value = String(rec.width);
    $("park-depth").value = String(rec.depth);
    $("suggest-note").textContent = `→ ${rec.width}×${rec.depth}m (${demand.legalStalls}대 × ${demand.areaPerStall}㎡ ÷ ${demand.plannedFloors}층)`;
    emit();
  });
  // 주소 → 용도지역 조회(브이월드 + OSM 폴백). 지도 클릭으로도 채운다.
  const squash = (s) => String(s || "").replace(/\s+/g, "");
  const applyZoningResult = async (r, { openMap = true } = {}) => {
    const box = $("zone-result");
    box.hidden = false;
    state.demand.siteAddress = r.address;
    state.demand.siteZones = r.zones || [];
    if (r.point && Number.isFinite(r.point.x) && Number.isFinite(r.point.y)) {
      state.demand.sitePoint = { x: r.point.x, y: r.point.y };
    }
    if (r.address) $("site-address").value = r.address;
    if (r.address) { state.demand.projectName = r.address; $("project-name").value = r.address; }   // 도면 제목 = 주소
    const region = regionFromAddress(r.address);
    if (region) {
      $("region").value = region;
      $("region").disabled = true;
      $("zone-auto").hidden = false;
    }
    const eum = r.eumUrl || (r.point ? eumLandUrl(r.point.x, r.point.y) : eumLandUrl());
    const eumLine = `<p class="note"><a href="${eum}" target="_blank" rel="noopener">토지이음·부동산 열람에서 용도지역 확인</a></p>`;

    if (r.notFound) {
      box.className = "zone-result warn";
      box.innerHTML = `<p>주소를 찾지 못했습니다. «지도에서 찾기»로 위치를 고르거나 도로명·지번을 다시 넣어 보세요.</p>${eumLine}`;
      return;
    }

    let site = null;
    if (r.point) {
      try { site = await parcelAt(r.point.x, r.point.y); } catch (_) { site = null; }
    }
    let access = null;
    try { access = await roadAccess(site); } catch (_) { access = null; }
    // 외곽 그리기(지도 위)·'대지 경계에서 안쪽으로'에 쓰려고 필지를 기억
    state.demand.siteParcel = site;
    state.demand.siteAccess = access;
    state.siteParcel = parcelMeters(site, r.point);
    if (access && access.main) {
      $("road-edge").value = access.main;
      $("road-edge").dispatchEvent(new Event("change"));
    }

    if (!r.zones.length) {
      box.className = "zone-result warn";
      $("zone").disabled = false;
      box.innerHTML = `<p>${r.address}</p><p>좌표는 찾았습니다. 용도지역 레이어를 아직 받지 못했습니다. 지도에서 줌인(15+)해 색을 확인하거나 «상세 입력»·토지이음에서 고르세요.</p>${eumLine}`
        + (r.point ? `<p class="cx-open"><button type="button" class="ghost tiny" data-cx="map">지도 열기</button></p>` : "");
      box.querySelectorAll("[data-cx]").forEach((b) => b.addEventListener("click", async () => {
        const { openContext } = await loadContext();
        openContext(r.point, site, "map", r.address, access);
      }));
      if (openMap && r.point) {
        const { openContext } = await loadContext();
        openContext(r.point, site, "map", r.address, access);
      }
      read();
      return;
    }

    const lines = r.zones.map((z) => {
      const l = r.limits[z];
      return `<li><b>${z}</b>${l ? ` · 건폐율 ${l.bcr}% 이하 · 용적률 ${l.far}% 이하` : ""}</li>`;
    }).join("");
    const multi = r.zones.length > 1 ? "<p>필지가 둘 이상의 용도지역에 걸쳐 있을 수 있습니다.</p>" : "";
    const fmt = (v) => Math.round(v).toLocaleString("ko-KR");
    const lim = r.limits[r.zones[0]];
    const areaLine = site && site.area
      ? `<p>필지 ${site.address || ""}${site.jimok ? ` · ${site.jimok}` : ""} · <b>대지면적 ${fmt(site.area)}㎡</b>${lim ? ` → 건축면적 상한 약 ${fmt(site.area * lim.bcr / 100)}㎡ · 연면적 상한 약 ${fmt(site.area * lim.far / 100)}㎡` : ""}</p>`
      : "";
    const accessLine = access && access.sides && access.sides.length
      ? `<p>도로 접면: ${access.sides.map((sd) => `<b>${sd.label}</b> 약 ${sd.len}m`).join(" · ")}</p>`
      : "";
    const src = r.source === "nominatim" || r.source === "photon"
      ? "OpenStreetMap"
      : r.source === "map" ? "지도 선택" : "브이월드";
    box.className = "zone-result";
    box.innerHTML = `<p>${r.address} <span class="hint">(${src})</span></p><ul>${lines}</ul>${multi}${areaLine}${accessLine}`
      + `<p class="note">건폐율·용적률은 국토계획법 시행령 상한입니다. 실제 값은 시·군 조례로 더 낮을 수 있습니다.</p>${eumLine}`
      + `<p class="cx-open">주변 보기 <button type="button" class="ghost tiny" data-cx="map">지도</button> <button type="button" class="ghost tiny" data-cx="2d">2D</button> <button type="button" class="ghost tiny" data-cx="3d">3D</button></p>`;
    box.querySelectorAll("[data-cx]").forEach((b) => b.addEventListener("click", async () => {
      const { openContext } = await loadContext();
      openContext(r.point, site, b.dataset.cx, r.address, access);
    }));
    if (openMap && r.point) {
      const { openContext } = await loadContext();
      openContext(r.point, site, "map", r.address, access);
    }

    const hit = Object.entries(zoneFactors).find(([, z]) => r.zones.some((name) => squash(name) === squash(z.label)));
    if (hit) $("zone").value = hit[0];
    if (region) $("region").value = region;
    $("zone").disabled = Boolean(hit);
    $("region").disabled = Boolean(region);
    $("zone-auto").hidden = !(hit || region);
    read();
  };

  const lookup = async () => {
    const address = $("site-address").value.trim();
    const box = $("zone-result");
    if (!address) {
      box.hidden = false;
      box.className = "zone-result warn";
      box.innerHTML = `주소를 넣거나 <button type="button" class="ghost tiny" id="zone-open-map-hint">지도에서 찾기</button>를 누르세요.`;
      $("zone-open-map-hint")?.addEventListener("click", () => $("map-pick").click());
      return;
    }
    box.hidden = false;
    box.className = "zone-result";
    box.textContent = "조회 중…";
    $("zone-lookup").disabled = true;
    try {
      const r = await lookupZoning(address);
      await applyZoningResult(r);
    } catch (e) {
      box.className = "zone-result warn";
      const fallback = e && e.fallback;
      if (fallback) {
        state.demand.siteAddress = fallback.address;
        const region = fallback.region || regionFromAddress(fallback.address);
        if (region) {
          $("region").value = region;
          $("region").disabled = true;
          $("zone-auto").hidden = false;
        }
        $("zone").disabled = false;
        const eum = fallback.eumUrl || eumLandUrl();
        box.innerHTML = `<p>${fallback.address}</p><p>${e.message}</p>`
          + `<p class="note">«지도에서 찾기»로 위치를 고르거나 <a href="${eum}" target="_blank" rel="noopener">토지이음</a>·상세 입력에서 용도지역을 고르세요.</p>`;
        read();
      } else {
        box.textContent = `조회 실패: ${e && e.message ? e.message : e}. «지도에서 찾기» 또는 상세 입력을 이용해 주세요.`;
      }
    } finally {
      $("zone-lookup").disabled = false;
    }
  };
  $("zone-lookup").addEventListener("click", lookup);
  $("map-pick").addEventListener("click", async () => {
    const box = $("zone-result");
    box.hidden = false;
    box.className = "zone-result";
    box.textContent = "지도에서 대지를 클릭하세요. 휠로 확대하면 용도지역 색이 보입니다.";
    const known = state.demand?.sitePoint || null;
    const { openSitePicker, updatePickerMarker } = await loadContext();
    openSitePicker(known, async (pt) => {
      box.textContent = "선택한 위치 조회 중…";
      updatePickerMarker(pt, "선택 중…");
      try {
        const r = await lookupZoningAt(pt.x, pt.y);
        state.demand.sitePoint = r.point;
        updatePickerMarker(r.point, r.zones[0] || r.address);
        await applyZoningResult(r, { openMap: false });
      } catch (e) {
        box.className = "zone-result warn";
        box.textContent = `지도 조회 실패: ${e && e.message ? e.message : e}`;
      }
    });
  });
  loadContext().then(({ bindContextDialog }) => bindContextDialog());
  // 용도지역·지역 선택칸은 '상세 입력'을 열어야 보인다. 평소에는 현재 값만 한 줄로 보여 준다.
  $("open-zone-detail").addEventListener("click", () => {
    const box = $("zone-detail");
    box.hidden = !box.hidden;
    $("open-zone-detail").textContent = box.hidden ? "상세 입력" : "상세 입력 닫기";
  });
  $("zone-unlock").addEventListener("click", () => {
    $("zone").disabled = false;
    $("region").disabled = false;
    $("zone-auto").hidden = true;
    showZoneCurrent();
  });
  $("site-address").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); lookup(); } });
  ["zone", "region", "project-name", "ordinance", "area-per-stall", "planned-floors"].forEach((id) => {
    $(id).addEventListener("input", read);
    $(id).addEventListener("change", read);
  });
  $("use-form").addEventListener("change", (event) => {
    if (event.target.id !== "use-add" || !event.target.value) return;
    state.demand.active[event.target.value] = true;
    renderUseList();
    emit();
  });
  $("use-form").addEventListener("input", (event) => {
    const areaId = event.target.dataset.area;
    if (areaId) state.demand.areas[areaId] = numberOr(event.target.value, 0);
    const bandUse = event.target.dataset.band;
    if (bandUse) {
      const band = state.demand.bands[bandUse][Number(event.target.dataset.index)];
      band[event.target.dataset.key] = numberOr(event.target.value, 0);
    }
    if (areaId || bandUse) emit();
  });
  $("use-form").addEventListener("click", (event) => {
    const del = event.target.dataset.del;
    if (del) {
      state.demand.active[del] = false;
      renderUseList();
      emit();
      return;
    }
    const bandDel = event.target.dataset.bandDel;
    if (bandDel) {
      // 첫 구간은 남긴다(용도 자체를 지우려면 위의 × 사용)
      const list = state.demand.bands[bandDel];
      const index = Number(event.target.dataset.index);
      if (list.length > 1 && index > 0) list.splice(index, 1);
      document.querySelector(`[data-fields="${bandDel}"]`).innerHTML = "";
      syncUseFields();
      emit();
      return;
    }
    const add = event.target.dataset.add;
    if (!add) return;
    state.demand.bands[add].push({ count: 0, area: 84 });
    document.querySelector(`[data-fields="${add}"]`).innerHTML = "";
    syncUseFields();
    emit();
  });
}

// 용도지역에 따라 고를 수 있는 용도만 보여 준다. 조례로만 가능한 용도는 "조례 확인" 표시, 불가 용도는 숨기고 한 줄로 알림.
function renderUseList() {
  const zone = state.demand.zone;
  const region = state.demand.region;
  const zoneLabel = (zoneFactors[zone] || {}).label || "";
  const shown = uses.filter((use) => zoneUseStatus(zone, use.id, region).s !== "no");
  const hidden = uses.filter((use) => zoneUseStatus(zone, use.id, region).s === "no");
  hidden.forEach((use) => { state.demand.active[use.id] = false; });
  const tag = (use) => {
    const st = zoneUseStatus(zone, use.id, region);
    const parts = [];
    if (st.s === "ord") parts.push(`<span class="zone-tag ord">조례 확인</span>`);
    if (st.seoul) parts.push(`<span class="zone-tag seoul">서울 조례</span>`);
    if (st.note) parts.push(`<span class="zone-note">${st.note}</span>`);
    return parts.join(" ");
  };
  const active = shown.filter((use) => state.demand.active[use.id]);
  const addable = shown.filter((use) => !state.demand.active[use.id]);
  const option = (use) => {
    const st = zoneUseStatus(zone, use.id, region);
    return `<option value="${use.id}">${use.label}${st.s === "ord" ? " (조례 확인)" : ""}</option>`;
  };
  // 용도는 드롭다운에서 골라 추가하고, 추가된 용도마다 입력 카드가 생긴다(× 로 삭제).
  $("use-form").innerHTML = `
    <label>용도
      <select id="use-add">
        <option value="">${active.length ? "+ 용도 추가" : "용도를 선택하세요"}</option>
        ${addable.map(option).join("")}
      </select>
    </label>`
    + active.map((use) => `
    <div class="use-card">
      <div class="use-head"><strong>${use.label}</strong> ${tag(use)}
        <button type="button" class="ghost tiny use-del" data-del="${use.id}" aria-label="${use.label} 삭제">×</button></div>
      <div class="use-fields" data-fields="${use.id}"></div>
    </div>`).join("")
    + (hidden.length ? `<p class="hint">${zoneLabel}에서 불가: ${hidden.map((use) => use.label).join(", ")} <span class="info" tabindex="0" title="${region === "seoul" ? "서울특별시 도시계획 조례 별표 4~10 반영(2026.7.13 시행본)." : "국토계획법 시행령 별표 4~10 개략. '조례 확인'은 해당 시·군 도시계획조례로 확인."} 도로 폭·면적 같은 세부 조건은 원문 확인.">ⓘ</span></p>` : "");
  syncUseFields();
}

function syncUseFields() {
  uses.forEach((use) => {
    const box = document.querySelector(`[data-fields="${use.id}"]`);
    if (!box || !state.demand.active[use.id] || box.childElementCount) return;
    if (use.kind === "housing") {
      const countLabel = state.siteType === "complex" && use.id === "apartment" ? "단지 전체 세대수" : "세대수";
      box.innerHTML = state.demand.bands[use.id].map((band, index) => `
        <div class="band-row">
          <label>${countLabel} <input data-band="${use.id}" data-index="${index}" data-key="count" type="number" min="0" step="1" value="${band.count}" /></label>
          <label>전용면적 <input data-band="${use.id}" data-index="${index}" data-key="area" type="number" min="0" step="1" value="${band.area}" /></label>
          ${index > 0 ? `<button type="button" class="ghost tiny band-del" data-band-del="${use.id}" data-index="${index}" aria-label="구간 ${index + 1} 삭제" title="이 구간 삭제">×</button>` : `<span class="band-del-space"></span>`}
        </div>
      `).join("") + `<button type="button" class="ghost tiny" data-add="${use.id}">구간 추가</button>`;
    } else {
      box.innerHTML = `<label>시설면적 (㎡) <input data-area="${use.id}" type="number" min="0" step="1" value="${state.demand.areas[use.id] || 0}" /></label>`;
    }
  });
}

function renderDemand(info) {
  const demand = info.demand;
  const body = demand.rows.map((row) => `<tr><td>${row.use}</td><td>${row.basis}</td><td>${row.input}</td><td>${row.stalls}</td></tr>`).join("");
  $("demand-table").innerHTML = `<thead><tr><th>용도</th><th>산정 기준</th><th>입력값</th><th>대수</th></tr></thead><tbody>${body}</tbody>`;
  const recommend = `${demand.recommended.width.toFixed(0)}×${demand.recommended.depth.toFixed(0)}m`;
  const placed = info.placed;
  const byPlaced = placed ? Math.max(1, Math.ceil(demand.legalStalls / placed)) : demand.neededFloors;
  $("demand-note").textContent = `법정 필요 ${demand.legalStalls}대 · 실제 배치 ${state.plate ? placed : "—"}대 · 배치 기준 지하 ${state.plate && placed ? byPlaced : "—"}층 · 추천 평면 ${recommend}. 확인 ${demand.checkedOn}.`;
}

function floorPicker(count) {
  if (!count) return "";
  const buttons = [`<button type="button" data-floor="all" class="${state.floorView === "all" ? "on" : ""}">전체</button>`];
  for (let level = 0; level < count; level += 1) {
    buttons.push(`<button type="button" data-floor="${level}" class="${state.floorView === level ? "on" : ""}">B${level + 1}</button>`);
  }
  return buttons.join("");
}

function sheetFloor() {
  return state.floorView === "all" ? 0 : state.floorView;
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function setIfIdle(input, value) {
  if (!input) return;
  if (document.activeElement === input) return;
  input.value = String(Math.round(value * 10) / 10);
}

function formatMeters(value) {
  return `${Number(value).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}m`;
}

function formatArea(value) {
  return `${Math.round(value).toLocaleString("ko-KR")}㎡`;
}

function statList(rows, strongIndex = -1) {
  return rows
    .map(([label, value], index) => `<div class="${index === strongIndex ? "strong" : ""}"><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("");
}

function floorStack(count) {
  if (!count) return "";
  const shown = Math.min(count, 8);
  const chips = ['<span class="grade">지상</span>'];
  for (let level = 1; level <= shown; level += 1) chips.push(`<span>지하 ${level}층</span>`);
  if (count > shown) chips.push(`<span>… 지하 ${count}층까지</span>`);
  return chips.join("");
}


/** 구획 규칙이 이번 조건에 적용되는지 알려주는 안내문 */
function autoRampLength() {
  const legal = currentStallRules().legalStalls;
  return minStraightRampLength(state.floorHeight, rampTransitions({ legalStalls: legal }));
}

function autoRampWidth() {
  // 양방향 2차로: 직선만이면 6m, 내부 램프가 곡선으로 꺾이면 6.5m (주차장법 시행규칙 제6조①5 다목)
  const ramp = selectedRamp() || state.ramps[0];
  if (!ramp || !state.plate || ramp.placement === "external") return 6;
  return rampShape({ ...ramp, width: 6 }, state.plate).kind === "curved" ? 6.5 : 6;
}

// 예시 도면을 불러왔을 때만 "유사도"를 보여 준다(예시 도면과 비교한 점수라 직접 만든 평면에선 의미 없음).
function isReference() {
  return Boolean(state.referenceNotes && state.referenceNotes.length);
}

function typeReadout() {
  if (!$("stall-types").checked) return "일반형(2.5×5.0m)만 배치합니다.";
  const rules = currentStallRules();
  if (rules.legalStalls < 10) return "장애인 구획 의무 없음(10대 미만)";
  const t = stallRuleTargets(rules);
  const note = $("eco-note");
  if (note) note.textContent = `친환경자동차법 시행령 제18조의5·6: 총주차대수 50대 이상인 100세대 이상 아파트·공중이용시설(업무·판매·숙박·문화·의료·위락)은 신축 5% 이상(시·도 조례). 지금 조건: ${rules.ecoAuto ? `대상 (${rules.ecoBasis})` : rules.legalStalls < 50 ? "대상 아님 (50대 미만)" : "대상 아님 (아파트 100세대 미만·공중이용시설 없음)"}. 램프 도착 쪽에 모아 배치.`;
  const parts = [`장애인 ${Math.round(rules.disabledRate * 100)}%`];
  if (t.extendedRate) parts.push("확장형 30%");
  if (t.ecoRate) parts.push(`친환경차 ${Math.round(t.ecoRate * 100)}%`);
  return parts.join(" · ");
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
