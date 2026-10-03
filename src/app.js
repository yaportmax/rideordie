// App: screen flow. TITLE -> (SOLO | HOST/JOIN -> LOBBY) -> GARAGE -> RUN -> RESULTS -> GARAGE ...
// In co-op the host owns the shared campaign/shop and each person keeps their own cash.
// The driver's machine runs the simulation.
import { Ui } from './ui/ui.js';
import { Session } from './net/session.js';
import { normalizeRoomCode } from './net/invite.js';
import { loadProfile, saveProfile, getSaveStore, getSaveStorage, buyTruck, buyUpgrade, buyWeapon, buyWeaponTrack, buyWeaponOptic, equipWeaponOptic, equipWeapon, selectTruck, creditRun, bestForJourney } from './meta/profile.js';
import { CloudSaves } from './meta/cloud_saves.js';
import { equippedWeaponOptics, sanitizeOpticId } from './data/weapon_optics.js';
import { campaignJourney, normalizeJourney, selectCampaignLevel, creditCampaignLevel } from './data/campaign.js';

import { TRUCK_COLORS, UPGRADE_BY_ID, effectiveUpgrades, upgradeLevel, upgradeLimit } from './data/upgrades.js';
import { normalizeUnits } from './ui/units.js';
import { canCaptureRun, isDefeated, victoryPresenting } from './game/run_status.js';
const DAM_CHECKPOINT_S = 52500, DAM_CHECKPOINT_UNLOCK = 59000; // start past the last warlord's window (city ~49.5 km + 2.5 km)

const APP_MSGS = new Set(['toGarage', 'garageReady', 'backToLobby', 'abort']);
const PENDING_LATEST_MSGS = new Set(['g', 'input', 'runReady', 'go', 'summary']);
const PENDING_SIGNALS = new Set(['runReady', 'go', 'summary']);

export class App {
  constructor(game) {
    this.game = game; this.input = game.input;
    const root = document.createElement('div'); root.id = 'ui'; root.style.cssText = 'position:fixed;inset:0;z-index:10;pointer-events:none';
    document.body.appendChild(root);
    // the menus float over live 3D (title chase / garage / the run's death camera): no painted backdrop
    this.ui = new Ui(root, { input: this.input, backdrop: false, sound: (n) => this.sound(n), onSettingsChange: (s, k) => this.applySettings(s, k) });
    // Menu panels opt into pointer events; the transparent screen must let
    // gameplay clicks reach the canvas when pointer capture is unavailable.
    this.profile = loadProfile();
    this.personalProfile = this.profile;
    this.session = null; this.mode = 'title'; // title | solo | coop
    this.screen = 'title';                    // title | lobby | garage | run | results
    this.readyMine = false; this.readyOther = false;
    this._flowId = 0; this._garageGeneration = 0; this._garageEpoch = 0;
    this._peerGarageReady = null; this._startSelection = null; this._startup = null; this._lostTransition = null; this._roomPending = null;
    this.saves = getSaveStore();
    this._saveVisit = null; this._saveBusy = false; this._saveHistory = null;
    this.cloudSaves = new CloudSaves({
      store: this.saves, storage: getSaveStorage(),
      canApplyRemote: () => this._canChangeSave(),
      onChange: () => this._refreshSavePresentation(),
    });
    this._saveUnsubscribe = this.saves.onChange(event => {
      if (event?.error && this._lastSaveError !== event.error.code) {
        this._lastSaveError = event.error.code || 'storage';
        this.ui.toast('Progress could not be saved locally. Open SAVES to recover or export it.', 'bad', 8000);
      }
      this._refreshSavePresentation();
    });
    addEventListener('online', () => this.cloudSaves.sync().catch(() => {}));
    addEventListener('pagehide', event => { if (!event.persisted) { this.cloudSaves.dispose(); this._saveUnsubscribe?.(); } });
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
  _transition() {
    this._campaignOpen = false;
    this._saveVisit = null; this._saveBusy = false;
    this._flowId = (this._flowId || 0) + 1;
    this._cancelStartSelection(); this._startup = this._lostTransition = null;
    return this._flowId;
  }
  _cancelStartSelection() { const selection = this._startSelection; this._startSelection = null; selection?.choice?.close(); }
  _sessionEpoch(s = this.session) { return s?.runSeq ?? (s?.isHost ? s._runSeq : s?._receivedRunSeq) ?? 0; }
  applySettings(s) {
    if (s.quality !== undefined && s.quality !== this.game.quality) this.game.setQuality(s.quality);
    if (s.quality !== undefined) this.game.garage?.setQuality?.(s.quality);
    if (s.resScale !== undefined) this.game.post?.setResolutionScale?.(s.resScale);
    if (this.game.post) this.game.post.autoResolution = s.autoResolution !== false;
    this.game.audio?.setVolumes?.({ master: s.master, sfx: s.sfx, music: s.music });
    this.game.post?.setFeatures?.({ mb: s.motionBlur !== false, ca: s.chromatic !== false, grain: s.grain !== false });
    // read live by the cameras / run: first-person FOV, shake amount, gamepad aim assist
    const g = this.game;
    g.fovBase = s.fov ?? 80; g.driverFovBase = s.driverFov ?? 85;
    g.units = normalizeUnits(s.units); g.hud?.setUnits?.(g.units); g.run?.cockpit?.setUnits?.(g.units);
    g.shakeMul = s.shake ?? 1; g.aimAssist = s.aimAssist !== false;
    this.shake = s.shake ?? 1;
  }

  // ------------------------------------------------------------------------------------------ 3D menu stages
  /** Put the 3D stage (title chase / garage) behind the menus; the garage stage always holds the current truck + loadout. */
  _stage(stage) {
    const g = this.game;
    g.endRun();
    g.fade(0, 0);
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
    const flow = this._transition(); this.ui.hideAll();
    this.mode = 'title'; this.screen = 'title';
    this._roomPending = null; this._peerGarageReady = null; this.readyMine = this.readyOther = false;
    this._pendingResults = null;
    if (this.session) { const guest = !this.session.isHost; this.session.leave(); this.session = null; if (guest) this.profile = this.personalProfile; }
    this._pendingRunMsgs = []; this._pendingFast = null;
    this._stage('title');
    this.game.audio?.music?.setState?.('title');
    this._resumeSaveSync();
    const show = () => {
      if (this._flowId !== flow || this.screen !== 'title' || this.mode !== 'title' || this.session || this.game.run) return false;
      this._showTitle(); return true;
    };
    if (!this._booted) {
      this._booted = true;
      this._bootReady = this._bootScreen().then(() => { this._bootReady = null; });
    }
    if (this._bootReady) return this._titleReady = this._bootReady.then(show);
    return this._titleReady = Promise.resolve(show());
  }
  /** First launch: keep the boot screen up until both menu stages are loaded, compiled and drawn once (then no hitches). */
  _bootScreen() {
    const boot = document.getElementById('boot');
    const ready = Promise.race([this.game.garage?.ready || Promise.resolve(), new Promise((r) => setTimeout(r, 16000))]);
    return ready.then(() => new Promise((res) => {
      if (!boot) { res(); return; }
      boot.classList.add('done');
      setTimeout(() => { boot.remove(); res(); }, 800);
    }));
  }
  /** Join one invitation after this disconnected title visit is visible. */
  async consumeInvite(value) {
    const code = normalizeRoomCode(value);
    if (!code || this._inviteConsumed || !this._titleReady || this.screen !== 'title' || this.mode !== 'title') return false;
    this._inviteConsumed = true;
    const flow = this._flowId, ready = await this._titleReady;
    const panel = this.ui.screen();
    if (!ready || this._flowId !== flow || this.screen !== 'title' || this.mode !== 'title' || panel?.kind !== 'title' || panel.view !== 'menu' || this.ui.modalOpen() || this.session || this.game.run ||
        this._startup || this._startSelection || this._roomPending || this._pendingResults || this._saveVisit) return false;
    return this.join(code);
  }
  _showTitle() {
    const flow = this._flowId;
    let panel;
    const current = view => this._flowId === flow && this.screen === 'title' && this.mode === 'title' && !this.session && !this.game.run &&
      (!this.ui.screen || this.ui.screen() === panel) && (!panel || panel.view === view) && !this.ui.modalOpen?.();
    panel = this.ui.showTitle({
      onSolo: (role) => { if (!current('seats')) return; this.soloRole = role || 'both'; this.mode = 'solo'; this.sound('whoosh_transition'); this.garage(); },
      onHost: () => { if (current('menu')) return this.host(); },
      onJoin: (code) => { if (current('join')) return this.join(code); },
      onSaves: () => { if (current('menu')) return this._showSaves(); },
      saveSummary: this._saveSummary(),
    }) || this.ui.screen?.();
  }

  // Save ownership changes only on the disconnected title screen. A cloud
  // response cannot move an in-flight run's purchases, reward or crew wallet.
  _canChangeSave() {
    return this.screen === 'title' && this.mode === 'title' && !this.session && !this.game.run
      && !this._startup && !this._startSelection && !this._pendingResults && !this._roomPending;
  }
  _resumeSaveSync() {
    const flow = this._flowId;
    Promise.resolve(this.cloudSaves?.sync?.()).then(state => {
      // An existing scan may have deferred a head just before we returned.
      // One extra serialized scan resumes it without a retry loop in gameplay.
      if (state?.status === 'pending' && this._flowId === flow && this._canChangeSave()) return this.cloudSaves.sync();
    }).catch(() => {});
  }
  _saveSummary() {
    if (!this.saves) return null;
    let slot;
    try { slot = this.saves.list().find(item => item.id === this.saves.activeId()); } catch { /* Storage failure must not prevent offline play. */ }
    return { name: slot?.name || 'Unsaved session', status: this.cloudSaves?.state().status || 'local', cloud: this.cloudSaves?.state().connected || false };
  }
  _saveModel() {
    let all = [], recoveries = [];
    try { all = this.saves.list({ includeDeleted: true }); } catch { /* The durability warning remains visible. */ }
    try {
      recoveries = this.saves.recoveries().map(({ id, at, name, reason, profile, raw, volatile }) => {
        let restorable = !!profile;
        if (!profile && raw && reason === 'legacy-migration') {
          try { const value = JSON.parse(raw); restorable = (value?.v === 1 || value?.v === 2) && typeof value.campaignId === 'string'; } catch { /* Damaged bytes are retained for repair. */ }
        }
        return { id, at, name, reason, profile, restorable, volatile };
      });
    } catch { /* Existing playable saves remain available if recovery metadata is damaged. */ }
    return {
      slots: all.filter(slot => !slot.deleted), deletedSlots: all.filter(slot => slot.deleted),
      activeId: this.saves.activeId(), cloud: this.cloudSaves.state(),
      status: this.saves.status?.(), canChange: this._canChangeSave(), busy: this._saveBusy,
      history: this._saveHistory, recoveries,
      notice: this._saveNotice || 'Autosaves purchases and completed or abandoned runs. Loading resumes in the garage; active combat is not saved.',
    };
  }
  _refreshSavePresentation() {
    if (!this.saves || !this.cloudSaves || this._refreshingSaves) return;
    this._refreshingSaves = true;
    try {
    if (this._canChangeSave()) {
      try {
        const appearance = p => JSON.stringify([p?.truck, p?.truckColor, p?.loadout, p?.weaponOptics, p?.upgrades, p?.vehicleUpgrades]);
        const previous = appearance(this.profile), loaded = this.saves.load();
        this.profile = loaded; this.personalProfile = loaded;
        if (previous !== appearance(loaded) && this.game.garage) this._stage('title');
      } catch { /* Existing playable profile remains owned. */ }
    }
    this.ui.updateTitleSave?.(this._saveSummary());
    if (this._saveVisit && this._canChangeSave() && this.ui.screen()?.kind === 'saves') this.ui.updateSaves?.(this._saveModel());
    } finally { this._refreshingSaves = false; }
  }
  _showSaves() {
    if (!this._canChangeSave()) return;
    this._saveVisit = { flow: this._flowId }; this._saveHistory = null; this._saveNotice = null;
    this.ui.showSaves(this._saveModel(), this._saveCallbacks());
  }
  async _saveAction(action, notice) {
    const visit = this._saveVisit;
    const current = () => this._saveVisit === visit && visit && visit.flow === this._flowId && this._canChangeSave();
    if (!current() || this._saveBusy) return;
    this._saveBusy = true; this._refreshSavePresentation();
    try {
      const result = await action();
      if (!current()) return;
      if (result?.status === 'offline' || result?.status === 'error') throw new Error(result.error || 'Cloud changes are queued. Retry when the service is available.');
      this._saveNotice = result?.status === 'conflict' ? 'Cloud connected. Choose how to keep the conflicting versions below.' : notice || null;
      this._lastSaveError = null;
      return result;
    } catch (error) {
      if (current()) {
        this._saveNotice = error?.message || 'Could not finish that save operation. Your existing saves are retained.';
        this.ui.toast(this._saveNotice, 'bad', 6000);
      }
    } finally {
      if (current()) { this._saveBusy = false; this._refreshSavePresentation(); }
    }
  }
  _activateSave(id) {
    if (!this._canChangeSave()) throw new Error('Return to the title and leave co-op before changing saves.');
    this.profile = this.saves.activate(id); this.personalProfile = this.profile;
    this._saveHistory = null; this._stage('title');
  }
  _saveCallbacks() {
    const visit = this._saveVisit;
    return {
      onActivate: id => this._saveAction(() => this._activateSave(id), 'Save selected.'),
      onCreate: name => this._saveAction(() => { const slot = this.saves.create(name); this._activateSave(slot.id); return slot; }, 'New save selected.'),
      onRename: (id, name) => this._saveAction(() => this.saves.rename(id, name), 'Save renamed.'),
      onDuplicate: (id, name) => this._saveAction(() => this.saves.duplicate(id, name), 'Copy created. Your original is unchanged.'),
      onDelete: id => this._saveAction(() => this.saves.remove(id), 'Moved to deleted saves. The latest twelve deleted saves can be recovered.'),
      onRestoreDeleted: id => this._saveAction(() => this.saves.restoreDeleted(id), 'Deleted save recovered.'),
      onRestoreRecovery: (id, name) => this._saveAction(() => this.saves.restoreRecovery(id, name), 'Recovered as a separate save. Select it when you are ready.'),
      onExportRecovery: id => this._saveAction(() => {
        const entry = this.saves.recoveries().find(row => row.id === id);
        if (!entry?.profile) throw new Error('This damaged record needs manual repair before it can be exported as a playable save.');
        return this._downloadSave({ kind: 'rideordie-save', version: 2, name: entry.name || 'Recovered progress', profile: entry.profile, exportedAt: Date.now() });
      }, 'Preserved progress exported. Keep the file until storage is available.'),
      onHistory: id => this._saveAction(() => { this._saveHistory = { slotId: id, items: this.saves.history(id), source: 'local' }; }),
      onRestore: (id, backupId) => this._saveAction(() => { const slot = this.saves.restore(id, backupId); if (id === this.saves.activeId()) this._activateSave(id); return slot; }, 'Backup restored. The previous head is retained as a backup.'),
      onExport: id => this._saveAction(() => this._exportSave(id), 'Save exported.'),
      onImport: file => this._saveAction(async () => {
        if (!file || file.size > 65536) throw new Error('Choose a Ride or Die save file smaller than 64 KB.');
        const text = await file.text();
        if (!this._canChangeSave() || this._saveVisit !== visit) return;
        return this.saves.importSlot(JSON.parse(text));
      }, 'Imported as a separate save. Select it when you are ready.'),
      onCloudCreate: () => this._saveAction(() => this.cloudSaves.createVault(), 'Cloud connected. Keep your recovery code to connect another device.'),
      onCloudConnect: code => this._saveAction(() => this.cloudSaves.connect(code), 'Cloud connected. Your local saves are retained.'),
      onCloudDisconnect: () => this._saveAction(() => this.cloudSaves.disconnect(), 'Cloud disconnected. Local saves are retained.'),
      onSync: () => this._saveAction(() => this.cloudSaves.sync(), 'Sync checked. Review the cloud status and any conflicts below.'),
      onRevealCode: () => this._canChangeSave() && this._saveVisit ? this.cloudSaves.recoveryCode() : null,
      onCopyCode: () => this._saveAction(async () => {
        const code = this.cloudSaves.recoveryCode(); if (!code) throw new Error('Connect cloud saves first.');
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard is unavailable. Reveal and copy your code manually.');
        await navigator.clipboard.writeText(code);
      }, 'Recovery code copied. Keep it private.'),
      onResolve: (id, choice) => this._saveAction(() => this.cloudSaves.resolve(id, choice), 'Conflict resolved; preserved copies are available in saves and backups.'),
      onCloudHistory: id => this._saveAction(async () => {
        const visit = this._saveVisit, items = await this.cloudSaves.history(id);
        if (this._saveVisit === visit && this._canChangeSave()) this._saveHistory = { slotId: id, items, source: 'cloud' };
      }),
      onCloudRestore: (id, backupId) => this._saveAction(() => this.cloudSaves.restoreCloud(id, backupId), 'Cloud backup restored. The previous version is retained.'),
      onClose: () => { this._saveVisit = null; this._saveBusy = false; this._saveHistory = null; this.ui.close(); this._showTitle(); },
    };
  }
  _exportSave(id) {
    const data = this.saves.exportSlot(id);
    return this._downloadSave(data);
  }
  _downloadSave(data) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url;
    anchor.download = `ride-or-die-${data.name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40) || 'save'}.json`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { exported: true };
  }

  // ------------------------------------------------------------------------------------------ lobby
  _newSession() {
    this.session?.leave();
    this._transition(); this.ui.hideAll?.();
    this._roomPending = null; this._peerGarageReady = null; this.readyMine = this.readyOther = false;
    const s = this.session = new Session();
    s.me.name = this.ui.settings.name || (s.isHost ? 'Host' : 'Player');
    s.on({
      lobby: () => {
        if (this.session !== s) return;
        const selection = this._startSelection;
        if (selection && (s.me.role !== selection.mine || s.other?.role !== selection.other)) this._cancelStartSelection();
        this._lobbyRefresh();
      },
      state: () => { if (this.session === s) this._lobbyRefresh(); },
      garageSeats: (state, event) => {
        if (this.session !== s || this.screen !== 'garage') return;
        const selection = this._startSelection;
        if (selection && (state.epoch !== selection.seatEpoch || state.revision !== selection.seatRevision || state.intent !== selection.seatIntent)) this._cancelStartSelection();
        this.readyMine = state.ready[s.isHost ? 'host' : 'guest'];
        this.readyOther = state.ready[s.isHost ? 'guest' : 'host'];
        if (event.type === 'accepted') this.ui.toast(`You are now the ${s.me.role}. Equipment stays with its seat.`, 'info');
        this._garageRefresh(); this._maybeStart();
      },
      profile: (p) => {
        if (this.session !== s) return;
        const selection = this._startSelection;
        if (selection && (p !== selection.profile || p.revision !== selection.revision)) {
          this._cancelStartSelection(); this.readyMine = false;
          s.swap.ready(false);
          this.ui.toast('Loadout changed. Ready up again.', 'info');
        }
        this.profile = p;
        if (this.screen === 'garage') this._garageRefresh();
        const pending = this._pendingResults;
        if (pending && this.screen === 'run' && this.game.run === pending && s.hasCreditedResult((pending.summary || pending.remoteSummary)?.id)) {
          this._pendingResults = null; this._results(pending);
        }
      },
      buyDenied: () => { if (this.session !== s) return; this.ui.toast('NOT ENOUGH CASH', 'bad'); this.sound('error'); },
      start: (cfg) => { if (this.session === s) this._startRun(cfg); },
      run: (m) => { if (this.session === s) this._onRunMsg(m); },
      fast: (b) => { if (this.session !== s) return; if (this.game.run) this.game.run.onFast(b); else if (this.screen === 'run') this._pendingFast = b; },
      disconnect: () => { if (this.session === s) this._lost(s); },
      error: (e) => {
        if (this.session !== s) return;
        console.warn('net', e);
        if (this._roomPending?.session !== s || e?.type === 'protocol-mismatch') this.ui.toast(e?.message || 'Connection problem. Please try again.', 'bad');
        this._lobbyRefresh();
      },
    });
    return s;
  }
  async host() {
    this.mode = 'coop'; this.screen = 'lobby';
    const s = this._newSession(); s.me.name = 'Host';
    const flow = this._flowId;
    this._roomPending = { session: s, code: '' };
    this.ui.showLobby(this._lobbyState('connecting'), this._lobbyCb());
    try { await s.host(this.profile); } catch (e) { if (this.session !== s || this._flowId !== flow) return; this.ui.toast('Could not create room: ' + (e.message || e.type), 'bad'); return this.title(); }
    finally { if (this._roomPending?.session === s) this._roomPending = null; }
    if (this.session !== s || this._flowId !== flow || this.mode !== 'coop' || this.screen !== 'lobby') return;
    s.setRole('driver');
    this._lobbyRefresh();
  }
  async join(code) {
    code = normalizeRoomCode(code);
    if (!code) { this.ui.toast('ENTER A VALID ROOM CODE', 'warn'); return false; }
    this.mode = 'coop'; this.screen = 'lobby';
    const s = this._newSession(); s.me.name = 'Player 2';
    const flow = this._flowId;
    this._roomPending = { session: s, code };
    this.ui.showLobby(this._lobbyState('connecting'), this._lobbyCb());
    try { await s.join(code, this.profile); }
    catch (e) {
      if (this.session !== s || this._flowId !== flow) return false;
      this.ui.toast(e.message || 'Could not join. Ask your friend to create a new room.', 'bad');
      await this.title(); return false;
    }
    finally { if (this._roomPending?.session === s) this._roomPending = null; }
    if (this.session !== s || this._flowId !== flow || this.mode !== 'coop' || this.screen !== 'lobby') return false;
    s.setRole('gunner');
    this._lobbyRefresh();
    return true;
  }
  _lobbyState(status) {
    const s = this.session, L = s ? s.lobby() : null;
    const players = [];
    if (L) {
      players.push({ id: 'me', name: L.me.name, device: this.input.lastDevice, seat: L.me.role, ready: L.me.ready, you: true, host: L.isHost });
      if (L.other) players.push({ id: 'other', name: L.other.name, device: L.other.device || 'kbm', seat: L.other.role, ready: L.other.ready, you: false, host: !L.isHost });
    }
    const pending = this._roomPending?.session === s ? this._roomPending : null;
    return { code: L?.code || pending?.code || s?.tp?.code || '', status: status || s?.status || (pending ? 'connecting' : L?.connected ? 'connected' : 'waiting'), latency: s ? Math.round(s.rtt) : 0, isHost: !!L?.isHost, canStart: s ? s.canStart() : false, players };
  }
  _lobbyRefresh() { if (this.screen === 'lobby' && this.mode === 'coop' && !this.game.run) this.ui.updateLobby(this._lobbyState()); }
  _lobbyCb() {
    const session = this.session, flow = this._flowId;
    const current = () => this.session === session && !!session && this._flowId === flow && this.mode === 'coop' && this.screen === 'lobby' && !this.game.run;
    return {
      onSeat: (role) => { if (current()) session.setRole(role); },
      onReady: (r) => { if (current()) session.setReady(r); },
      onStart: () => { if (!current() || !session.canStart()) return; session.sendJSON({ t: 'toGarage' }); session.broadcastProfile(); this.garage(); },
      onLeave: () => { if (current()) return this.title(); },
    };
  }
  _lost(s = this.session) {
    if (this.mode !== 'coop' || this.session !== s || this._lostTransition) return;
    const flow = this._transition(), token = this._lostTransition = { session: s, flow };
    this.game.endRun(); this.game.fade(0, 0);
    this.ui.connectionLost('Your partner disconnected.').then((result) => {
      if (result === null || this._lostTransition !== token || this._flowId !== flow || this.session !== s || this.mode !== 'coop') return;
      this.title();
    });
  }

  _onRunMsg(m) {
    if (!APP_MSGS.has(m.t)) {
      if (this.game.run) this.game.run.onNet(m);
      else if (this.screen === 'run') {
        const q = this._pendingRunMsgs || (this._pendingRunMsgs = []);
        // Loading needs the latest controls, but a one-shot readiness signal
        // must survive a slow partner's stream of poses and effects.
        if (PENDING_LATEST_MSGS.has(m.t)) { const i = q.findIndex((v) => v.t === m.t); if (i >= 0) q.splice(i, 1); }
        q.push(m);
        if (q.length > 256) q.splice(q.findIndex((v) => !PENDING_SIGNALS.has(v.t)), 1);
      }
      return;
    }
    if (m.t === 'toGarage' && !this.session?.isHost) { this.garage(); }
    // Garage consent/readiness is consumed by Session with a visit epoch and
    // monotonic command sequence. Legacy readiness cannot bypass a seat swap.
    else if (m.t === 'garageReady') return;
    else if (m.t === 'abort') { this.game.endRun(); this.garage(); this.ui.toast('Run abandoned', 'warn'); }
  }

  // ------------------------------------------------------------------------------------------ garage
  /** @param open optional {tab, select} to open the shop on a specific item (e.g. the results screen's NEXT UP card). */
  garage(open) {
    const fromRun = !!this.game.run || this.screen === 'results';
    this._transition(); this.ui.hideAll();
    this._garageGeneration = (this._garageGeneration || 0) + 1;
    this._garageEpoch = this._sessionEpoch();
    this.screen = 'garage';
    this._pendingResults = null;
    if (this.session) this.session.activeRunId = null;
    this.readyMine = false;
    this.readyOther = false;
    this._pendingRunMsgs = []; this._pendingFast = null;
    this._stage('garage');
    const G = this.game.garage;
    if (fromRun) G.fadeIn();
    G.setPreview({}); G.setTab('truck');
    this.game.audio?.music?.setState?.('garage');
    this.ui.showGarage(this.profile, this._garageCb(), { ...this._garageExtra(), ...(open || {}) });
    this.session?.swap.enterGarage();
    requestAnimationFrame(() => this._frameRect());
  }
  _garageLoadout() { const weapon = this.profile.loadout[0] || 'pistol'; return { weapon, opticId: equippedWeaponOptics(this.profile)[weapon] || 'standard', upgradeLevels: effectiveUpgrades(this.profile) }; }
  _selectedJourney() { return this.profile.campaignProgress ? campaignJourney(this.profile) : normalizeJourney(); }
  _showCampaign() {
    if (this.screen !== 'garage') return;
    this._cancelStartSelection();
    const flow = this._flowId, session = this.session, generation = this._garageGeneration;
    const current = () => this.screen === 'garage' && this._flowId === flow && this.session === session && this._garageGeneration === generation;
    this._campaignOpen = true;
    if (session?.isHost && this.readyMine) session.swap.ready(false);
    this.ui.showCampaign(this.profile, {
      onSelect: (level, mode) => {
        if (!current() || (session && !session.isHost)) return;
        const result = session ? session.selectJourney(level, mode) : selectCampaignLevel(this.profile, level, mode);
        if (!result.ok) { this.ui.toast('That level is still locked.', 'warn'); return; }
        if (!session) saveProfile(this.profile);
        this._campaignOpen = false;
        this.ui.showGarage(this.profile, this._garageCb(), this._garageExtra());
        requestAnimationFrame(() => this._frameRect());
      },
      onBack: () => {
        if (!current()) return;
        this._campaignOpen = false;
        this.ui.showGarage(this.profile, this._garageCb(), this._garageExtra());
        requestAnimationFrame(() => this._frameRect());
      },
    }, { canSelect: !session || session.isHost });
  }
  _garageExtra() {
    const s = this.session;
    return { solo: this.mode === 'solo', ready: this.readyMine, isHost: !s || s.isHost, runNo: this.profile.runs + 1, journey: this._selectedJourney(),
      seatSwap: s ? { role: s.me.role, actor: s.isHost ? 'host' : 'guest', state: s.swap.snapshot(), available: s.swap.canRequest(), partnerName: s.other?.name || 'Partner' } : undefined,
      readyBlocked: !!s && !s.swap.canRequest(),
      partner: s ? { name: s.other?.name || 'Partner', ready: this.readyOther, connected: s.connected, role: s.other?.role } : undefined };
  }
  _garageRefresh() {
    if (this.screen !== 'garage') return;
    if (this._campaignOpen) { this.ui.updateCampaign(this.profile, { canSelect: !this.session || this.session.isHost }); return; }
    this.game.garage.setTruck(this.profile.truck, TRUCK_COLORS[this.profile.truckColor] ?? TRUCK_COLORS[0], this._garageLoadout());
    this.ui.updateGarage(this.profile, this._garageExtra());
  }
  /** Preview the selected chassis with its family's own modifications. Driver
   * upgrade previews match the next purchase. */
  _garageView(tab, sel, opticId) {
    const G = this.game.garage; if (!G) return;
    G.setTab(tab);
    const p = this.profile, pv = {};
    if (tab === 'truck' && sel) { pv.truck = sel; pv.upgradeLevels = effectiveUpgrades(p, sel); }
    if (tab === 'upgrades' && UPGRADE_BY_ID[sel]?.role === 'driver') {
      const level = upgradeLevel(p, sel), limit = upgradeLimit(p, sel);
      pv.upgradeLevels = { ...effectiveUpgrades(p), [sel]: Math.min(limit, level + 1) };
    }
    if (tab === 'paint' && sel != null) pv.paint = TRUCK_COLORS[+sel];
    if (tab === 'weapons' && sel) { pv.weapon = sel; pv.opticId = sanitizeOpticId(sel, opticId ?? equippedWeaponOptics(p)[sel]); }
    G.setPreview(pv);
  }
  _garageCb() {
    const flow = this._flowId, generation = this._garageGeneration, session = this.session;
    const current = () => this.screen === 'garage' && this._flowId === flow && this._garageGeneration === generation && this.session === session;
    const act = (kind, id, extra) => {
      if (!current()) return;
      const p = this.profile; let r;
      if (this.session) { r = this.session.buy(kind, id, extra); if (r.pending) return; }
      else if (kind === 'truck') r = buyTruck(p, id);
      else if (kind === 'select') r = selectTruck(p, id);
      else if (kind === 'upgrade') r = buyUpgrade(p, id);
      else if (kind === 'weapon') r = buyWeapon(p, id);
      else if (kind === 'weaponTrack' || kind === 'track') r = buyWeaponTrack(p, id, extra);
      else if (kind === 'weaponOptic') r = buyWeaponOptic(p, id, extra);
      else if (kind === 'equipWeaponOptic') r = equipWeaponOptic(p, id, extra);
      else if (kind === 'equip') r = equipWeapon(p, id, extra);
      else if (kind === 'color' && Number.isInteger(id) && id >= 0 && id < TRUCK_COLORS.length) { p.truckColor = id; r = { ok: true }; }
      if (r && r.ok) {
        if (!this.session) saveProfile(p);
        if (/truck|upgrade|weapon/.test(kind)) { this.sound('buy'); this.game.garage?.celebrate(/weapon/.test(kind) ? 'weapon' : kind === 'upgrade' && UPGRADE_BY_ID[id]?.role !== 'driver' ? 'gunner' : 'truck'); }
      }
      else if (r && r.reason === 'cash') { this.ui.toast('NOT ENOUGH CASH', 'bad'); this.sound('error'); }
      this._garageRefresh();
    };
    return {
      onCampaign: () => { if (current()) this._showCampaign(); },
      onBuy: (kind, id, track) => act(kind, id, track),
      onSelectTruck: (id) => act('select', id),
      onPaint: (i) => act('color', i),
      onEquip: (w, slot) => act('equip', w, slot),
      onView: (tab, sel, opticId) => { if (current()) this._garageView(tab, sel, opticId); },
      onSeatSwap: (action, id) => {
        const s = this.session;
        if (!current() || this.mode !== 'coop' || !s) return;
        this._cancelStartSelection();
        if (action === 'request') s.swap.request();
        else if (action === 'accept' || action === 'decline') s.swap.respond(id, action === 'accept');
        else if (action === 'cancel') s.swap.cancel(id);
      },
      onReady: async () => {
        if (!current()) return;
        if (this.mode === 'solo') {
          if (this._startSelection) return;
          const token = this._startSelection = { flow: this._flowId, garage: this._garageGeneration, profile: this.profile, revision: this.profile.revision };
          try {
            const startS = await this._pickStart(token);
            if (startS === null || this._startSelection !== token || this._flowId !== token.flow || this._garageGeneration !== token.garage || this.screen !== 'garage' || this.mode !== 'solo' || this.session || this.profile !== token.profile || this.profile.revision !== token.revision) return;
            const r = this.soloRole || 'both';
            return this._startRun({ role: r === 'both' ? 'solo' : r, ai: r === 'driver' ? 'gunner' : r === 'gunner' ? 'driver' : null, seed: (Math.random() * 1e9) | 0, profile: this.profile, startS, journey: this._selectedJourney() });
          } finally { if (this._startSelection === token) this._startSelection = null; }
        }
        if (this.mode !== 'coop' || !this.session) return;
        this._cancelStartSelection();
        this.session.swap.ready(!this.readyMine);
      },
      onMenu: async () => {
        const flow = this._flowId, session = this.session;
        if (this.mode === 'coop') {
          const r = await this.ui.modal({ title: 'LEAVE THE CONVOY?', text: 'You go back to the title screen and your partner is disconnected.', kind: 'warn', buttons: [{ label: 'STAY', kind: 'primary', cancel: true }, { label: 'LEAVE', id: 'leave', kind: 'danger' }] });
          if (r !== 'leave') return;
        }
        if (this._flowId !== flow || this.session !== session || this.screen !== 'garage') return;
        this.title();
      },
    };
  }
  async _maybeStart() {
    const s = this.session;
    if (this._campaignOpen || this._startSelection || this.screen !== 'garage' || this.mode !== 'coop' || !s?.isHost || !this.readyMine || !this.readyOther || !s.swap.canStart()) return;
    const seats = s.swap.snapshot();
    const token = this._startSelection = { session: s, flow: this._flowId, garage: this._garageGeneration, epoch: this._garageEpoch, profile: this.profile, revision: this.profile.revision, mine: s.me.role, other: s.other.role, seatEpoch: seats.epoch, seatRevision: seats.revision, seatIntent: seats.intent };
    try {
      const startS = await this._pickStart(token);
      const currentSeats = s.swap.snapshot();
      if (this._campaignOpen || this._startSelection !== token || this._flowId !== token.flow || this._garageGeneration !== token.garage || this._garageEpoch !== token.epoch || this._sessionEpoch(s) !== token.epoch || this.session !== s || this.mode !== 'coop' || this.screen !== 'garage' || !this.readyMine || !this.readyOther || !s.swap.canStart() || currentSeats.epoch !== token.seatEpoch || currentSeats.revision !== token.seatRevision || currentSeats.intent !== token.seatIntent || s.me.role !== token.mine || s.other.role !== token.other) return;
      if (startS === null) { this.readyMine = false; s.swap.ready(false); this._garageRefresh(); return; }
      if (this.profile !== token.profile || this.profile.revision !== token.revision) {
        this.readyMine = false; s.swap.ready(false); this._garageRefresh();
        this.ui.toast('Loadout changed. Ready up again.', 'info'); return;
      }
      const cfg = s.startRun({ seed: (Math.random() * 1e9) | 0, startS, journey: this._selectedJourney() });
      if (cfg) this._startRun(cfg);
    } finally { if (this._startSelection === token) this._startSelection = null; }
  }
  /** Once the crew has reached the Leviathan, a run can roll out from the dam road (past the warlords) for another shot at it. */
  async _pickStart(selection) {
    if (this._selectedJourney().mode !== 'legacy') return 40;
    const reached = (this.profile.best?.furthestS ?? this.profile.best?.distance ?? 0) >= DAM_CHECKPOINT_UNLOCK;
    if (!reached) return 40;
    const choice = this.ui.modal({ title: 'ROLL OUT FROM', text: 'You have reached the Leviathan. Start at the dam road for another shot at it (distance pays from where you start), or run the whole highway.', buttons: [
      { label: 'THE DAM ROAD', id: 'dam', kind: 'primary' }, { label: 'THE START', id: 'start' }, { label: 'BACK', id: null, cancel: true }] });
    if (selection) selection.choice = choice;
    const r = await choice;
    if (!r) return null;
    return r === 'dam' ? DAM_CHECKPOINT_S : 40;
  }

  // ------------------------------------------------------------------------------------------ run
  async _startRun(cfg) {
    const mode = this.mode, session = mode === 'coop' ? this.session : null;
    const flow = this._transition(), token = this._startup = { flow, session, mode };
    this._peerGarageReady = null;
    this.ui.hideAll();
    this.screen = 'run';
    if (session?.swap.localPhase === 'garage') session.swap.leaveGarage('run');
    this._pendingResults = null;
    this._pendingRunMsgs = []; this._pendingFast = null;
    this.input.reset();
    this.game.garage?.release?.();
    this.readyMine = this.readyOther = false;
    if (cfg.profile) this.profile = cfg.profile;
    const current = () => this._startup === token && this._flowId === flow && this.screen === 'run' && this.mode === mode && this.session === session;
    const cancel = () => { if (!current()) return; session?.sendJSON({ t: 'abort' }); this.garage(); };
    const loading = this.ui.modal({ title: 'GETTING READY', text: 'Getting your truck and the road ready.', buttons: [{ label: 'BACK TO GARAGE', id: 'cancel', cancel: true, onClick: cancel }] });
    loading.then((result) => { if (result === 'cancel') cancel(); });
    let run;
    try { run = await this.game.startRun({ ...cfg, net: session, paint: TRUCK_COLORS[this.profile.truckColor] ?? TRUCK_COLORS[0] }); }
    catch (e) {
      if (!current()) return;
      session?.sendJSON({ t: 'abort' }); this.garage();
      this.ui.toast('Could not start the run. Please try again.', 'bad'); console.warn('run startup', e); return;
    } finally { loading.close(); }
    if (!current()) return;
    if (!run) { this.garage(); return; }
    this._startup = null;
    for (const m of this._pendingRunMsgs) run.onNet(m);
    if (this._pendingFast) run.onFast(this._pendingFast);
    this._pendingRunMsgs = []; this._pendingFast = null;
    session?.sendJSON({ t: 'runReady' });
    this.game.audio?.music?.setState?.('run');
    window.__run = run;
    this.game.onRunEnd = (r) => { if (this.game.run === run && this.session === session) this._results(r); };
    this.game.onPause = () => { if (this.game.run === run && this.session === session) this._pause(); };
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
        // Retain the legacy finale hold unless verified victory presentation owns both seats.
        if (sim && !run.net && sim.won && !victoryPresenting(run) && (run.finaleT || 0) > 8.4) { this.game.paused = true; return; }
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
    // Defeat and verified victory must keep advancing to their results timers.
    // An already-owned pause remains owned; co-op continues underneath it.
    if (g.paused || g.run?.over || isDefeated(g.run) || victoryPresenting(g.run)) return;
    const run = g.run, session = this.session, flow = this._flowId;
    const current = () => this.screen === 'run' && g.run === run && this.session === session && this._flowId === flow;
    g.paused = true; this._releasing = true; this.input.releaseLock(); this.input.reset();
    this.ui.showPause({
      coop: this.mode === 'coop',
      onResume: () => { if (!current()) return; g.paused = false; this.input.reset(); this.ui.hideAll(); if (canCaptureRun(run)) this.input.requestLock(); },
      onQuit: () => {
        if (!current()) return;
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
    // The host authorizes both payouts. A guest may finish rendering the crash
    // first, so resume this transition from the profile callback when paid.
    if (sm && this.session && !this.session.isHost && !this.session.hasCreditedResult(sm.id)) {
      if (this._pendingResults !== run) this.game.hud?.message?.('WAITING FOR RESULTS', 12000, '#ffc21a');
      this._pendingResults = run; return;
    }
    this._pendingResults = null;
    this._transition(); this.ui.hideAll();
    this.game.paused = false; this._releasing = true; this.input.releaseLock();
    if (!sm) { this.garage(); return; }
    this.screen = 'results';
    this.session?.swap.leaveGarage('results');
    this.game.hud?.setVisible(false);
    const beforeProfile = this.session && !this.session.isHost ? (run.cfg?.profile || this.profile) : this.profile;
    const before = bestForJourney(beforeProfile, sm.journey);
    const cashBefore = beforeProfile.cash;
    if (this.session) this.session.creditResult(sm);
    else {
      creditRun(this.profile, sm);
      if (sm.levelCleared && creditCampaignLevel(this.profile, { runId: sm.id, level: sm.journey?.level, mode: sm.journey?.mode, won: sm.won })) {
        this.profile.campaignProgress.selectedLevel = Math.min(10, sm.journey.level + 1);
      }
      saveProfile(this.profile);
    }
    const newBest = { distance: sm.distance > (before.distance || 0), time: sm.time > (before.time || 0), kills: sm.kills > (before.kills || 0) };
    this.game.audio?.music?.setState?.(sm.won ? 'victory' : 'garage');
    this.sound('whoosh_transition');
    this.ui.showResults({ ...sm, newBest, bestBefore: before, cashBefore }, this.profile, {
      onContinue: () => (sm.won && (sm.journey?.mode !== 'campaign' || sm.journey.level === 10) ? this._victoryModal() : this.garage()), onTick: () => this.sound('coin'),
      onShop: (tab, id) => this.garage({ tab, select: id }),
    });
  }
  async _victoryModal() {
    const p = this.profile, flow = this._flowId, run = this.game.run, session = this.session;
    const campaign = run?.cfg?.journey?.mode === 'campaign';
    const result = await this.ui.modal({ title: campaign ? 'TEN LEVELS. ONE CREW.' : 'THE ROAD IS YOURS', text: campaign ? 'The Leviathan is scrap. You have unlocked ONE RUN TO RULE THEM ALL: every level on one continuous highway, with your existing vehicles and gear. Choose it in the garage level selector.' : `The Leviathan is scrap and the convoy is broken. ${p.runs} attempts, $${p.totalCash.toLocaleString()} earned. Return to the garage to choose your next ride.`, buttons: [{ label: 'BACK TO THE GARAGE', id: 'garage', kind: 'primary' }] });
    if (result !== 'garage' || this._flowId !== flow || this.screen !== 'results' || this.game.run !== run || this.session !== session) return;
    this.garage();
  }
}
