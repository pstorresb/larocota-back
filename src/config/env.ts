import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().url().default("postgres://larocota:change-me@127.0.0.1:5432/larocota"),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:3000"),
  SESSION_COOKIE_NAME: z.string().min(3).default("larocota_session"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  UPLOAD_DIR: z.string().default("./media"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(8_388_608),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  GOOGLE_CLIENT_ID: z.string().min(10).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(10).optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
});

export type AppEnv = z.infer<typeof schema>;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  return schema.parse(input);
}
