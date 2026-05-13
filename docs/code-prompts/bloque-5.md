# Prompt para Claude Code — Bloque 5

Pega esto en una sesión nueva de Claude Code una vez B4 esté mergeado
en GitHub.

---

Hola Code. Arrancamos B5 — el bloque que cierra los fixes críticos
heredados de la validación de B4 y monta la bandeja de errores
`SYNC_FAILED` para poder gestionar tickets fallados desde admin.

**Nota importante sobre alcance**: el frente original de impresión
real ESC/POS se ha movido a un bloque dedicado posterior (B5.5 o
B6). Razón: la arquitectura backend→impresora directa que
proponíamos sólo funciona en dev (backend en localhost). En
producción, el backend vive en el VPS de Hostinger y NO puede
abrir TCP al rango privado de la red del cliente. La solución
correcta requiere un agente local en la red del cliente
(probablemente Docker container ligero) que merece su propia
conversación de diseño antes de codearlo. B5 se enfoca en lo
demás.

## Contexto

B1 + B2 + B3 + B4 commiteados y pusheados (`5a43aad`, `535b3e1`,
`1027211`, `c616b93`). Lee primero:

- `docs/blocks/B1-done.md`, `B2-done.md`, `B3-done.md`, `B4-done.md`
  — memoria persistente.
- `docs/07-nucleo-comun.md` §8 (impresión: ticket híbrido ESC/POS +
  QR Veri*factu si Holded lo expone), §5 (modo degradado).
- `docs/04-stack-y-decisiones.md` ADR-006 (decisión hardware: en B5
  cerramos red vs Bluetooth con datos reales), ADR-010 (GET-back),
  ADR-011 (portabilidad de hardware — el `PrinterClient` abstracto
  es central en este bloque).
- `docs/design/tokens.md` y `reference-app.tsx` — el footer del
  ticket impreso y la bandeja de errores siguen el design system.

Antes de tocar código, **resume lo que entiendes** y plantéa
discrepancias. Sin luz verde no empieces.

## Bloque 5 · Bandeja SYNC_FAILED + fixes críticos del piloto

### Resumen del alcance

Tres frentes en orden de dependencia:

1. **Fixes críticos heredados** detectados al validar B4 — sin esto
   ningún ticket llega a Holded en `SYNCED`.
2. **Bandeja `SYNC_FAILED`** en admin para que el encargado gestione
   tickets que Holded rechazó.
3. **Fixes UX urgentes** del CheckoutPage y SalePage detectados en
   la validación E2E.

Fuera de B5 (explícito):
- **Impresión real ESC/POS** → bloque dedicado posterior (requiere
  diseño de agente local en red del cliente). Sin impresión, el
  TPV cierra ciclo: ticket en BD, modal éxito sin papel, refund OK,
  bandeja resuelve sync errors. Piloto puede enviar PDF por email.
- MANAGER en admin, umbral de descuento con PIN encargado, modo
  degradado 24h/48h bloqueante, UI completa de ticket regalo
  masivo → B6.
- Bar/mesas/websockets → B7.
- Customer-facing display → v2.

### 1. Fixes críticos heredados

#### 1.1 `taxRate=0` en sync (BUG CRÍTICO)

**Síntoma observado en validación E2E de B4**: tickets enviados a
Holded reciben silent reject con `total: 72 (nuestro) vs 97.2
(Holded)`. La diferencia es porque enviamos `tax: 0` en cada línea,
Holded ignora y aplica el tax que tiene cada SKU en su catálogo →
mismatch → SYNC_FAILED.

**Root cause**: el sync inicial (B1) lee productos de Holded pero
persiste `Product.taxRate = 0` en BD local. Investigar el parseo de
`taxes[]` en `iterateAllProducts` y derivados — debería mapear cada
tax ID (e.g. `s_iva_21`) al rate numérico (21) vía
`TenantTax.rate` que ya tenemos sincronizado.

**Fix esperado**: tras el fix, los productos del catálogo demo
deben tener `taxRate` poblado correctamente (21, 10, 4, 0 según
caso). Validar:

- Re-correr sync incremental → productos actualizados con tax real.
- Crear ticket → el `total` calculado en backend matchea con lo que
  Holded recibe → SYNCED.

**Migración**: ninguna nueva, sólo lógica.

#### 1.2 Auto-SKU 404 loop infinito

**Síntoma**: log del API tras cada cron de 15 min:

```
[incremental-sync] auto-sku error de API {
  holdedProductId: '69b7f8be522458c48a0ef621',
  error: 'Holded API 404 on /invoicing/v1/products/...'
}
```

Productos que existían en Holded cuando hicimos el sync inicial pero
luego fueron borrados de Holded. El cron sigue reintentando cada 15
min indefinidamente.

**Fix**: en `runAutoSku`, cuando `PUT /products/:id` devuelve 404,
marcar el producto en BD local como `active=false` Y `sellableViaTpv
=false`. El siguiente sync incremental ya no lo procesará.

**Migración**: ninguna.

#### 1.3 Eliminar spike routes legacy

**Síntoma**: al arrancar `pnpm dev:api` con `HOLDED_API_KEY` set en
`apps/api/.env`, Fastify crashea por `Method 'POST' already
declared for route '/tickets'`. Las spike routes legacy
(`apps/api/src/spike/routes.ts`) registran `POST /tickets` que
colisiona con el `POST /tickets` real de B4.

**Fix**: eliminar:
- `apps/api/src/spike/` (toda la carpeta).
- Wire-up en `apps/api/src/server.ts` (`registerSpikeRoutes`).
- `apps/tpv-web-spike/` entero (el super-mini-MVP).
- `dev:spike` script de `package.json` raíz.
- Referencias a `tpv-web-spike` en READMEs y docs.

El spike fase 0 ya cumplió su papel; vive en git history. No tiene
sentido mantenerlo activo.

#### 1.4 Drift Prisma migrate dev

**Síntoma**: tras aplicar `b4_stores_and_tickets`, `prisma migrate
dev` detecta una diferencia entre `schema.prisma` y BD y pide
nombre para una migración correctiva nueva.

**Fix**: investigar la diferencia con
`npx prisma migrate diff --from-migrations prisma/migrations
--to-schema-datamodel prisma/schema.prisma --script`. Si es algo
real (campo, índice, default), generar la migración mini con
`b5_schema_align`. Si es cosmético (formato de default), ajustar
`schema.prisma` para que coincida con la BD.

### 2. Bandeja `SYNC_FAILED` en admin

Nueva pantalla `/admin/tickets-errors` (activar item "Holded" del
sidebar — hoy grisado — y usarlo como sección dedicada a sync
issues).

#### 2.1 Backend endpoints

- **`GET /admin/tickets/sync-errors`** (`requireOwner`): lista
  tickets con `status` en (`SYNC_FAILED`) o refunds equivalentes.
  Devuelve: ticket info, `syncError` payload, último intento,
  número de intentos (BullMQ attempts), holdedDocumentId si parcial.
- **`POST /admin/tickets/:id/retry-sync`** (`requireOwner`):
  re-encola el job en BullMQ. Devuelve nuevo jobId.
- **`POST /admin/tickets/:id/mark-resolved`** (`requireOwner`):
  marca el ticket como `SYNCED` manualmente con `holdedDocumentId`
  proporcionado por el propietario (caso: el ticket existe en
  Holded pero nuestro GET-back no lo detectó por alguna razón).
- **`POST /admin/tickets/:id/edit-line-sku`** (`requireOwner`):
  edita el SKU de una línea concreta y re-encola. Para el caso de
  productos sin SKU canónico que rechazó Holded.
- **`GET /admin/tickets/:id/holded-payload-preview`** (`requireOwner`):
  devuelve el payload que el worker enviaría a Holded en su próximo
  intento. Para diagnóstico antes de retry.

#### 2.2 UI

Pantalla nueva en admin con:

- **Tabla** con columnas: nº interno, fecha, total, líneas, error
  resumen (e.g. "total mismatch · 72 vs 97.2", "line without SKU",
  "HTTP 401"), intentos, acciones.
- **Drawer detalle** al pulsar fila: payload original enviado,
  respuesta de Holded, diff calculado, líneas del ticket.
- **Acciones**: Reintentar, Editar SKU línea (con modal), Marcar
  resuelto manualmente (input del docNumber Holded), Abrir en
  Holded (si hay docId parcial).
- **Filtros**: rango fecha, tienda, caja, tipo de error.
- **Banner ámbar arriba con contador** si hay tickets pendientes.
  El sidebar muestra punto rojo sobre el ítem "Holded" si > 0.

#### 2.3 Health check en cierre de turno

El cierre actual ya hace health-check de sync; afinarlo:

- Si hay tickets `SYNC_FAILED` del turno, muestra lista en el
  modal de cierre con badge rojo.
- El encargado debe **autorizar** la aceptación con su PIN antes
  de poder cerrar — confirma que conoce los errores y se hace
  cargo (queda en log de auditoría).

### 3. Fixes UX urgentes detectados en B4

#### 3.1 Botón Cobrar en SalePage flotante

Hoy `Cobrar` está sticky-bottom del panel ticket. Cambiar para que
el botón siga al último item del carrito (panel se ajusta al
contenido). Si hay muchas líneas, scroll normal; con pocas, el
botón está cerca del foco visual. Es bug UX confirmado por el
propietario en la validación.

#### 3.2 Validación CheckoutPage

Hoy el botón "Confirmar cobro" se deshabilita cuando el cajero
modifica el campo de efectivo recibido (incluso si el nuevo valor
es ≥ total). Bug de validación. Habilitarlo siempre que `Σ payments
>= total` con tolerancia 0.01€.

#### 3.3 `name`/`id` en inputs críticos

Warning en DevTools: "A form field element should have an id or
name attribute". Aplicar en: login admin, signup, ConnectHolded,
Cashier PIN, ShiftOpen, contact creator. No bloquea pero mejora
autofill y accesibilidad.

#### 3.4 `workbox-window` peer dep

Añadirlo como dependency declarada explícitamente en
`apps/tpv-web/package.json` (ahora está como peer faltante de
`vite-plugin-pwa`). Documentar en README que se instala con `pnpm
install`.

### 4. Tests

- **taxRate fix**: test del sync que confirma el mapping
  s_iva_21 → 21, s_iva_10 → 10, etc., y que id desconocido cae a
  null + `sellableViaTpv=false`. Test del salesreceipt que incluye
  tax correcto en payload.
- **Auto-SKU 404 marca inactive**: mock de Holded responde 404 →
  product.active = false y sellableViaTpv = false.
- **Spike routes eliminadas**: el server arranca sin
  HOLDED_API_KEY error, no hay POST /tickets duplicado, archivos
  de spike borrados.
- **Bandeja errors**: list, retry, mark-resolved, edit-line-sku,
  refunds incluidos con badge.
- **UX fixes**: tests del CheckoutPage validan que el botón se
  habilita correctamente con Σ payments ≥ total.

### 5. Restricciones

- No regresiones en B1+B2+B3+B4. Todos los tests previos siguen
  verdes.
- **NO tocar impresión real ESC/POS** — el frente se trasladó a un
  bloque dedicado posterior por razones arquitectónicas. No
  añadas `packages/printer-client/`, ni endpoints `/print`, ni
  iconos de impresora en TPV.
- NO tocar MANAGER admin, umbral descuento, modo degradado, UI
  ticket regalo masivo, bar — eso es B6+.
- TypeScript estricto, JSON Schema en body.
- Migraciones Prisma versionadas si hay drift real.

### 6. Entregables

1. PR único con todo B5 (sin impresión).
2. Commit messages descriptivos.
3. `.env.example` actualizado si hay variables nuevas.
4. `docs/blocks/B5-done.md` con mismo formato que B1-B4.

ADR-006 NO se cierra todavía — sigue diferido hasta que diseñemos
el agente local en el bloque dedicado de impresión. Lo dejas como
"pendiente, ver bloque posterior de impresión real".

### 7. Lo que NO entra en B5 (bloques posteriores)

- **Impresión real ESC/POS** → bloque dedicado posterior (agente
  local en red del cliente como Docker container ligero). Sin
  impresión, el TPV cierra ciclo: ticket en BD, modal éxito sin
  papel, refund OK, bandeja resuelve sync errors. Piloto puede
  enviar PDF de Holded por email al cliente.
- MANAGER en admin con `requireOwnerOrManager` → B6.
- Umbral de descuento por cajero con PIN encargado → B6.
- Modo degradado 24h aviso / 48h bloqueo → B6.
- UI completa de ticket regalo masivo → bloque de impresión.
- Bar/mesas/agrupar mesas/multi-terminal websockets → B7.
- Bluetooth printer client → bloque de impresión si alguien lo
  pide.
- Customer-facing display → v2.
- Conversión ticket→factura integrada → v2.

Cuando termines B5 y Matías lo revise, te paso el siguiente
bloque (probablemente el de impresión, con la arquitectura de
agente local cerrada).
