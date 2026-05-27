-- Resolves the Supabase security advisor errors:
--   - rls_disabled_in_public on roster_transactions, mock_drafts
--   - function_search_path_mutable on claim_draft_pick
--   - anon_security_definer_function_executable on handle_new_user
--   - revokes anon grants on get_my_league_ids
--
-- All writes against the affected tables go through the service-role admin
-- client (which bypasses RLS); RLS policies cover the user-facing read path
-- from authenticated league members / owners.

-- ── RLS on tables that were missing it ─────────────────────────────────────
alter table public.roster_transactions enable row level security;
alter table public.mock_drafts enable row level security;

drop policy if exists "League members can view roster_transactions" on public.roster_transactions;
create policy "League members can view roster_transactions" on public.roster_transactions
  for select
  to authenticated
  using (
    exists (
      select 1 from public.league_members lm
      where lm.league_id = roster_transactions.league_id
        and lm.user_id = auth.uid()
    )
  );

drop policy if exists "Owner can read mock_drafts" on public.mock_drafts;
create policy "Owner can read mock_drafts" on public.mock_drafts
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Owner can insert mock_drafts" on public.mock_drafts;
create policy "Owner can insert mock_drafts" on public.mock_drafts
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Owner can update mock_drafts" on public.mock_drafts;
create policy "Owner can update mock_drafts" on public.mock_drafts
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Owner can delete mock_drafts" on public.mock_drafts;
create policy "Owner can delete mock_drafts" on public.mock_drafts
  for delete to authenticated
  using (user_id = auth.uid());

-- ── Pin search_path on user-defined functions ──────────────────────────────
alter function public.claim_draft_pick(int, int, int)
  set search_path = public, pg_temp;
alter function public.handle_new_user()
  set search_path = public, pg_temp;
alter function public.get_my_league_ids()
  set search_path = public, pg_temp;

-- ── Tighten grants on SECURITY DEFINER functions ───────────────────────────
-- handle_new_user is only invoked by the on-auth.users trigger.
revoke execute on function public.handle_new_user() from anon, authenticated, public;
-- get_my_league_ids is referenced inside authenticated RLS policies, so we
-- must keep that grant. Drop the unnecessary anon + public grants.
revoke execute on function public.get_my_league_ids() from anon, public;
