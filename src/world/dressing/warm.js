// Create every procedural set-piece material up front (the neon atlas / banner canvases are painted once, ~50 ms, at load time
// instead of mid-drive) and compile their shader programs in the background (Game.warmMeshes via pool.warmer) long before the
// first city block / dam appears. Dummy meshes carry exactly the attributes + shadow flags of the real ones, so the programs match.
import * as THREE from 'three';
import { facadeMaterial, neonTexture, flameMaterial, smokeMaterial } from './city_mat.js';
import { flowMaterial, mistMaterial, bannerMaterial, reservoirMaterial } from './setmat.js';

export function createSetMaterials() {
  return [facadeMaterial(), flameMaterial(), smokeMaterial(), flowMaterial(), mistMaterial(), bannerMaterial(), reservoirMaterial()];
}

export function warmSetMaterials(warmer) {
  const tri = (attrs) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    for (const [n, size] of attrs) g.setAttribute(n, new THREE.Float32BufferAttribute(new Array(3 * size).fill(0.5), size));
    g.setIndex([0, 1, 2]);
    return g;
  };
  const mk = (mat, attrs, cast, recv) => { const m = new THREE.Mesh(tri(attrs), mat); m.castShadow = cast; m.receiveShadow = recv; m.frustumCulled = false; m.visible = false; return m; };
  // instanced like the dressing pool draws them (instanceMatrix + instanceColor)
  const inst = (mat, attrs) => { const m = new THREE.InstancedMesh(tri(attrs), mat, 1); m.setMatrixAt(0, new THREE.Matrix4()); m.setColorAt(0, new THREE.Color(1, 1, 1)); m.frustumCulled = false; m.visible = false; return m; };
  const texHolder = mk(new THREE.MeshBasicMaterial({ map: neonTexture() }), [['uv', 2]], false, false);   // uploads the neon atlas early (the facade shader samples it)
  const meshes = [
    mk(facadeMaterial(), [['aUvF', 2], ['color', 3], ['aFac', 4], ['aFac2', 4]], true, true),
    texHolder,
    inst(flameMaterial(), [['uv', 2], ['aFac', 4]]),
    inst(smokeMaterial(), [['uv', 2], ['aFac', 4]]),
    mk(flowMaterial(), [['uv', 2], ['color', 3], ['aFac', 4], ['aFac2', 4]], false, false),
    mk(mistMaterial(), [['uv', 2], ['color', 3], ['aFac', 4], ['aFac2', 4]], false, false),
    mk(bannerMaterial(), [['uv', 2], ['color', 3], ['aFac', 4], ['aFac2', 4]], true, true),
    mk(reservoirMaterial(), [['uv', 2], ['color', 3]], false, false),
  ];
  return warmer(meshes).then(() => { for (const m of meshes) m.geometry.dispose(); });
}
