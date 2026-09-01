create type fulfillment_type as enum ('pickup', 'delivery');
create type order_status as enum ('draft', 'payment_pending', 'payment_review', 'payment_rejected', 'confirmed', 'in_preparation', 'ready', 'out_for_delivery', 'delivered', 'cancelled');
create type payment_status as enum ('pending', 'under_review', 'approved', 'rejected', 'superseded');

create table orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  user_id uuid not null references users(id),
  sales_cycle_id uuid not null references sales_cycles(id),
  status order_status not null default 'draft',
  fulfillment_type fulfillment_type not null,
  contact_snapshot jsonb not null,
  address_snapshot jsonb,
  customer_notes text,
  admin_public_note text,
  admin_private_note text,
  currency char(3) not null default 'USD',
  subtotal numeric(12,2) not null check (subtotal >= 0),
  discount_total numeric(12,2) not null default 0 check (discount_total >= 0),
  tax_total numeric(12,2) not null check (tax_total >= 0),
  total numeric(12,2) not null check (total >= 0),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  product_name_snapshot text not null,
  unit_base_price numeric(12,2) not null,
  quantity integer not null check (quantity > 0),
  modifier_total numeric(12,2) not null default 0,
  unit_total numeric(12,2) not null,
  line_total numeric(12,2) not null,
  tax_total numeric(12,2) not null,
  customer_note text,
  snapshot_json jsonb not null
);

create table order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  from_status order_status,
  to_status order_status not null,
  actor_user_id uuid references users(id),
  public_note text,
  private_note text,
  created_at timestamptz not null default now()
);

create table bank_accounts (
  id uuid primary key default gen_random_uuid(),
  bank_name text not null,
  account_type text not null,
  account_number_masked text not null,
  account_number_encrypted text not null,
  holder_name text not null,
  holder_identifier_encrypted text,
  instructions text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table payment_proofs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  status payment_status not null default 'pending',
  original_name text not null,
  stored_name text not null unique,
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  sha256 text not null,
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table stock_reservations (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references sales_cycles(id),
  product_id uuid not null references products(id),
  order_id uuid not null references orders(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  status text not null check (status in ('reserved', 'committed', 'released')),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index orders_cycle_status_idx on orders (sales_cycle_id, status, created_at desc);
create index orders_user_idx on orders (user_id, created_at desc);
create index payment_proofs_review_idx on payment_proofs (status, created_at);
create index stock_reservations_capacity_idx on stock_reservations (cycle_id, product_id, status);
create trigger orders_updated_at before update on orders for each row execute function set_updated_at();
create trigger bank_accounts_updated_at before update on bank_accounts for each row execute function set_updated_at();
create trigger payment_proofs_updated_at before update on payment_proofs for each row execute function set_updated_at();
