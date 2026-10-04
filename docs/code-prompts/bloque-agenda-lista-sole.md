# Bloque agenda-lista · lo que falta para encender la agenda en Sole

Rama `agenda-lista`, worktree `~/Developer/Claude/Projects/mipiacetpv-agenda-lista`, desde `master` = `d362c4f`.
Frente B del tablero (entregar lo que ya está hecho). Escrito por Dirección el 04-10-2026.

Lee antes: `docs/blocks/agenda-banco-done.md` §3 (los hallazgos, con fichero y línea) y
`apps/e2e-ui/README.md` (cómo se lanza el banco). Este bloque arregla los hallazgos que Dirección ha
decidido que bloquean la visita, y **el banco es su red**: cada arreglo se cierra con su spec del
banco en verde y con un sabotaje que lo ponga rojo.

## Por qué existe

La agenda está en producción, apagada. El 04-10 el banco `agenda-banco` la recorrió entera por la
interfaz real y encontró cosas que Sole va a pisar **el primer día**: Sole, Ana e Isa llevan hoy la
agenda en un Excel con tres columnas, las clientas cambian de hora a diario, y quien encienda la
agenda en su AP12 es Matías, delante de ella. Regla de Matías: con un solo cliente por vertical, su
forma real de trabajar es la especificación; un filo que su patrón va a pisar no se deja.

¿Y qué?: la recepción de Sole abre la agenda y ve de quién es cada cita, cambia una cita de hora sin
perderla, no le ofrecen un servicio que esa profesional no hace, y quien enciende la agenda ve que se
ha encendido.

## Alcance (sólo esto; el resto de hallazgos va a la cola)

### 1 · La agenda conoce los nombres sin pasar por Clientes (hallazgo 🟡 1)

Hoy el nombre sale de `loadClientsFromCache()` y esa caché sólo la llena la pantalla Clientes: en un
dispositivo recién emparejado la rejilla dice «Sin nombre» en todas las citas.
- La agenda, al abrirse, se asegura de tener la caché de clientes: si está vacía o es más vieja que
  la última sincronización, **pide lo mismo que pide la pantalla Clientes** (reutiliza esa función;
  no dupliques la llamada ni su lógica de mezcla). Sin red, se queda con lo que haya y no rompe.
- Respeta la mezcla de `refrescarCachesLocales` (no reemplazar; ver el comentario: una clienta recién
  elegida no puede volver a «Sin nombre» delante de ella).
- El spec del capítulo 7 que hoy comprueba «Sin nombre hasta que alguien abre Clientes» pasa a
  comprobar lo contrario: dispositivo recién emparejado, se abre la agenda **sin** pasar por Clientes,
  y se ve el nombre.

### 2 · Mover una cita desde la agenda (hallazgo 🟡 6)

La API (`PATCH /agenda/appointments/:id` con `start`) y el cliente (`patchAppointment`) ya lo hacen;
la pantalla sólo manda `status` (`changeStatus`, ~651).
- En el detalle de la cita: **cambiar día y hora** (y profesional, si la API lo acepta; si no,
  dilo y no lo inventes). Con el mismo teclado/selector que el alta, para no enseñar dos maneras.
- Si el motor dice que no cabe, se ve **el motivo y las alternativas que ya devuelve el motor**, como
  en el alta. La cita no se pierde ni cambia de estado si el movimiento falla.
- Sin red: sigue el camino que ya usa el alta (cola/outbox) y el mismo aviso; si el PATCH de `start`
  no tiene camino offline hoy, **no lo inventes**: sin red, el botón dice que hace falta conexión.
- Arrastrar la tarjeta en la rejilla: **no** en este bloque. Un detalle claro con dedo de peluquera
  vale más que un arrastre que falla en el AP12.
- El spec del capítulo 7 que hoy se pone rojo «el día que exista» se convierte en el test de verdad:
  mover a un hueco libre (BD y pantalla), mover a uno ocupado (motivo, alternativas, BD sin tocar),
  y que el histórico de la cita se conserva (mismo id).

### 3 · Sólo los servicios que la profesional sabe hacer (hallazgo 🟡 4)

`bookableServices` (~1756) sólo filtra por «servicio con duración»; no cruza con la matriz.
- Al dar una cita **en la columna de una profesional**, la lista ofrece sólo lo que ella hace. Sin
  profesional elegida (alta desde «primer hueco libre» o similar), se ofrecen todos y el motor elige
  a quien sabe.
- Si una profesional no hace **ningún** servicio, el panel lo dice con su nombre y manda a la matriz
  (a quien pueda configurarla), en vez de una lista vacía.
- El «no» por matriz que hoy llega como «no hay hueco» deja de poder producirse desde la pantalla;
  el spec del capítulo 6 «quien no sabe» se adapta y lo comprueba.

### 4 · La dueña llega a «Ajustes» y ve que la agenda se ha encendido (hallazgos 🟡 3 y ⚪ 7)

- «Ajustes» está marcada `superAdminOnly` (`AdminShell.tsx:211`). **Antes de cambiarlo, mira por qué
  está así** (`git log -S` sobre esa línea: entró con H1 / «Dejar Holded») y qué hay en
  `/admin/settings`. La regla: la **dueña** (OWNER) tiene que poder encender y apagar la agenda desde
  su menú. Si en Ajustes hay cosas que no debe tocar, la solución es separar (o esconder esas
  secciones por rol), no darle todo. Dilo en el done.
- Al guardar el interruptor de la agenda, **el menú gana sus secciones sin recargar** (hoy el shell
  lee las capacidades una vez al montar). Lo mismo al apagarla.
- El panel de salud se refresca solo al volver de la matriz (o al recuperar el foco): la cifra no
  puede seguir diciendo 2 cuando ya está arreglado.

## La APK

Todo lo de 1–3 vive en el TPV, y **la APK lleva su propio bundle** (A4): sin APK nueva, el AP12 de
Sole no ve nada de esto. Sube la versión siguiendo exactamente cómo se hizo la 1.19.0 (búscalo en git
y en el done de A3/A4) a **1.20.0**, y deja la APK construida y comprobada sobre el binario (versión,
origen de producción, nada de configuración de laboratorio: recuerda el incidente del 04-09). **No la
publiques** en `/apk`: eso lo hace Dirección tras el merge.

## Respeta

- El motor de reservas (`engine.ts`) **no se toca**: todo este bloque es de pantalla y de caché. La
  pausa del tinte (hallazgo 2) va a la cola y necesita motor.
- El fijado de profesional duplicado en `engine.ts:207` y `:429` (sabotajes del banco): no lo
  «limpies» aquí.
- El cobro de la cita (capítulo 8) y el cierre (9) no cambian: el banco los vigila.

## Fuera de alcance (declarado)

- Pausa de exposición del tinte (🟡 2), aviso de salud que una profesional no puede arreglar (🟡 5),
  alta sin red que no cierra el trámite (⚪ 8), etiquetas sin `htmlFor` y toast sin gancho (⚪ 9).
- Arrastrar citas en la rejilla.

## Cómo se cierra

- `pnpm e2e:agenda` **entero en verde dos veces seguidas**, con los specs de los capítulos 6 y 7
  adaptados como arriba, y la suite normal verde **en CI** (`ci`, `smoke`, `e2e`). Recuerda que un
  paquete nuevo o un manifest nuevo necesita su `COPY` en `infra/Dockerfile` (el test de manifests lo
  vigila) y el mock literal de `catalog.js`.
- Tests unitarios de lo que se pueda probar sin navegador (el filtro por matriz, la decisión de
  refrescar la caché, el refresco de capacidades).
- **Tabla de sabotajes**: por cada arreglo (1 nombres sin Clientes, 2 mover libre/ocupado/mismo id,
  3 filtro por matriz, 4 menú de la dueña y refresco sin recargar, salud refrescada), qué línea de
  producción rompes, qué spec se pone rojo y con qué mensaje real.
- **Prueba en hierro** en el AP11 con la APK 1.20.0 construida (procedimiento de
  `project_pruebas_fisicas_ap11` / done de A5): emparejar, encender la agenda desde el menú de la
  dueña, abrir la agenda sin pasar por Clientes, dar una cita, moverla, y el «no» de quien no sabe.
  Capturas en `docs/qa/`.
- Un vídeo corto (rodado con el banco, como el de `agenda-banco`) de **mover una cita**: es lo que
  se le enseña a Sole.
- `docs/blocks/agenda-lista-done.md`: qué se hizo en cada punto, la decisión sobre Ajustes, la tabla
  de sabotajes, lo que no cubre, la APK (versión, cómo se construyó, cómo se comprobó) y cómo se
  despliega (¿migración? no debería). Actualiza la línea del frente B del tablero. Dice si la rama
  está pusheada y si hay PR.
- Commits pequeños en español, push de la rama y **PR contra `master`**. Ni merges, ni despliegues,
  ni publicar la APK: eso lo hace Dirección.
