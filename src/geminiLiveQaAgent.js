import { GoogleGenAI, Modality } from '@google/genai';

const MODEL = 'gemini-3.1-flash-live-preview';
const REQUEST_TIMEOUT_MS = 18000;

const qaSchema = {
  type: 'object',
  properties: {
    level: { type: 'string', enum: ['GREEN', 'YELLOW', 'RED'] },
    category: { type: 'string', enum: ['HEALTHY', 'BUG', 'DATA', 'TRADER_BEHAVIOR', 'PERFORMANCE', 'EXPERIMENT', 'APPROVAL'] },
    title: { type: 'string' },
    summary: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    suggested_action: { type: 'string' },
    approval_required: { type: 'boolean' },
    confidence: { type: 'number' },
  },
  required: ['level', 'category', 'title', 'summary', 'evidence', 'suggested_action', 'approval_required', 'confidence'],
};

class GeminiLiveQaAgent {
  constructor() {
    this.session = null;
    this.pending = null;
    this.connecting = null;
  }

  async mintToken() {
    const resp = await fetch('/api/live-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!resp.ok) throw new Error(`QA_LIVE_TOKEN_${resp.status}`);
    const data = await resp.json();
    if (!data.token) throw new Error('QA_LIVE_TOKEN_MISSING');
    return data.token;
  }

  close(reason = 'reset') {
    try { this.session?.close(); } catch {}
    this.session = null;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error(`QA_CLOSED:${reason}`));
      this.pending = null;
    }
  }

  async ensureSession() {
    if (this.session) return this.session;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const token = await this.mintToken();
      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });
      this.session = await ai.live.connect({
        model: MODEL,
        callbacks: {
          onmessage: message => this.handleMessage(message),
          onerror: event => this.fail(new Error(`QA_LIVE_ERROR:${event?.message || 'unknown'}`)),
          onclose: event => this.fail(new Error(`QA_LIVE_CLOSE:${event?.reason || 'closed'}`)),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          thinkingConfig: { thinkingLevel: 'low' },
          outputAudioTranscription: {},
          tools: [{ functionDeclarations: [{
            name: 'report_simulator_observation',
            description: 'Report one evidence-based simulator QA observation. GREEN may be logged autonomously. YELLOW may suggest isolated testing only. RED must require explicit user approval and must never claim a change was made.',
            parameters: qaSchema,
          }] }],
          systemInstruction: { parts: [{ text: `You are FirstSignal's independent simulator research and QA agent. You observe the simulator and trader but never trade, modify code, deploy, alter data, or change prompts. Distinguish software bugs, data defects, trader behavior, and ordinary losing outcomes. GREEN means healthy or autonomous observation. YELLOW means investigate or test in isolation. RED means stop and request Adahy's approval before any material change. Call report_simulator_observation exactly once. Never speak.` }] },
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
    const result = call.args || {};
    clearTimeout(this.pending.timer);
    const { resolve } = this.pending;
    this.pending = null;
    try { this.session?.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, response: { result: 'accepted' } }] }); } catch {}
    resolve(result);
  }

  fail(error) {
    const pending = this.pending;
    this.session = null;
    if (pending) {
      clearTimeout(pending.timer);
      this.pending = null;
      pending.reject(error);
    }
  }

  async observe(snapshot) {
    if (this.pending) throw new Error('QA_BUSY');
    const session = await this.ensureSession();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        this.close('timeout');
        reject(new Error('QA_TIMEOUT'));
      }, REQUEST_TIMEOUT_MS);
      this.pending = { resolve, reject, timer };
      session.sendRealtimeInput({ text: `SIMULATOR QA SNAPSHOT\n${JSON.stringify(snapshot)}\nEvaluate only what this evidence supports. Report one highest-value observation.` });
    });
  }
}

export const geminiLiveQaAgent = new GeminiLiveQaAgent();
