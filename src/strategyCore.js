export const SIGNAL_CATEGORIES = Object.freeze({
  GEX_VELOCITY: 'GEX_VELOCITY',
  CALLDOM_DIVERGENCE: 'CALLDOM_DIVERGENCE',
  FEP_DISTANCE: 'FEP_DISTANCE',
  ACCEL: 'ACCEL',
  LEAD_LAG: 'LEAD_LAG',
});

const nearWall = (m, tolerance = 1) =>
  [m.gammaFlip, m.callWall, m.putWall].some(v => Number.isFinite(v) && Math.abs(m.spySpot - v) <= tolerance);

export function classifyGexVelocity(history, market) {
  const prints = [...(history || []).slice(-5).map(x => Number(x.netGex)), Number(market?.netGex)].filter(Number.isFinite);
  if (prints.length < 3) return { state: 'OSCILLATING', direction: 0, score: 0, terminalSpike: false };
  const [a, b, c] = prints.slice(-3);
  const d1 = b - a, d2 = c - b;
  const crossingUp = b <= 0 && c > 0, crossingDown = b >= 0 && c < 0;
  const priorDecel = prints.length >= 4 && Math.abs(prints.at(-2) - prints.at(-3)) < Math.abs(prints.at(-3) - prints.at(-4));
  const terminalSpike = priorDecel && Math.abs(c) > 5 * Math.max(1, Math.abs(b)) && nearWall(market);
  if (terminalSpike) return { state: c > 0 ? 'TERMINAL_SPIKE_POSITIVE' : 'TERMINAL_SPIKE_NEGATIVE', direction: c > 0 ? -1 : 1, score: 32, terminalSpike: true };
  if (crossingUp) return { state: 'CROSSING_NEG_TO_POS', direction: 1, score: 30, terminalSpike: false };
  // Neutralized 2026-07-18: the audit rejected bearish authority, but did not establish bullish authority.
  if (crossingDown) return { state: 'CROSSING_POS_TO_NEG', direction: 0, score: 0, contextBias: 0, instability: true, oppositeWatch: 'PUT', terminalSpike: false };
  if (c > 0 && d2 > 0 && Math.abs(d2) >= Math.abs(d1)) return { state: 'ACCELERATING_POSITIVE', direction: 1, score: 28, terminalSpike: false };
  // Neutralized 2026-07-18: positive level remains contextually supportive, but deceleration is not fresh bullish authority.
  if (c > 0 && d2 < 0) return { state: 'DECELERATING_POSITIVE', direction: 0, score: 0, contextBias: 1, exhaustionRisk: 'RISING', terminalSpike: false };
  if (c < 0 && d2 < 0 && Math.abs(d2) >= Math.abs(d1)) return { state: 'ACCELERATING_NEGATIVE', direction: -1, score: 28, terminalSpike: false };
  if (c < 0 && d2 > 0) return { state: 'DECELERATING_NEGATIVE', direction: 1, score: 20, terminalSpike: false };
  return { state: 'OSCILLATING', direction: 0, score: 0, terminalSpike: false };
}
export function classifyCallDom(history, market) {
  const current = Number(market?.callDom);
  const prior = (history || []).slice(-15).map(x => Number(x.callDom)).filter(Number.isFinite);
  const oldest = prior[0] ?? current;
  const delta = Number.isFinite(current) ? current - oldest : 0;
  const near = nearWall(market);
  const deadZone = Number.isFinite(current) && Math.abs(current - 0.5) <= 0.03;
  const extremeReversal = Number.isFinite(current) && current > 0.70 && near;
  const distribution = delta < -0.10;
  const shortCovering = prior.length >= 3 && Math.min(...prior) < 0.45 && current > Math.min(...prior) && market.spySpot >= Math.min(...(history || []).slice(-6).map(x => x.spySpot ?? market.spySpot));
  const cascadeExhausting = Number.isFinite(current) && current < 0.20;
  let direction = 0, score = 0, state = 'NEUTRAL';
  if (extremeReversal) { direction = -1; score = 18; state = 'EXTREME_WALL_REVERSAL'; }
  // Neutralized 2026-07-18: falling call dominance removes bullish support and opens a PUT watch, but is not directional alone.
  else if (distribution) { direction = 0; score = 0; state = 'DISTRIBUTION'; }
  else if (deadZone) { state = 'DEAD_ZONE'; }
  else if (shortCovering) { state = 'SHORT_COVERING_INFO'; }
  else if (cascadeExhausting) { state = 'CASCADE_EXHAUSTING_INFO'; }
  return { state, direction, score, deadZone, distribution, extremeReversal, exhaustionSide: distribution ? 'CALL' : null, oppositeWatch: distribution ? 'PUT' : null, informational: shortCovering || cascadeExhausting || distribution, delta };
}

export function choosePrimarySignal({ gex, callDom, fepDistance, accelScore = 0, leadLagScore = 0 }) {
  const candidates = [
    { category: SIGNAL_CATEGORIES.GEX_VELOCITY, score: Math.abs(gex?.score || 0) },
    { category: SIGNAL_CATEGORIES.CALLDOM_DIVERGENCE, score: Math.abs(callDom?.score || 0) },
    { category: SIGNAL_CATEGORIES.ACCEL, score: Math.abs(accelScore || 0) },
    { category: SIGNAL_CATEGORIES.LEAD_LAG, score: Math.min(10, Math.abs(leadLagScore || 0)) },
  ];
  return candidates.sort((a, b) => b.score - a.score)[0].category;
}

export function evaluateReentryDiscipline(memory, side, primaryCategory, gexState, currentTick = null, episodeKey = null) {
  const prior = (memory?.attempts || []).filter(x => x.side === side).slice(-3);
  const last = prior.at(-1) || null;
  const sameEpisode = !!last && !!episodeKey && last.episodeKey === episodeKey;
  const repeatedCategory = sameEpisode && primaryCategory !== SIGNAL_CATEGORIES.FEP_DISTANCE && last.primaryCategory === primaryCategory;
  return {
    allowed: true,
    code: repeatedCategory ? 'REENTRY_REASSESS_REQUIRED' : null,
    repeatedCategory: repeatedCategory ? primaryCategory : null,
    override: repeatedCategory ? 'AI must identify material new evidence or explicitly decline the retry' : null,
    priorAttempt: last,
    gexState,
    currentTick,
  };
}

export function reliabilityRates(stats) {
  const requests = Math.max(0, stats?.totalRequests || 0);
  const trades = Math.max(0, stats?.totalTrades || 0);
  return {
    parseFailureRate: requests ? (stats.parseFailures || 0) / requests : 0,
    fallbackExecutionRate: trades ? (stats.fallbackExecutions || 0) / trades : 0,
  };
}
