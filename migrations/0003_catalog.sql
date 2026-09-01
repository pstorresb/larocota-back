create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id),
  name text not null,
  slug text not null unique,
  short_description text not null,
  description text,
  base_price numeric(12,2) not null check (base_price >= 0),
  tax_rate numeric(5,4) not null default 0 check (tax_rate between 0 and 1),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  preparation_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table product_components (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  name text not null,
  is_removable boolean not null default false,
  sort_order integer not null default 0
);

create type modifier_selection_type as enum ('single', 'multiple');
create table modifier_groups (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  name text not null,
  description text,
  selection_type modifier_selection_type not null,
  min_selections integer not null default 0 check (min_selections >= 0),
  max_selections integer not null check (max_selections > 0 and max_selections >= min_selections),
  is_active boolean not null default true,
  sort_order integer not null default 0
);

create table modifier_options (
  id uuid primary key default gen_random_uuid(),
  modifier_group_id uuid not null references modifier_groups(id) on delete cascade,
  name text not null,
  description text,
  price_delta numeric(12,2) not null default 0 check (price_delta >= 0),
  is_default boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0
);

create trigger categories_updated_at before update on categories for each row execute function set_updated_at();
create trigger products_updated_at before update on products for each row execute function set_updated_at();
