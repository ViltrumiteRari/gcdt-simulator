import { useState, useEffect, useRef, useCallback } from "react";
import { REPLAY_CATALOG, REPLAY_DATES } from "./replayCatalog";
import { REAL_REPLAY_META, loadRealReplay } from "./replayAssets";
import { replayQualityFor } from "./replayQuality";
import { classifyGexVelocity, classifyCallDom, choosePrimarySignal, evaluateReentryDiscipline, reliabilityRates } from "./strategyCore";
import { createContextMemory, computeItsHierarchy, computeFlowLens, harmonizeThesis, contextPrompt } from "./contextLayers";
import { geminiLiveTrader } from "./geminiLiveTrader";
import { createMetacognitionState, computeGexImpulse, createForecast, scoreForecast, applyForecastTrust, shouldActivateDrawdownReview, buildTradeDiagnostics, analyzeDataHealth, updateTransmissionState, applyMetacognitiveGates, shouldEmitCognition, updateExpectationFailureState } from "./metacognition";
import { createMultiTimeframeState, updateMultiTimeframeState, applyMultiTimeframeGate, multiTimeframePrompt } from "./multiTimeframeTrader";
import { createDeterministicDecisionState, updateDeterministicDecisionCore } from "./deterministicDecisionCore";
import { createAlphaRegimeState, updateAlphaRegime } from "./alphaRegimeEngine";
import { updateDeterministicPositionManager } from "./deterministicPositionManager";

const PRODUCT_NAME = "FirstSignal Sim";
const PRODUCT_VERSION = "v1";
const BUILD_ID = "firstsignal-sim-v1.21-preserve-completed-session-view-20260718";
const BUILD_SEQUENCE = 21;
const AGENT_PORT = new URLSearchParams(window.location.search).get('agentPort') || '8766';
const AGENT_BASE = `http://127.0.0.1:${AGENT_PORT}`;
const SIM_BASE = 'http://127.0.0.1:8765';
const loadUnifiedSeed=async seed=>{const suffix=seed?`?seed=${encodeURIComponent(seed)}`:'';const r=await fetch(`${SIM_BASE}/api/seed${suffix}`,{cache:'no-store'});const data=await r.json();if(!r.ok||!Array.isArray(data?.snapshots)||data?.quality?.level!=='GREEN')throw new Error(data?.error||'SEED_NOT_READY');return data;};
const AVAILABLE_REPLAY_DATES=[...new Set([...Object.keys(REAL_REPLAY_META),...REPLAY_DATES])].sort().reverse();
const replayMetaFor=date=>REAL_REPLAY_META[date]||REPLAY_CATALOG[date]||null;
const replayDataFor=async date=>REAL_REPLAY_META[date]?loadRealReplay(date):(REPLAY_CATALOG[date]||null);
const ARCHITECTURE_MANIFEST=`FIRSTSIGNAL ARCHITECTURE SELF-MODEL
Purpose: identify and exploit temporary SPY 0DTE environments where repeated asymmetric wins become structurally plausible.
Authority order: observed market/options data -> separate SPX/SPY positioning and price-location observations -> relationship lenses -> market-structure/regime interpretation -> unified CALL/PUT/WAIT thesis -> canonical executable intent -> AI execution and management.
ITS is a bounded tension/positioning proxy centered near 6 when call/put dominance is balanced and price is near its FEP. Readings moving toward roughly 9 or 3 indicate increasing tension, but are not automatic reversal or continuation signals. Persistence at an extreme may mean structural relocation or a skewed effective FEP.
Never collapse the following into one master number: absolute SPX ITS, absolute SPY ITS, each instrument's structural ITS baseline, each local deviation from baseline, raw SPX and SPY FEP distances in their own denominations, SPX/SPY ITS divergence, and normalized FEP-distance disagreement.
Structural ITS describes persistent SPX/SPY positioning and lead-lag relationships over the broader window. Local ITS describes current stretch, catch-up, convergence, or lead reversal. Neither independently chooses PINNING, EXPANSION, BREAKDOWN, or WAIT.
Treat raw SPX and SPY positioning relationships as predictive state, not merely descriptive confirmation. Distinguish each instrument's net-exposure level and velocity, the normalized SPX-minus-SPY exposure gap, whether that gap is widening or closing, the raw call-dominance gap and its velocity, wall distance and migration, and the age/freshness of each observation. Alignment generally supports compression; meaningful divergence signals tension and greater expansion potential, but direction still requires price transmission, location, and contract response.
Harvest is a persistent session state, not a reward for a prior winning trade. Conceptually distinguish NO_HARVEST, PRIMING, ACTIVE_CALL_HARVEST, ACTIVE_PUT_HARVEST, EXHAUSTING, and SIDE_FLIP_TRANSITION. A harvest state may continue across sequential contracts only while predictive structure remains intact and newly eligible contracts still confirm before expansion.
Pinning, expansion, breakdown, discovery, and transition are market-structure interpretations produced from ITS relationships together with price acceptance, FEP/flip behavior, SPX GEX, walls/OI, acceleration, flow, and historical/local territory.
Options flow includes sweep, multi-exchange, block, bid/ask-side premium, repeated activity, and comprisingTrades price-level evidence. Flow is evidence of urgency and possible intent, while broker routing, hedges, rolls, and packages remain competing explanations.
The AI is the convergence layer: preserve component-level nuance, inspect interactions, form hypotheses, execute canonical opportunities, manage positions, and write durable reflections when new evidence changes how the architecture should be understood.`;
const STARTING_BALANCE = 1000;
const CATASTROPHIC_EQUITY_FLOOR = STARTING_BALANCE * 0.60;
const BASE_TICK_MS = 4000;
const SESSION_END_H = 16, SESSION_END_M = 15;
const TRADE_CUTOFF_H = 15, TRADE_CUTOFF_M = 45;
const OPEN_H = 9, OPEN_M = 30;
const TRADER_API = "/api/trader";
const STORAGE_KEY = "gcdt_shared"; // legacy compatibility key; do not rename without migration
const LEGACY_STORAGE_KEYS = ["gcdt_v14","gcdt_v13"];
const SIGNAL_EXIT_MIN_HOLD_TICKS=12;
const LEAD_LAG_SUSTAIN_TICKS=3;
const AI_REQUEST_TIMEOUT_MS=60000,AI_MAX_ENTRY_AGE_TICKS=10,AI_MAX_WAIT_AGE_TICKS=12;
const CHOP_PIN_ON=0.35,CHOP_PIN_OFF=0.25;
const ACCEL_SCALE_MAX=12,ACCEL_EXTREME_HIGH=8.8,ACCEL_EXTREME_LOW=2,ACCEL_BUILD_MIN=4.2,ACCEL_BUILD_MAX=8.7,ACCEL_RETEST_MAX=6.8;

// Synthetic seed-mode priors derived from early real-session logs. These are model inputs,
// not version markers or claims that the current architecture is unchanged from those builds.
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

const clock12=(h,m,s=0)=>{const hh=Number(h)||0,period=hh>=12?"PM":"AM",display=hh%12||12;return `${display}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")} ${period}`;};
const cleanUiText=value=>String(value??"")
  .replace(/(?:Ã.|Â.|â.|ðŸ.|�)+/g," ")
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,"")
  .replace(/\s{2,}/g," ")
  .trim();
const fmt={bal:v=>v>=1e6?`$${(v/1e6).toFixed(3)}M`:v>=1000?`$${(v/1e3).toFixed(1)}K`:`$${v.toFixed(0)}`,pct:v=>`${v>=0?"+":""}${v.toFixed(1)}%`,time:clock12,gex:v=>`${(v/1e9).toFixed(1)}B`};
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
  let i=0; while(i<mins.length-1&&mins[i+1]<=currentMin)i++;
  const a=snapshots[i],p=snapshots[Math.max(0,i-1)],age=Math.max(0,currentMin-mins[i]);
  const dt=Math.max(1,mins[i]-mins[Math.max(0,i-1)]),decay=Math.exp(-age/3);
  const spotSlope=clamp((a.spot-p.spot)/dt,-5,5),gexSlope=clamp((a.gex-p.gex)/dt,-Math.abs(a.gex)*0.1,Math.abs(a.gex)*0.1),domSlope=clamp((a.callDom-p.callDom)/dt,-0.05,0.05);
  return{spot:a.spot+spotSlope*age*decay,gex:a.gex+gexSlope*age*decay,callDom:clamp(a.callDom+domSlope*age*decay,0.01,0.99),maxGamma:a.maxGamma,synth:age>0,sourceTimestamp:a.time,sourceAgeMinutes:age,causal:true};
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

function itsProxy(callDom,gex,prevIts,fepDistance=0,fepScale=1.5){
  const dominance=clamp((callDom-0.5)/0.5,-1,1);
  const gexScale=Math.abs(gex)>1e11?3e11:3e10;
  const gexStrength=clamp(Math.abs(gex)/gexScale,0,1);
  const location=clamp(Math.tanh(fepDistance/Math.max(0.35,fepScale)),-1,1);
  const dominanceContribution=dominance*1.50;
  const locationContribution=location*(2.60+gexStrength*0.70);
  const target=clamp(6+dominanceContribution+locationContribution,1,11.5);
  const value=clamp(prevIts*0.70+target*0.30,1,11.5);
  return{value,target,neutral:6,dominance,dominanceContribution,location,locationContribution,gexStrength,fepDistance,fepScale};
}
function itsFromGex(callDom,gex,prevIts,fepDistance=0,fepScale=1.5){
  return itsProxy(callDom,gex,prevIts,fepDistance,fepScale).value;
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
  const [qh,qm]=String(snapshot.time||"16:15").split(":").map(Number);
  const minutesLeft=Math.max(0,(SESSION_END_H*60+SESSION_END_M)-(qh*60+qm));
  const calls=(snapshot.chain||[]).filter(q=>q.side==="CALL").map(q=>({strike:q.strike,side:"CALL",price:q.ask||q.mid,mark:q.mid,bid:q.bid,ask:q.ask,delta:q.delta??0.10,distance:Math.abs(q.strike-snapshot.spySpot),contract:q.contract,openInterest:q.openInterest||0,volume:q.volume||0,quoteSource:q.quoteSource}));
  const puts=(snapshot.chain||[]).filter(q=>q.side==="PUT").map(q=>({strike:q.strike,side:"PUT",price:q.ask||q.mid,mark:q.mid,bid:q.bid,ask:q.ask,delta:q.delta??-0.10,distance:Math.abs(q.strike-snapshot.spySpot),contract:q.contract,openInterest:q.openInterest||0,volume:q.volume||0,quoteSource:q.quoteSource}));
  const strikes=[...new Set([...calls,...puts].map(q=>q.strike))].sort((a,b)=>a-b);
  const rows=strikes.map(strike=>({strike,distance:Math.abs(strike-snapshot.spySpot),call:calls.find(q=>q.strike===strike),put:puts.find(q=>q.strike===strike)}));
  return{spot:snapshot.spySpot,iv:(snapshot.iv||0.20)*100,mL:minutesLeft,rows,calls,puts,surface:{callState:"OBSERVED",putState:"OBSERVED"},quoteSource:snapshot.quoteSource||"NONE"};
}
function createNativeReplayEngine(replayData,startTick=1){
  const snapshots=replayData.snapshots;const safeStart=Math.max(1,Math.min(snapshots.length-1,Number(startTick)||1));let idx=safeStart-2,last=snapshots[Math.max(0,safeStart-2)]||null,lastItsSPX=5.5,lastItsSPY=4.5;
  function mapSnap(x){
    const[h,m,s=0]=x.time.split(":").map(Number),prev=last||x,move=x.spySpot-prev.spySpot;
    const fep=x.gammaFlip;
    const accelerator=clamp(2.5+Math.abs(move)*18,0,ACCEL_SCALE_MAX);
    const ratio=x.spxSpot/Math.max(1,x.spySpot),spxFep=fep*ratio;
    const spyScale=Math.max(0.75,Math.abs(x.callWall-x.putWall)/2);
    const spxScale=Math.max(7.5,spyScale*ratio);
    const spxProxy=itsProxy(x.callDomSpx,x.netGexSpx,lastItsSPX,x.spxSpot-spxFep,spxScale);
    const spyProxy=itsProxy(x.callDom,x.netGex,lastItsSPY,x.spySpot-fep,spyScale);
    const itsSPX=spxProxy.value,itsSPY=spyProxy.value;
    lastItsSPX=itsSPX;lastItsSPY=itsSPY;
    const out={spySpot:x.spySpot,spxSpot:x.spxSpot,spxFep,gammaFlip:x.gammaFlip,callWall:x.callWall,putWall:x.putWall,fep,itsComponentsSPX:spxProxy,itsComponentsSPY:spyProxy,accelerator,rawAccelerator:accelerator,netGex:x.netGex,netGexSpx:x.netGexSpx,itsSPX,itsSPY,callDom:x.callDom,callDomSpyEst:x.callDom,callDomSpx:x.callDomSpx,ndf:move,dealerPct:clamp(x.callDom*100,5,95),iv:(x.iv||0.20)*100,pcr:clamp((1-x.callDom)+0.5,0.4,2.8),gexInfluence:clamp(Math.abs(x.netGex)/(Math.abs(x.netGex)+1e10),0.05,0.95),tick:idx+1,h,m,s,isPremarket:false,isTradeable:h<TRADE_CUTOFF_H||(h===TRADE_CUTOFF_H&&m<TRADE_CUTOFF_M),synthData:!String(x.quoteSource||"").startsWith("REAL"),quoteSource:x.quoteSource,orderFlow:x.orderFlow||null,optionChain:nativeChain(x),dataBasis:"native-replay",sourceIntervalSeconds:replayData.sourceIntervalSeconds||300,playbackIntervalSeconds:replayData.playbackIntervalSeconds||20,nativeSourceCadence:!!replayData.nativeSourceCadence,wallSource:x.wallSource||"UNKNOWN",wallConfidence:x.wallConfidence||"UNKNOWN"};
    last=x;return out;
  }
  function tick(){idx=Math.min(idx+1,snapshots.length-1);return mapSnap(snapshots[idx]);}
  return{tick,getSession:()=>({dayType:replayData.dayType,label:replayData.label,sourceIntervalSeconds:replayData.sourceIntervalSeconds,playbackIntervalSeconds:replayData.playbackIntervalSeconds,nativeSourceCadence:replayData.nativeSourceCadence}),peek:()=>idx<0?mapSnap(snapshots[0]):mapSnap(snapshots[idx]),mode:"replay"};
}
function createReplayEngine(replayData,startTick=1){
  if(replayData?.snapshots?.[0]?.spySpot!=null)return createNativeReplayEngine(replayData,startTick);
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
  const l8=hist.slice(-8),l20=hist.slice(-20),session=hist.length?hist:[mkt];
  const sessionHigh=Math.max(...session.map(c=>c.spySpot)),sessionLow=Math.min(...session.map(c=>c.spySpot));
  const localHigh=l20.length?Math.max(...l20.map(c=>c.spySpot)):mkt.spySpot,localLow=l20.length?Math.min(...l20.map(c=>c.spySpot)):mkt.spySpot;
  const nearHigh=mkt.spySpot>=sessionHigh-0.12||mkt.spySpot>=localHigh-0.08;
  const nearLow=mkt.spySpot<=sessionLow+0.12||mkt.spySpot<=localLow+0.08;
  const frontier=nearHigh||nearLow;
  const move8=l8.length>1?mkt.spySpot-l8[0].spySpot:0;
  const alignedFrontier=(nearHigh&&move8>0.35)||(nearLow&&move8<-0.35);
  if(Math.abs(div)>0.4)D+=12;if(Math.abs(div)>0.9)D+=10;if(ac>6)D+=17;if(ac>9)D+=11;if(Math.abs(mkt.ndf)>0.12)D+=13;if(mkt.dealerPct<28)D+=11;if(gi<0.3)D+=9;
  if(frontier)D+=16;if(alignedFrontier)D+=22;if(Math.abs(fg)>0.75&&Math.sign(fg)===Math.sign(move8))D+=12;
  if(l8.length>=5){const r=Math.max(...l8.map(c=>c.spySpot))-Math.min(...l8.map(c=>c.spySpot));if(r<1.0)H+=28;if(r<0.5)H+=18;if(frontier&&Math.abs(move8)>0.35)H-=18;}
  if(ac<3.5)H+=17;if(mkt.dealerPct>55)H+=15;if(Math.abs(fg)<0.35)H+=11;if(gi>0.7)H+=11;
  if(alignedFrontier&&Math.abs(fg)>0.6)H-=14;
  if(hist.length>=3){const rs=hist.slice(-3).map(c=>c.spySpot),mv=Math.max(...rs.map((v,i)=>i>0?Math.abs(v-rs[i-1]):0));if(mv>1.2)M+=34;if(mv>2.0)M+=24;if(mv>3.0)M+=18;}
  if(Math.abs(div)>1.8&&ac>8)M+=17;
  D=Math.max(0,D);H=Math.max(0,H);M=Math.max(0,M);
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
  const gexVelocity=classifyGexVelocity(hist,mkt),gexImpulse=computeGexImpulse(hist,mkt),callDomSignal=classifyCallDom(hist,mkt);
  const l6=hist.slice(-6),l12=hist.slice(-12),l60=hist.slice(-60),l180=hist.slice(-180);
  const priceSlope=l6.length>=2?l6[l6.length-1].spySpot-l6[0].spySpot:0;
  const move60=l60.length>=2?l60.at(-1).spySpot-l60[0].spySpot:0;
  const move180=l180.length>=2?l180.at(-1).spySpot-l180[0].spySpot:0;
  const sessionMove=hist.length>=2?mkt.spySpot-hist[0].spySpot:0;
  const fepMove60=l60.length>=2?mkt.fep-l60[0].fep:0;
  const putWallMove60=l60.length>=2?mkt.putWall-l60[0].putWall:0;
  const callWallMove60=l60.length>=2?mkt.callWall-l60[0].callWall:0;
  const gexMove60=l60.length>=2?mkt.netGexSpx-l60[0].netGexSpx:0;
  const belowFepCount=l6.filter(c=>c.spySpot<c.fep).length;
  const aboveFepCount=l6.filter(c=>c.spySpot>c.fep).length;
  const accelSlope=l6.length>=2?l6[l6.length-1].accel-l6[0].accel:0;
  const range12=l12.length>=4?Math.max(...l12.map(c=>c.spySpot))-Math.min(...l12.map(c=>c.spySpot)):0;
  let call=33,put=33,wait=34;
  const callReasons=[],putReasons=[],waitReasons=[],callNeeds=[],putNeeds=[],callInvalid=[],putInvalid=[];

  // SPX GEX is reactive state information, not a standalone directional oracle.
  // Reward it only when price confirms or when it exposes a measurable SPX-reprice/SPY-lag opportunity.
  const gexDir=gexVelocity.direction, priceDir=priceSlope>0.12?1:priceSlope<-0.12?-1:0;
  const gexPriceConfirmed=gexDir!==0&&priceDir===gexDir;
  const gexLag=gexImpulse?.lagOpportunity==='SPY_LAGGING_GEX_REPRICE';
  if(gexPriceConfirmed){
    const directionalWeight=Math.min(10,Math.max(4,Math.round(gexVelocity.score*.45)));
    if(gexDir>0){call+=directionalWeight;put-=3;pushReason(callReasons,`price-confirmed reactive GEX repricing ${gexVelocity.state}`,directionalWeight);}
    else{put+=directionalWeight;call-=3;pushReason(putReasons,`price-confirmed reactive GEX repricing ${gexVelocity.state}`,directionalWeight);}
  }else if(gexLag){
    const lagWeight=8;
    if(gexDir>0)pushReason(callReasons,'SPX GEX repriced up while SPY spot lagged: catch-up watch',lagWeight);
    else if(gexDir<0)pushReason(putReasons,'SPX GEX repriced down while SPY spot lagged: catch-down watch',lagWeight);
    if(gexDir>0)call+=lagWeight; else if(gexDir<0)put+=lagWeight;
    wait+=2;pushReason(waitReasons,'GEX/spot lag needs local trigger, not blind direction',2);
  }else{
    wait+=3;pushReason(waitReasons,`GEX is reactive/unconfirmed (${gexImpulse?.reactivity||'UNKNOWN'})`,3);
  }
  if(gexVelocity.terminalSpike){wait+=3;pushReason(waitReasons,'large GEX jump = high sensitivity; magnitude alone is not a veto',3);}
  if(callDomSignal.direction>0){call+=callDomSignal.score;pushReason(callReasons,`Call-dom ${callDomSignal.state}`,callDomSignal.score);}
  else if(callDomSignal.direction<0){put+=callDomSignal.score;pushReason(putReasons,`Call-dom ${callDomSignal.state}`,callDomSignal.score);}
  if(callDomSignal.deadZone){wait+=16;call-=8;put-=8;pushReason(waitReasons,"Call-dom dead zone",16);}
  const itsSlope=l6.length>=2?(((l6.at(-1).itsSPX-l6[0].itsSPX)+(l6.at(-1).itsSPY-l6[0].itsSPY))/2):0;
  const itsConfirmed=gexPriceConfirmed&&Math.abs(itsSlope)>=0.08&&Math.sign(itsSlope)===gexDir;
  if(itsConfirmed&&itsSlope>0){call+=8;put-=3;wait-=3;pushReason(callReasons,"ITS and price confirm upside structural repricing",8);}
  else if(itsConfirmed&&itsSlope<0){put+=8;call-=3;wait-=3;pushReason(putReasons,"ITS and price confirm downside structural repricing",8);}
  else if(Math.abs(div)>0.5){wait+=2;pushReason(waitReasons,"ITS gap is lead-lag tension, not direction",2);}
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
  // Broader path matters for a 0DTE reversal. Do not let a brief bounce erase a sustained move.
  if(move60<=-1.2){put+=10;call-=6;pushReason(putReasons,`20-minute downside path ${move60.toFixed(2)}`,10);}
  if(move60>=1.2){call+=10;put-=6;pushReason(callReasons,`20-minute upside path +${move60.toFixed(2)}`,10);}
  if(move180<=-2.0){put+=14;call-=8;wait-=4;pushReason(putReasons,`60-minute downside path ${move180.toFixed(2)}`,14);}
  if(move180>=2.0){call+=14;put-=8;wait-=4;pushReason(callReasons,`60-minute upside path +${move180.toFixed(2)}`,14);}
  if(sessionMove<=-2.5){put+=12;call-=8;pushReason(putReasons,`session decline ${sessionMove.toFixed(2)}`,12);}
  if(sessionMove>=2.5){call+=12;put-=8;pushReason(callReasons,`session rise +${sessionMove.toFixed(2)}`,12);}
  const downMigration=(fepMove60<=-0.30?1:0)+(putWallMove60<=-0.30?1:0)+(gexMove60<=-250000000?1:0);
  const upMigration=(fepMove60>=0.30?1:0)+(callWallMove60>=0.30?1:0)+(gexMove60>=250000000?1:0);
  if(downMigration>=2){put+=18;call-=14;wait-=4;pushReason(putReasons,`structure migrated down: FEP ${fepMove60.toFixed(2)}, put wall ${putWallMove60.toFixed(2)}, SPX GEX ${(gexMove60/1e9).toFixed(2)}B`,18);}
  if(upMigration>=2){call+=18;put-=14;wait-=4;pushReason(callReasons,`structure migrated up: FEP +${fepMove60.toFixed(2)}, call wall +${callWallMove60.toFixed(2)}, SPX GEX +${(gexMove60/1e9).toFixed(2)}B`,18);}

  if(call<65){if(!(itsSlope>0.08))callNeeds.push("upward ITS slope confirmation");if(!(priceSlope>0))callNeeds.push("upward price acceptance");if(!(ac>6)&&!(aboveFepCount>=4&&priceSlope>0.6))callNeeds.push("accelerator expansion OR persistent upside acceptance");}
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
  return{scores,momentum:mom,winner,entryBias,state,edgeScore,scalpEdge,scalpDir,gexVelocity,gexImpulse,callDomSignal,primaryCategory,call:{reasons:callReasons.slice(0,6),needs:callNeeds.slice(0,4),invalidations:callInvalid.slice(0,3)},put:{reasons:putReasons.slice(0,6),needs:putNeeds.slice(0,4),invalidations:putInvalid.slice(0,3)},wait:{reasons:waitReasons.slice(0,6)}};
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
  const normal=list.filter(o=>(isCall?o.strike>=chain.spot+0.5:o.strike<=chain.spot-0.5)&&o.price>=0.12&&o.price<=0.30&&o.distance<=5.5);
  if(normal.length||chain.quoteSource!=="SYNTHETIC_CALIBRATED")return normal;
  return list.filter(o=>(isCall?o.strike>=chain.spot-0.25:o.strike<=chain.spot+0.25)&&o.price>=0.12&&o.price<=1.50&&o.distance<=1.0).map(o=>({...o,syntheticAtmFallback:true}));
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
  let tier=affordable.some(o=>o.syntheticAtmFallback)?"SYNTH_ATM_FALLBACK":"QUALITY";
  let candidates=affordable.filter(o=>o.distance<=cfg.maxDist&&Math.abs(o.delta)>=cfg.minDelta);
  if(!candidates.length){
    if(tier!=="SYNTH_ATM_FALLBACK")tier="ADAPTIVE";
    candidates=affordable.filter(o=>o.distance<=5.5&&Math.abs(o.delta)>=0.035);
  }
  if(!candidates.length){
    const displayed=isCall?chain.calls:chain.puts;
    candidates=displayed.filter(o=>Number.isFinite(o.price)&&o.price>=0.05&&o.price<=0.50&&o.distance<=6.5&&(isCall?o.strike>=chain.spot-0.25:o.strike<=chain.spot+0.25));
    if(candidates.length)tier="AVAILABLE";
  }
  candidates=candidates.map(o=>({...o,score:contractRank(o,cfg.idealPrice,cfg.targetDelta)+(tier==="ADAPTIVE"?0.10:tier==="AVAILABLE"?0.18:0)})).sort((a,b)=>a.score-b.score);
  const x=candidates[0];
  return x?{strike:x.strike,price:x.price,delta:x.delta,distance:x.distance,side:isCall?"CALL":"PUT",tier,contract:x.contract||null,openInterest:x.openInterest||0,volume:x.volume||0,quoteSource:x.quoteSource||chain.quoteSource||"MODELED"}:null;
}

function findStrike(spot,iv,mL,isCall,mode="swing",ctx=null){
  return selectContract(buildOptionChain(spot,iv,mL,40,ctx),isCall,mode);
}

function wallOiContext(m,chain,side){
  const isCall=side==="CALL",wall=isCall?m.callWall:m.putWall,rows=isCall?chain.calls:chain.puts;
  const wallRow=rows.reduce((best,x)=>!best||Math.abs(x.strike-wall)<Math.abs(best.strike-wall)?x:best,null);
  const directional=rows.filter(x=>isCall?x.strike>=m.spySpot:x.strike<=m.spySpot);
  const totalOi=directional.reduce((a,x)=>a+(x.openInterest||0),0),totalVol=directional.reduce((a,x)=>a+(x.volume||0),0);
  const beyond=directional.filter(x=>isCall?x.strike>wall:x.strike<wall);
  const beyondOi=beyond.reduce((a,x)=>a+(x.openInterest||0),0);
  return{wall,wallDistance:Math.abs(wall-m.spySpot),wallOi:wallRow?.openInterest||0,totalOi,totalVol,beyondOi,beyondOiShare:totalOi?beyondOi/totalOi:0,wallPresent:Number.isFinite(wall)&&Math.abs(wall-m.spySpot)<12};
}
function buildThesisContract(m,chain,side,confidence,dec,intent){
  const dir=side==="CALL"?1:-1,wall=wallOiContext(m,chain,side),opp=wallOiContext(m,chain,side==="CALL"?"PUT":"CALL");
  const fepGap=dir*(m.spySpot-m.fep),expectedTicks=clamp(Number(dec.reevaluate_after_ticks)||Math.round(7-(confidence-50)/18),3,9);
  return{side,confidence,expectedTicks,entryTick:m.tick,entrySpot:m.spySpot,entryFep:m.fep,entryFepGap:fepGap,entryCallWall:m.callWall,entryPutWall:m.putWall,entrySpgex:m.netGexSpx,entrySpyGex:m.netGex,entryItsSPX:m.itsSPX,entryItsSPY:m.itsSPY,entryWall:wall,entryOppWall:opp,requiredSupports:["price/FEP relationship","SPX lead or confirmation","wall/OI path remains viable","structural/local thesis not jointly reversed"],hardInvalidations:["spot invalidation","opposite structural and local control with adverse acceptance","directional wall removed or moved against thesis while price rejects","support wall strengthens against breakdown/expansion"],expectedPath:dec.expected_next_path||intent?.expectedPath||"directional response should emerge within the expected window without losing causal supports"};
}
function evaluateThesisContract(pos,m,chain,brain,thesis,ctx){
  const c=pos.thesisContract||{},side=pos.isCall?"CALL":"PUT",dir=pos.isCall?1:-1,held=(m.tick??0)-(pos.entryTick??m.tick??0);
  const progress=dir*(m.spySpot-pos.entrySpot),fepHealth=dir*(m.spySpot-m.fep),wall=wallOiContext(m,chain,side),opp=wallOiContext(m,chain,side==="CALL"?"PUT":"CALL");
  const local=ctx?.local,struct=ctx?.structural;
  const structuralOpp=struct?.direction&&struct.direction!=="NONE"&&struct.direction!==side&&struct.confidence>=58;
  const localOpp=local?.direction&&local.direction!=="NONE"&&local.direction!==side&&local.confidence>=65;
  const brainOpp=brain?.active&&brain.active!=="WAIT"&&brain.active!==side&&brain.confidence>=55;
  const fepLost=fepHealth<-0.18;
  const adverseAcceptance=progress<-0.28&&fepLost;
  const wallMovedAgainst=pos.isCall?(m.callWall<(c.entryCallWall??m.callWall)-0.5):(m.putWall>(c.entryPutWall??m.putWall)+0.5);
  const opposingSupportStrengthened=pos.isCall?(m.putWall>(c.entryPutWall??m.putWall)+0.5):(m.callWall<(c.entryCallWall??m.callWall)-0.5);
  const noRoom=wall.wallPresent&&wall.wallDistance<0.35&&wall.beyondOiShare<0.08;
  const expectedLate=held>=(c.expectedTicks||5)&&progress<0.12;
  const resolvedForecast=pos.lastResolvedForecast;
  const forecastFailed=!!resolvedForecast&&resolvedForecast.side===side&&String(resolvedForecast.status||'').startsWith('FAILED')&&(resolvedForecast.createdTick??-1)>=(pos.entryTick??-1);
  const failedForecastAged=forecastFailed&&held>=(c.expectedTicks||5)+3&&progress<0.12;
  const invalidations=[
    {key:"ADVERSE_ACCEPTANCE",active:adverseAcceptance,weight:3},
    {key:"STRUCT_LOCAL_REVERSAL",active:structuralOpp&&localOpp,weight:3},
    {key:"BRAIN_PLUS_FEP_FAILURE",active:brainOpp&&fepLost,weight:2},
    {key:"WALL_MOVED_AGAINST",active:wallMovedAgainst,weight:2},
    {key:"OPPOSING_SUPPORT_STRENGTHENED",active:opposingSupportStrengthened,weight:2},
    {key:"NO_REMAINING_OI_ROOM",active:noRoom&&progress>0,weight:1},
    {key:"FORECAST_FAILED",active:forecastFailed,weight:2},
    {key:"EXPECTED_RESPONSE_LATE",active:expectedLate,weight:1},
  ].filter(x=>x.active);
  const score=invalidations.reduce((a,x)=>a+x.weight,0);
  const support=[fepHealth>=-0.05,progress>=0,!(structuralOpp&&localOpp),!wallMovedAgainst,!opposingSupportStrengthened].filter(Boolean).length;
  const hard=invalidations.some(x=>x.weight>=3)||(score>=5&&support<=2);
  const softExit=(score>=4&&expectedLate&&support<=2)||(failedForecastAged&&support<=4);
  const extend=expectedLate&&!forecastFailed&&score<=2&&support>=3;
  return{held,progress,fepHealth,wall,opp,invalidations,score,support,hard,softExit,extend,expectedLate,forecastFailed,failedForecastAged};
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
function classifyPostStopThesis(pos,m,pnl,reason){
  const side=pos.isCall?"CALL":"PUT",dir=pos.isCall?1:-1;
  const progress=dir*(m.spySpot-pos.entrySpot);
  const coreHealth=pos.isCall?m.spySpot>=Math.min(m.fep,m.gammaFlip)-0.08:m.spySpot<=Math.max(m.fep,m.gammaFlip)+0.08;
  const explicitInvalidation=/SPOT_INVALIDATION|THESIS_INVALIDATED|CONFIRMED_OPPOSITE_CONTROL/.test(reason);
  if(explicitInvalidation||progress<-0.18&&!coreHealth)return{state:"THESIS_INVALIDATED",progress,coreHealth,standard:"NEW_THESIS_EVIDENCE"};
  if(pnl<0&&/MAX_LOSS_LIMIT|VEHICLE_FAILURE/.test(reason)&&progress>=0.08&&coreHealth)return{state:"THESIS_SURVIVED_VEHICLE_STOP",progress,coreHealth,standard:"RENEWED_EXECUTION_EVIDENCE"};
  if(pnl<0)return{state:"THESIS_UNRESOLVED",progress,coreHealth,standard:"RENEWED_EXECUTION_EVIDENCE"};
  return{state:"THESIS_CONFIRMED",progress,coreHealth,standard:"NORMAL"};
}
function recordTradeOutcome(memory,pos,m,pnl,reason,tick){
  const side=pos.isCall?"CALL":"PUT",won=pnl>0,episodeKey=pos.episodeKey||`${side}|UNKNOWN`;
  const postStop=classifyPostStopThesis(pos,m,pnl,reason);
  const item={
    id:pos.id,side,strike:pos.strike,entrySpot:pos.entrySpot,exitSpot:m.spySpot,
    entryPrice:pos.entry,exitPrice:pos.current,pnl,reason,tick,
    entryTick:pos.entryTick,holdTicks:tick-(pos.entryTick??tick),
    entryThesis:pos.entryThesis||"",primaryCategory:pos.primaryCategory||"UNKNOWN",expectedPath:pos.expectedPath||"",
    maxFavorableSpot:pos.maxFavorableSpot,maxAdverseSpot:pos.maxAdverseSpot,
    attribution:pos.lastAttribution||null,episodeKey,
    exitFep:m.fep,exitFlip:m.gammaFlip,exitCallWall:m.callWall,exitPutWall:m.putWall,exitNetGex:m.netGexSpx??m.netGex,
    progress:postStop.progress,postStopState:postStop.state,reentryStandard:postStop.standard,coreHealthAtExit:postStop.coreHealth
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
    lastExitTick:tick,lastExitSpot:m.spySpot,lastResult:won?"WIN":"LOSS",lastReason:reason,lastPostStopState:postStop.state,reentryStandard:postStop.standard
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
Last exit: ${last?`${last.side} at SPY ${last.exitSpot.toFixed(2)} because ${last.reason}; classification ${last.postStopState||"UNKNOWN"}; next standard ${last.reentryStandard||"NEW_THESIS_EVIDENCE"}`:"none"}.
A vehicle stop can preserve the old thesis. THESIS_SURVIVED_VEHICLE_STOP and THESIS_UNRESOLVED require renewed execution evidence, not an entirely new structural thesis. THESIS_INVALIDATED requires genuinely new thesis evidence. A winner does not automatically reset the episode.`;
}
function evaluateReentry(memory,side,m,hist,episodeKey){
  const recent=(memory?.attempts||[]).filter(x=>x.side===side).slice(-6);
  const episode=memory?.episodes?.[episodeKey];
  if(!episode)return{allowed:true,newEvidence:["first attempt in this distinct side/location/regime episode"],episodeKey};
  const last=recent.at(-1),dir=side==="CALL"?1:-1;
  const ticksSince=last?.tick!=null&&m.tick!=null?m.tick-last.tick:999;
  const sinceExit=last?dir*(m.spySpot-last.exitSpot):0;
  const h=hist.slice(-10),priorWindow=hist.slice(-31,-1);
  const move4=h.length>=5?dir*(m.spySpot-h.at(-5).spySpot):0;
  const move8=h.length>=9?dir*(m.spySpot-h.at(-9).spySpot):0;
  const newExtreme=last?(side==="CALL"?m.spySpot>Math.max(last.entrySpot,last.exitSpot)+(last.pnl>0?0.55:0.35):m.spySpot<Math.min(last.entrySpot,last.exitSpot)-(last.pnl>0?0.55:0.35)):true;
  const priorLocalExtreme=priorWindow.length?(side==="CALL"?Math.max(...priorWindow.map(x=>x.spySpot)):Math.min(...priorWindow.map(x=>x.spySpot))):null;
  const oneTickMoves=priorWindow.slice(1).map((x,i)=>Math.abs(x.spySpot-priorWindow[i].spySpot)).sort((a,b)=>a-b);
  const medianTickMove=oneTickMoves.length?oneTickMoves[Math.floor(oneTickMoves.length/2)]:0.05;
  const frontierThreshold=clamp(medianTickMove*1.5,0.08,0.30);
  const attemptThreshold=clamp(medianTickMove*2.0,0.12,0.40);
  const freshFrontier=priorLocalExtreme!=null&&(side==="CALL"?m.spySpot>=priorLocalExtreme+frontierThreshold:m.spySpot<=priorLocalExtreme-frontierThreshold);
  const priorAttemptExtreme=last?(side==="CALL"?Math.max(last.entrySpot,last.exitSpot,last.maxFavorableSpot??-Infinity):Math.min(last.entrySpot,last.exitSpot,last.maxFavorableSpot??Infinity)):null;
  const clearedPriorAttempt=priorAttemptExtreme!=null&&(side==="CALL"?m.spySpot>=priorAttemptExtreme+attemptThreshold:m.spySpot<=priorAttemptExtreme-attemptThreshold);
  const freshLeg=move4>=0.65&&move8>=0.75;
  const accelReset=(m.accelerator||0)>=6.2;
  const resetDistance=Math.abs(sinceExit)>=0.55;
  const episodeEntries=episode?.entries||0;
  const evidence=[];
  if(newExtreme)evidence.push("new extreme beyond prior episode");
  if(freshFrontier)evidence.push("fresh local/session frontier");
  if(clearedPriorAttempt)evidence.push("cleared prior attempt extreme");
  if(freshLeg)evidence.push("fresh multi-tick leg");
  if(accelReset&&resetDistance)evidence.push("accelerator and price reset");
  const postStopState=last?.postStopState||episode?.lastPostStopState||"THESIS_INVALIDATED";
  const coreHealthy=side==="CALL"?m.spySpot>=Math.min(m.fep,m.gammaFlip)-0.08:m.spySpot<=Math.max(m.fep,m.gammaFlip)+0.08;
  const renewedExecution=[];
  if(ticksSince>=2&&sinceExit>=0.12)renewedExecution.push("old thesis progressing beyond stopped exit");
  if(ticksSince>=2&&move4>=0.25&&coreHealthy)renewedExecution.push("renewed directional execution leg with core location intact");
  if(ticksSince>=2&&accelReset&&coreHealthy&&sinceExit>=-0.04)renewedExecution.push("acceleration rebuilt while old thesis remained structurally valid");
  const matureEpisode=episodeEntries>=2;
  const preserved=postStopState==="THESIS_SURVIVED_VEHICLE_STOP"||postStopState==="THESIS_UNRESOLVED";
  const priorLoss=!!last&&last.pnl<0;
  const structuralReset=!!last&&((freshFrontier&&clearedPriorAttempt)||(Math.abs(m.spySpot-last.exitSpot)>=0.85&&Math.abs(m.fep-(last.exitFep??m.fep))>=0.25)||(side==="CALL"?m.spySpot>Math.max(last.entrySpot,last.exitSpot)+0.65:m.spySpot<Math.min(last.entrySpot,last.exitSpot)-0.65));
  if(structuralReset)evidence.push("material structural reset after failed leg");
  const baseAllowed=preserved?renewedExecution.length>0:evidence.length>0&&(!matureEpisode||evidence.length>=2);
  const allowed=baseAllowed&&(!priorLoss||structuralReset||renewedExecution.length>=2);
  return{allowed,newEvidence:preserved?renewedExecution:evidence,renewedExecutionEvidence:renewedExecution,requiredStandard:preserved?"RENEWED_EXECUTION_EVIDENCE":"NEW_THESIS_EVIDENCE",postStopState,ticksSince,cooldownNeeded:preserved?2:0,episodeEntries,matureEpisode,episodeKey,freshFrontier,clearedPriorAttempt,frontierThreshold,attemptThreshold,priorLoss,structuralReset};
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
    "CANONICAL_CONFIDENCE_BELOW_MINIMUM",
    "No valid contract",
    "Chase risk after completed impulse",
    "No genuinely new evidence since failed CALL",
    "No genuinely new evidence since failed PUT",
    "Episode reset incomplete after repeated CALL attempts",
    "Episode reset incomplete after repeated PUT attempts"
  ]);
  return(intent?.blockers||[]).filter(x=>hard.has(x)||/^CANONICAL_CONFIDENCE_BELOW_MINIMUM/.test(x)||/^No genuinely new evidence/.test(x)||/^Episode reset incomplete/.test(x));
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
      return{valid:false,reason:`position changed (${ctx.positionId||"NONE"}  ->  ${currentPositionId||"NONE"})`};
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
    return{valid:false,reason:`thesis episode changed (${ctx.episodeKey}  ->  ${currentEpisode})`};
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
  const hardBlockers=hardExecutionBlockers(currentIntent);
  if(!sameBuy){
    return{valid:false,reason:`current action ${action} is not exact canonical BUY authorization for ${responseDirection}`};
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
  if(code==="DIRECTION_FLIPPED")return{valid:!!requestCtx?.direction&&intent?.direction!==requestCtx.direction,code,reason:`direction ${requestCtx?.direction} -> ${intent?.direction}`};
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
      onLog(`AI_VETO_AUDIT ${a.side} ${a.strike}${a.side==="CALL"?"C":"P"} veto:${a.vetoCode} entry $${a.startPrice.toFixed(2)} now $${px.toFixed(2)} (${ret>=0?"+":""}${ret.toFixed(1)}%) max $${next.maxPrice.toFixed(2)} (${maxRet>=0?"+":""}${maxRet.toFixed(1)}%) after ${n} ticks | SPY ${a.startSpot.toFixed(2)} -> ${m.spySpot.toFixed(2)}.`);
    };
    if(age>=3&&!next.logged3){report(3);next.logged3=true;}
    if(age>=8&&!next.logged8){report(8);next.logged8=true;}
    return next;
  }).filter(a=>tick-a.startTick<=12);
}
function createAiSessionMemory(label="UNSET"){
  const priorArch=storageGet("ai_architecture_memory",{}),upgradePending=priorArch.buildId!==BUILD_ID;
  return{sessionLabel:label,updatedAt:null,summary:"Session not yet assessed.",dominantThesis:"UNSET",competingThesis:"UNSET",expectedPath:"UNSET",invalidation:"UNSET",unresolved:"UNSET",lastDecision:"NONE",lastSpot:null,lastTime:null,entries:[],architecture:{buildId:BUILD_ID,upgradePending,priorBuild:priorArch.buildId||"UNKNOWN",reflection:priorArch.reflection||"UNSET"}};
}
function aiMemoryText(mem,{recentEntries=0,includeAllEntries=false}={}){
  const m=mem||createAiSessionMemory();
  const allEntries=m.entries||[];
  const selected=includeAllEntries?allEntries:(recentEntries>0?allEntries.slice(-recentEntries):[]);
  const ledger=selected.length?`\n\nTHOUGHT LEDGER (${selected.length}${includeAllEntries?` OF ${allEntries.length}`:` MOST RECENT OF ${allEntries.length}`}):\n${selected.map((entry,i)=>`--- NOTE ${includeAllEntries?i+1:allEntries.length-selected.length+i+1} ---\n${entry}`).join("\n\n")}`:`\nThought ledger entries stored: ${allEntries.length}.`;
  return `FIRSTSIGNAL SIM v1 STRUCTURED CONTINUITY STATE
Session: ${m.sessionLabel}
Continuity summary: ${m.summary}
Dominant thesis: ${m.dominantThesis}
Competing thesis: ${m.competingThesis}
Expected path: ${m.expectedPath}
Invalidation: ${m.invalidation}
Unresolved question: ${m.unresolved}
Last decision: ${m.lastDecision} at ${m.lastTime||"UNSET"}
Architecture: ${m.architecture?.upgradePending?`UPGRADE PENDING from ${m.architecture?.priorBuild||"UNKNOWN"} to ${m.architecture?.buildId}`:`Build ${m.architecture?.buildId||BUILD_ID} understood`}
Architecture reflection: ${m.architecture?.reflection||"UNSET"}${ledger}`;
}
function authoritativeStateText(mkt,pos,bal,tradeMemory){
  const p=pos?`${pos.isCall?"CALL":"PUT"} ${pos.strike}${pos.isCall?"C":"P"} entry $${Number(pos.entry).toFixed(2)} current $${Number(pos.current??pos.entry).toFixed(2)} entrySpot ${Number(pos.entrySpot).toFixed(2)}`:"FLAT";
  const last=tradeMemory?.lastExit?JSON.stringify(tradeMemory.lastExit):tradeMemory?.lastEntry?JSON.stringify(tradeMemory.lastEntry):"NONE";
  return `AUTHORITATIVE CURRENT STATE — OVERRIDES ALL MEMORY AND PRIOR PROSE
Tick: ${mkt?.tick??"UNKNOWN"} | Market time: ${mkt?`${mkt.h}:${String(mkt.m).padStart(2,"0")}:${String(mkt.s||0).padStart(2,"0")} ET`:"UNKNOWN"}
Position: ${p}
Balance: $${Number(bal||0).toFixed(2)}
Last canonical trade event: ${last}
If Position is FLAT, every earlier HOLD, MANAGE, SELL, target, stop, or active-trade statement is historical and invalid for current action.`;
}
function lastFlowHypothesis(dec,fallback){return dec.flow_hypothesis?`Flow hypothesis: ${dec.flow_hypothesis}`:fallback;}
function sanitizeCognitionText(value){
  let t=String(value||"").replace(/(flat|matcher|matched|mandatory|definition)(?:[ .,:;]+){1,}/gi,"$1");
  t=t.replace(/(?:flat[ .,:;]*){3,}/gi,"flat. ").replace(/(?:matcher[ .,:;]*){2,}/gi,"").replace(/\s{2,}/g," ").trim();
  const sentences=t.split(/(?<=[.!?])\s+/),out=[];
  for(const x of sentences){const key=x.toLowerCase().replace(/[^a-z0-9 ]/g,"").trim();if(key&&out.some(y=>y.key===key))continue;out.push({key,text:x});}
  return out.map(x=>x.text).join(" ").slice(0,4000);
}

function updateAiSessionMemory(mem,dec,mkt,intent,time){
  const prior=mem||createAiSessionMemory();
  const move=Number.isFinite(prior.lastSpot)?mkt.spySpot-prior.lastSpot:null;
  const observed=move==null?"first assessment":`SPY moved ${move>=0?"+":""}${move.toFixed(2)} since ${prior.lastTime||"prior decision"}`;
  const thesis=dec.current_thesis||`${intent?.direction||"WAIT"} thesis`;
  const expected=dec.expected_next_path||"No explicit path supplied.";
  const invalidation=Number.isFinite(dec.invalidation_spot)?`SPY ${dec.invalidation_spot.toFixed(2)}`:(intent?.invalidation!=null?`SPY ${Number(intent.invalidation).toFixed(2)}`:"Not explicit");
  const unresolved=dec.veto_reason&&dec.veto_reason!=="NONE"?`${dec.veto_reason}: ${dec.veto_evidence||"no detail"}`:(dec.new_evidence||"No material unresolved conflict stated.");
  const thought=sanitizeCognitionText(dec.thought_append||dec.reasoning||"");
  const entry=`[${time}]\n${thought||`${dec.decision}: ${observed}`}\nDecision: ${dec.decision}${expected?` | Watching: ${expected}`:""}`;
  const reflection=(dec.architecture_reflection||prior.architecture?.reflection||"UNSET").trim();
  const architecture={...(prior.architecture||{}),buildId:BUILD_ID,upgradePending:false,reflection};
  return{...prior,architecture,updatedAt:time,dominantThesis:thesis,competingThesis:dec.veto_reason&&dec.veto_reason!=="NONE"?dec.veto_reason:"Monitor opposite acceptance",expectedPath:expected,invalidation,unresolved:lastFlowHypothesis(dec,unresolved),lastDecision:dec.decision,lastSpot:mkt.spySpot,lastTime:time,summary:`${dec.decision}: ${dec.reasoning||thesis}`,entries:[...(prior.entries||[]),entry].slice(-2000)};
}

function observationIntegrity(obs){
  const text=[obs?.thought_append,obs?.thesis_delta,obs?.current_thesis,obs?.expected_next_path].filter(Boolean).join(" ");
  if(/\bshawn\b/i.test(text))return{ok:false,reason:"BLACKLISTED_TOKEN:SHAWN"};
  return{ok:true};
}

function appendAiObservationMemory(mem,obs,mkt,time){
  const prior=mem||createAiSessionMemory();
  const thought=sanitizeCognitionText(obs?.thought_append||obs?.thesis_delta||"");
  if(!thought)return prior;
  const entry=`[${time}]
${thought}
Cognition: ${obs.urgency||"NONE"}${obs.expected_next_path?` | Watching: ${obs.expected_next_path}`:""}`;
  return{...prior,updatedAt:time,lastSpot:mkt.spySpot,lastTime:time,summary:obs.thesis_delta||thought,dominantThesis:obs.current_thesis||prior.dominantThesis,expectedPath:obs.expected_next_path||prior.expectedPath,entries:[...(prior.entries||[]),entry].slice(-2000)};
}

function normalizeTraderDecision(obj){
  const allowed=new Set(["WAIT","WAITING","BUY_CALL","BUY_PUT","SELL","HOLD"]);
  if(!obj||typeof obj!=="object")throw new Error("AI response was not an object");
  const decision=String(obj.decision||"").toUpperCase();
  if(!allowed.has(decision))throw new Error(`invalid decision: ${String(obj.decision)}`);
  return{
    decision,
    thought_append:sanitizeCognitionText(obj.thought_append),
    architecture_reflection:String(obj.architecture_reflection||"").slice(0,3000),
    flow_hypothesis:String(obj.flow_hypothesis||"").slice(0,1200),
    self_audit:String(obj.self_audit||"").slice(0,1600),
    missing_angle:String(obj.missing_angle||"").slice(0,1200),
    coherence_check:String(obj.coherence_check||"COHERENT").slice(0,40),
    reasoning:sanitizeCognitionText(obj.reasoning).slice(0,600),
    mindset:sanitizeCognitionText(obj.mindset).slice(0,240),
    journal_entry:sanitizeCognitionText(obj.journal_entry).slice(0,600),
    edge_state:String(obj.edge_state||"NO_EDGE"),
    confidence_trend:String(obj.confidence_trend||"UNCLEAR"),
    trade_confidence:Number.isFinite(Number(obj.trade_confidence))?clamp(Number(obj.trade_confidence),0,100):0,
    invalidation_spot:Number.isFinite(Number(obj.invalidation_spot))?Number(obj.invalidation_spot):null,
    target_spot:Number.isFinite(Number(obj.target_spot))?Number(obj.target_spot):null,
    max_loss_pct:Number.isFinite(Number(obj.max_loss_pct))?clamp(Number(obj.max_loss_pct),3,10):null,
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
function buildTradeIntent(m,hist,brain,thesis,det,chain,pos,conf,tradeMemory,metacognition){
  if(pos){
    const pnl=(pos.current/pos.entry-1)*100,side=pos.isCall?"CALL":"PUT";
    const invalid=pos.isCall?m.spySpot<=(pos.stopSpot??-Infinity):m.spySpot>=(pos.stopSpot??Infinity);
    const oppositeBrain=brain?.active&&brain.active!==side&&brain.confidence>=48;
    const oppositeThesis=thesis?.entryBias&&thesis.entryBias!=="WAIT"&&thesis.entryBias!==side;
    const adverseSpot=(pos.isCall?-1:1)*(m.spySpot-pos.entrySpot);
    const heldTicks=(m.tick??0)-(pos.entryTick??(m.tick??0));
    const dirProgress=(pos.isCall?1:-1)*(m.spySpot-pos.entrySpot);
    const thesisHealth=evaluateThesisContract(pos,m,chain,brain,thesis,det);
    const maxLossExit=pnl<=-(pos.maxLossPct??14);
    const vehicleFailure=pnl<=-(pos.vehicleFailurePct??38)&&dirProgress<0.15;
    const hardLoss=pnl<=-(pos.catastrophicLossPct??50);
    const action=invalid||maxLossExit||vehicleFailure||hardLoss||thesisHealth.hard||thesisHealth.softExit?"EXIT":"HOLD";
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

  const session=hist.length?[...hist,m]:[m],recent=hist.slice(-35),move3=recent.length>=4?m.spySpot-recent.at(-4).spySpot:0,move6=recent.length>=7?m.spySpot-recent.at(-7).spySpot:0,move15=recent.length>=16?m.spySpot-recent.at(-16).spySpot:move6,move30=recent.length>=31?m.spySpot-recent.at(-31).spySpot:move15;
  const fepMove6=recent.length>=7?m.fep-recent.at(-7).fep:0,fepMove15=recent.length>=16?m.fep-recent.at(-16).fep:fepMove6,fepMove30=recent.length>=31?m.fep-recent.at(-31).fep:fepMove15;
  const sessionOpen=session[0].spySpot,sessionOpenFep=session[0].fep,sessionMove=m.spySpot-sessionOpen,sessionFepMove=m.fep-sessionOpenFep;
  const sessionHigh=Math.max(...session.map(x=>x.spySpot)),sessionLow=Math.min(...session.map(x=>x.spySpot));
  const belowFepShare=session.filter(x=>x.spySpot<x.fep).length/session.length,negativeGexShare=session.filter(x=>x.netGex<0).length/session.length;
  const closeInLowerQuartile=sessionHigh>sessionLow?m.spySpot<=sessionLow+(sessionHigh-sessionLow)*0.25:false;
  const brainSide=brain?.active&&brain.active!=="WAIT"?brain.active:"WAIT";
  const localSide=det?.dir||"WAIT";
  const localDir=localSide==="CALL"?1:localSide==="PUT"?-1:0;
  const localMove=localDir?localDir*move3:0;
  const inversionHint=metacognition?.inversion||{};
  const brainEdge=Math.abs((brain?.bullPressure||0)-(brain?.bearPressure||0));
  const bearishSessionContext=session.length>=20&&sessionMove<=-0.80&&sessionFepMove<=-0.20&&belowFepShare>=0.60&&negativeGexShare>=0.60&&closeInLowerQuartile;
  const bearishExpansionContext=m.netGex<0&&m.spySpot<m.fep&&Math.min(fepMove6,fepMove15,fepMove30)<-0.20&&Math.min(move6,move15,move30)<-0.55;
  const activeBearRegime=bearishExpansionContext||bearishSessionContext;
  const provenPinContext=m.netGex>0&&m.gexInfluence>=0.45&&Math.abs(m.spySpot-m.fep)<=0.35&&Math.abs(move15)<=0.45&&recent.slice(-6).filter(x=>Math.abs(x.spySpot-x.fep)<=0.45).length>=4&&belowFepShare<0.65;
  const scoreDirectionalSide=(candidate)=>{const sign=candidate==="CALL"?1:-1;const momentum=[move3,move6,move15,move30].map(v=>sign*v);const persistenceScore=momentum.filter((v,i)=>v>[0.12,0.25,0.48,0.72][i]).length*11;const anchor=sign*(m.spySpot-(Math.abs(m.fep-m.gammaFlip)<0.18?Math.max(m.fep,m.gammaFlip):(m.fep+m.gammaFlip)/2));const brainPressure=candidate==="CALL"?(brain?.bullPressure||0):(brain?.bearPressure||0);const responseScore=candidate==="CALL"?(brain?.bullResponse||0):(brain?.bearResponse||0);const primary=[thesis?.gexVelocity?.direction===sign,thesis?.callDomSignal?.direction===sign,(Math.abs(m.spySpot-m.fep)<0.12?0:Math.sign(m.spySpot-m.fep))===sign].filter(Boolean).length;return persistenceScore+clamp(anchor*18,-18,18)+brainPressure*.22+responseScore*16+primary*8;};
  const callAuthority=scoreDirectionalSide("CALL"),putAuthority=scoreDirectionalSide("PUT"),authorityEdge=Math.abs(callAuthority-putAuthority);
  const causalAuthority=authorityEdge>=12&&Math.max(callAuthority,putAuthority)>=38?(callAuthority>putAuthority?"CALL":"PUT"):"WAIT";
  let side=causalAuthority;
  const bearLegConfirmed=activeBearRegime&&localSide==="PUT"&&localMove>=0.25;
  const bullishCounterLeg=activeBearRegime&&localSide==="CALL"&&localMove>=0.55&&(move6>0.35||m.spySpot>=m.fep-0.05);
  const localLocationConfirmed=localSide==="CALL"
    ?m.spySpot>=Math.min(m.fep,m.gammaFlip)-0.05
    :localSide==="PUT"?m.spySpot<=Math.max(m.fep,m.gammaFlip)+0.05:false;
  const localPrimaryCount=localSide==="WAIT"?0:[
    thesis?.gexVelocity?.direction===localDir,
    thesis?.callDomSignal?.direction===localDir,
    (Math.abs(m.spySpot-m.fep)<0.12?0:Math.sign(m.spySpot-m.fep))===localDir
  ].filter(Boolean).length;
  const localResponse=localSide==="CALL"?(brain?.bullResponse||0):(brain?.bearResponse||0);
  const decisiveOppositeSetup=localSide!=="WAIT"&&localSide!==brainSide&&localMove>=0.30&&localLocationConfirmed&&(localPrimaryCount>=2||localResponse>=0.42);
  if(side==="WAIT"&&bearLegConfirmed&&putAuthority>=38)side="PUT";
  if(side==="WAIT"&&inversionHint.side&&localSide===inversionHint.side&&localLocationConfirmed&&localMove>=0.20&&Number(inversionHint.transfer)>=18)side=inversionHint.side;
  else if(side==="WAIT"&&decisiveOppositeSetup&&authorityEdge>=10)side=localSide;

  const isCall=side==="CALL",mode=det?.mode==="PIN_RANGE"?"pin":det?.mode==="GEX_EXPANSION"?"expansion":"scalp";
  const contract=side!=="WAIT"?selectContract(chain,isCall,mode):null;
  const rejected=side!=="WAIT"&&!contract?bestRejectedContract(chain,isCall):null;
  const dir=side==="CALL"?1:side==="PUT"?-1:0;
  const pathMove3=dir*move3,pathMove6=dir*move6,pathMove15=dir*move15,pathMove30=dir*move30;
  const persistence=[pathMove3>0.18,pathMove6>0.35,pathMove15>0.70,pathMove30>1.10].filter(Boolean).length;
  const sustainedDirectionalMove=Math.max(pathMove3,pathMove6,pathMove15,pathMove30);
  const rawBrainConfidence=clamp(Number(brain?.confidence)||0,0,100);
  const expectationFailures=metacognition?.expectationFailures||{CALL:0,PUT:0};
  const inversion=inversionHint;
  const sameSideFailureStreak=side!=="WAIT"?(expectationFailures[side]||0):0;
  const structuralDecay=Math.min(36,sameSideFailureStreak*10);
  const inversionApplies=side!=="WAIT"&&inversion.side===side&&Number(inversion.transfer)>0;
  const brainConfidence=clamp(rawBrainConfidence-structuralDecay+(inversionApplies?Math.min(18,Number(inversion.transfer)||0):0),0,100);
  const edge=Math.abs((brain?.bullPressure||0)-(brain?.bearPressure||0));
  const locationOk=side==="CALL"?m.spySpot>=Math.min(m.fep,m.gammaFlip)-0.15:side==="PUT"?m.spySpot<=Math.max(m.fep,m.gammaFlip)+0.15:false;
  const response=side==="CALL"?(brain?.bullResponse||0):(brain?.bearResponse||0);
  const localAgreement=localSide!=="WAIT"&&localSide===side;
  const desiredDir=side==="CALL"?1:side==="PUT"?-1:0;
  const fepDir=Math.abs(m.spySpot-m.fep)<0.12?0:Math.sign(m.spySpot-m.fep);
  const primaryAlignment=[thesis?.gexVelocity?.direction===desiredDir,thesis?.callDomSignal?.direction===desiredDir,fepDir===desiredDir];
  const alignedPrimaryCount=primaryAlignment.filter(Boolean).length;
  const marketFactors=[
    {label:`Market brain ${side}`,passed:side!=="WAIT",weight:15},
    {label:"Current leg agrees",passed:localAgreement||localMove>=0.55,weight:18},
    {label:"Directional edge",passed:edge>=10||localMove>=0.55,weight:14},
    {label:"Price persistence",passed:persistence>=1,weight:18},
    {label:"Primary evidence alignment",passed:alignedPrimaryCount>=1,weight:12},
    {label:"FEP / flip location",passed:locationOk,weight:10},
    {label:"Response quality",passed:response>=0.42||localMove>=0.55,weight:8},
    {label:"Acceleration active",passed:m.accelerator>=4.2,weight:3},
    {label:"Session / active-leg compatibility",passed:!activeBearRegime||side==="PUT"||bullishCounterLeg,weight:2},
  ];
  let setupQuality=Math.round(marketFactors.reduce((a,f)=>a+(f.passed?f.weight:0),0));
  if(inversionApplies)setupQuality+=Math.min(22,Math.round(Number(inversion.transfer)||0));
  setupQuality-=Math.min(24,structuralDecay);
  const chaseRisk=dir!==0&&dir*move3>2.2&&Math.abs(move3)>Math.abs(move6)*0.72;
  if(chaseRisk)setupQuality-=12;
  const sessionRange=Math.max(0.35,sessionHigh-sessionLow);
  const directionalProgress=side==="CALL"?(m.spySpot-sessionLow)/sessionRange:side==="PUT"?(sessionHigh-m.spySpot)/sessionRange:0.5;
  const wallDistance=side==="CALL"?Math.max(0,m.callWall-m.spySpot):side==="PUT"?Math.max(0,m.spySpot-m.putWall):99;
  const campaign=buildCampaignState(m,hist,tradeMemory,metacognition);
  const campaignAligned=side!=="WAIT"&&campaign.direction===side;
  const opportunityMaturity=campaignAligned?campaign.maturity:Math.round(directionalProgress*38);
  const remainingOpportunity=campaignAligned?campaign.remainingOpportunity:clamp(100-opportunityMaturity,0,100);
  if(campaignAligned&&["EMERGING","CONFIRMED"].includes(campaign.stage))setupQuality+=Math.min(12,Math.round(remainingOpportunity*.12));
  if(campaignAligned&&["MATURE","EXHAUSTED"].includes(campaign.stage))setupQuality-=Math.round((100-remainingOpportunity)*.24);
  if(campaignAligned&&campaign.stage==="REVERSING")setupQuality-=30;
  setupQuality=clamp(setupQuality,0,94);

  const episodeKey=side!=="WAIT"?tradeEpisodeKey(side,m,det):null;
  const legacyReentry=side!=="WAIT"?evaluateReentry(tradeMemory,side,m,hist,episodeKey):{allowed:true,newEvidence:[]};
  const discipline=side!=="WAIT"?evaluateReentryDiscipline(tradeMemory,side,thesis?.primaryCategory||"UNKNOWN",thesis?.gexVelocity?.state,m.tick,episodeKey):{allowed:true};
  let reentry={...legacyReentry,allowed:legacyReentry.allowed&&discipline.allowed,discipline};
  const freshBearContinuation=side==="PUT"&&activeBearRegime&&persistence>=2&&(Math.min(move6,move15,move30)<-0.70||sessionMove<-1.00);
  if(freshBearContinuation)reentry={...reentry,allowed:true,newEvidence:[...(reentry.newEvidence||[]),"fresh bearish continuation: falling FEP + negative GEX + sustained downside"]};
  const contractQuality=!contract?0:contract.tier==="QUALITY"?100:contract.tier==="AVAILABLE"?68:76;
  let executionReadiness=Math.round((setupQuality*0.80+contractQuality*0.20)*(0.52+remainingOpportunity*0.0048));
  const gaps=[...new Set(marketFactors.filter(f=>!f.passed).map(f=>f.label))];
  const blockers=[];
  const lastExit=tradeMemory?.lastExit;
  const sameDirectionLossLock=!!lastExit&&lastExit.side===side&&lastExit.pnl<=0&&(m.tick-lastExit.tick)<15;
  if(sameDirectionLossLock){blockers.push(`ATOMIC_SAME_DIRECTION_REENTRY_LOCK:${15-(m.tick-lastExit.tick)}t`);executionReadiness=Math.min(executionReadiness,55);}
  if(side==="WAIT")blockers.push(`NEUTRAL_CAUSAL_DEAD_ZONE call:${Math.round(callAuthority)} put:${Math.round(putAuthority)} edge:${Math.round(authorityEdge)}`);
  if(chaseRisk)blockers.push("Chase risk after completed impulse");
  if(campaignAligned&&["MATURE","EXHAUSTED"].includes(campaign.stage)&&remainingOpportunity<42)blockers.push(`CAMPAIGN_MATURE:${campaign.stage} remaining:${remainingOpportunity}%`);
  if(campaignAligned&&campaign.stage==="REVERSING")blockers.push(`CAMPAIGN_REVERSAL_RISK:${campaign.reversalRisk}%`);
  if(!reentry.allowed){
    const d=reentry.discipline;
    const preservedStandard=reentry.requiredStandard==="RENEWED_EXECUTION_EVIDENCE";
    blockers.push(preservedStandard?`OLD_THESIS_ALIVE: waiting for renewed execution evidence after ${reentry.postStopState}`:d?.code?`${d.code}: repeated ${d.repeatedCategory}; override requires ${d.override}`:`No genuinely new thesis evidence since invalidated ${side}`);
    executionReadiness=Math.min(executionReadiness,72);
  }
  if(!contract){
    blockers.push("No valid contract");
    executionReadiness=Math.min(executionReadiness,72);
  }
  if(!m.isTradeable){blockers.unshift("Market not tradeable");executionReadiness=0;}
  const threshold=contract?.tier==="ADAPTIVE"?88:contract?.tier==="AVAILABLE"?92:80;
  const confidence=clamp(Math.round(setupQuality*.60+Math.max(brainConfidence,Math.min(90,Math.abs(localMove)*35))*.40),0,98);
  const minCanonicalConfidence=58;
  if(side!=="WAIT"&&confidence<minCanonicalConfidence){blockers.push(`CANONICAL_CONFIDENCE_BELOW_MINIMUM:${confidence}<${minCanonicalConfidence}`);executionReadiness=Math.min(executionReadiness,69);}
  const canonicalDirectionReady=alignedPrimaryCount>=1||localMove>=0.70||(persistence>=2&&localAgreement)||(inversionApplies&&localAgreement&&localMove>=0.20);
  const canEnter=m.isTradeable&&side!=="WAIT"&&!!contract&&reentry.allowed&&!sameDirectionLossLock&&!chaseRisk&&canonicalDirectionReady&&executionReadiness>=threshold&&confidence>=minCanonicalConfidence&&(brainConfidence>=42||localMove>=0.70||inversionApplies);
  const action=canEnter?(isCall?"BUY_CALL":"BUY_PUT"):(side==="WAIT"?"WAIT":`PREPARE_${side}`);
  const whyNow=[
    ...(reentry.newEvidence||[]),
    bearishSessionContext?"session context bearish: below FEP, negative GEX, lower-quartile location":"",
    localMove>=0.55?"fresh directional leg":"continuing structure",
    persistence>=1?"multi-window persistence":""
  ].filter(Boolean);
  return{
    action,direction:side==="WAIT"?null:side,
    setupQuality,executionReadiness,readiness:executionReadiness,confidence,
    contract:contract?{strike:contract.strike,price:contract.price,delta:contract.delta,quality:contract.tier,distance:contract.distance,openInterest:contract.openInterest||0,volume:contract.volume||0}:null,
    bestRejected:rejected?{strike:rejected.strike,price:rejected.price,delta:rejected.delta,distance:rejected.distance,reasons:rejected.reasons}:null,
    blockers,gaps,supportingFactors:[...new Set([...marketFactors.filter(f=>f.passed).map(f=>f.label),...(inversionApplies?[`Expectation failure transfer from ${inversion.sourceSide}: +${Math.round(inversion.transfer)} (${inversion.reason})`]:[]),...(structuralDecay>0?[`Structural ${side} authority decayed ${structuralDecay} after ${sameSideFailureStreak} failed expectation${sameSideFailureStreak===1?"":"s"}`]:[])])],
    threshold,chaseRisk,whyNow,episodeKey,source:"SESSION_AWARE_INTENT",
    diagnostics:{callAuthority,putAuthority,authorityEdge,causalAuthority,brainConfidence,rawBrainConfidence,structuralDecay,sameSideFailureStreak,inversion,inversionApplies,edge,persistence,response,contractQuality,brainSide,localSide,localMove,reentry,sessionMove,sessionFepMove,belowFepShare,negativeGexShare,bearishSessionContext,bearishExpansionContext,activeBearRegime,provenPinContext,alignedPrimaryCount,canonicalDirectionReady,sessionHigh,sessionLow,sessionRange,directionalProgress,wallDistance,opportunityMaturity,remainingOpportunity,campaign,gaps}
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
    reasoning:`AI response failed; deterministic degraded mode is executing the current canonical ${intent.direction||"NONE"} because all causal, contract, reentry, timing, and market-health gates already passed. This is not stale AI reuse.`,
    mindset:"new leg, not repeated stale evidence",
    journal_entry:"",
    edge_state:"ENTRY_READY",confidence_trend:"BUILDING",
    trade_confidence:confidence,
    invalidation_spot:isCall?m.spySpot-(0.35+confidence/190):m.spySpot+(0.35+confidence/190),
    target_spot:isCall?m.spySpot+(0.70+confidence/105):m.spySpot-(0.70+confidence/105),
    max_loss_pct:clamp(18+(confidence-45)*0.20,18,30),
    memory_used:"session trade memory"
  });
}

function extractPartialThought(jsonText){
  const key='"thought_append":"';
  const start=jsonText.indexOf(key);
  if(start<0)return"";
  let out="",esc=false;
  for(let i=start+key.length;i<jsonText.length;i++){
    const ch=jsonText[i];
    if(esc){out+=ch==="n"?"\n":ch==="t"?"\t":ch;esc=false;continue;}
    if(ch==="\\"){esc=true;continue;}
    if(ch==='"')break;
    out+=ch;
  }
  return out;
}
async function readTraderStream(resp,onThought){
  if(!resp.body)return await resp.text();
  const reader=resp.body.getReader(),decoder=new TextDecoder();
  let pending="",output="";
  while(true){
    const chunk=await reader.read();
    if(chunk.done)break;
    pending+=decoder.decode(chunk.value,{stream:true});
    const lines=pending.split("\n");pending=lines.pop()||"";
    for(const line of lines){
      if(!line.startsWith("data: "))continue;
      const raw=line.slice(6).trim();
      if(!raw||raw==="[DONE]")continue;
      try{const event=JSON.parse(raw);if(event.type==="response.output_text.delta"){output+=event.delta||"";onThought?.(extractPartialThought(output));}}catch{}
    }
  }
  return output;
}
async function persistThought(row){
  const r=await fetch("/api/thoughts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(row)});
  if(!r.ok)throw new Error(`thought sync ${r.status}`);
}
async function loadThoughts(){
  try{const r=await fetch("/api/thoughts?limit=80");if(!r.ok)return[];const d=await r.json();return d.rows||[];}catch{return[];}
}
async function loadTraderLearning(){
  try{const r=await fetch("/api/trader-learning",{cache:"no-store"});if(!r.ok)return{pipelineVersion:2,items:[]};return await r.json();}catch{return{pipelineVersion:2,items:[]};}
}
function traderLearningText(packet){
  const items=packet?.items||[];
  const compounding=packet?.compounding||[];
  if(!items.length&&!compounding.length)return"No validated cross-session review knowledge is currently available.";
  const durable=items.map(item=>{const when=item.validatedAtUtc||item.fixedAtUtc||"date unavailable";const status=item.status||"UNKNOWN";const note=item.adjudicationNote||item.summary||"No summary recorded.";const instruction=status==="FIXED_PENDING_VALIDATION"?"Treat as a build caution awaiting replay validation.":"Treat as durable operating knowledge.";return`[${status}] ${item.rootCauseKey} | ${when}\n${note}\nTrader use: ${instruction}`;}).join("\n\n");
  const experiential=compounding.map(item=>{const state=item.state||{};return`[COMPOUNDING MEMORY] ${item.id}: ${item.title}\nKnowledge cutoff: tick ${item.knowledgeCutoffTick}, session minute ${item.sessionMinute}. Do not infer later replay outcomes.\nThesis scope: ${JSON.stringify(item.thesisScope||{})}\nContemporaneous state: ${JSON.stringify(state)}\nInterpretation: ${item.interpretation}\nUse policy: ${item.usePolicy}`;}).join("\n\n");
  return [durable,experiential].filter(Boolean).join("\n\n");
}
function buildCampaignState(m,hist,tradeMemory={},metacognition={}){
  const all=[...hist,m].filter(x=>Number.isFinite(x?.spySpot));
  const at=n=>all.length>n?all.at(-(n+1)):all[0]||m;
  const move=n=>Number(m.spySpot)-Number(at(n)?.spySpot??m.spySpot);
  const horizons={m5:move(15),m15:move(45),m30:move(90),m60:move(180),m120:move(360)};
  const high=Math.max(...all.map(x=>x.spySpot)),low=Math.min(...all.map(x=>x.spySpot));
  const range=Math.max(.35,high-low),fromHigh=m.spySpot-high,fromLow=m.spySpot-low;
  const recent=all.slice(-180),legs=[];let sign=0,start=recent[0]?.spySpot,last=start;
  for(const x of recent.slice(1)){const d=x.spySpot-last,ns=Math.abs(d)<.025?sign:Math.sign(d);if(sign&&ns&&ns!==sign){legs.push({dir:sign,move:last-start});start=last;}if(ns)sign=ns;last=x.spySpot;}if(sign)legs.push({dir:sign,move:last-start});
  const ups=legs.filter(x=>x.dir>0).map(x=>Math.abs(x.move)),downs=legs.filter(x=>x.dir<0).map(x=>Math.abs(x.move));
  const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
  const failedBull=(metacognition?.expectationFailures?.CALL||0)+(tradeMemory?.consecutiveFailures?.CALL||0);
  const failedBear=(metacognition?.expectationFailures?.PUT||0)+(tradeMemory?.consecutiveFailures?.PUT||0);
  const weighted=horizons.m5*.10+horizons.m15*.18+horizons.m30*.24+horizons.m60*.28+horizons.m120*.20;
  const direction=weighted>.35?'CALL':weighted<-.35?'PUT':'WAIT',dir=direction==='CALL'?1:direction==='PUT'?-1:0;
  const progress=direction==='CALL'?(m.spySpot-low)/range:direction==='PUT'?(high-m.spySpot)/range:.5;
  const wall=direction==='CALL'?m.callWall:direction==='PUT'?m.putWall:m.spySpot;
  const runway=direction==='CALL'?wall-m.spySpot:direction==='PUT'?m.spySpot-wall:0;
  const counterStrength=direction==='CALL'?avg(downs):direction==='PUT'?avg(ups):Math.max(avg(ups),avg(downs));
  const legStrength=direction==='CALL'?avg(ups):direction==='PUT'?avg(downs):0;
  const failurePenalty=direction==='CALL'?failedBull:direction==='PUT'?failedBear:0;
  const maturity=clamp(Math.round(progress*62+(Math.abs(horizons.m60)>2?14:0)+(runway<.55?14:0)+(failurePenalty*5)),0,100);
  const reversalRisk=clamp(Math.round((counterStrength>legStrength*.75?28:8)+(progress>.82?28:0)+(runway<.4?24:0)),0,100);
  const remainingOpportunity=clamp(100-maturity-Math.round(reversalRisk*.35)+(runway>1?12:0),0,100);
  const stage=direction==='WAIT'?'UNRESOLVED':reversalRisk>=62?'REVERSING':maturity>=82?'EXHAUSTED':maturity>=62?'MATURE':Math.abs(weighted)>=1?'CONFIRMED':'EMERGING';
  return{direction,stage,horizons,session:{open:all[0]?.spySpot,high,low,current:m.spySpot,fromHigh,fromLow,range,locationPct:Math.round((m.spySpot-low)/range*100)},legs:{count:legs.length,avgUp:avg(ups),avgDown:avg(downs),recent:legs.slice(-8)},failedLegs:{CALL:failedBull,PUT:failedBear},structure:{fepGap:m.spySpot-m.fep,flipGap:m.spySpot-m.gammaFlip,callWall:m.callWall,putWall:m.putWall,runway},maturity,reversalRisk,remainingOpportunity};
}

async function callAI(mkt,pos,bal,hist,probs,conf,thesis,journal,approvedRules,repeatWaitCount,sessionSummary,marketBrain,aiSessionMemory,traderLearning,onThought,signal,urgentEntry=false,metaContext={}){
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
  const contextStr=contextPrompt(th.contextHierarchy,th.flowLens);
  const macroPriorStr=metaContext.premarketContext?`FROZEN PREMARKET CONTEXT — INFORMATION AVAILABLE BY 09:30 ET ONLY:\n${JSON.stringify(metaContext.premarketContext)}\nUse this only as a starting prior. It cannot force a trade, must not be treated as live news, and loses authority when price/structure disproves it.`:"FROZEN PREMARKET CONTEXT: unavailable; use live market evidence only.";
  const campaignState=buildCampaignState(mkt,hist,metaContext.tradeMemory||{},metaContext);
  const campaignStr=JSON.stringify(campaignState);
  const capabilityInventory={market:true,spxSpyIts:true,structuralIts:!!th.contextHierarchy?.structural,localIts:!!th.contextHierarchy?.local,gex:true,fep:true,walls:true,accelerator:true,optionChain:!!mkt.optionChain,orderFlow:!!mkt.orderFlow?.tradeCount,comprisingTradeDepth:(mkt.orderFlow?.maxPriceLevels||0)>1,persistentJournal:!!aiSessionMemory,tradeMemory:true};
  const auditDue=!!aiSessionMemory?.architecture?.upgradePending||(mkt.tick||0)%30===0||th.contextHierarchy?.alignment==="CONFLICT"||(th.flowLens?.available&&th.flowLens.aggression>=70)||(th.flowLens?.available&&th.flowLens.hedgeProbability>=70);
  const inventoryStr=Object.entries(capabilityInventory).map(([k,v])=>`${k}:${v?"AVAILABLE_NOW":"NOT_PRESENT_AT_THIS_TIMESTAMP"}`).join(" | ");
  const thesisStr=`CALL ${th.scores.call}% (${th.momentum.call>=0?"+":""}${th.momentum.call}) | PUT ${th.scores.put}% (${th.momentum.put>=0?"+":""}${th.momentum.put}) | WAIT ${th.scores.wait}% (${th.momentum.wait>=0?"+":""}${th.momentum.wait}) | STATE:${th.state} | BIAS:${th.entryBias} | EDGE:${th.edgeScore}${th.scalpEdge?` | SCALP EDGE FIRING (${th.scalpDir})`:""}\nCALL needs: ${(th.call.needs||[]).join(", ")||"none"}\nPUT needs: ${(th.put.needs||[]).join(", ")||"none"}`;

  const memoryStr=historicalMemoryPrompt(mkt,marketBrain||createMarketBrain());
  const rulesStr=approvedRules.length>0?`\nAPPROVED RULES:\n${approvedRules.map(r=>`- ${r.rule}`).join("\n")}`:"";
  const repeatStr=repeatWaitCount>=6?`\nNOTE: You have returned WAIT with similar reasoning ${repeatWaitCount} checks in a row. If the underlying signal genuinely hasn't changed, that's a legitimate no-trade day — say so plainly instead of restating the same analysis. If SCALP EDGE is firing, that overrides this pattern; take it.`:"";
  const providerHealthy=metaContext.providerState==="CONNECTED"&&!metaContext.providerCircuitOpen;
  const activeJournal=journal.filter(j=>!(providerHealthy&&/AI_RESPONSE_FAILURE|FALLBACK_DECISION|PROVIDER_THROTTLED|TURN_DRAIN_TIMEOUT|integrity-failure lock/i.test(j.entry||""))).slice(-3);
  const providerAuthority=providerHealthy?"PROVIDER STATUS: CONNECTED AND HEALTHY. Any earlier transient AI/provider failure is historical only and MUST NOT block, veto, reduce readiness, or create an integrity lock for a new valid decision.":`PROVIDER STATUS: ${metaContext.providerState||"UNKNOWN"}.`;
  const prompt=`${PRODUCT_NAME} ${PRODUCT_VERSION} | BUILD ${BUILD_ID} | SPY 0DTE. ${tStr} | ${mL}min | THETA:${theta?"YES":"no"} | EOD_PHASE:${eodPhase}${mkt.isPremarket?" | PREMARKET":""}\n${providerAuthority}\n\n${brainPrompt(marketBrain||createMarketBrain())}\n\n${memoryStr}
BAL:$${bal.toFixed(0)} | ${posStr}

SESSION JOURNAL:
${activeJournal.map(j=>`[${j.t}] ${j.entry}`).join("\n")||"No currently authoritative journal event."}

AI THOUGHTS JOURNAL — READ THIS BEFORE DECIDING:
${aiMemoryText(aiSessionMemory,{recentEntries:30})}

VALIDATED CROSS-SESSION OPERATING MEMORY:
${traderLearningText(traderLearning)}

Memory authority: VALIDATED and FIX_VERIFIED items are durable. FIXED_PENDING_VALIDATION items are cautions, not confirmed truths. REJECTED items identify interpretations that must not be inherited. Never promote a RAW_OBSERVATION through this prompt.

${sessionSummary||"Session just opened."}

${macroPriorStr}

ARCHITECTURE SELF-MODEL:
${ARCHITECTURE_MANIFEST}
DATA / CAPABILITY INVENTORY:
${inventoryStr}
${aiSessionMemory?.architecture?.upgradePending?`
BOOT UPGRADE HANDSHAKE: This is your first live assessment on build ${BUILD_ID}. Before writing architecture_reflection, independently compare the available capabilities, live fields, hierarchy, and prior architecture memory. Identify only what is materially new, newly useful, missing, contradictory, or misunderstood. Do not assume any named capability is important merely because it appears in the inventory. Write your own architecture reflection from that audit.`:""}
${auditDue?`
AUTONOMOUS SANITY AUDIT DUE: Independently verify that the current interpretation is internally coherent across structure, local behavior, price response, execution data, contract behavior, and session history. Look for stale assumptions, double-counted evidence, unexplained contradictions, absent data, or a potentially valuable angle the framework is not currently using. This audit must not delay a valid executable trade. Only record a durable finding when it is material.`:""}

${contextStr}

REGIME: ${top[0].toUpperCase()} ${top[1]}% (D:${probs.discovery} PIN:${probs.pin} T:${probs.transition} M:${probs.macro})
CONVICTION: ${conf.score}/100 | ${conf.factors.slice(0,3).map(f=>f.label+(f.delta>0?"+":"")+f.delta).join(", ")}

SPY: $${mkt.spySpot.toFixed(2)} | SPX: ${mkt.spxSpot.toFixed(0)}
SPX-ITS: ${mkt.itsSPX.toFixed(2)} | SPY-ITS: ${mkt.itsSPY.toFixed(2)} | DIV: ${div.toFixed(2)} (${div>0.4?"SPX LEADS=TENSION; REQUIRE SPY TRANSMISSION":div<-0.4?"SPY LEADS=TENSION; TEST RESILIENCE VS CONTAGION":"ALIGNED/CONVERGED; TEST COMPRESSION VS RESOLUTION"})
Flip: $${mkt.gammaFlip.toFixed(2)} ${mkt.spySpot>mkt.gammaFlip?"ABOVE":"BELOW"} | Walls: C$${mkt.callWall.toFixed(1)} P$${mkt.putWall.toFixed(1)}
GEX: ${gexStr} | ACCEL: ${mkt.accelerator.toFixed(2)} | NDF: ${mkt.ndf.toFixed(3)} | IV: ${mkt.iv.toFixed(1)}%
FEP: $${mkt.fep.toFixed(2)} gap: ${(mkt.spySpot-mkt.fep).toFixed(2)}


${optStr}

RECENT:\n${rH}

CAUSAL CAMPAIGN STATE — AUTHORITATIVE SUMMARY:
${campaignStr}

UNIFIED DIRECTIONAL STATE: ${thesisStr}

TRADER DECISION PROTOCOL:
- Analyze one continuous session. The CAUSAL CAMPAIGN STATE is the required whole-path summary.
- Before discussing permission gates, determine the active campaign, its maturity, and whether enough expected value remains for entry.
- Failed forecasts, failed legs, entry/exit locations, and weakening counter-legs are market evidence. A direction regains authority only after a structural reset.
- Directional correctness and entry attractiveness are separate. A mature trend may be a bad chase; an emerging counter-campaign may be attractive before full confirmation.
- Contract P/L earns authority only when current timing and expansion still support the thesis. Legacy shadow profits do not validate current direction.
- WAIT/PREPARE/BUY describes execution eligibility, not analysis. Do not spend thought_append or journal_entry repeating gate status.
- Preserve only a new causal inference, campaign-stage change, expectation update, contradiction, failed-leg update, or self-correction. Avoid repetitive language loops.
- Non-resolution is evidence. A forecast that misses its window loses authority and cannot be renamed a fresh episode without new structure.
- Do not reflexively reverse after a loss, and do not protect a losing narrative after price, structure, transmission, and contract response invalidate it.
- In a position, manage the original spot thesis and remaining opportunity. Flat, prefer asymmetric entries over threshold churn.
- Separate setup evidence, calibrated confidence, remaining opportunity, timing, contract quality, and execution readiness. Checklist completion is never certainty.
- Never BUY while already positioned; no new entries after 3:45 PM ET.

RULES:
- Maintain CALL, PUT, and WAIT proportionally to multi-horizon price response. ITS divergence is lead/lag tension, never direction by itself.
- Predict before broad repricing. Penalize entries in MATURE, EXHAUSTED, or REVERSING campaigns unless a distinct reset creates fresh runway and nearby invalidation.
- GEX, FEP, flip, walls, and exposure surfaces matter only through migration and price transmission. Failed transmission reduces authority.
- Walls are decision zones, not automatic support, resistance, or magnets. Detect failure at the boundary, not after the move completes.
- Use only the supplied contract. QUALITY is preferred; ADAPTIVE/AVAILABLE require their higher threshold. Never invent a strike.
- Current contract expansion can confirm an early move; completed expansion reduces remaining edge. Distinguish current response from legacy P/L.
- Use POST_STOP_THESIS for reentry standards. A loss alone neither invalidates nor preserves the thesis.
- Canonical BUY with no hard blocker is executable unless an enumerated veto is specifically evidenced. PREPARE is non-executable. Score disagreement means uncertainty.
- Provider failure is not no edge. Deterministic fallback may execute only a still-current canonical BUY that passed all causal, timing, data, contract, and reentry gates.
- Drawdown review reduces size and raises novelty standards; it must not permanently paralyze a later independent campaign.
- Exit on spot invalidation, confirmed opposite control, catastrophic vehicle failure, or protected-profit logic, not ordinary 0DTE noise.
- journal_entry must be empty when nothing material changed. Decision and journal text must agree.${repeatStr}
${rulesStr}

METACOGNITIVE STATE:
- DATA: ${metaContext.dataHealth?.state||"UNKNOWN"} ${JSON.stringify(metaContext.dataHealth||{})}
- TRANSMISSION: ${metaContext.transmission?.state||"UNKNOWN"} ${JSON.stringify(metaContext.transmission||{})}
- ACTIVE FORECAST: ${JSON.stringify(metaContext.activeForecast||null)}
- DRAWDOWN REVIEW: ${metaContext.drawdownActive?"ACTIVE":"inactive"}
If data is stale/noninformative, do not create or renew forecasts and do not enter. If transmission failed, reduce confidence. If nothing material changed, set thought_append and journal_entry empty.

Respond ONLY valid JSON. Put thought_append first so it can stream into the live notepad before the final decision is parsed:
{"thought_append":"free-form compact working note, or empty string if nothing worth carrying forward","architecture_reflection":"required only when BOOT UPGRADE HANDSHAKE is present; otherwise empty","flow_hypothesis":"independent current inference from execution evidence, or empty","self_audit":"material sanity-check finding, or empty","missing_angle":"potentially valuable unmodeled angle, or empty","coherence_check":"COHERENT|TENSION|DATA_GAP|STALE_ASSUMPTION","decision":"WAIT|WAITING|BUY_CALL|BUY_PUT|SELL|HOLD","reasoning":"one sentence","mindset":"signal you watch most","journal_entry":"one sentence updating session narrative","edge_state":"NO_EDGE|CONDITIONS_FORMING|ENTRY_READY|IN_TRADE|EXITING","confidence_trend":"BUILDING|STABLE|DECAYING|UNCLEAR","trade_confidence":0,"invalidation_spot":null,"target_spot":null,"max_loss_pct":null,"memory_used":"session or historical memory used","current_thesis":"one phrase","expected_next_path":"what should happen next","new_evidence":"what changed since prior decision","prior_trade_effect":"how previous entries/exits affect this decision","reevaluate_after_ticks":2,"veto_reason":"NONE|DIRECTION_FLIPPED|CONTRACT_INVALID|CHASE_RISK|EPISODE_STALE|OPPOSITE_ACCEPTANCE|FINAL_THETA_WINDOW","veto_evidence":"specific current-state evidence or empty"}`;
  const urgentPrompt=urgentEntry?`FIRSTSIGNAL URGENT ENTRY DECISION. Use retained session architecture and rules. Do not perform an architecture audit or write a long reflection. Return submit_trade_decision immediately.
TIME ${tStr}; ${mL}min left; ${posStr}.
${sessionSummary||""}
VALIDATED CROSS-SESSION MEMORY:\n${traderLearningText(traderLearning)}
${contextStr}
REGIME ${top[0]} ${top[1]}%; SPY ${mkt.spySpot.toFixed(2)}; SPX ${mkt.spxSpot.toFixed(0)}; SPX-ITS ${mkt.itsSPX.toFixed(2)}; SPY-ITS ${mkt.itsSPY.toFixed(2)}; DIV ${div.toFixed(2)}; FEP ${mkt.fep.toFixed(2)}; FLIP ${mkt.gammaFlip.toFixed(2)}; CALL WALL ${mkt.callWall.toFixed(1)}; PUT WALL ${mkt.putWall.toFixed(1)}; ACCEL ${mkt.accelerator.toFixed(2)}; GEX ${gexStr}.
${optStr}
RECENT ${rH}
THESIS ${thesisStr}
ACCOUNTABLE FORECAST RULE: Separate observation, forecast, evidence update, and thesis revision. Do not rewrite an active forecast merely because the newest tick is inconvenient. State forecast_probability, forecast_window_ticks, and forecast_supporting_behavior. Failed forecasts must reduce confidence in the responsible signals.
GEX IMPULSE: ${JSON.stringify(th.gexImpulse||{})}
SIGNAL TRUST: ${JSON.stringify(metaContext.signalTrust||{})}
DRAWDOWN REVIEW: ${metaContext.drawdownActive?"ACTIVE - fewer trades are appropriate until the operating model is re-articulated":"inactive"}
If canonical action is BUY with no hard blockers, return that BUY unless one enumerated veto is objectively true. Keep thought_append and architecture_reflection empty; prioritize the decision.`:prompt;
  let payload;
  try{payload=await geminiLiveTrader.request(urgentPrompt,onThought,signal,{urgent:urgentEntry});}
  catch(firstError){
    const message=String(firstError?.message||firstError);
    if(!/GEMINI_LIVE_TIMEOUT|RESPONSE_TIMEOUT|TURN_DRAIN_TIMEOUT/i.test(message))throw firstError;
    onThought?.("Trader decision timed out once; retrying through the same live session...");
    payload=await geminiLiveTrader.request(urgentPrompt,onThought,signal,{urgent:urgentEntry});
  }
  const normalized=normalizeTraderDecision(payload);
  if(isSemanticAiFailure(normalized)){
    const err=new Error(`AI_SEMANTIC_FAILURE ${normalized.reasoning||normalized.mindset}`);
    err.rawResponse=JSON.stringify(payload).slice(0,700);
    throw err;
  }
  return{...normalized,callOpt,putOpt,provider:"GEMINI_3_1_LIVE"};
}

async function generatePatchProposals(tradeLog,mindsetLog,journal,stats){
  const prompt=`FIRSTSIGNAL SIM v1 AI reviewing completed session.\nSTATS: ${JSON.stringify(stats)}\nTRADES: ${tradeLog.length===0?"None taken.":`${tradeLog.map(t=>`${t.t}: ${t.action} ${t.result||""}`).join("\n")}`}\nJOURNAL:\n${journal.map(j=>`[${j.t}] ${j.entry}`).join("\n")}\nLAST 8 DECISIONS:\n${mindsetLog.slice(-8).map(m=>`[${m.t}] ${m.edgeState} ${m.score} — ${m.reasoning}`).join("\n")}\n\nPropose 2-4 specific rule changes. Be precise and actionable.\nRespond ONLY valid JSON:\n{"proposals":[{"id":1,"rule":"specific rule text","reasoning":"why this helps","missed_opportunity":"what was missed"}]}`;
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
  if(!data||data.length<2)return<div style={{width:"100%",height:h,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}><span style={{fontSize:8,color:"#4a5568"}}>--</span></div>;
  const mn=Math.min(...data),mx=Math.max(...data),rng=mx-mn||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*w},${h-((v-mn)/rng)*(h-4)-2}`).join(" ");
  return<svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{display:"block",width:"100%",height:h,maxWidth:"100%",overflow:"hidden"}}>{fill&&<polygon points={`0,${h} ${pts} ${w},${h}`} fill={color} opacity={0.12}/>}<polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round"/></svg>;
}

function PriceChart({candles,gammaFlip,callWall,putWall,position,isPremarket,callTrigger,putTrigger,callStop,putStop}){
  const ref=useRef(null);
  const[drag,setDrag]=useState(false),[hov,setHov]=useState(null);
  const W=900,H=240,PT=12,PB=10,PL=10;
  // RH-style chronology: the whole elapsed session fits naturally with the live point
  // close to the right edge. No synthetic future gap, horizontal pan, or bottom scrollbar.
  const LIVE_ANCHOR=0.94;
  const STEP=Math.max(0.35,((W*LIVE_ANCHOR)-PL-6)/Math.max(1,candles.length));
  const sp=candles.map(c=>c.spySpot).filter(Number.isFinite);
  const recent=candles.slice(-180),recentSp=recent.map(c=>c.spySpot).filter(Number.isFinite);
  const current=sp.at(-1)??gammaFlip;
  const recentMin=recentSp.length?Math.min(...recentSp):current-0.8,recentMax=recentSp.length?Math.max(...recentSp):current+0.8;
  const recentMoves=recentSp.slice(1).map((v,i)=>Math.abs(v-recentSp[i])).sort((a,b)=>a-b);
  const medianMove=recentMoves.length?recentMoves[Math.floor(recentMoves.length/2)]:0.04;
  const localRange=Math.max(1.15,recentMax-recentMin,medianMove*24);
  const nearRefs=[position?.targetSpot,position?.stopSpot,callTrigger,putTrigger,callStop,putStop,gammaFlip,candles.at(-1)?.fep].filter(v=>Number.isFinite(v)&&Math.abs(v-current)<=localRange*0.75);
  const refMin=nearRefs.length?Math.min(...nearRefs,current):current,refMax=nearRefs.length?Math.max(...nearRefs,current):current;
  const displayRange=Math.max(localRange*1.16,(refMax-refMin)*1.12,1.15);
  const center=(current*0.68+((recentMin+recentMax)/2)*0.32);
  const mn=center-displayRange/2,mx=center+displayRange/2,rng=mx-mn;
  const toY=v=>PT+((mx-v)/rng)*(H-PT-PB),toX=i=>PL+i*STEP;
  const pointerIndex=e=>{
    const rect=ref.current?.getBoundingClientRect();
    if(!rect||!candles.length)return null;
    const cx=e.clientX||e.touches?.[0]?.clientX||0;
    const local=((cx-rect.left)/rect.width)*W;
    return clamp(Math.round((local-PL)/STEP),0,candles.length-1);
  };
  const down=e=>{setDrag(true);setHov(pointerIndex(e));e.preventDefault();};
  const move=e=>{if(drag)setHov(pointerIndex(e));};
  const up=()=>setDrag(false);
  const openIdx=candles.findIndex(c=>c.isOpen);
  const hc=hov!=null&&hov>=0&&hov<candles.length?candles[hov]:null;
  const pathFilled=candles.some(c=>String(c.quoteSource||"").includes("PATH_FILL")||String(c.marketSource||"").includes("PROJECTION"));
  const fep=candles.at(-1)?.fep;
  const fepGap=Number.isFinite(fep)?current-fep:null;
  const rawWallLabels=[{v:callWall,c:"#00d4a8",l:"CALL WALL"},{v:gammaFlip,c:"#f0c040",l:"FLIP"},{v:putWall,c:"#ff4060",l:"PUT WALL"}].map(x=>({...x,rawY:toY(x.v)})).sort((a,b)=>a.rawY-b.rawY);
  const wallLabels=rawWallLabels.map((x,i,a)=>{let labelY=Math.max(PT+9,Math.min(H-PB-5,x.rawY));if(i>0&&labelY-a[i-1].labelY<14)labelY=a[i-1].labelY+14;return {...x,labelY};});
  return(
    <div>
      <div style={{background:"#141920",borderBottom:"1px solid #1a2030",padding:"4px 10px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:9,color:isPremarket?"#f0c040":"#4a5568"}}>{isPremarket?"PREMARKET":"PRICE"}</span>
        <span style={{fontSize:11,fontWeight:700,color:isPremarket?"#f0c040":"#00d4a8",fontFamily:"monospace"}}>{drag&&hc?`${hc.t} ET  ·  $${hc.spySpot.toFixed(2)}`:candles.length>0?`${candles[candles.length-1].t} ET`:"--:--"}</span>
        {pathFilled&&<span title="Replay includes causal path-filled one-minute values between native observations" style={{fontSize:7,color:T.yellow,border:`1px solid ${T.yellow}55`,padding:"1px 4px",borderRadius:2}}>1M PATH-FILLED</span>}
        <span style={{fontSize:9,color:"#4a5568"}}>{drag?"release to return live":"hold chart to inspect"}</span>
      </div>
      {Number.isFinite(fep)&&<div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:1,background:"#1a2030",borderBottom:"1px solid #1a2030"}}>
        {[
          ["PUT WALL",putWall,"#ff4060"],
          ["FLIP",gammaFlip,"#f0c040"],
          ["FEP",fep,"#a78bfa"],
          ["SPY",current,"#dde4f0"],
          ["CALL WALL",callWall,"#00d4a8"]
        ].map(([label,value,color])=><div key={label} style={{background:"#0e1117",padding:"5px 7px",textAlign:"center"}}><div style={{fontSize:6,color:"#4a5568",letterSpacing:"0.08em"}}>{label}</div><div style={{fontSize:10,fontWeight:800,color}}>${Number(value).toFixed(2)}</div>{label==="FEP"&&<div style={{fontSize:7,color:fepGap>=0?"#00d4a8":"#ff4060"}}>SPY {fepGap>=0?"+":""}{fepGap.toFixed(2)} {fepGap>=0?"ABOVE":"BELOW"}</div>}</div>)}
      </div>}
      <div ref={ref} style={{overflow:"hidden",cursor:drag?"grabbing":"grab",touchAction:"none",userSelect:"none"}} onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up} onTouchStart={down} onTouchMove={move} onTouchEnd={up}>
        <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{display:"block"}}>
          <rect width={W} height={H} fill="#0e1117"/>
          {openIdx>0&&(()=>{const x=toX(openIdx);if(x>0&&x<W)return<><rect x={0} y={0} width={x} height={H} fill="#f0c040" opacity={0.04}/><line x1={x} y1={PT} x2={x} y2={H-PB} stroke="#f0c040" strokeWidth={0.5} strokeDasharray="2,4" opacity={0.4}/></>;})()}
          {wallLabels.map(({v,c,l,rawY,labelY})=>{const y=rawY;return<g key={l}>{y>=PT-2&&y<=H-PB+2&&<line x1={0} y1={y} x2={W} y2={y} stroke={c} strokeWidth={0.6} strokeDasharray="3,3" opacity={0.5}/>}<line x1={W-42} y1={Math.max(PT,Math.min(H-PB,y))} x2={W-38} y2={labelY-2} stroke={c} strokeWidth={0.7} opacity={0.8}/><rect x={W-126} y={labelY-10} width={84} height={11} rx={2} fill="#0e1117" opacity={0.9}/><text x={W-46} y={labelY-2} fill={c} fontSize={7} textAnchor="end">{l} ${v.toFixed(0)}</text></g>;})}
          {position&&[{v:position.targetSpot,c:position.isCall?"#00ff88":"#ff3366",l:"TARGET"},{v:position.stopSpot,c:"#f0c040",l:"STOP"}].filter(x=>x.v!=null).map(({v,c,l})=>{const y=toY(v);if(y<PT-2||y>H-PB+2)return null;return<g key={l}><line x1={0} y1={y} x2={W} y2={y} stroke={c} strokeWidth={1} strokeDasharray={l==="STOP"?"4,3":"1,3"} opacity={0.7}/><text x={4} y={y-2} fill={c} fontSize={7} textAnchor="start" opacity={0.85}>{l}</text></g>;})}
          {candles.length>1&&<polyline points={candles.map((c,i)=>`${toX(i)+3},${toY(c.spySpot)}`).join(" ")} fill="none" stroke="#dde4f0" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round"/>}
          {candles.length>1&&<polyline points={candles.map((c,i)=>`${toX(i)+3},${toY(c.fep)}`).join(" ")} fill="none" stroke="#a78bfa" strokeWidth={1.15} strokeDasharray="5,3" opacity={0.9}/>}
          {Number.isFinite(fep)&&(()=>{const y=toY(fep);if(y<PT||y>H-PB)return null;return<g><rect x={8} y={Math.max(2,y-14)} width={118} height={13} rx={3} fill="#171324" opacity={0.96}/><text x={13} y={Math.max(11,y-4)} fill="#a78bfa" fontSize={7}>FEP ${fep.toFixed(2)} | SPY {fepGap>=0?"+":""}{fepGap.toFixed(2)}</text></g>;})()}
          {position&&(()=>{const ei=candles.findIndex(c=>c.t===position.entryTime);if(ei<0)return null;const x=toX(ei)+3,y=toY(candles[ei].spySpot);return<circle cx={x} cy={y} r={4} fill={position.isCall?"#00d4a8":"#ff4060"} opacity={0.9}/>;})()}
          {candles.length>0&&(()=>{const x=toX(candles.length-1)+3,y=toY(candles[candles.length-1].spySpot);if(x<0||x>W)return null;return<circle cx={x} cy={y} r={3} fill="#00d4a8"/>;})()}
          {[mn+rng*0.2,mn+rng*0.5,mn+rng*0.8].map((v,i)=><text key={i} x={4} y={toY(v)} fill="#1e2530" fontSize={7} dominantBaseline="middle">${v.toFixed(0)}</text>)}
          {drag&&hc&&(()=>{const x=toX(hov)+3,y=toY(hc.spySpot);return<g><line x1={x} y1={PT} x2={x} y2={H-PB} stroke="#8b95a5" strokeWidth={0.7} opacity={0.65}/><line x1={0} y1={y} x2={W} y2={y} stroke="#8b95a5" strokeWidth={0.5} strokeDasharray="2,3" opacity={0.4}/><circle cx={x} cy={y} r={4} fill="#dde4f0"/><rect x={Math.min(W-92,Math.max(4,x-42))} y={Math.max(4,y-27)} width={88} height={19} rx={4} fill="#202630" opacity={0.95}/><text x={Math.min(W-48,Math.max(48,x+2))} y={Math.max(17,y-14)} fill="#dde4f0" fontSize={8} textAnchor="middle">{hc.t} · ${hc.spySpot.toFixed(2)}</text></g>;})()}
        </svg>
      </div>
    </div>
  );
}


function GexPanel({mkt,candles,gexInf}){
  const prior5=candles.length>=6?candles.at(-6):candles[0];
  const prior15=candles.length>=16?candles.at(-16):candles[0];
  const spy5=prior5?mkt.netGex-prior5.netGex:0,spy15=prior15?mkt.netGex-prior15.netGex:0;
  const spx5=prior5?mkt.netGexSpx-prior5.netGexSpx:0,spx15=prior15?mkt.netGexSpx-prior15.netGexSpx:0;
  const primary=mkt.netGexSpx??mkt.netGex*10;
  const regime=primary<0?"NEGATIVE SPX GEX | LOADED / UNSTABLE":primary>0?"POSITIVE SPX GEX | DEALERS COMFORTABLE":"NEUTRAL SPX GEX";
  const color=primary<0?T.red:primary>0?T.purple:T.yellow;
  const fmtDelta=v=>`${v>=0?"+":""}${fmt.gex(v)}`;
  return <div style={{background:T.surface,borderRadius:8,border:`1px solid ${color}66`,margin:"0 14px 8px",padding:12,overflow:"hidden"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
      <div><div style={{fontSize:9,color:T.muted,letterSpacing:"0.12em"}}>SPX GAMMA EXPOSURE</div><div style={{fontSize:13,fontWeight:800,color,marginTop:3}}>{regime}</div></div>
      <div style={{textAlign:"right"}}><div style={{fontSize:22,fontWeight:800,color}}>{fmt.gex(primary)}</div><div style={{fontSize:8,color}}>SPX primary | SPY influence {(gexInf*100).toFixed(0)}%</div></div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1.1fr 1fr 1fr",gap:8}}>
      <div style={{background:T.surface2,borderRadius:6,padding:"8px 10px"}}><div style={{fontSize:8,color:T.muted}}>SPY GEX</div><div style={{fontSize:14,fontWeight:800,color:mkt.netGex>=0?T.accent:T.red}}>{fmt.gex(mkt.netGex)}</div></div>
      <div style={{background:T.surface2,borderRadius:6,padding:"8px 10px"}}><div style={{fontSize:8,color:T.muted}}>SPX 5-MIN RATE</div><div style={{fontSize:13,fontWeight:800,color:spx5>=0?T.purple:T.red}}>{fmtDelta(spx5)}</div><div style={{fontSize:7,color:T.muted}}>SPY {fmtDelta(spy5)}</div></div>
      <div style={{background:T.surface2,borderRadius:6,padding:"8px 10px"}}><div style={{fontSize:8,color:T.muted}}>SPX 15-MIN RATE</div><div style={{fontSize:13,fontWeight:800,color:spx15>=0?T.purple:T.red}}>{fmtDelta(spx15)}</div><div style={{fontSize:7,color:T.muted}}>SPY {fmtDelta(spy15)}</div></div>
    </div>
    <div style={{marginTop:8,width:"100%",overflow:"hidden"}}><Spark data={candles.map(c=>(c.netGexSpx??c.netGex*10)/1e9)} color={color} h={42} w={860} fill={true}/></div>
  </div>;
}

function ThesisBar({label,score,mom,color,scalpEdge}){
  const arrow=mom>0?"UP":mom<0?"DOWN":"FLAT";
  return<div style={{marginBottom:6}}>
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
      <span style={{fontSize:9,color,letterSpacing:"0.06em"}}>{label}{scalpEdge&&<span style={{marginLeft:5,color:"#00ff88"}}>SCALP</span>}</span>
      <span style={{fontSize:10,fontWeight:700,color}}>{score}% <span style={{fontSize:8}}>{arrow}{mom>=0?"+":""}{mom}</span></span>
    </div>
    <div style={{height:3,background:"#1e2530",borderRadius:2}}><div style={{height:"100%",width:`${clamp(score,0,100)}%`,background:color,borderRadius:2,transition:"width 0.4s"}}/></div>
  </div>;
}
function TradeIntentPanel({intent,embedded=false}){
  const action=intent?.action||"WAIT",dir=intent?.direction;
  const color=action.includes("CALL")?T.accent:action.includes("PUT")?T.red:action==="EXIT"?T.yellow:T.yellow;
  const label=action.replaceAll("_"," "),setup=intent?.setupQuality??intent?.readiness??0,ready=intent?.executionReadiness??intent?.readiness??0;
  const supports=(intent?.supportingFactors||[]).slice(0,6),blockers=(intent?.blockers||[]).slice(0,6);
  const Bar=({value,labelText,barColor})=><><div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:2}}><span style={{fontSize:7,color:T.muted}}>{labelText}</span><span style={{fontSize:12,fontWeight:800,color:barColor}}>{value}%</span></div><div style={{height:4,background:T.dim,borderRadius:4,overflow:"hidden",marginBottom:6}}><div style={{height:"100%",width:`${clamp(value,0,100)}%`,background:barColor,transition:"width .35s"}}/></div></>;
  return <div style={{background:T.surface,borderRadius:8,border:`1px solid ${color}55`,margin:embedded?"0":"0 14px 8px",padding:embedded?9:12}}>
    <div style={{display:"grid",gridTemplateColumns:embedded?"minmax(180px,.9fr) minmax(260px,1.25fr) minmax(260px,1.25fr)":"1fr",gap:embedded?10:0,alignItems:"stretch"}}>
      <div style={{minWidth:0}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}><span style={{fontSize:8,color:T.muted,letterSpacing:"0.1em"}}>CURRENT TRADE INTENT</span><span style={{fontSize:11,fontWeight:800,color}}>{label}</span></div>
        <Bar value={setup} labelText="SETUP QUALITY" barColor={color}/>
        <Bar value={ready} labelText="EXECUTION READINESS" barColor={ready>=(intent?.threshold??78)?color:T.yellow}/>
        {intent?.contract&&<div style={{padding:"5px 7px",background:T.surface2,borderRadius:5,display:"flex",justifyContent:"space-between",gap:8}}><span style={{fontSize:9,color,whiteSpace:"nowrap"}}>{intent.contract.strike}{dir==="PUT"?"P":"C"} @ ${intent.contract.price.toFixed(2)}</span><span style={{fontSize:7,color:T.muted,whiteSpace:"nowrap"}}>Î” {intent.contract.delta==null?"--":intent.contract.delta.toFixed(2)} | {intent.contract.quality} | {intent.contract.distance?.toFixed(1)} OTM</span></div>}
        {!intent?.contract&&intent?.bestRejected&&<div style={{padding:"5px 7px",background:T.surface2,borderRadius:5}}><div style={{fontSize:7,color:T.muted}}>BEST REJECTED</div><div style={{fontSize:8,color:T.yellow}}>{intent.bestRejected.strike}{dir==="PUT"?"P":"C"} @ ${intent.bestRejected.price.toFixed(2)}</div></div>}
        <div style={{marginTop:5,fontSize:6,color:T.dim}}>Threshold {intent?.threshold??"—"}% | Confidence {intent?.confidence??0}%</div>
      </div>
      <div style={{borderLeft:embedded?`1px solid ${T.border}`:"none",paddingLeft:embedded?10:0,minWidth:0}}>
        <div style={{fontSize:7,color:T.muted,marginBottom:4,letterSpacing:"0.08em"}}>SUPPORT</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gridAutoRows:"minmax(14px,auto)",gap:"2px 8px"}}>{supports.map((x,i)=><div key={i} style={{fontSize:7,color:T.accent,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}} title={x}>+ {x}</div>)}</div>
      </div>
      <div style={{borderLeft:embedded?`1px solid ${T.border}`:"none",paddingLeft:embedded?10:0,minWidth:0}}>
        <div style={{fontSize:7,color:T.muted,marginBottom:4,letterSpacing:"0.08em"}}>BLOCKERS</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gridAutoRows:"minmax(14px,auto)",gap:"2px 8px"}}>{blockers.length?blockers.map((x,i)=><div key={i} style={{fontSize:7,color:T.red,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}} title={x}>- {x}</div>):<div style={{fontSize:7,color:T.accent}}>clear</div>}</div>
      </div>
    </div>
  </div>;
}

function MultiTimeframePanel({state}){
  const layers=[state?.layers?.strategic,state?.layers?.tactical,state?.layers?.execution,state?.layers?.harvest].filter(Boolean);
  const a=state?.agreement||{};
  const sideColor=x=>x==="CALL"?T.accent:x==="PUT"?T.red:T.muted;
  return <div style={{background:T.surface,borderRadius:8,border:`1px solid ${a.authorized?T.accent:a.conflict?T.red:T.yellow}55`,margin:"0 14px 8px",padding:12}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:9}}>
      <div><div style={{fontSize:9,color:T.muted,letterSpacing:"0.12em"}}>MULTI-TIMEFRAME TRADE STACK</div><div style={{fontSize:8,color:T.muted,marginTop:2}}>Higher contracts are shadow-marked every tick; their P/L and expansion feed the faster layer.</div></div>
      <div style={{textAlign:"right"}}><div style={{fontSize:12,fontWeight:800,color:a.authorized?T.accent:a.conflict?T.red:T.yellow}}>{a.riskMode||"WARMING UP"}</div><div style={{fontSize:7,color:T.muted}}>{a.higherAgree||0}/3 higher layers aligned</div></div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,minmax(0,1fr))",gap:7}}>{layers.map(x=>{
      const c=x.contract,p=x.pnlPct||0,r=x.expansionRate||0;
      return <div key={x.key} style={{background:T.surface2,borderRadius:6,padding:"8px 9px",borderTop:`2px solid ${sideColor(x.direction)}`}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:5}}><span style={{fontSize:8,fontWeight:800,color:sideColor(x.direction)}}>{x.label} {x.direction}</span><span style={{fontSize:7,color:T.muted}}>{x.horizon}</span></div>
        <div style={{fontSize:16,fontWeight:800,color:sideColor(x.direction),margin:"4px 0"}}>{x.confidence}%</div>
        {c?<><div style={{fontSize:9,color:T.text}}>{c.strike}{c.side==="CALL"?"C":"P"} <span style={{color:T.muted}}>from ${c.entry.toFixed(2)}</span></div><div style={{display:"flex",justifyContent:"space-between",marginTop:4}}><span style={{fontSize:8,color:p>=0?T.accent:T.red}}>P/L {p>=0?"+":""}{p.toFixed(1)}%</span><span style={{fontSize:8,color:r>=0?T.accent:T.red}}>{r>=0?"EXPAND":"CONTRACT"} {r>=0?"+":""}{r.toFixed(2)}/t</span></div></>:<div style={{fontSize:8,color:T.muted}}>No contract selected</div>}
        <div style={{fontSize:6,color:T.muted,marginTop:5,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}} title={x.reason}>{x.reason}</div>
      </div>})}</div>
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
  const synth=chain.quoteSource==="SYNTHETIC_CALIBRATED";
  const calls=chain.calls.filter(o=>(synth?o.strike>=chain.spot-0.25:o.strike>chain.spot)&&o.price<=(synth?1.50:0.50)&&o.price>=0.12).sort((a,b)=>Math.abs(a.price-0.20)-Math.abs(b.price-0.20)||a.distance-b.distance).slice(0,6);
  const puts=chain.puts.filter(o=>(synth?o.strike<=chain.spot+0.25:o.strike<chain.spot)&&o.price<=(synth?1.50:0.50)&&o.price>=0.12).sort((a,b)=>Math.abs(a.price-0.20)-Math.abs(b.price-0.20)||a.distance-b.distance).slice(0,6);
  const maxRows=Math.max(calls.length,puts.length);
  return <div style={{background:T.surface,borderRadius:8,border:`1px solid ${T.border}`,margin:"0 14px 8px",padding:12}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
      <span style={{fontSize:9,color:T.muted,letterSpacing:"0.1em"}}>REPLAY OPTION CHAIN</span>
      <span style={{fontSize:8,color:T.muted}}>SPY ${chain.spot.toFixed(2)}  |  IV {chain.iv.toFixed(1)}%  |  {chain.mL}m</span>
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
function updateMarketBrain(m,hist,prev,metacognition={},tradeMemory={}){
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
  // Correlated observations are grouped instead of counted as independent confirmations every tick.
  const bullLeadership=Math.max(Math.max(0,spx3)/1.4,Math.max(0,spy3)/1.4)+directionalAgreement*.18;
  const bearLeadership=Math.max(Math.max(0,-spx3)/1.4,Math.max(0,-spy3)/1.4)+directionalAgreement*.18;
  const bullLocation=Math.max(aboveFep,aboveFlip)*.85;
  const bearLocation=Math.max(belowFep,belowFlip)*.85;
  const bullishInputs=clamp(bullLeadership+Math.max(0,m.callDom-.5)*2+bullLocation+Math.min(.55,sessionUp),0,3.2);
  const bearishInputs=clamp(bearLeadership+Math.max(0,.5-m.callDom)*2+bearLocation+Math.min(.55,sessionDown),0,3.2);
  const effort=Math.max(.1,acc/10),upEfficiency=clamp(Math.max(0,d3)/(effort*1.5),0,1),downEfficiency=clamp(Math.max(0,-d3)/(effort*1.5),0,1);
  const bullResponse=clamp(upEfficiency+aboveQuality*.7,0,1.7),bearResponse=clamp(downEfficiency+belowQuality*.7,0,1.7);
  b.bullResponse=smooth(b.bullResponse,bullResponse,.25);b.bearResponse=smooth(b.bearResponse,bearResponse,.25);
  const highRejectPressure=highProximity*clamp((.35-upProgress)+Math.max(0,-d3)/Math.max(.5,span),0,1);
  const lowRejectPressure=lowProximity*clamp((.35-downProgress)+Math.max(0,d3)/Math.max(.5,span),0,1);
  b.highPressure=smooth(b.highPressure,highRejectPressure,.18);b.lowPressure=smooth(b.lowPressure,lowRejectPressure,.18);
  const bullFailure=clamp(bullishInputs/2.2-b.bullResponse*.55,0,1);
  const bearFailure=clamp(bearishInputs/2.2-b.bearResponse*.55,0,1);
  const expectationFailures=metacognition?.expectationFailures||{};
  const lastExit=tradeMemory?.lastExit||null;
  const callFailurePenalty=Math.min(32,(expectationFailures.CALL||0)*8)+(lastExit?.side==="CALL"&&lastExit?.postStopState==="THESIS_INVALIDATED"?8:0);
  const putFailurePenalty=Math.min(32,(expectationFailures.PUT||0)*8)+(lastExit?.side==="PUT"&&lastExit?.postStopState==="THESIS_INVALIDATED"?8:0);
  const bearishTransfer=(callFailurePenalty>0&&d3<0&&belowFep>=.5&&downConfirm>.18)?Math.min(18,callFailurePenalty*.55):0;
  const bullishTransfer=(putFailurePenalty>0&&d3>0&&aboveFep>=.5&&upConfirm>.18)?Math.min(18,putFailurePenalty*.55):0;
  const bullRaw=clamp(15+bullishInputs*16+b.aboveFlipQuality*20+b.lowPressure*12+bearFailure*12-b.highPressure*12-b.belowFlipQuality*14-callFailurePenalty+bullishTransfer,0,95);
  const bearRaw=clamp(15+bearishInputs*16+b.belowFlipQuality*20+b.highPressure*12+bullFailure*12-b.lowPressure*12-b.aboveFlipQuality*14-putFailurePenalty+bearishTransfer,0,95);
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
  b.summary=`${b.active} ${b.confidence}% | bullP ${b.bullPressure.toFixed(0)} bearP ${b.bearPressure.toFixed(0)} | session ${sessionMove>=0?"+":""}${sessionMove.toFixed(2)} | ITS3 SPX ${spx3>=0?"+":""}${spx3.toFixed(2)} SPY ${spy3>=0?"+":""}${spy3.toFixed(2)} | highP ${b.highPressure.toFixed(2)} lowP ${b.lowPressure.toFixed(2)} | aboveQ ${b.aboveFlipQuality.toFixed(2)} belowQ ${b.belowFlipQuality.toFixed(2)} | bullResp ${b.bullResponse.toFixed(2)} bearResp ${b.bearResponse.toFixed(2)} | failures C${expectationFailures.CALL||0}/P${expectationFailures.PUT||0} penalties C${callFailurePenalty.toFixed(0)}/P${putFailurePenalty.toFixed(0)} transfers bull${bullishTransfer.toFixed(0)}/bear${bearishTransfer.toFixed(0)} | ${b.actualResponse}`;
  return b;
}
function brainPrompt(b){return `SESSION PRESSURE LENS (EVIDENCE ONLY - NOT A VETO OR HIGHER AUTHORITY)\n${b.summary}\nEXPECTED: ${b.expectedResponse}\nINVALIDATION: ${b.invalidation}\nPRESSURE WINDOW: ${b.entryReady?b.entrySide+" ALIGNED for "+b.readyTicks+" ticks - "+b.entryReason:"NOT YET ALIGNED - "+b.entryReason}\nThis lens is one contextual input. It must never override unified canonical intent or AI execution authority by itself. Interpret structure continuously and do not invent extra confirmation after the full hierarchy is executable.`;}

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
  const[aiSessionMemory,setAiSessionMemory]=useState(()=>createAiSessionMemory());
  const[traderLearning,setTraderLearning]=useState({pipelineVersion:2,items:[]});
  const[liveThought,setLiveThought]=useState("");
  const[thoughtSync,setThoughtSync]=useState("LOCAL");
  const[qaReports,setQaReports]=useState(()=>storageGet("qa_reports",[]).slice(-20));
  const[qaStatus,setQaStatus]=useState("WATCHING");
  const[qaFolder,setQaFolder]=useState("Browser storage only");
  const[candles,setCandles]=useState([]);
  const[itsSPXHist,setItsSPXHist]=useState([]);
  const[itsSPYHist,setItsSPYHist]=useState([]);
  const[confHist,setConfHist]=useState([]);
  const[optionChain,setOptionChain]=useState(null);
  const[probs,setProbs]=useState({discovery:25,pin:25,transition:25,macro:25});
  const[alphaRegime,setAlphaRegime]=useState(()=>createAlphaRegimeState().active);
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
  const[selectedReplayDate,setSelectedReplayDate]=useState(AVAILABLE_REPLAY_DATES[0]||"2026-07-06");
  const[replayLoading,setReplayLoading]=useState(false);
  const[replayLoadError,setReplayLoadError]=useState("");
  const[chopGate,setChopGate]=useState("OFF");
  const[multiTimeframe,setMultiTimeframe]=useState(()=>createMultiTimeframeState());

  const engR=useRef(null),balR=useRef(STARTING_BALANCE),posR=useRef(null),catastrophicStopR=useRef(false);
  const logR=useRef([]),candR=useRef([]),mindR=useRef([]),tlR=useRef([]);
  const journalR=useRef([]),aiSessionMemoryR=useRef(createAiSessionMemory()),probR=useRef({discovery:25,pin:25,transition:25,macro:25});
  const contextMemoryR=useRef(createContextMemory());
  const premarketContextR=useRef(null);
  const alphaRegimeR=useRef(createAlphaRegimeState());
  const multiTimeframeR=useRef(createMultiTimeframeState());
  const thoughtSessionIdR=useRef(`firstsignal-sim-v1-${Date.now()}-${Math.random().toString(36).slice(2,8)}`);
  const cognitionQueueR=useRef([]),cognitionRunningR=useRef(false),cognitionSeqR=useRef(0);
  const metacognitionR=useRef(createMetacognitionState());
  const dataHealthR=useRef({state:"UNKNOWN"}),transmissionR=useRef({state:"UNKNOWN",failedTicks:0}),lastCognitionStateR=useRef(null);
  const saveSessionRef=useRef(null),finalizingR=useRef(false);
  const eventPostChainR=useRef(Promise.resolve()),eventPostErrorR=useRef(null),eventSnapshotsR=useRef([]),eventCommittedTicksR=useRef(new Set());
  const campaignStartRef=useRef(null),campaignCommandR=useRef(null),decisionCoreR=useRef(createDeterministicDecisionState());
  const qaLastTickR=useRef(-99),qaBusyR=useRef(false);
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

  const addM=useCallback(e=>{const clean={...e,mindset:cleanUiText(e?.mindset),reasoning:cleanUiText(e?.reasoning),decision:cleanUiText(e?.decision),edgeState:cleanUiText(e?.edgeState)};const key=`${clean.edgeState}|${clean.decision}|${clean.mindset}|${clean.reasoning.slice(0,80)}`;if(clean.edgeState.startsWith('LOCAL')&&key===lastMindsetKeyR.current)return;lastMindsetKeyR.current=key;mindR.current=[...mindR.current.slice(-100),clean];setMindsetLog([...mindR.current]);},[]);
  const addJournal=useCallback((t,entry)=>{journalR.current=[...journalR.current.slice(-50),{t:cleanUiText(t),entry:cleanUiText(entry)}];setJournal([...journalR.current]);},[]);

  useEffect(()=>{let alive=true;loadThoughts().then(rows=>{if(!alive)return;const cleanRows=(rows||[]).filter(r=>!String(r.content||"").toLowerCase().includes("ai response failed"));storageSet("ai_thought_archive",cleanRows.slice(-200));setThoughtSync("SYNCED");}).catch(()=>setThoughtSync("LOCAL"));return()=>{alive=false;};},[]);
  useEffect(()=>{let alive=true;loadTraderLearning().then(packet=>{if(alive)setTraderLearning(packet);});return()=>{alive=false;};},[]);
  useEffect(()=>{if(!running)return;let alive=true;loadTraderLearning().then(packet=>{if(alive)setTraderLearning(packet);});return()=>{alive=false;};},[running,sessionLabel]);
  useEffect(()=>{let alive=true;const poll=()=>fetch(`${AGENT_BASE}/status`).then(r=>r.json()).then(x=>{if(!alive)return;setQaFolder(x.settings?.reportFolder||"Agent service connected");setQaStatus(x.status?.state||"WATCHING");if(x.reports)setQaReports(x.reports.slice(-20));}).catch(()=>alive&&setQaStatus("OFFLINE: START AGENT CONSOLE"));poll();const id=setInterval(poll,1000);return()=>{alive=false;clearInterval(id);};},[]);

  useEffect(()=>{
    const handler=()=>{if(engR.current&&!done){storageSet("interrupted",{bal:balR.current,pos:posR.current,log:logR.current,candles:candR.current.slice(-50),mindset:mindR.current.slice(-20),journal:journalR.current,aiSessionMemory:aiSessionMemoryR.current,timeline:tlR.current,sessionLabel,sessionMode,replayDate:selectedReplayDate,tick:tickR.current,archetypeId:archetypeIdR.current});}}
    window.addEventListener("beforeunload",handler);return()=>window.removeEventListener("beforeunload",handler);
  },[done,sessionLabel,sessionMode,selectedReplayDate]);

  const drainCognition=useCallback(()=>{
    if(finalizingR.current||cognitionRunningR.current||thinkR.current||activeDecisionR.current||!cognitionQueueR.current.length)return;
    const batch=cognitionQueueR.current.splice(0,cognitionQueueR.current.length);
    const latest=batch.at(-1);
    if(!latest)return;
    cognitionRunningR.current=true;
    aiFreezeR.current=true;
    setLiveThought(`Reading and committing cognition for tick ${latest.tick}...`);
    const memory=aiMemoryText(aiSessionMemoryR.current,{recentEntries:30});
    const authoritative=authoritativeStateText(latest.market,posR.current,balR.current,tradeMemoryR.current);
    const campaign=buildCampaignState(latest.market,candR.current,tradeMemoryR.current,metacognitionR.current);
    const wholeDay=`WHOLE-DAY STRUCTURED CONTEXT
Campaign: ${JSON.stringify(campaign)}
FEP occupancy: ${aboveFepTotalR.current} above / ${belowFepTotalR.current} below
MarketBrain: ${marketBrainR.current.summary}
Session pattern counts: ${JSON.stringify(sessionModelR.current)}
Trade memory: ${JSON.stringify(tradeMemoryR.current)}`;
    const lines=batch.map(x=>`tick ${x.tick} | ${x.t} | DATA ${x.dataState||"UNKNOWN"} TRANSMISSION ${x.transmissionState||"UNKNOWN"} | SPY ${x.spy.toFixed(2)} SPX ${x.spx.toFixed(2)} | SPX ITS ${x.itsSPX.toFixed(2)} base ${x.spxItsBase.toFixed(2)} local ${x.spxItsLocal>=0?"+":""}${x.spxItsLocal.toFixed(2)} | SPY ITS ${x.itsSPY.toFixed(2)} base ${x.spyItsBase.toFixed(2)} local ${x.spyItsLocal>=0?"+":""}${x.spyItsLocal.toFixed(2)} | ITS gap ${x.gap>=0?"+":""}${x.gap.toFixed(2)} | FEP distance SPX ${x.spxFepGap>=0?"+":""}${x.spxFepGap.toFixed(1)} / SPY ${x.fepGap>=0?"+":""}${x.fepGap.toFixed(2)} | FEP disagreement ${x.fepDisagreement>=0?"+":""}${x.fepDisagreement.toFixed(2)} | ${x.rubberInterpretation} | GEX ${fmt.gex(x.spxGex)} walls ${x.putWall.toFixed(1)}/${x.callWall.toFixed(1)} intent ${x.intent} ${x.readiness}% local ${x.local} structural ${x.structural}${x.position?` position ${x.position}`:""}`).join("\n");
    const providerRuntime=geminiLiveTrader.runtimeStatus?.()||{};
    const providerAuthority=providerRuntime.state==="CONNECTED"&&!providerRuntime.circuitOpen?"PROVIDER STATUS: CONNECTED AND HEALTHY. Any earlier transient provider failure is historical and cannot remain an execution or integrity lock.":`PROVIDER STATUS: ${providerRuntime.state||"UNKNOWN"}.`;
    const prompt=`CONTINUOUS_TICK_BATCH ${++cognitionSeqR.current}\n${providerAuthority}\nSIMULATION TEMPORAL CONTEXT: each row is exactly one simulated 20-second market tick. Wall-clock arrival speed is not market information. This batch is background interpretation only and cannot execute trades. Source ticks ${batch[0]?.tick}-${latest.tick}; if the market has advanced when this resolves, preserve only durable context and never imply execution eligibility.\nDATA HEALTH GROUNDING: the deterministic DATA field on each row is authoritative. Never declare a frozen, stale, corrupt, or invalid feed when the latest row says DATA_HEALTHY. Do not infer staleness merely because rounded values repeat; SPX is supplied to cents. If continuity prose conflicts with current DATA or current ticks, discard the prose as historical.\nRead every ordered tick and the private journal. This is background cognition only. Call record_tick_reflection once. First determine the active campaign, its maturity, and remaining opportunity from WHOLE-DAY STRUCTURED CONTEXT. Keep thought_append empty unless a causal inference, campaign-stage change, failed-leg update, expectation revision, contradiction, or self-correction is genuinely new. Never narrate WAIT/PREPARE gates, repeat prior wording, or issue a trade through this channel.\n\nSTRUCTURED CONTINUITY:\n${memory}\n\n${authoritative}\n\n${wholeDay}\n\nTICKS:\n${lines}`;
    let cognitionFailed=false;
    const requestObservationWithRecovery=async()=>{
      let lastError=null;
      for(let attempt=1;attempt<=3;attempt++){
        try{return await geminiLiveTrader.requestObservation(prompt);}
        catch(error){
          lastError=error;
          const message=String(error?.message||error);
          addJournal(latest.t,`AI_COGNITION_RETRY ${attempt}/3 tick ${latest.tick}: ${message}. Simulation remains paused until this tick is understood.`);
          if(attempt<3)await new Promise(resolve=>setTimeout(resolve,1000));
        }
      }
      throw lastError||new Error("COGNITION_FAILED_AFTER_RETRIES");
    };
    requestObservationWithRecovery().then(async obs=>{
      const integrity=observationIntegrity(obs);
      if(!integrity.ok){addJournal(latest.t,`AI_OBSERVATION_REJECTED ${integrity.reason}; malformed provider output was not committed to Trader memory.`);fetch(`${AGENT_BASE}/session/finalization-diagnostic`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:thoughtSessionIdR.current,replayDate:selectedReplayDate,phase:'MALFORMED_OBSERVATION',marketTime:latest.t,tick:latest.tick,reason:integrity.reason,rawObservation:obs})}).catch(()=>{});return;}
      const thought=sanitizeCognitionText(obs?.thought_append||obs?.thesis_delta||"");
      const spxValues=batch.map(x=>Number(x.spx)).filter(Number.isFinite);
      const spxRange=spxValues.length?Math.max(...spxValues)-Math.min(...spxValues):0;
      const falseFreezeClaim=/SPX.{0,40}(?:frozen|freeze|static|stale)|(?:frozen|freeze|static|stale).{0,40}SPX/i.test(thought);
      const languageLoop=/(flat\.?\s*){3,}|(?:forecasting\s+(?:higher|lower|flat)\s+definition\.?){2,}|(\w{3,})(?:[\s.,]+){3,}/i.test(thought);
      if(falseFreezeClaim&&latest.dataState==="DATA_HEALTHY"&&spxRange>=0.05){addJournal(latest.t,`AI_OBSERVATION_REJECTED FALSE_SPX_FREEZE_CLAIM range:${spxRange.toFixed(2)} data:${latest.dataState}; provider prose was not committed.`);return;}
      if(languageLoop){addJournal(latest.t,"AI_OBSERVATION_REJECTED REPETITIVE_LANGUAGE_LOOP; provider prose was not committed to session memory.");return;}
      const cognitionState={decision:"OBSERVE",edge_state:obs?.urgency||"NONE",confidence_trend:obs?.confidence_trend||"UNCLEAR",coherence_check:obs?.coherence_check||"COHERENT",current_thesis:obs?.current_thesis||"",expected_next_path:obs?.expected_next_path||"",trade_confidence:obs?.confidence||0,transmission_state:latest.transmissionState||"UNKNOWN",data_state:latest.dataState||"UNKNOWN"};
      if(!thought||!shouldEmitCognition(lastCognitionStateR.current,cognitionState))return;
      lastCognitionStateR.current=cognitionState;
      aiSessionMemoryR.current=appendAiObservationMemory(aiSessionMemoryR.current,obs,latest.market,latest.t);
      storageSet("ai_session_memory",aiSessionMemoryR.current);
      setAiSessionMemory({...aiSessionMemoryR.current});
      setThoughtSync("SAVING");
      try{
        await persistThought({session_id:thoughtSessionIdR.current,market_time:latest.t,kind:"tick_reflection",content:thought,decision:"OBSERVE",spot:latest.spy,metadata:{thesis:obs.current_thesis||"",expected_next_path:obs.expected_next_path||"",urgency:obs.urgency||"NONE",batch_ticks:batch.length,requestedAtTick:batch[0]?.tick,resolvedAtTick:tickR.current,appliedAtTick:latest.tick,status:"COMMITTED_BEFORE_NEXT_TICK",executionEligible:false}});
        setThoughtSync("SYNCED");
      }catch{
        setThoughtSync("LOCAL");
        throw new Error("THOUGHT_JOURNAL_COMMIT_FAILED");
      }
      if(obs.noteworthy)addJournal(latest.t,`AI_TICK_REFLECTION ${obs.urgency||"NONE"}: ${thought}`);
    }).catch(error=>{
      cognitionFailed=true;
      cognitionQueueR.current=[...batch,...cognitionQueueR.current];
      setRunning(false);
      setLiveThought(`COGNITION BLOCKED at tick ${latest.tick}`);
      addJournal(latest.t,`COGNITION_BLOCKED tick ${latest.tick}: ${String(error?.message||error)}. Run halted before the next market tick; unresolved cognition was re-queued.`);
    }).finally(()=>{
      cognitionRunningR.current=false;
      if(!cognitionFailed){
        aiFreezeR.current=false;
        setLiveThought("");
        if(!finalizingR.current&&cognitionQueueR.current.length&&!thinkR.current&&!activeDecisionR.current)setTimeout(()=>drainCognition(),0);
      }
    });
  },[addJournal]);

  useEffect(()=>{
    if(running&&aiFreezeR.current&&!cognitionRunningR.current&&cognitionQueueR.current.length&&!thinkR.current&&!activeDecisionR.current)drainCognition();
  },[running,drainCognition]);

  const resetPostExitState=useCallback((reason,market)=>{
  const active=activeDecisionR.current;
  if(active){active.cancelled=true;active.controller?.abort(`POSITION_CLOSED_${reason}`);clearTimeout(active.timeoutId);}
  activeDecisionR.current=null;cognitionQueueR.current=[];cognitionRunningR.current=false;
  thinkR.current=false;aiFreezeR.current=false;
  const flatIntent={action:"WAIT",direction:null,setupQuality:0,executionReadiness:0,readiness:0,confidence:0,contract:null,blockers:[`POSITION_CLOSED_${reason}`],supportingFactors:["No open position"],source:"POST_EXIT_RESET",positionMode:false,episodeKey:null,resetTick:tickR.current};
  tradeIntentR.current=flatIntent;setTradeIntentData(flatIntent);
  aiSessionMemoryR.current={...aiSessionMemoryR.current,summary:`FLAT after ${reason}. Prior active-position instructions are closed historical context.`,dominantThesis:"NO ACTIVE POSITION",competingThesis:"Assess next independent setup",expectedPath:"Wait for fresh causal ignition",invalidation:"NONE WHILE FLAT",unresolved:"What new evidence creates the next independent setup?",lastDecision:"EXIT_COMPLETED",lastTime:market?fmt.time(market.h,market.m):"POST-EXIT"};
  storageSet("ai_session_memory",aiSessionMemoryR.current);setAiSessionMemory({...aiSessionMemoryR.current});
  setThinking(false);setLiveThought("");repeatWaitR.current=0;lastWaitReasonR.current="";lastMeaningfulAiKeyR.current="";
  addM({t:market?fmt.time(market.h,market.m):"POST-EXIT",mindset:"flat after exit",reasoning:`Canonical position is flat after ${reason}. All prior HOLD/SELL cognition is historical only.`,decision:"WAIT",score:0,edgeState:"FLAT_SYNCED",confTrend:"RESET"});
  if(market)addJournal(fmt.time(market.h,market.m),`POST_EXIT_STATE_RESET ${reason}: position, intent, pending decision, and queued cognition cleared atomically.`);
},[addJournal]);

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
    const commitCurrentTick=()=>{
      const tick=tickR.current;
      if(tick<1||tick>1216||eventCommittedTicksR.current.has(tick))return;
      const qaSnapshot={sessionId:thoughtSessionIdR.current,productName:PRODUCT_NAME,productVersion:PRODUCT_VERSION,buildId:BUILD_ID,buildSequence:BUILD_SEQUENCE,sessionLabel,sessionMode,replayDate:selectedReplayDate,tick,time:fmt.time(m.h,m.m,m.s||0),running:true,balance:balR.current,position:posR.current?{side:posR.current.isCall?"CALL":"PUT",strike:posR.current.strike,entry:posR.current.entry,current:posR.current.current,entryTick:posR.current.entryTick,entrySpot:posR.current.entrySpot,currentSpot:m.spySpot}:null,market:{spy:m.spySpot,spx:m.spxSpot,gexSpy:m.netGex,gexSpx:m.netGexSpx,itsSPX:m.itsSPX,itsSPY:m.itsSPY,accelerator:m.accelerator,fep:m.fep,quoteSource:m.quoteSource||"MODELED",marketSource:m.marketSource||"UNKNOWN",synthData:!!m.synthData},intent:tradeIntentR.current,dataHealth:dataHealthR.current,transmission:transmissionR.current,reliability:reliabilityRates(reliabilityR.current),recentTrades:logR.current.slice(-4),recentJournal:journalR.current.slice(-8),recentMindset:mindR.current.slice(-5)};
      eventCommittedTicksR.current.add(tick);
      eventSnapshotsR.current.push(qaSnapshot);
      eventPostChainR.current=eventPostChainR.current.then(async()=>{
        let lastError=null;
        for(let attempt=1;attempt<=5;attempt++){
          try{const resp=await fetch(`${AGENT_BASE}/event`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(qaSnapshot)});if(resp.ok)return;}catch(e){lastError=e;}
          await new Promise(r=>setTimeout(r,attempt*80));
        }
        throw lastError||new Error(`EVENT_POST_FAILED_TICK_${qaSnapshot.tick}`);
      }).catch(e=>{eventPostErrorR.current=e;if(tick===1||tick%100===0)addJournal(fmt.time(m.h,m.m,m.s||0),`OBSERVER_EVENT_POST_SKIPPED tick ${tick}: optional observer service unavailable; replay continues.`);});
    };
    const pauseForCatastrophicEquity=equity=>{
      if(Number(equity)>CATASTROPHIC_EQUITY_FLOOR)return false;
      balR.current=Number(equity);setBal(Number(equity));
      if(!catastrophicStopR.current){
        catastrophicStopR.current=true;
        addJournal(fmt.time(m.h,m.m,m.s||0),`CATASTROPHIC_EQUITY_STOP: equity ${fmt.bal(Number(equity))} reached the 60% floor (${fmt.bal(CATASTROPHIC_EQUITY_FLOOR)}). Replay paused.`);
      }
      setRunning(false);clearInterval(ivR.current);commitCurrentTick();return true;
    };
    if(pauseForCatastrophicEquity(balR.current))return;
    const mL=(SESSION_END_H*60+SESSION_END_M)-(m.h*60+m.m);
    const octx=optionCtx(m,candR.current,optionMemoryR.current);
    const chain=m.optionChain?.calls?.length?m.optionChain:buildOptionChain(m.spySpot,m.iv,mL,80,octx);setOptionChain(chain);
    aiVetoAuditsR.current=updateVetoAudits(aiVetoAuditsR.current,chain,m,tickR.current,msg=>addJournal(fmt.time(m.h,m.m,m.s||0),msg));
    if(posR.current&&m.isTradeable){
      const p0=posR.current;
      let attr=optionPnlAttribution(p0,m,mL,octx);
      const liveQuote=(p0.isCall?chain.calls:chain.puts).find(q=>q.strike===p0.strike);
      if(liveQuote){const livePrice=Number(liveQuote.bid??liveQuote.mark??liveQuote.price);if(Number.isFinite(livePrice)&&livePrice>0)attr={...attr,price:livePrice,quoteSource:liveQuote.quoteSource||chain.quoteSource||"MODELED"};}
      const peakPrice=Math.max(p0.peakPrice||p0.entry,attr.price);
      const peakPnl=(peakPrice/p0.entry-1)*100;
      const maxFavorableSpot=p0.isCall?Math.max(p0.maxFavorableSpot??p0.entrySpot,m.spySpot):Math.min(p0.maxFavorableSpot??p0.entrySpot,m.spySpot);
      const maxAdverseSpot=p0.isCall?Math.min(p0.maxAdverseSpot??p0.entrySpot,m.spySpot):Math.max(p0.maxAdverseSpot??p0.entrySpot,m.spySpot);
      posR.current={...p0,current:attr.price,peakPrice,peakPnl,lastSpot:m.spySpot,lastIv:m.iv,lastAttribution:attr,maxFavorableSpot,maxAdverseSpot,contractHistory:[...(p0.contractHistory||[]),attr.price].slice(-30)};
      setPos({...posR.current});
      let p=posR.current; let size=p.remainingSize??p.size??balR.current; const optPnl=(p.current/p.entry-1)*100;
      const liveEquity=(p.cashReserve||0)+size*(p.current/p.entry);
      balR.current=liveEquity;setBal(liveEquity);
      if(pauseForCatastrophicEquity(liveEquity))return;
      const side=p.isCall?"CALL":"PUT",dir=p.isCall?1:-1;
      const heldTicks=tickR.current-(p.entryTick??tickR.current);
      const microCfg=p.microHarvest?.active?p.microHarvest:null;
      const microExpired=!!microCfg&&heldTicks>=Number(microCfg.maxHoldTicks||15);
      const microFast=multiTimeframeR.current?.layers?.harvest;
      const microExecution=multiTimeframeR.current?.layers?.execution;
      const microSideLost=!!microCfg&&heldTicks>=2&&((microFast?.direction&&microFast.direction!==side)||(microExecution?.direction&&microExecution.direction!==side));
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
      const thesisHealth=evaluateThesisContract(p,m,chain,brainNow,th,thesisR.current?.contextHierarchy);
      const pm=updateDeterministicPositionManager(p,m,candR.current,{remainingOpportunity:tradeIntentR.current?.diagnostics?.v14?.remainingOpportunity??tradeIntentR.current?.diagnostics?.v15?.remainingOpportunity,thesisSupport:thesisHealth.support,oppositeCount});
      if(pm){
        posR.current={...p,positionManager:pm,positionStage:pm.stage,holdConfidence:pm.holdConfidence,positionOpportunityRemaining:pm.positionOpportunityRemaining,convexityRemaining:pm.convexityRemaining};
        if(pm.scalePct>0&&pm.targetExposure>0){
          const original=Number(posR.current.originalSize||posR.current.size||size),sellAmount=Math.min(size,original*pm.scalePct/100);
          if(sellAmount>0.01){
            const proceeds=sellAmount*(p.current/p.entry),realizedPnl=sellAmount*(p.current/p.entry-1);
            const remaining=Math.max(0,size-sellAmount),cash=(posR.current.cashReserve||0)+proceeds;
            posR.current={...posR.current,remainingSize:remaining,cashReserve:cash,exposurePct:pm.targetExposure,scaleCount:(posR.current.scaleCount||0)+1,lastScaleTick:tickR.current};
            p=posR.current;size=remaining;
            const equity=cash+remaining*(p.current/p.entry);balR.current=equity;setBal(equity);setPos({...p});
            logR.current=[...logR.current,{t:fmt.time(m.h,m.m,m.s||0),action:`SCALE-OUT ${pm.scalePct}% ORIGINAL | ${p.strike}${p.isCall?"C":"P"} @$${p.current.toFixed(2)} | ${pm.stage}`,result:`realized ${realizedPnl>=0?"+":""}${fmt.bal(realizedPnl)} | ${pm.targetExposure}% remains`,pnl:optPnl,dollarPnl:realizedPnl,exitType:"DETERMINISTIC_SCALE_OUT"}];setTradeLog([...logR.current]);
            addJournal(fmt.time(m.h,m.m,m.s||0),`POSITION_SCALE ${pm.scalePct}% -> ${pm.targetExposure}% exposure | ${pm.stage} | hold ${pm.holdConfidence}% | opportunity ${pm.positionOpportunityRemaining}% | convexity ${pm.convexityRemaining}% | ${pm.reason}.`);
          }
        }
      }
      const managerExit=pm?.targetExposure===0;
      const responsiveness=(Math.abs(attr.delta)||0)*(Math.abs(attr.spotMove)||0);
      const maxLossExit=optPnl<=-(p.maxLossPct??14);
      const vehicleFailure=optPnl<=-(p.vehicleFailurePct??38)&&(spotProgress<0.15||responsiveness<0.01);
      const catastrophicLoss=optPnl<=-(p.catastrophicLossPct??50);
      const signalExit=heldTicks>=SIGNAL_EXIT_MIN_HOLD_TICKS&&oppositeCount>=3;
      const trailingProfit=peakPnl>=70&&(peakPnl-optPnl)>=Math.max(28,peakPnl*0.42)&&heldTicks>=6&&Number(p.exposurePct??100)>=100;
      const spotTarget=spotTargetRaw&&optPnl>0&&heldTicks>=5&&Number(p.exposurePct??100)>=100;
      setBal((p.cashReserve||0)+size*(p.current/p.entry));
      if(Math.abs(attr.price-p0.current)>=0.03||Math.abs(attr.spotMove)>=0.15||attr.residualCapped){
        addJournal(fmt.time(m.h,m.m,m.s||0),`OPTION_ATTR ${p.strike}${p.isCall?"C":"P"} ${p0.current.toFixed(2)} -> ${attr.price.toFixed(2)} | spot ${attr.spotContribution>=0?"+":""}${attr.spotContribution.toFixed(3)} | gamma ${attr.gammaContribution>=0?"+":""}${attr.gammaContribution.toFixed(3)} | theta ${attr.thetaContribution.toFixed(3)} | IV ${attr.ivContribution>=0?"+":""}${attr.ivContribution.toFixed(3)} | momentum-vol ${attr.momentumVolContribution>=0?"+":""}${attr.momentumVolContribution.toFixed(3)} | compression ${attr.compressionContribution.toFixed(3)} | residual ${attr.residual>=0?"+":""}${attr.residual.toFixed(3)}${attr.residualCapped?" CAPPED":""}.`);
      }
      if(!managerExit&&!microExpired&&!microSideLost&&!spotFail&&!maxLossExit&&!vehicleFailure&&!catastrophicLoss&&!thesisHealth.hard&&!thesisHealth.softExit&&!signalExit&&!trailingProfit&&!spotTarget&&(oppositeCount>0||thesisHealth.invalidations.length)){
        addJournal(fmt.time(m.h,m.m,m.s||0),`POSITION_REVIEW ${side} opposite ${oppositeCount}/5, held ${heldTicks}, progress ${spotProgress>=0?"+":""}${spotProgress.toFixed(2)}, option ${fmt.pct(optPnl)}, thesis invalidations ${thesisHealth.invalidations.map(x=>x.key).join(",")||"NONE"}; support ${thesisHealth.support}/5; expectedLate ${thesisHealth.expectedLate}.`);
      }
      if(managerExit||microExpired||microSideLost||spotFail||maxLossExit||vehicleFailure||catastrophicLoss||thesisHealth.hard||thesisHealth.softExit||signalExit||trailingProfit||spotTarget){
        const finalEquity=(p.cashReserve||0)+size*(p.current/p.entry); const dollar=finalEquity-(p.originalSize||p.size||finalEquity);balR.current=finalEquity;
        const why=managerExit?'POSITION_HOLD_EV_EXIT':microExpired?'MICRO_HARVEST_TIMEBOX':microSideLost?'MICRO_HARVEST_EDGE_LOST':spotFail?'SPOT_INVALIDATION':maxLossExit?'MAX_LOSS_LIMIT':vehicleFailure?'VEHICLE_FAILURE':catastrophicLoss?'CATASTROPHIC_FLOOR':thesisHealth.hard?'THESIS_INVALIDATED_'+thesisHealth.invalidations.map(x=>x.key).join('+'):thesisHealth.softExit?'THESIS_DECAY_'+thesisHealth.invalidations.map(x=>x.key).join('+'):trailingProfit?'TRAILING_PROFIT':spotTarget?'SPOT_TARGET_PROFIT':`CONFIRMED_OPPOSITE_CONTROL_${oppositeCount}`;
        logR.current=[...logR.current,{t:fmt.time(m.h,m.m,m.s||0),action:`THESIS-EXIT ${p.strike}${p.isCall?"C":"P"} @$${p.current.toFixed(2)} ${why}`,result:`${fmt.pct(optPnl)} (${dollar>=0?"+":""}${fmt.bal(dollar)})`,pnl:optPnl,dollarPnl:dollar,exitType:why,entrySpot:p.entrySpot,exitSpot:m.spySpot}];
        tradeMemoryR.current=recordTradeOutcome(tradeMemoryR.current,p,m,optPnl,why,tickR.current);
        const postStop=tradeMemoryR.current.lastExit;
        addJournal(fmt.time(m.h,m.m,m.s||0),`POST_STOP_THESIS ${postStop.postStopState} | ${postStop.side} progress ${postStop.progress>=0?"+":""}${postStop.progress.toFixed(2)} | core ${postStop.coreHealthAtExit?"HEALTHY":"FAILED"} | next standard ${postStop.reentryStandard}.`);
        setTradeLog([...logR.current]);posR.current=null;setPos(null);leadWrongTicksR.current=0;setBal(balR.current);resetPostExitState(why,m);commitCurrentTick();return;
      }
      prevCallWallR.current=m.callWall;prevPutWallR.current=m.putWall;
    }
    const tradeCutoffPassed=(m.h*60+m.m)>=(TRADE_CUTOFF_H*60+TRADE_CUTOFF_M);
    if(posR.current&&tradeCutoffPassed){const p=posR.current,size=p.remainingSize??p.size??balR.current,r=(p.current/p.entry-1)*100;balR.current=(p.cashReserve||0)+size*(p.current/p.entry);const dollar=balR.current-(p.originalSize||p.size||balR.current);logR.current=[...logR.current,{t:fmt.time(15,45),action:`AUTO-CLOSE ${p.strike}${p.isCall?"C":"P"} ROBINHOOD 0DTE CUTOFF`,result:`${fmt.pct(r)} (${dollar>=0?"+":""}${fmt.bal(dollar)})`,pnl:r,dollarPnl:dollar,exitType:"DEFAULT_0DTE_CUTOFF_15_45"}];setTradeLog([...logR.current]);posR.current=null;setPos(null);setBal(balR.current);resetPostExitState("DEFAULT_0DTE_CUTOFF_15_45",m);addJournal(fmt.time(15,45),"DEFAULT 0DTE CUTOFF — position liquidated; market observation continues through 4:15 PM ET.");}
    if(m.h>SESSION_END_H||(m.h===SESSION_END_H&&m.m>=SESSION_END_M)){
      setBal(balR.current);setDone(true);setRunning(false);clearInterval(ivR.current);storageSet("interrupted",null);setTimeout(()=>saveSessionRef.current?.(),0);return;
    }
    setMkt(m);setBal(balR.current);setGexInf(m.gexInfluence||0.1);
    const c={t:fmt.time(m.h,m.m,m.s||0),spySpot:m.spySpot,spxSpot:m.spxSpot,itsSPX:m.itsSPX,itsSPY:m.itsSPY,accel:m.accelerator,rawAccel:m.rawAccelerator??m.accelerator,fep:m.fep,ndf:m.ndf,gexInf:m.gexInfluence||0.1,netGex:m.netGex,netGexSpx:m.netGexSpx,gammaFlip:m.gammaFlip,callWall:m.callWall,putWall:m.putWall,isOpen:m.h===OPEN_H&&m.m===OPEN_M,synthData:m.synthData||false,quoteSource:m.quoteSource||"UNKNOWN",marketSource:m.marketSource||"UNKNOWN"};
    candR.current=[...candR.current,c];setCandles([...candR.current]);
    pinHistR.current=[...pinHistR.current.slice(-14),m.gexInfluence||0.1];
    const side=m.spySpot>=m.gammaFlip?'ABOVE':'BELOW';
    if(lastFlipSideR.current&&side!==lastFlipSideR.current){const prior=flipCrossR.current.at(-1);if(prior&&tickR.current-prior.crossTick<=5&&!prior.failed)prior.failed=true;flipCrossR.current=[...flipCrossR.current.filter(x=>tickR.current-x.crossTick<=20),{crossTick:tickR.current,failed:false}];}lastFlipSideR.current=side;
    const failedRecent=flipCrossR.current.filter(x=>x.failed&&tickR.current-x.crossTick<=20).length;
    const pinRising=pinHistR.current.length>=15&&pinHistR.current.at(-1)>pinHistR.current[0];
    const holdSide=candR.current.slice(-10).length===10&&candR.current.slice(-10).every(x=>(x.spySpot>=m.gammaFlip)===(m.spySpot>=m.gammaFlip));
    const wallExpand=prevCallWallR.current!=null&&prevPutWallR.current!=null&&(m.callWall>prevCallWallR.current||m.putWall<prevPutWallR.current);
    let nextGate=chopGateR.current;if(nextGate==='OFF'&&((((m.gexInfluence||0)>=CHOP_PIN_ON)&&pinRising)||failedRecent>=3))nextGate='ON';else if((nextGate==='ON'&&(m.gexInfluence||0)<CHOP_PIN_OFF&&holdSide)||(nextGate==='ON'&&wallExpand))nextGate='OFF';
    if(nextGate!==chopGateR.current){chopGateR.current=nextGate;setChopGate(nextGate);addJournal(c.t,`CHOP_GATE ${nextGate} — pin ${((m.gexInfluence||0)*100).toFixed(0)}%, failed crosses ${failedRecent}, holdSide ${holdSide}, wallExpand ${wallExpand}.`);}prevCallWallR.current=m.callWall;prevPutWallR.current=m.putWall;
    const priorBrain=marketBrainR.current,nextBrain=updateMarketBrain(m,candR.current,priorBrain,metacognitionR.current,tradeMemoryR.current);marketBrainR.current=nextBrain;setMarketBrain(nextBrain);
    if(nextBrain.active!==priorBrain.active||Math.abs(nextBrain.bullPressure-priorBrain.bullPressure)>=8||Math.abs(nextBrain.bearPressure-priorBrain.bearPressure)>=8||(!priorBrain.entryReady&&nextBrain.entryReady))addJournal(c.t,`MARKET_BRAIN ${nextBrain.summary}${nextBrain.entryReady?` | ${nextBrain.entryReason}`:""}`);
    sessionTickData.current.push({tick:tickR.current,t:c.t,spySpot:m.spySpot,spxSpot:m.spxSpot,itsSPX:m.itsSPX,itsSPY:m.itsSPY,div:m.itsSPX-m.itsSPY,accel:m.accelerator,rawAccel:m.rawAccelerator??m.accelerator,fep:m.fep,ndf:m.ndf,iv:m.iv,gexInf:m.gexInfluence||0.1,netGex:m.netGex,conviction:confR.current.score});
    commitCurrentTick();    const np=computeProbs(m,candR.current),nc=computeConf(m,np);
    const contextHierarchy=computeItsHierarchy(m,candR.current,contextMemoryR.current); contextMemoryR.current=contextHierarchy.memory;
    const flowLens=computeFlowLens(m.orderFlow);
    const rawThesis=harmonizeThesis(computeTheses(m,candR.current,thesisR.current),contextHierarchy,flowLens),nt=unifyDirectionalState(rawThesis,nextBrain,thesisR.current);
    if(nt.gexVelocity?.terminalSpike)addJournal(c.t,`TERMINAL_SPIKE_BLOCK ${nt.gexVelocity.state} near structural wall; spike-direction entry blocked, opposite conviction boosted.`);
    if(nt.callDomSignal?.direction&&nt.gexVelocity?.direction&&nt.callDomSignal.direction!==nt.gexVelocity.direction)addJournal(c.t,`CALLDOM_GEX_DIVERGENCE callDom:${nt.callDomSignal.state} gex:${nt.gexVelocity.state}.`);
    probR.current=np;confR.current=nc;thesisR.current=nt;setProbs({...np});setConfData({...nc});setThesisData({...nt});
    setConfHist(prev=>[...prev.slice(-150),nc.score]);
    setItsSPXHist(prev=>[...prev.slice(-150),m.itsSPX]);
    setItsSPYHist(prev=>[...prev.slice(-150),m.itsSPY]);
    thesisHistR.current=[...thesisHistR.current.slice(-150),{t:c.t,call:nt.scores.call,put:nt.scores.put,wait:nt.scores.wait}];setThesisHist([...thesisHistR.current]);
    // Maintain compact session-wide price/FEP statistics for the execution prompt. Rich structural context is tracked separately by contextLayers and continuous cognition.
    if(!m.isPremarket){
      if(sessionOpenR.current==null)sessionOpenR.current=m.spySpot;
      sessionHighR.current=Math.max(sessionHighR.current,m.spySpot);
      sessionLowR.current=Math.min(sessionLowR.current,m.spySpot);
      if(m.spySpot>m.fep)aboveFepTotalR.current++;else if(m.spySpot<m.fep)belowFepTotalR.current++;
    }
    const recent12=candR.current.slice(-12),rHi=recent12.length?Math.max(...recent12.map(x=>x.spySpot)):m.spySpot,rLo=recent12.length?Math.min(...recent12.map(x=>x.spySpot)):m.spySpot;
    const callBuy=Math.max(m.gammaFlip,m.fep+0.35,rLo+0.18),putBuy=Math.min(m.gammaFlip,m.fep-0.35,rHi-0.18);
    setCallTrigger(callBuy);setPutTrigger(putBuy);setCallStop(Math.min(callBuy-0.55,m.fep-0.25));setPutStop(Math.max(putBuy+0.55,m.fep+0.25));
    const alphaState=updateAlphaRegime(alphaRegimeR.current,{market:m,history:candR.current,tick:tickR.current});
    alphaRegimeR.current=alphaState;setAlphaRegime({...alphaState.active});
    const regimeKey=alphaState.active.type;
    if(regimeKey!==lastSR.current){lastSR.current=regimeKey;tlR.current=[...tlR.current,{t:fmt.time(m.h,m.m,m.s||0),state:regimeKey,side:alphaState.active.side,confidence:alphaState.active.confidence,evidence:alphaState.active.evidence}];setTimeline([...tlR.current]);}
    const accelCrossed=m.accelerator>=7.4&&prevAccelR.current<7.4;
    const det=computeDeterministicPlan(m,candR.current,np,nt);
    const priorIntent=tradeIntentR.current;
    const rawIntent=buildTradeIntent(m,candR.current,nextBrain,nt,det,chain,posR.current,nc,tradeMemoryR.current,metacognitionR.current);
    const activeForecastNow=metacognitionR.current.forecasts.find(x=>x.id===metacognitionR.current.activeForecastId);
    const dataHealth=analyzeDataHealth(candR.current,m,chain);dataHealthR.current=dataHealth;
    const transmission=updateTransmissionState(transmissionR.current,candR.current,m,activeForecastNow);transmissionR.current=transmission;
    const signalKeys=[nt?.primaryCategory,nt?.gexVelocity?.state,transmission.state,nt?.contextHierarchy?.structural?.state].filter(Boolean);
    const coreResult=updateDeterministicDecisionCore(decisionCoreR.current,{rawIntent,market:m,tick:tickR.current,dataHealth,transmission,position:posR.current,history:candR.current,alphaRegime:alphaState,chain});
    decisionCoreR.current=coreResult.state;
    const coreIntent=coreResult.intent;
    const timeframeState=updateMultiTimeframeState(multiTimeframeR.current,{intent:coreIntent,thesis:nt,brain:nextBrain,chain,tick:tickR.current,marketTime:c.t});
    multiTimeframeR.current=timeframeState;setMultiTimeframe({...timeframeState,layers:{...timeframeState.layers}});
    const intent=applyMultiTimeframeGate(coreIntent,timeframeState,posR.current);
    tradeIntentR.current=intent;setTradeIntentData(intent);
    cognitionQueueR.current=[...cognitionQueueR.current,{tick:tickR.current,t:c.t,spy:m.spySpot,spx:m.spxSpot,itsSPX:m.itsSPX,itsSPY:m.itsSPY,gap:m.itsSPX-m.itsSPY,fepGap:m.spySpot-m.fep,spxFepGap:contextHierarchy.rubberBand.spx.fepDistance,fepDisagreement:contextHierarchy.rubberBand.cross.fepDistanceDisagreement,spxItsBase:contextHierarchy.rubberBand.spx.structuralBaseline,spyItsBase:contextHierarchy.rubberBand.spy.structuralBaseline,spxItsLocal:contextHierarchy.rubberBand.spx.localDeviation,spyItsLocal:contextHierarchy.rubberBand.spy.localDeviation,rubberInterpretation:contextHierarchy.rubberBand.interpretation.resolution,spxGex:m.netGexSpx,callWall:m.callWall,putWall:m.putWall,intent:intent.action,readiness:intent.executionReadiness??intent.readiness??0,local:contextHierarchy.local.state,structural:contextHierarchy.structural.state,position:posR.current?`${posR.current.strike}${posR.current.isCall?"C":"P"} ${fmt.pct((posR.current.current/posR.current.entry-1)*100)}`:"",dataState:dataHealth.state,transmissionState:transmission.state,market:{...m,tick:tickR.current}}].slice(-12);
    if(!cognitionRunningR.current&&!thinkR.current&&!activeDecisionR.current)drainCognition();
    if(intent?.diagnostics?.reentry?.discipline?.code&&tradeMemoryR.current.lastReentryJournal!==intent.episodeKey){addJournal(c.t,`${intent.diagnostics.reentry.discipline.code} episode:${intent.episodeKey} repeated:${intent.diagnostics.reentry.discipline.repeatedCategory} override:${intent.diagnostics.reentry.discipline.override}.`);tradeMemoryR.current.lastReentryJournal=intent.episodeKey;}

    if(dataHealth.state!==metacognitionR.current.lastDataState){addJournal(c.t,`DATA_STATE ${dataHealth.state} source:${dataHealth.source} spyFlat:${dataHealth.spyFlatTicks} chainRows:${dataHealth.chainRows}.`);metacognitionR.current.lastDataState=dataHealth.state;}
    if(transmission.state!==metacognitionR.current.lastTransmissionState){addJournal(c.t,`TRANSMISSION_STATE ${transmission.state} SPX:${Number(transmission.spxMove||0).toFixed(2)} SPY:${Number(transmission.spyMove||0).toFixed(2)} failedTicks:${transmission.failedTicks}.`);metacognitionR.current.lastTransmissionState=transmission.state;}
    const activeForecast=metacognitionR.current.forecasts.find(x=>x.id===metacognitionR.current.activeForecastId);
    if(activeForecast){const scored=scoreForecast(activeForecast,m,tickR.current);metacognitionR.current.forecasts=metacognitionR.current.forecasts.map(x=>x.id===scored.id?scored:x);if(scored.status!=="ACTIVE"){metacognitionR.current.signalTrust=applyForecastTrust(metacognitionR.current.signalTrust,scored);metacognitionR.current=updateExpectationFailureState(metacognitionR.current,scored,transmissionR.current);metacognitionR.current.activeForecastId=null;metacognitionR.current.lastResolvedForecast=scored;if(posR.current&&(posR.current.isCall?"CALL":"PUT")===scored.side)posR.current={...posR.current,lastResolvedForecast:scored};const inv=metacognitionR.current.inversion||{};addJournal(c.t,`FORECAST_${scored.status} ${scored.side} probability:${scored.probability}% progress:${Number(scored.progress||0).toFixed(2)} signals:${(scored.signalKeys||[]).join("+")||"UNSPECIFIED"} | failures CALL:${metacognitionR.current.expectationFailures?.CALL||0} PUT:${metacognitionR.current.expectationFailures?.PUT||0} | inversion ${inv.side||"NONE"} +${Math.round(inv.transfer||0)} ${inv.reason||""}.`);}}
    if(shouldActivateDrawdownReview(balR.current,STARTING_BALANCE,metacognitionR.current.drawdownReview)){metacognitionR.current.drawdownReview={active:true,activatedAt:c.t,completedAt:null,reflection:""};addJournal(c.t,"DRAWDOWN_REVIEW_ACTIVE: equity crossed 60% of starting capital. Reassess repeated beliefs, predictive versus retrospective evidence, signal transmission, timing, vehicle decay, exits, and falsification conditions before trusting the current operating model.");}
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
    const actionableRefresh=entryCritical&&(tickR.current-lastAiTickR.current)>=18;
    const openPositionDue=!!posR.current&&(
      intent.action==="EXIT"||
      (tickR.current-(lastAiTickR.current??-99)>=Math.max(4,posR.current.reevaluateAfterTicks||6)&&(
        thesisR.current?.contextHierarchy?.alignment==="CONFLICT"||
        Math.abs(m.spySpot-(posR.current.lastAiReviewSpot??posR.current.entrySpot))>=0.45||
        (posR.current.thesisContract&&evaluateThesisContract(posR.current,m,chain,marketBrainR.current,thesisR.current,thesisR.current?.contextHierarchy).invalidations.length>=2)
      ))
    );
    const meaningfulWaitCheck=!posR.current&&intent.action==="WAIT"&&(directionChanged||episodeChanged)&&(tickR.current-lastAiTickR.current)>=8;
    const shouldAskAI=m.isTradeable&&(readinessCross||actionableRefresh||openPositionDue||meaningfulWaitCheck||(entryCritical&&(directionChanged||episodeChanged)));
    prevAccelR.current=m.accelerator;
    if((tickR.current%6===0||localDir!=="WAIT")&&!posR.current&&!thinkR.current){addM({t:fmt.time(m.h,m.m,m.s||0),mindset:localDir!=="WAIT"?`deterministic ${det.mode}`:"local scan",reasoning:localDir!=="WAIT"?`Local ${localDir} context: ${det.reason}. ${leadLag.text}. Unified intent ${intent.action} ${intent.readiness}%.`:`No local entry. ${det.reason}. ${leadLag.text}.`,decision:localDir!=="WAIT"?`ARM_${localDir}`:"WAIT",score:nc.score,edgeState:localDir!=="WAIT"?"LOCAL_ARMED":"LOCAL_SCAN",confTrend:localDir!=="WAIT"?"BUILDING":"STABLE"});}
    if(localDir!=="WAIT"&&!posR.current&&m.isTradeable&&mL>=45){const isC=localDir==="CALL",contractMode=det.mode==="PIN_RANGE"?"pin":det.mode==="GEX_EXPANSION"?"expansion":"scalp",opt=selectContract(chain,isC,contractMode);addM({t:fmt.time(m.h,m.m,m.s||0),mindset:`deterministic guide ${det.mode}`,reasoning:`Playbook ${localDir}: ${det.reason}. ${leadLag.text}${opt?` | candidate ${opt.strike}${isC?"C":"P"} @$${opt.price.toFixed(2)} Δ${opt.delta.toFixed(2)} ${opt.tier}`:" | no valid contract"}. Unified intent ${intent.action} ${intent.readiness}%; blockers: ${(intent.blockers||[]).slice(0,3).join(", ")||"none"}.`,decision:`GUIDE_${localDir}`,score:nc.score,edgeState:"LOCAL_GUIDE",confTrend:"BUILDING"});}
    if(entryCritical&&activeDecisionR.current){
      const active=activeDecisionR.current;
      const strongerWindow=!active.entryCritical||active.direction!==(intent.direction||"NONE")||(intent.executionReadiness??0)>=(active.requestReadiness??0)+8||(intent.contract?.strike??null)!==(active.contractStrike??null);
      if(strongerWindow){
        active.cancelled=true;
        active.controller?.abort("ENTRY_WINDOW_PREEMPTED");
        clearTimeout(active.timeoutId);
        activeDecisionR.current=null;
        thinkR.current=false;
        setThinking(false);
        setLiveThought("");
        addJournal(fmt.time(m.h,m.m,m.s||0),`AI_REQUEST_PREEMPTED request:${active.id} by ${intent.action} readiness:${intent.executionReadiness}% contract:${intent.contract?`${intent.contract.strike}@${intent.contract.price}`:"NONE"}.`);
      }
    }
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
        contractSnapshot:intent.contract?{...intent.contract}:null,
        contractStrike:intent.contract?.strike??null,
        requestSpot:m.spySpot,
        requestMarketTime:fmt.time(m.h,m.m,m.s||0),
        startedPerf:typeof performance!=="undefined"?performance.now():null,
        lastActiveAt:Date.now(),
        entryCritical,
        cognitionClass:(entryCritical||openPositionDue)?"EXECUTION_CRITICAL":"BACKGROUND_INTERPRETATION",
        executionEligible:!!(entryCritical||openPositionDue),
        freezeSim:false,
        cancelled:false
      };
      const controller=new AbortController();
      requestCtx.controller=controller;
      const timeoutId=setTimeout(()=>{requestCtx.cancelled=true;controller.abort("AI_TIMEOUT");},AI_REQUEST_TIMEOUT_MS);
      requestCtx.timeoutId=timeoutId;
      // Canonical BUY is a proposal until the live Trader gets one bounded veto
      // review. Freeze the source tick so 10x playback cannot stale that review.
      requestCtx.freezeSim=entryCritical;
      aiFreezeR.current=entryCritical;
      activeDecisionR.current=requestCtx;
      // Compute flat-duration from full retained candle history. The execution prompt still shows a short recent window, while continuous cognition receives ordered tick batches and persistent memory.
      let flatTicks=0;for(let i=candR.current.length-1;i>=0&&Math.abs(candR.current[i].spySpot-m.spySpot)<0.15;i--)flatTicks++;
      const sessionSummary=(sessionOpenR.current!=null?`Session so far: opened $${sessionOpenR.current.toFixed(2)}, high $${sessionHighR.current.toFixed(2)}, low $${sessionLowR.current.toFixed(2)}, ${aboveFepTotalR.current} ticks above FEP / ${belowFepTotalR.current} below FEP out of ${aboveFepTotalR.current+belowFepTotalR.current} tradeable ticks.`:"Session just opened.")+` Price has held within 15c of current for ${flatTicks} consecutive source ticks; interpret duration from the replay cadence, not a hard-coded minute assumption — use this number, don't estimate your own duration.`;
      const applyDecision=(dec,source="AI")=>{
          const ts=fmt.time((latestMarketR.current||m).h,(latestMarketR.current||m).m);
          const currentMarket=latestMarketR.current||m;
          const executionDecision=["BUY_CALL","BUY_PUT","SELL","HOLD"].includes(String(dec?.decision||"").toUpperCase());
          if(requestCtx.cognitionClass==="BACKGROUND_INTERPRETATION"&&executionDecision){addJournal(fmt.time(currentMarket.h,currentMarket.m),`BACKGROUND_EXECUTION_REJECTED request:${requestCtx.id} decision:${dec.decision} requestedAtTick:${requestCtx.tick} resolvedAtTick:${tickR.current}.`);dec={...dec,decision:"WAIT",reasoning:`Background interpretation cannot execute. ${dec.reasoning||""}`};}
          if(requestCtx.cognitionClass==="EXECUTION_CRITICAL"&&tickR.current!==requestCtx.tick){addJournal(fmt.time(currentMarket.h,currentMarket.m),`TICK_BINDING_VIOLATION request:${requestCtx.id} requestedAtTick:${requestCtx.tick} currentTick:${tickR.current}; execution rejected.`);return;}
          const preIntent=tradeIntentR.current;
          const preCanonicalBuy=preIntent?.action==="BUY_CALL"||preIntent?.action==="BUY_PUT";
          const preAiWait=dec.decision==="WAIT"||dec.decision==="WAITING";
          if(requestCtx.cognitionClass==="EXECUTION_CRITICAL"&&preCanonicalBuy&&preAiWait){
            const veto=validateEntryVeto(dec.veto_reason,preIntent,requestCtx,currentMarket);
            if(!veto.valid){
              addJournal(fmt.time(currentMarket.h,currentMarket.m),`AI_WAIT_OVERRIDDEN request:${requestCtx.id} canonical:${preIntent.action} invalidVeto:${veto.code||"NONE"} reason:${veto.reason}; deterministic authorization executed.`);
              dec={...dec,decision:preIntent.action,trade_confidence:Math.max(Number(dec.trade_confidence)||0,Number(preIntent.confidence)||0,55),reasoning:`Canonical execution authorization passed and no evidence-backed veto was present. ${dec.reasoning||""}`};
            }
          }
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
            const audit=createVetoAudit(liveIntent,currentMarket,tickR.current,dec);
            if(audit)aiVetoAuditsR.current=[...aiVetoAuditsR.current,audit].slice(-12);
            addJournal(liveTs,`AI_WAIT_FINAL request:${requestCtx.id} canonical:${liveIntent.action} veto:${veto.code||"NONE"} evidence:${dec.veto_evidence||dec.reasoning||veto.reason}.`);
          }
          const materialAiEvent=semantic.mode!=="JOURNAL_ONLY"||["BUY_CALL","BUY_PUT","SELL","HOLD"].includes(dec.decision)||["ENTRY_READY","IN_TRADE","EXITING"].includes(dec.edge_state)||!!dec.self_audit||!!dec.missing_angle;
          if(materialAiEvent)addJournal(liveTs,`AI_DECISION_ACCEPTED request:${requestCtx.id} decision:${dec.decision} age:${semantic.ageTicks??(tickR.current-requestCtx.tick)}t/${Math.round(semantic.ageMs??0)}ms mode:${semantic.mode} current:${liveIntent?.action||"WAIT"} provider:${dec.provider||source}.`);
          const mb=marketBrainR.current;
          const mLn=(SESSION_END_H*60+SESSION_END_M)-(currentMarket.h*60+currentMarket.m);
          if((dec.decision==="WAIT"||dec.decision==="WAITING")&&dec.reasoning===lastWaitReasonR.current)repeatWaitR.current++;else repeatWaitR.current=0;
          lastWaitReasonR.current=dec.reasoning||"";
          aiSessionMemoryR.current=updateAiSessionMemory(aiSessionMemoryR.current,dec,currentMarket,liveIntent,liveTs);
          storageSet("ai_session_memory",aiSessionMemoryR.current);
          if(dec.architecture_reflection){storageSet("ai_architecture_memory",{buildId:BUILD_ID,reflection:dec.architecture_reflection,updatedAt:liveTs});}
          setAiSessionMemory({...aiSessionMemoryR.current});
          const priorForecast=metacognitionR.current.forecasts.find(x=>x.id===metacognitionR.current.activeForecastId);
          const forecast=createForecast(dec,currentMarket,tickR.current,[thesisR.current?.primaryCategory,thesisR.current?.gexVelocity?.state,thesisR.current?.gexImpulse?.transmission,thesisR.current?.contextHierarchy?.structural?.state],priorForecast);
          if(forecast&&forecast!==priorForecast){metacognitionR.current.forecasts=[...metacognitionR.current.forecasts,forecast].slice(-100);metacognitionR.current.activeForecastId=forecast.id;addJournal(liveTs,`FORECAST_CREATED ${forecast.side} probability:${forecast.probability}% window:${forecast.windowTicks}t target:${forecast.targetSpot??"OPEN"} invalidation:${forecast.invalidationSpot??"OPEN"} signals:${forecast.signalKeys.join("+")||"UNSPECIFIED"}.`);}
          setLiveThought("");
          const durableThought=(dec.thought_append||dec.self_audit||dec.missing_angle||dec.reasoning||"").trim();
          if(source==="AI"&&durableThought){setThoughtSync("SAVING");persistThought({session_id:thoughtSessionIdR.current,market_time:liveTs,kind:"thought",content:durableThought,decision:dec.decision,spot:currentMarket.spySpot,metadata:{thesis:dec.current_thesis||"",expected_next_path:dec.expected_next_path||"",new_evidence:dec.new_evidence||""}}).then(()=>setThoughtSync("SYNCED")).catch(()=>setThoughtSync("LOCAL"));}
          addM({t:ts,mindset:dec.mindset||"—",reasoning:dec.reasoning||"—",decision:dec.decision,score:confR.current.score,edgeState:dec.edge_state||"—",confTrend:dec.confidence_trend||"—"});
          if(dec.journal_entry)addJournal(ts,dec.journal_entry);
          if(dec.self_audit)addJournal(ts,`SELF_AUDIT ${dec.coherence_check||"COHERENT"}: ${dec.self_audit}`);
          if(dec.missing_angle)addJournal(ts,`MISSING_ANGLE ${dec.missing_angle}`);
          if(dec.memory_used&&dec.memory_used!=="none")addJournal(ts,`MEMORY_USED ${dec.memory_used}`);
          if(posR.current&&(dec.decision==="HOLD"||dec.decision==="SELL"))posR.current.lastAiReviewSpot=currentMarket.spySpot;
          if(dec.decision==="SELL"&&posR.current){
            const p=posR.current,size=p.remainingSize??p.size??balR.current,r=(p.current/p.entry-1)*100;
            balR.current=(p.cashReserve||0)+size*(p.current/p.entry);const dollar=balR.current-(p.originalSize||p.size||balR.current);
            logR.current=[...logR.current,{t:ts,action:`AI-EXIT ${p.strike}${p.isCall?"C":"P"} @$${p.current.toFixed(2)}`,result:`${fmt.pct(r)} (${dollar>=0?"+":""}${fmt.bal(dollar)})`,pnl:r,dollarPnl:dollar,exitType:"AI_SELL"}];
            setTradeLog([...logR.current]);addJournal(ts,`AI_EXIT_AUTHORIZED ${fmt.pct(r)} — ${dec.reasoning||"thesis invalidated"}`);
            tradeMemoryR.current=recordTradeOutcome(tradeMemoryR.current,p,m,r,"AI_SELL",tickR.current);
            posR.current=null;setPos(null);leadWrongTicksR.current=0;setBal(balR.current);resetPostExitState("AI_SELL",currentMarket);
          }
          else if(dec.decision==="BUY_CALL"||dec.decision==="BUY_PUT"){
            const isC=dec.decision==="BUY_CALL";
            const executionMarket=latestMarketR.current||m;
            const snapshotIntent=tradeIntentR.current;
            const responseSide=isC?"CALL":"PUT";
            const intentMatches=snapshotIntent?.contract&&snapshotIntent.direction===responseSide&&snapshotIntent.action===dec.decision&&hardExecutionBlockers(snapshotIntent).length===0;
            const locked=requestCtx.contractSnapshot;
            const ageTicks=tickR.current-requestCtx.tick;
            const adverseMove=(isC?1:-1)*(executionMarket.spySpot-requestCtx.requestSpot);
            const liveRows=isC?(executionMarket.optionChain?.calls||[]):(executionMarket.optionChain?.puts||[]);
            const liveLocked=locked?liveRows.find(x=>x.strike===locked.strike):null;
            const lockedStillValid=!!locked&&requestCtx.direction===responseSide&&snapshotIntent?.direction===responseSide&&snapshotIntent?.action===dec.decision&&hardExecutionBlockers(snapshotIntent).length===0&&ageTicks===0&&adverseMove>-0.35&&(snapshotIntent.executionReadiness??0)>=(requestCtx.requestReadiness??0)-10;
            const opt=intentMatches?{...snapshotIntent.contract,tier:snapshotIntent.contract.quality}:lockedStillValid?{...locked,price:liveLocked?.price??locked.price,delta:liveLocked?.delta??locked.delta,openInterest:liveLocked?.openInterest??locked.openInterest,volume:liveLocked?.volume??locked.volume,tier:locked.quality}:null;
            const repeatedRetry=snapshotIntent?.diagnostics?.reentry?.discipline?.code==="REENTRY_REASSESS_REQUIRED";
            const retryEvidence=String(dec.new_evidence||"").trim();
            const retryAssessment=String(dec.prior_trade_effect||"").trim();
            const retryAuthorized=source==="DETERMINISTIC"||!repeatedRetry||(retryEvidence.length>=18&&retryAssessment.length>=12&&!/same|none|unchanged|no new/i.test(retryEvidence));
            if(dec.current_thesis||dec.expected_next_path||dec.new_evidence||dec.prior_trade_effect)addJournal(ts,`AI_THESIS ${dec.current_thesis||"—"} | next ${dec.expected_next_path||"—"} | new ${dec.new_evidence||"—"} | prior ${dec.prior_trade_effect||"—"}.`);
            // v10: the AI's decision field and journal_entry text are two independent outputs from
            // the same call — nothing previously enforced they agree, and a decided-but-unfilled
            // trade (no priceable option, already in position, wrong window) was silently dropped
            // with zero record. Now every rejected fire is logged so it's visible, not vanished.
            if(balR.current<=1){addM({t:ts,mindset:"account depleted",reasoning:`Fired ${dec.decision} but account equity is depleted — no more trades this session.`,decision:"WAIT",score:confR.current.score,edgeState:"ACCOUNT_ZERO",confTrend:"—"});addJournal(ts,`ENTRY_BLOCKED ${dec.decision} — ACCOUNT_ZERO.`);}
            else if(posR.current){addM({t:ts,mindset:dec.mindset||"—",reasoning:`Fired ${dec.decision} but already in a position — decision/state mismatch, ignored.`,decision:"WAIT",score:confR.current.score,edgeState:"MISFIRE",confTrend:"—"});addJournal(ts,`ENTRY_BLOCKED ${dec.decision} — POSITION_ALREADY_OPEN.`);}
            else if((currentMarket.h*60+currentMarket.m)>=(TRADE_CUTOFF_H*60+TRADE_CUTOFF_M)){addM({t:ts,mindset:dec.mindset||"—",reasoning:`Fired ${dec.decision} at/after the 3:45 PM ET default 0DTE cutoff — blocked while observation continues through 4:15 PM.`,decision:"WAIT",score:confR.current.score,edgeState:"ENTRY_BLOCKED",confTrend:"—"});addJournal(ts,`ENTRY_BLOCKED ${dec.decision} — DEFAULT_0DTE_CUTOFF_15_45.`);}
            else if(mLn<15){addM({t:ts,mindset:dec.mindset||"—",reasoning:`Fired ${dec.decision} inside final theta window (${mLn}min left) — blocked by no-entry rule.`,decision:"WAIT",score:confR.current.score,edgeState:"ENTRY_BLOCKED",confTrend:"—"});addJournal(ts,`ENTRY_BLOCKED ${dec.decision} — FINAL_THETA_WINDOW ${mLn}min.`);}
            else if(!executionMarket.isTradeable){addM({t:ts,mindset:dec.mindset||"—",reasoning:`Fired ${dec.decision} while premarket/untradeable — blocked.`,decision:"WAIT",score:confR.current.score,edgeState:"ENTRY_BLOCKED",confTrend:"—"});addJournal(ts,`ENTRY_BLOCKED ${dec.decision} — MARKET_NOT_TRADEABLE.`);}
            else if(snapshotIntent?.blockers?.some(x=>/DATA_STALE_OR_NONINFORMATIVE|SIGNAL_TO_PRICE_TRANSMISSION_FAILED|UNRESOLVED_OPPOSITE_FORECAST/.test(x))){addM({t:ts,mindset:"metacognitive veto",reasoning:`Entry blocked by ${snapshotIntent.blockers.filter(x=>/DATA_STALE|TRANSMISSION_FAILED|UNRESOLVED_OPPOSITE|DRAWDOWN_REVIEW/.test(x)).join(", ")}.`,decision:"WAIT",score:confR.current.score,edgeState:"METACOGNITIVE_GATE",confTrend:"DECAYING"});addJournal(ts,`ENTRY_BLOCKED ${dec.decision} — METACOGNITIVE_GATE ${snapshotIntent.blockers.join(" | ")}.`);}
            else if((snapshotIntent?.confidence??0)<58||Number(dec.trade_confidence||0)<55){addM({t:ts,mindset:"confidence disagreement",reasoning:`Entry rejected because canonical confidence ${snapshotIntent?.confidence??0}% or Trader confidence ${Number(dec.trade_confidence||0)}% is below the execution floor.`,decision:"WAIT",score:confR.current.score,edgeState:"CONFIDENCE_GATE",confTrend:"DECAYING"});addJournal(ts,`ENTRY_BLOCKED ${dec.decision} — CONFIDENCE_GATE canonical:${snapshotIntent?.confidence??0} trader:${Number(dec.trade_confidence||0)} minimums:58/55.`);}
            else if(!retryAuthorized){addM({t:ts,mindset:dec.mindset||"reentry reassessment",reasoning:`Repeated ${snapshotIntent?.diagnostics?.reentry?.discipline?.repeatedCategory||"signal"} attempt rejected because the AI did not identify material new evidence and explain the prior trade effect.`,decision:"WAIT",score:confR.current.score,edgeState:"REENTRY_DECLINED",confTrend:"UNCLEAR"});addJournal(ts,`REENTRY_DECLINED ${dec.decision}  -  no material thesis change established; evidence:${retryEvidence||"NONE"}; prior:${retryAssessment||"NONE"}.`);}
            else if(!opt){addM({t:ts,mindset:dec.mindset||"—",reasoning:`Fired ${dec.decision}, but the canonical intent snapshot no longer contains the same-side contract. Entry rejected as stale rather than reselecting a different option.`,decision:"WAIT",score:confR.current.score,edgeState:"STALE_CONTRACT",confTrend:"—"});addJournal(ts,`ENTRY_BLOCKED ${dec.decision} — STALE_CONTRACT current intent ${snapshotIntent?.action||"NONE"}, direction ${snapshotIntent?.direction||"NONE"}, contract ${snapshotIntent?.contract?`${snapshotIntent.contract.strike}@${snapshotIntent.contract.price}`:"NONE"}.`);}
            else{
              const tc=clamp(Number(dec.trade_confidence)||65,20,98);
              const recoveryMode=snapshotIntent?.blockers?.includes("DRAWDOWN_RECOVERY_MODE");
              const micro=snapshotIntent?.microHarvest?.active?snapshotIntent.microHarvest:null;
              const maxLossPct=micro?Number(micro.maxLossPct||7):(recoveryMode?6:10);
              const takeProfitPct=micro?Number(micro.profitProtectPct||18):clamp(24+(tc-50)*0.65,22,55);
              const riskMultiplier=clamp(Number(snapshotIntent?.riskMultiplier??1),0.1,1);
              let stopSpot=Number(dec.invalidation_spot),targetSpot=Number(dec.target_spot);
              const invalidationInstrument=String(dec.invalidation_instrument||'').toUpperCase();
              const targetInstrument=String(dec.target_instrument||'').toUpperCase();
              const belongsToSPX=value=>Number.isFinite(value)&&Math.abs(value-executionMarket.spxSpot)<Math.abs(value-executionMarket.spySpot);
              if(invalidationInstrument!=='SPY'||belongsToSPX(stopSpot)){addJournal(ts,`INSTRUMENT_FIELD_REJECTED invalidation instrument:${invalidationInstrument||'MISSING'} value:${Number.isFinite(stopSpot)?stopSpot:'NULL'} expected:SPY spy:${executionMarket.spySpot.toFixed(2)} spx:${executionMarket.spxSpot.toFixed(2)}.`);stopSpot=NaN;}
              if(targetInstrument!=='SPY'||belongsToSPX(targetSpot)){addJournal(ts,`INSTRUMENT_FIELD_REJECTED target instrument:${targetInstrument||'MISSING'} value:${Number.isFinite(targetSpot)?targetSpot:'NULL'} expected:SPY spy:${executionMarket.spySpot.toFixed(2)} spx:${executionMarket.spxSpot.toFixed(2)}.`);targetSpot=NaN;}
              if(!Number.isFinite(stopSpot)||(isC?stopSpot>=executionMarket.spySpot:stopSpot<=executionMarket.spySpot))stopSpot=isC?executionMarket.spySpot-(0.25+tc/220):executionMarket.spySpot+(0.25+tc/220);
              if(!Number.isFinite(targetSpot)||(isC?targetSpot<=executionMarket.spySpot:targetSpot>=executionMarket.spySpot))targetSpot=isC?executionMarket.spySpot+(0.55+tc/120):executionMarket.spySpot-(0.55+tc/120);
              posR.current={id:`P${++positionSeqR.current}`,strike:opt.strike,isCall:isC,entry:opt.price,current:opt.price,quoteSource:opt.quoteSource||executionMarket.quoteSource||"MODELED",contract:opt.contract||null,entryTime:ts,entrySpot:executionMarket.spySpot,spyEntry:executionMarket.spySpot,spyInvalidation:stopSpot,spyTarget:targetSpot,spxConfirmation:executionMarket.spxSpot,spxInvalidation:null,optionStopPct:maxLossPct,stopSpot,targetSpot,maxLossPct,noiseTolerancePct:22,vehicleFailurePct:10,catastrophicLossPct:10,pathDeadlineTicks:tc>=85?5:4,minExpectedProgress:tc>=85?0.24:0.18,takeProfitPct,tradeConfidence:tc,planType:micro?(snapshotIntent.campaignType||"MICRO_HARVEST"):det.mode,size:balR.current*riskMultiplier,originalSize:balR.current*riskMultiplier,remainingSize:balR.current*riskMultiplier,cashReserve:balR.current*(1-riskMultiplier),exposurePct:Math.round(riskMultiplier*100),scaleCount:0,microHarvest:micro?{...micro,campaignType:snapshotIntent.campaignType}:null,contractHistory:[opt.price],entryTick:tickR.current,entryAccel:executionMarket.accelerator,lastSpot:executionMarket.spySpot,lastIv:executionMarket.iv,peakPrice:opt.price,peakPnl:0,maxFavorableSpot:executionMarket.spySpot,maxAdverseSpot:executionMarket.spySpot,episodeKey:snapshotIntent.episodeKey||tradeEpisodeKey(isC?"CALL":"PUT",executionMarket,det),primaryCategory:nt.primaryCategory||"UNKNOWN",entryThesis:dec.current_thesis||`${snapshotIntent.direction} ${snapshotIntent.setupQuality}% setup`,expectedPath:dec.expected_next_path||(isC?`within ${tc>=85?5:4} ticks hold above ${stopSpot.toFixed(2)} and gain at least ${tc>=85?"0.24":"0.18"} before pressing toward ${targetSpot.toFixed(2)}`:`within ${tc>=85?5:4} ticks hold below ${stopSpot.toFixed(2)} and gain at least ${tc>=85?"0.24":"0.18"} before pressing toward ${targetSpot.toFixed(2)}`),aiNewEvidence:dec.new_evidence||"",aiPriorTradeEffect:dec.prior_trade_effect||"",reevaluateAfterTicks:dec.reevaluate_after_ticks||null};
              posR.current.thesisContract=buildThesisContract(executionMarket,executionMarket.optionChain,isC?"CALL":"PUT",tc,dec,snapshotIntent);
              setPos({...posR.current});
              logR.current=[...logR.current,{t:ts,action:`CANONICAL FILL ${isC?"BUY CALL":"BUY PUT"} ${opt.strike}${isC?"C":"P"} @$${opt.price.toFixed(2)} ${opt.tier||opt.quality||"QUALITY"} source:${opt.quoteSource||executionMarket.quoteSource||"MODELED"} invalidation ${stopSpot.toFixed(2)} target ${targetSpot.toFixed(2)} noise 22% maxLoss 10% deadline ${tc>=85?5:4}t confidence ${tc.toFixed(0)}`,result:null,quoteSource:opt.quoteSource||executionMarket.quoteSource||"MODELED"}];
              setTradeLog([...logR.current]);
              reliabilityR.current.totalTrades++;if(source==="FALLBACK")reliabilityR.current.fallbackExecutions++;
              addJournal(ts,`ENTRY_EXECUTED ${source} ${isC?"BUY_CALL":"BUY_PUT"} ${opt.strike}${isC?"C":"P"} @$${opt.price.toFixed(2)} | QUOTE_SOURCE ${opt.quoteSource||executionMarket.quoteSource||"MODELED"} | SPY ${executionMarket.spySpot.toFixed(2)} | readiness ${snapshotIntent.executionReadiness??snapshotIntent.readiness}% | confidence ${tc.toFixed(0)}.`);
              const side=isC?"CALL":"PUT";
              tradeMemoryR.current={...tradeMemoryR.current,lastEntry:{side,strike:opt.strike,spot:executionMarket.spySpot,price:opt.price,tick:tickR.current,whyNow:snapshotIntent.whyNow||[]},totalEntries:(tradeMemoryR.current.totalEntries||0)+1,sameThesisAttempts:{...(tradeMemoryR.current.sameThesisAttempts||{}),[side]:(tradeMemoryR.current.sameThesisAttempts?.[side]||0)+1}};
            }
          }
      };
      callAI(m,posR.current,balR.current,candR.current,probR.current,confR.current,thesisR.current,journalR.current,rules.approved,repeatWaitR.current,(sessionMode==="replay"?"BLIND HISTORICAL REPLAY. Calendar date, eventual outcome, day type, and remaining path are withheld.":sessionSummary)+`\n${sessionLearning}\n${tradeMemorySnapshot(tradeMemoryR.current,m)}\nSIMULATION TEMPORAL CONTEXT — AUTHORITATIVE:
Current replay tick ${requestCtx.tick}; current market time ${requestCtx.requestMarketTime} ET; replay display speed ${speed}x; each tick equals the source replay cadence; second-resolved replays use 20 simulated seconds per tick. Never assume one minute. Wall-clock delay and display speed are not market evidence. Cognition class ${requestCtx.cognitionClass}. Execution-critical output is bound exclusively to tick ${requestCtx.tick}; do not reason from or act on any later market state. All execution spot fields are SPY-only. invalidation_spot and target_spot must use the SPY price scale and must declare invalidation_instrument=SPY and target_instrument=SPY. SPX values belong only in SPX context fields and must never cross into SPY execution fields.
CANONICAL EXECUTION STATE — AUTHORITATIVE:
action ${intent.action}; direction ${intent.direction||"NONE"}; setup ${intent.setupQuality}%; readiness ${intent.executionReadiness}% / threshold ${intent.threshold??"—"}%; contract ${intent.contract?`${intent.contract.strike}${intent.direction==="PUT"?"P":"C"} $${intent.contract.price.toFixed(2)} ${intent.contract.quality}`:"NONE"}; hard blockers ${hardExecutionBlockers(intent).join(", ")||"NONE"}; all blockers ${(intent.blockers||[]).join(", ")||"NONE"}.
When the authoritative canonical action is exact BUY_CALL or BUY_PUT, the matching trade is mandatory unless you can truthfully select one enumerated veto_reason whose condition is present in the supplied current evidence. WAIT with veto_reason NONE, vague hesitation, desire for extra confirmation, or a non-enumerated objection is invalid and will be overridden by deterministic execution. PREPARE_CALL and PREPARE_PUT are non-executable and must receive WAIT until canonical action becomes BUY. Canonical confidence below 58% or Trader confidence below 55% is non-executable even when setup quality or readiness is high. Treat score disagreement as uncertainty, never permission. Structural context is a prior, not a conclusion: repeated failed expectations automatically reduce that side's authority. A failed CALL or PUT forecast is new market evidence; identify the violated assumptions and decide whether the failure causally transfers probability to the opposite side through price rejection, FEP/flip acceptance, SPX-to-SPY transmission, wall/OI behavior, dealer response, or contract response. Do not reflexively reverse merely because a trade lost. Reverse only when the opposite thesis receives affirmative causal evidence. A 10% option stop does not automatically invalidate the market thesis. Use POST_STOP_THESIS classification as authoritative: THESIS_INVALIDATED requires genuinely new thesis evidence; THESIS_UNRESOLVED or THESIS_SURVIVED_VEHICLE_STOP preserves the old thesis and requires renewed execution evidence such as renewed directional progress, acceleration rebuild, contract response, or clearing the stopped exit. Do not demand an entirely new structural thesis when the old thesis remains causally intact. Decline an eligible BUY when data health, forecast accountability, transmission, episode novelty, or drawdown review makes the causal case weak. For a repeated-category retry, BUY only if new_evidence states a material change in structure, FEP relationship, SPX GEX/wall/OI landscape, lead-lag, or a genuinely new leg, and prior_trade_effect explains why the previous attempt does not control this one. Otherwise WAIT. Manage exits by the entry thesis contract: expected timing is an evaluation window, never an automatic exit; stack causal invalidations, wall/OI exhaustion or relocation, FEP acceptance failure, and structural/local reversal. Do not request extra confirmation for already-passed checks.\n${leadLag.text}`,marketBrainR.current,aiSessionMemoryR.current,traderLearning,setLiveThought,controller.signal,entryCritical,{dataHealth:dataHealthR.current,transmission:transmissionR.current,activeForecast:metacognitionR.current.forecasts.find(x=>x.id===metacognitionR.current.activeForecastId)||null,drawdownActive:!!metacognitionR.current.drawdownReview?.active,signalTrust:metacognitionR.current.signalTrust,expectationFailures:metacognitionR.current.expectationFailures,inversion:metacognitionR.current.inversion,tradeMemory:tradeMemoryR.current,providerState:(geminiLiveTrader.runtimeStatus?.()||{}).state,providerCircuitOpen:!!(geminiLiveTrader.runtimeStatus?.()||{}).circuitOpen,premarketContext:premarketContextR.current})
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
          const providerRuntime=geminiLiveTrader.runtimeStatus?.()||{};
          if(providerRuntime.circuitOpen){
            aiFreezeR.current=false;thinkR.current=false;setThinking(false);setRunning(false);
            addJournal(ts,`WORKER_TERMINAL_FAILURE ${providerRuntime.circuitReason||'PROVIDER_CIRCUIT_OPEN'}; replay halted and run is invalid.`);
          }
          addM({t:ts,mindset:"AI response failure",reasoning:raw,decision:"FALLBACK",score:confR.current.score,edgeState:providerRuntime.circuitOpen?"TERMINAL_PROVIDER_FAILURE":"ERROR_RECOVERED",confTrend:"UNCLEAR"});
          reliabilityR.current.parseFailures++;
          addJournal(ts,`AI_RESPONSE_FAILURE ${raw}`);
          // No Trader response means the veto review did not happen, so new entries
          // fail closed. Existing-position risk management keeps its fallback path.
          const fallback=requestCtx.cognitionClass==="EXECUTION_CRITICAL"&&!posR.current
            ?normalizeTraderDecision({decision:"WAIT",reasoning:"AI response failed; canonical entry withheld because the required Trader veto review did not complete.",mindset:"fail closed on unreviewed entry",journal_entry:"",edge_state:"CONDITIONS_FORMING",confidence_trend:"UNCLEAR",trade_confidence:0,invalidation_spot:null,invalidation_instrument:"SPY",target_spot:null,target_instrument:"SPY",max_loss_pct:null,memory_used:"session trade memory",current_thesis:"",expected_next_path:"",new_evidence:"",prior_trade_effect:"",reevaluate_after_ticks:1,forecast_probability:0,forecast_window_ticks:1,forecast_supporting_behavior:"",forecast_side:"NONE",veto_reason:"NONE",veto_evidence:""})
            :buildFallbackDecision(liveMarket,posR.current,tradeIntentR.current,tradeMemoryR.current);
          addJournal(ts,`FALLBACK_DECISION ${fallback.decision} — ${fallback.reasoning}`);
          applyDecision(fallback,"FALLBACK");
        })
        .finally(()=>{clearTimeout(requestCtx.timeoutId);if(activeDecisionR.current?.id===requestCtx.id)activeDecisionR.current=null;if(requestCtx.freezeSim)aiFreezeR.current=false;thinkR.current=false;setThinking(false);setLiveThought("");});
    }
  },[aiFreq,addM,addJournal,rules.approved,traderLearning,drainCognition,resetPostExitState]);

  useEffect(()=>{if(!running||!engR.current)return;ivR.current=setInterval(()=>{const cognitionPending=cognitionRunningR.current||cognitionQueueR.current.length>0;if(!aiFreezeR.current&&!cognitionPending)doTick(engR.current);},Math.max(150,BASE_TICK_MS/speed));return()=>clearInterval(ivR.current);},[running,speed,doTick]);

  useEffect(()=>{
    const send=()=>{
      const provider=geminiLiveTrader.runtimeStatus?.()||{};
      const state=provider.circuitOpen?'FAILED_PROVIDER':provider.state==='THROTTLED'?'PROVIDER_THROTTLED':running?(aiFreezeR.current?'WAITING_ON_COGNITION':'RUNNING'):(saved?'FINALIZING_OR_COMPLETED':'IDLE');
      fetch(`${AGENT_BASE}/runtime-state`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({state,tick:tickR.current,eventCount:eventSnapshotsR.current.length,running,aiFrozen:!!aiFreezeR.current,thinking:!!thinkR.current,provider,buildId:BUILD_ID,buildSequence:BUILD_SEQUENCE,at:new Date().toISOString()})}).catch(()=>{});
    };
    send();const id=setInterval(send,2000);return()=>clearInterval(id);
  },[running,saved]);

  useEffect(()=>{
    const id=setInterval(()=>{
      const ctx=activeDecisionR.current;
      if(!ctx||!aiFreezeR.current)return;
      if(Date.now()-ctx.startedAt<=AI_REQUEST_TIMEOUT_MS+15000)return;
      ctx.cancelled=true;ctx.controller?.abort('EXECUTION_BARRIER_WATCHDOG');clearTimeout(ctx.timeoutId);
      geminiLiveTrader.abortPendingConnection?.('EXECUTION_BARRIER_WATCHDOG');
      activeDecisionR.current=null;aiFreezeR.current=false;thinkR.current=false;setThinking(false);setLiveThought('');
      const lm=latestMarketR.current;if(lm)addJournal(fmt.time(lm.h,lm.m),`EXECUTION_BARRIER_WATCHDOG_RELEASE request:${ctx.id} tick:${ctx.tick}.`);
    },5000);
    return()=>clearInterval(id);
  },[addJournal]);

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
      const lm=latestMarketR.current;if(lm)addJournal(fmt.time(lm.h,lm.m),`AI_REQUEST_CANCELLED request:${ctx.id} reason:SPEED_CHANGED ${prevSpeedR.current}x -> ${speed}x.`);
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

  const startSession=useCallback(async(mode,replayDateOverride=null,tailMinutes=0,sessionIdOverride=null)=>{
    const targetReplayDate=replayDateOverride||selectedReplayDate;
    setReplayLoadError("");
    let replayData=null;
    if(mode==="seed"){
      setReplayLoading(true);
      try{replayData=await loadUnifiedSeed();}
      catch(error){console.error("SEED_START_LOAD_FAILED",error);setReplayLoadError(`Seed unavailable: ${String(error?.message||error)}`);return;}
      finally{setReplayLoading(false);}
    }
    if(mode==="replay"){
      setReplayLoading(true);
      try{replayData=replayDateOverride?await replayDataFor(replayDateOverride):await replayDataFor(selectedReplayDate);}
      catch(error){console.error("REPLAY_START_LOAD_FAILED",targetReplayDate,error);setReplayLoadError(String(error?.message||error));return;}
      finally{setReplayLoading(false);}
      if(!replayData){setReplayLoadError(`Replay unavailable: ${targetReplayDate}`);return;}
    }
    premarketContextR.current=mode==="replay"?(replayData?.premarketContext||null):null;
    const tailCount=mode==="replay"?Math.max(0,Math.min(60,Number(tailMinutes)||0)):0;
    const expectedStartTick=tailCount>0?Math.max(1,1216-tailCount+1):1;
    engR.current=createReplayEngine(replayData,expectedStartTick);
    const sess=engR.current.getSession();
    archetypeIdR.current=mode==="seed"?replayData.seedId:null;
    const label=mode==="replay"?`${replayData.label}  |  ${replayData.dayType}`:`SEED  |  UNIFIED ALL-DATA 20S  |  ${replayData.quality.sourceDayCount} source days`;
    setSessionLabel(label);setSessionMode(mode);setBal(STARTING_BALANCE);balR.current=STARTING_BALANCE;catastrophicStopR.current=false;
    setPos(null);posR.current=null;setTradeIntentData({action:"WAIT",direction:null,readiness:0,confidence:0,contract:null,blockers:["Session warming up"],supportingFactors:[]});tradeIntentR.current={action:"WAIT",readiness:0,confidence:0,blockers:["Session warming up"],supportingFactors:[]};setTradeLog([]);logR.current=[];setMindsetLog([]);mindR.current=[];tradeMemoryR.current=createSessionTradeMemory();reliabilityR.current={totalRequests:0,parseFailures:0,totalTrades:0,fallbackExecutions:0};if(activeDecisionR.current){activeDecisionR.current.cancelled=true;activeDecisionR.current.controller?.abort("SESSION_RESET");clearTimeout(activeDecisionR.current.timeoutId);}activeDecisionR.current=null;decisionSeqR.current=0;positionSeqR.current=0;latestMarketR.current=null;aiFreezeR.current=false;lastMeaningfulAiKeyR.current="";lastActiveWallR.current=Date.now();aiVetoAuditsR.current=[];
    setJournal([]);journalR.current=[];eventPostChainR.current=Promise.resolve();eventPostErrorR.current=null;eventSnapshotsR.current=[];eventCommittedTicksR.current=new Set();
    multiTimeframeR.current=createMultiTimeframeState();decisionCoreR.current=createDeterministicDecisionState();setMultiTimeframe({...multiTimeframeR.current});thoughtSessionIdR.current=sessionIdOverride||`firstsignal-sim-v1-${targetReplayDate}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;fetch(`${AGENT_BASE}/session/start`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:thoughtSessionIdR.current,replayDate:targetReplayDate,mode:tailCount>0?"tail-validation":mode,label:tailCount>0?`${label} | TAIL_VALIDATION_${tailCount}M`:label,productName:PRODUCT_NAME,productVersion:PRODUCT_VERSION,buildId:BUILD_ID,buildSequence:BUILD_SEQUENCE,validationMode:tailCount>0?"TAIL_VALIDATION":null,expectedStartTick})}).catch(()=>{});const aiBlindLabel=mode==="replay"?"BLIND_REPLAY_SESSION":label;const freshAiMemory={...createAiSessionMemory(aiBlindLabel),summary:"New session. Prior working thoughts archived; architecture memory retained.",entries:[]};aiSessionMemoryR.current=freshAiMemory;setAiSessionMemory(freshAiMemory);storageSet("ai_session_memory",freshAiMemory);setCandles([]);candR.current=[];setConfHist([]);
    setItsSPXHist([]);setItsSPYHist([]);setTimeline([]);tlR.current=[];
    setProbs({discovery:25,pin:25,transition:25,macro:25});setConfData({score:50,factors:[]});setOptionChain(null);
    lastSR.current="transition";tickR.current=expectedStartTick-1;thinkR.current=false;sessionTickData.current=[];cognitionQueueR.current=[];cognitionRunningR.current=false;cognitionSeqR.current=0;
    sessionOpenR.current=null;sessionHighR.current=-Infinity;sessionLowR.current=Infinity;aboveFepTotalR.current=0;belowFepTotalR.current=0;
    prevAccelR.current=0;lastAiTickR.current=-99;repeatWaitR.current=0;lastWaitReasonR.current="";lastMindsetKeyR.current="";optionMemoryR.current={};marketBrainR.current=createMarketBrain();setMarketBrain(marketBrainR.current);chopGateR.current="OFF";setChopGate("OFF");pinHistR.current=[];flipCrossR.current=[];lastFlipSideR.current=null;leadWrongTicksR.current=0;prevCallWallR.current=null;prevPutWallR.current=null;sessionModelR.current={leadOpp:0,leadCatch:0,leadReject:0,accelFollow:0,accelFail:0,pinWins:0,pinLosses:0,lastLeadState:"",lastAccelTick:-99};contextMemoryR.current=createContextMemory();metacognitionR.current=createMetacognitionState();
    setDone(false);setSaved(false);setGexInf(0.08);setPatchProposals([]);setPatchIdx(0);setLiveThought("");
    try {
      setLiveThought("Establishing Gemini Live continuity before replay...");
      const continuity = await geminiLiveTrader.establishContinuity();
      await fetch(`${AGENT_BASE}/trader/continuity`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(continuity)}).catch(()=>{});
    } catch (error) {
      const failure={...geminiLiveTrader.continuityStatus(),state:'CONTINUITY_BROKEN',breakReason:String(error?.message||error)};
      await fetch(`${AGENT_BASE}/trader/continuity`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(failure)}).catch(()=>{});
      await fetch(`${AGENT_BASE}/worker/control`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'PAUSE',reason:'TRADER_CONTINUITY_STARTUP_FAILED',error:failure.breakReason})}).catch(()=>{});
      setReplayLoadError(`Trader continuity startup failed: ${failure.breakReason}`);
      setLiveThought("");
      setRunning(false);
      setScreen("trading");
      return;
    }
    storageSet("interrupted",null);setRunning(true);setScreen("trading");
  },[selectedReplayDate]);

  campaignStartRef.current=startSession;
  useEffect(()=>{const q=new URLSearchParams(window.location.search);const visibleReplay=q.get("visibleReplay");if(!visibleReplay)return;const key=`visibleReplay:${visibleReplay}`;if(sessionStorage.getItem(key))return;sessionStorage.setItem(key,"1");setTimeout(()=>campaignStartRef.current?.("replay",visibleReplay,0),1200);},[]);
  useEffect(()=>{window.__FIRSTSIGNAL_START_REPLAY=(date,tailMinutes=0)=>campaignStartRef.current?.("replay",date||null,tailMinutes||0);return()=>{delete window.__FIRSTSIGNAL_START_REPLAY;};},[startSession]);
  useEffect(()=>{
    let alive=true;
    const poll=()=>{if(!window.__FIRSTSIGNAL_SPEED3X){window.__FIRSTSIGNAL_SPEED3X=true;setSpeed(3);}console.log("CAMPAIGN_POLL",AGENT_BASE,{alive,running,done,finalizing:finalizingR.current});return fetch(`${AGENT_BASE}/supervisor/command`).then(async r=>{const data=await r.json();console.log("CAMPAIGN_COMMAND_RESPONSE",r.status,data);return data;}).then(async({command})=>{
      if(!alive||!command||command.type!=="START_REPLAY"||campaignCommandR.current===command.id||running||done||finalizingR.current){console.log("CAMPAIGN_COMMAND_SKIPPED",{alive,command,running,done,finalizing:finalizingR.current,current:campaignCommandR.current});return;}
      const claimedSessionId=`firstsignal-sim-v1-${command.replayDate||selectedReplayDate}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      const claim=await fetch(`${AGENT_BASE}/supervisor/command/ack`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({commandId:command.id,sessionId:claimedSessionId,claimedBy:`browser-${window.name||"tab"}`})});
      if(!claim.ok){console.log("CAMPAIGN_COMMAND_ALREADY_CLAIMED",command.id);campaignCommandR.current=command.id;return;}
      const claimed=await claim.json();
      if(claimed?.command?.sessionId!==claimedSessionId){console.log("CAMPAIGN_COMMAND_CLAIM_MISMATCH",claimed);campaignCommandR.current=command.id;return;}
      campaignCommandR.current=command.id;
      if(command.replayDate)setSelectedReplayDate(command.replayDate);
      await campaignStartRef.current?.("replay",command.replayDate||null,command.tailMinutes||0,claimedSessionId);
    }).catch(error=>console.error("CAMPAIGN_POLL_ERROR",error));};
    poll();const id=setInterval(poll,2000);return()=>{alive=false;clearInterval(id);};
  },[running,done]);

  useEffect(()=>{
    let alive=true,lastStamp=null;
    const poll=()=>fetch(`${AGENT_BASE}/worker/control`).then(r=>r.json()).then(control=>{
      if(!alive||!control?.updatedAt||control.updatedAt===lastStamp)return; lastStamp=control.updatedAt;
      if(Number(control.speed)>0)setSpeed(Number(control.speed));
      if(control.action==="PAUSE"||control.action==="STOP")setRunning(false);
      if(control.action==="RUN"&&engR.current&&!done)setRunning(true);
      if(control.action==="RETRY_FINALIZATION"){
        geminiLiveTrader.connecting=null;
        geminiLiveTrader.close('recovery-retry');
        finalizingR.current=false;
        setSaved(false);
        setTimeout(()=>saveSessionRef.current?.(),500);
      }
    }).catch(()=>{});
    poll();const id=setInterval(poll,750);return()=>{alive=false;clearInterval(id);};
  },[done]);

  useEffect(()=>{
    let alive=true,busy=false;
    const poll=async()=>{if(!alive||busy)return;busy=true;try{
      const data=await fetch(`${AGENT_BASE}/trader/interview/next`).then(r=>r.json());
      if(data?.item){
        let answer=null,error=null;
        try{answer=await geminiLiveTrader.answerSupervisor(data.item.prompt);}catch(e){error=String(e?.message||e);}
        await fetch(`${AGENT_BASE}/trader/interview/respond`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:data.item.id,answer,error})});
      }
      await fetch(`${AGENT_BASE}/trader/continuity`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(geminiLiveTrader.continuityStatus())});
    }catch{}finally{busy=false;}};
    poll();const id=setInterval(poll,1000);return()=>{alive=false;clearInterval(id);};
  },[]);

  useEffect(()=>{
    if(!running)return;
    let stopped=false;
    const id=setInterval(async()=>{
      const continuity=geminiLiveTrader.continuityStatus();
      if(stopped||continuity.state!=='CONTINUITY_BROKEN')return;
      stopped=true;
      clearInterval(id);
      setRunning(false);
      setReplayLoadError(`Replay aborted: Trader continuity broke (${continuity.breakReason||'unknown error'}).`);
      addJournal('SYSTEM',`TRADER_CONTINUITY_BROKEN ${continuity.breakReason||'unknown error'}; replay halted at tick ${tickR.current}.`);
      await fetch(`${AGENT_BASE}/trader/continuity`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(continuity)}).catch(()=>{});
      await fetch(`${AGENT_BASE}/worker/control`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'PAUSE',reason:'TRADER_CONTINUITY_BROKEN',tick:tickR.current,error:continuity.breakReason||null})}).catch(()=>{});
    },250);
    return()=>clearInterval(id);
  },[running,addJournal]);

  const resumeSession=useCallback(async()=>{
    const sv=storageGet("interrupted",null);if(!sv)return;
    balR.current=sv.bal;setBal(sv.bal);if(sv.pos){posR.current=sv.pos;setPos(sv.pos);}
    logR.current=sv.log||[];setTradeLog([...logR.current]);mindR.current=sv.mindset||[];setMindsetLog([...mindR.current]);
    journalR.current=sv.journal||[];setJournal([...journalR.current]);aiSessionMemoryR.current=sv.aiSessionMemory||storageGet("ai_session_memory",createAiSessionMemory(sv.sessionLabel||"RESUMED"));setAiSessionMemory({...aiSessionMemoryR.current});candR.current=sv.candles||[];setCandles([...candR.current]);
    tlR.current=sv.timeline||[];setTimeline([...tlR.current]);setSessionLabel(sv.sessionLabel||"RESUMED");setSessionMode(sv.sessionMode||"seed");
    archetypeIdR.current=sv.archetypeId||null;
    let replayData=null;
    if(sv.sessionMode==="seed"){
      setReplayLoading(true);setReplayLoadError("");
      try{replayData=await loadUnifiedSeed(sv.archetypeId||null);}
      catch(error){setReplayLoadError(`Seed resume unavailable: ${String(error?.message||error)}`);return;}
      finally{setReplayLoading(false);}
    }
    if(sv.sessionMode==="replay"){
      setReplayLoading(true);setReplayLoadError("");
      try{replayData=await replayDataFor(sv.replayDate);}
      catch(error){setReplayLoadError(String(error?.message||error));return;}
      finally{setReplayLoading(false);}
    }
    if(sv.sessionMode==="replay"&&!replayData){storageSet("interrupted",null);setResumeAvailable(false);return;}
    engR.current=createReplayEngine(replayData);
    for(let i=0;i<Math.min(sv.tick||0,400);i++)engR.current.tick();
    tickR.current=sv.tick||0;setDone(false);setRunning(true);setScreen("trading");storageSet("interrupted",null);setResumeAvailable(false);
  },[]);

  const fastFwd=useCallback(()=>{
    if(!engR.current)return;clearInterval(ivR.current);setRunning(false);
    const eng=engR.current;let m=eng.peek();
    while(!((m.h>SESSION_END_H)||(m.h===SESSION_END_H&&m.m>=SESSION_END_M))){m=eng.tick();tickR.current++;const mL=(SESSION_END_H*60+SESSION_END_M)-(m.h*60+m.m),octx=optionCtx(m,candR.current,optionMemoryR.current);if(posR.current&&m.isTradeable){const p0=posR.current,k=`${p0.isCall?'C':'P'}${p0.strike}`,np=priceOpt(m.spySpot,p0.strike,m.iv,mL,p0.isCall,{...octx,prev:optionMemoryR.current[k]});optionMemoryR.current[k]={price:np,peak:Math.max(optionMemoryR.current[k]?.peak||np,np)};posR.current={...posR.current,current:np};}}
    if(posR.current){const p=posR.current,size=p.size||balR.current,r=(p.current/p.entry-1)*100,dollar=size*r/100;balR.current=size*(p.current/p.entry);logR.current=[...logR.current,{t:fmt.time(16,0),action:`AUTO-CLOSE ${p.strike}${p.isCall?"C":"P"}`,result:`${fmt.pct(r)} (${dollar>=0?"+":""}${fmt.bal(dollar)})`,pnl:r,dollarPnl:dollar}];setTradeLog([...logR.current]);posR.current=null;setPos(null);}
    setMkt(m);setBal(balR.current);setDone(true);storageSet("interrupted",null);
    setTimeout(()=>saveSessionRef.current?.(),0);
  },[]);

  const saveSession=useCallback(async()=>{
    if(finalizingR.current||saved)return;
    finalizingR.current=true;
    cognitionQueueR.current=[];
    if(activeDecisionR.current){
      const active=activeDecisionR.current;
      active.cancelled=true;
      clearTimeout(active.timeoutId);
      try{active.controller?.abort("SESSION_FINALIZATION");}catch{}
      activeDecisionR.current=null;
      aiFreezeR.current=false;
      thinkR.current=false;
      setThinking(false);
      setLiveThought("");
      addJournal("END",`FINALIZATION_PREEMPTED_ACTIVE_REQUEST request:${active.id||"UNKNOWN"} kind:${active.cognitionClass||"UNKNOWN"}.`);
    }
    geminiLiveTrader.cancelPendingTurn?.("SESSION_FINALIZATION");
    const r=((balR.current-STARTING_BALANCE)/STARTING_BALANCE)*100,cl=logR.current.filter(l=>l.pnl!==undefined),ws=cl.filter(l=>(l.pnl||0)>=0);
    const signalTotal=sessionModelR.current.accelFollow+sessionModelR.current.accelFail,signalCleanliness=signalTotal?sessionModelR.current.accelFollow/signalTotal:0,tradeFollowThrough=cl.length?cl.filter(t=>(t.pnl||0)>0).length/cl.length:0;
    const reliability=reliabilityRates(reliabilityR.current);
    const tradeDiagnostics=buildTradeDiagnostics(tradeMemoryR.current.attempts,sessionTickData.current);
    const sess={id:Date.now(),metacognition:metacognitionR.current,tradeDiagnostics,aiSessionMemory:aiSessionMemoryR.current,signalCleanliness,tradeFollowThrough,...reliability,fallbackUsed:reliability.fallbackExecutionRate>0,gexVelocityState:thesisR.current?.gexVelocity?.state||"OSCILLATING",marketBrain:marketBrainR.current,name:`SIM  |  ${sessionLabel}  |  ${r>=0?"+":""}${r.toFixed(0)}%`,date:new Date().toLocaleDateString(),balance:balR.current,returnPct:r,trades:logR.current,mindset:mindR.current,journal:journalR.current,timeline:tlR.current,winRate:cl.length>0?`${ws.length}/${cl.length}`:"—",label:sessionLabel,tickData:sessionTickData.current};
    const upd=[sess,...sessions];setSessions(upd);storageSet("sessions",upd);setSaved(true);
    setThinking(true);
    try{
      const orderedEvents=[...eventSnapshotsR.current].sort((a,b)=>a.tick-b.tick);
      const eventDigest=orderedEvents.filter((e,i)=>i===0||i===orderedEvents.length-1||e.tick%60===0||e.position||e.balance!==orderedEvents[Math.max(0,i-1)]?.balance||e.intent?.action!==orderedEvents[Math.max(0,i-1)]?.intent?.action).map(e=>({tick:e.tick,time:e.time,balance:Number(e.balance?.toFixed?.(2)??e.balance),position:e.position?{side:e.position.side,strike:e.position.strike,entry:e.position.entry,current:e.position.current}:null,spy:Number(e.market?.spy?.toFixed?.(2)??e.market?.spy),spx:Number(e.market?.spx?.toFixed?.(1)??e.market?.spx),gexSpx:e.market?.gexSpx,itsSPX:e.market?.itsSPX,itsSPY:e.market?.itsSPY,intent:e.intent?.action||"WAIT",readiness:e.intent?.executionReadiness??e.intent?.readiness??0})).slice(-80);
      const decisionDigest=journalR.current.filter(x=>/AI_DECISION_ACCEPTED|ENTRY_EXECUTED|ENTRY_BLOCKED|THESIS_INVALIDATED|DRAWDOWN_REVIEW|FORECAST_(CREATED|HIT|MISSED)|STALE_DECISION_DISCARDED|TICK_BINDING_VIOLATION/.test(x.entry||"")).slice(-50);
      const balanceMilestones=orderedEvents.filter((e,i)=>i===0||i===orderedEvents.length-1||Math.abs(e.balance-(orderedEvents[Math.max(0,i-1)]?.balance??e.balance))>0.01).map(e=>({tick:e.tick,time:e.time,balance:Number(e.balance?.toFixed?.(2)??e.balance)}));
      const openEntries=[];const canonicalTradeLedger=[];
      for(const row of logR.current){
        if(/CANONICAL FILL BUY/.test(row.action||'')){openEntries.push(row);continue;}
        if(row.pnl===undefined)continue;
        const entry=openEntries.shift()||null,id=`T${canonicalTradeLedger.length+1}`;
        canonicalTradeLedger.push({id,entryTime:entry?.t||null,entryAction:entry?.action||null,exitTime:row.t,exitAction:row.action,result:row.result||null,pnlPct:Number(row.pnl),dollarPnl:Number(row.dollarPnl||0),exitType:row.exitType||null,entrySpot:row.entrySpot??null,exitSpot:row.exitSpot??null});
      }
      const validTradeIds=new Set(canonicalTradeLedger.map(x=>x.id));
      const validTradeTimes=new Set(canonicalTradeLedger.flatMap(x=>[x.entryTime,x.exitTime]).filter(Boolean).map(String));
      const validateClosingReflection=(candidate)=>{
        const errors=[];const text=`${candidate?.private_reflection||''} ${candidate?.next_session_handoff||''}`;
        const cited=[...(candidate?.referenced_trade_ids||[]),...(candidate?.factual_claims||[]).flatMap(x=>x?.evidence_trade_ids||[])];
        for(const id of cited)if(!validTradeIds.has(id))errors.push(`UNKNOWN_TRADE_ID:${id}`);
        const markers=[...text.matchAll(/\[(T\d+)\]/g)].map(m=>m[1]);for(const id of markers)if(!validTradeIds.has(id))errors.push(`UNKNOWN_INLINE_TRADE_ID:${id}`);
        for(const claim of candidate?.factual_claims||[])if(!(claim?.evidence_trade_ids||[]).length)errors.push(`FACTUAL_CLAIM_WITHOUT_EVIDENCE:${String(claim?.claim||'').slice(0,120)}`);
        return [...new Set(errors)];
      };
      const closingChecksum={simulationTime:{tickSeconds:20,replaySpeedIrrelevant:true,start:orderedEvents[0]?.time,end:orderedEvents.at(-1)?.time,eventCount:orderedEvents.length},finalBalance:balR.current,returnPct:r,tradeCount:cl.length,wins:ws.length,canonicalTradeLedger,tradeDiagnostics,balanceMilestones,regimeTimeline:tlR.current.slice(-40),majorForecasts:metacognitionR.current.forecasts.slice(-12),decisionDigest,eventDigest,recentJournal:journalR.current.filter(x=>!/AI_RESPONSE_FAILURE|FALLBACK_DECISION|PROVIDER_THROTTLED|TURN_DRAIN_TIMEOUT/i.test(x.entry||"" )).slice(-20),structuredSameTraderContinuity:aiSessionMemoryR.current,wholeDayState:{marketBrain:marketBrainR.current,sessionModel:sessionModelR.current,tradeMemory:tradeMemoryR.current,sessionOpen:sessionOpenR.current,sessionHigh:sessionHighR.current,sessionLow:sessionLowR.current,aboveFepTicks:aboveFepTotalR.current,belowFepTicks:belowFepTotalR.current},finalIntent:tradeIntentR.current||null,unresolvedThesis:thesisR.current||null};
      const closingPrompt=`The trading session is over. The FACTUAL_CHECKSUM below is the only authority for factual claims. Do not reconstruct missing events from memory, narrative continuity, journal impressions, or model intuition. Every sentence that mentions a specific trade, CALL/PUT entry or exit, clock time, dollar result, or percentage result MUST include the matching canonical trade marker like [T3]. You may discuss general process lessons without a marker, but never invent an event. Populate referenced_trade_ids and factual_claims using only listed IDs. If a belief appears in the journal but no matching canonical trade exists, describe it only as an unexecuted belief, never as a trade. Replay speed is irrelevant. Briefly state what was learned without overfitting. Call submit_closing_reflection exactly once.
FACTUAL_CHECKSUM:${JSON.stringify(closingChecksum)}`;
      let closing=null,lastClosingError=null,validationErrors=[];
      for(let attempt=1;attempt<=3&&!closing;attempt++){
        try{
          const correction=validationErrors.length?`
PRIOR DRAFT REJECTED BY FACT GATE: ${validationErrors.join(' | ')}. Rewrite from scratch using only canonical trade IDs.`:'';
          const candidate=await geminiLiveTrader.requestClosingReflection(closingPrompt+correction);
          validationErrors=validateClosingReflection(candidate);
          if(validationErrors.length)throw new Error(`REFLECTION_FACT_GATE:${validationErrors.join('|')}`);
          closing={...candidate,validation:{status:'PASSED',validatedAt:new Date().toISOString(),canonicalTradeIds:[...validTradeIds]}};
        }
        catch(e){
          lastClosingError=e;
          const providerRuntime=geminiLiveTrader.runtimeStatus?.()||{};
          const retryAfter=Math.max(0,Number(providerRuntime.retryAfterMs)||0);
          console.log(`closing reflection attempt ${attempt} failed`,e);
          fetch(`${AGENT_BASE}/session/finalization-diagnostic`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:thoughtSessionIdR.current,replayDate:selectedReplayDate,phase:'CLOSING_ATTEMPT',attempt,error:String(e?.message||e),continuity:geminiLiveTrader.continuityStatus(),provider:providerRuntime,retryAfterMs:retryAfter})}).catch(()=>{});
          if(attempt<3){
            const closingError=String(e?.message||e);
            const recoveryDelay=retryAfter>0?retryAfter+1500:/TRADER_CLOSING_REFLECTION_TIMEOUT/.test(closingError)?60000:30000;
            await new Promise(r=>setTimeout(r,recoveryDelay));
          }
        }
      }
      if(!closing)console.log("closing reflection failed",lastClosingError);
      if(!closing?.private_reflection||!closing?.next_session_handoff)throw new Error('SAME_TRADER_CLOSING_REFLECTION_REQUIRED');
      metacognitionR.current.endSession=closing;metacognitionR.current.drawdownReview={...metacognitionR.current.drawdownReview,active:false,completedAt:new Date().toISOString(),reflection:closing.private_reflection||""};
      await fetch(`${AGENT_BASE}/session/reflection-draft`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:thoughtSessionIdR.current,replayDate:selectedReplayDate,privateReflection:closing.private_reflection,nextSessionHandoff:closing.next_session_handoff,referencedTradeIds:closing.referenced_trade_ids||[],factualClaims:closing.factual_claims||[],traderContinuity:geminiLiveTrader.continuityStatus(),state:"CAPTURED_BEFORE_FINALIZATION"})}).then(async r=>{if(!r.ok)throw new Error(`REFLECTION_DRAFT_${r.status}:${await r.text()}`)});
      const closingEntries=[{t:"END",entry:`PRIVATE_SESSION_REFLECTION ${closing.private_reflection||"Unavailable"}`},{t:"HANDOFF",entry:`NEXT_SESSION_HANDOFF ${closing.next_session_handoff||"Carry forward uncertainty."}`}];
      journalR.current=[...journalR.current,...closingEntries];setJournal([...journalR.current]);
      persistThought({session_id:thoughtSessionIdR.current,market_time:"END",kind:"session_reflection",content:closing.private_reflection||"",decision:"SESSION_END",spot:latestMarketR.current?.spySpot??null,metadata:{next_session_handoff:closing.next_session_handoff||"",forecast_count:metacognitionR.current.forecasts.length}}).catch(()=>{});
      const finalized={...sess,journal:journalR.current,metacognition:JSON.parse(JSON.stringify(metacognitionR.current)),privateReflection:closing.private_reflection||"",nextSessionHandoff:closing.next_session_handoff||""};
      const finalizedSessions=[finalized,...sessions];setSessions(finalizedSessions);storageSet("sessions",finalizedSessions);
      const props=await generatePatchProposals(logR.current,mindR.current,[...journalR.current,{t:"END",entry:closing.private_reflection},{t:"HANDOFF",entry:closing.next_session_handoff}],{balance:balR.current,returnPct:r,trades:cl.length,wins:ws.length,label:sessionLabel,forecasts:metacognitionR.current.forecasts,tradeDiagnostics});if(props.length>0){setPatchProposals(props);setPatchIdx(0);setScreen("patch");}
    }catch(e){
      console.log("patch gen failed",e);
      fetch(`${AGENT_BASE}/session/finalization-diagnostic`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:thoughtSessionIdR.current,replayDate:selectedReplayDate,phase:'FINALIZATION_OUTER',error:String(e?.message||e),continuity:geminiLiveTrader.continuityStatus(),provider:geminiLiveTrader.runtimeStatus?.()||null})}).catch(()=>{});
      if(String(e?.message||e).includes("SAME_TRADER_CLOSING_REFLECTION_REQUIRED")){addJournal("END","SAME_TRADER_REFLECTION_PENDING: run saved for development review; no synthetic or substitute reflection created. Compounding promotion remains blocked until the original Trader completes reflection.");}
      await fetch(`${AGENT_BASE}/session/reflection-draft`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:thoughtSessionIdR.current,replayDate:selectedReplayDate,privateReflection:metacognitionR.current.endSession?.private_reflection||"",nextSessionHandoff:metacognitionR.current.endSession?.next_session_handoff||"",traderContinuity:geminiLiveTrader.continuityStatus(),state:"FINALIZATION_ERROR",error:String(e?.message||e)})}).catch(()=>{});
    }
    finally{
      await eventPostChainR.current;
      const canonicalEvents=[...eventSnapshotsR.current].sort((a,b)=>a.tick-b.tick);
      const reconcileResp=await fetch(`${AGENT_BASE}/events/finalize`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:thoughtSessionIdR.current,events:canonicalEvents,expectedStartTick:canonicalEvents[0]?.tick||1,expectedEndTick:canonicalEvents.at(-1)?.tick||canonicalEvents[0]?.tick||1,validationMode:(canonicalEvents[0]?.tick||1)>1?"TAIL_VALIDATION":null})});
      if(!reconcileResp.ok)throw new Error(`EVENT_RECONCILE_${reconcileResp.status}:${await reconcileResp.text()}`);
      const reconcile=await reconcileResp.json();
      const expectedEventCount=(canonicalEvents.at(-1)?.tick||0)-(canonicalEvents[0]?.tick||1)+1;
      if(reconcile.eventCount!==expectedEventCount)throw new Error(`EVENT_RECONCILE_COUNT_${reconcile.eventCount}_EXPECTED_${expectedEventCount}`);
      if(!metacognitionR.current.endSession?.private_reflection||!metacognitionR.current.endSession?.next_session_handoff){
        console.error('SESSION_BLOCKED_AWAITING_SAME_TRADER_REFLECTION');
        setThinking(false);finalizingR.current=false;return;
      }
      const endResp=await fetch(`${AGENT_BASE}/session/end`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:thoughtSessionIdR.current,replayDate:selectedReplayDate,productName:PRODUCT_NAME,productVersion:PRODUCT_VERSION,buildId:BUILD_ID,buildSequence:BUILD_SEQUENCE,reflectionComplete:true,traderContinuity:geminiLiveTrader.continuityStatus(),privateReflection:metacognitionR.current.endSession.private_reflection,nextSessionHandoff:metacognitionR.current.endSession.next_session_handoff,referencedTradeIds:metacognitionR.current.endSession.referenced_trade_ids||[],factualClaims:metacognitionR.current.endSession.factual_claims||[]})});
      if(!endResp.ok)throw new Error(`SESSION_END_${endResp.status}:${await endResp.text()}`);
      await fetch(`${AGENT_BASE}/trader/continuity`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(geminiLiveTrader.continuityStatus())}).catch(()=>{});
      setThinking(false);finalizingR.current=false;
    }
  },[sessions,sessionLabel,saved,selectedReplayDate]);
  saveSessionRef.current=saveSession;

  const handlePatch=useCallback((action,denyNote="")=>{
    const prop=patchProposals[patchIdx];if(!prop)return;
    const nr={...rules};
    if(action==="approve")nr.approved=[...rules.approved,{id:Date.now(),rule:prop.rule,reasoning:prop.reasoning,date:new Date().toLocaleDateString()}];
    else if(action==="waitlist")nr.waitlist=[...rules.waitlist,{...prop,date:new Date().toLocaleDateString()}];
    else if(action==="deny")nr.denied=[...(rules.denied||[]),{...prop,note:denyNote,date:new Date().toLocaleDateString()}];
    setRules(nr);storageSet("rules",nr);
    if(patchIdx<patchProposals.length-1){setPatchIdx(i=>i+1);setPatchDenyNote("");}else{setScreen("home");}
  },[rules,patchProposals,patchIdx]);

  const livePositionEquity=pos?(Number(pos.cashReserve||0)+Number(pos.remainingSize??pos.size??0)*(Number(pos.current||pos.entry)/Math.max(.01,Number(pos.entry||.01)))):bal;
  const displayBal=pos?livePositionEquity:bal;
  const pnl=((displayBal-STARTING_BALANCE)/STARTING_BALANCE)*100;
  const topS=[alphaRegime.type,alphaRegime.confidence];
  const topColors={BREAKOUT_UP:T.accent,BREAKDOWN_DOWN:T.red,REVERSAL_UP:T.accent,REVERSAL_DOWN:T.red,PIN_HARVEST:T.yellow,BALANCE:T.purple,UNRESOLVED:T.muted};
  const topColor=topColors[topS[0]]||T.muted;
  const posPnl=pos?(pos.current/pos.entry-1)*100:0;
  const posDollar=pos?((pos.remainingSize??pos.size??balR.current)*(pos.current/pos.entry-1)):0;
  const mLeft=mkt?(SESSION_END_H*60+SESSION_END_M)-(mkt.h*60+mkt.m):390;
  const isPremarket=mkt?.isPremarket||false;
  const lastM=mindsetLog[mindsetLog.length-1];
  const div=mkt?(mkt.itsSPX-mkt.itsSPY):0;
  const divColor=div>0.5?T.accent:div<-0.5?T.red:T.yellow;

  
  const selectedReplayData=replayMetaFor(selectedReplayDate);
  const selectedReplayQuality=replayQualityFor(selectedReplayDate);
  const replayQualityColor=selectedReplayQuality.level==="GREEN"?T.accent:selectedReplayQuality.level==="YELLOW"?T.yellow:T.red;
if(screen==="home")return(
    <div style={{background:T.bg,minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"monospace"}}>
      <div style={{fontSize:9,color:T.muted,letterSpacing:"0.2em",marginBottom:8}}>FIRSTSIGNAL SIM v1</div>
      <div style={{fontSize:26,fontWeight:700,color:T.accent,marginBottom:4}}>FirstSignal Sim v1</div>
      <div style={{fontSize:9,color:T.muted,marginBottom:28,textAlign:"center",opacity:0.6}}>Regime-aware SPY 0DTE research engine</div>
      {resumeAvailable&&<button onClick={resumeSession} style={{width:"100%",maxWidth:280,padding:"11px 0",background:T.yellowDim,color:T.yellow,border:`1px solid ${T.yellow}40`,borderRadius:6,fontFamily:"monospace",fontSize:11,fontWeight:700,cursor:"pointer",marginBottom:10}}>RESUME SESSION</button>}
      <div style={{width:"100%",maxWidth:280,marginBottom:16}}>
        <div style={{fontSize:9,color:T.muted,marginBottom:8,textAlign:"center",letterSpacing:"0.1em"}}>NEW SESSION | BUILD {BUILD_SEQUENCE}</div>
        <select value={selectedReplayDate} disabled={replayLoading} onChange={e=>{setSelectedReplayDate(e.target.value);setReplayLoadError("");}} style={{width:"100%",marginBottom:8,padding:"8px 10px",background:T.surface,color:T.text,border:`1px solid ${T.border}`,borderRadius:6,fontFamily:"monospace",fontSize:10,opacity:replayLoading?0.6:1}}>
          {AVAILABLE_REPLAY_DATES.map(d=>{const q=replayQualityFor(d),data=replayMetaFor(d);return <option key={d} value={d}>{q.level} | {data?.label||d} | {q.label}</option>;})}
        </select>
        <div style={{marginBottom:8,padding:"8px 10px",background:selectedReplayQuality.level==="GREEN"?T.accentDim:selectedReplayQuality.level==="YELLOW"?T.yellowDim:"#ef444418",border:`1px solid ${replayQualityColor}55`,borderRadius:6,color:replayQualityColor,fontSize:8,lineHeight:1.45}}>
          <div style={{fontWeight:700,marginBottom:3}}>{selectedReplayQuality.level}  |  {selectedReplayQuality.label}</div>
          <div>{selectedReplayQuality.summary}</div>
          {selectedReplayQuality.missingEssential?.length>0&&<div style={{marginTop:4}}>Missing: {selectedReplayQuality.missingEssential.join("  |  ")}</div>}
        </div>
        {replayLoadError&&<div style={{marginBottom:8,padding:"7px 9px",background:T.redDim,color:T.red,border:`1px solid ${T.red}55`,borderRadius:5,fontSize:8}}>REPLAY LOAD FAILED  |  {replayLoadError}</div>}
        <div style={{display:"flex",gap:8}}>
          <button disabled={replayLoading} onClick={()=>startSession("seed")} style={{flex:1,padding:"12px 0",background:T.accentDim,color:T.accent,border:`1px solid ${T.accent}40`,borderRadius:6,fontFamily:"monospace",fontSize:11,fontWeight:700,cursor:replayLoading?"wait":"pointer",opacity:replayLoading?0.55:1}}>SEED<div style={{fontSize:8,opacity:0.7,marginTop:2}}>14-day unified transition pool</div></button>
          <button disabled={replayLoading} onClick={()=>startSession("replay")} style={{flex:1,padding:"12px 0",background:"#a78bfa18",color:T.purple,border:`1px solid ${T.purple}40`,borderRadius:6,fontFamily:"monospace",fontSize:11,fontWeight:700,cursor:replayLoading?"wait":"pointer",opacity:replayLoading?0.65:1}}>{replayLoading?"LOADING...":"REPLAY"}<div style={{fontSize:8,opacity:0.7,marginTop:2}}>{selectedReplayData?.label||"Select date"}</div></button>
        </div>
      </div>
      <div style={{width:"100%",maxWidth:280,display:"flex",gap:8,marginBottom:16}}>
        <button onClick={()=>setScreen("sessions")} style={{flex:1,padding:"10px 0",background:"transparent",color:T.muted,border:`1px solid ${T.border}`,borderRadius:6,fontFamily:"monospace",fontSize:10,cursor:"pointer"}}>SESSIONS ({sessions.length})</button>
        <button onClick={()=>setScreen("rulebook")} style={{flex:1,padding:"10px 0",background:"transparent",color:T.muted,border:`1px solid ${T.border}`,borderRadius:6,fontFamily:"monospace",fontSize:10,cursor:"pointer"}}>RULES ({rules.approved.length})</button>
      </div>
      {sessions.length>0&&<div style={{width:"100%",maxWidth:280,padding:"10px 12px",background:T.surface,borderRadius:6,border:`1px solid ${T.border}`}}><div style={{fontSize:9,color:T.muted,marginBottom:3}}>LAST SESSION</div><div style={{fontSize:10,color:T.text}}>{sessions[0].name}</div><div style={{fontSize:9,color:T.muted,marginTop:2}}>{sessions[0].date}  |  W/L {sessions[0].winRate}</div></div>}
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
        {rules.approved.map((r,i)=><div key={i} style={{padding:"10px 12px",background:T.surface,borderRadius:6,border:`1px solid ${T.accent}30`,marginBottom:8}}><div style={{fontSize:10,color:T.text,marginBottom:4}}>{r.rule}</div><div style={{fontSize:9,color:T.muted}}>{r.date}  |  {r.reasoning}</div></div>)}
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
        <button onClick={()=>{if(patchDenyNote.trim())handlePatch("deny",patchDenyNote);}} disabled={!patchDenyNote.trim()} style={{width:"100%",padding:"10px 0",background:T.redDim,color:T.red,border:`1px solid ${T.red}40`,borderRadius:4,fontFamily:"monospace",fontSize:10,cursor:"pointer",opacity:patchDenyNote.trim()?1:0.4}}>DENY</button>
      </div>
      <button onClick={()=>setScreen("home")} style={{marginTop:16,padding:"8px 20px",background:"transparent",color:T.muted,border:`1px solid ${T.border}`,borderRadius:4,fontFamily:"monospace",fontSize:9,cursor:"pointer"}}>{"SKIP ALL -> HOME"}</button>
    </div>
  );}

  return(
    <div style={{background:T.bg,minHeight:"100vh",fontFamily:"monospace",color:T.text,display:"flex",flexDirection:"column"}}>
      {!qaStatus.startsWith("OFFLINE")&&<div style={{position:"fixed",top:44,right:10,zIndex:9999,display:"flex",alignItems:"center",gap:7,padding:"5px 9px",background:"#0e1117ee",border:`1px solid ${qaStatus.includes("APPROVAL")?T.red:qaStatus==="ANALYZING"?T.yellow:T.accent}88`,borderRadius:999,boxShadow:"0 4px 18px #0008",cursor:"default",maxWidth:220}} title={`Independent observer | ${qaFolder}`}><span style={{width:7,height:7,borderRadius:"50%",flex:"0 0 auto",background:qaStatus.includes("APPROVAL")?T.red:qaStatus==="ANALYZING"?T.yellow:T.accent}}/><span style={{fontSize:8,fontWeight:700,color:qaStatus.includes("APPROVAL")?T.red:qaStatus==="ANALYZING"?T.yellow:T.accent,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>OBSERVER {qaStatus}</span></div>}
      <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:"6px 14px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:3}}>
          <div style={{display:"flex",alignItems:"center",gap:7}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:running?T.accent:done?T.muted:T.yellow,boxShadow:running?`0 0 6px ${T.accent}`:"none"}}/>
            <span style={{fontSize:9,fontWeight:700,color:T.accent}}>{PRODUCT_NAME.toUpperCase()} {PRODUCT_VERSION}  |  {BUILD_ID}</span>
            {isPremarket&&<span style={{fontSize:7,color:T.yellow,border:`1px solid ${T.yellow}40`,padding:"1px 4px",borderRadius:2}}>PRE</span>}
            {mkt?.synthData&&<span style={{fontSize:7,color:T.purple,border:`1px solid ${T.purple}40`,padding:"1px 4px",borderRadius:2}}>CHAIN SYNTH</span>}
            {thinking&&<span style={{fontSize:9,color:T.yellow}}>THINKING</span>}
          </div>
          <div style={{display:"flex",gap:6}}>
            {running&&<><button onClick={fastFwd} style={{padding:"3px 7px",background:T.yellowDim,color:T.yellow,border:`1px solid ${T.yellow}40`,borderRadius:3,fontFamily:"monospace",fontSize:8,cursor:"pointer"}}>END</button><button onClick={()=>{setRunning(false);clearInterval(ivR.current);}} style={{padding:"3px 7px",background:T.redDim,color:T.red,border:`1px solid ${T.red}40`,borderRadius:3,fontFamily:"monospace",fontSize:8,cursor:"pointer"}}>PAUSE</button></>}
            {!running&&!done&&mkt&&<button onClick={()=>setRunning(true)} style={{padding:"3px 8px",background:T.accentDim,color:T.accent,border:`1px solid ${T.accent}40`,borderRadius:3,fontFamily:"monospace",fontSize:8,cursor:"pointer"}}>RESUME</button>}
          </div>
        </div>
        <div style={{fontSize:8,color:T.muted,marginBottom:2}}>{sessionLabel}{sessionMode==="seed"&&mkt?.fidelity&&<span style={{color:mkt.fidelity==="dense-series"?T.accent:T.yellow}}>  |  {mkt.fidelity==="dense-series"?"dense (Jul 1 series)":"sparse (field-log range)"}</span>}</div>
        <div style={{fontSize:7,color:T.purple,marginBottom:2,opacity:0.85}}>{sessionMode==="seed"?`Dual-stream archetype mode | SPX fidelity: ${mkt?.spxFidelity||"estimated"}`:`${selectedReplayDate} native SPY/SPX | 1-minute replay | chain ${mkt?.quoteSource||"NONE"}`}</div>
        {thesisData?.contextHierarchy&&<><div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:3}}><span style={{fontSize:7,color:T.purple,border:`1px solid ${T.purple}55`,padding:"1px 4px",borderRadius:3}}>STRUCT {thesisData.contextHierarchy.structural?.state||"WAIT"} {Math.round(thesisData.contextHierarchy.structural?.confidence||0)}% | held {thesisData.contextHierarchy.structural?.age||0}m | stable {Math.round(thesisData.contextHierarchy.structural?.stability||0)}%</span><span style={{fontSize:7,color:T.accent,border:`1px solid ${T.accent}55`,padding:"1px 4px",borderRadius:3}}>LOCAL {thesisData.contextHierarchy.local?.state||"OBSERVE"} | {thesisData.contextHierarchy.local?.direction||"NONE"} | heat {Math.round(thesisData.contextHierarchy.structural?.heat||0)}%</span></div>{thesisData.contextHierarchy.rubberBand&&<div style={{fontSize:7,color:T.muted,marginBottom:3,lineHeight:1.45}}>SPX ITS {thesisData.contextHierarchy.rubberBand.spx.absolute.toFixed(2)} / base {thesisData.contextHierarchy.rubberBand.spx.structuralBaseline.toFixed(2)} / local {thesisData.contextHierarchy.rubberBand.spx.localDeviation>=0?"+":""}{thesisData.contextHierarchy.rubberBand.spx.localDeviation.toFixed(2)} | SPY ITS {thesisData.contextHierarchy.rubberBand.spy.absolute.toFixed(2)} / base {thesisData.contextHierarchy.rubberBand.spy.structuralBaseline.toFixed(2)} / local {thesisData.contextHierarchy.rubberBand.spy.localDeviation>=0?"+":""}{thesisData.contextHierarchy.rubberBand.spy.localDeviation.toFixed(2)} | FEP Δ SPX {thesisData.contextHierarchy.rubberBand.spx.fepDistance>=0?"+":""}{thesisData.contextHierarchy.rubberBand.spx.fepDistance.toFixed(1)} / SPY {thesisData.contextHierarchy.rubberBand.spy.fepDistance>=0?"+":""}{thesisData.contextHierarchy.rubberBand.spy.fepDistance.toFixed(2)} | {thesisData.contextHierarchy.rubberBand.interpretation.resolution}</div>}</>}
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {mkt&&<span style={{fontSize:10,color:isPremarket?T.yellow:T.muted,fontWeight:700}}>{fmt.time(mkt.h,mkt.m)} ET</span>}
          {mLeft<90&&!isPremarket&&<span style={{fontSize:8,color:T.red}}>THETA</span>}
          <span style={{fontSize:13,fontWeight:700,color:pnl>=0?T.accent:T.red}}>{fmt.bal(displayBal)}</span>
          <span style={{fontSize:9,color:pnl>=0?T.accent:T.red}}>{fmt.pct(pnl)}</span>
          <span style={{fontSize:8,color:topColor,marginLeft:"auto"}}>{topS[0].toUpperCase()} {topS[1]}%</span>
        </div>
        {tradeIntentData&&<div style={{marginTop:6}}><TradeIntentPanel intent={tradeIntentData} embedded/></div>}
      </div>

      {pos&&(()=>{const originalCapital=Number(pos.originalSize||pos.size||0),remainingCapital=Number(pos.remainingSize??pos.size??0);return <div style={{margin:"6px 14px 0",padding:"8px 12px",background:posPnl>=0?T.accentDim:T.redDim,border:`1px solid ${posPnl>=0?T.accent:T.red}40`,borderRadius:6,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><div style={{fontSize:8,color:T.muted}}>OPEN  |  {pos.entryTime}  |  {Math.round(pos.exposurePct??100)}% EXPOSED</div><div style={{fontSize:12,fontWeight:700}}>{pos.strike}{pos.isCall?"C":"P"}  |  ${pos.entry.toFixed(2)}</div><div style={{fontSize:8,color:T.muted,marginTop:2}}>SPY ${mkt?.spySpot?.toFixed(2)??"?"}  |  entry ${pos.entrySpot?.toFixed(2)??"?"}  |  ? {mkt&&pos.entrySpot!=null?`${mkt.spySpot-pos.entrySpot>=0?"+":""}${(mkt.spySpot-pos.entrySpot).toFixed(2)}`:"?"}</div>{pos.positionManager&&<div style={{fontSize:8,color:T.yellow,marginTop:3}}>{pos.positionStage}  |  HOLD {pos.holdConfidence}%  |  OPP {pos.positionOpportunityRemaining}%  |  CONVEXITY {pos.convexityRemaining}%  |  ADVERSE LEGS {pos.positionManager.adverseLegs||0}</div>}</div>
        <div style={{textAlign:"right"}}><div style={{fontSize:10,color:T.text,fontWeight:800,marginBottom:2}}>{(remainingCapital/(Math.max(.01,pos.entry)*100)).toFixed(1)} CONTRACTS HELD</div><div style={{fontSize:15,fontWeight:700,color:posPnl>=0?T.accent:T.red}}>{posDollar>=0?"+":"-"}${Math.abs(posDollar).toFixed(0)}</div><div style={{fontSize:9,color:posPnl>=0?T.accent:T.red}}>{fmt.pct(posPnl)}</div></div>
      </div>})()}

      <div style={{flex:1,overflowY:"auto",paddingBottom:20}}>
        {mkt&&<div style={{background:T.surface,borderRadius:8,border:`1px solid ${isPremarket?T.yellow+"40":T.border}`,margin:"8px 14px",overflow:"hidden"}}>
          <PriceChart candles={candles} gammaFlip={mkt.gammaFlip} callWall={mkt.callWall} putWall={mkt.putWall} position={pos} isPremarket={isPremarket} callTrigger={callTrigger} putTrigger={putTrigger} callStop={callStop} putStop={putStop}/>
          <div style={{padding:"7px 12px",borderTop:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{fontSize:18,fontWeight:700}}>${mkt.spySpot.toFixed(2)}</div><div style={{fontSize:8,color:mkt.spySpot>mkt.gammaFlip?T.accent:T.red}}>{mkt.spySpot>mkt.gammaFlip?"▲":"▼"} FLIP ${mkt.gammaFlip.toFixed(1)}</div></div>
            <div style={{textAlign:"center"}}><div style={{fontSize:9,color:T.muted}}>SPX GEX {fmt.gex(mkt.netGexSpx??mkt.netGex*10)}</div><div style={{fontSize:12,fontWeight:700,color:T.purple}}>{mkt.spxSpot.toFixed(0)}</div><div style={{fontSize:7,color:T.muted}}>SPY GEX {fmt.gex(mkt.netGex)}</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:10,fontWeight:700,color:mkt.netGex>0?T.accent:T.red}}>{fmt.gex(mkt.netGex)}</div><div style={{fontSize:7,color:mkt.netGex>0?T.accent:T.red}}>{mkt.netGex>0?"PIN":"AMP"} {(gexInf*100).toFixed(0)}%</div></div>
          </div>
        </div>}

        {mkt&&<MultiTimeframePanel state={multiTimeframe}/>}

        {mkt&&<GexPanel mkt={mkt} candles={candles} gexInf={gexInf}/>}

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
              <div style={{fontSize:8,color:T.muted,marginTop:3}}>{mkt.spxSpot.toFixed(0)}  |  GEX {fmt.gex(mkt.netGexSpx??mkt.netGex*10)}</div>
              <div style={{fontSize:6,color:sessionMode==="replay"&&!mkt.synthData?T.accent:T.yellow,marginTop:2,letterSpacing:"0.04em"}}>{sessionMode==="replay"?(mkt.quoteSource==="REAL"?"DERIVED  |  native SPX GEX/call-dom":"DERIVED  |  native SPX GEX/call-dom  |  chain synthetic"):"SYNTH  |  archetype"}</div>
            </div>
            <div style={{flex:1,background:T.surface2,borderRadius:6,padding:"8px 10px"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:8,color:T.text}}>SPY ITS</span>
                <span style={{fontSize:11,fontWeight:700,color:T.text}}>{mkt.itsSPY.toFixed(2)}</span>
              </div>
              <Spark data={itsSPYHist} color={T.text} h={32} w={130} fill={false}/>
              <div style={{fontSize:8,color:T.muted,marginTop:3}}>${mkt.spySpot.toFixed(2)}  |  GEX {fmt.gex(mkt.netGex)}</div>
              <div style={{fontSize:6,color:T.accent,marginTop:2,letterSpacing:"0.04em"}}>DERIVED  |  native SPY GEX/call-dom</div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginTop:8}}>
            {[["NDF",(mkt.ndf>=0?"+":"")+mkt.ndf.toFixed(3),mkt.ndf>0.1?T.accent:mkt.ndf<-0.1?T.red:T.muted],["FEP GAP",(mkt.spySpot-mkt.fep>=0?"+":"")+(mkt.spySpot-mkt.fep).toFixed(2),Math.abs(mkt.spySpot-mkt.fep)>1.5?T.yellow:T.muted],["IV",mkt.iv.toFixed(1)+"%",T.muted]].map(([l,v,c])=>(
              <div key={l}><div style={{fontSize:8,color:T.muted}}>{l}</div><div style={{fontSize:11,fontWeight:700,color:c}}>{v}</div></div>
            ))}
          </div>
        </div>}

        {mkt&&<details open style={{background:T.surface,borderRadius:8,border:`1px solid ${T.border}`,margin:"0 14px 8px",padding:"9px 12px"}}>
          <summary style={{fontSize:9,color:T.purple,letterSpacing:"0.1em",cursor:"pointer"}}>AI THOUGHTS JOURNAL  |  {thoughtSync}  |  {aiSessionMemory.entries?.length||0} NOTES</summary>
          <pre style={{whiteSpace:"pre-wrap",fontSize:9,lineHeight:1.65,color:T.text,maxHeight:320,overflowY:"auto",margin:"10px 0 8px",fontFamily:"Consolas, monospace"}}>{aiMemoryText(aiSessionMemory,{recentEntries:30})}{liveThought?`\n\n[WRITING NOW]\n${liveThought}▌`:""}</pre>
          <button onClick={()=>{const blob=new Blob([aiMemoryText(aiSessionMemory,{includeAllEntries:true})],{type:"text/plain"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`firstsignal-sim-v1-ai-thoughts-${selectedReplayDate}.txt`;a.click();URL.revokeObjectURL(a.href);}} style={{fontSize:8,padding:"5px 8px",background:T.surface2,color:T.purple,border:`1px solid ${T.purple}55`,borderRadius:4,cursor:"pointer"}}>EXPORT ALL NOTES .TXT</button>
        </details>}

        <div style={{background:T.surface,borderRadius:8,border:`1px solid ${qaReports.at(-1)?.level==="RED"?T.red:qaReports.at(-1)?.level==="YELLOW"?T.yellow:T.accent}55`,margin:"0 14px 8px",padding:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:9,color:T.muted,letterSpacing:"0.1em"}}>FIRSTSIGNAL SIM v1 QA AGENT</span>
            <span style={{fontSize:8,color:qaStatus.includes("APPROVAL")?T.red:qaStatus==="ANALYZING"?T.yellow:T.accent}}>{qaStatus}</span>
          </div>
          <div style={{fontSize:7,color:T.muted,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",marginBottom:6}} title={qaFolder}>SAVES TO: {qaFolder}</div>
          <div style={{display:"flex",gap:6,marginBottom:8}}><button onClick={()=>fetch(`${AGENT_BASE}/open-folder`,{method:"POST"})} style={{fontSize:7,padding:"4px 7px",background:T.surface2,color:T.accent,border:`1px solid ${T.accent}44`,borderRadius:3,cursor:"pointer"}}>OPEN NOTEBOOK FOLDER</button><button onClick={()=>fetch(`${AGENT_BASE}/choose-folder`,{method:"POST"}).then(r=>r.json()).then(s=>s?.reportFolder&&setQaFolder(s.reportFolder))} style={{fontSize:7,padding:"4px 7px",background:T.surface2,color:T.yellow,border:`1px solid ${T.yellow}44`,borderRadius:3,cursor:"pointer"}}>CHANGE FOLDER</button></div>
          {qaReports.length===0?<div style={{fontSize:8,color:T.muted}}>Independent observer starts after 20 replay ticks. GREEN logs autonomously. YELLOW suggests isolated testing. RED requires approval.</div>:qaReports.slice(-3).reverse().map(r=>{
            const color=r.level==="RED"?T.red:r.level==="YELLOW"?T.yellow:T.accent;
            return <div key={r.id} style={{marginBottom:7,padding:"7px 9px",background:T.surface2,borderLeft:`3px solid ${color}`,borderRadius:4}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:8}}><span style={{fontSize:9,color,fontWeight:700}}>{r.level}  |  {r.title}</span><span style={{fontSize:7,color:T.muted}}>{r.t}</span></div>
              <div style={{fontSize:8,color:T.text,marginTop:3,lineHeight:1.45}}>{r.summary}</div>
              <div style={{fontSize:7,color:T.muted,marginTop:3}}>{r.category}  |  confidence {Math.round((r.confidence||0)*100)}%  |  {r.approval_required?"APPROVAL REQUIRED":"NO APPROVAL"}</div>
              {r.suggested_action&&<div style={{fontSize:8,color,marginTop:4}}>NEXT: {r.suggested_action}</div>}
            </div>;
          })}
        </div>

        <TradeIntentPanel intent={tradeIntentData}/> 
        {mkt&&<OptionChainPanel chain={optionChain} pos={pos}/>}

        {mkt&&<div style={{background:T.surface,borderRadius:8,border:`1px solid ${T.border}`,margin:"0 14px 8px",padding:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:9,color:T.muted,letterSpacing:"0.1em"}}>ALPHA REGIME</span>
            <span style={{fontSize:10,fontWeight:700,color:topColor}}>{String(topS[0]).replaceAll("_"," ")} {topS[1]}%</span>
          </div>
          <div style={{fontSize:8,color:T.text,lineHeight:1.5}}>{(alphaRegime.evidence||[]).join("  ?  ")||"No qualified tradable regime"}</div>
          <div style={{fontSize:8,color:alphaRegime.harvest?T.accent:T.muted,marginTop:5}}>{alphaRegime.harvest?`HARVEST ACTIVE${alphaRegime.side?`  |  ${alphaRegime.side}`:""}`:"OBSERVE ONLY  |  no campaign harvest qualified"}</div>
          <div style={{fontSize:7,color:T.muted,marginTop:5}}>GEX is context only: {mkt.netGex>0?"positive dealer exposure":"negative dealer exposure"}; influence score is not execution authority.</div>
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
                  <span style={{fontSize:9,color:topColors[r.state]||T.muted,fontWeight:700}}>{String(r.state).replaceAll("_"," ")}</span>
                  <span style={{fontSize:8,color:T.muted,marginLeft:"auto"}}>{r.side||"?"} {r.confidence||0}%</span>
                </div>
              ))}
            </div>}
          </div>
        </div>}

        <div style={{background:T.surface,borderRadius:8,border:`1px solid ${T.border}`,margin:"0 14px 8px",padding:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:9,color:T.muted,letterSpacing:"0.1em"}}>DECISION STREAM</span>
              <button onClick={()=>setShowMindsetAll(o=>!o)} style={{fontSize:7,color:T.muted,background:"none",border:`1px solid ${T.border}`,borderRadius:3,padding:"1px 5px",cursor:"pointer"}}>{showMindsetAll?`ALL ${mindsetLog.length}`:"RECENT 5"}</button>
            </div>
            {thinking&&<div style={{fontSize:9,color:T.yellow}}>AI deciding...</div>}
          </div>
          {journal.length>0&&<div style={{marginBottom:8,padding:"6px 8px",background:T.surface2,borderRadius:4,borderLeft:`2px solid ${T.purple}`}}>
            <div style={{fontSize:8,color:T.purple,marginBottom:3}}>SESSION JOURNAL</div>
            {journal.slice(-2).map((j,i)=><div key={i} style={{fontSize:8,color:T.muted,marginBottom:2}}><span style={{color:T.accent}}>{cleanUiText(j.t)}</span> {cleanUiText(j.entry)}</div>)}
          </div>}
          {mindsetLog.length===0&&<div style={{fontSize:9,color:T.dim,textAlign:"center",padding:"10px 0"}}>Waiting...</div>}
          {(showMindsetAll?[...mindsetLog].reverse():[...mindsetLog].reverse().slice(0,5)).map((e,i)=>(
            <div key={i} style={{marginBottom:7,padding:"7px 9px",borderRadius:4,background:T.surface2,borderLeft:`2px solid ${e.decision?.includes("BUY")?T.yellow:e.decision==="SELL"?T.accent:e.edgeState==="NO_EDGE"?T.red:T.border}`}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                <span style={{fontSize:7,color:T.muted}}>{e.t}</span>
                <span style={{fontSize:7,color:T.muted}}>{e.edgeState} [{e.score}]</span>
              </div>
              <div style={{fontSize:9,color:T.yellow,marginBottom:2}}>{cleanUiText(e.mindset)}</div>
              <div style={{fontSize:8,color:T.muted}}>{cleanUiText(e.reasoning)}</div>
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
          <div style={{fontSize:8,color:T.muted,marginBottom:5}}>SPEED  |  {speed}x</div>
          <input type="range" min="0.5" max="10" step="0.5" value={speed} onChange={e=>setSpeed(Number(e.target.value))} style={{width:"100%",accentColor:T.accent}}/>
        </div>

        {done&&<div style={{background:pnl>=0?T.accentDim:T.redDim,borderRadius:8,border:`1px solid ${pnl>=0?T.accent:T.red}40`,margin:"0 14px 8px",padding:16,textAlign:"center"}}>
          <div style={{fontSize:9,color:T.muted,marginBottom:3}}>SESSION COMPLETE</div>
          <div style={{fontSize:9,color:T.muted,marginBottom:8}}>{sessionLabel}</div>
          <div style={{fontSize:26,fontWeight:700,color:pnl>=0?T.accent:T.red}}>{fmt.bal(bal)}</div>
          <div style={{fontSize:13,color:pnl>=0?T.accent:T.red,marginBottom:14}}>{fmt.pct(pnl)}</div>
          <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
            <button onClick={saveSession} disabled={saved||thinking} style={{padding:"8px 14px",background:saved?T.accentDim:T.accent,color:saved?T.accent:T.bg,border:saved?`1px solid ${T.accent}`:"none",borderRadius:4,fontFamily:"monospace",fontSize:9,cursor:"pointer",fontWeight:700}}>{thinking?"ANALYZING...":saved?"✓ SAVED":"SAVE + PATCHES"}</button>
            <button onClick={async()=>{if(!saved)await saveSession();setScreen("home");}} style={{padding:"8px 14px",background:"transparent",color:T.muted,border:`1px solid ${T.border}`,borderRadius:4,fontFamily:"monospace",fontSize:9,cursor:"pointer"}}>HOME</button>
            <button onClick={()=>startSession(sessionMode||"seed")} style={{padding:"8px 14px",background:T.surface2,color:T.text,border:`1px solid ${T.border}`,borderRadius:4,fontFamily:"monospace",fontSize:9,cursor:"pointer"}}>NEW</button>
          </div>
        </div>}
      </div>
      <style>{`::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:${T.border};border-radius:2px}input[type=range]{height:3px}`}</style>
    </div>
  );
}


