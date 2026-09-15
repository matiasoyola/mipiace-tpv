# Carrera de dos altas · 500 en vez de 409 — DONE

Rama `fix-carrera-alta-409`, worktree `mipiacetpv-carrera-409`, desde master `62089d4`.
Frente 0 en `docs/blocks/carrera-alta-409-plan.md`, escrito antes de tocar `src/`.

**Esto no era deuda de producto, era deuda de canal**: el CI de master estaba en rojo por
un fallo intermitente de la agenda y eso bloqueaba dos merges terminados
(`a5-acceso-remoto` y `catalogo-local`). No se ha arreglado una función nueva: se ha
arreglado **una traducción que faltaba**.

---

## 1 · Qué error era de verdad

Un **deadlock `40P01`** (`deadlock_detected`) de Postgres. No un `40001`.

B-7a lo dejó escrito como hipótesis («un deadlock `40P01` o un `40001`»,
`reservas-7a-done.md` §11). El código de error era correcto; el diagnóstico se quedaba
corto en dos sitios:

- **no es un `40001`**: en 120 rondas de la carrera no salió ni uno. Los 44 fallos fueron
  todos `40P01`;
- **y el agujero no era sólo que `isExclusionViolation` no lo reconociera**: era que **el
  SQLSTATE no aparecía en ningún sitio**. Prisma envuelve las raw queries en `P2010`
  («raw query failed») y deja el código de Postgres sólo en `meta.code`. Por eso el done
  de B-7a pudo escribir «sale por el manejador genérico» y **no pudo decir cuál era el
  error**: la respuesta y el log decían `P2010`, que vale igual para un deadlock, una
  clave ajena o una columna que no existe.

### De qué sentencia sale

Las dos puntas del ciclo son **el mismo `INSERT INTO appointment_assignments`** de
`store.ts::insertHold` — el que dispara el `EXCLUDE USING gist` `no_staff_overlap`. Del
log del servidor de Postgres, textual:

```
ERROR:  deadlock detected
DETAIL: Process 1369 waits for ShareLock on transaction 56230; blocked by process 1362.
        Process 1362 waits for ShareLock on transaction 56232; blocked by process 1369.
  Process 1369: INSERT INTO appointment_assignments (…, slot, active) VALUES (…)
  Process 1362: INSERT INTO appointment_assignments (…, slot, active) VALUES (…)
```

El mismo log guarda un deadlock idéntico del **12-09-2026 08:23**, que es la pasada del
frente R de B-7a: **el 500 que vio aquel día era éste**.

### Por qué pasa

El `EXCLUDE USING gist` no se comprueba antes de escribir: el INSERT mete primero su
entrada en el índice y **luego** lo escanea buscando conflictos; si encuentra uno de una
transacción viva, la espera para saber si esa fila acaba contando.

Con dos altas simultáneas sobre el mismo hueco hay dos entrelazados, y son **la misma
carrera con dos finales**:

| entrelazado | qué pasa | código | qué salía antes |
|---|---|---|---|
| una escanea antes de que la otra escriba | espera, la primera comete, a la segunda la echa el `EXCLUDE` | **23P01** | 409 TAKEN ✔ |
| las dos escriben antes de que ninguna escanee | cada una espera a la otra; Postgres tumba a una para romper el ciclo | **40P01** | **500 DB_ERROR** ✘ |

Cuál toca depende de un entrelazado de microsegundos. Por eso es intermitente, y por eso
diez pasadas no bastaban para verlo.

### Cuántas pasadas hicieron falta

- **El fichero en bucle NO sirve**: 60 pasadas de `agenda-suelo.e2e.ts` (20 + 40) y **el
  500 no salió ni una vez**. Con una sola ronda de dos altas por pasada la ventana es
  demasiado estrecha. (Una de las 60 salió roja por otra cosa: un `beforeAll` colgado
  698 s, con los 16 casos en `skipped`. No es este fallo y no dejó rastro; está contado en
  el plan §1.1 para no apuntárselo.)
- **La sonda sí**: las **mismas dos altas** del caso 3 (`N=2`, mismo hueco, misma
  profesional, `Promise.all`) repetidas sobre un hueco distinto cada ronda. **120 rondas →
  44 respuestas 500, un 37 % de las perdedoras.** Todas `40P01`, sin ninguna otra causa
  mezclada.

La sonda era temporal y **está borrada**. Su trabajo lo hereda, permanente, el caso 1 de
`test-e2e/agenda-carrera.e2e.ts`.

---

## 2 · Decisiones tomadas sin preguntar, una a una

### 2.1 El deadlock se REINTENTA; no se mapea a TAKEN a ciegas

Un `40P01` **no** significa «ese hueco es de otra». Significa que Postgres eligió una
víctima para romper un ciclo de esperas, y **la víctima puede entrar perfectamente**.
Traducirlo directo a `TAKEN` le diría «ese hueco ya no está» a una clienta que sí cabía, y
el hueco se quedaría vacío. Lo honesto es volver a intentarlo y **dejar que sea el
`EXCLUDE` quien diga que no**, que es quien manda (ADR-K8).

Por eso el sabotaje «mapear el deadlock directo a TAKEN sin reintentar» tiene su test
rojo (§3, fila 4): sin él, este atajo pasaría desapercibido para siempre.

### 2.2 La unidad que se reintenta es la TRANSACCIÓN ENTERA

No la sentencia. Un deadlock **aborta toda la transacción** y Postgres ya ha deshecho lo
escrito: reejecutar el INSERT suelto ni siquiera es posible, no hay transacción donde
meterlo. El sitio es `store.ts`, que es donde vive el `prisma.$transaction`.

Y es seguro porque el rollback deja el mundo como estaba: `insertHold` no escribió ninguna
fila (los `apptId`/`itemIds` se generan fuera y se reusan, así que no hay dos citas ni por
un microsegundo) y `reschedule` recupera los assignments que su `deleteMany` había
borrado.

### 2.3 UN reintento, con tope, y una espera corta y desigual

`REINTENTOS_DE_CARRERA = 1`. No es una política de resiliencia: es **desempatar una
carrera de dos**. Si con dos intentos no entra, seguir insistiendo delante de alguien que
está de pie en el mostrador no es robustez, es dejarle mirando la pantalla.

La espera entre intentos es aleatoria con tope de **25 ms**. Aleatoria porque si los dos
perdedores reintentasen a la vez volverían a chocar igual; de 25 ms porque esto no es un
batch nocturno.

### 2.4 Si el reintento vuelve a deadlockear, sale TAKEN — no 500

Es un falso negativo asumido **a propósito**. Como mucho se le ofrecen a la clienta tres
horas más (entre ellas, casi seguro, la que había pedido); un 500 la deja sin salida y sin
frase que leer en voz alta. **«Nunca un 500» manda sobre «nunca un TAKEN de más».** Dos
deadlocks seguidos sobre la misma petición no se han visto ni una vez.

### 2.5 El `40001` entra en la misma familia aunque no se haya visto

`serialization_failure` es el primo del deadlock y llegaría exactamente por el mismo
sitio si algún día algo de esto corriera en `REPEATABLE READ`. Añadirlo cuesta una
comparación y ahorra repetir este frente entero. **No se ha observado ni una vez** en las
120 rondas — queda dicho para que nadie lo lea como «también pasaba».

### 2.6 El `23P01` NO se reintenta

Ese hueco es de otra de verdad: la transacción rival ya cometió. Insistir no lo devuelve,
sólo retrasa el 409 y las alternativas. Tiene su test (§3, implícito en el conteo de
intentos).

### 2.7 Un error que no es de la carrera sube TAL CUAL

Nada de tragarse errores raros disfrazados de «hueco ocupado». Si una clave ajena rota
saliera como `TAKEN`, el mostrador perseguiría un fantasma y el fallo de verdad no lo
vería nadie. Tiene test.

### 2.8 El SQLSTATE deja de perderse — y eso es la mitad del frente

`apps/api/src/lib/sqlstate.ts`, nuevo y de doce líneas útiles: saca el código de Postgres
de donde esté (`meta.code` primero, que es donde Prisma lo esconde en las raw queries;
luego `code` a pelo, como lo pone el driver `pg`; luego el texto). El manejador global lo
registra en el log, en Sentry y en la respuesta, en **las dos ramas** (la de Prisma y la
del 500 pelado).

Lo delicado: **los códigos de Prisma tienen la misma forma que un SQLSTATE** (`P2010`,
`P2028`, cinco caracteres alfanuméricos). Inventarse un SQLSTATE a partir de uno sería
peor que no ponerlo, así que se descartan explícitamente en la rama de `code` — y tiene su
test.

Esto no arregla el 409, arregla **la próxima vez**. Que un done pueda escribir «sale por
el manejador genérico» sin poder decir qué error era costó una sonda entera. No otra vez.

### 2.9 `reschedule` recibe el mismo trato que el alta, no uno parecido

Misma `$transaction`, mismo `EXCLUDE` debajo, misma carrera. Comparten el helper
(`withRaceRetry`), así que no pueden divergir por olvido: lo que se arregle en uno queda
arreglado en el otro.

### 2.10 Cero migraciones y ni un `EXCLUDE` tocado

Este frente es código. Los `EXCLUDE` siguen viviendo sólo en la base de datos (ADR-K8), y
el anti-solape sigue sin hacerse «en el código». Tampoco se ha metido una cola ni se han
serializado las altas: la carrera sigue existiendo, lo que cambia es **cómo se cuenta**.

### 2.11 El e2e de la carrera es fichero propio, y con testigo

`agenda-carrera.e2e.ts` en vez de engordar `agenda-suelo.e2e.ts`, que es del suelo. Y su
caso 1 **lee `pg_stat_database.deadlocks`** antes y después: si la pasada no llega a
provocar ni un deadlock, **el caso se pone rojo a propósito**. Un test que pasa sin
ejercer lo que dice cubrir miente más que uno que falta — es la misma regla que
`e2e-env.ts` aplica a saltarse la suite en CI.

---

## 3 · Sabotaje → test rojo

Cada fila se rompió de verdad, se corrieron los tests y se restauró.

| # | Qué rompo a propósito | Qué se pone rojo | Con qué mensaje |
|---|---|---|---|
| 1 | **Quitar el reconocimiento del `40P01`** (`isRaceAbort` sólo mira `40001`) | **unit 5 rojos** (`agenda-carrera.test.ts`) · **e2e 5/5 rojos** | El caso 1 reproduce **el bug original literal**: `ronda 8: … expected [201, 500] to deeply equal [201, 409]`, con `{"error":"DB_ERROR","prismaCode":"P2010","sqlState":"40P01"}` en el cuerpo |
| 2 | **Quitar el reintento** (`REINTENTOS_DE_CARRERA = 0`) | unit 6 rojos · **e2e 2, 3, 4 y 5 rojos** (el 1 **sigue verde**) | `expected 409 to be 201`: el alta que SÍ cabía se rechaza. Que el caso 1 aguante es correcto y es el punto: sin reintento ya no hay 500, pero se pierden altas buenas |
| 3 | **Reintentar en bucle** (sin tope) | unit 2 rojos · **e2e 3 y 5 rojos** | `expected 201 to be 409` y `expected 200 to be 409`: con 99 deadlocks inyectados acaba entrando, o sea que reintentó 99 veces delante de la clienta |
| 4 | **Mapear el deadlock directo a `TAKEN` sin reintentar** | unit 6 rojos · **e2e 2, 3, 4 y 5 rojos** | `expected 409 to be 201` y `expected 1 to be 2` (un solo intento): el hueco estaba libre y se dijo que no |
| 5 | **Dejar `reschedule` sin tratar** (vuelve al `try/catch` de antes) | unit 2 rojos · **e2e 4 y 5 rojos** | `{"error":"INTERNAL_ERROR"…}: expected 500 to be 200` — mover vuelve a reventar con un 500 |
| 6 | **Que el manejador deje de registrar el SQLSTATE** | `error-handler.test.ts` rojo | `expected undefined to be '40P01'` |

Las filas 1 a 5 son los mínimos que pedía el prompt. La 6 es del frente 4 (que el 500 no
vuelva por la puerta de atrás) y se añade por lo mismo.

---

## 4 · Lo que la suite NO cubre

Cruzado con la rutina de los clientes vivos, que es lo que decide si importa.

1. **Tres o más altas simultáneas sobre el mismo hueco.** Todo lo que hay aquí está
   probado a dos. En la sonda a **N=8** salía otra cosa —`P2028`, timeout de 5 s de la
   transacción interactiva de Prisma, y `P2010` por el pool— que es **apilamiento de
   conexiones**, no la carrera: ocho transacciones bloqueadas se comen el pool y unas
   esperan a otras hasta el timeout. *La rutina de Sole no lo pisa (una recepción). **Un
   bar con dos camareros sí pisa el caso de dos** —que es justo lo que se arregla aquí— y
   uno con ocho terminales dando de alta la misma hora pisaría esto.* No se arregla aquí
   porque el arreglo es de tamaño de pool y de forma de la transacción, no de traducción.
2. **Dos deadlocks seguidos sobre la misma petición.** Sale `TAKEN` por tope (§2.4) y eso
   es una decisión, no un descuido — pero **no hay test de que ocurra de verdad**, sólo
   del comportamiento con el error inyectado. No se ha visto ni una vez en 120 rondas.
3. **La carrera entre un alta y un MOVER** (uno crea en el hueco mientras otro mueve una
   cita a ese mismo hueco). Los dos caminos están tratados por separado y comparten
   helper, pero **cruzados no se prueban**. *Un bar con dos camareros lo pisa: uno da de
   alta a las 13:00 mientras el otro arrastra una cita a las 13:00.* El `EXCLUDE` sigue
   garantizando que no entren las dos; lo que no está probado es que el perdedor salga 409
   y no 500 en ese cruce concreto.
4. **La carrera contra `setStatus`** (cancelar libera el hueco poniendo `active=false`
   mientras otro lo reserva). `setStatus` no va en transacción y no tiene `EXCLUDE`
   encima; queda fuera del frente. *Su rutina lo pisa poco: cancelar y reservar la misma
   hora en el mismo segundo.*
5. **El `40001`** (`serialization_failure`) sólo está probado con el error **inyectado**.
   No se ha provocado de verdad porque nada de esto corre en `REPEATABLE READ` (§2.5).
6. **Nada de esto se ha visto en hierro.** Ni AP11 ni AP12: el prompt lo pone fuera y no
   se ha cruzado. Lo que hay es Postgres real en la máquina de desarrollo.
7. **El front no se ha tocado ni mirado.** El `TAKEN` que ahora llega en vez de un 500 es
   un código que el TPV ya sabía leer (`AgendaPage.tsx` lo trata desde B-5), así que no
   había nada que cambiar — pero **no se ha vuelto a fotografiar** la pantalla.
8. **El `sqlState` nuevo viaja al cliente** en el cuerpo del 500, igual que ya hacía
   `prismaCode`. Es una decisión heredada de v1.5-consistencia-A (diagnosticar sin abrir
   el VPS) y **nadie ha revisado si el front lo enseña en algún sitio**. No debería: el
   mensaje para el usuario no cambia.

---

## 5 · Criterio de hecho · los números

| Qué | Resultado |
|---|---|
| **Caso 3 de `agenda-suelo.e2e.ts`** | **20 pasadas seguidas, 20 verdes, 0 rojas** (corrido junto con `agenda-carrera.e2e.ts`: 21 casos por pasada, `Tests 21 passed` en las 20) |
| Deadlock provocado de verdad | `agenda-carrera.e2e.ts` caso 1, con `pg_stat_database.deadlocks` de testigo. Verde en las 20 pasadas ⇒ **hubo un deadlock real en cada una** |
| Deadlock inyectado → 409 y no 500 | casos 3 y 5 del e2e (alta y mover), con alternativas |
| Reintento que SÍ entra → 201 y UNA cita | caso 2 del e2e (201 + `citasEn(hueco) === 1`) y caso 4 (mover → 200) |
| **Suite entera** | **200 ficheros · 1924 verdes · 3 saltados · 0 rojos** |
| Typecheck | `tsc --noEmit` de `apps/api` limpio |

### Los 3 SALTADOS, mirados

No son de este frente y no tapan nada suyo: es `describe.skip("super-admin · crear tenant
(legacy flow B-SuperAdmin)")` en `apps/api/test/super-admin.test.ts:566`, saltado desde
B-OnboardingV2 porque `POST /super-admin/tenants` se refactorizó (apiKey-only DRAFT +
activate aparte) y su cobertura se trasladó a `onboarding-v2.test.ts`. Preexistente,
misma cifra que antes de tocar nada.

---

## 6 · Ficheros

| Fichero | Qué |
|---|---|
| `apps/api/src/lib/sqlstate.ts` | **nuevo** · el SQLSTATE venga como venga envuelto |
| `apps/api/src/agenda/store.ts` | `isRaceAbort`, `withRaceRetry`, y los dos `$transaction` (`insertHold`, `reschedule`) envueltos |
| `apps/api/src/lib/error-handler.ts` | el SQLSTATE en el log, en Sentry y en la respuesta, en las dos ramas de 500 |
| `apps/api/test/agenda-carrera.test.ts` | **nuevo** · 13 casos: la traducción, el reintento, el tope y `sqlStateOf` |
| `apps/api/test-e2e/agenda-carrera.e2e.ts` | **nuevo** · 5 casos contra Postgres real: deadlock provocado + inyectado, alta y mover |
| `apps/api/test/error-handler.test.ts` | 2 casos: el SQLSTATE llega, y no se inventa uno de un código de Prisma |
| `docs/blocks/carrera-alta-409-plan.md` | **nuevo** · el frente 0 |
| `docs/blocks/reservas-7a-done.md` | §11 y §4 caso 12 pasan a resueltos |

**Cero migraciones.** Base e2e propia (`mipiacetpv_c409_e2e`), borrada al terminar.

---

## 7 · Al desplegar

Nada especial: es código, sin migración y sin cambio de contrato. El 409 `TAKEN` que
ahora llega donde antes llegaba un 500 **ya lo sabía leer el TPV** desde B-5.

Lo único que cambia de forma en una respuesta es el campo **`sqlState`** dentro del cuerpo
de un 500 `DB_ERROR`, que antes no estaba. Es aditivo.

**Y lo que hay que mirar el día que se despliegue:** si en los logs aparece un
`error Prisma P2010 (SQLSTATE 40P01)` de la agenda, ya no es un fallo — es el camino
reintentándose y saliendo bien. Lo que sí sería un fallo es ver un 500 `DB_ERROR` en
`POST /agenda/appointments`: ahora vendrá con su SQLSTATE y se sabrá de qué.

---

## 8 · Commits

Dos, y la frontera entre ellos es la que importa:

| hash | commit |
|---|---|
| `2c91be4` | **fix(agenda): la carrera de dos altas acaba en 409, no en 500** — todo el código y todos los tests |
| HEAD | docs(carrera-409): done + plan + los avisos de 7a cerrados — sólo documentación |

**El último commit con código es `2c91be4`.** El que le sigue es este documento, el plan
del frente 0 y el cierre de `reservas-7a-done.md`: no toca `src/` ni `test/`. Su hash no
se escribe aquí porque un commit no puede contener el suyo propio — `git log -2` lo da.

**Ni push ni deploy: eso lo hace Matías.**
