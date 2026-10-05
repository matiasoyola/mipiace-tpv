# Bloque mover-con-otra · done

Rama `mover-con-otra`, worktree `~/Developer/Claude/Projects/mipiacetpv-mover-con-otra`, desde `master` =
`63149b3`. Frente B del tablero. Prompt: `docs/code-prompts/bloque-mover-con-otra.md`.

La recepción pasa la cita de Carmen de Ana a Isa en dos toques, **la cita sigue siendo la misma** —su id y su
histórico— y nunca le ofrecen una peluquera que no hace ese servicio.

---

## 1 · Lo primero que se hizo fue MEDIR el motor

El prompt pedía dos respuestas antes de tocar nada. Se midieron con el fake-store del motor
(`apps/api/test/helpers/agenda-fake-store.ts`), no con un razonamiento:

### ¿Qué devuelve hoy el motor si se fija una peluquera que no hace el servicio?

```
tinte de Sole, se fija a Ana (que no tiñe), misma hora  → { ok:false, reason:"NO_SLOT", message: undefined, alternatives: [] }
lo mismo a otra hora (15:00)                            → { ok:false, reason:"NO_SLOT", alternatives: [] }
```

**No lo distingue.** La mecánica, por si alguien la vuelve a buscar:

- `loadContext` (`engine.ts:222`) filtra los skilled por la fijada → `skilledByService` se queda **vacío** →
  `allStaff` vacío → `getTemplateSlots([])` devuelve `[]`.
- `planForStart` (`engine.ts:440`) itera un `skilled` vacío → `eligible.length < staffRequired` → `null`.
- `reschedule` (`engine.ts:820`) contesta `NO_SLOT` y pide alternativas a `computeSlots` con la **misma**
  fijada → `candidateStarts` sobre un `templateByUserDate` vacío → `alternatives: []`.
- `HoldFailureReason` (`engine.ts:74`) no tiene ningún miembro de skill, y la ruta traduce el `NO_SLOT` a
  `409` + `"No se pudo mover a ese hueco."` (el `?? ` del `message`: `reschedule` sólo redacta los rechazos
  del suelo).

O sea: «Ana no tiñe» y «Ana está llena todo el día» salían **idénticos** por la API. La única señal lateral
era el `alternatives: []`, que no es un criterio — una peluquera de baja da lo mismo.

Por eso el «no» de skill se decide **en la ruta, con la matriz, antes de llamar al motor**, como pedía el
prompt. `engine.ts` no se ha tocado: cero líneas.

### ¿Mover a la misma hora con otra peluquera ya entra?

```
corte de Ana a las 10:00, se fija a Isa a las 10:00 → { ok:true, mismoId:true, assignments:[STAFF → Isa] }
```

**Sí, el motor ya lo hacía.** agenda-lista §2b advertía que `reschedule` carga la ocupación del día **sin
excluir la propia cita**; para OTRA peluquera no estorba porque esa ocupación está indexada bajo la anterior
(`occByStaff`), así que `staffFree(Isa, 10:00)` la ve libre. Y `store.reschedule` (`store.ts:678`) hace el
`deleteMany` de las asignaciones viejas **antes** de insertar las nuevas, dentro de la misma transacción, así
que el GiST no choca consigo mismo.

Lo que faltaba era **la puerta de la ruta**: el cuerpo tenía `additionalProperties: false`, así que mandar
`staffUserId` era un `400` del schema, y la rama de `start` fijaba siempre `suProfesional`.

### Y una tercera cosa que la medición destapó (frontera conocida)

```
tinte con UN lavacabezas, Sole 10:00 → se fija a Ana 10:00 → { ok:false, reason:"NO_SLOT", alternatives: 10 }
```

**Con un recurso compartido, mover a la misma hora NO entra** — y aquí la ocupación sin excluir la propia
cita sí muerde, porque el recurso lo tiene ella misma. `resourceFree` lo ve ocupado, `planForStart` devuelve
`null`, y las diez alternativas nunca incluyen su hora actual.

Hoy es teórico: ni el seed del banco ni los e2e siembran `ServiceResourceNeed`, y la peluquería de Sole no
tiene recursos. **Se deja como está**: arreglarlo es cambiar la lógica del motor (excluir la propia cita de
la ocupación), que es exactamente lo que agenda-lista §2b dejó fuera y lo que este prompt prohíbe. Queda
dicho aquí para que no se descubra el día que un centro con cabinas lo pise. Ver §6.

---

## 2 · API · el PATCH acepta `staffUserId`

`PATCH /agenda/appointments/:id`, cuerpo `{ status?, start?, staffUserId? }`.

**La regla de oro: sin `staffUserId` no cambia NADA.** Ningún llamante existente manda el campo, así que
mover de hora sigue siendo byte a byte lo de agenda-lista — los casos 17 y 18 de `agenda-suelo.e2e.ts` lo
vigilan y siguen verdes.

Lo que se añadió, en orden de ejecución:

1. **`staffUserId` sin `start` → `400 STAFF_WITHOUT_START`**, antes de cualquier otra rama. Cambiar de
   peluquera **es** mover. Se dice en vez de ignorarlo en silencio, que es lo que haría un
   `additionalProperties` permisivo. Con `status` + `staffUserId` también es 400, y **la cita no cambia de
   estado por el camino** (caso 9 del e2e: se manda `status: "CANCELLED"` y la cita sigue `CONFIRMED`).
2. **La comprobación de la matriz**, en `apps/api/src/agenda/mover-staff.ts`, función pura
   `comprobarProfesional`. Tres lecturas en paralelo (perfiles del tenant, nombres de los servicios, skilled
   por servicio) y el cruce fuera de la ruta, para poder probarlo sin BD ni Fastify:
   - **no es personal de este centro → `404 STAFF_NOT_FOUND`**, `"Esa profesional no es de este centro."`
   - **tiene perfil pero apagado → `404 STAFF_NOT_FOUND`**, `"Isa ya no está activa en la agenda."` (de la
     inactiva sí se sabe el nombre; de la de otro centro, no — y nombrar a alguien que no existe es peor
     que no nombrarla).
   - **no sabe hacer alguno de los servicios → `409 STAFF_NO_SKILL`**, `"Ana no hace Tinte."` Si le faltan
     dos, los enumera en castellano (`"Ana no hace Corte de pelo y Tinte."`); si un servicio no tiene nombre
     en catálogo, dice `"ese servicio"` en vez de escupir un uuid.
   - **Todos los servicios, no alguno**: el motor encadena los items sobre la fijada, así que media cita no
     es media respuesta.
   - El orden importa: primero QUIÉN es, después qué sabe hacer. La inactiva tampoco sale en la matriz
     (`getSkilledStaff` filtra por perfil activo), así que las dos ramas podrían morder; manda la de quién
     es.
3. **Y si pasa, `reschedule(tenantId, id, start, elegida ?? suProfesional)`**. El motor obedece a quien le
   fijen, igual que en el alta slot-first.

Los dos «no» nuevos llevan `error`, `code` (mismo valor, como el resto de esta ruta: lo destapó un sabotaje
de agenda-lista, el front lee `code`), `message` y `alternatives: []` — vacío a propósito: no son un «no» de
hueco, y ofrecer horas aquí sería contestar a una pregunta que nadie ha hecho.

**La peluquera de otro centro ya era segura antes de este bloque**, y conviene no vendérselo como un
agujero tapado: `getSkilledStaff` filtra por `tenant_id`, así que nunca hubo asignación cruzada ni un 500.
Lo que era es **muda** — salía como «no hay hueco». Ahora lo dice.

**Lectura nueva en el store**: `getServiceNames(tenantId, serviceIds)` (`store.ts`), un `product.findMany`
por nombre. Es para la frase que lee la cajera; el motor no la necesita. El fake-store la implementa desde
un `serviceNames` opcional del seed.

**Sin migración.** Ninguna tabla cambia: la asignación de personal ya se reescribe entera al mover.

---

## 3 · TPV · «Con quién» en la hoja de mover

`MoverCita` (`AgendaPage.tsx`) gana un selector de peluquera **encima del día** — primero quién la atiende,
después cuándo, que es el orden en que se habla en el mostrador («¿te va bien con Isa?» → «¿a qué hora?»).

- **Arranca en la actual.** Con ella elegida todo se comporta exactamente como antes: `doMove` manda
  `staffUserId` **sólo** cuando la elegida es distinta de la actual.
- **Sólo se ofrecen las que saben hacer TODOS los servicios de la cita**, con el cruce puro
  `profesionalesQuePuedenConLaCita` (`lib/agenda-health.ts`), al lado de `serviciosQueSabeHacer` — es el
  mismo cruce por el otro lado de la matriz. Sin matriz (`null`: no llegó, o no hay red) **todas**, y el
  motor sigue siendo la puerta: el mismo criterio que agenda-lista §3.
- **La actual se ofrece siempre**, aunque la matriz diga que no sabe. La cita ya es suya; esconderla
  dejaría el selector sin la opción que está seleccionada y «no tocar nada» pasaría a ser imposible.
- **El selector no se esconde cuando sólo queda una candidata.** Se enseña con ella sola y con el motivo
  escrito debajo: `"Sólo aparecen las que hacen estos servicios."` Un control que desaparece no explica
  nada. El motivo va en **texto visible y nunca en un `title`** (`docs/ux-principles.md` §6), y sólo sale
  cuando de verdad se ha dejado a alguien fuera — un aviso que sale siempre deja de leerse.
- **«Buscar hueco» busca los huecos de la ELEGIDA**, y al cambiar de peluquera se limpian los chips y el
  error: eran de la anterior. Con los de la otra, el «no» llegaría sobre una hora que la pantalla acababa de
  ofrecer.
- **El botón dice a quién antes de pulsarlo**: `Mover a las 10:15 con Lucía` cuando cambia de columna,
  `Mover a las 10:15` cuando no.
- **Botones de dedo** (`h-11`), no un `select`: el AP12 se toca con el pulgar y la lista son tres nombres.
- Al acabar, la cita aparece en **la columna nueva** y **la hoja se pliega sola**, como hoy. Y al reabrirla,
  «Con quién» arranca en la peluquera que la cita tiene AHORA.
- **Sin red**, el mismo aviso que ya tenía mover: `patchAppointment` no encola.
- **Arrastrar la tarjeta a otra columna: no**, mismo criterio que agenda-lista.

**Un atributo nuevo, y la razón**: los chips de hora llevan `data-hueco`. Desde este bloque hay **dos**
grupos de botones con `aria-pressed` dentro de la hoja (las horas y «Con quién»), y el banco localizaba los
chips justo por ese atributo: el locator viejo contaba el nombre de la peluquera como si fuera una hora. Los
dos specs del capítulo 7 que lo usaban pasan a `button[data-hueco]`.

---

## 4 · Qué lo prueba

| Dónde | Qué |
|---|---|
| `apps/api/test/agenda-mover-staff.test.ts` (10) | el cruce puro: quién pasa, quién es 404, quién es 409 y con qué frase; el orden de las dos ramas; el servicio sin nombre; la cita sin servicios |
| `apps/tpv-web/test/mover-con-otra-candidatas.test.ts` (7) | a quién ofrece la hoja: los dos servicios y no alguno, sin matriz todas, la desconocida se ofrece, la que no hace ninguno se queda fuera |
| `apps/api/test-e2e/agenda-mover-con-otra.e2e.ts` (11) | contra Postgres real: ver abajo |
| `apps/e2e-ui/specs/07-el-dia.spec.ts` | `mover una cita a otra peluquera: de Marta a Lucía, mismo id` y `el selector no ofrece a quien no sabe hacer el servicio` |

### Los once casos del e2e de la API

Fichero propio y no un bloque en `agenda-suelo.e2e.ts`: ese arrastra estado dentro de su `describe` (sus
casos se pisan las horas) y su centro sólo tiene dos peluqueras que saben hacer lo mismo. Aquí hacen falta
tres manos distintas —una que lo sabe todo, una que no tiñe, una inactiva— y una peluquera de otro centro.
Sembrar eso encima del suelo sería cambiar los casos 17 y 18, que son justo los que no se pueden romper.

| # | Qué |
|---|---|
| 1 | **misma hora, otra peluquera**: mismo id, mismo `start`, la asignación STAFF activa es la nueva, y **la anterior queda libre a esa hora** (sin esto, mover sería duplicar la ocupación) |
| 2 | otra hora **y** otra peluquera, de una vez |
| 3 | **sin `staffUserId`, sigue conservando la suya** — el 17/18 de agenda-lista en este fichero |
| 4 | la que no hace el servicio → `409 STAFF_NO_SKILL`, `code` igual, `"Ana no hace Tinte."`, el mensaje **no contiene «hueco»**, `alternatives: []`, y la cita no se mueve ni cambia de manos |
| 5 | cita de DOS servicios: basta que no sepa uno |
| 6 | peluquera de **otro tenant** → `404`, y cero asignaciones suyas en los dos centros |
| 7 | peluquera con el **perfil apagado** → `404`, con su nombre |
| 8 | `staffUserId` **sin** `start` → `400`, y nada se toca |
| 9 | `staffUserId` **con** `status` → `400`, y la cita **no se cancela** |
| 10 | un uuid que no es de nadie → `404`, no un 500 |
| 11 | la elegida **ocupada** a esa hora → el «no» lo sigue dando el motor, `409 NO_SLOT` con **sus** alternativas, ninguna es la hora cogida. La puerta de la matriz no se come este caso |

---

## 5 · La tabla de sabotajes

Cada uno: se rompe **una línea de producción**, se pasa lo que tenga que caer, y se devuelve la línea a su
sitio. Los de la API van contra Postgres real (`agenda-mover-con-otra.e2e.ts`, y el 1 también contra
`agenda-suelo.e2e.ts`); los de la pantalla pasan el banco con `-x`, que para en el primer rojo. Comprobados
el 05-10-2026 sobre el commit `54d3e2a`; el repo quedó limpio detrás de los seis.

| # | Lo que se rompe | Dónde | Qué se pone rojo | Con qué mensaje |
|---|---|---|---|---|
| 1 | **La ruta ignora `staffUserId`** | `agenda/routes.ts` · `reschedule(…, suProfesional)` en vez de `elegida ?? suProfesional` | **tres** casos del e2e (1, 2, 11) **y** el banco · `07 · mover una cita a otra peluquera` | `expected 409 to be 200` con un `NO_SLOT` de diez alternativas · y en el banco `expect(locator).toBeVisible() failed · element(s) not found` sobre la tarjeta en la columna de Lucía |
| 2 | **Se deja de comprobar la skill** | `mover-staff.ts` · `sinSkill` siempre vacío | `04 · la que no hace el servicio es 409 STAFF_NO_SKILL` y `05 · en una cita de DOS servicios` | `expected 'NO_SLOT' to be 'STAFF_NO_SKILL'` · `expected 'No se pudo mover a ese hueco.' to be 'Ana no hace Tinte.'` |
| 3 | **Se deja de comprobar de quién es** | `mover-staff.ts` · perfil inventado si no está, y las dos ramas de 404 apagadas | `06 · la peluquera de OTRO centro`, `07 · la del perfil apagado`, `10 · un uuid que no es de nadie` | `expected 409 to be 404`, con `{"error":"STAFF_NO_SKILL","message":"ella no hace Corte de pelo."}` |
| 4 | **Desaparece el 400 de `staffUserId` sin `start`** | `agenda/routes.ts` · la guarda apagada | `08 · staffUserId sin start` y `09 · staffUserId con status` | `expected 'NO_CHANGE' to be 'STAFF_WITHOUT_START'` · y el 9 enseña el daño: `status: "CANCELLED"`, `expected 200 to be 400` — **la cita se cancela mientras se pide cambiar de peluquera** |
| 5 | **El selector ofrece a todas** | `AgendaPage.tsx` · `candidatas = props.staff` | banco · `07 · el selector no ofrece a quien no sabe hacer el servicio` | `expect(locator).toHaveCount(expected) failed · unexpected value "1"` sobre `[data-staff="…lucia"]` |
| 6 | **La búsqueda de huecos usa la ACTUAL en vez de la elegida** | `AgendaPage.tsx` · `searchAvailability({ staffUserId: staffDeLaCita(appt) })` | banco · `07 · mover una cita a otra peluquera` | `expect(locator).toBeVisible() failed · element(s) not found` sobre el chip de las 10:15 |

### Lo que los sabotajes enseñaron

**Ninguno de los seis deja todo en verde**, que es la diferencia con el 7b de agenda-lista. La razón es el
caso 1 del e2e: **mover a la misma hora con otra peluquera** es un movimiento que la interfaz SÍ puede
pedir y que el servidor tiene que ejecutar, así que el fijado del cuerpo no está tapado por la pantalla
como lo estaba el de agenda-lista. El sabotaje nº 1 cae por los dos lados, y se comprobó corriendo las dos
cosas, no deduciéndolo.

**El sabotaje 6 muerde por donde no se esperaba, y conviene entenderlo.** Buscar los huecos de Marta
cuando la elegida es Lucía no enseña «horas de más»: enseña **una hora de menos**, justo la que la clienta
quiere. Las 10:15 son las de la propia cita, y `reschedule` carga la ocupación del día sin excluirla (§1),
así que para Marta esa hora sale ocupada por ella misma. El «a la misma hora, pero con Lucía» se vuelve
intecleable. Es la misma frontera del §1 vista desde la pantalla.

**El 3 enseña que hay dos capas, y que una tapa a la otra a medias.** Sin la comprobación de quién es, una
peluquera de otro centro no se cuela —la rama de skill la para, porque `getSkilledStaff` filtra por
`tenant_id` y no está en la matriz de este tenant— pero sale como `409 STAFF_NO_SKILL` con el nombre
inventado «ella». No hay asignación cruzada ni un 500 en ningún momento; lo que se rompe es **lo que la
cajera lee**, y eso también cuenta.

**El 2 tiene gemelo sin navegador**: con `sinSkill` vacío, cuatro de los diez casos de
`agenda-mover-staff.test.ts` se ponen rojos (`expected null to deeply equal { status: 409, …(2) }`). El
cruce puro y la ruta se vigilan por separado a propósito: el unitario dice que el cruce decide bien, el e2e
dice que la ruta lo llama.

---

## 6 · Lo que NO cubre este bloque

- **Mover a la misma hora cuando la cita ocupa un RECURSO compartido** (§1, caso C). `reschedule` carga la
  ocupación sin excluir la propia cita, así que el lavacabezas que la cita tiene cogido bloquea su propio
  movimiento. Hoy no se puede pisar (nadie siembra `ServiceResourceNeed` y Sole no tiene recursos) y
  arreglarlo es cambiar la lógica del motor, fuera de alcance.
- **Arrastrar la tarjeta entre columnas.**
- **Mover a una hora que solapa con la propia cita en la misma peluquera** (lo de agenda-lista §2b: de las
  12:30 a las 12:45 no se puede). Igual que estaba.
- **Cambiar los servicios al mover.**
- **Mover sin red**: `patchAppointment` no encola, y el botón lo dice.
- **La pausa del tinte.**
- **El motor**: cero líneas. El parámetro ya existía desde agenda-lista §2b.

---

## 7 · La APK

**`mipiacetpv-1.21.0-12100.apk`**, con el procedimiento de siempre, sin variarlo:

```bash
apps/tpv-android/scripts/build-release-apk.sh 1.21.0
```

| Dato | Valor |
|---|---|
| versionName | `1.21.0` |
| versionCode | `12100` (la fórmula del script: `MAJOR*10000 + MINOR*100 + PATCH`, igual que 1.20.0 → 12000) |
| commit | `54d3e2a` (árbol limpio, sin `-dirty`) |
| tamaño | 8 560 497 bytes |
| SHA-256 | `b04bb4dc1ec57312a9514fd966fbe1c91319c23aa178dd5f277b252759a7dc31` |
| sidecar | `apps/tpv-android/build-releases/mipiacetpv-1.21.0-12100.apk.sha256` |
| firma | `CN=mipiacetpv, O=mipiace, L=Madrid, C=ES` · SHA-256 del certificado `677d8620…05bfd6` (el mismo que la 1.20.0) |

**NO se publica**: lo hace Dirección tras el merge, con `infra/publicar-apk.sh`.

### Comprobado sobre el binario, no sobre el build

| Qué | Cómo | Resultado |
|---|---|---|
| La versión que Android registra dentro | `aapt2 dump badging` | `versionCode='12100' versionName='1.21.0'`, `es.mipiace.tpv` |
| La huella coincide con su sidecar | `shasum -a 256 -c …sha256` | `OK` |
| El origen embebido | `unzip -p … assets/capacitor.config.json` | `androidScheme: https`, `hostname: mipiacetpv.com`, `allowMixedContent: false` |
| El backend de producción | `grep -F https://api.mipiacetpv.com` sobre los `.js` del APK | 4 apariciones |
| Sin Service Worker (A4) | `sw.js` / `registerSW.js` dentro del APK | no están |
| **El código de ESTE bloque viaja dentro** | `grep -F` sobre `assets/public/assets/*.js` | `Sólo aparecen las que hacen estos servicios` ✓ · `Con quién` ✓ · `Mover a las` ✓ · y el `Hace falta conexión para mover una cita` de agenda-lista sigue ✓ |

**El APK pesa 600 KB MENOS que la 1.20.0, y no falta nada.** Se comprobó en vez de suponerlo: los dos
llevan **461 ficheros** y casi el mismo tamaño sin comprimir (9 749 503 vs 9 750 945 bytes), y la única
entrada que cambia de nombre es el bundle con su hash (`index-DA_MgXzd.js` → el nuevo). La diferencia es
compresión, no contenido.

---

## 8 · Cómo se cierra

- [x] **Medido el motor antes de tocar nada** y contestadas las dos preguntas del prompt (§1), con una
      tercera cosa que la medición destapó y que se deja dicha como frontera.
- [x] **`engine.ts`: cero líneas.** El parámetro ya existía.
- [x] **Sin migración.**
- [x] **Unitarios**: 10 del cruce de la API + 7 del cruce del TPV.
- [x] **E2E de la API**: 11 casos nuevos en `agenda-mover-con-otra.e2e.ts`, y la suite e2e entera en verde
      (23 ficheros, 363 tests) con una base propia de esta sesión — **los casos 17 y 18 de agenda-lista
      incluidos**, que son los que no se podían romper.
- [x] **Suite normal**: 275 ficheros, 3 014 tests, verde.
- [x] **Typecheck** de la API y de los dos frontends (`tsc -b`), y las dos builds de Vite — lo del job `ci`.
- [x] **`pnpm e2e:agenda` entero en verde DOS veces**, con puertos propios (3103/5283/5284), base
      `mipiacetpv_mover_banco_e2e` y **Redis propio** (contenedor `mipiacetpv-redis-mover`, 6380): **30
      passed** las dos veces (2,4 min y 2,7 min).
- [x] **Seis sabotajes** (§5), los tres que pedía el prompt entre ellos. Ninguno deja todo en verde. El repo
      quedó limpio detrás de los seis.
- [x] **APK 1.21.0** construida desde el commit final con árbol limpio y comprobada **sobre el binario**
      (§7). **No publicada.**

### Lo que hace falta para correr esto en otro árbol

El worktree venía sin `node_modules` ni `apps/api/.env` (los dos gitignored). Para repetir el banco:

```bash
pnpm install && pnpm --filter @mipiacetpv/db run generate
docker run -d --name mipiacetpv-redis-mover -p 6380:6379 redis:7-alpine
# apps/api/.env con base y Redis propios (el patrón de agenda-lista), y:
DATABASE_URL=…/mipiacetpv_mover_banco_e2e REDIS_URL=redis://127.0.0.1:6380/0 \
  BANCO_API_PORT=3103 BANCO_ADMIN_PORT=5283 BANCO_TPV_PORT=5284 pnpm e2e:agenda
```

Y `apps/tpv-android/android/keystore.properties` para firmar la APK: también gitignored, se copia del árbol
principal (mismo Mac, mismo keystore).

### La CI

Verde en los dos runs de la rama, con los tres jobs:

| Run | Evento | `ci` | `smoke` | `e2e` |
|---|---|---|---|---|
| [37293679011](https://github.com/matiasoyola/mipiace-tpv/actions/runs/37293679011) | push | ✓ | ✓ | ✓ |
| [37293798740](https://github.com/matiasoyola/mipiace-tpv/actions/runs/37293798740) | pull_request (PR #6) | ✓ | ✓ | ✓ |

`publish` queda **skipped**, que es lo correcto: sólo corre en push a `master`.

### Lo que queda para Dirección

Merge del [PR #6](https://github.com/matiasoyola/mipiace-tpv/pull/6) contra `master`, despliegue y publicación de la APK con `infra/publicar-apk.sh`. Aquí no se ha
hecho ninguna de las tres.
