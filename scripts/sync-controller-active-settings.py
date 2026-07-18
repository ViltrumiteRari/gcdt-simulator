from pathlib import Path
p=Path(r'C:\Users\adahy\Desktop\FirstSignal Sim v1\electron\campaign-controller.js')
s=p.read_text(encoding='utf-8')
old="active=['RUNNING','PAUSED'].includes(d.status);$('summary').textContent=active?`${d.completedRuns}/${d.targetRuns} complete · ${d.status}`:d.status;"
new="active=['RUNNING','PAUSED'].includes(d.status);if(active){$('speed').value=String(d.speed||9);$('runs').value=String(d.runsPerDay||1);selectedDays=[...(d.selectedDates||[])];renderDays();}$('summary').textContent=active?`${d.completedRuns}/${d.targetRuns} complete · ${d.status}`:d.status;"
if old not in s: raise SystemExit('TARGET_NOT_FOUND')
p.write_text(s.replace(old,new),encoding='utf-8')
print('CONTROLLER_ACTIVE_SETTINGS_SYNCED')