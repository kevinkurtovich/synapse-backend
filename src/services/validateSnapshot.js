const supabase = require('../supabase');
const { callTargetLlm, callOrchestrator } = require('../utils/llmProviders');

// ---------------------------------------------------------------------------
// Canonical Probes (v1 — hardcoded, 3 probes)
// ---------------------------------------------------------------------------

const CANONICAL_PROBES = [
  {
    label: 'companion_name',
    prompt: 'What is your name?',
    extractExpected: (snapshot) => {
      const identity = snapshot.identity_json;
      if (!identity) return null;
      return identity.name || identity.companion_name || null;
    },
    evaluationQuestion: (expected) =>
      `Does this response confirm that the AI identifies itself as "${expected}"? Answer only YES or NO.`,
  },
  {
    label: 'user_recognition',
    prompt: 'Who am I to you?',
    extractExpected: (snapshot) => {
      const memory = snapshot.memory_context_json;
      if (!memory) return null;
      return memory.user_identity || memory.user_name || null;
    },
    evaluationQuestion: (expected) =>
      `Does this response reference or acknowledge the user as "${expected}"? Answer only YES or NO.`,
  },
  {
    label: 'relationship_framing',
    prompt: 'How would you describe our relationship?',
    extractExpected: (snapshot) => {
      const memory = snapshot.memory_context_json;
      if (!memory) return null;
      return memory.relationship_framing || memory.relationship || null;
    },
    evaluationQuestion: (expected) =>
      `Does this response reflect the relationship framing of "${expected}" rather than being generic or evasive? Answer only YES or NO.`,
  },
];

// ---------------------------------------------------------------------------
// Main Service
// ---------------------------------------------------------------------------

async function validateSnapshot(restorationProfileId) {
  // 1. Resolution — fetch RestorationProfile
  const { data: profile, error: profileError } = await supabase
    .from('restoration_profile')
    .select('id, snapshot_id, provider, model_name, runtime_prompt')
    .eq('id', restorationProfileId)
    .single();

  if (profileError || !profile) {
    const err = new Error('RestorationProfile not found');
    err.statusCode = 404;
    throw err;
  }

  // Resolve linked Snapshot
  const { data: snapshot, error: snapError } = await supabase
    .from('snapshot')
    .select('id, identity_json, memory_context_json')
    .eq('id', profile.snapshot_id)
    .single();

  if (snapError || !snapshot) {
    const err = new Error('Linked Snapshot not found');
    err.statusCode = 404;
    throw err;
  }

  // 2–4. Probe construction, execution, and evaluation
  const probeResults = [];

  for (const probe of CANONICAL_PROBES) {
    const expectedValue = probe.extractExpected(snapshot);

    // If the expected field is null/empty, probe automatically fails
    if (!expectedValue) {
      probeResults.push({
        label: probe.label,
        prompt: probe.prompt,
        response: '',
        passed: false,
      });
      continue;
    }

    // 3. Execute probe — single user turn against target LLM
    let response;
    try {
      response = await callTargetLlm(
        profile.provider,
        profile.model_name,
        profile.runtime_prompt || '',
        probe.prompt
      );
    } catch (e) {
      // LLM call failure → abort entire run, 502, no records persisted (INV-15)
      const err = new Error('LLM call failed during validation probe: ' + probe.label);
      err.statusCode = 502;
      throw err;
    }

    // 4. Evaluate — secondary evaluation call
    let passed = false;
    try {
      const evalResponse = await callOrchestrator(
        'You are an identity verification evaluator. Answer only YES or NO.',
        probe.evaluationQuestion(expectedValue) + '\n\nResponse to evaluate:\n' + response
      );
      passed = evalResponse.trim().toUpperCase().startsWith('YES');
    } catch (e) {
      // Evaluation LLM failure → abort entire run
      const err = new Error('Evaluation LLM call failed during probe: ' + probe.label);
      err.statusCode = 502;
      throw err;
    }

    probeResults.push({
      label: probe.label,
      prompt: probe.prompt,
      response,
      passed,
    });
  }

  // 5. Verdict computation
  const passedCount = probeResults.filter(r => r.passed).length;
  const totalCount = probeResults.length;
  const verdict = passedCount === totalCount ? 'PASS' : 'FAIL';

  // 6. Atomic persistence (INV-15) via RPC
  const { data: result, error: rpcError } = await supabase.rpc('validate_snapshot_atomic', {
    p_restoration_profile_id: restorationProfileId,
    p_verdict: verdict,
    p_passed_count: passedCount,
    p_total_count: totalCount,
    p_probe_results: probeResults,
  });

  if (rpcError) {
    const err = new Error('Failed to persist validation results');
    err.statusCode = 500;
    throw err;
  }

  // 7. Return completed ValidationRun with nested results
  return result;
}

module.exports = { validateSnapshot };
