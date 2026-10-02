import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE } from '../src/data/upgrades.js';
import { normalizeProfile, creditRun, bestForJourney } from '../src/meta/profile.js';

test('ordinary chapter win pays once and improves only its own local record',()=>{
  const p=normalizeProfile({...DEFAULT_PROFILE(),cash:100,best:{distance:22000,furthestS:60000,time:800,kills:50},minibosses:{0:true}}), oldBest=structuredClone(p.best);
  const run={id:'chapter2-run',journey:{mode:'campaign',level:2},won:true,levelCleared:true,cash:35,distance:4200,furthestS:4240,time:120,kills:8,minibosses:[1,2]};
  creditRun(p,run);creditRun(p,run);
  assert.equal(p.cash,135);assert.equal(p.runs,1);assert.equal(p.wins,0);assert.equal(p.bossKilled,false);assert.deepEqual(p.best,oldBest);assert.deepEqual(p.minibosses,{0:true});
  assert.deepEqual(p.campaignRecords[2],{distance:4200,furthestS:4240,time:120,kills:8});assert.deepEqual(bestForJourney(p,{mode:'campaign',level:1}),{distance:0,furthestS:0,time:0,kills:0});
});
test('chapter records and marathon best remain independent from legacy checkpoint best',()=>{
  const p=normalizeProfile(DEFAULT_PROFILE());
  creditRun(p,{id:'legacy',cash:4,distance:10000,furthestS:60000,time:90,kills:3});
  creditRun(p,{id:'campaign',cash:5,journey:{mode:'campaign',level:4},distance:4000,furthestS:4040,time:40,kills:2});
  creditRun(p,{id:'marathon',cash:6,journey:{mode:'marathon',level:1},distance:78000,furthestS:78040,time:900,kills:80});
  assert.equal(p.cash,15);assert.equal(p.runs,3);assert.equal(p.best.furthestS,60000);assert.equal(bestForJourney(p).distance,10000);
  assert.equal(bestForJourney(p,{mode:'campaign',level:4}).furthestS,4040);assert.equal(bestForJourney(p,{mode:'marathon'}).furthestS,78040);
  const best=bestForJourney(p,{mode:'campaign',level:4});best.distance=0;assert.equal(p.campaignRecords[4].distance,4000,'getter cannot mutate saved record');
});
test('only legacy/marathon finale or explicitly cleared chapter10 marks historical final victory',()=>{
  for(const [id,journey,levelCleared,expected] of [['ordinary',{mode:'campaign',level:1},true,0],['uncleared-final',{mode:'campaign',level:10},false,0],['final',{mode:'campaign',level:10},true,1],['marathon',{mode:'marathon'},false,1],['legacy',undefined,false,1]]) {
    const p=normalizeProfile(DEFAULT_PROFILE());creditRun(p,{id,journey,levelCleared,won:true,cash:2});
    assert.equal(p.wins,expected);assert.equal(p.bossKilled,expected===1);assert.equal(p.cash,2);
  }
});
test('record normalization accepts only ten numeric chapter keys and sanitizes bad values without losing wealth',()=>{
  const p=normalizeProfile({...DEFAULT_PROFILE(),cash:777,campaignRecords:{0:{distance:3},1:{distance:20,furthestS:10,time:Infinity,kills:-2},10:{distance:50},11:{distance:100},'01':{distance:999}},marathonBest:{distance:30,furthestS:NaN,time:-1,kills:2.9}});
  assert.deepEqual(Object.keys(p.campaignRecords),['1','10']);assert.deepEqual(p.campaignRecords[1],{distance:20,furthestS:20,time:0,kills:0});assert.equal(p.cash,777);
  assert.deepEqual(p.marathonBest,{distance:30,furthestS:30,time:0,kills:2});
});
