import subprocess, json, sys
REQ = {
 'e_van': "body wheel_FL wheel_FR wheel_RL wheel_RR panel_hood panel_door_L panel_door_R panel_bumper_F panel_bumper_R panel_tailgate panel_fender_L panel_fender_R panel_armor_L panel_armor_R seat_driver steering_wheel seat_gunner light_head_L light_head_R light_tail_L light_tail_R exhaust_L exhaust_R smoke_engine fuel_cap nitro_L nitro_R camera_hood roof_top",
 'e_heavy': "body wheel_FL wheel_FR wheel_ML wheel_MR wheel_RL wheel_RR panel_hood panel_door_L panel_door_R panel_bumper_F panel_bumper_R panel_tailgate panel_fender_L panel_fender_R panel_armor_L panel_armor_R seat_driver steering_wheel seat_gunner seat_gunner2 gun_mount light_head_L light_head_R light_tail_L light_tail_R exhaust_L exhaust_R smoke_engine fuel_cap nitro_L nitro_R camera_hood roof_top",
 'e_tanker': "body wheel_FL wheel_FR wheel_ML wheel_MR wheel_RL wheel_RR wheel_RL2 wheel_RR2 panel_hood panel_door_L panel_door_R panel_bumper_F panel_bumper_R panel_fender_L panel_fender_R panel_armor_L panel_armor_R panel_stack_L panel_stack_R seat_driver steering_wheel seat_gunner light_head_L light_head_R light_tail_L light_tail_R exhaust_L exhaust_R smoke_engine fuel_cap nitro_L nitro_R camera_hood roof_top",
 'boss_warrig': "body wheel_FL wheel_FR wheel_ML wheel_MR wheel_RL wheel_RR wheel_R2L wheel_R2R wheel_T1L wheel_T1R wheel_T2L wheel_T2R seat_driver steering_wheel seat_gunner seat_gunner2 seat_gunner3 seat_gunner4 turret_1 turret_2 turret_main muzzle_main rocket_pod_L rocket_pod_R flame_L flame_R ramp_rear weak_engine part_turret_1 part_turret_2 part_turret_main part_pod_L part_pod_R part_plow part_stack_L part_stack_R part_engine part_tank_L part_tank_R panel_hood panel_armor_rear_1 panel_armor_rear_2 panel_armor_rear_3 smoke_stack_L smoke_stack_R smoke_engine exhaust_L exhaust_R nitro_L nitro_R fuel_cap roof_top light_head_L light_head_R light_tail_L light_tail_R floodlight_1 floodlight_2 floodlight_3 floodlight_4",
}
ids = sys.argv[1:] or list(REQ)
for i in ids:
    out = subprocess.run(['node', 'tools/test/shot.mjs', 'viewer.html?model=/models/vehicles/%s.glb' % i, 'shots/enemy_b/_chk.png', '--quiet',
                          '--eval=JSON.stringify({tris:window.__viewer.tris,bbox:window.__viewer.bbox,names:window.__viewer.nodes.map(n=>n.path.split("/").pop()),mats:window.__viewer.materials})'],
                         capture_output=True, text=True, cwd='C:/Dev/rideordie').stdout
    line = [l for l in out.split('\n') if l.startswith('[eval]')]
    if not line:
        print(i, 'NO EVAL', out[-300:]); continue
    d = json.loads(json.loads(line[0][7:]))
    names = set(d['names'])
    miss = [n for n in REQ[i].split() if n not in names]
    print(i, 'tris', d['tris'], 'bbox', d['bbox']['size'], 'min', d['bbox']['min'], 'max', d['bbox']['max'])
    print('   missing:', miss)
    print('   mats:', d['mats'])
