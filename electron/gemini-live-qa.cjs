const MODEL = 'gemini-3.1-flash-live-preview';
const TIMEOUT_MS = 22000;
const SESSION_MAX_MS = 8 * 60 * 1000;
const TOKEN_URL = process.env.FIRSTSIGNAL_TOKEN_URL || 'http://127.0.0.1:5173/api/live-token';

async function mintToken() {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) throw new Error(`QA_LIVE_TOKEN_${response.status}: ${await response.text()}`);
  const data = await response.json();
  if (!data.token) throw new Error('QA_LIVE_TOKEN_MISSING');
  return data.token;
}
const schema = {
  type: 'object',
  properties: {
    level: { type: 'string', enum: ['GREEN', 'YELLOW', 'RED'] },
    category: { type: 'string', enum: ['HEALTHY', 'BUG', 'DATA', 'TRADER_BEHAVIOR', 'PERFORMANCE', 'EXPERIMENT', 'APPROVAL'] },
    title: { type: 'string' }, summary: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    suggested_action: { type: 'string' }, approval_required: { type: 'boolean' }, confidence: { type: 'number' },
    version_assessment: { type: 'string', enum: ['NEW_FINDING','SAME_BUILD_REPEAT','REGRESSION','FIX_VERIFIED','NOT_APPLICABLE'] }, related_build_id: { type: 'string' }, finding_key: { type: 'string' },
  },
  required: ['level','category','title','summary','evidence','suggested_action','approval_required','confidence','version_assessment','related_build_id','finding_key'],
};

class GeminiLiveQa {
  constructor() { this.session = null; this.connectedAt = 0; this.pending = null; this.connecting = null; this.requestsOnSession = 0; }

  async ensureSession() {
    if (this.session && Date.now() - this.connectedAt < SESSION_MAX_MS && this.requestsOnSession < 6) return this.session;
    if (this.session) { try { this.session.close(); } catch {} this.session = null; this.connectedAt = 0; this.requestsOnSession = 0; }
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const { GoogleGenAI, Modality } = await import('@google/genai');
      const token = await mintToken();
      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });
      this.session = await ai.live.connect({
        model: MODEL,
        callbacks: {
          onmessage: message => this.handleMessage(message),
          onerror: event => this.fail(new Error(`GEMINI_LIVE_ERROR:${JSON.stringify({message:event?.message,reason:event?.reason,code:event?.code,error:event?.error?.message||event?.error})}`)),
          onclose: event => this.fail(new Error(`GEMINI_LIVE_CLOSE:${JSON.stringify({message:event?.message,reason:event?.reason,code:event?.code})}`)),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          thinkingConfig: { thinkingLevel: 'low' }, outputAudioTranscription: {}, sessionResumption: {},
          tools: [{ functionDeclarations: [{ name: 'report_simulator_observation', description: 'Return one evidence-based FirstSignal Sim v1 QA report using GREEN, YELLOW, or RED authority.', parameters: schema }] }],
          systemInstruction: { parts: [{ text: 'You are FirstSignal Sim v1 QA. Never trade or modify anything. Use versionContext to compare the current build with prior builds. Treat every prior finding marked RAW_OBSERVATION or REVIEWED_PENDING_ADJUDICATION as unverified evidence, not established truth. Only VALIDATED or FIX_VERIFIED knowledge may be treated as durable. Do not repeat an older-build suggestion unless the current build reproduces it. Mark verified fixes and regressions explicitly. Directional CALL/PUT switching is not inherently unstable or wrong in this strategy; evaluate timing, evidence, risk, execution, and results. Do not equate a negative immediate price move with opposition to a CALL, or a positive immediate move with opposition to a PUT, until regime, structural thesis, mean-reversion versus expansion context, and the intended time horizon are established. Treat localSide WAIT as unconfirmed, not directional disagreement or agreement. A phrase such as Current leg agrees must be validated against the actual field definition, not inferred from raw SPX/SPY sign alone. Trader journal prose is evidence to test, not ground truth. Challenge unjustified certainty, especially after losses. Distinguish bugs, data defects, trader behavior, strategy variance, and normal operation. Call report_simulator_observation exactly once and never speak.' }] },
        },
      });
      this.connectedAt = Date.now();
      this.requestsOnSession = 0;
      return this.session;
    })();
    try { return await this.connecting; } finally { this.connecting = null; }
  }

  handleMessage(message) {
    if (!this.pending) return;
    const call = (message?.toolCall?.functionCalls || []).find(x => x.name === 'report_simulator_observation');
    if (!call) return;
    clearTimeout(this.pending.timer);
    const resolve = this.pending.resolve;
    this.pending = null;
    try { this.session?.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, response: { result: 'accepted' } }] }); } catch {}
    resolve(call.args || {});
  }

  fail(error) {
    const pending = this.pending;
    this.session = null;
    this.connectedAt = 0;
    this.requestsOnSession = 0;
    if (pending) { clearTimeout(pending.timer); this.pending = null; pending.reject(error); }
  }

  async observe(snapshot) {
    if (this.pending) throw new Error('QA_BUSY');
    const session = await this.ensureSession();
    this.requestsOnSession++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending = null; try { this.session?.close(); } catch {} this.session = null; this.connectedAt = 0; this.requestsOnSession = 0; reject(new Error('QA_TIMEOUT')); }, TIMEOUT_MS);
      this.pending = { resolve, reject, timer };
      session.sendRealtimeInput({ text: `SIMULATOR QA SNAPSHOT\n${JSON.stringify(snapshot)}\nReturn the highest-value supported observation.` });
    });
  }
}

module.exports = new GeminiLiveQa();

