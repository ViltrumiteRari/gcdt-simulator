import { GoogleGenAI, Modality } from '@google/genai';

const MODEL = 'gemini-3.1-flash-live-preview';
const SESSION_MAX_MS = 8 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 45000;

const decisionSchema = {
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
    trade_confidence: { type: 'number' },
    invalidation_spot: { type: 'number', nullable: true },
    target_spot: { type: 'number', nullable: true },
    max_loss_pct: { type: 'number', nullable: true },
    memory_used: { type: 'string' },
    current_thesis: { type: 'string' },
    expected_next_path: { type: 'string' },
    new_evidence: { type: 'string' },
    prior_trade_effect: { type: 'string' },
    reevaluate_after_ticks: { type: 'integer' },
    veto_reason: { type: 'string', enum: ['NONE','DIRECTION_FLIPPED','CONTRACT_INVALID','CHASE_RISK','EPISODE_STALE','OPPOSITE_ACCEPTANCE','FINAL_THETA_WINDOW'] },
    veto_evidence: { type: 'string' },
  },
  required: ['thought_append','architecture_reflection','flow_hypothesis','self_audit','missing_angle','coherence_check','decision','reasoning','mindset','journal_entry','edge_state','confidence_trend','trade_confidence','invalidation_spot','target_spot','max_loss_pct','memory_used','current_thesis','expected_next_path','new_evidence','prior_trade_effect','reevaluate_after_ticks','veto_reason','veto_evidence'],
};

class GeminiLiveTrader {
  constructor() {
    this.session = null;
    this.connectedAt = 0;
    this.pending = null;
    this.connecting = null;
  }

  async mintToken() {
    const resp = await fetch('/api/live-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!resp.ok) throw new Error(`LIVE_TOKEN_${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    if (!data.token) throw new Error('LIVE_TOKEN_MISSING');
    return data.token;
  }

  close(reason = 'reset') {
    try { this.session?.close(); } catch {}
    this.session = null;
    this.connectedAt = 0;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error(`GEMINI_LIVE_CLOSED:${reason}`));
      this.pending = null;
    }
  }

  async ensureSession() {
    if (this.session && Date.now() - this.connectedAt < SESSION_MAX_MS) return this.session;
    if (this.connecting) return this.connecting;
    this.close('session-refresh');
    this.connecting = (async () => {
      const token = await this.mintToken();
      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });
      const session = await ai.live.connect({
        model: MODEL,
        callbacks: {
          onopen: () => {},
          onmessage: (message) => this.handleMessage(message),
          onerror: (event) => this.handleFailure(new Error(`GEMINI_LIVE_ERROR:${event?.message || 'unknown'}`)),
          onclose: (event) => this.handleFailure(new Error(`GEMINI_LIVE_CLOSE:${event?.reason || 'closed'}`)),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          thinkingConfig: { thinkingLevel: 'low' },
          outputAudioTranscription: {},
          sessionResumption: {},
          tools: [{
            functionDeclarations: [{
              name: 'submit_trade_decision',
              description: 'Submit the complete FirstSignal trade decision for the current tick. Always call this exactly once per market assessment and do not speak the decision aloud.',
              parameters: decisionSchema,
            }],
          }],
          systemInstruction: {
            parts: [{ text: "You are FirstSignal Sim's continuous live execution intelligence. Read each supplied tick context, reason across the whole session, and call submit_trade_decision exactly once with the complete decision object. Never answer with spoken prose. Never omit required fields." }],
          },
        },
      });
      this.session = session;
      this.connectedAt = Date.now();
      return session;
    })();
    try { return await this.connecting; } finally { this.connecting = null; }
  }

  handleMessage(message) {
    if (!this.pending) return;
    if (message?.serverContent?.outputTranscription?.text && this.pending.onThought) {
      this.pending.onThought(message.serverContent.outputTranscription.text);
    }
    const calls = message?.toolCall?.functionCalls || [];
    const call = calls.find(x => x.name === 'submit_trade_decision');
    if (!call) return;
    const result = call.args || {};
    clearTimeout(this.pending.timer);
    const { resolve } = this.pending;
    this.pending = null;
    try {
      this.session?.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, response: { result: 'accepted' } }] });
    } catch {}
    resolve(result);
  }

  handleFailure(err) {
    const pending = this.pending;
    this.session = null;
    this.connectedAt = 0;
    if (pending) {
      clearTimeout(pending.timer);
      this.pending = null;
      pending.reject(err);
    }
  }

  async request(prompt, onThought, signal) {
    if (this.pending) throw new Error('GEMINI_LIVE_BUSY');
    const session = await this.ensureSession();
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error('GEMINI_LIVE_TIMEOUT'));
      }, REQUEST_TIMEOUT_MS);
      const abort = () => {
        clearTimeout(timer);
        this.pending = null;
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.pending = { resolve: value => { signal?.removeEventListener('abort', abort); resolve(value); }, reject: err => { signal?.removeEventListener('abort', abort); reject(err); }, timer, onThought };
      try {
        session.sendRealtimeInput({ text: prompt });
      } catch (err) {
        clearTimeout(timer);
        this.pending = null;
        reject(err);
      }
    });
  }
}

export const geminiLiveTrader = new GeminiLiveTrader();
