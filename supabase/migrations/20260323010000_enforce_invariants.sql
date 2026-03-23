-- kOS Invariant Enforcement Migration
-- Implements BLOCKING items B-01 through B-09 from compliance audit.
-- All enforcement via BEFORE triggers. No schema changes.


------------------------------------------------------------------------
-- Shared: generic immutability function
-- Reused by B-02, B-04, B-05, B-06
------------------------------------------------------------------------

create or replace function reject_modification()
returns trigger as $$
begin
  raise exception '% records are immutable and cannot be % after creation',
    TG_TABLE_NAME, lower(TG_OP);
end;
$$ language plpgsql;


------------------------------------------------------------------------
-- B-01  INV-04: parent_snapshot_id must reference same persona
------------------------------------------------------------------------

create or replace function enforce_same_persona_lineage()
returns trigger as $$
declare
  parent_persona_id uuid;
begin
  if NEW.parent_snapshot_id is not null then
    select persona_id into parent_persona_id
      from snapshot
     where id = NEW.parent_snapshot_id;

    if parent_persona_id is distinct from NEW.persona_id then
      raise exception
        'INV-04: parent_snapshot_id must reference a snapshot with the same persona_id '
        '(row persona_id=%, parent persona_id=%)',
        NEW.persona_id, parent_persona_id;
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql;

create trigger trg_snapshot_same_persona_lineage
  before insert on snapshot
  for each row
  execute function enforce_same_persona_lineage();


------------------------------------------------------------------------
-- B-02  INV-01: Snapshot is immutable after creation
-- Canon defines zero mutable fields on Snapshot.
------------------------------------------------------------------------

create trigger trg_snapshot_immutable
  before update on snapshot
  for each row
  execute function reject_modification();


------------------------------------------------------------------------
-- B-03  INV-05: RestorationProfile status transition enforcement
--   pending  -> active | failed   (calibration completion, one-time)
--   active   -> retired            (user-initiated, irreversible)
--   failed   -> (none)
--   retired  -> (none)
------------------------------------------------------------------------

create or replace function enforce_restoration_profile_status_transition()
returns trigger as $$
begin
  -- Allow updates that don't touch status
  if OLD.status = NEW.status then
    return NEW;
  end if;

  -- Calibration completion: pending -> active or failed
  if OLD.status = 'pending' and NEW.status in ('active', 'failed') then
    return NEW;
  end if;

  -- User-initiated retirement: active -> retired
  if OLD.status = 'active' and NEW.status = 'retired' then
    return NEW;
  end if;

  raise exception
    'INV-05: invalid status transition from "%" to "%" on restoration_profile',
    OLD.status, NEW.status;
end;
$$ language plpgsql;

create trigger trg_restoration_profile_status_transition
  before update on restoration_profile
  for each row
  execute function enforce_restoration_profile_status_transition();


------------------------------------------------------------------------
-- B-04  INV-06: CalibrationRun is immutable after creation
------------------------------------------------------------------------

create trigger trg_calibration_run_immutable
  before update or delete on calibration_run
  for each row
  execute function reject_modification();


------------------------------------------------------------------------
-- B-05  CalibrationResult is immutable after creation
------------------------------------------------------------------------

create trigger trg_calibration_result_immutable
  before update or delete on calibration_result
  for each row
  execute function reject_modification();


------------------------------------------------------------------------
-- B-06  INV-07: Message records are immutable (no modify, no delete)
------------------------------------------------------------------------

create trigger trg_message_immutable
  before update or delete on message
  for each row
  execute function reject_modification();


------------------------------------------------------------------------
-- B-07  INV-08: Session closure is irreversible
-- ended_at, once set, cannot be changed or cleared.
------------------------------------------------------------------------

create or replace function enforce_session_closure_irreversible()
returns trigger as $$
begin
  if OLD.ended_at is not null
     and NEW.ended_at is distinct from OLD.ended_at then
    raise exception
      'INV-08: session closure is irreversible — ended_at cannot be modified once set';
  end if;
  return NEW;
end;
$$ language plpgsql;

create trigger trg_session_closure_irreversible
  before update on session
  for each row
  execute function enforce_session_closure_irreversible();


------------------------------------------------------------------------
-- B-08  INV-09: Reject message insert on closed session
------------------------------------------------------------------------

create or replace function enforce_session_open_for_message()
returns trigger as $$
declare
  session_ended_at timestamptz;
begin
  select ended_at into session_ended_at
    from session
   where id = NEW.session_id;

  if session_ended_at is not null then
    raise exception
      'INV-09: cannot add message to closed session (session_id=%, closed at %)',
      NEW.session_id, session_ended_at;
  end if;
  return NEW;
end;
$$ language plpgsql;

create trigger trg_message_session_open
  before insert on message
  for each row
  execute function enforce_session_open_for_message();


------------------------------------------------------------------------
-- B-09  INV-10: CalibrationResult.test_id must belong to the same
--       Snapshot as the CalibrationRun's RestorationProfile
------------------------------------------------------------------------

create or replace function enforce_calibration_result_same_snapshot()
returns trigger as $$
declare
  run_snapshot_id  uuid;
  test_snapshot_id uuid;
begin
  select rp.snapshot_id into run_snapshot_id
    from calibration_run cr
    join restoration_profile rp on rp.id = cr.restoration_profile_id
   where cr.id = NEW.calibration_run_id;

  select snapshot_id into test_snapshot_id
    from test
   where id = NEW.test_id;

  if run_snapshot_id is distinct from test_snapshot_id then
    raise exception
      'INV-10: calibration_result test must belong to same snapshot as '
      'calibration_run''s restoration_profile (run snapshot=%, test snapshot=%)',
      run_snapshot_id, test_snapshot_id;
  end if;
  return NEW;
end;
$$ language plpgsql;

create trigger trg_calibration_result_same_snapshot
  before insert on calibration_result
  for each row
  execute function enforce_calibration_result_same_snapshot();


------------------------------------------------------------------------
-- Reverse migration (uncomment to undo)
------------------------------------------------------------------------
-- drop trigger if exists trg_snapshot_same_persona_lineage   on snapshot;
-- drop trigger if exists trg_snapshot_immutable               on snapshot;
-- drop trigger if exists trg_restoration_profile_status_transition on restoration_profile;
-- drop trigger if exists trg_calibration_run_immutable        on calibration_run;
-- drop trigger if exists trg_calibration_result_immutable     on calibration_result;
-- drop trigger if exists trg_calibration_result_same_snapshot on calibration_result;
-- drop trigger if exists trg_message_immutable                on message;
-- drop trigger if exists trg_message_session_open             on message;
-- drop trigger if exists trg_session_closure_irreversible     on session;
--
-- drop function if exists reject_modification();
-- drop function if exists enforce_same_persona_lineage();
-- drop function if exists enforce_restoration_profile_status_transition();
-- drop function if exists enforce_session_closure_irreversible();
-- drop function if exists enforce_session_open_for_message();
-- drop function if exists enforce_calibration_result_same_snapshot();
