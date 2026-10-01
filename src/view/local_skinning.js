// Scoped GPU palettes for meshes carried far from the origin. Cancel world
// translation in CPU double precision before writing the Float32 bone texture.
// Bones, inverse binds and CPU SkinnedMesh/socket queries remain unchanged.
import * as THREE from 'three';

const variants = new WeakMap(), localMaterials = new WeakSet(), prepared = new WeakSet();
const defaultDepth = new WeakMap(), defaultDistance = new WeakMap();
const shadowProperties = ['map', 'alphaMap', 'alphaTest', 'alphaToCoverage', 'displacementMap', 'displacementScale', 'displacementBias',
  'side', 'shadowSide', 'clipShadows', 'clippingPlanes', 'clipIntersection', 'wireframe', 'wireframeLinewidth'];
const identity = new THREE.Matrix4();
const positionChunk = THREE.ShaderChunk.skinning_vertex
  .replace('bindMatrix * vec4( transformed, 1.0 )', 'vec4( transformed, 1.0 )')
  .replace('( bindMatrixInverse * skinned ).xyz', 'skinned.xyz');
const normalChunk = THREE.ShaderChunk.skinnormal_vertex
  .replace('skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;', '');

/** Shared per source, like the existing crew/leather materials; never mutate
 * an asset template or dispose a sibling's cached shader variant per rig. */
export function localSkinningMaterial(source) {
  if (localMaterials.has(source)) return source;
  let material = variants.get(source);
  if (material) return material;
  material = source.clone();
  const compile = source.onBeforeCompile, cacheKey = source.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    compile.call(this, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <skinning_vertex>', positionChunk)
      .replace('#include <skinnormal_vertex>', normalChunk);
  };
  material.customProgramCacheKey = () => cacheKey.call(source) + '|rod_local_skin_v1';
  localMaterials.add(material); variants.set(source, material);
  return material;
}

/** Material.clone omits compile hooks. Keep this representation when a local
 * hero body is switched to the existing colour/depth-disabled material copy. */
export function copyLocalSkinningHooks(source, copy) {
  if (localMaterials.has(source)) {
    copy.onBeforeCompile = source.onBeforeCompile;
    copy.customProgramCacheKey = source.customProgramCacheKey;
    localMaterials.add(copy);
  }
  return copy;
}

/** Prepare a fresh asset clone BEFORE ownClonedSkeletons registers ownership.
 * Inspect aliases once at creation; selected aliases get separate palettes so
 * each bind pair and any ordinary world-palette sibling remain independent. */
export function prepareLocalSkinning(root, select = () => true) {
  if (!root) return root;
  const meshes = [], users = new Map();
  root.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    users.set(mesh.skeleton, (users.get(mesh.skeleton) || 0) + 1);
    if (!prepared.has(mesh) && select(mesh)) meshes.push(mesh);
  });
  // Reject late installation atomically rather than orphaning a GPU texture.
  for (const mesh of meshes) {
    if (mesh.skeleton.boneTexture) throw new Error('Local skinning must be prepared on a fresh untextured clone');
    // One custom shadow material serves every group in a Mesh. The scoped
    // driver assets have one material; compatible arrays are also safe. Do
    // not silently reuse a first group's alpha/displacement shader for a
    // group with different shadow state.
    if (Array.isArray(mesh.material) && mesh.material.some(material => shadowProperties.some(key => material[key] !== mesh.material[0][key]))) {
      throw new Error('Local skinning requires compatible shadow state across material groups');
    }
  }
  for (const mesh of meshes) {
    if (users.get(mesh.skeleton) > 1) mesh.skeleton = mesh.skeleton.clone();
    const skeleton = mesh.skeleton, offset = new THREE.Matrix4(), palette = new THREE.Matrix4();
    skeleton.update = function () {
      for (let i = 0; i < this.bones.length; i++) {
        // P = inverseBind * boneWorld * boneInverse * bind. Matrix4 elements
        // are doubles; only the final, small mesh-local result is cast once.
        offset.multiplyMatrices(mesh.bindMatrixInverse, this.bones[i]?.matrixWorld || identity);
        palette.multiplyMatrices(offset, this.boneInverses[i]).multiply(mesh.bindMatrix);
        palette.toArray(this.boneMatrices, i * 16);
      }
      // computeBoneTexture replaces boneMatrices with a padded array. Always
      // use the live array and retain Three's original allocation/disposal.
      if (this.boneTexture) this.boneTexture.needsUpdate = true;
    };
    const colorSource = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(localSkinningMaterial) : localSkinningMaterial(mesh.material);
    // ShadowMap bypasses its per-colour variant cache for custom materials.
    // Separate defaults per source keep texture/clipping/displacement uniforms
    // refreshed when different source materials share the same shader program.
    let depthSource = defaultDepth.get(colorSource), distanceSource = defaultDistance.get(colorSource);
    if (!depthSource) { depthSource = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); defaultDepth.set(colorSource, depthSource); }
    if (!distanceSource) { distanceSource = new THREE.MeshDistanceMaterial(); defaultDistance.set(colorSource, distanceSource); }
    mesh.customDepthMaterial = localSkinningMaterial(mesh.customDepthMaterial || depthSource);
    mesh.customDistanceMaterial = localSkinningMaterial(mesh.customDistanceMaterial || distanceSource);
    prepared.add(mesh);
  }
  return root;
}
