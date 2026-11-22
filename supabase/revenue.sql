-- Revenue data from the "Promet MP" and "Promet VP" tabs of the Rekapitulacija workbook.
-- Run once in the Supabase SQL editor, AFTER roles.sql (it uses app_role()).

create table if not exists public.revenue_rows (
  id          bigint generated always as identity primary key,
  dataset     text not null check (dataset in ('promet_mp', 'promet_vp')),
  row_no      integer not null,
  data        jsonb not null,
  imported_at timestamptz not null default now()
);

alter table public.revenue_rows enable row level security;

-- Everyone with a role can read the revenue figures
create policy "revenue_select" on public.revenue_rows
  for select to authenticated
  using (app_role() in ('admin', 'accounting', 'management'));

-- Only admin and accounting upload new revenue data
create policy "revenue_insert" on public.revenue_rows
  for insert to authenticated
  with check (app_role() in ('admin', 'accounting'));

create policy "revenue_delete" on public.revenue_rows
  for delete to authenticated
  using (app_role() in ('admin', 'accounting'));

grant select, insert, delete on public.revenue_rows to authenticated;
grant usage, select on sequence public.revenue_rows_id_seq to authenticated;
