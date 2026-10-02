import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BIOME_AUDIO, BIOME_ORDER, AmbienceSys } from '../src/core/audio.js';
import { musicFixture } from './helpers/music-fixture.mjs';

const manifest=JSON.parse(fs.readFileSync(new URL('../public/audio/manifest.json',import.meta.url)));
const late=['underground','sky','hell','space'];

test('all ten ambience routes and explicit streamed soundtrack routes resolve existing manifest assets',()=>{
  assert.equal(BIOME_ORDER.length,10);
  for(const id of BIOME_ORDER){
    const route=BIOME_AUDIO[id];assert.ok(Object.isFrozen(route));
    const stems=Object.values(manifest.sounds).filter(d=>d.track===manifest.musicRoutes.run[id]);
    assert.equal(stems.length,1,id);assert.ok(stems.every(d=>d.kind==='run'&&d.streaming));
    for(const name of route.ambience)assert.ok(manifest.sounds['ambience/'+name],name);
    assert.ok(route.reverb>0);assert.ok(route.pressureFloor>=0&&route.pressureFloor<=1);
  }
});

test('late chapters select intended existing DnB instead of desert fallback and ramp pressure',()=>{
  const f=musicFixture();let previous=0;
  for(const id of late){
    f.music.setBiome(id);assert.equal(f.music._pick('run',{}),BIOME_AUDIO[id].track);
    f.music.setIntensity(0);assert.equal(f.music.intensity,BIOME_AUDIO[id].pressureFloor);
    assert.ok(f.music.intensity>previous);previous=f.music.intensity;
    f.music.setIntensity(1);assert.equal(f.music.intensity,1);
  }
  f.music.setBiome('desert');f.music.setIntensity(0);assert.equal(f.music.intensity,0);
});

test('shared hell/space track updates pressure without restarting or adding stems',()=>{
  const f=musicFixture();f.music.setBiome('hell');f.music.setState('run');f.advance(1);
  const bed=f.music.cur, starts=f.sources.length;
  f.music.setIntensity(0);f.music.setBiome('space');
  assert.equal(f.music.cur,bed);assert.equal(f.sources.length,starts);assert.equal(f.music.intensity,.9);
  assert.ok(bed.stems[1].target>0);assert.equal(f.music.successor,'boss_dnb');
});

test('late-stage ambience beds resolve exact existing definitions with explicit reverb',()=>{
  const defs=new Map(Object.entries(manifest.sounds).filter(([key])=>key.startsWith('ambience/')).map(([key,meta])=>[key,{key,name:key.split('/')[1],group:'ambience',category:meta.category,meta}]));
  const got=[];const A={defs,missing:new Map(),setReverbLevel:v=>got.push(v),music:{setBiome(){}},ctx:{createGain:()=>({connect(){}})},busIn:{ambience:{}},whenReady(){}};
  const ambience=new AmbienceSys(A);
  for(const id of late){
    assert.deepEqual(ambience._resolveBed(id).map(d=>d.name).sort(),[...BIOME_AUDIO[id].ambience].sort());
    ambience.setBiome(id);assert.equal(got.at(-1),BIOME_AUDIO[id].reverb);assert.equal(ambience._noBed,false);
  }
  assert.equal(A.missing.size,0);
});

test('late stage supersession retains bounded pending-load and stop contracts',()=>{
  const f=musicFixture({ready:false});f.music.setBiome('underground');f.music.setState('run');const stale=f.deferred.at(-1);
  f.music.setBiome('sky');const latest=f.deferred.at(-1);
  f.fulfill(stale);assert.equal(f.music.cur,null);f.fulfill(latest);assert.equal(f.music.cur.track.id,BIOME_AUDIO.sky.track);
  assert.equal(f.live().src,2);f.music.stop(0);f.advance(f.ctx.currentTime+2);assert.equal(f.live().src,0);
});
