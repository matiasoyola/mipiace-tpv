# Bloque Reservas-2 · Catálogo de servicios extendido

> Extiende el catálogo de servicios (ya espejo de Holded) con lo que la agenda necesita. Paralelizable con B1 y B3. Desbloquea la agenda (B4) y la reserva online (B6). **Owner de la columna `Tenant.agendaEnabled`.**

## Contexto (leer antes)
- `docs/design/reservas-modulo-kickoff.md` §1 (qué existe), §2 (traducción RT→Holded), §3 ADR-R1/ADR-R6, §4 (modelo de datos), §7 (roadmap).
- `docs/design/agenda-belleza-spec.md` §2 (`Service`/`Resource`/`ServiceResourceNeed` heredados) y §3 (el motor usará `duration_min` + buffers).
- `docs/blocks/B-reservas-1-done.md` — patrón de capability flag (`Tenant.crmEnabled`) y estilo de bloque.
- `docs/06-modelo-datos.md` (los servicios son `product.kind=SERVICE`, espejo de Holded) · `docs/holded/endpoints/services.md` (servicios con `serviceId`).
- `docs/04-stack-y-decisiones.md` (ADR-R1).

## Alcance
Añadir a cada servicio los datos de agenda (duración, pausas, nº de profesionales, familia, canales) y los recursos (salas/cabinas/aparatos), **sin crear una tabla de servicios paralela** (ADR-R1): es una capa de extensión local sobre el `product` que ya viene de Holded. Todo el módulo se activa por capability `agendaEnabled`.

### Datos (Prisma / Postgres) — migración aditiva, backfill vacío
- `Tenant.agendaEnabled Boolean @default(false)` — **este bloque es el owner de esta columna** (patrón ADR-R6, columna booleana como `crmEnabled` de B1). Si B3 corre en paralelo, la crea solo este bloque.
- `service_scheduling`: `productId` (pk, fk → `product` con `kind=SERVICE`), `tenantId`, `durationMin`, `bufferBeforeMin` (def 0), `bufferAfterMin` (def 0), `staffRequired` (int, def 1), `onlineBookable` (bool, def false), `family?`, `channels` (jsonb `{caja,ticket,agenda,online}`). Un servicio **sin fila aquí = no reservable ni con duración** → la agenda lo ignora.
- `resource`: `id`, `tenantId`, `name`, `kind` (`CABIN|ROOM|DEVICE`). Genérico: cabina de spa, **box/sala de clínica**, aparato.
- `service_resource_need`: `serviceId` (=productId), `resourceKind`, `qty` (def 1) — un servicio requiere N recursos de un tipo (no uno concreto).

### API (Fastify + JSON Schema), aislamiento por tenant
- `GET /services/scheduling?query=` — servicios (join `product` + `service_scheduling`) con sus campos de agenda.
- `PUT /services/:productId/scheduling` — upsert de los campos de agenda de un servicio.
- CRUD `/resources` y `/services/:productId/resource-needs`.
- Exponer `agendaEnabled` en `/tpv/catalog` y `/admin/tenant/settings` (igual que se hizo con `crmEnabled` en B1).

### Front
- **Panel de edición** en `apps/admin` (gestión del tenant; si la config de catálogo vive hoy en otro sitio, seguir esa ubicación): por servicio, editar duración, pausas, nº de profesionales, familia y flags de canal (Caja/Ticket/Agenda/Online). Alta/edición de recursos y su asignación a servicios. Gate por `agendaEnabled`.
- **En el TPV** (`apps/tpv-web`): mostrar la duración por línea de servicio en el ticket (informativo), solo si `agendaEnabled`. Base visual para B4.

## Restricciones
- **ADR-R1**: extensión sobre el `product` de Holded, NO tabla `Service` paralela. Precio/IVA vienen de Holded (`serviceId`) y **no se tocan aquí**.
- **ADR-R6**: capability como **columna booleana** (`Tenant.agendaEnabled`). Cero `if(businessType)`. Vocabulario neutro: servicio / profesional / **recurso** (sirve a cabina de spa o box de clínica).
- Multi-tenant por fila (extension Prisma existente). Migración **aditiva**, no destructiva. **No tocar el sync de catálogo de Holded** — solo añadir el overlay local.
- UX metodología: feedback <100 ms, sin modales en flujo crítico, `tabular-nums` en los minutos, estado vacío informativo.

## Entregables
- Migración Prisma (`service_scheduling`, `resource`, `service_resource_need`, `Tenant.agendaEnabled`) + índices por tenant.
- Endpoints REST con JSON Schema, tests y aislamiento por tenant.
- Panel de edición de scheduling + recursos, gated por `agendaEnabled`.
- Duración por línea en el ticket (informativo).
- **Criterio de "funciona"**: en un tenant con `agendaEnabled`, editar duración/pausa/nº profesionales/canales de un servicio y sus recursos; un servicio con `onlineBookable=false` queda marcado como no ofrecible en reserva (contrato para B4/B6); un servicio sin fila `service_scheduling` es ignorado por la agenda. Tenant sin `agendaEnabled` → panel oculto.

## Fuera de alcance (explícito)
- Packs / experiencias / ofertas (agrupar servicios) — fase posterior.
- Descuentos y cupones.
- El motor de disponibilidad y las vistas de agenda (B4).
- Turnos y matriz de skills de empleado (B3).
- Modificar precio/IVA (eso es Holded).
- Venta/reserva online (B6).
