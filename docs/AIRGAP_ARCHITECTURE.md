# FirstSignal Sim v1 Air-Gap Architecture

## Preserved baseline
- Google Doc / GitHub v25 build: `v25-execution-presumption-20260706`
- Legacy frozen copy: `C:\Users\adahy\Desktop\GCDT\archive\gcdt-v25-original`
- Current working copy (legacy filesystem path retained to avoid breaking tooling): `C:\Users\adahy\Desktop\FirstSignal Sim v1`

## Time policy
- Default 0DTE trade cutoff and forced liquidation: **3:45 PM ET**
- Market, GEX, and option observations continue through: **4:15 PM ET**
- Experimental post-cutoff trading must be explicitly enabled.

## Run
Launch FirstSignal Sim v1 with the current local stack launcher.

Frontend: http://127.0.0.1:5173
API: http://127.0.0.1:8765/api/health

## Architecture installed
- Private historical replay server
- Timestamp observation gate (no future rows)
- Server-owned account/order state
- 3:45 cutoff with continued 4:15 observation
- Frontend API adapter (`src/simulationClient.js`)
- Legacy v25 UI preserved while the replay engine is migrated behind the adapter

