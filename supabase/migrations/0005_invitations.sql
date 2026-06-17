alter table profiles add column active boolean not null default true;

create table invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  role app_role not null,
  token text not null unique,
  expires_at timestamptz,
  max_uses integer,
  uses integer not null default 0,
  revoked boolean not null default false,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_invitations_org on invitations(org_id);
