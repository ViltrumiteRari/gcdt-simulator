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
  const reports = [...(data.reports || [])].reverse();
  $('reports').innerHTML = reports.length ? reports.map(r => {
    const cls = String(r.level || 'GREEN').toLowerCase();
    return `<div class="card ${cls}"><div class="meta">${r.t || '—'} · ${r.level || 'GREEN'} · ${r.category || 'UNKNOWN'}</div><div class="title">${escapeHtml(r.title || 'Observation')}</div><div class="summary">${escapeHtml(r.summary || '')}</div><div class="next">NEXT: ${escapeHtml(r.suggested_action || 'None')}</div></div>`;
  }).join('') : '<div class="empty">Watching for the first simulator observation…</div>';
}
function escapeHtml(value) { return String(value).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

$('openFolder').onclick = () => window.agentConsole.openFolder();
$('openNotebook').onclick = () => window.agentConsole.openNotebook();
$('changeFolder').onclick = async () => { await window.agentConsole.chooseFolder(); render(await window.agentConsole.getState()); };
window.agentConsole.onUpdate(render);
window.agentConsole.getState().then(render);
