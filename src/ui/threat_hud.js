// Off-screen threat indicators for first person: every raider close enough to matter that is NOT on screen gets a chevron
// on an ellipse around the screen centre, pointing toward it (behind you = bottom of the screen). Size/brightness grow
// with proximity; gunners show red, rammers closing in pulse orange, minibosses/boss are big and gold.
import * as THREE from 'three';

const _d = new THREE.Vector3(), _r = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _p = new THREE.Vector3();
const RANGE = 110;

export class ThreatHUD {
  constructor() {
    const c = this.canvas = document.createElement('canvas');
    c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:3';
    document.body.appendChild(c);
    this.ctx = c.getContext('2d'); this.t = 0; this.visible = true; this.blips = new Map();
  }
  setVisible(v) { this.visible = v; this.canvas.style.display = v ? 'block' : 'none'; }

  /** camera: the view camera; states: Map of CarState; player: the local player's state. */
  update(dt, camera, states, player, isBoss = null, layout = null) {
    if (!this.visible) return;
    const c = this.canvas, dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const x = this.ctx; x.clearRect(0, 0, W, H);
    if (!player || player.exploded) return;
    this.t += dt;
    camera.getWorldDirection(_f); _r.set(1, 0, 0).applyQuaternion(camera.quaternion); _u.set(0, 1, 0).applyQuaternion(camera.quaternion);
    // ellipse kept inside the HUD corners (health bars bottom-left, speed/ammo bottom-right)
    // ring at windshield height, clear of the HUD corners (cockpit: flatter, so 'behind' sits above the dash, not on the gauges)
    const cx = W / 2, cy = H * (layout?.cy ?? 0.42), rx = W * (layout?.rx ?? 0.40), ry = H * (layout?.ry ?? 0.30);
    const seen = new Set();
    // one chevron per bearing sector: the closest raider in each ~24 degree slice speaks for the group (no 3-4 deep stacks)
    const best = this._best || (this._best = new Map()); best.clear();
    for (const st of states.values()) {
      if (st.kind !== 'enemy' || st.exploded) continue;
      _d.copy(st.pos).sub(camera.position); const dist = _d.length(); if (dist > RANGE) continue;
      const sector = Math.round(Math.atan2(_d.dot(_r), _d.dot(_f)) / 0.42);
      const cur = best.get(sector); if (!cur || cur.d > dist) best.set(sector, { id: st.id, d: dist });
    }
    const keep = this._keep || (this._keep = new Set()); keep.clear(); for (const v of best.values()) keep.add(v.id);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    for (const st of states.values()) {
      if (st.kind !== 'enemy' || st.exploded || !keep.has(st.id)) continue;
      _d.copy(st.pos).sub(camera.position); const dist = _d.length(); if (dist > RANGE) continue;
      // on screen? (projected inside a margin and in front of the camera)
      _p.copy(st.pos).project(camera);
      const onScreen = _p.z < 1 && Math.abs(_p.x) < 0.9 && Math.abs(_p.y) < 0.88 && _d.dot(_f) > 0;
      let b = this.blips.get(st.id); if (!b) { b = { k: 0 }; this.blips.set(st.id, b); }
      seen.add(st.id);
      b.k += ((onScreen ? 0 : 1) - b.k) * Math.min(1, dt * 8);
      if (b.k < 0.02) continue;
      const bx = _d.dot(_r), bz = _d.dot(_f);
      const ang = Math.atan2(bx, bz);                        // 0 = ahead (top), pi = behind (bottom)
      const near = 1 - dist / RANGE;
      const closing = -_d.normalize().dot(_p.copy(st.vel).sub(player.vel));
      const boss = !!st.elite || (isBoss ? isBoss(st) : false);
      const intent = st.intent || null;
      const ram = intent === 'ram' || (closing > 7 && dist < 35 && !st.gunnerAlive);
      const block = intent === 'block';
      const col = ram ? [255, 140, 20] : boss ? [255, 194, 26] : (intent === 'shoot' || st.gunnerAlive) ? [255, 58, 44] : [235, 150, 90];
      const pulse = ram || block ? 0.6 + 0.4 * Math.sin(this.t * 20) : 1;
      const alpha = b.k * (0.45 + 0.55 * near) * pulse;
      const size = (boss ? 34 : 22 + near * 24) * (ram ? 1.35 : 1) * dpr;
      const px = cx + Math.sin(ang) * rx, py = cy - Math.cos(ang) * ry;
      x.save(); x.translate(px, py); x.rotate(ang);
      x.globalAlpha = alpha;
      x.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`; x.strokeStyle = 'rgba(0,0,0,0.6)'; x.lineWidth = 2.5 * dpr;
      // chevron pointing outward (up in the rotated frame); a second one stacked when close
      x.beginPath(); x.moveTo(0, -size); x.lineTo(size * 0.78, size * 0.22); x.lineTo(0, -size * 0.26); x.lineTo(-size * 0.78, size * 0.22); x.closePath();
      x.stroke(); x.fill();
      if (near > 0.5) { x.globalAlpha = alpha * 0.65; x.beginPath(); x.moveTo(0, -size * 1.6); x.lineTo(size * 0.55, -size * 0.88); x.lineTo(0, -size * 1.12); x.lineTo(-size * 0.55, -size * 0.88); x.closePath(); x.fill(); }
      x.restore();
      // label: distance for close threats, RAM! / BRAKE! when a raider commits
      if (dist < 45 || ram || block) {
        // label on the outer side of its chevron (never drifting into the view where it could be read as another car's)
        const lx = Math.min(W - 60 * dpr, Math.max(60 * dpr, px + Math.sin(ang) * size * 1.9)), ly = Math.min(H - 40 * dpr, Math.max(40 * dpr, py - Math.cos(ang) * size * 1.7));
        x.globalAlpha = Math.min(1, alpha * 1.25);
        const big = ram || block, fs = Math.round((big ? 28 : 20) * dpr);
        x.font = `800 ${fs}px Bahnschrift, Segoe UI, sans-serif`;
        const txt = ram ? 'RAM!' : block ? 'BRAKE!' : `${Math.round(dist)} m`;
        const tw = x.measureText(txt).width, pw = tw + fs * 0.9, ph = fs * 1.35;
        x.fillStyle = big ? 'rgba(120,20,10,0.78)' : 'rgba(10,10,12,0.62)';
        x.beginPath(); x.roundRect ? x.roundRect(lx - pw / 2, ly - ph / 2, pw, ph, 4 * dpr) : x.rect(lx - pw / 2, ly - ph / 2, pw, ph); x.fill();
        x.lineWidth = 3 * dpr; x.strokeStyle = 'rgba(0,0,0,0.75)'; x.strokeText(txt, lx, ly + fs * 0.04);
        x.fillStyle = big ? '#ffd24a' : '#f2e6dc'; x.fillText(txt, lx, ly + fs * 0.04);
      }
    }
    for (const id of this.blips.keys()) if (!seen.has(id)) this.blips.delete(id);
    x.globalAlpha = 1;
  }
  dispose() { this.canvas.remove(); }
}
