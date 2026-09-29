# Characters (RIDE OR DIE)

Rigged, skinned and animated humans.  Built by `tools/characters/build_all.py` (numpy + MakeHuman CC0 bodies,
procedural garments and gear, procedurally keyed clips).  Metres, **Y up, faces +Z**, character LEFT = +X, feet
(boot soles) at y = 0.

| file | who | height | tris (visible) | size |
|---|---|---|---|---|
| `hero_gunner.glb` | player gunner: tank top, cargo pants, fingerless gloves, forearm wraps, goggles on the forehead, tattoos, brow scar | 1.83 m | 20.1k body + one armor tier (t1 3.3k, t2 5.9k, t3 6.5k) | 3.9 MB |
| `hero_driver.glb` | player driver (woman): rust-orange leather bomber with crew emblem on the back, black tank, driving gloves, ponytail, pilot goggles on the head | 1.70 m | 25.3k | 3.8 MB |
| `raider_a.glb` | bandana + round goggles grunt: open leather vest, bare tattooed chest, shell bandolier, cargo pants | 1.78 m | 9.9k | 1.2 MB |
| `raider_b.glb` | mohawk punk: studded sleeveless vest, spiked leather pauldrons, spiked bracers, chains, torn jeans, face paint | 1.80 m (1.97 m incl. mohawk) | 10.2k | 1.3 MB |
| `raider_c.glb` | masked heavy: hockey mask, riveted scrap plates, car-door left pauldron, tyre right shoulder, pipe forearm guards, chain belt | 1.92 m, bulky | 11.2k | 1.2 MB |
| `raider_d.glb` | hooded bomber: hood up, scarf, bomber jacket, dynamite vest with detonator (red LED), trigger in the right hand | 1.75 m | 10.4k | 1.2 MB |
| `raider_driver.glb` | cap + gold aviators, grizzled stubble beard, brown leather jacket with collar up, chain necklace, fingerless gloves | 1.78 m | 10.1k | 1.2 MB |

Total: 14 MB.

## Scene structure and draw calls

```
<id>                       (root Object3D, identity)
 ├─ Hips ...               (52-bone skeleton, see below; sockets are children of bones)
 ├─ body                   SkinnedMesh, material `body`   (skin + every garment and gear piece)
 ├─ hair                   SkinnedMesh, material `hair`   (hair / mohawk / brows / lashes; raider_c has none)
 ├─ eyes                   SkinnedMesh, material `eye`
 └─ armor_t1 armor_t2 armor_t3   (hero_gunner only) SkinnedMesh, material `body` (same atlas), HIDDEN
```

Each node holds exactly one primitive, so a character renders in **3 draw calls** (hero_gunner: 4 with one armor tier
shown).  All meshes share one skin (same skeleton).

**Hidden armor tiers:** `armor_t1` is a slim coyote vest with pouches, radio and drag handle. `armor_t2` is a black plate carrier with steel plates front and back, shoulder pads, three grenades, triple mag pouch and a back pouch. `armor_t3` is heavy armor: plated chest and back, lames, spiked pauldrons, gorget, hip tassets, knee cups.

Each tier replaces the others. Show at most one; the base body stays visible.

The tier nodes carry `extras.hidden = true` (three.js puts it in `userData.hidden`) and `KHR_node_visibility {visible:false}`.
**three.js r186 ignores KHR_node_visibility**, so hide them after loading:
`for (const n of ['armor_t1','armor_t2','armor_t3']) gltf.scene.getObjectByName(n).visible = false;`

## Materials (atlas)

| material | textures | notes |
|---|---|---|
| `body` | `baseColorTexture` (sRGB), `normalTexture`, `metallicRoughnessTexture`, `emissiveTexture` (raider_d only) | opaque, double sided. Heroes 2048², raiders 1024². All former per-material colours, roughness and metalness are baked in. Former lenses are opaque glossy glass. |
| `hair` | RGBA base colour | `alphaMode MASK` (cutoff 0.42), double sided. 1024² heroes, 512² raiders |
| `eye` | base colour | opaque, 256² / 128² |

Some meshes also carry `COLOR_0`, for example the red/brass bandolier shells and the red/black wires. It multiplies the albedo; three.js enables it automatically.

**Tinting ("paint"):** the regions that used to be tintable `paint*` materials are flagged in the **R channel of the
metallicRoughness texture**. glTF and three.js only read G (roughness) and B (metal) from it. Those regions are:

- raider_a: bandana
- raider_c: car-door pauldron and one chest plate
- raider_driver: cap

The albedo there is near-white or grey detail. To tint per gang:

```js
const tint = new THREE.Color(0xcc3311);
mat.onBeforeCompile = (s) => {
  s.uniforms.uTint = { value: tint };
  s.fragmentShader = 'uniform vec3 uTint;\n' + s.fragmentShader.replace('#include <map_fragment>',
    '#include <map_fragment>\n  diffuseColor.rgb *= mix(vec3(1.0), uTint, texture2D(metalnessMap, vMetalnessMapUv).r);');
};
```
(GLTFLoader assigns the MR texture to both `roughnessMap` and `metalnessMap`.)  Without a tint the default colour
factor already baked in shows (faded red bandana/cap, faded blue-grey door).

Texel density on `body`:

- hero_driver: ~1.2k px/m
- hero_gunner: ~0.5k px/m, because the three armor tiers share its atlas
- raiders: 0.27–0.39k px/m

Faces get 2× and hands 1.4× that.

## Skeleton (shared by every file)

52 bones, Mixamo names, no prefix, no end bones:
```
Hips
├─ Spine ─ Spine1 ─ Spine2 ─┬─ Neck ─ Head
│                           ├─ LeftShoulder ─ LeftArm ─ LeftForeArm ─ LeftHand ─ LeftHand{Thumb,Index,Middle,Ring,Pinky}{1,2,3}
│                           └─ RightShoulder ─ RightArm ─ RightForeArm ─ RightHand ─ RightHand{Thumb,...,Pinky}{1,2,3}
├─ LeftUpLeg ─ LeftLeg ─ LeftFoot ─ LeftToeBase
└─ RightUpLeg ─ RightLeg ─ RightFoot ─ RightToeBase
```
- Rest pose = MakeHuman **A-pose**: arms about 40° down with slightly bent elbows, legs straight, facing +Z.
- **Every bone has an IDENTITY rest rotation.** Its local axes equal the model axes (+X character-left, +Y up, +Z forward). Node translations are just head-to-head offsets.
- Because of that, rotation tracks retarget between the files by bone name 1:1. Only bone lengths differ.
- The Hips translation track is per character: the clips in each file are baked for that body. When sharing clips across files, scale the Hips track by the ratio of rest Hips heights.
- Up to 4 influences per vertex, 8-bit normalized weights, weights from MakeHuman's default rig.
- Skinning was checked with arms overhead, arms across the chest, 120° elbows, ±60° spine twist and seated 90°. No candy-wrapping was seen.
- Face bones are merged into `Head`: no jaw or facial animation.

**Sockets** are Object3D children of bones:

| socket | parent | placement |
|---|---|---|
| `socket_hand_R` | `RightHand` | at the grip centre. In `pose_rifle` its world orientation is identity (+Z weapon forward, +Y up), so a weapon's `grip_R` can be aligned to it directly. |
| `socket_hand_L` | `LeftHand` | same convention as `socket_hand_R`. |
| `socket_back` | `Spine2` | upper-back centre, about 11 cm behind the spine, for a slung weapon. +Z forward. |
| `socket_head` | `Head` | top centre of the head. |

## Animation clips (30 fps, all 13 in every file)

| clip | length | notes |
|---|---|---|
| `idle_stand` | 3.3 s loop | braced wide stance, knees soft, rifle held at the chest (neutral, for the game's arm IK and spine aim), breathing and sway |
| `idle_sit_drive` | 3.0 s loop | seated, hands at 10 and 2 on the wheel, micro-motion |
| `sit_lean_L` / `sit_lean_R` | 1.5 s loops | hold the full steering lean (L = toward +X); crossfade them with `idle_sit_drive` by input |
| `flinch_a` / `flinch_b` | 0.67 s / 0.73 s | torso recoil and head snap / side stagger and twist; start and end on `idle_stand` frame 0 |
| `throw_grenade` | 1.0 s | right-hand overhand throw, **release at 0.55 s** |
| `celebrate` | 2.2 s | jump with both fists pumped; ends on `idle_stand` frame 0 |
| `crouch_idle` | 3.0 s loop | deep crouch with the rifle ready |
| `death_fall` | 1.2 s | falls backward, lands about 0.72 s, ends lying on its back; the Hips track keeps the lowest point on the floor |
| `pose_pistol` / `pose_rifle` / `pose_launcher` | 1 frame | two-handed pistol at eye level / shouldered rifle / RPG on the right shoulder (arms matter) |

Loops have last frame == first frame. Flinches and the throw start on `idle_stand` frame 0, so they blend in and out cleanly.

**Seating:** in the sit clips the character's origin is on the floor plane directly below the hip joints, which are **0.56 m above
the origin**. Place the root at `seat_driver − (0, 0.56, 0)`, same orientation (+Z forward).

- `hero_driver`: wheel baked for the player trucks (`steering_wheel ≈ seat_driver + (0, 0.37, 0.66)`, column tilted 25°). Her arms are near full reach.
- `raider_driver` and every other file: wheel baked for the enemy cars (`seat_driver + (0, 0.36, 0.44)`).
- If the game places hands on the wheel with IK, any file works.

## Rebuild / QA
```
C:/Dev/conduit/art_src/venv/Scripts/python.exe tools/characters/build_all.py [hero_gunner hero_driver raider_a ...]
```
Sources are in `tools/characters/`:

- `c_<id>.py`: one per character
- `armor_gunner.py`: the gunner's armor tiers
- `mh.py` / `body.py` / `lod.py`: MakeHuman body, skeleton, weights, decimation
- `cloth.py` / `garments.py` / `outfit.py`: garments
- `kit.py` / `gear.py` / `raidergear.py`: hard-surface gear
- `skinpaint.py` / `paintcloth.py` / `texlib.py`: texture painting
- `anim.py`: skeleton clips, IK and sockets
- `atlas.py`: the material/atlas merge
- `glb.py`: GLB writer

Deterministic QA viewer: `/tools/characters/qa.html?model=/models/characters/hero_gunner.glb&anim=idle_stand&t=1.0&views=195:14,20:8&look=Spine2&dist=3&only=body,hair,eyes,armor_t2`. It supports exact clip time `t`, a grid of clip times via `times`, and hides `extras.hidden` nodes.

## Known flaws
- Clothes are painted shells without cloth simulation. Folds are baked, and hems do not swing.
- The hero_gunner tank top is sleeveless. At extreme arm raises its armhole edge shows the body beneath.
- Hair is MakeHuman cards: short04 on the gunner, ponytail01 on the driver. The mohawk is solid tapered spikes. None of it has physics.
- No facial rig; eyes do not blink.
- The seated hero_driver's hands land about 4 cm short of the truck's rim at full reach.
- The "paint" tint needs the shader hook above.

## Credits
MakeHuman 1.x base mesh, targets, default rig weights, skins, eyes, hair (short04, ponytail01), eyebrows and
eyelashes: **CC0** (makehumancommunity.org, local copy in `C:/Dev/conduit/art_src/makehuman`). Everything else
(garments, gear, textures, clips) is procedural and made for this project.
