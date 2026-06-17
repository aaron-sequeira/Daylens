-- Grant service_role full access for seed script and admin operations.
-- The service_role bypasses RLS (bypassrls=true) but still needs table-level grants.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Grant anon and authenticated read-only (DML is handled by RLS policies).
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
