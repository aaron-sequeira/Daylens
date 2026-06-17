-- Helper functions. SECURITY DEFINER so reading the caller's own profile row
-- does not recurse through the profiles RLS policy.
create or replace function public.viewer_role()
returns app_role language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function public.viewer_org()
returns uuid language sql stable security definer set search_path = public as $$
  select org_id from profiles where id = auth.uid();
$$;

create or replace function public.viewer_team()
returns uuid language sql stable security definer set search_path = public as $$
  select team_id from profiles where id = auth.uid();
$$;

alter table organizations enable row level security;
alter table teams enable row level security;
alter table profiles enable row level security;
alter table daily_activity enable row level security;

create policy org_select on organizations for select
  using ( id = public.viewer_org() );

create policy teams_select on teams for select
  using ( org_id = public.viewer_org() );

create policy profiles_select on profiles for select
  using (
    id = auth.uid()
    or (public.viewer_role() = 'manager' and team_id = public.viewer_team())
    or (public.viewer_role() = 'admin'   and org_id  = public.viewer_org())
  );

create policy daily_select on daily_activity for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from profiles p
      where p.id = daily_activity.user_id
        and (
          (public.viewer_role() = 'manager' and p.team_id = public.viewer_team())
          or (public.viewer_role() = 'admin' and p.org_id = public.viewer_org())
        )
    )
  );
