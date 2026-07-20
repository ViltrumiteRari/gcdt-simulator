export const createDeterministicDecisionState=()=>({version:17,seq:0,active:null,neutralTicks:0,history:[],missedEntries:[],lastAction:'WAIT'});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const hardBlock=b=>/DATA_STALE|Market not tradeable|No valid contract|CONTRACT_INVALID|FINAL_THETA|existing position|no account equity/i.test(String(b||''));
const sideOf=a=>String(a||'').includes('CALL')?'CALL':String(a||'').includes('PUT')?'PUT':null;
const stageRank={NO_CAMPAIGN:0,EMERGING:1,CONFIRMED:2,ENTRY_WINDOW:3,IN_POSITION:4,MATURE:5,EXHAUSTED:6,REVERSING:7,RESET:8};
const mv=(h,n,m)=>h.length>n?m.spySpot-h.at(-n-1).spySpot:0;
const rng=(h,n,m)=>{const x=[...h.slice(-n),m];return Math.max(...x.map(v=>v.spySpot))-Math.min(...x.map(v=>v.spySpot));};
const chooseDirectionalContract=(chain,side)=>{
 const rows=side==='CALL'?chain?.calls:chain?.puts;if(!rows?.length)return null;
 const spot=Number(chain.spot),isCall=side==='CALL';
 const mapped=rows.map(x=>({...x,price:Number(x.price??x.mid??x.mark??x.bid),distance:Number(x.distance??Math.abs(Number(x.strike)-spot))}));
 let tier='QUALITY',c=mapped.filter(x=>Number.isFinite(x.price)&&x.price>=.12&&x.price<=.30&&x.distance<=5.5&&Math.abs(Number(x.delta||0))>=.035&&(isCall?x.strike>=spot+.5:x.strike<=spot-.5));
 if(!c.length){tier='AVAILABLE';c=mapped.filter(x=>Number.isFinite(x.price)&&x.price>=.05&&x.price<=.50&&x.distance<=6.5&&(isCall?x.strike>=spot-.25:x.strike<=spot+.25));}
 c.sort((a,b)=>Math.abs(a.price-.20)-Math.abs(b.price-.20)+Math.abs(Math.abs(a.delta||0)-.12)-Math.abs(Math.abs(b.delta||0)-.12));
 const x=c[0];return x?{strike:x.strike,price:x.price,delta:x.delta,distance:x.distance,side,tier,quality:tier,contract:x.contract||null,quoteSource:x.quoteSource||chain.quoteSource||'MODELED'}:null;
};
function newCampaign(state,side,tick,spot,reason){return{id:`${side}_${++state.seq}`,side,stage:'EMERGING',startedTick:tick,startedSpot:spot,lastTick:tick,lastSpot:spot,peakSpot:spot,troughSpot:spot,peakStrength:0,entryWindowTick:null,entryTaken:false,reason,transitions:[{tick,from:'NO_CAMPAIGN',to:'EMERGING',reason}]};}
function transition(c,to,tick,reason){if(c.stage===to)return c;if(to!=='RESET'&&(stageRank[to]??0)<(stageRank[c.stage]??0))return c;c.transitions=[...(c.transitions||[]),{tick,from:c.stage,to,reason}].slice(-30);c.stage=to;c.lastTick=tick;return c;}
export function updateDeterministicDecisionCore(state,input){
 const s=state||createDeterministicDecisionState();
 const {rawIntent,market:m,tick,dataHealth,transmission,position,history=[],alphaRegime,chain}=input;
 const proposed=rawIntent?.direction||sideOf(rawIntent?.action), d=rawIntent?.diagnostics||{};
 const proposedSign=proposed==='CALL'?1:proposed==='PUT'?-1:0;
 const activePrior=s.active;
 // 20-second canonical ticks, normalized to real elapsed horizons:
 // m3=3m (9 ticks), m9=15m (45), m30=60m (180), m60=180m (540).
 const rawMoves={m3:mv(history,9,m),m9:mv(history,45,m),m30:mv(history,180,m),m60:mv(history,540,m)};
 const activeGiveback=activePrior?.side==='CALL'?Math.max(0,(activePrior.peakSpot??m.spySpot)-m.spySpot):activePrior?.side==='PUT'?Math.max(0,m.spySpot-(activePrior.troughSpot??m.spySpot)):0;
 const failedExtension=!!activePrior&&((activePrior.side==='CALL'&&rawMoves.m3<-.10&&rawMoves.m9<.08)||(activePrior.side==='PUT'&&rawMoves.m3>.10&&rawMoves.m9>-.08));
 const scoreSide=side=>{
   const sign=side==='CALL'?1:-1;
   const q={hyper:sign*rawMoves.m3,short:sign*rawMoves.m9,medium:sign*rawMoves.m30,long:sign*rawMoves.m60};
   const tf={hyper:clamp(50+q.hyper*62,0,100),short:clamp(50+q.short*34,0,100),medium:clamp(50+q.medium*18,0,100),long:clamp(50+q.long*11,0,100)};
   const persistence=Object.values(q).filter((v,i)=>v>[.12,.26,.52,.78][i]).length;
   const f=sign*(m.spySpot-m.fep),g=sign*(m.spySpot-m.gammaFlip),sameAnchor=Math.abs(m.fep-m.gammaFlip)<.18;
   const location=sameAnchor?Math.min(f,g):(f+g)/2;
   const fepMove=history.length>180?m.fep-history.at(-181).fep:0;
   const wallMove=history.length>180?(side==='CALL'?m.callWall-history.at(-181).callWall:m.putWall-history.at(-181).putWall):0;
   const migration=sign*(fepMove+wallMove);
   const regime=alphaRegime?.active?.side===side&&['BREAKOUT_UP','BREAKDOWN_DOWN','REVERSAL_UP','REVERSAL_DOWN'].includes(alphaRegime?.active?.type);
   const isOpposite=activePrior&&activePrior.side!==side;
   const reversalBoost=isOpposite&&failedExtension?clamp(activeGiveback*42+Math.max(0,-sign*rawMoves.m3)*38,0,34):0;
   const stalePenalty=activePrior?.side===side&&failedExtension?clamp(activeGiveback*36+Math.max(0,-sign*rawMoves.m3)*32,0,30):0;
   const score=16+persistence*7+clamp(location*10,-9,9)+clamp(migration*10,-10,14)+(regime?14:0)+reversalBoost-stalePenalty;
   return{score,tf,reversalBoost,stalePenalty,persistence,location,migration,q};
 };
 const callEval=scoreSide('CALL'),putEval=scoreSide('PUT');
 const callCausal=callEval.score,putCausal=putEval.score;
 const causalEdge=Math.abs(callCausal-putCausal),causalLeader=callCausal>putCausal?'CALL':putCausal>callCausal?'PUT':null;
 const leaderEval=causalLeader==='CALL'?callEval:putEval;
 const timeframeConfirmations=Object.values(leaderEval.tf).filter(v=>v>=57).length;
 const openingEvidenceReady=history.length>=45;
 const proposedCausallySupported=!!proposed&&causalLeader===proposed&&causalEdge>=8&&Math.max(callCausal,putCausal)>=38;
 // The causal core confirms or rejects the session-aware thesis; it must not
 // autonomously invent the opposite direction from a short momentum edge.
 const authoritativeReady=openingEvidenceReady&&proposedCausallySupported&&(timeframeConfirmations>=2||leaderEval.reversalBoost>=16);
 const side=authoritativeReady?causalLeader:null, sign=side==='CALL'?1:side==='PUT'?-1:0;
 const selectedContract=side?((rawIntent?.contract&&rawIntent?.direction===side)?rawIntent.contract:chooseDirectionalContract(chain,side)):null;
 const m3=sign*mv(history,9,m),m9=sign*mv(history,45,m),m30=sign*mv(history,180,m),m60=sign*mv(history,540,m);
 const r12=rng(history,45,m), persistence=[m3>.16,m9>.34,m30>.62,m60>.90].filter(Boolean).length;
 const fepAccept=sign*(m.spySpot-m.fep),flipAccept=sign*(m.spySpot-m.gammaFlip);
 const wallRunway=side==='CALL'?Math.max(0,m.callWall-m.spySpot):side==='PUT'?Math.max(0,m.spySpot-m.putWall):0;
 const structureMigration=sign*((history.length>180?m.fep-history.at(-181).fep:0)+(history.length>180?(side==='CALL'?m.callWall-history.at(-181).callWall:m.putWall-history.at(-181).putWall):0));
 const alignment=clamp(Number(d.alignedPrimaryCount||0),0,3), contractQuality=selectedContract?(selectedContract.tier==='QUALITY'?100:68):0;
 const setup=clamp(Number(rawIntent?.setupQuality||0),0,100), rawConfidence=clamp(Number(rawIntent?.confidence||0),0,100);
 const regimeAligned=alphaRegime?.active?.side===side&&['BREAKOUT_UP','BREAKDOWN_DOWN','REVERSAL_UP','REVERSAL_DOWN'].includes(alphaRegime?.active?.type);
 const regimeConflict=alphaRegime?.active?.side&&alphaRegime.active.side!==side&&alphaRegime.active.confidence>=65;
 const transmissionOkay=transmission?.state!=='TRANSMISSION_FAILED'||(persistence>=3&&m3>.28);
 const dataOkay=dataHealth?.state!=='DATA_STALE_OR_NONINFORMATIVE'&&!dataHealth?.stale;
 let directionStrength=22;
 directionStrength+=Math.min(28,persistence*7);
 const anchorsOverlap=Math.abs(m.fep-m.gammaFlip)<.18;
 const locationAccept=anchorsOverlap?Math.min(fepAccept,flipAccept):(fepAccept+flipAccept)/2;
 directionStrength+=clamp(locationAccept*18,-16,18);
 directionStrength+=clamp(structureMigration*12,-12,16)+alignment*4;
 directionStrength+=regimeAligned?15:0;directionStrength-=regimeConflict?22:0;
 directionStrength+=transmissionOkay?6:-12;
 directionStrength+=setup*.05+rawConfidence*.03;
 directionStrength+=clamp((Math.max(callCausal,putCausal)-48)*.35,0,12);
 directionStrength=clamp(Math.round(directionStrength),0,100);
 let c=s.active;
 if(!position&&!side){s.neutralTicks=(s.neutralTicks||0)+1;if(c&&s.neutralTicks>=3){transition(c,'RESET',tick,'causal authority decayed to neutral');c=null;}}
 else if(side){s.neutralTicks=0;if(!c||c.side!==side||['IN_POSITION','MATURE','EXHAUSTED','REVERSING','RESET'].includes(c.stage)){if(c&&c.side!==side)transition(c,'RESET',tick,`causal leader flipped ${c.side}->${side}`);c=newCampaign(s,side,tick,m.spySpot,leaderEval.reversalBoost>=16?'opposite fade gained authority':'direction became causal');}c.lastTick=tick;c.lastSpot=m.spySpot;c.peakSpot=Math.max(c.peakSpot,m.spySpot);c.troughSpot=Math.min(c.troughSpot,m.spySpot);c.peakStrength=Math.max(c.peakStrength,directionStrength);}
 const campaignProgress=c?sign*(m.spySpot-c.startedSpot):0;
 const bestProgress=c?(side==='CALL'?c.peakSpot-c.startedSpot:c.startedSpot-c.troughSpot):0;
 const pullback=Math.max(0,bestProgress-campaignProgress);
 const expectedLeg=Math.max(.75,Math.max(r12*1.15,Math.abs(m30)*1.10,wallRunway*.75));
 const progressPct=clamp(bestProgress/expectedLeg*100,0,135);
 let remaining=clamp(Math.round(100-progressPct*.62+Math.min(18,wallRunway*12)+Math.min(12,pullback*18)),0,100);
 if(regimeAligned&&alphaRegime.active.type.startsWith('REVERSAL'))remaining=clamp(remaining+10,0,100);
 const freshBreak=(m3>.18&&m9>.34&&pullback<.35), constructiveRetest=pullback>=.10&&pullback<=.42&&campaignProgress>0&&fepAccept>-.08;
 const extensionPenalty=Math.max(0,(m3-.65)*28)+Math.max(0,(progressPct-78)*.45);
 let entryTiming=24+directionStrength*.34+remaining*.25+contractQuality*.10+(freshBreak?12:0)+(constructiveRetest?16:0)-extensionPenalty;
 entryTiming=clamp(Math.round(entryTiming),0,100);
 const recent=history.slice(-18),swingLow=recent.length?Math.min(...recent.map(x=>x.spySpot)):m.spySpot,swingHigh=recent.length?Math.max(...recent.map(x=>x.spySpot)):m.spySpot;
 const structuralStop=side==='CALL'?Math.max(swingLow,Math.min(m.fep,m.gammaFlip)-.12):side==='PUT'?Math.min(swingHigh,Math.max(m.fep,m.gammaFlip)+.12):m.spySpot;
 const stopDistance=Math.abs(m.spySpot-structuralStop), attainable=Math.max(.35,Math.min(wallRunway||1.4,expectedLeg-campaignProgress));
 const rr=stopDistance>.04?attainable/stopDistance:0;
 let riskQuality=(rr>=2.4?88:rr>=1.8?76:rr>=1.35?64:rr>=1?52:35)+(contractQuality-70)*.16-(stopDistance>.75?10:0);
 riskQuality=clamp(Math.round(riskQuality),0,100);
 const reversalRisk=clamp(Math.round((pullback>.55?22:0)+(fepAccept<-.12?30:0)+(m3<-.20?28:0)+(regimeConflict?25:0)),0,100);
 const maturity=clamp(Math.round(progressPct*.72+(remaining<40?18:0)),0,100);
 const hardBlockers=(rawIntent?.blockers||[]).filter(x=>hardBlock(x)&&!(selectedContract&&/No valid contract/i.test(String(x))));
 if(c){if(reversalRisk>=62)transition(c,'REVERSING',tick,`causal reversal risk ${reversalRisk}%`);else if(maturity>=90||remaining<20)transition(c,'EXHAUSTED',tick,`remaining ${remaining}%`);else if(maturity>=72||remaining<36)transition(c,'MATURE',tick,`campaign progress ${Math.round(progressPct)}%`);else if(directionStrength>=62&&persistence>=2&&fepAccept>-.10)transition(c,'CONFIRMED',tick,'accepted multi-window campaign');if(['EMERGING','CONFIRMED'].includes(c.stage)&&directionStrength>=62&&entryTiming>=58&&remaining>=42&&riskQuality>=58&&contractQuality>=68&&dataOkay&&transmissionOkay&&!hardBlockers.length)transition(c,'ENTRY_WINDOW',tick,'alpha entry window qualified');}
 if(position&&c){transition(c,'IN_POSITION',tick,'position open');c.entryTaken=true;}
 s.active=c;
 const executable=!position&&c?.stage==='ENTRY_WINDOW'&&side===c.side&&dataOkay&&transmissionOkay&&!hardBlockers.length;
 const action=position?rawIntent.action:executable?(side==='CALL'?'BUY_CALL':'BUY_PUT'):(side?`PREPARE_${side}`:'WAIT');
 const blockers=[...hardBlockers];if(!openingEvidenceReady)blockers.push(`OPENING_EVIDENCE_WINDOW:${history.length}/12`);else if(!authoritativeReady)blockers.push(`NEUTRAL_CAUSAL_DEAD_ZONE call:${Math.round(callCausal)} put:${Math.round(putCausal)} edge:${Math.round(causalEdge)}`);if(!dataOkay)blockers.push('DATA_STALE_OR_NONINFORMATIVE');if(!transmissionOkay)blockers.push('SIGNAL_TO_PRICE_TRANSMISSION_FAILED');if(side&&!executable){if(directionStrength<62)blockers.push(`DIRECTION_STRENGTH:${directionStrength}<62`);if(entryTiming<58)blockers.push(`ENTRY_TIMING:${entryTiming}<58`);if(remaining<42)blockers.push(`REMAINING_OPPORTUNITY:${remaining}<42`);if(riskQuality<58)blockers.push(`RISK_QUALITY:${riskQuality}<58`);if(contractQuality<68)blockers.push(`CONTRACT_QUALITY:${contractQuality}<68`);if(side&&!selectedContract)blockers.push('No valid contract');}
 const out={...rawIntent,contract:selectedContract,action,direction:side,setupQuality:directionStrength,executionReadiness:entryTiming,readiness:entryTiming,confidence:directionStrength,blockers:[...new Set(blockers)],source:'V17_DUAL_SIDE_REVERSAL_CORE',threshold:58,campaignId:c?.id||null,campaignStage:c?.stage||'NO_CAMPAIGN',diagnostics:{...d,v17:{directionStrength,entryTiming,remainingOpportunity:remaining,riskQuality,maturity,reversalRisk,contractQuality,transmissionOkay,dataOkay,persistence,m3,m9,m30,m60,fepAccept,flipAccept,structureMigration,wallRunway,campaignProgress,bestProgress,pullback,progressPct,rr,structuralStop,regime:alphaRegime?.active||null,callCausal,putCausal,causalEdge,causalLeader,openingEvidenceReady,proposedCausallySupported,authoritativeReady,timeframeConfirmations,callEval,putEval,failedExtension,activeGiveback,anchorsOverlap,locationAccept,campaignId:c?.id||null,campaignStage:c?.stage||'NO_CAMPAIGN'}}};
 s.lastAction=action;return{state:s,intent:out};
}
