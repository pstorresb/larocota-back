-- Global store settings (payment instructions, pickup point). One row per key, JSON value.
create table store_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);

insert into store_settings (key, value) values
  ('payment', '{"enabled": false, "bankName": "", "accountType": "Cuenta de ahorros", "accountNumber": "", "holderName": "", "holderIdentifier": "", "instructions": ""}'::jsonb),
  ('pickup', '{"addressLine": "", "reference": "", "hours": "", "mapUrl": "", "instructions": ""}'::jsonb)
on conflict (key) do nothing;

-- Reservation expiry: the maintenance job cancels payment_pending orders whose reservations expired.
create index stock_reservations_expiry_idx on stock_reservations (expires_at) where status = 'reserved' and expires_at is not null;
