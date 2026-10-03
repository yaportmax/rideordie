// Ten finite campaign chapters. Each becomes an endless boss arena after its
// approach distance; the space chapter is the Leviathan finale.
export const CAMPAIGN_PROTOCOL = 1;
export const MARATHON_LEVEL_LENGTH = 8000;
export const MARATHON_LEVEL_STARTS = Object.freeze(Array.from({length:10},(_,index)=>index*MARATHON_LEVEL_LENGTH));
/** Zero-based world index. Space continues indefinitely after the 80km route. */
export function marathonLevelAt(s) {
  return Number.isFinite(s)?Math.max(0,Math.min(9,Math.floor(s/MARATHON_LEVEL_LENGTH))):0;
}
export const TEN_LEVELS = Object.freeze([
  [1,'desert','SCORCHED DESERT','SCRAPJAW',5500,1,1500],
  [2,'canyon','BONE CANYON','THE BONECRUSHER TWINS',3800,1.12,2200],
  [3,'coast','DEAD COAST','MOTHER TRUCKER',4100,1.25,3000],
  [4,'mountain','FROST PASS','BLAZE',4400,1.4,4000],
  [5,'city','RUINED CITY','THE OVERSEER',4700,1.58,5200],
  [6,'dam','THE DAM','THE IRON PRIEST',5000,1.78,6500],
  [7,'underground','THE UNDERWORLD','DEEPWARDEN',5200,2,8000],
  [8,'sky','SKYWAY','STORM TALON',5500,2.25,10000],
  [9,'hell','HELL ROAD','HELLHOUND',5750,2.5,12500],
  [10,'space','VOID HIGHWAY','THE LEVIATHAN',6000,2.8,16000],
].map(([number,id,name,bossName,bossDistance,difficulty,bounty])=>Object.freeze({number,id,name,bossName,bossDistance,difficulty,bounty})));
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const boundedLevel=value=>Number.isInteger(value)&&value>=1&&value<=10?value:null;
const validRun=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);

/** Missing journey is deliberately legacy for existing tests and debug URLs. */
export function normalizeJourney(input, fallback) {
  const value=object(input), base=object(fallback);
  const mode=['campaign','marathon','legacy'].includes(value.mode)?value.mode:['campaign','marathon','legacy'].includes(base.mode)?base.mode:'legacy';
  return Object.freeze({version:1,mode,level:boundedLevel(value.level)??boundedLevel(base.level)??1});
}
export function defaultCampaignProgress() {
  return {version:1,unlockedLevel:1,cleared:[],selectedLevel:1,selectedMode:'campaign',marathonUnlocked:false,clearRuns:{}};
}
/** Wealth, vehicle inventories and the old best/boss records are separate. */
export function normalizeCampaignProgress(input) {
  const value=object(input), cleared=[...new Set((Array.isArray(value.cleared)?value.cleared:[]).filter(n=>boundedLevel(n)!==null))].sort((a,b)=>a-b);
  let contiguous=0; while(cleared.includes(contiguous+1))contiguous++;
  const unlockedLevel=Math.min(10,contiguous+1), selectedLevel=Math.min(unlockedLevel,boundedLevel(value.selectedLevel)??1);
  const clearRuns={}, used=new Set();
  for(const level of cleared) { const id=object(value.clearRuns)[level]; if(validRun(id)&&!used.has(id)) {clearRuns[level]=id;used.add(id);} }
  const marathonUnlocked=cleared.length===10, selectedMode=value.selectedMode==='marathon'&&marathonUnlocked?'marathon':'campaign';
  return {version:1,unlockedLevel,cleared,selectedLevel,selectedMode,marathonUnlocked,clearRuns};
}
export function campaignJourney(profile) {
  const progress=normalizeCampaignProgress(profile?.campaignProgress);
  return normalizeJourney({mode:progress.selectedMode,level:progress.selectedLevel});
}
export function selectCampaignLevel(profile,level,mode='campaign') {
  const progress=normalizeCampaignProgress(profile?.campaignProgress);
  if(!['campaign','marathon'].includes(mode)||boundedLevel(level)===null||level>progress.unlockedLevel||(mode==='marathon'&&!progress.marathonUnlocked))return {ok:false,reason:'locked'};
  profile.campaignProgress={...progress,selectedLevel:level,selectedMode:mode};
  return {ok:true};
}
/** Credit only a confirmed finite-level victory, once per level and run. */
export function creditCampaignLevel(profile,{runId,level,mode,won}={}) {
  if(won!==true||mode!=='campaign'||!validRun(runId)||boundedLevel(level)===null)return false;
  const progress=normalizeCampaignProgress(profile?.campaignProgress);
  if(level>progress.unlockedLevel||progress.cleared.includes(level)||Object.values(progress.clearRuns).includes(runId))return false;
  progress.cleared.push(level);progress.clearRuns[level]=runId;
  profile.campaignProgress=normalizeCampaignProgress(progress);
  return true;
}
