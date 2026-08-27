# Bloque v1.13 · e2e del ciclo de caja contra Postgres de verdad

> **Por qué ahora.** v1.11 mete un job que **cierra turnos solo, en producción, a las cinco de la mañana**, y
> una imputación que decide a qué turno pertenece cada venta que llega tarde. Todo eso está probado contra un
> **prisma falso**: los tests fijan la lógica, pero nadie ha visto el ciclo entero correr contra una BD real.
> El propio done.md lo dice en su carryover: *"No hay e2e del ciclo completo contra BD real"*.
>
> El historial pesa aquí: el rollback del 19 de agosto fue por una interop CJS/ESM de `rrule` que ningún test
> unitario podía ver, y por eso existe el paso de humo en CI. Este bloque es el siguiente escalón del mismo
> razonamiento: **lo que no se ha ejecutado de verdad, no funciona todavía.**

## Depende de

**La base de integración de v1.12** (`v1-12-base` = `master ← v1-10-3 ← v1-11`), no `master`: el corte de
día que este bloque prueba no existe en master todavía.

Y **v1.12-B (mesas abandonadas) por delante**, no en paralelo: B extiende exactamente el mismo job
(`day-cut-run.ts`) y toca los mismos tests de api. Sal de la rama de B cuando cierre:

```bash
git worktree add -b v1-13-e2e-ciclo-de-caja ../mipiacetpv-v1-13 v1-12-b-mesas-abandonadas
```

El carril A (front, `manos de camarero`) sí es indiferente: no toca `apps/api/`.

## Contexto (leer antes)

- El job `smoke` del CI: levanta la imagen `api` contra Postgres y Redis y pide `/health`. **Ya tienes ahí
  montada la infraestructura entera** — este bloque la reutiliza, no monta otra.
- `docs/blocks/v1-11-cierre-de-dia-done.md`, sección *"Cómo probarlo de cero"*: **son ocho pasos y son el
  guion de este bloque.** Traducirlos a un test es literalmente el alcance.
- Memoria: `mock-catalog-tests` — por qué hay tests que pasan en local y fallan en CI, y por qué **CI verde
  es puerta del protocolo anti-sustos**.
- `apps/api/test/` — el estilo de tests que ya existe. Esto es una **suite aparte**, no la de siempre.

## Alcance

### 1. Una suite e2e que se pueda no correr

Suite separada (`pnpm test:e2e` o equivalente), que arranca sólo con `DATABASE_URL` real apuntando a una BD
**desechable**. Sin esa variable, se salta con un mensaje claro. Nadie debe quedarse sin poder correr
`pnpm vitest run` en su portátil por esto.

Migraciones reales (`prisma migrate deploy`) sobre BD limpia, no `db push`: así el e2e prueba **también la
migración**, incluido el backfill de v1.11.

### 2. El ciclo, de punta a punta

Un solo camino, el que hace Sole cada día, sin mocks de BD:

1. Tenant + tienda + caja + cajero. Abrir turno con fondo.
2. Vender: dos tickets, uno en efectivo y otro mixto (efectivo + tarjeta). **Los importes se comprueban
   contra la BD**, no contra la respuesta del API.
3. Forzar el corte de día (llamar a la pasada con un `now` fabricado, no esperar a las cinco). El turno
   queda cerrado, con `closeReason = AUTO_DAY_CUT`, `cashCounted` NULL y su Z generado.
4. **El caso offline, que es el que de verdad importa**: subir un ticket con `occurredAt` de *antes* del
   corte y `shiftId` del turno ya cerrado. Tiene que entrar en el turno de ayer, marcar `zReportStale`, y
   **no perderse**. Y otro con `occurredAt` posterior → al turno nuevo.
5. Abrir el turno siguiente y comprobar que `GET /shift/last-closed` devuelve el resumen del anterior — y
   que después de `ack-summary` ya no lo devuelve.
6. Cerrar sin contar (`close-day`) y comprobar el descuadre `null`.
7. **El barrido de mesas de v1.12-B, en la misma pasada**: una mesa con un `Ticket DRAFT` vacío de hace
   días queda libre y su ticket `VOIDED` con auditoría; una mesa con un draft **con líneas** sigue ocupada
   pase el tiempo que pase. Es la aserción que impide que un refactor futuro del corte se lleve por delante
   una comanda de verdad.

## Restricciones

- La suite **no puede** romper `pnpm vitest run` a nadie: sin `DATABASE_URL` de BD desechable, se salta con
  un mensaje claro.
- Migraciones reales (`prisma migrate deploy`), nunca `db push`: la migración es parte de lo que se prueba.
- BD desechable siempre. Este e2e **no apunta jamás** a la BD de producción ni a la de un cliente, ni
  siquiera en modo lectura.
- No se reescribe ningún test existente: se **añade** una suite.
- Commits en la rama del bloque; **no hagas push**.

Cada aserción, contra `SELECT`s. Si el test puede pasar con la BD vacía, no es un e2e.

### 3. En CI, donde ya hay Postgres

Engancharlo al job que ya levanta Postgres y Redis. Si tarda, que sea un job aparte que **no bloquee** el
`publish` mientras se estabiliza — pero que se vea rojo. Un e2e que nadie mira no existe.

## Entregable

- La suite, el script de `package.json` y el cambio de CI.
- `docs/blocks/v1-13-e2e-ciclo-de-caja-done.md` con **cuánto tarda** y qué hay que hacer para correrla en local.
- **Criterio de "funciona"**: rompe a propósito una pieza del corte de día (por ejemplo, quita el guard
  `closedAt: null` de la reclamación, o devuelve el turno abierto en vez del de la ventana en
  `resolveShiftForSale`) y **el e2e tiene que ponerse rojo**. Si no, no está probando el ciclo: déjalo escrito.

## Fuera de alcance

- Playwright, navegador, o cualquier cosa que toque el TPV. Esto es API + BD.
- Holded: mockeado en el borde, como en el resto de tests. Aquí no se prueba el ERP.
- Reescribir los tests que ya existen. Se **añade** una suite, no se migra nada.
