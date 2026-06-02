-- Current-draft pick trading (Stage 1: ownership model + engine integration).
--
-- Lets teams trade individual slots of the CURRENT draft before it starts. A
-- row here overrides the default snake owner for one overall pick; with no
-- rows the draft behaves exactly as before. Separate from the keeper
-- future-pick tables (traded_draft_picks / trade_picks).

create table if not exists public.current_draft_pick_owners (
  id serial primary key,
  draft_id int not null references public.drafts(id) on delete cascade,
  overall_pick int not null,
  owner_team_id int not null references public.league_members(id) on delete cascade,
  original_team_id int not null references public.league_members(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (draft_id, overall_pick)
);

create index if not exists current_draft_pick_owners_draft_idx
  on public.current_draft_pick_owners (draft_id);

-- Read-only for authenticated users (non-sensitive draft metadata); all writes
-- go through the service-role client in server actions.
alter table public.current_draft_pick_owners enable row level security;
drop policy if exists "read current draft pick owners" on public.current_draft_pick_owners;
create policy "read current draft pick owners"
  on public.current_draft_pick_owners
  for select
  to authenticated
  using (true);

-- ── claim_draft_pick: honor a traded slot owner ────────────────────────────
-- Same as before, except the on-clock team is taken from
-- current_draft_pick_owners when an override exists for this overall pick.
create or replace function public.claim_draft_pick(p_league_id integer, p_team_id integer, p_player_id integer)
 returns json
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_draft drafts%rowtype;
  v_pick int;
  v_num_teams int;
  v_round int;
  v_position_in_round int;
  v_is_reversed boolean;
  v_draft_slot int;
  v_on_clock_id int;
  v_player_division text;
  v_slot_limit int;
  v_assigned_order int;
  v_total_picks int;
  v_lineup_orders int[];
  v_complete boolean := false;
begin
  select * into v_draft from drafts where league_id = p_league_id for update;
  if not found then return json_build_object('status','rejected_state','reason','no_draft'); end if;
  if v_draft.status <> 'in_progress' then return json_build_object('status','rejected_state','reason','not_in_progress'); end if;
  if coalesce(v_draft.type,'snake') <> 'snake' then return json_build_object('status','rejected_state','reason','wrong_type'); end if;

  v_pick := v_draft.current_pick;
  select count(*) into v_num_teams from league_members where league_id = p_league_id and draft_position is not null;
  if v_num_teams = 0 then return json_build_object('status','rejected_state','reason','no_teams'); end if;

  v_round := ceil(v_pick::numeric / v_num_teams);

  -- A traded pick-slot owner overrides the default snake owner for this pick.
  select owner_team_id into v_on_clock_id
    from current_draft_pick_owners
    where draft_id = v_draft.id and overall_pick = v_pick;

  if v_on_clock_id is null then
    v_position_in_round := v_pick - (v_round - 1) * v_num_teams;
    v_is_reversed := (v_round % 2 = 0);
    -- Third-round reversal: rounds 1 and 2 stay normal. From round 3 onwards
    -- the standard snake direction inverts.
    if coalesce(v_draft.third_round_reversal, false) and v_round >= 3 then
      v_is_reversed := not v_is_reversed;
    end if;
    v_draft_slot := case when v_is_reversed then v_num_teams - v_position_in_round + 1
                         else v_position_in_round end;
    select id into v_on_clock_id from league_members where league_id = p_league_id and draft_position = v_draft_slot;
  end if;

  if v_on_clock_id is null or v_on_clock_id <> p_team_id then
    return json_build_object('status','rejected_not_on_clock');
  end if;
  if exists (select 1 from rosters where league_id = p_league_id and player_id = p_player_id) then
    return json_build_object('status','rejected_duplicate');
  end if;

  select division into v_player_division from players where id = p_player_id;
  if v_player_division is null then return json_build_object('status','rejected_state','reason','unknown_player'); end if;

  select case when v_player_division = 'MPO' then coalesce(mpo_starters,4) else coalesce(fpo_starters,2) end
    into v_slot_limit from leagues where id = p_league_id;

  select array_agg(r.lineup_order) into v_lineup_orders
    from rosters r join players p on p.id = r.player_id
    where r.league_id = p_league_id and r.team_id = p_team_id
      and r.is_starter = true and p.division = v_player_division and r.lineup_order is not null;

  v_assigned_order := null;
  for i in 1..v_slot_limit loop
    if v_lineup_orders is null or not (i = any(v_lineup_orders)) then v_assigned_order := i; exit; end if;
  end loop;

  insert into rosters (league_id, team_id, player_id, acquired_week, is_starter, lineup_order)
    values (p_league_id, p_team_id, p_player_id, 1, v_assigned_order is not null, v_assigned_order);
  insert into draft_picks (draft_id, pick_number, round, team_id, player_id)
    values (v_draft.id, v_pick, v_round, p_team_id, p_player_id);

  v_total_picks := v_num_teams * v_draft.total_rounds;
  if v_pick + 1 > v_total_picks then
    update drafts set status='complete', current_pick=v_pick+1, current_pick_started_at=null where id=v_draft.id;
    update leagues set draft_status='complete' where id=p_league_id;
    v_complete := true;
  else
    update drafts set current_pick=v_pick+1, current_pick_started_at=now() where id=v_draft.id;
  end if;

  return json_build_object('status','ok','pick_number',v_pick,'team_id',p_team_id,'player_id',p_player_id,'complete',v_complete,'is_starter',v_assigned_order is not null,'lineup_order',v_assigned_order);
end;
$function$;

-- ── Per-trade record of current-draft pick-slot movements (Stage 2) ────────
-- Applied to current_draft_pick_owners when a trade is accepted while the
-- draft is still pending.
create table if not exists public.trade_current_picks (
  id serial primary key,
  trade_id int not null references public.trades(id) on delete cascade,
  draft_id int not null references public.drafts(id) on delete cascade,
  overall_pick int not null,
  from_team_id int not null references public.league_members(id) on delete cascade,
  to_team_id int not null references public.league_members(id) on delete cascade
);
create index if not exists trade_current_picks_trade_idx on public.trade_current_picks (trade_id);

alter table public.trade_current_picks enable row level security;
drop policy if exists "read trade current picks" on public.trade_current_picks;
create policy "read trade current picks"
  on public.trade_current_picks
  for select
  to authenticated
  using (true);
