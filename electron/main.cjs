const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, shell, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { createRunner } = require('./qa-orchestrator.cjs');
const { createMeetingRunner, localMeetingName } = require('./meeting-orchestrator.cjs');
const { createSupervisorService } = require('./supervisor-service.cjs');
const { layout, ensurePipeline, temporalMeta, upsertIndex } = require('./pipeline-layout.cjs');

const AGENT_PORT = Number(process.env.FIRSTSIGNAL_AGENT_PORT || 8766);
const WORKER_MODE = process.env.FIRSTSIGNAL_WORKER_MODE === '1';
const CAMPAIGN_ID = process.env.FIRSTSIGNAL_CAMPAIGN_ID || null;
const WORKER_ID = process.env.FIRSTSIGNAL_WORKER_ID || null;
const USER_DATA_DIR = process.env.FIRSTSIGNAL_USER_DATA || null;
if (USER_DATA_DIR) app.setPath('userData', USER_DATA_DIR);

let win;
let simulatorWin;
let hudWin;
let tray;
let runQa;
let meetingRunner;
let supervisor;
let meetingNotebookWin;
let controllerWin;
let server;
let workerControl = { action:'RUN', speed:3, updatedAt:null };
let reports = [];
let events = [];
let activities = [];
let analyzing = false;
let lastAnalyzedTick = -99;
let currentStatus = { state: 'STARTING' };
let workerRuntime = { state:'STARTING', tick:0, eventCount:0, lastProgressAt:Date.now(), updatedAt:null, provider:null };
let currentSessionId = null;
let currentSessionMeta = {};
let quotaBlocked = false;
let cooldownUntil = 0;
let currentMeeting = { state:'IDLE', name:null, transcript:[], folder:null, summary:null };
let traderInterview={state:'IDLE',queue:[],pending:new Map(),continuity:{available:false}};
const recentFingerprints = new Map();

const settingsPath = () => path.join(app.getPath('userData'), 'agent-settings.json');
const defaultFolder = () => path.resolve(__dirname, '..', 'knowledge-pipeline');
function loadSettings() {
  try { const settings=JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); const oldDefaults=[path.join(app.getPath('documents'),'FirstSignal Agent Reports'),path.join(app.getPath('documents'),'FirstSignal Sim v1 Agent Reports')]; if(!settings.reportFolder||oldDefaults.includes(settings.reportFolder)){settings.reportFolder=defaultFolder();saveSettings(settings);} return settings; }
  catch { return { reportFolder: defaultFolder() }; }
}
function saveSettings(settings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}
function reportFolder() {
  const folder = process.env.FIRSTSIGNAL_REPORT_FOLDER || loadSettings().reportFolder;
  ensurePipeline(folder);
  return folder;
}

function trayIcon(state = 'WATCHING') {
  const asset = state.includes('APPROVAL') ? 'approval' : state === 'ANALYZING' ? 'analyzing' : state.startsWith('OFFLINE') ? 'offline' : 'watching';
  const icoPath = path.join(__dirname, 'assets', `tray-${asset}.ico`);
  const pngPath = path.join(__dirname, 'assets', `tray-${asset}.png`);
  const ico = nativeImage.createFromPath(icoPath);
  if (!ico.isEmpty()) return ico;
  return nativeImage.createFromPath(pngPath);
}function refreshTray() {
  if (!tray) return;
  tray.setImage(trayIcon(currentStatus.state));
  tray.setToolTip(`FirstSignal Sim v1 QA | ${currentStatus.state}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Status: ${currentStatus.state}`, enabled: false },
    { label: 'Open Agent Console', click: () => { win.show(); win.focus(); } },
    { label: 'Open Report Folder', click: () => shell.openPath(reportFolder()) },
    { label: 'Change Report Folder', click: chooseFolder },
    { type: 'separator' },
    { label: 'Quit Agent', click: () => app.quit() },
  ]));
  win?.webContents.send('agent:update', { status: currentStatus, sessionId:currentSessionId, sessionMeta:currentSessionMeta, reports, activities, eventCount: events.length, meeting:currentMeeting, settings: loadSettings() });
}
function addActivity(kind, message) {
  const tm=temporalMeta({replayDate:currentSessionMeta.replayDate||null}); activities = [...activities.slice(-149), { id: 'ACT-' + Date.now() + '-' + Math.random().toString(36).slice(2,6), at:tm.observedAtUtc, ...tm, kind, message }];
  refreshTray();
}

function resetSession(sessionId, meta = {}) {
  if (currentMeeting.state === 'RUNNING') meetingRunner?.stop();
  currentMeeting = { state:'IDLE', name:null, transcript:[], folder:null, summary:null };
  currentSessionId = sessionId || null;
  currentSessionMeta = currentSessionId ? { ...meta, campaignId:CAMPAIGN_ID, workerId:WORKER_ID, provenance:'STAGED_UNTRUSTED', sessionId: currentSessionId, startedAt: new Date().toISOString(), ...temporalMeta({replayDate:meta.replayDate||null}) } : {};
  events = [];
  reports = [];
  activities = [];
  analyzing = false;
  lastAnalyzedTick = -99;
  quotaBlocked = false;
  cooldownUntil = 0;
  recentFingerprints.clear();
  currentStatus = currentSessionId ? { state: 'WATCHING', sessionId: currentSessionId, replayDate: meta.replayDate || null, buildId: meta.buildId || null, buildSequence: Number(meta.buildSequence)||0, productVersion: meta.productVersion || null } : { state: 'IDLE' };
  if (currentSessionId) addActivity('SESSION', `Started ${meta.productName||'FirstSignal Sim'} ${meta.productVersion||'v1'} | ${meta.buildId||'unknown build'} | ${meta.replayDate||'session'}`);
  else refreshTray();
}

function canonicalTradeLedgerFromEvents(sourceEvents=events){
  const seen=new Set(),rows=[];
  for(const event of sourceEvents){for(const trade of event.recentTrades||[]){const key=`${trade.t}|${trade.action}|${trade.result||''}`;if(seen.has(key))continue;seen.add(key);rows.push(trade);}}
  const opens=[],ledger=[];
  for(const row of rows){if(/CANONICAL FILL BUY/.test(row.action||'')){opens.push(row);continue;}if(row.pnl===undefined&&row.result==null)continue;const entry=opens.shift()||null;ledger.push({id:`T${ledger.length+1}`,entryTime:entry?.t||null,entryAction:entry?.action||null,exitTime:row.t||null,exitAction:row.action||null,result:row.result||null,pnlPct:Number(row.pnl),dollarPnl:Number(row.dollarPnl||0)});}
  return ledger;
}
function validateReflectionFacts(meta,sourceEvents=events){
  const ledger=canonicalTradeLedgerFromEvents(sourceEvents),validIds=new Set(ledger.map(x=>x.id)),validTimes=new Set(ledger.flatMap(x=>[x.entryTime,x.exitTime]).filter(Boolean).map(String));
  const text=`${meta?.privateReflection||''} ${meta?.nextSessionHandoff||''}`,errors=[];
  for(const id of meta?.referencedTradeIds||[])if(!validIds.has(id))errors.push(`UNKNOWN_TRADE_ID:${id}`);
  for(const claim of meta?.factualClaims||[])for(const id of claim?.evidence_trade_ids||[])if(!validIds.has(id))errors.push(`UNKNOWN_CLAIM_TRADE_ID:${id}`);
  for(const match of text.matchAll(/\[(T\d+)\]/g))if(!validIds.has(match[1]))errors.push(`UNKNOWN_INLINE_TRADE_ID:${match[1]}`);
  if(!Array.isArray(meta?.referencedTradeIds)||!Array.isArray(meta?.factualClaims))errors.push('STRUCTURED_REFLECTION_EVIDENCE_REQUIRED');
  return {ok:errors.length===0,errors:[...new Set(errors)],ledger};
}

function canonicalSessionSnapshot(){
  const live={status:currentStatus,sessionId:currentSessionId,sessionMeta:currentSessionMeta,reports,activities,eventCount:events.length,workerRuntime,meeting:meetingStatePayload()};
  try{
    const root=path.join(layout(reportFolder()).sessions);
    const files=[]; const walk=d=>{if(!fs.existsSync(d))return;for(const x of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,x.name);x.isDirectory()?walk(f):x.name==='session.json'&&files.push(f);}}; walk(root);
    const candidates=files.map(file=>{try{const m=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));const folder=path.dirname(file);return {m,folder,score:(m.reflectionComplete&&m.eventCount===405&&fs.existsSync(path.join(folder,m.reflectionArtifact||'trader-closing-reflection.json')))?3:0};}catch{return null;}}).filter(Boolean)
      .filter(x=>x.score===3&&x.m.replayDate===(currentSessionMeta.replayDate||currentStatus.replayDate)&&x.m.buildId===(currentSessionMeta.buildId||currentStatus.buildId))
      .sort((a,b)=>Date.parse(b.m.status?.completedAt||b.m.startedAt||0)-Date.parse(a.m.status?.completedAt||a.m.startedAt||0));
    const best=candidates[0];
    if(best&&(!['COMPLETED','AWAITING_REVIEW_MEETING'].includes(currentStatus.state)||events.length<405)){
      const ev=path.join(best.folder,'events.jsonl'); const restored=fs.existsSync(ev)?fs.readFileSync(ev,'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse):[];
      return {...live,status:best.m.status,sessionId:best.m.sessionId,sessionMeta:best.m,eventCount:best.m.eventCount,workerRuntime:{...workerRuntime,state:'FINALIZING_OR_COMPLETED',tick:405,eventCount:405},canonicalOverride:true,canonicalFolder:best.folder,events:restored};
    }
  }catch(error){console.error('CANONICAL_SESSION_RESOLUTION_FAILED',error);}
  return live;
}

function completeSession(meta = {}) {
  const uniqueTicks=[...new Set(events.map(e=>Number(e.tick)).filter(Number.isFinite))].sort((a,b)=>a-b);
  const expectedStartTick=Math.max(1,Number(currentSessionMeta.expectedStartTick)||1);
  const expectedTicks=Array.from({length:405-expectedStartTick+1},(_,i)=>expectedStartTick+i);
  if(events.length!==expectedTicks.length||uniqueTicks.length!==expectedTicks.length||uniqueTicks.some((tick,i)=>tick!==expectedTicks[i])) {
    const err=new Error(`EVENT_INTEGRITY_REQUIRED count:${events.length} unique:${uniqueTicks.length} expectedStart:${expectedStartTick}`);
    err.code='EVENT_INTEGRITY_REQUIRED';
    throw err;
  }
  analyzing = false;
  quotaBlocked = false;
  cooldownUntil = 0;
  const completedSessionId = currentSessionId;
  currentStatus = {
    state: meta.reflectionComplete ? 'AWAITING_REVIEW_MEETING' : 'COMPLETED',
    sessionId: completedSessionId,
    replayDate: meta.replayDate || currentStatus.replayDate || null,
    eventCount: events.length,
    reportCount: reports.length,
    buildId: currentSessionMeta.buildId || null,
    buildSequence: Number(currentSessionMeta.buildSequence)||0,
    productVersion: currentSessionMeta.productVersion || null,
    completedAt: new Date().toISOString(),
    ...temporalMeta({replayDate:meta.replayDate||currentStatus.replayDate||null}),
  };
  try {
    const folder=sessionFolder();
    const validation=validateReflectionFacts(meta);
    if(meta.reflectionComplete&&!validation.ok){const err=new Error(`REFLECTION_FACT_GATE_REJECTED:${validation.errors.join('|')}`);err.code='REFLECTION_FACT_GATE_REJECTED';throw err;}
    const reflection={sessionId:currentSessionId,replayDate:meta.replayDate||currentStatus.replayDate||null,privateReflection:String(meta.privateReflection||''),nextSessionHandoff:String(meta.nextSessionHandoff||''),referencedTradeIds:meta.referencedTradeIds||[],factualClaims:meta.factualClaims||[],validation:{status:'PASSED',validatedAt:new Date().toISOString(),canonicalTradeIds:validation.ledger.map(x=>x.id)},completedAt:new Date().toISOString(),traderContinuity:meta.traderContinuity||null};
    fs.writeFileSync(path.join(folder,'trader-closing-reflection.json'),JSON.stringify(reflection,null,2));
    fs.writeFileSync(path.join(folder, 'session.json'), JSON.stringify({ ...currentSessionMeta, sessionId:currentSessionId, status:currentStatus, eventCount:events.length, reportCount:reports.length, reflectionComplete:!!meta.reflectionComplete, reflectionArtifact:'trader-closing-reflection.json', traderContinuity:meta.traderContinuity||null }, null, 2));
    upsertIndex(path.join(layout(reportFolder()).indexes,'SESSIONS.json'),'sessions','sessionId',{sessionId:currentSessionId,replayDate:currentStatus.replayDate||null,startedAt:currentSessionMeta.startedAt||null,completedAt:currentStatus.completedAt||currentStatus.observedAtUtc||null,buildId:currentSessionMeta.buildId||null,buildSequence:Number(currentSessionMeta.buildSequence)||0,eventCount:events.length,reportCount:reports.length,status:currentStatus.state,path:path.relative(reportFolder(),folder).replaceAll('\\','/')});
  } catch {}
  if(process.env.FIRSTSIGNAL_OBSERVER_MODE==='posthoc'){ try{const q=path.join(reportFolder(),'review-queue.jsonl');fs.appendFileSync(q,JSON.stringify({sessionId:completedSessionId,replayDate:currentStatus.replayDate,folder:sessionFolder(),eventCount:events.length,status:'PENDING_REVIEW',queuedAt:new Date().toISOString()})+'\n');}catch{} }
  addActivity('SESSION', `Completed ${completedSessionId || 'session'} with ${reports.length} findings across ${events.length} events.`);
}

function openMeetingNotebookWindow() {
  if (meetingNotebookWin && !meetingNotebookWin.isDestroyed()) {
    meetingNotebookWin.show(); meetingNotebookWin.focus(); return;
  }
  meetingNotebookWin = new BrowserWindow({
    width: 760, height: 760, minWidth: 520, minHeight: 420,
    backgroundColor: '#07090c', show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  meetingNotebookWin.loadFile(path.join(__dirname, 'meeting-notebook.html'));
  meetingNotebookWin.on('closed', () => { meetingNotebookWin = null; });
}
function emitMeeting(turn) {
  currentMeeting = { ...currentMeeting, transcript:[...(currentMeeting.transcript||[]).slice(-199), turn] };
  if (turn.status) currentMeeting.state = turn.status;
  if (turn.folder) { currentMeeting.folder = turn.folder; if (!WORKER_MODE) openMeetingNotebookWindow(); }
  if (turn.summary) currentMeeting.summary = turn.summary;
  addActivity('MEETING', `${turn.speaker}: ${turn.message}`);
}
function meetingStatePayload() { return currentMeeting; }

function safeName(value) { return String(value || 'session').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'session'; }
function sessionFolder() {
  const day = String(currentSessionMeta.startedAt || new Date().toISOString()).slice(0, 10);
  const folder = path.join(layout(reportFolder()).sessions, day, safeName(currentSessionId));
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}
function restoreLatestCompletedSession() {
  try {
    const files=[]; const walk=d=>{for(const x of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,x.name);if(x.isDirectory())walk(f);else if(x.name==='session.json')files.push(f);}};
    walk(reportFolder());
    files.sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);
    for(const file of files){
      const meta=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
      if(!meta.sessionId || meta.status?.state !== 'COMPLETED')continue;
      const folder=path.dirname(file), reportFile=path.join(folder,'reports.jsonl'), eventFile=path.join(folder,'events.jsonl');
      const restoredReports=fs.existsSync(reportFile)?fs.readFileSync(reportFile,'utf8').split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x.replace(/^\uFEFF/,''))):[];
      if(!restoredReports.length)continue;
      const restoredEvents=fs.existsSync(eventFile)?fs.readFileSync(eventFile,'utf8').split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x.replace(/^\uFEFF/,''))).slice(-500):[];
      currentSessionId=meta.sessionId; currentSessionMeta={...meta,startedAt:meta.startedAt||fs.statSync(file).birthtime.toISOString()}; reports=restoredReports.slice(-100); events=restoredEvents; activities=[];
      currentStatus={state:'COMPLETED',sessionId:currentSessionId,replayDate:meta.replayDate||null,eventCount:Number(meta.eventCount)||events.length,reportCount:reports.length,buildId:meta.buildId||null,buildSequence:Number(meta.buildSequence)||0,productVersion:meta.productVersion||null};
      addActivity('SESSION',`Restored completed session ${currentSessionId} for review.`); return true;
    }
  } catch(error) { console.error('RESTORE_COMPLETED_SESSION_FAILED',error); }
  return false;
}
function versionMemoryPath() { return path.join(layout(reportFolder()).memory, 'version-memory.json'); }
function loadVersionMemory() { try { return JSON.parse(fs.readFileSync(versionMemoryPath(), 'utf8')); } catch { return { productName:'FirstSignal Sim', productVersion:'v1', builds:{} }; } }
function saveVersionMemory(memory) { fs.writeFileSync(versionMemoryPath(), JSON.stringify(memory, null, 2)); }
function loadCanonicalKnowledge() { try { return JSON.parse(fs.readFileSync(path.join(layout(reportFolder()).findings,'canonical-findings.json'),'utf8').replace(/^\uFEFF/,'')); } catch { return { findings:{} }; } }
function versionContext() {
  const memory=loadVersionMemory(), canonical=loadCanonicalKnowledge(), current=currentSessionMeta.buildId || events.at(-1)?.buildId || 'UNKNOWN', currentSequence=Number(currentSessionMeta.buildSequence||events.at(-1)?.buildSequence||0);
  const builds=Object.values(memory.builds||{}).sort((a,b)=>(Number(a.buildSequence)||0)-(Number(b.buildSequence)||0)||String(a.lastSeen||'').localeCompare(String(b.lastSeen||'')));
  const prior=builds.filter(x=>x.buildId!==current).slice(-3), latest=builds.at(-1)||null, latestSequence=Number(latest?.buildSequence)||0;
  const relation=!latest?'FIRST_KNOWN':current===latest.buildId?'SAME':currentSequence>latestSequence?'NEWER':currentSequence<latestSequence?'OLDER':'DIFFERENT_UNORDERED';
  const durableKnowledge=Object.values(canonical.findings||{}).filter(x=>['VALIDATED','FIX_VERIFIED'].includes(x.lifecycleStatus)).sort((a,b)=>String(b.lastSeen||'').localeCompare(String(a.lastSeen||''))).slice(0,30).map(x=>({rootCauseKey:x.rootCauseKey||x.key,title:x.title,lifecycleStatus:x.lifecycleStatus,latestSummary:x.latestSummary,latestBuildId:x.latestBuildId,lastSeen:x.lastSeen}));
  const pendingKnowledge=Object.values(canonical.findings||{}).filter(x=>['REVIEWED_PENDING_ADJUDICATION','FIXED_PENDING_VALIDATION','PARTIALLY_VALIDATED'].includes(x.lifecycleStatus)).sort((a,b)=>String(b.lastSeen||'').localeCompare(String(a.lastSeen||''))).slice(0,20).map(x=>({rootCauseKey:x.rootCauseKey||x.key,title:x.title,lifecycleStatus:x.lifecycleStatus,latestSummary:x.latestSummary,latestBuildId:x.latestBuildId,lastSeen:x.lastSeen}));
  return { productName:currentSessionMeta.productName||'FirstSignal Sim', productVersion:currentSessionMeta.productVersion||'v1', currentBuildId:current, currentBuildSequence:currentSequence, relationToLatestKnown:relation, latestKnownBuild:latest?{buildId:latest.buildId,buildSequence:latestSequence,lastSeen:latest.lastSeen}:null, currentBuildKnown:!!memory.builds?.[current], durableKnowledge, pendingKnowledge, priorBuilds:prior.map(x=>({buildId:x.buildId,buildSequence:Number(x.buildSequence)||0,lastSeen:x.lastSeen,findings:(x.findings||[]).slice(-12)})), sameBuildFindings:(memory.builds?.[current]?.findings||[]).slice(-20) };
}
function updateVersionMemory(report) {
  if (WORKER_MODE || currentSessionMeta.provenance === 'STAGED_UNTRUSTED') { addActivity('TRUST_GATE', 'Blocked durable version-memory write from staged worker run.'); return false; }
  const memory=loadVersionMemory(), buildId=report.buildId||currentSessionMeta.buildId||'UNKNOWN';
  const build=memory.builds[buildId]||{buildId,productVersion:report.productVersion||currentSessionMeta.productVersion||'v1',buildSequence:Number(report.buildSequence||currentSessionMeta.buildSequence||0),firstSeen:new Date().toISOString(),findings:[]};
  build.lastSeen=new Date().toISOString();
  const key=report.finding_key||`${report.category}|${String(report.title||'').toLowerCase()}`;
  build.findings=[...(build.findings||[]).filter(x=>x.key!==key),{key,level:report.level,title:report.title,summary:report.summary,evidenceStatus:report.evidenceStatus||'RAW_OBSERVATION',versionAssessment:report.version_assessment||'NEW_FINDING',sessionId:report.sessionId,tick:report.tick,marketDate:report.marketDate||report.replayDate||null,marketTime:report.marketTime||report.t||null,observedAtUtc:report.observedAtUtc||new Date().toISOString(),at:new Date().toISOString()}].slice(-100);
  memory.builds[buildId]=build; saveVersionMemory(memory);
}

function normalizeReport(report) {
  const clean = { ...report };
  if (clean.level === 'RED') clean.approval_required = true;
  clean.confidence = Math.max(0, Math.min(1, Number(clean.confidence) || 0));
  return clean;
}

function isDuplicateReport(report, tick) {
  const fingerprint = `${report.level}|${report.category}|${String(report.title || '').toLowerCase()}`;
  const previousTick = recentFingerprints.get(fingerprint);
  recentFingerprints.set(fingerprint, tick);
  return previousTick != null && tick - previousTick < 90;
}

function positionIdentity(position) {
  if (!position) return 'FLAT';
  return [position.side || '', position.strike || '', position.entryTick ?? '', position.entry ?? ''].join(':');
}
function compactEvent(event = {}) {
  return {
    tick: event.tick, time: event.time, balance: event.balance,
    position: event.position ? { side: event.position.side, strike: event.position.strike, entry: event.position.entry, current: event.position.current, entryTick: event.position.entryTick, entrySpot:event.position.entrySpot, currentSpot:event.position.currentSpot } : null,
    market: event.market,
    intent: event.intent ? { action: event.intent.action, direction: event.intent.direction, readiness: event.intent.readiness, confidence: event.intent.confidence, blockers: (event.intent.blockers || []).slice(0, 3) } : null,
    dataHealth: event.dataHealth?.state || event.dataHealth,
    transmission: event.transmission?.state || event.transmission,
    recentTrades: (event.recentTrades || []).slice(-2),
    recentJournal: (event.recentJournal || []).slice(-3),
    recentMindset: (event.recentMindset || []).slice(-2),
    temporal: event.temporal || temporalMeta({replayDate:event.replayDate||currentSessionMeta.replayDate||null,marketTime:event.time||null}),
  };
}

function inspectContext(windowSize = 20, includePriorReports = true) {
  const raw = events.slice(-Math.max(1, Math.min(windowSize, 60)));
  const stride = Math.max(1, Math.floor(raw.length / 10));
  const sampled = raw.filter((_, i) => i % stride === 0 || i === raw.length - 1).slice(-12).map(compactEvent);
  const first = raw[0] || {}; const last = raw.at(-1) || {};
  return {
    recentEvents: sampled,
    priorReports: includePriorReports ? reports.slice(-5).map(r => ({ tick:r.tick, level:r.level, category:r.category, title:r.title, summary:r.summary, buildId:r.buildId, versionAssessment:r.version_assessment })) : [],
    versionContext: versionContext(),
    delta: {
      ticks: (last.tick ?? 0) - (first.tick ?? 0),
      balance: (last.balance ?? 0) - (first.balance ?? 0),
      positionChanged: positionIdentity(first.position) !== positionIdentity(last.position),
      intentChanged: first.intent?.action !== last.intent?.action,
      dataHealthChanged: first.dataHealth?.state !== last.dataHealth?.state,
    },
  };
}

async function chooseFolder() {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) return loadSettings();
  const settings = { ...loadSettings(), reportFolder: result.filePaths[0] };
  saveSettings(settings);
  refreshTray();
  return settings;
}

function saveReport(report) {
  const folder = sessionFolder();
  const jsonl = path.join(folder, 'reports.jsonl');
  const notebook = path.join(folder, 'notebook.txt');
  const tm=temporalMeta({replayDate:currentSessionMeta.replayDate||null,marketTime:report.t||null}); const enriched = { ...report, evidenceStatus:report.evidenceStatus||'RAW_OBSERVATION', ...tm, productName: currentSessionMeta.productName || 'FirstSignal Sim', productVersion: currentSessionMeta.productVersion || 'v1', buildId: report.buildId || currentSessionMeta.buildId || 'UNKNOWN', buildSequence:Number(report.buildSequence||currentSessionMeta.buildSequence||0), sessionId: currentSessionId, replayDate: currentSessionMeta.replayDate || null };
  fs.appendFileSync(jsonl, JSON.stringify(enriched) + '\n');
  const evidence = (enriched.evidence || []).map(x => `  • ${x}`).join('\n');
  const lines = [
    '', `[${enriched.t || '—'}] ${enriched.level} · ${enriched.category} · ${enriched.buildId}`,
    enriched.title, enriched.summary,
    `Version assessment: ${enriched.version_assessment || 'NEW_FINDING'}${enriched.related_build_id ? ` · related ${enriched.related_build_id}` : ''}`,
    evidence ? `Evidence:\n${evidence}` : '',
    `Next: ${enriched.suggested_action || 'None'}`,
    `Approval required: ${enriched.approval_required ? 'YES' : 'NO'}`,
    '-'.repeat(72), ''
  ];
  fs.appendFileSync(notebook, lines.filter((x,i)=>x || i===0 || i===lines.length-1).join('\n'));
  fs.writeFileSync(path.join(folder, 'session.json'), JSON.stringify({ ...currentSessionMeta, sessionId:currentSessionId, status:currentStatus, eventCount:events.length, reportCount:reports.length+1 }, null, 2));
  updateVersionMemory(enriched);
  reports = [...reports.slice(-99), enriched];
  return { folder, notebook, jsonl };
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

async function parallelStatus() {
  const manifestPath = path.resolve(__dirname, '..', 'runtime', 'parallel-campaign.json');
  if (!fs.existsSync(manifestPath)) return null;
  let manifest; try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
  const workers = await Promise.all((manifest.workers || []).map(async worker => {
    try {
      const response = await fetch(`http://127.0.0.1:${worker.port}/status`, { signal: AbortSignal.timeout(1500) });
      const data = await response.json();
      const campaign = data.supervisor?.campaign || {};
      const tick = Math.max(0, Math.min(1, (data.eventCount || 0) / 406));
      const failed=String(data.status?.state||'').startsWith('FAILED');
      const completed = ['COMPLETED','AWAITING_REVIEW_MEETING','MEETING_RUNNING','REVIEW_COMPLETE'].includes(data.status?.state) ? 1 : (campaign.completedRuns || (campaign.status === 'COMPLETED' ? 1 : 0));
      return { ...worker, online:true, state:failed ? data.status.state : (completed ? 'PENDING_REVIEW' : (data.supervisor?.state || data.status?.state || 'UNKNOWN')), failed, failureCode:data.status?.failureCode||null, completed, progress:completed ? 1 : tick, eventCount:completed ? 406 : (data.eventCount || 0), rawEventCount:data.eventCount || 0, sessionId:data.sessionId || null };
    } catch { return { ...worker, online:false, state:'OFFLINE', completed:0, progress:0, eventCount:0 }; }
  }));
  const completedRuns = workers.reduce((n,w)=>n+(w.completed ? 1 : 0),0);
  const progressRuns = workers.reduce((n,w)=>n+(Number(w.progress)||0),0);
  const status = ['STOPPED','STOPPED_UNTRUSTED'].includes(manifest.status) ? manifest.status : (workers.some(w=>w.failed)?'FAILED':(completedRuns >= workers.length && workers.length ? 'COMPLETED' : (workers.some(w=>w.online)?'RUNNING':'OFFLINE')));
  const visibleWorkers = ['RUNNING','PAUSED'].includes(status) ? workers : [];
  return { ...manifest, status, completedRuns, targetRuns:visibleWorkers.length, progressRuns, workers:visibleWorkers, archivedWorkerCount:workers.length };
}

function readJsonSafe(file,fallback=null){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{return fallback;}}
function findFiles(root,name,out=[]){if(!fs.existsSync(root))return out;for(const x of fs.readdirSync(root,{withFileTypes:true})){const f=path.join(root,x.name);x.isDirectory()?findFiles(f,name,out):x.name===name&&out.push(f);}return out;}
function reviewRoot(){return path.resolve(__dirname,'..','knowledge-pipeline','review-queue');}
function reviewTombstoneFile(){return path.resolve(__dirname,'..','runtime','review-tombstones.json');}
function reviewTombstones(){return readJsonSafe(reviewTombstoneFile(),{});}
function reviewKey(campaignId,workerId){return `${campaignId}/${workerId}`;}
function tombstoneReview(campaignId,workerId,reason='USER_DELETED'){const file=reviewTombstoneFile(),all=reviewTombstones();all[reviewKey(campaignId,workerId)]={campaignId,workerId,reason,deletedAt:new Date().toISOString()};fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(all,null,2));return all[reviewKey(campaignId,workerId)];}
function reviewRun(campaignId,workerId){const root=path.join(reviewRoot(),campaignId,workerId);if(reviewTombstones()[reviewKey(campaignId,workerId)]||!fs.existsSync(root)||fs.existsSync(path.join(root,'.deleted')))return null;const sf=findFiles(root,'session.json')[0],session=sf?readJsonSafe(sf,{}):{},provenance=readJsonSafe(path.join(root,'provenance.json'),{}),review=readJsonSafe(path.join(root,'observer-review.json'),null),assessment=readJsonSafe(path.join(root,'assessment-status.json'),null),decision=readJsonSafe(path.join(root,'learning-decision.json'),null);let reports=review?.reports||[];if(!reports.length){try{reports=fs.readFileSync(path.join(root,'observer-reports.jsonl'),'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);}catch{}}let meeting=null;if(assessment?.meetingFolder)meeting={...assessment,summaryFile:readJsonSafe(path.join(assessment.meetingFolder,'meeting-summary.json'),null),notepad:(()=>{try{return fs.readFileSync(path.join(assessment.meetingFolder,'shared-notepad.txt'),'utf8');}catch{return ''}})()};return {campaignId,workerId,root,replayDate:session.replayDate||provenance.replayDate||null,sessionId:session.sessionId||provenance.sourceSessionId||null,buildId:session.buildId||null,salvage:session.salvage||null,provenance,status:assessment?.status||review?.status||provenance.status||'PENDING_REVIEW',reportCount:reports.length,reports,assessment,meeting,decision};}
function listReviewRuns(){const root=reviewRoot();if(!fs.existsSync(root))return [];const out=[];for(const c of fs.readdirSync(root,{withFileTypes:true}).filter(x=>x.isDirectory()))for(const w of fs.readdirSync(path.join(root,c.name),{withFileTypes:true}).filter(x=>x.isDirectory())){const run=reviewRun(c.name,w.name);if(run)out.push(run);}return out.sort((a,b)=>String(b.provenance?.promotedAt||b.assessment?.completedAt||'').localeCompare(String(a.provenance?.promotedAt||a.assessment?.completedAt||'')));}

function startServer() {
  server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return json(res, 204, {});
    if (req.url === '/trader/continuity' && req.method === 'POST') { const body=await readBody(req); traderInterview.continuity={...body,updatedAt:new Date().toISOString()}; return json(res,200,{ok:true}); }
    if (req.url === '/trader/interview/next' && req.method === 'GET') { const item=traderInterview.queue.find(x=>x.status==='QUEUED'); if(item){item.status='DELIVERED';item.deliveredAt=new Date().toISOString();} return json(res,200,{item:item||null,state:traderInterview.state,continuity:traderInterview.continuity}); }
    if (req.url === '/trader/interview/respond' && req.method === 'POST') { const body=await readBody(req); const waiter=traderInterview.pending.get(body.id); if(waiter){traderInterview.pending.delete(body.id);body.error?waiter.reject(new Error(body.error)):waiter.resolve(body.answer);} const item=traderInterview.queue.find(x=>x.id===body.id);if(item){item.status=body.error?'FAILED':'ANSWERED';item.answer=body.answer||null;} return json(res,200,{ok:true}); }
    if (req.url === '/runtime-state' && req.method === 'POST') {
      const body=await readBody(req);const now=Date.now();const tick=Number(body.tick)||0;
      const lastProgressAt=tick>Number(workerRuntime.tick||0)?now:Number(workerRuntime.lastProgressAt||now);
      workerRuntime={...workerRuntime,...body,tick,lastProgressAt,updatedAt:new Date(now).toISOString()};
      const providerFailure=body.provider?.circuitOpen?String(body.provider?.circuitReason||'PROVIDER_CIRCUIT_OPEN'):null;
      const stalled=body.state==='RUNNING'&&!body.aiFrozen&&!body.thinking&&body.provider?.state==='CONNECTED'&&now-lastProgressAt>90000;
      if(providerFailure)currentStatus={...currentStatus,state:'FAILED_PROVIDER',failureCode:providerFailure,failedAt:new Date(now).toISOString()};
      else if(body.state==='PROVIDER_THROTTLED')currentStatus={...currentStatus,state:'PROVIDER_THROTTLED',retryAfterMs:body.provider?.retryAfterMs||null};
      else if(stalled)currentStatus={...currentStatus,state:'FAILED_STALL',failureCode:'NO_TICK_PROGRESS_60S',failedAt:new Date(now).toISOString()};
      return json(res,200,{ok:true,runtime:workerRuntime,status:currentStatus});
    }
    if (req.url === '/worker/control' && req.method === 'GET') return json(res,200,workerControl);
    if (req.url === '/worker/control' && req.method === 'POST') { const body=await readBody(req); workerControl={...workerControl,...body,updatedAt:new Date().toISOString()}; return json(res,200,{ok:true,control:workerControl}); }
    if (req.url === '/parallel/controller/open' && req.method === 'POST') { openCampaignController(); return json(res,200,{ok:true}); }
    if (req.url === '/parallel/start' && req.method === 'POST') { const body=await readBody(req); const selected=(body.dates||[]).filter(Boolean); if(!selected.length)return json(res,400,{error:'AT_LEAST_ONE_REPLAY_DATE_REQUIRED'}); const dates=selected.join(','); const runs=Math.max(1,Number(body.runsPerDay)||1); const speed=Math.max(.5,Number(body.speed)||3); const targetRuns=selected.length*runs; const tailMinutes=Math.max(0,Math.min(60,Number(body.tailMinutes)||0)); const root=path.resolve(__dirname,'..'); const mp=path.join(root,'runtime','parallel-campaign.json'); try{fs.mkdirSync(path.dirname(mp),{recursive:true});fs.writeFileSync(mp,JSON.stringify({id:'STARTING-'+Date.now(),status:'STARTING',createdAt:new Date().toISOString(),speed,runsPerDay:runs,selectedDates:selected,tailMinutes,workers:[]},null,2));}catch{} const cleanup=`$ports=8801..8899; Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {$ports -contains $_.LocalPort} | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue}`; const launch=()=>{const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts','start-parallel-campaign.ps1'),'-DateList',dates,'-RunsPerDay',String(runs),'-Speed',String(speed),'-TailMinutes',String(tailMinutes)],{cwd:root,windowsHide:true,stdio:['ignore','ignore','pipe']});child.stderr?.on('data',d=>console.error('PARALLEL_START_ERROR',String(d)));}; const cleaner=spawn('powershell.exe',['-NoProfile','-Command',cleanup],{windowsHide:true}); cleaner.on('exit',launch); cleaner.on('error',launch); return json(res,202,{ok:true,dates:selected,runsPerDay:runs,speed,tailMinutes,targetRuns}); }
    if (req.url === '/parallel/control' && req.method === 'POST') { const body=await readBody(req); const parallel=await parallelStatus(); if(!parallel||!['RUNNING','PAUSED'].includes(parallel.status))return json(res,409,{error:'NO_ACTIVE_CAMPAIGN'}); if(body.action==='STOP'){ const pids=[...new Set((parallel.workers||[]).map(w=>w.pid).filter(Boolean))]; for(const pid of pids){try{process.kill(pid,'SIGKILL');}catch{}} const mp=path.resolve(__dirname,'..','runtime','parallel-campaign.json'); const m=JSON.parse(fs.readFileSync(mp,'utf8').replace(/^\uFEFF/,'')); m.status='STOPPED_UNTRUSTED';m.stoppedAt=new Date().toISOString();fs.writeFileSync(mp,JSON.stringify(m,null,2)); return json(res,200,{ok:true,killed:pids.length,status:m.status});} const results=await Promise.all(parallel.workers.map(async w=>{try{const r=await fetch(`http://127.0.0.1:${w.port}/worker/control`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(1200)});return {id:w.id,ok:r.ok};}catch{return {id:w.id,ok:false};}})); const controlled=results.filter(x=>x.ok).length; if(body.action==='PAUSE'||body.action==='RUN'){const mp=path.resolve(__dirname,'..','runtime','parallel-campaign.json');try{const m=JSON.parse(fs.readFileSync(mp,'utf8').replace(/^\uFEFF/,''));m.status=body.action==='PAUSE'?'PAUSED':'RUNNING';fs.writeFileSync(mp,JSON.stringify(m,null,2));}catch{}} return json(res,200,{ok:controlled>0,controlled,results}); }
    if (req.url === '/parallel/promote' && req.method === 'POST') { const body=await readBody(req); const mp=path.resolve(__dirname,'..','runtime','parallel-campaign.json'); const m=JSON.parse(fs.readFileSync(mp,'utf8').replace(/^\uFEFF/,'')); const ids=new Set(body.workerIds||[]); const promoted=[]; const rejected=[]; for(const w of m.workers.filter(x=>ids.has(x.id))){ try{ const files=[]; const walk=d=>{if(!fs.existsSync(d))return;for(const x of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,x.name);x.isDirectory()?walk(f):x.name==='session.json'&&files.push(f);}}; walk(w.reportFolder); if(files.length!==1)throw new Error('SESSION_FILE_COUNT_'+files.length); const meta=JSON.parse(fs.readFileSync(files[0],'utf8').replace(/^\uFEFF/,'')); if(!['COMPLETED','AWAITING_REVIEW_MEETING'].includes(meta.status?.state))throw new Error('NOT_COMPLETED'); if(!meta.reflectionComplete||!meta.reflectionArtifact||!fs.existsSync(path.join(path.dirname(files[0]),meta.reflectionArtifact)))throw new Error('TRADER_REFLECTION_REQUIRED'); if(meta.validationMode==='TAIL_VALIDATION'||meta.mode==='tail-validation')throw new Error('TAIL_VALIDATION_NOT_PROMOTABLE'); if(Number(meta.eventCount)<400)throw new Error('INCOMPLETE_EVENT_COUNT'); if(meta.replayDate!==w.replayDate)throw new Error('DATE_MISMATCH'); if(meta.campaignId!==m.id||meta.workerId!==w.id||meta.provenance!=='STAGED_UNTRUSTED')throw new Error('PROVENANCE_MISMATCH'); const dest=path.resolve(__dirname,'..','knowledge-pipeline','review-queue',m.id,w.id); fs.mkdirSync(path.dirname(dest),{recursive:true}); if(fs.existsSync(dest))fs.rmSync(dest,{recursive:true,force:true}); fs.cpSync(w.reportFolder,dest,{recursive:true}); fs.writeFileSync(path.join(dest,'provenance.json'),JSON.stringify({campaignId:m.id,workerId:w.id,replayDate:w.replayDate,sourceSessionId:meta.sessionId,eventCount:meta.eventCount,status:'PROMOTED_PENDING_REVIEW',promotedAt:new Date().toISOString()},null,2)); w.status='PROMOTED_PENDING_REVIEW';w.promotedPath=dest;promoted.push(w.id);}catch(e){rejected.push({id:w.id,error:String(e.message||e)});} } fs.writeFileSync(mp,JSON.stringify(m,null,2)); return json(res,200,{ok:rejected.length===0,promoted,rejected}); }
    if (req.url === '/parallel/discard' && req.method === 'POST') { const body=await readBody(req); const mp=path.resolve(__dirname,'..','runtime','parallel-campaign.json'); let m=JSON.parse(fs.readFileSync(mp,'utf8').replace(/^\uFEFF/,'')); const ids=new Set(body.workerIds||[]); const selected=m.workers.filter(w=>ids.has(w.id)); for(const w of selected){try{await fetch(`http://127.0.0.1:${w.port}/worker/control`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'STOP'}),signal:AbortSignal.timeout(800)});}catch{} if(body.deleteData){try{fs.rmSync(w.reportFolder,{recursive:true,force:true});}catch{}} else {try{const q=path.resolve(__dirname,'..','knowledge-pipeline','quarantine',m.id,w.id);fs.mkdirSync(path.dirname(q),{recursive:true});if(fs.existsSync(w.reportFolder))fs.renameSync(w.reportFolder,q);}catch{}} w.discarded=true; w.discardedAt=new Date().toISOString();} fs.writeFileSync(mp,JSON.stringify(m,null,2)); return json(res,200,{ok:true,discarded:[...ids]}); }
    if (req.url === '/reviews/list' && req.method === 'GET') return json(res,200,{runs:listReviewRuns()});
    if (req.url?.startsWith('/reviews/detail') && req.method === 'GET') { const u=new URL(req.url,'http://127.0.0.1'); const run=reviewRun(u.searchParams.get('campaignId'),u.searchParams.get('workerId')); return run?json(res,200,run):json(res,404,{error:'REVIEW_RUN_NOT_FOUND'}); }
    if (req.url === '/reviews/observer/start' && req.method === 'POST') { const body=await readBody(req),run=reviewRun(body.campaignId,body.workerId); if(!run)return json(res,404,{error:'REVIEW_RUN_NOT_FOUND'}); if(run.reportCount)return json(res,409,{error:'OBSERVER_REVIEW_ALREADY_COMPLETE'}); const child=spawn(process.execPath,[path.resolve(__dirname,'..','scripts','review-promoted-run.cjs'),body.campaignId,body.workerId],{cwd:path.resolve(__dirname,'..'),windowsHide:true,detached:true,stdio:'ignore'});child.unref();return json(res,202,{ok:true}); }
    if (req.url === '/reviews/meeting/start' && req.method === 'POST') { const body=await readBody(req),run=reviewRun(body.campaignId,body.workerId); if(!run)return json(res,404,{error:'REVIEW_RUN_NOT_FOUND'}); if(!run.reportCount)return json(res,409,{error:'OBSERVER_REVIEW_REQUIRED'}); let worker=null;try{const m=JSON.parse(fs.readFileSync(path.resolve(__dirname,'..','runtime','parallel-campaign.json'),'utf8').replace(/^\uFEFF/,''));worker=(m.workers||[]).find(x=>x.id===body.workerId&&m.id===body.campaignId);}catch{} if(worker?.port){try{const sessionFiles=[];const walk=d=>{if(!fs.existsSync(d))return;for(const x of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,x.name);x.isDirectory()?walk(f):x.name==='session.json'&&sessionFiles.push(f);}};walk(run.root);const sf=sessionFiles[0]?path.dirname(sessionFiles[0]):run.root;const rr=await fetch(`http://127.0.0.1:${worker.port}/original-trader/meeting/start`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:`supervisor-${run.replayDate||'review'}`,reports:run.reports,sessionFolder:sf}),signal:AbortSignal.timeout(5000)});const data=await rr.json();if(rr.ok)return json(res,202,{ok:true,traderSource:'ORIGINAL_TRADER',...data});if(data.error!=='ORIGINAL_TRADER_SESSION_UNAVAILABLE')return json(res,rr.status,data);}catch(e){}} return json(res,409,{error:'ORIGINAL_TRADER_SESSION_UNAVAILABLE',fallbackAvailable:true}); }
    if (req.url === '/reviews/delete' && req.method === 'POST') { const body=await readBody(req),run=reviewRun(body.campaignId,body.workerId); if(!run)return json(res,404,{error:'REVIEW_RUN_NOT_FOUND'}); const mark=tombstoneReview(body.campaignId,body.workerId); try{fs.writeFileSync(path.join(run.root,'.deleted'),JSON.stringify(mark,null,2));}catch{} return json(res,200,{ok:true,deleted:{campaignId:body.campaignId,workerId:body.workerId},tombstoned:true,disposition:'HIDDEN_IMMEDIATELY'}); }
    if (req.url === '/reviews/decision' && req.method === 'POST') { const body=await readBody(req),run=reviewRun(body.campaignId,body.workerId); if(!run)return json(res,404,{error:'REVIEW_RUN_NOT_FOUND'}); const record={decision:String(body.decision||'PENDING').toUpperCase(),note:String(body.note||''),decidedAt:new Date().toISOString()};fs.writeFileSync(path.join(run.root,'learning-decision.json'),JSON.stringify(record,null,2));return json(res,200,{ok:true,decision:record}); }
    if (req.url === '/parallel/status' && req.method === 'GET') { const parallel=await parallelStatus(); return parallel?json(res,200,parallel):json(res,404,{error:'NO_PARALLEL_CAMPAIGN'}); }
    if (req.url === '/status' && req.method === 'GET') { const snap=canonicalSessionSnapshot(); return json(res,200,{...snap,supervisor:supervisor?.getState()||null,settings:loadSettings()}); }
    if (req.url === '/supervisor/status' && req.method === 'GET') return json(res, 200, supervisor?.getState()||{state:'STARTING'});
    if (req.url === '/supervisor/decision' && req.method === 'POST') { const body=await readBody(req); const item=supervisor?.decide(body.itemId, body.decision); return item?json(res,200,{ok:true,item}):json(res,404,{error:'BACKLOG_ITEM_NOT_FOUND'}); }
    if (req.url === '/supervisor/campaign' && req.method === 'POST') { const body=await readBody(req); return json(res,202,{ok:true,campaign:supervisor?.startCampaign(body)}); }
    if (req.url === '/supervisor/command' && req.method === 'GET') return json(res,200,{command:supervisor?.nextCommand()||null});
    if (req.url === '/supervisor/command/ack' && req.method === 'POST') { const body=await readBody(req); const command=supervisor?.ackCommand(body.commandId,body); return command?json(res,200,{ok:true,command}):json(res,404,{error:'COMMAND_NOT_FOUND'}); }
    if (req.url === '/supervisor/proposal/decision' && req.method === 'POST') { const body=await readBody(req); const proposal=supervisor?.decideProposal(body.index,body.decision); return proposal?json(res,200,{ok:true,proposal}):json(res,404,{error:'PROPOSAL_NOT_FOUND'}); }
    if (req.url === '/session/start' && req.method === 'POST') { const body=await readBody(req); const sameRun=currentSessionId&&body.sessionId!==currentSessionId&&body.replayDate===currentSessionMeta.replayDate&&body.buildId===currentSessionMeta.buildId; const activeFresh=sameRun&&!String(currentStatus.state||'').startsWith('FAILED')&&!['COMPLETED','AWAITING_REVIEW_MEETING'].includes(currentStatus.state)&&workerRuntime.running===true&&(Date.now()-(workerRuntime.lastProgressAt||0)<90000); if(activeFresh)return json(res,409,{error:'DUPLICATE_ACTIVE_SESSION_REJECTED',canonicalSessionId:currentSessionId}); resetSession(body.sessionId,body); return json(res,200,{ok:true,sessionId:currentSessionId}); }
    if (req.url === '/session/finalization-diagnostic' && req.method === 'POST') {
      const body=await readBody(req);
      if(!body.sessionId)return json(res,400,{error:'SESSION_ID_REQUIRED'});
      const folder=sessionFolder(body.sessionId);fs.mkdirSync(folder,{recursive:true});
      fs.appendFileSync(path.join(folder,'finalization-diagnostics.jsonl'),JSON.stringify({...body,recordedAt:new Date().toISOString()})+'\n');
      return json(res,200,{ok:true});
    }
    if (req.url === '/session/reflection-draft' && req.method === 'POST') {
      const body=await readBody(req);
      if(!body.sessionId)return json(res,400,{error:'SESSION_ID_REQUIRED'});
      const folder=sessionFolder(body.sessionId);
      fs.mkdirSync(folder,{recursive:true});
      const validation=validateReflectionFacts(body);
      if(!validation.ok)return json(res,422,{error:'REFLECTION_FACT_GATE_REJECTED',details:validation.errors});
      const artifact={sessionId:body.sessionId,replayDate:body.replayDate||null,privateReflection:String(body.privateReflection||''),nextSessionHandoff:String(body.nextSessionHandoff||''),referencedTradeIds:body.referencedTradeIds||[],factualClaims:body.factualClaims||[],validation:{status:'PASSED',validatedAt:new Date().toISOString(),canonicalTradeIds:validation.ledger.map(x=>x.id)},traderContinuity:body.traderContinuity||null,state:body.state||'DRAFT',savedAt:new Date().toISOString()};
      fs.writeFileSync(path.join(folder,'trader-closing-reflection.json'),JSON.stringify(artifact,null,2));
      return json(res,200,{ok:true,artifact:'trader-closing-reflection.json',validation:artifact.validation});
    }
    if (req.url === '/events/finalize' && req.method === 'POST') {
      const body=await readBody(req);
      if(!body.sessionId||body.sessionId!==currentSessionId)return json(res,409,{error:'SESSION_MISMATCH'});
      if(!Array.isArray(body.events))return json(res,400,{error:'EVENTS_ARRAY_REQUIRED'});
      const canonical=body.events.map(snapshot=>({...snapshot,temporal:temporalMeta({replayDate:snapshot.replayDate||currentSessionMeta.replayDate||null,marketTime:snapshot.time||null})})).sort((a,b)=>Number(a.tick)-Number(b.tick));
      const uniqueTicks=[...new Set(canonical.map(e=>Number(e.tick)).filter(Number.isFinite))].sort((a,b)=>a-b);
      const expectedStartTick=Math.max(1,Number(body.expectedStartTick)||1);
      const expectedEndTick=Math.max(expectedStartTick,Number(body.expectedEndTick)||Number(canonical.at(-1)?.tick)||expectedStartTick);
      const expectedTicks=Array.from({length:expectedEndTick-expectedStartTick+1},(_, i)=>expectedStartTick+i);
      const missing=expectedTicks.filter(t=>!uniqueTicks.includes(t));
      if(canonical.length!==expectedTicks.length||uniqueTicks.length!==expectedTicks.length||missing.length)return json(res,409,{error:'EVENT_SET_INCOMPLETE',eventCount:canonical.length,uniqueCount:uniqueTicks.length,expectedStartTick,missing});
      currentSessionMeta={...currentSessionMeta,validationMode:body.validationMode||currentSessionMeta.validationMode||null,expectedStartTick};
      const folder=sessionFolder(); const target=path.join(folder,'events.jsonl'); const temp=`${target}.tmp`;
      fs.writeFileSync(temp,canonical.map(e=>JSON.stringify(compactEvent(e))).join('\n')+'\n');
      fs.renameSync(temp,target);
      events=canonical;
      return json(res,200,{ok:true,eventCount:events.length,firstTick:events[0]?.tick,lastTick:events.at(-1)?.tick});
    }
    if (req.url === '/session/end' && req.method === 'POST') { const body = await readBody(req); if (!currentSessionId) resetSession(null); else if (!body.sessionId || body.sessionId === currentSessionId) completeSession(body); return json(res, 200, { ok: true, status: currentStatus }); }
    if (req.url === '/open-folder' && req.method === 'POST') { await shell.openPath(reportFolder()); return json(res, 200, { ok: true }); }
    if (req.url === '/open-notebook' && req.method === 'POST') { await shell.openPath(path.join(sessionFolder(), 'notebook.txt')); return json(res, 200, { ok: true }); }
    if (req.url === '/choose-folder' && req.method === 'POST') return json(res, 200, await chooseFolder());
    if (req.url === '/original-trader/meeting/start' && req.method === 'POST') {
      const body=await readBody(req);
      if(!traderInterview.continuity?.available)return json(res,409,{error:'ORIGINAL_TRADER_SESSION_UNAVAILABLE'});
      if(currentStatus.state!=='AWAITING_REVIEW_MEETING')return json(res,409,{error:'TRADER_NOT_AWAITING_MEETING',state:currentStatus.state});
      if(!Array.isArray(body.reports)||!body.reports.length)return json(res,409,{error:'OBSERVER_REVIEW_REQUIRED'});
      if(currentMeeting.state==='RUNNING')return json(res,409,{error:'MEETING_ALREADY_RUNNING'});
      currentSessionMeta={...currentSessionMeta,provenance:'PROMOTED_PENDING_REVIEW'};reports=body.reports;
      currentMeeting={state:'RUNNING',name:String(body.name||'supervisor-review'),transcript:[],folder:null,summary:null,startedAt:new Date().toISOString(),traderSource:'ORIGINAL_TRADER'};
      currentStatus={...currentStatus,state:'MEETING_RUNNING'};refreshTray();
      meetingRunner.run({name:currentMeeting.name,reports:[...reports],events:[...events],sessionMeta:{...currentSessionMeta,status:currentStatus},sessionFolder:body.sessionFolder||sessionFolder()}).then(result=>{currentMeeting={...currentMeeting,state:result.status,name:result.meetingName,folder:result.folder,summary:result.summary,endedAt:new Date().toISOString()};currentStatus={...currentStatus,state:result.status==='COMPLETED'?'REVIEW_COMPLETE':'AWAITING_REVIEW_MEETING'};traderInterview.state=currentStatus.state;refreshTray();});
      return json(res,202,{ok:true,meeting:currentMeeting,traderSource:'ORIGINAL_TRADER'});
    }
    if (req.url === '/meeting/notepad' && req.method === 'GET') {
      const file = currentMeeting.folder ? path.join(currentMeeting.folder, 'shared-notepad.txt') : null;
      let text = '';
      try { if (file && fs.existsSync(file)) text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); } catch {}
      return json(res, 200, { name:currentMeeting.name, state:currentMeeting.state, folder:currentMeeting.folder, text });
    }    if (req.url === '/meeting/start' && req.method === 'POST') {
      const body = await readBody(req);
      if (body.reviewMode !== 'POSTHOC_APPROVED') return json(res, 403, { error:'POSTHOC_REVIEW_APPROVAL_REQUIRED' });
      if (currentSessionMeta.provenance !== 'PROMOTED_PENDING_REVIEW') return json(res, 403, { error:'PROMOTED_SESSION_REQUIRED' });
      if (currentMeeting.state === 'RUNNING') return json(res, 409, { error:'MEETING_ALREADY_RUNNING', meeting:currentMeeting });
      if (!currentSessionId || !reports.length) return json(res, 409, { error:'COMPLETED_SESSION_WITH_FINDINGS_REQUIRED' });
      const name = String(body.name || '').trim();
      currentMeeting = { state:'RUNNING', name, transcript:[], folder:null, summary:null, startedAt:new Date().toISOString() };
      refreshTray();
      meetingRunner.run({ name, reports:[...reports], events:[...events], sessionMeta:{...currentSessionMeta,status:currentStatus}, sessionFolder:sessionFolder() }).then(result => {
        currentMeeting = { ...currentMeeting, state:result.status, name:result.meetingName, folder:result.folder, summary:result.summary, endedAt:new Date().toISOString() };
        refreshTray();
      });
      return json(res, 202, { ok:true, meeting:currentMeeting });
    }
    if (req.url === '/meeting/stop' && req.method === 'POST') {
      if (!['RUNNING','PAUSED_RATE_LIMIT'].includes(currentMeeting.state)) return json(res, 409, { error:'NO_RUNNING_MEETING', meeting:currentMeeting });
      meetingRunner.stop();
      currentMeeting = { ...currentMeeting, state:'STOPPING' };
      refreshTray();
      return json(res, 202, { ok:true, meeting:currentMeeting });
    }
    if (req.url === '/meeting/open' && req.method === 'POST') {
      if (!currentMeeting.folder) return json(res, 404, { error:'NO_MEETING_FOLDER' });
      await shell.openPath(currentMeeting.folder); return json(res, 200, { ok:true });
    }
    if ((req.url === '/event' || req.url === '/observe') && req.method === 'POST') {
      try {
        const snapshot = await readBody(req);
        if (!snapshot.sessionId) return json(res, 409, { error: 'SESSION_ID_REQUIRED' });
        if (snapshot.sessionId !== currentSessionId) resetSession(snapshot.sessionId, { replayDate:snapshot.replayDate, productName:snapshot.productName, productVersion:snapshot.productVersion, buildId:snapshot.buildId, buildSequence:snapshot.buildSequence, label:snapshot.sessionLabel, mode:snapshot.sessionMode });
        const prior = events.at(-1);
        const temporal=temporalMeta({replayDate:snapshot.replayDate||currentSessionMeta.replayDate||null,marketTime:snapshot.time||null}); const enrichedSnapshot={...snapshot,temporal};
        events = [...events.slice(-499), enrichedSnapshot];
        fs.appendFileSync(path.join(sessionFolder(), 'events.jsonl'), JSON.stringify(compactEvent(enrichedSnapshot)) + '\n');
        const critical = snapshot.dataHealth?.state === 'FAILED' || snapshot.transmission?.state === 'FAILED';
        const positionChanged = positionIdentity(prior?.position) !== positionIdentity(snapshot.position);
        const periodic = !prior || snapshot.tick - lastAnalyzedTick >= 20;
        const meaningful = critical || positionChanged || periodic;
        if (cooldownUntil && Date.now() >= cooldownUntil) { cooldownUntil = 0; quotaBlocked = false; currentStatus = { state: currentSessionId ? 'WATCHING' : 'IDLE' }; addActivity('RECOVERY', 'Gemini cooldown ended; model investigations resumed.'); }
        if (meaningful && !analyzing && !quotaBlocked && process.env.FIRSTSIGNAL_OBSERVER_MODE === 'live') {
          analyzing = true; lastAnalyzedTick = snapshot.tick;
          if (currentStatus.state !== 'COMPLETED') currentStatus = { state: 'ANALYZING', tick: snapshot.tick, time: snapshot.time };
          addActivity('WAKE', `Meaningful simulator event at tick ${snapshot.tick}`);
          runQa(enrichedSnapshot).then(report => {
            const clean = normalizeReport({ ...report, t: snapshot.time, tick: snapshot.tick, buildId:snapshot.buildId, buildSequence:snapshot.buildSequence, productVersion:snapshot.productVersion, id: `QA-${Date.now()}` });
            if (!isDuplicateReport(clean, snapshot.tick)) saveReport(clean);
            else addActivity('DEDUPE', `Suppressed repeated ${clean.level} finding: ${clean.title}`);
            if (currentStatus.state !== 'COMPLETED') currentStatus = { state: clean.level === 'RED' ? 'APPROVAL REQUIRED' : 'WATCHING', level: clean.level, title: clean.title, tick: clean.tick, time: clean.t };
            addActivity(clean.level, `${clean.title}: ${clean.summary}`);
          }).catch(error => {
            const message = String(error?.message || error);
            const rateLimited = /quota|resource_exhausted|429/i.test(message);
            if (rateLimited) { quotaBlocked = true; cooldownUntil = Date.now() + 60_000; }
            if (currentStatus.state !== 'COMPLETED') currentStatus = { state: rateLimited ? 'COOLDOWN: GEMINI RATE LIMIT' : `OFFLINE: ${message.slice(0, 80)}` };
            addActivity('ERROR', `${currentStatus.state} | ${message}`);
          }).finally(() => { analyzing = false; refreshTray(); });
        }
        return json(res, 202, { accepted: true, meaningful, analyzing, status: currentStatus });
      } catch (error) { return json(res, 400, { error: String(error?.message || error) }); }
    }
    return json(res, 404, { error: 'Not found' });
  });
  server.listen(AGENT_PORT, '127.0.0.1');
}

function openCampaignController() {
  if (controllerWin && !controllerWin.isDestroyed()) { controllerWin.show(); controllerWin.focus(); return; }
  controllerWin = new BrowserWindow({ width:620,height:650,minWidth:520,minHeight:480,backgroundColor:'#07090c',show:true,webPreferences:{contextIsolation:true,nodeIntegration:false} });
  controllerWin.loadFile(path.join(__dirname,'campaign-controller.html'));
  controllerWin.on('closed',()=>{controllerWin=null;});
}

function createCampaignHud() {
  const area = screen.getPrimaryDisplay().workArea;
  const width = 360, height = 108;
  hudWin = new BrowserWindow({
    width, height, x: area.x + area.width - width - 14, y: area.y + area.height - height - 14,
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, movable: false, focusable: true, show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  hudWin.setAlwaysOnTop(true, 'screen-saver');
  hudWin.setIgnoreMouseEvents(false);
  hudWin.loadFile(path.join(__dirname, 'campaign-hud.html'));
  hudWin.on('closed', () => { hudWin = null; });
}

function createHeadlessSimulator() {
  simulatorWin = new BrowserWindow({
    width: 1280, height: 900, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  const baseUrl = process.env.FIRSTSIGNAL_URL || 'http://127.0.0.1:5173/index.html';
  const joiner = baseUrl.includes('?') ? '&' : '?';
  const url = `${baseUrl}${joiner}agentPort=${AGENT_PORT}&worker=${WORKER_MODE ? '1' : '0'}`;
  const renderLog=path.join(reportFolder(),'worker-renderer.log');
  simulatorWin.webContents.on('console-message',(_e,level,message,line,source)=>{try{fs.appendFileSync(renderLog,`${new Date().toISOString()} CONSOLE ${level} ${message} ${source}:${line}\n`);}catch{}});
  simulatorWin.webContents.on('did-fail-load',(_e,code,desc,failedUrl)=>{try{fs.appendFileSync(renderLog,`${new Date().toISOString()} LOAD_FAIL ${code} ${desc} ${failedUrl}\n`);}catch{}});
  simulatorWin.webContents.on('render-process-gone',(_e,details)=>{try{fs.appendFileSync(renderLog,`${new Date().toISOString()} RENDER_GONE ${JSON.stringify(details)}\n`);}catch{}});
  simulatorWin.loadURL(url);
  simulatorWin.webContents.setBackgroundThrottling(false);
  simulatorWin.on('closed', () => { simulatorWin = null; });
}

function createWindow() {
  win = new BrowserWindow({
    width: 430, height: 720, minWidth: 390, minHeight: 520,
    backgroundColor: '#07090c', show: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'console.html'));
  win.on('close', event => {
    if (!app.isQuitting) { event.preventDefault(); win.hide(); }
  });
}

function openSimulatorInBrowser() {
  const baseUrl = process.env.FIRSTSIGNAL_URL || 'http://127.0.0.1:5173/index.html';
  const joiner = baseUrl.includes('?') ? '&' : '?';
  const url = `${baseUrl}${joiner}agentPort=${AGENT_PORT}`;
  const chromePath = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
  try {
    if (fs.existsSync(chromePath)) {
      const child = spawn(chromePath, [url], { detached:true, stdio:'ignore', windowsHide:true });
      child.unref();
      return;
    }
  } catch (error) { console.error('CHROME_TAB_OPEN_FAILED', error); }
  shell.openExternal(url).catch(error => console.error('BROWSER_SIM_OPEN_FAILED', error));
}

app.whenReady().then(async () => {
  runQa = await createRunner({ activity: addActivity, inspect: inspectContext });
  meetingRunner = createMeetingRunner({ emit: emitMeeting, askOriginalTrader: prompt => new Promise((resolve,reject)=>{ if(!traderInterview.continuity?.available)return reject(new Error('ORIGINAL_TRADER_SESSION_UNAVAILABLE')); const id='TI-'+Date.now()+'-'+Math.random().toString(36).slice(2,6); traderInterview.state='MEETING_RUNNING'; traderInterview.queue.push({id,prompt,status:'QUEUED',createdAt:new Date().toISOString()}); traderInterview.pending.set(id,{resolve,reject}); setTimeout(()=>{if(traderInterview.pending.has(id)){traderInterview.pending.delete(id);reject(new Error('ORIGINAL_TRADER_RESPONSE_TIMEOUT'));}},90000); }) });
  if (!WORKER_MODE) restoreLatestCompletedSession();
  if (!WORKER_MODE) createWindow();
  if (WORKER_MODE) createHeadlessSimulator();
  if (!WORKER_MODE) createCampaignHud();
  startServer();
  if (!WORKER_MODE) openSimulatorInBrowser();
  supervisor = createSupervisorService({ reportFolder, sessionFolder, snapshot:()=>canonicalSessionSnapshot(), activity:addActivity, emit:()=>refreshTray() });
  supervisor.start();
  if (!currentSessionId) currentStatus = { state: 'WATCHING' };
  if (!WORKER_MODE) {
    tray = new Tray(trayIcon('WATCHING'));
    tray.on('double-click', () => { win.show(); win.focus(); });
    refreshTray();
    tray.displayBalloon?.({ iconType: 'info', title: 'FirstSignal Sim v1 QA Agent', content: 'WATCHING | FirstSignal Sim v1 observer is ready.' });
  }
});
app.on('before-quit', () => { app.isQuitting = true; supervisor?.stop(); meetingRunner?.stop(); meetingNotebookWin?.destroy(); controllerWin?.destroy(); simulatorWin?.destroy(); hudWin?.destroy(); server?.close(); });
app.on('window-all-closed', event => event.preventDefault());

ipcMain.handle('agent:get-state', () => ({ status: currentStatus, sessionId: currentSessionId, sessionMeta:currentSessionMeta, reports, activities, eventCount: events.length, workerRuntime, meeting:meetingStatePayload(), supervisor:supervisor?.getState()||null, settings: loadSettings() }));
ipcMain.handle('agent:choose-folder', () => chooseFolder());
ipcMain.handle('agent:open-folder', () => shell.openPath(reportFolder()));
ipcMain.handle('agent:open-notebook', () => {
  return shell.openPath(path.join(sessionFolder(), 'notebook.txt'));
});
