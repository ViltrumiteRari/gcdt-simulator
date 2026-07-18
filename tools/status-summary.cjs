const http = require('http');
http.get('http://127.0.0.1:8766/status', res => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    const s = JSON.parse(body);
    const e = (s.events || []).at(-1) || {};
    console.log(JSON.stringify({
      runtime: s.workerRuntime?.state,
      tick: s.workerRuntime?.tick,
      eventCount: s.workerRuntime?.eventCount,
      provider: s.workerRuntime?.provider,
      marketTime: e.time,
      balance: e.balance,
      position: e.position,
      campaign: s.supervisor?.campaign,
      status: s.status
    }, null, 2));
  });
}).on('error', err => { console.error(err); process.exit(1); });