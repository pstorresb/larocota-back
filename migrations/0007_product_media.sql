alter table products
  add column image_key text,
  add column image_alt text,
  add column badge text;

alter table products
  add constraint products_image_key_format check (image_key is null or image_key ~ '^[a-zA-Z0-9._-]+$'),
  add constraint products_image_alt_length check (image_alt is null or char_length(image_alt) <= 180),
  add constraint products_badge_length check (badge is null or char_length(badge) <= 40);
