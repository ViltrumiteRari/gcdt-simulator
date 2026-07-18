from pathlib import Path
import json, shutil, datetime
root=Path(r'C:\Users\adahy\Desktop\FirstSignal Sim v1')
mp=root/'runtime'/'parallel-campaign.json'
m=json.loads(mp.read_text(encoding='utf-8-sig'))
for w in m.get('workers',[]):
    src=Path(w['reportFolder'])
    dst=root/'knowledge-pipeline'/'quarantine'/m['id']/w['id']
    if src.exists():
        dst.parent.mkdir(parents=True,exist_ok=True)
        if dst.exists(): shutil.rmtree(dst)
        shutil.move(str(src),str(dst))
    w['status']='QUARANTINED_INVALID_LIVE_OBSERVER'
    w['quarantinedPath']=str(dst)
m['status']='STOPPED_UNTRUSTED'
m['stoppedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
mp.write_text(json.dumps(m,indent=2))
audit={
 'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'rules':{
  'workerOutputRoot':'runtime/run-staging only',
  'workerObserverMode':'posthoc required',
  'durableVersionMemory':'blocked for WORKER_MODE and STAGED_UNTRUSTED',
  'meetingStart':'requires promoted session provenance plus explicit posthoc approval',
  'canonicalSupervisorWrites':'controller canonical root only; worker supervisor remains staging-scoped',
  'promotion':'requires completed session, date/campaign/worker provenance, and integrity checks'
 },
 'currentRun':{'campaignId':m['id'],'status':'QUARANTINED','reason':'launched without posthoc observer mode; 405 emitted transition events from 406 replay snapshots'}
}
(root/'runtime'/'trust-boundary-audit.json').write_text(json.dumps(audit,indent=2))
print(json.dumps(audit,indent=2))