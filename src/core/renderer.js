import * as THREE from 'three';

export function createRenderer({ antialias = false, pixelRatio } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: false });
  renderer.setPixelRatio(pixelRatio ?? Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // r186 removed PCFSoft (it silently falls back, which breaks shader prewarming)
  document.body.appendChild(renderer.domElement);
  return renderer;
}
