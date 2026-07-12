const content=document.getElementById('content');
const status=document.getElementById('status');
let last='';
async function refresh(){
  try{
    const r=await fetch('http://127.0.0.1:8766/meeting/notepad');
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const data=await r.json();
    document.title=`${data.name||'Meeting'} | FirstSignal Sim`;
    status.textContent=`${data.state||'RUNNING'} · ${data.name||'meeting'} · live refresh`;
    if(data.text!==last){last=data.text;content.textContent=data.text||'Waiting for first memo…';window.scrollTo(0,document.body.scrollHeight);}
  }catch(e){status.textContent=`Waiting for meeting data · ${e.message}`;}
}
setInterval(refresh,750);refresh();