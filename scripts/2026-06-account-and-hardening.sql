-- Security hardening that accompanies account recovery + member management.
--
-- claim_mock_pick is SECURITY DEFINER and only ever invoked from the server via
-- the service-role client (actions/mock-drafts.ts -> makeSharedMockPick). Stop
-- exposing it on the public REST API so it can't be called directly by an
-- arbitrary signed-in user to grief other people's shared mock drafts.
revoke execute on function public.claim_mock_pick(int, int, int) from anon, authenticated;

-- NOTE: also enable "Leaked password protection" in the Supabase dashboard
-- (Authentication -> Policies / Password security). It is a dashboard toggle,
-- not SQL — it checks new passwords against HaveIBeenPwned.
