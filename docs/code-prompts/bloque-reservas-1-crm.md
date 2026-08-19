# Bloque Reservas-1 · Ficha de cliente / CRM

> Primer bloque del módulo de Citas+Clientes+Bonos. Aditivo, sin tocar el camino de cobro. Desbloquea agenda (B4), bonos (B5) y reserva online (B6).

## Contexto (leer antes)
- `docs/design/reservas-modulo-kickoff.md` — kickoff del módulo, §1 (qué existe), §3 ADR-R2 y ADR-R6, §4 (modelo de datos), §7 (roadmap de bloques).
- `docs/design/agenda-belleza-spec.md` §2 y §6 — el cliente es único y compartido entre agenda, TPV y bonos.
- `docs/06-modelo-datos.md` — convenciones del esquema (uuid, `tenant_id` indexado, multi-tenant por fila).
- `docs/02-arquitectura.md` §2 — stack front (React+Vite PWA, TanStack Query, Zustand, Dexie) y API (Fastify+Prisma).
- `docs/04-stack-y-decisiones.md` — ADR-R2 (CRM local, espejo mínimo a Holded), ADR-R6 (capability flag).

## Alcance

Construir la **ficha de cliente / CRM** como base del módulo. Es una capa **local** (fuente de verdad propia), enlazada opcionalmente a contactos de Holded solo para lo fiscal (ADR-R2). Se activa por capability flag `agenda` (o `crm`) del tenant (ADR-R6); si está apagada, nada de esto aparece en la UI.

### Datos (API · Prisma · Postgres)
Modelos nuevos, todos con `tenantId` y aislamiento por fila (extension Prisma existente):
- `Client`: `id`, `tenantId`, `firstName`, `lastName`, `phone` (index por tenant), `email?`, `birthdate?`, `holdedContactId?` (nullable), `marketingOptIn` (bool, default false), `notes?`, `createdAt`, `updatedAt`.
- `ClientConsent`: `id`, `clientId`, `kind` (`DATA` | `TREATMENT`), `grantedAt`, `docRef?`. (Solo campos + alta manual; la firma digital es fase 2 — **fuera de alcance**.)
- `ClientTechnicalNote`: `id`, `clientId`, `serviceId?` (id de servicio Holded, no FK dura), `body` (text), `createdByUserId`, `createdAt`. Ficha técnica mínima (notas por servicio); vale igual para peluquería (fórmula de color) que para clínica (parámetros de tratamiento).
- Migración Prisma con backfill vacío. Índice `(tenantId, phone)` y búsqueda por nombre/teléfono/email.

### API (Fastify + JSON Schema)
- `GET /clients?query=&sort=az&cursor=` — búsqueda por nombre/teléfono/email, orden alfabético, paginado.
- `POST /clients` — alta (validación teléfono/email; teléfono único por tenant si se decide, o warning si duplicado).
- `GET /clients/:id` — ficha completa.
- `PATCH /clients/:id` — edición.
- `GET /clients/:id/history` — **historial unificado**: compras (tickets del cliente) + citas (aún no existen → devolver vacío con contrato estable para que B4 lo rellene) + movimientos de bono (vacío hasta B5). Cada entrada trazable a su origen (auditabilidad, principio UX).
- `GET /clients/:id/vouchers` — saldo de bonos (vacío hasta B5, contrato estable).
- Enlace a Holded: `holdedContactId` se rellena de forma perezosa — al crear/editar un cliente **no** se crea contacto en Holded; solo se enlaza cuando el flujo de cobro necesite factura (ese enlace lo hace el camino de cobro existente, aquí solo se persiste el id).

### Front (apps/tpv-web · PWA)
- Nueva sección **Clientes** en la navegación del TPV, visible solo si capability activa.
- **Lista A–Z** con buscador instantáneo (feedback <100 ms, filtrado sobre caché local Dexie; sync en background con TanStack Query). Estado vacío informativo, nunca pantalla en blanco.
- **Ficha de cliente**: datos + pestañas Historial / Ficha técnica / (Bonos: placeholder "disponible con el módulo de bonos"). Detalle inline, sin modales en flujo crítico.
- **Alta/edición** en formulario inline o panel lateral (no modal bloqueante).
- Preparar el **hook de selección de cliente reutilizable** (`useClientPicker`) — lo consumirán el carrito del TPV (asignar cliente a ticket) y B4 (asignar cliente a cita). Integrarlo con el atajo `F1 cliente` que ya existe en el TPV, apuntando ahora a este CRM.
- Persistencia offline en Dexie: tabla `clients` en el caché local para búsqueda sin red (coherente con contrato offline §4 de arquitectura). El alta offline entra en la cola outbox como el resto.

## Restricciones
- **ADR-R2**: el CRM es local. No volcar historial/ficha técnica/RGPD a Holded. `holdedContactId` es solo un enlace.
- **ADR-R6**: gate por capability flag por tenant. Cero `if (businessType === ...)`. Vocabulario neutro (**cliente/profesional/servicio**), nunca estilista/terapeuta/clienta.
- **Multi-tenant por fila**: todo lleva `tenantId`; usar la extension Prisma existente, nunca query sin tenant.
- **Offline-first** (ADR-001): búsqueda de clientes debe funcionar sin red desde Dexie; alta offline → outbox.
- **UX no negociable** (`docs/ux-principles.md` / metodología §4): feedback <100 ms, sin modales en flujo crítico, máx 8–12 elementos accionables por vista, scroll vertical, toda cifra trazable a su origen, deshacer 4 s en banner para borrados en vez de confirmación.
- No tocar el camino de cobro a Holded (GET-back/tolerancia/`/pay`, ADR-010). Este bloque es aditivo.

## Entregables
- Migración Prisma con `Client`, `ClientConsent`, `ClientTechnicalNote` + índices (backfill vacío).
- Endpoints REST anteriores con JSON Schema y aislamiento por tenant, con tests.
- Sección **Clientes** en `apps/tpv-web`: lista A–Z + buscador + ficha + alta/edición, offline con Dexie.
- Hook `useClientPicker` integrado con `F1 cliente` y listo para carrito y agenda.
- Contratos estables de `history` y `vouchers` (vacíos hoy) para que B4/B5 los rellenen sin romper el front.
- **Criterio de "funciona"**: en un tenant con capability activa, un cajero da de alta un cliente, lo busca por teléfono en <1 s (también sin red), lo abre, ve su historial de compras (tickets ya existentes de ese contacto) y lo asigna a un ticket con `F1`. En un tenant sin la capability, la sección Clientes no existe.

## Fuera de alcance (explícito)
- **Firma digital** de consentimientos RGPD (fase 2 — aquí solo campos y alta manual).
- **Saldo/movimientos de bonos reales** (los rellena B5; aquí solo el contrato vacío).
- **Historial de citas real** (lo rellena B4; aquí solo el contrato vacío).
- **Segmentación, campañas, recuperación de clientes** (módulo 7 del spec, fase 2).
- **Crear contactos en Holded** desde el CRM (el enlace lo hace el camino de cobro existente; aquí solo se persiste `holdedContactId`).
- **Duración de servicios, agenda, personal** (B2/B3/B4).
- Migración de datos desde Koibox/otra fuente (bloque aparte si se decide).
