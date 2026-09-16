import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { startMaintenanceJob } from "./jobs/maintenance.js";
import { loadEnvFile } from "node:process";

try { loadEnvFile(); } catch { /* Environment may be injected by the process manager. */ }

const env = loadEnv();
const app = await buildApp(env);
const stopMaintenance = startMaintenanceJob(app.sql, env, app.log);

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down");
  stopMaintenance();
  const forceExit = setTimeout(() => { app.log.error("forced exit after shutdown timeout"); process.exit(1); }, 10_000);
  forceExit.unref();
  try {
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
