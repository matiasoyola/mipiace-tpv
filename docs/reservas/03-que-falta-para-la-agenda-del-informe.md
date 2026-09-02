# Qué falta por desarrollar para tener, entera, la agenda que describe el informe

> **La pregunta.** El cruce (`01-cruce-con-b-reservas-4.md`) contestó *qué huecos hay*. Esto contesta
> la siguiente: **qué hay que construir, de principio a fin, para que nuestra agenda sea equivalente a
> la que describe `00-koibox-ingenieria-inversa-y-modelo.md`** — no solo sus 8 huecos del §8.3, sino
> todo lo que el informe pide entre sus Partes 2, 3, 7 y 9.
>
> **Fecha:** 2026-09-02 · **Verificado contra** `master` en `1d169ef`.

---

## 0. "Equivalente al informe" son dos cosas, y conviene no mezclarlas

| Nivel | Qué es | Para qué sirve | Bloques |
|---|---|---|---|
| **Nivel 1 · El mostrador** | Partes 2, 3 y 5 del informe: el motor con las mejoras medidas y los invariantes. **La agenda que sustituye al CRM incumbente para el equipo del centro** | Encender `agendaEnabled` a una clienta real y que adopte la herramienta. **Es la métrica de éxito del informe** | B-5 · B-6 · B-7 · B-9 · B-8 |
| **Nivel 2 · El producto** | Además: §7.2 P12 (la clienta reserva sola), §3.8 y §9.5 (una API que no miente), §1.7 (recordatorios, señal), y la importación | Vender el módulo a cualquier centro, con reserva online y sin depender del mostrador | B-10 · B-11 · B-12 · B-13 · B-14 |

**El Nivel 1 no necesita ni una decisión de terceros. El Nivel 2 sí** (pasarela de pago, proveedor de
WhatsApp, asesoría fiscal).

---

## 1. Lo que YA existe y no hay que construir

Esto es la mitad del valor de este documento: evita presupuestar lo que ya está pagado.

| Pieza que el informe da por necesaria | Estado aquí | Evidencia |
|---|---|---|
| Motor de disponibilidad propio, con retícula, skills, recursos y K-matching | ✅ construido | `apps/api/src/agenda/engine.ts` |
| Anti-solape **físico** (no en código) | ✅ y **mejor** que lo que propone | `migration.sql:134-142` |
| Buffers separados de la duración | ✅ | `schema.prisma:1736-1738` |
| Snapshot del catálogo en la cita | ✅ (resuelve su delta 12) | `schema.prisma:1951-1954` |
| Idempotencia + hold con TTL + job que lo libera | ✅ | `schema.prisma:1904`, `:1920`, `workers/agenda-hold-ttl-worker.ts` |
| Estados ricos con no-show separado + canal de origen | ✅ | `schema.prisma:281`, `:292` |
| Puente cita→caja pre-poblado | ✅ construido (falta cerrarlo, B-5) | `agenda/checkout.ts` |
| **Envío de email inyectable + cola dedicada** | ✅ existe | `apps/api/src/email/sender.ts`, `queues/ticket-email.ts` |
| **Job runner con colas repetibles** (BullMQ + Redis) | ✅ 10 colas y 12 workers en producción | `apps/api/src/queues/`, `workers/` |
| **Bus de tiempo real por WebSocket** | ✅ existe… **y la agenda no lo usa** (`grep realtime` en `agenda/` → 0) | `apps/api/src/realtime/store-event-bus.ts`, `ws-route.ts` |
| **Patrón de ruta pública sin sesión**, con capability en la URL | ✅ probado en producción | `tickets/public-pdf-route.ts` |
| Rate-limit y tope por IP detrás de proxy | ✅ | `trustProxy` en `server.ts:83`, `test/rate-limit-caracterizacion.test.ts` |
| Lector de códigos HID para validar QR | ✅ (ADR-011) | — |
| Multi-tenant por fila, capability flags, gate en ruta y UI | ✅ | ADR-R6 |

**Lo que NO existe y el informe da por hecho:**

> 🔴 **No hay ninguna pasarela de pago en el repo.** `CARD` y `BIZUM` son **etiquetas de método de
> pago manual** en el ticket, no un cobro online: `grep -i "redsys\|stripe"` sobre `apps/api/src` →
> **cero**. La señal al reservar (§3.4 del informe, ADR-R5b) no es "activar una opción": es construir
> un cobro online entero.
>
> 🔴 **No hay proveedor de WhatsApp ni de SMS.** `grep -i "whatsapp\|twilio\|sms"` → **cero**. Los
> recordatorios por email salen casi gratis; por WhatsApp son un proveedor, un coste recurrente y un
> alta.

---

## 1 bis. El front YA existe, y está desplegado. Cómo se enciende hoy

No hay que desplegar nada nuevo: **el código está en producción desde el lote de agosto**. La agenda
es una **capacidad por cuenta**, no una instalación.

**Dónde vive cada pieza:**

| Pieza | URL | Qué es |
|---|---|---|
| **El interruptor** | `admin.mipiacetpv.com/admin/settings` → *"Agenda de citas"* | `SettingsPage.tsx:175-180`. Al encenderlo aparecen las dos entradas de menú del admin y el botón del TPV (`AdminShell.tsx:389-395`) |
| **Catálogo de agenda** | `admin.mipiacetpv.com/admin/agenda-catalog` | Duración, pausas antes/después, nº de profesionales, recursos. **Un servicio sin duración no es reservable** |
| **Personal** | `admin.mipiacetpv.com/admin/staff` | Perfil de agenda, **qué servicios sabe dar cada profesional** (el inventario) y turnos con recurrencia |
| **La agenda** | `mipiacetpv.com` (PWA) y la APK → botón **"Agenda"** en la pantalla de venta | **No tiene URL propia**: es una superficie a pantalla completa dentro de la venta (`SalePage.tsx:1831`, `:2192`). Día por profesional, recepción y móvil |

**Los cuatro pasos para un cliente activo** (media hora larga, sin tocar código):

1. Ajustes → activar *"Agenda de citas"*.
2. Catálogo de agenda → duración y pausas de cada servicio que venga de Holded.
3. Personal → perfil de cada profesional + **qué sabe hacer cada uno** + turnos.
4. En el TPV aparece el botón **Agenda**. En terminal Android, con la APK del lote de agosto o
   posterior.

**Estado de la base de datos:** las 4 migraciones del módulo están aplicadas en producción
(`4be2f67`, 48 migraciones, *"No pending migrations to apply"* —
`docs/deploy/2026-08-27-despliegue-1-done.md`). Las tablas, `btree_gist` y los dos `EXCLUDE` existen
y funcionan. **Ningún tenant tiene la capacidad encendida todavía.**

### Entonces, ¿hace falta desarrollar algo para encenderla?

**Para enseñarla y pilotarla acompañando al centro: no.** Para dejarla sola con dinero de por medio,
sí — y son cosas concretas, no un rediseño:

| | Qué pasa hoy | Se arregla en |
|---|---|---|
| 🔴 | **Cobrar una cita abre un ticket nuevo** y deja huérfano el borrador que el servidor ya había creado y enlazado; la cita no se marca como finalizada sola | **B-5** (prompt escrito) |
| 🔴 | **Se puede reservar en el pasado**: no hay antelación mínima ni ningún guardarraíl temporal | **B-6** |
| 🟠 | **No hay horario de centro ni festivos**: los huecos salen solo de los turnos, y un festivo hay que bloquearlo a mano, día a día | **B-7** |
| 🟠 | Un servicio **sin nadie asignado devuelve cero huecos en silencio** — el fallo que al spa le costó dos semanas | **B-9** lo hace visible |
| 🟠 | **Dos recepciones no se ven entre sí** hasta recargar | **B-15** |
| 🟡 | El `EXCLUDE` está en producción pero **nunca se ha ejercitado** | **B-6** |

**Lectura corta:** hoy se puede encender para un piloto de una peluquería pequeña, con
acompañamiento. Para dejarla funcionando sola hacen falta **B-5 + B-6 + B-7** — y de esos, B-5 ya
está escrito.

---

## 2. Nivel 1 · Lo que abre la agenda a una clienta real

| Orden | Bloque | Qué hay que desarrollar | Tamaño | Depende de |
|---|---|---|---|---|
| **0** | **B-reservas-5 · cita→caja unificada** ⚠️ | Ya está el prompt escrito, **falta implementarlo**. Que el cobro pague el DRAFT enlazado y la cita pase sola a `COMPLETED`. **Es el bloqueante para encender `agendaEnabled`** | **S** | — |
| **1** | **B-reservas-6 · yield** | Registro de políticas + 7 reglas + enganche al listar **y** al reservar + alineación a rejilla + pantalla de ajustes con simulación + el test de integración del `EXCLUDE` contra Postgres real | **L** | P0, P1, P8 |
| **2** | **B-reservas-7 · ventana reservable** | `bookable_windows` + `center_hours` + `center_holidays`, derivación y desviación visible, el motor leyendo de ahí, y ocupación honesta | **M** | P0, P1 |
| **3** | **B-reservas-9 · panel de salud** | Las 6 tarjetas con su consulta documentada + matriz servicio×profesional editable por los dos lados | **M** | P0, P1 · **la tarjeta 2 necesita D-5** (ver §4) |
| **4** | **B-reservas-8 · programa multisesión** | `vouchers` + `voucher_movements` + `resolveSession()` + consumo **atómico** con la cita + venta y canje en caja + ficha con saldo y traza | **L** | P0, P2, P4 y **P5 (fiscal)** |

**Y dentro de estos, sin bloque propio** (el cruce ya los reparte): los 9 invariantes sin test, las 5
reglas de acabado UX pendientes (banner de deshacer, esqueleto de carga, estado de conflicto, estado
"reservando…", matriz de screenshots) y la auditoría del cambio de estado de una cita.

**Con esto está el Nivel 1.** El centro trabaja aquí, la política se aplica en toda la casa, el saldo
de programas baja solo y el panel dice cuándo algo está mal configurado.

---

## 3. Nivel 2 · Lo que falta para el producto que el informe describe entero

Ninguno de estos está en los cinco bloques del cruce. Son desarrollo nuevo.

### B-reservas-10 · Importación y adaptador Koibox — **M**
Ya tiene prompt. Corrige nuestro §7 con rutas falsas, importa clientes / servicios / **la matriz** /
ventanas / festivos / citas, con espejo, reconciliación y conflictos listados. **Prerrequisito: las
sondas K2 desde el Mac** — hoy media Parte 1 del informe sigue siendo hipótesis.

### B-reservas-11 · Reserva online embebible — **L** · *es el objetivo declarado del módulo (ADR-R5)*
Lo que hay que construir, y ninguna pieza existe hoy:

- **Endpoint público sin JWT** para disponibilidad y reserva. El patrón está probado
  (`tickets/public-pdf-route.ts`), la superficie no.
- **CORS restringido al dominio de cada tenant** + anti-abuso (que un bot no llene la agenda).
- **Widget insertable** (`<script>`/iframe) con **marca blanca del negocio**, nunca de Mi Piace.
- **Alta de cliente desde canal público** con `source=WEB` y consentimiento RGPD — hoy el CRM solo
  acepta altas desde caja.
- **Confirmación por email** al reservar (el envío ya existe; la plantilla y el flujo no).
- Y la condición que el informe subraya: **las reglas de yield corren también aquí**. Si B-6 está
  hecho, sale gratis; si no, la web ofrece lo que el mostrador protege.

### B-reservas-12 · Recordatorios de cita — **M** (email) / **L** (WhatsApp)
Aviso 24/48 h antes. La cola repetible y el envío por email **ya están**: es plantilla, programación
y cancelación al anular. **WhatsApp es otra cosa**: proveedor, coste recurrente, alta y plantillas
aprobadas. Recomendación: **email primero**, WhatsApp cuando haya un centro que lo pida y lo pague.

### B-reservas-13 · Señal al reservar — **L** 🔴 *el más caro y el de más riesgo*
El informe la señala como **la palanca real contra el no-show**. Aquí hay que construir:
integración con pasarela (**Redsys/Bizum — no Stripe**, decisión de casa), cobro online desde la
reserva pública, conciliación de la señal con el ticket al completar la cita, y **devoluciones**.
Toca el camino fiscal, así que **necesita asesoría** igual que B-8. La columna `depositCents` existe;
lo demás no.

### B-reservas-14 · "Una API que no miente" — **M**
El §3.8 y el §9.5 del informe listan lo que le falta a un contrato para servir a un mostrador. Contra
lo que tenemos hoy:

| Lo que pide el informe | Aquí |
|---|---|
| `cancel()`, `move()`, `list()` en el contrato | ✅ ya existen en `BookingEngine` (vamos por delante de `rt-booking`) |
| `hold()` con TTL | ✅ existe |
| **429 con cabeceras `X-RateLimit-*`** | ❌ falta en el endpoint público |
| **ETag / versión de recurso** para detectar que alguien tocó la cita | ❌ falta — y es lo que habilita el estado "conflicto" del §7.3 |
| **`dry_run`** | ❌ falta |
| **400 ante parámetro desconocido** | ❌ hoy se elimina en silencio (divergencia **D-4**, decisión global) |
| **Webhooks salientes** de cita para que un tercero se entere | ❌ falta |

### B-reservas-15 · La agenda en tiempo real — **S/M**
El bus WebSocket existe y **la agenda no está enganchada**. Hoy dos recepciones mirando la misma
rejilla no se enteran la una de la otra hasta recargar. Es lo que hace posible el estado **conflicto**
del §7.3 y lo que evita el choque en mostrador compartido. Barato, y se nota mucho.

---

## 4. Deudas concretas que el informe convierte en obligatorias

| | Qué | Por qué deja de ser opcional | Tamaño |
|---|---|---|---|
| **D-5 · `catalogDurationMin`** | Publicar 90 y bloquear 100 sin que ninguno de los dos números mienta | **La tarjeta 2 del panel de salud** ("variantes cuya duración no cuadra con la carta") **no se puede construir sin el número publicado**. En el cruce quedó como deuda; para ser equivalente al informe, entra | **S** |
| **D-4 · 400 ante parámetro desconocido** | El informe lo pone como invariante 10 | Decisión **global de la API**, no del módulo (P3) | **S**, pero con riesgo de regresión en clientes desplegados |
| **Auditoría del cambio de estado** | "Anular libera, borrar no existe — **o soft-delete auditado**" | Hoy no queda rastro de quién anuló ni cuándo | **S** |
| **Recursos ejercitados de verdad** | El informe deja abierto si en Koibox los recursos restan; **aquí la restricción existe y ningún test la ejerce** | Sin test, "se puede sobrevender la cabina" es tan cierto aquí como allí | **S** |

---

## 5. Lo que no es código, y bloquea de verdad

| | Qué | Quién | Sin esto |
|---|---|---|---|
| **P0** | ¿Vertical aparte o dentro del TPV? | Matías | Se reescribe todo el plan |
| **F1** | La **matriz servicio × profesional** | Sesión con el centro | La agenda devuelve cero huecos en silencio. **Es el inventario, no configuración** |
| **F2** | Inventario de cabinas y aparatología | Media visita al centro | No hay recursos en la v1 (o se declara fuera) |
| **P5** | Qué importe va al ticket al consumir una sesión | **Asesoría fiscal** | B-8 no sale a producción |
| **P4** | Caducidad de los programas | Centro + asesoría | B-8 |
| **K2** | Las 4 sondas de lectura sobre la API de Koibox | Matías, desde su Mac | B-10 se construye sobre hipótesis |
| **—** | Pasarela de pago elegida y contratada | Matías | B-13 |
| **—** | Proveedor de WhatsApp (si se quiere) | Matías | B-12 en su versión completa |

**F1 + F2 + P4 + P6 + P7 se resuelven en una sola reunión** con la carta y una hoja delante.

---

## 6. El plan, de una vez

```
NIVEL 1 · el mostrador  ────────────────────────────────────────────
  B-5  cita→caja unificada          S    ← bloqueante para encender
  B-6  yield                        L    ← + test real del EXCLUDE
  B-7  ventana reservable           M    ← + horario de centro y festivos
  B-9  panel de salud               M    ← necesita también D-5 (S)
  B-8  programa multisesión         L    ← espera a la asesoría (P5)
                                   ≈ 5 bloques · 2 de ellos grandes

NIVEL 2 · el producto  ─────────────────────────────────────────────
  B-15 agenda en tiempo real        S/M  ← el bus ya existe
  B-14 API que no miente            M    ← ETag, 429, dry_run, webhooks
  B-11 reserva online embebible     L    ← el objetivo declarado (ADR-R5)
  B-12 recordatorios                M    ← email; WhatsApp aparte
  B-10 importación Koibox           M    ← tras las sondas K2
  B-13 señal al reservar            L    🔴 pasarela desde cero + asesoría
                                   ≈ 6 bloques · 2 de ellos grandes
```

**Orden recomendado:** el Nivel 1 entero **antes** de tocar el Nivel 2. Y dentro del Nivel 2,
**B-15 y B-14 antes que B-11**, porque la reserva online sin ETag ni 429 ni tiempo real es
precisamente la API que el informe critica.

**La excepción sensata:** si aparece un centro que viene de Koibox antes de terminar el Nivel 1,
**B-10 se adelanta** — es su puerta de entrada.

---

## 7. Los tres riesgos que hay que decir en voz alta

1. **El `EXCLUDE` está creado en producción y nunca se ha ejecutado.** El esquema sí está desplegado
   —las 4 migraciones del módulo entraron con el lote de agosto (`4be2f67`, *"No pending migrations to
   apply"*)—, pero ningún tenant tiene la agenda encendida y el harness de test simula el constraint.
   Todo el edificio se apoya en una restricción que nadie ha visto funcionar. Se cierra en B-6, y es lo
   primero que yo probaría.
2. **Sin F1 la agenda no sirve para nada**, y falla **en silencio**. Es el fallo que al centro real le
   costó dos semanas. B-9 lo hace visible, pero el dato hay que ir a buscarlo.
3. **B-13 (la señal) es el único bloque que introduce un sistema nuevo entero** — cobro online — en un
   producto cuyo camino fiscal está deliberadamente cerrado (ADR-010). Es el candidato natural a
   quedarse fuera de la primera versión sin que el producto pierda su tesis.

---

*Mi Piace Internet Solutions · 2026-09-02 · Complementa `01-cruce-con-b-reservas-4.md` y
`02-roadmap-agenda.md`. Verificado contra `master` en `1d169ef`.*
