-- Role-based access. Run once in the Supabase SQL editor, AFTER schema.sql and mer_tables.sql.
--
-- Roles (stored in each user's app_metadata; users cannot change it themselves):
--   admin       everything, including importing the MER file and deleting invoices
--   accounting  upload invoices, view invoice photos, view all tables and dashboard
--   management  view the dashboard and all tables only
--
-- IMPORTANT: give yourself the admin role BEFORE running this file, otherwise nobody can write or read.
--   update auth.users
--   set raw_app_meta_data = raw_app_meta_data || '{"role": "admin"}'
--   where email = 'your@email.com';
-- Then sign out and back in.

-- Returns the role of the signed-in user ('' if none)
create or replace function public.app_role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '');
$$;

-- ---------- invoices ----------
drop policy if exists "invoices_select" on public.invoices;
drop policy if exists "invoices_insert" on public.invoices;
drop policy if exists "invoices_update" on public.invoices;
drop policy if exists "invoices_delete" on public.invoices;

create policy "invoices_select" on public.invoices
  for select to authenticated
  using (app_role() in ('admin', 'accounting', 'management'));
create policy "invoices_insert" on public.invoices
  for insert to authenticated
  with check (app_role() in ('admin', 'accounting'));
create policy "invoices_update" on public.invoices
  for update to authenticated
  using (app_role() in ('admin', 'accounting'))
  with check (app_role() in ('admin', 'accounting'));
create policy "invoices_delete" on public.invoices
  for delete to authenticated
  using (app_role() = 'admin');

-- ---------- invoice photos and Excel export (storage) ----------
drop policy if exists "images_upload" on storage.objects;
drop policy if exists "images_read" on storage.objects;
drop policy if exists "images_update" on storage.objects;

create policy "images_upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'invoice-images' and app_role() in ('admin', 'accounting'));
create policy "images_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'invoice-images' and app_role() in ('admin', 'accounting'));
create policy "images_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'invoice-images' and app_role() in ('admin', 'accounting'))
  with check (bucket_id = 'invoice-images' and app_role() in ('admin', 'accounting'));

-- ---------- MER tables ----------
drop policy if exists "mer_select" on public.mer_rows;
drop policy if exists "mer_insert" on public.mer_rows;
drop policy if exists "mer_delete" on public.mer_rows;

create policy "mer_select" on public.mer_rows
  for select to authenticated
  using (app_role() in ('admin', 'accounting', 'management'));
create policy "mer_insert" on public.mer_rows
  for insert to authenticated
  with check (app_role() = 'admin');
create policy "mer_delete" on public.mer_rows
  for delete to authenticated
  using (app_role() = 'admin');
