drop policy profiles_admin_update on profiles;
create policy profiles_admin_update on profiles for update
  using (public.viewer_role() = 'admin' and org_id = public.viewer_org())
  with check (
    public.viewer_role() = 'admin' and org_id = public.viewer_org()
    and (team_id is null or team_id in (select id from teams where org_id = public.viewer_org()))
  );

drop policy inv_admin_insert on invitations;
create policy inv_admin_insert on invitations for insert
  with check (
    public.viewer_role() = 'admin' and org_id = public.viewer_org()
    and team_id in (select id from teams where org_id = public.viewer_org())
  );
