import json, math
from pathlib import Path

p=Path(r'C:\Users\adahy\Desktop\GCDT\gcdt-v26-airgap\src\realReplayData.js')
text=p.read_text(encoding='utf-8')
data=json.loads(text.split('=',1)[1].rsplit(';',1)[0].strip())
failed=[]
for day,payload in data.items():
    snaps=payload['snapshots']; sizes=[len(x.get('chain',[])) for x in snaps]
    sources={x.get('quoteSource') for x in snaps}
    bad_prices=[]
    for x in snaps:
        for q in x.get('chain',[]):
            for key in ('mid','bid','ask','iv'):
                v=q.get(key)
                if v is None or not math.isfinite(float(v)) or float(v)<0:
                    bad_prices.append((x['time'],q.get('contract'),key,v))
    summary={'snapshots':len(snaps),'sources':sorted(sources),'empty_chains':sum(n==0 for n in sizes),
             'min_chain':min(sizes),'max_chain':max(sizes),'mean_chain':sum(sizes)/len(sizes),
             'bad_values':len(bad_prices),'coverage':payload.get('coverage')}
    print(day,json.dumps(summary))
    if len(snaps)!=406 or sources!={'REAL_TRADE_OHLCV'} or bad_prices or any(n==0 for n in sizes): failed.append((day,summary))
if failed: raise SystemExit(f'FAILED {failed}')
