-- Environment readiness only. This is NOT the product's knowledge schema.
create extension if not exists vector with schema extensions;
create table public._setup_connectivity_probe (
  id uuid primary key,
  payload text not null,
  created_at timestamptz not null default now()
);
comment on table public._setup_connectivity_probe is 'Setup-only connectivity probe; no knowledge or user content.';
alter table public._setup_connectivity_probe enable row level security;
revoke all on table public._setup_connectivity_probe from public, anon, authenticated;
grant select, insert, update, delete on table public._setup_connectivity_probe to service_role;
-- No public or authenticated RLS policies: browser clients have no access.;
