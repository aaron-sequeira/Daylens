create type app_role as enum ('admin', 'manager', 'member');

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index idx_teams_org on teams(org_id);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  team_id uuid references teams(id) on delete set null,
  full_name text not null,
  email text not null,
  role app_role not null default 'member',
  created_at timestamptz not null default now()
);
create index idx_profiles_org on profiles(org_id);
create index idx_profiles_team on profiles(team_id);

create table daily_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  date date not null,
  total_tracked_sec integer not null default 0,
  active_sec integer not null default 0,
  idle_sec integer not null default 0,
  by_app jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);
create index idx_daily_user_date on daily_activity(user_id, date);
