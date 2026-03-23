-- Atomic persistence function for CalibrateSnapshot (INV-05, INV-06, INV-10, INV-11).
-- Runs in a single transaction: retire old profile (optional), create new profile,
-- calibration_run, calibration_results, and drift_report — all-or-nothing.

create or replace function calibrate_snapshot_atomic(
  p_snapshot_id          uuid,
  p_provider             text,
  p_model_name           text,
  p_runtime_prompt       text,
  p_calibration_score    numeric,
  p_status               text,
  p_calibrated_at        timestamptz,
  p_termination_reason   text,
  p_iteration_count      integer,
  p_iterations_json      jsonb,
  p_results              jsonb,
  p_retire_profile_id    uuid default null
)
returns jsonb
language plpgsql
as $$
declare
  v_new_profile_id    uuid;
  v_profile_row       jsonb;
  v_run_id            uuid;
  v_run_row           jsonb;
  v_results_out       jsonb := '[]'::jsonb;
  v_drift_row         jsonb;
  v_r                 jsonb;
  v_inserted          record;
begin
  -- Step 1: Retire existing active profile if requested
  if p_retire_profile_id is not null then
    update restoration_profile
       set status = 'retired'
     where id = p_retire_profile_id;
  end if;

  -- Step 2: Insert new restoration_profile
  insert into restoration_profile (
    snapshot_id, provider, model_name, runtime_prompt,
    calibration_score, status, calibrated_at
  ) values (
    p_snapshot_id, p_provider, p_model_name, p_runtime_prompt,
    p_calibration_score, p_status, p_calibrated_at
  )
  returning id into v_new_profile_id;

  select to_jsonb(rp.*) into v_profile_row
    from restoration_profile rp
   where rp.id = v_new_profile_id;

  -- Step 3: Insert calibration_run
  insert into calibration_run (
    restoration_profile_id, iteration_count, final_score,
    termination_reason, iterations_json
  ) values (
    v_new_profile_id, p_iteration_count, p_calibration_score,
    p_termination_reason, p_iterations_json
  )
  returning id into v_run_id;

  select to_jsonb(cr.*) into v_run_row
    from calibration_run cr
   where cr.id = v_run_id;

  -- Step 4: Insert calibration_results (INV-10 trigger validates each)
  for v_r in select * from jsonb_array_elements(p_results)
  loop
    insert into calibration_result (
      calibration_run_id, test_id, response, score, dimension_scores
    ) values (
      v_run_id,
      (v_r->>'test_id')::uuid,
      v_r->>'response',
      (v_r->>'fidelity_score')::numeric,
      v_r->'dimension_scores'
    )
    returning to_jsonb(calibration_result.*) into v_inserted;
    v_results_out := v_results_out || jsonb_build_array(to_jsonb(v_inserted));
  end loop;

  -- Step 5: Insert drift_report (INV-11: source = 'calibration' hardcoded)
  insert into drift_report (
    snapshot_id, restoration_profile_id, source, score
  ) values (
    p_snapshot_id, v_new_profile_id, 'calibration', p_calibration_score
  );

  select to_jsonb(dr.*) into v_drift_row
    from drift_report dr
   where dr.restoration_profile_id = v_new_profile_id
     and dr.source = 'calibration';

  -- Step 6: Return composite result
  return jsonb_build_object(
    'restoration_profile', v_profile_row,
    'calibration_run', v_run_row,
    'results', v_results_out,
    'drift_report', v_drift_row
  );
end;
$$;
