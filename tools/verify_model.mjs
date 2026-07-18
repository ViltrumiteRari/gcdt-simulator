import { GoogleGenAI, Modality } from '@google/genai';
const tokenResponse = await fetch('https://firstsignal-sim.vercel.app/api/live-token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
const { token } = await tokenResponse.json();
let settle;
const result = new Promise((resolve, reject) => { settle = { resolve, reject }; });
const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });
const session = await ai.live.connect({
  model: 'gemini-3.1-flash-live-preview',
  callbacks: {
    onopen() { console.log('OPEN'); },
    onmessage(message) {
      console.log('MESSAGE', JSON.stringify(message).slice(0, 1200));
      const call = message?.toolCall?.functionCalls?.[0];
      if (call) settle.resolve(call.args);
    },
    onerror(event) { settle.reject(new Error(event?.message || 'live error')); },
    onclose(event) { console.log('CLOSE', event?.reason || ''); },
  },
  config: {
    responseModalities: [Modality.AUDIO],
    thinkingConfig: { thinkingLevel: 'low' },
    tools: [{ functionDeclarations: [{ name: 'submit_trade_decision', description: 'Return the test decision', parameters: { type: 'object', properties: { decision: { type: 'string' }, reasoning: { type: 'string' } }, required: ['decision','reasoning'] } }] }],
    systemInstruction: { parts: [{ text: 'Always call submit_trade_decision exactly once. Never speak.' }] },
  },
});
session.sendRealtimeInput({ text: 'Return WAIT with reasoning test.' });
const output = await Promise.race([result, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000))]);
console.log('RESULT', output);
session.close();
