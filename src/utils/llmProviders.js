const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const ORCHESTRATOR_MODEL = 'gpt-4o';

/**
 * Calls the orchestrator LLM (always OpenAI GPT-4o).
 * Used for prompt generation and response scoring.
 * Returns the raw response text string.
 */
async function callOrchestrator(systemPrompt, userContent) {
  try {
    const response = await openai.chat.completions.create({
      model: ORCHESTRATOR_MODEL,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    });
    return response.choices[0].message.content;
  } catch (e) {
    const err = new Error('Orchestrator LLM call failed: ' + (e.message || 'unknown error'));
    err.statusCode = 502;
    throw err;
  }
}

/**
 * Calls the target LLM being calibrated.
 * Returns the raw response text string.
 */
async function callTargetLlm(provider, modelName, systemPrompt, userContent) {
  if (provider === 'openai') {
    try {
      const response = await openai.chat.completions.create({
        model: modelName,
        max_tokens: 4096,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      });
      return response.choices[0].message.content;
    } catch (e) {
      const err = new Error('Target LLM call failed: ' + (e.message || 'unknown error'));
      err.statusCode = 502;
      throw err;
    }
  }

  if (provider === 'anthropic') {
    const err = new Error('Anthropic provider not yet supported');
    err.statusCode = 501;
    throw err;
  }

  const err = new Error(`Provider '${provider}' not yet supported`);
  err.statusCode = 501;
  throw err;
}

module.exports = { callOrchestrator, callTargetLlm };
