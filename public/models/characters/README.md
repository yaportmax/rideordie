# Characters (RIDE OR DIE)

Rigged, skinned and animated humans.  Built by `tools/characters/build_all.py` (numpy + MakeHuman CC0 bodies,
procedural garments and gear, procedurally keyed clips).  Metres, **Y up, faces +Z**, character LEFT = +X, feet
(boot soles) at y = 0.

| file | who | height | tris (visible) | size | clips |
|---|---|---|---|---|---|
| `hero_gunner.glb` | player gunner: tank top, cargo pants, fingerless gloves, forearm wraps, goggles on the forehead, tattoos, brow scar | 1.83 m | 20.1k body + one armor tier (t1 3.3k, t2 5.9k, t3 6.5k) | 4.25 MB | gunner set (46) |
| `hero_driver.glb` | player driver (woman): rust-orange leather bomber with crew emblem on the back, black tank, driving gloves, ponytail, pilot goggles on the head | 1.70 m | 25.3k | 3.76 MB | driver set (22) |
| `raider_a.glb` | grunt: red bandana + matching face scarf (both tintable), amber round goggles, rust-tan vest, khaki pants, open leather vest with a painted skull on the back, bare tattooed chest, shell bandolier, **layered scrap pauldron with spikes (left)**, **machete across the back**, knee pads, patched cargo pants | 1.78 m | 11.9k | 1.78 MB | gunner set |
| `raider_b.glb` | mohawk punk: full white skull face paint, faded denim, studded vest with a red kill tally on the back, spiked leather pauldrons, **spiked collar**, spiked bracers, **spiked knee guards**, chains, torn jeans, face paint | 1.80 m (1.97 m incl. mohawk) | 11.3k | 1.71 MB | gunner set |
| `raider_c.glb` | masked heavy: hockey mask with bold red slashes, riveted scrap plates, rust-red car-door left pauldron **with spikes**, tyre right shoulder, **two rusted exhaust stacks rising behind the shoulders**, skull on the belt, pipe forearm guards, chain belt | 1.92 m, bulky | 12.5k | 1.67 MB | gunner set |
| `raider_d.glb` | hooded bomber: hazard-yellow hood up, **gas mask with twin filters** + amber goggles, dynamite vest with detonator (red LED), **backpack with dynamite bundles**, **molotov satchel** on the left hip, trigger in the right hand | 1.75 m | 13.2k | 1.83 MB | gunner set |
| `raider_driver.glb` | bright red cap with flight goggles, mirrored gold aviators, eye-black war paint, tan jacket, stubble, leather jacket with collar up, **spiked scrap pauldron on the door side (left)**, chain necklace, fingerless gloves | 1.78 m | 11.2k | 1.16 MB | driver set (22) |

| `raider_a2.glb` | variant: middle-aged African grunt, face unmasked (short grey-flecked beard, scar across the eye), goggles pushed up on the red bandana | 1.80 m | 12.2k | 2.0 MB | gunner set |
| `raider_b2.glb` | variant: young Asian punk, cyan mohawk, black war band across the eyes + chin stripes | 1.76 m | 11.2k | 2.0 MB | gunner set |
| `raider_c2.glb` | variant: older African heavy, black hockey mask with white slashes, blue-grey door pauldron | 1.90 m | 12.6k | 2.0 MB | gunner set |
| `raider_d2.glb` | variant: tall bomber, orange hood, green gas-mask lenses | 1.84 m | 13.3k | 2.1 MB | gunner set |
| `raider_driver2.glb` | variant: bald, full beard, goggles on the forehead + aviators, black leather jacket (no cap) | 1.80 m | 11.0k | 1.4 MB | driver set (22) |

Sizes after the round-3 quality pass: hero_gunner 9.7 MB (own armor atlas), hero_driver 5.6 MB, raiders 1.4-2.1 MB;
total 36 MB for 12 files.  Raiders stay at 3 draw calls (`body`, `hair`, `eyes`; raider_c has no hair); hero_gunner
draws `body`, `hair`, `eyes` + the one visible armor tier.
`world_view.js` picks raider variants deterministically from the car id (gunners `raider_<x>` / `raider_<x>2`, drivers
`raider_driver` / `raider_driver2`); a missing variant file falls back to the base type (`crew_view.js`).
Round 2: bolder, higher-contrast palettes (the near-black outfits made every raider a dark blob beyond 10 m).
Trousers were repainted (folds gather at the waist and stack above the boots instead of full-length streaks; faded knees,
seat/shin grime) and the crease darkening is softer.

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
| `body` | `baseColorTexture` (sRGB), `normalTexture`, `metallicRoughnessTexture`, `emissiveTexture` (raider_d only) | opaque, double sided. Heroes 2048², raiders 1024². All former per-material colours, roughness and metalness are baked in. Former lenses are opaque glossy glass. extras `detail: {pxm, size}` (atlas texels per metre / atlas size). |
| `armor` | same set as `body` | hero_gunner only: the hidden armor tiers `armor_t1..3` have their own 2048² atlas, so the base body keeps the whole `body` atlas |
| `hair` | RGBA base colour | `alphaMode MASK` (cutoff 0.42), double sided. 1024² heroes, 512² raiders |
| `eye` | base colour | opaque, 256² / 128² |

Some meshes also carry `COLOR_0`, for example the red/brass bandolier shells and the red/black wires. It multiplies the albedo; three.js enables it automatically.

**Detail class + tint flag (R channel of the metallicRoughness texture):** `R = class * 32 + (paint ? 24 : 8)`, class
0 none, 1 skin, 2 fabric, 3 leather, 4 metal, 5 rubber / plastic (saved as JPEG 4:4:4 so the value survives).
glTF and three.js only read G (roughness) and B (metal).  `src/view/crew_material.js` uses the class at runtime:
a tileable micro-detail normal + roughness layer per class (pores, plain weave, pebbled grain, scratches, stipple;
world-scale from `extras.detail`, faded out beyond ~16 m) and a wrap-lit, red-scattering diffuse term on skin.
Skin also has a baked relief normal map (forehead / frown / crow's-feet lines, nasolabial folds, lip crease, knuckle
creases, forearm veins), darkened creases, darker lips and a roughness map (oily T-zone).

**Tinting ("paint"):** the paint flag marks the regions that used to be tintable `paint*` materials:

- raider_a: bandana
- raider_c: car-door pauldron and one chest plate
- raider_driver: cap

The albedo there is near-white or grey detail. To tint per gang:

```js
const tint = new THREE.Color(0xcc3311);
mat.onBeforeCompile = (s) => {
  s.uniforms.uTint = { value: tint };
  s.fragmentShader = 'uniform vec3 uTint;\n' + s.fragmentShader.replace('#include <map_fragment>',
    '#include <map_fragment>\n  diffuseColor.rgb *= mix(vec3(1.0), uTint, step(0.5, fract(texture2D(metalnessMap, vMetalnessMapUv).r * 255.0 / 32.0)));');
};
```
(GLTFLoader assigns the MR texture to both `roughnessMap` and `metalnessMap`.)  Without a tint the default colour
factor already baked in shows (faded red bandana/cap, faded blue-grey door).

Texel density on `body`:

- hero_driver: ~1.2k px/m
- hero_gunner: ~0.87k px/m (armor tiers: ~0.72k px/m in their own atlas)
- raiders: 0.27–0.39k px/m (+ the runtime micro-detail layer up close)

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

## Animation clips (30 fps)

Files carry the clip set of their ROLE (`anim.role_filter`):
- **gunner set** (hero_gunner, raider_a..d): 46 clips = every clip in the first table.
- **driver set** (hero_driver, raider_driver): 22 clips = the second table + `pose_pistol/_rifle/_launcher`, `idle_stand`,
  `fall_flail`, `land_back`, `land_front`, `death_fall`, `death_blown_up` (for a driver thrown out of a wreck).

Every clip the game already uses keeps its name and meaning (`idle_stand`, `idle_sit_drive`, `sit_lean_L/R`, `crouch_idle`,
`pose_*`, `death_fall`, `throw_grenade`, `flinch_a/b`, `celebrate`).  The `pose_*` finger tracks and hand orientations are
unchanged (they feed the viewmodel; the sockets derive from `pose_rifle`).

### How they are made
`tools/characters/clips_gunner.py`, `clips_react.py`, `clips_driver.py` on top of `motion.py`:
- **Weapon prop**: every weapon clip authors a weapon frame; the right hand is solved onto its grip so that **a weapon GLB
  parented to `socket_hand_R` at identity** (its `grip_R` = the socket) sits exactly where the clip wants it, and the left
  hand is on the class's `grip_L` (rifle handguard, shotgun pump, pistol support hand, RPG front grip).  Aims put the
  weapon's `sight` on the right eye with the `stock` in the shoulder pocket (optimised per body).  Weapon classes: rifle
  (use for smg / rifle / lmg / sniper), pistol (pistol / revolver), shotgun, launcher (rpg).
- **Overlap**: world-space springs on spine / neck / head, the weapon and free hands (follow-through and settle), 120 Hz.
- **Ride layer**: standing clips ride a moving bed (suspension chatter absorbed by the knees, rocking, counter-leaning
  spine, stabilised head); seated clips get road vibration.  Seamless in loops.
- **Continuity + QA**: IK bend planes, hand frames and forearm roll are temporally continuous; a per-bone angular-speed
  limiter removes any residual one-frame flip; `tools/characters/anim_check.py <glb>` reports loop seams, foot sliding,
  flips and hips below the floor - **all 7 files report 0 issues**.
- Deaths use world-space limbs, ballistic arcs (g = 9.81) for the airborne parts and mesh-accurate floor contact.

### Standing / gunner set

| clip | length | use |
|---|---|---|
| `pose_pistol` | 0.00 s | one-frame pistol pose (weapon axis +Z, arms only) |
| `pose_rifle` | 0.00 s | one-frame rifle pose (weapon axis +Z, arms only) |
| `pose_launcher` | 0.00 s | one-frame launcher pose (weapon axis +Z, arms only) |
| `idle_stand` | 4.00 s loop | loop 4 s; riding a vehicle bed: wide braced stance, knees soft absorbing bumps, rocking with the truck, head stabilised; rifle at a compressed low-ready (weapon on socket_hand_R, left hand on the handguard) |
| `aim_rifle` | 3.00 s loop | loop 3 s; rifle shouldered/aimed along +Z (sight on the right eye), bladed stance, riding sway with the head and muzzle stabilised |
| `aim_pistol` | 3.00 s loop | loop 3 s; pistol shouldered/aimed along +Z (sight on the right eye), bladed stance, riding sway with the head and muzzle stabilised |
| `aim_launcher` | 3.00 s loop | loop 3 s; launcher shouldered/aimed along +Z (sight on the right eye), bladed stance, riding sway with the head and muzzle stabilised |
| `aim_shotgun` | 3.00 s loop | loop 3 s; shotgun shouldered/aimed along +Z (sight on the right eye), bladed stance, riding sway with the head and muzzle stabilised |
| `fire_rifle` | 0.30 s | one shot, rifle: recoil impulse at 0.033 s, recovers onto aim_rifle frame 0 by 0.30 s; starts/ends on aim_rifle frame 0 (additive-ready) |
| `fire_pistol` | 0.37 s | one shot, pistol: recoil impulse at 0.033 s, recovers onto aim_pistol frame 0 by 0.36 s; starts/ends on aim_pistol frame 0 (additive-ready) |
| `fire_shotgun` | 1.00 s | one shot, shotgun: recoil impulse at 0.033 s, recovers onto aim_shotgun frame 0 by 1.00 s, pump racked 0.40-0.60 s; starts/ends on aim_shotgun frame 0 (additive-ready) |
| `fire_launcher` | 1.30 s | one shot, launcher: recoil impulse at 0.033 s, recovers onto aim_launcher frame 0 by 1.30 s; starts/ends on aim_launcher frame 0 (additive-ready) |
| `fire_rifle_auto` | 0.50 s loop | loop 0.5 s: sustained full-auto, 5 kicks (600 rpm; set timeScale = rps/10); frame 0 = aim_rifle with a slight held recoil offset -> crossfade from aim_rifle while the trigger is held |
| `reload_rifle` | 2.40 s | 2.4 s, rifle/smg/lmg: cant the rifle, strip the empty (0.40-0.55), flick it away, fresh mag from the chest pouch (0.86-0.96), rock it in + slap (1.24-1.30), rack the charging handle over the top (1.60-1.75), back to low-ready; starts/ends on idle_stand frame 0 |
| `reload_pistol` | 1.60 s | 1.6 s, pistol/revolver: tip the pistol up, fresh mag from the left hip (0.40-0.50), insert + slap (0.76-0.88), overhand slide rack (1.00-1.14); starts/ends on idle_pistol frame 0 |
| `reload_shotgun` | 2.30 s | 2.3 s, pump shotgun: roll the gun, thumb three shells from the belt into the loading port (0.22-1.54), rack the pump (1.76-1.96); starts/ends on the shotgun low-ready (idle_stand frame 0 hold) |
| `reload_launcher` | 2.80 s | 2.8 s, RPG: lower the tube, draw a rocket from the back over the left shoulder (0.62-0.74), feed it into the muzzle (1.28-1.62), back to the front grip and re-shoulder; starts/ends on aim_launcher frame 0 |
| `idle_pistol` | 4.00 s loop | loop 4 s; riding idle like idle_stand, pistol held low in both hands |
| `idle_launcher` | 4.00 s loop | loop 4 s; riding idle like idle_stand, RPG on the right shoulder, muzzle raised |
| `crouch_idle` | 3.00 s loop | loop 3 s; ducked behind the rail: deep crouch, back heel up, rifle low and ready, head up watching, riding sway |
| `throw_grenade` | 1.30 s | 1.3 s overhand grenade throw with the RIGHT hand, RELEASE at 0.55 s. The rifle passes to the LEFT hand: parent the weapon to socket_hand_L (position = -grip_L of the weapon, identity rotation) from 0.08 s to 1.18 s, then back to socket_hand_R; show the grenade in socket_hand_R from 0.18 s to the release. Starts/ends on idle_stand frame 0 |
| `throw_molotov` | 1.70 s | 1.7 s lobbed molotov throw with the RIGHT hand, RELEASE at 0.95 s. The rifle passes to the LEFT hand: parent the weapon to socket_hand_L (position = -grip_L of the weapon, identity rotation) from 0.08 s to 1.58 s, then back to socket_hand_R; show the bottle in socket_hand_R from 0.18 s to the release. Starts/ends on idle_stand frame 0 |
| `taunt` | 2.40 s | 2.4 s taunt: dip, thrust the rifle overhead one-handed, roar with the chest out and head back, three fist/rifle pumps, back to ready; starts/ends on idle_stand frame 0 |
| `shout` | 1.60 s | 1.6 s: lean in and jab the left index finger at the target three times (yelling), rifle one-handed at the hip; starts/ends on idle_stand frame 0 |
| `celebrate` | 2.20 s | 2.2 s: gather, rifle hoisted overhead in both hands, three bouncing cheers, back to ready; starts/ends on idle_stand frame 0 |
| `hit_front` | 0.63 s | 0.62 s light hit, shoved toward -Z (hit from the front): impact 0.05 s, flinch 0.16 s, recovered by ~0.5 s; starts/ends on idle_stand frame 0 (additive-ready) |
| `hit_front_heavy` | 1.27 s | 1.25 s heavy hit from the front: big shove 0.06 s, stagger step with the left foot (0.20-0.36 s), buckle and clutch the wound (0.36-0.62 s), steps back and recovers by 1.1 s; starts/ends on idle_stand frame 0 |
| `hit_back` | 0.63 s | 0.62 s light hit, shoved toward +Z (hit from the back): impact 0.05 s, flinch 0.16 s, recovered by ~0.5 s; starts/ends on idle_stand frame 0 (additive-ready) |
| `hit_back_heavy` | 1.27 s | 1.25 s heavy hit from the back: big shove 0.06 s, stagger step with the right foot (0.20-0.36 s), buckle and throw the free arm out for balance (0.36-0.62 s), steps back and recovers by 1.1 s; starts/ends on idle_stand frame 0 |
| `hit_left` | 0.63 s | 0.62 s light hit, shoved toward -X (hit from the left): impact 0.05 s, flinch 0.16 s, recovered by ~0.5 s; starts/ends on idle_stand frame 0 (additive-ready) |
| `hit_left_heavy` | 1.27 s | 1.25 s heavy hit from the left: big shove 0.06 s, stagger step with the right foot (0.20-0.36 s), buckle and clutch the wound (0.36-0.62 s), steps back and recovers by 1.1 s; starts/ends on idle_stand frame 0 |
| `hit_right` | 0.63 s | 0.62 s light hit, shoved toward +X (hit from the right): impact 0.05 s, flinch 0.16 s, recovered by ~0.5 s; starts/ends on idle_stand frame 0 (additive-ready) |
| `hit_right_heavy` | 1.27 s | 1.25 s heavy hit from the right: big shove 0.06 s, stagger step with the left foot (0.20-0.36 s), buckle and throw the free arm out for balance (0.36-0.62 s), steps back and recovers by 1.1 s; starts/ends on idle_stand frame 0 |
| `flinch_a` | 0.63 s | 0.62 s light hit, shoved toward -Z (hit from the front): impact 0.05 s, flinch 0.16 s, recovered by ~0.5 s; starts/ends on idle_stand frame 0 (additive-ready) |
| `flinch_b` | 0.63 s | 0.62 s light hit, shoved toward +X (hit from the right): impact 0.05 s, flinch 0.16 s, recovered by ~0.5 s; starts/ends on idle_stand frame 0 (additive-ready) |
| `death_fall` | 1.80 s | 1.8 s death: shot in the chest, knees buckle (0.24), sits down hard (0.58), back hits the floor (0.74), head knocks back (0.86), a knee falls outward; ends supine, head toward -Z. Hips keep the body on y = 0 |
| `death_crumple` | 1.70 s | 1.7 s death (head shot): legs fold instantly, knees hit the floor (0.44), topples forward onto the face (0.84), legs slide out; ends prone, head toward +Z, face turned to the right |
| `death_slump_rail` | 2.20 s | 2.2 s death: shot, lurches forward, belly hits a waist-high rail 0.29 m in front (top at 0.98 m, 0.48 s), folds over it and hangs, arms dangling outside the vehicle; toes stay on the bed. Needs a rail/side panel in front: turn the body to face the nearest rail (runtime) or use death_crumple |
| `death_thrown_back` | 2.10 s | 2.1 s death: thrown BACKWARD off the vehicle: airborne 0.10-0.82 s on a ballistic arc (travels 2.2 m back), arms windmill, legs kick; slams onto the back at 0.82 s, bounces, slides, half-rolls, limp. Ends supine, head toward -Z |
| `death_thrown_left` | 2.10 s | 2.1 s death: thrown to the character's LEFT (+X) off the vehicle: airborne 0.10-0.82 s (2.2 m sideways), flailing; lands on the left side at 0.82 s, rolls onto the front, limp. Ends prone |
| `death_thrown_right` | 2.10 s | 2.1 s death: thrown to the character's RIGHT (-X) off the vehicle: airborne 0.10-0.82 s (2.2 m sideways), flailing; lands on the right side at 0.82 s, rolls onto the front, limp. Ends prone |
| `death_blown_up` | 2.50 s | 2.5 s death: blast under the feet launches the body 1.4 m up (0.08 s), spread-eagled back-flip, lands face down at 1.24 s, bounces, limp. Ends prone |
| `fall_flail` | 0.90 s loop | loop 0.9 s: airborne flailing (arms windmill, legs bicycle), Hips fixed at the standing height, root upright -> the runtime drives the ballistic flight and tumble of the root; switch to land_back / land_front on ground contact |
| `land_back` | 1.30 s | 1.3 s: ground impact after a runtime-driven flight (lands on the back): frame 0 = body lying on its back just above the ground with limbs still up, slams at 0.07 s, bounces, limp; root must be upright (yaw only) when it starts |
| `land_front` | 1.30 s | 1.3 s: ground impact after a runtime-driven flight (lands face down): frame 0 = body lying face down just above the ground with limbs still up, slams at 0.07 s, bounces, limp; root must be upright (yaw only) when it starts |

### Seated / driver set

| clip | length | use |
|---|---|---|
| `idle_sit_drive` | 4.00 s loop | loop 4 s; seated at the wheel (hands at 10 and 2, micro steering corrections), road vibration, body rolling with the car, head stabilised. Root on the floor under the hip point, hip joints 0.56 m above it |
| `sit_lean_L` | 1.50 s loop | loop that HOLDS the full lean into a left turn (body toward +X, head counter-tilted level, wheel turned 28 deg); crossfade idle_sit_drive <-> this by steering input |
| `sit_glance_L` | 1.70 s | 1.7 s: glance over the left shoulder (head ~70 deg + chest) and back to the road; hands stay on the wheel; starts/ends on idle_sit_drive frame 0 |
| `death_sit_jerk_L` | 2.10 s | 2.1 s seated death: shot (0.06), a convulsive yank of the wheel ~100 deg to the left with both hands (0.22-0.34), hands slip off, the body topples toward the door (+X) and the head lolls onto the shoulder. Use it when the car swerves left; fade the wheel IK out over 0.3-0.5 s (let the wheel itself spin with the car's steering) |
| `sit_lean_R` | 1.50 s loop | loop that HOLDS the full lean into a right turn (body toward -X, head counter-tilted level, wheel turned 28 deg); crossfade idle_sit_drive <-> this by steering input |
| `sit_glance_R` | 1.70 s | 1.7 s: glance over the right shoulder (head ~70 deg + chest) and back to the road; hands stay on the wheel; starts/ends on idle_sit_drive frame 0 |
| `death_sit_jerk_R` | 2.10 s | 2.1 s seated death: shot (0.06), a convulsive yank of the wheel ~100 deg to the right with both hands (0.22-0.34), hands slip off, the body topples toward the passenger side (-X) and the head lolls onto the shoulder. Use it when the car swerves right; fade the wheel IK out over 0.3-0.5 s (let the wheel itself spin with the car's steering) |
| `sit_brace` | 1.20 s loop | loop 1.2 s; braced for impact: arms locked on the wheel, back into the seat, chin tucked, shoulders up, trembling |
| `sit_impact` | 1.00 s | 1.0 s crash jolt: thrown forward into the wheel (0.08 s, arms buckle, head whips), rebound into the seat (0.24 s), shakes it off; starts/ends on idle_sit_drive frame 0 (additive-ready; hands stay on the wheel) |
| `sit_hit` | 0.73 s | 0.75 s: shot in the seat: torso jerks back and twists, head snaps, right hand flies off the wheel and grabs it again by 0.2 s (fade the right-hand wheel IK over 0.02-0.2 s); starts/ends on idle_sit_drive frame 0 |
| `sit_shout` | 2.00 s | 2.0 s raider taunt: left hand off the wheel, fist shaken out of the window (+X side) four times, head turned to the target, yelling; fade the LEFT-hand wheel IK out over 0.05-0.22 s and back in over 1.55-2.0 s; starts/ends on idle_sit_drive frame 0 |
| `death_sit_slump` | 1.90 s | 1.9 s seated death: head snaps back (0.07), shoulders sag, the body folds forward onto the wheel (0.62), head rests on the rim turned to the side, arms slide off to the lap and the door. Fade the wheel IK out over 0.2-0.6 s |
| `death_sit_headback` | 1.60 s | 1.6 s seated death: head thrown back against the headrest, arms drop off the wheel and dangle beside the seat, head lolls to the side. Fade the wheel IK out over 0.06-0.3 s |

Notes
- Loops have last frame == first frame.  "additive-ready" one-shots start and end on the pose of their base loop, so they
  can be played full-weight over it or converted with `THREE.AnimationUtils.makeClipAdditive(clip, 0)`.
- One-shots marked "starts/ends on idle_stand frame 0" crossfade cleanly in and out of `idle_stand` (0.1-0.15 s fades).
- Standing `death_*` clips release the weapon at frame 0 (hide / drop it when the clip starts).  Their Hips track moves the
  body (thrown deaths travel ~2.2 m): play them with the character detached from the vehicle (world space, root yaw =
  vehicle yaw, root on the ground) - or keep the root on the car for `death_fall` / `death_crumple` / `death_slump_rail`.
- Rotations are stored as normalized int16 quaternions (core glTF, three.js rescales on load) with per-track keyframe
  reduction (0.25 deg body / 1 deg fingers / 1 mm hips); all animation data shares one bufferView.

## Runtime (`src/view/crew_view.js`)
- Third-person gunners (raiders, title / garage / intro / death camera, the co-op partner): weapon on `socket_hand_R`; base
  `idle_stand` / `idle_pistol` / `idle_launcher` by weapon class, `aim_<class>` while aiming or firing, `crouch_idle`,
  additive `fire_<class>` kicks per shot and the additive `fire_rifle_auto` loop for fast rifle-class fire; `reload_<class>`
  on reload (AI crews reload cosmetically after a magazine's worth of shots); `throw_grenade` with the weapon moved to
  `socket_hand_L`; `taunt` / `shout` idles and a taunt when their car kills one of the player's crew; hits pick
  `hit_<dir>` (additive) or `hit_<dir>_heavy` from the hit point / damage; a Spine2 correction keeps the muzzle on the aim
  line and the support hand is IK-shifted to the real weapon's `grip_L`.
- The local first-person gunner keeps the procedural gun frame + arm IK (shadow-only body, viewmodel draws the arms).
- Drivers: sit loops + `sit_brace` (airborne / after crashes), additive `sit_impact` on crashes and `sit_hit` on hits,
  random `sit_glance_L/R`, `sit_shout` in open cabs; wheel-rim IK with per-hand weights; seated deaths fade the IK out.
- Deaths: explosion -> `death_blown_up`; railed vehicles (`e_buggy`, `e_technical`) facing forward -> sometimes
  `death_slump_rail`; head shots -> mostly `death_crumple`; side hits -> `death_thrown_left/right`; otherwise
  `death_thrown_back` (moving) or `death_fall`.  Leaving bodies detach to world space with an upright root, keep 90 % of the
  vehicle's horizontal speed, ease down to the ground over the clip's airborne window and slide to a stop.
- Readability layer (procedural, on top of the clips, for 10-30 m): upper-body inertia against the car's real
  accelerations + a speed-scaled road bob (sway into turns, lurch on braking, head kept level); every hit adds a spring
  "whip" (bend away from the shot, spin for side hits, head snap, overshoot) and plays the light hit at 1.8x or the heavy
  stagger (dmg >= 10, head shots, or 35 % of hits); raider drivers work the wheel with a ~10:1 steering ratio + constant
  sawing corrections, turn head and chest toward the player (locked on while the AI intent is ram / block, repeated looks
  within 34 m, over the shoulder when you are behind); AI gunners yell / point after bursts and every 3-6 s within 38 m.
- Deaths: moving gunners (72 %) and every explosion victim are thrown clear on a real ballistic arc (vehicle momentum + a
  kick away from the shot, up to ~1.5 m high), flailing (`fall_flail`) while the body tumbles; on contact `land_back` /
  `land_front` plays, the body hops, spins and slides to a stop on the road.  Shot drivers snap back before the slump.
- Crews beyond 40 m tick their mixer at half rate and skip the aim / IK / readability passes; the readability layer costs
  ~0.005 ms per crew update (A/B in one session).

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

Clip-only rebake (keeps meshes / textures / sockets, 1-4 min per file; `--only a,b` replaces just those clips):
```
C:/Dev/conduit/art_src/venv/Scripts/python.exe tools/characters/reanim.py [id ...] [--only clip1,clip2] [--out DIR]
C:/Dev/conduit/art_src/venv/Scripts/python.exe tools/characters/anim_check.py public/models/characters/raider_b.glb
C:/Dev/conduit/art_src/venv/Scripts/python.exe tools/characters/qa_strips.py /models/characters/raider_b.glb reload_rifle --weapon rifle --n 10
C:/Dev/conduit/art_src/venv/Scripts/python.exe tools/characters/build_review.py raider_a   # fast model review build into shots/chars/mdl
```
Added in this pass: `motion.py` (weapon prop, springs, ride layer, 120 Hz bake, velocity limiter), `clips_gunner.py`,
`clips_react.py`, `clips_driver.py`, `menace.py` (pauldrons, machete, respirator, knee pads, satchel, molotov, spiked
collar, skull, painted back emblems), `reanim.py`, `anim_check.py`, `anim_diag.py`, `qa_strips.py`, `build_review.py`.

Deterministic QA viewer: `/tools/characters/qa.html?model=/models/characters/hero_gunner.glb&anim=idle_stand&t=1.0&views=195:14,20:8&look=Spine2&dist=3&only=body,hair,eyes,armor_t2`. It supports exact clip time `t`, a grid of clip times via `times`, and hides `extras.hidden` nodes.
Also: `weapon=rifle` (weapon GLB on `socket_hand_R` at identity - the runtime contract), `lik=1` (left-arm IK onto the
weapon's `grip_L`), `wl=0.08-1.18` (weapon on `socket_hand_L` inside a clip-time window, for the throws),
`vehicle=e_buggy&seat=gunner|driver`, `rail=0.98:0.29` (a rail prop for `death_slump_rail`), `labels=1`.

## Known flaws
- Clothes are painted shells without cloth simulation. Folds are baked, and hems do not swing.
- The hero_gunner tank top is sleeveless. At extreme arm raises its armhole edge shows the body beneath.
- Hair is MakeHuman cards: short04 on the gunner, ponytail01 on the driver. The mohawk is solid tapered spikes. None of it has physics.
- No facial rig; eyes do not blink.
- The seated hero_driver's hands land about 4 cm short of the truck's rim at full reach (the runtime IK / seat shift covers it).
- `sit_shout` puts the fist out of the left window; on cars with a closed side the runtime should skip it.
- `death_slump_rail` assumes a waist-high rail 0.29 m in front; the runtime must face the body toward the nearest rail.
- The "paint" tint needs the shader hook above.

## Credits
MakeHuman 1.x base mesh, targets, default rig weights, skins, eyes, hair (short04, ponytail01), eyebrows and
eyelashes: **CC0** (makehumancommunity.org, local copy in `C:/Dev/conduit/art_src/makehuman`). Everything else
(garments, gear, textures, clips) is procedural and made for this project.
