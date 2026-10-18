# Bloque residencia-4 · done

Rama `residencia-4`, worktree `~/Developer/Claude/Projects/mipiacetpv-residencia-4`, desde
`origin/master` = `9523a6f` (el prompt del bloque, D-65 y D-66). Seis commits, 183 ficheros,
+19.415 / −456.

**Hoy una fiebre de 38,4 se apunta en una hoja, la enfermera se entera cuando pasa por la sala de
terapia y la dirección reconstruye la incidencia de memoria para AENOR.** Con este bloque la puerta
toma la constante con un teclado grande, el sistema **declara la incidencia solo**, le pone nivel con
una plantilla versionada, y **el móvil de quien esté de guardia suena con la pantalla apagada** hasta
que alguien lo acusa con su PIN. Y si la tablet está sin red, la puerta dice que **el aviso NO ha
salido** en vez de fingir que sí.

Eso es el bloque entero. Lo demás es cómo.

---

## 1 · La plantilla de gravedad · dato del producto, no del centro (D-65)

La tabla del §3 de `00-decisiones.md` son **23 reglas** en
`apps/api/src/residencia/catalogo/plantilla-de-gravedad.ts`, cargadas al arranque igual que el
catálogo de controles de residencia-2. `VERSION_DE_LA_PLANTILLA = 1`.

**No es configuración.** El prompt lo decide y la migración lo hace cumplir: `severity_rules` no tiene
`tenant_id` y hay un sabotaje que lo comprueba (`UNA REGLA DE GRAVEDAD DE CENTRO no entra`). El admin
la enseña **en solo lectura y sin un botón de editar en ninguna parte** — un test de pantalla lo fija,
porque «para que el centro pueda ajustarlo» es exactamente lo que alguien añadiría luego.

**Y no hay «pendiente de firma».** D-65 lo dijo y se respetó: la plantilla viene graduada de fábrica,
nadie la tiene que validar para que el producto funcione, y lo que un centro puede hacer es la
excepción por residente de §2.

### Se publica entera, y no se baja

`cargar-plantilla.ts` es idempotente y publica **una versión completa en una transacción**: crea las
23 filas de la versión nueva y marca la anterior como superada. Tres cosas que importan:

- **Si la versión de la imagen es menor que la de la base, no hace nada.** Un despliegue hacia atrás
  no debe rebajar la plantilla con la que se graduaron incidencias de ayer.
- **Si algo falla, no tumba el arranque** — `problemasDeLaPlantilla()` valida y el arranque registra
  y sigue, como `cargarCatalogoDeSerie` desde residencia-2 (memoria de la casa: «el smoke arranca sin
  migrar»).
- **Cada incidencia guarda la versión con la que se graduó** (`severity_template_version`). Es lo que
  contesta «¿por qué esto fue N2?» tres años después, y la ficha del admin lo pinta.

---

## 2 · La excepción por residente · sólo un médico, firmada y con caducidad (D-22)

`resident_threshold_overrides` + `resident_threshold_rules`. Cuatro candados:

1. **Sólo la pauta un `MEDICO`.** No el rol de usuario (`UserRole` no gana ningún valor, como pedía el
   prompt): el **rol de cuidado** con el que se entra. `pautarExcepcion()` comprueba el `code` del
   `careRole`, y la DUE recibe una frase que lo dice. El e2e lo prueba en los dos sentidos.
2. **Firmada**: persona, rol, instante. Append-only de hecho — se revoca, no se edita.
3. **Con vigencia**, y el `EXCLUDE USING gist` impide dos solapadas sobre la misma constante del mismo
   residente. El motor lo dice; no es una validación de pantalla.
4. **El motivo va cifrado al nacer** (D-63), con su `sitioMotivoDeExcepcion`. El e2e busca el canario en
   claro en todas las tablas y no aparece.

**Sustituye, no suma.** Es la decisión fina del bloque y está en `gravedadDe`: si hay excepción vigente
para esa constante, **las reglas de serie de esa constante no se miran**. Una excepción con cero
bandas es legítima y significa «esta constante no le abre nada a esta persona» — el paliativo con
febrícula basal de 37,8. Y **cuando caduca, vuelve la de serie sin que nadie haga nada**: la vigencia
se mide contra el instante del registro, no contra `now()`, así que un lote que llega tarde se gradúa
con lo que estaba vigente cuando se tomó.

---

## 3 · `gravedadDe` · la misma función en la tablet y en el servidor

`packages/residencia-plan/src/gravedad.ts`. Pura, sin reloj y sin Prisma. La ejecutan los dos:

- **La tablet**, con las reglas que le llegan en `/residencia/puerta/arranque` (`plantilla {version,
  reglas}`), para pintar el nivel previsto **antes de tocar «Apuntar»** y para saber qué decir cuando
  no hay red.
- **El servidor**, al derivar. **El servidor gana**: lo que la tablet pinta es un aviso de lo que va a
  pasar, y lo que queda en el libro es lo que el servidor decidió con la plantilla vigente y las
  excepciones de verdad.

### El test de oro

`apps/api/test/residencia-4-gravedad.test.ts` (**68 casos**) recorre **todas las filas del §3** más los
bordes exactos que el prompt enumera — 37,4 / 37,5 / 37,9 / 38 / 39,4 / 39,5 · 92 / 91 / 88 / 87 ·
70 / 69 / 50 / 49 · 300 / 301 · 90 / 91 / 179 / 180 — **sin excepción, con excepción y con excepción
caducada**. Y `packages/residencia-plan/test/gravedad.test.ts` (**20**) fija la mecánica: gana la más
grave independientemente del orden de las reglas, el matiz gana aunque sea menos grave, el aviso
forzado nunca baja un nivel.

Que los dos lados **coinciden de verdad** no lo puede probar un test puro: lo prueba el e2e
(`la tablet y el servidor dan el MISMO nivel`), que coge las reglas tal y como salen del arranque, las
pasa por `gravedadDe` y las compara con lo que el servidor derivó, fila a fila de la tabla.

---

## 4 · Las siete constantes dejan de rechazarse

`MEASURE` existía en el catálogo desde residencia-2 y la puerta lo rechazaba con
`CONTROL_FUERA_DE_ALCANCE`. Ahora:

- **Teclado numérico grande**, teclas de 120 px en la tablet (96 px desde 390 px de ancho, que es el
  móvil de guardia — lo encontró el bucle visual, §11).
- **La unidad siempre a la vista** («°C», «mmHg», «mg/dl», «lpm», «%»).
- **Coma decimal**, porque es lo que una auxiliar española teclea.
- **Fuera de `inputMin`/`inputMax` no se guarda**, y la frase pregunta lo que hay que preguntar: con
  384 escrito dice *«de 30 a 45 … ¿38,4 o 384? Repite la toma»*. No es un error de validación: es que
  la coma se cayó.
- **La tensión se toma en UNA pantalla**, sistólica y diastólica seguidas, porque dos pantallas es
  donde se pierde la diastólica.

`SCORE` sigue rechazándose: las escalas son Fase 2 y el prompt lo deja fuera.

---

## 5 · Los dos generadores derivados, idempotentes

### Por umbral · `derivarDeLaMedida()`

Corre **dentro del lote** de la puerta, después de escribir. Un `contextoDeGravedad` por residente
(plantilla vigente + excepciones vigentes), y por cada medida que cruza, una incidencia.

**Tres fiebres en un turno son UNA incidencia.** El dedupe es por `(clientId, tipo, abierta)` con un
índice único parcial, y cada toma nueva **se adjunta como evidencia** (`incident_actions` de clase
`EVIDENCE`, con el `care_record_id`). Si la nueva es más grave, **sube de nivel y vuelve a avisar una
vez** — con una acción `SEVERITY` que deja `nivelDesde` → `nivelHasta`. El e2e lo mide contando filas:
una incidencia, tres evidencias, dos avisos.

**El mismo lote dos veces no deriva dos veces.** El id lo genera la tablet (residencia-3), así que el
registro no se duplica y la derivación tampoco.

### Por ausencia · `pasadaDeAusencias()`

Lo que **no** pasó: sin deposición más de tres días, y «nada» en dos comidas seguidas. Corre en la
pasada programada, **no duplica cada día** (mismo dedupe) y **no se inventa historia**: un residente
que ingresó ayer no lleva tres días sin deposición.

Firma con el rol `DIRECTIVO` del centro, porque una incidencia la abre alguien y aquí no hay nadie
tecleando. Si el centro no tiene ese rol, la pasada se salta ese centro y lo registra en vez de
reventar.

**La lógica vive fuera del worker** (`pasada-de-guardia.ts`, con `ahora` inyectado) exactamente para
que el e2e la pueda correr con reloj falso y sin Redis.

---

## 6 · «Algo no va bien» gana tipos, y sigue completo sin tocar ninguno (D-13)

Cinco botones, y lo que cada uno vale:

| Botón | Pregunta | Nivel |
| --- | --- | --- |
| Caída | «¿Se ha dado un golpe?» · sí / no | **N3** / **N1** |
| Vómito | — | **N1**, y el segundo del turno **N2** |
| No lo encontramos / se ha ido | — | **N4** |
| No respira bien, no responde o dolor en el pecho | — | **N4** |
| Algo roto en la habitación | «¿Hay peligro?» | **N2** / **N0** |

**Y sin tocar ninguno sigue valiendo**: N1, apuntado, lo verá el turno siguiente. Es D-13 y es la razón
de que el bloque no rompa residencia-3: la auxiliar que no sabe qué ha pasado sigue pudiendo decirlo.

La caída tiene **una sola pregunta**, no un formulario. Medido: **4 toques, ~987 ms** de la pantalla de
reposo a «Apuntado».

---

## 7 · El botón de la enfermera, encendido (decisión 9 de residencia-3)

En residencia-3 el botón existía y **no se pintaba en ninguna parte**: apuntaba y ya. Ahora
`avisarEnfermera` **fuerza al menos N2** — y nunca baja. Tres casos, los tres en el e2e:

- sobre un registro que no graduaba nada → N2 y suena;
- sobre un N3 → **sigue siendo N3**, no baja a N2;
- sobre un «hecho» que por sí solo no deriva nada → también.

Es la escapatoria del sistema automático: la auxiliar que ve algo que la tabla no recoge no tiene que
convencer a nadie.

---

## 8 · El aviso (D-19, D-66) · el móvil de guardia

### Es el MISMO APK, en un modo nuevo

`DeviceKind` gana `GUARD`. El arranque decide por lo que contesta `/devices/me` —
`bootstrap-decision.ts`, igual que `ROOM` y `KITCHEN` — y `GuardiaApp.tsx` es otra pantalla del mismo
`tpv-web`. Ni un proyecto nuevo, ni un segundo APK que mantener.

**El canal lo decide el código de emparejamiento, no el aparato.** `POST
/residencia/guardia/pairing-codes` nace con `canal: ENFERMERIA | RESPONSABLE`; si lo decidiera el
cuerpo de `/devices/pair`, cualquiera con un código se pondría en enfermería y recibiría los avisos de
salud del centro. Dos CHECK lo cierran: un móvil de guardia **sin** canal no entra, y una puerta
**con** canal tampoco.

### Quien lo coge firma con su PIN

El mismo PIN de cuidado de la puerta — `resolverPinDeCuidado()` se extrajo para que los dos usen una
sola resolución. La sesión de guardia (`guard_shift_sessions`, una viva por móvil por índice único) es
un JWT `type:"guardia"`, y **la sesión ES la firma**: no se vuelve a pedir el PIN para acusar, porque
un aviso que pide PIN dos veces a las cuatro de la mañana es un aviso que se acusa desde la cama sin
mirar.

### El escalado

| Caso | Qué pasa |
| --- | --- |
| N2, con enfermera de guardia | suena en enfermería; a los **5 min** sin acuse, pasa a dirección |
| N2, **nadie** de guardia en enfermería | dirección suena **al momento** |
| N2, acusado antes de los 5 min | **no escala nunca** |
| N3 / N4 | los **dos canales a la vez**, y la puerta pinta **«Llama al 112»** |

Los minutos los decide el centro (`center_guard_settings`, 5 por defecto). Cuando escala porque no hay
nadie de guardia, el aviso de enfermería se marca `ESCALATED` **pero no se cancela**: si la enfermera
aparece a los diez minutos, su móvil todavía tiene el aviso. Cancelarlo sería decidir por ella.

Todo esto está en el e2e **con reloj falso**, y la pasada es idempotente: correrla dos veces no abre
dos avisos.

### Que suene de verdad con la pantalla apagada

`GuardiaService.java`: **servicio en primer plano que sondea cada 10 s, y NO FCM**. La justificación
completa está en el javadoc del fichero; el resumen:

1. **No depende de servicios de Google** — el prompt pedía decirlo si dependiera, y la respuesta es
   que **no**: funciona en una tablet sin Play Services y con la cuenta de Google cerrada.
2. No añade un Firebase, una clave de servidor y un token por dispositivo para avisar a dos teléfonos
   de un centro de 49 plazas.
3. **Se puede ver fallar.** Un sondeo que no llega se nota en pantalla («Sin conexión: este móvil no
   está recibiendo avisos»); una notificación que Google retrasa no se nota en ninguna parte.

No es `WorkManager` porque su periodo mínimo son quince minutos y Doze lo retrasa más: quince minutos
no es un aviso, es un parte. El canal `guardia_alarma` lleva `IMPORTANCE_HIGH`, `setBypassDnd(true)`,
sonido de alarma (no de notificación) y `setFullScreenIntent`. Se asume el coste de batería y está
dicho en el código; **el día que un centro necesite veinte móviles, esto se cambia por FCM y la
pantalla no se entera**: lo único que el WebView sabe es «empieza» y «para».

**La notificación del sistema no lleva dato de salud.** Dice literalmente *«Aviso N2 · habitación
112»* y nada más — `GuardiaAviso.textoDeLaNotificacion()`, con seis tests que lo fijan. El detalle está
detrás del desbloqueo y detrás de la sesión.

### El 112 es una recomendación, no una llamada (D-33)

En un N3 o un N4 el móvil enseña «Recomendado: llamar a …» con el teléfono que el centro configuró y
un botón que **abre el marcador**. No llama. La persona decide y la llamada queda anotada
(`incident_actions` de clase `CALL`, con `llamado` sí/no).

---

## 9 · «Sin red no se finge»

Es la mitad del bloque que no se ve en el camino feliz. Con la tablet sin red:

- el registro **se guarda** en la bandeja de salida (residencia-3, sin cambios);
- la tablet **pinta el nivel que `gravedadDe` calcula en local**, para que la auxiliar sepa que esto
  era grave;
- y la banda dice, en ámbar: **«Sin red: el aviso NO ha salido. Avisa a la enfermera en persona.»**

Captura `8-n2-sin-red-no-ha-salido-1280x800.png`.

Cuando la red vuelve, **el aviso sale con su hora original** y el retraso se ve: la ficha del admin
compara `apuntadoEn` con `salidoEn` y, si se separan más de un minuto, lo dice. Un caso del e2e («un
lote que llega TARDE») y otro de `puerta-sin-red.test.ts` lo cubren.

---

## 10 · El libro único (D-35, D-38)

Una tabla `incidents` para las tres cosas: `RESIDENT`, `COMPLAINT`, `MAINTENANCE`. Enlazables entre sí
(`incident_links`, con el par **ordenado** por CHECK, para que no haya dos filas para el mismo enlace):
la caída y la avería que la causó son dos incidencias que se señalan.

Orígenes: `DECLARED`, `DERIVED_THRESHOLD`, `DERIVED_ABSENCE`. Niveles N0–N4. **Inmutable por trigger**:
el residente, el tipo y quién la abrió no se cambian ni por SQL; una cerrada no se reabre; las acciones
y las comunicaciones son **append-only** y un texto en claro no cabe (el CHECK del formato cifrado).

**El nivel SÍ se puede cambiar por SQL, y por eso el nivel no es el sabotaje.** Está en la tabla de
§13 dicho así, porque un nivel que sube es el funcionamiento normal del bloque; lo que no puede
cambiar es a quién pertenece la incidencia.

### El cierre (D-27, D-28)

- Cierra alguien con un rol de **categoría `DIRECTIVO`**.
- **N1 y N2 se autocierran** y queda marcado como autocierre si la cierra quien la abrió.
- **N3 y N4 los cierra OTRA persona**, o se quedan abiertos.
- **N0 nace cerrada** — una avería sin riesgo es constancia, no una tarea — y **no se marca como
  autocierre**, porque nadie la cerró.
- Cerrar **cancela lo que quede sonando**.

### La familia es otra dimensión (D-32 a D-34)

`family_communications`, con dos clases: `COMUNICADO` y `NO_COMUNICADO` (y éste **no lleva vía**, por
CHECK: si no se comunicó, no hubo teléfono). **Una incidencia de residente no se cierra sin una de las
dos** — el servidor lo rechaza y el libro lo avisa en la lista, antes de que nadie intente cerrar.

El contenido y la respuesta van **cifrados al nacer**.

---

## 11 · Lo que encontró el bucle visual

`apps/e2e-ui/capturas-residencia4.ts`, en el repo como `capturas-clinica7.ts`. Siembra los tokens,
teclea los PIN, mide toques y milisegundos y comprueba **cada objetivo táctil** y el desbordamiento
horizontal. Seis hallazgos, ninguno visto por un test:

1. **El teclado del PIN se solapaba a 390 px** (el móvil de guardia) porque las teclas eran 120 px
   fijos. Ahora 96 px, y 120 desde `lg`.
2. **Las teclas de la constante eran 120×50**: sólo estaba puesto `min-h-`, no la altura.
3. **La pantalla 6 decía «Sin red» y «Avisado en enfermería» a la vez**, y la línea se quedaba en «en
   la tablet» para siempre. **Era un fallo de residencia-3**: `enLaTablet` no se bajaba nunca al
   vaciar la bandeja. Se arregla en el `sent` de la cola, y la banda ámbar pasa a depender de si
   **estas** líneas siguen sin enviar, no del pendiente global.
4. **«Voy» caía por debajo del pliegue** a 390×844: footer pegado abajo.
5. **El libro decía «sin acusar (pending)»**: el enum no es la pantalla, y «escalated» es justo el que
   hay que entender. Ahora «sin entregar», «en el móvil», «escalado a dirección», «cancelado al
   cerrar», «acusado».
6. **«Seguir en la 112» se leía como la banda roja de «Llama al 112»** que tiene justo encima, porque
   la habitación del seed es la 112. Ahora «Seguir en la habitación 112».

Queda **un aviso abierto y no es de este bloque**: el enlace «Declaración responsable» del pie del
admin mide 34 px. Viene de otro bloque y se deja dicho.

### Medido (D-05, D-16)

```
tomar la temperatura (PIN + Tomar + 4 teclas + Apuntar): 10 toques · ~1.981 ms de máquina
caída sin golpe (Algo no va bien + Caída + No + Apuntar):  4 toques ·   ~987 ms de máquina
```

Los **toques son exactos**. Los **segundos son de máquina** —del primer toque a que la pantalla lo
diga— y es lo que cuesta el software. **Lo que NO está medido es el tiempo de la persona**: eso se mide
con una auxiliar delante, no con un navegador.

**De la puerta al timbre del móvil: no está medido en un teléfono real** (§14). Lo que sí está acotado
es la parte del sistema: el aviso se escribe **dentro de la misma transacción** del lote (el e2e lo ve
en la respuesta, con `avisadoEn`), y el sondeo del servicio son **10 s**, así que el techo son los
10 s del sondeo más la red. Contra los 5 minutos del escalado, no cambia el protocolo.

---

## 12 · Las capturas

`docs/qa/2026-10-18-residencia-4/`, del bucle sobre el producto de verdad con Jardín de Gredos
sembrado:

- **la puerta a 1280×800** — teclado vacío, 38,6 con su nivel, N2 avisado, fuera de rango, los tipos de
  «algo no va bien», la pregunta única de la caída, el N4 con «Llama al 112» y **el N2 sin red**;
- **el móvil de guardia a 390** — nadie de guardia, el aviso N4 en rojo con «Voy», el reposo con el
  turno firmado, y el móvil de dirección;
- **el admin a escritorio y a 390** — el libro, la ficha, la configuración de guardia, la plantilla en
  solo lectura y los umbrales del residente;
- y `MEDIDO.txt`.

---

## 13 · La tabla de sabotajes

Contra el motor, con SQL directo. Todos en `residencia-4.e2e.ts`.

| Sabotaje | Qué lo para |
| --- | --- |
| Borrar una incidencia | trigger `incidents_inmutable` |
| Cambiarle el **residente** | trigger |
| Cambiarle el **tipo** | trigger |
| Cambiar **quién la abrió** | trigger |
| Reabrir una cerrada | trigger |
| Cambiarle el **nivel** | **no lo para nadie, y es a propósito** (§10) |
| Editar una acción | `incident_actions_append_only` |
| Borrar una acción | append-only |
| Una acción **en claro** | CHECK del formato cifrado |
| Editar o borrar una constancia de familia | `family_communications_append_only` |
| Un «no comunicado» **con vía** | CHECK |
| Dos avisos del **mismo canal** para la misma incidencia | índice único |
| Un acuse **a medias** (instante sin persona) | CHECK |
| Una cerrada **sin autor** | CHECK |
| Una de residente **sin residente** | CHECK |
| Una **regla de gravedad de centro** | `severity_rules` no tiene tenant (D-21) |
| Un móvil de guardia **sin canal** | CHECK `devices_guard_canal` |
| Una **puerta con canal** de guardia | el mismo CHECK |
| Dos guardias **vivas en el mismo móvil** | índice único parcial |
| Un enlace **al revés** | CHECK del par ordenado |
| Dos excepciones de umbral **solapadas** | `EXCLUDE USING gist` |

### Y los cruces que el prompt pedía

| Cruce | Respuesta |
| --- | --- |
| Un **TERMINAL** contra las rutas de guardia | 403 `NOT_A_GUARD_DEVICE` |
| Una **puerta** contra las rutas de guardia | 403 |
| Un **móvil de guardia** contra las rutas de la puerta | 403 `GUARD_DEVICE_NOT_ALLOWED` |
| Una **puerta acusando** un aviso | 403 — la puerta **ve** el acuse de su incidencia, no lo da |
| El móvil de **enfermería** acusando un aviso de **responsable** | 403 |
| Un tenant **sin residencia** | el gate de siempre |

---

## 14 · La prueba en un Android real · NO SE PUDO HACER

El prompt la pide así: *«una prueba real en un Android: pantalla apagada, app en segundo plano, se
lanza un N2 y el móvil suena. Vídeo o capturas en `docs/qa/`, y si no se pudo, dilo en el done.»*

**No se pudo, y éstas son las dos razones:**

1. **Este Mac no puede construir el APK.** El único JDK instalado es `1.8.0_65`; el Gradle del
   proyecto necesita 11 o más. No se instaló un JDK nuevo porque eso es cambiarle la máquina a Matías
   sin pedírselo.
2. **No hay un dispositivo Android conectado a esta sesión.**

**Lo que SÍ se probó del Android**, y cómo:

- `GuardiaAvisoTest` (**6 casos**) — el parser del JSON del sondeo y, sobre todo,
  `textoDeLaNotificacion()`, que es el que garantiza que en la pantalla de bloqueo no hay ni un dato de
  salud. Como Gradle no arranca, **se corrió a mano**: `javac` y `java` contra el `org.json` y el JUnit
  ya cacheados en `~/.gradle`. Seis verdes.
- `infra/test/bundle-android.test.ts` — construye el bundle web del APK de verdad, con `GuardiaApp`
  dentro, y afirma sobre los ficheros emitidos. No prueba nada del Java; prueba que la **pantalla**
  del móvil entra en el paquete. Es parte de la suite (97 s de los 117 totales).
- Y el camino entero del aviso, **menos el timbre**: el e2e lo recorre hasta el acuse, y el bucle
  visual fotografía las tres pantallas del móvil a 390.

**Lo que queda sin probar, dicho sin adornos:** que el teléfono **suena** con la pantalla apagada y la
app en segundo plano. El código está escrito para ello (canal de alarma, `bypassDnd`,
`fullScreenIntent`, servicio en primer plano con wake lock), pero **eso es una afirmación sobre
Android, no sobre un test que haya corrido**. Es lo primero que hay que comprobar en el despliegue,
con el móvil en la mano, antes de decirle a un centro que tiene avisos.

---

## 15 · Decisiones tomadas sin preguntar

1. **El vómito repetido se cuenta al declarar, no en la pasada programada.** El prompt lo lista entre
   los derivados de la pasada; se hizo en `derivarDeEvento()`, contando los `VOMITO` previos del mismo
   turno. **Por qué:** un segundo vómito es N2, y N2 **suena**. Esperar a la pasada sería avisar hasta
   una hora tarde de algo que la auxiliar acaba de ver. El resultado en el libro es idéntico.
2. **La excepción SUSTITUYE a la de serie** en vez de sumarse (§2). Una excepción que sumara no serviría
   para el paliativo, que es el caso que la justifica.
3. **La sesión de guardia es la firma del acuse** (§8). No se vuelve a pedir el PIN.
4. **Sondeo cada 10 s y no FCM** (§8), con su coste de batería asumido y dicho.
5. **N0 nace cerrada y no se marca como autocierre.** «Autocierre» significa «la cerró quien la abrió»,
   y a una N0 no la cierra nadie.
6. **El aviso de enfermería se marca `ESCALATED` pero no se cancela** cuando escala por no haber nadie
   de guardia.
7. **El dedupe de las declaradas sólo aplica cuando hay residente.** Dos averías distintas en el mismo
   turno son dos averías; dos fiebres del mismo residente son una.
8. **La pasada de ausencias firma con el rol `DIRECTIVO` del centro**, y se salta el centro que no lo
   tenga en vez de reventar.
9. **Los estados de los avisos se escriben en castellano en el admin** (§11.5).
10. **La devolución del art. 28.3.g lleva las incidencias descifradas**, con sus acciones, sus
    comunicaciones a familia, sus avisos y las excepciones de umbral. Es dato personal del residente y
    el artículo obliga; que esté cifrado en reposo no lo saca del alcance.
11. **Un bloqueador nuevo en el borrado de cuenta**: `TIENE_LIBRO_DE_INCIDENCIAS`. Es alcanzable sin
    residentes —módulo encendido, cero residentes, una avería declarada— y por eso se comprueba en vez
    de darlo por imposible (memoria de la casa: una escapatoria «inalcanzable» no está cerrada).

---

## 16 · Dudas abiertas

1. **¿Suena de verdad?** (§14). La primera y la que importa.
2. **Dos móviles en el mismo canal.** El modelo lo permite y los dos sonarían; el acuse es uno y vale
   para el canal. No está pensado para un centro con tres enfermeras de guardia a la vez — si pasa,
   habrá que decidir si el aviso es del canal o de la persona.
3. **Los cinco minutos del escalado.** Son configurables y el defecto sale del prompt. Nadie ha medido
   cuánto tarda de verdad una DUE en coger el móvil de noche.
4. **Las bandas del §3 son las del prompt.** No las ha revisado un clínico. D-65 dice que son dato del
   producto y que no hay firma pendiente, así que el bloque no las cuestiona — pero la primera
   excepción que un médico paute en un centro real dirá si alguna está mal calibrada.
5. **La batería del sondeo** no está medida en un teléfono.
6. **El N0 en el libro.** Una avería sin riesgo nace cerrada y aparece en «Cerradas». Si el libro se
   llena de N0, habrá que decidir si siguen siendo incidencias o pasan a otro sitio.

---

## 17 · Lo que NO cubre este bloque

Declarado en el prompt y respetado:

- **el relevo, el panel y el «no hecho»** → residencia-5 (y este bloque **no toca** nada de ellos);
- **el portal de familias** → familias-1 (aquí sólo queda la constancia de que se comunicó);
- **proveedor y no conformidad** → calidad-1;
- **medicación, escalas y Lesión** → Fase 2;
- **la transcripción de voz** → ia-1.

Y lo que el prompt pedía respetar, comprobado: **un tenant sin residencia no nota nada**, `UserRole`
**no gana ningún valor**, **no hay dato de salud en los logs ni en la notificación del sistema**, y el
sistema visual de Mi Piace es el de siempre.

---

## 18 · Cómo se cierra

### Migración · HAY DOS

- `20261018010000_residencia_4_tipos` — `ALTER TYPE "DeviceKind" ADD VALUE IF NOT EXISTS 'GUARD'`, y
  nada más.
- `20261018020000_residencia_4_gravedad_e_incidencias` (1.290 líneas) — diez tipos, diez tablas, los
  CHECK, los índices únicos parciales, el `EXCLUDE USING gist` y los tres triggers.

**Por qué dos:** Postgres prohíbe usar un valor de enum en la transacción en la que se añade, y `GUARD`
hace falta escrito dentro del CHECK `devices_guard_canal`. La factura de siempre, pagada de entrada, y
un test lo fija.

**Aditiva, con un CHECK reemplazado.** Diez tablas nuevas vacías, dos columnas nullable y el CHECK
`devices_register_o_habitacion` sustituido **por otro más permisivo**: lo que antes pasaba sigue
pasando, y además pasa un `GUARD`. Es la única pieza que toca una tabla con filas de producción, y por
eso se aplicó primero en una copia.

El **`down` está escrito en la cabecera** de las dos, incluido lo que no se puede deshacer: el valor
`GUARD` del enum no se quita en Postgres, y el `down` de la segunda es completo **mientras no haya una
sola incidencia dentro** — después es tirar el libro que la norma obliga a conservar.

**Aplicadas en una copia**: `mipiacetpv_residencia4_copia`, creada con `CREATE DATABASE … TEMPLATE
mipiacetpv_residencia3` — una base con los datos sembrados de residencia-1, -2, -1b y -3 dentro. Y en
una base limpia. El `down` se ejecutó dentro de una transacción y se deshizo. `prisma migrate diff` no
ve deriva.

### Verde

| Suite | Resultado |
| --- | --- |
| Unitaria (`vitest run`, desde la raíz) | **5.639 pasan**, 10 saltados, 391 ficheros (antes: 5.293 / 378) |
| e2e de la API (`pnpm test:e2e`) | **927 pasan**, 42 ficheros (antes: 783 / 38) |
| `tsc --noEmit` · api, `residencia-plan` | limpio |
| `tsc -b` · admin, tpv-web | limpio |

Las dos se corrieron **con los dos `.env` apartados** y la e2e **con `REDIS_URL` apuntando a un puerto
muerto**, que es como las ve la CI (memorias de la casa: «el `.env` de la raíz tapa la CI» y «e2e en CI:
no hay Redis»). Mismos números.

**Lo nuevo:**

- `apps/api/test/residencia-4-gravedad.test.ts` (**68**) — el oro de la gravedad.
- `apps/api/test/residencia-4-migracion.test.ts` (**41**) — el contrato del SQL.
- `apps/api/test-e2e/residencia-4.e2e.ts` (**67**) — el camino entero, el escalado con reloj falso, los
  sabotajes y los cruces.
- `apps/tpv-web/test/residencia-4-pantallas.test.tsx` (**31**) — la constante, los tipos y el móvil.
- `apps/admin/test/residencia-4-pantallas.test.tsx` (**21**) — el libro, la ficha y la guardia.
- `packages/residencia-plan/test/gravedad.test.ts` (**20**) — la mecánica pura.
- `GuardiaAvisoTest.java` (**6**) — fuera de la suite, corrido a mano (§14).

**Actualizados:** `puerta-pantallas.test.tsx`, `puerta-gestos.test.ts`, `puerta-sin-red.test.ts`,
`residencia-registro.test.ts`, `residencia-1b-cifrado.test.ts`, `clinica-7.e2e.ts`,
`residencia-3.e2e.ts`. Los dos inventarios de columnas cifradas pasan de **17 a 22**.

### Lo que NO se corrió, y por qué

**`pnpm e2e:agenda`.** La misma razón que en residencia-3: no entra en la CI, usa una base de nombre
fijo que vacía entera y tres puertos fijos, y hay varios worktrees abiertos en esta máquina (memoria de
la casa). Y no hay motivo para pensar que le afecte: el banco no tiene escenario de residencia, y de los
ficheros de producción de este diff los únicos que el banco recorre son `App.tsx` y
`bootstrap-decision.ts`, donde lo nuevo está **dentro** de la rama del modo `guardia`, que un terminal
del banco no alcanza nunca.

**El `smoke`.** Arranca la imagen contra un Postgres **sin migrar**. Este bloque añade al arranque
`cargarPlantillaDeGravedad()`, escrita con la misma regla que el catálogo de serie: **registra y sigue
si falla**. Una base sin migrar da un aviso y la API arranca.

### `infra/Dockerfile`

**Sin `COPY` nuevo.** No nace ningún paquete: `packages/residencia-plan` ya tenía su línea desde
residencia-2, y que ahora `gravedad.ts` lo use también `tpv-web` no añade ninguna — la línea es del
`package.json` del paquete, no de quien lo consume.

**Ni una variable nueva en el entorno.** La `CLINICAL_KEK` es la de clinica-7.

### Despliegue

1. `prisma migrate deploy` (lo hace el arranque de la imagen).
2. **El arranque publica la versión 1 de la plantilla de gravedad**: 23 filas globales, idempotentes.
3. **Nada más. Ningún tenant cambia de comportamiento**: las diez tablas nacen vacías y las rutas están
   detrás del gate de residencia. Un centro que no empareje ningún móvil de guardia sigue funcionando
   como en residencia-3, con la diferencia de que la puerta ya acepta constantes.

**Para que un centro tenga avisos hacen falta tres cosas, y las tres se hacen desde el admin:**

1. **Emparejar el móvil** — Guardia → «+ Enfermería» o «+ Dirección» genera un código de 6 dígitos
   **con su canal dentro**. En el móvil se instala el mismo APK, se teclea el código y arranca en modo
   guardia. El canal no se puede cambiar después desde el aparato.
2. **Configurar a quién le suena cada nivel y los minutos del escalado** (Guardia → «A quién le
   suena»). Los defectos son los de D-66.
3. **El servicio sanitario de guardia** — nombre y teléfono (Guardia → «Servicio sanitario»). Es lo que
   el móvil recomienda en un N3 o un N4. Si se deja vacío, el móvil no recomienda nada y el 112 de la
   puerta sigue saliendo igual.

Y cada persona que vaya a estar de guardia necesita **su PIN de cuidado** (Personal), que es el mismo
de la puerta.

**Lo primero que hay que hacer en el despliegue, antes de decirle a un centro que tiene avisos:**
emparejar un móvil, bloquear la pantalla, mandar la app a segundo plano, lanzar un N2 y **comprobar que
suena** (§14). Eso lo teclea Matías.

### La rama

- **Empujada:** sí, `origin/residencia-4`.
- **PR:** sí, contra `master`.
- **Sin merge y sin despliegue**, como pedía el prompt.
