import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  classifyGexVelocity,
  classifyCallDom,
  evaluateReentryDiscipline,
  reliabilityRates,
} from '../src/strategyV26.js';

const wallMarket = { netGex: 400, spySpot: 500, gammaFlip: 500.4, callWall: 505, putWall: 495 };
const spike = classifyGexVelocity([
  { netGex: 120 }, { netGex: 90 }, { netGex: 70 },
], wallMarket);
assert.equal(spike.terminalSpike, true);
assert.equal(spike.state, 'TERMINAL_SPIKE_POSITIVE');
assert.equal(spike.direction, -1);

const crossing = classifyGexVelocity([{ netGex: -20 }, { netGex: -5 }], { ...wallMarket, netGex: 10, spySpot: 502 });
assert.equal(crossing.state, 'CROSSING_NEG_TO_POS');
assert.equal(crossing.direction, 1);

const deadZone = classifyCallDom([{ callDom: 0.49 }, { callDom: 0.50 }], { ...wallMarket, callDom: 0.52 });
assert.equal(deadZone.deadZone, true);
assert.equal(deadZone.score, 0);
const repeatedLossMemory = {
  attempts: [
    { side: 'CALL', pnl: -100, primaryCategory: 'FEP_DISTANCE' },
    { side: 'CALL', pnl: -80, primaryCategory: 'FEP_DISTANCE' },
  ],
  consecutiveFailures: { CALL: 2, PUT: 0 },
};
const categoryBlock = evaluateReentryDiscipline(repeatedLossMemory, 'CALL', 'FEP_DISTANCE', 'OSCILLATING');
assert.equal(categoryBlock.allowed, true);
assert.equal(categoryBlock.code, 'REENTRY_REASSESS_REQUIRED');
const changedCategory = evaluateReentryDiscipline(repeatedLossMemory, 'CALL', 'GEX_VELOCITY', 'CROSSING_NEG_TO_POS');
assert.equal(changedCategory.allowed, true);

const hardBlockMemory = {
  attempts: [
    { side: 'PUT', pnl: -50, primaryCategory: 'FEP_DISTANCE' },
    { side: 'PUT', pnl: -60, primaryCategory: 'CALLDOM_DIVERGENCE' },
    { side: 'PUT', pnl: -70, primaryCategory: 'ACCEL' },
  ],
  consecutiveFailures: { CALL: 0, PUT: 3 },
};
const hardBlock = evaluateReentryDiscipline(hardBlockMemory, 'PUT', 'GEX_VELOCITY', 'OSCILLATING');
assert.equal(hardBlock.allowed, true);
assert.equal(hardBlock.code, null);
const hardOverride = evaluateReentryDiscipline(hardBlockMemory, 'PUT', 'GEX_VELOCITY', 'CROSSING_NEG_TO_POS');
assert.equal(hardOverride.allowed, true);

const reliability = reliabilityRates({ totalRequests: 10, parseFailures: 2, totalTrades: 4, fallbackExecutions: 1 });
assert.equal(reliability.parseFailureRate, 0.2);
assert.equal(reliability.fallbackExecutionRate, 0.25);
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
assert.match(app, /move15/);
assert.match(app, /move30/);
assert.match(app, /bearishExpansionContext/);
assert.match(app, /bearishSessionContext/);
assert.match(app, /belowFepShare/);
assert.match(app, /negativeGexShare/);
assert.match(app, /fresh bearish continuation/);
assert.match(app, /REAL_REPLAY_CATALOG\[selectedReplayDate\]/);
assert.match(app, /bullishCounterLeg/);
assert.match(app, /canonicalDirectionReady/);
assert.match(app, /const gaps=marketFactors\.filter/);
assert.doesNotMatch(app, /for\(const f of marketFactors\)if\(!f\.passed\)blockers\.push/);
assert.doesNotMatch(app, /if\(activeBearRegime&&!provenPinContext\)side="PUT"/);
assert.match(app, /const fep=x\.gammaFlip/);
assert.match(app, /price>=0\.12/);
assert.doesNotMatch(app, /price>=0\.02/);
assert.match(app, /PARSE FAIL/);
assert.match(app, /FALLBACK EXEC/);
assert.match(app, /GEX VELOCITY/);
assert.match(app, /TERMINAL_SPIKE_BLOCK/);
assert.match(app, /CALLDOM_GEX_DIVERGENCE/);
assert.match(app, /REENTRY_CATEGORY_BLOCK|discipline\.code/);
assert.match(app, /reliabilityR\.current\.parseFailures\+\+/);
assert.match(app, /reliabilityR\.current\.fallbackExecutions\+\+/);

console.log('GCDT v26 strategy acceptance tests passed');
