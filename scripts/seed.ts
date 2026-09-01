import { hash } from "@node-rs/argon2";
import { z } from "zod";
import { loadEnvFile } from "node:process";
import { loadEnv } from "../src/config/env.js";
import { createDatabase } from "../src/db/client.js";

try { loadEnvFile(); } catch { /* Environment may be injected by the process manager. */ }

const seedEnv = z.object({ SEED_SUPERADMIN_EMAIL: z.string().email(), SEED_SUPERADMIN_PASSWORD: z.string().min(14) }).parse(process.env);
const sql = createDatabase(loadEnv());

try {
  const passwordHash = await hash(seedEnv.SEED_SUPERADMIN_PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  await sql`
    insert into users (email, password_hash, first_name, last_name, role)
    values (${seedEnv.SEED_SUPERADMIN_EMAIL.toLowerCase()}, ${passwordHash}, 'Administrador', 'La Rocota', 'superadmin')
    on conflict (email) do update set password_hash = excluded.password_hash, role = 'superadmin', status = 'active'
  `;
  console.log("Superadministrator seed completed. Business data remains empty.");
} finally {
  await sql.end();
}
