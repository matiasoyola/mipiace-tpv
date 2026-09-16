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

### 1.1 El fichero en bucle: 60 pasadas, y el 500 no sale

```
apps/api $ C409_DEBUG=1 E2E_DATABASE_URL=…/mipiacetpv_c409_e2e \
    npx vitest run --config vitest.e2e.config.ts test-e2e/agenda-suelo.e2e.ts
```

**60 pasadas** (una tanda de 20 y otra de 40), ~11 s cada una con su `DROP SCHEMA` +
`migrate deploy`. **Ni una reprodujo el 500.** Es decir: **el bucle del fichero tal cual
NO sirve para verlo**, ni en 60 pasadas ni en las 10 de B-7a. Con una sola ronda de dos
altas por pasada, la ventana es demasiado estrecha para caer a mano.

Una de las 60 (la 25) salió roja **por otra cosa**, y se dice para no apuntarse un mérito
que no es: `Hook timed out in 120000ms`, con el `beforeAll` colgado 698 s. No es el
500-en-vez-de-409 (los 16 casos quedaron `skipped`, ni siquiera llegaron a correr) y no
dejó rastro: al mirarlo, `pg_stat_activity` estaba limpio y el contenedor al 1 % de CPU.
Un hipo de la máquina durante un bucle desatendido. No se ha vuelto a ver en las 20
pasadas del cierre.

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

---

# ADDENDUM · el testigo del caso 1 pone el CI en rojo (16-09-2026)

Mergeado a master (`5994fde`), el CI siguió en rojo. Otro motivo, y el motivo era **mío**:
`agenda-suelo.e2e.ts` pasaba 16/16 y las 40 rondas del caso 1 de `agenda-carrera.e2e.ts`
salían **todas 201/409, sin un solo 500**. Lo que caía era el testigo:

```
40 rondas sin un solo deadlock: esta pasada NO ha ejercido el 40P01:
expected 0 to be greater than 0
```

Run 34944219974, job `e2e`. **Las 40 rondas tardaron 1,4 s.** Guárdese ese número: es el
que cierra el caso.

El done de este mismo frente ya lo avisaba en §2.11 («un test que exige que ocurra una
carrera…») y lo dejó pasar igual. Aquí se mide de verdad.

---

## A · Las dos latencias, medidas por separado

La hipótesis del prompt era el retardo del volcado de estadísticas. Hay **dos** relojes de
por medio y hay que separarlos, porque uno tapa al otro:

- **(A) DETECCIÓN** — Postgres no busca ciclos de espera hasta que una espera supera
  `deadlock_timeout`. Por defecto **1 s**, y ni el `docker-compose.yml` ni el
  `ci.yml` lo cambian (los dos usan `postgres:16-alpine` a pelo). **Un deadlock cuesta
  como mínimo 1 s de reloj de pared.**
- **(B) VOLCADO** — el `deadlocks` de `pg_stat_database` lo acumula el backend víctima en
  sus estadísticas PENDIENTES y se vuelca con retraso.

### A.1 · Con `deadlock_timeout` por defecto (1 s), el contador se ve enseguida

Tres rondas, deadlock confirmado por el error en las tres:

```
RONDA 1 · contador antes: 0 → +1171ms: 1  ← ya lo ve  (y sigue en 1 a +2,6s / +12s / +32s)
RONDA 2 · contador antes: 1 → +1133ms: 2  ← ya lo ve
RONDA 3 · contador antes: 2 → +1133ms: 3  ← ya lo ve
```

Pero ese «+1171 ms» **no mide el volcado**: es el segundo de `deadlock_timeout` que hay
que esperar antes de que el deadlock exista siquiera. Cuando el error vuelve, ya ha pasado
más de 1 s desde el último volcado del backend, así que vuelca. **El retardo estaba ahí
todo el rato, tapado por la detección.**

### A.2 · Con `deadlock_timeout` a 50 ms, el retardo se ve: **11 s ciego**

Misma medición, quitándole a (A) su segundo:

```
deadlock_timeout de la sesión = 50ms

RONDA 1 · deadlock confirmado. La ronda duró 159ms.
    +     2ms desde el error → 3  ciego
    +   256ms                → 3  ciego
    +   509ms                → 3  ciego
    +  1012ms                → 3  ciego
    +  2015ms                → 3  ciego
    +  5018ms                → 3  ciego
    + 11021ms                → 4  ← LO VE
  → tardó ~11021ms en verse

RONDA 2 · +2ms → LO VE   (el backend ya había volcado por la ronda anterior)

RONDA 3 · ciego hasta +11023ms
```

**Hipótesis del prompt: CONFIRMADA como mecanismo.** El contador puede quedarse ciego
**11 s**, y no es «como pronto a 1 s»: en dos de tres rondas no se enteró hasta los 11.

## B · …y DESCARTADA como causa del CI

La aritmética no deja sitio:

- un deadlock cuesta **≥ 1 s** (`deadlock_timeout`, sin tocar en el CI);
- el CI hizo **40 rondas en 1,4 s** → **35 ms por ronda**;
- **no cabe ni un solo deadlock.** Si hubiera habido uno, esa ronda sola se habría llevado
  el segundo entero.

Y hay un contraste que lo confirma desde el otro lado: la sonda del frente 0 hizo
**120 rondas en 49 s con 44 deadlocks**. 44 × 1 s = 44 s, más 76 rondas rápidas a ~50 ms
≈ 4 s. Total ≈ 48 s, que es lo que tardó. **Las rondas con deadlock cuestan un segundo;
las que no, cincuenta milisegundos.**

Conclusión: **en el CI no hubo deadlocks**, no es que los hubiera y el testigo llegara
tarde. Allí las dos altas se ordenan —una escanea el índice antes de que la otra escriba—
y sale el `23P01` de siempre, que es un final perfectamente correcto de la carrera. El
testigo exigía un entrelazado que aquella máquina no produce.

## C · Qué se cambia

1. **El testigo lo cuenta el código.** `store.ts` lleva `raceStats`
   (`aborts`/`retries`/`exhausted`), que sube en el instante en que `withRaceRetry`
   reconoce el SQLSTATE. No depende de cuándo publique Postgres sus estadísticas. Tres
   enteros monótonos: cero cambio de comportamiento.
2. **Sin deadlock, el caso 1 se SALTA.** Ni rojo (no ha fallado nada) ni verde (no habría
   probado lo que dice). Con el motivo impreso, y contando en los SALTADOS, que es donde
   hay que mirarlo.
3. **Las garantías duras se comprueban siempre**, ronda a ronda y antes de cualquier
   salto: ni un 500, y una sola cita por hueco.
4. **La traducción del 40P01 no depende del azar**: la cubren los casos 2 a 5 con el error
   inyectado, haya carrera o no. Comprobado rompiendo el reconocimiento del `40P01` con el
   caso 1 saltado: los cuatro inyectados se ponen rojos igual.
