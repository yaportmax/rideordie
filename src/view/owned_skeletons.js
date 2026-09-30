// SkeletonUtils clones own their Skeletons, but still share asset geometry,
// materials and bone inverses. Record ownership before moving/removing meshes.
const owners = new WeakMap();
const disposed = new WeakSet();

/** Register only a fresh SkeletonUtils/Assets clone, never an asset blueprint. */
export function ownClonedSkeletons(root) {
  if (root && !owners.has(root)) {
    const skeletons = new Set();
    root.traverse(o => { if (o.isSkinnedMesh) skeletons.add(o.skeleton); });
    owners.set(root, skeletons);
  }
  return root;
}

/** Release this exact clone's skeletons, including meshes moved off its graph. */
export function disposeOwnedSkeletons(root) {
  const skeletons = root && owners.get(root);
  if (!skeletons) return 0;
  let count = 0;
  for (const skeleton of skeletons) {
    if (disposed.has(skeleton)) continue;
    disposed.add(skeleton); skeleton.dispose(); count++;
  }
  skeletons.clear();
  return count;
}

/** A temporary warm-up group owns all registered clone roots it contains. */
export function disposeOwnedSkeletonsIn(group) {
  let count = 0;
  group?.traverse(root => { count += disposeOwnedSkeletons(root); });
  return count;
}
