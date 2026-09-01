import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { loadEnv } from "../src/config/env.js";
import { createDatabase } from "../src/db/client.js";
import { productImageDirectory } from "../src/common/storage/product-images.js";

try { loadEnvFile(); } catch { /* Environment may be injected by the process manager. */ }

const env = loadEnv();
const sql = createDatabase(env);
const assetDirectory = fileURLToPath(new URL("../seed-assets/product-images/", import.meta.url));
const imageDirectory = productImageDirectory(env.UPLOAD_DIR);

const categorySeeds = [
  { name: "Ensaladas", slug: "ensaladas", description: "Platos frescos preparados al momento.", sortOrder: 1 },
  { name: "Sánduches", slug: "sanduches", description: "Sánduches artesanales tostados al momento.", sortOrder: 2 },
  { name: "Quesadillas", slug: "quesadillas", description: "Quesadillas doradas con rellenos frescos.", sortOrder: 3 },
] as const;

const productSeeds = [
  { categorySlug: "ensaladas", name: "Ensalada Rocota", slug: "ensalada-rocota", shortDescription: "Pollo a la parrilla, aguacate, tomate cherry, hojas frescas y vinagreta de la casa.", description: "Ensalada completa con pollo recién preparado, vegetales frescos y nuestra vinagreta de la casa.", imageKey: "seed-ensalada-rocota.png", imageAlt: "Ensalada con pollo a la parrilla, aguacate y tomate cherry", badge: "Favorita", price: "7.50", sortOrder: 1 },
  { categorySlug: "sanduches", name: "Sánduche Andino", slug: "sanduche-andino", shortDescription: "Pollo cremoso, tomate, hojas tiernas y pan artesanal tostado al momento.", description: "Sánduche caliente de pollo cremoso con vegetales frescos sobre pan artesanal.", imageKey: "seed-sanduche-andino.png", imageAlt: "Sánduche artesanal tostado con pollo y vegetales", badge: "Nuevo", price: "6.75", sortOrder: 2 },
  { categorySlug: "quesadillas", name: "Quesadilla Roja", slug: "quesadilla-roja", shortDescription: "Queso fundido, vegetales asados y un toque de ají Rocota. Incluye salsa fresca.", description: "Quesadilla dorada rellena de queso y vegetales asados, acompañada de salsa fresca.", imageKey: "seed-quesadilla-roja.png", imageAlt: "Quesadillas doradas rellenas de queso y vegetales", badge: "Con carácter", price: "6.25", sortOrder: 3 },
  { categorySlug: "ensaladas", name: "Ensalada La Rocota", slug: "ensalada-la-rocota", shortDescription: "Hojas frescas, pollo a la parrilla, tomate cherry, zanahoria, croutones, parmesano y ranch.", description: "Lechuga romana o mix de romana y crespa con pollo a la parrilla, tomate cherry, zanahoria rallada fina, croutones, queso parmesano y salsa ranch.", imageKey: null, imageAlt: null, badge: "Nueva", price: "7.50", sortOrder: 4 },
  { categorySlug: "quesadillas", name: "Quesadilla de Pollo", slug: "quesadilla-de-pollo", shortDescription: "Pollo sazonado, salsa cremosa, mozzarella, guacamole y ají de la casa.", description: "Tortilla de trigo rellena de pollo sazonado, salsa cremosa de pollo con crema de leche y queso mozzarella, acompañada de guacamole y ají de la casa.", imageKey: null, imageAlt: null, badge: "Nueva", price: "6.75", sortOrder: 5 },
  { categorySlug: "sanduches", name: "Sánduche Jamón & Queso", slug: "sanduche-jamon-queso", shortDescription: "Pan francés, jamón, queso, ensalada crocante y mayonesa especial.", description: "Pan francés tostado con jamón, queso mozzarella o gouda, ensalada crocante de la casa y mayonesa especial La Rocota.", imageKey: null, imageAlt: null, badge: "Nuevo", price: "5.75", sortOrder: 6 },
  { categorySlug: "sanduches", name: "Sánduche Jamón & Salami", slug: "sanduche-jamon-salami", shortDescription: "Pan francés, jamón, salami, ensalada crocante y mayonesa especial.", description: "Pan francés tostado con jamón, salami, queso opcional, ensalada crocante de la casa y mayonesa especial La Rocota.", imageKey: null, imageAlt: null, badge: "Nuevo", price: "6.25", sortOrder: 7 },
] as const;

const configurationSeeds = {
  "ensalada-rocota": [
    { id: "10000000-0000-4000-8000-000000000001", name: "Ingredientes incluidos", description: "Quita ingredientes o aumenta la porción según prefieras.", type: "multiple", min: 0, max: 5, options: [
      { id: "11000000-0000-4000-8000-000000000001", name: "Pollo a la parrilla", price: 2, included: 1, initial: 1, max: 2 },
      { id: "11000000-0000-4000-8000-000000000002", name: "Aguacate", price: 1.25, included: 1, initial: 1, max: 2 },
      { id: "11000000-0000-4000-8000-000000000003", name: "Tomate cherry", price: .5, included: 1, initial: 1, max: 2 },
      { id: "11000000-0000-4000-8000-000000000004", name: "Hojas frescas", price: .5, included: 1, initial: 1, max: 2 },
      { id: "11000000-0000-4000-8000-000000000005", name: "Vinagreta de la casa", price: .5, included: 1, initial: 1, max: 2 },
    ] },
    { id: "10000000-0000-4000-8000-000000000002", name: "Agrega algo más", description: "Extras opcionales para completar tu ensalada.", type: "multiple", min: 0, max: 3, options: [
      { id: "12000000-0000-4000-8000-000000000001", name: "Queso fresco", price: 1, included: 0, initial: 0, max: 2 },
      { id: "12000000-0000-4000-8000-000000000002", name: "Nueces", price: .75, included: 0, initial: 0, max: 2 },
      { id: "12000000-0000-4000-8000-000000000003", name: "Porción extra de pollo", price: 2, included: 0, initial: 0, max: 2 },
    ] },
  ],
  "sanduche-andino": [
    { id: "20000000-0000-4000-8000-000000000001", name: "Elige tu pan", description: "Selecciona una variedad.", type: "single", min: 1, max: 1, options: [
      { id: "21000000-0000-4000-8000-000000000001", name: "Pan artesanal", price: 0, included: 1, initial: 1, max: 1 },
      { id: "21000000-0000-4000-8000-000000000002", name: "Pan integral", price: .5, included: 0, initial: 0, max: 1 },
    ] },
    { id: "20000000-0000-4000-8000-000000000002", name: "Así viene tu sánduche", description: "Puedes quitar ingredientes incluidos o pedir porciones adicionales.", type: "multiple", min: 0, max: 4, options: [
      { id: "22000000-0000-4000-8000-000000000001", name: "Pollo cremoso", price: 1.75, included: 1, initial: 1, max: 2 },
      { id: "22000000-0000-4000-8000-000000000002", name: "Tomate", price: .5, included: 1, initial: 1, max: 2 },
      { id: "22000000-0000-4000-8000-000000000003", name: "Hojas tiernas", price: .5, included: 1, initial: 1, max: 2 },
      { id: "22000000-0000-4000-8000-000000000004", name: "Queso", price: 1, included: 0, initial: 0, max: 2 },
    ] },
  ],
  "quesadilla-roja": [
    { id: "30000000-0000-4000-8000-000000000001", name: "Ingredientes incluidos", description: "Personaliza el relleno sin perder los ingredientes que ya están incluidos.", type: "multiple", min: 0, max: 4, options: [
      { id: "31000000-0000-4000-8000-000000000001", name: "Queso fundido", price: 1.25, included: 1, initial: 1, max: 2 },
      { id: "31000000-0000-4000-8000-000000000002", name: "Vegetales asados", price: .75, included: 1, initial: 1, max: 2 },
      { id: "31000000-0000-4000-8000-000000000003", name: "Ají Rocota", price: .25, included: 1, initial: 1, max: 2 },
      { id: "31000000-0000-4000-8000-000000000004", name: "Salsa fresca", price: .5, included: 1, initial: 1, max: 2 },
    ] },
    { id: "30000000-0000-4000-8000-000000000002", name: "Proteína adicional", description: "Elige hasta una opción.", type: "single", min: 0, max: 1, options: [
      { id: "32000000-0000-4000-8000-000000000001", name: "Pollo a la parrilla", price: 2, included: 0, initial: 0, max: 1 },
      { id: "32000000-0000-4000-8000-000000000002", name: "Carne salteada", price: 2.5, included: 0, initial: 0, max: 1 },
    ] },
  ],
  "ensalada-la-rocota": [
    { id: "40000000-0000-4000-8000-000000000001", name: "Elige la base de hojas", description: "Selecciona una de las dos bases incluidas.", type: "single", min: 1, max: 1, options: [
      { id: "41000000-0000-4000-8000-000000000001", name: "Lechuga romana", price: 0, included: 1, initial: 1, max: 1 },
      { id: "41000000-0000-4000-8000-000000000002", name: "Mix de romana y crespa", price: 0, included: 0, initial: 0, max: 1 },
    ] },
    { id: "40000000-0000-4000-8000-000000000002", name: "Ingredientes incluidos", description: "Vienen seleccionados; puedes quitar los que no desees.", type: "multiple", min: 0, max: 6, options: [
      { id: "42000000-0000-4000-8000-000000000001", name: "Pollo a la parrilla", price: 0, included: 1, initial: 1, max: 1 },
      { id: "42000000-0000-4000-8000-000000000002", name: "Tomate cherry", price: 0, included: 1, initial: 1, max: 1 },
      { id: "42000000-0000-4000-8000-000000000003", name: "Zanahoria rallada fina", price: 0, included: 1, initial: 1, max: 1 },
      { id: "42000000-0000-4000-8000-000000000004", name: "Croutones", price: 0, included: 1, initial: 1, max: 1 },
      { id: "42000000-0000-4000-8000-000000000005", name: "Queso parmesano", price: 0, included: 1, initial: 1, max: 1 },
      { id: "42000000-0000-4000-8000-000000000006", name: "Salsa ranch", price: 0, included: 1, initial: 1, max: 1 },
    ] },
  ],
  "quesadilla-de-pollo": [
    { id: "50000000-0000-4000-8000-000000000001", name: "Ingredientes incluidos", description: "Vienen seleccionados; puedes quitar los que no desees.", type: "multiple", min: 0, max: 5, options: [
      { id: "51000000-0000-4000-8000-000000000001", name: "Tortilla de trigo", price: 0, included: 1, initial: 1, max: 1, locked: true },
      { id: "51000000-0000-4000-8000-000000000002", name: "Pollo sazonado", price: 0, included: 1, initial: 1, max: 1 },
      { id: "51000000-0000-4000-8000-000000000003", name: "Salsa cremosa de pollo", price: 0, included: 1, initial: 1, max: 1 },
      { id: "51000000-0000-4000-8000-000000000004", name: "Queso mozzarella", price: 0, included: 1, initial: 1, max: 1 },
      { id: "51000000-0000-4000-8000-000000000006", name: "Ají de la casa", price: 0, included: 1, initial: 1, max: 1 },
    ] },
    { id: "50000000-0000-4000-8000-000000000002", name: "Acompañamientos", description: "El guacamole está incluido; puedes agregar papas fritas.", type: "multiple", min: 0, max: 2, options: [
      { id: "52000000-0000-4000-8000-000000000001", name: "Guacamole", description: "Incluido y servido en un recipiente aparte.", price: 0, included: 1, initial: 1, max: 1 },
      { id: "52000000-0000-4000-8000-000000000002", name: "Porción de papas fritas", description: "Acompañamiento opcional.", price: 1.5, included: 0, initial: 0, max: 1 },
    ] },
  ],
  "sanduche-jamon-queso": [
    { id: "60000000-0000-4000-8000-000000000001", name: "Elige tu queso", description: "Selecciona el queso incluido en tu sánduche.", type: "single", min: 1, max: 1, options: [
      { id: "61000000-0000-4000-8000-000000000001", name: "Queso mozzarella", price: 0, included: 1, initial: 1, max: 1 },
      { id: "61000000-0000-4000-8000-000000000002", name: "Queso gouda", price: 0, included: 0, initial: 0, max: 1 },
    ] },
    { id: "60000000-0000-4000-8000-000000000002", name: "Ingredientes incluidos", description: "Vienen seleccionados; puedes quitar los que no desees.", type: "multiple", min: 0, max: 4, options: [
      { id: "62000000-0000-4000-8000-000000000001", name: "Pan francés", price: 0, included: 1, initial: 1, max: 1 },
      { id: "62000000-0000-4000-8000-000000000002", name: "Jamón", price: 0, included: 1, initial: 1, max: 1 },
      { id: "62000000-0000-4000-8000-000000000003", name: "Ensalada crocante de la casa", price: 0, included: 1, initial: 1, max: 1 },
      { id: "62000000-0000-4000-8000-000000000004", name: "Mayonesa especial La Rocota", price: 0, included: 1, initial: 1, max: 1 },
    ] },
  ],
  "sanduche-jamon-salami": [
    { id: "70000000-0000-4000-8000-000000000001", name: "Ingredientes incluidos", description: "Vienen seleccionados; puedes quitar los que no desees.", type: "multiple", min: 0, max: 5, options: [
      { id: "71000000-0000-4000-8000-000000000001", name: "Pan francés", price: 0, included: 1, initial: 1, max: 1 },
      { id: "71000000-0000-4000-8000-000000000002", name: "Jamón", price: 0, included: 1, initial: 1, max: 1 },
      { id: "71000000-0000-4000-8000-000000000003", name: "Salami", price: 0, included: 1, initial: 1, max: 1 },
      { id: "71000000-0000-4000-8000-000000000004", name: "Ensalada crocante de la casa", price: 0, included: 1, initial: 1, max: 1 },
      { id: "71000000-0000-4000-8000-000000000005", name: "Mayonesa especial La Rocota", price: 0, included: 1, initial: 1, max: 1 },
    ] },
    { id: "70000000-0000-4000-8000-000000000002", name: "¿Deseas queso?", description: "Puedes agregar una variedad sin recargo inicial.", type: "single", min: 0, max: 1, options: [
      { id: "72000000-0000-4000-8000-000000000001", name: "Queso mozzarella", price: 0, included: 0, initial: 0, max: 1 },
      { id: "72000000-0000-4000-8000-000000000002", name: "Queso gouda", price: 0, included: 0, initial: 0, max: 1 },
    ] },
  ],
} as const;

try {
  await mkdir(imageDirectory, { recursive: true });
  for (const product of productSeeds) {
    if (!product.imageKey) continue;
    const sourceName = product.imageKey.replace(/^seed-/, "");
    await copyFile(resolve(assetDirectory, sourceName), resolve(imageDirectory, product.imageKey));
  }

  const categoryIds = new Map<string, string>();
  for (const category of categorySeeds) {
    const [saved] = await sql<{ id: string }[]>`
      insert into categories (name, slug, description, sort_order, is_active)
      values (${category.name}, ${category.slug}, ${category.description}, ${category.sortOrder}, true)
      on conflict (slug) do update set name = excluded.name, description = excluded.description,
        sort_order = excluded.sort_order, is_active = true
      returning id
    `;
    if (!saved) throw new Error(`No se pudo crear la categoría ${category.name}.`);
    categoryIds.set(category.slug, saved.id);
  }

  const productIds: string[] = [];
  const productIdBySlug = new Map<string, string>();
  for (const product of productSeeds) {
    const categoryId = categoryIds.get(product.categorySlug);
    if (!categoryId) throw new Error(`Categoría faltante para ${product.name}.`);
    const [saved] = await sql<{ id: string }[]>`
      insert into products (category_id, name, slug, short_description, description, image_key, image_alt, badge, base_price, tax_rate, is_active, sort_order)
      values (${categoryId}, ${product.name}, ${product.slug}, ${product.shortDescription}, ${product.description}, ${product.imageKey}, ${product.imageAlt}, ${product.badge}, ${product.price}, 0.15, true, ${product.sortOrder})
      on conflict (slug) do update set category_id = excluded.category_id, name = excluded.name,
        short_description = excluded.short_description, description = excluded.description,
        image_key = excluded.image_key, image_alt = excluded.image_alt, badge = excluded.badge,
        base_price = excluded.base_price, tax_rate = excluded.tax_rate, is_active = true,
        sort_order = excluded.sort_order
      returning id
    `;
    if (!saved) throw new Error(`No se pudo crear el producto ${product.name}.`);
    productIds.push(saved.id);
    productIdBySlug.set(product.slug, saved.id);
  }

  for (const [productSlug, groups] of Object.entries(configurationSeeds)) {
    const productId = productIdBySlug.get(productSlug);
    if (!productId) throw new Error(`Producto faltante para configurar ${productSlug}.`);
    for (const [groupIndex, group] of groups.entries()) {
      await sql`
        insert into modifier_groups (id, product_id, name, description, selection_type, min_selections, max_selections, is_active, sort_order)
        values (${group.id}, ${productId}, ${group.name}, ${group.description}, ${group.type}, ${group.min}, ${group.max}, true, ${groupIndex})
        on conflict (id) do update set product_id = excluded.product_id, name = excluded.name,
          description = excluded.description, selection_type = excluded.selection_type,
          min_selections = excluded.min_selections, max_selections = excluded.max_selections,
          is_active = true, sort_order = excluded.sort_order
      `;
      for (const [optionIndex, option] of group.options.entries()) {
        const optionDescription = "description" in option ? option.description : null;
        const optionLocked = "locked" in option ? option.locked : false;
        await sql`
          insert into modifier_options (id, modifier_group_id, name, description, price_delta, is_default, is_active, sort_order, included_quantity, default_quantity, max_quantity, is_locked)
          values (${option.id}, ${group.id}, ${option.name}, ${optionDescription}, ${option.price}, ${option.initial > 0}, true, ${optionIndex}, ${option.included}, ${option.initial}, ${option.max}, ${optionLocked})
          on conflict (id) do update set modifier_group_id = excluded.modifier_group_id,
            name = excluded.name, description = excluded.description, price_delta = excluded.price_delta, is_default = excluded.is_default,
            is_active = true, sort_order = excluded.sort_order, included_quantity = excluded.included_quantity,
            default_quantity = excluded.default_quantity, max_quantity = excluded.max_quantity, is_locked = excluded.is_locked
        `;
      }
    }
  }

  // Guacamole moved from the filling to its own side-dish group.
  await sql`delete from modifier_options where id = '51000000-0000-4000-8000-000000000005'`;

  const opensAt = new Date(Date.now() - 60 * 60 * 1000);
  const closesAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
  const fulfillmentAt = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
  const [cycle] = await sql<{ id: string }[]>`
    insert into sales_cycles (id, name, opens_at, closes_at, fulfillment_at, status, global_capacity, fulfillment_modes, public_message)
    values ('00000000-0000-4000-8000-000000000001', 'Menú de esta semana', ${opensAt}, ${closesAt}, ${fulfillmentAt}, 'open', 60, '["delivery"]'::jsonb, 'Entrega gratuita en Ibarra. Pedidos abiertos hasta agotar cupos.')
    on conflict (id) do update set name = excluded.name, opens_at = excluded.opens_at,
      closes_at = excluded.closes_at, fulfillment_at = excluded.fulfillment_at,
      status = 'open', global_capacity = excluded.global_capacity,
      fulfillment_modes = excluded.fulfillment_modes, public_message = excluded.public_message
    returning id
  `;
  if (!cycle) throw new Error("No se pudo crear el ciclo de demostración.");

  for (const [index, productId] of productIds.entries()) {
    await sql`
      insert into cycle_products (cycle_id, product_id, capacity, is_available, sort_order)
      values (${cycle.id}, ${productId}, 20, true, ${index + 1})
      on conflict (cycle_id, product_id) do update set capacity = 20, is_available = true,
        sort_order = excluded.sort_order
    `;
  }
  console.log("Demo seed completed: 3 categories, 7 configurable products, modifier groups, 1 open cycle and 3 product images.");
} finally {
  await sql.end();
}
