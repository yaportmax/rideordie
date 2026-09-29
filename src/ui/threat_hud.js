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
  update(dt, camera, states, player, isBoss = null) {
    if (!this.visible) return;
    const c = this.canvas, dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const x = this.ctx; x.clearRect(0, 0, W, H);
    if (!player || player.exploded) return;
    this.t += dt;
    camera.getWorldDirection(_f); _r.set(1, 0, 0).applyQuaternion(camera.quaternion); _u.set(0, 1, 0).applyQuaternion(camera.quaternion);
    // ellipse kept inside the HUD corners (health bars bottom-left, speed/ammo bottom-right)
    const cx = W / 2, cy = H * 0.47, rx = W * 0.40, ry = H * 0.34;
    const seen = new Set();
    x.textAlign = 'center'; x.textBaseline = 'middle';
    for (const st of states.values()) {
      if (st.kind !== 'enemy' || st.exploded) continue;
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
      const size = (boss ? 30 : 18 + near * 22) * (ram ? 1.35 : 1) * dpr;
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
        const lx = cx + Math.sin(ang) * (rx - size * 1.9), ly = cy - Math.cos(ang) * (ry - size * 1.9);
        x.globalAlpha = Math.min(1, alpha * 1.2);
        x.font = `700 ${Math.round((ram || block ? 17 : 13) * dpr)}px Bahnschrift, Segoe UI, sans-serif`;
        const txt = ram ? 'RAM!' : block ? 'BRAKE!' : `${Math.round(dist)} m`;
        x.lineWidth = 3 * dpr; x.strokeStyle = 'rgba(0,0,0,0.7)'; x.strokeText(txt, lx, ly);
        x.fillStyle = ram || block ? '#ffd24a' : '#f2e6dc'; x.fillText(txt, lx, ly);
      }
    }
    for (const id of this.blips.keys()) if (!seen.has(id)) this.blips.delete(id);
    x.globalAlpha = 1;
  }
  dispose() { this.canvas.remove(); }
}
