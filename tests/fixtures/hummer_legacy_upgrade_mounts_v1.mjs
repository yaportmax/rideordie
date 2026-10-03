// Held historical pre-Hummer oracle. Provenance is in hummer_legacy_oracles_v1.md.
// Vehicle modifier mounts, derived from source and existing asset metadata.
// Metres in the CarView ground frame: +X left, +Y up, +Z forward.
// Panel/body positions stay in this frame. UpgradeKit converts them to the
// authored anchor frame. Tire geometry alone is generated wheel-local.
// Runtime visual/physics acceptance remains pending.

const mount = (p, anchor = 'body', size) => ({ p, anchor, ...(size ? { size } : {}) });
const sidePair = (x, y, z, height, depth, anchors = ['panel_door_L', 'panel_door_R']) => ({
  left: mount([x, y, z], anchors[0], [.08, height, depth]),
  right: mount([-x, y, z], anchors[1], [.08, height, depth]),
});

// Authored hood surface from tools/blender/vehicles/player/truck_body.py.
// Global hood max-Y is at the rear crown and would float a front-mounted
// cooler. These points are within the monotonically descending hood section;
// the inner rear corner is the highest point under its max-level base.
function legacyHood(x, z, { cowl, grille, halfWidth, rearY, frontY, crown }) {
  const px = Math.sign(x) * Math.max(0, Math.abs(x) - .205);
  const pz = z - .2375;
  const start = cowl + .014, end = grille + .035, hw = halfWidth - .007;
  const t = (pz - start) / (end - start);
  let y = rearY + (frontY - rearY) * t - .012 * Math.sin(Math.PI * t);
  y += crown * (1 - (px / hw) ** 2);
  const frontLip = pz - (end - .13), sideLip = Math.abs(px) - (hw - .07);
  if (frontLip > 0) y -= .075 * (frontLip / .13) ** 2;
  if (sideLip > 0) y -= .065 * (sideLip / .07) ** 2;
  return mount([x, y + .008, z], 'panel_hood');
}

function wheelMounts(spec) {
  const metadata = spec.model?.wheels;
  if (!metadata) throw new Error(`Missing authored wheel metadata for ${spec.id}`);
  return ['FL', 'FR', 'RL', 'RR'].map(name => {
    const w = metadata[name];
    if (!w || ![w.x, w.y, w.z, w.r, w.w].every(Number.isFinite) || w.r <= 0 || w.w <= 0) {
      throw new Error(`Invalid authored wheel ${name} for ${spec.id}`);
    }
    return { name, p: [w.x, w.y, w.z], radius: w.r, width: w.w, anchor: `wheel_${name}` };
  });
}

function sedanMounts() {
  // Positions match work/vehicle-families/mount_contract.mjs exactly.
  // Tanks are fixed to the body; a detached trunk lid is not a tank mount.
  return {
    hood: mount([-.28, 1.04, 1.55], 'panel_hood'),
    bumper: mount([0, .47, 2.60], 'panel_bumper_F', [2, .27, .23]),
    sides: sidePair(.995, .66, .17, .64, .90),
    cargoArmor: mount([0, .78, -2.53], 'panel_trunk', [1.58, .42, .08]),
    nitro: mount([-.47, 1.11, -1.94]),
    fuel: mount([.45, 1.12, -1.94]),
    oil: mount([.49, .53, -2.62], 'panel_bumper_R'),
    mines: mount([-.49, .53, -2.62], 'panel_bumper_R'),
    windshield: { bottom: [0, 1.03, .68], top: [0, 1.395, .17], width: 1.56, anchor: 'body' },
  };
}

function buggyMounts() {
  // Rear-engine charge cooler follows the actual detachable motor cover.
  return {
    hood: mount([0, 1.02, -1.34], 'panel_trunk'),
    bumper: mount([0, .52, 1.88], 'panel_bumper_F', [1.14, .39, .46]),
    sides: sidePair(.775, .51, .27, .36, 1.24, ['body', 'body']),
    nitro: mount([.36, .99, -.91]),
    fuel: mount([-.36, .99, -.91]),
    oil: mount([.28, .51, -1.91], 'panel_bumper_R'),
    mines: mount([-.28, .51, -1.91], 'panel_bumper_R'),
    // The stock buggy has a small high wind deflector whose lower edge at
    // Y=1.20 is level with the actual driver's eye (native captures ~1.20).
    // Reinforce the full cage opening down to the authored dashboard instead:
    // its upper edge is ~.972, so the purchased lower rail ends at .9705 and
    // stays below the road sightline. Top/side retainers remain visible.
    windshield: { bottom: [0, .955, .88], top: [0, 1.50, .64], width: .86, anchor: 'body' },
  };
}

function truckMounts(modelId) {
  // Coordinates below are ground-frame measurements from the existing GLBs:
  // work/visible-upgrades/asset-mount-audit.json, captured 2026-10-01.
  // Full door bounds include mirrors, so the lower-door outer skin comes from
  // truck_cab.py instead. Side plates are clear of windows and existing trim.
  switch (modelId) {
    case 'truck_t1': return {
      hood: legacyHood(-.30, 1.80, { cowl: 1.02, grille: 2.27, halfWidth: .655, rearY: 1.055, frontY: .985, crown: .03 }),
      // Existing bumper max Z=2.488; new plate face begins beyond it.
      bumper: mount([0, .49, 2.528], 'panel_bumper_F', [1.78, .27, .23]),
      sides: sidePair(.908, .81, .20, .38, 1.12),
      cargoArmor: mount([0, .84, -2.305], 'panel_tailgate', [1.60, .47, .08]),
      nitro: mount([-.53, .94, -1.83]),
      fuel: mount([.53, .93, -1.90]),
      oil: mount([.50, .48, -2.485], 'panel_bumper_R'),
      mines: mount([-.50, .48, -2.485], 'panel_bumper_R'),
      windshield: { bottom: [0, 1.092, 1.008], top: [0, 1.605, .68], width: 1.54, anchor: 'body' },
    };
    case 'truck_t2': return {
      hood: legacyHood(-.32, 2.05, { cowl: 1.14, grille: 2.55, halfWidth: .74, rearY: 1.28, frontY: 1.20, crown: .035 }),
      // Clears the authored bull bar as well as the bumper proper.
      bumper: mount([0, .603, 2.992], 'panel_bumper_F', [2.04, .35, .26]),
      sides: sidePair(1.032, .90, .24, .42, 1.28),
      cargoArmor: mount([0, 1.015, -2.605], 'panel_tailgate', [1.84, .54, .08]),
      nitro: mount([-.56, 1.12, -2.13]),
      fuel: mount([.56, 1.11, -2.20]),
      oil: mount([.55, .59, -2.785], 'panel_bumper_R'),
      mines: mount([-.55, .59, -2.785], 'panel_bumper_R'),
      windshield: { bottom: [0, 1.292, 1.128], top: [0, 1.845, .74], width: 1.74, anchor: 'body' },
    };
    case 'truck_t3': return {
      hood: legacyHood(-.32, 2.02, { cowl: 1.16, grille: 2.48, halfWidth: .75, rearY: 1.30, frontY: 1.22, crown: .03 }),
      // Existing ram tusks reach Z=3.2111. Added ram is a forward delta,
      // never another plate occupying the existing sloped ram surface.
      bumper: mount([0, .6307, 3.2511], 'panel_bumper_F', [2.24, .39, .30]),
      // Armor face X=1.062; authored vertical stiffeners end at 1.102.
      // Upgrade panels sit beyond those stiffeners, below the window slit.
      sides: sidePair(1.125, .97, .20, .44, 1.30, ['panel_armor_L', 'panel_armor_R']),
      cargoArmor: mount([0, 1.04, -2.635], 'panel_tailgate', [1.88, .54, .08]),
      nitro: mount([-.56, 1.14, -2.16]),
      fuel: mount([.56, 1.13, -2.23]),
      oil: mount([.56, .6176, -2.816], 'panel_bumper_R'),
      mines: mount([-.56, .6176, -2.816], 'panel_bumper_R'),
      // Reinforce outer glass edges only; preserve the existing armor slit.
      windshield: { bottom: [0, 1.312, 1.148], top: [0, 1.865, .76], width: 1.76, anchor: 'body' },
    };
    case 'truck_t4': return {
      // The fixed blower occupies approximately X +/-0.30, Z=1.50..2.35.
      // Max-level fins reach X=-.32475 here, outside the baked blower; the
      // front inlet ends at Z=2.6925, inside the measured hood end 2.7341.
      hood: legacyHood(-.54, 2.37, { cowl: 1.22, grille: 2.70, halfWidth: .84, rearY: 1.40, frontY: 1.30, crown: .03 }),
      // Existing plow/tusk tips reach Z=3.52, so the new face is beyond them.
      bumper: mount([0, .714, 3.56], 'panel_bumper_F', [2.70, .42, .35]),
      // The baked spiked skirts end at Y=.75. This upper-door reinforcement
      // and its optional spike rail stay above .806 m even at max level.
      // It follows the actual door rather than a lower detached skirt.
      sides: sidePair(1.15, 1.00, .24, .38, 1.36),
      cargoArmor: mount([0, 1.10, -2.835], 'panel_tailgate', [2.12, .56, .08]),
      // Rear auxiliary tanks sit above the baked ammo-box tops (Y=1.28)
      // and far behind the built-in front-of-bed transverse nitro bottles.
      nitro: mount([-.60, 1.42, -2.35]),
      fuel: mount([.60, 1.42, -2.35]),
      oil: mount([.61, .6991, -3.0222], 'panel_bumper_R'),
      mines: mount([-.61, .6991, -3.0222], 'panel_bumper_R'),
      windshield: { bottom: [0, 1.392, 1.208], top: [0, 1.965, .80], width: 1.94, anchor: 'body' },
    };
    default: return null;
  }
}

/** Returns fresh mounts for authored player models, or null for NPC models.
 * Stage aliases share the canonical model's exact physical mounting points.
 * Wheel hubs/radius/width are the GLB metadata, never global car dimensions.
 * No panel pivot is subtracted here: UpgradeKit applies the actual matrices.
 */
export function vehicleUpgradeMounts(spec) {
  if (!spec || spec.kind !== 'player') return null;
  const modelId = spec.modelId ?? spec.id;
  let mounts;
  if (/^player_sedan_t\d+$/.test(modelId)) mounts = sedanMounts();
  else if (/^player_buggy_t\d+$/.test(modelId)) mounts = buggyMounts();
  else mounts = truckMounts(modelId);
  if (!mounts) return null;
  const wheels = wheelMounts(spec);
  const suspension = wheels.map(w => mount([w.p[0] * .82, w.p[1] + .10, w.p[2]]));
  return { ...mounts, wheels, suspension };
}

export const getVehicleUpgradeMounts = vehicleUpgradeMounts;
