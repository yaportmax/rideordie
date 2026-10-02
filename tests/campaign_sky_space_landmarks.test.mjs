import test from 'node:test';
import assert from 'node:assert/strict';
import { Road } from '../src/world/road.js';
import { CAMPAIGN_THEMES } from '../src/data/campaign_themes.js';
import { CampaignThemeBuilder,CAMPAIGN_CHUNK_BUDGET } from '../src/world/dressing/campaign_theme_builder.js';
import { buildSky } from '../src/world/dressing/campaign_sky.js';
import { buildSpaceLandmarks } from '../src/world/dressing/campaign_space_landmarks.js';

function fixture(id,s0,seed=31){
 const road=new Road(seed,{mode:'campaign',level:id==='sky'?8:10});road.drivingBranches=[];
 // Art scope isolates clear spans; full authored obstacle/branch acceptance is separate.
 road.featuresIn=()=>[];
 const chunk={s0,c:s0/96,ground:null,list(){throw new Error('landmarks must stay merged, not allocate instances');}};
 const builder=new CampaignThemeBuilder({road,seed},chunk,CAMPAIGN_THEMES[id],id);
 return builder;
}
function finite(builder){
 const total=builder.body.count+builder.glow.count;assert.ok(total>100);assert.ok(total<CAMPAIGN_CHUNK_BUDGET.vertices);
 for(const mb of [builder.body,builder.glow]){
  for(let i=0;i<mb.P.n;i++)assert.ok(Number.isFinite(mb.P.a[i]));
  for(let i=0;i<mb.N.n;i++)assert.ok(Number.isFinite(mb.N.a[i]));
  for(let i=0;i<mb.I.n;i++)assert.ok(mb.I.a[i]<mb.count);
 }
 return total;
}

test('sky suspended relay and cable pylons remain finite bounded merged art across anchor phases',()=>{
 for(const s0 of [0,96,384,576,1152]){const b=fixture('sky',s0);buildSky(b);finite(b);assert.equal(b.instances,0);assert.ok(b.collision.idx.length/3<CAMPAIGN_CHUNK_BUDGET.collisionTriangles);}
});

test('orbital docking-wheel landmark is actual open bounded geometry without extra physics or instances',()=>{
 const a=fixture('space',96),b=fixture('space',96);buildSpaceLandmarks(a);buildSpaceLandmarks(b);
 assert.ok(finite(a)>1000,'hero station includes rim, spokes and radiator geometry');
 assert.deepEqual(a.body.P.a.subarray(0,a.body.P.n),b.body.P.a.subarray(0,b.body.P.n));
 assert.equal(a.instances,0);assert.equal(a.collision.idx.length,0);
 // The large station is lateral scenery, not an obstacle pretending to be a shortcut.
 for(let i=0;i<a.body.P.n;i+=3){const x=a.body.P.a[i]+a.anchor.x,z=a.body.P.a[i+2]+a.anchor.z;
  assert.ok(a.road.nearest(x,z,96,170,{}).dist>12,'station must not intrude into lane');}
});

test('whole-footprint failed reservation emits no orbital station or fragment',()=>{
 const b=fixture('space',96);b.reserve=()=>false;buildSpaceLandmarks(b);assert.equal(b.body.count,0);assert.equal(b.glow.count,0);assert.equal(b.collision.idx.length,0);
});
