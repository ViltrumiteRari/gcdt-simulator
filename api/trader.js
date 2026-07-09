export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_HEADERS = { ...CORS, 'Content-Type': 'application/json' };

const TRADER_SCHEMA = {
  type: 'object',
  properties: {
    decision: { type: 'string', enum: ['WAIT','WAITING','BUY_CALL','BUY_PUT','SELL','HOLD'] },
    thought_append: { type: 'string' },
    reasoning: { type: 'string' },
    mindset: { type: 'string' },
    journal_entry: { type: 'string' },
    edge_state: { type: 'string', enum: ['NO_EDGE','CONDITIONS_FORMING','ENTRY_READY','IN_TRADE','EXITING'] },
    confidence_trend: { type: 'string', enum: ['BUILDING','STABLE','DECAYING','UNCLEAR'] },
    trade_confidence: { type: 'number', minimum: 0, maximum: 100 },
    invalidation_spot: { type: ['number','null'] },
    target_spot: { type: ['number','null'] },
    max_loss_pct: { type: ['number','null'] },
    memory_used: { type: 'string' },
    current_thesis: { type: 'string' },
    expected_next_path: { type: 'string' },
    new_evidence: { type: 'string' },
    prior_trade_effect: { type: 'string' },
    reevaluate_after_ticks: { type: 'integer', minimum: 1, maximum: 10 },
  },
  required: [
    'decision','thought_append','reasoning','mindset','journal_entry','edge_state',
    'confidence_trend','trade_confidence','invalidation_spot','target_spot',
    'max_loss_pct','memory_used','current_thesis','expected_next_path',
    'new_evidence','prior_trade_effect','reevaluate_after_ticks',
  ],
  additionalProperties: false,
};

function fail(status, message, detail) {
  console.error('TRADER_ROUTE_FAILURE', message, detail ? JSON.stringify(detail).slice(0, 800) : '');
  return new Response(JSON.stringify({ error: 'TRADER_ROUTE_FAILURE', message }), {
    status,
    headers: JSON_HEADERS,
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: JSON_HEADERS });
  }
  try {
    const body = await req.json();
    const { prompt } = body || {};
    const wantsStream = body?.stream === true;
    if (!prompt || typeof prompt !== 'string') return fail(400, 'Missing prompt');
    const key = process.env.OPENAI_API_KEY;
    if (!key) return fail(500, 'OPENAI_API_KEY not configured on server');
    const resp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        store: false,
        stream: wantsStream,
        reasoning: { effort: 'low' },
        max_output_tokens: 1200,
        input: [
          {
            role: 'system',
            content: 'You are the continuous-session SPY 0DTE trader described in the user prompt. Return one complete schema-valid trading decision. Do not add prose outside the JSON object.',
          },
          { role: 'user', content: prompt },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'trader_decision',
            strict: true,
            schema: TRADER_SCHEMA,
          },
        },
      }),
    });
    if (wantsStream) {
      if (!resp.ok) {
        const errText = await resp.text();
        return fail(502, `OpenAI HTTP ${resp.status}`, errText);
      }
      return new Response(resp.body, {
        status: 200,
        headers: {
          ...CORS,
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
        },
      });
    }
    const data = await resp.json();
    if (!resp.ok) return fail(502, data?.error?.message || `OpenAI HTTP ${resp.status}`, data);
    if (data.status === 'incomplete') {
      return fail(502, `Model output incomplete: ${data?.incomplete_details?.reason || 'unknown'}`, data);
    }

    const message = (data.output || []).find(item => item.type === 'message');
    const content = message?.content?.find(item => item.type === 'output_text');
    if (!content?.text) return fail(502, 'No structured output_text block in OpenAI response', data.output);
    const decision = JSON.parse(content.text);

    return new Response(JSON.stringify(decision), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (err) {
    return fail(500, err?.message || 'Unknown trader-route failure');
  }
}
