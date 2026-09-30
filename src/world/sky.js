// Sky dome + key light (sun by day, moon by night) + hemisphere fill + fog + image-based lighting, driven by a "look" (look.js).
// The sky radiance model lives in atmosphere.js and is shared with the fog of every material, the IBL and the water.
//  - sky dome: art-directed gradient + sunset band + Mie halo (atmSky) + HDR sun disc + two-tap lit fbm clouds + stars + moon.
//    Drawn LAST among opaques (renderOrder) so its shader only runs on pixels the world leaves open.
//  - IBL: the same shader (env variant: no disc/stars, lit ground below the horizon) rendered into a small cube and
//    prefiltered into ONE reused PMREM target (no allocations, no program changes), throttled.
//  - shadows: one 4k map, box pushed ahead of the camera (first person: the nearest ~70 m in front matter), snapped to
//    shadow-map texels IN LIGHT SPACE so it never shimmers.
//  - lights never toggle `visible` (that changes the light count => every program recompiles): intensity 0 instead.
import * as THREE from 'three';
import { ATMO, ATMO_GLSL, KEY, noiseTexture } from './atmosphere.js';
import { D2R, smoothstep } from '../core/util.js';
import { StaticShadowCache } from '../view/post/static_shadows.js';

const VERT = /* glsl */`
varying vec3 vWorldPosition;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPosition = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w;
}`;

const FRAG = /* glsl */`
${ATMO_GLSL}
varying vec3 vWorldPosition;
uniform float uEnv;
uniform vec4 uDisc;        // rgb disc radiance, w: cos(angular radius)
uniform vec4 uCloud;       // x coverage, y opacity, z scale, w time
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec4 uMoon;        // xyz dir, w disc radiance
uniform float uStars;
uniform vec3 uGround;      // env only: radiance of the lit ground below the horizon
uniform float uTime;

uniform sampler2D uCloudTex;   // baked tileable fbm (r: shapes, g: detail), mip-mapped => no shimmer toward the horizon
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float fbm(vec2 p) {
  return texture2D(uCloudTex, p * 0.25).r * 0.72 + texture2D(uCloudTex, p * 0.9 + vec2(0.31, 0.77)).g * 0.28;
}

void main() {
  vec3 dir = normalize(vWorldPosition - cameraPosition);
  float y = dir.y;
  vec3 col = atmSky(dir);
  float cs = dot(dir, uAtmSun.xyz);
  if (uEnv < 0.5) {
    // stars (night): sparse jittered points, gentle twinkle, fade into the horizon haze
    if (uStars > 0.01 && y > 0.0) {
      vec3 sp = dir * 260.0;
      vec3 id = floor(sp);
      float h = hash13(id);
      if (h > 0.982) {
        vec3 o = vec3(hash13(id + 7.1), hash13(id + 3.3), hash13(id + 5.9)) - 0.5;
        float dd = length(fract(sp) - 0.5 - o * 0.5);
        float tw = 0.75 + 0.25 * sin(uTime * (1.5 + h * 30.0) + h * 97.0);
        float b = (h - 0.982) / 0.018; b = b * b * b;
        col += vec3(0.85, 0.9, 1.0) * smoothstep(0.32, 0.0, dd) * (0.02 + 0.22 * b) * tw * uStars * smoothstep(0.02, 0.3, y);
      }
    }
    // moon: disc + soft glow
    if (uMoon.w > 0.0) {
      float cm = dot(dir, uMoon.xyz);
      col += vec3(0.88, 0.93, 1.0) * uMoon.w * (smoothstep(0.999900, 0.999930, cm) + 0.02 * pow(max(cm, 0.0), 900.0) + 0.004 * pow(max(cm, 0.0), 40.0));
    }
    // sun disc (HDR: it blooms), slight limb darkening
    float disc = smoothstep(uDisc.w - 0.000010, uDisc.w + 0.000006, cs);
    col += uDisc.rgb * disc * (0.75 + 0.25 * smoothstep(uDisc.w, 1.0, cs));
  }
  // clouds on a spherical shell (flattens toward the horizon like a real cloud deck)
  if (uCloud.x > 0.001 && y > 0.0) {
    float t = sqrt(3600.0 * y * y + 121.0) - 60.0 * y;
    vec2 p = dir.xz * t * uCloud.z + vec2(uCloud.w * 0.010, uCloud.w * 0.004);
    float n = fbm(p);
    float th = mix(0.74, 0.40, uCloud.x);
    float dens = smoothstep(th, th + 0.2, n);
    if (dens > 0.001) {
      vec2 sxz = uAtmSun.xz / max(length(uAtmSun.xz), 1e-3);
      float n2 = fbm(p + sxz * 0.22);
      float lightK = clamp(0.55 + (n - n2) * 5.0, 0.0, 1.0);
      float thick = smoothstep(th, th + 0.42, n);
      vec3 cc = mix(uCloudShade, uCloudLit, lightK * (1.0 - 0.55 * thick));
      // forward scattering: bright rims when looking toward the sun
      float fw = pow(max(cs, 0.0), 6.0) * uAtmSun.w;
      cc += uCloudLit * fw * (1.0 - thick) * 1.2;
      // aerial perspective: low clouds sink into the horizon haze
      cc = mix(cc, atmSky(dir), (1.0 - smoothstep(0.0, 0.35, y)) * 0.7);
      float a = dens * uCloud.y * smoothstep(0.0, 0.07, y);
      col = mix(col, cc, a);
    }
  }
  if (uEnv > 0.5) col = mix(col, uGround, smoothstep(0.02, -0.06, y));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _f = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

export class SkyRig {
  constructor(renderer, scene, opts = {}) {
    this.renderer = renderer; this.scene = scene;
    this.shadowSize = opts.shadowSize ?? 4096;
    this.shadowExtent = opts.shadowExtent ?? 50;
    this.shadowAhead = opts.shadowAhead ?? 0.5;       // push the shadow box this fraction of its half-size ahead of the camera
    this.envSize = opts.envSize ?? 128;
    this.U = {
      uDisc: { value: new THREE.Vector4(0, 0, 0, 0.99995) }, uCloud: { value: new THREE.Vector4(0.3, 0.85, 0.9, 0) },
      uCloudLit: { value: new THREE.Color() }, uCloudShade: { value: new THREE.Color() }, uMoon: { value: new THREE.Vector4(0, 1, 0, 0) },
      uStars: { value: 0 }, uGround: { value: new THREE.Color() }, uTime: { value: 0 }, uCloudTex: { value: noiseTexture() },
    };
    const mk = (env) => {
      const m = new THREE.ShaderMaterial({ name: env ? 'rod_sky_env' : 'rod_sky', uniforms: { ...ATMO, ...this.U, uEnv: { value: env ? 1 : 0 } }, vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false, fog: false });
      return m;
    };
    this.sky = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mk(false));
    this.sky.scale.setScalar(20000); this.sky.frustumCulled = false; this.sky.renderOrder = 1000; this.sky.name = 'sky';
    scene.add(this.sky);
    // IBL: env variant of the sky rendered into a small cube, prefiltered into ONE reused PMREM target
    this.skyScene = new THREE.Scene();
    this.envMesh = new THREE.Mesh(this.sky.geometry, mk(true)); this.envMesh.scale.setScalar(20000); this.envMesh.frustumCulled = false;
    this.skyScene.add(this.envMesh);
    this.cubeRT = new THREE.WebGLCubeRenderTarget(this.envSize, { type: THREE.HalfFloatType, generateMipmaps: false, depthBuffer: false });
    this.cubeCam = new THREE.CubeCamera(1, 100000, this.cubeRT);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null; this._envAge = 1e9; this._envSig = null;

    // key light: the sun by day, the moon by night (one shadow map)
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.shadowSize, this.shadowSize);
    const e = this.shadowExtent;
    Object.assign(this.sun.shadow.camera, { left: -e, right: e, top: e, bottom: -e, near: 1, far: 320 });
    this.sun.shadow.bias = -0.00012; this.sun.shadow.normalBias = 0.035;
    scene.add(this.sun); scene.add(this.sun.target);
    // second directional light kept for a stable light count (programs are keyed on it); unused (intensity 0)
    this.moon = new THREE.DirectionalLight(0x9fb4ff, 0.0);
    scene.add(this.moon); scene.add(this.moon.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x886644, 0.3);
    scene.add(this.hemi);
    this.fog = new THREE.FogExp2(0xd9b48a, 0.0008);
    scene.fog = this.fog;
    this.sunDir = new THREE.Vector3(0, 1, 0);      // direction TO the sun
    this.moonDir = new THREE.Vector3(0, 1, 0);
    this.keyDir = new THREE.Vector3(0, 1, 0);      // direction TO the key light (sun or moon)
    this.look = null;
    this.follow = new THREE.Vector3();
    this.shadowFocus = new THREE.Vector3();        // centre of the shadow box (Dressing selects shadow casters around it)
    this._baseY = null; this._time = 0;
    this._shadowAnchor = new THREE.Vector3(); this._shadowDir = new THREE.Vector3();
    this._haveShadowAnchor = false;
    this.shadowCache = opts.staticShadows === false ? null : new StaticShadowCache(renderer, scene, this.sun);
    ATMO.uAtmFog.value.w = 1;
  }

  /** Resize both live and cached shadow depth; keep texel snapping in sync. */
  setShadowSize(size) {
    const shadow = this.sun.shadow;
    this.shadowSize = size;
    if (shadow.mapSize.x === size) return;
    shadow.mapSize.set(size, size);
    shadow.map?.depthTexture?.dispose(); shadow.map?.dispose(); shadow.map = null;
    shadow.mapPass?.dispose(); shadow.mapPass = null; shadow.needsUpdate = true;
    this.shadowCache?.invalidate(); this._haveShadowAnchor = false;
  }

  /** Apply a look; rebuilds the IBL environment when the sky changed enough (throttled). */
  setLook(look, force = false) {
    this.look = look;
    const el = look.sun * D2R, az = look.az * D2R;
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    const mel = look.moonEl * D2R, maz = look.moonAz * D2R;
    this.moonDir.set(Math.sin(maz) * Math.cos(mel), Math.sin(mel), Math.cos(maz) * Math.cos(mel)).normalize();
    const vis = smoothstep(-2.5, 1.5, look.sun);
    // --- shared atmosphere uniforms
    const A = ATMO;
    A.uAtmSun.value.set(this.sunDir.x, this.sunDir.y, this.sunDir.z, vis);
    A.uAtmZen.value.set(look.zen.r, look.zen.g, look.zen.b, look.zenExp);
    A.uAtmHor.value.set(look.hor.r, look.hor.g, look.hor.b, look.horSharp);
    A.uAtmGlow.value.set(look.glow.r, look.glow.g, look.glow.b, look.glowSpread);
    A.uAtmHalo.value.set(look.halo.r * vis, look.halo.g * vis, look.halo.b * vis, look.haloExp);
    A.uAtmFog.value.set(look.fogD, look.fogH, 1 / Math.max(1, look.fogFall), 1);
    A.uAtmFog2.value.y = look.fogClear; A.uAtmFog2.value.z = look.fogMax; A.uAtmFog2.value.w = look.hazeMix;
    A.uAtmLow.value.set(look.haze.r, look.haze.g, look.haze.b, 0.3);
    // --- sky-only uniforms
    const U = this.U;
    const dv = look.disc * vis;
    U.uDisc.value.set(look.sunCol.r * dv, look.sunCol.g * dv, look.sunCol.b * dv, Math.cos(0.55 * D2R));
    U.uCloud.value.x = look.cloudCov; U.uCloud.value.y = look.cloudOp;
    U.uCloudLit.value.copy(look.cloudLit); U.uCloudShade.value.copy(look.cloudShade);
    const moonVis = (1 - smoothstep(-6, 2, look.sun)) * smoothstep(-2, 3, look.moonEl);
    U.uMoon.value.set(this.moonDir.x, this.moonDir.y, this.moonDir.z, 3.0 * moonVis);
    U.uStars.value = look.stars;
    // --- key light: sun, or the moon once the sun is gone (switch happens while both are ~dark)
    const sunK = look.sunI * smoothstep(-2.5, 3.0, look.sun);
    const moonK = look.moonI * (1 - smoothstep(-4, -1, look.sun)) * smoothstep(-2, 4, look.moonEl);
    if (sunK >= moonK) { this.keyDir.copy(this.sunDir); this.sun.color.copy(look.sunCol); this.sun.intensity = sunK; }
    else { this.keyDir.copy(this.moonDir); this.sun.color.copy(look.moonCol); this.sun.intensity = moonK; }
    KEY.uKeyDir.value.copy(this.keyDir); KEY.uKeyCol.value.copy(this.sun.color).multiplyScalar(this.sun.intensity);
    this.moon.intensity = 0;
    this.hemi.color.copy(look.hemiSky); this.hemi.groundColor.copy(look.hemiGnd); this.hemi.intensity = look.hemiI;
    // env lower hemisphere: lit ground (albedo * (direct + sky) / pi)
    const E = this.sun.intensity * Math.max(0, this.keyDir.y) + Math.PI * 0.5 * (lum(look.zen) + lum(look.hor));
    U.uGround.value.copy(look.gnd).multiplyScalar(E / Math.PI);
    // single-colour fog for consumers that do their own (fx particles / decals): average haze + an exp2 density that
    // matches the atmosphere's optical depth at ~600 m
    this.fog.color.copy(look.fog);
    const tau600 = (look.fogD + look.fogH * Math.exp((look.fogBase - 1.5) / Math.max(1, look.fogFall))) * 580;
    this.fog.density = Math.sqrt(Math.max(1e-8, tau600)) / 600;
    this.renderer.toneMappingExposure = look.exp;
    this.scene.environmentIntensity = look.envI;
    // IBL rebuild when the sky moved enough (or every few seconds while it drifts)
    const sig = look.sun * 0.5 + lum(look.zen) * 20 + lum(look.hor) * 20 + lum(look.glow) * 10 + look.cloudCov * 4 + look.moonI * 10 + look.az * 0.05;
    if (force || this.envRT === null || (this._envSig !== null && Math.abs(sig - this._envSig) > 0.35 && this._envAge > 0.5)) this.rebuildEnv(sig);
  }

  rebuildEnv(sig = this._envSig) {
    this._envSig = sig; this._envAge = 0;
    this.cubeCam.position.set(0, 0, 0); this.cubeCam.updateMatrixWorld();
    this.cubeCam.update(this.renderer, this.skyScene);
    if (!this.envRT) this.envRT = this.pmrem.fromCubemap(this.cubeRT.texture);
    else this.pmrem.fromCubemap(this.cubeRT.texture, this.envRT);
    this.scene.environment = this.envRT.texture;
  }

  /** Call every frame with the camera + the world point the light should focus on (the player truck). */
  update(dt, camera, focus) {
    this._envAge += dt; this._time += dt;
    this.U.uTime.value = this._time; this.U.uCloud.value.w = this._time;
    this.sky.position.copy(camera.position);
    const f = focus || camera.position;
    // height-fog base follows the truck's altitude slowly (no pumping over crests)
    const look = this.look;
    const want = f.y + (look ? look.fogBase : -3);
    this._baseY = this._baseY === null || Math.abs(want - this._baseY) > 150 ? want : this._baseY + (want - this._baseY) * (1 - Math.exp(-dt * 0.5));
    ATMO.uAtmFog2.value.x = this._baseY;
    // shadow box: ahead of the camera along its horizontal view direction
    camera.getWorldDirection(_f); _f.y = 0;
    const fl = _f.length(); if (fl > 1e-3) _f.multiplyScalar(1 / fl); else _f.set(0, 0, 0);
    const F = this.shadowFocus.copy(f).addScaledVector(_f, this.shadowExtent * this.shadowAhead);
    // snap to texels in light space (basis as Matrix4.lookAt(eye, target, up) builds it)
    let L = this.keyDir;
    // A world-stable box keeps fixed terrain/building depth reusable while
    // driving or turning the view. Recenter before the useful near field can
    // approach its edge, and refresh for moving sunlight (including moon swap).
    // Dynamic cars/crew still cast into the combined map every render.
    if (this.shadowCache?.enabled) {
      if (!this._haveShadowAnchor || F.distanceToSquared(this._shadowAnchor) > 36 ||
        this._shadowDir.dot(L) < 0.99999945 || this.shadowSize !== this.sun.shadow.mapSize.x) {
        this._shadowAnchor.copy(F); this._shadowDir.copy(L); this._haveShadowAnchor = true;
        this.shadowCache.invalidate();
      }
      F.copy(this._shadowAnchor); L = this._shadowDir;
    }
    _x.crossVectors(_up, L); if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0); _x.normalize();
    _y.crossVectors(L, _x);
    const texel = (this.shadowExtent * 2) / this.sun.shadow.mapSize.x;
    const u = F.dot(_x), v = F.dot(_y);
    F.addScaledVector(_x, Math.round(u / texel) * texel - u).addScaledVector(_y, Math.round(v / texel) * texel - v);
    this.sun.position.copy(F).addScaledVector(L, 160);
    this.sun.target.position.copy(F);
    this.sun.updateMatrixWorld(); this.sun.target.updateMatrixWorld();
    this.moon.position.copy(F).addScaledVector(this.moonDir, 100); this.moon.target.position.copy(F);
  }
}
