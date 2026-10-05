# Bloque mover-con-otra · cambiar de peluquera al mover una cita

Rama `mover-con-otra`, worktree `~/Developer/Claude/Projects/mipiacetpv-mover-con-otra`, desde `master` = `63149b3`
(agenda-lista ya mergeada y desplegada; APK 1.20.0 publicada). Frente B del tablero. Escrito por Dirección el 05-10-2026.

Lee antes: `docs/blocks/agenda-lista-done.md` §2 y §2b (mover conserva la profesional, y por qué el fijado
vive en la ruta y no en el motor) y `apps/e2e-ui/README.md` (cómo se lanza el banco, con puertos propios).

## Por qué existe

La agenda de Sole es una rejilla con una columna por peluquera (Sole, Ana, Isa). agenda-lista dejó mover una
cita **de hora** conservando su peluquera, y aplazó a «otro bloque» moverla **de peluquera**. Matías, antes
de encenderla en el AP12: «la agenda son huecos por peluquera». Si una no puede, la clienta se va con otra, y
hoy la única salida es cancelar y volver a dar la cita, que **pierde el histórico de la original**. Con un solo
cliente por vertical, su forma de trabajar es la especificación: un filo que va a pisar no se deja.

¿Y qué?: la recepción pasa la cita de Carmen de Ana a Isa (a la misma hora o a otra) en dos toques, la cita
sigue siendo la misma, con su id y su histórico, y nunca le ofrecen una peluquera que no hace ese servicio.

## Lo que ya existe (no lo reconstruyas)

- **El motor ya sabe.** `reschedule(tenantId, id, start, staffUserId?)` fija a quien le pasen, en los dos
  sitios del motor que fijan y también en `computeSlots`, de modo que las alternativas de un «no» son de ella.
- **El store ya reescribe las asignaciones**: `store.reschedule` borra las de la cita e inserta las del plan
  dentro de una transacción con `withRaceRetry`.
- **La ruta** (`apps/api/src/agenda/routes.ts`, PATCH `/agenda/appointments/:id`) hoy fija siempre la
  peluquera actual (`suProfesional`), y el cuerpo admite sólo `{ status?, start? }`.
- **La matriz en la pantalla**: `AgendaPage` ya tiene `skillsPorStaff`, y el cruce puro vive en
  `lib/agenda-health.ts` (`serviciosQueSabeHacer` y compañía).

## Alcance (sólo esto)

### 1 · API: el PATCH acepta `staffUserId`
- `staffUserId` opcional (uuid) en el cuerpo, **sólo junto a `start`**. Con `status` o solo se rechaza con 400
  y un mensaje claro (cambiar de peluquera es mover).
- Si viene, es la peluquera fijada; si no viene, sigue siendo la actual (agenda-lista intacto: ningún llamante
  existente cambia de comportamiento).
- Debe ser personal **de este tenant**. Si no lo es: 404 o 400, nunca un 500 ni una asignación cruzada entre
  tenants. Escribe un test que lo pruebe.
- Si no sabe hacer alguno de los servicios de la cita, el «no» tiene que **decir eso con su nombre**, no hablar
  de huecos. Mira qué devuelve hoy el motor con una fijada sin skill; si no lo distingue, distínguelo en la
  ruta (comprobando la matriz antes de llamar), no tocando la lógica del motor.
- **Mismo inicio y otra peluquera tiene que funcionar**: es el caso más común («a la misma hora, pero con
  Isa»). Ojo con lo que el done de agenda-lista §2b deja dicho: `reschedule` carga la ocupación **sin excluir
  la propia cita**. Para otra peluquera no debería estorbar, porque la ocupación es de la anterior, pero
  pruébalo con un test e2e. Para la misma peluquera, el solape con su propia hora sigue fuera de alcance.

### 2 · TPV: «Con quién» en la hoja de mover (`MoverCita`)
- Un selector de peluquera encima del día, que **arranca en la actual**. Con la actual elegida, todo sigue
  exactamente como hoy.
- **Sólo se ofrecen las que saben hacer todos los servicios de la cita**, según la matriz. Sin matriz (no
  llegó, o no hay red), todas, y el motor sigue siendo la puerta: el mismo criterio que agenda-lista §3.
- «Buscar hueco» busca los huecos **de la elegida**. Al cambiar de peluquera se limpian los chips y el error.
- Al mover, el PATCH manda `start` y `staffUserId` sólo si es distinta de la actual.
- Al acabar, la cita aparece en **la columna nueva** y la hoja se pliega, como hoy.
- Botones de dedo de peluquera (h-11 o más), el motivo de lo desactivado en texto visible y nunca en `title`
  (`docs/ux-principles.md` §6). Sin red, el mismo aviso que ya tiene mover.
- Arrastrar la tarjeta a otra columna: **no** (mismo criterio que agenda-lista).

## Tests y sabotajes (el criterio de siempre: un test vale por ponerse rojo)

- **API e2e** (`agenda-suelo.e2e.ts` o fichero propio): mover a otra peluquera a la misma hora (mismo id, la
  asignación STAFF activa es la nueva, la anterior queda libre a esa hora); a otra hora; peluquera que no hace
  el servicio, con su motivo; peluquera de otro tenant; `staffUserId` sin `start`; y sin `staffUserId`, que
  sigue conservando la actual (el caso 17/18 de agenda-lista no puede romperse).
- **Banco** (`apps/e2e-ui`, capítulo 7): `mover una cita a otra peluquera: de Marta a Lucía, mismo id`, por la
  interfaz real, comprobando pantalla y BD. Y uno de «el selector no ofrece a quien no sabe».
- **Unitarios** de lo que sea puro (qué peluqueras se ofrecen).
- **Tabla de sabotajes** en el done, con el mensaje rojo literal. Como mínimo: la ruta ignora `staffUserId`;
  el selector ofrece a todas; la búsqueda de huecos usa la actual en vez de la elegida. Si alguno deja el banco
  en verde, dilo y di qué capa lo caza (lo de agenda-lista 7b).
- `pnpm e2e:agenda` entero en verde **dos veces**, con puertos propios. La suite normal, lo del job `ci`
  (typecheck y builds) y el job `e2e` contra una base **propia** de esta sesión, que la suite hace
  `DROP SCHEMA`.

## La APK

El cambio vive en el TPV y la APK lleva su bundle (A4). Constrúyela con
`apps/tpv-android/scripts/build-release-apk.sh 1.21.0` desde el commit final de código (árbol limpio) y
compruébala **sobre el binario** como en agenda-lista §7: versión, sidecar, origen de producción, sin Service
Worker y una frase nueva tuya dentro del bundle. **No la publiques**: lo hace Dirección tras el merge.

## Respeta

- La lógica del motor (`planForStart`, `computeSlots`, el fijado duplicado de `engine.ts`) **no se toca**. El
  parámetro ya existe.
- El cobro de la cita y el cierre no cambian: el banco los vigila.
- **Sin migración.** Si crees que la necesitas, para y dilo.

## Fuera de alcance (declarado)

Arrastrar entre columnas; mover a una hora que solapa con la propia cita en la misma peluquera; cambiar los
servicios al mover; mover sin red; la pausa del tinte.

## Cierre

`docs/blocks/mover-con-otra-done.md` con lo hecho, la tabla de sabotajes, lo que no cubre y los datos de la APK.
Push de la rama y PR contra master con el done como cuerpo. Ni merge, ni despliegue, ni publicar: eso lo hace
Dirección. **Hay prisa**: Matías retrasa la visita a Sole por esto, así que no abras nada fuera del alcance.
