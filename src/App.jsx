import { useState, useEffect, useRef, useCallback } from "react";

const STARTING_BALANCE = 1000;
const BASE_TICK_MS = 4000;
const SESSION_END_H = 16, SESSION_END_M = 0;
const OPEN_H = 9, OPEN_M = 30;
const TRADER_API = "https://firstsignal-os.vercel.app/api/trader";

const REAL_SEED = {
  spot: 746.51, prevClose: 746.56, premktOpen: 741.26,
  gammaFlip: 745.0, callWall: 750.0, putWall: 720.0,
  fep: 746.40, accelerator: 7.36, iv: 12.62,
  expectedMove: 4.93, pcr: 0.88,
  netGex: 10722483844,
  charmNet: -2653895466,
};

function wRand(choices) {
  const r = Math.random(); let cum = 0;
  for (const [val, w] of choices) { cum += w; if (r < cum) return val; }
  return choices[choices.length-1][0];
}

function createEngine(seed = REAL_SEED) {
  const session = {
    dayType: wRand([["pin",0.28],["trend_up",0.14],["trend_down",0.12],["chop",0.18],["macro_shock",0.10],["squeeze",0.09],["reversal",0.09]]),
    macroTick: Math.floor(20 + Math.random() * 200),
    macroMag: (Math.random() > 0.5 ? 1 : -1) * (1.8 + Math.random() * 3.2),
    macroRecovery: Math.random() > 0.45,
    squeezeTick: Math.floor(60 + Math.random() * 160),
    squeezeDir: Math.random() > 0.5 ? 1 : -1,
    charmDecayRate: 0.003 + Math.random() * 0.004,
    gexDominance: 0.35 + Math.random() * 0.55,
    fakeoutTick: Math.floor(35 + Math.random() * 140),
    hasFakeout: Math.random() > 0.5,
    volLevel: Math.random(),
  };
  let s = {
    spot: seed.premktOpen, gammaFlip: seed.gammaFlip, callWall: seed.callWall, putWall: seed.putWall,
    fep: seed.fep - (seed.spot - seed.premktOpen) * 0.3, accelerator: 3.8, netGex: seed.netGex,
    itsSpy: 4.5, itsComposite: 4.8, ndf: 0.12, dealerPct: 22, iv: seed.iv * 1.18,
    pcr: seed.pcr, gexInfluence: 0.08, tick: 0, h: 9, m: 20, isPremarket: true, isTradeable: false,
  };
  function gexInfAt(tick) {
    const isPost = s.h > OPEN_H || (s.h === OPEN_H && s.m >= OPEN_M);
    if (!isPost) return 0.08;
    const st = tick - 10, prog = Math.max(0, st / 390);
    const bell = Math.sin(prog * Math.PI) * 0.85 + 0.15;
    const decay = Math.exp(-session.charmDecayRate * st);
    return Math.min(0.95, bell * session.gexDominance * decay + (1 - decay) * 0.08);
  }
  function tick() {
    const t = s.tick;
    const isPremarket = s.h < OPEN_H || (s.h === OPEN_H && s.m < OPEN_M);
    const gexInf = gexInfAt(t);
    const isPositiveGex = s.netGex > 0;
    const sessionTick = isPremarket ? 0 : t - 10;
    const prog = Math.max(0, sessionTick / 390);
    const volBase = isPremarket ? 0.38 : 0.92 * Math.exp(-prog * 2.8) + 0.22 + (prog > 0.78 ? (prog - 0.78) * 0.9 : 0);
    const volMult = volBase * (0.65 + session.volLevel * 0.7);
    let drift = 0;
    if (isPremarket) { drift = (seed.spot - s.spot) * 0.09 + (Math.random() - 0.5) * 0.16; }
    else {
      switch (session.dayType) {
        case "pin": drift = (s.gammaFlip - s.spot) * 0.012 * gexInf; break;
        case "trend_up": drift = 0.07 + Math.random() * 0.05; break;
        case "trend_down": drift = -0.07 - Math.random() * 0.05; break;
        case "chop": drift = Math.sin(sessionTick * 0.25) * 0.06; break;
        case "squeeze": drift = s.spot < s.callWall ? 0.08 : -0.05; break;
        case "reversal": drift = prog < 0.38 ? 0.08 : -0.10; break;
        default: drift = (Math.random() - 0.5) * 0.05;
      }
    }
    let gexForce = 0;
    if (!isPremarket) {
      if (isPositiveGex) {
        gexForce += (s.gammaFlip - s.spot) * 0.007 * gexInf;
        if (s.spot > s.callWall - 2.5) gexForce -= (s.spot - (s.callWall - 2.5)) * 0.09 * gexInf;
        if (s.spot < s.putWall + 2.5) gexForce += ((s.putWall + 2.5) - s.spot) * 0.07 * gexInf;
      } else {
        gexForce -= (s.gammaFlip - s.spot) * 0.004 * gexInf;
        if (s.spot > s.callWall - 0.8) gexForce += 0.14 * gexInf;
        if (s.spot < s.putWall + 0.8) gexForce -= 0.12 * gexInf;
      }
    }
    let macroForce = 0;
    if (!isPremarket && t === session.macroTick + 10) macroForce = session.macroMag * 0.85;
    if (!isPremarket && t > session.macroTick + 10 && t < session.macroTick + 24)
      macroForce = (session.macroRecovery ? -session.macroMag : session.macroMag) * 0.055 * (1 - (t - session.macroTick - 10) / 14);
    let squeezeForce = 0;
    if (!isPremarket && session.dayType === "squeeze" && t >= session.squeezeTick && t < session.squeezeTick + 6)
      squeezeForce = session.squeezeDir * (0.28 + Math.random() * 0.18);
    let fakeoutForce = 0;
    if (!isPremarket && session.hasFakeout) {
      if (t >= session.fakeoutTick && t < session.fakeoutTick + 4) fakeoutForce = -drift * 2.8;
      else if (t >= session.fakeoutTick + 4 && t < session.fakeoutTick + 10) fakeoutForce = drift * 2.0;
    }
    const mLeft = (SESSION_END_H * 60) - (s.h * 60 + s.m);
    const thetaMult = mLeft < 90 ? 0.50 + (mLeft / 90) * 0.50 : 1.0;
    const noise = (Math.random() - 0.5) * 0.40 * volMult * thetaMult;
    const dSpot = (drift + gexForce + macroForce + squeezeForce + fakeoutForce) * thetaMult + noise;
    const newSpot = Math.max(s.putWall - (isPositiveGex?1:3), Math.min(s.callWall + (isPositiveGex?0.5:3.5), s.spot + dSpot));
    const newFep = s.fep * 0.87 + (newSpot - (Math.random() - 0.47) * 1.5) * 0.13;
    const mom = (newSpot - s.spot) / Math.max(0.01, Math.abs(s.spot)) * 1000;
    const macroBoost = (t >= session.macroTick + 10 && t < session.macroTick + 14) ? 4.5 : 0;
    const sqBoost = squeezeForce !== 0 ? 3.8 : 0;
    const newAccel = Math.max(1, Math.min(14, s.accelerator * 0.77 + (2.6 + Math.abs(dSpot) * 17 * volMult) * 0.23 + macroBoost + sqBoost + (Math.random() - 0.5) * 0.55));
    const newNetGex = s.netGex * 0.999 + (Math.random() - 0.5) * Math.abs(s.netGex) * 0.002;
    const divBias = session.dayType === "trend_up" ? -0.28 : session.dayType === "trend_down" ? 0.28 : 0;
    const compLag = isPremarket ? 0.94 : 0.80;
    const newItsSpy = Math.max(1, Math.min(14, s.itsSpy * 0.72 + (5.4 + mom * 7.5 + (Math.random() - 0.5) * 0.55) * 0.28));
    const newItsComp = Math.max(1, Math.min(14, s.itsComposite * compLag + newItsSpy * (0.84 + divBias + Math.random() * 0.19) * (1 - compLag) + (Math.random() - 0.5) * 0.28));
    const newNdf = s.ndf * 0.66 + (mom * 0.52 + (Math.random() - 0.5) * 0.32) * 0.34;
    const newDealer = Math.max(5, Math.min(88, s.dealerPct * 0.81 + (isPremarket ? 18 : 22 + gexInf * 42) * 0.19 + (Math.random() - 0.5) * 3.0));
    const ivTarget = isPremarket ? seed.iv * 1.14 : macroForce !== 0 ? seed.iv * 1.45 : session.dayType === "pin" ? seed.iv * 0.83 : seed.iv * (0.88 + Math.abs(dSpot) * 14);
    const newIv = Math.max(6, Math.min(48, s.iv * 0.89 + ivTarget * 0.11));
    const newPcr = Math.max(0.45, Math.min(2.6, s.pcr * 0.93 + (seed.pcr + (Math.random() - 0.5) * 0.16) * 0.07));
    let { h, m } = s; m++; if (m >= 60) { m = 0; h++; }
    const newPre = h < OPEN_H || (h === OPEN_H && m < OPEN_M);
    s = { ...s, spot: newSpot, fep: newFep, accelerator: newAccel, netGex: newNetGex, itsSpy: newItsSpy, itsComposite: newItsComp, ndf: newNdf, dealerPct: newDealer, iv: newIv, pcr: newPcr, gexInfluence: gexInfAt(t + 1), tick: t + 1, h, m, isPremarket: newPre, isTradeable: !newPre };
    return { ...s, session };
  }
  return { tick, getSession: () => ({ ...session }), peek: () => ({ ...s }) };
}

function computeProbs(mkt, hist) {
  const div = mkt.itsSpy - mkt.itsComposite, ac = mkt.accelerator, fg = mkt.spot - mkt.fep, gi = mkt.gexInfluence || 0.3;
  let D = 0, H = 0, M = 0;
  if (div < -0.4) D += 22; if (div < -0.9) D += 16; if (ac > 6) D += 17; if (ac > 9) D += 11;
  if (mkt.ndf > 0.12) D += 13; if (mkt.dealerPct < 28) D += 11; if (gi < 0.3) D += 9;
  const l8 = hist.slice(-8);
  if (l8.length >= 5) { const r = Math.max(...l8.map(c=>c.spot)) - Math.min(...l8.map(c=>c.spot)); if (r < 1.0) H += 28; if (r < 0.5) H += 18; }
  if (ac < 3.5) H += 17; if (mkt.dealerPct > 55) H += 15; if (Math.abs(fg) < 0.35) H += 11; if (gi > 0.7) H += 11;
  if (hist.length >= 3) { const rs = hist.slice(-3).map(c=>c.spot), mv = Math.max(...rs.map((s,i)=>i>0?Math.abs(s-rs[i-1]):0)); if (mv > 1.2) M += 34; if (mv > 2.0) M += 24; if (mv > 3.0) M += 18; }
  if (Math.abs(div) > 1.8 && ac > 8) M += 17;
  const Tr = Math.max(0, 100 - (D+H+M) * 0.72), tot = D+H+M+Tr;
  return { discovery: Math.round(D/tot*100), harvest: Math.round(H/tot*100), transition: Math.round(Tr/tot*100), macro: Math.round(M/tot*100) };
}

function computeConf(mkt, probs) {
  const div = mkt.itsSpy - mkt.itsComposite, fg = mkt.spot - mkt.fep, gi = mkt.gexInfluence || 0.3;
  let score = 50; const factors = [];
  if (div < -0.5) { const p=Math.min(20,Math.round(Math.abs(div)*14)); score+=p; factors.push({label:"Composite leadership",delta:p}); }
  else if (div > 0.5) { const p=-Math.min(18,Math.round(div*11)); score+=p; factors.push({label:"SPY leading (caution)",delta:p}); }
  if (mkt.accelerator > 6.5) { const p=Math.round((mkt.accelerator-5)*3.5); score+=p; factors.push({label:"Accelerator building",delta:p}); }
  else if (mkt.accelerator < 3.2) { const p=-Math.round((4-mkt.accelerator)*4.5); score+=p; factors.push({label:"Accelerator fading",delta:p}); }
  if (Math.abs(fg) < 0.3) { score+=8; factors.push({label:"FEP aligned",delta:8}); }
  else if (fg > 1.8) { score-=11; factors.push({label:"Spot overextended vs FEP",delta:-11}); }
  else if (fg < -1.2) { score+=7; factors.push({label:"FEP pulling spot",delta:7}); }
  if (mkt.ndf > 0.15) { score+=8; factors.push({label:"NDF positive",delta:8}); }
  else if (mkt.ndf < -0.15) { score-=8; factors.push({label:"NDF negative",delta:-8}); }
  if (gi > 0.7 && mkt.netGex > 0) { score-=7; factors.push({label:"GEX dominant — pin risk",delta:-7}); }
  else if (gi < 0.28 && mkt.netGex < 0) { score+=8; factors.push({label:"GEX absent — free move",delta:8}); }
  else if (mkt.netGex < 0 && gi > 0.35) { score+=5; factors.push({label:"Neg GEX amplifying",delta:5}); }
  if (mkt.dealerPct < 28) { score+=10; factors.push({label:"Dealer% contracting",delta:10}); }
  else if (mkt.dealerPct > 62) { score-=10; factors.push({label:"Dealer% heavy",delta:-10}); }
  const top = Object.entries(probs).sort((a,b)=>b[1]-a[1])[0];
  if (top[1] > 60) { score+=7; factors.push({label:`${top[0][0].toUpperCase()+top[0].slice(1)} clear`,delta:7}); }
  else if (top[1] < 32) { score-=8; factors.push({label:"Regime ambiguous",delta:-8}); }
  if (mkt.isPremarket) { score-=18; factors.push({label:"Premarket — no contracts",delta:-18}); }
  return { score: Math.max(5, Math.min(97, score)), factors };
}

function ncdf(x) { const t=1/(1+0.2316419*Math.abs(x)),d=0.3989423*Math.exp(-x*x/2),p=d*t*(0.3193815+t*(-0.3565638+t*(1.7814779+t*(-1.8212560+t*1.3302744)))); return x>0?1-p:p; }
function priceOpt(spot, strike, iv, mL, isCall) {
  if (mL<=0) return Math.max(0.01, isCall?Math.max(0,spot-strike):Math.max(0,strike-spot));
  const TT=mL/(252*390), sig=iv/100, sq=Math.sqrt(TT), d1=(Math.log(spot/strike)+0.5*sig*sig*TT)/(sig*sq), d2=d1-sig*sq;
  return Math.max(0.01, Math.round((isCall?spot*ncdf(d1)-strike*ncdf(d2):strike*ncdf(-d2)-spot*ncdf(-d1))*100)/100);
}
function findStrike(spot, iv, mL, isCall) {
  for (const off of [1,2,1.5,2.5,3,0.5,3.5,4,5,6,7,8]) {
    const strike = isCall ? Math.round((spot+off)*2)/2 : Math.round((spot-off)*2)/2;
    const price = priceOpt(spot, strike, iv, mL, isCall);
    if (price >= 0.13 && price <= 0.28) return { strike, price };
  }
  return null;
}

async function callAI(mkt, pos, bal, hist, probs, conf) {
  const tStr=`${mkt.h}:${String(mkt.m).padStart(2,"0")} ET`, mL=(SESSION_END_H*60+SESSION_END_M)-(mkt.h*60+mkt.m);
  const theta=mL<90, div=mkt.itsSpy-mkt.itsComposite, top=Object.entries(probs).sort((a,b)=>b[1]-a[1])[0], gi=mkt.gexInfluence||0.3;
  const gexStr=`${mkt.netGex>0?"PINNING":"AMPLIFYING"} inf:${(gi*100).toFixed(0)}% ${gi>0.7?"[DOMINANT]":gi<0.3?"[WEAK]":"[MODERATE]"}`;
  const callOpt=!theta&&!pos&&mkt.isTradeable?findStrike(mkt.spot,mkt.iv,mL,true):null;
  const putOpt=!theta&&!pos&&mkt.isTradeable?findStrike(mkt.spot,mkt.iv,mL,false):null;
  const optStr=mkt.isPremarket?"PREMARKET — observe only, no entries"
    :callOpt||putOpt?`PRE-PRICED ($0.15-$0.28):\n${callOpt?`CALL: ${callOpt.strike} @ $${callOpt.price.toFixed(2)}`:"CALL: none"}\n${putOpt?`PUT: ${putOpt.strike} @ $${putOpt.price.toFixed(2)}`:"PUT: none"}`
    :pos?"MANAGE POSITION":"NO ENTRIES AVAILABLE";
  const rH=hist.slice(-5).map(c=>`${c.t} SPY:${c.spot.toFixed(2)} DIV:${(c.itsSpy-c.itsComp).toFixed(2)} ACCEL:${c.accel.toFixed(1)} GEX:${(c.gexInf*100).toFixed(0)}%`).join("\n");
  const posStr=pos?`OPEN: ${pos.strike}${pos.isCall?"C":"P"} entry $${pos.entry.toFixed(2)} now $${pos.current.toFixed(2)} (${((pos.current/pos.entry-1)*100).toFixed(0)}%)`:"NO POSITION";
  const prompt=`GCDT SPY 0DTE. ONE decision. ${tStr} | ${mL}min | THETA:${theta?"YES":"no"}${mkt.isPremarket?" | PREMARKET":""}
BAL:$${bal.toFixed(0)} | ${posStr}
REGIME: ${top[0].toUpperCase()} ${top[1]}% (D:${probs.discovery} H:${probs.harvest} T:${probs.transition} M:${probs.macro})
CONVICTION: ${conf.score}/100 | ${conf.factors.slice(0,4).map(f=>f.label+(f.delta>0?"+":"")+f.delta).join(", ")}
SPY:$${mkt.spot.toFixed(2)} | Flip:$${mkt.gammaFlip.toFixed(2)} ${mkt.spot>mkt.gammaFlip?"ABOVE":"BELOW"} | Walls:C$${mkt.callWall} P$${mkt.putWall}
GEX: ${gexStr} | FEP:$${mkt.fep.toFixed(2)} gap:${(mkt.spot-mkt.fep).toFixed(2)}
DIV:${div.toFixed(2)} ${div<-0.4?"COMP-LEADS":div>0.4?"SPY-LEADS":"CONVERGED"} | ACCEL:${mkt.accelerator.toFixed(2)} | NDF:${mkt.ndf.toFixed(3)} | IV:${mkt.iv.toFixed(1)}%
${optStr}
RECENT:\n${rH}
RULES: Composite leads SPY=conviction entry | SPY leads at resistance=exit | Exit: accel peaks+rolls OR FEP catches spot | No entries: premarket/theta/in-position | GEX DOMINANT(>70%): pin/harvest only | GEX WEAK(<30%): free move, higher conviction directional | NEG GEX+AMPLIFYING: wait for accel TURN then enter
Respond ONLY valid JSON: {"decision":"WAIT|WAITING|BUY_CALL|BUY_PUT|SELL|HOLD","reasoning":"one sentence","mindset":"signal you watch most","edge_state":"NO_EDGE|CONDITIONS_FORMING|ENTRY_READY|IN_TRADE|EXITING","confidence_trend":"BUILDING|STABLE|DECAYING|UNCLEAR"}`;
  const resp=await fetch(TRADER_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt})});
  if(!resp.ok)throw new Error(`${resp.status}`);
  const data=await resp.json();
  if(!data.decision)throw new Error("bad shape");
  return{...data,callOpt,putOpt};
}

const fmt={bal:v=>v>=1e6?`$${(v/1e6).toFixed(3)}M`:v>=1000?`$${(v/1e3).toFixed(1)}K`:`$${v.toFixed(0)}`,pct:v=>`${v>=0?"+":""}${v.toFixed(1)}%`,time:(h,m)=>`${h}:${String(m).padStart(2,"0")}`,gex:v=>`${(v/1e6).toFixed(0)}M`};
const SC={discovery:"#00d4a8",harvest:"#f0c040",transition:"#a78bfa",macro:"#ff4060"};
const T={bg:"#07090c",surface:"#0e1117",surface2:"#141920",border:"#1a2030",accent:"#00d4a8",accentDim:"#00d4a818",red:"#ff4060",redDim:"#ff406018",yellow:"#f0c040",text:"#dde4f0",muted:"#4a5568",dim:"#1e2530"};

function Spark({data,color,h=28,w=100,fill=false}){
  if(!data||data.length<2)return null;
  const mn=Math.min(...data),mx=Math.max(...data),rng=mx-mn||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*w},${h-((v-mn)/rng)*(h-4)-2}`).join(" ");
  return<svg width={w} height={h} style={{display:"block"}}>{fill&&<polygon points={`0,${h} ${pts} ${w},${h}`} fill={color} opacity={0.1}/>}<polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/></svg>;
}

function PriceChart({candles,gammaFlip,callWall,putWall,position,isPremarket}){
  const ref=useRef(null);
  const[scrollX,setScrollX]=useState(0),[drag,setDrag]=useState(false),[ds,setDs]=useState(0),[ss,setSs]=useState(0),[hov,setHov]=useState(null);
  const W=340,H=140,STEP=6,PT=6,PB=22,PL=6;
  const tot=Math.max(W,candles.length*STEP+PL+6),maxS=Math.max(0,tot-W);
  useEffect(()=>{if(!drag)setScrollX(maxS);},[candles.length,maxS,drag]);
  const sp=candles.map(c=>c.spot);
  const dMin=sp.length?Math.min(...sp):gammaFlip-5,dMax=sp.length?Math.max(...sp):gammaFlip+5;
  const pad=Math.max(1.5,(dMax-dMin)*0.15);
  const visL=[gammaFlip,callWall,putWall].filter(v=>v>dMin-12&&v<dMax+12);
  const mn=Math.min(dMin-pad,...visL),mx=Math.max(dMax+pad,...visL),rng=mx-mn||1;
  const toY=v=>PT+((mx-v)/rng)*(H-PT-PB),toX=i=>PL+i*STEP-scrollX;
  const down=e=>{setDrag(true);setDs(e.clientX||e.touches?.[0]?.clientX||0);setSs(scrollX);e.preventDefault();};
  const move=e=>{
    if(!drag)return;
    const cx=e.clientX||e.touches?.[0]?.clientX||0;
    setScrollX(Math.max(0,Math.min(maxS,ss+(ds-cx))));
    const rx=cx-(ref.current?.getBoundingClientRect().left||0)+scrollX;
    setHov(Math.floor((rx-PL)/STEP));
  };
  const up=()=>setDrag(false);
  const openIdx=candles.findIndex(c=>c.isOpen);
  const tli=candles.reduce((a,c,i)=>{if(i%20===0||i===candles.length-1)a.push(i);return a;},[]);
  const hc=hov!=null&&hov>=0&&hov<candles.length?candles[hov]:null;
  return(
    <div>
      <div style={{background:T.surface2,borderBottom:`1px solid ${T.border}`,padding:"4px 10px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:9,color:isPremarket?T.yellow:T.muted}}>{isPremarket?"PREMARKET":"PRICE"}</span>
        <span style={{fontSize:11,fontWeight:700,color:isPremarket?T.yellow:T.accent,fontFamily:"monospace"}}>{candles.length>0?candles[candles.length-1].t:"--:--"} ET</span>
        <span style={{fontSize:9,color:T.muted}}>{hc?`${hc.t} $${hc.spot.toFixed(2)}`:"drag to scroll"}</span>
      </div>
      <div ref={ref} style={{overflow:"hidden",cursor:drag?"grabbing":"grab",touchAction:"none",userSelect:"none"}} onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up} onTouchStart={down} onTouchMove={move} onTouchEnd={up}>
        <svg width={W} height={H} style={{display:"block"}}>
          <rect width={W} height={H} fill={T.surface}/>
          {openIdx>0&&(()=>{const x=toX(openIdx);if(x>0&&x<W)return<><rect x={0} y={0} width={x} height={H} fill={T.yellow} opacity={0.04}/><line x1={x} y1={PT} x2={x} y2={H-PB} stroke={T.yellow} strokeWidth={0.5} strokeDasharray="2,4" opacity={0.4}/></>;})()}
          {[{v:callWall,c:T.accent,l:"CW"},{v:gammaFlip,c:T.yellow,l:"FLIP"},{v:putWall,c:T.red,l:"PW"}].map(({v,c,l})=>{const y=toY(v);if(y<PT-2||y>H-PB+2)return null;return<g key={l}><line x1={0} y1={y} x2={W} y2={y} stroke={c} strokeWidth={0.6} strokeDasharray="3,3" opacity={0.5}/><text x={W-4} y={y-2} fill={c} fontSize={7} textAnchor="end" opacity={0.8}>{l} ${v}</text></g>;})}
          {candles.length>1&&<polyline points={candles.map((c,i)=>`${toX(i)+3},${toY(c.spot)}`).join(" ")} fill="none" stroke={T.text} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round"/>}
          {candles.length>1&&<polyline points={candles.map((c,i)=>`${toX(i)+3},${toY(c.fep)}`).join(" ")} fill="none" stroke={T.muted} strokeWidth={0.8} strokeDasharray="2,2" opacity={0.4}/>}
          {position&&(()=>{const ei=candles.findIndex(c=>c.t===position.entryTime);if(ei<0)return null;const x=toX(ei)+3,y=toY(candles[ei].spot);return<g><circle cx={x} cy={y} r={4} fill={position.isCall?T.accent:T.red} opacity={0.9}/><line x1={x} y1={y} x2={x} y2={H-PB} stroke={position.isCall?T.accent:T.red} strokeWidth={0.5} strokeDasharray="2,2" opacity={0.4}/></g>;})()}
          {hov!=null&&hov>=0&&hov<candles.length&&(()=>{const x=toX(hov)+3,y=toY(candles[hov].spot);if(x<0||x>W)return null;return<g><line x1={x} y1={PT} x2={x} y2={H-PB} stroke={T.muted} strokeWidth={0.5} opacity={0.4}/><circle cx={x} cy={y} r={3} fill={T.text}/></g>;})()}
          {candles.length>0&&(()=>{const x=toX(candles.length-1)+3,y=toY(candles[candles.length-1].spot);if(x<0||x>W)return null;return<circle cx={x} cy={y} r={3} fill={T.accent}/>;})()}
          {[mn+rng*0.2,mn+rng*0.5,mn+rng*0.8].map((v,i)=><text key={i} x={4} y={toY(v)} fill={T.dim} fontSize={7} dominantBaseline="middle">${v.toFixed(0)}</text>)}
          {tli.map(i=>{const x=toX(i)+3;if(x<20||x>W-20)return null;return<text key={i} x={x} y={H-5} fill={T.muted} fontSize={7} textAnchor="middle">{candles[i].t}</text>;})}
        </svg>
      </div>
      {maxS>0&&<div style={{height:2,background:T.dim,margin:"0 8px"}}><div style={{height:"100%",width:`${(W/tot)*100}%`,marginLeft:`${(scrollX/tot)*100}%`,background:T.muted,borderRadius:1}}/></div>}
    </div>
  );
}

function StateBars({probs}){
  return(
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px 16px"}}>
      {Object.entries(probs).map(([s,p])=>(
        <div key={s}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
            <span style={{fontSize:9,color:SC[s],letterSpacing:"0.08em",textTransform:"uppercase"}}>{s}</span>
            <span style={{fontSize:10,fontWeight:700,color:SC[s]}}>{p}%</span>
          </div>
          <div style={{height:3,background:T.dim,borderRadius:2}}><div style={{height:"100%",width:`${p}%`,background:SC[s],borderRadius:2,transition:"width 0.4s"}}/></div>
        </div>
      ))}
    </div>
  );
}

const SK="gcdt_v5_sessions";
function loadS(){try{return JSON.parse(localStorage.getItem(SK)||"[]");}catch{return[];}}
function saveS(s){try{localStorage.setItem(SK,JSON.stringify(s));}catch{}}

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
  const[sessionType,setSessionType]=useState("—");
  const[gexInf,setGexInf]=useState(0.08);

  const engR=useRef(null),balR=useRef(STARTING_BALANCE),posR=useRef(null),logR=useRef([]),candR=useRef([]);
  const mindR=useRef([]),tlR=useRef([]),probR=useRef({discovery:25,harvest:25,transition:25,macro:25});
  const confR=useRef({score:50,factors:[]}),tickR=useRef(0),thinkR=useRef(false),ivR=useRef(null),lastSR=useRef("transition");

  const addM=useCallback(e=>{mindR.current=[...mindR.current.slice(-60),e];setMindsetLog([...mindR.current]);},[]);

  const doTick=useCallback(eng=>{
    const m=eng.tick();tickR.current++;
    const mL=(SESSION_END_H*60+SESSION_END_M)-(m.h*60+m.m);
    if(posR.current&&m.isTradeable){const np=priceOpt(m.spot,posR.current.strike,m.iv,mL,posR.current.isCall);posR.current={...posR.current,current:np};setPos({...posR.current});}
    if(m.h>=SESSION_END_H){
      if(posR.current){const p=posR.current,r=(p.current/p.entry-1)*100;balR.current*=(1+r/100);logR.current=[...logR.current,{t:"16:00",action:`AUTO-CLOSE ${p.strike}${p.isCall?"C":"P"}`,result:fmt.pct(r),pnl:r}];setTradeLog([...logR.current]);posR.current=null;setPos(null);}
      setBal(balR.current);setDone(true);setRunning(false);clearInterval(ivR.current);return;
    }
    setMkt(m);setBal(balR.current);setGexInf(m.gexInfluence||0.1);
    const c={t:fmt.time(m.h,m.m),spot:m.spot,itsSpy:m.itsSpy,itsComp:m.itsComposite,accel:m.accelerator,fep:m.fep,ndf:m.ndf,gexInf:m.gexInfluence||0.1,isOpen:m.h===OPEN_H&&m.m===OPEN_M};
    candR.current=[...candR.current.slice(-320),c];setCandles([...candR.current]);
    const np=computeProbs(m,candR.current),nc=computeConf(m,np);
    probR.current=np;confR.current=nc;setProbs({...np});setConfData({...nc});
    setConfHist(prev=>[...prev.slice(-120),nc.score]);
    const top=Object.entries(np).sort((a,b)=>b[1]-a[1])[0][0];
    if(top!==lastSR.current){lastSR.current=top;tlR.current=[...tlR.current,{t:fmt.time(m.h,m.m),state:top,probs:{...np}}];setTimeline([...tlR.current]);}
    if(tickR.current%aiFreq===0&&!thinkR.current){
      thinkR.current=true;setThinking(true);
      callAI(m,posR.current,balR.current,candR.current,probR.current,confR.current)
        .then(dec=>{
          const ts=fmt.time(m.h,m.m),mLn=(SESSION_END_H*60+SESSION_END_M)-(m.h*60+m.m);
          addM({t:ts,mindset:dec.mindset||"—",reasoning:dec.reasoning||"—",decision:dec.decision,score:confR.current.score,edgeState:dec.edge_state||"—",confTrend:dec.confidence_trend||"—"});
          if(dec.decision==="SELL"&&posR.current){const p=posR.current,r=(p.current/p.entry-1)*100;balR.current*=(1+r/100);setBal(balR.current);logR.current=[...logR.current,{t:ts,action:`SELL ${p.strike}${p.isCall?"C":"P"} @$${p.current.toFixed(2)}`,result:fmt.pct(r),pnl:r}];setTradeLog([...logR.current]);posR.current=null;setPos(null);}
          else if((dec.decision==="BUY_CALL"||dec.decision==="BUY_PUT")&&!posR.current&&mLn>=90&&m.isTradeable){
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
    ivR.current=setInterval(()=>doTick(engR.current),Math.max(150,BASE_TICK_MS/speed));
    return()=>clearInterval(ivR.current);
  },[running,speed,doTick]);

  const start=useCallback(()=>{
    engR.current=createEngine(REAL_SEED);
    const sess=engR.current.getSession();
    setSessionType(sess.dayType);setBal(STARTING_BALANCE);balR.current=STARTING_BALANCE;
    setPos(null);posR.current=null;setTradeLog([]);logR.current=[];
    setMindsetLog([]);mindR.current=[];setCandles([]);candR.current=[];
    setConfHist([]);setTimeline([]);tlR.current=[];
    setProbs({discovery:25,harvest:25,transition:25,macro:25});setConfData({score:50,factors:[]});
    lastSR.current="transition";tickR.current=0;thinkR.current=false;
    setDone(false);setSaved(false);setGexInf(0.08);setRunning(true);setScreen("trading");
  },[]);

  const fastFwd=useCallback(()=>{
    if(!engR.current)return;clearInterval(ivR.current);setRunning(false);
    const eng=engR.current;let m=eng.peek();
    while(!(m.h>=SESSION_END_H)){m=eng.tick();tickR.current++;const mL=(SESSION_END_H*60+SESSION_END_M)-(m.h*60+m.m);if(posR.current&&m.isTradeable){const np=priceOpt(m.spot,posR.current.strike,m.iv,mL,posR.current.isCall);posR.current={...posR.current,current:np};}}
    if(posR.current){const p=posR.current,r=(p.current/p.entry-1)*100;balR.current*=(1+r/100);logR.current=[...logR.current,{t:"16:00",action:`AUTO-CLOSE ${p.strike}${p.isCall?"C":"P"}`,result:fmt.pct(r),pnl:r}];setTradeLog([...logR.current]);posR.current=null;setPos(null);}
    setMkt(m);setBal(balR.current);setDone(true);
  },[]);

  const saveSession=useCallback(()=>{
    const r=((balR.current-STARTING_BALANCE)/STARTING_BALANCE)*100,cl=logR.current.filter(l=>l.pnl!==undefined),ws=cl.filter(l=>(l.pnl||0)>=0);
    const sess={id:Date.now(),name:`SIM-${String(sessions.length+1).padStart(2,"0")} · ${sessionType} · ${r>=0?"+":""}${r.toFixed(0)}%`,date:new Date().toLocaleDateString(),balance:balR.current,returnPct:r,trades:logR.current,mindset:mindR.current,timeline:tlR.current,winRate:cl.length>0?`${ws.length}/${cl.length}`:"—",dayType:sessionType};
    const upd=[sess,...sessions];setSessions(upd);saveS(upd);setSaved(true);
  },[sessions,sessionType]);

  const pnl=((bal-STARTING_BALANCE)/STARTING_BALANCE)*100;
  const topS=Object.entries(probs).sort((a,b)=>b[1]-a[1])[0];
  const posPnl=pos?(pos.current/pos.entry-1)*100:0;
  const mLeft=mkt?(SESSION_END_H*60+SESSION_END_M)-(mkt.h*60+mkt.m):390;
  const isPremarket=mkt?.isPremarket||false;
  const lastM=mindsetLog[mindsetLog.length-1];

  if(screen==="home")return(
    <div style={{background:T.bg,minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"monospace"}}>
      <div style={{fontSize:9,color:T.muted,letterSpacing:"0.2em",marginBottom:8}}>FIRSTSIGNAL OS v3</div>
      <div style={{fontSize:28,fontWeight:700,color:T.accent,marginBottom:4}}>GCDT</div>
      <div style={{fontSize:10,color:T.muted,marginBottom:4,textAlign:"center"}}>GEX Composite Divergence Trading</div>
      <div style={{fontSize:9,color:T.muted,marginBottom:32,textAlign:"center",opacity:0.65}}>Seed: SPY Jul 1 · Flip $745 · CW $750 · PW $720</div>
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
              <div key={l} style={{padding:"10px 12px",background:T.surface,borderRadius:6,border:`1px solid ${T.border}`}}><div style={{fontSize:9,color:T.muted,marginBottom:3}}>{l}</div><div style={{fontSize:13,fontWeight:700}}>{v}</div></div>
            ))}
          </div>
          {s.timeline?.length>0&&<><div style={{fontSize:10,color:T.muted,marginBottom:8}}>REGIME TIMELINE</div>{s.timeline.map((r,i)=><div key={i} style={{fontSize:10,padding:"4px 10px",marginBottom:4,borderLeft:`2px solid ${SC[r.state]}`,color:SC[r.state]}}>{r.t} → {r.state.toUpperCase()}</div>)}</>}
          <div style={{fontSize:10,color:T.muted,marginTop:12,marginBottom:8}}>TRADES</div>
          {s.trades.length===0&&<div style={{fontSize:10,color:T.dim}}>No trades this session.</div>}
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
            {isPremarket&&<span style={{fontSize:8,color:T.yellow,border:`1px solid ${T.yellow}40`,padding:"1px 5px",borderRadius:2}}>PRE</span>}
            {thinking&&<span style={{fontSize:9,color:T.yellow}}>◈</span>}
          </div>
          <div style={{display:"flex",gap:6}}>
            {running&&<><button onClick={fastFwd} style={{padding:"4px 8px",background:"#f0c04018",color:T.yellow,border:`1px solid ${T.yellow}40`,borderRadius:3,fontFamily:"monospace",fontSize:9,cursor:"pointer"}}>END</button><button onClick={()=>{setRunning(false);clearInterval(ivR.current);}} style={{padding:"4px 8px",background:T.redDim,color:T.red,border:`1px solid ${T.red}40`,borderRadius:3,fontFamily:"monospace",fontSize:9,cursor:"pointer"}}>PAUSE</button></>}
            {!running&&!done&&mkt&&<button onClick={()=>setRunning(true)} style={{padding:"4px 10px",background:T.accentDim,color:T.accent,border:`1px solid ${T.accent}40`,borderRadius:3,fontFamily:"monospace",fontSize:9,cursor:"pointer"}}>RESUME</button>}
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          {mkt&&<span style={{fontSize:11,color:isPremarket?T.yellow:T.muted,fontWeight:700}}>{fmt.time(mkt.h,mkt.m)} ET</span>}
          {mLeft<90&&!isPremarket&&<span style={{fontSize:9,color:T.red}}>THETA</span>}
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
        {mkt&&<div style={{background:T.surface,borderRadius:8,border:`1px solid ${isPremarket?T.yellow+"40":T.border}`,margin:"10px 14px",overflow:"hidden"}}>
          <PriceChart candles={candles} gammaFlip={mkt.gammaFlip} callWall={mkt.callWall} putWall={mkt.putWall} position={pos} isPremarket={isPremarket}/>
          <div style={{padding:"8px 12px",borderTop:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between"}}>
            <div><div style={{fontSize:20,fontWeight:700}}>${mkt.spot.toFixed(2)}</div><div style={{fontSize:9,color:mkt.spot>mkt.gammaFlip?T.accent:T.red}}>{mkt.spot>mkt.gammaFlip?"▲ ABOVE":"▼ BELOW"} FLIP ${mkt.gammaFlip}</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:11,fontWeight:700,color:mkt.netGex>0?T.accent:T.red}}>{fmt.gex(mkt.netGex)}</div><div style={{fontSize:8,color:mkt.netGex>0?T.accent:T.red}}>{mkt.netGex>0?"PINNING":"AMPLIFY"}</div><div style={{fontSize:8,color:T.muted,marginTop:1}}>inf {(gexInf*100).toFixed(0)}%</div></div>
          </div>
        </div>}

        {mkt&&<div style={{background:T.surface,borderRadius:8,border:`1px solid ${T.border}`,margin:"0 14px 10px",padding:12}}>
          <div style={{fontSize:9,color:T.muted,letterSpacing:"0.1em",marginBottom:10}}>REGIME STATE</div>
          <StateBars probs={probs}/>
          <div style={{marginTop:10}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
              <span style={{fontSize:9,color:T.muted}}>GEX INFLUENCE</span>
              <span style={{fontSize:9,color:gexInf>0.7?T.red:gexInf<0.28?T.accent:T.yellow}}>{gexInf>0.7?"DOMINANT":gexInf<0.28?"WEAK/ABSENT":"MODERATE"} {(gexInf*100).toFixed(0)}%</span>
            </div>
            <div style={{height:3,background:T.dim,borderRadius:2}}><div style={{height:"100%",width:`${gexInf*100}%`,background:gexInf>0.7?T.red:gexInf<0.28?T.accent:T.yellow,borderRadius:2,transition:"width 0.5s"}}/></div>
          </div>
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
          <div style={{fontSize:10,color:T.muted,marginBottom:4}}>SESSION COMPLETE · {sessionType.toUpperCase()}</div>
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
