const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { createRunner } = require('./qa-orchestrator.cjs');

let win;
let tray;
let runQa;
let server;
let reports = [];
let events = [];
let activities = [];
let analyzing = false;
let lastAnalyzedTick = -99;
let currentStatus = { state: 'STARTING' };
let currentSessionId = null;
let quotaBlocked = false;
let cooldownUntil = 0;
const recentFingerprints = new Map();

const settingsPath = () => path.join(app.getPath('userData'), 'agent-settings.json');
const defaultFolder = () => path.join(app.getPath('documents'), 'FirstSignal Agent Reports');
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); }
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
  tray.setToolTip(`FirstSignal QA · ${currentStatus.state}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Status: ${currentStatus.state}`, enabled: false },
    { label: 'Open Agent Console', click: () => { win.show(); win.focus(); } },
    { label: 'Open Report Folder', click: () => shell.openPath(reportFolder()) },
    { label: 'Change Report Folder', click: chooseFolder },
    { type: 'separator' },
    { label: 'Quit Agent', click: () => app.quit() },
  ]));
  win?.webContents.send('agent:update', { status: currentStatus, reports, activities, eventCount: events.length, settings: loadSettings() });
}
function addActivity(kind, message) {
  activities = [...activities.slice(-149), { id: 'ACT-' + Date.now() + '-' + Math.random().toString(36).slice(2,6), at: new Date().toISOString(), kind, message }];
  refreshTray();
}

function resetSession(sessionId, meta = {}) {
  currentSessionId = sessionId || null;
  events = [];
  reports = [];
  activities = [];
  analyzing = false;
  lastAnalyzedTick = -99;
  quotaBlocked = false;
  cooldownUntil = 0;
  recentFingerprints.clear();
  currentStatus = currentSessionId ? { state: 'WATCHING', sessionId: currentSessionId, replayDate: meta.replayDate || null } : { state: 'IDLE' };
  if (currentSessionId) addActivity('SESSION', `Started ${currentSessionId}${meta.replayDate ? ` � ${meta.replayDate}` : ''}`);
  else refreshTray();
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
    position: event.position ? { side: event.position.side, strike: event.position.strike, entry: event.position.entry, current: event.position.current, entryTick: event.position.entryTick } : null,
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
    priorReports: includePriorReports ? reports.slice(-5).map(r => ({ tick:r.tick, level:r.level, category:r.category, title:r.title, summary:r.summary })) : [],
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
  const folder = reportFolder();
  const day = new Date().toISOString().slice(0, 10);
  const jsonl = path.join(folder, `${day}-qa-reports.jsonl`);
  const notebook = path.join(folder, `${day}-qa-notebook.txt`);
  fs.appendFileSync(jsonl, `${JSON.stringify(report)}\n`);
  const evidence = (report.evidence || []).map(x => `  • ${x}`).join('\n');
  const block = `\n[${report.t || '—'}] ${report.level} · ${report.category}\n${report.title}\n${report.summary}\n${evidence ? `Evidence:\n${evidence}\n` : ''}Next: ${report.suggested_action || 'None'}\nApproval required: ${report.approval_required ? 'YES' : 'NO'}\n${'-'.repeat(72)}\n`;
  fs.appendFileSync(notebook, block);
  reports = [...reports.slice(-99), report];
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
    if (req.url === '/status' && req.method === 'GET') return json(res, 200, { status: currentStatus, sessionId: currentSessionId, reports, activities, eventCount: events.length, settings: loadSettings() });
    if (req.url === '/session/start' && req.method === 'POST') { const body = await readBody(req); resetSession(body.sessionId, body); return json(res, 200, { ok: true, sessionId: currentSessionId }); }
    if (req.url === '/session/end' && req.method === 'POST') { const body = await readBody(req); if (!body.sessionId || body.sessionId === currentSessionId) resetSession(null); return json(res, 200, { ok: true }); }
    if (req.url === '/open-folder' && req.method === 'POST') { await shell.openPath(reportFolder()); return json(res, 200, { ok: true }); }
    if (req.url === '/open-notebook' && req.method === 'POST') { const day = new Date().toISOString().slice(0, 10); await shell.openPath(path.join(reportFolder(), `${day}-qa-notebook.txt`)); return json(res, 200, { ok: true }); }
    if (req.url === '/choose-folder' && req.method === 'POST') return json(res, 200, await chooseFolder());
    if ((req.url === '/event' || req.url === '/observe') && req.method === 'POST') {
      try {
        const snapshot = await readBody(req);
        if (!snapshot.sessionId) return json(res, 409, { error: 'SESSION_ID_REQUIRED' });
        if (snapshot.sessionId !== currentSessionId) resetSession(snapshot.sessionId, { replayDate: snapshot.replayDate });
        const prior = events.at(-1);
        events = [...events.slice(-499), snapshot];
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
            const clean = normalizeReport({ ...report, t: snapshot.time, tick: snapshot.tick, id: `QA-${Date.now()}` });
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
  createWindow();
  startServer();
  tray = new Tray(trayIcon('WATCHING'));
  currentStatus = { state: 'WATCHING' };
  tray.on('double-click', () => { win.show(); win.focus(); });
  refreshTray();
  tray.displayBalloon?.({ iconType: 'info', title: 'FirstSignal QA Agent', content: 'WATCHING · Double-click the tray icon to open the agent console.' });
});
app.on('before-quit', () => { app.isQuitting = true; server?.close(); });
app.on('window-all-closed', event => event.preventDefault());

ipcMain.handle('agent:get-state', () => ({ status: currentStatus, sessionId: currentSessionId, reports, activities, eventCount: events.length, settings: loadSettings() }));
ipcMain.handle('agent:choose-folder', () => chooseFolder());
ipcMain.handle('agent:open-folder', () => shell.openPath(reportFolder()));
ipcMain.handle('agent:open-notebook', () => {
  const day = new Date().toISOString().slice(0, 10);
  return shell.openPath(path.join(reportFolder(), `${day}-qa-notebook.txt`));
});
