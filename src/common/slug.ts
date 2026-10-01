import type { Database } from "../db/client.js";

/** "Sánduche Jamón & Queso" → "sanduche-jamon-queso". */
export function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

/** First free slug among `base`, `base-2`, `base-3`… given the ones already taken. */
export function nextFreeSlug(base: string, taken: Iterable<string>) {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Slugs are internal identifiers generated from the name; the admin never types them. */
export async function uniqueSlug(sql: Database, table: "products" | "categories", name: string) {
  const base = slugify(name) || "item";
  const rows = await sql<{ slug: string }[]>`select slug from ${sql(table)} where slug = ${base} or slug like ${`${base}-%`}`;
  return nextFreeSlug(base, rows.map((row) => row.slug));
}
