const MODEL = 'gemini-3.1-flash-live-preview';
const TOKEN_URL = process.env.FIRSTSIGNAL_TOKEN_URL || 'http://127.0.0.1:5173/api/live-token';
const TIMEOUT_MS = 30000;
const RESPONSE_SCHEMA = {
  type:'object', properties:{
    speaker:{type:'string',enum:['OBSERVER','TRADER']},
    message:{type:'string'}, evidence:{type:'array',items:{type:'string'}},
    verdict:{type:'string',enum:['PENDING','TRADER_JUSTIFIED','OBSERVER_CONFIRMED','SHARED_UNCERTAINTY','NEEDS_HUMAN_REVIEW']},
    concession:{type:'string'}, unresolved:{type:'array',items:{type:'string'}},
    next_question:{type:'string'}, case_status:{type:'string',enum:['CONTINUE','CLOSED']}
  }, required:['speaker','message','evidence','verdict','concession','unresolved','next_question','case_status'], additionalProperties:false
};
async function token(){
  let last;
  for(let i=0;i<5;i++){
    try{
      const r=await fetch(TOKEN_URL,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
      if(!r.ok)throw new Error(`MEETING_TOKEN_${r.status}:${await r.text()}`);
      const j=await r.json();if(!j.token)throw new Error('MEETING_TOKEN_MISSING');return j.token;
    }catch(e){last=e;if(i<4)await new Promise(resolve=>setTimeout(resolve,1000));}
  }
  throw new Error(`MEETING_TOKEN_ROUTE_OFFLINE:${last?.message||last}`);
}
class MeetingModel{
  constructor(){this.sessions=new Map();this.pending=new Map();this.stopped=false;}
  async session(role){if(this.stopped)throw new Error('MEETING_STOPPED');if(this.sessions.has(role))return this.sessions.get(role);const {GoogleGenAI,Modality}=await import('@google/genai');const ephemeral=await token();if(this.stopped)throw new Error('MEETING_STOPPED');const ai=new GoogleGenAI({apiKey:ephemeral,httpOptions:{apiVersion:'v1alpha'}});const s=await ai.live.connect({model:MODEL,callbacks:{onmessage:m=>this.onMessage(role,m),onerror:e=>this.fail(role,new Error(`MEETING_LIVE_ERROR:${e?.message||e}`)),onclose:e=>this.fail(role,new Error(`MEETING_LIVE_CLOSE:${e?.reason||e?.message||''}`))},config:{responseModalities:[Modality.AUDIO],thinkingConfig:{thinkingLevel:'low'},outputAudioTranscription:{},sessionResumption:{},tools:[{functionDeclarations:[{name:'meeting_turn',description:'Return one grounded turn in the FirstSignal Sim review meeting.',parameters:RESPONSE_SCHEMA}]}],systemInstruction:{parts:[{text:role==='TRADER'?'You are the FirstSignal Sim V1 trader defending or correcting your recorded decision. Use only evidence supplied from the historical case. Do not invent hidden reasoning, modify code, or place trades. Admit uncertainty and mistakes when evidence warrants it. Call meeting_turn exactly once and never speak.':'You are the FirstSignal Sim V1 independent observer reviewing the trader. Structured market, position, execution, and outcome evidence outranks prose. A loss does not automatically prove a bad decision. Challenge unsupported certainty, but accept a justified losing decision. Call meeting_turn exactly once and never speak.'}]}}});this.sessions.set(role,s);return s;}
  onMessage(role,m){const p=this.pending.get(role);if(!p)return;const c=(m?.toolCall?.functionCalls||[]).find(x=>x.name==='meeting_turn');if(!c)return;clearTimeout(p.timer);this.pending.delete(role);try{this.sessions.get(role)?.sendToolResponse({functionResponses:[{id:c.id,name:c.name,response:{result:'accepted'}}]});}catch{}p.resolve(c.args||{});}
  fail(role,e){const p=this.pending.get(role);if(p){clearTimeout(p.timer);this.pending.delete(role);p.reject(e);}try{this.sessions.get(role)?.close();}catch{}this.sessions.delete(role);}
  async ask(role,prompt){if(this.stopped)throw new Error('MEETING_STOPPED');if(this.pending.has(role))throw new Error(`MEETING_${role}_BUSY`);const s=await this.session(role);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(role);this.fail(role,new Error(`MEETING_${role}_TIMEOUT`));reject(new Error(`MEETING_${role}_TIMEOUT`));},TIMEOUT_MS);this.pending.set(role,{resolve,reject,timer});s.sendRealtimeInput({text:prompt});});}
  stop(){this.stopped=true;for(const [r,p] of this.pending){clearTimeout(p.timer);p.reject(new Error('MEETING_STOPPED'));}this.pending.clear();for(const s of this.sessions.values())try{s.close();}catch{}this.sessions.clear();}
}
module.exports={MeetingModel};
