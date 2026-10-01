-- Fulfillment window + time slots per cycle. A cycle no longer has a single fulfillment instant:
-- it has a window (starts/ends) split into slots of 30 or 60 minutes. Slots are computed from the
-- window, never stored; each order records the slot it picked.
alter table sales_cycles rename column fulfillment_at to fulfillment_starts_at;
alter table sales_cycles
  add column fulfillment_ends_at timestamptz,
  add column slot_minutes integer not null default 60,
  add column slot_capacity integer;

update sales_cycles set fulfillment_ends_at = fulfillment_starts_at + interval '2 hours' where fulfillment_ends_at is null;
alter table sales_cycles alter column fulfillment_ends_at set not null;

alter table sales_cycles drop constraint cycle_time_order;
alter table sales_cycles
  add constraint cycle_time_order check (
    opens_at < closes_at and closes_at < fulfillment_starts_at and fulfillment_starts_at < fulfillment_ends_at
  ),
  add constraint cycle_slot_minutes check (slot_minutes in (30, 60)),
  add constraint cycle_slot_capacity check (slot_capacity is null or slot_capacity > 0),
  add constraint cycle_window_fits_slots check (
    fulfillment_ends_at - fulfillment_starts_at <= interval '24 hours'
    and mod(extract(epoch from (fulfillment_ends_at - fulfillment_starts_at))::integer, slot_minutes * 60) = 0
  );

-- The slot an order chose. Nullable only for orders placed before this migration.
alter table orders
  add column slot_starts_at timestamptz,
  add column slot_ends_at timestamptz,
  add constraint orders_slot_pair check (
    (slot_starts_at is null and slot_ends_at is null) or slot_starts_at < slot_ends_at
  );
create index orders_cycle_slot_idx on orders (sales_cycle_id, slot_starts_at) where status <> 'cancelled';
