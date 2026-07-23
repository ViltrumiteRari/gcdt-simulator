import argparse, hashlib, json, math, sys
from datetime import datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo
import pandas as pd

PROJECT=Path(r'C:\Users\adahy\Desktop\FirstSignal Sim v1')
DATASET=Path(r'D:\FirstSignal_Sim_Dataset')
PUBLIC=PROJECT/'public'/'replays'
CACHE=PROJECT/'runtime'/'replay-cache'
ET=ZoneInfo('America/New_York')
START,END=time(9,30),time(16,15)

def clean(v):
    if isinstance(v,dict): return {k:clean(x) for k,x in v.items()}
    if isinstance(v,list): return [clean(x) for x in v]
    if isinstance(v,float) and not math.isfinite(v): return None
    return v

def source_fingerprint(day):
    paths=[]
    for rel in ['capture_manifest.json','SPY/interval_map/latest_interval_map.json','SPX/interval_map/latest_interval_map.json','SPY/spot/spot_intraday_5m.csv','SPX/spot/spot_intraday_5m.csv']:
        p=day/rel
        if p.exists(): paths.append(p)
    for p in day.glob('options_chains/*/snapshots.csv*'): paths.append(p)
    h=hashlib.sha256()
    for p in sorted(paths):
        s=p.stat(); h.update(str(p.relative_to(day)).encode()); h.update(f'{s.st_size}:{s.st_mtime_ns}'.encode())
    return h.hexdigest(),[str(p.relative_to(day)) for p in paths]
def interval_payload(day,ticker):
    p=day/ticker/'interval_map'/'latest_interval_map.json'
    if not p.exists(): return None
    raw=json.loads(p.read_text(encoding='utf-8'))
    return raw.get('response',raw)

def interval_frames(day_name,ticker,payload):
    summaries=[]; strikes=[]
    prices=payload.get('timestampEpochMillisToStockPriceInCents',{})
    for stamp,buckets in sorted(payload.get('intervalMap',{}).items(),key=lambda x:int(x[0])):
        dt=datetime.fromtimestamp(int(stamp)/1000,ET)
        if dt.date().isoformat()!=day_name or not START<=dt.time()<=END: continue
        ts=dt.replace(tzinfo=None).isoformat(timespec='seconds')
        cents=prices.get(stamp) or prices.get(str(int(stamp)))
        if cents is None: continue
        spot=float(cents)/100; calls=puts=0.0; bucket=[]
        for exp,rows in buckets.items():
            for strike_cents,vals in rows.items():
                strike=float(strike_cents)/100
                call=float(vals.get('CALL',0) or 0); put=float(vals.get('PUT',0) or 0)
                row={'captured_at':ts,'session_date':day_name,'ticker':ticker,'expiration':exp,'strike':strike,'call_exposure':call,'put_exposure':put,'net_exposure':call+put,'spot':spot}
                bucket.append(row); strikes.append(row); calls+=call; puts+=put
        if not bucket: continue
        f=pd.DataFrame(bucket); denom=calls+abs(puts)
        summaries.append({'captured_at':ts,'session_date':day_name,'ticker':ticker,'spot':spot,'total_call_exposure':calls,'total_put_exposure':puts,'net_exposure':calls+puts,'call_dominance_pct':100*calls/denom if denom else 50.0,'max_abs_gamma_strike':f.loc[f.net_exposure.abs().idxmax(),'strike'],'max_positive_strike':f.loc[f.net_exposure.idxmax(),'strike'],'max_negative_strike':f.loc[f.net_exposure.idxmin(),'strike']})
    return pd.DataFrame(summaries),pd.DataFrame(strikes)
def merge_canonical(day,ticker):
    payload=interval_payload(day,ticker)
    if not payload: return {'ticker':ticker,'intervalBuckets':0}
    summary,strikes=interval_frames(day.name,ticker,payload)
    exp=day/ticker/'exposure'; exp.mkdir(parents=True,exist_ok=True)
    sp,lp=exp/'exposure_over_time.csv',exp/'strike_exposure_long.csv'
    if sp.exists():
        old=pd.read_csv(sp); old['captured_at']=pd.to_datetime(old.captured_at,errors='coerce')
        old=old[(old.captured_at.dt.date.astype(str)==day.name)&old.captured_at.dt.time.between(START,END)]
        old['captured_at']=old.captured_at.dt.strftime('%Y-%m-%dT%H:%M:%S')
        summary=pd.concat([summary,old],ignore_index=True)
    summary=summary.drop_duplicates(['captured_at','ticker'],keep='last').sort_values('captured_at')
    summary.to_csv(sp,index=False)
    if lp.exists():
        old=pd.read_csv(lp); old['captured_at']=pd.to_datetime(old.captured_at,errors='coerce')
        old=old[(old.captured_at.dt.date.astype(str)==day.name)&old.captured_at.dt.time.between(START,END)]
        old['captured_at']=old.captured_at.dt.strftime('%Y-%m-%dT%H:%M:%S')
        strikes=pd.concat([strikes,old],ignore_index=True)
    strikes=strikes.drop_duplicates(['captured_at','ticker','expiration','strike'],keep='last').sort_values(['captured_at','expiration','strike'])
    strikes.to_csv(lp,index=False)
    times=pd.to_datetime(summary.captured_at).sort_values(); gaps=times.diff().dt.total_seconds().div(60).dropna()
    return {'ticker':ticker,'intervalBuckets':len(interval_frames(day.name,ticker,payload)[0]),'canonicalBuckets':len(summary),'first':times.min().strftime('%H:%M'),'last':times.max().strftime('%H:%M'),'maxGapMinutes':float(gaps.max()) if len(gaps) else 0}

def build_sim_input(day):
    qdc=Path(r'C:\Users\adahy\Desktop\QuantDataCapture')
    sys.path.insert(0,str(qdc))
    from finalize_dataset import process_day
    return process_day(day)
def replay_quality(payload):
    snaps=payload['snapshots']; source_seconds=int(payload.get('sourceIntervalSeconds') or 300); playback_seconds=int(payload.get('playbackIntervalSeconds') or (20 if len(snaps)>=1000 else 60)); expected_hold=max(1,math.ceil(source_seconds/playback_seconds))
    g=[x for x in snaps if x.get('netGex') is not None and x.get('netGexSpx') is not None]
    real=sum(1 for x in snaps if str(x.get('quoteSource','')).startswith('REAL'))
    first=next((x['time'] for x in snaps if x.get('netGex') is not None),None)
    last=next((x['time'] for x in reversed(snaps) if x.get('netGex') is not None),None)
    missing=len(snaps)-len(g)
    regular=[x for x in snaps if str(x.get('time',''))<='16:00:00']
    def longest_run(key, rows):
        best=run=1
        for a,b in zip(rows,rows[1:]):
            run=run+1 if a.get(key)==b.get(key) else 1; best=max(best,run)
        return best
    spy_stale=longest_run('netGex',regular); spx_stale=longest_run('netGexSpx',regular)
    spy_spot_stale=longest_run('spySpot',regular); spx_spot_stale=longest_run('spxSpot',regular)
    research_hold_spy=longest_run('netGex',snaps); research_hold_spx=longest_run('netGexSpx',snaps)
    stale=max(spy_stale,spx_stale)>max(9,expected_hold*2+1) or spy_spot_stale>max(30,expected_hold*4+1) or spx_spot_stale>max(30,expected_hold*4+1)
    level='GREEN' if missing==0 and real>=300 and not stale else 'YELLOW' if len(g)>=70 and not stale else 'RED'
    return {'level':level,'snapshotCount':len(snaps),'gexCompleteTicks':len(g),'gexMissingTicks':missing,'gexFirst':first,'gexLast':last,'gexLongestHeldTicksSPY':spy_stale,'gexLongestHeldTicksSPX':spx_stale,'spotLongestHeldTicksSPY':spy_spot_stale,'spotLongestHeldTicksSPX':spx_spot_stale,'gexResearchWindowHeldTicksSPY':research_hold_spy,'gexResearchWindowHeldTicksSPX':research_hold_spx,'expectedNativeHoldTicks':expected_hold,'sourceIntervalSeconds':source_seconds,'playbackIntervalSeconds':playback_seconds,'gexStaleFailure':stale,'realOptionTicks':real,'optionCoverage':'FULL_OR_MOSTLY_REAL' if real>=300 else 'PARTIAL_OR_SYNTHETIC'}

def build_replay(day):
    sys.path.insert(0,str(PROJECT/'tools'))
    import build_real_replay_v2 as builder
    payload=clean(builder.build_day(day.name))
    PUBLIC.mkdir(parents=True,exist_ok=True)
    out=PUBLIC/f'{day.name}.json'; out.write_text(json.dumps(payload,separators=(',',':'),allow_nan=False),encoding='utf-8')
    return payload,out

def prepare(day,force=False):
    fp,sources=source_fingerprint(day); CACHE.mkdir(parents=True,exist_ok=True)
    marker=CACHE/f'{day.name}.json'; output=PUBLIC/f'{day.name}.json'
    if not force and marker.exists() and output.exists():
        old=json.loads(marker.read_text(encoding='utf-8'))
        if old.get('sourceFingerprint')==fp: return {**old,'cache':'HIT'}
    coverage=[merge_canonical(day,t) for t in ('SPY','SPX')]
    sim=build_sim_input(day); payload,out=build_replay(day); quality=replay_quality(payload)
    override_path=day/'quality_override.json'
    if override_path.exists():
        override=json.loads(override_path.read_text(encoding='utf-8'))
        quality={**quality,**{k:v for k,v in override.items() if k not in ('date','evidence')}}
        quality['qualityOverride']=True
        quality['overrideEvidence']=override.get('evidence',{})
    record={'date':day.name,'preparedAt':datetime.now().isoformat(),'sourceFingerprint':fp,'sources':sources,'coverage':coverage,'simRows':sim.get('rows',{}),'quality':quality,'output':str(out),'cache':'BUILT'}
    marker.write_text(json.dumps(record,indent=2),encoding='utf-8')
    return record
def discover_days():
    out=[]
    for day in sorted(DATASET.iterdir()):
        if not day.is_dir() or not day.name.startswith('2026-'): continue
        if all((day/t/'interval_map'/'latest_interval_map.json').exists() for t in ('SPY','SPX')):
            out.append(day)
    return out

def write_indexes(records):
    records=sorted(records,key=lambda x:x['date'])
    PUBLIC.mkdir(parents=True,exist_ok=True)
    (PUBLIC/'index.json').write_text(json.dumps({'generatedAt':datetime.now().isoformat(),'days':records},indent=2),encoding='utf-8')
    lines=['export const REAL_REPLAY_META = {']
    for r in records:
        q=r.get('quality',{}); date=r['date']
        playback=int(q.get('playbackIntervalSeconds') or (20 if q.get('snapshotCount',0)>=1000 else 60)); source=int(q.get('sourceIntervalSeconds') or 300)
        source_label=f"{source//60}m native source" if source>=60 else f"{source}s native source"
        label=f'{date} | Unified native SPY/SPX | {playback}s playback | {source_label}'
        lines.append(f'  "{date}": {{ date: "{date}", file: "{date}.json", label: "{label}", dayType: "REAL DATA REPLAY", playbackIntervalSeconds: {playback}, sourceIntervalSeconds: {source}, nativeSourceCadence: {str(playback==source).lower()}, snapshotCount: {q.get("snapshotCount",1216)}, quality: {json.dumps(q,separators=(",",":"))} }},')
    lines.extend(['};','','const cache = new Map();',''])
    lines.append('export async function loadRealReplay(date) {')
    lines.append('  if (!REAL_REPLAY_META[date]) return null;')
    lines.append('  if (cache.has(date)) return cache.get(date);')
    lines.append('  const promise = fetch(`/replays/${REAL_REPLAY_META[date].file}`, { cache: "no-store" })')
    lines.append('    .then(async response => {')
    lines.append('      if (!response.ok) throw new Error(`REPLAY_LOAD_${response.status}:${date}`);')
    lines.append('      const replay = await response.json();')
    lines.append('      if (!Array.isArray(replay?.snapshots) || replay.snapshots.length === 0) throw new Error(`REPLAY_INVALID:${date}`);')
    lines.append('      return replay;')
    lines.append('    })')
    lines.append('    .catch(error => { cache.delete(date); throw error; });')
    lines.append('  cache.set(date, promise);')
    lines.append('  return promise;')
    lines.append('}')
    (PROJECT/'src'/'replayAssets.js').write_text('\n'.join(lines)+'\n',encoding='utf-8')
def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--date',action='append')
    ap.add_argument('--all',action='store_true')
    ap.add_argument('--force',action='store_true')
    args=ap.parse_args()
    days=discover_days() if args.all or not args.date else [DATASET/x for x in args.date]
    for day in days:
        print(f'PREPARE {day.name}',flush=True)
        record=prepare(day,args.force)
        print(json.dumps({'date':record['date'],'cache':record['cache'],'coverage':record.get('coverage'),'quality':record.get('quality')},indent=2),flush=True)
    all_records=[]
    for p in sorted(CACHE.glob('*.json')):
        try: all_records.append(json.loads(p.read_text(encoding='utf-8')))
        except Exception: pass
    write_indexes(all_records)
    print(f'INDEXED {len(all_records)} replay days',flush=True)

if __name__=='__main__':
    main()
