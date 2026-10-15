# Bloque residencia-3 · la puerta: PIN, lo que toca, «como siempre» y el registro sin red

Rama `residencia-3`, worktree `~/Developer/Claude/Projects/mipiacetpv-residencia-3`, desde
`origin/master`. PR contra `master`. Escrito el 15-10-2026 desde el proyecto de Jardín de Gredos.

Lee antes, en este orden:
1. `docs/residencia/00-decisiones.md` (D-05, D-07, D-08, D-12 a D-19, D-31, D-51, D-52, D-54, D-59,
   D-63 y **D-64**) y `docs/residencia/rama-catalogo-de-controles.md` §2, §4 y §7.
2. `docs/blocks/residencia-1-done.md` (la puerta como dispositivo `ROOM`, `puerta-auth.ts`,
   `PuertaScreen.tsx`, `turnoDe` y su §11.5: un registro sin turno se guarda, no se rechaza).
3. `docs/blocks/residencia-2-done.md` (catálogo, plan, `queToca`, y la obligación de §11.5:
   **el toque «como siempre» escribe un registro por cada dimensión OBS activa, con su valor**).
4. `docs/blocks/residencia-1b-done.md` y `docs/blocks/clinica-7-done.md` §3: **el registro nace
   cifrado**, con su `sitio*` en `cripto-campos.ts` y su CHECK de formato.
5. Cómo hace hoy el TPV el trabajo sin red (IndexedDB + cola outbox con worker) y cómo lo hace la
   tablet de cocina: aquí no se inventa otro mecanismo, se reutiliza.

## Por qué existe

Es la pieza que justifica todo lo anterior: hoy el cuidado se hace de memoria y se apunta al final del
turno en una hoja que vive en la sala de terapia. Con este bloque se apunta **en la puerta y en el
momento**, a pulsaciones, y el registro de calidad sale solo.

¿Y qué?: la auxiliar marca «hecho» en dos segundos sin moverse de la habitación (D-05: ≤15 s por
registro con desplazamiento, ≤30 min por jornada), y la dirección deja de reconstruir hojas de cambios
posturales para AENOR: ya están, firmadas con persona, rol y hora. Y sin red no se pierde nada.

## El mockup, validado por Matías (D-64)

Seis pantallas, tablet de 10" apaisada (1280×800) en la pared. Sistema visual de Mi Piace (DM Sans,
fondo stone, coral como único acento), dedos grandes: nada pulsable por debajo de 56 px; la acción
principal, 72 px o más.

1. **En reposo** (la evolución de la `PuertaScreen` actual): planta, turno con su punto de color y la
   hora arriba; el número de la habitación enorme; una tarjeta por cama con **foto, «Cama A» y el
   nombre**; abajo, un botón coral a todo el ancho «Toca para registrar». **Ni un dato de salud**.
2. **PIN**: a la izquierda «Habitación 112 · turno de mañana», «Tu PIN», «Lo que registres queda
   firmado con tu nombre y la hora», los puntos del PIN y «Volver a la puerta»; a la derecha un
   teclado 3×4 de teclas de 120 px. Si la persona tiene **dos roles de cuidado vivos**, después del
   PIN elige con cuál entra (D-31); con uno, no se le pregunta.
3. **Lo que toca ahora**: cabecera con el número, «Nombre · rol · turno · hora», «Se cierra sola en
   0:45» y «Terminar». Una columna por residente con su foto pequeña y su cama, y en cada una:
   - **«¿Cómo está hoy?»**: botón grande coral **«Como siempre»** y al lado «No como siempre». Si ya
     se registró en este turno, en su lugar una franja verde «Como siempre · lo marcó Ana a las 08:20».
   - **«Toca ahora»**: lo que devuelve `queToca` para esa franja; cada línea con su nombre, su pista
     («desde las 10:00 · cada 3 h») y un botón oscuro **«Hecho»**. Las comidas, con sus cuatro
     opciones en fila (todo / la mitad / poco / nada). Lo ya hecho queda en gris discontinuo con quién
     y cuándo, y un «Corregir».
   - Abajo: **«+ Higiene»** y **«+ Deposición»** (lo `ON_DEMAND`: sólo se cuenta) y **«Algo no va
     bien»** en ámbar.
4. **No está como siempre**: «Toca solo lo que no está como siempre. Lo demás se guarda como siempre.»
   Las siete dimensiones OBS como tarjetas («como siempre» debajo del nombre); la que se toca se abre
   con sus opciones ordinales en fila y la elegida en coral. Abajo «Además, algo no va bien» y
   «Guardar · 1 cambio».
5. **Algo no va bien**: «No hace falta saber qué es. Con decirlo basta: queda apuntado y lo verá el
   turno siguiente.» A la izquierda, un botón oscuro grande **«Mantén pulsado y cuéntalo»** (nota de
   voz, opcional); a la derecha, «O escríbelo en dos palabras». Abajo «Apuntarlo para el relevo» y
   **«No puede esperar: avisar a la enfermera»** (ver decisión 9).
6. **Apuntado**: si no hay red, banda ámbar «Sin red. Lo guarda la tablet y lo envía sola cuando
   vuelva. No hay que repetir nada.»; check verde, «Apuntado», «Firmado por Ana López · 10:42 · turno
   de mañana», la lista de lo apuntado con su estado («en la tablet» / «enviado»), «Deshacer el
   último» y «Seguir en la 112». Vuelve a reposo a los 10 s sin tocar nada.

## Decisiones de producto ya tomadas — no se re-debaten

1. **`CareRecord` es la evidencia**: una fila por cosa registrada (un «hecho», un valor ordinal, un
   «como siempre» de una dimensión, un «a demanda», una nota). **Inmutable**: no se edita ni se
   borra. «Corregir» crea otra fila que apunta a la corregida; «Deshacer el último» (sólo quien la
   firmó, sólo en la ventana de la pantalla 6) la **anula** con autor y hora, sin borrarla.
2. **Firma = persona + capacidad** (D-31): usuario, asignación de rol de cuidado con la que entró,
   dispositivo, instante de la tablet (`recordedAt`) e instante de llegada al servidor
   (`receivedAt`). Apunta a la **versión** del `ControlType` con la que se registró (residencia-2 §1).
3. **Se adscribe al turno en el que ocurre** (D-54), calculado en la tablet con `turnoDe`; si no cae
   en ningún turno se guarda **sin turno** y se pinta como aviso. Un cuidado hecho se apunta siempre.
4. **«Como siempre» es un registro con valor** (D-15): un toque escribe una fila por cada dimensión
   OBS activa en el centro con `isAsUsual`. «No como siempre» escribe la(s) cambiada(s) con su valor
   y las demás como siempre. Una vez por residente y turno; repetirlo en el mismo turno sustituye a lo
   anterior por la vía de la corrección, no duplica.
5. **Sin red de verdad** (ADR-01, D-52): la tablet registra contra su copia local y encola; el envío
   es idempotente por el **uuid generado en la tablet**, que es además el que necesita el AAD. El
   servidor acepta el `recordedAt` de la tablet dentro de límites (no futuro más allá de un margen; no
   más viejo que un plazo razonable que decides tú y explicas) y guarda ambos instantes.
6. **Cifrado (D-63)**: el valor del registro y el texto de la nota van cifrados con la maquinaria de
   clinica-7 desde el primer día. En claro, declarado: `controlTypeId`, residente, instante, turno,
   firmante y estado de anulación — sostienen `queToca`, el relevo y los indicadores, como
   `control_code` en el plan.
7. **La caché de la tablet**: guarda sólo lo de SU habitación (residentes, plan vigente, ajustes del
   centro, turnos, momentos, catálogo vigente) para poder pintar «lo que toca» y registrar sin red. Se
   vacía al revocar el dispositivo. Nada de salud se pinta antes del PIN (pantalla 1).
8. **Sesión en la puerta**: se cierra sola tras un minuto sin tocar y al pulsar «Terminar». El PIN
   deja **línea en el registro de accesos** con persona (decisión 3 de residencia-1): ésta es la
   pantalla que sí identifica a alguien. Alcance por zona (D-51): quien entra en una habitación fuera
   de su zona ve «Esta habitación no es de tu zona» y no ve datos; los de alcance total (DUE, médico,
   calidad) entran en todas.
9. **«No puede esperar: avisar a la enfermera»**: el aviso inmediato real (D-19) llega con la
   gravedad y las incidencias en residencia-4. En este bloque el botón **no se pinta**: un botón que
   parece avisar y no avisa es peor que no tenerlo. En su sitio, el texto «Si no puede esperar, avisa
   a la enfermera en persona». Deja el hueco preparado para encenderlo en residencia-4.
10. **Nota de voz**: se graba en la tablet, viaja con la cola y se guarda **cifrada como fichero**
    (cabecera `MPC1`, como las fotos clínicas), para que la DUE y el relevo la escuchen. Transcribirla
    y descartar el audio es ia-1 (ADR-02). Texto y voz son opcionales: «algo no va bien» sin nada más
    es un registro completo (D-13).
11. **Fuera de este bloque, declarado**: las constantes (`MEASURE`: tensión, glucemia…), sus
    umbrales y los eventos derivados son residencia-4. Si el plan de un residente tiene una línea
    `MEASURE`, la puerta **no la pinta** todavía y se dice en el done.
12. **La foto del residente** (pedida por Matías, D-64): se sube desde su ficha en el admin, se guarda
    cifrada como fichero y sólo se pinta si en la ficha consta el **consentimiento de imagen** (quién lo
    dio —residente o familiar responsable—, cuándo y quién lo anotó). Sin consentimiento, las iniciales
    en el mismo hueco. La puerta en reposo la recibe por la identidad del dispositivo, igual que el
    nombre.

## Alcance

- Modelo y migración: `CareRecord` (con corrección y anulación), adjunto de voz, foto y
  consentimiento de imagen del residente. CHECK de formato en lo cifrado y triggers de inmutabilidad
  como los de la historia clínica, con su transición legítima de anulación.
- API de la puerta (detrás de `requirePuertaDevice`): arranque con la caché de la habitación; PIN y
  elección de rol; envío por lotes idempotente; lo registrado hoy para pintar lo hecho y «lo marcó…».
- La puerta en la APK (`apps/tpv-web`, «modo puerta»): las seis pantallas del mockup, `queToca` del
  paquete puro ejecutándose en la tablet, la cola sin red reutilizando la del TPV.
- Admin: subir la foto y anotar el consentimiento de imagen en la ficha del residente; en la ficha,
  una vista de solo lectura de lo registrado hoy por turno (la prueba de que llega).
- **La devolución del art. 28.3.g** (`clinica/exportacion.ts`) pasa a incluir la ficha, el plan y el
  registro de los residentes (deuda anotada en residencia-1b §12.4).

## Respeta

- Tenants sin residencia no notan nada; un TERMINAL no puede llamar a las rutas de la puerta ni al
  revés (ya hay sabotaje en residencia-1, que siga verde).
- `UserRole` no gana valores. Nada de salud en logs, ni el audio ni su transcripción.
- Suite, `e2e` y `pnpm e2e:agenda` como estaban; si los puertos los tiene otra sesión, dilo y no lo
  pises.
- Sistema visual y metodología de front de Mi Piace; nada de animaciones en acciones de alta
  frecuencia («Hecho» no se anima: cambia de estado).

## Fuera de alcance (declarado)

Constantes, umbrales, eventos derivados, libro de incidencias, avisos y comunicación a familia
(residencia-4); relevo con acuse y panel de dirección (residencia-5); medicación (Fase 2);
transcripción de la voz (ia-1).

## Cómo se cierra

- Migración con su `down`, aplicada sobre una copia con datos de residencia-1, -2 y -1b.
- Tests de tabla: «como siempre» escribe N filas (N = dimensiones OBS activas); «no como siempre» con
  una cambiada escribe 1 + (N−1); repetir en el turno corrige sin duplicar; un envío repetido no
  duplica (idempotencia); `recordedAt` fuera de límites se rechaza con su código; registro sin turno se
  guarda con aviso; anular sólo lo propio y en la ventana; corregir crea fila nueva; lo cifrado se
  escribe cifrado y un valor movido de fila no se descifra; foto sin consentimiento no se sirve; una
  puerta no ve otra habitación; fuera de zona no se ven datos.
- **Sin red, de verdad**: un e2e que corta la red, registra tres cosas, reabre la app, recupera la red
  y comprueba que llegan una vez, con su `recordedAt` original y su turno.
- **Tabla de sabotajes**: borrar una fila de `CareRecord` por SQL · editar su valor · escribir el valor
  en claro · reenviar el mismo lote · cambiar la hora de la tablet a mañana · pedir la foto sin
  consentimiento · un TERMINAL contra la puerta. Qué rompes, qué test se pone rojo y con qué mensaje.
- **Medido**: cuántos toques y cuántos segundos cuesta el caso normal («como siempre» + dos «hecho»)
  y el caso con algo; contrástalo con D-05 y D-16 en el done.
- Capturas de las seis pantallas a 1280×800 y de la ficha del admin (390 y escritorio) en `docs/qa/`.
- CI verde (`ci`, `smoke`, `e2e`); `COPY` en `infra/Dockerfile` si hace falta.
- `docs/blocks/residencia-3-done.md` con la estructura de la metodología: qué se hizo punto a punto,
  decisiones tomadas sin preguntar, dudas abiertas, qué hay que hacer al desplegar. Dice si la rama
  está pusheada y si hay PR.
- Commits pequeños en español, push y **PR contra `master`**. Ni merges ni despliegues.
