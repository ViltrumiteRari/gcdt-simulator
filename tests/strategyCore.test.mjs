import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  classifyGexVelocity,
  classifyCallDom,
  evaluateReentryDiscipline,
  reliabilityRates,
} from '../src/strategyCore.js';
import { createMetacognitionState, computeGexImpulse, createForecast, scoreForecast, applyForecastTrust, shouldActivateDrawdownReview, classifyTradeFailure, buildTradeDiagnostics } from '../src/metacognition.js';

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
assert.equal(categoryBlock.code, null);
assert.equal(categoryBlock.repeatedCategory, null);
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
assert.doesNotMatch(app, /SPX_JUL1/);
assert.match(app, /replayDate:selectedReplayDate/);
assert.match(app, /createReplayEngine\(replayData\)/);
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
assert.match(app, /discipline\.code/);
assert.doesNotMatch(app, /repeated:FEP_DISTANCE/);
assert.match(app, /reliabilityR\.current\.parseFailures\+\+/);
assert.match(app, /reliabilityR\.current\.fallbackExecutions\+\+/);


const meta = createMetacognitionState();
assert.equal(meta.forecasts.length, 0);
const impulse = computeGexImpulse([
  { t: '10:00', netGexSpx: 100, spySpot: 500, spxSpot: 6000 },
  { t: '10:01', netGexSpx: 130, spySpot: 500.2, spxSpot: 6002 },
  { t: '10:02', netGexSpx: 170, spySpot: 500.5, spxSpot: 6005 },
], { t: '10:03', netGexSpx: 220, spySpot: 500.9, spxSpot: 6009 });
assert.equal(impulse.honestFastestWindow, '1_MINUTE');
assert.equal(impulse.persistence, 'PERSISTING');
assert.equal(impulse.transmission, 'TRANSMITTED');
assert.equal(impulse.windows.s30, undefined);

const forecast = createForecast({
  decision: 'BUY_CALL', current_thesis: 'upside expansion', expected_next_path: 'break higher',
  forecast_probability: 62, forecast_window_ticks: 3, target_spot: 501, invalidation_spot: 499.5,
}, { t: '10:00', spySpot: 500 }, 10, ['GEX_ACCEL', 'EXPANSION']);
assert.equal(forecast.status, 'ACTIVE');
assert.equal(forecast.deadlineTick, 13);
const success = scoreForecast(forecast, { t: '10:02', spySpot: 501.1 }, 12);
assert.equal(success.status, 'SUCCESS');
const trusted = applyForecastTrust({}, success);
assert.equal(trusted.GEX_ACCEL.score, 1);
const failed = scoreForecast({ ...forecast, id: 'failed', targetSpot: 503 }, { t: '10:04', spySpot: 500.05 }, 13);
assert.equal(failed.status, 'FAILED_TIMEOUT');
const penalized = applyForecastTrust(trusted, failed);
assert.equal(penalized.GEX_ACCEL.score, 0);
assert.equal(shouldActivateDrawdownReview(600, 1000, meta.drawdownReview), true);
assert.equal(shouldActivateDrawdownReview(601, 1000, meta.drawdownReview), false);
assert.equal(classifyTradeFailure({ pnl: -20, progress: -0.5, reason: 'TIME', holdTicks: 5 }), 'WRONG_DIRECTION');
const diagnostics = buildTradeDiagnostics([{ side: 'CALL', pnl: -20, progress: -0.5, reason: 'TIME', holdTicks: 5, tick: 3, exitSpot: 500 }], [{ tick: 4, spySpot: 499.8 }, { tick: 5, spySpot: 499.6 }]);
assert.equal(diagnostics[0].failureClass, 'WRONG_DIRECTION');
assert.equal(diagnostics[0].exitProtectedCapital, true);
assert.match(app, /SESSION_CLOSING_REFLECTION/);
assert.match(app, /DRAWDOWN_REVIEW_ACTIVE/);
assert.match(app, /ACCOUNTABLE FORECAST RULE/);
assert.match(app, /computeGexImpulse/);
assert.match(app, /buildTradeDiagnostics/);

console.log('FirstSignal strategy acceptance tests passed');

