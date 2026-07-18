export const createAlphaRegimeState=()=>({version:1,active:{type:"UNRESOLVED",side:null,confidence:0,startedTick:0,heldTicks:0,evidence:[],harvest:false},candidate:null,history:[]});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const move=(h,n,m)=>h.length>n?m.spySpot-h.at(-n-1).spySpot:0;
const range=(h,n,m)=>{const x=[...h.slice(-n),m];return Math.max(...x.map(v=>v.spySpot))-Math.min(...x.map(v=>v.spySpot));};
export function updateAlphaRegime(state,{market:m,history:h=[],tick}){
 const s=state||createAlphaRegimeState(), m3=move(h,3,m),m9=move(h,9,m),m30=move(h,30,m),r12=range(h,12,m),r30=range(h,30,m);
 const fepGap=m.spySpot-m.fep, flipGap=m.spySpot-m.gammaFlip, posGex=m.netGex>0, accel=m.accelerator||0;
 const above=fepGap>.18&&flipGap>.12, below=fepGap<-.18&&flipGap<-.12;
 const expansionUp=(m3>.22&&m9>.45)||(m9>.60&&m30>.85), expansionDown=(m3<-.22&&m9<-.45)||(m9<-.60&&m30<-.85);
 const compression=r12<.55&&r30<1.15, wallNear=Math.min(Math.abs(m.spySpot-m.callWall),Math.abs(m.spySpot-m.putWall))<.65;
 const pinQualified=posGex&&compression&&Math.abs(fepGap)<.55&&wallNear&&accel<5.5;
 const breakoutUp=above&&expansionUp&&(!posGex||r12>.65)&&accel>=3.2;
 const breakdownDown=below&&expansionDown&&(!posGex||r12>.65)&&accel>=3.2;
 const reversalUp=m3>.28&&m9>.48&&m30<-.70&&above;
 const reversalDown=m3<-.28&&m9<-.48&&m30>.70&&below;
 let type='UNRESOLVED',side=null,score=28,evidence=[];
 if(reversalUp){type='REVERSAL_UP';side='CALL';score=72+Math.min(20,Math.abs(m3)*18);evidence=['failed downside','FEP/flip reclaimed','upside response'];}
 else if(reversalDown){type='REVERSAL_DOWN';side='PUT';score=72+Math.min(20,Math.abs(m3)*18);evidence=['failed upside','FEP/flip lost','downside response'];}
 else if(breakoutUp){type='BREAKOUT_UP';side='CALL';score=66+Math.min(24,m9*18);evidence=['upside acceptance','multi-window expansion',posGex?'positive GEX absorbed':'directional GEX freedom'];}
 else if(breakdownDown){type='BREAKDOWN_DOWN';side='PUT';score=66+Math.min(24,Math.abs(m9)*18);evidence=['downside acceptance','multi-window expansion',posGex?'positive GEX failed':'negative/weak GEX expansion'];}
 else if(pinQualified){type='PIN_HARVEST';score=68+Math.min(18,(.55-r12)*28);evidence=['positive GEX','compressed realized range','FEP/wall containment'];}
 else if(compression){type='BALANCE';score=48+Math.min(16,(.75-r12)*20);evidence=['compressed range','no accepted directional escape'];}
 const cand=s.candidate?.type===type?{...s.candidate,count:s.candidate.count+1,score}:{type,count:1,score};s.candidate=cand;
 const need=type==='UNRESOLVED'?2:type==='PIN_HARVEST'?6:3;
 if(s.active.type===type){s.active={...s.active,confidence:clamp(Math.round(score),0,100),heldTicks:(s.active.heldTicks||0)+1,evidence,harvest:type==='PIN_HARVEST'||type==='BREAKOUT_UP'||type==='BREAKDOWN_DOWN'};}
 else if(cand.count>=need){const prior=s.active;s.active={type,side,confidence:clamp(Math.round(score),0,100),startedTick:tick,heldTicks:1,evidence,harvest:type==='PIN_HARVEST'||type==='BREAKOUT_UP'||type==='BREAKDOWN_DOWN'};s.history=[...s.history,{tick,from:prior.type,to:type,side,confidence:s.active.confidence,evidence}].slice(-80);}
 return s;
}
