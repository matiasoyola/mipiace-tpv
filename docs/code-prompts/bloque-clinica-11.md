# Bloque clinica-11 · lo que deja entrar a los pacientes de Rosario

Rama `clinica-11`, worktree `~/Developer/Claude/Projects/mipiacetpv-clinica-11`, desde `origin/master` (con pin-1
mergeado). Escrito el 29-10-2026. Vertical **clínica**. Va **antes** de que entre el primer paciente real de Rosario:
el bloque `cogecop-1` (importador) corre contra producción solo con éste desplegado.

Lee antes:
1. `apps/api/src/lib/sentry.ts`, `apps/tpv-web/src/lib/sentry.ts`, `apps/admin/src/lib/sentry.ts`.
2. `apps/api/src/clinica/cripto-campos.ts` y el comentario de `ClinicalEntry.body` en `schema.prisma`
   («ESTE CAMPO NO SE ESCRIBE EN NINGÚN LOG. Ni en el de la aplicación, ni en Sentry, ni en un mensaje de error»).
   Hoy esa frase **no se cumple**: es la razón de este bloque.
3. `apps/api/src/onboarding-health.ts` (o donde viva el check «Cajero técnico provisionado», `requires: "caja"`) y
   `apps/api/src/workers/initial-sync-worker.ts`.
4. El flujo de apertura de turno del TPV (pantalla «Abrir turno») y la norma de cierre de caja diario.

## Por qué existe

Rosario (podología) va a meter 3.681 pacientes y 9.569 visitas de su programa anterior. Antes hay tres cosas que
no pueden estar como están:

- **Sentry recibe datos de salud.** API, TPV y panel inician Sentry sin `beforeSend`. `@sentry/node` 10 adjunta el
  cuerpo de la petición entrante a los errores: un error en una ruta clínica manda el texto en claro (antes de
  cifrar) a un tercero. En el TPV, los breadcrumbs de interfaz (clics, textos de botones, consola, URLs) pueden
  llevar nombres de pacientes.
- En una clínica no se abre turno: la podóloga llega, atiende y cobra.
- Un check en rojo que no es un fallo enseña a desconfiar de todos los checks.

¿Y qué?: **los datos de salud de los pacientes no salen de nuestro servidor ni en un error**, y la podóloga cobra la
primera sesión del día sin un paso que no le sirve de nada.

## Decisiones (Matías, 28-10) — no se re-debaten

- En clínica **no hay pantalla de «Abrir turno»**: la caja se abre sola al primer cobro del día con el fondo que dejó
  el último cierre. La norma de un cierre por día y por caja se mantiene; un descuadre se ve en el cierre.
- Sin impresora en la consulta.
- El cajero técnico solo existe con Holded: sin Holded el check no aplica.

## Lo que entra

1. **Sentry sin datos de salud, en las tres apps.**
   - API: `sendDefaultPii: false`; `beforeSend` / `beforeSendTransaction` que **quitan siempre** `request.data`,
     `request.cookies`, `request.query_string` y cabeceras salvo una lista blanca corta; `extra` y `contexts`
     filtrados igual. Ninguna integración que capture cuerpos (revisar `requestDataIntegration` y similares de la v10:
     desactivar lo que adjunte cuerpo). Los mensajes de error de rutas clínicas no llevan valores (si algún `throw`
     concatena texto del paciente, se cambia).
   - TPV y panel: `beforeBreadcrumb` que descarta los de UI (`ui.click`, `ui.input`), consola y los de navegación
     **en rutas clínicas**; `beforeSend` que quita `request.data`, y la URL se recorta a la ruta sin parámetros de
     paciente (o se sustituye el id por `:id`). Nada de Replay.
   - Usuario en Sentry: solo id interno y tenant. Nunca nombre ni email.
   - **Test que lo sabotee** (el criterio de la casa: un test vale si se pone rojo al romper el código): un error
     forzado en una ruta clínica con un cuerpo que lleva un centinela (`"PACIENTE-CENTINELA"`) → el evento que llega
     al transporte falso **no contiene el centinela en ningún sitio** (JSON serializado entero). Igual en el TPV con un
     breadcrumb que lo lleve. Sabotaje: quitar el `beforeSend` → rojo.
2. **Clínica sin «Abrir turno».** En cuentas de vertical clínica, el primer cobro del día con la caja cerrada abre el
   turno solo, con el fondo del último cierre (0 si no hay ninguno), a nombre de quien cobra, y queda en la
   auditoría como apertura automática. La pantalla de «Abrir turno» no aparece. El cierre del día sigue igual. Las
   demás verticales no cambian (test que lo pruebe en hostelería).
3. **Check «Cajero técnico provisionado»**: no aplica a cuentas sin Holded (ni verde ni rojo: no sale).
4. **Barra de la agenda a 390 px**: «Dar cita» se queda fuera en el móvil (medido en pin-1). Que quepa o pase a un
   botón flotante; en la Lenovo (1280×800) no cambia nada.

## Lo que NO entra

- Pie de riesgo (H9), textos de consentimiento (H10) y niveles de quiropodia: dependen de lo que conteste Rosario.
- La lista de lesiones y el importador: van en `cogecop-1`.
- Cambiar de proveedor de errores o autoalojarlo.

## Cómo se da por hecho

- Suite verde en local y CI. **Tabla de sabotajes en el `-done`**, cada test visto en rojo, fichero entero (no
  `-t`). Mínimo: el centinela no llega a Sentry desde la API (cuerpo, query y error), ni desde el TPV (breadcrumb y
  URL); el primer cobro del día en clínica abre turno solo y en hostelería no; el check no sale sin Holded.
- Capturas de la agenda a 390 px y a 1280×800.
- `docs/blocks/clinica-11-done.md` con lo hecho, decisiones tomadas sin preguntar, sabotajes y **«Al desplegar»**
  (migración si la hay, APK nueva sí/no, qué comprobar en Sentry tras desplegar).
- **Push de la rama y PR abierto: autorizados.** Ni merge ni despliegue.
