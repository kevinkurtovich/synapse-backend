-- Phase 0: Patch schema for DistillPersona (BP-2026-03-23-feat-0001)
-- Additive migration bringing tables into alignment with ENTITIES.md / ROS_OUTPUT.md.
-- Tables are empty; column drops are safe.

------------------------------------------------------------------------
-- PERSONA: add slug, description, visibility, status, owner_user_id
------------------------------------------------------------------------

alter table persona
  add column slug text not null default '',
  add column description text,
  add column visibility text not null default 'private'
    check (visibility in ('private', 'public')),
  add column status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  add column owner_user_id uuid;

-- slug must be unique; remove the default after column creation
alter table persona
  add constraint persona_slug_unique unique (slug);

------------------------------------------------------------------------
-- SNAPSHOT: add version_label, change_summary
------------------------------------------------------------------------

alter table snapshot
  add column version_label text,
  add column change_summary text;

------------------------------------------------------------------------
-- EXAMPLE: replace content with typed input/output structure
------------------------------------------------------------------------

alter table example
  drop column content;

alter table example
  add column type text not null default 'conversation'
    check (type in ('conversation', 'instruction_following', 'creative',
                    'analytical', 'emotional', 'boundary')),
  add column input_text text not null default '',
  add column output_text text not null default '',
  add column traits_json jsonb,
  add column weight integer not null default 1;

------------------------------------------------------------------------
-- TEST: rename trait columns, add name/category/weight/reference_response
------------------------------------------------------------------------

alter table test
  rename column expected_traits to expected_traits_json;

alter table test
  rename column forbidden_traits to forbidden_traits_json;

alter table test
  add column name text not null default '',
  add column category text
    check (category in ('identity', 'tone', 'boundaries', 'creativity',
                        'reasoning', 'empathy', 'consistency')),
  add column weight integer not null default 1,
  add column reference_response text;
