// Unified input: keyboard + mouse (pointer lock) + Gamepad API (full controller support for driver AND gunner).
// Produces role-specific command structs each frame. Rebindable via `bindings`.
import { clamp, damp } from './util.js';

const DEADZONE = 0.14;
const applyDead = (v, dz = DEADZONE) => { const a = Math.abs(v); if (a < dz) return 0; return Math.sign(v) * (a - dz) / (1 - dz); };
const curve = (v, p = 1.6) => Math.sign(v) * Math.pow(Math.abs(v), p);

export const DEFAULT_BINDINGS = {
  // driver
  throttle: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'], nitro: ['ShiftLeft', 'ShiftRight'], reset: ['KeyR'], camera: ['KeyC'], lookBack: ['KeyB'], horn: ['KeyH'], special1: ['KeyQ'], special2: ['KeyE'], medkit: ['KeyX'],
  // gunner
  reload: ['KeyR'], grenade: ['KeyG'], crouch: ['ControlLeft', 'KeyC'], slot1: ['Digit1'], slot2: ['Digit2'], slot3: ['Digit3'], slot4: ['Digit4'], slot5: ['Digit5'], slot6: ['Digit6'],
  moveL: ['KeyA'], moveR: ['KeyD'], moveF: ['KeyW'], moveB: ['KeyS'], lean: ['KeyQ'], view: ['KeyV'],
  pause: ['Escape'],
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set(); this.pressed = new Set(); // pressed = edge this frame
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0;
    this.mouse = { left: false, right: false, middle: false }; this.mousePressed = { left: false, right: false };
    this.locked = false;
    this.bindings = { ...DEFAULT_BINDINGS };
    this.sens = { mouse: 0.0022, padYaw: 3.1, padPitch: 2.3, padAdsMul: 0.55 };
    this.invertY = false;
    this.pad = null; this.padPrev = new Array(20).fill(false); this.padEdge = new Array(20).fill(false);
    this.padConnected = false; this.padName = '';
    this.lastDevice = 'kbm';
    this.steerSmooth = 0;
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code); this.pressed.add(e.code); this.lastDevice = 'kbm';
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    canvas.addEventListener('mousedown', (e) => {
      this.lastDevice = 'kbm';
      if (e.button === 0) { this.mouse.left = true; this.mousePressed.left = true; } if (e.button === 2) { this.mouse.right = true; this.mousePressed.right = true; }
      if (e.button === 1) this.mouse.middle = true;
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.left = false; if (e.button === 2) this.mouse.right = false; if (e.button === 1) this.mouse.middle = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => { if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; } });
    addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
    addEventListener('gamepadconnected', (e) => { this.padConnected = true; this.padName = e.gamepad.id; });
    addEventListener('gamepaddisconnected', () => { this.padConnected = false; });
  }

  requestLock() { if (!this.locked) { try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } } }
  releaseLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  down(action) { return this.bindings[action].some((c) => this.keys.has(c)); }
  hit(action) { return this.bindings[action].some((c) => this.pressed.has(c)); }

  /** Poll the gamepad; call once per frame before reading commands. */
  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    this.pad = pad;
    if (pad) {
      this.padConnected = true; this.padName = pad.id;
      for (let i = 0; i < pad.buttons.length && i < 20; i++) {
        const d = pad.buttons[i].pressed || pad.buttons[i].value > 0.5;
        this.padEdge[i] = d && !this.padPrev[i]; this.padPrev[i] = d;
      }
      const act = pad.buttons.some((b) => b.pressed) || pad.axes.some((a) => Math.abs(a) > 0.4);
      if (act) this.lastDevice = 'pad';
    }
  }
  btn(i) { return !!(this.pad && this.pad.buttons[i] && (this.pad.buttons[i].pressed || this.pad.buttons[i].value > 0.5)); }
  btnV(i) { return this.pad && this.pad.buttons[i] ? this.pad.buttons[i].value : 0; }
  edge(i) { return !!this.padEdge[i]; }
  axis(i) { return this.pad ? applyDead(this.pad.axes[i] || 0) : 0; }
  rumble(strong = 0.5, weak = 0.5, ms = 120) {
    const a = this.pad && this.pad.vibrationActuator; if (!a || !a.playEffect) return;
    a.playEffect('dual-rumble', { startDelay: 0, duration: ms, weakMagnitude: clamp(weak, 0, 1), strongMagnitude: clamp(strong, 0, 1) }).catch(() => {});
  }

  /** Driver commands. Steering: +1 = left. */
  driver(dt) {
    const c = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, reset: false, cameraToggle: false, horn: false, special1: false, special2: false, medkit: this.hit('medkit'), lookX: 0, lookY: 0, lookBack: this.down('lookBack'), mouseYaw: 0, mousePitch: 0 };
    // mouse free-look (pointer locked): drifts back to straight ahead when the mouse rests
    const ml = this.mlook || (this.mlook = { yaw: 0, pitch: 0, idle: 0 });
    if (this.locked && (this.mouseDX || this.mouseDY)) {
      ml.yaw = clamp(ml.yaw - this.mouseDX * 0.0024, -2.3, 2.3); ml.pitch = clamp(ml.pitch - this.mouseDY * 0.0024 * (this.invertY ? -1 : 1), -0.55, 0.45); ml.idle = 0;
    } else { ml.idle += dt; if (ml.idle > 0.8) { ml.yaw = damp(ml.yaw, 0, 3.5, dt); ml.pitch = damp(ml.pitch, 0, 3.5, dt); } }
    c.mouseYaw = ml.yaw; c.mousePitch = ml.pitch;
    // keyboard
    let kSteer = (this.down('left') ? 1 : 0) - (this.down('right') ? 1 : 0);
    this.steerSmooth = damp(this.steerSmooth, kSteer, kSteer !== 0 ? 12 : 22, dt);
    if (Math.abs(this.steerSmooth - kSteer) < 0.01) this.steerSmooth = kSteer;
    c.steer = this.steerSmooth;
    c.throttle = this.down('throttle') ? 1 : 0; c.brake = this.down('brake') ? 1 : 0;
    c.handbrake = this.down('handbrake'); c.nitro = this.down('nitro'); c.reset = this.down('reset');
    c.cameraToggle = this.hit('camera'); c.horn = this.down('horn'); c.special1 = this.hit('special1'); c.special2 = this.hit('special2');
    // gamepad (standard mapping): LS steer, RS look, RT throttle, LT brake/reverse, A handbrake, RB nitro, Y reset (hold), X/B specials, R3 camera, LB look back
    if (this.pad) {
      const sx = applyDead(this.pad.axes[0] || 0, 0.1);
      let steer = -curve(sx, 1.35);
      const dpadL = this.btn(14), dpadR = this.btn(15);
      if (dpadL || dpadR) steer = (dpadL ? 1 : 0) - (dpadR ? 1 : 0);
      if (Math.abs(steer) > Math.abs(c.steer)) c.steer = steer;
      c.throttle = Math.max(c.throttle, this.btnV(7)); c.brake = Math.max(c.brake, this.btnV(6));
      c.handbrake = c.handbrake || this.btn(0); c.nitro = c.nitro || this.btn(5); c.reset = c.reset || this.btn(3);
      c.special1 = c.special1 || this.edge(2); c.special2 = c.special2 || this.edge(1);
      c.cameraToggle = c.cameraToggle || this.edge(10); c.lookBack = c.lookBack || this.btn(4); c.medkit = c.medkit || this.edge(13);
      c.lookX = applyDead(this.pad.axes[2] || 0); c.lookY = applyDead(this.pad.axes[3] || 0);
    }
    return c;
  }

  /** Gunner commands. yaw/pitch deltas in radians. */
  gunner(dt, adsActive = false) {
    const c = { dYaw: 0, dPitch: 0, fire: false, firePressed: false, ads: false, reload: false, grenade: false, swap: 0, slot: -1, crouch: false, moveX: 0, moveZ: 0, lean: 0, melee: false, pause: false, medkit: this.hit('medkit') };
    const mul = this.sens.mouse;
    c.dYaw = -this.mouseDX * mul; c.dPitch = -this.mouseDY * mul * (this.invertY ? -1 : 1);
    c.fire = this.mouse.left; c.firePressed = this.mousePressed.left; c.ads = this.mouse.right;
    c.reload = this.hit('reload'); c.grenade = this.hit('grenade'); c.crouch = this.down('crouch'); c.viewToggle = this.hit('view');
    c.swap = -this.wheel; // wheel up => next
    for (let i = 1; i <= 6; i++) if (this.hit('slot' + i)) c.slot = i - 1;
    c.moveX = (this.down('moveL') ? 1 : 0) - (this.down('moveR') ? 1 : 0); c.moveZ = (this.down('moveF') ? 1 : 0) - (this.down('moveB') ? 1 : 0);
    c.lean = this.down('lean') ? 1 : 0;
    if (this.pad) {
      const ax = applyDead(this.pad.axes[2] || 0, 0.12), ay = applyDead(this.pad.axes[3] || 0, 0.12);
      const s = adsActive ? this.sens.padAdsMul : 1;
      c.dYaw += -curve(ax, 1.7) * this.sens.padYaw * dt * s; c.dPitch += -curve(ay, 1.7) * this.sens.padPitch * dt * s * (this.invertY ? -1 : 1);
      c.fire = c.fire || this.btnV(7) > 0.35; c.firePressed = c.firePressed || (this.btnV(7) > 0.35 && !this._triggerPrev);
      this._triggerPrev = this.btnV(7) > 0.35;
      c.ads = c.ads || this.btnV(6) > 0.3;
      c.reload = c.reload || this.edge(2); c.grenade = c.grenade || this.edge(5) || this.edge(4);
      c.crouch = c.crouch || this.btn(1);
      if (this.edge(3)) c.swap += 1; if (this.edge(12)) c.slot = 0; if (this.edge(15)) c.slot = 1; if (this.edge(13)) c.slot = 2; if (this.edge(14)) c.slot = 3;
      c.medkit = c.medkit || this.edge(11); c.viewToggle = c.viewToggle || this.edge(8);
      c.moveX += -applyDead(this.pad.axes[0] || 0); c.moveZ += -applyDead(this.pad.axes[1] || 0);
      c.moveX = clamp(c.moveX, -1, 1); c.moveZ = clamp(c.moveZ, -1, 1);
    }
    return c;
  }

  /** Solo mode: one human drives with WASD and aims/fires with the mouse (or LS/triggers + RS aim + RB fire on a pad). */
  solo(dt) {
    const d = this.driver(dt);
    const g = this.gunner(dt);
    g.moveX = 0; g.moveZ = 0; g.crouch = false; g.reload = this.hit('reload') && false;
    // solo bindings that would clash: R = reload (reset needs hold: use T), G = grenade
    d.reset = this.keys.has('KeyT') || (this.pad && this.btn(3));
    g.reload = this.pressed.has('KeyR') || (this.pad && this.edge(2));
    if (this.pad) { g.fire = this.mouse.left || this.btn(5) || this.btnV(7) > 0.35 && false; g.ads = this.mouse.right || this.btnV(6) > 0.3 && false; d.throttle = Math.max(this.down('throttle') ? 1 : 0, this.btnV(7)); d.brake = Math.max(this.down('brake') ? 1 : 0, this.btnV(6)); d.nitro = this.down('nitro') || this.btn(4); g.grenade = this.hit('grenade') || this.edge(1); }
    return { driver: d, gunner: g };
  }

  /** Clear per-frame accumulators (call at the end of every frame). */
  endFrame() { this.pressed.clear(); this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0; this.mousePressed.left = false; this.mousePressed.right = false; }
}
