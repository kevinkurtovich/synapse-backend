-- FEAT-0007: Tenant-aware Persona ownership
-- Adds owner_user_id to persona table for user-scoped multi-tenancy.
-- References auth.users (Supabase built-in).
-- NOT NULL: database is empty at time of migration; no backfill needed.

alter table persona
  add column owner_user_id uuid not null references auth.users(id);
