# hotfix-fichaje-medianoche · done

Un turno que pasa de las 00:00 se cierra con un toque, como cualquier otro.

**Afecta a todos los clientes que fichan.** Rama `hotfix-fichaje-medianoche`, PR contra `master`.

## Qué estaba roto

«Salida olvidada» se decidía comparando el **día del calendario** de la entrada con el de ahora.
Quien entra a las 20:00 y sale a la 01:00 recibía un 409 `PENDING_EXIT_REQUIRES_REASON` y tenía
que corregir su propia salida con motivo. En una residencia eso es **cada turno de noche**
(22:00-08:00); en un bar, cada cierre pasada la medianoche.

Lo destapó el CI de master: rojo entre las 00:00 y las 02:00 de Madrid, verde a las nueve de la
mañana. `f3-fichar` («entrada y salida: un tramo completo», entrada hace 4 h) y `f8-colegio` no
eran tests rotos, eran el síntoma.

## Dónde decide ahora el «olvidado»

**`esSalidaOlvidada(entry, now, maxHoras)` en `apps/api/src/fichaje/time.ts`, y sólo ahí.**

```ts
if (entry.endedAt != null) return false;
return now.getTime() - entry.startedAt.getTime() > maxHoras * 3_600_000;
```

Por duración, no por calendario. Sobre los **instantes**, como todo en ese fichero: la noche del
cambio de hora dura lo que dura. El límite exacto **no** es olvido — con 16 h de máximo, un tramo
de 16 h clavadas se cierra con un toque; a los 16 h y un minuto, se pregunta.

Lo usan las tres superficies que antes comparaban `localDate` cada una por su cuenta:

| Superficie | Antes | Ahora |
|---|---|---|
| `POST /fichaje/v1/entries/:id/close` (`routes.ts:473`) | `localDate(startedAt) !== localDate(now)` | `esSalidaOlvidada(entry, now, maxHoras)` |
| `GET /fichaje/v1/me` (`routes.ts:269`) | ídem | ídem |
| `GET /admin/fichaje/today` (`admin-routes.ts:412-460`) | ídem, en dos listas | ídem, en las dos |

`apps/api/src/fichaje/max-open.ts` es lo único que faltaba: de dónde sale el tercer argumento.
Falla hacia el default — si la columna no se puede leer, ese tenant se comporta como los demás.
Tumbar un cierre de turno por no poder leer un ajuste que casi nadie toca sería al revés.

## El máximo es dato del tenant

`tenants.fichaje_max_open_hours`, entero, **default 16**, CHECK en la base entre **8 y 24**.

16 cubre el turno de noche de una residencia, una jornada partida larga y el cierre de un bar, y
deja fuera «entré ayer a las 9 y no salí» (a las 10 de la mañana siguiente lleva 25 h).

**No hay pantalla.** Se ajusta desde super-admin cuando un cliente lo pide:

```
PATCH /super-admin/tenants/<id>  {"fichajeMaxOpenHours": 24}
```

Con su rango en el schema de la ruta (400, no un 500 de Postgres), su diff en el audit y el valor
en el detalle del tenant. El rango vive en los dos sitios a propósito: un 0 convertiría cada
fichaje en olvidado en cuanto pasara un segundo, y un 200 no cerraría nunca una salida olvidada.

## Lo que cambia en «Hoy» del panel

Tres cosas, todas del mismo caso:

- El turno que entró a las 22:00 sale como **DENTRO** a las 02:00. Antes se escondía (su tramo «no
  era de hoy») y encima aparecía como aviso de **salida olvidada**: la empresa veía un aviso rojo
  por alguien que estaba en el edificio.
- Quien **fichó la salida hoy** deja de salir en «no ha fichado». El tramo sigue perteneciendo al
  día en que empezó, pero a la 01:05 esa persona acaba de tocar su móvil para decir «me voy».
- La consulta recoge también los tramos que **terminaron** dentro del mes aunque empezaran antes.
  El día 1 a las 07:00, el turno que entró el 31 a las 22:00 no entraba por ninguna rama.

## Lo que NO cambia

- **El tramo pertenece al día en que empezó**, en el registro, el panel y la exportación: 22:00 del
  23 → 08:00 del 24 es una jornada del 23 de 10 h. Ya lo hacía (`toEntryView` agrupa por
  `localDate(startedAt)` y `construirRegistro` filtra por `startedAt`); ahora tiene test.
- **El cierre de un tramo de más de 16 h sigue yendo por corrección con motivo**, con su auditoría.
- Para quien ficha en el día: mismas pantallas, mismos toques, mismo contrato de la API. El front
  no se ha tocado.

## Cómo se ha comprobado

- Typecheck de API, los seis `packages`, `tpv-web` y `admin`: limpio.
- `pnpm test` desde la raíz: **458 ficheros, 6 629 tests**, verde.
- e2e completo contra Postgres de verdad, con `deadlock_timeout` a 50 ms.
- **La franja del fallo, a mano.** `test-e2e/reloj-fijado.ts` fija el reloj de la suite con
  `FICHAJE_RELOJ` (finge sólo `Date`, con `shouldAdvanceTime`; no-op sin la variable):

  ```
  FICHAJE_RELOJ="2026-09-23T00:30:00+02:00" pnpm --filter @mipiacetpv/api test:e2e
  FICHAJE_RELOJ="2026-09-23T01:59:00+02:00" pnpm --filter @mipiacetpv/api test:e2e
  ```

  f3 + f4 + f8 a las **00:30**, a la **01:59** y a las **13:00**: 62 tests verdes en las tres.
  Con el criterio viejo puesto de vuelta, a las 00:30 caen 9 — entre ellos los dos que el CI de
  master venía dando: `f3 · entrada y salida: un tramo completo` y `f8 · 7 · ficha la entrada y la
  salida`.
- Sabotajes comprobados (puestos, rojo, retirados):
  1. volver a `localDate(startedAt) !== localDate(now)` → 8 rojos en el banco puro, 9 en el e2e de 00:30;
  2. `>=` en vez de `>` en el límite → 3 rojos (las 16 h clavadas);
  3. ignorar el máximo del tenant y usar siempre 16 → 1 rojo (el e2e del tenant con 8).
- El CHECK de la base, a mano: `0` y `25` rechazados, `8` aceptado, default `16` en una fila nueva.

Los e2e de fichaje ya no dependen de la hora a la que corran. «Ayer a las 08:00» lleva abierto
entre 16 h —a medianoche en punto, justo el límite, que **no** es olvido— y 40 h; el tramo olvidado
de los bancos es ahora de anteayer (entre 40 h y 64 h).

## Al desplegar

1. **Hay migración**: `20261024000000_fichaje_salida_olvidada_por_duracion`. Añade una columna con
   default y un CHECK; no toca datos, no bloquea nada apreciable, no necesita ventana.
2. Nada más. Ningún tenant hay que tocar: el 16 de serie es el que resuelve el caso. Si un cliente
   pide otro, el `PATCH` de arriba.
3. Rollback: revertir el código basta. La columna sobrante no molesta a la versión anterior.
