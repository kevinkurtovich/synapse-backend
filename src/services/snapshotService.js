const supabase = require('../supabase');

const BUNDLE_VERSION = '1.0';

const REQUIRED_SNAPSHOT_FIELDS = [
  'identity_json', 'tone_json', 'interaction_json', 'boundaries_json',
  'memory_context_json', 'traits_to_preserve_json', 'traits_to_avoid_json',
  'confidence_by_dimension_json', 'distillation_summary',
];

// ---------------------------------------------------------------------------
// ExportSnapshot
// ---------------------------------------------------------------------------

async function exportSnapshot(snapshotId) {
  // Load snapshot
  const { data: snapshot, error: snapError } = await supabase
    .from('snapshot')
    .select('identity_json, tone_json, interaction_json, boundaries_json, memory_context_json, traits_to_preserve_json, traits_to_avoid_json, confidence_by_dimension_json, distillation_summary')
    .eq('id', snapshotId)
    .single();

  if (snapError || !snapshot) {
    const err = new Error('Snapshot not found');
    err.statusCode = 404;
    throw err;
  }

  // Load examples, tests, and profiles in parallel (no N+1)
  const [examplesRes, testsRes, profilesRes] = await Promise.all([
    supabase
      .from('example')
      .select('type, input_text, output_text, traits_json, weight')
      .eq('snapshot_id', snapshotId),
    supabase
      .from('test')
      .select('name, category, prompt, expected_traits_json, forbidden_traits_json, weight, reference_response')
      .eq('snapshot_id', snapshotId),
    supabase
      .from('restoration_profile')
      .select('provider, model_name, runtime_prompt, calibration_score, status')
      .eq('snapshot_id', snapshotId),
  ]);

  if (examplesRes.error || testsRes.error || profilesRes.error) {
    const err = new Error('Failed to load snapshot data');
    err.statusCode = 500;
    throw err;
  }

  // Map test rows: DB column "prompt" → bundle field "prompt_text"
  const tests = (testsRes.data || []).map(t => ({
    name: t.name,
    category: t.category,
    prompt_text: t.prompt,
    expected_traits_json: t.expected_traits_json,
    forbidden_traits_json: t.forbidden_traits_json,
    weight: t.weight,
    reference_response: t.reference_response,
  }));

  return {
    bundle_version: BUNDLE_VERSION,
    exported_at: new Date().toISOString(),
    snapshot,
    examples: examplesRes.data || [],
    tests,
    restoration_profiles: profilesRes.data || [],
  };
}

// ---------------------------------------------------------------------------
// ImportSnapshot
// ---------------------------------------------------------------------------

async function importSnapshot(bundle) {
  // --- Validation ---
  if (!bundle || typeof bundle !== 'object') {
    const err = new Error('Invalid bundle: expected a JSON object');
    err.statusCode = 400;
    throw err;
  }

  if (!bundle.snapshot || typeof bundle.snapshot !== 'object') {
    const err = new Error('Invalid bundle: missing snapshot section');
    err.statusCode = 400;
    throw err;
  }

  // Validate required snapshot fields
  for (const field of REQUIRED_SNAPSHOT_FIELDS) {
    if (bundle.snapshot[field] === undefined || bundle.snapshot[field] === null) {
      const err = new Error(`Invalid bundle: missing required snapshot field '${field}'`);
      err.statusCode = 400;
      throw err;
    }
  }

  if (!Array.isArray(bundle.examples)) {
    const err = new Error('Invalid bundle: examples must be an array');
    err.statusCode = 400;
    throw err;
  }

  if (!Array.isArray(bundle.tests)) {
    const err = new Error('Invalid bundle: tests must be an array');
    err.statusCode = 400;
    throw err;
  }

  // Validate each test has prompt_text (NOT NULL in DB)
  for (let i = 0; i < bundle.tests.length; i++) {
    if (!bundle.tests[i].prompt_text || typeof bundle.tests[i].prompt_text !== 'string') {
      const err = new Error(`Invalid bundle: test at index ${i} missing required field 'prompt_text'`);
      err.statusCode = 400;
      throw err;
    }
  }

  // restoration_profiles is optional — default to empty array
  const profiles = Array.isArray(bundle.restoration_profiles) ? bundle.restoration_profiles : [];

  // Validate profile fields
  for (let i = 0; i < profiles.length; i++) {
    const p = profiles[i];
    if (!p.provider || !p.model_name) {
      const err = new Error(`Invalid bundle: restoration_profile at index ${i} missing required fields`);
      err.statusCode = 400;
      throw err;
    }
  }

  // --- Atomic persistence via RPC ---
  const personaName = bundle.persona_name || 'Imported Persona';

  const { data: result, error: rpcError } = await supabase.rpc('import_snapshot_atomic', {
    p_persona_name: personaName,
    p_snapshot: bundle.snapshot,
    p_examples: bundle.examples,
    p_tests: bundle.tests,
    p_profiles: profiles,
  });

  if (rpcError) {
    if (rpcError.message && rpcError.message.includes('persona_slug_unique')) {
      const err = new Error('Import conflict: generated slug collision. Please retry.');
      err.statusCode = 409;
      throw err;
    }
    const err = new Error('Failed to import snapshot: ' + (rpcError.message || 'unknown error'));
    err.statusCode = 500;
    throw err;
  }

  return {
    persona_id: result.persona_id,
    snapshot_id: result.snapshot_id,
    restoration_profile_ids: result.restoration_profile_ids,
  };
}

module.exports = { exportSnapshot, importSnapshot };
