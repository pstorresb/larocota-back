alter table modifier_options
  add column is_locked boolean not null default false;

alter table modifier_options
  add constraint modifier_options_locked_check
  check (not is_locked or (default_quantity > 0 and included_quantity >= default_quantity));
