export const FRIENDLY_STATUS = {
  gettingReady: "Getting things ready…",
  loadingImage: "Loading image…",
  preparingPreview: "Preparing preview…",
  applyingEffect: "Applying effect…",
  savingChanges: "Saving changes…",
  finishingUp: "Finishing up…",
  compositing: "Putting it all together…",
};

export function progressMessage({ key, defaultPhase } = {}) {
  const k = String(key ?? "");
  const isDownload = k.toLowerCase().includes("download");
  return isDownload ? FRIENDLY_STATUS.gettingReady : (defaultPhase ?? FRIENDLY_STATUS.applyingEffect);
}

