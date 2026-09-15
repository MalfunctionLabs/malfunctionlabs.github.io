-- LABS project only. Additive: does not change the tester portal or contact tables.
begin;

create table public.beta_applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  project text not null default 'MRS' check (project = 'MRS'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 100),
  email text not null check (
    char_length(email) between 3 and 254 and email = lower(btrim(email))
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  discord text not null default '' check (char_length(discord) <= 100),
  platform text not null check (platform in ('Windows', 'Linux', 'macOS', 'Other')),
  specs text not null check (char_length(btrim(specs)) between 1 and 1500),
  availability text not null check (char_length(btrim(availability)) between 1 and 300),
  experience text not null default '' check (char_length(experience) <= 2000),
  motivation text not null check (char_length(btrim(motivation)) between 1 and 2000),
  contact_consent boolean not null check (contact_consent = true),
  consent_version text not null default 'beta-contact-v1' check (consent_version = 'beta-contact-v1'),
  status text not null default 'pending' check (status in ('pending', 'reviewing', 'accepted', 'declined')),
  admin_notes text not null default '',
  unique (project, email)
);

create index beta_applications_review_queue on public.beta_applications (status, created_at);
alter table public.beta_applications enable row level security;
-- No public policies. Visitors and signed-in testers cannot list, read or write applications.
revoke all on table public.beta_applications from public, anon, authenticated;
grant select, insert, update, delete on table public.beta_applications to service_role;
comment on table public.beta_applications is
  'Private application queue. Acceptance is a review decision, never a tester account or access grant.';
commit;
