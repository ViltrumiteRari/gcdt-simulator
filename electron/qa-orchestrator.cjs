const geminiLiveQa = require('./gemini-live-qa.cjs');

function toolResult(request, name) {
  const item = [...(request.input || [])].reverse().find(x => x.type === 'function_call_result' && x.name === name);
  if (!item) return null;
  const text = item.output?.text ?? item.output;
  try { return typeof text === 'string' ? JSON.parse(text) : text; } catch { return text; }
}

async function createRunner(hooks) {
  const { Agent, Runner, tool, setTracingDisabled } = await import('@openai/agents-core');
  setTracingDisabled(true);

  const inspectTool = tool({
    name: 'inspect_live_context',
    description: 'Inspect recent simulator events, prior QA findings, and meaningful state changes before judging the current event.',
    parameters: { type: 'object', properties: { eventWindow: { type: 'number' }, includePriorReports: { type: 'boolean' } }, required: ['eventWindow','includePriorReports'], additionalProperties: false },
    execute: async input => {
      hooks.activity('TOOL', `Inspecting last ${input.eventWindow} simulator events`);
      return hooks.inspect(input.eventWindow, input.includePriorReports);
    },
  });

  const recordTool = tool({
    name: 'record_observation',
    description: 'Record the final evidence-based QA observation after inspection.',
    parameters: { type: 'object', properties: {
      level: { type: 'string', enum: ['GREEN','YELLOW','RED'] }, category: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' },
      evidence: { type: 'array', items: { type: 'string' } }, suggested_action: { type: 'string' }, approval_required: { type: 'boolean' }, confidence: { type: 'number' },
    }, required: ['level','category','title','summary','evidence','suggested_action','approval_required','confidence'], additionalProperties: false },
    execute: async report => { hooks.activity('TOOL', `Recording ${report.level} finding: ${report.title}`); return report; },
  });

  class GeminiLiveModel {
    constructor() { this.name = 'gemini-live-qa'; this.snapshot = null; }
    async getResponse(request) {
      const inspection = toolResult(request, 'inspect_live_context');
      const recorded = toolResult(request, 'record_observation');
      if (!inspection) {
        hooks.activity('RUNNER', 'Agent requested live context inspection');
        return { usage: {}, output: [{ type: 'function_call', callId: `inspect_${Date.now()}`, name: 'inspect_live_context', status: 'completed', arguments: JSON.stringify({ eventWindow: 40, includePriorReports: true }) }] };
      }
      if (!recorded) {
        hooks.activity('MODEL', 'Gemini Live is evaluating inspected evidence');
        const report = await geminiLiveQa.observe({ current: this.snapshot, inspection });
        return { usage: {}, output: [{ type: 'function_call', callId: `record_${Date.now()}`, name: 'record_observation', status: 'completed', arguments: JSON.stringify(report) }] };
      }
      return { usage: {}, output: [{ id: `qa_${Date.now()}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(recorded) }] }] };
    }
    async *getStreamedResponse(request) { const response = await this.getResponse(request); yield { type: 'response.completed', response }; }
  }

  const model = new GeminiLiveModel();
  const agent = new Agent({
    name: 'FirstSignal Live Simulator QA Agent',
    instructions: 'Continuously supervise FirstSignal. Always inspect live context before recording a finding. Never trade or modify code. GREEN may be logged. YELLOW may recommend isolated investigation. RED requires explicit approval.',
    model,
    tools: [inspectTool, recordTool],
  });
  const runner = new Runner();
  return async snapshot => {
    model.snapshot = snapshot;
    hooks.activity('RUNNER', `Starting agent run at tick ${snapshot.tick}`);
    const result = await runner.run(agent, 'Investigate the latest simulator event and record the highest-value supported observation.');
    hooks.activity('RUNNER', 'Agent run completed');
    return typeof result.finalOutput === 'string' ? JSON.parse(result.finalOutput) : result.finalOutput;
  };
}

module.exports = { createRunner };
