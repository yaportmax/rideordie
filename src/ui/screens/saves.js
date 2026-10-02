import { h } from '../comp.js';
import { esc, hints, icon } from '../glyphs.js';
import { TRUCKS } from '../../data/upgrades.js';
import { normalizeCampaignProgress } from '../../data/campaign.js';

const MAX_SLOTS = 12, NAME_LIMIT = 32, IMPORT_LIMIT = 65536;
const TABS = [{ id: 'save', label: 'SAVE' }, { id: 'backups', label: 'BACKUPS' }, { id: 'cloud', label: 'CLOUD' }];
const STATUS = {
  disconnected: ['LOCAL SAVES', 'Progress is saved on this device.', 'local'],
  connecting: ['CONNECTING', 'Checking your private cloud vault.', 'pending'],
  syncing: ['SYNCING', 'Updating your private cloud vault.', 'pending'],
  connected: ['CLOUD CONNECTED', 'Your saves are backed up across devices.', 'good'],
  pending: ['SYNC QUEUED', 'Local changes are waiting to sync.', 'pending'],
  offline: ['OFFLINE', 'Keep playing. Local changes will sync when connected.', 'pending'],
  conflict: ['CHOOSE A VERSION', 'Two devices changed a save. Both versions are safe.', 'warn'],
  error: ['SYNC NEEDS ATTENTION', 'Your local saves are still available. Retry when ready.', 'warn'],
};
const safeNumber = value => Number.isFinite(value) ? Math.max(0, value) : 0;
const cash = value => '$' + Math.floor(safeNumber(value)).toLocaleString('en-US');
const time = value => { const seconds = Math.floor(safeNumber(value)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; };
const date = value => { const d = new Date(value); return value != null && Number.isFinite(d.getTime()) ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not played yet'; };
const nameOf = slot => String(slot?.name || 'Unnamed save');
function summary(profile = {}) {
  const progress = normalizeCampaignProgress(profile.campaignProgress);
  const vehicle = TRUCKS.find(item => item.id === profile.truck)?.name || 'STARTER VEHICLE';
  const recordTimes = Object.values(profile.campaignRecords || {}).map(record => safeNumber(record?.time));
  return { progress, vehicle, road: progress.selectedMode === 'marathon' ? 'MARATHON' : `LEVEL ${progress.selectedLevel}`, cash: cash(profile.cash), runs: Math.floor(safeNumber(profile.runs)), bestTime: time(Math.max(safeNumber(profile.best?.time), safeNumber(profile.marathonBest?.time), ...recordTimes)) };
}
function brief(profile) { const s = summary(profile); return `${s.road} · ${s.cash} · ${s.vehicle}`; }
function compare(profile) {
  const s = summary(profile);
  return `<dl class="sm-compare"><div><dt>CAMPAIGN</dt><dd>${s.progress.cleared.length}/10 cleared</dd></div><div><dt>CASH</dt><dd>${s.cash}</dd></div><div><dt>RUNS</dt><dd>${s.runs}</dd></div><div><dt>VEHICLE</dt><dd>${esc(s.vehicle)}</dd></div></dl>`;
}
function versionMarkup(slot) {
  if (!slot) return '<p class="sm-version-deleted">REMOVED FROM VAULT</p><p class="sm-version-note">The cloud no longer has this save.</p>';
  return `${slot.deleted ? '<p class="sm-version-deleted">DELETED SAVE</p><p class="sm-version-note">This snapshot is kept for recovery.</p>' : ''}${compare(slot.profile)}`;
}
function recoverySource(entry) {
  return {
    'stale-profile': ['OTHER TAB OR RESTORED SAVE', 'An attempted save was preserved because another tab or a restored snapshot changed this progress.'],
    'legacy-migration': ['PREVIOUS DEVICE SAVE', 'The original device save was preserved while setting up named save slots.'],
    'damaged-store': ['DAMAGED SAVE CATALOGUE', 'Original save data was preserved after the catalogue could not be read. Individual profiles need repair before loading.'],
    'damaged-legacy': ['DAMAGED PREVIOUS SAVE', 'Original device save data was preserved after it could not be read. This record needs repair before loading.'],
  }[entry.reason] || ['PRESERVED DEVICE PROGRESS', 'A separate branch of your device progress was preserved for recovery.'];
}

/** SaveStore and CloudSaves authority stays in App. This screen only presents explicit user choices. */
export class SavesScreen {
  constructor(ui, model = {}, cb = {}) {
    this.ui = ui; this.cb = cb; this.kind = 'saves'; this.bg = 'dim'; this.model = model;
    this.selectedId = model.activeId || this.slots()[0]?.id || null;
    this.tabId = 'save'; this.historySource = 'local'; this.histories = new Map();
    this.dialog = null; this.busy = false; this.revealedCode = null; this.dead = false;
    this.el = h('<section class="screen saves" aria-label="Save manager"><div class="safe sm-safe"></div></section>');
    this.el.addEventListener('click', event => this.onClick(event));
    this.el.addEventListener('submit', event => { event.preventDefault(); this.submitDialog(); });
    this.el.addEventListener('change', event => {
      if (event.target.matches('[data-import]')) { const file = event.target.files?.[0]; event.target.value = ''; if (file) this.importFile(file); }
    });
    this.el.addEventListener('focusin', event => { if (event.target.matches('.f')) this.ui.nav.focus(event.target, { silent: true, reveal: false }); });
    this.el.addEventListener('navfocus', event => {
      const element = event.detail.el;
      if (!event.detail.hover && /^(BUTTON|INPUT)$/.test(element.tagName) && document.activeElement !== element) element.focus({ preventScroll: true });
    });
    this.render();
  }
  slots() { return (Array.isArray(this.model.slots) ? this.model.slots : []).filter(slot => !slot.deleted).slice(0, MAX_SLOTS); }
  deleted() {
    const rows = this.model.deleted || this.model.deletedSlots || (Array.isArray(this.model.slots) ? this.model.slots.filter(slot => slot.deleted) : []);
    return Array.isArray(rows) ? rows.slice(0, MAX_SLOTS) : [];
  }
  recoveries() { return Array.isArray(this.model.recoveries) ? this.model.recoveries.slice(0, 20) : []; }
  selected() { return this.slots().find(slot => slot.id === this.selectedId) || null; }
  canChange() { return this.model.canChange !== false && !this.busy && !this.model.busy; }
  cloud() { return this.model.cloud || {}; }
  cloudStatus() {
    if (this.model.status?.error) return ['DEVICE SAVE ERROR', 'A save action failed. Open Backups to export preserved progress before closing the game.', 'warn'];
    if (this.model.status?.durable === false) return ['DEVICE SAVE FAILED', 'Export a backup before closing the game. Your progress could not be stored.', 'warn'];
    const cloud = this.cloud(), conflicts = Array.isArray(cloud.conflicts) ? cloud.conflicts : [];
    const id = conflicts.length ? 'conflict' : cloud.status || (cloud.connected ? 'connected' : 'disconnected');
    return STATUS[id] || STATUS[cloud.connected ? 'connected' : 'disconnected'];
  }
  button(action, label, { primary = false, danger = false, disabled = false, extra = '', data = '', key = action } = {}) {
    const unavailable = disabled || this.busy || !!this.model.busy;
    return `<button type="button" class="sm-button f ${primary ? 'primary' : ''} ${danger ? 'danger' : ''} ${unavailable ? 'dis' : ''} ${extra}" data-act="${action}" data-k="sm:${esc(key)}" ${data} ${unavailable ? 'disabled aria-disabled="true"' : ''}>${label}</button>`;
  }
  render(preferredKey) {
    const previousKey = preferredKey || this.ui.nav.cur?.dataset.k;
    const rosterScroll = this.el.querySelector('.sm-roster')?.scrollTop || 0;
    const paneScroll = this.el.querySelector('.sm-pane-scroll')?.scrollTop || 0;
    const slots = this.slots(), selected = this.selected();
    const [status, detail, tone] = this.cloudStatus();
    const notice = this.model.notice;
    const noticeText = typeof notice === 'string' ? notice : notice?.text || '';
    this.el.querySelector('.sm-safe').innerHTML = `
      <header class="sm-heading"><div><div class="eyebrow">KEEP YOUR RIDE</div><h1>SAVES</h1></div>${this.button('close', this.dialog ? 'CANCEL' : 'BACK TO TITLE', { extra: 'sm-close' })}</header>
      <div class="sm-status ${tone}" role="status" aria-live="polite"><i></i><b>${esc(this.busy ? 'WORKING' : status)}</b><span>${esc(this.busy ? this.busyText || 'Saving your changes.' : detail)}</span>${this.model.status?.error || this.model.status?.durable === false ? this.button('recovery-tools', 'BACKUPS', { extra: 'sm-status-action' }) : this.cloud().pending ? `<small>${Math.floor(safeNumber(this.cloud().pending))} queued</small>` : ''}</div>
      ${noticeText ? `<div class="sm-notice" role="status">${esc(noticeText)}</div>` : ''}
      <div class="sm-main" ${this.dialog ? 'style="display:none"' : ''}>
        <section class="sm-list plate trans" aria-label="Your saves"><div class="sm-list-head"><h2>YOUR SAVES</h2><span>${slots.length}/${MAX_SLOTS}</span></div><div class="hazbar"></div>
          <div class="sm-roster scroll">${slots.length ? slots.map(slot => this.slotMarkup(slot)).join('') : '<div class="sm-empty"><b>YOUR NEXT ROAD STARTS HERE</b><p>Create a save or import a backup to begin.</p></div>'}</div>
          <div class="sm-list-actions">${this.button('create', '+ NEW SAVE', { disabled: !this.canChange() || slots.length >= MAX_SLOTS })}${this.button('import', 'IMPORT FILE', { disabled: !this.canChange() || slots.length >= MAX_SLOTS })}</div>
          <p class="sm-local-note">${slots.length >= MAX_SLOTS ? 'Save slots are full. Export a copy before deleting a save.' : 'Each save has its own cash, equipment and campaign.'}</p>
        </section>
        <section class="sm-detail plate trans" aria-label="Selected save"><nav class="sm-tabs" aria-label="Save tools">${TABS.map(tab => this.button(`tab:${tab.id}`, tab.label, { extra: `sm-tab ${this.tabId === tab.id ? 'selected' : ''}`, data: `aria-pressed="${this.tabId === tab.id}"` })).join('')}</nav><div class="hazbar"></div>
          <div class="sm-pane-scroll scroll">${this.tabId === 'cloud' ? this.cloudMarkup() : this.tabId === 'backups' ? this.backupsMarkup(selected) : this.saveMarkup(selected)}</div>
        </section>
      </div>
      ${this.dialog ? this.dialogMarkup() : ''}
      <input type="file" accept="application/json,.json" data-import tabindex="-1" aria-hidden="true" hidden>
      <div class="sm-timing">Saves keep campaign progress, cash, equipment and records. Loading resumes in the garage.</div>
      <div class="hints" data-hints>${hints([['nav', 'MOVE'], ['confirm', this.dialog?.field ? 'TYPE / SELECT' : 'SELECT'], ['tabs', 'TOOLS'], ['back', this.dialog ? 'CANCEL' : 'TITLE']])}</div>`;
    this.el.querySelector('.sm-roster')?.scrollTo(0, rosterScroll);
    this.el.querySelector('.sm-pane-scroll')?.scrollTo(0, paneScroll);
    this.focusAfterRender(previousKey);
  }
  slotMarkup(slot) {
    const active = slot.id === this.model.activeId, selected = slot.id === this.selectedId;
    const conflicts = this.cloud().conflicts || [];
    const conflict = Array.isArray(conflicts) && conflicts.some(item => item.slotId === slot.id || item.id === slot.id);
    const pending = this.cloud().connected && (slot.sync?.dirty || slot.sync?.pending);
    const synced = this.cloud().connected && slot.sync?.version > 0;
    const unavailable = this.busy || this.model.busy;
    return `<button type="button" class="sm-slot f ${selected ? 'selected' : ''} ${unavailable ? 'dis' : ''}" data-act="select" data-slot="${esc(slot.id)}" data-k="sm:slot:${esc(slot.id)}" aria-pressed="${selected}" ${unavailable ? 'disabled' : ''}><span class="sm-slot-top"><b>${esc(nameOf(slot))}</b><small class="${conflict ? 'warn' : active ? 'active' : ''}">${conflict ? 'CONFLICT' : active ? 'ACTIVE' : pending ? 'QUEUED' : synced ? 'SYNCED' : 'LOCAL'}</small></span><span class="sm-slot-info">${esc(brief(slot.profile))}</span><span class="sm-slot-time">${esc(date(slot.updatedAt))}</span></button>`;
  }
  saveMarkup(slot) {
    if (!slot) return '<div class="sm-empty"><b>CHOOSE A SAVE</b><p>Select a save on the left to see its progress and manage backups.</p></div>';
    const s = summary(slot.profile), active = slot.id === this.model.activeId;
    const owned = Array.isArray(slot.profile?.trucks) ? slot.profile.trucks.length : 1;
    const weapons = slot.profile?.weapons && typeof slot.profile.weapons === 'object' ? Object.keys(slot.profile.weapons).length : 1;
    return `<div class="sm-save-title"><span class="sm-eyebrow">${active ? 'CURRENT SAVE' : 'READY TO RIDE'}</span><h2>${esc(nameOf(slot))}</h2><p>Last saved ${esc(date(slot.updatedAt))}</p></div>
      <div class="sm-progress"><div><b>${s.progress.cleared.length}<small>/10</small></b><span>LEVELS CLEARED</span></div><div class="sm-progress-road"><strong>${s.road}</strong><span>${s.progress.marathonUnlocked ? 'MARATHON UNLOCKED' : `LEVEL ${s.progress.unlockedLevel} UNLOCKED`}</span></div></div>
      <div class="sm-progress-bar" aria-label="${s.progress.cleared.length} of 10 levels cleared">${Array.from({ length: 10 }, (_, index) => `<i class="${s.progress.cleared.includes(index + 1) ? 'cleared' : ''}"></i>`).join('')}</div>
      <dl class="sm-stats"><div><dt>CASH</dt><dd>${s.cash}</dd></div><div><dt>RUNS</dt><dd>${s.runs}</dd></div><div><dt>LONGEST RUN</dt><dd>${s.bestTime}</dd></div><div class="sm-vehicle"><dt>SELECTED VEHICLE</dt><dd>${esc(s.vehicle)}</dd></div></dl>
      <p class="sm-owned">${owned} vehicle${owned === 1 ? '' : 's'} owned · ${weapons} weapon${weapons === 1 ? '' : 's'} owned</p>
      <div class="sm-primary-action">${this.button('activate', active ? `${icon('check')} ACTIVE SAVE` : 'USE THIS SAVE', { primary: true, disabled: active || !this.canChange() })}</div>
      <div class="sm-action-grid">${this.button('rename', 'RENAME', { disabled: !this.canChange() })}${this.button('duplicate', 'DUPLICATE', { disabled: !this.canChange() || this.slots().length >= MAX_SLOTS })}${this.button('export', 'EXPORT FILE')}${this.button('history', 'LOCAL BACKUPS')}</div>
      <div class="sm-delete-row"><span>${active ? 'Choose another save before deleting this one.' : 'Deleted saves stay available in Backups.'}</span>${this.button('delete', 'DELETE', { danger: true, disabled: active || !this.canChange() })}</div>`;
  }
  historyItems() {
    const supplied = this.model.history;
    if (Array.isArray(supplied)) return supplied;
    if (supplied && (!supplied.slotId || supplied.slotId === this.selectedId) && (!supplied.source || supplied.source === this.historySource)) return supplied.items || supplied.history || [];
    return this.histories.get(`${this.selectedId}:${this.historySource}`) || [];
  }
  backupsMarkup(slot) {
    const items = this.historyItems(), source = this.historySource;
    return `<div class="sm-pane-title"><span class="sm-eyebrow">RECOVERY</span><h2>BACKUPS</h2><p>Restore an earlier snapshot. Your current progress is kept as a backup.</p></div>
      ${slot ? `<div class="sm-backup-head"><b>${esc(nameOf(slot))}</b><div>${this.button('history', 'THIS DEVICE', { extra: source === 'local' ? 'selected' : '' })}${this.button('cloud-history', 'CLOUD', { disabled: !this.cloud().connected, extra: source === 'cloud' ? 'selected' : '' })}</div></div>
      <div class="sm-history-list">${Array.isArray(items) && items.length ? items.slice(0, 10).map(item => `<div class="sm-history"><div><b>${esc(date(item.at || item.updatedAt))}</b><span>${esc(brief(item.profile))}</span></div>${this.button('restore', 'RESTORE', { key: `restore:${item.id}`, disabled: !this.canChange(), data: `data-backup="${esc(item.id)}" aria-label="Restore backup from ${esc(date(item.at || item.updatedAt))}"` })}</div>`).join('') : `<div class="sm-empty sm-empty-small"><b>NO ${source === 'cloud' ? 'CLOUD' : 'LOCAL'} BACKUPS TO SHOW</b><p>Previous saved snapshots appear here as you play.${source === 'cloud' ? ' Connect and sync to check cloud history.' : ''}</p></div>`}</div>` : ''}
      ${this.recoveriesMarkup()}
      <div class="sm-deleted"><h3>DELETED SAVES</h3>${this.deleted().length ? this.deleted().map(item => `<div class="sm-history"><div><b>${esc(nameOf(item))}</b><span>${esc(brief(item.profile))}</span></div>${this.button('undelete', 'RECOVER', { key: `undelete:${item.id}`, disabled: !this.canChange() || this.slots().length >= MAX_SLOTS, data: `data-slot="${esc(item.id)}" aria-label="Recover ${esc(nameOf(item))}"` })}</div>`).join('') : '<p>No deleted saves on this device.</p>'}</div>`;
  }
  recoveriesMarkup() {
    const entries = this.recoveries(); if (!entries.length) return '';
    return `<div class="sm-preserved"><h3>PRESERVED PROGRESS</h3><p>These branches were kept separately when a save could not be safely written or read. Restore a usable branch as a new save.</p>${entries.map(entry => {
      const [source, description] = recoverySource(entry);
      const repair = entry.restorable === false || ['damaged-store', 'damaged-legacy'].includes(entry.reason);
      return `<div class="sm-history sm-recovery-branch"><div><small>${source}</small><b>${esc(entry.name || 'Preserved save')} · ${esc(date(entry.at))}</b><span>${description}</span>${entry.profile ? `<span>${esc(brief(entry.profile))}</span>` : ''}${entry.volatile ? '<span class="sm-recovery-volatile">This branch is held in this session. Export a file or restore a copy before closing the game.</span>' : ''}</div><div class="sm-recovery-actions">${this.button('restore-recovery', repair ? 'REPAIR REQUIRED' : 'RESTORE COPY', { key: `restore-recovery:${entry.id}`, disabled: repair || !this.canChange() || this.slots().length >= MAX_SLOTS || !this.cb.onRestoreRecovery, data: `data-recovery="${esc(entry.id)}" aria-label="Restore preserved progress from ${esc(date(entry.at))}"` })}${!repair && entry.profile ? this.button('export-recovery', 'EXPORT FILE', { key: `export-recovery:${entry.id}`, disabled: !this.cb.onExportRecovery, data: `data-recovery="${esc(entry.id)}" aria-label="Export preserved progress from ${esc(date(entry.at))}"` }) : ''}</div></div>`;
    }).join('')}</div>`;
  }
  cloudMarkup() {
    const cloud = this.cloud(), [label, message, tone] = this.cloudStatus();
    if (!cloud.connected) return `<div class="sm-pane-title"><span class="sm-eyebrow">YOUR RIDE, ANY DEVICE</span><h2>CLOUD SAVES</h2><p>Connect a private vault to back up your saves and use them on another device.</p></div>
      <div class="sm-cloud-intro"><span class="sm-cloud-symbol">${icon('truck')}</span><h3>ONE RECOVERY CODE.<br>ALL YOUR SAVES.</h3><p>No account required. Keep the code somewhere safe. Anyone with it can access your vault.</p></div>
      <div class="sm-cloud-start">${this.button('cloud-create', 'CREATE A CLOUD VAULT', { primary: true, disabled: !this.canChange() })}${this.button('cloud-connect', 'ENTER A RECOVERY CODE', { disabled: !this.canChange() })}</div>
      <p class="sm-explainer">Your local saves stay on this device. Connecting another vault preserves your local progress and asks you to resolve any conflicts.</p>`;
    const conflicts = Array.isArray(cloud.conflicts) ? cloud.conflicts : [];
    return `<div class="sm-pane-title"><span class="sm-eyebrow">PRIVATE VAULT</span><h2>CLOUD SAVES</h2><p>${cloud.lastSyncedAt ? `Last synced ${esc(date(cloud.lastSyncedAt))}` : 'Your local progress is ready to sync.'}</p></div>
      <div class="sm-cloud-connected ${tone}"><div><b>${esc(label)}</b><p>${esc(message)}</p></div>${this.button('sync', 'SYNC NOW', { primary: true, disabled: !this.canChange() })}</div>
      <div class="sm-recovery"><h3>RECOVERY CODE</h3><p>Use this code on another device. Keep it private and save a copy outside the game.</p>${this.revealedCode ? '<code class="sm-secret" data-secret></code>' : '<div class="sm-secret-hidden">HIDDEN UNTIL YOU REVEAL IT</div>'}<div class="sm-inline-actions">${this.button(this.revealedCode ? 'hide-code' : 'reveal-code', this.revealedCode ? 'HIDE CODE' : 'REVEAL CODE')}${this.button('copy-code', 'COPY CODE')}</div></div>
      ${conflicts.length ? `<div class="sm-conflicts"><h3>RESOLVE SAVE CONFLICTS</h3><p>Choose which progress to keep, or keep both as separate saves.</p>${conflicts.map(conflict => this.conflictMarkup(conflict)).join('')}</div>` : '<p class="sm-explainer">Offline play saves to this device first. Queued changes sync when the connection returns.</p>'}
      <div class="sm-disconnect"><span>Disconnect keeps all saves on this device.</span>${this.button('cloud-disconnect', 'DISCONNECT', { danger: true, disabled: !this.canChange() })}</div>`;
  }
  conflictMarkup(conflict) {
    const id = conflict.slotId || conflict.id, local = conflict.local || this.slots().find(slot => slot.id === id), remote = conflict.remote || conflict.cloud;
    const cloudDeletes = !remote || remote.deleted, active = id === this.model.activeId;
    return `<div class="sm-conflict"><h4>${esc(nameOf(local || remote))}</h4><div class="sm-conflict-versions"><div><b>THIS DEVICE</b>${versionMarkup(local)}</div><div><b>CLOUD</b>${versionMarkup(remote)}</div></div>${active && cloudDeletes ? '<p class="sm-version-note">Select a different active save before accepting the cloud deletion.</p>' : ''}<div class="sm-conflict-actions">${this.button('resolve-local', local?.deleted ? 'KEEP DELETION' : 'KEEP DEVICE', { key: `resolve-local:${id}`, disabled: !this.canChange() || (!remote && this.slots().length >= MAX_SLOTS), data: `data-slot="${esc(id)}"` })}${this.button('resolve-cloud', cloudDeletes ? 'USE CLOUD DELETION' : 'KEEP CLOUD', { key: `resolve-cloud:${id}`, disabled: !this.canChange() || (cloudDeletes && active), data: `data-slot="${esc(id)}"` })}${this.button('resolve-both', cloudDeletes ? 'KEEP SAVE COPY' : 'KEEP BOTH', { key: `resolve-both:${id}`, primary: true, disabled: !this.canChange() || this.slots().length >= MAX_SLOTS || (remote?.deleted && active), data: `data-slot="${esc(id)}"` })}</div></div>`;
  }
  dialogMarkup() {
    const d = this.dialog;
    const field = d.field ? `<label class="sm-field-label" for="sm-dialog-input">${esc(d.field.label)}</label><input id="sm-dialog-input" class="sm-input f" data-k="sm:input" data-submit="[data-act='dialog-submit']" type="text" maxlength="${d.field.code ? 48 : NAME_LIMIT}" autocomplete="off" spellcheck="false" autocapitalize="${d.field.code ? 'off' : 'words'}" placeholder="${esc(d.field.placeholder || '')}" aria-describedby="sm-form-help sm-form-error"><p id="sm-form-help" class="sm-field-help">${d.field.code ? 'Recovery codes are case-sensitive and begin with ROD1-.' : `1-${NAME_LIMIT} characters. Give this ride a name you will recognize.`}</p>${this.button('keyboard', d.keyboard ? 'HIDE KEYBOARD' : 'ON-SCREEN KEYBOARD', { extra: 'sm-keyboard-toggle' })}${d.keyboard ? this.keyboardMarkup(d.field.code) : ''}` : '';
    return `<div class="sm-dialog-wrap"><section class="sm-dialog plate trans ${d.danger ? 'danger' : ''}" role="dialog" aria-modal="true" aria-labelledby="sm-dialog-title"><div class="hazbar"></div><div class="sm-dialog-content scroll"><div class="sm-eyebrow">${d.danger ? 'CHECK BEFORE YOU CONTINUE' : 'SAVE MANAGER'}</div><h2 id="sm-dialog-title">${esc(d.title)}</h2><p class="sm-dialog-text">${esc(d.text)}</p>${d.comparison || ''}<form novalidate>${field}<p id="sm-form-error" class="sm-form-error" role="alert">${esc(d.error || '')}</p><div class="sm-dialog-actions">${this.button('dialog-cancel', 'CANCEL')}${this.button('dialog-submit', d.confirm, { primary: !d.danger, danger: d.danger })}</div></form></div></section></div>`;
  }
  keyboardMarkup(code) {
    const chars = `${this.dialog.lower ? 'abcdefghijklmnopqrstuvwxyz' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'}0123456789${code ? '-_' : '-'}`.split('');
    const key = (value, label = value, extra = '') => `<button type="button" class="sm-key f ${extra}" data-act="key" data-key="${esc(value)}" data-k="sm:key:${esc(value)}">${esc(label)}</button>`;
    return `<div class="sm-keyboard" aria-label="On-screen keyboard">${chars.map(char => key(char)).join('')}${code ? key('SHIFT', this.dialog.lower ? 'A-Z' : 'a-z', 'sm-key-wide') : key(' ', 'SPACE', 'sm-key-wide')}${key('DEL', 'DELETE', 'sm-key-wide')}${key('CLEAR', 'CLEAR', 'sm-key-wide')}</div>`;
  }
  focusAfterRender(key) {
    // Keep secrets out of markup strings, attributes and the regular view model.
    const secret = this.el.querySelector('[data-secret]'); if (secret) secret.textContent = this.revealedCode;
    const input = this.el.querySelector('#sm-dialog-input');
    if (input) { input.value = this.dialog.field.value || ''; const selection = this.dialog.field.selection; if (selection) input.setSelectionRange(selection.start, selection.end, selection.direction); }
    requestAnimationFrame(() => {
      if (this.dead || this.ui.screen() !== this || this.ui.modalOpen()) return;
      const preferred = [...this.el.querySelectorAll('.f')].find(element => element.dataset.k === key && !element.disabled && element.offsetParent !== null);
      this.ui.nav.ensure(preferred || this.initialFocus());
    });
  }
  update(model = {}) {
    this.captureInput(); this.model = model;
    if (!this.slots().some(slot => slot.id === this.selectedId)) this.selectedId = model.activeId || this.slots()[0]?.id || null;
    if (!this.cloud().connected) {
      this.revealedCode = null; this.historySource = 'local';
      for (const key of this.histories.keys()) if (key.endsWith(':cloud')) this.histories.delete(key);
    }
    this.render();
  }
  captureInput() {
    const input = this.el.querySelector('#sm-dialog-input');
    if (input && this.dialog?.field) { this.dialog.field.value = input.value; this.dialog.field.selection = { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection }; }
  }
  openDialog(dialog) { this.revealedCode = null; this.dialog = { ...dialog, returnFocus: this.ui.nav.cur?.dataset.k, keyboard: !!dialog.field && this.ui.device() === 'pad' }; this.render(dialog.field ? 'sm:input' : 'sm:dialog-cancel'); }
  async run(name, args = [], { message = 'Saving your changes.', historySource } = {}) {
    if (this.busy || this.model.busy || !this.cb[name]) return;
    this.busy = true; this.busyText = message; this.captureInput(); this.render();
    try {
      const result = await this.cb[name](...args);
      if (this.dead) return result;
      if (result?.ok === false) { this.ui.toast('COULD NOT COMPLETE THAT SAVE ACTION. YOUR CURRENT PROGRESS IS KEPT.', 'warn'); return result; }
      if (historySource) {
        this.histories.set(`${args[0]}:${historySource}`, Array.isArray(result) ? result : result?.history || result?.items || []);
      } else if (result && Array.isArray(result.slots)) this.model = result;
      return result;
    } catch {
      if (!this.dead) this.ui.toast('COULD NOT COMPLETE THAT SAVE ACTION. TRY AGAIN.', 'warn');
      return null;
    } finally {
      this.busy = false; this.busyText = '';
      if (!this.dead && this.ui.screen() === this) this.render();
    }
  }
  loadHistory(source) {
    if (!this.selected()) return;
    if (source === 'cloud' && !this.cloud().connected) source = 'local';
    this.tabId = 'backups'; this.historySource = source; this.revealedCode = null; this.render(`sm:${source === 'cloud' ? 'cloud-history' : 'history'}`);
    this.run(source === 'cloud' ? 'onCloudHistory' : 'onHistory', [this.selectedId], { historySource: source, message: 'Loading saved snapshots.' });
  }
  async submitDialog() {
    const d = this.dialog; if (!d || this.busy || this.model.busy) return;
    if (this.model.canChange === false) {
      d.error = 'Return to the title and leave co-op before changing saves.'; this.render(); return;
    }
    this.captureInput();
    const value = (d.field?.value || '').trim();
    if (d.field) {
      const valid = d.field.code ? /^ROD1-[A-Za-z0-9_-]{43}$/.test(value) : value.length >= 1 && value.length <= NAME_LIMIT && !/[\u0000-\u001f\u007f]/.test(value);
      if (!valid) {
        d.error = d.field.code ? 'Enter a complete ROD1- recovery code. Keep upper and lower case unchanged.' : `Enter a name between 1 and ${NAME_LIMIT} characters.`;
        this.ui.snd('error'); this.render('sm:input'); return;
      }
    }
    this.dialog = null; this.render(d.returnFocus);
    await this.run(d.callback, d.field ? [...(d.args || []), value] : d.args || [], { message: d.message || 'Saving your changes.' });
  }
  importFile(file) {
    if (!this.canChange()) return;
    if (!file || file.size > IMPORT_LIMIT || file.size < 2) { this.ui.toast('CHOOSE A RIDE OR DIE JSON SAVE SMALLER THAN 64 KB.', 'warn'); return; }
    this.openDialog({ title: 'IMPORT A SAVE?', text: `${file.name} will be imported as a separate save. Your existing saves stay available.`, confirm: 'IMPORT SAVE', callback: 'onImport', args: [file] });
  }
  onClick(event) {
    const target = event.target.closest('button[data-act]');
    if (!target || !this.el.contains(target) || target.disabled || target.classList.contains('dis')) return;
    this.ui.nav.focus(target, { silent: true, reveal: false });
    const action = target.dataset.act, slot = this.selected();
    if (action === 'close' || action === 'dialog-cancel') return this.back();
    if (action === 'select') {
      this.selectedId = target.dataset.slot; this.revealedCode = null; this.render(target.dataset.k);
      if (this.tabId === 'backups') this.loadHistory(this.historySource);
      return;
    }
    if (action.startsWith('tab:')) return this.selectTab(action.slice(4));
    if (action === 'dialog-submit') return this.submitDialog();
    if (action === 'keyboard') { this.captureInput(); this.dialog.keyboard = !this.dialog.keyboard; this.render('sm:keyboard'); return; }
    if (action === 'key') return this.key(target.dataset.key);
    if (action === 'create') return this.openDialog({ title: 'NEW SAVE', text: 'Start a fresh campaign with its own cash and equipment.', confirm: 'CREATE SAVE', callback: 'onCreate', field: { label: 'SAVE NAME', value: '', placeholder: 'NEW RIDE' } });
    if (action === 'import') return this.el.querySelector('[data-import]').click();
    if (action === 'history') return this.loadHistory('local');
    if (action === 'recovery-tools') return this.selectTab('backups');
    if (action === 'cloud-history') return this.loadHistory('cloud');
    if (action === 'cloud-create') return this.openDialog({ title: 'CREATE A CLOUD VAULT?', text: 'Your saves will be backed up in a private vault. A recovery code grants access on other devices. Keep a copy somewhere safe.', confirm: 'CREATE VAULT', callback: 'onCloudCreate', message: 'Creating your private cloud vault.' });
    if (action === 'cloud-connect') return this.openDialog({ title: 'CONNECT YOUR VAULT', text: 'Enter the recovery code from your other device. Local saves are preserved. Conflicting progress needs your choice.', confirm: 'CONNECT', callback: 'onCloudConnect', field: { label: 'RECOVERY CODE', code: true, value: '', placeholder: 'ROD1-…' }, message: 'Checking your private cloud vault.' });
    if (action === 'cloud-disconnect') return this.openDialog({ title: 'DISCONNECT CLOUD SAVES?', text: 'All saves stay on this device. Cloud sync stops here until you enter the recovery code again. Save your recovery code before disconnecting.', confirm: 'DISCONNECT', callback: 'onCloudDisconnect', danger: true });
    if (action === 'sync') return this.run('onSync', [], { message: 'Syncing your saved progress.' });
    if (action === 'reveal-code') return this.revealCode();
    if (action === 'hide-code') { this.revealedCode = null; this.render('sm:reveal-code'); return; }
    if (action === 'copy-code') return this.run('onCopyCode', [], { message: 'Copying your recovery code.' });
    if (action.startsWith('resolve-')) return this.confirmConflict(target.dataset.slot, action.slice(8));
    if (action === 'undelete') {
      const deleted = this.deleted().find(item => item.id === target.dataset.slot); if (!deleted) return;
      return this.openDialog({ title: 'RECOVER DELETED SAVE?', text: `Bring “${nameOf(deleted)}” back to your save list. It will not replace your active save.`, confirm: 'RECOVER SAVE', callback: 'onRestoreDeleted', args: [deleted.id] });
    }
    if (action === 'restore-recovery') {
      const recovery = this.recoveries().find(item => item.id === target.dataset.recovery); if (!recovery) return;
      const [source] = recoverySource(recovery);
      return this.openDialog({ title: 'RESTORE PRESERVED PROGRESS?', text: `${source}: restore the branch from ${date(recovery.at)} as a separate save? Your current saves and the preserved record stay available.`, comparison: recovery.profile ? compare(recovery.profile) : '', confirm: 'RESTORE COPY', callback: 'onRestoreRecovery', args: [recovery.id], field: { label: 'RECOVERED SAVE NAME', value: String(recovery.name || 'Recovered save').slice(0, NAME_LIMIT) } });
    }
    if (action === 'export-recovery') {
      const recovery = this.recoveries().find(item => item.id === target.dataset.recovery);
      if (!recovery?.profile || recovery.restorable === false) return;
      return this.run('onExportRecovery', [recovery.id], { message: 'Preparing preserved progress for export.' });
    }
    if (!slot) return;
    if (action === 'activate') return this.openDialog({ title: 'USE THIS SAVE?', text: `“${nameOf(slot)}” becomes your active save. The next garage uses its campaign, cash and equipment.`, comparison: compare(slot.profile), confirm: 'USE SAVE', callback: 'onActivate', args: [slot.id] });
    if (action === 'rename') return this.openDialog({ title: 'RENAME SAVE', text: 'Your progress and equipment stay with this save.', confirm: 'RENAME', callback: 'onRename', args: [slot.id], field: { label: 'SAVE NAME', value: nameOf(slot) } });
    if (action === 'duplicate') return this.openDialog({ title: 'DUPLICATE SAVE', text: 'Make a separate copy of this campaign, cash and equipment.', confirm: 'CREATE COPY', callback: 'onDuplicate', args: [slot.id], field: { label: 'COPY NAME', value: `${nameOf(slot).slice(0, NAME_LIMIT - 5)} COPY` } });
    if (action === 'export') return this.run('onExport', [slot.id], { message: 'Preparing your save file.' });
    if (action === 'delete') return this.openDialog({ title: 'DELETE THIS SAVE?', text: `Remove “${nameOf(slot)}” from your save list? Its progress can be recovered from Deleted saves in Backups.`, comparison: compare(slot.profile), confirm: 'DELETE SAVE', callback: 'onDelete', args: [slot.id], danger: true });
    if (action === 'restore') {
      const backup = this.historyItems().find(item => item.id === target.dataset.backup); if (!backup) return;
      return this.openDialog({ title: 'RESTORE THIS BACKUP?', text: `Replace “${nameOf(slot)}” with the ${this.historySource === 'cloud' ? 'cloud' : 'local'} snapshot from ${date(backup.at || backup.updatedAt)}? Current progress is retained as a backup.`, comparison: compare(backup.profile), confirm: 'RESTORE BACKUP', callback: this.historySource === 'cloud' ? 'onCloudRestore' : 'onRestore', args: [slot.id, backup.id], danger: true });
    }
  }
  async revealCode() {
    if (this.busy || !this.cb.onRevealCode) return;
    try {
      const result = await this.cb.onRevealCode();
      const value = typeof result === 'string' ? result : result?.code;
      if (this.dead || this.ui.screen() !== this || this.tabId !== 'cloud' || this.dialog || !this.cloud().connected) return;
      if (/^ROD1-[A-Za-z0-9_-]{43}$/.test(value || '')) { this.revealedCode = value; this.render('sm:hide-code'); }
      else this.ui.toast('RECOVERY CODE IS UNAVAILABLE. RECONNECT YOUR VAULT.', 'warn');
    } catch { if (!this.dead) this.ui.toast('COULD NOT REVEAL THE RECOVERY CODE.', 'warn'); }
  }
  confirmConflict(id, choice) {
    if (!['local', 'cloud', 'both'].includes(choice)) return;
    const conflict = this.cloud().conflicts?.find(item => (item.slotId || item.id) === id); if (!conflict) return;
    const local = conflict.local || this.slots().find(item => item.id === id), remote = conflict.remote || conflict.cloud;
    const cloudDeletes = !remote || remote.deleted;
    let text = choice === 'both' ? 'Keep device and cloud progress as separate saves. The copy gets its own campaign.' : `Keep ${choice === 'local' ? 'this device’s' : 'the cloud’s'} version of “${nameOf(local || remote)}”? The other version is retained as a backup.`;
    if (choice === 'cloud' && cloudDeletes) text = `Accept the cloud deletion and remove “${nameOf(local)}” from this device’s save list? Its current progress is kept for recovery.`;
    if (choice === 'local' && local?.deleted) text = `Keep the device deletion of “${nameOf(local)}” and apply it to the cloud? The snapshot stays recoverable.`;
    if (choice === 'local' && !local?.deleted && remote?.deleted) text = `Restore “${nameOf(local)}” in the cloud using this device’s progress? The cloud snapshot is kept as a backup.`;
    if (choice === 'both' && remote?.deleted) text = 'Preserve this device’s progress as a separate copy and accept the cloud deletion for the original save.';
    if (choice === 'both' && local?.deleted && !cloudDeletes) text = 'Preserve the deleted device snapshot as a separate copy and restore the cloud version as the original save.';
    if (choice !== 'cloud' && !remote) text = 'Keep your device progress and publish a recovered copy with a new save identity. The original stays on this device.';
    this.openDialog({ title: choice === 'both' ? 'KEEP BOTH SAVES?' : 'RESOLVE THIS CONFLICT?', text, comparison: `<div class="sm-conflict-versions"><div><b>THIS DEVICE</b>${versionMarkup(local)}</div><div><b>CLOUD</b>${versionMarkup(remote)}</div></div>`, confirm: choice === 'both' ? 'KEEP SAVE COPY' : choice === 'local' ? local?.deleted ? 'KEEP DELETION' : 'KEEP DEVICE' : cloudDeletes ? 'ACCEPT DELETION' : 'KEEP CLOUD', callback: 'onResolve', args: [id, choice], danger: choice !== 'both' || !!remote?.deleted });
  }
  key(key) {
    const input = this.el.querySelector('#sm-dialog-input'); if (!input || !this.dialog?.field) return;
    if (key === 'SHIFT') { this.captureInput(); this.dialog.lower = !this.dialog.lower; this.render('sm:key:SHIFT'); return; }
    if (key === 'DEL') input.value = input.value.slice(0, -1);
    else if (key === 'CLEAR') input.value = '';
    else if (input.value.length < input.maxLength) input.value += key;
    this.captureInput(); this.dialog.error = ''; this.el.querySelector('.sm-form-error').textContent = '';
  }
  selectTab(id) {
    if (this.dialog || this.busy || !TABS.some(tab => tab.id === id)) return;
    this.tabId = id; this.revealedCode = null; this.render(`sm:tab:${id}`);
    if (id === 'backups') this.loadHistory(this.historySource);
  }
  tabStep(direction) {
    if (this.dialog) return;
    this.selectTab(TABS[(TABS.findIndex(tab => tab.id === this.tabId) + direction + TABS.length) % TABS.length].id);
  }
  onKey(event) {
    if (event.code !== 'Tab') return false;
    const elements = this.ui.nav.list(), index = elements.indexOf(this.ui.nav.cur);
    if (elements.length) this.ui.nav.focus(elements[(index + (event.shiftKey ? -1 : 1) + elements.length) % elements.length]);
    return true;
  }
  navOverride(element, direction) {
    if (!element.classList.contains('sm-slot')) return undefined;
    const rows = [...this.el.querySelectorAll('.sm-slot')], index = rows.indexOf(element);
    if (direction === 'up') return rows[index - 1] || this.el.querySelector('[data-act="close"]');
    if (direction === 'down') return rows[index + 1] || this.el.querySelector('[data-act="create"]:not(:disabled)') || this.el.querySelector('[data-act="import"]:not(:disabled)');
    if (direction === 'right') return this.el.querySelector(`[data-act="tab:${this.tabId}"]`);
    return undefined;
  }
  initialFocus() {
    if (this.dialog) return this.el.querySelector(this.dialog.field ? '#sm-dialog-input' : '[data-act="dialog-cancel"]');
    return this.el.querySelector('.sm-slot.selected') || this.el.querySelector('[data-act="create"]') || this.el.querySelector('[data-act="close"]');
  }
  back() {
    if (this.busy || this.model.busy) return true;
    this.revealedCode = null;
    if (this.dialog) { const key = this.dialog.returnFocus; this.dialog = null; this.ui.snd('menu_close'); this.render(key); return true; }
    if (this.cb.onClose) this.cb.onClose(); else this.ui.close();
    return true;
  }
  destroy() { this.dead = true; this.revealedCode = null; this.dialog = null; this.histories.clear(); }
}
