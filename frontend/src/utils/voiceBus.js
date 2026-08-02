// ============================================================
// voiceBus.js
// Minimal in-memory handoff between the voice controller and
// page components. Nothing here touches localStorage or the
// database - it just survives a single client-side navigation.
//
// Two delivery paths are supported:
//  1. Fresh navigation (e.g. voice command said while on the
//     Dashboard) - the Customers page mounts fresh, reads the
//     pending target on mount, and opens the profile.
//  2. Already on the Customers page (e.g. "open Ali" said while
//     already viewing /customers) - navigating to the same route
//     does NOT remount the page, so nothing would ever consume
//     the pending target on mount. The subscribe/publish pair
//     below lets an already-mounted Customers page react
//     immediately instead of waiting for a mount that will
//     never happen.
// ============================================================

let pendingCustomerTarget = null; // { name } | { customerId } | null
let pendingAction = null; // 'view' | 'add' | null
const listeners = new Set();

export function setPendingCustomerTarget(target, action = 'view') {
  pendingCustomerTarget = target;
  pendingAction = action;
  // Notify anything already mounted right now (e.g. the Customers page
  // when the voice command was said while already viewing it).
  listeners.forEach((fn) => fn({ target, action }));
}

export function consumePendingCustomerTarget() {
  const target = pendingCustomerTarget;
  const action = pendingAction;
  pendingCustomerTarget = null;
  pendingAction = null;
  return target ? { target, action } : null;
}

// Called by the Customers page while it's mounted. Returns an unsubscribe
// function. The callback fires synchronously whenever a new voice target
// is set, whether or not a navigation/remount happens.
export function subscribeCustomerTarget(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
