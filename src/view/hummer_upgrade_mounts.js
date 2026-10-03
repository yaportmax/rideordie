// Source-defined placements for the v4 wagon only. Export/native fit is pending.
// All points are in the car ground frame. UpgradeKit converts real anchor matrices.
const mount = (p, anchor = 'body', size) => ({ p, anchor, ...(size ? { size } : {}) });
export function hummerBaseUpgradeMounts(spec) {
  const metadata = spec.model;
  if (!metadata?.sockets?.upgrade_engine || !metadata.parts?.panel_windshield) throw new Error('Missing measured Hummer upgrade metadata');
  const sockets = metadata.sockets, shield = metadata.parts.panel_windshield;
  const side = (x, z, depth, anchor) => mount([x, 1.0, z], anchor, [.08, .47, depth]);
  return {
    hood: mount([...sockets.upgrade_engine], 'panel_hood'),
    bumper: mount([0, .65, metadata.parts.panel_bumper_F.max[2] + .05], 'panel_bumper_F', [2.12, .36, .26]),
    sides: { left: side(1.035, .11, 1.0, 'panel_door_L'), right: side(-1.035, .11, 1.0, 'panel_door_R'),
      leftRear: side(1.035, -1.145, .91, 'panel_door_L2'), rightRear: side(-1.035, -1.145, .91, 'panel_door_R2') },
    cargoArmor: mount([0, 1.03, -1.92], 'panel_trunk', [1.65, .48, .08]),
    nitro: mount([...sockets.part_nitro], 'part_nitro'), fuel: mount([...sockets.part_fuel], 'part_fuel'),
    oil: mount([...sockets.part_oil], 'part_oil'), mines: mount([...sockets.part_mines], 'part_mines'),
    windshield: { bottom: [0, shield.min[1], shield.min[2]], top: [0, shield.max[1], shield.min[2]],
      width: shield.max[0] - shield.min[0], anchor: 'panel_windshield' },
  };
}
