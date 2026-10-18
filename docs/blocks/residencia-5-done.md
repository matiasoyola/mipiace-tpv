# Bloque residencia-5 · done

Rama `residencia-5`, worktree `~/Developer/Claude/Projects/mipiacetpv-residencia-5`, desde
`origin/master` = `2e3e5ea` (el merge de residencia-4) + el prompt del bloque. Diez commits,
88 ficheros, +20.040 / −200.

**Es el último bloque de la v1 (D-39): detrás va el piloto.**

Hoy el cambio de turno se hace de palabra y con una hoja en la sala: lo que no se dice se pierde y
nadie puede demostrar que se dijo. La dirección se entera de lo que hay abierto preguntando, y las
obligaciones del mes —las nóminas, los extintores, el certificado de PCI que falta desde 2026— viven
en la cabeza de Carmen.

Con este bloque **el parte del turno se escribe solo** con lo que las puertas registraron, **se
congela** al acabar el turno y el turno que entra **lo lee en la sala y lo confirma con su PIN**: la
evidencia de que la información pasó de un turno a otro, que en papel no existe. Y la dirección abre
una pantalla y ve **qué hay abierto hoy y qué toca este día del mes** sin preguntar a nadie.

Eso es el bloque entero. Lo demás es cómo.

---

## 1 · El parte se genera solo, y **nadie lo escribe** (D-18)

`apps/api/src/residencia/relevo.ts` (1.292 líneas). Una función, dieciséis consultas y **ninguna
escritura**: se puede llamar en vivo cuantas veces haga falta.

Lo que el parte cuenta son **las nueve cosas del prompt y nada más**:

| # | Qué | De dónde sale |
| --- | --- | --- |
| 1 | Incidencias **nuevas** del turno, N1 en adelante | el libro de residencia-4 |
| 2 | Las que **siguen abiertas** de antes | el libro, con el día en que se abrieron |
| 3 | «Algo no va bien», con el texto **descifrado** y si hay nota de voz | `care_records` |
| 4 | Constantes **fuera de rango** | el valor cifrado contra `refMin`/`refMax` del catálogo |
| 5 | **Lo que no se hizo** | `queToca` × `CareRecord` (§2) |
| 6 | Cambios del **plan de cuidados** | `care_plan_items` abiertas o cerradas en el turno |
| 7 | **Excepciones de umbral** nuevas | residencia-4, sin el motivo (§6) |
| 8 | **Registros sin turno** | el hueco en el cuadrante de residencia-1 §11.5 |
| 9 | **Avisos que no salieron a tiempo** | `guard_alerts` sin acuse o con más de una hora de retraso |

Lo que **no** lleva es todo lo demás. Un parte con los 1.200 registros de un turno es un parte que
nadie lee, y el bloque entero depende de que se lea: el «como siempre» por residente **no sale**,
porque el denominador ya está en el panel y aquí lo que hace falta es lo que se desvía (D-16).

### Un turno sin nada que contar se confirma IGUAL

`sinNovedades` y la frase «Turno sin novedades». Es la misma lógica del «como siempre»: lo que la
confirmación demuestra no es que no hubiera nada, sino que **alguien del turno que entra lo miró**.

### Por zona, porque la confirmación es por zona

Cada línea cae en la planta del residente al que le pasó. Lo que no es de ningún residente —una
avería del office, una queja sin residente— cae en **la zona del centro**, y ésa sólo la cubre una
confirmación de alcance total (D-51).

### El orden de las líneas es el de la urgencia, no el del modelo

Un N4 de las 09:00 va delante de un «no se hizo» de las 14:00. Lo decide `ordenarLineas` **en el
servidor**, no cada pantalla: que lo decida un solo sitio es lo que hace que la sala y el admin
pinten lo mismo.

---

## 2 · «No hecho» se CALCULA, y por qué eso importa

`packages/residencia-plan/src/no-hecho.ts`. residencia-3 lo dejó escrito en su decisión 8: *«"No
hecho" no se apunta. Es la ausencia de registro […]. Con las dos fuentes, el indicador de
cumplimiento tendría que decidir cuál manda.»* Éste es el bloque que lo deriva.

`loQueNoSeHizo` cruza «qué tocaba» (`queToca`, residencia-2) con «qué se registró» (`CareRecord`,
residencia-3). Tres cosas que esto compra y que no son teóricas:

1. **Un registro tardío lo DESHACE.** La puerta de la 112 sin red sube a las 15:20 el cambio postural
   de las 14:50; a partir de ahí, cualquier cálculo dice que se hizo. Con una fila «no hecho» escrita
   a las 15:00 habría que ir a borrarla, y **borrar una fila de incumplimiento** es exactamente lo que
   una auditoría no puede permitir que se pueda hacer.
2. **Se puede preguntar por ayer.** «¿Qué no se hizo el 3 de marzo?» es la misma llamada con otra
   ventana.
3. **El parte congelado y la verdad de ahora pueden discrepar, y las dos son verdad.** En el parte de
   la mañana la línea dice «no se hizo»; debajo, el añadido tardío dice que llegó a las 15:20.

### El CORTE es el parámetro, y es la mitad de la función

Sólo cuenta lo que ya está cerrado:

- una **franja** está cerrada cuando `until <= corte`. A las 11:00 la hidratación cutánea de la
  mañana sigue abierta, y decir que «no se ha hecho» es decirle a la auxiliar que ha incumplido algo
  que tiene cuatro horas para hacer. Es para esto que `queToca` distingue franja de instante;
- un **instante** está cerrado cuando `at < corte`.

Quien llama elige el corte y con eso elige la pregunta: el final del turno para el parte, **el inicio
del turno en curso** para el panel («lo no hecho de turnos cerrados hoy»).

### Y los tres casos que no son el camino feliz

- **Lo `ON_DEMAND` nunca es «no hecho»**: el botón «+ Deposición» no cuelga de ninguna agenda.
  `queToca` ya devuelve `[]`, y se comprueba otra vez por naturaleza — una función que depende de que
  la otra no se equivoque falla en silencio.
- **La observación diaria se empareja por TURNO**, no por instante: su `occurrence_at` es NULL
  (residencia-3 §1). Emparejar por instante marcaría como «no hecha» una observación que sí está
  registrada, que es el peor error posible de esta función: llenar el parte de incumplimientos falsos
  es la forma de que nadie lo lea.
- **Un residente sin cama vigente no cuenta.** Su plan sigue vivo —nadie lo cierra por un ingreso
  hospitalario de tres días— y sin esto saldrían veintiocho cuidados «no hechos» de alguien que no
  estaba en el centro.

Tabla de verdad: `packages/residencia-plan/test/no-hecho.test.ts`, **19 casos**, con la noche que
cruza medianoche y el registro que llega después del congelado.

---

## 3 · Se congela al acabar el turno, y **sólo existe la fila congelada**

`handovers` **no tiene estado «en vivo»**. Mientras el turno está en curso el parte se CALCULA y no
hay fila; la fila nace al cerrar el turno con `frozen_at` NOT NULL, y a partir de ahí no se edita ni
se borra (trigger `handovers_inmutable`).

La alternativa era una fila que naciera al abrirse el turno y se fuera rellenando. Se descartó por una
razón concreta: lo que esta tabla **es** es la evidencia de lo que se supo, y una fila que se edita
durante ocho horas **no se puede distinguir de una que alguien editó después**. Con el cálculo en
vivo, lo que se ve antes de congelar es una consulta —que no miente porque no guarda nada— y lo que
queda escrito es el parte.

### El corte no pasa del final del turno

La tarea puede correr a las 15:00:04 y el parte de la mañana acaba a las 15:00. Sin esto, el parte se
llevaría los cuatro segundos de propina y dejaría de ser «lo que pasó en el turno». Tiene su caso en
el e2e.

### La pasada mira las ÚLTIMAS 24 HORAS, no «el último minuto»

Lo obvio sería «¿acaba de cerrar un turno? congela», y entonces **un despliegue de siete minutos a las
15:00 dejaría al centro sin el parte de la mañana para siempre**, sin que nadie se enterara hasta que
el turno de tarde se encontrara la sala vacía.

Así que `pasadaDeRelevo` pregunta otra cosa: ¿hay algún turno cerrado en las últimas 24 h **que no
tenga parte**? Es auto-reparable y es idempotente por el índice único `(tenant, turno, día)`, no por
un `if`.

Y **respeta los turnos configurables (D-54)**: no hay ninguna hora escrita en el código. Los turnos
salen de `center_shifts` y la ventana la calcula `ventanaDelTurno`, que es la misma función que el
parte usa y la que sabe que **la noche cruza medianoche**. Un centro que ponga la mañana de 07 a 14
congela a las 14:00 sin tocar nada.

El coste, dicho: una consulta por centro de residencia y por minuto. Con quince clientes y uno de
residencia es invisible; con cincuenta centros habrá que mirarlo.

---

## 4 · «Llegó después del relevo» (decisión de producto 2)

Lo que una puerta sin red sube a las 15:20 de algo que pasó a las 14:50, cuando el parte ya está
congelado. **No se reescribe lo congelado** y tampoco se esconde: va a `handover_late_additions`, a la
vista y con su hora, y la sala y el panel lo pintan **aparte** — arriba y en ámbar, no mezclado con
las líneas del parte.

«Pasó a las 14:50, lo supimos a las 15:20» son las dos columnas de esa tabla, y es el bloque entero en
dos columnas.

Lo detecta la misma pasada, buscando lo que **ocurrió dentro del turno** y **llegó después de
congelar** (`received_at > frozen_at`, `created_at > frozen_at`). Es idempotente por tres índices
únicos parciales —uno por clase de fuente— porque las tres columnas son nullable y en Postgres los
NULL son distintos entre sí.

---

## 5 · La tablet de la sala (D-67)

`DeviceKind` gana `HANDOVER`. **La misma APK en «modo relevo»**, emparejada al centro: ni caja, ni
habitación, ni canal. Es el tercer `DeviceKind` que no cuelga de una caja y el segundo que no cuelga
de nada físico, y la diferencia con el móvil de guardia es de qué es: el móvil es de quien lo lleve
ese turno; **la tablet de la sala es del CENTRO, y el centro es el tenant** — así que no hace falta
ninguna columna que lo diga.

Y **un centro puede tener más de una**: una sala por planta es un caso real y las dos enseñan el mismo
parte. No hay índice de unicidad, al revés que la puerta de una habitación.

### Las tres pantallas

1. **En reposo**: centro, hora, turno y «Relevo de la mañana · 3 zonas por confirmar». **Nada de
   salud** — ni un nombre, ni un nivel, ni una línea. Un test mide el texto crudo de la respuesta con
   siete palabras prohibidas, y otro el de la pantalla.
   El **recuento** sí sale, y es la decisión fina: «3 zonas por confirmar» es un número de zonas, no
   de residentes, y no dice de quién es nada. Lo que hace es que el turno que entra vea desde la
   puerta de la sala que tiene algo que leer, que es para lo que la tablet está ahí.
2. **El PIN**: el **MISMO teclado** que la puerta y el móvil de guardia, con otro encabezado y otra
   frase. Se reutiliza —tres opcionales en `PuertaPin`— y no se copia, porque **el solape de las
   teclas a 390 px lo encontró el bucle visual de residencia-4** y una cuarta copia sería un cuarto
   sitio donde volver a pagarlo. Un test fija que la puerta sigue diciendo lo suyo.
3. **El parte**, recortado al alcance de quien entró, con «Leído y recibido» y «Terminar».

### Dos minutos de pantalla, y no uno

La puerta se cierra sola **al minuto** (residencia-3): es una tablet de pasillo con la historia de dos
personas abierta y por delante pasa cualquiera. La sala son **dos**, y la diferencia es de uso: el
parte se LEE, y leer el de una planta con nueve líneas delante del turno lleva más de un minuto. Una
pantalla que se apaga a mitad de la lectura obliga a teclear el PIN otra vez con seis personas
esperando — que es cómo se consigue que alguien deje el PIN apuntado en la pared.

El número vive en la API (`MINUTOS_SIN_TOCAR_EN_LA_SALA`) y viaja en el arranque, para que la pantalla
y el servidor no puedan decir dos cosas distintas.

### La sesión ES la firma

Como en el móvil de guardia y por lo mismo: «Leído y recibido» lo pulsa quien está mirando la
pantalla, en la reunión de cambio de turno, y no lo puede firmar nadie que no esté delante. El cuerpo
de la confirmación no lleva ninguna firma.

---

## 6 · Quién ve qué, y cuándo está confirmado (D-51, D-58)

`packages/residencia-plan/src/relevo-confirmacion.ts`, y **vive en el paquete puro y no en la API** a
propósito: la tablet la ejecuta **sin red**. Si viviera en `apps/api`, la tablet tendría una copia — y
entonces lo que una auxiliar ve sin red podría no ser lo que ve con red, que es el fallo que D-51 no
se puede permitir. Mismo razonamiento que `gravedadDe` y `queToca`.

- **Qué ve cada uno**: la auxiliar, sus zonas; la DUE, el médico, calidad y dirección, todo. Y lo que
  ve es **el parte recortado**, no el parte entero con unas líneas escondidas: lo que no es de su zona
  no sale **ni en los recuentos**. Un «9 líneas» en una planta que no puede abrir ya estaría diciendo
  algo de residentes que no le corresponden. Y el «sin novedades» **se recalcula** sobre lo que esa
  persona ve.
- **Cuándo está confirmado**: cuando cada zona con contenido tiene al menos una confirmación de quien
  la cubre, o una de alcance total. Tres consecuencias:
  1. una planta **sin contenido no necesita confirmación** — exigirla dejaría partes «sin confirmar»
     para siempre por una planta vacía, y un indicador que nunca llega al verde deja de mirarse;
  2. la zona **del centro** sólo la cubre un alcance total;
  3. un parte **sin novedades** no tiene ninguna zona con contenido, así que **basta una confirmación
     cualquiera**.

### Lo que esta regla NO comprueba, y está decidido así

**No comprueba que quien confirma sea del turno ENTRANTE.** No hay cuadrante que lo diga (H-06: los
ratios por turno salen de configurar el centro, y eso no está en la v1), D-58 deja expresamente
abierto «cuántos asisten y cómo se ajusta tras observar un turno real» (H-09), y además **la DUE sí
confirma el suyo si está de turno** — así que una regla que prohibiera «confirmar lo tuyo» rompería el
caso que D-58 nombra. Queda en las dudas abiertas.

---

## 7 · El panel de dirección (decisión de producto 5)

`apps/api/src/residencia/panel.ts` + `PanelPage.tsx`. **Una pantalla**, en el orden de la urgencia:

1. **Qué hay abierto hoy** — por nivel con N4 y N3 arriba, avisos sin acuse, incidencias de residente
   sin constancia de familia y N3-N4 esperando que las cierre otra persona (D-28).
2. **Relevos** — el del último cambio de turno con quién lo recibió, y los no confirmados de la
   semana.
3. **Qué toca hoy, qué está vencido y qué vence en 60 días.**
4. **El turno en curso** — cuánto del plan va hecho por planta, y lo no hecho de los turnos cerrados
   de hoy.
5. **Indicadores** del mes.

### Es la pantalla de INICIO, y eso es una línea de código que hubo que mover

`landingSinCaja` manda al panel **antes que a la agenda**. Se añadió detrás y el bucle visual aterrizó
en «Agenda · Catálogo»: un tenant de residencia tiene la agenda encendida también. El panel es la
pantalla de inicio o no lo es.

### ≤ 3 toques y ≤ 10 s a cualquier dato (bloque C §1)

Es el criterio de aceptación de la v1 y es lo que decide la forma: **una sola petición** trae el panel
entero. Cinco rutas habrían sido más limpias de leer y habrían costado cinco idas a la base en serie
desde el navegador.

Y **cada cifra es un enlace**: el nivel abre el libro filtrado, el relevo abre su parte, la obligación
abre sus ocurrencias. Un test lo fija mirando los `href`. Una cifra que no se puede abrir es una cifra
que obliga a preguntar, que es justo lo que este panel existe para quitar.

### Y un ENCARGADO sin rol directivo no entra

La puerta es doble: el login del panel **más** un rol de cuidado de categoría `DIRECTIVO`, salvo si es
el OWNER (D-61). Aterriza en el panel igual y lee la frase que dice que es de dirección, con los
enlaces de lo que sí puede abrir: mandarle a su cuenta habría sido esconderle que el panel existe.

---

## 8 · Las obligaciones de dirección (D-42)

`management_duties` + `duty_occurrences`, y la aritmética del calendario en el paquete puro
(`obligaciones.ts`), con su tabla de verdad.

### Son DEL CENTRO, no del producto

Al revés que la plantilla de gravedad (D-65) y que el catálogo de controles de serie (D-21):
`management_duties` **tiene `tenant_id`** y cada centro ajusta las suyas. El catálogo del bloque C §3
es una **plantilla** que el centro carga de una vez con un botón y luego toca; no baja a todos los
centros cuando el producto la cambie, porque **las nóminas de un centro no son asunto de otro**.

Por eso no se carga en el arranque de la API, al revés que las otras dos semillas del módulo.

Y el botón **no pisa nada**: si la dirección cambió el día de las nóminas del 25 al 28, volver a
pulsarlo no se lo devuelve. Es un botón que alguien va a pulsar dos veces por si acaso, y tiene su
caso en el e2e.

### El fin de mes, que es la decisión del fichero

`monthDay` **se recorta al último día del mes** cuando el mes es más corto. De ahí sale gratis «el
último día de cada mes» —que es como un centro paga las nóminas— sin inventar un valor centinela ni
una columna booleana. En febrero de 2027 es el 28 y en 2028 el 29.

La alternativa —no generar nada cuando el día no existe— habría dejado un centro sin la obligación de
febrero, que es justo el mes en que una nómina no puede faltar.

### Las siete periodicidades, y `VALIDITY` que no es una más

Las seis primeras se repiten solas para siempre. `VALIDITY` no se repite: **caduca**. El certificado
del mantenedor de PCI vence el 5 de noviembre de 2029 y lo que hay que hacer es renovarlo antes, no
«hacerlo otra vez el año que viene». Su ocurrencia es UNA —la de su caducidad— y el panel la avisa con
**60 días** (bloque C §2).

### Lo marcado *(verificar)* entra con la marca puesta

El catálogo original es un borrador para tachar y lo que lleva *(verificar)* es una periodicidad que
alguien supuso en agosto. Entra igual —una obligación sin periodicidad confirmada **sigue tocando**— y
la pantalla lo pinta para que se arregle, no para bloquear. De las 30 que carga, **9** llevan la
marca.

Lo contrario (no cargarlas) habría dejado fuera la formación obligatoria y la facturación de plazas,
que son las dos de consecuencia legal.

### Mantenimiento no es un rol de cuidado

Cuatro obligaciones del §3.4 son «de Mantenimiento» y `semilla.ts` no siembra ese rol: en Jardín de
Gredos el mantenimiento es un externo. Van con **etiqueta libre**, que es el caso que la tercera forma
de responsable existe para cubrir — junto con «Gestoría» y «Mi Piace», que tampoco tienen usuario.

El CHECK exige **exactamente uno** de los tres: con dos, «¿a quién le toca?» tendría dos respuestas y
la pantalla elegiría una; con ninguna, la obligación no es de nadie y nadie la hace.

### Marcar hecha, la evidencia y la corrección

- **Hecha** con persona + capacidad + hora (D-31), y la pantalla pinta las tres: «la marcó Ana Isabel,
  **como responsable de calidad**, a las 11:04» es lo que es evidencia.
- **Quién puede**: cualquier rol de categoría directiva, **no** «el responsable de la obligación». El
  responsable de las nóminas es administración, pero la que está un martes de agosto es la dirección,
  y una obligación legal que no se puede marcar porque la persona que figura está de vacaciones es una
  obligación que se queda sin marcar.
- **La evidencia** es un fichero del volumen clínico con cabecera `MPC1` y la huella del claro, igual
  que las fotos y la nota de voz: no se inventa un segundo almacén. `ClaseDeFichero` gana `EVIDENCIA`.
  Se comprueba **la firma del PDF**, no lo que diga quien lo manda.
- **Una hecha vuelve a pendiente SÓLO con corrección firmada**, y lo clava el trigger
  `duty_occurrences_hecha_no_vuelve`: sin las tres columnas de corrección, el `UPDATE` no entra. Ni
  por SQL.

### Y NO abren incidencia

Una vencida sale **en rojo en el panel** y nada más. El libro tiene tres sujetos (D-38) y el sujeto
«proceso» es de calidad-1: meterla aquí sería adelantar un bloque entero por la puerta de atrás.

---

## 9 · Los indicadores: fórmula del producto, umbral del centro

`packages/residencia-plan/src/indicadores.ts`. La frontera de la rama de controles §10, escrita en dos
sitios: la **fórmula** aquí, en un fichero del producto que un centro no toca; el **umbral** en
`indicator_targets`, que es del centro. El 73,5 % de la gimnasia es el objetivo 2026 de Jardín de
Gredos; la forma de contar la gimnasia es de Mi Piace.

**Los seis que ya salen de lo registrado**, con su umbral del bloque C §2:

| Indicador | Objetivo | De dónde sale |
| --- | --- | --- |
| Residentes con más de 3 días sin deposición | ≤ 3/mes | incidencias derivadas por ausencia |
| Residentes vistos por el médico este mes | ≥ 100 % | registros de `VISITA_MEDICA` |
| Participación en la gimnasia | ≥ 73,5 % | plan × registros de `GIMNASIA` |
| Asistencia a estimulación cognitiva | ≥ 58,5 % | plan × registros de `ESTIMULACION_COGNITIVA` |
| Actividades socioculturales del mes | ≥ 2 | registros de `ACTIVIDAD_SOCIOCULTURAL` |
| Averías que tardan más de 24 h | ≤ 10 % | el libro, sujeto «avería» |

Tres decisiones que importan:

1. **El denominador de los porcentajes de cumplimiento sale del MISMO cruce que el parte** (`queToca` +
   `loQueNoSeHizo`). Así «el 73,5 % de la gimnasia» y «la gimnasia de doña Carmen no se hizo el
   martes» no se pueden contradecir, que es el error clásico de tener dos fuentes para la misma
   pregunta.
2. **«Sin dato» NO es cero.** Un centro que este mes no tenía ninguna gimnasia planificada no cumple
   el 0 % de participación: no hay nada que medir. Pintar `0 %` en rojo sería decirle a la dirección
   que algo va mal cuando lo que pasa es que no hay dato, y es el error que convierte un panel en
   ruido. Un RECUENTO de cero sí es un cero: «cero episodios de estreñimiento» es un resultado.
3. **Una avería sin cerrar cuenta como fuera de plazo.** Lo contrario haría que un centro que no
   cierra ninguna saliera con el 0 %, el mejor resultado posible por no hacer nada.

Y el mes en curso se mide **hasta ahora**, no hasta fin de mes: si no, el día 3 de octubre la gimnasia
saldría al 10 % y el panel diría que el centro va fuera de umbral por no haber hecho todavía lo de la
semana que viene.

### Los ONCE que NO se pintan, y se NOMBRAN

El prompt lo pide así: «sólo los que tienen dato; los que dependen de bloques futuros no se pintan
vacíos». Pero tampoco se callan — un indicador que falta y no se nombra es un indicador que alguien da
por calculado, y en una auditoría eso es peor que el hueco. La pantalla los lista con lo que les
falta:

| Indicador | Falta |
| --- | --- |
| Úlceras por presión nuevas | la entidad `Lesión` (Fase 2) |
| Barthel y deterioro cognitivo | las escalas 3b (Fase 2) |
| Riesgo de desnutrición | las escalas 3b (Fase 2) |
| Errores de medicación | la cadena de medicación (Fase 2) |
| Caídas con consecuencia | la entidad `Lesión` (Fase 2) |
| PAI revisado en plazo | el PAI como entidad (historia-1) |
| Familias informadas del seguimiento | el portal de familias (familias-1) |
| Prendas extraviadas | lavandería, que no está en la v1 |
| Rotación, absentismo y formación en plazo | RRHH (observación 04 de AENOR, calidad-1) |
| Satisfacción de residentes y familias | las encuestas (calidad-1) |
| Indicadores de cocina | APPCC (observación 06 de AENOR, cocina-1) |

---

## 10 · Sin red, de verdad

Tres piezas, y las tres reutilizan lo que ya existe:

1. **El arranque** (`GET /residencia/sala/arranque`) se cachea en IndexedDB (`mipiacetpv-sala`,
   **fuera** de `IDB_NAMES_TO_CLEAR`) con **el parte congelado entero** dentro. Es la misma decisión
   que la puerta tomó con el plan de cuidados de dos residentes (residencia-3 §7), con sus dos
   condiciones: la pantalla en reposo no lo pinta, y la caché **se vacía al revocar el dispositivo**.
2. **El PIN** se resuelve contra el roster cacheado recalculando la huella con `crypto.subtle` — con
   **la misma función** que la puerta (`huellaDePinEnLaTablet`), no una copia: si la huella saliera
   distinta, el PIN de la plantilla abriría la puerta y no la sala.
3. **La confirmación va a la cola ANTES del POST**, igual que una venta desde v1.5, con un `kind`
   nuevo (`handover-ack`) y la tercera auth del outbox (`sala`). Y **sale con su hora original**: lo
   que se demuestra es cuándo la persona dijo que lo había leído, no cuándo volvió el wifi. Las dos
   quedan (`at` y `received_at`) y el admin las pinta las dos cuando se separan.

El 401 `SALA_SIN_SESION` es **transitorio** para la cola: la confirmación espera a que alguien teclee
su PIN en esa tablet y sale entonces. Un 404 del parte sí es permanente — un parte que no existe no va
a existir nunca, y dejarlo pendiente sería una cola que no se vacía jamás.

Lo prueban dos ficheros que no pueden contestarse la pregunta el uno al otro:
`apps/tpv-web/test/sala-sin-red.test.ts` (corta la red, confirma, **reabre la app**, vuelve la red y
llega una vez con su hora) y el e2e contra Postgres (el servidor no duplica y guarda los dos
instantes).

---

## 11 · Lo que encontró el bucle visual

`apps/e2e-ui/capturas-residencia5.ts`, sobre el producto de verdad con Jardín de Gredos sembrado.
Cinco hallazgos, **ninguno visto por un test**:

1. **«Leído y recibido» caía por debajo del pliegue** en la sala a 1280×800. El pie tenía `shrink-0` y
   el cuerpo su `overflow-y-auto`, pero el contenedor era `min-h-screen`: la columna crecía con el
   parte y lo que se desplazaba era **la página entera**. Con `h-screen` + `overflow-hidden` el cuerpo
   se desplaza y el pie se queda. En jsdom no hay layout, así que el test de pantalla estaba en verde
   comprobando las clases. Es la misma lección que «una banda en el TPV paga su altura», por el otro
   lado.
2. **La dirección aterrizaba en «Agenda · Catálogo»** (§7).
3. **La misma caída se leía dos veces** —una de ayer y otra de hoy, mismo texto y misma hora— porque
   la que sigue abierta no decía de qué día era. Ahora dice «· abierta el 17-10».
4. **«09:00No se hizo»**: la columna de la hora medía 52 px y a 22 px de cuerpo no cabe.
5. **El resumen de un añadido tardío decía `CAMBIO_POSTURAL`** en vez de «Cambio postural». El enum no
   es la pantalla — lección 5 del bucle de residencia-4, pagada otra vez.

Más uno que no es un fallo de pintura: **el nombre de una obligación ES el botón que la abre**, y
medía 20 px. A 390 px eso es un botón que no se acierta.

Queda **un aviso abierto y no es de este bloque**: el enlace «Declaración responsable» del pie del
admin mide 34 px. Viene de otro bloque, residencia-4 ya lo dejó anotado y se mide aparte en cada
pasada para que no se pierda entre los enlaces en prosa.

### Medido (bloque C §1)

```
¿qué hay abierto hoy?            1 toque ·  ~847 ms   (el panel es la pantalla de inicio)
¿qué toca hoy?                   1 toque ·  ~314 ms   (desde el panel, «Obligaciones»)
¿qué pasó en el turno anterior?  5 toques · ~521 ms   (en la sala: «Leer el parte» + el PIN)
confirmar el relevo              1 toque ·   ~55 ms
```

Las cuatro por debajo de los **3 toques y 10 s** del presupuesto; la del parte son cinco **porque
cuatro de ellos son el PIN**, que es la identidad y no la navegación.

Los **toques son exactos**. Los **segundos son de máquina** —del primer toque a que la pantalla lo
diga— y es lo que cuesta el software. **Lo que NO está medido es el tiempo de la persona**: leer un
parte de nueve líneas delante de seis compañeros se mide con el turno delante, no con un navegador.

---

## 12 · Las capturas

`docs/qa/2026-10-19-residencia-5/`:

- **la sala a 1280×800** — el reposo sin un dato de salud, el parte de la DUE con «llegó después del
  relevo» arriba, el parte desplazado, el confirmado, y el **recortado a la zona de la auxiliar**;
- **el admin a escritorio y a 390** — el panel entero (arriba y abajo), las obligaciones con lo
  vencido en rojo, la lista de relevos, un parte con sus confirmaciones y los indicadores con los once
  que faltan;
- y `MEDIDO.txt`.

---

## 13 · La tabla de sabotajes

Contra el motor, con SQL directo. Todos en `residencia-5.e2e.ts`.

| Sabotaje | Qué lo para |
| --- | --- |
| Editar un parte congelado | trigger `handovers_inmutable` |
| Cambiarle el contenido cifrado | el mismo trigger |
| Borrarlo | el mismo trigger |
| **Des-confirmar** un parte confirmado | el mismo trigger |
| Borrar una confirmación | `handover_acks_append_only` |
| Editar una confirmación | el mismo |
| Quitarle una ZONA a una confirmación | `handover_ack_zones_append_only` |
| Borrar una zona del parte | `handover_zones_append_only` |
| DOS zonas «del centro» en el mismo parte | `handover_zones_una_del_centro_key` (índice PARCIAL) |
| Una zona del parte **sin contenido** | CHECK `handover_zones_con_contenido` |
| Un parte «sin novedades» **con líneas** | CHECK `handovers_recuento_coherente` |
| Un parte con el contenido **en claro** | CHECK del formato cifrado |
| Un añadido tardío con DOS fuentes | CHECK `handover_late_additions_fuente_coherente` |
| Un añadido que llegó **antes** de pasar | CHECK `..._instantes_ordenados` |
| Una ocurrencia **hecha devuelta a pendiente** | trigger `duty_occurrences_hecha_no_vuelve` |
| …y **con la corrección firmada**, sí | a propósito: es la única salida |
| Cambiarle el **día** a una ocurrencia | el mismo trigger |
| Una obligación con **dos responsables** | CHECK `management_duties_responsable` |
| Una **semanal con día del mes** | CHECK `..._periodicidad_coherente` |
| Una **trimestral anclada en abril** | el mismo CHECK |
| Una tablet de sala **con canal de guardia** | CHECK `devices_guard_canal`, de residencia-4 |
| Una tablet de sala **con habitación** | CHECK `devices_register_o_habitacion` |

El de la tablet con canal es el que **se mide en vez de suponerse**: el CHECK de residencia-4 ya lo
cerraba sin tocar nada, y una escapatoria «inalcanzable» no está cerrada hasta que se prueba.

### Y los cruces que el prompt pedía

| Cruce | Respuesta |
| --- | --- |
| Un **TERMINAL** contra las rutas de la sala | 403 `NOT_A_HANDOVER_DEVICE` |
| Una **puerta** contra las rutas de la sala | 403 |
| Un **móvil de guardia** contra las rutas de la sala | 403 |
| Una **puerta CONFIRMANDO** un relevo | 403 — la reunión pasa en la sala, no en el pasillo |
| La **sala** contra las rutas de la puerta | 403 `NOT_A_ROOM_DEVICE` |
| La **sala** contra las de guardia | 403 `NOT_A_GUARD_DEVICE` |
| Un tenant **sin residencia** contra el panel, los relevos, las obligaciones y los indicadores | **404**, no 403: un 403 le diría a un bar que este módulo existe |
| Un **encargado** sin rol directivo contra el panel | 403 `PANEL_ES_DE_DIRECCION` |

---

## 14 · Un fallo de residencia-4 que este bloque destapó

**`POST /devices/pair` no copiaba `guard_channel` del código de emparejamiento.** El CHECK
`devices_guard_canal` exige que un `GUARD` tenga canal, así que **emparejar un móvil de guardia por la
ruta de verdad —la única que la APK usa— reventaba contra la base.**

No salió en residencia-4 porque su e2e insertaba los dos móviles por SQL para probar otra cosa (que el
canal lo decide el código y no el aparato), así que **nunca pasó por `/devices/pair`**. El fallo
habría salido el día del despliegue, con el móvil en la mano y el centro esperando sus avisos.

Se arregla aquí porque la tablet de la sala se empareja por el mismo camino y dejarlo roto al lado
habría sido absurdo. Y el e2e de este bloque **empareja la sala por la ruta de verdad**, que es la
lección: un emparejamiento que el test hace por SQL es un emparejamiento que nadie ha probado.

---

## 15 · Decisiones tomadas sin preguntar

1. **El parte sólo existe congelado** (§3). No hay fila «en vivo»; lo que se ve antes es un cálculo.
2. **El contenido del parte va en una COLUMNA cifrada, no en un fichero `MPC1`.** El prompt dejaba la
   elección. Un parte se abre en la sala con el turno delante: lo que hay detrás es una consulta, no
   una descarga. Con un fichero habría **dos sitios que tienen que estar consistentes**, y un parte
   cuya fila existe y cuyo fichero falta es un relevo que no se puede leer y que dice que sí se pudo.
   De tamaño no hay problema: un parte de 49 plazas son unos kilobytes de JSON. Lo que SÍ es fichero
   es la **evidencia de una obligación**, y va al volumen de siempre.
3. **La pasada mira 24 h hacia atrás**, no el último minuto (§3).
4. **La pasada del relevo va en la MISMA cola y el mismo worker** que la de residencia-4. Un
   repeatable más es un repeatable más que puede quedarse sin registrar, y las tres cosas son «lo que
   la residencia hace sola cada minuto». Lo que sí está separado es el fichero.
5. **Las obligaciones son del centro y se cargan con un botón**, no en el arranque (§8).
6. **Las ocurrencias se materializan** en vez de calcularse al vuelo como el «no hecho», porque
   **tienen estado**: se marcan hechas, con quién, cuándo y con qué PDF adjunto. Un cálculo no puede
   guardar un PDF.
7. **Quien marca una obligación es un rol directivo cualquiera**, no el responsable (§8).
8. **Dos minutos de pantalla en la sala, y no uno** (§5).
9. **El «no hecho» de la observación diaria se empareja por turno** y no por instante (§2).
10. **El motivo de una excepción de umbral NO sale en el parte.** Va cifrado y es el diagnóstico con
    todas las letras («paliativo, febrícula basal 37,8»). Lo que el turno entrante necesita saber es
    que esa persona tiene umbral propio en esa constante y hasta cuándo; el motivo está en su ficha.
11. **Un aviso «llegó tarde» si se retrasó más de UNA HORA** sobre el momento en que la tablet lo
    apuntó. Un minuto es la cola del sistema funcionando; una hora es que esa habitación estuvo sin
    cobertura.
12. **La devolución del art. 28.3.g lleva el relevo**: lo que de cada residente salió en cada parte,
    con quién lo recibió y con qué capacidad, y lo suyo que llegó después. Es dato personal suyo y el
    artículo obliga; que el parte esté cifrado en reposo no lo saca del alcance (misma decisión que
    residencia-4 tomó con las incidencias).
13. **Un bloqueador nuevo en el borrado de cuenta**: `TIENE_PARTES_DE_RELEVO`. Es alcanzable sin
    residentes y sin incidencias —módulo encendido, cero residentes, y el parte de «turno sin
    novedades» que se congela el primer día— y por eso se comprueba en vez de darlo por imposible.
14. **El Redis falso de la suite e2e se saca a un módulo** (`test-e2e/redis-falso.ts`). Tres copias de
    un doble de Redis son tres sitios donde `expire` puede comportarse distinto, y entonces un
    rate-limit que falla en un bloque pasa en el de al lado.

---

## 16 · Dudas abiertas

1. **Nadie ha observado una reunión de cambio de turno.** Lo medido son toques y milisegundos de
   máquina; cuánto tarda de verdad un turno en leer el parte de su planta, y si seis personas
   alrededor de una tablet de 10" es la forma correcta, se ve con el turno delante. Es lo primero del
   piloto para esta pantalla, igual que D-05 lo es para la puerta.
2. **No se comprueba que quien confirma sea del turno entrante** (§6). D-58 lo deja abierto y la DUE
   confirma el suyo, así que una regla que lo prohibiera rompería el caso que D-58 nombra. La forma de
   cerrarlo es el cuadrante, que no está en la v1.
3. **Cuántas confirmaciones hacen falta de verdad.** Hoy basta con que cada zona con contenido tenga
   una. Si el turno entrante son cuatro auxiliares y confirma una, las otras tres no han leído nada y
   el parte sale «confirmado». D-58 dice literalmente «cuántos asisten y cómo se ajusta tras observar
   un turno real».
4. **El parte de un turno sin plan sale enorme de «no hecho».** Con el plan de un dependiente son
   veinte cuidados por turno, y un turno en el que de verdad no se registró nada da un parte de
   cincuenta líneas rojas. Es verdad y es ilegible; si en el piloto pasa, habrá que agrupar («14 de 18
   cuidados sin registrar») en vez de listarlos.
5. **El PDF de una evidencia corregida se queda huérfano.** Al deshacer una ocurrencia hecha, las
   cuatro columnas de la evidencia se sueltan (lo exige el CHECK) pero el fichero del volumen no se
   borra: que alguien subió ese PDF es un hecho. Habrá que decidir si se recoge o se deja.
6. **Una obligación por vigencia es una por persona.** «Formación obligatoria de PRL» no caduca para
   el centro: caduca para cada trabajador. Hoy entra como una fila anual «por verificar» y la nota lo
   dice. Desdoblarla pide colgar la obligación de una persona, que es media pantalla más.
7. **El coste de la pasada con muchos centros** (§3).
8. **La hora del parte y el cambio de hora.** `ventanaDelTurno` usa la hora de pared del centro, así
   que el turno de noche del 25 de octubre dura once horas y el del 29 de marzo, nueve. El parte sale
   bien; lo que no está decidido es si el indicador de cumplimiento de esos dos días debe decir algo.

---

## 17 · Lo que NO cubre este bloque

Declarado en el prompt y respetado:

- **obligaciones disparadas por un hecho** (el alta y baja en la Seguridad Social, el Plan de Acciones
  Correctivas a los 30 días del informe) → mismo motor, otra entrada: historia-1 y calidad-1;
- **no conformidades y el sujeto «proceso» del libro** → calidad-1;
- **los indicadores que dependen de escalas, lesiones o medicación** → Fase 2 (§9, los once);
- **el portal y cualquier envío a familias** → familias-1;
- **la prueba del timbre en un Android real** → pendiente de residencia-4, y va antes del piloto.

Y lo que el prompt pedía respetar, comprobado: **un tenant sin residencia no nota nada** (404 en las
cuatro familias de rutas), `UserRole` **no gana ningún valor**, **TERMINAL, puerta, guardia y sala no
se cruzan sus rutas** (§13), **no hay dato de salud en los logs** (la pasada registra cuántos partes y
cuántos añadidos, nunca de quién) y el sistema visual de Mi Piace es el de siempre.

---

## 18 · Cómo se cierra

### Migración · HAY DOS

- `20261019000000_residencia_5_tipos` — `ALTER TYPE "DeviceKind" ADD VALUE IF NOT EXISTS 'HANDOVER'`,
  y nada más.
- `20261019010000_residencia_5_relevo_y_obligaciones` (986 líneas) — cinco tipos, ocho tablas, los
  CHECK, los índices parciales y los tres triggers.

**Por qué dos**: Postgres prohíbe usar un valor de enum en la transacción en la que se añade, y
`HANDOVER` hace falta escrito dentro de los dos CHECK de abajo. Es la **tercera vez** que se paga esta
factura en el repo (`clinica_4`, `residencia_3_tipos`, `residencia_4_tipos`), pagada de entrada y con
un test que lo fija.

**Aditiva, con dos CHECK reemplazados.** Ocho tablas nuevas vacías y
`devices_register_o_habitacion` / `pairing_codes_register_o_habitacion` sustituidos **por otros más
permisivos**: lo que antes pasaba sigue pasando, y además pasa un `HANDOVER`. Por eso el scan que
hacen al crearse no puede rechazar ninguna fila de hoy. Un test enumera los `ALTER TABLE` y comprueba
que sólo nombran las tablas del bloque más esas dos.

El **`down` está escrito en la cabecera** de las dos. El de los tipos dice que **no hay** y por qué
(Postgres no quita un valor de un enum sin recrear el tipo); el del relevo es **completo mientras no
haya un solo parte congelado dentro** — después es tirar la evidencia de que la información pasó de un
turno a otro.

**Aplicadas en una copia**: `mipiacetpv_residencia5_copia`, creada con
`CREATE DATABASE … TEMPLATE mipiacetpv_residencia4` — una base con los datos sembrados de residencia-1
a -4 dentro (3 registros de cuidados, 3 incidencias, 2 residentes, 3 dispositivos). Y en una base
limpia. El `down` **se ejecutó entero dentro de una transacción y se deshizo**. `prisma migrate diff`
no ve deriva nueva: la copia y la base limpia dan exactamente los mismos doce `DROP INDEX` de siempre
(los índices parciales que viven en el SQL y no en `schema.prisma`).

### Verde

| Suite | Resultado |
| --- | --- |
| Unitaria (`vitest run`, desde la raíz) | **5.848 pasan**, 10 saltados, 400 ficheros (antes: 5.639 / 391) |
| e2e de la API (`pnpm test:e2e`) | **997 pasan**, 43 ficheros (antes: 927 / 42) |
| `tsc --noEmit` · api y los siete paquetes | limpio |
| `tsc -b` · admin, tpv-web | limpio |
| `vite build` · admin, tpv-web | limpio |

Las dos se corrieron **con el `.env` de la raíz apartado** y la e2e **con `REDIS_URL` apuntando a un
puerto muerto**, que es como las ve la CI (memorias de la casa: «el `.env` de la raíz tapa la CI» y
«e2e en CI: no hay Redis»). Mismos números.

**Lo nuevo:**

- `packages/residencia-plan/test/no-hecho.test.ts` (**19**) — la tabla del «no hecho».
- `packages/residencia-plan/test/obligaciones.test.ts` (**40**) — las siete periodicidades, el fin de
  mes y el 29 de febrero.
- `packages/residencia-plan/test/indicadores.test.ts` (**19**) — un mes calculado a mano.
- `packages/residencia-plan/test/relevo-confirmacion.test.ts` (**21**) — quién ve qué y cuándo está
  confirmado.
- `apps/api/test/residencia-5-migracion.test.ts` (**58**) — el contrato del SQL.
- `apps/api/test/residencia-5-frases.test.ts` (**4**) — las tres copias de las frases, cuadradas.
- `apps/api/test-e2e/residencia-5.e2e.ts` (**70**) — el camino entero y la tabla de sabotajes.
- `apps/admin/test/residencia-5-pantallas.test.tsx` (**24**) — el panel, el relevo, las obligaciones y
  los indicadores.
- `apps/tpv-web/test/sala-pantallas.test.tsx` (**18**) — las tres pantallas de la sala.
- `apps/tpv-web/test/sala-sin-red.test.ts` (**4**) — sin red, de verdad.

**Actualizados:** `residencia-1b-cifrado.test.ts` y `clinica-7.e2e.ts` (los dos inventarios de
columnas cifradas pasan de **22 a 24**), `residencia-3.e2e.ts` y `residencia-4.e2e.ts` (ver abajo).

### Dos cosas que salieron de correr la suite ENTERA

1. **residencia-3 y residencia-4 chocaban por el correo.** `users.email` es único GLOBAL y los dos
   insertaban `pilar@gredos.es`: el que arrancaba segundo reventaba en su `beforeAll` y **sus 62 tests
   se saltaban en verde**. Pasaba ya con dos ficheros, según el orden en que vitest los arrancara.
   Ahora el correo lleva el id del tenant dentro, en los tres.
2. **La pasada ahora congela partes en TODOS los centros con residencia**, así que la limpieza de
   residencia-3 y -4 tenía que borrarlos antes de sus turnos: su `DELETE FROM center_shifts` rebotaba
   contra `handovers_center_shift_id_fkey`.

### Lo que NO se corrió, y por qué

**`pnpm e2e:agenda`.** La misma razón que en residencia-3 y -4: no entra en la CI, usa una base de
nombre fijo que vacía entera y tres puertos fijos, y hay varios worktrees abiertos en esta máquina
(memoria de la casa). Y no hay motivo para pensar que le afecte: el banco no tiene escenario de
residencia, y de los ficheros de producción de este diff los únicos que el banco recorre son
`App.tsx`, `bootstrap-decision.ts` y `useDeviceBootstrap.ts`, donde lo nuevo está **dentro** de la
rama del modo `sala`, que un terminal del banco no alcanza nunca.

**El `smoke` en Docker.** El job arranca la imagen contra un Postgres y hace `prisma migrate deploy`
en el arranque. Este bloque **no añade nada al arranque de la API**: ni una semilla, ni una consulta
antes del `listen`; lo único que registra son tres familias de rutas. La pasada del relevo cuelga del
worker que ya existía.

### `infra/Dockerfile`

**Sin `COPY` nuevo.** No nace ningún paquete: `packages/residencia-plan` ya tenía su línea desde
residencia-2, y que ahora `tpv-web` consuma dos módulos más de él no añade ninguna.

**Ni una variable nueva en el entorno.** La `CLINICAL_KEK` es la de clinica-7 y el volumen de ficheros
es el de siempre (una carpeta más dentro: `evidencias/`).

### Despliegue

1. `prisma migrate deploy` (lo hace el arranque de la imagen).
2. **Nada más. Ningún tenant cambia de comportamiento**: las ocho tablas nacen vacías y las rutas
   están detrás del gate de residencia. Un centro que no empareje ninguna tablet de sala sigue
   funcionando como en residencia-4 — con la diferencia de que **sus partes se congelan solos desde el
   primer minuto**, que es lo que hace que el día que empareje la tablet ya tenga historia.

**Para que un centro tenga relevo hacen falta tres cosas, y las tres se hacen desde el admin:**

1. **Emparejar la tablet de la sala** — Relevos → «+ Tablet de sala» genera un código de 6 dígitos. En
   la tablet se instala el mismo APK, se teclea el código y arranca en modo relevo.
2. **Cada persona que vaya a confirmar necesita su PIN de cuidado** (Personal), que es el mismo de la
   puerta y el del móvil de guardia.
3. **Y las zonas al día** (Personal): quien no tenga zona ni alcance total puede confirmar un parte
   sin novedades, pero no cubre ninguna planta con contenido.

**Para que tenga obligaciones, una:** Obligaciones → «Cargar el catálogo base», y después ajustar las
nueve que entran marcadas «por verificar».

### La rama

- **Empujada:** sí, `origin/residencia-5`.
- **PR:** sí, contra `master`.
- **Sin merge y sin despliegue**, como pedía el prompt.

---

## 19 · QUÉ FALTA PARA EL PILOTO

La v1 está completa (D-39): la habitación y el panel de dirección. Esto es **todo lo que los cinco
bloques dejaron pendiente**, en una sola lista y en el orden en que hay que atacarlo.

### A · Lo que hay que comprobar con el hierro delante, antes de encender un centro

1. **¿SUENA de verdad el móvil de guardia?** Pantalla apagada, app en segundo plano, se lanza un N2 y
   el teléfono suena. **No se ha probado nunca**: este Mac no puede construir el APK (el único JDK es
   `1.8.0_65` y Gradle pide 11) y no hay ningún Android conectado. El código está escrito para ello
   —canal de alarma, `bypassDnd`, `fullScreenIntent`, servicio en primer plano— pero eso es una
   afirmación sobre Android, no sobre un test que haya corrido. **Es lo primero, y lo teclea Matías**
   (residencia-4 §14).
2. **La batería del sondeo de 10 s**, en un teléfono real y un turno de noche entero
   (residencia-4 §16.5).
3. **El wifi por plantas** (H-08). El ADR-01 dice que un punto muerto sólo retrasa la subida, y eso
   está probado; lo que no está medido es cuántos puntos muertos hay en Buenaventura ni dónde. Es
   tarea de la visita, y de ella sale cuántos registros van a llegar tarde al relevo.
4. **La tablet de la sala en su sitio.** 1280×800 es la medida con la que está dibujada; si la que se
   compra es de 8", hay que mirarlo antes y no el día de la reunión.

### B · Lo que hay que observar con el turno delante

5. **Los ≤30 min por jornada y auxiliar de D-05 siguen sin contrastar.** Lo medido en los cinco
   bloques son toques y milisegundos de máquina. El tiempo de la persona se mide con una auxiliar
   delante (residencia-3 §15.1).
6. **La reunión de cambio de turno** (§16.1 de este bloque): cuánto tarda un turno en leer el parte de
   su planta, y si seis personas alrededor de una tablet de 10" es la forma correcta.
7. **Cuántas confirmaciones hacen falta** (D-58, H-09): hoy basta una por zona con contenido.
8. **El vocabulario de cinco de las siete dimensiones de observación** sigue sin contrastar con las
   auxiliares, que son quienes lo pulsan quince veces por turno (residencia-2 §12.1). Es dato: se
   cambia sin desplegar.
9. **Los cinco minutos del escalado** (D-66): nadie ha medido cuánto tarda de verdad una DUE en coger
   el móvil de noche (residencia-4 §16.3).
10. **Las bandas de gravedad del §3 de `00-decisiones.md`** no las ha revisado un clínico. D-65 dice
    que son dato del producto y que no hay firma pendiente, pero la primera excepción que un médico
    paute en un centro real dirá si alguna está mal calibrada (residencia-4 §16.4).

### C · Deudas de código anotadas, por orden de lo que cuesta que pasen

11. **`configurarAvisoDeIlegible` no lo llama nadie.** Un valor cifrado que no se descifra sale como
    hueco en pantalla y **no deja rastro en el log**. Deuda de clinica-7 que residencia-1b y
    residencia-3 ya anotaron; ahora hay **veinticuatro** columnas que pueden salir así. Cada bloque
    que pasa la hace más cara.
12. **`control_code` sigue en claro** y dice qué se le controla a un residente (residencia-1b §2). Es
    la decisión con más peso que la residencia NO ha tomado.
13. **El PIN de cuatro cifras.** Una tablet robada permite aprender los PIN de la plantilla probando
    diez mil combinaciones contra el roster cacheado. Es la misma exposición que el TPV acepta y
    documenta, y lo que lo cerraría de verdad es que el PIN dejara de ser de cuatro cifras — decisión
    de producto que el mockup no toma (residencia-3 §15.2).
14. **Sin red, «lo que toca» sale todo como por hacer** en la puerta: la tablet no sabe qué registró
    otra pantalla (residencia-3 §15.3).
15. **Ficheros huérfanos en el volumen**: las fotos de residente al cambiarlas (residencia-3 §15.5) y
    ahora las evidencias de una obligación corregida (§16.5). Hace falta un script de barrido.
16. **Dos móviles en el mismo canal de guardia**: el modelo lo permite, los dos suenan y el acuse es
    uno (residencia-4 §16.2).
17. **El N0 en el libro**: una avería sin riesgo nace cerrada y aparece en «Cerradas». Si el libro se
    llena de N0 habrá que decidir si siguen siendo incidencias (residencia-4 §16.6).
18. **El parte de un turno sin plan sale enorme de «no hecho»** (§16.4 de este bloque).
19. **Un control o un rol de serie nuevo no se distribuye solo** a los centros ya encendidos: hace
    falta un script el día que haya cinco centros (residencia-1 §11.4, residencia-2 §12.2).
20. **El enlace «Declaración responsable» del pie del admin mide 34 px.** Viene de otro bloque y lo
    arrastran residencia-4 y éste.
21. **El coste de la pasada del relevo con muchos centros** (§16.7).

### D · Lo que NO es deuda: está decidido que no entra en la v1

Las escalas 3b, la medicación, `Lesión`, el portal de familias, la facturación de plazas, la IA, el
APPCC y el reglamentario (D-40). Las obligaciones disparadas por un hecho, las no conformidades y el
sujeto «proceso» del libro (calidad-1). La transcripción de la voz (ia-1). Y los **once indicadores**
del §9 que esperan a esos bloques.

### E · Y lo que NO es de software

**Limpiar `MODELO PAI.doc`**, que tiene datos reales de un residente. Urgente e independiente de todo
esto, y lleva apuntado desde el cierre de la Fase 0.

---

## 20 · Commits

```
feat(residencia): migración del relevo, las obligaciones y la tablet de sala
feat(residencia): el «no hecho», las obligaciones y los indicadores en el paquete puro
feat(residencia): el parte de relevo, la tablet de sala, el panel y las obligaciones en la API
feat(residencia): la tablet de sala y las cuatro pantallas de dirección
feat(residencia): el sembrador de Jardín de Gredos monta el día del relevo
test(residencia-5): el contrato del SQL, el relevo contra Postgres y la sala sin red
test(residencia-5): las pantallas del panel, del relevo y de la sala
fix(residencia): lo que encontró el bucle visual · el pliegue, el aterrizaje y el día de dos caídas
docs(residencia): el done del bloque residencia-5
```
