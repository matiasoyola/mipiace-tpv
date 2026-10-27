# Bloque personal-1 · la ficha de personal, el cuadrante y el turno de noche en el fichaje — DONE

Origen: el prompt de Matías del 23-10-2026, revisado el 27-10. Rama `personal-1`, worktree
`mipiacetpv-personal-1`. Base `2be8476` = `origin/master`, comprobado con
`git merge-base --is-ancestor` antes de la primera línea. **Sin merges y sin despliegues.**
**Con DOS migraciones** — ver §10.

Frente 0: `docs/blocks/personal-1-plan.md`.

**Lo que este bloque compra.** La dirección de una residencia de 24 horas hace el cuadrante del mes
**en el programa**, ve en el momento si un turno se queda corto de gente o si alguien no descansa
doce horas, lo publica y cada persona lo ve en su móvil. El fichaje se compara solo contra él: «no
ha venido» pasa a ser un aviso cierto, y a la auxiliar de noche que sale a las 08:00 y sigue dentro
se le pregunta a las 12:00 y no a las 14:00. Y queda el suelo sobre el que personal-2 generará el
cuadrante con IA.

---

## 1 · Lo que hay ahora

| Pieza | Dónde |
|---|---|
| **La ficha de personal** — 9 columnas en `employees`, dos CIFRADAS | `migrations/20261027000000_personal_1_ficha/` · `schema.prisma` |
| El catálogo de categorías del tenant, con «cuenta como atención directa» | `employee_categories` |
| La cobertura mínima de cada turno | `center_shifts.min_coverage` |
| El margen del turno planificado | `tenants.fichaje_shift_margin_hours` |
| Los parámetros de las reglas | `staff_rule_settings` |
| **El cuadrante** — cabecera mensual, celdas y registro de cambios append-only | `migrations/20261027010000_personal_1_cuadrante/` |
| `set_staff_schedule_day(...)` + 4 triggers · la ÚNICA vía para pintar una celda | la misma migración |
| **`comprobarCuadrante`** y lo demás puro | `packages/cuadrante/` |
| Los dos sitios de cifrado nuevos | `apps/api/src/clinica/cripto-campos.ts` |
| La ficha, el catálogo y la importación CSV | `apps/api/src/fichaje/personal.ts` · `personal-routes.ts` |
| El cuadrante del lado de la base | `apps/api/src/fichaje/cuadrante.ts` · `cuadrante-routes.ts` |
| La salida olvidada **con turno planificado** | `apps/api/src/fichaje/time.ts` (la misma función) |
| Planificado frente a fichado en «Hoy», en el mes y en el export | `fichaje/admin-routes.ts` · `fichaje/export.ts` |
| «Mi cuadrante» del empleado | `fichaje/routes.ts` (`/fichaje/v1/cuadrante`) |
| Cinco pantallas del panel | `apps/admin/src/pages/fichaje/` |
| «Mi cuadrante» en la PWA | `apps/admin/src/fichar/screens/MiCuadrante.tsx` |

**Tests nuevos: 8 ficheros, 242 casos** (suite) **+ 1 fichero, 47 casos** (e2e).

| Fichero | Casos |
|---|---|
| `packages/cuadrante/test/reglas.test.ts` | 57 |
| `packages/cuadrante/test/importar.test.ts` | 33 |
| `packages/cuadrante/test/fichado.test.ts` | 21 |
| `packages/cuadrante/test/datos-que-faltan.test.ts` | 17 |
| `packages/cuadrante/test/medida.test.ts` | 1 |
| `apps/api/test/personal-1-migracion.test.ts` | 75 |
| `apps/api/test/personal-1-salida-olvidada.test.ts` | 13 |
| `apps/admin/test/personal-1-pantallas.test.tsx` | 25 |
| `apps/api/test-e2e/personal-1.e2e.ts` | 47 |

Y **tres inventarios de la casa ampliados**, no reescritos: los 18 casos de
`f1-puertas-del-modulo` pasan a 44, los 30 sitios cifrados de `residencia-1b-cifrado` a 32, las 24
columnas de `residencia-6-ilegible` a 26 y las 30 del esquema real de `clinica-7.e2e` a 32.

**Suite: 482 ficheros, 7 171 verdes, 10 saltados** (`pnpm test` desde la raíz, tras
`pnpm db:generate`). Base medida en este árbol antes de la primera línea: **474 / 6 896 / 10**. Ni
un saltado nuevo, que es el número que hay que mirar.

**e2e: 52 ficheros, 1 245 verdes** contra Postgres real (antes 51 / 1 198). Base borrada al cerrar
(§10.1).

**master no se ha movido** durante el bloque: `git log HEAD..origin/master` vacío al cerrar.

### 1.1 La forma final del dato

```
employees            + last_name, dni_cifrado, nss_cifrado, category_id,
                       weekly_minutes, contract_kind, hired_on,
                       contract_ends_on, schedule_seen_at
  CHECK dni/nss ~ '^c[0-9]+:…'      ← la base SÓLO admite ciphertext
  CHECK fin sólo en TEMPORAL, y fin >= alta
employee_categories  (tenant, code, name, counts_as_direct_care, is_standard)
  UNIQUE (tenant_id, code)          ← Employee.category_id RESTRICT
center_shifts        + min_coverage               ← NULLABLE: null ≠ 0
tenants              + fichaje_shift_margin_hours (CHECK 1–12)
staff_rule_settings  (ratio en MILÉSIMAS, descansos, cómputo, tolerancia,
                      qué es una jornada completa)   ← una fila por tenant

staff_schedules        (tenant, month, state, origin, firma, avisos al publicar)
  UNIQUE (tenant_id, month)
  CHECK (state = 'PUBLICADO') = (published_at IS NOT NULL)
staff_schedule_cells   (schedule, employee, day, turno XOR ausencia)
  UNIQUE (schedule, employee, day, center_shift_id)
  UNIQUE (schedule, employee, day) WHERE absence_kind IS NOT NULL  ← PARCIAL
staff_schedule_changes append-only (antes, después, motivo, autor, txid)

+ set_staff_schedule_day(...)                 SECURITY DEFINER, la ÚNICA vía
+ mipiacetpv_staff_schedule_change_exists(...)        mira txid_current()
+ 4 triggers: append-only del registro, el guard de las celdas,
              «publicar fija» y «un publicado no se borra»
```

Las dos migraciones son **aditivas**. Se despliegan juntas (§9).

---

## 2 · Las dos decisiones que el prompt mandaba explicar

### 2.1 Decisión 1 · la persona: `Employee` se amplía y se VINCULA; nada se fusiona

`Employee` es la única de las tres «personas» que existe **sin usuario** —21 personas en la
residencia, 3 con cuenta— y la única que ya tiene colgando el registro inalterable de ADR-018. Se
amplía con nueve columnas.

Cuando además hay `userId`, la ficha **enseña** sus roles de cuidado (`CareRoleAssignment`) y su
perfil de agenda (`StaffProfile`) en un bloque de sólo lectura al pie. No los mueve, no los copia y
no los edita: se llega a ellos por sus pantallas.

**¿Hizo falta fusionar algo? No, y aquí está el porqué**, que es lo que el prompt pedía que se
explicara si vinculando no bastaba:

- lo que la **ratio** cuenta es la **categoría profesional** de la ficha (`countsAsDirectCare`), no
  el rol de cuidado. Son dos vocabularios con dos dueños: la categoría la dice el contrato y la
  acreditación; el rol de cuidado dice con qué capacidad se firma un registro clínico (D-31). Una
  auxiliar sin cuenta de usuario no tiene rol de cuidado y **sí** cuenta en la ratio, que es
  exactamente el caso mayoritario;
- y al revés: la gerente que lleva el rol `DIRECCION` **no** cuenta como atención directa aunque su
  rol exista.

O sea: fusionarlos habría metido en la ratio a quien no toca y habría dejado fuera a quien sí. La
duplicidad que queda —una persona con ficha y con usuario tiene su nombre en dos sitios— está
nombrada en §13 como duda abierta.

### 2.2 Decisión 4 · la tabla de turnos se REUTILIZA, con una columna nueva

`center_shifts` no tiene nada de residencia dentro: tenant, código, dos horas de pared y un orden.
Lo que la ataba a la residencia eran sus **rutas**, que piden `ensureClinicaEnabled` +
`ensureResidenciaEnabled` y por lo tanto dejan fuera a un colegio que sólo ficha.

Así que:

- la tabla gana **una columna** (`min_coverage`) y nada más;
- se abren rutas NUEVAS bajo el gate del fichaje (`/admin/fichaje/turnos`);
- **`residencia/turnos-routes.ts` no se ha tocado ni una línea** y sigue leyendo lo mismo;
- `turnoDe` se reutiliza del paquete del plan, igual que `TURNOS_DE_SERIE` para la semilla. No hay
  una segunda copia.

No se movió porque seis modelos le apuntan con `RESTRICT` —`CareRecord`, `Incident`,
`GuardShiftSession`, `Handover`…— y renombrar una tabla con histórico firmado colgando no habría
ganado nada.

**Lo que esto significa y conviene no esconder:** un tenant de residencia tiene **dos pantallas que
editan los mismos tres turnos** (la de residencia y la nueva). No es un descuido: son dos módulos
que necesitan el dato. Lo que no puede pasar es que discrepen, y no pueden — es una fila. El e2e lo
fija («las rutas de residencia y las del fichaje leen la MISMA tabla»).

---

## 3 · Decisiones tomadas sin preguntar

### 3.1 La jornada contratada se guarda en MINUTOS

`weekly_minutes INTEGER`, no `numeric(5,2)`. 37,5 h son 2 250 minutos. Todo lo que compara jornadas
en esta casa cuenta minutos (`minutesWorked`, `totalMinutes`), el paquete puro compara enteros sin
que Prisma le meta un `Decimal` dentro, y el panel sigue pidiendo y enseñando horas. La ratio, por
lo mismo, va en **milésimas** (`0,20` → `200`).

### 3.2 Las cinco ausencias son un enum cerrado, no un catálogo del tenant

El prompt listaba «tipos de ausencia» entre los objetos de la migración y podría haber sido una
tabla. Es un enum porque **cada una significa algo distinto para las reglas**: `LIBRE` es lo que el
descanso semanal mira, `VACACIONES` e `IT` no cuentan como horas planificadas. Un tipo inventado por
un centro no tendría semántica en `comprobarCuadrante` y el aviso saldría mal. Mismo criterio que
`TimeEntryCorrectionReason`.

### 3.3 La semilla va al ABRIR el cuadrante, no al encender el módulo

Turnos y categorías se siembran la primera vez que alguien abre la pantalla, no cuando el
super-admin enciende `fichajeEnabled`. Mismo criterio que `asegurarDek`: en la primera vez que hace
falta. Un tenant que ficha y no hace cuadrante no necesita ni turnos ni categorías.

Y es idempotente por los dos únicos: **lo que ya está no se reescribe**. Si un centro renombró un
turno o le quitó la marca de atención directa a una categoría, la semilla no se lo deshace.

### 3.4 Leer el cuadrante no lo CREA

La cabecera del mes nace en la primera **escritura**. Pasear por los meses de un año no puede dejar
doce cabeceras vacías detrás. Está en el e2e.

### 3.5 Sólo el cuadrante PUBLICADO decide la salida olvidada

Un borrador es lo que la dirección está pintando ahora: puede tener medio mes en blanco o un turno
puesto por error que nadie ha visto. Si decidiera, pintar una mañana en la celda equivocada haría
que a alguien le preguntaran por una salida que no ha olvidado — y un mes sin empezar a pintar
cambiaría el comportamiento de un día para otro sin que nadie tocara nada.

### 3.6 Una celda no se EDITA nunca: se sustituye

El trigger rechaza cualquier `UPDATE` sobre `staff_schedule_cells`, también en borrador. «La celda»
no es una fila cuando el día lleva dos turnos (un partido son dos), y mover una de las dos dejaría
una etiqueta a medias en el registro de cambios.

### 3.7 El DNI que ya está NO se sobrescribe al importar

Para saber si el del fichero es otro habría que descifrar el que hay, y descifrar veintiún DNI para
pintar una vista previa es sacar a pasear veintiuna claves por nada. Si uno está mal, se corrige en
la ficha.

### 3.8 «Sin fichar hoy» desaparece cuando hay cuadrante publicado

Lo vio el bucle visual (§6). Esa columna significa «no ha aparecido» —es la queja del punto 1 de
`fichaje-1-done` §10— y al lado de «lo previsto y lo fichado» listaba dieciocho nombres de los que
la mitad libraban o entraban de noche. Con cuadrante publicado no se pinta; sin él, se queda.

### 3.9 Las reglas viven en «Reglas del cuadrante», y a Ajustes se llega por una puerta

El prompt las pide «en Ajustes». Son seis parámetros **más** la cobertura mínima de cada turno, y
meterlos dentro de `SettingsPage` la habría convertido en la lista de dieciocho opciones que
cuadro-de-control acababa de desmontar. Ajustes tiene su tarjeta y su enlace; el contenido vive en
su pantalla, con **de qué norma sale cada número** escrito al lado.

---

## 4 · UNA CORRECCIÓN AL PROMPT: «noche seguida de tarde» SÍ salta

El prompt pide, en «Cómo se cierra»:

> noche 22–08 seguida de mañana 08–15 (salta el descanso de 12 h), **noche seguida de tarde (no
> salta)**

La primera mitad salta y está en la tabla. **La segunda no puede no saltar**: una noche que acaba a
las 08:00 y una tarde que empieza a las 15:00 del mismo día dejan **siete horas** de descanso, y el
límite del art. 34.3 del ET son doce.

Se han comprobado las tres lecturas posibles y las tres dan lo mismo:

| Par | Hueco | ¿Salta con 12 h? |
|---|---|---|
| N del día 2 → M del día 3 | 0 h | **sí** (el que el prompt pide) |
| N del día 2 → T del día 3 | 7 h | **sí** |
| T del día 2 → N del día 2 | 0 h | **sí** |
| N del día 2 → T del día **4** | 31 h | **no** |

El par que no salta es el de la última fila. Y si lo que un convenio permite son siete horas, el
parámetro está ahí: `horasDescansoDiario` es dato del tenant, no una constante. Las cuatro filas
están en `packages/cuadrante/test/reglas.test.ts` con su porqué.

**Una segunda, menor:** el prompt dice «la noche del 25-10-2026 cuenta 11 h». Por el criterio de
esta casa —el tramo pertenece al día en que EMPIEZA, igual que en el registro de jornada— esa noche
es la celda del **24**. Las dos frases hablan del mismo turno y de las mismas once horas; el test lo
dice con las dos fechas para que no haya duda.

---

## 5 · Tabla de sabotaje

Cada fila se ha **ejecutado**: parche aplicado, banco corrido, resultado copiado, parche revertido.
Los nueve del prompt están, más cuatro.

| # | Qué rompo | Qué se pone rojo |
|---|---|---|
| 1 | Decidir el olvido fuera de `esSalidaOlvidada` (un `now - startedAt > 16*3_600_000` en `routes.ts`) | `personal-1-salida-olvidada` ×2 («ninguna rehace la cuenta», «las tres superficies llaman con el turno») |
| 2 | Volver a `localDate(a) !== localDate(b)` en el cierre | `personal-1-salida-olvidada` «ninguna ruta compara `localDate`» **y** `f3-fichaje-tiempo` ×8 |
| 3 | Publicar un cuadrante con avisos sin confirmar | `personal-1.e2e` «publicar con avisos SIN confirmar se rechaza» (y sigue en BORRADOR) |
| 4 | Editar una celda publicada sin motivo (quitar el `RAISE` de `CUADRANTE_SIN_MOTIVO`) | `personal-1.e2e` ×2 («sin motivo se rechaza», «una celda de un publicado no se borra a mano») |
| 5 | Borrar una fila del registro de cambios por SQL | `personal-1.e2e` «no se borra por SQL» (y el `UPDATE`, también) |
| 6 | Importar 5 000 filas | `personal-1.e2e` «límite y mensaje, y no se escribe nada» **y** `importar.test` «5 000 filas» |
| 7 | Un turno sin hora de fin (`startsAt === endsAt`) | `personal-1.e2e` «TURNO_DE_CERO_HORAS» |
| 8 | Dos turnos del tenant que se solapan | `personal-1.e2e` «salen como aviso al crearlos» **y** `reglas.test` «dos turnos que se solapan lo dicen» |
| 9 | Ver el cuadrante de otra empresa desde `/fichaje/v1` | `personal-1.e2e` «el token de una empresa no ve el cuadrante de otra» **y** `f1-puertas-del-modulo` «filtra por SU empleado y por SU tenant» |
| 10 | Quitar el `IS NULL` de un CHECK de la ficha | `personal-1-migracion` ×4 («TODOS los CHECK llevan su IS NULL delante») |
| 11 | Dejar `min_coverage` con `DEFAULT 0` en vez de nullable | `personal-1-migracion` «es NULLABLE, y el NULL significa «sin declarar»» **y** `reglas.test` «un turno SIN mínimo no se evalúa» |
| 12 | Escribir una celda con `prisma.staffScheduleCell.create` | `f1-puertas-del-modulo` «ni una celda se escribe sin pasar por `set_staff_schedule_day`» |
| 13 | Quitar la memoria de `instanteDePared` | `medida.test` «en caliente» (de 3 ms a 24) |

### 5.1 El nº 12 merece su párrafo

Cuando se ejecutó, **ningún test de comportamiento se puso rojo**. La razón: sobre un cuadrante en
BORRADOR, un `create` directo funciona — el trigger sólo exige la traza cuando está publicado. O
sea: el sabotaje era **inerte en el camino que los tests recorren** y una bomba en el otro, porque
dejaba dos vías para pintar una celda y una de las dos no valida ni el mes ni el «turno y ausencia
el mismo día».

Se cerró con el inventario de puertas, que **lee el código fuente** —mismo instrumento que H1 usó
para contar sus 92 puertas y que F1 usó para el sabotaje 10a— y afirma que ni la capa ni las rutas
mencionan `staffScheduleCell.create|update|delete`. Ahora se pone rojo ya.

---

## 6 · El bucle visual

**17 capturas a 390 y 1280×900** en `docs/qa/2026-10-27-personal-1/`, sobre un centro inventado de
21 personas, 48 camas con 44 ocupadas y dos meses de cuadrante publicado. La pila se levantó en el
scratchpad (base desechable, `playwright-core` y el Chrome del sistema): **ni una dependencia nueva
en el repo, ni un dato de cliente**.

| Pantalla | Capturas |
|---|---|
| «Hoy» con planificado frente a fichado | `1-hoy-planificado-{390,escritorio}` |
| La plantilla con lo que le falta a cada ficha | `2-plantilla-datos-que-faltan-…` |
| La ficha con la banda | `3-ficha-banda-…` |
| Importar · vista previa | `4-importar-vista-previa-…` |
| El cuadrante con sus avisos | `5-cuadrante-avisos-…` |
| Publicar con avisos | `6-publicar-con-avisos-…` |
| Reglas del cuadrante | `7-reglas-del-cuadrante-…` |
| Por dónde se llega en una residencia | `0-configuracion-de-residencia-…` |
| `/fichar` con «Mi cuadrante», y la pantalla | `8-fichar-con-mi-cuadrante-390`, `9-mi-cuadrante-390` |

**Seis cosas las encontró mirar, no un test.** Van con su porqué porque casi todas son decisiones:

1. **«Hoy» enseñaba sólo nombres de pila.** Después de importar, `employees.name` es «ANA» y el
   apellido vive en `last_name`; la pantalla pintaba veintiún nombres de pila en los que dos Anas
   son la misma persona. El registro y el PDF que se le enseña a la Inspección, igual. Ahora los
   tres van con apellidos y ordenados por ellos.
2. **«Sin fichar hoy» sobraba** al lado de «lo previsto y lo fichado» (decisión 3.8).
3. **«462 min de retraso»** obliga a hacer la cuenta. Por encima de hora y media, en horas.
4. **«Mi cuadrante» abría por el día 1.** El 27 de octubre había que recorrer veintiséis días
   pasados para ver qué tocaba mañana, y la pregunta que esa pantalla contesta es «¿qué tengo el
   sábado?». Ahora empieza hoy y dice dónde está lo que pasó.
5. **Publicar con avisos era un `window.confirm`.** El nativo no puede enseñar CUÁLES son, y
   publicar un mes sabiendo que el sábado falta una auxiliar es una decisión que se toma leyendo.
   Ahora es un panel con la cuenta, los dos botones y lo que va a quedar apuntado.
6. **El `?p=` del enlace se perdía al re-entrar en el efecto.** React monta dos veces en desarrollo,
   y la primera entrada quitaba el token de la URL antes de canjearlo: la pantalla decía «este móvil
   todavía no está emparejado» con el canje en vuelo. En producción no pasa —React no re-entra—,
   pero el enlace se destruía antes de usarse, y eso sólo está bien si nadie lo intenta dos veces.
   Ahora se guarda la promesa del canje y las demás entradas la esperan.

Y **una la encontró la medida de toques**: la rejilla se quedaba en blanco si una respuesta venía
sin `celdas` (`comprobarCuadrante` reventaba al recorrer `undefined`). Un `?? d.celdas` en los dos
sitios que repintan.

---

## 7 · Lo medido

| Qué | Cuánto |
|---|---|
| **`comprobarCuadrante` sobre 21 personas × 31 días**, ocho reglas y la ratio encendida | **8 ms en frío, 3 ms en caliente** (mínimo de 5 y de 20 pasadas). Presupuesto del banco: 60 y 10 |
| Lo que costaba antes de memoizar `wallTimeToUtc` | 24 ms · 22 de ellos en `Intl`, convirtiendo las mismas horas 1 302 veces |
| **Toques para pintar un mes de 21 personas** (28 días, rotación M/T/N/libre, pintando por turno: se elige uno y se tocan todas sus celdas de la semana) | **150 la primera semana + 3 para el resto del mes = 153** |
| Lo mismo celda a celda, sin copiar la semana | 591 toques. Copiar la semana ahorra **el 74 %** |
| La rama de `/fichar` del bundle | de 26 kB (8 gzip) a **31 kB (9,3 gzip)** con «Mi cuadrante» dentro |
| Avisos de un mes real de Jardín de Gredos con la rotación de su Excel | 159, de los que 84 incumplen una norma — casi todos de descanso semanal, y **tiene razón**: una rotación de M/T/N/libre deja 24 h seguidas libres y la ley pide 36 |

Las dos primeras están fijadas como presupuesto en `packages/cuadrante/test/medida.test.ts`; la de
los toques, en `apps/admin/test/personal-1-pantallas.test.tsx`, que **pinta y cuenta** sobre la
pantalla de verdad en vez de estimar.

Y lo que la medida de los toques dice de verdad: **la primera semana sigue costando 147 celdas.**
Copiar resuelve el resto del mes, no el principio — y eso es exactamente lo que personal-2 viene a
quitar.

---

## 8 · Qué NO cubre la suite

### 8.1 La ratio de un mes futuro es una estimación

`ocupacionDelMes` cuenta las ocupaciones de cama **vigentes hoy** para los días del futuro: el
cuadrante de noviembre se hace sin saber quién ingresará. Es la cifra buena que hay —suponer cero
plazas diría «cumple» siempre— pero la ratio de un mes que todavía no ha pasado no es la que una
inspección verá.

### 8.2 El descanso semanal en el primer y el último bloque del mes

Lo que hay antes del día 1 y después del día 31 está en **otro cuadrante**, publicado aparte. El
cálculo cierra los dos bordes con el mes mismo, lo que es una cota inferior y puede dar un rojo de
más en el primer o el último bloque. La alternativa era leer dos meses para pintar uno.

### 8.3 El turno partido se PINTA pero no se CREA

El modelo lo admite (una fila por turno), la API lo acepta (`turnoIds` es una lista, y el e2e crea
uno) y la rejilla lo pinta como «M+T». Lo que no hay es forma de crearlo **desde la pantalla**: es
lo que el prompt deja para más adelante.

### 8.4 El bucle visual no prueba el arrastre

La rejilla se pinta arrastrando (`mousedown` + `mouseenter`), y eso lo ejercita el banco con eventos
sueltos. Un arrastre de verdad sobre una pantalla táctil —que es donde esto se va a usar— no lo
prueba nada automático. **Está en los pasos de §11.**

### 8.5 Y una cosa que este bloque CAMBIA sin que se note

**Un centro que guarde un DNI de su plantilla tiene desde ese momento una
`clinical_tenant_keys`**, aunque no tenga clínica. Es cómo clinica-7 diseñó la clave y no es nuevo;
lo nuevo es **a quién le pasa**. Consecuencia: ese tenant ya no se puede eliminar con «Eliminar
cuenta», porque la fila de la clave no se borra nunca (su guard lo prohíbe siempre) y su FK al
tenant es `RESTRICT`.

No se ha arreglado aquí **a propósito**: destruir la clave de un centro es un acto deliberado con su
propia pantalla y su propia decisión (clinica-7), y meterlo en el camino de «Eliminar cuenta» es una
decisión de aquel dominio, no de éste. Va a §13 (duda abierta 2).

---

## 9 · Criterio de hecho, punto por punto

| Criterio del prompt | Cómo se comprueba |
|---|---|
| Tests de tabla de `comprobarCuadrante`, uno por regla y sus bordes | `reglas.test.ts`, 57 casos. Los siete que el prompt nombra van marcados `[prompt]` |
| Noche 22–08 + mañana 08–15 salta; noche + tarde | §4 — la primera salta; la segunda **también**, y está explicado |
| Semana sin día y medio libre | `reglas.test` «[prompt] una semana sin día y medio libre salta» |
| Turno de noche sin cobertura mínima | `reglas.test` «[prompt] un turno de noche sin la cobertura mínima salta» |
| Ratio con 48 ocupadas: 9 jornadas salta, 10 no | `reglas.test` ×2, con la cuenta en milésimas |
| Persona planificada antes de su alta | `reglas.test` «[prompt] … antes de su alta salta» (y el borde: el día del alta, no) |
| Horas de más sobre jornada contratada | `reglas.test` «[prompt] horas de MÁS … por semana» |
| Los tests de `esSalidaOlvidada` y los e2e de #45 siguen verdes **sin tocarlos** | `f3-fichaje-tiempo` (21), `f3-fichar.e2e`, `f4-panel.e2e`, `f8-colegio.e2e` — ni una línea tocada |
| Entrada 08:00 + turno M, nada a las 19:01 → olvidada | `personal-1-salida-olvidada` «[prompt] …», y el e2e con el cuadrante publicado de verdad |
| La misma sin turno → no olvidada hasta las 16 h | ídem, en el mismo test |
| Entrada 22:00 + turno N, salida 07:58 → se cierra | ídem ×2 |
| La noche del cambio de hora cuenta 11 h en el export y en planificado vs fichado | `personal-1.e2e` «[prompt] … ONCE horas», que mira `plannedMinutes`, `totalMinutes` y el CSV |
| Importar: 21 sobre 21 → completa 21, crea 0 | `personal-1.e2e` y `importar.test`, los dos |
| Repetir → 0 cambios | ídem |
| Una celda vacía no borra | ídem |
| Fila con `2026-10-01` → error de fila legible | ídem, con el mensaje entero afirmado |
| BOM y `;` funcionan | ídem |
| Nueve sabotajes | §5, trece roturas ejecutadas |
| Medido: toques y tiempo de `comprobarCuadrante` | §7 |
| Capturas a 390 y escritorio en `docs/qa/` | §6, 17 |
| CI verde (`ci`, `smoke`, `e2e`) | el PR, §15 |

---

## 10 · Al desplegar

**Las dos migraciones viajan juntas y sin ventana.**

- `20261027000000_personal_1_ficha` añade columnas **nullable** a `employees` y a `center_shifts`,
  una columna `NOT NULL DEFAULT 4` a `tenants` —desde PG 11 eso no reescribe la tabla— y crea dos
  tablas vacías. No toca ni una fila.
- `20261027010000_personal_1_cuadrante` sólo crea objetos nuevos: tres tablas vacías, tres enums,
  seis funciones y cuatro triggers que cuelgan de tablas que nacen ahí.

Comprobadas ejecutándolas contra Postgres real desde cero y con los 52 ficheros de e2e después.
**Deriva de Prisma sobre lo nuevo: cero** (`migrate diff` sólo devuelve el residuo que master ya
traía: FKs que Prisma reescribiría con `ON UPDATE CASCADE` e índices que renombraría).

**El orden lo garantiza el timestamp**: la ficha antes que el cuadrante (`staff_schedule_cells`
apunta a `employees` y a `center_shifts`).

**Lo que hay que hacer además:**

1. **Nada en ningún tenant.** Los defaults son los que resuelven el caso: 4 h de margen, 0,20 de
   ratio, 12 y 36 h de descanso, 15 min de tolerancia. Un centro que quiera otra cosa la cambia en
   «Reglas del cuadrante».
2. **`CLINICAL_KEK` tiene que estar.** Ya está en el compose de producción desde residencia-1b. Sin
   ella, guardar un DNI de personal contesta **503 `CIFRADO_NO_DISPONIBLE`** con una frase —nunca se
   guarda en claro— y el resto de la ficha se guarda igual.
3. Ni Caddy, ni variables nuevas, ni contenedor nuevo. El `Dockerfile` ya copia el manifest del
   paquete nuevo (lo cazó `infra/test/dockerfile-manifiestos.test.ts`, cuatro de cuatro).
4. **Rollback:** revertir el código basta mientras no haya cuadrantes publicados ni DNI guardados.
   Los dos `down` están escritos en la cabecera de cada migración y **fallan con un mensaje** si los
   hay: bajar la ficha con DNI dentro es borrar el único sitio donde viven.

### 10.1 La base del e2e

Se usó `mipiacetpv_personal1_e2e`, propia de esta sesión, y `mipiacetpv_personal1_qa` para las
capturas. Las dos se borran al cerrar:

```
docker exec -i mipiacetpv-postgres psql -U mipiacetpv -d postgres \
  -c "DROP DATABASE IF EXISTS mipiacetpv_personal1_e2e;" \
  -c "DROP DATABASE IF EXISTS mipiacetpv_personal1_qa;" \
  -c "DROP DATABASE IF EXISTS mipiacetpv_personal1_mig;"
```

---

## 11 · Encender el cuadrante en Jardín de Gredos

1. **Empleados → Personal.** Están las 21 fichas que F1 creó, cada una con su etiqueta de lo que le
   falta y el filtro «sólo incompletas» puesto.
2. **Importar.** Exportar el Excel del centro a CSV (separador `;`, fechas `dd/mm/aaaa`), pegarlo o
   subirlo y **mirar la vista previa**: tiene que decir «completa la ficha de X» 21 veces y «crea»
   cero. Si dice «crea», el nombre del fichero no casa con el de la ficha y hay que mirarlo antes de
   aplicar.
3. **Categorías.** Repasar cuáles cuentan como atención directa: de serie van las cinco que están
   con la persona. Lo que cada acreditación cuente puede ser otra cosa.
4. **Reglas del cuadrante** (Ajustes → Reglas): confirmar la ratio (0,20 es Castilla-La Mancha) y
   **poner la cobertura mínima de cada turno**. En blanco no es cero: es «no lo he declarado», y
   entonces esa regla no se evalúa.
5. **Cuadrante → el mes que viene.** Pintar la primera semana y copiar. Los avisos se pintan solos.
6. **Publicar.** Si hay avisos, se lee el panel y se decide: publicar con avisos está bien, y queda
   apuntado.
7. **Que la gente lo vea**: ya lo ve, en `/fichar` → «Mi cuadrante». No hace falta enlace nuevo.
8. **Las dos comprobaciones del día 1, a mano**, que son las que la suite no cubre (§8):
   - **pintar un mes arrastrando en la tablet** del despacho, no con el ratón;
   - y **dejar un turno de noche sin cerrar** a propósito: a las 12:00 del día siguiente tiene que
     salir en «Hoy» como «sigue dentro pasada su hora», no a las 14:00.

---

## 12 · Qué necesita personal-2 de este bloque

Lo que la IA del cuadrante va a usar, y está hecho:

1. **`comprobarCuadrante(cuadrante, reglas)`** es la pieza. Pura, determinista y con 57 tests de
   tabla. Un generador sin validador inventa cuadrantes ilegales con buena cara: lo que genere se
   valida con **la misma función** que la pantalla pinta y que el servidor guarda al publicar.
2. **`StaffScheduleOrigin.GENERADO` ya existe** en el enum, y nada lo escribe todavía. personal-2
   escribe borradores con ese origen y **una persona los publica igual**: el camino de publicación
   no cambia.
3. **El dato que la IA necesita leer ya está**: la jornada contratada de cada persona, su categoría
   y si cuenta como atención directa, sus fechas de alta y fin, los turnos con su cobertura mínima,
   las plazas ocupadas por día y los parámetros de las reglas. Todo en `cargarCuadrante`.
4. **`set_staff_schedule_day` es la única vía** y acepta un día entero de una persona. Un generador
   escribe 651 llamadas dentro de una transacción; el motor valida cada una.
5. **Lo que personal-2 tendrá que decidir y aquí no se ha decidido**: qué hace la IA con un mes que
   ya está publicado (¿propone cambios con motivo, o sólo genera borradores?), y si el origen
   `GENERADO` tiene que sobrevivir a que una persona toque una celda.

---

## 13 · Dudas abiertas

1. **Una persona con ficha y con usuario tiene su nombre en dos sitios** (`employees.name` y
   `users.alias`), y nada los sincroniza. Hoy no muerde porque la ficha manda en todo lo de personal
   y el alias en todo lo del panel. El día que alguien cambie uno y no el otro, dos pantallas dirán
   dos nombres. Decisión 1 dice que no se fusione en este bloque; esto es lo que queda vivo.
2. **La cuenta de un centro con DNI de personal guardados no se puede eliminar** (§8.5). Necesita
   una decisión de clinica-7: o «Eliminar cuenta» destruye la clave por el camino, o la pantalla de
   eliminación pide destruirla antes.
3. **El convenio colectivo no está** y es deliberado: sus límites entran como parámetros cuando
   Matías los confirme. Hoy el único que se puede ajustar es el descanso diario.
4. **`residencia-6-ilegible` cuenta 26 columnas cifradas y `cripto-campos.ts` tiene 32.** Faltan las
   **seis de calidad-1**, que aquel bloque añadió al inventario del SQL y no al del hueco marcado.
   No es de este bloque —personal-1 ha añadido las suyas a los dos— pero está medido y conviene que
   alguien lo cierre.
5. **La rejilla de 31 días no cabe en un portátil** al lado de la barra lateral: se desplaza en
   horizontal con la columna de nombres pegada. En una tablet apaisada entra; en una de 10" no. Si
   molesta, lo que hay que decidir es si la celda baja de 36 px —y deja de ser cómoda al tacto— o si
   la rejilla se parte por semanas.

---

## 14 · Commits

| Hash | Frente |
|---|---|
| `045954a` | Frente 0 · el plan, con lo medido antes de escribir código |
| `c2ea06e` | F1 · las dos migraciones |
| `eec5039` | F2 · `packages/cuadrante` |
| `8cbf263` | F3-F5 · la API de la ficha, la importación, el cuadrante y la salida olvidada |
| `391f797` | El manifest del paquete nuevo en el Dockerfile |
| `9a18c8e` | F6-F7 · el panel y «Mi cuadrante» en el móvil |
| `6a31137` | F8 · el e2e contra Postgres real |
| `d5634d4` | El bucle visual · 17 capturas y cinco arreglos |
| `a4d935f` | el done, y la medida de los toques |

## 15 · La rama

Rama `personal-1`, pusheada, con **PR #50 contra `master`**. Ni merges ni despliegues: el merge lo
hace Matías cuando la CI del PR esté verde.
