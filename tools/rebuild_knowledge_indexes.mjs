import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const project=path.resolve(here,'..');
const root=path.resolve(process.argv[2]||path.join(project,'knowledge-pipeline'));
const sessionsRoot=path.join(root,'01-sessions');
const reviewsRoot=path.join(root,'04-reviews');
const findingsRoot=path.join(root,'03-findings');
const indexesRoot=path.join(root,'07-indexes');
fs.mkdirSync(indexesRoot,{recursive:true});
fs.mkdirSync(reviewsRoot,{recursive:true});

const readJson=(file,fallback=null)=>{try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{return fallback;}};
const walk=(dir,name,out=[])=>{if(!fs.existsSync(dir))return out;for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())walk(full,name,out);else if(entry.name===name)out.push(full);}return out;};
const rel=file=>path.relative(root,file).replaceAll('\\','/');

const sessions=walk(sessionsRoot,'session.json').map(file=>{
  const j=readJson(file,{})||{};
  return {sessionId:j.sessionId||path.basename(path.dirname(file)),replayDate:j.replayDate||null,startedAt:j.startedAt||j.observedAtUtc||null,completedAt:j.status?.completedAt||j.completedAt||null,buildId:j.buildId||null,buildSequence:Number(j.buildSequence)||0,eventCount:Number(j.eventCount)||0,reportCount:Number(j.reportCount)||0,status:j.status?.state||null,path:rel(path.dirname(file))};
}).sort((a,b)=>String(b.startedAt||'').localeCompare(String(a.startedAt||'')));

const reviews=walk(sessionsRoot,'meeting-summary.json').map(file=>{
  const j=readJson(file,{})||{};
  const sessionDir=path.dirname(path.dirname(path.dirname(file)));
  const session=readJson(path.join(sessionDir,'session.json'),{})||{};
  return {meetingName:j.meetingName||path.basename(path.dirname(file)),status:j.status||null,replayDate:session.replayDate||null,sessionId:session.sessionId||path.basename(sessionDir),completedCases:(j.completedCases||[]).length,totalCases:Number(j.totalCases)||0,endedAt:j.endedAt||null,path:rel(path.dirname(file))};
}).sort((a,b)=>String(b.endedAt||'').localeCompare(String(a.endedAt||'')));
const canonical=readJson(path.join(findingsRoot,'canonical-findings.json'),{findings:{}})||{findings:{}};
const backlog=readJson(path.join(findingsRoot,'engineering-backlog.json'),{items:[]})||{items:[]};
const lifecycleCounts={};
for(const finding of Object.values(canonical.findings||{})){
  const status=finding.lifecycleStatus||'UNSPECIFIED';
  lifecycleCounts[status]=(lifecycleCounts[status]||0)+1;
}
const generatedAtUtc=new Date().toISOString();
const summary={pipelineVersion:2,generatedAtUtc,counts:{sessions:sessions.length,reviews:reviews.length,canonicalFindings:Object.keys(canonical.findings||{}).length,backlogItems:(backlog.items||[]).length},lifecycleCounts,latestSession:sessions[0]||null,latestReview:reviews[0]||null};
fs.writeFileSync(path.join(indexesRoot,'SESSIONS.json'),JSON.stringify({generatedAtUtc,sessions},null,2));
fs.writeFileSync(path.join(indexesRoot,'REVIEWS.json'),JSON.stringify({generatedAtUtc,reviews},null,2));
fs.writeFileSync(path.join(indexesRoot,'FINDINGS_SUMMARY.json'),JSON.stringify(summary,null,2));
fs.writeFileSync(path.join(reviewsRoot,'review-index.json'),JSON.stringify({generatedAtUtc,reviews},null,2));

const md=[
  '# Knowledge Pipeline Index',
  '',
  `Generated: ${generatedAtUtc}`,
  '',
  `Sessions: ${sessions.length}`,
  `Reviews: ${reviews.length}`,
  `Canonical findings: ${summary.counts.canonicalFindings}`,
  `Backlog items: ${summary.counts.backlogItems}`,
  '',
  'Open the JSON indexes in this folder for machine-readable navigation.',
  'Regenerate with `npm run knowledge:index`.',
  '',
].join('\n');
fs.writeFileSync(path.join(indexesRoot,'README.md'),md);
console.log(JSON.stringify(summary,null,2));
