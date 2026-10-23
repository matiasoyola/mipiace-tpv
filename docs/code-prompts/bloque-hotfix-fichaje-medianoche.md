# Bloque hotfix-fichaje-medianoche · un turno que pasa de las 00:00 se cierra con un toque, como cualquier otro

Rama `hotfix-fichaje-medianoche`, worktree `~/Developer/Claude/Projects/mipiacetpv-hotfix-fichaje`,
desde `origin/master`. PR contra `master`. Escrito el 24-10-2026 desde el proyecto de Jardín de Gredos.
**Hotfix: afecta a todos los clientes que fichan; se despliega en cuanto esté verde.**

## Qué pasa (encontrado porque el CI de master falla entre las 00:00 y las 02:00 de Madrid)

El fichaje decide que una salida es «olvidada» comparando **el día del calendario** de la entrada con
el de ahora:

- `apps/api/src/fichaje/routes.ts:473` · al cerrar: `localDate(entry.startedAt) !== localDate(now)` →
  409 `PENDING_EXIT_REQUIRES_REASON` («Este fichaje es de otro día»).
- `routes.ts:269` · al abrir la pantalla: un tramo abierto de otro día se presenta como salida
  olvidada y se pregunta la hora.
- `admin-routes.ts:412-460` · el panel separa «abiertos de hoy» y «salidas olvidadas» por el mismo
  criterio.

Consecuencia: **quien entra a las 20:00 y sale a la 01:00 no puede fichar la salida**; se le trata
como si se le hubiera olvidado ayer y tiene que corregirla con motivo. En una residencia es **cada
turno de noche** (22:00-08:00). En un bar, cada cierre pasada la medianoche. Los e2e `f3-fichar`
(«entrada y salida: un tramo completo», entrada hace 4 h) y `f8-colegio` lo destapan sólo cuando el CI
corre entre las 00:00 y las 02:00: no son tests rotos, son el síntoma.

## Decisiones de producto ya tomadas — no se re-debaten

1. **«Olvidada» se decide por la duración, no por el calendario.** Un tramo abierto es una salida
   olvidada cuando lleva abierto **más de un máximo de horas** (de serie **16 h**: cubre un turno de
   noche de 10 h, una jornada partida larga y un cierre de bar, y deja fuera «entré ayer a las 9 y no
   salí»). Mientras no lo supere, la salida se ficha con un toque normal, sea el día que sea.
2. **El máximo es dato del tenant**, con el 16 de serie (una columna en los ajustes del fichaje, con
   su límite razonable, p. ej. entre 8 y 24). No hay pantalla nueva: se ajusta desde super-admin si un
   cliente lo pide. Dilo en el done.
3. **Un solo sitio decide** (`esSalidaOlvidada(entry, now, maxHoras)` en `fichaje/time.ts` o vecino) y
   lo usan las tres rutas de arriba: cerrar, la pantalla del empleado y el panel de admin. Nada de
   comparar `localDate` para esto en ningún otro sitio.
4. **El tramo pertenece al día en que empezó** en el registro de jornada, el panel y la exportación:
   22:00 del 23 → 08:00 del 24 es una jornada del 23 de 10 h. Comprueba que el total del día y del mes
   lo sumen así (hoy `toEntryView` ya usa `localDate(row.startedAt)`; verifica la exportación y el
   resumen de admin), y que el panel de «hoy» siga enseñando como abierto, a las 02:00, el turno que
   empezó a las 22:00 de ayer (hoy lo esconde porque no es «de hoy»).
5. **El cierre del tramo de más de 16 h sigue igual** que ahora: por corrección con motivo. Eso no cambia.

## Los tests

- Los e2e `f3-fichar` y `f8-colegio` no deben depender de la hora a la que corren: si construyen
  fechas «de hoy» o «de ayer», que sea con la fecha de Madrid (`localDate`), nunca con la UTC.
  Comprueba que pasan con el reloj fijado a las 00:30 y a las 01:59 de Madrid (UTC 22:30 y 23:59 del
  día anterior), además de a mediodía.
- Tests nuevos de tabla para `esSalidaOlvidada`: entrada 22:00 / salida 08:00 del día siguiente → se
  cierra; entrada 20:00 / salida 01:00 → se cierra; entrada ayer 09:00 / ahora 10:00 → olvidada;
  justo en el límite (16 h exactas y 16 h y un minuto); un máximo distinto en otro tenant.
- El panel de admin a las 02:00 con un turno de noche abierto: aparece como abierto, no como olvidado.
- El registro de jornada del mes con un turno de noche: suma en el día de entrada.

## Respeta

- Nada cambia para quien ficha en el día: mismas pantallas, mismos toques.
- Las correcciones con motivo y su auditoría, tal cual.

## Cómo se cierra

- CI verde (`ci`, `smoke`, `e2e`) **y** la suite de fichaje corrida a mano con el reloj en la franja
  00:00-02:00 de Madrid; di cómo lo has fijado.
- `docs/blocks/hotfix-fichaje-medianoche-done.md` corto: qué se cambió, dónde decide ahora el
  «olvidado», qué hay que hacer al desplegar (la migración del máximo, si la hay).
- Commits pequeños en español, push y **PR contra `master`**. Ni merges ni despliegues.
