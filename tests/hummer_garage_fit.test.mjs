// AUTHORED, UNRUN. Stage this with its source files in the complete Hummer
// candidate before root runs it. CPU geometry/matrix proof is not native pixels,
// texture decode, driver handling, frame timing or art acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import * as Assets from '../src/core/assets.js';
import { VEHICLES, vehicleModelURL } from '../src/data/vehicles.js';
import { HUMMER_BASE_CAPS } from '../src/data/hummer_base.js';
import { GarageScene } from '../src/game/garage_scene.js';
import { HummerGarageEnvelope, hummerGarageFitDistance } from '../src/game/hummer_garage_fit.js';
import { weaponOpticKey } from '../src/data/weapon_optics.js';
import { MOUNTED_MINIGUN_MODEL } from '../src/view/mounted_gun.js';

const baseline = readFileSync(new URL('./fixtures/hummer-garage-fit-baseline.txt', import.meta.url), 'utf8');
const legacyMethods = baseline.slice(baseline.indexOf('  _subject(v, out) {'), baseline.indexOf('  _snapCamera()'));
const legacyViews = baseline.slice(baseline.indexOf('const VIEWS = ') + 14, baseline.indexOf('\n};', baseline.indexOf('const VIEWS = ')) + 2);
const views = Function('return (' + legacyViews + ')')();
const Legacy = Function('THREE', 'VEHICLES', '_v', 'wrapPi', 'damp', 'return class {' + legacyMethods + '}')(
  THREE, VEHICLES, new THREE.Vector3(), a => Math.atan2(Math.sin(a), Math.cos(a)), (k,dt) => 1-Math.exp(-k*dt));

const urls = [vehicleModelURL('player_hummer_t1'), '/models/characters/hero_driver.glb',
  '/models/characters/hero_gunner.glb', '/models/weapons/pistol.glb', MOUNTED_MINIGUN_MODEL];
const saved = { fetch: globalThis.fetch, Request: globalThis.Request, self: globalThis.self,
  createImageBitmap: globalThis.createImageBitmap, ProgressEvent: globalThis.ProgressEvent };
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, data: new Uint8Array([255,255,255,255]) });
globalThis.ProgressEvent = class { constructor(type,props) { this.type=type; Object.assign(this,props); } };
globalThis.Request = class extends saved.Request {
  constructor(url,opts) { super(typeof url==='string' && url.startsWith('/') ? 'http://garage-fit.local'+url : url,opts); }
};
globalThis.fetch = async request => {
  const url = new URL(typeof request==='string' ? request : request.url);
  if (url.origin !== 'http://garage-fit.local') return saved.fetch(request);
  return new Response(readFileSync(new URL('../public'+url.pathname,import.meta.url)),{headers:{'Content-Type':'application/octet-stream'}});
};
try { await Assets.preload(urls); }
finally { for (const [key,value] of Object.entries(saved)) { if (value===undefined) delete globalThis[key]; else globalThis[key]=value; } }

const frames = [
  { w:1280,h:720,rect:{l:394.6666793823242,r:928,t:109.33333587646484,b:583.3333740234375} },
  { w:960,h:540,rect:{l:298,r:694,t:82,b:436} },
  { w:1280,h:720,rect:{l:460,r:830,t:170,b:560} },
];
function viewport(t,frame) {
  const old={innerWidth:globalThis.innerWidth,innerHeight:globalThis.innerHeight};
  globalThis.innerWidth=frame.w;globalThis.innerHeight=frame.h;
  t.after(()=>{for(const [key,value]of Object.entries(old)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
}
function cameraState(fov=30) { return {tx:0,ty:1,tz:0,az:.5,el:.13,dist:14,fov}; }
function fixture(t,levels={},weapon='pistol') {
  const cam=cameraState(), scene=new THREE.Scene(), turntable=new THREE.Group();scene.add(turntable);
  const garage=Object.assign(Object.create(GarageScene.prototype),{
    scene,turntable,ttDisc:new THREE.Group(),camera:new THREE.PerspectiveCamera(30,innerWidth/innerHeight,.1,1500),
    cam,goal:{...cam},t:0,orbit:0,turn:.4,turnVel:.16,present:null,tab:'truck',drop:0,
    crew:[],crewQ:new THREE.Quaternion(),paint:0x8f6a3d,base:{truck:'player_hummer_t1',paint:0x8f6a3d,weapon,opticId:'standard',upgradeLevels:levels},
    preview:{},benchId:weaponOpticKey(weapon,'standard'),benchWeapon:null,ringPulse:0,
    ringMat:{emissiveIntensity:0},renderer:{getPixelRatio:()=>1},
    set:{motes:{mat:{uniforms:{uTime:{},uPx:{}}}},rayMat:{}},sparks:{update(){}}
  });
  garage._apply();garage.drop=0;
  assert.equal(garage.view.usesModel,true);assert.ok(garage.crew.every(c=>c.rigged),'load both actual hero models');
  t.after(()=>{for(const crew of garage.crew)crew.dispose();garage.view.dispose();});
  return garage;
}
function assertCorners(garage,frame,label) {
  garage.camera.updateMatrixWorld(true);
  const box=garage.hummerEnvelope.box;
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
    const ndc=new THREE.Vector3(x,y,z).applyMatrix4(garage.turntable.matrixWorld).project(garage.camera);
    const px=(ndc.x+1)*frame.w/2,py=(1-ndc.y)*frame.h/2;
    assert.ok(ndc.z>-1&&ndc.z<1,label+' clipping planes');
    assert.ok(px>=frame.rect.l-1e-7&&px<=frame.rect.r+1e-7&&py>=frame.rect.t-1e-7&&py<=frame.rect.b+1e-7,
      label+': envelope corner '+px+','+py+' must fit '+JSON.stringify(frame.rect));
  }
}
function assertActualVertices(garage,label) {
  const inv=new THREE.Matrix4().copy(garage.turntable.matrixWorld).invert(),point=new THREE.Vector3(),matrix=new THREE.Matrix4();
  garage.view.root.traverseVisible(mesh=>{
    if(!mesh.isMesh)return;
    matrix.multiplyMatrices(inv,mesh.matrixWorld);
    const position=mesh.geometry.attributes.position;
    for(let i=0;i<position.count;i++){
      mesh.getVertexPosition(i,point);point.applyMatrix4(matrix);
      assert.ok(garage.hummerEnvelope.box.containsPoint(point),label+': actual posed vertex must lie inside the cached-bone envelope');
    }
  });
}

test('sphere fit covers nearer points at native, smaller and narrower free rectangles',()=>{
  for(const frame of frames)for(const fov of [28,30,60])for(const radius of [.5,3.2,5]){
    const d=hummerGarageFitDistance(radius,fov,frame.w,frame.h,frame.rect);
    const cam=new THREE.PerspectiveCamera(fov,frame.w/frame.h,.1,1500);cam.position.z=d;cam.lookAt(0,0,0);
    const cx=(frame.rect.l+frame.rect.r)/2,cy=(frame.rect.t+frame.rect.b)/2;
    cam.setViewOffset(frame.w,frame.h,-(cx-frame.w/2),-(cy-frame.h/2),frame.w,frame.h);cam.updateMatrixWorld(true);
    for(let y=-12;y<=12;y++)for(let x=0;x<48;x++){
      const pitch=y*Math.PI/24,yaw=x*Math.PI/24;
      const ndc=new THREE.Vector3(Math.cos(pitch)*Math.sin(yaw)*radius,Math.sin(pitch)*radius,Math.cos(pitch)*Math.cos(yaw)*radius).project(cam);
      const px=(ndc.x+1)*frame.w/2,py=(1-ndc.y)*frame.h/2;
      assert.ok(px>=frame.rect.l-1e-7&&px<=frame.rect.r+1e-7&&py>=frame.rect.t-1e-7&&py<=frame.rect.b+1e-7);
    }
  }
  assert.throws(()=>hummerGarageFitDistance(3,30,1280,720,{l:600,r:500,t:0,b:720}));
});

test('actual loaded Hummer, paid kit and posed crew fit all yaw corners during ordinary camera easing',t=>{
  viewport(t,frames[0]);
  for(const levels of [{},{engine:4,armor:5},{engine:4,armor:5,tires:2},HUMMER_BASE_CAPS]){
    const garage=fixture(t,levels);
    for(const frame of frames.slice(0,2)){
      globalThis.innerWidth=frame.w;globalThis.innerHeight=frame.h;garage.camera.aspect=frame.w/frame.h;garage.setFrameRect(frame.rect);
      for(const tab of ['truck','upgrades','paint']){
        garage.setTab(tab);
        for(const yaw of [0,Math.PI/4,Math.PI/2,Math.PI,3*Math.PI/2]){
          garage.turn=yaw;garage.turnVel=0;garage._garage(1/60);
          assertCorners(garage,frame,tab+' yaw'+yaw);
          assertActualVertices(garage,tab+' yaw'+yaw);
        }
      }
    }
  }
});

test('genuine crew idle skin transforms stay inside cached influences and enlarged kit refits outward on its first frame',t=>{
  viewport(t,frames[0]);const garage=fixture(t);garage.setFrameRect(frames[0].rect);
  for(let frame=0;frame<180;frame++){
    garage._garage(1/60);
    if(frame%30===0){assertActualVertices(garage,'idle frame'+frame);assertCorners(garage,frames[0],'idle frame'+frame);}
  }
  const prior=garage.hummerEnvelope,crewRecords=prior.crews.map(c=>c.records),oldDistance=garage.cam.dist;
  garage.base.upgradeLevels=HUMMER_BASE_CAPS;garage._apply();assert.notEqual(garage.hummerEnvelope,prior);
  assert.deepEqual(garage.hummerEnvelope.crews.map(c=>c.records),crewRecords,'kit changes reuse crew influence cache');
  garage.cam.dist=oldDistance/3;garage._garage(1/60);
  assertCorners(garage,frames[0],'first enlarged-kit frame');assertActualVertices(garage,'first enlarged-kit frame');
  assert.ok(garage.hummerEnvelope.meshCount>prior.meshCount,'actual installed kit extends the measured content set');
});

test('actual crew-owned deck minigun follows current yaw and pitch without becoming cached static truck geometry',t=>{
  viewport(t,frames[0]);const garage=fixture(t,HUMMER_BASE_CAPS,'minigun');garage.setFrameRect(frames[0].rect);
  garage._garage(1/60);
  const mounted=garage.gunnerCrew.weapon;assert.equal(mounted.mounted,true);assert.equal(mounted.fallback,false);
  assert.equal(mounted.root.parent,garage.view.root,'actual deck API owns a car-root rig, outside crew.root');
  assert.ok(garage.hummerEnvelope.crews.some(record=>record.root===mounted.root),'separately owned moving rig must use current transforms');
  for(const yaw of [-Math.PI,-Math.PI/2,0,Math.PI/2,Math.PI])for(const pitch of [-1.15,0,1.2]){
    mounted.yawJoint.rotation.y=yaw;mounted.pitchJoint.rotation.x=pitch;
    garage._cameraRig(1/60,views.truck);
    assertActualVertices(garage,'actual mounted yaw'+yaw+' pitch'+pitch);
    assertCorners(garage,frames[0],'actual mounted yaw'+yaw+' pitch'+pitch);
  }
});

test('source baseline remains numerically identical for other chassis, gunner, handheld and mounted bench framing',t=>{
  viewport(t,frames[0]);
  for(const subject of ['truck','upgrades','paint','gunner','weapons']){
    for(const mounted of [false,true]){
      const make=()=>{const cam=cameraState(28);return Object.assign(Object.create(GarageScene.prototype),{
        spec:VEHICLES.player_sedan_t1,cam,goal:{...cam},camera:new THREE.PerspectiveCamera(28,16/9,.1,1500),
        t:0,orbit:.12,frameRect:frames[0].rect,gunnerCrew:{root:new THREE.Object3D()},
        benchWeapon:{view:{mounted},root:{userData:{base:new THREE.Vector3(-7,1.2,0),size:1.2,framingRadius:1.5}}}
      });};
      const actual=make(),legacy=make();Object.setPrototypeOf(legacy,Legacy.prototype);
      for(let frame=0;frame<60;frame++){
        actual.t=legacy.t=frame/60;
        GarageScene.prototype._cameraRig.call(actual,1/60,views[subject]);
        Legacy.prototype._cameraRig.call(legacy,1/60,views[subject]);
        assert.deepEqual(actual.cam,legacy.cam);assert.deepEqual(actual.goal,legacy.goal);
        assert.deepEqual(actual.camera.position.toArray(),legacy.camera.position.toArray());
        assert.deepEqual(actual.camera.quaternion.toArray(),legacy.camera.quaternion.toArray());
        assert.deepEqual(actual.camera.projectionMatrix.toArray(),legacy.camera.projectionMatrix.toArray());
      }
      assert.equal(actual.hummerEnvelope,undefined);
    }
  }
});

