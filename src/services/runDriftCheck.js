const supabase = require('../supabase');
const { callTargetLlm } = require('../utils/llmProviders');
const { scoreResponse } = require('./calibrateSnapshot');

async function runDriftCheck(driftMonitorId) {
  // --- Load DriftMonitor ---
  const { data: monitor, error: monitorError } = await supabase
    .from('drift_monitor')
    .select('*')
    .eq('id', driftMonitorId)
    .single();

  if (monitorError || !monitor) {
    const err = new Error('DriftMonitor not found');
    err.statusCode = 404;
    throw err;
  }

  if (!monitor.restoration_profile_id) {
    const err = new Error('DriftMonitor has no linked RestorationProfile');
    err.statusCode = 400;
    throw err;
  }

  // --- Load RestorationProfile (any status — retired/failed still checked) ---
  const { data: profile, error: profileError } = await supabase
    .from('restoration_profile')
    .select('id, snapshot_id, provider, model_name, runtime_prompt')
    .eq('id', monitor.restoration_profile_id)
    .single();

  if (profileError || !profile) {
    const err = new Error('RestorationProfile not found for this DriftMonitor');
    err.statusCode = 404;
    throw err;
  }

  // --- Load Tests for this snapshot (INV-01: read-only) ---
  const { data: tests, error: testsError } = await supabase
    .from('test')
    .select('id, prompt, expected_traits_json, forbidden_traits_json')
    .eq('snapshot_id', profile.snapshot_id);

  if (testsError || !tests || tests.length === 0) {
    const err = new Error('No tests found for snapshot — drift check requires at least one test');
    err.statusCode = 400;
    throw err;
  }

  // --- Run scoring (reuses CalibrateSnapshot's exact scoring mechanism) ---
  const testResults = [];
  for (const test of tests) {
    let response;
    try {
      response = await callTargetLlm(profile.provider, profile.model_name, profile.runtime_prompt, test.prompt);
    } catch (e) {
      if (e.statusCode) throw e;
      const err = new Error('Drift check failed during target LLM call');
      err.statusCode = 502;
      throw err;
    }

    let scored;
    try {
      scored = await scoreResponse(response, test.expected_traits_json, test.forbidden_traits_json);
    } catch (e) {
      if (e.statusCode) throw e;
      const err = new Error('Drift check failed during response scoring');
      err.statusCode = 502;
      throw err;
    }

    testResults.push({
      test_id: test.id,
      response,
      fidelity_score: scored.overall,
      dimension_scores: scored.dimensions,
    });
  }

  // --- Compute overall score (mean of test fidelity scores) ---
  const checkScore = testResults.reduce((sum, r) => sum + r.fidelity_score, 0) / testResults.length;

  // --- Create DriftReport (INV-11: source = 'monitoring') ---
  const { data: driftReport, error: reportError } = await supabase
    .from('drift_report')
    .insert({
      snapshot_id: profile.snapshot_id,
      restoration_profile_id: profile.id,
      source: 'monitoring',
      score: checkScore,
      details: { test_results: testResults },
    })
    .select()
    .single();

  if (reportError) {
    const err = new Error('Failed to create drift report');
    err.statusCode = 500;
    throw err;
  }

  // --- Update DriftMonitor latest_score and last_check_at ---
  const belowThreshold = checkScore < monitor.drift_threshold;
  const newStatus = belowThreshold ? 'drift_detected' : 'healthy';

  const { error: updateError } = await supabase
    .from('drift_monitor')
    .update({
      latest_score: checkScore,
      last_check_at: new Date().toISOString(),
      status: newStatus,
    })
    .eq('id', driftMonitorId);

  if (updateError) {
    const err = new Error('Failed to update drift monitor');
    err.statusCode = 500;
    throw err;
  }

  // --- Threshold crossing check (above → below only) ---
  let alert = null;
  if (belowThreshold) {
    // Read the most recent prior DriftReport for this monitor
    // (excluding the one we just created)
    const { data: priorReports } = await supabase
      .from('drift_report')
      .select('score')
      .eq('snapshot_id', profile.snapshot_id)
      .eq('restoration_profile_id', profile.id)
      .eq('source', 'monitoring')
      .neq('id', driftReport.id)
      .order('created_at', { ascending: false })
      .limit(1);

    // No prior report → treat as "above threshold" (first check can trigger Alert)
    const priorScore = priorReports && priorReports.length > 0
      ? priorReports[0].score
      : monitor.drift_threshold; // at threshold = above threshold

    const priorWasAbove = priorScore >= monitor.drift_threshold;

    if (priorWasAbove) {
      // Above → below crossing: create Alert
      const { data: alertData, error: alertError } = await supabase
        .from('alert')
        .insert({
          persona_id: monitor.persona_id,
          drift_monitor_id: driftMonitorId,
          message: `Drift detected: score ${checkScore.toFixed(1)} fell below threshold ${monitor.drift_threshold} (previous: ${priorScore.toFixed(1)})`,
        })
        .select()
        .single();

      if (alertError) {
        const err = new Error('Failed to create alert');
        err.statusCode = 500;
        throw err;
      }
      alert = alertData;
    }
  }

  return {
    drift_report: driftReport,
    score: checkScore,
    status: newStatus,
    alert,
  };
}

module.exports = { runDriftCheck };
