const http = require('http');
const WebSocket = require('ws');
http.get('http://127.0.0.1:9223/json', res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>run(JSON.parse(d).find(x=>x.type==='page'&&x.url.includes('5173')))); });
function run(page){
 const ws=new WebSocket(page.webSocketDebuggerUrl); let id=0; const pending=new Map();
 const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
 ws.on('message',raw=>{const m=JSON.parse(raw); if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);} if(m.method==='Runtime.exceptionThrown') console.log('EXCEPTION',JSON.stringify(m.params.exceptionDetails,null,2)); if(m.method==='Runtime.consoleAPICalled') console.log('CONSOLE',m.params.type,m.params.args.map(a=>a.value||a.description)); });
 ws.on('open',async()=>{await send('Runtime.enable');await send('Page.enable');await new Promise(r=>setTimeout(r,1000));
  let r=await send('Runtime.evaluate',{expression:`(()=>({buttons:[...document.querySelectorAll('button')].map(b=>b.innerText),select:document.querySelector('select')?.value,body:document.body.innerText.slice(0,500)}))()`,returnByValue:true});console.log('BEFORE',r.result.value);
  r=await send('Runtime.evaluate',{expression:`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.includes('REPLAY')); if(!b)return 'no replay'; b.click(); return {clicked:true,disabled:b.disabled,text:b.innerText};})()`,returnByValue:true});console.log('CLICK',r.result.value);
  await new Promise(r=>setTimeout(r,7000)); r=await send('Runtime.evaluate',{expression:`(()=>({url:location.href,body:document.body.innerText.slice(0,1200),buttons:[...document.querySelectorAll('button')].map(b=>b.innerText),qa:document.body.innerText.includes('SIM QA AGENT')}))()`,returnByValue:true}); console.log('AFTER',r.result.value); ws.close();
 });
}
