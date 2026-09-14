# Carrera de dos altas · 500 en vez de 409 — PLAN (frente 0)

Rama `fix-carrera-alta-409`, worktree `mipiacetpv-carrera-409`, desde master `62089d4`.
Base e2e propia: `mipiacetpv_c409_e2e` (la suite hace `DROP SCHEMA`; la compartida
`mipiacetpv_e2e` la están usando otras sesiones).

Este documento se escribe **antes de tocar una línea de `src/`**. Su único trabajo es
decir qué error es de verdad, de qué sentencia sale y cuánto costó verlo — para que el
`-done.md` pueda contrastarse contra un hecho y no contra una hipótesis.

---

## 0 · La hipótesis que había, y qué le pasa

`docs/blocks/reservas-7a-done.md` §11 («Lo que el frente R destapó y NO he arreglado») y
§4 caso 12 dejaron escrito esto: el caso 3 de `agenda-suelo.e2e.ts` devolvió **500 en vez
de 409** una vez, a las 16:30, sobre la versión vieja del fichero; la sospecha era un
deadlock `40P01` o un `40001` que `isExclusionViolation` no reconoce. No se reprodujo en
diez pasadas y quedó apuntado.

**La hipótesis era correcta en el código de error y corta en el diagnóstico.** Es un
`40P01`, no un `40001`; y lo que hace que nadie lo vea no es sólo que
`isExclusionViolation` no lo reconozca, sino que **el SQLSTATE no aparece en ningún
sitio**: el error sale del manejador genérico etiquetado como `P2010`, que es el código
de Prisma para «raw query failed» y no dice nada de qué falló.

---

## 1 · Reproducción · qué hizo falta

### 1.1 El fichero en bucle: 20 pasadas, 0 rojas

```
apps/api $ C409_DEBUG=1 E2E_DATABASE_URL=…/mipiacetpv_c409_e2e \
    npx vitest run --config vitest.e2e.config.ts test-e2e/agenda-suelo.e2e.ts
```

×20 → **20 verdes, 0 rojas** (~11 s por pasada, cada una con su `DROP SCHEMA` +
`migrate deploy`). Es decir: **el bucle del fichero tal cual NO reprodujo el fallo**, ni
en 20 pasadas ni en las 10 de B-7a. Con una sola ronda de dos altas por pasada, la
ventana es demasiado estrecha para caer a mano.

Que no caiga en 20 pasadas no lo desmiente: el CI de master está en rojo por esto y hay
un deadlock del **12-09** en el log de Postgres, que es justo la fecha del frente R
(§1.3). Lo que dice es que hace falta una sonda, no más paciencia.

### 1.2 La sonda: la misma carrera, repetida

`apps/api/test-e2e/zz-c409-probe.e2e.ts` (temporal, **se borra al cerrar el frente 0**):
las **mismas dos altas simultáneas** del caso 3 —`POST /agenda/appointments`, mismo
hueco, misma profesional, `Promise.all`— repetidas ronda tras ronda sobre un hueco
distinto cada vez. No cambia la forma de la carrera; sólo la repite.

**N=2, 120 rondas** (49 s de test):

| código | veces |
|---|---|
| `201` | 120 — una entra siempre, en las 120 rondas |
| `409` | 76 |
| **`500`** | **44** |

240 respuestas, 120 rondas. **44 de las 120 perdedoras salieron por 500 en vez de 409:
un 37 %.** Las 44 son el mismo error, sin ninguna otra causa mezclada.

Una pasada previa a **N=8** dio otra cosa —`P2028` (timeout de 5 s de la transacción
interactiva de Prisma) y `P2010`— que es **apilamiento del pool**, no la carrera: ocho
transacciones bloqueadas se comen el pool y unas esperan a otras hasta el timeout. Es un
artefacto de la sonda a esa concurrencia y **no** lo que hay que arreglar aquí; queda
apuntado como lo que pasaría con ocho altas simultáneas de verdad.

### 1.3 El error, exacto

Instrumentado el `catch` de `store.ts` (`C409_DEBUG`, temporal), las 44 son idénticas:

```
name=PrismaClientKnownRequestError
code=P2010
meta={"code":"40P01","message":"ERROR: deadlock detected\nDETAIL: Process 1497 waits for
ShareLock on transaction 56735; blocked by process 1494.\nProcess 1494 waits for
ShareLock on transaction 56734; blocked by process 1497."}
message=Invalid `prisma.$executeRawUnsafe()` invocation:
        Raw query failed. Code: `40P01`. Message: `ERROR: deadlock detected …`
```

- **SQLSTATE `40P01`** = `deadlock_detected`. **No hay ni un `40001`** en las 120 rondas.
- Prisma lo envuelve como **`P2010`** («raw query failed») y deja el SQLSTATE **sólo en
  `meta.code`** y en el texto (`` Code: `40P01` ``).
- **`meta.code` es exactamente donde `isExclusionViolation` ya mira** — sólo que compara
  contra `"23P01"`. Por eso el `23P01` sí se traduce y el `40P01` no: no es que la cadena
  no llegue, es que la tabla de traducción tiene una entrada de menos.

### 1.4 De qué sentencia sale

Del log del servidor de Postgres, las dos puntas del deadlock:

```
2026-09-14 15:39:56 UTC [1369] ERROR:  deadlock detected
DETAIL:  Process 1369 waits for ShareLock on transaction 56230; blocked by process 1362.
         Process 1362 waits for ShareLock on transaction 56232; blocked by process 1369.
  Process 1369: INSERT INTO appointment_assignments (…, slot, active) VALUES (…)
  Process 1362: INSERT INTO appointment_assignments (…, slot, active) VALUES (…)
```

Las dos puntas son **el mismo `INSERT INTO appointment_assignments`** de
`store.ts::insertHold` — el que dispara el `EXCLUDE USING gist` (`no_staff_overlap`).
Ninguna otra sentencia aparece. El mismo log tiene un deadlock idéntico del **2026-09-12
08:23**, que es la pasada del frente R de B-7a: el 500 que se vio aquel día era éste.

### 1.5 Por qué dos INSERT pueden esperarse el uno al otro

El `EXCLUDE USING gist` no se comprueba antes de escribir, sino después: el INSERT mete
primero su entrada en el índice y **luego** escanea el índice buscando conflictos. Si
encuentra un conflicto de una transacción viva, espera a que termine
(`XactLockTableWait`) para saber si su fila cuenta o no.

Si las dos transacciones meten su entrada en el índice **antes** de que ninguna llegue a
escanear, cada una encuentra la de la otra y cada una se pone a esperar a la otra. Eso es
un ciclo, y Postgres lo desatasca matando a una: `40P01`. Cuando una llega a escanear
antes de que la otra escriba, sale el camino de siempre: la segunda espera, la primera
comete, la segunda recibe `23P01` → `ExclusionError` → `TAKEN` → 409.

**Las dos salidas son la misma carrera.** Cuál toca depende de un entrelazado de
microsegundos, y por eso el fallo es intermitente.

---

## 2 · Por qué acaba en 500

```
INSERT … appointment_assignments        → 40P01
  store.ts::insertHold  catch           → isExclusionViolation(err) === false  (mira 23P01)
    → rethrow
  engine.ts::hold       catch           → no es ExclusionError → rethrow
    routes.ts                           → no lo toca
      lib/error-handler.ts §4.b         → PrismaClientKnownRequestError
                                        → 500 {"error":"DB_ERROR","prismaCode":"P2010"}
```

Dos agujeros, no uno:

1. **`isExclusionViolation` no conoce el `40P01`.** Y aquí no basta con añadirlo a la
   lista: un deadlock **no** es un hueco ocupado (§3).
2. **El SQLSTATE se pierde por el camino.** El manejador genérico registra y devuelve
   `prismaCode: "P2010"`, que es «una raw query falló» y vale para cualquier cosa. Por eso
   B-7a pudo escribir «sale por el manejador genérico» sin poder decir cuál era el error.
   Es lo que hay que arreglar para que esto no se repita con el siguiente.

---

## 3 · Qué se va a hacer (y qué NO)

**Un `40P01` no significa «el hueco es de otra».** Significa que Postgres ha tumbado a una
de las dos transacciones para desatascarlas — y la tumbada **puede no haber perdido el
hueco**: si la que sobrevivió falla después por otra razón, o si ni siquiera competían por
la misma fila, ese hueco sigue libre. Mapearlo directo a `TAKEN` le diría «ya no está» a
una clienta que sí podía entrar. Por eso:

1. **Reconocer el `40P01`** (y el `40001`, que no ha salido aquí pero es la misma familia
   —`serialization_failure`— y llegaría por el mismo sitio) **como distinto del `23P01`**.
2. **Reintentar la transacción ENTERA una vez.** La entera, no la sentencia: un deadlock
   aborta toda la transacción, así que reejecutar el INSERT suelto es imposible. El sitio
   es `store.ts`, que es donde está el `prisma.$transaction`, y el rollback lo deja todo
   limpio (`insertHold` no escribió nada; `reschedule` recupera sus assignments).
3. **Si el reintento entra, es un 201 legítimo** y hay UNA cita, no dos: el intento
   abortado no dejó fila.
4. **Si el reintento choca contra el `EXCLUDE` (`23P01`), entonces sí es `TAKEN`** → 409
   con alternativas, que es lo honesto: alguien se lo quedó de verdad.
5. **Si el reintento vuelve a deadlockear**, se acabó el tope: sale `TAKEN` → 409 con
   alternativas. No hay bucle, no hay espera larga (jitter de decenas de ms como mucho:
   esto pasa delante de una clienta). Un 409 con tres horas que sí se pueden dar es peor
   que un 201 y muchísimo mejor que un 500 sin salida.
6. **Lo mismo en `reschedule`**: mismo `$transaction`, mismo `EXCLUDE` debajo, misma
   carrera. Mover una cita cae igual y tiene que caer con el mismo 409.
7. **El manejador genérico registra el SQLSTATE.** Las dos ramas (la de Prisma y la del
   500 pelado), para que el próximo error raro que salga por ahí venga con su código.

**Fuera, como dice el prompt:** los `EXCLUDE` siguen viviendo sólo en la base de datos
(ADR-K8) y no se toca ni uno; cero migraciones; ni cola ni serialización de altas; ni
motor de huecos, ni suelo de 6a, ni horario de 7a, ni panel de B-9, ni cobro, ni triggers
de S1.

---

## 4 · Lo que se borra al cerrar el frente 0

- `apps/api/test-e2e/zz-c409-probe.e2e.ts` — la sonda.
- El `console.error` bajo `C409_DEBUG` en los dos `catch` de `store.ts` — su trabajo lo
  hereda, bien hecho y permanente, el punto 7 de §3.
