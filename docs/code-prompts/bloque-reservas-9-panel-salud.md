# Bloque Reservas-9 · Panel de salud de la agenda

> **La pantalla que habría ahorrado dos semanas.** En el centro real, 44 de 45 servicios no tenían
> ninguna profesional asignada, la API devolvía 200 OK y cero huecos, y **ninguna pantalla lo
> insinuaba**. Costó dos semanas de diagnóstico
> (`docs/reservas/00-koibox-ingenieria-inversa-y-modelo.md` §7.1, hallazgo nº 2).
>
> Aquí el mismo fallo está disponible de fábrica: un servicio sin `StaffSkill` se descarta **en
> silencio** (`apps/api/src/agenda/engine.ts:336-353`) y no hay ninguna pantalla de diagnóstico —
> el único "health" del front es el banner de Holded de la venta
> (`apps/tpv-web/src/pages/SalePage.tsx:2620`), que no tiene nada que ver.
>
> Rama propia en worktree. Sin push.

## Contexto (leer antes)

- **`docs/reservas/01-cruce-con-b-reservas-4.md`** — §H4 (el hueco), §7 (los prerrequisitos de datos
  F1/F2: **el panel es lo que los hace visibles**), y §H7 (las reglas UX que este bloque debe cumplir
  al tocar la pantalla).
- **`docs/reservas/00-koibox-ingenieria-inversa-y-modelo.md` §7.5** — las seis tarjetas. Y §7.1, la
  auditoría del incumbente: **es lista de contraste, no spec para rehacer nuestra UI.**
- `docs/ux-principles.md` y la skill `metodologia-front-mipiace` §4 — la vara de casa.
- La skill `sistema-visual-mipiace` — tokens `mipiace.*`, sin negociación. Divergir es un bug.
- `apps/tpv-web/src/pages/AgendaPage.tsx` — la pantalla existente, de la que este panel cuelga.
- `docs/blocks/B-reservas-3-done.md` — el contrato de la matriz `StaffSkill`, que este bloque hace
  editable desde el segundo lado.

## Alcance

### 1. El principio que gobierna el bloque · **cada cifra documenta la consulta que la produce**

> **ADR-F3 / principio de auditabilidad: no hay ni una cifra en esta pantalla sin su consulta al
> lado.** Cada tarjeta expone, junto al número, **la consulta exacta que lo calcula** — visible para
> el operador (en un desplegable «cómo se calcula esto», en lenguaje llano) y **literal en el código**
> (la SQL/Prisma que produce el número, en un único módulo, no repartida por el front).
>
> Un número sin consulta no entra. Si una tarjeta no se puede explicar, la tarjeta no existe: acabaría
> apagada por desconfianza, que es exactamente lo que le pasa al incumbente.

Se implementa como un módulo `apps/api/src/agenda/health.ts` donde **cada tarjeta es una entrada
con `{ key, title, query, explain, run() }`**, y el endpoint devuelve la cifra **y su explicación**.
El front no calcula nada: pinta lo que el server le da.

### 2. Las seis tarjetas

| # | Tarjeta | La cifra | Por qué está |
|---|---|---|---|
| 1 | **Servicios que nadie puede hacer** | Nº de servicios con `service_scheduling` y **cero** `staff_skill`, y la lista | **La tarjeta más importante del panel.** Es el fallo que costó dos semanas. Enlace directo a arreglarlo |
| 2 | **Variantes cuya duración no cuadra con la carta** | Nº de servicios cuya duración de agenda se desvía del patrón declarado del centro | Cazó un mapeo que llevaba meses mintiendo (30 min y 35 € en vez de 120 min y 130 €) |
| 3 | **Programas con saldo vivo y sin próxima cita** | Nº de vouchers `SESSIONS` con `sessionsLeft > 0` y ninguna cita futura | **Es dinero cobrado y no entregado.** Requiere B-reservas-8 |
| 4 | **Qué han filtrado hoy las reglas** | Huecos ofrecidos vs. huecos físicamente disponibles, **desglosado por regla** | Sin esto las reglas de yield son una caja negra y acaban apagadas. Requiere B-reservas-6 |
| 5 | **Citas creadas por canal en 24 h** | Recuento por `ReservationSource` | Mide la adopción: la métrica de éxito de la v1 es qué porcentaje de citas entra por aquí |
| 6 | **Ventanas que se desvían del turno contratado** | Nº de `bookable_window` con `derivedFromShiftId = NULL`, y cuáles | Hace visible la desviación. Requiere B-reservas-7 |

**Degradación honesta:** una tarjeta cuyo bloque no esté aún construido **se muestra deshabilitada
diciendo de qué depende** — nunca un cero que parezca un dato bueno. Un cero falso es peor que un
hueco declarado.

### 3. Matriz servicio × profesional, editable desde los dos lados (P7)

El inventario, no la configuración: **si nadie sabe hacer un servicio, ese servicio no se ofrece.**

- Vista de matriz con servicios en filas y profesionales en columnas, con el estado de cada celda.
- **Editable desde los dos lados**: desde la ficha del profesional (qué servicios da) y desde la ficha
  del servicio (quién lo da). El documento de entrada mide que la segunda vía es más rápida y menos
  peligrosa que la oficial del incumbente; se adopta como patrón.
- **Ninguna de las dos vistas esconde el dato.** Un servicio apagado que **conserva** sus
  profesionales lo enseña: lo oculto que sigue gobernando el comportamiento está prohibido (regla nº 1
  de la auditoría).
- Buscador y filtro «sólo los que no tienen a nadie» — la ruta de un clic desde la tarjeta nº 1.

### 4. Acabado (las reglas de H7 que se saldan aquí)

Al tocar esta pantalla se cierran, en este bloque, cuatro puntos del §H7 del cruce:

- **Estado de carga = esqueleto**, no spinner. La estructura ya informa.
- **Estado de error de red**: la última foto **con su hora** + reintentar. Se sigue pudiendo leer.
- **Estado vacío informativo** en cada tarjeta: «0 servicios sin nadie» es una **buena noticia** y se
  dice así, no se deja en blanco.
- **Sin tooltips ni hover como única vía** (la tablet no tiene puntero); targets ≥ 44 px, 56 px en lo
  frecuente; cifras en `tabular-nums`; sin emojis, iconografía Lucide.

## Restricciones

- **Cada cifra documenta su consulta.** Es la restricción dura del bloque (ADR-F3). Un número sin
  consulta trazable no se muestra.
- **NO se rehace la UI de B4.** La auditoría del §7 del documento de entrada es de la interfaz del
  **incumbente**, no de la nuestra: se usa como lista de contraste. La rejilla, el panel de alta sin
  scrim y el detalle inline **no se tocan**.
- **Sólo lectura, salvo la matriz.** El panel diagnostica; no arregla nada por su cuenta. La única
  escritura de este bloque es la edición de `staff_skill`.
- **NO se inventan datos.** F1 (matriz servicio × profesional) y F2 (cabinas y aparatos) **no existen
  todavía** (§7 del cruce). El panel se construye para **enseñar que faltan**, no para simularlos. Sin
  semillas fabricadas.
- **NO se implementan** las reglas de yield (B-6), la ventana reservable (B-7) ni el saldo (B-8): este
  bloque **consume** lo que esos publiquen y degrada honestamente si no está.
- Herencia **total** del `sistema-visual-mipiace`. Gate `agendaEnabled` en ruta y UI. Multi-tenant.
- **No commit en el worktree principal.** `git worktree list` antes de la primera línea. No push.

## Entregables

- `apps/api/src/agenda/health.ts` — las seis tarjetas como entradas con su consulta y su explicación.
- API: `GET /agenda/health` (las seis, con cifra + explicación + estado de dependencia) y el CRUD de
  la matriz desde el segundo lado.
- Front: panel de salud + pantalla de matriz editable desde los dos lados, con sus estados de carga,
  error y vacío.
- **Tests**: cada tarjeta devuelve la cifra correcta sobre un fixture conocido · **la tarjeta 1 detecta
  el caso real: un servicio agendable con cero skills sale en la lista** · una tarjeta cuya
  dependencia no está se muestra **deshabilitada, no a cero** · la matriz escribe igual desde los dos
  lados · aislamiento por tenant.
- **Evidencia visual obligatoria** (matriz de screenshots de la metodología): 320 px · 390 px ·
  escritorio · un estado de error · la pantalla final. Revisados contra los principios UX antes de
  escribir el `done.md`.
- **Criterio de "funciona"**: en un tenant con tres servicios agendables de los que **dos no tienen
  ninguna profesional asignada**, el panel lo dice **en grande** al abrirlo, lista los dos, y desde ahí
  se llega en un clic a la matriz y se arregla — sin salir de la agenda y sin que nadie lo explique.
  Y cada cifra enseña, al desplegarla, cómo se ha calculado.
- **Tabla sabotaje → test rojo** en el cierre.
- `docs/blocks/B-reservas-9-done.md` con la plantilla de la metodología.

## Fuera de alcance (explícito)

- **Informes y analítica de agenda** (ocupación histórica, ranking de profesionales, ingresos por
  franja) — fase 2. Este panel es **diagnóstico operativo**, no BI.
- **Alertas y notificaciones** (avisar por email de que hay servicios sin nadie) — fase 2. Aquí sólo
  la pantalla.
- **Arreglar automáticamente** nada de lo que se detecta.
- **El inventario de recursos** (cabinas/aparatos) como tarjeta: depende de F2, que no existe. Se
  anota como deuda.
- **Vista de mes, lista de espera, sincronización con calendarios externos** — fuera de la versión.
- Cualquier cosa de Koibox — **B-reservas-10**.

---

*Lanzar como los bloques previos: implementar respetando alcance/restricciones/fuera-de-alcance,
escribir el `-done.md`, no commit/push. Commit selectivo después (stage → revisar → commit), NUNCA
`git add -A`.*
