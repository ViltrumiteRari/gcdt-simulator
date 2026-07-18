const fs = require('fs');
const p = process.argv[2];
const rows = fs.readFileSync(p,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const journal = [];
const seen = new Set();
for (const row of rows) {
  for (const item of row.recentJournal || []) {
    const key = `${item.t}|${item.entry}`;
    if (!seen.has(key)) {
      seen.add(key);
      journal.push({tick: row.tick, ...item});
    }
  }
}
const selected = journal.filter(x => {
  const text = String(x.entry || '').toUpperCase();
  return text.includes('FINAL') || text.includes('REFLECTION') || text.includes('HANDOFF') || text.includes('TIMEOUT') || text.includes('RATE LIMIT') || text.includes('SESSION');
});
console.log(JSON.stringify({journalCount:journal.length,selected:selected.slice(-50)},null,2));