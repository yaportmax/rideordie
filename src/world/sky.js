// Sky dome + sun/moon/hemisphere lighting + fog + image-based lighting, driven by a "look" (see look.js).
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { D2R, smoothstep, clamp } from '../core/util.js';

export class SkyRig {
  constructor(renderer, scene, opts = {}) {
    this.renderer = renderer; this.scene = scene;
    this.shadowSize = opts.shadowSize ?? 4096;
    this.shadowExtent = opts.shadowExtent ?? 55;
    this.sky = new Sky(); this.sky.scale.setScalar(20000); this.sky.material.depthWrite = false;
    scene.add(this.sky);
    this.skyScene = new THREE.Scene();
    this.envSky = new Sky(); this.envSky.scale.setScalar(20000); this.skyScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null; this.envSun = new THREE.Vector3(); this._envAge = 1e9; this._lastEnvKey = '';

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.shadowSize, this.shadowSize);
    const e = this.shadowExtent;
    Object.assign(this.sun.shadow.camera, { left: -e, right: e, top: e, bottom: -e, near: 1, far: 400 });
    this.sun.shadow.bias = -0.0002; this.sun.shadow.normalBias = 0.05;
    scene.add(this.sun); scene.add(this.sun.target);
    this.moon = new THREE.DirectionalLight(0x9fb4ff, 0.0);
    scene.add(this.moon); scene.add(this.moon.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x886644, 0.9);
    scene.add(this.hemi);
    this.fog = new THREE.FogExp2(0xd9b48a, 0.0008);
    scene.fog = this.fog;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.look = null;
    this.follow = new THREE.Vector3();
  }

  /** Apply a look; rebuilds the IBL environment when the sky changed enough (throttled). */
  setLook(look, force = false) {
    this.look = look;
    const el = look.sun * D2R, az = look.az * D2R;
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    for (const sk of [this.sky, this.envSky]) {
      const u = sk.material.uniforms;
      u.turbidity.value = look.turb; u.rayleigh.value = look.ray; u.mieCoefficient.value = look.mie; u.mieDirectionalG.value = 0.85;
      u.sunPosition.value.copy(this.sunDir);
    }
    const sunFade = smoothstep(-3, 7, look.sun);
    this.sun.color.copy(look.sunCol);
    this.sun.intensity = look.sunI * sunFade;
    this.sun.visible = sunFade > 0.01;
    this.moon.intensity = look.moonI * (1 - sunFade * 0.8);
    this.hemi.color.copy(look.hemiSky); this.hemi.groundColor.copy(look.hemiGnd); this.hemi.intensity = look.hemiI;
    this.fog.color.copy(look.fog); this.fog.density = look.fogD;
    this.renderer.toneMappingExposure = look.exp;
    const key = `${(look.sun / 3) | 0}|${(look.turb) | 0}|${(look.ray * 2) | 0}`;
    if (force || (key !== this._lastEnvKey && this._envAge > 4)) this.rebuildEnv(key);
  }

  rebuildEnv(key) {
    this._lastEnvKey = key; this._envAge = 0;
    const sc = this.scene;
    const rt = this.pmrem.fromScene(this.skyScene, 0.0, 1, 5000);
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt; sc.environment = rt.texture;
    sc.environmentIntensity = 0.55 + 0.25 * (this.look ? this.look.night : 0);
  }

  /** Call every frame with the camera + the world point the light should focus on. */
  update(dt, camera, focus) {
    this._envAge += dt;
    this.sky.position.copy(camera.position);
    const f = focus || camera.position;
    // snap the shadow frustum to texel increments to avoid shimmering
    const texel = (this.shadowExtent * 2) / this.shadowSize;
    const fx = Math.round(f.x / texel) * texel, fy = Math.round(f.y / texel) * texel, fz = Math.round(f.z / texel) * texel;
    this.sun.position.set(fx + this.sunDir.x * 200, fy + this.sunDir.y * 200, fz + this.sunDir.z * 200);
    this.sun.target.position.set(fx, fy, fz);
    this.moon.position.set(fx - this.sunDir.x * 100 + 30, fy + 90, fz - this.sunDir.z * 100);
    this.moon.target.position.set(fx, fy, fz);
    this.sun.updateMatrixWorld(); this.sun.target.updateMatrixWorld();
  }
}
