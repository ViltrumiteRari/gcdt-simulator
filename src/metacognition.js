const finite = value => Number.isFinite(Number(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const sideSign = side => side === 'CALL' ? 1 : side === 'PUT' ? -1 : 0;

export function createMetacognitionState() {
  return {
    forecasts: [],
    activeForecastId: null,
    signalTrust: {},
    expectationFailures: { CALL: 0, PUT: 0 },
    inversion: { side: null, transfer: 0, sourceSide: null, reason: null, updatedTick: null },
    drawdownReview: { active: false, activatedAt: null, completedAt: null, reflection: '' },
    endSession: null,
  };
}

export function timestampMinutes(t) {
  if (finite(t)) return Number(t);
  const match = String(t || '').match(/(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function computeGexImpulse(history, market) {
  const rows = [...(history || []), market].filter(Boolean).map((row, index) => ({
    ...row,
    minute: timestampMinutes(row.minute ?? row.t ?? (finite(row.h) && finite(row.m) ? Number(row.h) * 60 + Number(row.m) : null)),
    gex: Number(row.netGexSpx ?? row.netGex),
    spy: Number(row.spySpot),
    spx: Number(row.spxSpot),
    index,
  })).filter(row => finite(row.gex));
  const current = rows.at(-1);
  if (!current) return { honestFastestWindow: null, windows: {}, persistence: 'UNKNOWN', transmission: 'UNKNOWN' };
  const actualTimes = rows.filter(row => finite(row.minute));
  const cadence = actualTimes.length >= 2 ? actualTimes.at(-1).minute - actualTimes.at(-2).minute : null;
  const windows = {};
  for (const minutes of [0.5, 1, 3]) {
    if (minutes === 0.5 && !(finite(cadence) && cadence <= 0.5)) continue;
    let prior = null;
    if (finite(current.minute)) {
      prior = [...rows].reverse().find(row => row !== current && finite(row.minute) && current.minute - row.minute >= minutes);
    } else if (minutes >= 1) {
      prior = rows.at(-(Math.round(minutes) + 1));
    }
    if (!prior) continue;
    const gexChange = current.gex - prior.gex;
    const spyChange = finite(current.spy) && finite(prior.spy) ? current.spy - prior.spy : null;
    const spxChange = finite(current.spx) && finite(prior.spx) ? current.spx - prior.spx : null;
    windows[minutes === 0.5 ? 's30' : `m${minutes}`] = { minutes, gexChange, spyChange, spxChange, from: prior.t ?? prior.minute, to: current.t ?? current.minute };
  }
  const recentChanges = rows.slice(-6).slice(1).map((row, i) => row.gex - rows.slice(-6)[i].gex).filter(finite);
  const sameDirection = recentChanges.length >= 2 && recentChanges.every(x => Math.sign(x) === Math.sign(recentChanges.at(-1)) && Math.sign(x) !== 0);
  const reversals = recentChanges.slice(1).filter((x, i) => Math.sign(x) !== 0 && Math.sign(recentChanges[i]) !== 0 && Math.sign(x) !== Math.sign(recentChanges[i])).length;
  const reversalRate = recentChanges.length >= 2 ? reversals / (recentChanges.length - 1) : 0;
  const snapback = reversalRate >= 0.5;
  const fastest = windows.s30 ? '30_SECONDS' : windows.m1 ? '1_MINUTE' : windows.m3 ? '3_MINUTES' : null;
  const lens = windows.s30 || windows.m1 || windows.m3;
  let transmission = 'UNKNOWN', lagOpportunity = 'NONE', priceConfirmation = 'UNCONFIRMED';
  if (lens && finite(lens.spyChange)) {
    const gexDirection = Math.sign(lens.gexChange);
    const spyDirection = Math.sign(lens.spyChange);
    const gexBillions = Math.abs(lens.gexChange) / 1e9;
    const spyMagnitude = Math.abs(lens.spyChange);
    priceConfirmation = gexDirection !== 0 && spyDirection === gexDirection ? 'SAME_DIRECTION' : gexDirection !== 0 && spyDirection === -gexDirection ? 'OPPOSITE_DIRECTION' : 'NO_PRICE_RESPONSE';
    if (gexBillions >= 0.75 && spyMagnitude < 0.08) lagOpportunity = 'SPY_LAGGING_GEX_REPRICE';
    else if (gexBillions >= 0.75 && spyMagnitude >= 0.08) lagOpportunity = 'SPY_RESPONDING';
    transmission = lagOpportunity === 'SPY_LAGGING_GEX_REPRICE' ? 'LAG_PRESENT' : lagOpportunity === 'SPY_RESPONDING' ? 'PRICE_RESPONDED' : 'LOW_INFORMATION';
  }
  const reactivity = snapback ? 'HIGHLY_REACTIVE' : sameDirection ? 'TEMPORARILY_PERSISTENT' : 'REACTIVE_UNCONFIRMED';
  return { honestFastestWindow: fastest, cadenceMinutes: cadence, windows, persistence: sameDirection ? 'PERSISTING' : snapback ? 'SNAPBACK' : 'UNCONFIRMED', reactivity, reversalRate, transmission, lagOpportunity, priceConfirmation };
}

export function createForecast(decision, market, tick, signalKeys = [], existing = null) {
  const side = decision?.decision === 'BUY_CALL' ? 'CALL' : decision?.decision === 'BUY_PUT' ? 'PUT' : decision?.forecast_side || null;
  const probability = clamp(Number(decision?.forecast_probability ?? decision?.trade_confidence ?? 50), 1, 99);
  const windowTicks = clamp(Math.round(Number(decision?.forecast_window_ticks ?? decision?.reevaluate_after_ticks ?? 3)), 1, 30);
  const target = finite(decision?.target_spot) ? Number(decision.target_spot) : null;
  const invalidation = finite(decision?.invalidation_spot) ? Number(decision.invalidation_spot) : null;
  const thesis = String(decision?.current_thesis || '').trim();
  const expected = String(decision?.expected_next_path || '').trim();
  if (!side || !expected) return null;
  if (existing && existing.status === 'ACTIVE' && existing.side === side && existing.expectedPath === expected) return existing;
  return {
    id: `fc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdTick: tick,
    createdTime: market?.t ?? `${market?.h}:${String(market?.m ?? 0).padStart(2, '0')}`,
    createdSpot: Number(market?.spySpot),
    side,
    thesis,
    expectedPath: expected,
    probability,
    windowTicks,
    deadlineTick: tick + windowTicks,
    targetSpot: target,
    invalidationSpot: invalidation,
    expectedSupportingBehavior: String(decision?.forecast_supporting_behavior || decision?.new_evidence || ''),
    signalKeys: [...new Set(signalKeys.filter(Boolean))],
    status: 'ACTIVE',
    observations: [],
  };
}

export function scoreForecast(forecast, market, tick) {
  if (!forecast || forecast.status !== 'ACTIVE') return forecast;
  const spot = Number(market?.spySpot);
  const sign = sideSign(forecast.side);
  const progress = finite(spot) && finite(forecast.createdSpot) ? sign * (spot - forecast.createdSpot) : 0;
  const targetHit = finite(forecast.targetSpot) && sign * (spot - forecast.targetSpot) >= 0;
  const invalidated = finite(forecast.invalidationSpot) && sign * (spot - forecast.invalidationSpot) <= 0;
  const expired = tick >= forecast.deadlineTick;
  let status = 'ACTIVE';
  if (targetHit) status = 'SUCCESS';
  else if (invalidated) status = 'FAILED_INVALIDATED';
  else if (expired && progress > 0.12) status = 'PARTIAL';
  else if (expired) status = 'FAILED_TIMEOUT';
  return {
    ...forecast,
    status,
    resolvedTick: status === 'ACTIVE' ? null : tick,
    resolvedTime: status === 'ACTIVE' ? null : market?.t,
    resolvedSpot: status === 'ACTIVE' ? null : spot,
    progress,
    observations: [...(forecast.observations || []), { tick, time: market?.t, spot, progress }].slice(-30),
  };
}

export function updateExpectationFailureState(state = {}, forecast, transmission = {}) {
  if (!forecast || forecast.status === 'ACTIVE') return state;
  const next = { ...state, expectationFailures: { CALL: 0, PUT: 0, ...(state.expectationFailures || {}) }, inversion: { side: null, transfer: 0, sourceSide: null, reason: null, updatedTick: null, ...(state.inversion || {}) } };
  const side = forecast.side;
  const opposite = side === 'CALL' ? 'PUT' : side === 'PUT' ? 'CALL' : null;
  if (!side || !opposite) return next;
  if (forecast.status === 'SUCCESS') {
    next.expectationFailures[side] = 0;
    if (next.inversion.sourceSide === side) next.inversion = { side: null, transfer: 0, sourceSide: null, reason: null, updatedTick: forecast.resolvedTick ?? null };
    return next;
  }
  if (forecast.status === 'PARTIAL') {
    next.expectationFailures[side] = Math.max(0, (next.expectationFailures[side] || 0) - 1);
    return next;
  }
  const streak = (next.expectationFailures[side] || 0) + 1;
  next.expectationFailures[side] = streak;
  const transmissionFailed = transmission?.state === 'TRANSMISSION_FAILED' || transmission?.failedTicks >= 3;
  const adverse = Number(forecast.progress || 0) < -0.08;
  const transfer = clamp(10 + streak * 8 + (transmissionFailed ? 8 : 0) + (adverse ? 6 : 0), 0, 38);
  next.inversion = {
    side: opposite,
    transfer,
    sourceSide: side,
    reason: `${forecast.status}${transmissionFailed ? '+TRANSMISSION_FAILED' : ''}${adverse ? '+ADVERSE_RESPONSE' : ''}`,
    updatedTick: forecast.resolvedTick ?? null,
  };
  return next;
}

export function applyForecastTrust(signalTrust, forecast) {
  if (!forecast || forecast.status === 'ACTIVE') return signalTrust || {};
  const next = { ...(signalTrust || {}) };
  const delta = forecast.status === 'SUCCESS' ? 1 : forecast.status === 'PARTIAL' ? 0.25 : -1;
  for (const key of forecast.signalKeys || []) {
    const prior = next[key] || { score: 0, successes: 0, partials: 0, failures: 0 };
    next[key] = {
      score: clamp(prior.score + delta, -10, 10),
      successes: prior.successes + (forecast.status === 'SUCCESS' ? 1 : 0),
      partials: prior.partials + (forecast.status === 'PARTIAL' ? 1 : 0),
      failures: prior.failures + (forecast.status.startsWith('FAILED') ? 1 : 0),
    };
  }
  return next;
}


export function analyzeDataHealth(history = [], market = {}, chain = null) {
  const rows = [...history.slice(-40), market].filter(Boolean);
  const spy = rows.map(r => Number(r.spySpot)).filter(Number.isFinite);
  const spx = rows.map(r => Number(r.spxSpot)).filter(Number.isFinite);
  const identicalTail = values => {
    if (!values.length) return 0;
    const last = values.at(-1); let n = 0;
    for (let i = values.length - 1; i >= 0 && Math.abs(values[i] - last) < 1e-9; i--) n++;
    return n;
  };
  const lastMeaningful = (values, epsilon) => {
    if (values.length < 2) return null;
    const last = values.at(-1);
    for (let i = values.length - 2; i >= 0; i--) if (Math.abs(last - values[i]) >= epsilon) return values.length - 1 - i;
    return values.length - 1;
  };
  const spyFlatTicks = identicalTail(spy), spxFlatTicks = identicalTail(spx);
  const spyMeaningfulAge = lastMeaningful(spy, 0.03), spxMeaningfulAge = lastMeaningful(spx, 0.3);
  const source = String(market?.quoteSource || market?.marketSource || 'UNKNOWN');
  const forwardFilled = /FILL|FORWARD|INTERPOLAT/i.test(source);
  const calls = chain?.calls || market?.optionChain?.calls || [];
  const puts = chain?.puts || market?.optionChain?.puts || [];
  const chainRows = calls.length + puts.length;
  const sourceIntervalSeconds = Number(market?.sourceIntervalSeconds || 20);
  const playbackIntervalSeconds = Number(market?.playbackIntervalSeconds || 20);
  const expectedHoldTicks = Math.max(1, Math.ceil(sourceIntervalSeconds / playbackIntervalSeconds));
  const flatStaleThreshold = Math.max(8, expectedHoldTicks + 3);
  const meaningfulStaleThreshold = Math.max(10, expectedHoldTicks + 4);
  const stale = spyFlatTicks >= flatStaleThreshold || (spyMeaningfulAge != null && spyMeaningfulAge >= meaningfulStaleThreshold) || chainRows === 0;
  const nonInformative = stale || (spyFlatTicks >= Math.max(5, expectedHoldTicks) && spxFlatTicks >= Math.max(5, expectedHoldTicks)) || (forwardFilled && spyFlatTicks >= flatStaleThreshold);
  return { state: stale ? 'DATA_STALE_OR_NONINFORMATIVE' : nonInformative ? 'DATA_LOW_INFORMATION' : 'DATA_HEALTHY', stale, nonInformative, spyFlatTicks, spxFlatTicks, spyMeaningfulAge, spxMeaningfulAge, source, forwardFilled, chainRows, sourceIntervalSeconds, playbackIntervalSeconds, expectedHoldTicks };
}

export function updateTransmissionState(previous = {}, history = [], market = {}, activeForecast = null) {
  const rows = [...history.slice(-20), market].filter(Boolean);
  const current = rows.at(-1) || market;
  const prior = rows.at(-5) || rows.at(0) || current;
  const spxMove = Number(current.spxSpot) - Number(prior.spxSpot);
  const spyMove = Number(current.spySpot) - Number(prior.spySpot);
  const itsGap = Number(current.itsSPX) - Number(current.itsSPY);
  const side = activeForecast?.side;
  const sign = sideSign(side);
  const expectedLead = sign ? sign * spxMove : Math.abs(spxMove);
  const actualResponse = sign ? sign * spyMove : Math.abs(spyMove);
  let state = 'TRANSMISSION_PENDING';
  if (Math.abs(spxMove) < 0.3 && Math.abs(itsGap) < 0.25) state = 'RELATIONSHIP_UNRELIABLE';
  else if (expectedLead > 0.3 && actualResponse > 0.08) state = 'TRANSMISSION_CONFIRMED';
  else if (expectedLead > 0.3 && actualResponse <= 0) state = 'TRANSMISSION_FAILED';
  else if (expectedLead > 0.3 && actualResponse < 0.08) state = 'TRANSMISSION_DELAYED';
  const failedTicks = state === 'TRANSMISSION_FAILED' || state === 'TRANSMISSION_DELAYED' ? (previous.failedTicks || 0) + 1 : 0;
  if (failedTicks >= 5) state = 'TRANSMISSION_FAILED';
  return { state, failedTicks, spxMove, spyMove, itsGap, updatedAt: current.t || null };
}

export function applyMetacognitiveGates(intent, context = {}) {
  const next = { ...intent, blockers: [...(intent?.blockers || [])], diagnostics: { ...(intent?.diagnostics || {}) } };
  const dataHealth = context.dataHealth || {};
  const transmission = context.transmission || {};
  const activeForecast = context.activeForecast;
  const drawdownActive = !!context.drawdownActive;
  const recoveryQualified = !!context.recoveryQualified;
  const trustPenalty = Math.max(0, ...(context.signalKeys || []).map(k => Math.max(0, -(context.signalTrust?.[k]?.score || 0)) * 4));
  next.modelConfidence = clamp(Math.round((Number(next.confidence) || 0) - trustPenalty), 0, 95);
  next.ruleCompleteness = Number(next.setupQuality) || 0;
  next.contractQuality = Number(next.diagnostics?.contractQuality) || 0;
  next.confidence = next.modelConfidence;
  next.diagnostics = { ...next.diagnostics, dataHealth, transmission, trustPenalty, activeForecastStatus: activeForecast?.status || null };
  if (dataHealth.stale || dataHealth.state === 'DATA_STALE_OR_NONINFORMATIVE') next.blockers.unshift('DATA_STALE_OR_NONINFORMATIVE');
  if (transmission.state === 'TRANSMISSION_FAILED') next.blockers.push('SIGNAL_TO_PRICE_TRANSMISSION_FAILED');
  if (activeForecast?.status === 'ACTIVE' && activeForecast.side && next.direction && activeForecast.side !== next.direction) next.blockers.push('UNRESOLVED_OPPOSITE_FORECAST');
  if (drawdownActive) {
    next.blockers.push(recoveryQualified ? 'DRAWDOWN_RECOVERY_MODE' : 'DRAWDOWN_REVIEW_REQUIRES_MODEL_CHANGE');
    if (!recoveryQualified) next.executionReadiness = Math.min(Number(next.executionReadiness) || 0, 69);
  }
  if (next.blockers.some(x => /DATA_STALE|TRANSMISSION_FAILED|UNRESOLVED_OPPOSITE|DRAWDOWN_REVIEW_REQUIRES/.test(x))) {
    if (String(next.action || '').startsWith('BUY_')) next.action = next.direction ? `PREPARE_${next.direction}` : 'WAIT';
    next.executionReadiness = Math.min(Number(next.executionReadiness) || 0, 69);
  }
  return next;
}

export function shouldEmitCognition(previous = null, current = {}) {
  if (!previous) return true;
  const material = ['decision','edge_state','confidence_trend','coherence_check','current_thesis','expected_next_path','transmission_state','data_state'];
  return material.some(k => String(previous?.[k] ?? '') !== String(current?.[k] ?? '')) || Math.abs(Number(previous?.trade_confidence || 0) - Number(current?.trade_confidence || 0)) >= 8;
}

export function shouldActivateDrawdownReview(balance, startingBalance, review) {
  return Number(balance) <= Number(startingBalance) * 0.6 && !review?.active && !review?.completedAt;
}

export function classifyTradeFailure(trade) {
  if (!trade || Number(trade.pnl) >= 0) return 'PROFIT_OR_FLAT';
  const directional = Number(trade.progress);
  const mfe = Number(trade.maxFavorableSpot);
  const mae = Number(trade.maxAdverseSpot);
  if (trade.reason?.includes('VEHICLE')) return 'CONTRACT_VEHICLE_FAILURE';
  if (trade.reason?.includes('INVALID') || trade.reason?.includes('OPPOSITE')) return 'CAUSAL_INVALIDATION';
  if (finite(directional) && directional < -0.25) return 'WRONG_DIRECTION';
  if (finite(mfe) && finite(mae) && Math.abs(mfe - Number(trade.entrySpot)) > Math.abs(mae - Number(trade.entrySpot))) return 'PROFIT_NOT_CAPTURED';
  if (Number(trade.holdTicks) <= 2) return 'TIMING_OR_NOISE_EXIT';
  return 'THESIS_DID_NOT_TRANSMIT';
}

export function buildTradeDiagnostics(attempts = [], tickData = []) {
  return attempts.map(trade => {
    const after = tickData.filter(row => Number(row.tick) > Number(trade.tick)).slice(0, 5);
    const postExitMove = after.length ? sideSign(trade.side) * (Number(after.at(-1).spySpot) - Number(trade.exitSpot)) : null;
    return { ...trade, failureClass: classifyTradeFailure(trade), postExitMove, exitProtectedCapital: finite(postExitMove) ? postExitMove <= 0 : null };
  });
}
