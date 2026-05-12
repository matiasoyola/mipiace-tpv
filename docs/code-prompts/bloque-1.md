# Prompt para Claude Code — Bloque 1

Pega esto en Claude Code dentro de la carpeta del proyecto.

---

Hola Code. Arrancamos la Fase 1 del TPV mipiace. La Fase 0 (spike) está
cerrada y commiteada (fb8c4ab). Toda la documentación de diseño está en
`docs/`. Antes de tocar código, **lee en este orden y resume lo que
entiendes**:

1. `docs/07-nucleo-comun.md` — contrato funcional del núcleo (es tu fuente
   principal).
2. `docs/01-spec-funcional.md` — spec funcional general.
3. `docs/03-integracion-holded.md` — payload definitivo `salesreceipt`,
   endpoints, autenticación.
4. `docs/04-stack-y-decisiones.md` — ADRs (lee con atención ADR-010
   sobre GET-back tras escritura).
5. `docs/06-modelo-datos.md` — boceto del modelo de datos.
6. `docs/spike-holded.md` — hallazgos del spike, peculiaridades de la API
   de Holded.
7. `packages/holded-client/` — cliente Holded que escribimos en el spike,
   con tipado y `HoldedSilentRejectError`, `HoldedInvalidResponseError`.

Cuando lo tengas claro, pídeme luz verde para empezar Bloque 1.

## Bloque 1 · Base multi-tenant + onboarding del propietario

### Alcance

- Setup del monorepo definitivo:
  - `apps/api` (Fastify + TypeScript), reusa server.ts del super-mini-MVP
    como punto de partida.
  - `apps/admin` (React + Vite) — pantalla de onboarding y gestión.
  - `apps/tpv-web` (React + Vite + vite-plugin-pwa) — esqueleto, sin venta
    todavía.
  - `packages/holded-client` ya existe; integrarlo como dependencia.
  - `packages/db` con Prisma.
- Postgres y Redis vía `docker-compose.yml` en raíz.
- **Prisma schema** que materialice `docs/06-modelo-datos.md` para las
  tablas: `tenant`, `user`, `store`, `register`, `device`, `pairing_code`,
  `product`, `product_variant`, `warehouse`, `holded_upload` (idempotencia).
  El resto (`ticket`, `shift`, etc.) los modelas en su bloque.
- Autenticación de propietario: email + contraseña (argon2id), JWT corto +
  refresh.
- **Endpoint de onboarding** `POST /onboarding/connect-holded`:
  - Valida API Key llamando `GET /products?limit=1`.
  - Cifra la key con AES-GCM usando variable de entorno
    `HOLDED_KEY_ENCRYPTION_SECRET`.
  - Persiste en `tenant.holded_api_key_encrypted`.
- **Sync inicial** (job BullMQ disparado tras conectar Holded):
  - Datos fiscales del negocio.
  - Tipos de IVA en uso.
  - Almacenes (`warehouses`).
  - Series de facturación (`numSerieId`).
  - **Catálogo completo (productos Y servicios) + variantes + precios +
    stock**, filtrando `forSale != 0`. Estándar para todos los tenants
    (no es flag opcional). Diferenciar con `product.kind ∈ {PRODUCT,
    SERVICE}`. Si Holded los expone en endpoints distintos (`/products`
    vs `/services`), la abstracción vive dentro de
    `packages/holded-client/`. Ver `docs/07-nucleo-comun.md` §2.4.
- **Script auto-SKU** (`docs/07-nucleo-comun.md` §2.5):
  - Detecta productos **y servicios** con `sku` vacío/nulo (aplica
    indistintamente a `kind=PRODUCT` y `kind=SERVICE`).
  - Asigna `AUTO-{primeros-8-chars-del-holded-id}`.
  - `PUT /products/{id}` con throttle ~5 req/s.
  - GET-back para validar.
  - Casos donde Holded silencia el cambio → marcar en bandeja de revisión.
  - Idempotente al re-ejecutarse.
- **Creación de comodines de línea libre** (§2.6):
  - `TPV-OTROS-21`, `TPV-OTROS-10`, `TPV-OTROS-4`, `TPV-OTROS-0`.
  - Sólo crea los tipos de IVA que use el tenant.
  - Reutiliza si ya existen con ese SKU.
- UI admin mínima:
  - Login propietario.
  - Pantalla "Conecta tu Holded" (pegar API Key).
  - Pantalla "Sync en progreso" con barra y mensajes.
  - Pantalla "Resumen del sync inicial": X productos, Y variantes, Z
    contactos, W productos sin SKU corregidos automáticamente, V quedaron
    en revisión.

### Restricciones

- TypeScript estricto en todo (`strict: true`).
- JSON Schema en todas las rutas Fastify.
- Tests unitarios mínimos del cliente Holded ya están — añade tests del
  endpoint de onboarding y del script auto-SKU contra un mock del cliente.
- **Nada de pegar la API Key en logs, ni siquiera el primer carácter.**
- Migrations Prisma versionadas (`prisma migrate dev`).

### Entregables

1. PR único con todo el Bloque 1.
2. Commit messages descriptivos.
3. README de cada `apps/*` con cómo arrancar local.
4. `.env.example` con todas las variables nuevas.
5. Cuando termines, escribe un resumen breve (`docs/blocks/B1-done.md`) con
   lo que dejaste hecho, lo que queda fuera, y posibles dudas/decisiones
   para Matías antes de pasar a B2.

### Lo que NO entra en B1

- Sync incremental (sólo el inicial).
- Webhooks de Holded.
- Device pairing, login cajero, turnos → todo eso es B3.
- Venta, cobro, impresión → bloques posteriores.

Cuando acabes B1 y yo lo revise, te paso el prompt de B2.
