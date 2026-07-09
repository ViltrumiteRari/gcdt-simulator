# Supabase AI Thoughts Journal Setup

1. Open the Supabase SQL Editor for the GCDT project.
2. Run `supabase/gcdt_thoughts.sql`.
3. Add these Vercel Production environment variables:

- `SUPABASE_URL` — project URL from Supabase project settings.
- `SUPABASE_SERVICE_ROLE_KEY` — server-side service-role key.

Do not prefix either variable with `VITE_`. The browser never receives the key; only `/api/thoughts` can use it.

After adding the variables, redeploy GCDT. The journal badge will move from `LOCAL` to `SYNCED` after it successfully reads or writes durable thoughts.

The live decision path does not wait for Supabase. The AI response streams into browser memory first, the final decision executes from that same response, and persistence happens afterward.
