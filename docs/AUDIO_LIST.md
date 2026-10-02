# RIDE OR DIE - audio library

Generated SFX and ambience use `tools/audio` (Python synthesis + CC0 Kenney / rubberduck sample layers), encoded Ogg Vorbis. The active soundtrack uses twelve owner-created Suno MP3 full mixes from Covenant: Ashfall.
180 sound entries, 262 unique registered audio files; 295 physical OGG/MP3 files including rollback assets, 77.9 MB. Machine-readable index: `public/audio/manifest.json` (rebuilt by `tools/audio/manifest.py`).

## Loudness / usage conventions
- **Generated OGG peak**: generated decoded files target at or below -1 dBFS, no clipping, no DC. One-shots are peak-normalised (about -1.5 dBFS); loops (engines, tyres, wind, ambience, alerts) are normalised by integrated LUFS (K-weighted) so they can be crossfaded / layered.
- **`gain`** in the manifest is a linear multiplier <= 1.0 that balances loudness inside each category (variations of one sound are already matched to each other in the files) and gives sensible cross-category defaults (explosions/guns loud, foley/UI/ambience lower). Multiply by your bus volume (SFX bus ~0.8, engine bus ~0.6, ambience ~0.5, music ~0.4-0.5 (music full mixes are mastered at about -14 LUFS) are good starting points).
- **Variations**: `files[]` lists variation files (`name_1.ogg`, `name_2.ogg` ...). Pick randomly, never the same twice in a row, and add +-`pitchRange` playbackRate jitter. Multi-variation sets were loudness-matched (+-0.2 LU).
- **Generated OGG loops** have `loop: true`, `loopStart: 0`, `loopEnd: duration`. They are exact-length seamless loops (built from periodic noise / integer engine cycles; wrap step checked against the interior step distribution in `tools/audio/qa_all.py`). Use `AudioBufferSourceNode.loop = true`.
- **Mono** for positional SFX (feed into PannerNode), **stereo** for ambience, music, stingers.
- Rendering is deterministic (seeded). Rebuild: `cd tools/audio && venv/Scripts/python.exe build.py <guns|impacts|explosions|vehicles|ui|stingers|ambience|music> [name-prefix ...]`, then `manifest.py` (index) and `docs_gen.py` (this file). QA: `qa_all.py` (peaks/DC/seams), `qa_engines.py` (fire frequencies per RPM), `qa_sat.py`, `node tools/audio/browser_check.mjs` (real Chrome decode), `viz.py <group> <names>` (spectrogram sheets in `tools/audio/sheets/`), `tools/audio/audition.html` (browser audition page with engine simulator + music stem mixer; open via the dev server at `/tools/audio/audition.html`). CC0 sample layers are read from `C:/Dev/sfx_src` (see `samples.py`).

- **Historical synthesized-music headroom check** (`tools/audio/mix_sim.py`, not proof for the imported songs): a dense 12 s combat scene (LMG burst + 2 raider guns + 9 bullet impacts/s + near-misses + engine t3 + tyres/wind at 130 km/h + 2 explosions + heavy crash + run_a music + desert ambience) with the manifest gains and buses SFX 0.8 / engine 0.6 / ambience 0.5 / music 0.45 peaks at about -1.8 dBFS (-16 LUFS integrated) with no master limiter, so you can add a gentle DynamicsCompressor on the master without pumping.

### Engine stages (vehicles/engine_*)
Each engine has 5 seamless loops recorded at a fixed RPM (`idle, low, mid, high, redline`). Keep 1-2 stages playing at once: crossfade the two neighbouring stages with equal-power gains by RPM, and set `playbackRate = currentRPM / stageRPM` (stay within 0.75-1.35 of each stage's nominal). `fireHz` is the cylinder-firing frequency at the nominal RPM (engine fundamental, verified by spectrum analysis in `qa_engines.py`). Layer `turbo_whine_loop` / `supercharger_whine_loop` (reference pitch 3.3 kHz / 1.5 kHz, playbackRate 0.5-1.6, gain rising with boost/RPM) on t4 / boss; `damaged_engine_loop` overlays at low HP.

| engine | character | cyl | RPM idle / low / mid / high / redline | fire Hz (same order) | files |
|---|---|---|---|---|---|
| `engine_boss` | huge turbo-diesel V12 (boss war rig), menacing | 12 | 520 / 900 / 1400 / 1900 / 2500 | 52 / 90 / 140 / 190 / 250 | `vehicles/engine_boss_{idle,low,mid,high,redline}.ogg` (~2.3 s each) |
| `engine_buggy` | raspy air-cooled 4-cylinder / buzzy two-stroke style | 4 | 1100 / 2600 / 4200 / 5800 / 7400 | 36.67 / 86.67 / 140 / 193.33 / 246.67 | `vehicles/engine_buggy_{idle,low,mid,high,redline}.ogg` (~2.4 s each) |
| `engine_diesel` | heavy diesel (trucks, vans, tankers) | 6 | 600 / 1000 / 1500 / 2000 / 2600 | 30 / 50 / 75 / 100 / 130 | `vehicles/engine_diesel_{idle,low,mid,high,redline}.ogg` (~2.4 s each) |
| `engine_muscle` | loud V8 with lopey idle | 8 | 650 / 1900 / 3300 / 5000 / 6300 | 43.33 / 126.67 / 220 / 333.33 / 420 | `vehicles/engine_muscle_{idle,low,mid,high,redline}.ogg` (~2.4 s each) |
| `engine_player_t1` | tired rattly 4-cylinder (starter truck) | 4 | 900 / 2200 / 3600 / 5200 / 6500 | 30 / 73.33 / 120 / 173.33 / 216.67 | `vehicles/engine_player_t1_{idle,low,mid,high,redline}.ogg` (~2.4 s each) |
| `engine_player_t2` | rough V8 | 8 | 750 / 2000 / 3400 / 5000 / 6200 | 50 / 133.33 / 226.67 / 333.33 / 413.33 | `vehicles/engine_player_t2_{idle,low,mid,high,redline}.ogg` (~2.4 s each) |
| `engine_player_t3` | big growly V8 | 8 | 700 / 1900 / 3300 / 4900 / 6000 | 46.67 / 126.67 / 220 / 326.67 / 400 | `vehicles/engine_player_t3_{idle,low,mid,high,redline}.ogg` (~2.4 s each) |
| `engine_player_t4` | supercharged V8 with gear/blower whine | 8 | 750 / 2200 / 3800 / 5500 / 6800 | 50 / 146.67 / 253.33 / 366.67 / 453.33 | `vehicles/engine_player_t4_{idle,low,mid,high,redline}.ogg` (~2.4 s each) |
| `engine_sedan` | thin inline-6 (sedan raiders) | 6 | 850 / 2100 / 3500 / 5100 / 6400 | 42.5 / 105 / 175 / 255 / 320 | `vehicles/engine_sedan_{idle,low,mid,high,redline}.ogg` (~2.4 s each) |

Reference mixing code (WebAudio):
```js
// stages = manifest.engines[name].stages  (sorted idle..redline), one looping AudioBufferSourceNode + GainNode per stage
function updateEngine(rpm, throttle) {
  let i = stages.findIndex(s => s.rpm > rpm); i = i < 0 ? stages.length - 1 : Math.max(0, i - 1);   // lower neighbour
  const a = stages[i], b = stages[Math.min(i + 1, stages.length - 1)];
  const t = a === b ? 0 : Math.min(1, Math.max(0, (rpm - a.rpm) / (b.rpm - a.rpm)));
  ga.gain.value = Math.cos(t * Math.PI / 2) * vol;  gb.gain.value = Math.sin(t * Math.PI / 2) * vol;   // equal power
  srcA.playbackRate.value = rpm / a.rpm;  srcB.playbackRate.value = rpm / b.rpm;                     // 0.75-1.35 stays natural
}
```

### Suggested pitch (playbackRate) ranges
| category | range |
|---|---|
| gun_fire | 0.95 - 1.05 |
| gun_enemy | 0.90 - 1.10 |
| gun_foley | 0.96 - 1.04 |
| gun_loop | 0.90 - 1.20 |
| impact_bullet | 0.92 - 1.08 |
| impact_ui | 1.00 - 1.00 |
| impact_car | 0.90 - 1.10 |
| impact_loop | 0.80 - 1.30 |
| explosion | 0.90 - 1.10 |
| explosion_loop | 0.90 - 1.10 |
| engine | 0.75 - 1.35 |
| vehicle_loop | 0.70 - 1.60 |
| vehicle_fx | 0.94 - 1.06 |
| ui | 0.98 - 1.02 |
| stinger | 1.00 - 1.00 |
| stinger_loop | 0.90 - 1.40 |
| ambience | 1.00 - 1.00 |
| music | 1.00 - 1.00 |
| music_stem | 1.00 - 1.00 |

## Event -> sound cheat sheet
| game event | sounds |
|---|---|
| gunner fires weapon X | `guns/fire_<pistol|revolver|smg|shotgun|rifle|lmg|sniper|rpg>` (random variation, pitch +-5 %), shell: `guns/shell_drop_brass` (SMG/rifle/LMG/pistol) or `shell_drop_shotgun`; RPG flight: `guns/rocket_loop` on the projectile |
| empty mag / reload | `guns/dry_click`; reload: `<family>_mag_out` -> `_mag_in` -> `_slide/_bolt`; shotgun: `shotgun_shell_in` xN then `shotgun_pump`; LMG: `lmg_cover_open` -> `lmg_belt_in` -> `lmg_cover_close` -> `lmg_rack`; sniper: `sniper_bolt_open` / `sniper_mag` / `sniper_bolt_close`; RPG: `rpg_reload` |
| weapon swap / grenade | `guns/weapon_swap`; `grenade_pin` -> `grenade_throw` -> `grenade_bounce` (per bounce) -> `explosions/grenade_explosion` |
| raider fires | `guns/fire_enemy_light` (drivers / SMG raiders) and `fire_enemy_heavy` (heavies / bosses), 3D positional |
| bullet hits enemy car / prop | `impacts/bullet_metal` (body), `bullet_glass` (windows), `bullet_tire` (+ swerve), `bullet_dirt` / `bullet_asphalt` (misses), `ricochet`, `armor_hit` (armored raider), `bullet_flesh` (driver/gunner hit) |
| bullet passes the player | `impacts/bullet_whizz` (pan / doppler from the projectile), on the player truck `vehicles/hit_car_body`; on player armor `armor_hit` |
| hit feedback (HUD) | `impacts/hit_marker`, `hit_marker_kill`, `headshot_ping` (2D, not spatialised) |
| car crash / ram / rollover | `impacts/car_crash_light|heavy`, `ram_hit`, `car_scrape_hit` then `car_scrape_loop` while sliding, `panel_detach`, `metal_tear`, `glass_shatter`, `debris_bounce`, `wheel_off` |
| car explodes | size by class: `explosions/explosion_small|medium|large|huge` + `shockwave_sub` layer + `fuel_ignite` first; wreck: `fire_loop` (3D loop) and `fire_crackle_loop`; far away: `distant_explosion` |
| driving | `vehicles/engine_*` stage loops (see above), `tyre_asphalt_loop` / `tyre_dirt_loop`, `wind_loop` scaled by speed, `skid_loop` / `skid_gravel_loop` on slip, `suspension_thunk` / `jump_land_heavy` on landing, `gear_shift`, `backfire` |
| nitro | `vehicles/nitro_ignite` -> `nitro_loop` -> `nitro_end`; forced induction layers `turbo_whine_loop` / `supercharger_whine_loop` |
| driver items | `vehicles/oil_slick_splat`, `mine_drop_beep`, `mine_explosion`, `horn`, `brake_squeal` |
| low HP | `vehicles/damaged_engine_loop` (engine), `stingers/low_health_heartbeat_loop` (gunner low HP), `stingers/warning_alarm_loop` |
| start / die | `vehicles/engine_start` on ignition, `stingers/run_start`; car destroyed `stingers/game_over`, stalling `vehicles/engine_stall` |
| boss | `stingers/boss_intro`, music `boss_*` stems, `explosions/explosion_huge` on kill then `stingers/boss_defeated` / `victory` (+ `music/victory`) |
| garage UI | `ui/click`, `hover`, `buy`, `error`, `coin`, `upgrade_unlock`, `ready`, `menu_open` / `menu_close`, `whoosh_transition`; countdown `countdown_beep` x3 then `go` |
| biome ambience | desert `desert_wind_loop`, canyon `canyon_wind_loop`, coast `coast_waves_loop`, pines `forest_wind_loop`, ruins `city_ruins_loop`, dam `dam_rumble_loop` (crossfade 2-3 s between biomes) |

## MUSIC details

Twelve owner-created Suno full mixes from Covenant: Ashfall replace the active synthesized soundtrack. Original MP3 bytes and embedded metadata are preserved. `musicRoutes` selects one full mix per level, three boss tiers, title, garage and victory. Current and outgoing cues use a 1.2-second crossfade through the music/master buses after playback starts; no invented BPM/bar timing or additive full-song stems. Browser media streams avoid full-song AudioBuffer caching. Song loops use native MP3 looping and are not guaranteed seamless.

All twelve masters were measured with FFmpeg EBU R128. Manifest attenuation targets -16 LUFS with <= -1 dBTP before bus gain; no source files were amplified or re-encoded. This is a soundtrack measurement, not a new whole-combat mix loudness claim.

| Cue | Place | Track | Gain |
|---|---|---|---|
| music/run_suno_01 | desert | Mudstep Ruins | 0.691831 |
| music/run_suno_02 | canyon | Bongo Madness | 0.74131 |
| music/run_suno_03 | coast | Midnight in Kingston | 0.749894 |
| music/run_suno_04 | mountain | Reel Tape Orbit | 0.767361 |
| music/run_suno_05 | city | Concrete Jungle Vibes | 0.724436 |
| music/run_suno_06 | dam | Circuit Lattice | 0.653131 |
| music/run_suno_07 | underground | Subbass Ritual | 0.707946 |
| music/run_suno_08 | sky | Amen Drift | 0.732825 |
| music/run_suno_09 | hell | Chrono Trigger | 0.812831 |
| music/run_suno_10 | space | Amen Spiral | 0.724436 |
| music/boss_suno_early | boss | Ghoul Shredder | 0.776247 |
| music/boss_suno_mid | boss | Chrono Trigger | 0.812831 |
| music/boss_suno_late | boss | Final Riff | 0.691831 |
| music/title_suno | title | Reel Tape Orbit | 0.767361 |
| music/garage_suno | garage | Midnight in Kingston | 0.749894 |
| music/victory_suno | victory | Final Riff | 0.691831 |

Machine-readable track hashes, original names and measurements: `public/audio/music/suno/catalog.json`. Regeneration preserves `tools/audio/suno_soundtrack.json`.

## Loop points (all loops are exact-length: loopStart = 0, loopEnd = file length)
Engine stage loops are listed in the engine table above (2.3-2.45 s each, integer number of engine cycles).

| loop | length (s) | length (samples @44.1k) | channels | notes |
|---|---|---|---|---|
| `ambience/canyon_wind_loop` | 24.000 | 1058400 | 2 | hollow canyon wind: moving formant resonances + long echo, seamless 24 s stereo loop |
| `ambience/city_ruins_loop` | 24.000 | 1058400 | 2 | ruined city: thin wind, structure howl, distant creaks and debris ticks, seamless 24 s ste |
| `ambience/coast_waves_loop` | 24.000 | 1058400 | 2 | surf: three irregular waves rolling in and washing out over distant surf, seamless 24 s st |
| `ambience/dam_rumble_loop` | 24.000 | 1058400 | 2 | boss arena at the dam: deep water thunder + turbine hum + spray, seamless 24 s stereo loop |
| `ambience/desert_wind_loop` | 24.000 | 1058400 | 2 | open desert wind: broad gusts + sand hiss + faint whistles, seamless 24 s stereo loop |
| `ambience/forest_wind_loop` | 24.000 | 1058400 | 2 | wind through pines: swishing gusts + leaf rustle sparkle, seamless 24 s stereo loop |
| `explosions/fire_crackle_loop` | 3.200 | 141120 | 1 | crackling flames (quieter, more snaps), seamless 3.2 s loop |
| `explosions/fire_loop` | 2.400 | 105840 | 1 | burning car: roar + crackle, seamless 2.4 s loop (3D loop on wrecks) |
| `guns/rocket_loop` | 1.600 | 70560 | 1 | rocket motor flight loop, 1.6 s seamless; scale gain with distance, pitch 0.9-1.15 (dopple |
| `impacts/car_scrape_loop` | 1.600 | 70560 | 1 | metal scraping on asphalt, seamless 1.6 s loop; gain by slide speed, pitch 0.8-1.3 |
| `stingers/low_health_heartbeat_loop` | 2.000 | 88200 | 2 | heartbeat lub-dub-lub-dub at 60 BPM (2 beats, slight variation), seamless 2 s loop; loop w |
| `stingers/warning_alarm_loop` | 1.200 | 52920 | 2 | two-tone electronic warning siren (960/720 Hz), seamless 1.2 s loop |
| `vehicles/damaged_engine_loop` | 2.454 | 108243 | 1 | dying engine: misfires, rod knock, steam hiss; overlay on engine when HP low; seamless 2.4 |
| `vehicles/nitro_loop` | 1.600 | 70560 | 1 | nitro burn: flame roar + turbine whistle, seamless 1.6 s loop |
| `vehicles/skid_gravel_loop` | 1.600 | 70560 | 1 | sliding on gravel / dirt: spray hiss + stone crackle, seamless 1.6 s loop |
| `vehicles/skid_loop` | 1.600 | 70560 | 1 | tyre squeal on asphalt (drift), seamless 1.6 s loop; gain by slip, pitch 0.85-1.25 |
| `vehicles/supercharger_whine_loop` | 1.500 | 66150 | 1 | roots-blower / gear whine, reference 1.5 kHz; playbackRate follows rpm (0.5-1.5) |
| `vehicles/turbo_whine_loop` | 1.500 | 66150 | 1 | turbine whistle, reference 3.3 kHz; playbackRate 0.5-1.6 with boost / rpm; layer with engi |
| `vehicles/tyre_asphalt_loop` | 2.000 | 88200 | 1 | road roar on asphalt; volume ~ speed^1, pitch 0.7-1.6 with speed; seamless 2 s loop |
| `vehicles/tyre_dirt_loop` | 2.000 | 88200 | 1 | tyres on dirt / gravel road: rumble + stone rattle; pitch 0.7-1.5 with speed; 2 s loop |
| `vehicles/wind_loop` | 2.500 | 110250 | 1 | wind rush around the truck; volume ~ speed^1.5, pitch 0.7-1.6; 2.5 s loop |

## Browser decoding notes
- Verified with `node tools/audio/browser_check.mjs` (headless Chrome `decodeAudioData`): all files decode at 44.1 kHz with the exact expected length (loops within +-3 samples), peaks <= -1 dBFS and seamless wrap steps. Chrome may drop up to ~128 trailing samples of very short Vorbis files; every one-shot therefore ends with >= 128 samples of digital silence, and all loops are >= 1.2 s where this does not occur.
- Use `loopStart = 0`, `loopEnd = buffer.duration` (do not add crossfades; the loops are already continuous).

## GUNS - fire, reloads, grenades, shells

| sound | var | dur (s) | type | gain | pitch | category | notes |
|---|---|---|---|---|---|---|---|
| `guns/dry_click` | 1 | 0.13 | one-shot | 0.25 | 0.96-1.04 | gun_foley | empty-chamber hammer click |
| `guns/fire_enemy_heavy` | 3 | 1.29-1.32 | one-shot | 0.28 | 0.90-1.10 | gun_enemy | raider heavy gun / shotgun (distant, chunky); positional |
| `guns/fire_enemy_light` | 3 | 0.71-0.72 | one-shot | 0.27 | 0.90-1.10 | gun_enemy | raider light gun (distant, flatter, midrangey); positional |
| `guns/fire_lmg` | 4 | 0.70-0.74 | one-shot | 0.52 | 0.95-1.05 | gun_fire | lmg shot with baked outdoor tail (slapback echoes) |
| `guns/fire_pistol` | 3 | 0.51-0.55 | one-shot | 0.40 | 0.95-1.05 | gun_fire | pistol shot with baked outdoor tail (slapback echoes) |
| `guns/fire_revolver` | 3 | 1.05-1.08 | one-shot | 0.46 | 0.95-1.05 | gun_fire | revolver shot with baked outdoor tail (slapback echoes) |
| `guns/fire_rifle` | 4 | 1.26-1.34 | one-shot | 0.43 | 0.95-1.05 | gun_fire | rifle shot with baked outdoor tail (slapback echoes) |
| `guns/fire_rpg` | 2 | 3.26-3.27 | one-shot | 0.35 | 0.95-1.05 | gun_fire | launch: tube pop + ignition whoosh + backblast thump |
| `guns/fire_shotgun` | 3 | 1.60-1.73 | one-shot | 0.43 | 0.95-1.05 | gun_fire | shotgun shot with baked outdoor tail (slapback echoes) |
| `guns/fire_smg` | 4 | 0.34-0.34 | one-shot | 0.48 | 0.95-1.05 | gun_fire | smg shot with baked outdoor tail (slapback echoes) |
| `guns/fire_sniper` | 2 | 2.85-2.97 | one-shot | 0.51 | 0.95-1.05 | gun_fire | sniper shot with baked outdoor tail (slapback echoes) |
| `guns/grenade_bounce` | 3 | 0.55 | one-shot | 0.20 | 0.96-1.04 | gun_foley | metal grenade bouncing on asphalt |
| `guns/grenade_pin` | 1 | 0.50 | one-shot | 0.24 | 0.96-1.04 | gun_foley | pin pull + spoon flick |
| `guns/grenade_throw` | 1 | 0.40 | one-shot | 0.10 | 0.96-1.04 | gun_foley | arm swing / release whoosh |
| `guns/lmg_belt_in` | 1 | 0.68 | one-shot | 0.14 | 0.96-1.04 | gun_foley | ammo belt laid in (LMG) |
| `guns/lmg_cover_close` | 1 | 0.60 | one-shot | 0.25 | 0.96-1.04 | gun_foley | feed cover slams shut (LMG) |
| `guns/lmg_cover_open` | 1 | 0.70 | one-shot | 0.29 | 0.96-1.04 | gun_foley | feed cover lifts open (LMG) |
| `guns/lmg_rack` | 1 | 0.80 | one-shot | 0.27 | 0.96-1.04 | gun_foley | charging handle rack (LMG) |
| `guns/pistol_mag_in` | 1 | 0.44 | one-shot | 0.22 | 0.96-1.04 | gun_foley | magazine insert + seat (pistol) |
| `guns/pistol_mag_out` | 1 | 0.40 | one-shot | 0.17 | 0.96-1.04 | gun_foley | magazine release + drop (pistol) |
| `guns/pistol_slide` | 1 | 0.46 | one-shot | 0.25 | 0.96-1.04 | gun_foley | slide rack (pistol) |
| `guns/rifle_bolt` | 1 | 0.54 | one-shot | 0.23 | 0.96-1.04 | gun_foley | bolt cycle (rifle) |
| `guns/rifle_mag_in` | 1 | 0.44 | one-shot | 0.17 | 0.96-1.04 | gun_foley | magazine in (rifle) |
| `guns/rifle_mag_out` | 1 | 0.40 | one-shot | 0.17 | 0.96-1.04 | gun_foley | magazine out (rifle) |
| `guns/rocket_loop` | 1 | 1.60 | LOOP | 0.76 | 0.90-1.15 | gun_loop | rocket motor flight loop, 1.6 s seamless; scale gain with distance, pitch 0.9-1.15 (doppler) |
| `guns/rpg_reload` | 1 | 1.15 | one-shot | 0.40 | 0.96-1.04 | gun_foley | rocket slid into launcher and locked (RPG) |
| `guns/shell_drop_brass` | 4 | 0.50 | one-shot | 0.06 | 0.96-1.04 | gun_foley | ejected brass casing hitting asphalt (3-4 bounces) |
| `guns/shell_drop_shotgun` | 3 | 0.55 | one-shot | 0.10 | 0.96-1.04 | gun_foley | ejected shotgun hull (plastic, 3 bounces) |
| `guns/shotgun_pump` | 1 | 0.75 | one-shot | 0.24 | 0.96-1.04 | gun_foley | pump-action slide forward/back (shotgun) |
| `guns/shotgun_shell_in` | 4 | 0.22 | one-shot | 0.20 | 0.96-1.04 | gun_foley | shell into tube magazine |
| `guns/smg_bolt` | 1 | 0.51 | one-shot | 0.24 | 0.96-1.04 | gun_foley | charging handle (SMG) |
| `guns/smg_mag_in` | 1 | 0.44 | one-shot | 0.27 | 0.96-1.04 | gun_foley | magazine in (SMG) |
| `guns/smg_mag_out` | 1 | 0.40 | one-shot | 0.19 | 0.96-1.04 | gun_foley | magazine out (SMG) |
| `guns/sniper_bolt_close` | 1 | 0.55 | one-shot | 0.31 | 0.96-1.04 | gun_foley | bolt pushed forward and locked (sniper) |
| `guns/sniper_bolt_open` | 1 | 0.50 | one-shot | 0.28 | 0.96-1.04 | gun_foley | bolt lifted and drawn back (sniper) |
| `guns/sniper_mag` | 1 | 0.38 | one-shot | 0.12 | 0.96-1.04 | gun_foley | magazine seated (sniper) |
| `guns/weapon_swap` | 2 | 0.40 | one-shot | 0.17 | 0.96-1.04 | gun_foley | holster / draw: cloth rustle + strap + click |

## IMPACTS - bullets, near-misses, hit feedback, car damage

| sound | var | dur (s) | type | gain | pitch | category | notes |
|---|---|---|---|---|---|---|---|
| `impacts/armor_hit` | 3 | 0.42 | one-shot | 0.32 | 0.92-1.08 | impact_bullet | hit on body armor / armour plate: clank + thud |
| `impacts/bullet_asphalt` | 3 | 0.25 | one-shot | 0.36 | 0.92-1.08 | impact_bullet | bullet on road: sharp tck + dust puff + gravel scatter |
| `impacts/bullet_dirt` | 3 | 0.30 | one-shot | 0.22 | 0.92-1.08 | impact_bullet | bullet into dirt/sand: soft thud + spray |
| `impacts/bullet_flesh` | 3 | 0.22 | one-shot | 0.27 | 0.92-1.08 | impact_bullet | dull body thud (non-graphic): low thump + soft slap |
| `impacts/bullet_glass` | 3 | 0.50 | one-shot | 0.42 | 0.92-1.08 | impact_bullet | bullet through glass: crack + ting + falling shards |
| `impacts/bullet_metal` | 5 | 0.27 | one-shot | 0.67 | 0.92-1.08 | impact_bullet | bullet on car body / plate: tick + plate modes + dent; frequent, short |
| `impacts/bullet_tire` | 1 | 1.50 | one-shot | 0.29 | 0.92-1.08 | impact_bullet | tyre puncture: pop + long air hiss + flap |
| `impacts/bullet_whizz` | 5 | 0.50 | one-shot | 0.33 | 0.92-1.08 | impact_bullet | supersonic near-miss flyby with downward pitch glide (doppler) |
| `impacts/car_crash_heavy` | 3 | 1.84-1.92 | one-shot | 0.54 | 0.90-1.10 | impact_car | heavy crash: sub boom + crush + debris, ~1.9 s |
| `impacts/car_crash_light` | 3 | 0.96-1.08 | one-shot | 0.27 | 0.90-1.10 | impact_car | light collision / scrape-crash, ~1 s |
| `impacts/car_scrape_hit` | 1 | 0.55 | one-shot | 0.41 | 0.90-1.10 | impact_car | onset of a metal scrape: screech chirp + crunch, 0.5 s |
| `impacts/car_scrape_loop` | 1 | 1.60 | LOOP | 0.43 | 0.80-1.30 | impact_loop | metal scraping on asphalt, seamless 1.6 s loop; gain by slide speed, pitch 0.8-1.3 |
| `impacts/debris_bounce` | 4 | 0.75 | one-shot | 0.40 | 0.90-1.10 | impact_car | chunk of metal bouncing on asphalt, 3 bounces |
| `impacts/glass_shatter` | 2 | 1.40 | one-shot | 0.98 | 0.90-1.10 | impact_car | windscreen / window shatter, 1.3 s |
| `impacts/headshot_ping` | 1 | 0.80 | one-shot | 0.78 | 1.00-1.00 | impact_ui | bright metallic headshot ping |
| `impacts/hit_marker` | 1 | 0.11 | one-shot | 1.00 | 1.00-1.00 | impact_ui | crisp hit confirmation tick (2-3 kHz) |
| `impacts/hit_marker_kill` | 1 | 0.45 | one-shot | 1.00 | 1.00-1.00 | impact_ui | kill confirmation: double tick + low thock + ping |
| `impacts/metal_tear` | 3 | 0.80-1.20 | one-shot | 0.54 | 0.90-1.10 | impact_car | tearing / peeling sheet metal, ~1 s |
| `impacts/panel_detach` | 3 | 0.75 | one-shot | 0.73 | 0.90-1.10 | impact_car | body panel / bumper ripping off: clang + boing + skitter |
| `impacts/ram_hit` | 3 | 0.90 | one-shot | 0.39 | 0.90-1.10 | impact_car | vehicle-vehicle ram: solid low thud + crunch |
| `impacts/ricochet` | 4 | 0.70 | one-shot | 0.36 | 0.92-1.08 | impact_bullet | ricochet zing: tonal noise gliding down, 0.6 s |
| `impacts/wheel_off` | 1 | 1.80 | one-shot | 0.51 | 0.90-1.10 | impact_car | wheel shears off: bang + whirring roll-away + bounces, 1.8 s |

## EXPLOSIONS - blasts, fire, shockwave

| sound | var | dur (s) | type | gain | pitch | category | notes |
|---|---|---|---|---|---|---|---|
| `explosions/distant_explosion` | 3 | 5.34-6.51 | one-shot | 0.14 | 0.85-1.15 | explosion | far-away blast: muffled, delayed onset, long rumble (mono, non-directional) |
| `explosions/explosion_huge` | 1 | 7.83 | one-shot | 0.73 | 0.90-1.10 | explosion | boss / tanker mega explosion, 6.5 s; screen shake sync at ~0.0-0.6 s |
| `explosions/explosion_large` | 2 | 4.99-5.39 | one-shot | 0.60 | 0.90-1.10 | explosion | large blast (heavy vehicle, chain reaction), 3.8 s |
| `explosions/explosion_medium` | 3 | 3.11-3.57 | one-shot | 0.40 | 0.90-1.10 | explosion | medium blast (car explosion), 2.6 s |
| `explosions/explosion_small` | 3 | 2.01-2.20 | one-shot | 0.25 | 0.90-1.10 | explosion | small blast (barrel, light car), 1.7 s |
| `explosions/fire_crackle_loop` | 1 | 3.20 | LOOP | 0.48 | 0.90-1.10 | explosion_loop | crackling flames (quieter, more snaps), seamless 3.2 s loop |
| `explosions/fire_loop` | 1 | 2.40 | LOOP | 0.42 | 0.90-1.10 | explosion_loop | burning car: roar + crackle, seamless 2.4 s loop (3D loop on wrecks) |
| `explosions/fuel_ignite` | 1 | 1.92 | one-shot | 0.39 | 0.90-1.10 | explosion | fuel / fire whump: slow-attack low thump + flame roar, 1.6 s |
| `explosions/grenade_explosion` | 3 | 2.25-2.42 | one-shot | 0.38 | 0.90-1.10 | explosion | frag grenade: sharp crack + shrapnel whine + short boom, ~1.9 s |
| `explosions/rocket_explosion` | 2 | 3.37-3.77 | one-shot | 0.53 | 0.90-1.10 | explosion | rocket / RPG impact: sharp bang then heavy boom, 2.8 s |
| `explosions/shockwave_sub` | 1 | 1.00 | one-shot | 0.28 | 0.90-1.15 | explosion | sub-bass thump for blast pressure wave; layer under big explosions / camera shake |

## VEHICLES - engines, forced induction, tyres, wind, misc

| sound | var | dur (s) | type | gain | pitch | category | notes |
|---|---|---|---|---|---|---|---|
| `vehicles/backfire` | 3 | 0.43-0.60 | one-shot | 0.44 | 0.94-1.06 | vehicle_fx | exhaust backfire bang + crackle, 0.6 s |
| `vehicles/brake_squeal` | 1 | 1.10 | one-shot | 0.14 | 0.94-1.06 | vehicle_fx | brake squeal, 1.1 s (pitch 0.9-1.2) |
| `vehicles/damaged_engine_loop` | 1 | 2.45 | LOOP | 0.60 | 0.80-1.30 | vehicle_loop | dying engine: misfires, rod knock, steam hiss; overlay on engine when HP low; seamless 2.4 s loop |
| `vehicles/engine_stall` | 1 | 2.60 | one-shot | 0.49 | 0.94-1.06 | vehicle_fx | engine dies: sputtering chugs slowing to a stop, 2.4 s |
| `vehicles/engine_start` | 1 | 3.20 | one-shot | 0.41 | 0.94-1.06 | vehicle_fx | starter crank -> catch -> rev overshoot -> idle (~800 rpm), 3 s |
| `vehicles/gear_shift` | 2 | 0.50 | one-shot | 0.19 | 0.94-1.06 | vehicle_fx | gear change: drivetrain clunk + blow-off chuff, 0.45 s |
| `vehicles/hit_car_body` | 3 | 0.42 | one-shot | 0.37 | 0.94-1.06 | vehicle_fx | bullet hits on the PLAYER truck body: heavier panel bong + thud |
| `vehicles/horn` | 2 | 1.00-1.35 | one-shot | 0.17 | 0.94-1.06 | vehicle_fx | horn: [0]=car honk (415+520 Hz), [1]=heavy truck horn (235+295 Hz); ~1 s sustained |
| `vehicles/jump_land_heavy` | 1 | 1.10 | one-shot | 0.26 | 0.94-1.06 | vehicle_fx | hard landing after a jump: sub thump + suspension crash + rattle, 1.1 s |
| `vehicles/mine_drop_beep` | 1 | 0.80 | one-shot | 0.33 | 0.94-1.06 | vehicle_fx | mine dropped: clink + two arming beeps (2.1 kHz), 0.75 s |
| `vehicles/mine_explosion` | 1 | 2.82 | one-shot | 0.60 | 0.90-1.10 | explosion | road mine blast: crack + dirt spray + medium boom, 2.3 s |
| `vehicles/nitro_end` | 1 | 1.10 | one-shot | 0.41 | 0.94-1.06 | vehicle_fx | nitro off: fading hiss, pitch-dropping whistle + crackling pops, 1.1 s |
| `vehicles/nitro_ignite` | 1 | 1.10 | one-shot | 0.44 | 0.94-1.06 | vehicle_fx | nitro / boost kick-in: whump + pssht + rising scream, 1.1 s |
| `vehicles/nitro_loop` | 1 | 1.60 | LOOP | 0.60 | 0.85-1.25 | vehicle_loop | nitro burn: flame roar + turbine whistle, seamless 1.6 s loop |
| `vehicles/oil_slick_splat` | 1 | 0.70 | one-shot | 0.21 | 0.94-1.06 | vehicle_fx | oil slick deployed: wet splat + bubbles, 0.7 s |
| `vehicles/skid_gravel_loop` | 1 | 1.60 | LOOP | 0.68 | 0.70-1.60 | vehicle_loop | sliding on gravel / dirt: spray hiss + stone crackle, seamless 1.6 s loop |
| `vehicles/skid_loop` | 1 | 1.60 | LOOP | 0.66 | 0.85-1.25 | vehicle_loop | tyre squeal on asphalt (drift), seamless 1.6 s loop; gain by slip, pitch 0.85-1.25 |
| `vehicles/supercharger_whine_loop` | 1 | 1.50 | LOOP | 0.83 | 0.50-1.50 | vehicle_loop | roots-blower / gear whine, reference 1.5 kHz; playbackRate follows rpm (0.5-1.5) |
| `vehicles/suspension_thunk` | 3 | 0.55 | one-shot | 0.22 | 0.94-1.06 | vehicle_fx | landing / bump: dull thunk + spring settle, 0.55 s |
| `vehicles/turbo_whine_loop` | 1 | 1.50 | LOOP | 0.83 | 0.50-1.60 | vehicle_loop | turbine whistle, reference 3.3 kHz; playbackRate 0.5-1.6 with boost / rpm; layer with engine |
| `vehicles/tyre_asphalt_loop` | 1 | 2.00 | LOOP | 0.84 | 0.70-1.60 | vehicle_loop | road roar on asphalt; volume ~ speed^1, pitch 0.7-1.6 with speed; seamless 2 s loop |
| `vehicles/tyre_dirt_loop` | 1 | 2.00 | LOOP | 0.84 | 0.70-1.50 | vehicle_loop | tyres on dirt / gravel road: rumble + stone rattle; pitch 0.7-1.5 with speed; 2 s loop |
| `vehicles/wind_loop` | 1 | 2.50 | LOOP | 0.84 | 0.70-1.60 | vehicle_loop | wind rush around the truck; volume ~ speed^1.5, pitch 0.7-1.6; 2.5 s loop |

## UI

| sound | var | dur (s) | type | gain | pitch | category | notes |
|---|---|---|---|---|---|---|---|
| `ui/buy` | 1 | 0.75 | one-shot | 0.25 | 0.98-1.02 | ui | purchase confirmation: cash-register bell + coin clink, 0.7 s |
| `ui/click` | 1 | 0.07 | one-shot | 0.67 | 0.98-1.02 | ui | button press: dry tactile tick |
| `ui/coin` | 2 | 0.45 | one-shot | 0.25 | 0.98-1.02 | ui | coin pickup / cash ding (two variations, pitch up/down) |
| `ui/countdown_beep` | 1 | 0.30 | one-shot | 0.25 | 0.98-1.02 | ui | 3-2-1 countdown beep (880 Hz) |
| `ui/error` | 1 | 0.36 | one-shot | 0.24 | 0.98-1.02 | ui | denied / cannot afford: low double buzz |
| `ui/go` | 1 | 0.70 | one-shot | 0.34 | 0.98-1.02 | ui | GO! start beep: higher, longer, with rising sweep |
| `ui/hover` | 1 | 0.05 | one-shot | 0.34 | 0.98-1.02 | ui | menu item hover: light high tick |
| `ui/menu_close` | 1 | 0.30 | one-shot | 0.39 | 0.98-1.02 | ui | menu closes: falling whoosh + soft thock |
| `ui/menu_open` | 1 | 0.32 | one-shot | 0.28 | 0.98-1.02 | ui | menu opens: short rising airy whoosh + soft click |
| `ui/ready` | 1 | 0.36 | one-shot | 0.36 | 0.98-1.02 | ui | ready / confirm: two-note up chirp |
| `ui/upgrade_unlock` | 1 | 1.05 | one-shot | 0.19 | 0.98-1.02 | ui | new upgrade / weapon unlocked: rising sparkle arpeggio, 1 s |
| `ui/whoosh_transition` | 1 | 0.95 | one-shot | 0.15 | 0.98-1.02 | ui | screen transition: swelling whoosh into a low thud, 0.8 s |

## STINGERS

| sound | var | dur (s) | type | gain | pitch | category | notes |
|---|---|---|---|---|---|---|---|
| `stingers/boss_defeated` | 1 | 5.47 | one-shot | 0.38 | 1.00-1.00 | stinger | boss dies: huge boom then rising A-minor to A-major brass resolution, ~7 s |
| `stingers/boss_intro` | 1 | 7.66 | one-shot | 0.38 | 1.00-1.00 | stinger | boss appears: drone + phrygian minor-second swell + tom hits + massive E hit, ~7 s |
| `stingers/danger_riser` | 1 | 3.00 | one-shot | 0.45 | 1.00-1.00 | stinger | 3 s tension riser (noise sweep + rising tone + accelerating tremolo); ends at peak, cut it with a hit |
| `stingers/game_over` | 1 | 4.87 | one-shot | 0.34 | 1.00-1.00 | stinger | car destroyed / run over: sub hit + tape-stop A-minor chord sinking, 3.8 s |
| `stingers/low_health_heartbeat_loop` | 1 | 2.00 | LOOP | 0.73 | 0.90-1.40 | stinger_loop | heartbeat lub-dub-lub-dub at 60 BPM (2 beats, slight variation), seamless 2 s loop; loop while HP < 30 %, raise rate via playbackRate |
| `stingers/run_start` | 1 | 3.57 | one-shot | 0.47 | 1.00-1.00 | stinger | run begins: 1.2 s riser (tom roll + swell) then A-minor power-chord impact; ~4 s total |
| `stingers/victory` | 1 | 2.38 | one-shot | 0.38 | 1.00-1.00 | stinger | short heroic C-major fanfare (2.6 s stinger; full theme is music/victory) |
| `stingers/warning_alarm_loop` | 1 | 1.20 | LOOP | 0.92 | 0.90-1.40 | stinger_loop | two-tone electronic warning siren (960/720 Hz), seamless 1.2 s loop |

## AMBIENCE

| sound | var | dur (s) | type | gain | pitch | category | notes |
|---|---|---|---|---|---|---|---|
| `ambience/canyon_wind_loop` | 1 | 24.00 | LOOP | 0.59 | 1.00-1.00 | ambience | hollow canyon wind: moving formant resonances + long echo, seamless 24 s stereo loop |
| `ambience/city_ruins_loop` | 1 | 24.00 | LOOP | 0.66 | 1.00-1.00 | ambience | ruined city: thin wind, structure howl, distant creaks and debris ticks, seamless 24 s stereo loop |
| `ambience/coast_waves_loop` | 1 | 24.00 | LOOP | 0.53 | 1.00-1.00 | ambience | surf: three irregular waves rolling in and washing out over distant surf, seamless 24 s stereo loop |
| `ambience/dam_rumble_loop` | 1 | 24.00 | LOOP | 0.38 | 1.00-1.00 | ambience | boss arena at the dam: deep water thunder + turbine hum + spray, seamless 24 s stereo loop |
| `ambience/desert_wind_loop` | 1 | 24.00 | LOOP | 0.59 | 1.00-1.00 | ambience | open desert wind: broad gusts + sand hiss + faint whistles, seamless 24 s stereo loop |
| `ambience/forest_wind_loop` | 1 | 24.00 | LOOP | 0.67 | 1.00-1.00 | ambience | wind through pines: swishing gusts + leaf rustle sparkle, seamless 24 s stereo loop |

## MUSIC

Active streamed cues and source hashes are documented above and in the catalog. The previous synthesized registry is retained as rollback files but is not active.
