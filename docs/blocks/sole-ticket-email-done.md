# Sole · el ticket que se manda por email — DONE

_Rama `sole-ticket-email`, worktree `mipiacetpv-sole-email`, base `5aa0a20` (master).
Cierra el prompt de Matías del 23-09-2026. Plan del Frente 0 en
[`sole-ticket-email-plan.md`](sole-ticket-email-plan.md)._

**No se ha hecho push ni merge ni deploy: eso lo hace Matías. Cero migraciones.**

En paralelo corrió otra sesión con el bloque del fichaje (rama `fichaje-1`). No se ha tocado
ninguno de sus 101 ficheros ni su migración. **El único solape entre las dos ramas es
`pnpm-lock.yaml`** — las dos añaden una dependencia de workspace. Al mergear, se resuelve
regenerando el lock (`pnpm install`), no a mano.

---

## 1 · El incidente, y qué queda de él

El 17-09-2026 el ticket **000257 de Peluquería Sole (42,40 €)** se cobró con `abc` en el campo
"Enviar por email". Cuatro cosas fallaron a la vez, y este bloque cierra las cuatro:

| Lo que pasó | Lo que pasa ahora |
|---|---|
| El TPV y la API aceptaron `abc` | Se valida con la misma regla en las dos capas. La venta entra igual; el email se descarta y se dice |
| El TPV enseñó "Enviado por email a abc" | Dice **"Se enviará a …"**. "Enviado" sólo cuando el worker lo confirma |
| El worker falló 3× y el job se quedó en `PENDING` para siempre | Queda **`FAILED`** con el motivo, y no se gastan tres reintentos contra una dirección imposible |
| El PDF de ese ticket (QR / descargar) daba **400** | Da **200**. El documento no depende del email |

Y una quinta que no era del incidente pero lo agravaba: en la peluquería, la pantalla de
"Ticket emitido" —que es donde Ana manda el email o enseña el QR— se cerraba sola a los 4 s.
Ya no.

### 1.1 Los cuatro commits

| Commit | Qué cierra |
|---|---|
| `c5a64ca` | F1 · la regla de email compartida y las tres rutas que la usan |
| `ce96f2b` | F2 · el documento deja de depender del email; el worker no insiste |
| `fc6f4cc` | F3, F4, F5 · el estado real, el fallo visible, y el overlay de la peluquería |
| `c8dacb4` | El bucle visual, sus dos arreglos y las 17 capturas |
| (este) | Este documento |

**Hash del último commit de código: `c8dacb4`.** Encima sólo va este documento — el hash
exacto del commit del doc se lee con `git log -1` (no puede escribirse dentro de sí mismo).

---

## 2 · Decisiones tomadas sin preguntar

### 2.1 `format: email` de ajv → la función compartida en el handler

El prompt pedía validar `emailIntent` y `email` "con `format: email`". Aplicado como palabra
clave de ajv en el `schema` del body, **el cobro entero se rechazaría con un 400** — que es lo
que el mismo párrafo prohíbe ("el dinero ya ha cambiado de manos"). Las dos frases sólo son
reconciliables si "validar con formato de email" significa la regla, no el keyword.

Así que la validación vive en el handler, con `@mipiacetpv/util-validation`, y el `maxLength:
320` de ajv se queda como estaba. Lo mismo en el reenvío, para que la regla sea **literalmente
la misma función** en las tres capas y no tres aproximaciones que se separan con el tiempo.

### 2.2 La regla concreta de qué es un email

`packages/util-validation/src/email.ts`. Local part + dominio **con al menos un punto** y TLD de
dos letras o más. No es el RFC 5322 a propósito: `ana@localhost` es válido para el RFC y es
basura para una clienta de peluquería.

El criterio del compromiso está escrito en el fichero: **un falso negativo cuesta un cobro sin
email, recuperable desde el reenvío del histórico; un falso positivo cuesta un ticket que la
clienta nunca recibe y del que nadie se entera** — que es exactamente el incidente.

### 2.3 El subpath `@mipiacetpv/util-validation/email`

El índice del paquete reexporta `temporary-password.ts`, que importa `node:crypto`. Meterlo
entero en el bundle del TPV por una función de veinte líneas no tiene sentido, así que el
paquete gana un `exports["./email"]` y `apps/tpv-web` importa por ahí. La API, que corre en
Node, importa por el índice.

### 2.4 El email malo se arregla AL LEER, en dos capas, no en una

Hacían falta las dos y por razones distintas:

- **El esquema del documento** (`ticket-model/src/schema.ts`) deja de exigir formato. Sin esto,
  cualquier camino que no pase por `build-document` volvería a invalidar el documento entero.
  Precedente en el mismo fichero: la cabecera fiscal ya se aflojó igual en B-TPV-Bugfix v2.
- **`build-document.ts`** descarta el email que no vale al construir el documento. Sin esto, el
  PDF del 000257 saldría con `abc` impreso en la sección Cliente.

**La columna `email_intent` no se toca.** Es lo que Ana tecleó, es la prueba de qué pasó, y es
lo que prellena el campo de reenvío para que se pueda corregir. Un ticket emitido no se
reescribe: se lee bien.

### 2.5 Un fallo terminal deja DOS marcas

`ticket_email_jobs.status = FAILED` con el motivo (lo lee el TPV) **y** `tickets.email_failed_at`
(lo leen el panel y los contadores del super-admin, `superadmin/hub.ts:127`). Antes sólo se
escribía la segunda, y no la enseñaba ninguna pantalla que viera nadie de la peluquería.

`email_failed_at` está en la lista de columnas que el guardián del sello deja escribir sobre una
venta sellada (S1, fijado en `sello-de-la-venta.e2e.ts:302-315`): marcar un fallo de email no es
un cambio económico y no viola nada.

### 2.6 El worker no insiste con una dirección imposible

Un `to_email` que no valida queda `FAILED` **sin `throw`**: la cola no lo vuelve a tocar.
Reintentar tres veces con backoff exponencial de 60 s una dirección que nunca va a existir son
cuatro minutos para llegar al mismo sitio. Desde el F1 nadie puede crear un job así, pero los
que quedaron encolados en producción el 17-09 sí lo son.

### 2.7 Dónde se ve el fallo · **preguntado a Matías, no decidido solo**

El prompt decía "en el listado o ficha de tickets que ya exista". **No existe ninguno que vea el
propietario.** El único, `/admin/tickets-errors`, se llama "Sincronización con Holded", filtra
`SYNC_FAILED` y es `superAdminOnly` (`AdminShell.tsx:161`): sólo aparece impersonando. Sole no
lo vería nunca, y es una pantalla de Holded para una cosa que este bloque quiere sin Holded.

Respuesta de Matías: la sección de tienda **sí, pero no como único sitio**. Sole trabaja en el
TPV, no en el panel. Así que:

- **TPV (sitio principal)** · marca en la lista del histórico, y en la ficha el estado con el
  motivo justo encima del campo donde se corrige la dirección y se reenvía.
- **Panel (resumen del propietario)** · sección "No se pudieron enviar" dentro de
  `Tiendas › <tienda> › Comunicación de ticket`, pegada a la configuración que la gobierna.
  Endpoint nuevo `GET /admin/stores/:storeId/email-failures`, al lado del `/ticket-delivery` que
  ya existía. **Sin pantalla nueva.**

La sección **no se pinta si la lista está vacía**, igual que la de mesas abandonadas: una
sección que dice "todo bien" todos los días acaba siendo una sección que nadie lee. Y un ticket
ya reenviado bien desaparece de ella aunque conserve la marca vieja — perseguir algo resuelto es
peor que no avisar.

### 2.8 `emailedTo` se queda en el contrato

La ruta `/tickets/:id/digital` gana `email` (el estado honesto) y **mantiene** `emailedTo`. El
TPV lleva su propio bundle desde A4: entre el despliegue del servidor y la instalación de la
APK, un AP12 sin actualizar sigue leyendo `emailedTo`. Quitarlo le dejaría la pantalla sin badge
sin que nadie lo hubiera pedido. Los bundles nuevos usan `email`, que es el que no miente.

### 2.9 Los motivos, en castellano y sin volcados

`humanEmailFailureReason` traduce el `last_error` a una de cuatro frases. El orden de las reglas
importa y está comentado: **los errores de red se miran primero**, porque un
`connect ETIMEDOUT 10.0.0.1:587` lleva dentro el `587` del puerto y buscando "5xx" antes se
clasificaba como rechazo del servidor — o sea, se le decía a Ana que corrigiera una dirección
que estaba bien. Lo encontró su propio test.

---

## 3 · Tabla de sabotaje

Ejecutada de verdad, una por una, revirtiendo con `git checkout --` después de cada una.

| # | Sabotaje | Qué se pone rojo |
|---|---|---|
| 1 | Quitar la validación de la API en `resend-email` | `sole-ticket-email.e2e.ts` · *F1 · resend-email con 'abc': 400 con un mensaje que se puede leer* |
| 2 | Quitarla en el cobro (`decideEmailIntent` devuelve el crudo) | `sole-ticket-email.e2e.ts` · *F1 · cobrar con 'abc': la venta entra, el email se descarta y NO se encola nada* |
| 2b | Quitarla en el TPV (`emailIntentValid = length > 0`) | `checkout-email-intent.test.tsx` · **2 tests**: el aviso y "el cobro ENTRA y sale sin emailIntent" |
| 3 | Volver a exigir el email en el esquema del documento | `ticket-model.test.ts` · *un email basura NO tumba el documento entero* |
| 3b | Quitar el descarte AL LEER en `build-document.ts` | `sole-ticket-email.e2e.ts` · *F2 · el documento sale sin el email basura* |
| 4 | Dejar el job en `PENDING` tras agotar intentos | `ticket-email-worker.test.ts` · **2 tests**, y `sole-ticket-email.e2e.ts` · *F2 · al worker no se le insiste* |
| 5 | Volver a poner "Enviado" al encolar | `ticket-email-status.test.ts` · **2 tests**, y el e2e · *F3 · recién cobrado está PENDIENTE* + **el canónico F4** |
| 6 | Que `SERVICES` se autocierre | `success-overlay-autoclose.test.tsx` · *NO se cierra sola: esta pantalla es la entrega* |
| 7 | Que `HOSPITALITY` deje de autocerrarse | **4 tests**: los tres de `success-overlay-autoclose` (4 s, RETAIL, 8 s con vuelta) y `success-overlay-change` · *con vuelta el autocierre da 8 s, no 4* |

El 7 es el que más importa: el riesgo de este bloque **no** es que la peluquería siga
cerrándose, es que el bar deje de hacerlo. Por eso las dos mitades viven en el mismo fichero.

---

## 4 · Criterio de hecho, punto por punto

| Criterio | Dónde se comprueba |
|---|---|
| Cobrar con "abc": la venta entra, el TPV avisa, no se encola nada | e2e F1 (1º) + `checkout-email-intent.test.tsx` + capturas `sole-email-invalido-*` y `sole-overlay-no-se-enviara-*` |
| `resend-email` con "abc": 400 claro | e2e F1 (4º) — `INVALID_EMAIL` + mensaje con ejemplo |
| Con un email bueno: se encola, pendiente y luego enviado | e2e F1 (5º) y F3 (2º) |
| Un ticket con email basura da 200 en su PDF y en su vista | e2e F2 (1º y 2º) + captura `sole-pdf-000257-sale-bien.png` |
| Un envío que agota intentos queda fallido, se ve en TPV y admin, y se puede reenviar | **e2e F4 canónico**, ocho pasos: falla → se ve en el TPV → se ve en el panel → Ana corrige → pendiente → el worker lo manda → enviado → desaparece del panel |
| En SERVICES el overlay no se cierra solo | `success-overlay-autoclose.test.tsx` + captura a los **12 s** |
| En HOSPITALITY y RETAIL, 4 s (8 s con vuelta) como hoy | los tres tests del mismo fichero |

### 4.1 Números

- **Suite**: 228 ficheros, **2431 pasan, 3 saltados**.
- **e2e**: 13 ficheros, **168 pasan**, contra `mipiacetpv_sole_email_e2e` (base propia de la
  sesión, borrada al terminar).
- Los 3 saltados son de antes de este bloque y están justificados en el código:
  `super-admin.test.ts:566`, `describe.skip("super-admin · crear tenant (legacy flow
  B-SuperAdmin)")` — B-OnboardingV2 rehízo ese endpoint y la cobertura se trasladó a
  `onboarding-v2.test.ts`. Ninguno tiene que ver con el email.
- `git log HEAD..master` **vacío**: no hay nada en master que no esté en la rama.

---

## 5 · Bucle visual

Chrome real vía `playwright-core` instalado en el scratchpad (**no entra en el repo**), contra
las pantallas de verdad con la API interceptada en la capa de red (`page.route`), DPR 1,
`serviceWorkers: "block"`. A **390 y 1280×800** — el 1280×800 es la resolución del AP12 de Sole
(`docs/qa/2026-08-20-simulacion-hora-punta-sirope.md`). 17 capturas en
`docs/blocks/sole-ticket-email-shots/`.

| Captura | Qué enseña |
|---|---|
| `sole-email-invalido-390 · -1280` | El campo con "abc": borde ámbar y *"Ese email no es válido. Se cobrará igual, pero sin enviarlo."* — y **"Cerrar servicio" activo**, que es la mitad que no se puede romper |
| `sole-overlay-se-enviara-390 · -1280` | La pantalla post-cobro: **"Se enviará a ana@ejemplo.com"**, en gris, sin el check verde que antes mentía |
| `sole-overlay-no-se-enviara-390 · -1280` | El cobro que descartó el email: *«abc» no es una dirección válida. Puedes enviarlo desde Servicios anteriores con el email correcto* |
| `sole-overlay-sin-autocierre-12s-390 · -1280` | La misma pantalla **doce segundos después**. En un bar se habría ido a los 4 |
| `sole-historico-tres-estados-390 · -1280` | Los tres estados a la vez en la lista: Email enviado / Email pendiente / No se pudo enviar |
| `sole-ficha-no-se-pudo-enviar-390 · -1280` | La ficha del 000257: el motivo *"La dirección no es válida"* justo encima del campo, que nace con `abc` dentro y el botón apagado |
| `sole-reenvio-corregido-390 · -1280` | El mismo ticket con `ana@ejemplo.com`: botón vivo y *"Se enviará a ana@ejemplo.com."* |
| `sole-admin-no-enviados-390 · -1280` | El resumen del propietario, con los tres motivos distintos (dirección / rechazo / sin respuesta) |
| `sole-pdf-000257-sale-bien.png` | El PDF de un ticket con `email_intent = 'abc'` (escrito por SQL directo en la base e2e) saliendo entero: COMPROBANTE, 42,40 €, QR, y **sin línea de email**. Por el camino real: `loadTicketDocument` → `renderTicketPdf` |

### 5.1 Lo que el bucle cambió, y que ningún test habría cogido

1. **A 390 la marca del email quedaba reducida a una tira de dos píxeles.** La línea del número
   de ticket era `truncate` + `flex`; al añadirle el badge, el aviso se recortaba — justo el
   aviso que este bloque existe para que se vea. Ahora envuelve. *Lo que se corta ahí no son
   adornos, son estados.*
2. **En la ficha de un ticket fallido salían dos frases seguidas diciendo lo mismo de "abc"**:
   la del estado del envío y la del campo. El aviso del campo se calla cuando el bloque de
   arriba ya lo dice del mismo valor, y vuelve en cuanto Ana toca el campo.

Los dos van en `c8dacb4`.

### 5.2 Lo que el bucle vio y NO se tocó, por estar fuera de alcance

**La pantalla post-cobro dice "Sincronizando con Holded…" en un tenant sin Holded.** Se ve en
`sole-overlay-se-enviara-*`, justo encima del badge del email, y convive con el banner de modo
prueba que dice "ventas no se suben a Holded". Es el polling de `holdedDocNumber` de B-Print
fase 1 y no distingue `holdedEnabled: false` (el estado normal de Sole desde `catalogo-local`).
No se ha tocado: es el camino de sincronización, no el del email. **Queda apuntado.**

---

## 6 · Qué NO cubre la suite

### 6.1 Sole (SERVICES, usa el email) — lo que sigue sin banco

- **Que el email salga de verdad por SMTP.** Todo el bloque prueba hasta `sender.send(...)`
  incluido; el transporte está mockeado en los 13 ficheros e2e. Si el SMTP del VPS se cae, lo
  que este bloque garantiza es que **se vea** el fallo con el motivo, no que no ocurra.
- **El worker de BullMQ como proceso.** El e2e llama a `sendTicketEmail` directamente, que es
  el cuerpo del processor. Lo que no se ejecuta es el `worker.on("failed")` con `attemptsMade
  >= 3` — el camino de los tres reintentos reales. Lo cubre `ticket-email-worker.test.ts` con
  un prisma falso, no contra Redis.
- **El AP12 físico.** Las capturas son Chrome a 1280×800. El teclado virtual de Android sobre el
  campo de email (el `visualViewportSync` que ya existe) no está fotografiado en hardware real.
- **La APK.** Ningún test del repo instala el bundle nuevo en un terminal. Ver §7.
- **El `emailAutoIfCustomerHasEmail`** (el email automático desde el contacto vinculado, sin que
  el cajero escriba nada): el camino existe y ahora valida igual, pero este bloque no le ha
  añadido banco propio — sólo el del `emailIntent` manual, que es el del incidente.

### 6.2 Hostelería (Cachitos, Sirope) y tienda (Thalia) — qué se ha cruzado

- **El autocierre de 4 s y los 8 s con vuelta siguen fijados**, y ahora con tres tests en vez de
  uno: HOSPITALITY, RETAIL y el de la vuelta. El sabotaje 7 los pone rojos los cuatro.
- **Las pausas del autocierre** (sub-modal abierto, imprimiendo, error de impresión, sin
  impresora) no se han tocado: `autoClosePaused` se evalúa igual y sólo se le antepone
  `autoCloses`.
- **El cobro de mesa** (`POST /tickets/:id/checkout`, el camino de hostelería) valida el email
  igual que la venta rápida, y mantiene la asimetría que ya tenía: si el body no trae email, el
  del DRAFT se queda como estaba. Eso **no** tiene banco propio en este bloque — el e2e cubre la
  venta rápida. Un tenant de mesa que no mande `emailIntent` se comporta exactamente igual que
  antes.
- **El badge del histórico** aparece en las tres verticales. En un bar que no usa el email,
  `email.status` es `null` y no se pinta nada: ni una marca nueva en pantalla.

---

## 7 · Al desplegar

### 7.1 Qué va en el servidor

Todo lo de API y worker. **Se despliega sin migración** — los tres campos que usa el bloque
(`tickets.email_failed_at`, `ticket_email_jobs.status`, `ticket_email_jobs.last_error`) ya
existen, y `status` es texto libre sin enum de Postgres.

| Pieza | Qué cambia en producción el día del deploy |
|---|---|
| `api` | `POST /tickets` y `/tickets/:id/checkout` descartan el email inválido y lo dicen en la respuesta. `resend-email` devuelve 400. `GET /tickets` y `/tickets/:id/digital` traen el estado del envío. Endpoint nuevo `/admin/stores/:id/email-failures` |
| `worker` | Un job con destinatario imposible muere en el primer intento con motivo; uno que agota los tres queda `FAILED` en vez de `PENDING` |
| `admin` (bundle) | La sección "No se pudieron enviar" en Tienda › Comunicación de ticket |
| **PDF público** | **Efecto inmediato y retroactivo**: el QR y "Descargar" del 000257 —y de cualquier ticket con email sucio— pasan de 400 a 200 en cuanto arranca la API. Sin migrar ni tocar un solo dato |

**Orden**: API/worker primero, admin después. No hay dependencia al revés: el admin viejo
simplemente no pide el endpoint nuevo.

**Lo que NO hay que hacer**: ningún backfill, ningún `UPDATE` sobre `email_intent`. El arreglo
es al leer. Si alguien "limpia" esa columna, se pierde la prueba de qué se tecleó y el campo de
reenvío deja de nacer prellenado.

### 7.2 Qué exige APK nueva

**Todo lo que Sole ve.** El TPV lleva su propio bundle dentro del APK desde A4: con el servidor
desplegado y sin instalar APK, el AP12 de Sole **sigue igual que hoy**. Concretamente, hasta que
no se instale la APK:

- el campo de email sigue aceptando "abc" sin avisar (aunque la API ya lo descarte: la venta
  entra y el email no se manda — el fallo deja de ocurrir, pero Ana no se entera en el momento);
- la pantalla post-cobro sigue diciendo **"Enviado por email a …"** (lee `emailedTo`, que se ha
  mantenido a propósito);
- el histórico no enseña el estado del envío ni el motivo;
- **la pantalla de "Ticket emitido" se sigue cerrando sola a los 4 s.**

O sea: el servidor solo arregla *que el fallo no ocurra*; la APK es la que hace que *se vea*.

### 7.3 Versión de APK que propongo

**v1.17.1**, encima de la 1.17.0 que ya está en `mipiacetpv-apk-1-17-0` (`62b1abe`). Es un
bloque de una sola vertical sin cambios de contrato hacia el terminal: sube el patch.

### 7.4 Qué ve Sole distinto

1. **Al escribir el email**, si se equivoca, el campo se pone ámbar y le dice *"Ese email no es
   válido. Se cobrará igual, pero sin enviarlo."* — y **cobra igual**. Nunca se queda sin
   cobrar por un email.
2. **Al terminar el cobro**, la pantalla dice *"Se enviará a ana@ejemplo.com"*, no "Enviado". Y
   si el email no valía, lo dice con el texto que escribió, para que pueda pedírselo bien a la
   clienta en ese momento.
3. **Esa pantalla ya no se cierra sola.** Se cierra cuando ella pulse "Nuevo servicio". Es donde
   enseña el QR y manda el email, y cuatro segundos no dan para eso.
4. **En "Servicios anteriores"**, cada ticket con email lleva su estado: *Email enviado*, *Email
   pendiente* o *No se pudo enviar*. El tercero se ve desde la lista, sin abrir nada.
5. **Al abrir uno que falló**, le dice por qué en castellano y le deja corregir la dirección y
   reenviar ahí mismo.
6. **El QR y "Descargar" del 000257 vuelven a funcionar** — eso sin APK, en cuanto se despliegue
   el servidor.

Y la propietaria, en el panel, tiene en su tienda la lista de los que no salieron, con el motivo
de cada uno y la indicación de dónde se arreglan.
