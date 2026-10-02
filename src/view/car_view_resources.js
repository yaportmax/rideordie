// Only per-instance resources belong here. GLB template buffers, shared
// materials/textures and cached LOD geometry must never be registered.
const deferred = new WeakMap();

function renderedOutside(node, root) {
  for (let p = node; p; p = p.parent) {
    if (p === root) return false;
    if (p.isScene) return true;
  }
  return false; // A part retired before its car no longer needs GPU resources.
}

/** Release a detached part's retained per-instance resources at retirement. */
export function disposeCarViewNode(node) {
  node.traverse(mesh => {
    const records = deferred.get(mesh);
    if (!records) return;
    for (const record of [...records]) record.release(mesh);
  });
}

export class CarViewResources {
  constructor(warmMaterials) { this.users = new Map(); this.disposed = false; this.warmMaterials = warmMaterials; }
  own(resource, node) {
    // Shader prewarming needs a bounded boot owner after temporary meshes go
    // away. Runtime views have no such owner and release their own materials.
    if (resource.isMaterial && this.warmMaterials) { this.warmMaterials.add(resource); return; }
    let nodes = this.users.get(resource);
    if (!nodes) this.users.set(resource, nodes = new Set());
    nodes.add(node);
  }
  /** Attached resources are released immediately. A material shared between
   * surviving debris parts remains live until every such part is retired.
   */
  dispose(root) {
    if (this.disposed) return;
    this.disposed = true;
    for (const [resource, nodes] of this.users) {
      const pending = new Set([...nodes].filter(node => renderedOutside(node, root)));
      if (!pending.size) { resource.dispose(); continue; }
      const record = {
        release(node) {
          if (!pending.delete(node)) return;
          const set = deferred.get(node); set?.delete(record);
          if (!set?.size) deferred.delete(node);
          if (!pending.size) resource.dispose();
        },
      };
      for (const node of pending) {
        let set = deferred.get(node);
        if (!set) deferred.set(node, set = new Set());
        set.add(record);
      }
    }
    this.users.clear();
  }
}
