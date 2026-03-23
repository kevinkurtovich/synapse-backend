const supabase = require('../supabase');
const { callOrchestrator, callTargetLlm } = require('../utils/llmProviders');

// Convergence parameters (constants, not configurable)
const TARGET_FIDELITY = 85;
const MAX_ITERATIONS = 5;
const STALL_THRESHOLD = 2;
const STALL_WINDOW = 2;

const VALID_PROVIDERS = ['openai', 'anthropic', 'google', 'meta', 'mistral', 'other'];

// ---------------------------------------------------------------------------
// LLM Helpers
// ---------------------------------------------------------------------------

function parseJsonResponse(text) {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) return JSON.parse(jsonMatch[1].trim());
  return JSON.parse(text.trim());
}

async function generateInitialPrompt(snapshot, examples) {
  const systemPrompt = `You are an expert at creating system prompts for LLMs. Given a behavioral specification (snapshot) and example conversations, generate a runtime system prompt that would cause a target LLM to faithfully reproduce this persona's behavior.

The generated prompt must encode:
- Identity: who the persona is, core traits, values, self-concept
- Tone: directness, warmth, humor, formality, verbosity, confidence levels
- Interaction style: structure, question frequency, practicality, validation patterns
- Boundary behaviors: how to handle refusals, uncertainty, apologies

Return ONLY the generated system prompt text, with no wrapping or explanation.`;

  const userContent = `Behavioral Specification:
${JSON.stringify({
    distillation_summary: snapshot.distillation_summary,
    identity_json: snapshot.identity_json,
    tone_json: snapshot.tone_json,
    interaction_json: snapshot.interaction_json,
    boundaries_json: snapshot.boundaries_json,
    memory_context_json: snapshot.memory_context_json,
    traits_to_preserve_json: snapshot.traits_to_preserve_json,
    traits_to_avoid_json: snapshot.traits_to_avoid_json,
  }, null, 2)}

Example Conversations:
${JSON.stringify(examples.map(e => ({ input: e.input_text, output: e.output_text, type: e.type })), null, 2)}`;

  return await callOrchestrator(systemPrompt, userContent);
}

async function refinePrompt(currentPrompt, snapshot, lastIterationResults, lastScore) {
  const systemPrompt = `You are an expert at refining system prompts for LLMs. Given a current system prompt, the behavioral specification it should match, and the results of testing it (including scores and actual responses), produce an improved version of the system prompt that better aligns with the specification.

Focus on areas where the test responses deviated from expected traits or exhibited forbidden traits.

Return ONLY the refined system prompt text, with no wrapping or explanation.`;

  const userContent = `Current System Prompt:
${currentPrompt}

Last Score: ${lastScore}

Behavioral Specification:
${JSON.stringify({
    distillation_summary: snapshot.distillation_summary,
    identity_json: snapshot.identity_json,
    tone_json: snapshot.tone_json,
    interaction_json: snapshot.interaction_json,
    boundaries_json: snapshot.boundaries_json,
    traits_to_preserve_json: snapshot.traits_to_preserve_json,
    traits_to_avoid_json: snapshot.traits_to_avoid_json,
  }, null, 2)}

Test Results from Last Iteration:
${JSON.stringify(lastIterationResults.map(r => ({
    response: r.response,
    fidelity_score: r.fidelity_score,
    dimension_scores: r.dimension_scores,
  })), null, 2)}`;

  return await callOrchestrator(systemPrompt, userContent);
}

async function scoreResponse(response, expectedTraitsJson, forbiddenTraitsJson) {
  const systemPrompt = `You are a behavioral fidelity evaluator. Given a response from an LLM and the expected/forbidden traits, evaluate how well the response matches the expected behavioral profile.

Return ONLY a JSON object with this exact structure:
{
  "overall": <0-100 numeric score>,
  "dimensions": {
    "trait_alignment": <0-100>,
    "tone_accuracy": <0-100>,
    "boundary_compliance": <0-100>,
    "naturalness": <0-100>
  }
}`;

  const userContent = `Response to evaluate:
${response}

Expected traits:
${JSON.stringify(expectedTraitsJson)}

Forbidden traits:
${JSON.stringify(forbiddenTraitsJson)}`;

  const text = await callOrchestrator(systemPrompt, userContent);
  return parseJsonResponse(text);
}

// ---------------------------------------------------------------------------
// Main Service
// ---------------------------------------------------------------------------

async function calibrateSnapshot(snapshotId, provider, modelName) {
  // --- Validation ---

  // 1. Provider must be valid
  if (!VALID_PROVIDERS.includes(provider)) {
    const err = new Error(`Invalid provider '${provider}'. Must be one of: ${VALID_PROVIDERS.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  // 2. modelName must be non-empty string
  if (!modelName || typeof modelName !== 'string' || modelName.trim() === '') {
    const err = new Error('model_name is required and must be a non-empty string');
    err.statusCode = 400;
    throw err;
  }

  // 5. Provider support check — surface 501 before loading snapshot data
  if (provider !== 'openai') {
    await callTargetLlm(provider, modelName, '', ''); // will throw 501
  }

  // 3. Snapshot must exist (INV-12)
  const { data: snapshot, error: snapError } = await supabase
    .from('snapshot')
    .select('*')
    .eq('id', snapshotId)
    .single();

  if (snapError || !snapshot) {
    const err = new Error('Snapshot not found');
    err.statusCode = 404;
    throw err;
  }

  // 4. Must have at least one linked Test
  const { data: tests, error: testsError } = await supabase
    .from('test')
    .select('*')
    .eq('snapshot_id', snapshotId);

  if (testsError || !tests || tests.length === 0) {
    const err = new Error('Snapshot has no linked Tests — calibration requires at least one Test');
    err.statusCode = 400;
    throw err;
  }

  // --- Data Loading ---
  const { data: examples } = await supabase
    .from('example')
    .select('*')
    .eq('snapshot_id', snapshotId);

  // --- Duplicate check ---
  const { data: existingProfiles } = await supabase
    .from('restoration_profile')
    .select('id')
    .eq('snapshot_id', snapshotId)
    .eq('provider', provider)
    .eq('model_name', modelName)
    .eq('status', 'active');

  const existingProfileId = existingProfiles && existingProfiles.length > 0
    ? existingProfiles[0].id
    : null;

  // --- Calibration Loop ---
  const scores = [];
  const iterations = [];
  let termination = null;
  let bestScore = -1;
  let bestPrompt = null;
  let bestResults = [];
  let lastIterationResults = [];
  let currentPrompt = null;

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    // Step A: Generate or refine the runtime prompt
    try {
      if (iteration === 1) {
        currentPrompt = await generateInitialPrompt(snapshot, examples || []);
      } else {
        currentPrompt = await refinePrompt(currentPrompt, snapshot, lastIterationResults, scores[iteration - 2]);
      }
    } catch (e) {
      if (e.statusCode) throw e;
      const err = new Error(`Calibration failed during prompt generation (iteration ${iteration})`);
      err.statusCode = 502;
      throw err;
    }

    // Step B: Test the prompt against each Test using the target LLM
    const iterationResults = [];
    for (const test of tests) {
      let response;
      try {
        response = await callTargetLlm(provider, modelName, currentPrompt, test.prompt);
      } catch (e) {
        if (e.statusCode) throw e;
        const err = new Error(`Calibration failed during target LLM call (iteration ${iteration})`);
        err.statusCode = 502;
        throw err;
      }

      let scored;
      try {
        scored = await scoreResponse(response, test.expected_traits_json, test.forbidden_traits_json);
      } catch (e) {
        if (e.statusCode) throw e;
        const err = new Error(`Calibration failed during response scoring (iteration ${iteration})`);
        err.statusCode = 502;
        throw err;
      }

      iterationResults.push({
        test_id: test.id,
        response,
        fidelity_score: scored.overall,
        dimension_scores: scored.dimensions,
      });
    }

    // Step C: Compute iteration score (mean of test fidelity scores)
    const iterationScore = iterationResults.reduce((sum, r) => sum + r.fidelity_score, 0) / iterationResults.length;
    scores.push(iterationScore);
    iterations.push({
      iteration,
      score: iterationScore,
      prompt: currentPrompt,
      result_count: iterationResults.length,
    });

    // Track best
    if (iterationScore > bestScore) {
      bestScore = iterationScore;
      bestPrompt = currentPrompt;
      bestResults = iterationResults;
    }
    lastIterationResults = iterationResults;

    // Step D: Convergence check
    if (iterationScore >= TARGET_FIDELITY) {
      termination = 'converged';
      break;
    }

    // Step E: Stall check (requires 3+ data points)
    if (scores.length >= 3) {
      if (scores[scores.length - 1] - scores[scores.length - 3] < STALL_THRESHOLD) {
        termination = 'stalled';
        break;
      }
    }
  }

  // After loop
  if (termination === null) termination = 'max_iterations';
  const finalStatus = bestScore >= 60 ? 'active' : 'failed';

  // --- Atomic persistence via RPC ---
  // Only retire existing profile if the new calibration reaches 'active'
  const retireId = (finalStatus === 'active' && existingProfileId) ? existingProfileId : null;

  const { data: result, error: rpcError } = await supabase.rpc('calibrate_snapshot_atomic', {
    p_snapshot_id: snapshotId,
    p_provider: provider,
    p_model_name: modelName,
    p_runtime_prompt: bestPrompt,
    p_calibration_score: bestScore,
    p_status: finalStatus,
    p_calibrated_at: new Date().toISOString(),
    p_termination_reason: termination,
    p_iteration_count: iterations.length,
    p_iterations_json: iterations,
    p_results: bestResults,
    p_retire_profile_id: retireId,
  });

  if (rpcError) {
    if (rpcError.message && rpcError.message.includes('INV-05')) {
      const err = new Error('Status transition violation during profile retirement');
      err.statusCode = 409;
      throw err;
    }
    if (rpcError.message && rpcError.message.includes('INV-10')) {
      const err = new Error('Test lineage violation: calibration result test does not belong to the same snapshot');
      err.statusCode = 400;
      throw err;
    }
    const err = new Error('Failed to persist calibration results');
    err.statusCode = 500;
    throw err;
  }

  return {
    restoration_profile: result.restoration_profile,
    calibration_run: result.calibration_run,
    results: result.results,
    drift_report: result.drift_report,
  };
}

module.exports = { calibrateSnapshot };
