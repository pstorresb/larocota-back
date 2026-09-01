create table audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users(id),
  request_id text,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  before_json jsonb,
  after_json jsonb,
  metadata_json jsonb,
  created_at timestamptz not null default now()
);

create index audit_entity_idx on audit_events (entity_type, entity_id, created_at desc);
create index audit_actor_idx on audit_events (actor_user_id, created_at desc);

create table documents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  document_type text not null check (document_type in ('proforma', 'sale')),
  document_number text not null unique,
  snapshot_json jsonb not null,
  file_name text,
  issued_at timestamptz not null default now()
);
