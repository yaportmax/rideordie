// Keep the sun's public shadow map and shader layout unchanged: cache static
// depth, copy it into the live map, then draw moving casters into that depth.
// Static and moving objects therefore occlude each other exactly as in one pass.
// This is deliberately limited to the WebGL2 PCF path used by this game.
import { PCFShadowMap } from 'three';

const STATIC_GROUPS = new Set(['terrain', 'dressing-pool', 'dressing-extras', 'set-pieces']);

export class StaticShadowCache {
  constructor(renderer, scene, light) {
    this.renderer = renderer; this.scene = scene; this.light = light;
    this.enabled = typeof renderer.getContext().blitFramebuffer === 'function';
    this.target = null; this.valid = false; this.copyValidated = false;
    this.static = []; this.dynamic = []; this.previous = []; this.records = new WeakMap();
    this.projection = new Float64Array(14); this.projection.fill(NaN);
    this.stats = { refreshes: 0, reuses: 0, staticCasters: 0, dynamicCasters: 0 };
    const shadowMap = renderer.shadowMap;
    this.original = shadowMap.render;
    this.hook = (lights, renderScene, camera) => this.render(lights, renderScene, camera);
    shadowMap.render = this.hook;
    this.onRestore = () => {
      // Three rebuilds WebGLShadowMap on context restoration. Reattach after
      // its own restoration listener and rebuild all cached GPU depth.
      this.original = renderer.shadowMap.render; renderer.shadowMap.render = this.hook;
      this.invalidate(); this.copyValidated = false;
    };
    renderer.domElement?.addEventListener('webglcontextrestored', this.onRestore);
  }

  invalidate() { this.valid = false; }

  _scan(camera) {
    const statics = this.static, dynamic = this.dynamic, previous = this.previous;
    statics.length = 0; dynamic.length = 0;
    let dirty = !this.valid;
    const visit = (object, isStatic) => {
      if (!object.visible) return;
      isStatic = isStatic || STATIC_GROUPS.has(object.name);
      if ((object.isMesh || object.isLine || object.isPoints) && object.castShadow && object.layers.test(camera.layers)) {
        // Wind-driven cover, skinning, morphs and custom depth shaders keep
        // updating every frame. Only the ordinary fixed world is cached.
        if (isStatic && !object.isSkinnedMesh && !object.customDepthMaterial && !object.morphTargetInfluences) {
          const i = statics.length;
          statics.push(object);
          const changed = this._changed(object);
          if (previous[i] !== object || changed) dirty = true;
        } else dynamic.push(object);
      }
      for (const child of object.children) visit(child, isStatic);
    };
    visit(this.scene, false);
    if (previous.length !== statics.length) dirty = true;
    previous.length = statics.length;
    for (let i = 0; i < statics.length; i++) previous[i] = statics[i];
    this.stats.staticCasters = statics.length; this.stats.dynamicCasters = dynamic.length;
    return dirty;
  }

  _changed(object) {
    let rec = this.records.get(object);
    if (!rec) { rec = { matrix: new Float64Array(16), signature: [], nextSignature: [] }; this.records.set(object, rec); }
    const matrix = object.matrixWorld.elements;
    let dirty = false;
    for (let i = 0; i < 16; i++) if (rec.matrix[i] !== matrix[i]) { dirty = true; rec.matrix[i] = matrix[i]; }
    const geometry = object.geometry, material = object.material;
    // Instance selection and streamed terrain can change without moving the
    // mesh. Buffer versions plus identity catch rebuilds, LODs and destruction.
    const sig = rec.nextSignature; sig.length = 0;
    sig.push(geometry, geometry.index, geometry.index?.version, geometry.drawRange.start, geometry.drawRange.count,
      object.count, object.instanceMatrix, object.instanceMatrix?.version,
      object.instanceColor?.version, object.customDepthMaterial);
    for (const group of geometry.groups) sig.push(group.start, group.count, group.materialIndex);
    for (const name in geometry.attributes) { const attribute = geometry.attributes[name]; sig.push(name, attribute, attribute.version); }
    const addMaterial = (m) => {
      sig.push(m, m.version, m.visible, m.side, m.shadowSide, m.alphaTest, m.alphaToCoverage,
        m.alphaMap, m.alphaMap?.version, m.map, m.map?.version, m.displacementMap,
        m.displacementMap?.version, m.displacementScale, m.displacementBias, m.wireframe,
        m.clipShadows, m.clipIntersection);
      for (const plane of m.clippingPlanes || []) sig.push(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    };
    if (Array.isArray(material)) { for (const m of material) addMaterial(m); } else addMaterial(material);
    if (rec.signature.length !== sig.length) dirty = true;
    for (let i = 0; i < sig.length; i++) if (rec.signature[i] !== sig[i]) { dirty = true; break; }
    if (dirty) { rec.nextSignature = rec.signature; rec.signature = sig; }
    return dirty;
  }

  _projectionChanged() {
    const l = this.light, sh = l.shadow, p = this.projection;
    const values = [l.position.x, l.position.y, l.position.z, l.target.position.x, l.target.position.y,
      l.target.position.z, sh.mapSize.x, sh.mapSize.y, sh.camera.near, sh.camera.far,
      sh.camera.left, sh.camera.right, sh.camera.top, sh.camera.bottom];
    let changed = false;
    for (let i = 0; i < values.length; i++) if (p[i] !== values[i]) { changed = true; p[i] = values[i]; }
    return changed;
  }

  _copyDepth(destination) {
    const renderer = this.renderer, gl = renderer.getContext();
    renderer.setRenderTarget(this.target);
    const source = renderer.properties.get(this.target).__webglFramebuffer;
    renderer.setRenderTarget(destination);
    const dest = renderer.properties.get(destination).__webglFramebuffer;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dest);
    gl.blitFramebuffer(0, 0, this.target.width, this.target.height, 0, 0, destination.width,
      destination.height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    // Restore both bindings to the target the renderer believes is current.
    gl.bindFramebuffer(gl.FRAMEBUFFER, dest);
    if (!this.copyValidated && gl.getError) {
      const error = gl.getError();
      if (error !== gl.NO_ERROR) throw new Error(`WebGL depth copy failed (${error})`);
      this.copyValidated = true;
    }
  }

  render(lights, renderScene, camera) {
    const renderer = this.renderer, shadowMap = renderer.shadowMap, light = this.light, shadow = light.shadow;
    const normal = () => this.original.call(shadowMap, lights, renderScene, camera);
    if (!this.enabled || renderScene !== this.scene || shadowMap.type !== PCFShadowMap || !shadowMap.enabled ||
      (!shadowMap.autoUpdate && !shadowMap.needsUpdate) || !lights.includes(light) ||
      (!shadow.autoUpdate && !shadow.needsUpdate)) return normal();
    // First let Three allocate its real PCF depth map. Compilation/prewarming
    // continues through the ordinary path, so no new shader variant is needed.
    if (!shadow.map) { this.invalidate(); return normal(); }
    const changed = this._scan(camera), projectionChanged = this._projectionChanged();
    let refresh = changed || projectionChanged || !this.target;
    if (!this.static.length) { this.invalidate(); return normal(); }
    const live = shadow.map;
    if (!this.target || this.target.width !== live.width || this.target.height !== live.height) {
      this.target?.depthTexture?.dispose(); this.target?.dispose();
      this.target = live.clone(); this.target.texture.name = 'Sun.StaticShadowCache';
      this.target.depthTexture.name = 'Sun.StaticShadowCacheDepth'; refresh = true; this.copyValidated = false;
    }
    const clear = renderer.clear, auto = shadowMap.autoUpdate, needs = shadowMap.needsUpdate;
    const ownAuto = shadow.autoUpdate, ownNeeds = shadow.needsUpdate;
    const entryTarget = renderer.getRenderTarget(), entryFace = renderer.getActiveCubeFace();
    const entryMipmap = renderer.getActiveMipmapLevel();
    try {
      // Preserve the built-in renderer's culling, alpha tests and depth rules.
      shadowMap.autoUpdate = true; shadow.autoUpdate = true;
      if (refresh) {
        for (const object of this.dynamic) object.castShadow = false;
        shadow.map = this.target;
        this.original.call(shadowMap, [light], renderScene, camera);
        for (const object of this.dynamic) object.castShadow = true;
        shadow.map = live;
        this.valid = true; this.stats.refreshes++;
      } else this.stats.reuses++;
      for (const object of this.static) object.castShadow = false;
      // Three clears the map immediately before drawing it. Replace that depth
      // clear with the cached static depth, then let it draw moving casters.
      renderer.clear = (...args) => {
        if (renderer.getRenderTarget() === live) {
          clear.call(renderer, true, false, false);
          this._copyDepth(live);
        } else clear.apply(renderer, args);
      };
      this.original.call(shadowMap, [light], renderScene, camera);
    } catch (error) {
      this.enabled = false; this.invalidate();
      console.warn('Static shadow cache unavailable; using ordinary sun shadows', error);
    } finally {
      renderer.clear = clear; shadow.map = live;
      for (const object of this.static) object.castShadow = true;
      for (const object of this.dynamic) object.castShadow = true;
      shadow.autoUpdate = ownAuto; shadow.needsUpdate = this.enabled ? false : ownNeeds;
      shadowMap.autoUpdate = auto; shadowMap.needsUpdate = this.enabled ? false : needs;
      // A failed copy exits Three's shadow pass before it restores the scene
      // target. Restore here so fallback and the main scene keep their target.
      renderer.setRenderTarget(entryTarget, entryFace, entryMipmap);
    }
    if (!this.enabled) return normal();
    const otherLights = lights.filter((l) => l !== light);
    if (otherLights.length) this.original.call(shadowMap, otherLights, renderScene, camera);
  }

  dispose() {
    if (this.renderer.shadowMap.render === this.hook) this.renderer.shadowMap.render = this.original;
    this.renderer.domElement?.removeEventListener('webglcontextrestored', this.onRestore);
    this.target?.depthTexture?.dispose(); this.target?.dispose(); this.target = null;
  }
}
