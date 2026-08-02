// ============================================================
// bannerBus.js
// The sliding header banner text lives on the server (so every
// device/browser shows the same thing), but Layout (the header)
// and Settings (the editor) are two separate components mounted
// at the same time. This is a minimal pub/sub so saving on the
// Settings page updates the header immediately, without either
// component needing to poll or the page needing a full reload.
// ============================================================

const listeners = new Set();

export function subscribeBannerText(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function publishBannerText(text) {
  listeners.forEach((fn) => fn(text));
}
