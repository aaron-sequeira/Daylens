-- Self-serve signup: the caller (a freshly signed-up auth user with no profile)
-- creates an organization and becomes its admin. SECURITY DEFINER so no service role.
create or replace function public.create_organization(p_org_name text, p_full_name text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  new_org uuid;
  u_email text;
begin
  if uid is null then return 'invalid'; end if;
  if p_org_name is null or length(trim(p_org_name)) = 0 then return 'invalid'; end if;
  if exists (select 1 from profiles where id = uid) then return 'already_member'; end if;
  select email into u_email from auth.users where id = uid;
  if u_email is null then return 'invalid'; end if;
  insert into organizations (name) values (trim(p_org_name)) returning id into new_org;
  insert into profiles (id, org_id, team_id, full_name, email, role, active)
    values (uid, new_org, null, coalesce(nullif(trim(p_full_name), ''), u_email), u_email, 'admin', true);
  return 'ok';
end;
$$;
grant execute on function public.create_organization(text, text) to authenticated;
