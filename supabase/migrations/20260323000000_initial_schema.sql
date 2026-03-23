-- ProjectSynapse initial schema
-- Maps 1:1 to kOS ENTITIES.md

-- Persona
create table persona (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Snapshot
create table snapshot (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references persona(id),
  parent_snapshot_id uuid references snapshot(id),
  version_number integer not null,
  distillation_summary text,
  identity_json jsonb,
  tone_json jsonb,
  interaction_json jsonb,
  boundaries_json jsonb,
  memory_context_json jsonb,
  traits_to_preserve_json jsonb,
  traits_to_avoid_json jsonb,
  confidence_by_dimension_json jsonb,
  created_at timestamptz not null default now(),
  unique (persona_id, version_number)
);

-- Example
create table example (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references snapshot(id),
  content text not null,
  created_at timestamptz not null default now()
);

-- Test
create table test (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references snapshot(id),
  expected_traits jsonb,
  forbidden_traits jsonb,
  prompt text not null,
  created_at timestamptz not null default now()
);

-- RestorationProfile
create table restoration_profile (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references snapshot(id),
  provider text not null,
  model_name text not null,
  runtime_prompt text,
  score numeric,
  status text not null default 'pending' check (status in ('pending', 'active', 'failed', 'retired')),
  created_at timestamptz not null default now()
);

-- CalibrationRun
create table calibration_run (
  id uuid primary key default gen_random_uuid(),
  restoration_profile_id uuid not null references restoration_profile(id),
  iteration_count integer not null default 0,
  final_score numeric,
  created_at timestamptz not null default now()
);

-- CalibrationResult
create table calibration_result (
  id uuid primary key default gen_random_uuid(),
  calibration_run_id uuid not null references calibration_run(id),
  test_id uuid not null references test(id),
  response text,
  score numeric,
  dimension_scores jsonb,
  created_at timestamptz not null default now()
);

-- DriftReport
create table drift_report (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references snapshot(id),
  restoration_profile_id uuid references restoration_profile(id),
  source text not null check (source in ('calibration', 'monitoring')),
  score numeric not null,
  details jsonb,
  created_at timestamptz not null default now()
);

-- DriftMonitor
create table drift_monitor (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references persona(id),
  snapshot_id uuid not null references snapshot(id),
  model_provider text not null,
  model_name text not null,
  baseline_score numeric not null,
  drift_threshold numeric not null,
  latest_score numeric,
  last_check_at timestamptz,
  status text not null default 'healthy' check (status in ('healthy', 'drift_detected')),
  created_at timestamptz not null default now()
);

-- Alert
create table alert (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references persona(id),
  drift_monitor_id uuid not null references drift_monitor(id),
  message text,
  acknowledged boolean not null default false,
  created_at timestamptz not null default now()
);

-- Session
create table session (
  id uuid primary key default gen_random_uuid(),
  restoration_profile_id uuid not null references restoration_profile(id),
  name text,
  user_id uuid,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

-- Message
create table message (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references session(id),
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

-- Enable Row Level Security on all tables
alter table persona enable row level security;
alter table snapshot enable row level security;
alter table example enable row level security;
alter table test enable row level security;
alter table restoration_profile enable row level security;
alter table calibration_run enable row level security;
alter table calibration_result enable row level security;
alter table drift_report enable row level security;
alter table drift_monitor enable row level security;
alter table alert enable row level security;
alter table session enable row level security;
alter table message enable row level security;
