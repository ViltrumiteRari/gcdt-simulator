export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_HEADERS = { ...CORS, 'Content-Type': 'application/json' };

function env() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not configured');
  return { url: url.replace(/\/$/, ''), key };
}

function headers(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    const { url, key } = env();
    if (req.method === 'GET') {
      const requestUrl = new URL(req.url);
      const limit = Math.min(120, Math.max(1, Number(requestUrl.searchParams.get('limit')) || 60));
      const endpoint = `${url}/rest/v1/gcdt_thoughts?select=id,session_id,market_time,kind,content,decision,spot,created_at&order=created_at.desc&limit=${limit}`;
      const resp = await fetch(endpoint, { headers: headers(key) });
      const text = await resp.text();
      if (!resp.ok) return json({ error: text }, resp.status);
      const rows = JSON.parse(text).reverse();
      return json({ rows });
    }

    if (req.method === 'DELETE') {
      const requestUrl = new URL(req.url);
      const cleanup = requestUrl.searchParams.get('cleanup');
      if (cleanup !== 'fallback_failures') return json({ error: 'unsupported cleanup' }, 400);
      const endpoint = `${url}/rest/v1/gcdt_thoughts?content=ilike.*AI%20response%20failed*`;
      const resp = await fetch(endpoint, {
        method: 'DELETE',
        headers: headers(key, { Prefer: 'return=representation' }),
      });
      const text = await resp.text();
      if (!resp.ok) return json({ error: text }, resp.status);
      return json({ deleted: JSON.parse(text) });
    }

    if (req.method === 'POST') {
      const body = await req.json();
      const row = {
        session_id: String(body.session_id || 'unknown').slice(0, 120),
        market_time: String(body.market_time || '').slice(0, 30) || null,
        kind: String(body.kind || 'thought').slice(0, 30),
        content: String(body.content || '').slice(0, 12000),
        decision: String(body.decision || '').slice(0, 30) || null,
        spot: Number.isFinite(Number(body.spot)) ? Number(body.spot) : null,
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      };
      if (!row.content) return json({ error: 'content required' }, 400);
      const resp = await fetch(`${url}/rest/v1/gcdt_thoughts`, {
        method: 'POST',
        headers: headers(key, { Prefer: 'return=representation' }),
        body: JSON.stringify(row),
      });
      const text = await resp.text();
      if (!resp.ok) return json({ error: text }, resp.status);
      return json({ row: JSON.parse(text)[0] });
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    return json({ error: error?.message || 'thoughts route failed' }, 500);
  }
}
