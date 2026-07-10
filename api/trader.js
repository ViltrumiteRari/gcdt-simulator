export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_HEADERS = { ...CORS, 'Content-Type': 'application/json' };
const SSE_HEADERS = {
  ...CORS,
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'X-Accel-Buffering': 'no',
};

const TRADER_SCHEMA = {
  type: 'object',
  properties: {
    thought_append: { type: 'string' },
    architecture_reflection: { type: 'string' },
    flow_hypothesis: { type: 'string' },
    self_audit: { type: 'string' },
    missing_angle: { type: 'string' },
    coherence_check: { type: 'string', enum: ['COHERENT','TENSION','DATA_GAP','STALE_ASSUMPTION'] },
    decision: { type: 'string', enum: ['WAIT','WAITING','BUY_CALL','BUY_PUT','SELL','HOLD'] },
    reasoning: { type: 'string' },
    mindset: { type: 'string' },
    journal_entry: { type: 'string' },
    edge_state: { type: 'string', enum: ['NO_EDGE','CONDITIONS_FORMING','ENTRY_READY','IN_TRADE','EXITING'] },
    confidence_trend: { type: 'string', enum: ['BUILDING','STABLE','DECAYING','UNCLEAR'] },
    trade_confidence: { type: 'number', minimum: 0, maximum: 100 },
    invalidation_spot: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    target_spot: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    max_loss_pct: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    memory_used: { type: 'string' },
    current_thesis: { type: 'string' },
    expected_next_path: { type: 'string' },
    new_evidence: { type: 'string' },
    prior_trade_effect: { type: 'string' },
    reevaluate_after_ticks: { type: 'integer', minimum: 1, maximum: 10 },
    veto_reason: { type: 'string', enum: ['NONE','DIRECTION_FLIPPED','CONTRACT_INVALID','CHASE_RISK','EPISODE_STALE','OPPOSITE_ACCEPTANCE','FINAL_THETA_WINDOW'] },
    veto_evidence: { type: 'string' },
  },
  required: [
    'thought_append','architecture_reflection','flow_hypothesis','self_audit','missing_angle','coherence_check',
    'decision','reasoning','mindset','journal_entry','edge_state','confidence_trend','trade_confidence',
    'invalidation_spot','target_spot','max_loss_pct','memory_used','current_thesis','expected_next_path',
    'new_evidence','prior_trade_effect','reevaluate_after_ticks','veto_reason','veto_evidence',
  ],
  additionalProperties: false,
};

function fail(status, message, detail) {
  console.error('TRADER_ROUTE_FAILURE', message, detail ? String(detail).slice(0, 1600) : '');
  return new Response(JSON.stringify({ error: 'TRADER_ROUTE_FAILURE', message }), { status, headers: JSON_HEADERS });
}
function systemText() {
  return 'You are the continuous-session SPY 0DTE trader described in the user prompt. Return exactly one schema-valid JSON object and no prose.';
}
function parseJsonText(text) {
  const raw = String(text || '').trim().replace(/^```json\s*/i, '').replace(/```$/,'').trim();
  return JSON.parse(raw);
}
function sseResponse(obj, provider) {
  const payload = JSON.stringify(obj);
  const body = `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: payload })}\n\ndata: ${JSON.stringify({ type: 'provider', provider })}\n\ndata: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: SSE_HEADERS });
}

async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_KEY_MISSING');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: systemText() }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1400,
      responseMimeType: 'application/json',
      responseJsonSchema: TRADER_SCHEMA,
      thinkingConfig: { thinkingBudget: Number(process.env.GEMINI_THINKING_BUDGET || 512) },
    },
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`GEMINI_${resp.status}:${text.slice(0,900)}`);
  const data = JSON.parse(text);
  const out = (data?.candidates || []).flatMap(c => c?.content?.parts || []).map(p => p?.text || '').join('');
  if (!out) throw new Error('GEMINI_EMPTY');
  return parseJsonText(out);
}

async function callOpenAI(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_KEY_MISSING');
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [{ role: 'system', content: systemText() }, { role: 'user', content: prompt }],
      response_format: { type: 'json_schema', json_schema: { name: 'firstsignal_trade_decision', strict: true, schema: TRADER_SCHEMA } },
    }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`OPENAI_${resp.status}:${text.slice(0,900)}`);
  const data = JSON.parse(text);
  const out = data?.choices?.[0]?.message?.content;
  if (!out) throw new Error('OPENAI_EMPTY');
  return parseJsonText(out);
}

async function callAnthropic(prompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_KEY_MISSING');
  const model = process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest';
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 1400, temperature: 0.2, system: systemText(), messages: [{ role: 'user', content: prompt }] }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`ANTHROPIC_${resp.status}:${text.slice(0,900)}`);
  const data = JSON.parse(text);
  const out = (data?.content || []).map(x => x?.text || '').join('');
  if (!out) throw new Error('ANTHROPIC_EMPTY');
  return parseJsonText(out);
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return fail(405, 'Method not allowed');
  try {
    const body = await req.json();
    const prompt = body?.prompt;
    const wantsStream = body?.stream === true;
    if (!prompt || typeof prompt !== 'string') return fail(400, 'Missing prompt');

    const attempts = [
      ['gemini', callGemini],
      ['openai', callOpenAI],
      ['anthropic', callAnthropic],
    ];
    const errors = [];
    for (const [provider, fn] of attempts) {
      try {
        const result = await fn(prompt);
        console.log('TRADER_PROVIDER_SUCCESS', provider);
        return wantsStream ? sseResponse(result, provider) : new Response(JSON.stringify(result), { status: 200, headers: JSON_HEADERS });
      } catch (err) {
        const msg = String(err?.message || err).slice(0,1200);
        errors.push(`${provider}:${msg}`);
        console.error('TRADER_PROVIDER_FAILURE', provider, msg);
      }
    }
    return fail(502, 'All AI providers failed', errors.join(' | '));
  } catch (err) {
    return fail(500, err?.message || 'Unknown trader-route failure');
  }
}
