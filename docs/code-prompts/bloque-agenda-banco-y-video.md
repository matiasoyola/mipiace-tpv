# Bloque agenda-banco · banco de pruebas completo de la agenda + vídeo «de cero a un día normal»

Rama `agenda-banco`, worktree `~/Developer/Claude/Projects/mipiacetpv-agenda-banco`, desde `master` = `5e903a1`.
Escrito por Dirección el 04-10-2026. **Es trabajo de entrega, no desarrollo nuevo**: prepara la
visita a Sole (frente B) y no rompe la congelación.

## Por qué existe

La agenda está construida, mergeada y en producción (reservas 1-4, 5, 6a, 7a, 9 y mostrador), pero
**nadie la ha usado de principio a fin**: la pasada del 13-09 en el AP11 fue parcial y los e2e de
`apps/api/test-e2e/agenda-*.e2e.ts` prueban la API por trozos. Antes de encenderla en Sole, Matías
quiere dos cosas:

1. **Un banco de pruebas** que recorra la funcionalidad completa por la interfaz real, contra la
   stack real (API + Postgres + admin + TPV), y que se pueda volver a pasar cada vez que se toque la
   agenda.
2. **Un vídeo** del mismo recorrido, desde que se enciende la agenda hasta el final de un día normal
   de uso, que sirva para enseñárselo a Sole y a su equipo (y para vender).

¿Y qué?: Matías sabe **antes de la visita** si la agenda aguanta un día de peluquería, y Sole ve en
5 minutos cómo va a trabajar, en vez de aprenderlo con clientas delante.

## Escenario (uno solo, el de Sole, con datos inventados)

Tenant ficticio **«Peluquería Demo»**, **sin Holded** (los autónomos nuevos empiezan sin Holded,
decisión del 27-09). **Ningún dato real de Sole ni de ninguna clienta.**

- Profesionales: **Marta, Lucía e Irene** (tres, como Sole/Ana/Isa), cada una con su color.
- Servicios con duración real de peluquería: corte (30 min), lavar y peinar (30), tinte (90, **con
  pausa de exposición** en medio, para que otra cita quepa en la pausa), mechas (120), barba (15).
  Al menos uno que sólo sepa hacer una profesional.
- Horario del centro de martes a sábado, 9:00-20:00, con un **festivo** y un **día especial**
  (horario reducido) en la semana del vídeo.
- Clientas: varias **sólo con nombre de pila** (así las apunta Sole) y una con nombre completo y
  teléfono.

## El recorrido (capítulos del vídeo = bloques del banco)

Usa sólo lo que **existe hoy**. Si un paso necesita algo que no está, **no lo construyas**: apúntalo
como hallazgo y sigue.

1. **Encender**: admin → Ajustes → «Agenda de citas» on. El botón aparece en el TPV.
2. **Servicios**: duraciones y pausas en `/admin/agenda-catalog`.
3. **Equipo**: las tres profesionales con color, qué sabe hacer cada una y sus turnos en `/admin/staff`.
4. **Horario del centro**: semana, festivo y día especial.
5. **Panel de salud**: provocar un aviso real (p. ej. un servicio que nadie sabe hacer) y
   arreglarlo hasta que el panel quede limpio.
6. **Reservar desde el TPV**: clienta nueva sólo con nombre, clienta existente buscada, una cita
   dentro de la pausa de un tinte. Y los «no»: en el pasado (rechazada), solapada (rechazada), en el
   festivo (sin huecos), con una profesional que no sabe hacer el servicio.
7. **El día**: vista por profesional, recepción y móvil; mover una cita, cancelar otra, una clienta
   que no viene.
8. **Cobrar**: la clienta llega, se cobra **la cita** (en su borrador, al turno de su instante), uno
   en efectivo con vuelta y otro mixto; la cita queda finalizada.
9. **Cerrar el día**: el turno cuadra con lo cobrado por citas.
10. **Sin red** (si el TPV web lo permite en el banco): alta de una clienta sin cobertura y que se
    sincronice al volver.

## Entregables

### 1 · El banco (Playwright, en el repo)

- Paquete nuevo de workspace `apps/e2e-ui` con `@playwright/test` como dependencia de desarrollo.
  **No entra en la CI todavía**: se lanza a mano con un script raíz `pnpm e2e:agenda`. Que levante (o
  documente cómo levantar) Postgres de `docker-compose.yml`, la API, el admin y el TPV, y que siembre
  el escenario con un seed propio idempotente (`apps/e2e-ui/seed/peluqueria-demo.ts`), nunca contra
  producción.
- Un spec por capítulo, en orden, que **además de pulsar comprueba el estado**: en pantalla y en la
  BD (citas, tickets, turno). Los «no» del capítulo 6 comprueban el mensaje que ve la cajera y que la
  BD no cambió. El solape lo para el `EXCLUDE` de **Postgres real**: es la primera vez que se ve
  funcionar desde la interfaz (hasta ahora se simulaba en tests); dilo en el done.
- Viewports: **AP11/AP12 en horizontal = 1280×800 CSS a `deviceScaleFactor` 1,5** (medido en
  `reservas-mostrador-done.md` §6) para el TPV; 1280 para el admin; 390 para la vista móvil.
- **Tabla de sabotajes** para los specs que más importan (romper una línea de producción → qué spec
  se pone rojo y con qué mensaje) y **qué NO cubre** el banco (impresora, teclado propio en hierro,
  lector, red real del AP12…).

### 2 · El vídeo

- Grabado por Playwright (`video: 'on'`) recorriendo los capítulos **a ritmo humano** (pausas entre
  pasos, nada de clics instantáneos) y con **rótulos en pantalla en español** al empezar cada
  capítulo y en cada paso importante («Lucía no sabe hacer mechas: no aparece»). El rótulo se pinta
  con un overlay inyectado por el propio spec, no tocando la app.
- Montaje con `ffmpeg`: un MP4 por capítulo y uno completo, **1080p, menos de 10 minutos en total**.
  Portada inicial con el título «La agenda, de cero a un día normal».
- **Los vídeos no entran en git** (pesan): van a `~/Developer/Claude/Projects/mipiacetpv-media/agenda/`
  y el done dice dónde están y cuánto dura cada capítulo.

### 3 · La pasada en hierro (documento, no código)

`docs/qa/agenda-banco-manual.md`: la lista corta de lo que el banco no puede probar y hay que mirar
en el AP11/AP12 en la visita (impresión del ticket de una cita, teclado propio en los importes,
rendimiento con el WebView real, uso con el dedo). Cada punto con qué se hace y qué se espera ver.

## Reglas

- **No tocar código de producción.** Si el banco destapa un fallo, se apunta en el done con
  severidad (🔴 impide usarla en Sole · 🟡 molesta · ⚪ cosmético), cómo reproducirlo y en qué
  capítulo sale. Dirección decide qué se arregla antes de la visita.
- Nada de datos reales, nada contra producción, ninguna credencial en el repo ni en el vídeo.
- Recuerda las trampas conocidas: el `.env` de desarrollo tapa variables (`reference_mock_catalog_tests`)
  y el vitest local se cuelga en el Mac (aquí no se usa vitest: es Playwright).

## Cómo se cierra

- `pnpm e2e:agenda` verde de punta a punta, dos veces seguidas (el seed es idempotente).
- `docs/blocks/agenda-banco-done.md` con: cómo se lanza, la lista de capítulos con lo que comprueba
  cada uno, la tabla de sabotajes, lo que no cubre, **los hallazgos con severidad** y dónde están los
  vídeos.
- Commits pequeños en español, push y **PR contra `master`**. Sin merge.
