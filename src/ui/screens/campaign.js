import { h } from '../comp.js';
import { esc, hints } from '../glyphs.js';
import { TEN_LEVELS, normalizeCampaignProgress } from '../../data/campaign.js';

/** Garage overlay. Selection is a callback; App/Session own authority/save flow. */
export function campaignSelectionMarkup(profile, {canSelect=true}={}) {
  const p=normalizeCampaignProgress(profile?.campaignProgress), selected=p.selectedMode;
  const cards=TEN_LEVELS.map(level=>{
    const locked=level.number>p.unlockedLevel, cleared=p.cleared.includes(level.number), current=selected==='campaign'&&level.number===p.selectedLevel, enabled=canSelect&&!locked;
    return `<div class="campaign-card ${enabled?'f':''} ${locked?'locked':''} ${current?'selected':''}" ${enabled?'role="button"':'aria-disabled="true"'} data-level="${level.number}" data-mode="campaign" data-k="campaign:${level.number}"><span class="campaign-number">${String(level.number).padStart(2,'0')}</span><div><b>${esc(level.name)}</b><small>${esc(level.bossName)}</small></div><span class="campaign-status">${locked?'LOCKED':cleared?'CLEARED':current?'SELECTED':'READY'}</span></div>`;
  }).join('');
  const marathonEnabled=canSelect&&p.marathonUnlocked;
  return `<div class="campaign-grid">${cards}</div><div class="campaign-marathon ${marathonEnabled?'f':''} ${selected==='marathon'?'selected':''}" ${marathonEnabled?'role="button"':'aria-disabled="true"'} data-level="1" data-mode="marathon" data-k="campaign:marathon"><b>MARATHON</b><span>${p.marathonUnlocked?'All ten worlds in one continuous run.':'Clear all ten campaign levels to unlock Marathon.'}</span></div><p class="campaign-authority">${canSelect?'Your equipment and cash carry across levels.':'The host chooses the next level. Your personal cash stays yours.'}</p>`;
}
export class CampaignScreen {
  constructor(ui,profile,cb={},extra={}) {
    this.ui=ui;this.cb=cb;this.kind='campaign';this.bg='dim';this.extra=extra;this.profile=profile;
    this.el=h('<div class="screen campaign"><div class="safe campaign-safe"><div class="campaign-heading"><div class="eyebrow">CHOOSE YOUR NEXT ROAD</div><h1>CAMPAIGN</h1></div><div class="campaign-body"></div><div class="f btn campaign-back" role="button" data-act="back" data-k="campaign:back"><span>BACK TO GARAGE</span></div><div class="hints" data-hints></div></div></div>');
    this.el.addEventListener('click',event=>this.onClick(event));this.render();
  }
  render() {this.el.querySelector('.campaign-body').innerHTML=campaignSelectionMarkup(this.profile,this.extra);this.el.querySelector('[data-hints]').innerHTML=hints([['nav','CHOOSE LEVEL'],['confirm','SELECT'],['back','GARAGE']]);}
  update(profile,extra={}) {this.profile=profile;this.extra={...this.extra,...extra};this.render();this.ui.nav.ensure();}
  onClick(event) {
    const target=event.target.closest('.f');if(!target||!this.el.contains(target))return;
    if(target.dataset.act==='back')return this.back();
    const level=Number(target.dataset.level),mode=target.dataset.mode,p=normalizeCampaignProgress(this.profile?.campaignProgress);
    if(this.extra.canSelect===false||!Number.isInteger(level)||level<1||level>p.unlockedLevel||(mode==='marathon'&&!p.marathonUnlocked)||!['campaign','marathon'].includes(mode))return;
    this.ui.snd('click');this.cb.onSelect?.(level,mode);
  }
  initialFocus() {return this.el.querySelector('.campaign-card.selected.f')||this.el.querySelector('.campaign-card.f')||this.el.querySelector('[data-act="back"]');}
  selection() {const p=normalizeCampaignProgress(this.profile?.campaignProgress);return {level:p.selectedLevel,mode:p.selectedMode,unlockedLevel:p.unlockedLevel,marathonUnlocked:p.marathonUnlocked,canSelect:this.extra.canSelect!==false};}
  back() {this.ui.snd('menu_close');if(this.cb.onBack)this.cb.onBack();else this.ui._pop();return true;}
}
