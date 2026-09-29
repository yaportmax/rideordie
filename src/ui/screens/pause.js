// PAUSE: RESUME / SETTINGS / CONTROLS / QUIT RUN (with confirm). Drawn over the running game (veil backdrop).
import { h } from '../comp.js';
import { hints } from '../glyphs.js';

export class PauseScreen {
  constructor(ui, cb) {
    this.ui = ui; this.cb = cb; this.kind = 'pause'; this.bg = 'veil';
    this.el = h('<div class="screen pause"><div class="safe"></div></div>');
    const btn = (act, label, sub, i, cls = '') => `<div class="f btn stack stg ${cls}" style="--i:${i}" role="button" data-act="${act}" data-k="${act}"><span><b>${label}</b><small>${sub}</small></span></div>`;
    this.el.firstElementChild.innerHTML = `
      <div class="ps-title stg" style="--i:0"><div class="eyebrow">THE ROAD CAN WAIT</div><h1>PAUSED</h1></div>
      <nav class="menu ps-menu">
        ${btn('resume', 'RESUME', 'BACK TO THE ROAD', 1, 'primary')}
        ${btn('settings', 'SETTINGS', 'VIDEO &middot; AUDIO &middot; INPUT &middot; KEY BINDINGS', 2)}
        ${btn('controls', 'CONTROLS', 'DRIVER &amp; GUNNER LAYOUTS', 3)}
        ${btn('quit', cb.quitLabel || 'QUIT RUN', cb.quitSub || 'RETURN TO THE GARAGE', 4, 'danger')}
      </nav>
      <div class="hints" data-hints>${hints([['nav', 'MOVE'], ['confirm', 'SELECT'], ['back', 'RESUME']])}</div>`;
    this.el.addEventListener('click', (e) => this.onClick(e));
  }
  onClick(e) {
    const t = e.target.closest('.f'); if (!t) return;
    const ui = this.ui, cb = this.cb;
    switch (t.dataset.act) {
      case 'resume': ui.snd('menu_close'); cb.onResume && cb.onResume(); break;
      case 'settings': if (cb.onSettings) cb.onSettings(); else ui.showSettings(); break;
      case 'controls': if (cb.onControls) cb.onControls(); else ui.showControls('driver'); break;
      case 'quit':
        ui.modal({ title: 'QUIT THIS RUN?', text: cb.quitText || 'The run ends now and you go back to the garage.', kind: 'warn', buttons: [{ label: 'KEEP PLAYING', kind: 'primary', cancel: true }, { label: 'QUIT RUN', kind: 'danger', id: 'quit' }] })
          .then((r) => { if (r === 'quit' && cb.onQuit) cb.onQuit(); });
        break;
      default:
    }
  }
  initialFocus() { return this.el.querySelector('[data-act=resume]'); }
  back() { this.ui.snd('menu_close'); if (this.cb.onResume) this.cb.onResume(); return true; }
  alt(name) { if (name === 'start') this.back(); }
}
