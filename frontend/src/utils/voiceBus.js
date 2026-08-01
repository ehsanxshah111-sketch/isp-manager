// ============================================================
// voiceBus.js
// Minimal in-memory handoff between the voice controller and
// page components. Nothing here touches localStorage or the
// database - it just survives a single client-side navigation.
// ============================================================

let pendingCustomerTarget = null; // { name } | { customerId } | null
let pendingAction = null; // 'view' | 'add' | null

export function setPendingCustomerTarget(target, action = 'view') {
  pendingCustomerTarget = target;
  pendingAction = action;
}

export function consumePendingCustomerTarget() {
  const target = pendingCustomerTarget;
  const action = pendingAction;
  pendingCustomerTarget = null;
  pendingAction = null;
  return target ? { target, action } : null;
}
