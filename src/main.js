import { CLEAR_HEIGHT, SLAB_T, clearHeightOf, minStraightRampLength, rampPositionCheck, rampShape, rampTransitions, recommendCoreCells, stallsPerBay } from "./layout.js?v=163";
import { housingAreaDivisor, uses, zoneFactors, zoneUseStatus } from "./parkingRules.js?v=163";
import { drawThumb, mountPlan } from "./plan.js?v=163";
import { downloadBlob, drawSheet, printSheet, sheetSvg } from "./sheet.js?v=163";
import { addCore, applyVariant, autoPlaceCore, currentStallRules, demandResult, emit, generatePlate, loadReference, parseSpans, placeOverlapExample, placeSplitExample, readyFor3d, removeSelection, selectCore, selectItem, selectedOpening, selectedRamp, setReveal, setStep, setTool, state, subscribe, summary, updateCore, updateCoreArea, updateEntranceWidth, updateRampSize, updateSiteMargins, plateFromState } from "./state.js?v=163";

const $ = (id) => document.getElementById(id);
const edgeName = { s: "남", n: "북", w: "서", e: "동" };

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
  state.parkWidth = numberOr(fields.width.value, state.parkWidth);
  render();
});
fields.depth.addEventListener("input", () => {
  state.parkDepth = numberOr(fields.depth.value, state.parkDepth);
  render();
});
fields.spacing.addEventListener("input", () => {
  state.columnSpacing = numberOr(fields.spacing.value, state.columnSpacing);
  render();
});
$("column-size").addEventListener("input", () => {
  const size = numberOr($("column-size").value, state.columnWidth);
  state.columnWidth = size;
  state.columnDepth = size;
  render();
});
$("min-clear").addEventListener("input", () => {
  state.minClear = numberOr($("min-clear").value, state.minClear);
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
$("site-margin").addEventListener("input", () => {
  updateSiteMargins(numberOr($("site-margin").value, state.siteMargin));
});
["n", "s", "e", "w"].forEach((k) => {
  $(`margin-${k}`).addEventListener("input", () => {
    const v = $(`margin-${k}`).value.trim();
    updateSiteMargins(null, { [k]: v === "" ? null : Math.max(0, numberOr(v, 0)) });
  });
});
$("open-margin-dialog").addEventListener("click", () => $("margin-dialog").showModal());
$("close-margin-dialog").addEventListener("click", () => { $("margin-dialog").close(); render(); });
$("road-edge").addEventListener("change", () => {
  state.roadEdge = $("road-edge").value;
  render();
});
$("ramp-pos").addEventListener("change", () => {
  state.rampPos = $("ramp-pos").value;
  render();
});

// 도로 변에 따라 램프 위치 이름을 바꾼다: 남·북 변 → 왼쪽/가운데/오른쪽, 서·동 변 → 아래쪽/가운데/위쪽
function rampPosOptions(edge) {
  const horizontal = edge === "n" || edge === "s";
  return [
    ["auto", "자동 (대수 최대)"],
    ["start", horizontal ? "왼쪽 (서)" : "아래쪽 (남)"],
    ["mid", "가운데"],
    ["end", horizontal ? "오른쪽 (동)" : "위쪽 (북)"],
  ];
}

// 위치마다 램프가 들어가는지 미리 확인해 선택칸에 "(불가: 경사 초과)"처럼 표시한다.
let rampCheckKey = "";
let rampCheck = {};
function renderRampPos() {
  const select = $("ramp-pos");
  const plate = plateFromState();
  const key = [state.roadEdge, plate.width, plate.depth, plate.spacing, state.floorHeight, state.rampPlacement, plate.legalStalls].join("|");
  if (key !== rampCheckKey) {
    rampCheckKey = key;
    try { rampCheck = rampPositionCheck(plate, state.rampPlacement, state.floorHeight); } catch (error) { rampCheck = {}; }
    select.innerHTML = rampPosOptions(state.roadEdge).map(([value, label]) => {
      const why = rampCheck[value];
      return `<option value="${value}">${label}${why ? ` (불가: ${why})` : ""}</option>`;
    }).join("");
  }
  if (document.activeElement !== select) select.value = state.rampPos;
  const why = rampCheck[state.rampPos];
  $("ramp-pos-note").textContent = why
    ? `이 크기에서는 이 위치에 램프가 들어가지 않습니다(${why}). 자동이나 다른 위치를 고르세요.`
    : "";
}
$("ramp-placement").addEventListener("change", () => {
  state.rampPlacement = $("ramp-placement").value;
  render();
});
$("entrance-mode").addEventListener("change", () => {
  state.entranceMode = $("entrance-mode").value;
  render();
});
$("circulation").addEventListener("change", () => {
  state.circulation = $("circulation").value;
  render();
});
$("load-reference").addEventListener("click", () => {
  if (!inputsValid()) return;
  loadReference();
});

$("generate").addEventListener("click", () => {
  if (!inputsValid()) return;
  generatePlate();
});

document.querySelectorAll("#tools button").forEach((button) => {
  // 입구·출구 추가는 켜고 끄는 버튼. 끄면 기본(끌어 옮기기) 상태로 돌아간다.
  button.addEventListener("click", () => setTool(state.tool === button.dataset.tool ? "core" : button.dataset.tool));
});

fields.coreArea.addEventListener("change", () => updateCoreArea(Number(fields.coreArea.value)));
$("core-nx").addEventListener("change", () => updateCore({ nx: Number($("core-nx").value), ny: Number($("core-ny").value) }));
$("core-ny").addEventListener("change", () => updateCore({ nx: Number($("core-nx").value), ny: Number($("core-ny").value) }));
$("open-core-dialog").addEventListener("click", () => $("core-dialog").showModal());
$("auto-core").addEventListener("click", () => autoPlaceCore());
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
fields.rampLength.addEventListener("change", () => updateRampSize({ length: Number(fields.rampLength.value) }));

$("place-split").addEventListener("click", placeSplitExample);
$("place-overlap").addEventListener("click", placeOverlapExample);
$("add-core").addEventListener("click", addCore);
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
$("back-plan").addEventListener("click", () => setStep(2));
$("tab-model").addEventListener("click", () => { state.resultTab = "model"; emit(); });
$("tab-sheet").addEventListener("click", () => { state.resultTab = "sheet"; emit(); });
$("sheet-png").addEventListener("click", () => {
  const canvas = $("sheet");
  canvas.toBlob((blob) => downloadBlob("parking-plan.png", blob));
});
$("sheet-svg").addEventListener("click", () => {
  const info = summary();
  const svg = sheetSvg(state, { ...info, checkedOn: info.demand.checkedOn }, sheetFloor());
  downloadBlob("parking-plan.svg", new Blob([svg], { type: "image/svg+xml" }));
});
$("sheet-print").addEventListener("click", () => printSheet($("sheet")));
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
render();

let sceneMount = null;
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
    sceneMount = import("./scene.js?v=163")
      .then((module) => module.mountScene($("scene-root")))
      .catch((error) => {
        sceneMount = null;
        throw error;
      });
  }
  return sceneMount;
}

async function open3d() {
  if (!readyFor3d()) return;
  try {
    await ensureScene();
    setStep(3);
  } catch (error) {
    $("step2-error").hidden = false;
    $("step2-error").textContent = "3D 라이브러리를 불러오지 못했습니다. 네트워크 연결을 확인해 주세요.";
  }
}

function render() {
  const step = state.step;
  document.querySelectorAll(".pane").forEach((pane) => {
    pane.hidden = Number(pane.dataset.pane) !== step;
  });
  document.querySelectorAll("#steps li").forEach((item) => {
    const value = Number(item.dataset.step);
    item.classList.toggle("on", value === step);
    item.classList.toggle("done", value < step);
  });
  const showSheet = step === 3 && state.resultTab === "sheet";
  $("plan-view").hidden = step === 3;
  $("scene-view").hidden = step !== 3 || showSheet;
  $("sheet-view").hidden = !showSheet;
  $("sheet-tools").hidden = !showSheet;
  $("reset-camera").hidden = showSheet;

  const valid = inputsValid();
  $("generate").disabled = !valid;
  $("input-error").hidden = valid;
  if (!valid) {
    const sx = parseSpans(state.spansX).error;
    const sy = parseSpans(state.spansY).error;
    $("input-error").textContent = !floorHeightOk()
      ? `층고 ${state.floorHeight}m는 사용할 수 없습니다. 유효높이(층고 − 슬래브 ${SLAB_T}m)가 차로 기준 ${CLEAR_HEIGHT}m 이상이 되도록 ${(CLEAR_HEIGHT + SLAB_T).toFixed(2)}–6m로 입력하세요.`
      : sx ? `기둥 간격 가로: ${sx}. 쉼표로 구분한 3–15m 숫자로 입력하세요.`
      : sy ? `기둥 간격 세로: ${sy}. 쉼표로 구분한 3–15m 숫자로 입력하세요.`
        : "가로·세로는 18–300m, 기둥 간격은 5–12m로 입력하세요.";
  }
  $("spans-x").classList.toggle("bad", Boolean(parseSpans(state.spansX).error));
  $("floor-height").classList.toggle("bad", !floorHeightOk());
  {
    const clear = clearHeightOf(Number(state.floorHeight) || 0);
    const okText = clear >= CLEAR_HEIGHT - 1e-9 ? "✓" : "✗ 2.3m 미만";
    const tr = rampTransitions({ legalStalls: currentStallRules().legalStalls });
    const ease = [tr.top ? `윗부분 ${tr.top}m` : "", tr.bottom ? `아랫부분 ${tr.bottom}m` : ""].filter(Boolean).join("·");
    $("clear-readout").textContent = `유효높이 ${clear.toFixed(2)}m ${okText} (차로 2.3m 이상 필요) · 직선 램프 최소 ${minStraightRampLength(Number(state.floorHeight) || 0, tr)}m${ease ? ` (8.5% 구간: ${ease})` : ""}`;
  }
  $("spans-y").classList.toggle("bad", Boolean(parseSpans(state.spansY).error));

  const area = (state.parkWidth > 0 ? state.parkWidth : 0) * (state.parkDepth > 0 ? state.parkDepth : 0);
  const bay = stallsPerBay(state.columnSpacing, state.columnWidth, state.minClear);
  $("bay-readout").textContent = `구간당 ${bay.count}대, 이격 ${bay.gap.toFixed(2)}m (순간격 ${bay.clear.toFixed(2)}m)`;
  $("plate-preview").innerHTML = statList([
    ["주차장 크기", `${formatMeters(state.parkWidth)} × ${formatMeters(state.parkDepth)}`],
    ["주차장 면적", formatArea(area)],
    ["기둥 중심 간격", formatMeters(state.columnSpacing)],
    ["구간당 주차", `${bay.count}대 · 이격 ${bay.gap.toFixed(2)}m`],
  ]);
  $("type-readout").textContent = typeReadout();
  {
    const spanText = (v) => (v && String(v).trim() ? String(v).trim() : "기본");
    $("demand-summary").textContent = `조례 배율 ${state.demand.ordinance} · 크기 추천: 1대당 ${state.demand.areaPerStall}㎡, 지하 ${state.demand.plannedFloors}층`;
    $("column-summary").textContent = `단면 ${$("column-size").value}m · 이격 ${$("min-clear").value}m · 가로 간격 ${spanText($("spans-x").value)} · 세로 간격 ${spanText($("spans-y").value)}`;
  }
  setIfIdle(fields.width, state.parkWidth);
  setIfIdle(fields.depth, state.parkDepth);
  setIfIdle(fields.spacing, state.columnSpacing);
  setIfIdle($("floor-height"), state.floorHeight);
  setIfIdle($("column-size"), state.columnWidth);
  if (document.activeElement !== $("min-clear")) $("min-clear").value = Number(state.minClear).toFixed(2);
  setIfIdle($("site-margin"), state.siteMargin);
  if (document.activeElement !== $("ramp-placement")) $("ramp-placement").value = state.rampPlacement;
  if (document.activeElement !== $("road-edge")) $("road-edge").value = state.roadEdge;
  renderRampPos();
  $("site-margin-row").hidden = state.rampPlacement !== "external";
  {
    const sm = state.siteMargins || {};
    const show = (k) => (sm[k] == null ? `${state.siteMargin}` : `${sm[k]}*`);
    $("margin-summary").textContent = `북 ${show("n")} · 남 ${show("s")} · 서 ${show("w")} · 동 ${show("e")} m${["n", "s", "e", "w"].some((k) => sm[k] != null) ? " (*방향별)" : ""}`;
  }
  if (state.rampPlacement !== "external") state.entranceMode = "integrated";
  $("entrance-mode").disabled = state.rampPlacement !== "external";
  if (document.activeElement !== $("entrance-mode")) $("entrance-mode").value = state.entranceMode;
  if (document.activeElement !== $("circulation")) $("circulation").value = state.circulation;
  if (document.activeElement !== $("project-name")) $("project-name").value = state.demand.projectName;

  const info = summary();
  renderDemand(info);
  const rows = [
    ["법정 필요 대수", `${info.required}대`],
    ["실제 배치 대수", `${info.placed}대`],
    ["필요 지하층", info.floors ? `${info.floors}층` : "—"],
    ["총 주차대수", `${info.totalStalls}대`],
    ["1대당 면적", info.placed ? formatArea(info.areaPerStall) : "—"],
    ["유사도", state.metrics ? `${info.similarity}점` : "—"],
    ["차로 면적 비율", state.metrics ? `${Math.round(info.aisleRatio * 100)}%` : "—"],
    ["동선 연결", state.plate ? (info.connected ? "연결" : "끊김") : "—"],
  ];
  if (state.metrics && state.metrics.rampKind) {
    const ramp = state.ramps[0];
    const curved = state.metrics.rampKind === "curved";
    rows.push(["램프", curved ? `직선+곡선 ${state.metrics.rampTotal}m` : `직선 ${ramp ? ramp.length : "—"}m`]);
    if (!curved && Number.isFinite(state.metrics.rampLowerSlope)) rows.push(["지하층 사이 램프", `같은 길이 · 본 경사 ${(state.metrics.rampLowerSlope * 100).toFixed(1)}% (도로변 3m 해당 없음)`]);
  }
  if (state.metrics && state.trimDeadEnds) {
    rows.push(["진입 불가 제외", `${state.metrics.unreachable || 0}칸`]);
    rows.push(["정리한 막다른 차로", `${state.metrics.trimmedAisles || 0}곳`]);
  }
  if (info.stallTypes && info.stallTargets && info.stallTypes.total) {
    const c = info.stallTypes;
    const t = info.stallTargets;
    const mark = (have, need) => (need ? `${have}/${need}${have >= need ? "" : " ⚠"}` : `${have}`);
    rows.push(["장애인전용", mark(c.disabled, t.disabled)]);
    if (t.extended) rows.push(["확장형 (30%)", mark(c.extended, t.extended)]);
  }
  $("plan-stats").innerHTML = statList(rows, 3);
  $("scene-stats").innerHTML = statList(rows, 3);
  $("floor-stack").innerHTML = floorStack(info.floors);
  $("floor-picker").innerHTML = floorPicker(info.floors);
  if (showSheet) drawSheet($("sheet"), state, { ...info, checkedOn: info.demand.checkedOn }, sheetFloor());

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
    const len = ramp ? ramp.length : state.rampLength;
    const wid = ramp ? ramp.width : state.rampWidth;
    const auto = autoRampLength();
    const custom = Math.abs(len - auto) > 0.05 || Math.abs(wid - autoRampWidth()) > 0.05;
    $("ramp-summary").textContent = `램프 폭 ${wid}m · 길이 ${len}m ${custom ? `(직접 입력 · 자동 ${autoRampWidth()}m · ${auto}m)` : `(층고 ${state.floorHeight}m 기준 자동)`}`;
  }
  setIfIdle(fields.rampLength, ramp ? ramp.length : state.rampLength);
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
  $("compare-dock").hidden = step !== 2 || !state.variants.length;
  renderCompare();
  renderCorePick();

  const messages = [];
  if (!state.openings.length) messages.push("입구 또는 출구를 평면 외곽에 놓으세요.");
  if (!state.ramps.length) messages.push("램프를 평면 외곽에 놓으세요.");
  if (state.openings.length && state.ramps.length && !state.connected) {
    messages.push(...(state.issues.length ? state.issues.map((issue) => issue.label) : ["입구, 램프, 출구가 하나의 차로로 이어지지 않습니다."]));
  }
  $("step2-error").hidden = messages.length === 0;
  $("step2-error").textContent = messages.join(" ");
  $("to-3d").disabled = !readyFor3d();
  $("show-conflicts").classList.toggle("on", state.debugColumns);

  const stageText = ["", "외곽 주차칸", "순환 차로", "내부 베이", "기둥", "코어 우회", "동선 화살표"];
  const status = {
    1: "주차장 크기와 기둥 간격을 입력하거나, 아래 예시를 불러오세요.",
    2: state.revealStage < 6 ? `생성 과정: ${stageText[state.revealStage]}` : toolStatus(),
    3: info.floors
      ? `법정 ${info.required}대, 층당 ${info.placed}대라 지하 ${info.floors}층입니다.`
      : "한 층에 주차칸이 없어 지하층수를 계산하지 못했습니다.",
  };
  $("status").textContent = status[step];
}

function renderCorePick() {
  const select = $("core-pick");
  const markup = state.cores.map((core, index) => `<option value="${index}">코어 ${index + 1} · ${core.w.toFixed(1)}×${core.d.toFixed(1)}m</option>`).join("");
  if (select.innerHTML !== markup) select.innerHTML = markup;
  if (state.cores.length) select.value = String(state.coreIndex);
}

function renderCompare() {
  const dock = $("compare-dock");
  if (dock.hidden) return;
  const key = state.variants.map((variant) => `${variant.id}:${variant.metrics.stalls}:${variant.metrics.valid}:${variant.recommended}:${variant.maxStalls}`).join("|") + `#${state.variantIndex}`;
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
      variant.uniform ? '<span class="tag uniform">방향 통일</span>' : "",
      variant.coreSide ? '<span class="tag uniform">장애인 코어 인접</span>' : "",
    ].filter(Boolean).join(" ");
    button.innerHTML = `<p>${tags ? `${tags} ` : ""}${variant.id} ${variant.name}<br>${metrics.stalls}대 · ${metrics.areaPerStall.toFixed(1)}㎡/대 · 유사 ${metrics.similarity}<br>${metrics.connected ? "연결" : "끊김"} · 충돌 ${metrics.columnHits} · 막다른 ${metrics.deadEnds}${metrics.valid ? "" : ` · 탈락 ${metrics.rejected}`}</p>`;
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
  return h > 0 && h <= 6 && clearHeightOf(h) >= CLEAR_HEIGHT - 1e-9;
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
  const read = () => {
    const zoneChanged = state.demand.zone !== $("zone").value || state.demand.region !== $("region").value;
    state.demand.zone = $("zone").value;
    state.demand.region = $("region").value;
    if (zoneChanged) renderUseList();
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
  $("close-column-dialog").addEventListener("click", () => { $("column-dialog").close(); render(); });
  // 크기 추천: 법정 대수 × 1대당 면적 ÷ 계획 지하층 수 → 기둥 간격 배수로 맞춘 가로·세로를 칸에 채움
  $("suggest-size").addEventListener("click", () => {
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
    $("suggest-note").textContent = `${demand.legalStalls}대 × ${demand.areaPerStall}㎡ ÷ ${demand.plannedFloors}층 = 한 층 약 ${Math.round(demand.floorArea)}㎡ → ${rec.width}×${rec.depth}m (기둥 간격 배수). 바꾸려면 고급 설정에서 1대당 면적·지하층 수 조정.`;
    emit();
  });
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
    + (hidden.length ? `<p class="hint">${zoneLabel}에서 불가: ${hidden.map((use) => use.label).join(", ")}</p>` : "")
    + `<p class="hint">${region === "seoul" ? "서울특별시 도시계획 조례 별표 4~10 반영(2026.7.13 시행본)." : "국토계획법 시행령 별표 4~10 개략. \"조례 확인\"은 해당 시·군 도시계획조례로 확인."} 도로 폭·면적 같은 세부 조건은 원문 확인.</p>`;
  syncUseFields();
}

function syncUseFields() {
  uses.forEach((use) => {
    const box = document.querySelector(`[data-fields="${use.id}"]`);
    if (!box || !state.demand.active[use.id] || box.childElementCount) return;
    if (use.kind === "housing") {
      box.innerHTML = state.demand.bands[use.id].map((band, index) => `
        <div class="split">
          <label>세대수 <input data-band="${use.id}" data-index="${index}" data-key="count" type="number" min="0" step="1" value="${band.count}" /></label>
          <label>전용면적 <input data-band="${use.id}" data-index="${index}" data-key="area" type="number" min="0" step="1" value="${band.area}" /></label>
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

function typeReadout() {
  if (!$("stall-types").checked) return "일반형(2.5×5.0m)만 배치합니다.";
  const rules = currentStallRules();
  if (rules.legalStalls < 10) return "법정 10대 미만이라 장애인전용 구획은 의무가 아닙니다.";
  if (rules.legalStalls >= 50) return `장애인전용 ${Math.round(rules.disabledRate * 100)}% 이상(3.3×5.2m) · 확장형 30% 이상(2.6×5.2m, 법정 50대 이상). 비율을 바꾸면 평면을 다시 생성하세요.`;
  return `장애인전용 ${Math.round(rules.disabledRate * 100)}% 이상 (3.3×5.0m, 코어 가까이). 비율을 바꾸면 평면을 다시 생성하세요.`;
}
