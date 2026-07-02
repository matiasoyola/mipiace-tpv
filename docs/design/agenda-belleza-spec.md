# Módulo de Agenda y Reservas — Especificación técnica para mipiacetpv (mipiacetpv)

> **Origen:** proyecto Raquel Torres Spa (Mi Piace, jul-2026). Diseño extraído del análisis de Koibox
> (plan Platinum + API) y del diseño de agenda de la consultoría Fase 1.
> **Destino:** vertical belleza de mipiacetpv. Raquel Torres = cliente 0.
> **Relación:** complementa `rt-gift-cards/docs/11-FUTURE-MIGRATION-MIPIACETPV.md` (cheques regalo → Prisma 1:1).

---

## 1. Contexto y estrategia

La web del spa (WordPress + rt-catalogo-app) necesita reserva online **con la marca del cliente y
sus reglas de agenda**. Koibox (su software de gestión actual) ofrece dos vías:

| | Ruta A · Booking nativo Koibox | Ruta B · API Koibox (Platinum, 55 €/mes) |
|---|---|---|
| UX | Página genérica en `reservas.koibox.cloud` — saca al cliente de la web, estética pobre | La reserva vive en nuestra web |
| Reglas de agenda | Las de Koibox | Las nuestras (capa de política propia) |
| Multi-terapeuta | Dudoso | Componible desde fuera |
| Decisión | **Descartada** | **Elegida como fase intermedia** |

**Estrategia de dos adaptadores:** la UI de reserva de la web se construye una sola vez contra una
interfaz `BookingEngine`. Hoy la sirve `KoiboxAdapter` (API Platinum); cuando mipiacetpv tenga el módulo
de agenda, se cambia a `MipiacetpvAdapter` sin tocar el front. Koibox funciona mientras tanto como
"maqueta de requisitos" de pago y fuente de datos reales de un spa en producción.

```
Web catálogo (marca RT)
        │
   BookingEngine (interfaz)
      ┌─┴──────────────┐
KoiboxAdapter      MipiacetpvAdapter
 (2026, ya)        (Q4'26/Q1'27)
```

---

## 2. Modelo de datos (Prisma / Postgres)

Los modelos `Client`, `Service`, `Staff`, `SalesReceipt`, `GiftCard` ya existen o están previstos
en mipiacetpv. La agenda añade:

```prisma
model Service {
  id                String   @id @default(cuid())
  slug              String   @unique
  name              String
  durationMin       Int
  bufferBeforeMin   Int      @default(0)
  bufferAfterMin    Int      @default(0)
  priceCents        Int
  onlineBookable    Boolean  @default(false)   // Ritual Secreto, grupos → false
  staffRequired     Int      @default(1)        // Sinfonía 4 Manos = 2 · 8 Manos = 4
  skills            StaffSkill[]
  resourceNeeds     ServiceResourceNeed[]
}

model Staff {
  id        String   @id @default(cuid())
  name      String
  active    Boolean  @default(true)
  skills    StaffSkill[]
  shifts    Shift[]
  assignments AppointmentAssignment[]
}

/// Matriz empleada × servicio — el diseño de consultoría hecho dato.
/// Irene solo rituales/terapéuticos; Andrea solo relax y faciales básicos; Alba sin terapéuticos…
model StaffSkill {
  staffId   String
  serviceId String
  staff     Staff   @relation(fields: [staffId], references: [id])
  service   Service @relation(fields: [serviceId], references: [id])
  @@id([staffId, serviceId])
}

/// Turnos como PLANTILLAS recurrentes + excepciones puntuales.
/// Expresa anclajes permanentes escalonados (Judit/Yantina L-X mañana, J-V doble),
/// alternancias quincenales (Alba) y horarios fijos (Mamen).
model Shift {
  id         String   @id @default(cuid())
  staffId    String
  staff      Staff    @relation(fields: [staffId], references: [id])
  rrule      String   // RFC 5545 (p.ej. FREQ=WEEKLY;BYDAY=MO,TU,WE)
  startTime  String   // "09:30"
  endTime    String   // "14:30"
  validFrom  DateTime
  validUntil DateTime?
  kind       ShiftKind @default(REGULAR) // REGULAR | REINFORCEMENT | SWAP (canjes VIP de Irene)
}

/// Cabinas, jacuzzi, aparatología (INDIBA). Evita sobrevender espacio.
model Resource {
  id       String @id @default(cuid())
  name     String
  kind     String // CABIN | JACUZZI | DEVICE
  needs    ServiceResourceNeed[]
}

model ServiceResourceNeed {
  serviceId  String
  resourceKind String   // requiere 1 recurso de este tipo (no uno concreto)
  qty        Int @default(1)
  service    Service @relation(fields: [serviceId], references: [id])
  @@id([serviceId, resourceKind])
}

model Appointment {
  id          String   @id @default(cuid())
  clientId    String
  serviceId   String
  status      AppointmentStatus // PENDING | CONFIRMED | COMPLETED | NO_SHOW | CANCELLED
  timeslot    Unsupported("tstzrange")  // ver §4 — integridad a nivel de BD
  source      String   // WEB | PRESENCIAL | GIFT_REDEMPTION | KOIBOX_SYNC
  giftCardId  String?  // canje de cheque → GiftCardAppointment ya existe en el modelo
  depositCents Int?    // señal cobrada (Stripe)
  pendingUntil DateTime? // TTL de la pre-reserva con pago
  assignments AppointmentAssignment[]
  createdAt   DateTime @default(now())
}

/// M:N cita ↔ staff/recursos. LA pieza que Koibox no modela bien:
/// una Sinfonía de 8 Manos = 1 cita con 4 assignments de staff + 1 cabina.
model AppointmentAssignment {
  id            String  @id @default(cuid())
  appointmentId String
  staffId       String?
  resourceId    String?
  appointment   Appointment @relation(fields: [appointmentId], references: [id])
}

/// Bloqueos estructurales: cierre VIP (2 primeros sábados), sábado tarde = solo Ritual Secreto,
/// vacaciones, formación.
model Block {
  id        String   @id @default(cuid())
  scope     String   // CENTER | STAFF:<id> | RESOURCE:<id>
  timeslot  Unsupported("tstzrange")
  rrule     String?  // bloqueos recurrentes
  reason    String
}

/// Reglas de negocio parametrizables — "la consultoría hecha código". Ver §5.
model BookingPolicy {
  id        String @id @default(cuid())
  key       String @unique
  value     Json
}
```

---

## 3. Motor de disponibilidad

Firma del servicio (idéntica a la que expone `KoiboxAdapter`, para que el front no distinga motor):

```
availability(serviceId, dateRange) -> [{ start, end, staffOptions[] }]
```

Algoritmo por slot de retícula (15 min):

1. **Candidatas de staff:** `StaffSkill` match ∩ turno activo (expansión de `Shift.rrule`) ∩ sin
   solape en `Appointment` ∩ sin `Block`. Si `service.staffRequired = K`, hacen falta **K
   simultáneas** → pequeño matching (con K≤4 y plantilla de 7, fuerza bruta sobra).
2. **Recursos:** por cada `ServiceResourceNeed`, existe recurso del tipo libre en el intervalo
   (incluyendo buffers antes/después).
3. **Políticas (§5):** antelación, cupos por franja, cobertura mínima.
4. Slot válido ⇔ existe asignación factible completa. Se devuelve sin nombres de staff al público
   (solo huecos); la asignación concreta se fija al confirmar.

Coste: por día son ~40 slots × pocas empleadas — trivial. Cachear el día con invalidación por
webhook/creación de cita.

---

## 4. Integridad y concurrencia (el truco de Postgres)

Los solapes no se previenen "en el código": se hacen **físicamente imposibles en la base de datos**
con constraints de exclusión sobre rangos temporales:

```sql
ALTER TABLE appointment_assignment_slots  -- vista materializada assignment × timeslot
  ADD CONSTRAINT no_staff_overlap
  EXCLUDE USING gist (staff_id WITH =, timeslot WITH &&)
  WHERE (status IN ('PENDING','CONFIRMED'));
-- Ídem para resource_id.
```

Flujo de reserva transaccional:

```
1. availability() → cliente elige hueco
2. INSERT Appointment(status=PENDING, pendingUntil=now()+10min) + assignments
   → si el constraint salta: hueco perdido, devolver alternativas (carrera resuelta por la BD)
3. (opcional) señal con Stripe PaymentIntent
4. Confirmación → status=CONFIRMED · TTL vencido → job libera el hueco
```

Nota: señal con **Stripe** (ya integrado en el ecosistema RT) — ventaja directa sobre Koibox, que
obliga a Redsys.

---

## 5. Capa de políticas — el diseño de consultoría hecho código

Reglas del caso Raquel Torres que `BookingPolicy` debe poder expresar (y que el booking genérico de
Koibox NO expresa — razón de ser del módulo):

| Regla | Origen (consultoría Fase 1) |
|---|---|
| Cobertura mínima por franja (no vaciar la mañana: anclajes de Judit/Yantina) | Patrón de anclaje permanente escalonado |
| Máx. N rituales largos (>90 min) simultáneos por franja | Protección de cobertura |
| Sábado tarde: solo Ritual Secreto, nunca auto-reservable | Regla de negocio fija |
| 2 primeros sábados de mes: cierre VIP (bloqueo total, turnos 15:00-18:30 / 18:00-21:30) | Producto Sábado VIP |
| Servicios multi-terapeuta (Sinfonía 4/8 Manos): reservable solo si K staff compatibles libres | Catálogo 2026 |
| Antelación mín/máx, ventana de cancelación, política de no-show (+suplemento) | ADR-005 no-show |
| Servicios `onlineBookable=false` → derivar a flujo de solicitud (WhatsApp estructurado, ya en producción en la web RT) | UX fase 1 |

Evaluación: pipeline de policies `(slot, context) -> allow/deny/annotate` ejecutado tras el matching
físico. Cada policy es una función pura registrada; parámetros en BD → ajustables por centro sin
deploy. **Esto es lo que se vende como consultoría + software.**

---

## 6. Encaje con el TPV mipiacetpv

- **Cita → ticket:** `Appointment COMPLETED` genera/enlaza `SalesReceiptLine`. La agenda es el
  generador de demanda; el TPV, el cierre de caja.
- **Cheques regalo:** `GiftCardAppointment` ya existe en el modelo migrado (doc 11). Canje de cheque
  = crear cita con `source=GIFT_REDEMPTION` + marcar cheque canjeado al completarse.
- **Cliente único** compartido entre agenda, TPV y cheques (doc 11 ya mapea `purchaser/recipient`).
- **Recordatorios:** jobs 24/48h (email/WhatsApp) — mismo patrón Action-Scheduler ya probado en
  rt-gift-cards (`Notification_Scheduler`), portado al job runner de mipiacetpv.
- **Audit log:** patrón `*_events` de rt-gift-cards (probado en producción) reutilizado tal cual.

---

## 7. KoiboxAdapter (fase intermedia, 2026)

Mapeo de la interfaz contra la API Koibox (docs.koibox.cloud, header `X-Koibox-Key`, requiere
Platinum; **sin sandbox — opera sobre la agenda real**):

| BookingEngine | Koibox API |
|---|---|
| `availability(service, range)` | `GET /horas-disponibles` (empleado+servicios) — iterar empleadas compatibles |
| `book(...)` | `POST /citas` (+ `POST /clientes` si es nuevo) |
| `cancel(...)` | `PATCH /citas/:id` |
| `listServices()` | `GET /servicios` (+ `servicios-combinados`) |
| sync agenda ← Koibox | webhooks `cita-nueva` / `cita-actualizada` |

La capa de políticas (§5) se ejecuta **encima** del adaptador: Koibox propone huecos, nuestras
reglas filtran. Multi-terapeuta con Koibox: componer K llamadas de disponibilidad y reservar K citas
paralelas (validar en su cuenta; si no es fiable → esos servicios quedan en flujo de solicitud).

**Requisitos operativos ruta Koibox:** upgrade a Platinum (55 €/mes, +25 vs Basic actual; anual = 2
meses gratis), clave API por canal seguro, carga en Koibox de: horarios reales por empleada, matriz
servicios×empleada, cabinas como recursos, bloqueos VIP/sábados.

---

## 8. Roadmap propuesto

| Fase | Alcance | Cuándo |
|---|---|---|
| 0 (hecho) | CTA "Solicitar cita" → WhatsApp estructurado en la web RT | En dev, jul-2026 |
| 1 | Upgrade Platinum + config cuenta Koibox + `KoiboxAdapter` + UI de reserva en la web (piel RT) | Semanas tras reunión con Raquel |
| 2 | Módulo agenda mipiacetpv (este spec): modelo + motor + policies + panel interno | Con vertical belleza Q4'26/Q1'27 |
| 3 | Switch de adaptador Koibox→mipiacetpv para RT + migración datos (doc 11) + baja Koibox | 2-4 semanas tras v2 |

**Diferencial competitivo de mipiacetpv vs Koibox** (validado con un caso real): multi-terapeuta nativo,
políticas de agenda programables por centro, Stripe, marca blanca total en el flujo de reserva.

---

*Mi Piace Internet Solutions · 2-jul-2026 · Generado desde el proyecto Raquel Torres Spa.*
