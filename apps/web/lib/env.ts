import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),
  REDIS_URL: z.string().url("REDIS_URL must be a valid URL").optional(),
  ENCRYPTION_KEY: z
    .string()
    .min(32, "ENCRYPTION_KEY must be at least 32 characters"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  AUTHELIA_USER_HEADER: z.string().default("Remote-User"),
  AUTHELIA_NAME_HEADER: z.string().default("Remote-Name"),
  AUTHELIA_GROUPS_HEADER: z.string().default("Remote-Groups"),
  // OIDC — optional; bearer-token auth on /api/v1 is disabled when
  // DISHES_OIDC_ISSUER is absent, and the app stays proxy-headers-only. Set this to your Authelia
  // root URL (it must serve /.well-known/openid-configuration).
  DISHES_OIDC_ISSUER: z.string().url().optional(),
  DISHES_OIDC_CLIENT_ID: z.string().optional(),
  DISHES_OIDC_USERINFO_CACHE_SECONDS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(60),
  // S3 / MinIO — optional; image upload is disabled when absent
  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_PUBLIC_URL: z.string().url().optional(),
});

type Env = z.infer<typeof envSchema>;

let _env: Env | undefined;

function validateEnv(): Env {
  if (_env) return _env;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${missing}`);
  }
  _env = result.data;
  return _env;
}

// Lazy proxy — safe to import at build time; throws only when env vars are
// actually read (i.e. during request handling, not static analysis).
export const env = new Proxy({} as Env, {
  get(_, prop) {
    return validateEnv()[prop as keyof Env];
  },
});
