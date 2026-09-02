# Cruce · el documento Koibox contra lo que B-reservas-4 ya construyó

> **Qué es esto.** `docs/reservas/00-koibox-ingenieria-inversa-y-modelo.md` llegó de Raquel Torres
> como documento de **entrada**. Su §8.3 dice que la agenda de aquí ya existe y retira su propio
> roadmap A0-A9 — pero eso lo escribió alguien leyendo el repo **desde fuera**. Este doc lo verifica
> **desde dentro**, fichero a fichero y línea a línea.
>
> **Quién manda.** Este proyecto. Un ADR cerrado aquí no se reabre porque un documento externo diga
> otra cosa: se anota como divergencia y se sigue. Lo que el documento aporta de verdad es lo que
> **no existe aquí todavía** (Parte 2) y las **correcciones medidas** sobre nuestros propios docs
> de diseño (Parte 3, **D-10**).
>
> **Método.** Todo veredicto lleva su ruta y su línea. Nada de memoria. Nada marcado `[H]` en el
> documento de origen se ha tratado como hecho: el §1.8 entero (esquema de BD de Koibox inferido) se
> ha leído como explicación de sus defectos, nunca como base de diseño.
>
> **Fecha:** 2026-09-02 · **Verificado contra:** `master` en `1d169ef` · **Migración de referencia:**
> `20260805010000_b_koibox_4_agenda`.

---

## 0. Veredicto en una tabla

| Hueco §8.3 | Veredicto | La prueba, en una línea |
|---|---|---|
| **H1 · yield / `BookingPolicy` vacía** | ✅ **CONFIRMADO** (y peor de lo que dice) | `BookingPolicy` no aparece en **ningún** `.ts` del repo: sólo en `schema.prisma:2032` y en la migración |
| **H2 · ventana reservable ≠ turno** | ✅ **CONFIRMADO** | `store.ts:203-222`: el motor lee la disponibilidad **directamente** de `staff_shifts`. Un concepto haciendo dos trabajos |
| **H3 · programa multisesión** | 🟡 **CONFIRMADO EN CÓDIGO, DESMENTIDO EN DISEÑO** | No hay tabla (`grep -i voucher schema.prisma` → sólo la columna `voucherId:1916`), **pero** el diseño cerrado ya tiene `voucher(type=SESSIONS)` con `sessions_left` y `voucher_movement.appointment_id` (`reservas-modulo-kickoff.md` §4), y el contrato de saldo ya está publicado vacío (`crm/routes.ts:449-462`) |
| **H4 · panel de salud** | ✅ **CONFIRMADO** | No existe ninguna pantalla de diagnóstico de agenda; el único "health" del front es el banner de Holded (`SalePage.tsx:2620`) |
| **H5 · suite de invariantes** | 🟡 **PARCIAL** | 19 tests de agenda: 3 invariantes plenos, 5 a medias, 6 sin nada. Y el más caro (el EXCLUDE real) **nunca se ha ejecutado contra Postgres** |
| **H6 · importación desde Koibox** | ✅ **CONFIRMADO** | Cero código de adaptador: en `apps/` el único `grep -i koibox` que casa es un **comentario** (`engine.ts:62`); el resto son cabeceras de migración |
| **H7 · auditoría UX como contraste** | ✅ **APORTA** (no es hueco) | La UI de B4 ya cumple varias de sus 13 reglas; le faltan 5 comprobables, listadas en **H7** |
| **H8 · datos reales del spa** | ✅ **APORTA** (no es hueco) | Y es **prerrequisito bloqueante**, no material de semilla: F1 y F2 **no existen todavía en ninguna parte**. Ver la **Parte 7** |

**Traducción a bloques:** se abren **B-reservas-6** (yield), **7** (ventana reservable), **8**
(programa multisesión, **como extensión del voucher, no como modelo paralelo**), **9** (panel de
salud) y **10** (importación/adaptador Koibox). H5 y H7 no son bloques: entran en el cierre de cada
uno. H8 es prerrequisito de datos, no bloque.

---

# Parte 1 · Qué de ese documento ya está resuelto aquí

## 1.1 La tabla del §8.3, verificada

Su §8.3 lista diez cosas "ya construidas allí" y remata con una conclusión en prosa. **Las diez son
ciertas, y la conclusión también.** Con la ruta:

| Lo que dice el §8.3 | Dónde está de verdad | ¿Correcto? |
|---|---|---|
| `appointment_assignments.slot` en `tstzrange` con `EXCLUDE USING gist` | `migration.sql:134-142` (`no_staff_overlap`, `no_resource_overlap`), `btree_gist` en `:19` | ✔ |
| `ServiceScheduling` con `durationMin` + `bufferBeforeMin`/`bufferAfterMin` | `schema.prisma:1736-1738` | ✔ |
| `staffRequired` | `schema.prisma:1741` (catálogo) y `:1954` (snapshot en el item) | ✔ |
| `Resource` + `ServiceResourceNeed` **por tipo** | `schema.prisma:1765` y `:1785`; el motor elige uno libre del pool en `engine.ts:368-395` | ✔ |
| `StaffSkill` — la matriz servicio × profesional | `schema.prisma:1835` | ✔ modelo sí, **dato no** (F1) |
| `Appointment` con `externalId` UNIQUE, `pendingUntil`, `depositCents`, `voucherId`, `ticketId` | `schema.prisma:1904`, `:1920`, `:1918`, `:1916`, `:1923` | ✔ |
| `AppointmentItem` con snapshot de duración/buffers/staffRequired | `schema.prisma:1951-1954` | ✔ |
| `BookingBlock` con `BlockScope` CENTER/STAFF/RESOURCE | `schema.prisma:2001`, enum en `:308` | ✔ |
| `AppointmentStatus` de 6 valores y `ReservationSource` de 4 | `schema.prisma:281` y `:292` | ✔ |
| Núcleo agnóstico cita/mesa (ADR-R8), multi-tenant por fila | `adr-r8-motor-reservas-agnostico.md` §1-§3; `agenda/engine.ts` cabecera | ✔ |
| El roadmap A0-A9 del documento queda retirado | — | ✔ **se confirma la retirada** |

## 1.2 Dónde somos **mejores** que lo que el documento propone

Esto no es orgullo: está aquí para que ninguna sesión futura "corrija" hacia atrás creyendo que el
documento externo va por delante.

**1 · El EXCLUDE está en el `assignment`, no en la cita. Mejor.**
El documento propone (§3.4) `EXCLUDE USING gist (staff_id WITH =, timeslot WITH &&)` sobre la cita.
Aquí la restricción vive en `appointment_assignments.slot` (`migration.sql:134-142`), y eso compra
cuatro cosas que la suya no puede dar:
- **Los buffers entran en el anti-solape** sin mentir en el rango que ve la clienta: el `timeslot`
  del visit es la duración comercial y el `slot` del assignment es `buffer + duración + buffer`
  (`engine.ts:326-329`). Su modelo, con un solo rango, obliga a elegir cuál de los dos números miente
  — que es exactamente el defecto que él le reprocha a Koibox en su §1.4.
- **Multi-terapeuta sale gratis**: una Sinfonía a 8 manos son 4 filas de assignment sobre la misma
  cita, cada una con su EXCLUDE. Sin tabla nueva.
- **Los recursos usan el mismo mecanismo** (`no_resource_overlap`, `migration.sql:139-142`), no una
  segunda invención.
- **El `tenant_id` va dentro de la clave del EXCLUDE** (`migration.sql:136`): el anti-solape es por
  inquilino, verificado en `agenda-engine.test.ts:511`. En un producto multi-tenant eso no es un
  detalle: sin él dos centros distintos se bloquean el mismo `staff_user_id`.
- Y el `active` parcial (`WHERE active AND staff_user_id IS NOT NULL`) hace que cancelar libere sin
  borrar — su invariante 7 resuelto por la BD, no por una rutina.

**2 · `AppointmentItem` con snapshot, en vez de `catalogDurationMin`. Mejor, y el propio documento lo
reconoce.**
Su delta 3 (Parte 4) pide `Service.catalogDurationMin` junto a `durationMin` para que la carta y la
agenda no mientan. Aquí el problema está resuelto **por otro lado y más arriba**: la duración, los
buffers y el `staffRequired` se congelan en la cita al crearla (`schema.prisma:1951-1954`), así que
editar el catálogo **no mueve el histórico**. Su invariante 12 lo cumple el esquema, no un test.
⚠️ Ojo: son dos problemas distintos y sólo uno está resuelto — ver la divergencia **D-5**.

**3 · El catálogo no se duplica (ADR-R1). Mejor que su modelo.**
El documento arrastra del SPEC una entidad `Service` con precio propio. Aquí el precio y el IVA
siguen en Holded y la agenda sólo añade lo que Holded no modela (`ServiceScheduling`,
`schema.prisma:1730-1763`, y ADR-R1 en `reservas-modulo-kickoff.md` §3). Una sola fuente de verdad de
precio; cero descuadres fiscales. **No se reabre.**

**4 · El núcleo es agnóstico cita/mesa. Va más lejos de lo que el documento pide, y él lo dice.**
Los enums nacen con los valores `TABLE` reservados (`schema.prisma:273-315`) para que hostelería caiga
encima sin migrar el núcleo.

**5 · El motor es nuestro desde el día uno.** Su ADR-F6 ("el motor es nuestro; Koibox, si acaso, un
adaptador más") no hay que decidirlo: ya está construido así. Koibox aquí **no existe** ni como
dependencia ni como fallback.

**6 · La simetría listar/reservar ya existe en la capa física.**
Su condición más importante del §3.5 ("las reglas se aplican al listar **y** al reservar") ya tiene
la fontanería puesta: `availability()` y `hold()` llaman **a la misma función** `planForStart()`
(`engine.ts:440` vs `engine.ts:497`, y `:570` al reprogramar). B-reservas-6 no tiene que inventar la
simetría: tiene que **colgar las reglas de un punto que ya es único**. Con un matiz que sí hay que
arreglar — ver **D-4b**.

**7 · Idempotencia y hold ya construidos** (`externalId` UNIQUE `schema.prisma:1904`, TTL en
`:1920`, job repeatable en `apps/api/src/workers/agenda-hold-ttl-worker.ts`), incluido el alta
**offline** por outbox desde el TPV, que su modelo ni contempla.

**8 · El puente cita→caja existe y es de casa.** `agenda/checkout.ts` abre un ticket DRAFT
pre-poblado por `serviceId`. Su Parte 2 nº 7 ("la agenda no cobra") aquí es literal y además está
cableado: la agenda genera demanda, el TPV cierra caja, y B-reservas-5 (ya escrito) cierra el ciclo.

## 1.3 Dónde estamos **igual**

Retícula de 15 min (`time.ts:15`), zona horaria del centro como dueño único del borde
(`time.ts:12`, `agenda-time.test.ts`), estados ricos con no-show separado de cancelada
(`schema.prisma:281`), `origen`/`source` del registro (`:292`), bloqueos con alcance centro /
profesional / recurso (`:308`), disponibilidad por **rango** en una llamada (su §3.6 —
`POST /agenda/availability` acepta `from`/`to`, `routes.ts:106` y `:149-150`), y "anular libera, no borra"
(no existe `DELETE /agenda/appointments/:id`; el único `app.delete` de agenda es el de bloqueos,
`routes.ts:475`).

## 1.4 Dónde estamos **peor** que Koibox, y hay que decirlo

| Cosa | Koibox | Aquí | Dónde se arregla |
|---|---|---|---|
| **Horario del centro como techo** (su §1.2) | Lo tiene y recorta la ventana de la empleada | **No existe.** La disponibilidad sale sólo de los turnos del personal (`store.ts:203-222`); si nadie define turno, el centro no abre, y si alguien lo define de par en par, el centro abre de par en par | **B-reservas-7** |
| **Festivos del centro como capa** (su §1.5: 14 cargados y **[M]** respetados) | Capa aparte que el cálculo descuenta | **No existe.** Se puede emular con un `BookingBlock scope=CENTER` por día, a mano, uno a uno | **B-reservas-7** |
| **Antelación mínima de reserva** | Ajuste del centro | **No existe ningún guardarraíl temporal**: en todo `apps/api/src/agenda/` sólo hay una lectura del reloj, la del TTL (`engine.ts:512`). **Hoy se puede crear una cita en el pasado por API** | **B-reservas-6** |
| **Parámetro desconocido** | Lo ignora en silencio (su queja del §1.7) | Lo **elimina** en silencio (ajv por defecto de Fastify; probado en `ticket-delivery.test.ts:143`, que asserta 200 y el campo desaparecido) | Divergencia **D-4** |

---

# Parte 2 · Los 8 huecos del §8.3, confirmados o desmentidos

## H1 · La capa de yield — ✅ CONFIRMADO, y el hueco es mayor que el que describe

**Prueba.** `BookingPolicy` / `booking_policies` aparece en seis sitios, **ninguno ejecutable**:

```
packages/db/prisma/schema.prisma:479          bookingPolicies    BookingPolicy[]
packages/db/prisma/schema.prisma:2032         model BookingPolicy {
packages/db/prisma/schema.prisma:2043         @@map("booking_policies")
migrations/20260805010000_.../migration.sql:103, 128, 164
```

(Y su unique por `(tenantId, key)` en `schema.prisma:2042`.)

Cero apariciones en `apps/` y en `packages/*/src`. La tabla está creada, indexada, con su unique por
`(tenantId, key)` — y **nadie la lee**.

**El hueco es mayor de lo que dice el documento**, por dos motivos que sólo se ven desde dentro:

1. **Ni siquiera está el subset que el ADR se comprometió a entregar.** El ADR-R8 lo promete dos
   veces, literal: "B4: subset (min/max lead, ventana de cancelación)"
   (`adr-r8-motor-reservas-agnostico.md:124`) y otra vez en su valla de alcance (`:178`). No están.
   *(El prompt de B4 no lo recoge — la promesa es del ADR, no del prompt.)* `B-reservas-4-done.md`
   lo declara honestamente en su "Fuera de alcance" ("catálogo completo de políticas (sólo el subset
   de columnas)") — pero el subset de **lógica** tampoco llegó. Es deuda declarada, no un olvido.
2. **Consecuencia operativa hoy:** sin `MIN_LEAD` ni `MAX_LEAD`, el motor ofrece y acepta cualquier
   hueco físicamente posible, incluido **ayer**. Para encender `agendaEnabled` a una clienta real eso
   no es una carencia de yield: es un guardarraíl que falta.

**Lo que el documento aporta y aquí no había:** las cuatro reglas concretas ya probadas en
`rt-booking` (sábado tarde cerrado salvo whitelist · franjas de valor protegidas por duración mínima ·
liberación tardía a 48 h · **no fragmentar bloques libres**), los números que las justifican (42,3 %
del ingreso anual en cuatro franjas; 41,36 € de diferencia por hueco ocupado; 48 huecos crudos → 6 con
la regla de empaquetado) y la condición de que se apliquen **al listar y al reservar**. Nuestro
`agenda-belleza-spec.md` §5 ya tenía el **diseño** de la capa; lo que faltaba eran **las reglas
medidas**. Eso es exactamente lo que este documento vale.

→ **B-reservas-6.**

## H2 · Ventana reservable ≠ turno contratado — ✅ CONFIRMADO

**Prueba.** `apps/api/src/agenda/store.ts:203-222`: `getTemplateSlots()` — la única fuente de
disponibilidad del motor — hace un `prisma.staffShift.findMany()` y expande la `rrule`. No hay
ninguna otra tabla entre el contrato de trabajo y el hueco que se ofrece. `grep -ri "bookablewindow"`
sobre `.ts`, `.prisma` y `.sql`: **cero resultados**.

`StaffShift` (`schema.prisma:1859-1878`) es literalmente un turno —tiene `kind REGULAR |
REINFORCEMENT | SWAP`, vocabulario de RRHH— y a la vez es lo que abre la agenda al público.

**Por qué importa aquí y no sólo en Raquel Torres:** su §1.5 lo midió (371 h-persona/semana de ficha
frente a ~125 h de entrega real → 34 % de ocupación falso en un centro que va lleno). Aquí el mismo modelo produciría el mismo informe falso en cuanto emitamos ocupación. Y
el efecto inverso es peor y es de hoy: **para abrir un hueco al público hay que ensanchar el turno**,
es decir, mentir en el dato de RRHH.

→ **B-reservas-7**, que es también donde caen el horario del centro y los festivos (§1.4).

## H3 · Programa multisesión — 🟡 CONFIRMADO EN CÓDIGO, DESMENTIDO EN DISEÑO

**Lo que el documento acierta:** no hay nada construido. `grep -i "program\|voucher"` sobre
`schema.prisma` devuelve **la columna y nada más**: `Appointment.voucherId` (`:1916`), comentada como
"canje de bono (B5, fuera de alcance en B4; **sólo la columna**)". No hay tabla `voucher`, ni saldo,
ni consumo. El endpoint de saldo existe **vacío a propósito**:

```
apps/api/src/crm/routes.ts:449-462   GET /clients/:id/vouchers
  → { balance: { sessionsLeft: 0, amountLeftCents: 0 }, vouchers: [] }
  // "Contrato estable, vacío hasta B5"
```

**Lo que el documento se equivoca:** dice que «`voucherId` es el canje de bono/cheque de B5, que es
otra cosa: un cheque se canjea una vez; un programa de 10 sesiones tiene **saldo**». Eso describe bien
la diferencia conceptual, pero **no describe nuestro diseño**. El diseño cerrado de aquí
(`reservas-modulo-kickoff.md` §4) ya modela exactamente el saldo consumible:

```
voucher            -- bono por sesiones o por importe
  type (SESSIONS|AMOUNT) · sessions_total? · sessions_left?
  service_scope (jsonb) · expires_at? · status · sold_ticket_id
voucher_movement   -- trazabilidad de saldo
  voucher_id · delta_sessions? · ticket_id? · appointment_id?
```

`sessions_left` **es** el saldo. `voucher_movement.appointment_id` **es** el consumo atado a la cita.
Y el contrato ya publicado devuelve `sessionsLeft`. O sea: aquí el programa multisesión no es un
modelo que falte, es **un bloque que aún no se ha implementado**.

**Consecuencia para B-reservas-8 — y es la decisión más importante de este cruce:** el bloque
**extiende el `voucher` de sesiones**; **no** crea un triplete paralelo `Program` / `ProgramBalance` /
`ProgramConsumption`. Ver divergencia **D-2**.

**Lo que el documento sí aporta, y es mucho:**
- **La atomicidad como requisito duro**: crear la cita y descontar la sesión, una sola transacción.
  Nuestro kickoff tenía la traza (`voucher_movement`) pero no decía **cuándo** se escribe.
- **La regla de traducción programa → sesión reservable** como función explícita y testeada que **se
  cae con mensaje** cuando es ambigua, en vez de elegir en silencio (su §1.6, `resolve_session`, tres
  ramas, probado en B8 de `rt-booking`).
- **El aviso de mercado**: 29 programas en 22 fichas de 46, y 45 variantes reservables para 37
  servicios. La ficha no se reserva; se reserva la variante.
- Y la razón de negocio: en Koibox esto es invisible para cualquier integración. Aquí la venta, el
  saldo y el ticket son el mismo sistema. **Es el diferencial comercial**, no un extra.

→ **B-reservas-8.**

## H4 · Panel de salud de la agenda — ✅ CONFIRMADO

**Prueba.** No existe ninguna pantalla de diagnóstico de agenda. El único "health" del front es el
banner de estado de Holded en la venta (`apps/tpv-web/src/pages/SalePage.tsx:263`, `:838`, `:2620`),
que no tiene nada que ver. En `AgendaPage.tsx` (907 líneas) hay **un solo** estado informativo de este
tipo: `"No hay profesionales con perfil de agenda activo"` (`:440`).

Y el caso que él cuenta se reproduce aquí exactamente igual: un servicio **sin ninguna fila
`StaffSkill`** simplemente devuelve cero huecos y **nada en pantalla dice por qué**
(`engine.ts:336-353`: si el set de `skilled` está vacío, `eligible.length < staffRequired` y el slot
se descarta en silencio). Es su fallo nº 2 de la auditoría —el que costó dos semanas de
diagnóstico— disponible de fábrica en nuestra agenda el día que F1 se cargue a medias.

→ **B-reservas-9**, y su tarjeta nº 1 es obligatoria.

## H5 · Suite de invariantes — 🟡 PARCIAL (3 plenos, 5 a medias, 6 sin nada) · tabla en la Parte 4

Hay 19 tests de agenda (`agenda-engine` 11, `agenda-time` 5, `agenda-checkout` 3) más
`agenda-cache` en el front. Cubren bien la carrera, la idempotencia, el K-matching y la tz.

**Lo más caro no está cubierto, y hay que decirlo con todas las letras:** el `EXCLUDE USING gist`
**nunca se ha ejecutado contra un Postgres real**. El harness del repo es fake-prisma y el test de la
carrera (`agenda-engine.test.ts:443`) prueba un store en memoria que **simula** el EXCLUDE
(`agenda-engine.test.ts:74-92`, la rama de staff en `:76-83`). Está documentado y justificado (`B-reservas-4-done.md`, decisión
nº 1) y era la elección correcta para B4 — pero el criterio de casa es **sabotaje, no suite verde**:
hoy nadie ha visto a Postgres rechazar una fila.

✅ **Corrección al carryover nº 3 de B4:** ese carryover decía que la migración estaba sin aplicar al
piloto. **Ya no es cierto.** Las cuatro migraciones del módulo están en el sha desplegado (`4be2f67`,
48 migraciones) y el despliegue del 27-ago reportó *"No pending migrations to apply"*
(`docs/deploy/2026-08-27-despliegue-1-done.md`, puerta 2). **Las tablas, los `EXCLUDE` y
`btree_gist` están vivos en producción.** Lo que sigue sin pasar es que alguien los ejercite: no hay
ningún tenant con `agendaEnabled`.

→ **Test de integración contra Postgres real, en el cierre de B-reservas-6** (el primer bloque que
vuelve a tocar el motor). No es un bloque propio.

## H6 · Importación / adaptador desde Koibox — ✅ CONFIRMADO

**Prueba.** `grep -ril koibox apps/ packages/` casa **cinco ficheros y ninguno es código de
integración**: `apps/api/src/agenda/engine.ts:62` (un comentario: *«idéntica firma que expondrá
KoiboxAdapter»*) y las cabeceras de las cuatro migraciones del módulo, que se llaman así por el
nombre interno del bloque (`-- B-koibox-4 · Motor de reservas agnóstico…`,
`migration.sql:1`). **En `apps/` no hay ni una línea que llame a Koibox.** No hay cliente, ni mapeo,
ni espejo, ni webhooks entrantes. La única referencia de diseño viva es el §7 de
`agenda-belleza-spec.md`, que es un boceto de mapeo **con las rutas equivocadas** (ver **D-10**).

→ **B-reservas-10.**

## H7 · La auditoría UX como lista de contraste — ✅ APORTA (no es un hueco)

Su Parte 7 audita la interfaz de **Koibox**, no la nuestra. Usada como lista de contraste contra la UI
que ya tiene B4 (`AgendaPage.tsx`), el resultado es:

**Ya cumplido (no tocar):**
- **Panel al lado sin scrim** — decisión explícita de B4, comentada en `AgendaPage.tsx:4` y `:490`.
  Su hallazgo nº 4 (modales que se descartan solos) aquí no aplica: no hay modal en el flujo crítico.
- **Estado vacío informativo** en la rejilla (`:440`), con el enlace a dónde arreglarlo.
- **Estado offline visible** con banner (`:371`) y lectura del día desde caché.
- **`tabular-nums`** en horas e importes (`:737`, `:778`, `:851`).
- **Sin drag como única vía**: el alta va por tap en el hueco y por buscar-hueco; el arrastre quedó
  como acelerador diferido (carryover nº 8 de B4).
- **Estado por badge**, no tiñendo el bloque entero (`STATUS_COLOR`/`STATUS_LABEL`, `:596`, `:858`).

**Le falta, y son comprobables uno a uno:**

| # | Regla de su §7.1 / §7.3 / §8.4 | Estado aquí |
|---|---|---|
| a | **Banner de deshacer 4 s** al anular/mover, en vez de diálogo | No existe (`grep -i deshacer\|undo` en `AgendaPage.tsx` → 0) |
| b | **Estado de carga = esqueleto de la rejilla**, no spinner | Hoy es un spinner (`:436`) |
| c | **Estado "conflicto"** (alguien movió esa cita) con recarga de una sola columna | No existe |
| d | **Pesimista con estado visible** al crear/mover ("reservando…", borde punteado) | El alta es optimista con outbox; el rechazo por hueco perdido se resuelve, pero sin el estado intermedio explícito |
| e | Matriz de screenshots 320/390/escritorio + error + final | Diferida en B4 (carryover nº 5: tests React/jsdom de `AgendaPage` diferidos por infra) |

Ninguno de estos abre un bloque: entran en el **cierre** de B-6/B-7/B-9, que son los que vuelven a
tocar esa pantalla. **Su Parte 7 no es spec para rehacer la UI de B4.**

## H8 · Datos reales del spa — ✅ APORTA, y es prerrequisito bloqueante

Es lo que dice ser: 8 profesionales con sus ventanas, 45 variantes con duración, 29 programas, la
carta entera y una tarifa real. **Pero el propio documento avisa de lo que NO trae**, y eso es lo que
importa aquí: **F1** (la matriz servicio × profesional) y **F2** (el inventario de cabinas y
aparatología) **no existen en ninguna parte** — ni en Koibox (44 de 45 servicios sin nadie asignado),
ni aquí. Ver la Parte 7: no se inventan semillas con ellos.

---

# Parte 3 · Divergencias · aquí manda este proyecto

Ninguna de estas reabre un ADR. Se anotan, se decide una vez, y se sigue.

### D-1 · La numeración de bloques choca de frente 🔴

`reservas-modulo-kickoff.md` §7 ya tiene asignados **`B-reservas-6` = reserva online embebible** y
**`B-reservas-7` = recordatorio de cita**. Y `bloque-reservas-5-cita-caja.md` usa el **5**, que en el
kickoff era "bonos y tarjetas regalo". La numeración ya había derivado antes de que llegara este
documento.

**Decisión de esta pasada:** se usa la numeración **de la tarea** (6 yield · 7 ventana · 8 programas ·
9 panel · 10 importación), porque es la que van a leer las sesiones de Code de las próximas semanas.
Los dos bloques del kickoff se **renumeran** en el roadmap:

| Antes (kickoff §7) | Ahora |
|---|---|
| B-reservas-5 · Bonos y tarjetas regalo | absorbido por **B-reservas-8** (voucher SESSIONS) + lo de importe, que sigue pendiente de asesor (ADR-R3) |
| B-reservas-6 · Reserva online embebible | **B-reservas-11** |
| B-reservas-7 · Recordatorio de cita | **B-reservas-12** |

`B-reservas-5` queda como está: el puente cita→caja ya escrito. **Esto hay que confirmarlo antes de
abrir ningún bloque nuevo** — es media conversación, pero si no se hace, dos documentos del repo
llaman "B6" a cosas distintas.

### D-2 · `Program` vs `voucher(type=SESSIONS)` — gana el voucher

El documento propone `Program` / `ProgramBalance` / `ProgramConsumption`. Aquí ya está decidido
(`reservas-modulo-kickoff.md` §4, ADR-R3, ADR-R7) que el saldo por sesiones vive en `voucher` +
`voucher_movement`, con QR firmado y con la venta registrada fiscalmente en Holded. **No se crea un
modelo paralelo.** Un modelo paralelo significaría dos sitios donde mirar el saldo de una clienta, dos
caminos fiscales y dos formas de canjear en caja — exactamente el error que ADR-R1 evitó con el
catálogo.

Lo que sí se toma del documento: la **atomicidad**, la **función explícita de traducción** programa →
sesión reservable, y la caducidad como campo de primera clase.

### D-3 · Nombres: `BookableWindow` sí, pero el turno no se toca

Se acepta el concepto de su §1.5 y se rechaza tocar `StaffShift`, que es contrato vivo de B3 (API,
tests y front). B-reservas-7 **añade** una tabla nueva de ventana reservable que **deriva por defecto**
del turno; el motor pasa a leer de ahí (`store.ts:203`). Migración aditiva, sin romper B3.

### D-4 · "400 ante parámetro desconocido" — hoy no se cumple, y la causa no es la agenda

Su invariante 10 y su §1.7 lo piden. Aquí las rutas de agenda declaran
`additionalProperties: false` en todos sus esquemas (`routes.ts:75`, `:114`, `:123`, `:165`, `:176`,
`:250`, `:382`, `:418`), pero el ajv por defecto de Fastify va con `removeAdditional`, así que el
campo desconocido **se elimina en silencio** y la petición devuelve **200**. La prueba está escrita y
verde en otro sitio del repo: `apps/api/test/ticket-delivery.test.ts:143`, cuyo propio nombre lo dice
—*"OWNER ignora campos inesperados (additionalProperties:false elimina)"*— y que asserta `200` y el
campo desaparecido.

**Es una decisión global de la API, no de la agenda.** Cambiar ajv a rechazar afecta a todas las rutas
del TPV y a los clientes ya desplegados (PWA que cachea JS viejo semanas). **Divergencia anotada,
decisión pendiente de Matías**, fuera del alcance de estos bloques. Lo que sí se hace en B-6: que el
endpoint de reserva **no** acepte una hora que la disponibilidad no ofrecería — ver D-4b.

### D-4b · La simetría listar/reservar tiene una fuga: la rejilla

`availability()` sólo propone inicios alineados a la retícula de 15 min (`engine.ts:417`, vía
`gridStarts`), pero `hold()` acepta **cualquier** `start` que sea físicamente factible
(`engine.ts:497`, `planForStart` directo, sin pasar por la rejilla). Hoy se puede reservar a las
10:07 llamando al endpoint. Es la misma familia de fallo que su §3.5 denuncia ("basta con adivinar la
hora y llamar al endpoint"), en pequeño. **Se cierra en B-reservas-6**, que es quien pone las reglas
en el camino de reserva.

### D-5 · `catalogDurationMin` — se acepta el problema, no la solución

Su delta 3 quiere dos duraciones (lo que publica la carta vs lo que bloquea la agenda). Aquí el
histórico ya está a salvo por el snapshot (§1.2 punto 2), pero **la carta sigue sin tener su propio
número**: hoy `ServiceScheduling.durationMin` es a la vez lo que se publica y lo que se bloquea, y los
buffers se suman aparte — que es mejor que Koibox, pero no resuelve "publico 100 y bloqueo 110" si
alguien quiere publicar **90**. No es urgente y **no entra en ninguno de los cinco bloques**: se anota
como deuda de catálogo (B-reservas-2) y se decide cuando haya una carta real que lo pida.

### D-6 · Servicios combinados y `parentId` — ya resuelto, mejor

Su delta 9 pide `parentId`/`groupId` en la cita sobre la hipótesis **[H]** de que Koibox parte un
combinado en N citas hermanas sin padre. Aquí, sea o no cierto allí, el visit **es** el padre: `Appointment` + N `AppointmentItem` encadenados
(`schema.prisma:1946`). No hay nada que añadir. **No se toca.**

### D-7 · Stripe

Su §3.4 y su D5 hablan de señal con Stripe. En este ecosistema no hay Stripe: la pasarela se decide
con lo que ya se usa (Redsys/Bizum), y la decisión es de ADR-R5b, abierta. `depositCents` ya existe
como columna (`schema.prisma:1918`). **No se importa Stripe.**

### D-8 · Su roadmap de pantallas P1-P13 y sus ADR-F1..F6

Su §7.2 y §8.2 proponen un inventario de pantallas y seis ADRs de front. **P1-P4 ya existen** en
`AgendaPage.tsx`; sus ADR-F1/F2 son la herencia de casa sin discusión, y F6 ya está construido. Se
toman **P5** (buscar hueco por servicio: ya hay endpoint, falta la lectura "hay sitio pero está
protegido para tratamientos largos" → B-6), **P6** (panel de salud → B-9), **P7** (matriz editable
desde los dos lados → B-9) y **P11** (ajustes de yield con simulación → B-6). El resto no abre nada.

### D-9 · Su §1.8 completo

Es `[H]`. Se ha leído para entender por qué su producto tiene los defectos que tiene. **No se ha
derivado de él ni una línea de diseño.** Se registra aquí para que ninguna sesión futura lo cite como
fuente.

### D-10 · Fe de erratas que sí se acepta: nuestro `agenda-belleza-spec.md` §7 tiene rutas falsas

Esto **no** es una divergencia: es una corrección medida que nos beneficia. Nuestro §7
(`docs/design/agenda-belleza-spec.md:238-258`) documenta el mapeo del `KoiboxAdapter` con
`GET /horas-disponibles`, `POST /citas` y `PATCH /citas/:id`. Su Parte 4, deltas 5 y 6, lo desmiente
con medición: las rutas reales son `GET /api/agenda/horas-disponibles/` y `POST /api/agenda/`, no hay
`DELETE` (405), y cancelar es **pasar a estado 3 reenviando `hora_fin`**. **B-reservas-10 corrige ese
§7**; hasta entonces, no se escribe código contra el mapeo viejo.

---

# Parte 4 · Los 14 invariantes de su Parte 5 contra la suite de B4

Leyenda: **✅** un test lo ejerce entero · **🟡** garantizado por construcción (esquema/BD) o
cubierto **sólo en parte** — queda un flanco sin test · **❌** ni garantizado ni testeado.

| # | Invariante | Estado | Prueba / dónde caería |
|---|---|---|---|
| 1 | Dos citas confirmadas del **mismo profesional** no se solapan | 🟡 | `migration.sql:134-137` lo hace imposible; `agenda-engine.test.ts:411` y `:443` lo prueban **contra un store en memoria que simula el EXCLUDE**, no contra Postgres. **Deuda: test de integración real** |
| 2 | Dos citas confirmadas del **mismo recurso** no se solapan | ❌ | La restricción existe (`migration.sql:139-142`); **ningún test la ejerce**. Ni siquiera hay un test con `ServiceResourceNeed` poblado |
| 3 | `staffRequired = K` sólo ofrece huecos con K compatibles libres | ✅ | `agenda-engine.test.ts:370` (no hay hueco con 1) y `:388` (sí con 2) |
| 4 | El rango bloqueado es `buffer + duración + buffer`; el publicado es `duración` | 🟡 | El motor lo calcula (`engine.ts:326-329`), pero **todos los tests van con buffers a 0** (`agenda-engine.test.ts:290-291`). Y la segunda mitad del invariante (el número publicado) no tiene campo — ver **D-5** |
| 5 | Un servicio **sin nadie compatible** no ofrece huecos **y el panel lo dice** | ❌ | La primera mitad ocurre (`engine.ts:336-353`) pero **en silencio y sin test**; la segunda mitad es H4 |
| 6 | Las reglas se aplican **igual al listar que al reservar** | ❌ | No hay reglas (H1). La fontanería sí es simétrica (`engine.ts:440` / `:497`), con la fuga de la rejilla de **D-4b** |
| 7 | Anular **libera**; borrar no existe | ✅ | `agenda-engine.test.ts:479`; y no existe `DELETE /agenda/appointments/:id` (`routes.ts`, único `app.delete` en `:475`, para bloqueos). Falta la **auditoría** del cambio de estado |
| 8 | Misma `idempotency_key` no crea segunda cita | ✅ | `agenda-engine.test.ts:561` (por `externalId`, `schema.prisma:1904`) |
| 9 | Consumir sesión y crear cita son **atómicos** | ❌ | No existe el saldo (H3). **Es el invariante fundacional de B-reservas-8** |
| 10 | Parámetro de filtro desconocido → **400** | ❌ | Se **elimina** en silencio y devuelve 200. Prueba: `ticket-delivery.test.ts:143`. Divergencia **D-4** |
| 11 | La nota de la cita **no** aparece en la ficha del cliente | 🟡 | Son dos columnas distintas de dos tablas distintas: `Appointment.notes` (`schema.prisma:1924`) y `Client.notes` (`:1663`). Imposible confundirlas por construcción; **sin test que lo fije** |
| 12 | Cambiar la duración de un servicio **no** reescribe citas creadas | 🟡 | El snapshot lo garantiza (`schema.prisma:1951-1954`); **sin test** |
| 13 | Un festivo del centro devuelve **cero** huecos | ❌ | **No hay festivos.** El mecanismo genérico existe (`BookingBlock scope=CENTER`, tratado en `engine.ts:231-237`) pero sin entidad de calendario ni test → **B-reservas-7** |
| 14 | La disponibilidad se calcula en la **tz del centro**, y el test se repite bajo otra TZ del sistema | 🟡 | `time.ts:12` fija Europe/Madrid y `agenda-time.test.ts:16`/`:22` cubren verano e invierno — pero **ningún test se ejecuta bajo otra `TZ` de proceso** (`grep "process.env.TZ"` en `apps/api/test` → 0). Es media hora de trabajo y cierra el invariante entero |

**Recuento: 3 ✅ · 5 🟡 · 6 ❌.** Dicho por el flanco que importa: **nueve de los catorce no tienen
hoy ningún test que los ejerza** — los seis ❌ más el 4, el 11 y el 12. Los otros dos 🟡 (el 1 y el 14)
sí tienen test, pero incompleto: el 1 sólo contra un store simulado, el 14 sólo bajo la TZ por defecto.

**Dónde cae cada uno:** invariantes **2, 4, 6 y 14** (más el test de integración real del 1) al cierre
de **B-6** · **13** a **B-7** · **9** a **B-8** · **5** a **B-9** · **11 y 12** son test barato y caben
en cualquiera de ellos · **10** no es deuda de test sino la divergencia **D-4**, decisión global.

**Además, y no está en su lista:** el `EXCLUDE` **está creado en producción pero nunca se ha
ejecutado** — ni en test (harness fake-prisma) ni con datos reales (ningún tenant tiene la agenda
encendida). Antes de dejar la agenda sola con una clienta real, eso se prueba contra un Postgres de
verdad.

---

# Parte 5 · Lo que este documento cambia de nuestros propios docs

| Doc de aquí | Qué le corrige | Acción |
|---|---|---|
| `docs/design/agenda-belleza-spec.md` §7 | El mapeo del `KoiboxAdapter` tiene **rutas que no existen** (`:243-248`) y documenta `cancel()` como un `PATCH /citas/:id` genérico, cuando cancelar es **pasar a estado 3 reenviando `hora_fin`**; y la API real **no tiene `DELETE`** (405) | Lo corrige **B-reservas-10**. Hasta entonces, no se codifica contra ese §7 |
| `docs/design/agenda-belleza-spec.md` §5 | Su tabla de reglas era buena pero **sin números**. Ahora hay cuatro reglas medidas y probadas en producción, con su euro | Entra en **B-reservas-6** |
| `docs/design/reservas-modulo-kickoff.md` §4 (`voucher`) | Le falta decir que el consumo es **transaccional con la cita** y que la traducción programa→sesión es una función que **se cae con mensaje** | Entra en **B-reservas-8** |
| `docs/design/reservas-modulo-kickoff.md` §7 (roadmap) | Numeración colisionada | **D-1**, pendiente de confirmación |
| `docs/design/adr-r8-motor-reservas-agnostico.md` §3.6 | Prometía un subset de políticas en B4 que no llegó | Se salda en **B-reservas-6** |

---

# Parte 6 · La decisión que va antes que todas · ¿vertical aparte o dentro del TPV?

**Se plantea la primera porque, si la respuesta cambiara, los cinco prompts se reescriben.** Y porque
es la única de esta lista que ya tiene una respuesta **construida en el repo**: conviene saber qué
costaría deshacerla antes de decidir.

## Cómo está resuelto hoy, medido

La agenda **no es** un producto aparte que comparta base de datos. Está **dentro** del TPV, y en
cinco costuras distintas:

| Costura | Dónde | Qué significa |
|---|---|---|
| **Se enciende por capacidad, no por vertical** | `Tenant.agendaEnabled` (`schema.prisma`), gate `ensureAgendaEnabled` en cada ruta (`routes.ts:71` y siguientes) | Un tenant RETAIL o SERVICES puede encender agenda; Thalía la deja apagada. **ADR-R6: cero `if (businessType)`** |
| **Mismo esquema, mismo proceso** | `registerAgendaRoutes` en `apps/api/src/server.ts`; el worker de TTL en `apps/api/src/workers/index.ts` | No hay servicio, ni despliegue, ni base de datos aparte |
| **Misma app de front** | `AgendaPage.tsx` vive en `apps/tpv-web` y se abre **desde la pantalla de venta** (`SalePage.tsx`, botón "Agenda" gateado) | El cajero no cambia de herramienta |
| **Misma sesión y mismo rol** | `requireOwnerOrCashier` — la agenda la usa **el cajero**, no un admin de otro producto | Decisión nº 4 de `B-reservas-4-done.md` |
| **El núcleo es compartido con hostelería** | El motor es **agnóstico cita/mesa** (ADR-R8): los enums nacen con los valores `TABLE` reservados (`schema.prisma:273-315`) para que la reserva de mesa caiga encima sin migrar | Sacar la agenda del TPV **rompería el modo mesa**, que es TPV puro |

Y la costura que más pesa: **el puente cita→caja**. `agenda/checkout.ts` abre un ticket DRAFT
pre-poblado por el camino de cobro existente, y B-reservas-5 hace que el cobro **pague ese DRAFT**.
Si fueran dos productos, ese puente pasa a ser **una llamada de red entre dos sistemas** — con dos
verdades del ticket, dos caminos a Holded y una conciliación nueva. Es exactamente lo que ADR-010
prohíbe tocar.

## Lo que costaría separarla

Duplicar, en un segundo producto: cliente/CRM, espejo de catálogo, sesión de cajero, caja y turno,
camino fiscal a Holded, multi-tenant, despliegue, APK y actualización de terminales. Y quedarse
además con el problema nuevo: quién manda en el ticket.

**Y perdería su propio argumento de venta.** La medición del documento de entrada (§3.5) es
tajante: con las reglas sólo en un canal valen **4.000-10.000 €/año**; con las reglas **en toda la
casa**, 19.000-30.000 €. La diferencia no es tecnológica — es que la política la aplique el mostrador
**y** la web con **un solo motor**. Ese es justamente el hueco por el que el CRM incumbente no puede
competir, y sólo existe si agenda y caja son el mismo sistema.

## Lo que sí se separa, y ya está previsto

Separar el producto, no. Separar **dos bordes**, sí — y ambos están diseñados como adaptadores
detrás de la misma interfaz `BookingEngine`, no como una bifurcación:

- **La reserva pública** (B-reservas-11): endpoint sin JWT, CORS por dominio del tenant, anti-abuso,
  marca blanca del negocio. Es una superficie distinta del mismo motor, no otro producto (ADR-R5).
- **El adaptador Koibox** (B-reservas-10): API de terceros, con su candado, su caché y su tope de
  frecuencia, aislado en `integrations/`.

## Recomendación

> **Sigue dentro del TPV, tal cual, encendida por `agendaEnabled`.** No hay ninguna razón técnica
> para separarla y hay cinco costuras que lo desaconsejan; **comercialmente ya se puede vender como
> línea propia sin tocar nada**, porque la capacidad es una columna del tenant.

**Lo que sí conviene decidir a la vez, porque es lo que suele estar debajo de la pregunta:** si el
spa de Raquel Torres entra **como tenant de mipiacetpv** (y entonces B-reservas-10 es su camino de
entrada) o se queda como producto propio con `rt-booking`. Eso es una decisión de negocio, no de
arquitectura, y **no cambia ninguno de los cinco bloques**.

**Si la respuesta fuera "vertical aparte"**, esta pasada se invalida: habría que reabrir ADR-R6
(capability flag), ADR-R8 (núcleo agnóstico) y ADR-010 (camino de cobro), y los cinco prompts se
reescriben. Por eso va la primera.

---

# Parte 6b · Decisiones pendientes que abre este cruce

Ninguna se resuelve en esta pasada. Ninguna bloquea escribir los prompts.

| # | Decisión | Quién | Bloquea |
|---|---|---|---|
| **P0** | **¿Vertical aparte o dentro del TPV?** Recomendación: **dentro, tal cual** (Parte 6). Y por separado: si Raquel Torres entra como tenant | Matías | **Todo lo demás.** Si cambia, se reescriben los cinco prompts |
| **P1** | Confirmar la renumeración de bloques de **D-1** | Matías · 5 min | Abrir cualquier bloque nuevo |
| **P2** | Confirmar que B-8 **extiende el voucher** y no crea `Program` (**D-2**) | Matías | B-reservas-8 |
| **P3** | ¿La API pasa a **400 ante parámetro desconocido** en todo el TPV, o se queda como está? (**D-4**) | Matías · decisión global | Nada de estos bloques |
| **P4** | ¿Caducan los programas y a cuánto? (su D1; punto de partida: los 12 meses del cheque regalo) | Raquel + asesoría | B-reservas-8 |
| **P5** | ¿Qué precio va al ticket al consumir una sesión: 0 € o prorrateado? (su D2, **fiscal**) | **Asesoría fiscal** — ADR-R3 ya dice que el canje no re-emite documento; falta el importe de la línea | B-reservas-8, y **antes de producción** |
| **P6** | El buffer de recogida: ¿por servicio, por cabina o por persona? (su D3) | Raquel + medición del histórico | El **valor**, no el esquema |
| **P7** | ¿Se ofrecen recursos (cabinas/aparatos) en la v1 de este centro, o se declaran fuera? | Matías | El alcance de F2 |
| **P8** | ¿Quién puede anular desde el mostrador y con cuánta antelación? (su D6) | Matías | B-reservas-6 (regla de cancelación) |

---

# Parte 7 · Prerrequisitos de datos · **no se inventan semillas**

Su Parte 10 los llama F1, F2 y F3. Se copian aquí tal cual **como prerrequisitos de bloque**, y se
dice en voz alta lo que son: **datos que hoy no existen en ninguna parte** — ni en Koibox, ni en este
repo.

| | Qué falta | Sin él, qué pasa | Prerrequisito de |
|---|---|---|---|
| **F1** | **La matriz servicio × profesional.** El modelo está (`StaffSkill`, `schema.prisma:1835`); **las filas no**. En Koibox está vacía en 44 de 45 servicios | El motor devuelve cero huecos **en silencio** para todo servicio sin skill. Es literalmente el fallo que a ellos les costó dos semanas | **B-reservas-9** lo hace visible; **cualquier demo real** lo necesita cargado |
| **F2** | **El inventario de cabinas y aparatología.** `Resource` y `ServiceResourceNeed` existen (`:1765`, `:1785`); nadie ha contado cuántas cabinas hay ni qué servicio necesita qué | Los recursos no restan: se puede sobrevender el jacuzzi | Si se quieren recursos en la v1. Si no, **se declara fuera de alcance y se anota la deuda** (P7) |
| **F3** | **Las horas contratadas reales** | Cualquier informe de ocupación que emitamos será humo | **B-reservas-7** para separar turno de ventana. **No bloquea código**: la ventana puede derivar del turno mientras tanto |

**Regla de esta pasada, explícita:** ninguno de los cinco prompts de bloque incluye semillas
inventadas con F1 ni F2. Donde hacen falta, van declarados como prerrequisito de datos y el bloque se
construye para **funcionar y quejarse** cuando faltan, no para asumirlos.

---

# Resumen de una pantalla

**Cubierto y mejor que lo que el documento proponía:** el anti-solape físico (y en el sitio correcto,
el assignment, con el tenant en la clave), buffers separados de la duración, `staffRequired` con
K-matching, recursos por tipo, snapshot del catálogo en la cita, idempotencia y hold con TTL, estados
ricos, puente cita→caja, núcleo agnóstico cita/mesa y un motor que es nuestro desde el primer día.
**El roadmap A0-A9 del documento queda retirado, y se confirma que hacía falta retirarlo.**

**Confirmado que falta:** las reglas de yield (y con ellas cualquier guardarraíl temporal: hoy se
puede reservar en el pasado) · la ventana reservable separada del turno, con el horario del centro y
los festivos detrás · el saldo por sesiones y su consumo atómico · el panel de salud · el adaptador
Koibox. Y **nueve de los catorce invariantes sin ningún test que los ejerza**, con el más caro
cubierto sólo a medias: **el EXCLUDE nunca se ha ejecutado contra un Postgres real**.

**El orden en que los abriría:**

1. **B-reservas-6 · yield.** El de más valor por euro, el que salda la deuda declarada de B4, el que
   arregla la fuga de la rejilla (D-4b) y el que cierra de paso los invariantes 2, 4, 5 y 14 con el
   test de integración contra Postgres real. No depende de ningún dato que falte.
2. **B-reservas-7 · ventana reservable.** Barato, aditivo, y desbloquea el horario del centro y los
   festivos (invariante 13). Sin él, abrir un hueco obliga a mentir en el turno.
3. **B-reservas-9 · panel de salud.** Va **antes** que B-8 a propósito: es la pantalla que hace
   visible que F1 está a medias, y F1 es el prerrequisito de que la agenda sirva para algo.
4. **B-reservas-8 · programa multisesión.** El diferencial comercial, pero espera a **P2**
   (extender el voucher, no crear `Program`), a **P4** (caducidad) y sobre todo a **P5**, que es
   fiscal y no se codifica a ciegas.
5. **B-reservas-10 · importación Koibox.** El último: sólo hace falta el día que entre un centro que
   viene de Koibox, y es el único que depende de una API de terceros sin sandbox.

**Antes de abrir el primero:** cerrar **P0** —¿vertical aparte o dentro del TPV? La respuesta que ya
está construida en el repo es **dentro, encendida por `agendaEnabled`**, y la Parte 6 explica por qué
separarla rompería el modo mesa, duplicaría la caja y le quitaría a la capa de yield la mitad de su
valor— y después **P1** (la renumeración) y **P2**. P1 y P2 son diez minutos; P0 es una conversación,
pero es la que sostiene todo lo demás.

---

*Mi Piace Internet Solutions · 2026-09-02 · Cruce verificado contra `master` en `1d169ef`. Documento
de entrada: `docs/reservas/00-koibox-ingenieria-inversa-y-modelo.md` (Raquel Torres Spa).*
