const $ = id => document.getElementById(id);
const API = 'http://127.0.0.1:8766';
function setHud({pct=0,state='IDLE',detail='No active campaign',eta=''}){
  const safePct=Math.max(0,Math.min(100,pct));
  $('fill').style.width=`${safePct}%`;
  $('pct').textContent=`${Math.round(safePct)}%`;
  $('state').textContent=state;
  $('detail').textContent=detail;
  $('eta').textContent=eta;
}
function fmt(ms){if(!Number.isFinite(ms)||ms<=0)return '';const m=Math.ceil(ms/60000);return m<60?`${m} min`:`${Math.floor(m/60)} hr ${m%60} min`;}
function finish(ms){if(!Number.isFinite(ms)||ms<=0)return '';return new Date(Date.now()+ms).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});}
async function parallel(){
  const r=await fetch(`${API}/parallel/status`);
  if(!r.ok)throw new Error('no parallel');
  const p=await r.json();
  const workers=p.workers||[];
  const target=Number(p.targetRuns)||workers.length||0;
  const online=workers.filter(w=>w.online).length;
  const speed=Number(p.speed)||0;
  const status=String(p.status||'IDLE');
  if(!target||['STOPPED','STOPPED_UNTRUSTED','OFFLINE'].includes(status)){
    const stopped=status==='STOPPED_UNTRUSTED';
    setHud({state:stopped?'STOPPED · UNTRUSTED':'IDLE',detail:stopped?'No trusted campaign is running':'No active campaign'});
    return true;
  }
  const completed=Number(p.completedRuns)||0;
  const totalTicks=target*406;
  const currentTicks=workers.reduce((sum,w)=>sum+Math.max(0,Math.min(406,Number(w.eventCount)||0)),0);
  const pct=totalTicks?currentTicks/totalTicks*100:0;
  const workerLabel=`${online} active worker${online===1?'':'s'}`;
  const detail=`${completed}/${target} runs complete · ${currentTicks.toLocaleString()}/${totalTicks.toLocaleString()} ticks · ${speed}x`;
  let eta='';
  if(status==='COMPLETED')eta='Campaign complete';
  else if(online>0&&currentTicks>0){
    const started=new Date(p.createdAt).getTime();
    if(Number.isFinite(started)){
      const elapsed=Date.now()-started;
      const remain=elapsed/currentTicks*(totalTicks-currentTicks);
      const duration=fmt(remain),end=finish(remain);
      if(duration&&end)eta=`About ${duration} remaining · finishes ${end}`;
    }
  }
  const state=status==='PAUSED'?'PAUSED':status==='COMPLETED'?'COMPLETED':`RUNNING · ${workerLabel.toUpperCase()}`;
  setHud({pct,state,detail,eta});
  return true;
}
async function update(){try{await parallel();}catch{setHud({state:'IDLE',detail:'No active campaign'});}}
update();setInterval(update,1000);
$('controller').onclick=()=>fetch(`${API}/parallel/controller/open`,{method:'POST'}).catch(()=>{});