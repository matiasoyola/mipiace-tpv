# Bloque v1.12 · Mesas abandonadas

> **Hallazgo (BD de producción, 2026-08-20 y confirmado el 26).** Cafetería Sirope tiene **cuatro mesas
> ocupadas desde el 9 de julio** — M1, M2 y M4 de `gemmamgc72`, y T1 —, todas a **0,00 €**. Nadie las abrió
> a propósito: un toque en el mapa crea el `Ticket DRAFT` con `tableId`, y desde ese momento la mesa está
> ocupada para siempre. No hay forma de soltarlas salvo entrar mesa a mesa.
>
> v1.11 arregla el turno que no se cierra. Esto es el mismo problema una capa más abajo: **el estado que
> nadie apaga**. Un mapa de sala con cuatro mesas falsas ocupadas deja de ser un mapa: el camarero aprende a
> ignorarlo, y ese es el día en que el mapa deja de servir para nada.

## Depende de

**Mergear v1.11 antes** (`v1-11-cierre-de-dia`). Este bloque **extiende su job**, no crea uno nuevo: el corte
de día ya corre cada hora con la hora local de cada tenant. Si v1.11 no está en master, para y dilo.

## Contexto (leer antes)

- `docs/blocks/v1-11-cierre-de-dia-done.md` — el patrón entero: job horario, `Tenant.dayCutHour`,
  reclamación con `updateMany` guardado, y por qué el corte cierra con `closedAt = now`.
- `apps/api/src/shift/day-cut-run.ts` — la pasada a la que se engancha esto.
- `apps/api/src/tables/routes.ts` — cómo se ocupa y se libera una mesa hoy.
- `packages/db/prisma/schema.prisma` — `Table` (§617) y `Ticket.tableId` (§1038): *"con un ticket
  `tableId=X, status=DRAFT` la mesa X está ocupada"*. Ahí está todo el modelo de ocupación.
- Memoria de proyecto: `principio-cobro-en-mesa` — en un bar **el mapa manda**. Una mesa que miente es un
  fallo de producto, no cosmética.

## Alcance

### 1. Soltar lo que no tiene dinero dentro

Al pasar el corte de día de su tenant, un `Ticket DRAFT` con `tableId` que **no tiene ni una línea** se
anula (`VOIDED`) y su mesa queda libre.

- **Sólo drafts vacíos.** Cero líneas y total 0,00 €. Es el caso de las cuatro de Sirope y es el único que
  se puede decidir sin preguntarle a nadie: no hay consumo, no hay cliente, no hay nada que cobrar.
- **Un draft CON líneas no se toca jamás**, tenga la edad que tenga. Puede ser una cuenta de verdad que se
  quedó a medias, y anularla es borrar una comanda. Va al punto 2.
- Anular reutiliza el camino que ya existe en `tables/routes.ts`; no inventes un segundo.
- Auditoría: quién lo anuló (`SISTEMA`), cuándo y por qué. Mismo criterio que `closeReason` en v1.11 — la
  columna dice **por qué**, no sólo que pasó.

### 2. Las que sí tienen dinero: decirlas, no tocarlas

Un `DRAFT` con líneas y más de 24 h de antigüedad es un aviso, no una acción:

- En el mapa, la tarjeta lo marca (ya sabe pintar `43 días` desde v1.10.3 — **no rehagas el contador**).
- Y en el admin, una lista corta: mesa, importe, desde cuándo, quién la abrió, con un botón de **Cobrar** y
  otro de **Anular** que exige PIN de encargado. Lo resuelve una persona, que es de quien es la decisión.

### 3. Que no vuelva a pasar

El bug de origen no es el barrido: es que **un toque en el mapa ocupa la mesa para siempre**. Mira si el
draft vacío se puede no crear hasta la primera línea, o borrarse al salir del detalle sin haber añadido
nada. Si eso es un cambio grande o toca el camino de cobro, **no lo hagas**: escríbelo en el done.md con lo
que hayas averiguado y quédate en el barrido. Es más importante entender la causa que arreglarla hoy.

## Entregable

- Extensión del job de corte + tests contra el prisma falso: draft vacío antiguo → anulado y mesa libre;
  draft **con líneas** → intacto pase el tiempo que pase; draft de hoy → intacto; un fallo no arrastra al
  resto de tenants (el patrón ya está en `day-cut-run.ts`).
- La lista del admin con sus dos acciones.
- `docs/blocks/v1-12-mesas-abandonadas-done.md`.
- **Criterio de "funciona"**: con la BD de Sirope, la pasada deja las cuatro mesas libres, no toca ninguna
  cuenta con consumo, y el mapa vuelve a decir la verdad. Y queda escrito en el done.md **qué cuentas con
  dinero había** y desde cuándo.

## Fuera de alcance

- Tocar el modelo de mesas, zonas, agrupaciones o el canvas del admin.
- Cerrar turnos: eso es v1.11 y ya está.
- Notificaciones, emails o dashboards de mesas abandonadas.
- Cualquier cosa que anule un ticket con importe sin que lo pulse una persona.
