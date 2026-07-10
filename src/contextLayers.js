const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
const slope=(a,key)=>a.length>=2?(a.at(-1)[key]-a[0][key])/Math.max(1,a.length-1):0;

export function createContextMemory(){
  return {structuralState:"WAIT",structuralConfidence:0,structuralAge:0,stability:0,heat:0,lastLocal:"WAIT",disagreementTicks:0,transitionCount:0};
}

function localState(m,h){
  const l6=h.slice(-6),l12=h.slice(-12),fg=m.spySpot-m.fep,ps=slope(l6,"spySpot"),as=slope(l6,"accel");
  const range=l12.length?Math.max(...l12.map(x=>x.spySpot))-Math.min(...l12.map(x=>x.spySpot)):0;
  const g0=l6[0]?.netGexSpx??m.netGexSpx??m.netGex,groc=((m.netGexSpx??m.netGex)-g0)/Math.max(1e9,Math.abs(g0||1e9));
  const pin=(m.netGexSpx??m.netGex)>0&&(m.gexInfluence||0)>.28&&range<1.5;
  const up=ps>.10&&fg>.18&&as>-.15,down=ps<-.10&&fg<-.18&&as>-.15;
  let state="WAIT",direction="NONE",confidence=25;
  if(pin&&Math.abs(fg)>.35){state="PIN_STRETCH";direction=fg>0?"PUT":"CALL";confidence=clamp(45+Math.abs(fg)*22+(m.gexInfluence||0)*20,0,96);}
  else if(up){state="EXPANSION_UP";direction="CALL";confidence=clamp(48+ps*28+Math.max(0,groc)*12,0,96);}
  else if(down){state="BREAKDOWN_DOWN";direction="PUT";confidence=clamp(48+Math.abs(ps)*28+Math.max(0,-groc)*12,0,96);}
  else if(pin){state="PIN_CENTER";confidence=55;}
  return {state,direction,confidence,priceSlope:ps,accelSlope:as,fepGap:fg,range12:range,gexRoc:groc};
}
export function computeItsHierarchy(m,h,prior=createContextMemory()){
  const local=localState(m,h),l30=h.slice(-30),price30=slope(l30,"spySpot")*Math.max(1,l30.length-1),fep30=slope(l30,"fep")*Math.max(1,l30.length-1);
  const above=l30.filter(x=>x.spySpot>x.fep).length,below=l30.filter(x=>x.spySpot<x.fep).length,accept=Math.max(above,below)/Math.max(1,l30.length);
  const meanGex=avg(l30.map(x=>x.netGexSpx??x.netGex??0)),meanGI=avg(l30.map(x=>x.gexInf||0));
  let candidate="WAIT",direction="NONE",raw=25;
  if(meanGex>0&&meanGI>.28&&Math.abs(price30)<2.2){candidate="PINNING";raw=45+meanGI*35+(accept<.72?8:0);}
  if(price30>1.0&&accept>.62){candidate="EXPANSION";direction="CALL";raw=52+Math.min(30,price30*8)+Math.max(0,fep30)*5;}
  if(price30<-1.0&&accept>.62){candidate="BREAKDOWN";direction="PUT";raw=52+Math.min(30,Math.abs(price30)*8)+Math.max(0,-fep30)*5;}
  const same=candidate===prior.structuralState,age=same?(prior.structuralAge||0)+1:1;
  const confidence=clamp((same?(prior.structuralConfidence||raw)*.72:raw*.55)+raw*(same?.28:.45),0,97);
  const localFamily=local.state.startsWith("PIN")?"PINNING":local.state==="EXPANSION_UP"?"EXPANSION":local.state==="BREAKDOWN_DOWN"?"BREAKDOWN":"WAIT";
  const disagree=candidate!=="WAIT"&&localFamily!=="WAIT"&&candidate!==localFamily;
  const disagreementTicks=disagree?(prior.disagreementTicks||0)+1:Math.max(0,(prior.disagreementTicks||0)-1);
  const heat=clamp(disagreementTicks*12+(!same?22:0)+(local.confidence>70&&disagree?18:0),0,100);
  const stability=clamp(age*7+confidence*.55-heat*.55,0,100),transitionRisk=heat>=55?"HIGH":heat>=30?"ELEVATED":"LOW";
  const lens=candidate==="PINNING"?"FADE_STRETCHES_AFTER_RESPONSE":candidate==="EXPANSION"?"HARVEST_CONTINUATION_AND_RELOAD":candidate==="BREAKDOWN"?"HARVEST_DOWNSIDE_CONTINUATION":"WAIT_FOR_STRUCTURE";
  return {structural:{state:candidate,direction,confidence,age,stability,heat,transitionRisk,lens,price30,fep30,acceptance:accept},local,alignment:disagree?"CONFLICT":localFamily===candidate?"ALIGNED":"NEUTRAL",memory:{structuralState:candidate,structuralConfidence:confidence,structuralAge:age,stability,heat,lastLocal:local.state,disagreementTicks,transitionCount:(prior.transitionCount||0)+(same?0:1)}};
}

export function computeFlowLens(flow){
  if(!flow||!flow.tradeCount)return {available:false,aggression:0,directionalPurity:0,hedgeProbability:0,direction:"NONE",label:"NO_FLOW_DATA"};
  const premium=Math.max(1,flow.totalPremium||0),askShare=(flow.askPremium||0)/premium,bidShare=(flow.bidPremium||0)/premium;
  const sweepShare=(flow.sweepPremium||0)/premium,blockShare=(flow.blockPremium||0)/premium,multiShare=(flow.multiExchangePremium||0)/premium;
  const directional=Math.abs(askShare-bidShare),packagePenalty=clamp((flow.clusteredLegs||0)*8+blockShare*28,0,55);
  const aggression=clamp(sweepShare*45+multiShare*25+(flow.maxPriceLevels||1)*6+(flow.maxContracts||0)/120,0,100);
  const directionalPurity=clamp(directional*105-packagePenalty+(flow.repeatedSameSide||0)*6,0,100);
  const hedgeProbability=clamp(35+packagePenalty+(flow.oppositeSideNear||0)*10-directional*35,0,100);
  const direction=askShare>bidShare+.08?((flow.callAskPremium||0)>(flow.putAskPremium||0)?"CALL":"PUT"):bidShare>askShare+.08?((flow.callBidPremium||0)>(flow.putBidPremium||0)?"PUT":"CALL"):"NONE";
  return {available:true,aggression,directionalPurity,hedgeProbability,direction,label:aggression>70?"URGENT":aggression>45?"ACTIVE":"ROUTINE",raw:flow};
}

export function contextPrompt(ctx,flow){
  if(!ctx)return "";
  const s=ctx.structural,l=ctx.local,f=flow||{available:false};
  const flowText=f.available?`${f.label} aggression ${f.aggression.toFixed(0)} directional-purity ${f.directionalPurity.toFixed(0)} hedge-probability ${f.hedgeProbability.toFixed(0)} direction ${f.direction}`:"unavailable";
  return `ITS HIERARCHY:\nSTRUCTURAL ${s.state} ${s.direction} conf ${s.confidence.toFixed(0)} persistence ${s.age}m stability ${s.stability.toFixed(0)} heat ${s.heat.toFixed(0)} transition ${s.transitionRisk} lens ${s.lens}\nLOCAL ${l.state} ${l.direction} conf ${l.confidence.toFixed(0)} fepGap ${l.fepGap.toFixed(2)} slope ${l.priceSlope.toFixed(2)} alignment ${ctx.alignment}\nFLOW LENS: ${flowText}\nHierarchy rule: structural ITS selects the playbook; local ITS selects timing; flow only changes conviction/urgency and never overrides contradictory price/regime structure.`;
}
export function harmonizeThesis(thesis,ctx,flow){
  if(!thesis||!ctx)return thesis;
  let {call,put,wait}=thesis.scores,s=ctx.structural,l=ctx.local;
  const aligned=ctx.alignment==="ALIGNED",conflict=ctx.alignment==="CONFLICT";
  if(s.state==="PINNING"&&l.state==="PIN_STRETCH"){if(l.direction==="CALL")call+=10;else put+=10;wait-=6;}
  if(s.state==="EXPANSION"&&s.direction==="CALL"){call+=aligned?14:7;put-=8;wait-=5;}
  if(s.state==="BREAKDOWN"&&s.direction==="PUT"){put+=aligned?14:7;call-=8;wait-=5;}
  if(conflict){wait+=8;call-=3;put-=3;}
  if(s.transitionRisk==="HIGH"){wait+=6;call-=2;put-=2;}
  if(flow?.available&&flow.direction!=="NONE"&&flow.directionalPurity>=55){const boost=Math.round(flow.aggression/12);if(flow.direction==="CALL")call+=boost;else put+=boost;}
  const total=Math.max(3,call+put+wait),scores={call:Math.round(call/total*100),put:Math.round(put/total*100),wait:Math.round(wait/total*100)};
  const winner=Object.entries(scores).sort((a,b)=>b[1]-a[1])[0][0],edgeScore=Object.values(scores).sort((a,b)=>b-a)[0]-Object.values(scores).sort((a,b)=>b-a)[1];
  const entryBias=scores.call>=42&&scores.call>scores.put+6&&scores.call>scores.wait?"CALL":scores.put>=42&&scores.put>scores.call+6&&scores.put>scores.wait?"PUT":"WAIT";
  return {...thesis,scores,winner,edgeScore,entryBias,state:entryBias==="CALL"?"ENTRY_READY_CALL":entryBias==="PUT"?"ENTRY_READY_PUT":thesis.state,contextHierarchy:ctx,flowLens:flow};
}
