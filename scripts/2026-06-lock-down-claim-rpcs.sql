-- The claim RPCs are only ever invoked server-side via the service-role client.
-- An earlier revoke missed the default PUBLIC grant, so they were still exposed
-- on the REST API (flagged by the security advisor). Lock them to service_role.
revoke execute on function public.claim_mock_pick(int, int, int) from public, anon, authenticated;
grant execute on function public.claim_mock_pick(int, int, int) to service_role;

revoke execute on function public.claim_draft_pick(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_draft_pick(integer, integer, integer) to service_role;
