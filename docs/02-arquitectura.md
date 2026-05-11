# 02 · Arquitectura técnica

## 1. Vista de alto nivel

```
┌──────────────────────────┐        ┌──────────────────────────────┐
│  Navegador del cajero    │        │       VPS Hostinger          │
│  (Chromium / PWA)        │        │                              │
│                          │        │  ┌────────────────────────┐  │
│  React + Vite            │◀──────▶│  │   API (Node/Fastify)   │  │
│  IndexedDB (catálogo,    │  HTTPS │  │   - OAuth Holded       │  │
│  tickets en cola)        │        │  │   - Tenants, usuarios  │  │
│  Service Worker (PWA)    │        │  │   - Tickets, turnos    │  │
│                          │        │  │   - Cola outbox        │  │
│  Print agent local       │        │  └──────────┬─────────────┘  │
│  (Node, escucha en       │        │             │                │
│   localhost:9100)        │        │  ┌──────────▼─────────────┐  │
│      │                   │        │  │   PostgreSQL           │  │
│      ▼                   │        │  └────────────────────────┘  │
│  Impresora ESC/POS       │        │  ┌────────────────────────┐  │
│  Cajón                   │        │  │   Worker de sync       │  │
│  Lector barcode (HID)    │        │  │   (Node, BullMQ)       │  │
└──────────────────────────┘        │  └──────────┬─────────────┘  │
                                    └─────────────┼────────────────┘
                                                  │ HTTPS
                                                  ▼
                                       ┌─────────────────────┐
                                       │   Holded API        │
                                       │   api.holded.com    │
                                       └─────────────────────┘
```

## 2. Componentes

### 2.1 Frontend del TPV (PWA)

- **React 18 + Vite + TypeScript.**
- **TanStack Query** para el estado servidor y caché.
- **Zustand** para el estado del ticket en curso (líneas, descuentos, pagos).
- **Dexie.js** como wrapper sobre IndexedDB para:
  - `catalog` (productos, variantes, precios, stock, barcodes).
  - `tickets_pending` (tickets cobrados aún no sincronizados).
  - `tickets_synced` (últimos N días, para devoluciones offline).
  - `session` (datos del turno actual).
- **Service Worker** registrado por Vite-PWA → app instalable, opera sin red.
- **UI táctil:** botones grandes, atajos de teclado (`F1` cliente, `F2` desc.,
  `F12` cobrar). Tema oscuro/claro.

### 2.2 Backend API

- **Node 20 + Fastify + TypeScript.** Rutas REST + JSON Schema.
- **Prisma** como ORM sobre PostgreSQL.
- **JWT** para sesión de usuario del TPV (rotación de access + refresh).
- **OAuth client** contra Holded (state, PKCE, almacenamiento cifrado de
  tokens por tenant).
- **Rate limiting** por tenant para no quemar la cuota de Holded.

### 2.3 Worker de sincronización

- Proceso separado, mismo repo, comparte Prisma.
- **BullMQ** sobre Redis para la cola de jobs.
- Jobs:
  - `holded.uploadTicket(ticketId)` — sube un `salesreceipt`.
  - `holded.uploadRefund(refundId)` — sube un abono.
  - `holded.catalogSync(tenantId, mode)` — full o incremental.
  - `holded.refreshToken(tenantId)`.
- Estrategia de reintento: exponencial 30s, 2m, 10m, 1h, 6h, 24h.
- Después de 24h marcado `SYNC_FAILED` y notificación al propietario.

### 2.4 Agente de impresión local

Imprimir ESC/POS desde un navegador es problemático (WebUSB es frágil, no
soporta red, requiere permisos por dispositivo). Solución:

- Pequeño **daemon Node** (`tpv-print-agent`) que el cliente instala en cada
  caja (Windows, .exe firmado).
- Escucha en `http://localhost:9100`. La PWA le envía POST con el JSON del
  ticket; el agente compone los comandos ESC/POS y los manda a la impresora
  (USB o IP). También dispara el cajón.
- Comunicación TPV ↔ agente: por `fetch` a `localhost`. Si no responde, la
  PWA enseña aviso y permite seguir vendiendo sin imprimir.

## 3. Multi-tenant

- **Aislamiento por fila** con `tenant_id` en cada tabla.
- Middleware en API que extrae el `tenant_id` del JWT y lo inyecta en todas
  las consultas Prisma vía *extension*.
- Tokens de Holded cifrados con AES-GCM, clave maestra en variable de
  entorno del VPS.
- Subdominio por tenant opcional (`acme.tpv.tudominio.com`) pero no
  imprescindible para MVP — basta con login.

## 4. Modo offline · contrato

- **Operaciones que deben funcionar offline:**
  - Buscar productos (catálogo local).
  - Crear y cobrar ticket (sólo efectivo y registro manual de tarjeta).
  - Imprimir (el agente es local, no necesita red).
  - Devolución de ticket de los últimos N días si está en `tickets_synced`.

- **Operaciones que requieren conexión:**
  - Login inicial / cambio de turno (refresca JWT).
  - Sync de catálogo.
  - Volcado a Holded.
  - Cierre de caja con health-check (avisa pero permite cerrar).

- **Reconciliación al volver la red:**
  - El SW detecta `online` → dispara cola local → POST batch al backend.
  - Backend encola jobs en BullMQ → suben a Holded uno a uno.
  - Cada ticket lleva su `externalId` (UUID generado al cobrar) → idempotente.

## 5. Despliegue en Hostinger VPS

Asumimos VPS Ubuntu 22.04 con Docker.

```
docker compose up -d
```

Servicios:
- `api` (Node Fastify)
- `worker` (Node BullMQ)
- `postgres` (con backup diario a S3-compatible o a disco)
- `redis`
- `caddy` (reverse proxy + Let's Encrypt automático)

Variables de entorno clave:
- `HOLDED_OAUTH_CLIENT_ID`, `HOLDED_OAUTH_CLIENT_SECRET`, `HOLDED_OAUTH_REDIRECT_URI`
- `DATABASE_URL`, `REDIS_URL`
- `MASTER_ENCRYPTION_KEY` (32 bytes base64)
- `JWT_SECRET`
- `PUBLIC_URL`

## 6. Observabilidad

- Logs estructurados JSON (Pino).
- **Sentry** para errores en front y back.
- Métricas Prometheus expuestas en `/metrics` (cola, latencias a Holded,
  errores 4xx/5xx por tenant).
- Dashboard mínimo: tickets/día por tenant, % sincronizados, % fallidos.

## 7. Seguridad

- HTTPS obligatorio (Caddy).
- Cookies httpOnly + SameSite=Strict para sesión web.
- Rotación de refresh tokens de Holded (los refresca el worker antes de expirar).
- PIN de cajero hash-eado con argon2id.
- No se almacenan datos de tarjeta. Nunca. PCI-DSS fuera del alcance.
