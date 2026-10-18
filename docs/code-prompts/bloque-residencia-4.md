# Bloque residencia-4 · constantes, gravedad, incidencias y el aviso que de verdad llega

Rama `residencia-4`, worktree `~/Developer/Claude/Projects/mipiacetpv-residencia-4`, desde
`origin/master`. PR contra `master`. Escrito el 18-10-2026 desde el proyecto de Jardín de Gredos.

Lee antes, en este orden:
1. `docs/residencia/00-decisiones.md`: D-19 a D-23, D-26 a D-28, D-32 a D-35, D-38, D-51, D-52, D-60,
   D-63, **D-65 y D-66** (nuevas, mandan sobre D-23 y D-56), y la plantilla de gravedad del §3.
2. `docs/residencia/rama-catalogo-de-controles.md` §5 (medidas), §6 (eventos, gravedad, cierre, libro
   único), §7 (dos velocidades), §9 (familias) y §10 (frontera estándar / centro).
3. `docs/residencia/01-modelo-datos.md`, apartado «residencia-4» (punto de partida, no contrato).
4. `docs/blocks/residencia-3-done.md` entero, sobre todo §1 (`CareRecord`), §5, §6
   (`ALGO_NO_VA_BIEN`), §7 (sin red), §9 (**el hueco `onAvisarEnfermera` ya preparado**), §14.8 («no
   hecho» no se apunta) y §16 (las líneas `MEASURE` que hoy se rechazan con `CONTROL_FUERA_DE_ALCANCE`).
5. `docs/blocks/residencia-1b-done.md` y `clinica-7-done.md` §3: lo nuevo nace cifrado.
6. Cómo empuja hoy el servidor a la tablet de cocina (`kitchen/ws-route.ts`, `realtime/`) y cómo
   arranca la APK en un modo (`tpv-android`, «modo cocina», «modo puerta»): **el móvil de guardia es la
   misma APK en un modo nuevo**, no otra app.

## Por qué existe

Hoy una fiebre de 38,4 se apunta en una hoja, la enfermera se entera cuando pasa por la sala de terapia
y la dirección reconstruye la incidencia de memoria para AENOR. La gravedad la decide cada uno a su
manera y no queda escrita.

¿Y qué?: la auxiliar teclea 38,4 en la puerta y **el sistema declara la incidencia, le pone nivel y hace
sonar el móvil de quien esté de guardia**, sin que nadie tenga que decidir si «esto es para avisar». La
enfermera acusa «voy» con su PIN y la auxiliar lo ve en la puerta. Si no hay enfermera, suena en el de
la dirección. Y el libro de incidencias, con su cierre y lo que se dijo a la familia, sale solo: es la
evidencia que AENOR pide (observación 10, indicador de deposiciones) y que hoy no existe.

## Decisiones de producto ya tomadas — no se re-debaten

1. **La plantilla de gravedad es de serie (D-65)**: la del §3 de `00-decisiones.md`, tal cual, como
   **dato versionado del producto** (como el catálogo de controles: `scope STANDARD`, versión,
   vigencia). Funciona desde el primer día; **no hay estado «pendiente de firma»** ni bloqueo por
   validación clínica. Un centro no toca umbrales ni niveles (D-21, §10). Cambiarla es una versión nueva
   que publica Mi Piace.
2. **Excepción por residente sólo la pauta un rol `MEDICO`** (D-22): umbral propio para un residente y
   una constante, con motivo, vigencia y firma (persona + capacidad). Cifrado el motivo. Sustituye al de
   serie mientras está vigente; caducada, vuelve el de serie sin que nadie haga nada.
3. **Las constantes entran en la puerta.** Las siete `MEASURE` del catálogo dejan de rechazarse. En «lo
   que toca», la línea `MEASURE` del plan sale con un botón «Tomar»; además, **«+ Constante»** junto a
   «+ Higiene» y «+ Deposición» para tomarla a demanda. Teclado numérico grande (teclas ≥ 96 px), la
   unidad a la vista, coma decimal. Fuera de `inputMin`/`inputMax` no se guarda («¿38,4 o 384?»). La
   tensión se toma en **una sola pantalla** (sistólica / diastólica) aunque sean dos controles.
4. **La gravedad la calcula una función pura compartida** (`gravedadDe`, en un paquete puro como
   `queToca`): la tablet la ejecuta para pintar el resultado al instante **también sin red**, y el
   servidor la ejecuta otra vez y **manda la suya**. Un test fija que dan lo mismo para toda la tabla
   del §3. Pulso, peso y diastólica no tienen umbral en la plantilla: se registran y no derivan nada,
   dicho en el done.
5. **Eventos derivados (D-20)**, los dos generadores:
   - **por umbral**: al llegar un `CareRecord` de una constante que cruza umbral;
   - **por ausencia**: tarea programada por centro y `care_day` (sin deposición > 3 días; «nada» en dos
     comidas seguidas; vómito repetido en el turno → sube a N2).
   **Idempotentes y sin duplicar**: si el residente ya tiene abierta una incidencia del mismo tipo
   derivado, la nueva medida **se adjunta como evidencia** a esa y, si la gravedad sube, sube el nivel
   (y avisa por el nuevo nivel). Tres tomas de fiebre en un turno son una incidencia, no tres.
6. **«Algo no va bien» gana tipos, sin perder el «a secas».** En su pantalla, encima de la nota, una fila
   de botones grandes con lo que la plantilla gradúa: **Caída** (pregunta única: «¿se ha dado en la
   cabeza o hay herida?» → N3 / N1) · **Vómito** · **No lo encontramos / se ha ido** (N4) · **No respira
   bien, no responde o dolor en el pecho** (N4) · **Algo roto en la habitación** («¿es peligroso?» →
   avería N2 / N0). Sin elegir nada sigue siendo un registro completo y vale **N1** (D-13). El coste
   sigue siendo proporcional a la anomalía (D-16): el caso normal no gana ni un toque.
7. **«No puede esperar: avisar a la enfermera» se enciende** (el hueco `onAvisarEnfermera` de
   residencia-3): fuerza **como mínimo N2** sobre lo que se esté apuntando y dispara el aviso.
8. **El aviso (D-19, D-66)**:
   - **Móvil de guardia**: dispositivo nuevo (`DeviceKind` nuevo, emparejado como los demás), la misma
     APK en «modo guardia», con **canal** `ENFERMERIA` o `RESPONSABLE` (dirección o responsable de
     guardia; puede ser el teléfono personal de quien dirige con la APK en este modo). Puede haber varios
     por canal.
   - **Quién lo lleva**: al empezar el turno, quien coge el móvil entra con su PIN («estoy de guardia»).
     Eso deja la línea en el registro de accesos y le dice al sistema **si hay enfermera de guardia en
     este turno**. No hace falta cuadrante.
   - **A quién suena**: N2 → `ENFERMERIA`; **si no hay nadie de guardia en ese canal en el turno, o nadie
     acusa en 5 minutos, suena en `RESPONSABLE`**. N3 → los dos a la vez. N4 → los dos a la vez y la
     puerta pinta en grande «Llama al 112». Los minutos de escalado y los destinatarios por nivel son
     configuración del centro (§10), con esos valores por defecto.
   - **Tiene que sonar de verdad**: con el móvil bloqueado y la app en segundo plano, con sonido de
     alarma y hasta que alguien lo acuse. Cómo se consigue en Android (servicio en primer plano con el
     socket, FCM u otra vía) lo decides tú y lo justificas en el done, **probándolo en un Android real**
     con la pantalla apagada. Si el mecanismo elegido depende de servicios de Google, dilo.
   - **Acuse con PIN**: «Voy» firma persona + capacidad + hora. La puerta que lo originó, si tiene red,
     pinta «Aviso recibido por Lucía · 10:43».
   - **El servicio sanitario de guardia, como recomendación**: el centro configura su nombre y teléfono
     (centro de salud, urgencias de zona…). En N3 y N4 el móvil de guardia muestra **«Recomendado: llamar
     a …»** con un botón que abre el marcador del teléfono. **La llamada la hace la persona**; el sistema
     no llama ni escribe a nadie de fuera por su cuenta (D-33). Si se llamó o no, se apunta como acción
     de la incidencia.
   - **Sin red no se finge**: si la puerta no puede enviar, **no dice «avisado»**. Pinta en ámbar «Sin red:
     el aviso NO ha salido. Avisa a la enfermera en persona.» y lo encola; cuando sale, suena igual con
     su hora original y su retraso a la vista. Un aviso que no sale y parece que sí es el peor fallo
     posible de este bloque.
9. **Un solo libro de incidencias (D-35, D-38)**: sujetos `RESIDENT`, `COMPLAINT` (queja de familia o
   residente) y `MAINTENANCE` (avería), enlazables entre sí (caída por asidero suelto = incidencia +
   avería enlazadas). Origen `DECLARED` / `DERIVED_THRESHOLD` / `DERIVED_ABSENCE`, nivel N0-N4, abierta
   por persona + capacidad. **Acciones append-only** («qué se hizo»), como las anotaciones clínicas.
   Inmutable como `CareRecord`: nada se edita ni se borra; el nivel cambia por acción firmada.
10. **Cierre (D-27, D-28)**: N0 no abre nada (es constancia). N1-N4 las cierra un rol de **categoría
    directiva**. N1 y N2 admiten autocierre por quien la abrió **marcado como tal**; N3 y N4, persona
    distinta, y si no la hay queda abierta.
11. **Comunicación a la familia (D-32 a D-34)**: dimensión aparte del nivel. En cada incidencia de
    residente, **comunicado** (quién, cuándo, vía, qué se dijo, respuesta) o **no comunicado** (quién y
    por qué). El sistema **sugiere** comunicar según el tipo (una caída, siempre; N4, en el momento) y
    **una incidencia de residente no se puede cerrar sin una de las dos constancias**. No se envía nada
    a la familia desde el sistema (el portal es familias-1). Si la ficha del residente no tiene hoy un
    contacto de familia utilizable, añade el mínimo (nombre, parentesco, teléfono, cifrado) y dilo.
12. **Cifrado (D-63)**: nacen cifrados la descripción y el texto de las acciones de la incidencia, el
    contenido de la comunicación a familia y el motivo de la excepción de umbral. En claro, declarado:
    sujeto, tipo, origen, nivel, estado, instantes, residente, firmantes, canal y acuses (sostienen la
    lista de abiertas, el escalado y los indicadores).
13. **Sin cambios en**: el relevo (residencia-5 lo construye; aquí N1 sólo queda abierta en el libro), el
    cálculo de «no hecho» (residencia-5, que es quien lo necesita), medicación, escalas y lesiones.

## Alcance

- **Modelo y migración**: umbrales de serie versionados y la plantilla de gravedad como dato; excepción
  por residente; `Incident` con enlaces, `IncidentAction`, `FamilyCommunication`; aviso con sus
  destinatarios, intentos, escalado y acuses; dispositivo de guardia y su sesión de guardia; ajustes del
  centro (minutos de escalado, destinatarios por nivel, servicio sanitario de guardia). CHECK de formato
  en lo cifrado y triggers de inmutabilidad con sus transiciones legítimas (cierre, cambio de nivel por
  acción).
- **Paquete puro**: `gravedadDe` (constante + umbral vigente + excepción → nivel y tipo), con la tabla
  del §3 como test de oro.
- **API**: la puerta envía constantes y tipos de «algo no va bien» por el lote que ya existe; derivación
  en servidor; tarea programada de ausencias; rutas del móvil de guardia (arranque, PIN de guardia,
  avisos pendientes, acuse) detrás de su propio guard de dispositivo; empuje por socket.
- **Puerta** (`apps/tpv-web`, modo puerta): constantes en «lo que toca» y a demanda; tipos en «algo no
  va bien»; el botón de la enfermera encendido; la pantalla 6 diciendo **qué nivel salió, si el aviso
  salió o no y quién lo ha acusado**; «Llama al 112» en N4.
- **Móvil de guardia** (APK, modo guardia): en reposo «De guardia: Lucía · enfermería · turno de tarde» o
  «Nadie de guardia»; el aviso a pantalla completa con habitación, residente (foto con consentimiento),
  qué pasa y nivel; «Voy» con PIN; la recomendación de llamada en N3-N4; lista de avisos del turno.
  Dedos grandes, sistema visual de Mi Piace; nada de salud en la notificación de la pantalla bloqueada
  más allá de «Aviso N2 · habitación 112».
- **Admin**: el libro (abiertas hoy primero, filtro por sujeto y nivel), la ficha de la incidencia
  (cronología, acciones, enlaces, cierre, comunicación a familia), declarar queja y avería, la excepción
  de umbral por residente (sólo `MEDICO`), la configuración de guardia del centro y la plantilla de
  serie en solo lectura con su versión.
- **La devolución del art. 28.3.g** incluye incidencias, acciones, comunicaciones y excepciones.

## Respeta

- Tenants sin residencia no notan nada; un TERMINAL o una puerta no llaman a las rutas de guardia ni al
  revés. Sabotaje para cada cruce.
- `UserRole` no gana valores. Nada de salud en logs ni en el texto de la notificación del sistema.
- Suite, `e2e` y `pnpm e2e:agenda` como estaban; recuerda lo de §18 del done de residencia-3 (Redis).
- Sistema visual y metodología de front de Mi Piace.

## Fuera de alcance (declarado)

Relevo con acuse, panel de dirección y «no hecho» (residencia-5); portal de familias y cualquier envío a
la familia (familias-1); proveedor y no conformidad en el libro (calidad-1); medicación, escalas y
`Lesión` (Fase 2); transcripción de voz (ia-1).

## Cómo se cierra

- Migración con su `down`, aplicada sobre una copia con datos de residencia-1, -2, -1b y -3.
- **Test de oro de la gravedad**: cada fila del §3, más los bordes (37,4 / 37,5 / 37,9 / 38 / 39,4 /
  39,5; 92 / 91 / 88 / 87; 70 / 69 / 50 / 49; 300 / 301; 90 / 91 / 179 / 180), con y sin excepción
  vigente y con excepción caducada. Tablet y servidor dan el mismo nivel.
- Tests de tabla: fiebre tres veces en el turno = una incidencia; sube de N1 a N2 y avisa una vez más;
  ausencia de deposición no duplica cada día; un lote repetido no deriva dos veces; N3 no se autocierra;
  una incidencia de residente sin constancia de familia no se cierra; excepción sólo la crea `MEDICO`.
- **Escalado con reloj falso**: N2 sin nadie de guardia en enfermería → responsable al momento; N2 con
  enfermera que no acusa → responsable a los 5 min; acuse antes → no escala; N3/N4 → los dos a la vez.
- **El aviso sin red, de verdad**: e2e que corta la red de la puerta, registra 38,6, comprueba que la
  puerta dice «NO ha salido», recupera la red y comprueba que el móvil de guardia lo recibe una vez, con
  su hora original.
- **En un Android real** (el de pruebas que tengas): pantalla apagada, app en segundo plano, se dispara
  un N2 y suena. Vídeo corto o capturas en `docs/qa/`, y dilo en el done si no se pudo.
- **Tabla de sabotajes**: borrar una incidencia por SQL · cambiar su nivel por SQL · cerrar un N3 con la
  misma persona · cerrar sin constancia de familia · escribir una acción en claro · un TERMINAL contra
  las rutas de guardia · una puerta acusando un aviso · una excepción de umbral firmada por una auxiliar.
- **Medido**: toques y segundos de «tomar la temperatura» y de «caída sin golpe», contra D-05 y D-16; y
  segundos desde que la puerta envía hasta que suena el móvil de guardia.
- Capturas a 1280×800 de la puerta (constante, tipos, N2 avisado, N2 sin red, N4), del móvil de guardia
  (reposo, aviso, acuse) y del admin (libro, ficha, excepción, configuración) a 390 y escritorio.
- CI verde (`ci`, `smoke`, `e2e`); `COPY` en `infra/Dockerfile` si hace falta.
- `docs/blocks/residencia-4-done.md` con la estructura de la metodología: qué se hizo punto a punto,
  decisiones tomadas sin preguntar, dudas abiertas, qué hay que hacer al desplegar (incluido cómo se
  empareja y se configura el móvil de guardia). Dice si la rama está pusheada y si hay PR.
- Commits pequeños en español, push y **PR contra `master`**. Ni merges ni despliegues.
