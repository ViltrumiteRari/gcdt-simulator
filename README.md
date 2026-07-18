# FirstSignal Sim v1

Canonical repository for FirstSignal Sim v1.

- Product name: `FirstSignal Sim v1`
- Repository and deployment slug: `firstsignal-sim`
- Production URL: `https://firstsignal-sim.vercel.app`

Legacy GCDT names are retained only where required to read historical data or preserve backward compatibility. New code, configuration, deployments, and project paths use the FirstSignal Sim identity.

## Architecture

- `src/` — React trader UI, seed engine, replay mode, and API client.
- `api/trader.js` — Vercel serverless GPT trader route.
- `backend/` — local private replay/account server for air-gapped simulations.
- `tools/` — dataset-to-replay catalog builders.
- `docs/` — architecture and operating notes.
- `knowledge-pipeline/` — canonical project-local evidence, review, findings, campaign, approval, and validated-learning pipeline. Start with `knowledge-pipeline/00_START_HERE.md`.
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
