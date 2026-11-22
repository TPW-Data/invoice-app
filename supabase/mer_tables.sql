-- Run once in the Supabase SQL editor (after schema.sql).
-- Stores the rows of the MER Excel file: MER Archive, Salary and Out of MER Racuni.

create table if not exists public.mer_rows (
  id          bigint generated always as identity primary key,
  dataset     text not null check (dataset in ('mer_archive', 'salary', 'out_of_mer')),
  row_no      integer not null,
  data        jsonb not null,
  imported_at timestamptz not null default now()
);

alter table public.mer_rows enable row level security;

create policy "mer_select" on public.mer_rows
  for select to authenticated using (true);
create policy "mer_insert" on public.mer_rows
  for insert to authenticated with check (true);
create policy "mer_delete" on public.mer_rows
  for delete to authenticated using (true);

grant select, insert, delete on public.mer_rows to authenticated;
grant usage, select on sequence public.mer_rows_id_seq to authenticated;
