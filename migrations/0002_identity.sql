create type user_role as enum ('customer', 'admin', 'superadmin');
create type user_status as enum ('active', 'disabled');

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  first_name text not null,
  last_name text not null,
  phone text,
  role user_role not null default 'customer',
  status user_status not null default 'active',
  email_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_email_normalized check (email = lower(trim(email)))
);
create unique index users_email_unique on users (email);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index sessions_active_user_idx on sessions (user_id, expires_at) where revoked_at is null;

create trigger users_updated_at before update on users for each row execute function set_updated_at();
