# Supabase AI Thoughts Journal Setup

1. Open the Supabase SQL Editor for the FirstSignal Sim V1 project.
2. Run `supabase/firstsignal_sim_v1_thoughts.sql`.
3. Add these Vercel Production environment variables:

- `SUPABASE_URL` â€” project URL from Supabase project settings.
- `SUPABASE_SERVICE_ROLE_KEY` â€” server-side service-role key.

Do not prefix either variable with `VITE_`. The browser never receives the key; only `/api/thoughts` can use it.

After adding the variables, redeploy FirstSignal Sim V1. The journal badge will move from `LOCAL` to `SYNCED` after it successfully reads or writes durable thoughts.

The live decision path does not wait for Supabase. The AI response streams into browser memory first, the final decision executes from that same response, and persistence happens afterward.


> Compatibility note: the physical Supabase table remains `gcdt_thoughts` so existing data and API routes continue working. It is the legacy storage table for FirstSignal Sim V1.

