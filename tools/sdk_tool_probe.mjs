import { Agent, Runner, tool, setTracingDisabled } from '@openai/agents-core';
setTracingDisabled(true);
let n=0;
class M { async getResponse(req){ console.log('CALL',++n,JSON.stringify(req,null,2).slice(0,5000)); if(n===1)return {usage:{},output:[{type:'function_call',callId:'c1',name:'inspect',arguments:'{"window":5}',status:'completed'}]}; return {usage:{},output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'done'}]}]};} async *getStreamedResponse(req){yield {type:'response.completed',response:await this.getResponse(req)}} }
const t=tool({name:'inspect',description:'inspect',parameters:{type:'object',properties:{window:{type:'number'}},required:['window'],additionalProperties:false},execute:async x=>({ok:true,x})});
const a=new Agent({name:'x',instructions:'x',model:new M(),tools:[t]});
const r=await new Runner().run(a,'go');console.log('FINAL',r.finalOutput);
