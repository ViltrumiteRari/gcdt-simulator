const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; } };
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };
const lines = file => { try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(x => JSON.parse(x.replace(/^\uFEFF/, ''))); } catch { return []; } };
const safe = value => String(value || '').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 120);
const itemId = value => `ENG-${crypto.createHash('sha1').update(value).digest('hex').slice(0, 10).toUpperCase()}`;

function createSupervisorService(hooks) {
  let timer = null;
  let busy = false;
  let stopped = false;
  const root = hooks.reportFolder();
  const stateFile = path.join(root, 'supervisor-state.json');
  const backlogFile = path.join(root, 'engineering-backlog.json');
  const findingsFile = path.join(root, 'durable-findings.json');
  let state = readJson(stateFile, { state: 'STARTING', processedMeetings: {}, approvals: {}, lastError: null });
  let backlog = readJson(backlogFile, { updatedAt: null, items: [] });
  let durable = readJson(findingsFile, { updatedAt: null, findings: {} });

  function persist() {
    state.updatedAt = new Date().toISOString();
    backlog.updatedAt = state.updatedAt;
    durable.updatedAt = state.updatedAt;
    writeJson(stateFile, state); writeJson(backlogFile, backlog); writeJson(findingsFile, durable);
    hooks.emit?.(state);
  }

  function latestCompletedMeeting(folder) {
    const meetings = path.join(folder, 'meetings');
    if (!fs.existsSync(meetings)) return null;
    return fs.readdirSync(meetings, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => {
      const dir = path.join(meetings, x.name);
      const summary = readJson(path.join(dir, 'meeting-summary.json'), null);
      return summary?.status === 'COMPLETED' ? { dir, summary, mtime: fs.statSync(path.join(dir, 'meeting-summary.json')).mtimeMs } : null;
    }).filter(Boolean).sort((a, b) => b.mtime - a.mtime)[0] || null;
  }

  function approvalFor(report) {
    if (report.level === 'RED' || report.approval_required) return { level: 'RED', status: 'BLOCKED_PENDING_EXPLICIT_APPROVAL' };
    if (report.level === 'YELLOW') return { level: 'YELLOW', status: 'READY_FOR_APPROVAL' };
    return { level: 'GREEN', status: 'PREPARED_NO_CODE_CHANGE' };
  }

  function analyzeMeeting(session, meeting) {
    const memos = lines(path.join(meeting.dir, 'memos.jsonl'));
    const reports = lines(path.join(session.folder, 'reports.jsonl'));
    const questions = memos.flatMap(x => x.questions || []).filter(Boolean).slice(-80);
    const claims = memos.flatMap(x => x.claims_needing_verification || []).filter(Boolean).slice(-80);
    const now = new Date().toISOString();
    for (const report of reports) {
      const key = report.finding_key || `${report.category}|${String(report.title || '').toLowerCase()}`;
      durable.findings[key] = {
        ...(durable.findings[key] || {}), key, title: report.title, category: report.category,
        level: report.level, summary: report.summary, buildId: report.buildId,
        buildSequence: report.buildSequence, versionAssessment: report.version_assessment,
        lastSessionId: report.sessionId, lastSeen: now,
      };
      if (report.level === 'GREEN' && report.version_assessment !== 'FIX_VERIFIED') continue;
      const approval = approvalFor(report);
      const id = itemId(`${key}|${report.buildId || ''}`);
      const existing = backlog.items.find(x => x.id === id);
      const evidenceQuestions = questions.filter(q => String(q).toLowerCase().includes(String(report.category || '').toLowerCase())).slice(0, 4);
      const evidenceClaims = claims.filter(q => String(q).toLowerCase().includes(String(report.category || '').toLowerCase())).slice(0, 4);
      const next = {
        id, findingKey: key, title: report.title, category: report.category, severity: report.level,
        buildId: report.buildId, sourceSessionId: report.sessionId, sourceMeeting: meeting.summary.meetingName,
        diagnosis: report.summary, proposedAction: report.suggested_action || 'Inspect the cited evidence and define an isolated experiment.',
        experiment: `Reproduce on the same replay/build boundary, change one variable only, then compare the finding key and outcome against ${report.buildId || 'the current build'}.`,
        notebookQuestions: evidenceQuestions, claimsToVerify: evidenceClaims,
        approvalLevel: approval.level, status: state.approvals[id] || existing?.status || approval.status,
        createdAt: existing?.createdAt || now, updatedAt: now,
      };
      backlog.items = [...backlog.items.filter(x => x.id !== id), next];
    }
    backlog.items.sort((a, b) => (({ RED: 0, YELLOW: 1, GREEN: 2 }[a.severity] ?? 3) - ({ RED: 0, YELLOW: 1, GREEN: 2 }[b.severity] ?? 3)) || b.updatedAt.localeCompare(a.updatedAt));
    state.processedMeetings[meeting.dir] = { at: now, sessionId: session.sessionId, items: backlog.items.filter(x => x.sourceMeeting === meeting.summary.meetingName).map(x => x.id) };
    state.state = 'READY_FOR_NEXT_RUN';
    state.currentSessionId = session.sessionId;
    state.currentMeeting = meeting.summary.meetingName;
    state.summary = {
      backlogItems: backlog.items.length,
      blocked: backlog.items.filter(x => x.status.startsWith('BLOCKED')).length,
      awaitingApproval: backlog.items.filter(x => x.status === 'READY_FOR_APPROVAL').length,
      approved: backlog.items.filter(x => x.status === 'APPROVED').length,
    };
    hooks.activity?.('SUPERVISOR', `Notebook analyzed. ${state.summary.blocked} blocked, ${state.summary.awaitingApproval} awaiting approval. Next run is prepared.`);
    persist();
  }

  async function tick() {
    if (busy || stopped) return;
    busy = true;
    try {
      const snapshot = hooks.snapshot();
      state.observerState = snapshot.status?.state || 'UNKNOWN';
      state.currentSessionId = snapshot.sessionId || state.currentSessionId || null;
      if (snapshot.status?.state !== 'COMPLETED' || !snapshot.sessionId || !(snapshot.reports || []).length) {
        state.state = snapshot.sessionId ? 'WATCHING_REPLAY' : 'WAITING_FOR_RUN'; persist(); return;
      }
      const folder = hooks.sessionFolder();
      const session = { folder, sessionId: snapshot.sessionId };
      const completed = latestCompletedMeeting(folder);
      if (!completed) {
        if (!['RUNNING', 'PAUSED_RATE_LIMIT', 'STOPPING'].includes(snapshot.meeting?.state)) {
          state.state = 'STARTING_REVIEW_MEETING'; persist();
          hooks.activity?.('SUPERVISOR', 'Replay complete. Starting Observer ↔ Trader notebook meeting automatically.');
          await fetch('http://127.0.0.1:8766/meeting/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
        } else { state.state = snapshot.meeting.state === 'PAUSED_RATE_LIMIT' ? 'MEETING_RATE_LIMIT_PAUSE' : 'REVIEW_MEETING_RUNNING'; persist(); }
        return;
      }
      if (!state.processedMeetings[completed.dir]) { state.state = 'ANALYZING_COMPLETED_NOTEBOOK'; persist(); analyzeMeeting(session, completed); }
      else { state.state = 'READY_FOR_NEXT_RUN'; persist(); }
    } catch (error) {
      state.state = 'DEGRADED'; state.lastError = String(error?.stack || error); persist();
      hooks.activity?.('SUPERVISOR_ERROR', String(error?.message || error));
    } finally { busy = false; }
  }

  function decide(id, decision) {
    const item = backlog.items.find(x => x.id === id); if (!item) return null;
    const status = decision === 'approve' ? 'APPROVED' : 'REJECTED';
    state.approvals[id] = status; item.status = status; item.decidedAt = new Date().toISOString(); persist(); return item;
  }
  function getState() { return { ...state, backlog: { ...backlog, items: backlog.items.slice(0, 100) } }; }
  function start() { if (timer) return; stopped = false; timer = setInterval(tick, 5000); tick(); }
  function stop() { stopped = true; if (timer) clearInterval(timer); timer = null; }
  return { start, stop, tick, decide, getState };
}
module.exports = { createSupervisorService };

