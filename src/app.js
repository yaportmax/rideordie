// App: screen flow. TITLE -> (SOLO | HOST/JOIN -> LOBBY) -> GARAGE -> RUN -> RESULTS -> GARAGE ...
// In co-op the host owns the save (profile) and the shop; the driver's machine runs the simulation.
import { Ui } from './ui/ui.js';
import { Session } from './net/session.js';
import { loadProfile, saveProfile, buyTruck, buyUpgrade, buyWeapon, buyWeaponTrack, equipWeapon, selectTruck, creditRun } from './meta/profile.js';
import { TRUCK_COLORS } from './data/upgrades.js';

const APP_MSGS = new Set(['toGarage', 'garageReady', 'backToLobby', 'abort']);

export class App {
  constructor(game) {
    this.game = game; this.input = game.input;
    const root = document.createElement('div'); root.id = 'ui'; root.style.cssText = 'position:fixed;inset:0;z-index:10;pointer-events:none';
    document.body.appendChild(root);
    this.ui = new Ui(root, { input: this.input, sound: (n) => this.sound(n), onSettingsChange: (s, k) => this.applySettings(s, k) });
    root.style.pointerEvents = '';
    this.profile = loadProfile();
    this.session = null; this.mode = 'title'; // title | solo | coop
    this.readyMine = false; this.readyOther = false;
    this.applySettings(this.ui.settings);
    window.__app = this;
    // Esc while the mouse is captured is swallowed by the browser (it just releases the lock): treat losing the lock mid-run as "pause"
    document.addEventListener('pointerlockchange', () => {
      const g = this.game;
      if (!document.pointerLockElement && g.mode === 'run' && g.run && !g.run.over && !g.paused && !this._releasing && this.input.lastDevice !== 'pad') this._pause();
      this._releasing = false;
    });
  }

  sound(name) { this.game.audio?.ui(name); }
  applySettings(s) {
    if (s.quality !== undefined && s.quality !== this.game.quality) this.game.setQuality(s.quality);
    if (s.resScale !== undefined) this.game.post?.setResolutionScale?.(s.resScale);
    this.game.audio?.setVolumes?.({ master: s.master, sfx: s.sfx, music: s.music });
    this.shake = s.shake ?? 1;
  }

  // ------------------------------------------------------------------------------------------ title
  title() {
    this.mode = 'title'; this.game.mode = 'menu'; this.game.endRun();
    if (this.session) { this.session.leave(); this.session = null; }
    this.game.audio?.music?.setState?.('title');
    this.ui.showTitle({
      onSolo: () => { this.mode = 'solo'; this.garage(); },
      onHost: () => this.host(),
      onJoin: (code) => this.join(code),
    });
  }

  // ------------------------------------------------------------------------------------------ lobby
  _newSession() {
    const s = this.session = new Session();
    s.me.name = this.ui.settings.name || (s.isHost ? 'Host' : 'Player');
    s.on({
      lobby: () => this._lobbyRefresh(),
      profile: (p) => { this.profile = p; if (this.game.mode === 'garage') this._garageRefresh(); },
      buyDenied: () => { this.ui.toast('NOT ENOUGH CASH', 'bad'); this.sound('error'); },
      start: (cfg) => this._startRun(cfg),
      run: (m) => this._onRunMsg(m),
      fast: (b) => this.game.run && this.game.run.onFast(b),
      disconnect: () => this._lost(),
      error: (e) => console.warn('net', e),
    });
    return s;
  }
  async host() {
    this.mode = 'coop';
    const s = this._newSession(); s.me.name = 'Host';
    this.ui.showLobby(this._lobbyState('connecting'), this._lobbyCb());
    try { await s.host(this.profile); } catch (e) { this.ui.toast('Could not create room: ' + (e.message || e.type), 'bad'); return this.title(); }
    s.setRole('driver');
    this._lobbyRefresh();
  }
  async join(code) {
    this.mode = 'coop';
    const s = this._newSession(); s.me.name = 'Player 2';
    this.ui.showLobby({ ...this._lobbyState('connecting'), code }, this._lobbyCb());
    try { await s.join(code, this.profile); } catch (e) { this.ui.toast(e.message || 'Could not join', 'bad'); return this.title(); }
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
  _lobbyRefresh() { if (this.game.mode !== 'garage' && this.mode === 'coop' && !this.game.run) this.ui.updateLobby(this._lobbyState()); }
  _lobbyCb() {
    return {
      onSeat: (role) => this.session?.setRole(role),
      onReady: (r) => this.session?.setReady(r),
      onStart: () => { const s = this.session; if (!s?.canStart()) return; s.sendJSON({ t: 'toGarage' }); s.broadcastProfile(); this.garage(); },
      onLeave: () => this.title(),
      onCopy: () => { try { navigator.clipboard.writeText(this.session?.code || ''); this.ui.toast('ROOM CODE COPIED', 'good'); } catch { /* */ } },
    };
  }
  _lost() { if (this.mode !== 'coop') return; this.game.endRun(); this.ui.connectionLost('Your partner disconnected.').then(() => this.title()); }

  _onRunMsg(m) {
    if (!APP_MSGS.has(m.t)) { this.game.run?.onNet(m); return; }
    if (m.t === 'toGarage') { this.garage(); }
    else if (m.t === 'garageReady') { this.readyOther = !!m.ready; this._garageRefresh(); this._maybeStart(); }
    else if (m.t === 'abort') { this.game.endRun(); this.garage(); this.ui.toast('Run abandoned', 'warn'); }
  }

  // ------------------------------------------------------------------------------------------ garage
  garage() {
    this.game.endRun();
    this.readyMine = false; this.readyOther = false;
    this.game.showGarage(this.profile.truck, TRUCK_COLORS[this.profile.truckColor] ?? TRUCK_COLORS[0], this._garageLoadout());
    this.game.audio?.music?.setState?.('garage');
    this.ui.showGarage(this.profile, this._garageCb(), this._garageExtra());
  }
  _garageLoadout() { return { weapon: this.profile.loadout[0] || 'pistol', armorTier: this.profile.upgrades.vest || 0 }; }
  _garageExtra() {
    const s = this.session;
    return { solo: this.mode === 'solo', ready: this.readyMine, isHost: !s || s.isHost, runNo: this.profile.runs + 1,
      partner: s ? { name: s.other?.name || 'Partner', ready: this.readyOther, connected: s.connected, role: s.other?.role } : undefined };
  }
  _garageRefresh() {
    if (this.game.mode !== 'garage') return;
    this.game.garage.setTruck(this.profile.truck, TRUCK_COLORS[this.profile.truckColor] ?? TRUCK_COLORS[0], this._garageLoadout());
    this.ui.updateGarage(this.profile, this._garageExtra());
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
      else if (kind === 'color') { p.truckColor = id; r = { ok: true }; }
      if (r && r.ok) { saveProfile(p); this.session?.broadcastProfile(); if (/truck|upgrade|weapon/.test(kind)) this.sound('buy'); }
      else if (r && r.reason === 'cash') { this.ui.toast('NOT ENOUGH CASH', 'bad'); this.sound('error'); }
      this._garageRefresh();
    };
    return {
      onBuy: (kind, id, track) => act(kind, id, track),
      onSelectTruck: (id) => act('select', id),
      onPaint: (i) => act('color', i),
      onEquip: (w, slot) => act('equip', w, slot),
      onReady: () => {
        if (this.mode === 'solo') return this._startRun({ role: 'solo', seed: (Math.random() * 1e9) | 0, profile: this.profile });
        this.readyMine = !this.readyMine;
        this.session.sendJSON({ t: 'garageReady', ready: this.readyMine });
        this._garageRefresh(); this._maybeStart();
      },
      onMenu: () => this.title(),
    };
  }
  _maybeStart() {
    const s = this.session;
    if (!s || !s.isHost || !this.readyMine || !this.readyOther) return;
    s.me.ready = s.other.ready = true;
    const cfg = s.startRun({ seed: (Math.random() * 1e9) | 0 });
    this._startRun(cfg);
  }

  // ------------------------------------------------------------------------------------------ run
  async _startRun(cfg) {
    this.ui.hideAll();
    this.readyMine = this.readyOther = false;
    if (cfg.profile) this.profile = cfg.profile;
    const run = await this.game.startRun({ ...cfg, net: this.mode === 'coop' ? this.session : null, paint: TRUCK_COLORS[this.profile.truckColor] ?? TRUCK_COLORS[0] });
    this.game.audio?.music?.setState?.('run');
    window.__run = run;
    this.game.onRunEnd = (r) => this._results(r);
    this.game.onPause = () => this._pause();
    this.input.requestLock();
  }
  _pause() {
    const g = this.game;
    if (g.paused) return;
    g.paused = true; this._releasing = true; this.input.releaseLock();
    this.ui.showPause({
      onResume: () => { g.paused = false; this.ui.hideAll(); this.input.requestLock(); },
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
    const sm = run.summary || run.remoteSummary;
    this.game.paused = false; this.input.releaseLock();
    if (!sm) { this.garage(); return; }
    const owner = !this.session || this.session.isHost;
    const before = { ...this.profile.best };
    if (owner) { creditRun(this.profile, sm); saveProfile(this.profile); this.session?.broadcastProfile(); }
    const newBest = { distance: sm.distance > before.distance, time: sm.time > before.time, kills: sm.kills > before.kills };
    this.game.audio?.music?.setState?.(sm.won ? 'victory' : 'garage');
    this.ui.showResults({ ...sm, newBest }, this.profile, { onContinue: () => this.garage(), onTick: () => this.sound('coin') });
  }
}
