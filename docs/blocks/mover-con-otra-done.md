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

_(pendiente: se rellena con los sabotajes medidos)_

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

_(pendiente)_

---

## 8 · Cómo se cierra

_(pendiente)_
