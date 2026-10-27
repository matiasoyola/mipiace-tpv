# Bloque personal-1 · la ficha de personal, el cuadrante y el turno de noche en el fichaje

Rama `personal-1`, worktree `~/Developer/Claude/Projects/mipiacetpv-personal-1`, desde
`origin/master`. PR contra `master`. Escrito el 23-10-2026 desde el proyecto de Jardín de Gredos, el
día que se encendió el fichaje en la primera empresa real (una residencia de 24 horas, 21 personas).
Revisado el 27-10-2026: el turno de noche como «salida olvidada» **ya lo resolvió**
`hotfix-fichaje-medianoche` (#45, en producción); este bloque lo afina con el turno planificado, no lo
rehace.
Es el **primero de dos**: personal-2 genera el cuadrante con IA. Este deja todo lo que esa IA
necesita debajo (la ficha, los turnos, las reglas) y lo que la valida (`comprobarCuadrante`).

Lee antes:
1. `docs/blocks/fichaje-1-done.md` entero (§10 es lo que falta para F2: jornada teórica, ausencias,
   pausas) y `docs/design/adr-018-el-registro-de-jornada-es-inalterable.md`.
2. `docs/blocks/hotfix-fichaje-medianoche-done.md` entero: la salida olvidada ya se decide **por
   duración** en un solo sitio, `esSalidaOlvidada(entry, now, maxHoras)` de `fichaje/time.ts`, con el
   máximo del tenant en `tenants.fichaje_max_open_hours` (16 de serie, `fichaje/max-open.ts`), y lo
   usan cierre, `/me` y «Hoy» del panel. Después `apps/api/src/fichaje/routes.ts`, `fichaje/view.ts`
   («el día del registro es el de la ENTRADA»), `fichaje/admin-routes.ts` y
   `apps/admin/src/pages/fichaje/`.
3. `docs/blocks/residencia-1-done.md` §6 (`CenterShift`, `residencia/turnos.ts::turnoDe`: la noche
   como disyunción, hora de pared en `Europe/Madrid`, límite semiabierto, hueco = `null`).
4. `docs/blocks/residencia-1b-done.md` (`cripto-campos.ts`, `cifrarValor` / `descifrarValor`).
5. `docs/code-prompts/bloque-alta-minima.md` (el patrón `datosQueFaltan` y «Añadir varios»).
6. El modelo de agenda: `StaffProfile`, `StaffShift`, `StaffSkill` en `schema.prisma`, y
   `CareRole` / `CareRoleAssignment` de residencia.

## Por qué existe

Hoy hay **tres «personas» que no se hablan**: `Employee` (fichaje, sin usuario), `StaffProfile` +
`StaffShift` (agenda, colgado de `User`) y `CareRoleAssignment` (residencia, colgado de `User`). Y el
fichaje no sabe qué turno tiene nadie, así que:

- El fichaje sólo sabe si un tramo lleva abierto más de 16 h (#45). No sabe que la auxiliar de noche
  sale a las 08:00: si a las 13:00 sigue «dentro», nadie se entera hasta que pasan las 16 h.
- «Quién no ha fichado hoy» no significa nada: no hay jornada teórica contra la que comparar.
- El cuadrante vive en un Excel (`CUADRANTES 2026`), se reparte por WhatsApp y nadie comprueba que
  cumple la ratio, los descansos o la jornada contratada hasta que alguien se queja.

¿Y qué?: la dirección hace el cuadrante del mes **en el programa**, ve en el momento si un turno se
queda corto de gente o si alguien no descansa 12 horas, lo publica y cada persona lo ve en su móvil. El
fichaje se compara solo contra él: el turno de noche se ficha como cualquier otro, y «no ha venido»
pasa a ser un aviso cierto. Y queda listo el suelo sobre el que personal-2 genera el cuadrante.

## Decisiones de producto ya tomadas — no se re-debaten

1. **La ficha de personal es `Employee`.** Es la única de las tres que existe sin usuario (la mayoría
   de una plantilla no entra nunca al panel) y la que ya tiene el registro inalterable colgando. Se
   amplía; no se crea una cuarta. Cuando la persona además es `User` (entra al panel, o actúa en la
   tablet de la residencia con PIN), `Employee.userId` la vincula, y la ficha **enseña** sus roles de
   cuidado y su perfil de agenda; no los mueve. Si al leer el código ves que vincular no basta y hay
   que fusionar algo, **no lo hagas en este bloque**: explícalo en el done.
2. **Campos de la ficha** (todos opcionales salvo el nombre, como en alta-minima):
   nombre · apellidos · DNI/NIE (**cifrado**) · nº de afiliación a la Seguridad Social (**cifrado**) ·
   categoría profesional · jornada contratada en horas semanales · tipo de contrato (indefinido /
   temporal) · fecha de alta · fecha de fin prevista (sólo temporales) · teléfono · email. La categoría
   es un catálogo del tenant (editable, con los de serie que tocan según los módulos encendidos), y
   cada categoría lleva una marca **«cuenta como atención directa»**, que es lo que mira la ratio.
   `datosQueFaltan` del personal con el mismo patrón que el del residente (imprescindibles: apellidos,
   DNI/NIE, afiliación, categoría, jornada, fecha de alta; fin previsto si es temporal). Avisos en la
   lista y en el panel, como en alta-minima. **Un temporal a 15 días de su fecha de fin** sale como
   aviso en el panel: es lo que hoy se olvida.
3. **Importar personal desde CSV.** En Empleados, «Importar»: un CSV con cabecera (separador `;` o
   `,`, UTF-8 con o sin BOM, fechas `dd/mm/aaaa`). Vista previa que **casa por nombre completo
   normalizado** (sin tildes, mayúsculas ni dobles espacios) con las fichas que ya existen y dice, fila
   a fila, «completa la ficha de X» / «crea a Y» / «no entiendo esta fila y por qué». Las columnas que
   reconoce: `nombre`, `apellidos`, `dni_nie`, `num_afiliacion_ss`, `categoria`,
   `jornada_semanal_h`, `fecha_alta`, `tipo_contrato`, `fecha_fin`, `telefono`, `email`. Idempotente:
   importar dos veces el mismo fichero no cambia nada la segunda. **Nunca vacía** un campo que ya
   tiene valor porque la celda venga vacía. Ojo: las fichas de Jardín de Gredos ya existen con el
   nombre completo en un solo campo; casar por «nombre + apellidos» del CSV contra ese nombre tiene
   que funcionar, y al completar se separan.
4. **Los turnos de trabajo son del tenant, no de la residencia.** Una sola tabla de turnos por
   tenant, que leen el cuadrante, el fichaje y la residencia. Si `CenterShift` sirve tal cual para un
   tenant sin residencia, se reutiliza (y se siembra al encender el cuadrante si no existe); si hay que
   moverla, migración aditiva y la residencia sigue leyendo lo mismo. `turnoDe` se reutiliza, no se
   copia. Cada turno lleva además su **cobertura mínima** (personas de atención directa), editable.
5. **El cuadrante es mensual: personas × días**, y cada celda es un turno (M, T, N…) o una
   **ausencia**: libre, vacaciones, incapacidad temporal, asuntos propios, permiso. Se rellena a toques
   (elegir el turno y pintar celdas; copiar la semana anterior; repetir patrón), nada de escribir. Una
   persona puede tener un turno partido o dos turnos un día (raro, pero existe): el modelo lo admite,
   la pantalla puede dejarlo para más adelante.
6. **Borrador y publicado.** El cuadrante nace en borrador; «Publicar» lo fija con fecha y autor.
   Los cambios **después** de publicar se guardan con quién, cuándo y por qué (registro de cambios,
   append-only como `time_entry_corrections`), porque es lo que pide la Inspección cuando un trabajador
   dice que le cambiaron el turno sin avisar. Cada cuadrante lleva su **origen** (`MANUAL` /
   `GENERADO`): personal-2 escribirá borradores con origen `GENERADO` y la persona los publica igual.
7. **`comprobarCuadrante(cuadrante, reglas) → avisos[]` es una función pura** en su paquete, con
   tests de tabla, y es **la pieza central del bloque**: la pantalla la usa para pintar los avisos al
   momento y personal-2 la usará para validar lo que genere. Cada aviso dice qué regla, quién, qué día
   y cuánto se pasa o le falta. Reglas de serie (parámetros del tenant, no constantes en el código):
   - **Cobertura por turno**: personas de atención directa en cada turno de cada día frente al
     mínimo del turno.
   - **Ratio de residencia** (sólo si el módulo está encendido): jornadas completas equivalentes de
     atención directa frente a `ratio × plazas ocupadas` ese día. Por defecto 0,20 (Decreto 2/2022 de
     Castilla-La Mancha); el valor es un parámetro del tenant porque cambia por comunidad y por
     acreditación.
   - **Descanso entre jornadas**: 12 horas mínimo (art. 34.3 ET). Una noche que acaba a las 08:00 y
     una mañana que empieza a las 08:00 del mismo día es el caso que tiene que saltar.
   - **Descanso semanal**: día y medio ininterrumpido (art. 37.1 ET), con el cómputo que permita el
     parámetro (hasta 14 días).
   - **Horas planificadas frente a jornada contratada**, por semana y por mes.
   - **Nadie en dos sitios a la vez** y **nadie de alta fuera de su contrato** (antes del alta o
     después del fin).
   El convenio colectivo **no** se mete en código: sus límites entran como parámetros cuando Matías
   los confirme. Los avisos **no bloquean** publicar; publicar con avisos pide confirmarlo y los deja
   apuntados.
8. **El fichaje entiende los turnos.** Desde #45 la salida olvidada se decide por duración en
   `esSalidaOlvidada` con el máximo del tenant (16 h). Se **amplía esa misma función** (sigue siendo el
   único sitio que decide; nada de un segundo criterio en otra ruta):
   - **con turno planificado**: olvidada si ha pasado el fin de su turno más un margen (parámetro del
     tenant, por defecto 4 h). La noche de 22:00 a 08:00 sigue cerrándose de un toque, como ya hace.
   - **sin turno planificado** (el colegio, quien no tenga cuadrante): exactamente lo de hoy,
     `fichaje_max_open_hours`. No se toca ni se duplica.
   El margen va junto a `fichaje_max_open_hours` y con el mismo trato (rango con CHECK y en el schema
   de la ruta, se ajusta desde super-admin). Todo lo demás de ADR-018 y de #45 se queda como está:
   inalterable por trigger, correcciones con motivo, la propuesta de hora por mediana, el tramo
   pertenece al día en que empezó. Los tramos que **ya** se registraron como olvido siguen siendo lo
   que son; no se reescribe historia. Lo nuevo de verdad aquí es el **planificado frente a fichado**
   (punto 9) y que «sigue dentro pasada su hora» avise antes de las 16 h.
9. **Planificado frente a fichado.** En «Hoy»: quién tenía turno y no ha fichado pasada la
   tolerancia (parámetro, por defecto 15 min), quién ha fichado sin turno y quién sigue dentro pasada
   su hora. En el mes, por persona: horas planificadas, horas fichadas y diferencia. En el export del
   mes, la columna de horas planificadas al lado de las fichadas. Es el punto 1 de fichaje-1 §10.
10. **Cada persona ve su cuadrante en su móvil**, en la misma PWA de `/fichar`, sólo lectura: el mes
    publicado y los cambios desde la última vez que lo abrió, marcados. Deja de preguntarse por
    WhatsApp «¿qué tengo el sábado?».

## Alcance

- Migración aditiva: campos de la ficha en `employees` (los dos cifrados con `cripto-campos.ts`),
  catálogo de categorías, turnos del tenant con cobertura mínima (o la ampliación de `CenterShift`),
  cuadrante (cabecera mensual con estado, origen, publicado por/cuándo), asignaciones por persona y
  día, tipos de ausencia, registro de cambios tras publicar (append-only por trigger, mismo patrón que
  `time_entry_corrections`), parámetros de reglas por tenant. Con su `down`.
- API: ficha (lectura y edición, con los cifrados descifrados sólo para OWNER/MANAGER), importación
  CSV (vista previa + aplicar), cuadrante (leer, editar celdas, copiar semana, publicar, cambios),
  `comprobarCuadrante` expuesto, planificado frente a fichado, cuadrante propio del empleado en
  `/fichaje/v1`. La salida olvidada con la regla nueva.
- Admin: ficha de personal con `datosQueFaltan`; «Importar»; pantalla de Cuadrante (rejilla mensual,
  pintar a toques, avisos al lado de cada celda y resumen arriba, publicar); «Hoy» con planificado
  frente a fichado; parámetros de reglas en Ajustes. PWA `/fichar`: «Mi cuadrante».

## Respeta

- ADR-018 entero. Ni un camino que permita reescribir un tramo sin corrección.
- `fichajeEnabled` y el gate: todo lo nuevo de personal cuelga de él.
- Nada de DNI, afiliación ni nombres en logs.
- **Ningún dato de un cliente en el repo**: el CSV de Jardín de Gredos no se commitea; los tests usan
  datos inventados.
- Sistema visual y metodología de front de Mi Piace; filtro «¿y qué?» en cada pantalla y cada aviso:
  el aviso del cuadrante lleva a la celda que lo arregla con un toque.

## Fuera de alcance (declarado)

La generación del cuadrante con IA (personal-2). El calendario de festivos y el cómputo anual de
jornada (personal-2 o F2). Pausas. Solicitudes de cambio de turno y de vacaciones desde el móvil.
Nóminas. Fusionar `StaffProfile` o los roles de cuidado con la ficha (decisión 1).

## Cómo se cierra

- Tests de tabla de `comprobarCuadrante`, uno por regla y sus bordes: noche 22–08 seguida de mañana
  08–15 (salta el descanso de 12 h), noche seguida de tarde (no salta), semana sin día y medio libre,
  turno de noche sin la cobertura mínima, ratio con 48 ocupadas y 9 jornadas completas (salta) y con
  10 (no), persona planificada antes de su alta, horas de más sobre jornada contratada.
- Fichaje (los tests de `esSalidaOlvidada` y los e2e de #45 siguen verdes sin tocarlos): entrada
  08:00 con turno M de 08:00 a 15:00 y nada a las 19:01 → olvidada (fin + 4 h), aunque lleve menos de
  16 h; la misma sin turno → no olvidada hasta las 16 h; entrada 22:00 con turno N y salida 07:58 →
  se cierra sin corrección; la noche del 25-10-2026 (cambio de hora) cuenta 11 h en el export y en
  planificado frente a fichado.
- Importar: CSV con 21 filas sobre 21 fichas que sólo tienen el nombre completo → completa 21, crea
  0; repetir → 0 cambios; una celda vacía no borra; una fila con fecha `2026-10-01` → error de fila
  legible; BOM y `;` funcionan.
- **Sabotajes**: decidir el olvido fuera de `esSalidaOlvidada` · publicar un cuadrante con avisos sin confirmar · editar una celda publicada sin
  motivo · intentar borrar una fila del registro de cambios por SQL · importar 5.000 filas (límite y
  mensaje) · un turno sin hora de fin · dos turnos del tenant que se solapan · ver el cuadrante de
  otra empresa desde `/fichaje/v1`.
- **Medido**: toques para pintar un mes de 21 personas a partir de copiar la semana anterior, y
  tiempo de `comprobarCuadrante` sobre 21 personas × 31 días (tiene que pintarse al momento).
- Capturas a 390 y en escritorio, en `docs/qa/`: ficha con datos que faltan, importar (vista
  previa), cuadrante con avisos, publicar con avisos, «Hoy» con planificado frente a fichado, «Mi
  cuadrante» en el móvil.
- CI verde (`ci`, `smoke`, `e2e`).
- `docs/blocks/personal-1-done.md` con la estructura de la metodología: qué se hizo punto a punto,
  decisiones tomadas sin preguntar (sobre todo la 1 y la 4: cómo quedaron la persona y la tabla de
  turnos), dudas abiertas, **qué necesita personal-2 de este bloque** y qué hay que hacer al
  desplegar. Dice si la rama está pusheada y si hay PR.
- Commits pequeños en español, push y **PR contra `master`**. Ni merges ni despliegues.
