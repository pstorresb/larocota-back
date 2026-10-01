import { describe, expect, it } from "vitest";
import { categoryUpdateSchema, productUpdateSchema } from "../src/modules/admin/routes.js";
import { nextFreeSlug, slugify } from "../src/common/slug.js";

describe("admin update schemas", () => {
  it("parses a partial product update without inventing values for omitted fields", () => {
    const parsed = productUpdateSchema.safeParse({ name: "Ensalada César" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual({ name: "Ensalada César" });
  });

  it("parses a partial category update the same way and rejects an empty one", () => {
    const parsed = categoryUpdateSchema.safeParse({ isActive: false });
    expect(parsed.success && parsed.data).toEqual({ isActive: false });
    expect(categoryUpdateSchema.safeParse({}).success).toBe(false);
    expect(productUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("rejects prices and tax rates that Postgres would round silently", () => {
    expect(productUpdateSchema.safeParse({ basePrice: 7.5 }).success).toBe(true);
    expect(productUpdateSchema.safeParse({ basePrice: 7.555 }).success).toBe(false);
    expect(productUpdateSchema.safeParse({ taxRate: 0.15 }).success).toBe(true);
    expect(productUpdateSchema.safeParse({ taxRate: 0.123456 }).success).toBe(false);
  });

  it("no longer accepts client-supplied slugs or sort order", () => {
    const parsed = productUpdateSchema.safeParse({ name: "Quesadilla", slug: "x", sortOrder: 3 });
    expect(parsed.success && parsed.data).toEqual({ name: "Quesadilla" });
  });
});

describe("slugs", () => {
  it("builds an ascii slug from a Spanish name", () => {
    expect(slugify("Sánduche Jamón & Queso")).toBe("sanduche-jamon-queso");
    expect(slugify("  ¡¡Ñoquis!!  ")).toBe("noquis");
    expect(slugify("!!!")).toBe("");
  });

  it("finds the first free suffix when the name repeats", () => {
    expect(nextFreeSlug("ensalada", [])).toBe("ensalada");
    expect(nextFreeSlug("ensalada", ["ensalada"])).toBe("ensalada-2");
    expect(nextFreeSlug("ensalada", ["ensalada", "ensalada-2", "ensalada-especial"])).toBe("ensalada-3");
  });
});
