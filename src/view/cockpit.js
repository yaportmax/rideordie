// First-person cockpit for the local driver: a rear-view mirror and side mirrors fed by ONE shared rear render, a live
// gauge cluster (speed / rpm needles, nitro, warning lamps), windshield damage (bullet holes, crash cracks) and the
// look-back anchor. Everything hangs off the player's truck model, so it moves with the body (roll, pitch, bumps) exactly.
// Positions are measured from the truck GLB at runtime (windshield glass, door mirror housings, sockets) => works on every tier.
import * as THREE from 'three';
import { clamp } from '../core/util.js';
import { normalizeUnits, speedValue, speedLabel } from '../ui/units.js';

const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _pv = new THREE.Matrix4();
const _impact = new THREE.Vector3(), _incoming = new THREE.Vector3();
const RT_W = 1024, RT_H = 320, REAR_HFOV = 110;
const SPEED_DIAL = { km: { max: 400, step: 80 }, mi: { max: 250, step: 50 } };
// Seven actual front-window bullet crossings leave the driver's view clear for
// the rest of this truck's life. Side/rear shots and blast damage do not count.
export const WINDSHIELD_BREAK_HITS = 7;

/** The authored centre bezel is a quadratic rounded rectangle, not a box.
 *  A rectangular live image protrudes beyond its corners into empty space. */
export function mirrorGlassGeometry(w, h, radius = 0) {
  if (!radius) return new THREE.PlaneGeometry(w, h);
  const r = Math.min(radius, w * .45, h * .45), points = [];
  const corners = [[w/2, -h/2], [w/2, h/2], [-w/2, h/2], [-w/2, -h/2]];
  for (let i = 0; i < corners.length; i++) {
    const previous = new THREE.Vector2(...corners[(i + 3) % 4]);
    const corner = new THREE.Vector2(...corners[i]), next = new THREE.Vector2(...corners[(i + 1) % 4]);
    const a = previous.sub(corner).normalize().multiplyScalar(r).add(corner);
    const b = next.sub(corner).normalize().multiplyScalar(r).add(corner);
    for (let j = 0; j <= 4; j++) {
      const t = j / 4;
      points.push(a.clone().multiplyScalar((1-t) ** 2).addScaledVector(corner, 2 * (1-t) * t).addScaledVector(b, t * t));
    }
  }
  const geometry = new THREE.ShapeGeometry(new THREE.Shape(points)), pos = geometry.attributes.position, uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / w + .5, pos.getY(i) / h + .5);
  return geometry;
}

export class Cockpit {
  /** carView: the local player's CarView (GLB model). */
  constructor(carView) {
    this.cv = carView; this.model = carView.model;
    this.group = new THREE.Group(); this.group.name = 'cockpit'; this.model.add(this.group);
    this.active = false; this.frame = 0; this.meshes = [];
    this.rt = new THREE.WebGLRenderTarget(RT_W, RT_H, { type: THREE.HalfFloatType, generateMipmaps: false, depthBuffer: true });
    this.rt.texture.minFilter = THREE.LinearFilter; this.rt.texture.magFilter = THREE.LinearFilter;
    const vfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(REAR_HFOV / 2)) / (RT_W / RT_H));
    this.rearCam = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(vfov), RT_W / RT_H, 0.3, 170);
    this.frustum = new THREE.Frustum();
    this.dark = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.55, metalness: 0.2 });
    this.glassMat = new THREE.MeshBasicMaterial({ map: this.rt.texture, color: 0xcfcfcf, fog: false });
    // this truck's own glass: from inside it must be nearly invisible (tinted/reflective glass in front of the eye washes out
    // the whole world) -- per-instance clones so enemies/other views keep the normal look
    this.glass = []; this.glassSwap = [];
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      const arr = Array.isArray(o.material);
      const mats = arr ? o.material.slice() : [o.material];
      let changed = false;
      for (let i = 0; i < mats.length; i++) if (mats[i] && mats[i].name === 'glass') { const c = mats[i].clone(); c.userData.base = { opacity: c.opacity, env: c.envMapIntensity ?? 1, color: c.color.clone() }; mats[i] = c; this.glass.push(c); changed = true; }
      if (changed) { this.glassSwap.push({ mesh: o, full: o.material }); o.material = arr ? mats : mats[0]; }
    });
    this._measure();
    this.windshieldHits = 0; this.windshieldBroken = false;
    this._frontGlass();
    this._sunStrip();
    this._mirrors();
    this._cluster();
    this._windshield();
    this.hpSeen = 1; this.cracks = 0;
    this.active = true; this.setActive(false);
  }

  /** Only this truck's front glass is removable. Other windows can share its
   *  mesh/material, so preserve their triangles rather than hiding the mesh. */
  _frontGlass() {
    this.frontGlassSwap = [];
    const inv = new THREE.Matrix4().copy(this.model.matrixWorld).invert();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    this.model.traverse(o => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      // An explicitly authored front-window panel can own glass independently
      // of the rigid body. Other door/hatch panels retain their full geometry.
      // The group/material scan below removes only its forward glass triangles;
      // painted retainers, pillars and other cabin furniture stay intact.
      let outerPanel = null;
      for (let p = o; p && p !== this.model; p = p.parent) if (/^panel_/.test(p.name)) outerPanel = p.name;
      if (outerPanel && outerPanel !== this.cv.spec.cockpit?.frontGlassPanel) return;
      const full = o.geometry, pos = full.attributes.position, idx = full.index, mats = [].concat(o.material);
      const groups = full.groups.length ? full.groups : [{ start: 0, count: idx ? idx.count : pos.count, materialIndex: 0 }];
      const mw = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), keep = [], keptGroups = [];
      let cut = 0;
      for (const group of groups) {
        const start = keep.length, glass = (mats[group.materialIndex] || mats[0])?.name === 'glass';
        for (let i = group.start; i < group.start + group.count; i += 3) {
          const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
          if (glass) {
            a.fromBufferAttribute(pos, ia).applyMatrix4(mw); b.fromBufferAttribute(pos, ib).applyMatrix4(mw); c.fromBufferAttribute(pos, ic).applyMatrix4(mw);
            if ((a.z + b.z + c.z) / 3 >= this.wheelPos.z - 0.05) { cut++; continue; }
          }
          keep.push(ia, ib, ic);
        }
        if (keep.length > start) keptGroups.push({ start, count: keep.length - start, materialIndex: group.materialIndex });
      }
      if (!cut) return;
      const broken = full.clone(); broken.setIndex(keep); broken.clearGroups();
      for (const group of keptGroups) broken.addGroup(group.start, group.count, group.materialIndex);
      this.frontGlassSwap.push({ mesh: o, full, broken });
    });
  }

  // ---------------------------------------------------------------- measurement (model space)
  _local(obj, out) { this.model.updateMatrixWorld(true); obj.getWorldPosition(out); return this.model.worldToLocal(out); }
  _measure() {
    const M = this.model; M.updateMatrixWorld(true);
    const inv = _m.copy(M.matrixWorld).invert();
    const s = this.cv.sockets;
    this.wheelPos = s.steering_wheel ? this._local(s.steering_wheel, new THREE.Vector3()) : new THREE.Vector3(0.4, 1.1, 0.7);
    this.colDir = new THREE.Vector3(0, 0, 1);
    if (s.steering_wheel) { const q = new THREE.Quaternion(); s.steering_wheel.getWorldQuaternion(q); const mq = new THREE.Quaternion(); M.getWorldQuaternion(mq); this.colDir.applyQuaternion(mq.invert().multiply(q)); }
    this.seatPos = s.seat_driver ? this._local(s.seat_driver, new THREE.Vector3()) : new THREE.Vector3(0.4, 0.8, 0);
    this.gunSeat = s.seat_gunner ? this._local(s.seat_gunner, new THREE.Vector3()) : new THREE.Vector3(0, 0.9, -1.5);
    const shield = [], housings = { L: null, R: null };
    const doorVerts = { L: [], R: [] }, doorGlass = { L: new THREE.Box3(), R: new THREE.Box3() }, rvmVerts = [];
    let minZ = 1e9;
    M.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      let door = null; for (let p = o; p && p !== M; p = p.parent) { const m = /^panel_(?:door|armor)_([LR])$/.exec(p.name); if (m) { door = m[1]; break; } }
      const mats = [].concat(o.material), pos = o.geometry.attributes.position, idx = o.geometry.index;
      const mw = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      const groups = o.geometry.groups.length ? o.geometry.groups : [{ start: 0, count: idx ? idx.count : pos.count, materialIndex: 0 }];
      for (const g of groups) {
        const mname = (mats[g.materialIndex] || mats[0])?.name || '', glass = mname === 'glass';
        const rvm = !door && mname === 'rubber';
        if (!glass && !door && !rvm) continue;
        const step = Math.max(1, Math.floor(g.count / 6000));
        for (let i = g.start; i < g.start + g.count; i += step) {
          _v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(mw);
          if (rvm) { if (Math.abs(_v.x) < 0.36 && _v.y > 1.0) rvmVerts.push(_v.x, _v.y, _v.z); continue; }
          if (glass && !door) { shield.push(_v.x, _v.y, _v.z); minZ = Math.min(minZ, _v.z); }
          else if (glass) doorGlass[door].expandByPoint(_v);
          else doorVerts[door].push(_v.x, _v.y, _v.z);
        }
      }
    });
    // windshield: body glass ahead of the steering wheel
    let top = -1e9, bot = 1e9, hw = 0;
    const wz = this.wheelPos.z - 0.05;
    for (let i = 0; i < shield.length; i += 3) { const x = shield[i], y = shield[i + 1], z = shield[i + 2]; if (z < wz) continue; top = Math.max(top, y); bot = Math.min(bot, y); hw = Math.max(hw, Math.abs(x)); }
    let tz = 0, tn = 0, bz = 0, bn = 0;
    for (let i = 0; i < shield.length; i += 3) { const y = shield[i + 1], z = shield[i + 2]; if (z < wz) continue; if (y > top - 0.04) { tz += z; tn++; } if (y < bot + 0.04) { bz += z; bn++; } }
    this.shield = top > -1e8 ? { top, bot, hw, topZ: tz / Math.max(1, tn), botZ: bz / Math.max(1, bn) } : { top: 1.6, bot: 1.1, hw: 0.72, topZ: 0.62, botZ: 1.0 };
    this.cabRearZ = minZ < 1e8 ? minZ : -0.6;
    // door mirror housings: door/armour geometry sticking out well beyond the side glass, near the front of the window
    for (const side of ['L', 'R']) {
      const a = doorVerts[side], gb = doorGlass[side]; if (!a.length || gb.isEmpty()) continue;
      const lim = Math.max(Math.abs(gb.min.x), Math.abs(gb.max.x)) + 0.1;
      const b = new THREE.Box3(); let n = 0;
      for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i]) > lim && a[i + 1] > gb.min.y - 0.25 && a[i + 1] < gb.max.y && a[i + 2] > gb.max.z - 0.5) { b.expandByPoint(_v.set(a[i], a[i + 1], a[i + 2])); n++; }
      if (n > 12 && b.max.y - b.min.y > 0.07 && b.max.z - b.min.z < 0.45) housings[side] = b;
    }
    this.housings = housings;
    // the truck's own rear-view mirror (chrome/metal cluster hanging near the top middle of the windshield), if it has one
    { const b = new THREE.Box3(); let n = 0; const S = this.shield;
      for (let i = 0; i < rvmVerts.length; i += 3) { const y = rvmVerts[i + 1], z = rvmVerts[i + 2]; if (y > S.bot + 0.22 && y < S.top && z > this.wheelPos.z - 0.1 && z < S.topZ + 0.12) { b.expandByPoint(_v.set(rvmVerts[i], y, z)); n++; } }
      // the mirror face = the rear-most vertices of that cluster
      const f = new THREE.Box3();
      if (n > 20) for (let i = 0; i < rvmVerts.length; i += 3) { const x = rvmVerts[i], y = rvmVerts[i + 1], z = rvmVerts[i + 2]; if (y > S.bot + 0.22 && y < S.top && z < b.min.z + 0.012 && z > this.wheelPos.z - 0.1) f.expandByPoint(_v.set(x, y, z)); }
      const w = f.max.x - f.min.x, h = f.max.y - f.min.y;
      this.rvm = !f.isEmpty() && w > 0.12 && w < 0.4 && h > 0.035 && h < 0.16 ? f : null; }
    // the driver's eye (model space) -- run.js refines it from the head bone, this is for aiming the mirrors
    this.eye = new THREE.Vector3(this.seatPos.x, this.seatPos.y + 0.78, this.seatPos.z + 0.1);
  }

  /** The windshield sun-strip decal reads mirror-reversed from inside and eats the top of the view: in the cockpit swap the
   *  body decal mesh for a copy without the triangles on the upper windshield (dash/door stickers stay). */
  _sunStrip() {
    const S = this.shield; this.decalSwap = [];
    const inv = new THREE.Matrix4().copy(this.model.matrixWorld).invert();
    this.model.traverse((o) => {
      if (!o.isMesh || Array.isArray(o.material) || o.material?.name !== 'decal' || !o.geometry.index) return;
      for (let p = o.parent; p && p !== this.model; p = p.parent) if (/^panel_/.test(p.name)) return;
      const g = o.geometry, pos = g.attributes.position, idx = g.index, mw = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      const keep = [], brokenKeep = []; const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      let cut = 0, brokenCut = 0;
      for (let i = 0; i < idx.count; i += 3) {
        a.fromBufferAttribute(pos, idx.getX(i)).applyMatrix4(mw); b.fromBufferAttribute(pos, idx.getX(i + 1)).applyMatrix4(mw); c.fromBufferAttribute(pos, idx.getX(i + 2)).applyMatrix4(mw);
        const y = (a.y + b.y + c.y) / 3, z = (a.z + b.z + c.z) / 3;
        const front = y >= S.bot - 0.04 && y <= S.top + 0.08 && z > this.wheelPos.z - 0.05 && Math.abs((a.x + b.x + c.x) / 3) <= S.hw + 0.08;
        if (front) brokenCut++; else brokenKeep.push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
        if (y > S.top - 0.3 && z > this.wheelPos.z - 0.05) { cut++; continue; }
        keep.push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
      }
      if (!cut && !brokenCut) return;
      const g2 = cut ? g.clone().setIndex(keep) : g;
      const broken = brokenCut ? g.clone().setIndex(brokenKeep) : g;
      this.decalSwap.push({ mesh: o, full: g, cut: g2, broken });
    });
  }

  // ---------------------------------------------------------------- mirrors
  _mirrorGlass(w, h, u0, u1, v0, v1, radius = 0) {
    const g = mirrorGlassGeometry(w, h, radius), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    const m = new THREE.Mesh(g, this.glassMat); m.renderOrder = 2; this.meshes.push(m); return m;
  }
  _face(obj, pos, parent) {
    // +Z of obj -> toward the driver's eye (obj's local frame expressed in `parent`)
    obj.position.copy(pos);
    const eye = _v.copy(this.eye); if (parent !== this.group) { this.model.localToWorld(eye); parent.worldToLocal(eye); }
    obj.quaternion.setFromRotationMatrix(_m.lookAt(eye, pos, new THREE.Vector3(0, 1, 0)));
  }
  _mirrors() {
    const S = this.shield;
    // preferred: the model's explicit mirror-glass sockets (+Z faces back into the cab; door ones ride on the door panels)
    const modelID = this.cv.spec.modelId || this.cv.spec.id;
    const GLASS = { truck_t1: [0.09, 0.14], truck_t2: [0.13, 0.23], truck_t3: [0.12, 0.19], truck_t4: [0.14, 0.21] }[modelID] || [0.12, 0.19];
    // New chassis keep their authored mirror shapes rather than inheriting the
    // tall pickup glass, which protrudes through the compact housings.
    const layout = this.cv.spec.cockpit?.mirrorLayout || (modelID === 'player_buggy_t1'
      ? { C: [.23, .07, .025], L: [.12, .10, .018], R: [.12, .10, .018] }
      : modelID === 'player_sedan_t1' ? { C: [.25, .08, .026], L: [.028, .17, .009], R: [.104, .104, .052] } : null);
    const sC = this.model.getObjectByName('mirror_C'), sL = this.model.getObjectByName('mirror_L'), sR = this.model.getObjectByName('mirror_R');
    if (sC) {
      const dims = layout?.C || [.25, .07, .026];
      const W = dims[0] * 0.97, H = dims[1] * 0.92, uw = 0.4, vh = (uw * RT_W) / (W / H) / RT_H;
      const g = this._mirrorGlass(W, H, 0.5 + uw / 2, 0.5 - uw / 2, 0.56 - vh / 2, 0.56 + vh / 2, dims[2] * .92); g.name = 'mirror_centre'; g.position.z = 0.002;
      sC.add(g); (this.sideGlass || (this.sideGlass = [])).push(g);
    }
    for (const [side, sk] of [['L', sL], ['R', sR]]) {
      if (!sk) continue;
      const dims = layout?.[side] || GLASS;
      const w = dims[0] * 0.96, h = dims[1] * 0.96, vh2 = 0.52, uw2 = (w / h) * vh2 * RT_H / RT_W;
      const radius = dims[2] == null ? 0 : dims[2] * .96;
      const mg = side === 'L' ? this._mirrorGlass(w, h, 0.86, 0.86 - uw2, 0.5 - vh2 / 2, 0.5 + vh2 / 2, radius) : this._mirrorGlass(w, h, 0.14 + uw2, 0.14, 0.5 - vh2 / 2, 0.5 + vh2 / 2, radius);
      mg.name = 'mirror_' + side; mg.position.z = 0.002; sk.add(mg); (this.sideGlass || (this.sideGlass = [])).push(mg);
    }
    if (sC || sL || sR) { this._mirrorsFromSockets = true; }
    // fallback (models without mirror sockets): the truck's own rear-view mirror gets live glass; otherwise hang one from the roof
    if (sC) { /* done */ } else if (this.rvm) {
      const b = this.rvm, W = (b.max.x - b.min.x) * 0.92, H = (b.max.y - b.min.y) * 0.84;
      const uw = 0.4, vh = (uw * RT_W) / (W / H) / RT_H;
      const g = this._mirrorGlass(W, H, 0.5 + uw / 2, 0.5 - uw / 2, 0.56 - vh / 2, 0.56 + vh / 2); g.name = 'mirror_centre';
      g.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.min.z - 0.003); g.rotation.y = Math.PI; // flush on the housing, facing the cab
      this.group.add(g);
    } else {
      const c = new THREE.Group(); c.name = 'mirror_centre';
      const W = 0.24, H = 0.062;
      const body = new THREE.Mesh(new THREE.BoxGeometry(W + 0.025, H + 0.022, 0.035), this.dark); body.position.z = -0.02; c.add(body);
      const uw = 0.4, vh = (uw * RT_W) / (W / H) / RT_H;
      const g = this._mirrorGlass(W, H, 0.5 + uw / 2, 0.5 - uw / 2, 0.56 - vh / 2, 0.56 + vh / 2); c.add(g);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 6), this.dark); stem.position.set(0, H / 2 + 0.025, -0.03); c.add(stem);
      // hung from the roof just behind the top edge of the glass, above the driver's line of sight
      this._face(c, new THREE.Vector3(0.02, S.top - 0.03, S.topZ - 0.05), this.group);
      this.group.add(c); this.meshes.push(body, stem);
    }
    // side mirrors: glass on the rear face of the door housings (children of the door panel: a thrown door takes its mirror along)
    for (const side of ['L', 'R']) {
      const b = this.housings[side]; if (!b || this._mirrorsFromSockets) continue;
      const door = this.cv.panels.get('armor_' + side) || this.cv.panels.get('door_' + side) || this.model;
      const w = (b.max.x - b.min.x) * 0.82, h = (b.max.y - b.min.y) * 0.78;
      const vh2 = 0.52, uw2 = (w / h) * vh2 * RT_H / RT_W;
      // door mirrors look ~15-40 degrees off the rear axis: the lane beside/behind, not the verge
      const mg = side === 'L' ? this._mirrorGlass(w, h, 0.86, 0.86 - uw2, 0.5 - vh2 / 2, 0.5 + vh2 / 2) : this._mirrorGlass(w, h, 0.14 + uw2, 0.14, 0.5 - vh2 / 2, 0.5 + vh2 / 2);
      mg.name = 'mirror_' + side;
      const p = new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.min.z - 0.006);
      if (door !== this.model) { this.model.localToWorld(p); door.worldToLocal(p); }
      door.add(mg); this._face(mg, p, door);
      (this.sideGlass || (this.sideGlass = [])).push(mg);
    }
    // the rear camera sits at the back of the cab at eye height, looking straight back (the truck itself is hidden for this pass)
    this.rearLocal = new THREE.Vector3(0, S.top - 0.02, this.cabRearZ - 0.15);
    // look-back (from inside, the small rear window + guard + the gunner's legs block almost everything)
    // (head out of the driver's window, looking back down the truck's flank: the road behind, the raiders, a sliver of bed)
    this.lookBackLocal = new THREE.Vector3(Math.max(this.seatPos.x + 0.78, (this.cv.spec.width || 2) / 2 + 0.42), this.eye.y + 0.08, this.seatPos.z + 0.15); // (outboard of stacks/mirrors on wide trucks)
  }

  // ---------------------------------------------------------------- gauge cluster
  _cluster() {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 192;
    this.faceCtx = cv.getContext('2d'); this.faceTex = new THREE.CanvasTexture(cv); this.faceTex.colorSpace = THREE.SRGBColorSpace; this.faceTex.anisotropy = 4;
    this._drawFace({ nitro01: 0, hp01: 1, dhp01: 1, ghp01: 1, speed: 0 }, true);
    const W = 0.3, H = 0.1125;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(W, H), this.faceMat = new THREE.MeshBasicMaterial({ map: this.faceTex, fog: false, color: 0x9a9a9a }));
    const hood = new THREE.Mesh(new THREE.BoxGeometry(W + 0.03, H + 0.03, 0.05), this.dark); hood.position.z = -0.03;
    const brow = new THREE.Mesh(new THREE.BoxGeometry(W + 0.04, 0.012, 0.07), this.dark); brow.position.set(0, H / 2 + 0.02, 0.005);
    const c = new THREE.Group(); c.name = 'cluster'; c.add(hood, face, brow);
    // needles: pivot at dial centres (dials at x = +-0.075 of the face, i.e. canvas 128/384 px)
    const nm = this.needleMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, fog: false });
    const ng = new THREE.PlaneGeometry(0.004, 0.036).translate(0, 0.014, 0.002);
    this.needleS = new THREE.Mesh(ng, nm); this.needleS.position.set(-W / 4, -0.004, 0.001);
    this.needleR = new THREE.Mesh(ng, nm); this.needleR.position.set(W / 4, -0.004, 0.001);
    const hub = new THREE.CircleGeometry(0.006, 12).translate(0, 0, 0.003);
    const h1 = new THREE.Mesh(hub, this.dark); h1.position.copy(this.needleS.position); const h2 = new THREE.Mesh(hub, this.dark); h2.position.copy(this.needleR.position);
    c.add(this.needleS, this.needleR, h1, h2);
    const up = new THREE.Vector3(0, 1, 0), p = this.wheelPos.clone().addScaledVector(this.colDir, 0.2).addScaledVector(up, 0.075);
    this._face(c, p, this.group);
    this.group.add(c); this.cluster = c;
    this.meshes.push(face, hood, brow, this.needleS, this.needleR, h1, h2);
    this.faceT = 0; this.faceKey = '';
  }
  _drawFace(d, force) {
    this.gaugeState = d;
    const x = this.faceCtx, W = 512, H = 192;
    const nitro = Math.round((d.nitro01 || 0) * 20), warnHull = d.hp01 < 0.3, blink = (performance.now() / 400 | 0) % 2;
    const key = `${normalizeUnits(this.units)}|${nitro}|${warnHull && blink}`;
    if (!force && key === this.faceKey) return false;
    this.faceKey = key;
    x.fillStyle = '#07090b'; x.fillRect(0, 0, W, H);
    const dial = (cx, max, step, label, red) => {
      const R = 84, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
      x.fillStyle = '#0d1114'; x.beginPath(); x.arc(cx, 100, R, 0, Math.PI * 2); x.fill();
      x.lineWidth = 3; x.strokeStyle = '#2a3036'; x.beginPath(); x.arc(cx, 100, R, 0, Math.PI * 2); x.stroke();
      for (let v = 0; v <= max + 1e-6; v += step / 2) {
        const a = a0 + (a1 - a0) * (v / max), major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
        const r0 = major ? R - 16 : R - 9;
        x.strokeStyle = red && v >= red ? '#ff3b2b' : '#d9dee2'; x.lineWidth = major ? 3 : 1.6;
        x.beginPath(); x.moveTo(cx + Math.cos(a) * r0, 100 + Math.sin(a) * r0); x.lineTo(cx + Math.cos(a) * (R - 3), 100 + Math.sin(a) * (R - 3)); x.stroke();
        if (major) { x.fillStyle = '#e6eaee'; x.font = 'bold 15px Bahnschrift, Segoe UI, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(Math.round(v)), cx + Math.cos(a) * (R - 30), 100 + Math.sin(a) * (R - 30)); }
      }
      x.fillStyle = '#8b949c'; x.font = '600 12px Bahnschrift, Segoe UI, sans-serif'; x.textAlign = 'center'; x.fillText(label, cx, 142);
    };
    const speedDial = SPEED_DIAL[normalizeUnits(this.units)];
    dial(128, speedDial.max, speedDial.step, speedLabel(this.units)); dial(384, 8, 1, 'x1000 RPM', 6.5);
    // centre stack: nitro bar + lamps
    x.fillStyle = '#10151a'; x.fillRect(236, 26, 40, 140);
    for (let i = 0; i < 20; i++) { x.fillStyle = i < nitro ? (i > 14 ? '#6fe3ff' : '#1fa8ff') : '#15202a'; x.fillRect(241, 158 - i * 6.6, 30, 4.6); }
    x.fillStyle = '#6f8fa6'; x.font = '600 11px Bahnschrift, Segoe UI, sans-serif'; x.fillText('N2O', 256, 16);
    const lamp = (lx, ly, on, col, txt) => { x.fillStyle = on ? col : '#1b1f23'; x.beginPath(); x.arc(lx, ly, 9, 0, Math.PI * 2); x.fill(); x.fillStyle = on ? '#fff' : '#3a4148'; x.font = 'bold 9px sans-serif'; x.fillText(txt, lx, ly + 1); };
    lamp(208, 176, warnHull && blink, '#ff3322', 'CAR');
    this.faceTex.needsUpdate = true;
    return true;
  }

  // ---------------------------------------------------------------- windshield damage
  _windshield() {
    const S = this.shield, cv = document.createElement('canvas'); cv.width = 1024; cv.height = 512;
    this.crackCtx = cv.getContext('2d'); this.crackTex = new THREE.CanvasTexture(cv); this.crackTex.colorSpace = THREE.SRGBColorSpace;
    const g = new THREE.BufferGeometry();
    const hw = S.hw * 0.96, inset = -0.012; // a hair inside the glass
    // corners: u=0 on the driver's LEFT (+X), v=1 at the top
    const P = [hw, S.bot + 0.02, S.botZ + inset, -hw, S.bot + 0.02, S.botZ + inset, hw, S.top - 0.02, S.topZ + inset, -hw, S.top - 0.02, S.topZ + inset];
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
    g.setIndex([0, 2, 1, 1, 2, 3]); g.computeVertexNormals();
    this.crackMat = new THREE.MeshBasicMaterial({ map: this.crackTex, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, opacity: 0.9 });
    const m = new THREE.Mesh(g, this.crackMat); m.name = 'windshield_damage'; m.renderOrder = 95; // after particles: cracks sit in front of flames outside m.visible = false;
    this.group.add(m); this.crackMesh = m; this.meshes.push(m);
    this._dust();
  }
  _dust() {
    if (this.windshieldBroken) return;
    // a light film of dust and bug splats toward the edges (drawn once; cracks are added on top)
    const x = this.crackCtx, W = 1024, H = 512;
    const gr = x.createRadialGradient(W / 2, H * 0.55, H * 0.35, W / 2, H * 0.55, W * 0.62);
    gr.addColorStop(0, 'rgba(190,170,140,0)'); gr.addColorStop(1, 'rgba(190,170,140,0.16)');
    x.fillStyle = gr; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 26; i++) { const px = Math.random() * W, py = Math.random() * H * 0.9; x.fillStyle = `rgba(60,50,30,${0.18 + Math.random() * 0.25})`; x.beginPath(); x.arc(px, py, 1 + Math.random() * 2.2, 0, Math.PI * 2); x.fill(); }
    this.crackTex.needsUpdate = true; this.crackMesh && (this.crackMesh.visible = true);
  }
  /** A bullet hole with a spider-web crack. u,v in 0..1 (u=0 driver's left, v=1 top). */
  bulletHole(u = Math.random() * 0.55, v = 0.35 + Math.random() * 0.5) {
    if (this.windshieldBroken) return false;
    this.windshieldHits++;
    if (this.windshieldHits >= WINDSHIELD_BREAK_HITS) { this._breakWindshield(); return true; }
    const x = this.crackCtx, W = 1024, H = 512, cx = u * W, cy = (1 - v) * H;
    const n = 9 + (Math.random() * 6 | 0), R = 60 + Math.random() * 70;
    x.lineCap = 'round';
    const spokes = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5; let px = cx, py = cy; const pts = [[px, py]];
      const len = R * (0.5 + Math.random() * 0.8);
      for (let s = 0; s < 5; s++) { const aa = a + (Math.random() - 0.5) * 0.35, st = len / 5; px += Math.cos(aa) * st; py += Math.sin(aa) * st; pts.push([px, py]); }
      spokes.push(pts);
    }
    for (const [w, c] of [[3.2, 'rgba(20,24,28,0.35)'], [1.3, 'rgba(235,240,245,0.75)']]) {
      x.lineWidth = w; x.strokeStyle = c;
      for (const pts of spokes) { x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); for (const p of pts) x.lineTo(p[0], p[1]); x.stroke(); }
      // concentric rings between spokes
      for (const rr of [0.28, 0.52]) {
        x.beginPath();
        for (let i = 0; i < spokes.length; i++) { const a = spokes[i], b = spokes[(i + 1) % spokes.length]; const ia = Math.min(a.length - 1, Math.round(rr * 5)), ib = Math.min(b.length - 1, Math.round(rr * 5) + (Math.random() < 0.3 ? 1 : 0)); if (Math.random() < 0.25) continue; x.moveTo(a[ia][0], a[ia][1]); x.lineTo(b[ib][0], b[ib][1]); }
        x.stroke();
      }
    }
    // the hole: frosted ring + dark core
    const gr = x.createRadialGradient(cx, cy, 0, cx, cy, 16); gr.addColorStop(0, 'rgba(10,10,10,0.95)'); gr.addColorStop(0.35, 'rgba(40,40,40,0.9)'); gr.addColorStop(0.6, 'rgba(230,235,240,0.7)'); gr.addColorStop(1, 'rgba(230,235,240,0)');
    x.fillStyle = gr; x.beginPath(); x.arc(cx, cy, 16, 0, Math.PI * 2); x.fill();
    this.crackTex.needsUpdate = true; this.crackMesh.visible = true;
    return false;
  }
  _breakWindshield() {
    this.windshieldBroken = true;
    this.crackCtx.clearRect(0, 0, 1024, 512); this.crackTex.needsUpdate = true; this.crackMesh.visible = false;
    for (const d of this.frontGlassSwap) d.mesh.geometry = d.broken;
    for (const d of this.decalSwap) d.mesh.geometry = d.broken;
  }
  /** Backtrack a confirmed bullet impact along its incoming ray to the front
   *  window. Crew damage alone has no direction and can also be an explosion. */
  _windowImpact(e) {
    if (!e.enemy || e.carId !== 1 || !e.pos?.every(Number.isFinite) || !e.normal?.every(Number.isFinite)) return false;
    this.model.updateWorldMatrix(true, false);
    _m.copy(this.model.matrixWorld).invert();
    _impact.fromArray(e.pos).applyMatrix4(_m); _incoming.fromArray(e.normal).transformDirection(_m);
    const S = this.shield, dy = S.top - S.bot;
    if (dy <= 0) return false;
    const slope = (S.topZ - S.botZ) / dy;
    const den = _incoming.z - slope * _incoming.y;
    // A ray from the side/rear cannot have entered through the front glass.
    if (den <= 1e-5) return false;
    const t = (S.botZ + slope * (_impact.y - S.bot) - _impact.z) / den;
    if (t < 0 || t > 4) return false;
    _impact.addScaledVector(_incoming, t);
    if (_impact.y < S.bot || _impact.y > S.top || Math.abs(_impact.x) > S.hw) return false;
    this.impactU = (S.hw - _impact.x) / (2 * S.hw); this.impactV = (_impact.y - S.bot) / dy;
    return true;
  }
  /** A long impact crack running in from an edge. */
  crashCrack(strength = 1) {
    if (this.windshieldBroken) return;
    const x = this.crackCtx, W = 1024, H = 512;
    const edge = Math.random() * 4 | 0;
    let px = edge === 0 ? 0 : edge === 1 ? W : Math.random() * W, py = edge === 2 ? 0 : edge === 3 ? H : Math.random() * H;
    const tx = W * (0.3 + Math.random() * 0.4), ty = H * (0.3 + Math.random() * 0.4);
    const segs = 14 + (strength * 10 | 0);
    const main = [[px, py]];
    for (let i = 0; i < segs; i++) { const k = 1 / (segs - i); px += (tx - px) * k * 0.8 + (Math.random() - 0.5) * 40; py += (ty - py) * k * 0.8 + (Math.random() - 0.5) * 40; main.push([px, py]); }
    const branches = [];
    for (let i = 3; i < main.length; i += 3) { let bx = main[i][0], by = main[i][1]; const a = Math.random() * Math.PI * 2; const b = [[bx, by]]; for (let s = 0; s < 5; s++) { bx += Math.cos(a + (Math.random() - 0.5)) * 22; by += Math.sin(a + (Math.random() - 0.5)) * 22; b.push([bx, by]); } branches.push(b); }
    for (const [w, c] of [[3.5, 'rgba(20,24,28,0.3)'], [1.4, 'rgba(235,240,245,0.7)']]) {
      x.lineWidth = w; x.strokeStyle = c;
      for (const pts of [main, ...branches]) { x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); for (const p of pts) x.lineTo(p[0], p[1]); x.stroke(); }
    }
    this.crackTex.needsUpdate = true; this.crackMesh.visible = true;
  }

  // ---------------------------------------------------------------- per frame
  setActive(on) {
    if (on === this.active) return;
    this.active = on; this.group.visible = on;
    if (this.sideGlass) for (const g of this.sideGlass) g.visible = on;
    // armoured visor: from inside it would leave a letterbox slit above the road -- the driver looks past it (outside it's still there)
    const visor = this.cv.panels.get('armor_windshield');
    if (visor && !visor.userData.gone) visor.visible = !on;
    for (const d of this.decalSwap || []) d.mesh.geometry = this.windshieldBroken ? d.broken : on ? d.cut : d.full;
    for (const m of this.glass) { const b = m.userData.base; m.opacity = on ? 0.05 : b.opacity; m.envMapIntensity = on ? 0.12 : b.env; if (on) m.color.setRGB(0.85, 0.88, 0.9).multiplyScalar(0.5); else m.color.copy(b.color); }
  }
  /** d: run.hud2. night: 0..1. */
  setUnits(units) {
    units = normalizeUnits(units);
    if (units === this.units) return;
    this.units = units;
    if (!this.faceCtx) return;
    const d = this.gaugeState || { nitro01: 0, hp01: 1, dhp01: 1, ghp01: 1, speed: 0 };
    this._drawFace(d, true);
    const sp = clamp(speedValue(d.speed || 0, units) / SPEED_DIAL[units].max, 0, 1.04);
    this.needleS.rotation.z = -(Math.PI * .75 + Math.PI * 1.5 * sp) - Math.PI / 2;
  }
  update(dt, d, night = 0) {
    if (!this.active || !d) return;
    // needles (smooth, per frame)
    const sp = clamp(speedValue(d.speed || 0, this.units) / SPEED_DIAL[normalizeUnits(this.units)].max, 0, 1.04), rp = clamp((d.rpm01 || 0) * 7.6 / 8, 0, 1);
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    // canvas angle a (clockwise from +x, y down) -> mesh rotation about z (counter-clockwise from +y)
    this.needleS.rotation.z = -(a0 + (a1 - a0) * sp) - Math.PI / 2;
    this.needleR.rotation.z = -(a0 + (a1 - a0) * rp) - Math.PI / 2;
    this.faceT -= dt; if (this.faceT <= 0) { this.faceT = 0.1; this._drawFace(d); }
    // backlight brighter at night
    const k = 0.62 + night * 0.6; this.faceMat.color.setScalar(k); this.needleMat.color.setRGB(1 * (0.8 + night * 0.4), 0.48, 0.1);
    // windshield damage follows the truck's hp
    if (d.hp01 < this.hpSeen - 0.14) { this.hpSeen = d.hp01; this.crashCrack(1 - d.hp01); }
  }
  onEvent(e) {
    if (this.windshieldBroken) return;
    if (e.t === 'hit' && this._windowImpact(e)) {
      if (this.bulletHole(this.impactU, this.impactV)) {
        _v.set(0, (this.shield.bot + this.shield.top) / 2, (this.shield.botZ + this.shield.topZ) / 2);
        this.model.localToWorld(_v);
        return { t: 'windshieldBreak', id: 1, pos: _v.toArray() };
      }
    } else if (e.t === 'crash' && e.id === 1 && e.dv > 7 && Math.random() < 0.5) this.crashCrack(clamp(e.dv / 15, 0.3, 1));
  }

  /** Render the shared rear view (every other frame). playerRoot is hidden for the pass. */
  renderMirrors(renderer, scene, playerRoot) {
    if (!this.active) return;
    // ~20 Hz, ~10 Hz when nobody is behind us (a mirror of an empty road can idle)
    const every = this.threatBehind === false ? 6 : 3;
    if ((this.frame++ % every) !== 0) return;
    const cam = this.rearCam;
    this.model.updateMatrixWorld();
    cam.position.copy(this.rearLocal); this.model.localToWorld(cam.position);
    this.model.getWorldQuaternion(cam.quaternion); // identity in truck frame = looking backwards (cameras look down -Z)
    cam.rotateX(-0.06);
    cam.updateMatrixWorld();
    _pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); this.frustum.setFromProjectionMatrix(_pv);
    // hide every mirror glass (a door thrown off the truck carries its glass into the world: sampling the target we render into = feedback loop)
    const vis = playerRoot.visible, glassVis = this.glassMat.visible; playerRoot.visible = false; this.glassMat.visible = false;
    // Keep the mirror useful for traffic and the road; tiny dressing/particles
    // consume another full set of draws in this small rear render.
    const hidden = this._mirrorHide || (this._mirrorHide = []), hv = this._mirrorVisible || (this._mirrorVisible = []);
    hidden.length = 0; hv.length = 0;
    for (const c of scene.children) if (/^(dressing-pool|fx_|hazard_marks)/.test(c.name || '')) { hidden.push(c); hv.push(c.visible); c.visible = false; }
    const auto = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
    const prev = renderer.getRenderTarget();
    // the post pipeline turns autoClear off: clear colour+depth ourselves or every frame smears into the last (ghost trails)
    // world matrices are one frame old here (updated by last frame's main render): fine for a 30 Hz mirror, saves a full scene-graph walk
    const mau = scene.matrixWorldAutoUpdate; scene.matrixWorldAutoUpdate = false;
    const lods = this._mirrorLods || (this._mirrorLods = []); lods.length = 0;
    try {
      // Five merged meshes are enough to identify traffic in the small mirror.
      // Keep the main camera's model, crew visibility and animation pose intact.
      const cars = scene.children.find(c => c.name === 'cars');
      const cache = this._mirrorCars || (this._mirrorCars = new WeakMap());
      for (const car of cars?.children || []) {
        if (car === playerRoot || !car.visible || !car.name.startsWith('car_')) continue;
        const lod = car.children.find(c => c.name === 'lod'), model = car.children[0];
        if (!lod || !model) continue;
        let rec = cache.get(car);
        if (!rec || rec.lod !== lod || rec.model !== model) {
          const wheels = []; model.traverse(o => { if (/^wheel_[A-Za-z0-9]+$/.test(o.name)) wheels.push(o); });
          const nodes = []; lod.traverse(o => nodes.push({ o, pos: o.position.clone(), quat: o.quaternion.clone(), scale: o.scale.clone(), matrix: o.matrix.clone(), world: o.matrixWorld.clone() }));
          rec = { lod, model, wheels, nodes }; cache.set(car, rec);
        }
        lods.push(rec);
        for (const n of rec.nodes) {
          const o = n.o; n.pos.copy(o.position); n.quat.copy(o.quaternion); n.scale.copy(o.scale);
          n.matrix.copy(o.matrix); n.world.copy(o.matrixWorld);
          n.visible = o.visible; n.auto = o.matrixWorldAutoUpdate; n.dirty = o.matrixWorldNeedsUpdate;
        }
        for (const child of car.children) if (child === model || child.name === 'shadow_proxy' || child.name.startsWith('crew_')) {
          hidden.push(child); hv.push(child.visible); child.visible = false;
        }
        lod.visible = true; lod.matrixWorldAutoUpdate = true;
        for (let i = 0; i < rec.wheels.length; i++) {
          const source = rec.wheels[i], wheel = lod.children[i + 1]; if (!wheel) continue;
          wheel.position.copy(source.position); wheel.quaternion.copy(source.quaternion); wheel.scale.copy(source.scale);
          wheel.visible = !source.userData.gone;
        }
        lod.updateMatrixWorld(true);
      }
      renderer.setRenderTarget(this.rt); renderer.clear(true, true, true); renderer.render(scene, cam);
    } finally {
      renderer.setRenderTarget(prev); scene.matrixWorldAutoUpdate = mau;
      renderer.shadowMap.autoUpdate = auto; playerRoot.visible = vis; this.glassMat.visible = glassVis;
      for (let i = 0; i < hidden.length; i++) hidden[i].visible = hv[i];
      for (const rec of lods) for (const n of rec.nodes) {
        const o = n.o; o.position.copy(n.pos); o.quaternion.copy(n.quat); o.scale.copy(n.scale);
        o.matrix.copy(n.matrix); o.matrixWorld.copy(n.world); o.visible = n.visible;
        o.matrixWorldAutoUpdate = n.auto; o.matrixWorldNeedsUpdate = n.dirty;
      }
    }
  }
  /** World position of the look-back camera. */
  lookBackWorld(out) { return this.model.localToWorld(out.copy(this.lookBackLocal)); }

  dispose() {
    if (this._disposed) return; this._disposed = true;
    this.group.removeFromParent(); if (this.sideGlass) for (const g of this.sideGlass) g.removeFromParent();
    this.rt.dispose(); this.faceTex.dispose(); this.crackTex.dispose();
    for (const m of this.meshes) m.geometry?.dispose();
    for (const d of this.glassSwap) d.mesh.material = d.full;
    for (const m of this.glass) m.dispose();
    for (const d of this.frontGlassSwap || []) { d.mesh.geometry = d.full; d.broken.dispose(); }
    for (const d of this.decalSwap || []) { d.mesh.geometry = d.full; if (d.cut !== d.full) d.cut.dispose(); if (d.broken !== d.full) d.broken.dispose(); }
    this.dark.dispose(); this.glassMat.dispose(); this.faceMat.dispose(); this.needleMat.dispose(); this.crackMat.dispose();
  }
}
