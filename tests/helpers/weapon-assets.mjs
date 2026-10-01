import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import * as Assets from '../../src/core/assets.js';

export { THREE, Assets };
export const WEAPON_IDS = ['pistol', 'revolver', 'smg', 'shotgun', 'rifle', 'lmg', 'sniper', 'rpg'];
let loading;
/** Actual shipped geometry, sockets and clips; only browser image decoding is stubbed. */
export function loadWeaponAssets() {
  return loading ||= (async () => {
    const old = { fetch: globalThis.fetch, Request: globalThis.Request, self: globalThis.self, createImageBitmap: globalThis.createImageBitmap, ProgressEvent: globalThis.ProgressEvent };
    globalThis.self = globalThis;
    globalThis.createImageBitmap = async () => ({ width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) });
    globalThis.ProgressEvent = class { constructor(type, props) { this.type = type; Object.assign(this, props); } };
    globalThis.Request = class extends old.Request { constructor(url, opts) { super(typeof url === 'string' && url.startsWith('/') ? 'http://weapon-test.local' + url : url, opts); } };
    globalThis.fetch = async request => {
      const url = new URL(typeof request === 'string' ? request : request.url);
      if (url.origin !== 'http://weapon-test.local') return old.fetch(request);
      return new Response(readFileSync(new URL('../../public' + url.pathname, import.meta.url)), { headers: { 'Content-Type': 'application/octet-stream' } });
    };
    try {
      await Assets.preload([
        ...WEAPON_IDS.map(id => `/models/weapons/${id}.glb`),
        '/models/characters/fp_arms.glb', '/models/characters/hero_gunner.glb',
      ]);
    } finally {
      for (const [key, value] of Object.entries(old)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
    }
  })();
}
