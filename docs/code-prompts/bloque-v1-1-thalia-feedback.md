# Prompt para Claude Code — v1.1 Feedback Thalia + Bar + Peluquería

Lote derivado del feedback real del equipo de implantación de Holded
(equipo Matías + Thalia · 2026-05-20). Cuatro lotes encadenados, en
una sola branch `v1-1-thalia-feedback`, commits separados por
sub-tarea.

## Estado actual de master

- HEAD local: `4956e51 B-Categorias-via-Tags` (commiteado, **pendiente
  push y deploy** — Matías lo lanza antes de empezar este bloque).
- Producción: hasta `335a92b Bug-RehidratarSuperAdmin`.
- Toda la cadena de commits de hoy (Bug-CSP-embed, Lote B UX, etc.)
  ya está en producción y verificada con curl.

## Lo que NO entra en este lote (v1.2)

- T-5 Modificar precio en línea de venta (Matías quiere dejarlo
  reposar, ya hay descuentos manuales).
- T-8 Búsqueda fuzzy mejorada (necesitamos ejemplo concreto de
  Thalia para diagnosticar antes de tocar el algoritmo).
- T-9 Productos favoritos / atajos (fotocopias, etc.).
- B-3 Ticket de dieta (split bill hostelería).
- P-2 Agendas peluquería con tiempos por empleado.

---

# Lote 1 · Investigación previa (sin código aún)

Antes de tocar nada, diagnostica las tres dudas siguientes ejecutando
queries / leyendo logs en el VPS productivo. Si encuentras un bug
real, lo arreglas en el lote correspondiente; si confirmas que
funciona, lo documentas como "verificado" y seguimos.

## Inv-1 — Fotos de producto no se ven en TPV

**Síntoma reportado**: "He probado a poner una foto en el producto de
Holded y no se me ha pasado al TPV."

**Pista**: B-ProductImages ya está desplegado. El worker
`image-cache-worker` descarga la imagen desde Holded y la sirve
cacheada desde Caddy en `/product-images/<tenantId>/<productId>.<ext>`.

**Investiga**:

1. `docker logs mipiacetpv-worker --since 24h | grep -iE 'image|product-images'` —
   ¿procesó jobs hoy? ¿Hubo errores?
2. En BD: para el tenant Thalia, ¿cuántos products tienen
   `image_url IS NOT NULL` vs `image_mime IS NOT NULL`? La diferencia
   indica jobs encolados pero no completados.
3. Pide a Matías el `holded_product_id` exacto del producto donde
   subió foto, e inspecciona `raw` (jsonb) del Product en BD para ver
   qué devolvió Holded en su payload — ¿hay campo de imagen?
4. Si Holded entrega la foto como `attachment` (no como `image`),
   nuestro `extractImageUrl` no la coge.

**Posibles causas**:
- Job no encolado: el sync incremental no se disparó tras editar en
  Holded. Resync manual y probar de nuevo.
- HEIC / formato no soportado: Holded ahora también acepta HEIC desde
  móvil. Nuestro worker valida MIME contra una whitelist (`image/jpeg`,
  `image/png`, `image/webp`). HEIC se descartaría sin marca.
- `image_url` vacío en raw: Holded no expuso la foto. Verificar
  formato del campo en su API.

**Entregable**: un commit `Inv-1 · ...` que añade al diagnóstico
encontrado:
- Si es bug del worker: fix puntual.
- Si es bug del sync: añadir HEIC al whitelist (con conversión a JPEG
  vía sharp si hace falta) **o** documentar que HEIC no es soportado y
  el cliente debe subir JPG/PNG.
- Si es falla de invalidación de cache tras edición en Holded:
  forzar `imageCachedAt = null` cuando `image_url` cambie.

## Inv-2 — Devoluciones

**Síntoma reportado**: "Gestionar devoluciones."

**Pista**: ya existe `POST /refunds` y endpoint en `TicketsHistoryPage`
con `refunding` state y botón "Devolver". Verificar que funciona
end-to-end.

**Investiga**:

1. Abre la app en producción con cajero de Thalia.
2. Cobra un ticket de prueba.
3. Ve a Tickets History, abre el ticket, busca el botón devolución.
4. Devuelve una línea, verifica que Holded recibe la nota de abono
   (Holded crea documento `creditnote` o similar).
5. Si no hay botón o no funciona: identifica qué falta.

**Entregable**: nota interna con findings (commit
`docs · Inv-2 · ...` actualizando `docs/auditorias/v1-1-thalia.md`).

## Inv-3 — TableMapScreen para HOSPITALITY

**Síntoma reportado**: "Localización por mesas" (vertical Bar).

**Pista**: SB3 ya añadió `TableMapScreen.tsx` con render condicional
por `businessType=HOSPITALITY`. Verificar que sí se renderiza.

**Investiga**:

1. Crea o reusa una cuenta de prueba con `businessType=HOSPITALITY`.
2. Entra en modo prueba (super-admin → Probar TPV).
3. ¿Aparece la pantalla de selección de mesa antes de la venta?
4. ¿Está configurada la sala/mesas en la cuenta (modelo `Room` o
   similar)? Si no hay UI de admin para crear salas, esto es un
   pre-requisito que falta.

**Entregable**:
- Si funciona: nota.
- Si no hay UI de admin para crear/editar salas y mesas: ese es el
  bloque siguiente (`B-Tables-Admin`), que entra como sub-lote de
  v1.1.

---

# Lote 2 · Quick wins UI + API

Cinco sub-tareas independientes. Commits separados.

## T-3 — Cliente visible en lista "Pendientes" sin abrir

**Síntoma**: cuando un cajero suspende un ticket, en la lista
"Pendientes" solo se ve la hora. Hay que añadir el nombre del
cliente vinculado (si lo hay) para identificar rápidamente.

**Archivos**:
- `apps/tpv-web/src/pages/SalePage.tsx` — sección de Pendientes.
- `apps/tpv-web/src/lib/cart.ts` — `getSuspendedCarts()` debe
  exponer `contactName` (snapshot, no holdedContactId pelado).

**Cambios**:
1. En el modelo de suspended cart (localStorage), guardar
   `contactName: string | null` además del `contactHoldedId`.
2. Al suspender, snapshotear el nombre del contacto actual.
3. En el render de la lista, si hay nombre, mostrar
   `"#3 · 14:32 · María García"` en lugar de solo `"#3 · 14:32"`.
4. Si no hay cliente, mantener formato actual.

**Criterios**:
- No rompe carritos suspendidos antes del despliegue (defensive:
  `contactName` opcional).
- El nombre se trunca con CSS si es muy largo (no rompe layout).

## T-6 — NIF del tenant desde Holded (canónico)

**Síntoma**: Thalia tiene su NIF `04192774N` en Holded pero el TPV
no lo refleja en el ticket.

**Pista**: el sync de tenant levanta `fiscalProfile` (JSONB) que ya
incluye `taxId`. Verificar que se está leyendo y mostrando.

**Archivos**:
- `apps/api/src/onboarding/initial-sync.ts` — donde se carga el
  fiscalProfile en el alta.
- `packages/ticket-model/src/build.ts` — donde se serializa el
  fiscalProfile al ticket (ya tolera nulos por Bug-05).
- `apps/api/src/holded` (si existe) o el cliente Holded — para
  verificar qué campo trae el NIF.

**Investiga primero**: el NIF de Thalia en Holded está poblado? Si
sí, fuerza un resync de la cuenta y verifica que llega al ticket.
Si tras un resync sigue sin aparecer, hay un bug en el mapeo
(probablemente el campo Holded se llama distinto a lo que esperamos:
`vatNumber`, `cif`, `nif`, `taxIdentifier`...).

**Entregable**: commit pequeño que corrige el mapeo si es
necesario, o documentación si solo era pereza de resync.

## T-6a — Editar información de la cuenta desde panel super-admin

**Síntoma de Matías**: "Desde el panel de control del TPV no has
dejado un botón editar información de la cuenta, y sino está metido
al crearla ya no podemos añadirla."

**Archivos**:
- `apps/admin/src/superadmin/TenantDetailPage.tsx` — añadir un
  bloque "Editar datos fiscales" con botón.
- `apps/api/src/superadmin/tenants.ts` — nuevo endpoint
  `PATCH /super-admin/tenants/:id/fiscal-profile`.

**Cambios**:
1. **Backend**: nuevo endpoint `PATCH .../fiscal-profile` que acepta
   `{ legalName?, taxId?, address?, phone? }` y los persiste en
   `fiscalProfile` (merge con el existente). Auditoría con acción
   `update_tenant_fiscal_profile`. Bumpea `updatedAt`.
2. **UI**: en `TenantDetailPage`, dentro del bloque "Datos fiscales"
   actualmente read-only, añadir botón "Editar". Click abre modal
   simple con 4 inputs (legalName, taxId, address, phone). Guarda
   con el nuevo endpoint y recarga la página.
3. **Override sobre Holded**: si la cuenta tiene Holded sincronizado
   y el fiscalProfile viene de un sync previo, el botón debe
   permitir sobreescribir manualmente con un warning visual:
   "Este valor se sobreescribirá en el próximo sync con Holded si
   está configurado allí." Defensivo.

**Criterios**:
- TaxId acepta NIF/CIF/NIE españoles (regex laxo o solo
  longitud min=9 max=12).
- Address acepta string libre (Holded a veces lo entrega como
  objeto, ya tenemos `serializeFiscalAddress` en build.ts).

## T-7 — Dirección al crear/editar contacto desde TPV

**Síntoma**: "Al crear nuevo cliente poder poner dirección para
tema facturas."

**Archivos**:
- `apps/api/src/contacts/routes.ts` — endpoint
  `POST /contacts` (creación on-the-fly).
- `apps/tpv-web/src/pages/SalePage.lineSheet.tsx` o similar — modal
  de crear contacto.

**Cambios**:
1. Añadir campos opcionales al schema del endpoint:
   `address?: string` (libre, una línea — Holded a veces parte la
   dirección por ti, otras la respeta tal cual).
2. Al crear el contacto, propagarlo a Holded vía la API
   correspondiente. Si Holded espera objeto estructurado, parsear
   con la heurística más simple (calle + portal todo en un campo).
3. En la UI del TPV, añadir input "Dirección" debajo del NIF y
   email actuales. Marcar opcional.

**Criterios**:
- Defensivo: si el campo viene vacío, no se envía a Holded (no
  pisar dirección si Holded ya la tenía).
- Edición posterior: el TPV no edita contactos existentes hoy.
  Está fuera de scope. Solo creación.

## P-1 — Pestaña Servicios vs Productos en TPV

**Síntoma de peluquería (SERVICES)**: "Separar servicios de
productos."

**Pista**: el modelo `Product` ya tiene `kind: PRODUCT | SERVICE`
desde el inicio. El sync inicial los separa correctamente. El TPV
hoy los mezcla en la grid.

**Archivos**:
- `apps/tpv-web/src/pages/SalePage.tsx` — añadir toggle en la
  barra superior junto a los chips de tags.

**Cambios**:
1. Cuando `businessType === "SERVICES"`, mostrar dos chips arriba:
   "Servicios" (default) y "Productos" (acumulado).
2. Filtrar `visibleProducts` también por `kind` cuando el toggle
   esté activo.
3. Para `RETAIL` y `HOSPITALITY` no aplicar — siguen mezclando.
4. UX: el toggle puede ir delante de los chips de tags (separado
   por una línea vertical sutil).

**Criterios**:
- Si una cuenta SERVICES no tiene productos físicos, el toggle
  "Productos" muestra empty state.
- Persistir la elección en localStorage (que vuelvas al estado
  donde estabas tras refresh).

---

# Lote 3 · Seguridad — Root super-admin

## Diseño

- Nuevo flag `isRoot: Boolean` en `SuperAdminUser` (default false).
- Migration `b16_super_admin_root` aditiva.
- Seed: detectar el super-admin más antiguo de cada deployment
  (el único existente con `created_at` mínimo) y marcarlo como
  `isRoot=true` automáticamente. Si hay duda, dejarlo en `false` y
  que se promueva con CLI manual.
- Middleware `requireRootSuperAdmin` aplicado a:
  - `POST /super-admin/admins` (crear)
  - `DELETE /super-admin/admins/:id` (eliminar)
  - Cualquier futuro endpoint de admin de super-admins.
- Endpoint `GET /super-admin/admins` cambia comportamiento:
  - Si `isRoot=true`: devuelve la lista completa.
  - Si `isRoot=false`: devuelve solo la ficha propia
    (`items.length === 1`).
- UI admin: en `SuperAdminShell`, el item de navegación
  "Super-admins" solo aparece si `isRoot=true`. Si no, oculto.
- El listing/detail page redirige al dashboard si un no-root
  intenta entrar manualmente por URL.

## Archivos

- `packages/db/prisma/schema.prisma` — añadir `isRoot Boolean
  @default(false) @map("is_root")` a `SuperAdminUser`.
- `packages/db/prisma/migrations/20260521000000_b16_super_admin_root/migration.sql` —
  alter table + backfill (marcar al super-admin más antiguo como
  root si solo hay uno).
- `apps/api/src/superadmin/middleware.ts` — añadir
  `requireRootSuperAdmin` (compone sobre `requireSuperAdmin` +
  check de `isRoot`).
- `apps/api/src/superadmin/admins.ts` — aplicar middleware en POST
  y DELETE; cambiar GET para filtrar.
- `apps/api/src/superadmin/auth.ts` (o donde se construya el JWT
  super-admin) — incluir `isRoot` en el payload del access token
  (claim no sensible).
- `apps/admin/src/superadmin/SuperAdminShell.tsx` — ocultar item.
- `apps/admin/src/superadmin/AdminsListPage.tsx` (o similar) —
  detect `isRoot=false` y redirect.

## Criterios

- Un super-admin no-root nunca recibe 403 al cargar el dashboard;
  solo no ve el menú.
- Si Matías hace seed con CLI sobre una BD nueva, se marca
  automáticamente como root.
- El token JWT NO debe tener `isRoot=true` en producción si la
  fuente de verdad (BD) cambia — recheckear en backend siempre, no
  confiar solo en el claim. (Caso: revoco root, pero el token
  antiguo aún dice root → middleware debe re-leer de BD.)

---

# Lote 4 · Realtime entre pantallas (B-Realtime)

**El más grande**. Síntoma reportado para Thalia (doble caja) y Bar
(cobro de mesas entre pantallas).

## Diseño

WebSocket server en la misma instancia API (Fastify + plugin
`@fastify/websocket`). Suscripción por canal `tenant:<id>:store:<id>:
register:<id>` o granularidad superior. Multi-tab + multi-device.

### Eventos a propagar

- `cart.line_added` { line, by: cashierId }
- `cart.line_removed` { lineId }
- `cart.line_modified` { lineId, changes }
- `cart.suspended` { cartId, contactName? }
- `cart.resumed` { cartId, by }
- `ticket.paid` { ticketId, internalNumber }
- `ticket.refunded` { refundId }
- `shift.opened` / `shift.closed` (informativo)

### Estado compartido

- **Carrito activo**: si dos pantallas comparten el mismo register,
  ven los cambios en tiempo real (caso Bar: barra + sala).
- **Pendientes**: la lista se refresca automáticamente cuando otra
  pantalla suspende.

### Conflicto

- Si dos cajeros añaden producto al mismo carrito al mismo tiempo,
  ambas líneas se mantienen (suma).
- Si uno cobra mientras otro añadía línea, la línea posterior al
  cobro se pierde con toast "El ticket fue cobrado por X. Crea uno
  nuevo." Mantener historial defensivo en logs.

### Fallback

- Si la conexión WS cae, el TPV sigue funcionando con su estado
  local. Reintenta WS cada 5/10/20s con backoff. Al reconectar,
  hace un pull completo del estado y sustituye su cache local.

## Archivos

### Backend

- `apps/api/src/realtime/store-event-bus.ts` — ya existe (lo importa
  `tickets/routes.ts` línea 20). Revisar qué expone y extender si
  hace falta.
- `apps/api/src/realtime/websocket.ts` — nuevo. Plugin Fastify que
  registra ruta `/realtime` con upgrade WS. Autenticación vía
  `cashierSessionToken` en query (mismo token que el TPV ya tiene).
- `apps/api/src/realtime/channels.ts` — mapeo de evento → canal y
  helpers de publish.
- Cada handler de tickets/cart/shift que cambie estado emite el
  evento correspondiente vía el bus.

### Frontend

- `apps/tpv-web/src/lib/realtime.ts` — nuevo. Hook
  `useRealtimeChannel(channelKey)` que abre WS, maneja reconexión,
  emite eventos al consumer.
- `apps/tpv-web/src/pages/SalePage.tsx` — suscribir al canal del
  register. Reaccionar a eventos para refrescar UI.

## Criterios

- E2E test (al menos manual): dos pestañas en mismo register, añadir
  producto en una, ver aparecer en la otra en <3s.
- Si la API cae, el TPV sigue funcionando offline (no romper el
  servicio existente por meter WS).
- TLS: solo `wss://` (la CSP ya lo permite).
- Throttling: no propagar eventos más rápido que 5/s por canal (para
  evitar tormenta si alguien spamea click).

---

# Convenciones del repo

- **Idioma**: comentarios y commits en español. Mensajes técnicos
  (TypeScript errors, etc.) inglés.
- **Commits**: un commit por sub-tarea, mensaje con prefijo
  `<Lote/Tarea> · <título corto>` y cuerpo explicando QUÉ + POR QUÉ.
  Refs al feedback original.
- **Migrations**: aditivas siempre, con default seguro para que
  apliquen sobre la BD productiva sin downtime.
- **Sin tests automatizados nuevos** salvo si ya hay test del
  archivo tocado y se rompe. Tests existentes deben pasar.
- **Typecheck**: cada lote tiene que pasar `tsc --noEmit` antes del
  commit. En tu sandbox no tienes binaries Prisma; si hay error TS
  por eso, déjalo documentado — el rebuild en el VPS lo resuelve.
- **No tocar lógica fiscal propia**: Mipiacetpv no es sistema fiscal
  Verifactu, Holded sí. No implementar IVAs, series, etc. por
  nuestra cuenta.
- **Push lo hace Matías**, no Code.
- **Deploy lo hace Claude (yo, no tú)** en sesión posterior, sobre
  el VPS Hostinger via Web Terminal.

# Orden recomendado

1. Lote 1 (Investigación) — 1-2h. Entrega notas en
   `docs/auditorias/v1-1-thalia.md`. Si encuentras bug en
   Inv-1/Inv-2/Inv-3, créalo como sub-commit.
2. Lote 2 (Quick wins) — 4-6h. Commits separados.
3. Lote 3 (Root) — 2h. Bloque limpio.
4. Lote 4 (Realtime) — 1-2 días. El más grande. **Si te quedas sin
   tiempo o detectas que necesitas decisiones de arquitectura,
   párate y deja documento en `docs/code-prompts/v1-1-realtime-
   pause.md` describiendo el estado y dudas.**

# Cuando termines

Push a `v1-1-thalia-feedback`. PR a master con resumen por lote.
Avisa a Matías con un mensaje del estilo:

```
v1.1 Thalia feedback listo en branch v1-1-thalia-feedback.
Lote 1: <hallazgos>
Lote 2: <commits>
Lote 3: <commits>
Lote 4: <commits> / <estado si pausa>
Pendiente merge + deploy.
```

Matías revisa, hace merge y me lanza el deploy.
