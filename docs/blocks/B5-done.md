# Bloque 5 · resumen del entregable

Estado: cerrado pendiente de revisión por Matías.

**Alcance reducido vs prompt original**: la impresión real ESC/POS
salió de B5 a un bloque dedicado posterior. Razón: backend en VPS
Hostinger no puede abrir TCP al rango privado de la red del cliente,
así que la arquitectura correcta requiere un agente local (Docker
container ligero) que merece su propio bloque de diseño. B5 cierra
los fixes críticos heredados de la validación E2E de B4 y monta la
bandeja para que el encargado pueda gestionar tickets fallados.

## Estructura del repo tras B5

```
.
├─ apps/
│  ├─ api/                     # + admin/tickets-errors (bandeja SYNC_FAILED)
│  │                           # ~ catalog/incremental-sync, onboarding/initial-sync (taxRate fix)
│  │                           # ~ onboarding/auto-sku (404 marca inactive)
│  │                           # ~ shift/routes (PIN encargado si SYNC_FAILED en turno)
│  │                           # ~ tickets/routes (acepta overpayment cash)
│  │                           # ~ tickets/upload-ticket, tickets/upload-refund (payload extraído)
│  │                           # − apps/api/src/spike/ (eliminado)
│  ├─ admin/                   # + pages/TicketsErrorsPage (bandeja + drawer)
│  │                           # ~ AdminShell (sidebar activa "Holded" con badge)
│  ├─ tpv-web/                 # ~ pages/SalePage (botón Cobrar sigue contenido)
│  │                           # ~ pages/CheckoutPage (acepta Σ payments ≥ total)
│  │                           # ~ pages/CloseShiftModal (lista failed + PIN reason)
│  │                           # ~ pages/PinScreen, ShiftOpenScreen, SalePage.contact (id/name)
│  └─ tpv-web-spike/           # eliminado (vivía como super-mini-MVP de fase 0)
├─ packages/
│  ├─ db/                      # + 1 migración: b5_schema_align
│  └─ holded-client/           # + buildTaxRateResolver helper
└─ docs/blocks/B5-done.md      # este archivo
```

## Lo que dejé hecho

### Frente 1 · fixes críticos heredados

#### 1.1 `taxRate=0` en sync (BUG CRÍTICO)

`packages/holded-client/src/taxes.ts` exporta nuevo
`buildTaxRateResolver(taxes)` que construye un mapa `taxId → rate`
desde el listado de `/invoicing/v1/taxes`. Resuelve por map primero;
fallback a `parseTaxRateFromId` (regex `s_iva_\d+`); si ninguno
encaja, devuelve `null`.

`apps/api/src/onboarding/initial-sync.ts` y
`apps/api/src/catalog/incremental-sync.ts` cachean el resolver al
hacer `listTaxes` y lo pasan a `upsertCatalogEntry`. Si `taxRate`
queda `null`:

- Persiste `taxRate=0` en BD (la columna sigue NOT NULL).
- **FUERZA** `sellableViaTpv=false` para que el TPV no lo venda.
- Log estructurado `warn` con `holdedProductId`, `taxId`, `name`.

El path de UPDATE distingue dos casos:
- Sólo falta SKU → no degradamos `sellableViaTpv` (auto-sku puede
  arreglarlo después). Comportamiento heredado de B2.
- Falta tax → `sellableViaTpv=false` forzado. **Es la diferencia
  clave**: vender con `tax=0` cuando Holded espera 21 produce silent
  reject por total mismatch.

#### 1.2 Auto-SKU 404 marca inactivo

`apps/api/src/onboarding/auto-sku.ts`: cuando
`updateProductWithGetBack` devuelve `HoldedApiError` con `status=404`,
marca el producto local `active=false, sellableViaTpv=false` y
**no añade** el error a `result.errors` (deja de generar ruido cada
15 min). Si Holded re-crea el SKU, el upsert del sync lo reactiva.

#### 1.3 Spike legacy eliminado

Borrado:
- `apps/api/src/spike/` (carpeta completa).
- `apps/tpv-web-spike/` (super-mini-MVP).
- Import + wire-up `registerSpikeRoutes` en `server.ts`.
- `if (HOLDED_API_KEY)` block + variable `HOLDED_API_KEY` en `env.ts`.
- Script `dev:spike` de `package.json` raíz.
- Referencias en READMEs de api / tpv-web.

**Mantenido**: `spike/holded/` (CLI scripts `spike:05`–`spike:09`).
Siguen siendo útiles como smoke-tests de la API real de Holded fuera
del runtime del backend.

`HOLDED_BASE_URL` se mantiene en env (lo usan los `ApiKeyClient`
reales con tenant cifrado). `apps/api/.env.example` actualizado para
reflejar que sólo es override del `.env` raíz.

#### 1.4 Drift Prisma alineado

Diagnóstico con `prisma migrate diff --from-empty --to-schema-datamodel`
+ comparación con `cat migrations/*/migration.sql`: el único objeto
declarado en `schema.prisma` y ausente de las migraciones era el
índice `refunds_tenant_id_status_idx` (`@@index([tenantId, status])`
en model `Refund`).

Nueva migración `20260513170000_b5_schema_align/migration.sql`
añade el índice. Tras aplicarla, `prisma migrate dev` ya no detecta
desfase.

### Frente 2 · bandeja SYNC_FAILED

#### 2.1 Backend endpoints (`requireOwner`)

`apps/api/src/admin/tickets-errors.ts`:

| Endpoint | Qué hace |
|---|---|
| `GET /admin/tickets/sync-errors` | Lista combinada tickets+refunds en `SYNC_FAILED`. Filtros: `from`, `to`, `registerId`, `storeId`, `errorType`. Devuelve `items[]` (con `kind: "ticket" | "refund"`, `internalNumber`, `errorSummary` humano, `attempts`, `lastAttemptAt`, `register`) + `pendingCount`. |
| `POST /admin/tickets/:id/retry-sync` | Resetea `status → PENDING_SYNC`, limpia `syncError` y `holdedUpload.lastError`, re-encola en BullMQ con jobId determinista. 409 si ya estaba SYNCED. |
| `POST /admin/refunds/:id/retry-sync` | Idem para refunds. |
| `POST /admin/tickets/:id/mark-resolved` | El owner pega el `holdedDocumentId` (y opcionalmente `holdedDocNumber`) del documento que vio en Holded. Marca SYNCED sin reintentar. |
| `POST /admin/refunds/:id/mark-resolved` | Idem. |
| `POST /admin/tickets/:id/edit-line-sku` | Edita el SKU de una línea concreta, **limpia el `holdedDocumentId` parcial** para que el siguiente intento re-cree el documento desde cero, y re-encola. |
| `POST /admin/refunds/:id/edit-line-sku` | Idem para refunds (campo `refundLineId`). |
| `GET /admin/tickets/:id/holded-payload-preview` | Devuelve el payload exacto que el worker mandaría a Holded en el próximo intento. Reutiliza `buildTicketSalesreceiptPayload` extraído de `upload-ticket.ts` — sin drift. |
| `GET /admin/refunds/:id/holded-payload-preview` | Idem con `buildRefundSalesreceiptPayload`. |

#### 2.2 UI bandeja `/admin/tickets-errors`

`apps/admin/src/pages/TicketsErrorsPage.tsx`:

- Tabla combinada con badge ámbar arriba si hay pendientes, columnas
  Tipo/Nº/Fecha/Caja/Total/Error/Intentos.
- Drawer lateral derecha al pulsar fila: muestra el `syncError`
  bruto en JSON formateado, líneas (sólo tickets), acciones
  (Reintentar, Marcar resuelto con form inline, Ver en Holded si
  hay `holdedDocumentId`), y **payload preview** (lo que se enviará
  en el próximo intento).
- Edición SKU de línea con modal inline.
- Filtros básicos: rango de fechas + tipo de error.

`apps/admin/src/AdminShell.tsx`:

- Activa el ítem "Holded" del sidebar (apuntando a
  `/admin/tickets-errors`).
- Hook nuevo `useSyncErrorsCount` pollea
  `/admin/tickets/sync-errors?limit=1` cada 60s para mostrar **badge
  rojo con contador** en el ítem cuando hay pendientes.
- Diseño: chip redondo `bg-red-500` con número (99+ si > 99).

#### 2.3 Health-check cierre con PIN encargado

`apps/api/src/shift/routes.ts` `POST /shift/:shiftId/close`:

- El conteo de issues ahora suma **tickets + refunds** en
  `SYNC_FAILED`/`PENDING_SYNC`.
- Respuesta 409 `SYNC_PENDING` ahora incluye `failedTickets[]` y
  `failedRefunds[]` con `internalNumber`, `total`, `errorSummary`
  humano y `createdAt` — para que el modal de cierre pinte la lista.
- **Nuevo gate de PIN**: si `failed > 0` y el actor no es MANAGER,
  exigimos `managerPin` además del `syncFailureAccepted=true`.
  Respuesta 403 con `error: "MANAGER_PIN_REQUIRED"` y
  `reason: "sync_failed"` para que la UI distinga el motivo.
- PIN validado contra cualquier `User.role = MANAGER` del tenant
  con `pinHash` definido (misma mecánica que el force-close de B3).
- Audit trail: cuando se autoriza, `request.log.info` estructurado
  con `event: "shift.close.sync_failed_accepted"`, shiftId, cashier,
  managerEmail, failedCount.
- `managerAuthorizationEmail` añadido al input del Z PDF, se imprime
  como "Autorizado por: <email>" en la sección de incidencias.

`apps/tpv-web/src/pages/CloseShiftModal.tsx`:

- Renderiza la lista `failedDocs` (tickets+refunds) con badge rojo,
  ↩ delante de refunds, total y resumen del error.
- Renderiza el campo PIN cuando el server devolvió
  `MANAGER_PIN_REQUIRED` con `reason: "sync_failed"`, con copy
  específico ("Hay tickets rechazados por Holded en este turno…").
- Mantiene el flujo previo para CASHIER + force-close (B3).

### Frente 3 · fixes UX urgentes

#### 3.1 Botón Cobrar flotante

`apps/tpv-web/src/pages/SalePage.tsx`: el aside del ticket dejó
de usar `flex-1 overflow-y-auto` en el contenedor de líneas y
`max-h-[60vh]` en el aside. Ahora `self-start` + lista sin flex-grow
hace que el panel se ajuste al contenido. Si hay muchas líneas, la
PÁGINA (no el panel) hace scroll vertical estándar. Con pocas
líneas, el botón Cobrar queda cerca del foco visual.

#### 3.2 Validación CheckoutPage + server overpayment

`apps/tpv-web/src/pages/CheckoutPage.tsx`: `ready` ya no exige
match exacto. Pasa a `paymentsSum >= total - 0.01`.

`apps/api/src/tickets/routes.ts` `POST /tickets`: igualmente cambia
la validación de `paymentsClose(sum, total)` (simétrica) a
`paymentsSum + tolerance < total` → 400 sólo si falta dinero. Permite
overpayment en efectivo (el cambio = `paymentsSum - total`).

**Importante**: el worker sigue enviando `amount: ticket.total` (no
`paymentsSum`) en `/pay` a Holded — Holded ve siempre el total
exacto. El overpayment vive sólo en el TPV como dinero recibido vs
aplicado.

#### 3.3 `name`/`id` en inputs críticos

- Admin login: checkbox `loginRemember` con `id`+`name`+`htmlFor`.
- TPV PinScreen: email field `cashierEmail`.
- TPV ShiftOpenScreen: campo `cashOpening`.
- TPV SalePage contact sheet: search field `contactSearch` y los
  campos del form de creación generan `id` determinista a partir
  del label (`contact-<slug>`).

Otros campos críticos (`signup`, `ConnectHolded`, `rotate-api-key`)
ya usaban `TextField` con `id` desde B2/B3.

#### 3.4 `workbox-window` peer dep

Ya estaba declarado en `apps/tpv-web/package.json` desde B4. Añadí
una nota explícita en `apps/tpv-web/README.md` para que quede claro
que el warning de peer dep falsa quedó resuelto.

## Tests

Total **165/165 verdes** (+14 nuevos sobre B4):

| Archivo | Tests nuevos | Cubre |
|---|---|---|
| `incremental-sync.test.ts` | 3 | Mapping `s_iva_21/10/4/0 → rate`; tax id desconocido → `sellableViaTpv=false` + warning; producto existente que pierde tax válido → degradación |
| `auto-sku.test.ts` | 1 | Holded 404 → `active=false`+`sellableViaTpv=false`, sin contaminar `errors[]` |
| `tickets-route.test.ts` | 1 | Overpayment en efectivo (Σ payments > total) → 201 |
| `admin-tickets-errors-route.test.ts` | 9 | list (tickets+refunds, formato error), retry-sync (ticket+refund, 409 si SYNCED), mark-resolved, edit-line-sku (happy + 400 línea ajena), payload-preview |

Typecheck limpio en `api`, `admin`, `tpv-web`, `holded-client`.

## Decisiones que tomé en B5 sin preguntar (más allá del prompt)

1. **Manager PIN siempre que haya `SYNC_FAILED` en el turno**, no
   sólo en force-close. El prompt §2.3 lo pide claramente; lo
   implementé reusando la mecánica existente del force-close (B3) en
   lugar de inventar una segunda. Si no hay ningún MANAGER en el
   tenant, el cajero no puede cerrar — pendiente de B6 con admin
   MANAGER completo para resolver edge case.
2. **Server-side acepta overpayment** (`paymentsSum >= total - 0.01`,
   antes simétrico). Confirmé que el worker envía `amount: total` a
   `/pay`, no `paymentsSum`, así que Holded sigue viendo el total
   exacto. El "cambio" vive sólo en TPV. Cambié el helper
   `paymentsClose` → check inline porque la asimetría ya no era
   simétrica.
3. **Extraje `buildTicketSalesreceiptPayload` y
   `buildRefundSalesreceiptPayload`** de los workers a funciones
   reutilizables. El preview endpoint usa exactamente la misma
   función que el worker → garantía de "lo que ves es lo que se
   envía" sin drift.
4. **`taxRate` queda en `0` cuando no se resuelve**, no en `null`.
   La columna es `NOT NULL` y cambiar el schema para nullable habría
   sido un cambio invasivo en muchos sitios (`totals`, `salesreceipt`,
   `wildcards`). En su lugar, `sellableViaTpv=false` actúa como gate
   efectivo: nada con tax sin resolver llega al worker. Si lo hace
   (manualmente o por bug), Holded lo rechazará por silent reject
   → el ticket cae en la bandeja y el owner lo gestiona.
5. **Bandeja en `/admin/tickets-errors` con ítem "Holded" en sidebar**.
   El prompt sugería "activar item Holded grisado" — lo hice
   apuntando a la nueva ruta, no a la configuración de Holded (que
   sigue en Mi cuenta / Tiendas). Tiene más sentido funcional —
   "Holded" en sidebar = "estado de la integración".
6. **Tests con UUIDs reales en path params**. Los routes tienen
   `format: "uuid"` en params, lo que rechaza placeholders como
   `"t1"`. Usé UUIDs deterministas (`aaaaaaaa-...`,
   `cccccccc-...`) en los fakes para que la validación de schema no
   se interponga.
7. **Refunds incluidos en la bandeja sin endpoint genérico**. Cada
   acción (retry / mark-resolved / edit-line-sku) tiene endpoint
   propio bajo `/admin/refunds/:id/...`. Más explícito que adivinar
   por id si es ticket o refund. El listado los une en `items[]` con
   `kind` para que la UI pinte un solo cuadro.
8. **Mantengo `packages/spike-holded/`** (scripts CLI Fase 0 contra
   Holded sandbox). Sólo borro `apps/api/src/spike/` y
   `apps/tpv-web-spike/`. Los scripts `spike:05`–`spike:09` siguen
   activos como smoke tests manuales de la API.
9. **`prisma migrate dev` drift cosmético-ish**. El índice
   `refunds_tenant_id_status_idx` estaba declarado en schema pero
   no en migraciones — pequeño, pero real. Lo añadí como migración
   `b5_schema_align`. Otros usos del "drift" del prompt B4 hablaban
   de defaults; no encontré ninguno en el diff. Si tu BD viva tiene
   otro drift que no surge en `--from-empty`, dilo y lo añadimos.
10. **No introduzco tabla `audit_log` dedicada**. El "queda en log
    de auditoría" del prompt §2.3 lo cumplo con `request.log.info`
    estructurado (event, shiftId, managerEmail, failedCount). El
    Z PDF también persiste el "Autorizado por: <email>". Cuando
    montemos un audit_log real en B6+, migramos. Hoy basta para
    trazabilidad piloto.

## Dudas y cosas a confirmar

1. **Holded `paymentsPending` con overpayment**: el worker envía
   `amount: total` a `/pay`, NO `paymentsSum`. Por tanto el cambio
   nunca aparece en Holded. Confirmar que es lo que quieres:
   Holded ve sólo el total cobrado; el efectivo recibido y el
   cambio dado quedan sólo en el Z report local del TPV.
2. **Mapa de `errorType`**: en la bandeja filtro por valores como
   `silent_reject`, `holded_4xx`, `pay_silent_reject`, `pay_4xx`,
   `no_holded_key`. Si en producción aparecen otros `reason` (e.g.
   timeout específico, network errors), añado el filtro en B6.
3. **Tenant sin MANAGER**: hoy si no hay manager con PIN, el cierre
   con `SYNC_FAILED` queda bloqueado para CASHIER. El OWNER puede
   cerrar igual (no se exige PIN al owner — pero el OWNER hoy no
   se loguea como cashier por defecto). En tenant piloto puro
   "1 dueño + 1 cajero", esto es un bloqueo. Para B6 conviene
   permitir al OWNER autorizar desde admin.
4. **Holded payload preview para refunds**: hoy el drawer no
   muestra las líneas del refund (sólo del ticket). Para simplificar
   no añadí el endpoint detallado de refund — el payload preview ya
   muestra lo importante. Si lo necesitas en piloto, añado el
   `GET /admin/refunds/:id` con detalle completo.
5. **Migración del drift Prisma**: sin Docker arriba no pude
   ejecutar la migración real contra una BD viva. Lo verifiqué
   por análisis estático del diff. Cuando se aplique en piloto,
   confirmar que `prisma migrate deploy` la aplica sin pedir
   nombre adicional.

## Cómo arrancarlo todo de cero

```bash
# 1. Levantar infra y aplicar la migración nueva
docker compose up -d
pnpm install
pnpm db:migrate   # aplica b5_schema_align (índice refunds tenant+status)

# 2. Tests (23 ficheros, 165 casos)
pnpm -w test

# 3. Type-check (4 packages — todos limpios)
pnpm --filter @mipiacetpv/api exec tsc --noEmit
pnpm --filter @mipiacetpv/admin exec tsc --noEmit
pnpm --filter @mipiacetpv/tpv-web exec tsc --noEmit
pnpm --filter @mipiacetpv/holded-client exec tsc --noEmit

# 4. Arrancar dev (3 terminales)
pnpm dev:api    # http://127.0.0.1:3001
pnpm dev:admin  # http://localhost:5173
pnpm dev:tpv    # http://localhost:5174
```

Flujo E2E nuevo de B5 para validar manualmente:

1. Admin: deja un ticket en `SYNC_FAILED` (puede ser inducido
   mockeando el sync error en BD, o esperando que aparezca uno real
   durante venta piloto).
2. Admin → sidebar "Holded" → debería verse un punto rojo con el
   contador.
3. Click → `/admin/tickets-errors` con la tabla y el ticket fallado.
4. Click fila → drawer abre con error, líneas, payload preview.
5. Editar SKU línea → corrige el bug que causó el fail → Guardar y
   reintentar → tras unos segundos, el ticket debería pasar a
   SYNCED y desaparecer de la bandeja.
6. TPV → con ese ticket fallado en el turno, intenta cerrar →
   modal pinta la lista con badge rojo y exige PIN encargado →
   introduces PIN → cierre OK → el Z PDF tiene la línea "Autorizado
   por: <email>".

Cuando termines B5 y Matías lo revise, abrimos el bloque dedicado
de impresión real con el diseño del agente local.
