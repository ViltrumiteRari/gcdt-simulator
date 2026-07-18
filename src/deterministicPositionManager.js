const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;

export function updateDeterministicPositionManager(position,market,history=[],context={}){
  if(!position)return null;
  const prices=[...(position.contractHistory||[]),Number(position.current||position.entry)].slice(-24);
  const entry=Math.max(.01,Number(position.entry||.01));
  const current=Number(position.current||entry),peak=Math.max(Number(position.peakPrice||entry),current);
  const pnl=(current/entry-1)*100,peakPnl=(peak/entry-1)*100,drawdown=Math.max(0,peakPnl-pnl);
  const v3=prices.length>3?(prices.at(-1)-prices.at(-4))/entry*100:0;
  const v8=prices.length>8?(prices.at(-1)-prices.at(-9))/entry*100:v3;
  const recentVelocity=prices.length>5?mean(prices.slice(-4).map((v,i,a)=>i?(v-a[i-1])/entry*100:0).slice(1)):0;
  const priorVelocity=prices.length>9?mean(prices.slice(-9,-4).map((v,i,a)=>i?(v-a[i-1])/entry*100:0).slice(1)):recentVelocity;
  const velocityDecay=priorVelocity-recentVelocity;
  const legWindows=[3,6,9].filter(n=>prices.length>n).map(n=>(prices.at(-1)-prices.at(-1-n))/entry*100);
  const adverseLegs=legWindows.filter(v=>v<=-4).length;
  const severeAdverseLegs=legWindows.filter(v=>v<=-7).length;
  const dir=position.isCall?1:-1,spotProgress=dir*(market.spySpot-position.entrySpot);
  const bestSpot=position.isCall?(position.maxFavorableSpot-position.entrySpot):(position.entrySpot-position.maxFavorableSpot);
  const spotGiveback=Math.max(0,bestSpot-spotProgress);
  const remaining=clamp(Number(context.remainingOpportunity??position.positionOpportunityRemaining??70)-Math.max(0,drawdown*.45)-Math.max(0,spotGiveback*18),0,100);
  const thesisSupport=clamp(Number(context.thesisSupport??3),0,5),oppositeCount=clamp(Number(context.oppositeCount??0),0,5);
  const initialConfidence=clamp(Number(position.tradeConfidence||70),0,100);
  let holdConfidence=initialConfidence*.34+remaining*.34+thesisSupport*7-oppositeCount*9;
  holdConfidence+=recentVelocity>0?8:recentVelocity<-.5?-12:0;
  holdConfidence-=Math.min(28,drawdown*.32)+Math.min(16,Math.max(0,velocityDecay)*1.4);
  holdConfidence=clamp(Math.round(holdConfidence),0,100);
  let stage='BUILDING';
  if(pnl>=20&&recentVelocity>0)stage='EARLY_EXPANSION';
  if(pnl>=50&&v3>5)stage='FAST_EXPANSION';
  if(peakPnl>=55&&(velocityDecay>1.0||drawdown>=10||recentVelocity<0))stage='MATURE_EXPANSION';
  if(peakPnl>=70&&(drawdown>=16||recentVelocity<-.15||spotGiveback>.24))stage='EXHAUSTION';
  if(drawdown>=Math.max(28,peakPnl*.24)&&recentVelocity<0)stage='DISTRIBUTION';
  if(holdConfidence<38||oppositeCount>=3)stage='DEFENSIVE';
  const currentExposure=clamp(Number(position.exposurePct??100),0,100);
  let targetExposure=100,reason='edge still deserves full exposure';
  if(pnl>=20&&(holdConfidence<72||remaining<68||velocityDecay>1.5)){targetExposure=75;reason='first asymmetric value harvested';}
  if(peakPnl>=50&&(holdConfidence<62||remaining<52||drawdown>=14)){targetExposure=Math.min(targetExposure,50);reason='mature leg or reduced hold EV';}
  if(peakPnl>=100&&(holdConfidence<54||remaining<40||drawdown>=22||stage==='EXHAUSTION')){targetExposure=Math.min(targetExposure,25);reason='convexity largely realized';}
  if(peakPnl>=160&&(holdConfidence<46||remaining<28||stage==='DISTRIBUTION')){targetExposure=Math.min(targetExposure,10);reason='runner only after major expansion';}
  if(adverseLegs>=1&&currentExposure>50){targetExposure=Math.min(targetExposure,50);reason='first meaningful adverse leg cut exposure';}
  if(adverseLegs>=2||severeAdverseLegs>=1){targetExposure=Math.min(targetExposure,20);reason='two-leg contraction leaves runner only';}
  if(adverseLegs>=3&&recentVelocity<0){targetExposure=0;reason='persistent multi-leg contraction invalidated hold EV';}
  if(holdConfidence<24||stage==='DEFENSIVE'&&drawdown>=32){targetExposure=0;reason='hold EV no longer justifies exposure';}
  const scalePct=Math.max(0,currentExposure-targetExposure);
  const oppositeWatch=stage==='EXHAUSTION'||stage==='DISTRIBUTION'||(stage==='MATURE_EXPANSION'&&recentVelocity<0);
  const oppositeSide=position.isCall?'PUT':'CALL';
  return{stage,holdConfidence,oppositeWatch,oppositeSide,positionOpportunityRemaining:Math.round(remaining),convexityRemaining:Math.round(clamp(100-peakPnl*.38-drawdown*.28,0,100)),pnl,peakPnl,drawdown,v3,v8,recentVelocity,velocityDecay,spotProgress,bestSpot,spotGiveback,legWindows,adverseLegs,severeAdverseLegs,currentExposure,targetExposure,scalePct,reason,prices};
}
