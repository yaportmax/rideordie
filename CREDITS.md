# Credits

## Audio (public/audio)
The soundtrack in `public/audio/music/suno` is the owner's original Suno music by **yaportmax**, reused at the owner's request from **Covenant: Ashfall**. Twelve original MP3 masters are preserved byte for byte; the catalog records titles, hashes and measured playback attenuation. Stage and boss cues stream through the game's music bus.

Other audio is generated offline by `tools/audio` (Python / numpy / scipy / numba synthesis, encoded with ffmpeg libvorbis). A few short sample layers are mixed into some impact / foley sounds; all of them are CC0 / public domain:

- **Kenney (kenney.nl)** - "Impact Sounds 1.0" and "RPG Audio" - CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/). Used only as processed layers (pitch-shifted, trimmed, energy-balanced against synthesis):
  Impact Sounds (`impactTin_medium`, `impactGlass_light/heavy`, `impactSoft_heavy`, `impactPunch_medium`, `impactPlate_medium/heavy`, `impactMetal_heavy`, `impactMining`) in `impacts/*`
  (bullet_metal, bullet_glass, bullet_flesh, armor_hit, car_crash_*, glass_shatter, ram_hit, ...) and `vehicles/*` (jump_land_heavy, hit_car_body); RPG Audio (`metalLatch`, `metalClick`, `drawKnife1/2`,
  `creak1`, `cloth1/2/3`, `handleSmallLeather`, `dropLeather`, `knifeSlice`) in the `guns/*` reload / swap foley.
- **rubberduck (OpenGameArt.org)** - "100 CC0 SFX" (`slam_*`), "100 CC0 SFX 2" (`thunder_01`) and "75 CC0 breaking / falling / hit SFX" (`bfh1_glass_breaking_*`, `bfh1_metal_hit_*`, `bfh1_metal_falling_*`)
  - CC0 1.0. Used as layers in `impacts/*` (glass, metal, crash, ram, debris) and `explosions/*` (thunder under large / huge / distant blasts). Exact reads are in `tools/audio/g_impacts.py` and `g_explosions.py`.
- Guns, engines, explosions, tyres, wind, ambience, UI and stingers use original synthesis code in `tools/audio`. Older synthesized OGG music remains archived in the asset tree but is excluded from the active soundtrack registry.

Tools: Python 3, numpy, scipy, numba, soundfile, pyloudnorm, matplotlib (analysis only), FFmpeg (Vorbis encoder).

<!-- ENV-CREDITS-START -->

## Environment art (public/textures, public/models/props)
Procedural work (particle sprites, road-marking atlas, wind ripples / lane wear, all prop geometry, signs, foliage cards, hazard marks) was generated offline by `tools/env` (Python/numpy/scipy/PIL, Blender 4.5). No copyrighted or AI-generated art.

PBR photoscan sources - **Poly Haven (polyhaven.com), CC0 1.0** (https://creativecommons.org/publicdomain/zero/1.0/); regraded / mirrored / flattened / packed to ARM by `tools/env/build_textures.py`:

- `asphalt_01` (Asphalt 01) - Charlotte Baglioni, Dario Barresi
- `asphalt_02` (Asphalt 02) - Rob Tuytel
- `asphalt_pit_lane` (Asphalt Pit Lane) - Dimitrios Savva
- `bark_willow` (Bark Willow) - Dario Barresi, Dimitrios Savva
- `cliff_side` (Cliff Side) - Dario Barresi, James Ray Cock, Jenelle van Heerden
- `coast_sand_03` (Coast Sand 03) - Rob Tuytel
- `concrete_floor_03` (Concrete Floor 03) - Matterfield, Rob Tuytel
- `cracked_concrete` (Cracked Concrete) - Dimitrios Savva
- `dry_river_pebbles` (Dry River Pebbles) - Amal Kumar
- `forest_leaves_04` (Forest Leaves 04) - Rob Tuytel
- `forrest_ground_01` (Forest Ground 01) - Rob Tuytel
- `gravel_floor_03` (Gravel Floor 03) - Charlotte Baglioni
- `knotted_pine_bark` (Knotted Pine Bark) - Dimitrios Savva
- `palm_bark` (Palm Bark) - Charlotte Baglioni
- `pine_bark` (Pine Bark) - Dimitrios Savva
- `red_bricks_02` (Red Bricks 02) - Rob Tuytel
- `red_dirt_mud_01` (Red Dirt Mud 01) - Rob Tuytel
- `rock_face_03` (Rock Face 03) - Dario Barresi, Rico Cilliers
- `rough_wood` (Rough Wood) - Rob Tuytel
- `rust_coarse_01` (Rust Coarse 01) - Dimitrios Savva, Rico Cilliers
- `rusty_metal_02` (Rusty Metal 02) - Rob Tuytel
- `sandy_gravel_02` (Sandy Gravel 02) - Dario Barresi
- `snow_02` (Snow 02) - Rob Tuytel
- `weathered_brown_planks` (Weathered Brown Planks) - Dimitrios Savva, Rico Cilliers
- `withered_grass` (Withered Grass) - Charlotte Baglioni

<!-- ENV-CREDITS-END -->
