import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { loadEnv } from "../src/config/env.js";
import { createDatabase } from "../src/db/client.js";

try { loadEnvFile(); } catch { /* Environment may be injected by the process manager. */ }

const env = loadEnv();
const sql = createDatabase(env);
const migrationDir = resolve(process.cwd(), "migrations");

try {
  await sql`create table if not exists schema_migrations (filename text primary key, applied_at timestamptz not null default now())`;
  const files = (await readdir(migrationDir)).filter((file) => file.endsWith(".sql")).sort();
  for (const filename of files) {
    const [applied] = await sql`select 1 from schema_migrations where filename = ${filename}`;
    if (applied) continue;
    const contents = await readFile(resolve(migrationDir, filename), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(contents);
      await tx`insert into schema_migrations (filename) values (${filename})`;
    });
    console.log(`Applied ${filename}`);
  }
} finally {
  await sql.end();
}
