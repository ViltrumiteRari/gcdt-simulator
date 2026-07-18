# FirstSignal Runtime Architecture

This project is a local distributed runtime, not only a React simulator.

## Runtime path
Campaign launcher -> isolated Electron worker -> hidden Vite renderer -> replay engine -> Gemini Live Trader -> session artifacts -> same-Trader closing reflection -> supervisor -> observer/review -> explicit promotion.

Parallel workers are disposable scouts. Their private thoughts and handoffs die with the worker unless a completed run is explicitly promoted for review. They never directly update canonical Trader memory or doctrine.

## Ownership
- src/App.jsx: replay lifecycle, tick-bound cognition, execution, heartbeat, and finalization.
- src/geminiLiveTrader.js: connection state, continuity, typed provider failures, bounded retries, and circuit breaker.
- electron/main.cjs: worker status, heartbeat ingestion, stall detection, HTTP control, and cohort aggregation.
- electron/supervisor-service.cjs: campaign lifecycle and terminal failure propagation.
- scripts/start-parallel-campaign.ps1: worker isolation, ports, profiles, and staging folders.
- knowledge-pipeline: reviewed evidence and explicit learning promotion only.

## Gemini state machine
DISCONNECTED -> CONNECTING -> CONNECTED -> DEGRADED -> RESUMING

Permanent failures transition to CIRCUIT_OPEN. Quota exhaustion, authentication failure, and broken same-Trader continuity are permanent for that worker lifetime. A circuit-open worker must not reconnect, mint more tokens, continue replay, or finalize as valid. Transient failures receive bounded retries only.

## Worker state machine
STARTING -> RUNNING -> WAITING_ON_COGNITION -> FINALIZING -> COMPLETED

Terminal states: FAILED_QUOTA, FAILED_PROVIDER, FAILED_CONTINUITY, FAILED_STALL, FAILED_RENDERER, FAILED_FINAL_REFLECTION. Terminal workers are invalid and cannot be promoted.

## Non-negotiable invariants
- No future information may enter a replay decision.
- Execution-critical decisions are bound to the exact request tick.
- Background cognition cannot execute trades.
- Replay freezes only for an active execution-critical request.
- Every freeze has a bounded release path.
- Final reflection must come from confirmed same-Trader continuity.
- Incomplete or failed runs cannot become doctrine.
- Disposable cohort memory never enters the canonical lineage automatically.
- Permanent provider failures open the circuit and stop the worker.
- Status must describe logical health, not merely whether a process is alive.

## Operating runbook
1. Build with npx vite build and syntax-check Electron services before launching workers.
2. Start the Vite renderer on 127.0.0.1:5173.
3. Launch canonical runs one at a time. Launch disposable cohorts only through start-parallel-campaign.ps1.
4. Inspect /parallel/status or each worker /status. Trust workerRuntime, failureCode, tick progress, and campaign state together.
5. A worker is healthy only when ticks advance or it is explicitly waiting on bounded cognition. Polling alone is not health.
6. Quarantine or delete failed and incomplete workers. Never promote them.
7. Promote only completed runs with 405 canonical ticks, a valid same-Trader reflection, correct provenance, and no terminal failure.
8. Observer findings are claims. Doctrine changes require explicit review and approval.

## Failure handling
- TRANSIENT_CONNECTION_FAILURE: bounded reconnect allowed.
- PROVIDER_QUOTA_EXHAUSTED: circuit opens, replay stops, campaign fails.
- PROVIDER_AUTH_FAILED: circuit opens, replay stops, campaign fails.
- CONTINUITY_BROKEN: final reflection and promotion are forbidden.
- NO_TICK_PROGRESS_60S: worker becomes FAILED_STALL.
- Renderer unavailable or gone: worker is invalid even if the agent server is alive.

Read this file before changing campaign, connection, cognition, finalization, supervisor, or promotion logic.
