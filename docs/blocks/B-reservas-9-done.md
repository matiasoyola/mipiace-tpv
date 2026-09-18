# Bloque B-reservas-9 · Panel de salud de la agenda — DONE

Rama `reservas-9-panel-salud`, worktree `mipiacetpv-reservas-9`, sobre master **`dcff405`**
(S1, B-5, B-6a, B-7a y H1 dentro; `fd06ed3` es lo que corre en producción y `dcff405` sólo le
añade los prompts del catálogo local). **Sin deploy, sin migración.**

Prompt: `docs/code-prompts/bloque-reservas-9-panel-salud.md`.

| | |
|---|---|
| **Suite antes** | `196 ficheros · 1865 verdes · 3 saltados` · exit 0 |
| **Suite después** | `199 ficheros · 1909 verdes · 3 saltados` · exit 0 |
| **Tests nuevos** | **44** en `pnpm test` (+3 ficheros): 29 de API y 15 del TPV. **Más 15 casos de e2e**, que corren en su propia suite. Cinco de ellos salen de la revisión de cierre (§11) |
| **Saltados** | **los mismos 3 de antes**: el `describe.skip` de `super-admin.test.ts:566`. Este bloque no salta ni un test |
| **e2e** | **`100/100`**, la suite e2e ENTERA, contra Postgres real y base propia `mipiacetpv_r9_e2e` (15 casos nuevos + los 85 de antes) |
| **Migración** | **ninguna**. El bloque no añade ni una columna: lee lo que ya hay |

**El fallo que costó dos semanas ya no es invisible.** Un servicio sin ninguna fila
`staff_skill` se descartaba en silencio (`engine.ts:443`, `eligible.length < staffRequired`) y
ninguna pantalla lo insinuaba. Ahora la agenda lo dice con un número desde la tira de días, el
panel lo dice en grande, lista cuáles son, y desde ahí se arregla en un clic sin salir de la
agenda.

---

## 1 · Lo que hay ahora

| Pieza | Dónde |
|---|---|
| **Las seis tarjetas**, cada una `{ key, title, query, explain, run() }` | `apps/api/src/agenda/health.ts` |
| Las seis consultas, exportadas como constantes: **lo que se ejecuta es lo que se enseña** | `health.ts` (`SQL_*`) |
| La sonda de dependencia contra el esquema vivo (`information_schema`) | `health.ts::hasTable` |
| El patrón de duración declarado por el centro (`booking_policies`) | `health.ts::loadDurationPattern` |
| `GET /agenda/health` — cifra + explicación + consulta + estado de dependencia | `apps/api/src/agenda/routes.ts` |
| **La matriz**, y la **única** escritura que comparten los dos lados | `apps/api/src/agenda/skill-matrix.ts` |
| `GET /agenda/skill-matrix` · `PUT .../staff/:userId` (lado A) · `PUT .../service/:id` (lado B) | `routes.ts` |
| El lado A del admin (B-3) pasa a usar **el mismo** módulo de escritura | `apps/api/src/staff/routes.ts` |
| El panel: esqueleto, error con la última foto, vacío informativo, «cómo se calcula esto» | `apps/tpv-web/src/pages/AgendaHealthPanel.tsx` |
| La matriz editable desde los dos lados, con su buscador y su filtro | `apps/tpv-web/src/pages/AgendaSkillMatrix.tsx` |
| La capa de datos y la última foto con su hora | `apps/tpv-web/src/lib/agenda-health.ts` |
| La puerta desde la agenda, con la cifra de la tarjeta 1 | `apps/tpv-web/src/pages/AgendaPage.tsx` |
| El contrato del panel y la degradación honesta | `apps/api/test/agenda-salud.test.ts` (15) |
| La matriz desde los dos lados, y que fallan igual | `apps/api/test/agenda-matriz.test.ts` (12) |
| Las cuatro reglas de acabado y la ruta de un clic | `apps/tpv-web/test/agenda-salud.test.tsx` (12) |
| **Las cifras contra Postgres real**, con el caso del criterio | `apps/api/test-e2e/agenda-salud.e2e.ts` (15) |
| El banco visual: `agenda-salud`, `agenda-salud-vacia`, `agenda-matriz`, `?fallo=salud` | `apps/tpv-web/visual/main.tsx` |

### El estado de las seis tarjetas hoy

| # | Tarjeta | Estado hoy | Por qué |
|---|---|---|---|
| 1 | Servicios que nadie puede hacer | ✅ **calcula** | No depende de nada que falte |
| 2 | Duraciones que no cuadran con la carta | 🟡 **calcula si el centro declara su patrón** | Sin patrón declarado no hay desviación que medir, y no se inventa uno |
| 3 | Programas con saldo vivo y sin próxima cita | ⏳ **deshabilitada** | Depende de **B-reservas-8**: no hay tabla `vouchers` |
| 4 | Qué han filtrado hoy las reglas | ⏳ **deshabilitada** | Depende de **B-reservas-6b**: no hay registro de filtrado |
| 5 | Citas creadas por canal en 24 h | ✅ **calcula** | `appointments.source` existe desde B4 |
| 6 | Ventanas que se desvían del turno contratado | ⏳ **deshabilitada** | Depende de **B-reservas-7b**: la ventana reservable no está separada del turno (7a puso el horario del centro, que es otra cosa) |

Las tres se encienden cuando su tabla exista **y** el bloque que la publica haya validado su
consulta contra datos reales (§2.4 y §8). Hasta entonces, apagadas.

Las tres deshabilitadas **no enseñan un cero**: enseñan de qué dependen y por qué. Un cero
falso parece un dato bueno y es peor que un hueco declarado.

---

## 2 · Decisiones tomadas sin preguntar, una a una

### 2.1 Las consultas son SQL crudo, y la constante que se ejecuta es la que se enseña

El principio del bloque (ADR-F3) es que no haya una cifra sin su consulta al lado. Con Prisma
query-builder la "consulta" que se le enseña al operador sería una **transcripción a mano** que
se queda vieja a la primera edición. Con SQL crudo, `card.query` es a la vez lo que se le pasa
a `$queryRawUnsafe` y lo que se pinta en el desplegable: **no hay forma de que diverjan**, y hay
un test que lo comprueba comparando la cadena ejecutada con la que llega a la pantalla.

El precio es que las seis consultas no se pueden probar contra un doble —probarlas contra un
doble sería probar el doble—, y por eso las cifras viven en el e2e contra Postgres real. Se
paga a gusto: es el criterio de casa desde el `EXCLUDE` de B4 (H5 del cruce).

### 2.2 La tarjeta 1 usa la MISMA condición que descarta el hueco en el motor

No es "servicios con cero `staff_skill`". Es `COUNT(profesionales con skill Y perfil de agenda
ACTIVO) < staff_required`, que es literalmente `engine.ts:443` cruzado con
`store.getSkilledStaff` (que filtra por `staffProfile.active`). De ahí salen **tres** sabores
del mismo fallo, y los tres se dicen con palabras distintas en la lista:

- «Nadie lo tiene asignado» — el caso del spa, 44 de 45.
- «1 asignada, ninguna con perfil de agenda activo» — la casilla está puesta y el motor la
  ignora. **Éste no lo pedía el prompt y es el que más me preocupa**, porque parece arreglado.
- «1 de 2 profesionales a la vez» — el ritual a cuatro manos con una sola persona.

Si la tarjeta contara sólo las filas de `staff_skill`, los dos últimos serían invisibles y la
pantalla mentiría diciendo que todo está bien.

### 2.3 El patrón de duración lo declara el centro; no se inventa el +10 de Koibox

La tarjeta 2 compara contra una fila `booking_policies` con
`key = 'agenda.duration_pattern'` y valor `{ stepMin, pickupMin }`. Sin esa fila la tarjeta
**no se calcula** y dice qué hay que declarar.

La convención +10 del spa (§1.4 del documento de entrada) era **tribal**, y lo que cazó el
mapeo que llevaba meses mintiendo fue justamente tenerla escrita. Meter un 10 por defecto
porque en Koibox era 10 sería inventarse un dato del centro: exactamente lo que la restricción
del prompt prohíbe. Y `catalogDurationMin` sigue sin existir (D-5 del cruce, deuda de catálogo
aceptada), así que la comparación no es «agenda vs carta» sino «agenda vs patrón declarado» —
está dicho en el `explain` que lee el operador y anotado abajo como deuda.

### 2.4 La dependencia se PRUEBA contra el esquema — y aun así el encendido ESPERA

Una tarjeta no está deshabilitada porque yo haya escrito que lo está: cada una tiene una sonda
que le pregunta a `information_schema` si existen la tabla **y las columnas** que su consulta
necesita. Así, si un bloque publica su tabla con **otras columnas**, la tarjeta sigue apagada
en vez de romperse con un 500. La sonda cuenta columnas, no tablas.

**Lo que la sonda NO puede probar es el significado** — y ésa es la decisión que se tomó en la
revisión de cierre (§11.1). La sonda mira la FORMA. Una tabla `vouchers` con un `type` cuyas
etiquetas no son las que la consulta busca, un `filtered` que cuenta una cosa distinta, o unas
ventanas caducadas que siguen contando, **no rompen nada: devuelven un CERO**. Y un cero falso,
en el panel que existe precisamente para que no haya ceros falsos, es el peor resultado
posible. Peor todavía: encendiéndose **sola**, el día de una migración, en producción, sin que
nadie lo esté mirando.

Así que el encendido pide las dos cosas: **tabla presente Y consulta validada por el bloque que
la publica.** Validar es ejecutarla contra Postgres real y dejar su caso en el e2e; marcarlo es
poner su línea de `CONTRATO_VALIDADO` a `true` en `health.ts`, en la rama de ese bloque, al
lado de la consulta. Una línea. Lo que se compra con ella es que la tarjeta se encienda en una
rama con un test delante, y no en una migración de madrugada.

Mientras tanto la tarjeta lo dice con precisión, y distinto según el caso: *"el saldo por
sesiones todavía no existe"* si falta la tabla; *"la tabla ya existe, pero la consulta todavía
no se ha ejecutado nunca contra ella"* si está pero sin validar. Hay test de los dos estados, y
de que el flag solo no enciende nada si la tabla no está.

Las tres consultas pendientes están escritas y se enseñan igual: son el **contrato** que esos
bloques tienen que cumplir, y están en el §8.

### 2.5 Una tarjeta que peta no tumba el panel, pero tampoco calla

`runCard` degrada la tarjeta a "no disponible" si su consulta falla. Eso solo sería una forma
elegante de esconder un bug —y de hecho **me escondió uno**: las seis consultas fallaban en
bloque contra Postgres real porque un parámetro `text` no casa con una columna `uuid`, y en
pantalla se veía igual que una dependencia que falta. Por eso el contexto lleva un `logError`
que las rutas cablean a `request.log.error`: en pantalla se degrada, en el log se grita.

Las consultas llevan ahora `$1::uuid` explícito y hay quince casos de e2e que se caen si
vuelve a pasar.

### 2.6 La escritura de la matriz vive en UN sitio, y el admin de B-3 pasa a usarlo

`PUT /staff/:userId/skills` (B-3, admin) y los dos endpoints nuevos del TPV caen todos en
`skill-matrix.ts::replaceSkills`. Dos implementaciones de la misma matriz acabarían
divergiendo, y el prompt pide explícitamente que los dos lados escriban igual: aquí no es una
promesa, es que **es la misma función**. El endpoint de B-3 se reescribió para llamarla; su
contrato externo (400 `INVALID_SERVICE_ID`, 409 `NO_STAFF_PROFILE`) no cambia y sus 18 tests
siguen verdes sin tocarlos.

Cambio pequeño de comportamiento, a mejor: antes se borraba el set entero y se recreaba; ahora
se borra sólo lo que sobra y se crea sólo lo que falta, así que **una celda que ya estaba
conserva su `created_at`**. Tiene test.

### 2.7 Asignar a alguien sin perfil de agenda se RECHAZA, no se guarda a medias

Crear una `staff_skill` de un usuario sin `staff_profile` deja una casilla marcada que el motor
ignora: la matriz diría que sí y la agenda seguiría sin dar huecos. Es el fallo que este bloque
persigue, así que los dos lados devuelven 409 `NO_STAFF_PROFILE` con el mismo mensaje. **Pero
la fila ya existente sí se enseña** (§2.8): rechazar crearla y esconder las que hay serían dos
cosas distintas.

### 2.8 Lo apagado que sigue gobernando se ve, en las dos vistas

Regla nº 1 de la auditoría del §7.1. En la matriz:

- un **servicio apagado** en el catálogo que conserva profesionales sale, marcado «apagado»
  (uno apagado y sin nadie no sale: no dice nada y sólo hace ruido);
- un **servicio sin ficha de agenda** sale marcado «sin ficha de agenda»: tiene gente asignada
  y aun así no se puede reservar;
- una **profesional con el perfil inactivo** —o sin perfil— sale como columna, marcada, y sus
  celdas se pintan en ámbar con un icono distinto: están puestas y no cuentan. La cuenta de la
  fila (`1/2`) usa sólo las que cuentan.

### 2.9 Leer el panel lo puede hacer cualquiera del mostrador; escribir la matriz, no

`GET /agenda/health` y `GET /agenda/skill-matrix` van con el gate normal de la agenda
(`requireOwnerOrCashier`): diagnosticar no rompe nada y esconderle el diagnóstico a la cajera
sería repetir el problema. Las dos escrituras llevan además `requireConfigRole` (OWNER o
MANAGER), porque la matriz es configuración del centro.

Y la pantalla **lo sabe antes**: `GET /agenda/skill-matrix` devuelve `editable`, así que a la
cajera se le enseñan las casillas deshabilitadas y una frase que lo dice, en vez de dejarla
tocar y fallar al guardar.

### 2.10 El botón de salud va en la tira de días, no en la cabecera

Un panel al que hay que saber llegar es el mismo silencio de antes con otra pantalla, así que
la agenda hace **una** lectura de `/agenda/health` al abrirse y enseña la cifra de la tarjeta 1
en el botón. Sin red no pasa nada: se queda con la de la última foto, o sin cifra. Nunca con un
cero inventado.

El botón **no va en la cabecera**: el bucle visual a 320 px enseñó que empujaba «Nueva cita»
fuera de la pantalla, que es justo lo que B-5 F8 arregló. Va al final de la tira de días, que ya
hace scroll horizontal y a la que quitarle 60 px no le cuesta nada.

### 2.11 El reloj entra inyectado

«Las últimas 24 h» necesita un ahora. El módulo no tiene reloj propio: le llega en el
`HealthContext` y las rutas se lo dan desde el `Clock` de B-6a (`opts.clock`). Un panel con
reloj propio no se puede probar.

---

## 3 · Sabotaje → test rojo

Ejecutado de verdad, uno a uno, revirtiendo entre medias.

| # | Qué rompo | Cómo | Qué se pone rojo |
|---|---|---|---|
| 1 | **La tarjeta 1 deja de exigir perfil de agenda ACTIVO** | fuera el `AND sp.active = true` del `LEFT JOIN` | **5 rojos en el e2e**: la cifra (`dice 2 y los lista`), el porqué de cada uno, el caso `2 a la vez`, y los dos del arreglo (`la cifra baja`, `baja a cero`). Es el sabor del fallo que parece arreglado y no lo está |
| 2 | **Una tarjeta no disponible devuelve 0 en vez de `null`** | `value: 0` en la rama `unavailable` | **2 rojos**: `las tres tarjetas cuyo bloque no existe salen deshabilitadas, NO a cero` y `sin patrón declarado la tarjeta 2 no inventa un patrón` |
| 3 | **El tenant se cae de una consulta** | fuera `WHERE a.tenant_id = $1::uuid` de la tarjeta 5 | **1 rojo**: `toda consulta filtra por el tenant en $1`, que barre las seis. El aislamiento por fila no depende de que a nadie se le olvide |
| 4 | **El lado B deja de borrar lo que sobra** | `toDelete = []` en `replaceSkills` | **1 rojo**: `quitar desde el servicio quita lo mismo que quitar desde el profesional`. Los dos lados dejan de escribir igual |
| 5 | **La guarda de rol desaparece** | fuera `requireConfigRole` de las dos escrituras | **1 rojo**: `403 a la cajera en los dos lados, y no escribe nada` |
| 6 | **La carga vuelve a ser un spinner** | `<Esqueleto />` → un `div.animate-spin` | **1 rojo**: `mientras carga enseña el esqueleto, no un spinner` |

Y los cuatro de la revisión de cierre (§11), ejecutados igual, con el test verde comprobado
**antes** de romper nada — un rojo sobre un test que ya fallaba no demuestra nada:

| # | Qué rompo | Cómo | Qué se pone rojo |
|---|---|---|---|
| 7 | **El contrato sin validar deja de gobernar** | `if (CONTRATO_VALIDADO[key] !== true)` → `if (false)` | `la tabla puesta no enciende la tarjeta si nadie ha validado su consulta`. La tarjeta vuelve a encenderse sola con una consulta que nadie ha ejecutado |
| 8 | **La cabecera de la rejilla vuelve a irse con el scroll** | fuera `sticky top-0` de la cabecera de columnas | `la cabecera de la rejilla se queda fija también al bajar` |
| 9 | **Sin columnas se vuelve a enseñar la rejilla muerta** | fuera la rama `SinProfesionales` | `sin ningún profesional con perfil lo dice, en vez de dejar una pantalla muerta` |
| 10 | **Marcar en bloque reemplaza en vez de sumar** | `onGuardar([...suyos, ...enBloque])` → `onGuardar(enBloque)` | `el lado A marca en bloque lo agendable que falta, en una sola escritura`. Borraría lo que la profesional ya daba |

Y uno que **no hizo falta provocar porque pasó solo**: las seis consultas fallaban en bloque
contra Postgres real por el `uuid` sin casto (§2.5). Los 15 casos del e2e se pusieron rojos a la
primera pasada. Es la prueba de que el e2e cubre lo que el test unitario no puede.

---

## 4 · Lo que la suite NO cubre

Escrito para que nadie lo confunda con lo que sí cubre.

1. **Las consultas de las tarjetas 3, 4 y 6 no las ha ejecutado nadie.** Están escritas contra
   tablas que no existen; la sonda las apaga antes de llegar a Postgres. Son un **contrato
   propuesto** (§8), no código probado — y por eso, desde la revisión de cierre, **tampoco se
   encienden solas** cuando la tabla aparezca: el bloque que la publica tiene que ejecutarlas,
   ajustarlas y marcar su línea de `CONTRATO_VALIDADO` (§2.4). Lo que este bloque no sabe, este
   bloque no lo enseña.
2. **La tarjeta 2 no compara contra la carta**, porque la carta no tiene su propio número
   (D-5). Compara contra el patrón declarado. Si el centro declara mal el patrón, la tarjeta
   dirá tonterías con toda la confianza del mundo.
3. **El rendimiento no se ha medido.** Hoy son siete consultas por apertura del panel (tres
   tarjetas que calculan, tres sondas de esquema y la lectura de la política), y serán diez
   cuando las tres pendientes se enciendan, sobre catálogos de 45 servicios. Con un catálogo de miles de
   productos la tarjeta 1 hace un `GROUP BY` sobre todo `service_scheduling`: no hay índice
   nuevo y no se ha probado a escala.
4. **La rejilla a escala de catálogo ya se ha mirado** (36 servicios × 4 profesionales,
   §11.2): de ahí salió que la cabecera se iba con el scroll, que está arreglado. Lo que sigue
   sin probarse es el **rendimiento de pintado** con catálogos de cientos de servicios y la
   rejilla en el hierro real (la captura es de navegador, no del AP12).
5. **No hay test de que la cifra del botón de la agenda se refresque al volver de la matriz.**
   El código lo hace (`onClose` relee); lo que hay probado es la lectura al abrir.
6. **La concurrencia de la matriz no está resuelta.** Dos personas editando el mismo servicio a
   la vez: gana la última. No hay estado «conflicto» (es el punto c del §H7, que sigue abierto
   para la rejilla y también aquí).
7. **El panel no se ha probado sin red de punta a punta en el APK**, sólo en jsdom: la última
   foto vive en `localStorage`, no en la caché de IndexedDB del día.

---

## 5 · Bucle visual

Playwright a **1280×800, 390 y 320**, contra el banco visual del TPV. `playwright-core` vive en
el scratchpad y **no entra en el repositorio**. Capturas en `docs/blocks/reservas-9-shots/`.

| Captura | Qué enseña |
|---|---|
| `r9-salud-1280 · -390 · -320` | El panel entero: la tarjeta 1 en alarma con la cifra en grande y los dos servicios con su porqué, y las tres tarjetas apagadas diciendo de qué dependen |
| `r9-salud-consulta-1280 · -390` | **La captura que sostiene el bloque**: «Cómo se calcula esto» abierto, con la explicación en lenguaje llano, los parámetros y la consulta literal |
| `r9-salud-vacia-1280 · -390` | El cero que es una buena noticia, dicho con palabras y no dejado en blanco |
| `r9-salud-error-1280 · -390` | Sin servidor: **«Esto es la foto de las 11:20»** + Reintentar, y las tarjetas de antes **se siguen leyendo** |
| `r9-matriz-1280 · -390 · -320` | La matriz con la ficha del servicio abierta (lado B). En escritorio, **panel al lado sin scrim**; en compacto ocupa la zona de la rejilla y deja la cabecera y el buscador a la vista |
| `r9-matriz-rejilla-1280 · -320` | La rejilla sin filtro: el servicio **apagado** que conserva a Sole, la columna de Nuria marcada **«inactiva»** y su celda en ámbar — puesta y sin contar (`0/1`) |
| `r9-matriz-lado-a-1280` | La ficha del **profesional** (lado A), con el aviso de que su perfil está inactivo |
| `r9-agenda-puerta-1280 · -390 · -320` | La agenda con la puerta del panel y su cifra, **sin comerse «Nueva cita»** a 320 px |
| `r9-matriz-catalogo-1280 · -390` | **La revisión de cierre**: la rejilla con un catálogo de centro de verdad (36 servicios, cuatro profesionales), bajada del todo — la cabecera sigue ahí y se sabe de quién es cada columna |
| `r9-matriz-sin-nadie-1280 · -390` | El día que un centro enciende la agenda: catálogo cargado y **ni un perfil de agenda**. Lo dice con palabras y dice dónde se arregla, en vez de una lista en rojo sin una casilla que tocar |

**Lo que el bucle cambió, y que ningún test habría cogido:**

1. **El botón de salud se comía la acción principal a 320 px** (§2.10). Se fue de la cabecera a
   la tira de días.
2. **«1 servicios».** Las tarjetas mandaban una sola unidad. Ahora mandan plural y singular
   (`unit` / `unitOne`) y el plural lo decide la cifra.
3. **El nombre del servicio desaparecía.** En las tarjetas pequeñas el nombre y el detalle iban
   en una fila con `justify-between`: a 390 px el nombre se truncaba a nada y lo que sobrevivía
   era el detalle — exactamente al revés del hallazgo nº 13 de la auditoría. Ahora el nombre va
   en su línea y el detalle debajo.
4. **La ficha de la matriz tapaba la cabecera.** Se pintaba `absolute` contra el overlay entero
   por falta de un `relative`: al abrir un servicio desaparecía el contexto de dónde estabas.

---

## 6 · Frontera (no se ha cruzado)

- **La UI de B-4 no se ha tocado.** La rejilla, el panel de alta sin scrim y el detalle inline
  están como estaban. Lo único que cambia en `AgendaPage.tsx` es el botón de la tira de días,
  una lectura al abrir y el montaje de los dos overlays nuevos.
- **No se han inventado datos.** F1 y F2 siguen sin existir. El panel se ha construido para
  enseñar que faltan; no hay ni una semilla fabricada.
- **No se han implementado** las reglas de yield (B-6b), la ventana reservable (B-7b) ni el
  saldo (B-8). Se consumen si aparecen.
- **Sólo lectura, salvo la matriz.** El panel no arregla nada por su cuenta.
- **Nada de Koibox.**
- **Fuera de alcance respetado**: ni informes ni analítica, ni alertas por email, ni arreglos
  automáticos, ni tarjeta de recursos (F2), ni vista de mes.
- **Sin migración y sin columnas nuevas.** La clave `agenda.duration_pattern` usa la tabla
  `booking_policies` que ya existe desde B-4.
- **`agendaEnabled` gatea en ruta y en UI**, y multi-tenant en todas las consultas (test).
- **No hay commit en el worktree principal.** `git worktree list` comprobado antes de la primera
  línea. Sin push.

---

## 7 · Criterio de «funciona»

> *En un tenant con tres servicios agendables de los que dos no tienen ninguna profesional
> asignada, el panel lo dice en grande al abrirlo, lista los dos, y desde ahí se llega en un
> clic a la matriz y se arregla — sin salir de la agenda y sin que nadie lo explique. Y cada
> cifra enseña, al desplegarla, cómo se ha calculado.*

Es el e2e `agenda-salud.e2e.ts` casos 1 a 8, contra Postgres real:

1. tres servicios agendables, dos sin nadie → **la cifra es 2 y los lista** (caso 1);
2. y dice por qué cada uno (caso 2);
3. el que necesita 2 profesionales y tiene 1 también sale (caso 3);
4. el de otro centro no sale (caso 5);
5. asignando a Sole **desde la ficha del servicio** —la vía de un clic desde la tarjeta— la
   cifra baja a 1 (caso 6);
6. y activando el perfil de la otra baja a 0, con su buena noticia (caso 7);
7. los dos lados dejan la misma fila contra la PK compuesta real (caso 8);
8. y las seis tarjetas traen su consulta y su explicación (caso 14).

Lo de «sin salir de la agenda» lo sostiene el front: los dos overlays cuelgan de `AgendaPage` y
`onClose` vuelve a la rejilla. Lo de «un clic» lo sostiene el test de jsdom `de la tarjeta 1 a
la matriz, con ese servicio`, y la matriz abre con la ficha de ese servicio y el filtro «sólo
los que no tienen a nadie» puesto.

---

## 8 · Los tres contratos que este bloque publica

Las tarjetas 3, 4 y 6 están escritas contra un esquema que no existe. Esto es lo que cada
bloque tiene que publicar; si lo publica distinto, hay que tocar su consulta y su sonda (una
constante y una lista de columnas, las dos en `health.ts`).

**Y publicar la tabla no basta para encender la tarjeta.** El bloque que la publique cierra el
contrato en tres pasos, los tres en su propia rama: (1) ejecuta la consulta contra Postgres
real, (2) la ajusta si hace falta y deja su caso en el e2e, (3) pone su línea de
`CONTRATO_VALIDADO` a `true` en `health.ts`. Hasta el paso 3 la tarjeta sigue apagada y dice
exactamente eso, con el nombre del bloque que la tiene que encender.

| Tarjeta | Bloque | Tabla y columnas que la sonda busca |
|---|---|---|
| 3 · Saldo vivo sin cita | **B-reservas-8** | `vouchers(tenant_id, type, sessions_left)` — y `appointments.voucher_id`, que ya existe desde B4. La consulta cuenta los `type = 'SESSIONS'` con `sessions_left > 0` sin ninguna cita futura activa |
| 4 · Qué han filtrado las reglas | **B-reservas-6b** | `booking_rule_hits(tenant_id, rule_key, created_at, offered, filtered)`. Un registro por regla y ventana: cuántos huecos se ofrecieron y cuántos quitó esa regla. Sin `offered` el desglose no se puede leer |
| 6 · Ventanas fuera del turno | **B-reservas-7b** | `bookable_windows(tenant_id, derived_from_shift_id, valid_from, staff_user_id)`. La desviación es `derived_from_shift_id IS NULL` |

Y uno que publica **este** bloque para el centro, no para un bloque: la política
`agenda.duration_pattern` con `{ stepMin, pickupMin }`. Hoy se siembra a mano (no hay pantalla
de alta: sería configuración, y el bloque es de diagnóstico). Está anotado como deuda.

---

## 9 · Ficheros

**Nuevos**

```
apps/api/src/agenda/health.ts                    las seis tarjetas y sus consultas
apps/api/src/agenda/skill-matrix.ts              la matriz y la única escritura
apps/api/test/agenda-salud.test.ts               15
apps/api/test/agenda-matriz.test.ts              12
apps/api/test-e2e/agenda-salud.e2e.ts            15 · Postgres real
apps/tpv-web/src/lib/agenda-health.ts            datos + última foto
apps/tpv-web/src/pages/AgendaHealthPanel.tsx     el panel
apps/tpv-web/src/pages/AgendaSkillMatrix.tsx     la matriz
apps/tpv-web/test/agenda-salud.test.tsx          12
docs/blocks/reservas-9-shots/                    22 capturas
```

**Tocados**

```
apps/api/src/agenda/routes.ts        +4 endpoints, requireConfigRole, el reloj inyectable
apps/api/src/staff/routes.ts         el lado A pasa por skill-matrix.ts (mismo contrato)
apps/api/test/staff-route.test.ts    el doble de prisma aprende staffProfile.findMany y
                                     el borrado celda a celda (ninguna aserción cambia)
apps/tpv-web/src/pages/AgendaPage.tsx  la puerta al panel y el montaje de los overlays
apps/tpv-web/visual/main.tsx         cinco pantallas nuevas y sus fixtures (dos de la
                                     revisión: `agenda-matriz-catalogo` y
                                     `agenda-matriz-sin-nadie`)
```

---

## 10 · Deuda anotada

1. **F1 sigue sin cargarse.** El panel lo hace visible; cargarlo es trabajo de datos del centro.
   Es el prerrequisito de que la agenda sirva para algo (Parte 7 del cruce).
2. **F2 (cabinas y aparatos) no tiene tarjeta**, como manda el prompt. `Resource` y
   `ServiceResourceNeed` existen y están vacíos: un servicio que necesita cabina y no tiene
   ninguna también da cero huecos en silencio, y eso hoy no lo dice nadie. Tarjeta 7 el día que
   F2 exista.
3. **`catalogDurationMin`** (D-5): mientras la carta no tenga su propio número, la tarjeta 2
   mide contra el patrón declarado y no contra lo que se publica.
4. **La política `agenda.duration_pattern` no tiene pantalla de alta.** Hoy se siembra a mano.
5. **Sin índice nuevo** para la consulta de la tarjeta 1 (§4.3).
6. **Sin estado «conflicto»** en la matriz: dos ediciones simultáneas, gana la última (§4.6).
   Con un mostrador de una persona no se pisa; entra el día que un centro tenga dos recepciones.
7. **El panel no se refresca solo.** Se relee al abrirlo y al volver de la matriz; no hay
   *polling*, y es a propósito (es diagnóstico, no monitorización).
8. **Activar un perfil de agenda no se puede desde aquí.** El sabor «asignada pero con el perfil
   inactivo» —el que más preocupa (§2.2)— se ve en las dos vistas y se explica, pero se arregla
   en el panel de administración, en Profesionales. No es silencio: es un viaje. Candidato a
   frente corto el día que alguien lo haga dos veces.
9. **Marcar en bloque sólo existe del lado del profesional** (§11.3), que es la dirección que
   hace falta: un centro tiene decenas de servicios y tres o cuatro profesionales. Del lado del
   servicio se marca a mano, que con cuatro columnas no duele.

---

## 11 · Revisión de cierre · lo que cambió antes del merge (13-09)

Tres cosas, y las tres son la misma regla de casa: *un riesgo que sale de cómo va a usar esto
un cliente de verdad se arregla, no se documenta.* Con la agenda apagada en todos los tenants,
el «cliente de verdad» de este bloque es el centro que la encienda el primer día — y las tres
salen de mirar ese día concreto, no un caso límite.

### 11.1 · Las tarjetas 3, 4 y 6 ya no se encienden solas · **el punto que pedía decisión**

Estaban escritas para encenderse en cuanto `information_schema` viera su tabla, con consultas
que **no ha ejecutado nunca nadie**. La sonda protege del 500 y del nombre de columna cambiado;
no protege del significado, y una tabla que casa en forma y no en semántica devuelve un cero —
en el panel cuyo principio entero es que no haya ceros falsos, y encendiéndose sola en una
migración de producción.

**Decidido: el encendido espera a que el bloque que publica la tabla valide su consulta.** La
sonda se queda (sigue siendo quien decide que el esquema encaja) y se le suma una línea por
tarjeta en `CONTRATO_VALIDADO`. Coste: una línea en la rama del bloque que ya está tocando esa
consulta de todas formas. A cambio, la tarjeta se enciende con un test delante. Detalle en
§2.4, el procedimiento en §8, y su sabotaje es el nº 7.

### 11.2 · La rejilla a escala de catálogo: la cabecera se iba con el scroll

El §4.4 declaraba que la matriz no se había mirado con un catálogo de verdad. Se ha mirado —
banco visual `agenda-matriz-catalogo`, 36 servicios y cuatro profesionales— y el filo estaba
ahí: la cabecera sólo era `sticky` en horizontal, así que a la quinta fila ya no se veía de
quién era cada columna y marcar una casilla pasaba a ser adivinar. Con tres servicios de
fixture no se ve; con el catálogo de una peluquería es la pantalla entera. Arreglado
(`sticky top-0`), con test (sabotaje nº 8) y sus dos capturas.

Y el mismo ejercicio destapó el estado que nadie había pintado: **un centro sin un solo perfil
de agenda**, que es exactamente el estado del día que se enciende la agenda. La matriz pintaba
la lista de servicios en rojo, sin una sola casilla que tocar y sin una palabra. Ahora lo dice
y dice dónde se da de alta un profesional (sabotaje nº 9, captura `r9-matriz-sin-nadie`). El
mismo aviso sale en la ficha del servicio, que es por donde se llega desde la tarjeta 1.

### 11.3 · «Se arregla en un clic» tenía que ser verdad también en el caso real

El criterio del bloque se prueba con tres servicios. El primer uso real es una peluquería con
decenas de servicios y tres profesionales que los dan casi todos: casilla a casilla eran
cientos de toques en una tablet y **una petición por toque**. El lado A —la ficha del
profesional— tiene ahora *«marcar también los N servicios agendables que le faltan»*: una sola
escritura, la que ya existía, sin endpoint nuevo.

Sólo suma, nunca vacía. Quitar en bloque lo que alguien ya daba borra trabajo de verdad y no lo
pide nadie; quitar se sigue haciendo casilla a casilla. Sabotaje nº 10.

### Lo que se miró y se dejó como está

- **Concurrencia de la matriz** (§4.6): gana la última. Un mostrador de una persona no lo pisa.
- **El panel sin red en el APK** (§4.7): la última foto vive en `localStorage`, no en la caché
  del día. Degrada a «esto es la foto de las 11:20», que es lo correcto para un diagnóstico.
- **Rendimiento** (§4.3): siete consultas por apertura sobre catálogos de decenas de servicios.
  A esta escala no se mide nada; el índice se mira el día que haya un catálogo de miles.
- **F2 (cabinas y aparatos)**: `Resource` y `ServiceResourceNeed` siguen vacíos, así que hoy
  ningún servicio se descarta por recurso. La tarjeta 7 entra con F2, no antes.

---

*Mi Piace Internet Solutions · 2026-09-13 · Rama `reservas-9-panel-salud` sobre `dcff405`.*
