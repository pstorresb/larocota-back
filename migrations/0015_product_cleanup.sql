-- Product catalog cleanup: remove columns and tables that no code reads or that never reached the storefront.
drop table if exists product_components;

alter table products
  drop column if exists preparation_notes,
  drop column if exists description;

alter table categories
  drop column if exists description;

-- Superseded by default_quantity (0008); nothing read it anymore.
alter table modifier_options
  drop column if exists is_default;

-- Product order now drives the storefront (category order, then product order).
create index if not exists products_category_order_idx on products (category_id, sort_order, name);
