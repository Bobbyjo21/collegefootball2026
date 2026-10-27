import fs from 'node:fs/promises';
import { normalizeData } from './normalize.mjs';
import { summarizeRedZone } from './red-zone.mjs';

const apiKey = process.env.CFBD_API_KEY;
if (!apiKey) throw Error('CFBD_API_KEY secret required');
const season = Number(process.env.CFB_SEASON || 2025);
const API = 'https://api.collegefootballdata.com';
async function get(path, p = {}) {
  const url = new URL(API + path);
  for (const [key, value] of Object.entries(p)) if (value !== undefined) url.searchParams.set(key, String(value));
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {headers:{Authorization:'Bearer '+apiKey}});
    if (response.ok) return response.json();
    const message = await response.text();
    if (response.status !== 429 && response.status < 500) throw Error(path+' '+response.status+' '+message.slice(0,180));
    if (attempt === 2) throw Error(path+' '+response.status+' '+message.slice(0,180));
    await new Promise(resolve => setTimeout(resolve, 1500*(attempt+1)));
  }
}
async function optional(label, path, params) {
  try { return await get(path,params); }
  catch(error) { console.warn(label+' unavailable: '+error.message); return []; }
}
const pp = (year,week) => ({year,week,seasonType:'both',classification:'fbs'});
const [teams,venues,games,lines,ratings,talent,returning] = await Promise.all([
  get('/teams/fbs',{year:season}),get('/venues'),
  get('/games',{year:season,seasonType:'both',classification:'fbs'}),
  get('/lines',{year:season,seasonType:'both'}),
  optional('CORE','/ratings/core',{year:season}),
  optional('talent','/talent',{year:season}),
  optional('returning','/player/returning',{year:season})
]);
if (!Array.isArray(lines) || lines.length < 100) throw Error('Insufficient historical odds; aborting without fabricated grades');
const completed = games.filter(g=>g.completed && Number.isFinite(g.homePoints) && Number.isFinite(g.awayPoints));
const weeks = [...new Set(completed.map(g=>g.week))].filter(w=>Number.isInteger(w)).sort((a,b)=>a-b);
const lineMap = new Map(lines.map(g=>[String(g.id),g.lines||[]]));
const csv = [['Week','Date','Away','Home','Closing spread (home)','Provider','Projected away','Projected home','Projected home margin','Pick','Final away','Final home','Result','Model edge (pts)','Prior games used']];
const results = []; const missing = []; const errors = [];
const normalizeName = s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const html = await fs.readFile('index.html','utf8');
let script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!script || !script.includes('function simulate()')) throw Error('Site simulator not found');
script = script.replace(/\bboot\(\);\s*$/,'');
const start = script.indexOf('let aw=0,hw=0',script.indexOf('function simulate()'));
const end = script.indexOf('\nfunction bind()',start);
if (start<0||end<0) throw Error('Simulator projection capture points changed');
script = script.slice(0,start)+'return {modelMargin,projectedTotal,targetA,targetH};}\n'+script.slice(end);
script += '\nliveData=historicalData;loadTeams();return {teams,predict:(awayId,homeId)=>{elements.away.value=awayId;elements.home.value=homeId;return simulate();}};';
function engine(historicalData) {
 const elements = {};
 const defaults = {awayRest:7,homeRest:7,temp:70,wind:5,vol:10};
 for (const name of ['away','home','sims','neutral','awayRest','homeRest','temp','wind','vol','indoors','precip','pace','awayTravel','homeTravel','awayZones','homeZones','altitude','awayQb','homeQb','awayInj','homeInj','awayAdj','homeAdj']) {
   elements[name] = {value:defaults[name]??0,checked:false};
 }
 const document = {getElementById:id=>elements[id] ||= {value:0,checked:false},querySelector:()=>({value:'balanced'})};
 const localStorage = {getItem:()=>null,setItem:()=>{}};
 return new Function('historicalData','elements','document','localStorage','alert','confirm','fetch','Blob',script)(
 historicalData,elements,document,localStorage,()=>{},()=>false,()=>{},class {});
}
function chooseLine(items) {
 const valid=items.filter(l=>Number.isFinite(Number(l.spread)) && l.spread!==null && l.spread!=='' && l.provider);
 const rank=p=> {const x=String(p).toLowerCase();if(x.includes('consensus'))return 0;if(x.includes('bovada'))return 1;if(x.includes('draftkings'))return 2;if(x.includes('caesars'))return 3;if(x.includes('fanduel'))return 4;return 10};
 valid.sort((a,b)=>rank(a.provider)-rank(b.provider)||String(a.provider).localeCompare(String(b.provider)));
 return valid[0];
}
const boxes=[];const rz={};let rzGood=true;
for (const week of weeks) {
 const prior=week-1;
 const [basic,advanced] = prior>=1 ? await Promise.all([
  optional('basic through week '+prior,'/stats/season',{year:season,endWeek:prior,classification:'fbs'}),
  optional('advanced through week '+prior,'/stats/season/advanced',{year:season,endWeek:prior,classification:'fbs',excludeGarbageTime:true})
 ]) : [[],[]];
 const historicRatings = new Map();
 for (const rating of ratings) {
   if (!Number.isFinite(Number(rating.throughWeek)) || Number(rating.throughWeek)>prior) continue;
   const prev=historicRatings.get(rating.team);
   if (!prev || Number(prev.throughWeek)<Number(rating.throughWeek)) historicRatings.set(rating.team,rating);
 }
 const priorGames=completed.filter(g=>g.week<week);
 const data=normalizeData({season,teams,venues,games:priorGames,basicStats:basic,advancedStats:advanced,
   ratings:[...historicRatings.values()],talent,returning,boxScores:boxes,redZone:rzGood?rz:{},warnings:[]});
 const e=engine(data);
 const ids=new Map(e.teams.map(t=>[normalizeName(t.name),t.id]));
 let seen=0;
 for(const g of completed.filter(g=>g.week===week)){
  const line=chooseLine(lineMap.get(String(g.id))||[]);
  if(!line){missing.push({week,away:g.awayTeam,home:g.homeTeam,reason:'No historical spread'});continue;}
  const awayId=ids.get(normalizeName(g.awayTeam)),homeId=ids.get(normalizeName(g.homeTeam));
  if(awayId===undefined||homeId===undefined){missing.push({week,away:g.awayTeam,home:g.homeTeam,reason:'Team absent from site ratings'});continue;}
  try{
   const p=e.predict(awayId,homeId);
   const spread=Number(line.spread),edge=p.modelMargin+spread,actual=g.homePoints-g.awayPoints+spread;
   const pick=Math.abs(edge)<1e-8?'Tossup':edge>0?'Home':'Away';
   const result=Math.abs(actual)<1e-8?'Push':pick==='Tossup'?'No pick':((actual>0?'Home':'Away')===pick?'Win':'Loss');
   results.push({week,date:g.startDate,away:g.awayTeam,home:g.homeTeam,spread,provider:line.provider,
    modelMargin:p.modelMargin,projectedAway:p.targetA,projectedHome:p.targetH,pick,result,
    actualAway:g.awayPoints,actualHome:g.homePoints,edge,priorGames:priorGames.length});
   seen++;
  }catch(error){errors.push('Week '+week+' '+g.awayTeam+' at '+g.homeTeam+': '+error.message);}
 }
 console.log('Week '+week+': '+seen+' graded, '+missing.filter(x=>x.week===week).length+' no line or team');
 // Only after simulating this week may its game data enter the next snapshot.
 const [weeklyBoxes,plays,drives]=await Promise.all([
  optional('boxes week '+week,'/games/teams',pp(season,week)),
  optional('plays week '+week,'/plays',pp(season,week)),
  optional('drives week '+week,'/drives',pp(season,week))
 ]);
 boxes.push(...weeklyBoxes);
 if(plays.length<100||drives.length<20){rzGood=false;console.warn('Red-zone feed incomplete in week '+week);}
 if(rzGood){
  const weekly=summarizeRedZone(plays,drives,new Set(completed.filter(g=>g.week===week).map(g=>g.id)));
  for(const [name,stats] of Object.entries(weekly)){
   const t=rz[name]??={offenseTrips:0,offenseTds:0,defenseTrips:0,defenseTds:0};
   for(const k of Object.keys(t))t[k]+=stats[k];
  }
 }
}
if(results.length<100)throw Error('Too few verifiable games '+results.length+'; preserve previous report');
const round=x=>Number(x.toFixed(2));
for(const x of results)csv.push([x.week,x.date,x.away,x.home,x.spread,x.provider,
 round(x.projectedAway),round(x.projectedHome),round(x.modelMargin),x.pick,
 x.actualAway,x.actualHome,x.result,round(x.edge),x.priorGames]);
const byWeek=weeks.map(week=>{
 const r=results.filter(g=>g.week===week);
 const wins=r.filter(g=>g.result==='Win').length,losses=r.filter(g=>g.result==='Loss').length,pushes=r.filter(g=>g.result==='Push').length, noPicks=r.filter(g=>g.result==='No pick').length;
 return {week,games:r.length,wins,losses,pushes,noPicks,accuracy:wins+losses?round(100*wins/(wins+losses)):null,
   ungraded:missing.filter(g=>g.week===week).length};
});
const wins=results.filter(g=>g.result==='Win').length,losses=results.filter(g=>g.result==='Loss').length;
const summary={season,asOf:new Date().toISOString(),method:'Current simulator Balanced mode, pre-week cumulative stats, prior completed games only; preseason fixed BASE ratings and talent priors. Target score (analytic model), not a random Monte Carlo draw. Recorded CFBD provider spread, not necessarily verified closing timestamp.',games:results.length,wins,losses,pushes:results.filter(g=>g.result==='Push').length,noPicks:results.filter(g=>g.result==='No pick').length,accuracy:round(100*wins/(wins+losses)),ungraded:missing.length,errors,byWeek,missing};
await fs.mkdir('backtests',{recursive:true});
const esc=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
await fs.writeFile('backtests/2025-cfb.csv',csv.map(row=>row.map(esc).join(',')).join('\n')+'\n');
await fs.writeFile('backtests/2025-summary.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({...summary,missing:summary.missing.slice(0,5)},null,2));

const frozen=JSON.parse(await fs.readFile('backtests/2026-frozen-team-model.json','utf8'));
const history=new Map();
const get=name=>history.histGet(name)||[];
const avg=(arr,fn)=>arr.length?arr.reduce((sum,x)=>sum+fn(x),0)/arr.length:0;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const picks=[];
for(const row of [...results].sort((a,b)=>a.date.localeCompare(b.date))){
 const h=histGet(row.home),a=histGet(row.away),recent=x=>x.slice(-3);
 const margin=x=>avg(x,z=>z.for-z.against);
 const off=x=>avg(x,z=>z.for),def=x=>avg(x,z=>z.against),ats=x=>avg(x,z=>z.ats);
 const form=(margin(recent(h))-margin(h))-(margin(recent(a))-margin(a));
 const recentMargin=margin(recent(h))-margin(recent(a));
 const seasonMargin=margin(h)-margin(a);
 const offensive=off(recent(h))-off(recent(a));
 const defensive=def(recent(a))-def(recent(h));
 const atsTrend=ats(recent(h))-ats(recent(a));
 const rest=x=>x.length?clamp((Date.parse(row.date)-Date.parse(x.at(-1).date))/86400000,3,20):7;
 const win=x=>avg(recent(x),z=>z.for>z.against?1:0);
 const edge=row.modelMargin+row.spread;
 const x=[1,edge/14,row.spread/20,Math.sign(row.spread),form/15,recentMargin/20,seasonMargin/20,offensive/30,defensive/30,atsTrend/20,(rest(h)-rest(a))/7,win(h)-win(a),Math.abs(row.spread)/20,Math.abs(edge)/14];
 const score=x.reduce((sum,v,i)=>sum+v*frozen.weights[i],0)+(frozen.teamBias[row.home]||0)-(frozen.teamBias[row.away]||0);
 const actual=row.actualHome-row.actualAway+row.spread;
 const grade=actual===0?'Push':score*actual>0?'Win':'Loss';
 picks.push({week:row.week,date:row.date,home:row.home,away:row.away,score,grade});
 for(const [name,scored,allowed,spreadResult] of [[row.home,row.actualHome,row.actualAway,actual],[row.away,row.actualAway,row.actualHome,-actual]]){
 history.set(name,[...histGet(name),{for:scored,against:allowed,ats:spreadResult,date:row.date}]);
 }
}
const wins=picks.filter(p=>p.grade==='Win').length,losses=picks.filter(p=>p.grade==='Loss').length,pushes=picks.filter(p=>p.grade==='Push').length;
const crossReport={season:2025,asOf:new Date().toISOString(),model:'2026 frozen 14-feature + team-bias retrospective model',frozenModel:'backtests/2026-frozen-team-model.json',frozen2026:{wins:299,losses:121,pushes:12,accuracy:71.19},test2025:{wins,losses,pushes,accuracy:Number((100*wins/(wins+losses)).toFixed(2)),gradedDecisions:wins+losses,eligibleGames:results.length},byWeek:[...new Set(picks.map(p=>p.week))].sort((a,b)=>a-b).map(week=>{const p=picks.filter(x=>x.week===week),w=p.filter(x=>x.grade==='Win').length,l=p.filter(x=>x.grade==='Loss').length;return {week,wins:w,losses:l,pushes:p.filter(x=>x.grade==='Push').length,accuracy:w+l?Number((100*w/(w+l)).toFixed(2)):null}}),limitations:['The 2026 original projected margin is reconstructed from the current simulator and historical preweek stats; model rating priors may not be archived point-in-time','2026 team biases learned from final 2026 results, and some 2025 teams have no coefficient','Provider odds not timestamp verified','This is a backwards-year holdout with roster/coaching turnover; no refit was performed']};
await fs.writeFile('backtests/2025-frozen-model-test.json',JSON.stringify(crossReport,null,2)+'\n');
console.log('FROZEN MODEL 2025:',JSON.stringify(crossReport,null,2));
