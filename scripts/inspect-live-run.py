from pathlib import Path
import json
sid = 'firstsignal-sim-v1-2026-07-15-1784246732638-2h8uvm'
root = Path(r'C:\Users\adahy\Desktop\FirstSignal Sim v1\knowledge-pipeline\01-sessions')
files = list(root.rglob(sid + '/events.jsonl'))
print(files[0] if files else 'NONE')
if not files:
    raise SystemExit(1)
rows = [json.loads(x) for x in files[0].read_text(encoding='utf-8').splitlines() if x.strip()]
print('ROWS', len(rows), 'TICKS', rows[0]['tick'], rows[-1]['tick'])
print('LAST_NONWAIT_INTENTS')
for r in rows[-160:]:
    i = r.get('intent') or {}
    a = i.get('action')
    if a and a != 'WAIT':
        print(r.get('tick'), r.get('time'), a, i.get('direction'), i.get('setupQuality'), i.get('executionReadiness'), i.get('blockers'), i.get('supportingFactors'))
print('TRADES')
seen = set()
for r in rows:
    for t in r.get('recentTrades') or []:
        k = (t.get('t'), t.get('action'), t.get('result'))
        if k not in seen:
            seen.add(k)
            print(t)
print('RECENT_RELEVANT_JOURNAL')
seenj = set()
for r in rows[-180:]:
    for j in r.get('recentJournal') or []:
        txt = str(j)
        if txt in seenj:
            continue
        seenj.add(txt)
        if any(w in txt.upper() for w in ['PUT','BEAR','CALL','VETO','BLOCK','REJECT','WAIT','REVERS']):
            print(r.get('tick'), txt)
