const geminiLiveQa = require('./gemini-live-qa.cjs');

async function createRunner() {
  const { Agent, Runner, setTracingDisabled } = await import('@openai/agents-core');
  setTracingDisabled(true);

  class GeminiLiveModel {
    constructor() { this.name = 'gemini-live-qa'; this.snapshot = null; }
    async getResponse() {
      const report = await geminiLiveQa.observe(this.snapshot);
      return { usage: {}, output: [{
        id: `qa_${Date.now()}`, type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify(report) }],
      }] };
    }
    async *getStreamedResponse() {
      const response = await this.getResponse();
      yield { type: 'response.completed', response };
    }
  }

  const model = new GeminiLiveModel();
  const agent = new Agent({
    name: 'FirstSignal Simulator QA Agent',
    instructions: 'Observe, classify, and report. Never trade or modify the simulator. Respect GREEN, YELLOW, and RED authority.',
    model,
  });
  const runner = new Runner();
  return async snapshot => {
    model.snapshot = snapshot;
    const result = await runner.run(agent, 'Inspect the current simulator state.');
    return typeof result.finalOutput === 'string' ? JSON.parse(result.finalOutput) : result.finalOutput;
  };
}

module.exports = { createRunner };
