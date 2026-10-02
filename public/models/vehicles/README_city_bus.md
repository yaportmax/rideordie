# City double-decker enemy bus

`e_double_bus.glb` is a distinct cab-over two-deck chassis, not equipment attached to a truck. It has two open upper gun stations, an ordinary-scale lower driver cabin, two passenger floors, framed shattered window apertures, two roof cuts, a rear engine service grille, a side fuel tank, separate wheel hubs and a rotating steering-wheel socket.

Authoring: `tools/blender/vehicles/city/e_double_bus.py`, reusing the existing enemy_b primitive, tyre, PBR wear texture and GLB exporter helpers. Run the script directly with an explicit checkout. Existing enemy_b shell wrappers target the isolated original checkout and must not be used. There is no Cycles/GPU bake, browser launch or old-asset overwrite.

Coordinates are metres: +X left, +Y up, +Z forward, ground under the vehicle center. Actual measured bounds are X ±1.4275 (including mirrors), Y .002831 to 4.2375, Z -4.8 to 4.745. Body width is 2.50 m; total span is 9.545 m × 2.855 m. Wheels FL/FR sit at X ±1.07, Z 2.85; RL/RR at X ±1.07, Z -2.90. All hubs Y .50, measured tyre radius .497169 m. Each wheel node's local X axle spins and local Y steers through the existing CarView/Vehicle paths.

Crew sockets and spec seats agree:

- `seat_driver` [.68,.98,3.46], `steering_wheel` [.68,1.34,3.91] with `steering_wheel_mesh` child and .18m steering rim.
- `seat_gunner` [.68,2.45,2.22], `gun_mount` [.68,3.80,2.61].
- `seat_gunner2` [-.68,2.45,-1.85], `gun_mount2` [-.68,3.80,-1.46].
- Both standing crew head centers are Y 4.07 and AI muzzles Y 3.80. Upper windows and individual roof apertures provide actual gaps; crew are not scaled up to fill the bus.

The rear weak engine zone is [0,1.05,-4.18], half [.84,.34,.46]. `panel_trunk` is a hinged removable rear service grille at [0,1.43,-4.64]; `smoke_engine` and exhaust sockets sit behind it. The side fuel zone is [-.78,.76,-2.15], half [.34,.22,.65], with a visible service cap and authored `weak_fuel` socket. Base hull HP 740, mass 10000 kg and explicit bus inertia, suspension, engine limits, grip and steering are provided by `src/data/city_bus.js`. `createCityDoubleBusSpec()` creates independent nested data; `CITY_DOUBLE_BUS` is the ready catalogue entry. Importing the helper alone does not spawn or register a bus.

Close-view static body budget is four draws after production merge: shell red, shell cream, headlamps and detachable rear grille. Four moving wheel nodes each retain tyre/rim materials, plus the moving steering wheel. These dynamic draws, shadow proxy and three crew figures are separate costs and are not hidden in the body budget. Existing far LOD reduces body/wheels to one body plus four wheel meshes. Rear red lamp geometry is retained without a separate emissive tail material; night readability remains a native acceptance item.

The lossless single-asset packager uses glTF Transform dedup/prune with all named leaves retained. It preserves the rear grille's two equal-material GLB primitives so GLTFLoader keeps its panel Group, which the production loader can merge to one draw under its own hinge. No runtime codec dependency, mesh simplification, universal catalogue extraction or legacy `model_info.json` rewrite is introduced.

Current optimized asset: 1320104 bytes, SHA256 `f3dfa1a460ada7002170c056b1dc1e1af1cd3f4ac8378f5721de42b6a2418697`. Asset validation reports 0 errors and 9 generated-tangent-space warnings using the existing export convention. Empty-node infos are intentional mechanic/crew sockets. Raw export and packaging details are retained only under `work/city-double-bus-*`.

Root's source integration appends the new ID after existing vehicle IDs and gates its catalogue through network protocol 4. The Overseer encounter uses two matching HMG models because existing snapshots share one displayed weapon model between independent gunner states. WorldView now computes enemy crew culling bounds from actual chassis dimensions and standing seats; player culling keeps its existing policy. These source changes still require native verification. Initially use at most one bus, verify free initial spawn volume, lane/feature clearances and at least 4.65 m overhead clearance. Existing Director lane spacing and spawn logic do not enforce all these bounds.

This is an unshipped asset/source candidate. Root's first integrated CPU run passed the actual roof/window aperture contract, independent factory data, Car/Ghost engine/fuel/crew damage and bounded real Rapier settling/motion/steering/braking tests. The remaining geometry finiteness fixture is being corrected to inspect actual interleaved attribute components, and terminal cruising-speed convergence requires a longer bounded physical settling interval. Native appearance, animated crew/barrel fit, broader upper-deck aiming, Director-scaled handling, collisions, remote/co-op compatibility, density and frame-time cost remain pending. GLB export/validation and CPU contracts alone are not gameplay acceptance.
