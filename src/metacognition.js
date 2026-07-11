const finite = value => Number.isFinite(Number(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const sideSign = side => side === 'CALL' ? 1 : side === 'PUT' ? -1 : 0;

export function createMetacognitionState() {
  return {
    forecasts: [],
    activeForecastId: null,
    signalTrust: {},
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
  const recentChanges = rows.slice(-4).slice(1).map((row, i) => row.gex - rows.slice(-4)[i].gex).filter(finite);
  const sameDirection = recentChanges.length >= 2 && recentChanges.every(x => Math.sign(x) === Math.sign(recentChanges.at(-1)) && Math.sign(x) !== 0);
  const snapback = recentChanges.length >= 2 && Math.sign(recentChanges.at(-1)) !== Math.sign(recentChanges.at(-2));
  const fastest = windows.s30 ? '30_SECONDS' : windows.m1 ? '1_MINUTE' : windows.m3 ? '3_MINUTES' : null;
  const lens = windows.s30 || windows.m1 || windows.m3;
  let transmission = 'UNKNOWN';
  if (lens && finite(lens.spyChange)) {
    const expected = Math.sign(lens.gexChange);
    const response = Math.sign(lens.spyChange);
    transmission = expected === 0 || response === 0 ? 'NO_PRICE_RESPONSE' : expected === response ? 'TRANSMITTED' : 'DIVERGED';
  }
  return { honestFastestWindow: fastest, cadenceMinutes: cadence, windows, persistence: sameDirection ? 'PERSISTING' : snapback ? 'SNAPBACK' : 'UNCONFIRMED', transmission };
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
