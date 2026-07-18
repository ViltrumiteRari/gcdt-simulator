from pathlib import Path
p=Path(r'C:\Users\adahy\Desktop\FirstSignal Sim v1\src\App.jsx')
lines=p.read_text(encoding='utf-8').splitlines()
out=[]
for line in lines:
    if 'const arrow=mom>0?' in line:
        line='  const arrow=mom>0?"UP":mom<0?"DOWN":"FLAT";'
    elif 'SCALP</span>' in line:
        line=line[:line.index('>')+1] if False else line
        line=line.replace(line[line.find('>')+1:line.rfind('</span>')], line[line.find('>')+1:line.rfind('</span>')])
    if 'RESUME SESSION' in line and '<button' in line:
        line=line.replace(line[line.rfind('>')+1:line.rfind('</button>')], 'RESUME SESSION')
    if 'AVAILABLE_REPLAY_DATES.map' in line:
        line='          {AVAILABLE_REPLAY_DATES.map(d=>{const q=replayQualityFor(d),data=replayMetaFor(d);return <option key={d} value={d}>{q.level} | {data?.label||d} | {q.label}</option>;})}'
    if 'LOADING' in line and 'REPLAY' in line and 'startSession("replay")' in line:
        line=line.replace(line[line.find('{replayLoading?'):line.find('}<div',line.find('{replayLoading?'))+1], '{replayLoading?"LOADING...":"REPLAY"}')
    if 'SKIP ALL' in line and 'HOME</button>' in line:
        line=line.replace('>SKIP ALL  ->  HOME</button>','>{"SKIP ALL -> HOME"}</button>')
    out.append(line)
p.write_text('\n'.join(out)+'\n',encoding='utf-8')
print('cleaned targeted UI lines')