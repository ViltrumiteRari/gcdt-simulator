from pathlib import Path
from datetime import datetime, timezone, timedelta
import json, re

root=Path(r"C:\Users\adahy\Desktop\FirstSignal Sim v1\knowledge-pipeline\01-sessions")

def parse_dt(value,fallback):
    if not value:return fallback
    try:return datetime.fromisoformat(str(value).replace('Z','+00:00'))
    except:return fallback

def normalize_time(value):
    if not value:return None
    raw=str(value).strip();m=re.match(r'^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?$',raw,re.I)
    if not m:return raw
    h=int(m.group(1));mi=int(m.group(2));sec=int(m.group(3) or 0);ap=(m.group(4) or '').upper()
    if ap=='PM' and h<12:h+=12
    if ap=='AM' and h==12:h=0
    return f'{h:02d}:{mi:02d}:{sec:02d}'

def temporal(at,replay,market_time):
    if at.tzinfo is None:at=at.replace(tzinfo=timezone.utc)
    utc=at.astimezone(timezone.utc);local=at.astimezone()
    market_date=replay or local.date().isoformat();mt24=normalize_time(market_time)
    return {'observedAtUtc':utc.isoformat().replace('+00:00','Z'),'observedAtLocal':local.isoformat(),'localDate':local.date().isoformat(),'replayDate':replay,'marketDate':market_date,'marketTime':market_time,'marketTime24':mt24,'chronologicalKey':f"{market_date}T{mt24 or '00:00:00'}|{utc.isoformat().replace('+00:00','Z')}",'timestampBackfilled':True}
files_changed=0;records_changed=0
for session_file in root.rglob('session.json'):
    session=json.loads(session_file.read_text(encoding='utf-8-sig'))
    replay=session.get('replayDate')
    base=parse_dt(session.get('startedAt'),datetime.fromtimestamp(session_file.stat().st_mtime,timezone.utc))
    changed=False
    if 'observedAtUtc' not in session:
        session.update(temporal(base,replay,None));changed=True
    folder=session_file.parent
    if (session.get('status') or {}).get('state')=='COMPLETED' and not ((session.get('status') or {}).get('completedAt') or session.get('completedAt')):
        ended=[]
        for summary in folder.rglob('meeting-summary.json'):
            try:ended.append(parse_dt(json.loads(summary.read_text(encoding='utf-8-sig')).get('endedAt'),datetime.fromtimestamp(summary.stat().st_mtime,timezone.utc)))
            except:pass
        completed=(max(ended) if ended else datetime.fromtimestamp(session_file.stat().st_mtime,timezone.utc)).astimezone(timezone.utc).isoformat().replace('+00:00','Z')
        session.setdefault('status',{})['completedAt']=completed
        session['completedAt']=completed
        changed=True
    if changed:
        files_changed+=1
        session_file.write_text(json.dumps(session,indent=2),encoding='utf-8')
    for name in ['events.jsonl','reports.jsonl']:
        f=folder/name
        if not f.exists():continue
        out=[]
        for i,line in enumerate(f.read_text(encoding='utf-8-sig').splitlines()):
            if not line.strip():continue
            obj=json.loads(line)
            market_time=obj.get('time') or obj.get('t')
            at=base+timedelta(milliseconds=i)
            if name=='reports.jsonl':
                m=re.match(r'^QA-(\d+)',str(obj.get('id') or ''))
                if m:at=datetime.fromtimestamp(int(m.group(1))/1000,timezone.utc)
                obj.setdefault('evidenceStatus','RAW_OBSERVATION')
            if 'temporal' not in obj and 'observedAtUtc' not in obj:
                tm=temporal(at,replay,market_time)
                obj['temporal']=tm
                obj.update(tm)
                records_changed+=1
            out.append(json.dumps(obj,separators=(',',':')))
        f.write_text('\n'.join(out)+('\n' if out else ''),encoding='utf-8')
        files_changed+=1
    for memo_file in folder.rglob('memos.jsonl'):
        packet_file=memo_file.parent/'review-packet.json'
        packet=json.loads(packet_file.read_text(encoding='utf-8-sig')) if packet_file.exists() else {'cases':[]}
        case_times={c.get('caseId'):(c.get('finding') or {}).get('t') for c in packet.get('cases',[])}
        out=[]
        for i,line in enumerate(memo_file.read_text(encoding='utf-8-sig').splitlines()):
            if not line.strip():continue
            obj=json.loads(line)
            at=parse_dt(obj.get('at'),base+timedelta(seconds=i))
            if 'observedAtUtc' not in obj:
                obj.update(temporal(at,replay,case_times.get(obj.get('caseId'))));records_changed+=1
            out.append(json.dumps(obj,separators=(',',':')))
        memo_file.write_text('\n'.join(out)+('\n' if out else ''),encoding='utf-8');files_changed+=1
    for summary_file in folder.rglob('meeting-summary.json'):
        obj=json.loads(summary_file.read_text(encoding='utf-8-sig'))
        at=parse_dt(obj.get('endedAt'),datetime.fromtimestamp(summary_file.stat().st_mtime,timezone.utc))
        if 'temporal' not in obj:
            obj['temporal']=temporal(at,replay,None);records_changed+=1
            summary_file.write_text(json.dumps(obj,indent=2),encoding='utf-8');files_changed+=1
print(json.dumps({'filesChanged':files_changed,'recordsChanged':records_changed},indent=2))
