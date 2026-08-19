# Módulo Citas + Clientes + Bonos · Kickoff de arranque

> **Nombre del módulo:** **Mi Piace Reservas** (prefijo `reservas` en bloques y código).
> Nació como "módulo Koibox" por el competidor de referencia (Koibox/SYHUX); ese nombre se retiró el 2026-08-19.
> **Nombre de producto:** módulo de **Citas, Clientes y Bonos** — capa horizontal, no vertical.
> **Origen del spec:** revisión SYHUX 260804a + funcionalidades Koibox (04/08/2026), reconciliada con el trabajo previo del repo.
> **Fecha kickoff:** 2026-08-04 · Revisión CTO.
> **Precursores en el repo (no se reinventan):** `docs/design/agenda-belleza-spec.md`, `docs/verticals/peluqueria.md`, `docs/06-modelo-datos.md`, `docs/04-stack-y-decisiones.md`.

---

## 0. Decisión de producto (leer antes que nada)

**Qué es.** Un módulo que añade al TPV tres piezas que hoy no existen: **agenda de citas**, **ficha de cliente/CRM** y **bonos/tarjetas regalo**, más las extensiones de catálogo y caja que las sostienen. Es lo que hoy cubre Koibox y su clon SYHUX.

**Qué NO es.** No es "el vertical peluquería". Es una **capa horizontal** que cualquier negocio con cita puede encender:

| Negocio | Hoy | Con el módulo |
|---|---|---|
| Sole (peluquería) | TPV retail + servicios en producción | **Cliente 0 de agenda**: cita → cobro pre-poblado, ficha histórica, bonos |
| Raquel Torres (spa/belleza) | Koibox + web (cliente 0 del spec de agenda) | Migra a agenda nativa multi-terapeuta |
| Clínica / estética / fisio | — | Mismo motor: profesional + servicio + duración + cita |
| Thalía (tienda) | TPV retail | **No lo activa** — no tiene cita |

Por eso el módulo se **activa por capability flag por tenant** (ADR-R6), no por un `businessType` clavado a belleza, y el vocabulario es neutro: **cliente / profesional / servicio**, nunca estilista/terapeuta.

**Tensión honesta (CTO).** En `roadmap-master.md` la agenda (P-2) está diferida a *post-15-clientes*, y `agenda-belleza-spec.md` la sitúa en Q4'26/Q1'27. Arrancarla ahora (04-ago-2026) es una **decisión de producto deliberada**: abre un segundo frente que compite con estabilizar los bares. Se arranca por **docs y bloques pequeños** (esta metodología) para no romper nada en producción; el primer bloque (CRM) es aditivo y no toca el camino de cobro sano (ADR-010). El principio rector del roadmap sigue mandando: *ningún cliente piloto con bug abierto antes de meter feature nueva*.

---

## 1. Lo que ya existe y NO se reinventa

Mapeo del spec de 10 módulos contra el repo actual (`apps/tpv-web` PWA React+Vite, `apps/api` Fastify+Prisma+Postgres, `apps/admin`, worker BullMQ, catálogo espejo de Holded):

| Del spec | Estado real en el repo | Consecuencia |
|---|---|---|
| Catálogo de servicios con precio/coste/IVA | ✅ Existe (servicios = `product.kind=SERVICE`, espejo de Holded, `serviceId`) | Se **extiende**, no se crea tabla nueva de servicios (ADR-R1) |
| Ticket con servicios y productos | ✅ Existe (`ticket`, `ticket_line`, `ticket_payment`) | Se añaden tipos de línea (bono, canje) |
| Formas de pago, arqueo, caja Z | ✅ Existe (turnos, arqueo, corte manager PIN) | Se amplía con línea de venta/canje de bono |
| Multipago (cash+card+bizum) | ✅ Existe | Reutilizable para señal de reserva |
| Empleados con rol y PIN | 🟠 Parcial (`user` con role/PIN, sin horario laboral) | Se añade horario/turnos y matriz skill (B3) |
| Realtime entre pantallas | ✅ Existe (WebSocket por `store:register`, ADR-002 B7) | La agenda se cuelga de este bus |
| Impresión ESC/POS, cajón, escáner HID | ✅ Existe (agente local, ADR-006/011) | El **QR de bono** se valida por el escáner ya integrado |
| Motor de agenda (disponibilidad, GiST, políticas) | 📄 **Especificado** en `agenda-belleza-spec.md`, sin implementar | Se **implementa traduciendo** convenciones (ver §2) |
| Ficha de cliente / CRM | ❌ No existe | **Nuevo desde cero — es la base de todo (B1)** |
| Bonos / tarjeta regalo / crédito | ❌ No existe | Nuevo (B5) |
| Reserva online | ❌ No existe (hay CTA→WhatsApp en web RT, fase 0) | Nuevo (B6) |
| Recordatorios / marketing | ❌ No existe | Nuevo (B7, fase 2 salvo recordatorio de cita) |
| Stock de productos | 🟠 Parcial (informativo desde Holded; roadmap Inventory A/B) | Fuera de este módulo — lo cubre el roadmap de inventario |
| Informes | 🟠 Parcial (dashboard básico en roadmap) | Se amplía con métricas de agenda/bonos (fase 2) |

**Regla de oro:** todo lo ✅ se reutiliza tal cual; lo ❌/📄 es el trabajo real de este módulo.

---

## 2. Reconciliación con `agenda-belleza-spec.md` (la trampa de traducción)

El spec de agenda es excelente y se **hereda casi entero** (motor de disponibilidad, GiST anti-solapes, capa de políticas, interfaz `BookingEngine`). Pero nació en el ecosistema Raquel Torres (Prisma propio, `cuid`, `priceCents`, tabla `Service` propia, Stripe). Aquí las convenciones son otras. Traducción obligatoria:

| En `agenda-belleza-spec.md` (RT) | En este repo (mipiacetpv) | Por qué |
|---|---|---|
| Tabla `Service` propia con `priceCents`, `durationMin`… | `product` (kind=SERVICE, espejo Holded) **+ tabla de extensión** `service_scheduling` con `duration_min`, `buffer_before/after`, `staff_required`, `online_bookable`, `family`, flags de canal | El precio/IVA es de Holded (emisor). No duplicar catálogo (ADR-R1) |
| `id String @default(cuid())` | `uuid` (convención del repo) | Coherencia con `06-modelo-datos` |
| `Staff` propio | Extender `user` + tabla `staff_profile`/`staff_shift`/`staff_skill` | Los empleados ya existen como `user` |
| Señal con **Stripe** | **Redsys/Bizum/el TPV** (Stripe no está en mipiacetpv) | El ecosistema de pago aquí no es Stripe; decidir pasarela en B6 |
| `GiftCard`/`GiftCardAppointment` (doc 11 RT) | Tablas `voucher`/`gift_card` nuevas + canje que descuenta saldo | No hay migración RT aquí; se diseña nativo (B5) |
| `SalesReceiptLine` local | `ticket_line` + sync Holded con `serviceId`/`sku` | El cierre fiscal es Holded |

Lo que se **hereda sin cambios**: el algoritmo de disponibilidad por retícula de 15 min (§3 del spec), el `EXCLUDE USING gist` sobre `tstzrange` (§4), la capa de `BookingPolicy` como funciones puras parametrizables por centro (§5), y la interfaz `BookingEngine` para que el front de reserva no distinga motor (§7). Multi-profesional (`staff_required=K`, `AppointmentAssignment` M:N) también se hereda — sirve igual a una "sinfonía a 4 manos" de spa que a una clínica donde una intervención necesita 2 profesionales + 1 sala.

---

## 3. ADRs del módulo (propuesta — revisar una a una)

> Estas ADRs deben integrarse en `docs/04-stack-y-decisiones.md` **una vez aprobadas**. Se dejan aquí como propuesta para revisión de producto (la metodología: un bloque no cierra hasta que producto revisa las decisiones no consultadas).

### ADR-R1 · Modelo de datos: extensión local sobre el catálogo Holded, NO tabla de servicios paralela
- **Contexto:** el spec de agenda trae `Service` propia con precio y duración; aquí los servicios son espejo de Holded (`product.kind=SERVICE`, `serviceId`).
- **Decisión:** los datos de agenda (duración, pausas/buffers, `staff_required`, flags de canal, familia) viven en una tabla **`service_scheduling`** referenciada por `product_id`. El precio, IVA y alta siguen en Holded. Cliente, cita, bono y horario son tablas **locales nuevas** (no existen en Holded).
- **Alternativa descartada:** tabla `Service` paralela (duplica catálogo, dos fuentes de verdad de precio → descuadres fiscales).
- **Consecuencia:** un servicio sin fila en `service_scheduling` simplemente no es reservable ni tiene duración → la agenda lo ignora. Migración: backfill vacío, se rellena por servicio en el panel.
- **Herencia:** hereda del spec RT el *modelo lógico* de la agenda; diverge en la *fuente de verdad* del catálogo.

### ADR-R2 · Cliente/CRM: fuente de verdad local, espejo mínimo a contactos de Holded
- **Decisión:** la **ficha de cliente vive local** (nombre, contacto, historial de visitas y compras, saldo de bonos, ficha técnica por servicio, consentimientos RGPD). El contacto de Holded se usa solo para lo fiscal/facturación, enlazado por `holded_contact_id` (nullable). Al cobrar, si el cliente necesita factura, se enlaza/crea contacto en Holded como hoy.
- **Alternativa descartada:** meter el CRM dentro de los contactos de Holded (Holded no modela historial clínico/técnico ni saldo de bonos; y ataría datos personales al sistema fiscal).
- **Consecuencia:** RGPD y ficha técnica son responsabilidad nuestra (ya hay base legal en `docs/legal/`). El cliente es **único y compartido** entre agenda, TPV y bonos.

### ADR-R3 · Fiscalidad de bonos y tarjetas regalo: Holded sigue siendo el emisor
- **Contexto:** vender un bono/cheque es **cobro anticipado**; canjearlo es entregar el servicio ya pagado. Riesgo de **doble cobro fiscal** si se emite documento al vender *y* al canjear.
- **Decisión (a confirmar con asesor):** la **venta** del bono genera el cobro y su registro fiscal **en Holded** (documento en el momento de la venta). El **canje** en caja **no re-emite documento fiscal** por la parte del bono: descuenta saldo/sesiones y, si hay extras (productos, servicios no incluidos), esos sí van al ticket normal. El tratamiento de IVA del bono (monopropósito vs multipropósito) lo decide el asesor.
- **Herencia:** extiende ADR-008 (Holded emisor) y el marco legal del proyecto: **mipiacetpv NO implementa lógica fiscal propia**.
- **⚠️ Bloqueante fiscal:** esta ADR **debe confirmarla el asesor fiscal / Holded** antes de que B5 salga a producción. No se codifica lógica fiscal a ciegas.

### ADR-R4 · Concurrencia de agenda: imposible solapar a nivel de BD (GiST)
- **Decisión:** se hereda literal del spec (§4): `tstzrange` + `EXCLUDE USING gist (staff_id WITH =, timeslot WITH &&)` para staff y recursos, filtrado por estados `PENDING/CONFIRMED`. Los solapes no se previenen en código: son físicamente imposibles en Postgres.
- **Consecuencia:** las carreras de reserva (dos clientes, mismo hueco) las resuelve la BD; el INSERT que pierde recibe el conflicto y se le ofrecen alternativas.

### ADR-R5 · Reserva online embebible en la web de cada negocio (requisito fundamental)
- **Contexto (decisión Matías 2026-08-04):** la reserva online NO es una feature más — es **el objetivo del módulo de reserva** (decálogo nº4: el fin de cada web es la reserva). El cliente final debe poder reservar **solo, desde la web del propio negocio**, sin intervención.
- **Decisión:** se construye un **widget embebible** (snippet `<script>`/iframe que el negocio pega en su web — WordPress, HTML, redes) contra la interfaz `BookingEngine`. La agenda nativa es el `MipiacetpvAdapter`; un cliente aún en Koibox usa el mismo widget con `KoiboxAdapter`. Precedente ya en producción: el CTA "Solicitar cita" → WhatsApp de la web de Raquel Torres (fase 0) es la misma vía de integración, sin motor detrás todavía.
- **Lo que arrastra a arquitectura:**
  - **Endpoint público separado de la API autenticada del TPV** (el cliente final no tiene login). `POST` de reserva + `GET` de disponibilidad, sin JWT de cajero.
  - **CORS restringido al dominio de cada tenant** + **rate-limit y anti-abuso** (que un bot no llene la agenda de citas basura). Anti-abuso reforzado por la señal (abajo).
  - **Marca blanca por tenant**: logo y colores del negocio, nunca de Mi Piace. Heredado del spec RT (marca RT total).
  - **Cada reserva crea/enlaza un `client` con `source=WEB` + consentimiento RGPD** → **B1 (CRM) debe aceptar altas desde canal público**, no solo desde caja.
  - La capa de políticas (§5 del spec) corre **encima** del adaptador: la web solo ofrece huecos que las reglas del centro permiten.
- **Herencia:** heredado del spec RT §7 (BookingEngine, marca blanca); aquí se implementa el adaptador nativo y el widget multi-tenant.

### ADR-R5b · Señal al reservar como palanca anti-no-show (decisión abierta)
- **Contexto:** la palanca real contra el no-show en reserva online es **cobrar señal o el servicio al reservar**. El spec RT usaba Stripe; aquí no hay Stripe.
- **Decisión (pendiente Matías):** definir si la señal es **núcleo de B6** o se difiere. Si es núcleo, decidir pasarela con lo que ya usa el ecosistema (Redsys/Bizum), no introducir Stripe. Impacto: la señal cobrada se refleja en `appointment.deposit_cents` y se concilia con el ticket al completar la cita.

### ADR-R6 · Activación por capability flag, no por vertical clavado
- **Contexto:** la agenda no es "peluquería". Sirve a peluquería, belleza, **clínicas**, estética, fisio…
- **Decisión:** el módulo se activa por **flags de capacidad por tenant**, independientes del `businessType`. Un tenant SERVICES o RETAIL puede encender agenda; Thalía la deja apagada.
- **Patrón (fijado en B1):** cada capability es una **columna booleana en `Tenant`** (`crmEnabled` ya existe desde B1; `agendaEnabled` la crea B2; vendrán `bonosEnabled`, `reservaOnlineEnabled`), NO un jsonb `capabilities`. Columnas explícitas: tipadas, indexables, en migración. B4/B5/B6 siguen el mismo patrón.
- **Consecuencia:** la UI del TPV muestra/oculta agenda, ficha de cliente y bonos según esos flags. Nada de `if (businessType === 'BEAUTY')`.

### ADR-R7 · QR de bono/regalo: token opaco firmado, validado por el escáner ya integrado
- **Decisión:** cada bono/tarjeta lleva un **token único opaco** (firmado, no adivinable) codificado en QR. Se valida en caja **con el lector de código de barras HID que ya existe** (ADR-011) — cero hardware nuevo. El canje comprueba saldo/caducidad server-side.
- **Consecuencia:** el QR se puede imprimir (agente ESC/POS) o enviar por email/WhatsApp; validación siempre contra servidor, nunca solo local.

---

## 4. Modelo de datos nuevo (sobre `06-modelo-datos.md`)

Tablas nuevas, todas con `tenant_id` indexado (aislamiento por fila, ADR multi-tenant). Boceto — Code lo refina en Prisma:

```
─── CRM (B1) ───────────────────────────────────────────────
client
  id (uuid, pk) · tenant_id (fk)
  first_name · last_name · phone (index) · email · birthdate?
  holded_contact_id?      -- enlace fiscal, nullable
  marketing_opt_in (bool) · notes
  created_at · updated_at
client_consent           -- RGPD (B1, campos; firma en fase 2)
  id · client_id (fk) · kind (DATA|TREATMENT) · granted_at · doc_ref?
client_note_technical    -- ficha técnica por servicio (B1 mínima / amplía B4)
  id · client_id (fk) · service_id? · body (text estructurado) · created_by · created_at

─── Catálogo extendido (B2) ────────────────────────────────
service_scheduling       -- extensión de product(kind=SERVICE)
  product_id (fk, pk) · tenant_id (fk)
  duration_min · buffer_before_min · buffer_after_min
  staff_required (int, default 1)
  online_bookable (bool, default false)
  family? · channels (jsonb: {caja,ticket,agenda,online})
resource                 -- cabinas, salas, aparatos (clínica: box, ecógrafo…)
  id · tenant_id · name · kind (CABIN|ROOM|DEVICE)
service_resource_need
  service_id (fk) · resource_kind · qty

─── Personal / horarios (B3) ───────────────────────────────
staff_profile            -- extiende user
  user_id (fk, pk) · tenant_id · display_name · active · color?
staff_skill              -- matriz empleado × servicio
  user_id (fk) · service_id (fk)  [pk compuesta]
staff_shift              -- turnos como plantillas recurrentes + excepciones
  id · user_id (fk) · rrule (RFC5545) · start_time · end_time
  valid_from · valid_until? · kind (REGULAR|REINFORCEMENT|SWAP)

─── Agenda (B4) ────────────────────────────────────────────
appointment
  id · tenant_id · client_id (fk) · service_id (fk)
  status (PENDING|CONFIRMED|IN_ROOM|COMPLETED|NO_SHOW|CANCELLED)
  timeslot (tstzrange)        -- GiST anti-solape (ADR-R4)
  source (WEB|PRESENCIAL|GIFT_REDEMPTION|PHONE)
  voucher_id?                 -- si es canje de bono
  deposit_cents?              -- señal cobrada
  pending_until?              -- TTL pre-reserva
  ticket_id?                  -- enlace al ticket al COMPLETED
  created_at
appointment_assignment       -- M:N cita ↔ staff/recurso (multi-profesional)
  id · appointment_id (fk) · user_id? · resource_id?
booking_block                -- bloqueos (vacaciones, formación, cierres)
  id · scope (CENTER|STAFF:<id>|RESOURCE:<id>) · timeslot · rrule? · reason
booking_policy               -- reglas por centro, funciones puras parametrizadas
  id · key (uniq) · value (jsonb)

─── Bonos / regalo (B5) ────────────────────────────────────
voucher                      -- bono por sesiones o por importe
  id · tenant_id · client_id? · type (SESSIONS|AMOUNT)
  token (uniq, opaco firmado) -- QR (ADR-R7)
  sessions_total? · sessions_left?
  amount_total_cents? · amount_left_cents?
  service_scope (jsonb: servicios incluidos)
  expires_at? · status (ACTIVE|REDEEMED|EXPIRED|CANCELLED)
  sold_ticket_id             -- ticket de la venta (fiscal, ADR-R3)
  created_at
voucher_movement             -- trazabilidad de saldo (auditabilidad, principio UX)
  id · voucher_id (fk) · delta_sessions? · delta_amount_cents?
  ticket_id? · appointment_id? · created_at
gift_card                    -- tarjeta/cheque regalo (variante de voucher AMOUNT
                             --   sin client_id fijo hasta canje) — puede unificarse
                             --   con voucher; decidir en B5
```

---

## 5. Integración con Holded (dónde toca el sistema fiscal)

- **Cita → ticket:** una `appointment` en `COMPLETED` genera/enlaza líneas de `ticket` (servicio con `serviceId`, no `sku`). El ticket cierra como hoy (GET-back, tolerancia 5 cts, `/pay` idempotente — ADR-010). La agenda **genera demanda**; el TPV **cierra caja**.
- **Venta de bono → Holded (ADR-R3):** al vender el bono se cobra y se registra el documento fiscal en Holded en el momento de la venta. `voucher.sold_ticket_id` guarda el enlace.
- **Canje de bono:** descuenta saldo local, **sin re-emitir** documento por la parte cubierta. Extras al ticket normal.
- **Cliente ↔ contacto Holded:** enlace `holded_contact_id`, solo cuando hace falta factura. El CRM no vive en Holded (ADR-R2).
- **⚠️ Pendiente asesor (bloquea B5 en prod):** tratamiento IVA del bono (mono/multipropósito) y confirmación de que canjear sin re-emitir es correcto. No se codifica lógica fiscal a ciegas (marco legal del proyecto).

---

## 6. Grafo de dependencias (el orden real, no el del spec)

El spec numera por prioridad; el orden de construcción lo manda el grafo:

```
        ┌─────────────────────┐        ┌──────────────────────────┐
        │ B1 · CRM / Cliente  │        │ B2 · Catálogo servicios  │
        │ (0 dependencias)    │        │ extendido (dur/buffer/    │
        └──────────┬──────────┘        │ flags canal/familia)     │
                   │                   └──────────┬───────────────┘
                   │        ┌─────────────────────┤
                   │        │  B3 · Personal +     │
                   │        │  horarios + skills   │
                   │        └──────────┬───────────┘
                   │                   │
                   ▼                   ▼
             ┌───────────────────────────────────┐
             │ B4 · Agenda (motor disponibilidad, │
             │ vistas, estados, cita→caja)        │
             └───────┬───────────────────┬────────┘
                     │                   │
          ┌──────────▼─────────┐  ┌──────▼──────────────┐
          │ B5 · Bonos/regalo  │  │ B6 · Reserva online │
          │ (QR, saldo, caja,  │  │ (widget, dispo real,│
          │ Holded anticipo)   │  │ confirmación)       │
          └────────────────────┘  └──────┬──────────────┘
                                          │
                                   ┌──────▼──────────────┐
                                   │ B7 · Recordatorios  │
                                   │ (cita 24/48h)       │
                                   └─────────────────────┘
```

- **B1 y B2/B3 son paralelizables** (tocan áreas distintas: CRM nuevo vs catálogo/usuarios existentes) → se pueden lanzar a la vez en sesiones de Code distintas.
- **B4 (agenda) es el cuello**: necesita B1 + B2 + B3.
- **B5 (bonos)** necesita B1 (cliente) + caja (ya existe) + Holded. Puede solaparse con B6.
- **B6 (reserva online)** necesita B4 + flags online de B2.

---

## 7. Roadmap de bloques MVP

MVP = módulos 3, 4, 5, 6 del spec + ampliaciones de 1 y 2. Traducido a bloques:

| Bloque | Alcance | Prerreq. | Fuera de MVP |
|---|---|---|---|
| **B-reservas-1 · CRM / Ficha de cliente** | Tabla `client` + búsqueda A–Z + alta/edición + historial (compras y citas, ligado a ficha) + saldo de bonos (lectura) + campos RGPD + ficha técnica mínima | — | Firma digital consentimiento; segmentación marketing |
| **B-reservas-2 · Catálogo de servicios extendido** | `service_scheduling` (duración, buffers, `staff_required`, familia, flags de canal Caja/Ticket/Agenda/Online) + panel de edición + recursos | — | Packs/experiencias, cupones (fase 2) |
| **B-reservas-3 · Personal + horarios** | `staff_profile` + `staff_shift` (RRULE) + matriz `staff_skill` | — | Fichaje/control horario, comisiones (fase 2) |
| **B-reservas-4 · Agenda** | Vistas día/semana/mes, columna por profesional, cita=servicio+duración, motor de disponibilidad (retícula 15 min), GiST anti-solape, estados de cita, bloqueos, **cita→caja pre-poblada** | B1,B2,B3 | Lista de espera avanzada, recepción multi-sala (fase 2) |
| **B-reservas-5 · Bonos y tarjetas regalo** | Tipos (sesiones/importe), QR firmado, saldo+caducidad+avisos, venta y canje en caja, venta→Holded (anticipo), crédito de cliente | B1 + caja + **✔ asesor fiscal** | Venta online de bonos (va con B6) |
| **B-reservas-6 · Reserva online embebible** | **Widget insertable en la web de cada negocio** (marca blanca), endpoint público (sin login, CORS por dominio del tenant, anti-abuso), disponibilidad en tiempo real, confirmación email/WhatsApp + alta en agenda, `BookingEngine`, alta de cliente `source=WEB` | B4, B2(flags online), B1(alta pública) | Venta online de bonos; **señal al reservar → decisión abierta ADR-R5b** |
| **B-reservas-7 · Recordatorio de cita** | Aviso automático WhatsApp/SMS/email 24/48h antes | B4, B1 | Post-visita/reseñas, recuperación, campañas (fase 2) |

**Fase 2 (spec 7–10):** post-visita y reseñas, recuperación de clientes, campañas, stock (ya en roadmap de inventario), personal avanzado (fichaje/comisiones), informes de agenda/bonos.

---

## 8. Qué NO va (explícito)

- **No** se toca el camino de cobro sano (GET-back, tolerancia, `/pay` idempotente). El módulo se cuelga de él, no lo reescribe.
- **No** se implementa lógica fiscal propia para bonos: se confirma con asesor y se registra en Holded (ADR-R3, ADR-008).
- **No** se crea tabla de servicios paralela ni se duplica precio/IVA (ADR-R1).
- **No** se clava el módulo a "peluquería" ni a un `businessType` (ADR-R6). Vocabulario neutro.
- **No** entra Stripe: la pasarela para señal de reserva se decide en B6 con lo que ya usa el ecosistema.
- **No** entra stock/inventario en este módulo (lo cubre el roadmap Inventory A/B/C).
- **No** se activa para Thalía ni para ningún tenant que no encienda la capability.

---

## 9. Plan de validación con usuario real

- **Cliente 0 = Sole (peluquería, ya en producción).** Es el piloto natural de agenda: hoy vende en modo retail; con B1–B4 pasa a cita → cobro pre-poblado + ficha histórica. Validar con ella la agenda antes de abrir reserva online.
- **Cliente de contraste = Raquel Torres (spa)** para multi-profesional y políticas; **una clínica** para probar que el vocabulario y el modelo (profesional + sala/recurso) encajan fuera de belleza.
- **Cuenta Holded de peluquería de pruebas** ya disponible (ver `peluqueria.md` §4): verificar Veri*factu OFF, inventariar productos vs servicios antes de empezar.
- **Tests de la metodología:** test de los 30 s (la agenda del día se entiende sin explicar), test de carga (10 citas creadas en 5 min), sesión de 1 h sin instrucciones.
- **Métrica de éxito del MVP (una):** *nº de citas del día que se cierran en caja desde la agenda sin re-teclear el ticket* (mide que la cadena cita→cobro funciona de verdad).

---

## 10. Siguiente paso inmediato

1. **Revisar las ADRs K1–K7 una a una** (sobre todo K3 fiscal → disparar consulta al asesor, es lo único que puede bloquear B5).
2. **Lanzar B-reservas-1 (CRM) en Claude Code** con el prompt canónico adjunto (`bloque-reservas-1-crm.md`). Es aditivo, cero riesgo sobre producción, y desbloquea todo lo demás.
3. En paralelo, producto prepara los mockups de agenda (heredando `agenda-belleza-spec.md`) y el prompt de B2/B3 mientras Code hace B1.

> Los mockups HTML navegables de CRM y Agenda (con datos reales de Sole) son el siguiente entregable de la capa de producto, antes de implementar B4.

---

*Mi Piace Internet Solutions · Kickoff módulo Citas+Clientes+Bonos · 2026-08-04 · reconcilia agenda-belleza-spec.md + spec SYHUX/Koibox 260804a.*
