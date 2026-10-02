import test from 'node:test';
import assert from 'node:assert/strict';
import { TEN_LEVELS, MARATHON_LEVEL_LENGTH, MARATHON_LEVEL_STARTS, marathonLevelAt, normalizeJourney, normalizeCampaignProgress, campaignJourney, selectCampaignLevel, creditCampaignLevel } from '../src/data/campaign.js';
import { DEFAULT_PROFILE } from '../src/data/upgrades.js';
import { normalizeProfile, creditRun } from '../src/meta/profile.js';
import { campaignSelectionMarkup, CampaignScreen } from '../src/ui/screens/campaign.js';

test('ten immutable campaign worlds end in space Leviathan with bounded finite approaches',()=>{
  assert.equal(TEN_LEVELS.length,10);assert.equal(Object.isFrozen(TEN_LEVELS),true);
  assert.deepEqual(TEN_LEVELS.map(v=>v.id),['desert','canyon','coast','mountain','city','dam','underground','sky','hell','space']);
  for(const [i,v] of TEN_LEVELS.entries()){assert.equal(v.number,i+1);assert.equal(Object.isFrozen(v),true);assert.ok(v.bossDistance>=3500&&v.bossDistance<=6000);if(i)assert.ok(v.difficulty>TEN_LEVELS[i-1].difficulty);}
  assert.match(TEN_LEVELS[9].bossName,/LEVIATHAN/);
});
test('marathon crosses ten fixed 8km worlds then remains in endless space',()=>{
  assert.equal(MARATHON_LEVEL_LENGTH,8000);assert.equal(Object.isFrozen(MARATHON_LEVEL_STARTS),true);
  assert.deepEqual(MARATHON_LEVEL_STARTS,[0,8000,16000,24000,32000,40000,48000,56000,64000,72000]);
  for(let i=1;i<10;i++){assert.equal(marathonLevelAt(i*8000-0.001),i-1);assert.equal(marathonLevelAt(i*8000),i);}
  assert.equal(marathonLevelAt(-1),0);assert.equal(marathonLevelAt(80000),9);assert.equal(marathonLevelAt(1e9),9);assert.equal(marathonLevelAt(NaN),0);
});
test('missing journey stays legacy while explicit normal campaign selection is frozen and bounded',()=>{
  assert.deepEqual(normalizeJourney(),{version:1,mode:'legacy',level:1});
  assert.deepEqual(normalizeJourney({mode:'campaign',level:11}),{version:1,mode:'campaign',level:1});
  assert.deepEqual(normalizeJourney({}, {mode:'marathon',level:4}),{version:1,mode:'marathon',level:4});
  assert.equal(Object.isFrozen(normalizeJourney({mode:'campaign',level:3})),true);
});
test('normalization does not trust claimed unlocks or marathon flag without all distinct clears',()=>{
  const p=normalizeCampaignProgress({unlockedLevel:10,selectedLevel:10,selectedMode:'marathon',marathonUnlocked:true,cleared:[1,1,2,4,0,11,'3']});
  assert.deepEqual(p.cleared,[1,2,4]);assert.equal(p.unlockedLevel,3);assert.equal(p.selectedLevel,3);assert.equal(p.selectedMode,'campaign');assert.equal(p.marathonUnlocked,false);
});
test('failed, legacy, marathon, duplicate and locked-level results cannot unlock campaign progression',()=>{
  const p=DEFAULT_PROFILE(), before=structuredClone(p);
  for(const args of [{runId:'a',level:1,mode:'campaign',won:false},{runId:'a',level:1,mode:'legacy',won:true},{runId:'a',level:1,mode:'marathon',won:true},{runId:'a',level:2,mode:'campaign',won:true},{runId:'',level:1,mode:'campaign',won:true}])assert.equal(creditCampaignLevel(p,args),false);
  assert.deepEqual(p,before);
  assert.equal(creditCampaignLevel(p,{runId:'a',level:1,mode:'campaign',won:true}),true);
  assert.equal(creditCampaignLevel(p,{runId:'a',level:2,mode:'campaign',won:true}),false);
  assert.equal(creditCampaignLevel(p,{runId:'b',level:1,mode:'campaign',won:true}),false);
  assert.equal(p.campaignProgress.unlockedLevel,2);
});
test('all ten actual unique clears unlock marathon and preserve wealth and bought gear',()=>{
  const p=DEFAULT_PROFILE();p.cash=9321;p.vehicleUpgrades.sedan.engine=2;p.weaponOptics.pistol={owned:['standard','wide_reflex'],equipped:'wide_reflex'};
  for(let level=1;level<=10;level++){assert.equal(creditCampaignLevel(p,{runId:'life-'+level,level,mode:'campaign',won:true}),true);assert.equal(p.campaignProgress.marathonUnlocked,level===10);}
  assert.equal(p.cash,9321);assert.equal(p.vehicleUpgrades.sedan.engine,2);assert.equal(p.weaponOptics.pistol.equipped,'wide_reflex');
  assert.deepEqual(p.campaignProgress.cleared,[1,2,3,4,5,6,7,8,9,10]);assert.equal(p.campaignProgress.unlockedLevel,10);
  assert.deepEqual(selectCampaignLevel(p,7,'marathon'),{ok:true});assert.deepEqual(campaignJourney(p),{version:1,mode:'marathon',level:7});
});
test('selection cannot buy an unlock, and forged result payment does not credit campaign automatically',()=>{
  const p=normalizeProfile({...DEFAULT_PROFILE(),cash:50,bossKilled:true,wins:3});
  assert.equal(p.campaignProgress.unlockedLevel,1);assert.deepEqual(selectCampaignLevel(p,2),{ok:false,reason:'locked'});
  assert.deepEqual(selectCampaignLevel(p,1,'marathon'),{ok:false,reason:'locked'});
  creditRun(p,{id:'legacy-paid',cash:12,won:true,distance:30,journey:{mode:'campaign',level:1}});
  assert.equal(p.cash,62);assert.deepEqual(p.campaignProgress.cleared,[],'root must call credit helper only on authoritative clear');
});
test('profile normalization retains existing resources and bounded campaign progress without borrowing guest ownership',()=>{
  const p=DEFAULT_PROFILE();p.cash=800;p.totalCash=1100;p.weapons.smg={dmg:1,mag:2,rel:0,hnd:0};p.vehicleUpgrades.rustbucket.ram=2;
  creditCampaignLevel(p,{runId:'first',level:1,mode:'campaign',won:true});selectCampaignLevel(p,2);
  const normalized=normalizeProfile(p);assert.equal(normalized.cash,800);assert.equal(normalized.totalCash,1100);assert.equal(normalized.weapons.smg.mag,2);assert.equal(normalized.vehicleUpgrades.rustbucket.ram,2);assert.equal(campaignJourney(normalized).level,2);
  assert.deepEqual(normalizeProfile(DEFAULT_PROFILE()).campaignProgress.cleared,[]);
});
test('selector presents exactly ten cards and locked marathon, exposes guest read-only state',()=>{
  const p=normalizeProfile(DEFAULT_PROFILE()), html=campaignSelectionMarkup(p);
  assert.equal((html.match(/class="campaign-card /g)||[]).length,10);assert.equal((html.match(/data-mode="campaign"/g)||[]).length,10);
  assert.match(html,/Clear all ten campaign levels/);assert.match(html,/THE LEVIATHAN/);
  const guest=campaignSelectionMarkup(p,{canSelect:false});assert.doesNotMatch(guest,/campaign-card f/);assert.match(guest,/The host chooses/);
  const state=CampaignScreen.prototype.selection.call({profile:p,extra:{canSelect:false}});assert.deepEqual(state,{level:1,mode:'campaign',unlockedLevel:1,marathonUnlocked:false,canSelect:false});
});
