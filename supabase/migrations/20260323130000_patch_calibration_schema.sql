-- Phase 0: Patch schema for CalibrateSnapshot (BP-2026-03-23-feat-0002)
-- Additive migration. Tables are empty; safe to add NOT NULL without defaults.

------------------------------------------------------------------------
-- RESTORATION_PROFILE: rename score -> calibration_score, add calibrated_at,
-- add CHECK on provider
------------------------------------------------------------------------

alter table restoration_profile
  rename column score to calibration_score;

alter table restoration_profile
  add column calibrated_at timestamptz;

alter table restoration_profile
  add constraint restoration_profile_provider_check
  check (provider in ('openai', 'anthropic', 'google', 'meta', 'mistral', 'other'));

------------------------------------------------------------------------
-- CALIBRATION_RUN: add termination_reason, iterations_json
------------------------------------------------------------------------

alter table calibration_run
  add column termination_reason text not null default 'max_iterations'
    check (termination_reason in ('converged', 'stalled', 'max_iterations'));

alter table calibration_run
  add column iterations_json jsonb;
