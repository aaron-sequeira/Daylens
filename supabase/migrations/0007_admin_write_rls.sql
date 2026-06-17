create policy teams_admin_insert on teams for insert
  with check (public.viewer_role() = 'admin' and org_id = public.viewer_org());
create policy teams_admin_update on teams for update
  using (public.viewer_role() = 'admin' and org_id = public.viewer_org())
  with check (public.viewer_role() = 'admin' and org_id = public.viewer_org());

create policy profiles_admin_update on profiles for update
  using (public.viewer_role() = 'admin' and org_id = public.viewer_org())
  with check (public.viewer_role() = 'admin' and org_id = public.viewer_org());

grant insert, update on teams to authenticated;
grant update on profiles to authenticated;
