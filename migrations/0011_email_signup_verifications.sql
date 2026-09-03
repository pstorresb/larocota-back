create table email_signup_verifications (
  email text primary key,
  password_hash text not null,
  first_name text not null,
  last_name text not null,
  phone text,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  send_count integer not null default 1,
  last_sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_signup_verifications_email_normalized check (email = lower(trim(email))),
  constraint email_signup_verifications_attempts_valid check (attempts >= 0),
  constraint email_signup_verifications_sends_valid check (send_count >= 1)
);

create trigger email_signup_verifications_updated_at before update on email_signup_verifications
for each row execute function set_updated_at();
