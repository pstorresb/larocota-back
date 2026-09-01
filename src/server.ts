import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { loadEnvFile } from "node:process";

try { loadEnvFile(); } catch { /* Environment may be injected by the process manager. */ }

const env = loadEnv();
const app = await buildApp(env);

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
