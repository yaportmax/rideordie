// Three's updateMatrixWorld walks descendants even when a root is invisible or
// matrixWorldAutoUpdate is false. These owned branches have no visible children
// while hidden, so the render walk can leave them alone until they reappear.
const installed = new WeakSet();

export function skipHiddenMatrixTraversal(root) {
  if (installed.has(root)) return root;
  installed.add(root);
  const update = root.updateMatrixWorld;
  let skipped = false;
  root.updateMatrixWorld = function(force) {
    if (!this.visible) { skipped = true; return; }
    update.call(this, force || skipped);
    skipped = false;
  };
  // Leave updateWorldMatrix untouched: explicit world-coordinate queries and
  // attach/detach operations must update hidden ancestors and requested bones.
  return root;
}
