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
  const color = state.includes('APPROVAL') ? '#ff4060' : state === 'ANALYZING' ? '#f0c040' : state.startsWith('OFFLINE') ? '#4a5568' : '#00d4a8';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect x="3" y="3" width="26" height="26" rx="7" fill="#0e1117" stroke="${color}" stroke-width="4"/><circle cx="16" cy="16" r="5" fill="${color}"/></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}
function refreshTray() {
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

function inspectContext(windowSize = 40, includePriorReports = true) {
  const recent = events.slice(-Math.max(1, Math.min(windowSize, 200)));
  const first = recent[0] || {}; const last = recent.at(-1) || {};
  return { recentEvents: recent, priorReports: includePriorReports ? reports.slice(-10) : [], delta: { ticks: (last.tick ?? 0) - (first.tick ?? 0), balance: (last.balance ?? 0) - (first.balance ?? 0), positionChanged: JSON.stringify(first.position || null) !== JSON.stringify(last.position || null), intentChanged: first.intent?.action !== last.intent?.action, dataHealthChanged: first.dataHealth?.state !== last.dataHealth?.state } };
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
    if (req.url === '/status' && req.method === 'GET') return json(res, 200, { status: currentStatus, reports, activities, eventCount: events.length, settings: loadSettings() });
    if (req.url === '/open-folder' && req.method === 'POST') { await shell.openPath(reportFolder()); return json(res, 200, { ok: true }); }
    if (req.url === '/open-notebook' && req.method === 'POST') { const day = new Date().toISOString().slice(0, 10); await shell.openPath(path.join(reportFolder(), `${day}-qa-notebook.txt`)); return json(res, 200, { ok: true }); }
    if (req.url === '/choose-folder' && req.method === 'POST') return json(res, 200, await chooseFolder());
    if ((req.url === '/event' || req.url === '/observe') && req.method === 'POST') {
      try {
        const snapshot = await readBody(req);
        const prior = events.at(-1);
        events = [...events.slice(-499), snapshot];
        const meaningful = !prior || snapshot.tick - lastAnalyzedTick >= 20 ||
          JSON.stringify(prior.position || null) !== JSON.stringify(snapshot.position || null) ||
          prior.intent?.action !== snapshot.intent?.action ||
          snapshot.dataHealth?.state === 'FAILED' || snapshot.transmission?.state === 'FAILED';
        if (meaningful && !analyzing) {
          analyzing = true; lastAnalyzedTick = snapshot.tick;
          currentStatus = { state: 'ANALYZING', tick: snapshot.tick, time: snapshot.time };
          addActivity('WAKE', `Meaningful simulator event at tick ${snapshot.tick}`);
          runQa(snapshot).then(report => {
            const clean = { ...report, t: snapshot.time, tick: snapshot.tick, id: `QA-${Date.now()}` };
            saveReport(clean);
            currentStatus = { state: clean.level === 'RED' ? 'APPROVAL REQUIRED' : 'WATCHING', level: clean.level, title: clean.title, tick: clean.tick, time: clean.t };
            addActivity(clean.level, `${clean.title}: ${clean.summary}`);
          }).catch(error => {
            currentStatus = { state: `OFFLINE: ${String(error?.message || error).slice(0, 60)}` };
            addActivity('ERROR', currentStatus.state);
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

ipcMain.handle('agent:get-state', () => ({ status: currentStatus, reports, activities, eventCount: events.length, settings: loadSettings() }));
ipcMain.handle('agent:choose-folder', () => chooseFolder());
ipcMain.handle('agent:open-folder', () => shell.openPath(reportFolder()));
ipcMain.handle('agent:open-notebook', () => {
  const day = new Date().toISOString().slice(0, 10);
  return shell.openPath(path.join(reportFolder(), `${day}-qa-notebook.txt`));
});
