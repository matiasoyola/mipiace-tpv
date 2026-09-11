# Bloque B-reservas-6a · El suelo de la agenda — DONE

Origen: el prompt de Matías del 11-09-2026, que parte B-6 en dos.
Frente 0: `docs/blocks/reservas-6a-plan.md`.
`docs/code-prompts/bloque-reservas-6-yield.md` pasa a ser **B-6b** y lleva la nota que lo dice.
Rama `reservas-6a-suelo`, worktree `mipiacetpv-reservas-6a`. Base: `562458a`. **Sin push, sin deploy,
sin migración.**

**El motor no tenía reloj.** Medido en el Frente 0: `grep "new Date()\|Date.now()"` sobre
`apps/api/src/agenda/*.ts` daba **una sola aparición**, y era el TTL del hold. Ofrecía y aceptaba
ayer, y aceptaba las 10:07 llamando al endpoint. Ahora hay un suelo, no se configura, y vale igual al
listar, al reservar y al mover.

Es lo que hacía falta para **dejar la agenda sola con Sole**.

---

## 1 · Lo que hay ahora

| Pieza | Dónde |
|---|---|
| **El suelo** — comienzo de la franja EN CURSO de la retícula del centro | `apps/api/src/agenda/floor.ts` |
| El reloj y el huso, **inyectables y únicos** (`EngineOptions`) | `apps/api/src/agenda/engine.ts` |
| El filtro al **listar** (un solo sitio: `computeSlots(..., notBefore)`) | `engine.ts` |
| La guarda al **reservar** (un solo sitio: `floorCheck()`), en `hold()` y en `reschedule()` | `engine.ts` |
| Las tres alternativas y la frase que se lee en voz alta | `floor.ts` · `engine.ts` |
| `409 { error, code, message, alternatives }` | `apps/api/src/agenda/routes.ts` |
| El suelo, la simetría y la retícula | `apps/api/test/agenda-suelo.test.ts` (22) |
| Otra `TZ` de proceso + el cambio de hora del 25-10-2026 | `apps/api/test/agenda-tz.test.ts` (15) |
| El `EXCLUDE` y el suelo contra Postgres real | `apps/api/test-e2e/agenda-suelo.e2e.ts` (10) |
| El store en memoria, compartido y menos mentiroso | `apps/api/test/helpers/agenda-fake-store.ts` |
| Una franja pasada no invita; el 409 con sus alternativas tocables | `apps/tpv-web/src/pages/AgendaPage.tsx` |
| Primer test de `AgendaPage` en jsdom | `apps/tpv-web/test/agenda-suelo.test.tsx` (8) |
| El banco visual con el 409 (`?fallo=pasado`) | `apps/tpv-web/visual/main.tsx` |

**Sin migración.** Este bloque no toca el esquema.

---

## 2 · Decisiones tomadas sin preguntar, una a una

### 2.1 La franja EN CURSO se reserva

Son las 11:10 → **las 11:00 valen, las 10:45 no**. Venía dictada por el prompt; la repito porque
decide todo lo demás y porque **conviene que choque con algo si va a chocar**: "¿tienes hueco ahora?"
es media agenda de una peluquería que coge por teléfono, y con el suelo en "ahora" esa llamada se
cae. El precio es que se puede reservar hasta 14 minutos hacia atrás dentro de la franja viva. Es el
precio correcto: lo que se pierde es una franja que aún está pasando, no una que pasó.

Sin excepción de OWNER. Una cita que **ya ocurrió** se cobra por venta rápida, no se agenda hacia
atrás.

### 2.2 La `tz` del tenant es hoy `CENTER_TZ`, y no pido columna

`Tenant` no tiene columna de huso (verificado en `schema.prisma`) y el bloque va sin migración. Lo
que sí queda cerrado es lo que pedía el prompt: **el cálculo no toca la zona del proceso en ningún
punto**, y el huso se lee de **un solo sitio** (`EngineOptions.tz`, con `CENTER_TZ` por defecto). El
día que exista la columna se enchufa en una línea — y hay un test que lo ejerce con el centro en
Nueva York, porque sin él era una promesa sin testigo (§3, sabotaje 13).

### 2.3 La alineación a la retícula también al MOVER

El prompt sólo nombra `hold()` (viene de D-4b, que midió esa puerta). Mover una cita a las 10:07 es
la misma fuga por la otra puerta, y el invariante 6 no distingue entre crear y mover. `reschedule()`
pasa por la misma `floorCheck()`.

### 2.4 Dos códigos, no uno

`BOOKING_IN_PAST` y `BOOKING_OFF_GRID`. Son **dos frases distintas al teléfono** ("esa hora ya ha
pasado" / "las citas empiezan cada cuarto de hora"); con un solo código la cajera tendría que
adivinar cuál de las dos le está pasando. Y el pasado se mira **antes** que la retícula: un "martes
pasado a las 10:07" es, para la clienta, una hora que ya pasó.

### 2.5 `code` = `error` en el cuerpo del 409

El prompt pide `{ error, code, message, alternatives }`. En B-6b `code` será la *key* de la regla que
bloqueó (`POLICY_BLOCKED`). Poniéndolo ya con el mismo valor, el front lee `code` desde hoy y no se
reescribe dos veces.

### 2.6 Las alternativas de un `BOOKING_IN_PAST` salen del SUELO, no de la fecha pedida

Si alguien pide el martes pasado, los "tres huecos siguientes" del martes pasado son cero. Se miran
el día del suelo **y el siguiente**: a las siete de la tarde, con el centro cerrado, las tres horas
que se le dan a la clienta son de mañana. Un error que no propone salida es medio error.

### 2.7 La idempotencia por `externalId` sigue POR DELANTE del suelo

El alta offline del TPV sube con `externalId`. Reenviar al reconectar una cita que el servidor **ya
tiene** no puede fallar porque haya pasado el tiempo. Tiene su test y su sabotaje.

⚠️ **El filo que esto NO tapa, y va aquí porque es de producto:** un alta creada sin red que **nunca
llegó a subir** y se replica cuando su hora ya pasó **la rechaza el suelo**, a propósito y sin
excepción. El outbox no reintenta los 4xx (B-5 §2.8) y el TPV avisa. Es coherente con "sin
excepciones", pero es el caso en que el suelo le quita trabajo hecho a la cajera. Si Matías quiere
otra cosa, es una decisión de producto y va a su bloque.

### 2.8 La guarda del cambio de hora: el suelo nunca por delante de ahora

Descubierta escribiendo el test del 25-10-2026 y **medida**: `wallTimeToUtc("2026-10-25","02:30")`
resuelve a la **segunda** pasada de esa hora (01:30Z). Estando en la primera (00:30Z), el suelo caía
**una hora en el futuro** y habría rechazado una cita legal. `currentGridStart` cae al epoch cuando
eso pasa — exacto mientras el offset del huso sea múltiplo de la retícula, y lo es en todos los husos
vivos (hasta el +05:45 de Nepal). Ningún centro abre a las 02:30, pero un invariante que se rompe una
hora al año no es un invariante.

### 2.9 La regla de horas se arregla, aunque sea preexistente

El bucle visual la pilló mintiendo de dos formas (§5). Se arregla **en este bloque** porque este
bloque va justamente de que la agenda no mienta sobre la hora: con lo pasado pintado en apagado, una
regla desplazada deja sin saber **a qué hora acaba lo que ya pasó**. Es el mismo criterio con el que
B-5 arregló lo que sus capturas destaparon.

### 2.10 El panel de alta pasa a ser columna flex de verdad

Mismo origen: el pie `sticky bottom-0` dentro del panel con scroll **flotaba sobre el contenido** y
tapaba justo las alternativas del 409 — visibles y no tocables. Cuerpo con scroll, pie fuera de él.

### 2.11 El store en memoria deja de mentir a favor

`getTemplateSlots` del falso ignoraba la ventana `from`/`to` y devolvía todas las plantillas
sembradas; el real sí la respeta. Lo destapó un sabotaje que no ponía nada rojo (§3, sabotaje 14).
Ahora filtra por fecha, como el de producción.

### 2.12 Dos ganchos de test en el front: `data-columna` y `data-hora`

La superficie de la columna y las etiquetas de la regla hay que poder cogerlas por su sitio desde
jsdom y desde Playwright. Un selector por clase de Tailwind no sobrevive a un refactor y, de hecho,
se rompió a mitad de este bloque cuando la regla pasó a ser `relative`.

---

## 3 · Sabotaje → test rojo

Los quince se **aplicaron de verdad** sobre el código, se corrió la suite, y se revirtieron.

| # | Sabotaje aplicado | Qué se puso rojo |
|---|---|---|
| 1 | El suelo sale de `hold()`/`reschedule()` (la guarda del pasado) | **8** unit (suelo, simetría, tz, cambio de hora) + e2e **4 y 8** |
| 2 | El suelo sale sólo de `availability()` (`notBefore` fuera) | **9** unit — incluido **el de simetría**, que es el punto |
| 3 | La alineación a la retícula fuera (`isOnGrid`) | **4** unit (10:07, los 30 s, simetría, mover) |
| 4 | **El suelo se aplica también al cobro** | e2e **9** — "una cita de hace una hora SE COBRA" |
| 5 | **El `EXCLUDE` se cae de la base** (`DROP CONSTRAINT no_staff_overlap`) | e2e **1 y 3** |
| 6 | La guarda del cambio de hora fuera | tz — "el suelo NUNCA queda por delante de ahora" |
| 7 | El suelo sale sólo de `reschedule()` | **2** unit (mover al pasado, mover a las 10:07) |
| 8 | La idempotencia por `externalId` pasa DETRÁS del suelo | **1** unit (el reenvío del outbox) |
| 9 | El front deja de cortar la franja pasada | `agenda-suelo` front **1** |
| 10 | El front vuelve a `flash(res.message)` (tira las alternativas) | `agenda-suelo` front **3** |
| 11 | La regla de horas vuelve a derivar 8 px por hora | `agenda-suelo` front **1** |
| 12 | Lo apagado llega hasta "ahora" y se come la franja en curso | `agenda-suelo` front **1** |
| 13 | `const tz = CENTER_TZ` dentro del motor (se ignora la inyectada) | **NADA** → ahora **1** |
| 14 | Las alternativas dejan de mirar el día siguiente | **NADA** → ahora **1** |
| 15 | El 409 de **mover** pierde el campo `code` | **NADA** → ahora e2e **8** |

**El 5 es el que este bloque venía a poder escribir.** El `EXCLUDE USING gist` estaba creado en
producción desde agosto y **nadie lo había visto rechazar una fila**: los tests del motor corren
contra un store que lo simula y ningún tenant tiene la agenda encendida. Tirándolo de la base de
test caen el 1 y el 3 — y que caiga el **3** (dos altas simultáneas por la API) prueba que la carrera
la ganaba **la BD y no el código**.

**Tres sabotajes no pusieron nada rojo la primera vez.** Eso es el valor del ejercicio:

- **13** — la `tz` inyectable era una promesa sin testigo, y es justo la pieza que se enchufa el día
  que `Tenant` tenga columna de huso. El test nuevo pone el centro en Nueva York con el instante
  elegido para que Madrid y Nueva York **no puedan** dar la misma respuesta (20:10Z: allí las 16:10
  con el turno abierto, aquí las 22:10 con el centro cerrado hace cuatro horas). El primer intento
  de este test **también pasaba con el sabotaje puesto**, porque a las 15:10Z las dos zonas daban
  15:00Z por caminos distintos.
- **14** — y la razón era peor que el hueco: **el store en memoria ignoraba la ventana de fechas**.
  El falso mentía a favor del motor (§2.11).
- **15** — sólo el alta afirmaba sobre `code`; mover no. El front lee las dos por el mismo camino.

---

## 4 · Lo que la suite NO cubre

Escrito para que nadie lo confunda con lo que sí cubre.

1. **Las frases sin alternativas.** `pastMessage([])` y `offGridMessage([])` ("…y no me queda ningún
   hueco después") no las ejerce ningún test. Se llega a ellas con el centro sin turnos.
2. **El alta offline que caduca antes de subir** (§2.7). El camino existe —el outbox no reintenta
   los 4xx y el TPV avisa— pero no hay test de punta a punta de ese caso concreto, ni se ha visto el
   aviso con un servidor de verdad.
3. **`BOOKING_OFF_GRID` desde el front no se puede provocar.** `openSlotFirst` redondea a la retícula
   y las alternativas vienen del servidor: la fuga de D-4b sólo se abre llamando a la API. El test
   del front lo **simula** para fijar que el aviso se pinta igual.
4. **El front no reacciona al paso del tiempo.** `nowMin` se calcula en el render: con la agenda
   abierta veinte minutos, lo pintado en apagado se queda atrás hasta el siguiente render. El
   servidor corta igualmente (el 409 llega), así que el fallo es cosmético — pero está.
5. **El front tiene su propia aritmética de huso.** `AgendaPage` lleva su `TZ = "Europe/Madrid"`
   desde B4; la "sola fuente" de este bloque es la del **motor**. Son dos sitios que hoy dicen lo
   mismo y nadie comprueba que sigan diciéndolo.
6. **La retícula es 15 min fija** (`SLOT_MINUTES`) y no se configura en ninguna parte. Sole trabaja
   en franjas de 30: hoy le ofrecemos inicios a y cuarto y menos cuarto. No es una regresión (es el
   comportamiento de B4) y no entra aquí — es configuración de centro, B-7/B-6b.
7. **No hay test del borde exacto entre dos peticiones** (una a las 11:14:59 y otra a las 11:15:00).
   Cada petición fija su propio "ahora" una vez; dos peticiones consecutivas pueden caer a distinto
   lado, que es lo correcto y no está escrito en ningún test.
8. **El worker del TTL de holds** (`agenda-hold-ttl-worker`) no se ha tocado ni se ha probado contra
   el suelo.
9. **`availability()` multi-día por la API** sólo se prueba con `from=to=hoy` en el e2e.
10. **Nada de esto se ha visto en hierro.** El AP11 está reservado para la pasada de B-5 (valla del
    prompt).

---

## 5 · Bucle visual

Playwright a **1280×800 (tablet), 390 y 320**, más el estado de error. Capturas en
`docs/blocks/reservas-6a-shots/`. El banco (`apps/tpv-web/visual/main.tsx`) gana `?fallo=pasado`, que
devuelve el 409 `BOOKING_IN_PAST` con su frase y sus tres alternativas; el reloj congelado (`?at=`)
ya venía de B-5.

| Captura | Qué enseña |
|---|---|
| `f6-agenda-suelo-1280.png` | El día de Sole con lo anterior al suelo apagado. A las 11:20, el borde está en las **11:15** y la línea roja de "ahora" cae **dentro** de la franja viva |
| `f6-agenda-suelo-390.png` · `-320.png` | Lo mismo en compacto |
| `f6-franja-pasada-1280.png` | Tocar las 10:45: **no se abre el panel**, y el aviso dice "El primer hueco es a las 11:15" |
| `f6-error-booking-in-past-1280.png` | El 409 con su frase y **tres horas tocables** (11:30 · 11:45 · 12:00), encima de las acciones primarias |
| `f6-error-booking-in-past-390.png` | Ídem en compacto, con el panel a pantalla completa |

**Lo que el bucle cambió**, y que ningún test habría cogido:

1. **Las alternativas del 409 salían debajo de "Reservar y cobrar"** — visibles por arriba y **no
   tocables**. El panel entero hacía scroll con el pie en `sticky bottom-0`, así que el pie flotaba
   sobre el contenido. Un error con salida cuya salida no se puede tocar es medio error otra vez
   (§2.10).
2. **La regla de horas mentía, y de dos formas** (§2.9), las dos preexistentes — se ven igual en
   `docs/blocks/reservas-5-shots/f8-agenda-390.png`:
   - no dejaba hueco para la cabecera de profesional → **40 px** de desfase constante;
   - cada fila llevaba `-mt-2` **en flujo**, y esos 8 px se **acumulaban**: **8 px por hora**, 96 px
     a las 20:00 — hora y media de desfase.
   Medido después del arreglo: la etiqueta de las 11:00 cae en 255,0 px y la de las 20:00 en 849,0
   px, que es **exactamente** donde las pone la geometría de la columna.

**Medido y NO arreglado:** la línea roja de "ahora" (`z-20`) se pinta **encima** de las tarjetas y
tacha el texto de una cita que la cruce (se ve en "10:30 · Ana Belén Soto"). Es preexistente de B4 y
tiene su lógica —la línea tiene que verse—, pero la solución buena es el `nowtag` del mockup
(`agenda-reservas.html:91`), que saca la hora al margen. No entra aquí.

---

## 6 · Frontera (no se ha cruzado)

- **El cobro no se toca.** Una cita de las 10:00 se cobra a las 11:00 igual que ayer: el suelo mira
  **sólo el inicio**. `POST /agenda/appointments/:id/checkout` y `POST /tickets/:id/checkout` tienen
  su e2e (9), y el sabotaje 4 lo demuestra al revés.
- **Los estados tampoco**: `IN_SERVICE`, `COMPLETED`, `NO_SHOW` y `CANCELLED` sobre una cita pasada
  siguen funcionando (e2e 10, y dos tests unitarios).
- **Mover una cita pasada hacia adelante se puede** (e2e 8). Sólo el inicio nuevo está bajo el suelo.
- **No hay endpoint para alargar una cita ni para cambiarle el servicio**, así que "una cita en curso
  se puede alargar" no tenía nada que romper: se deja dicho para que nadie lo dé por probado.
- **El camino de cobro a Holded, intacto** (GET-back, 5 céntimos, `/pay` idempotente). Los triggers
  de S1 y la imputación de turno del frente T de B-5, sin tocar.
- **El anti-solape sigue viviendo sólo en la base de datos.** Este bloque no añade ni una
  comprobación de solape en código; lo que hace es **enseñar a la BD rechazando**.
- **Cero `if (businessType)`**, vocabulario neutro (ADR-R6). El gate `agendaEnabled` sigue en ruta y
  en UI.
- **Nada de B-6b**: no hay registro de políticas, ni `booking_policies` leída, ni override.
- **Sin migración, sin `push`, sin deploy.**

---

## 7 · Al desplegar / probar en hierro

1. **Sin migración**: nada que aplicar.
2. **No se ha probado en el AP11** (valla del prompt: el hierro es de B-5).
3. El e2e nuevo depende de `E2E_DATABASE_URL` en CI, como los de S1 y B-5.
4. Antes de encender `agendaEnabled` a nadie, sigue valiendo el censo de B-5:
   `pnpm --filter @mipiacetpv/api audit:appointment-drafts`.

---

## 8 · Ficheros

**Nuevos**

```
docs/blocks/reservas-6a-plan.md                     el Frente 0
apps/api/src/agenda/floor.ts                        EL SUELO (invariante, no política)
apps/api/test/agenda-suelo.test.ts                  suelo, simetría, retícula (22)
apps/api/test/agenda-tz.test.ts                     otra TZ de proceso + 25-10-2026 (15)
apps/api/test/helpers/agenda-fake-store.ts          el store en memoria, compartido
apps/api/test-e2e/agenda-suelo.e2e.ts               EXCLUDE + suelo contra Postgres real (10)
apps/tpv-web/test/agenda-suelo.test.tsx             AgendaPage en jsdom, el primero (8)
docs/blocks/reservas-6a-shots/                      6 capturas
```

**Modificados**

```
apps/api/src/agenda/engine.ts        reloj y huso inyectables; suelo al listar y al reservar
apps/api/src/agenda/routes.ts        409 con code, message y alternatives
apps/tpv-web/src/pages/AgendaPage.tsx  el suelo en la superficie, el 409 con salida, la regla
apps/tpv-web/visual/main.tsx         el escenario del 409 (?fallo=pasado)
apps/api/test/agenda-engine.test.ts  reloj congelado + import del helper (cero expectativas tocadas)
docs/code-prompts/bloque-reservas-6-yield.md   la nota de que es B-6b
```

---

## 9 · Criterio de "funciona"

| Criterio del prompt | Estado |
|---|---|
| `availability()` no ofrece inicios anteriores a la franja en curso | ✅ unit + e2e 7 |
| `hold()`/`book()`/`reschedule()` rechazan el pasado con 409 `BOOKING_IN_PAST` | ✅ unit + e2e 4 y 8 |
| `message` legible en voz alta + tres alternativas | ✅ unit + e2e 4 |
| La franja EN CURSO se reserva | ✅ unit + e2e 6 |
| Mismo instante y mismo huso para listar y para reservar | ✅ un `clock.now()` por petición; tz inyectada con test (sabotaje 13) |
| **Simetría listar ↔ reservar (invariante 6)** | ✅ `agenda-suelo` — contra la lista real, no contra una constante |
| Alineación a la retícula en `hold()` (D-4b) | ✅ y también en `reschedule()` |
| **`EXCLUDE USING gist` contra Postgres real** | ✅ e2e 1, 2 y 3 · sabotaje 5 |
| Invariante 14 · `TZ=America/New_York` | ✅ `agenda-tz` (15 tests) |
| Invariante 14 · cambio de hora 25-10-2026 | ✅ y destapó la guarda del fold (§2.8) |
| El suelo NO toca el cobro, los estados ni las notas | ✅ e2e 9 y 10 · sabotaje 4 |
| Front: una franja pasada no invita | ✅ front 1 y 2 · capturas |
| Front: el 409 con su frase y alternativas tocables | ✅ front 6, 7 y 8 · capturas |
| Bucle visual 1280/390/320 + error | ✅ §5 |
| Tabla de sabotaje con sabotajes reales | ✅ §3, 15 sabotajes, 3 huecos destapados |
| **Verificado en hierro** | ❌ fuera de alcance (AP11 reservado a B-5) |

Suite: **180 ficheros, 1609 tests verdes, 3 saltados** (antes del bloque: 177 / 1564 / 3).
Los **3 saltados son los mismos de siempre y están justificados**: el `describe.skip` del flujo
*legacy* de `super-admin.test.ts:566`, cuya cobertura se trasladó a `onboarding-v2.test.ts` cuando
B-OnboardingV2 rehizo `POST /super-admin/tenants`. **Este bloque no salta ni un test.**

e2e: **5 ficheros, 45 tests** (antes: 4 / 35). `tsc --noEmit` limpio en api, tpv-web y admin.

Los e2e se corrieron contra una base propia
(`E2E_DATABASE_URL=…/mipiacetpv_r6a_e2e`), **borrada al terminar**: la suite hace `DROP SCHEMA
public` sobre la que le den y hay otras sesiones vivas.

---

## 10 · Commits

```
0a43b9d  docs(reservas-6a): plan del suelo y la nota de B-6b
51c819c  feat(reservas-6a): el suelo temporal del motor
b08d6a3  test(reservas-6a): la agenda bajo otra TZ y el cambio de hora
8292b75  test(reservas-6a): el EXCLUDE y el suelo contra Postgres real
61c7911  feat(reservas-6a): la agenda no invita a una hora que ya paso
dee340f  test(reservas-6a): tabla de sabotaje, y los tres huecos que destapo
```

Último commit de código: **`dee340f`**. Este documento va encima, en `docs(reservas-6a): done · …`.

---

## 11 · Qué falta para encender la agenda a Sole, y en qué orden lo haría

**El orden lo decide Matías.** Mi propuesta, con el porqué.

Primero, lo que **ya no falta**: con B-5 y 6a dentro, la agenda **se puede encender hoy**. Son los
cuatro pasos de configuración de `03-que-falta-para-la-agenda-del-informe.md` §1 bis (interruptor →
catálogo de agenda → personal y turnos → el botón aparece en el TPV), y ninguno depende de código.
Lo que 6a cambia es que **ya se la puede dejar sola con ella**: la agenda no acepta una hora que no
existe, y cuando dice que no, dice a qué hora sí.

### 1º · **B-7 · el horario del centro y los festivos** — y ahora sí, antes que 6b

Cambio de opinión respecto a lo que proponía B-5 (§12), y por una razón que 6a ha puesto delante:
**el suelo dejó al descubierto de qué dependen los huecos**. Hoy la ventana reservable **es** el
turno del personal (H2 del cruce). Eso obliga a Sole a **ensanchar el turno de una empleada para
abrir un hueco al público** —mentir en el dato de RRHH— y a bloquear cada festivo **a mano, día a
día**. Eso no es incómodo: es la clase de trabajo que se olvida un lunes de agosto y acaba con una
clienta plantada en la puerta de un centro cerrado. Además es el prerrequisito de que el suelo
*sirva*: con festivos de verdad, "no hay hueco" deja de ser una consecuencia del cuadrante.

### 2º · **B-6b · las reglas del centro**

Con horario real encima, las siete reglas (`MIN_LEAD_MINUTES`, `NO_FRAGMENT` y compañía) se apoyan en
algo que no miente. Y **ya no llevan el guardarraíl dentro**: el suelo lo cubre y no se apaga, así
que 6b puede entrar **entera apagada** y encenderse regla a regla viendo el efecto. Dentro van
también los invariantes 2 (solape de recurso) y 4 (buffers ≠ 0), que 6a dejó fuera.

### 3º · **Configuración: la retícula del centro**

Pequeño y molesto a diario: Sole trabaja en franjas de **30** y le ofrecemos inicios a y cuarto
(`SLOT_MINUTES` es una constante, §4.6). Cabe en B-7 o en 6b; no merece bloque propio.

### 4º · **B-9 · el panel de salud**

Sigue siendo el último de los cuatro, y por lo mismo que decía B-5: "un servicio sin nadie asignado
devuelve cero huecos en silencio" se revisa a mano en diez minutos con tres profesionales y nosotros
acompañando. Paga cuando el centro crezca o cuando dejemos de acompañar. Con 6b dentro, además,
tendrá algo que pintar: la traza de qué regla descartó qué hueco.

**Y antes de cualquiera de los cuatro: la pasada en hierro de B-5** (AP11, cajón, papel). Es la única
parte del ciclo de Sole que **nadie ha visto funcionar en una máquina de verdad**.
