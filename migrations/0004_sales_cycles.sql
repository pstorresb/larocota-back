create type sales_cycle_status as enum ('draft', 'scheduled', 'open', 'closed', 'fulfilled', 'cancelled');
create table sales_cycles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  fulfillment_at timestamptz not null,
  status sales_cycle_status not null default 'draft',
  global_capacity integer check (global_capacity is null or global_capacity > 0),
  fulfillment_modes jsonb not null default '["pickup"]'::jsonb,
  public_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cycle_time_order check (opens_at < closes_at and closes_at < fulfillment_at)
);

create table cycle_products (
  cycle_id uuid not null references sales_cycles(id) on delete cascade,
  product_id uuid not null references products(id),
  price_override numeric(12,2) check (price_override is null or price_override >= 0),
  capacity integer check (capacity is null or capacity > 0),
  is_available boolean not null default true,
  sort_order integer not null default 0,
  primary key (cycle_id, product_id)
);
create index sales_cycles_public_idx on sales_cycles (status, opens_at, closes_at);
create trigger sales_cycles_updated_at before update on sales_cycles for each row execute function set_updated_at();
