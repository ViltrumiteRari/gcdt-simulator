from pathlib import Path
import re
p=Path(r'C:\Users\adahy\Desktop\FirstSignal Sim v1\src\App.jsx')
s=p.read_text(encoding='utf-8')
markers=('\u00c3','\u00c2','\u00e2','\u00f0','\ufffd')
def repair(text):
    cur=text
    for _ in range(4):
        if not any(m in cur for m in markers):
            break
        try:
            nxt=cur.encode('cp1252').decode('utf-8')
        except (UnicodeEncodeError,UnicodeDecodeError):
            break
        if nxt==cur:
            break
        cur=nxt
    return cur
def repl(m):
    quote=m.group(1); body=m.group(2)
    return quote+repair(body)+quote
s=re.sub(r'(["\'])(.*?)(?<!\\)\1',repl,s)
p.write_text(s,encoding='utf-8')
print('mojibake repair complete')