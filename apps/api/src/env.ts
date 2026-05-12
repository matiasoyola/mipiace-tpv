import { z } from "zod";

// Variables de entorno consumidas por apps/api y workers. Cualquier
// variable nueva pasa primero por aquí; el resto del código sólo importa
// `env`, nunca `process.env` directamente.

const Schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // ── Base de datos / Redis ──────────────────────────────────────────
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // ── HTTP ───────────────────────────────────────────────────────────
  PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173,http://localhost:5174,http://localhost:5175")
    .transform((s) =>
      s
        .split(",")
        .map((o) => o.trim())
        .filter((o) => o.length > 0),
    ),

  // ── JWT ────────────────────────────────────────────────────────────
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),

  // ── Cifrado de API Keys de Holded ─────────────────────────────────
  // Base64 de 32 bytes. AES-256-GCM.
  HOLDED_KEY_ENCRYPTION_SECRET: z.string().refine(
    (s) => {
      try {
        return Buffer.from(s, "base64").length === 32;
      } catch {
        return false;
      }
    },
    {
      message:
        "HOLDED_KEY_ENCRYPTION_SECRET debe ser base64 de 32 bytes. " +
        'Generar con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    },
  ),

  // ── Spike legacy (apps/tpv-web-spike) ─────────────────────────────
  // Opcionales. Si están presentes el server expone /products y
  // /tickets bajo el modo single-tenant single-key.
  HOLDED_API_KEY: z.string().optional(),
  HOLDED_BASE_URL: z.string().url().default("https://api.holded.com/api"),
});

export type AppEnv = z.infer<typeof Schema>;

let cached: AppEnv | null = null;
export function loadEnv(): AppEnv {
  if (cached) return cached;
  cached = Schema.parse(process.env);
  return cached;
}
