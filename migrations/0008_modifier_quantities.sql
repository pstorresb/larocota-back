alter table modifier_options
  add column included_quantity integer not null default 0,
  add column default_quantity integer not null default 0,
  add column max_quantity integer not null default 1;

update modifier_options set default_quantity = 1 where is_default = true;

alter table modifier_options
  add constraint modifier_options_included_quantity_check check (included_quantity >= 0),
  add constraint modifier_options_default_quantity_check check (default_quantity >= 0 and default_quantity <= max_quantity),
  add constraint modifier_options_max_quantity_check check (max_quantity > 0 and included_quantity <= max_quantity);
