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

function median(a){if(!a.length)return 0;const x=[...a].sort((a,b)=>a-b),i=Math.floor(x.length/2);return x.length%2?x[i]:(x[i-1]+x[i])/2;}
function rubberBandMap(m,h){
  const l30=h.slice(-30),l8=h.slice(-8);
  const spyBase=avg(l30.map(x=>x.itsSPY??m.itsSPY)),spxBase=avg(l30.map(x=>x.itsSPX??m.itsSPX));
  const spyLocal=m.itsSPY-spyBase,spxLocal=m.itsSPX-spxBase;
  const ratio=(m.spxSpot&&m.spySpot)?m.spxSpot/m.spySpot:10;
  const spyFep=m.fep,spxFep=Number.isFinite(m.spxFep)?m.spxFep:spyFep*ratio;
  const spyFepDistance=m.spySpot-spyFep,spxFepDistance=m.spxSpot-spxFep;
  const spxDistanceSpyUnits=spxFepDistance/Math.max(1,ratio);
  const fepDistanceDisagreement=spyFepDistance-spxDistanceSpyUnits;
  const spySlope=slope(l8,'itsSPY'),spxSlope=slope(l8,'itsSPX');
  const bothCentered=Math.abs(m.itsSPY-6)<=0.9&&Math.abs(m.itsSPX-6)<=0.9;
  const bothAwaySameWay=Math.sign(spyFepDistance)===Math.sign(spxFepDistance)&&Math.abs(spyFepDistance)>=0.65&&Math.abs(spxDistanceSpyUnits)>=0.65;
  const effectiveFepShiftCandidate=bothCentered&&bothAwaySameWay;
  const localStretch=Math.max(Math.abs(spyLocal),Math.abs(spxLocal));
  const structuralRelocation=Math.abs(spyBase-6)>=1.15&&Math.abs(spxBase-6)>=1.15&&Math.sign(spyBase-6)===Math.sign(spxBase-6);
  const leader=Math.abs(spxLocal)>Math.abs(spyLocal)?'SPX':Math.abs(spyLocal)>Math.abs(spxLocal)?'SPY':'NONE';
  const follower=leader==='SPX'?'SPY':leader==='SPY'?'SPX':'NONE';
  const resolution=effectiveFepShiftCandidate?'EFFECTIVE_CENTER_SHIFT_CANDIDATE':structuralRelocation?'STRUCTURAL_TERRITORY_RELOCATION':localStretch>=1.0?'LOCAL_STRETCH':Math.abs(fepDistanceDisagreement)>=0.45?'FEP_DISTANCE_DISAGREEMENT':'BALANCED_OR_UNRESOLVED';
  return{
    spy:{absolute:m.itsSPY,structuralBaseline:spyBase,localDeviation:spyLocal,fep:spyFep,fepDistance:spyFepDistance,slope:spySlope},
    spx:{absolute:m.itsSPX,structuralBaseline:spxBase,localDeviation:spxLocal,fep:spxFep,fepDistance:spxFepDistance,fepDistanceSpyUnits:spxDistanceSpyUnits,slope:spxSlope,fepSource:Number.isFinite(m.spxFep)?'NATIVE':'SPY_FEP_RATIO_SCALED'},
    cross:{itsGap:m.itsSPX-m.itsSPY,fepDistanceDisagreement,leader,follower},
    interpretation:{effectiveFepShiftCandidate,structuralRelocation,localStretch,resolution}
  };
}

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
  const rubberBand=rubberBandMap(m,h);
  return {structural:{state:candidate,direction,leader,confidence,age,stability,heat,transitionRisk,lens,meanGap,gapTrend,spxSlope,spySlope,persistence},local,rubberBand,alignment:directionalConflict?"CONFLICT":direction!=="NONE"&&direction===local.direction?"ALIGNED":"NEUTRAL",memory:{structuralState:candidate,structuralConfidence:confidence,structuralAge:age,stability,heat,lastLocal:local.state,disagreementTicks,transitionCount:(prior.transitionCount||0)+(same?0:1)}};
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
  const s=ctx.structural,l=ctx.local,r=ctx.rubberBand,f=flow||{available:false};
  const flowText=f.available?`${f.label} aggression ${f.aggression.toFixed(0)} directional-purity ${f.directionalPurity.toFixed(0)} hedge-probability ${f.hedgeProbability.toFixed(0)} direction ${f.direction}`:"unavailable at this timestamp";
  const rubber=r?`
RUBBER-BAND MAP (components remain separate; no master score):
SPY ITS ${r.spy.absolute.toFixed(2)} | structural baseline ${r.spy.structuralBaseline.toFixed(2)} | local deviation ${r.spy.localDeviation>=0?"+":""}${r.spy.localDeviation.toFixed(2)} | SPY-FEP distance ${r.spy.fepDistance>=0?"+":""}${r.spy.fepDistance.toFixed(2)}
SPX ITS ${r.spx.absolute.toFixed(2)} | structural baseline ${r.spx.structuralBaseline.toFixed(2)} | local deviation ${r.spx.localDeviation>=0?"+":""}${r.spx.localDeviation.toFixed(2)} | SPX-FEP distance ${r.spx.fepDistance>=0?"+":""}${r.spx.fepDistance.toFixed(1)} SPX pts (${r.spx.fepDistanceSpyUnits>=0?"+":""}${r.spx.fepDistanceSpyUnits.toFixed(2)} SPY-equivalent; ${r.spx.fepSource})
Cross relationships: ITS gap ${r.cross.itsGap>=0?"+":""}${r.cross.itsGap.toFixed(2)} | FEP-distance disagreement ${r.cross.fepDistanceDisagreement>=0?"+":""}${r.cross.fepDistanceDisagreement.toFixed(2)} SPY pts | leader ${r.cross.leader} | interpretation ${r.interpretation.resolution}`:"";
  return `ITS / TENSION HIERARCHY:
STRUCTURAL ${s.state} leader ${s.leader} direction ${s.direction} conf ${s.confidence.toFixed(0)} persistence ${s.age}m stability ${s.stability.toFixed(0)} meanGap ${s.meanGap.toFixed(2)} transition ${s.transitionRisk}
LOCAL ${l.state} leader ${l.leader} direction ${l.direction} conf ${l.confidence.toFixed(0)} gap ${l.gap.toFixed(2)} gapSlope ${l.gapSlope.toFixed(3)} alignment ${ctx.alignment}${rubber}
FLOW LENS: ${flowText}
Interpretation rule: preserve absolute SPX ITS, absolute SPY ITS, their own structural baselines, local deviations, and raw FEP distances. ITS divergence and FEP-distance disagreement are relationships only. Around 6 is balanced; movement toward roughly 9 or 3 is tension requiring context, not an automatic reversal signal. Persistent extremes may indicate structural relocation or a skewed effective FEP rather than a temporary stretch.`;
}

export function harmonizeThesis(thesis,ctx,flow){
  if(!thesis||!ctx)return thesis;
  let {call,put,wait}=thesis.scores,s=ctx.structural,l=ctx.local;
  const aligned=ctx.alignment==="ALIGNED",conflict=ctx.alignment==="CONFLICT";
  // ITS already participates in the base thesis. This pass is deliberately light
  // so the relationship map adds context without becoming a second dominant vote.
  if(s.state==="ITS_STRUCTURAL_DIVERGENCE"&&s.direction==="CALL")call+=aligned?3:1;
  if(s.state==="ITS_STRUCTURAL_DIVERGENCE"&&s.direction==="PUT")put+=aligned?3:1;
  if(l.state==="ITS_LOCAL_STRETCH"&&l.direction==="CALL")call+=2;
  if(l.state==="ITS_LOCAL_STRETCH"&&l.direction==="PUT")put+=2;
  if(l.state==="ITS_CATCHUP")wait+=1;
  if(l.state==="ITS_LEAD_REVERSAL"||conflict)wait+=4;
  if(s.transitionRisk==="HIGH")wait+=3;
  if(flow?.available&&flow.direction!=="NONE"&&flow.directionalPurity>=55){const boost=Math.min(5,Math.round(flow.aggression/20));if(flow.direction==="CALL")call+=boost;else put+=boost;}
  const total=Math.max(3,call+put+wait),scores={call:Math.round(call/total*100),put:Math.round(put/total*100),wait:Math.round(wait/total*100)};
  const sorted=Object.values(scores).sort((a,b)=>b-a),winner=Object.entries(scores).sort((a,b)=>b[1]-a[1])[0][0],edgeScore=sorted[0]-sorted[1];
  const entryBias=scores.call>=42&&scores.call>scores.put+6&&scores.call>scores.wait?"CALL":scores.put>=42&&scores.put>scores.call+6&&scores.put>scores.wait?"PUT":"WAIT";
  return {...thesis,scores,winner,edgeScore,entryBias,state:entryBias==="CALL"?"ENTRY_READY_CALL":entryBias==="PUT"?"ENTRY_READY_PUT":thesis.state,contextHierarchy:ctx,flowLens:flow};
}

