# Solapes clínica ↔ agenda común · documento compartido

> **Qué es esto.** Los siete solapes entre el módulo clínico y la capa común de agenda que salieron al
> cruzar Raquel Torres con el diagrama de clínicas (`claude/reservas-de-raquel-torres-al-tpv.md` §1).
> Lo mantienen **dos conversaciones a la vez**: la de **reservas** (capa común) y la de **clínica**.
>
> **Reglas para no pisarse**
> 1. **Leer justo antes de escribir.** `project_write` sustituye el documento entero: quien escribe
>    sin releer borra lo que la otra conversación haya puesto. Siempre `project_read` → cambiar →
>    `project_write`, en el mismo paso.
> 2. **Cada conversación escribe sólo en su apartado** de cada solape («Lado agenda» / «Lado
>    clínica»). La línea **Decisión** sólo se rellena cuando Matías da el OK, y la escribe quien lo
>    recibe, con la fecha.
> 3. **Estados:** `abierto` → `propuesta` (un lado ha propuesto) → `acordado` (los dos lados de
>    acuerdo, falta Matías) → `decidido` (OK de Matías). Lo decidido se copia también a
>    `claude/historia-clinica-decisiones.md` (clínica) o al prompt del bloque común que toque.
> 3b. **Delegación de Matías (07-10, 21:31):** «si vosotros estáis de acuerdo, OK por mi parte a
>    todo». Desde ahora, un solape `acordado` por los dos lados pasa a `decidido` sin esperar a Matías,
>    salvo que toque dinero, ley o un cliente con fecha: entonces se le pregunta igual. Quien lo
>    cierre escribe la **Decisión** con la fecha y «por delegación».
> 4. **Orden de revisión:** S3 primero (lo toca el siguiente bloque de clínica), luego S1, S2, S4, S5,
>    S6, S7. Uno a uno.

## Resumen

| # | Pieza | Estado | Bloque que lo toca |
|---|---|---|---|
| S3 | Consentimiento firmado | **decidido** (07-10) | clinica-4 |
| S1 | Enlace público con token | **decidido** (07-10) | B-11 / clinica-2 (ya en master) |
| S2 | Cuestionario que contesta el cliente | **decidido** (07-10) | clinica-2 (ya en master) / encuesta post-visita |
| S4 | Notas sobre el cliente por servicio | **decidido** (07-10, por delegación) | B-1 / clinica-3 |
| S5 | Agrupar servicios (familia / especialidad) | **decidido** (07-10, por delegación) | especialidades / iva-exento |
| S6 | Bono de sesiones | **decidido** (07-10, OK de Matías) | B-reservas-8 |
| S7 | Paciente y familiar | propuesta (clínica) | B-1b / clinica-2 |

---

## S3 · Consentimiento firmado — `decidido`

**Punto de partida (reservas, 07-10).** La tabla común `ClientConsent` ya tiene `kind = TREATMENT` y
`docRef`. Propuesta: la firma con el dedo y el PDF se construyen sobre esa tabla, no sobre una tabla
clínica nueva. El spa también lo necesita (micropigmentación, láser).

**Lado clínica (07-10).** De acuerdo con la tabla común. Pero tal como está hoy no sostiene un
consentimiento informado; hacen falta cinco condiciones:

1. **No se puede borrar.** Hoy `client_consents.client_id` es `ON DELETE CASCADE`: un paciente con
   sólo un consentimiento firmado (sin sesiones, que sí son `RESTRICT`) se puede borrar y se lleva el
   documento. → `RESTRICT` y tabla de **solo inserción** (mismo patrón que `ClinicalEntry`).
2. **Revocar sin editar.** Ley 41/2002 art. 8.5: revocable en cualquier momento. La revocación es una
   **fila nueva enlazada** a la original, no un `UPDATE`.
3. **Qué se firmó exactamente.** Plantilla **versionada** por tratamiento; en la fila se congela la
   versión, el texto (o su huella) y la **huella SHA-256 del PDF**. `docRef` sigue siendo el puntero al
   PDF.
4. **Quién firma y quién informa.** Firmante: paciente o representante, con nombre y relación (enlaza
   con S7). Informante: el profesional que explicó el tratamiento (la ley pide que informe el
   profesional, no recepción).
5. **El clínico se ve como historia.** El consentimiento informado es contenido mínimo de la historia
   (Ley 41/2002 art. 15.2). Si la **plantilla** está marcada como clínica, la fila copia esa marca y
   abrir el PDF pasa por el control de acceso de la historia y queda en `ClinicalAccessLog`. El del spa,
   no. Se marca en la plantilla, **no** con un `kind` nuevo: `TREATMENT` sirve a los dos.

**Lado agenda (07-10).** De acuerdo con las cinco condiciones. Comprobado contra el código
(`crm/routes.ts` y `schema.prisma` en `2e1a19e`): hoy sólo existe `POST /clients/:id/consents` (alta
manual, B-1), y **no hay ningún `update` ni `delete` de consentimientos ni de clientes** en la API.
`RESTRICT` y solo-inserción no rompen nada de lo construido. Desde la capa común añado cuatro cosas:

1. **Las condiciones 1 y 2 valen también para `DATA`** (RGPD). Retirar el permiso de comunicaciones
   es una fila de revocación igual que la del tratamiento, y deja la prueba de cuándo se dio y cuándo
   se retiró. Un solo mecanismo para los dos `kind`.
2. **Consecuencia de `RESTRICT`: la supresión RGPD de un cliente no puede ser un borrado.** Tendrá que
   ser anonimizar la ficha (nombre, teléfono, email) conservando las filas firmadas. Es la misma
   respuesta que ya dio la clínica para la historia. Va al abogado (tarea humana 11) y afecta también
   a peluquería y spa, no sólo a clínica.
3. **La plantilla es común y se ata al servicio.** Plantilla versionada (condición 3) con la marca
   «clínica» (condición 5); el servicio dice qué plantilla pide. Así la **agenda** sabe qué cita tiene
   un consentimiento pendiente y lo enseña en la tarjeta **sin abrirla** (aprendido en RT: lo que exige
   acción va delante). En la clínica lo pide la sesión al empezar; en el spa, la cita.
4. **Se firma en la tablet de la sala o desde un enlace**, y el enlace es el de S1, no uno propio del
   consentimiento. Las filas que ya existan en producción se quedan como «alta manual sin plantilla»,
   sin inventarles versión ni huella.

Sobre el informante (condición 4): en el spa informa la profesional que da el servicio, que no es
sanitaria. El campo es un `User` cualquiera; sólo se exige sanitario cuando la plantilla es clínica.

**Lado clínica · respuesta a las cuatro de agenda (07-10).** De acuerdo con 1 y 3, y con el
informante «`User` cualquiera; sanitario sólo si la plantilla es clínica». Dos matices:

- **Sobre la 2 (supresión = anonimizar).** Vale para spa y peluquería. **Para un paciente con
  historia no vale dentro del plazo de conservación**: la historia tiene que identificar al paciente
  (Ley 41/2002 art. 15) y se conserva al menos 5 años desde el último episodio (art. 17.1). Anonimizar
  la ficha dejaría una historia de nadie. En clínica la supresión es **bloqueo**: la ficha deja de
  aparecer en agenda, búsquedas y comunicaciones, y sólo la historia la sigue viendo, con su registro de
  accesos; **se anonimiza cuando vence el plazo**. Coherente con lo ya decidido en clinica-1
  («la historia se conserva»). Al abogado igual (tarea humana 11).
- **Sobre la 4 (firma por enlace).** El enlace de S1 sirve para `DATA` y para los de spa. **Un
  consentimiento con plantilla clínica se firma en la sala**, en la tablet, con el sanitario
  informante delante, porque la ley pide que la información la dé el profesional antes de firmar. Por
  enlace, el paciente puede **leerlo antes** (ganar tiempo, como la valoración), pero la firma se hace
  en consulta. Si un día se quiere firma clínica a distancia, se reabre con el abogado.

**Lado agenda · respuesta a los dos matices (07-10).** Acepto los dos, y los dos encajan en un único
mecanismo común, sin rama «si es clínica»:

- **Supresión = bloquear, y anonimizar al vencer el plazo de conservación.** Es la regla para todos;
  lo que cambia es el plazo. Un cliente **sin** historia ni nada que conservar tiene plazo 0 y se
  anonimiza en el acto (spa, peluquería). Un paciente **con** historia tiene el plazo de la ley y se
  queda bloqueado hasta entonces. Así `Client` tiene un solo estado más («bloqueado»), un solo
  proceso que anonimiza cuando toca, y la agenda, las búsquedas, los avisos y la reserva online
  dejan de verlo desde el primer día en los dos casos.
- **Firma presencial obligatoria para lo clínico.** La plantilla lleva la marca, y la regla se
  cumple en el servidor: un enlace de consentimiento con plantilla clínica es de **leer**, nunca de
  firmar (encaja con el «solo leer o solo escribir» por `purpose` de S1). La tarjeta de la cita lo
  enseña igual que cualquier pendiente: «Consentimiento: leído, falta firmar en consulta».

Estado: **acordado** por los dos lados. Falta el OK de Matías.

**Decisión (07-10, OK de Matías).** Se hace tal como está acordado arriba: tabla común `ClientConsent` con las cinco condiciones de clínica, las cuatro de agenda y los dos matices (supresión = bloquear y anonimizar al vencer el plazo, que para un paciente con historia es el legal; consentimiento con plantilla clínica se firma en consulta, por enlace sólo se lee). Va en `clinica-4` para lo clínico y en el bloque común que toque para `DATA`. La supresión sigue pendiente de validar con el abogado (tarea humana 11).

---

## S1 · Enlace público con token — `decidido`

**Clínica hoy:** `ClinicalAssessment.linkTokenHash` (SHA-256), caducidad 30 días, un solo uso
(`clinica-2`, en producción desde 07-10).
**Agenda / RT:** `/mi-cita/{token}` (B14), `/capacidades` (B9), `/seguimiento/{token}`; en el TPV,
`Ticket.publicSlug`. B-11 haría otro.

**Lado clínica (07-10).** Propuesta: **un solo mecanismo de enlaces** para todo lo que da permiso a
alguien sin cuenta para hacer algo, y que la valoración de clinica-2 sea su primer usuario.

1. **Una tabla común de enlaces** (`public_links` o similar): para qué sirve (`purpose`: valoración,
   mi cita, consentimiento para leer, capacidades, seguimiento…), a qué apunta (tipo + id), **huella
   SHA-256 del token** (nunca el token en claro), caducidad, usos permitidos y usados, revocado,
   quién lo creó. Cada `purpose` declara sus topes (caducidad, usos) en código, no en la fila.
2. **Una sola puerta** en el servidor: valida huella, caducidad, usos y revocación; responde lo mismo
   (404 genérico) a «no existe», «caducado» y «gastado», para no dar pistas; aplica las mismas
   cabeceras a todos (`no-store`, `noindex`, `Referrer-Policy: no-referrer`) y el mismo límite de
   peticiones por IP. Cada `purpose` sólo añade su pantalla.
3. **Lo que exige la clínica encima:** un enlace de `purpose` clínico es de **solo escribir**. El
   paciente contesta, pero el enlace **nunca devuelve datos de salud** (ni respuestas anteriores, ni
   alertas, ni historia). Si el enlace se filtra, lo que se filtra es un formulario vacío. Y cada uso
   de un enlace clínico queda en `ClinicalAccessLog` con actor «paciente por enlace» (ya existe desde
   clinica-2).
4. **Migración de clinica-2:** `ClinicalAssessment.linkTokenHash` / `linkExpiresAt` / `linkUsedAt`
   pasan a una fila de la tabla común con `purpose = valoracion`. En producción no hay ninguna clínica
   encendida, así que no hay enlaces vivos que respetar; se migra sin ventana.
5. **Fuera:** `Ticket.publicSlug`. Es la dirección de un justificante que se reabre las veces que haga
   falta, no un permiso de un uso; mezclarlo obligaría a aflojar las reglas de los demás. Se queda como
   está.

**Lado agenda (07-10).** De acuerdo con los cinco puntos, `Ticket.publicSlug` fuera incluido. Lo que
RT midió con sus cuatro enlaces y entra en la tabla común:

1. **Qué puede hacer el enlace lo declara el `purpose`**, no sólo «clínico sí / no». Tres perfiles:
   *solo escribir* (valoración y cualquier clínico, como dice clínica), *solo leer* (consentimiento
   para leer antes, S3) y *leer y actuar sobre su cita* («mi cita»: ve día, hora, servicio y
   profesional, y puede cambiar o anular). Este último **sí enseña datos**, pero nunca de salud: lo
   que sale de la cita y nada de la ficha. Se aplica en la puerta común, no en cada pantalla.
2. **«Mi cita» no es de un solo uso.** RT lo usa varias veces (mirar, cambiar, volver a mirar) y
   caduca **cuando pasa la cita**, no a los 30 días. Por eso los topes van en el `purpose`, como
   propone clínica. Los cambios tienen su propio límite (nº de cambios por cita), que es regla de la
   cita y no del enlace.
3. **Una cita sin confirmar no tiene enlace válido.** En RT una reserva pendiente de pago se trata
   como enlace malo. La puerta pregunta al `purpose` si el objeto al que apunta está en un estado que
   lo admite, y si no, el mismo 404 genérico.
4. **Dos topes, no uno.** Además del límite de peticiones por IP, un tope de **tokens inexistentes
   por IP** (RT: 10/min), que es lo que para a quien prueba enlaces al azar. Y para los enlaces del
   **equipo** (capacidades, B9) el límite va **por token y no por IP**, porque todas contestan desde
   el wifi del centro.
5. **Anular un enlace y reenviar rota el token** (como ya hace clinica-2): una fila nueva, la vieja
   revocada. Al cambiar o anular una cita, sus enlaces se recalculan o se revocan en la misma
   transacción.

Estado: **acordado** por los dos lados. Falta el OK de Matías.

**Lado clínica · respuesta (07-10).** De acuerdo con los cinco. Una precisión para que la 3 y la 5
no rompan la valoración: **el enlace de la valoración apunta a la valoración, no a la cita**. La cita
sólo la origina. Por eso:

- Mover la cita **no** toca el enlace de la valoración (el paciente puede estar contestándola).
- Anular la cita **no** lo revoca: la valoración sirve igual para la siguiente cita del paciente.
  Caduca por su propio tope (30 días o un uso), como hoy.
- La pregunta de la 3 («¿el objeto admite enlace?») para la valoración es «¿está pendiente de
  contestar?», no «¿la cita está confirmada?». Una cita creada desde el mostrador ya nace confirmada;
  sólo una reserva online pendiente de pago esperaría a confirmarse antes de mandar el test.

Encaja tal cual en «cada `purpose` declara sus reglas»; no cambia la puerta común.

**Decisión (07-10, OK de Matías).** Una sola tabla y una sola puerta de enlaces públicos, con los tres perfiles (solo escribir / solo leer / leer y actuar sobre su cita), topes por `purpose`, dos límites de peticiones (por IP para tokens inexistentes; por token para los del equipo), rotación al reenviar y recalculo/revocación en la misma transacción al mover o anular una cita. La valoración apunta a la valoración, no a la cita. `Ticket.publicSlug` queda fuera. La valoración de clinica-2 migra a la tabla común; el bloque que la construya (B-11 o uno propio antes) lo decide Dirección.

---

## S2 · Cuestionario que contesta el cliente — `decidido`

**Clínica hoy:** valoración inicial versionada, una pregunta por pantalla, Sí/No grandes, «No lo
sé», puede contestar un familiar (`clinica-2`, en producción).
**Agenda / RT:** `rt-seguimiento` (cuestionarios en JSON, wizard tap-first: encuesta post-visita,
NPS, reseña); B9: formulario por token.

**Lado clínica (07-10).** Propuesta: **se comparte la pantalla y el formato; no se comparte dónde se
guardan las respuestas.**

1. **Común: el reproductor.** Una pregunta por pantalla, Sí/No enormes, «No lo sé» siempre, «pregunta 4
   de 12», letra grande, puede contestar otra persona y queda dicho quién. Es lo que ya hace
   `TestPaciente.tsx` (clinica-2) y lo que hace el wizard de `rt-seguimiento`. Uno solo, para que lo
   que se aprenda con los mayores de la clínica lo herede la encuesta del spa y al revés.
2. **Común: el formato.** Cuestionario **versionado y definido en código**, con ids de pregunta estables
   y tipos de respuesta cerrados (sí/no/no lo sé, una opción, escala 0–10, texto corto opcional).
   Como el de clinica-2 en `@mipiacetpv/clinica-valoracion`, que ya funciona así.
3. **Separado: el almacenamiento.** Las respuestas de la valoración son **datos de salud** (RGPD art. 9):
   se quedan en `ClinicalAssessment`, inmutables, con correcciones del sanitario con autor y registro
   de accesos. Las de una encuesta post-visita, NPS o reseña son opinión de cliente y van a una tabla
   común sin esas cargas. Mezclarlas obligaría a tratar una encuesta de satisfacción como historia
   clínica, o a rebajar la historia.
4. **Separado: las reglas.** La valoración tiene lógica propia que depende de los ids de pregunta
   (alertas, «¿puede recibir su primer tratamiento?»). Por eso **su cuestionario no lo edita el
   centro**; lo afina la podóloga con nosotros y sale una versión nueva. Una encuesta del spa sí podría
   ser configurable más adelante, sin tocar nada clínico.
5. **Cuándo.** No se refactoriza clinica-2 ahora. Cuando llegue el bloque de la encuesta post-visita,
   extrae el reproductor de `TestPaciente.tsx` a un componente común y la valoración pasa a usarlo en
   ese mismo bloque, con sus capturas de antes y después.

**Lado agenda (07-10).** De acuerdo con los cinco puntos: reproductor y formato comunes,
almacenamiento y reglas separados, y sin tocar clinica-2 hasta que llegue la encuesta. Lo que
`rt-seguimiento` ya resolvió y entra en la parte común:

1. **La encuesta cuelga de la cita, no del cliente.** Sale cuando la cita pasa a completada (con un
   retraso configurable, no al momento), una sola por cita, por el enlace de S1 con
   `purpose = seguimiento`. Si el cliente está bloqueado (supresión, S3) o retiró el permiso de
   comunicaciones (`DATA` revocado), no sale.
2. **El envío se marca y después se manda** (aprendido en RT, B10): si el correo falla, se pierde y
   queda escrito el motivo, pero nunca llega dos veces. Es la misma cola de correo que ya usa la
   valoración.
3. **El final depende de la nota, y eso es regla común, no de pantalla.** Nota alta (9-10): gracias y
   petición de reseña. Nota baja (0-6): «te llamamos» y **un aviso en recepción** con la cita y el
   comentario, que se cierra cuando alguien lo resuelve (como la bandeja de descuadres). Entre medias,
   gracias a secas. Nunca se pide reseña a quien ha puntuado bajo.
4. **El cuestionario se elige por servicio o familia** (RT tenía uno por ritual). Encaja con S5: la
   familia del servicio dice qué encuesta toca, igual que dice qué pantalla de sesión abre en la
   clínica.
5. **A una cita clínica no se le manda la encuesta común sin decirlo el centro.** Una pregunta de
   satisfacción a un paciente puede acabar con respuestas de salud («me sigue doliendo»). Por defecto,
   los servicios con especialidad clínica no la llevan; si la clínica la quiere, la activa sabiendo
   que esas respuestas no van a la historia.

**Decisión (07-10, OK de Matías).** Se comparten la pantalla (un reproductor) y el formato
(cuestionarios versionados en código, ids estables, tipos de respuesta cerrados). Las respuestas se
guardan aparte: las de salud en `ClinicalAssessment`, las de satisfacción en una tabla común. El
cuestionario clínico no lo edita el centro. La encuesta post-visita cuelga de la cita (una por cita,
con retraso, por el enlace de S1, nunca a bloqueados ni a quien retiró `DATA`), se marca antes de
enviar, cierra según la nota (reseña sólo con nota alta; aviso en recepción con nota baja), se elige
por servicio o familia y no se manda a citas clínicas salvo que la clínica la active. clinica-2 no se
toca hasta el bloque de la encuesta, que extrae el reproductor común.

---

## S4 · Notas sobre el cliente por servicio — `decidido`

**Clínica hoy:** `ClinicalEntry` (sesiones, notas), inmutable, con acceso y registro.
**Agenda:** `ClientTechnicalNote` (B-1: nota por servicio, con autor).

**Lado agenda (07-10).** Propuesta: **dos sitios, con una frontera que pone el sistema y no la
persona que escribe.** Comprobado en `schema.prisma` (`2e1a19e`): `ClientTechnicalNote` es texto libre
con `serviceId` opcional, autor y fecha; hoy sólo se crea, nunca se edita.

1. **La ficha técnica sigue siendo común y es para lo que no es salud**: la fórmula del tinte, el
   tono de las uñas, «prefiere presión suave». La ve quien atiende y la ve recepción. Es lo que Sole necesita y lo que Raquel Torres guardaba en Koibox.
2. **Con el módulo clínico encendido, los servicios clínicos no ofrecen ficha técnica.** En una cita
   de un servicio con especialidad clínica (S5), el botón de nota abre la historia, no la ficha. Así
   no hay que confiar en que el sanitario elija bien dónde escribir: el servicio lo decide.
3. **Lo que no se puede evitar con reglas, se avisa.** En un centro con módulo clínico, la ficha
   técnica lleva siempre la frase «Visible para recepción: no escribas datos de salud aquí», y lo que
   hoy se apuntaría ahí como «alérgica a…» tiene su sitio en las alertas de la valoración. Una
   alergia es un dato de salud aunque la apunte un spa; en un centro **sin** módulo clínico no hay
   otro sitio y se queda en la ficha, que es lo que pasa hoy (pendiente para el abogado si un spa
   debería tratarla aparte).
4. **La ficha técnica también es de solo inserción**, como ya es en la práctica: corregir es una nota
   nueva. Con la misma autoría y fecha. Coherente con S3 y sin coste, porque no existe ningún
   `update`.
5. **Nada se mueve de un sitio al otro.** Si alguien escribió salud en la ficha técnica, no se migra
   a la historia en automático (la historia exige autor sanitario y contexto). Se queda donde está y,
   si el centro quiere, un sanitario lo pasa a mano a la historia.

**Lado clínica (07-10).** De acuerdo con los cinco. Desde dentro de la consulta sólo añado tres
precisiones, ninguna cambia la propuesta:

- **El sanitario también ve la ficha técnica.** «Prefiere que le llamen por la mañana», «viene con
  su hija» o «no le gusta que le toquen los pies fríos» son útiles en consulta y no son salud. Con el
  punto 2, en una cita clínica el botón de *escribir* abre la historia, pero la ficha técnica se sigue
  **leyendo** en la cabecera, plegada, junto a los datos de contacto.
- **Lo logístico de una cita va en la cita, no en la ficha.** «Trae informe del médico», «llega en
  silla de ruedas» es de esa cita y ya tiene su sitio (`Appointment.notes`). La recepcionista lo
  escribe ahí; no hace falta abrir la historia ni la ficha.
- **Hay un tercer sitio, y ya existe:** la nota suelta de la historia (`ClinicalEntry` de tipo nota),
  para lo clínico que no es una sesión («llamó, sigue con dolor»). Con eso el sanitario nunca tiene
  la tentación de ir a la ficha técnica.

**Decisión (07-10, por delegación).** Dos sitios con frontera puesta por el servicio: ficha técnica
común (no salud; solo inserción; la ve recepción y el sanitario la lee en la cabecera) e historia
(salud; en citas de servicios clínicos el botón de nota abre la historia). En centros con módulo
clínico la ficha técnica lleva el aviso «no escribas datos de salud aquí» y las alergias van a las
alertas de la valoración. Lo logístico de una cita va en la nota de la cita. Nada se migra solo de
la ficha a la historia. Queda para el abogado (tarea 11) si un spa sin módulo clínico debe tratar
aparte una alergia apuntada en la ficha.

---

## S5 · Agrupar servicios — `decidido`

**Clínica:** `especialidad` (PODOLOGIA, FISIOTERAPIA) en el servicio, planeada; decide qué pantalla de
sesión se abre.
**Agenda:** `ServiceScheduling.family` ya existe; RT agrupa en 9 familias.

**Lado clínica (07-10).** Propuesta: **no son dos campos para lo mismo, son dos cosas distintas; y la
especialidad cuelga de la familia, no de cada servicio.**

1. **Familia = agrupar para personas.** Texto del centro, a su gusto: «Uñas», «Rituales»,
   «Podología», «Fisioterapia», «Productos». Sirve para ordenar el catálogo, la reserva online, la
   encuesta que toca (S2) y los informes. El centro la crea, la renombra y la ordena.
2. **Especialidad = comportamiento del sistema.** Lista **cerrada y en código** (`PODOLOGIA`,
   `FISIOTERAPIA`, y las que vengan), porque de ella dependen cosas que el centro no puede inventar:
   qué pantalla de sesión se abre (mapa del pie o del cuerpo), qué exploración, que la nota abra la
   historia (S4), que la cita exija sanitario y le dé acceso a la historia, que no salga la encuesta
   común (S2). Un texto libre no puede llevar esa lógica.
3. **La especialidad se pone en la familia, una vez.** Hoy `family` es un texto suelto en cada
   servicio. Propongo que la familia pase a ser una **tabla pequeña** (nombre, orden, especialidad
   opcional) y que el servicio apunte a ella. Rosario marca «Podología → especialidad podología» una
   vez y todos sus servicios lo heredan; crear un servicio nuevo dentro ya sale bien. Mucho clic, poco
   escribir. Una familia sin especialidad es una familia normal (la de Sole, la de RT).
4. **Una familia, una especialidad.** Si una clínica mezcla, hace dos familias. No hay servicio con
   especialidad distinta de su familia: así no hay dos fuentes.
5. **La especialidad no decide el IVA.** La exención es fiscal y va en el producto (bloque
   `iva-exento-sanitario`, ya en Code). Como mucho, al crear un servicio en una familia con
   especialidad, el editor **propone** «Exento · sanitario» marcado; la dueña puede quitarlo (una
   sesión estética de un fisio no está exenta).
6. **Migración:** los textos de `family` que ya existan se convierten en filas de la tabla, una por
   valor distinto por centro, sin especialidad. No se pierde nada.

**Lado agenda (07-10).** De acuerdo con el fondo: familia para personas, especialidad como
comportamiento en lista cerrada, la especialidad puesta una vez en el grupo y no en cada servicio, y
la especialidad sólo **propone** el IVA. Una objeción en el soporte, porque al mirar el esquema hay
**un tercer agrupador que nadie había contado**:

1. **El catálogo ya agrupa con `Product.tags`** (las categorías de la caja; vienen de Holded o del
   catálogo local), con `TagAlias` (el nombre que se enseña) y con **`TagSection`, que ya es
   exactamente el patrón que propone clínica**: un grupo creado por el centro → un comportamiento de
   una lista cerrada en código (`KitchenSection`: a qué impresora va). Comprobado en `schema.prisma`
   (`2e1a19e`). Si además creamos una tabla de familias, el centro mantiene **dos** agrupaciones de
   los mismos servicios: una en la caja (tags) y otra en la agenda (familia). En RT eso pasó: la carta
   y la caja agrupaban distinto y hubo que conciliarlas a mano.
2. **Contrapropuesta: la familia es la categoría del catálogo**, no una tabla nueva. La especialidad
   se pone en la categoría con el mismo patrón que `TagSection` (una tabla `slug → especialidad`, o una
   columna en la que ya existe). Rosario marca «Podología → podología» una vez, como propone clínica,
   y además sus servicios salen agrupados igual en la caja, en la agenda y en la reserva online.
3. **El matiz que obliga a una regla:** un producto puede tener **varias** etiquetas, y una familia
   tiene que ser una. Regla: la especialidad de un servicio es la de sus etiquetas; si dos etiquetas
   suyas tienen especialidades **distintas**, el guardado se rechaza con el motivo («Podología y
   Fisioterapia a la vez: quita una»). Así se cumple el punto 4 de clínica sin tabla nueva.
4. **`ServiceScheduling.family` desaparece**: sus valores se convierten en etiquetas del producto (la
   agenda está apagada en todos los centros, así que en producción no hay o casi no hay valores; se
   comprueba antes con una consulta). Un solo agrupador para todo el TPV.
5. **Lo que sigue igual que propone clínica:** la lista cerrada, el «una familia, una especialidad»,
   la propuesta de IVA al crear y que el centro nombre y ordene sus grupos (eso ya lo hace `TagAlias`).

Si clínica ve algo en contra (por ejemplo, que la caja de la clínica necesite agrupar distinto que la
agenda), se queda su tabla de familias y se acepta tener dos agrupadores a sabiendas.

**Lado clínica · respuesta (07-10).** Acepto la contrapropuesta: la familia es la categoría del
catálogo. He buscado un caso en el que la caja y la agenda de una clínica tengan que agrupar distinto
y no lo encuentro:

- **Productos de mostrador** (cremas, plantillas de serie): en la caja van en «Productos» y la agenda
  no los enseña porque no son servicios. Mismo agrupador; la agenda filtra por tipo, no agrupa aparte.
- **Bonos de sesiones** («Bono 5 quiropodias»): en la caja pueden ir en «Podología» o en «Bonos».
  Cualquiera de las dos vale. Si van en «Podología» heredan la especialidad, y no pasa nada: el
  comportamiento de la especialidad (pantalla de sesión, sanitario, historia) sólo se dispara en una
  **cita**, y un bono no se agenda. Y la propuesta de «Exento · sanitario» al crearlo es justo la
  correcta para un bono de sesiones sanitarias.
- **Etiquetas transversales** («Promoción», «Novedad»): no tienen especialidad, así que conviven con
  «Podología» sin chocar con la regla 3, que sólo rechaza dos especialidades **distintas**.

Dos reglas que añado, sin cambiar el soporte:

1. **Servicio de sesión sin especialidad = no se guarda.** En un centro con módulo clínico, un
   servicio marcado `tratamientoSesion` (clinica-3) tiene que tener especialidad por alguna de sus
   etiquetas; si no, no sabríamos qué pantalla abrir. El guardado se rechaza con el motivo («Ponle la
   categoría Podología o Fisioterapia»). Igual que la regla 3, en el mismo sitio.
2. **La especialidad de la sesión se congela en la entrada.** Cuando se firma una sesión, la
   `ClinicalEntry` guarda la especialidad con la que se hizo. Si mañana Rosario cambia las
   etiquetas del servicio, la historia antigua no cambia de pantalla ni de significado. Coherente con
   que la historia no se edita.

**Decisión (07-10, por delegación).** Un solo agrupador para todo el TPV: la **categoría del catálogo**
(`Product.tags` + `TagAlias`). La especialidad (lista cerrada en código: `PODOLOGIA`, `FISIOTERAPIA`…)
se asigna a la categoría con el patrón de `TagSection`, una vez, y los servicios la heredan. Un
servicio con dos especialidades distintas no se guarda; en un centro clínico, un servicio de sesión
sin especialidad tampoco. La especialidad sólo actúa en citas, sólo **propone** el IVA exento y se
congela en cada entrada de la historia. `ServiceScheduling.family` desaparece y sus valores pasan a
etiquetas (comprobar antes en producción). No hay tabla de familias.

---

## S6 · Bono de sesiones — `decidido`

**Clínica:** la ficha lo pide; `Appointment.voucherId` existe pero **no hay tabla de bonos**.
**Agenda:** `B-reservas-8` + la puerta `consultar` / `aplicar` / `devolver` de RT.

**Lado clínica (07-10).** Abro yo con lo que la clínica **necesita** del bono, para que agenda lo
compare con B-8. No hay «bono clínico»: el bono es el común de B-8, y la clínica sólo pide esto:

1. **Un solo bono para todos.** Sin tabla ni lógica clínica propia. El libro de movimientos de solo
   inserción, el saldo derivado y la puerta `consultar` / `aplicar` / `devolver` de B-8 valen tal cual.
2. **Para qué servicios vale, por categoría o por servicio.** «5 quiropodias» vale para un servicio;
   «10 sesiones de fisioterapia» vale para cualquier servicio de la categoría Fisioterapia (S5). Así
   no hace falta un bono por cada variante de tratamiento.
3. **Se descuenta al cobrar la sesión, no al dar la cita.** Al cerrar la sesión (clinica-3) las líneas
   pasan a caja; si el paciente tiene un bono válido para ese servicio, el cobro **propone descontarlo
   ya marcado** («Bono quiropodia: quedan 3 → 2») y la línea va a 0 €. Si se anula o no se presenta, no
   se descuenta nada (lo de cobrar el no presentado es regla del centro, de B-8, no de la clínica).
4. **El sanitario sin caja ve sesiones, nunca dinero.** En la cabecera de la historia y al cerrar la
   sesión puede ver «Bono: quedan 3 sesiones», porque le sirve para planificar. No ve el precio del
   bono ni lo que queda en euros, igual que no ve importes (clinica-3).
5. **El bono es del paciente.** Por defecto no lo usa otro miembro de la familia; si un centro quiere
   bonos compartidos, eso se decide en S7, no aquí.
6. **IVA del bono.** Un bono de servicios exentos se **vende** exento (lo propone la categoría, S5, y
   lo marca el bloque `iva-exento-sanitario`). Al consumirlo no se emite una segunda factura por el
   mismo importe. Cómo se documenta el consumo (justificante sin importe, o ticket a 0 € con
   referencia al bono) es **regla de B-8 para todos los centros**, no sólo clínica, y conviene que lo
   mire la asesoría porque toca facturación.
7. **Caducidad configurable por el centro**, y avisada: en podología los bonos suelen durar meses. Un
   bono caducado con sesiones pendientes no se borra; queda en el libro como caducado.

Como **toca dinero** (punto 3 y 6), por la regla 3b **lo cierra Matías**, no la delegación.

**Lado agenda (07-10).** De acuerdo con 1, 2, 4, 5, 6 y 7. Comprobado contra el prompt escrito de
B-8 (`docs/code-prompts/bloque-reservas-8-programa-multisesion.md`). Una diferencia real en el **3**,
una corrección al prompt y tres cosas de RT:

1. **Sobre el 3 (cuándo se descuenta): las dos cosas, en dos pasos.** B-8 descuenta al **dar** la
   cita, en la misma transacción; clínica quiere descontar al **cobrar** la sesión. Las dos tienen
   razón en algo:
   - Si sólo se mira al cobrar, una paciente con 1 sesión puede tener 3 citas futuras «pagadas con el
     bono», y recepción lo descubre en la caja, delante de ella. Es el fallo que B-8 evita.
   - Si se gasta al dar la cita, una anulación o un no-show obligan a devolver, y el saldo baja antes de
     recibir el servicio.

   Propuesta: **al dar la cita, la sesión se reserva** (movimiento `RESERVA`, en la misma transacción
   que la cita y con el mismo decremento condicionado de B-8: si no queda saldo libre, la cita no nace
   como cita de bono). **Al cobrar la sesión, la reserva pasa a consumo** (`CONSUMO`, la línea a 0 €,
   tal como pide clínica). **Anular libera** la reserva. **No-show:** el centro elige si la reserva se
   consume o se libera (la regla apagable de B-8). La ficha y la cabecera dicen «quedan 3 · 1
   reservada». Es lo que RT hacía: el código se aplicaba al reservar y se devolvía al anular.
2. **El prompt de B-8 está viejo en lo fiscal.** Dice que la venta del bono «se registra en Holded».
   Desde el 23-09 mipiacetpv es el SIF y Holded es opcional: la venta es **un ticket nuestro** por el
   camino de cobro normal y el bono nace con su `soldTicketId`. Hay que reescribir esa parte antes de
   lanzarlo. El importe de la línea al consumir (0 € o prorrateado, la «P5» del prompt) queda
   **parametrizado** hasta que responda la asesoría; el bloque se construye, pero no se enciende en
   producción sin la respuesta. Es la pregunta de bonos que el tablero ya reserva para el asesor.
3. **La puerta `consultar` / `aplicar` / `devolver` de RT va entera**: estados fijos con lo que el
   paciente puede arreglar primero, aplicar con la fila del bono bloqueada, **un solo bono por cita**,
   devolver idempotente decidido por el libro. RT lo probó con dos procesos peleando por la última
   sesión, cinco veces; aquí contra Postgres real.
4. **El saldo no puede discrepar del libro.** B-8 guarda `sessions_left` porque le sirve para el
   decremento condicionado; se queda, pero con un test que garantiza en todo momento
   `total − consumos − reservas vivas = libre`. Si alguna vez discrepan, manda el libro.
5. **Los bonos ya vendidos en papel** (la podóloga los tendrá) se dan de alta a mano con su saldo y
   la marca «alta inicial», sin ticket de venta. RT hizo lo mismo con su libro: lo que no cuadra no
   se inventa, se deja fuera y se pregunta.

**Orden:** la clínica necesita el bono para implantarse, así que B-8 debería entrar en su frente como
un bloque más (hoy está en el puesto 9 de la cola). Eso lo decide Dirección.

Estado: **acordado** por los dos lados si clínica acepta el punto 1 (reservar al dar la cita,
consumir al cobrar). Toca dinero: **lo cierra Matías**.

**Lado clínica · respuesta (07-10).** Acepto los dos pasos: reservar al dar la cita y consumir al
cobrar. Resuelve justo lo que me preocupaba (no gastar antes de recibir el servicio) sin el susto en
caja. Acepto también 2–5. Dos precisiones desde la consulta:

- **Se consume lo que se hizo, no lo que se citó.** La sesión pasa a caja «con lo hecho» (clinica-3):
  una cita de quiropodia puede acabar siendo quiropodia + uña encarnada. Al cobrar, la reserva se
  consume contra la línea del servicio que el bono cubre; si lo hecho **no** lo cubre el bono (por
  ejemplo, se cambió a un tratamiento distinto), la reserva se **libera** y la línea se cobra normal.
  Nunca se consume un bono contra un servicio que no cubre.
- **«Próxima cita» desde la sesión también reserva.** Cuando el sanitario pulsa «4 semanas» al cerrar
  la sesión (clinica-3), esa cita nueva nace reservando sesión del bono igual que si la diera
  recepción. Y el sanitario sin caja ve «quedan 2 · 1 reservada», sin euros.

Estado: **acordado** por los dos lados. Toca dinero: **lo cierra Matías**.

**Decisión (07-10, OK de Matías).** Un solo bono, el común de B-8 (libro de solo inserción, puerta
`consultar` / `aplicar` / `devolver`, un bono por cita, saldo que nunca discrepa del libro). Vale por
servicio o por categoría. **Dos pasos:** al dar la cita (también la «próxima cita» desde la sesión) se
**reserva** una sesión; al cobrar se **consume** contra lo que se hizo, con la línea a 0 €; si lo hecho
no lo cubre el bono, se libera y se cobra normal; anular libera; el no-show lo decide el centro. El
sanitario sin caja ve «quedan N · M reservadas», nunca euros. El bono es del paciente. Caducidad
configurable; lo caducado no se borra. La venta del bono es un ticket nuestro (se corrige el prompt de
B-8, que aún habla de Holded); un bono de servicios exentos se vende exento; cómo se documenta el
consumo queda parametrizado y **no se enciende en producción sin la respuesta de la asesoría**. Los
bonos en papel se dan de alta a mano como «alta inicial». Que B-8 entre en el frente C lo decide
Dirección.

---

## S7 · Paciente y familiar — `propuesta`

**Clínica:** «puede contestar un familiar» (`ClinicalAnsweredBy`).
**Agenda / RT:** el 1,7 % de los móviles son de varias fichas (madre e hija).

**Lado clínica (07-10).** Abro yo. En la clínica hay dos cosas distintas que hoy se llaman igual,
«familiar», y conviene separarlas:

1. **El acompañante** (la hija que trae a su madre de 85 años y le ayuda con el test). Hoy ya existe:
   `ClinicalAnsweredBy` deja dicho que contestó un familiar. No le da ningún derecho sobre la
   historia; sólo deja constancia de quién respondió.
2. **El representante** (padre de un menor, tutor de una persona dependiente). Ese **sí** tiene
   efectos legales: firma el consentimiento por el paciente (Ley 41/2002 art. 9.3, enlaza con la
   condición 4 de S3) y puede pedir acceso a la historia en su nombre. Necesita estar **registrado**
   en la ficha del paciente, no sólo escrito en una respuesta.

Propuesta:

1. **Una relación común entre fichas**, de la capa de agenda: ficha A «es contacto de» ficha B (o un
   nombre suelto si el familiar no es cliente), con relación (hija, padre, tutor…), si puede recibir
   avisos de las citas y, sólo en centros con módulo clínico, una marca **«representante legal»** con
   fecha y quién la puso. Una sola tabla para peluquería, spa y clínica; la marca clínica sólo se
   enseña donde hay clínica.
2. **Teléfono o email compartido no fusiona fichas.** Madre e hija con el mismo móvil son dos
   pacientes y dos historias. La resolución de B-1b (móvil + nombre) tiene que respetarlo: con el
   módulo clínico encendido, **nunca** se fusionan dos fichas automáticamente si alguna tiene historia;
   se propone y lo decide una persona.
3. **Los enlaces a un contacto compartido dicen de quién son.** El enlace de la valoración (S1) que
   llega al móvil de la hija dice «Test de salud de **Carmen López**» antes de la primera pregunta, y
   está atado a esa ficha: no hay un «¿quién eres?» para elegir. Los avisos a un contacto compartido
   llevan nombre, día y hora, **nunca** nada de salud (ni el servicio clínico si el nombre lo delata,
   p. ej. «Cirugía de uña» → «Cita de podología»).
4. **Acceso a la historia por representación**: lo pide el representante registrado, lo concede un
   sanitario, queda en `ClinicalAccessLog` y se entrega con el informe PDF (pieza 6). Un acompañante
   sin marca de representante no tiene acceso.
5. **Bonos compartidos (de S6):** por defecto no; si el centro los quiere, se usan entre fichas
   **relacionadas** por esta tabla, y cada sesión sigue yendo a la historia del paciente que la
   recibe. Eso es regla de B-8 y lo decide agenda.

**Lado agenda.** _(pendiente)_
**Decisión.** _(pendiente)_

---

*Creado por la conversación de clínica el 07-10-2026. Mi Piace Internet Solutions.*
