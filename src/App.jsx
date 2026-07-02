import { useState, useEffect, useRef, useCallback } from "react";

const STARTING_BALANCE = 1000;
const BASE_TICK_MS = 4000;
const SESSION_END_H = 16, SESSION_END_M = 0;
const OPEN_H = 9, OPEN_M = 30;
const TRADER_API = "https://firstsignal-os.vercel.app/api/trader";
const STORAGE_KEY = "gcdt_v6";

const SPX_JUL1 = {
  date: "2026-07-01", label: "SPX Jul 1 2026", dayType: "SQUEEZE",
  snapshots: [
    { time: "09:29", spot: 7499.36, gex: 38224500000,    callDom: 0.76, maxGamma: 7500 },
    { time: "09:39", spot: 7457.33, gex: -7588600000,   callDom: 0.43, maxGamma: 7500 },
    { time: "09:50", spot: 7463.87, gex: 5827800000,    callDom: 0.54, maxGamma: 7500 },
    { time: "09:56", spot: 7474.64, gex: 31361600000,   callDom: 0.67, maxGamma: 7500 },
    { time: "10:08", spot: 7489.83, gex: 83599700000,   callDom: 0.81, maxGamma: 7500 },
    { time: "10:26", spot: 7496.99, gex: 127356300000,  callDom: 0.84, maxGamma: 7500 },
    { time: "11:26", spot: 7516.41, gex: 276062800000,  callDom: 0.91, maxGamma: 7520 },
    { time: "13:05", spot: 7500.25, gex: 128183500000,  callDom: 0.69, maxGamma: 7520 },
    { time: "14:16", spot: 7495.22, gex: -9161400000,   callDom: 0.49, maxGamma: 7490 },
    { time: "14:26", spot: 7500.99, gex: 137023000000,  callDom: 0.63, maxGamma: 7510 },
    { time: "14:47", spot: 7496.06, gex: -20370000000,  callDom: 0.48, maxGamma: 7490 },
    { time: "15:11", spot: 7501.42, gex: 215438100000,  callDom: 0.66, maxGamma: 7510 },
    { time: "15:27", spot: 7496.94, gex: -18665100000,  callDom: 0.49, maxGamma: 7505 },
    { time: "15:44", spot: 7493.14, gex: -287846200000, callDom: 0.34, maxGamma: 7495 },
    { time: "15:59", spot: 7487.62, gex: -1011022100000,callDom: 0.02, maxGamma: 7485 },
  ],
};

// Real day-archetypes pulled from RAW TRADING DATA session logs (Jun 24-30, Jul 1 2026).
// n=6 real days — small sample, equal-weighted. Not a statistically robust distribution,
// just a real-data prior instead of arbitrary constants. Ranges are field-log magnitudes,
// not literally-replayed snapshots (unlike REPLAY mode's SPX_JUL1 array).
const REAL_ARCHETYPES=[
  {id:"pin_oscillation",label:"Pin Day Oscillation",sourceDay:"Jun 26 2026",dayType:"pin",fidelity:"sparse-log",
   gexRange:[1.47e9,26.1e9],accelRange:[5.57,8.37],ivRange:[20,25],callDomRange:[0.5,0.7],wallGap:2.5,pinBias:0.85},
  {id:"amplification_neg",label:"Negative GEX Amplification",sourceDay:"Jun 25 2026",dayType:"trend_down",fidelity:"sparse-log",
   gexRange:[-6.4e9,-3.5e9],accelRange:[3.5,5.5],ivRange:[27,31],callDomRange:[0.25,0.45],wallGap:5,pinBias:0.15},
  {id:"trend_discovery",label:"Morning Regime Flip",sourceDay:"Jun 24 2026",dayType:"reversal",fidelity:"sparse-log",
   gexRange:[-5e9,1.1e9],accelRange:[3,6],ivRange:[18,22],callDomRange:[0.4,0.6],wallGap:4,pinBias:0.4},
  {id:"ath_grind_divergence",label:"ATH Grind + NDF Divergence",sourceDay:"Jun 29 2026",dayType:"trend_up",fidelity:"sparse-log",
   gexRange:[62e9,99e9],accelRange:[7.4,8.9],ivRange:[16,20],callDomRange:[0.55,0.75],wallGap:2,pinBias:0.3},
  {id:"eoq_squeeze_reject",label:"Composite/SPY NDF Divergence + Wall Reject",sourceDay:"Jun 30 2026",dayType:"pin",fidelity:"sparse-log",
   gexRange:[110e9,121e9],accelRange:[8.7,9.0],ivRange:[35,38],callDomRange:[0.6,0.8],wallGap:1,pinBias:0.7},
  {id:"spx_squeeze_collapse",label:"Squeeze Build + EOD Gamma Collapse",sourceDay:"Jul 1 2026",dayType:"squeeze",fidelity:"dense-series",
   gexRange:[-1.01e12,276e9],accelRange:[4,9],ivRange:[15,25],callDomRange:[0.02,0.91],wallGap:3,pinBias:0.4,eodCollapse:true},
];

function timeToMin(t){const[h,m]=t.split(":").map(Number);return h*60+m;}
function lerp(a,b,t){return a+(b-a)*t;}
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}

const fmt={bal:v=>v>=1e6?`$${(v/1e6).toFixed(3)}M`:v>=1000?`$${(v/1e3).toFixed(1)}K`:`$${v.toFixed(0)}`,pct:v=>`${v>=0?"+":""}${v.toFixed(1)}%`,time:(h,m)=>`${h}:${String(m).padStart(2,"0")}`,gex:v=>`${(v/1e9).toFixed(1)}B`};
const T={bg:"#07090c",surface:"#0e1117",surface2:"#141920",border:"#1a2030",accent:"#00d4a8",accentDim:"#00d4a818",red:"#ff4060",redDim:"#ff406018",yellow:"#f0c040",yellowDim:"#f0c04018",purple:"#a78bfa",text:"#dde4f0",muted:"#4a5568",dim:"#1e2530"};
const SC={discovery:"#00d4a8",pin:"#f0c040",transition:"#a78bfa",macro:"#ff4060"};

function synthSPYfromSPX(spxIts,spxCallDom,prevSpyIts){
  const spyCallDom=clamp(spxCallDom-(0.08+Math.random()*0.07),0.2,0.95);
  const target=spxIts*(0.78+spyCallDom*0.12);
  const lag=0.75+Math.random()*0.15;
  return clamp(prevSpyIts*lag+target*(1-lag)+(Math.random()-0.5)*0.3,1,14);
}

function interpolateSPX(snapshots,currentMin){
  const mins=snapshots.map(s=>timeToMin(s.time));
  if(currentMin<=mins[0])return{...snapshots[0],synth:false};
  if(currentMin>=mins[mins.length-1])return{...snapshots[mins.length-1],synth:false};
  let i=0; while(i<mins.length-1&&mins[i+1]<=currentMin)i++;
  const t=(currentMin-mins[i])/(mins[i+1]-mins[i]);
  const a=snapshots[i],b=snapshots[i+1],ease=t*t*(3-2*t);
  return{spot:lerp(a.spot,b.spot,ease)+(Math.random()-0.5)*0.8,gex:lerp(a.gex,b.gex,ease)+(Math.random()-0.5)*Math.abs(a.gex)*0.015,callDom:lerp(a.callDom,b.callDom,ease),maxGamma:ease<0.5?a.maxGamma:b.maxGamma,synth:Math.abs(currentMin-mins[i])>2&&Math.abs(currentMin-mins[i+1])>2};
}

function itsFromGex(callDom,gex,prevIts){
  const gexFactor=gex>0?Math.min(1,gex/2e11):Math.max(-0.3,gex/5e10);
  const target=1+callDom*11+gexFactor*2;
  return clamp(prevIts*0.75+target*0.25+(Math.random()-0.5)*0.4,1,14);
}

function wRand(choices){const r=Math.random();let cum=0;for(const[v,w]of choices){cum+=w;if(r<cum)return v;}return choices[choices.length-1][0];}

function createSeedEngine(forceArcheId){
  const arche=forceArcheId?REAL_ARCHETYPES.find(a=>a.id===forceArcheId)||REAL_ARCHETYPES[0]:REAL_ARCHETYPES[Math.floor(Math.random()*REAL_ARCHETYPES.length)];
  const gexLo=arche.gexRange[0],gexHi=arche.eodCollapse?arche.gexRange[1]:arche.gexRange[1];
  const netGexStart=arche.eodCollapse?lerp(gexLo*0.02,gexHi*0.3,Math.random()):lerp(gexLo,gexHi,Math.random()*0.4);
  const accelStart=lerp(arche.accelRange[0],arche.accelRange[1],Math.random()*0.3);
  const ivStart=lerp(arche.ivRange[0],arche.ivRange[1],Math.random());
  const callDomStart=lerp(arche.callDomRange[0],arche.callDomRange[1],Math.random());
  const spotStart=741.26+(Math.random()-0.5)*8;
  const session={archetype:arche.id,archetypeLabel:arche.label,sourceDay:arche.sourceDay,fidelity:arche.fidelity,dataBasis:"archetype",dayType:arche.dayType,eodCollapse:!!arche.eodCollapse,gexRange:arche.gexRange,macroTick:Math.floor(20+Math.random()*200),macroMag:(Math.random()>0.5?1:-1)*(1.8+Math.random()*3.2),macroRecovery:Math.random()>0.45,squeezeTick:Math.floor(60+Math.random()*160),squeezeDir:Math.random()>0.5?1:-1,charmDecayRate:0.003+Math.random()*0.004,gexDominance:arche.pinBias,fakeoutTick:Math.floor(35+Math.random()*140),hasFakeout:Math.random()>0.5,volLevel:clamp((accelStart-3)/6,0.1,1),instBias:(callDomStart-0.5)};
  let s={spySpot:spotStart,spxSpot:spotStart*10,gammaFlip:spotStart+(Math.random()-0.5)*3,callWall:spotStart+arche.wallGap,putWall:spotStart-arche.wallGap*2.4,fep:spotStart-0.5,accelerator:accelStart,netGex:netGexStart,itsSPX:itsFromGex(callDomStart,netGexStart,5.2),itsSPY:4.8,ndf:0.12,dealerPct:22,iv:ivStart,pcr:0.88,gexInfluence:0.08,callDom:callDomStart,tick:0,h:9,m:20,isPremarket:true,isTradeable:false,spyLagBuffer:[4.8,4.8,4.8]};
  function gexInfAt(tick){const isPost=s.h>OPEN_H||(s.h===OPEN_H&&s.m>=OPEN_M);if(!isPost)return 0.08;const st=tick-10,prog=Math.max(0,st/390);const bell=Math.sin(prog*Math.PI)*0.85+0.15;const decay=Math.exp(-session.charmDecayRate*st);return Math.min(0.95,bell*session.gexDominance*decay+(1-decay)*0.08);}
  function tick(){
    const t=s.tick,isPre=s.h<OPEN_H||(s.h===OPEN_H&&s.m<OPEN_M),gi=gexInfAt(t),posGex=s.netGex>0,st=isPre?0:t-10,prog=Math.max(0,st/390);
    const volBase=isPre?0.38:0.92*Math.exp(-prog*2.8)+0.22+(prog>0.78?(prog-0.78)*0.9:0);
    const volMult=volBase*(0.65+session.volLevel*0.7);
    let drift=0;
    if(isPre){drift=(746.51-s.spySpot)*0.09+(Math.random()-0.5)*0.16;}
    else{switch(session.dayType){case"pin":drift=(s.gammaFlip-s.spySpot)*0.012*gi;break;case"trend_up":drift=0.07+Math.random()*0.05;break;case"trend_down":drift=-0.07-Math.random()*0.05;break;case"chop":drift=Math.sin(st*0.25)*0.06;break;case"squeeze":drift=s.spySpot<s.callWall?0.08:-0.05;break;case"reversal":drift=prog<0.38?0.08:-0.10;break;default:drift=(Math.random()-0.5)*0.05;}}
    let gexForce=0;
    if(!isPre){if(posGex){gexForce+=(s.gammaFlip-s.spySpot)*0.007*gi;if(s.spySpot>s.callWall-2.5)gexForce-=(s.spySpot-(s.callWall-2.5))*0.09*gi;if(s.spySpot<s.putWall+2.5)gexForce+=((s.putWall+2.5)-s.spySpot)*0.07*gi;}else{gexForce-=(s.gammaFlip-s.spySpot)*0.004*gi;if(s.spySpot>s.callWall-0.8)gexForce+=0.14*gi;if(s.spySpot<s.putWall+0.8)gexForce-=0.12*gi;}}
    let macroForce=0;
    if(!isPre&&t===session.macroTick+10)macroForce=session.macroMag*0.85;
    if(!isPre&&t>session.macroTick+10&&t<session.macroTick+24)macroForce=(session.macroRecovery?-session.macroMag:session.macroMag)*0.055*(1-(t-session.macroTick-10)/14);
    let squeezeForce=0;
    if(!isPre&&session.dayType==="squeeze"&&t>=session.squeezeTick&&t<session.squeezeTick+6)squeezeForce=session.squeezeDir*(0.28+Math.random()*0.18);
    let fakeout=0;
    if(!isPre&&session.hasFakeout){if(t>=session.fakeoutTick&&t<session.fakeoutTick+4)fakeout=-drift*2.8;else if(t>=session.fakeoutTick+4&&t<session.fakeoutTick+10)fakeout=drift*2.0;}
    const mLeft=(SESSION_END_H*60)-(s.h*60+s.m),thetaMult=mLeft<90?0.50+(mLeft/90)*0.50:1.0;
    const noise=(Math.random()-0.5)*0.40*volMult*thetaMult;
    const dSpy=(drift+gexForce+macroForce+squeezeForce+fakeout)*thetaMult+noise;
    const newSpySpot=Math.max(s.putWall-(posGex?1:3),Math.min(s.callWall+(posGex?0.5:3.5),s.spySpot+dSpy));
    const newSpxSpot=newSpySpot*10+(Math.random()-0.5)*2;
    const newFep=s.fep*0.87+(newSpySpot-(Math.random()-0.47)*1.5)*0.13;
    const mom=(newSpySpot-s.spySpot)/Math.max(0.01,Math.abs(s.spySpot))*1000;
    const newAccel=clamp(s.accelerator*0.77+(2.6+Math.abs(dSpy)*17*volMult)*0.23+(t>=session.macroTick+10&&t<session.macroTick+14?4.5:0)+(squeezeForce!==0?3.8:0)+(Math.random()-0.5)*0.55,1,14);
    let newNetGex=s.netGex*0.999+(Math.random()-0.5)*Math.abs(s.netGex)*0.002;
    let newCallDom=clamp(s.callDom*0.88+(0.5+session.instBias+mom*0.03)*0.12+(Math.random()-0.5)*0.04,0.15,0.95);
    // EOD gamma collapse mechanic (spx_squeeze_collapse archetype, modeled on Jul 1's real -1T EOD flip as 0DTEs expire)
    if(session.eodCollapse&&!isPre){
      const minsLeft=(SESSION_END_H*60+SESSION_END_M)-(s.h*60+s.m);
      if(minsLeft<=25){
        const cp=Math.pow(clamp(1-minsLeft/25,0,1),1.6);
        newNetGex=lerp(newNetGex,session.gexRange[0],cp);
        newCallDom=lerp(newCallDom,0.05,Math.pow(clamp(1-minsLeft/25,0,1),1.4));
      }
    }
    const newItsSPX=itsFromGex(newCallDom,newNetGex*8,s.itsSPX);
    const lagBuf=[...s.spyLagBuffer.slice(1),newItsSPX];
    const newItsSPY=synthSPYfromSPX(lagBuf[0],newCallDom,s.itsSPY);
    const newNdf=s.ndf*0.66+(mom*0.52+(Math.random()-0.5)*0.32)*0.34;
    const newDealer=clamp(s.dealerPct*0.81+(isPre?18:22+gi*42)*0.19+(Math.random()-0.5)*3,5,88);
    const ivTarget=isPre?14.8:macroForce!==0?14.8*1.45:session.dayType==="pin"?14.8*0.83:14.8*(0.88+Math.abs(dSpy)*14);
    const newIv=clamp(s.iv*0.89+ivTarget*0.11,6,48);
    const newPcr=clamp(s.pcr*0.93+(0.88+(Math.random()-0.5)*0.16)*0.07,0.45,2.6);
    let{h,m}=s;m++;if(m>=60){m=0;h++;}
    const newPre=h<OPEN_H||(h===OPEN_H&&m<OPEN_M);
    s={...s,spySpot:newSpySpot,spxSpot:newSpxSpot,fep:newFep,accelerator:newAccel,netGex:newNetGex,itsSPX:newItsSPX,itsSPY:newItsSPY,callDom:newCallDom,ndf:newNdf,dealerPct:newDealer,iv:newIv,pcr:newPcr,gexInfluence:gexInfAt(t+1),tick:t+1,h,m,isPremarket:newPre,isTradeable:!newPre,spyLagBuffer:lagBuf};
    return{...s,session,mode:"seed",archetypeLabel:session.archetypeLabel,sourceDay:session.sourceDay,fidelity:session.fidelity,dataBasis:"archetype"};
  }
  return{tick,getSession:()=>({...session}),peek:()=>({...s}),mode:"seed"};
}

function createReplayEngine(replayData){
  const snapshots=replayData.snapshots,openMin=OPEN_H*60+OPEN_M,spyRatio=10;
  let s={spySpot:snapshots[0].spot/spyRatio,spxSpot:snapshots[0].spot,gammaFlip:snapshots[0].spot/spyRatio-0.5,callWall:snapshots[0].maxGamma/spyRatio+1,putWall:snapshots[0].spot/spyRatio-6,fep:snapshots[0].spot/spyRatio-0.3,accelerator:4.2,netGex:snapshots[0].gex/spyRatio,itsSPX:itsFromGex(snapshots[0].callDom,snapshots[0].gex,5.5),itsSPY:4.2,callDom:snapshots[0].callDom,ndf:0.1,dealerPct:25,iv:13.5,pcr:0.85,gexInfluence:0.08,tick:0,h:9,m:20,isPremarket:true,isTradeable:false,spyLagBuffer:[4.2,4.2,4.2]};
  function tick(){
    const t=s.tick,isPre=s.h<OPEN_H||(s.h===OPEN_H&&s.m<OPEN_M),currentMin=s.h*60+s.m;
    const spx=interpolateSPX(snapshots,currentMin);
    const spxSpyRatio=spyRatio+(Math.random()-0.5)*0.02;
    const newSpxSpot=spx.spot+(Math.random()-0.5)*1.5;
    const newSpySpot=newSpxSpot/spxSpyRatio;
    const prog=isPre?0:Math.max(0,(currentMin-openMin)/390);
    const gi=isPre?0.05:clamp(Math.sin(prog*Math.PI)*0.8*spx.callDom+0.1,0.05,0.9);
    const newItsSPX=itsFromGex(spx.callDom,spx.gex,s.itsSPX);
    const lagBuf=[...s.spyLagBuffer.slice(1),newItsSPX];
    const newItsSPY=synthSPYfromSPX(lagBuf[0],spx.callDom,s.itsSPY);
    const newFep=s.fep*0.88+(newSpySpot-(Math.random()-0.47)*1.2)*0.12;
    const mom=(newSpySpot-s.spySpot)/Math.max(0.01,Math.abs(s.spySpot))*1000;
    const newAccel=clamp(s.accelerator*0.78+(2.4+Math.abs(newSpySpot-s.spySpot)*15)*0.22+(Math.random()-0.5)*0.5,1,14);
    const newNdf=s.ndf*0.66+(mom*0.5+(Math.random()-0.5)*0.3)*0.34;
    const newDealer=clamp(s.dealerPct*0.82+(20+gi*45)*0.18+(Math.random()-0.5)*2.5,5,85);
    const newIv=clamp(s.iv*0.9+(10+Math.abs(newSpySpot-s.spySpot)*12)*0.1,6,45);
    const newPcr=clamp(s.pcr*0.93+(0.85+(1-spx.callDom)*0.5+(Math.random()-0.5)*0.1)*0.07,0.4,2.8);
    const newCallWall=spx.maxGamma/spyRatio+(Math.random()-0.5)*0.2;
    const netGexSpy=spx.gex/spyRatio;
    let{h,m}=s;m++;if(m>=60){m=0;h++;}
    const newPre=h<OPEN_H||(h===OPEN_H&&m<OPEN_M);
    s={...s,spySpot:newSpySpot,spxSpot:newSpxSpot,fep:newFep,accelerator:newAccel,netGex:netGexSpy,callWall:newCallWall,itsSPX:newItsSPX,itsSPY:newItsSPY,callDom:spx.callDom,ndf:newNdf,dealerPct:newDealer,iv:newIv,pcr:newPcr,gexInfluence:gi,tick:t+1,h,m,isPremarket:newPre,isTradeable:!newPre,spyLagBuffer:lagBuf,synthData:spx.synth};
    return{...s,mode:"replay",replayLabel:replayData.label,dayTypeLabel:replayData.dayType,dataBasis:"replay"};
  }
  return{tick,getSession:()=>({dayType:replayData.dayType,label:replayData.label}),peek:()=>({...s}),mode:"replay"};
}

function computeProbs(mkt,hist){
  const div=mkt.itsSPX-mkt.itsSPY,ac=mkt.accelerator,fg=mkt.spySpot-mkt.fep,gi=mkt.gexInfluence||0.3;
  let D=0,H=0,M=0;
  if(div<-0.4)D+=22;if(div<-0.9)D+=16;if(ac>6)D+=17;if(ac>9)D+=11;if(mkt.ndf>0.12)D+=13;if(mkt.dealerPct<28)D+=11;if(gi<0.3)D+=9;
  const l8=hist.slice(-8);
  if(l8.length>=5){const r=Math.max(...l8.map(c=>c.spySpot))-Math.min(...l8.map(c=>c.spySpot));if(r<1.0)H+=28;if(r<0.5)H+=18;}
  if(ac<3.5)H+=17;if(mkt.dealerPct>55)H+=15;if(Math.abs(fg)<0.35)H+=11;if(gi>0.7)H+=11;
  if(hist.length>=3){const rs=hist.slice(-3).map(c=>c.spySpot),mv=Math.max(...rs.map((v,i)=>i>0?Math.abs(v-rs[i-1]):0));if(mv>1.2)M+=34;if(mv>2.0)M+=24;if(mv>3.0)M+=18;}
  if(Math.abs(div)>1.8&&ac>8)M+=17;
  const Tr=Math.max(0,100-(D+H+M)*0.72),tot=D+H+M+Tr;
  return{discovery:Math.round(D/tot*100),pin:Math.round(H/tot*100),transition:Math.round(Tr/tot*100),macro:Math.round(M/tot*100)};
}

function computeConf(mkt,probs){
  const div=mkt.itsSPX-mkt.itsSPY,fg=mkt.spySpot-mkt.fep,gi=mkt.gexInfluence||0.3;
  let score=50;const factors=[];
  if(div<-0.5){const p=Math.min(22,Math.round(Math.abs(div)*14));score+=p;factors.push({label:"SPX leads SPY (institutional)",delta:p});}
  else if(div>0.5){const p=-Math.min(18,Math.round(div*11));score+=p;factors.push({label:"SPY leads SPX (retail/caution)",delta:p});}
  if(mkt.accelerator>6.5){const p=Math.round((mkt.accelerator-5)*3.5);score+=p;factors.push({label:"Accelerator building",delta:p});}
  else if(mkt.accelerator<3.2){const p=-Math.round((4-mkt.accelerator)*4.5);score+=p;factors.push({label:"Accelerator fading",delta:p});}
  if(Math.abs(fg)<0.3){score+=8;factors.push({label:"FEP aligned",delta:8});}
  else if(fg>1.8){score-=11;factors.push({label:"Spot overextended vs FEP",delta:-11});}
  else if(fg<-1.2){score+=7;factors.push({label:"FEP pulling spot",delta:7});}
  if(mkt.ndf>0.15){score+=8;factors.push({label:"NDF positive",delta:8});}
  else if(mkt.ndf<-0.15){score-=8;factors.push({label:"NDF negative",delta:-8});}
  if(gi>0.7&&mkt.netGex>0){score-=7;factors.push({label:"GEX dominant — pin risk",delta:-7});}
  else if(gi<0.28&&mkt.netGex<0){score+=8;factors.push({label:"GEX absent — free move",delta:8});}
  else if(mkt.netGex<0&&gi>0.35){score+=5;factors.push({label:"Neg GEX amplifying",delta:5});}
  if(mkt.dealerPct<28){score+=10;factors.push({label:"Dealer% contracting",delta:10});}
  else if(mkt.dealerPct>62){score-=10;factors.push({label:"Dealer% heavy",delta:-10});}
  const top=Object.entries(probs).sort((a,b)=>b[1]-a[1])[0];
  if(top[1]>60){score+=7;factors.push({label:`${top[0][0].toUpperCase()+top[0].slice(1)} clear`,delta:7});}
  else if(top[1]<32){score-=8;factors.push({label:"Regime ambiguous",delta:-8});}
  if(mkt.isPremarket){score-=18;factors.push({label:"Premarket — no contracts",delta:-18});}
  return{score:clamp(score,5,97),factors};
}

function norm3(call, put, wait){
  const c=Math.max(1,call),p=Math.max(1,put),w=Math.max(1,wait);
  const tot=c+p+w;
  return{call:Math.round(c/tot*100),put:Math.round(p/tot*100),wait:Math.round(w/tot*100)};
}

function thesisMomentum(curr,prev){
  if(!prev)return{call:0,put:0,wait:0};
  return{call:curr.call-prev.call,put:curr.put-prev.put,wait:curr.wait-prev.wait};
}

function pushReason(arr,label,delta){arr.push({label,delta});}
function computeEdgeScore(scores){const vals=[scores.call,scores.put,scores.wait].sort((a,b)=>b-a);return vals[0]-vals[1];}

function computeTheses(mkt,hist,prev){
  const div=mkt.itsSPX-mkt.itsSPY,fg=mkt.spySpot-mkt.fep,gi=mkt.gexInfluence||0.3,ac=mkt.accelerator||0,netGex=mkt.netGex||0;
  const l6=hist.slice(-6),l12=hist.slice(-12);
  const priceSlope=l6.length>=2?l6[l6.length-1].spySpot-l6[0].spySpot:0;
  const accelSlope=l6.length>=2?l6[l6.length-1].accel-l6[0].accel:0;
  const range12=l12.length>=4?Math.max(...l12.map(c=>c.spySpot))-Math.min(...l12.map(c=>c.spySpot)):0;
  let call=33,put=33,wait=34;
  const callReasons=[],putReasons=[],waitReasons=[],callNeeds=[],putNeeds=[],callInvalid=[],putInvalid=[];

  if(div<-0.5){call+=14;put-=4;wait-=6;pushReason(callReasons,"SPX ITS leading SPY",14);}
  else if(div>0.5){put+=8;call-=6;wait+=4;pushReason(putReasons,"SPY leading / call caution",8);pushReason(waitReasons,"retail-led caution",4);}
  else{wait+=7;pushReason(waitReasons,"ITS convergence / unclear leadership",7);}
  if(ac>9&&accelSlope>=0){call+=8;put+=8;wait-=6;pushReason(callReasons,"accelerator expanding",8);pushReason(putReasons,"accelerator expanding",8);}
  else if(ac>9&&accelSlope<0){wait+=10;call-=5;put-=5;pushReason(waitReasons,"accelerator peaked / rolling",10);}
  else if(ac<3.5){wait+=9;pushReason(waitReasons,"low acceleration",9);}
  if(fg>0.6&&priceSlope>0){call+=9;put-=4;pushReason(callReasons,"spot above FEP with upward slope",9);}
  else if(fg<-0.6&&priceSlope<0){put+=9;call-=4;pushReason(putReasons,"spot below FEP with downward slope",9);}
  else if(Math.abs(fg)<0.35){wait+=8;pushReason(waitReasons,"spot anchored to FEP",8);}

  if(netGex>0&&gi>0.65){wait+=15;call-=5;put-=5;pushReason(waitReasons,"dominant positive GEX pin risk",15);}
  else if(netGex<0&&gi>0.35){call+=5;put+=10;wait-=6;pushReason(putReasons,"negative GEX amplification",10);pushReason(callReasons,"free-move volatility",5);}
  else if(gi<0.25){call+=5;put+=5;wait-=5;pushReason(callReasons,"GEX weak / directional unlock",5);pushReason(putReasons,"GEX weak / directional unlock",5);}
  if(mkt.spySpot>mkt.gammaFlip&&priceSlope>0){call+=7;pushReason(callReasons,"above gamma flip",7);}
  if(mkt.spySpot<mkt.gammaFlip&&priceSlope<0){put+=7;pushReason(putReasons,"below gamma flip",7);}
  if(Math.abs(mkt.spySpot-mkt.callWall)<0.8&&priceSlope<=0){put+=6;wait+=6;call-=7;pushReason(putReasons,"call wall rejection risk",6);pushReason(waitReasons,"near call wall",6);}
  if(Math.abs(mkt.spySpot-mkt.putWall)<0.8&&priceSlope>=0){call+=6;wait+=6;put-=7;pushReason(callReasons,"put wall bounce risk",6);pushReason(waitReasons,"near put wall",6);}
  if(range12>0&&range12<0.9){wait+=14;pushReason(waitReasons,"compressed range / pin behavior",14);}
  if(mkt.isPremarket){wait+=35;call-=20;put-=20;pushReason(waitReasons,"premarket observe-only",35);}
  const mLeft=(SESSION_END_H*60+SESSION_END_M)-(mkt.h*60+mkt.m);
  if(mLeft<90){wait+=10;call-=4;put-=4;pushReason(waitReasons,"theta window penalty",10);}
  if(mLeft<35){wait+=16;call-=6;put-=6;pushReason(waitReasons,"final theta endgame",16);}
function ncdf(x){const t=1/(1+0.2316419*Math.abs(x)),d=0.3989423*Math.exp(-x*x/2),p=d*t*(0.3193815+t*(-0.3565638+t*(1.7814779+t*(-1.8212560+t*1.3302744))));return x>0?1-p:p;}
function priceOpt(spot,strike,iv,mL,isCall){
  if(mL<=0)return Math.max(0.01,isCall?Math.max(0,spot-strike):Math.max(0,strike-spot));
  const TT=mL/(252*390),sig=iv/100,sq=Math.sqrt(TT),d1=(Math.log(spot/strike)+0.5*sig*sig*TT)/(sig*sq),d2=d1-sig*sq;
  return Math.max(0.01,Math.round((isCall?spot*ncdf(d1)-strike*ncdf(d2):strike*ncdf(-d2)-spot*ncdf(-d1))*100)/100);
}
function findStrike(spot,iv,mL,isCall){
  for(const off of[1,2,1.5,2.5,3,0.5,3.5,4,5,6,7,8]){
    const strike=isCall?Math.round((spot+off)*2)/2:Math.round((spot-off)*2)/2;
    const price=priceOpt(spot,strike,iv,mL,isCall);
    if(price>=0.13&&price<=0.28)return{strike,price};
  }
  return null;
}

async function callAI(mkt,pos,bal,hist,probs,conf,journal,approvedRules){
  const tStr=`${mkt.h}:${String(mkt.m).padStart(2,"0")} ET`,mL=(SESSION_END_H*60+SESSION_END_M)-(mkt.h*60+mkt.m);
  const theta=mL<90,div=mkt.itsSPX-mkt.itsSPY,top=Object.entries(probs).sort((a,b)=>b[1]-a[1])[0],gi=mkt.gexInfluence||0.3;
  const gexStr=`${mkt.netGex>0?"PINNING":"AMPLIFYING"} ${(gi*100).toFixed(0)}% ${gi>0.7?"[DOMINANT]":gi<0.3?"[WEAK]":"[MODERATE]"}`;
  const callOpt=!theta&&!pos&&mkt.isTradeable?findStrike(mkt.spySpot,mkt.iv,mL,true):null;
  const putOpt=!theta&&!pos&&mkt.isTradeable?findStrike(mkt.spySpot,mkt.iv,mL,false):null;
  const optStr=mkt.isPremarket?"PREMARKET — observe only"
    :callOpt||putOpt?`PRE-PRICED:\n${callOpt?`CALL: ${callOpt.strike}C @ $${callOpt.price.toFixed(2)}`:"CALL: none"}\n${putOpt?`PUT: ${putOpt.strike}P @ $${putOpt.price.toFixed(2)}`:"PUT: none"}`
    :pos?"MANAGE POSITION":"NO ENTRIES";
  const rH=hist.slice(-4).map(c=>`${c.t} SPY:${c.spySpot.toFixed(2)} SPX-ITS:${c.itsSPX.toFixed(2)} SPY-ITS:${c.itsSPY.toFixed(2)} DIV:${(c.itsSPX-c.itsSPY).toFixed(2)} ACCEL:${c.accel.toFixed(1)}`).join("\n");
  const posStr=pos?`OPEN: ${pos.strike}${pos.isCall?"C":"P"} entry $${pos.entry.toFixed(2)} now $${pos.current.toFixed(2)} (${((pos.current/pos.entry-1)*100).toFixed(0)}%)`:"NO POSITION";
  const rulesStr=approvedRules.length>0?`\nAPPROVED RULES:\n${approvedRules.map(r=>`- ${r.rule}`).join("\n")}`:"";
  const prompt=`GCDT SPY 0DTE. ${tStr} | ${mL}min | THETA:${theta?"YES":"no"}${mkt.isPremarket?" | PREMARKET":""}
BAL:$${bal.toFixed(0)} | ${posStr}

SESSION JOURNAL:
${journal.slice(-3).map(j=>`[${j.t}] ${j.entry}`).join("\n")||"Session just started."}

REGIME: ${top[0].toUpperCase()} ${top[1]}% (D:${probs.discovery} PIN:${probs.pin} T:${probs.transition} M:${probs.macro})
CONVICTION: ${conf.score}/100 | ${conf.factors.slice(0,3).map(f=>f.label+(f.delta>0?"+":"")+f.delta).join(", ")}

SPY: $${mkt.spySpot.toFixed(2)} | SPX: ${mkt.spxSpot.toFixed(0)}
SPX-ITS: ${mkt.itsSPX.toFixed(2)} | SPY-ITS: ${mkt.itsSPY.toFixed(2)} | DIV: ${div.toFixed(2)} (${div<-0.4?"SPX LEADS=conviction":div>0.4?"SPY LEADS=caution":"CONVERGED"})
Flip: $${mkt.gammaFlip.toFixed(2)} ${mkt.spySpot>mkt.gammaFlip?"ABOVE":"BELOW"} | Walls: C$${mkt.callWall.toFixed(1)} P$${mkt.putWall.toFixed(1)}
GEX: ${gexStr} | ACCEL: ${mkt.accelerator.toFixed(2)} | NDF: ${mkt.ndf.toFixed(3)} | IV: ${mkt.iv.toFixed(1)}%
FEP: $${mkt.fep.toFixed(2)} gap: ${(mkt.spySpot-mkt.fep).toFixed(2)}

${optStr}

RECENT:\n${rH}

RULES:
- SPX ITS leads SPY ITS = institutional conviction = entry signal
- SPY leads SPX at resistance = exit/avoid
- Exit: accel peaks+rolls OR FEP catches spot OR GEX regime shifts
- No entries: premarket, theta crush, in position
- GEX DOMINANT(>70%): pin/chop only | GEX WEAK(<30%): free move, higher directional conviction
${rulesStr}

Respond ONLY valid JSON:
{"decision":"WAIT|WAITING|BUY_CALL|BUY_PUT|SELL|HOLD","reasoning":"one sentence","mindset":"signal you watch most","journal_entry":"one sentence updating session narrative","edge_state":"NO_EDGE|CONDITIONS_FORMING|ENTRY_READY|IN_TRADE|EXITING","confidence_trend":"BUILDING|STABLE|DECAYING|UNCLEAR"}`;
  const resp=await fetch(TRADER_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt})});
  if(!resp.ok)throw new Error(`${resp.status}`);
  const data=await resp.json();
  if(!data.decision)throw new Error("bad shape");
  return{...data,callOpt,putOpt};
}

async function generatePatchProposals(tradeLog,mindsetLog,journal,stats){
  const prompt=`GCDT AI reviewing completed session.\nSTATS: ${JSON.stringify(stats)}\nTRADES: ${tradeLog.length===0?"None taken.":`${tradeLog.map(t=>`${t.t}: ${t.action} ${t.result||""}`).join("\n")}`}\nJOURNAL:\n${journal.map(j=>`[${j.t}] ${j.entry}`).join("\n")}\nLAST 8 DECISIONS:\n${mindsetLog.slice(-8).map(m=>`[${m.t}] ${m.edgeState} ${m.score} — ${m.reasoning}`).join("\n")}\n\nPropose 2-4 specific rule changes. Be precise and actionable.\nRespond ONLY valid JSON:\n{"proposals":[{"id":1,"rule":"specific rule text","reasoning":"why this helps","missed_opportunity":"what was missed"}]}`;
  try{
    const resp=await fetch(TRADER_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt})});
    const data=await resp.json();
    if(data.proposals)return data.proposals;
    // Try parsing from decision field if wrapped
    const txt=JSON.stringify(data);
    const match=txt.match(/"proposals"\s*:\s*(\[.*?\])/s);
    if(match)return JSON.parse(match[1]);
    return[];
  }catch{return[];}
}

function Spark({data,color,h=36,w=120,fill=false}){
  if(!data||data.length<2)return<div style={{width:w,height:h,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:8,color:"#4a5568"}}>--</span></div>;
  const mn=Math.min(...data),mx=Math.max(...data),rng=mx-mn||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*w},${h-((v-mn)/rng)*(h-4)-2}`).join(" ");
  return<svg width={w} height={h} style={{display:"block"}}>{fill&&<polygon points={`0,${h} ${pts} ${w},${h}`} fill={color} opacity={0.12}/>}<polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/></svg>;
}

function PriceChart({candles,gammaFlip,callWall,putWall,position,isPremarket}){
  const ref=useRef(null);
  const[scrollX,setScrollX]=useState(0),[drag,setDrag]=useState(false),[ds,setDs]=useState(0),[ss,setSs]=useState(0),[hov,setHov]=useState(null);
  const W=340,H=130,STEP=6,PT=6,PB=20,PL=6;
  const tot=Math.max(W,candles.length*STEP+PL+6),maxS=Math.max(0,tot-W);
  useEffect(()=>{if(!drag)setScrollX(maxS);},[candles.length,maxS,drag]);
  const sp=candles.map(c=>c.spySpot);
  const dMin=sp.length?Math.min(...sp):gammaFlip-3,dMax=sp.length?Math.max(...sp):gammaFlip+3;
  const pad=Math.max(1.2,(dMax-dMin)*0.15);
  const visL=[gammaFlip,callWall,putWall].filter(v=>v>dMin-8&&v<dMax+8);
  const mn=Math.min(dMin-pad,...visL),mx=Math.max(dMax+pad,...visL),rng=mx-mn||1;
  const toY=v=>PT+((mx-v)/rng)*(H-PT-PB),toX=i=>PL+i*STEP-scrollX;
  const down=e=>{setDrag(true);setDs(e.clientX||e.touches?.[0]?.clientX||0);setSs(scrollX);e.preventDefault();};
  const move=e=>{if(!drag)return;const cx=e.clientX||e.touches?.[0]?.clientX||0;setScrollX(Math.max(0,Math.min(maxS,ss+(ds-cx))));setHov(Math.floor(((cx-(ref.current?.getBoundingClientRect().left||0)+scrollX)-PL)/STEP));};
  const up=()=>setDrag(false);
  const openIdx=candles.findIndex(c=>c.isOpen);
  const tli=candles.reduce((a,c,i)=>{if(i%20===0||i===candles.length-1)a.push(i);return a;},[]);
  const hc=hov!=null&&hov>=0&&hov<candles.length?candles[hov]:null;
  return(
    <div>
      <div style={{background:"#141920",borderBottom:"1px solid #1a2030",padding:"4px 10px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:9,color:isPremarket?"#f0c040":"#4a5568"}}>{isPremarket?"PREMARKET":"PRICE"}</span>
        <span style={{fontSize:11,fontWeight:700,color:isPremarket?"#f0c040":"#00d4a8",fontFamily:"monospace"}}>{candles.length>0?candles[candles.length-1].t:"--:--"} ET</span>
        <span style={{fontSize:9,color:"#4a5568"}}>{hc?`${hc.t} $${hc.spySpot.toFixed(2)}`:"drag"}</span>
      </div>
      <div ref={ref} style={{overflow:"hidden",cursor:drag?"grabbing":"grab",touchAction:"none",userSelect:"none"}} onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up} onTouchStart={down} onTouchMove={move} onTouchEnd={up}>
        <svg width={W} height={H} style={{display:"block"}}>
          <rect width={W} height={H} fill="#0e1117"/>
          {openIdx>0&&(()=>{const x=toX(openIdx);if(x>0&&x<W)return<><rect x={0} y={0} width={x} height={H} fill="#f0c040" opacity={0.04}/><line x1={x} y1={PT} x2={x} y2={H-PB} stroke="#f0c040" strokeWidth={0.5} strokeDasharray="2,4" opacity={0.4}/></>;})()}
          {[{v:callWall,c:"#00d4a8",l:"CW"},{v:gammaFlip,c:"#f0c040",l:"FLIP"},{v:putWall,c:"#ff4060",l:"PW"}].map(({v,c,l})=>{const y=toY(v);if(y<PT-2||y>H-PB+2)return null;return<g key={l}><line x1={0} y1={y} x2={W} y2={y} stroke={c} strokeWidth={0.6} strokeDasharray="3,3" opacity={0.5}/><text x={W-4} y={y-2} fill={c} fontSize={7} textAnchor="end" opacity={0.8}>{l} ${v.toFixed(0)}</text></g>;})}
          {candles.length>1&&<polyline points={candles.map((c,i)=>`${toX(i)+3},${toY(c.spySpot)}`).join(" ")} fill="none" stroke="#dde4f0" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round"/>}
          {candles.length>1&&<polyline points={candles.map((c,i)=>`${toX(i)+3},${toY(c.fep)}`).join(" ")} fill="none" stroke="#4a5568" strokeWidth={0.8} strokeDasharray="2,2" opacity={0.4}/>}
          {position&&(()=>{const ei=candles.findIndex(c=>c.t===position.entryTime);if(ei<0)return null;const x=toX(ei)+3,y=toY(candles[ei].spySpot);return<circle cx={x} cy={y} r={4} fill={position.isCall?"#00d4a8":"#ff4060"} opacity={0.9}/>;})()}
          {candles.length>0&&(()=>{const x=toX(candles.length-1)+3,y=toY(candles[candles.length-1].spySpot);if(x<0||x>W)return null;return<circle cx={x} cy={y} r={3} fill="#00d4a8"/>;})()}
          {[mn+rng*0.2,mn+rng*0.5,mn+rng*0.8].map((v,i)=><text key={i} x={4} y={toY(v)} fill="#1e2530" fontSize={7} dominantBaseline="middle">${v.toFixed(0)}</text>)}
          {tli.map(i=>{const x=toX(i)+3;if(x<20||x>W-20)return null;return<text key={i} x={x} y={H-4} fill="#4a5568" fontSize={7} textAnchor="middle">{candles[i].t}</text>;})}
        </svg>
      </div>
      {maxS>0&&<div style={{height:2,background:"#1e2530",margin:"0 8px"}}><div style={{height:"100%",width:`${(W/tot)*100}%`,marginLeft:`${(scrollX/tot)*100}%`,background:"#4a5568",borderRadius:1}}/></div>}
    </div>
  );
}

function StateBars({probs}){
  const colors={discovery:"#00d4a8",pin:"#f0c040",transition:"#a78bfa",macro:"#ff4060"};
  const labels={discovery:"DISCOVERY",pin:"PIN/CHOP",transition:"TRANSITION",macro:"MACRO"};
  return(
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px 16px"}}>
      {Object.entries(probs).map(([s,p])=>(
        <div key={s}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
            <span style={{fontSize:9,color:colors[s],letterSpacing:"0.06em"}}>{labels[s]}</span>
            <span style={{fontSize:10,fontWeight:700,color:colors[s]}}>{p}%</span>
          </div>
          <div style={{height:3,background:"#1e2530",borderRadius:2}}><div style={{height:"100%",width:`${p}%`,background:colors[s],borderRadius:2,transition:"width 0.4s"}}/></div>
        </div>
      ))}
    </div>
  );
}

function storageGet(key,def){try{const v=localStorage.getItem("gcdt_v6_"+key);return v?JSON.parse(v):def;}catch{return def;}}
function storageSet(key,val){try{localStorage.setItem("gcdt_v6_"+key,JSON.stringify(val));}catch{}}

export default function App(){
  const[screen,setScreen]=useState("home");
  const[sessionMode,setSessionMode]=useState(null);
  const[running,setRunning]=useState(false);
  const[mkt,setMkt]=useState(null);
  const[pos,setPos]=useState(null);
  const[bal,setBal]=useState(STARTING_BALANCE);
  const[tradeLog,setTradeLog]=useState([]);
  const[mindsetLog,setMindsetLog]=useState([]);
  const[journal,setJournal]=useState([]);
  const[candles,setCandles]=useState([]);
  const[itsSPXHist,setItsSPXHist]=useState([]);
  const[itsSPYHist,setItsSPYHist]=useState([]);
  const[confHist,setConfHist]=useState([]);
  const[probs,setProbs]=useState({discovery:25,pin:25,transition:25,macro:25});
  const[confData,setConfData]=useState({score:50,factors:[]});
  const[timeline,setTimeline]=useState([]);
  const[timelineOpen,setTimelineOpen]=useState(false);
  const[thinking,setThinking]=useState(false);
  const[done,setDone]=useState(false);
  const[speed,setSpeed]=useState(1);
  const[aiFreq,setAiFreq]=useState(8);
  const[sessions,setSessions]=useState(()=>storageGet("sessions",[]));
  const[rules,setRules]=useState(()=>storageGet("rules",{approved:[],waitlist:[],denied:[]}));
  const[reviewSess,setReviewSess]=useState(null);
  const[saved,setSaved]=useState(false);
  const[sessionLabel,setSessionLabel]=useState("—");
  const[gexInf,setGexInf]=useState(0.08);
  const[patchProposals,setPatchProposals]=useState([]);
  const[patchIdx,setPatchIdx]=useState(0);
  const[patchDenyNote,setPatchDenyNote]=useState("");
  const[showMindsetAll,setShowMindsetAll]=useState(false);
  const[resumeAvailable,setResumeAvailable]=useState(()=>!!storageGet("interrupted",null));

  const engR=useRef(null),balR=useRef(STARTING_BALANCE),posR=useRef(null);
  const logR=useRef([]),candR=useRef([]),mindR=useRef([]),tlR=useRef([]);
  const journalR=useRef([]),probR=useRef({discovery:25,pin:25,transition:25,macro:25});
  const confR=useRef({score:50,factors:[]}),tickR=useRef(0),thinkR=useRef(false);
  const ivR=useRef(null),lastSR=useRef("transition"),sessionTickData=useRef([]),archetypeIdR=useRef(null);

  const addM=useCallback(e=>{mindR.current=[...mindR.current.slice(-100),e];setMindsetLog([...mindR.current]);},[]);
  const addJournal=useCallback((t,entry)=>{journalR.current=[...journalR.current.slice(-50),{t,entry}];setJournal([...journalR.current]);},[]);

  useEffect(()=>{
    const handler=()=>{if(engR.current&&!done){storageSet("interrupted",{bal:balR.current,pos:posR.current,log:logR.current,candles:candR.current.slice(-50),mindset:mindR.current.slice(-20),journal:journalR.current,timeline:tlR.current,sessionLabel,sessionMode,tick:tickR.current,archetypeId:archetypeIdR.current});}}
    window.addEventListener("beforeunload",handler);return()=>window.removeEventListener("beforeunload",handler);
  },[done,sessionLabel,sessionMode]);

  const doTick=useCallback(eng=>{
    const m=eng.tick();tickR.current++;
    const mL=(SESSION_END_H*60+SESSION_END_M)-(m.h*60+m.m);
    if(posR.current&&m.isTradeable){const np=priceOpt(m.spySpot,posR.current.strike,m.iv,mL,posR.current.isCall);posR.current={...posR.current,current:np};setPos({...posR.current});}
    if(m.h>=SESSION_END_H){
      if(posR.current){const p=posR.current,r=(p.current/p.entry-1)*100;balR.current*=(1+r/100);logR.current=[...logR.current,{t:"16:00",action:`AUTO-CLOSE ${p.strike}${p.isCall?"C":"P"}`,result:fmt.pct(r),pnl:r}];setTradeLog([...logR.current]);posR.current=null;setPos(null);}
      setBal(balR.current);setDone(true);setRunning(false);clearInterval(ivR.current);storageSet("interrupted",null);return;
    }
    setMkt(m);setBal(balR.current);setGexInf(m.gexInfluence||0.1);
    const c={t:fmt.time(m.h,m.m),spySpot:m.spySpot,spxSpot:m.spxSpot,itsSPX:m.itsSPX,itsSPY:m.itsSPY,accel:m.accelerator,fep:m.fep,ndf:m.ndf,gexInf:m.gexInfluence||0.1,isOpen:m.h===OPEN_H&&m.m===OPEN_M,synthData:m.synthData||false};
    candR.current=[...candR.current.slice(-320),c];setCandles([...candR.current]);
    sessionTickData.current.push({tick:tickR.current,t:c.t,spySpot:m.spySpot,spxSpot:m.spxSpot,itsSPX:m.itsSPX,itsSPY:m.itsSPY,div:m.itsSPX-m.itsSPY,accel:m.accelerator,fep:m.fep,ndf:m.ndf,iv:m.iv,gexInf:m.gexInfluence||0.1,netGex:m.netGex,conviction:confR.current.score});
    const np=computeProbs(m,candR.current),nc=computeConf(m,np);
    probR.current=np;confR.current=nc;setProbs({...np});setConfData({...nc});
    setConfHist(prev=>[...prev.slice(-150),nc.score]);
    setItsSPXHist(prev=>[...prev.slice(-150),m.itsSPX]);
    setItsSPYHist(prev=>[...prev.slice(-150),m.itsSPY]);
    const top=Object.entries(np).sort((a,b)=>b[1]-a[1])[0][0];
    if(top!==lastSR.current){lastSR.current=top;tlR.current=[...tlR.current,{t:fmt.time(m.h,m.m),state:top,probs:{...np}}];setTimeline([...tlR.current]);}
    if(tickR.current%aiFreq===0&&!thinkR.current){
      thinkR.current=true;setThinking(true);
      callAI(m,posR.current,balR.current,candR.current,probR.current,confR.current,journalR.current,rules.approved)
        .then(dec=>{
          const ts=fmt.time(m.h,m.m),mLn=(SESSION_END_H*60+SESSION_END_M)-(m.h*60+m.m);
          addM({t:ts,mindset:dec.mindset||"—",reasoning:dec.reasoning||"—",decision:dec.decision,score:confR.current.score,edgeState:dec.edge_state||"—",confTrend:dec.confidence_trend||"—"});
          if(dec.journal_entry)addJournal(ts,dec.journal_entry);
          if(dec.decision==="SELL"&&posR.current){const p=posR.current,r=(p.current/p.entry-1)*100;balR.current*=(1+r/100);setBal(balR.current);logR.current=[...logR.current,{t:ts,action:`SELL ${p.strike}${p.isCall?"C":"P"} @$${p.current.toFixed(2)}`,result:fmt.pct(r),pnl:r}];setTradeLog([...logR.current]);posR.current=null;setPos(null);}
          else if((dec.decision==="BUY_CALL"||dec.decision==="BUY_PUT")&&!posR.current&&mLn>=90&&m.isTradeable){const isC=dec.decision==="BUY_CALL",opt=isC?dec.callOpt:dec.putOpt;if(opt){posR.current={strike:opt.strike,isCall:isC,entry:opt.price,current:opt.price,entryTime:ts,entrySpot:m.spySpot};setPos({...posR.current});logR.current=[...logR.current,{t:ts,action:`${isC?"BUY CALL":"BUY PUT"} ${opt.strike}${isC?"C":"P"} @$${opt.price.toFixed(2)}`,result:null}];setTradeLog([...logR.current]);}}
        })
        .catch(e=>addM({t:fmt.time(m.h,m.m),mindset:"API error",reasoning:e.message,decision:"WAIT",score:0,edgeState:"—",confTrend:"—"}))
        .finally(()=>{thinkR.current=false;setThinking(false);});
    }
  },[aiFreq,addM,addJournal,rules.approved]);

  useEffect(()=>{if(!running||!engR.current)return;ivR.current=setInterval(()=>doTick(engR.current),Math.max(150,BASE_TICK_MS/speed));return()=>clearInterval(ivR.current);},[running,speed,doTick]);

  const startSession=useCallback((mode)=>{
    engR.current=mode==="replay"?createReplayEngine(SPX_JUL1):createSeedEngine();
    const sess=engR.current.getSession();
    archetypeIdR.current=mode==="seed"?sess.archetype:null;
    const label=mode==="replay"?`${SPX_JUL1.label} · ${SPX_JUL1.dayType}`:`SEED · ${sess.archetypeLabel} (modeled: ${sess.sourceDay})`;
    setSessionLabel(label);setSessionMode(mode);setBal(STARTING_BALANCE);balR.current=STARTING_BALANCE;
    setPos(null);posR.current=null;setTradeLog([]);logR.current=[];setMindsetLog([]);mindR.current=[];
    setJournal([]);journalR.current=[];setCandles([]);candR.current=[];setConfHist([]);
    setItsSPXHist([]);setItsSPYHist([]);setTimeline([]);tlR.current=[];
    setProbs({discovery:25,pin:25,transition:25,macro:25});setConfData({score:50,factors:[]});
    lastSR.current="transition";tickR.current=0;thinkR.current=false;sessionTickData.current=[];
    setDone(false);setSaved(false);setGexInf(0.08);setPatchProposals([]);setPatchIdx(0);
    storageSet("interrupted",null);setRunning(true);setScreen("trading");
  },[]);

  const resumeSession=useCallback(()=>{
    const sv=storageGet("interrupted",null);if(!sv)return;
    balR.current=sv.bal;setBal(sv.bal);if(sv.pos){posR.current=sv.pos;setPos(sv.pos);}
    logR.current=sv.log||[];setTradeLog([...logR.current]);mindR.current=sv.mindset||[];setMindsetLog([...mindR.current]);
    journalR.current=sv.journal||[];setJournal([...journalR.current]);candR.current=sv.candles||[];setCandles([...candR.current]);
    tlR.current=sv.timeline||[];setTimeline([...tlR.current]);setSessionLabel(sv.sessionLabel||"RESUMED");setSessionMode(sv.sessionMode||"seed");
    archetypeIdR.current=sv.archetypeId||null;
    engR.current=sv.sessionMode==="replay"?createReplayEngine(SPX_JUL1):createSeedEngine(sv.archetypeId);
    for(let i=0;i<Math.min(sv.tick||0,400);i++)engR.current.tick();
    tickR.current=sv.tick||0;setDone(false);setRunning(true);setScreen("trading");storageSet("interrupted",null);setResumeAvailable(false);
  },[]);

  const fastFwd=useCallback(()=>{
    if(!engR.current)return;clearInterval(ivR.current);setRunning(false);
    const eng=engR.current;let m=eng.peek();
    while(!(m.h>=SESSION_END_H)){m=eng.tick();tickR.current++;const mL=(SESSION_END_H*60+SESSION_END_M)-(m.h*60+m.m);if(posR.current&&m.isTradeable){const np=priceOpt(m.spySpot,posR.current.strike,m.iv,mL,posR.current.isCall);posR.current={...posR.current,current:np};}}
    if(posR.current){const p=posR.current,r=(p.current/p.entry-1)*100;balR.current*=(1+r/100);logR.current=[...logR.current,{t:"16:00",action:`AUTO-CLOSE ${p.strike}${p.isCall?"C":"P"}`,result:fmt.pct(r),pnl:r}];setTradeLog([...logR.current]);posR.current=null;setPos(null);}
    setMkt(m);setBal(balR.current);setDone(true);storageSet("interrupted",null);
  },[]);

  const saveSession=useCallback(async()=>{
    const r=((balR.current-STARTING_BALANCE)/STARTING_BALANCE)*100,cl=logR.current.filter(l=>l.pnl!==undefined),ws=cl.filter(l=>(l.pnl||0)>=0);
    const sess={id:Date.now(),name:`SIM · ${sessionLabel} · ${r>=0?"+":""}${r.toFixed(0)}%`,date:new Date().toLocaleDateString(),balance:balR.current,returnPct:r,trades:logR.current,mindset:mindR.current,journal:journalR.current,timeline:tlR.current,winRate:cl.length>0?`${ws.length}/${cl.length}`:"—",label:sessionLabel,tickData:sessionTickData.current};
    const upd=[sess,...sessions];setSessions(upd);storageSet("sessions",upd);setSaved(true);
    setThinking(true);
    try{const props=await generatePatchProposals(logR.current,mindR.current,journalR.current,{balance:balR.current,returnPct:r,trades:cl.length,wins:ws.length,label:sessionLabel});if(props.length>0){setPatchProposals(props);setPatchIdx(0);setScreen("patch");}}catch(e){console.log("patch gen failed",e);}
    setThinking(false);
  },[sessions,sessionLabel]);

  const handlePatch=useCallback((action,denyNote="")=>{
    const prop=patchProposals[patchIdx];if(!prop)return;
    const nr={...rules};
    if(action==="approve")nr.approved=[...rules.approved,{id:Date.now(),rule:prop.rule,reasoning:prop.reasoning,date:new Date().toLocaleDateString()}];
    else if(action==="waitlist")nr.waitlist=[...rules.waitlist,{...prop,date:new Date().toLocaleDateString()}];
    else if(action==="deny")nr.denied=[...(rules.denied||[]),{...prop,note:denyNote,date:new Date().toLocaleDateString()}];
    setRules(nr);storageSet("rules",nr);
    if(patchIdx<patchProposals.length-1){setPatchIdx(i=>i+1);setPatchDenyNote("");}else{setScreen("home");}
  },[rules,patchProposals,patchIdx]);

  const pnl=((bal-STARTING_BALANCE)/STARTING_BALANCE)*100;
  const topS=Object.entries(probs).sort((a,b)=>b[1]-a[1])[0];
  const topColors={discovery:T.accent,pin:T.yellow,transition:T.purple,macro:T.red};
  const topColor=topColors[topS[0]];
  const posPnl=pos?(pos.current/pos.entry-1)*100:0;
  const mLeft=mkt?(SESSION_END_H*60+SESSION_END_M)-(mkt.h*60+mkt.m):390;
  const isPremarket=mkt?.isPremarket||false;
  const lastM=mindsetLog[mindsetLog.length-1];
  const div=mkt?(mkt.itsSPX-mkt.itsSPY):0;
  const divColor=div<-0.5?T.accent:div>0.5?T.red:T.yellow;

  if(screen==="home")return(
    <div style={{background:T.bg,minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"monospace"}}>
      <div style={{fontSize:9,color:T.muted,letterSpacing:"0.2em",marginBottom:8}}>FIRSTSIGNAL OS v3</div>
      <div style={{fontSize:26,fontWeight:700,color:T.accent,marginBottom:4}}>GCDT</div>
      <div style={{fontSize:9,color:T.muted,marginBottom:28,textAlign:"center",opacity:0.6}}>GEX Composite Divergence Trading</div>
      {resumeAvailable&&<button onClick={resumeSession} style={{width:"100%",maxWidth:280,padding:"11px 0",background:T.yellowDim,color:T.yellow,border:`1px solid ${T.yellow}40`,borderRadius:6,fontFamily:"monospace",fontSize:11,fontWeight:700,cursor:"pointer",marginBottom:10}}>RESUME SESSION ↩</button>}
      <div style={{width:"100%",maxWidth:280,marginBottom:16}}>
        <div style={{fontSize:9,color:T.muted,marginBottom:8,textAlign:"center",letterSpacing:"0.1em"}}>NEW SESSION</div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>startSession("seed")} style={{flex:1,padding:"12px 0",background:T.accentDim,color:T.accent,border:`1px solid ${T.accent}40`,borderRadius:6,fontFamily:"monospace",fontSize:11,fontWeight:700,cursor:"pointer"}}>SEED<div style={{fontSize:8,opacity:0.7,marginTop:2}}>6 real archetypes</div></button>
          <button onClick={()=>startSession("replay")} style={{flex:1,padding:"12px 0",background:"#a78bfa18",color:T.purple,border:`1px solid ${T.purple}40`,borderRadius:6,fontFamily:"monospace",fontSize:11,fontWeight:700,cursor:"pointer"}}>REPLAY<div style={{fontSize:8,opacity:0.7,marginTop:2}}>SPX Jul 1</div></button>
        </div>
      </div>
      <div style={{width:"100%",maxWidth:280,display:"flex",gap:8,marginBottom:16}}>
        <button onClick={()=>setScreen("sessions")} style={{flex:1,padding:"10px 0",background:"transparent",color:T.muted,border:`1px solid ${T.border}`,borderRadius:6,fontFamily:"monospace",fontSize:10,cursor:"pointer"}}>SESSIONS ({sessions.length})</button>
        <button onClick={()=>setScreen("rulebook")} style={{flex:1,padding:"10px 0",background:"transparent",color:T.muted,border:`1px solid ${T.border}`,borderRadius:6,fontFamily:"monospace",fontSize:10,cursor:"pointer"}}>RULES ({rules.approved.length})</button>
      </div>
      {sessions.length>0&&<div style={{width:"100%",maxWidth:280,padding:"10px 12px",background:T.surface,borderRadius:6,border:`1px solid ${T.border}`}}><div style={{fontSize:9,color:T.muted,marginBottom:3}}>LAST SESSION</div><div style={{fontSize:10,color:T.text}}>{sessions[0].name}</div><div style={{fontSize:9,color:T.muted,marginTop:2}}>{sessions[0].date} · W/L {sessions[0].winRate}</div></div>}
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
            <div style={{display:"flex",gap:10}}><span style={{fontSize:9,color:T.muted}}>{s.date}</span><span style={{fontSize:9,color:s.returnPct>=0?T.accent:T.red}}>{fmt.pct(s.returnPct)}</span><span style={{fontSize:9,color:T.muted}}>W/L {s.winRate}</span></div>
          </div>
        ))}
      </div>
    </div>
  );

  if(screen==="review"&&reviewSess){const s=reviewSess;return(
    <div style={{background:T.bg,minHeight:"100vh",fontFamily:"monospace",color:T.text,overflowY:"auto"}}>
      <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:"12px 16px",display:"flex",alignItems:"center",gap:12}}>
        <button onClick={()=>setScreen("sessions")} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:16}}>←</button>
        <span style={{fontSize:11,color:T.accent,fontWeight:700}}>{s.name}</span>
      </div>
      <div style={{padding:16}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
          {[["FINAL",fmt.bal(s.balance)],["RETURN",fmt.pct(s.returnPct)],["WIN RATE",s.winRate],["TRADES",String(s.trades.length)]].map(([l,v])=>(
            <div key={l} style={{padding:"10px 12px",background:T.surface,borderRadius:6,border:`1px solid ${T.border}`}}><div style={{fontSize:9,color:T.muted,marginBottom:3}}>{l}</div><div style={{fontSize:13,fontWeight:700}}>{v}</div></div>
          ))}
        </div>
        {s.journal?.length>0&&<><div style={{fontSize:10,color:T.muted,marginBottom:8}}>SESSION JOURNAL</div>{s.journal.map((j,i)=><div key={i} style={{fontSize:9,color:T.muted,marginBottom:4,paddingLeft:8,borderLeft:`2px solid ${T.border}`}}><span style={{color:T.accent}}>{j.t}</span> {j.entry}</div>)}</>}
        <div style={{fontSize:10,color:T.muted,marginTop:12,marginBottom:8}}>TRADES</div>
        {s.trades.length===0&&<div style={{fontSize:10,color:T.dim}}>No trades.</div>}
        {s.trades.map((t,i)=><div key={i} style={{padding:"8px 12px",background:T.surface,borderRadius:4,border:`1px solid ${(t.pnl||0)>=0?T.accent+"40":T.red+"40"}`,marginBottom:6}}><div style={{fontSize:10}}>{t.action}</div><div style={{fontSize:9,color:(t.pnl||0)>=0?T.accent:T.red}}>{t.t} {t.result}</div></div>)}
      </div>
    </div>
  );}

  if(screen==="rulebook")return(
    <div style={{background:T.bg,minHeight:"100vh",fontFamily:"monospace",color:T.text,overflowY:"auto"}}>
      <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:"12px 16px",display:"flex",alignItems:"center",gap:12}}>
        <button onClick={()=>setScreen("home")} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:16}}>←</button>
        <span style={{fontSize:12,fontWeight:700,color:T.accent}}>RULE BOOK</span>
      </div>
      <div style={{padding:16}}>
        <div style={{fontSize:10,color:T.accent,marginBottom:8}}>APPROVED ({rules.approved.length})</div>
        {rules.approved.length===0&&<div style={{fontSize:9,color:T.dim,marginBottom:16}}>No approved rules yet.</div>}
        {rules.approved.map((r,i)=><div key={i} style={{padding:"10px 12px",background:T.surface,borderRadius:6,border:`1px solid ${T.accent}30`,marginBottom:8}}><div style={{fontSize:10,color:T.text,marginBottom:4}}>{r.rule}</div><div style={{fontSize:9,color:T.muted}}>{r.date} · {r.reasoning}</div></div>)}
        <div style={{fontSize:10,color:T.yellow,marginTop:16,marginBottom:8}}>WAITLIST ({rules.waitlist.length})</div>
        {rules.waitlist.map((r,i)=><div key={i} style={{padding:"10px 12px",background:T.surface,borderRadius:6,border:`1px solid ${T.yellow}30`,marginBottom:8}}><div style={{fontSize:10,color:T.text,marginBottom:4}}>{r.rule}</div><div style={{fontSize:9,color:T.muted}}>{r.reasoning}</div><button onClick={()=>{const nr={...rules};nr.approved=[...nr.approved,{...r,date:new Date().toLocaleDateString()}];nr.waitlist=nr.waitlist.filter((_,j)=>j!==i);setRules(nr);storageSet("rules",nr);}} style={{marginTop:6,padding:"3px 8px",background:T.accentDim,color:T.accent,border:`1px solid ${T.accent}40`,borderRadius:3,fontFamily:"monospace",fontSize:8,cursor:"pointer"}}>APPROVE NOW</button></div>)}
      </div>
    </div>
  );

  if(screen==="patch"){const prop=patchProposals[patchIdx];return(
    <div style={{background:T.bg,minHeight:"100vh",fontFamily:"monospace",color:T.text,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{fontSize:9,color:T.muted,marginBottom:4}}>PATCH PROPOSAL {patchIdx+1} of {patchProposals.length}</div>
      <div style={{fontSize:12,fontWeight:700,color:T.accent,marginBottom:16}}>RULE REVIEW</div>
      {prop&&<div style={{width:"100%",maxWidth:320,background:T.surface,borderRadius:8,border:`1px solid ${T.border}`,padding:16,marginBottom:16}}>
        <div style={{fontSize:11,color:T.text,marginBottom:10,lineHeight:1.5}}>{prop.rule}</div>
        <div style={{fontSize:9,color:T.muted,marginBottom:6}}><span style={{color:T.yellow}}>WHY: </span>{prop.reasoning}</div>
        <div style={{fontSize:9,color:T.muted}}><span style={{color:T.red}}>MISSED: </span>{prop.missed_opportunity}</div>
      </div>}
      <div style={{width:"100%",maxWidth:320,display:"flex",gap:8,marginBottom:12}}>
        <button onClick={()=>handlePatch("approve")} style={{flex:1,padding:"10px 0",background:T.accentDim,color:T.accent,border:`1px solid ${T.accent}40`,borderRadius:4,fontFamily:"monospace",fontSize:10,fontWeight:700,cursor:"pointer"}}>✓ APPROVE</button>
        <button onClick={()=>handlePatch("waitlist")} style={{flex:1,padding:"10px 0",background:T.yellowDim,color:T.yellow,border:`1px solid ${T.yellow}40`,borderRadius:4,fontFamily:"monospace",fontSize:10,cursor:"pointer"}}>WAITLIST</button>
      </div>
      <div style={{width:"100%",maxWidth:320}}>
        <input value={patchDenyNote} onChange={e=>setPatchDenyNote(e.target.value)} placeholder="Required: your reason for denying" style={{width:"100%",padding:"8px 10px",background:T.surface2,border:`1px solid ${T.border}`,borderRadius:4,fontFamily:"monospace",fontSize:10,color:T.text,marginBottom:8,boxSizing:"border-box"}}/>
        <button onClick={()=>{if(patchDenyNote.trim())handlePatch("deny",patchDenyNote);}} disabled={!patchDenyNote.trim()} style={{width:"100%",padding:"10px 0",background:T.redDim,color:T.red,border:`1px solid ${T.red}40`,borderRadius:4,fontFamily:"monospace",fontSize:10,cursor:"pointer",opacity:patchDenyNote.trim()?1:0.4}}>✗ DENY</button>
      </div>
      <button onClick={()=>setScreen("home")} style={{marginTop:16,padding:"8px 20px",background:"transparent",color:T.muted,border:`1px solid ${T.border}`,borderRadius:4,fontFamily:"monospace",fontSize:9,cursor:"pointer"}}>SKIP ALL → HOME</button>
    </div>
  );}

  return(
    <div style={{background:T.bg,minHeight:"100vh",fontFamily:"monospace",color:T.text,display:"flex",flexDirection:"column"}}>
      <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:"6px 14px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:3}}>
          <div style={{display:"flex",alignItems:"center",gap:7}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:running?T.accent:done?T.muted:T.yellow,boxShadow:running?`0 0 6px ${T.accent}`:"none"}}/>
            <span style={{fontSize:9,fontWeight:700,color:T.accent}}>GCDT · FS OS v3</span>
            {isPremarket&&<span style={{fontSize:7,color:T.yellow,border:`1px solid ${T.yellow}40`,padding:"1px 4px",borderRadius:2}}>PRE</span>}
            {mkt?.synthData&&<span style={{fontSize:7,color:T.purple,border:`1px solid ${T.purple}40`,padding:"1px 4px",borderRadius:2}}>SYNTH</span>}
            {thinking&&<span style={{fontSize:9,color:T.yellow}}>◈</span>}
          </div>
          <div style={{display:"flex",gap:6}}>
            {running&&<><button onClick={fastFwd} style={{padding:"3px 7px",background:T.yellowDim,color:T.yellow,border:`1px solid ${T.yellow}40`,borderRadius:3,fontFamily:"monospace",fontSize:8,cursor:"pointer"}}>END</button><button onClick={()=>{setRunning(false);clearInterval(ivR.current);}} style={{padding:"3px 7px",background:T.redDim,color:T.red,border:`1px solid ${T.red}40`,borderRadius:3,fontFamily:"monospace",fontSize:8,cursor:"pointer"}}>PAUSE</button></>}
            {!running&&!done&&mkt&&<button onClick={()=>setRunning(true)} style={{padding:"3px 8px",background:T.accentDim,color:T.accent,border:`1px solid ${T.accent}40`,borderRadius:3,fontFamily:"monospace",fontSize:8,cursor:"pointer"}}>RESUME</button>}
          </div>
        </div>
        <div style={{fontSize:8,color:T.muted,marginBottom:2}}>{sessionLabel}{sessionMode==="seed"&&mkt?.fidelity&&<span style={{color:mkt.fidelity==="dense-series"?T.accent:T.yellow}}> · {mkt.fidelity==="dense-series"?"dense (Jul 1 series)":"sparse (field-log range)"}</span>}</div>
        <div style={{fontSize:7,color:T.purple,marginBottom:2,opacity:0.85}}>{sessionMode==="seed"?"Archetype-modeled from real logged days — not real ticks":"SPX anchored to real Jul 1 snapshots · gaps synthesized, converge on schedule"}</div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {mkt&&<span style={{fontSize:10,color:isPremarket?T.yellow:T.muted,fontWeight:700}}>{fmt.time(mkt.h,mkt.m)} ET</span>}
          {mLeft<90&&!isPremarket&&<span style={{fontSize:8,color:T.red}}>THETA</span>}
          <span style={{fontSize:13,fontWeight:700,color:pnl>=0?T.accent:T.red}}>{fmt.bal(bal)}</span>
          <span style={{fontSize:9,color:pnl>=0?T.accent:T.red}}>{fmt.pct(pnl)}</span>
          <span style={{fontSize:8,color:topColor,marginLeft:"auto"}}>{topS[0].toUpperCase()} {topS[1]}%</span>
        </div>
        {lastM&&<div style={{marginTop:4,padding:"4px 8px",background:T.surface2,borderRadius:4,borderLeft:`2px solid ${lastM.decision?.includes("BUY")?T.yellow:lastM.decision==="SELL"?T.accent:lastM.edgeState==="NO_EDGE"?T.red:T.border}`}}>
          <div style={{display:"flex",justifyContent:"space-between"}}>
            <span style={{fontSize:8,color:T.yellow}}>👁 {lastM.mindset}</span>
            <span style={{fontSize:7,color:T.muted}}>{lastM.edgeState} [{lastM.score}]</span>
          </div>
        </div>}
      </div>

      {pos&&<div style={{margin:"6px 14px 0",padding:"7px 12px",background:posPnl>=0?T.accentDim:T.redDim,border:`1px solid ${posPnl>=0?T.accent:T.red}40`,borderRadius:6,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><div style={{fontSize:8,color:T.muted}}>OPEN · {pos.entryTime}</div><div style={{fontSize:12,fontWeight:700}}>{pos.strike}{pos.isCall?"C":"P"} · ${pos.entry.toFixed(2)}</div></div>
        <div style={{textAlign:"right"}}><div style={{fontSize:15,fontWeight:700,color:posPnl>=0?T.accent:T.red}}>${pos.current.toFixed(2)}</div><div style={{fontSize:9,color:posPnl>=0?T.accent:T.red}}>{fmt.pct(posPnl)}</div></div>
      </div>}

      <div style={{flex:1,overflowY:"auto",paddingBottom:20}}>
        {mkt&&<div style={{background:T.surface,borderRadius:8,border:`1px solid ${isPremarket?T.yellow+"40":T.border}`,margin:"8px 14px",overflow:"hidden"}}>
          <PriceChart candles={candles} gammaFlip={mkt.gammaFlip} callWall={mkt.callWall} putWall={mkt.putWall} position={pos} isPremarket={isPremarket}/>
          <div style={{padding:"7px 12px",borderTop:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{fontSize:18,fontWeight:700}}>${mkt.spySpot.toFixed(2)}</div><div style={{fontSize:8,color:mkt.spySpot>mkt.gammaFlip?T.accent:T.red}}>{mkt.spySpot>mkt.gammaFlip?"▲":"▼"} FLIP ${mkt.gammaFlip.toFixed(1)}</div></div>
            <div style={{textAlign:"center"}}><div style={{fontSize:9,color:T.muted}}>SPX</div><div style={{fontSize:12,fontWeight:700,color:T.purple}}>{mkt.spxSpot.toFixed(0)}</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:10,fontWeight:700,color:mkt.netGex>0?T.accent:T.red}}>{fmt.gex(mkt.netGex)}</div><div style={{fontSize:7,color:mkt.netGex>0?T.accent:T.red}}>{mkt.netGex>0?"PIN":"AMP"} {(gexInf*100).toFixed(0)}%</div></div>
          </div>
        </div>}

        {mkt&&<div style={{background:T.surface,borderRadius:8,border:`1px solid ${T.border}`,margin:"0 14px 8px",padding:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:9,color:T.muted,letterSpacing:"0.1em"}}>ITS SIGNAL</span>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:8,color:T.muted}}>DIV</span>
              <span style={{fontSize:20,fontWeight:700,color:divColor}}>{div>=0?"+":""}{div.toFixed(2)}</span>
              <span style={{fontSize:8,color:divColor}}>{Math.abs(div)<0.3?"CONVERGED":div<-0.5?"SPX LEADS":"SPY LEADS"}</span>
            </div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <div style={{flex:1,background:T.surface2,borderRadius:6,padding:"8px 10px"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:8,color:T.purple}}>SPX ITS</span>
                <span style={{fontSize:11,fontWeight:700,color:T.purple}}>{mkt.itsSPX.toFixed(2)}</span>
              </div>
              <Spark data={itsSPXHist} color={T.purple} h={32} w={130} fill={true}/>
              <div style={{fontSize:8,color:T.muted,marginTop:3}}>{mkt.spxSpot.toFixed(0)}</div>
              <div style={{fontSize:6,color:sessionMode==="replay"&&!mkt.synthData?T.accent:T.yellow,marginTop:2,letterSpacing:"0.04em"}}>{sessionMode==="replay"?(mkt.synthData?"SYNTH · gap-fill":"REAL · Jul 1 snapshot"):"SYNTH · archetype"}</div>
            </div>
            <div style={{flex:1,background:T.surface2,borderRadius:6,padding:"8px 10px"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:8,color:T.text}}>SPY ITS</span>
                <span style={{fontSize:11,fontWeight:700,color:T.text}}>{mkt.itsSPY.toFixed(2)}</span>
              </div>
              <Spark data={itsSPYHist} color={T.text} h={32} w={130} fill={false}/>
              <div style={{fontSize:8,color:T.muted,marginTop:3}}>${mkt.spySpot.toFixed(2)}</div>
              <div style={{fontSize:6,color:T.yellow,marginTop:2,letterSpacing:"0.04em"}}>SYNTH · lag-derived (always)</div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginTop:8}}>
            {[["NDF",(mkt.ndf>=0?"+":"")+mkt.ndf.toFixed(3),mkt.ndf>0.1?T.accent:mkt.ndf<-0.1?T.red:T.muted],["FEP GAP",(mkt.spySpot-mkt.fep>=0?"+":"")+(mkt.spySpot-mkt.fep).toFixed(2),Math.abs(mkt.spySpot-mkt.fep)>1.5?T.yellow:T.muted],["IV",mkt.iv.toFixed(1)+"%",T.muted]].map(([l,v,c])=>(
              <div key={l}><div style={{fontSize:8,color:T.muted}}>{l}</div><div style={{fontSize:11,fontWeight:700,color:c}}>{v}</div></div>
            ))}
          </div>
        </div>}

        {mkt&&<div style={{background:T.surface,borderRadius:8,border:`1px solid ${T.border}`,margin:"0 14px 8px",padding:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <span style={{fontSize:9,color:T.muted,letterSpacing:"0.1em"}}>REGIME STATE</span>
            <span style={{fontSize:10,fontWeight:700,color:topColor}}>{topS[0].toUpperCase()} {topS[1]}%</span>
          </div>
          <StateBars probs={probs}/>
          <div style={{marginTop:8}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
              <span style={{fontSize:8,color:T.muted}}>GEX INFLUENCE</span>
              <span style={{fontSize:8,color:gexInf>0.7?T.red:gexInf<0.28?T.accent:T.yellow}}>{gexInf>0.7?"DOMINANT":gexInf<0.28?"WEAK":"MODERATE"} {(gexInf*100).toFixed(0)}%</span>
            </div>
            <div style={{height:3,background:T.dim,borderRadius:2}}><div style={{height:"100%",width:`${gexInf*100}%`,background:gexInf>0.7?T.red:gexInf<0.28?T.accent:T.yellow,borderRadius:2,transition:"width 0.5s"}}/></div>
          </div>
          <div style={{height:1,background:T.border,margin:"10px 0"}}/>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
            <span style={{fontSize:9,color:T.muted}}>CONVICTION</span>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              {lastM&&<span style={{fontSize:8,color:lastM.confTrend==="BUILDING"?T.accent:lastM.confTrend==="DECAYING"?T.red:T.yellow}}>{lastM.confTrend}</span>}
              <span style={{fontSize:17,fontWeight:700,color:confData.score>65?T.accent:confData.score<40?T.red:T.yellow}}>{confData.score}</span>
            </div>
          </div>
          <Spark data={confHist} color={confData.score>65?T.accent:confData.score<40?T.red:T.yellow} h={42} w={308} fill={true}/>
          {confData.factors.length>0&&<div style={{marginTop:8}}>
            {confData.factors.slice(0,5).map((f,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3,paddingBottom:3,borderBottom:i<confData.factors.length-1?`1px solid ${T.dim}`:"none"}}>
                <span style={{fontSize:8,color:T.muted}}>{f.label}</span>
                <span style={{fontSize:9,fontWeight:700,color:f.delta>0?T.accent:T.red}}>{f.delta>0?"+":""}{f.delta}</span>
              </div>
            ))}
          </div>}
          <div style={{marginTop:8}}>
            <button onClick={()=>setTimelineOpen(o=>!o)} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:9,padding:0,display:"flex",alignItems:"center",gap:4}}>
              <span>{timelineOpen?"▼":"▶"}</span><span>REGIME TIMELINE ({timeline.length})</span>
            </button>
            {timelineOpen&&<div style={{marginTop:6}}>
              {timeline.map((r,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                  <span style={{fontSize:8,color:T.muted,minWidth:36}}>{r.t}</span>
                  <div style={{width:3,height:12,background:topColors[r.state]||T.muted,borderRadius:2,flexShrink:0}}/>
                  <span style={{fontSize:9,color:topColors[r.state]||T.muted,fontWeight:700}}>{r.state.toUpperCase()}</span>
                  <span style={{fontSize:8,color:T.muted,marginLeft:"auto"}}>D:{r.probs.discovery}%</span>
                </div>
              ))}
            </div>}
          </div>
        </div>}

        <div style={{background:T.surface,borderRadius:8,border:`1px solid ${T.border}`,margin:"0 14px 8px",padding:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:9,color:T.muted,letterSpacing:"0.1em"}}>AI MINDSET</span>
              <button onClick={()=>setShowMindsetAll(o=>!o)} style={{fontSize:7,color:T.muted,background:"none",border:`1px solid ${T.border}`,borderRadius:3,padding:"1px 5px",cursor:"pointer"}}>{showMindsetAll?`ALL ${mindsetLog.length}`:"RECENT 5"}</button>
            </div>
            {thinking&&<div style={{fontSize:9,color:T.yellow}}>◈ deciding...</div>}
          </div>
          {journal.length>0&&<div style={{marginBottom:8,padding:"6px 8px",background:T.surface2,borderRadius:4,borderLeft:`2px solid ${T.purple}`}}>
            <div style={{fontSize:8,color:T.purple,marginBottom:3}}>SESSION JOURNAL</div>
            {journal.slice(-2).map((j,i)=><div key={i} style={{fontSize:8,color:T.muted,marginBottom:2}}><span style={{color:T.accent}}>{j.t}</span> {j.entry}</div>)}
          </div>}
          {mindsetLog.length===0&&<div style={{fontSize:9,color:T.dim,textAlign:"center",padding:"10px 0"}}>Waiting...</div>}
          {(showMindsetAll?[...mindsetLog].reverse():[...mindsetLog].reverse().slice(0,5)).map((e,i)=>(
            <div key={i} style={{marginBottom:7,padding:"7px 9px",borderRadius:4,background:T.surface2,borderLeft:`2px solid ${e.decision?.includes("BUY")?T.yellow:e.decision==="SELL"?T.accent:e.edgeState==="NO_EDGE"?T.red:T.border}`}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                <span style={{fontSize:7,color:T.muted}}>{e.t}</span>
                <span style={{fontSize:7,color:T.muted}}>{e.edgeState} [{e.score}]</span>
              </div>
              <div style={{fontSize:9,color:T.yellow,marginBottom:2}}>👁 {e.mindset}</div>
              <div style={{fontSize:8,color:T.muted}}>{e.reasoning}</div>
            </div>
          ))}
        </div>

        {tradeLog.length>0&&<div style={{background:T.surface,borderRadius:8,border:`1px solid ${T.border}`,margin:"0 14px 8px",padding:12}}>
          <div style={{fontSize:9,color:T.muted,letterSpacing:"0.1em",marginBottom:8}}>TRADE LOG</div>
          {tradeLog.map((t,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",marginBottom:5,paddingBottom:5,borderBottom:i<tradeLog.length-1?`1px solid ${T.dim}`:"none"}}>
              <div><div style={{fontSize:9,color:T.text}}>{t.action}</div><div style={{fontSize:7,color:T.muted}}>{t.t}</div></div>
              {t.result&&<div style={{fontSize:10,fontWeight:700,color:(t.pnl||0)>=0?T.accent:T.red}}>{t.result}</div>}
            </div>
          ))}
        </div>}

        <div style={{background:T.surface,borderRadius:8,border:`1px solid ${T.border}`,margin:"0 14px 8px",padding:12}}>
          <div style={{fontSize:8,color:T.muted,marginBottom:5}}>SPEED · {speed}x</div>
          <input type="range" min="0.5" max="10" step="0.5" value={speed} onChange={e=>setSpeed(Number(e.target.value))} style={{width:"100%",accentColor:T.accent,marginBottom:8}}/>
          <div style={{fontSize:8,color:T.muted,marginBottom:5}}>AI EVERY</div>
          <div style={{display:"flex",gap:5}}>
            {[5,8,12,20].map(n=><button key={n} onClick={()=>setAiFreq(n)} style={{flex:1,padding:"4px 0",background:aiFreq===n?T.accent:"transparent",color:aiFreq===n?T.bg:T.muted,border:`1px solid ${aiFreq===n?T.accent:T.border}`,borderRadius:3,fontFamily:"monospace",fontSize:8,cursor:"pointer"}}>{n}t</button>)}
          </div>
        </div>

        {done&&<div style={{background:pnl>=0?T.accentDim:T.redDim,borderRadius:8,border:`1px solid ${pnl>=0?T.accent:T.red}40`,margin:"0 14px 8px",padding:16,textAlign:"center"}}>
          <div style={{fontSize:9,color:T.muted,marginBottom:3}}>SESSION COMPLETE</div>
          <div style={{fontSize:9,color:T.muted,marginBottom:8}}>{sessionLabel}</div>
          <div style={{fontSize:26,fontWeight:700,color:pnl>=0?T.accent:T.red}}>{fmt.bal(bal)}</div>
          <div style={{fontSize:13,color:pnl>=0?T.accent:T.red,marginBottom:14}}>{fmt.pct(pnl)}</div>
          <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
            <button onClick={saveSession} disabled={saved||thinking} style={{padding:"8px 14px",background:saved?T.accentDim:T.accent,color:saved?T.accent:T.bg,border:saved?`1px solid ${T.accent}`:"none",borderRadius:4,fontFamily:"monospace",fontSize:9,cursor:"pointer",fontWeight:700}}>{thinking?"ANALYZING...":saved?"✓ SAVED":"SAVE + PATCHES"}</button>
            <button onClick={()=>{if(!saved)saveSession();setScreen("home");}} style={{padding:"8px 14px",background:"transparent",color:T.muted,border:`1px solid ${T.border}`,borderRadius:4,fontFamily:"monospace",fontSize:9,cursor:"pointer"}}>HOME</button>
            <button onClick={()=>startSession(sessionMode||"seed")} style={{padding:"8px 14px",background:T.surface2,color:T.text,border:`1px solid ${T.border}`,borderRadius:4,fontFamily:"monospace",fontSize:9,cursor:"pointer"}}>NEW</button>
          </div>
        </div>}
      </div>
      <style>{`::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:${T.border};border-radius:2px}input[type=range]{height:3px}`}</style>
    </div>
  );
}


