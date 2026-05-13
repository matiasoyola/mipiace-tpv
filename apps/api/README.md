# `apps/api`

Fastify + TypeScript. Backend del TPV: auth del propietario, onboarding de
Holded, workers BullMQ (sync inicial/incremental, upload de tickets,
upload de refunds, email de PDF), endpoints de cajeros/turnos/ventas y
bandeja de errores de sync con Holded.

## Arrancar en local

1. Copia `.env.example` (en la raíz del repo) a `.env` y rellena las
   secrets que necesitas:

   ```
   # Genera los tres con:
   openssl rand -base64 48                            # JWT_*_SECRET
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
                                                       # HOLDED_KEY_ENCRYPTION_SECRET
   ```

2. Levanta Postgres y Redis con Docker Compose:

   ```bash
   docker compose up -d postgres redis
   ```

3. Aplica el schema Prisma:

   ```bash
   pnpm db:migrate
   ```

   (La primera vez, te pedirá un nombre para la migración inicial. Llámala
   `init`.)

4. Arranca el server:

   ```bash
   pnpm --filter @mipiacetpv/api dev
   ```

   - Por defecto escucha en `http://127.0.0.1:3001`.
   - En `NODE_ENV !== "production"` arranca también el worker
     `initial-sync` en el mismo proceso. En prod arrancas el worker
     aparte con `pnpm --filter @mipiacetpv/api worker:dev`.

## Endpoints

### Auth

- `POST /auth/signup` `{ businessName, email, password }` → 201 con
  `{ accessToken, refreshToken }`. Crea Tenant + User OWNER.
- `POST /auth/login` `{ email, password }` → `{ accessToken, refreshToken }`.
- `POST /auth/refresh` `{ refreshToken }` → nuevo par.
- `GET /auth/me` (Bearer access) → `{ user, tenant }`.

### Onboarding (requiere OWNER)

- `POST /onboarding/connect-holded` `{ apiKey }` → valida la key contra
  Holded, cifra (AES-256-GCM) y persiste; encola el sync inicial.
  Mapeo de errores: 401 (Holded rechaza key), 402 (cuenta suspendida),
  502 (Holded respondió HTML / inalcanzable), 503 (Redis no responde).
- `GET /onboarding/sync-status` → estado del sync + stats.

## Tests

```bash
pnpm --filter @mipiacetpv/api test
```

Cubre:

- `crypto.ts` — round-trip AES-GCM + claves erróneas.
- `auto-sku.ts` — happy path, GET-back silencioso, errores HTTP,
  idempotencia, throttle.
- `onboarding-route.ts` — endpoint completo con Fastify inject + Prisma
  fake + mock de `@mipiacetpv/holded-client`.

## Notas de seguridad

- **No loguear la API Key** del propietario, ni siquiera el primer
  carácter. El logger raíz redacta `req.body.apiKey` y
  `req.body.password`; en logs custom seguir el patrón
  `apiKey: "<REDACTED>"`.
- La key se cifra con `HOLDED_KEY_ENCRYPTION_SECRET`. Si la pierdes,
  los tenants no podrán sincronizar — guardar fuera del repo y
  versionar fuera del backup operacional.
- Los JWT son simétricos. Rotar `JWT_*_SECRET` invalida todas las
  sesiones — preferir corto TTL + refresh.

## Auto-SKU CLI

Para re-ejecutar el script auto-SKU sobre un tenant concreto (p.ej. tras
arreglar manualmente productos en revisión):

```bash
pnpm --filter @mipiacetpv/api autosku -- <tenantId>
```
