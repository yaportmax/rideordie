# Credits

## Audio (public/audio)
Everything in `public/audio` is generated offline by `tools/audio` (Python / numpy / scipy / numba synthesis, encoded with ffmpeg libvorbis).
No copyrighted material, no AI-generated audio. A few short sample layers are mixed into some impact / foley sounds; all of them are CC0 / public domain:

- **Kenney (kenney.nl)** - "Impact Sounds 1.0", "RPG Audio" - CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/). Used as processed layers (pitch-shifted, filtered, blended with synthesis)
  in `impacts/*` (bullet_metal, bullet_glass, bullet_flesh, armor_hit, car_crash_*, glass_shatter, panel_detach, ram_hit), `vehicles/*` (jump_land_heavy, hit_car_body)
  and `guns/*` reload foley (metalLatch / metalClick click layers).
- **rubberduck (OpenGameArt.org)** - "100 CC0 SFX", "75 CC0 breaking / falling / hit SFX", "25 CC0 bang / firework SFX" collections - CC0 1.0 (see `tools/audio/samples.py` for exactly which files are read).

Tools: Python 3, numpy, scipy, numba, soundfile, pyloudnorm, matplotlib (analysis only), FFmpeg (Vorbis encoder).
