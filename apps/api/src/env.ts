import { z } from "zod";

// Variables de entorno consumidas por apps/api y workers. Cualquier
// variable nueva pasa primero por aquí; el resto del código sólo importa
// `env`, nunca `process.env` directamente.

export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // ── Base de datos / Redis ──────────────────────────────────────────
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // ── HTTP ───────────────────────────────────────────────────────────
  PORT: z.coerce.number().int().positive().default(3001),
  // En desarrollo, Fastify escucha sólo en loopback (127.0.0.1) para no
  // exponer el API en la LAN. En producción Docker hay que ponerlo a
  // 0.0.0.0 (vía env del compose) para que Caddy lo alcance dentro del
  // bridge network. Hotfix post-deploy 2026-05-18.
  HOST: z.string().default("127.0.0.1"),
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
  // TTL del refresh por defecto. Se usa cuando el propietario hace
  // login SIN marcar "Recuérdame": la sesión sobrevive cierres de
  // pestaña sólo si el cliente lo guarda en localStorage; con el
  // default (sessionStorage) se pierde al cerrar pestaña.
  JWT_REFRESH_TTL: z.string().default("30d"),
  // TTL del refresh cuando el propietario marca "Recuérdame en este
  // dispositivo" en el login. El front guarda el refresh en
  // localStorage en lugar de sessionStorage y respeta este TTL.
  JWT_REFRESH_TTL_REMEMBER: z.string().default("90d"),

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

  // ── Email (B3 §17.4 + §17.6) ───────────────────────────────────────
  // SMTP del remitente de avisos del propietario (nuevo dispositivo,
  // password reset). En NODE_ENV=development se aceptan vacíos y el
  // EmailSender cae al ConsoleEmailSender (log a stdout).
  SMTP_HOST: z.string().optional(),
  // Docker Compose interpola `${SMTP_PORT}` como string vacío cuando la
  // var no está definida en el `.env.production`. Zod `.coerce.number()`
  // convierte `""` a `0`, que falla `.positive()` → API no arranca. El
  // preprocess normaliza `""` a `undefined` antes de la coerción.
  // Hotfix post-deploy 2026-05-18.
  SMTP_PORT: z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    z.coerce.number().int().positive().optional(),
  ),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  // URL pública del admin. Se usa para construir el link del email de
  // password reset (`${PUBLIC_ADMIN_URL}/admin/reset?token=…`).
  PUBLIC_ADMIN_URL: z.string().url().default("http://localhost:5173"),
  // URL pública del backend para los enlaces de ticket digital
  // (`${PUBLIC_TICKET_URL}/tickets/{slug}/pdf`). En dev apunta a la
  // API local; en prod, al dominio expuesto detrás del proxy.
  // B-Print fase 1.
  PUBLIC_TICKET_URL: z.string().url().default("http://localhost:3001"),

  // Base URL de la API de Holded. Lo usan los clientes ApiKeyClient
  // creados desde tenants reales (cifrado por tenant).
  HOLDED_BASE_URL: z.string().url().default("https://api.holded.com/api"),

  // ── Cache local de imágenes de producto (B-ProductImages) ──────────
  // Directorio compartido con Caddy vía volumen Docker. En dev cae al
  // tmpdir del SO; en producción el compose lo monta a
  // `/var/cache/mipiacetpv/product-images` y Caddy lo expone bajo
  // `/product-images/*` (read-only).
  PRODUCT_IMAGE_CACHE_DIR: z
    .string()
    .default("/var/cache/mipiacetpv/product-images"),
  // Tamaño máximo aceptado por imagen (bytes). Holded raramente sirve
  // más de 1-2 MB pero defensivo: superar este límite → log + skip.
  PRODUCT_IMAGE_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 1024 * 1024),

  // ── Super-admin (B-SuperAdmin) ─────────────────────────────────────
  // JWT secret separado del per-tenant — un compromiso de uno NO da
  // acceso al otro. 40+ chars, generar con `openssl rand -base64 48`.
  // En dev/test va un placeholder; producción debe setearlo (el server
  // arroja al arrancar si NODE_ENV=production y mantiene el placeholder).
  SUPER_ADMIN_JWT_SECRET: z
    .string()
    .min(40)
    .default(
      "dev-only-super-admin-secret-replace-in-production-with-openssl-rand-base64-48",
    ),
  SUPER_ADMIN_ACCESS_TTL: z.string().default("15m"),
  SUPER_ADMIN_REFRESH_TTL: z.string().default("12h"),
  // TTL del JWT de impersonación. Sin refresh — al caducar, abrir de nuevo.
  SUPER_ADMIN_IMPERSONATION_TTL: z.string().default("30m"),
  // Remitente / reply-to del email de bienvenida al OWNER de un tenant
  // nuevo creado desde la consola super-admin.
  SUPER_ADMIN_FROM_EMAIL: z.string().default("noreply@mipiacetpv.tech"),
  SUPER_ADMIN_REPLY_TO_EMAIL: z.string().default("soporte@mipiacetpv.tech"),
});

export type AppEnv = z.infer<typeof EnvSchema>;

let cached: AppEnv | null = null;
export function loadEnv(): AppEnv {
  if (cached) return cached;
  cached = EnvSchema.parse(process.env);
  return cached;
}
