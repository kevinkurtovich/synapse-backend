-- BUG-0004: Fix slug generation in create_snapshot_direct_atomic.
-- The original RPC does not set the slug column on persona insert, causing
-- it to default to '' and violate persona_slug_unique on second creation.
-- Fix: generate a UUID-based slug with 'direct-' prefix (same strategy as
-- import_snapshot_atomic which uses 'imported-' prefix — no collision possible).
-- RPC signature, return type, and transaction structure are unchanged.

create or replace function create_snapshot_direct_atomic(
  p_companion_name  text,
  p_memory_context  text,
  p_owner_user_id   uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_persona_id   uuid;
  v_persona_slug text;
  v_persona_row  jsonb;
  v_snapshot_row jsonb;
begin
  -- Step 1: Generate unique slug
  v_persona_slug := 'direct-' || replace(gen_random_uuid()::text, '-', '');

  -- Step 2: Create Persona (INV-01 not applicable here — Persona is not immutable)
  insert into persona (name, slug, owner_user_id)
  values (p_companion_name, v_persona_slug, p_owner_user_id)
  returning to_jsonb(persona.*) into v_persona_row;

  v_persona_id := (v_persona_row->>'id')::uuid;

  -- Step 3: Create Snapshot (INV-01: single INSERT only, never updated)
  -- version_number = 1 (INV-03: always 1 for new Persona)
  -- Only memory_context_json populated; all other JSONB fields null per V1 spec.
  insert into snapshot (
    persona_id,
    version_number,
    memory_context_json
  ) values (
    v_persona_id,
    1,
    jsonb_build_object('content', p_memory_context)
  )
  returning to_jsonb(snapshot.*) into v_snapshot_row;

  return jsonb_build_object(
    'persona',   v_persona_row,
    'snapshot',  v_snapshot_row
  );
end;
$$;
