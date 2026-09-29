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

TRACK_MODULES = ["mus_run_a", "mus_run_b", "mus_run_c", "mus_boss", "mus_garage", "mus_title", "mus_victory"]


def _stem_fn(mod_name, key):
    def fn(v, r):
        m = importlib.import_module(mod_name)
        st, info = M.cached_stems(m.SPEC["track"], m.build, m.SPEC["srcs"])
        return st[key]
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
    if sp["kind"] == "victory":
        base_extra.pop("loopBars")
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
