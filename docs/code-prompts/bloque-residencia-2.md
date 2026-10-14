# Bloque residencia-2 · el catálogo de controles y el plan de cuidados

Rama `residencia-2`, worktree `~/Developer/Claude/Projects/mipiacetpv-residencia-2`, **desde
`origin/residencia-1`** (PR #21, aún sin mergear). La PR va contra `master`: cuando #21 entre, la
diferencia queda limpia sola; si entra antes de que acabes, rebasa sobre `master`.
Escrito el 14-10-2026 desde el proyecto de Jardín de Gredos.

Lee antes: `docs/residencia/00-decisiones.md` (D-11, D-15, D-16, D-21, D-25, D-53, D-54, D-59, D-60 y
la frontera estándar/centro), `docs/residencia/01-modelo-datos.md` y **`docs/blocks/residencia-1-done.md`**:
este bloque cuelga de lo que dejó (residentes, turnos, roles de cuidado con sus flags, semilla al
encender). Este bloque **no** construye la pantalla de la puerta ni registra nada: construye **qué se
registra, a quién y cuándo**.

## Por qué existe

La tablet de la puerta tiene que saber, para cada residente y en cada momento, **qué toca**. Hoy eso
vive en prosa dentro del PAI («hidratación cutánea diaria», «toma de peso según protocolo») y en la
cabeza del personal; nadie puede sacar de ahí un plan sin releerlo. Y lo que se registra tiene que
estar definido como **dato**, no como código: dar de alta un control nuevo en 2028 tiene que ser
rellenar una fila (D-11).

¿Y qué?: la dirección da de alta a un residente semiasistido y en ese momento ya tiene su plan del día
precargado —qué se le hace, cada cuánto y en qué turno— y lo ajusta en dos toques. La auxiliar no
tendrá que recordar nada: la puerta se lo dirá. Y los indicadores de AENOR podrán contarse porque cada
control sabe a qué indicador alimenta.

## Lo que hay hoy (verificado el 14-10 sobre `origin/residencia-1`)

- `ResidentProfile` con `dependencyLevel` (`VALIDO | SEMIASISTIDO | DEPENDIENTE`), `dependencyGrade`,
  `placeType`, alta y baja.
- `CenterShift` (código, nombre, `startsAt`/`endsAt` como texto `HH:MM`) y la función pura de turnos
  en `apps/api/src/residencia/turnos.ts`, que cruza medianoche y deja `null` si un instante no cae en
  ningún turno.
- `CareRole` por tenant con categoría y los flags `recordsCare`, `requiresLicense`, `fullScope`;
  semilla al encender la residencia en `apps/api/src/residencia/semilla.ts`.
- Rutas bajo `apps/api/src/residencia/`, compuerta en `gate.ts` (404 si está apagada).

## Decisiones de producto ya tomadas — no se re-debaten

1. **El catálogo es dato.** Una entidad `ControlType` parametrizada; nada de un `switch` por control.
2. **Cuatro capas + subcapa**, por lo que significa el dato (rama de controles §2): `EXEC` (¿se hizo?),
   `OBS` (¿cómo está hoy?), `MEASURE` (constante, ¿cuánto?), `SCALE` (escala validada) y `EVENT`. Este
   bloque **siembra** `EXEC`, `OBS` y `MEASURE`; `SCALE` y `EVENT` existen en el enum y se siembran en
   sus bloques.
3. **Naturaleza**: `SCHEDULED` (se cumple o se incumple) · `ON_DEMAND` (sólo se cuenta; p. ej. la
   higiene si se ha manchado) · `DERIVED` (la genera el sistema; residencia-4).
4. **Frontera estándar / centro** (rama §10), y es lo que más pesa en el modelo:
   - **Del producto, intocable por el centro**: capa, naturaleza, dominio de valores, unidad, rango de
     entrada, rango de referencia, opciones de una escala ordinal, indicador ISO al que alimenta, y la
     lista de **frecuencias permitidas**.
   - **Del centro**: si lo activa, un alias de nombre (glosario local), la frecuencia por defecto
     **dentro de las permitidas**, qué roles de cuidado lo registran **dentro de los permitidos** (se
     puede estrechar, no ensanchar) y su visibilidad para familia (por defecto interno, D-60).
   - El centro **puede crear controles propios** (alcance `CENTER`), que nunca se mezclan con los de
     serie ni bajan a otros centros.
5. **Los controles de serie son globales y versionados**, no una copia por tenant: cuando cambie una
   guía, se actualiza en el producto y baja a todos los centros (D-21, D-57). Una versión que ya se
   haya usado no se edita: se crea la siguiente con `validFrom`, y lo registrado sigue apuntando a la
   versión con la que se registró. *(Es justo lo contrario que `CareRole`, que residencia-1 sembró por
   tenant; aquí no vale porque el catálogo clínico tiene que poder actualizarse en todos a la vez.)*
6. **La observación diaria se pregunta por residente, no por dimensión** (D-16): un registro «como
   siempre» da por buenas todas las dimensiones `OBS` activas. Este bloque sólo deja el modelo listo
   para eso: las dimensiones `OBS` llevan un orden y la marca de cuál es su valor «como siempre».
7. **Plan de cuidados por residente, como dato** (D-53), precargado por **plantilla de su nivel de
   dependencia** y ajustable a mano. Nada se lee del PAI en prosa.
8. **Las líneas del plan no se borran**: se cierran con fecha. El plan de un día pasado tiene que
   poder reconstruirse tal como era ese día.

## Alcance

### 1 · `ControlType` (catálogo, global + del centro)

Columnas (los nombres los fijas tú; el mapa está en `01-modelo-datos.md`):
`code`, `version`, `name`, `layer`, `nature`, `valueDomain` (`BOOL | ORDINAL | NUMERIC | SCORE |
TEXT_SHORT`), `unit?`, `inputMin?`/`inputMax?` (lo que la pantalla deja teclear), `refMin?`/`refMax?`
(lo normal; los **umbrales** que disparan eventos son de residencia-4, no los metas aquí),
`ordinalOptions?` (lista ordenada con código, texto y cuál es «como siempre»), `allowedFrequencies[]`,
`defaultFrequency`, `allowedCareRoleCodes[]`, `isoIndicatorCode?`, `familyVisibleDefault`, `sortOrder`,
`scope` (`STANDARD | CENTER`), `tenantId?` (nulo ⇔ `STANDARD`, por CHECK), `validFrom`, `supersededAt?`.
Único por `(scope, tenantId, code, version)`; una sola versión vigente por código (índice parcial).

### 2 · `CenterControlSetting` (lo que el centro decide de cada control)

Por tenant y código de control: `active`, `alias?`, `frequency` (validada contra las permitidas de la
versión vigente), `careRoleCodes[]` (subconjunto de los permitidos), `familyVisible`. Se crea al
encender la residencia con los valores de serie (amplía `semilla.ts`). Una versión nueva de un control
de serie **conserva** el ajuste del centro si sigue siendo válido; si no (p. ej. se retira una
frecuencia), lo lleva a la de serie y lo deja anotado para el panel.

### 3 · La semilla de serie

Un fichero de datos del producto (TS o JSON versionado en el repo, cargado por migración/seed
idempotente), con estos controles. Los textos son el vocabulario del cliente.

**EXEC** — de la rama de controles §3 (tabla «Capa 1»), con su naturaleza, rol e indicador:
higiene personal (a demanda + base programada) · cambio postural · desayuno · comida · merienda · cena
(dominio ordinal `todo / la mitad / poco / nada`) · siesta / descanso · deposición (a demanda,
contada) · dispensación de medicación diurna · nocturna · limpieza de habitación · limpieza de baño ·
hidratación cutánea · toma de peso · gimnasia de mantenimiento · estimulación cognitiva · taller de
rehabilitación grupal · actividad sociocultural · transferencias · analítica · visita médica.

**OBS** — una por dimensión, ordinal corto, con su «como siempre» (D-59; vocabulario de la rama §4):
ánimo · cognición · dolor · descanso nocturno · piel · ingesta del día · movilidad / estabilidad.

**MEASURE** — con unidad, rango de entrada y rango de referencia estándar:
temperatura (°C) · tensión sistólica y diastólica (mmHg; dos controles o uno compuesto, decide y
explícalo) · pulso (lpm) · saturación O₂ (%) · glucemia capilar (mg/dl) · peso (kg).

### 4 · Frecuencias

Un tipo de frecuencia que cubra lo real, y **una función pura** que lo resuelva:
- `EVERY_SHIFT` (en los turnos indicados) · `DAILY` (una vez, en un turno) · `MOMENTS` (desayuno,
  comida, merienda, cena, noche: momentos con hora configurable por centro) · `EVERY_N_HOURS`
  (**cambios posturales** cada 2-3 h, también de noche) · `WEEKDAYS` (días concretos) ·
  `EVERY_N_DAYS` · `MONTHLY` (visita médica) · `ON_DEMAND` (sin agenda: el botón está, nada «toca»).
- Los momentos del día (`MealMoment` o similar) son del centro, con su hora.

### 5 · El plan de cuidados

- `CarePlanItem`: residente, código de control, frecuencia (propia o la del centro), turnos o
  momentos, `fromAt`, `toAt?`, `source` (`PROFILE_TEMPLATE | MANUAL`), quién y cuándo.
- **Plantillas por nivel de dependencia** (`VALIDO`, `SEMIASISTIDO`, `DEPENDIENTE`): una de serie en
  el producto y la copia del centro, editable. Ejemplo de serie: el dependiente lleva cambios
  posturales cada 3 h; el válido no.
- **Al dar de alta un residente** se le aplica la plantilla de su nivel. **Al cambiarle el nivel**:
  se cierran las líneas que vinieron de la plantilla anterior y no están en la nueva, se abren las
  nuevas, y **las manuales no se tocan**. Todo en una transacción y con su motivo.
- **Función pura `queToca(plan, ajustesCentro, turnos, momentos, desde, hasta)`** → lista de
  ocurrencias (residente, control, instante o franja, turno). Es el corazón de residencia-3: la puerta
  sólo la llamará. Vive en un paquete puro (`packages/residencia-plan`) con tests de tabla, incluidos
  la noche que cruza medianoche, el cambio de hora y un residente dado de alta a mitad del periodo.

### 6 · Pantallas del admin

Sólo con `residenciaEnabled`, siguiendo `metodologia-front-mipiace` y `sistema-visual-mipiace`,
mucho clic y poco escribir:
- **Controles**: el catálogo por capas; activar / desactivar, alias, frecuencia por defecto (sólo las
  permitidas, en botones), quién lo registra (sólo los roles permitidos). Lo de serie se ve como
  «estándar» y sus campos intocables no son editables. Botón para crear un control propio.
- **Plantillas por nivel**: qué lleva un válido, un semiasistido y un dependiente.
- **Plan del residente** (en su ficha): sus líneas agrupadas por turno, añadir o quitar un control,
  cambiar su frecuencia; y una **vista «hoy»** que llama a `queToca` y enseña lo que le tocaría en cada
  turno. Es la prueba de que el plan está bien antes de que exista la puerta.

### 7 · Permisos

Catálogo, ajustes del centro y plantillas: `requireOwner` (mismo criterio que roles y zonas en
residencia-1: decide qué se registra de la salud de una persona). El plan de un residente: también los
roles de cuidado con categoría `SUPERVISOR` o `DIRECTIVO` y los de alcance total (DUE, médico,
calidad); la ficha pasa por la función de acceso de siempre.

## Respeta

- Los tenants sin residencia no notan nada. Suite, `e2e` y `pnpm e2e:agenda` como estaban (el
  capítulo 12 ya fallaba antes, por clinica-4: no es de este bloque).
- `UserRole` no gana valores. Nada de datos de salud en logs.
- **Los rangos de referencia no son umbrales**: no metas aquí ningún aviso ni evento.

## Fuera de alcance (declarado)

- La pantalla de la puerta y el registro (`CareRecord`): residencia-3.
- Umbrales, eventos derivados, incidencias: residencia-4.
- Escalas validadas (`SCALE`) y su semilla: Fase 2 (historia-3).
- Leer el PAI para proponer el plan: IA, Fase 4.
- Editor del catálogo de serie para Mi Piace (super-admin): la semilla del repo basta por ahora.

## Cómo se cierra

- Migración con su `down`, aplicada en una copia con los datos de residencia-1.
- Tests: CHECK de alcance (`STANDARD` sin tenant, `CENTER` con tenant); una sola versión vigente;
  ajuste del centro rechazado si la frecuencia o el rol no están permitidos; versión nueva que conserva
  o reconduce el ajuste; plantilla aplicada al alta; cambio de nivel que respeta las líneas manuales;
  `queToca` en tabla (cada tipo de frecuencia, noche, cambio de hora, alta a mitad de periodo, control
  desactivado en el centro, línea cerrada ayer).
- **Tabla de sabotajes**: el centro no toca lo de serie · lo manual sobrevive al cambio de nivel · una
  línea cerrada no se borra · un control desactivado no «toca» · un control propio no sale en otro
  centro. Qué línea rompes, qué test se pone rojo y con qué mensaje.
- CI verde (`ci`, `smoke`, `e2e`). `COPY` en `infra/Dockerfile` por el paquete nuevo.
- Capturas de las tres pantallas (320, 390, escritorio y un error) en `docs/qa/`.
- `docs/blocks/residencia-2-done.md` con la estructura de la metodología: qué se hizo punto a punto,
  cómo quedó la tensión (uno o dos controles), cómo se resolvió la versión global frente al ajuste del
  centro, decisiones tomadas sin preguntar, dudas abiertas, cómo se despliega. Dice si la rama está
  pusheada y si hay PR.
- Commits pequeños en español, push y **PR contra `master`** indicando que depende de #21. Ni merges
  ni despliegues.
