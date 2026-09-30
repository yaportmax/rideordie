// App: screen flow. TITLE -> (SOLO | HOST/JOIN -> LOBBY) -> GARAGE -> RUN -> RESULTS -> GARAGE ...
// In co-op the host owns the save (profile) and the shop; the driver's machine runs the simulation.
import { Ui } from './ui/ui.js';
import { Session } from './net/session.js';
import { loadProfile, saveProfile, buyTruck, buyUpgrade, buyWeapon, buyWeaponTrack, equipWeapon, selectTruck, creditRun } from './meta/profile.js';

import { TRUCK_COLORS, UPGRADE_BY_ID } from './data/upgrades.js';
const DAM_CHECKPOINT_S = 52500, DAM_CHECKPOINT_UNLOCK = 59000; // start past the last warlord's window (city ~49.5 km + 2.5 km)

const APP_MSGS = new Set(['toGarage', 'garageReady', 'backToLobby', 'abort']);

export class App {
  constructor(game) {
    this.game = game; this.input = game.input;
    const root = document.createElement('div'); root.id = 'ui'; root.style.cssText = 'position:fixed;inset:0;z-index:10;pointer-events:none';
    document.body.appendChild(root);
    // the menus float over live 3D (title chase / garage / the run's death camera): no painted backdrop
    this.ui = new Ui(root, { input: this.input, backdrop: false, sound: (n) => this.sound(n), onSettingsChange: (s, k) => this.applySettings(s, k) });
    root.style.pointerEvents = '';
    this.profile = loadProfile();
    this.personalProfile = this.profile;
    this.session = null; this.mode = 'title'; // title | solo | coop
    this.screen = 'title';                    // title | lobby | garage | run | results
    this.readyMine = false; this.readyOther = false;
    this.applySettings(this.ui.settings);
    window.__app = this;
    addEventListener('resize', () => requestAnimationFrame(() => this._frameRect()));
    this._dragSpin();
    // Esc while the mouse is captured is swallowed by the browser (it just releases the lock): treat losing the lock mid-run as "pause"
    document.addEventListener('pointerlockchange', () => {
      const g = this.game;
      if (!document.pointerLockElement && g.mode === 'run' && this.screen === 'run' && g.run && !g.run.over && !g.paused && !this._releasing && this.input.lastDevice !== 'pad') this._pause();
      this._releasing = false;
    });
    const focusLost = () => { if (this.screen === 'run' && this.game.run && !this.game.run.over) this._pause(); };
    addEventListener('blur', focusLost);
    document.addEventListener('visibilitychange', () => { if (document.hidden) focusLost(); });
  }

  sound(name) { this.game.audio?.ui(name); }
  applySettings(s) {
    if (s.quality !== undefined && s.quality !== this.game.quality) this.game.setQuality(s.quality);
    if (s.quality !== undefined) this.game.garage?.setQuality?.(s.quality);
    if (s.resScale !== undefined) this.game.post?.setResolutionScale?.(s.resScale);
    this.game.audio?.setVolumes?.({ master: s.master, sfx: s.sfx, music: s.music });
    this.game.post?.setFeatures?.({ mb: s.motionBlur !== false, ca: s.chromatic !== false, grain: s.grain !== false });
    // read live by the cameras / run: first-person FOV, shake amount, gamepad aim assist
    const g = this.game;
    g.fovBase = s.fov ?? 75; g.shakeMul = s.shake ?? 1; g.aimAssist = s.aimAssist !== false;
    this.shake = s.shake ?? 1;
  }

  // ------------------------------------------------------------------------------------------ 3D menu stages
  /** Put the 3D stage (title chase / garage) behind the menus; the garage stage always holds the current truck + loadout. */
  _stage(stage) {
    const g = this.game;
    g.endRun();
    g.showGarage(this.profile.truck, TRUCK_COLORS[this.profile.truckColor] ?? TRUCK_COLORS[0], this._garageLoadout());
    g.garage.setStage(stage);
  }
  /** The free screen area between the garage panels (the 3D camera frames the subject inside it). */
  _frameRect() { if (this.screen === 'garage') { const r = this.ui.garageFrameRect?.(); if (r) this.game.garage.setFrameRect(r); } }
  /** Drag on empty screen space in the garage spins the turntable. */
  _dragSpin() {
    let down = false, lx = 0;
    const c = this.game.canvas;
    c.addEventListener('pointerdown', (e) => { if (this.screen === 'garage' && e.button === 0) { down = true; lx = e.clientX; c.setPointerCapture?.(e.pointerId); } });
    c.addEventListener('pointermove', (e) => { if (!down) return; this.game.garage.drag(e.clientX - lx); lx = e.clientX; });
    const up = () => { down = false; };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  }

  // ------------------------------------------------------------------------------------------ title
  title() {
    this.mode = 'title'; this.screen = 'title';
    if (this.session) { const guest = !this.session.isHost; this.session.leave(); this.session = null; if (guest) this.profile = this.personalProfile; }
    this._pendingRunMsgs = []; this._pendingFast = null;
    this._stage('title');
    this.game.audio?.music?.setState?.('title');
    if (!this._booted) { this._booted = true; this._bootScreen().then(() => { if (this.screen === 'title') this._showTitle(); }); return; }
    this._showTitle();
  }
  /** First launch: keep the boot screen up until both menu stages are loaded, compiled and drawn once (then no hitches). */
  _bootScreen() {
    const boot = document.getElementById('boot');
    const ready = Promise.race([this.game.garage?.ready || Promise.resolve(), new Promise((r) => setTimeout(r, 16000))]);
    return ready.then(() => new Promise((res) => {
      if (!boot) { res(); return; }
      boot.classList.add('done');
      setTimeout(res, 250);
      setTimeout(() => boot.remove(), 800);
    }));
  }
  _showTitle() {
    this.ui.showTitle({
      onSolo: (role) => { this.soloRole = role || 'both'; this.mode = 'solo'; this.sound('whoosh_transition'); this.garage(); },
      onHost: () => this.host(),
      onJoin: (code) => this.join(code),
    });
  }

  // ------------------------------------------------------------------------------------------ lobby
  _newSession() {
    this.session?.leave();
    const s = this.session = new Session();
    s.me.name = this.ui.settings.name || (s.isHost ? 'Host' : 'Player');
    s.on({
      lobby: () => this._lobbyRefresh(),
      profile: (p) => { this.profile = p; if (this.screen === 'garage') this._garageRefresh(); },
      buyDenied: () => { this.ui.toast('NOT ENOUGH CASH', 'bad'); this.sound('error'); },
      start: (cfg) => this._startRun(cfg),
      run: (m) => this._onRunMsg(m),
      fast: (b) => { if (this.session !== s) return; if (this.game.run) this.game.run.onFast(b); else if (this.screen === 'run') this._pendingFast = b; },
      disconnect: () => this._lost(),
      error: (e) => console.warn('net', e),
    });
    return s;
  }
  async host() {
    this.mode = 'coop'; this.screen = 'lobby';
    const s = this._newSession(); s.me.name = 'Host';
    this.ui.showLobby(this._lobbyState('connecting'), this._lobbyCb());
    try { await s.host(this.profile); } catch (e) { if (this.session !== s) return; this.ui.toast('Could not create room: ' + (e.message || e.type), 'bad'); return this.title(); }
    if (this.session !== s || this.screen !== 'lobby') return;
    s.setRole('driver');
    this._lobbyRefresh();
  }
  async join(code) {
    this.mode = 'coop'; this.screen = 'lobby';
    const s = this._newSession(); s.me.name = 'Player 2';
    this.ui.showLobby({ ...this._lobbyState('connecting'), code }, this._lobbyCb());
    try { await s.join(code, this.profile); } catch (e) { if (this.session !== s) return; this.ui.toast(e.message || 'Could not join', 'bad'); return this.title(); }
    if (this.session !== s || this.screen !== 'lobby') return;
    s.setRole('gunner');
    this._lobbyRefresh();
  }
  _lobbyState(status) {
    const s = this.session, L = s ? s.lobby() : null;
    const players = [];
    if (L) {
      players.push({ id: 'me', name: L.me.name, device: this.input.lastDevice, seat: L.me.role, ready: L.me.ready, you: true, host: L.isHost });
      if (L.other) players.push({ id: 'other', name: L.other.name, device: L.other.device || 'kbm', seat: L.other.role, ready: L.other.ready, you: false, host: !L.isHost });
    }
    return { code: L?.code || '', status: status || (L?.connected ? 'connected' : 'waiting'), latency: s ? Math.round(s.rtt) : 0, isHost: !!L?.isHost, canStart: s ? s.canStart() : false, players };
  }
  _lobbyRefresh() { if (this.screen === 'lobby' && this.mode === 'coop' && !this.game.run) this.ui.updateLobby(this._lobbyState()); }
  _lobbyCb() {
    return {
      onSeat: (role) => this.session?.setRole(role),
      onReady: (r) => this.session?.setReady(r),
      onStart: () => { const s = this.session; if (!s?.canStart()) return; s.sendJSON({ t: 'toGarage' }); s.broadcastProfile(); this.garage(); },
      onLeave: () => this.title(),
    };
  }
  _lost() { if (this.mode !== 'coop') return; this.game.endRun(); this.ui.connectionLost('Your partner disconnected.').then(() => this.title()); }

  _onRunMsg(m) {
    if (!APP_MSGS.has(m.t)) {
      if (this.game.run) this.game.run.onNet(m);
      else if (this.screen === 'run') { const q = this._pendingRunMsgs || (this._pendingRunMsgs = []); q.push(m); if (q.length > 256) q.shift(); }
      return;
    }
    if (m.t === 'toGarage' && !this.session?.isHost) { this.garage(); }
    else if (m.t === 'garageReady') { this.readyOther = !!m.ready; this._garageRefresh(); this._maybeStart(); }
    else if (m.t === 'abort') { this.game.endRun(); this.garage(); this.ui.toast('Run abandoned', 'warn'); }
  }

  // ------------------------------------------------------------------------------------------ garage
  /** @param open optional {tab, select} to open the shop on a specific item (e.g. the results screen's NEXT UP card). */
  garage(open) {
    const fromRun = !!this.game.run || this.screen === 'results';
    this.screen = 'garage';
    this.readyMine = false; this.readyOther = false;
    this._pendingRunMsgs = []; this._pendingFast = null;
    this._stage('garage');
    const G = this.game.garage;
    if (fromRun) G.fadeIn();
    G.setPreview({}); G.setTab('truck');
    this.game.audio?.music?.setState?.('garage');
    this.ui.showGarage(this.profile, this._garageCb(), { ...this._garageExtra(), ...(open || {}) });
    requestAnimationFrame(() => this._frameRect());
  }
  _garageLoadout() { return { weapon: this.profile.loadout[0] || 'pistol', armorTier: this.profile.upgrades.vest || 0 }; }
  _garageExtra() {
    const s = this.session;
    return { solo: this.mode === 'solo', ready: this.readyMine, isHost: !s || s.isHost, runNo: this.profile.runs + 1,
      partner: s ? { name: s.other?.name || 'Partner', ready: this.readyOther, connected: s.connected, role: s.other?.role } : undefined };
  }
  _garageRefresh() {
    if (this.screen !== 'garage') return;
    this.game.garage.setTruck(this.profile.truck, TRUCK_COLORS[this.profile.truckColor] ?? TRUCK_COLORS[0], this._garageLoadout());
    this.ui.updateGarage(this.profile, this._garageExtra());
  }
  /** Shop tab / hovered item -> 3D framing + live previews (truck model, paint, weapon on the bench, next armour tier). */
  _garageView(tab, sel) {
    const G = this.game.garage; if (!G) return;
    G.setTab(tab);
    const p = this.profile, pv = {};
    if (tab === 'truck' && sel) pv.truck = sel;
    if (tab === 'paint' && sel != null) pv.paint = TRUCK_COLORS[+sel];
    if (tab === 'weapons' && sel) pv.weapon = sel;
    if (tab === 'gunner' && sel === 'vest') pv.armorTier = Math.min(3, (p.upgrades.vest || 0) + 1);
    G.setPreview(pv);
  }
  _garageCb() {
    const act = (kind, id, extra) => {
      if (this.session && !this.session.isHost) { this.session.buy(kind, id, extra); return; }
      const p = this.profile; let r;
      if (kind === 'truck') r = buyTruck(p, id);
      else if (kind === 'select') r = selectTruck(p, id);
      else if (kind === 'upgrade') r = buyUpgrade(p, id);
      else if (kind === 'weapon') r = buyWeapon(p, id);
      else if (kind === 'weaponTrack' || kind === 'track') r = buyWeaponTrack(p, id, extra);
      else if (kind === 'equip') r = equipWeapon(p, id, extra);
      else if (kind === 'color' && Number.isInteger(id) && id >= 0 && id < TRUCK_COLORS.length) { p.truckColor = id; r = { ok: true }; }
      if (r && r.ok) {
        saveProfile(p); this.session?.broadcastProfile();
        if (/truck|upgrade|weapon/.test(kind)) { this.sound('buy'); this.game.garage?.celebrate(/weapon/.test(kind) ? 'weapon' : kind === 'upgrade' && UPGRADE_BY_ID[id]?.role !== 'driver' ? 'gunner' : 'truck'); }
      }
      else if (r && r.reason === 'cash') { this.ui.toast('NOT ENOUGH CASH', 'bad'); this.sound('error'); }
      this._garageRefresh();
    };
    return {
      onBuy: (kind, id, track) => act(kind, id, track),
      onSelectTruck: (id) => act('select', id),
      onPaint: (i) => act('color', i),
      onEquip: (w, slot) => act('equip', w, slot),
      onView: (tab, sel) => this._garageView(tab, sel),
      onReady: async () => {
        if (this.mode === 'solo') {
          const startS = await this._pickStart(); if (startS === null) return;
          const r = this.soloRole || 'both';
          return this._startRun({ role: r === 'both' ? 'solo' : r, ai: r === 'driver' ? 'gunner' : r === 'gunner' ? 'driver' : null, seed: (Math.random() * 1e9) | 0, profile: this.profile, startS });
        }
        this.readyMine = !this.readyMine;
        this.session.sendJSON({ t: 'garageReady', ready: this.readyMine });
        this._garageRefresh(); this._maybeStart();
      },
      onMenu: async () => {
        if (this.mode === 'coop') {
          const r = await this.ui.modal({ title: 'LEAVE THE CONVOY?', text: 'You go back to the title screen and your partner is disconnected.', kind: 'warn', buttons: [{ label: 'STAY', kind: 'primary', cancel: true }, { label: 'LEAVE', id: 'leave', kind: 'danger' }] });
          if (r !== 'leave') return;
        }
        this.title();
      },
    };
  }
  async _maybeStart() {
    const s = this.session;
    if (!s || !s.isHost || !s.connected || !s.other || !this.readyMine || !this.readyOther || !s.me.role || !s.other.role || s.me.role === s.other.role) return;
    const startS = await this._pickStart(); if (startS === null) return;
    s.me.ready = s.other.ready = true;
    const cfg = s.startRun({ seed: (Math.random() * 1e9) | 0, startS });
    if (cfg) this._startRun(cfg);
  }
  /** Once the crew has reached the Leviathan, a run can roll out from the dam road (past the warlords) for another shot at it. */
  async _pickStart() {
    const reached = (this.profile.best?.distance || 0) >= DAM_CHECKPOINT_UNLOCK;
    if (!reached) return 40;
    const r = await this.ui.modal({ title: 'ROLL OUT FROM', text: 'You have reached the Leviathan. Start at the dam road for another shot at it (distance pays from where you start), or run the whole highway.', buttons: [
      { label: 'THE DAM ROAD', id: 'dam', kind: 'primary' }, { label: 'THE START', id: 'start' }, { label: 'BACK', id: null, cancel: true }] });
    if (!r) return null;
    return r === 'dam' ? DAM_CHECKPOINT_S : 40;
  }

  // ------------------------------------------------------------------------------------------ run
  async _startRun(cfg) {
    this.ui.hideAll();
    this.screen = 'run';
    this._pendingRunMsgs = []; this._pendingFast = null;
    this.input.reset();
    this.game.garage?.release?.();
    this.readyMine = this.readyOther = false;
    if (cfg.profile) this.profile = cfg.profile;
    let run;
    try { run = await this.game.startRun({ ...cfg, net: this.mode === 'coop' ? this.session : null, paint: TRUCK_COLORS[this.profile.truckColor] ?? TRUCK_COLORS[0] }); }
    catch (e) {
      if (this.screen !== 'run') return;
      this.session?.sendJSON({ t: 'abort' }); this.garage(); this.game.fade(0);
      this.ui.toast('Could not start the run. Please try again.', 'bad'); console.warn('run startup', e); return;
    }
    if (!run || this.screen !== 'run') return;
    for (const m of this._pendingRunMsgs) run.onNet(m);
    if (this._pendingFast) run.onFast(this._pendingFast);
    this._pendingRunMsgs = []; this._pendingFast = null;
    this.session?.sendJSON({ t: 'runReady' });
    this.game.audio?.music?.setState?.('run');
    window.__run = run;
    this.game.onRunEnd = (r) => this._results(r);
    this.game.onPause = () => this._pause();
    this.input.requestLock();
    this._watchEnd(run);
  }
  /**
   * Results come ~2.5 s after the crash in solo (summary taken while the wreck burns) and ~3.5 s in co-op (as soon as the host's
   * summary exists), not after the run's own extra hold. A victory lets the Leviathan finale play first. The run keeps rendering
   * (death / finale camera) behind the results.
   */
  _watchEnd(run) {
    const tick = () => {
      if (this.game.run !== run) return;
      const sim = run.sim;
      if (this.screen === 'results') {
        // victory: hold the finale camera's last good frame (it cuts back to the cockpit at the end); paused = frozen + DOF behind the results
        if (sim && !run.net && sim.won && (run.finaleT || 0) > 8.4) { this.game.paused = true; return; }
        requestAnimationFrame(tick); return;
      }
      if (this.screen !== 'run') return;
      // solo: the summary can be taken while the wreck is still burning (co-op waits for the host's summary message)
      const early = !run.net && sim && !sim.won && sim.state === 'dying' && (sim.stateT || 0) >= 2.3;
      if (early && !run.summary) run.summary = run.buildSummary(false);
      const sm = run.summary || run.remoteSummary;
      if ((run.over || early) && sm && !(sm.won && (run.overT || 0) < 4.5) && this.game.onRunEnd) { const cb = this.game.onRunEnd; this.game.onRunEnd = null; cb(run); }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  _pause() {
    const g = this.game;
    if (g.paused) return;
    g.paused = true; this._releasing = true; this.input.releaseLock(); this.input.reset();
    this.ui.showPause({
      coop: this.mode === 'coop',
      onResume: () => { g.paused = false; this.input.reset(); this.ui.hideAll(); this.input.requestLock(); },
      onQuit: () => {
        g.paused = false;
        if (this.mode === 'coop') this.session?.sendJSON({ t: 'abort' });
        // abandoning a run still pays what was earned so far (solo)
        const r = g.run; if (r && r.sim && this.mode === 'solo') { const sm = r.buildSummary(); creditRun(this.profile, sm); saveProfile(this.profile); }
        this.garage();
      },
    });
  }
  _results(run) {
    if (this.screen === 'results') return;
    const sm = run.summary || run.remoteSummary;
    this.game.paused = false; this._releasing = true; this.input.releaseLock();
    if (!sm) { this.garage(); return; }
    this.screen = 'results';
    this.game.hud?.setVisible(false);
    const owner = !this.session || this.session.isHost;
    const before = { ...this.profile.best };
    const cashBefore = this.profile.cash;
    if (owner) { creditRun(this.profile, sm); saveProfile(this.profile); this.session?.broadcastProfile(); }
    const newBest = { distance: sm.distance > (before.distance || 0), time: sm.time > (before.time || 0), kills: sm.kills > (before.kills || 0) };
    this.game.audio?.music?.setState?.(sm.won ? 'victory' : 'garage');
    this.sound('whoosh_transition');
    this.ui.showResults({ ...sm, newBest, bestBefore: before, cashBefore }, this.profile, {
      onContinue: () => (sm.won ? this._victoryModal() : this.garage()), onTick: () => this.sound('coin'),
      onShop: (tab, id) => this.garage({ tab, select: id }),
    });
  }
  async _victoryModal() {
    const p = this.profile;
    await this.ui.modal({ title: 'THE ROAD IS YOURS', text: `The Leviathan is scrap and the Warlord's convoy is broken. ${p.runs} runs, $${p.totalCash.toLocaleString()} earned. The highway still has raiders on it... keep riding for the high score, or start a new campaign from the title screen.`, buttons: [{ label: 'BACK TO THE GARAGE', kind: 'primary' }] });
    this.garage();
  }
}
