import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import ws from 'ws';

const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2];
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('Missing SUPABASE url/service-role key in apps/web/.env.local');

function arg(name) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; }
const orgName = arg('org');
const adminEmail = arg('admin-email');
const adminName = arg('admin-name') ?? 'Org Admin';
const adminPassword = arg('admin-password') ?? randomBytes(9).toString('base64url');
if (!orgName || !adminEmail) { console.error('Usage: node scripts/create-org.mjs --org "<name>" --admin-email <email> [--admin-password <pw>] [--admin-name "<name>"]'); process.exit(1); }

const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: ws } });

async function ensureOrg(name) {
  const { data: existing } = await db.from('organizations').select('id').eq('name', name).maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await db.from('organizations').insert({ name }).select('id').single();
  if (error) throw error; return data.id;
}
async function ensureUser(email, fullName, password) {
  const { data: list, error: listErr } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw listErr;
  const found = list.users.find((u) => u.email === email);
  if (found) return found.id;
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
  if (error) throw error; return data.user.id;
}

const orgId = await ensureOrg(orgName);
const adminId = await ensureUser(adminEmail, adminName, adminPassword);
const { data: prof } = await db.from('profiles').select('id, org_id').eq('id', adminId).maybeSingle();
if (!prof) {
  const { error } = await db.from('profiles').insert({ id: adminId, org_id: orgId, team_id: null, full_name: adminName, email: adminEmail, role: 'admin', active: true });
  if (error) throw error;
} else if (prof.org_id !== orgId) {
  console.warn(`WARNING: admin ${adminEmail} already belongs to a different org; org_id NOT changed`);
}
console.log(`Org "${orgName}" ready. Admin: ${adminEmail}`);
if (!arg('admin-password')) console.log(`Generated admin password: ${adminPassword}`);
process.exit(0);
