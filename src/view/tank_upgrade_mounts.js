// HELD tank ground-frame mounts. Actual exported anchors are mandatory.
const mount = (p, anchor = 'body', size) => ({ p, anchor, ...(size ? { size } : {}) });
export function tankBaseUpgradeMounts(spec) {
  const md = spec.model, s = md?.sockets, glass = md?.parts?.panel_windshield;
  if (!s?.upgrade_engine || !glass || !md.parts.part_track_L || !md.parts.part_track_R) throw new Error('Missing actual tank upgrade geometry');
  return {
    hood: mount([...s.upgrade_engine], 'panel_hood'),
    bumper: mount([0, .79, md.parts.panel_bumper_F.max[2] + .05], 'panel_bumper_F', [2.60, .39, .30]),
    sides: { left: mount([1.17, 1.19, -.20], 'panel_door_L', [.085, .42, 4.0]),
      right: mount([-1.17, 1.19, -.20], 'panel_door_R', [.085, .42, 4.0]) },
    cargoArmor: mount([0, .99, -2.59], 'panel_trunk', [1.90, .44, .08]),
    nitro: mount([...s.part_nitro], 'part_nitro'), fuel: mount([...s.part_fuel], 'part_fuel'),
    oil: mount([...s.part_oil], 'part_oil'), mines: mount([...s.part_mines], 'part_mines'),
    windshield: { bottom: [0, glass.min[1], glass.min[2]], top: [0, glass.max[1], glass.min[2]],
      width: glass.max[0] - glass.min[0], anchor: 'panel_windshield' },
    // Suppress generic rubber tire tread geometry. Bought track reinforcement
    // is authored by TrackedTankView and wheel-local tensioner caps below.
    wheels: [], suspension: [],
    trackTensioners: ['FL', 'FR', 'RL', 'RR'].map(name => ({ name, p: [0, 0, 0], anchor: `wheel_${name}`,
      radius: md.wheels[name].r, width: md.wheels[name].w, side: Math.sign(md.wheels[name].x) })),
  };
}

export function appendTankTensionerPlan(plan, mounts) {
  const level = plan.levels.tires;
  if (!level) return plan;
  const extra = [];
  for (const m of mounts.trackTensioners) {
    extra.push({ upgrade: 'tires', shape: 'cylinder', anchor: m.anchor,
      p: [m.side * (m.width / 2 + .015), 0, 0], size: [.12 + .016 * level, .025, .12 + .016 * level],
      surface: 'bare', rotation: [0, 0, Math.PI / 2] });
    for (let i = 0; i < level + 2; i++) {
      const a = i * Math.PI * 2 / (level + 2);
      extra.push({ upgrade: 'tires', shape: 'box', anchor: m.anchor,
        p: [m.side * (m.width / 2 + .028), Math.sin(a) * m.radius * .58, Math.cos(a) * m.radius * .58],
        size: [.022, .032, .040], surface: level >= 3 ? 'bare' : 'steel', rotation: [-a, 0, 0] });
    }
  }
  const parts = [...plan.parts, ...extra];
  return { ...plan, parts, ids: [...new Set(parts.map(p => p.upgrade))], estimatedDraws: new Set(parts.map(p => p.anchor)).size };
}
