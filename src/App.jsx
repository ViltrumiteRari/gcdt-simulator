import { useState, useEffect, useRef, useCallback } from "react";

const STARTING_BALANCE = 1000;
const BASE_TICK_MS = 4000;
const SESSION_END_H = 16, SESSION_END_M = 0;
const TOTAL_TICKS = 390;
const TRADER_API = "https://firstsignal-os.vercel.app/api/trader";

const T = {
  bg:"#07090c",surface:"#0e1117",surface2:"#141920",border:"#1a2030",
  accent:"#00d4a8",accentDim:"#00d4a818",red:"#ff4060",redDim:"#ff406018",
  yellow:"#f0c040",text:"#dde4f0",muted:"#4a5568",dim:"#1e2530",
  discovery:"#00d4a8",harvest:"#f0c040",transition:"#a78bfa",macro:"#ff4060",
};
const SC = {discovery:T.discovery,harvest:T.harvest,transition:T.transition,macro:T.macro};

// ── MARKET ENGINE ──────────────────────────────────────────────────────────
function createEngine() {
  const A={spot:740.51,gammaFlip:740.0,callWall:750.0,putWall:700.0,fep:738.71,accelerator:6.77,netGex:-777000000,pcr:1.31,iv:15.32};
  const dr={trend:(Math.random()-0.48)*0.55,volMult:0.7+Math.random()*0.9,macroTick:Math.floor(30+Math.random()*220),macroDir:Math.random()>0.5?1:-1,macroPct:0.25+Math.random()*0.55,macroRecovery:Math.random()>0.4,qeBuyTick:Math.floor(140+Math.random()*70),dayType:["discovery","harvest","chop","trend"][Math.floor(Math.random()*4)]};
  let s={spot:A.spot,gammaFlip:A.gammaFlip,callWall:A.callWall,putWall:A.putWall,fep:A.fep,accelerator:A.accelerator,netGex:A.netGex,itsSpy:5.2,itsComposite:5.6,ndf:0.2,dealerPct:35,iv:A.iv,pcr:A.pcr,tick:0,h:9,m:30};
  function tick(){
    const t=s.tick,prog=t/TOTAL_TICKS;
    let d=dr.trend*0.07;
    d+=(s.gammaFlip-s.spot)*(s.netGex<0?0.0025:0.005);
    if(s.spot>s.callWall-2.5)d-=0.15; if(s.spot<s.putWall+2.5)d+=0.15;
    if(dr.dayType==="trend")d+=dr.trend*0.08; if(dr.dayType==="chop")d*=0.4;
    if(dr.dayType==="harvest"&&prog>0.25&&prog<0.75)d*=0.3;
    if(t===dr.macroTick)d+=dr.macroDir*dr.macroPct*0.8;
    if(t>dr.macroTick&&t<dr.macroTick+20)d+=(dr.macroRecovery?-dr.macroDir:dr.macroDir)*0.04*(1-(t-dr.macroTick)/20);
    if(t>=dr.qeBuyTick&&t<dr.qeBuyTick+10)d+=0.07; if(t>=dr.qeBuyTick+10&&t<dr.qeBuyTick+22)d-=0.05;
    if(prog>0.78)d*=0.55; d+=(Math.random()-0.5)*0.32*dr.volMult;
    const ns=Math.max(s.putWall+4,Math.min(s.callWall-0.5,s.spot+d));
    const nf=s.fep*0.87+(ns-(Math.random()-0.45)*1.6)*0.13;
    const mb=(t>=dr.macroTick&&t<dr.macroTick+6)?3.5:0;
    const na=Math.max(1,Math.min(12,s.accelerator*0.8+(2.5+Math.abs(d)*16*dr.volMult)*0.2+mb+(Math.random()-0.5)*0.5));
    const ng=Math.min(600000000,s.netGex*0.998+(Math.random()-0.5)*4000000);
    const mom=(ns-s.spot)/s.spot*1000;
    const ni=Math.max(1,Math.min(12,s.itsSpy*0.72+(5.5+mom*9)*0.28+(Math.random()-0.5)*0.45));
    const nc=Math.max(1,Math.min(12,s.itsComposite*0.84+ni*(0.87+Math.random()*0.2)*0.16+(Math.random()-0.5)*0.28));
    const nn=s.ndf*0.68+(mom*0.55+(Math.random()-0.5)*0.35)*0.32;
    const nd=Math.max(8,Math.min(78,s.dealerPct*0.83+(22+(1-Math.abs(ng)/1800000000)*48)*0.17+(Math.random()-0.5)*2.5));
    const np=Math.max(0.55,Math.min(2.3,s.pcr*0.94+(1.18+(Math.random()-0.5)*0.18)*0.06));
    const niv=Math.max(7,Math.min(38,s.iv*0.91+(11+Math.abs(d)*22)*0.09));
    let{h,m}=s; m++; if(m>=60){m=0;h++;}
    s={...s,spot:ns,fep:nf,accelerator:na,netGex:ng,itsSpy:ni,itsComposite:nc,ndf:nn,dealerPct:nd,pcr:np,iv:niv,tick:t+1,h,m};
    return{...s};
  }
  return{tick,getDrivers:()=>({...dr}),peek:()=>({...s})};
}

// ── STATE PROBS ────────────────────────────────────────────────────────────
function computeProbs(mkt,hist){
  const div=mkt.itsSpy-mkt.itsComposite,ac=mkt.accelerator,fg=mkt.spot-mkt.fep,ndf=mkt.ndf,dl=mkt.dealerPct;
  let D=0,H=0,M=0;
  if(div<-0.3)D+=25; if(div<-0.8)D+=15; if(ac>6)D+=20; if(ac>8)D+=10; if(ndf>0.1)D+=15; if(dl<35)D+=15;
  const l8=hist.slice(-8);
  if(l8.length>=6){const r=Math.max(...l8.map(c=>c.spot))-Math.min(...l8.map(c=>c.spot)); if(r<1.2)H+=30; if(r<0.6)H+=20;}
  if(ac<3.5)H+=20; if(dl>50)H+=20; if(Math.abs(fg)<0.4)H+=10;
  if(hist.length>=3){const rs=hist.slice(-3).map(c=>c.spot),mv=Math.max(...rs.map((s,i)=>i>0?Math.abs(s-rs[i-1]):0)); if(mv>1.5)M+=40; if(mv>2.5)M+=30;}
  if(Math.abs(div)>1.5&&ac>7)M+=20;
  const Tr=Math.max(0,100-(D+H+M)*0.7),tot=D+H+M+Tr;
  return{discovery:Math.round(D/tot*100),harvest:Math.round(H/tot*100),transition:Math.round(Tr/tot*100),macro:Math.round(M/tot*100)};
}

// ── CONFIDENCE ─────────────────────────────────────────────────────────────
function computeConf(mkt,probs,hist){
  const div=mkt.itsSpy-mkt.itsComposite,fg=mkt.spot-mkt.fep;
  let score=50; const factors=[];
  if(div<-0.5){const p=Math.round(Math.abs(div)*15);score+=p;factors.push({label:"Composite leadership",delta:p});}
  else if(div>0.5){const p=-Math.round(div*12);score+=p;factors.push({label:"SPY leading (caution)",delta:p});}
  if(mkt.accelerator>6.5){const p=Math.round((mkt.accelerator-5)*4);score+=p;factors.push({label:"Accelerator building",delta:p});}
  else if(mkt.accelerator<3){const p=-Math.round((4-mkt.accelerator)*5);score+=p;factors.push({label:"Accelerator fading",delta:p});}
  if(Math.abs(fg)<0.3){score+=8;factors.push({label:"FEP aligned",delta:8});}
  else if(fg>1.5){score-=10;factors.push({label:"Spot overextended vs FEP",delta:-10});}
  else if(fg<-1.0){score+=7;factors.push({label:"FEP pulling spot up",delta:7});}
  if(mkt.ndf>0.15){score+=8;factors.push({label:"NDF positive",delta:8});}
  else if(mkt.ndf<-0.15){score-=8;factors.push({label:"NDF negative",delta:-8});}
  if(mkt.dealerPct<30){score+=10;factors.push({label:"Dealer% contracting",delta:10});}
  else if(mkt.dealerPct>60){score-=10;factors.push({label:"Dealer% heavy",delta:-10});}
  const top=Object.entries(probs).sort((a,b)=>b[1]-a[1])[0];
  if(top[1]>65){score+=8;factors.push({label:`${top[0][0].toUpperCase()+top[0].slice(1)} regime clear`,delta:8});}
  else if(top[1]<35){score-=8;factors.push({label:"Regime ambiguous",delta:-8});}
  return{score:Math.max(5,Math.min(98,score)),factors};
}

// ── BSM + STRIKE ───────────────────────────────────────────────────────────
function ncdf(x){const t=1/(1+0.2316419*Math.abs(x)),d=0.3989423*Math.exp(-x*x/2),p=d*t*(0.3193815+t*(-0.3565638+t*(1.7814779+t*(-1.8212560+t*1.3302744))));return x>0?1-p:p;}
function priceOpt(spot,strike,iv,mL,isCall){
  if(mL<=0)return Math.max(0.01,isCall?Math.max(0,spot-strike):Math.max(0,strike-spot));
  const TT=mL/(252*390),sig=iv/100,sq=Math.sqrt(TT),d1=(Math.log(spot/strike)+0.5*sig*sig*TT)/(sig*sq),d2=d1-sig*sq;
  return Math.max(0.01,Math.round((isCall?spot*ncdf(d1)-strike*ncdf(d2):strike*ncdf(-d2)-spot*ncdf(-d1))*100)/100);
}
function findStrike(spot,iv,mL,isCall){
  for(const off of[1,2,3,4,5,0.5,6,7,8]){
    const strike=isCall?Math.round((spot+off)*2)/2:Math.round((spot-off)*2)/2;
    const price=priceOpt(spot,strike,iv,mL,isCall);
    if(price>=0.13&&price<=0.28)return{strike,price};
  }
  return null;
}

// ── AI CALL ────────────────────────────────────────────────────────────────
async function callAI(mkt,pos,bal,hist,probs,conf){
  const tStr=`${mkt.h}:${String(mkt.m).padStart(2,"0")} ET`;
  const mL=(SESSION_END_H*60+SESSION_END_M)-(mkt.h*60+mkt.m);
  const theta=mL<90,div=mkt.itsSpy-mkt.itsComposite;
  const top=Object.entries(probs).sort((a,b)=>b[1]-a[1])[0];
  const callOpt=!theta&&!pos?findStrike(mkt.spot,mkt.iv,mL,true):null;
  const putOpt=!theta&&!pos?findStrike(mkt.spot,mkt.iv,mL,false):null;
  const optStr=callOpt||putOpt?`PRE-PRICED OPTIONS ($0.15-$0.25):\n${callOpt?`CALL: ${callOpt.strike} @ $${callOpt.price.toFixed(2)}`:"CALL: none"}\n${putOpt?`PUT: ${putOpt.strike} @ $${putOpt.price.toFixed(2)}`:"PUT: none"}`:(pos?"MANAGE POSITION":"NO ENTRIES AVAILABLE");
  const rH=hist.slice(-4).map(c=>`${c.t} SPY:${c.spot.toFixed(2)} DIV:${(c.itsSpy-c.itsComp).toFixed(2)} ACCEL:${c.accel.toFixed(1)}`).join("\n");
  const posStr=pos?`OPEN: ${pos.strike}${pos.isCall?"C":"P"} entry $${pos.entry.toFixed(2)} now $${pos.current.toFixed(2)} (${((pos.current/pos.entry-1)*100).toFixed(0)}%)`:"NO POSITION";
  const prompt=`GCDT SPY 0DTE. ONE decision. ${tStr} | ${mL}min | THETA:${theta?"YES":"no"}
BAL:$${bal.toFixed(0)} | ${posStr}
REGIME: ${top[0].toUpperCase()} ${top[1]}% (D:${probs.discovery} H:${probs.harvest} T:${probs.transition} M:${probs.macro})
CONVICTION: ${conf.score}/100 | FACTORS: ${conf.factors.map(f=>f.label+(f.delta>0?"+":"")+f.delta).join(", ")}
SPY:$${mkt.spot.toFixed(2)} | Flip:$${mkt.gammaFlip.toFixed(2)} ${mkt.spot>mkt.gammaFlip?"ABOVE":"BELOW"} | GEX:${(mkt.netGex/1e6).toFixed(0)}M
FEP:$${mkt.fep.toFixed(2)} gap:${(mkt.spot-mkt.fep).toFixed(2)} | DIV:${div.toFixed(2)} ${div<-0.4?"COMP-LEADS":div>0.4?"SPY-LEADS":"CONVERGED"}
ACCEL:${mkt.accelerator.toFixed(2)} | NDF:${mkt.ndf.toFixed(3)}
${optStr}
HISTORY: ${rH}
RULES: Composite leads=conviction entry | SPY leads at resistance=exit | Exit when accel+FEP signal exhaustion | No entries <90min left
Respond ONLY valid JSON:
{"decision":"WAIT|WAITING|BUY_CALL|BUY_PUT|SELL|HOLD","reasoning":"one sentence","mindset":"what signal you watch most","edge_state":"NO_EDGE|CONDITIONS_FORMING|ENTRY_READY|IN_TRADE|EXITING","confidence_trend":"BUILDING|STABLE|DECAYING|UNCLEAR"}`;
  const resp=await fetch(TRADER_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt})});
  if(!resp.ok)throw new Error(`${resp.status}`);
  const data=await resp.json();
  if(!data.decision)throw new Error("bad shape");
  return{...data,callOpt,putOpt};
}

// ── HELPERS ────────────────────────────────────────────────────────────────
const fmt={bal:v=>v>=1e6?`$${(v/1e6).toFixed(3)}M`:v>=1000?`$${(v/1e3).toFixed(1)}K`:`$${v.toFixed(0)}`,pct:v=>`${v>=0?"+":""}${v.toFixed(1)}%`,time:(h,m)=>`${h}:${String(m).padStart(2,"0")}`,gex:v=>`${(v/1e6).toFixed(0)}M`};
function Spark({data,color,h=28,w=100,fill=false}){
  if(!data||data.length<2)return null;
  const mn=Math.min(...data),mx=Math.max(...data),rng=mx-mn||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*w},${h-((v-mn)/rng)*(h-4)-2}`).join(" ");
  return<svg width={w} height={h} style={{display:"block"}}>{fill&&<polygon points={`0,${h} ${pts} ${w},${h}`} fill={color} opacity={0.1}/>}<polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/></svg>;
}

// ── PRICE CHART ─────────────────────────────────────────────────────────────
function PriceChart({candles,gammaFlip,callWall,putWall,position}){
  const ref=useRef(null);
  const[scrollX,setScrollX]=useState(0),[drag,setDrag]=useState(false),[ds,setDs]=useState(0),[ss,setSs]=useState(0),[hov,setHov]=useState(null);
  const W=340,H=130,STEP=8,PT=6,PB=20,PL=6;
  const tot=Math.max(W,candles.length*STEP+PL+6),maxS=Math.max(0,tot-W);
  useEffect(()=>{if(!drag)setScrollX(maxS);},[candles.length,maxS,drag]);
  const sp=candles.map(c=>c.spot),al=[gammaFlip,callWall,putWall,...(sp.length?sp:[740])];
  const mn=Math.min(...al)-1,mx=Math.max(...al)+1,rng=mx-mn||1;
  const toY=v=>PT+((mx-v)/rng)*(H-PT-PB),toX=i=>PL+i*STEP-scrollX;
  const down=e=>{setDrag(true);setDs(e.clientX||e.touches?.[0]?.clientX||0);setSs(scrollX);e.preventDefault();};
  const move=e=>{
    if(!drag)return;
    const cx=e.clientX||e.touches?.[0]?.clientX||0;
    setScrollX(Math.max(0,Math.min(maxS,ss+(ds-cx))));
    const rx=cx-(ref.current?.getBoundingClientRect().left||0)+scrollX;
    const idx=Math.floor((rx-PL)/STEP);
    setHov(idx>=0&&idx<candles.length?idx:null);
  };
  const up=()=>setDrag(false);
  const tli=candles.reduce((a,c,i)=>{if(i%30===0||i===candles.length-1)a.push(i);return a;},[]);
  const hc=hov!==null?candles[hov]:null;
  return(
    <div>
      <div style={{background:T.surface2,borderBottom:`1px solid ${T.border}`,padding:"4px 10px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:9,color:T.muted}}>PRICE</span>
        <span style={{fontSize:11,fontWeight:700,color:T.accent,fontFamily:"monospace"}}>{candles.length>0?candles[candles.length-1].t:"--:--"} ET</span>
        <span style={{fontSize:9,color:T.muted}}>{hc?`${hc.t} · $${hc.spot.toFixed(2)}`:"drag to scroll"}</span>
      </div>
      <div ref={ref} style={{overflow:"hidden",cursor:drag?"grabbing":"grab",touchAction:"none",userSelect:"none"}} onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up} onTouchStart={down} onTouchMove={move} onTouchEnd={up}>
        <svg width={W} height={H} style={{display:"block"}}>
          <rect width={W} height={H} fill={T.surface}/>
          {[{v:callWall,c:T.accent,l:"CW"},{v:gammaFlip,c:T.yellow,l:"FLIP"},{v:putWall,c:T.red,l:"PW"}].map(({v,c,l})=>{const y=toY(v);if(y<PT||y>H-PB)return null;return<g key={l}><line x1={0} y1={y} x2={W} y2={y} stroke={c} strokeWidth={0.5} strokeDasharray="3,3" opacity={0.5}/><text x={W-4} y={y-2} fill={c} fontSize={7} textAnchor="end" opacity={0.8}>{l}</text></g>;})}\n          {candles.length>1&&<polyline points={candles.map((c,i)=>`${toX(i)+4},${toY(c.spot)}`).join(" ")} fill="none" stroke={T.text} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round"/>}
          {candles.length>1&&<polyline points={candles.map((c,i)=>`${toX(i)+4},${toY(c.fep)}`).join(" ")} fill="none" stroke={T.muted} strokeWidth={0.8} strokeDasharray="2,2" opacity={0.4}/>}
          {position&&(()=>{const ei=candles.findIndex(c=>c.t===position.entryTime);if(ei<0)return null;const x=toX(ei)+4,y=toY(candles[ei].spot);return<g><circle cx={x} cy={y} r={4} fill={position.isCall?T.accent:T.red} opacity={0.9}/><line x1={x} y1={y} x2={x} y2={H-PB} stroke={position.isCall?T.accent:T.red} strokeWidth={0.5} strokeDasharray="2,2" opacity={0.4}/></g>;})()}
          {hov!==null&&(()=>{const x=toX(hov)+4,y=toY(candles[hov].spot);if(x<0||x>W)return null;return<g><line x1={x} y1={PT} x2={x} y2={H-PB} stroke={T.muted} strokeWidth={0.5} opacity={0.5}/><circle cx={x} cy={y} r={3} fill={T.text}/></g>;})()}
          {candles.length>0&&(()=>{const x=toX(candles.length-1)+4,y=toY(candles[candles.length-1].spot);if(x<0||x>W)return null;return<circle cx={x} cy={y} r={3} fill={T.accent}/>;})()}
          {tli.map(i=>{const x=toX(i)+4;if(x<20||x>W-20)return null;return<text key={i} x={x} y={H-5} fill={T.muted} fontSize={7} textAnchor="middle">{candles[i].t}</text>;})}
        </svg>
      </div>
      {maxS>0&&<div style={{height:2,background:T.dim,margin:"0 8px"}}><div style={{height:"100%",width:`${(W/tot)*100}%`,marginLeft:`${(scrollX/tot)*100}%`,background:T.muted,borderRadius:1}}/></div>}
    </div>
  );
}

// ── STATE BARS ──────────────────────────────────────────────────────────────
function StateBars({probs}){
  return(
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px 16px"}}>
      {Object.entries(probs).map(([s,p])=>(
        <div key={s}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
            <span style={{fontSize:9,color:SC[s],letterSpacing:"0.08em",textTransform:"uppercase"}}>{s}</span>
            <span style={{fontSize:10,fontWeight:700,color:SC[s]}}>{p}%</span>
          </div>
          <div style={{height:3,background:T.dim,borderRadius:2}}><div style={{height:"100%",width:`${p}%`,background:SC[s],borderRadius:2,transition:"width 0.5s"}}/></div>
        </div>
      ))}
    </div>
  );
}

// ── STORAGE ────────────────────────────────────────────────────────────────
const SK="gcdt_v4_sessions";
function loadS(){try{return JSON.parse(localStorage.getItem(SK)||"[]");}catch{return[];}}
function saveS(s){try{localStorage.setItem(SK,JSON.stringify(s));}catch{}}

// ── APP ────────────────────────────────────────────────────────────────────
export default function App(){
  const[screen,setScreen]=useState("home");
  const[running,setRunning]=useState(false);
  const[mkt,setMkt]=useState(null);
  const[pos,setPos]=useState(null);
  const[bal,setBal]=useState(STARTING_BALANCE);
  const[tradeLog,setTradeLog]=useState([]);
  const[mindsetLog,setMindsetLog]=useState([]);
  const[candles,setCandles]=useState([]);
  const[confHist,setConfHist]=useState([]);
  const[probs,setProbs]=useState({discovery:25,harvest:25,transition:25,macro:25});
  const[confData,setConfData]=useState({score:50,factors:[]});
  const[timeline,setTimeline]=useState([]);
  const[thinking,setThinking]=useState(false);
  const[done,setDone]=useState(false);
  const[speed,setSpeed]=useState(1);
  const[aiFreq,setAiFreq]=useState(8);
  const[sessions,setSessions]=useState(loadS);
  const[reviewSess,setReviewSess]=useState(null);
  const[saved,setSaved]=useState(false);
  const[dayType,setDayType]=useState("—");

  const engR=useRef(null),balR=useRef(STARTING_BALANCE),posR=useRef(null),logR=useRef([]),candR=useRef([]);
  const mindR=useRef([]),tlR=useRef([]),probR=useRef({discovery:25,harvest:25,transition:25,macro:25});
  const confR=useRef({score:50,factors:[]}),tickR=useRef(0),thinkR=useRef(false),ivR=useRef(null),lastSR=useRef("transition");

  const addM=useCallback(e=>{mindR.current=[...mindR.current.slice(-60),e];setMindsetLog([...mindR.current]);},[]);

  const doTick=useCallback(eng=>{
    const m=eng.tick(); tickR.current++;
    const mL=(SESSION_END_H*60+SESSION_END_M)-(m.h*60+m.m);
    if(posR.current){const np=priceOpt(m.spot,posR.current.strike,m.iv,mL,posR.current.isCall);posR.current={...posR.current,current:np};setPos({...posR.current});}
    if(m.h>=SESSION_END_H){
      if(posR.current){const p=posR.current,r=(p.current/p.entry-1)*100;balR.current*=(1+r/100);logR.current=[...logR.current,{t:"16:00",action:`AUTO-CLOSE ${p.strike}${p.isCall?"C":"P"}`,result:fmt.pct(r),pnl:r}];setTradeLog([...logR.current]);posR.current=null;setPos(null);}
      setBal(balR.current);setDone(true);setRunning(false);clearInterval(ivR.current);return;
    }
    setMkt(m);setBal(balR.current);
    const c={t:fmt.time(m.h,m.m),spot:m.spot,itsSpy:m.itsSpy,itsComp:m.itsComposite,accel:m.accelerator,fep:m.fep};
    candR.current=[...candR.current.slice(-200),c];setCandles([...candR.current]);
    const np=computeProbs(m,candR.current),nc=computeConf(m,np,candR.current);
    probR.current=np;confR.current=nc;setProbs({...np});setConfData({...nc});
    setConfHist(prev=>[...prev.slice(-120),nc.score]);
    const top=Object.entries(np).sort((a,b)=>b[1]-a[1])[0][0];
    if(top!==lastSR.current){lastSR.current=top;const te={t:fmt.time(m.h,m.m),state:top,probs:{...np}};tlR.current=[...tlR.current,te];setTimeline([...tlR.current]);}
    if(tickR.current%aiFreq===0&&!thinkR.current){
      thinkR.current=true;setThinking(true);
      callAI(m,posR.current,balR.current,candR.current,probR.current,confR.current)
        .then(dec=>{
          const ts=fmt.time(m.h,m.m),mLn=(SESSION_END_H*60+SESSION_END_M)-(m.h*60+m.m);
          addM({t:ts,mindset:dec.mindset||"—",reasoning:dec.reasoning||"—",decision:dec.decision,score:confR.current.score,edgeState:dec.edge_state||"—",confTrend:dec.confidence_trend||"—"});
          if(dec.decision==="SELL"&&posR.current){const p=posR.current,r=(p.current/p.entry-1)*100;balR.current*=(1+r/100);setBal(balR.current);logR.current=[...logR.current,{t:ts,action:`SELL ${p.strike}${p.isCall?"C":"P"} @$${p.current.toFixed(2)}`,result:fmt.pct(r),pnl:r}];setTradeLog([...logR.current]);posR.current=null;setPos(null);}
          else if((dec.decision==="BUY_CALL"||dec.decision==="BUY_PUT")&&!posR.current&&mLn>=90){
            const isC=dec.decision==="BUY_CALL",opt=isC?dec.callOpt:dec.putOpt;
            if(opt){posR.current={strike:opt.strike,isCall:isC,entry:opt.price,current:opt.price,entryTime:ts,entrySpot:m.spot};setPos({...posR.current});logR.current=[...logR.current,{t:ts,action:`${isC?"BUY CALL":"BUY PUT"} ${opt.strike}${isC?"C":"P"} @$${opt.price.toFixed(2)}`,result:null}];setTradeLog([...logR.current]);}
          }
        })
        .catch(e=>addM({t:fmt.time(m.h,m.m),mindset:"API error",reasoning:e.message,decision:"WAIT",score:0,edgeState:"—",confTrend:"—"}))
        .finally(()=>{thinkR.current=false;setThinking(false);});
    }
  },[aiFreq,addM]);

  useEffect(()=>{
    if(!running||!engR.current)return;
    ivR.current=setInterval(()=>doTick(engR.current),Math.max(200,BASE_TICK_MS/speed));
    return()=>clearInterval(ivR.current);
  },[running,speed,doTick]);

  const start=useCallback(()=>{
    engR.current=createEngine();const dr=engR.current.getDrivers(),init=engR.current.peek();
    setDayType(dr.dayType);setMkt(init);setBal(STARTING_BALANCE);balR.current=STARTING_BALANCE;
    setPos(null);posR.current=null;setTradeLog([]);logR.current=[];setMindsetLog([]);mindR.current=[];
    setCandles([]);candR.current=[];setConfHist([]);setProbs({discovery:25,harvest:25,transition:25,macro:25});
    setConfData({score:50,factors:[]});setTimeline([]);tlR.current=[];lastSR.current="transition";
    tickR.current=0;thinkR.current=false;setDone(false);setSaved(false);setRunning(true);setScreen("trading");
  },[]);

  const fastFwd=useCallback(()=>{
    if(!engR.current)return;clearInterval(ivR.current);setRunning(false);
    const eng=engR.current;let m=eng.peek();
    while(!(m.h>=SESSION_END_H)){m=eng.tick();tickR.current++;const mL=(SESSION_END_H*60+SESSION_END_M)-(m.h*60+m.m);if(posR.current){const np=priceOpt(m.spot,posR.current.strike,m.iv,mL,posR.current.isCall);posR.current={...posR.current,current:np};}}
    if(posR.current){const p=posR.current,r=(p.current/p.entry-1)*100;balR.current*=(1+r/100);logR.current=[...logR.current,{t:"16:00",action:`AUTO-CLOSE ${p.strike}${p.isCall?"C":"P"}`,result:fmt.pct(r),pnl:r}];setTradeLog([...logR.current]);posR.current=null;setPos(null);}
    setMkt(m);setBal(balR.current);setDone(true);
  },[]);

  const saveSession=useCallback(()=>{
    const r=((balR.current-STARTING_BALANCE)/STARTING_BALANCE)*100,cl=logR.current.filter(l=>l.pnl!==undefined),ws=cl.filter(l=>(l.pnl||0)>=0);
    const sess={id:Date.now(),name:`SIM-${String(sessions.length+1).padStart(2,"0")} · ${dayType} · ${r>=0?"+":""}${r.toFixed(0)}%`,date:new Date().toLocaleDateString(),balance:balR.current,returnPct:r,trades:logR.current,mindset:mindR.current,timeline:tlR.current,winRate:cl.length>0?`${ws.length}/${cl.length}`:"—",dayType};
    const upd=[sess,...sessions];setSessions(upd);saveS(upd);setSaved(true);
  },[sessions,dayType]);

  const pnl=((bal-STARTING_BALANCE)/STARTING_BALANCE)*100;
  const topS=Object.entries(probs).sort((a,b)=>b[1]-a[1])[0];
  const posPnl=pos?(pos.current/pos.entry-1)*100:0;
  const mLeft=mkt?(SESSION_END_H*60+SESSION_END_M)-(mkt.h*60+mkt.m):390;
  const lastM=mindsetLog[mindsetLog.length-1];
  if(screen==="home")return(
    <div style={{background:T.bg,minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"monospace"}}>
      <div style={{fontSize:9,color:T.muted,letterSpacing:"0.2em",marginBottom:8}}>FIRSTSIGNAL OS v3</div>
      <div style={{fontSize:28,fontWeight:700,color:T.accent,marginBottom:4}}>GCDT</div>
      <div style={{fontSize:10,color:T.muted,marginBottom:32,textAlign:"center"}}>GEX Composite Divergence Trading<br/>AI-isolated · Haiku · $1K start</div>
      <button onClick={start} style={{width:"100%",maxWidth:280,padding:"14px 0",background:T.accent,color:T.bg,border:"none",borderRadius:6,fontFamily:"monospace",fontSize:13,fontWeight:700,cursor:"pointer",marginBottom:12}}>BEGIN SESSION</button>
      <button onClick={()=>setScreen("sessions")} style={{width:"100%",maxWidth:280,padding:"12px 0",background:"transparent",color:T.muted,border:`1px solid ${T.border}`,borderRadius:6,fontFamily:"monospace",fontSize:11,cursor:"pointer"}}>SESSION LIBRARY ({sessions.length})</button>
      {sessions.length>0&&<div style={{marginTop:24,width:"100%",maxWidth:280,padding:"10px 12px",background:T.surface,borderRadius:6,border:`1px solid ${T.border}`}}><div style={{fontSize:9,color:T.muted,marginBottom:4}}>LAST SESSION</div><div style={{fontSize:10,color:T.text}}>{sessions[0].name}</div><div style={{fontSize:9,color:T.muted,marginTop:2}}>{sessions[0].date} · {sessions[0].winRate}</div></div>}
    </div>
  );

  if(screen==="sessions")return(
    <div style={{background:T.bg,minHeight:"100vh",fontFamily:"monospace",color:T.text}}>
      <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:"12px 16px",display:"flex",alignItems:"center",gap:12}}>
        <button onClick={()=>setScreen("home")} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:16}}>←</button>
        <span style={{fontSize:12,fontWeight:700,color:T.accent}}>SESSION LIBRARY</span>
      </div>
      <div style={{padding:16}}>
        {sessions.length===0&&<div style={{color:T.muted,fontSize:11,textAlign:"center",marginTop:60}}>No sessions yet.</div>}
        {sessions.map(s=>(
          <div key={s.id} onClick={()=>{setReviewSess(s);setScreen("review");}} style={{padding:"12px 14px",background:T.surface,borderRadius:6,border:`1px solid ${T.border}`,marginBottom:10,cursor:"pointer"}}>
            <div style={{fontSize:11,color:T.text,marginBottom:3}}>{s.name}</div>
            <div style={{display:"flex",gap:12}}><span style={{fontSize:9,color:T.muted}}>{s.date}</span><span style={{fontSize:9,color:s.returnPct>=0?T.accent:T.red}}>{fmt.pct(s.returnPct)}</span><span style={{fontSize:9,color:T.muted}}>W/L {s.winRate}</span><span style={{fontSize:9,color:T.muted}}>{s.dayType}</span></div>
          </div>
        ))}
      </div>
    </div>
  );

  if(screen==="review"&&reviewSess){
    const s=reviewSess;
    return(
      <div style={{background:T.bg,minHeight:"100vh",fontFamily:"monospace",color:T.text}}>
        <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:"12px 16px",display:"flex",alignItems:"center",gap:12}}>
          <button onClick={()=>setScreen("sessions")} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:16}}>←</button>
          <span style={{fontSize:11,color:T.accent,fontWeight:700}}>{s.name}</span>
        </div>
        <div style={{padding:16}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
            {[["FINAL",fmt.bal(s.balance)],["RETURN",fmt.pct(s.returnPct)],["WIN RATE",s.winRate],["DAY TYPE",s.dayType]].map(([l,v])=>(
              <div key={l} style={{padding:"10px 12px",background:T.surface,borderRadius:6,border:`1px solid ${T.border}`}}><div style={{fontSize:9,color:T.muted,marginBottom:3}}>{l}</div><div style={{fontSize:13,fontWeight:700,color:T.text}}>{v}</div></div>
            ))}
          </div>
          {s.timeline?.length>0&&<><div style={{fontSize:10,color:T.muted,marginBottom:8}}>REGIME TIMELINE</div>{s.timeline.map((r,i)=><div key={i} style={{fontSize:10,padding:"4px 10px",marginBottom:4,borderLeft:`2px solid ${SC[r.state]}`,color:SC[r.state]}}>{r.t} → {r.state.toUpperCase()}</div>)}</>}
          <div style={{fontSize:10,color:T.muted,marginTop:12,marginBottom:8}}>TRADES</div>
          {s.trades.map((t,i)=><div key={i} style={{padding:"8px 12px",background:T.surface,borderRadius:4,border:`1px solid ${(t.pnl||0)>=0?T.accent+"40":T.red+"40"}`,marginBottom:6}}><div style={{fontSize:10,color:T.text}}>{t.action}</div><div style={{fontSize:9,color:(t.pnl||0)>=0?T.accent:T.red}}>{t.t} {t.result}</div></div>)}
        </div>
      </div>
    );
  }
  return(
    <div style={{background:T.bg,minHeight:"100vh",fontFamily:"monospace",color:T.text,display:"flex",flexDirection:"column"}}>
      <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:"8px 14px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:running?T.accent:done?T.muted:T.yellow,boxShadow:running?`0 0 6px ${T.accent}`:"none"}}/>
            <span style={{fontSize:10,fontWeight:700,color:T.accent}}>GCDT · FS OS v3</span>
            {thinking&&<span style={{fontSize:9,color:T.yellow}}>◈</span>}
          </div>
          <div style={{display:"flex",gap:6}}>
            {running&&<><button onClick={fastFwd} style={{padding:"4px 8px",background:"#f0c04018",color:T.yellow,border:`1px solid ${T.yellow}40`,borderRadius:3,fontFamily:"monospace",fontSize:9,cursor:"pointer"}}>END</button><button onClick={()=>{setRunning(false);clearInterval(ivR.current);}} style={{padding:"4px 8px",background:T.redDim,color:T.red,border:`1px solid ${T.red}40`,borderRadius:3,fontFamily:"monospace",fontSize:9,cursor:"pointer"}}>PAUSE</button></>}
            {!running&&!done&&mkt&&<button onClick={()=>setRunning(true)} style={{padding:"4px 10px",background:T.accentDim,color:T.accent,border:`1px solid ${T.accent}40`,borderRadius:3,fontFamily:"monospace",fontSize:9,cursor:"pointer"}}>RESUME</button>}
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          {mkt&&<span style={{fontSize:11,color:T.muted,fontWeight:700}}>{fmt.time(mkt.h,mkt.m)} ET</span>}
          {mLeft<90&&<span style={{fontSize:9,color:T.red}}>THETA</span>}
          <span style={{fontSize:14,fontWeight:700,color:pnl>=0?T.accent:T.red}}>{fmt.bal(bal)}</span>
          <span style={{fontSize:10,color:pnl>=0?T.accent:T.red}}>{fmt.pct(pnl)}</span>
          <span style={{fontSize:9,color:SC[topS[0]],marginLeft:"auto"}}>{topS[0].toUpperCase()} {topS[1]}%</span>
        </div>
      </div>

      {pos&&<div style={{margin:"8px 14px 0",padding:"8px 12px",background:posPnl>=0?T.accentDim:T.redDim,border:`1px solid ${posPnl>=0?T.accent:T.red}40`,borderRadius:6,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><div style={{fontSize:9,color:T.muted}}>OPEN · {pos.entryTime}</div><div style={{fontSize:13,fontWeight:700}}>{pos.strike}{pos.isCall?"C":"P"} · ${pos.entry.toFixed(2)}</div></div>
        <div style={{textAlign:"right"}}><div style={{fontSize:16,fontWeight:700,color:posPnl>=0?T.accent:T.red}}>${pos.current.toFixed(2)}</div><div style={{fontSize:10,color:posPnl>=0?T.accent:T.red}}>{fmt.pct(posPnl)}</div></div>
      </div>}

      <div style={{flex:1,overflowY:"auto",paddingBottom:20}}>
        {mkt&&<div style={{background:T.surface,borderRadius:8,border:`1px solid ${T.border}`,margin:"10px 14px",overflow:"hidden"}}>
          <PriceChart candles={candles} gammaFlip={mkt.gammaFlip} callWall={mkt.callWall} putWall={mkt.putWall} position={pos}/>
          <div style={{padding:"8px 12px",borderTop:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between"}}>
            <div><div style={{fontSize:20,fontWeight:700}}>${mkt.spot.toFixed(2)}</div><div style={{fontSize:9,color:mkt.spot>mkt.gammaFlip?T.accent:T.red}}>{mkt.spot>mkt.gammaFlip?"▲ ABOVE":"▼ BELOW"} FLIP ${mkt.gammaFlip}</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:11,fontWeight:700,color:mkt.netGex<0?T.red:T.accent}}>{fmt.gex(mkt.netGex)}</div><div style={{fontSize:8,color:mkt.netGex<0?T.red:T.accent}}>{mkt.netGex<0?"AMPLIFY":"PINNING"}</div><div style={{fontSize:9,color:T.muted}}>FEP ${mkt.fep.toFixed(2)}</div></div>
          </div>
        </div>}

        {mkt&&<div style={{background:T.surface,borderRadius:8,border:`1px solid ${T.border}`,margin:"0 14px 10px",padding:12}}>
          <div style={{fontSize:9,color:T.muted,letterSpacing:"0.1em",marginBottom:10}}>REGIME STATE</div>
          <StateBars probs={probs}/>
          <div style={{height:1,background:T.border,margin:"12px 0"}}/>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <span style={{fontSize:9,color:T.muted,letterSpacing:"0.1em"}}>CONVICTION</span>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              {lastM&&<span style={{fontSize:9,color:lastM.confTrend==="BUILDING"?T.accent:lastM.confTrend==="DECAYING"?T.red:T.yellow}}>{lastM.confTrend}</span>}
              <span style={{fontSize:18,fontWeight:700,color:confData.score>65?T.accent:confData.score<40?T.red:T.yellow}}>{confData.score}</span>
            </div>
          </div>
          <Spark data={confHist} color={confData.score>65?T.accent:confData.score<40?T.red:T.yellow} h={44} w={308} fill={true}/>
          {confData.factors.length>0&&<div style={{marginTop:10}}>
            {confData.factors.slice(0,5).map((f,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3,paddingBottom:3,borderBottom:i<confData.factors.length-1?`1px solid ${T.dim}`:"none"}}>
                <span style={{fontSize:9,color:T.muted}}>{f.label}</span>
                <span style={{fontSize:10,fontWeight:700,color:f.delta>0?T.accent:T.red}}>{f.delta>0?"+":""}{f.delta}</span>
              </div>
            ))}
          </div>}
        </div>}
        {mkt&&<div style={{background:T.surface,borderRadius:8,border:`1px solid ${T.border}`,margin:"0 14px 10px",padding:12}}>
          <div style={{fontSize:9,color:T.muted,letterSpacing:"0.1em",marginBottom:8}}>COMPOSITE DIVERGENCE</div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div>
              <div style={{fontSize:22,fontWeight:700,color:(mkt.itsSpy-mkt.itsComposite)>0.5?T.red:(mkt.itsSpy-mkt.itsComposite)<-0.5?T.accent:T.yellow}}>{(mkt.itsSpy-mkt.itsComposite)>=0?"+":""}{(mkt.itsSpy-mkt.itsComposite).toFixed(2)}</div>
              <div style={{fontSize:8,color:T.muted}}>{Math.abs(mkt.itsSpy-mkt.itsComposite)<0.3?"CONVERGED":mkt.itsSpy-mkt.itsComposite>0.5?"SPY LEADING":"COMP LEADING"}</div>
            </div>
            <div style={{display:"flex",gap:14,textAlign:"center"}}>
              {[["SPY",mkt.itsSpy.toFixed(2),T.text],["COMP",mkt.itsComposite.toFixed(2),T.accent],["ACCEL",mkt.accelerator.toFixed(2),T.yellow]].map(([l,v,c])=>(
                <div key={l}><div style={{fontSize:8,color:T.muted,marginBottom:2}}>{l}</div><div style={{fontSize:13,fontWeight:700,color:c}}>{v}</div></div>
              ))}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            {[["NDF",(mkt.ndf>=0?"+":"")+mkt.ndf.toFixed(3),mkt.ndf>0.1?T.accent:mkt.ndf<-0.1?T.red:T.muted],["FEP GAP",(mkt.spot-mkt.fep>=0?"+":"")+(mkt.spot-mkt.fep).toFixed(2),Math.abs(mkt.spot-mkt.fep)>1.5?T.yellow:T.muted],["IV",mkt.iv.toFixed(1)+"%",T.muted]].map(([l,v,c])=>(
              <div key={l}><div style={{fontSize:8,color:T.muted}}>{l}</div><div style={{fontSize:12,fontWeight:700,color:c}}>{v}</div></div>
            ))}
          </div>
        </div>}

        {timeline.length>0&&<div style={{background:T.surface,borderRadius:8,border:`1px solid ${T.border}`,margin:"0 14px 10px",padding:12}}>
          <div style={{fontSize:9,color:T.muted,letterSpacing:"0.1em",marginBottom:8}}>REGIME TIMELINE</div>
          {timeline.map((r,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:10,marginBottom:5}}>
              <span style={{fontSize:9,color:T.muted,minWidth:38}}>{r.t}</span>
              <div style={{width:3,height:14,background:SC[r.state],borderRadius:2,flexShrink:0}}/>
              <span style={{fontSize:10,color:SC[r.state],fontWeight:700}}>{r.state.toUpperCase()}</span>
              <span style={{fontSize:9,color:T.muted,marginLeft:"auto"}}>D:{r.probs.discovery}% H:{r.probs.harvest}%</span>
            </div>
          ))}
        </div>}

        <div style={{background:T.surface,borderRadius:8,border:`1px solid ${T.border}`,margin:"0 14px 10px",padding:12}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
            <div style={{fontSize:9,color:T.muted,letterSpacing:"0.1em"}}>AI MINDSET</div>
            {thinking&&<div style={{fontSize:9,color:T.yellow}}>◈ deciding...</div>}
          </div>
          {mindsetLog.length===0&&<div style={{fontSize:10,color:T.dim,textAlign:"center",padding:"12px 0"}}>Waiting for first decision...</div>}
          {[...mindsetLog].reverse().slice(0,5).map((e,i)=>(
            <div key={i} style={{marginBottom:8,padding:"8px 10px",borderRadius:4,background:T.surface2,borderLeft:`2px solid ${e.decision?.includes("BUY")?T.yellow:e.decision==="SELL"?T.accent:e.edgeState==="NO_EDGE"?T.red:T.border}`}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                <span style={{fontSize:8,color:T.muted}}>{e.t}</span>
                <span style={{fontSize:8,color:T.muted}}>{e.edgeState} [{e.score}/100]</span>
              </div>
              <div style={{fontSize:10,color:T.yellow,marginBottom:2}}>👁 {e.mindset}</div>
              <div style={{fontSize:9,color:T.muted}}>{e.reasoning}</div>
            </div>
          ))}
        </div>

        {tradeLog.length>0&&<div style={{background:T.surface,borderRadius:8,border:`1px solid ${T.border}`,margin:"0 14px 10px",padding:12}}>
          <div style={{fontSize:9,color:T.muted,letterSpacing:"0.1em",marginBottom:8}}>TRADE LOG</div>
          {tradeLog.map((t,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",marginBottom:6,paddingBottom:6,borderBottom:i<tradeLog.length-1?`1px solid ${T.dim}`:"none"}}>
              <div><div style={{fontSize:10,color:T.text}}>{t.action}</div><div style={{fontSize:8,color:T.muted}}>{t.t}</div></div>
              {t.result&&<div style={{fontSize:11,fontWeight:700,color:(t.pnl||0)>=0?T.accent:T.red}}>{t.result}</div>}
            </div>
          ))}
        </div>}

        <div style={{background:T.surface,borderRadius:8,border:`1px solid ${T.border}`,margin:"0 14px 10px",padding:12}}>
          <div style={{fontSize:9,color:T.muted,marginBottom:6}}>SPEED · {speed}x</div>
          <input type="range" min="0.5" max="10" step="0.5" value={speed} onChange={e=>setSpeed(Number(e.target.value))} style={{width:"100%",accentColor:T.accent,marginBottom:10}}/>
          <div style={{fontSize:9,color:T.muted,marginBottom:6}}>AI EVERY</div>
          <div style={{display:"flex",gap:6}}>
            {[5,8,12,20].map(n=><button key={n} onClick={()=>setAiFreq(n)} style={{flex:1,padding:"5px 0",background:aiFreq===n?T.accent:"transparent",color:aiFreq===n?T.bg:T.muted,border:`1px solid ${aiFreq===n?T.accent:T.border}`,borderRadius:3,fontFamily:"monospace",fontSize:9,cursor:"pointer"}}>{n}t</button>)}
          </div>
        </div>

        {done&&<div style={{background:pnl>=0?T.accentDim:T.redDim,borderRadius:8,border:`1px solid ${pnl>=0?T.accent:T.red}40`,margin:"0 14px 10px",padding:16,textAlign:"center"}}>
          <div style={{fontSize:10,color:T.muted,marginBottom:4}}>SESSION COMPLETE · {dayType.toUpperCase()}</div>
          <div style={{fontSize:28,fontWeight:700,color:pnl>=0?T.accent:T.red}}>{fmt.bal(bal)}</div>
          <div style={{fontSize:14,color:pnl>=0?T.accent:T.red,marginBottom:16}}>{fmt.pct(pnl)}</div>
          <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
            <button onClick={saveSession} disabled={saved} style={{padding:"8px 14px",background:saved?T.accentDim:T.accent,color:saved?T.accent:T.bg,border:saved?`1px solid ${T.accent}`:"none",borderRadius:4,fontFamily:"monospace",fontSize:10,cursor:"pointer",fontWeight:700}}>{saved?"✓ SAVED":"SAVE SESSION"}</button>
            <button onClick={()=>{if(!saved)saveSession();setScreen("home");}} style={{padding:"8px 14px",background:"transparent",color:T.muted,border:`1px solid ${T.border}`,borderRadius:4,fontFamily:"monospace",fontSize:10,cursor:"pointer"}}>HOME</button>
            <button onClick={start} style={{padding:"8px 14px",background:T.surface2,color:T.text,border:`1px solid ${T.border}`,borderRadius:4,fontFamily:"monospace",fontSize:10,cursor:"pointer"}}>NEW SESSION</button>
          </div>
        </div>}
      </div>
      <style>{`::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:${T.border};border-radius:2px}input[type=range]{height:3px}`}</style>
    </div>
  );
}
