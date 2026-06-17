import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ws from 'ws';

// Load apps/web/.env.local manually (no dotenv dependency).
const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2];
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('Missing SUPABASE url/service-role key in apps/web/.env.local');

const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: ws } });
const PASSWORD = 'worksight-dev';
const APPS = ['VS Code', 'Chrome', 'Slack', 'Figma', 'Terminal', 'Notion'];

const r = (min, max) => Math.random() * (max - min) + min;
const ri = (min, max) => Math.floor(r(min, max + 1));

function dayByApp(activeSec) {
  // split active time across 2-4 apps; produce AppUsage-shaped rows (snake_case)
  const n = ri(2, 4);
  const picks = [...APPS].sort(() => Math.random() - 0.5).slice(0, n);
  let remaining = activeSec;
  return picks.map((appName, i) => {
    const share = i === picks.length - 1 ? remaining : Math.floor(activeSec * r(0.15, 0.45));
    const total_sec = Math.min(share, remaining); remaining -= total_sec;
    return { app_name: appName, total_sec, sessions: ri(1, 6), active_pct: ri(60, 95) };
  }).filter((a) => a.total_sec > 0);
}

function makeDays(userId, days) {
  const rows = [];
  const today = new Date();
  for (let d = 0; d < days; d++) {
    const dt = new Date(today); dt.setDate(today.getDate() - d);
    const dow = dt.getDay();
    if (dow === 0 || dow === 6) { if (Math.random() > 0.25) continue; } // mostly no weekend data
    const totalTracked = Math.round(r(3.0, 8.0) * 3600);
    const activeSec = Math.round(totalTracked * r(0.55, 0.9));
    rows.push({
      user_id: userId,
      date: dt.toISOString().slice(0, 10),
      total_tracked_sec: totalTracked,
      active_sec: activeSec,
      idle_sec: totalTracked - activeSec,
      by_app: dayByApp(activeSec)
    });
  }
  return rows;
}

async function main() {
  // wipe app data (not auth) for idempotency
  { const { error } = await db.from('daily_activity').delete().neq('user_id', '00000000-0000-0000-0000-000000000000'); if (error) throw error; }
  { const { error } = await db.from('profiles').delete().neq('id', '00000000-0000-0000-0000-000000000000'); if (error) throw error; }
  { const { error } = await db.from('teams').delete().neq('id', '00000000-0000-0000-0000-000000000000'); if (error) throw error; }
  { const { error } = await db.from('organizations').delete().neq('id', '00000000-0000-0000-0000-000000000000'); if (error) throw error; }

  const { data: org } = await db.from('organizations').insert({ name: 'Acme Inc' }).select().single();
  const { data: teams } = await db.from('teams')
    .insert([{ org_id: org.id, name: 'Platform' }, { org_id: org.id, name: 'Growth' }]).select();
  const platform = teams.find((t) => t.name === 'Platform');
  const growth = teams.find((t) => t.name === 'Growth');

  const people = [
    { email: 'admin@acme.test', full_name: 'Avery Admin', role: 'admin', team_id: null },
    { email: 'manager.platform@acme.test', full_name: 'Morgan Platform', role: 'manager', team_id: platform.id },
    { email: 'manager.growth@acme.test', full_name: 'Riley Growth', role: 'manager', team_id: growth.id }
  ];
  for (let i = 1; i <= 4; i++) {
    people.push({ email: `member${i}.platform@acme.test`, full_name: `Platform Member ${i}`, role: 'member', team_id: platform.id });
    people.push({ email: `member${i}.growth@acme.test`, full_name: `Growth Member ${i}`, role: 'member', team_id: growth.id });
  }

  // hoist listUsers() out of the per-user loop (O(N²) → O(1))
  const { data: listData } = await db.auth.admin.listUsers();
  const authUserMap = new Map(listData.users.map((u) => [u.email, u.id]));

  for (const p of people) {
    // idempotent: reuse existing auth user by email, else create and cache
    let id = authUserMap.get(p.email);
    if (!id) {
      const { data, error } = await db.auth.admin.createUser({
        email: p.email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: p.full_name }
      });
      if (error) throw error;
      id = data.user.id;
      authUserMap.set(p.email, id);
    }
    { const { error } = await db.from('profiles').insert({
      id, org_id: org.id, team_id: p.team_id, full_name: p.full_name, email: p.email, role: p.role
    }); if (error) throw error; }
    if (p.role !== 'admin') {
      const rows = makeDays(id, 30);
      if (rows.length) { const { error } = await db.from('daily_activity').insert(rows); if (error) throw error; }
    }
    console.log('seeded', p.email);
  }
  console.log('Done. Login with any seeded email + password:', PASSWORD);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
