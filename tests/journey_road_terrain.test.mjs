import test from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { Road } from '../src/world/road.js';
import { biomeAt, BIOMES } from '../src/data/biomes.js';
import { TEN_LEVELS, MARATHON_LEVEL_STARTS } from '../src/data/campaign.js';
import { CAMPAIGN_THEMES } from '../src/data/campaign_themes.js';
import { EDGE, terrainPoint, splatAt, seaLevel, genRoadChunk } from '../src/world/terrain_gen.js';

test('missing journey preserves legacy biome and deterministic geometry',()=>{
  const a=new Road(271), b=new Road(271,{mode:'legacy',level:9});
  for(const s of [0,9700,10000,20300,50000,90000])assert.deepEqual(a.biomeAt(s),biomeAt(s));
  for(const s of [0,99,777,2300])assert.deepEqual(a.sample(s),b.sample(s));
  assert.deepEqual(a.features,b.features);
  assert.deepEqual(genRoadChunk(a,271,2),genRoadChunk(b,271,2));
});

test('campaign holds each selected theme at origin and arbitrarily late distance',()=>{
  for(const level of TEN_LEVELS){
    const input={mode:'campaign',level:level.number}, r=new Road(19,input); input.level=1;
    assert.ok(Object.isFrozen(r.journey));assert.deepEqual(r.levelStarts,[0]);
    for(const s of [0,7999,8000,50000,1e8]){
      assert.deepEqual(r.biomeAt(s),{a:level.id,b:level.id,w:0,index:level.number-1});
      assert.equal(r.journeyLevelAt(s),level.number);
      assert.deepEqual(r.params(s),(CAMPAIGN_THEMES[level.id]||BIOMES[level.id]).road);
    }
  }
});

test('marathon retains exact ten stage boundaries and blends continuously',()=>{
  const r=new Road(2,{mode:'marathon',level:7});assert.deepEqual(r.levelStarts,MARATHON_LEVEL_STARTS);
  for(let i=0;i<10;i++){
    const s=i*8000+4000; assert.equal(r.journeyLevelAt(s),i+1);assert.equal(r.biomeAt(s).a,TEN_LEVELS[i].id);
    if(i){const edge=i*8000;assert.equal(r.journeyLevelAt(edge-1e-5),i);assert.equal(r.journeyLevelAt(edge),i+1);
      const before=r.params(edge-1e-5),after=r.params(edge+1e-5);for(const k of Object.keys(before))assert.ok(Math.abs(before[k]-after[k])<1e-4,k);
      assert.equal(r.biomeAt(edge).w,.5);
    }
  }
  assert.deepEqual(r.biomeAt(1e8),{a:'space',b:'space',w:0,index:9});
});

test('custom themes have solid exact road seams and real finite terrain profiles',()=>{
  for(const level of TEN_LEVELS.slice(6)){
    const r=new Road(23,{mode:'campaign',level:level.number});r.drivingBranches=[];r.features=[];
    const sm=r.sample(150,{}), heights=[];
    for(const side of [-1,1]){
      const seam=terrainPoint(r,23,150,side*EDGE,{},[],[]);assert.equal(seam.y,r.surfaceY(sm,side*EDGE));
      for(const offset of [1,3.3,20,50,120]){const p=terrainPoint(r,23,150,side*(EDGE+offset),{},[],[]);assert.ok(Number.isFinite(p.y));heights.push(p.y-sm.y);}
    }
    assert.ok(Math.max(...heights)-Math.min(...heights)>10,level.id);
    const w=new Float32Array(12);splatAt(w,23,150,4,1,.1,sm.x,sm.y,sm.z,-1e4,r.biomeAt(150));
    assert.ok(Math.abs(w.reduce((a,b)=>a+b,0)-1)<1e-6);assert.ok(w[3]===0,'no legacy dry grass default');
  }
});

test('campaign water query samples its own local chapter instead of legacy 60 km',()=>{
  for(const [level,id] of [[3,'coast'],[6,'dam']]){
    const r=new Road(17,{mode:'campaign',level});assert.ok(Number.isFinite(seaLevel(r,id)));assert.ok(r.sEnd<10000);
  }
});


test('actual worker init forwards immutable campaign context into independent Road',async()=>{
  const workerURL=new URL('../src/world/terrain_worker.js',import.meta.url);
  let source=await readFile(workerURL,'utf8');
  source=source.replace("import { Road } from './road.js';",`import { Road as ActualRoad } from '${new URL('../src/world/road.js',import.meta.url).href}';
    class Road extends ActualRoad { constructor(...args){super(...args);globalThis.__journeyWorkerRoad=this;} }`);
  source=source.replace("from './terrain_gen.js'",`from '${new URL('../src/world/terrain_gen.js',import.meta.url).href}'`);
  const previousSelf=globalThis.self, messages=[];globalThis.self={postMessage:m=>messages.push(m)};
  try {
    await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    const input={version:1,mode:'campaign',level:8};globalThis.self.onmessage({data:{type:'init',seed:52,journey:input}});
    const actual=globalThis.__journeyWorkerRoad, authority=new Road(52,input);
    input.level=1;assert.ok(Object.isFrozen(actual.journey));assert.deepEqual(actual.journey,authority.journey);
    assert.equal(actual.biomeAt(24000).a,'sky');assert.deepEqual(actual.sample(600),authority.sample(600));
    assert.deepEqual(messages,[{type:'ready'}]);
  } finally {globalThis.self=previousSelf;delete globalThis.__journeyWorkerRoad;}
});


test('real volcanic terrain remains below unbanked molten channels on both sides',()=>{
  const road=new Road(23,{mode:'campaign',level:9});road.drivingBranches=[];road.features=[];
  for(const s of [150,510,1230]){
    const center=road.sample(s,{});
    for(const side of [-1,1])for(const d of [30,60,90,110]){
      const p=terrainPoint(road,23,s,side*d,{},[],[]);
      assert.ok(p.y<center.y-24,`lava floor buried at ${s}/${side*d}: ${p.y-center.y}`);
    }
    const seam=terrainPoint(road,23,s,EDGE,{},[],[]);assert.equal(seam.y,road.surfaceY(center,EDGE));
  }
});
