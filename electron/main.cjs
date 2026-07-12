const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { createRunner } = require('./qa-orchestrator.cjs');
const { createMeetingRunner, localMeetingName } = require('./meeting-orchestrator.cjs');
const { createSupervisorService } = require('./supervisor-service.cjs');

let win;
let tray;
let runQa;
let meetingRunner;
let supervisor;
let meetingNotebookWin;
let server;
let reports = [];
let events = [];
let activities = [];
let analyzing = false;
let lastAnalyzedTick = -99;
let currentStatus = { state: 'STARTING' };
let currentSessionId = null;
let currentSessionMeta = {};
let quotaBlocked = false;
let cooldownUntil = 0;
let currentMeeting = { state:'IDLE', name:null, transcript:[], folder:null, summary:null };
const recentFingerprints = new Map();

const settingsPath = () => path.join(app.getPath('userData'), 'agent-settings.json');
const defaultFolder = () => path.join(app.getPath('documents'), 'FirstSignal Sim V1 Agent Reports');
function loadSettings() {
  try { const settings=JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); if(settings.reportFolder===path.join(app.getPath('documents'),'FirstSignal Agent Reports')){settings.reportFolder=defaultFolder();saveSettings(settings);} return settings; }
  catch { return { reportFolder: defaultFolder() }; }
}
function saveSettings(settings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}
function reportFolder() {
  const folder = loadSettings().reportFolder;
  fs.mkdirSync(folder, { recursive: true });
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
  tray.setToolTip(`FirstSignal Sim V1 QA | ${currentStatus.state}`);
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
  activities = [...activities.slice(-149), { id: 'ACT-' + Date.now() + '-' + Math.random().toString(36).slice(2,6), at: new Date().toISOString(), kind, message }];
  refreshTray();
}

function resetSession(sessionId, meta = {}) {
  if (currentMeeting.state === 'RUNNING') meetingRunner?.stop();
  currentMeeting = { state:'IDLE', name:null, transcript:[], folder:null, summary:null };
  currentSessionId = sessionId || null;
  currentSessionMeta = currentSessionId ? { ...meta, sessionId: currentSessionId, startedAt: new Date().toISOString() } : {};
  events = [];
  reports = [];
  activities = [];
  analyzing = false;
  lastAnalyzedTick = -99;
  quotaBlocked = false;
  cooldownUntil = 0;
  recentFingerprints.clear();
  currentStatus = currentSessionId ? { state: 'WATCHING', sessionId: currentSessionId, replayDate: meta.replayDate || null, buildId: meta.buildId || null, buildSequence: Number(meta.buildSequence)||0, productVersion: meta.productVersion || null } : { state: 'IDLE' };
  if (currentSessionId) addActivity('SESSION', `Started ${meta.productName||'FirstSignal Sim'} ${meta.productVersion||'V1'} | ${meta.buildId||'unknown build'} | ${meta.replayDate||'session'}`);
  else refreshTray();
}

function completeSession(meta = {}) {
  analyzing = false;
  quotaBlocked = false;
  cooldownUntil = 0;
  const completedSessionId = currentSessionId;
  currentStatus = {
    state: 'COMPLETED',
    sessionId: completedSessionId,
    replayDate: meta.replayDate || currentStatus.replayDate || null,
    eventCount: events.length,
    reportCount: reports.length,
    buildId: currentSessionMeta.buildId || null,
    buildSequence: Number(currentSessionMeta.buildSequence)||0,
    productVersion: currentSessionMeta.productVersion || null,
  };
  try { fs.writeFileSync(path.join(sessionFolder(), 'session.json'), JSON.stringify({ ...currentSessionMeta, sessionId:currentSessionId, status:currentStatus, eventCount:events.length, reportCount:reports.length }, null, 2)); } catch {}
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
  if (turn.folder) { currentMeeting.folder = turn.folder; openMeetingNotebookWindow(); }
  if (turn.summary) currentMeeting.summary = turn.summary;
  addActivity('MEETING', `${turn.speaker}: ${turn.message}`);
}
function meetingStatePayload() { return currentMeeting; }

function safeName(value) { return String(value || 'session').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'session'; }
function sessionFolder() {
  const day = String(currentSessionMeta.startedAt || new Date().toISOString()).slice(0, 10);
  const folder = path.join(reportFolder(), day, safeName(currentSessionId));
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
      if(!meta.sessionId)continue;
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
function versionMemoryPath() { return path.join(reportFolder(), 'version-memory.json'); }
function loadVersionMemory() { try { return JSON.parse(fs.readFileSync(versionMemoryPath(), 'utf8')); } catch { return { productName:'FirstSignal Sim', productVersion:'V1', builds:{} }; } }
function saveVersionMemory(memory) { fs.writeFileSync(versionMemoryPath(), JSON.stringify(memory, null, 2)); }
function versionContext() {
  const memory=loadVersionMemory(), current=currentSessionMeta.buildId || events.at(-1)?.buildId || 'UNKNOWN', currentSequence=Number(currentSessionMeta.buildSequence||events.at(-1)?.buildSequence||0);
  const builds=Object.values(memory.builds||{}).sort((a,b)=>(Number(a.buildSequence)||0)-(Number(b.buildSequence)||0)||String(a.lastSeen||'').localeCompare(String(b.lastSeen||'')));
  const prior=builds.filter(x=>x.buildId!==current).slice(-3), latest=builds.at(-1)||null, latestSequence=Number(latest?.buildSequence)||0;
  const relation=!latest?'FIRST_KNOWN':current===latest.buildId?'SAME':currentSequence>latestSequence?'NEWER':currentSequence<latestSequence?'OLDER':'DIFFERENT_UNORDERED';
  return { productName:currentSessionMeta.productName||'FirstSignal Sim', productVersion:currentSessionMeta.productVersion||'V1', currentBuildId:current, currentBuildSequence:currentSequence, relationToLatestKnown:relation, latestKnownBuild:latest?{buildId:latest.buildId,buildSequence:latestSequence,lastSeen:latest.lastSeen}:null, currentBuildKnown:!!memory.builds?.[current], priorBuilds:prior.map(x=>({buildId:x.buildId,buildSequence:Number(x.buildSequence)||0,lastSeen:x.lastSeen,findings:(x.findings||[]).slice(-12)})), sameBuildFindings:(memory.builds?.[current]?.findings||[]).slice(-20) };
}
function updateVersionMemory(report) {
  const memory=loadVersionMemory(), buildId=report.buildId||currentSessionMeta.buildId||'UNKNOWN';
  const build=memory.builds[buildId]||{buildId,productVersion:report.productVersion||currentSessionMeta.productVersion||'V1',buildSequence:Number(report.buildSequence||currentSessionMeta.buildSequence||0),firstSeen:new Date().toISOString(),findings:[]};
  build.lastSeen=new Date().toISOString();
  const key=report.finding_key||`${report.category}|${String(report.title||'').toLowerCase()}`;
  build.findings=[...(build.findings||[]).filter(x=>x.key!==key),{key,level:report.level,title:report.title,summary:report.summary,versionAssessment:report.version_assessment||'NEW_FINDING',sessionId:report.sessionId,tick:report.tick,at:new Date().toISOString()}].slice(-100);
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
  const enriched = { ...report, productName: currentSessionMeta.productName || 'FirstSignal Sim', productVersion: currentSessionMeta.productVersion || 'V1', buildId: report.buildId || currentSessionMeta.buildId || 'UNKNOWN', buildSequence:Number(report.buildSequence||currentSessionMeta.buildSequence||0), sessionId: currentSessionId, replayDate: currentSessionMeta.replayDate || null };
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

function startServer() {
  server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return json(res, 204, {});
    if (req.url === '/status' && req.method === 'GET') return json(res, 200, { status: currentStatus, sessionId: currentSessionId, sessionMeta:currentSessionMeta, reports, activities, eventCount: events.length, meeting:meetingStatePayload(), supervisor:supervisor?.getState()||null, settings: loadSettings() });
    if (req.url === '/supervisor/status' && req.method === 'GET') return json(res, 200, supervisor?.getState()||{state:'STARTING'});
    if (req.url === '/supervisor/decision' && req.method === 'POST') { const body=await readBody(req); const item=supervisor?.decide(body.itemId, body.decision); return item?json(res,200,{ok:true,item}):json(res,404,{error:'BACKLOG_ITEM_NOT_FOUND'}); }
    if (req.url === '/session/start' && req.method === 'POST') { const body = await readBody(req); resetSession(body.sessionId, body); return json(res, 200, { ok: true, sessionId: currentSessionId }); }
    if (req.url === '/session/end' && req.method === 'POST') { const body = await readBody(req); if (!currentSessionId) resetSession(null); else if (!body.sessionId || body.sessionId === currentSessionId) completeSession(body); return json(res, 200, { ok: true, status: currentStatus }); }
    if (req.url === '/open-folder' && req.method === 'POST') { await shell.openPath(reportFolder()); return json(res, 200, { ok: true }); }
    if (req.url === '/open-notebook' && req.method === 'POST') { await shell.openPath(path.join(sessionFolder(), 'notebook.txt')); return json(res, 200, { ok: true }); }
    if (req.url === '/choose-folder' && req.method === 'POST') return json(res, 200, await chooseFolder());
    if (req.url === '/meeting/notepad' && req.method === 'GET') {
      const file = currentMeeting.folder ? path.join(currentMeeting.folder, 'shared-notepad.txt') : null;
      let text = '';
      try { if (file && fs.existsSync(file)) text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); } catch {}
      return json(res, 200, { name:currentMeeting.name, state:currentMeeting.state, folder:currentMeeting.folder, text });
    }    if (req.url === '/meeting/start' && req.method === 'POST') {
      const body = await readBody(req);
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
        events = [...events.slice(-499), snapshot];
        try { fs.appendFileSync(path.join(sessionFolder(), 'events.jsonl'), JSON.stringify(compactEvent(snapshot)) + '\n'); } catch {}
        const critical = snapshot.dataHealth?.state === 'FAILED' || snapshot.transmission?.state === 'FAILED';
        const positionChanged = positionIdentity(prior?.position) !== positionIdentity(snapshot.position);
        const periodic = !prior || snapshot.tick - lastAnalyzedTick >= 20;
        const meaningful = critical || positionChanged || periodic;
        if (cooldownUntil && Date.now() >= cooldownUntil) { cooldownUntil = 0; quotaBlocked = false; currentStatus = { state: currentSessionId ? 'WATCHING' : 'IDLE' }; addActivity('RECOVERY', 'Gemini cooldown ended; model investigations resumed.'); }
        if (meaningful && !analyzing && !quotaBlocked) {
          analyzing = true; lastAnalyzedTick = snapshot.tick;
          currentStatus = { state: 'ANALYZING', tick: snapshot.tick, time: snapshot.time };
          addActivity('WAKE', `Meaningful simulator event at tick ${snapshot.tick}`);
          runQa(snapshot).then(report => {
            const clean = normalizeReport({ ...report, t: snapshot.time, tick: snapshot.tick, buildId:snapshot.buildId, buildSequence:snapshot.buildSequence, productVersion:snapshot.productVersion, id: `QA-${Date.now()}` });
            if (!isDuplicateReport(clean, snapshot.tick)) saveReport(clean);
            else addActivity('DEDUPE', `Suppressed repeated ${clean.level} finding: ${clean.title}`);
            currentStatus = { state: clean.level === 'RED' ? 'APPROVAL REQUIRED' : 'WATCHING', level: clean.level, title: clean.title, tick: clean.tick, time: clean.t };
            addActivity(clean.level, `${clean.title}: ${clean.summary}`);
          }).catch(error => {
            const message = String(error?.message || error);
            const rateLimited = /quota|resource_exhausted|429/i.test(message);
            if (rateLimited) { quotaBlocked = true; cooldownUntil = Date.now() + 60_000; }
            currentStatus = { state: rateLimited ? 'COOLDOWN: GEMINI RATE LIMIT' : `OFFLINE: ${message.slice(0, 80)}` };
            addActivity('ERROR', `${currentStatus.state} | ${message}`);
          }).finally(() => { analyzing = false; refreshTray(); });
        }
        return json(res, 202, { accepted: true, meaningful, analyzing, status: currentStatus });
      } catch (error) { return json(res, 400, { error: String(error?.message || error) }); }
    }
    return json(res, 404, { error: 'Not found' });
  });
  server.listen(8766, '127.0.0.1');
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

app.whenReady().then(async () => {
  runQa = await createRunner({ activity: addActivity, inspect: inspectContext });
  meetingRunner = createMeetingRunner({ emit: emitMeeting });
  restoreLatestCompletedSession();
  createWindow();
  startServer();
  supervisor = createSupervisorService({ reportFolder, sessionFolder, snapshot:()=>({status:currentStatus,sessionId:currentSessionId,sessionMeta:currentSessionMeta,reports,meeting:currentMeeting}), activity:addActivity, emit:()=>refreshTray() });
  supervisor.start();
  tray = new Tray(trayIcon('WATCHING'));
  if (!currentSessionId) currentStatus = { state: 'WATCHING' };
  tray.on('double-click', () => { win.show(); win.focus(); });
  refreshTray();
  tray.displayBalloon?.({ iconType: 'info', title: 'FirstSignal Sim V1 QA Agent', content: 'WATCHING | FirstSignal Sim V1 observer is ready.' });
});
app.on('before-quit', () => { app.isQuitting = true; supervisor?.stop(); meetingRunner?.stop(); meetingNotebookWin?.destroy(); server?.close(); });
app.on('window-all-closed', event => event.preventDefault());

ipcMain.handle('agent:get-state', () => ({ status: currentStatus, sessionId: currentSessionId, sessionMeta:currentSessionMeta, reports, activities, eventCount: events.length, meeting:meetingStatePayload(), supervisor:supervisor?.getState()||null, settings: loadSettings() }));
ipcMain.handle('agent:choose-folder', () => chooseFolder());
ipcMain.handle('agent:open-folder', () => shell.openPath(reportFolder()));
ipcMain.handle('agent:open-notebook', () => {
  return shell.openPath(path.join(sessionFolder(), 'notebook.txt'));
});
