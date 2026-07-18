import json
from datetime import datetime
from pathlib import Path

DATA=Path(r'D:\FirstSignal_Sim_Dataset')
OUT=Path(r'C:\Users\adahy\Desktop\FirstSignal Sim v1\src\replayCatalog.js')
DAYS=sorted([d.name for d in DATA.iterdir() if d.is_dir() and d.name.startswith('2026-')])

def load_interval(day,ticker='SPY'):
    p=DATA/day/ticker/'interval_map'/'latest_interval_map.json'
    if not p.exists(): return None
    return json.loads(p.read_text(encoding='utf-8'))

def summarize(day):
    raw=load_interval(day)
    if not raw: return None
    interval=raw.get('intervalMap',{})
    prices=raw.get('timestampEpochMillisToStockPriceInCents',{})
    snaps=[]
    for stamp in sorted(interval,key=int):
        ts=datetime.fromtimestamp(int(stamp)/1000)
        if ts.date().isoformat()!=day: continue
        calls=puts=0.0; strike_totals={}
        for strikes in interval[stamp].values():
            for strike,values in strikes.items():
                c=float(values.get('CALL',0) or 0); p=float(values.get('PUT',0) or 0)
                calls+=c; puts+=p; strike_totals[strike]=strike_totals.get(strike,0)+c+p
        total_abs=abs(calls)+abs(puts)
        call_dom=abs(calls)/total_abs if total_abs else 0.5
        max_strike=max(strike_totals,key=lambda k:abs(strike_totals[k])) if strike_totals else '0'
        cents=prices.get(stamp) or prices.get(str(int(stamp)))
        spot=(float(cents)/100 if cents is not None else float(max_strike)/100)
        snaps.append({'time':ts.strftime('%H:%M'),'spot':round(spot*10,2),'gex':calls+puts,'callDom':call_dom,'maxGamma':float(max_strike)/10})
    return {'date':day,'label':datetime.fromisoformat(day).strftime('%B %d, %Y').replace(' 0',' '),'dayType':'HISTORICAL REPLAY','snapshots':snaps}

catalog={}
for day in DAYS:
    item=summarize(day)
    if item and item['snapshots']:
        catalog[day]=item

OUT.write_text('export const REPLAY_CATALOG = '+json.dumps(catalog,separators=(',',':'))+';\nexport const REPLAY_DATES = Object.keys(REPLAY_CATALOG).sort().reverse();\n',encoding='utf-8')
for day,item in catalog.items():
    print(day,len(item['snapshots']),item['snapshots'][0]['time'],item['snapshots'][-1]['time'])

