# Bloque residencia-2 · done

Rama `residencia-2`, worktree `~/Developer/Claude/Projects/mipiacetpv-residencia-2`, desde
`origin/residencia-1` = `c4943e5` (el PR **#21**, aún sin mergear). Ocho commits, 54 ficheros,
+13.755 / −137.

**Este bloque no construye la pantalla de la puerta ni registra nada.** Construye **qué se registra,
a quién y cuándo**. La pantalla donde el personal apunta a pulsaciones es residencia-3, y lo único
que tendrá que hacer con el plan es llamar a `queToca`.

---

## 1 · El catálogo es dato, y es GLOBAL

`ControlType` (D-11). Una fila = «una cosa que se registra de un residente», con todo lo que hace
falta para pintarla, validarla, agendarla y contarla. Dar de alta un control nuevo en 2028 es un
INSERT, no un despliegue: ésa es la decisión entera.

### Global y versionado, al revés que `CareRole`

Lo de serie (`scope = STANDARD`) tiene `tenantId` NULL y **lo ven todos los centros**. Cuando cambia
una guía clínica se actualiza en el producto y baja a todos a la vez (D-21, D-57).

Es justo lo contrario que `CareRole`, que residencia-1 sembró por tenant (§4 de su done), y la
diferencia es **quién tiene que poder cambiarlo**: que un centro llame «gerocultora» a la auxiliar es
suyo y no le interesa a nadie más; que la prevención de úlceras pase de tres horas a dos tiene que
llegar a los cinco centros sin un backfill.

Lo que se paga por esa decisión está en §3: la clave del ajuste del centro deja de poder ser una FK.

### Una versión usada NO se edita

Se crea la siguiente con su `validFrom` y se le pone `supersededAt` a la anterior. Lo registrado
seguirá apuntando a la versión con la que se registró (residencia-3 guardará `controlTypeId`, no el
código), así que «¿qué rango de referencia tenía la temperatura cuando se apuntó esto?» se puede
contestar tres años después — que es lo que una auditoría pregunta.

Si alguien edita un texto del fichero de datos sin subir la versión, el seed **no lo propaga** y lo
dice en el log del arranque.

### «Una sola versión vigente por código» son DOS índices parciales

```sql
CREATE UNIQUE INDEX "control_types_una_vigente_estandar_key"
    ON "control_types"("code")             WHERE "superseded_at" IS NULL AND "scope" = 'STANDARD';
CREATE UNIQUE INDEX "control_types_una_vigente_centro_key"
    ON "control_types"("tenant_id", "code") WHERE "superseded_at" IS NULL AND "scope" = 'CENTER';
```

Un único índice sobre `(scope, tenant_id, code)` **no dice eso**: `tenant_id` es NULL en todos los de
serie, los NULL son distintos entre sí, y las dos versiones vigentes de `TEMPERATURA` serían dos
claves distintas. Nadie lo notaría hasta que la puerta pidiera la temperatura con dos rangos de
referencia.

Es la **tercera vez** que esta lección se paga en este repo (`ticket_allergies_mesa_key` en kds-1,
`care_zone_assignments_one_live_centro_key` en residencia-1). Aquí está pagada de entrada, con su
sabotaje con nombre en el e2e. Y lo mismo para «una fila por (código, versión)», que también son dos.

### Y el CHECK de alcance, con su mitad menos obvia

```sql
CHECK (("scope" = 'STANDARD' AND "tenant_id" IS NULL)
    OR ("scope" = 'CENTER'   AND "tenant_id" IS NOT NULL))
```

La segunda mitad es la que sostiene el índice de arriba: un `CENTER` sin tenant se saldría del índice
parcial —otra vez los NULL— y podría haber dos vigentes del mismo código en el mismo centro. Misma
forma y misma razón que `devices_register_o_habitacion` en residencia-1.

---

## 2 · Las tres decisiones del catálogo de serie

36 controles: 22 `EXEC`, 7 `OBS`, 7 `MEASURE`. `SCALE` (Barthel, Lobo, Tinetti, Norton) es Fase 2 y
`EVENT` es residencia-4: los dos están en el enum desde ya para que el día que se siembren no haga
falta una migración de tipo — la factura que residencia-1 pagó.

### La tensión son DOS controles y no uno compuesto

El prompt dejaba elegir. Son `TA_SISTOLICA` y `TA_DIASTOLICA` con el mismo `groupCode = "TA"`, y las
tres razones en orden de peso:

1. **Los umbrales de residencia-4 son por valor.** La plantilla de gravedad de D-56 dice «TA
   sistólica ≥ 180 o ≤ 90» y no menciona la diastólica. Con un control compuesto, ese umbral tendría
   que saber de qué mitad del valor habla, y `ClinicalThreshold` pasaría de ser una fila a ser una
   fila con un selector.
2. **`NUMERIC` tiene UNA unidad y UN rango.** Las dos mitades comparten unidad pero no rango de
   referencia (90–139 y 60–89), y meterlas en una fila obliga a inventar `refMin2`/`refMax2`, que es
   la clase de columna que luego nadie sabe si rellenar.
3. **El indicador las cuenta por separado.** «Cuántas tomas con sistólica fuera de rango» es la
   pregunta de AENOR.

Lo que se pierde —que la pantalla abra el teclado dos veces— se arregla donde toca: `groupCode` dice
que se piden juntas, y la puerta de residencia-3 pintará «120 / 80» en un paso.

### La higiene son DOS, y por una razón de modelo

El prompt pide «higiene personal (a demanda + base programada)», y eso no cabe en una fila: `nature`
es un valor y no dos. `HIGIENE_PERSONAL` es `SCHEDULED` (el aseo de la mañana: se cumple o se
incumple) y `HIGIENE_EXTRA` es `ON_DEMAND` (se ha manchado: sólo se cuenta). Con una sola fila habría
que elegir entre que el aseo de la mañana no se pueda incumplir o que cada cambio de ropa de más sea
un incumplimiento.

### Las comidas NO llevan «como siempre»

Las siete dimensiones `OBS` sí (D-16, D-59): cada una declara cuál es su valor «como siempre», y como
mucho una, por índice parcial. Las cuatro comidas **no**, a propósito: «todo» no es «como siempre»,
es «hoy se lo comió todo». El atajo de D-16 vale para una OBSERVACIÓN («¿cómo está hoy?») y no para
una EJECUCIÓN («¿qué comió?»). Si lo llevaran, la ingesta del centro entero saldría «todo» cada día y
el indicador de nutrición no valdría nada.

### De dónde sale el vocabulario

D-59 cierra que el de ánimo y cognición es «el propuesto en la rama de controles». Esa rama
(`rama-catalogo-de-controles.md`) vive en el proyecto «Jardin de Gredos» y no está en este repo;
**Matías trajo su §4 el 15-10 y las dos dimensiones son ya literalmente las suyas** — lo que había
antes era criterio nuestro y difería. Qué cambió y por qué, en §11.5.

Las otras cinco dimensiones —dolor, descanso nocturno, piel, ingesta del día y
movilidad/estabilidad— **no tenían vocabulario en la rama**. Lo que llevan es **propuesta de
producto, pendiente de validar por la médica y por las auxiliares**. No bloquea: es dato.

---

## 3 · La frontera estándar / centro

`CenterControlSetting`. Aquí vive **todo** lo que un centro puede tocar y nada más: si lo activa, el
alias de su glosario, la frecuencia por defecto, quién lo registra y si lo ve la familia (D-60,
interno por defecto).

### La clave es el CÓDIGO, no el id de la versión

`(tenantId, controlCode)`, y es la decisión de la tabla: **una versión nueva de un control conserva
el ajuste del centro**. Con `controlTypeId`, cada actualización del catálogo clínico dejaría a los
cinco centros con sus ajustes huérfanos y la DUE tendría que volver a decir que la medicación la da
ella.

De ahí sale una regla que la ruta vigila: **un control propio no puede llevar el código de uno de
serie** (409). Si pudiera, `(tenantId, code)` no sabría de cuál de los dos es el ajuste.

### Y cuando la versión nueva deja el ajuste inválido: se reconduce Y SE ANOTA

El seed lo hace en la misma transacción que publica la versión:

- **la frecuencia**, si la nueva versión la retira de `allowedFrequencies` → se pone la de serie;
- **los roles**, si retira alguno → se **quitan los que ya no valen y se conservan los que sí**. El
  centro había estrechado la lista a propósito, y devolverla entera a la de serie sería ensancharla,
  que es justo lo que la frontera prohíbe. Si el estrechamiento se queda sin ninguno, se vuelve a la
  de serie: un control que no puede registrar nadie es un control que no se registra, y eso sí es
  peor que ensanchar.

Y queda anotado (`reconductedAt`, `reconductedFromVersion`, `reconductedReason`), que es la mitad de
la decisión: **reconducir en silencio es cambiar el plan de 49 personas sin decírselo a nadie**. La
pantalla lo pinta arriba, en ámbar, y el aviso se va cuando el centro vuelve a elegir.

### Las tres reglas que cruzan dos tablas viven en la ruta

Como el requisito de colegiado de residencia-1, y por lo mismo: no caben en un CHECK.

- la frecuencia del centro, dentro de `allowedFrequencies` de la versión vigente (400 con la lista);
- los roles, subconjunto de `allowedCareRoleCodes` **y** existentes y activos en ESE centro;
- los turnos y momentos que la frecuencia nombra, que existan — porque `queToca` no inventa otro:
  devuelve cero ocurrencias, y un control que no toca nunca es un cuidado que nadie hace y nadie echa
  en falta.

---

## 4 · La frecuencia · columnas y no JSON

Ocho formas (`CareFrequencyKind`), cada una una rama de `queToca`. Los parámetros van en **siete
columnas explícitas** en las cuatro tablas que llevan frecuencia, y no en un `Json`.

La razón es la regla de la casa, escrita en `Store.kitchenGreenMaxMin` (kds-1): **esto tiene que
poder llevar CHECK en la base, y un JSON no puede**. Qué columnas exige cada `kind` lo garantiza
`…_frecuencia_coherente`, y no la ruta que escribe: un `EVERY_N_HOURS` sin horas es una línea de plan
que la puerta leería y no sabría cuándo pedir.

Y porque `queToca` lo recorre en bucle por residente y por línea: un parse por línea sería trabajo
por nada, y una forma que la base no garantiza obliga a la función pura a defenderse de datos
imposibles.

### El `CASE` se escribe cuatro veces, y es a propósito

Un CHECK con una función de usuario no se valida al restaurar un `pg_dump` en el orden en que
Postgres restaura. Lo que lo sostiene es un test: cada uno de los ocho `kind` tiene que aparecer
**exactamente cuatro veces** en el SQL. Si alguien añade un valor al enum y se olvida de una tabla,
el `CASE` de esa tabla devuelve NULL y **el CHECK pasa** — el fallo más silencioso posible.

### Los dos topes que son decisiones, no validación

- `every_n_hours` entre **1 y 12**: menos de una hora no es un cuidado, es vigilancia continua (y eso
  no es este producto); más de doce es «una vez al día», que ya tiene su `kind`.
- `month_day` entre **1 y 28**, no 31: un control mensual con día 31 no tocaría en febrero, abril,
  junio, septiembre ni noviembre, **y nadie lo notaría hasta la auditoría**.

---

## 5 · `queToca`, y el paquete puro

`packages/residencia-plan`. Sin base de datos y sin reloj: todo entra por parámetro, incluida la
ventana. Tres cosas que compra:

1. Los tests son una **tabla de verdad** y no una maqueta de Prisma.
2. La tablet la podrá ejecutar **sin red** en residencia-3, que es la mitad del ADR-01.
3. Se puede llamar para AYER sin tocar nada: «¿qué le tocaba a doña Carmen el 3 de marzo?» es la
   misma llamada con otra ventana. La vista «hoy» acepta `?dia=`.

### Instante o FRANJA, y la diferencia es real

Las frecuencias que cuelgan de un turno son una **franja** («durante la mañana»): nadie pide la
hidratación cutánea a las 08:00 en punto. Las que cuelgan de un momento o de un reloj son un
**instante**: la medicación del desayuno es a la hora del desayuno. Pintarlas igual sería decirle a
la auxiliar que la hidratación cutánea se ha incumplido a las 08:01, y la pantalla las distingue.

### Los dos anclajes, que son opuestos a propósito

- **`EVERY_N_HOURS` va anclado a MEDIANOCHE** de pared y no al inicio de la línea. La razón es de
  planta: una auxiliar de noche lleva ocho residentes, y si cada uno tuviera su ancla tendría
  dieciséis avisos a dieciséis horas distintas en vez de ocho rondas. Ancladas a medianoche, la
  planta entera se gira a la misma hora y el parte de relevo se lee de un golpe.
  *Consecuencia dicha*: si N no divide a 24, el último hueco del día es más corto. La pantalla sólo
  ofrece divisores (2, 3, 4, 6, 8, 12).
- **`EVERY_N_DAYS` va anclado al INICIO DE LA LÍNEA.** «Una analítica cada seis meses» se cuenta
  desde la última. Anclarlo al calendario haría que a un residente que ingresa en marzo se le pidiera
  la analítica en abril «porque es cuando le toca al centro».

### El barrido empieza un día ANTES

El turno de noche del día anterior llega hasta las 08:00 de hoy. Si el barrido empezara en el primer
día de la ventana, la madrugada entera se quedaría sin lo que le toca — otra vez el tramo en que una
residencia está más sola. Barrer de más es gratis porque el filtro final descarta; barrer de menos no
se ve.

### Y lo que encontró el test, no el pensarlo

**El 29 de marzo las 02:00 y las 03:00 de pared resuelven al MISMO instante.** Ese día el reloj salta
de 01:59 a 03:00: las 02:00 no existen, y `wallTimeToUtc` las lleva al primer instante real, que es
al que también llegan las 03:00. Con un control horario eso daba **dos rondas idénticas a las tres de
la mañana**. Se quitan las repetidas: un día de 23 horas tiene 23 rondas, ni 24 ni 22. Y el 25 de
octubre, 24 — la hora repetida se gira una vez, no dos.

### La hora de pared es una COPIA declarada

`tiempo.ts` copia cinco funciones de `apps/api/src/agenda/time.ts`. Un paquete no puede importar de
una app, y mover las primitivas aquí pondría a un paquete llamado `residencia-plan` como dueño del
huso del motor de citas — una propiedad que no le toca. Es el mismo criterio con el que residencia-1
duplicó `turnoDe` en la tablet (§7 de su done): dos copias de cinco líneas, las dos testeadas, en vez
de una dependencia que invierte la propiedad. El acuerdo lo fijan tests en los dos días del cambio de
hora, que es el único sitio donde dos implementaciones pueden discrepar.

Lo que **no** se duplica: `turnoDe`. Se **movió** aquí y `apps/api/src/residencia/turnos.ts` la
re-exporta. Una copia menos, no una más, y ningún sitio que importaba de allí cambia una línea.

---

## 6 · El plan de un residente

`CarePlanItem`. Una fila = «a esta persona le toca este control con esta frecuencia, desde este día».

### Una línea no se borra NI SE EDITA: se CIERRA

Dos razones, y la segunda es la que manda:

1. «¿Qué le tocaba a doña Carmen el 3 de marzo?» es una pregunta que una residencia tiene que poder
   contestar a una familia, a la Consejería o a un juzgado. Con líneas editables, la respuesta sería
   siempre la de hoy.
2. **Por eso la frecuencia está materializada en la línea** y no se hereda del ajuste del centro: si
   se heredara, cambiar hoy el defecto del centro reescribiría el plan de los últimos tres años.

La línea se crea copiando la frecuencia que el centro tenía puesta en ese momento, y cambiarle la
frecuencia es **cerrar una y abrir otra**, en la misma transacción y en ese orden — exactamente como
cambiar de habitación en `BedAssignment`. Lo único mutable es `toAt` y su motivo.

Y **guardar dos veces lo mismo no abre una línea idéntica** (ni aunque los turnos lleguen en otro
orden: se comparan como conjunto). Sin eso, abrir el panel y dar a guardar sin tocar nada ensuciaría
el histórico y el plan de ayer dejaría de parecerse al de hoy.

### Una línea viva por (residente, control), y el histórico cabe

Índice parcial `WHERE to_at IS NULL`. Dos líneas vivas del mismo control son dos respuestas a «¿cada
cuánto se le cambia de postura?», y la puerta tendría que elegir. Parcial es lo que permite que doña
Carmen tenga cinco filas cerradas (cada 4 h, luego 3, luego 2) y una viva: con un índice total eso no
sería «menos correcto», sería **imposible**, y el plan de marzo irreconstruible. Misma lección que
`bed_assignments_one_live_per_client_key`.

### El cambio de nivel, y la promesa que sostiene

Al dar de alta a un residente se le aplica la plantilla de su nivel **en la misma transacción** que
el perfil y la cama: si se abriera después, un fallo dejaría a un residente sin plan y eso no se ve
hasta el primer turno, cuando la puerta no pide nada. `fromAt` es la fecha de INGRESO, así que
`queToca` no le pide nada de antes de llegar.

Al cambiarle el nivel: se cierran las líneas de plantilla del nivel anterior que no están en la
nueva, las que cambian de frecuencia se cierran y se reabren, se abren las que faltan, y **las
manuales no se tocan**. Nunca, ni aunque la plantilla nueva traiga el mismo control con otra
frecuencia: si la DUE puso a doña Carmen cambios posturales cada 2 h a mano y luego sube a
dependiente (cuya plantilla dice 3 h), se queda con los de 2 h. **La DUE lo decidió mirando a la
señora; la plantilla es un valor por defecto para quien no ha mirado todavía.**

Lo que lo sostiene en el motor es el CHECK `care_plan_items_origen_coherente`: `source_level` existe
si y sólo si la línea la puso una plantilla. Sin su segunda mitad, una línea `MANUAL` con nivel
puesto a mano la cerraría el recálculo.

Y **tocar una línea a mano la vuelve `MANUAL`**, aunque la hubiera puesto la plantilla: en cuanto
alguien la toca, el recálculo no la cerrará nunca.

Dar de alta a quien se va **cierra su plan**, como cierra su cama. Si no, la puerta seguiría pidiendo
el cambio postural de alguien que ya no vive aquí y el panel lo contaría como incumplido todos los
turnos.

### Guardar una plantilla NO recalcula los planes abiertos

Es una decisión y la pantalla la dice. Una plantilla es lo que se aplica a los ingresos y a los
cambios de nivel **de ahí en adelante**. Si recalculara los 49 planes, la dirección movería una
casilla y cerraría líneas que la DUE puso a mano hace un mes.

Y por eso la plantilla **sí se borra y se reescribe** al guardar, al revés que una línea de plan: una
plantilla es CONFIGURACIÓN (como un turno o una habitación) y una línea de plan es parte de la
historia de una persona. Nadie tiene que poder reconstruir «qué decía la plantilla del semiasistido
en marzo»; lo que sí hay que poder reconstruir es qué le tocaba a doña Carmen.

---

## 7 · Los permisos

Alcance §7, y son **dos reglas y no una**:

- **Catálogo, ajustes del centro, momentos y plantillas: `requireOwner`** para escribir,
  `requireOwnerOrManager` para leer. Mismo criterio exacto que los roles y las zonas de residencia-1
  (decisión 6 de su done): esto decide **qué se registra de la salud de una persona**, que es la
  misma clase de decisión que `PATCH /staff/:id/clinica`. El encargado lee.
- **El plan de un residente**: el OWNER y los roles de cuidado con categoría `SUPERVISOR` o
  `DIRECTIVO` y los de alcance total (DUE, médico, calidad). El MANAGER **no entra por ser manager**:
  el encargado del bar de un centro mixto no tiene por qué decidir cada cuánto se gira a doña Carmen.
  Si además es la DUE, entra por su rol de cuidado — que es la vía que firma lo que decide con su
  capacidad (D-31).

Y el plan **pasa por `conHistoria`**: el plan de cuidados de alguien ES un dato de salud —dice que
tiene riesgo de úlceras y que no se levanta solo—, y que lo diga una línea de plan en vez de un
diagnóstico no lo hace menos. Cada lectura y cada escritura dejan su línea en `clinical_access_log`.

De ahí sale una consecuencia heredada y correcta: **el OWNER sin rol de cuidado NO ve el plan**, igual
que no ve la ficha (decisión 7 de residencia-1). Quien dirige el centro lleva el rol `DIRECCION`.

El catálogo, en cambio, **no pasa por `conHistoria`**: lo que devuelve es el catálogo del centro, no
la salud de nadie, y no hay un `clientId` en ninguna respuesta. Es la decisión 2 de residencia-1
aplicada aquí.

---

## 8 · Las pantallas

Tres, envueltas en `<ResidenciaGate>` y sin `<CajaGate>`, como las de residencia-1.

- **Controles** · el catálogo por capas, con la explicación de cada capa («¿Se hizo?», «¿Cómo está
  hoy?») porque «capa de ejecución» no significa nada para nadie. Lo del producto se pinta ARRIBA y
  como dato, no como campo: así la dirección ve **por qué** no puede cambiar el rango de la
  temperatura sin tener que probar a cambiarlo. El aviso de lo reconducido va el primero de la
  pantalla, porque es lo único que pasó sin que nadie lo pidiera.
- **Plantillas por nivel** · los tres a la vez en tres columnas, porque la pregunta es comparativa:
  «¿qué lleva un dependiente que no lleva un semiasistido?». A 320 se apilan y cada una se lee
  entera.
- **Plan del residente** · se llega desde su ficha y tiene pantalla propia: veinte líneas en cuatro
  grupos más la vista de «hoy» dentro de un modal, a 320 px, es un scroll que no acaba. Arriba, lo
  que `queToca` dice que le toca hoy, turno por turno — **la prueba de que el plan está bien antes de
  que la puerta exista**.

El selector de frecuencia vive aparte y lo usan las tres: una frecuencia mal construida es un 400 del
servidor, y tres copias darían tres formas distintas de equivocarse. No se teclea nada salvo «cada N
días» y el día del mes. Y **sólo ofrece lo que `puedeElegir` dice**, que viene de la API: el día que
una guía retire una frecuencia, el botón desaparece sin desplegar el panel.

### Un arreglo que salió de mirar la captura

En el plan, una línea de «cada turno» cae en los tres grupos, así que la lista tiene más filas que
líneas tiene el plan y quien las cuente creerá que sobran. Se dice en una línea. Agrupar por turno no
se toca: es lo que la auxiliar de la tarde necesita.

---

## 9 · La tabla de sabotajes

| Garantía | Qué línea de producción se rompe | Qué se pone rojo | Mensaje real |
| -------- | -------------------------------- | ---------------- | ------------ |
| **El centro no toca lo de serie** | Quitar `preValidation: soloLoDelCentro` del PATCH | `residencia-controles.test.ts` · «un campo del producto en el cuerpo → 400» | `expected 200 to be 400` |
| **…ni ensancha la frecuencia** | Quitar el `if (!control.allowedFrequencies.includes(...))` | controles · «UNA FRECUENCIA QUE EL PRODUCTO NO PERMITE → 400» | `expected 200 to be 400` |
| **…ni los roles** | Quitar el `const sobran = …` de los roles | controles · «UN ROL QUE EL PRODUCTO NO PERMITE → 400» | `expected 200 to be 400` |
| **…ni versiona un control de serie** | Quitar el `if (vigente.scope === "STANDARD")` | controles · «un control de serie NO se versiona desde el centro → 403» | `expected 201 to be 403` |
| **Un control propio no roba un código de serie** | Quitar el 409 `CODIGO_DE_SERIE` | controles · «EL CÓDIGO DE UNO DE SERIE NO SE PUEDE REUSAR» | `expected 201 to be 409` |
| **Un control propio no sale en otro centro** | — (lo decide la columna `tenant_id`) | `residencia-2.e2e.ts` · «UN CONTROL PROPIO NO SALE EN OTRO CENTRO» | `expected 1 to be 0` |
| **Un `STANDARD` no tiene centro** | Quitar la primera mitad del CHECK de alcance | e2e · «un `STANDARD` CON tenant → rechazado» | `new row … violates check constraint "control_types_scope_exige_tenant"` |
| **…y un `CENTER` sí** | Quitar la SEGUNDA mitad | e2e · «SABOTAJE · un `CENTER` SIN tenant → rechazado» | `…"control_types_scope_exige_tenant"` |
| **Una sola versión vigente (serie)** | Quitar `AND "scope" = 'STANDARD'` del índice, o el índice | e2e · «DOS VIGENTES de un control DE SERIE → rechazado» | `Key (code)=(E2E_DOS) already exists.` |
| **…y del centro** | Lo mismo en `…_una_vigente_centro_key` | e2e · «DOS VIGENTES de un control DEL CENTRO → rechazado» | `Key (tenant_id, code)=(…) already exists.` |
| **…y el histórico cabe** | Hacer esos índices TOTALES | e2e · «jubilar la anterior deja entrar la siguiente» | `Key (code)=(…) already exists.` |
| **`EVERY_N_HOURS` sin horas no entra** | Quitar el `IS NOT NULL` del CHECK | e2e · «`EVERY_N_HOURS` SIN HORAS → rechazado» | `…violates check constraint "control_types_frecuencia_coherente"` |
| **Un mensual del día 31 tampoco** | `BETWEEN 1 AND 28` → `31` | e2e · «`MONTHLY` el día 31 → rechazado» | `…"control_types_frecuencia_coherente"` |
| **«A demanda» no lleva turnos** | Quitar la rama `WHEN 'ON_DEMAND'` | e2e · ««a demanda» CON TURNOS puestos → rechazado» | `…"center_control_settings_frecuencia_coherente"` |
| **«Una vez al día» es UNA** | `cardinality(...) = 1` → `> 0` | e2e · «`DAILY` con DOS turnos → rechazado» | `…"care_plan_items_frecuencia_coherente"` |
| **Un «como siempre» por control** | Quitar `control_type_options_un_como_siempre_key` | e2e · «DOS opciones marcadas → rechazado» | `Key (control_type_id)=(…) already exists.` |
| **Una línea viva por (residente, control)** | Quitar `WHERE to_at IS NULL` (o el índice) | e2e · «DOS LÍNEAS VIVAS del mismo control → rechazado» | `Key (client_id, control_code)=(…) already exists.` |
| **…y una línea CERRADA no se borra** | Hacer ese índice TOTAL | e2e · «tres cerradas y una viva» | `Key (client_id, control_code)=(…) already exists.` |
| **Lo manual sobrevive al cambio de nivel** | Quitar `if (viva.source === "MANUAL") continue` de `plan.ts` | `residencia-plan.test.ts` · «LA LÍNEA MANUAL SOBREVIVE» | `expected [ 'turnos M+T' ] to contain [ 'turnos M+T+N' ]` |
| **…y el motor no admite una manual con nivel** | Quitar `care_plan_items_origen_coherente` | e2e · «una línea MANUAL con nivel puesto → rechazado» | `…violates check constraint "care_plan_items_origen_coherente"` |
| **Un control desactivado no «toca»** | `apagados` → `new Set()` en `queToca` | `que-toca.test.ts` · «un control DESACTIVADO en el centro no «toca»» + controles · «UN CONTROL DESACTIVADO EN EL CENTRO no sale» | `expected [ {…} ] to deeply equal []` |
| **La noche cruza medianoche** | `minutos >= inicio \|\| minutos < fin` → `&&` | `residencia-turnos.test.ts` · «LAS 02:30 SON DE LA NOCHE» | `expected undefined to be 'N'` |
| **La ronda de las 02:00 del 29-M no se pierde** | Quitar el refinamiento de `wallTimeToUtc` | `tiempo.test.ts` · «la hora que NO EXISTE resuelve a un instante real» | `expected true to be false` (NaN) |
| **…y no se duplica** | Quitar el deduplicado de `queToca` | `que-toca.test.ts` · «cada HORA da 23 rondas y NINGUNA repetida» | `expected 24 to be 23` |
| **Un residente con plan no se borra** | `RESTRICT` → `CASCADE` en `care_plan_items_client_id_fkey` | e2e · «la FK DEL PLAN sola también lo impide» | `update or delete on table "clients" violates foreign key constraint "care_plan_items_client_id_fkey"` |
| **…ni con el tenant** | Lo mismo en `…_tenant_id_fkey` | e2e · «ni con el tenant» | `…violates foreign key constraint` |
| **El plan es de supervisión** | `puedeTocarElPlan` → `return null` | controles · «LA AUXILIAR NO LO TOCA» | `expected 200 to be 403` |
| **…y deja línea en el registro de accesos** | Quitar el `conHistoria` de `GET …/plan` | controles · «LEER EL PLAN DEJA SU LÍNEA» | `expected [] to have a length of 1` |
| **Escribir el catálogo es del OWNER** | `requireOwner` → `requireOwnerOrManager` | controles · «…y NO lo cambia · 403» | `expected 200 to be 403` |
| **Una versión nueva conserva el ajuste** | Quitar la llamada a `reconducirAjustes` | e2e · «lo RECONDUCE, ANOTÁNDOLO» | `expected [] to deeply equal [ '…:E2E_SEED' ]` |
| **…y no pisa una versión publicada** | Quitar el `if (vigente.version === c.version) continue` | e2e · «si el texto cambia SIN subir la versión, avisa y NO propaga» | `expected 'Otro nombre a traición' to be 'Control del seed'` |
| **Los tenants sin residencia no notan nada** | — | toda la suite + `residencia-acceso.test.ts` | — |

---

## 10 · Decisiones tomadas sin preguntar

1. **La tensión son dos controles y la higiene también** (§2). Las dos están explicadas donde se
   toman, en el propio fichero de datos.
2. **El vocabulario de las cinco dimensiones `OBS` que la rama no traía** (dolor, descanso
   nocturno, piel, ingesta del día, movilidad) se ha escrito aquí y está marcado como propuesta en
   el fichero de datos. Ánimo y cognición ya no: son los de la rama §4, literales (§11.5).
   **Las cinco son lo primero que deberían validar la médica y las auxiliares** (D-57).
3. **La plantilla de serie vive en el fichero del producto y no en la base.** Los dos únicos que la
   leen son la semilla y el botón de «volver a la de serie», y los dos leen el fichero. Meterla en la
   base habría costado un `scope`/`tenantId?` con sus dos índices parciales —la factura que paga
   `ControlType`— para una tabla que nadie consulta en caliente.
4. **El modelo se llama `CenterMoment` y no `MealMoment`** (que es como lo nombraba el prompt): la
   noche no es una comida, y la medicación nocturna cuelga de ella.
5. **Guardar una plantilla no recalcula los planes abiertos** (§6), y la pantalla lo dice.
6. **`EVERY_N_HOURS` anclado a medianoche y `EVERY_N_DAYS` al inicio de la línea** (§5). Son
   opuestos y los dos tienen su razón.
7. **La vista «hoy» acepta un día cualquiera** (`?dia=`). Era gratis y es la mitad de «el plan de un
   día pasado tiene que poder reconstruirse».
8. **Un control propio del centro nace de sí/no.** Es el 90 % de lo que un centro se inventa («se le
   ha puesto la pomada»); uno con opciones o con número se pide al producto, y así la pantalla no
   tiene que explicar qué es un dominio ordinal. Un centro **no** puede inventarse una escala
   (`SCALE`/`SCORE`): lleva su algoritmo detrás y la puerta no sabría puntuarla.
9. **El seed del catálogo corre en CADA arranque y NO tumba la API si falla** (§11.4). Lo que sí se
   conserva es que no se cargue a medias: valida el fichero entero antes de escribir y aborta sin
   tocar la base.
10. **El plan de un residente lo ve también quien tiene rol de alcance total aunque no sea
    supervisor** — en la semilla de serie no hay ninguno así, pero un centro puede crearlo.
11. **Se arregló el `DELETE` del plan** (§11), que era de este bloque y estaba roto para su único
    cliente.
12. **Se añadió un `preValidation` que el repo no tenía** para que un campo del producto sea un 400 y
    no un 200 silencioso. Es la lección de residencia-1 §1 aplicada de entrada en vez de heredada.

---

## 11 · Cinco cosas que no salieron de pensarlas

### 1 · `NULL BETWEEN 1 AND 12` no es `false`: es NULL, y un CHECK que da NULL PASA

El sabotaje del e2e «`EVERY_N_HOURS` SIN HORAS → rechazado» **falló**: el motor lo aceptó. El CHECK
decía `"default_every_n_hours" BETWEEN 1 AND 12 AND …`, y con la columna a NULL la expresión entera
da NULL — que para un CHECK es un sí.

Lo que entraba era una línea de plan que la puerta leería y no sabría cuándo pedir: **el cambio
postural de un dependiente, en silencio**. Ahora todo `BETWEEN` lleva su `IS NOT NULL` delante, en
las cuatro tablas, y un test lo fija para todas las columnas a la vez porque es invisible al leer el
`CASE`.

Es la misma trampa por la que los arrays nacen `NOT NULL DEFAULT '{}'`: `cardinality(NULL)` también
es NULL. Esa mitad sí estaba pensada de entrada; la de los escalares, no.

### 2 · El `DELETE` del plan estaba roto para el único cliente que tiene

La ruta declaraba un `body` con el motivo, y la pantalla la llama sin cuerpo
(`api(url, { method: "DELETE" })`). Fastify contestaba un **400 antes de llegar al handler**. El
motivo pasa a la query. No lo encontró nadie leyendo: lo encontró el test de la ruta al llamarla como
la llama la pantalla.

### 3 · `additionalProperties: false` no basta, otra vez

Fastify configura ajv con `removeAdditional: true`, así que `additionalProperties: false` **BORRA**
la propiedad en vez de quejarse. Un intento de cambiar el rango de referencia de la temperatura
recibía un **200 sin hacer nada**, y la dirección se quedaba creyendo que lo había cambiado.

Es exactamente el bug que residencia-1 destapó en el PATCH del super-admin (§1 de su done), aquí con
más daño porque hay una pantalla que invita a intentarlo. Ahora va un `preValidation` que mira el
cuerpo CRUDO —antes de que ajv lo pode— y contesta 400 con **qué campo es y dónde sí se cambia**: «la
unidad no se cambia» a secas deja a la dirección buscando una pantalla que no existe.

### 4 · Un seed no puede impedir que la API sirva

El job `smoke` de la CI se puso rojo: arranca la imagen contra un Postgres **sin migrar** para
comprobar que levanta y contesta `/health`, y el seed del catálogo lanzaba —`P2021`, la tabla no
existe— y mataba el proceso antes de servir.

El arreglo es de fondo y no de CI: **un dedo en el fichero de datos de un catálogo de residencia
dejaría sin API a los quince clientes de hoy** —bares, tiendas y una clínica de podología— que no
tienen residencia y a los que ese fichero no les dice nada. Ahora se registra y se sigue.

Lo que no se ha relajado es lo que importaba: `cargarCatalogoDeSerie` valida el fichero **entero**
antes de escribir y aborta sin tocar la base, así que tras un fallo el estado es «el catálogo se
quedó como estaba» y no «medio catálogo». Un centro sin catálogo lo ve en su pantalla de Controles el
primer día; uno con medio catálogo no lo vería hasta el primer turno.

Y la falta de tablas se registra como **aviso** y no como error: es el estado normal de una base sin
migrar, y un log rojo tiene que significar siempre algo que mirar.

### 5 · El vocabulario de ánimo y cognición difería del de la rama

Lo trajo Matías el 15-10, después de cerrar el bloque: la rama §4 estaba en el proyecto de Jardín de
Gredos y no en el repo, así que lo que este bloque sembró primero era criterio nuestro. Difería, y
**las tres diferencias iban todas en la misma dirección equivocada**.

| Dimensión | Lo que se sembró | La rama §4 |
| --------- | ---------------- | ---------- |
| Ánimo | `Bien, como siempre` · `Apagado, más callado` · `Triste, llora` · `Inquieto, nervioso` · `Agresivo` | `Como siempre` · `Apagado / triste / no quiere levantarse` · `Inquieto / ansioso` · `Irritable / agresivo` |
| Cognición | `Como siempre` · `Más despistado` · `Desorientado en tiempo o lugar` · `No reconoce a quien tiene delante` | `Como siempre` · `Más despistado de lo habitual` · `Confuso — no reconoce, no se ubica` · `Ausente — no responde` |

Y lo que las explica son **las tres reglas de la capa**, que la rama trae y el bloque no tenía
escritas (ahora están en la cabecera de `OBS` en el fichero de datos):

1. **El registro no exige DIAGNOSTICAR.** Por eso la rama FUNDE opciones donde nosotros las
   partíamos: «apagado / triste» es una sola, porque pedirle a una auxiliar que distinga si doña
   Carmen está apagada o triste es pedirle un juicio clínico mientras hace la cama. Lo mismo con
   «confuso — no reconoce, no se ubica», que nosotros teníamos en dos.
2. **Todo es relativo a la LÍNEA BASE del residente.** De ahí que el «como siempre» del ánimo dejara
   de decir «bien»: hay personas cuyo «como siempre» no es estar bien, y marcar su normalidad no es
   decir que lo esté. Un test fija que ninguna de las dos emita ese juicio.
3. **«Como siempre» se registra SIEMPRE**: no es la ausencia de registro, es un registro con valor.
   Confirma el modelo —`isAsUsual` por dimensión— y es una obligación para **residencia-3**: el
   toque rápido tiene que ESCRIBIR el `CareRecord` de cada dimensión activa con su valor, no saltarse
   la fila.

Y una diferencia que no era de estilo sino **un agujero**: faltaba `Ausente — no responde`, el
escalón más grave de la cognición. Una auxiliar que se encuentra a alguien que no responde no tenía
dónde apuntarlo y habría marcado «confuso» — justo el dato que hay que ver primero.

**Se ha editado la versión 1 en vez de publicar una 2**, y es correcto porque la 1 nunca llegó a
nadie: no hay ningún centro con la residencia encendida en producción y la rama no está mergeada.
Publicar una «v2» sería inventar un histórico que no ocurrió. La consecuencia, dicha: quien ya haya
arrancado esta rama tiene la v1 vieja en su base y el seed **no la pisa** —avisa y no propaga, que es
justo lo que debe hacer—; se arregla borrando esas dos filas y volviendo a arrancar.

El vocabulario queda fijado por un test, porque es dato y nada más lo defendía: el día que alguien
«mejore» el ánimo partiendo «apagado / triste» en dos, se pone rojo y recuerda por qué va junto.

---

## 12 · Dudas abiertas

1. **Cinco de las siete dimensiones `OBS` siguen con vocabulario sin validar** (§10.2): dolor,
   descanso nocturno, piel, ingesta del día y movilidad/estabilidad. La rama §4 no traía ninguna, y
   lo que llevan es propuesta de producto. Ánimo y cognición ya están contrastadas con la rama, y
   **ésas también están pendientes de contraste con las auxiliares** — que es quien las va a pulsar
   quince veces por turno. No bloquea: es dato, y la vía de cambio está probada (§11.5).
2. **Un control de serie nuevo no se activa solo en los centros ya encendidos.** El ajuste se crea
   con el `upsert` de la ruta la primera vez que alguien lo toca, y hasta entonces la pantalla lo
   pinta con la frecuencia de serie y `queToca` lo trata como activo. Es el comportamiento correcto
   —un control nuevo del producto entra encendido— pero significa que un centro puede acabar con
   controles sin fila de ajuste. No molesta hoy; el día que el panel cuente «cuántos usas», habrá que
   decidir si cuentan.
3. **Las plantillas no se versionan.** Guardar reescribe, y «qué decía la plantilla del semiasistido
   en marzo» no tiene respuesta. Es deliberado (§6) y puede quedarse corto el día que una auditoría
   pregunte por qué a un residente se le precargó lo que se le precargó. Lo que sí tiene respuesta es
   qué le tocaba a ÉL, que es lo que la norma mira.
4. **`queToca` contesta «qué EMPIEZA en esta ventana» y no «qué la solapa».** Una franja de noche que
   arrancó a las 22:00 no sale si se pregunta por las 02:00–03:00. Para la puerta es lo correcto
   —pintaría la ronda entera cada vez que alguien la mirase—, pero el panel de residencia-5 quizá
   necesite lo otro. Está en el test, con su porqué.
5. **El indicador ISO es texto libre.** Nada comprueba que `isoIndicatorCode` esté en la lista de
   `INDICADORES_ISO`. Es a propósito (los indicadores cambian con la norma), pero un dedo en el
   fichero de datos da un indicador que no cuenta nada y no se ve hasta residencia-5.
6. **Un centro con los turnos cambiados deja líneas apuntando a turnos que ya no existen.** La
   pantalla lo pinta en ámbar y `queToca` devuelve cero ocurrencias — nunca inventa otro turno. Lo que
   no hay es una ruta que diga «estas 14 líneas se han quedado sin turno»; hace falta el día que un
   centro reorganice el cuadrante.
7. **Cifrado a nivel de campo**: se hereda tal cual de residencia-1 (D-62). Nada de este bloque es un
   dato personal directo, pero el plan de cuidados de una persona **es** un dato de salud.

---

## 13 · Lo que NO cubre este bloque

Declarado en el prompt y respetado:

- la pantalla de la puerta y el registro (`CareRecord`): **residencia-3**;
- umbrales, eventos derivados e incidencias: **residencia-4** — y por eso `refMin`/`refMax` es «lo
  normal» y no un umbral, dicho en el esquema, en la migración y en el fichero de datos;
- escalas validadas (`SCALE`) y su semilla: **Fase 2** (historia-3);
- leer el PAI para proponer el plan: **IA, Fase 4**;
- editor del catálogo de serie para Mi Piace (super-admin): fuera; la semilla del repo basta, y la
  ruta de versionar contesta 403 a un control de serie con la frase que lo explica.

`UserRole` no gana valores. Verifactu, caja y cobro no cambian de comportamiento para nadie. Y ni un
dato de salud en logs: lo único que el seed escribe en el log son códigos de control y recuentos.

---

## 14 · Cómo se cierra

### Migración · HAY UNA, y es UNA

`20261015000000_residencia_2_catalogo_y_plan`. **Y va sola, al contrario que residencia-1**, que fue
en dos: aquélla añadía un VALOR (`ROOM`) a un enum que ya existía, y Postgres prohíbe usar un valor
nuevo de enum en la misma transacción en la que se añade. Aquí los seis tipos son **nuevos**:
`CREATE TYPE` sí se puede usar en su transacción, y los CHECK que comparan contra sus literales
también. Se deja dicho porque la regla se recuerda mal —«los enums van en su propia migración»— y no
es eso: es sólo `ALTER TYPE … ADD VALUE`.

**Es ADITIVA**: seis tablas nuevas vacías y seis tipos. Ni un `DROP TABLE`, ni un `DELETE`, ni un
`TRUNCATE`, ni un `UPDATE`, ni una columna nueva en una tabla con filas. **Ninguna tabla existente se
toca**, así que no hay scan, no hay bloqueo y ningún tenant de hoy cambia de comportamiento. Un test
lo fija enumerando los `ALTER TABLE` y comprobando que sólo nombran las seis nuevas.

El **`down`** está escrito en la cabecera y **es completo**, también al contrario que el de
residencia-1: no se añade ningún valor a un enum existente, y `DROP TYPE` de un tipo propio sí existe
en Postgres.

**Aplicada en una copia**, no en producción: `mipiacetpv_residencia2_copia`, creada con
`CREATE DATABASE … TEMPLATE mipiacetpv_residencia1_copia` — o sea sobre una base con las migraciones
de residencia-1 ya aplicadas.

### Despliegue

1. `prisma migrate deploy` (lo hace el arranque de la imagen).
2. **El arranque carga el catálogo de serie**: 36 filas globales, idempotentes. Si el fichero de
   datos está mal escrito, **no se carga nada** y queda en el log; la API sigue sirviendo (§11.4).
3. Nada más. **Ningún tenant cambia de comportamiento**: las rutas están detrás del gate de la
   residencia y las seis tablas nacen vacías salvo el catálogo, que es del producto.
4. Un centro al que ya se le encendió la residencia **no tiene momentos, ajustes ni plantillas**: la
   semilla sólo corre al encender el interruptor. Hoy hay cero centros encendidos en producción, así
   que no hace falta backfill; el día que haya uno, se apaga y se enciende (la semilla es idempotente
   y no resucita lo que el centro desactivó) o se llama a `sembrarResidencia` desde un script.

### `COPY` en `infra/Dockerfile` · SÍ, y hacía falta

Nace un paquete (`packages/residencia-plan`) y `apps/api` lo declara como `workspace:*`. Sin su línea
de `COPY` en el stage de dependencias, `pnpm install --frozen-lockfile` dentro de la imagen falla con
«no matching version found». Es la única línea de infraestructura que este bloque toca.

### Verde

- `pnpm test` · **363 ficheros, 4.936 tests, 3 skipped.** Verde.
- `pnpm test:e2e` · **35 ficheros, 668 tests.** Verde, sobre `mipiacetpv_residencia2_e2e`.
- `pnpm e2e:agenda` · **34 passed, 1 failed, 5 did not run**, sobre
  `mipiacetpv_residencia2_banco_e2e` con puertos propios. Los capítulos **1 a 11 van enteros en
  verde**; el 12 es `mode: "serial"` y se para en su cuarto test.

  El fallo **es de `master` y no de esta rama**, y está comprobado:
  `git diff master...HEAD` sobre `packages/clinica-sesion`, `apps/tpv-web/src/clinica` y
  `apps/e2e-ui/specs` **está vacío**. Es la misma ambigüedad de localizador que residencia-1 dejó
  documentada:

  ```
  strict mode violation: getByRole('button', { name: 'Uña encarnada' }) resolved to 2 elements
    1) «Uña encarnada»        (packages/clinica-sesion/src/listas.ts)
    2) «Uña encarnada leve»   (packages/clinica-sesion/src/niveles.ts)
  ```

  Las dos etiquetas las puso `clinica-4` el 09-10. El arreglo es un `exact: true` en el spec y **no se
  toca aquí**, por lo mismo que no lo tocó residencia-1.
- `tsc` de API y admin · limpio.
- CI · **verde**, los tres jobs sobre `a03733f`:
  [run 38593898601](https://github.com/matiasoyola/mipiace-tpv/actions/runs/38593898601) —
  `ci: success`, `smoke: success`, `e2e: success` (`publish` se salta, como toca fuera de master).
  El `smoke` costó el arreglo de §11.4.

### Lo nuevo de este bloque

- `packages/residencia-plan/test/que-toca.test.ts` (32) · la tabla: las ocho frecuencias, la noche,
  los dos cambios de hora, el que ingresa y el que se va a mitad de periodo, la línea cerrada ayer y
  el control desactivado.
- `packages/residencia-plan/test/tiempo.test.ts` (11) · la copia de la hora de pared y su acuerdo con
  la agenda en los dos días del cambio de hora.
- `packages/residencia-plan/test/frecuencia.test.ts` (23) · lo que falta y lo que sobra en una
  frecuencia, y su frase.
- `apps/api/test/residencia-plan.test.ts` (14) · la plantilla al alta y el cambio de nivel.
- `apps/api/test/residencia-controles.test.ts` (47) · la frontera, los permisos y el plan por HTTP.
- `apps/api/test/residencia-2-migracion.test.ts` (28) · el contrato del SQL.
- `apps/api/test-e2e/residencia-2.e2e.ts` (39) · los sabotajes contra Postgres y el seed de verdad.
- `apps/admin/test/residencia-2-pantallas.test.tsx` (31) · las tres pantallas.
- Y `residencia-interruptor.test.ts` gana 5: lo que la semilla añade.

### Capturas

`docs/qa/2026-10-15-residencia-2/`: las tres pantallas a escritorio, 390 y 320; el panel de un
control de serie —que es la frontera entera en una pantalla— y el error de dejar un control sin nadie
que lo registre.

---

## 15 · Commits

```
6940f84 feat(residencia-2): el modelo del catálogo de controles y del plan
4931cab feat(residencia-2): queToca, la función que dice qué toca y cuándo
8ee49a5 feat(residencia-2): el catálogo de serie, los momentos y las plantillas
c059d87 feat(residencia-2): el catálogo, los ajustes del centro y el plan
ba7ee7f feat(residencia-2): las pantallas de controles, plantillas y plan
8843cda test(residencia-2): la tabla de queToca, los sabotajes y el cambio de nivel
64c7f53 test(residencia-2): las rutas y las tres pantallas
528f2b0 docs(residencia-2): capturas de las tres pantallas, y el aviso del recuento
fe3dc8f docs(residencia-2): el done del bloque
2bbd361 fix(residencia-2): el seed del catálogo no tumba el arranque de la API
a03733f docs(residencia-2): el done, con lo que encontró el smoke
6ea9254 docs(residencia-2): CI verde, los tres jobs
<este>  fix(residencia-2): el vocabulario de ánimo y cognición, el de la rama §4
```

## 16 · La rama

Sobre `origin/residencia-1` = `c4943e5`. **Pusheada**, y el PR contra `master` es el
[**#22**](https://github.com/matiasoyola/mipiace-tpv/pull/22), que **depende del #21**: hasta que
aquél entre, el diff contra `master` incluye lo de residencia-1. Cuando #21 se mergee, la diferencia
queda limpia sola.

**Ni merge ni despliegue: eso lo hace Dirección.**
