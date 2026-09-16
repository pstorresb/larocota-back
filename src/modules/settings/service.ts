import type { Database } from "../../db/client.js";
import { settingsSchemas, type PaymentSettings, type PickupSettings, type SettingsKey } from "./schema.js";

type SettingValue<K extends SettingsKey> = K extends "payment" ? PaymentSettings : K extends "pickup" ? PickupSettings : never;

/** Reads one setting and normalizes it through its schema, so missing fields get defaults. */
export async function getSetting<K extends SettingsKey>(sql: Database, key: K): Promise<SettingValue<K>> {
  const [row] = await sql<{ value: unknown }[]>`select value from store_settings where key = ${key}`;
  const parsed = settingsSchemas[key].safeParse(row?.value ?? {});
  if (parsed.success) return parsed.data as SettingValue<K>;
  // A stored value that no longer validates (e.g. enabled without a bank) degrades to defaults rather than crashing reads.
  return settingsSchemas[key].parse({}) as SettingValue<K>;
}

export async function getAllSettings(sql: Database) {
  const [payment, pickup] = await Promise.all([getSetting(sql, "payment"), getSetting(sql, "pickup")]);
  return { payment, pickup };
}
