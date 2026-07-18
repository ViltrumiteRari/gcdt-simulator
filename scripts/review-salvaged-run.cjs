const fs=require('fs');
const path=require('path');
const qa=require('../electron/gemini-live-qa.cjs');
const {createMeetingRunner}=require('../electron/meeting-orchestrator.cjs');
const root=path.resolve(__dirname,'..');
const campaign='PAR-1783891674087', worker='worker-1';
const src=path.join(root,'knowledge-pipeline','quarantine',campaign,worker);
const dest=path.join(root,'knowledge-pipeline','review-queue',campaign,worker);
function find(dir,name,out=[]){for(const x of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,x.name);x.isDirectory()?find(p,name,out):x.name===name&&out.push(p)}return out}
function readJson(p){return JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''))}
function writeJson(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2))}
function append(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.appendFileSync(p,JSON.stringify(v)+'\n')}
(async()=>{
 if(!fs.existsSync(src)) throw new Error('SALVAGE_SOURCE_MISSING');
 if(fs.existsSync(dest)) fs.rmSync(dest,{recursive:true,force:true});
 fs.cpSync(src,dest,{recursive:true});
 const sessionFile=find(dest,'session.json')[0], eventsFile=find(dest,'events.jsonl')[0];
 const session=readJson(sessionFile);
 const events=fs.readFileSync(eventsFile,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
 session.provenance='PROMOTED_PENDING_REVIEW';
 session.salvage={status:'SALVAGED_EVIDENCE_ONLY',reason:'Observer launch mode was wrong; trader evidence continuous and intact',sourcePath:src,salvagedAt:new Date().toISOString()};
 writeJson(sessionFile,session);
 writeJson(path.join(dest,'provenance.json'),{campaignId:campaign,workerId:worker,replayDate:session.replayDate,sourceSessionId:session.sessionId,eventCount:events.length,status:'PROMOTED_PENDING_REVIEW',salvageStatus:'SALVAGED_EVIDENCE_ONLY',promotedAt:new Date().toISOString()});
 const selected=events.filter((e,i)=>i===0||i===events.length-1||Number(e.tick)%40===1);
 const reports=[];
 for(const snap of selected){
  try{const r=await qa.observe({...snap,sessionMeta:session,reviewMode:'POSTHOC_SALVAGE'});const report={...r,t:snap.time,tick:snap.tick,sessionId:session.sessionId,buildId:session.buildId,reviewMode:'POSTHOC_SALVAGE'};reports.push(report);append(path.join(dest,'observer-reports.jsonl'),report);console.log('OBSERVER',snap.tick,r.level,r.title)}catch(e){append(path.join(dest,'observer-errors.jsonl'),{at:new Date().toISOString(),tick:snap.tick,error:String(e.message||e)});console.error('OBSERVER_ERROR',snap.tick,String(e.message||e))}
 }
 writeJson(path.join(dest,'observer-review.json'),{status:reports.length?'OBSERVER_REVIEWED':'OBSERVER_REVIEW_FAILED',sessionId:session.sessionId,reportCount:reports.length,completedAt:new Date().toISOString(),reports});
 if(!reports.length) throw new Error('NO_OBSERVER_REPORTS');
 const sessionFolder=path.dirname(sessionFile);
 const runner=createMeetingRunner({emit:(message,extra={})=>console.log('MEETING',JSON.stringify({message,...extra}))});
 const result=await runner.run({name:'salvaged-july-7-assessment',reports,events,sessionMeta:session,sessionFolder});
 writeJson(path.join(dest,'assessment-status.json'),{status:result.status,meetingName:result.meetingName,meetingFolder:result.folder,summary:result.summary,completedAt:new Date().toISOString()});
 console.log('ASSESSMENT_COMPLETE',JSON.stringify(result));
})().catch(e=>{console.error('FATAL',e.stack||e);process.exit(1)});