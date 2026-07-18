const fs = require('fs');
const p = process.argv[2];
const lines = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/).filter(Boolean);
const rows = lines.map(line => JSON.parse(line));
const seen = new Set();
const trades = [];
for (const row of rows) {
  for (const trade of row.recentTrades || []) {
    const key = [trade.t, trade.action, trade.result || ''].join('|');
    if (!seen.has(key)) {
      seen.add(key);
      trades.push(trade);
    }
  }
}
const last = rows.at(-1) || {};
console.log(JSON.stringify({
  rowCount: rows.length,
  firstTick: rows[0]?.tick,
  lastTick: last.tick,
  lastTime: last.time,
  lastBalance: last.balance,
  lastPosition: last.position,
  trades
}, null, 2));