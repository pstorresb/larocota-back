// One-off maintenance run (cycle open/close, expired reservations, purge). The API runs the same job on an interval.
import { loadEnvFile } from "node:process";
import { loadEnv } from "../src/config/env.js";
import { createDatabase } from "../src/db/client.js";
import { runMaintenance } from "../src/jobs/maintenance.js";

try { loadEnvFile(); } catch { /* Environment may be injected by the process manager. */ }

const env = loadEnv();
const sql = createDatabase(env);
try {
  const report = await runMaintenance(sql, env, { info: (obj, msg) => console.log(msg ?? "", JSON.stringify(obj)), warn: (obj, msg) => console.warn(msg ?? "", JSON.stringify(obj)), error: (obj, msg) => console.error(msg ?? "", JSON.stringify(obj)) });
  console.log(`Maintenance completed: ${JSON.stringify(report)}`);
} finally {
  await sql.end();
}
