import { describe, expect, it } from "vitest";
import { isSettingsKey, paymentSettingsSchema, pickupSettingsSchema, publicPaymentSettings, publicPickupSettings } from "../src/modules/settings/schema.js";

describe("payment settings", () => {
  it("rejects inherited object properties as setting names", () => {
    expect(isSettingsKey("constructor")).toBe(false);
    expect(isSettingsKey("__proto__")).toBe(false);
    expect(isSettingsKey("payment")).toBe(true);
  });
  it("accepts an empty, disabled configuration", () => {
    const parsed = paymentSettingsSchema.parse({});
    expect(parsed.enabled).toBe(false);
    expect(publicPaymentSettings(parsed)).toBeNull();
  });

  it("requires bank, account number and holder when enabled", () => {
    const result = paymentSettingsSchema.safeParse({ enabled: true, bankName: "Banco Pichincha" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("accountNumber");
      expect(paths).toContain("holderName");
    }
  });

  it("never exposes the holder identifier publicly", () => {
    const parsed = paymentSettingsSchema.parse({ enabled: true, bankName: "Banco Pichincha", accountNumber: "2200123456", holderName: "La Rocota", holderIdentifier: "1001234567" });
    const publicView = publicPaymentSettings(parsed);
    expect(publicView).not.toBeNull();
    expect(publicView).not.toHaveProperty("holderIdentifier");
    expect(publicView).not.toHaveProperty("enabled");
    expect(publicView?.accountNumber).toBe("2200123456");
  });
});

describe("pickup settings", () => {
  it("is hidden from the storefront until an address exists", () => {
    expect(publicPickupSettings(pickupSettingsSchema.parse({}))).toBeNull();
    expect(publicPickupSettings(pickupSettingsSchema.parse({ addressLine: "Av. Mariano Acosta 12-34" }))).not.toBeNull();
  });

  it("rejects a map link that is not a URL", () => {
    expect(pickupSettingsSchema.safeParse({ mapUrl: "no-es-url" }).success).toBe(false);
    expect(pickupSettingsSchema.safeParse({ mapUrl: "" }).success).toBe(true);
  });
});
