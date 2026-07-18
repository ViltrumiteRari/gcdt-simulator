import json, math
from pathlib import Path
import numpy as np
import pandas as pd

ROOT=Path(r'D:\FirstSignal_Sim_Dataset')
APP=Path(r'C:\Users\adahy\Desktop\FirstSignal Sim v1')
DAY='2026-07-15'
METRICS=['net_exposure','net_dex','net_vgex','net_vex','net_cex','gex_ratio','dex_ratio','vgex_ratio','vex_ratio','cex_ratio','flow_ratio','net_flow','call_iv','put_iv','oi_ratio','total_oi']
LEVELS=['max_abs_gamma_strike','max_positive_strike','max_negative_strike','max_dex_strike','min_dex_strike','zero_delta_strike','max_vgex_strike','min_vgex_strike','zero_vgamma_strike','max_vex_strike','min_vex_strike','zero_vanna_strike','max_cex_strike','min_cex_strike','zero_charm_strike','max_call_oi_strike','max_put_oi_strike']

def clean(v):
    if v is None or (isinstance(v,float) and not math.isfinite(v)): return None
    if isinstance(v,(np.integer,)): return int(v)
    if isinstance(v,(np.floating,)): return float(v)
    return v

def time_index(day): return pd.date_range(f'{day} 09:30:00',f'{day} 16:15:00',freq='20s')

def load_timeline(day,grid):
    p=ROOT/day/'sim_input'/'market_timeline.csv'; d=pd.read_csv(p)
    d['captured_at']=pd.to_datetime(d.captured_at,errors='coerce'); out={}
    for ticker in ('SPY','SPX'):
        x=d[d.ticker.eq(ticker)].copy().sort_values('captured_at')
        pri={'gexstream_native_20s':0,'gex_exposure':1,'spot':2,'market_context':3}
        x['_p']=x.source.map(pri).fillna(9); x=x.sort_values(['captured_at','_p']).drop_duplicates('captured_at').set_index('captured_at')
        cols=[c for c in METRICS+LEVELS+['spot','source','provenance','source_age_seconds'] if c in x.columns]
        x=x[cols].reindex(x.index.union(grid)).sort_index().ffill().reindex(grid)
        for c in METRICS+LEVELS+['spot','source_age_seconds']:
            if c in x: x[c]=pd.to_numeric(x[c],errors='coerce')
        for c in METRICS:
            if c not in x: continue
            s=x[c]; mean=s.expanding(min_periods=20).mean(); std=s.expanding(min_periods=20).std(ddof=0).replace(0,np.nan)
            x[c+'_z_session']=(s-mean)/std; x[c+'_mean_session']=mean; x[c+'_std_session']=std
        out[ticker]=x
    return out

def compact_row(row):
    metrics={k:clean(row.get(k)) for k in METRICS if k in row}
    levels={k:clean(row.get(k)) for k in LEVELS if k in row}
    z={k.replace('_z_session',''):clean(row.get(k)) for k in row.index if k.endswith('_z_session')}
    bands={k.replace('_mean_session',''):{'mean':clean(row.get(k)),'std':clean(row.get(k.replace('_mean_session','_std_session')))} for k in row.index if k.endswith('_mean_session')}
    return {'metrics':metrics,'levels':levels,'zScores':z,'statBands':bands,'zScoreBasis':'SESSION_CAUSAL_EXPANDING','source':row.get('source'),'provenance':row.get('provenance'),'sourceAgeSeconds':clean(row.get('source_age_seconds'))}

def load_legacy_surfaces(day):
    out={}
    for ticker in ('SPY','SPX'):
        p=ROOT/day/ticker/'exposure'/'strike_exposure_long.csv'
        if not p.exists(): out[ticker]={}; continue
        d=pd.read_csv(p); d['captured_at']=pd.to_datetime(d.captured_at,errors='coerce')
        d=d.dropna(subset=['captured_at','strike']).sort_values('captured_at'); snaps={}
        for ts,g in d.groupby('captured_at'):
            g=g.copy(); g['dist']=(pd.to_numeric(g.strike,errors='coerce')-pd.to_numeric(g.spot,errors='coerce')).abs()
            g=g.sort_values(['dist','expiration']).head(40)
            snaps[ts]=[{'expiration':str(r.expiration),'strike':clean(r.strike),'gex':clean(r.net_exposure),'callGex':clean(r.call_exposure),'putGex':clean(r.put_exposure)} for r in g.itertuples()]
        out[ticker]=snaps
    return out

def load_gexstream_raw(day):
    out={}
    names={'data':'gex','dexData':'dex','vgexData':'vgex','vexData':'vex','cexData':'cex','oiData':'oi'}
    for ticker in ('SPY','SPX'):
        snaps={}; rawdir=ROOT/day/ticker/'gexstream'/'raw'
        for p in sorted(rawdir.glob('*.json')) if rawdir.exists() else []:
            try:
                payload=json.loads(p.read_text(encoding='utf-8')); c=payload.get('cachedResponse') or {}; rd=c.get('rawData') or {}
                ts=pd.to_datetime(p.stem,format='%Y-%m-%dT%H-%M-%S',errors='coerce')
                cells={}
                for src,dst in names.items():
                    vals=[]
                    for r in rd.get(src) or []:
                        strike=float(r.get('label')) if r.get('label') is not None else None
                        if strike is None: continue
                        vals.append({'strike':strike,'value':clean(r.get('value')),'sessionOpen':clean(r.get('sessionOpen')),'sessionHigh':clean(r.get('sessionHigh')),'sessionLow':clean(r.get('sessionLow')),'putValue':clean(r.get('putValue'))})
                    cells[dst]=vals
                snaps[ts]={'cells':cells,'historicalBands':c.get('zBands'),'marketAggregate':c.get('marketAggregate'),'gexStats':c.get('gexStats'),'source':'GEXSTREAM_RAW_SURFACE'}
            except Exception: pass
        out[ticker]=snaps
    return out

def latest_at(snaps,ts,max_age_s):
    keys=[k for k in snaps if k<=ts]
    if not keys:return None,None
    k=max(keys); age=(ts-k).total_seconds()
    return (snaps[k],age) if age<=max_age_s else (None,age)

def compact_surface(surface,spot,ticker):
    if not surface:return None
    scale=1 if ticker=='SPY' else 10; radius=14*scale
    if 'cells' in surface:
        cells={}
        for greek,rows in surface['cells'].items():
            near=[r for r in rows if abs(float(r['strike'])-spot)<=radius]
            cells[greek]=sorted(near,key=lambda r:abs(float(r['strike'])-spot))[:40]
        return {**surface,'cells':cells}
    return surface

def load_tape(day):
    out={}
    for ticker in ('SPY','SPX'):
        p=ROOT/day/ticker/'gexstream'/'tape_backfill.json'
        if not p.exists(): out[ticker]=None; continue
        try: out[ticker]=json.loads(p.read_text(encoding='utf-8'))
        except Exception: out[ticker]=None
    return out

def tape_at(payload,ts,ticker):
    if not payload:return None
    entries=(payload.get('data') or {}).get('entries') or []
    cutoff=int(pd.Timestamp(ts,tz='America/New_York').tz_convert('UTC').timestamp()*1000)
    valid=[e for e in entries if int(e.get('timestamp') or 0)<=cutoff]
    if not valid:return None
    same=[e for e in valid if str(e.get('expiry') or '').endswith(pd.Timestamp(ts).strftime('%m%d'))]
    use=same or valid
    calls=[e for e in use if e.get('isCall')]; puts=[e for e in use if not e.get('isCall')]
    def total(rows,k): return float(sum(float(x.get(k) or 0) for x in rows))
    top=sorted(use,key=lambda e:float(e.get('notional') or 0),reverse=True)[:8]
    cn,pn=total(calls,'notional'),total(puts,'notional')
    return {'entryCount':len(use),'callNotional':cn,'putNotional':pn,'callShare':cn/max(cn+pn,1),'callVolume':total(calls,'volume'),'putVolume':total(puts,'volume'),'topContracts':[{k:clean(e.get(k)) for k in ('strike','isCall','expiry','volume','avgSize','notional','timestamp')} for e in top],'source':'GEXSTREAM_TAPE_BACKFILL_CAUSAL'}

def main(day=DAY):
    replay_path=APP/'public'/'replays'/f'{day}.json'; replay=json.loads(replay_path.read_text(encoding='utf-8'))
    grid=time_index(day); timeline=load_timeline(day,grid); legacy=load_legacy_surfaces(day); raw=load_gexstream_raw(day); tapes=load_tape(day)
    for i,snap in enumerate(replay['snapshots']):
        ts=grid[i]
        expanded={}
        for ticker in ('SPY','SPX'):
            row=timeline[ticker].iloc[i]; spot=float(snap['spySpot'] if ticker=='SPY' else snap['spxSpot'])
            rs,raw_age=latest_at(raw[ticker],ts,45)
            ls,legacy_age=latest_at(legacy[ticker],ts,600)
            surface=compact_surface(rs,spot,ticker) if rs else ({'cells':{'gex':ls},'source':'EXPOSURE_STRIKE_SNAPSHOT'} if ls else None)
            expanded[ticker]={**compact_row(row),'surface':surface,'surfaceAgeSeconds':clean(raw_age if rs else legacy_age),'surfaceAvailable':bool(surface)}
        tape=tape_at(tapes.get('SPY'),ts,'SPY')
        snap['expandedMarket']={'schemaVersion':3,'SPY':expanded['SPY'],'SPX':expanded['SPX'],'marketAggregate':(expanded['SPY']['surface'] or {}).get('marketAggregate') if expanded['SPY']['surface'] else None,'tapeAnalytics':tape,'lending':{'available':False,'reason':'NOT_COLLECTED_FOR_SESSION'},'shortVolume':{'available':False,'reason':'NOT_COLLECTED_FOR_SESSION'},'availability':{'aggregateGreeks':True,'sessionZScores':True,'fullSurfaceSPY':expanded['SPY']['surfaceAvailable'],'fullSurfaceSPX':expanded['SPX']['surfaceAvailable'],'marketAggregate':bool((expanded['SPY']['surface'] or {}).get('marketAggregate')),'tapeAnalytics':bool(tape),'lending':False,'shortVolume':False},'lookaheadSafe':True}
    replay.setdefault('coverage',{})['expandedSchemaVersion']=3
    replay['coverage']['expandedFields']=['GEX','DEX','VGEX','VEX','CEX','FLOW','IV','OI','SESSION_ZSCORES','STAT_BANDS','STRIKE_SURFACE','TAPE_ANALYTICS']
    replay['coverage']['unavailableFields']=['LENDING','SHORT_VOLUME']
    replay_path.write_text(json.dumps(replay,separators=(',',':')),encoding='utf-8')
    cache=APP/'runtime'/'replay-cache'/f'{day}.json'; cache.parent.mkdir(parents=True,exist_ok=True); cache.write_text(json.dumps(replay,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'day':day,'snapshots':len(replay['snapshots']),'bytes':replay_path.stat().st_size,'surfaceTicks':sum(bool(x['expandedMarket']['availability']['fullSurfaceSPY']) for x in replay['snapshots']),'tapeTicks':sum(bool(x['expandedMarket']['availability']['tapeAnalytics']) for x in replay['snapshots'])},indent=2))

if __name__=='__main__': main()
