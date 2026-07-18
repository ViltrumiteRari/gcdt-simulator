const fs=require('fs');
const path=require('path');
const qa=require('../electron/gemini-live-qa.cjs');
const root=path.resolve(__dirname,'..');
const [campaign,worker]=process.argv.slice(2);
if(!campaign||!worker)throw new Error('CAMPAIGN_AND_WORKER_REQUIRED');
const dir=path.join(root,'knowledge-pipeline','review-queue',campaign,worker);
function find(d,n,out=[]){if(!fs.existsSync(d))return out;for(const x of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,x.name);x.isDirectory()?find(p,n,out):x.name===n&&out.push(p)}return out}
function readJson(p){return JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''))}
function writeJson(p,v){fs.writeFileSync(p,JSON.stringify(v,null,2))}
function append(p,v){fs.appendFileSync(p,JSON.stringify(v)+'\n')}
(async()=>{
 if(!fs.existsSync(dir)||fs.existsSync(path.join(dir,'.deleted')))throw new Error('REVIEW_RUN_NOT_FOUND');
 const sessionFile=find(dir,'session.json')[0],eventsFile=find(dir,'events.jsonl')[0];
 if(!sessionFile||!eventsFile)throw new Error('REVIEW_EVIDENCE_MISSING');
 const session=readJson(sessionFile);
 const events=fs.readFileSync(eventsFile,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
 const selected=events.filter((e,i)=>i===0||i===events.length-1||Number(e.tick)%40===1);
 const reports=[];
 fs.writeFileSync(path.join(dir,'observer-reports.jsonl'),'');
 for(const snap of selected){try{const r=await qa.observe({...snap,sessionMeta:session,reviewMode:'POSTHOC_PROMOTED'});const report={...r,t:snap.time,tick:snap.tick,sessionId:session.sessionId,buildId:session.buildId,reviewMode:'POSTHOC_PROMOTED'};reports.push(report);append(path.join(dir,'observer-reports.jsonl'),report);}catch(e){append(path.join(dir,'observer-errors.jsonl'),{at:new Date().toISOString(),tick:snap.tick,error:String(e.message||e)})}}
 writeJson(path.join(dir,'observer-review.json'),{status:reports.length?'OBSERVER_REVIEWED':'OBSERVER_REVIEW_FAILED',sessionId:session.sessionId,reportCount:reports.length,completedAt:new Date().toISOString(),reports});
 if(!reports.length)throw new Error('NO_OBSERVER_REPORTS');
})().catch(e=>{console.error(e.stack||e);process.exit(1)});