# GCDT Simulator v26

Canonical repository for the full GCDT application.

## Architecture

- `src/` — React trader UI, seed engine, replay mode, and API client.
- `api/trader.js` — Vercel serverless GPT trader route.
- `backend/` — local private replay/account server for air-gapped simulations.
- `tools/` — dataset-to-replay catalog builders.
- `docs/` — architecture and operating notes.
- `archive/v25/` — frozen pre-air-gap v25 baseline.
- `scripts/start-local.cmd` — starts the local replay API and Vite UI.

## Time policy

- Default 0DTE trading and forced liquidation cutoff: **3:45 p.m. ET**.
- Market, GEX, and option observations may continue through **4:15 p.m. ET**.
- Replay selection displays dates only; timing details remain internal.

## Local run

Run `scripts/start-local.cmd`, or:

```text
npm install
npm run dev
```

The local air-gap API is started separately from `backend/simulation_server.py`.
