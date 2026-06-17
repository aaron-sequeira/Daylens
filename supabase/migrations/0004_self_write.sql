-- A user may insert/update ONLY their own daily_activity rows. Managers/admins stay read-only.
create policy daily_self_insert on daily_activity
  for insert with check (user_id = auth.uid());

create policy daily_self_update on daily_activity
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 0003 granted SELECT to authenticated; add the write privileges RLS gates.
grant insert, update on daily_activity to authenticated;
