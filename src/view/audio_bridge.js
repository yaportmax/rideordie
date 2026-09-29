// AudioBridge: maps sim / gunner events + per-frame CarState to sounds (see docs/API.md "Sim events").
//
//   const audio = new AudioSys(camera); await audio.init();            // src/core/audio.js
//   const abridge = new AudioBridge(audio, { playerId: player.id });   // localRole: 'solo' | 'gunner' | 'driver' (hit-marker ticks are for gunner/solo)
//   // per frame (after cameras moved):
//   audio.listener.update(camera, camVelocity);
//   for (const st of states.values()) abridge.updateCar(st, dt, { surface: 'asphalt' });   // engines, tyres, wind, fire loops, landings
//   abridge.update(dt, ctx);  audio.update(dt);
//   // events:  for (const e of events) { fx.handleEvent(e, ctx); abridge.handleEvent(e, ctx); }   ctx = { carViews, states, playerId, cameraPos }
//   // run flow: abridge.runStart() / bossIntro() / bossDefeated() / victory();  audio.music.setState('garage'|'title'|'run'|'boss'|'victory')
import { WEAPONS } from '../data/weapons.js';
import { VEHICLES } from '../data/vehicles.js';
import { clamp, smoothstep } from '../core/util.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Reload foley per weapon family: [name, fraction of reload time, {gain,pitch}] (times scale with reloadStart.time). */
const RELOAD = {
  pistol: [['guns/pistol_mag_out', 0.16], ['guns/pistol_mag_in', 0.6], ['guns/pistol_slide', 0.86]],
  revolver: [['guns/pistol_mag_out', 0.12, { pitch: 0.8 }], ['guns/shell_drop_brass', 0.22, { gain: 1.4 }], ['guns/shotgun_shell_in', 0.5, { pitch: 1.35, gain: 0.6 }], ['guns/shotgun_shell_in', 0.62, { pitch: 1.45, gain: 0.6 }], ['guns/pistol_slide', 0.88, { pitch: 0.85 }]],
  smg: [['guns/smg_mag_out', 0.14], ['guns/smg_mag_in', 0.58], ['guns/smg_bolt', 0.84]],
  rifle: [['guns/rifle_mag_out', 0.13], ['guns/rifle_mag_in', 0.55], ['guns/rifle_bolt', 0.82]],
  lmg: [['guns/lmg_cover_open', 0.06], ['guns/lmg_belt_in', 0.42], ['guns/lmg_belt_in', 0.58, { pitch: 1.06, gain: 0.8 }], ['guns/lmg_cover_close', 0.78], ['guns/lmg_rack', 0.93]],
  sniper: [['guns/sniper_bolt_open', 0.08], ['guns/sniper_mag', 0.45], ['guns/sniper_bolt_close', 0.8]],
  rpg: [['guns/rpg_reload', 0.04]],
  shotgun: [],
};

/** Every manifest name the bridge / engine may use (the test page lists the ones the library lacks). */
export const EXPECTED_NAMES = [
  ...['pistol', 'revolver', 'smg', 'shotgun', 'rifle', 'lmg', 'sniper', 'rpg'].map((w) => 'guns/fire_' + w),
  'guns/fire_enemy_light', 'guns/fire_enemy_heavy', 'guns/dry_click', 'guns/weapon_swap', 'guns/rocket_loop', 'guns/shell_drop_brass', 'guns/shell_drop_shotgun',
  'guns/shotgun_pump', 'guns/shotgun_shell_in', 'guns/grenade_pin', 'guns/grenade_throw', 'guns/grenade_bounce',
  ...new Set(Object.values(RELOAD).flat().map((r) => r[0])),
  'impacts/bullet_metal', 'impacts/bullet_flesh', 'impacts/bullet_dirt', 'impacts/bullet_asphalt', 'impacts/bullet_glass', 'impacts/bullet_tire', 'impacts/ricochet', 'impacts/bullet_whizz',
  'impacts/car_crash_light', 'impacts/car_crash_heavy', 'impacts/ram_hit', 'impacts/metal_tear', 'impacts/glass_shatter', 'impacts/panel_detach', 'impacts/debris_bounce', 'impacts/wheel_off',
  'impacts/car_scrape_hit', 'impacts/hit_marker', 'impacts/hit_marker_kill', 'impacts/headshot_ping',
  'explosions/explosion_small', 'explosions/explosion_medium', 'explosions/explosion_large', 'explosions/explosion_huge', 'explosions/distant_explosion', 'explosions/shockwave_sub',
  'explosions/rocket_explosion', 'explosions/grenade_explosion', 'explosions/fire_loop', 'explosions/fire_crackle_loop', 'explosions/fuel_ignite',
  'vehicles/turbo_whine_loop', 'vehicles/supercharger_whine_loop', 'vehicles/nitro_loop', 'vehicles/nitro_ignite', 'vehicles/nitro_end', 'vehicles/backfire', 'vehicles/skid_loop', 'vehicles/skid_gravel_loop',
  'vehicles/tyre_asphalt_loop', 'vehicles/tyre_dirt_loop', 'vehicles/wind_loop', 'vehicles/suspension_thunk', 'vehicles/jump_land_heavy', 'vehicles/hit_car_body', 'vehicles/gear_shift',
  'vehicles/engine_stall', 'vehicles/damaged_engine_loop', 'vehicles/brake_squeal', 'vehicles/oil_slick_splat', 'vehicles/mine_drop_beep', 'vehicles/mine_explosion', 'vehicles/horn', 'vehicles/engine_start', 'impacts/armor_hit', 'impacts/car_scrape_loop',
  ...['click', 'hover', 'buy', 'error', 'coin', 'upgrade_unlock', 'ready', 'countdown_beep', 'go', 'menu_open', 'menu_close', 'whoosh_transition'].map((n) => 'ui/' + n),
  ...['run_start', 'game_over', 'boss_intro', 'boss_defeated', 'victory'].map((n) => 'stingers/' + n),
  'stingers/low_health_heartbeat_loop', 'stingers/warning_alarm_loop',
  'ambience/desert', 'ambience/canyon', 'ambience/coast', 'ambience/mountain', 'ambience/city', 'ambience/dam',
  'music/run', 'music/boss', 'music/garage', 'music/title', 'music/victory',
];

function qRot(q, x, y, z) { // rotate (x,y,z) by quaternion q {x,y,z,w}
  const ix = q.w * x + q.y * z - q.z * y, iy = q.w * y + q.z * x - q.x * z, iz = q.w * z + q.x * y - q.y * x, iw = -q.x * x - q.y * y - q.z * z;
  return [ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y, iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z, iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x];
}
const arr3 = (p) => (Array.isArray(p) ? p : [p.x, p.y, p.z]);

export class AudioBridge {
  /** opts: { playerId, localRole: 'solo'|'gunner'|'driver', autoDanger: true } */
  constructor(audio, opts = {}) {
    this.audio = audio; this.playerId = opts.playerId ?? -1; this.localRole = opts.localRole || 'solo'; this.autoDanger = opts.autoDanger !== false;
    this.cars = new Map(); this.rockets = []; this.recent = []; this.reloadH = []; this.lastCrash = new Map(); this.lastFlesh = new Map(); this.enemyShotT = new Map();
    this.gunnerPos = null; this.crewDanger = 0; this.counts = { events: 0, sounds: 0 };
    audio.expect(EXPECTED_NAMES);
  }
  setPlayer(id) { this.playerId = id; }
  _isPlayer(id) { return id === this.playerId; }
  _car(id) {
    let c = this.cars.get(id);
    if (!c) { c = { id, prevSpeed: 0, acc: 0, wasAir: false, airT: 0, lastLand: -9, fire: null, crackle: null, wreckUntil: 0, burning: false, seen: 0, engine: null, pos: [0, 0, 0] }; this.cars.set(id, c); }
    return c;
  }
  _play(name, o) { const h = this.audio.play(name, o); if (!h.isNull) this.counts.sounds++; return h; }

  // ------------------------------------------------------------------------------------------------ load
  /** Prioritised preload: UI + equipped weapons + player engine first, then impacts/explosions, then music/ambience, then everything. */
  preload({ weapons = ['pistol'], truck = 'truck_t1', enemies = ['e_sedan', 'e_buggy'] } = {}) {
    const A = this.audio, ps = [];
    ps.push(A.preload([/^ui\//], 0));
    ps.push(A.preload(weapons.map((w) => 'guns/fire_' + w), 0));
    for (const w of weapons) ps.push(A.preload((RELOAD[w] || []).map((r) => r[0]), 1));
    ps.push(A.preloadEngine(A.engineIdFor(VEHICLES[truck]), 0));
    ps.push(A.preload(['guns/fire_enemy_light', 'guns/fire_enemy_heavy', 'guns/dry_click', 'guns/weapon_swap', 'guns/shell_drop_brass', 'guns/shell_drop_shotgun', 'guns/rocket_loop', 'guns/grenade_pin', 'guns/grenade_throw', 'guns/grenade_bounce', 'impacts/hit_marker', 'impacts/bullet_metal', 'impacts/bullet_whizz'], 0));
    for (const e of enemies) ps.push(A.preloadEngine(A.engineIdFor(VEHICLES[e]), 1));
    // everything except engine stage loops (loaded per engine id) and the big ambience / music beds (loaded when their biome / state starts)
    ps.push(A.preload([/^impacts\//, /^explosions\//, /^vehicles\/(?!engine_.+_(idle|low|mid|high|redline)$)/], 1));
    ps.push(A.preload([/^stingers\//], 2));
    return Promise.all(ps);
  }
  /** Background-load everything except music (call after the first frame). */
  preloadAll() { return this.audio.preload([/^(?!music\/)/], 3); }
  /** Decode the music that is likely to be needed soon (run tracks + boss). */
  preloadMusic(kinds = ['run', 'boss']) { return this.audio.music.preload(kinds, 3); }

  // ------------------------------------------------------------------------------------------------ events
  handleEvent(e, ctx = {}) {
    if (ctx.playerId !== undefined) this.playerId = ctx.playerId;
    if (ctx.localRole) this.localRole = ctx.localRole;
    this.counts.events++;
    const A = this.audio;
    switch (e.t) {
      case 'spawn': case 'enemySpawn': { const sp = VEHICLES[e.spec]; if (sp) A.preloadEngine(A.engineIdFor(sp), 1); break; }
      case 'remove': this._removeCar(e.id); break;
      case 'shot': this._shot(e, ctx); break;
      case 'hit': this._impact(e.pos, e.surface, e); if (e.enemy && e.carId === this.playerId && (e.dmg || 0) >= 15) A.concussion(Math.min(0.3, e.dmg / 60)); break;
      case 'whizz': this._play('impacts/bullet_whizz', { pos: e.pos, gain: clamp(1.15 - (e.dist || 1) * 0.3, 0.45, 1), pitch: 0.92 + A.rand() * 0.2, refDist: 2.5 }); break;
      case 'crash': this._crash(e, ctx); break;
      case 'explode': this._explode(e, ctx); break;
      case 'boom': this._boom(e); break;
      case 'crewHit': this._crewHit(e, ctx); break;
      case 'crewDead': this._crewDead(e, ctx); break;
      case 'tirePop': this._tirePop(e, ctx); break;
      case 'engineDead': { const p = this._carPos(e.id, ctx); const en = A.engines.get(e.id); if (en) en.stall({ pos: p }); else this._play('vehicles/engine_stall', { pos: p, gain: 0.9 }); break; }
      case 'fuelLeak': this._play('explosions/fuel_ignite', { pos: this._carPos(e.id, ctx), gain: 0.8 }); break;
      case 'fire': { const c = this._car(e.id); c.burning = true; this._play('explosions/fuel_ignite', { pos: this._carPos(e.id, ctx), gain: 0.6, pitch: 1.1 }); break; }
      case 'smoke': break;
      case 'kill': if (this.localRole !== 'driver') this._play('impacts/hit_marker_kill', { gain: 0.8, pitchVar: 0.02 }); break;
      case 'playerDown': this._playerDown(e); break;
      case 'runOver': A.setDanger(0); break;
      case 'nitro': { const en = A.engines.get(e.id); if (!en) this._play(e.on === false ? 'vehicles/nitro_end' : 'vehicles/nitro_ignite', { pos: this._carPos(e.id, ctx) }); break; }
      case 'land': this._land(e.id, e.pos || this._carPos(e.id, ctx), e.impact ?? e.dv ?? e.vy ?? e.airTime ?? 0.6, ctx); break;
      case 'drift': break;
      // gunner-side (local) events
      case 'weaponSwap': this._cancelFoley(); this._foley('guns/weapon_swap', 0, ctx, { gain: 0.9 }); break;
      case 'reloadStart': this._reloadStart(e, ctx); break;
      case 'reloadEnd': if (e.weapon === 'shotgun') this._foley('guns/shotgun_pump', 0.02, ctx, { gain: 1 }); break;
      case 'shellIn': this._foley('guns/shotgun_shell_in', 0, ctx, { gain: 0.75 }); break;
      case 'dryClick': this._foley('guns/dry_click', 0, ctx, { gain: 1 }); break;
      case 'grenadeThrow': this._grenadeThrow(e, ctx); break;
      // optional driver gadgets
      case 'oilSlick': case 'oil': this._play('vehicles/oil_slick_splat', { pos: e.pos || this._carPos(e.id, ctx), gain: 0.9 }); break;
      case 'mineDrop': case 'mine': this._play('vehicles/mine_drop_beep', { pos: e.pos || this._carPos(e.id, ctx), gain: 0.8 }); break;
      case 'mineBoom': this._explosion(e.pos, 1, { names: ['vehicles/mine_explosion'], noDebris: false }); break;
      case 'horn': this._play('vehicles/horn', { pos: e.pos || this._carPos(e.id, ctx), variation: e.heavy ? 1 : 0, pitchVar: 0.02 }); break;
      default: break;
    }
  }

  _carPos(id, ctx) {
    const st = ctx?.states?.get?.(id);
    if (st) return [st.pos.x, st.pos.y + 0.6, st.pos.z];
    const c = this.cars.get(id);
    return c ? c.pos : undefined;
  }
  _own(o) { return this.audio.listener.distTo(o) < 3.5; }

  // ---- shots
  _shot(e, ctx) {
    const A = this.audio, o = e.origin;
    if (!o) return;
    const isPlayer = e.src === 'player', dist = A.listener.distTo(o);
    if (isPlayer) {
      const w = e.weapon, W = WEAPONS[w], own = dist < 3.5;
      this._play('guns/fire_' + w, { pos: own ? undefined : o, gain: 1, pitchVar: 0.04, slap: own ? 0.2 : undefined });
      if (e.rocket) this._rocket(o, e.dir, W?.rocket?.speed ?? 85, true);
      else this._shellDrops(w, W, o, own, ctx);
      this._rays(e.rays || [], w);
      return;
    }
    // enemy fire: throttle per source so a dozen guns cannot flood the voices; skip if hopelessly far
    if (dist > 320) return;
    const now = A.now, last = this.enemyShotT.get(e.src) || -9;
    if (e.rocket || e.weapon === 'rpg') {
      this._play('guns/fire_rpg', { pos: o, gain: 0.85, refDist: 14 });
      this._rocket(o, e.dir, e.speed || 60, false);
      return;
    }
    if (now - last < 0.05) return;
    this.enemyShotT.set(e.src, now);
    const heavy = (e.speed || 0) >= 190 || (e.pellets || 1) >= 5;
    this._play(heavy ? 'guns/fire_enemy_heavy' : 'guns/fire_enemy_light', { pos: o, gain: 1, pitch: heavy ? 0.92 : 1, pitchVar: 0.06 });
  }
  _shellDrops(w, W, o, own, ctx) {
    if (!W || w === 'revolver' || w === 'rpg') return;
    const A = this.audio, pos = own ? undefined : [o[0], o[1] - 0.6, o[2]];
    const drop = (name, delay, g = 0.9) => this._play(name, { pos, gain: g, delay, pitchVar: 0.06, refDist: 3 });
    if (w === 'shotgun') { this._foley('guns/shotgun_pump', 0.2, ctx, { gain: 0.9 }); drop('guns/shell_drop_shotgun', 0.62, 1); return; }
    if (w === 'sniper') { this._foley('guns/sniper_bolt_open', 0.3, ctx, { gain: 0.9 }); drop('guns/shell_drop_brass', 0.5, 1); this._foley('guns/sniper_bolt_close', 0.62, ctx, { gain: 0.9 }); return; }
    const rate = W.rpm / 60;
    if (A.rand() < clamp(5 / rate, 0.15, 1)) drop('guns/shell_drop_brass', 0.22 + A.rand() * 0.16, 0.8);
  }
  _rays(rays, weapon) {
    const A = this.audio;
    let hitCar = false, head = false, n = 0;
    const order = rays.map((_, i) => i);
    if (order.length > 5) for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(A.rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (const i of order) {
      const r = rays[i];
      if (r.carId !== undefined) { hitCar = true; if (/_head$/.test(r.zone || '')) head = true; }
      if (r.end && r.surface && n < 5) { if (this._impact(r.end, r.surface, { carId: r.carId, zone: r.zone, dmg: r.dmg })) n++; }
    }
    if (this.localRole !== 'driver' && hitCar) {
      this._play(head ? 'impacts/headshot_ping' : 'impacts/hit_marker', { gain: head ? 0.85 : 0.6, pitchVar: 0.03 });
    }
    void weapon;
  }
  /** Bullet impact by surface. Returns false when de-duplicated (a ray impact and its `hit` event describe the same spot). */
  _impact(p, surface, o = {}) {
    if (!p) return false;
    const A = this.audio, now = A.now, q = arr3(p);
    for (const r of this.recent) if (now - r.t < 0.15 && (r.p[0] - q[0]) ** 2 + (r.p[1] - q[1]) ** 2 + (r.p[2] - q[2]) ** 2 < 0.5) return false;
    this.recent.push({ p: q, t: now }); if (this.recent.length > 24) this.recent.shift();
    let name, gain = 0.85 + A.rand() * 0.3, extra = null;
    switch (surface) {
      case 'metal': case 'armor':
        if (surface === 'armor' || /armou?r|plate/.test(o.zone || '')) name = 'impacts/armor_hit';
        else name = o.carId === this.playerId ? 'vehicles/hit_car_body' : 'impacts/bullet_metal';
        if (A.rand() < 0.12) extra = ['impacts/ricochet', 0.02]; break;
      case 'flesh': name = 'impacts/bullet_flesh'; if (o.carId !== undefined) this.lastFlesh.set(o.carId, now); break;
      case 'glass': name = 'impacts/bullet_glass'; break;
      case 'tire': name = 'impacts/bullet_tire'; break;
      case 'rock': name = 'impacts/bullet_dirt'; gain *= 0.7; if (A.rand() < 0.45) extra = ['impacts/ricochet', 0.02]; break;
      case 'asphalt': case 'road': case 'concrete': name = 'impacts/bullet_asphalt'; if (A.rand() < 0.2) extra = ['impacts/ricochet', 0.02]; break;
      default: name = 'impacts/bullet_dirt';
    }
    this._play(name, { pos: q, gain });
    if (extra) this._play(extra[0], { pos: q, gain: 0.6, delay: extra[1] });
    return true;
  }

  // ---- rockets
  _rocket(o, dir, speed, own) {
    const A = this.audio;
    if (!dir) return;
    const d = arr3(dir), h = this._play('guns/rocket_loop', { pos: o, vel: [d[0] * 25, d[1] * 25, d[2] * 25], loop: true, gain: own ? 0.8 : 0.9, refDist: 12, pitchVar: 0.05, randomOffset: true, noCull: true });
    this.rockets.push({ h, p: arr3(o).slice(), d, speed, t: 0 });
    if (this.rockets.length > 8) { const r = this.rockets.shift(); r.h.stop(0.05); }
    void A;
  }
  _stopRocketNear(pos) {
    let bi = -1, bd = 45 * 45;
    for (let i = 0; i < this.rockets.length; i++) { const r = this.rockets[i]; const d = (r.p[0] - pos[0]) ** 2 + (r.p[1] - pos[1]) ** 2 + (r.p[2] - pos[2]) ** 2; if (d < bd) { bd = d; bi = i; } }
    if (bi < 0) return false;
    this.rockets[bi].h.stop(0.05); this.rockets.splice(bi, 1); return true;
  }

  // ---- crashes / explosions
  _crash(e, ctx) {
    const A = this.audio, now = A.now, dv = e.dv || 0, pos = e.pos;
    if (now - (this.lastCrash.get(e.id) ?? -9) < 0.12) return;
    this.lastCrash.set(e.id, now);
    const ram = (e.other ?? -1) >= 0, g = clamp(0.45 + dv / 14, 0.5, 1.15);
    if (dv < 2.5) this._play('impacts/car_crash_light', { pos, gain: g * 0.9 });
    else if (dv < 6) this._play(ram ? 'impacts/ram_hit' : 'impacts/car_crash_light', { pos, gain: g });
    else {
      this._play('impacts/car_crash_heavy', { pos, gain: g });
      if (ram && dv < 10) this._play('impacts/ram_hit', { pos, gain: 0.8, delay: 0.01 });
      if (dv >= 9) this._play('impacts/metal_tear', { pos, gain: 0.8, delay: 0.05 });
    }
    if (dv >= 5 && A.rand() < 0.5) this._play('impacts/glass_shatter', { pos, gain: 0.6, delay: 0.05 });
    if (!ram && dv >= 3) {
      this._play('impacts/car_scrape_hit', { pos, gain: 0.5, delay: 0.08 });
      // sliding along the wall / road for a moment after the hit (scaled by impact strength and speed)
      this._play('impacts/car_scrape_loop', { pos, loop: true, gain: clamp(0.3 + dv / 25, 0.3, 0.8), pitch: clamp(0.7 + (e.speed || 10) / 50, 0.8, 1.3), pitchVar: 0.05, duration: clamp(0.35 + dv * 0.09, 0.4, 1.3), fadeOut: 0.2, fadeIn: 0.04, delay: 0.12, randomOffset: true });
    }
    if (dv >= 7) {
      this._play('impacts/panel_detach', { pos, gain: 0.8, delay: 0.12 });
      for (let i = 0; i < 2; i++) this._play('impacts/debris_bounce', { pos: [pos[0] + (A.rand() - 0.5) * 6, pos[1], pos[2] + (A.rand() - 0.5) * 6], gain: 0.5, delay: 0.35 + i * 0.35 + A.rand() * 0.2 });
    }
    if (dv >= 12) this._play('impacts/wheel_off', { pos, gain: 0.8, delay: 0.15 });
    if (e.id === this.playerId && dv > 5) {
      A.concussion(clamp((dv - 5) / 14, 0.05, 0.7));
      A.duck(clamp(dv / 30, 0.15, 0.5), { hold: 0.25, release: 0.8 });
    }
    void ctx;
  }
  _explode(e, ctx) {
    const c = this._car(e.id); c.wreckUntil = this.audio.now + 14; c.burning = false;
    const en = this.audio.engines.get(e.id); if (en) en.kill(0.05);
    this._explosion(e.pos, e.size || 1, { own: e.id === this.playerId });
    void ctx;
  }
  _boom(e) {
    const A = this.audio, r = e.radius || 10;
    const tracked = this._stopRocketNear(arr3(e.pos));
    const grenade = e.kind === 'grenade' || (!tracked && r < 10.5);
    this._explosion(e.pos, clamp(r / 9.5, 0.6, 2), { names: [grenade ? 'explosions/grenade_explosion' : 'explosions/rocket_explosion'], layer: A.rand() < 0.7 ? 'explosions/explosion_small' : null });
  }
  /** size: 0.6 small, 1 medium (car), 1.8 large (heavy), 2.4+ huge (tanker). */
  _explosion(pos, size, o = {}) {
    const A = this.audio, p = arr3(pos), d = A.listener.distTo(p);
    const nm = size < 0.7 ? 'small' : size < 1.4 ? 'medium' : size < 2.2 ? 'large' : 'huge';
    const delay = d > 45 ? Math.min(d / 343, 1.4) : 0;
    const main = o.names ? o.names[0] : 'explosions/explosion_' + nm;
    this._play(main, { pos: p, gain: 1, delay, pitch: 1 + (A.rand() - 0.5) * 0.06, pitchVar: 0.03 });
    if (o.layer) this._play(o.layer, { pos: p, gain: 0.55, delay });
    if (d > 90) this._play('explosions/distant_explosion', { pos: p, gain: smoothstep(90, 220, d) * 0.95, delay: Math.min(d / 343, 1.7) + 0.05, refDist: 60, noCull: true });
    const sub = smoothstep(70, 6, d) * clamp(0.45 + 0.25 * size, 0.4, 1);
    if (sub > 0.02) this._play('explosions/shockwave_sub', { gain: sub, delay, pitchVar: 0.04 });
    A.duck(0.55 * (1 - smoothstep(20, 160, d)) + 0.1, { hold: 0.6, release: 1.3 });
    if (d < 28 || o.own) A.concussion(o.own ? 0.9 : clamp((1 - d / 28) * (0.5 + 0.35 * size), 0, 1));
    if (!o.noDebris) for (let i = 0; i < 3; i++) this._play('impacts/debris_bounce', { pos: [p[0] + (A.rand() - 0.5) * 14, p[1], p[2] + (A.rand() - 0.5) * 14], gain: 0.55, delay: delay + 0.5 + i * 0.4 + A.rand() * 0.5 });
  }

  // ---- crew
  _crewHit(e, ctx) {
    const A = this.audio, p = e.point || this._carPos(e.id, ctx);
    if (!p) return;
    if (A.now - (this.lastFlesh.get(e.id) ?? -9) < 0.2) return; // the impact event already made the thump
    this._play('impacts/bullet_flesh', { pos: p, gain: 0.8 });
  }
  _crewDead(e, ctx) {
    // no voices: only the body dropping onto the road / bed
    const p = this._carPos(e.id, ctx);
    if (p && e.cause !== 'explosion') this._play('impacts/bullet_flesh', { pos: p, gain: 0.55, pitch: 0.6, delay: 0.3 });
  }
  _tirePop(e, ctx) {
    const st = ctx?.states?.get?.(e.id); let p = this._carPos(e.id, ctx);
    if (st && st.spec.wheels[e.index]) { const w = st.spec.wheels[e.index], r = qRot(st.quat, w.x, 0.3, w.z); p = [st.pos.x + r[0], st.pos.y + r[1], st.pos.z + r[2]]; }
    this._play('impacts/bullet_tire', { pos: p, gain: 1, pitch: 0.9 });
  }
  _playerDown(e) {
    const A = this.audio;
    A.stinger('game_over'); A.setDanger(0); A.concussion(0.5);
    void e;
  }
  _land(id, pos, impact, ctx) {
    const A = this.audio, c = this._car(id), now = A.now;
    if (now - c.lastLand < 0.4) return; c.lastLand = now;
    const p = Array.isArray(pos) ? pos : this._carPos(id, ctx);
    const heavy = impact > 0.8;
    this._play(heavy ? 'vehicles/jump_land_heavy' : 'vehicles/suspension_thunk', { pos: p, gain: clamp(0.5 + impact * 0.5, 0.5, 1) });
  }

  // ---- gunner foley
  _foley(name, delay, ctx, o = {}) {
    const A = this.audio, st = ctx?.states?.get?.(this.playerId);
    const p = st ? [st.pos.x, st.pos.y + 1.1, st.pos.z] : this.gunnerPos;
    const pos = p && A.listener.distTo(p) > 3 ? p : undefined;
    const h = this._play(name, { pos, gain: o.gain ?? 0.9, pitch: o.pitch ?? 1, pitchVar: 0.03, delay, refDist: 3 });
    if (delay > 0.02) this.reloadH.push(h);
    if (this.reloadH.length > 24) this.reloadH.splice(0, this.reloadH.length - 24);
    return h;
  }
  _cancelFoley() { for (const h of this.reloadH) h.stop(0.02); this.reloadH.length = 0; }
  _reloadStart(e, ctx) {
    this._cancelFoley();
    const seq = RELOAD[e.weapon] || RELOAD.pistol, T = e.time || WEAPONS[e.weapon]?.reload || 2;
    for (const [name, f, o] of seq) this._foley(name, f * T, ctx, o || {});
  }
  _grenadeThrow(e, ctx) {
    const A = this.audio;
    this._foley('guns/grenade_pin', 0, ctx, { gain: 0.9 });
    this._foley('guns/grenade_throw', 0.22, ctx, { gain: 0.9 });
    if (!e.origin || !e.vel) return;
    // estimate the bounces from the ballistic arc (ground assumed ~2 m below the muzzle; the sim's real bounces are not events)
    const o = e.origin, v = e.vel, t1 = (v[1] + Math.sqrt(v[1] * v[1] + 2 * 9.81 * 2)) / 9.81;
    let t = t1, g = 0.9;
    for (let i = 0; i < 4 && t < 2.0; i++) {
      this._play('guns/grenade_bounce', { pos: [o[0] + v[0] * t, o[1] - 1.8, o[2] + v[2] * t], gain: g, delay: t, pitch: 1 - i * 0.05 });
      t += 0.32 / (1 + i * 0.6); g *= 0.6;
    }
    void A;
  }

  // ------------------------------------------------------------------------------------------------ per frame
  /**
   * Per car, per frame. Creates the car's EngineSound on first sight and feeds it from the CarState.
   * extra: { surface: 'asphalt'|'dirt'|'sand'|'gravel'..., throttle?: 0..1 (else estimated from acceleration) }
   */
  updateCar(st, dt = 1 / 60, extra = {}) {
    const A = this.audio, c = this._car(st.id), now = A.now;
    if (dt && typeof dt === 'object') { const eh = dt; dt = A.dt || 1 / 60; if (!c.engine) c.engine = eh; } // API.md form: updateCar(state, engineHandle)
    c.seen = now; c.pos[0] = st.pos.x; c.pos[1] = st.pos.y + 0.6; c.pos[2] = st.pos.z;
    const player = st.id === this.playerId || (this.playerId < 0 && st.kind === 'player');
    if (player) { this.gunnerPos = [st.pos.x, st.pos.y + 1.1, st.pos.z]; }
    this._fireLoops(st, c, player);
    if (st.exploded) { if (c.engine && !c.engine.killed) c.engine.kill(0.05); return; }
    let en = c.engine;
    if (!en || en.disposed) { en = c.engine = A.engine(st.id, st.spec, { player }); }
    en.seen = now;
    // load estimate: CarState has no throttle, so infer it from acceleration / speed / braking
    const vmax = st.spec?.engine?.vmax || 50;
    const acc = (st.speed - c.prevSpeed) / Math.max(dt, 1e-3); c.prevSpeed = st.speed;
    c.acc += (acc - c.acc) * (1 - Math.exp(-6 * dt));
    let load = extra.throttle ?? clamp01(0.3 + c.acc / 3.5);
    load = Math.max(load, smoothstep(0.75, 0.97, st.speed / vmax) * 0.75);
    if (st.boosting) load = 1;
    if (st.braking && extra.throttle === undefined) load *= 0.2;
    let slip = 0, gr = 0; const n = st.nWheels || st.grounded.length;
    for (let i = 0; i < n; i++) { if (st.grounded[i]) { gr++; if (st.slip[i] > slip) slip = st.slip[i]; } }
    const grounded = n ? gr / n : 1;
    const dist = player ? 0 : A.listener.distTo(st.pos);
    const ex = c.ex || (c.ex = {});
    ex.pos = st.pos; ex.vel = st.vel; ex.slip = slip; ex.surface = extra.surface; ex.grounded = grounded; ex.braking = st.braking;
    ex.engineHp01 = st.engineHp01; ex.airborne = st.airborne;
    const L = (st.spec?.length || 5) * 0.5, r = qRot(st.quat, 0.25, 0.3, -L);
    ex.exhaustPos = [st.pos.x + r[0], st.pos.y + r[1], st.pos.z + r[2]];
    en.update(st.rpm01, load, st.boosting ? 1 : 0, dist, st.speed, ex);
    // landing thump
    if (st.airborne) { c.airT += dt; c.wasAir = true; } else { if (c.wasAir && c.airT > 0.3) this._land(st.id, c.pos, clamp(c.airT - 0.2, 0.2, 1.6), null); c.wasAir = false; c.airT = 0; }
    if (player) {
      A.ambience.wind(clamp01(st.speed / vmax) * (st.boosting ? 1.15 : 1) * (st.airborne ? 0.8 : 1));
      if (this.autoDanger) A.setDanger(st.exploded ? 0 : Math.max(smoothstep(0.35, 0.05, st.hp01), this.crewDanger));
    }
  }
  _fireLoops(st, c, player) {
    const A = this.audio, now = A.now;
    const burning = st.burning || c.burning || (st.exploded && now < c.wreckUntil);
    const near = A.listener.distTo(st.pos) < 140;
    if (burning && near && !c.fire) {
      const o = { pos: st.pos, vel: st.vel, loop: true, refDist: 6, randomOffset: true, pitchVar: 0.08 };
      c.fire = this._play('explosions/fire_loop', { ...o, gain: 0.85 });
      c.crackle = this._play('explosions/fire_crackle_loop', { ...o, gain: 0.5, refDist: 5 });
    } else if ((!burning || !near) && c.fire) { c.fire.stop(0.8); c.crackle?.stop(0.8); c.fire = c.crackle = null; }
    else if (c.fire) { c.fire.setPos(st.pos, st.vel); c.crackle?.setPos(st.pos, st.vel); }
    if (st.exploded && now >= c.wreckUntil && c.wreckUntil > 0) c.burning = false;
    void player;
  }
  /** Per frame, once: rocket flight loops, housekeeping of cars that vanished. */
  update(dt, ctx = {}) {
    const A = this.audio, now = A.now;
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i]; r.t += dt;
      const sp = Math.min(r.speed, 25 + r.speed * 1.6 * r.t);
      r.p[0] += r.d[0] * sp * dt; r.p[1] += r.d[1] * sp * dt; r.p[2] += r.d[2] * sp * dt;
      if (r.h.isNull || r.t > 4.5 || !r.h.playing) { r.h.stop(0.05); this.rockets.splice(i, 1); continue; }
      r.h.setPos(r.p, [r.d[0] * sp, r.d[1] * sp, r.d[2] * sp]);
    }
    for (const [id, c] of this.cars) {
      if (now - c.seen > 1.0) { this._removeCar(id); continue; }
    }
    for (const [k, t] of this.lastCrash) if (now - t > 5) this.lastCrash.delete(k);
    void ctx;
  }
  _removeCar(id) {
    const c = this.cars.get(id); if (!c) return;
    if (c.engine) c.engine.dispose(0.2);
    if (c.fire) { c.fire.stop(0.5); c.crackle?.stop(0.5); }
    this.cars.delete(id); this.lastCrash.delete(id); this.lastFlesh.delete(id); this.enemyShotT.delete(id);
  }
  /** New run / back to the garage: drop every car sound. */
  reset() { for (const id of [...this.cars.keys()]) this._removeCar(id); for (const r of this.rockets) r.h.stop(0.05); this.rockets.length = 0; this._cancelFoley(); this.audio.setDanger(0); }

  // ------------------------------------------------------------------------------------------------ run flow helpers
  runStart() { const A = this.audio; A.stinger('run_start'); A.music.setState('run'); A.music.setIntensity(0.1); }
  bossIntro() { const A = this.audio; A.stinger('boss_intro'); A.music.setState('boss'); A.music.setIntensity(0.7); }
  bossDefeated() { const A = this.audio; A.stinger('boss_defeated'); A.music.setIntensity(0.3); }
  victory() { const A = this.audio; A.stinger('victory'); A.music.setState('victory'); }
  /** Ignition sound (garage -> countdown). */
  engineStart() { this._play('vehicles/engine_start', { gain: 0.8, pitchVar: 0.01 }); }
  /** Optional: the local crew's health (0..1 each) drives the heartbeat / alarm as well as the car's HP. */
  setCrewHp01(driver01 = 1, gunner01 = 1) { this.crewDanger = smoothstep(0.4, 0.08, Math.min(driver01, gunner01)); }
}
