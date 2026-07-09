import { useState, useEffect, useRef, useCallback } from "react";
import { REPLAY_CATALOG, REPLAY_DATES } from "./replayCatalog";
import { REAL_REPLAY_DATA } from "./realReplayData";
import { classifyGexVelocity, classifyCallDom, choosePrimarySignal, evaluateReentryDiscipline, reliabilityRates } from "./strategyV26";

const BUILD_ID = "v26-airgap-multisession-20260708";
const STARTING_BALANCE = 1000;
const BASE_TICK_MS = 4000;
const SESSION_END_H = 16, SESSION_END_M = 15;
const TRADE_CUTOFF_H = 15, TRADE_CUTOFF_M = 45;
const OPEN_H = 9, OPEN_M = 30;
const TRADER_API = "/api/trader";
const STORAGE_KEY = "gcdt_shared";
const LEGACY_STORAGE_KEYS = ["gcdt_v14","gcdt_v13"];
const SIGNAL_EXIT_MIN_HOLD_TICKS=8;
const LEAD_LAG_SUSTAIN_TICKS=3;
const AI_REQUEST_TIMEOUT_MS=25000,AI_MAX_ENTRY_AGE_TICKS=10,AI_MAX_WAIT_AGE_TICKS=12;
const CHOP_PIN_ON=0.35,CHOP_PIN_OFF=0.25;
const ACCEL_SCALE_MAX=12,ACCEL_EXTREME_HIGH=8.8,ACCEL_EXTREME_LOW=2,ACCEL_BUILD_MIN=4.2,ACCEL_BUILD_MAX=8.7,ACCEL_RETEST_MAX=6.8;

const SPX_JUL1 = {
  date: "2026-07-01", label: "SPX Jul 1 2026", dayType: "SQUEEZE",
  snapshots: [
    { time: "09:29", spot: 7499.36, gex: 38224500000,    callDom: 0.76, maxGamma: 7500 },
    { time: "09:39", spot: 7457.33, gex: -7588600000,   callDom: 0.43, maxGamma: 7500 },
    { time: "09:50", spot: 7463.87, gex: 5827800000,    callDom: 0.54, maxGamma: 7500 },
    { time: "09:56", spot: 7474.64, gex: 31361600000,   callDom: 0.67, maxGamma: 7500 },
    { time: "10:08", spot: 7489.83, gex: 83599700000,   callDom: 0.81, maxGamma: 7500 },
    { time: "10:26", spot: 7496.99, gex: 127356300000,  callDom: 0.84, maxGamma: 7500 },
    { time: "11:26", spot: 7516.41, gex: 276062800000,  callDom: 0.91, maxGamma: 7520 },
    { time: "13:05", spot: 7500.25, gex: 128183500000,  callDom: 0.69, maxGamma: 7520 },
    { time: "14:16", spot: 7495.22, gex: -9161400000,   callDom: 0.49, maxGamma: 7490 },
    { time: "14:26", spot: 7500.99, gex: 137023000000,  callDom: 0.63, maxGamma: 7510 },
    { time: "14:47", spot: 7496.06, gex: -20370000000,  callDom: 0.48, maxGamma: 7490 },
    { time: "15:11", spot: 7501.42, gex: 215438100000,  callDom: 0.66, maxGamma: 7510 },
    { time: "15:27", spot: 7496.94, gex: -18665100000,  callDom: 0.49, maxGamma: 7505 },
    { time: "15:44", spot: 7493.14, gex: -287846200000, callDom: 0.34, maxGamma: 7495 },
    { time: "15:59", spot: 7487.62, gex: -1011022100000,callDom: 0.02, maxGamma: 7485 },
  ],
};

// v12.1: MECHANICAL RULE-LAYER FIXES
// Scope: lead-lag exit convergence, accel filtering, chop gate, and honest review metrics only.
// Dual-stream engine, archetypes, pricing, UI layout, journal structure, and AI prompt remain unchanged.
//
// v12: DUAL-STREAM SPX/SPY INDEPENDENCE FIX
// v6-v11 computed SPY-ITS as a lagged/noisy derivative of SPX-ITS. That made
// true SPY-only vs Composite divergence structurally impossible. v12 keeps the
// old doctrine and UI but fixes the load-bearing data layer: SPY and SPX now
// evolve as separate correlated tracks. SPX can lead, SPY can reject, and real
// divergence windows can persist instead of always converging back to a copy.
//
// Real day-archetypes pulled from RAW TRADING DATA session logs (Jun 24-30, Jul 1 2026).
// n=6 real days — small sample, equal-weighted. Not statistically robust yet;
// use as a real-data prior until more dual-pulled SPY/SPX sessions are logged.
const REAL_ARCHETYPES=[
  {id:"pin_oscillation",label:"Pin Day Oscillation",sourceDay:"Jun 26 2026",dayType:"pin",fidelity:"sparse-log",
   gexRange:[1.47e9,26.1e9],accelRange:[5.57,8.37],ivRange:[20,25],callDomRange:[0.5,0.7],wallGap:2.5,pinBias:0.85,
   gexRangeSpx:[14.7e9,235e9],callDomRangeSpx:[0.5,0.74],baseCorr:0.90,spxFidelity:"dual-real-06a"},
  {id:"amplification_neg",label:"Negative GEX Amplification",sourceDay:"Jun 25 2026",dayType:"trend_down",fidelity:"sparse-log",
   gexRange:[-6.4e9,-3.5e9],accelRange:[3.5,5.5],ivRange:[27,31],callDomRange:[0.25,0.45],wallGap:5,pinBias:0.15,
   gexRangeSpx:[-64e9,-32e9],callDomRangeSpx:[0.22,0.48],baseCorr:0.80,spxFidelity:"single-stream-estimated"},
  {id:"trend_discovery",label:"Morning Regime Flip",sourceDay:"Jun 24 2026",dayType:"reversal",fidelity:"sparse-log",
   gexRange:[-5e9,1.1e9],accelRange:[3,6],ivRange:[18,22],callDomRange:[0.4,0.6],wallGap:4,pinBias:0.4,
   gexRangeSpx:[-50e9,11e9],callDomRangeSpx:[0.38,0.62],baseCorr:0.75,spxFidelity:"single-stream-estimated"},
  {id:"ath_grind_divergence",label:"ATH Grind + NDF Divergence",sourceDay:"Jun 29 2026",dayType:"trend_up",fidelity:"sparse-log",
   gexRange:[62e9,99e9],accelRange:[7.4,8.9],ivRange:[16,20],callDomRange:[0.55,0.75],wallGap:2,pinBias:0.3,
   gexRangeSpx:[600e9,950e9],callDomRangeSpx:[0.50,0.72],baseCorr:0.70,spxFidelity:"single-stream-estimated",scriptedDecouple:"dip_buy",decoupleTick:120},
  {id:"eoq_squeeze_reject",label:"Composite/SPY NDF Divergence + Wall Reject",sourceDay:"Jun 30 2026",dayType:"pin",fidelity:"sparse-log",
   gexRange:[110e9,121e9],accelRange:[8.7,9.0],ivRange:[35,38],callDomRange:[0.6,0.8],wallGap:1,pinBias:0.7,
   gexRangeSpx:[1050e9,1180e9],callDomRangeSpx:[0.55,0.78],baseCorr:0.65,spxFidelity:"single-stream-estimated",scriptedDecouple:"wall_reject",decoupleTick:90},
  {id:"spx_squeeze_collapse",label:"Squeeze Build + EOD Gamma Collapse",sourceDay:"Jul 1 2026",dayType:"squeeze",fidelity:"dense-series",
   gexRange:[-1.01e12,276e9],accelRange:[4,9],ivRange:[15,25],callDomRange:[0.02,0.91],wallGap:3,pinBias:0.4,eodCollapse:true,
   gexRangeSpx:[-1011e9,276e9],callDomRangeSpx:[0.02,0.91],baseCorr:0.88,spxFidelity:"dense-series",scriptedDecouple:"panic_overreaction",decoupleTick:200},
];

function timeToMin(t){const[h,m]=t.split(":").map(Number);return h*60+m;}
function lerp(a,b,t){return a+(b-a)*t;}
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}

const fmt={bal:v=>v>=1e6?`$${(v/1e6).toFixed(3)}M`:v>=1000?`$${(v/1e3).toFixed(1)}K`:`$${v.toFixed(0)}`,pct:v=>`${v>=0?"+":""}${v.toFixed(1)}%`,time:(h,m)=>`${h}:${String(m).padStart(2,"0")}`,gex:v=>`${(v/1e9).toFixed(1)}B`};
const T={bg:"#07090c",surface:"#0e1117",surface2:"#141920",border:"#1a2030",accent:"#00d4a8",accentDim:"#00d4a818",red:"#ff4060",redDim:"#ff406018",yellow:"#f0c040",yellowDim:"#f0c04018",purple:"#a78bfa",text:"#dde4f0",muted:"#4a5568",dim:"#1e2530"};
const SC={discovery:"#00d4a8",pin:"#f0c040",transition:"#a78bfa",macro:"#ff4060"};

function evolveTrack(prevGex,prevCallDom,gexRange,callDomRange,sharedForce,corr,idioScale){
  const idio=(Math.random()-0.5)*idioScale;
  const move=sharedForce*corr+idio*(1-corr);
  const span=Math.abs(gexRange[1]-gexRange[0]);
  const newGex=clamp(prevGex+move*span*0.012+(Math.random()-0.5)*span*0.004,gexRange[0],gexRange[1]);
  const newCallDom=clamp(prevCallDom+move*0.05+(Math.random()-0.5)*0.02,callDomRange[0],callDomRange[1]);
  return{gex:newGex,callDom:newCallDom};
}
function applyScriptedDecouple(arche,tick,spyCallDom,spxCallDom){
  if(!arche.scriptedDecouple||Math.abs(tick-(arche.decoupleTick||-999))>3)return{spyCallDom,spxCallDom};
  if(arche.scriptedDecouple==="dip_buy")return{spyCallDom:clamp(spyCallDom-0.06,0.05,0.95),spxCallDom:clamp(spxCallDom+0.03,0.05,0.95)};
  if(arche.scriptedDecouple==="wall_reject")return{spyCallDom:clamp(spyCallDom+0.09,0.05,0.95),spxCallDom:clamp(spxCallDom-0.01,0.05,0.95)};
  if(arche.scriptedDecouple==="panic_overreaction")return{spyCallDom:clamp(spyCallDom-0.14,0.05,0.95),spxCallDom:clamp(spxCallDom-0.02,0.05,0.95)};
  return{spyCallDom,spxCallDom};
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

function accelWindow(m,hist,dir){
  const raw=m.rawAccelerator??m.accelerator,acc=m.accelerator;
  const prior=hist.slice(-4,-1),p1=prior.at(-1),p2=prior.at(-2);
  const rising=!!(p1&&p2&&p1.accel>p2.accel&&acc>p1.accel);
  const falling=!!(p1&&acc<p1.accel);
  const price3=hist.length>=4?m.spySpot-hist.at(-4).spySpot:0;
  const directionAligned=dir==="CALL"?price3>0:price3<0;
  const build=acc>=ACCEL_BUILD_MIN&&acc<=ACCEL_BUILD_MAX&&rising&&directionAligned;
  const extreme=acc>=ACCEL_EXTREME_HIGH;
  const compressed=acc<=ACCEL_EXTREME_LOW;
  const burst=hist.slice(-10).some(x=>x.accel>=ACCEL_EXTREME_HIGH);
  const level=dir==="CALL"?Math.max(m.gammaFlip,m.fep):Math.min(m.gammaFlip,m.fep);
  const held=hist.slice(-3).length===3&&hist.slice(-3).every(x=>Math.abs(x.spySpot-level)<=0.45);
  const rightSide=dir==="CALL"?m.spySpot>=m.gammaFlip:m.spySpot<=m.gammaFlip;
  const retest=burst&&acc<=ACCEL_RETEST_MAX&&falling&&held&&rightSide;
  if(build)return{ok:true,reason:"BUILD_THROUGH",raw,window:"build-through",state:"BUILDING"};
  if(retest)return{ok:true,reason:"RETEST_HOLD",raw,window:"retest-and-hold",state:"COOLED_RETEST"};
  if(extreme)return{ok:false,reason:"ACCEL_EXTREME",raw,window:"extreme/regime-change",state:"EXTREME"};
  if(compressed)return{ok:false,reason:"ACCEL_COMPRESSION",raw,window:"compression/regime-change",state:"COMPRESSED"};
  return{ok:false,reason:"ACCEL_FILTER_BLOCK",raw,window:"none",state:"NEUTRAL"};
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
  const netGexSpxStart=lerp(arche.gexRangeSpx[0],arche.gexRangeSpx[1],Math.random()*0.4);
  const accelStart=lerp(arche.accelRange[0],arche.accelRange[1],Math.random()*0.3);
  const ivStart=lerp(arche.ivRange[0],arche.ivRange[1],Math.random());
  const callDomStart=lerp(arche.callDomRange[0],arche.callDomRange[1],Math.random());
  const callDomSpxStart=lerp(arche.callDomRangeSpx[0],arche.callDomRangeSpx[1],Math.random());
  const spotStart=741.26+(Math.random()-0.5)*8;
  const session={archetype:arche.id,archetypeLabel:arche.label,sourceDay:arche.sourceDay,fidelity:arche.fidelity,spxFidelity:arche.spxFidelity,dataBasis:"archetype",dayType:arche.dayType,eodCollapse:!!arche.eodCollapse,gexRange:arche.gexRange,gexRangeSpx:arche.gexRangeSpx,callDomRangeSpx:arche.callDomRangeSpx,baseCorr:arche.baseCorr,scriptedDecouple:arche.scriptedDecouple,decoupleTick:arche.decoupleTick,macroTick:Math.floor(20+Math.random()*200),macroMag:(Math.random()>0.5?1:-1)*(1.8+Math.random()*3.2),macroRecovery:Math.random()>0.45,squeezeTick:Math.floor(60+Math.random()*160),squeezeDir:Math.random()>0.5?1:-1,charmDecayRate:0.003+Math.random()*0.004,gexDominance:arche.pinBias,fakeoutTick:Math.floor(35+Math.random()*140),hasFakeout:Math.random()>0.5,volLevel:clamp((accelStart-3)/6,0.1,1),instBias:(callDomStart-0.5)};
  let s={spySpot:spotStart,spxSpot:spotStart*10,gammaFlip:spotStart+(Math.random()-0.5)*3,callWall:spotStart+arche.wallGap,putWall:spotStart-arche.wallGap*2.4,fep:spotStart-0.5,accelerator:accelStart,netGex:netGexStart,netGexSpx:netGexSpxStart,itsSPX:itsFromGex(callDomSpxStart,netGexSpxStart,5.2),itsSPY:itsFromGex(callDomStart,netGexStart,4.8),ndf:0.12,dealerPct:22,iv:ivStart,pcr:0.88,gexInfluence:0.08,callDom:callDomStart,callDomSpx:callDomSpxStart,tick:0,h:9,m:20,isPremarket:true,isTradeable:false,forceBuffer:[0,0,0],pinPressure:0,lastImpulseTick:-999,flatTicks:0,lastSpySpot:spotStart};
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
    const fepTouch=Math.abs(s.spySpot-s.fep)<0.28;
    const wallTouch=Math.abs(s.spySpot-s.callWall)<0.55||Math.abs(s.spySpot-s.putWall)<0.55||Math.abs(s.spySpot-s.gammaFlip)<0.45;
    const nextPinPressure=Math.max(0,Math.min(18,(s.pinPressure||0)+(fepTouch||wallTouch?1.4:-0.75)));
    let impulseForce=0;
    const burstChance=session.dayType==="pin"?0.018:session.dayType==="trend_up"||session.dayType==="trend_down"?0.026:0.021;
    if(!isPre&&t-(s.lastImpulseTick||-999)>10&&Math.random()<burstChance){impulseForce=(Math.random()>0.5?1:-1)*(1.1+Math.random()*3.8);s.lastImpulseTick=t;}
    if(!isPre&&nextPinPressure>7&&t-(s.lastImpulseTick||-999)>7){const dir=Math.random()<0.55?(session.instBias>=0?1:-1):(Math.random()>0.5?1:-1);impulseForce+=dir*(0.9+Math.random()*2.8);s.lastImpulseTick=t;}
    const flatTicks=Math.abs(s.spySpot-(s.lastSpySpot||s.spySpot))<0.015?(s.flatTicks||0)+1:0;
    const antiFreeze=flatTicks>6?(Math.sin(t*0.9)*0.16+(Math.random()-0.5)*0.28):0;
    const mLeft=(SESSION_END_H*60)-(s.h*60+s.m),thetaMult=mLeft<90?0.50+(mLeft/90)*0.50:1.0;
    const noise=((Math.random()-0.5)*0.40*volMult+antiFreeze)*thetaMult;
    const dSpy=(drift+gexForce+macroForce+squeezeForce+fakeout+impulseForce)*thetaMult+noise;
    const softLo=s.putWall-(posGex?2.2:6.5),softHi=s.callWall+(posGex?2.2:6.5);
    let newSpySpot=s.spySpot+dSpy;
    if(newSpySpot<softLo)newSpySpot=softLo+(newSpySpot-softLo)*0.25;
    if(newSpySpot>softHi)newSpySpot=softHi+(newSpySpot-softHi)*0.25;
    const sharedForceRaw=drift+gexForce+macroForce+squeezeForce+fakeout+impulseForce;
    const sharedForceNorm=clamp(sharedForceRaw*2.2,-1,1);
    const forceBuf=[...s.forceBuffer.slice(1),sharedForceNorm];
    const spxForceNow=sharedForceNorm;
    const spyForceLagged=forceBuf[0];
    const newSpxSpot=newSpySpot*10+(Math.random()-0.5)*2;
    const newFep=s.fep*0.87+(newSpySpot-(Math.random()-0.47)*1.5)*0.13;
    const mom=(newSpySpot-s.spySpot)/Math.max(0.01,Math.abs(s.spySpot))*1000;
    const rawAccel=s.accelerator*0.77+(2.6+Math.abs(dSpy)*17*volMult)*0.23+(t>=session.macroTick+10&&t<session.macroTick+14?4.5:0)+(squeezeForce!==0?3.8:0)+(impulseForce!==0?3.2:0)+(Math.random()-0.5)*0.55;
    const newAccel=clamp(rawAccel,0,ACCEL_SCALE_MAX);
    let newNetGex=s.netGex*0.999+(Math.random()-0.5)*Math.abs(s.netGex)*0.002;
    let newCallDom=clamp(s.callDom*0.88+(0.5+session.instBias+mom*0.03)*0.12+(Math.random()-0.5)*0.04+spyForceLagged*0.01,0.15,0.95);
    const spxTrack=evolveTrack(s.netGexSpx,s.callDomSpx,session.gexRangeSpx,session.callDomRangeSpx,spxForceNow,session.baseCorr,0.6);
    let newNetGexSpx=spxTrack.gex,newCallDomSpx=spxTrack.callDom;
    // EOD gamma collapse mechanic (spx_squeeze_collapse archetype, modeled on Jul 1's real -1T EOD flip as 0DTEs expire)
    if(session.eodCollapse&&!isPre){
      const minsLeft=(SESSION_END_H*60+SESSION_END_M)-(s.h*60+s.m);
      if(minsLeft<=25){
        const cp=Math.pow(clamp(1-minsLeft/25,0,1),1.6);
        newNetGex=lerp(newNetGex,session.gexRange[0],cp);
        newCallDom=lerp(newCallDom,0.05,Math.pow(clamp(1-minsLeft/25,0,1),1.4));
        newNetGexSpx=lerp(newNetGexSpx,session.gexRangeSpx[0],cp);
        newCallDomSpx=lerp(newCallDomSpx,0.05,Math.pow(clamp(1-minsLeft/25,0,1),1.4));
      }
    }
    const decoupled=applyScriptedDecouple(session,t,newCallDom,newCallDomSpx);
    newCallDom=decoupled.spyCallDom;newCallDomSpx=decoupled.spxCallDom;
    const newItsSPX=itsFromGex(newCallDomSpx,newNetGexSpx,s.itsSPX);
    const newItsSPY=itsFromGex(newCallDom,newNetGex*8,s.itsSPY);
    const newNdf=s.ndf*0.66+(mom*0.52+(Math.random()-0.5)*0.32)*0.34;
    const newDealer=clamp(s.dealerPct*0.81+(isPre?18:22+gi*42)*0.19+(Math.random()-0.5)*3,5,88);
    const ivTarget=isPre?14.8:macroForce!==0?14.8*1.45:session.dayType==="pin"?14.8*0.83:14.8*(0.88+Math.abs(dSpy)*14);
    const newIv=clamp(s.iv*0.89+ivTarget*0.11,6,48);
    const newPcr=clamp(s.pcr*0.93+(0.88+(Math.random()-0.5)*0.16)*0.07,0.45,2.6);
    let{h,m}=s;m++;if(m>=60){m=0;h++;}
    const newPre=h<OPEN_H||(h===OPEN_H&&m<OPEN_M);
    s={...s,spySpot:newSpySpot,spxSpot:newSpxSpot,fep:newFep,accelerator:newAccel,rawAccelerator:rawAccel,netGex:newNetGex,netGexSpx:newNetGexSpx,itsSPX:newItsSPX,itsSPY:newItsSPY,callDom:newCallDom,callDomSpx:newCallDomSpx,ndf:newNdf,dealerPct:newDealer,iv:newIv,pcr:newPcr,gexInfluence:gexInfAt(t+1),tick:t+1,h,m,isPremarket:newPre,isTradeable:!newPre,forceBuffer:forceBuf,pinPressure:impulseForce!==0?0:nextPinPressure,lastImpulseTick:s.lastImpulseTick,flatTicks,lastSpySpot:newSpySpot};
    return{...s,session,mode:"seed",archetypeLabel:session.archetypeLabel,sourceDay:session.sourceDay,fidelity:session.fidelity,spxFidelity:session.spxFidelity,dataBasis:"archetype"};
  }
  return{tick,getSession:()=>({...session}),peek:()=>({...s}),mode:"seed"};
}

function nativeChain(snapshot){
  const calls=(snapshot.chain||[]).filter(q=>q.side==="CALL").map(q=>({strike:q.strike,side:"CALL",price:q.ask||q.mid,mark:q.mid,bid:q.bid,ask:q.ask,delta:0.10,distance:Math.abs(q.strike-snapshot.spySpot),contract:q.contract,quoteSource:q.quoteSource}));
  const puts=(snapshot.chain||[]).filter(q=>q.side==="PUT").map(q=>({strike:q.strike,side:"PUT",price:q.ask||q.mid,mark:q.mid,bid:q.bid,ask:q.ask,delta:-0.10,distance:Math.abs(q.strike-snapshot.spySpot),contract:q.contract,quoteSource:q.quoteSource}));
  const strikes=[...new Set([...calls,...puts].map(q=>q.strike))].sort((a,b)=>a-b);
  const rows=strikes.map(strike=>({strike,distance:Math.abs(strike-snapshot.spySpot),call:calls.find(q=>q.strike===strike),put:puts.find(q=>q.strike===strike)}));
  return{spot:snapshot.spySpot,iv:(snapshot.iv||0.20)*100,mL:0,rows,calls,puts,surface:{callState:"OBSERVED",putState:"OBSERVED"},quoteSource:snapshot.quoteSource||"NONE"};
}
function createNativeReplayEngine(replayData){
  const snapshots=replayData.snapshots;let idx=-1,last=null,fep=snapshots[0].spySpot;
  function mapSnap(x){
    const[h,m]=x.time.split(":").map(Number),prev=last||x,move=x.spySpot-prev.spySpot;
    fep=fep*0.85+x.spySpot*0.15;
    const accelerator=clamp(2.5+Math.abs(move)*18,0,ACCEL_SCALE_MAX);
    const itsSPX=itsFromGex(x.callDomSpx,x.netGexSpx,5.5),itsSPY=itsFromGex(x.callDom,x.netGex,4.5);
    const out={spySpot:x.spySpot,spxSpot:x.spxSpot,gammaFlip:x.gammaFlip,callWall:x.callWall,putWall:x.putWall,fep,accelerator,rawAccelerator:accelerator,netGex:x.netGex,netGexSpx:x.netGexSpx,itsSPX,itsSPY,callDom:x.callDom,callDomSpyEst:x.callDom,callDomSpx:x.callDomSpx,ndf:move,dealerPct:clamp(x.callDom*100,5,95),iv:(x.iv||0.20)*100,pcr:clamp((1-x.callDom)+0.5,0.4,2.8),gexInfluence:clamp(Math.abs(x.netGex)/(Math.abs(x.netGex)+1e10),0.05,0.95),tick:idx+1,h,m,isPremarket:false,isTradeable:h<TRADE_CUTOFF_H||(h===TRADE_CUTOFF_H&&m<TRADE_CUTOFF_M),synthData:x.quoteSource!=="REAL",quoteSource:x.quoteSource,optionChain:nativeChain(x),dataBasis:"native-replay"};
    last=x;return out;
  }
  function tick(){idx=Math.min(idx+1,snapshots.length-1);return mapSnap(snapshots[idx]);}
  return{tick,getSession:()=>({dayType:replayData.dayType,label:replayData.label}),peek:()=>idx<0?mapSnap(snapshots[0]):mapSnap(snapshots[idx]),mode:"replay"};
}
function createReplayEngine(replayData){
  if(replayData?.snapshots?.[0]?.spySpot!=null)return createNativeReplayEngine(replayData);
  const snapshots=replayData.snapshots,openMin=OPEN_H*60+OPEN_M,spyRatio=10;
  const[firstH,firstM]=String(snapshots[0].time||"09:30").split(":").map(Number),firstMin=firstH*60+firstM,startMin=Math.max(openMin-10,firstMin-10),startH=Math.floor(startMin/60),startM=startMin%60;
  let s={spySpot:snapshots[0].spot/spyRatio,spxSpot:snapshots[0].spot,gammaFlip:snapshots[0].spot/spyRatio-0.5,callWall:snapshots[0].maxGamma/spyRatio+1,putWall:snapshots[0].spot/spyRatio-6,fep:snapshots[0].spot/spyRatio-0.3,accelerator:4.2,netGex:snapshots[0].gex/spyRatio,netGexSpx:snapshots[0].gex,itsSPX:itsFromGex(snapshots[0].callDom,snapshots[0].gex,5.5),itsSPY:4.2,callDom:snapshots[0].callDom,callDomSpyEst:snapshots[0].callDom,ndf:0.1,dealerPct:25,iv:13.5,pcr:0.85,gexInfluence:0.08,tick:0,h:startH,m:startM,isPremarket:startMin<openMin,isTradeable:startMin>=openMin,spxCallDomBuffer:[snapshots[0].callDom,snapshots[0].callDom,snapshots[0].callDom]};
  function tick(){
    const t=s.tick,isPre=s.h<OPEN_H||(s.h===OPEN_H&&s.m<OPEN_M),currentMin=s.h*60+s.m;
    const spx=interpolateSPX(snapshots,currentMin);
    const spxSpyRatio=spyRatio+(Math.random()-0.5)*0.02;
    const newSpxSpot=spx.spot+(Math.random()-0.5)*1.5;
    const newSpySpot=newSpxSpot/spxSpyRatio;
    const prog=isPre?0:Math.max(0,(currentMin-openMin)/390);
    const gi=isPre?0.05:clamp(Math.sin(prog*Math.PI)*0.8*spx.callDom+0.1,0.05,0.9);
    const newItsSPX=itsFromGex(spx.callDom,spx.gex,s.itsSPX);
    const spxBuf=[...s.spxCallDomBuffer.slice(1),spx.callDom];
    const laggedSpxCallDom=spxBuf[0];
    const idio=(Math.random()-0.5)*0.10;
    const newCallDomSpyEst=clamp(laggedSpxCallDom*0.75+s.callDomSpyEst*0.10+idio,0.05,0.95);
    const newItsSPY=itsFromGex(newCallDomSpyEst,spx.gex/spyRatio,s.itsSPY);
    const newFep=s.fep*0.88+(newSpySpot-(Math.random()-0.47)*1.2)*0.12;
    const mom=(newSpySpot-s.spySpot)/Math.max(0.01,Math.abs(s.spySpot))*1000;
    const rawAccel=s.accelerator*0.78+(2.4+Math.abs(newSpySpot-s.spySpot)*15)*0.22+(Math.random()-0.5)*0.5;
    const newAccel=clamp(rawAccel,0,ACCEL_SCALE_MAX);
    const newNdf=s.ndf*0.66+(mom*0.5+(Math.random()-0.5)*0.3)*0.34;
    const newDealer=clamp(s.dealerPct*0.82+(20+gi*45)*0.18+(Math.random()-0.5)*2.5,5,85);
    const newIv=clamp(s.iv*0.9+(10+Math.abs(newSpySpot-s.spySpot)*12)*0.1,6,45);
    const newPcr=clamp(s.pcr*0.93+(0.85+(1-spx.callDom)*0.5+(Math.random()-0.5)*0.1)*0.07,0.4,2.8);
    const newCallWall=spx.maxGamma/spyRatio+(Math.random()-0.5)*0.2;
    const netGexSpy=spx.gex/spyRatio;
    let{h,m}=s;m++;if(m>=60){m=0;h++;}
    const newPre=h<OPEN_H||(h===OPEN_H&&m<OPEN_M);
    s={...s,spySpot:newSpySpot,spxSpot:newSpxSpot,fep:newFep,accelerator:newAccel,rawAccelerator:rawAccel,netGex:netGexSpy,netGexSpx:spx.gex,callWall:newCallWall,itsSPX:newItsSPX,itsSPY:newItsSPY,callDom:spx.callDom,callDomSpyEst:newCallDomSpyEst,ndf:newNdf,dealerPct:newDealer,iv:newIv,pcr:newPcr,gexInfluence:gi,tick:t+1,h,m,isPremarket:newPre,isTradeable:!newPre,spxCallDomBuffer:spxBuf,synthData:spx.synth};
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
  if(div>0.5){const p=Math.min(22,Math.round(Math.abs(div)*14));score+=p;factors.push({label:"SPX leads SPY (institutional)",delta:p});}
  else if(div<-0.5){const p=-Math.min(18,Math.round(Math.abs(div)*11));score+=p;factors.push({label:"SPY leads SPX (retail/caution)",delta:p});}
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

function norm3(call,put,wait){const c=Math.max(1,call),p=Math.max(1,put),w=Math.max(1,wait),tot=c+p+w;return{call:Math.round(c/tot*100),put:Math.round(p/tot*100),wait:Math.round(w/tot*100)};}
function thesisMomentum(curr,prev){if(!prev)return{call:0,put:0,wait:0};return{call:curr.call-prev.call,put:curr.put-prev.put,wait:curr.wait-prev.wait};}
function pushReason(arr,label,delta){arr.push({label,delta});}
function computeEdgeScore(scores){const vals=[scores.call,scores.put,scores.wait].sort((a,b)=>b-a);return vals[0]-vals[1];}

// v9: full rebalance. v8 lowered the threshold but left the weight accumulation itself
// broken — WAIT stacks premarket+35, theta+10/+16, compressed-range+14, dominant-GEX+15
// while CALL/PUT often got boosted SIMULTANEOUSLY by the same signal (accel expanding
// used to add +8 to both, canceling separation). Fixed here: accel boost now goes only
// to the side price is actually moving; WAIT's structural boosts cut roughly in half;
// entry threshold dropped to a realistic level given the smaller base spread (33/33/34).
function computeTheses(mkt,hist,prev){
  const div=mkt.itsSPX-mkt.itsSPY,fg=mkt.spySpot-mkt.fep,gi=mkt.gexInfluence||0.3,ac=mkt.accelerator||0,netGex=mkt.netGex||0;
  const gexVelocity=classifyGexVelocity(hist,mkt),callDomSignal=classifyCallDom(hist,mkt);
  const l6=hist.slice(-6),l12=hist.slice(-12);
  const priceSlope=l6.length>=2?l6[l6.length-1].spySpot-l6[0].spySpot:0;
  const belowFepCount=l6.filter(c=>c.spySpot<c.fep).length;
  const aboveFepCount=l6.filter(c=>c.spySpot>c.fep).length;
  const accelSlope=l6.length>=2?l6[l6.length-1].accel-l6[0].accel:0;
  const range12=l12.length>=4?Math.max(...l12.map(c=>c.spySpot))-Math.min(...l12.map(c=>c.spySpot)):0;
  let call=33,put=33,wait=34;
  const callReasons=[],putReasons=[],waitReasons=[],callNeeds=[],putNeeds=[],callInvalid=[],putInvalid=[];

  if(gexVelocity.direction>0){call+=gexVelocity.score;put-=8;wait-=10;pushReason(callReasons,`GEX velocity ${gexVelocity.state}`,gexVelocity.score);}
  else if(gexVelocity.direction<0){put+=gexVelocity.score;call-=8;wait-=10;pushReason(putReasons,`GEX velocity ${gexVelocity.state}`,gexVelocity.score);}
  else{wait+=7;pushReason(waitReasons,"GEX velocity oscillating / no primary impulse",7);}
  if(gexVelocity.terminalSpike){wait+=18;pushReason(waitReasons,"TERMINAL_SPIKE_BLOCK",18);}
  if(callDomSignal.direction>0){call+=callDomSignal.score;pushReason(callReasons,`Call-dom ${callDomSignal.state}`,callDomSignal.score);}
  else if(callDomSignal.direction<0){put+=callDomSignal.score;pushReason(putReasons,`Call-dom ${callDomSignal.state}`,callDomSignal.score);}
  if(callDomSignal.deadZone){wait+=16;call-=8;put-=8;pushReason(waitReasons,"Call-dom dead zone",16);}
  const itsConfirmed=gexVelocity.direction!==0&&Math.sign(div)===gexVelocity.direction;
  if(div>0.5&&itsConfirmed){call+=8;put-=3;wait-=3;pushReason(callReasons,"ITS confirms GEX velocity",8);}
  else if(div<-0.5&&itsConfirmed){put+=8;call-=3;wait-=3;pushReason(putReasons,"ITS confirms GEX velocity",8);}
  else if(Math.abs(div)>0.5){pushReason(waitReasons,"ITS extreme ignored without GEX confirmation",0);}
  else{wait+=3;pushReason(waitReasons,"ITS convergence / unclear leadership",3);}
  // v9: accel boost now directional (follows priceSlope), not both sides at once
  if(ac>7&&accelSlope>=0){if(priceSlope>=0){call+=12;pushReason(callReasons,"accelerator expanding into upside momentum",12);}else{put+=12;pushReason(putReasons,"accelerator expanding into downside momentum",12);}wait-=6;}
  else if(ac>9&&accelSlope<0){wait+=6;call-=3;put-=3;pushReason(waitReasons,"accelerator peaked / rolling",6);}
  else if(ac<3.5){wait+=5;pushReason(waitReasons,"low acceleration",5);}
  if(fg>0.6&&priceSlope>0){call+=9;put-=4;pushReason(callReasons,"spot above FEP with upward slope",9);}
  else if(fg<-0.6&&priceSlope<0){put+=9;call-=4;pushReason(putReasons,"spot below FEP with downward slope",9);}
  else if(Math.abs(fg)<0.35){wait+=4;pushReason(waitReasons,"spot anchored to FEP",4);}

  if(netGex>0&&gi>0.65){wait+=8;call-=3;put-=3;pushReason(waitReasons,"dominant positive GEX pin risk",8);}
  else if(netGex<0&&gi>0.35){call+=5;put+=10;wait-=6;pushReason(putReasons,"negative GEX amplification",10);pushReason(callReasons,"free-move volatility",5);}
  else if(gi<0.25){call+=5;put+=5;wait-=5;pushReason(callReasons,"GEX weak / directional unlock",5);pushReason(putReasons,"GEX weak / directional unlock",5);}
  if(mkt.spySpot>mkt.gammaFlip&&priceSlope>0){call+=7;pushReason(callReasons,"above gamma flip",7);}
  if(mkt.spySpot<mkt.gammaFlip&&priceSlope<0){put+=7;pushReason(putReasons,"below gamma flip",7);}
  if(Math.abs(mkt.spySpot-mkt.callWall)<0.8&&priceSlope<=0){put+=6;wait+=3;call-=7;pushReason(putReasons,"call wall rejection risk",6);pushReason(waitReasons,"near call wall",3);}
  if(Math.abs(mkt.spySpot-mkt.putWall)<0.8&&priceSlope>=0){call+=6;wait+=3;put-=7;pushReason(callReasons,"put wall bounce risk",6);pushReason(waitReasons,"near put wall",3);}
  if(range12>0&&range12<0.9){wait+=6;pushReason(waitReasons,"compressed range / pin behavior",6);}
  if(mkt.isPremarket){wait+=35;call-=20;put-=20;pushReason(waitReasons,"premarket observe-only",35);}
  const mLeft=(SESSION_END_H*60+SESSION_END_M)-(mkt.h*60+mkt.m);
  if(mLeft<90){wait+=5;call-=2;put-=2;pushReason(waitReasons,"theta window penalty",5);}
  if(mLeft<35){wait+=8;call-=3;put-=3;pushReason(waitReasons,"final theta endgame",8);}

  if(belowFepCount>=4&&priceSlope<-0.6){put+=22;wait-=12;call-=8;pushReason(putReasons,"persistent downside acceptance below FEP",22);}
  if(aboveFepCount>=4&&priceSlope>0.6){call+=22;wait-=12;put-=8;pushReason(callReasons,"persistent upside acceptance above FEP",22);}
  if(priceSlope<-2.0){put+=18;wait-=10;call-=8;pushReason(putReasons,"multi-tick selloff slope",18);}
  if(priceSlope>2.0){call+=18;wait-=10;put-=8;pushReason(callReasons,"multi-tick squeeze slope",18);}

  if(call<65){if(!(div>0.5))callNeeds.push("SPX ITS lead / institutional confirmation");if(!(priceSlope>0))callNeeds.push("upward price acceptance");if(!(ac>6)&&!(aboveFepCount>=4&&priceSlope>0.6))callNeeds.push("accelerator expansion OR persistent upside acceptance");}
  if(put<65){if(!(priceSlope<0))putNeeds.push("downward price acceptance");if(!(mkt.spySpot<mkt.gammaFlip))putNeeds.push("below gamma flip / failed reclaim");if(!(ac>6)&&!(belowFepCount>=4&&priceSlope<-0.6))putNeeds.push("accelerator expansion OR persistent downside acceptance");}
  if(div<-0.9)callInvalid.push("SPY-led caution expanding");
  if(priceSlope<-0.6)callInvalid.push("price slope turning down");
  if(div>0.9&&priceSlope>0)putInvalid.push("institutional upside leadership");
  if(priceSlope>0.6)putInvalid.push("price slope turning up");

  const scores=norm3(call,put,wait);
  const mom=thesisMomentum(scores,prev?.scores);
  const winner=Object.entries(scores).sort((a,b)=>b[1]-a[1])[0][0];
  const edgeScore=computeEdgeScore(scores);
  // v9: threshold dropped to 42 with a +6 margin — realistic given the rebalanced weights
  // above no longer let WAIT out-accumulate everything else by default.
  const entryBias=scores.call>=42&&scores.call>scores.put+6&&scores.call>scores.wait?"CALL":scores.put>=42&&scores.put>scores.call+6&&scores.put>scores.wait?"PUT":"WAIT";
  // v9: scalpEdge bar lowered 11->8.5, since accel rarely sustains above 11 for a full tick
  // (your 10:24 log: "spike failed to hold above 11" — that was the mechanism starving itself).
  const scalpEdge=ac>=7.4&&ac<ACCEL_EXTREME_HIGH&&accelSlope>0.3&&!mkt.isPremarket&&mLeft>=90;
  const scalpDir=priceSlope>=0?"CALL":"PUT";
  const state=entryBias==="CALL"?"ENTRY_READY_CALL":entryBias==="PUT"?"ENTRY_READY_PUT":scores.wait>=45&&scores.call<65&&scores.put<65?"WAIT_DOMINANT":scores.call>=45&&scores.call>=scores.put?"CALL_BUILDING":scores.put>=45?"PUT_BUILDING":"NO_EDGE";
  const primaryCategory=choosePrimarySignal({gex:gexVelocity,callDom:callDomSignal,fepDistance:Math.abs(fg)*9,accelScore:ac>7?12:0,leadLagScore:itsConfirmed?8:0});
  return{scores,momentum:mom,winner,entryBias,state,edgeScore,scalpEdge,scalpDir,gexVelocity,callDomSignal,primaryCategory,call:{reasons:callReasons.slice(0,6),needs:callNeeds.slice(0,4),invalidations:callInvalid.slice(0,3)},put:{reasons:putReasons.slice(0,6),needs:putNeeds.slice(0,4),invalidations:putInvalid.slice(0,3)},wait:{reasons:waitReasons.slice(0,6)}};
}

function computeLeadLag(mkt,hist){
  const l4=hist.slice(-4),l8=hist.slice(-8);
  const base=l4[0]||hist[0]||mkt,base8=l8[0]||base;
  const spxMove=((mkt.spxSpot-(base.spxSpot??mkt.spxSpot))/10),spyMove=mkt.spySpot-(base.spySpot??mkt.spySpot);
  const spxMove8=((mkt.spxSpot-(base8.spxSpot??mkt.spxSpot))/10),spyMove8=mkt.spySpot-(base8.spySpot??mkt.spySpot);
  const gap=spxMove-spyMove,magGap=Math.abs(gap),dir=spxMove>0.18?'UP':spxMove<-0.18?'DOWN':'FLAT';
  const spySame=dir==='UP'?spyMove>0.05:dir==='DOWN'?spyMove<-0.05:false;
  const spyReject=dir==='UP'?spyMove<-0.04:dir==='DOWN'?spyMove>0.04:false;
  const spyLagging=dir!=='FLAT'&&!spyReject&&Math.abs(spyMove)<Math.abs(spxMove)*0.55;
  const spyCatching=dir!=='FLAT'&&spySame&&Math.abs(spyMove)>=Math.abs(spxMove)*0.70;
  const opportunity=dir!=='FLAT'&&spyLagging&&magGap>=0.18;
  const learned=l8.length>=6?`8t SPX:${spxMove8>=0?'+':''}${spxMove8.toFixed(2)} vs SPY:${spyMove8>=0?'+':''}${spyMove8.toFixed(2)}`:'warming up';
  const state=spyReject?'SPY_REJECTING_SPX':spyCatching?'SPY_CATCHING_UP':spyLagging?'SPY_LAGGING_SPX':'NO_CLEAR_LAG';
  const tradeHint=opportunity?(dir==='UP'?'CALL catch-up watch if SPY clears micro level':'PUT catch-down watch if SPY loses micro level'):'lead-lag context only';
  return{dir,spxMove,spyMove,gap,magGap,state,opportunity,learned,tradeHint,text:`SPX lead-lag: ${dir} | ${state} | 4t SPX:${spxMove>=0?'+':''}${spxMove.toFixed(2)} vs SPY:${spyMove>=0?'+':''}${spyMove.toFixed(2)} gap:${gap>=0?'+':''}${gap.toFixed(2)} | ${learned} | ${tradeHint}`};
}
function summarizeSessionModel(sm){
  const leadTotal=Math.max(1,sm.leadOpp||0),catchRate=Math.round((sm.leadCatch||0)/leadTotal*100),rejectRate=Math.round((sm.leadReject||0)/leadTotal*100);
  const pinTotal=Math.max(1,(sm.pinWins||0)+(sm.pinLosses||0)),pinRate=Math.round((sm.pinWins||0)/pinTotal*100);
  const accelTotal=Math.max(1,(sm.accelFollow||0)+(sm.accelFail||0)),accelRate=Math.round((sm.accelFollow||0)/accelTotal*100);
  const bias=catchRate>=60?'SPY is obeying SPX lead':rejectRate>=45?'SPY is rejecting SPX lead':'SPX lead-lag still unproven';
  const pin=bias&&pinTotal>1?` | pin scalps ${pinRate}% so far`:'';
  return`SESSION LEARNING: ${bias}. Lead catch ${sm.leadCatch||0}/${sm.leadOpp||0}, reject ${sm.leadReject||0}. Signal cleanliness ${accelRate}% (${sm.accelFollow||0}/${accelTotal}).${pin}`;
}
function computeDeterministicPlan(mkt,hist,probs,thesis){
  const l6=hist.slice(-6),l12=hist.slice(-12),l20=hist.slice(-20);
  const priceSlope=l6.length>=2?l6[l6.length-1].spySpot-l6[0].spySpot:0;
  const priceSlope12=l12.length>=2?l12[l12.length-1].spySpot-l12[0].spySpot:priceSlope;
  const accelSlope=l6.length>=2?l6[l6.length-1].accel-l6[0].accel:0;
  const range20=l20.length>=4?Math.max(...l20.map(x=>x.spySpot))-Math.min(...l20.map(x=>x.spySpot)):0;
  const hi20=l20.length?Math.max(...l20.map(x=>x.spySpot)):mkt.spySpot,lo20=l20.length?Math.min(...l20.map(x=>x.spySpot)):mkt.spySpot;
  const oldG=l12[0]?.netGex??mkt.netGex,gexVel=(mkt.netGex-oldG)/Math.max(1e9,Math.abs(oldG||1e9));
  const div=mkt.itsSPX-mkt.itsSPY,gi=mkt.gexInfluence||0,fg=mkt.spySpot-mkt.fep;
  const above=mkt.spySpot>mkt.fep&&mkt.spySpot>mkt.gammaFlip,below=mkt.spySpot<mkt.fep&&mkt.spySpot<mkt.gammaFlip;
  let call=0,put=0,reasons=[];
  const pinMode=(mkt.netGex>0&&gi>0.32)||(probs.pin>=38&&range20<1.4);
  const freeMove=mkt.netGex<0||gi<0.25||gexVel<-0.18;
  if(div>0.45){call+=3;reasons.push('SPX lead-lag watch');}
  if(div<-0.45){put+=5;reasons.push('SPY lead caution');}
  if(freeMove){if(priceSlope>0.35){call+=18;reasons.push('weak/negative GEX upside expansion');} if(priceSlope<-0.35){put+=18;reasons.push('weak/negative GEX downside expansion');}}
  if(above&&priceSlope>0.25){call+=16;reasons.push('above FEP+flip acceptance');}
  if(below&&priceSlope<-0.25){put+=20;call-=10;reasons.push('below FEP+flip downside acceptance');}
  if(mkt.accelerator>6&&accelSlope>=0){if(priceSlope>=0){call+=12;reasons.push('accel with upside slope');}else{put+=12;reasons.push('accel with downside slope');}}
  if(mkt.accelerator>=7.4&&mkt.accelerator<ACCEL_EXTREME_HIGH&&Math.abs(priceSlope)>0.35){if(priceSlope>0)call+=10;else put+=10;reasons.push('scalp impulse');}
  if(pinMode&&range20>=0.22){
    if(mkt.spySpot>=hi20-0.18&&priceSlope<-0.12){put+=26;reasons.push('positive-GEX upper pin rejection confirmed');}
    else if(mkt.spySpot>=hi20-0.18){put-=10;reasons.push('upper pin edge unconfirmed, no rejection yet');}
    if(mkt.spySpot<=lo20+0.18&&priceSlope>0.12){call+=26;reasons.push('positive-GEX lower pin bounce confirmed');}
    else if(mkt.spySpot<=lo20+0.18){call-=10;reasons.push('lower pin edge unconfirmed, no bounce yet');}
    if(Math.abs(fg)<0.25&&Math.abs(priceSlope)<0.25){call-=4;put-=4;reasons.push('dead-center pin, no edge');}
  }
  if(mkt.netGex>0&&gexVel>0.12&&Math.abs(fg)>0.45){if(fg>0)put+=8;else call+=8;reasons.push('GEX insertion favors mean reversion');}
  if(mkt.netGex<0&&gexVel<0&&Math.abs(priceSlope12)>0.75){if(priceSlope12>0)call+=14;else put+=14;reasons.push('negative GEX velocity follows move');}
  if(below&&priceSlope<=0){call-=14;reasons.push('CALL suppressed below FEP/flip without reclaim');}
  if(above&&priceSlope>=0){put-=14;reasons.push('PUT suppressed above FEP/flip without rejection');}
  const dir=call>=30&&call>put+6?'CALL':put>=30&&put>call+6?'PUT':'WAIT';
  const isC=dir==='CALL';
  const stop=dir==='WAIT'?null:isC?Math.max(mkt.spySpot-0.22,mkt.fep-0.12):Math.min(mkt.spySpot+0.22,mkt.fep+0.12);
  const target=dir==='WAIT'?null:isC?Math.min(Math.max(mkt.callWall,hi20,mkt.spySpot+0.55),mkt.spySpot+1.25):Math.max(Math.min(mkt.putWall,lo20,mkt.spySpot-0.55),mkt.spySpot-1.25);
  const score=dir==='CALL'?call:dir==='PUT'?put:Math.max(call,put);
  const mode=pinMode&&!freeMove?'PIN_RANGE':freeMove?'GEX_EXPANSION':'EDGE';
  return{dir,score,mode,reason:reasons.slice(-3).join(' + ')||'no deterministic edge',stop,target};
}
function ncdf(x){const t=1/(1+0.2316419*Math.abs(x)),d=0.3989423*Math.exp(-x*x/2),p=d*t*(0.3193815+t*(-0.3565638+t*(1.7814779+t*(-1.8212560+t*1.3302744))));return x>0?1-p:p;}
function optionPathState(mkt,hist){
  const h=hist||[],p1=h.at(-2)||h.at(-1)||mkt,p3=h.at(-4)||p1,p6=h.at(-7)||p3,p10=h.at(-11)||p6;
  const move1=mkt.spySpot-(p1.spySpot??mkt.spySpot);
  const move3=mkt.spySpot-(p3.spySpot??mkt.spySpot);
  const move6=mkt.spySpot-(p6.spySpot??mkt.spySpot);
  const move10=mkt.spySpot-(p10.spySpot??mkt.spySpot);
  let flatTicks=0;
  for(let i=h.length-1;i>=0&&Math.abs((h[i].spySpot??mkt.spySpot)-mkt.spySpot)<0.16;i--)flatTicks++;
  const prevAccel=p1.accel??p1.accelerator??mkt.accelerator??0;
  return{move1,move3,move6,move10,accel:mkt.accelerator||0,accelSlope:(mkt.accelerator||0)-prevAccel,flatTicks,iv:mkt.iv,prevIv:p1.iv??mkt.iv};
}
function optionCtx(mkt,hist,memory){
  return{path:optionPathState(mkt,hist),memory:memory||{}};
}
function zeroDteSurfaceBase(spot,strike,iv,mL,isCall){
  const intrinsic=Math.max(0,isCall?spot-strike:strike-spot);
  if(intrinsic>0)return intrinsic+Math.max(0.01,0.09*Math.exp(-intrinsic/1.8));
  const distance=isCall?Math.max(0,strike-spot):Math.max(0,spot-strike);
  const timeFrac=clamp(mL/390,0,1);
  const volFrac=clamp((iv-12)/30,0,1.6);
  const atmExtrinsic=0.62+timeFrac*0.72+volFrac*0.34;
  const decayScale=1.42+timeFrac*0.52+volFrac*0.20;
  const tailFloor=0.01+0.025*timeFrac;
  return Math.max(tailFloor,atmExtrinsic*Math.exp(-distance/decayScale));
}
function chainSideState(path,isCall){
  const dir=isCall?1:-1;
  const f1=dir*(path?.move1||0),f3=dir*(path?.move3||0),f6=dir*(path?.move6||0),f10=dir*(path?.move10||0);
  const continuation=Math.max(0,f3)*0.42+Math.max(0,f6)*0.20+Math.max(0,f10)*0.08;
  const adverse=Math.max(0,-f3)*0.48+Math.max(0,-f6)*0.20;
  const impulse=Math.max(0,f1)*0.75+Math.max(0,path?.accelSlope||0)*0.06;
  const reversal=f1>0.12&&f6<-0.45?Math.min(2.4,0.65+Math.abs(f6)*0.48+f1*0.65):0;
  const stall=clamp(((path?.flatTicks||0)-1)/7,0,1);
  let state="NEUTRAL";
  if(reversal>0.7)state="REVERSAL_EXPANSION";
  else if(continuation+impulse>1.1)state="EXPANDED";
  else if(adverse>0.7)state="CRUSHED";
  else if(stall>0.45)state="DECAYING";
  return{continuation,adverse,impulse,reversal,stall,state};
}
function priceOpt(spot,strike,iv,mL,isCall,ctx=null){
  const intrinsic=Math.max(0,isCall?spot-strike:strike-spot);
  if(mL<=0)return Math.max(0.01,Math.round(intrinsic*100)/100);
  const base=zeroDteSurfaceBase(spot,strike,iv,mL,isCall);
  if(!ctx)return Math.max(0.01,Math.round(Math.max(intrinsic,base)*100)/100);
  const key=`${isCall?"C":"P"}${strike}`,prev=ctx.memory?.[key]||{};
  const side=chainSideState(ctx.path,isCall);
  const distance=Math.abs(strike-spot),convexity=clamp(1-distance/10,0.18,1);
  const late=clamp((150-mL)/140,0,1);
  const ivChange=(ctx.path?.iv||iv)-(ctx.path?.prevIv||iv);
  const volBoost=clamp(ivChange*0.035,-0.25,0.35);
  let mult=1;
  mult*=1+side.continuation*(0.30+convexity*0.34);
  mult*=1+side.impulse*(0.18+convexity*0.30);
  mult*=1+side.reversal*(0.42+convexity*0.52);
  mult*=1-side.adverse*(0.22+late*0.12);
  mult*=1-side.stall*(0.10+late*0.34);
  mult*=1+volBoost;
  mult=clamp(mult,0.10,7.5);
  let target=Math.max(intrinsic,base*mult);
  const prevPrice=Number.isFinite(prev.price)?prev.price:target;
  const priorCrush=Number.isFinite(prev.compression)?prev.compression:1;
  if(side.reversal>0.7&&priorCrush<0.55)target*=clamp(1+(0.55-priorCrush)*4.2,1,3.2);
  const moveMag=Math.abs(ctx.path?.move1||0)+Math.abs(ctx.path?.move3||0)*0.35;
  const blend=clamp(0.48+moveMag*0.20+side.reversal*0.12,0.48,0.92);
  let px=prevPrice*(1-blend)+target*blend;
  if(side.stall>0.55&&Math.abs(ctx.path?.move1||0)<0.05)px=Math.min(px,prevPrice*(1-(0.025+late*0.11)));
  px=Math.max(intrinsic,px);
  const rounded=Math.max(0.01,Math.round(px*100)/100);
  if(ctx.memory){
    const neutral=Math.max(0.01,base);
    ctx.memory[key]={
      price:rounded,spot,mL,iv,
      peak:Math.max(prev.peak||rounded,rounded),
      trough:Math.min(prev.trough??rounded,rounded),
      compression:clamp(rounded/neutral,0.05,5),
      sideState:side.state
    };
  }
  return rounded;
}
function continuousSurfacePrice(spot,strike,iv,mL,isCall,ctx=null){
  const intrinsic=Math.max(0,isCall?spot-strike:strike-spot);
  if(mL<=0)return intrinsic;
  const base=zeroDteSurfaceBase(spot,strike,iv,mL,isCall);
  if(!ctx)return Math.max(intrinsic,base);
  const key=`${isCall?"C":"P"}${strike}`,prev=ctx.memory?.[key]||{};
  const side=chainSideState(ctx.path,isCall);
  const distance=Math.abs(strike-spot),convexity=clamp(1-distance/10,0.18,1);
  const late=clamp((150-mL)/140,0,1);
  const ivChange=(ctx.path?.iv||iv)-(ctx.path?.prevIv||iv);
  const volBoost=clamp(ivChange*0.035,-0.25,0.35);
  let mult=1;
  mult*=1+side.continuation*(0.30+convexity*0.34);
  mult*=1+side.impulse*(0.18+convexity*0.30);
  mult*=1+side.reversal*(0.42+convexity*0.52);
  mult*=1-side.adverse*(0.22+late*0.12);
  mult*=1-side.stall*(0.10+late*0.34);
  mult*=1+volBoost;
  mult=clamp(mult,0.10,7.5);
  let target=Math.max(intrinsic,base*mult);
  const prevPrice=Number.isFinite(prev.price)?prev.price:target;
  const priorCrush=Number.isFinite(prev.compression)?prev.compression:1;
  if(side.reversal>0.7&&priorCrush<0.55)target*=clamp(1+(0.55-priorCrush)*4.2,1,3.2);
  const moveMag=Math.abs(ctx.path?.move1||0)+Math.abs(ctx.path?.move3||0)*0.35;
  const blend=clamp(0.48+moveMag*0.20+side.reversal*0.12,0.48,0.92);
  let px=prevPrice*(1-blend)+target*blend;
  if(side.stall>0.55&&Math.abs(ctx.path?.move1||0)<0.05)px=Math.min(px,prevPrice*(1-(0.025+late*0.11)));
  return Math.max(intrinsic,px);
}
function optDelta(spot,strike,iv,mL,isCall,ctx=null){
  const bump=0.01;
  const up=continuousSurfacePrice(spot+bump,strike,iv,mL,isCall,ctx);
  const down=continuousSurfacePrice(spot-bump,strike,iv,mL,isCall,ctx);
  const raw=(up-down)/(2*bump);
  return isCall?clamp(raw,0,1):clamp(raw,-1,0);
}
function buildOptionChain(spot,iv,mL,width=40,ctx=null){
  const base=Math.round(spot*2)/2,strikes=[];
  for(let i=-width;i<=width;i++)strikes.push(Math.round((base+i*0.5)*2)/2);
  const rows=strikes.map(strike=>{
    const cp=priceOpt(spot,strike,iv,mL,true,ctx),pp=priceOpt(spot,strike,iv,mL,false,ctx);
    const cd=optDelta(spot,strike,iv,mL,true,ctx),pd=optDelta(spot,strike,iv,mL,false,ctx);
    return{strike,distance:Math.abs(strike-spot),call:{strike,side:"CALL",price:cp,delta:cd},put:{strike,side:"PUT",price:pp,delta:pd}};
  });
  const callState=chainSideState(ctx?.path,true),putState=chainSideState(ctx?.path,false);
  return{spot,iv,mL,rows,calls:rows.map(r=>({...r.call,distance:r.distance})),puts:rows.map(r=>({...r.put,distance:r.distance})),surface:{callState,putState}};
}
function contractRank(o,idealPrice,targetDelta){
  return Math.abs(o.price-idealPrice)*1.4+Math.abs(Math.abs(o.delta)-targetDelta)*1.8+o.distance*0.04;
}
function affordableDirectionalContracts(chain,isCall){
  const list=isCall?chain.calls:chain.puts;
  return list.filter(o=>(isCall?o.strike>=chain.spot+0.5:o.strike<=chain.spot-0.5)&&o.price>=0.12&&o.price<=0.30&&o.distance<=5.5);
}
function bestRejectedContract(chain,isCall){
  const list=isCall?chain.calls:chain.puts;
  const directional=list.filter(o=>isCall?o.strike>=chain.spot+0.5:o.strike<=chain.spot-0.5);
  const ranked=directional.map(o=>{
    const reasons=[];
    if(o.price>0.30)reasons.push(`price $${o.price.toFixed(2)} > $0.30`);
    if(o.price<0.12)reasons.push(`price $${o.price.toFixed(2)} < $0.12`);
    if(o.distance>5.5)reasons.push(`${o.distance.toFixed(1)} points OTM`);
    if(Math.abs(o.delta)<0.035)reasons.push(`delta ${Math.abs(o.delta).toFixed(2)} too low`);
    return{...o,reasons,penalty:Math.abs(o.price-0.20)*1.3+o.distance*0.05+(Math.abs(o.delta)<0.035?0.5:0)};
  }).sort((a,b)=>a.penalty-b.penalty);
  return ranked[0]||null;
}
function selectContract(chain,isCall,mode="swing"){
  const cfg=mode==="pin"?{idealPrice:0.24,targetDelta:0.16,minDelta:0.055,maxDist:4.5}:mode==="expansion"?{idealPrice:0.20,targetDelta:0.12,minDelta:0.045,maxDist:5.5}:{idealPrice:0.22,targetDelta:0.14,minDelta:0.05,maxDist:5};
  const affordable=affordableDirectionalContracts(chain,isCall);
  let tier="QUALITY";
  let candidates=affordable.filter(o=>o.distance<=cfg.maxDist&&Math.abs(o.delta)>=cfg.minDelta);
  if(!candidates.length){
    tier="ADAPTIVE";
    candidates=affordable.filter(o=>o.distance<=5.5&&Math.abs(o.delta)>=0.035);
  }
  candidates=candidates.map(o=>({...o,score:contractRank(o,cfg.idealPrice,cfg.targetDelta)+(tier==="ADAPTIVE"?0.10:0)})).sort((a,b)=>a.score-b.score);
  const x=candidates[0];
  return x?{strike:x.strike,price:x.price,delta:x.delta,distance:x.distance,side:isCall?"CALL":"PUT",tier,contract:x.contract||null,quoteSource:x.quoteSource||chain.quoteSource||"MODELED"}:null;
}
function findStrike(spot,iv,mL,isCall,mode="swing",ctx=null){
  return selectContract(buildOptionChain(spot,iv,mL,40,ctx),isCall,mode);
}

function createSessionTradeMemory(){
  return{
    attempts:[],
    lastEntry:null,
    lastExit:null,
    consecutiveFailures:{CALL:0,PUT:0},
    sameThesisAttempts:{CALL:0,PUT:0},
    episodes:{},
    totalEntries:0
  };
}
function tradeEpisodeKey(side,m,det){
  const loc=side==="CALL"
    ?(m.spySpot>=Math.max(m.fep,m.gammaFlip)?"ABOVE_CORE":"BELOW_CORE")
    :(m.spySpot<=Math.min(m.fep,m.gammaFlip)?"BELOW_CORE":"ABOVE_CORE");
  return`${side}|${det?.mode||"UNKNOWN"}|${loc}`;
}
function recordTradeOutcome(memory,pos,m,pnl,reason,tick){
  const side=pos.isCall?"CALL":"PUT",won=pnl>0,episodeKey=pos.episodeKey||`${side}|UNKNOWN`;
  const item={
    id:pos.id,side,strike:pos.strike,entrySpot:pos.entrySpot,exitSpot:m.spySpot,
    entryPrice:pos.entry,exitPrice:pos.current,pnl,reason,tick,
    entryTick:pos.entryTick,holdTicks:tick-(pos.entryTick??tick),
    entryThesis:pos.entryThesis||"",primaryCategory:pos.primaryCategory||"UNKNOWN",expectedPath:pos.expectedPath||"",
    maxFavorableSpot:pos.maxFavorableSpot,maxAdverseSpot:pos.maxAdverseSpot,
    attribution:pos.lastAttribution||null,episodeKey,
    progress:(pos.isCall?1:-1)*(m.spySpot-pos.entrySpot)
  };
  const attempts=[...(memory?.attempts||[]),item].slice(-20);
  const failures={...(memory?.consecutiveFailures||{CALL:0,PUT:0})};
  failures[side]=won?0:(failures[side]||0)+1;
  const episodes={...(memory?.episodes||{})};
  const prior=episodes[episodeKey]||{entries:0,wins:0,losses:0,lastExitTick:-999,lastExitSpot:null,lastResult:null};
  episodes[episodeKey]={
    ...prior,
    entries:prior.entries+1,
    wins:prior.wins+(won?1:0),
    losses:prior.losses+(won?0:1),
    lastExitTick:tick,lastExitSpot:m.spySpot,lastResult:won?"WIN":"LOSS",lastReason:reason
  };
  return{
    ...(memory||createSessionTradeMemory()),
    attempts,lastExit:item,consecutiveFailures:failures,episodes,
    totalEntries:memory?.totalEntries||attempts.length
  };
}
function tradeMemorySnapshot(memory,m){
  const attempts=memory?.attempts||[],last=memory?.lastExit;
  if(!attempts.length)return"SESSION TRADE MEMORY: no completed trades yet.";
  const recent=attempts.slice(-6).map((x,i)=>`${i+1}. ${x.side} ${x.strike} ${x.pnl>=0?"+":""}${x.pnl.toFixed(1)}% | entry SPY ${x.entrySpot.toFixed(2)} exit ${x.exitSpot.toFixed(2)} | ${x.reason} | episode ${x.episodeKey} | held ${x.holdTicks} ticks`).join("\n");
  return`SESSION TRADE MEMORY:
${recent}
Same-direction failure streak: CALL ${memory.consecutiveFailures?.CALL||0}, PUT ${memory.consecutiveFailures?.PUT||0}.
Last exit: ${last?`${last.side} at SPY ${last.exitSpot.toFixed(2)} because ${last.reason}`:"none"}.
Treat repeated entries from the same episode as one mature thesis. A winner does not automatically reset the episode.`;
}
function evaluateReentry(memory,side,m,hist,episodeKey){
  const recent=(memory?.attempts||[]).filter(x=>x.side===side).slice(-6);
  const episode=memory?.episodes?.[episodeKey];
  if(!recent.length&&!episode)return{allowed:true,newEvidence:["first attempt in this session episode"],episodeKey};
  const last=recent.at(-1),dir=side==="CALL"?1:-1;
  const ticksSince=last?.tick!=null&&m.tick!=null?m.tick-last.tick:999;
  const sinceExit=last?dir*(m.spySpot-last.exitSpot):0;
  const h=hist.slice(-10);
  const move4=h.length>=5?dir*(m.spySpot-h.at(-5).spySpot):0;
  const move8=h.length>=9?dir*(m.spySpot-h.at(-9).spySpot):0;
  const newExtreme=last?(side==="CALL"
    ?m.spySpot>Math.max(last.entrySpot,last.exitSpot)+(last.pnl>0?0.55:0.35)
    :m.spySpot<Math.min(last.entrySpot,last.exitSpot)-(last.pnl>0?0.55:0.35)):true;
  const freshLeg=move4>=0.65&&move8>=0.75;
  const accelReset=(m.accelerator||0)>=6.2;
  const resetDistance=Math.abs(sinceExit)>=0.55;
  const episodeEntries=episode?.entries||0;
  const cooldownNeeded=last?.pnl>0?5:3;
  const evidence=[];
  if(newExtreme)evidence.push("new extreme beyond prior episode");
  if(freshLeg)evidence.push("fresh multi-tick leg");
  if(accelReset&&resetDistance)evidence.push("accelerator and price reset");
  const matureEpisode=episodeEntries>=2;
  const allowed=ticksSince>=cooldownNeeded&&evidence.length>0&&(!matureEpisode||evidence.length>=2);
  return{allowed,newEvidence:evidence,ticksSince,cooldownNeeded,episodeEntries,matureEpisode,episodeKey};
}
function optionPnlAttribution(pos,m,mL,ctx){
  const prevPrice=pos.current,prevSpot=pos.lastSpot??pos.entrySpot,prevIv=pos.lastIv??m.iv;
  const spotMove=m.spySpot-prevSpot,ivMove=m.iv-prevIv;
  const delta=optDelta(prevSpot,pos.strike,prevIv,Math.min(390,mL+1),pos.isCall,ctx);
  const spotContribution=delta*spotMove;
  const late=clamp((150-mL)/140,0,1);
  const thetaContribution=-prevPrice*(0.0025+late*0.014);
  const ivContribution=prevPrice*ivMove*0.010;
  const favorable=(pos.isCall?1:-1)*spotMove;
  const gammaContribution=Math.sign(favorable)*Math.min(prevPrice*0.20,Math.abs(spotMove)*Math.abs(spotMove)*0.035);
  const path=chainSideState(ctx?.path,pos.isCall);
  const momentumVolContribution=prevPrice*clamp(path.impulse*0.08+path.continuation*0.05-path.adverse*0.07,-0.18,0.22);
  const compressionContribution=-prevPrice*clamp(path.stall*0.10+(path.state==="CRUSHED"?0.12:0),0,0.22);
  const rawPrice=priceOpt(m.spySpot,pos.strike,m.iv,mL,pos.isCall,ctx);
  const explained=prevPrice+spotContribution+thetaContribution+ivContribution+gammaContribution+momentumVolContribution+compressionContribution;
  const rawResidual=rawPrice-explained;
  const residualCap=Math.max(0.015,prevPrice*0.18);
  const boundedResidual=clamp(rawResidual,-residualCap,residualCap);
  let reconciled=explained+boundedResidual;
  const flat=Math.abs(spotMove)<0.06&&Math.abs(ivMove)<0.35;
  if(flat)reconciled=clamp(reconciled,prevPrice*0.94,prevPrice*1.04);
  if(favorable>0.12)reconciled=Math.max(reconciled,prevPrice+Math.max(0,spotContribution)*0.55-prevPrice*0.10);
  reconciled=Math.max(0.01,Math.round(reconciled*100)/100);
  return{
    price:reconciled,rawPrice,delta,spotMove,ivMove,
    spotContribution,thetaContribution,ivContribution,gammaContribution,
    momentumVolContribution,compressionContribution,
    residual:boundedResidual,rawResidual,residualCapped:Math.abs(rawResidual)>residualCap,
    flat,favorable
  };
}
function intentSignature(intent){
  if(!intent)return"NONE";
  const c=intent.contract;
  return[
    intent.action,intent.direction||"NONE",
    c?`${c.strike}:${Number(c.price).toFixed(2)}:${c.quality}`:"NO_CONTRACT",
    intent.executionReadiness??intent.readiness??0,
    (intent.blockers||[]).join("|")
  ].join("~");
}
function stableIntentIdentity(intent){
  if(!intent)return{direction:"NONE",episodeKey:null,positionMode:false};
  return{
    direction:intent.direction||"NONE",
    episodeKey:intent.episodeKey||null,
    positionMode:intent.source==="OPEN_POSITION"
  };
}
function hardExecutionBlockers(intent){
  const hard=new Set([
    "Market not tradeable",
    "No valid contract",
    "Chase risk after completed impulse",
    "No genuinely new evidence since failed CALL",
    "No genuinely new evidence since failed PUT",
    "Episode reset incomplete after repeated CALL attempts",
    "Episode reset incomplete after repeated PUT attempts"
  ]);
  return(intent?.blockers||[]).filter(x=>hard.has(x)||/^No genuinely new evidence/.test(x)||/^Episode reset incomplete/.test(x));
}
function semanticDecisionStatus(ctx,currentTick,currentIntent,currentPosition,currentMarket,decision){
  if(!ctx)return{valid:false,reason:"missing request context"};
  if(ctx.cancelled)return{valid:false,reason:"request was cancelled"};
  const currentPositionId=currentPosition?.id||null;
  const decisionType=String(decision?.decision||"WAIT").toUpperCase();
  const ageTicks=currentTick-ctx.tick;
  const ageMs=(typeof performance!=="undefined"&&ctx.startedPerf!=null)?performance.now()-ctx.startedPerf:Date.now()-ctx.startedAt;
  const requestedDirection=ctx.direction||"NONE";
  const currentDirection=currentIntent?.direction||"NONE";
  const currentEpisode=currentIntent?.episodeKey||null;

  if(decisionType==="SELL"||decisionType==="HOLD"){
    if(!ctx.positionId||currentPositionId!==ctx.positionId){
      return{valid:false,reason:`position changed (${ctx.positionId||"NONE"} → ${currentPositionId||"NONE"})`};
    }
    if(ageTicks>AI_MAX_ENTRY_AGE_TICKS||ageMs>AI_REQUEST_TIMEOUT_MS)return{valid:false,reason:`position decision aged out (${ageTicks} ticks, ${ageMs}ms)`};
    return{valid:true,mode:"POSITION"};
  }

  if(decisionType==="WAIT"||decisionType==="WAITING"){
    if(ctx.positionId!==currentPositionId)return{valid:false,reason:"position state changed before WAIT arrived"};
    if(ageTicks>AI_MAX_WAIT_AGE_TICKS||ageMs>AI_REQUEST_TIMEOUT_MS)return{valid:false,reason:`WAIT aged out (${ageTicks} ticks, ${ageMs}ms)`};
    return{valid:true,mode:"JOURNAL_ONLY"};
  }

  const responseDirection=decisionType==="BUY_CALL"?"CALL":decisionType==="BUY_PUT"?"PUT":"NONE";
  if(responseDirection==="NONE")return{valid:false,reason:`unsupported semantic decision ${decisionType}`};
  if(ctx.positionId||currentPositionId)return{valid:false,reason:"entry response no longer applies because a position exists"};
  if(responseDirection!==requestedDirection)return{valid:false,reason:`AI direction ${responseDirection} differs from requested ${requestedDirection}`};
  if(currentDirection!==responseDirection)return{valid:false,reason:`current direction flipped to ${currentDirection}`};
  if(ctx.episodeKey&&currentEpisode&&ctx.episodeKey!==currentEpisode){
    return{valid:false,reason:`thesis episode changed (${ctx.episodeKey} → ${currentEpisode})`};
  }
  if(ageTicks>AI_MAX_ENTRY_AGE_TICKS||ageMs>AI_REQUEST_TIMEOUT_MS)return{valid:false,reason:`entry response aged out (${ageTicks} ticks, ${ageMs}ms)`};

  const requestSpot=ctx.requestSpot;
  const currentSpot=currentMarket?.spySpot;
  const directionalMove=(responseDirection==="CALL"?1:-1)*((currentSpot??requestSpot)-requestSpot);
  if(Number.isFinite(directionalMove)&&directionalMove<-0.55){
    return{valid:false,reason:`market moved ${Math.abs(directionalMove).toFixed(2)} against requested ${responseDirection}`};
  }

  const readiness=currentIntent?.executionReadiness??currentIntent?.readiness??0;
  const threshold=currentIntent?.threshold??(currentIntent?.contract?.quality==="ADAPTIVE"?88:80);
  const action=currentIntent?.action||"WAIT";
  const sameBuy=action===`BUY_${responseDirection}`;
  const nearReady=action===`PREPARE_${responseDirection}`&&readiness>=threshold-4;
  const hardBlockers=hardExecutionBlockers(currentIntent);
  if(!sameBuy&&!nearReady){
    return{valid:false,reason:`current action ${action} is not executable for ${responseDirection}`};
  }
  if(!currentIntent?.contract)return{valid:false,reason:"current canonical contract is unavailable"};
  if(hardBlockers.length)return{valid:false,reason:`current hard blockers: ${hardBlockers.join(", ")}`};

  return{
    valid:true,
    mode:"ENTRY",
    responseDirection,
    ageTicks,
    ageMs,
    currentAction:action,
    readiness,
    threshold,
    directionalMove
  };
}

function unifyDirectionalState(thesis,brain,prev){
  const bull=clamp(Number(brain?.bullPressure)||0,0,100);
  const bear=clamp(Number(brain?.bearPressure)||0,0,100);
  const edge=Math.abs(bull-bear);
  const waitRaw=clamp(62-edge*1.15,10,68);
  const scores=norm3(bull+4,bear+4,waitRaw);
  const momentum=thesisMomentum(scores,prev?.scores);
  const active=bull>bear?"CALL":bear>bull?"PUT":"WAIT";
  const confidence=Math.max(bull,bear);
  const entryBias=confidence>=45&&edge>=8?active:"WAIT";
  return{
    ...thesis,
    scores,
    momentum,
    entryBias,
    state:entryBias==="WAIT"?(active==="WAIT"?"NO_EDGE":`${active}_BUILDING`):`ENTRY_READY_${entryBias}`,
    edgeScore:Math.round(edge),
    source:"MARKET_BRAIN_UNIFIED"
  };
}
const AI_ENTRY_VETO_CODES=new Set([
  "DIRECTION_FLIPPED",
  "CONTRACT_INVALID",
  "CHASE_RISK",
  "EPISODE_STALE",
  "OPPOSITE_ACCEPTANCE",
  "FINAL_THETA_WINDOW"
]);
function validateEntryVeto(veto,intent,requestCtx,currentMarket){
  const code=String(veto||"NONE").toUpperCase();
  const blockers=intent?.blockers||[];
  const mLn=(SESSION_END_H*60+SESSION_END_M)-((currentMarket?.h||0)*60+(currentMarket?.m||0));
  if(!AI_ENTRY_VETO_CODES.has(code))return{valid:false,code,reason:"unrecognized or missing veto code"};
  if(code==="CONTRACT_INVALID")return{valid:!intent?.contract||blockers.includes("No valid contract"),code,reason:"canonical contract unavailable"};
  if(code==="CHASE_RISK")return{valid:blockers.includes("Chase risk after completed impulse")||intent?.chaseRisk===true,code,reason:"canonical chase-risk blocker active"};
  if(code==="FINAL_THETA_WINDOW")return{valid:mLn<15,code,reason:`${mLn} minutes remain`};
  if(code==="DIRECTION_FLIPPED")return{valid:!!requestCtx?.direction&&intent?.direction!==requestCtx.direction,code,reason:`direction ${requestCtx?.direction}→${intent?.direction}`};
  if(code==="EPISODE_STALE")return{valid:!!requestCtx?.episodeKey&&!!intent?.episodeKey&&requestCtx.episodeKey!==intent.episodeKey,code,reason:"thesis episode changed"};
  if(code==="OPPOSITE_ACCEPTANCE"){
    const d=intent?.diagnostics||{},dir=intent?.direction;
    const localOpp=d.localSide&&d.localSide!=="WAIT"&&d.localSide!==dir&&Math.abs(d.localMove||0)>=0.55;
    const brainOpp=d.brainSide&&d.brainSide!=="WAIT"&&d.brainSide!==dir&&(d.brainConfidence||0)>=48;
    return{valid:localOpp||brainOpp,code,reason:"current opposite acceptance confirmed"};
  }
  return{valid:false,code,reason:"veto condition not present"};
}
function createVetoAudit(intent,m,tick,dec){
  const c=intent?.contract;
  if(!c||!intent?.direction)return null;
  return{
    id:`V${tick}-${intent.direction}-${c.strike}`,
    side:intent.direction,
    strike:c.strike,
    startPrice:c.price,
    currentPrice:c.price,
    maxPrice:c.price,
    minPrice:c.price,
    startSpot:m.spySpot,
    startTick:tick,
    vetoCode:String(dec?.veto_reason||"NONE"),
    reasoning:String(dec?.reasoning||"").slice(0,240),
    logged3:false,
    logged8:false
  };
}
function updateVetoAudits(audits,chain,m,tick,onLog){
  return(audits||[]).map(a=>{
    if(a.logged8)return a;
    const list=a.side==="CALL"?chain.calls:chain.puts;
    const row=list.find(x=>Math.abs(x.strike-a.strike)<0.001);
    const px=row?.price??a.currentPrice;
    const next={...a,currentPrice:px,maxPrice:Math.max(a.maxPrice,px),minPrice:Math.min(a.minPrice,px)};
    const age=tick-a.startTick;
    const report=n=>{
      const ret=(px/a.startPrice-1)*100,maxRet=(next.maxPrice/a.startPrice-1)*100;
      onLog(`AI_VETO_AUDIT ${a.side} ${a.strike}${a.side==="CALL"?"C":"P"} veto:${a.vetoCode} entry $${a.startPrice.toFixed(2)} now $${px.toFixed(2)} (${ret>=0?"+":""}${ret.toFixed(1)}%) max $${next.maxPrice.toFixed(2)} (${maxRet>=0?"+":""}${maxRet.toFixed(1)}%) after ${n} ticks | SPY ${a.startSpot.toFixed(2)}→${m.spySpot.toFixed(2)}.`);
    };
    if(age>=3&&!next.logged3){report(3);next.logged3=true;}
    if(age>=8&&!next.logged8){report(8);next.logged8=true;}
    return next;
  }).filter(a=>tick-a.startTick<=12);
}
function normalizeTraderDecision(obj){
  const allowed=new Set(["WAIT","WAITING","BUY_CALL","BUY_PUT","SELL","HOLD"]);
  if(!obj||typeof obj!=="object")throw new Error("AI response was not an object");
  const decision=String(obj.decision||"").toUpperCase();
  if(!allowed.has(decision))throw new Error(`invalid decision: ${String(obj.decision)}`);
  return{
    decision,
    reasoning:String(obj.reasoning||"").slice(0,600),
    mindset:String(obj.mindset||"").slice(0,240),
    journal_entry:String(obj.journal_entry||"").slice(0,600),
    edge_state:String(obj.edge_state||"NO_EDGE"),
    confidence_trend:String(obj.confidence_trend||"UNCLEAR"),
    trade_confidence:Number.isFinite(Number(obj.trade_confidence))?clamp(Number(obj.trade_confidence),0,100):0,
    invalidation_spot:Number.isFinite(Number(obj.invalidation_spot))?Number(obj.invalidation_spot):null,
    target_spot:Number.isFinite(Number(obj.target_spot))?Number(obj.target_spot):null,
    max_loss_pct:Number.isFinite(Number(obj.max_loss_pct))?clamp(Number(obj.max_loss_pct),3,50):null,
    memory_used:String(obj.memory_used||"none").slice(0,300),
    current_thesis:String(obj.current_thesis||"").slice(0,400),
    expected_next_path:String(obj.expected_next_path||"").slice(0,500),
    new_evidence:String(obj.new_evidence||"").slice(0,500),
    prior_trade_effect:String(obj.prior_trade_effect||"").slice(0,500),
    reevaluate_after_ticks:Number.isFinite(Number(obj.reevaluate_after_ticks))?clamp(Math.round(Number(obj.reevaluate_after_ticks)),1,12):null,
    veto_reason:String(obj.veto_reason||"NONE").toUpperCase().slice(0,80),
    veto_evidence:String(obj.veto_evidence||"").slice(0,400)
  };
}
function isSemanticAiFailure(dec){
  const s=`${dec?.reasoning||""} ${dec?.mindset||""} ${dec?.journal_entry||""}`.toLowerCase();
  return /parse error|json parse|invalid json|schema failure|api error|model error|failed to parse|malformed response/.test(s);
}
function extractTraderPayload(data){
  const seen=new Set();
  const walk=v=>{
    if(v==null)return null;
    if(typeof v==="object"){
      if(seen.has(v))return null;seen.add(v);
      if(v.decision)return v;
      for(const k of ["content","text","response","output","result","message","data","choices"]){
        const hit=walk(v[k]);if(hit)return hit;
      }
      if(Array.isArray(v)){for(const x of v){const hit=walk(x);if(hit)return hit;}}
      return null;
    }
    if(typeof v==="string"){
      const raw=v.replace(/```json|```/gi,"").trim();
      const s=raw.indexOf("{"),e=raw.lastIndexOf("}");
      if(s>=0&&e>s){try{return JSON.parse(raw.slice(s,e+1));}catch{}}
      try{return JSON.parse(raw);}catch{return null;}
    }
    return null;
  };
  return walk(data);
}
function buildTradeIntent(m,hist,brain,thesis,det,chain,pos,conf,tradeMemory){
  if(pos){
    const pnl=(pos.current/pos.entry-1)*100,side=pos.isCall?"CALL":"PUT";
    const invalid=pos.isCall?m.spySpot<=(pos.stopSpot??-Infinity):m.spySpot>=(pos.stopSpot??Infinity);
    const oppositeBrain=brain?.active&&brain.active!==side&&brain.confidence>=48;
    const oppositeThesis=thesis?.entryBias&&thesis.entryBias!=="WAIT"&&thesis.entryBias!==side;
    const adverseSpot=(pos.isCall?-1:1)*(m.spySpot-pos.entrySpot);
    const heldTicks=(m.tick??0)-(pos.entryTick??(m.tick??0));
    const dirProgress=(pos.isCall?1:-1)*(m.spySpot-pos.entrySpot);
    const pathDeadlineMiss=heldTicks>=(pos.pathDeadlineTicks??5)&&dirProgress<(pos.minExpectedProgress??0.20);
    const vehicleFailure=pnl<=-(pos.vehicleFailurePct??38)&&dirProgress<0.15;
    const hardLoss=pnl<=-(pos.catastrophicLossPct??50);
    const action=invalid||vehicleFailure||hardLoss||pathDeadlineMiss||(oppositeBrain&&oppositeThesis&&adverseSpot>0.25)?"EXIT":"HOLD";
    const attribution=pos.lastAttribution;
    return{
      action,direction:side,setupQuality:action==="EXIT"?25:78,executionReadiness:100,readiness:100,
      confidence:pos.tradeConfidence||70,
      contract:{strike:pos.strike,price:pos.current,delta:attribution?.delta??null,quality:"OPEN"},
      blockers:[],supportingFactors:[
        `Managing existing ${side} thesis`,
        `${pnl>=0?"+":""}${pnl.toFixed(1)}% option P/L`,
        invalid?"Spot invalidation active":"Spot invalidation not reached",
        oppositeBrain?"Opposite market brain active":"No confirmed opposite market brain"
      ],
      invalidation:pos.stopSpot,target:pos.targetSpot,maxLossPct:pos.maxLossPct,
      source:"OPEN_POSITION",expectedPath:pos.expectedPath,
      attribution
    };
  }

  const recent=hist.slice(-10),move3=recent.length>=4?m.spySpot-recent.at(-4).spySpot:0,move6=recent.length>=7?m.spySpot-recent.at(-7).spySpot:0;
  const brainSide=brain?.active&&brain.active!=="WAIT"?brain.active:"WAIT";
  const localSide=det?.dir||"WAIT";
  const localDir=localSide==="CALL"?1:localSide==="PUT"?-1:0;
  const localMove=localDir?localDir*move3:0;
  const brainEdge=Math.abs((brain?.bullPressure||0)-(brain?.bearPressure||0));
  let side=brainSide;
  if(localSide!=="WAIT"&&localSide!==brainSide&&localMove>=0.55)side=localSide;
  else if((side==="WAIT"||brainEdge<8)&&localSide!=="WAIT"&&localMove>=0.25)side=localSide;
  else if(side==="WAIT"&&thesis?.entryBias&&thesis.entryBias!=="WAIT")side=thesis.entryBias;

  const isCall=side==="CALL",mode=det?.mode==="PIN_RANGE"?"pin":det?.mode==="GEX_EXPANSION"?"expansion":"scalp";
  const contract=side!=="WAIT"?selectContract(chain,isCall,mode):null;
  const rejected=side!=="WAIT"&&!contract?bestRejectedContract(chain,isCall):null;
  const dir=side==="CALL"?1:side==="PUT"?-1:0;
  const persistence=[dir*move3>0.18,dir*move6>0.35].filter(Boolean).length;
  const brainConfidence=clamp(Number(brain?.confidence)||0,0,100);
  const edge=Math.abs((brain?.bullPressure||0)-(brain?.bearPressure||0));
  const locationOk=side==="CALL"?m.spySpot>=Math.min(m.fep,m.gammaFlip)-0.15:side==="PUT"?m.spySpot<=Math.max(m.fep,m.gammaFlip)+0.15:false;
  const response=side==="CALL"?(brain?.bullResponse||0):(brain?.bearResponse||0);
  const localAgreement=localSide==="WAIT"||localSide===side;
  const marketFactors=[
    {label:`Market brain ${side}`,passed:side!=="WAIT",weight:18},
    {label:"Current leg agrees",passed:localAgreement||localMove>=0.55,weight:18},
    {label:"Directional edge",passed:edge>=10||localMove>=0.55,weight:15},
    {label:"Price persistence",passed:persistence>=1,weight:20},
    {label:"FEP / flip location",passed:locationOk,weight:12},
    {label:"Response quality",passed:response>=0.42||localMove>=0.55,weight:12},
    {label:"Acceleration active",passed:m.accelerator>=4.2,weight:5},
  ];
  let setupQuality=Math.round(marketFactors.reduce((a,f)=>a+(f.passed?f.weight:0),0));
  const chaseRisk=dir!==0&&dir*move3>2.2&&Math.abs(move3)>Math.abs(move6)*0.72;
  if(chaseRisk)setupQuality-=12;
  setupQuality=clamp(setupQuality,0,100);

  const episodeKey=side!=="WAIT"?tradeEpisodeKey(side,m,det):null;
  const legacyReentry=side!=="WAIT"?evaluateReentry(tradeMemory,side,m,hist,episodeKey):{allowed:true,newEvidence:[]};
  const discipline=side!=="WAIT"?evaluateReentryDiscipline(tradeMemory,side,thesis?.primaryCategory||"UNKNOWN",thesis?.gexVelocity?.state):{allowed:true};
  const reentry={...legacyReentry,allowed:legacyReentry.allowed&&discipline.allowed,discipline};
  const contractQuality=!contract?0:contract.tier==="QUALITY"?100:76;
  let executionReadiness=Math.round(setupQuality*0.80+contractQuality*0.20);
  const blockers=[];
  for(const f of marketFactors)if(!f.passed)blockers.push(f.label);
  if(chaseRisk)blockers.push("Chase risk after completed impulse");
  if(!reentry.allowed){
    const d=reentry.discipline;
    blockers.push(d?.code?`${d.code}: repeated ${d.repeatedCategory}; override requires ${d.override}`:`No genuinely new evidence since failed ${side}`);
    executionReadiness=Math.min(executionReadiness,72);
  }
  if(!contract){
    blockers.push("No valid contract");
    executionReadiness=Math.min(executionReadiness,72);
  }
  if(!m.isTradeable){blockers.unshift("Market not tradeable");executionReadiness=0;}
  const threshold=contract?.tier==="ADAPTIVE"?88:80;
  const desiredDir=side==="CALL"?1:side==="PUT"?-1:0;
  const fepDir=Math.abs(m.spySpot-m.fep)<0.12?0:Math.sign(m.spySpot-m.fep);
  const primaryAlignment=[thesis?.gexVelocity?.direction===desiredDir,thesis?.callDomSignal?.direction===desiredDir,fepDir===desiredDir];
  const alignedPrimaryCount=primaryAlignment.filter(Boolean).length;
  if(side!=="WAIT"&&alignedPrimaryCount<3){blockers.push(`OPTION_B_PRIMARY_ALIGNMENT ${alignedPrimaryCount}/3`);executionReadiness=Math.min(executionReadiness,72);}
  const canEnter=m.isTradeable&&side!=="WAIT"&&!!contract&&reentry.allowed&&alignedPrimaryCount===3&&executionReadiness>=threshold&&(brainConfidence>=42||localMove>=0.70);
  const action=canEnter?(isCall?"BUY_CALL":"BUY_PUT"):(side==="WAIT"?"WAIT":`PREPARE_${side}`);
  const confidence=clamp(Math.round(setupQuality*.60+Math.max(brainConfidence,Math.min(90,Math.abs(localMove)*35))*.40),0,98);
  const whyNow=[
    ...(reentry.newEvidence||[]),
    localMove>=0.55?"fresh directional leg":"continuing structure",
    persistence>=1?"multi-tick persistence":""
  ].filter(Boolean);
  return{
    action,direction:side==="WAIT"?null:side,
    setupQuality,executionReadiness,readiness:executionReadiness,confidence,
    contract:contract?{strike:contract.strike,price:contract.price,delta:contract.delta,quality:contract.tier,distance:contract.distance}:null,
    bestRejected:rejected?{strike:rejected.strike,price:rejected.price,delta:rejected.delta,distance:rejected.distance,reasons:rejected.reasons}:null,
    blockers,supportingFactors:marketFactors.filter(f=>f.passed).map(f=>f.label),
    threshold,chaseRisk,whyNow,episodeKey,source:"SESSION_AWARE_INTENT",
    diagnostics:{brainConfidence,edge,persistence,response,contractQuality,brainSide,localSide,localMove,reentry}
  };
}
function buildFallbackDecision(m,pos,intent,tradeMemory){
  if(pos){
    if(intent?.action==="EXIT")return normalizeTraderDecision({
      decision:"SELL",
      reasoning:"AI response failed; session-aware intent confirms thesis invalidation or catastrophic contract failure.",
      mindset:"protect thesis integrity",
      journal_entry:"AI unavailable; exiting only because the original thesis is now invalid.",
      edge_state:"EXITING",confidence_trend:"DECAYING",memory_used:"session trade memory"
    });
    return normalizeTraderDecision({
      decision:"HOLD",
      reasoning:"AI response failed; hold the existing position because spot invalidation and confirmed opposite control are absent.",
      mindset:"manage original thesis, not contract noise",
      journal_entry:"",
      edge_state:"IN_TRADE",confidence_trend:"STABLE",memory_used:"session trade memory"
    });
  }
  if(!intent||!String(intent.action).startsWith("BUY_")||intent.executionReadiness<88){
    const failed=(intent?.blockers||[]).slice(0,5).join(", ")||"readiness below threshold";
    return normalizeTraderDecision({
      decision:"WAIT",
      reasoning:`AI response failed; ${intent?.action||"WAIT"} at ${intent?.executionReadiness??0}% readiness. Blockers: ${failed}.`,
      mindset:"wait for genuinely new evidence",
      journal_entry:"",
      edge_state:intent?.action||"NO_EDGE",confidence_trend:"UNCLEAR",memory_used:"session trade memory"
    });
  }
  const isCall=intent.action==="BUY_CALL",confidence=intent.confidence||65;
  return normalizeTraderDecision({
    decision:intent.action,
    reasoning:`AI response failed; execute the session-aware ${intent.direction} intent because this tick has new evidence: ${(intent.whyNow||[]).join(", ")||"fresh aligned structure"}.`,
    mindset:"new leg, not repeated stale evidence",
    journal_entry:`AI unavailable; ${intent.direction} entry authorized from genuinely new session evidence.`,
    edge_state:"ENTRY_READY",confidence_trend:"BUILDING",
    trade_confidence:confidence,
    invalidation_spot:isCall?m.spySpot-(0.35+confidence/190):m.spySpot+(0.35+confidence/190),
    target_spot:isCall?m.spySpot+(0.70+confidence/105):m.spySpot-(0.70+confidence/105),
    max_loss_pct:clamp(18+(confidence-45)*0.20,18,30),
    memory_used:"session trade memory"
  });
}

async function callAI(mkt,pos,bal,hist,probs,conf,thesis,journal,approvedRules,repeatWaitCount,sessionSummary,marketBrain,signal){
  const tStr=`${mkt.h}:${String(mkt.m).padStart(2,"0")} ET`,mL=(SESSION_END_H*60+SESSION_END_M)-(mkt.h*60+mkt.m);
  const theta=mL<45,eodPhase=mL<=15?'CLEANUP/RH_LOCK':mL<=30?'DEATH_ZONE':mL<=60?'BRUTAL_THETA':mL<=75?'GAME_CHANGING':'NORMAL',div=mkt.itsSPX-mkt.itsSPY,top=Object.entries(probs).sort((a,b)=>b[1]-a[1])[0],gi=mkt.gexInfluence||0.3;
  const th=thesis||{scores:{call:0,put:0,wait:100},momentum:{call:0,put:0,wait:0},entryBias:"WAIT",state:"WAIT_DOMINANT",edgeScore:0,scalpEdge:false,scalpDir:"CALL",call:{reasons:[],needs:[],invalidations:[]},put:{reasons:[],needs:[],invalidations:[]},wait:{reasons:[]}};
  const gexStr=`${mkt.netGex>0?"PINNING":"AMPLIFYING"} ${(gi*100).toFixed(0)}% ${gi>0.7?"[DOMINANT]":gi<0.3?"[WEAK]":"[MODERATE]"}`;
  const aiOptCtx=optionCtx(mkt,hist,{});
  const callOpt=!theta&&!pos&&mkt.isTradeable?findStrike(mkt.spySpot,mkt.iv,mL,true,th.scalpEdge?"scalp":"swing",aiOptCtx):null;
  const putOpt=!theta&&!pos&&mkt.isTradeable?findStrike(mkt.spySpot,mkt.iv,mL,false,th.scalpEdge?"scalp":"swing",aiOptCtx):null;
  const optStr=mkt.isPremarket?"PREMARKET — observe only"
    :callOpt||putOpt?`PRE-PRICED:\n${callOpt?`CALL: ${callOpt.strike}C @ $${callOpt.price.toFixed(2)}`:"CALL: none"}\n${putOpt?`PUT: ${putOpt.strike}P @ $${putOpt.price.toFixed(2)}`:"PUT: none"}`
    :pos?"MANAGE POSITION":"NO ENTRIES";
  const rH=hist.slice(-8).map(c=>`${c.t} SPY:${c.spySpot.toFixed(2)} SPX-ITS:${c.itsSPX.toFixed(2)} SPY-ITS:${c.itsSPY.toFixed(2)} DIV:${(c.itsSPX-c.itsSPY).toFixed(2)} ACCEL:${c.accel.toFixed(1)}`).join("\n");
  const posStr=pos?`OPEN: ${pos.strike}${pos.isCall?"C":"P"} entry $${pos.entry.toFixed(2)} now $${pos.current.toFixed(2)} (${((pos.current/pos.entry-1)*100).toFixed(0)}%)`:"NO POSITION";
  const thesisStr=`CALL ${th.scores.call}% (${th.momentum.call>=0?"+":""}${th.momentum.call}) | PUT ${th.scores.put}% (${th.momentum.put>=0?"+":""}${th.momentum.put}) | WAIT ${th.scores.wait}% (${th.momentum.wait>=0?"+":""}${th.momentum.wait}) | STATE:${th.state} | BIAS:${th.entryBias} | EDGE:${th.edgeScore}${th.scalpEdge?` | SCALP EDGE FIRING (${th.scalpDir})`:""}\nCALL needs: ${(th.call.needs||[]).join(", ")||"none"}\nPUT needs: ${(th.put.needs||[]).join(", ")||"none"}`;

  const memoryStr=historicalMemoryPrompt(mkt,marketBrain||createMarketBrain());
  const rulesStr=approvedRules.length>0?`\nAPPROVED RULES:\n${approvedRules.map(r=>`- ${r.rule}`).join("\n")}`:"";
  const repeatStr=repeatWaitCount>=6?`\nNOTE: You have returned WAIT with similar reasoning ${repeatWaitCount} checks in a row. If the underlying signal genuinely hasn't changed, that's a legitimate no-trade day — say so plainly instead of restating the same analysis. If SCALP EDGE is firing, that overrides this pattern; take it.`:"";
  const prompt=`GCDT SPY 0DTE. ${tStr} | ${mL}min | THETA:${theta?"YES":"no"} | EOD_PHASE:${eodPhase}${mkt.isPremarket?" | PREMARKET":""}\n\n${brainPrompt(marketBrain||createMarketBrain())}\n\n${memoryStr}
BAL:$${bal.toFixed(0)} | ${posStr}

SESSION JOURNAL:
${journal.slice(-3).map(j=>`[${j.t}] ${j.entry}`).join("\n")||"Session just started."}

${sessionSummary||"Session just opened."}

REGIME: ${top[0].toUpperCase()} ${top[1]}% (D:${probs.discovery} PIN:${probs.pin} T:${probs.transition} M:${probs.macro})
CONVICTION: ${conf.score}/100 | ${conf.factors.slice(0,3).map(f=>f.label+(f.delta>0?"+":"")+f.delta).join(", ")}

SPY: $${mkt.spySpot.toFixed(2)} | SPX: ${mkt.spxSpot.toFixed(0)}
SPX-ITS: ${mkt.itsSPX.toFixed(2)} | SPY-ITS: ${mkt.itsSPY.toFixed(2)} | DIV: ${div.toFixed(2)} (${div>0.4?"SPX LEADS=conviction":div<-0.4?"SPY LEADS=caution":"CONVERGED"})
Flip: $${mkt.gammaFlip.toFixed(2)} ${mkt.spySpot>mkt.gammaFlip?"ABOVE":"BELOW"} | Walls: C$${mkt.callWall.toFixed(1)} P$${mkt.putWall.toFixed(1)}
GEX: ${gexStr} | ACCEL: ${mkt.accelerator.toFixed(2)} | NDF: ${mkt.ndf.toFixed(3)} | IV: ${mkt.iv.toFixed(1)}%
FEP: $${mkt.fep.toFixed(2)} gap: ${(mkt.spySpot-mkt.fep).toFixed(2)}

${optStr}

RECENT:\n${rH}

UNIFIED DIRECTIONAL STATE: ${thesisStr}

TRADER IDENTITY — CONTINUOUS SESSION MANAGER:
- You are not classifying isolated snapshots. You are managing one continuous SPY 0DTE session and one evolving thesis.
- Every prior entry and exit changes the meaning of the next setup. Repeating the same direction after a failed attempt requires explicitly identified NEW evidence.
- Before any entry answer: why is this tick better than 1, 3, and 5 ticks ago; is this a new leg, a reset, or stale evidence; and what exact path should occur next?
- While in a position, manage the original spot thesis first. Contract P/L is evidence, not automatic truth. Normal 0DTE compression is not an exit unless spot invalidates, opposite control confirms, or the selected vehicle becomes catastrophically unusable.
- Do not abandon a trade merely because the option briefly falls 10-30%. Do not hold merely because the broad session bias still agrees. Track the expected next path, elapsed ticks, location, opposite pressure, and contract attribution.
- Never issue BUY while a position is open. Open-position actions are HOLD or SELL only.
- A previous failed CALL/PUT should make you skeptical of the same evidence, not permanently biased against the direction. Demand a new extreme, fresh momentum leg, re-expansion, reclaim, or materially better contract.
- Use session trade memory and entry/exit locations as first-class market evidence.
- Prefer fewer coherent trades over repeated threshold-triggered churn.
- Do not wait for certainty that cannot exist. When the CURRENT canonical intent is executable, direction/location/response are materially aligned, a QUALITY contract exists, and the expected path plus invalidation are explicit, judge whether the remaining uncertainty is acceptable. Do not invent one more confirmation merely because some uncertainty remains.
- Treat BUY-ready canonical state as a serious opportunity, not a suggestion to restart the entire checklist.
- EXECUTION PRESUMPTION: when CURRENT canonical intent is BUY_CALL or BUY_PUT, a contract exists, readiness passes its threshold, and hard blockers are absent, your default decision MUST be the matching BUY.
- You may return WAIT against an executable canonical BUY only with one veto_reason from: DIRECTION_FLIPPED, CONTRACT_INVALID, CHASE_RISK, EPISODE_STALE, OPPOSITE_ACCEPTANCE, FINAL_THETA_WINDOW.
- The veto must be objectively true in the CURRENT supplied state. "Need more confirmation", "wait for acceptance", "accel below an invented threshold", uncertainty, caution, or a lingering opposing pressure statistic are not valid vetoes after canonical execution checks passed.
- Do not re-run or reinvent checks already represented by canonical readiness and blockers. Raw CALL/PUT pressure is context, not independent veto authority.
- If no valid veto exists, issue the canonical BUY and use invalidation/target fields to manage uncertainty after entry.

RULES:
- Maintain CALL, PUT, and WAIT, but update them proportionally to what price has actually done. A sustained multi-dollar decline must materially increase PUT and reduce CALL unless there is concrete reversal evidence; a sustained rise must do the opposite. The SPX-SPY ITS gap indicates lead/lag, not direction—direction comes from their slopes and price response.
- YOU are the sole market-decision authority. Indicators and historical analogues are evidence only. Seek asymmetric entries before a move is fully completed; explicitly penalize chasing after a greater-than-$2 three-tick impulse unless a new continuation leg is beginning with a nearby invalidation.
- Contract prices are dynamically simulated from spot, time remaining, IV/skew, multi-tick momentum, acceleration, stalling, and adverse movement. Use the supplied contract. QUALITY is preferred; ADAPTIVE may widen only within roughly 2.05 expected moves, keeps a dynamic delta floor of about 0.02-0.05, and never exceeds $0.50. This allows morning/IV-expansion contracts to sit farther away without permitting absurd lottery strikes. Never invent another strike.
- 0DTE option price is path-dependent: expansion creates sensitivity. A stalled move can crush an expanded contract fast, and a second leg only deserves holding if it pushes faster or breaks further levels than the first leg. Expanded contracts can still run from .80 to 2.50+ on true continuation.
- SPY near/ITM active strikes usually have tight liquidity because the underlying is massively traded. Do not assume huge spreads on close liquid strikes; friction is mostly on stale/far OTM contracts or when momentum dies.
- EOD clock: around 2:45 the game changes, 3:00 theta is brutal, 3:30 is death-zone, and 3:45 is cleanup/RH lockout. After 3:45 no new Robinhood-style entries, only forced cleanup/management.
- For each simulated entry, return case-specific fields: trade_confidence, invalidation_spot, max_loss_pct, and target_spot. Lower-confidence setups use tighter simulated risk; stronger structural setups may use wider room, but the invalidating evidence must be explicit.
- Track SPX to SPY lead-lag. SPX moving first can reveal a 1-2 tick window before SPY reflects it. Treat it as an early-warning hypothesis, not an automatic entry. If SPX is moving down and SPY is catching down, suppress CALL unless SPY has reclaimed FEP/flip and bounced. If SPX is moving up and SPY is catching up, suppress PUT unless SPY has rejected a level.
- Manage each open simulated trade from its original thesis. A case-specific option-loss level is a warning, not an automatic exit. Exit on spot invalidation, confirmed opposite control, catastrophic contract failure, or a trailing giveback after meaningful expansion. Do not turn ordinary 0DTE noise into an exit.
- No entries: premarket, already in position, no account equity, no valid QUALITY or ADAPTIVE contract under $0.50, or RH cleanup window after 3:45. After 3:00 only take exceptional momentum with instant invalidation.
- GEX defines how much dealer structure may matter; it is never a universal permission threshold. Weak GEX can mean freer price discovery. Strong GEX can imply pinning or violent hedging. Interpret it jointly with actual price response instead of demanding arbitrary GEX percentages. Do not demand undefined "institutional confirmation" after direction, response, location, and local guide already align. A strong aligned move with a nearby invalidation is actionable.${repeatStr}
- CRITICAL — decision/journal consistency: "decision" is the ONLY market judgment that executes. If journal_entry describes firing or entering, decision MUST equal BUY_CALL or BUY_PUT. Once you choose BUY_CALL or BUY_PUT, code will execute unless filling is literally impossible: premarket/closed session, existing position, depleted account, or no valid affordable contract.
- CRITICAL — only write a NEW journal_entry if something material changed since the last entry above (thesis leader flipped, a level was crossed/approached, accel crossed 7 or 9, ITS lead flipped sign, a trade fired/closed). If nothing material changed, set journal_entry to an empty string "" — do not manufacture a fresh narrative every check just because you were asked again.
- You do not know exact elapsed durations beyond what's given to you in "Price has held within 15c..." above. Never invent a duration in minutes yourself — use the provided number or omit duration language entirely.
${rulesStr}

Respond ONLY valid JSON:
{"decision":"WAIT|WAITING|BUY_CALL|BUY_PUT|SELL|HOLD","reasoning":"one sentence","mindset":"signal you watch most","journal_entry":"one sentence updating session narrative","edge_state":"NO_EDGE|CONDITIONS_FORMING|ENTRY_READY|IN_TRADE|EXITING","confidence_trend":"BUILDING|STABLE|DECAYING|UNCLEAR","trade_confidence":0,"invalidation_spot":null,"target_spot":null,"max_loss_pct":null,"memory_used":"session or historical memory used","current_thesis":"one phrase","expected_next_path":"what should happen next","new_evidence":"what changed since prior decision","prior_trade_effect":"how previous entries/exits affect this decision","reevaluate_after_ticks":2,"veto_reason":"NONE|DIRECTION_FLIPPED|CONTRACT_INVALID|CHASE_RISK|EPISODE_STALE|OPPOSITE_ACCEPTANCE|FINAL_THETA_WINDOW","veto_evidence":"specific current-state evidence or empty"}`;
  const resp=await fetch(TRADER_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt,response_format:{type:"json_object"},temperature:0.2}),signal});
  if(!resp.ok)throw new Error(`API ${resp.status}`);
  const rawText=await resp.text();
  let data;
  try{data=JSON.parse(rawText);}catch{data=rawText;}
  const payload=extractTraderPayload(data);
  if(!payload){
    const err=new Error(`AI_SCHEMA_FAILURE raw:${rawText.slice(0,500)}`);
    err.rawResponse=rawText;
    throw err;
  }
  const normalized=normalizeTraderDecision(payload);
  if(isSemanticAiFailure(normalized)){
    const err=new Error(`AI_SEMANTIC_FAILURE ${normalized.reasoning||normalized.mindset}`);
    err.rawResponse=rawText;
    throw err;
  }
  return{...normalized,callOpt,putOpt};
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

function PriceChart({candles,gammaFlip,callWall,putWall,position,isPremarket,callTrigger,putTrigger,callStop,putStop}){
  const ref=useRef(null);
  const[scrollX,setScrollX]=useState(0),[drag,setDrag]=useState(false),[ds,setDs]=useState(0),[ss,setSs]=useState(0),[hov,setHov]=useState(null);
  // v10: default view only ever showed the latest ~56 ticks (W/STEP). fitDay compresses the
  // whole session's candle history into view instead — this is the "show the whole chart" fix.
  const[fitDay,setFitDay]=useState(false);
  const W=340,H=130,PT=6,PB=20,PL=6;
  const STEP=fitDay?Math.max(0.6,(W-PL-6)/Math.max(1,candles.length)):6;
  const tot=Math.max(W,candles.length*STEP+PL+6),maxS=Math.max(0,tot-W);
  useEffect(()=>{if(!drag)setScrollX(maxS);},[candles.length,maxS,drag]);
  const sp=candles.map(c=>c.spySpot);
  const dMin=sp.length?Math.min(...sp):gammaFlip-3,dMax=sp.length?Math.max(...sp):gammaFlip+3;
  const pad=Math.max(1.2,(dMax-dMin)*0.15);
  const visL=[gammaFlip,callWall,putWall,callTrigger,putTrigger,callStop,putStop].filter(v=>v!=null&&v>dMin-8&&v<dMax+8);
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
        <button onClick={()=>setFitDay(f=>!f)} style={{fontSize:7,color:fitDay?"#00d4a8":"#4a5568",background:"none",border:`1px solid ${fitDay?"#00d4a8":"#1a2030"}`,borderRadius:2,padding:"1px 5px",cursor:"pointer"}}>{fitDay?"FULL DAY":"ZOOM"}</button>
        <span style={{fontSize:9,color:"#4a5568"}}>{hc?`${hc.t} $${hc.spySpot.toFixed(2)}`:"drag"}</span>
      </div>
      <div ref={ref} style={{overflow:"hidden",cursor:drag?"grabbing":"grab",touchAction:"none",userSelect:"none"}} onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up} onTouchStart={down} onTouchMove={move} onTouchEnd={up}>
        <svg width={W} height={H} style={{display:"block"}}>
          <rect width={W} height={H} fill="#0e1117"/>
          {openIdx>0&&(()=>{const x=toX(openIdx);if(x>0&&x<W)return<><rect x={0} y={0} width={x} height={H} fill="#f0c040" opacity={0.04}/><line x1={x} y1={PT} x2={x} y2={H-PB} stroke="#f0c040" strokeWidth={0.5} strokeDasharray="2,4" opacity={0.4}/></>;})()}
          {[{v:callWall,c:"#00d4a8",l:"CW"},{v:gammaFlip,c:"#f0c040",l:"FLIP"},{v:putWall,c:"#ff4060",l:"PW"}].map(({v,c,l})=>{const y=toY(v);if(y<PT-2||y>H-PB+2)return null;return<g key={l}><line x1={0} y1={y} x2={W} y2={y} stroke={c} strokeWidth={0.6} strokeDasharray="3,3" opacity={0.5}/><text x={W-4} y={y-2} fill={c} fontSize={7} textAnchor="end" opacity={0.8}>{l} ${v.toFixed(0)}</text></g>;})}
          {position&&[{v:position.targetSpot,c:position.isCall?"#00ff88":"#ff3366",l:"TARGET"},{v:position.stopSpot,c:"#f0c040",l:"STOP"}].filter(x=>x.v!=null).map(({v,c,l})=>{const y=toY(v);if(y<PT-2||y>H-PB+2)return null;return<g key={l}><line x1={0} y1={y} x2={W} y2={y} stroke={c} strokeWidth={1} strokeDasharray={l==="STOP"?"4,3":"1,3"} opacity={0.7}/><text x={4} y={y-2} fill={c} fontSize={7} textAnchor="start" opacity={0.85}>{l}</text></g>;})}
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

function ThesisBar({label,score,mom,color,scalpEdge}){
  const arrow=mom>0?"▲":mom<0?"▼":"→";
  return<div style={{marginBottom:6}}>
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
      <span style={{fontSize:9,color,letterSpacing:"0.06em"}}>{label}{scalpEdge&&<span style={{marginLeft:5,color:"#00ff88"}}>⚡SCALP</span>}</span>
      <span style={{fontSize:10,fontWeight:700,color}}>{score}% <span style={{fontSize:8}}>{arrow}{mom>=0?"+":""}{mom}</span></span>
    </div>
    <div style={{height:3,background:"#1e2530",borderRadius:2}}><div style={{height:"100%",width:`${score}%`,background:color,borderRadius:2,transition:"width 0.4s"}}/></div>
  </div>;
}
function TradeIntentPanel({intent}){
  const action=intent?.action||"WAIT",dir=intent?.direction;
  const color=action.includes("CALL")?T.accent:action.includes("PUT")?T.red:action==="EXIT"?T.yellow:T.yellow;
  const label=action.replaceAll("_"," "),setup=intent?.setupQuality??intent?.readiness??0,ready=intent?.executionReadiness??intent?.readiness??0;
  const Bar=({value,labelText,barColor})=><><div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:3}}><span style={{fontSize:8,color:T.muted}}>{labelText}</span><span style={{fontSize:14,fontWeight:800,color:barColor}}>{value}%</span></div><div style={{height:5,background:T.dim,borderRadius:4,overflow:"hidden",marginBottom:8}}><div style={{height:"100%",width:`${value}%`,background:barColor,transition:"width .35s"}}/></div></>;
  return <div style={{background:T.surface,borderRadius:8,border:`1px solid ${color}55`,margin:"0 14px 8px",padding:12}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:9}}><span style={{fontSize:9,color:T.muted,letterSpacing:"0.1em"}}>CURRENT TRADE INTENT</span><span style={{fontSize:12,fontWeight:800,color}}>{label}</span></div>
    <Bar value={setup} labelText="SETUP QUALITY" barColor={color}/>
    <Bar value={ready} labelText="EXECUTION READINESS" barColor={ready>=(intent?.threshold??78)?color:T.yellow}/>
    {intent?.contract&&<div style={{padding:"7px 8px",background:T.surface2,borderRadius:5,marginBottom:8,display:"flex",justifyContent:"space-between"}}><span style={{fontSize:10,color}}>{intent.contract.strike}{dir==="PUT"?"P":"C"} @ ${intent.contract.price.toFixed(2)}</span><span style={{fontSize:8,color:T.muted}}>Δ{intent.contract.delta==null?"—":intent.contract.delta.toFixed(2)} · {intent.contract.quality} · {intent.contract.distance?.toFixed(1)} OTM</span></div>}
    {!intent?.contract&&intent?.bestRejected&&<div style={{padding:"7px 8px",background:T.surface2,borderRadius:5,marginBottom:8}}><div style={{fontSize:8,color:T.muted,marginBottom:2}}>BEST REJECTED CONTRACT</div><div style={{fontSize:9,color:T.yellow}}>{intent.bestRejected.strike}{dir==="PUT"?"P":"C"} @ ${intent.bestRejected.price.toFixed(2)} · Δ{intent.bestRejected.delta.toFixed(2)} · {intent.bestRejected.distance.toFixed(1)} OTM</div><div style={{fontSize:7,color:T.red,marginTop:2}}>{(intent.bestRejected.reasons||[]).join(" · ")||"failed quality rules"}</div></div>}
    <div style={{fontSize:8,color:T.muted,marginBottom:4}}>SUPPORT</div>
    {(intent?.supportingFactors||[]).slice(0,6).map((x,i)=><div key={i} style={{fontSize:8,color:T.accent,marginBottom:2}}>✓ {x}</div>)}
    {(intent?.blockers||[]).length>0&&<><div style={{fontSize:8,color:T.muted,margin:"7px 0 4px"}}>BLOCKERS</div>{intent.blockers.slice(0,6).map((x,i)=><div key={i} style={{fontSize:8,color:T.red,marginBottom:2}}>✕ {x}</div>)}</>}
    <div style={{marginTop:8,fontSize:7,color:T.dim}}>Execution threshold: {intent?.threshold??"—"}% · Canonical confidence: {intent?.confidence??0}%</div>
  </div>;
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

function OptionChainPanel({chain,pos}){
  if(!chain)return null;
  const calls=chain.calls.filter(o=>o.strike>chain.spot&&o.price<=0.50&&o.price>=0.12).sort((a,b)=>Math.abs(a.price-0.20)-Math.abs(b.price-0.20)||a.distance-b.distance).slice(0,6);
  const puts=chain.puts.filter(o=>o.strike<chain.spot&&o.price<=0.50&&o.price>=0.12).sort((a,b)=>Math.abs(a.price-0.20)-Math.abs(b.price-0.20)||a.distance-b.distance).slice(0,6);
  const maxRows=Math.max(calls.length,puts.length);
  return <div style={{background:T.surface,borderRadius:8,border:`1px solid ${T.border}`,margin:"0 14px 8px",padding:12}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
      <span style={{fontSize:9,color:T.muted,letterSpacing:"0.1em"}}>LIVE OPTION CHAIN</span>
      <span style={{fontSize:8,color:T.muted}}>SPY ${chain.spot.toFixed(2)} · IV {chain.iv.toFixed(1)}% · {chain.mL}m</span>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"3px 8px",alignItems:"center"}}>
      <div style={{fontSize:8,color:T.accent,fontWeight:700}}>CALL CANDIDATES</div>
      <div style={{fontSize:8,color:T.red,fontWeight:700,textAlign:"right"}}>PUT CANDIDATES</div>
      {maxRows===0&&<div style={{gridColumn:"1 / span 2",fontSize:8,color:T.yellow,textAlign:"center",padding:"6px 0"}}>NO CONTRACTS UNDER $0.50 — chain search needs wider strikes or lower IV</div>}
      {Array.from({length:maxRows}).map((_,i)=>{const c=calls[i],p=puts[i],ca=c&&pos?.isCall&&pos?.strike===c.strike,pa=p&&pos&&!pos.isCall&&pos.strike===p.strike;return <div key={i} style={{display:"contents"}}>
        <div style={{fontSize:9,color:ca?T.bg:T.accent,background:ca?T.accent:"transparent",borderRadius:3,padding:"2px 4px"}}>{c?`${c.strike.toFixed(1)}C $${c.price.toFixed(2)} Δ${c.delta.toFixed(2)}`:"—"}</div>
        <div style={{fontSize:9,color:pa?T.bg:T.red,background:pa?T.red:"transparent",borderRadius:3,padding:"2px 4px",textAlign:"right"}}>{p?`${p.strike.toFixed(1)}P $${p.price.toFixed(2)} Δ${p.delta.toFixed(2)}`:"—"}</div>
      </div>;})}
    </div>
  </div>;
}
function storageGet(key,def){
  try{
    const current=localStorage.getItem(STORAGE_KEY+"_"+key);
    if(current)return JSON.parse(current);
    for(const legacy of LEGACY_STORAGE_KEYS){
      const v=localStorage.getItem(legacy+"_"+key);
      if(v){
        const parsed=JSON.parse(v);
        localStorage.setItem(STORAGE_KEY+"_"+key,JSON.stringify(parsed));
        return parsed;
      }
    }
    return def;
  }catch{return def;}
}
function storageSet(key,val){try{localStorage.setItem(STORAGE_KEY+"_"+key,JSON.stringify(val));}catch{}}

function memoryFeature(t,b){return{
  accel:t.accel||0,div:t.div||0,gex:t.gexInf||0,
  fepGap:(t.spySpot||0)-(t.fep||0),its:(t.itsSPY||0),
  side:b?.active||"WAIT"
};}
function featureDistance(a,b){
  const sidePenalty=a.side!=="WAIT"&&b.side!=="WAIT"&&a.side!==b.side?.35:0;
  return Math.abs(a.accel-b.accel)/12+Math.abs(a.div-b.div)/6+Math.abs(a.gex-b.gex)+Math.min(1,Math.abs(a.fepGap-b.fepGap)/3)+Math.abs(a.its-b.its)/12+sidePenalty;
}
function sessionExemplars(sess){
  const ticks=sess?.tickData||[],mind=sess?.mindset||[];if(ticks.length<8)return[];
  const out=[];
  for(const d of mind){
    const txt=`${d.decision||""} ${d.edgeState||""} ${d.mindset||""}`;
    if(!/(BUY_CALL|BUY_PUT|ENTRY_READY|ARM_CALL|ARM_PUT)/.test(txt))continue;
    const side=/CALL/.test(txt)?"CALL":/PUT/.test(txt)?"PUT":null;if(!side)continue;
    let i=ticks.findIndex(x=>x.t===d.t);if(i<0)continue;
    const now=ticks[i],future=ticks.slice(i+1,i+13);if(future.length<3)continue;
    const signed=x=>side==="CALL"?x-now.spySpot:now.spySpot-x;
    const moves=future.map(x=>signed(x.spySpot)),mfe=Math.max(...moves),mae=Math.min(...moves),end=moves.at(-1);
    out.push({session:sess.label||sess.name||"prior",t:d.t,side,feature:memoryFeature(now,{active:side}),mfe,mae,end,decision:d.decision||d.edgeState||"candidate",reason:String(d.reasoning||"").slice(0,150)});
  }
  return out;
}
function retrieveHistoricalAnalogues(mkt,brain,limit=4){
  const sessions=storageGet("sessions",[]).slice(0,24),current=memoryFeature({accel:mkt.accelerator,div:mkt.itsSPX-mkt.itsSPY,gexInf:mkt.gexInfluence||0,fep:mkt.fep,spySpot:mkt.spySpot,itsSPY:mkt.itsSPY},brain);
  return sessions.flatMap(sessionExemplars).map(x=>({...x,distance:featureDistance(current,x.feature)})).sort((a,b)=>a.distance-b.distance).slice(0,limit);
}
function historicalMemoryPrompt(mkt,brain){
  const a=retrieveHistoricalAnalogues(mkt,brain);if(!a.length)return"HISTORICAL MEMORY: No comparable saved examples yet. Do not invent precedent.";
  const favorable=a.filter(x=>x.mfe>=Math.max(.7,Math.abs(x.mae)*1.25)&&x.end>0).length;
  return`HISTORICAL MEMORY — nearest saved decision moments (${favorable}/${a.length} favorable over next 12 ticks):\n${a.map((x,i)=>`${i+1}. ${x.session} ${x.t} ${x.side} sim:${(1/(1+x.distance)).toFixed(2)} MFE:${x.mfe.toFixed(2)} MAE:${x.mae.toFixed(2)} END:${x.end.toFixed(2)} — ${x.reason||x.decision}`).join("\n")}\nUse these as weighted analogues, not rules. Explain material differences. Never let one anecdote override current structure, and never self-modify thresholds from this small sample.`;
}

function createMarketBrain(){return{
  tick:0,active:"WAIT",confidence:0,
  bullPressure:0,bearPressure:0,bullResponse:0,bearResponse:0,
  highPressure:0,lowPressure:0,aboveFlipQuality:0,belowFlipQuality:0,
  entryReady:false,entrySide:"WAIT",entryReason:"",readyTicks:0,
  expectedResponse:"",actualResponse:"",invalidation:"",summary:"No mature session pressure yet."
};}
function smooth(prev,next,a=.22){return prev*(1-a)+next*a;}
function signedQuality(distance,timeRatio,followThrough,confirmation){return clamp(distance*.35+timeRatio*.25+followThrough*.25+confirmation*.15,0,1);}
function updateMarketBrain(m,hist,prev){
  const b={...prev,tick:(prev.tick||0)+1};
  const h=hist.slice(-80),last=h.at(-1),p3=h.at(-4),p6=h.at(-7);if(!last||h.length<12)return b;
  const recent=h.slice(-30),span=Math.max(.5,Math.max(...recent.map(x=>x.spySpot))-Math.min(...recent.map(x=>x.spySpot)));
  const hi=Math.max(...recent.map(x=>x.spySpot)),lo=Math.min(...recent.map(x=>x.spySpot));
  const d3=p3?last.spySpot-p3.spySpot:0,d6=p6?last.spySpot-p6.spySpot:0,acc=m.accelerator||0;
  const div=(m.itsSpx??m.itsComposite??0)-(m.itsSpy??0);
  const spx3=p3?(last.itsSPX??0)-(p3.itsSPX??0):0,spy3=p3?(last.itsSPY??0)-(p3.itsSPY??0):0;
  const sessionStart=h[0]?.spySpot??last.spySpot,sessionMove=last.spySpot-sessionStart;
  const directionalAgreement=spx3*spy3>0?1:0;
  const aboveFlip=recent.slice(-6).filter(x=>x.spySpot>=m.gammaFlip).length/6;
  const belowFlip=recent.slice(-6).filter(x=>x.spySpot<=m.gammaFlip).length/6;
  const aboveFep=recent.slice(-6).filter(x=>x.spySpot>=m.fep).length/6;
  const belowFep=recent.slice(-6).filter(x=>x.spySpot<=m.fep).length/6;
  const highProximity=clamp(1-(hi-last.spySpot)/Math.max(.35,span*.35),0,1);
  const lowProximity=clamp(1-(last.spySpot-lo)/Math.max(.35,span*.35),0,1);
  const upProgress=clamp(Math.max(0,d6)/Math.max(.5,span),0,1),downProgress=clamp(Math.max(0,-d6)/Math.max(.5,span),0,1);
  const upConfirm=clamp((Math.max(0,spx3)/1.5+Math.max(0,spy3)/1.5+Math.max(0,m.callDom-.5)*2+directionalAgreement*.25)/2.5,0,1);
  const downConfirm=clamp((Math.max(0,-spx3)/1.5+Math.max(0,-spy3)/1.5+Math.max(0,.5-m.callDom)*2+directionalAgreement*.25)/2.5,0,1);
  const aboveQuality=signedQuality(clamp((last.spySpot-m.gammaFlip)/Math.max(.5,span),0,1),aboveFlip,upProgress,upConfirm);
  const belowQuality=signedQuality(clamp((m.gammaFlip-last.spySpot)/Math.max(.5,span),0,1),belowFlip,downProgress,downConfirm);
  b.aboveFlipQuality=smooth(b.aboveFlipQuality,aboveQuality,.3);b.belowFlipQuality=smooth(b.belowFlipQuality,belowQuality,.3);
  const sessionUp=clamp(Math.max(0,sessionMove)/4,0,1.5),sessionDown=clamp(Math.max(0,-sessionMove)/4,0,1.5);
  const bullishInputs=clamp((Math.max(0,spx3)/1.4)+(Math.max(0,spy3)/1.4)+(Math.max(0,m.callDom-.5)*2)+(aboveFep*.7)+(aboveFlip*.7)+sessionUp,0,4);
  const bearishInputs=clamp((Math.max(0,-spx3)/1.4)+(Math.max(0,-spy3)/1.4)+(Math.max(0,.5-m.callDom)*2)+(belowFep*.7)+(belowFlip*.7)+sessionDown,0,4);
  const effort=Math.max(.1,acc/10),upEfficiency=clamp(Math.max(0,d3)/(effort*1.5),0,1),downEfficiency=clamp(Math.max(0,-d3)/(effort*1.5),0,1);
  const bullResponse=clamp(upEfficiency+aboveQuality*.7,0,1.7),bearResponse=clamp(downEfficiency+belowQuality*.7,0,1.7);
  b.bullResponse=smooth(b.bullResponse,bullResponse,.25);b.bearResponse=smooth(b.bearResponse,bearResponse,.25);
  const highRejectPressure=highProximity*clamp((.35-upProgress)+Math.max(0,-d3)/Math.max(.5,span),0,1);
  const lowRejectPressure=lowProximity*clamp((.35-downProgress)+Math.max(0,d3)/Math.max(.5,span),0,1);
  b.highPressure=smooth(b.highPressure,highRejectPressure,.18);b.lowPressure=smooth(b.lowPressure,lowRejectPressure,.18);
  const bullFailure=clamp(bullishInputs/2.2-b.bullResponse*.55,0,1);
  const bearFailure=clamp(bearishInputs/2.2-b.bearResponse*.55,0,1);
  const bullRaw=clamp(15+bullishInputs*16+b.aboveFlipQuality*20+b.lowPressure*12+bearFailure*12-b.highPressure*12-b.belowFlipQuality*14,0,95);
  const bearRaw=clamp(15+bearishInputs*16+b.belowFlipQuality*20+b.highPressure*12+bullFailure*12-b.lowPressure*12-b.aboveFlipQuality*14,0,95);
  b.bullPressure=smooth(b.bullPressure,bullRaw,.24);b.bearPressure=smooth(b.bearPressure,bearRaw,.24);
  const edge=b.bullPressure-b.bearPressure;b.active=Math.abs(edge)<9?"WAIT":edge>0?"CALL":"PUT";b.confidence=Math.round(Math.max(b.bullPressure,b.bearPressure));
  const build=acc>=ACCEL_BUILD_MIN&&acc<=ACCEL_BUILD_MAX&&h.slice(-4,-1).length>=2&&h.slice(-4,-1).every((x,i,a)=>i===0||x.accel>=a[i-1].accel-.2)&&(h.at(-2)?.accel??0)<acc;
  const locationCall=last.spySpot<=Math.max(m.gammaFlip,m.fep)+.8||b.lowPressure>.42;
  const locationPut=last.spySpot>=Math.min(m.gammaFlip,m.fep)-.8||b.highPressure>.42;
  const pressureAligned=b.active==="CALL"?b.bullPressure>=62&&b.bullPressure-b.bearPressure>=12:b.active==="PUT"?b.bearPressure>=62&&b.bearPressure-b.bullPressure>=12:false;
  const responseAligned=b.active==="CALL"?(b.lowPressure>.28||bearFailure>.35||b.aboveFlipQuality>.48):(b.highPressure>.28||bullFailure>.35||b.belowFlipQuality>.48);
  const freshReady=pressureAligned&&responseAligned&&build&&(b.active==="CALL"?locationCall:locationPut);
  if(freshReady){b.entryReady=true;b.entrySide=b.active;b.readyTicks=4;b.entryReason=`${b.active} pressure ${Math.round(b.active==="CALL"?b.bullPressure:b.bearPressure)} with gradual structural pressure, weak opposing response, and accel ${acc.toFixed(1)} building.`;}
  else if(b.readyTicks>0&&b.entrySide===b.active&&acc<11){b.readyTicks--;b.entryReady=true;}
  else{b.entryReady=false;b.entrySide="WAIT";b.readyTicks=0;b.entryReason="Pressure, response quality, location, and timing are not yet jointly aligned.";}
  b.expectedResponse=b.active==="CALL"?"sustained acceptance above dealer center with improving upside efficiency":b.active==="PUT"?"sustained rejection of dealer center with improving downside efficiency":"continued evidence accumulation without forcing direction";
  b.actualResponse=`3t ${d3>=0?"+":""}${d3.toFixed(2)}, 6t ${d6>=0?"+":""}${d6.toFixed(2)}, accel ${acc.toFixed(1)}`;
  b.invalidation=b.active==="CALL"?`bull pressure below 50 or below-flip quality above 0.60`:b.active==="PUT"?`bear pressure below 50 or above-flip quality above 0.60`:"none";
  b.summary=`${b.active} ${b.confidence}% | bullP ${b.bullPressure.toFixed(0)} bearP ${b.bearPressure.toFixed(0)} | session ${sessionMove>=0?"+":""}${sessionMove.toFixed(2)} | ITS3 SPX ${spx3>=0?"+":""}${spx3.toFixed(2)} SPY ${spy3>=0?"+":""}${spy3.toFixed(2)} | highP ${b.highPressure.toFixed(2)} lowP ${b.lowPressure.toFixed(2)} | aboveQ ${b.aboveFlipQuality.toFixed(2)} belowQ ${b.belowFlipQuality.toFixed(2)} | bullResp ${b.bullResponse.toFixed(2)} bearResp ${b.bearResponse.toFixed(2)} | ${b.actualResponse}`;
  return b;
}
function brainPrompt(b){return `SESSION PRESSURE MODEL\n${b.summary}\nEXPECTED: ${b.expectedResponse}\nINVALIDATION: ${b.invalidation}\nENTRY WINDOW: ${b.entryReady?b.entrySide+" READY for "+b.readyTicks+" ticks — "+b.entryReason:"NOT READY — "+b.entryReason}\nInterpret structure continuously. A single missed level or one countertrend tick is not a failed auction. Pressure must accumulate through persistence, acceptance quality, response efficiency, and meaningful location. Do not invent extra confirmation after ENTRY WINDOW is ready.`;}

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
  const[optionChain,setOptionChain]=useState(null);
  const[probs,setProbs]=useState({discovery:25,pin:25,transition:25,macro:25});
  const[confData,setConfData]=useState({score:50,factors:[]});
  const[tradeIntentData,setTradeIntentData]=useState({action:"WAIT",direction:null,readiness:0,confidence:0,contract:null,blockers:["Waiting for market data"],supportingFactors:[]});
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
  const[selectedReplayDate,setSelectedReplayDate]=useState(REPLAY_DATES[0]||"2026-07-06");
  const[chopGate,setChopGate]=useState("OFF");

  const engR=useRef(null),balR=useRef(STARTING_BALANCE),posR=useRef(null);
  const logR=useRef([]),candR=useRef([]),mindR=useRef([]),tlR=useRef([]);
  const journalR=useRef([]),probR=useRef({discovery:25,pin:25,transition:25,macro:25});
  const confR=useRef({score:50,factors:[]}),tradeIntentR=useRef({action:"WAIT",readiness:0,confidence:0,blockers:[],supportingFactors:[]}),tickR=useRef(0),thinkR=useRef(false);
  const ivR=useRef(null),lastSR=useRef("transition"),sessionTickData=useRef([]),archetypeIdR=useRef(null);
  const thesisR=useRef({scores:{call:0,put:0,wait:100},momentum:{call:0,put:0,wait:0},winner:"wait",entryBias:"WAIT",state:"WAIT_DOMINANT",edgeScore:0,scalpEdge:false,scalpDir:"CALL",call:{reasons:[],needs:[],invalidations:[]},put:{reasons:[],needs:[],invalidations:[]},wait:{reasons:[]}});
  const thesisHistR=useRef([]),prevAccelR=useRef(0),lastAiTickR=useRef(-99),repeatWaitR=useRef(0),lastWaitReasonR=useRef("");
  const lastMindsetKeyR=useRef("");
  const sessionModelR=useRef({leadOpp:0,leadCatch:0,leadReject:0,accelFollow:0,accelFail:0,pinWins:0,pinLosses:0,lastLeadState:"",lastAccelTick:-99});
  const optionMemoryR=useRef({});
  const tradeMemoryR=useRef(createSessionTradeMemory()),reliabilityR=useRef({totalRequests:0,parseFailures:0,totalTrades:0,fallbackExecutions:0});
  const decisionSeqR=useRef(0),activeDecisionR=useRef(null),positionSeqR=useRef(0),latestMarketR=useRef(null);
  const aiFreezeR=useRef(false),lastMeaningfulAiKeyR=useRef(""),lastActiveWallR=useRef(Date.now()),aiVetoAuditsR=useRef([]);
  const marketBrainR=useRef(createMarketBrain());
  const[marketBrain,setMarketBrain]=useState(()=>createMarketBrain());
  const chopGateR=useRef("OFF"),pinHistR=useRef([]),flipCrossR=useRef([]),lastFlipSideR=useRef(null),leadWrongTicksR=useRef(0),prevCallWallR=useRef(null),prevPutWallR=useRef(null);
  // v9: session-long memory. callAI previously only saw hist.slice(-4) — four candles, full
  // stop. This tracks the whole session (open, high/low, above/below-FEP counts) so the AI's
  // context isn't reset every call; it's summarized into one line and passed to callAI below.
  const sessionOpenR=useRef(null),sessionHighR=useRef(-Infinity),sessionLowR=useRef(Infinity),aboveFepTotalR=useRef(0),belowFepTotalR=useRef(0);
  const[thesisData,setThesisData]=useState({scores:{call:0,put:0,wait:100},momentum:{call:0,put:0,wait:0},entryBias:"WAIT",state:"WAIT_DOMINANT",edgeScore:0,scalpEdge:false,call:{reasons:[],needs:[],invalidations:[]},put:{reasons:[],needs:[],invalidations:[]},wait:{reasons:[]}});
  const[thesisHist,setThesisHist]=useState([]);
  const[callTrigger,setCallTrigger]=useState(null),[putTrigger,setPutTrigger]=useState(null),[callStop,setCallStop]=useState(null),[putStop,setPutStop]=useState(null);

  const addM=useCallback(e=>{const key=`${e.edgeState}|${e.decision}|${e.mindset}|${String(e.reasoning||'').slice(0,80)}`;if((e.edgeState||'').startsWith('LOCAL')&&key===lastMindsetKeyR.current)return;lastMindsetKeyR.current=key;mindR.current=[...mindR.current.slice(-100),e];setMindsetLog([...mindR.current]);},[]);
  const addJournal=useCallback((t,entry)=>{journalR.current=[...journalR.current.slice(-50),{t,entry}];setJournal([...journalR.current]);},[]);

  useEffect(()=>{
    const handler=()=>{if(engR.current&&!done){storageSet("interrupted",{bal:balR.current,pos:posR.current,log:logR.current,candles:candR.current.slice(-50),mindset:mindR.current.slice(-20),journal:journalR.current,timeline:tlR.current,sessionLabel,sessionMode,tick:tickR.current,archetypeId:archetypeIdR.current});}}
    window.addEventListener("beforeunload",handler);return()=>window.removeEventListener("beforeunload",handler);
  },[done,sessionLabel,sessionMode]);

  const doTick=useCallback(eng=>{
    const nowWall=Date.now();
    if(activeDecisionR.current&&nowWall-lastActiveWallR.current>45000){
      activeDecisionR.current.cancelled=true;
      activeDecisionR.current.controller?.abort("APP_SUSPENDED");
      aiFreezeR.current=false;thinkR.current=false;setThinking(false);
      activeDecisionR.current=null;
    }
    lastActiveWallR.current=nowWall;
    const m=eng.tick();tickR.current++;latestMarketR.current={...m,tick:tickR.current};
    const mL=(SESSION_END_H*60+SESSION_END_M)-(m.h*60+m.m);
    const octx=optionCtx(m,candR.current,optionMemoryR.current);
    const chain=m.optionChain?.calls?.length?m.optionChain:buildOptionChain(m.spySpot,m.iv,mL,80,octx);setOptionChain(chain);
    aiVetoAuditsR.current=updateVetoAudits(aiVetoAuditsR.current,chain,m,tickR.current,msg=>addJournal(fmt.time(m.h,m.m),msg));
    if(posR.current&&m.isTradeable){
      const p0=posR.current;
      let attr=optionPnlAttribution(p0,m,mL,octx);
      const liveQuote=(p0.isCall?chain.calls:chain.puts).find(q=>q.strike===p0.strike);
      if(liveQuote){const livePrice=Number(liveQuote.bid??liveQuote.mark??liveQuote.price);if(Number.isFinite(livePrice)&&livePrice>0)attr={...attr,price:livePrice,quoteSource:liveQuote.quoteSource||chain.quoteSource||"MODELED"};}
      const peakPrice=Math.max(p0.peakPrice||p0.entry,attr.price);
      const peakPnl=(peakPrice/p0.entry-1)*100;
      const maxFavorableSpot=p0.isCall?Math.max(p0.maxFavorableSpot??p0.entrySpot,m.spySpot):Math.min(p0.maxFavorableSpot??p0.entrySpot,m.spySpot);
      const maxAdverseSpot=p0.isCall?Math.min(p0.maxAdverseSpot??p0.entrySpot,m.spySpot):Math.max(p0.maxAdverseSpot??p0.entrySpot,m.spySpot);
      posR.current={...p0,current:attr.price,peakPrice,peakPnl,lastSpot:m.spySpot,lastIv:m.iv,lastAttribution:attr,maxFavorableSpot,maxAdverseSpot};
      setPos({...posR.current});
      const p=posR.current,size=p.size||balR.current,optPnl=(p.current/p.entry-1)*100;
      const side=p.isCall?"CALL":"PUT",dir=p.isCall?1:-1;
      const heldTicks=tickR.current-(p.entryTick??tickR.current);
      const spotProgress=dir*(m.spySpot-p.entrySpot);
      const spotFail=p.isCall?m.spySpot<=(p.stopSpot??-Infinity):m.spySpot>=(p.stopSpot??Infinity);
      const spotTargetRaw=p.isCall?m.spySpot>=(p.targetSpot??Infinity):m.spySpot<=(p.targetSpot??-Infinity);
      const llNow=computeLeadLag(m,candR.current);
      const leadWrong=p.isCall&&llNow.dir==='DOWN'&&llNow.state==='SPY_CATCHING_UP'||!p.isCall&&llNow.dir==='UP'&&llNow.state==='SPY_CATCHING_UP';
      leadWrongTicksR.current=leadWrong?leadWrongTicksR.current+1:0;
      const leadSustained=leadWrongTicksR.current>=LEAD_LAG_SUSTAIN_TICKS;
      const brainNow=marketBrainR.current;
      const brainOpposes=brainNow.active&&brainNow.active!=="WAIT"&&brainNow.active!==side&&brainNow.confidence>=48;
      const th=thesisR.current,thesisOpposes=p.isCall?th.entryBias==='PUT':th.entryBias==='CALL';
      const wallAgainst=p.isCall?(prevCallWallR.current!=null&&m.callWall<prevCallWallR.current):(prevPutWallR.current!=null&&m.putWall>prevPutWallR.current);
      const adverseSpot=-spotProgress;
      const oppositeCount=[leadSustained,brainOpposes,thesisOpposes,wallAgainst,adverseSpot>0.35].filter(Boolean).length;
      const pathDeadlineMiss=heldTicks>=(p.pathDeadlineTicks??5)&&spotProgress<(p.minExpectedProgress??0.20);
      const responsiveness=(Math.abs(attr.delta)||0)*(Math.abs(attr.spotMove)||0);
      const vehicleFailure=optPnl<=-(p.vehicleFailurePct??38)&&(spotProgress<0.15||responsiveness<0.01);
      const catastrophicLoss=optPnl<=-(p.catastrophicLossPct??50);
      const signalExit=heldTicks>=SIGNAL_EXIT_MIN_HOLD_TICKS&&oppositeCount>=3;
      const trailingProfit=peakPnl>=40&&(peakPnl-optPnl)>=Math.max(18,peakPnl*0.35)&&heldTicks>=3;
      const spotTarget=spotTargetRaw&&optPnl>0&&heldTicks>=3;
      setBal(size*(p.current/p.entry));
      if(Math.abs(attr.price-p0.current)>=0.03||Math.abs(attr.spotMove)>=0.15||attr.residualCapped){
        addJournal(fmt.time(m.h,m.m),`OPTION_ATTR ${p.strike}${p.isCall?"C":"P"} ${p0.current.toFixed(2)}→${attr.price.toFixed(2)} | spot ${attr.spotContribution>=0?"+":""}${attr.spotContribution.toFixed(3)} | gamma ${attr.gammaContribution>=0?"+":""}${attr.gammaContribution.toFixed(3)} | theta ${attr.thetaContribution.toFixed(3)} | IV ${attr.ivContribution>=0?"+":""}${attr.ivContribution.toFixed(3)} | momentum-vol ${attr.momentumVolContribution>=0?"+":""}${attr.momentumVolContribution.toFixed(3)} | compression ${attr.compressionContribution.toFixed(3)} | residual ${attr.residual>=0?"+":""}${attr.residual.toFixed(3)}${attr.residualCapped?" CAPPED":""}.`);
      }
      if(!spotFail&&!vehicleFailure&&!catastrophicLoss&&!pathDeadlineMiss&&!signalExit&&!trailingProfit&&!spotTarget&&oppositeCount>0){
        addJournal(fmt.time(m.h,m.m),`POSITION_REVIEW ${side} opposite ${oppositeCount}/5, held ${heldTicks}, progress ${spotProgress>=0?"+":""}${spotProgress.toFixed(2)}, option ${fmt.pct(optPnl)}, deadline ${p.pathDeadlineTicks??5}.`);
      }
      if(spotFail||vehicleFailure||catastrophicLoss||pathDeadlineMiss||signalExit||trailingProfit||spotTarget){
        const dollar=size*optPnl/100;balR.current=size*(p.current/p.entry);
        const why=spotFail?'SPOT_INVALIDATION':pathDeadlineMiss?'EXPECTED_PATH_TIMEOUT':vehicleFailure?'VEHICLE_FAILURE':catastrophicLoss?'CATASTROPHIC_FLOOR':trailingProfit?'TRAILING_PROFIT':spotTarget?'SPOT_TARGET_PROFIT':`CONFIRMED_OPPOSITE_CONTROL_${oppositeCount}`;
        logR.current=[...logR.current,{t:fmt.time(m.h,m.m),action:`THESIS-EXIT ${p.strike}${p.isCall?"C":"P"} @$${p.current.toFixed(2)} ${why}`,result:`${fmt.pct(optPnl)} (${dollar>=0?"+":""}${fmt.bal(dollar)})`,pnl:optPnl,dollarPnl:dollar,exitType:why,entrySpot:p.entrySpot,exitSpot:m.spySpot}];
        tradeMemoryR.current=recordTradeOutcome(tradeMemoryR.current,p,m,optPnl,why,tickR.current);
        setTradeLog([...logR.current]);posR.current=null;setPos(null);leadWrongTicksR.current=0;setBal(balR.current);if(activeDecisionR.current)activeDecisionR.current.cancelled=true;activeDecisionR.current=null;return;
      }
      prevCallWallR.current=m.callWall;prevPutWallR.current=m.putWall;
    }
    const tradeCutoffPassed=(m.h*60+m.m)>=(TRADE_CUTOFF_H*60+TRADE_CUTOFF_M);
    if(posR.current&&tradeCutoffPassed){const p=posR.current,size=p.size||balR.current,r=(p.current/p.entry-1)*100,dollar=size*r/100;balR.current=size*(p.current/p.entry);logR.current=[...logR.current,{t:"15:45",action:`AUTO-CLOSE ${p.strike}${p.isCall?"C":"P"} ROBINHOOD 0DTE CUTOFF`,result:`${fmt.pct(r)} (${dollar>=0?"+":""}${fmt.bal(dollar)})`,pnl:r,dollarPnl:dollar,exitType:"DEFAULT_0DTE_CUTOFF_15_45"}];setTradeLog([...logR.current]);posR.current=null;setPos(null);setBal(balR.current);addJournal("15:45","DEFAULT 0DTE CUTOFF — position liquidated; market observation continues through 16:15 ET.");}
    if(m.h>SESSION_END_H||(m.h===SESSION_END_H&&m.m>=SESSION_END_M)){
      setBal(balR.current);setDone(true);setRunning(false);clearInterval(ivR.current);storageSet("interrupted",null);return;
    }
    setMkt(m);setBal(balR.current);setGexInf(m.gexInfluence||0.1);
    const c={t:fmt.time(m.h,m.m),spySpot:m.spySpot,spxSpot:m.spxSpot,itsSPX:m.itsSPX,itsSPY:m.itsSPY,accel:m.accelerator,rawAccel:m.rawAccelerator??m.accelerator,fep:m.fep,ndf:m.ndf,gexInf:m.gexInfluence||0.1,netGex:m.netGex,gammaFlip:m.gammaFlip,callWall:m.callWall,putWall:m.putWall,isOpen:m.h===OPEN_H&&m.m===OPEN_M,synthData:m.synthData||false};
    candR.current=[...candR.current.slice(-450),c];setCandles([...candR.current]);
    pinHistR.current=[...pinHistR.current.slice(-14),m.gexInfluence||0.1];
    const side=m.spySpot>=m.gammaFlip?'ABOVE':'BELOW';
    if(lastFlipSideR.current&&side!==lastFlipSideR.current){const prior=flipCrossR.current.at(-1);if(prior&&tickR.current-prior.crossTick<=5&&!prior.failed)prior.failed=true;flipCrossR.current=[...flipCrossR.current.filter(x=>tickR.current-x.crossTick<=20),{crossTick:tickR.current,failed:false}];}lastFlipSideR.current=side;
    const failedRecent=flipCrossR.current.filter(x=>x.failed&&tickR.current-x.crossTick<=20).length;
    const pinRising=pinHistR.current.length>=15&&pinHistR.current.at(-1)>pinHistR.current[0];
    const holdSide=candR.current.slice(-10).length===10&&candR.current.slice(-10).every(x=>(x.spySpot>=m.gammaFlip)===(m.spySpot>=m.gammaFlip));
    const wallExpand=prevCallWallR.current!=null&&prevPutWallR.current!=null&&(m.callWall>prevCallWallR.current||m.putWall<prevPutWallR.current);
    let nextGate=chopGateR.current;if(nextGate==='OFF'&&((((m.gexInfluence||0)>=CHOP_PIN_ON)&&pinRising)||failedRecent>=3))nextGate='ON';else if((nextGate==='ON'&&(m.gexInfluence||0)<CHOP_PIN_OFF&&holdSide)||(nextGate==='ON'&&wallExpand))nextGate='OFF';
    if(nextGate!==chopGateR.current){chopGateR.current=nextGate;setChopGate(nextGate);addJournal(c.t,`CHOP_GATE ${nextGate} — pin ${((m.gexInfluence||0)*100).toFixed(0)}%, failed crosses ${failedRecent}, holdSide ${holdSide}, wallExpand ${wallExpand}.`);}prevCallWallR.current=m.callWall;prevPutWallR.current=m.putWall;
    const priorBrain=marketBrainR.current,nextBrain=updateMarketBrain(m,candR.current,priorBrain);marketBrainR.current=nextBrain;setMarketBrain(nextBrain);
    if(nextBrain.active!==priorBrain.active||Math.abs(nextBrain.bullPressure-priorBrain.bullPressure)>=8||Math.abs(nextBrain.bearPressure-priorBrain.bearPressure)>=8||(!priorBrain.entryReady&&nextBrain.entryReady))addJournal(c.t,`MARKET_BRAIN ${nextBrain.summary}${nextBrain.entryReady?` | ${nextBrain.entryReason}`:""}`);
    sessionTickData.current.push({tick:tickR.current,t:c.t,spySpot:m.spySpot,spxSpot:m.spxSpot,itsSPX:m.itsSPX,itsSPY:m.itsSPY,div:m.itsSPX-m.itsSPY,accel:m.accelerator,rawAccel:m.rawAccelerator??m.accelerator,fep:m.fep,ndf:m.ndf,iv:m.iv,gexInf:m.gexInfluence||0.1,netGex:m.netGex,conviction:confR.current.score});
    const np=computeProbs(m,candR.current),nc=computeConf(m,np),rawThesis=computeTheses(m,candR.current,thesisR.current),nt=unifyDirectionalState(rawThesis,nextBrain,thesisR.current);
    if(nt.gexVelocity?.terminalSpike)addJournal(c.t,`TERMINAL_SPIKE_BLOCK ${nt.gexVelocity.state} near structural wall; spike-direction entry blocked, opposite conviction boosted.`);
    if(nt.callDomSignal?.direction&&nt.gexVelocity?.direction&&nt.callDomSignal.direction!==nt.gexVelocity.direction)addJournal(c.t,`CALLDOM_GEX_DIVERGENCE callDom:${nt.callDomSignal.state} gex:${nt.gexVelocity.state}.`);
    probR.current=np;confR.current=nc;thesisR.current=nt;setProbs({...np});setConfData({...nc});setThesisData({...nt});
    setConfHist(prev=>[...prev.slice(-150),nc.score]);
    setItsSPXHist(prev=>[...prev.slice(-150),m.itsSPX]);
    setItsSPYHist(prev=>[...prev.slice(-150),m.itsSPY]);
    thesisHistR.current=[...thesisHistR.current.slice(-150),{t:c.t,call:nt.scores.call,put:nt.scores.put,wait:nt.scores.wait}];setThesisHist([...thesisHistR.current]);
    // v9: accumulate whole-session stats every tradeable tick (not just last 4-6 candles)
    if(!m.isPremarket){
      if(sessionOpenR.current==null)sessionOpenR.current=m.spySpot;
      sessionHighR.current=Math.max(sessionHighR.current,m.spySpot);
      sessionLowR.current=Math.min(sessionLowR.current,m.spySpot);
      if(m.spySpot>m.fep)aboveFepTotalR.current++;else if(m.spySpot<m.fep)belowFepTotalR.current++;
    }
    const recent12=candR.current.slice(-12),rHi=recent12.length?Math.max(...recent12.map(x=>x.spySpot)):m.spySpot,rLo=recent12.length?Math.min(...recent12.map(x=>x.spySpot)):m.spySpot;
    const callBuy=Math.max(m.gammaFlip,m.fep+0.35,rLo+0.18),putBuy=Math.min(m.gammaFlip,m.fep-0.35,rHi-0.18);
    setCallTrigger(callBuy);setPutTrigger(putBuy);setCallStop(Math.min(callBuy-0.55,m.fep-0.25));setPutStop(Math.max(putBuy+0.55,m.fep+0.25));
    const top=Object.entries(np).sort((a,b)=>b[1]-a[1])[0][0];
    if(top!==lastSR.current){lastSR.current=top;tlR.current=[...tlR.current,{t:fmt.time(m.h,m.m),state:top,probs:{...np}}];setTimeline([...tlR.current]);}
    const accelCrossed=m.accelerator>=7.4&&prevAccelR.current<7.4;
    const det=computeDeterministicPlan(m,candR.current,np,nt);
    const priorIntent=tradeIntentR.current;
    const intent=buildTradeIntent(m,candR.current,nextBrain,nt,det,chain,posR.current,nc,tradeMemoryR.current);tradeIntentR.current=intent;setTradeIntentData(intent);
    if(intent?.diagnostics?.reentry?.discipline?.code)addJournal(c.t,`${intent.diagnostics.reentry.discipline.code} repeated:${intent.diagnostics.reentry.discipline.repeatedCategory} override:${intent.diagnostics.reentry.discipline.override}.`);
    const leadLag=computeLeadLag(m,candR.current);
    const sm=sessionModelR.current;
    if(leadLag.state!==sm.lastLeadState){if(leadLag.opportunity)sm.leadOpp++;if(leadLag.state==='SPY_CATCHING_UP')sm.leadCatch++;if(leadLag.state==='SPY_REJECTING_SPX')sm.leadReject++;sm.lastLeadState=leadLag.state;}
    if(m.accelerator>=7.4&&m.accelerator<ACCEL_EXTREME_HIGH&&tickR.current-sm.lastAccelTick>4){sm.lastAccelTick=tickR.current;if(Math.abs(candR.current.slice(-4).at(0)?.spySpot-m.spySpot)>0.35)sm.accelFollow++;else sm.accelFail++;}
    const sessionLearning=summarizeSessionModel(sm);
    const localDir=det.dir;
    const currentThreshold=intent.threshold??(intent.contract?.quality==="ADAPTIVE"?88:80);
    const entryCritical=!posR.current&&m.isTradeable&&(
      String(intent.action||"").startsWith("BUY_")||
      (String(intent.action||"").startsWith("PREPARE_")&&(intent.executionReadiness??0)>=currentThreshold-4)
    );
    const priorEntryCritical=!posR.current&&(
      String(priorIntent?.action||"").startsWith("BUY_")||
      (String(priorIntent?.action||"").startsWith("PREPARE_")&&(priorIntent?.executionReadiness??0)>=(priorIntent?.threshold??80)-4)
    );
    const directionChanged=(intent.direction||"NONE")!==(priorIntent?.direction||"NONE");
    const episodeChanged=(intent.episodeKey||"NONE")!==(priorIntent?.episodeKey||"NONE");
    const readinessCross=entryCritical&&!priorEntryCritical;
    const actionableRefresh=entryCritical&&(tickR.current-lastAiTickR.current)>=6;
    const openPositionDue=!!posR.current&&(
      intent.action==="EXIT"||
      tickR.current-(lastAiTickR.current??-99)>=Math.max(2,posR.current.reevaluateAfterTicks||4)||
      tickR.current-posR.current.entryTick>=Math.max(2,(posR.current.pathDeadlineTicks||5)-1)
    );
    const meaningfulWaitCheck=!posR.current&&intent.action==="WAIT"&&(directionChanged||episodeChanged)&&(tickR.current-lastAiTickR.current)>=8;
    const shouldAskAI=m.isTradeable&&(readinessCross||actionableRefresh||openPositionDue||meaningfulWaitCheck||(entryCritical&&(directionChanged||episodeChanged)));
    prevAccelR.current=m.accelerator;
    if((tickR.current%6===0||localDir!=="WAIT")&&!posR.current&&!thinkR.current){addM({t:fmt.time(m.h,m.m),mindset:localDir!=="WAIT"?`deterministic ${det.mode}`:"local scan",reasoning:localDir!=="WAIT"?`Local ${localDir} context: ${det.reason}. ${leadLag.text}. Unified intent ${intent.action} ${intent.readiness}%.`:`No local entry. ${det.reason}. ${leadLag.text}.`,decision:localDir!=="WAIT"?`ARM_${localDir}`:"WAIT",score:nc.score,edgeState:localDir!=="WAIT"?"LOCAL_ARMED":"LOCAL_SCAN",confTrend:localDir!=="WAIT"?"BUILDING":"STABLE"});}
    if(localDir!=="WAIT"&&!posR.current&&m.isTradeable&&mL>=45){const isC=localDir==="CALL",contractMode=det.mode==="PIN_RANGE"?"pin":det.mode==="GEX_EXPANSION"?"expansion":"scalp",opt=selectContract(chain,isC,contractMode);addM({t:fmt.time(m.h,m.m),mindset:`deterministic guide ${det.mode}`,reasoning:`Playbook ${localDir}: ${det.reason}. ${leadLag.text}${opt?` | candidate ${opt.strike}${isC?"C":"P"} @$${opt.price.toFixed(2)} Δ${opt.delta.toFixed(2)} ${opt.tier}`:" | no valid contract"}. Unified intent ${intent.action} ${intent.readiness}%; blockers: ${(intent.blockers||[]).slice(0,3).join(", ")||"none"}.`,decision:`GUIDE_${localDir}`,score:nc.score,edgeState:"LOCAL_GUIDE",confTrend:"BUILDING"});}
    if(shouldAskAI&&!thinkR.current){
      lastAiTickR.current=tickR.current;
      thinkR.current=true;setThinking(true);
      const stableIdentity=stableIntentIdentity(intent);
      const requestCtx={
        id:++decisionSeqR.current,
        tick:tickR.current,
        startedAt:Date.now(),
        intentSig:intentSignature(intent),
        positionId:posR.current?.id||null,
        direction:stableIdentity.direction,
        episodeKey:stableIdentity.episodeKey,
        requestAction:intent.action,
        requestReadiness:intent.executionReadiness??intent.readiness??0,
        requestSpot:m.spySpot,
        requestMarketTime:fmt.time(m.h,m.m),
        startedPerf:typeof performance!=="undefined"?performance.now():null,
        lastActiveAt:Date.now(),
        entryCritical,
        freezeSim:entryCritical,
        cancelled:false
      };
      const controller=new AbortController();
      requestCtx.controller=controller;
      const timeoutId=setTimeout(()=>{requestCtx.cancelled=true;controller.abort("AI_TIMEOUT");},AI_REQUEST_TIMEOUT_MS);
      requestCtx.timeoutId=timeoutId;
      if(entryCritical)aiFreezeR.current=true;
      activeDecisionR.current=requestCtx;
      // v10: ground "how long has this been flat" in a real computed number instead of letting
      // the AI guess a duration it can't actually verify (it only ever sees ~8 candles). Count
      // consecutive recent ticks within 15c of current spot, from actual candle history.
      let flatTicks=0;for(let i=candR.current.length-1;i>=0&&Math.abs(candR.current[i].spySpot-m.spySpot)<0.15;i--)flatTicks++;
      const sessionSummary=(sessionOpenR.current!=null?`Session so far: opened $${sessionOpenR.current.toFixed(2)}, high $${sessionHighR.current.toFixed(2)}, low $${sessionLowR.current.toFixed(2)}, ${aboveFepTotalR.current} ticks above FEP / ${belowFepTotalR.current} below FEP out of ${aboveFepTotalR.current+belowFepTotalR.current} tradeable ticks.`:"Session just opened.")+` Price has held within 15c of current for ${flatTicks} consecutive ticks (~${flatTicks*4}min) — use this number, don't estimate your own duration.`;
      const applyDecision=(dec,source="AI")=>{
          const ts=fmt.time((latestMarketR.current||m).h,(latestMarketR.current||m).m);
          const currentMarket=latestMarketR.current||m;
          const semantic=semanticDecisionStatus(requestCtx,tickR.current,tradeIntentR.current,posR.current,currentMarket,dec);
          if(!semantic.valid){
            addM({t:fmt.time(currentMarket.h,currentMarket.m),mindset:"stale decision discarded",reasoning:`Request ${requestCtx.id} rejected: ${semantic.reason}.`,decision:"WAIT",score:confR.current.score,edgeState:"STALE_DECISION_DISCARDED",confTrend:"—"});
            addJournal(fmt.time(currentMarket.h,currentMarket.m),`STALE_DECISION_DISCARDED request:${requestCtx.id} requestTick:${requestCtx.tick} currentTick:${tickR.current} direction:${requestCtx.direction} episode:${requestCtx.episodeKey||"NONE"} reason:${semantic.reason} requestIntent:${requestCtx.intentSig} currentIntent:${intentSignature(tradeIntentR.current)}.`);
            return;
          }
          const liveTs=fmt.time(currentMarket.h,currentMarket.m);
          const liveIntent=tradeIntentR.current;
          const canonicalBuy=liveIntent?.action==="BUY_CALL"||liveIntent?.action==="BUY_PUT";
          const aiWait=dec.decision==="WAIT"||dec.decision==="WAITING";
          if(canonicalBuy&&aiWait){
            const veto=validateEntryVeto(dec.veto_reason,liveIntent,requestCtx,currentMarket);
            if(veto.valid){
              const audit=createVetoAudit(liveIntent,currentMarket,tickR.current,dec);
              if(audit)aiVetoAuditsR.current=[...aiVetoAuditsR.current,audit].slice(-12);
              addJournal(liveTs,`AI_VETO_ACCEPTED request:${requestCtx.id} canonical:${liveIntent.action} veto:${veto.code} evidence:${dec.veto_evidence||veto.reason}.`);
            }else{
              const originalReason=dec.reasoning;
              dec={...dec,decision:liveIntent.action,edge_state:"ENTRY_READY",confidence_trend:dec.confidence_trend==="DECAYING"?"STABLE":dec.confidence_trend,reasoning:`Canonical execution presumption applied. AI WAIT veto ${veto.code||"NONE"} was invalid: ${veto.reason}. Original: ${originalReason}`,veto_reason:"NONE"};
              addJournal(liveTs,`AI_WAIT_OVERRIDDEN request:${requestCtx.id} canonical:${liveIntent.action} invalidVeto:${veto.code||"NONE"} reason:${veto.reason}.`);
            }
          }
          addJournal(liveTs,`AI_DECISION_ACCEPTED request:${requestCtx.id} decision:${dec.decision} age:${semantic.ageTicks??(tickR.current-requestCtx.tick)}t/${Math.round(semantic.ageMs??0)}ms mode:${semantic.mode} current:${liveIntent?.action||"WAIT"}.`);
          const mb=marketBrainR.current;
          const mLn=(SESSION_END_H*60+SESSION_END_M)-(currentMarket.h*60+currentMarket.m);
          if((dec.decision==="WAIT"||dec.decision==="WAITING")&&dec.reasoning===lastWaitReasonR.current)repeatWaitR.current++;else repeatWaitR.current=0;
          lastWaitReasonR.current=dec.reasoning||"";
          addM({t:ts,mindset:dec.mindset||"—",reasoning:dec.reasoning||"—",decision:dec.decision,score:confR.current.score,edgeState:dec.edge_state||"—",confTrend:dec.confidence_trend||"—"});
          if(dec.journal_entry)addJournal(ts,dec.journal_entry);
          if(dec.memory_used&&dec.memory_used!=="none")addJournal(ts,`MEMORY_USED ${dec.memory_used}`);
          if(dec.decision==="SELL"&&posR.current){
            const p=posR.current,size=p.size||balR.current,r=(p.current/p.entry-1)*100,dollar=size*r/100;
            balR.current=size*(p.current/p.entry);
            logR.current=[...logR.current,{t:ts,action:`AI-EXIT ${p.strike}${p.isCall?"C":"P"} @$${p.current.toFixed(2)}`,result:`${fmt.pct(r)} (${dollar>=0?"+":""}${fmt.bal(dollar)})`,pnl:r,dollarPnl:dollar,exitType:"AI_SELL"}];
            setTradeLog([...logR.current]);addJournal(ts,`AI_EXIT_AUTHORIZED ${fmt.pct(r)} — ${dec.reasoning||"thesis invalidated"}`);
            tradeMemoryR.current=recordTradeOutcome(tradeMemoryR.current,p,m,r,"AI_SELL",tickR.current);
            posR.current=null;setPos(null);leadWrongTicksR.current=0;setBal(balR.current);
          }
          else if(dec.decision==="BUY_CALL"||dec.decision==="BUY_PUT"){
            const isC=dec.decision==="BUY_CALL";
            const executionMarket=latestMarketR.current||m;
            const snapshotIntent=tradeIntentR.current;
            const intentMatches=snapshotIntent?.contract&&snapshotIntent.direction===(isC?"CALL":"PUT")&&(snapshotIntent.action===dec.decision||snapshotIntent.action===`PREPARE_${isC?"CALL":"PUT"}`);
            const opt=intentMatches?{...snapshotIntent.contract,tier:snapshotIntent.contract.quality}:null;
            if(dec.current_thesis||dec.expected_next_path||dec.new_evidence||dec.prior_trade_effect)addJournal(ts,`AI_THESIS ${dec.current_thesis||"—"} | next ${dec.expected_next_path||"—"} | new ${dec.new_evidence||"—"} | prior ${dec.prior_trade_effect||"—"}.`);
            // v10: the AI's decision field and journal_entry text are two independent outputs from
            // the same call — nothing previously enforced they agree, and a decided-but-unfilled
            // trade (no priceable option, already in position, wrong window) was silently dropped
            // with zero record. Now every rejected fire is logged so it's visible, not vanished.
            if(balR.current<=1){addM({t:ts,mindset:"account depleted",reasoning:`Fired ${dec.decision} but account equity is depleted — no more trades this session.`,decision:"WAIT",score:confR.current.score,edgeState:"ACCOUNT_ZERO",confTrend:"—"});addJournal(ts,`ENTRY_BLOCKED ${dec.decision} — ACCOUNT_ZERO.`);}
            else if(posR.current){addM({t:ts,mindset:dec.mindset||"—",reasoning:`Fired ${dec.decision} but already in a position — decision/state mismatch, ignored.`,decision:"WAIT",score:confR.current.score,edgeState:"MISFIRE",confTrend:"—"});addJournal(ts,`ENTRY_BLOCKED ${dec.decision} — POSITION_ALREADY_OPEN.`);}
            else if((currentMarket.h*60+currentMarket.m)>=(TRADE_CUTOFF_H*60+TRADE_CUTOFF_M)){addM({t:ts,mindset:dec.mindset||"—",reasoning:`Fired ${dec.decision} at/after the 15:45 ET default 0DTE cutoff — blocked while observation continues through 16:15.`,decision:"WAIT",score:confR.current.score,edgeState:"ENTRY_BLOCKED",confTrend:"—"});addJournal(ts,`ENTRY_BLOCKED ${dec.decision} — DEFAULT_0DTE_CUTOFF_15_45.`);}
            else if(mLn<15){addM({t:ts,mindset:dec.mindset||"—",reasoning:`Fired ${dec.decision} inside final theta window (${mLn}min left) — blocked by no-entry rule.`,decision:"WAIT",score:confR.current.score,edgeState:"ENTRY_BLOCKED",confTrend:"—"});addJournal(ts,`ENTRY_BLOCKED ${dec.decision} — FINAL_THETA_WINDOW ${mLn}min.`);}
            else if(!executionMarket.isTradeable){addM({t:ts,mindset:dec.mindset||"—",reasoning:`Fired ${dec.decision} while premarket/untradeable — blocked.`,decision:"WAIT",score:confR.current.score,edgeState:"ENTRY_BLOCKED",confTrend:"—"});addJournal(ts,`ENTRY_BLOCKED ${dec.decision} — MARKET_NOT_TRADEABLE.`);}
            else if(!opt){addM({t:ts,mindset:dec.mindset||"—",reasoning:`Fired ${dec.decision}, but the canonical intent snapshot no longer contains the same-side contract. Entry rejected as stale rather than reselecting a different option.`,decision:"WAIT",score:confR.current.score,edgeState:"STALE_CONTRACT",confTrend:"—"});addJournal(ts,`ENTRY_BLOCKED ${dec.decision} — STALE_CONTRACT current intent ${snapshotIntent?.action||"NONE"}, direction ${snapshotIntent?.direction||"NONE"}, contract ${snapshotIntent?.contract?`${snapshotIntent.contract.strike}@${snapshotIntent.contract.price}`:"NONE"}.`);}
            else{
              const tc=clamp(Number(dec.trade_confidence)||65,20,98);
              const maxLossPct=clamp(Number(dec.max_loss_pct)||(5+(tc-45)*0.16),4,14);
              const takeProfitPct=clamp(24+(tc-50)*0.65,22,55);
              let stopSpot=Number(dec.invalidation_spot),targetSpot=Number(dec.target_spot);
              if(!Number.isFinite(stopSpot)||(isC?stopSpot>=executionMarket.spySpot:stopSpot<=executionMarket.spySpot))stopSpot=isC?executionMarket.spySpot-(0.25+tc/220):executionMarket.spySpot+(0.25+tc/220);
              if(!Number.isFinite(targetSpot)||(isC?targetSpot<=executionMarket.spySpot:targetSpot>=executionMarket.spySpot))targetSpot=isC?executionMarket.spySpot+(0.55+tc/120):executionMarket.spySpot-(0.55+tc/120);
              posR.current={id:`P${++positionSeqR.current}`,strike:opt.strike,isCall:isC,entry:opt.price,current:opt.price,quoteSource:opt.quoteSource||executionMarket.quoteSource||"MODELED",contract:opt.contract||null,entryTime:ts,entrySpot:executionMarket.spySpot,stopSpot,targetSpot,maxLossPct,noiseTolerancePct:22,vehicleFailurePct:38,catastrophicLossPct:50,pathDeadlineTicks:tc>=85?5:4,minExpectedProgress:tc>=85?0.24:0.18,takeProfitPct,tradeConfidence:tc,planType:det.mode,size:balR.current,entryTick:tickR.current,entryAccel:executionMarket.accelerator,lastSpot:executionMarket.spySpot,lastIv:executionMarket.iv,peakPrice:opt.price,peakPnl:0,maxFavorableSpot:executionMarket.spySpot,maxAdverseSpot:executionMarket.spySpot,episodeKey:snapshotIntent.episodeKey||tradeEpisodeKey(isC?"CALL":"PUT",executionMarket,det),primaryCategory:nt.primaryCategory||"UNKNOWN",entryThesis:dec.current_thesis||`${snapshotIntent.direction} ${snapshotIntent.setupQuality}% setup`,expectedPath:dec.expected_next_path||(isC?`within ${tc>=85?5:4} ticks hold above ${stopSpot.toFixed(2)} and gain at least ${tc>=85?"0.24":"0.18"} before pressing toward ${targetSpot.toFixed(2)}`:`within ${tc>=85?5:4} ticks hold below ${stopSpot.toFixed(2)} and gain at least ${tc>=85?"0.24":"0.18"} before pressing toward ${targetSpot.toFixed(2)}`),aiNewEvidence:dec.new_evidence||"",aiPriorTradeEffect:dec.prior_trade_effect||"",reevaluateAfterTicks:dec.reevaluate_after_ticks||null};
              setPos({...posR.current});
              logR.current=[...logR.current,{t:ts,action:`CANONICAL FILL ${isC?"BUY CALL":"BUY PUT"} ${opt.strike}${isC?"C":"P"} @$${opt.price.toFixed(2)} ${opt.tier||opt.quality||"QUALITY"} source:${opt.quoteSource||executionMarket.quoteSource||"MODELED"} invalidation ${stopSpot.toFixed(2)} target ${targetSpot.toFixed(2)} noise 22% vehicleFail 38% catastrophic 50% deadline ${tc>=85?5:4}t confidence ${tc.toFixed(0)}`,result:null,quoteSource:opt.quoteSource||executionMarket.quoteSource||"MODELED"}];
              setTradeLog([...logR.current]);
              reliabilityR.current.totalTrades++;if(source==="FALLBACK")reliabilityR.current.fallbackExecutions++;
              addJournal(ts,`ENTRY_EXECUTED ${source} ${isC?"BUY_CALL":"BUY_PUT"} ${opt.strike}${isC?"C":"P"} @$${opt.price.toFixed(2)} | QUOTE_SOURCE ${opt.quoteSource||executionMarket.quoteSource||"MODELED"} | SPY ${executionMarket.spySpot.toFixed(2)} | readiness ${snapshotIntent.executionReadiness??snapshotIntent.readiness}% | confidence ${tc.toFixed(0)}.`);
              const side=isC?"CALL":"PUT";
              tradeMemoryR.current={...tradeMemoryR.current,lastEntry:{side,strike:opt.strike,spot:executionMarket.spySpot,price:opt.price,tick:tickR.current,whyNow:snapshotIntent.whyNow||[]},totalEntries:(tradeMemoryR.current.totalEntries||0)+1,sameThesisAttempts:{...(tradeMemoryR.current.sameThesisAttempts||{}),[side]:(tradeMemoryR.current.sameThesisAttempts?.[side]||0)+1}};
            }
          }
      };
      callAI(m,posR.current,balR.current,candR.current,probR.current,confR.current,thesisR.current,journalR.current,rules.approved,repeatWaitR.current,sessionSummary+`\n${sessionLearning}\n${tradeMemorySnapshot(tradeMemoryR.current,m)}\nCANONICAL EXECUTION STATE — AUTHORITATIVE:
action ${intent.action}; direction ${intent.direction||"NONE"}; setup ${intent.setupQuality}%; readiness ${intent.executionReadiness}% / threshold ${intent.threshold??"—"}%; contract ${intent.contract?`${intent.contract.strike}${intent.direction==="PUT"?"P":"C"} $${intent.contract.price.toFixed(2)} ${intent.contract.quality}`:"NONE"}; hard blockers ${hardExecutionBlockers(intent).join(", ")||"NONE"}; all blockers ${(intent.blockers||[]).join(", ")||"NONE"}.
If action is BUY and hard blockers are NONE, execute unless an allowed veto_reason is objectively true right now. Do not request extra confirmation for already-passed checks.\n${leadLag.text}`,marketBrainR.current,controller.signal)
        .then(dec=>applyDecision(dec,"AI"))
        .catch(e=>{
          const ts=fmt.time((latestMarketR.current||m).h,(latestMarketR.current||m).m),raw=String(e.rawResponse||e.message||"unknown error").slice(0,700);
          const liveMarket=latestMarketR.current||m;
          if(requestCtx.cancelled||e?.name==="AbortError"){
            addM({t:ts,mindset:"AI request cancelled",reasoning:`Request ${requestCtx.id} cancelled or timed out; no fallback trade permitted.`,decision:"WAIT",score:confR.current.score,edgeState:"AI_REQUEST_CANCELLED",confTrend:"—"});
            addJournal(ts,`AI_REQUEST_CANCELLED request:${requestCtx.id} reason:${String(e?.message||"cancelled")} tick:${requestCtx.tick} currentTick:${tickR.current}.`);
            return;
          }
          const syntheticFailureDecision=posR.current?{decision:"HOLD"}:{decision:requestCtx.direction==="CALL"?"BUY_CALL":requestCtx.direction==="PUT"?"BUY_PUT":"WAIT"};
          const semantic=semanticDecisionStatus(requestCtx,tickR.current,tradeIntentR.current,posR.current,liveMarket,syntheticFailureDecision);
          if(!semantic.valid){
            addM({t:fmt.time(liveMarket.h,liveMarket.m),mindset:"stale AI failure discarded",reasoning:`Request ${requestCtx.id} failed after semantic state changed: ${semantic.reason}. No fallback execution permitted.`,decision:"WAIT",score:confR.current.score,edgeState:"STALE_DECISION_DISCARDED",confTrend:"—"});
            addJournal(fmt.time(liveMarket.h,liveMarket.m),`STALE_DECISION_DISCARDED request:${requestCtx.id} after failure — ${semantic.reason} — ${raw}`);
            return;
          }
          addM({t:ts,mindset:"AI response failure",reasoning:raw,decision:"FALLBACK",score:confR.current.score,edgeState:"ERROR_RECOVERED",confTrend:"UNCLEAR"});
          reliabilityR.current.parseFailures++;
          addJournal(ts,`AI_RESPONSE_FAILURE ${raw}`);
          const fallback=buildFallbackDecision(m,posR.current,tradeIntentR.current,tradeMemoryR.current);
          addJournal(ts,`FALLBACK_DECISION ${fallback.decision} — ${fallback.reasoning}`);
          applyDecision(fallback,"FALLBACK");
        })
        .finally(()=>{clearTimeout(requestCtx.timeoutId);if(activeDecisionR.current?.id===requestCtx.id)activeDecisionR.current=null;if(requestCtx.freezeSim)aiFreezeR.current=false;thinkR.current=false;setThinking(false);});
    }
  },[aiFreq,addM,addJournal,rules.approved]);

  useEffect(()=>{if(!running||!engR.current)return;ivR.current=setInterval(()=>{if(!aiFreezeR.current)doTick(engR.current);},Math.max(150,BASE_TICK_MS/speed));return()=>clearInterval(ivR.current);},[running,speed,doTick]);

  useEffect(()=>{
    const cancelActive=reason=>{
      const ctx=activeDecisionR.current;
      if(!ctx)return;
      ctx.cancelled=true;
      ctx.controller?.abort(reason);
      clearTimeout(ctx.timeoutId);
      activeDecisionR.current=null;
      aiFreezeR.current=false;
      thinkR.current=false;
      setThinking(false);
      const lm=latestMarketR.current;
      if(lm)addJournal(fmt.time(lm.h,lm.m),`AI_REQUEST_CANCELLED request:${ctx.id} reason:${reason}.`);
    };
    if(!running)cancelActive("SIMULATION_PAUSED");
    return()=>{};
  },[running,addJournal]);

  const prevSpeedR=useRef(speed);
  useEffect(()=>{
    if(prevSpeedR.current!==speed&&activeDecisionR.current){
      const ctx=activeDecisionR.current;
      ctx.cancelled=true;ctx.controller?.abort("SPEED_CHANGED");clearTimeout(ctx.timeoutId);
      activeDecisionR.current=null;aiFreezeR.current=false;thinkR.current=false;setThinking(false);
      const lm=latestMarketR.current;if(lm)addJournal(fmt.time(lm.h,lm.m),`AI_REQUEST_CANCELLED request:${ctx.id} reason:SPEED_CHANGED ${prevSpeedR.current}x→${speed}x.`);
    }
    prevSpeedR.current=speed;
  },[speed,addJournal]);

  useEffect(()=>{
    const onVisibility=()=>{
      lastActiveWallR.current=Date.now();
      if(document.hidden&&activeDecisionR.current){
        const ctx=activeDecisionR.current;
        ctx.cancelled=true;ctx.controller?.abort("APP_BACKGROUNDED");clearTimeout(ctx.timeoutId);
        activeDecisionR.current=null;aiFreezeR.current=false;thinkR.current=false;setThinking(false);
        const lm=latestMarketR.current;if(lm)addJournal(fmt.time(lm.h,lm.m),`AI_REQUEST_CANCELLED request:${ctx.id} reason:APP_BACKGROUNDED.`);
      }
    };
    document.addEventListener("visibilitychange",onVisibility);
    return()=>document.removeEventListener("visibilitychange",onVisibility);
  },[addJournal]);

  const startSession=useCallback((mode)=>{
    const replayData=selectedReplayDate==="2026-07-08"?REAL_REPLAY_DATA:(REPLAY_CATALOG[selectedReplayDate]||SPX_JUL1);
    engR.current=mode==="replay"?createReplayEngine(replayData):createSeedEngine();
    const sess=engR.current.getSession();
    archetypeIdR.current=mode==="seed"?sess.archetype:null;
    const label=mode==="replay"?`${replayData.label} · ${replayData.dayType}`:`SEED v26 · ${sess.archetypeLabel} (modeled: ${sess.sourceDay})`;
    setSessionLabel(label);setSessionMode(mode);setBal(STARTING_BALANCE);balR.current=STARTING_BALANCE;
    setPos(null);posR.current=null;setTradeIntentData({action:"WAIT",direction:null,readiness:0,confidence:0,contract:null,blockers:["Session warming up"],supportingFactors:[]});tradeIntentR.current={action:"WAIT",readiness:0,confidence:0,blockers:["Session warming up"],supportingFactors:[]};setTradeLog([]);logR.current=[];setMindsetLog([]);mindR.current=[];tradeMemoryR.current=createSessionTradeMemory();reliabilityR.current={totalRequests:0,parseFailures:0,totalTrades:0,fallbackExecutions:0};if(activeDecisionR.current){activeDecisionR.current.cancelled=true;activeDecisionR.current.controller?.abort("SESSION_RESET");clearTimeout(activeDecisionR.current.timeoutId);}activeDecisionR.current=null;decisionSeqR.current=0;positionSeqR.current=0;latestMarketR.current=null;aiFreezeR.current=false;lastMeaningfulAiKeyR.current="";lastActiveWallR.current=Date.now();aiVetoAuditsR.current=[];
    setJournal([]);journalR.current=[];setCandles([]);candR.current=[];setConfHist([]);
    setItsSPXHist([]);setItsSPYHist([]);setTimeline([]);tlR.current=[];
    setProbs({discovery:25,pin:25,transition:25,macro:25});setConfData({score:50,factors:[]});setOptionChain(null);
    lastSR.current="transition";tickR.current=0;thinkR.current=false;sessionTickData.current=[];
    sessionOpenR.current=null;sessionHighR.current=-Infinity;sessionLowR.current=Infinity;aboveFepTotalR.current=0;belowFepTotalR.current=0;
    prevAccelR.current=0;lastAiTickR.current=-99;repeatWaitR.current=0;lastWaitReasonR.current="";lastMindsetKeyR.current="";optionMemoryR.current={};marketBrainR.current=createMarketBrain();setMarketBrain(marketBrainR.current);chopGateR.current="OFF";setChopGate("OFF");pinHistR.current=[];flipCrossR.current=[];lastFlipSideR.current=null;leadWrongTicksR.current=0;prevCallWallR.current=null;prevPutWallR.current=null;sessionModelR.current={leadOpp:0,leadCatch:0,leadReject:0,accelFollow:0,accelFail:0,pinWins:0,pinLosses:0,lastLeadState:"",lastAccelTick:-99};
    setDone(false);setSaved(false);setGexInf(0.08);setPatchProposals([]);setPatchIdx(0);
    storageSet("interrupted",null);setRunning(true);setScreen("trading");
  },[selectedReplayDate]);

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
    while(!((m.h>SESSION_END_H)||(m.h===SESSION_END_H&&m.m>=SESSION_END_M))){m=eng.tick();tickR.current++;const mL=(SESSION_END_H*60+SESSION_END_M)-(m.h*60+m.m),octx=optionCtx(m,candR.current,optionMemoryR.current);if(posR.current&&m.isTradeable){const p0=posR.current,k=`${p0.isCall?'C':'P'}${p0.strike}`,np=priceOpt(m.spySpot,p0.strike,m.iv,mL,p0.isCall,{...octx,prev:optionMemoryR.current[k]});optionMemoryR.current[k]={price:np,peak:Math.max(optionMemoryR.current[k]?.peak||np,np)};posR.current={...posR.current,current:np};}}
    if(posR.current){const p=posR.current,size=p.size||balR.current,r=(p.current/p.entry-1)*100,dollar=size*r/100;balR.current=size*(p.current/p.entry);logR.current=[...logR.current,{t:"16:00",action:`AUTO-CLOSE ${p.strike}${p.isCall?"C":"P"}`,result:`${fmt.pct(r)} (${dollar>=0?"+":""}${fmt.bal(dollar)})`,pnl:r,dollarPnl:dollar}];setTradeLog([...logR.current]);posR.current=null;setPos(null);}
    setMkt(m);setBal(balR.current);setDone(true);storageSet("interrupted",null);
  },[]);

  const saveSession=useCallback(async()=>{
    const r=((balR.current-STARTING_BALANCE)/STARTING_BALANCE)*100,cl=logR.current.filter(l=>l.pnl!==undefined),ws=cl.filter(l=>(l.pnl||0)>=0);
    const signalTotal=sessionModelR.current.accelFollow+sessionModelR.current.accelFail,signalCleanliness=signalTotal?sessionModelR.current.accelFollow/signalTotal:0,tradeFollowThrough=cl.length?cl.filter(t=>(t.pnl||0)>0).length/cl.length:0;
    const reliability=reliabilityRates(reliabilityR.current);
    const sess={id:Date.now(),signalCleanliness,tradeFollowThrough,...reliability,fallbackUsed:reliability.fallbackExecutionRate>0,gexVelocityState:thesisR.current?.gexVelocity?.state||"OSCILLATING",marketBrain:marketBrainR.current,name:`SIM · ${sessionLabel} · ${r>=0?"+":""}${r.toFixed(0)}%`,date:new Date().toLocaleDateString(),balance:balR.current,returnPct:r,trades:logR.current,mindset:mindR.current,journal:journalR.current,timeline:tlR.current,winRate:cl.length>0?`${ws.length}/${cl.length}`:"—",label:sessionLabel,tickData:sessionTickData.current};
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
  const posDollar=pos?((pos.size||balR.current)*(pos.current/pos.entry-1)):0;
  const mLeft=mkt?(SESSION_END_H*60+SESSION_END_M)-(mkt.h*60+mkt.m):390;
  const isPremarket=mkt?.isPremarket||false;
  const lastM=mindsetLog[mindsetLog.length-1];
  const div=mkt?(mkt.itsSPX-mkt.itsSPY):0;
  const divColor=div>0.5?T.accent:div<-0.5?T.red:T.yellow;

  if(screen==="home")return(
    <div style={{background:T.bg,minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"monospace"}}>
      <div style={{fontSize:9,color:T.muted,letterSpacing:"0.2em",marginBottom:8}}>FIRSTSIGNAL OS v3</div>
      <div style={{fontSize:26,fontWeight:700,color:T.accent,marginBottom:4}}>GCDT</div>
      <div style={{fontSize:9,color:T.muted,marginBottom:28,textAlign:"center",opacity:0.6}}>GEX Composite Divergence Trading</div>
      {resumeAvailable&&<button onClick={resumeSession} style={{width:"100%",maxWidth:280,padding:"11px 0",background:T.yellowDim,color:T.yellow,border:`1px solid ${T.yellow}40`,borderRadius:6,fontFamily:"monospace",fontSize:11,fontWeight:700,cursor:"pointer",marginBottom:10}}>RESUME SESSION ↩</button>}
      <div style={{width:"100%",maxWidth:280,marginBottom:16}}>
        <div style={{fontSize:9,color:T.muted,marginBottom:8,textAlign:"center",letterSpacing:"0.1em"}}>NEW SESSION · v26 AIR-GAP</div>
        <select value={selectedReplayDate} onChange={e=>setSelectedReplayDate(e.target.value)} style={{width:"100%",marginBottom:8,padding:"8px 10px",background:T.surface,color:T.text,border:`1px solid ${T.border}`,borderRadius:6,fontFamily:"monospace",fontSize:10}}>
          {REPLAY_DATES.map(d=><option key={d} value={d}>{REPLAY_CATALOG[d].label}</option>)}
        </select>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>startSession("seed")} style={{flex:1,padding:"12px 0",background:T.accentDim,color:T.accent,border:`1px solid ${T.accent}40`,borderRadius:6,fontFamily:"monospace",fontSize:11,fontWeight:700,cursor:"pointer"}}>SEED v26<div style={{fontSize:8,opacity:0.7,marginTop:2}}>6 data-calibrated archetypes</div></button>
          <button onClick={()=>startSession("replay")} style={{flex:1,padding:"12px 0",background:"#a78bfa18",color:T.purple,border:`1px solid ${T.purple}40`,borderRadius:6,fontFamily:"monospace",fontSize:11,fontWeight:700,cursor:"pointer"}}>REPLAY<div style={{fontSize:8,opacity:0.7,marginTop:2}}>{REPLAY_CATALOG[selectedReplayDate]?.label||"Select date"}</div></button>
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
            <div style={{fontSize:11,color:T.text,marginBottom:3}}>{s.name} {s.fallbackUsed&&<span style={{fontSize:8,color:T.red,border:`1px solid ${T.red}60`,padding:"1px 4px",borderRadius:3}}>FALLBACK-EXECUTED</span>}</div>
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
          {[["FINAL",fmt.bal(s.balance)],["RETURN",fmt.pct(s.returnPct)],["WIN RATE",s.winRate],["TRADES",String(s.trades.filter(t=>t.pnl!==undefined).length)],["SIGNAL CLEAN",`${((s.signalCleanliness||0)*100).toFixed(0)}%`],["FOLLOW THROUGH",`${((s.tradeFollowThrough||0)*100).toFixed(0)}%`],["PARSE FAIL",`${((s.parseFailureRate||0)*100).toFixed(1)}%`],["FALLBACK EXEC",`${((s.fallbackExecutionRate||0)*100).toFixed(1)}%`],["GEX VELOCITY",s.gexVelocityState||"OSCILLATING"],["SESSION THESIS",`${s.marketBrain?.active||"WAIT"} ${s.marketBrain?.confidence||0}%`]].map(([l,v])=>(
            <div key={l} style={{padding:"10px 12px",background:T.surface,borderRadius:6,border:`1px solid ${T.border}`}}><div style={{fontSize:9,color:T.muted,marginBottom:3}}>{l}</div><div style={{fontSize:13,fontWeight:700}}>{v}</div></div>
          ))}
        </div>
        {s.journal?.length>0&&<><div style={{fontSize:10,color:T.muted,marginBottom:8}}>SESSION JOURNAL</div>{s.journal.map((j,i)=><div key={i} style={{fontSize:9,color:T.muted,marginBottom:4,paddingLeft:8,borderLeft:`2px solid ${T.border}`}}><span style={{color:T.accent}}>{j.t}</span> {j.entry}</div>)}</>}
        {s.mindset?.length>0&&<><div style={{fontSize:10,color:T.muted,marginTop:12,marginBottom:8}}>AI MINDSET LOG ({s.mindset.length})</div>{s.mindset.map((e,i)=><div key={i} style={{padding:"7px 9px",borderRadius:4,background:T.surface,border:`1px solid ${e.edgeState==="MISFIRE"?T.red+"60":e.edgeState==="ERROR"?T.yellow+"60":T.border}`,marginBottom:6}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}><span style={{fontSize:8,color:T.muted}}>{e.t}</span><span style={{fontSize:8,color:e.edgeState==="MISFIRE"?T.red:e.edgeState==="ERROR"?T.yellow:T.muted,fontWeight:e.edgeState==="MISFIRE"||e.edgeState==="ERROR"?700:400}}>{e.edgeState} [{e.score}] {e.decision}</span></div><div style={{fontSize:9,color:T.text}}>{e.reasoning}</div></div>)}</>}
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
            <span style={{fontSize:9,fontWeight:700,color:T.accent}}>GCDT · FS OS v3 · {BUILD_ID}</span>
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
        <div style={{fontSize:7,color:T.purple,marginBottom:2,opacity:0.85}}>{sessionMode==="seed"?`Dual-stream archetype mode · SPX fidelity: ${mkt?.spxFidelity||"estimated"}`:"SPX anchored to real Jul 1 snapshots · SPY is independent lag/noise estimate"}</div>
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
        <div style={{textAlign:"right"}}><div style={{fontSize:15,fontWeight:700,color:posPnl>=0?T.accent:T.red}}>${pos.current.toFixed(2)}</div><div style={{fontSize:9,color:posPnl>=0?T.accent:T.red}}>{fmt.pct(posPnl)} · {posDollar>=0?"+":""}{fmt.bal(posDollar)}</div></div>
      </div>}

      <div style={{flex:1,overflowY:"auto",paddingBottom:20}}>
        {mkt&&<div style={{background:T.surface,borderRadius:8,border:`1px solid ${isPremarket?T.yellow+"40":T.border}`,margin:"8px 14px",overflow:"hidden"}}>
          <PriceChart candles={candles} gammaFlip={mkt.gammaFlip} callWall={mkt.callWall} putWall={mkt.putWall} position={pos} isPremarket={isPremarket} callTrigger={callTrigger} putTrigger={putTrigger} callStop={callStop} putStop={putStop}/>
          <div style={{padding:"7px 12px",borderTop:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{fontSize:18,fontWeight:700}}>${mkt.spySpot.toFixed(2)}</div><div style={{fontSize:8,color:mkt.spySpot>mkt.gammaFlip?T.accent:T.red}}>{mkt.spySpot>mkt.gammaFlip?"▲":"▼"} FLIP ${mkt.gammaFlip.toFixed(1)}</div></div>
            <div style={{textAlign:"center"}}><div style={{fontSize:9,color:T.muted}}>SPX GEX {fmt.gex(mkt.netGexSpx??mkt.netGex*10)}</div><div style={{fontSize:12,fontWeight:700,color:T.purple}}>{mkt.spxSpot.toFixed(0)}</div><div style={{fontSize:7,color:T.muted}}>SPY GEX {fmt.gex(mkt.netGex)}</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:10,fontWeight:700,color:mkt.netGex>0?T.accent:T.red}}>{fmt.gex(mkt.netGex)}</div><div style={{fontSize:7,color:mkt.netGex>0?T.accent:T.red}}>{mkt.netGex>0?"PIN":"AMP"} {(gexInf*100).toFixed(0)}%</div></div>
          </div>
        </div>}

        {mkt&&<div style={{background:T.surface,borderRadius:8,border:`1px solid ${T.border}`,margin:"0 14px 8px",padding:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:9,color:T.muted,letterSpacing:"0.1em"}}>ITS SIGNAL</span>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:8,color:T.muted}}>DIV</span>
              <span style={{fontSize:20,fontWeight:700,color:divColor}}>{div>=0?"+":""}{div.toFixed(2)}</span>
              <span style={{fontSize:8,color:divColor}}>{Math.abs(div)<0.3?"CONVERGED":div>0.5?"SPX LEADS":"SPY LEADS"}</span>
            </div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <div style={{flex:1,background:T.surface2,borderRadius:6,padding:"8px 10px"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:8,color:T.purple}}>SPX ITS</span>
                <span style={{fontSize:11,fontWeight:700,color:T.purple}}>{mkt.itsSPX.toFixed(2)}</span>
              </div>
              <Spark data={itsSPXHist} color={T.purple} h={32} w={130} fill={true}/>
              <div style={{fontSize:8,color:T.muted,marginTop:3}}>{mkt.spxSpot.toFixed(0)} · GEX {fmt.gex(mkt.netGexSpx??mkt.netGex*10)}</div>
              <div style={{fontSize:6,color:sessionMode==="replay"&&!mkt.synthData?T.accent:T.yellow,marginTop:2,letterSpacing:"0.04em"}}>{sessionMode==="replay"?(mkt.synthData?"SYNTH · gap-fill":"REAL · Jul 1 snapshot"):"SYNTH · archetype"}</div>
            </div>
            <div style={{flex:1,background:T.surface2,borderRadius:6,padding:"8px 10px"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:8,color:T.text}}>SPY ITS</span>
                <span style={{fontSize:11,fontWeight:700,color:T.text}}>{mkt.itsSPY.toFixed(2)}</span>
              </div>
              <Spark data={itsSPYHist} color={T.text} h={32} w={130} fill={false}/>
              <div style={{fontSize:8,color:T.muted,marginTop:3}}>${mkt.spySpot.toFixed(2)} · GEX {fmt.gex(mkt.netGex)}</div>
              <div style={{fontSize:6,color:T.accent,marginTop:2,letterSpacing:"0.04em"}}>MODELED · independent lag/noise stream</div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginTop:8}}>
            {[["NDF",(mkt.ndf>=0?"+":"")+mkt.ndf.toFixed(3),mkt.ndf>0.1?T.accent:mkt.ndf<-0.1?T.red:T.muted],["FEP GAP",(mkt.spySpot-mkt.fep>=0?"+":"")+(mkt.spySpot-mkt.fep).toFixed(2),Math.abs(mkt.spySpot-mkt.fep)>1.5?T.yellow:T.muted],["IV",mkt.iv.toFixed(1)+"%",T.muted]].map(([l,v,c])=>(
              <div key={l}><div style={{fontSize:8,color:T.muted}}>{l}</div><div style={{fontSize:11,fontWeight:700,color:c}}>{v}</div></div>
            ))}
          </div>
        </div>}

        {mkt&&<TradeIntentPanel intent={tradeIntentData}/>} 
        {mkt&&<OptionChainPanel chain={optionChain} pos={pos}/>}

        {mkt&&<div style={{background:T.surface,borderRadius:8,border:`1px solid ${T.border}`,margin:"0 14px 8px",padding:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <span style={{fontSize:9,color:T.muted,letterSpacing:"0.1em"}}>REGIME STATE</span>
            <span style={{fontSize:10,fontWeight:700,color:topColor}}>{topS[0].toUpperCase()} {topS[1]}%</span>
          </div>
          <StateBars probs={probs}/>
          <div style={{marginTop:8}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
              <span style={{fontSize:8,color:T.muted}}>GEX INFLUENCE · {chopGate} · BRAIN {marketBrain.active} {marketBrain.confidence}%</span>
              <span style={{fontSize:8,color:gexInf>0.7?T.red:gexInf<0.28?T.accent:T.yellow}}>{gexInf>0.7?"DOMINANT":gexInf<0.28?"WEAK":"MODERATE"} {(gexInf*100).toFixed(0)}%</span>
            </div>
            <div style={{height:3,background:T.dim,borderRadius:2}}><div style={{height:"100%",width:`${gexInf*100}%`,background:gexInf>0.7?T.red:gexInf<0.28?T.accent:T.yellow,borderRadius:2,transition:"width 0.5s"}}/></div>
          </div>
          <div style={{height:1,background:T.border,margin:"10px 0"}}/>
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
          <input type="range" min="0.5" max="10" step="0.5" value={speed} onChange={e=>setSpeed(Number(e.target.value))} style={{width:"100%",accentColor:T.accent}}/>
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

