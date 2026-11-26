// 무거운 배치 계산(평면 만들기·코어 자리 찾기·기준 사례)을 화면과 따로 돌린다.
// 계산하는 동안 페이지가 멈추지 않게(“페이지가 응답하지 않습니다” 방지).
import { state, generatePlate, autoPlaceCore, loadReference, setVariantOption } from "./state.js?v=306";

const ops = { generate: generatePlate, autoCore: autoPlaceCore, reference: loadReference, variantOption: (key, on) => setVariantOption(key, on) };

self.onmessage = (e) => {
  const { id, op, snap, args = [] } = e.data;
  try {
    Object.assign(state, snap);
    ops[op](...args);
    self.postMessage({ id, ok: true, snap: state });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String((error && error.stack) || error) });
  }
};
