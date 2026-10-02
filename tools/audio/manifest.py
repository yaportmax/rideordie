"""manifest.py - builds public/audio/manifest.json and docs/AUDIO_LIST.md from the registry + per-file meta."""
import importlib
import json
import math
import os
import sys

import render as R

# cross-category bus offsets (dB, <= 0) applied on top of the within-category loudness match
BUS_DB = {
    "gun_fire": -5.0, "gun_enemy": -5.0, "gun_foley": -12.0, "gun_loop": -8.0,
    "impact_bullet": -10.0, "impact_ui": -8.0, "impact_car": -3.0, "impact_misc": -8.0, "impact_loop": -14.0,
    "explosion": 0.0, "explosion_loop": -14.0,
    "engine": -14.0, "vehicle_loop": -16.0, "vehicle_fx": -8.0,
    "ui": -14.0, "stinger": -5.0, "stinger_loop": -10.0, "ambience": -20.0, "music": -10.0, "music_stem": -10.0,
}


# suggested playbackRate range (pitch multiplier) per category; 1.0 = as rendered
PITCH = {
    "gun_fire": (0.95, 1.05), "gun_enemy": (0.9, 1.1), "gun_foley": (0.96, 1.04), "gun_loop": (0.9, 1.2),
    "impact_bullet": (0.92, 1.08), "impact_ui": (1.0, 1.0), "impact_car": (0.9, 1.1), "impact_loop": (0.8, 1.3),
    "explosion": (0.9, 1.1), "explosion_loop": (0.9, 1.1),
    "engine": (0.75, 1.35), "vehicle_loop": (0.7, 1.6), "vehicle_fx": (0.94, 1.06),
    "ui": (0.98, 1.02), "stinger": (1.0, 1.0), "stinger_loop": (0.9, 1.4), "ambience": (1.0, 1.0),
    "music": (1.0, 1.0), "music_stem": (1.0, 1.0),
}
PITCH_OVERRIDE = {
    "vehicles/tyre_asphalt_loop": (0.7, 1.6), "vehicles/tyre_dirt_loop": (0.7, 1.5), "vehicles/wind_loop": (0.7, 1.6),
    "vehicles/skid_loop": (0.85, 1.25), "vehicles/turbo_whine_loop": (0.5, 1.6), "vehicles/supercharger_whine_loop": (0.5, 1.5),
    "impacts/car_scrape_loop": (0.8, 1.3), "guns/rocket_loop": (0.9, 1.15), "vehicles/damaged_engine_loop": (0.8, 1.3),
    "vehicles/nitro_loop": (0.85, 1.25), "stingers/low_health_heartbeat_loop": (0.9, 1.4),
    "impacts/hit_marker": (1.0, 1.0), "impacts/hit_marker_kill": (1.0, 1.0), "impacts/headshot_ping": (1.0, 1.0),
    "explosions/distant_explosion": (0.85, 1.15), "explosions/shockwave_sub": (0.9, 1.15),
}


def read_soundtrack_overlay():
    """Retain imported soundtrack definitions when regenerating the SFX index.

    These masters are streamed complete songs. They deliberately do not pass
    through the synthesis, loudness matching, or seamless-loop pipeline.
    """
    path = os.path.join(os.path.dirname(__file__), "suno_soundtrack.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf8") as f:
        overlay = json.load(f)
    sounds = overlay.get("sounds")
    if not isinstance(sounds, dict) or not sounds:
        raise ValueError("suno_soundtrack.json requires a nonempty sounds object")
    for key, sound in sounds.items():
        if not key.startswith("music/") or sound.get("category") != "music":
            raise ValueError(f"invalid imported soundtrack entry: {key}")
        if not sound.get("streaming"):
            raise ValueError(f"imported full songs must declare streamed playback: {key}")
        if "loopStart" in sound or "loopEnd" in sound or "loopJumpRatio" in sound:
            raise ValueError(f"imported full songs cannot declare synthesized loop points: {key}")
    for key in ("musicRoutes", "soundtrackProvenance"):
        if key in overlay and not isinstance(overlay[key], dict):
            raise ValueError(f"{key} must be an object")
    return overlay


def load_all():
    for g, m in R.GROUP_MODULES.items():
        try:
            importlib.import_module(m)
        except ModuleNotFoundError:
            pass


def read_meta(group, fn):
    p = os.path.join(R.META, group, fn + ".json")
    if os.path.exists(p):
        with open(p) as f:
            return json.load(f)
    return None


def build_manifest():
    soundtrack = read_soundtrack_overlay()
    load_all()
    sounds = {}
    for (g, n), e in sorted(R.REG.items()):
        if soundtrack and (g == "music" or e["category"] in ("music", "music_stem")):
            continue  # imported songs replace the old synthesized music registry
        metas = []
        for v in range(e["n"]):
            m = read_meta(g, R.fname(e, v))
            if m is None:
                break
            metas.append(m)
        if len(metas) != e["n"]:
            continue  # not built yet
        metric = [(m["lufs_i"] if e["loop"] else m.get("lufs_s", m["lufs_m"])) for m in metas]
        e["_metric"] = sum(metric) / len(metric)
        sounds[(g, n)] = (e, metas)
    # global reference: the most constrained sound gets gain 1.0; everything else is relative to it
    ref = min(e["_metric"] - e["rel_db"] - BUS_DB.get(e["category"], -6.0) for e, _ in sounds.values()
              if e["category"] not in ("music", "music_stem"))
    out = {}
    for (g, n), (e, metas) in sounds.items():
        cat = e["category"]
        target = ref + e["rel_db"] + BUS_DB.get(cat, -6.0)
        gain = 10 ** ((target - e["_metric"]) / 20.0)
        gain = round(min(gain, 1.0), 3)
        if cat in ("music", "music_stem"):
            gain = 1.0      # stems must keep their mutual balance: one common gain (use the game's music bus)
        d = dict(
            file=metas[0]["file"],
            files=[m["file"] for m in metas],
            duration=metas[0]["duration"],
            durations=[m["duration"] for m in metas],
            loop=bool(e["loop"]),
            variations=e["n"],
            gain=gain,
            category=cat,
            channels=e["ch"],
            notes=e["notes"],
            peakDb=max(m["peak_db"] for m in metas),
            lufs=round(e["_metric"], 1),
        )
        if e["loop"]:
            d["loopStart"] = 0.0
            d["loopEnd"] = metas[0]["duration"]
            d["loopJumpRatio"] = max(m.get("loop_jump", 0) for m in metas)
        pr = PITCH_OVERRIDE.get(f"{g}/{n}", PITCH.get(cat, (1.0, 1.0)))
        d["pitchRange"] = list(pr)
        d.update(e["extra"])
        out[f"{g}/{n}"] = d
    if soundtrack:
        out.update(soundtrack["sounds"])
    # engines summary
    engines = {}
    for k, d in out.items():
        if "engine" in d and "stage" in d:
            eng = engines.setdefault(d["engine"], dict(stages=[], description=d.get("engine_desc", "")))
            eng["stages"].append(dict(stage=d["stage"], rpm=d["rpm"], file=d["file"], duration=d["duration"], gain=d["gain"],
                                      fireHz=d.get("fireHz")))
    order = ["idle", "low", "mid", "high", "redline"]
    for eng in engines.values():
        eng["stages"].sort(key=lambda s: order.index(s["stage"]))
    total = 0
    total_files = 0
    bytes_by_format = {}
    for root, _, files in os.walk(R.OUT):
        for f in files:
            extension = os.path.splitext(f)[1].lower()
            if extension in (".ogg", ".mp3", ".wav", ".m4a", ".flac", ".opus"):
                size = os.path.getsize(os.path.join(root, f))
                total += size
                total_files += 1
                bytes_by_format[extension[1:]] = bytes_by_format.get(extension[1:], 0) + size
    man = dict(
        version=1,
        basePath="/audio/",
        sampleRate=R.SR,
        format=("ogg/vorbis q5 generated SFX/ambience; original streamed MP3 soundtrack" if soundtrack else
                "ogg/vorbis q5; mono for positional sfx, stereo for music + ambience"),
        conventions=dict(
            peak=("generated OGG files peak <= -1 dBFS (decoded); imported MP3 masters retain their original levels; use per-track measured metadata when present" if soundtrack else
                  "all files peak <= -1 dBFS (decoded)"),
            gain="'gain' is a linear multiplier <= 1 that balances loudness within and across categories; game master gain on top",
            loops="generated loop=true files are exact-length seamless loops: loopStart=0, loopEnd=duration; use AudioBufferSourceNode.loop=true; streaming=true music uses whole-song repeat/crossfade when loop=true, not sample-exact looping",
            variations="files list one file per variation; generated SFX may randomize within pitchRange; full-song music remains at playbackRate=1",
            engines="see 'engines': stage loops recorded at fixed RPM; crossfade neighbours (equal power) and set playbackRate = currentRPM / stageRPM (0.75..1.35)",
        ),
        totalBytes=total,
        totalFiles=total_files,
        bytesByFormat=dict(sorted(bytes_by_format.items())),
        engines=engines,
        sounds=dict(sorted(out.items())),
    )
    if soundtrack:
        man["conventions"]["sampleRate"] = "sampleRate is the generated OGG default; imported streamed MP3 files retain their own encoding"
        for key in ("musicRoutes", "soundtrackProvenance"):
            if key in soundtrack:
                man[key] = soundtrack[key]
    os.makedirs(R.OUT, exist_ok=True)
    with open(os.path.join(R.OUT, "manifest.json"), "w") as f:
        json.dump(man, f, indent=1)
    return man


if __name__ == "__main__":
    m = build_manifest()
    print(len(m["sounds"]), "sounds", round(m["totalBytes"] / 1e6, 2), "MB")
