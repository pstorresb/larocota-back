create table password_recovery_codes (
  email text primary key,
  user_id uuid not null references users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  send_count integer not null default 1,
  last_sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint password_recovery_codes_email_normalized check (email = lower(trim(email))),
  constraint password_recovery_codes_attempts_valid check (attempts >= 0),
  constraint password_recovery_codes_sends_valid check (send_count >= 1)
);

create trigger password_recovery_codes_updated_at before update on password_recovery_codes
for each row execute function set_updated_at();
