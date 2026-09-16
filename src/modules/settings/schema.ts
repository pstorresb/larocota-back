import { z } from "zod";

export const paymentSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  bankName: z.string().trim().max(80).default(""),
  accountType: z.string().trim().max(60).default("Cuenta de ahorros"),
  accountNumber: z.string().trim().max(40).default(""),
  holderName: z.string().trim().max(120).default(""),
  // Cédula or RUC of the holder. Kept admin-only: never returned by the public endpoint.
  holderIdentifier: z.string().trim().max(40).default(""),
  instructions: z.string().trim().max(600).default(""),
}).superRefine((value, context) => {
  if (!value.enabled) return;
  if (!value.bankName) context.addIssue({ code: "custom", path: ["bankName"], message: "Indica el banco." });
  if (!value.accountNumber) context.addIssue({ code: "custom", path: ["accountNumber"], message: "Indica el número de cuenta." });
  if (!value.holderName) context.addIssue({ code: "custom", path: ["holderName"], message: "Indica el titular de la cuenta." });
});

export const pickupSettingsSchema = z.object({
  addressLine: z.string().trim().max(300).default(""),
  reference: z.string().trim().max(300).default(""),
  hours: z.string().trim().max(200).default(""),
  mapUrl: z.union([z.string().trim().url().max(500), z.literal("")]).default(""),
  instructions: z.string().trim().max(600).default(""),
});

export const settingsSchemas = {
  payment: paymentSettingsSchema,
  pickup: pickupSettingsSchema,
} as const;

export type SettingsKey = keyof typeof settingsSchemas;
export type PaymentSettings = z.infer<typeof paymentSettingsSchema>;
export type PickupSettings = z.infer<typeof pickupSettingsSchema>;

export const settingsKeys = Object.keys(settingsSchemas) as SettingsKey[];

export function isSettingsKey(value: string): value is SettingsKey {
  return Object.hasOwn(settingsSchemas, value);
}

/** Public projection: what the storefront and customers may see. */
export function publicPaymentSettings(value: PaymentSettings) {
  if (!value.enabled) return null;
  const { holderIdentifier: _hidden, enabled: _enabled, ...rest } = value;
  return rest;
}

export function publicPickupSettings(value: PickupSettings) {
  return value.addressLine ? value : null;
}
