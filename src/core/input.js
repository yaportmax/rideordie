// Unified input: keyboard + mouse (pointer lock) + Gamepad API (full controller support for driver AND gunner).
// Produces role-specific command structs each frame. Rebindable via `bindings`.
import { clamp, damp } from './util.js';

const DEADZONE = 0.14;
const PAD_ACTIVE_DEADZONES = [0.1, DEADZONE, 0.12, 0.12];
const applyDead = (v, dz = DEADZONE) => { const a = Math.abs(v); if (a < dz) return 0; return Math.sign(v) * (a - dz) / (1 - dz); };
const curve = (v, p = 1.6) => Math.sign(v) * Math.pow(Math.abs(v), p);
const editing = (e) => (e.composedPath?.() || [e.target]).some((t) => t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName || ''));

export const DEFAULT_BINDINGS = {
  // driver
  throttle: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'], nitro: ['ShiftLeft', 'ShiftRight'], reset: ['KeyR'], camera: ['KeyC'], lookBack: ['KeyB'], horn: ['KeyH'], special1: ['KeyQ'], special2: ['KeyE'], medkit: ['KeyX'],
  // gunner
  reload: ['KeyR'], grenade: ['KeyG'], slot1: ['Digit1'], slot2: ['Digit2'], slot3: ['Digit3'], slot4: ['Digit4'], slot5: ['Digit5'], slot6: ['Digit6'],
  lean: ['KeyQ'], view: ['KeyV'],
  pause: ['Escape'],
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set(); this.pressed = new Set(); // pressed = edge this frame
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0; this._mouseMovedThisFrame = false;
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
      if (e.repeat || editing(e)) return;
      if (this.locked && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code); this.pressed.add(e.code); this.lastDevice = 'kbm';
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.reset());
    canvas.addEventListener('mousedown', (e) => {
      this.lastDevice = 'kbm';
      if (e.button === 0) { this.mouse.left = true; this.mousePressed.left = true; } if (e.button === 2) { this.mouse.right = true; this.mousePressed.right = true; }
      if (e.button === 1) this.mouse.middle = true;
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.left = false; if (e.button === 2) this.mouse.right = false; if (e.button === 1) this.mouse.middle = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      if (!Number.isFinite(e.movementX) || !Number.isFinite(e.movementY)) return;
      this.mouseDX += e.movementX; this.mouseDY += e.movementY;
      // A mouse turn must leave controller-only target snapping behind, even
      // when the player switches devices without clicking or pressing a key.
      if (e.movementX || e.movementY) { this._mouseMovedThisFrame = true; this.lastDevice = 'kbm'; }
    });
    addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; if (!this.locked) this.reset(); });
    addEventListener('gamepadconnected', (e) => { this.padConnected = true; this.padName = e.gamepad.id; });
    addEventListener('gamepaddisconnected', (e) => { if (!this.pad || this.pad.index === e.gamepad.index) this._clearPad(); });
  }

  /** Clear held buttons as well as frame edges when focus, capture, or a run changes. */
  reset() {
    this.keys.clear(); this.endFrame();
    this.mouse.left = this.mouse.right = this.mouse.middle = false;
    this.steerSmooth = 0; this.mlook = null; this._triggerPrev = false;
    this.padEdge.fill(false);
  }
  _clearPad() {
    this.pad = null; this.padConnected = false; this.padName = '';
    this.padPrev.fill(false); this.padEdge.fill(false); this._triggerPrev = false;
  }

  requestLock() { if (!this.locked) { try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } } }
  releaseLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  down(action) { return (this.bindings[action] || []).some((c) => this.keys.has(c)); }
  hit(action) { return (this.bindings[action] || []).some((c) => this.pressed.has(c)); }

  _mouseAimActive() { return !!this.locked && !!(this._mouseMovedThisFrame || this.mouseDX || this.mouseDY); }

  /** Poll the gamepad; call once per frame before reading commands. */
  poll() {
    const mouseAimActive = this._mouseAimActive();
    if (mouseAimActive) this.lastDevice = 'kbm';
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    if (!pad) { this._clearPad(); return; }
    if (this.pad && this.pad.index !== pad.index) this._clearPad();
    this.pad = pad;
    if (pad) {
      this.padConnected = true; this.padName = pad.id;
      for (let i = 0; i < 20; i++) {
        const d = !!(pad.buttons[i]?.pressed || pad.buttons[i]?.value > 0.5);
        this.padEdge[i] = d && !this.padPrev[i]; this.padPrev[i] = d;
      }
      // Device prompts and aim assist must follow usable analog input, not only fully pressed triggers.
      // Ignore unused axes and stick drift inside the same deadzones as the command readers.
      const act = pad.buttons.some((b, i) => b.pressed || b.value > (i === 6 ? 0.3 : i === 7 ? 0.35 : 0.5))
        || PAD_ACTIVE_DEADZONES.some((dz, i) => Math.abs(pad.axes[i] || 0) > dz);
      if (act && !mouseAimActive) this.lastDevice = 'pad';
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
  driver(dt, dpadSteer = true) {
    const c = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, reset: false, cameraToggle: false, horn: false, special1: false, special2: false, medkit: this.hit('medkit'), lookX: 0, lookY: 0, lookBack: this.down('lookBack'), mouseYaw: 0, mousePitch: 0 };
    // mouse free-look (pointer locked): drifts back to straight ahead when the mouse rests
    const ml = this.mlook || (this.mlook = { yaw: 0, pitch: 0, idle: 0 });
    if (this.locked && (this.mouseDX || this.mouseDY)) {
      ml.yaw = clamp(ml.yaw - this.mouseDX * this.sens.mouse, -2.3, 2.3); ml.pitch = clamp(ml.pitch - this.mouseDY * this.sens.mouse * (this.invertY ? -1 : 1), -0.55, 0.45); ml.idle = 0;
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
      if (dpadSteer && (dpadL || dpadR)) steer = (dpadL ? 1 : 0) - (dpadR ? 1 : 0);
      if (Math.abs(steer) > Math.abs(c.steer)) c.steer = steer;
      c.throttle = Math.max(c.throttle, this.btnV(7)); c.brake = Math.max(c.brake, this.btnV(6));
      c.handbrake = c.handbrake || this.btn(0); c.nitro = c.nitro || this.btn(5); c.reset = c.reset || this.btn(3);
      c.special1 = c.special1 || this.edge(2); c.special2 = c.special2 || this.edge(1);
      c.cameraToggle = c.cameraToggle || this.edge(11); c.lookBack = c.lookBack || this.btn(4); c.medkit = c.medkit || this.edge(13);
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
    c.reload = this.hit('reload'); c.grenade = this.hit('grenade'); c.viewToggle = this.hit('view');
    c.swap = -this.wheel; // wheel up => next
    for (let i = 1; i <= 6; i++) if (this.hit('slot' + i)) c.slot = i - 1;
    c.lean = this.down('lean') ? 1 : 0;
    if (this.pad) {
      // Keep controller buttons available, but never mix its right-stick aim
      // into the same frame as captured mouse movement (including net-zero
      // movement). Polling an active pad must not re-enable mouse aim assist.
      if (!this._mouseAimActive()) {
        const ax = applyDead(this.pad.axes[2] || 0, 0.12), ay = applyDead(this.pad.axes[3] || 0, 0.12);
        const s = adsActive ? this.sens.padAdsMul : 1;
        c.dYaw += -curve(ax, 1.7) * this.sens.padYaw * dt * s; c.dPitch += -curve(ay, 1.7) * this.sens.padPitch * dt * s * (this.invertY ? -1 : 1);
      }
      c.fire = c.fire || this.btnV(7) > 0.35; c.firePressed = c.firePressed || (this.btnV(7) > 0.35 && !this._triggerPrev);
      this._triggerPrev = this.btnV(7) > 0.35;
      c.ads = c.ads || this.btnV(6) > 0.3;
      c.reload = c.reload || this.edge(2); c.grenade = c.grenade || this.edge(5) || this.edge(4);
      if (this.edge(3)) c.swap += 1; if (this.edge(12)) c.slot = 0; if (this.edge(15)) c.slot = 1; if (this.edge(13)) c.slot = 2; if (this.edge(14)) c.slot = 3;
      c.medkit = c.medkit || this.edge(11); c.viewToggle = c.viewToggle || this.edge(8);
    }
    return c;
  }

  /** Solo mode: one human drives with WASD and aims/fires with the mouse (or LS/triggers + RS aim + RB fire on a pad). */
  solo(dt) {
    const d = this.driver(dt, false); // Solo D-pad left/right are gadgets; steering stays on the stick/keyboard.
    const g = this.gunner(dt);
    g.moveX = 0; g.moveZ = 0; g.crouch = false;
    // solo bindings that would clash: R = reload (reset needs hold: use T), G = grenade
    d.reset = this.keys.has('KeyT') || (this.pad && this.btn(3));
    g.reload = this.hit('reload') || this.edge(2);
    if (this.pad) {
      // Solo separates the shared seat buttons: driving triggers, RB fire, LB boost, X reload, B grenade, Y flip.
      g.fire = this.mouse.left || this.btn(5); g.firePressed = this.mousePressed.left || this.edge(5); g.ads = this.mouse.right;
      d.nitro = this.down('nitro') || this.btn(4); g.grenade = this.hit('grenade') || this.edge(1);
      d.special1 = this.hit('special1') || this.edge(14); d.special2 = this.hit('special2') || this.edge(15);
      g.swap = -this.wheel + (this.edge(11) ? 1 : 0); g.slot = -1;
      for (let i = 1; i <= 6; i++) if (this.hit('slot' + i)) g.slot = i - 1;
      g.medkit = this.hit('medkit') || this.edge(13);
    }
    return { driver: d, gunner: g };
  }

  /** Clear per-frame accumulators (call at the end of every frame). */
  endFrame() { this.pressed.clear(); this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0; this._mouseMovedThisFrame = false; this.mousePressed.left = false; this.mousePressed.right = false; }
}
