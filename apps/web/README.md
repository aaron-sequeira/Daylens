# WorkSight AI — Web Dashboard

## Local run
1. `supabase start` (Docker running) — note the API URL + anon + service-role keys.
2. `supabase db reset` — applies migrations (no data).
3. Copy `apps/web/.env.local.example` → `apps/web/.env.local`, fill in the keys from `supabase status`.
4. `pnpm --filter @worksight/web seed` — seeds Acme Inc, 2 teams, 11 people, ~30 days of activity.
5. `pnpm --filter @worksight/web dev` — open the printed URL.

## Demo logins (password `worksight-dev`)
- `admin@acme.test` — sees the whole org
- `manager.platform@acme.test` / `manager.growth@acme.test` — see only their team
- `member1.platform@acme.test` … — see only themselves

The runtime uses only the anon key + your session; RLS does the rest. The
service-role key is used only by the seed script.

## Provisioning a pilot company (operator)
Create an org + its first admin (service-role; run once per company):
```
pnpm --filter @worksight/web exec node scripts/create-org.mjs --org "Acme Inc" --admin-email admin@acme.test
```
The admin then logs in, opens **Admin**, creates teams, and generates invite links (`/join/<token>`) to share with employees.
