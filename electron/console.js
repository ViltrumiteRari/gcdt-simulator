const $ = id => document.getElementById(id);

function colorFor(state) {
  if (state.includes('APPROVAL')) return '#ff4060';
  if (state === 'ANALYZING') return '#f0c040';
  if (state.startsWith('OFFLINE')) return '#4a5568';
  return '#00d4a8';
}

function render(data) {
  const state = data.status?.state || 'UNKNOWN';
  const color = colorFor(state);
  $('status').textContent = state;
  $('status').style.color = color;
  $('dot').style.background = color;
  $('dot').style.boxShadow = `0 0 9px ${color}`;
  $('folder').textContent = `Saves to: ${data.settings?.reportFolder || 'Not configured'}`;
  const meta = data.sessionMeta || {};
  $('buildInfo').textContent = meta.buildId ? `${meta.productName || 'FirstSignal Sim'} ${meta.productVersion || 'V1'} | build ${meta.buildSequence || '?'} | ${meta.buildId} | ${meta.replayDate || 'session'}` : 'No active build';
  $('eventCount').textContent = `${data.eventCount || 0} live events received`;
  const meeting=data.meeting||{state:'IDLE',transcript:[]};
  $('meetingStatus').textContent = meeting.state==='IDLE' ? (state==='COMPLETED'?'Ready to review completed run':'Complete a run first') : `${meeting.state}${meeting.name?` · ${meeting.name}`:''}`;
  $('startMeeting').disabled = meeting.state==='RUNNING'||meeting.state==='STOPPING'||state!=='COMPLETED';
  $('stopMeeting').disabled = meeting.state!=='RUNNING';
  $('openMeeting').disabled = !meeting.folder;
  $('meetingTranscript').innerHTML=(meeting.transcript||[]).length?(meeting.transcript||[]).map(t=>`<div class="meeting-turn"><span class="meeting-speaker">${escapeHtml(t.speaker||'SYSTEM')}</span> ${escapeHtml(t.message||'')}</div>`).join(''):'<div class="meta">The observer will present each flagged case to the trader after you press Start Meeting.</div>';
  $('meetingTranscript').scrollTop=$('meetingTranscript').scrollHeight;
  const activity = [...(data.activities || [])].reverse().slice(0,30);
  $('activity').innerHTML = activity.length ? activity.map(a => `<div class="activity-line"><span class="activity-kind">${escapeHtml(a.kind)}</span> | ${escapeHtml(a.message)}</div>`).join('') : '<div class="activity-line">Waiting for simulator events...</div>';
  const reports = [...(data.reports || [])].reverse();
  $('reports').innerHTML = reports.length ? reports.map(r => {
    const cls = String(r.level || 'GREEN').toLowerCase();
    return `<div class="card ${cls}"><div class="meta">${r.t || '—'} | ${r.level || 'GREEN'} | ${r.category || 'UNKNOWN'} | ${r.buildId || 'unknown build'} | ${r.version_assessment || 'NEW_FINDING'}</div><div class="title">${escapeHtml(r.title || 'Observation')}</div><div class="summary">${escapeHtml(r.summary || '')}</div><div class="next">NEXT: ${escapeHtml(r.suggested_action || 'None')}</div></div>`;
  }).join('') : '<div class="empty">Watching for the first simulator observation…</div>';
}
function escapeHtml(value) { return String(value).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

$('openFolder').onclick = () => window.agentConsole.openFolder();
$('openNotebook').onclick = () => window.agentConsole.openNotebook();
$('changeFolder').onclick = async () => { await window.agentConsole.chooseFolder(); render(await window.agentConsole.getState()); };
window.agentConsole.onUpdate(render);
window.agentConsole.getState().then(render);

$('startMeeting').onclick=async()=>{const name=$('meetingName').value.trim();const r=await fetch('http://127.0.0.1:8766/meeting/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name})});if(!r.ok){const j=await r.json().catch(()=>({}));alert(j.error||'Unable to start meeting');}};
$('stopMeeting').onclick=()=>fetch('http://127.0.0.1:8766/meeting/stop',{method:'POST'});
$('openMeeting').onclick=()=>fetch('http://127.0.0.1:8766/meeting/open',{method:'POST'});
