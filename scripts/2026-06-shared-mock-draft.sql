-- Shared, multiplayer mock drafts.
--
-- Adds seat-claiming + a "lobby" status to mock_drafts, turns on RLS with a
-- read policy so authenticated users can subscribe to shared drafts over
-- Realtime, registers the table on the realtime publication, and adds an
-- atomic claim_mock_pick() RPC so concurrent picks can't collide.

-- 1. New columns ------------------------------------------------------------
alter table public.mock_drafts
  add column if not exists seats jsonb not null default '{}'::jsonb,
  add column if not exists is_shared boolean not null default false;

-- status already holds 'in_progress' | 'complete'; shared drafts add 'lobby'
-- while waiting in the pre-start lobby. Widen the existing check constraint.
alter table public.mock_drafts drop constraint if exists mock_drafts_status_check;
alter table public.mock_drafts
  add constraint mock_drafts_status_check
  check (status = any (array['lobby'::text, 'in_progress'::text, 'complete'::text]));

-- 2. Row-level security -----------------------------------------------------
-- All server writes/reads use the service-role (admin) client and bypass RLS.
-- Enabling RLS here is purely so the browser client can SELECT shared drafts,
-- which Realtime requires before it will deliver postgres_changes to a client.
alter table public.mock_drafts enable row level security;

drop policy if exists "read own or shared mock drafts" on public.mock_drafts;
create policy "read own or shared mock drafts"
  on public.mock_drafts
  for select
  to authenticated
  using (is_shared = true or user_id = auth.uid());

-- 3. Realtime publication ---------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'mock_drafts'
  ) then
    alter publication supabase_realtime add table public.mock_drafts;
  end if;
end $$;

-- 4. Atomic pick claim ------------------------------------------------------
-- Fills the player on a single pick slot under a row lock, rejecting the write
-- if that slot is already filled or the player has already been drafted. Marks
-- the draft complete once every slot is filled. Returns the updated picks.
create or replace function public.claim_mock_pick(
  p_id int,
  p_pick_index int,
  p_player_id int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_picks jsonb;
  v_status text;
  v_total int;
  v_filled int;
begin
  select picks, status into v_picks, v_status
  from mock_drafts where id = p_id for update;

  if v_picks is null then
    raise exception 'mock draft % not found', p_id;
  end if;

  if (v_picks -> p_pick_index ->> 'playerId') is not null then
    raise exception 'pick slot % already filled', p_pick_index;
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_picks) e
    where (e ->> 'playerId') is not null
      and (e ->> 'playerId')::int = p_player_id
  ) then
    raise exception 'player % already drafted', p_player_id;
  end if;

  v_picks := jsonb_set(
    v_picks,
    array[p_pick_index::text, 'playerId'],
    to_jsonb(p_player_id),
    false
  );

  select count(*) into v_total from jsonb_array_elements(v_picks);
  select count(*) into v_filled
  from jsonb_array_elements(v_picks) e
  where (e ->> 'playerId') is not null;

  update mock_drafts
  set picks = v_picks,
      status = case when v_filled >= v_total then 'complete' else status end
  where id = p_id;

  return v_picks;
end;
$$;

grant execute on function public.claim_mock_pick(int, int, int) to authenticated, service_role;
