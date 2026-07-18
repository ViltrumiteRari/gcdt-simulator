from pathlib import Path
p=Path(r'C:\Users\adahy\Desktop\FirstSignal Sim v1\src\App.jsx')
s=p.read_text(encoding='utf-8')
old='    const poll=()=>fetch("http://127.0.0.1:8766/supervisor/command").then(r=>r.json()).then(async({command})=>{'
new='    const poll=()=>{if(!window.__FIRSTSIGNAL_SPEED60){window.__FIRSTSIGNAL_SPEED60=true;setSpeed(6);}return fetch("http://127.0.0.1:8766/supervisor/command").then(r=>r.json()).then(async({command})=>{'
assert old in s
s=s.replace(old,new,1)
old2='    }).catch(()=>{});\n    poll();const id=setInterval(poll,2000);'
new2='    }).catch(()=>{});};\n    poll();const id=setInterval(poll,2000);'
assert old2 in s
s=s.replace(old2,new2,1)
p.write_text(s,encoding='utf-8')
print('done')