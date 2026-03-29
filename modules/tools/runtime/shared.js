import { commitBlob } from "../../file-handler.js";

export function loadCurrentIntoCanvas(state, dom) {
  return new Promise((resolve, reject) => {
    dom.cropImage.onload = resolve;
    dom.cropImage.onerror = reject;
    dom.cropImage.src = state.current.previewUrl;
  });
}

export function getCurrentSnapshot(state) {
  return state.current ? { ...state.current } : null;
}

export function makeCommitCallback(rerenderCurrentImage) {
  return async (blob, label, name) => {
    await commitBlob(blob, label, name, async () => {
      await rerenderCurrentImage();
    });
  };
}
