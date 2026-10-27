import fs from 'node:fs/promises';
const API='https://api.collegefootballdata.com';
const key=process.env.CFBD_API_KEY;
if(!key) throw Error('CFBD_API_KEY secret is required');
const first=2022,last=2026,trainingEnd=2025;
async function get(path,params={}){
 const url=new URL(API+path);
 Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,String(v)));
 for(let attempt=0;attempt<3;attempt++){
  const r=await fetch(url,{headers:{Authorization:'Bearer '+key}});
  if(r.ok)return r.json();
  const msg=(await r.text()).slice(0,200);
  if(attempt===2||![429,500,502,503,504].includes(r.status))throw Error(url.pathname+' '+r.status+' '+msg);
  await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
 }
}
async function maybe(path,params){try{return await get(path,params)}catch(e){console.warn(e.message);return []}}
const data={};
for(let year=first;year<=last;year++){
 const [games,lines,coaches]=await Promise.all([
  get('/games',{year,seasonType:'regular',classification:'fbs'}),
  year>=2023?get('/lines',{year,seasonType:'regular'}):Promise.resolve([]),
  maybe('/coaches',{year})
 ]);
 data[year]={games,lines,coaches};
 console.log(year+': '+games.length+' games, '+lines.length+' lined, '+coaches.length+' coach records');
}
const clean=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const coachMap=new Map();
for(const [yearString,entry] of Object.entries(data)){
 const year=Number(yearString);
 for(const row of entry.coaches||[]){
  const name=[row.firstName,row.lastName].filter(Boolean).join(' ')||row.name;
  if(!name)continue;
  if(row.school){coachMap.set(year+':'+clean(row.school),clean(name))}
  for(const season of row.seasons||[]){
   const y=Number(season.year??year),school=season.school;
   if(school&&y===year)coachMap.set(y+':'+clean(school),clean(name));
  }
 }
}
const allGames=Object.entries(data).flatMap(([yearString,entry])=>entry.games.map(g=>({...g,year:Number(yearString)})))
 .filter(g=>g.completed&&Number.isFinite(g.homePoints)&&Number.isFinite(g.awayPoints)&&g.startDate)
 .sort((a,b)=>new Date(a.startDate)-new Date(b.startDate));
const odds=new Map();
for(const [yearString,entry] of Object.entries(data)){
 for(const row of entry.lines||[]){
  const valid=(row.lines||[]).filter(l=>l.spread!==null&&l.spread!==''&&Number.isFinite(Number(l.spread)));
  const rank=x=>{const p=String(x.provider||'').toLowerCase();return p.includes('consensus')?0:p.includes('bovada')?1:p.includes('draftkings')?2:p.includes('caesars')?3:10};
  valid.sort((a,b)=>rank(a)-rank(b));
  if(valid.length)odds.set(String(row.id??row.gameId),Number(valid[0].spread));
 }
}
const history=new Map(),coachHistory=new Map(),pairs=new Map(),features=[];
const getRows=(map,key)=>map.get(key)||[];
const avg=(rows,key)=>rows.length?rows.reduce((s,r)=>s+r[key],0)/rows.length:0;
const last=rows=>rows.slice(-3);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function teamFeatures(name,date){
 const rows=getRows(history,clean(name));
 return {
  games:rows.length,
  recentMargin:avg(last(rows),'margin')/20,
  seasonMargin:avg(rows,'margin')/20,
  form:(avg(last(rows),'margin')-avg(rows,'margin'))/15,
  recentOffense:avg(last(rows),'points')/30,
  recentDefense:avg(last(rows),'allowed')/30,
  recentWin:rows.length?last(rows).filter(r=>r.margin>0).length/last(rows).length:0.5,
  rest:rows.length?clamp((Date.parse(date)-Date.parse(rows.at(-1).date))/86400000,3,21):7,
  homeATS:rows.filter(r=>r.home&&Number.isFinite(r.homeATS)).slice(-8),
 };
}
for(const g of allGames){
 const home=teamFeatures(g.homeTeam,g.startDate),away=teamFeatures(g.awayTeam,g.startDate);
 const homeCoach=coachMap.get(g.year+':'+clean(g.homeTeam)),awayCoach=coachMap.get(g.year+':'+clean(g.awayTeam));
 const homeCoachHistory=homeCoach?getRows(coachHistory,homeCoach):[],awayCoachHistory=awayCoach?getRows(coachHistory,awayCoach):[];
 const pairKey=[clean(g.homeTeam),clean(g.awayTeam)].sort().join(':');
 const priorPairs=getRows(pairs,pairKey);
 const spread=odds.get(String(g.id));
 if(g.year>=2023&&Number.isFinite(spread)){
  features.push({year:g.year,week:g.week,gameId:g.id,home:g.homeTeam,away:g.awayTeam,spread,
   actual:g.homePoints-g.awayPoints+spread,
   f:[
    1,
    clamp(home.recentMargin-away.recentMargin,-3,3),
    clamp(home.seasonMargin-away.seasonMargin,-3,3),
    clamp(home.form-away.form,-3,3),
    clamp(home.recentOffense-away.recentOffense,-3,3),
    clamp(away.recentDefense-home.recentDefense,-3,3),
    home.recentWin-away.recentWin,
    clamp((home.rest-away.rest)/7,-2,2),
    clamp((homeCoachHistory.length-awayCoachHistory.length)/30,-2,2),
    clamp(avg(last(homeCoachHistory),'margin')-avg(last(awayCoachHistory),'margin'),-30,30)/15,
    clamp(priorPairs.reduce((s,r)=>s+(r.home===clean(g.homeTeam)?r.margin:-r.margin),0)/Math.max(1,priorPairs.length),-30,30)/15,
    g.conferenceGame?1:0,
    clamp(spread/14,-3,3)
   ]});
 }
 for(const [name,scored,allowed,isHome,coach] of [
 [g.homeTeam,g.homePoints,g.awayPoints,true,homeCoach],
 [g.awayTeam,g.awayPoints,g.homePoints,false,awayCoach]]){
  const row={date:g.startDate,margin:scored-allowed,points:scored,allowed,home:isHome};
  const k=clean(name);history.set(k,[...getRows(history,k),row]);
  if(coach)coachHistory.set(coach,[...getRows(coachHistory,coach),row]);
 }
 pairs.set(pairKey,[...priorPairs,{home:clean(g.homeTeam),margin:g.homePoints-g.awayPoints}]);
}
const train=features.filter(g=>g.year<=trainingEnd),test=features.filter(g=>g.year===2026);
if(train.length<600||test.length<100)throw Error('Insufficient training or test coverage: '+train.length+'/'+test.length);
function score(rows,w,threshold){
 let wins=0,losses=0,pushes=0,skipped=0;
 for(const g of rows){
  const v=g.f.reduce((s,x,j)=>s+x*w[j],0);
  if(Math.abs(v)<threshold){skipped++;continue}
  if(g.actual===0)pushes++;else if(v*g.actual>0)wins++;else losses++;
 }
 return {wins,losses,pushes,skipped,decisions:wins+losses,accuracy:wins+losses?+(100*wins/(wins+losses)).toFixed(2):null};
}
const rand=(()=>{let state=836;return()=>((state=Math.imul(state,1664525)+1013904223>>>0)/4294967296)})();
const allowed=weights=>weights.map((v,i)=>i===0?v:Math.round(v*1000)/1000);
let best=null,qualifying=0;
for(let iter=0;iter<20000;iter++){
 const weights=iter===0?[1,...Array(12).fill(0)]:Array.from({length:13},(_,i)=>i===0?(rand()-.5)*3:(rand()-.5)*(i===12?1.2:2.5));
 const threshold=iter===0?0:Math.floor(rand()*21)/10;
 const inSample=score(train,weights,threshold);
 if(inSample.decisions<Math.ceil(train.length*.75))continue;
 qualifying++;
 if(!best||inSample.accuracy>best.train.accuracy)best={weights:allowed(weights),threshold,train:inSample};
}
if(!best)throw Error('No qualifying models');
best.test=score(test,best.weights,best.threshold);
best.train=score(train,best.weights,best.threshold);
const simpleHome=rows=>{let wins=0,losses=0,pushes=0;for(const r of rows){if(r.actual>0)wins++;else if(r.actual<0)losses++;else pushes++;}return{wins,losses,pushes,accuracy:+(100*wins/(wins+losses)).toFixed(2)}};
const report={generatedAt:new Date().toISOString(),source:'CFBD 2022-2026 games/lines/coaches',yearCounts:Object.fromEntries([2023,2024,2025,2026].map(y=>[y,features.filter(x=>x.year===y).length])),design:'2022 is warm-up; only data prior to each kickoff enters features. 2023-2025 train; 2026 holdout untouched during selection. Historical bookmaker spreads not assured timestamped closing.',featureNames:['intercept','recent scoring margin','season margin','scoring momentum','recent points scored','recent points allowed inverse','recent win pct','rest differential','coach prior games coached','coach prior score margin','prior head to head','conference game','market home spread'],tested:20000,qualified:qualifying,best,baseline:{train:simpleHome(train),test:simpleHome(test)},limitations:['No play-by-play lead duration, scoring streak, or time-of-possession features yet','Coach rows may be incomplete or change teams; missing coach identity uses zero','Historical market line timestamps are not verified','Model is a feature screen, not a calibrated betting probability']};
await fs.mkdir('backtests',{recursive:true});
await fs.writeFile('backtests/2022-2026-cross-season.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
