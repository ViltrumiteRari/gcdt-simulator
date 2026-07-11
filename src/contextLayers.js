const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
const slope=(a,key)=>a.length>=2?(a.at(-1)[key]-a[0][key])/Math.max(1,a.length-1):0;
const gapOf=x=>(x.itsSPX??0)-(x.itsSPY??0);
const directionFromSlopes=(spxSlope,spySlope)=>{
  const joint=(spxSlope+spySlope)/2;
  if(joint>.025)return "CALL";
  if(joint<-.025)return "PUT";
  const leader=Math.abs(spxSlope)>=Math.abs(spySlope)?spxSlope:spySlope;
  return leader>.035?"CALL":leader<-.035?"PUT":"NONE";
};

export function createContextMemory(){
  return {structuralState:"ITS_TRANSITION",structuralConfidence:0,structuralAge:0,stability:0,heat:0,lastLocal:"ITS_CONVERGED",disagreementTicks:0,transitionCount:0};
}

function localItsState(m,h){
  const l6=h.slice(-6),l12=h.slice(-12),gap=gapOf(m),startGap=l6.length?gapOf(l6[0]):gap;
  const gapSlope=l6.length>=2?(gap-startGap)/Math.max(1,l6.length-1):0;
  const spxSlope=slope(l6,"itsSPX"),spySlope=slope(l6,"itsSPY");
  const direction=directionFromSlopes(spxSlope,spySlope),leader=gap>.08?"SPX":gap<-.08?"SPY":"NONE";
  const priorAbs=Math.abs(startGap),nowAbs=Math.abs(gap),signFlip=Math.sign(gap)!==Math.sign(startGap)&&priorAbs>.18&&nowAbs>.18;
  let state="ITS_DEVELOPING",confidence=35;
  if(signFlip){state="ITS_LEAD_REVERSAL";confidence=clamp(58+nowAbs*24,0,96);}
  else if(nowAbs>=.55){state="ITS_LOCAL_STRETCH";confidence=clamp(48+nowAbs*28+Math.abs(gapSlope)*80,0,96);}
  else if(priorAbs-nowAbs>=.18){state="ITS_CATCHUP";confidence=clamp(50+(priorAbs-nowAbs)*70,0,94);}
  else if(nowAbs<.18){state="ITS_CONVERGED";confidence=clamp(58+(0.18-nowAbs)*100,0,92);}
  const range=l12.length?Math.max(...l12.map(gapOf))-Math.min(...l12.map(gapOf)):0;
  return {state,direction,leader,confidence,gap,gapSlope,spxSlope,spySlope,range12:range};
}

export function computeItsHierarchy(m,h,prior=createContextMemory()){
  const local=localItsState(m,h),l30=h.slice(-30),gaps=l30.map(gapOf),meanGap=avg(gaps);
  const spxSlope=slope(l30,"itsSPX"),spySlope=slope(l30,"itsSPY"),direction=directionFromSlopes(spxSlope,spySlope);
  const sign=Math.sign(meanGap),persistence=gaps.length?gaps.filter(x=>Math.sign(x)===sign&&Math.abs(x)>.15).length/gaps.length:0;
  const gapTrend=gaps.length>=2?(gaps.at(-1)-gaps[0])/Math.max(1,gaps.length-1):0;
  let candidate="ITS_TRANSITION",raw=35,leader=meanGap>.08?"SPX":meanGap<-.08?"SPY":"NONE";
  if(Math.abs(meanGap)>=.42&&persistence>=.62){candidate="ITS_STRUCTURAL_DIVERGENCE";raw=50+Math.abs(meanGap)*28+persistence*18;}
  else if(Math.abs(meanGap)<.20&&persistence<.55){candidate="ITS_STRUCTURAL_CONVERGENCE";raw=52+(0.20-Math.abs(meanGap))*80;}
  const same=candidate===prior.structuralState,age=same?(prior.structuralAge||0)+1:1;
  const confidence=clamp((same?(prior.structuralConfidence||raw)*.72:raw*.55)+raw*(same?.28:.45),0,97);
  const directionalConflict=direction!=="NONE"&&local.direction!=="NONE"&&direction!==local.direction;
  const disagreementTicks=directionalConflict?(prior.disagreementTicks||0)+1:Math.max(0,(prior.disagreementTicks||0)-1);
  const heat=clamp(disagreementTicks*14+(!same?22:0)+(local.state==="ITS_LEAD_REVERSAL"?22:0),0,100);
  const stability=clamp(age*7+confidence*.55-heat*.55,0,100),transitionRisk=heat>=55?"HIGH":heat>=30?"ELEVATED":"LOW";
  const lens=candidate==="ITS_STRUCTURAL_DIVERGENCE"?"PERSISTENT_LEAD_LAG":candidate==="ITS_STRUCTURAL_CONVERGENCE"?"CONVERGED_CONFIRMATION":"LEAD_LAG_REFORMING";
  return {structural:{state:candidate,direction,leader,confidence,age,stability,heat,transitionRisk,lens,meanGap,gapTrend,spxSlope,spySlope,persistence},local,alignment:directionalConflict?"CONFLICT":direction!=="NONE"&&direction===local.direction?"ALIGNED":"NEUTRAL",memory:{structuralState:candidate,structuralConfidence:confidence,structuralAge:age,stability,heat,lastLocal:local.state,disagreementTicks,transitionCount:(prior.transitionCount||0)+(same?0:1)}};
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
  const flowText=f.available?`${f.label} aggression ${f.aggression.toFixed(0)} directional-purity ${f.directionalPurity.toFixed(0)} hedge-probability ${f.hedgeProbability.toFixed(0)} direction ${f.direction}`:"unavailable at this timestamp";
  return `ITS DIVERGENCE HIERARCHY:\nSTRUCTURAL ${s.state} leader ${s.leader} direction ${s.direction} conf ${s.confidence.toFixed(0)} persistence ${s.age}m stability ${s.stability.toFixed(0)} meanGap ${s.meanGap.toFixed(2)} transition ${s.transitionRisk}\nLOCAL ${l.state} leader ${l.leader} direction ${l.direction} conf ${l.confidence.toFixed(0)} gap ${l.gap.toFixed(2)} gapSlope ${l.gapSlope.toFixed(3)} alignment ${ctx.alignment}\nFLOW LENS: ${flowText}\nHierarchy rule: Structural ITS describes persistent SPX/SPY lead-lag. Local ITS describes the current stretch, catch-up, convergence, or reversal. Neither is a pinning regime classifier.`;
}

export function harmonizeThesis(thesis,ctx,flow){
  if(!thesis||!ctx)return thesis;
  let {call,put,wait}=thesis.scores,s=ctx.structural,l=ctx.local;
  const aligned=ctx.alignment==="ALIGNED",conflict=ctx.alignment==="CONFLICT";
  if(s.state==="ITS_STRUCTURAL_DIVERGENCE"&&s.direction==="CALL"){call+=aligned?12:6;put-=6;}
  if(s.state==="ITS_STRUCTURAL_DIVERGENCE"&&s.direction==="PUT"){put+=aligned?12:6;call-=6;}
  if(l.state==="ITS_LOCAL_STRETCH"&&l.direction==="CALL")call+=6;
  if(l.state==="ITS_LOCAL_STRETCH"&&l.direction==="PUT")put+=6;
  if(l.state==="ITS_CATCHUP")wait+=3;
  if(l.state==="ITS_LEAD_REVERSAL"||conflict){wait+=8;call-=3;put-=3;}
  if(s.transitionRisk==="HIGH"){wait+=5;call-=2;put-=2;}
  if(flow?.available&&flow.direction!=="NONE"&&flow.directionalPurity>=55){const boost=Math.round(flow.aggression/12);if(flow.direction==="CALL")call+=boost;else put+=boost;}
  const total=Math.max(3,call+put+wait),scores={call:Math.round(call/total*100),put:Math.round(put/total*100),wait:Math.round(wait/total*100)};
  const sorted=Object.values(scores).sort((a,b)=>b-a),winner=Object.entries(scores).sort((a,b)=>b[1]-a[1])[0][0],edgeScore=sorted[0]-sorted[1];
  const entryBias=scores.call>=42&&scores.call>scores.put+6&&scores.call>scores.wait?"CALL":scores.put>=42&&scores.put>scores.call+6&&scores.put>scores.wait?"PUT":"WAIT";
  return {...thesis,scores,winner,edgeScore,entryBias,state:entryBias==="CALL"?"ENTRY_READY_CALL":entryBias==="PUT"?"ENTRY_READY_PUT":thesis.state,contextHierarchy:ctx,flowLens:flow};
}
