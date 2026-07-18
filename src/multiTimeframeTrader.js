const LAYERS = [
  { key: "strategic", label: "LONG", horizon: "2-4H", alpha: 0.025, flipThreshold: 24, minAge: 24, contractTarget: 0.34 },
  { key: "tactical", label: "MED", horizon: "30-60M", alpha: 0.07, flipThreshold: 18, minAge: 12, contractTarget: 0.26 },
  { key: "execution", label: "SHORT", horizon: "5-15M", alpha: 0.16, flipThreshold: 12, minAge: 6, contractTarget: 0.20 },
  { key: "harvest", label: "HYPER", horizon: "20S-3M", alpha: 0.38, flipThreshold: 7, minAge: 2, contractTarget: 0.16 },
];

const sideOf = intent => intent?.direction || (String(intent?.action || "").includes("CALL") ? "CALL" : String(intent?.action || "").includes("PUT") ? "PUT" : "WAIT");
const scoreOf = (intent, thesis, brain) => {
  const call = Number(thesis?.scores?.call || 0), put = Number(thesis?.scores?.put || 0);
  const pressure = Number(brain?.bullPressure || 0) - Number(brain?.bearPressure || 0);
  const v17=intent?.diagnostics?.v17||{};
  const fallback=(call-put)*0.62+pressure*0.38;
  const tf={
    strategic:(Number(v17.callEval?.tf?.long||50)-Number(v17.putEval?.tf?.long||50))*1.15,
    tactical:(Number(v17.callEval?.tf?.medium||50)-Number(v17.putEval?.tf?.medium||50))*1.15,
    execution:(Number(v17.callEval?.tf?.short||50)-Number(v17.putEval?.tf?.short||50))*1.15,
    harvest:(Number(v17.callEval?.tf?.hyper||50)-Number(v17.putEval?.tf?.hyper||50))*1.15,
  };
  return{fallback:Math.max(-100,Math.min(100,fallback)),tf,callEval:v17.callEval||null,putEval:v17.putEval||null};
};

const chooseContract = (chain, side, target) => {
  const rows = side === "CALL" ? chain?.calls : side === "PUT" ? chain?.puts : [];
  if (!rows?.length) return null;
  return [...rows].filter(x => Number.isFinite(x.price) && x.price >= 0.08 && x.price <= 1.5)
    .sort((a,b) => Math.abs(a.price-target)-Math.abs(b.price-target) || Math.abs(a.delta||0.2)-Math.abs(b.delta||0.2))[0] || null;
};

const markContract = (contract, chain) => {
  if (!contract) return null;
  const rows = contract.side === "CALL" ? chain?.calls : chain?.puts;
  return rows?.find(x => Number(x.strike) === Number(contract.strike)) || null;
};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const credibilityOf=x=>{
  if(!x||x.direction==="WAIT")return 0.12;
  const pnl=Number(x.pnlPct||0),response=Number(x.expansionRate||0),confidence=Number(x.confidence||0);
  const performance=clamp(1+pnl/45+response/4,0.08,1.75);
  const calibration=clamp(0.45+confidence/100,0.45,1.35);
  return clamp(performance*calibration,0.08,1.8);
};

export const createMultiTimeframeState = () => ({
  tick: 0,
  layers: Object.fromEntries(LAYERS.map(x => [x.key, { ...x, direction:"WAIT", score:0, confidence:0, age:0, stableTicks:0, contract:null, marks:[], pnlPct:0, expansionRate:0, changedAt:0, reason:"WARMING UP" }])),
  agreement: { direction:"WAIT", higherAgree:0, totalAgree:0, authorized:false, conflict:false, riskMode:"BLOCKED" },
});

export function updateMultiTimeframeState(previous, { intent, thesis, brain, chain, tick, marketTime }) {
  const state = previous || createMultiTimeframeState();
  const priorHigher=[state.layers?.strategic,state.layers?.tactical,state.layers?.execution].filter(Boolean);
  const contractImpulse=priorHigher.reduce((sum,x)=>{
    const sign=x.direction==="PUT"?-1:x.direction==="CALL"?1:0;
    return sum+sign*((Number(x.expansionRate||0)*5)+(Number(x.pnlPct||0)*0.035));
  },0);
  const independent=scoreOf(intent, thesis, brain);
  const raw = Math.max(-100,Math.min(100,independent.fallback+contractImpulse));
  const proposedSide = raw > 8 ? "CALL" : raw < -8 ? "PUT" : "WAIT";
  const nextLayers = {};
  for (const cfg of LAYERS) {
    const prior = state.layers[cfg.key];
    const layerRaw=Math.max(-100,Math.min(100,(Number(independent.tf[cfg.key])||0)+contractImpulse));
    const smoothed = prior.score + cfg.alpha * (layerRaw - prior.score);
    const proposed = smoothed > cfg.flipThreshold ? "CALL" : smoothed < -cfg.flipThreshold ? "PUT" : "WAIT";
    const canFlip = prior.direction === "WAIT" || prior.age >= cfg.minAge || proposed === prior.direction;
    const direction = canFlip ? proposed : prior.direction;
    const changed = direction !== prior.direction;
    let contract = prior.contract;
    if (direction === "WAIT") contract = null;
    else if (!contract || contract.side !== direction || changed) {
      const selected = chooseContract(chain, direction, cfg.contractTarget);
      contract = selected ? { side:direction, strike:selected.strike, entry:selected.price, selectedAt:marketTime, selectedTick:tick, delta:selected.delta, quality:selected.tier || selected.quality || "TRACKED" } : null;
    }
    const marked = markContract(contract, chain);
    const mark = marked?.price ?? contract?.entry ?? null;
    const marks = mark == null ? prior.marks : [...prior.marks.slice(-29), { tick, price:mark }];
    const pnlPct = contract && mark != null ? ((mark / contract.entry) - 1) * 100 : 0;
    const lookback = cfg.key === "harvest" ? 3 : cfg.key === "execution" ? 6 : cfg.key === "tactical" ? 12 : 24;
    const old = marks.length > lookback ? marks.at(-1-lookback)?.price : marks[0]?.price;
    const expansionRate = old && mark != null ? ((mark / old) - 1) * 100 / Math.max(1, lookback) : 0;
    const base={ ...prior, ...cfg, direction, score:smoothed, confidence:Math.min(99,Math.round(Math.abs(smoothed))), age:changed?0:prior.age+1, stableTicks:changed?0:prior.stableTicks+1, contract, marks, pnlPct, expansionRate, changedAt:changed?tick:prior.changedAt };
    nextLayers[cfg.key]={...base,credibility:credibilityOf(base),reason:direction === "WAIT" ? `No durable ${cfg.horizon} edge` : `${direction} independent ${cfg.horizon} edge ${smoothed.toFixed(1)} | credibility ${Math.round(credibilityOf(base)*100)}% | contract ${pnlPct>=0?"+":""}${pnlPct.toFixed(1)}%`};
  }
  const desired = sideOf(intent);
  const higher = [nextLayers.strategic, nextLayers.tactical, nextLayers.execution];
  const allLayers=[...higher,nextLayers.harvest];
  const desiredWeight=desired==="WAIT"?0:allLayers.filter(x=>x.direction===desired).reduce((a,x)=>a+credibilityOf(x),0);
  const opposingWeight=desired==="WAIT"?0:allLayers.filter(x=>x.direction!=="WAIT"&&x.direction!==desired).reduce((a,x)=>a+credibilityOf(x),0);
  const totalDirectionalWeight=allLayers.filter(x=>x.direction!=="WAIT").reduce((a,x)=>a+credibilityOf(x),0);
  const authorityShare=totalDirectionalWeight?desiredWeight/totalDirectionalWeight:0;
  const higherAgree=desired==="WAIT"?0:higher.filter(x=>x.direction===desired).length;
  const totalAgree=desired==="WAIT"?0:allLayers.filter(x=>x.direction===desired).length;
  const tacticalExecutionAgree=desired!=="WAIT"&&nextLayers.tactical.direction===desired&&nextLayers.execution.direction===desired;
  const fastConfirms=nextLayers.harvest.direction===desired&&nextLayers.harvest.expansionRate>-0.8&&credibilityOf(nextLayers.harvest)>=0.45;
  const losingOpposition=allLayers.filter(x=>x.direction!=="WAIT"&&x.direction!==desired).every(x=>credibilityOf(x)<0.45||x.pnlPct<-20);
  const earnedAuthority=desired!=="WAIT"&&authorityShare>=0.68&&desiredWeight>=1.25&&opposingWeight<=0.85;
  const decisiveReplacement=tacticalExecutionAgree&&fastConfirms&&losingOpposition&&Math.abs(raw)>=24;
  const authorized=earnedAuthority||decisiveReplacement;
  const conflict=opposingWeight>0.45;
  const riskMode=authorized?(decisiveReplacement?"THESIS REPLACED":"EARNED AUTHORITY"):authorityShare>=0.55?"TIGHT RISK":"BLOCKED";
  const responseAvg=allLayers.filter(x=>x.direction===desired&&x.contract).map(x=>x.expansionRate||0).reduce((a,b,_,arr)=>a+b/arr.length,0);
  const contractImpulseNow=allLayers.reduce((sum,x)=>sum+(x.direction==="PUT"?-1:x.direction==="CALL"?1:0)*credibilityOf(x),0);
  return { tick, layers:nextLayers, dualSide:independent, agreement:{direction:desired,higherAgree,totalAgree,authorized,conflict,riskMode,opposingWeight,desiredWeight,authorityShare,responseAvg,contractImpulse,contractImpulseNow,rawSignal:raw,proposedSide} };
}

export function applyMultiTimeframeGate(intent, hierarchy, position) {
  if (!intent || !hierarchy) return intent;
  const desired = sideOf(intent);
  const a = hierarchy.agreement;
  const result = { ...intent, multiTimeframe:a, timeframeLayers:hierarchy.layers };
  if (position) {
    const posSide = position.isCall ? "CALL" : "PUT";
    const agrees = [hierarchy.layers.strategic, hierarchy.layers.tactical, hierarchy.layers.execution].filter(x=>x.direction===posSide).length;
    const fast = hierarchy.layers.harvest;
    const currentPnl = position.entry ? ((position.current/position.entry)-1)*100 : 0;
    if (agrees === 0 || (agrees <= 1 && fast.direction !== posSide && (fast.expansionRate < -1.2 || currentPnl < -8))) {
      return { ...result, action:"EXIT", direction:posSide, blockers:[...(result.blockers||[]),"MULTI_TIMEFRAME_INVALIDATION"], exitReason:`Higher-timeframe agreement collapsed (${agrees}/3); fast contract response ${fast.expansionRate.toFixed(2)}%/tick.` };
    }
    return { ...result, riskMultiplier:agrees===3?1:agrees===2?0.65:0.35, stopMode:agrees===3?"NORMAL":"TIGHT" };
  }
  if (desired === "WAIT" || !String(intent.action||"").match(/BUY_|PREPARE_/)) return result;
  if (a.authorized) return { ...result, riskMultiplier:1, stopMode:"NORMAL" };
  const blockers=[...(result.blockers||[]),`TIMEFRAME_ALIGNMENT_${a.higherAgree}_OF_3`];
  if (a.higherAgree===2) return { ...result, action:`PREPARE_${desired}`, executionReadiness:Math.min(result.executionReadiness??result.readiness??0,77), readiness:Math.min(result.readiness??0,77), blockers, riskMultiplier:0.45, stopMode:"TIGHT" };
  return { ...result, action:"WAIT", direction:null, executionReadiness:Math.min(result.executionReadiness??0,45), readiness:Math.min(result.readiness??0,45), blockers, riskMultiplier:0, stopMode:"BLOCKED" };
}

export const multiTimeframePrompt = state => LAYERS.map(cfg => {
  const x=state?.layers?.[cfg.key];
  return `${cfg.label} ${cfg.horizon}: ${x?.direction||"WAIT"} ${x?.confidence||0}% | ${x?.contract?`${x.contract.strike}${x.contract.side==="CALL"?"C":"P"} entry $${x.contract.entry.toFixed(2)} P/L ${x.pnlPct>=0?"+":""}${x.pnlPct.toFixed(1)}% response ${x.expansionRate>=0?"+":""}${x.expansionRate.toFixed(2)}%/tick`:"no contract"}`;
}).join("\n");