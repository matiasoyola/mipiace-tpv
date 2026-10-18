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
  // clinica-2 · URL pública de la PWA del TPV. Se usa para construir el
  // enlace del test de la valoración (`${PUBLIC_TPV_URL}/valoracion/<token>`),
  // que es lo que el paciente abre desde su email.
  //
  // Apunta a la PWA y no a la API porque el test ES una pantalla: la misma
  // que la tablet de la sala (un solo test, dos puertas). En producción,
  // `https://mipiacetpv.com`; el `try_files` de Caddy ya devuelve el
  // index.html de la PWA para esa ruta, así que no hace falta regla nueva.
  // En dev, el puerto de Vite.
  PUBLIC_TPV_URL: z.string().url().default("http://localhost:5174"),

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

  // ── Releases de la APK (A3-distribución) ───────────────────────────
  // Directorio con los .apk publicados y su índice `releases.json`. Vive
  // FUERA del repo y fuera de la imagen: en producción el compose monta
  // `/opt/mipiacetpv/releases` como `/srv/releases` en read-only. En dev cae
  // al mismo path y, si no existe, los endpoints responden 404 en vez de
  // reventar — un TPV no deja de cobrar porque no haya APKs publicadas.
  RELEASES_DIR: z.string().default("/srv/releases"),

  // ── Capturas de pantalla de terminales (A5 · Frente 4) ─────────────
  // Los PNG viven en disco, no en BD. Volumen propio en el compose, igual que
  // los informes Z. Son fotos de la pantalla de un TPV con datos de clientes:
  // el worker las borra a las DEVICE_SCREENSHOT_TTL_HOURS.
  DEVICE_SCREENSHOT_DIR: z
    .string()
    .default("/var/lib/mipiacetpv/device-screenshots"),
  // Retención declarada. 24 h: si hace falta otra captura, se pide otra.
  DEVICE_SCREENSHOT_TTL_HOURS: z.coerce.number().int().positive().default(24),
  // Tope por captura. Un PNG de 1280×800 de una UI plana ronda los 200 KB;
  // este límite es la red de seguridad, no el objetivo.
  DEVICE_SCREENSHOT_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(2 * 1024 * 1024),

  // ── Ficheros clínicos (clinica-4) ──────────────────────────────────
  //
  // Las fotos de los pies y los PDF de consentimientos e informes. Viven
  // en disco y **no en la base**, por lo mismo que las capturas de A5: un
  // blob por foto en una BD que además cobra no aporta nada, y borrar (o
  // retirar) un fichero es más fácil de demostrar que una fila.
  //
  // Volumen propio en el compose de producción, con el patrón de
  // `z_reports`, y **nunca detrás de Caddy**: no es `product_images`, no
  // se sirve en estático. El binario sale sólo por la API, por
  // `conHistoria`, y cada apertura deja su línea en el registro de
  // accesos. Y la copia de seguridad se lo lleva (`infra/backup-postgres.sh`):
  // una historia cuyas fotos no se pueden recuperar no se conserva cinco
  // años.
  //
  // **Sin TTL, al contrario que las capturas de terminal**: una foto de la
  // historia no caduca a las 24 h. No se borra: se retira.
  CLINICAL_FILES_DIR: z.string().default("/var/lib/mipiacetpv/clinical-files"),
  // Tope por foto. Una foto de una uña a 1600×1200 en JPEG de calidad
  // media ronda los 300 KB; esto es la red de seguridad, no el objetivo.
  CLINICAL_PHOTO_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(4 * 1024 * 1024),
  // residencia-3 (decisión 10) · tope por NOTA DE VOZ de «algo no va
  // bien». WebM/Opus a 24 kbps son ~3 KB por segundo, así que 2 MB son
  // más de diez minutos: es la red de seguridad contra una tablet que se
  // queda grabando en un bolsillo, no el objetivo. La pantalla corta
  // antes, a 60 s.
  CARE_VOICE_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(2 * 1024 * 1024),

  // ── clinica-7 · LA CLAVE MAESTRA DE LO CLÍNICO ─────────────────────
  //
  // `CLINICAL_KEK` envuelve la DEK de cada clínica. Base64 de 32 bytes,
  // AES-256-GCM. **No está en la base y no está en el repo**: si estuviera
  // en la base, una copia filtrada traería la clave con la que se
  // descifra, y todo este bloque no serviría para nada.
  //
  // ── Por qué es OPCIONAL aquí y obligatoria al arrancar ────────────
  //
  // Opcional en el esquema porque la mayoría de los despliegues no tienen
  // ni una clínica: un bar que no la necesita no tiene que inventarse una
  // clave de 32 bytes para que su API arranque, y obligarle habría sido
  // garantizar que alguien pone `AAAA...` y se olvida.
  //
  // Obligatoria **en cuanto exista un tenant clínico**, y eso lo comprueba
  // el arranque (`clinica/arranque.ts`, decisión 17): si hay clínicas y
  // falta la KEK —o la KEK no descifra la fila canario— **la API no
  // arranca** y lo dice en el log. Fallar al arrancar es mejor que escribir
  // algo que después no se puede leer.
  //
  // Generar: `node scripts/generar-claves-clinicas.mjs`.
  CLINICAL_KEK: z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    z
      .string()
      .refine(
        (s) => {
          try {
            return Buffer.from(s, "base64").length === 32;
          } catch {
            return false;
          }
        },
        {
          message:
            "CLINICAL_KEK debe ser base64 de 32 bytes. " +
            "Generar con: node scripts/generar-claves-clinicas.mjs",
        },
      )
      .optional(),
  ),
  // QUÉ KEK es ésta. Va en cada fila de `clinical_tenant_keys`, y es lo que
  // permite rotar: mientras el script de re-envoltura corre, conviven filas
  // envueltas con la vieja y con la nueva, y cada una dice cuál es la suya.
  // Sin el id habría que probar las dos a ciegas, y «probar claves» es
  // justo lo que no se hace con claves.
  CLINICAL_KEK_ID: z.string().min(1).max(40).default("kek-1"),

  // ── Sentry (v1.5-consistencia-B · Lote 2) ──────────────────────────
  // Sin DSN, Sentry queda en no-op absoluto (initSentry no llama init).
  // Compose interpola `""` cuando la var no está en .env.production —
  // mismo preprocess que SMTP_PORT para tratarla como ausente.
  SENTRY_DSN: z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    z.string().url().optional(),
  ),
  // Release reportado a Sentry. El compose lo fija a IMAGE_TAG (sha
  // corto del build publicado en GHCR). Opcional: sin él, los eventos
  // van sin release.
  SENTRY_RELEASE: z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    z.string().min(1).optional(),
  ),

  // ── Conciliación diaria TPV↔Holded (v1.5-consistencia-B · Lote 4) ──
  // Hora local (Europe/Madrid) a la que corre el job diario.
  RECONCILIATION_HOUR: z.coerce.number().int().min(0).max(23).default(7),

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
  SUPER_ADMIN_FROM_EMAIL: z.string().default("noreply@mipiacetpv.com"),
  SUPER_ADMIN_REPLY_TO_EMAIL: z.string().default("soporte@mipiacetpv.com"),
});

export type AppEnv = z.infer<typeof EnvSchema>;

let cached: AppEnv | null = null;
export function loadEnv(): AppEnv {
  if (cached) return cached;
  cached = EnvSchema.parse(process.env);
  return cached;
}

/**
 * Olvida el entorno leído. **Para los tests y nada más.**
 *
 * Lo pide clinica-7: los casos del arranque (decisión 17) son «hay
 * clínicas y FALTA la KEK», «hay clínicas y la KEK es de otro entorno»…, y
 * cada uno es un `process.env` distinto. Con la caché de una sola lectura,
 * el segundo caso de un fichero de test corre con el entorno del primero y
 * el test pasa sin probar nada.
 *
 * Lo encontró justamente eso: cuatro casos del arranque y de la rotación
 * salían verdes porque `delete process.env.CLINICAL_KEK` no tenía ningún
 * efecto después de la primera llamada.
 *
 * No se llama desde `src/`: la caché existe porque leer y validar el
 * entorno en cada petición sería tirar CPU, y en producción el entorno no
 * cambia sin reiniciar.
 */
export function olvidarEnv(): void {
  cached = null;
}
