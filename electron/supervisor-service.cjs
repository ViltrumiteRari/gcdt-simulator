const fs = require('fs');
const SUPERVISOR_BASE = `http://127.0.0.1:${process.env.FIRSTSIGNAL_AGENT_PORT || 8766}`;
const path = require('path');
const crypto = require('crypto');
const { layout, ensurePipeline, temporalMeta, upsertIndex } = require('./pipeline-layout.cjs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; } };
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };
const lines = file => { try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(x => JSON.parse(x.replace(/^\uFEFF/, ''))); } catch { return []; } };
const safe = value => String(value || '').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 120);
const itemId = value => `ENG-${crypto.createHash('sha1').update(value).digest('hex').slice(0, 10).toUpperCase()}`;
const rootCauseKey = report => {
  const source=String(report.finding_key||report.title||'UNKNOWN').toUpperCase();
  const semantic=`${source} ${report.title||''}`.toUpperCase();
  if(semantic.includes('LEG_AGREEMENT')||semantic.includes('LEG AGREEMENT')||semantic.includes('CURRENT LEG AGREES'))return 'INTENT_CURRENT_LEG_AGREEMENT';
  if(semantic.includes('DUPLICATE_INTENT_GAPS')||semantic.includes('DUPLICATE ENTRIES')&&semantic.includes('GAPS'))return 'INTENT_GAP_DEDUPLICATION';
  if(semantic.includes('POST_EXIT')||semantic.includes('HOLD_INTENT_LATENCY')||semantic.includes('OPEN_POSITION_LOGIC')||semantic.includes('EXIT')&&semantic.includes('LATENCY')||semantic.includes('HOLD PERSISTS'))return 'POST_EXIT_STATE_RESET';
  if(semantic.includes('MAX_LOSS')||semantic.includes('VEHICLE_FAILURE_EXIT_RECURRENCE')||semantic.includes('VEHICLE FAILURE')&&semantic.includes('LOSS LIMIT'))return 'POSITION_LOSS_LIMIT_ENFORCEMENT';
  if(semantic.includes('REENTRY')&&(semantic.includes('DIAGNOSTIC')||semantic.includes('PROSE')||semantic.includes('EVIDENCE')||semantic.includes('MAPPING')))return 'REENTRY_EVIDENCE_MAPPING';
  if(semantic.includes('PERSISTENCE'))return 'INTENT_PRICE_PERSISTENCE';
  if(semantic.includes('PNL')&&(semantic.includes('SYNC')||semantic.includes('REPORT')||semantic.includes('MISMATCH')))return 'OPEN_POSITION_PNL_SYNC';
  return source.replace(/_SNAPSHOT\d+$/,'').replace(/(?:[._-]TICK)?[._-]?T?\d+$/,'').replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'');
};
const lifecycleRank={RAW_OBSERVATION:0,REVIEWED_PENDING_ADJUDICATION:1,PARTIALLY_VALIDATED:2,VALIDATED:3,REJECTED:3,SUPERSEDED:4,FIXED_PENDING_VALIDATION:4,FIX_VERIFIED:5};
const advanceLifecycle=(current,candidate)=>((lifecycleRank[candidate]??0)>(lifecycleRank[current]??0)?candidate:(current||candidate||'RAW_OBSERVATION'));

function createSupervisorService(hooks) {
  let timer = null;
  let busy = false;
  let stopped = false;
  const root = hooks.reportFolder();
  const dirs = ensurePipeline(root);
  const stateFile = path.join(dirs.state, 'supervisor-state.json');
  const backlogFile = path.join(dirs.findings, 'engineering-backlog.json');
  const findingsFile = path.join(dirs.findings, 'canonical-findings.json');
  let state = readJson(stateFile, { state: 'STARTING', processedMeetings: {}, approvals: {}, lastError: null, campaign: null, command: null });
  state.campaign ||= null; state.command ||= null;
  let backlog = readJson(backlogFile, { updatedAt: null, items: [] });
  let durable = readJson(findingsFile, { updatedAt: null, findings: {} });

  function persist() {
    state.updatedAt = new Date().toISOString();
    backlog.updatedAt = state.updatedAt;
    durable.updatedAt = state.updatedAt;
    state.summary = {
      backlogItems: backlog.items.length,
      blocked: backlog.items.filter(x => String(x.status||'').startsWith('BLOCKED')).length,
      awaitingApproval: backlog.items.filter(x => x.status === 'READY_FOR_APPROVAL').length,
      approved: backlog.items.filter(x => x.status === 'APPROVED').length,
      fixedPendingValidation: backlog.items.filter(x => x.lifecycleStatus === 'FIXED_PENDING_VALIDATION').length,
      fixVerified: backlog.items.filter(x => x.lifecycleStatus === 'FIX_VERIFIED').length,
    };
    writeJson(stateFile, state); writeJson(backlogFile, backlog); writeJson(findingsFile, durable);
    if(state.campaign) writeJson(path.join(dirs.campaigns, `${safe(state.campaign.id)}.json`), state.campaign);
    writeJson(path.join(dirs.indexes, 'CURRENT_STATUS.json'), { pipelineVersion:2, updatedAtUtc:state.updatedAt, supervisorState:state.state, currentSessionId:state.currentSessionId||null, currentMeeting:state.currentMeeting||null, campaign:state.campaign?{id:state.campaign.id,name:state.campaign.name,status:state.campaign.status,completedRuns:state.campaign.completedRuns,targetRuns:state.campaign.targetRuns}:null, counts:{canonicalFindings:Object.keys(durable.findings||{}).length,backlogItems:backlog.items.length,blocked:backlog.items.filter(x=>String(x.status).startsWith('BLOCKED')).length,awaitingApproval:backlog.items.filter(x=>x.status==='READY_FOR_APPROVAL').length,validated:Object.values(durable.findings||{}).filter(x=>['VALIDATED','FIX_VERIFIED'].includes(x.lifecycleStatus)).length} });
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
    const packet = readJson(path.join(meeting.dir, 'review-packet.json'), {cases:[]});
    const reports = lines(path.join(session.folder, 'reports.jsonl'));
    const finalByCase = new Map(memos.filter(x=>x.role==='OBSERVER_FINAL').map(x=>[x.caseId,x]));
    const reviewByFinding = new Map((packet.cases||[]).map(c=>[c.finding?.finding_key||`${c.finding?.category}|${String(c.finding?.title||'').toLowerCase()}`,finalByCase.get(c.caseId)||null]));
    const questions = memos.flatMap(x => x.questions || []).filter(Boolean).slice(-80);
    const claims = memos.flatMap(x => x.claims_needing_verification || []).filter(Boolean).slice(-80);
    const now = new Date().toISOString();
    for (const report of reports) {
      const sourceKey = report.finding_key || `${report.category}|${String(report.title || '').toLowerCase()}`;
      const key = rootCauseKey(report);
      const review = reviewByFinding.get(sourceKey) || null;
      const existingFinding = durable.findings[key] || { key, rootCauseKey:key, observations:[], reviews:[], lifecycleStatus:'RAW_OBSERVATION', firstSeen:now };
      const observation = { sourceFindingKey:sourceKey, reportId:report.id||null, level:report.level, title:report.title, summary:report.summary, buildId:report.buildId, buildSequence:report.buildSequence, sessionId:report.sessionId, tick:report.tick, marketDate:report.marketDate||report.replayDate||session.replayDate||null, marketTime:report.marketTime||report.t||null, observedAtUtc:report.observedAtUtc||now };
      existingFinding.observations=[...(existingFinding.observations||[]).filter(x=>x.reportId!==observation.reportId||!observation.reportId),observation].slice(-80);
      if(review) existingFinding.reviews=[...(existingFinding.reviews||[]),{meeting:meeting.summary.meetingName,sessionId:session.sessionId,conclusion:review.memo,questions:review.questions||[],claimsToVerify:review.claims_needing_verification||[],observedAtUtc:review.at||now}].slice(-30);
      const reviewLifecycle=review?(review.verdict&&review.verdict!=='UNRESOLVED'?review.verdict:'REVIEWED_PENDING_ADJUDICATION'):'RAW_OBSERVATION';
      durable.findings[key] = { ...existingFinding, title: report.title, category: report.category, level: report.level, latestSummary: report.summary, latestBuildId: report.buildId, latestBuildSequence: report.buildSequence, versionAssessment: report.version_assessment, lifecycleStatus:advanceLifecycle(existingFinding.lifecycleStatus,reviewLifecycle), lastSessionId: report.sessionId, lastSeen: now, occurrenceCount:existingFinding.observations.length };
      if (report.level === 'GREEN' && report.version_assessment !== 'FIX_VERIFIED') continue;
      const approval = approvalFor(report);
      const id = itemId(`${key}|${report.buildId || ''}`);
      const existing = backlog.items.find(x => x.id === id);
      const evidenceQuestions = questions.filter(q => String(q).toLowerCase().includes(String(report.category || '').toLowerCase())).slice(0, 4);
      const evidenceClaims = claims.filter(q => String(q).toLowerCase().includes(String(report.category || '').toLowerCase())).slice(0, 4);
      const next = {
        id, findingKey: key, rootCauseKey:key, sourceFindingKeys:[...new Set([...(existing?.sourceFindingKeys||[]),sourceKey])], occurrenceCount:durable.findings[key].occurrenceCount, title: report.title, category: report.category, severity: report.level,
        buildId: report.buildId, sourceSessionId: report.sessionId, sourceMeeting: meeting.summary.meetingName,
        diagnosis: report.summary, proposedAction: report.suggested_action || 'Inspect the cited evidence and define an isolated experiment.',
        experiment: `Reproduce on the same replay/build boundary, change one variable only, then compare the finding key and outcome against ${report.buildId || 'the current build'}.`,
        notebookQuestions: evidenceQuestions, claimsToVerify: evidenceClaims,
        approvalLevel: approval.level, status: state.approvals[id] || existing?.status || approval.status,
        lifecycleStatus:durable.findings[key].lifecycleStatus, reviewConclusion:review?.memo||existing?.reviewConclusion||null, createdAt: existing?.createdAt || now, updatedAt: now,
      };
      backlog.items = [...backlog.items.filter(x => x.id !== id), next];
    }
    backlog.items.sort((a, b) => (({ RED: 0, YELLOW: 1, GREEN: 2 }[a.severity] ?? 3) - ({ RED: 0, YELLOW: 1, GREEN: 2 }[b.severity] ?? 3)) || b.updatedAt.localeCompare(a.updatedAt));
    const meetingItems = backlog.items.filter(x => x.sourceMeeting === meeting.summary.meetingName).map(x => x.id);
    state.processedMeetings[meeting.dir] = { at: now, sessionId: session.sessionId, items: meetingItems };
    upsertIndex(path.join(dirs.indexes,'REVIEWS.json'),'reviews','meetingName',{meetingName:meeting.summary.meetingName,status:meeting.summary.status||'COMPLETED',replayDate:session.replayDate||null,sessionId:session.sessionId,completedCases:(meeting.summary.completedCases||[]).length,totalCases:Number(meeting.summary.totalCases)||0,endedAt:meeting.summary.endedAt||now,path:path.relative(root,meeting.dir).replaceAll('\\','/')});
    upsertIndex(path.join(dirs.reviews,'review-index.json'),'reviews','meetingName',{meetingName:meeting.summary.meetingName,status:meeting.summary.status||'COMPLETED',replayDate:session.replayDate||null,sessionId:session.sessionId,completedCases:(meeting.summary.completedCases||[]).length,totalCases:Number(meeting.summary.totalCases)||0,endedAt:meeting.summary.endedAt||now,path:path.relative(root,meeting.dir).replaceAll('\\','/')});
    if (state.campaign?.status === 'RUNNING' && !state.campaign.processedSessionIds?.includes(session.sessionId)) {
      state.campaign.processedSessionIds ||= []; state.campaign.runs ||= [];
      state.campaign.processedSessionIds.push(session.sessionId);
      state.campaign.runs.push({ index: state.campaign.runs.length + 1, sessionId: session.sessionId, replayDate: session.replayDate || state.campaign.currentReplayDate || null, meeting: meeting.summary.meetingName, itemIds: meetingItems, completedAt: now });
      state.campaign.completedRuns = state.campaign.runs.length;
      if (state.campaign.completedRuns >= state.campaign.targetRuns) { state.campaign.status = 'AWAITING_APPROVAL'; state.campaign.completedAt = now; state.campaign.proposals = buildCampaignProposals(state.campaign); state.state = 'CAMPAIGN_AWAITING_APPROVAL'; }
      else { state.state = 'READY_FOR_NEXT_RUN'; state.command = null; }
    } else state.state = 'READY_FOR_NEXT_RUN';
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

  function buildCampaignProposals(campaign) {
    const runIds = new Set((campaign.runs || []).flatMap(r => r.itemIds || [])); const relevant = backlog.items.filter(x => runIds.has(x.id)); const groups = new Map();
    for (const item of relevant) { const key = item.findingKey || item.title; const g = groups.get(key) || { findingKey:key, title:item.title, category:item.category, severity:item.severity, why:item.diagnosis, proposedAction:item.proposedAction, risk:item.approvalLevel === 'RED' ? 'HIGH' : item.approvalLevel === 'YELLOW' ? 'MEDIUM' : 'LOW', observedRunIds:[], itemIds:[] }; for (const run of campaign.runs || []) if ((run.itemIds || []).includes(item.id)) g.observedRunIds.push(run.index); g.itemIds.push(item.id); groups.set(key,g); }
    return [...groups.values()].map(g => ({...g, observedRunIds:[...new Set(g.observedRunIds)].sort((a,b)=>a-b), observedIn:`${new Set(g.observedRunIds).size} of ${campaign.targetRuns} simulations`, approvalStatus:'PENDING'})).sort((a,b)=>(({RED:0,YELLOW:1,GREEN:2}[a.severity]??3)-({RED:0,YELLOW:1,GREEN:2}[b.severity]??3)));
  }
  function campaignReplayDate(campaign) { const dates = campaign.replayDates?.length ? campaign.replayDates : []; return dates.length ? dates[campaign.completedRuns % dates.length] : null; }
  function startCampaign(input={}) { const targetRuns = Math.max(1, Math.min(100, Number(input.runs || input.targetRuns || 1))); const replayDates = Array.isArray(input.replayDates) ? input.replayDates.filter(Boolean) : (input.replayDate ? [input.replayDate] : []); state.campaign = { id:`CAMPAIGN-${Date.now()}`, name:input.name || `${targetRuns}-simulation campaign`, targetRuns, completedRuns:0, replayDates, tailMinutes:Math.max(0,Math.min(60,Number(input.tailMinutes)||0)), status:'RUNNING', createdAt:new Date().toISOString(), runs:[], processedSessionIds:[], proposals:[] }; state.command = null; state.state='CAMPAIGN_QUEUED'; persist(); return state.campaign; }
  function nextCommand() { if (!state.campaign || state.campaign.status !== 'RUNNING') return null; if (state.command && !state.command.ackedAt) return state.command; if (!['WAITING_FOR_RUN','READY_FOR_NEXT_RUN','CAMPAIGN_QUEUED'].includes(state.state)) return null; const replayDate = campaignReplayDate(state.campaign); state.campaign.currentReplayDate = replayDate; state.command = { id:`CMD-${Date.now()}`, type:'START_REPLAY', replayDate, tailMinutes:state.campaign.tailMinutes||0, campaignId:state.campaign.id, runNumber:state.campaign.completedRuns+1, issuedAt:new Date().toISOString(), ackedAt:null }; state.state='CAMPAIGN_STARTING_RUN'; persist(); return state.command; }
  function ackCommand(id, payload={}) { if (!state.command || state.command.id !== id) return null; if(state.command.ackedAt){return state.command.sessionId&&payload.sessionId===state.command.sessionId?state.command:null;} state.command.ackedAt=new Date().toISOString(); state.command.sessionId=payload.sessionId||null; state.command.claimedBy=payload.claimedBy||null; state.state='WATCHING_REPLAY'; persist(); return state.command; }
  function decideProposal(index, decision) { const p=state.campaign?.proposals?.[Number(index)]; if(!p)return null; p.approvalStatus=decision==='approve'?'APPROVED':'REJECTED'; p.decidedAt=new Date().toISOString(); for(const id of p.itemIds||[]) decide(id,decision); persist(); return p; }

  async function tick() {
    if (busy || stopped) return;
    busy = true;
    try {
      const snapshot = hooks.snapshot();
      state.observerState = snapshot.status?.state || 'UNKNOWN';
      state.currentSessionId = snapshot.sessionId || state.currentSessionId || null;
      const campaignStarting=state.campaign?.status==='RUNNING'&&(['CAMPAIGN_QUEUED','CAMPAIGN_STARTING_RUN','READY_FOR_NEXT_RUN'].includes(state.state)||(state.command&&!state.command.ackedAt));
      if(campaignStarting){nextCommand();state.observerState=`STALE_PRIOR_${snapshot.status?.state||'UNKNOWN'}`;persist();return;}
      if(String(snapshot.status?.state||'').startsWith('FAILED')){
        state.state=snapshot.status.state;state.lastError=snapshot.status.failureCode||snapshot.status.state;
        if(state.campaign?.status==='RUNNING'){state.campaign.status='FAILED';state.campaign.failedAt=new Date().toISOString();state.campaign.failure={state:snapshot.status.state,code:state.lastError,workerRuntime:snapshot.workerRuntime||null};}
        persist();return;
      }
      if (['COMPLETED','AWAITING_REVIEW_MEETING'].includes(snapshot.status?.state) && snapshot.sessionId && !(snapshot.reports || []).length && process.env.FIRSTSIGNAL_OBSERVER_MODE === 'posthoc') { const meta=readJson(path.join(hooks.sessionFolder(),'session.json'),{}); if(!meta.reflectionComplete){state.state='BLOCKED_AWAITING_TRADER_REFLECTION';state.lastError='SAME_TRADER_CLOSING_REFLECTION_REQUIRED';persist();return;} if(state.campaign?.status==='RUNNING'&&!state.campaign.processedSessionIds.includes(snapshot.sessionId)){state.campaign.completedRuns++;state.campaign.processedSessionIds.push(snapshot.sessionId);state.campaign.runs.push({sessionId:snapshot.sessionId,replayDate:snapshot.sessionMeta?.replayDate||null,status:'PENDING_REVIEW',completedAt:new Date().toISOString()});state.campaign.status=state.campaign.completedRuns>=state.campaign.targetRuns?'COMPLETED':'RUNNING';state.state=state.campaign.status==='COMPLETED'?'CAMPAIGN_COMPLETE':'READY_FOR_NEXT_RUN';persist();} return;}
    if (!['COMPLETED','AWAITING_REVIEW_MEETING'].includes(snapshot.status?.state) || !snapshot.sessionId || !(snapshot.reports || []).length) {
        if (state.campaign?.status === 'RUNNING' && !snapshot.sessionId) { state.state = state.command?.ackedAt ? 'WATCHING_REPLAY' : 'READY_FOR_NEXT_RUN'; nextCommand(); }
        else state.state = snapshot.sessionId ? 'WATCHING_REPLAY' : 'WAITING_FOR_RUN';
        persist(); return;
      }
      const folder = hooks.sessionFolder();
      const session = { folder, sessionId: snapshot.sessionId, replayDate: snapshot.sessionMeta?.replayDate || null };
      const completed = latestCompletedMeeting(folder);
      if (!completed) {
        state.state = 'PENDING_REVIEW';
        state.currentSessionId = snapshot.sessionId;
        state.currentMeeting = null;
        persist();
        return;
      }
      if (!state.processedMeetings[completed.dir]) { state.state = 'ANALYZING_COMPLETED_NOTEBOOK'; persist(); analyzeMeeting(session, completed); }
      else { if(state.campaign?.status==='RUNNING') { state.state='READY_FOR_NEXT_RUN'; nextCommand(); } else if(state.campaign?.status==='AWAITING_APPROVAL') state.state='CAMPAIGN_AWAITING_APPROVAL'; else state.state = 'READY_FOR_NEXT_RUN'; persist(); }
    } catch (error) {
      state.state = 'DEGRADED'; state.lastError = String(error?.stack || error); persist();
      hooks.activity?.('SUPERVISOR_ERROR', String(error?.message || error));
    } finally { busy = false; }
  }

  function decide(id, decision) {
    const item = backlog.items.find(x => x.id === id); if (!item) return null;
    const status = decision === 'approve' ? 'APPROVED' : 'REJECTED';
    const tm=temporalMeta(); state.approvals[id] = status; item.status = status; item.decidedAt = tm.observedAtUtc; item.decisionTemporal=tm;
    const finding=durable.findings[item.rootCauseKey||item.findingKey]; if(finding){finding.lifecycleStatus=decision==='approve'?'VALIDATED':'REJECTED'; finding.decidedAt=tm.observedAtUtc; finding.decisionTemporal=tm;} persist(); return item;
  }
  function getState() { return { ...state, backlog: { ...backlog, items: backlog.items.slice(0, 100) } }; }
  function start() { if (timer) return; stopped = false; timer = setInterval(tick, 5000); tick(); }
  function stop() { stopped = true; if (timer) clearInterval(timer); timer = null; }
  return { start, stop, tick, decide, getState, startCampaign, nextCommand, ackCommand, decideProposal };
}
module.exports = { createSupervisorService };


