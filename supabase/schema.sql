-- Run this once in the Supabase SQL editor.

create table if not exists public.invoices (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  created_by    uuid not null default auth.uid() references auth.users (id),
  invoice_number text not null,
  company_name  text not null,
  oib           char(11) not null check (oib ~ '^[0-9]{11}$'),
  net_5         numeric(12,2) not null default 0,
  vat_5         numeric(12,2) not null default 0,
  net_13        numeric(12,2) not null default 0,
  vat_13        numeric(12,2) not null default 0,
  net_25        numeric(12,2) not null default 0,
  vat_25        numeric(12,2) not null default 0,
  gross_total   numeric(12,2) not null,
  expense_class text not null,
  image_path    text
);

alter table public.invoices enable row level security;

-- Any signed-in user can read and write invoices. Sign-ups are disabled (see README),
-- so only people you invite can sign in.
create policy "invoices_select" on public.invoices
  for select to authenticated using (true);
create policy "invoices_insert" on public.invoices
  for insert to authenticated with check (true);
create policy "invoices_update" on public.invoices
  for update to authenticated using (true) with check (true);
create policy "invoices_delete" on public.invoices
  for delete to authenticated using (true);

-- Private storage bucket for the invoice photos
insert into storage.buckets (id, name, public)
values ('invoice-images', 'invoice-images', false)
on conflict (id) do nothing;

create policy "images_upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'invoice-images');
create policy "images_read" on storage.objects
  for select to authenticated using (bucket_id = 'invoice-images');

-- Needed so the accumulated Excel file (exports/invoices.xlsx) can be overwritten (upsert)
create policy "images_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'invoice-images')
  with check (bucket_id = 'invoice-images');
