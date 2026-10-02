"""docs_gen.py - writes docs/AUDIO_LIST.md from public/audio/manifest.json (run after manifest.py)."""
import json
import os
import sys

import render as R
import manifest as M

DOC = os.path.join(R.ROOT, "docs", "AUDIO_LIST.md")

GROUP_TITLES = [
    ("guns", "GUNS - fire, reloads, grenades, shells"),
    ("impacts", "IMPACTS - bullets, near-misses, hit feedback, car damage"),
    ("explosions", "EXPLOSIONS - blasts, fire, shockwave"),
    ("vehicles", "VEHICLES - engines, forced induction, tyres, wind, misc"),
    ("ui", "UI"),
    ("stingers", "STINGERS"),
    ("ambience", "AMBIENCE"),
    ("music", "MUSIC"),
]


def fmt_loop(d):
    if d.get("streaming"):
        return "song repeat / crossfade" if d["loop"] else "full song, once"
    return "LOOP" if d["loop"] else "one-shot"


def cell(value):
    return str(value).replace("|", "\\|").replace("\n", " ")


def main():
    man = M.build_manifest()
    S = man["sounds"]
    streamed = [(k, d) for k, d in S.items() if d.get("streaming")]
    registered_files = {f for d in S.values() for f in d["files"]}
    L = []
    L.append("# RIDE OR DIE - audio library")
    L.append("")
    L.append("Generated SFX and ambience use `tools/audio` (Python synthesis + CC0 Kenney / rubberduck sample layers), encoded Ogg Vorbis q5 (ambience q4), 44.1 kHz.")
    if streamed:
        L.append("Music uses the owner's original full mixed Suno MP3s from Covenant: Ashfall. Their audio bytes and embedded metadata are preserved; full songs stream separately from decoded SFX buffers.")
    L.append(f"{len(S)} sound entries, {len(registered_files)} unique registered audio files; "
             f"{man.get('totalFiles', len(registered_files))} audio files / {man['totalBytes'] / 1e6:.1f} MB physically present, including retained rollback assets. "
             "Machine-readable index: `public/audio/manifest.json` (rebuilt by `tools/audio/manifest.py`).")
    L.append("")
    L.append("## Loudness / usage conventions")
    L.append("- **Generated OGG peak**: generated files target at or below -1 dBFS decoded, no clipping, no DC. One-shots are peak-normalised (about -1.5 dBFS); "
             "loops (engines, tyres, wind, ambience, alerts) are normalised by integrated LUFS (K-weighted) so they can be crossfaded / layered.")
    if streamed:
        L.append("- **Imported MP3 peak**: the masters retain their original levels. Per-track measured `peakDb` and `lufs` are listed below; attenuation is applied at playback through the music bus, without rewriting the files.")
    L.append("- **`gain`** in the manifest is a linear multiplier <= 1.0 that balances loudness inside each category (variations of one sound are already "
             "matched to each other in the files) and gives sensible cross-category defaults (explosions/guns loud, foley/UI/ambience lower). "
             "Multiply by the game bus volume. Imported full songs use their measured per-track attenuation, followed by the player's music setting; their source LUFS is not a shared mastering assumption.")
    L.append("- **Variations**: `files[]` lists variation files (`name_1.ogg`, `name_2.ogg` ...). Pick randomly, never the same twice in a row, and add +-`pitchRange` "
             "playbackRate jitter. Multi-variation sets were loudness-matched (+-0.2 LU).")
    L.append("- **Generated loops** have `loop: true`, `loopStart: 0`, `loopEnd: duration`. They are exact-length seamless loops (built from periodic noise / integer engine cycles; "
             "wrap step checked against the interior step distribution in `tools/audio/qa_all.py`). Use `AudioBufferSourceNode.loop = true`.")
    if streamed:
        L.append("- **Streamed songs** have `streaming: true`. For these entries, `loop: true` means repeat the complete song with a playback transition. It does not promise a sample-exact or bar-aligned seam; `loop: false` plays the complete song once. Keep playbackRate at 1.")
    L.append("- **Mono** for positional SFX (feed into PannerNode), **stereo** for ambience, music, stingers.")
    L.append("- Rendering is deterministic (seeded). Rebuild: `cd tools/audio && venv/Scripts/python.exe build.py <guns|impacts|explosions|vehicles|ui|stingers|ambience|music> [name-prefix ...]`, then "
             "`manifest.py` (index) and `docs_gen.py` (this file). QA: `qa_all.py` (peaks/DC/seams), `qa_engines.py` (fire frequencies per RPM), `qa_sat.py`, "
             "`node tools/audio/browser_check.mjs` (real Chrome decode), `viz.py <group> <names>` (spectrogram sheets in `tools/audio/sheets/`), "
             "`tools/audio/audition.html` (browser audition page with engine simulator + music stem mixer; open via the dev server at `/tools/audio/audition.html`). "
             "CC0 sample layers are read from `C:/Dev/sfx_src` (see `samples.py`).")
    if streamed:
        L.append("- `tools/audio/suno_soundtrack.json` supplies imported music entries, `musicRoutes`, and `soundtrackProvenance` when the index is regenerated. The earlier synthesized music registry is replaced in the runtime index; its existing OGG files remain available for rollback. `build.py music` renders that historical synth library, not the imported masters.")
    L.append("")
    L.append("- **Historical synthesized-score headroom check** (`tools/audio/mix_sim.py`): a dense 12 s combat scene (LMG burst + 2 raider guns + 9 bullet impacts/s + near-misses + engine t3 + tyres/wind at 130 km/h + "
             "2 explosions + heavy crash + run_a music + desert ambience) with the manifest gains and buses SFX 0.8 / engine 0.6 / ambience 0.5 / music 0.45 peaks at about -1.8 dBFS "
             "(-16 LUFS integrated) with no master limiter. This retained result does not validate the new full-song mix.")
    L.append("")
    L.append("### Engine stages (vehicles/engine_*)")
    L.append("Each engine has 5 seamless loops recorded at a fixed RPM (`idle, low, mid, high, redline`). Keep 1-2 stages playing at once: "
             "crossfade the two neighbouring stages with equal-power gains by RPM, and set `playbackRate = currentRPM / stageRPM` "
             "(stay within 0.75-1.35 of each stage's nominal). `fireHz` is the cylinder-firing frequency at the nominal RPM "
             "(engine fundamental, verified by spectrum analysis in `qa_engines.py`). Layer `turbo_whine_loop` / `supercharger_whine_loop` "
             "(reference pitch 3.3 kHz / 1.5 kHz, playbackRate 0.5-1.6, gain rising with boost/RPM) on t4 / boss; "
             "`damaged_engine_loop` overlays at low HP.")
    L.append("")
    L.append("| engine | character | cyl | RPM idle / low / mid / high / redline | fire Hz (same order) | files |")
    L.append("|---|---|---|---|---|---|")
    for name, e in man["engines"].items():
        st = e["stages"]
        cyl = S["vehicles/" + name + "_idle"]["cylinders"]
        L.append(f"| `{name}` | {e['description']} | {cyl} | {' / '.join(str(x['rpm']) for x in st)} | "
                 f"{' / '.join(('%g' % x['fireHz']) for x in st)} | `vehicles/{name}_{{idle,low,mid,high,redline}}.ogg` (~{st[0]['duration']:.1f} s each) |")
    L.append("")
    L.append("Reference mixing code (WebAudio):")
    L.append("```js")
    L.append("// stages = manifest.engines[name].stages  (sorted idle..redline), one looping AudioBufferSourceNode + GainNode per stage")
    L.append("function updateEngine(rpm, throttle) {")
    L.append("  let i = stages.findIndex(s => s.rpm > rpm); i = i < 0 ? stages.length - 1 : Math.max(0, i - 1);   // lower neighbour")
    L.append("  const a = stages[i], b = stages[Math.min(i + 1, stages.length - 1)];")
    L.append("  const t = a === b ? 0 : Math.min(1, Math.max(0, (rpm - a.rpm) / (b.rpm - a.rpm)));")
    L.append("  ga.gain.value = Math.cos(t * Math.PI / 2) * vol;  gb.gain.value = Math.sin(t * Math.PI / 2) * vol;   // equal power")
    L.append("  srcA.playbackRate.value = rpm / a.rpm;  srcB.playbackRate.value = rpm / b.rpm;                     // 0.75-1.35 stays natural")
    L.append("}")
    L.append("```")
    L.append("")
    L.append("### Suggested pitch (playbackRate) ranges")
    L.append("| category | range |")
    L.append("|---|---|")
    for c, pr in M.PITCH.items():
        L.append(f"| {c} | {pr[0]:.2f} - {pr[1]:.2f} |")
    L.append("")
    L.append("## Event -> sound cheat sheet")
    L.append("| game event | sounds |")
    L.append("|---|---|")
    for ev, snd in [
        ("gunner fires weapon X", "`guns/fire_<pistol|revolver|smg|shotgun|rifle|lmg|sniper|rpg>` (random variation, pitch +-5 %), shell: `guns/shell_drop_brass` (SMG/rifle/LMG/pistol) or `shell_drop_shotgun`; RPG flight: `guns/rocket_loop` on the projectile"),
        ("empty mag / reload", "`guns/dry_click`; reload: `<family>_mag_out` -> `_mag_in` -> `_slide/_bolt`; shotgun: `shotgun_shell_in` xN then `shotgun_pump`; LMG: `lmg_cover_open` -> `lmg_belt_in` -> `lmg_cover_close` -> `lmg_rack`; sniper: `sniper_bolt_open` / `sniper_mag` / `sniper_bolt_close`; RPG: `rpg_reload`"),
        ("weapon swap / grenade", "`guns/weapon_swap`; `grenade_pin` -> `grenade_throw` -> `grenade_bounce` (per bounce) -> `explosions/grenade_explosion`"),
        ("raider fires", "`guns/fire_enemy_light` (drivers / SMG raiders) and `fire_enemy_heavy` (heavies / bosses), 3D positional"),
        ("bullet hits enemy car / prop", "`impacts/bullet_metal` (body), `bullet_glass` (windows), `bullet_tire` (+ swerve), `bullet_dirt` / `bullet_asphalt` (misses), `ricochet`, `armor_hit` (armored raider), `bullet_flesh` (driver/gunner hit)"),
        ("bullet passes the player", "`impacts/bullet_whizz` (pan / doppler from the projectile), on the player truck `vehicles/hit_car_body`; on player armor `armor_hit`"),
        ("hit feedback (HUD)", "`impacts/hit_marker`, `hit_marker_kill`, `headshot_ping` (2D, not spatialised)"),
        ("car crash / ram / rollover", "`impacts/car_crash_light|heavy`, `ram_hit`, `car_scrape_hit` then `car_scrape_loop` while sliding, `panel_detach`, `metal_tear`, `glass_shatter`, `debris_bounce`, `wheel_off`"),
        ("car explodes", "size by class: `explosions/explosion_small|medium|large|huge` + `shockwave_sub` layer + `fuel_ignite` first; wreck: `fire_loop` (3D loop) and `fire_crackle_loop`; far away: `distant_explosion`"),
        ("driving", "`vehicles/engine_*` stage loops (see above), `tyre_asphalt_loop` / `tyre_dirt_loop`, `wind_loop` scaled by speed, `skid_loop` / `skid_gravel_loop` on slip, `suspension_thunk` / `jump_land_heavy` on landing, `gear_shift`, `backfire`"),
        ("nitro", "`vehicles/nitro_ignite` -> `nitro_loop` -> `nitro_end`; forced induction layers `turbo_whine_loop` / `supercharger_whine_loop`"),
        ("driver items", "`vehicles/oil_slick_splat`, `mine_drop_beep`, `mine_explosion`, `horn`, `brake_squeal`"),
        ("low HP", "`vehicles/damaged_engine_loop` (engine), `stingers/low_health_heartbeat_loop` (gunner low HP), `stingers/warning_alarm_loop`"),
        ("start / die", "`vehicles/engine_start` on ignition, `stingers/run_start`; car destroyed `stingers/game_over`, stalling `vehicles/engine_stall`"),
        ("boss", "`stingers/boss_intro`; music follows `musicRoutes.boss`; `explosions/explosion_huge` on kill then `stingers/boss_defeated` / `victory`, with the selected victory song"),
        ("garage UI", "`ui/click`, `hover`, `buy`, `error`, `coin`, `upgrade_unlock`, `ready`, `menu_open` / `menu_close`, `whoosh_transition`; countdown `countdown_beep` x3 then `go`"),
        ("biome ambience", "desert `desert_wind_loop`, canyon `canyon_wind_loop`, coast `coast_waves_loop`, pines `forest_wind_loop`, ruins `city_ruins_loop`, dam `dam_rumble_loop` (crossfade 2-3 s between biomes)"),
    ]:
        L.append(f"| {ev} | {snd} |")
    L.append("")
    if streamed:
        L.append("## Streamed Suno soundtrack")
        L.append("Original full mixed songs by yaportmax. Source peak/LUFS measurements describe the imported masters; `playbackLufs` is the per-track attenuation target before the game music volume. BPM, musical key, bar boundaries, and sample-exact loop points are not inferred.")
        L.append("")
        L.append("| entry | title | file | duration (s) | playback | source peak (dBFS) | source LUFS | gain | target LUFS |")
        L.append("|---|---|---|---|---|---|---|---|---|")
        for k, d in streamed:
            L.append(f"| `{cell(k)}` | {cell(d.get('displayTitle', d.get('title', '')))} | `{cell(d['file'])}` | {d['duration']:.3f} | "
                     f"{fmt_loop(d)} | {d.get('peakDb', 'not measured')} | {d.get('lufs', 'not measured')} | {d['gain']:.6f} | {d.get('playbackLufs', 'not specified')} |")
        L.append("")
        routes = man.get("musicRoutes", {})
        if routes:
            L.append("### Music routes")
            L.append("| context | biome | track |")
            L.append("|---|---|---|")
            for context, route in routes.items():
                if isinstance(route, dict):
                    for biome, track in route.items():
                        L.append(f"| {cell(context)} | {cell(biome)} | `{cell(track)}` |")
                else:
                    L.append(f"| {cell(context)} | all | `{cell(route)}` |")
            L.append("")
    music = [(k, d) for k, d in S.items() if k.startswith("music/") and not d.get("streaming")]
    if music:
        L.append("## MUSIC details")
        L.append("Run / boss tracks ship as 4 layered stems of identical length (sample-exact, bar-aligned, individually seamless). "
                 "Start all stems of a track in the same AudioContext tick with `loop = true`; fade stems in/out by intensity "
                 "(0 base, 1 +drums, 2 +lead, 3 +extra). Play every stem at its manifest `gain` (all stems of a track share one gain, so their balance is preserved) "
                 "on a common music bus (stems of a track sum to about -14 LUFS / -1.4 dBFS peak at gain 1.0; garage / title about -16 LUFS). Loop length in samples is identical for all stems of a track; browsers may decode +-2 samples, which is harmless.")
        L.append("")
        L.append("| file | track | stem | intensity layer | BPM | bars | key | loop length (s) | gain |")
        L.append("|---|---|---|---|---|---|---|---|---|")
        for k, d in music:
            L.append(f"| `{d['file']}` | {d.get('track', '')} | {d.get('stem', '')} | {d.get('intensity', '')} | {d.get('bpm', '')} | {d.get('bars', '')} | "
                     f"{d.get('key', '')} | {d['duration']:.3f} | {d['gain']} |")
        L.append("")
    loops = [(k, d) for k, d in S.items() if d["loop"] and not d.get("streaming") and not k.startswith("music/") and "engine" not in d]
    L.append("## Generated loop points (loopStart = 0, loopEnd = file length)")
    L.append("Engine stage loops are listed in the engine table above (2.3-2.45 s each, integer number of engine cycles).")
    L.append("")
    L.append("| loop | length (s) | length (samples @44.1k) | channels | notes |")
    L.append("|---|---|---|---|---|")
    for k, d in loops:
        L.append(f"| `{k}` | {d['duration']:.3f} | {int(round(d['duration'] * 44100))} | {d['channels']} | {d['notes'][:90]} |")
    L.append("")
    L.append("## Browser decoding notes")
    L.append("- Historical generated-OGG validation with `node tools/audio/browser_check.mjs` (headless Chrome `decodeAudioData`): generated files decode at 44.1 kHz with the exact expected length "
             "(loops within +-3 samples), peaks <= -1 dBFS and seamless wrap steps. Chrome may drop up to ~128 trailing samples of very short Vorbis files; "
             "every one-shot therefore ends with >= 128 samples of digital silence, and all loops are >= 1.2 s where this does not occur.")
    L.append("- For generated seamless OGG loops, use `loopStart = 0`, `loopEnd = buffer.duration`; these loops do not need crossfades.")
    if streamed:
        L.append("- Imported MP3 songs use bounded media-element streaming and whole-song playback transitions. Their full-song duration, codec behavior, pause/resume, and transitions require the separate music runtime checks; the earlier OGG buffer/seam result does not apply.")
    L.append("")
    for g, title in GROUP_TITLES:
        items = [(k, d) for k, d in S.items() if k.startswith(g + "/")]
        if not items:
            continue
        L.append(f"## {title}")
        L.append("")
        L.append("| sound | var | dur (s) | type | gain | pitch | category | notes |")
        L.append("|---|---|---|---|---|---|---|---|")
        for k, d in items:
            if "engine" in d and "stage" in d:
                continue
            lo, hi = min(d["durations"]), max(d["durations"])
            dur = f"{lo:.2f}" if abs(hi - lo) < 0.005 else f"{lo:.2f}-{hi:.2f}"
            L.append(f"| `{k}` | {d['variations']} | {dur} | {fmt_loop(d)} | {d['gain']:.2f} | {d['pitchRange'][0]:.2f}-{d['pitchRange'][1]:.2f} | {d['category']} | {d['notes']} |")
        L.append("")
    os.makedirs(os.path.dirname(DOC), exist_ok=True)
    with open(DOC, "w", encoding="utf8") as f:
        f.write("\n".join(L) + "\n")
    print("wrote", DOC, len(L), "lines")


if __name__ == "__main__":
    main()
