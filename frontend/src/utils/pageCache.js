// ============================================================
// pageCache.js
// Every page (Dashboard, Customers, Payments, ...) fetches its
// own data on mount, which used to mean a "Loading..." flash
// every single time you switched sections - even if you'd just
// been on that page seconds ago. This cache holds the last
// successful response for each page in memory (it resets on a
// full browser reload, which is fine - it's just here to make
// in-app navigation feel instant). Pages read from it to render
// immediately, then quietly re-fetch fresh data underneath.
// ============================================================

const store = new Map();

export function getPageCache(key) {
  return store.has(key) ? store.get(key) : undefined;
}

export function setPageCache(key, value) {
  store.set(key, value);
}
