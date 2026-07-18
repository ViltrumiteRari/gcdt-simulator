from pathlib import Path
import json, re
root=Path(r"C:\Users\adahy\Desktop\FirstSignal Sim v1\knowledge-pipeline")
canonical=json.loads((root/'03-findings'/'canonical-findings.json').read_text(encoding='utf-8-sig'))
backlog=json.loads((root/'03-findings'/'engineering-backlog.json').read_text(encoding='utf-8-sig'))
issues=[]
for key,item in canonical.get('findings',{}).items():
    if len(key)>120:issues.append(f'long canonical key: {key[:80]}')
    if item.get('rootCauseKey')!=key:issues.append(f'root mismatch: {key}')
for item in backlog.get('items',[]):
    if len(item.get('rootCauseKey',''))>120:issues.append(f'long backlog key: {item.get("rootCauseKey")[:80]}')
print('NON_RAW')
for key,item in sorted(canonical.get('findings',{}).items()):
    if item.get('lifecycleStatus')!='RAW_OBSERVATION':print(key,item.get('lifecycleStatus'))
print('COUNTS',len(canonical.get('findings',{})),len(backlog.get('items',[])))
print('ISSUES',len(issues))
for issue in issues[:20]:print(issue)
