import json
import time
import urllib.request
import websocket

pages = json.loads(urllib.request.urlopen('http://127.0.0.1:9222/json').read())
page = next(x for x in pages if x.get('title') == 'FirstSignal Agent')
ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=10)
seq = 0

def call(method, params=None):
    global seq
    seq += 1
    ws.send(json.dumps({'id': seq, 'method': method, 'params': params or {}}))
    while True:
        response = json.loads(ws.recv())
        if response.get('id') == seq:
            return response

call('Page.navigate', {'url': 'http://127.0.0.1:5174/?agentPort=8766'})
time.sleep(3)
state = call('Runtime.evaluate', {'expression': "({body:document.body.innerText.slice(0,600),buttons:[...document.querySelectorAll('button')].map(b=>b.textContent.trim())})", 'returnByValue': True})
print(json.dumps(state, ensure_ascii=True))