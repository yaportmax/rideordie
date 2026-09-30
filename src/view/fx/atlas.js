// Sprite atlas for the particle system: all additive/alpha sheets packed into ONE premultiplied texture so every particle
// (fire, smoke, dust, muzzle flash, sparks, streaks, shockwave, debris sprites) is a single instanced draw call per pool.
//
// Sheets flagged `lit` are NORMAL-LIT (rg = sprite-space normal, b = thinness, a = coverage; built by
// tools/env/build_fx_sheets.py) and are shaded at runtime by the key light + sky; the others carry colour.
import * as THREE from 'three';

/** Sprite ids (index into the shader's uRect/uGrid tables). FIRE is the looping flame-tongue sheet. */
export const SPR = { SMOKE: 0, FIRE: 1, DUST: 2, MUZZLE: 3, DEBRIS: 4, SHOCK: 5, FLASH: 6, SPARK: 7, STREAK: 8, FIREBALL: 9, SMOKE_FLAT: 10 };
export const NSPR = 12;
/** Frame counts of the animated sheets (for callers picking frames / loops). */
export const FRAMES = { FIRE: 16, FIREBALL: 64 };

const W = 4096, H = 2048;
// x,y,w,h in atlas pixels (y from the top); cols x rows = frames in the sheet
const LAYOUT = [
  { id: SPR.SMOKE, file: 'smoke_lit.png', x: 0, y: 0, w: 1024, h: 1024, cols: 4, rows: 4, lit: 1 },
  { id: SPR.DUST, file: 'dust_lit.png', x: 1024, y: 0, w: 1024, h: 1024, cols: 4, rows: 4, lit: 1 },
  { id: SPR.FIREBALL, file: 'fireball_sheet.png', x: 2048, y: 0, w: 1024, h: 1024, cols: 8, rows: 8 },
  { id: SPR.FIRE, file: 'flame_sheet.png', x: 3072, y: 0, w: 1024, h: 2048, cols: 4, rows: 4 },
  { id: SPR.MUZZLE, file: 'muzzle_flash_sheet.png', x: 0, y: 1024, w: 1024, h: 512, cols: 4, rows: 2 },
  { id: SPR.DEBRIS, file: 'debris_sheet.png', x: 0, y: 1536, w: 512, h: 512, cols: 4, rows: 4 },
  { id: SPR.SHOCK, file: 'shockwave.png', x: 512, y: 1536, w: 512, h: 512, cols: 1, rows: 1 },
  { id: SPR.FLASH, file: 'blast_flash.png', x: 1024, y: 1024, w: 512, h: 512, cols: 1, rows: 1 },
  { id: SPR.SPARK, file: 'spark.png', x: 1536, y: 1024, w: 256, h: 256, cols: 1, rows: 1 },
  { id: SPR.STREAK, file: 'spark_streak.png', x: 1536, y: 1280, w: 256, h: 64, cols: 1, rows: 1 },
  { id: SPR.SMOKE_FLAT, file: 'smoke_sheet.png', x: 2048, y: 1024, w: 1024, h: 1024, cols: 4, rows: 4 },
];

function loadImage(url) {
  return new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => { console.warn('fx: missing sprite', url); res(null); }; im.src = url; });
}

/** Builds the atlas texture + the uniform tables. */
export async function buildAtlas(base = '/textures/particles/') {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  const imgs = await Promise.all(LAYOUT.map((l) => loadImage(base + l.file)));
  LAYOUT.forEach((l, i) => { if (imgs[i]) g.drawImage(imgs[i], l.x, l.y, l.w, l.h); });
  const tex = new THREE.CanvasTexture(cv);
  tex.premultiplyAlpha = true;          // canvas is premultiplied: upload as-is so filtering/mips are correct
  tex.colorSpace = THREE.NoColorSpace;  // decoded to linear in the shader (after un-premultiplying)
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  const rect = [], grid = [];
  for (let i = 0; i < NSPR; i++) { rect.push(new THREE.Vector4(0, 0, 0, 0)); grid.push(new THREE.Vector4(1, 1, 1, 0)); }
  for (const l of LAYOUT) {
    rect[l.id].set(l.x / W, 1 - (l.y + l.h) / H, l.w / W, l.h / H);
    grid[l.id].set(l.cols, l.rows, l.cols * l.rows, l.lit ? 1 : 0);
  }
  return { texture: tex, rect, grid, size: [W, H] };
}

/** Decal / ribbon textures (straight alpha, normal blending). */
export async function loadDecalTextures(base = '/textures/particles/') {
  const loader = new THREE.TextureLoader();
  const load = (f, srgb = true) => new Promise((res) => {
    loader.load(base + f, (t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; res(t);
    }, undefined, () => { console.warn('fx: missing texture', f); res(null); });
  });
  const [scorch, holes, skid] = await Promise.all([load('scorch_sheet.png'), load('bullet_hole_sheet.png'), load('skid_mark.png')]);
  if (skid) { skid.wrapT = THREE.RepeatWrapping; }
  return { scorch, holes, skid };
}
