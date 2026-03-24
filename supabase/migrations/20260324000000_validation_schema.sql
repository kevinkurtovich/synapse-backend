-- FEAT-0004: Identity Validation (Personality Custody)
-- Creates validation_runs and validation_probe_results tables.
-- Both tables are append-only (INV-13, INV-14).

-- ValidationRun
create table validation_run (
  id uuid primary key default gen_random_uuid(),
  restoration_profile_id uuid not null references restoration_profile(id),
  verdict text not null check (verdict in ('PASS', 'FAIL')),
  passed_count integer not null,
  total_count integer not null,
  created_at timestamptz not null default now()
);

-- ValidationProbeResult
create table validation_probe_result (
  id uuid primary key default gen_random_uuid(),
  validation_run_id uuid not null references validation_run(id),
  label text not null,
  prompt text not null,
  response text not null,
  passed boolean not null,
  created_at timestamptz not null default now()
);

-- Enable RLS (consistent with all other tables)
alter table validation_run enable row level security;
alter table validation_probe_result enable row level security;

-- INV-13: ValidationRun is immutable after creation (no UPDATE or DELETE)
create trigger trg_validation_run_immutable
  before update or delete on validation_run
  for each row
  execute function reject_modification();

-- INV-14: ValidationProbeResult is immutable after creation (no UPDATE or DELETE)
create trigger trg_validation_probe_result_immutable
  before update or delete on validation_probe_result
  for each row
  execute function reject_modification();

-- INV-15: Atomic persistence RPC
-- Inserts a validation_run and all its probe results in a single transaction.
create or replace function validate_snapshot_atomic(
  p_restoration_profile_id uuid,
  p_verdict text,
  p_passed_count integer,
  p_total_count integer,
  p_probe_results jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_run_id uuid;
  v_run_row jsonb;
  v_results_out jsonb := '[]'::jsonb;
  v_probe jsonb;
  v_inserted record;
begin
  -- Insert the validation run
  insert into validation_run (
    restoration_profile_id, verdict, passed_count, total_count
  ) values (
    p_restoration_profile_id, p_verdict, p_passed_count, p_total_count
  )
  returning to_jsonb(validation_run.*) into v_run_row;

  v_run_id := (v_run_row->>'id')::uuid;

  -- Insert each probe result
  for v_probe in select * from jsonb_array_elements(p_probe_results)
  loop
    insert into validation_probe_result (
      validation_run_id, label, prompt, response, passed
    ) values (
      v_run_id,
      v_probe->>'label',
      v_probe->>'prompt',
      v_probe->>'response',
      (v_probe->>'passed')::boolean
    )
    returning to_jsonb(validation_probe_result.*) into v_inserted;
    v_results_out := v_results_out || jsonb_build_array(to_jsonb(v_inserted));
  end loop;

  return jsonb_build_object(
    'validation_run', v_run_row,
    'probe_results', v_results_out
  );
end;
$$;
