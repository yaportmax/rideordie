// The between-runs base: the player's truck on a turntable in a dusty workshop. Rendered behind the transparent garage UI.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CarView } from '../view/car_view.js';
import { makeCarState } from '../view/car_state.js';
import { VEHICLES } from '../data/vehicles.js';
import * as Assets from '../core/assets.js';

export class GarageScene {
  constructor(renderer) {
    this.renderer = renderer;
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x0d0b0a);
    s.fog = new THREE.Fog(0x0d0b0a, 14, 34);
    const pm = new THREE.PMREMGenerator(renderer);
    s.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; s.environmentIntensity = 0.35;
    this.camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 100);
    // floor
    const tl = new THREE.TextureLoader();
    const t = (n, srgb) => { const x = tl.load(`/textures/concrete/${n}.jpg`); x.wrapS = x.wrapT = THREE.RepeatWrapping; x.repeat.set(8, 8); x.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; x.anisotropy = 8; return x; };
    const floorMat = new THREE.MeshStandardMaterial({ map: t('albedo', true), normalMap: t('normal', false), roughnessMap: t('arm', false), roughness: 1, color: 0x9a9088 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64).rotateX(-Math.PI / 2), floorMat); floor.receiveShadow = true; s.add(floor);
    // turntable
    const tt = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.3, 0.12, 64), new THREE.MeshStandardMaterial({ color: 0x1c1a18, metalness: 0.5, roughness: 0.7 }));
    tt.position.y = 0.06; tt.receiveShadow = true; s.add(tt);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.25, 0.03, 8, 96).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffc21a, emissive: 0xff8a1a, emissiveIntensity: 1.2 }));
    ring.position.y = 0.125; s.add(ring);
    this.turntable = new THREE.Group(); this.turntable.position.y = 0.12; s.add(this.turntable);
    // walls: corrugated backdrop
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a3029, roughness: 0.8, metalness: 0.4 });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 9, 48, 1, true, Math.PI * 0.6, Math.PI * 0.8), wallMat); wall.position.y = 4.5; wall.material.side = THREE.BackSide; s.add(wall);
    // lights: warm key spot, cool rim, hanging practicals
    const key = new THREE.SpotLight(0xffd7a0, 260, 30, 0.55, 0.5, 1.4); key.position.set(4, 9, 5); key.target.position.set(0, 0.5, 0); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0002; s.add(key, key.target);
    const rim = new THREE.SpotLight(0x88aaff, 140, 30, 0.6, 0.6, 1.4); rim.position.set(-6, 5, -7); rim.target.position.set(0, 1, 0); s.add(rim, rim.target);
    const fill = new THREE.HemisphereLight(0x8a7a6a, 0x201812, 0.5); s.add(fill);
    for (const [x, z] of [[-5, 4], [5, -4], [0, -8]]) {
      const lamp = new THREE.PointLight(0xffa860, 18, 12, 1.8); lamp.position.set(x, 5, z); s.add(lamp);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshStandardMaterial({ emissive: 0xffb070, emissiveIntensity: 6, color: 0 })); bulb.position.copy(lamp.position); s.add(bulb);
    }
    this.props = new THREE.Group(); s.add(this.props);
    this._props();
    this.view = null; this.truckId = null; this.paint = null; this.t = 0; this.orbit = 0.6; this.dragging = false;
    this.target = new THREE.Vector3(0, 0.55, 0); this.dist = 9.5; this.focusX = 0;
  }

  async _props() {
    const want = [['tire_stack', -5.5, 1.5, 0.3], ['barrel', -4.8, -2.2, 0], ['barrel_explosive', -5.6, -2.9, 1.1], ['crate_stack', 5.8, -2.5, -0.4], ['barrel', 5.2, 2.6, 2]];
    await Assets.preload(want.map((w) => `/models/props/${w[0]}.glb`));
    for (const [id, x, z, r] of want) { const m = Assets.clone(`/models/props/${id}.glb`); if (!m) continue; m.position.set(x, 0, z); m.rotation.y = r; m.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } }); this.props.add(m); }
  }

  /** Show a truck (spec id) with a paint colour. */
  setTruck(id, paint) {
    if (this.truckId === id && this.paint === paint && this.view) return;
    if (this.view) { this.view.dispose(); this.view = null; }
    this.truckId = id; this.paint = paint;
    const spec = VEHICLES[id];
    this.view = new CarView(spec, { paint, paint2: 0x30302e });
    this.state = makeCarState(0, id, 'player');
    this.state.pos.set(0, this.state.ride.restComHeight, 0);
    for (let i = 0; i < this.state.L.length; i++) this.state.L[i] = this.state.ride.restLen;
    this.view.update(this.state, 0);
    this.turntable.add(this.view.root);
    this.dist = 8.5 + spec.length * 0.95;
  }

  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }

  update(dt, input) {
    this.t += dt;
    this.turntable.rotation.y += dt * 0.18;
    // right stick / mouse drag orbits a little
    const pad = input?.pad;
    if (pad) this.orbit += (pad.axes[2] || 0) * dt * 1.2 * (Math.abs(pad.axes[2]) > 0.2 ? 1 : 0);
    const a = this.orbit + Math.sin(this.t * 0.12) * 0.08;
    // the UI panel sits on the left: frame the truck right of centre
    const c = this.camera;
    c.position.set(Math.sin(a) * this.dist, 2.0 + Math.sin(this.t * 0.2) * 0.1, Math.cos(a) * this.dist);
    c.lookAt(this.target);
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
