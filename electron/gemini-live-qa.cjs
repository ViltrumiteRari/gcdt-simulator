const fs = require('fs');
const path = require('path');

const MODEL = 'gemini-3.1-flash-live-preview';
const TIMEOUT_MS = 22000;

function readEnvKey() {
  const envPath = path.join(__dirname, '..', '.env.local');
  const text = fs.readFileSync(envPath, 'utf8');
  const match = text.match(/^GEMINI_API_KEY\s*=\s*["']?([^\r\n"']+)/m);
  if (!match) throw new Error('GEMINI_API_KEY_MISSING');
  return match[1].trim();
}

const schema = {
  type: 'object',
  properties: {
    level: { type: 'string', enum: ['GREEN', 'YELLOW', 'RED'] },
    category: { type: 'string', enum: ['HEALTHY', 'BUG', 'DATA', 'TRADER_BEHAVIOR', 'PERFORMANCE', 'EXPERIMENT', 'APPROVAL'] },
    title: { type: 'string' }, summary: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    suggested_action: { type: 'string' }, approval_required: { type: 'boolean' }, confidence: { type: 'number' },
  },
  required: ['level','category','title','summary','evidence','suggested_action','approval_required','confidence'],
};

class GeminiLiveQa {
  constructor() { this.session = null; this.pending = null; this.connecting = null; }

  async ensureSession() {
    if (this.session) return this.session;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const { GoogleGenAI, Modality } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: readEnvKey(), httpOptions: { apiVersion: 'v1alpha' } });
      this.session = await ai.live.connect({
        model: MODEL,
        callbacks: {
          onmessage: message => this.handleMessage(message),
          onerror: event => this.fail(new Error(`GEMINI_LIVE_ERROR:${event?.message || 'unknown'}`)),
          onclose: event => this.fail(new Error(`GEMINI_LIVE_CLOSE:${event?.reason || 'closed'}`)),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          thinkingConfig: { thinkingLevel: 'low' }, outputAudioTranscription: {},
          tools: [{ functionDeclarations: [{ name: 'report_simulator_observation', description: 'Return one evidence-based FirstSignal QA report using GREEN, YELLOW, or RED authority.', parameters: schema }] }],
          systemInstruction: { parts: [{ text: 'You are FirstSignal simulator QA. Never trade or modify anything. Distinguish bugs, data defects, trader behavior, and normal variance. Call report_simulator_observation exactly once and never speak.' }] },
        },
      });
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
    if (pending) { clearTimeout(pending.timer); this.pending = null; pending.reject(error); }
  }

  async observe(snapshot) {
    if (this.pending) throw new Error('QA_BUSY');
    const session = await this.ensureSession();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending = null; try { this.session?.close(); } catch {} this.session = null; reject(new Error('QA_TIMEOUT')); }, TIMEOUT_MS);
      this.pending = { resolve, reject, timer };
      session.sendRealtimeInput({ text: `SIMULATOR QA SNAPSHOT\n${JSON.stringify(snapshot)}\nReturn the highest-value supported observation.` });
    });
  }
}

module.exports = new GeminiLiveQa();
