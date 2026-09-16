import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().url().default("postgres://larocota:change-me@127.0.0.1:5432/larocota"),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:3000"),
  // Behind nginx the client IP arrives in X-Forwarded-For. Without this every rate limit is shared by all users.
  TRUST_PROXY: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  SESSION_COOKIE_NAME: z.string().min(3).default("larocota_session"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  UPLOAD_DIR: z.string().default("./media"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(8_388_608),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  // Hours a customer has to upload a payment proof before the order is cancelled and its stock released.
  PAYMENT_WINDOW_HOURS: z.coerce.number().positive().default(24),
  // Seconds between maintenance runs (cycle open/close, expired reservations, purge). 0 disables the job.
  MAINTENANCE_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(60),
  GOOGLE_CLIENT_ID: z.string().min(10).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(10).optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  RESEND_API_KEY: z.string().min(10).optional(),
  EMAIL_FROM: z.string().min(3).default("La Rocota <cuenta@larocota.com>"),
});

export type AppEnv = z.infer<typeof schema>;

const requiredInProduction = ["DATABASE_URL", "FRONTEND_ORIGIN"] as const;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  const env = schema.parse(input);
  if (env.NODE_ENV === "production") {
    const missing = requiredInProduction.filter((key) => !input[key]);
    if (missing.length > 0) throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  }
  return env;
}
