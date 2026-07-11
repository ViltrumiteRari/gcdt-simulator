import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  classifyGexVelocity,
  classifyCallDom,
  evaluateReentryDiscipline,
  reliabilityRates,
} from '../src/strategyCore.js';
import { createMetacognitionState, computeGexImpulse, createForecast, scoreForecast, applyForecastTrust, shouldActivateDrawdownReview, classifyTradeFailure, buildTradeDiagnostics, analyzeDataHealth, updateTransmissionState, applyMetacognitiveGates } from '../src/metacognition.js';

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
const appComponentLine = app.split(/\r?\n/).findIndex(line => line.startsWith('export default function App'));
const appTopLevel = app.split(/\r?\n/).slice(0, appComponentLine).join('\n');
assert.doesNotMatch(appTopLevel, /\b(?:metacognitionR|dataHealthR|transmissionR)\.current\b/);
assert.doesNotMatch(appTopLevel, /\bdrawdownReviewActive\b/);

assert.match(app, /move15/);
assert.match(app, /move30/);
assert.match(app, /bearishExpansionContext/);
assert.match(app, /bearishSessionContext/);
assert.match(app, /belowFepShare/);
assert.match(app, /negativeGexShare/);
assert.match(app, /fresh bearish continuation/);
assert.match(app, /loadRealReplay/);
assert.match(app, /replayDataFor\(selectedReplayDate\)/);
assert.doesNotMatch(app, /from ["']\.\/realReplayData/);
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

const frozenHistory = Array.from({ length: 10 }, (_, i) => ({ t: `12:${String(i).padStart(2,'0')}`, spySpot: 750.01, spxSpot: 7530 + i * 0.1 }));
const frozenHealth = analyzeDataHealth(frozenHistory, { t: '12:10', spySpot: 750.01, spxSpot: 7531, quoteSource: 'REAL_QUOTE_WITH_HISTORY_FILL' }, { calls:[{}], puts:[{}] });
assert.equal(frozenHealth.state, 'DATA_STALE_OR_NONINFORMATIVE');
const movingHealth = analyzeDataHealth([{spySpot:750,spxSpot:7530},{spySpot:750.1,spxSpot:7531},{spySpot:750.2,spxSpot:7532}], {spySpot:750.35,spxSpot:7533,quoteSource:'REAL_QUOTE'}, {calls:[{}],puts:[{}]});
assert.equal(movingHealth.state, 'DATA_HEALTHY');
const tx = updateTransmissionState({failedTicks:4}, [
  {spySpot:750,spxSpot:7530,itsSPX:10,itsSPY:9.4},
  {spySpot:750,spxSpot:7531,itsSPX:10.2,itsSPY:9.4},
  {spySpot:749.98,spxSpot:7532,itsSPX:10.4,itsSPY:9.4},
  {spySpot:749.97,spxSpot:7533,itsSPX:10.6,itsSPY:9.4},
], {spySpot:749.96,spxSpot:7534,itsSPX:10.8,itsSPY:9.4}, {side:'CALL'});
assert.equal(tx.state, 'TRANSMISSION_FAILED');
const gated = applyMetacognitiveGates({action:'BUY_CALL',direction:'CALL',setupQuality:100,executionReadiness:96,confidence:88,blockers:[],diagnostics:{contractQuality:100}}, {dataHealth:frozenHealth,transmission:tx,drawdownActive:false,signalTrust:{GEX:{score:-2}},signalKeys:['GEX']});
assert.equal(gated.action, 'PREPARE_CALL');
assert.ok(gated.blockers.includes('DATA_STALE_OR_NONINFORMATIVE'));
assert.ok(gated.blockers.includes('SIGNAL_TO_PRICE_TRANSMISSION_FAILED'));
assert.equal(gated.ruleCompleteness, 100);
assert.ok(gated.modelConfidence < 88);
const drawdownGated = applyMetacognitiveGates({action:'BUY_PUT',direction:'PUT',setupQuality:90,executionReadiness:95,confidence:75,blockers:[],diagnostics:{}}, {dataHealth:movingHealth,transmission:{state:'TRANSMISSION_CONFIRMED'},drawdownActive:true});
assert.equal(drawdownGated.action, 'PREPARE_PUT');
assert.ok(drawdownGated.blockers.includes('DRAWDOWN_REVIEW_REQUIRES_MODEL_CHANGE'));
assert.doesNotMatch(app, /EXECUTION PRESUMPTION/);
assert.match(app, /eligibility proposal, not an order/);
assert.match(app, /METACOGNITIVE_GATE/);
assert.match(app, /DATA_STATE/);
assert.match(app, /TRANSMISSION_STATE/);
assert.match(app, /spyInvalidation/);
assert.match(app, /spxConfirmation/);

assert.match(app, /SESSION_CLOSING_REFLECTION/);
assert.match(app, /DRAWDOWN_REVIEW_ACTIVE/);
assert.match(app, /ACCOUNTABLE FORECAST RULE/);
assert.match(app, /computeGexImpulse/);
assert.match(app, /buildTradeDiagnostics/);

assert.match(app, /setTimeout\(\(\)=>saveSessionRef\.current\?\.\(\),0\)/);
assert.match(app, /SESSION_CLOSING_REFLECTION/);
assert.match(app, /PRIVATE_SESSION_REFLECTION/);
assert.match(app, /NEXT_SESSION_HANDOFF/);
assert.match(app, /saveSessionRef\.current=saveSession/);
assert.match(app, /if\(finalizingR\.current\|\|saved\)return/);
const builder = fs.readFileSync(new URL('../tools/build_real_replay_v2.py', import.meta.url), 'utf8');

assert.doesNotMatch(builder, /\.bfill\(/);
assert.doesNotMatch(builder, /interpolate\(method=["']time["']\)/);
assert.doesNotMatch(builder, /group\[group\["captured_at"\] > ts\]/);
assert.match(builder, /causal_project_series/);
assert.match(builder, /SYNTHETIC_PATH_CAUSAL_FORWARD/);
assert.match(app, /BLIND_REPLAY_SESSION/);
assert.match(app, /eventual outcome, day type, and remaining path are withheld/);
assert.doesNotMatch(app.match(/function interpolateSPX[\s\S]*?\n}/)?.[0]||'', /snapshots\[i\+1\]|const b=/);

assert.match(builder, /load_dedicated_spot/);
assert.match(builder, /spot_intraday_5m\.csv/);
assert.match(builder, /longest_flat > 30/);
const { REAL_REPLAY_CATALOG: replayCatalog } = await import('../src/realReplayData.js');
const july9 = replayCatalog['2026-07-09'];
assert.equal(july9.coverage.spotSource, 'DEDICATED_INTRADAY_5M_CAUSAL');
assert.equal(july9.coverage.lookaheadSafe, true);
assert.ok(july9.coverage.longestFlatSpyMinutes <= 30);
assert.ok(new Set(july9.snapshots.filter(x => x.time >= '12:00').map(x => x.spySpot)).size > 20);

console.log('FirstSignal strategy acceptance tests passed');

