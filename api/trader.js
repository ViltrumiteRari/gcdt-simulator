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
    thought_append: { type: 'string' },
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
  },  required: [
    'thought_append','decision','reasoning','mindset','journal_entry','edge_state',
    'confidence_trend','trade_confidence','invalidation_spot','target_spot',
    'max_loss_pct','memory_used','current_thesis','expected_next_path',
    'new_evidence','prior_trade_effect','reevaluate_after_ticks',
  ],
  additionalProperties: false,
};

function fail(status, message, detail) {
  console.error('TRADER_ROUTE_FAILURE', message, detail ? String(detail).slice(0, 1200) : '');
  return new Response(JSON.stringify({ error: 'TRADER_ROUTE_FAILURE', message }), {
    status,
    headers: JSON_HEADERS,
  });
}

function geminiBody(prompt) {
  const thinkingBudget = Number(process.env.GEMINI_THINKING_BUDGET || 512);
  return {
    systemInstruction: {
      parts: [{ text: 'You are the continuous-session SPY 0DTE trader described in the user prompt. Return exactly one schema-valid JSON trading decision. Put thought_append first and add no prose outside the JSON object.' }],
    },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1200,
      responseMimeType: 'application/json',
      responseJsonSchema: TRADER_SCHEMA,
      thinkingConfig: { thinkingBudget },
    },
  };
}
function geminiText(data) {
  return (data?.candidates || [])
    .flatMap(candidate => candidate?.content?.parts || [])
    .map(part => part?.text || '')
    .join('');
}

function normalizedGeminiStream(source) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = '';
  return source.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const event of events) {
        const line = event.split('\n').find(row => row.startsWith('data:'));
        if (!line) continue;
        try {
          const payload = JSON.parse(line.slice(5).trim());
          const delta = geminiText(payload);
          if (delta) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta })}\n\n`));
        } catch {}
      }
    },
    flush(controller) {
      if (buffer.trim()) {
        const line = buffer.split('\n').find(row => row.startsWith('data:'));
        if (line) {
          try {
            const payload = JSON.parse(line.slice(5).trim());
            const delta = geminiText(payload);
            if (delta) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta })}\n\n`));
          } catch {}
        }
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
    },
  }));
}
export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return fail(405, 'Method not allowed');

  try {
    const body = await req.json();
    const prompt = body?.prompt;
    const wantsStream = body?.stream === true;
    if (!prompt || typeof prompt !== 'string') return fail(400, 'Missing prompt');

    const key = process.env.GEMINI_API_KEY;
    if (!key) return fail(500, 'GEMINI_API_KEY not configured on server');
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
    const action = wantsStream ? 'streamGenerateContent' : 'generateContent';
    const suffix = wantsStream ? '?alt=sse' : '';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${action}${suffix}`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify(geminiBody(prompt)),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      return fail(502, `Gemini HTTP ${resp.status}`, errorText);
    }

    if (wantsStream) {
      return new Response(normalizedGeminiStream(resp.body), {
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
    const text = geminiText(data);
    if (!text) return fail(502, 'Gemini returned no decision text', JSON.stringify(data));
    return new Response(JSON.stringify(JSON.parse(text)), { status: 200, headers: JSON_HEADERS });
  } catch (err) {
    return fail(500, err?.message || 'Unknown Gemini trader-route failure');
  }
}
