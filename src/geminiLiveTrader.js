import { GoogleGenAI, Modality } from '@google/genai';

const MODEL = 'gemini-3.1-flash-live-preview';
const REQUEST_TIMEOUT_MS = 22000;
const TOKEN_TIMEOUT_MS = 10000;
const CONNECT_TIMEOUT_MS = 15000;
const CONNECT_ATTEMPTS = 2;
const delay = ms => new Promise(r => setTimeout(r, ms));
const classifyProviderError = error => {
  const message=String(error?.message||error||'');
  if(/quota|resource_exhausted|billing|exceeded your current quota|429/i.test(message))return {code:'PROVIDER_THROTTLED',permanent:false,message};
  if(/unauthenticated|permission_denied|invalid api key|401|403/i.test(message))return {code:'PROVIDER_AUTH_FAILED',permanent:true,message};
  if(/CONTINUITY_BROKEN|RECONNECTED_WITHOUT_RESUMPTION_HANDLE|ORIGINAL_TRADER_SESSION_UNAVAILABLE/i.test(message))return {code:'CONTINUITY_BROKEN',permanent:true,message};
  if(/TIMEOUT|network|closed|disconnect|unavailable|operation was cancelled|canceled|cancelled/i.test(message))return {code:'TRANSIENT_CONNECTION_FAILURE',permanent:false,message};
  return {code:'PROVIDER_UNKNOWN_FAILURE',permanent:false,message};
};
const withTimeout = (promise, ms, code) => new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error(code)),ms);
  Promise.resolve(promise).then(v=>{clearTimeout(timer);resolve(v);},e=>{clearTimeout(timer);reject(e);});
});

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
    invalidation_instrument: { type: 'string', enum: ['SPY'] },
    target_spot: { type: 'number', nullable: true },
    target_instrument: { type: 'string', enum: ['SPY'] },
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
  required: ['thought_append','architecture_reflection','flow_hypothesis','self_audit','missing_angle','coherence_check','decision','reasoning','mindset','journal_entry','edge_state','confidence_trend','trade_confidence','invalidation_spot','invalidation_instrument','target_spot','target_instrument','max_loss_pct','memory_used','current_thesis','expected_next_path','new_evidence','prior_trade_effect','reevaluate_after_ticks','forecast_probability','forecast_window_ticks','forecast_supporting_behavior','forecast_side','veto_reason','veto_evidence'],
};

const interviewSchema = {
  type: 'object', properties: {
    answer:{type:'string'}, belief_or_behavior:{type:'string'},
    evidence_used_at_the_time:{type:'array',items:{type:'string'}},
    evidence_missing_or_ignored:{type:'array',items:{type:'string'}},
    defense_or_concession:{type:'string',enum:['DEFEND','CONCEDE','PARTIAL','UNCERTAIN']},
    confidence:{type:'number'}, proposed_self_change:{type:'string'} },
  required:['answer','belief_or_behavior','evidence_used_at_the_time','evidence_missing_or_ignored','defense_or_concession','confidence','proposed_self_change']
};

const closingReflectionSchema = {
  type: 'object', properties: {
    private_reflection:{type:'string'},
    next_session_handoff:{type:'string'},
    referenced_trade_ids:{type:'array',items:{type:'string'}},
    factual_claims:{type:'array',items:{type:'object',properties:{claim:{type:'string'},evidence_trade_ids:{type:'array',items:{type:'string'}}},required:['claim','evidence_trade_ids']}}
  },
  required:['private_reflection','next_session_handoff','referenced_trade_ids','factual_claims']
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
    this.serverTurnActive = false;
    this.connecting = null;
    this.bootstrapped = false;
    this.resumptionHandle = null;
    this.sessionGeneration = 0;
    this.continuityState = 'UNPROVEN';
    this.continuityBreakReason = null;
    this.reconnectTimer = null;
    this.connectAttemptSeq = 0;
    this.providerState = 'DISCONNECTED';
    this.circuitOpen = false;
    this.circuitReason = null;
    this.lastFailure = null;
    this.throttleUntil = 0;
    this.throttleCount = 0;
    this.recoveryMode = false;
  }

  runtimeStatus(){return{state:this.providerState,circuitOpen:this.circuitOpen,circuitReason:this.circuitReason,lastFailure:this.lastFailure,connected:!!this.session,connecting:!!this.connecting,pendingKind:this.pending?.kind||null,throttleUntil:this.throttleUntil||null,retryAfterMs:Math.max(0,(this.throttleUntil||0)-Date.now()),continuity:this.continuityStatus()};}

  openCircuit(error){const failure=classifyProviderError(error);this.lastFailure={...failure,at:new Date().toISOString()};this.circuitOpen=true;this.circuitReason=failure.code;this.providerState='CIRCUIT_OPEN';clearTimeout(this.reconnectTimer);this.reconnectTimer=null;this.connectAttemptSeq+=1;this.connecting=null;try{this.session?.close();}catch{}this.session=null;this.connectedAt=0;return failure;}

  enterThrottle(error){const failure=classifyProviderError(error);this.throttleCount+=1;const backoff=[60000,120000,300000][Math.min(this.throttleCount-1,2)];this.throttleUntil=Date.now()+backoff;this.lastFailure={...failure,at:new Date().toISOString(),retryAfterMs:backoff};this.providerState='THROTTLED';clearTimeout(this.reconnectTimer);this.reconnectTimer=null;this.connectAttemptSeq+=1;this.connecting=null;this.serverTurnActive=false;try{this.session?.close();}catch{}this.session=null;this.connectedAt=0;if(this.resumptionHandle)this.continuityState='RESUMING_ORIGINAL';return failure;}

  isRejectedResumption(error){return !!this.resumptionHandle&&/invalid argument|invalid_argument|session.?resumption|resumption.?handle/i.test(String(error?.message||error||''));}

  discardRejectedResumption(error){
    this.resumptionHandle=null;
    this.recoveryMode=true;
    this.continuityState='REHYDRATING_CONTEXT';
    this.continuityBreakReason=`STALE_RESUMPTION_HANDLE:${String(error?.message||error)}`;
  }

  assertCircuitClosed(){if(this.circuitOpen){const e=new Error(`GEMINI_CIRCUIT_OPEN:${this.circuitReason}`);e.code=this.circuitReason;throw e;}}

  async mintToken() {
    const resp = await withTimeout(fetch('/api/live-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), TOKEN_TIMEOUT_MS, 'LIVE_TOKEN_TIMEOUT');
    if (!resp.ok) throw new Error(`LIVE_TOKEN_${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    if (!data.token) throw new Error('LIVE_TOKEN_MISSING');
    return data.token;
  }

  close(reason = 'reset') {
    this.connectAttemptSeq += 1;
    this.connecting = null;
    try { this.session?.close(); } catch {}
    this.session = null;
    this.connectedAt = 0;
    this.bootstrapped = false;
    this.serverTurnActive = false;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error(`GEMINI_LIVE_CLOSED:${reason}`));
      this.pending = null;
    }
  }

  async ensureSession() {
    this.assertCircuitClosed();
    if(this.throttleUntil>Date.now()){this.providerState='THROTTLED';const e=new Error(`PROVIDER_THROTTLED_RETRY_AFTER:${this.throttleUntil-Date.now()}`);e.code='PROVIDER_THROTTLED';throw e;}
    if(this.providerState==='THROTTLED'){this.providerState='RESUMING';this.throttleUntil=0;}
    if (this.session) return this.session;
    this.providerState='CONNECTING';
    if (this.connecting) return await withTimeout(this.connecting, CONNECT_TIMEOUT_MS + TOKEN_TIMEOUT_MS + 5000, 'GEMINI_CONNECTING_STALE');
    const attemptGroup=++this.connectAttemptSeq;
    this.connecting=(async()=>{
      let lastError=null;
      for(let attempt=1;attempt<=CONNECT_ATTEMPTS;attempt++){
        let candidate=null;
        try{
          const token=await this.mintToken();
          const ai=new GoogleGenAI({apiKey:token,httpOptions:{apiVersion:'v1alpha'}});
          candidate=await withTimeout(ai.live.connect({
            model:MODEL,
            callbacks:{
              // Socket-open is not proof that the server accepted the handle.
              onopen:()=>{},
              onmessage:message=>this.handleMessage(message),
              onerror:event=>this.handleFailure(new Error(`GEMINI_LIVE_ERROR:${event?.message||'unknown'}`),true,attemptGroup),
              onclose:event=>this.handleFailure(new Error(`GEMINI_LIVE_CLOSE:${event?.reason||'closed'}`),true,attemptGroup),
            },
            config:this.liveConfig(),
          }),CONNECT_TIMEOUT_MS,'GEMINI_LIVE_CONNECT_TIMEOUT');
          if(attemptGroup!==this.connectAttemptSeq){try{candidate?.close();}catch{} throw new Error('GEMINI_CONNECT_ATTEMPT_SUPERSEDED');}
          this.session=candidate;this.connectedAt=Date.now();this.sessionGeneration+=1;this.providerState='CONNECTED';this.lastFailure=null;this.throttleUntil=0;
          if(this.sessionGeneration===1)this.continuityState='ORIGINAL_LIVE';
          else if(this.resumptionHandle)this.continuityState='RESUMING_ORIGINAL';
          else if(this.recoveryMode)this.continuityState='REHYDRATED_CONTEXT';
          else{this.continuityState='CONTINUITY_BROKEN';this.continuityBreakReason||='RECONNECTED_WITHOUT_RESUMPTION_HANDLE';}
          return candidate;
        }catch(error){
          lastError=error;const failure=classifyProviderError(error);this.lastFailure={...failure,at:new Date().toISOString()};try{candidate?.close();}catch{}
          this.session=null;this.connectedAt=0;
          if(failure.code==='PROVIDER_THROTTLED'){this.enterThrottle(error);throw error;}
          if(this.isRejectedResumption(error)){
            this.discardRejectedResumption(error);
            if(attempt<CONNECT_ATTEMPTS)continue;
            throw new Error(this.continuityBreakReason);
          }
          if(failure.permanent){this.openCircuit(error);throw error;}
          if(attemptGroup!==this.connectAttemptSeq)throw error;
          if(this.resumptionHandle){this.continuityState='RESUMING_ORIGINAL';this.continuityBreakReason=String(error?.message||error);}
          if(attempt<CONNECT_ATTEMPTS)await delay(500*attempt);
        }
      }
      if(!this.resumptionHandle){this.continuityState='CONTINUITY_BROKEN';this.continuityBreakReason=String(lastError?.message||lastError);}
      this.providerState='DEGRADED';
      throw lastError||new Error('GEMINI_LIVE_CONNECT_FAILED');
    })();
    try{return await this.connecting;}finally{if(attemptGroup===this.connectAttemptSeq)this.connecting=null;}
  }

  liveConfig() {
    return {
      responseModalities:[Modality.AUDIO],thinkingConfig:{thinkingLevel:'low'},outputAudioTranscription:{},sessionResumption:{handle:this.resumptionHandle||undefined},
      tools:[{functionDeclarations:[
        {name:'submit_trade_decision',description:'Submit the complete FirstSignal trade decision for an explicit execution assessment. Call exactly once and do not speak the decision aloud.',parameters:decisionSchema},
        {name:'record_tick_reflection',description:'Record a compact private reflection for a CONTINUOUS_TICK_BATCH. Do not make or execute a trade decision through this function.',parameters:observationSchema},
        {name:'answer_supervisor_question',description:'Answer a post-session Supervisor question as the same Trader that completed the session.',parameters:interviewSchema},
        {name:'submit_closing_reflection',description:'Submit the end-of-session private reflection and next-session handoff as the same Trader that completed the replay.',parameters:closingReflectionSchema}
      ]}],
      systemInstruction:{parts:[{text:"You are FirstSignal Sim's continuous live execution intelligence. For messages beginning CONTINUOUS_TICK_BATCH, absorb every ordered tick, read the supplied private journal, and call record_tick_reflection exactly once. For explicit execution assessments, call submit_trade_decision exactly once. Treat structural context as a prior, never a conclusion. GEX is usually a fast reactive exposure measurement, not a directional oracle: multi-billion swings in seconds are normal, may simply reflect a spot move, and can reverse immediately. Never infer persistence, dealer intent, short covering, aggressive selling, or the next price direction from GEX magnitude alone. Use GEX primarily for intraday relative ratios, sensitivity/hesitation/momentum quality, persistence versus snapback, and measurable SPX-GEX repricing versus lagging SPY spot. Price acceptance and transmission are authoritative. A large GEX jump is not itself a veto; disagreement reduces confidence unless an enumerated hard blocker exists. At every assessment distinguish campaign direction, campaign maturity, and remaining entry value; never confuse a correct late direction with an attractive new trade. Every failed directional forecast is new market information: identify the violated assumptions, decay the failed side's structural authority, and determine whether price location, transmission, dealer behavior, walls, FEP/flip acceptance, and contract response transfer probability to the opposite side. Do not reflexively reverse; require causal opposite-side evidence. Repeated expectation failures must not be dismissed as mere timing or execution noise. Never authorize a trade when canonical confidence, setup quality, and execution readiness materially disagree; disagreement means WAIT. When the explicit canonical action is BUY_CALL or BUY_PUT and its stated hard blockers are NONE, return that exact matching BUY decision unless one enumerated veto_reason is factually present in the current supplied evidence. Do not use WAIT for generalized caution, extra confirmation, or narrative uncertainty after canonical authorization has passed. Never answer with spoken prose. Never omit required fields."}]},
    };
  }

  abortPendingConnection(reason='connection-watchdog') {
    if(this.circuitOpen)return;
    this.providerState='DEGRADED';
    this.connectAttemptSeq+=1;this.connecting=null;
    try{this.session?.close();}catch{}
    this.session=null;this.connectedAt=0;
    if(this.resumptionHandle){this.continuityState='RESUMING_ORIGINAL';this.continuityBreakReason=reason;}
  }

  handleMessage(message) {
    const resume = message?.sessionResumptionUpdate;
    if (resume?.resumable && resume?.newHandle) {
      this.resumptionHandle = resume.newHandle;
      this.continuityState = this.recoveryMode?'REHYDRATED_CONTEXT':this.sessionGeneration>1?'RESUMED_ORIGINAL':'ORIGINAL_LIVE';
      if(!this.recoveryMode)this.continuityBreakReason = null;
    }
    const turnComplete = message?.serverContent?.turnComplete === true;
    const pending = this.pending;
    if (pending) {
      const calls = message?.toolCall?.functionCalls || [];
      const expected = pending.kind === 'observation' ? 'record_tick_reflection' : pending.kind === 'interview' ? 'answer_supervisor_question' : pending.kind === 'closing' ? 'submit_closing_reflection' : 'submit_trade_decision';
      const call = calls.find(x => x.name === expected);
      if (call && !pending.toolAnswered) {
        pending.result = call.args || {};
        pending.toolAnswered = true;
        try {
          this.session?.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, response: { result: 'accepted' } }] });
        } catch {}
        clearTimeout(pending.drainTimer);
        pending.drainTimer = setTimeout(() => {
          if (this.pending !== pending) return;
          clearTimeout(pending.timer);
          const { resolve, result } = pending;
          this.pending = null;
          this.serverTurnActive = false;
          resolve(result || {});
        }, 350);
      }
      if (turnComplete && pending.toolAnswered) {
        clearTimeout(pending.drainTimer);
        clearTimeout(pending.timer);
        const { resolve, result } = pending;
        this.pending = null;
        this.serverTurnActive = false;
        resolve(result || {});
        return;
      }
    }
    if (turnComplete && !this.pending) this.serverTurnActive = false;
  }

  handleFailure(err, reconnect = false, attemptGroup = this.connectAttemptSeq) {
    if(attemptGroup!==this.connectAttemptSeq)return;
    const pending = this.pending;
    const failure=classifyProviderError(err);
    this.lastFailure={...failure,at:new Date().toISOString()};
    if(failure.code==='PROVIDER_THROTTLED'){
      this.enterThrottle(err);
      if(pending){clearTimeout(pending.timer);this.pending=null;pending.reject(Object.assign(new Error(failure.message),{code:failure.code,retryable:true}));}
      return;
    }
    if(failure.permanent){
      this.openCircuit(err);
      this.continuityState='CONTINUITY_BROKEN';
      this.continuityBreakReason=failure.code;
      if(pending){clearTimeout(pending.timer);this.pending=null;pending.reject(Object.assign(new Error(failure.message),{code:failure.code,permanent:true}));}
      return;
    }
    this.providerState='DEGRADED';
    if (!this.resumptionHandle) {
      this.continuityState = 'CONTINUITY_BROKEN';
      this.continuityBreakReason ||= String(err?.message || err);
    } else {
      this.continuityState = 'RESUMING_ORIGINAL';
      if (reconnect) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.ensureSession().catch(e => {
          this.continuityState = 'CONTINUITY_BROKEN';
          this.continuityBreakReason = String(e?.message || e);
        }), 250);
      }
    }
    this.session = null;
    this.connectedAt = 0;
    this.serverTurnActive = false;
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

  async waitForIdle(signal, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while ((this.pending || this.serverTurnActive) && Date.now() < deadline) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      await new Promise(r => setTimeout(r, 25));
    }
    if (this.pending || this.serverTurnActive) throw new Error('GEMINI_LIVE_TURN_DRAIN_TIMEOUT');
  }

  async request(prompt, onThought, signal, options = {}) {
    await this.waitForIdle(signal, options.urgent ? 30000 : 20000);
    const session = await this.ensureSession();
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return await new Promise((resolve, reject) => {
      const timeoutMs = options.urgent ? 12000 : REQUEST_TIMEOUT_MS;
      const timer = setTimeout(() => {
        this.pending = null;
        this.serverTurnActive = false;
        reject(new Error('GEMINI_LIVE_TIMEOUT'));
      }, timeoutMs);
      const abort = () => {
        clearTimeout(timer);
        this.pending = null;
        this.serverTurnActive = false;
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.pending = { kind: 'decision', resolve: value => { signal?.removeEventListener('abort', abort); resolve(value); }, reject: err => { signal?.removeEventListener('abort', abort); reject(err); }, timer, onThought };
      try {
        const livePrompt = options.urgent ? prompt : this.compactPrompt(prompt);
        if (onThought) onThought(options.urgent ? 'Gemini Live is evaluating an urgent entry window...' : 'Gemini Live is evaluating the current market state...');
        this.serverTurnActive = true;
        session.sendRealtimeInput({ text: livePrompt });
        this.bootstrapped = true;
      } catch (err) {
        clearTimeout(timer);
        this.pending = null;
        this.serverTurnActive = false;
        reject(err);
      }
    });
  }

  async establishContinuity() {
    if (this.continuityState === 'CONTINUITY_BROKEN') throw new Error(this.continuityBreakReason || 'CONTINUITY_BROKEN');
    const startup = (async () => {
      await this.ensureSession();
      await this.requestObservation('CONTINUOUS_TICK_BATCH\nSESSION_CONTINUITY_HANDSHAKE\nNo market action is allowed. Call record_tick_reflection exactly once with a minimal handshake acknowledgement.');
      const deadline = Date.now() + 5000;
      while (!this.resumptionHandle && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
      if (!this.resumptionHandle) throw new Error('RESUMPTION_HANDLE_NOT_RECEIVED_DURING_STARTUP');
      return this.continuityStatus();
    })();
    let timer;
    try {
      return await Promise.race([startup,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('CONTINUITY_STARTUP_TIMEOUT')),20000);})]);
    } catch (error) {
      this.continuityState = 'CONTINUITY_BROKEN';
      this.continuityBreakReason = String(error?.message || error);
      this.connecting = null;
      this.close(this.continuityBreakReason);
      throw error;
    } finally { clearTimeout(timer); }
  }

  async requestObservation(prompt) {
    await this.waitForIdle(null, 30000);
    const session = await this.ensureSession();
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if(this.pending?.kind!=='observation')return;
        this.pending = null;
        this.serverTurnActive = false;
        this.abortPendingConnection('GEMINI_LIVE_OBSERVATION_TIMEOUT');
        reject(new Error('GEMINI_LIVE_OBSERVATION_TIMEOUT'));
      }, 15000);
      this.pending = { kind: 'observation', resolve, reject, timer, onThought: null };
      try {
        this.serverTurnActive = true;
        session.sendRealtimeInput({ text: prompt });
        this.bootstrapped = true;
      } catch (err) {
        clearTimeout(timer);
        this.pending = null;
        this.serverTurnActive = false;
        reject(err);
      }
    });
  }


  cancelPendingTurn(reason='cancelled') {
    const pending=this.pending;
    if(!pending){this.serverTurnActive=false;return false;}
    clearTimeout(pending.timer);clearTimeout(pending.drainTimer);
    this.pending=null;this.serverTurnActive=false;
    try{pending.reject(new Error(`GEMINI_TURN_CANCELLED:${reason}`));}catch{}
    return true;
  }

  async requestClosingReflection(prompt) {
    this.cancelPendingTurn('CLOSING_REFLECTION_PREEMPT');
    await this.waitForIdle(null, 5000);
    const activeSession = await this.ensureSession();
    if (!activeSession) throw new Error('TRADER_SESSION_RESUME_FAILED');
    if (!['ORIGINAL_LIVE','RESUMED_ORIGINAL','REHYDRATED_CONTEXT'].includes(this.continuityState)) {
      throw new Error(`SAME_TRADER_CONTINUITY_NOT_CONFIRMED:${this.continuityState}`);
    }
    return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending=null;this.serverTurnActive=false;reject(new Error('TRADER_CLOSING_REFLECTION_TIMEOUT'));},90000);
      this.pending={kind:'closing',resolve,reject,timer,onThought:null};
      try{this.serverTurnActive=true;activeSession.sendRealtimeInput({text:`SESSION_CLOSING_REFLECTION\nTrading is locked. Reflect as the same Trader that completed this session. Call submit_closing_reflection exactly once.\n${prompt}`});}
      catch(err){clearTimeout(timer);this.pending=null;this.serverTurnActive=false;reject(err);}
    });
  }

  async answerSupervisor(prompt) {
    await this.waitForIdle(null, 60000);
    if (this.continuityState === 'CONTINUITY_BROKEN') throw new Error('ORIGINAL_TRADER_SESSION_UNAVAILABLE');
    const activeSession = await this.ensureSession();
    return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending=null;this.serverTurnActive=false;reject(new Error('TRADER_INTERVIEW_TIMEOUT'));},60000);
      this.pending={kind:'interview',resolve,reject,timer,onThought:null};
      try{this.serverTurnActive=true;activeSession.sendRealtimeInput({text:`POST_SESSION_SUPERVISOR_INTERVIEW
Trading is locked. Answer as the same Trader that completed this session, using retained context. Do not invent missing memory.
${prompt}`});}
      catch(err){clearTimeout(timer);this.pending=null;this.serverTurnActive=false;reject(err);}
    });
  }
  continuityStatus(){return{available:!!this.session && this.continuityState!=='CONTINUITY_BROKEN',connectedAt:this.connectedAt||null,bootstrapped:!!this.bootstrapped,state:this.continuityState,resumptionHandleAvailable:!!this.resumptionHandle,sessionGeneration:this.sessionGeneration,breakReason:this.continuityBreakReason};}
}

export const geminiLiveTrader = new GeminiLiveTrader();
