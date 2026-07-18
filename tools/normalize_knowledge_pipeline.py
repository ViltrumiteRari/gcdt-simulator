from pathlib import Path
import json, shutil, datetime, re, hashlib

root=Path(r"C:\Users\adahy\Desktop\FirstSignal Sim v1\knowledge-pipeline")
findings_dir=root/'03-findings'; archive=root/'90-archive'
canonical_file=findings_dir/'canonical-findings.json'
backlog_file=findings_dir/'engineering-backlog.json'
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup=archive/f'pre-normalization-{stamp}'; backup.mkdir(parents=True,exist_ok=True)
for f in [canonical_file,backlog_file]:
    if f.exists(): shutil.copy2(f,backup/f.name)

def load(p,default):
    try:return json.loads(p.read_text(encoding='utf-8-sig'))
    except:return default

def root_key(raw,title=''):
    base=str(raw or '').upper()
    known=['INTENT_CURRENT_LEG_AGREEMENT','INTENT_GAP_DEDUPLICATION','POST_EXIT_STATE_RESET','POSITION_LOSS_LIMIT_ENFORCEMENT','REENTRY_EVIDENCE_MAPPING','INTENT_PRICE_PERSISTENCE','OPEN_POSITION_PNL_SYNC','INTENT_READINESS_GAPS_STABLE','MARKET_CLOSE_BLOCKER_STABLE']
    for key in known:
        if base==key:return key
    semantic=f"{base} {title or ''}".upper()
    if any(x in semantic for x in ['LEG_AGREEMENT','LEG AGREEMENT','CURRENT LEG AGREES']):return 'INTENT_CURRENT_LEG_AGREEMENT'
    if 'DUPLICATE_INTENT_GAPS' in semantic or ('DUPLICATE ENTRIES' in semantic and 'GAPS' in semantic):return 'INTENT_GAP_DEDUPLICATION'
    if any(x in semantic for x in ['POST_EXIT','HOLD_INTENT_LATENCY','OPEN_POSITION_LOGIC']) or ('EXIT' in semantic and 'LATENCY' in semantic) or 'HOLD PERSISTS' in semantic:return 'POST_EXIT_STATE_RESET'
    if 'MAX_LOSS' in semantic or 'VEHICLE_FAILURE_EXIT_RECURRENCE' in semantic or ('VEHICLE FAILURE' in semantic and 'LOSS LIMIT' in semantic):return 'POSITION_LOSS_LIMIT_ENFORCEMENT'
    if 'REENTRY' in semantic and any(x in semantic for x in ['DIAGNOSTIC','PROSE','EVIDENCE','MAPPING']):return 'REENTRY_EVIDENCE_MAPPING'
    if 'PERSISTENCE' in semantic:return 'INTENT_PRICE_PERSISTENCE'
    if 'PNL' in semantic and any(x in semantic for x in ['SYNC','REPORT','MISMATCH']):return 'OPEN_POSITION_PNL_SYNC'
    base=re.sub(r'_SNAPSHOT\d+$','',base)
    base=re.sub(r'(?:[._-]TICK)?[._-]?T?\d+$','',base)
    return re.sub(r'[^A-Z0-9]+','_',base).strip('_')
raw=load(canonical_file,{"findings":{}}).get('findings',{})
merged={}
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
for source_key,item in raw.items():
    rk=root_key(source_key,item.get('title'))
    cur=merged.setdefault(rk,{"key":rk,"rootCauseKey":rk,"title":item.get('title') or source_key,"category":item.get('category') or 'UNKNOWN',"lifecycleStatus":item.get('lifecycleStatus') or 'RAW_OBSERVATION',"firstSeen":item.get('firstSeen') or item.get('lastSeen') or now,"observations":[],"reviews":item.get('reviews',[]),"fixes":item.get('fixes',[]),"validations":item.get('validations',[])})
    obs=item.get('observations') or [{"sourceFindingKey":source_key,"level":item.get('level'),"title":item.get('title'),"summary":item.get('summary') or item.get('latestSummary'),"buildId":item.get('buildId') or item.get('latestBuildId'),"buildSequence":item.get('buildSequence') or item.get('latestBuildSequence'),"sessionId":item.get('lastSessionId'),"observedAtUtc":item.get('lastSeen') or now}]
    cur['observations'].extend(obs)
    cur['reviews'].extend(item.get('reviews',[]))
    cur['fixes'].extend(item.get('fixes',[]))
    cur['validations'].extend(item.get('validations',[]))
    cur['lastSeen']=max(str(cur.get('lastSeen') or ''),str(item.get('lastSeen') or ''))
    if item.get('level')=='RED' or cur.get('level')!='RED':cur['level']=item.get('level') or cur.get('level')
    cur['latestSummary']=item.get('latestSummary') or item.get('summary') or cur.get('latestSummary')

fixes={
 'INTENT_CURRENT_LEG_AGREEMENT':'WAIT no longer counts as local directional agreement; Observer regime guidance corrected.',
 'INTENT_GAP_DEDUPLICATION':'Intent gaps and supporting factors are deduplicated before export.',
 'POSITION_LOSS_LIMIT_ENFORCEMENT':'Selected maxLossPct is now wired to executable MAX_LOSS_LIMIT exits.'
}
verified={
 'POST_EXIT_STATE_RESET':'Two July 9 validation runs confirmed immediate WAIT/null-position reset after four exits, including vehicle failure and profit exits.'
}
for rk,description in fixes.items():
    cur=merged.setdefault(rk,{"key":rk,"rootCauseKey":rk,"title":rk,"category":"BUG","firstSeen":now,"observations":[],"reviews":[],"fixes":[],"validations":[]})
    cur['lifecycleStatus']='FIXED_PENDING_VALIDATION'
    cur['fixes']=[x for x in cur.get('fixes',[]) if x.get('buildId')!='firstsignal-sim-v1.4-20260712']+[{"buildId":"firstsignal-sim-v1.4-20260712","buildSequence":5,"implementedAtUtc":now,"description":description}]
    if rk=='INTENT_CURRENT_LEG_AGREEMENT':cur['adjudicationNote']='Original reports partly overreached by treating negative immediate price action as automatic opposition to CALL. The validated implementation defect was WAIT receiving agreement points.'
for rk,description in verified.items():
    cur=merged.setdefault(rk,{"key":rk,"rootCauseKey":rk,"title":rk,"category":"BUG","firstSeen":now,"observations":[],"reviews":[],"fixes":[],"validations":[]})
    cur['lifecycleStatus']='FIX_VERIFIED'
    cur['validations']=[x for x in cur.get('validations',[]) if x.get('campaignName')!='july9-two-run-validation']+[{"campaignName":"july9-two-run-validation","validatedAtUtc":now,"buildId":"firstsignal-sim-v1.3-20260712","description":description}]
for cur in merged.values():
    cur['observations']=cur.get('observations',[])[-100:]
    cur['reviews']=cur.get('reviews',[])[-40:]
    cur['occurrenceCount']=len(cur['observations'])
canonical_file.write_text(json.dumps({"pipelineVersion":2,"updatedAt":now,"findings":merged},indent=2),encoding='utf-8')
back=load(backlog_file,{"items":[]})
groups={}
rank={'RED':0,'YELLOW':1,'GREEN':2}
for item in back.get('items',[]):
    rk=root_key(item.get('rootCauseKey') or item.get('findingKey'),item.get('title'))
    key=(rk,item.get('buildId') or 'UNKNOWN')
    g=groups.get(key)
    if not g:
        g=dict(item)
        g['rootCauseKey']=rk;g['findingKey']=rk
        g['sourceFindingKeys']=[];g['sourceItemIds']=[];g['occurrenceCount']=0
        groups[key]=g
    g['sourceFindingKeys']=sorted(set(g['sourceFindingKeys']+[item.get('findingKey') or 'UNKNOWN']))
    g['sourceItemIds']=sorted(set(g['sourceItemIds']+[item.get('id')]))
    g['occurrenceCount']+=int(item.get('occurrenceCount') or 1)
    if rank.get(item.get('severity'),9)<rank.get(g.get('severity'),9):
        g['severity']=item.get('severity');g['title']=item.get('title');g['diagnosis']=item.get('diagnosis')
    g['updatedAt']=max(str(g.get('updatedAt') or ''),str(item.get('updatedAt') or ''))
for (rk,build),g in groups.items():
    stable=f"{rk}|{build}".encode()
    g['id']='ENG-'+hashlib.sha1(stable).hexdigest()[:10].upper()
    if rk in fixes:
        g['status']='SUPERSEDED_BY_V1_4_FIX'
        g['lifecycleStatus']='FIXED_PENDING_VALIDATION'
        g['supersededByBuildId']='firstsignal-sim-v1.4-20260712'
    elif rk in verified:
        g['status']='FIX_VERIFIED'
        g['lifecycleStatus']='FIX_VERIFIED'
backlog_file.write_text(json.dumps({"pipelineVersion":2,"updatedAt":now,"items":sorted(groups.values(),key=lambda x:(rank.get(x.get('severity'),9),x.get('rootCauseKey',''),x.get('buildId','')))},indent=2),encoding='utf-8')
print(json.dumps({"canonicalBefore":len(raw),"canonicalAfter":len(merged),"backlogBefore":len(back.get('items',[])),"backlogAfter":len(groups),"backup":str(backup)},indent=2))
