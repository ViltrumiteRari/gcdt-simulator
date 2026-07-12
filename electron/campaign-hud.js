const $ = id => document.getElementById(id);
async function update() {
  try {
    const data = await fetch('http://127.0.0.1:8766/status').then(r => r.json());
    const campaign = data.supervisor?.campaign;
    const tickProgress = Math.max(0, Math.min(1, (data.eventCount || 0) / 406));
    const pct = campaign?.targetRuns ? Math.round(((campaign.completedRuns || 0) + tickProgress) / campaign.targetRuns * 100) : 0;
    $('fill').style.width = `${Math.min(100, pct)}%`;
    $('pct').textContent = `${Math.min(100, pct)}%`;
    $('state').textContent = data.supervisor?.state || data.status?.state || 'IDLE';
    $('detail').textContent = campaign ? `Run ${(campaign.completedRuns || 0) + 1}/${campaign.targetRuns} | ${data.sessionMeta?.replayDate || campaign.currentReplayDate || 'loading'} | ${data.eventCount || 0}/406 ticks` : 'No campaign running';
  } catch {
    $('state').textContent = 'OFFLINE';
    $('detail').textContent = 'Agent connection unavailable';
  }
}
update();
setInterval(update, 1000);