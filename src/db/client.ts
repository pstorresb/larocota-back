import postgres from "postgres";
import type { AppEnv } from "../config/env.js";

export type Database = ReturnType<typeof postgres>;

export function createDatabase(env: AppEnv): Database {
  return postgres(env.DATABASE_URL, {
    max: env.NODE_ENV === "test" ? 2 : 10,
    idle_timeout: 20,
    connect_timeout: 5,
    transform: postgres.camel,
  });
}
