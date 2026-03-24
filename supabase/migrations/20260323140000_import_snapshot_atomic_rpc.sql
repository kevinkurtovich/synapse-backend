-- Atomic persistence function for ImportSnapshot (INV-02).
-- Runs in a single transaction: Persona + Snapshot + Examples + Tests +
-- RestorationProfiles — all-or-nothing. If any step fails, zero records persist.

create or replace function import_snapshot_atomic(
  p_persona_name  text,
  p_snapshot      jsonb,
  p_examples      jsonb,
  p_tests         jsonb,
  p_profiles      jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_persona_id      uuid;
  v_persona_slug    text;
  v_snapshot_id     uuid;
  v_snapshot_row    jsonb;
  v_examples_out    jsonb := '[]'::jsonb;
  v_tests_out       jsonb := '[]'::jsonb;
  v_profiles_out    jsonb := '[]'::jsonb;
  v_profile_ids     jsonb := '[]'::jsonb;
  v_ex              jsonb;
  v_t               jsonb;
  v_p               jsonb;
  v_inserted        record;
begin
  -- Step 1: Create Persona with a UUID-based slug for uniqueness
  v_persona_slug := 'imported-' || replace(gen_random_uuid()::text, '-', '');

  insert into persona (name, slug, status)
  values (
    coalesce(p_persona_name, 'Imported Persona'),
    v_persona_slug,
    'active'
  )
  returning id into v_persona_id;

  -- Step 2: Create root Snapshot (INV-03: version_number=1, INV-04: parent=null)
  insert into snapshot (
    persona_id, parent_snapshot_id, version_number,
    distillation_summary, identity_json, tone_json, interaction_json,
    boundaries_json, memory_context_json, traits_to_preserve_json,
    traits_to_avoid_json, confidence_by_dimension_json
  ) values (
    v_persona_id,
    null,
    1,
    p_snapshot->>'distillation_summary',
    p_snapshot->'identity_json',
    p_snapshot->'tone_json',
    p_snapshot->'interaction_json',
    p_snapshot->'boundaries_json',
    p_snapshot->'memory_context_json',
    p_snapshot->'traits_to_preserve_json',
    p_snapshot->'traits_to_avoid_json',
    p_snapshot->'confidence_by_dimension_json'
  )
  returning to_jsonb(snapshot.*) into v_snapshot_row;

  v_snapshot_id := (v_snapshot_row->>'id')::uuid;

  -- Step 3: Insert Examples
  for v_ex in select * from jsonb_array_elements(p_examples)
  loop
    insert into example (snapshot_id, type, input_text, output_text, traits_json, weight)
    values (
      v_snapshot_id,
      coalesce(v_ex->>'type', 'conversation'),
      v_ex->>'input_text',
      v_ex->>'output_text',
      v_ex->'traits_json',
      coalesce((v_ex->>'weight')::integer, 1)
    )
    returning to_jsonb(example.*) into v_inserted;
    v_examples_out := v_examples_out || jsonb_build_array(to_jsonb(v_inserted));
  end loop;

  -- Step 4: Insert Tests
  for v_t in select * from jsonb_array_elements(p_tests)
  loop
    insert into test (snapshot_id, name, category, prompt, expected_traits_json, forbidden_traits_json, weight, reference_response)
    values (
      v_snapshot_id,
      v_t->>'name',
      v_t->>'category',
      v_t->>'prompt_text',
      v_t->'expected_traits_json',
      v_t->'forbidden_traits_json',
      coalesce((v_t->>'weight')::integer, 1),
      v_t->>'reference_response'
    )
    returning to_jsonb(test.*) into v_inserted;
    v_tests_out := v_tests_out || jsonb_build_array(to_jsonb(v_inserted));
  end loop;

  -- Step 5: Insert RestorationProfiles (INV-05: status set once at creation, INV-12: linked to new snapshot)
  for v_p in select * from jsonb_array_elements(p_profiles)
  loop
    insert into restoration_profile (snapshot_id, provider, model_name, runtime_prompt, calibration_score, status)
    values (
      v_snapshot_id,
      v_p->>'provider',
      v_p->>'model_name',
      v_p->>'runtime_prompt',
      (v_p->>'calibration_score')::numeric,
      v_p->>'status'
    )
    returning to_jsonb(restoration_profile.*) into v_inserted;
    v_profiles_out := v_profiles_out || jsonb_build_array(to_jsonb(v_inserted));
    v_profile_ids := v_profile_ids || jsonb_build_array((to_jsonb(v_inserted))->>'id');
  end loop;

  -- Step 6: Return result
  return jsonb_build_object(
    'persona_id', v_persona_id,
    'snapshot_id', v_snapshot_id,
    'restoration_profile_ids', v_profile_ids,
    'snapshot', v_snapshot_row,
    'examples', v_examples_out,
    'tests', v_tests_out,
    'restoration_profiles', v_profiles_out
  );
end;
$$;
