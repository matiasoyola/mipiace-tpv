# Bloque clinica-1 · done

Rama `clinica-1`, worktree `~/Developer/Claude/Projects/mipiacetpv-clinica-1`, rebasada sobre
`origin/master` = `f38afa0` (el merge de `mover-con-otra`, PR #6). Siete commits, 54 ficheros,
+6716 / −104.

**Este bloque no construye ninguna pantalla clínica.** Construye el suelo sobre el que van todas:
quién puede abrir una historia, cómo se demuestra que la abrió, y por qué lo escrito no se puede
borrar. Las pantallas (valoración, exploración, sesión, fotos, consentimientos, informe) son bloques
siguientes, cada uno con su mockup antes.

---

## 1 · El interruptor de la clínica

`Tenant.clinicalRecordsEnabled`, booleano, `@default(false)`. Mismo patrón que `agendaEnabled`
(ADR-R6) y mismo gobierno que `cajaEnabled` y `fichajeEnabled`: **sólo lo mueve el super-admin**,
por `PATCH /super-admin/tenants/:id`. No está en `POST /admin/tenant/settings`, así que un
propietario que lo intente recibe un 400 por `additionalProperties: false`.

### Las rutas clínicas dan 404, no 403

`clinica/gate.ts::ensureClinicaEnabled` contesta **la 404 de Fastify carácter por carácter**: mismo
cuerpo, mismas claves, mismo texto `Route GET:/… not found`. Es la única capability de la casa que se
esconde en vez de explicarse, y la razón es el dato: un 403 «no tienes el módulo de historia clínica»
le dice a un bar que ese módulo existe y que alguien guarda datos de salud en este sistema.

Un test lo fija comparando la respuesta gateada con la de una ruta que de verdad no existe. Si el
cuerpo se separa, el módulo deja de estar escondido: bastaría comparar dos respuestas.

La lectura **falla hacia APAGADO**, como la del control horario (ADR-018) y al revés que la de la
caja: la columna nace en `false`, así que «no se pudo leer la fila» se parece mucho más a «no lo
tiene»; y fallar hacia encendido abriría datos de salud a quien no los ha contratado.

### La guarda, en los dos sentidos

- **Encenderlo exige CRM y agenda.** La historia cuelga de un `Client` (CRM) y el acceso nace de una
  `Appointment` (agenda). Sin las dos, el módulo existe y no hace nada. 409
  `CLINICAL_RECORDS_NEEDS_MODULES`, que dice cuál falta. Encender los tres en la misma llamada
  funciona.
- **Apagarlo con historia dentro, no.** 409 `CLINICAL_RECORDS_HAS_HISTORY` con el recuento. Apagar es
  dejar de servir las rutas y esconder la ficha técnica: la historia se queda en la base, intacta y
  sin que nadie pueda llegar a ella. Eso no es apagar un módulo, es perder el acceso a un registro
  legal que hay que conservar cinco años y enseñarle al paciente si lo pide.

### ¿Debería poder encenderlo la dueña? **No, y es una recomendación, no una limitación técnica**

Está fuera de alcance por el prompt y lo dejo fuera también como propuesta. Encender esto no es
activar una función: es **aceptar ser responsable de un registro legal de datos de salud** (Ley
41/2002, art. 9 RGPD), y Mi Piace pasa a ser encargado de tratamiento. Eso se habla, se firma y se
acompaña — no se marca en Ajustes un martes por la tarde.

Si Dirección decide lo contrario, el cambio es una línea en el schema del POST de
`admin/tenant-settings.ts` y un toggle en la pantalla; el comentario que lo explica ya está escrito
ahí mismo.

**Cómo se enciende hoy** (no hay UI, igual que `fichajeEnabled`, que tampoco la tiene):

```
PATCH /super-admin/tenants/<id>   { "clinicalRecordsEnabled": true }
```

---

## 2 · Rol de negocio + marca sanitaria

Decisión de producto del 05-10: **en pantalla tres nombres, por dentro dos columnas.**

| Lo que se ve        | `role`      | `isClinician` |
| ------------------- | ----------- | ------------- |
| Cajero              | `CASHIER`   | `false`       |
| Cajero-sanitario    | `CASHIER`   | `true`        |
| Sanitario           | `CLINICIAN` | `true`        |
| Propietaria         | `OWNER`     | `false`       |
| Propietaria · sanitaria | `OWNER` | `true`        |
| Encargado (+ sanitario) | `MANAGER` | `false`/`true` |

Columnas nuevas en `User`: `isClinician`, `clinicianLicense`, `clinicalScope`
(`ALL | SELECTION`, default `SELECTION` — lo seguro es lo restrictivo).

El cruce lo hace **la API** (`staff/routes.ts::puestoVisible`) y no el front. Si cada pantalla lo
dedujera por su cuenta, dos acabarían llamando distinto a la misma persona.

`role = CLINICIAN` implica `isClinician` **por CHECK de la base**
(`users_clinician_implies_flag`), no por un `if`. No existe el estado «lleva el rol del sanitario y
la marca apagada», que es desde donde la función de acceso diría «no es sanitario» para alguien que
la pantalla pinta como sanitario.

El nº de colegiado es opcional en la base (sólo se exige que no esté en blanco:
`users_clinician_license_not_blank`) y **obligatorio en la API** al marcar sanitario en un tenant con
la clínica encendida — la condición cruza `users` y `tenants`, así que no cabe en un CHECK.

### ¿Se podía evitar tocar el enum? No, y lo intenté

La alternativa era «sanitario = `CASHIER` con `isClinician` y una tercera columna `puedeCobrar`».
Se cae por dos sitios: el rol viaja firmado en los dos JWT (panel y TPV), así que la negativa al
cobro necesitaría una consulta a la base **en todas** las rutas de caja en vez de en las de un rol
concreto; y «cajero que no puede cobrar» es un cajero roto para toda la lógica que ya existe
(el roster del TPV, el panel del super-admin, los candidatos a PIN de encargado). El valor nuevo es
más honesto y lo paga una sola vez, en la revisión de abajo.

---

## 3 · Los sitios del enum de roles, y qué se decidió en cada uno

Añadir un valor a `UserRole` obliga a revisar cada comparación. Veinte sitios, uno por uno.

### API

| # | Sitio | Decisión |
| - | ----- | -------- |
| 1 | `schema.prisma:19` `enum UserRole` | **Se añade** `CLINICIAN`. |
| 2 | `auth/tokens.ts` `AccessTokenPayload.role` | **Se ensancha.** El JWT se firma desde `user.role`; no listarlo habría obligado a un cast que esconde el valor. Firmarlo no le abre nada. |
| 3 | `auth/middleware.ts` `AuthContext.role` | **Se ensancha.** Llega por la puerta del TPV para la agenda y lo clínico. |
| 4 | `auth/must-change-password.ts` | **Se ensancha por tipo, no por uso.** Ese JWT sólo lo emite el alta de un OWNER; un sanitario no tiene password. |
| 5 | `auth/routes.ts:157` login del panel | **Comparte la rama del cajero.** `CASHIER_NOT_ALLOWED_IN_ADMIN`, con el mensaje ampliado. Caer al `NOT_OWNER_OR_MANAGER` de abajo le diría «sólo propietarios o encargados», que es verdad y es inútil: lo que necesita saber es por dónde SÍ entra. |
| 6 | `shift/cashier-session.ts` payload | **Se ensancha.** El sanitario entra al TPV por la misma puerta. |
| 7 | `shift/cashier-auth.ts:75` `/shift/cashier-login` | **Se añade al `role: { in: … }`.** Dejarlo fuera habría escondido la negativa en la puerta de entrada, y la puerta de entrada no es donde se razona. |
| 8 | `shift/cashier-auth.ts:270` roster offline | **Se añade.** Sin red tiene que poder entrar a ver su agenda cacheada. |
| 9 | `shift/routes.ts:688` tipo del contexto | **Se ensancha**, pero ninguna ruta del fichero lo verá: todas llevan `ensureCajaEnabled`. |
| 10 | `shift/routes.ts:899` candidatos a PIN de encargado | **NO se añade.** Un sanitario no autoriza cierres de caja. |
| 11 | `agenda/routes.ts:107` `requireConfigRole` | **NO se añade.** Configurar la agenda sigue siendo de OWNER/MANAGER. Correcto por defecto. |
| 12 | `staff/routes.ts:211` `GET /staff` | **Se añade.** El sanitario es un profesional de la agenda de pleno derecho; sin esto no saldría en Personal, que es justo donde se le pone el alcance. |
| 13 | `cashiers/routes.ts` (×6: listar, crear, renombrar, PIN, revocar, colisión de alias) | **Se añade en las seis.** Es el mismo acto —dar de alta a alguien con su PIN— y un CRUD paralelo habría duplicado la unicidad del alias, el centinela de revocación y el reset. Que falte en una sola significa un sanitario al que no se le puede cambiar el PIN, o que no sale en la lista desde la que se revoca. El alta con `CLINICIAN` exige la clínica encendida (409). |
| 14 | `superadmin/tenant-cashiers.ts` | **Se añade**, y `lastLoginSource` lo trata como al cajero: el login del panel lo rechaza, así que su última entrada es inequívocamente del TPV. |
| 15 | `superadmin/test-cashier.ts` | **No cambia.** El cajero técnico es MANAGER por construcción. |
| 16 | `lib/caja-gate.ts` | **Aquí vive la negativa.** Ver §7. |

### Panel

| # | Sitio | Decisión |
| - | ----- | -------- |
| 17 | `admin/src/api.ts` `AdminRole` | **Se ensancha por completitud**, no porque pueda llegar: sin listarlo, un sanitario con token caería al `null` de «token corrupto» y la app forzaría re-login en bucle en vez de contarle que entra por el TPV. `canEdit` sigue siendo sólo OWNER. |
| 18 | `admin/src/superadmin/types.ts` (×2) | **Se ensancha.** |
| 19 | `admin/src/superadmin/CashiersPanel.tsx` `CASHIER_ROLE_LABEL` | **`Record` exhaustivo → el typecheck obligó a venir.** «Sanitario (sin caja)». |
| 20 | `admin/src/pages/CashiersPage.tsx` | Tipo + `ROL_LABEL` exhaustivo (sustituye a un ternario que pintaba «Cajero» para todo lo que no fuera encargado) + la opción en el alta, sólo con la clínica encendida. |
| 21 | `admin/src/pages/StaffPage.tsx` | Tipo + el puesto derivado de la API. |

### TPV

| # | Sitio | Decisión |
| - | ----- | -------- |
| 22 | `lib/offlineAuth.ts` `CashierRole` | **Se ensancha**, y pasa a ser **el tipo compartido**. |
| 23 | `pages/PinScreen.tsx` `CashierLoginResponse.user.role` | **Se ensancha.** Es la FUENTE del rol para todo el TPV. |
| 24 | `storage.ts`, `App.tsx` (×2), `SalePage.tsx` (×2), `CloseShiftModal.tsx`, `ShiftResumeScreen.tsx`, `TableMapScreen.tsx` | **Pasan a `CashierRole`.** Eran cuatro copias de la misma unión literal. |
| 25 | `CloseShiftModal.tsx:575` `cashierRole === "CASHIER"` | **Pasa a «no es encargado ni dueña».** Mismo sentido para los roles de antes, correcto para el nuevo. |

### Y un hallazgo de paso: la unión del TPV mentía desde v1.3

Al ensanchar `CashierLoginResponse.user.role` saltaron cinco errores de tipo que **no eran míos**:
`"OWNER" is not assignable to "MANAGER" | "CASHIER"`. Desde `v1.3-piloto-feedback · Lote 1` el OWNER
abre turno en el TPV con su propio PIN, y la unión de las props nunca se actualizó. No llegó a dar un
fallo porque las comparaciones eran por igualdad y el OWNER caía al `else`, pero el tipo decía algo
falso. Queda arreglado.

---

## 4 · La función de acceso

`apps/api/src/clinica/acceso.ts`. **Pura**, sin base de datos y sin reloj:

```
clínica encendida? → es sanitario? → alcanza a este paciente?
```

El orden importa: la primera es la única condición que no habla de esta persona, y contestar «no eres
sanitario» en un tenant apagado sería contestar otra pregunta.

**No mira el rol de negocio.** Ni `OWNER`, ni `CLINICIAN`, ni `CASHIER` aparecen en el fichero: quien
decide es la MARCA. De ahí salen dos cosas a la vez: una **dueña no sanitaria** (un gerente) no ve
historias sin que haya que acordarse de ello, y si mañana entra un cuarto rol de negocio esta
función no cambia.

`resolverAccesoClinico` la alimenta y **sólo consulta la tabla de accesos cuando puede cambiar el
veredicto**: un tenant no clínico, alguien que no es sanitario o un alcance `ALL` no gastan la
consulta. No es cosmético — es lo que hace que los quince clientes de hoy no paguen nada por este
bloque en cada `GET /clients/:id`.

Tabla de casos (`clinica-acceso.test.ts`, 15 tests): los nueve que pide el prompt, uno por `it` con
nombre, más que cada negativa trae un mensaje que dice qué hacer, más el `revokedAt: null` del WHERE
—que es lo que hace que una revocación quite el acceso y lo único que se rompería en silencio—, más
la economía de consultas.

---

## 5 · El acceso por paciente, y de dónde nace

Tabla `clinical_access`: `clinicianUserId`, `clientId`, `source` (`APPOINTMENT | MANUAL`),
`grantedAt`, `grantedByUserId` (NULL si viene de la agenda), `revokedAt`, `revokedByUserId`.

**No se borra nunca.** Revocar rellena la fecha; volver a dar acceso crea **otra fila**.

### El índice parcial hace tres trabajos a la vez

```sql
CREATE UNIQUE INDEX "clinical_access_one_live_key"
    ON "clinical_access"("clinician_user_id", "client_id")
    WHERE "revoked_at" IS NULL;
```

Con el `ON CONFLICT … DO NOTHING` del enganche, de aquí salen sin un solo `if`:

- mover una cita **conservando** a su profesional no crea filas nuevas;
- dos terminales a la vez no crean dos accesos;
- y tras una revocación **sí** se inserta otra fila —la revocada no está en el índice—, así que una
  cita nueva le devuelve el acceso y la revocación se queda en el histórico. Que es, literal, la
  decisión de producto nº 7.

Durante los sabotajes salió una comprobación que vale más que un test en rojo: **con una revocación
seguida de reasignación en la tabla, el índice total ni siquiera se puede crear** — Postgres lo
rechaza por clave duplicada. El índice parcial no es una optimización, es la única forma que admite
ese histórico.

### El enganche: el punto único donde nacen las asignaciones

`agenda/store.ts` tenía **el mismo INSERT copiado en `insertHold` y en `reschedule`**: dos bucles con
el mismo SQL y nada que garantizara que seguirían siendo iguales. Se funden en
`persistirAssignments`, y ahí cuelga `otorgarAccesoClinicoPorCita`, **en la misma transacción que la
cita** (media operación deja a un sanitario con una cita cuya historia no puede abrir).

El motor (`engine.ts`) **no se toca**.

### Y `mover-con-otra` ya cobró el cheque

Al escribir el bloque, `mover-con-otra` vivía en su rama y el test quedó pendiente. Entró en
`origin/master` con el **PR #6**, se rebasó, y el test está activo: **caso 4 de
`clinica-acceso-por-cita.e2e.ts`**.

Lo que demuestra es por qué el enganche se puso donde se puso: el camino de cambiar de profesional al
mover **no existía** cuando se escribió esto, pasa por `reschedule` y no por el alta, y funciona sin
que `mover-con-otra` haya tocado **una sola línea** de lo clínico. Enganchado en la ruta de alta,
habría hecho falta acordarse — y nadie se acuerda.

El único conflicto del rebase fue el detalle de la cita de `AgendaPage`, donde los dos bloques
añadían una prop (`onMove` con `staffUserId` por un lado, `puedeCobrar` por el otro): se quedan las
dos.

### A mano

`POST`/`DELETE /clinica/clinicians/:userId/clients[/:clientId]`, sólo OWNER/MANAGER. El POST es
idempotente (200 con `created: false` si ya hay uno vigente: un doble toque no es un error) y rechaza
con 409 `NOT_A_CLINICIAN` dar acceso a quien no lleva la marca — sería una fila que no significa nada
y que la función de acceso ignoraría.

---

## 6 · El registro de accesos

`clinical_access_log`, **sólo inserciones**: `userId`, `clientId`, `action` (`READ|WRITE|EXPORT`),
`outcome` (`ALLOWED|DENIED`), `at`, `deviceId`, `route`.

Lo escribe **un único punto**: `clinica/registro.ts::conHistoria(...)`. Resuelve la función de
acceso, **apunta la línea antes de ejecutar el handler**, y sólo entonces deja correr. Un handler
envuelto no puede correr sin que su línea esté escrita, porque la escritura va antes.

**Los denegados también se apuntan.** Un acceso que se niega es justo el que interesa ver cuando
alguien pregunta quién ha estado mirando la historia de su madre.

**Si la línea no se puede escribir, la petición falla** (500 `CLINICAL_ACCESS_LOG_FAILED`). Es la
misma decisión que el audit de impersonación, y la **contraria** a la del cobro («cobrar siempre se
puede»): ahí el dinero ya cambió de manos y una invariante rota no puede tumbar la venta; aquí nadie
pierde nada si la lectura no ocurre, y lo que no se puede perder es la prueba de que ocurrió.

Ruta para la dueña: `GET /clinica/clients/:clientId/access-log`, paginada, OWNER/MANAGER, con los
denegados dentro.

**Nada de salud entra aquí.** Ni el cuerpo, ni el motivo, ni un extracto: quién, a qué paciente,
cuándo, desde qué aparato, qué ruta y si se le dejó. Tampoco a `request.log` ni a Sentry — los
`catch` del fichero registran el fallo sin tocar el `body`.

---

## 7 · El TPV del sanitario, y que no cobra

### La negativa, en UN sitio

`lib/caja-gate.ts::ensureCajaEnabled` rechaza a un `CLINICIAN`. Con eso quedan cubiertas de golpe las
**103 rutas de caja** que el guardia de cableado de `h1-caja-gate.test.ts` cuenta una por una:
tickets, turno, mesas, fiscal, fiado, impresión, catálogo del TPV. Cien sitios donde acordarse son
cien sitios donde olvidarse, y el olvido aquí es un cobro firmado por quien no cobra.

Las tres rutas que no llevan el gate siguen sin llevarlo, y las tres están bien así:
`/shift/cashier-login` sí lo lleva pero cuando corre todavía no hay rol que mirar (sólo el device
token), así que el sanitario entra; `/shift/cashier-logout` no lo lleva desde H1 (salir tiene que
funcionar siempre); y `GET /tpv/catalog/products` tampoco (leer el catálogo no es cobrar, y la agenda
necesita los servicios).

### Y la ventana de transición, que era un agujero de verdad

La sesión del TPV vive el turno entero (`cashierSessionTtlMinutes`, 12 h por defecto) y **su JWT no
lleva `tokenVersion`**: incrementarlo al cambiar el rol invalida los tokens del panel y NO el del
TPV. Sin cerrarla, una cajera que pasa a sanitaria seguiría cobrando media jornada con el token que
dice `CASHIER` — justo el día de la implantación, que es cuando se cambian los roles.

Así que la puerta hace **dos** comprobaciones:

1. **El rol del JWT.** Sin I/O, no puede fallar. Cubre a todo sanitario real (su token dice
   `CLINICIAN` desde el login).
2. **El rol en la base.** Sólo para sesiones de `CASHIER` —un OWNER o un MANAGER no se vuelve
   `CLINICIAN` desde ninguna pantalla—, así que la consulta extra no se la come la propietaria, que
   es la que cobra todo el día en el piloto.

La lectura **falla hacia encendido**, igual que `cajaIsDisabled`: una lectura que revienta no puede
ser el motivo de que un cliente no pueda pagar. Lo que se pierde al fallar es exactamente la ventana
que ya existía; lo que no se pierde nunca es la comprobación 1.

### La pantalla

Un `CLINICIAN` entra con su PIN y ve **sólo su agenda**. El desvío es **un `if` en `App.tsx`** y nada
más, colocado **antes** de toda la maquinaria de turno: pedirle a quien no cobra que abra turno para
llegar a su agenda es pedirle un arqueo de una caja que no toca.

**Y sobre la pregunta del prompt:** la pantalla de venta **ya no era** la puerta obligatoria a la
agenda. Lo arregló `B-reservas-5 F1`, que subió `showAgenda` de `SalePage` a `App`; la agenda es un
overlay `fixed inset-0` colgado de ahí. Lo único que seguía viviendo en `SalePage` era el **botón**
de abrirla, y un botón no es una puerta. Por eso el mínimo de verdad son esas líneas y no un
rediseño.

Su agenda arranca filtrada por él (`staffFilterInicial`) y **se puede quitar**: las citas de las
compañeras no son datos de salud —la agenda sólo enseña contacto, decisión de producto del 05-10— y
necesita verlas para saber si la sala está ocupada. «Cobrar en caja» no se le pinta; esconder el
botón es por no ofrecer una acción que siempre falla, no por seguridad.

---

## 8 · La pantalla de personal

En `StaffPage` (es la que manda: lista a **todos** los profesionales incluido el OWNER, mientras que
`CashiersPage` sólo lista `MANAGER|CASHIER`), y **sólo con la clínica encendida** — la bandera sale
del mismo `GET /admin/tenant/settings` que la pantalla ya pedía, así que no hay una petición más.

- **Puesto** en tres botones a un toque, con el área tocable de 44 px del estándar de la casa.
- **Nº de colegiado** al marcar sanitario, obligatorio: Guardar se bloquea y el aviso sale **antes**
  de llegar al 400.
- **Alcance** en dos botones.
- **Sus pacientes** con el origen de cada uno (agenda / a mano), añadir por nombre —reusando la
  búsqueda del CRM que ya existe— y revocar, con la frase «revocar no borra nada». La lista **no se
  pide hasta que se abre**: un tenant con seis sanitarios haría seis peticiones al desplegar.
- La **propietaria y el encargado** no cambian de puesto aquí: se marcan o no (409
  `PUESTO_NO_EDITABLE` si se intenta).

`PATCH /staff/:userId/clinica` lleva **tres puertas**: `requireOwner`, la de la agenda y la del
módulo. OWNER y no OWNER-o-MANAGER porque esto decide **quién ve datos de salud**: misma clase que
crear un usuario, que ya es sólo del OWNER. Lo que el encargado SÍ puede es dar y quitar pacientes a
un sanitario ya marcado, que es exactamente lo que el prompt le atribuye.

Capturas en `docs/qa/2026-10-05-clinica-1/`: escritorio, 390, 320, el error (sanitaria sin colegiado)
y la propietaria sanitaria con alcance «todos».

**Un arreglo salió de mirarlas, no de pensarlas:** a 320 px la línea de la cabecera trunca, y con el
email delante lo que se cortaba era el PUESTO — lo único que esa pantalla existe para decir. El email
es largo y variable, el puesto corto y fijo: trunca el que sobra.

---

## 9 · Lo clínico no se borra

### Las FKs

Las cuatro tablas cuelgan de `tenants` y de `clients` con **`ON DELETE RESTRICT`** (siete FKs; un
test cuenta que no hay ni una `CASCADE`). Es la diferencia de fondo con `client_consents` y
`client_technical_notes`, que son `CASCADE`: aquello se puede perder con la ficha, esto no.

La autoría es `NOT NULL` + `RESTRICT` en las dos tablas de historia: una línea sin autor no es
historia clínica, es una nota anónima. Borrar al autor también se niega.

### Los caminos de borrado, buscados uno por uno

| Camino | Qué se encontró | Cómo se cierra |
| ------ | --------------- | -------------- |
| `DELETE /clients/:id` | **No existe.** Ninguna ruta borra un cliente. | Las FKs `RESTRICT` lo impedirían el día que se escriba. |
| Borrado de tenant | **No existe** ninguna ruta en `superadmin/tenants.ts` (hay `dejar-holded`, que no borra nada). | Igual: `RESTRICT`. |
| `purgeTestData` (activación del tenant) | Borra tickets `TEST` y hace soft-delete del cajero técnico. **No toca clientes ni nada clínico.** | Sin cambios. |
| `DELETE /cashiers/:id` | **Soft-delete** (PIN a null, email centinela, `tokenVersion++`). Conserva el histórico. | Sin cambios; se le añadió `CLINICIAN` para que un sanitario también se pueda revocar. |
| `DELETE /staff/:userId` | Quita perfil de agenda, skills y turnos. **No toca al user ni nada clínico.** | Sin cambios: un sanitario sacado de la agenda conserva sus accesos, y nada clínico se borra. |
| Seed del banco (`TRUNCATE`) y `DROP SCHEMA` del e2e | Infraestructura de pruebas, con sus propias redes de seguridad por nombre de base. | Declarado, sin cambios. |

**O sea: hoy no hay ningún camino de aplicación que borre un cliente o un tenant.** La garantía está
en el modelo, no en un `if`, y por eso aguanta el camino que todavía no existe.

### Y la negativa se explica

Un `RESTRICT` o un trigger llegaban al cliente como un 500 «Error de base de datos (P2010)»: verdad, y
completamente inútil. `error-handler.ts::negativaClinica()` los reconoce por el prefijo
`HISTORIA_VIOLADA` y por el nombre de la constraint `clinical_*_fkey`, y devuelve **409** con la
frase que toca. 409 y no 500 porque no es una avería, es el sistema funcionando; y sin `captureError`
porque una negativa esperada no es una alarma de Sentry. El mensaje de Postgres **no se reenvía** —
lleva ids de fila y nombres de tabla, que son para el log.

### La ficha técnica

En un tenant clínico, `ClientTechnicalNote` **deja de salir** en `GET /clients/:id` para quien no sea
sanitario con acceso a ESE paciente, y tampoco se puede escribir (simétrico: quien no puede leerla no
puede añadirle una línea, que es la mitad peor de las dos). Se devuelve `technicalNotesHidden: true`,
campo nuevo y opcional, porque un array vacío y un array escondido no son lo mismo y la ficha tiene
que poder decir «esto está en la historia clínica».

**200 y no 403:** la ficha del cliente se sigue abriendo —el teléfono es suyo y la recepcionista lo
necesita—, lo que falta es la ficha técnica.

En el resto de tenants (Sole y los otros catorce) **no cambia nada**: la función contesta «clínica
apagada» sin consultar nada más.

---

## 10 · La tabla de sabotajes

| Garantía | Qué línea de producción se rompe | Qué se pone rojo | Mensaje real |
| -------- | -------------------------------- | ---------------- | ------------ |
| **No se borra** (entrada) | Quitar el trigger `clinical_entries_inmutable` | `clinica-historia.e2e.ts` · «un DELETE a mano sobre una entrada falla» | `HISTORIA_VIOLADA: la historia clínica no se borra (clinical_entries.<id>). Se conserva y se le añaden anotaciones.` |
| **No se borra** (paciente) | `ON DELETE RESTRICT` → `CASCADE` en `clinical_entries_client_id_fkey` | e2e «BORRAR AL PACIENTE con historia falla» + `clinica-migracion.test.ts` «NINGUNA FK clínica es CASCADE» | `update or delete on table "clients" violates foreign key constraint "clinical_entries_client_id_fkey"` |
| **No se edita** | Quitar el `RAISE` del UPDATE en `mipiacetpv_clinical_inmutable` | e2e «un UPDATE del cuerpo de una entrada falla» | `HISTORIA_VIOLADA: la historia clínica no se edita (…). Lo escrito queda; para corregirlo se añade una anotación con su autor y su fecha.` |
| **Todo acceso se apunta** | Borrar el `await apuntarAcceso(...)` de `conHistoria` | `clinica-rutas.test.ts` · «la lectura permitida deja una línea ALLOWED con la ruta» | `expected [] to have a length of 1` |
| **…y el denegado también** | `outcome: veredicto.puede ? "ALLOWED" : "DENIED"` → apuntar sólo si `puede` | `clinica-rutas.test.ts` · «LA DENEGADA TAMBIÉN: la cajera lo intenta y queda escrito» | `expected [] to have a length of 1` |
| **El registro no se toca** | Quitar `clinical_access_log_append_only` | e2e «el registro de accesos no se edita ni se borra» | `HISTORIA_VIOLADA: clinical_access_log es sólo inserciones (intento de UPDATE sobre la línea <id>).` |
| **Sólo la ve quien debe** | `if (!estado.esSanitario)` → `if (false)` en `puedeVerHistoria` | `clinica-acceso.test.ts` · «NO es sanitario → no» y «la DUEÑA NO sanitaria» | `expected true to be false` |
| **El acceso nace de la cita** | `await otorgarAccesoClinicoPorCita(...)` → `if (false) await …` | **4 casos** de `clinica-acceso-por-cita.e2e.ts` (1, 4, 5, 8) | `expected [] to deeply equal [ { source: 'APPOINTMENT', revocado: false } ]` |
| **…también al MOVER** | Enganchar sólo en el alta (`clientId: null` en `reschedule`) — el fallo que el prompt avisa | **caso 4** «MOVER CON OTRA SANITARIA le da el acceso» y caso 8 | `expected [] to deeply equal [ { source: 'APPOINTMENT', … } ]` |
| **El sanitario no cobra** | Quitar la comprobación de `esSanitarioSinCaja` en `ensureCajaEnabled` | `clinica-sanitario-sin-caja.test.ts` · las 4 rutas (venta, turno, cajón, informe) | `expected 200 to be 403` |
| **…ni en la ventana** | Quitar la comprobación 2 (el rol de la base) | «LA VENTANA: el token dice CASHIER y la base dice CLINICIAN → no cobra» | `expected 200 to be 403` |
| **404 y no 403** | `respondeComoRutaInexistente` → `reply.code(403)` | `clinica-rutas.test.ts` · «la 404 es INDISTINGUIBLE de la de una ruta que no existe» | `expected 403 to be 404` |
| **Sole no nota nada** | `DEFAULT false` → `true` en `clinical_records_enabled` | `clinica-migracion.test.ts` + `crm-route.test.ts` «tenant NORMAL: la cajera la sigue viendo» | `expected [] to have a length of 1` |

### Lo que los sabotajes enseñaron

Dos cosas que no sabía antes de hacerlos:

1. **`ON CONFLICT DO NOTHING` sin target es equivalente aquí.** Escribí el `ON CONFLICT
   ("clinician_user_id","client_id") WHERE "revoked_at" IS NULL` pensando que era lo que garantizaba
   el comportamiento. Lo saboteé a `ON CONFLICT DO NOTHING` a secas y **los diez casos siguieron en
   verde**: el único índice único de la tabla es el parcial, así que el conflicto sólo ocurre contra
   él. La forma explícita se queda porque documenta la intención y protegería de un segundo índice
   futuro, pero **lo que de verdad garantiza el comportamiento es el índice**, no la cláusula. Está
   dicho así en el comentario.
2. **El índice total es imposible, no sólo incorrecto.** Al intentar sabotearlo a no-parcial, Postgres
   se negó a crearlo: con una revocación-y-vuelta ya en la tabla, hay clave duplicada. Más fuerte que
   un test en rojo.

---

## 11 · Decisiones tomadas sin preguntar

1. **El registro NO se escribe en `GET /clients/:id`.** Es la ficha por la que la recepcionista pasa
   cincuenta veces al día a coger un teléfono; apuntar un `DENIED` por cada una llenaría de ruido la
   lista de «quién ha abierto la historia de este paciente» justo con lo que no es un intento de
   abrirla, y eso hace el registro **menos** útil, que es el daño real. El registro cubre las rutas
   clínicas, que es donde vive la historia. El bloque que mueva la ficha técnica dentro de la
   historia cierra esto del todo.
2. **Dar y revocar accesos NO pasa por `conHistoria`.** Son gestión de permisos, no historia: apuntar
   «la dueña abrió la historia» cuando lo que hizo fue administrar sería una línea falsa.
3. **El sanitario se da de alta por `POST /cashiers`** y no por un CRUD propio. Mismo acto, y un CRUD
   paralelo habría duplicado tres cosas.
4. **`body` es `jsonb` y no texto.** Lo que viene (valoración, mapa del pie, sesión) es estructurado,
   y cambiar su forma dentro de un JSON no exige migrar una tabla append-only. Con CHECK contra el
   objeto vacío.
5. **El filtro de la agenda del sanitario es inicial, no un bloqueo** (ver §7).
6. **`clinicalRecordsEnabled` fuera de `MODULE_FIELDS`**: no entra en el invariante «al menos un
   módulo encendido», porque un tenant cuyo único módulo fuera éste no tendría ni pacientes ni citas.
7. **`EXPORT` entra en el enum sin usarse.** El informe PDF es un bloque posterior; que el registro no
   cambie de forma cuando llegue es gratis hoy.

---

## 12 · Dudas abiertas

1. **El derecho de supresión del RGPD choca con la conservación de la Ley 41/2002**, y este bloque se
   pone del lado de conservar. Es lo correcto para una historia clínica (la ley sanitaria es especial
   frente a la general), pero la respuesta a «quiero que borréis mis datos» necesita un camino
   escrito: seudonimización, bloqueo, o la negativa motivada. **Es de abogado, no de código**, y el
   409 que hoy devuelve el motor es el sitio donde ese camino se enganchará.
2. **Cinco años, ¿desde cuándo?** La ley dice «desde el alta de cada proceso asistencial» y hay
   normativa autonómica que alarga. Hasta que haya una política escrita, aquí no se borra nada nunca,
   que es el lado seguro.
3. **La ficha técnica sigue viviendo en `ClientTechnicalNote`**, fuera de la historia y sin
   inmutabilidad ni registro. Se esconde, que es lo que el prompt pide, pero lo limpio es moverla
   dentro. Bloque siguiente.
4. **Cifrado a nivel de campo**: fuera de alcance por el prompt y sin hacer. Hoy el `body` está en
   claro en la base.
5. **Un `CLINICIAN` en un tenant con `cajaEnabled = false`** no puede hacer login en el TPV, porque
   `/shift/cashier-login` lleva el gate de la caja. Hoy no se da (una clínica cobra), pero una
   consulta que sólo lleve historias y agenda se encontraría con ello.
6. **Tres sanitarios con alcance `ALL`** hacen que el acceso por paciente no se use. Es correcto y
   puede sorprender: en una clínica de una sola podóloga, `ALL` es lo razonable y la lista de
   pacientes de §8 no aparece nunca.

---

## 13 · Lo que NO cubre este bloque

Declarado en el prompt y respetado: la valoración inicial y el test del paciente, el mapa del pie, la
sesión, las fotos, los consentimientos firmados y el informe PDF; el IVA exento en Verifactu
(`registro.ts` sigue declarando `S1`); la app para iPad (Capacitor iOS); el cifrado a nivel de campo,
el contrato de encargado y la evaluación de impacto; y que la dueña encienda la clínica desde
Ajustes.

Y además, no cubierto y no declarado antes: **no hay pantalla de super-admin** para el interruptor
(se mueve por API, igual que `fichajeEnabled`, que tampoco la tiene).

---

## 14 · Cómo se cierra

### Migración · HAY MIGRACIÓN, y son dos

- `20261005000000_clinica_1_modulo` — el interruptor, la marca sanitaria y el valor del enum.
- `20261005010000_clinica_1_historia` — las cuatro tablas, los triggers y el CHECK del rol.

**Las dos son aditivas**: ni un `DROP`, ni un `TRUNCATE`, ni un `DELETE`, ni un `UPDATE` masivo (el
backfill ES el `DEFAULT`; desde PG 11 eso no reescribe la tabla). Un test lo fija.

**Por qué son dos y no una:** un `CHECK` que nombra `'CLINICIAN'` **usa** el valor del enum, y
Postgres prohíbe usar un valor nuevo en la misma transacción en que se añade. Juntas, la migración
aborta con «unsafe use of new value of enum type». Un test lo fija también.

**Aplicada en una copia**, no en producción: `mipiacetpv_clinica1_copia`, creada con
`CREATE DATABASE … TEMPLATE mipiacetpv` (la base de desarrollo, con filas reales dentro). De paso
salió que esa copia arrastraba una precondición pendiente de `verifactu_1_registro` (dos TERMINAL
activos en la misma caja) — **no es de este bloque**, se resolvió en la copia como el propio mensaje
de la migración indica.

El **`down`** está escrito en la cabecera de cada una, incluido lo que **no** se puede deshacer: un
valor de enum no se quita en Postgres (`ALTER TYPE … DROP VALUE` no existe); hay que recrear el tipo
entero y sólo es seguro si ningún usuario lo lleva puesto.

### Despliegue

1. `prisma migrate deploy` (lo hace el arranque de la imagen).
2. Nada más. **Ningún tenant cambia de comportamiento**: las dos capabilities nacen apagadas.
3. Para encender la clínica a un cliente: `PATCH /super-admin/tenants/:id` con
   `{"clinicalRecordsEnabled": true}` (exige CRM y agenda encendidos).

**Sin `COPY` nuevo en `infra/Dockerfile`**: no nace ningún paquete ni manifest; las migraciones van
bajo `packages/db/prisma/`, que entra por el `COPY . .`.

### Verde

- `pnpm test` · **281 ficheros, 3127 tests, 3 skipped.** Verde.
- `pnpm test:e2e` · **25 ficheros, 393 tests.** Verde, sobre `mipiacetpv_clinica1_e2e`.
- `pnpm e2e:agenda` · verde, sobre `mipiacetpv_clinica1_banco_e2e` con puertos propios
  (3111/5283/5284) y Redis propio (6392).

  **Y una trampa que costó dos pasadas, por si le pasa a alguien más:** el `webServer` del banco
  arranca la API con `nodemon`, que vigila `apps/api/src`. Editar un fichero del API **mientras el
  banco corre** la reinicia a media pasada, y lo que se ve es un `500` en `/auth/login` y todos los
  capítulos muertos en `entrarAdmin` — que parece un fallo de la rama y no lo es. La segunda pasada,
  sin tocar nada, va limpia.
- `tsc` de API, tpv-web y admin · limpio.
- CI (`ci`, `smoke`, `e2e`) · pendiente del push; se anota el run aquí.

### Lo nuevo de este bloque

- `clinica-acceso.test.ts` (15) · la tabla de casos de la función.
- `clinica-rutas.test.ts` (25) · el gate, el registro y la inmutabilidad por ruta.
- `clinica-sanitario-sin-caja.test.ts` (14) · que no cobra, con la ventana de transición.
- `clinica-migracion.test.ts` (27) · el contrato del SQL.
- `clinica-personal.test.tsx` (13) · la pantalla, y que el tenant sin clínica no la ve.
- `clinica-historia.e2e.ts` (20) · los triggers y las FKs, contra Postgres.
- `clinica-acceso-por-cita.e2e.ts` (10) · el enganche entero, incluido **mover con otra sanitaria**.
- Y 7 casos nuevos en `crm-route.test.ts` + 5 en `error-handler.test.ts`.

---

## 15 · Commits

```
0e5eff1 feat(clinica-1): el módulo, el rol sanitario y las tablas de la historia
d9d78fe feat(clinica-1): la función de acceso, el registro y las rutas clínicas
c1aeea2 test(clinica-1): la tabla de casos del acceso, las rutas y los sabotajes
835ad16 feat(clinica-1): el TPV del sanitario y la sección clínica de Personal
a726b99 feat(clinica-1): la negativa de la historia clínica se explica
f8bebb9 test(clinica-1): mover con otra sanitaria le da el acceso
8bc06b0 docs(clinica-1): capturas de Personal, y el puesto delante del email
```

## 16 · La rama

Rebasada sobre `origin/master` = `f38afa0`. Pusheada y con PR contra `master` (se anota el número al
abrirlo). **Ni merge ni despliegue: eso lo hace Dirección.**
