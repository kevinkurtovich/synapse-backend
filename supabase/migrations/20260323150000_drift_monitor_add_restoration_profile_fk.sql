-- Phase 0: Add restoration_profile_id FK to drift_monitor
-- Required by ARCH-DRIFT-0002: DriftMonitor must reference a RestorationProfile
-- to resolve provider + model_name at check time.
-- Nullable to allow migration on existing rows (table is empty).

alter table drift_monitor
  add column restoration_profile_id uuid references restoration_profile(id);
