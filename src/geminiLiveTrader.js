import { GoogleGenAI, Modality } from '@google/genai';

const MODEL = 'gemini-3.1-flash-live-preview';
const SESSION_MAX_MS = 8 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 22000;

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
    forecast_probability: { type: 'number' },
    forecast_window_ticks: { type: 'integer' },
    forecast_supporting_behavior: { type: 'string' },
    forecast_side: { type: 'string', enum: ['CALL','PUT','NONE'] },
    veto_reason: { type: 'string', enum: ['NONE','DIRECTION_FLIPPED','CONTRACT_INVALID','CHASE_RISK','EPISODE_STALE','OPPOSITE_ACCEPTANCE','FINAL_THETA_WINDOW'] },
    veto_evidence: { type: 'string' },
  },
  required: ['thought_append','architecture_reflection','flow_hypothesis','self_audit','missing_angle','coherence_check','decision','reasoning','mindset','journal_entry','edge_state','confidence_trend','trade_confidence','invalidation_spot','target_spot','max_loss_pct','memory_used','current_thesis','expected_next_path','new_evidence','prior_trade_effect','reevaluate_after_ticks','forecast_probability','forecast_window_ticks','forecast_supporting_behavior','forecast_side','veto_reason','veto_evidence'],
};

const observationSchema = {
  type: 'object',
  properties: {
    thought_append: { type: 'string' },
    thesis_delta: { type: 'string' },
    current_thesis: { type: 'string' },
    expected_next_path: { type: 'string' },
    noteworthy: { type: 'boolean' },
    urgency: { type: 'string', enum: ['NONE','WATCH','ENTRY_SOON','RISK'] },
  },
  required: ['thought_append','thesis_delta','current_thesis','expected_next_path','noteworthy','urgency'],
};

class GeminiLiveTrader {
  constructor() {
    this.session = null;
    this.connectedAt = 0;
    this.pending = null;
    this.connecting = null;
    this.bootstrapped = false;
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
    this.bootstrapped = false;
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
              description: 'Submit the complete FirstSignal trade decision for an explicit execution assessment. Call exactly once and do not speak the decision aloud.',
              parameters: decisionSchema,
            },{
              name: 'record_tick_reflection',
              description: 'Record a compact private reflection for a CONTINUOUS_TICK_BATCH. Do not make or execute a trade decision through this function.',
              parameters: observationSchema,
            }],
          }],
          systemInstruction: {
            parts: [{ text: "You are FirstSignal Sim's continuous live execution intelligence. For messages beginning CONTINUOUS_TICK_BATCH, absorb every ordered tick, read the supplied private journal, and call record_tick_reflection exactly once. For explicit execution assessments, call submit_trade_decision exactly once. Never answer with spoken prose. Never omit required fields." }],
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
    const calls = message?.toolCall?.functionCalls || [];
    const expected = this.pending.kind === 'observation' ? 'record_tick_reflection' : 'submit_trade_decision';
    const call = calls.find(x => x.name === expected);
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

  compactPrompt(prompt) {
    if (!this.bootstrapped) return prompt;
    const architectureAt = prompt.indexOf('ARCHITECTURE SELF-MODEL:');
    const regimeAt = prompt.indexOf('REGIME:');
    const identityAt = prompt.indexOf('TRADER IDENTITY');
    const prefix = architectureAt > 0 ? prompt.slice(0, architectureAt) : prompt.slice(0, 7000);
    const market = regimeAt >= 0 ? prompt.slice(regimeAt, identityAt > regimeAt ? identityAt : undefined) : '';
    return `${prefix}
LIVE SESSION CONTINUITY: Architecture, authority hierarchy, execution rules, and output schema remain unchanged from session boot. Evaluate only the updated state below.
${market}`;
  }

  async request(prompt, onThought, signal, options = {}) {
    if (this.pending?.kind === 'observation') this.close('decision-preempted-observation');
    else if (this.pending) throw new Error('GEMINI_LIVE_BUSY');
    const session = await this.ensureSession();
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return await new Promise((resolve, reject) => {
      const timeoutMs = options.urgent ? 12000 : REQUEST_TIMEOUT_MS;
      const timer = setTimeout(() => {
        this.pending = null;
        try { this.session?.close(); } catch {}
        this.session = null;
        this.connectedAt = 0;
        this.bootstrapped = false;
        reject(new Error('GEMINI_LIVE_TIMEOUT'));
      }, timeoutMs);
      const abort = () => {
        clearTimeout(timer);
        this.pending = null;
        try { this.session?.close(); } catch {}
        this.session = null;
        this.connectedAt = 0;
        this.bootstrapped = false;
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.pending = { kind: 'decision', resolve: value => { signal?.removeEventListener('abort', abort); resolve(value); }, reject: err => { signal?.removeEventListener('abort', abort); reject(err); }, timer, onThought };
      try {
        const livePrompt = options.urgent ? prompt : this.compactPrompt(prompt);
        if (onThought) onThought(options.urgent ? 'Gemini Live is evaluating an urgent entry window...' : 'Gemini Live is evaluating the current market state...');
        session.sendRealtimeInput({ text: livePrompt });
        this.bootstrapped = true;
      } catch (err) {
        clearTimeout(timer);
        this.pending = null;
        reject(err);
      }
    });
  }

  async requestObservation(prompt) {
    if (this.pending) throw new Error('GEMINI_LIVE_BUSY');
    const session = await this.ensureSession();
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        try { this.session?.close(); } catch {}
        this.session = null;
        this.connectedAt = 0;
        this.bootstrapped = false;
        reject(new Error('GEMINI_LIVE_OBSERVATION_TIMEOUT'));
      }, 6500);
      this.pending = { kind: 'observation', resolve, reject, timer, onThought: null };
      try {
        session.sendRealtimeInput({ text: prompt });
        this.bootstrapped = true;
      } catch (err) {
        clearTimeout(timer);
        this.pending = null;
        reject(err);
      }
    });
  }

}

export const geminiLiveTrader = new GeminiLiveTrader();
