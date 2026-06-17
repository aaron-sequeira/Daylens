-- Public, safe preview: only display fields, only for currently-valid tokens.
create or replace function public.preview_invite(p_token text)
returns table(org_name text, team_name text, role app_role)
language sql stable security definer set search_path = public as $$
  select o.name, t.name, i.role
  from invitations i
  join organizations o on o.id = i.org_id
  join teams t on t.id = i.team_id
  where i.token = p_token
    and i.revoked = false
    and (i.expires_at is null or i.expires_at > now())
    and (i.max_uses is null or i.uses < i.max_uses);
$$;
grant execute on function public.preview_invite(text) to anon, authenticated;

-- Redeem: creates the CALLER's profile from the invite. Idempotent.
create or replace function public.redeem_invite(p_token text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  inv invitations%rowtype;
  uid uuid := auth.uid();
  u_email text;
  u_name text;
begin
  if uid is null then return 'invalid'; end if;
  select * into inv from invitations where token = p_token for update;
  if not found then return 'invalid'; end if;
  if inv.revoked then return 'revoked'; end if;
  if inv.expires_at is not null and inv.expires_at <= now() then return 'expired'; end if;
  if inv.max_uses is not null and inv.uses >= inv.max_uses then return 'exhausted'; end if;
  if exists (select 1 from profiles where id = uid) then return 'already_member'; end if;
  select email, coalesce(raw_user_meta_data->>'full_name', email)
    into u_email, u_name from auth.users where id = uid;
  insert into profiles (id, org_id, team_id, full_name, email, role, active)
    values (uid, inv.org_id, inv.team_id, u_name, u_email, inv.role, true);
  update invitations set uses = uses + 1 where id = inv.id;
  return 'ok';
end;
$$;
grant execute on function public.redeem_invite(text) to authenticated;

-- Admins manage invitations within their own org. (Redeem path uses the SECURITY DEFINER fn above.)
alter table invitations enable row level security;
create policy inv_admin_select on invitations for select
  using (public.viewer_role() = 'admin' and org_id = public.viewer_org());
create policy inv_admin_insert on invitations for insert
  with check (public.viewer_role() = 'admin' and org_id = public.viewer_org());
create policy inv_admin_update on invitations for update
  using (public.viewer_role() = 'admin' and org_id = public.viewer_org())
  with check (public.viewer_role() = 'admin' and org_id = public.viewer_org());
grant select, insert, update on invitations to authenticated;
-- service_role needs explicit grants (0003_grants.sql used GRANT ALL ON ALL TABLES
-- which only covered tables existing at that time; invitations was added in 0005).
grant all on invitations to service_role;
