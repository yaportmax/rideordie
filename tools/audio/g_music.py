"""g_music.py - registers the music library: layered run / boss stems, garage + title loops, victory one-shot.

Every track lives in its own module (mus_*.py) exposing SPEC and build() -> (stems dict, info dict).  The expensive
render is cached (cache/<track>.npz) so the per-stem build jobs (one process each) only decode the cache.
"""
import importlib
import os

import dsp
import music_lib as M
from dsp import SR
from render import sound

G = "music"
STEM_ORDER = ["base", "drums", "lead", "extra"]
MUSIC_GAIN = 0.4          # uniform per-track 'gain' override for the manifest (keeps stem balance intact)

TRACK_MODULES = ["mus_garage", "mus_title", "mus_victory"]


def _stem_fn(mod_name, key):
    def fn(v, r):
        m = importlib.import_module(mod_name)
        st, info = M.cached_stems(m.SPEC["track"], m.build, m.SPEC["srcs"])
        x = st[key]
        if m.SPEC["kind"] != "victory":
            assert len(x) == M.Grid(m.SPEC["bpm"], m.SPEC["bars"]).N, (m.SPEC["track"], key, len(x))
        assert float(abs(x).max()) > 1e-3, (m.SPEC["track"], key, "silent")
        return x
    return fn


def _register(mod_name):
    try:
        m = importlib.import_module(mod_name)
    except ModuleNotFoundError as e:
        if e.name != mod_name:
            raise
        return
    sp = m.SPEC
    gr = M.Grid(sp["bpm"], sp["bars"])
    base_extra = dict(track=sp["track"], bpm=round(gr.bpm, 4), bpmNominal=sp["bpm"], bars=sp["bars"], beats=sp["bars"] * 4,
                      key=sp["key"], loopBars=sp["bars"], samples=gr.N, secPerBar=round(gr.N / SR / sp["bars"], 5),
                      gain=sp.get("gain", MUSIC_GAIN))
    base_extra["beatSec"] = round(60.0 / gr.bpm, 5)
    base_extra["barSec"] = round(240.0 / gr.bpm, 5)
    if sp.get("sections"):
        base_extra["sections"] = [dict(bar=b, name=n) for b, n in sp["sections"]]         # 1-based bar numbers
    if sp.get("fill_bars"):
        base_extra["fillBars"] = sp["fill_bars"]
    if sp["kind"] == "run" or sp["kind"] == "boss":
        base_extra["layers"] = [o[0] for o in sp["outputs"]]                              # base, drums, lead, extra (intensity 0..3)
    if sp["kind"] == "victory":
        for k_ in ("loopBars", "samples", "secPerBar"):
            base_extra.pop(k_)
        base_extra["oneShot"] = True
    for out_name, key, layer in sp["outputs"]:
        ex = dict(base_extra)
        if key in STEM_ORDER:
            ex.update(stem=key, intensity=layer)
        if sp["kind"] != "victory":
            ex["loopEnd"] = gr.N / SR
        cat = "music_stem" if key in STEM_ORDER else "music"
        sound(G, out_name, loop=sp["kind"] != "victory", ch=2, norm=("none", 0), category=cat, extra=ex,
              notes=sp.get("notes", ""), ceiling=-1.0)(_stem_fn(mod_name, key))


for _m in TRACK_MODULES:
    _register(_m)


def _register_dnb(track, biome, title, level):
    from compose_dnb import BPM, BARS, compose
    gr = M.Grid(BPM, BARS)

    def stem_fn(stem):
        def fn(v, r):
            stems, _ = M.cached_stems(track, lambda: compose(track, biome, title, level),
                                     ["compose_dnb.py", "dsp.py", "music_lib.py"])
            return stems[stem]
        return fn

    for stem in ("base", "extra"):
        extra = dict(track=track, kind="boss" if biome == "boss" else "run", stem=stem,
                     intensity=0 if stem == "base" else 1, biomes=[] if biome == "boss" else [biome],
                     bpm=gr.bpm, bpmNominal=BPM, bars=BARS, beats=BARS * 4, samples=gr.N,
                     secPerBar=gr.N / SR / BARS, beatSec=gr.N / SR / BARS / 4,
                     loopEnd=gr.N / SR, key="D minor", gain=.5,
                     sections=[dict(bar=1, name="drive"), dict(bar=9, name="variation"),
                               dict(bar=17, name="half-time break then return"), dict(bar=25, name="pressure")])
        sound(G, track + "_" + stem, loop=True, ch=2, norm=("none", 0), category="music_stem", extra=extra,
              notes=f"Original dark cinematic DnB ({biome}) 174 BPM; complete groove in base, adaptive pressure in extra.",
              ceiling=-1.0)(stem_fn(stem))


from compose_dnb import TRACKS
for _track in TRACKS:
    _register_dnb(*_track)
