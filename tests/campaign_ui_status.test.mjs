import test from 'node:test';
import assert from 'node:assert/strict';
import { ResultsScreen, resultJourneyStatus } from '../src/ui/screens/results.js';
import { GarageScreen, garageJourneyStatus } from '../src/ui/screens/garage.js';
import { DEFAULT_PROFILE } from '../src/data/upgrades.js';
import { creditCampaignLevel, selectCampaignLevel } from '../src/data/campaign.js';
import { normalizeProfile } from '../src/meta/profile.js';
const screen=(run,p)=>Object.assign(Object.create(ResultsScreen.prototype),{run:{time:0,distance:0,...run},profile:p,win:!!run.won,ui:{settings:{units:'mi'}},safe:{innerHTML:'',querySelector:()=>({style:{}})}});
const progressed=n=>{const p=DEFAULT_PROFILE();for(let level=1;level<=n;level++)creditCampaignLevel(p,{runId:'clear-'+level,level,mode:'campaign',won:true});return p;};

test('finite chapter victory names its actual boss and next unlock without claiming campaign completion',()=>{
  const p=progressed(2),r=screen({journey:{mode:'campaign',level:2},won:true,furthestS:4200},p);r.build();
  assert.match(r.safe.innerHTML,/LEVEL CLEARED/);assert.match(r.safe.innerHTML,/THE BONECRUSHER TWINS DEFEATED/);assert.match(r.safe.innerHTML,/NEXT · LEVEL 3 · DEAD COAST/);
  assert.doesNotMatch(r.safe.innerHTML,/CAMPAIGN COMPLETE|THE LEVIATHAN IS DEAD|ROUTE TO THE LEVIATHAN|TO GO/);
  assert.equal(r.routePct,100);
});
test('finite failure maps current theme and only its boss approach, independent of legacy global best',()=>{
  const r=screen({journey:{mode:'campaign',level:8},cause:'Rammed',furthestS:2750}, normalizeProfile({...DEFAULT_PROFILE(),best:{furthestS:60000,distance:60000}}));r.build();
  assert.match(r.safe.innerHTML,/LEVEL 8\/10 · SKYWAY/);assert.match(r.safe.innerHTML,/CAUSE OF DEATH/);assert.equal(r.routePct,50);
  assert.doesNotMatch(r.routeHtml(),/THE DAM|THE LEVIATHAN|rt-best|rt-mini/);
});
test('finale announces marathon only after verified ten distinct clears',()=>{
  const p=progressed(9),run={journey:{mode:'campaign',level:10},won:true};
  let html=screen(run,p).campaignHtml();assert.match(html,/FINALE CLEARED/);assert.doesNotMatch(html,/MARATHON UNLOCKED|CAMPAIGN COMPLETE/);
  creditCampaignLevel(p,{runId:'clear-10',level:10,mode:'campaign',won:true});
  html=screen(run,p).campaignHtml();assert.match(html,/MARATHON UNLOCKED/);assert.match(html,/ALL TEN LEVELS CLEARED/);assert.match(html,/THE LEVIATHAN DEFEATED/);
});
test('marathon shows ten fixed route worlds and endless space after80km',()=>{
  const r=screen({journey:{mode:'marathon',level:1},furthestS:80000},DEFAULT_PROFILE()),html=r.routeHtml();
  assert.equal((html.match(/class="rt-seg"/g)||[]).length,10);assert.match(html,/TEN-WORLD MARATHON/);assert.match(html,/ENDLESS SPACE/);assert.equal(r.routePct,100);
  assert.doesNotMatch(html,/rt-mini|TO GO/);
});
test('legacy victory retains the original Leviathan and campaign-complete presentation',()=>{
  const r=screen({won:true,furthestS:60000},DEFAULT_PROFILE());r.build();
  assert.match(r.safe.innerHTML,/THE LEVIATHAN IS DEAD/);assert.match(r.safe.innerHTML,/CAMPAIGN COMPLETE/);assert.match(r.routeHtml(),/ROUTE TO THE LEVIATHAN/);
  assert.equal(resultJourneyStatus({won:true}).journey.mode,'legacy');
});
test('garage selection labels preserve host-selected chapter and distinguish marathon from legacy',()=>{
  const p=progressed(3);selectCampaignLevel(p,4);
  assert.match(garageJourneyStatus(p).label,/LEVEL 4\/10 · FROST PASS/);assert.equal(garageJourneyStatus(p).boss,'BLAZE');
  assert.equal(garageJourneyStatus(p,{journey:{mode:'legacy'}}).label,'LEGACY HIGHWAY');
  assert.equal(garageJourneyStatus(p,{journey:{mode:'marathon',level:1}}).label,'MARATHON · TEN WORLDS');
});
test('guest garage selector opens read-only view through callback without mutating gear or readiness',()=>{
  let opened=0;const p=DEFAULT_PROFILE(),before=structuredClone(p);
  const s=Object.assign(Object.create(GarageScreen.prototype),{p,extra:{isHost:false},cb:{onCampaign(){opened++;}},ui:{snd(){}}});
  s.onClick({target:{closest:()=>({dataset:{campaign:'1'}})}});
  assert.equal(opened,1);assert.deepEqual(p,before);assert.deepEqual(s.extra,{isHost:false});
});
