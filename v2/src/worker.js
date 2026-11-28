// 무거운 배치 계산(추천 3안·코어 자리 찾기)을 화면과 따로 돌린다 — "페이지가 응답하지 않습니다" 방지.
import { state, recommendLayouts, autoPlaceCore, scoreGridBatch, fullGridVariants, verifyGridBatch } from "./state.js?v=365";

const ops = { recommend: recommendLayouts, autoCore: autoPlaceCore, gridBatch: scoreGridBatch, gridFull: fullGridVariants, gridVerify: verifyGridBatch };

self.onmessage = (e) => {
  const { id, op, snap, args = [] } = e.data;
  try {
    Object.assign(state, snap);
    ops[op](...args);
    if (op === "gridBatch" || op === "gridFull" || op === "gridVerify") self.postMessage({ id, ok: true, snap: { gridResults: state.gridResults } });
    else self.postMessage({ id, ok: true, snap: state });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String((error && error.stack) || error) });
  }
};
