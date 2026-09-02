alter table users alter column password_hash drop not null;

create table oauth_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null,
  provider_subject text not null,
  provider_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint oauth_identities_provider check (provider in ('google')),
  unique (provider, provider_subject),
  unique (user_id, provider)
);

create trigger oauth_identities_updated_at before update on oauth_identities for each row execute function set_updated_at();
