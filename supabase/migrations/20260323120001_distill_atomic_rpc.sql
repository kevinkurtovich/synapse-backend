-- Atomic persistence function for DistillPersona (INV-02).
-- Runs in a single transaction: snapshot + examples + tests all-or-nothing.

create or replace function distill_persona_atomic(
  p_persona_id       uuid,
  p_parent_snapshot_id uuid,
  p_snapshot          jsonb,
  p_examples          jsonb,
  p_tests             jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_version_number integer;
  v_snapshot_id    uuid;
  v_snapshot_row   jsonb;
  v_examples_out   jsonb := '[]'::jsonb;
  v_tests_out      jsonb := '[]'::jsonb;
  v_ex             jsonb;
  v_t              jsonb;
  v_inserted       record;
begin
  -- Compute version_number atomically within this transaction
  select count(*) + 1 into v_version_number
    from snapshot
   where persona_id = p_persona_id;

  -- Insert snapshot (INV-01: single INSERT, never updated)
  insert into snapshot (
    persona_id, parent_snapshot_id, version_number,
    distillation_summary, identity_json, tone_json, interaction_json,
    boundaries_json, memory_context_json, traits_to_preserve_json,
    traits_to_avoid_json, confidence_by_dimension_json
  ) values (
    p_persona_id,
    p_parent_snapshot_id,
    v_version_number,
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

  -- Insert examples
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

  -- Insert tests
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

  return jsonb_build_object(
    'snapshot', v_snapshot_row,
    'examples', v_examples_out,
    'tests', v_tests_out
  );
end;
$$;
