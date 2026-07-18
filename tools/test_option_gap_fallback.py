import importlib.util, json
from pathlib import Path
import pandas as pd

HERE=Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location('builder',HERE/'build_real_replay_v2.py')
b=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(b)
ROOT=Path(r'D:\FirstSignal_Sim_Dataset'); DAY='2026-07-08'
b.DAY=DAY
src=pd.read_csv(ROOT/DAY/'options_historical_quantdata'/'contract_price_time'/'regular_0930_1615_contract_ohlcv.csv')
src=src[src.ticker=='SPY'].copy();src['captured_at']=pd.to_datetime(src.captured_at)
start=pd.Timestamp(f'{DAY} 10:30'); end=pd.Timestamp(f'{DAY} 10:40')
masked=src[~src.captured_at.between(start,end)].copy()
rows=[]
for ts in pd.date_range(start,end,freq='1min'):
    actual=src[src.captured_at==ts]
    if actual.empty: continue
    spot=float(actual.underlying_close.median())
    predicted=b.path_fill_rows(masked,ts,spot)
    pred=pd.DataFrame(predicted)
    if pred.empty: continue
    pred['type']=pred.side.str.upper(); actual=actual.copy();actual['type']=actual.side.str.upper()
    merged=pred.merge(actual[['strike','type','close']],left_on=['strike','type'],right_on=['strike','type'])
    merged['captured_at']=ts; rows.append(merged)
scored=pd.concat(rows,ignore_index=True)
scored['ape']=(scored.mid-scored.close).abs()/scored.close.clip(lower=.05)
liquid=scored[scored.close>=.25]
report={'gap':'10:30-10:40','rows':len(scored),'minutes':scored.captured_at.nunique(),
        'median_ape_all':float(scored.ape.median()),'p90_ape_all':float(scored.ape.quantile(.9)),
        'liquid_rows':len(liquid),'median_ape_liquid':float(liquid.ape.median()),
        'p90_ape_liquid':float(liquid.ape.quantile(.9)),
        'sources':scored.quoteSource.value_counts().to_dict()}
print(json.dumps(report,indent=2))
out=ROOT/DAY/'analysis'/'option_gap_fallback_test.json'
out.write_text(json.dumps(report,indent=2),encoding='utf-8')
if report['minutes']<10 or report['median_ape_liquid']>0.25:
    raise SystemExit('gap fallback quality gate failed')
