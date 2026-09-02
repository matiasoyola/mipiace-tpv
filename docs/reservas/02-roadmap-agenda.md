# Roadmap del módulo de agenda y reservas

> **Qué es esto.** El roadmap vivo de la vertical de agenda: qué está cerrado, qué bloques quedan
> abiertos, en qué orden y con qué prerrequisitos. Sustituye a la tabla de bloques de
> `docs/design/reservas-modulo-kickoff.md` §7 (que se queda como el documento de **arranque** y de
> ADRs, no como el orden de trabajo).
>
> **De dónde sale.** Del cruce `docs/reservas/01-cruce-con-b-reservas-4.md`, que verificó fichero a
> fichero qué de la ingeniería inversa de Koibox ya estaba resuelto aquí y qué no.
>
> **Última actualización:** 2026-09-02 · **Verificado contra** `master` en `1d169ef`.

---

## Cerrado

| Bloque | Qué dejó | Cierre |
|---|---|---|
| **B-reservas-1 · CRM** | `Client`, búsqueda, historial, RGPD, ficha técnica. Contratos de saldo y de citas publicados vacíos | `docs/blocks/B-reservas-1-done.md` |
| **B-reservas-2 · Catálogo extendido** | `ServiceScheduling` (duración + buffers + `staffRequired` + canales), `Resource`, `ServiceResourceNeed`, flag `agendaEnabled` | `B-reservas-2-done.md` |
| **B-reservas-3 · Personal** | `StaffProfile`, `StaffSkill`, `StaffShift` (rrule) y la plantilla de disponibilidad | `B-reservas-3-done.md` |
| **B-reservas-4 · Agenda** | El motor (`CitaMode`), el anti-solape físico (`EXCLUDE USING gist`), las 3 superficies, el puente cita→caja, el job de TTL | `B-reservas-4-done.md` |

## Escrito, sin implementar

| Bloque | Qué | Estado |
|---|---|---|
| **B-reservas-5 · Cita → caja unificada** | Que el cobro **pague el DRAFT enlazado** (como una mesa) y la cita pase sola a `COMPLETED`. Carryovers 1 y 2 de B4 | Prompt listo: `docs/code-prompts/bloque-reservas-5-cita-caja.md`. **Es el bloqueante para encender `agendaEnabled` a la primera clienta** |

---

## Abiertos por el cruce · el orden en que se atacan

| # | Bloque | Por qué va aquí | Prerrequisitos | Prompt |
|---|---|---|---|---|
| **1** | **B-reservas-6 · Capa de yield** | El de más valor por euro. Salda la deuda declarada de B4 (ADR-R8 §3.6 prometía min/max lead y no llegó), arregla que **hoy se pueda reservar en el pasado**, cierra la fuga de la rejilla (D-4b) y trae de paso el test de integración del EXCLUDE contra Postgres real | **P0**, **P1**, **P8**. Ningún dato que falte | `bloque-reservas-6-yield.md` |
| **2** | **B-reservas-7 · Ventana reservable** | Barato y aditivo. Desbloquea el **horario del centro** y los **festivos**, que hoy no existen (invariante 13). Sin él, abrir un hueco obliga a mentir en el turno | **P0**, **P1**. F3 (horas contratadas) **no bloquea**: la ventana deriva del turno mientras tanto | `bloque-reservas-7-ventana-reservable.md` |
| **3** | **B-reservas-9 · Panel de salud** | Va **antes** que B-8 a propósito: es la pantalla que hace visible que **F1 está a medias**, y F1 es el prerrequisito de que la agenda sirva para algo. Degrada honestamente las tarjetas cuyos bloques aún no estén | **P0**, **P1**. Tarjetas 4 y 6 dependen de B-6 y B-7 (se muestran deshabilitadas si no están) | `bloque-reservas-9-panel-salud.md` |
| **4** | **B-reservas-8 · Programa multisesión** | El diferencial comercial. Espera porque tiene tres decisiones delante, y una es fiscal | **P0**, **P2** (extender el voucher, no crear `Program`), **P4** (caducidad), **P5** (⚠️ **fiscal**, asesoría). ADR-R3 pendiente de confirmar antes de producción | `bloque-reservas-8-programa-multisesion.md` |
| **5** | **B-reservas-10 · Importación Koibox** | El último: sólo hace falta el día que entre un centro que viene de Koibox, y es el único que depende de una API de terceros **sin entorno de pruebas** | **Las sondas K2 lanzadas desde el Mac de Matías.** Sin ellas, la mitad del mapeo es hipótesis | `bloque-reservas-10-importacion-koibox.md` |

**Renumerados** (divergencia D-1 del cruce, pendiente de confirmar en **P1**):

| Antes (kickoff §7) | Ahora |
|---|---|
| B-reservas-6 · Reserva online embebible | **B-reservas-11** |
| B-reservas-7 · Recordatorio de cita | **B-reservas-12** |
| B-reservas-5 · Bonos y tarjetas regalo | Absorbido por **B-reservas-8** (la parte de sesiones); las tarjetas al portador (`type=AMOUNT`) quedan como deuda |

---

## No son bloques, son cierres de otros

| | Qué | Dónde entra |
|---|---|---|
| **H5 · Suite de invariantes** | 9 de los 14 invariantes sin test que los ejerza. **Incluido el más caro: el `EXCLUDE USING gist` nunca se ha ejecutado contra un Postgres real** (el harness es fake-prisma y el test simula el constraint) | Invariantes 2, 4, 6 y 14 + el test de integración real → **cierre de B-6**. Invariante 13 → **B-7**. Invariante 9 → **B-8**. Invariante 5 → **B-9**. Los 11 y 12 son test barato y caben en cualquiera |
| **H7 · Auditoría UX como contraste** | Le faltan a la UI de B4: banner de deshacer, esqueleto de carga, estado de conflicto, estado «reservando…», matriz de screenshots | **Cierre de B-6/B-7/B-9**, que son los que vuelven a tocar esas pantallas. **No es spec para rehacer B4** |
| **Invariante 10 · 400 ante parámetro desconocido** | Hoy el campo desconocido se **elimina** en silencio y devuelve 200 (ajv por defecto de Fastify) | Divergencia **D-4**: decisión **global de la API**, no del módulo. Pendiente de Matías |

---

## Prerrequisitos que no son código

### Decisiones

| # | Decisión | Quién | Bloquea |
|---|---|---|---|
| **P0** | **¿Vertical aparte o dentro del TPV?** Recomendación: **dentro, encendida por `agendaEnabled`** — separarla rompería el modo mesa (núcleo agnóstico, ADR-R8), duplicaría la caja y el camino a Holded, y le quitaría a la capa de yield la mitad de su valor. Razonada en la **Parte 6** del cruce. Aparte: si Raquel Torres entra como tenant | Matías | **Todo lo demás.** Si cambia, se reescriben los cinco prompts |
| **P1** | Confirmar la renumeración de bloques (D-1) | Matías · 5 min | Abrir cualquier bloque |
| **P2** | B-8 **extiende el voucher**, no crea `Program` (D-2) | Matías | B-8 |
| **P3** | ¿La API pasa a 400 ante parámetro desconocido? (D-4) | Matías · global | Nada de estos bloques |
| **P4** | ¿Caducan los programas y a cuánto? | Raquel + asesoría | B-8 |
| **P5** | ⚠️ ¿Qué importe va a la línea del ticket al consumir una sesión: 0 € o prorrateado? **Es fiscal** | **Asesoría fiscal** (ADR-R3) | B-8 y **producción** |
| **P6** | El buffer de recogida: ¿por servicio, por cabina o por persona? | Raquel + medir el histórico | El **valor**, no el esquema |
| **P7** | ¿Recursos (cabinas/aparatos) en la v1, o fuera con deuda anotada? | Matías | El alcance de F2 |
| **P8** | ¿Quién puede anular desde el mostrador y con cuánta antelación? | Matías | La regla de cancelación de B-6 |

### Datos que **hoy no existen en ninguna parte**

**Regla:** ningún bloque inventa semillas con ellos. Se construyen para **funcionar y quejarse**
cuando faltan.

| | Qué falta | Sin él | Prerrequisito de |
|---|---|---|---|
| **F1** | La **matriz servicio × profesional**. El modelo está (`StaffSkill`); las filas no | El motor devuelve cero huecos **en silencio** para todo servicio sin skill | **Cualquier demo real.** B-9 lo hace visible |
| **F2** | El **inventario de cabinas y aparatología** | Los recursos no restan: se puede sobrevender la cabina | Recursos en la v1 (P7) |
| **F3** | Las **horas contratadas reales** | Cualquier informe de ocupación es humo | B-7 para separar turno de ventana. **No bloquea código** |

Los tres se resuelven en **una sola reunión** con la carta y una hoja de cálculo delante, junto con
P4, P6 y P7.

---

## Fuera de esta versión · explícito

Se dice aquí para que ningún bloque lo dé por supuesto ni se lo coma por el camino:

- **Vista de mes** e informes/analítica de agenda (ocupación histórica, ranking, ingresos por franja).
- **Lista de espera** avanzada y reserva de grupo.
- **Sincronización bidireccional** con calendarios externos (Google, iCal).
- **Capa predictiva / IA de yield.** Cero reservas online = cero datos con los que entrenar. Las reglas
  de B-6 son deterministas y auditables; lo predictivo, si llega, va **encima**, nunca en lugar de.
- **Señal al reservar** (ADR-R5b, decisión abierta). La columna `depositCents` existe; la pasarela se
  decide con lo que ya usa el ecosistema — **no entra Stripe**.
- **Reserva online embebible** (B-reservas-11) y **recordatorios** (B-reservas-12).
- **Tarjetas regalo al portador** (`voucher type=AMOUNT` sin cliente hasta el canje).
- **Fichaje, control horario y comisiones** del personal.
- **`catalogDurationMin`** (publicar 90 y bloquear 100): deuda de catálogo (D-5), no urgente.
- **App nativa** específica de agenda: la PWA del TPV es suficiente para el piloto.
- **Sincronización continua con Koibox**: B-10 importa y, como mucho, lee. Escribir en su agenda de
  forma sostenida es otra conversación.

---

## La métrica

Una sola, y no es «uso»:

> **Porcentaje de citas del centro que se crean en nuestra agenda y no en el sistema anterior, medido
> a las cuatro semanas del arranque.**

Si el mostrador no la adopta, lo demás da igual: la protección de franjas de B-6 **sólo vale entera
cuando la política la aplica la casa completa**, y eso empieza por que la herramienta sea más rápida
que la que ya tienen.

---

*Se actualiza al cerrar cada bloque: mover a "Cerrado", anotar carryovers y revisar el orden. El
roadmap no se vende, se planifica.*
